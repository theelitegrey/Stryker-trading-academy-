// TradeZoro — Charts: crypto derivatives tools (Owner 2026-11-07, competitor gap list). ES module. Pro (Order Flow family).
//   stk_liq      Liquidations              price pane: each forced close as a bubble at its price and time, sized by USD;
//                                          long liquidations red, short liquidations green; hover / tap card.
//   stk_liq_bars Liquidations per bar      lower pane: USD of shorts liquidated (up, green) and longs liquidated (down, red) per bar.
//   stk_oi       Open Interest             lower pane: OI change per bar (bars, coloured by OI vs price) + the OI line, summed over the
//                                          exchanges picked.
//   stk_funding  Funding Rate              lower pane: the settled rate per bar + a small table: rate now, next settlement countdown,
//                                          interval, per exchange.
//   stk_lsr      Long/Short Ratio          lower pane: accounts long / short (or top traders) from the exchange's public ratio feed.
// DATA: public exchange endpoints called straight from the member's browser (no keys, no proxy, nothing relayed by us):
//   Binance USDT-M (fstream <sym>@forceOrder, fapi openInterestHist / premiumIndex / fundingRate / long-short ratios),
//   Bybit v5 linear (allLiquidation, open-interest, tickers, funding/history, account-ratio), OKX v5 (liquidation-orders socket + REST,
//   rubik open-interest-history, funding-rate(-history)), Hyperliquid info (funding only: it has no public liquidation feed and no OI history).
// An exchange that refuses the request from the member's region (HTTP 451 / 403) is shown as "not available here"; we never route around it.
// LIQUIDATIONS ARE A LOWER BOUND: the exchanges send only part of them (Binance at most one per symbol per second), so the card, the
// legend and the help text say so. Totals exist only for the minutes this browser was collecting (kept for 24 h on this device);
// bars outside that are left empty, never filled in. OKX also gives its recent prints by REST, so OKX bubbles appear for the hours before.
// No liquidation-level "map": positions' entry prices and leverage are not public, so any such map would be mostly guesswork (see report).
// Depends on: assets/crypto-deriv-data.js (pure maths), the Vela plugin Core (registerNativeIndicator, registerRendererLayer,
// registerStatePersistence). Gate: assets/chart-pro-gate.js OF_TYPES (Pro, like crypto footprint / delta). Education only. Not financial advice.

import * as D from './crypto-deriv-data.js?v=918';

export const DERIV_TYPES = ['stk_liq', 'stk_liq_bars', 'stk_oi', 'stk_funding', 'stk_lsr'];
export const DERIV_DESC = {
  stk_liq: 'Crypto perpetuals: forced closes as bubbles at their price and time, sized by USD; longs red, shorts green. Exchanges send only part of them',
  stk_liq_bars: 'Crypto perpetuals: USD of longs and shorts liquidated in each bar, in a lower pane. A lower bound',
  stk_oi: 'Crypto perpetuals: open interest summed over the exchanges you pick, with the change per bar coloured against price',
  stk_funding: 'Crypto perpetuals: funding rate per bar, plus the rate now and the countdown to the next settlement on each exchange',
  stk_lsr: 'Crypto perpetuals: share of accounts long vs short (or top traders) from the exchange, in a lower pane'
};
const LOWER = 'Exchanges send only part of their liquidations (Binance at most one per symbol per second), so these are a lower bound.';
const UP = '#03c988', DN = '#f23645';
const FONT = '-apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif';
const light = () => { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } };
const replayOn = () => { try { return !!(window.__stkReplay && window.__stkReplay.on); } catch (e) { return false; } };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const exBools = (def) => ['binance', 'bybit', 'okx'].map((e) => ({ key: e, title: D.EX_NAME[e], type: 'bool', defval: def.includes(e) }));

function baseOfCtx(ctx) {
  let prov = '';
  try { const r = ctx.data.resolve(ctx.symbol); if (r) prov = r.provider; } catch (e) {}
  return D.baseOf(ctx.symbol, prov);
}
function msg(id, text, pos) {
  const day = light();
  // wrap to the chart width (pane tables do not wrap on their own; a phone pane is ~300 px wide)
  const max = Math.max(28, Math.floor(((window.innerWidth || 1440) - 130) / 6.6)), lines = [];
  for (const w of String(text).split(' ')) { if (lines.length && (lines[lines.length - 1] + ' ' + w).length <= max) lines[lines.length - 1] += ' ' + w; else lines.push(w); }
  const cell = (t) => [{ text: t, textColor: day ? '#515154' : 'rgba(255,255,255,0.64)', hAlign: 'center', vAlign: 'center', textSize: 'small', fontFamily: 'default', bold: false, italic: false }];
  return { id, paneId: '', position: pos || 'bottom_center', columns: 1, rows: lines.length, bgColor: day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.9)', frameWidth: 0, borderWidth: 0,
    cells: lines.map(cell), merges: [] };
}

// ---------------------------------------------------------------------------------------- network
// One GET / POST per URL at a time, cached for `ttl`. Errors: { status } so the caller can say "not available here" (451 / 403).
const netCache = new Map();
export function getJson(url, body, ttl = 60000) {
  const k = url + (body ? '|' + JSON.stringify(body) : '');
  const e = netCache.get(k);
  if (e && (e.p || Date.now() - e.at < ttl)) return e.p || (e.err ? Promise.reject(e.err) : Promise.resolve(e.j));
  const n = { at: Date.now(), p: null, j: null, err: null };
  n.p = fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit' } : { credentials: 'omit' })
    .then((r) => (r.ok ? r.json() : r.json().catch(() => null).then((j) => { throw { status: r.status, j }; })))
    .then((j) => { n.j = j; n.p = null; return j; }, (err) => { n.err = err && err.status ? err : { status: 0 }; n.p = null; n.at = Date.now() - ttl + 20000; throw n.err; });
  if (netCache.size > 200) netCache.clear();
  netCache.set(k, n);
  return n.p;
}
// HTTP status -> short reason for the notes
export const whyNot = (err) => (!err ? '' : err.status === 451 || err.status === 403 ? 'not available in your region' : err.status === 400 || err.status === 404 ? 'not listed' : 'not reachable from here');

