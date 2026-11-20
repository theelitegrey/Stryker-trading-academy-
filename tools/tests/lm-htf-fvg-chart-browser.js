// Liquidity Master [TradeZoro] higher-timeframe FVGs on the REAL Charts page while the chart streams (member Yuvan,
// thread 1572645626087473242, 18-20 Nov: HTF gaps appeared 5-10 min late, a 15m gap never showed). The node test
// (lm-htf-fvg-live.test.mjs) covers the script logic on pinets alone; this one covers the whole path: chart page ->
// orchestrator -> Pine worker (live stream) -> drawn model. A fake clock walks NQ1! 5m bar by bar (Sample data: a seeded
// random walk, no real prices), with the member's settings (FVG Chart + 5m + 15m + 1h + 4h, highest timeframe wins).
// Checks: every 15m and 1h gap (computed here independently) is in the drawn model within LAG_MS of real time after the first tick
// of the chart bar that follows its third 15m candle (unless a higher gap fully covers it, the member's own setting).
//   node tools/tests/chart-dev-server.mjs 8462 &
//   CHART_BASE=http://127.0.0.1:8462 flock /tmp/stryker-chrome.lock node tools/tests/lm-htf-fvg-chart-browser.js <outDir>
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8462';
const OUT = process.argv[2] || '/tmp/lm-htf-fvg-chart';
const LAG_MS = Number(process.env.LAG_MS || 4000);     // real time the live stream may take to draw a closed bar (it polls every 1 s)
const STEPS = Number(process.env.STEPS || 48);          // 5m bars walked live (4 h)
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 600))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sample data: same generator as lm-htf-fvg-live.test.mjs (seeded walk with sharp legs so 15m / 1h gaps form)
function mk(seed, N, t0){ let x = seed, p = 20000; const rnd = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
  const bars = []; let dir = 1, leg = 0;
  for (let i = 0; i < N; i++) { if (leg-- <= 0) { dir = rnd() < .5 ? 1 : -1; leg = 4 + Math.floor(rnd() * 14); } const o = p; p += dir * (2 + rnd() * 9) + (rnd() - .5) * 3; const c = Math.round(p * 4) / 4;
    bars.push({ t: t0 + i * 3e5, o, h: Math.max(o, c) + rnd() * 2, l: Math.min(o, c) - rnd() * 2, c, v: 100 }); }
  return bars.map((b) => ({ ...b, o: Math.round(b.o * 4) / 4, h: Math.round(b.h * 4) / 4, l: Math.round(b.l * 4) / 4 })); }
const T0 = Date.UTC(2026, 10, 16, 23, 0);               // Mon 18:00 New York
const HIST = 700, TOT = HIST + STEPS;
const all = mk(Number(process.env.SEED || 7), TOT, T0);
// the bars the server holds at virtual time `now` (the forming one with its final prices: the chart's own poll runs in
// parallel and a reply computed before the last tick must not roll a closed bar back to a partial one)
function served(now){ return all.filter((b) => b.t <= now); }
const partialOf = (b) => { const c = (b.o + b.c) / 2; return { t: b.t, o: b.o, h: Math.max(b.o, c), l: Math.min(b.o, c), c, v: 10 }; };

