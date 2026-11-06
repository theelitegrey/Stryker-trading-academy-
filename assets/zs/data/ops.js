// Zscript data namespaces: what book.* flow.* gex.* opt.* return for ONE bar's data frame. PURE (no DOM, no imports).
// S1's worker binds these (evalData) so the meaning of every call lives here, next to the frame builders. Education only. Not financial advice.
// A frame is plain JSON (structured-cloneable). Missing namespace / field in a frame = na (null here; the worker maps null -> na).
//   frame = { t,                                   bar open, ms
//     book: { ts, mid, bb:[[price,size]..<=20] best first, ba:[[price,size]..<=20] best first, heat:{step,i0,v:[..]}|null },
//     flow: { buy, sell, n, cvd, top:[size..<=20 desc]|null, fp:[[price,sell,buy]..<=120 asc], poc, vah, val },
//     gex:  { call, put, flip, zu, zl, net, lv:[price..<=10 ranked by |gex|], ts },
//     opt:  { nodes:[price..<=10 ranked], ranges:{'0DTE':[lo,hi],'1DTE':..,'Weekly':..,'Monthly':..}, ivrank, pc, maxpain, zone, ts } }
export const NAMESPACES = ['book', 'flow', 'gex', 'opt'];
// every callable, with its arity (the checker in S1 uses it for "did you mean" and arg counts)
export const FUNCTIONS = {
  'book.bid': [1, 1], 'book.ask': [1, 1], 'book.bidsize': [1, 1], 'book.asksize': [1, 1], 'book.depth': [2, 2], 'book.imbalance': [1, 1], 'book.wall': [2, 2], 'book.heat': [1, 1],
  'flow.buyvol': [0, 0], 'flow.sellvol': [0, 0], 'flow.delta': [0, 0], 'flow.cvd': [0, 0], 'flow.trades': [0, 0], 'flow.bigtrades': [1, 1], 'flow.footprint': [1, 2],
  'flow.poc': [0, 0], 'flow.vah': [0, 0], 'flow.val': [0, 0],
  'gex.callwall': [0, 0], 'gex.putwall': [0, 0], 'gex.flip': [0, 0], 'gex.zero_upper': [0, 0], 'gex.zero_lower': [0, 0], 'gex.net': [0, 0], 'gex.level': [1, 1],
  'opt.node': [1, 1], 'opt.range': [1, 1], 'opt.ivrank': [0, 0], 'opt.pc': [0, 0], 'opt.maxpain': [0, 0], 'opt.zone': [0, 0],
};
export const nsOf = (name) => String(name).split('.')[0];
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (fin(v) ? v : null);
const lvl = (a, n) => { n = Math.floor(n); return Array.isArray(a) && n >= 1 && n <= a.length ? a[n - 1] : null; };
const side = (s) => { s = String(s).toLowerCase(); return s === 'bid' || s === 'buy' ? 'bb' : s === 'ask' || s === 'sell' ? 'ba' : null; };
const depth = (arr, n) => { n = Math.max(0, Math.floor(n)); let sum = 0; for (let i = 0; i < n && i < arr.length; i++) sum += arr[i][1]; return sum; };