// ---------------------------------------------------------------------------------------- liquidation feed (one per coin)
const LS = 'stk.liq.v1.';
const KEEP_MS = 24 * 3600 * 1000, MAX_KEEP = 4000;
const feeds = new Map();   // base -> feed
const liqSubs = new Set();
function poke(base) { liqSubs.forEach((f) => { try { f(base); } catch (e) {} }); }
// Bybit and OKX drop a quiet socket unless pinged; Binance pings us itself (an unknown text message would be an error there)
function sock(url, onOpen, onMsg, st) {
  const pingMsg = url.includes('bybit') ? '{"op":"ping"}' : url.includes('okx') ? 'ping' : '';
  let ws = null, stopped = false, retry = 0, tm = 0, ping = 0, opened = false;
  const open = () => {
    if (stopped) return;
    try { ws = new WebSocket(url); } catch (e) { st('error'); return; }
    const me = ws;
    me.onopen = () => { retry = 0; opened = true; st('live'); try { onOpen(me); } catch (e) {} if (pingMsg) ping = setInterval(() => { try { me.send(pingMsg); } catch (e) {} }, 20000); };
    me.onmessage = (e) => { if (e.data === 'pong') return; let d; try { d = JSON.parse(e.data); } catch (x) { return; } onMsg(d); };
    me.onclose = () => { clearInterval(ping); if (stopped || ws !== me) return; st(!opened && retry >= 2 ? 'unreachable' : 'reconnecting'); tm = setTimeout(open, Math.min(30000, 1000 * Math.pow(2, retry++))); };
    me.onerror = () => { try { me.close(); } catch (e) {} };
  };
  open();
  return () => { stopped = true; clearTimeout(tm); clearInterval(ping); try { ws && ws.close(); } catch (e) {} };
}
class LiqFeed {
  constructor(base) {
    this.base = base; this.refs = 0; this.list = []; this.cov = []; this.st = {}; this.stops = []; this.saveTm = 0; this.okxCt = 0; this.v = 0;
    try { const j = JSON.parse(localStorage.getItem(LS + base) || 'null'); if (j && Array.isArray(j.list)) { this.list = j.list.filter((x) => x && isNum(x.t) && isNum(x.p) && isNum(x.usd)); this.cov = Array.isArray(j.cov) ? j.cov.filter((c) => Array.isArray(c) && isNum(c[0]) && isNum(c[1])) : []; } } catch (e) {}
    this.prune();
  }
  prune() { const cut = Date.now() - KEEP_MS; this.list = this.list.filter((x) => x.t >= cut).slice(-MAX_KEEP); this.cov = this.cov.filter((c) => c[1] >= cut); }
  add(xs) {
    if (!xs.length) return;
    this.list = D.dedupe(this.list.concat(xs)); this.prune(); this.v++;
    this.save(); poke(this.base);
  }
  flush() { if (!this.saveTm) return; clearTimeout(this.saveTm); this.saveTm = 0; try { localStorage.setItem(LS + this.base, JSON.stringify({ list: this.list, cov: this.cov })); } catch (e) {} }
  // coverage = the time this browser had at least one liquidation socket open (totals are only computed there)
  covTick() {
    const now = Date.now(), anyLive = Object.values(this.st).some((s) => s === 'live');
    if (!anyLive) { this.covOpen = false; return; }
    const last = this.cov[this.cov.length - 1];
    if (this.covOpen && last) last[1] = now; else { this.cov.push([now, now]); this.covOpen = true; }
  }
  save() {
    if (this.saveTm) return;
    this.saveTm = setTimeout(() => { this.saveTm = 0; try { localStorage.setItem(LS + this.base, JSON.stringify({ list: this.list, cov: this.cov })); } catch (e) {} }, 5000);
  }
  status(ex, s) { this.st[ex] = s; this.covTick(); poke(this.base); }
  start() {
    const b = this.base;
    // Binance: <sym>@forceOrder (one liquidation per symbol per second at most)
    this.stops.push(sock('wss://fstream.binance.com/ws/' + D.exSymbol('binance', b).toLowerCase() + '@forceOrder', () => {}, (d) => this.add(D.parseBinanceLiq(d)), (s) => this.status('binance', s)));
    // Bybit: allLiquidation.<sym>
    const by = 'allLiquidation.' + D.exSymbol('bybit', b);
    this.stops.push(sock('wss://stream.bybit.com/v5/public/linear', (ws) => ws.send(JSON.stringify({ op: 'subscribe', args: [by] })), (d) => { if (d.topic === by) this.add(D.parseBybitLiq(d)); }, (s) => this.status('bybit', s)));
    // OKX: contract size first (sizes are in contracts), then the recent REST prints and the socket for every SWAP (filtered to ours)
    const inst = D.exSymbol('okx', b);
    getJson('https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=' + inst, null, 3600000).then((j) => {
      const r = j && j.data && j.data[0]; const ct = r ? parseFloat(r.ctVal) * (parseFloat(r.ctMult) || 1) : 0;
      if (!(ct > 0)) { this.status('okx', 'none'); return; }
      this.okxCt = ct;
      getJson('https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&instFamily=' + b + '-USDT&state=filled&limit=100', null, 30000)
        .then((j2) => this.add(D.parseOkxLiq(j2, inst, ct)), () => {});
      if (this.refs > 0) this.stops.push(sock('wss://ws.okx.com:443/ws/v5/public', (ws) => ws.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'liquidation-orders', instType: 'SWAP' }] })),
        (d) => { if (d.arg && d.arg.channel === 'liquidation-orders' && d.data) this.add(D.parseOkxLiq(d, inst, ct)); }, (s) => this.status('okx', s)));
    }, (err) => this.status('okx', err && err.status === 451 ? 'blocked' : 'error'));
    this.covT = setInterval(() => { this.covTick(); this.save(); }, 15000);
  }
  stop() { this.stops.forEach((f) => f()); this.stops = []; clearInterval(this.covT); this.st = {}; this.covOpen = false; }
}
export function liqFeed(base) {
  let f = feeds.get(base);
  if (!f) { f = new LiqFeed(base); feeds.set(base, f); }
  return f;
}
function acquireLiq(base) {
  const f = liqFeed(base);
  if (f.refs++ === 0) f.start();
  clearTimeout(f.idle);
  return () => { if (--f.refs <= 0) { f.refs = 0; f.idle = setTimeout(() => { if (!f.refs) f.stop(); }, 60000); } };
}
// bars covered by the collection windows (a bar counts only when the whole bar is inside one window)
export function coveredMask(bars, ms, cov) {
  return bars.map((b) => cov.some((c) => c[0] <= b.time + 1000 && c[1] >= Math.min(Date.now(), b.time + ms) - 20000));
}
export const _feeds = feeds;   // test hook

