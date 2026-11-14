
const BASE = new URLSearchParams(location.search).has("dev") ? "gotest_loop_dev" : "gotest_loop_v1";
const DAILY = 20;           // 默认每日题数（设置里可填 5~2000）
const RETRY_MAX = 3;        // 待重做的题最多插到队伍前面几条，避免卡住新内容
const PKEY = BASE + "_profiles";
const CKEY = BASE + "_current";

/* ---------- 多档：一台设备多个孩子，各自一份完全独立的存档 ---------- */
function profiles(){
  let arr = [];
  try{ arr = JSON.parse(localStorage.getItem(PKEY)) || []; }catch(e){}
  {
    let fixed = false;
    arr.forEach(x=>{ if(x.name === "1 号"){ x.name = "孩子 1"; fixed = true; } });
    if(fixed) localStorage.setItem(PKEY, JSON.stringify(arr));
  }
  if(!arr.length){
    arr = [{id:"p1", name:"孩子 1"}];
    localStorage.setItem(PKEY, JSON.stringify(arr));
    // 首次升级：把原来的单档进度整份搬到 p1，老键原样保留（不清空，留作兜底）
    const old = localStorage.getItem(BASE);
    if(old && !localStorage.getItem(BASE + "::p1")) localStorage.setItem(BASE + "::p1", old);
  }
  return arr;
}
function saveProfiles(arr){ localStorage.setItem(PKEY, JSON.stringify(arr)); }
function keyOf(id){ return BASE + "::" + id; }
function pname(id){
  const p = profiles().find(x => x.id === id);
  return p ? p.name : id;
}
function curPid(){
  const arr = profiles();
  let id = localStorage.getItem(CKEY);
  if(!id || !arr.some(p => p.id === id)){ id = arr[0].id; localStorage.setItem(CKEY, id); }
  return id;
}

let PID = curPid();
let KEY = keyOf(PID);
let S = load();

function switchProfile(id){
  if(id === PID) return;
  save();
  PID = id; localStorage.setItem(CKEY, id); KEY = keyOf(id);
  S = load(); renderHome();
}
function addProfile(name){
  const arr = profiles();
  const n = arr.reduce((m,p)=>Math.max(m, +String(p.id).replace("p","") || 0), 0) + 1;
  const id = "p" + n;
  arr.push({id, name: name || ("孩子 " + arr.length)});
  saveProfiles(arr);
  switchProfile(id);
}
function renameProfile(id, name){
  const arr = profiles(); const p = arr.find(x => x.id === id);
  if(p){ p.name = name; saveProfiles(arr); }
}
function delProfile(id){
  const arr = profiles().filter(p => p.id !== id);
  if(!arr.length) return;
  localStorage.removeItem(keyOf(id));
  saveProfiles(arr);
  if(id === PID){
    PID = arr[0].id; localStorage.setItem(CKEY, PID); KEY = keyOf(PID); S = load();
  }
  renderHome();
}
function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------- 音效：全部用 Web Audio 现场合成，不加载任何音频文件 ---------- */
const SFX = (function(){
  let ac = null;
  function ctx(){
    if(!ac){
      const AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return null;
      try{ ac = new AC(); }catch(e){ return null; }
    }
    if(ac.state === "suspended"){ try{ ac.resume(); }catch(e){} }
    return ac;
  }
  function on(){ return !S.sfx || S.sfx.on !== false; }
  function vol(){ return S.sfx && typeof S.sfx.vol === "number" ? S.sfx.vol : 0.45; }
  function ready(){ return on() && vol() > 0.001; }

  /** 单音，可带滑音 */
  function beep(type, f0, f1, dur, gain){
    if(!ready()) return;
    const c = ctx(); if(!c) return;
    const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if(f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const peak = Math.max(0.0002, gain * vol());
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.03);
  }

  /** 棋子敲盘：一段噪声分多个带通叠加。
   *  参数照 101 围棋网实测（落子主频 1925Hz、频谱重心 5515Hz、400Hz 以下几乎无能量、
   *  起音 10ms、峰后 60ms 衰减到 10%），所以是"脆"而不是"咚"。
   *  bands: [[中心频率, Q, 相对增益], ...] */
  function knock(bands, dur, gain){
    if(!ready()) return;
    const c = ctx(); if(!c) return;
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i] = (Math.random()*2 - 1) * Math.pow(1 - i/n, 3);
    bands.forEach(function(band){
      const src = c.createBufferSource(); src.buffer = buf;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = band[0]; bp.Q.value = band[1];
      const g = c.createGain(); g.gain.value = gain * band[2] * vol();
      src.connect(bp); bp.connect(g); g.connect(c.destination);
      src.start();
    });
  }

  return {
    unlock(){ ctx(); },                                    // 必须在用户手势里调一次，iOS 才允许发声
    // 黑子落下：1900Hz 主体 + 5.2kHz 空气层，照 101 实测的"脆亮"质感
    stone(){ knock([[1900, 0.9, 1.0], [5200, 1.2, 0.04]], 0.105, 0.52); },
    // 白棋应手：同一质感，略高略轻，让孩子听出"对方下了一手"
    white(){ knock([[2300, 0.9, 1.0], [6000, 1.2, 0.04]], 0.090, 0.34); },
    ok(){                                                  // 答对：两个上行音，音量压到很轻
      setTimeout(()=>beep("sine", 880, 880, 0.10, 0.12), 120);
      setTimeout(()=>beep("sine", 1320, 1320, 0.15, 0.10), 215);
    },
    done(){                                                 // 本次做完：三音上行
      [660, 880, 1100].forEach((f,i)=>setTimeout(()=>beep("sine", f, f, 0.11, 0.16), i*95));
    },
    timeup(){                                               // 时间到：两音下行
      beep("sine", 700, 700, 0.15, 0.16);
      setTimeout(()=>beep("sine", 470, 470, 0.22, 0.14), 170);
    }
  };
})();

