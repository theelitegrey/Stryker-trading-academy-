// Charts: the "Fit price" / "Latest" pills (.stkc-fl, bottom right of the pane) must not churn while live ticks
// arrive. A MutationObserver on the row (+ its parent, to catch a rebuild) counts changes over WATCH_MS.
//   CHART_BASE=http://127.0.0.1:8065 node tools/tests/chart-fit-latest-blink-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const WATCH_MS = Number(process.env.WATCH_MS || 10000), MAX = 2;
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
async function run(b, { w, h, mobile, tag, theme, sym }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t) localStorage.setItem('theme', t); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance\.com|fapi\.binance\.com|data-api\.binance\.vision)/, (r) => r.abort());
  await require('./binance-mock.js').install(ctx);
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 45000 });
  await p.waitForTimeout(3000);
  await p.evaluate((s) => window.STRYKER_VELA.active.setSymbol(s), sym);
  await p.waitForTimeout(8000);
  await p.evaluate(() => {
    const fl = document.querySelector('.stkc-fl'); window.__flLog = [];
    window.__flEl = fl;
    new MutationObserver((ms) => { for (const m of ms) window.__flLog.push(m.type + ':' + (m.attributeName || '') + ':' + (m.target.className || m.target.nodeName)); })
      .observe(fl, { subtree: true, attributes: true, childList: true, characterData: true });
    new MutationObserver((ms) => { for (const m of ms) if ([...m.removedNodes].includes(fl)) window.__flLog.push('ROW-REMOVED'); }).observe(fl.parentElement, { childList: true });
  });
  await p.waitForTimeout(WATCH_MS);
  const r = await p.evaluate(() => ({ log: window.__flLog, same: window.__flEl === document.querySelector('.stkc-fl'), n: document.querySelectorAll('.stkc-fl').length, vis: !!window.__flEl.offsetWidth }));
  check(r.vis && r.n >= 1, `${tag} ${sym}: pills present and visible`);
  check(r.same, `${tag} ${sym}: same row element kept`);
  check(r.log.length <= MAX, `${tag} ${sym}: ${r.log.length} mutations in ${WATCH_MS / 1000}s (max ${MAX})${r.log.length ? ' e.g. ' + [...new Set(r.log)].slice(0, 4).join(' | ') : ''}`);
  await p.screenshot({ path: `${OUT}/blink-${tag}-${sym.replace(/\W/g, '')}.png` });
  check(errors.length === 0, `${tag}: no page errors ${errors.slice(0, 2).join(' | ')}`);
  await ctx.close();
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    await run(b, { w: 1440, h: 900, tag: 'd1440', theme: 'dark', sym: 'BINANCE:BTCUSDT' });
    await run(b, { w: 1440, h: 900, tag: 'd1440', theme: 'dark', sym: 'futures:NQ1!' });
    await run(b, { w: 1440, h: 900, tag: 'l1440', theme: 'light', sym: 'BINANCE:BTCUSDT' });
    await run(b, { w: 390, h: 844, mobile: true, tag: 'd390', theme: 'dark', sym: 'BINANCE:BTCUSDT' });
  } finally { await b.close(); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
