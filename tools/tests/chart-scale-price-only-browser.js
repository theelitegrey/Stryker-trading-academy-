// "Scale price chart only": candles-only auto-scale. Runs against tools/tests/chart-dev-server.mjs.
//   CHART_BASE=http://127.0.0.1:PORT node tools/tests/chart-scale-price-only-browser.js <shotsDir>
// Puts a far-away horizontal line (55% of price) on the chart, then checks the price scale with the option OFF
// (squished) and ON (candles fill the plot), the menu row, the settings row, and that the flag survives
// getConfig -> applyConfig (what layouts and templates store). Shots 390/412/1440 dark+light.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };

async function open(b, { w, h, mobile, theme, vela }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {}
    document.addEventListener('DOMContentLoaded', () => document.documentElement.setAttribute('data-theme', t));
  }, theme);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e)); });
  await p.goto(BASE + '/charts.html?vela=' + vela, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { try { const ws = window.STRYKER_VELA; return ws && ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount > 50; } catch (e) { return false; } }, null, { timeout: 90000 });
  await p.waitForTimeout(2500);
  return { ctx, p, errors };
}
const R = (p, fn, arg) => p.evaluate(([src, arg]) => { const ws = window.STRYKER_VELA; const cell = ws.cell(ws.active.id); const r = cell.chart.renderer.renderer; return (new Function('ws', 'cell', 'r', 'arg', src))(ws, cell, r, arg); }, [fn, arg]);
// share of the price scale range that the visible candles' high-low span fills
const FILL = `const pane = r.scene.orderedPanes().find(p => p.kind === 'price'); const vr = r.coords.visibleLogicalRange();
  let lo = Infinity, hi = -Infinity; for (let i = Math.max(0, Math.floor(vr.from)); i <= Math.min(r.bars.length - 1, Math.ceil(vr.to)); i++) { lo = Math.min(lo, r.bars[i].low); hi = Math.max(hi, r.bars[i].high); }
  const s = pane.scaleTarget; return { fill: (hi - lo) / (s.max - s.min), lo, hi, min: s.min, max: s.max };`;

async function run(b, { w, h, mobile, theme, vela, shots }) {
  const tag = `${vela}-${w}-${theme}`;
  const { ctx, p, errors } = await open(b, { w, h, mobile, theme, vela });
  // a Pine overlay plot far below price (stands in for a far PDH/PDL or a long MA) - the real indicator path
  const added = await p.evaluate(async () => {
    const src = '//@version=5\nindicator("far", overlay=true)\nplot(close * 0.55, "far")\n';
    const r = await window.STRYKER_PINE.addSource('far', src, { engine: 'next' });
    return r && r.ok;
  });
  check(added === true, `${tag}: far overlay indicator added`, added);
  await p.waitForFunction(() => { const r = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id).chart.renderer.renderer; return [...r.scene.indicators.values()].some((m) => (m.series || []).some((s) => s.overlay === true)); }, null, { timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const off = await R(p, FILL);
  check(off.fill < 0.6, `${tag}: OFF - far line squishes candles`, off);
  if (shots) await p.screenshot({ path: `${OUT}/spo-${tag}-off.png` });
  await R(p, `cell.chart.renderer.set('scalePriceOnly', true); return 1;`);
  await p.waitForTimeout(800);
  const on = await R(p, FILL);
  check(on.fill > 0.7 && on.fill > off.fill * 1.5, `${tag}: ON - candles fill the plot`, on);
  check(on.min <= on.lo && on.max >= on.hi, `${tag}: ON - no candle clipped`, on);
  if (shots) await p.screenshot({ path: `${OUT}/spo-${tag}-on.png` });
  const cfg = await R(p, `return cell.chart.renderer.getConfig().priceScale.scalePriceOnly`);
  check(cfg === true, `${tag}: flag in saved config`, cfg);
  await R(p, `cell.chart.renderer.applyConfig({ priceScale: { scalePriceOnly: false } }); return 1;`);
  await p.waitForTimeout(500);
  check((await R(p, FILL)).fill < 0.6, `${tag}: applyConfig(false) -> OFF`);
  await R(p, `cell.chart.renderer.applyConfig({ priceScale: { scalePriceOnly: true } }); return 1;`);
  await p.waitForTimeout(500);
  check((await R(p, FILL)).fill > 0.7, `${tag}: applyConfig(true) -> ON`);
  if (!mobile) {
    const box = await p.evaluate(() => { const ws = window.STRYKER_VELA; const host = ws.cell(ws.active.id).host || document.querySelector('.vela-cell'); const c = [...host.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await p.mouse.click(box.x + box.w - 25, box.y + box.h * 0.4, { button: 'right' });
    await p.waitForTimeout(500);
    check(await p.evaluate(() => document.body.innerText.includes('Scale price chart only') || !!document.querySelector('[data-id="scalePriceOnly"]')), `${tag}: right-click price scale shows the menu row`);
    if (shots) await p.screenshot({ path: `${OUT}/spo-${tag}-menu.png` });
    await p.keyboard.press('Escape');
  }
  await R(p, `cell.chart.renderer.openSettings('price-axis'); return 1;`);
  await p.waitForTimeout(800);
  await p.getByText('Scales and lines', { exact: true }).first().click().catch(() => {});
  await p.waitForTimeout(600);
  await p.evaluate(() => { const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Scale price chart only'); if (el) el.scrollIntoView({ block: 'center' }); });
  await p.waitForTimeout(300);
  check(await p.evaluate(() => document.body.innerText.includes('Scale price chart only')), `${tag}: Chart settings > Scales has the row`);
  if (shots) await p.screenshot({ path: `${OUT}/spo-${tag}-settings.png` });
  check(errors.length === 0, `${tag}: no page errors`, errors);
  await ctx.close();
}

(async () => {
  const b = await launch();
  await run(b, { w: 1440, h: 900, theme: 'dark', vela: '0.9', shots: true });
  await run(b, { w: 1440, h: 900, theme: 'light', vela: '0.9', shots: true });
  await run(b, { w: 390, h: 800, mobile: true, theme: 'dark', vela: '0.9', shots: true });
  await run(b, { w: 412, h: 860, mobile: true, theme: 'dark', vela: '0.9', shots: true });
  await run(b, { w: 1440, h: 900, theme: 'dark', vela: '0.6', shots: false });
  await b.close();
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
