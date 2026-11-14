// TradeZoro — options exposure indicators on the price axis: "Delta Exposure" (stk_dex), "Vanna Exposure" (stk_vex),
// "Charm Exposure" (stk_cex). ES module, Pro (chart-pro-gate.js GEX_TYPES), loaded with the other ZoroOptions natives.
//
// DATA: GET /api/zo/profile?u=<SYM>&x=<all|0|1> (the ZoroOptions feeder, every 2 min for SPX/SPY/QQQ/IWM/GLD/USO and every
//   15 min for the stocks). Per strike within +-6 % of spot: dex $M, vanna $M per vol point, charm $M per day (Black-Scholes on our
//   server from the Cboe chain; IV from the option mid where the chain has none). No vendor call from the browser.
// DRAW: bars by strike from the right edge (like the GEX profile, positive mint / negative red) + the 3 largest strikes by size as
//   lines with a tag. Futures are mapped (ES/NQ/RTY/GC/CL) with ratio = chart price / underlying spot at the chain time.
// Expiry: All expiries (<= 31 days) / 0DTE (today's expiry only; says so when there is none today) / Next expiry.
// Bar replay: nothing is drawn. Wording: "updated X min ago" only. Education only. Not financial advice.
import * as ZD from './chart-zoro-data.js?v=987';
import * as ProGate from './chart-pro-gate.js?v=987';

export const DEX_TYPE = 'stk_dex', VEX_TYPE = 'stk_vex', CEX_TYPE = 'stk_cex';
const PRICING = '/pricing';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const KINDS = {
  [DEX_TYPE]: { col: 'dex', name: 'Delta Exposure', short: 'DEX', unit: '' },
  [VEX_TYPE]: { col: 'vanna', name: 'Vanna Exposure', short: 'VEX', unit: ' / vol pt' },
  [CEX_TYPE]: { col: 'charm', name: 'Charm Exposure', short: 'CEX', unit: ' / day' }
};
export const EXP_ALL = 'All expiries', EXP_0 = '0DTE', EXP_NEXT = 'Next expiry';
const SCHEMA = [
  { key: 'expiry', title: 'Expiry', type: 'string', defval: EXP_ALL, options: [EXP_ALL, EXP_0, EXP_NEXT],
    tooltip: 'All expiries: every expiry up to 31 days. 0DTE: today\u2019s expiry only. Next expiry: the first expiry after today.' },
  { key: 'bars', title: 'Bars by strike', type: 'bool', defval: true },
  { key: 'lines', title: 'Top 3 strikes as lines', type: 'bool', defval: true },
  { key: 'posColor', title: 'Positive colour', type: 'color', defval: '#03c988' },
  { key: 'negColor', title: 'Negative colour', type: 'color', defval: '#ee4276' },
  { key: 'showStatus', title: 'Status', type: 'bool', defval: true }
];

// ---- pure ----------------------------------------------------------------------------------------
// New York calendar day of an epoch (s).
export function etDay(tSec) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(tSec * 1000));
  return p.slice(0, 10);
}
// Which feeder profile mode serves an expiry choice, given the 0-mode profile's expiry list and its chain time.
// The feeder's '0' is the first expiry still trading: today's on a 0DTE day, otherwise the next one.
// -> { x: '0'|'1'|'all' } or { none: reason } (0DTE asked on a day with no same-day expiry).
export function modeFor(choice, p0) {
  if (choice !== EXP_0 && choice !== EXP_NEXT) return { x: 'all' };
  if (!p0 || !Array.isArray(p0.expiry) || !isNum(p0.t)) return { wait: true };
  const today = p0.expiry[0] === etDay(p0.t);
  if (choice === EXP_0) return today ? { x: '0' } : { none: 'No same-day expiry today' };
  return { x: today ? '1' : '0' };
}
// Profile JSON {cols, rows} -> [{k, v}] for one column (feeder units: $M).
export function columnOf(p, col) {
  if (!p || !Array.isArray(p.cols) || !Array.isArray(p.rows)) return [];
  const ik = p.cols.indexOf('k'), iv = p.cols.indexOf(col);
  if (ik < 0 || iv < 0) return [];
  return p.rows.map((r) => ({ k: r[ik], v: r[iv] })).filter((r) => isNum(r.k) && isNum(r.v));
}
// The n largest strikes by |value| (ties: nearer spot first), largest first.
export function topLevels(rows, n, spot) {
  return rows.filter((r) => r.v !== 0).slice().sort((a, b) => Math.abs(b.v) - Math.abs(a.v) || Math.abs(a.k - spot) - Math.abs(b.k - spot)).slice(0, n);
}
export function money(vM) {
  const a = Math.abs(vM), s = vM < 0 ? '-' : '+';
  if (a >= 1000) return s + '$' + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'B';
  if (a >= 1) return s + '$' + a.toFixed(a >= 100 ? 0 : 1) + 'M';
  return s + '$' + (a * 1000).toFixed(0) + 'K';
}

