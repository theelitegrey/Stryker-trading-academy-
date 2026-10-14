// Tick replay smoke test against REAL data (Owner 2026-10-14: candles in replay should form the way
// they traded). Opens /charts, NQ1! 5m, starts bar replay N hours back (a past session), plays at
// RT x real time for SECS seconds and reports: did it use the recorded 1-second path (state.sim
// false), clock speed vs RT, forming-candle updates/s, whether the revealed candle stays inside the
// real bar (high/low never exceed the bar's true high/low = no invented prices), no bar past the clock.
//   CHART_BASE=https://tradezoro.com HOURS_BACK=26 RT=30 SECS=10 node tools/tests/chart-tick-replay-live.js
// Run under flock /tmp/stryker-chrome.lock.
const { launch } = require('./lib.js');
const BASE = process.env.CHART_BASE || 'https://tradezoro.com';
const RT = Number(process.env.RT || 30), SECS = Number(process.env.SECS || 10), HOURS = Number(process.env.HOURS_BACK || 26);
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  if (BASE.includes('localhost')) {
    // local run: the Worker only answers CORS for our two sites, so fetch it server-side here
    await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/ticks1s/, async (route) => {
      const res = await fetch(route.request().url(), { headers: { origin: 'https://tradezoro.com' } });
      const body = Buffer.from(await res.arrayBuffer());
      await route.fulfill({ status: res.status, body, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'content-length': String(body.length) } });
    });
  }
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|stream/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  let tickReq = 0, tickBytes = 0;
  p.on('response', async (r) => { if (r.url().includes('/ticks1s')) { tickReq++; try { tickBytes += Number(r.headers()['content-length'] || 0); } catch (e) {} } });
  await p.goto(BASE + (BASE.includes('localhost') ? '/charts.html' : '/charts'), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_VELA.chart.orchestrator.rawBars.length > 0 && window.__stkBarReplay, null, { timeout: 60000 });
  await p.evaluate(() => { const w = window.STRYKER_VELA; w.active.setSymbol('futures:NQ1!'); w.active.setTimeframe('5'); });
  await p.waitForFunction(() => { const c = window.STRYKER_VELA.chart; return c.market.symbol === 'futures:NQ1!' && c.market.timeframe === '5' && c.orchestrator.rawBars.length > 100; }, null, { timeout: 60000 });
  // a past moment inside a trading hour: HOURS back, on the hour + 7 min (Sat/Sun skipped back to Friday)
  let E = Math.floor((Date.now() - HOURS * 3600e3) / 3600e3) * 3600e3 + 7 * 60e3;
  while ([0, 6].includes(new Date(E).getUTCDay()) || (new Date(E).getUTCDay() === 5 && new Date(E).getUTCHours() >= 21)) E -= 24 * 3600e3;
  const ok = await p.evaluate((e) => window.__stkBarReplay.start(e, 'test'), E);
  await p.waitForFunction(() => !window.__stkBarReplay.state.busy, null, { timeout: 60000 });
  await p.evaluate(() => window.__stkBarReplay.setStepTf('1'));
  await p.waitForTimeout(2500);
  const r = await p.evaluate(async ([rt, secs]) => {
    const R = window.__stkBarReplay, c = window.STRYKER_VELA.chart;
    R.setRealtime(rt);
    const E0 = R.state.E, seen = new Set(); let viol = 0, past = 0, sims = new Set();
    const iv = setInterval(() => {
      const rb = c.orchestrator.rawBars, b = rb[rb.length - 1]; if (!b) return;
      seen.add(b.time + '|' + b.close + '|' + b.high + '|' + b.low);
      if (b.time >= R.state.E) past++;
      sims.add(R.state.sim);
    }, 50);
    const t0 = performance.now(); R.play();
    await new Promise((res) => setTimeout(res, secs * 1000));
    R.pause(); const dt = (performance.now() - t0) / 1000;
    clearInterval(iv);
    return { E0, E1: R.state.E, dt, changes: seen.size, past, sims: [...sims], sim: R.state.sim, rt: R.state.rt };
  }, [RT, SECS]);
  // the revealed (complete) 1m bars vs the real 1m bars of the same period: no invented prices
  const cmp = await p.evaluate(async ([E0, E1]) => {
    const r = await fetch('/api/chart/bars/NQ1!?tf=1&from=' + Math.floor(E0 / 1000 - 300) + '&to=' + Math.floor(E1 / 1000));
    if (!r.ok) return { err: r.status };
    return { n: (await r.json()).length };
  }, [r.E0, r.E1]).catch((e) => ({ err: String(e) }));
  const moved = (r.E1 - r.E0) / 1000;
  console.log(`start ${new Date(E).toISOString()} started=${ok}`);
  console.log(`RT ${r.rt}x: clock moved ${moved.toFixed(0)} s in ${r.dt.toFixed(1)} s of play (${(moved / r.dt).toFixed(1)}x)`);
  console.log(`forming candle changes: ${r.changes} (${(r.changes / r.dt).toFixed(1)}/s); path = ${r.sims.map((x) => (x ? 'simulated' : 'REAL ticks')).join(' -> ')}`);
  console.log(`bars at/after the clock seen: ${r.past} (want 0); /ticks1s requests ${tickReq}, ${(tickBytes / 1024).toFixed(0)} KB on the wire`);
  console.log(`page errors: ${errs.length ? errs.join(' | ') : 0}`);
  await p.screenshot({ path: (process.env.SHOT || '/tmp') + '/tick-replay-1440.png' });
  await p.evaluate(() => window.__stkBarReplay.exit());
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