function fresh(){
  return {v:3, lv:0, mode:"strict", dailyMode:"time", dailyCount:DAILY, dailyMin:10,
          st:{}, wrong:{}, retry:{}, q:{}, pace:DAILY, sfx:{on:true, vol:0.45},
          today:{d:"", n:0, sec:0}, history:{}};
}
function load(){
  try{
    const o = JSON.parse(localStorage.getItem(KEY));
    if(o){
      // v1/v2 -> v3：老师方案要求每天 15 分钟。只在题数还是默认值时才迁移，不覆盖手动设置
      if(!o.v || o.v < 3){
        if(o.dailyMode === "count" && (+o.dailyCount || DAILY) === DAILY) o.dailyMode = "time";
      }
      o.v = 3;
      o.dailyMode = o.dailyMode || "time";
      o.dailyCount = o.dailyCount || DAILY;
      o.dailyMin = o.dailyMin || 10;
      o.history = o.history || {};
      o.q = o.q || {};          // 每题首答记录 [首答对错, 累计错点, 首手耗时ms, 最近做对日期]
      o.retry = o.retry || {};  // 待重做（点了错因看答案的题）
      o.pace = o.pace || DAILY; // 15 分钟大致能做多少题，滚动更新
      o.sfx = o.sfx || {on:true, vol:0.45};
      return o;
    }
  }catch(e){}
  return fresh();
}
function save(){ localStorage.setItem(KEY, JSON.stringify(S)); }
function today(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function dateKey(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
/** 每答对一题记一次：同时更新今日计数和活跃地图的按日历史 */
function markDone(){
  if(S.today.d !== today()) S.today = {d: today(), n: 0, sec: 0};
  S.today.n++;
  if(!S.history) S.history = {};
  S.history[today()] = S.today.n;
}
function lvSt(i){
  if(!S.st[i]) S.st[i] = {pass:1, done:{}};
  return S.st[i];
}
function goalOf(i, pass){ return Math.min(100*pass, DATA[i].n); }
function wrongOf(i){
  const o = S.wrong[i] || {}; return Object.keys(o).map(Number).sort((a,b)=>a-b);
}
/** 每题的首答记录：[首答是否对(1/0/null未判), 累计错点, 首手耗时ms, 最近做对日期] */
function qRec(lv, idx){
  if(!S.q[lv]) S.q[lv] = {};
  let r = S.q[lv][idx];
  if(!r){ r = [null, 0, 0, 0]; S.q[lv][idx] = r; }
  return r;
}
/** 首答正确率——唯一能区分"会"和"记得上次点这里"的指标 */
function firstStat(lv){
  const o = S.q[lv] || {};
  let okN = 0, allN = 0;
  for(const k in o){ const f = o[k][0]; if(f === 1 || f === 0){ allN++; if(f === 1) okN++; } }
  return allN ? {rate: Math.round(okN/allN*100), okN, allN} : null;
}
/** 本轮要做哪些题号（0-based）：待重做的插到最前面，其余按题号 */
function planList(i){
  const st = lvSt(i), g = goalOf(i, st.pass);
  const idx = []; for(let k=0;k<g;k++) idx.push(k);
  // 只保留老师方案：每轮把目标范围内的旧题全部重做一遍
  const base = idx;
  const rt = S.retry[i] || {};
  const first = base.filter(k => rt[k]).slice(0, RETRY_MAX);
  if(!first.length) return base;
  const seen = new Set(first);
  return first.concat(base.filter(k => !seen.has(k)));
}

/* ---------- 首页 ---------- */
/** 目标行：把"今天还剩多少"直接写出来，避免以为每次都是从头开始 */
function targetLine(){
  const doneSec = S.today.d === today() ? (S.today.sec || 0) : 0;
  if(S.dailyMode === "count"){
    const left = Math.max(0, S.dailyCount - S.today.n);
    return "目标 " + S.dailyCount + " 题" + (left ? " · 还差 " + left : " · 已达标");
  }
  if(S.dailyMode === "time"){
    const targetSec = S.dailyMin * 60;
    if(doneSec >= targetSec) return "今天已做 " + Math.round(doneSec/60) + " 分钟 · 再练给 5 分钟";
    const left = Math.ceil((targetSec - doneSec) / 60);
    return "目标 " + S.dailyMin + " 分钟" + (doneSec ? " · 还差 " + left + " 分钟" : " · 5–15 均可");
  }
  return "不限量";
}
function dailyTargetText(){
  if(S.dailyMode === "count") return "目标 " + S.dailyCount + " 题";
  if(S.dailyMode === "time")  return "目标 " + S.dailyMin + " 分钟（5–15 均可）";
  return "不限量";
}
/** 顶部"当前练习"那一行 + 切换面板 */
function renderWho(){
  const cur = curPid();
  document.getElementById("whoName").textContent = pname(cur);
  const arr = profiles();
  let html = '<div class="whoTip">每个孩子各存一份独立进度 · 点名字切换，或新增一个</div>';
  arr.forEach(p=>{
    let sub = "还没开始";
    try{
      const o = JSON.parse(localStorage.getItem(keyOf(p.id)) || "null");
      if(o && o.st){
        let done = 0;
        Object.keys(o.st).forEach(k=>{ done += Object.keys(o.st[k].done || {}).length; });
        const pass = (o.st[0] && o.st[0].pass) || 1;
        sub = `第 ${pass} 轮 · 累计 ${done} 题`;
      }
    }catch(e){}
    html += `<div class="prow${p.id === cur ? " on" : ""}" data-id="${p.id}">` +
            `<span class="pn">${esc(p.name)}</span><span class="pm">${sub}</span>` +
            `<button class="px" data-a="rename">改名</button>` +
            (arr.length > 1 ? `<button class="px" data-a="del">删除</button>` : "") +
            `</div>`;
  });
  html += `<button class="padd" id="padd">＋ 新增一个孩子</button>`;
  const panel = document.getElementById("whoPanel");
  panel.innerHTML = html;

  panel.querySelectorAll(".prow").forEach(row=>{
    const id = row.dataset.id;
    row.onclick = (ev)=>{
      const a = ev.target.dataset ? ev.target.dataset.a : "";
      if(a === "rename"){
        const n = prompt("把「" + pname(id) + "」改成什么名字？", pname(id));
        if(n && n.trim()){ renameProfile(id, n.trim()); renderHome(); }
        return;
      }
      if(a === "del"){
        if(confirm("删除「" + pname(id) + "」的全部进度？无法恢复。")) delProfile(id);
        return;
      }
      switchProfile(id);
      panel.classList.add("hide");
    };
  });
  const add = document.getElementById("padd");
  if(add) add.onclick = ()=>{
    const n = prompt("新孩子的名字（用来区分各自的进度）", "");
    if(n === null) return;
    addProfile((n || "").trim());
    panel.classList.add("hide");
  };
}
function renderHome(){
  renderWho();
  const box = document.getElementById("lvbox"); box.innerHTML = "";
  DATA.forEach((L,i)=>{
    const st = lvSt(i), g = goalOf(i, st.pass), d = Object.keys(st.done).length;
    const b = document.createElement("button");
    b.className = (i===S.lv ? "on":"");
    // 进度条表示"这一轮做完多少"（不是第几轮——那个上面文字已经写了）
    const pct = g ? Math.min(100, Math.round(d / g * 100)) : 0;
    b.title = `${L.lb} · 第 ${st.pass} 轮 · 已完成 ${d}/${g} 题`;
    b.innerHTML = `<span class="n">${L.lb}</span><span class="m">${L.n} 题 · 第${st.pass}轮</span>` +
                  `<span class="lvb"><i style="width:${pct}%"></i></span>`;
    b.onclick = ()=>{ S.lv=i; save(); renderHome(); };
    box.appendChild(b);
  });

  if(S.today.d !== today()){ S.today = {d: today(), n: 0, sec: 0}; save(); }

  const st = lvSt(S.lv), L = DATA[S.lv], g = goalOf(S.lv, st.pass);
  const list = planList(S.lv).filter(k=>!st.done[k]);
  const doneN = Object.keys(st.done).length;

  // 环形 = 「今天」目标的完成度，跟着「按什么停」走：
  //   count 模式按题数、time 模式按分钟、free 模式只报已做量。
  //   （旧版固定用 300 秒，与 count 模式对不上；达标后环也不动，失去反馈作用）
  const todaySec = S.today.sec || 0;
  const todayN = S.today.n || 0;
  let ringPct = 0, ringBig = "", ringSub = "今天";
  if (S.dailyMode === "count") {
    const gN = Math.max(1, +S.dailyCount || DAILY);
    ringPct = Math.min(100, todayN / gN * 100);
    ringBig = todayN + "/" + gN;
    ringSub = "今日题数";
  } else if (S.dailyMode === "time") {
    const gM = Math.max(1, +S.dailyMin || 10);
    ringPct = Math.min(100, (todaySec / 60) / gM * 100);
    ringBig = todaySec < 60 ? todaySec + " 秒" : Math.round(todaySec / 60) + " 分";
    ringSub = "今日 / " + gM + " 分";
  } else {
    ringPct = Math.min(100, todayN / DAILY * 100);
    ringBig = todayN + " 题";
    ringSub = "今日";
  }
  const C = 2 * Math.PI * 42;
  const fg = document.getElementById("ringfg");
  fg.setAttribute("stroke-dasharray", (C*ringPct/100).toFixed(1) + " " + C.toFixed(1));
  document.getElementById("ringpct").textContent = ringBig;
  document.getElementById("ringsub").textContent = ringSub;
  document.getElementById("ptoday").textContent =
      (todaySec < 60 ? Math.round(todaySec) + " 秒" : Math.round(todaySec/60) + " 分钟") +
      " · " + S.today.n + " 题";

  document.getElementById("ppass").textContent = st.pass;
  document.getElementById("pinfo").textContent = L.lb;                 // 级别名单独占右侧，避免长句折行
  document.getElementById("pdone").textContent = doneN;
  document.getElementById("pgoal").textContent = g;
  document.getElementById("pundone").textContent = list.length;
  document.getElementById("ptarget").textContent = targetLine();

  const fs = firstStat(S.lv);
  document.getElementById("pfirst").textContent =
      fs ? `${fs.rate}%（${fs.okN}/${fs.allN}）` : "还没有记录";

  const rb = document.getElementById("rounds"); rb.innerHTML = "";
  for(let k=1;k<=10;k++){
    const d = document.createElement("div");
    d.className = "rnd" + (k < st.pass ? " done" : "") + (k === st.pass ? " cur" : "");
    d.textContent = k < st.pass ? "✓" : k;
    rb.appendChild(d);
  }

  renderWrong();
  syncDaily();
  syncSfx();
  document.getElementById("start").disabled = list.length === 0;
  const sn = list.length ? validSess() : null;
  if(!list.length){
    document.getElementById("start").textContent = "这一轮已完成，点下面进入下一轮";
  } else if(sn && S.dailyMode === "time"){
    const mm = Math.floor((sn.left || 0) / 60000), ss = Math.floor(((sn.left || 0) % 60000) / 1000);
    document.getElementById("start").textContent =
        "继续上次（还剩 " + mm + ":" + String(ss).padStart(2, "0") + "）";
  } else {
    document.getElementById("start").textContent = "开始做题";
  }
  document.getElementById("nextpass").classList.toggle("hide", list.length > 0);
  renderCalendar();
}
/** 连续做题天数：今天还没做就从昨天算起，避免白天空窗显示断签 */
function calcStreak(){
  const hist = S.history || {};
  const d = new Date(); d.setHours(0,0,0,0);
  if(!hist[dateKey(d)]) d.setDate(d.getDate()-1);
  let s = 0;
  while(hist[dateKey(d)] > 0){ s++; d.setDate(d.getDate()-1); }
  return s;
}
/** 本月活跃地图：按当天做题数分 5 级着色，今天加黑框 */
function renderCalendar(){
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const lead = (new Date(y,m,1).getDay()+6)%7;          // 周一开头
  const days = new Date(y,m+1,0).getDate();
  const hist = S.history || {};
  let html = "", monthQ = 0, monthD = 0;
  for(let i=0;i<lead;i++) html += '<div class="cell empty"></div>';
  for(let d=1; d<=days; d++){
    const key = y + "-" + String(m+1).padStart(2,"0") + "-" + String(d).padStart(2,"0");
    const n = +(hist[key] || 0);
    monthQ += n; if(n > 0) monthD++;
    const lv = n===0 ? 0 : (n<20 ? 1 : (n<50 ? 2 : (n<100 ? 3 : 4)));
    const cur = key === today() ? " cur" : "";
    html += `<div class="cell lv${lv}${cur}" title="${key} · ${n} 题"><span>${d}</span>` +
            (n ? `<em>${n}</em>` : "") + `</div>`;
  }
  document.getElementById("cal").innerHTML = html;
  document.getElementById("monthstat").textContent = `${monthQ} 题 · ${monthD} 天有做题`;
  const s = calcStreak();
  document.getElementById("streak").textContent = `连续 ${s} 天`;
}
function syncSfx(){
  const on = !S.sfx || S.sfx.on !== false;
  const b = document.getElementById("sfxBtn");
  b.textContent = on ? "开" : "关";
  b.classList.toggle("on", on);
  document.getElementById("sfxVol").value = Math.round((S.sfx && S.sfx.vol != null ? S.sfx.vol : 0.45) * 100);
}
function syncDaily(){
  document.getElementById("rowCount").style.display = S.dailyMode==="count" ? "flex" : "none";
  document.getElementById("rowTime").style.display = S.dailyMode==="time" ? "flex" : "none";
  document.getElementById("mFree").classList.toggle("on", S.dailyMode==="free");
  document.getElementById("mCount").classList.toggle("on", S.dailyMode==="count");
  document.getElementById("mTime").classList.toggle("on", S.dailyMode==="time");
  const nc = document.getElementById("numCount"), sm = document.getElementById("selMin");
  nc.value = S.dailyCount;
  sm.value = String(S.dailyMin);
  if(sm.value !== String(S.dailyMin)){ S.dailyMin = +sm.value; }
  document.querySelectorAll(".chip").forEach(c => c.classList.toggle("on", +c.dataset.n === S.dailyCount));
}
document.getElementById("mFree").onclick = ()=>{ S.dailyMode="free"; save(); renderHome(); };
document.getElementById("mCount").onclick = ()=>{ S.dailyMode="count"; save(); renderHome(); };
document.getElementById("mTime").onclick = ()=>{ S.dailyMode="time"; save(); renderHome(); };
document.getElementById("numCount").onchange = (e)=>{
  let v = Math.round(+e.target.value || DAILY);
  v = Math.max(5, Math.min(2000, v));
  S.dailyCount = v; save(); renderHome();
};
document.querySelectorAll(".chip").forEach(c=>{
  c.onclick = ()=>{ S.dailyCount = +c.dataset.n; save(); renderHome(); };
});
document.getElementById("selMin").onchange = (e)=>{ S.dailyMin = +e.target.value; save(); renderHome(); };
document.getElementById("sfxBtn").onclick = ()=>{
  S.sfx = S.sfx || {on:true, vol:0.45};
  S.sfx.on = !S.sfx.on; save(); renderHome();
  if(S.sfx.on) SFX.stone();
};
document.getElementById("sfxVol").oninput = (e)=>{
  S.sfx = S.sfx || {on:true, vol:0.45};
  S.sfx.vol = Math.max(0, Math.min(100, +e.target.value)) / 100;
  const b = document.getElementById("sfxBtn");
  b.textContent = S.sfx.vol > 0.001 ? "开" : "关";
};
document.getElementById("sfxVol").onchange = ()=>{ save(); SFX.stone(); };
document.getElementById("nextpass").onclick = ()=>{
  const st = lvSt(S.lv);
  if(st.pass >= 10){ alert("这一级 10 轮已走完，本级毕业 🎉"); return; }
  if(!confirm("确认本轮结束，进入第 " + (st.pass+1) + " 轮？\n下一轮要完成前 " + (100*(st.pass+1)) + " 题。")) return;
  st.pass++; st.done = {}; clearSess(); save(); renderHome();
};
/* ---------- 换设备：只搬「能接着做题」的核心进度 ----------
 * 传：轮数、做过哪些题、待重做、模式与时长设置（可选错题记录）
 * 不传：活跃地图 history、首答记录 q、今日计数 today、会话快照 sess、音效 pace
 * 实测（每档做 300 题）：核心 1.0 KB、含错题 1.9 KB；完整包 8.9 KB */
/* 紧凑编码：done 通常是「0..N 连成一片」，存 1000 个键太浪费。
 * 改成 [轮数, 前沿, 缺口列表]；若缺口比题目还多（极端稀疏），用 [轮数, -1, 题号列表]。
 * 实测：单档 300 题 988 → 160 字符；六档各 1000 题 3404 → 180 字符。 */
function packSt(){
  const out = {};
  Object.keys(S.st || {}).forEach(k=>{
    const v = S.st[k] || {};
    const ids = Object.keys(v.done || {}).map(Number).sort((a,b)=>a-b);
    if(!ids.length){ out[k] = [v.pass || 1, 0]; return; }
    const front = ids[ids.length-1] + 1;
    const seen = new Set(ids);
    const holes = [];
    for(let i=0;i<front;i++) if(!seen.has(i)) holes.push(i);
    if(holes.length > ids.length) out[k] = [v.pass || 1, -1, ids];   // 稀疏时反而存题号更省
    else out[k] = holes.length ? [v.pass || 1, front, holes] : [v.pass || 1, front];
  });
  return out;
}
function unpackSt(o){
  const out = {};
  Object.keys(o || {}).forEach(k=>{
    const v = o[k];
    if(!Array.isArray(v)){ out[k] = {pass: (v && v.pass) || 1, done: Object.assign({}, (v && v.done) || {})}; return; }
    const pass = v[0] || 1, done = {};
    if(v[1] === -1){ (v[2] || []).forEach(i=>{ done[i] = 1; }); }
    else {
      const front = v[1] || 0, holes = new Set(v[2] || []);
      for(let i=0;i<front;i++) if(!holes.has(i)) done[i] = 1;
    }
    out[k] = {pass, done};
  });
  return out;
}
function packIdx(map){
  const out = {};
  Object.keys(map || {}).forEach(k=>{ out[k] = Object.keys(map[k] || {}).map(Number).sort((a,b)=>a-b); });
  return out;
}
function unpackIdx(o){
  const out = {};
  Object.keys(o || {}).forEach(k=>{
    const v = o[k], m = {};
    if(Array.isArray(v)) v.forEach(i=>{ m[i] = 1; });
    else Object.keys(v || {}).forEach(i=>{ m[i] = 1; });
    out[k] = m;
  });
  return out;
}
function makePortable(withWrong){
  const o = {v:3, kind:"portable", at:Date.now(), lv:S.lv, mode:S.mode,
             dailyMode:S.dailyMode, dailyCount:S.dailyCount, dailyMin:S.dailyMin,
             st:packSt(), retry:packIdx(S.retry)};
  if(withWrong){
    const w = {};
    Object.keys(S.wrong || {}).forEach(k=>{
      w[k] = Object.keys(S.wrong[k] || {}).map(Number).map(i=>[i, S.wrong[k][i]]);
    });
    o.wrong = w;
  }
  return JSON.stringify(o);
}
function applyPortable(o){
  if(!o || o.kind !== "portable") throw new Error("不是进度码");
  S.lv = Math.max(0, Math.min(DATA.length-1, +o.lv || 0));
  S.mode = o.mode === "compact" ? "compact" : "strict";
  S.dailyMode = o.dailyMode || "time";
  S.dailyCount = +o.dailyCount || DAILY;
  S.dailyMin = +o.dailyMin || 10;
  S.st = unpackSt(o.st || {});
  S.retry = unpackIdx(o.retry || {});
  if(o.wrong){
    const w = {};
    Object.keys(o.wrong).forEach(k=>{
      const v = o.wrong[k], m = {};
      if(Array.isArray(v)) v.forEach(p=>{ if(Array.isArray(p)) m[p[0]] = p[1]; else m[p] = "气数"; });
      else Object.assign(m, v);      // 旧格式
      w[k] = m;
    });
    S.wrong = w;
  }
  S.sess = null;                 // 旧会话快照作废，避免和搬来的进度打架
  save();
}
async function encodeCode(str){
  const bytes = new TextEncoder().encode(str);
  let out = bytes, tag = "P";
  if(typeof CompressionStream !== "undefined"){
    try{
      const cs = new CompressionStream("gzip");
      const b = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).blob();
      out = new Uint8Array(await b.arrayBuffer());
      tag = "G";
    }catch(e){}
  }
  let s = "";
  for(let i=0;i<out.length;i++) s += String.fromCharCode(out[i]);
  return "GQ1" + tag + ":" + btoa(s);
}
async function decodeCode(code){
  code = String(code || "").trim().replace(/\s+/g, "");
  const m = /^GQ1([GP]):(.+)$/.exec(code);
  if(!m) throw new Error("格式不对，是不是没复制全？");
  const bin = atob(m[2]);
  let bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  if(m[1] === "G"){
    const ds = new DecompressionStream("gzip");
    const b = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).blob();
    return await b.text();
  }
  return new TextDecoder().decode(bytes);
}
/** 把进度码画成二维码。码里塞的是「带 hash 的 URL」，另一台扫了直接打开本页并自动导入。 */
function showQr(code){
  const box = document.getElementById("qrBox");
  const tip = document.getElementById("qrHint");
  if(!box) return;
  const hideAll = ()=>{ box.classList.add("hide"); if(tip) tip.classList.add("hide"); };
  if(typeof qrcode !== "function"){ hideAll(); return; }
  const safe = code.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const url = location.origin + location.pathname + "#p=" + safe;
  try{
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    box.innerHTML = qr.createSvgTag(4, 2);
    box.classList.remove("hide");
    if(tip) tip.classList.remove("hide");
  }catch(e){ hideAll(); }
}

