// Charts: Fit price / Latest pills must not jump while a footprint pane and a normal pane tick side by side.
// Root cause (build 966 follow-up): the footprint layer removed + re-added the class "stk-fp-stats" on <body> every frame, and the
// layer of every other pane's footprint engine did the same, so the pills of ALL panes flipped between bottom and top (CSS bottom:auto; top:8px).
// Counts class mutations on <body> and the pills' position changes per frame over WATCH_MS, 2 panes, live mock ticks.
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/chart-fit-latest-footprint-flag-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const WATCH_MS = Number(process.env.WATCH_MS || 8000);
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
async function run(b, { w, h, mobile, theme, tag, shot }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance\.com|fapi\.binance\.com|data-api\.binance\.vision)/, (r) => r.abort());
  await require('./binance-mock.js').install(ctx);
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 45000 });
  await p.waitForTimeout(4000);
  await p.evaluate(() => { window.STRYKER_VELA.active.setSymbol('binance:BTCUSDT'); try { window.STRYKER_CHART_UI.setLayout(window.innerWidth < 700 ? '2v' : '2h'); } catch (e) {} });
  await p.waitForTimeout(8000);
  await p.evaluate(() => { const c = window.STRYKER_VELA.active, rows = c.libraryRows(), i = rows.findIndex((x) => x.native && x.nativeType === 'stk_footprint'); if (i >= 0) c.addFromLibrary(i); });
  await p.waitForTimeout(4000);
  const r = await p.evaluate((ms) => new Promise((res) => {
    const pills = [...document.querySelectorAll('.stkc-fl')];
    let bodyClass = 0; const mo = new MutationObserver((recs) => recs.forEach((m) => { if (m.attributeName === 'class') bodyClass++; }));
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const fp = pills.map((e) => e.closest('.vela-cell') || document.body).map((e) => e.classList.contains('stk-fp-stats')).join(',');
    const pos = () => pills.map((e) => Math.round(e.getBoundingClientRect().top)).join(',');
    let prev = pos(), moves = 0, raf = 0; const loop = () => { const n = pos(); if (n !== prev) { moves++; prev = n; } raf = requestAnimationFrame(loop); }; loop();
    setTimeout(() => { cancelAnimationFrame(raf); mo.disconnect(); res({ panes: pills.length, bodyClass, moves, fp }); }, ms);
  }), WATCH_MS);
  check(r.panes >= 2, `${tag}: ${r.panes} panes with pills`);
  check(r.bodyClass === 0, `${tag}: ${r.bodyClass} class writes on <body> in ${WATCH_MS / 1000}s`);
  console.log(tag + ' fp flag per pane (cell): ' + r.fp);
  check(r.moves === 0, `${tag}: pills moved ${r.moves} times`);
  if (shot) await p.screenshot({ path: `${OUT}/blink2-${shot}.png` });
  check(errors.length === 0, `${tag}: no page errors ${errors.slice(0, 2).join(' | ')}`);
  await ctx.close();
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    await run(b, { w: 1440, h: 900, theme: 'dark', tag: 'desk dark', shot: 'desk-dark' });
    await run(b, { w: 1440, h: 900, theme: 'light', tag: 'desk light', shot: 'desk-light' });
    await run(b, { w: 390, h: 844, mobile: true, theme: 'dark', tag: 'phone dark', shot: 'phone-dark' });
  } finally { await b.close(); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
