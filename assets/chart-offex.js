// TradeZoro — "Off-exchange Volume" chart indicator (native, lower pane + price levels). Free. ES module.
// Owner order 2026-11-04 ("Build everything").
//
// DATA: FINRA public files, fetched once a day by .github/workflows/finra-data.yml (tools/fetch-finra.js) into ONE json on the repo's
// `data-finra` branch; the browser reads it from raw.githubusercontent.com. No key, no vendor API from the browser.
//   daily  = Reg SHO daily short sale volume files (https://cdn.finra.org/equity/regsho/daily/): per symbol per day TotalVolume, the volume
//            FINRA's facilities reported that day (trades done off the exchanges). Updated every evening (US time).
//   weekly = FINRA OTC Transparency weekly summary (https://api.finra.org/data/group/otcMarket/name/weeklySummary): per symbol per week the
//            shares and dollar value traded on ATS (dark pool) venues and other OTC. Published with a delay of about three weeks.
// WHAT IS DRAWN (only what the data supports):
//   Pane   = the day's FINRA-reported volume divided by the chart's volume for that day, in %. Daily charts only.
//   Levels = the weekly files carry NO price per trade, so the level for a week is its average price: dollar value / shares of that week's
//            off-exchange volume. Weeks whose average price sits within 0.5 % of each other are merged into one level; line thickness follows
//            the shares. A level is where off-exchange volume clustered by that average, not a single print.
// Wording: "FINRA data, updated daily / weekly". Never live. No claim about what it means. Education only. Not financial advice.
// Depends on: Vela plugin SDK via the legend-row Core (registerNativeIndicator, registerRendererLayer, registerStatePersistence).

export const OFFEX_TYPE = 'stk_offex';
export const OFFEX_LV_TYPE = 'stk_offex_lv';
export const OFFEX_DESC = 'Daily off-exchange share of volume in a lower pane, and the price levels where weekly off-exchange volume clustered (FINRA data, updated daily / weekly). Stocks and ETFs in the data feed';
const DATA_URL = 'https://raw.githubusercontent.com/theelitegrey/Stryker-trading-academy-/data-finra/finra-data.json';
const REFRESH_MS = 30 * 60 * 1000;
const SCHEMA = [
  { key: 'showPane', title: 'Show the status line', type: 'bool', defval: true },
  { key: 'color', title: 'Colour', type: 'color', defval: '#00adb5' }
];
const LV_SCHEMA = [
  { key: 'levels', title: 'Most active levels', type: 'integer', defval: 5, minval: 1, maxval: 12 },
  { key: 'color', title: 'Colour', type: 'color', defval: '#00adb5' }
];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- pure ---------------------------------------------------------------------------------------
// chart symbol ('SPY', 'IDX:SPY', 'nasdaq:aapl', 'AAPL1!') -> feed symbol or ''
export function feedSymbol(symbol, known) {
  let t = String(symbol || ''); const m = /^[a-z_]+:(.+)$/i.exec(t); if (m) t = m[1];
  t = t.toUpperCase().replace(/!$/, '');
  return known && known[t] ? t : '';
}
export function ymd(ms) { return new Date(ms).toISOString().slice(0, 10).replace(/-/g, ''); }
// daily rows [[yyyymmdd, total, short]] + bars [{time, volume}] -> points [{time, value}] (null when unknown or not a share)
export function shareSeries(rows, bars) {
  const by = new Map((rows || []).map((r) => [r[0], r]));
  return bars.map((b) => {
    const r = by.get(ymd(b.time)), v = Number(b.volume);
    if (!r || !(v > 0)) return { time: b.time, value: null };
    const pct = (r[1] / v) * 100;
    return { time: b.time, value: pct > 0 && pct <= 100 ? Math.round(pct * 10) / 10 : null };   // > 100 % = the chart's volume is not the consolidated count: show nothing
  });
}
// weekly rows [[weekStart, atsSh, atsUsd, otcSh, otcUsd]] -> [{ price, shares, usd, weeks:[weekStart..], from, to }] merged within `tol`, biggest first
export function weeklyLevels(rows, { tol = 0.005, max = 5 } = {}) {
  const w = (rows || []).map((r) => { const sh = r[1] + r[3], usd = r[2] + r[4]; return sh > 0 && usd > 0 ? { week: r[0], shares: sh, usd, price: usd / sh } : null; }).filter(Boolean).sort((a, b) => a.price - b.price);
  const groups = [];
  for (const x of w) {
    const g = groups[groups.length - 1];
    if (g && x.price <= g.hi * (1 + tol)) { g.items.push(x); g.hi = x.price; } else groups.push({ items: [x], hi: x.price });
  }
  return groups.map((g) => {
    const shares = g.items.reduce((s, x) => s + x.shares, 0), usd = g.items.reduce((s, x) => s + x.usd, 0), wk = g.items.map((x) => x.week).sort();
    return { price: usd / shares, shares, usd, weeks: wk, from: wk[0], to: wk[wk.length - 1] };
  }).sort((a, b) => b.shares - a.shares).slice(0, max);
}
export function shortNum(v) { return v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : String(Math.round(v)); }
export function dataAge(genMs, nowMs) {
  if (!isNum(genMs)) return '';
  const d = Math.floor(((nowMs || Date.now()) - genMs) / 86400000);
  return d < 1 ? 'Data refreshed today' : 'Data refreshed ' + d + (d === 1 ? ' day ago' : ' days ago');
}

