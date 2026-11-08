// GEX-FAST2 (2026-11-08): the Charts "GEX updated ..." chip ages the options inputs, not the futures quote.
//   node tools/tests/chart-dev-server.mjs 8031 &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8031 node tools/tests/gex-age-browser.js [shotsDir]
// Fixture: tools/tests/fixtures/gex/SPX-0.json re-stamped the way the API answers in the session today: options inputs
// 40 s old (market.options_ts), futures 5-min bar 10 min old (market.data_ts). Before the fix the chip read "10 min ago".
// Shots: 390 dark, 1440 dark, 1440 light (ES 5m with the GEX levels).
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const FIX = path.join(__dirname, 'fixtures', 'gex');
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick|binance|coinbase|hyperliquid|bybit)\./, (r) => r.abort());
  await ctx.route(/\/api\/gex\/levels\//, (r) => {
    const name = new URL(r.request().url()).pathname.split('/').pop().toUpperCase();
    try {
      const d = JSON.parse(fs.readFileSync(path.join(FIX, name + '-0.json')));
      const now = Date.now() / 1000;
      d.market = Object.assign({}, d.market, { state: 'open', options_ts: now - 40, now, data_ts: now - 600 }); d.fetched_at = now;
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
    } catch (e) { r.fulfill({ status: 404, body: '{}' }); }
  });
  const p = await ctx.newPage();
  await p.emulateMedia({ colorScheme: theme });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 45000 });
  await p.evaluate(async () => {
    const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol('futures:ES1!'); c.setTimeframe('5');
    for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (ws.context().cells[0].chart.orchestrator.rawBars.length > 20) break; } catch (e) {} }
    ws.context().cells[0].chart.addNativeIndicator('stk_gex', { inputs: { dte: '0' } }); ws.context().stateChanged();
  });
  let chip = '';
  for (let i = 0; i < 40 && !/updated|GEX \d|GEX just/.test(chip); i++) { await sleep(500); chip = await p.evaluate(() => { const c = document.querySelector('.stk-gex-chip'); return c && !c.hidden ? c.textContent : ''; }); }
  return { ctx, p, errors, chip };
}

(async () => {
  const b = await launch();
  try {
    for (const v of [{ w: 390, h: 844, mobile: true, theme: 'dark', n: '390-dark' }, { w: 1440, h: 900, theme: 'dark', n: '1440-dark' }, { w: 1440, h: 900, theme: 'light', n: '1440-light' }]) {
      const s = await open(b, v);
      check(/GEX live/.test(s.chip), v.n + ': chip "' + s.chip + '" (options 40 s old, futures 10 min old)');
      check(!/10 ?m(in)? ago/.test(s.chip), v.n + ': chip no longer shows the futures age');
      check(!/live|real-time|delayed|behind/i.test(s.chip), v.n + ': wording');
      check(!s.errors.length, v.n + ': no page errors ' + s.errors.slice(0, 2).join(' | '));
      const f = OUT + '/gex-age-' + v.n + '.png';
      await s.p.screenshot({ path: f }); console.log('SHOT ' + f);
      await s.ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'gex-age-browser: ' + fail + ' FAILED' : 'gex-age-browser: all passed');
  process.exit(fail ? 1 : 0);
})();
