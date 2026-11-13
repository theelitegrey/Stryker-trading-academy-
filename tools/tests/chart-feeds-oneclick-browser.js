// L1/L2 feed chips must not overlap the paper one-click BUY/SELL box or the legend (member bug GK).
//   node tools/tests/chart-dev-server.mjs 8011; flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8011 node tools/tests/chart-feeds-oneclick-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8011', OUT = process.argv[2] || '/tmp/w1shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (ok, m, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + m + (ok ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, theme] of [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [390, 844, true, 'dark']]) {
      const tag = w + '-' + theme;
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
      await ctx.addInitScript(stub);
      await ctx.addInitScript((t) => { window.__stkL2Test = { base: 'http://127.0.0.1:9', trades: true };
        try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
      await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
      const p = await ctx.newPage();
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper, null, { timeout: 60000 });
      await sleep(1500);
      await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:MNQ1!'); ws.active.setTimeframe('1'); await new Promise((r) => setTimeout(r, 4000)); });
      await p.evaluate(() => { window.__stkPaper.setEnabled(true); window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator('stk_l2f_delta', { inputs: {} }); window.STRYKER_VELA.context().stateChanged(); });
      await sleep(5000);
      const r = await p.evaluate(() => {
        const q = (s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.offsetWidth) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
        const boxes = { chips: q('#stkfeeds-wrap'), oneClick: q('.stkpt-1c'), legend: q('.vela-statusline') };
        const hit = (a, c) => !!(a && c && a[0] < c[2] && a[2] > c[0] && a[1] < c[3] && a[3] > c[1]);
        return { boxes, chipsOneClick: hit(boxes.chips, boxes.oneClick), chipsLegend: hit(boxes.chips, boxes.legend), oneClickLegend: hit(boxes.oneClick, boxes.legend) };
      });
      console.log('INFO ' + tag, JSON.stringify(r.boxes));
      check(!!r.boxes.chips && !!r.boxes.oneClick, tag + ': both the L1/L2 chips and the BUY/SELL box are showing', r.boxes);
      check(!r.chipsOneClick && !r.chipsLegend && !r.oneClickLegend, tag + ': chips, BUY/SELL box and legend do not overlap', r);
      await p.screenshot({ path: OUT + '/oneclick-' + tag + '.png' });
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
