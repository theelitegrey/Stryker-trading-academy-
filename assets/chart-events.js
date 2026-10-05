// Stryker Trading Academy — Charts: economic events, session breaks, regular-hours shading
// (ES module, charts.html only). Owner order 2026-10-06 ("Build all", Settings window stage 4).
//
//   - Economic events: USD rows from assets/econ-calendar.json (the same file the Economic
//     calendar page renders; times there are UTC). Small markers along the bottom of the price
//     pane at the release time; hover shows title, time in IST and impact. Toggles: show
//     events, High only / High + medium, show future events.
//   - Session breaks: a dotted vertical line at each session start (CME Globex 18:00 New York
//     for futures, 00:00 UTC for crypto).
//   - Regular trading hours (OUR map, below): bars outside each market's regular hours are
//     shaded with the "Electronic trading hours background" colour. The Yahoo continuous
//     series carries the full Globex tape, so this shades; it does not remove bars.
//   - Settings window: an "Events" tab.
// Prefs are kept per browser (localStorage). Education only. Not financial advice.

const PREFS_KEY = 'stryker_chart_events_prefs';
const CAL_URL = '/assets/econ-calendar.json';
const NY = 'America/New_York';
const IST = 'Asia/Kolkata';
const D = { events: true, level: 'High only', future: true, breaks: false, rthShade: false, rthColor: 'rgba(41,98,255,0.06)' };

// Regular (day) session per market, New York time, minutes from midnight.
// CME equity index futures: 09:30-16:00 (the cash session). COMEX metals 08:20-13:30,
// NYMEX energy 09:00-14:30, CBOT rates 08:20-15:00, CME FX 08:20-15:00 (CME day-session hours).
export const RTH = {
  index:  { open: 9 * 60 + 30, close: 16 * 60 },
  metals: { open: 8 * 60 + 20, close: 13 * 60 + 30 },
  energy: { open: 9 * 60,      close: 14 * 60 + 30 },
  rates:  { open: 8 * 60 + 20, close: 15 * 60 },
  fx:     { open: 8 * 60 + 20, close: 15 * 60 }
};
const ROOT_MARKET = {
  NQ: 'index', MNQ: 'index', ES: 'index', MES: 'index', YM: 'index', MYM: 'index', RTY: 'index', M2K: 'index',
  GC: 'metals', MGC: 'metals', SI: 'metals', CL: 'energy', MCL: 'energy', NG: 'energy',
  ZN: 'rates', ZB: 'rates', '6E': 'fx'
};
export function marketOf(symbol){
  const m = /([A-Z0-9]{1,4}?)1!$/.exec(String(symbol || '').split(':').pop() || '');
  return m ? ROOT_MARKET[m[1]] || null : null;
}

let WS = null;
let prefs = load();
let events = [];
function load(){ try { return Object.assign({}, D, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) { return Object.assign({}, D); } }
function save(){ try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} push(); }

