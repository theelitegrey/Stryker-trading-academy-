// Member GK 16 Nov: "In the Depth Heatmap indicator, Volume Bubbles are not loading, but Big Trades are working fine. Also, the
// Heatmap liquidity levels are not loading properly along with the right-side price scale." (NQ1! 1m, book feed down, trades fine)
//   node tools/tests/hm-bubbles.test.mjs
// Renders the real Depth Heatmap layer (dhLayer) on a recording 2D context with a futures hub feed that has trades but no current book:
// 1. bubbles: the view reaches past the 3 h of footprint minutes the hub seeds -> the layer asks for the older minutes (fpNeed), as the
//    Footprint does; bubbles come from trades only (no book needed).
// 2. right-side book column: the live book is empty (feed down), the last recorded sample is older than the view -> the column still
//    draws that last recorded book, labelled with its time (never a made-up book); a live book draws with no label.
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
globalThis.document = globalThis.document || { hidden: false, addEventListener() {}, removeEventListener() {}, documentElement: { getAttribute() { return ''; } } };
document.createElement = () => ({ width: 0, height: 0, getContext: () => ctx2d(), style: {} });   // the 2D heat pass draws into an offscreen canvas
globalThis.location = { hostname: '127.0.0.1', host: '127.0.0.1' };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.WebSocket = class { constructor() { this.readyState = 0; } send() {} close() {} };
window.__stkL2Test = { base: 'http://rec' };
const reqs = [];
globalThis.fetch = async (url) => { reqs.push(String(url)); return { ok: true, status: 200, json: async () => ({ fp: [], imb: [] }), arrayBuffer: async () => new ArrayBuffer(8), headers: { get: () => '0' } }; };
let n = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? '' : ' ' + JSON.stringify(x))); n++; console.log('PASS ' + m); };
const V = JSON.parse(fs.readFileSync(new URL('../../assets/version.json', import.meta.url), 'utf8')).build;
const L2 = await import('../../assets/chart-futures-l2.js?v=' + V);   // the instance chart-depth-heatmap.js imports
const D = await import('../../assets/chart-depth-heatmap.js');

// a 2D context that records text and accepts every call
function ctx2d() {   // hoisted: also the offscreen canvas' context
  const texts = [];
  const g = new Proxy({ texts }, { get(t, k) {
    if (k in t) return t[k];
    if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
    if (k === 'fillText') return (s) => texts.push(String(s));
    if (/Gradient$/.test(k)) return () => ({ addColorStop() {} });
    if (k === 'createImageData' || k === 'getImageData') return (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w, height: h });
    return () => {};
  }, set(t, k, v) { t[k] = v; return true; } });
  return g;
}
const MIN = 60000, now = Date.now(), t1 = Math.floor(now / MIN) * MIN;
const bars = []; for (let k = 299; k >= 0; k--) bars.push({ time: t1 - k * MIN, open: 28000, high: 28002, low: 27998, close: 28000 + (k % 5), volume: 10 });
const T0 = bars[0].time, W = 1200, pxPerMin = W / 320;
const co = { width: W, dpr: 1, timeToX: (t) => (t - T0) / MIN * pxPerMin, priceToY: (p) => 400 - (p - 28000) * 10, pxPerBar: () => pxPerMin, getViewport: () => ({ barSpacing: pxPerMin, rightOffset: 100 }) };
const step = 1, rec = (ts) => ({ ts, mid: 28000, bb: 27999.75, ba: 28000.25, step, i0: 27990, v: Float32Array.from({ length: 20 }, (_, k) => (k < 10 ? 50 + k : -(50 + k))) });
function mkFeed(opts) {
  const tf = L2.rootState('NQ').trades || (L2.rootState('NQ').trades = new L2.TickFeed('NQ'));
  return { key: 'tsl2:NQ', ticker: 'NQ', version: 1, custom: { trades: () => tf }, book: opts.book, history: [], remote: opts.remote, allHistory: () => opts.remote,
    needRemote() {}, status: 'live' };
}
function render(f, cfgIn) {
  const H = { beginFrame: () => g, bookFeeds: new Map([[f.key, f]]), feedTrades: () => null };
  const g = ctx2d(), layer = D.dhLayer(H);
  layer.mount({ style: {}, parentElement: null });
  layer.render({ coords: co, bars, bounds: { top: 0, height: 800 }, scale: { max: 28040, min: 27960 }, theme: {}, data: { feed: f.key, cfg: D.dhConfig(Object.assign({ gpuHeatmap: false }, cfgIn)), stale: '', tz: 'Etc/UTC' } });
  return { g, stat: D.dhDebug() };
}
const emptyBook = { bids: new Map(), asks: new Map(), bestBid: null, bestAsk: null, ts: 0 };