// ---------------------------------------------------------------------------------------- natives
class Base {
  constructor(type, schema) { this.type = type; this.schema = schema; this.ctx = null; this.inputs = {}; this.tm = 0; this.off = false; }
  defaults() { return Object.fromEntries(this.schema.map((x) => [x.key, x.defval])); }   // (note() also clears a layer: pushData({ note }))
  start(ctx, inputs) { this.ctx = ctx; this.inputs = Object.assign(this.defaults(), inputs); this.init(); this.render(); }
  init() {}
  onBars() { const s = String(this.ctx && this.ctx.symbol) + '|' + this.ctx.timeframe; if (s !== this.sig0) { this.sig0 = s; this.symChanged(); } this.later(); }
  symChanged() {}
  onViewport() {}
  setInputs(i) { this.inputs = Object.assign(this.defaults(), i); this.symChanged(); this.render(); }
  suspend() {}
  resume() { this.render(); }
  stop() { this.off = true; clearTimeout(this.tm); this.done(); try { this.ctx.pushData(null); } catch (e) {} }
  done() {}
  later() { if (this.tm || this.off) return; this.tm = setTimeout(() => { this.tm = 0; this.render(); }, 200); }
  // The chart only value-patches a model after its first emit, so a pane tool always emits the SAME series (empty ones with a note)
  note(text) { this.ctx.setStatus('idle'); this.ctx.emit({ series: this.blank(), tables: [msg(this.type + '-msg', text, 'middle_center')] }); this.lastNote = text; try { (window.__stkCdNotes = window.__stkCdNotes || {})[this.type] = text; this.ctx.pushData({ note: text }); } catch (e) {} }
  blank() { return []; }
  shape(pts) { return []; }   // subclass: series list for these points (null points = blank)
  nulls() { return (this.ctx.bars() || []).map((b) => ({ time: b.time, value: null })); }
  picked() { return ['binance', 'bybit', 'okx'].filter((e) => this.inputs[e] !== false); }
}

// ---- Liquidations (bubbles) + Liquidations per bar (pane) share the feed
const LIQ_SCHEMA = exBools(['binance', 'bybit', 'okx']).concat([
  { key: 'minUsd', title: 'Smallest liquidation shown (USD)', type: 'int', defval: 10000, min: 0, max: 10000000, step: 1000 },
  { key: 'labels', title: 'Show $ labels on big ones', type: 'bool', defval: true },
  { key: 'longColor', title: 'Long liquidations', type: 'color', defval: DN },
  { key: 'shortColor', title: 'Short liquidations', type: 'color', defval: UP }
]);
class LiqNative extends Base {
  constructor(type) { super(type, type === 'stk_liq' ? LIQ_SCHEMA : LIQ_SCHEMA.filter((x) => x.key !== 'labels' && x.key !== 'minUsd')); this.rel = null; this.base = ''; }
  init() { this.sub = (b) => { if (b === this.base) this.later(); }; liqSubs.add(this.sub); this.symChanged(); }
  symChanged() {
    const b = this.ctx ? baseOfCtx(this.ctx) : '';
    if (b === this.base && this.rel) return;
    if (this.rel) { this.rel(); this.rel = null; }
    this.base = b;
    if (b && !replayOn()) this.rel = acquireLiq(b);
  }
  done() { liqSubs.delete(this.sub); if (this.rel) this.rel(); this.rel = null; }
  blank() { return this.type === 'stk_liq' ? [] : this.shape(this.nulls(), this.nulls()); }
  shape(ptsS, ptsL) {
    const I = this.inputs;
    return [{ id: 'stk_liqb-s', title: 'Shorts liquidated (USD)', paneId: '', kind: 'histogram', points: ptsS, style: { color: I.shortColor, width: 1, lineStyle: 'solid', base: 0 } },
      { id: 'stk_liqb-l', title: 'Longs liquidated (USD, shown below 0)', paneId: '', kind: 'histogram', points: ptsL, style: { color: I.longColor, width: 1, lineStyle: 'solid', base: 0 } }];
  }
  statusText(f) {
    const parts = this.picked().map((e) => { const s = f.st[e]; return D.EX_NAME[e] + (s === 'live' ? '' : s === 'blocked' ? ' (not available in your region)' : s === 'none' ? ' (not listed)' : s === 'unreachable' || s === 'error' ? ' (not reachable from here)' : ' (connecting)'); });
    return parts.join(', ');
  }
  render() {
    if (!this.ctx || this.off) return;
    if (!this.base) return this.note('Liquidations: crypto perpetuals only (BTC, ETH, SOL and the other listed coins)');
    if (replayOn()) return this.note('Liquidations: hidden in replay');
    if (!this.picked().length) return this.note('Liquidations: pick at least one exchange in Settings');
    if (!this.rel) this.symChanged();
    const f = liqFeed(this.base), I = this.inputs, picked = this.picked();
    const list = f.list.filter((x) => picked.includes(x.ex));
    const bars = this.ctx.bars() || [], ms = D.barMs(bars);
    window.__stkLiq = { base: this.base, n: list.length, st: Object.assign({}, f.st), cov: f.cov.length };
    if (this.type === 'stk_liq') {
      this.ctx.setStatus('idle');
      this.ctx.emit({ series: [], tables: [] });
      this.ctx.pushData({ list: list.filter((x) => x.usd >= (Number(I.minUsd) || 0)), I, base: this.base, v: f.v, st: this.statusText(f), bars: bars.length });
      return;
    }
    if (!bars.length || !ms) return;
    const per = D.liqPerBar(list, bars, ms), mask = coveredMask(bars, ms, f.cov);
    const any = mask.some(Boolean);
    const ptsS = bars.map((b, i) => ({ time: b.time, value: mask[i] ? per.short[i] : null, color: I.shortColor }));
    const ptsL = bars.map((b, i) => ({ time: b.time, value: mask[i] ? -per.long[i] : null, color: I.longColor }));
    this.ctx.setStatus('idle');
    this.ctx.emit({
      series: this.shape(ptsS, ptsL),
      tables: any ? [] : [msg('stk_liqb-msg', 'Collecting liquidations from now on. ' + LOWER, 'middle_center')]
    });
    try { this.ctx.pushData({ leg: this.base + ' · ' + this.statusText(f) + ' · lower bound' }); } catch (e) {}
  }
}

