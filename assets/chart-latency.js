// TradeZoro — Charts: connection chip + "Connection" popover (Owner order 15 Nov 2026: server latency indicator).
// Depends on: assets/chart-latency-core.js (all numbers), the Vela workspace (window.STRYKER_VELA: ws.context().cells,
// ws.active), its bottom bar (.vela-widget-bottombar), the legend data dot from assets/chart-data-dot.js (.stkc-dd:
// Live / Delayed / Closed wording is read from it, never re-decided here), assets/chart-live-resume.js (resyncAll),
// the Book panel api (window.__stkBookPanel.feedState / reconnect, assets/chart-book-panel.js), /api/ping (functions/api/ping.js).
//
// Chip (bottom-right of the chart's bottom bar): signal bars coloured by the round trip to our edge
// (green < 80 ms, amber < 200, red above, grey = no answer) + "42 ms"; a small dot breathes while candles are arriving.
// Popover (hover or click on desktop; a bottom sheet on phones): one row per real feed on screen
//   Site & API      round trip of /api/ping (every 5 s, only while the tab is visible), average + jitter over 60 s
//   each chart symbol  last update age; exchange -> you delay where the messages carry an exchange time
//                   (crypto trades; futures stream heartbeat = edge -> you); status word from the legend dot
//   Order book      when the Book panel is open: Live / Reconnecting / Market closed + last update age
// + the Cloudflare edge that answered ("Mumbai edge"), a Performance mode switch (fewer chart redraws, no animations;
// this device only, localStorage) and Reconnect (re-opens every live feed). No data = "—", nothing is ever estimated.
// No region picker: there is nothing to pick. Education only. Not financial advice.

import * as L from './chart-latency-core.js?v=1036';
import { resyncAll } from './chart-live-resume.js?v=1036';

const PERF_KEY = 'stk.perfMode';
const isPhone = () => window.innerWidth <= 599;
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function perfMode() { try { return localStorage.getItem(PERF_KEY) === '1'; } catch (e) { return false; } }
function setPerf(on) {
  try { if (on) localStorage.setItem(PERF_KEY, '1'); else localStorage.removeItem(PERF_KEY); } catch (e) {}
  document.documentElement.classList.toggle('stk-perf', !!on);
  try { window.dispatchEvent(new CustomEvent('stryker:perfmode', { detail: { on: !!on } })); } catch (e) {}
}