// ---- shared fetch -----------------------------------------------------------------------------------
let cache = null, inflight = null, at = 0;
export function load() {
  if (inflight) return inflight;
  if (cache && Date.now() - at < REFRESH_MS) return Promise.resolve(cache);
  inflight = fetch(DATA_URL, { credentials: 'omit' }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
    inflight = null;
    if (j && j.v === 1 && j.daily && j.weekly) { cache = j; at = Date.now(); }
    else if (!cache) at = Date.now() - REFRESH_MS + 60000;   // retry in a minute
    return cache;
  });
  return inflight;
}
export const _setData = (j) => { cache = j; at = Date.now(); };   // test hook

// ---- native ---------------------------------------------------------------------------------------
const light = () => { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } };
function msgTable(text) {
  const day = light();
  return { id: 'offex-msg', paneId: '', position: 'bottom_center', columns: 1, rows: 1, bgColor: day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.9)', frameWidth: 0, borderWidth: 0,
    cells: [[{ text, textColor: day ? '#334155' : '#a3a9b6', hAlign: 'center', vAlign: 'center', textSize: 'small', fontFamily: 'monospace', bold: false, italic: false }]], merges: [] };
}
const dailyTf = (tf) => /^(1D|D|1d)$/.test(String(tf || ''));
class OffexNative {
  constructor() { this.ctx = null; this.inputs = {}; this.sig = ''; }
  defaults() { return Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])); }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = Object.assign(this.defaults(), inputs); this.timer = setInterval(() => { if (!document.hidden) this.go(); }, REFRESH_MS); this.go(); }
  go() { this.render(); load().then(() => this.render()); }
  onBars() { const s = String(this.ctx && this.ctx.symbol); if (s !== this.lastSym) { this.lastSym = s; this.sig = ''; } this.render(); }
  onViewport() {}
  setInputs(i) { this.inputs = Object.assign(this.defaults(), i); this.sig = ''; this.render(); }
  suspend() {}
  resume() { this.sig = ''; this.go(); }
  stop() { clearInterval(this.timer); try { this.ctx.emit({ series: [], tables: [] }); } catch (e) {} }
  frame(series, tables) {
    const ctx = this.ctx, sig = JSON.stringify([series.length && series[0].points.length, series.length && series[0].points[series[0].points.length - 1], tables.length && tables[0].cells[0][0].text, this.inputs]);
    if (sig === this.sig) return;
    this.sig = sig;
    ctx.setStatus('idle');
    ctx.emit({ series, tables });
  }
  render() {
    if (!this.ctx) return;
    const I = this.inputs, ctx = this.ctx, bars = ctx.bars() || [];
    const empty = (text) => this.frame([{ id: 'offex-share', title: 'Off-exchange share %', paneId: '', kind: 'line', points: bars.map((b) => ({ time: b.time, value: null })), style: { color: I.color, width: 2, lineStyle: 'solid' } }], [msgTable(text)]);
    const d = cache;
    if (!d) return empty('Loading FINRA data…');
    const sym = feedSymbol(ctx.symbol, d.daily) || feedSymbol(ctx.symbol, d.weekly);
    if (!sym) return empty('Off-exchange Volume: stocks and ETFs in the data feed (for example SPY, QQQ, AAPL)');
    const note = 'FINRA data, updated daily';
    const pts = dailyTf(ctx.timeframe) ? shareSeries(d.daily[sym], bars) : bars.map((b) => ({ time: b.time, value: null }));
    const have = pts.filter((p) => p.value != null);
    const last = have.length ? have[have.length - 1] : null;
    const text = dailyTf(ctx.timeframe) ? (last ? 'Off-exchange share ' + last.value + ' %. ' : 'Off-exchange share: no matching days. ') + note
      : 'Off-exchange share needs the 1 day timeframe';
    this.frame([{ id: 'offex-share', title: 'Off-exchange share %', paneId: '', kind: 'line', points: pts, style: { color: I.color, width: 2, lineStyle: 'solid' } }],
      I.showPane === false ? [] : [msgTable(text)]);
    try { window.__stkOffex = Object.assign(window.__stkOffex || {}, { sym, n: have.length, last: last && last.value }); } catch (e) {}   // read by tools/tests/offex-browser.js
  }
}