// bubble layer + card
const hits = new WeakMap();
function liqLayer() {
  let canvas = null, chip = null, chipKey = '';
  function setChip(text, parent) {
    if (text === chipKey) return; chipKey = text;
    if (!text) { if (chip) chip.hidden = true; return; }
    if (!chip) { chip = document.createElement('div'); chip.className = 'stk-liq-chip'; parent.appendChild(chip); }
    chip.hidden = false; chip.textContent = text;
  }
  return {
    mount(c) { canvas = c; c.dataset.stkLiq = '1'; },
    render(a) {
      if (!canvas) return;
      const g = canvas.getContext('2d'), co = a.coords, dpr = co.dpr || 1, d = a.data;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const boxes = []; hits.set(canvas, boxes);
      if (!d) return setChip('', canvas.parentElement);
      if (d.note) return setChip(d.note, canvas.parentElement);
      const bars = a.bars, I = d.I, W = co.width, ms = D.barMs(bars), top = a.bounds.top, bot = top + a.bounds.height, day = light();
      if (!bars.length || !ms) return;
      let v0 = 0, v1 = bars.length - 1;
      try { const vr = co.visibleLogicalRange(); v0 = Math.max(0, Math.floor(vr.from)); v1 = Math.min(bars.length - 1, Math.ceil(vr.to)); } catch (e) {}
      const t0 = bars[v0].time, t1 = bars[v1].time + ms;
      const vis = d.list.filter((x) => x.t >= t0 && x.t < t1);
      const sum = (s) => vis.filter((x) => x.side === s).reduce((m, x) => m + x.usd, 0);
      const narrow = (window.innerWidth || 1440) < 700;   // phone: shorter pill so "lower bound" is not cut off
      setChip(vis.length ? d.base + (narrow ? ' liq. in view: longs ' : ' liquidations in view: longs ') + D.usd(sum('long')) + ' · shorts ' + D.usd(sum('short')) + ' · lower bound' : d.base + ': no liquidations in view yet · ' + d.st, canvas.parentElement);
      const max = vis.reduce((m, x) => Math.max(m, x.usd), 1), rMax = W < 520 ? 11 : 16;
      g.save(); g.beginPath(); g.rect(0, top, W, a.bounds.height); g.clip();
      const placed = [];
      for (const x of vis.slice().sort((p, q) => p.usd - q.usd)) {
        const i = D.barIndex(bars, x.t, ms); if (i < 0) continue;
        const px = co.timeToX(bars[i].time);
        const py = co.priceToY(x.p, a.scale, a.bounds);
        if (!Number.isFinite(px) || !Number.isFinite(py) || px < -20 || px > W + 20 || py < top - 20 || py > bot + 20) continue;
        const r = D.radius(x.usd, max, rMax), col = x.side === 'long' ? I.longColor : I.shortColor;
        g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2);
        g.globalAlpha = 0.45; g.fillStyle = col; g.fill();
        g.globalAlpha = 1; g.lineWidth = 1; g.strokeStyle = col; g.stroke();
        boxes.push({ x: px, y: py, r: Math.max(r, 10), p: x });
        placed.push({ px, py, r, x });
      }
      if (I.labels !== false) {
        g.font = '600 11px ' + FONT; g.textBaseline = 'middle';
        const taken = [];
        for (const pl of placed.sort((p, q) => q.x.usd - p.x.usd).slice(0, W < 520 ? 5 : 14)) {
          if (pl.x.usd < max * 0.25) break;
          const txt = D.usd(pl.x.usd), w = g.measureText(txt).width + 8, h = 16, lx = pl.px + pl.r + 4, ly = pl.py - h / 2;
          if (lx + w > W - 2 || taken.some((b) => lx < b.x + b.w && lx + w > b.x && ly < b.y + b.h && ly + h > b.y)) continue;
          taken.push({ x: lx, y: ly, w, h });
          g.globalAlpha = 0.92; g.fillStyle = day ? '#ffffff' : '#131316'; g.beginPath(); if (g.roundRect) g.roundRect(lx, ly, w, h, 4); else g.rect(lx, ly, w, h); g.fill();
          g.globalAlpha = 1; g.lineWidth = 1; g.strokeStyle = day ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.08)'; g.stroke();
          g.fillStyle = day ? '#1d1d1f' : 'rgba(255,255,255,.92)'; g.fillText(txt, lx + 4, pl.py + 0.5);
        }
      }
      g.restore();
    },
    destroy() { if (chip) chip.remove(); chip = null; canvas = null; }
  };
}
let tip = null, pinned = false;
const fmtT = (t) => { try { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(t)); } catch (e) { return new Date(t).toISOString(); } };
export function liqTip(x, base) {
  return { title: (x.side === 'long' ? 'Long liquidated' : 'Short liquidated') + ' · ' + D.usd(x.usd),
    rows: [['Exchange', D.EX_NAME[x.ex] || x.ex], ['Side', x.side === 'long' ? 'long closed (forced sell)' : 'short closed (forced buy)'], ['Price', x.p.toLocaleString('en-US', { maximumFractionDigits: 6 })],
      ['Size', x.qty.toLocaleString('en-US', { maximumFractionDigits: 4 }) + ' ' + base], ['Time', fmtT(x.t)]],
    note: LOWER };
}
function findHit(e) {
  for (const cv of document.querySelectorAll('canvas[data-stk-liq]')) {
    const bx = hits.get(cv); if (!bx || !bx.length) continue;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) continue;
    let best = null, bd = 1e9;
    for (const b of bx) { const dd = Math.hypot(b.x - x, b.y - y); if (dd <= b.r && dd < bd) { best = { b, r }; bd = dd; } }
    if (best) return best;
  }
  return null;
}
function showTip(h) {
  if (!tip) { tip = document.createElement('div'); tip.className = 'stk-liq-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
  const p = h.b.p, t = liqTip(p, (window.__stkLiq && window.__stkLiq.base) || '');
  tip.textContent = '';
  const head = document.createElement('div'); head.className = 'stk-liq-h';
  const dot = document.createElement('i'); dot.className = p.side; head.append(dot, t.title); tip.appendChild(head);
  t.rows.forEach(([k, v]) => { const r = document.createElement('div'); r.className = 'stk-liq-r'; const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = v; r.append(a, b); tip.appendChild(r); });
  const n = document.createElement('div'); n.className = 'stk-liq-n'; n.textContent = t.note; tip.appendChild(n);
  tip.hidden = false;
  const left = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, h.r.left + h.b.x - tip.offsetWidth / 2));
  let tp = h.r.top + h.b.y - tip.offsetHeight - h.b.r - 8; if (tp < 8) tp = h.r.top + h.b.y + h.b.r + 8;
  tip.style.left = left + 'px'; tip.style.top = tp + 'px';
}
function onMove(e) { if (e.pointerType === 'touch' || pinned) return; const h = findHit(e); if (!h) { if (tip) tip.hidden = true; return; } showTip(h); }
function onDown(e) { const h = findHit(e); if (!h) { pinned = false; if (tip) tip.hidden = true; return; } pinned = e.pointerType === 'touch'; showTip(h); }