// ---- 1. bubbles from trades only; older footprint minutes are paged in for the view
const r = L2.rootState('NQ'); r.trades = new L2.TickFeed('NQ'); r.fpFrom = now - 3 * 3600000;   // the seed covered the last 3 h
r.trades.seed([{ t: t1 / MIN - 30, lv: [[28001, 40, 10]] }, { t: t1 / MIN - 20, lv: [[28002, 5, 30]] }], true);
let { stat } = render(mkFeed({ book: emptyBook, remote: [] }), {});
ok(stat.bubbles >= 2, 'no order book at all: volume bubbles still drawn from the trades', stat.bubbles);
ok(r.fpNeed > 0 && r.fpNeed <= T0, 'view starts 5 h back: the layer asks the hub for the footprint minutes from the view start (fpNeed)', [r.fpNeed, T0]);
await new Promise((ok) => setTimeout(ok, 30));
ok(reqs.some((u) => /\/ts-aux\?symbol=NQ/.test(u)), 'and that read goes to /ts-aux (trades history, not the book)', reqs);
r.fpNeed = 0;
({ stat } = render(mkFeed({ book: emptyBook, remote: [] }), { showBubbles: false, showVolume: false }));
ok(!r.fpNeed, 'bubbles and volume bars off: no extra footprint read');

// ---- 2. right-side book column with no live book
const old = now - 6 * 3600000;   // the last recorded sample, before the view (the feed stopped 6 h ago)
let out = render(mkFeed({ book: emptyBook, remote: [rec(old - 60000), rec(old)] }), {});
ok(out.stat.ladderRows > 0, 'live book empty, last recorded sample older than the view: the book column is still drawn', out.stat.ladderRows);
ok(out.stat.bookAsOf === old, 'from the last recorded sample', out.stat.bookAsOf);
const lab = new Date(old).toISOString().slice(11, 16);
ok(out.g.texts.some((x) => x.endsWith(lab) && x.startsWith('BOOK AT ')), 'and a row under the column header says the time of that book (' + lab + ')', out.g.texts.slice(0, 6));
out = render(mkFeed({ book: emptyBook, remote: [] }), {});
ok(!out.stat.ladderRows && !out.stat.bookAsOf && out.stat.ladderNote === 'NO BOOK', 'nothing recorded at all: price rows + NO BOOK header, no sizes (never a made-up book)', out.stat);
ok(out.g.texts.includes('28000') && out.g.texts.includes('NO BOOK') && !out.g.texts.some((x) => / \| /.test(x)), 'the column keeps its price labels; no best bid | ask tag', out.g.texts.slice(0, 8));
const live = { bids: new Map([[27999.75, 12]]), asks: new Map([[28000.25, 9]]), bestBid: 27999.75, bestAsk: 28000.25, ts: now };
out = render(mkFeed({ book: live, remote: [rec(old)] }), {});
ok(out.stat.ladderRows > 0 && !out.stat.bookAsOf && !out.g.texts.some((x) => x.endsWith(lab)), 'live book present: drawn as before, no time label', out.stat.bookAsOfTxt);
out = render(mkFeed({ book: emptyBook, remote: [rec(now - 2 * 60000)] }), {});
ok(out.stat.ladderRows > 0 && !out.stat.bookAsOfTxt, 'recorded book 2 min old (between live frames): no label (only a gap of 15 min or more is labelled)', out.stat.bookAsOfTxt);
ok(D.lastTsAt([{ ts: 1 }, { ts: 5 }, { ts: 9 }], 6) === 5 && D.lastTsAt([], 6) === 0, 'lastTsAt: the newest sample at or before t');
console.log(n + ' passed');