// The weekly levels are their own overlay indicator (a lower-pane native cannot draw on the price pane); the pane indicator and this one
// read the same cached file, and the Indicators list shows both under "Off-exchange".
class LevelsNative {
  constructor() { this.ctx = null; this.inputs = {}; this.sig = ''; }
  defaults() { return Object.fromEntries(LV_SCHEMA.map((x) => [x.key, x.defval])); }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = Object.assign(this.defaults(), inputs); this.timer = setInterval(() => { if (!document.hidden) this.go(); }, REFRESH_MS); this.go(); }
  go() { this.render(); load().then(() => this.render()); }
  onBars() { const s = String(this.ctx && this.ctx.symbol); if (s !== this.lastSym) { this.lastSym = s; this.sig = ''; } this.render(); }
  onViewport() {}
  setInputs(i) { this.inputs = Object.assign(this.defaults(), i); this.sig = ''; this.render(); }
  suspend() {}
  resume() { this.sig = ''; this.go(); }
  stop() { clearInterval(this.timer); try { this.ctx.pushData(null); } catch (e) {} }
  push(p) { const sig = JSON.stringify(p); if (sig === this.sig) return; this.sig = sig; try { this.ctx.pushData(p); } catch (e) {} }
  render() {
    if (!this.ctx) return;
    const d = cache, I = this.inputs;
    if (!d) return this.push({ note: 'Loading FINRA data…' });
    const sym = feedSymbol(this.ctx.symbol, d.weekly) || feedSymbol(this.ctx.symbol, d.daily);
    if (!sym) return this.push({ note: 'Off-exchange levels: stocks and ETFs in the data feed (for example SPY, QQQ, AAPL)' });
    const lv = weeklyLevels(d.weekly[sym], { max: Math.max(1, Math.min(12, Number(I.levels) || 5)) });
    this.push({ sym, levels: lv, color: I.color, age: dataAge(d.generatedAt) });
    try { window.__stkOffex = Object.assign(window.__stkOffex || {}, { lvSym: sym, levels: lv.length }); } catch (e) {}   // read by tools/tests/optflow-offex-browser.js
  }
}