// ---- native ----------------------------------------------------------------------------------------
class GNative {
  constructor(type) { this.type = type; this.K = KINDS[type]; this.inputs = {}; this.ctx = null; this.tier = null; this.sig = ''; }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = inputs || {}; ZD.zoWatch(this); ProGate.tier().then((t) => { this.tier = t; this.load(); }); this.load(); }
  choice() { return [EXP_ALL, EXP_0, EXP_NEXT].includes(this.inputs.expiry) ? this.inputs.expiry : EXP_ALL; }
  wants() {
    if (!this.ctx || !this.tier || ZD.replayOn() || ProGate.isFree()) return [];
    const src = ZD.srcOfCtx(this.ctx);
    if (!src) return [];
    const c = this.choice(), q = [];
    if (c === EXP_ALL) return [{ kind: 'profile', u: src.u, x: 'all' }];
    q.push({ kind: 'profile', u: src.u, x: '0' });
    const m = modeFor(c, ZD.zoCached('profile', src.u, '0'));
    if (m.x && m.x !== '0') q.push({ kind: 'profile', u: src.u, x: m.x });
    return q;
  }
  load() { this.refresh(); ZD.zoLoad(this); }
  onBars() { const s = String(this.ctx && this.ctx.symbol); if (s !== this.lastSym) { this.lastSym = s; this.load(); } else this.refresh(); }
  onViewport() {}
  setInputs(i) { this.inputs = i || {}; this.sig = ''; this.load(); }
  suspend() {}
  resume() { this.sig = ''; this.load(); }
  stop() { ZD.zoUnwatch(this); try { this.ctx.pushData(null); } catch (e) {} }
  refresh() {
    if (!this.ctx) return;
    const I = this.inputs, K = this.K, src = ZD.srcOfCtx(this.ctx);
    let payload;
    if (ZD.replayOn()) payload = { note: K.name + ' is hidden during bar replay' };
    else if (!ZD.zoroOn() || !src) payload = { note: K.name + ': SPX, SPY, QQQ, IWM, GLD, USO, ES, NQ, RTY, GC, CL and top stocks' };
    else if (!this.tier) payload = { note: 'Loading ' + K.name + '\u2026' };
    else if (ProGate.isFree()) payload = { pill: 'Unlock ' + K.name + ' with Pro', href: PRICING };
    else {
      const c = this.choice(), m = modeFor(c, ZD.zoCached('profile', src.u, '0'));
      const p = m.x ? ZD.zoCached('profile', src.u, m.x) : null;
      if (m.x && !p && m.x !== '0') ZD.zoFetch('profile', src.u, m.x).then(() => this.refresh());   // next-expiry mode is known only once '0' is in
      if (m.none) payload = { note: K.name + ' ' + src.root + ': ' + m.none };
      else if (!p || p.error || !isNum(p.spot)) payload = { note: p && p.error ? 'No ' + K.name + ' data for ' + src.root + ' yet' : 'Loading ' + K.name + '\u2026' };
      else {
        let bars = [];
        try { bars = this.ctx.bars() || []; } catch (e) {}
        const conv = ZD.convFor(p, src, bars);
        const rows = columnOf(p, K.col).map((r) => ({ k: r.k, v: r.v, price: conv(r.k) })).filter((r) => isNum(r.price));
        if (!rows.length) payload = { note: src.fut && !isNum(conv(p.spot)) ? 'No ' + src.fut + ' bar at the options time' : 'No ' + K.name + ' data for this expiry' };
        else {
          const tot = p.tot && isNum(p.tot[K.col]) ? p.tot[K.col] : rows.reduce((s, r) => s + r.v, 0);
          const top = I.lines !== false ? topLevels(rows, 3, p.spot) : [];
          const exp = c === EXP_ALL ? 'all expiries' : c === EXP_0 ? '0DTE' : 'next expiry ' + String((p.expiry || [])[0] || '').slice(5);
          payload = { rows: I.bars !== false ? rows.map((r) => ({ price: r.price, v: r.v })) : [], top: top.map((r, i) => ({ price: r.price, v: r.v, k: r.k, rank: i + 1 })),
            short: K.short, unit: K.unit, pos: I.posColor || '#03c988', neg: I.negColor || '#ee4276', showStatus: I.showStatus !== false,
            status: K.name + ' ' + src.root + (src.fut ? ' (mapped from ' + src.u + ')' : '') + ' \u00b7 ' + exp + ' \u00b7 net ' + money(tot) + K.unit + ' \u00b7 ' + ZD.agoText(p.t) };
        }
      }
    }
    const sig = JSON.stringify(payload);
    if (sig === this.sig) return;
    this.sig = sig;
    try { this.ctx.pushData(payload); } catch (e) {}
  }
}