/** 扫码打开本页时，hash 里带着另一台的进度码 → 问一句再导入 */
let hashBusy = false;
async function handleIncomingHash(){
  if(hashBusy) return;
  const hit = /#p=(GQ1[GP]:[A-Za-z0-9\-_]+)/.exec(location.hash || "");
  if(!hit) return;
  hashBusy = true;
  try{
    const mm = /^(GQ1[GP]:)([A-Za-z0-9\-_]+)$/.exec(hit[1]);
    let body = mm[2].replace(/-/g, "+").replace(/_/g, "/");
    while(body.length % 4) body += "=";
    const msg = await importFromCode(mm[1] + body);
    if(msg) alert("已导入：" + msg);
  }catch(e){
    alert("进度码无效：" + (e.message || e));
  }finally{
    try{ history.replaceState(null, "", location.pathname + location.search); }catch(err){}
    hashBusy = false;
  }
}

/** 调试与测试用：把编解码挂到 window */
window.GOTEST = { makePortable, applyPortable, encodeCode, decodeCode, startCustom, startCountdown, addFiveMinutes };

/* ---------- 错题集 ---------- */
function renderWrong(){
  const idxs = wrongOf(S.lv);
  const btn = document.getElementById("wrongBtn");
  if(btn) btn.textContent = idxs.length + " 道";
  const box = document.getElementById("wrongList");
  if(!box) return;
  if(!idxs.length){
    box.innerHTML = '<div class="emptyLine">这一档还没有错题</div>';
    return;
  }
  const reasons = S.wrong[S.lv] || {};
  let html = "";
  idxs.slice(0, 200).forEach(i=>{
    html += '<div class="wrow"><span class="wn">第 ' + (i+1) + ' 题</span>' +
            '<span class="wr">' + esc(reasons[i] || "未记原因") + '</span></div>';
  });
  if(idxs.length > 200) html += '<div class="emptyLine">…另有 ' + (idxs.length-200) + ' 道未显示</div>';
  html += '<div class="wact"><button class="chip" id="practiceWrong">重练这 ' + idxs.length + ' 道</button>' +
          '<button class="chip" id="clearWrong">清空本档</button></div>';
  box.innerHTML = html;

  document.getElementById("practiceWrong").onclick = ()=>{
    const list = wrongOf(S.lv).slice();
    if(!list.length) return;
    box.classList.add("hide");
    startCustom(list);
  };
  document.getElementById("clearWrong").onclick = ()=>{
    if(!confirm("清空 " + DATA[S.lv].lb + " 的错题记录？\n只清错题清单，不影响已完成进度。")) return;
    S.wrong[S.lv] = {}; S.retry[S.lv] = {};
    save(); renderHome();
  };
}
/** 不按每日额度、只把给定题号刷一遍（错题重练用）。做对仍算完成。 */
function startCustom(list){
  SFX.unlock();
  ok = 0; bad = 0; sessN = 0; timeUp = false; requeued = {}; stopTimer();
  running = false; remaining = 0;
  document.getElementById("clock").textContent = "重练";
  document.getElementById("pauseMask").classList.add("hide");
  document.getElementById("pause").classList.add("hide");
  queue = list.slice();
  startSecClock(0);
  document.getElementById("phead").textContent =
      DATA[S.lv].lb + " · 错题重练（" + list.length + " 道）";
  document.getElementById("home").classList.add("hide");
  document.getElementById("play").classList.remove("hide");
  nextQ();
}