// ---- layer: weekly levels on the price pane ---------------------------------------------------------------
const hits = new WeakMap();
function layer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; c.dataset.stkOffex = '1'; },
    render(a) {
      if (!canvas) return;
      const g = canvas.getContext('2d'), co = a.coords, dpr = co.dpr || 1, d = a.data;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const boxes = []; hits.set(canvas, boxes);
      if (!d || !d.levels || !d.levels.length) return;
      const top = a.bounds.top, W = co.width, max = d.levels.reduce((m, x) => Math.max(m, x.shares), 1);
      const day = light(), phone = W < 520;
      g.save(); g.beginPath(); g.rect(0, top, W, a.bounds.height); g.clip();
      g.font = '500 11px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'right';
      const used = [];
      for (const L of d.levels) {
        const y = Math.round(co.priceToY(L.price, a.scale, a.bounds)) + 0.5;
        if (!Number.isFinite(y) || y < top || y > top + a.bounds.height) continue;
        const lw = 1 + 3 * (L.shares / max);
        g.strokeStyle = d.color; g.globalAlpha = 0.75; g.lineWidth = lw; g.setLineDash([2, 4]);
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
        if (used.every((u) => Math.abs(u - y) > 16)) {   // labels never overlap: a close level keeps its line only
          used.push(y);
          const txt = (phone ? '' : 'Off-exch ') + L.price.toFixed(2) + ' · ' + shortNum(L.shares) + ' sh';
          const tw = Math.ceil(g.measureText(txt).width) + 12, x1 = W - 8;
          g.fillStyle = day ? 'rgba(255,255,255,.94)' : 'rgba(19,19,22,.94)'; g.strokeStyle = d.color; g.lineWidth = 1;
          g.beginPath(); g.roundRect ? g.roundRect(x1 - tw, y - 9, tw, 18, 8) : g.rect(x1 - tw, y - 9, tw, 18); g.fill(); g.stroke();
          g.fillStyle = day ? '#1d1d1f' : 'rgba(255,255,255,.92)'; g.fillText(txt, x1 - 6, y + 0.5);
          boxes.push({ x: x1 - tw / 2, y, w: tw, h: 22, L, d });
        }
      }
      g.restore();
      try { window.__stkOffexHits = boxes.map((b) => { const r = canvas.getBoundingClientRect(); return { x: r.left + b.x, y: r.top + b.y }; }); } catch (e) {}   // test hook
    },
    destroy() { canvas = null; }
  };
}
let tip = null, pinned = false;
function find(e) {
  for (const cv of document.querySelectorAll('canvas[data-stk-offex]')) {
    const bx = hits.get(cv); if (!bx || !bx.length) continue;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    for (const b of bx) if (Math.abs(b.x - x) <= b.w / 2 && Math.abs(b.y - y) <= b.h / 2) return { b, r };
  }
  return null;
}
export function tipRows(L, age) {
  const wk = L.from === L.to ? 'week of ' + L.from : L.weeks.length + ' weeks, ' + L.from + ' to ' + L.to;
  return { title: 'Off-exchange volume level', rows: [['Average price', L.price.toFixed(2)], ['Shares', shortNum(L.shares)], ['Value', '$' + shortNum(L.usd)], ['Covers', wk]],
    note: 'Average price of FINRA-reported off-exchange (ATS and other OTC) volume in those weeks. FINRA data, updated weekly. ' + (age || '') };
}
function show(h) {
  if (!tip) { tip = document.createElement('div'); tip.className = 'stk-ox-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
  const t = tipRows(h.b.L, h.b.d.age);
  tip.textContent = '';
  const head = document.createElement('div'); head.className = 'stk-ox-h'; head.textContent = t.title; tip.appendChild(head);
  t.rows.forEach(([k, v]) => { const r = document.createElement('div'); r.className = 'stk-ox-r'; const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = v; r.append(a, b); tip.appendChild(r); });
  const n = document.createElement('div'); n.className = 'stk-ox-n'; n.textContent = t.note; tip.appendChild(n);
  tip.hidden = false;
  const left = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, h.r.left + h.b.x - tip.offsetWidth / 2));
  let tp = h.r.top + h.b.y - tip.offsetHeight - 16; if (tp < 8) tp = h.r.top + h.b.y + 16;
  tip.style.left = left + 'px'; tip.style.top = tp + 'px';
}
function onMove(e) { if (e.pointerType === 'touch' || pinned) return; const h = find(e); if (!h) { if (tip) tip.hidden = true; return; } show(h); }
function onDown(e) { const h = find(e); if (!h) { pinned = false; if (tip) tip.hidden = true; return; } pinned = e.pointerType === 'touch'; show(h); }
const CSS = `
.stk-ox-tip{ position:fixed; z-index:9050; pointer-events:none; width:min(280px, calc(100vw - 16px)); padding:12px; border-radius:12px; background:#131316; color:rgba(255,255,255,.92);
  border:1px solid rgba(255,255,255,.08); font:400 13px/18px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; font-variant-numeric:tabular-nums; box-shadow:0 8px 24px rgba(0,0,0,.4); }
.stk-ox-tip[hidden]{ display:none; }
.stk-ox-h{ font-weight:600; margin-bottom:8px; }
.stk-ox-r{ display:flex; justify-content:space-between; gap:12px; }
.stk-ox-r span{ color:rgba(255,255,255,.64); }
.stk-ox-n{ margin-top:8px; font-size:12px; line-height:16px; color:rgba(255,255,255,.64); }
:root[data-theme="light"] .stk-ox-tip{ background:#fff; color:#1d1d1f; border-color:rgba(0,0,0,.12); }
:root[data-theme="light"] .stk-ox-r span, :root[data-theme="light"] .stk-ox-n{ color:#515154; }
`;

