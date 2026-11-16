// Browser check for the live request.security fix (member ticket 16 Nov, ATR Levels "appears and disappears").
// Runs a Pine script through the REAL Charts Pine path in Chromium: assets/chart-pine-next.js (PineNextEngine)
// -> assets/chart-pine-next-worker.js (module worker) -> pinets 0.11.0 + vela-pinets 0.2.11 from jsDelivr ->
// assets/chart-pine-next-patches.js. Live mode, a 5m chart fed synthetic bars that end now, daily data served
// through fetchSeries, then live ticks; every model the worker posts is counted (lines / labels).
// Without the fix the lines go to 0 after the first live tick; with it they stay.
//   python3 -m http.server 8195 (repo root) &
//   NODE_PATH=/root/projects/stryker-trading-academy/node_modules tools/chrome-slot.sh node tools/tests/chart-pine-live-security-browser.js
// Env: BASE (default http://127.0.0.1:8195), SRC_FILE (a Pine file; default: the reduced pattern below),
//      OLD_PATCHES (a patches file to serve instead of the repo one: the "before" run).
const fs = require('fs');
const { launch } = require('./lib.js');
const BASE = process.env.BASE || 'http://127.0.0.1:8195';
const SRC = process.env.SRC_FILE ? fs.readFileSync(process.env.SRC_FILE, 'utf8') : `//@version=6
indicator("live security", overlay=true, max_lines_count=500)
pc = request.security(syminfo.tickerid, "D", close[1], gaps=barmerge.gaps_off, lookahead=barmerge.lookahead_on)
ps = request.security(syminfo.tickerid, "D", time, gaps=barmerge.gaps_off, lookahead=barmerge.lookahead_on)
pe = request.security(syminfo.tickerid, "D", time_close, gaps=barmerge.gaps_off, lookahead=barmerge.lookahead_on)
var lines = array.new_line()
if barstate.islast
    while array.size(lines) > 0
        line.delete(array.pop(lines))
    if not na(pc) and not na(ps)
        for i = 0 to 4
            array.push(lines, line.new(ps, pc + i, pe, pc + i, xloc=xloc.bar_time, extend=extend.right))
`;
let fails = 0; const check = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) fails++; };
(async () => {
  const b = await launch();
  try {
    const ctx = await b.newContext();
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
    if (process.env.OLD_PATCHES) {
      const body = fs.readFileSync(process.env.OLD_PATCHES, 'utf8');
      await ctx.route(/\/assets\/chart-pine-next-patches\.js/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body }));
    }
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(BASE + '/404.html', { waitUntil: 'domcontentloaded' });
    const out = await p.evaluate(async (SRC) => {
      const { PineNextEngine } = await import('/assets/chart-pine-next.js');
      const TF = 300000, DAY = 864e5, N = 8000;
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const start = Math.floor((Date.now() - N * TF) / DAY) * DAY;
      const bars = []; let px = 20000;
      for (let i = 0; i < N; i++) { const o = px, c = px + (rnd() - 0.5) * 8; px = c; bars.push({ time: start + i * TF, open: o, high: Math.max(o, c) + 1, low: Math.min(o, c) - 1, close: c, volume: 100 }); }
      const daily = () => { const d = []; for (const x of bars) { const t = Math.floor(x.time / DAY) * DAY, l = d[d.length - 1]; if (l && l.time === t) { l.high = Math.max(l.high, x.high); l.low = Math.min(l.low, x.low); l.close = x.close; l.volume += x.volume; } else d.push(Object.assign({}, x, { time: t })); } return d; };
      const eng = new PineNextEngine({});
      const prepared = await eng.prepare(SRC, 'atr-test');
      const models = [], errors = [];
      const h = eng.execute({ prepared, market: { symbol: 'NQ1!', timeframe: '5' }, mode: 'live', getBars: () => bars, inputs: {},
        fetchSeries: async (sym, tf, r) => daily().filter((x) => (r.from == null || x.time >= r.from) && (r.to == null || x.time <= r.to)) },
        { onModel: (m) => models.push({ lines: m.lines.length, labels: m.labels.length, at: Date.now() }), onError: (e) => errors.push(String(e && e.message || e)) });
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let k = 0; k < 120 && !models.length && !errors.length; k++) await sleep(500);
      const first = models.length;
      for (let k = 0; k < 10; k++) {
        const l = bars[bars.length - 1];
        if (k % 4 === 3) bars.push({ time: l.time + TF, open: l.close, high: l.close + 1, low: l.close - 1, close: l.close + 0.5, volume: 10 });
        else { l.close += 1.25; l.high = Math.max(l.high, l.close); }
        h.notifyBars();
        await sleep(1500);
      }
      await sleep(2500);
      h.stop();
      return { first, models, errors };
    }, SRC);
    console.log('  models', JSON.stringify(out.models.map((m) => m.lines + '/' + m.labels)), 'errors', JSON.stringify(out.errors.slice(0, 2)), 'pageerrors', errs.length);
    check(out.first > 0 && out.models[0].lines > 0, 'first draw has the levels (' + (out.models[0] ? out.models[0].lines : 0) + ' lines)');
    const after = out.models.slice(1);
    check(after.length >= 3, 'live ticks produced redraws (' + after.length + ')');
    const lost = after.filter((m) => m.lines === 0).length;
    check(lost === 0, 'levels never vanish on live ticks (gone on ' + lost + '/' + after.length + ' redraws)');
    check(!out.errors.length, 'no engine errors');
  } catch (e) { check(false, 'run: ' + (e && e.message)); }
  finally { await b.close(); }
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