/* ---------- 手动设置进度（换机、跳着做、重置某一档） ---------- */
function fillManualLevels(){
  const sel = document.getElementById("mLevel");
  if(sel.options.length) return;
  DATA.forEach((L, i)=>{
    const o = document.createElement("option");
    o.value = String(i); o.textContent = L.lb + "（" + L.n + " 题）";
    sel.appendChild(o);
  });
}
function syncManual(){
  const lv = +document.getElementById("mLevel").value || 0;
  const pass = Math.max(1, Math.min(10, +document.getElementById("mPass").value || 1));
  const cap = Math.min(100 * pass, DATA[lv].n);
  const md = document.getElementById("mDone");
  md.max = String(cap);
  document.getElementById("mHint").textContent =
      "当前可填 0–" + cap + " 题（第 " + pass + " 轮要做满 " + cap + " 题）";
}
document.getElementById("mLevel").onchange = syncManual;
document.getElementById("mPass").onchange = syncManual;
document.getElementById("mApply").onclick = ()=>{
  const lv = Math.max(0, Math.min(DATA.length-1, +document.getElementById("mLevel").value || 0));
  const pass = Math.max(1, Math.min(10, +document.getElementById("mPass").value || 1));
  const cap = Math.min(100 * pass, DATA[lv].n);
  let k = Math.round(+document.getElementById("mDone").value || 0);
  k = Math.max(0, Math.min(cap, k));
  if(!confirm("把「" + pname(PID) + "」的 " + DATA[lv].lb + " 设为：第 " + pass + " 轮、第 1–" + k + " 题已完成。\n该档现有的完成记录会被覆盖，确定吗？")) return;
  S.lv = lv;
  const st = lvSt(lv);
  st.pass = pass;
  st.done = {};
  for(let i=0;i<k;i++) st.done[i] = 1;
  S.sess = null;                 // 旧会话快照作废
  save(); renderHome();
  document.getElementById("mHint").textContent = "已设为：" + DATA[lv].lb + " · 第 " + pass + " 轮 · 已完成 " + k + " 题";
};