const CSS = `
.stklat-chip{ all:unset; box-sizing:border-box; height:26px; display:inline-flex; align-items:center; gap:6px; padding:0 10px; margin-left:4px; border-radius:13px;
  border:1px solid var(--line); color:var(--ink-1); font:500 12px/16px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif;
  font-variant-numeric:tabular-nums; cursor:pointer; white-space:nowrap; transition:background-color .15s cubic-bezier(.2,0,0,1), border-color .15s cubic-bezier(.2,0,0,1); }
.stklat-chip:hover, .stklat-chip[aria-expanded="true"]{ background:var(--bg-3); border-color:var(--line); color:var(--ink-0); }
.stklat-chip.is-float{ position:absolute; z-index:5; left:44px; margin:0; background:var(--bg-1); }
.stklat-chip[hidden]{ display:none; }
.stklat-chip:focus-visible{ outline:2px solid var(--gold); outline-offset:2px; }
.stklat-bars{ display:block; flex:none; }
.stklat-bars rect{ fill:currentColor; opacity:.22; }
.stklat-bars rect.on{ opacity:1; }
.stklat-chip[data-q="good"] .stklat-bars, .stklat-q[data-q="good"]{ color:var(--gold); }
.stklat-chip[data-q="fair"] .stklat-bars, .stklat-q[data-q="fair"]{ color:var(--amber, #e8b04a); }
.stklat-chip[data-q="poor"] .stklat-bars, .stklat-q[data-q="poor"]{ color:var(--bear, #f23645); }
.stklat-chip[data-q="none"] .stklat-bars, .stklat-q[data-q="none"]{ color:var(--ink-3); }
.stklat-pulse{ flex:none; width:6px; height:6px; border-radius:50%; background:var(--gold); opacity:0; transition:opacity .25s cubic-bezier(.2,0,0,1); }
.stklat-chip.is-live .stklat-pulse{ opacity:.9; animation:stklat-breathe 2.4s cubic-bezier(.2,0,0,1) infinite; }
@keyframes stklat-breathe{ 0%,100%{ opacity:.9; } 50%{ opacity:.3; } }
.stklat-pop{ position:fixed; z-index:9060; width:360px; max-width:calc(100vw - 16px); max-height:calc(100dvh - 96px); overflow-y:auto; overscroll-behavior:contain; box-sizing:border-box;
  padding:16px; border:1px solid var(--line); border-radius:16px; background:var(--bg-2); color:var(--ink-1);
  box-shadow:0 18px 40px -12px rgba(0,0,0,.6); font:400 13px/18px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif;
  opacity:0; transform:translateY(4px); transition:opacity .18s cubic-bezier(.2,0,0,1), transform .18s cubic-bezier(.2,0,0,1); }
.stklat-pop.is-in{ opacity:1; transform:none; }
.stklat-pop[hidden]{ display:none; }
:root[data-theme="light"] .stklat-pop{ box-shadow:0 18px 40px -16px rgba(0,0,0,.25); }
.stklat-head{ display:flex; align-items:flex-start; gap:12px; margin-bottom:12px; }
.stklat-head-t{ flex:1 1 auto; min-width:0; }
.stklat-head h2{ margin:0; font-size:17px; line-height:22px; font-weight:600; color:var(--ink-0); }
.stklat-head p{ margin:2px 0 0; font-size:12px; line-height:16px; color:var(--ink-2); }
.stklat-x{ display:none; }
.stklat-grab{ display:none; }
.stklat-row{ padding:12px; border:1px solid var(--line); border-radius:12px; background:var(--bg-1); }
.stklat-row + .stklat-row{ margin-top:8px; }
.stklat-r1{ display:flex; align-items:center; gap:8px; }
.stklat-name{ flex:1 1 auto; min-width:0; font-size:13px; line-height:18px; font-weight:500; color:var(--ink-0); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.stklat-ms{ flex:none; font-size:13px; line-height:18px; font-weight:600; color:var(--ink-0); font-variant-numeric:tabular-nums; }
.stklat-r2{ display:flex; align-items:center; gap:8px; margin-top:4px; font-size:12px; line-height:16px; color:var(--ink-2); font-variant-numeric:tabular-nums; }
.stklat-st{ display:inline-flex; align-items:center; gap:6px; }
.stklat-st i{ width:6px; height:6px; border-radius:50%; background:var(--ink-3); }
.stklat-st[data-s="ok"] i{ background:var(--gold); }
.stklat-st[data-s="warn"] i{ background:var(--amber, #e8b04a); }
.stklat-st[data-s="bad"] i{ background:var(--bear, #f23645); }
.stklat-q{ margin-left:auto; font-weight:500; }
.stklat-cap{ flex:none; font-size:11px; line-height:13px; color:var(--ink-2); }
.stklat-stats span{ white-space:nowrap; }
.stklat-stats{ display:flex; flex-wrap:wrap; gap:4px 12px; margin-top:8px; font-size:12px; line-height:16px; color:var(--ink-2); font-variant-numeric:tabular-nums; }
.stklat-stats b{ font-weight:500; color:var(--ink-1); }
.stklat-age.is-stale b{ color:var(--amber, #e8b04a); }
.stklat-spark{ display:block; width:100%; height:32px; margin-top:8px; }
.stklat-foot{ margin-top:12px; padding-top:12px; border-top:1px solid var(--line); display:flex; flex-direction:column; gap:12px; }
.stklat-perf{ display:flex; align-items:center; gap:12px; cursor:pointer; }
.stklat-perf-t{ flex:1 1 auto; min-width:0; }
.stklat-perf-t b{ display:block; font-size:13px; line-height:18px; font-weight:500; color:var(--ink-0); }
.stklat-perf-t span{ display:block; font-size:12px; line-height:16px; color:var(--ink-2); }
.stklat-sw{ appearance:none; -webkit-appearance:none; flex:none; position:relative; width:36px; height:20px; margin:0; border-radius:10px; background:var(--bg-3); border:1px solid var(--line); cursor:pointer;
  transition:background-color .18s cubic-bezier(.2,0,0,1); }
.stklat-sw::after{ content:""; position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:var(--ink-2); transition:transform .18s cubic-bezier(.2,0,0,1), background-color .18s; }
.stklat-sw:checked{ background:var(--gold); border-color:var(--gold); }
.stklat-sw:checked::after{ transform:translateX(16px); background:#fff; }
.stklat-sw:focus-visible{ outline:2px solid var(--gold); outline-offset:2px; }
.stklat-btn{ all:unset; box-sizing:border-box; height:40px; display:flex; align-items:center; justify-content:center; gap:8px; border-radius:12px; border:1px solid var(--line);
  font-size:13px; line-height:18px; font-weight:500; color:var(--ink-0); cursor:pointer; transition:background-color .15s cubic-bezier(.2,0,0,1); }
.stklat-btn:hover{ background:var(--bg-3); }
.stklat-btn:focus-visible{ outline:2px solid var(--gold); outline-offset:2px; }
.stklat-btn[disabled]{ opacity:.5; cursor:default; }
.stklat-scrim{ display:none; }
@media (max-width:599px){
  .stklat-chip{ height:24px; padding:0 8px; gap:4px; font-size:11px; }
  .stklat-scrim:not([hidden]){ display:block; position:fixed; inset:0; z-index:9059; background:rgba(0,0,0,.5); opacity:0; transition:opacity .3s cubic-bezier(.2,0,0,1); }
  .stklat-scrim.is-in{ opacity:1; }
  .stklat-pop{ left:0 !important; right:0; top:auto !important; bottom:0 !important; width:auto; max-width:none; max-height:85dvh; border:0; border-top:1px solid var(--line);
    border-radius:20px 20px 0 0; padding:20px 16px calc(16px + env(safe-area-inset-bottom)); box-shadow:0 -12px 32px rgba(0,0,0,.4);
    transform:translateY(100%); transition:transform .3s cubic-bezier(.2,0,0,1); opacity:1; font-size:15px; line-height:20px; }
  .stklat-pop.is-in{ transform:none; }
  .stklat-grab{ display:block; position:absolute; top:8px; left:50%; width:36px; height:4px; margin-left:-18px; border-radius:2px; background:var(--line); }
  .stklat-x{ all:unset; flex:none; position:relative; isolation:isolate; width:44px; height:44px; margin:-10px -10px 0 0; display:inline-flex; align-items:center; justify-content:center; color:var(--ink-2); cursor:pointer; }
  .stklat-x::before{ content:""; position:absolute; width:30px; height:30px; border-radius:50%; background:var(--bg-3); z-index:-1; }
  .stklat-x:focus-visible{ outline:2px solid var(--gold); outline-offset:-4px; border-radius:50%; }
  .stklat-btn{ height:48px; font-size:15px; }
  .stklat-perf{ min-height:48px; }
}
html.stk-perf *, html.stk-perf *::before, html.stk-perf *::after{ animation:none !important; transition:none !important; }
@media (prefers-reduced-motion:reduce){ .stklat-chip, .stklat-pop, .stklat-scrim, .stklat-sw, .stklat-sw::after{ transition:none !important; } .stklat-chip.is-live .stklat-pulse{ animation:none; } }
`;

