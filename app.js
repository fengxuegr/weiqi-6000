
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

/* ---------- 音效：现场合成，不加载任何音频文件 ----------
   落子声不是"一段带通噪声"，而是一组阻尼共振：
     · 棋子砸到盘面那一瞬，同时激发木盘的弯曲模态（200~800Hz，衰减慢）→ 决定"厚"
     · 棋子自身的共振（1.9~5kHz，衰减快）→ 决定"脆"和音高
     · 3~4ms 的宽带接触噪声 → 决定"锐"
   旧版只做了带通噪声，等于只有第三项，缺音高、缺体感，所以听着像塑料片。
   每种音色预生成 3 个随机变体，播放时随机选一个再微调速率，
   连续落子不会出现"复制粘贴"的机械感。 */
const SFX = (function(){
  let ac = null;
  const bank = {};          // kind -> [AudioBuffer ×3]
  const bells = {};         // 频率 -> AudioBuffer
  let TONE = "A";

  /* 三档音色：只调 体感/亮度/接触噪声 三个系数，音高骨架共用 */
  const STYLES = {
    A: { body: 1.00, bright: 1.00, hit: 1.00 },   // 天然：云子落榧木盘，有"笃"的实体
    B: { body: 0.40, bright: 1.30, hit: 1.45 },   // 清脆：101 围棋网那种"啪"，颗粒感强
    C: { body: 1.75, bright: 0.76, hit: 0.78 }    // 厚重：实木大棋盘，低频更饱
  };

  /* 骨架：body = 盘体低频模态，bright = 棋子高频模态，hit = [高通Hz, 时长s, 幅度]
     模态格式 [频率Hz, 衰减时间常数s, 相对幅度] */
  const SPEC = {
    stone: {   // 黑子：主共振 1930Hz，配 298Hz 的盘体感
      dur: 0.32, level: 0.52,
      body:   [[298, 0.085, 0.34], [705, 0.048, 0.15]],
      bright: [[1930, 0.048, 1.00], [3120, 0.030, 0.36], [4520, 0.018, 0.13]],
      hit: [3400, 0.0038, 0.60]
    },
    white: {   // 白子：整体高半个档、轻一点，孩子能听出"对方下了一手"
      dur: 0.32, level: 0.44,
      body:   [[322, 0.078, 0.29], [762, 0.044, 0.13]],
      bright: [[2300, 0.044, 1.00], [3460, 0.026, 0.31], [5040, 0.016, 0.10]],
      hit: [4200, 0.0034, 0.54]
    },
    capture: { // 提子：低一档、更闷，像棋子被拿起来在盘面上磕了一下
      dur: 0.38, level: 0.36,
      body:   [[176, 0.110, 0.44], [420, 0.072, 0.30]],
      bright: [[1060, 0.055, 0.86], [2380, 0.022, 0.16]],
      hit: [2300, 0.0045, 0.34]
    },
    wrong: {   // 答错：一声很轻的闷木响。中低频为主、短、不带下行音阶，
               // 只用来确认"这一手没走对"，不做惩罚性的挫败音
      dur: 0.20, level: 0.26,
      body:   [[262, 0.050, 0.50], [393, 0.035, 0.28]],
      bright: [[620, 0.025, 0.14], [980, 0.014, 0.05]],
      hit: [1500, 0.0030, 0.26]
    }
  };

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
  function rnd(a, b){ return a + Math.random() * (b - a); }

  /* 延时音效（提子的第二声、答对的两声…）必须能被统一取消：
     孩子答对后立刻点返回，否则 240ms 后还会冒出一声"叮"，听着像没退出去 */
  const timers = [];
  function later(fn, ms){
    const id = setTimeout(function(){
      const i = timers.indexOf(id);
      if(i >= 0) timers.splice(i, 1);
      fn();
    }, ms);
    timers.push(id);
    return id;
  }
  function cancelAll(){
    for(let i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    timers.length = 0;
  }

  /** 叠加一个阻尼模态 A·e^(-t/τ)·sin(2πft+φ)。相位用递推算，比每次 sin 快一个量级 */
  function addMode(out, sr, f, tau, amp, phase){
    if(!(amp > 0) || !(f > 0) || !(f < sr * 0.45)) return;
    const w = 2 * Math.PI * f / sr;
    const cw = Math.cos(w), sw = Math.sin(w);
    const k = Math.exp(-1 / (tau * sr));
    let s = Math.sin(phase), c = Math.cos(phase);
    let env = amp;
    const lim = amp * 0.0008;
    for(let i = 0; i < out.length; i++){
      out[i] += env * s;
      const ns = s * cw + c * sw;
      c = c * cw - s * sw;
      s = ns;
      env *= k;
      if(env < lim) break;
    }
  }

  /** 接触噪声：白噪声过一阶高通后按指数衰减，负责"锐"的那一下 */
  function addNoise(out, sr, cutoff, tau, amp){
    if(!(amp > 0)) return;
    const a = 1 / (1 + 2 * Math.PI * cutoff / sr);
    const k = Math.exp(-1 / (tau * sr));
    let env = amp, xp = 0, yp = 0;
    for(let i = 0; i < out.length; i++){
      const x = Math.random() * 2 - 1;
      yp = a * (yp + x - xp);
      xp = x;
      out[i] += env * yp * 2.2;
      env *= k;
      if(env < amp * 1e-4) break;
    }
  }

  /** 几个早期反射，做出"棋盘在桌上、人在房间里"的空间感。纯直达声听着贴耳又发干 */
  function room(out, sr, wet){
    if(wet == null) wet = 1;
    const taps = [[1.7, 0.20], [3.4, 0.13], [6.1, 0.085], [9.8, 0.050], [14.5, 0.028]];
    const src = out.slice();
    for(let t = 0; t < taps.length; t++){
      const d = Math.round(taps[t][0] * sr / 1000);
      const a = taps[t][1] * wet;
      if(d <= 0) continue;
      for(let i = 0; i + d < out.length; i++) out[i + d] += src[i] * a;
    }
  }

  /** 收尾：起音渐变（否则首采样即峰，会"咔"）+ 尾巴淡出 + 峰值归一 */
  function finish(out, sr){
    const n = out.length;
    const atk = Math.max(1, Math.round(sr * 0.0008));
    for(let i = 0; i < atk && i < n; i++) out[i] *= i / atk;
    const fade = Math.round(sr * 0.03);
    for(let j = 0; j < fade && j < n; j++){
      out[n - 1 - j] *= 0.5 - 0.5 * Math.cos(Math.PI * j / fade);
    }
    let peak = 0;
    for(let q = 0; q < n; q++){
      const v = out[q];
      if(v > peak) peak = v; else if(-v > peak) peak = -v;
    }
    const g = peak > 1e-6 ? 0.88 / peak : 0;
    for(let m = 0; m < n; m++) out[m] *= g;
  }

  function toBuffer(out, sr){
    const c = ctx(); if(!c) return null;
    const b = c.createBuffer(1, out.length, sr);
    if(b.copyToChannel) b.copyToChannel(out, 0);
    else b.getChannelData(0).set(out);
    return b;
  }

  /** 合成一次敲击 */
  function buildHit(kind){
    const c = ctx(); if(!c) return null;
    const sr = c.sampleRate, spec = SPEC[kind], st = STYLES[TONE] || STYLES.A;
    const n = Math.round(sr * spec.dur);
    const out = new Float32Array(n);
    spec.body.forEach(function(m){
      addMode(out, sr, m[0] * rnd(0.985, 1.015), m[1], m[2] * st.body, rnd(0, 6.283));
    });
    spec.bright.forEach(function(m){
      addMode(out, sr, m[0] * rnd(0.985, 1.015), m[1], m[2] * st.bright, rnd(0, 6.283));
    });
    addNoise(out, sr, spec.hit[0], spec.hit[1], spec.hit[2] * st.hit);
    room(out, sr);
    finish(out, sr);
    return toBuffer(out, sr);
  }

  /** 提示音：钢片琴音色（基频 + 2 次 + 近 3 次泛音）。正弦太"电子表"，所以要有泛音和槌击瞬态 */
  function buildBell(f){
    const c = ctx(); if(!c) return null;
    const sr = c.sampleRate;
    const n = Math.round(sr * 0.62);
    const out = new Float32Array(n);
    addMode(out, sr, f,        0.150, 1.00, rnd(0, 6.283));
    addMode(out, sr, f * 2.00, 0.075, 0.22, rnd(0, 6.283));
    addMode(out, sr, f * 3.01, 0.042, 0.08, rnd(0, 6.283));
    addNoise(out, sr, 5200, 0.0022, 0.09);
    room(out, sr, 0.45);
    finish(out, sr);
    return toBuffer(out, sr);
  }

  function playBuf(buf, gain, pan, rate, when){
    const c = ctx(); if(!c || !buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    if(rate && src.playbackRate) src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = Math.max(0, gain) * vol();
    src.connect(g);
    if(pan && c.createStereoPanner){
      const p = c.createStereoPanner();
      if(p.pan) p.pan.value = pan;
      g.connect(p); p.connect(c.destination);
    } else {
      g.connect(c.destination);
    }
    src.start(when || 0);        // 传绝对时间就用音频时钟排期，比 setTimeout 准，也不怕后台节流
  }

  /** 播放一组敲击：随机变体 + 随机音量/速率，消掉机械感 */
  function hit(kind, pan, when){
    if(!ready()) return;
    let arr = bank[kind];
    if(!arr){
      arr = bank[kind] = [];
      for(let i = 0; i < 3; i++) arr.push(buildHit(kind));
      arr = arr.filter(Boolean);
    }
    if(!arr.length) return;
    const buf = arr[(Math.random() * arr.length) | 0];
    playBuf(buf, SPEC[kind].level * rnd(0.93, 1.07), pan || 0, rnd(0.985, 1.015), when);
  }

  function bell(f, gain, pan){
    if(!ready()) return;
    const key = f + "";
    if(!bells[key]) bells[key] = buildBell(f);
    playBuf(bells[key], gain, pan || 0, rnd(0.997, 1.003));
  }

  /* ---- 真实录音（优先）。解码成功就用 Sabaki 的原始落子/提子声，
     解码失败或还没解完，退回上面的模态合成，保证任何情况下都有声。 ---- */
  let recBank = null;                 // {stone:[AudioBuffer], capture:[AudioBuffer]}
  let recState = 0;                   // 0 未开始 / 1 解码中 / 2 可用 / 3 全部失败
  let lastStone = -1, lastCap = -1, lastWrong = 0;

  function b64Buf(s){
    const bin = atob(s);
    const u8 = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }

  /** 裁掉 mp3 编码器延迟造成的静音头，峰值统一到 0.88（各段录音原始响度不一致） */
  function prep(src, c){
    const chs = src.numberOfChannels, n = src.length, sr = src.sampleRate;
    const d = new Float32Array(n);
    for(let ch = 0; ch < chs; ch++){
      const s = src.getChannelData(ch);
      for(let i = 0; i < n; i++) d[i] += s[i] / chs;
    }
    let peak = 0;
    for(let i = 0; i < n; i++){ const v = d[i] < 0 ? -d[i] : d[i]; if(v > peak) peak = v; }
    if(peak < 1e-4) return null;
    const lim = peak * 0.02;
    let start = 0;
    for(let i = 0; i < n; i++){ const v = d[i] < 0 ? -d[i] : d[i]; if(v > lim){ start = i; break; } }
    start = Math.max(0, start - Math.round(sr * 0.002));
    const len = n - start;
    const out = c.createBuffer(1, len, sr);
    const dst = out.getChannelData(0);
    const g = 0.88 / peak;
    for(let i = 0; i < len; i++) dst[i] = d[i + start] * g;
    return out;
  }

  function decodeAll(){
    if(recState) return;
    const c = ctx(); if(!c) return;
    // sounds.js 万一没加载（有人手工删了），整体退回合成声，不能连累做题
    if(typeof SFX_REC === "undefined" || !SFX_REC){ recState = 3; return; }
    recState = 1;
    recBank = { stone: [], capture: [] };
    const jobs = [];
    for(const kind in SFX_REC){
      SFX_REC[kind].forEach(function(s, i){
        jobs.push(new Promise(function(res){
          let done = false;
          const fin = function(b){
            if(done) return;
            done = true;
            recBank[kind][i] = b ? prep(b, c) : null;
            res();
          };
          try{
            // Chrome 返回 Promise 且同时调回调，老 Safari 只有回调，两种都兜住
            const p = c.decodeAudioData(b64Buf(s), fin, function(){ fin(null); });
            if(p && p.then) p.then(fin).catch(function(){ fin(null); });
          }catch(e){ fin(null); }
        }));
      });
    }
    return Promise.all(jobs).then(function(){
      let n = 0;
      for(const k in recBank) n += recBank[k].filter(Boolean).length;
      recState = n ? 2 : 3;
    });
  }

  /** 随机取一个变体，且不连续复用同一个（Sabaki 也是这么做的，否则能听出重复） */
  function playRec(kind, gain, pan, rate, when){
    if(recState !== 2 || !recBank) return false;
    const arr = recBank[kind];
    if(!arr || !arr.length) return false;
    let idx = 0;
    if(arr.length > 1){
      const last = kind === "stone" ? lastStone : lastCap;
      idx = (Math.random() * arr.length) | 0;
      let guard = 0;
      while(idx === last && guard++ < 8) idx = (Math.random() * arr.length) | 0;
      if(kind === "stone") lastStone = idx; else lastCap = idx;
    }
    if(!arr[idx]) return false;
    playBuf(arr[idx], gain, pan, rate, when);
    return true;
  }

  return {
    unlock(){ ctx(); decodeAll(); },       // 用户手势里调一次：iOS 才允许发声，同时开始解码录音
    tone(t){ TONE = STYLES[t] ? t : "A"; for(const k in bank) delete bank[k]; },
    // 黑子落下：Sabaki 真实录音（131~261ms 五个变体随机），没解好就用合成
    stone(){
      if(!ready()) return;
      if(!playRec("stone", 0.52, 0, rnd(0.985, 1.015))) hit("stone", 0);
    },
    // 白棋应手：同一副棋，速率抬 3~6% 听着略高略轻，再偏右一点，区分"对方下的"
    white(){
      if(!ready()) return;
      if(!playRec("stone", 0.38, 0.12, rnd(1.03, 1.06))) hit("white", 0.12);
    },
    // 提子：用音频时钟排在落子后 70ms（不用 setTimeout：后台标签页的定时器会被节流，
    // 声音会拖着不出来；音频时钟是准的，而且这个延迟太短，不值得为它做取消）
    capture(){
      if(!ready()) return;
      const c = ctx(); if(!c) return;
      const when = c.currentTime + 0.07;
      if(!playRec("capture", 0.42, -0.06, rnd(0.985, 1.015), when)) hit("capture", -0.06, when);
    },
    // 答错：一声轻闷的木质提示，告诉孩子"这一手没走对"，但不刺耳、不掉音阶
    wrong(){
      if(!ready()) return;
      const t = Date.now();
      if(t - lastWrong < 240) return;   // 乱点了不要连成一片噪音
      lastWrong = t;
      hit("wrong", 0);
    },
    ok(){                                  // 答对：纯四度上行，很轻
      later(function(){ bell(988, 0.13); }, 130);
      later(function(){ bell(1318, 0.10); }, 240);
    },
    done(){                                // 本次做完：G-B-D 大三和弦琶音
      [784, 988, 1174].forEach(function(f, i){
        later(function(){ bell(f, 0.15 - i * 0.02); }, i * 110);
      });
    },
    timeup(){                              // 时间到：纯五度下行
      bell(700, 0.16);
      later(function(){ bell(466, 0.14); }, 190);
    },
    cancel(){ cancelAll(); }               // 离开做题页时掐掉还没响的延时音效
  };
})();

/* 每日时长：允许任意分钟数（以前只能选 <select> 里那 9 个值，孩子想练 12 分钟没法设）。
   只做范围夹取 1–120，旧存档 / 别台设备导入的进度码可能带 7、999 这类值，统一夹住，
   避免目标口径分裂（比如 0 分钟会让"今天够了"的判断直接成立）。
   注意：load() 在文件很靠前就会执行，这里只能用函数声明（会提升），不能用顶层 const/let。 */
function clampMin(v){
  if(String(v).trim() === "") return 10;      // 空输入＝没填，回默认，别当成 0
  const n = Math.round(+v);
  return Number.isFinite(n) ? Math.max(1, Math.min(120, n)) : 10;
}
function clampCount(v){
  const n = Math.round(+v);
  return Number.isFinite(n) ? Math.max(5, Math.min(2000, n)) : DAILY;
}
function fresh(){
  return {v:3, lv:0, mode:"strict", dailyMode:"time", dailyCount:DAILY, dailyMin:10,
          st:{}, wrong:{}, retry:{}, q:{}, sfx:{on:true, vol:0.45}, autoNext:true,
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
      o.dailyCount = clampCount(o.dailyCount);
      o.dailyMin = clampMin(o.dailyMin);
      // lv 必须夹住：题库改版后老存档可能指向已经不存在的档位，
      // 越界时 DATA[S.lv] 是 undefined，一进做题页就 TypeError。
      o.lv = Math.max(0, Math.min(DATA.length - 1, Math.round(+o.lv) || 0));
      o.history = (o.history && typeof o.history === "object" && !Array.isArray(o.history)) ? o.history : {};
      // 每题首答记录 [首答对错, 累计错点, 首手耗时ms, 最近做对日期]；旧格式/损坏值直接丢掉
      o.q = (o.q && typeof o.q === "object" && !Array.isArray(o.q)) ? o.q : {};
      o.st = (o.st && typeof o.st === "object" && !Array.isArray(o.st)) ? o.st : {};
      o.wrong = (o.wrong && typeof o.wrong === "object" && !Array.isArray(o.wrong)) ? o.wrong : {};
      o.retry = (o.retry && typeof o.retry === "object" && !Array.isArray(o.retry)) ? o.retry : {};  // 待重做（点了错因看答案的题）
      o.today = (o.today && typeof o.today === "object") ? o.today : {d:"", n:0, sec:0};
      o.sfx = (o.sfx && typeof o.sfx === "object") ? o.sfx : {on:true, vol:0.45};
      if(o.autoNext === undefined) o.autoNext = true;
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
  if(importUndo) clearUndoImport();          // 一旦产生新题，导入撤销即失效（D-02）
  if(S.today.d !== today()) S.today = {d: today(), n: 0, sec: 0};
  S.today.n++;
  if(!S.history) S.history = {};
  S.history[today()] = S.today.n;
}
function lvSt(i){
  if(!S.st[i]) S.st[i] = {pass:1, done:{}};
  return S.st[i];
}
/** 每轮目标：前 9 轮按 100×轮次递增；最后一轮直接做满整档，
 *  把题库末尾那 19~23 道零头也刷完（否则 6124 题永远只能覆盖 6000 题）。
 *  手动设置进度、进入下一轮的文案都走这里，避免同一个上限写死在多处。 */
function goalOf(i, pass){ return pass >= 10 ? DATA[i].n : Math.min(100*pass, DATA[i].n); }
function wrongOf(i){
  const o = S.wrong[i] || {}; return Object.keys(o).map(Number).sort((a,b)=>a-b);
}
/** 每题的首答记录：[首答是否对(1/0/null未判), 累计错点, 首手耗时ms, 最近做对日期] */
function qRec(lv, idx){
  if(!S.q[lv]) S.q[lv] = {};
  let r = S.q[lv][idx];
  if(!Array.isArray(r)){ r = [null, 0, 0, 0]; S.q[lv][idx] = r; }
  return r;
}
/** 首答正确率——唯一能区分"会"和"记得上次点这里"的指标 */
function firstStat(lv){
  const o = S.q[lv] || {};
  let okN = 0, allN = 0;
  for(const k in o){
    const r = o[k];
    if(!Array.isArray(r)) continue;      // 旧格式 / 损坏记录跳过，别让首页渲染整段崩掉
    const f = r[0];
    if(f === 1 || f === 0){ allN++; if(f === 1) okN++; }
  }
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
/** 今日剩余行：分母（目标题数/目标时长）已由环形副标给出，这里只写还差多少，不重复报目标 */
function targetLine(){
  const doneSec = S.today.d === today() ? (S.today.sec || 0) : 0;
  if(S.dailyMode === "count"){
    const left = Math.max(0, S.dailyCount - S.today.n);
    return left ? "还差 " + left + " 题" : "已达标";
  }
  if(S.dailyMode === "time"){
    const targetSec = S.dailyMin * 60;
    if(doneSec >= targetSec) return "已达标，可再练 " + S.dailyMin + " 分";
    const left = Math.ceil((targetSec - doneSec) / 60);
    return doneSec ? "还差 " + left + " 分" : "5–15 均可";
  }
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
        const lv = Number.isInteger(o.lv) ? Math.max(0, Math.min(DATA.length-1, o.lv)) : 0;
        const pass = (o.st[lv] && o.st[lv].pass) || 1;
        sub = `当前档第 ${pass} 轮 · 累计 ${done} 题`;
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
    // 自由模式没有目标：环不画完成度（只留底环），中心只报今日累计题数。
    // 旧版按写死的 DAILY=20 题算百分比，与「不限量」文案自相矛盾。
    ringPct = 0;
    ringBig = todayN + " 题";
    ringSub = "今日 · 不限量";
  }
  const C = 2 * Math.PI * 42;
  const fg = document.getElementById("ringfg");
  fg.setAttribute("stroke-dasharray", (C*ringPct/100).toFixed(1) + " " + C.toFixed(1));
  document.getElementById("ringpct").textContent = ringBig;
  document.getElementById("ringsub").textContent = ringSub;
  document.getElementById("ptoday").textContent =
      (todaySec < 60 ? todaySec + " 秒" : Math.round(todaySec/60) + " 分") +
      " · " + S.today.n + " 题";
  document.getElementById("ptarget").textContent = targetLine();

  document.getElementById("ppass").textContent = st.pass;
  document.getElementById("pinfo").textContent = L.lb;                 // 级别名单独占右侧，避免长句折行
  document.getElementById("pdone").textContent = doneN;
  document.getElementById("pgoal").textContent = g;
  document.getElementById("pundone").textContent = list.length;

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
  syncAuto();
  syncSfx();
  const doneAll = list.length === 0;
  document.getElementById("start").classList.toggle("hide", doneAll);
  document.getElementById("nextpass").classList.toggle("hide", !doneAll);
  document.getElementById("roundDone").classList.toggle("hide", !doneAll);
  if(doneAll){
    const fs2 = firstStat(S.lv);
    document.getElementById("rdTitle").textContent = st.pass >= 10
      ? "✓ 第 10 轮完成 · 本级毕业 🎉"
      : "✓ 第 " + st.pass + " 轮完成";
    document.getElementById("rdInfo").textContent =
      g + " 题做完" +
      (fs2 ? " · 累计首答正确率 " + fs2.rate + "%" : "") +
      " · 错题 " + wrongOf(S.lv).length + " 道";
    document.getElementById("nextpass").textContent = st.pass >= 10
      ? "本级 10 轮已走完"
      : "进入第 " + (st.pass + 1) + " 轮（要做 " + goalOf(S.lv, st.pass + 1) + " 题）";
    document.getElementById("nextpass").disabled = st.pass >= 10;
  }
  const sn = list.length ? validSess() : null;
  if(list.length && sn){
    if(S.dailyMode === "time"){
      const mm = Math.floor((sn.left || 0) / 60000), ss = Math.floor(((sn.left || 0) % 60000) / 1000);
      document.getElementById("start").textContent =
          "继续上次（还剩 " + mm + ":" + String(ss).padStart(2, "0") + "）";
    } else {
      document.getElementById("start").textContent = "接着上次";
    }
  } else {
    document.getElementById("start").textContent = "开始做题";
  }
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
/* ---------- 活跃地图 ----------
 * 默认「本月」；「近 12 周」滚动窗口（84 格，跨月连续可见）作为下钻。
 * 未来日单独标记，不与「未做」混色；色阶按实际训练量分档，图例标区间。
 * 视图偏好只存运行时，不写进存档，旧存档天然兼容。 */
const MAP_WEEKS = 12;
let mapView = "month";
/** 做题数 → 色阶：1-5 / 6-15 / 16-30 / 31+ 题。阈值按每日 5–15 分钟定，待真实数据校准 */
function heatLevel(n){
  n = +n || 0;
  return n === 0 ? 0 : (n <= 5 ? 1 : (n <= 15 ? 2 : (n <= 30 ? 3 : 4)));
}
function calCell(key, label, hist, tk){
  const n = +(hist[key] || 0);
  const fut = key > tk;                       // 未来日 ≠ 未做日
  const cls = "cell lv" + heatLevel(n) + (fut ? " fut" : "") + (key === tk ? " cur" : "");
  return '<div class="' + cls + '" title="' + key + ' · ' + n + ' 题"><span>' + label + '</span>' +
         (n ? '<em>' + n + '</em>' : '') + '</div>';
}
/** 近 12 周：以「今天所在周的周一」往前 11 周为起点，共 84 格，行=周、列=星期 */
function renderRolling(hist, tk){
  const end = new Date(); end.setHours(0,0,0,0);
  const back = (end.getDay()+6)%7 + (MAP_WEEKS-1)*7;
  const start = new Date(end); start.setDate(end.getDate() - back);
  let html = "", q = 0, d = 0;
  for(let i=0;i<MAP_WEEKS*7;i++){
    const day = new Date(start); day.setDate(start.getDate() + i);
    const key = dateKey(day);
    if(key <= tk){ const n = +(hist[key] || 0); q += n; if(n > 0) d++; }
    html += calCell(key, day.getDate(), hist, tk);
  }
  return {html:html, q:q, d:d};
}
/** 本月：保留自然月口径，仅补未来日标记 */
function renderMonth(hist, tk){
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const lead = (new Date(y,m,1).getDay()+6)%7;
  const days = new Date(y,m+1,0).getDate();
  let html = "", q = 0, d = 0;
  for(let i=0;i<lead;i++) html += '<div class="cell empty"></div>';
  for(let i=1;i<=days;i++){
    const key = y + "-" + String(m+1).padStart(2,"0") + "-" + String(i).padStart(2,"0");
    if(key <= tk){ const n = +(hist[key] || 0); q += n; if(n > 0) d++; }
    html += calCell(key, i, hist, tk);
  }
  return {html:html, q:q, d:d};
}
/** 近 12 周每日明细：折叠表，完整 YYYY-MM-DD，触屏可读（A-08） */
function renderCalDetail(hist, tk){
  const end = new Date(); end.setHours(0,0,0,0);
  const back = (end.getDay()+6)%7 + (MAP_WEEKS-1)*7;
  const start = new Date(end); start.setDate(end.getDate() - back);
  let html = '<table class="calTable"><thead><tr><th scope="col">日期</th><th scope="col">题数</th><th scope="col">状态</th></tr></thead><tbody>';
  for(let i=0;i<MAP_WEEKS*7;i++){
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = dateKey(d), n = +(hist[key] || 0), fut = key > tk;
    html += '<tr><td>' + key + '</td><td>' + (fut ? "—" : n + " 题") + '</td><td>' +
            (fut ? "未到" : (n > 0 ? "有做题" : "未做")) + '</td></tr>';
  }
  html += '</tbody></table>';
  document.getElementById("calDetail").innerHTML = html;
}
function renderCalendar(){
  const hist = S.history || {}, tk = today();
  const rolling = mapView === "rolling";
  const r = rolling ? renderRolling(hist, tk) : renderMonth(hist, tk);
  const cal = document.getElementById("cal");
  cal.classList.toggle("rolling", rolling);
  cal.innerHTML = r.html;
  renderCalDetail(hist, tk);
  document.getElementById("statLabel").textContent = rolling ? "近 12 周累计" : "本月累计";
  document.getElementById("calHint").textContent = rolling
    ? "每行一周，共 12 周；虚线格是还没到的日子，不计入累计。切「本月」可看每天做了几题"
    : "虚线格是还没到的日子，不计入累计；切「近 12 周」可看跨月连续记录";
  document.getElementById("monthstat").textContent = r.q + " 题 · " + r.d + " 天有做题";
  document.getElementById("streak").textContent = "连续 " + calcStreak() + " 天";
  document.getElementById("vRolling").classList.toggle("on", rolling);
  document.getElementById("vMonth").classList.toggle("on", !rolling);
}
document.getElementById("vRolling").onclick = ()=>{ mapView = "rolling"; renderCalendar(); };
document.getElementById("vMonth").onclick   = ()=>{ mapView = "month";   renderCalendar(); };
function syncAuto(){
  const on = S.autoNext !== false;
  const b = document.getElementById("autoBtn");
  b.textContent = on ? "开" : "关";
  b.classList.toggle("on", on);
}
function syncSfx(){
  const s = S.sfx || {on:true, vol:0.45};
  const vol = s.vol == null ? 0.45 : +s.vol;
  const on = s.on !== false && vol > 0.001;   // 音量为 0 时不算「开」
  const b = document.getElementById("sfxBtn");
  b.textContent = on ? "开" : "关";
  b.classList.toggle("on", on);
  document.getElementById("sfxVol").value = Math.round(vol * 100);
}
function syncDaily(){
  document.getElementById("rowCount").style.display = S.dailyMode==="count" ? "flex" : "none";
  document.getElementById("rowTime").style.display = S.dailyMode==="time" ? "flex" : "none";
  document.getElementById("mFree").classList.toggle("on", S.dailyMode==="free");
  document.getElementById("mCount").classList.toggle("on", S.dailyMode==="count");
  document.getElementById("mTime").classList.toggle("on", S.dailyMode==="time");
  const nc = document.getElementById("numCount"), nm = document.getElementById("numMin");
  // 先夹到合法值再回填；旧版把非法值塞给输入框后 value 变 ""，反向读回就成了 0
  S.dailyCount = clampCount(S.dailyCount);
  S.dailyMin = clampMin(S.dailyMin);
  nc.value = S.dailyCount;
  if(nm) nm.value = S.dailyMin;
  document.querySelectorAll("#rowCount .chip").forEach(c => c.classList.toggle("on", +c.dataset.n === S.dailyCount));
  document.querySelectorAll("#rowTime .chip").forEach(c => c.classList.toggle("on", +c.dataset.min === S.dailyMin));
}
document.getElementById("mFree").onclick = ()=>{ S.dailyMode="free"; save(); renderHome(); };
document.getElementById("mCount").onclick = ()=>{ S.dailyMode="count"; save(); renderHome(); };
document.getElementById("mTime").onclick = ()=>{ S.dailyMode="time"; save(); renderHome(); };
document.getElementById("numCount").onchange = (e)=>{
  S.dailyCount = clampCount(e.target.value); save(); renderHome();
};
document.querySelectorAll("#rowCount .chip").forEach(c=>{
  c.onclick = ()=>{ S.dailyCount = clampCount(c.dataset.n); save(); renderHome(); };
});
document.getElementById("numMin").onchange = (e)=>{
  const v = e.target.value;
  // 清空输入框时不改成 1 分钟（一删就跳值很难受），保留原值并回填
  S.dailyMin = String(v).trim() === "" ? S.dailyMin : clampMin(v);
  save(); renderHome();
};
document.querySelectorAll("#rowTime .chip").forEach(c=>{
  c.onclick = ()=>{ S.dailyMin = clampMin(c.dataset.min); save(); renderHome(); };
});
document.getElementById("autoBtn").onclick = ()=>{
  S.autoNext = (S.autoNext === false);   // 取反
  save(); renderHome();
};

document.getElementById("sfxBtn").onclick = ()=>{
  S.sfx = S.sfx || {on:true, vol:0.45};
  S.sfx.on = !S.sfx.on; save(); renderHome();
  if(S.sfx.on && (S.sfx.vol == null ? 0.45 : +S.sfx.vol) > 0.001) SFX.stone();
};
document.getElementById("sfxVol").oninput = (e)=>{
  S.sfx = S.sfx || {on:true, vol:0.45};
  S.sfx.vol = Math.max(0, Math.min(100, +e.target.value)) / 100;
  syncSfx();
};
document.getElementById("sfxVol").onchange = ()=>{ save(); SFX.stone(); };
document.getElementById("nextpass").onclick = ()=>{
  const st = lvSt(S.lv);
  if(st.pass >= 10){ alert("这一级 10 轮已走完，本级毕业 🎉"); return; }
  // 本轮已经全部做完，进下一轮不会丢任何东西，直接推进，不再弹确认框
  st.pass++; st.done = {}; clearSess(); save(); renderHome();
};
/* ---------- 换设备：只搬「能接着做题」的核心进度 ----------
 * 默认传：档案名、今天已练时间、轮数、做过哪些题、待重做、模式与时长设置
 * 可选传：错题记录、活跃地图（默认不勾，守住精简口径）
 * 不传：首答记录 q、会话快照 sess、音效设置 sfx
 * 今天压成 t:[日期,题数,秒数]，只在同一天生效、按 max 合并，重复扫码不会虚增。
 * 活跃地图压成 m:[末日, 每字符代表一天的 base36 串]，比 {"日期":题数} 小一个数量级。 */
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
/* 活跃地图：最近 180 天，一个字符代表一天做了几题（0-9a-z，0 = 没记录）。
 * 每天 5–15 分钟很难超过 35 题，超出按 35 封顶；地图只表示活跃度，不参与判题。 */
const MAP_MAX_DAYS = 180;
function shiftDay(dstr, delta){
  const p = String(dstr).split("-").map(Number);
  if(p.length !== 3 || p.some(x=>!Number.isFinite(x))) return dstr;
  const d = new Date(p[0], p[1]-1, p[2] + delta);
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function packMap(){
  const h = S.history || {}, end = today(), days = [];
  for(let i=MAP_MAX_DAYS-1;i>=0;i--){
    const v = +(h[shiftDay(end,-i)] || 0);
    days.push(Number.isFinite(v) ? Math.min(35, Math.max(0, v)) : 0);
  }
  let first = 0;
  while(first < days.length && !days[first]) first++;   // 前面连续没记录的天不用传
  if(first >= days.length) return null;
  return [end, days.slice(first).map(v=>v.toString(36)).join("")];
}
function unpackMap(m){
  const out = {};
  if(!Array.isArray(m) || typeof m[0] !== "string" || typeof m[1] !== "string") return out;
  const end = m[0], s = m[1];
  for(let i=0;i<s.length && i<MAP_MAX_DAYS;i++){
    const v = parseInt(s[i], 36);
    if(!Number.isFinite(v) || v <= 0) continue;
    out[shiftDay(end, -(s.length-1-i))] = v;
  }
  return out;
}

/** 名字来自另一台设备的二维码，按不可信输入处理：去控制字符、限长 16 字 */
function cleanName(s){
  return Array.from(String(s || "").replace(/[<>]/g, "").replace(/\s+/g, " "))
              .slice(0, 16).join("").trim();
}
/** 本机当前档是不是「刚装好、还没动过」？只有这种档才允许被导入时直接改名 */
function blankProfile(){
  if(!/^(孩子 \d+|1 号)$/.test(pname(PID))) return false;
  if(S.sess) return false;
  if(S.today && ((S.today.n || 0) || (S.today.sec || 0))) return false;
  const st = S.st || {};
  return !Object.keys(st).some(k => Object.keys((st[k] || {}).done || {}).length);
}
function makePortable(withWrong, withMap){
  const t = (S.today && S.today.d === today()) ? S.today : {n:0, sec:0};
  const o = {v:3, kind:"portable", at:Date.now(), nm:cleanName(pname(PID)),
             lv:S.lv, mode:S.mode,
             dailyMode:S.dailyMode, dailyCount:S.dailyCount, dailyMin:S.dailyMin,
             t:[today(), t.n || 0, t.sec || 0],
             st:packSt(), retry:packIdx(S.retry)};
  if(withMap){ const m = packMap(); if(m) o.m = m; }
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
  S.dailyCount = clampCount(o.dailyCount);
  S.dailyMin = clampMin(o.dailyMin);
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
  // 今天已练时间/题数：只认同一天的码，按 max 合并 —— 换设备能接着倒计时，重复扫码也不会虚增
  if(Array.isArray(o.t) && o.t[0] === today()){
    if(!S.today || S.today.d !== today()) S.today = {d: today(), n:0, sec:0};
    S.today.n   = Math.max((+S.today.n || 0), (+o.t[1] || 0));
    S.today.sec = Math.max((+S.today.sec || 0), (+o.t[2] || 0));
  }
  // 活跃地图：按日期取较大值补齐，老记录不丢、重复导入幂等
  if(o.m){
    const m = unpackMap(o.m);
    if(!S.history) S.history = {};
    Object.keys(m).forEach(d=>{ S.history[d] = Math.max((+S.history[d] || 0), m[d]); });
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
/** 把进度码画成二维码。
 *  网页版塞「带 hash 的 URL」，另一台扫了直接打开本页自动导入；
 *  单文件版是 file://，拼出来的只会是本机磁盘路径，改成塞「纯进度码」，
 *  另一台用「扫码导入」对准即可（pickCode 两种格式都认）。 */
function showQr(code){
  const box = document.getElementById("qrBox");
  const tip = document.getElementById("qrHint");
  if(!box) return "no-box";
  const hideAll = ()=>{ box.classList.add("hide"); if(tip) tip.classList.add("hide"); };
  if(typeof qrcode !== "function"){ hideAll(); return "no-lib"; }
  const safe = code.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const web = !location.protocol || /^https?:$/.test(location.protocol);
  const content = web ? (location.origin + location.pathname + "#p=" + safe) : code;
  try{
    const qr = qrcode(0, "M");
    qr.addData(content);
    qr.make();
    box.innerHTML = qr.createSvgTag(4, 2);
    box.classList.remove("hide");
    if(tip){
      tip.textContent = web
        ? "用另一台设备打开本页 → 点「扫码导入」对准这个码"
        : "这是进度码本身 · 用另一台设备的网页版点「扫码导入」对准它";
      tip.classList.remove("hide");
    }
    return "ok";
  }catch(e){ hideAll(); return "fail:" + ((e && e.message) || e); }
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
window.GOTEST = { makePortable, applyPortable, encodeCode, decodeCode, importFromCode,
                  startCustom, startCountdown, addFiveMinutes };

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
  customMode = true; clearSess();   // 重练不留旧快照，也别让下次正常练习恢复成重练队列
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
  const cap = goalOf(lv, pass);
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
  const cap = goalOf(lv, pass);
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
  const raw = (o.st || {})[o.lv];
  const pass = Array.isArray(raw) ? (raw[0] || 1) : ((raw && raw.pass) || 1);
  const src = cleanName(o.nm);              // 老进度码没带名字，就只导进度、不动名字
  const arr = profiles();
  const same = src ? arr.find(p => p.name === src) : null;
  let targetId = PID, renameTo = "", where;

  if(same && same.id !== PID){
    // 新机上已经给这个孩子建好档了：进度应该落到那一档，而不是覆盖当前别的孩子
    targetId = same.id;
    where = "本机已有「" + src + "」这一档，会存进去（替换它原来的进度）";
  } else if(src && !same && blankProfile()){
    where = "会把当前这一档改名为「" + src + "」";
    renameTo = src;
  } else {
    where = "会替换「" + pname(PID) + "」这一档的进度，档案名不变";
  }
  const bits = [];
  if(Array.isArray(o.t) && o.t[0] === today() && ((+o.t[1] || 0) > 0 || (+o.t[2] || 0) > 0))
    bits.push("今天已练 " + Math.round((+o.t[2] || 0)/60) + " 分钟");
  if(o.m) bits.push("活跃地图");
  const tail = bits.length ? bits.join("、") + "会一起带过来；首答记录保留本机，确定吗？"
                           : "首答记录保留本机，确定吗？";
  const curSt = lvSt(S.lv), curDone = Object.keys(curSt.done || {}).length;
  const localLine = "本机现在是「" + pname(PID) + "」 · " + DATA[S.lv].lb + " · 第 " +
                    curSt.pass + " 轮 · 已完成 " + curDone + " 题";
  const msg = "来自「" + (src || "另一台设备") + "」：" + lb + " · 第 " + pass + " 轮。\n" +
              localLine + "。\n" + where + "。\n" + tail;
  if(!confirm(msg)) return false;
  /* 撤销快照必须在「切到目标档案之后」再取：
   * 要恢复的是被覆盖的那一档的进度，不是发起导入那一档的。
   * 顺手记下被改名那一档的原名，撤销时一并还原（名字存在 profiles 里，不在 S 里）。 */
  importUndo = null; importUndoPid = null; importUndoName = "";
  if(targetId !== PID) switchProfile(targetId);
  importUndo = JSON.stringify(S); importUndoPid = PID;   // 单次内存态快照，不落盘
  importUndoName = renameTo ? pname(PID) : "";
  if(renameTo) renameProfile(PID, renameTo);
  applyPortable(o); renderHome();
  showUndoImport();
  return "「" + pname(PID) + "」 · " + lb + " · 第 " + pass + " 轮";
}
/* 撤销导入：仅当前页面有效；开始做题或切换档案即失效（D-02） */
let importUndo = null, importUndoPid = null, importUndoName = "";
function clearUndoImport(){
  importUndo = null; importUndoPid = null; importUndoName = "";
  const bar = document.getElementById("undoBar");
  if(bar) bar.classList.add("hide");
}
function showUndoImport(){
  const bar = document.getElementById("undoBar");
  if(bar) bar.classList.remove("hide");
}
document.getElementById("undoImport").onclick = ()=>{
  if(!importUndo) return;
  if(importUndoPid !== PID){ clearUndoImport(); alert("档案已切换，无法撤销这次导入"); return; }
  const backName = importUndoName;
  S = JSON.parse(importUndo); clearUndoImport(); save();
  if(backName && pname(PID) !== backName) renameProfile(PID, backName);   // 导入时被改名的一并还原
  renderHome();
  alert("已撤销导入，进度恢复到导入前");
};

document.getElementById("mkCode").onclick = async ()=>{
  const hint = document.getElementById("codeResult");
  try{
    const code = await encodeCode(makePortable(
      document.getElementById("withWrong").checked,
      document.getElementById("withMap").checked));
    const r = showQr(code);
    if(r === "ok"){
      hint.textContent = "已生成「" + pname(PID) + "」的进度二维码（" + code.length +
                         " 个字符）——用另一台设备点「扫码导入」对准它";
    }else if(r === "no-lib"){
      hint.textContent = "进度码已经算好了，但画二维码的组件没加载出来（多半是断网时打开的）。" +
                         "办法：刷新页面再点一次。";
    }else if(r === "no-box"){
      hint.textContent = "找不到二维码显示区，页面可能没加载完整，刷新一下再试。";
    }else{
      const why = String(r).replace(/^fail:/, "");
      const full = /overflow|too (long|big)|length/i.test(why);
      hint.textContent = full
        ? "这张码太大了，画不下（取消勾选「错题记录」「活跃地图」会短很多，再点一次）"
        : "二维码生成失败：" + why + "。刷新页面再试一次。";
    }
  }catch(e){ hint.textContent = "生成失败：" + (e.message || e); }
};

/* ---------- 扫码导入（设备自带摄像头 + jsQR 解码） ---------- */
let scanStream = null, scanRAF = 0, scanSession = 0;
/** 彻底关闭取景框（成功导入或用户取消时用）。
 *  同时把 scanSession 加一，作废「还没返回」的 getUserMedia ——
 *  否则在等相机授权时点取消，相机仍会晚一步打开、灯一直亮着，
 *  藏起来的扫描循环还可能突然弹一句「已导入」。 */
function stopScan(){
  scanSession++;
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
  const sess = scanSession;
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
  if(sess !== scanSession) return;   // 这一轮已被取消/被新一轮取代，不再续帧
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
  const mySess = ++scanSession;      // 本次扫码的会话号：取消或重开都会让它失效
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
    const st = await openCamera();
    // 等授权 / 等相机启动的这几秒里，用户可能已经点了取消（scanSession 变了）。
    // 这时必须立刻把这条流关掉，不能挂到界面上，否则相机灯一直亮。
    if(mySess !== scanSession){ try{ st.getTracks().forEach(t=>{ t.stop(); }); }catch(e){} return; }
    scanStream = st;
    const v = document.getElementById("scanVideo");
    v.srcObject = scanStream;
    await waitVideoReady(v);
    if(mySess !== scanSession){ releaseCamera(); return; }
    try{ await v.play(); }catch(e){ /* 有些安卓机 play() 会先报错，只要出画面就能解 */ }
    if(mySess !== scanSession){ releaseCamera(); return; }
    if(!v.videoWidth){
      scanFail("摄像头已打开，但拿不到画面（可能被其它 App 占用）" + diag);
      return;
    }
    hint.textContent = "对准另一台设备上的二维码";
    scanLoop();
  }catch(e){
    if(mySess !== scanSession) return;   // 已取消：别再弹一堆错误提示盖掉「已取消扫码」
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
let queue = [], cur = null, curIdx = -1, alive = [], cell = 20, ox = 0, oy = 0, ok = 0, bad = 0, answered = false, step = 0, placed = [];
/* curIdx 单独存题号，不再往 DATA 的题目对象上挂 _i 字段。
   alive = 当前仍与「已走序列」一致的正解线路候选集，跨手保持（见 branchStep）。 */
let timeUp = false, tickId = null, remaining = 0, running = false, lastTick = 0;
let sessSec = 0, secTick = null, paused = false;   // 本次实际做题秒数（整数秒，暂停时不计）
let sessLast = 0, secCarry = 0, hiddenPause = false; // 时间戳基准 / 不足1秒零头 / 是否因切后台自动暂停
let autoTimer = null;                              // 答对后自动进下一题的定时器
let lockUntil = 0, coolTimer = null;               // 答错后的棋盘冷却：期间点击直接忽略，把「错了就立刻换点再试」的反射打断
let t0 = 0, firstJudged = false, sessN = 0, requeued = {};
let wrongThisQ = 0;   // 本题这一遍错了几次（进下一题归零）。错到 3 次才做对，基本是试出来的，要收进错题集
let customMode = false;                            // 当前是不是错题重练（快照要打标记，别被正常练习恢复）
let lastCapCount = 0;                              // 最后一手吃了几子（吃子那手多留时间看清棋形）

function stopTimer(){ if(tickId){ clearInterval(tickId); tickId = null; } }
/** 把「上次结算到现在」的可见时长结进 sessSec。
 *  用时间戳差值而不是数定时器次数：切后台会先结算再停，回来重置基准，
 *  后台节流 / 设备休眠都不会把十几分钟算进来。单次最多 5 秒，与倒计时 tick 同思路。
 *  不足 1 秒的零头留在 secCarry，sessSec 始终是整数秒，原有显示与存档逻辑不用改。 */
function settleSec(){
  if(paused || !sessLast) return;
  const now = Date.now();
  const d = Math.min(5000, Math.max(0, now - sessLast));
  secCarry += d;
  const add = Math.floor(secCarry / 1000);
  if(add){ sessSec += add; secCarry -= add * 1000; }
  sessLast = now;               // 基准取同一个时刻，避免毫秒级漂移
}
function stopSecClock(){
  if(secTick) clearInterval(secTick);
  secTick = null;       // 无条件标记「已停」，不依赖 interval 返回值的真假
  settleSec();          // 停之前把最后一段零头结掉
  sessLast = 0;         // 0 = 已停，后台期间不再累计
}
function startSecClock(init){
  stopSecClock();                        // 先结掉并停掉旧时钟
  sessSec = init || 0; secCarry = 0;
  paused = false; hiddenPause = false;
  sessLast = Date.now();
  secTick = setInterval(()=>{ if(!paused && !timeUp) settleSec(); }, 1000);
}
/** 只暂停 / 恢复秒表，与「有没有倒计时」(running) 解耦。
 *  auto=true 表示切后台自动暂停，回到前台会自动续上，不弹遮罩也不要求点「继续」。 */
function pauseSec(auto){
  if(paused || timeUp) return;
  stopSecClock(); paused = true;
  if(auto) hiddenPause = true;
}
function resumeSec(){
  if(!paused || timeUp) return;
  paused = false; hiddenPause = false;
  sessLast = Date.now();
  if(!secTick) secTick = setInterval(()=>{ if(!paused && !timeUp) settleSec(); }, 1000);
}
/** 把「这次做到哪儿了」存下来。只在题与题之间存，恢复时当前题从头开始。 */
function saveSess(){
  if(!cur) return;
  S.sess = { day: today(), at: Date.now(), lv: S.lv, pass: lvSt(S.lv).pass, mode: S.dailyMode,
             left: remaining, queue: queue.slice(), cur: curIdx,
             done: sessN, sec: sessSec, custom: customMode };
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
  if(s.custom) return null;            // 错题重练的队列不能当成正常练习接着做
  return s;
}

function endSession(){
  if(S.today.d !== today()) S.today = {d: today(), n: 0, sec: 0};
  if(sessSec > 0){ S.today.sec = (S.today.sec || 0) + sessSec; sessSec = 0; }
  secCarry = 0;
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
      remaining > 0 ? ("剩余 " + m + ":" + String(s).padStart(2,"0")) : "0:00";
  if(remaining <= 0 && !timeUp){
    timeUp = true; running = false; stopTimer(); stopSecClock(); queue = []; endSession(); clearSess(); SFX.timeup();
    flashBoard("时间到", "点返回看进度 · 或再来 5 分钟");
    document.getElementById("pause").classList.add("hide");
    document.getElementById("addTime").classList.remove("hide");
    document.getElementById("fb").className = "fb";
    document.getElementById("fb").textContent = "时间到，这轮就到这儿" +
        ((S.today.sec || 0) >= S.dailyMin*60 ? "（今天的 " + S.dailyMin + " 分钟够了）" : "");
  }
}

/** 棋盘中央闪一次大字（时间到 / 本次做完共用）。
    不挡点击、也不遮棋盘——时间到之后孩子还得把手上这题做完。
    tone="ok" 用绿色，否则用红色。 */
function flashBoard(main, sub, tone){
  const m = document.getElementById("endMask");
  if(!m) return;
  const b = document.getElementById("endMaskMain");
  const s = document.getElementById("endMaskSub");
  if(b) b.textContent = main;
  if(s) s.textContent = sub || "";
  m.classList.remove("show");
  m.classList.remove("ok");
  void m.offsetWidth;                    // 强制重排，让动画能重放（加时后再次超时用得上）
  if(tone === "ok") m.classList.add("ok");
  m.classList.add("show");
}

/** 收掉棋盘中央的结束大字（重新开题 / 加时 / 返回首页时用） */
function hideEndMask(){
  const m = document.getElementById("endMask");
  if(m) m.classList.remove("show");
}

/** 时间到之后加时：再给 5 分钟，不占每日额度，队列按剩余未做题重建 */
function addFiveMinutes(){
  if(!timeUp) return;
  timeUp = false; paused = false;
  hideEndMask();                         // 加时了就别再挂着「时间到」
  document.getElementById("addTime").classList.add("hide");
  document.getElementById("pauseMask").classList.add("hide");
  document.getElementById("pause").classList.remove("hide");
  document.getElementById("pause").textContent = "暂停";
  const st = lvSt(S.lv);
  requeued = {};                    // 队列重建了，之前「本会话已重排」的标记要一并清掉
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
function setTypesDisabled(on){
  document.querySelectorAll("#types button").forEach(b=>{ b.disabled = on; });
}
function pauseSession(){
  if(!running || timeUp) return;
  running = false; stopTimer();
  pauseSec(false);                 // 秒表一并结算并停，不再直接改 paused
  saveSess();
  setTypesDisabled(true);          // 暂停时错因区不可点（A-14）
  document.getElementById("pause").textContent = "继续";
  document.getElementById("pauseMask").classList.remove("hide");
}
function resumeSession(){
  if(timeUp || running) return;
  running = true; lastTick = Date.now();
  stopTimer(); tickId = setInterval(tick, 250);
  resumeSec();                     // 秒表恢复
  setTypesDisabled(false);
  document.getElementById("pause").textContent = "暂停";
  document.getElementById("pauseMask").classList.add("hide");
}
document.getElementById("start").onclick = ()=>{
  SFX.unlock();
  const st = lvSt(S.lv);
  const all = planList(S.lv).filter(k => !st.done[k]);
  const snap = validSess();

  customMode = false;
  ok = 0; bad = 0; sessN = 0; timeUp = false; requeued = {}; stopTimer();
  running = false; remaining = 0;
  document.getElementById("clock").textContent = "";
  document.getElementById("pauseMask").classList.add("hide");
  document.getElementById("addTime").classList.add("hide");
  document.getElementById("pause").classList.remove("hide");
  document.getElementById("pause").textContent = "暂停";
  // 只有限时模式才显示暂停按钮
  document.getElementById("pause").classList.toggle("hide", S.dailyMode !== "time");

  let initSec = 0, roundMin = S.dailyMin;   // 本轮实际拿到多少分钟（今天已做过一部分时，会小于设置值）
  if(snap){
    // 接着上次被打断的那次：题目从当前题起，剩余时间也接上
    queue = snap.queue.slice();
    if(snap.cur !== null && snap.cur !== undefined) queue.unshift(snap.cur);
    sessN = snap.done || 0; ok = sessN;
    initSec = snap.sec || 0;
    if(S.dailyMode === "time"){
      // 上限：今天还有额度就用额度，已经做够就按设定时长（别再写死成 1 分钟/5 分钟）
      const rest = S.dailyMin*60 - (S.today.sec || 0);
      const capSec = rest > 0 ? rest : S.dailyMin*60;
      const ms = Math.max(60000, Math.min(snap.left || 0, capSec*1000));
      roundMin = Math.round(ms / 60000);
      startCountdown(ms);
    }
  } else if(S.dailyMode === "count"){
    queue = all.slice(0, S.dailyCount);
  } else if(S.dailyMode === "time"){
    queue = all.slice();
    // 倒计时接续"今天还剩多少分钟"，而不是每次都从满额重来
    const targetSec = S.dailyMin * 60;
    const doneSec = (S.today.d === today() ? (S.today.sec || 0) : 0);
    let leftSec = targetSec - doneSec;
    // 今天已经做够：按"设定时长"再给一轮，不要硬塞 5 分钟
    // （以前写死 300，设 1 分钟的人做完一轮再开始就会被塞成 5 分钟，看着像设置被改了）
    if(leftSec <= 0) leftSec = targetSec;
    if(leftSec < 60) leftSec = 60;       // 至少 1 分钟，免得一进来就"时间到"
    roundMin = Math.round(leftSec / 60);
    startCountdown(leftSec * 1000);
  } else {
    queue = all.slice();          // 自由模式：不限量，做到点返回
  }
  startSecClock(initSec);

  const st2 = lvSt(S.lv);
  document.getElementById("phead").textContent =
      DATA[S.lv].lb + " · 第 " + st2.pass + " 轮 · " +
      // 限时模式要报"本轮实际拿到的分钟数"，不是设置值：今天做过一部分时这轮可能只有 5 分钟，
      // 若照抄设置里的 15，用户会以为"明明 15 分钟怎么 5 分钟就结束"。
      (S.dailyMode==="free" ? "自由" : (S.dailyMode==="count" ? S.dailyCount+" 题" : roundMin+" 分钟")) +
      (snap ? " · 接着上次" : "");
  document.getElementById("home").classList.add("hide");
  document.getElementById("play").classList.remove("hide");
  nextQ();
};
document.getElementById("quit").onclick = ()=>{
  clearTimeout(autoTimer); autoTimer = null;
  stopTimer(); stopSecClock(); endSession(); clearSess();
  SFX.cancel();                     // 掐掉还没响的延时音效，退出后不该再冒出"叮"
  // 返回首页＝这次做题结束，把所有"做题态"收干净。
  // 光藏起 #play 不够：暂停态、时间到态、冷却定时器、禁用的错因区都会留到下一局，
  // 尤其 setTypesDisabled(true) 之后只有「继续」会解禁，走返回就会让错因按钮一直点不动。
  paused = false; hiddenPause = false; timeUp = false;
  wrongThisQ = 0;
  resetCool();
  setTypesDisabled(false);
  document.getElementById("types").classList.add("hide");
  document.getElementById("nextAfterWrong").classList.add("hide");
  document.getElementById("pauseMask").classList.add("hide");
  hideEndMask();
  document.getElementById("clock").textContent = "";
  document.getElementById("addTime").classList.add("hide");
  document.getElementById("pause").textContent = "暂停";
  document.getElementById("play").classList.add("hide");
  document.getElementById("home").classList.remove("hide");
  renderHome();
};
/** 答对后自动进下一题；多步题多给一点时间看清整块棋形 */
function scheduleAutoNext(){
  clearTimeout(autoTimer); autoTimer = null;
  if(S.autoNext === false) return;
  const n = Math.max(1, step);       // 按实际走过的手数停留，短线路不再按第一条长线路多等
  let delay = Math.min(1800, 900 + 150 * (n - 1));     // 单步 900ms，9 手封顶 1800ms
  if(lastCapCount > 0) delay = Math.min(2600, delay + 700);  // 刚吃了子，多留一会儿看清空出来的点
  autoTimer = setTimeout(()=>{ if(answered && !paused && !timeUp) nextQ(); }, delay);
}

function nextQ(){
  clearTimeout(autoTimer); autoTimer = null;
  document.getElementById("nextAfterWrong").classList.add("hide");
  if(timeUp){ document.getElementById("fb").className="fb";
              document.getElementById("fb").textContent="时间到，点右上「返回」看今天的进度"; return; }
  // 旧存档 / 换设备导入的错题号可能超出当前题库，逐条跳过，别让 cur 变成 undefined 崩掉整页
  let idx = null;
  while(queue.length){
    const k = queue.shift();
    if(Number.isInteger(k) && k >= 0 && k < DATA[S.lv].p.length){ idx = k; break; }
  }
  if(idx === null){
    // 队列做完：把本次实际做题秒数结进今日，别让秒表在「本次做完啦」页面上继续空转
    stopSecClock(); endSession();
    SFX.done(); clearSess();
    // 务必收掉残留的错因按钮：题已经做完了，这时点「没数清气」会给已完成的题写错因、
    // 还会把它拉进待重做队列（curIdx 仍停在最后一题）。
    document.getElementById("types").classList.add("hide");
    document.getElementById("nextAfterWrong").classList.add("hide");
    document.getElementById("fb").textContent = "本次做完啦，回去看进度";
    document.getElementById("fb").className="fb ok";
    flashBoard("做完啦", "点右上「返回」看今天的进度", "ok");
    return;
  }
  resetCool();                                 // 冷却不能跨题残留
  hideEndMask();                               // 有新题了，把上一轮的「时间到 / 做完啦」收掉
  wrongThisQ = 0;
  cur = DATA[S.lv].p[idx]; curIdx = idx; answered = false; step = 0; placed = [];
  // 候选线路跨手保持：原题库用 (20,20) 分隔的是同一棵解答树上的分支，
  // 分叉点几乎都在黑手，白棋应手在分叉前一致；不能每手重新去 qa 里取第一个命中项
  alive = (cur.qa && cur.qa.length) ? cur.qa.slice() : [cur.q || []];
  firstJudged = false; t0 = Date.now(); lastCapCount = 0;
  document.getElementById("iq").textContent = "第 " + (idx+1) + " 题";
  document.getElementById("ir").textContent = ok;
  document.getElementById("iw").textContent = bad;
  document.getElementById("fb").textContent = cur.t || "请落子";
  document.getElementById("fb").className = "fb";
  document.getElementById("types").classList.add("hide");
  setTypesDisabled(false);                     // 新题开放错因区（上一局若停在暂停态可能还锁着）
  draw();
  saveSess();
}
/* ---------- 自动提子 ----------
 * 题库里约一半的答案会吃子：全库 7356 条答案分支中有 3444 条、共应提掉 11017 子。
 * 旧版只是把「初始棋子 + 已落子」照单全画，被吃的子一直留在盘上，孩子看到的是错棋形。
 * 这里按落子顺序重建盘面，每手之后按围棋规则提掉无气的对方棋块。
 * 初始盘面原样保留（那就是题面），只处理落子带来的变化；答案序列经全库校验无自杀手。 */
const NB = 19, DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
function inBoard(r,c){ return r>=0 && r<NB && c>=0 && c<NB; }
/** 找 (r,c) 所在同色棋块，返回棋子坐标列表和气的数目 */
function groupInfo(b, r, c, col){
  const stones = [], seen = new Set(), libs = new Set(), stack = [[r,c]];
  while(stack.length){
    const [y,x] = stack.pop(), k = y*NB+x;
    if(seen.has(k)) continue;
    seen.add(k); stones.push([y,x]);
    DIRS.forEach(d=>{
      const ny = y+d[0], nx = x+d[1];
      if(!inBoard(ny,nx)) return;
      const v = b[ny][nx];
      if(v === 0) libs.add(ny*NB+nx);
      else if(v === col && !seen.has(ny*NB+nx)) stack.push([ny,nx]);
    });
  }
  return { stones, libs: libs.size };
}
/** 落子后提掉四邻中已无气的对方棋块，返回提子数。
 *  自杀手不自行移除（题库不会出现，保留可见比莫名少子更友好）。 */
function captureAfter(b, r, c, col){
  const opp = col === 1 ? 2 : 1, checked = new Set();
  let n = 0;
  DIRS.forEach(d=>{
    const y = r+d[0], x = c+d[1], k = y*NB+x;
    if(!inBoard(y,x) || b[y][x] !== opp || checked.has(k)) return;
    const g = groupInfo(b, y, x, opp);
    g.stones.forEach(p=>checked.add(p[0]*NB+p[1]));
    if(g.libs === 0) g.stones.forEach(p=>{ b[p[0]][p[1]] = 0; n++; });
  });
  return n;
}
/** 由题面 + 已落子序列重建当前盘面；capLog[i] 记第 i 手提掉了几子 */
function playBoard(){
  const b = Array.from({length:NB}, ()=>new Array(NB).fill(0));
  (cur.s || []).forEach(p=>{ if(inBoard(p[0],p[1])) b[p[0]][p[1]] = p[2]; });
  const capLog = [];
  (placed || []).forEach(p=>{
    if(!inBoard(p[0],p[1])){ capLog.push(0); return; }
    b[p[0]][p[1]] = p[2];
    capLog.push(captureAfter(b, p[0], p[1], p[2]));
  });
  return { board:b, capLog };
}

/** from = 本次点击开始落子前的 placed 长度；只统计这一次新落的手数造成的提子 */
function draw(from){
  const pb = playBoard(), board = pb.board;
  const caps = pb.capLog.slice(Math.max(0, from || 0)).reduce((a,b)=>a+b, 0);
  const s = cur.s, svg = document.getElementById("svg");
  let r0 = 18, r1 = 0, c0 = 18, c1 = 0;
  s.forEach(p=>{ r0=Math.min(r0,p[0]); r1=Math.max(r1,p[0]); c0=Math.min(c0,p[1]); c1=Math.max(c1,p[1]); });
  if(cur.q) cur.q.forEach(p=>{ r0=Math.min(r0,p[0]); r1=Math.max(r1,p[0]); c0=Math.min(c0,p[1]); c1=Math.max(c1,p[1]); });
  // 多分支题：所有分支都要进视野，否则第二条线路会落在框外
  if(cur.qa) cur.qa.forEach(b=>b.forEach(p=>{ r0=Math.min(r0,p[0]); r1=Math.max(r1,p[0]); c0=Math.min(c0,p[1]); c1=Math.max(c1,p[1]); }));
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
  for(let r=0;r<NB;r++) for(let c=0;c<NB;c++){
    const v = board[r][c];
    if(!v || r<r0 || r>r1 || c<c0 || c>c1) continue;
    const x = PAD+(c-c0)*cell, y = PAD+(r-r0)*cell, rad = cell*0.46;
    g += v===1
      ? `<circle cx="${x}" cy="${y}" r="${rad}" fill="#1a1a1a"/>`
      : `<circle cx="${x}" cy="${y}" r="${rad}" fill="#fbfbfb" stroke="#333" stroke-width="1"/>`;
  }
  // 错点/正解标记放在棋子之上，一定看得见
  g += `<g id="marks"></g>`;
  svg.innerHTML = g;
  svg.onclick = onTap;
  svg._c0 = c0; svg._r0 = r0;
  return caps;
}
function solved(capText){
  answered = true; ok++; sessN++; SFX.ok();
  const st = lvSt(S.lv);
  // 错题重练可能带来超出本轮目标的题号，别写成「幽灵完成记录」让首页完成数虚高
  if(curIdx < goalOf(S.lv, st.pass) && !st.done[curIdx]) st.done[curIdx] = 1;
  const r = qRec(S.lv, curIdx);
  r[3] = today();
  if(S.retry[S.lv]) delete S.retry[S.lv][curIdx];
  // 错 3 次以上才做对＝基本是试出来的，做对也收进错题集、稍后重练一遍。
  // 不覆盖已有的具体错因（原来选过"气数"就还是"气数"），只补"试错 N 次"。
  if(wrongThisQ >= 3){
    if(!S.wrong[S.lv]) S.wrong[S.lv] = {};
    if(!S.wrong[S.lv][curIdx]) S.wrong[S.lv][curIdx] = "试错 " + wrongThisQ + " 次";
    if(!S.retry[S.lv]) S.retry[S.lv] = {};
    S.retry[S.lv][curIdx] = 1;
  }
  markDone();
  document.getElementById("ir").textContent = ok;
  if(timeUp){
    // 时间到后做完手上这题：直接给收工引导，不再被「正确 ✔」覆盖（A-15）
    document.getElementById("fb").className = "fb";
    document.getElementById("fb").textContent = "正确 ✔ · 今天到这儿，点右上「返回」看今天的进度";
  } else {
    document.getElementById("fb").className = "fb ok";
    document.getElementById("fb").textContent = "正确 ✔" + (capText || "") +
        (S.autoNext === false ? " 点棋盘继续下一题" : "");
  }
  scheduleAutoNext();
  save();
}
/* 判题纯逻辑，不碰 DOM，供 _smoke.js 直接做全库回归。
 * lines = 当前仍匹配的正解线路候选集；step = 答案序列指针（恒为偶数，指向孩子要点的黑手）。
 * 收敛后返回：alive（空 = 判错）、white（自动补的白子，可能为 null）、
 *            step（推进后的指针）、done（是否已走完某条完整线路）。
 * 短线路「一步到位」也是题库里的合法正解，所以 done 用 some 而不是取某一条的长度。 */
function branchStep(lines, step, r, c){
  const alive = lines.filter(b => { const p = b[step]; return p && p[0] === r && p[1] === c; });
  if(!alive.length) return {alive, hit:false, white:null, step, done:false};
  const line = alive[0];
  let s = step + 1;                                   // 黑手落下
  const white = s < line.length ? line[s] : null;     // 白棋应手取自收敛后的线路
  if(white) s++;
  return {alive, hit:true, white, step:s,
          done: alive.some(b => s >= b.length)};
}
/* 答错后让棋盘安静一会儿。
   一题的可点范围通常只有十几二十个交叉点，"点错→立刻换一个点再点"几十秒就能穷举出正解，
   短暂冷却把这条反射打断，让孩子先想一下再动手。
   冷却期内的点击直接丢弃：不计错，也不会延长冷却（免得越点越久像惩罚）。 */
function coolDown(ms){
  lockUntil = Date.now() + ms;
  const svg = document.getElementById("svg");
  if(svg) svg.classList.add("cool");
  clearTimeout(coolTimer);
  coolTimer = setTimeout(function(){
    const s = document.getElementById("svg");
    if(s) s.classList.remove("cool");
    lockUntil = 0;
  }, ms);
}
/** 进下一题/重开一局时把冷却彻底清掉，别让上一题的错误把新题也锁住 */
function resetCool(){
  clearTimeout(coolTimer); coolTimer = null; lockUntil = 0;
  const svg = document.getElementById("svg");
  if(svg) svg.classList.remove("cool");
}
function onTap(e){
  if(paused) return;                                                    // 已暂停，棋盘不响应
  if(timeUp) return;                                                    // 时间到就是结束了：只能「返回」或「再来 5 分钟」
  if(answered) { clearTimeout(autoTimer); autoTimer = null; nextQ(); return; }
  if(Date.now() < lockUntil) return;                                    // 答错冷却中：忽略，不计错也不延长
  const el = e.currentTarget, rect = el.getBoundingClientRect(), vb = el.viewBox.baseVal;
  const px = (e.clientX - rect.left) / rect.width * vb.width;
  const py = (e.clientY - rect.top) / rect.height * vb.height;
  const c = Math.round((px - ox) / cell), r = Math.round((py - oy) / cell);
  const rr = r + el._r0, cc = c + el._c0;
  if(rr<0||rr>18||cc<0||cc>18) return;
  // 在「还活着的线路」里按本手收敛，而不是每手重新去 qa 里取第一个命中项
  const j = branchStep(alive, step, rr, cc);
  const hit = j.hit;

  // 首答判定：只认本会话的第一手。这是"重新算对"和"记得上次点这里"的唯一分界
  if(!firstJudged && alive.length && alive[0].length){
    firstJudged = true;
    const rec = qRec(S.lv, curIdx);
    if(rec[0] === null){ rec[0] = hit ? 1 : 0; rec[2] = Date.now() - t0; save(); }
  }

  if(hit){
    alive = j.alive;
    const from = placed.length;
    placed.push([rr, cc, 1]); SFX.stone();
    if(j.white){ placed.push([j.white[0], j.white[1], 2]); setTimeout(()=>SFX.white(), 130); }
    step = j.step;
    // 重画时按规则提子；只把「这一次点击新落的手」吃到的子报出来
    const caps = draw(from);
    lastCapCount = caps;
    if(caps) SFX.capture();
    const capText = caps ? "，提掉 " + caps + " 子" : "";
    if(j.done) solved(capText);
    else {
      document.getElementById("fb").className = "fb ok";
      document.getElementById("fb").textContent = "对，白棋应了一手" + capText + "，继续把这一局走完";
    }
  } else {
    const rec = qRec(S.lv, curIdx);
    bad++;
    rec[1]++;
    wrongThisQ++;
    save();
    SFX.wrong();                                 // 一声轻闷提示：确认"这一手没走对"
    document.getElementById("iw").textContent = bad;
    const marks = document.getElementById("marks");
    const x = ox + c*cell, y = oy + r*cell;
    marks.innerHTML = `<circle cx="${x}" cy="${y}" r="${cell*0.46}" fill="#1a1a1a" opacity=".5"/>`;
    document.getElementById("fb").className = "fb no";
    document.getElementById("fb").textContent = "不对，再想想（实在想不出，可以选错因、或直接看答案，但这题不算完成）";
    document.getElementById("types").classList.remove("hide");
    coolDown(1200);                              // 先停一下：别让孩子点了错就换一个点接着试
  }
}
/** 看正解：错因按钮和「实在想不出」共用同一条路径。
 *  语义统一——这题没做出来：不计完成、不计今日、不进活跃地图，转待重做，稍后还会再出现。 */
function revealAnswer(reason){
  if(paused) return;                              // 暂停时不结算
  if(answered) return;                            // 已做完/已看过答案，再点只会污染数据
  if(timeUp) return;                              // 时间到＝本轮结束
  if(!S.wrong[S.lv]) S.wrong[S.lv] = {};
  S.wrong[S.lv][curIdx] = reason || "看答案";
  if(!S.retry[S.lv]) S.retry[S.lv] = {};
  S.retry[S.lv][curIdx] = 1;
  answered = true;
  const a = (() => {
    const line = alive[0] || [];
    return line[step] || line[0];      // 当前手数的正解点；已走完则回退到首手
  })();
  if(a){
    const marks = document.getElementById("marks");
    const x = ox + (a[1]-document.getElementById("svg")._c0)*cell;
    const y = oy + (a[0]-document.getElementById("svg")._r0)*cell;
    marks.innerHTML += `<circle cx="${x}" cy="${y}" r="${cell*0.46}" fill="none" stroke="#c0392b" stroke-width="3"/>`;
  }
  // 本会话内再出现一次（只重排一次，避免死循环）
  if(!timeUp && !requeued[curIdx]){ requeued[curIdx] = 1; queue.push(curIdx); }
  document.getElementById("fb").textContent = (reason && reason !== "看答案")
      ? ("已记错（" + reason + "），红圈是正解。这题不算完成，稍后还会出现。点棋盘继续。")
      : "红圈是正解。这题不算完成，稍后还会出现。点棋盘继续。";
  document.getElementById("types").classList.add("hide");
  document.getElementById("nextAfterWrong").classList.remove("hide");
  save();
}
document.querySelectorAll("#types .typesRow button").forEach(b=>{
  b.onclick = ()=>{ revealAnswer(b.dataset.t); };
});
document.getElementById("revealBtn").onclick = ()=>{ revealAnswer("看答案"); };
document.getElementById("nextAfterWrong").onclick = ()=>{  document.getElementById("nextAfterWrong").classList.add("hide");
  nextQ();
};
renderHome();

/* 切换面板的开关 */
document.getElementById("whoBtn").onclick = ()=>{
  const p = document.getElementById("whoPanel");
  p.classList.toggle("hide");
};

/* 暂停/继续 + 切到后台自动暂停（孩子被叫走时不烧时间）
 * 固定时间模式沿用原有「暂停」交互（弹遮罩、回来点继续）；
 * 自由 / 固定题数 / 错题重练没有倒计时，只停秒表，回前台自动续上，避免卡死。 */
document.getElementById("pause").onclick = ()=>{
  if(running) pauseSession(); else resumeSession();
};
function onVisibility(){
  if(document.visibilityState === "hidden"){
    if(running && !timeUp){ pauseSession(); return; }   // 内部已 saveSess
    pauseSec(true); saveSess();
  } else if(hiddenPause){
    resumeSec();
  }
}
document.addEventListener("visibilitychange", onVisibility);

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
  running = false; remaining = 0;
  stopTimer(); stopSecClock();      // 先结算并停，再清零，避免残留零头串到下次会话
  sessSec = 0; secCarry = 0; sessLast = 0;
  save(); renderHome();
};
