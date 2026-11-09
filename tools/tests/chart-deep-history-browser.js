// DEEP HISTORY browser test (history-gap2): with the switch on, NQ1! 1m and 5m scroll back ONE YEAR on a real chart, through the
// real bars API code (functions/api/chart/bars/[sym].js -> _bars.js fetchPage -> the book-recorder /hist-bars handler in
// workers/book-recorder/src/hist-store.js), reading the real backfilled bars on disk (tools/hist/backfill_m1.py output).
//   node tools/hist/hist-serve.mjs 8095 /root/tz-hist &
//   CHART_BASE=http://127.0.0.1:8095 flock /tmp/stryker-chrome.lock node tools/tests/chart-deep-history-browser.js /tmp/deep
// Signed out (delayed lane) so the old source + our store are the whole story; ?deep=1 turns the page switch on for this load.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8095', OUT = process.argv[2] || '/tmp/deep';
fs.mkdirSync(OUT, { recursive: true });
const DAY = 864e5, GOAL_DAYS = Number(process.env.GOAL_DAYS || 360);
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };

(async () => {
  const b = await launch();
  for (const [SYM, tf] of (process.env.SYMS || 'NQ,ES,MNQ,YM').split(',').flatMap((y) => (process.env.TFS || '5,1').split(',').map((t) => [y, t]))) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(stub);
    await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', 'night'); } catch (e) {} });
    // the old source is real (internet) for the young pages; nothing else leaves the box
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage(), errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(BASE + '/charts.html?deep=1', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkHistoryPager, null, { timeout: 60000 });
    const t0 = Date.now();
    const r = await p.evaluate(async ([tf, goalDays, SYM]) => {
      const ws = window.STRYKER_VELA, c = ws.cell(ws.context().cells[0].id), ch = c.chart, o = ch.orchestrator;
      c.setSymbol('futures:' + SYM + '1!'); c.setTimeframe(tf);
      for (let i = 0; i < 150; i++) { await new Promise((r) => setTimeout(r, 200)); if (String(o.config.market.timeframe) === tf && o.rawBars.length > 50 && o.historyCompleted) break; }
      const goal = Date.now() - goalDays * 864e5, start = Date.now(); let last = 0, still = 0;
      // keep the view on the oldest bar (the viewport event the pager listens to) until a year is loaded or nothing moves for 60 s
      while (o.rawBars[0].time > goal && Date.now() - start < 1500000) {
        const b = o.rawBars, v = ch.getVisibleRange(), w = Math.min(v.to - v.from, 600 * +tf * 60000);
        ch.setVisibleRange({ from: b[0].time, to: b[0].time + w });
        await new Promise((r) => setTimeout(r, 700));
        if (o.rawBars[0].time === last) { if (++still > 85) break; } else { still = 0; last = o.rawBars[0].time; }
      }
      const b = o.rawBars; let ordered = true, dup = 0;
      for (let i = 1; i < b.length; i++) { if (b[i].time === b[i - 1].time) dup++; if (!(b[i].time > b[i - 1].time)) ordered = false; }
      // the biggest hole between two bars on weekdays (a CME week has ~2 days of weekend; anything over 3 days is a gap)
      let hole = 0; for (let i = 1; i < b.length; i++) hole = Math.max(hole, b[i].time - b[i - 1].time);
      ch.setVisibleRange({ from: b[0].time, to: b[0].time + 300 * +tf * 60000 });
      return { n: b.length, oldest: b[0].time, ordered, dup, holeDays: hole / 864e5, stats: window.__stkHistoryPager.stats() };
    }, [tf, GOAL_DAYS, SYM]);
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/deep-${SYM}1-${tf}m-oldest.png` });
    const days = (Date.now() - r.oldest) / DAY;
    console.log(SYM + ' ' + tf + 'm', { n: r.n, oldest: new Date(r.oldest).toISOString(), days: days.toFixed(1), holeDays: r.holeDays.toFixed(2), secs: Math.round((Date.now() - t0) / 1000), stats: r.stats });
    check(days >= GOAL_DAYS, `${SYM}1! ${tf}m scrolls back ${GOAL_DAYS}+ days`, { days: days.toFixed(1) });
    check(r.ordered && r.dup === 0, `${SYM}1! ${tf}m bars strictly ascending, no duplicates`);
    check(r.holeDays < 4.5, `${SYM}1! ${tf}m no gap longer than a long weekend`, { holeDays: r.holeDays.toFixed(2) });
    const reads = Number(await (await p.request.get(BASE + '/__hist_reads')).text());
    check(reads > 0, `${SYM}1! ${tf}m old pages came from our store`, { reads });
    check(errors.length === 0, `${SYM}1! ${tf}m no page errors`, errors);
    await ctx.close();
  }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
