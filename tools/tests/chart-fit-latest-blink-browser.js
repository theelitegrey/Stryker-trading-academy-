// Charts: the "Fit price" / "Latest" pills (.stkc-fl) must not churn (DOM rebuild, style/class toggles) while live ticks arrive.
// Counts MutationObserver records on the pills (and re-creations in the pane host) over several seconds.
//   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-fit-latest-blink-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const WATCH_MS = Number(process.env.WATCH_MS || 10000);
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
async function run(b, { w, h, mobile, theme, sym, tag, shot, hover }) {
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
  await p.evaluate((s) => window.STRYKER_VELA.active.setSymbol(s), sym);
  await p.waitForTimeout(8000);
  if (hover) { await p.mouse.move(hover[0], hover[1]); await p.waitForTimeout(800); }   // cursor parked on the pane: opacity must stay put while ticks arrive
  const r = await p.evaluate((ms) => new Promise((res) => {
    const fl = document.querySelector('.stkc-fl');
    if (!fl) return res({ missing: true });
    const log = {};
    const bump = (k) => { log[k] = (log[k] || 0) + 1; };
    const mo = new MutationObserver((recs) => recs.forEach((m) => bump(m.type + ':' + (m.attributeName || '') + ':' + (m.target.className || m.target.nodeName))));
    mo.observe(fl, { attributes: true, childList: true, subtree: true, characterData: true });
    const mh = new MutationObserver((recs) => recs.forEach((m) => { [...m.addedNodes, ...m.removedNodes].forEach((n) => { if (n.classList && n.classList.contains('stkc-fl')) bump('host-rebuild'); }); }));
    mh.observe(fl.parentElement, { childList: true });
    // style changes that are not DOM mutations (CSS animation / transition loops)
    let trans = 0; const onT = () => trans++;
    fl.addEventListener('transitionstart', onT); fl.addEventListener('animationstart', onT);
    // computed look (rules can change it without touching the DOM): count changes of opacity/display/visibility/rect per frame
    const look = () => { const bs = fl.querySelectorAll('button'); const c = getComputedStyle(fl); const r = fl.getBoundingClientRect(); return [c.opacity, c.display, c.visibility, Math.round(r.left), Math.round(r.top), bs.length, ...[...bs].map((x) => getComputedStyle(x).opacity + getComputedStyle(x).borderColor)].join('|'); };
    let prev = look(), looks = 0, raf = 0; const loop = () => { const n = look(); if (n !== prev) { looks++; prev = n; } raf = requestAnimationFrame(loop); }; loop();
    setTimeout(() => { cancelAnimationFrame(raf); bump('computed-look-changes:' + looks); if (!looks) delete log['computed-look-changes:0']; mo.disconnect(); mh.disconnect(); res({ log, trans, total: Object.values(log).reduce((a, b) => a + b, 0), ticks: window.__tickCount || null }); }, ms);
  }), WATCH_MS);
  check(!r.missing, `${tag}: pills present`);
  if (!r.missing) check(r.total === 0 && r.trans === 0, `${tag}: ${r.total} mutations, ${r.trans} transitions in ${WATCH_MS / 1000}s ${JSON.stringify(r.log)}`);
  if (shot) await p.screenshot({ path: `${OUT}/blink-${shot}.png` });
  check(errors.length === 0, `${tag}: no page errors ${errors.slice(0, 2).join(' | ')}`);
  await ctx.close();
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    await run(b, { w: 1440, h: 900, theme: 'dark', sym: 'binance:BTCUSDT', tag: 'desk crypto dark', shot: 'desk-dark' });
    await run(b, { w: 1440, h: 900, theme: 'dark', sym: 'futures:NQ1!', tag: 'desk NQ1! dark', hover: [600, 400] });
    await run(b, { w: 1440, h: 900, theme: 'light', sym: 'binance:BTCUSDT', tag: 'desk crypto light', hover: [1200, 793], shot: 'desk-light' });
    await run(b, { w: 390, h: 844, mobile: true, theme: 'dark', sym: 'binance:BTCUSDT', tag: 'phone crypto dark', shot: 'phone-dark' });
  } finally { await b.close(); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