function barsSvg(n) {
  let s = '<svg class="stklat-bars" width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">';
  for (let i = 0; i < 4; i++) { const h = 3 + i * 3; s += '<rect x="' + (i * 3.6) + '" y="' + (12 - h) + '" width="2.4" height="' + h + '" rx="1"' + (i < n ? ' class="on"' : '') + '/>'; }
  return s + '</svg>';
}

// Step line of the last 2 min on a small canvas; gaps (no sample) break the line.
function drawSpark(cv, series, t) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const css = getComputedStyle(cv);
  g.strokeStyle = css.getPropertyValue('--line').trim() || 'rgba(128,128,128,.3)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, h - 0.5); g.lineTo(w, h - 0.5); g.stroke();
  const pts = series.filter((s) => s[0] >= t - L.WINDOW_MS);
  const vals = pts.map((s) => s[1]).filter((v) => v != null);
  if (!vals.length) return;
  const max = Math.max(40, ...vals) * 1.15;
  // x spans the samples we have (30 s at least, 2 min at most), so a fresh page does not draw a sliver at the right edge
  const span = Math.min(L.WINDOW_MS, Math.max(30000, t - pts[0][0])), x0 = t - span;
  const x = (tt) => ((tt - x0) / span) * w, y = (v) => h - 2 - (v / max) * (h - 4);
  g.strokeStyle = css.color; g.lineWidth = 1.5; g.lineJoin = 'round'; g.beginPath();
  let pen = false, py = 0;
  pts.forEach((s, i) => {
    if (s[1] == null) { pen = false; return; }
    const px = x(s[0]), ny = y(s[1]);
    if (!pen) { g.moveTo(px, ny); pen = true; } else { g.lineTo(px, py); g.lineTo(px, ny); }
    py = ny;
    if (i === pts.length - 1) g.lineTo(Math.min(w, px + 2), ny);
  });
  g.stroke();
}