/** 统一的导入入口：进度码字符串 → 校验 → 确认 → 落地 */
async function importFromCode(code){
  const o = JSON.parse(await decodeCode(code));
  if(!o || o.kind !== "portable") throw new Error("这不是进度码");
  const lb = (DATA[o.lv] && DATA[o.lv].lb) || "该级别";
  const pass = ((o.st || {})[o.lv] || {}).pass || 1;
  if(!confirm("导入会把「" + pname(PID) + "」的进度替换成：" + lb + " · 第 " + pass + " 轮。\n活跃地图和首答记录保留本机的。确定吗？")) return false;
  applyPortable(o); renderHome();
  return lb + " · 第 " + pass + " 轮";
}

document.getElementById("mkCode").onclick = async ()=>{
  const hint = document.getElementById("codeHint");
  try{
    const code = await encodeCode(makePortable(document.getElementById("withWrong").checked));
    showQr(code);
    hint.textContent = "二维码已生成（" + code.length + " 个字符）——用另一台设备点「扫码导入」对准它";
  }catch(e){ hint.textContent = "生成失败：" + (e.message || e); }
};

/* ---------- 扫码导入（设备自带摄像头 + jsQR 解码） ---------- */
let scanStream = null, scanRAF = 0;
/** 彻底关闭取景框（成功导入或用户取消时用） */
function stopScan(){
  releaseCamera();
  const v = document.getElementById("scanVideo");
  if(v) v.style.display = "";
  const tip = document.getElementById("scanTip");
  if(tip){ tip.className = "scanTip"; tip.textContent = "把另一台设备上的二维码放进画面里"; }
  document.getElementById("scanWrap").classList.add("hide");
  document.getElementById("qrBox").classList.add("hide");
  document.getElementById("qrHint").classList.add("hide");
}
/** 只释放摄像头，取景框留着显示错误原因——避免"一闪就没了"看不出为什么 */
function releaseCamera(){
  if(scanRAF){ cancelAnimationFrame(scanRAF); scanRAF = 0; }
  if(scanStream){ scanStream.getTracks().forEach(t=>{ try{ t.stop(); }catch(e){} }); scanStream = null; }
  const v = document.getElementById("scanVideo");
  if(v) v.srcObject = null;
}
function scanFail(msg){
  releaseCamera();
  const v = document.getElementById("scanVideo");
  if(v) v.style.display = "none";
  const tip = document.getElementById("scanTip");
  if(tip){ tip.className = "scanTip scanTipErr"; tip.textContent = msg; }
  document.getElementById("codeHint").textContent = "扫码失败，原因见上方黑框";
}
/** 扫码结果可能是整段网址，也可能就是码本身 */
function pickCode(text){
  const m = /#p=(GQ1[GP]:[A-Za-z0-9\-_]+)/.exec(text || "");
  const raw = m ? m[1] : String(text || "").trim();
  const mm = /^(GQ1[GP]:)([A-Za-z0-9\-_]+)$/.exec(raw);
  if(!mm) return null;
  let body = mm[2].replace(/-/g, "+").replace(/_/g, "/");
  while(body.length % 4) body += "=";
  return mm[1] + body;
}
function scanLoop(){
  const v = document.getElementById("scanVideo");
  const cv = document.getElementById("scanCanvas");
  if(!scanStream || !v || !cv) return;
  if(v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth){
    const w = v.videoWidth, h = v.videoHeight;
    const scale = Math.min(1, 640 / Math.max(w, h));
    cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
    const g = cv.getContext("2d");
    g.drawImage(v, 0, 0, cv.width, cv.height);
    const img = g.getImageData(0, 0, cv.width, cv.height);
    const res = jsQR(img.data, cv.width, cv.height, { inversionAttempts: "dontInvert" });
    if(res && res.data){
      const code = pickCode(res.data);
      stopScan();
      if(!code){ alert("扫到的不是进度码"); return; }
      importFromCode(code).then(msg=>{ if(msg) alert("已导入：" + msg); })
                          .catch(e=>alert("进度码无效：" + (e.message || e)));
      return;
    }
  }
  scanRAF = requestAnimationFrame(scanLoop);
}
/** 是否以"独立窗口/桌面图标"方式运行（此时没有地址栏，权限要按 App 去给） */
function isStandalone(){
  try{
    if(navigator.standalone === true) return true;
    if(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    if(window.matchMedia && window.matchMedia("(display-mode: fullscreen)").matches) return true;
  }catch(e){}
  return false;
}
/** 相机权限被拒时，按运行方式给不同的操作路径 */
function permGuide(){
  if(isStandalone()){
    return "你现在是从桌面图标打开的（没有地址栏），要去系统里给这个应用授权：\n" +
           "① 回到桌面，长按「围棋6000题」图标\n" +
           "② 点「应用信息」/「应用详情」\n" +
           "③ 权限 → 相机 → 允许\n" +
           "④ 回来重开应用，再点扫码\n\n" +
           "（找不到的话：设置 → 应用 → 找到本应用 → 权限 → 相机）";
  }
  return "① 点地址栏左侧的 锁 / ⓘ 图标\n" +
         "② 找到「相机」→ 改成「允许」\n" +
         "③ 刷新页面后再点扫码\n\n" +
         "如果地址栏里没有相机选项，说明手机把浏览器的相机权限整体关了：\n" +
         "设置 → 应用 → Chrome → 权限 → 相机 → 允许";
}

/** 依次尝试几种约束：部分安卓机不接受 ideal / 对象形式的 facingMode */
async function openCamera(){
  const tries = [
    { video: { facingMode: { ideal: "environment" } }, audio: false },
    { video: { facingMode: "environment" }, audio: false },
    { video: true, audio: false }
  ];
  let last = null;
  for(let i=0;i<tries.length;i++){
    try{ return await navigator.mediaDevices.getUserMedia(tries[i]); }
    catch(e){
      last = e;
      // 权限被拒 / 非安全上下文，换约束也没用，直接停
      if(e && (e.name === "NotAllowedError" || e.name === "SecurityError" || e.name === "PermissionDeniedError")) break;
    }
  }
  throw last || new Error("未知错误");
}

/** 安卓上 videoWidth 常常要等 loadedmetadata，直接 play 会拿到 0×0 */
function waitVideoReady(v){
  return new Promise(res=>{
    if(v.videoWidth && v.readyState >= 1) return res(true);
    let done = false;
    const finish = ok=>{ if(!done){ done = true; res(ok); } };
    v.addEventListener("loadedmetadata", ()=>finish(true), { once:true });
    setTimeout(()=>finish(!!v.videoWidth), 3000);
  });
}

document.getElementById("scanCode").onclick = async ()=>{
  const hint = document.getElementById("codeHint");
  const diag = "（" + location.protocol + "｜" + (navigator.mediaDevices ? "有 camera API" : "无 camera API") + "）";
  if(typeof jsQR === "function"){} else {
    hint.textContent = "扫码功能只在网页版可用；本地文件版请用系统相机扫" + diag;
    return;
  }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    hint.textContent = "这个浏览器不提供摄像头接口，换 Chrome 打开试试" + diag;
    return;
  }
  document.getElementById("qrBox").classList.add("hide");
  document.getElementById("qrHint").classList.add("hide");
  document.getElementById("scanWrap").classList.remove("hide");
  hint.textContent = "正在打开摄像头…";

  // 先查权限状态：被"阻止"过的话浏览器不会再弹框，只会直接拒绝
  let perm = "";
  try{
    if(navigator.permissions && navigator.permissions.query){
      const st = await navigator.permissions.query({ name: "camera" });
      perm = st.state || "";
    }
  }catch(e){}
  if(perm === "denied"){
    scanFail("相机权限被拒绝了。\n\n" + permGuide() +
             "\n\n不想折腾权限的话，直接用「从相册选二维码图片」，不需要相机。" + diag);
    return;
  }

  try{
    scanStream = await openCamera();
    const v = document.getElementById("scanVideo");
    v.srcObject = scanStream;
    await waitVideoReady(v);
    try{ await v.play(); }catch(e){ /* 有些安卓机 play() 会先报错，只要出画面就能解 */ }
    if(!v.videoWidth){
      scanFail("摄像头已打开，但拿不到画面（可能被其它 App 占用）" + diag);
      return;
    }
    hint.textContent = "对准另一台设备上的二维码";
    scanLoop();
  }catch(e){
    const name = (e && e.name) || "";
    let msg;
    if(name === "NotAllowedError" || name === "PermissionDeniedError")
      msg = "权限被拒绝：请点地址栏左侧的锁/信息图标 → 允许相机，然后重试";
    else if(name === "NotFoundError" || name === "DevicesNotFoundError")
      msg = "这台设备没有可用摄像头";
    else if(name === "NotReadableError" || name === "TrackStartError")
      msg = "摄像头被其它程序占用（比如相机、微信视频），关掉再试";
    else if(name === "SecurityError")
      msg = "当前打开方式不允许用摄像头：请用 https 网页或 Chrome，别在微信里打开";
    else msg = (e && e.message) || String(e);
    const extra = (name === "NotAllowedError" || name === "PermissionDeniedError")
      ? "\n\n" + permGuide() + "\n\n不想折腾权限的话，直接用「从相册选二维码图片」，不需要相机。"
      : "";
    scanFail("打不开摄像头：" + msg + extra + (name ? "\n\n" + name : "") + diag);
  }
};
/* ---------- 从相册选二维码图片（不需要相机权限） ---------- */
function decodeFromImage(file){
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{
      try{
        const max = 1600;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const cv = document.getElementById("scanCanvas");
        cv.width = w; cv.height = h;
        const g = cv.getContext("2d");
        g.drawImage(img, 0, 0, w, h);
        const data = g.getImageData(0, 0, w, h);
        URL.revokeObjectURL(url);
        // 图片可能是反色的码，这里两种都试
        const res = jsQR(data.data, w, h, { inversionAttempts: "attemptBoth" });
        if(res && res.data) resolve(res.data);
        else reject(new Error("empty"));
      }catch(e){ URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error("image")); };
    img.src = url;
  });
}
document.getElementById("qrFile").onchange = async (e)=>{
  const hint = document.getElementById("codeHint");
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if(!f) return;
  if(typeof jsQR !== "function"){ hint.textContent = "解码库没加载成功，刷新页面再试"; return; }
  hint.textContent = "正在识别图片…";
  try{
    const txt = await decodeFromImage(f);
    const code = pickCode(txt);
    if(!code){ hint.textContent = "图片里是一段文字，但不是本应用的进度码"; return; }
    const msg = await importFromCode(code);
    hint.textContent = msg ? "已导入：" + msg : "已取消导入";
  }catch(err){
    hint.textContent = (err && err.message === "empty")
      ? "这张图里找不到二维码：尽量用原图、别裁剪，截图时让码占满画面"
      : "读取图片失败：" + ((err && err.message) || err);
  }
};