// ---- Open Interest
const OI_SCHEMA = exBools(['binance', 'bybit', 'okx']).concat([
  { key: 'line', title: 'Show the open interest line', type: 'bool', defval: true },
  { key: 'upUp', title: 'OI up, price up', type: 'color', defval: UP },
  { key: 'upDown', title: 'OI up, price down', type: 'color', defval: DN },
  { key: 'downUp', title: 'OI down, price up', type: 'color', defval: '#7fd8b8' },
  { key: 'downDown', title: 'OI down, price down', type: 'color', defval: '#f59aa3' },
  { key: 'lineColor', title: 'OI line', type: 'color', defval: '#00adb5' }
]);
// pages of OI history for one exchange, newest first, up to ~500 samples
async function oiHistory(ex, base, barMin) {
  const first = D.oiUrl(ex, base, barMin);
  if (!first) return [];
  let all = D.parseOI(ex, await getJson(first));
  const last = await getJson(first).catch(() => null);
  for (let page = 0; page < 4 && all.length && all.length < 500; page++) {
    let url = '';
    if (ex === 'okx') url = first + '&end=' + all[0].t;
    else if (ex === 'bybit') { const cur = last && last.result && last.result.nextPageCursor; if (!cur || page) break; url = first + '&cursor=' + encodeURIComponent(cur); }
    else break;
    let more = [];
    try { more = D.parseOI(ex, await getJson(url, null, 300000)); } catch (e) { break; }
    if (!more.length || more[0].t >= all[0].t) break;
    all = more.filter((x) => x.t < all[0].t).concat(all);
  }
  return all;
}
class OiNative extends Base {
  constructor() { super('stk_oi', OI_SCHEMA); this.data = {}; this.err = {}; this.key = ''; }
  init() { this.iv = setInterval(() => { if (!document.hidden) { this.key = ''; this.load(); } }, 60000); }
  done() { clearInterval(this.iv); }
  blank() { return this.shape(this.nulls()); }
  shape(pts) { return [{ id: 'stk_oi-d', title: 'OI change ($M)', paneId: '', kind: 'histogram', points: pts, style: { color: this.inputs.upUp, width: 1, lineStyle: 'solid', base: 0 } }]; }
  symChanged() { this.key = ''; this.load(); }
  load() {
    if (!this.ctx) return;
    const base = baseOfCtx(this.ctx), bars = this.ctx.bars() || [], barMin = Math.max(1, Math.round(D.barMs(bars) / 60000)) || 5;
    const key = base + '|' + barMin + '|' + this.picked().join(',');
    if (!base || key === this.key) return;
    this.key = key;
    this.picked().forEach((ex) => oiHistory(ex, base, barMin).then((s) => { if (this.key !== key) return; this.data[ex] = s; this.err[ex] = s.length ? null : { status: 404 }; this.render(); },
      (err) => { if (this.key !== key) return; this.data[ex] = null; this.err[ex] = err; this.render(); }));
  }
  render() {
    if (!this.ctx || this.off) return;
    const base = baseOfCtx(this.ctx);
    if (!base) return this.note('Open interest: crypto perpetuals only');
    const picked = this.picked();
    if (!picked.length) return this.note('Open interest: pick at least one exchange in Settings');
    const bars = this.ctx.bars() || [], ms = D.barMs(bars);
    if (!bars.length || !ms) return;
    if (!this.key) this.load();
    const ready = picked.filter((e) => Array.isArray(this.data[e]) && this.data[e].length), failed = picked.filter((e) => this.err[e]);
    if (!ready.length) return this.note(failed.length === picked.length ? 'Open interest: no data from ' + failed.map((e) => D.EX_NAME[e]).join(', ') + ' (' + whyNot(this.err[failed[0]]) + ')' : 'Loading open interest…');
    const per = ready.map((e) => D.oiPerBar(this.data[e], bars, ms, D.oiPeriod(e, ms / 60000).min * 60000));
    const sum = D.sumSeries(per, bars.length), dOi = D.diffs(sum), I = this.inputs;
    const pts = bars.map((b, i) => {
      const st = D.oiState(dOi[i], isNum(b.close) && isNum(b.open) ? b.close - b.open : null);
      return { time: b.time, value: isNum(dOi[i]) ? Math.round(dOi[i] / 1e3) / 1e3 : null, color: I[st] || '#787b86' };   // $M: raw USD would not fit the axis
    });
    const last = sum.reduce((m, v) => (isNum(v) ? v : m), null);
    const miss = failed.map((e) => D.EX_NAME[e] + ' (' + whyNot(this.err[e]) + ')');
    window.__stkOi = { base, ready, failed, miss, n: sum.filter(isNum).length, nd: dOi.filter(isNum).length, maxD: dOi.reduce((m, v) => (isNum(v) ? Math.max(m, Math.abs(v)) : m), 0), last };
    this.ctx.setStatus('idle');
    this.ctx.emit({ series: this.shape(pts),
      tables: miss.length ? [msg('stk_oi-msg', 'Without ' + miss.join(', '), 'top_right')] : [] });
    this.ctx.pushData({ owner: this, sum, color: I.lineColor, line: I.line !== false, label: base + ' OI ' + D.usd(last) + ' (' + ready.map((e) => D.EX_NAME[e]).join(' + ') + ')', v: Date.now() });
  }
}
// the OI line drawn on its own scale in the OI pane (the pane's axis is the change bars)
function oiLayer() {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      if (!canvas) return;
      const g = canvas.getContext('2d'), co = a.coords, dpr = co.dpr || 1, d = a.data;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!d || !d.sum || !a.bars.length) return;
      const top = a.bounds.top, h = a.bounds.height, W = co.width, day = light();
      let v0 = 0, v1 = a.bars.length - 1;
      try { const vr = co.visibleLogicalRange(); v0 = Math.max(0, Math.floor(vr.from)); v1 = Math.min(a.bars.length - 1, Math.ceil(vr.to)); } catch (e) {}
      let lo = Infinity, hi = -Infinity;
      for (let i = v0; i <= v1; i++) { const v = d.sum[i]; if (isNum(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
      g.save(); g.beginPath(); g.rect(0, top, W, h); g.clip();
      if (d.line && Number.isFinite(lo)) {
        const pad = 8, span = hi - lo || 1, Y = (v) => top + pad + 20 + (h - 2 * pad - 20) * (1 - (v - lo) / span);   // own scale; 20 px left for the legend
        g.strokeStyle = d.color; g.lineWidth = 1.5; g.beginPath();
        let on = false;
        for (let i = v0; i <= v1; i++) {
          const v = d.sum[i]; if (!isNum(v)) { on = false; continue; }
          const x = co.timeToX(a.bars[i].time), y = Y(v);
          if (on) g.lineTo(x, y); else { g.moveTo(x, y); on = true; }
        }
        g.stroke();
      }
      g.restore();
    },
    destroy() { canvas = null; }
  };
}