export function mountLatency(ws) {
  if (!ws || document.querySelector('.stklat-chip')) return null;
  if (!document.getElementById('stklat-css')) { const s = document.createElement('style'); s.id = 'stklat-css'; s.textContent = CSS; document.head.appendChild(s); }
  if (perfMode()) document.documentElement.classList.add('stk-perf');

  const chip = document.createElement('button');
  chip.type = 'button'; chip.className = 'stklat-chip'; chip.dataset.q = 'none';
  chip.setAttribute('aria-haspopup', 'dialog'); chip.setAttribute('aria-expanded', 'false'); chip.setAttribute('aria-controls', 'stklat-pop');
  chip.innerHTML = '<i class="stklat-pulse" aria-hidden="true"></i>' + barsSvg(0) + '<span class="stklat-v">—</span>';
  const pop = document.createElement('div');
  pop.id = 'stklat-pop'; pop.className = 'stklat-pop'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Connection');
  const scrim = document.createElement('div'); scrim.className = 'stklat-scrim'; scrim.hidden = true;
  document.body.append(scrim, pop);

  let colo = '', open = false, pinned = false, hoverTm = 0, paintTm = 0, pingTm = 0, inflight = false;

  // ---------------------------------------------------------------- place the chip (re-attached if Vela rebuilds the bar)
  // Desktop/tablet: right end of Vela's bottom bar. Phone layout (Vela hides that bar): the price pane's bottom-left
  // corner, right of the TZ mark (assets/chart-brand.js) and at its height, clear of Fit price / Latest.
  const place = () => {
    const bb = document.querySelector('#vela-chart .vela-widget-bottombar');
    if (bb && getComputedStyle(bb).display !== 'none') {
      if (chip.parentNode !== bb) { bb.appendChild(chip); chip.classList.remove('is-float'); chip.style.bottom = ''; }
      return;
    }
    const mark = document.querySelector('#vela-chart .vela-cell[data-active="true"] .tz-brand') || document.querySelector('#vela-chart .tz-brand');
    if (!mark || !mark.parentNode) return;
    if (chip.parentNode !== mark.parentNode) { mark.parentNode.appendChild(chip); chip.classList.add('is-float'); }
    const b = mark.style.display === 'none' ? '' : mark.style.bottom;
    if (chip.style.bottom !== b) chip.style.bottom = b;
    chip.hidden = !b;
  };
  place();
  window.addEventListener('resize', place);

  // ---------------------------------------------------------------- measuring
  async function ping() {
    if (inflight || document.hidden) return;
    inflight = true;
    const t0 = Date.now(), p0 = performance.now();
    try {
      const r = await fetch('/api/ping?t=' + t0, { cache: 'no-store', credentials: 'omit' });
      const j = await r.json();
      const rtt = performance.now() - p0;
      if (!r.ok) throw new Error('ping ' + r.status);
      L.notePing(t0, t0 + rtt, Number(j.t));
      if (j.colo) colo = String(j.colo);
    } catch (e) { L.notePingFail(); }
    inflight = false;
    paintChip(); if (open) paintPop();
  }
  const loop = () => { clearTimeout(pingTm); pingTm = 0; if (document.hidden) return; ping(); pingTm = setTimeout(loop, L.PING_EVERY_MS); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(pingTm); pingTm = 0; } else loop(); });
  window.addEventListener('online', loop);
  loop();

  // ---------------------------------------------------------------- what is on screen
  const symbols = () => {
    let cells = []; try { cells = ws.context().cells || []; } catch (e) {}
    let act = ''; try { act = ws.active.symbol || ''; } catch (e) {}
    const seen = new Map();
    if (act) seen.set(act, null);
    cells.forEach((c) => { if (c && c.symbol && !seen.has(c.symbol)) seen.set(c.symbol, c.id); else if (c && c.symbol === act && seen.get(act) == null) seen.set(act, c.id); });
    return [...seen.entries()].slice(0, 4).map(([sym, id]) => ({ sym, id }));
  };
  const dotFor = (id, sym) => {
    const sel = id ? '#vela-chart .vela-cell[data-cell-id="' + CSS_escape(id) + '"] .stkc-dd' : null;
    let d = sel && document.querySelector(sel);
    if (!d) d = [...document.querySelectorAll('#vela-chart .stkc-dd')].find((x) => x.dataset.sym === sym) || null;
    return d ? { s: d.dataset.s || '', tag: (d.querySelector('.stkc-dd-t') || {}).textContent || '' } : null;
  };
  const marketRow = (sym, id, t) => {
    const m = /^([a-z0-9_]+):(.+)$/i.exec(sym) || [null, '', sym];
    const prov = m[1].toLowerCase(), tk = m[2];
    const f = L.feedStats(L.feedKey(prov, tk), t), d = dotFor(id, sym);
    const live = d && d.s === 'rt';
    const stale = live && f.age != null && f.age > 15000;
    let st = d ? d.tag : (f.age != null ? 'Connected' : 'Waiting for data'), s = d ? (d.s === 'rt' ? 'ok' : d.s === 'delayed' ? 'warn' : '') : (f.age != null ? 'ok' : '');
    if (stale) { st = 'Stalled'; s = 'warn'; }
    if (!d && f.age == null) s = '';
    return { name: tk.replace(/^.*:/, '') + ' · ' + venue(prov), st, s, ms: f.delay.cur, avg: f.delay.avg, jit: f.delay.jitter, series: f.delay.series, age: f.age, stale, live,
      msLabel: prov === 'futures' || prov === 'fx' || prov === 'idx' || prov === 'stocks' ? 'Edge → you' : 'Exchange → you' };
  };
  const bookRow = (t) => {
    const B = window.__stkBookPanel; if (!B || !B.isOpen || typeof B.feedState !== 'function') return null;
    const fs = B.feedState(); if (!fs) return null;
    return { name: 'Order book · ' + (fs.kind === 'fut' ? 'L2' : 'exchange books'), st: fs.label, s: fs.s, ms: null, age: fs.at ? t - fs.at : null, stale: fs.s === 'ok' && fs.at && t - fs.at > 15000, book: true };
  };

  // ---------------------------------------------------------------- chip
  function paintChip() {
    const t = Date.now(), s = L.siteStats(t), ms = s.down ? null : s.cur;
    const q = L.quality(ms);
    if (chip.dataset.q !== q.q) chip.dataset.q = q.q;
    chip.querySelector('.stklat-bars').outerHTML = barsSvg(q.bars);
    chip.querySelector('.stklat-v').textContent = s.down ? 'Offline' : L.fmtMs(ms);
    const syms = symbols(), act = syms[0];
    const f = act ? L.feedStats(L.feedKey(...splitSym(act.sym)), t) : null;
    chip.classList.toggle('is-live', !!(f && f.age != null && f.age < 3000) && !perfMode());
    chip.setAttribute('aria-label', 'Connection: ' + (s.down ? 'offline' : ms == null ? 'measuring' : Math.round(ms) + ' milliseconds, ' + q.word.toLowerCase()) + '. Show details');
  }

  // ---------------------------------------------------------------- popover
  const rowHtml = (r, i) => {
    const q = r.ms != null ? L.quality(r.ms, !r.site) : null;
    return '<div class="stklat-row" data-i="' + i + '">' +
      '<div class="stklat-r1"><span class="stklat-name">' + esc(r.name) + '</span>' + (r.msLabel ? '<span class="stklat-cap">' + esc(r.msLabel) + '</span>' : '') + '<span class="stklat-ms">' + (r.book ? '' : esc(L.fmtMs(r.ms))) + '</span></div>' +
      '<div class="stklat-r2"><span class="stklat-st" data-s="' + esc(r.s) + '"><i></i>' + esc(r.st) + '</span>' + (q ? '<span class="stklat-q" data-q="' + q.q + '">' + q.word + '</span>' : '') + '</div>' +
      '<div class="stklat-stats">' +
        (r.site ? '<span>Avg <b>' + esc(L.fmtMs(r.avg)) + '</b></span><span>Jitter <b>' + esc(L.fmtMs(r.jit)) + '</b></span>'
          : '<span class="stklat-age' + (r.stale ? ' is-stale' : '') + '">' + (r.book ? 'Last update' : 'Last tick') + ' <b>' + esc(L.fmtAge(r.age)) + '</b></span>' + (r.book ? '' : '<span>Avg <b>' + esc(L.fmtMs(r.avg)) + '</b></span>')) +
      '</div>' + (r.book ? '' : '<canvas class="stklat-spark" aria-hidden="true"></canvas>') + '</div>';
  };
  let rows = [];
  function paintPop() {
    if (!open) return;
    const t = Date.now(), s = L.siteStats(t);
    const site = { site: true, msLabel: 'Round trip', name: 'Site & API', st: s.down ? 'Offline' : s.cur != null ? 'Connected' : s.n ? 'Slow to answer' : 'Measuring…', s: s.down ? 'bad' : s.cur != null ? 'ok' : '', ms: s.down ? null : s.cur, avg: s.avg, jit: s.jitter, series: s.series };
    rows = [site].concat(symbols().map((x) => marketRow(x.sym, x.id, t)));
    const b = bookRow(t); if (b) rows.push(b);
    const city = L.coloCity(colo);
    const sub = city ? 'Served from the ' + city + ' edge' : 'Edge location —';
    const key = rows.map((r) => r.name + (r.book ? 'b' : '')).join('|');
    const body = pop.querySelector('.stklat-rows');
    if (!body || pop.dataset.key !== key) {
      pop.dataset.key = key;
      pop.innerHTML = '<span class="stklat-grab" aria-hidden="true"></span>' +
        '<div class="stklat-head"><div class="stklat-head-t"><h2>Connection</h2><p class="stklat-sub"></p></div>' +
        '<button type="button" class="stklat-x" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
        '<div class="stklat-rows"></div>' +
        '<div class="stklat-foot">' +
          '<label class="stklat-perf"><span class="stklat-perf-t"><b>Performance mode</b><span>Fewer chart redraws, no animations. This device only.</span></span><input type="checkbox" role="switch" class="stklat-sw" aria-label="Performance mode"></label>' +
          '<button type="button" class="stklat-btn stklat-re"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>Reconnect</button>' +
        '</div>';
      pop.querySelector('.stklat-x').addEventListener('click', () => setOpen(false));
      const sw = pop.querySelector('.stklat-sw'); sw.checked = perfMode();
      sw.addEventListener('change', () => { setPerf(sw.checked); paintChip(); });
      pop.querySelector('.stklat-re').addEventListener('click', reconnect);
    }
    pop.querySelector('.stklat-sub').textContent = sub;
    pop.querySelector('.stklat-rows').innerHTML = rows.map(rowHtml).join('');
    pop.querySelectorAll('.stklat-row').forEach((el) => { const r = rows[+el.dataset.i], cv = el.querySelector('canvas'); if (cv && r) { cv.style.color = getComputedStyle(el.querySelector('.stklat-q') || el.querySelector('.stklat-ms')).color; drawSpark(cv, r.series || [], t); } });
  }
  function position() {
    if (isPhone()) { pop.style.left = pop.style.top = pop.style.bottom = ''; return; }
    const r = chip.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
    pop.style.top = Math.max(8, r.top - h - 8) + 'px';
    pop.style.bottom = 'auto';
  }
  function setOpen(v, how) {
    v = !!v;
    if (v === open) { if (v && how === 'click') pinned = true; return; }
    open = v; pinned = v && how === 'click';
    chip.setAttribute('aria-expanded', String(v));
    clearInterval(paintTm); paintTm = 0;
    if (v) {
      pop.hidden = false; scrim.hidden = !isPhone();
      paintPop(); position();
      requestAnimationFrame(() => { pop.classList.add('is-in'); scrim.classList.add('is-in'); });
      paintTm = setInterval(() => { if (!document.hidden) { paintPop(); position(); } }, 1000);
      if (isPhone() || how === 'click') { const x = isPhone() ? pop.querySelector('.stklat-x') : null; if (x) x.focus({ preventScroll: true }); }
    } else {
      pop.classList.remove('is-in'); scrim.classList.remove('is-in');
      const done = () => { if (!open) { pop.hidden = true; scrim.hidden = true; } };
      if (reduced() || perfMode()) done(); else setTimeout(done, isPhone() ? 300 : 180);
    }
  }
  async function reconnect() {
    const b = pop.querySelector('.stklat-re'); if (b) { b.disabled = true; b.lastChild.textContent = 'Reconnecting…'; }
    try { resyncAll(); } catch (e) {}
    try { const B = window.__stkBookPanel; if (B && B.isOpen && B.reconnect) B.reconnect(); } catch (e) {}
    await ping();
    setTimeout(() => { const bb = pop.querySelector('.stklat-re'); if (bb) { bb.disabled = false; bb.lastChild.textContent = 'Reconnect'; } }, 1500);
  }

  chip.addEventListener('click', (e) => { e.stopPropagation(); if (open && pinned) setOpen(false); else setOpen(true, 'click'); });
  ['pointerdown', 'mousedown', 'touchstart'].forEach((ev) => chip.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));
  // desktop hover: open after a short rest, close shortly after the pointer leaves both chip and popover (unless pinned by a click)
  const enter = (e) => { if (e.pointerType !== 'mouse' || isPhone()) return; clearTimeout(hoverTm); if (!open) hoverTm = setTimeout(() => setOpen(true, 'hover'), 200); };
  const leave = (e) => { if (e.pointerType !== 'mouse') return; clearTimeout(hoverTm); if (open && !pinned) hoverTm = setTimeout(() => setOpen(false), 250); };
  chip.addEventListener('pointerenter', enter); chip.addEventListener('pointerleave', leave);
  pop.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') clearTimeout(hoverTm); });
  pop.addEventListener('pointerleave', leave);
  scrim.addEventListener('click', () => setOpen(false));
  document.addEventListener('pointerdown', (e) => { if (open && !pop.contains(e.target) && !chip.contains(e.target)) setOpen(false); }, true);
  document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') { setOpen(false); chip.focus({ preventScroll: true }); } });
  window.addEventListener('resize', () => { if (open) position(); });

  setInterval(() => { if (!document.hidden) { place(); paintChip(); } }, 1000);
  paintChip();
  const api = { open: () => setOpen(true, 'click'), close: () => setOpen(false), get isOpen() { return open; }, ping, reconnect };
  window.__stkLatency = api;
  return api;
}

const CSS_escape = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));
const splitSym = (sym) => { const m = /^([a-z0-9_]+):(.+)$/i.exec(sym); return m ? [m[1], m[2]] : ['', sym]; };
const VENUES = { binance: 'Binance', coinbase: 'Coinbase', hyperliquid: 'Hyperliquid', bybit: 'Bybit', okx: 'OKX', bitget: 'Bitget', kraken: 'Kraken', vest: 'Vest',
  futures: 'CME futures', fx: 'Forex', idx: 'Index', stocks: 'Stocks', byo: 'Your feed' };
const venue = (p) => VENUES[p] || p || 'Market data';