(async () => {
  let src = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'pine', 'liquidity-master-tradezoro.pine'), 'utf8').replace(/\r/g, '');
  const set = (from, to) => { if (!src.includes(from)) throw new Error('setting not found: ' + from); src = src.replace(from, to); };
  set('f5  = input.bool(false', 'f5  = input.bool(true'); set('f4h = input.bool(false', 'f4h = input.bool(true');
  set('fvgAge   = input.string("Today + yesterday"', 'fvgAge   = input.string("Last N days"');
  const b = await launch({ args: ['--js-flags=--max-old-space-size=700'] });
  let clock = all[HIST - 1].t + 3e5 + 1000;              // history all closed
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((now) => {
      try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('vela-workspace'); localStorage.removeItem('vela-workspace-090'); localStorage.setItem('stryker_theme', 'night'); } catch (e) {}
      const RealDate = Date; window.__tzOff = now - RealDate.now();
      class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + window.__tzOff); } static now() { return RealDate.now() + window.__tzOff; } }
      window.Date = FakeDate;
      window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true }; window.__stkChartTestFree = false;
    }, clock);
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
    await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => {
      const u = new URL(r.request().url()), tf = u.searchParams.get('tf') || '15';
      if (tf !== '5') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf, bars: [] }) });
      const P = 2 * 86400, page = u.searchParams.has('page') ? Number(u.searchParams.get('page')) : Math.floor(clock / 1000 / P);
      const rows = served(clock).filter((x) => Math.floor(x.t / 1000 / P) === page).map((x) => [x.t / 1000, x.o, x.h, x.l, x.c, x.v]);
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '5', page, bars: rows, rt: true }) });
    });
    await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/stream/, (r) => r.abort());
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => { try { return window.__stkHeavyReady && window.STRYKER_PINE && !!window.STRYKER_VELA.chart.renderer.renderer.userDrawings; } catch (e) { return false; } }, null, { timeout: 60000 });
    await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('5'); for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); const o = ws.chart.orchestrator; if (ws.chart.market.symbol === 'futures:NQ1!' && o.rawBars.length >= 600) break; } });
    await sleep(1500);
    const info = await p.evaluate(() => { const o = window.STRYKER_VELA.chart.orchestrator; return { n: o.rawBars.length, live: o.config.live, last: o.rawBars[o.rawBars.length - 1].time }; });
    console.log('NOTE bars', info, 'expected last', all[HIST - 1].t);
    const r = await p.evaluate((s) => window.STRYKER_PINE.addSource('Liquidity Master [TradeZoro]', s, { engine: 'next', builtin: true }), src);
    check(r && r.ok, 'Liquidity Master added', r);
    const gaps = () => p.evaluate(() => {
      const o = window.STRYKER_VELA.chart.orchestrator, rec = [...o.registry.all()].find((x) => x.model && /Liquidity Master/.test(x.model.title || ''));
      if (!rec) return null;
      return { mode: rec.session ? 'session' : 'none', boxes: (rec.model.boxes || []).map((x) => [x.left, x.top, x.bottom]), labels: (rec.model.labels || []).filter((l) => / FVG$/.test(l.text || '')).length };
    });
    let g = null;
    for (let i = 0; i < 120; i++) { await sleep(500); g = await gaps(); if (g && g.boxes.length) break; }
    check(!!g && g.boxes.length > 0, 'first draw has FVG boxes', g && { boxes: g.boxes.length, labels: g.labels });
    await sleep(3000);
    // walk the chart live: each 5m bar gets its first tick (forming) then its close, pushed the way the feed does
    const seen = new Map();                                   // box key -> real ms it was first drawn
    const note = async () => { const x = await gaps(); if (!x) return; const now = Date.now(); for (const bx of x.boxes) { const k = bx.join(','); if (!seen.has(k)) seen.set(k, now); } };
    await note();
    const dueAt = new Map();                                  // chart bar open time (ms) -> real ms of its first tick
    for (let i = HIST; i < TOT; i++) {
      const bar = all[i];
      clock = bar.t + 60000;
      await p.evaluate((c) => { window.__tzOff = c - performance.timeOrigin - performance.now(); }, clock);
      const f = partialOf(bar);
      dueAt.set(bar.t, Date.now());
      await p.evaluate((x) => window.STRYKER_VELA.chart.orchestrator.onBar(x), { time: f.t, open: f.o, high: f.h, low: f.l, close: f.c, volume: f.v });
      for (let k = 0; k < 6; k++) { await sleep(400); await note(); }
      clock = bar.t + 3e5 - 5000;                              // last tick of the bar: final prices
      await p.evaluate((c) => { window.__tzOff = c - performance.timeOrigin - performance.now(); }, clock);
      await p.evaluate((x) => window.STRYKER_VELA.chart.orchestrator.onBar(x), { time: bar.t, open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v });
      for (let k = 0; k < 4; k++) { await sleep(400); await note(); }
    }
    // independent 15m and 1h candles and their gaps (three-candle rule)
    const keys = [...seen.keys()].map((k) => k.split(',').map(Number));
    for (const [tf, ms] of [['15m', 9e5], ['1h', 36e5]]) {
      const cs = [];
      for (const x of all) { const t = Math.floor(x.t / ms) * ms, c = cs[cs.length - 1]; if (!c || c.t !== t) cs.push({ t, h: x.h, l: x.l, end: x.t + 3e5 }); else { c.h = Math.max(c.h, x.h); c.l = Math.min(c.l, x.l); c.end = x.t + 3e5; } }
      const gs = [];
      for (let i = 2; i < cs.length; i++) { const a = cs[i - 2], z = cs[i];
        if (z.l > a.h) gs.push({ left: cs[i - 1].t, top: z.l, bottom: a.h, due: z.end });
        if (z.h < a.l) gs.push({ left: cs[i - 1].t, top: a.l, bottom: z.h, due: z.end }); }
      const watched = gs.filter((x) => x.due > all[HIST].t && x.due <= all[TOT - 2].t);
      const late = [], never = [];
      for (const x of watched) {
        const k = keys.find((b) => b[0] === x.left && Math.abs(b[1] - x.top) < 1e-6 && Math.abs(b[2] - x.bottom) < 1e-6);
        const tick = dueAt.get(x.due);                        // first tick of the chart bar opening at the HTF close
        if (!k) {
          // the member's "highest timeframe wins": fine if a wider (higher) gap on the chart covers it
          if (!keys.some((b) => b[0] < x.left && b[1] >= x.top - 1e-9 && b[2] <= x.bottom + 1e-9)) never.push(new Date(x.left).toISOString().slice(5, 16));
          continue;
        }
        const lag = seen.get(k.join(',')) - tick;
        if (lag > LAG_MS) late.push({ at: new Date(x.left).toISOString().slice(5, 16), lagMs: lag });
      }
      console.log('NOTE', tf, 'gaps formed while streaming', watched.length, 'boxes seen', seen.size);
      if (tf === '15m') check(watched.length >= 3, 'sample data forms 15m FVGs while the chart streams (' + watched.length + ')');
      check(late.length === 0, 'every ' + tf + ' FVG is drawn within ' + LAG_MS + ' ms of the first tick after its third candle closes', late);
      check(never.length === 0, 'no ' + tf + ' FVG goes missing (unless a higher gap covers it)', never);
    }
    await p.screenshot({ path: path.join(OUT, 'lm-htf-fvg-1440.png') }); console.log('SHOT ' + path.join(OUT, 'lm-htf-fvg-1440.png'));
    check(!errs.length, 'no page errors', errs);
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
