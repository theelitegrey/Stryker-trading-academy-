// Delayed-futures strip + BTC default (Owner 2026-10-30). Against chart-dev-server.mjs.
//   CHART_BASE=http://127.0.0.1:8093 node tools/tests/t6-banner-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8093';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
async function run(b, { who, w, h, mobile, sym, vela, shot }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([who, sym]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      if (sym) localStorage.setItem('vela-workspace', JSON.stringify({ layout: '1', cells: { A: { symbol: sym, timeframe: '15' } }, symbol: sym, timeframe: '15' })); } catch (e) {}
    if (who !== 'signed-out') {
      const user = { uid: 'u-' + who, getIdToken: () => Promise.resolve('dummy.' + who + '.token') };
      firebase.apps = [{}];
      const a = firebase.auth(); a.currentUser = user; a.onIdTokenChanged = (cb) => { setTimeout(() => cb(user), 20); return () => {}; };
    }
  }, [who, sym]);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  await ctx.route('**/api/chart/rt', (r) => r.fulfill({ json: { admin: /Bearer dummy\.(admin|addon)\./.test(r.request().headers().authorization || '') }, headers: { 'cache-control': 'no-store' } }));
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html' + (vela ? '?vela=0.6' : ''), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_DATA_BANNER, null, { timeout: 45000 });
  if (sym) { await p.evaluate(async (sy) => { const c = window.STRYKER_VELA.context().cells[0]; await c.chart.setMarket({ symbol: sy }); }, sym); }
  await p.waitForTimeout(7000);
  const info = await p.evaluate(() => { const bar = document.getElementById('stkdb'); const r = bar.getBoundingClientRect();
    return { sym: window.STRYKER_VELA.active && window.STRYKER_VELA.active.symbol, hidden: bar.hidden, h: Math.round(r.height), w: Math.round(r.width), vw: innerWidth, sw: document.documentElement.scrollWidth, text: bar.textContent, buy: document.getElementById('stkdb-buy').getAttribute('href') }; });
  if (shot) await p.screenshot({ path: `${OUT}/${shot}.png` });
  return { ctx, p, info };
}
(async () => {
  const b = await launch();
  for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
    for (const vela of [false, true]) {
      const tag = `${w}${vela ? '-v06' : ''}`;
      let r = await run(b, { who: 'signed-out', w, h, mobile, vela });
      check(/BTCUSDT/i.test(r.info.sym) && r.info.hidden, `${tag} fresh visitor opens BTC, no banner (${r.info.sym})`); await r.ctx.close();
      r = await run(b, { who: 'signed-out', w, h, mobile, vela, sym: 'futures:NQ1!', shot: vela ? null : `banner-${w}` });
      check(!r.info.hidden && /10 minutes delayed \(CME rule\)/.test(r.info.text) && /Connect data source/.test(r.info.text) && /Live data \$5\/mo/.test(r.info.text) && /LiveData/.test(r.info.buy), `${tag} NQ shows banner+buttons ${JSON.stringify(r.info)}`);
      check(r.info.sw <= r.info.vw + 1, `${tag} no horizontal overflow`);
      if (!vela && !mobile) {
        await r.p.click('#stkdb-x'); check(await r.p.evaluate(() => document.getElementById('stkdb').hidden), 'dismiss hides'); }
      await r.ctx.close();
      r = await run(b, { who: 'addon', w, h, mobile, vela, sym: 'futures:NQ1!' });
      check(r.info.hidden, `${tag} add-on/approved member: banner hidden`); await r.ctx.close();
      r = await run(b, { who: 'free', w, h, mobile, vela, sym: 'binance:BTCUSDT' });
      check(r.info.hidden, `${tag} crypto: no banner`); await r.ctx.close();
    }
  }
  // buttons
  let r = await run(b, { who: 'free', w: 390, h: 844, mobile: true, sym: 'futures:NQ1!' });
  await r.p.evaluate(() => { window.__opened = 0; window.STRYKER_RITHMIC = window.STRYKER_RITHMIC || {}; window.STRYKER_RITHMIC.open = () => { window.__opened++; }; });
  await r.p.click('#stkdb-connect'); await r.p.waitForTimeout(600);
  check(await r.p.evaluate(() => window.__opened) >= 1, 'Connect data source calls the Rithmic sheet open function');
  await r.ctx.close();
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