document.getElementById("scanCancel").onclick = ()=>{
  stopScan();
  document.getElementById("codeHint").textContent = "已取消扫码";
};

/* ---------- 做题 ---------- */
let queue = [], cur = null, cell = 20, ox = 0, oy = 0, ok = 0, bad = 0, answered = false, step = 0, placed = [];
let timeUp = false, tickId = null, remaining = 0, running = false, lastTick = 0;
let sessSec = 0, secTick = null, paused = false;   // 本次实际做题秒数（暂停时不计）
let t0 = 0, firstJudged = false, sessN = 0, requeued = {};

function stopTimer(){ if(tickId){ clearInterval(tickId); tickId = null; } }
function stopSecClock(){ if(secTick){ clearInterval(secTick); secTick = null; } }
function startSecClock(init){
  sessSec = init || 0; paused = false; stopSecClock();
  // 每秒累加一次；暂停或时间到就停，切后台由 visibilitychange 置 paused
  secTick = setInterval(()=>{ if(!paused && !timeUp) sessSec++; }, 1000);
}
/** 会话收尾：把这次 15 分钟实际做了多少题，滚动并入 pace 估计 */
/** 把「这次做到哪儿了」存下来。只在题与题之间存，恢复时当前题从头开始。 */
function saveSess(){
  if(!cur) return;
  S.sess = { day: today(), at: Date.now(), lv: S.lv, pass: lvSt(S.lv).pass, mode: S.dailyMode,
             left: remaining, queue: queue.slice(), cur: cur._i,
             done: sessN, sec: sessSec };
  save();
}
function clearSess(){ if(S.sess){ S.sess = null; save(); } }
/** 快照有效条件：同一天、12 小时内、级别/轮次/模式都没变 */
function validSess(){
  const s = S.sess;
  if(!s || !s.day || s.day !== today()) return null;
  if(Date.now() - (s.at || 0) > 12*3600*1000) return null;
  if(s.lv !== S.lv) return null;
  if(s.pass !== lvSt(S.lv).pass) return null;
  if(s.mode !== S.dailyMode) return null;
  return s;
}