// ---- registration + persistence -----------------------------------------------------------------------
const PERSIST_KEY = 'stryker.offex';
let installed = false;
export function installOffex(Core) {
  if (installed) return;
  installed = true;
  Core.registerNativeIndicator({
    type: OFFEX_TYPE, title: 'Off-exchange Volume (FINRA data)', shortTitle: 'Off-exchange', paneHint: 'new', overlay: false,
    inputsSchema: () => SCHEMA, defaultInputs: () => Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])),
    create: () => new OffexNative()
  });
  Core.registerRendererLayer({ id: OFFEX_LV_TYPE, placement: 'above-data', create: layer });
  Core.registerNativeIndicator({
    type: OFFEX_LV_TYPE, title: 'Off-exchange levels (FINRA data)', shortTitle: 'Off-exchange levels', paneHint: 'price', overlay: true,
    inputsSchema: () => LV_SCHEMA, defaultInputs: () => Object.fromEntries(LV_SCHEMA.map((x) => [x.key, x.defval])),
    create: () => new LevelsNative(), legendNote: (d) => (!d ? '' : d.note || (d.levels.length + ' levels'))
  });
  Core.registerStatePersistence({
    key: PERSIST_KEY, scope: 'cell',
    serialize(ctx) {
      const out = [];
      try { ctx.chart.indicators().forEach((h) => { if (h.nativeType === OFFEX_TYPE || h.nativeType === OFFEX_LV_TYPE) out.push([h.nativeType, h.inputValues()]); }); } catch (e) {}
      return out.length ? out : undefined;
    },
    restore(payload, ctx) {
      if (!Array.isArray(payload)) return;
      let all = [];
      try { all = ctx.chart.indicators(); } catch (e) { return; }
      [OFFEX_TYPE, OFFEX_LV_TYPE].forEach((type) => {
        const hs = all.filter((h) => h.nativeType === type), saved = payload.filter((p) => Array.isArray(p) && p[0] === type), schema = type === OFFEX_TYPE ? SCHEMA : LV_SCHEMA;
        saved.slice(0, 1).forEach((pp, i) => {
        const vals = pp[1];
        if (!hs[i] || !vals || typeof vals !== 'object') return;
        const clean = {};
        schema.forEach((s) => { const v = vals[s.key]; if (['string', 'number', 'boolean'].includes(typeof v)) clean[s.key] = v; });
        try { hs[i].setInputs(clean); } catch (e) {}
        });
      });
    }
  });
  if (typeof document !== 'undefined') {
    if (!document.getElementById('stk-ox-css')) { const st = document.createElement('style'); st.id = 'stk-ox-css'; st.textContent = CSS; document.head.appendChild(st); }
    document.addEventListener('pointermove', onMove, { passive: true, capture: true });
    document.addEventListener('pointerdown', onDown, { capture: true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tip) { tip.hidden = true; pinned = false; } });
  }
}