// New York wall-clock minutes for an epoch ms, cached per UTC hour.
const nyCache = new Map();
let nyFmt = null;
function nyInfo(ms){
  const h = Math.floor(ms / 3600000);
  let v = nyCache.get(h);
  if (v === undefined) {
    nyFmt = nyFmt || new Intl.DateTimeFormat('en-US', { timeZone: NY, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    const p = nyFmt.formatToParts(new Date(h * 3600000));
    const g = (t) => (p.find((x) => x.type === t) || {}).value;
    v = { min: Number(g('hour')) * 60 + Number(g('minute')), dow: g('weekday') };
    if (nyCache.size > 20000) nyCache.clear();
    nyCache.set(h, v);
  }
  return { min: v.min + Math.floor((ms % 3600000) / 60000), dow: v.dow };
}

function cellOf(id){ try { return WS.cell(id); } catch (e) { return null; } }
function inner(c){ try { return c.chart.renderer.renderer; } catch (e) { return null; } }
function visibleEvents(){
  const now = Date.now();
  const lv = prefs.level === 'High + medium' ? ['high', 'medium'] : ['high'];
  return events.filter((e) => e.cur === 'USD' && lv.includes(e.impact) && (prefs.future || e.t <= now));
}
function push(){
  if (!WS) return;
  const evs = prefs.events ? visibleEvents() : [];
  for (const c of WS.context().cells || []) {
    const cell = cellOf(c.id); const R = inner(cell); if (!R || !R.setNativeData) continue;
    const market = marketOf(cell.symbol);
    const isFut = !!market;
    try {
      R.setNativeData('stk_events', { evs });
      R.setNativeData('stk_sess', { breaks: prefs.breaks, futures: isFut, rth: prefs.rthShade && market ? RTH[market] : null, color: prefs.rthColor });
    } catch (e) {}
  }
}

// Vela sizes layer canvases itself (CSS px = coords px); only clear + scale for the DPR.
function sizeCanvas(canvas, co){
  const g = canvas.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
  const dpr = co.dpr || 1; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

// Below the candles: regular-hours shading + session breaks.
function sessLayer(){
  let canvas = null;
  return {
    mount(c){ canvas = c; },
    render(a){
      if (!canvas) return;
      const co = a.coords; const g = sizeCanvas(canvas, co);
      const d = a.data; const bars = a.bars;
      if (!d || !bars || !bars.length || (!d.breaks && !d.rth)) return;
      const W = co.width, top = a.bounds.top, H = a.bounds.height;
      const half = co.pxPerBar() / 2;
      // intraday charts only
      const tf = bars.length > 1 ? bars[bars.length - 1].time - bars[bars.length - 2].time : 0;
      if (!(tf > 0 && tf < 86400000)) return;
      let runStart = null, prevX = null;
      g.save(); g.beginPath(); g.rect(0, top, W, H); g.clip();
      g.fillStyle = d.color;
      for (let i = 0; i < bars.length; i++) {
        const t = bars[i].time; const x = co.timeToX(t);
        if (x < -half * 2 || x > W + half * 2) { if (runStart != null && x > W) break; continue; }
        const ny = nyInfo(t);
        if (d.rth) {
          const out = !(ny.min >= d.rth.open && ny.min < d.rth.close);
          if (out && runStart == null) runStart = x - half;
          if (!out && runStart != null) { g.fillRect(runStart, top, (prevX + half) - runStart, H); runStart = null; }
        }
        if (d.breaks && i > 0) {
          const pt = bars[i - 1].time;
          let brk;
          if (d.futures) { const pm = nyInfo(pt).min; brk = (ny.min >= 18 * 60 && pm < 18 * 60) || (t - pt > 3 * 3600000 && ny.min >= 18 * 60); }
          else brk = Math.floor(t / 86400000) !== Math.floor(pt / 86400000);
          if (brk) {
            const bx = Math.round(x - half) + 0.5;
            g.strokeStyle = 'rgba(128,140,160,0.55)'; g.lineWidth = 1; g.setLineDash([2, 3]);
            g.beginPath(); g.moveTo(bx, top); g.lineTo(bx, top + H); g.stroke(); g.setLineDash([]);
            g.fillStyle = d.color;
          }
        }
        prevX = x;
      }
      if (d.rth && runStart != null && prevX != null) g.fillRect(runStart, top, (prevX + half) - runStart, H);
      g.restore();
    },
    destroy(){ canvas = null; }
  };
}

// Above the candles: event markers along the bottom of the price pane.
const hitBoxes = new WeakMap();   // canvas -> [{x, y, ev}]
function eventsLayer(){
  let canvas = null;
  return {
    mount(c){ canvas = c; c.dataset.stkEvents = '1'; },
    render(a){
      if (!canvas) return;
      const co = a.coords; const g = sizeCanvas(canvas, co);
      const d = a.data; const boxes = [];
      hitBoxes.set(canvas, boxes);
      if (!d || !d.evs || !d.evs.length || !a.bars || !a.bars.length) return;
      const tf = a.bars.length > 1 ? a.bars[a.bars.length - 1].time - a.bars[a.bars.length - 2].time : 0;
      if (!(tf > 0 && tf <= 86400000)) return;
      // sit just above the time axis: the pane bounds can run under it, so clamp to the plot height
      const plotBottom = Math.min(a.bounds.top + a.bounds.height, (co.dataHeight || co.height) - 2);
      const W = co.width, y = Math.min(plotBottom, (co.height || plotBottom) - 34) - 8;
      const now = Date.now();
      for (const ev of d.evs) {
        // events snap to the bar that contains them
        const t = Math.floor(ev.t / tf) * tf;
        const x = co.timeToX(t);
        if (!Number.isFinite(x) || x < 4 || x > W - 4) continue;
        const col = ev.impact === 'high' ? '#f23645' : '#ff9800';
        g.globalAlpha = ev.t > now ? 0.6 : 1;
        g.fillStyle = col; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
        g.beginPath(); g.arc(Math.round(x) + 0.5, y, 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
        boxes.push({ x, y, ev });
      }
      g.globalAlpha = 1;
    },
    destroy(){ canvas = null; }
  };
}

// Tooltip (DOM): hover near a marker.
let tip = null;
const fmtIST = new Intl.DateTimeFormat('en-GB', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function onMove(e){
  let found = null, rect = null;
  for (const cv of document.querySelectorAll('canvas[data-stk-events]')) {
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) continue;
    for (const b of hitBoxes.get(cv) || []) if (Math.abs(b.x - x) <= 7 && Math.abs(b.y - y) <= 8) { found = b; rect = r; break; }
    if (found) break;
  }
  if (!found) { if (tip) tip.hidden = true; return; }
  if (!tip) { tip = document.createElement('div'); tip.id = 'stk-ev-tip'; document.body.appendChild(tip); }
  const ev = found.ev;
  tip.innerHTML = '<b></b><span></span><em></em>';
  tip.querySelector('b').textContent = ev.title;
  tip.querySelector('span').textContent = fmtIST.format(new Date(ev.t)) + ' IST';
  tip.querySelector('em').textContent = (ev.impact === 'high' ? 'High' : 'Medium') + ' impact · USD' + (ev.t > Date.now() ? ' · upcoming' : '');
  tip.hidden = false;
  const left = Math.min(window.innerWidth - 270, Math.max(8, rect.left + found.x - 120));
  tip.style.left = left + 'px'; tip.style.top = (rect.top + found.y - 70) + 'px';
}

const CSS = `
#stk-ev-tip{ position:fixed; z-index:9050; pointer-events:none; width:max-content; max-width:260px; display:flex; flex-direction:column; gap:2px;
  background:#1a1b1f; color:#e6e7ea; border:1px solid #2e3036; border-radius:8px; padding:7px 9px; font:12px/1.35 system-ui,sans-serif; box-shadow:0 8px 24px rgba(0,0,0,.45); }
#stk-ev-tip[hidden]{ display:none; }
#stk-ev-tip span,#stk-ev-tip em{ opacity:.75; font-style:normal; }
:root[data-theme="light"] #stk-ev-tip{ background:#fff; color:#131722; border-color:#e0e3eb; }
`;

function sections(){
  const g = (k) => () => prefs[k]; const s = (k) => (v) => { prefs[k] = v; save(); };
  return [
    { title: 'Events', id: 'stk-events', placement: 'end', rows: [
      { kind: 'heading', label: 'Economic events (USD)' },
      { kind: 'toggle', label: 'Show economic events', id: 'ev-on', get: g('events'), set: s('events') },
      { kind: 'select', label: 'Impact', id: 'ev-level', options: ['High only', 'High + medium'], get: g('level'), set: s('level') },
      { kind: 'toggle', label: 'Show future events', id: 'ev-future', get: g('future'), set: s('future') },
      { kind: 'heading', label: 'Sessions' },
      { kind: 'toggle', label: 'Session breaks', id: 'ev-breaks', get: g('breaks'), set: s('breaks') },
      { kind: 'toggle', label: 'Shade outside regular trading hours (futures)', id: 'ev-rth', get: g('rthShade'), set: s('rthShade') },
      { kind: 'color', label: 'Electronic trading hours background', id: 'ev-rth-color', get: g('rthColor'), set: s('rthColor') }
    ] }
  ];
}

export function installChartEvents(Core){
  try {
    Core.registerRendererLayer({ id: 'stk_sess', placement: 'below-data', create: sessLayer });
    Core.registerRendererLayer({ id: 'stk_events', placement: 'above-data', create: eventsLayer });
  } catch (e) { console.warn('Stryker events: layers', e); }
  window.__stkExtraSections = (window.__stkExtraSections || []).concat([sections]);
}
export function mountChartEvents(ws){
  WS = ws;
  if (!document.getElementById('stk-ev-css')) { const st = document.createElement('style'); st.id = 'stk-ev-css'; st.textContent = CSS; document.head.appendChild(st); }
  fetch(CAL_URL, { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null).then((j) => {
    const list = j && Array.isArray(j.events) ? j.events : [];
    events = list.map((e) => ({ t: Date.parse(e.at), cur: e.cur, impact: e.impact, title: String(e.event || '') })).filter((e) => Number.isFinite(e.t) && e.title);
    push();
  }).catch((e) => console.warn('Stryker events: calendar', e));
  // capture phase: the chart stops pointer events from bubbling
  document.addEventListener('mousemove', onMove, { passive: true, capture: true });
  try { ws.on('state:changed', () => setTimeout(push, 0)); } catch (e) {}
  setInterval(push, 5000);
  push();
  window.__stkEvents = { get prefs(){ return prefs; }, get events(){ return events; }, setPref(k, v){ prefs[k] = v; save(); }, push, RTH, marketOf };
}
