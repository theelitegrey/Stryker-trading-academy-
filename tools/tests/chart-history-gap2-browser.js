// History gap 2 (member GK 08 Nov, build 925): signed in + live-data agreement = the TICK ENGINE lane. NQ1! 1m showed candles only from
// the record start (~3 days back) and nothing older, refresh did not help. Signed out (old lane) scrolled back fine.
// Cause: chart-tick-engine.js teGetBars memoised the "older than the record" read by the record start only, so every scroll-back read
// got the first load's chunk again -> nothing older -> Vela 'genesis' -> scroll-back stopped. On a weekend the first window was also
// short, so the old source filled in FRONT of record bars that were simply outside that window.
// FIXTURES only: tick-engine-hub.py in DAYS mode (record of N days, optional quiet hours = weekend) + /api/chart/bars routed to a
// fixture page server (one bar per step back 60 days). No Worker, no key, no member account (signed-in lane = _rtSetForTests + ?engine=1).
//   python3 tools/tests/tick-engine-hub.py 8091 1 &        # weekday: record 1 d, trading now
//   python3 tools/tests/tick-engine-hub.py 8092 2.5 40 &   # weekend: record 2.5 d, last 40 h quiet
//   node tools/tests/chart-dev-server.mjs 8090 &
//   CHART_BASE=http://127.0.0.1:8090 flock /tmp/stryker-chrome.lock node tools/tests/chart-history-gap2-browser.js /tmp/hg2
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8090', OUT = process.argv[2] || '/tmp/hg2';
const HUBS = { weekday: process.env.HUB_WD || 'http://127.0.0.1:8091', weekend: process.env.HUB_WE || 'http://127.0.0.1:8092' };
fs.mkdirSync(OUT, { recursive: true });
const V = JSON.parse(fs.readFileSync(__dirname + '/../../assets/version.json', 'utf8')).build;
const DAY = 864e5;
const PAGE = { 1: 8 * 3600, 5: 2 * 86400, 15: 5 * 86400 };   // = PAGE_SECS in chart-futures-provider.js
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };

// fixture old source: every page within 60 days holds one bar per step (seconds), nothing in the future
function fixturePage(url) {
  const tf = +/tf=(\d+)/.exec(url)[1], ps = PAGE[tf], step = tf * 60, now = Math.floor(Date.now() / 1000);
  const m = /page=(\d+)/.exec(url), page = m ? +m[1] : Math.floor(now / ps);
  const rows = [];
  for (let t = page * ps; t < (page + 1) * ps && t <= now - 600; t += step) if (t > now - 60 * 86400) rows.push([t, 100, 101, 99, 100.5, 777]);
  return JSON.stringify({ s: 'NQ', tf: String(tf), page, bars: rows, rt: true });
}