function endSession(){
  if(S.today.d !== today()) S.today = {d: today(), n: 0, sec: 0};
  if(sessSec > 0){ S.today.sec = (S.today.sec || 0) + sessSec; sessSec = 0; }
  if(sessN > 0 && S.dailyMode === "time") S.pace = Math.max(5, Math.round(S.pace*0.6 + sessN*0.4));
  save();
}
/** 倒计时按"实际在做题的时间"累计，暂停/切后台都不走表 */
function tick(){
  const now = Date.now();
  // 单次最多扣 5 秒：万一系统把定时器节流（或设备睡眠后没触发 visibilitychange），
  // 不至于一口气把十几分钟全扣掉
  if(running) remaining = Math.max(0, remaining - Math.min(5000, now - lastTick));
  lastTick = now;
  const m = Math.floor(remaining/60000), s = Math.floor(remaining%60000/1000);
  document.getElementById("clock").textContent =
      remaining > 0 ? ("剩余 " + m + ":" + String(s).padStart(2,"0")) : "时间到";
  if(remaining <= 0 && !timeUp){
    timeUp = true; running = false; stopTimer(); stopSecClock(); queue = []; endSession(); clearSess(); SFX.timeup();
    document.getElementById("pause").classList.add("hide");
    document.getElementById("addTime").classList.remove("hide");
    document.getElementById("fb").className = "fb ok";
    document.getElementById("fb").textContent = "时间到，今天到这儿，做完手上这题就收工" +
        ((S.today.sec || 0) >= S.dailyMin*60 ? "（今天的 " + S.dailyMin + " 分钟够了）" : "");
  }
}

/** 时间到之后加时：再给 5 分钟，不占每日额度，队列按剩余未做题重建 */
function addFiveMinutes(){
  if(!timeUp) return;
  timeUp = false; paused = false;
  document.getElementById("addTime").classList.add("hide");
  document.getElementById("pauseMask").classList.add("hide");
  document.getElementById("pause").classList.remove("hide");
  document.getElementById("pause").textContent = "暂停";
  const st = lvSt(S.lv);
  queue = planList(S.lv).filter(k => !st.done[k]);
  startSecClock(0);
  startCountdown(5 * 60 * 1000);
  document.getElementById("fb").className = "fb";
  if(queue.length) nextQ();
  else { document.getElementById("fb").textContent = "这一轮已经没有要做的题了"; }
}