// evalData('book.bid', frame, [1]) -> number | string | [lo,hi] | null
export function evalData(name, f, a) {
  a = a || [];
  const ns = nsOf(name);
  const d = f && f[ns];
  if (!d) return null;
  switch (name) {
    case 'book.bid': { const l = lvl(d.bb, a[0]); return l ? l[0] : null; }
    case 'book.ask': { const l = lvl(d.ba, a[0]); return l ? l[0] : null; }
    case 'book.bidsize': { const l = lvl(d.bb, a[0]); return l ? l[1] : null; }
    case 'book.asksize': { const l = lvl(d.ba, a[0]); return l ? l[1] : null; }
    case 'book.depth': { const s = side(a[0]); return s && d[s] && d[s].length ? depth(d[s], a[1]) : null; }
    case 'book.imbalance': {   // (bid - ask) / (bid + ask) over the first n levels, -1..1
      const b = depth(d.bb || [], a[0]), s = depth(d.ba || [], a[0]);
      return b + s > 0 ? (b - s) / (b + s) : null;
    }
    case 'book.wall': {   // price of the nearest level at or above minSize
      const s = side(a[0]); if (!s || !fin(a[1])) return null;
      const hit = (d[s] || []).find((x) => x[1] >= a[1]); return hit ? hit[0] : null;
    }
    case 'book.heat': {   // resting size on the row holding price (bid or ask), na outside the stored band
      const h = d.heat; if (!h || !fin(a[0]) || !(h.step > 0)) return null;
      const k = Math.floor(a[0] / h.step + 1e-9) - h.i0;
      return k >= 0 && k < h.v.length ? Math.abs(h.v[k]) : null;
    }
    case 'flow.buyvol': return num(d.buy);
    case 'flow.sellvol': return num(d.sell);
    case 'flow.delta': return fin(d.buy) && fin(d.sell) ? d.buy - d.sell : null;
    case 'flow.cvd': return num(d.cvd);
    case 'flow.trades': return num(d.n);
    case 'flow.bigtrades': return d.top && fin(a[0]) ? d.top.filter((x) => x >= a[0]).length : null;   // prints >= minSize in the bar (counts the 20 largest)
    case 'flow.footprint': {   // mode: "delta" (default) | "buy" | "sell" | "total" at the row holding price
      if (!fin(a[0]) || !d.fp || !d.fp.length) return null;
      const r = nearestRow(d.fp, a[0]); if (!r) return null;
      const m = String(a[1] == null ? 'delta' : a[1]).toLowerCase();
      return m === 'buy' ? r[2] : m === 'sell' ? r[1] : m === 'total' ? r[1] + r[2] : m === 'delta' ? r[2] - r[1] : null;
    }
    case 'flow.poc': return num(d.poc);
    case 'flow.vah': return num(d.vah);
    case 'flow.val': return num(d.val);
    case 'gex.callwall': return num(d.call);
    case 'gex.putwall': return num(d.put);
    case 'gex.flip': return num(d.flip);
    case 'gex.zero_upper': return num(d.zu);
    case 'gex.zero_lower': return num(d.zl);
    case 'gex.net': return num(d.net);
    case 'gex.level': return num(lvl(d.lv, a[0]));
    case 'opt.node': return num(lvl(d.nodes, a[0]));
    case 'opt.range': {
      const k = String(a[0]).toLowerCase(), key = Object.keys(d.ranges || {}).find((x) => x.toLowerCase() === k || x.toLowerCase().replace('dte', '') === k);
      const r = key && d.ranges[key]; return r && fin(r[0]) && fin(r[1]) ? [r[0], r[1]] : null;
    }
    case 'opt.ivrank': return num(d.ivrank);
    case 'opt.pc': return num(d.pc);
    case 'opt.maxpain': return num(d.maxpain);
    case 'opt.zone': return d.zone === 'cushion' || d.zone === 'swing' ? d.zone : null;
    default: return null;
  }
}
// footprint rows are ascending by price: the row whose price is closest (within one row step)
function nearestRow(fp, p) {
  let lo = 0, hi = fp.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (fp[m][0] < p) lo = m + 1; else hi = m; }
  let best = fp[lo]; if (lo > 0 && Math.abs(fp[lo - 1][0] - p) <= Math.abs(best[0] - p)) best = fp[lo - 1];
  const step = fp.length > 1 ? Math.min(...fp.slice(1).map((r, i) => r[0] - fp[i][0]).filter((x) => x > 0), Infinity) : Infinity;
  return Math.abs(best[0] - p) <= (Number.isFinite(step) ? step : 0) + 1e-9 ? best : null;
}

// request.security without lookahead. htf = bars [{t,o,h,l,c,v}] ascending (t = open, ms), tfMs = its timeframe,
// barCloseT = close time (ms) of the chart bar being calculated. Returns the index of the newest HTF bar that has fully CLOSED by then
// (t + tfMs <= barCloseT), or -1. The forming HTF bar is never shown (that would be lookahead on history).
// live = the chart's forming bar: it may read the forming HTF bar (its running values), like the chart itself shows it.
export function htfIndexAt(htf, tfMs, barCloseT, live) {
  let lo = 0, hi = htf.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (live ? htf[m].t < barCloseT : htf[m].t + tfMs <= barCloseT) { best = m; lo = m + 1; } else hi = m - 1; }
  return best;
}
