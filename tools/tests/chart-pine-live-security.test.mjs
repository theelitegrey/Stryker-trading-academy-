// Regression test: request.security values on a LIVE chart must survive live ticks.
// Member ticket 16 Nov 2026 ("my custom indicator appears and disappears"): a Zscript that reads the
// daily close / time with request.security(..., lookahead_on) and draws its levels on barstate.islast
// lost them on live ticks and got them back only when the script restarted. Cause (pinets 0.11.0):
// the request.security secondary context had no pre-last-bar snapshot, so each live refresh
// (updateTail) popped its last bar twice, and a refreshed bar without closeTime lost its close time.
// Fix: patchPretranspiled in assets/chart-pine-next-patches.js.
//
// Needs a local pinets 0.11.0 (not a repo dependency), same as chart-pine-next-patches.test.mjs:
//   PINETS=/path/to/node_modules/pinets node tools/tests/chart-pine-live-security.test.mjs
// UNPATCHED=1 runs without the fix (expected to FAIL; proves the test catches the bug).
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PINETS = process.env.PINETS;
if (!PINETS) { console.log('SKIP: set PINETS=<path to node_modules/pinets>'); process.exit(0); }
const pt = await import(pathToFileURL(path.join(PINETS, 'dist', 'pinets.min.es.js')).href);
const patches = await import(pathToFileURL(path.join(here, '..', '..', 'assets', 'chart-pine-next-patches.js')).href);
if (!process.env.UNPATCHED) patches.install(pt.Context, pt, null);

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

// The member script's pattern, reduced: daily values via request.security + lookahead_on, levels
// drawn only on the last bar (delete + redraw).
const SRC = `//@version=6
indicator("live security", overlay=true)
pc = request.security(syminfo.tickerid, "D", close[1], gaps=barmerge.gaps_off, lookahead=barmerge.lookahead_on)
ps = request.security(syminfo.tickerid, "D", time, gaps=barmerge.gaps_off, lookahead=barmerge.lookahead_on)
var lines = array.new_line()
if barstate.islast
    while array.size(lines) > 0
        line.delete(array.pop(lines))
    if not na(pc) and not na(ps)
        array.push(lines, line.new(ps, pc, ps + 86400000, pc, xloc=xloc.bar_time))
plot(pc, "pc")
plot(ps, "ps")
plot(array.size(lines), "n")
`;

const TF = 5 * 60000, DAY = 864e5;
function makeFeed(withClose){
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const n = 40 * 288;                       // 40 days of 5m bars ending now
  const start = Math.floor((Date.now() - n * TF) / DAY) * DAY;
  const bars = []; let p = 20000;
  for (let i = 0; i < n; i++) {
    const o = p, c = p + (rnd() - 0.5) * 8; p = c;
    bars.push({ openTime: start + i * TF, open: o, high: Math.max(o, c) + 1, low: Math.min(o, c) - 1, close: c, volume: 100 });
  }
  const close = (b, len) => withClose ? Object.assign({}, b, { closeTime: b.openTime + len }) : Object.assign({}, b);
  const daily = () => {
    const out = [];
    for (const b of bars) {
      const t = Math.floor(b.openTime / DAY) * DAY, l = out[out.length - 1];
      if (l && l.openTime === t) { l.high = Math.max(l.high, b.high); l.low = Math.min(l.low, b.low); l.close = b.close; l.volume += b.volume; }
      else out.push(Object.assign({}, b, { openTime: t }));
    }
    return out.map((b) => close(b, DAY));
  };
  const provider = {
    getMarketData: async (ticker, tf, limit, sDate, eDate) => {
      const src = String(tf) === 'D' || String(tf) === '1D' ? daily() : bars.map((b) => close(b, TF));
      return src.filter((b) => (sDate == null || b.openTime >= sDate) && (eDate == null || b.openTime <= eDate));
    },
    getSymbolInfo: async () => ({ ticker: 'NQ1!', tickerid: 'NQ1!', prefix: '', root: 'NQ1!', type: 'futures', currency: 'USD', timezone: 'UTC', session: '24x7', mintick: 0.25, minmove: 1, pointvalue: 1, pricescale: 4 })
  };
  return { bars, daily, provider, tick(newBar){
    const l = bars[bars.length - 1];
    if (newBar) bars.push({ openTime: l.openTime + TF, open: l.close, high: l.close + 1, low: l.close - 1, close: l.close + 0.5, volume: 10 });
    else { l.close += 1.25; l.high = Math.max(l.high, l.close); }
  } };
}

const last = (ctx, key) => { const p = ctx.plots[key]; return p && p.data.length ? p.data[p.data.length - 1].value : undefined; };
const ok = (v) => typeof v === 'number' && Number.isFinite(v);

for (const withClose of [true, false]) {
  const tag = withClose ? 'feed with closeTime' : 'feed without closeTime';
  const f = makeFeed(withClose);
  const pine = new pt.PineTS(f.provider, 'NQ1!', '5', f.bars.length);
  const ctx = await pine.run(SRC);
  const d = f.daily(), want = d[d.length - 2].close, wantT = d[d.length - 1].openTime;
  check(ok(last(ctx, 'pc')) && Math.abs(last(ctx, 'pc') - want) < 1e-6 && last(ctx, 'ps') === wantT && last(ctx, 'n') === 1,
    tag + ': first run reads yesterday\'s close / today\'s open time and draws its line');
  let bad = 0, wrong = 0, gone = 0;
  for (let k = 0; k < 12; k++) {
    f.tick(k % 4 === 3);                    // ticks on the forming bar, a new 5m bar every 4th
    await pine.updateTail(ctx);
    const pc = last(ctx, 'pc'), ps = last(ctx, 'ps');
    if (!ok(pc) || !ok(ps)) bad++;
    else if (Math.abs(pc - want) > 1e-6 || ps !== wantT) wrong++;
    if (last(ctx, 'n') !== 1) gone++;
  }
  check(bad === 0, tag + ': request.security never na on live ticks (na on ' + bad + '/12)');
  check(wrong === 0, tag + ': values stay on the right daily bar (wrong on ' + wrong + '/12)');
  check(gone === 0, tag + ': the drawn level stays on the chart (missing on ' + gone + '/12)');
  const sec = Object.values(ctx.cache || {}).find((c) => c && c.context && c.pineTS);
  if (sec) check(sec.context.data.openTime.data.length === sec.pineTS.data.length, tag + ': daily context keeps all its bars (' + sec.context.data.openTime.data.length + '/' + sec.pineTS.data.length + ')');
}

// The patch is idempotent and leaves a run without live ticks unchanged.
check(patches.patchPretranspiled(pt.PineTS) === false || !!process.env.UNPATCHED, 'patchPretranspiled installs once');

console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