async function open(b, hub, w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((h) => { window.__STK_BOOK_RECORDER = h; try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', 'night'); } catch (e) {} }, hub);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/\/api\/chart\/bars\/[A-Z0-9%!]+\?tf=(1|5|15)(&|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: fixturePage(r.request().url()) }));
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html?engine=1', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkHistoryPager, null, { timeout: 60000 });
  await p.evaluate(async (v) => { (await import('/assets/rt-access.js?v=' + v))._rtSetForTests(true, 'test-token'); }, V);
  return { ctx, p, errors };
}
const setMkt = (p, idx, sym, tf) => p.evaluate(async ([idx, sym, tf]) => {
  const ws = window.STRYKER_VELA, c = ws.cell(ws.context().cells[idx].id);
  c.setSymbol('futures:' + sym); c.setTimeframe(tf);
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const o = c.chart.orchestrator;
    if (String(o.config.market.timeframe) === tf && o.config.market.symbol === 'futures:' + sym && o.rawBars.length > 50 && o.historyCompleted && !o.switchingMarket) break;
  }
  await new Promise((r) => setTimeout(r, 1200));
}, [idx, sym, tf]);
const st = (p, idx) => p.evaluate((idx) => {
  const c = window.STRYKER_VELA.context().cells[idx].chart, o = c.orchestrator, b = o.rawBars, R = c.renderer.renderer.wrapper.getBoundingClientRect();
  let ordered = true; for (let i = 1; i < b.length; i++) if (!(b[i].time > b[i - 1].time)) { ordered = false; break; }
  return { n: b.length, oldest: b[0] && b[0].time, newest: b[b.length - 1] && b[b.length - 1].time, ordered, busy: !!(c.__stkPager && c.__stkPager.busy), rect: { x: R.x, y: R.y, w: R.width, h: R.height } };
}, idx);
// drag back until the oldest bar is older than `goal` (ms) or `times` drags are used (a zoomed-in cell pans fewer bars a drag)
async function dragBack(p, idx, times, goal) {
  for (let i = 0; i < times; i++) {
    if (i >= 6 && (await st(p, idx)).oldest < goal) break;
    const s = await st(p, idx), y = s.rect.y + s.rect.h * 0.45, x0 = s.rect.x + s.rect.w * 0.15;
    await p.mouse.move(x0, y); await p.mouse.down();
    for (let k = 1; k <= 10; k++) { await p.mouse.move(x0 + (s.rect.w * 0.7 * k) / 10, y); await p.waitForTimeout(16); }
    await p.waitForTimeout(120); await p.mouse.up();
    // after 6 real drags, jump the view to the oldest bar (same viewport event the pager listens to): a zoomed-in cell pans few bars a drag
    if (i >= 6) await p.evaluate((idx) => { const c = window.STRYKER_VELA.context().cells[idx].chart, b = c.orchestrator.rawBars, v = c.getVisibleRange(); c.setVisibleRange({ from: b[0].time, to: b[0].time + (v.to - v.from) }); }, idx);
    for (let k = 0; k < 40; k++) { if (!(await st(p, idx)).busy) break; await p.waitForTimeout(250); }
  }
  await p.waitForTimeout(2000);
}
const recStart = async (hub) => (await (await fetch(hub + '/te-bars?sym=NQ&tf=1&from=0&to=' + (Date.now() + 60000) + '&limit=1')).json()).rec;

async function caseRun(b, day, sym, tf, two) {
  const hub = HUBS[day], rec = await recStart(hub);
  const { ctx, p, errors } = await open(b, hub, 1440, 900);
  const tag = `${day} ${sym} ${tf}m${two ? ' 2-chart+EMA' : ''}`;
  const cells = two ? 2 : 1;
  if (two) { await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('2h')); await p.waitForTimeout(2500); }
  for (let i = 0; i < cells; i++) {
    await setMkt(p, i, sym, tf);
    if (two) {
      const ok = await p.evaluate((i) => { const c = window.STRYKER_VELA.context().cells[i].chart; c.addNativeIndicator('ema'); return c.indicators().some((h) => h.nativeType === 'ema'); }, i);
      check(ok, `${tag} chart${i}: EMA indicator on the chart`);
    }
  }
  for (let i = 0; i < cells; i++) {
    const s0 = await st(p, i);
    await dragBack(p, i, tf === '1' ? 30 : 8, rec - DAY);
    const s = await st(p, i);
    const daysBack = (Date.now() - s.oldest) / DAY;
    const pg = await p.evaluate((i) => { const c = window.STRYKER_VELA.context().cells[i].chart, st = c.__stkPager || {}; return { stats: window.__stkHistoryPager.stats(), reason: st.reason, fails: st.fails, ex: [...(st.exhausted || new Map()).entries()].map(([k, v]) => [k.slice(-14), v - Date.now()]), vr: c.getVisibleRange() }; }, i);
    console.log(tag, 'chart' + i, { n0: s0.n, n: s.n, oldest: new Date(s.oldest).toISOString(), rec: new Date(rec).toISOString(), pager: pg, view: new Date(pg.vr.from).toISOString() });
    check(s.ordered, `${tag} chart${i}: bars strictly ascending`);
    check(s.oldest < rec - DAY / 2, `${tag} chart${i}: scroll-back reaches more than 12 h before the record start`, { oldest: new Date(s.oldest).toISOString(), rec: new Date(rec).toISOString(), daysBack: daysBack.toFixed(1) });
    if (day === 'weekend') {
      // the record's own bars (before the quiet hours) must be on the chart: the old source must not have filled in front of them
      const recBars = await p.evaluate(([i, rec]) => window.STRYKER_VELA.context().cells[i].chart.orchestrator.rawBars.filter((x) => x.time >= rec && x.volume !== 777).length, [i, rec]);
      check(recBars > 50, `${tag} chart${i}: record bars before the weekend are shown (${recBars})`);
    }
  }
  await p.screenshot({ path: `${OUT}/${day}-${sym}-${tf}${two ? '-two' : ''}.png` });
  check(errors.length === 0, `${tag}: no page errors`, errors.slice(0, 2));
  await ctx.close();
}

(async () => {
  const b = await launch();
  try {
    for (const day of ['weekday', 'weekend']) {
      if (process.env.ONLY !== 'two') for (const sym of ['NQ1!', 'ES1!']) for (const tf of ['1', '5', '15']) await caseRun(b, day, sym, tf, false);
      await caseRun(b, day, 'NQ1!', '1', true);
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
