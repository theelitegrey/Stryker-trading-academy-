// TradeZoro — Dark Pool Prints on FUTURES charts: moves each ETF print onto the futures price. ES module, no DOM.
// Owner order 2026-11-07. ES/MES -> SPY, NQ/MNQ -> QQQ, YM/MYM -> DIA, RTY/M2K -> IWM.
// Rule: futures price at the print's time ≈ ETF print price × (futures price / ETF price at that same minute).
// Both prices are the CLOSE of the 1-minute bar. If the print's minute has no bar on either side, the nearest minute (earlier wins a tie)
// that has both is used, within 5 minutes; otherwise the print is skipped (never guessed).
// Bars: our own /api/chart/bars/<FUT>1! and /api/chart/bars/<ETF> (tf=1, 8-hour pages). No new supplier calls.
// Used by assets/chart-darkpool.js. Tests: tools/tests/chart-darkpool-map.test.mjs.

export const FUT_ETF = { ES: 'SPY', MES: 'SPY', NQ: 'QQQ', MNQ: 'QQQ', YM: 'DIA', MYM: 'DIA', RTY: 'IWM', M2K: 'IWM' };
export const MAX_GAP_MIN = 5;
const MIN = 60000, PAGE_S = 8 * 3600;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// chart symbol ('futures:ES1!', 'CME_MINI:NQ1!', 'MES1!') -> futures root with a matching ETF, or ''. A bare "ES" is a stock, so a futures form is required.
export function futRoot(symbol) {
  const s = String(symbol || '').toUpperCase().replace(/\s+/g, '');
  const last = s.split(':').pop();
  const m = /^([A-Z0-9]{2,3})1!$/.exec(last);
  const root = m ? m[1] : (/^FUTURES:/.test(s) ? last : '');
  return Object.prototype.hasOwnProperty.call(FUT_ETF, root) ? root : '';
}
// 1m bar rows [[t sec, o, h, l, c, v], ...] -> Map(minute start ms -> close)
export function minuteIndex(rows) {
  const m = new Map();
  for (const r of rows || []) if (Array.isArray(r) && isNum(r[0]) && isNum(r[4]) && r[4] > 0) m.set(Math.floor(r[0] / 60) * MIN, r[4]);
  return m;
}
// the minute used for the ratio: the print's own minute, else the nearest minute with a bar on BOTH sides (<= maxMin away)
export function pairAt(tMs, futIdx, etfIdx, maxMin = MAX_GAP_MIN) {
  const m0 = Math.floor(tMs / MIN) * MIN;
  for (let d = 0; d <= maxMin; d++) {
    for (const m of d ? [m0 - d * MIN, m0 + d * MIN] : [m0]) {
      const f = futIdx.get(m), e = etfIdx.get(m);
      if (isNum(f) && isNum(e)) return { minute: m, fut: f, etf: e, ratio: f / e };
    }
  }
  return null;
}
// one print {t,p,...} -> copy with p = futures price, ep = the ETF price, ratio; or null (skip)
export function mapPrint(x, futIdx, etfIdx) {
  const a = pairAt(x.t, futIdx, etfIdx);
  if (!a) return null;
  return Object.assign({}, x, { p: Math.round(x.p * a.ratio * 100) / 100, ep: x.p, ratio: a.ratio });
}
export function mapPrints(list, futIdx, etfIdx) {
  const out = [];
  for (const x of list) { const y = mapPrint(x, futIdx, etfIdx); if (y) out.push(y); }
  return { list: out, skipped: list.length - out.length };
}
// page numbers (8 h, epoch-aligned, as functions/api/chart/_bars.js) holding the prints, plus the page before each (a minute near the page start)
export function pagesFor(list) {
  const s = new Set();
  for (const x of list) { const p = Math.floor(x.t / 1000 / PAGE_S); s.add(p); if ((x.t / 1000) % PAGE_S < MAX_GAP_MIN * 60) s.add(p - 1); }
  return [...s].sort((a, b) => a - b);
}

// ---- fetch (browser) ------------------------------------------------------------------------------
const pageCache = new Map();   // 'SYM|page' -> { at, p }
const PAGE_TTL = 5 * 60 * 1000;
function page(sym, n) {
  const k = sym + '|' + n, e = pageCache.get(k);
  if (e && Date.now() - e.at < PAGE_TTL) return e.p;
  const p = fetch('/api/chart/bars/' + encodeURIComponent(sym) + '?tf=1&page=' + n, { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null)).then((j) => (j && Array.isArray(j.bars) ? j.bars : [])).catch(() => []);
  pageCache.set(k, { at: Date.now(), p });
  return p;
}
async function pool(jobs, n) {
  const out = new Array(jobs.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (i < jobs.length) { const j = i++; out[j] = await jobs[j](); } }));
  return out;
}
// list = ETF prints (all sizes wanted). Resolves { list, skipped } with prices on the futures.
export async function loadMapped(root, list) {
  const etf = FUT_ETF[root], pg = pagesFor(list);
  const res = await pool(pg.flatMap((n) => [() => page(root + '1!', n), () => page(etf, n)]), 4);
  const f = [], e = [];
  res.forEach((r, i) => (i % 2 ? e : f).push(...r));
  return mapPrints(list, minuteIndex(f), minuteIndex(e));
}