// ---- Funding
const FUND_EX = ['Binance', 'Bybit', 'OKX', 'Hyperliquid'];
const FUND_SCHEMA = [
  { key: 'source', title: 'Rate history from', type: 'string', defval: 'Binance', options: FUND_EX },
  { key: 'table', title: 'Show the rates table', type: 'bool', defval: true },
  { key: 'posColor', title: 'Positive (longs pay shorts)', type: 'color', defval: UP },
  { key: 'negColor', title: 'Negative (shorts pay longs)', type: 'color', defval: DN }
];
const exOfName = (n) => D.EXCHANGES[FUND_EX.indexOf(n)] || 'binance';
class FundNative extends Base {
  constructor() { super('stk_funding', FUND_SCHEMA); this.now = {}; this.nowErr = {}; this.hist = {}; this.histErr = {}; this.key = ''; }
  init() {
    this.iv = setInterval(() => { if (!document.hidden) { this.key = ''; this.load(); } }, 60000);
    this.tick = setInterval(() => { if (!document.hidden && this.inputs.table !== false) this.render(); }, 1000);   // countdown
  }
  done() { clearInterval(this.iv); clearInterval(this.tick); }
  blank() { return this.shape(this.nulls()); }
  shape(pts) { return [{ id: 'stk_fund-h', title: 'Funding rate (bp per interval, 1 bp = 0.01%)', paneId: '', kind: 'histogram', points: pts, style: { color: this.inputs.posColor, width: 1, lineStyle: 'solid', base: 0 } }]; }
  symChanged() { this.key = ''; this.load(); }
  load() {
    if (!this.ctx) return;
    const base = baseOfCtx(this.ctx), src = exOfName(this.inputs.source);
    const key = base + '|' + src;
    if (!base || key === this.key) return;
    this.key = key;
    D.EXCHANGES.forEach((ex) => {
      const q = D.fundingNowReq(ex, base);
      getJson(q.url, q.body, 30000).then((j) => { this.now[ex] = D.parseFundingNow(ex, j, base); this.nowErr[ex] = this.now[ex] ? null : { status: 404 }; this.render(); },
        (err) => { this.now[ex] = null; this.nowErr[ex] = err; this.render(); });
      const h = D.fundingHistReq(ex, base, Date.now() - 14 * 86400000);
      getJson(h.url, h.body, 300000).then((j) => { this.hist[ex] = D.parseFundingHist(ex, j); this.histErr[ex] = null; this.render(); }, (err) => { this.hist[ex] = null; this.histErr[ex] = err; this.render(); });
    });
  }
  render() {
    if (!this.ctx || this.off) return;
    const base = baseOfCtx(this.ctx);
    if (!base) return this.note('Funding rate: crypto perpetuals only');
    if (!this.key) this.load();
    const bars = this.ctx.bars() || [], ms = D.barMs(bars), src = exOfName(this.inputs.source), I = this.inputs, day = light();
    const h = this.hist[src];
    const vals = Array.isArray(h) && bars.length && ms ? D.fundingPerBar(h, bars, ms, this.now[src]) : bars.map(() => null);
    const pts = bars.map((b, i) => ({ time: b.time, value: vals[i], color: isNum(vals[i]) && vals[i] < 0 ? I.negColor : I.posColor }));
    const tables = [];
    if (I.table !== false && !replayOn()) {
      const now = Date.now();
      const cell = (t, c, al) => ({ text: t, textColor: c || (day ? '#1d1d1f' : 'rgba(255,255,255,0.92)'), hAlign: al || 'right', vAlign: 'center', textSize: 'small', fontFamily: 'default', bold: false, italic: false });
      // one compact row (the pane is short): "OKX +0.0065% · 5h 30m / 8h" per exchange; exchanges that refuse are left out
      const row = [];
      D.EXCHANGES.forEach((ex) => {
        const n = this.now[ex], hh = this.hist[ex];
        if (!n) return;
        const ivH = n.intervalH || (Array.isArray(hh) ? D.intervalFromHist(hh) : null);
        let next = n.next; if (isNum(next) && ivH) while (next < now) next += ivH * 3600000;
        // predicted next rate only where the exchange publishes one (OKX nextFundingRate)
        row.push(cell(D.EX_NAME[ex] + ' ' + D.pct(n.rate) + (isNum(n.predicted) ? ' → ' + D.pct(n.predicted) : '') + ' · ' + D.countdown(next - now) + (ivH ? ' / ' + ivH + 'h' : ''), n.rate < 0 ? I.negColor : I.posColor, 'left'));
      });
      const off = D.EXCHANGES.filter((ex) => !this.now[ex] && this.nowErr[ex]);
      const narrow = (window.innerWidth || 1440) < 700;   // phone: one exchange per line; the history note already names a refused source
      if (off.length && !(narrow && this.histErr[src])) row.push(cell(off.map((ex) => D.EX_NAME[ex]).join(', ') + ': ' + whyNot(this.nowErr[off[0]]), day ? '#515154' : 'rgba(255,255,255,0.44)', 'left'));
      if (row.length) tables.push({ id: 'stk_fund-t', paneId: '', position: 'top_right', columns: narrow ? 1 : row.length, rows: narrow ? row.length : 1, bgColor: day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.9)', frameWidth: 0, borderWidth: 0, cells: narrow ? row.map((c) => [c]) : [row], merges: [] });
    }
    const herr = this.histErr[src];
    if (herr || (Array.isArray(h) && !h.length)) tables.push(msg('stk_fund-msg', 'Funding history: ' + D.EX_NAME[src] + ' ' + (herr ? whyNot(herr) : 'has none for ' + base) + '. Pick another exchange in Settings', 'middle_center'));
    window.__stkFunding = { base, src, now: Object.assign({}, this.now), hist: h ? h.length : null, bars: vals.filter(isNum).length };
    this.ctx.setStatus('idle');
    this.ctx.emit({ series: this.shape(pts),
      priceLines: [{ id: 'stk_fund-0', paneId: '', price: 0, color: day ? 'rgba(15,23,42,0.3)' : 'rgba(255,255,255,0.24)', lineStyle: 'dotted', width: 1, title: '' }], tables });
    try { this.ctx.pushData({ leg: D.EX_NAME[src] + ' history · bp (0.01%) per interval' }); } catch (e) {}
  }
}

// ---- Long / short ratio
const LSR_SCHEMA = [
  { key: 'source', title: 'Source', type: 'string', defval: 'Binance: all accounts', options: Object.keys(D.LSR_SOURCES) },
  { key: 'color', title: 'Ratio line', type: 'color', defval: '#00adb5' }
];
class LsrNative extends Base {
  constructor() { super('stk_lsr', LSR_SCHEMA); this.s = null; this.err = null; this.key = ''; }
  blank() { return this.shape(this.nulls()); }
  shape(pts) { return [{ id: 'stk_lsr-l', title: 'Long/short ratio', paneId: '', kind: 'line', points: pts, style: { color: this.inputs.color, width: 2, lineStyle: 'solid' } }]; }
  init() { this.iv = setInterval(() => { if (!document.hidden) { this.key = ''; this.load(); } }, 60000); }
  done() { clearInterval(this.iv); }
  symChanged() { this.key = ''; this.load(); }
  load() {
    if (!this.ctx) return;
    const base = baseOfCtx(this.ctx), bars = this.ctx.bars() || [], barMin = Math.max(1, Math.round(D.barMs(bars) / 60000)) || 5, src = this.inputs.source;
    const key = base + '|' + barMin + '|' + src;
    if (!base || key === this.key) return;
    this.key = key;
    getJson(D.lsrUrl(src, base, barMin)).then((j) => { if (this.key === key) { this.s = D.parseLsr(src, j); this.err = null; this.render(); } }, (e) => { if (this.key === key) { this.s = null; this.err = e; this.render(); } });
  }
  render() {
    if (!this.ctx || this.off) return;
    const base = baseOfCtx(this.ctx);
    if (!base) return this.note('Long/short ratio: crypto perpetuals only');
    if (!this.key) this.load();
    const src = this.inputs.source, ex = (D.LSR_SOURCES[src] || {}).ex || 'binance';
    if (this.err) return this.note('Long/short ratio: ' + D.EX_NAME[ex] + ' ' + whyNot(this.err));
    if (!this.s) return this.note('Loading long/short ratio…');
    if (!this.s.length) return this.note('Long/short ratio: ' + D.EX_NAME[ex] + ' has none for ' + base);
    const bars = this.ctx.bars() || [], ms = D.barMs(bars), step = D.oiPeriod(ex, ms / 60000).min * 60000;
    const per = D.oiPerBar(this.s.map((x) => ({ t: x.t, usd: x.ratio })), bars, ms, step);
    window.__stkLsr = { base, src, n: per.filter(isNum).length };
    this.ctx.setStatus('idle');
    this.ctx.emit({ series: this.shape(bars.map((b, i) => ({ time: b.time, value: isNum(per[i]) ? Math.round(per[i] * 1000) / 1000 : null }))),
      priceLines: [{ id: 'stk_lsr-1', paneId: '', price: 1, color: light() ? 'rgba(15,23,42,0.35)' : 'rgba(255,255,255,0.3)', lineStyle: 'dashed', width: 1, title: '' }], tables: [] });
    try { this.ctx.pushData({ leg: src }); } catch (e) {}
  }
}

const CSS = `
.stk-liq-chip{ position:absolute; bottom:8px; left:50%; transform:translateX(-50%); z-index:6; pointer-events:none; max-width:90%; padding:4px 12px; border-radius:999px;
  font:400 11px/13px ${FONT}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; background:#131316; color:rgba(255,255,255,.64); border:1px solid rgba(255,255,255,.08); font-variant-numeric:tabular-nums; }
.stk-liq-chip[hidden], .stk-liq-tip[hidden]{ display:none; }
.stk-liq-tip{ position:fixed; z-index:9050; pointer-events:none; width:min(280px, calc(100vw - 16px)); padding:12px; border-radius:12px; background:#131316; color:rgba(255,255,255,.92);
  border:1px solid rgba(255,255,255,.08); font:400 13px/18px ${FONT}; font-variant-numeric:tabular-nums; box-shadow:0 8px 24px rgba(0,0,0,.4); }
.stk-liq-h{ display:flex; align-items:center; gap:8px; font-weight:600; margin-bottom:8px; }
.stk-liq-h i{ width:8px; height:8px; border-radius:50%; flex:none; background:${UP}; }
.stk-liq-h i.long{ background:${DN}; }
.stk-liq-r{ display:flex; justify-content:space-between; gap:12px; }
.stk-liq-r span{ color:rgba(255,255,255,.64); }
.stk-liq-n{ margin-top:8px; font-size:12px; line-height:16px; color:rgba(255,255,255,.64); }
:root[data-theme="light"] .stk-liq-tip, :root[data-theme="light"] .stk-liq-chip{ background:#fff; color:#1d1d1f; border-color:rgba(0,0,0,.12); }
:root[data-theme="light"] .stk-liq-r span, :root[data-theme="light"] .stk-liq-n, :root[data-theme="light"] .stk-liq-chip{ color:#515154; }
`;

// ---------------------------------------------------------------------------------------- install
let installed = false;
export function installCryptoDeriv(Core) {
  if (installed) return;
  installed = true;
  const defs = (s) => () => Object.fromEntries(s.map((x) => [x.key, x.defval]));
  const note = (d) => (d && d.note ? d.note : '');
  const leg = (d) => (d && d.leg) || '';   // lower-pane tools: their notes sit in the pane itself, the legend keeps a short source line
  Core.registerRendererLayer({ id: 'stk_liq', placement: 'above-data', create: liqLayer });
  Core.registerRendererLayer({ id: 'stk_oi', placement: 'above-data', create: oiLayer });
  Core.registerNativeIndicator({ type: 'stk_liq', title: 'Liquidations', shortTitle: 'Liquidations', paneHint: 'price', overlay: true, reactsToViewport: true,
    inputsSchema: () => LIQ_SCHEMA, defaultInputs: defs(LIQ_SCHEMA), create: () => new LiqNative('stk_liq'), legendNote: note });
  const LB = LIQ_SCHEMA.filter((x) => x.key !== 'labels' && x.key !== 'minUsd');
  Core.registerNativeIndicator({ type: 'stk_liq_bars', title: 'Liquidations per bar (longs vs shorts)', shortTitle: 'Liquidations per bar', paneHint: 'new', overlay: false,
    inputsSchema: () => LB, defaultInputs: defs(LB), create: () => new LiqNative('stk_liq_bars'), legendNote: leg });
  Core.registerNativeIndicator({ type: 'stk_oi', title: 'Open Interest (crypto, multi-exchange)', shortTitle: 'Open Interest', paneHint: 'new', overlay: false, reactsToViewport: true,
    inputsSchema: () => OI_SCHEMA, defaultInputs: defs(OI_SCHEMA), create: () => new OiNative(), legendNote: (d) => (d && d.label) || '' });
  Core.registerNativeIndicator({ type: 'stk_funding', title: 'Funding Rate (crypto perpetuals)', shortTitle: 'Funding Rate', paneHint: 'new', overlay: false,
    inputsSchema: () => FUND_SCHEMA, defaultInputs: defs(FUND_SCHEMA), create: () => new FundNative(), legendNote: leg });
  Core.registerNativeIndicator({ type: 'stk_lsr', title: 'Long/Short Ratio (crypto)', shortTitle: 'Long/Short Ratio', paneHint: 'new', overlay: false,
    inputsSchema: () => LSR_SCHEMA, defaultInputs: defs(LSR_SCHEMA), create: () => new LsrNative(), legendNote: leg });
  const SCH = { stk_liq: LIQ_SCHEMA, stk_liq_bars: LB, stk_oi: OI_SCHEMA, stk_funding: FUND_SCHEMA, stk_lsr: LSR_SCHEMA };
  Core.registerStatePersistence({
    key: 'stryker.cryptoderiv', scope: 'cell',
    serialize(ctx) {
      const out = {};
      try { ctx.chart.indicators().forEach((h) => { if (SCH[h.nativeType]) (out[h.nativeType] = out[h.nativeType] || []).push(h.inputValues()); }); } catch (e) {}
      return Object.keys(out).length ? out : undefined;
    },
    restore(payload, ctx) {
      if (!payload || typeof payload !== 'object') return;
      let hs = []; try { hs = ctx.chart.indicators(); } catch (e) { return; }
      Object.keys(payload).forEach((type) => {
        if (!SCH[type] || !Array.isArray(payload[type])) return;
        const mine = hs.filter((h) => h.nativeType === type);
        payload[type].slice(0, 4).forEach((vals, i) => {
          if (!mine[i] || !vals || typeof vals !== 'object') return;
          const clean = {};
          SCH[type].forEach((s) => { const v = vals[s.key]; if (['string', 'number', 'boolean'].includes(typeof v)) clean[s.key] = v; });
          try { mine[i].setInputs(clean); } catch (e) {}
        });
      });
    }
  });
  if (typeof document !== 'undefined') {
    if (!document.getElementById('stk-liq-css')) { const st = document.createElement('style'); st.id = 'stk-liq-css'; st.textContent = CSS; document.head.appendChild(st); }
    document.addEventListener('pointermove', onMove, { passive: true, capture: true });
    document.addEventListener('pointerdown', onDown, { capture: true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tip) { tip.hidden = true; pinned = false; } }, true);
    window.addEventListener('pagehide', () => feeds.forEach((f) => f.flush()));
  }
}
