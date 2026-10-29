// Liquidity Map on futures through the local Rithmic mock: builds from connect, "Building since" note, the no-depth message
// (mock system "TradeSea" has no order book).
//   node tools/tests/chart-dev-server.mjs 8073        (site)
//   node tools/tests/rithmic-mock.mjs 8765            (fake gateway)
//   node tools/tests/liqmap-futures-browser.js [shotsDir]
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8073', MOCK = 'ws://127.0.0.1:8765', OUT = process.argv[2] || '.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
async function run(b, { w, h, mobile, system, tag }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([g]) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1');
    localStorage.setItem('stryker_rithmic_dev', JSON.stringify({ gateway: g })); localStorage.setItem('stryker.volume', '1'); window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true }; } catch (e) {} }, [MOCK]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load|firebase|CORS/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_RITHMIC && window.__stkFlow, null, { timeout: 60000 });
  await p.evaluate(async () => { for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (window.STRYKER_VELA.chart.orchestrator.rawBars.length > 0) return; } catch (e) {} } });
  await sleep(1500);
  check(await p.evaluate(() => window.STRYKER_RITHMIC.depthEnabled === true), tag + ': depth enabled under the dev override');
  await p.click('#stkrb-btn');

  await p.waitForFunction(() => document.querySelectorAll('#stkrb-sys option[value]:not([value=""])').length >= 3, null, { timeout: 15000 });
  await p.selectOption('#stkrb-sys', system); await p.fill('#stkrb-user', 'demo'); await p.fill('#stkrb-pass', 'demo-pass'); await p.click('#stkrb-go');
  await p.waitForFunction(() => window.STRYKER_RITHMIC.state === 'connected', null, { timeout: 20000 });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 50) break; } });
  await sleep(2500);
  check(await p.evaluate(() => !!window.STRYKER_VELA.chart.addNativeIndicator('stk_liqmap', { inputs: {} })), tag + ': Liquidity Map added on NQ');
  return { ctx, p, errors };
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  try {
    for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
      let { ctx, p, errors } = await run(b, { w, h, mobile, system: 'Rithmic Test', tag: 'ok ' + w });
      await sleep(30000);
      await sleep(1500);
      const d = await p.evaluate(() => window.__stkFlow.lmDebug());
      console.log('FEEDS', JSON.stringify(await p.evaluate(() => { const d = window.__stkFlow.lmDebug(); return [d.bubSample, d.plotR, d.scale, d.vmax]; })));
      check(d && d.kind === 'fut' && d.cells > 0, 'ok ' + w + ': futures heat drawn', d && { cells: d.cells, rows: d.rows, note: d.note });
      check(d && /^Building since \d\d:\d\d · connect stays open$/.test(d.note || ''), 'ok ' + w + ': note "' + (d && d.note) + '"');
      check(d && d.ladderRows > 5 && d.bestBidSize > 0, 'ok ' + w + ': ladder from the Rithmic book', d && d.ladderRows);
      check(d && d.bubbles > 0, 'ok ' + w + ': bubbles from LAST_TRADE (' + (d && d.bubbles) + ')');
      await p.screenshot({ path: path.join(OUT, 'lm-fut-' + w + '.png') });
      check(!errors.length, 'ok ' + w + ': no errors', errors);
      await ctx.close();
      ({ ctx, p, errors } = await run(b, { w, h, mobile, system: 'TradeSea', tag: 'nodepth ' + w }));
      await sleep(3000);
      await p.screenshot({ path: path.join(OUT, 'lm-fut-nodepth-' + w + '.png') });
      const seen = await p.evaluate(() => window.__stkFlow.lmNote());
      check(/Your data account has no order book \(market depth\)\. Ask your prop firm or broker\./.test(seen), 'nodepth ' + w + ': message shown', seen);
      check(!errors.length, 'nodepth ' + w + ': no errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
