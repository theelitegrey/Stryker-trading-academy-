// Zscript: turns the data hub's per-bar frames (S3, assets/zs/data/, contract.md "S3 DATA BINDINGS")
// into the engine's data layout (SPEC 11.3). Pure: no imports, no DOM, plain JSON in and out.
//   frames: Map<barOpenMs, frame|null> or [[barOpenMs, frame|null], ...]
//   frame = { book:{bb,ba,heat}, flow:{buy,sell,n,cvd,top,fp,poc,vah,val}, gex:{call,put,flip,zu,zl,net,lv,ts}, opt:{nodes,ranges,ivrank,pc,maxpain,zone,ts} }
// The hub only sends a bar the data known at that bar (no lookahead), so frames carry no `t` check here.
const fin = (v) => typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;
const num = (v) => (fin(v) ? v : NaN);
const ms = (ts) => (fin(ts) ? (ts < 1e12 ? ts * 1000 : ts) : NaN);   // hub stamps seconds
const pairs = (a, max) => (Array.isArray(a) ? a.slice(0, max).filter((x) => Array.isArray(x) && fin(x[0]) && fin(x[1])).map((x) => [x[0], x[1]]) : []);
const prices = (a) => (Array.isArray(a) ? a.slice(0, 20).map(num) : []);
// opt.range kinds in the language -> the hub's range keys
const RANGE_KEYS = { __proto__: null, day: '0DTE', '0dte': '0DTE', '1dte': '1DTE', week: 'Weekly', weekly: 'Weekly', month: 'Monthly', monthly: 'Monthly' };

export function bookOf(b) {
  if (!b || typeof b !== 'object') return null;
  const o = { bids: pairs(b.bb, 50), asks: pairs(b.ba, 50) };
  const h = b.heat;
  if (h && fin(h.step) && h.step > 0 && fin(h.i0) && Array.isArray(h.v)) o.heat = { step: h.step, i0: h.i0, v: h.v.slice(0, 5000).map(num) };
  return o;
}
export function gexOf(g) {
  if (!g || typeof g !== 'object') return null;
  return { callwall: num(g.call), putwall: num(g.put), flip: num(g.flip), zero_upper: num(g.zu), zero_lower: num(g.zl), net: num(g.net), levels: prices(g.lv), updated: ms(g.ts) };
}
export function optOf(p) {
  if (!p || typeof p !== 'object') return null;
  const ranges = Object.create(null);
  if (p.ranges && typeof p.ranges === 'object') {
    for (const k of Object.keys(RANGE_KEYS)) {
      const r = p.ranges[RANGE_KEYS[k]];
      if (Array.isArray(r) && fin(r[0]) && fin(r[1])) ranges[k] = [r[0], r[1]];
    }
  }
  return { nodes: prices(p.nodes), ranges, ivrank: num(p.ivrank), pc: num(p.pc), maxpain: num(p.maxpain), zone: typeof p.zone === 'string' ? p.zone.slice(0, 40) : null, updated: ms(p.ts) };
}

// times: the chart's bar open times (ms). Returns { book?, flow?, gex?, opt? } aligned with them.
export function framesToData(frames, times) {
  const get = frames instanceof Map ? (t) => frames.get(t) : (() => { const m = new Map(Array.isArray(frames) ? frames.filter(Array.isArray) : []); return (t) => m.get(t); })();
  const n = times.length;
  const seen = { book: false, flow: false, gex: false, opt: false };
  const book = new Array(n).fill(null), gex = new Array(n).fill(null), opt = new Array(n).fill(null);
  const flow = { buyvol: new Array(n).fill(NaN), sellvol: new Array(n).fill(NaN), trades: new Array(n).fill(NaN), cvd: new Array(n).fill(NaN),
    poc: new Array(n).fill(NaN), vah: new Array(n).fill(NaN), val: new Array(n).fill(NaN), bigtrades: new Array(n).fill(null), footprint: new Array(n).fill(null) };
  for (let i = 0; i < n; i++) {
    const f = get(times[i]);
    if (!f || typeof f !== 'object') continue;
    if (f.book) { book[i] = bookOf(f.book); seen.book = true; }
    if (f.gex) { gex[i] = gexOf(f.gex); seen.gex = true; }
    if (f.opt) { opt[i] = optOf(f.opt); seen.opt = true; }
    if (f.flow && typeof f.flow === 'object') { seen.flow = true; flowInto(flow, i, f.flow); }
  }
  const out = {};
  if (seen.book) out.book = book;
  if (seen.gex) out.gex = gex;
  if (seen.opt) out.opt = opt;
  if (seen.flow) out.flow = flow;
  return out;
}
function flowInto(flow, i, d) {
  flow.buyvol[i] = num(d.buy); flow.sellvol[i] = num(d.sell); flow.trades[i] = num(d.n); flow.cvd[i] = num(d.cvd);
  flow.poc[i] = num(d.poc); flow.vah[i] = num(d.vah); flow.val[i] = num(d.val);
  // the hub keeps only print sizes (largest 20) -> [price unknown, size, side unknown]
  flow.bigtrades[i] = Array.isArray(d.top) ? d.top.slice(0, 50).filter(fin).map((s) => [NaN, s, '']) : null;
  // hub rows are [price, sell, buy]; engine rows are [price, bidVol (sold), askVol (bought)]: same order
  flow.footprint[i] = Array.isArray(d.fp) ? d.fp.slice(0, 500).filter((r) => Array.isArray(r) && fin(r[0])).map((r) => [r[0], num(r[1]), num(r[2])]) : null;
}
// One live frame -> the update() `data` shape (single values, not arrays).
export function liveData(f) {
  if (!f || typeof f !== 'object') return null;
  const out = {};
  if (f.book) out.book = bookOf(f.book);
  if (f.gex) out.gex = gexOf(f.gex);
  if (f.opt) out.opt = optOf(f.opt);
  if (f.flow && typeof f.flow === 'object') {
    const one = { buyvol: [NaN], sellvol: [NaN], trades: [NaN], cvd: [NaN], poc: [NaN], vah: [NaN], val: [NaN], bigtrades: [null], footprint: [null] };
    flowInto(one, 0, f.flow);
    out.flow = {}; for (const k of Object.keys(one)) out.flow[k] = one[k][0];
  }
  return out;
}

// request.security answer from the hub: [[openMs, o, h, l, c, v], ...] -> engine bars
export function rowsToBars(rows) {
  const b = { time: [], open: [], high: [], low: [], close: [], volume: [] };
  for (const r of rows.slice(0, 50000)) {
    if (!Array.isArray(r) || !fin(r[0])) continue;
    b.time.push(r[0]); b.open.push(num(r[1])); b.high.push(num(r[2])); b.low.push(num(r[3])); b.close.push(num(r[4])); b.volume.push(num(r[5]));
  }
  return b;
}
