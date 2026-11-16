// "Animate zoom" (chart settings > Symbol > Animation) must turn ON, show the real state, glide the zoom,
// and survive theme switch + reload. Real mouse presses. Run:
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8097 node tools/tests/chart-animzoom-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8097';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 260))); };
const ROW = () => document.querySelector('[data-sd-id="symbol.animation.zoom"]');
async function ready(p) {
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && document.getElementById('stkc-settings-btn'), null, { timeout: 45000 });
  await p.waitForTimeout(2500);
}
async function pressEl(p, fn) {
  const box = await p.evaluate((f) => { const el = (0, eval)('(' + f + ')')(); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, fn.toString());
  if (!box) return false;
  await p.mouse.click(box.x, box.y); await p.waitForTimeout(350); return true;
}
const SYMTAB = () => [...document.querySelectorAll('.vela-dialog--settings .vela-sd-tab')].find((x) => x.textContent === 'Symbol');
const SWITCH = () => { const r = document.querySelector('[data-sd-id="symbol.animation.zoom"]'); return r && (r.querySelector('[role=checkbox],[role=switch],input,.vela-check,.vela-switch') || r); };
const OK = () => [...document.querySelectorAll('.vela-dialog--settings .vela-sd-btn')].find((x) => x.textContent === 'Ok');
async function openSym(p) {
  await pressEl(p, () => document.getElementById('stkc-settings-btn'));
  await p.waitForSelector('.vela-dialog--settings .stk-sd-extra', { timeout: 8000, state: 'attached' });
  await pressEl(p, SYMTAB); await p.waitForTimeout(300);
}
const swState = (p) => p.evaluate((f) => { const s = (0, eval)('(' + f + ')')(); return s ? (s.getAttribute('aria-checked') ?? String(s.checked)) : null; }, SWITCH.toString());
const engine = (p) => p.evaluate(() => { const c = (window.STRYKER_VELA.workspace || {}); const cell = (window.__stkCells && window.__stkCells()[0]); return null; });

const zoomCfg = (p) => p.evaluate(() => { const W = window.STRYKER_VELA; const c = W.cell(W.context().cells[0].id); return c.chart.renderer.getConfig().animations.zoom; });
const zoomEng = (p) => p.evaluate(() => { const W = window.STRYKER_VELA; const c = W.cell(W.context().cells[0].id); const R = c.chart.renderer.renderer; return { on: R.animZoom && R.animZoom.ms !== undefined ? R.animZoom.ms : (R.animZoom && JSON.stringify(R.animZoom)) }; });
const theme = (p, t) => p.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); window.STRYKER_VELA.setTheme(t); }, t);
async function toggle(p, want) {
  await openSym(p);
  const before = await swState(p);
  if (String(before) !== String(want)) await pressEl(p, SWITCH);
  await p.waitForTimeout(300);
  const shown = await swState(p);
  await pressEl(p, OK); await p.waitForTimeout(500);
  return shown;
}
(async () => {
  const b = await launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(stub);
    await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
    await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
    const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(String(e)));
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await ready(p);
    check(await zoomCfg(p) === false, 'fresh chart: default zoom animation OFF');
    const shownOn = await toggle(p, true);
    check(String(shownOn) === 'true', 'toggle shows ON after real click', shownOn);
    check(await zoomCfg(p) === true, 'renderer config animations.zoom ON');
    check((await zoomEng(p)).on > 0, 'engine animZoom ms > 0 (zoom glides)', await zoomEng(p));
    await openSym(p); check(String(await swState(p)) === 'true', 'reopen dialog: still ON'); await p.screenshot({ path: OUT + '/animzoom-on.png' }); await pressEl(p, OK); await p.waitForTimeout(400);
    await theme(p, 'light'); await p.waitForTimeout(400);
    check(await zoomCfg(p) === true, 'still ON after theme -> light');
    await theme(p, 'dark'); await p.waitForTimeout(400);
    check(await zoomCfg(p) === true, 'still ON after theme -> dark');
    await p.waitForTimeout(1500);
    await p.reload({ waitUntil: 'domcontentloaded' }); await ready(p);
    check(await zoomCfg(p) === true, 'still ON after reload');
    await openSym(p); check(String(await swState(p)) === 'true', 'after reload: toggle shows ON'); await pressEl(p, OK); await p.waitForTimeout(400);
    const shownOff = await toggle(p, false);
    check(String(shownOff) === 'false' && await zoomCfg(p) === false, 'toggle OFF works', shownOff);
    await theme(p, 'light'); await p.waitForTimeout(300);
    check(await zoomCfg(p) === false, 'OFF stays OFF after theme switch');
    check(p.errors.length === 0, 'no page errors', p.errors);
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