// ---- layer ---------------------------------------------------------------------------------------
// shortcut: one chip row per indicator type (DEX 4, VEX 5, CEX 6 rows up), so three on one chart never overlap; fine for <= 3.
const ROW = { [DEX_TYPE]: 4, [VEX_TYPE]: 5, [CEX_TYPE]: 6 };
function layer(type) {
  return function create() {
    let canvas = null, chip = null, last = '';
    function paintChip(d, bottomPx) {
      if (!chip && canvas && canvas.parentElement) { chip = document.createElement('div'); chip.className = 'stk-gex-chip stk-zoro-chip'; chip.hidden = true; canvas.parentElement.appendChild(chip); }
      if (!chip) return;
      if (d && d.status && !d.note && !d.pill && window.innerWidth < 520) d = Object.assign({}, d, { status: '' });   // phone: the legend row says it
      const k = d ? JSON.stringify([d.note, d.pill, d.showStatus === false ? '' : d.status, bottomPx]) : '';
      if (k === last) return;
      last = k;
      if (!d || !(d.note || d.pill || (d.showStatus !== false && d.status))) { chip.hidden = true; return; }
      chip.hidden = false; chip.style.right = 'auto'; chip.style.left = '8px'; chip.style.bottom = (bottomPx + 24 * ROW[type]) + 'px';
      chip.textContent = '';
      if (d.pill) { const a = document.createElement('a'); a.className = 'stk-gex-pill'; a.href = d.href || PRICING; a.textContent = d.pill; chip.appendChild(a); }
      else { chip.classList.toggle('is-note', !!d.note); chip.appendChild(document.createTextNode(d.note || d.status)); }
    }
    return {
      mount(cv) { canvas = cv; },
      render(a) {
        if (!canvas) return;
        const g = canvas.getContext('2d'); if (!g) return;
        const dpr = a.coords.dpr || 1, d = a.data, fullH = canvas.height / dpr;
        g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
        paintChip(d, Math.max(0, fullH - (a.bounds.top + a.bounds.height)) + 8);
        canvas.__stkGreek = { bars: 0, lines: 0 };
        if (!d || !(d.rows || d.top)) return;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const W = a.coords.width, top = a.bounds.top, H = a.bounds.height, Y = (p) => a.coords.priceToY(p, a.scale, a.bounds);
        g.save(); g.beginPath(); g.rect(0, top, W, H); g.clip();
        const vis = (d.rows || []).map((r) => ({ y: Y(r.price), v: r.v })).filter((r) => isFinite(r.y) && r.y >= top - 8 && r.y <= top + H + 8).sort((p, q) => p.y - q.y);
        if (vis.length) {
          const gaps = vis.slice(1).map((r, i) => r.y - vis[i].y).filter((x) => x > 0).sort((p, q) => p - q);
          const h = Math.max(2, Math.min(12, (gaps.length ? gaps[gaps.length >> 1] : 6) * 0.8));
          const maxW = (W < 520 ? 0.22 : 0.15) * W, mx = Math.max.apply(null, vis.map((r) => Math.abs(r.v))) || 1;
          g.globalAlpha = 0.6;
          for (const r of vis) { const bw = Math.max(1, Math.abs(r.v) / mx * maxW); g.fillStyle = r.v >= 0 ? d.pos : d.neg; g.fillRect(W - bw, r.y - h / 2, bw, h); }
          g.globalAlpha = 1; canvas.__stkGreek.bars = vis.length;
        }
        g.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'; g.textBaseline = 'middle';
        for (const t of d.top || []) {
          const y = Math.round(Y(t.price)) + 0.5;
          if (!isFinite(y) || y < top || y > top + H) continue;
          const c = t.v >= 0 ? d.pos : d.neg;
          g.strokeStyle = ZD.hexA(c, t.rank === 1 ? 0.95 : 0.7); g.lineWidth = t.rank === 1 ? 1.5 : 1; g.setLineDash(t.rank === 1 ? [] : [5, 4]);
          g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.setLineDash([]);
          const txt = d.short + ' ' + t.rank + ' \u00b7 ' + t.k + ' \u00b7 ' + money(t.v);
          const w = Math.ceil(g.measureText(txt).width) + 10, x = 8;
          g.fillStyle = ZD.hexA(c, 0.9); g.fillRect(x, y - 8, w, 16);
          g.fillStyle = '#0b0b0b'; g.fillText(txt, x + 5, y + 0.5);
          canvas.__stkGreek.lines++;
        }
        g.restore();
      },
      destroy() { if (chip) chip.remove(); chip = null; canvas = null; }
    };
  };
}

// ---- registration --------------------------------------------------------------------------------
let installed = false;
export function installGreekExposure(Core) {
  if (installed || !ZD.zoroOn()) return;
  installed = true;
  for (const type of [DEX_TYPE, VEX_TYPE, CEX_TYPE]) {
    const K = KINDS[type];
    Core.registerRendererLayer({ id: type, placement: 'above-data', create: layer(type) });
    Core.registerNativeIndicator({
      type, title: K.name, shortTitle: K.name, paneHint: 'price', overlay: true,
      inputsSchema: () => SCHEMA, defaultInputs: () => Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])),
      create: () => new GNative(type),
      legendNote: (d) => (d ? (d.pill || d.note || String(d.status || '').replace(K.name + ' ', '')) : '')
    });
    ZD.persist(Core, 'stryker.' + type, type, SCHEMA, 2);
  }
}