function startCountdown(ms){
  remaining = ms; running = true; lastTick = Date.now();
  stopTimer(); tickId = setInterval(tick, 250); tick();
}
function pauseSession(){
  if(!running || timeUp) return;
  running = false; paused = true; stopTimer(); saveSess();
  document.getElementById("pause").textContent = "继续";
  document.getElementById("pauseMask").classList.remove("hide");
}
function resumeSession(){
  if(timeUp || running) return;
  running = true; paused = false; lastTick = Date.now();
  stopTimer(); tickId = setInterval(tick, 250);
  document.getElementById("pause").textContent = "暂停";
  document.getElementById("pauseMask").classList.add("hide");
}
document.getElementById("start").onclick = ()=>{
  SFX.unlock();
  const st = lvSt(S.lv);
  const all = planList(S.lv).filter(k => !st.done[k]);
  const snap = validSess();

  ok = 0; bad = 0; sessN = 0; timeUp = false; requeued = {}; stopTimer();
  running = false; remaining = 0;
  document.getElementById("clock").textContent = "";
  document.getElementById("pauseMask").classList.add("hide");
  document.getElementById("addTime").classList.add("hide");
  document.getElementById("pause").classList.remove("hide");
  document.getElementById("pause").textContent = "暂停";
  // 只有限时模式才显示暂停按钮
  document.getElementById("pause").classList.toggle("hide", S.dailyMode !== "time");

  let initSec = 0;
  if(snap){
    // 接着上次被打断的那次：题目从当前题起，剩余时间也接上
    queue = snap.queue.slice();
    if(snap.cur !== null && snap.cur !== undefined) queue.unshift(snap.cur);
    sessN = snap.done || 0; ok = sessN;
    initSec = snap.sec || 0;
    if(S.dailyMode === "time"){
      const quotaLeft = Math.max(60, S.dailyMin*60 - (S.today.sec || 0));
      startCountdown(Math.max(60000, Math.min(snap.left || 0, quotaLeft*1000)));
    }
  } else if(S.dailyMode === "count"){
    queue = all.slice(0, S.dailyCount);
  } else if(S.dailyMode === "time"){
    queue = all.slice();
    // 倒计时接续"今天还剩多少分钟"，而不是每次都从满额重来
    const targetSec = S.dailyMin * 60;
    const doneSec = (S.today.d === today() ? (S.today.sec || 0) : 0);
    let leftSec = targetSec - doneSec;
    if(leftSec <= 0) leftSec = 300;      // 今天已经做够，仍允许再练 5 分钟
    if(leftSec < 60) leftSec = 60;       // 至少 1 分钟，免得一进来就"时间到"
    startCountdown(leftSec * 1000);
  } else {
    queue = all.slice();          // 自由模式：不限量，做到点返回
  }
  startSecClock(initSec);

  const st2 = lvSt(S.lv);
  document.getElementById("phead").textContent =
      DATA[S.lv].lb + " · 第 " + st2.pass + " 轮 · " +
      (S.dailyMode==="free" ? "自由" : (S.dailyMode==="count" ? S.dailyCount+" 题" : S.dailyMin+" 分钟")) +
      (snap ? " · 接着上次" : "");
  document.getElementById("home").classList.add("hide");
  document.getElementById("play").classList.remove("hide");
  nextQ();
};
document.getElementById("quit").onclick = ()=>{
  stopTimer(); stopSecClock(); endSession(); clearSess();
  document.getElementById("clock").textContent = "";
  document.getElementById("addTime").classList.add("hide");
  document.getElementById("play").classList.add("hide");
  document.getElementById("home").classList.remove("hide");
  renderHome();
};
function nextQ(){
  if(timeUp){ document.getElementById("fb").className="fb ok";
              document.getElementById("fb").textContent="时间到，点右上「返回」看今天的进度"; return; }
  if(queue.length === 0){ SFX.done(); clearSess(); document.getElementById("fb").textContent = "本次做完啦，回去看进度"; document.getElementById("fb").className="fb ok"; return; }
  const idx = queue.shift();
  cur = DATA[S.lv].p[idx]; cur._i = idx; answered = false; step = 0; placed = [];
  firstJudged = false; t0 = Date.now();
  document.getElementById("iq").textContent = "第 " + (idx+1) + " 题";
  document.getElementById("ir").textContent = ok;
  document.getElementById("iw").textContent = bad;
  document.getElementById("fb").textContent = cur.t || "请落子";
  document.getElementById("fb").className = "fb";
  document.getElementById("types").classList.add("hide");
  draw();
  saveSess();
}
function draw(){
  const s = cur.s, svg = document.getElementById("svg");
  let r0 = 18, r1 = 0, c0 = 18, c1 = 0;
  s.forEach(p=>{ r0=Math.min(r0,p[0]); r1=Math.max(r1,p[0]); c0=Math.min(c0,p[1]); c1=Math.max(c1,p[1]); });
  if(cur.q) cur.q.forEach(p=>{ r0=Math.min(r0,p[0]); r1=Math.max(r1,p[0]); c0=Math.min(c0,p[1]); c1=Math.max(c1,p[1]); });
  r0=Math.max(0,r0-1); c0=Math.max(0,c0-1); r1=Math.min(18,r1+1); c1=Math.min(18,c1+1);
  // 至少 9×9 视野，保持棋形有上下文
  const needW = Math.max(9, c1-c0+1), needH = Math.max(9, r1-r0+1);
  const mc = Math.round((c0+c1)/2), mr = Math.round((r0+r1)/2);
  c0 = Math.min(Math.max(0, mc - Math.floor(needW/2)), 19-needW); c1 = c0 + needW - 1;
  r0 = Math.min(Math.max(0, mr - Math.floor(needH/2)), 19-needH); r1 = r0 + needH - 1;
  const w = c1-c0+1, h = r1-r0+1;
  cell = Math.max(20, Math.min(32, Math.floor(Math.min(430/w, 430/h))));
  const PAD = Math.round(cell*0.78);
  const W = (w-1)*cell + PAD*2, H = (h-1)*cell + PAD*2;
  ox = PAD; oy = PAD;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  let g = `<rect width="${W}" height="${H}" fill="#e8c879" rx="6"/>`;
  for(let i=0;i<w;i++) g += `<line x1="${PAD+i*cell}" y1="${PAD}" x2="${PAD+i*cell}" y2="${PAD+(h-1)*cell}" stroke="#7a5a2a" stroke-width="1"/>`;
  for(let j=0;j<h;j++) g += `<line x1="${PAD}" y1="${PAD+j*cell}" x2="${PAD+(w-1)*cell}" y2="${PAD+j*cell}" stroke="#7a5a2a" stroke-width="1"/>`;
  s.forEach(p=>{
    const x = PAD+(p[1]-c0)*cell, y = PAD+(p[0]-r0)*cell, r = cell*0.46;
    g += p[2]===1
      ? `<circle cx="${x}" cy="${y}" r="${r}" fill="#1a1a1a"/>`
      : `<circle cx="${x}" cy="${y}" r="${r}" fill="#fbfbfb" stroke="#333" stroke-width="1"/>`;
  });
  g += `<g id="marks"></g>`;
  placed.forEach(p=>{
    const x = PAD+(p[1]-c0)*cell, y = PAD+(p[0]-r0)*cell, r = cell*0.46;
    g += p[2]===1
      ? `<circle cx="${x}" cy="${y}" r="${r}" fill="#1a1a1a"/>`
      : `<circle cx="${x}" cy="${y}" r="${r}" fill="#fbfbfb" stroke="#333" stroke-width="1"/>`;
  });
  svg.innerHTML = g;
  svg.onclick = onTap;
  svg._c0 = c0; svg._r0 = r0;
}
function solved(){
  answered = true; ok++; sessN++; SFX.ok();
  const st = lvSt(S.lv); if(!st.done[cur._i]) st.done[cur._i] = 1;
  const r = qRec(S.lv, cur._i);
  r[3] = today();
  if(S.retry[S.lv]) delete S.retry[S.lv][cur._i];
  markDone();
  document.getElementById("ir").textContent = ok;
  document.getElementById("fb").className = "fb ok";
  document.getElementById("fb").textContent = "正确 ✔ 点棋盘继续下一题";
  save();
}
function onTap(e){
  if(paused) return;                                                    // 已暂停，棋盘不响应
  if(answered) { nextQ(); return; }
  const el = e.currentTarget, rect = el.getBoundingClientRect(), vb = el.viewBox.baseVal;
  const px = (e.clientX - rect.left) / rect.width * vb.width;
  const py = (e.clientY - rect.top) / rect.height * vb.height;
  const c = Math.round((px - ox) / cell), r = Math.round((py - oy) / cell);
  const rr = r + el._r0, cc = c + el._c0;
  if(rr<0||rr>18||cc<0||cc>18) return;
  const q = cur.q || [], exp = q[step];
  const hit = !!(exp && exp[0]===rr && exp[1]===cc);

  // 首答判定：只认本会话的第一手。这是"重新算对"和"记得上次点这里"的唯一分界
  if(!firstJudged && q.length){
    firstJudged = true;
    const rec = qRec(S.lv, cur._i);
    if(rec[0] === null){ rec[0] = hit ? 1 : 0; rec[2] = Date.now() - t0; save(); }
  }

  if(hit){
    placed.push([rr, cc, 1]); step++; SFX.stone();
    if(step < q.length){ placed.push([q[step][0], q[step][1], 2]); step++; setTimeout(()=>SFX.white(), 130); }
    if(step >= q.length){ draw(); solved(); }
    else {
      draw();
      document.getElementById("fb").className = "fb ok";
      document.getElementById("fb").textContent = "对，白棋应了一手，继续把这一局走完";
    }
  } else {
    bad++;
    qRec(S.lv, cur._i)[1]++;
    save();
    document.getElementById("iw").textContent = bad;
    const marks = document.getElementById("marks");
    const x = ox + c*cell, y = oy + r*cell;
    marks.innerHTML = `<circle cx="${x}" cy="${y}" r="${cell*0.46}" fill="#1a1a1a" opacity=".5"/>`;
    document.getElementById("fb").className = "fb no";
    document.getElementById("fb").textContent = "不对，再想想（实在想不出，可以选下面错因看正解，但这题不算完成）";
    document.getElementById("types").classList.remove("hide");
  }
}
document.querySelectorAll("#types button").forEach(b=>{
  b.onclick = ()=>{
    if(!S.wrong[S.lv]) S.wrong[S.lv] = {};
    S.wrong[S.lv][cur._i] = b.dataset.t;
    // 看答案 = 这题没做出来：不计完成、不计今日、不进活跃地图，转为待重做
    if(!S.retry[S.lv]) S.retry[S.lv] = {};
    S.retry[S.lv][cur._i] = 1;
    answered = true;
    const a = (cur.q && cur.q[0]);
    if(a){
      const marks = document.getElementById("marks");
      const x = ox + (a[1]-document.getElementById("svg")._c0)*cell;
      const y = oy + (a[0]-document.getElementById("svg")._r0)*cell;
      marks.innerHTML += `<circle cx="${x}" cy="${y}" r="${cell*0.46}" fill="none" stroke="#c0392b" stroke-width="3"/>`;
    }
    // 本会话内再出现一次（只重排一次，避免死循环）
    if(!timeUp && !requeued[cur._i]){ requeued[cur._i] = 1; queue.push(cur._i); }
    document.getElementById("fb").textContent = "已记错（" + b.dataset.t + "），红圈是正解。这题不算完成，稍后还会出现。点棋盘继续。";
    document.getElementById("types").classList.add("hide");
    save();
  };
});
renderHome();

/* 切换面板的开关 */
document.getElementById("whoBtn").onclick = ()=>{
  const p = document.getElementById("whoPanel");
  p.classList.toggle("hide");
};

/* 暂停/继续 + 切到后台自动暂停（孩子被叫走时不烧时间） */
document.getElementById("pause").onclick = ()=>{
  if(running) pauseSession(); else resumeSession();
};
document.addEventListener("visibilitychange", ()=>{
  if(document.visibilityState === "hidden") pauseSession();
});

/* 扫码打开本页时，hash 里带进度码 → 自动尝试导入 */
handleIncomingHash();
window.addEventListener("hashchange", handleIncomingHash);
fillManualLevels();
syncManual();
/* 点「错题集」展开/收起 */
document.getElementById("wrongBtn").onclick = ()=>{
  document.getElementById("wrongList").classList.toggle("hide");
};

/* 时间到后加时 */
document.getElementById("addTime").onclick = addFiveMinutes;

/* 重置今天：清掉今日计时与题数，已完成到第几轮不受影响 */
document.getElementById("resetToday").onclick = ()=>{
  const sec = (S.today && S.today.sec) || 0, n = (S.today && S.today.n) || 0;
  if(!sec && !n){ alert("今天还没有记录，不用重置"); return; }
  if(!confirm("把今天的 " + Math.round(sec/60) + " 分钟、 " + n + " 题清零？\n（活跃地图里今天那格也会清空；做到第几轮不受影响）")) return;
  S.today = {d: today(), n: 0, sec: 0};
  if(S.history) delete S.history[today()];
  S.sess = null;
  running = false; remaining = 0; sessSec = 0;
  stopTimer(); stopSecClock();
  save(); renderHome();
};
