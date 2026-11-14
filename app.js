
const KEY = new URLSearchParams(location.search).has("dev") ? "gotest_loop_dev" : "gotest_loop_v1";
const DAILY = 20;           // 默认每日题数（设置里可填 5~2000）
let S = load();

function load(){
  try{
    const o = JSON.parse(localStorage.getItem(KEY));
    if(o){ o.v = 2; o.dailyMode = o.dailyMode || "count"; o.dailyCount = o.dailyCount || DAILY;
           o.dailyMin = o.dailyMin || 15; o.history = o.history || {}; return o; }
  }catch(e){}
  return {v:2, lv:0, mode:"strict", dailyMode:"count", dailyCount:DAILY, dailyMin:15,
          st:{}, wrong:{}, today:{d:"", n:0}, history:{}};
}
function save(){ localStorage.setItem(KEY, JSON.stringify(S)); }
function today(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function dateKey(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
/** 每完成一题记一次：同时更新今日计数和活跃地图的按日历史 */
function markDone(){
  if(S.today.d !== today()) S.today = {d: today(), n: 0};
  S.today.n++;
  if(!S.history) S.history = {};
  S.history[today()] = S.today.n;
}
function lvSt(i){
  if(!S.st[i]) S.st[i] = {pass:1, done:{}, ok:0, bad:0};
  return S.st[i];
}
function goalOf(i, pass){ return Math.min(100*pass, DATA[i].n); }
function wrongOf(i){
  const o = S.wrong[i] || {}; return Object.keys(o).map(Number).sort((a,b)=>a-b);
}
function planList(i){    // 本轮要做哪些题号（0-based）
  const st = lvSt(i), N = DATA[i].n, g = goalOf(i, st.pass);
  const idx = []; for(let k=0;k<g;k++) idx.push(k);
  if(S.mode === "compact" && st.pass > 1){
    const w = new Set(wrongOf(i));
    return idx.filter(k => w.has(k) || k >= goalOf(i, st.pass-1));
  }
  return idx;
}

/* ---------- 首页 ---------- */
function renderHome(){
  const box = document.getElementById("lvbox"); box.innerHTML = "";
  DATA.forEach((L,i)=>{
    const st = lvSt(i), g = goalOf(i, st.pass), d = Object.keys(st.done).length;
    const b = document.createElement("button");
    b.className = (i===S.lv ? "on":"");
    b.innerHTML = `<span class="n">${L.lb}</span><span class="m">${L.n} 题 · 第${st.pass}轮</span>` +
                  `<span class="lvb"><i style="width:${st.pass*10}%"></i></span>`;
    b.onclick = ()=>{ S.lv=i; save(); renderHome(); };
    box.appendChild(b);
  });
  const st = lvSt(S.lv), L = DATA[S.lv], g = goalOf(S.lv, st.pass);
  const list = planList(S.lv).filter(k=>!st.done[k]);
  const doneN = Object.keys(st.done).length;
  const pct = g ? Math.min(100, Math.round(doneN / g * 100)) : 0;
  const C = 2 * Math.PI * 42;
  const fg = document.getElementById("ringfg");
  fg.setAttribute("stroke-dasharray", (C*pct/100).toFixed(1) + " " + C.toFixed(1));
  document.getElementById("ringpct").textContent = pct + "%";
  document.getElementById("pinfo").textContent = `${L.lb} · 第 ${st.pass} / 10 轮`;
  document.getElementById("pgoal").textContent = `${g} 题（第 1–${g} 题）· 未做 ${list.length} 题`;
  const rb = document.getElementById("rounds"); rb.innerHTML = "";
  for(let k=1;k<=10;k++){
    const d = document.createElement("div");
    d.className = "rnd" + (k < st.pass ? " done" : "") + (k === st.pass ? " cur" : "");
    d.textContent = k < st.pass ? "✓" : k;
    rb.appendChild(d);
  }
  if(S.today.d !== today()){ S.today = {d: today(), n: 0}; save(); }
  const plan = S.dailyMode === "count" ? S.dailyCount + " 题"
             : (S.dailyMode === "time" ? S.dailyMin + " 分钟" : "不限量");
  document.getElementById("ptoday").textContent = `${S.today.n} 题 ／ 今天计划 ${plan}`;
  document.getElementById("wcount").textContent = wrongOf(S.lv).length + " 道";
  document.getElementById("mode").textContent = S.mode==="strict" ? "严格模式" : "压缩模式";
  syncDaily();
  document.getElementById("start").disabled = list.length === 0;
  document.getElementById("start").textContent = list.length ? "开始做题" : "这一轮已完成，点下面进入下一轮";
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
  document.getElementById("msfill").style.width = Math.min(100, s/28*100).toFixed(1) + "%";
  document.querySelectorAll(".msline b").forEach(b => b.classList.toggle("on", s >= +b.dataset.d));
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
  let v = Math.round(+e.target.value || 20);
  v = Math.max(5, Math.min(2000, v));
  S.dailyCount = v; save(); renderHome();
};
document.querySelectorAll(".chip").forEach(c=>{
  c.onclick = ()=>{ S.dailyCount = +c.dataset.n; save(); renderHome(); };
});
document.getElementById("selMin").onchange = (e)=>{ S.dailyMin = +e.target.value; save(); renderHome(); };
document.getElementById("mode").onclick = ()=>{ S.mode = S.mode==="strict"?"compact":"strict"; save(); renderHome(); };
document.getElementById("nextpass").onclick = ()=>{
  const st = lvSt(S.lv);
  if(st.pass >= 10){ alert("这一级 10 轮已走完，本级毕业 🎉"); return; }
  if(!confirm("确认本轮结束，进入第 " + (st.pass+1) + " 轮？")) return;
  st.pass++; st.done = {}; save(); renderHome();
};
document.getElementById("export").onclick = ()=>{
  const blob = new Blob([JSON.stringify(S,null,2)],{type:"application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "gotest_progress_"+today()+".json"; a.click();
};
document.getElementById("import").onclick = ()=> document.getElementById("impfile").click();
document.getElementById("impfile").onchange = (e)=>{
  const f = e.target.files[0]; if(!f) return;
  const rd = new FileReader();
  rd.onload = ()=>{
    try{
      const o = JSON.parse(rd.result);
      if(!o || !o.st) throw new Error("bad");
      if(!confirm("导入会覆盖当前进度，确定吗？")) { e.target.value=""; return; }
      o.v = 2; o.dailyMode = o.dailyMode || "count";
      o.dailyCount = o.dailyCount || DAILY; o.dailyMin = o.dailyMin || 15;
      o.history = o.history || {};
      S = o; save(); renderHome();
      alert("进度已恢复");
    }catch(err){ alert("导入失败：不是有效的进度文件"); }
    e.target.value = "";
  };
  rd.readAsText(f, "utf-8");
};

/* ---------- 做题 ---------- */
let queue = [], cur = null, cell = 20, ox = 0, oy = 0, ok = 0, bad = 0, answered = false, step = 0, placed = [];
let timeUp = false, deadline = 0, tickId = null;

function stopTimer(){ if(tickId){ clearInterval(tickId); tickId = null; } }
function tick(){
  const left = Math.max(0, deadline - Date.now());
  const m = Math.floor(left/60000), s = Math.floor(left%60000/1000);
  document.getElementById("clock").textContent = left > 0 ? ("剩余 " + m + ":" + String(s).padStart(2,"0")) : "时间到";
  if(left <= 0 && !timeUp){
    timeUp = true; stopTimer(); queue = [];
    document.getElementById("fb").className = "fb ok";
    document.getElementById("fb").textContent = "时间到，今天到这儿，做完手上这题就收工";
  }
}
document.getElementById("start").onclick = ()=>{
  const st = lvSt(S.lv);
  const all = planList(S.lv).filter(k => !st.done[k]);
  ok = 0; bad = 0; timeUp = false; stopTimer();
  document.getElementById("clock").textContent = "";
  if(S.dailyMode === "count"){
    queue = all.slice(0, S.dailyCount);
  } else if(S.dailyMode === "time"){
    queue = all.slice();
    deadline = Date.now() + S.dailyMin*60000;
    tickId = setInterval(tick, 500); tick();
  } else {
    queue = all.slice();          // 自由模式：不限量，做到点返回
  }
  document.getElementById("phead").textContent =
      DATA[S.lv].lb + " · 第 " + lvSt(S.lv).pass + " 轮 · " +
      (S.dailyMode==="free" ? "自由" : (S.dailyMode==="count" ? S.dailyCount+" 题" : S.dailyMin+" 分钟"));
  document.getElementById("home").classList.add("hide");
  document.getElementById("play").classList.remove("hide");
  nextQ();
};
document.getElementById("quit").onclick = ()=>{
  stopTimer();
  document.getElementById("clock").textContent = "";
  document.getElementById("play").classList.add("hide");
  document.getElementById("home").classList.remove("hide");
  renderHome();
};
function nextQ(){
  if(timeUp){ document.getElementById("fb").className="fb ok";
              document.getElementById("fb").textContent="时间到，点右上「返回」看今天的进度"; return; }
  if(queue.length === 0){ document.getElementById("fb").textContent = "本次做完啦，回去看进度"; document.getElementById("fb").className="fb ok"; return; }
  const idx = queue.shift();
  cur = DATA[S.lv].p[idx]; cur._i = idx; answered = false; step = 0; placed = [];
  document.getElementById("iq").textContent = "第 " + (idx+1) + " 题";
  document.getElementById("ir").textContent = ok;
  document.getElementById("iw").textContent = bad;
  document.getElementById("fb").textContent = cur.t || "请落子";
  document.getElementById("fb").className = "fb";
  document.getElementById("types").classList.add("hide");
  draw();
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
  answered = true; ok++;
  const st = lvSt(S.lv); if(!st.done[cur._i]) st.done[cur._i] = 1;
  markDone();
  document.getElementById("ir").textContent = ok;
  document.getElementById("fb").className = "fb ok";
  document.getElementById("fb").textContent = "正确 ✔ 点棋盘继续下一题";
  save();
}
function onTap(e){
  if(answered) { nextQ(); return; }
  const el = e.currentTarget, rect = el.getBoundingClientRect(), vb = el.viewBox.baseVal;
  const px = (e.clientX - rect.left) / rect.width * vb.width;
  const py = (e.clientY - rect.top) / rect.height * vb.height;
  const c = Math.round((px - ox) / cell), r = Math.round((py - oy) / cell);
  const rr = r + el._r0, cc = c + el._c0;
  if(rr<0||rr>18||cc<0||cc>18) return;
  const q = cur.q || [], exp = q[step];
  if(exp && exp[0]===rr && exp[1]===cc){
    placed.push([rr, cc, 1]); step++;
    if(step < q.length){ placed.push([q[step][0], q[step][1], 2]); step++; }
    if(step >= q.length){ draw(); solved(); }
    else {
      draw();
      document.getElementById("fb").className = "fb ok";
      document.getElementById("fb").textContent = "对，白棋应了一手，继续把这一局走完";
    }
  } else {
    bad++;
    document.getElementById("iw").textContent = bad;
    const marks = document.getElementById("marks");
    const x = ox + c*cell, y = oy + r*cell;
    marks.innerHTML = `<circle cx="${x}" cy="${y}" r="${cell*0.46}" fill="#1a1a1a" opacity=".5"/>`;
    document.getElementById("fb").className = "fb no";
    document.getElementById("fb").textContent = "不对，再想想（想不出就选下面错因，会标出正解）";
    document.getElementById("types").classList.remove("hide");
  }
}
document.querySelectorAll("#types button").forEach(b=>{
  b.onclick = ()=>{
    if(!S.wrong[S.lv]) S.wrong[S.lv] = {};
    S.wrong[S.lv][cur._i] = b.dataset.t;
    answered = true;
    const a = (cur.q && cur.q[0]);
    if(a){
      const marks = document.getElementById("marks");
      const x = ox + (a[1]-document.getElementById("svg")._c0)*cell;
      const y = oy + (a[0]-document.getElementById("svg")._r0)*cell;
      marks.innerHTML += `<circle cx="${x}" cy="${y}" r="${cell*0.46}" fill="none" stroke="#c0392b" stroke-width="3"/>`;
    }
    const st = lvSt(S.lv); st.done[cur._i] = 1; markDone();
    document.getElementById("fb").textContent = "已记错（" + b.dataset.t + "），红圈是正解。点棋盘继续。";
    document.getElementById("types").classList.add("hide");
    save();
  };
});
renderHome();
