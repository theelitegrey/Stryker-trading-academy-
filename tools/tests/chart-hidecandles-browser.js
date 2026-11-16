// "Hide price candles" (chart settings > Symbol > Candles, top-bar eye button, right-click menu) must hide the
// price series only, keep indicators + price scale, be OFF by default, and survive reload. Real mouse presses. Run:
//   node tools/tests/chart-dev-server.mjs 8097 &   CHART_BASE=http://127.0.0.1:8097 node tools/tests/chart-hidecandles-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8097';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 260))); };
async function ready(p) {
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && document.getElementById('stkc-hideprice-btn'), null, { timeout: 45000 });
  await p.waitForTimeout(2500);
}
async function pressEl(p, fn) {
  const box = await p.evaluate((f) => { const el = (0, eval)('(' + f + ')')(); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, fn.toString());
  if (!box) return false;
  await p.mouse.click(box.x, box.y); await p.waitForTimeout(350); return true;
}
const st = (p) => p.evaluate(() => {
  const W = window.STRYKER_VELA; const c = W.cell(W.context().cells[0].id); const rc = c.chart.renderer;
  return { shown: rc.get('candleVisible') !== false, hidden: !!rc.renderer.scene.candlesHidden, inds: c.chart.indicators().length, btn: document.getElementById('stkc-hideprice-btn').getAttribute('aria-pressed') };
});
const theme = (p, t) => p.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); window.STRYKER_VELA.setTheme(t); }, t);
const SYMTAB = () => [...document.querySelectorAll('.vela-dialog--settings .vela-sd-tab')].find((x) => x.textContent === 'Symbol');
const SW = () => { const l = [...document.querySelectorAll('.vela-dialog--settings .vela-field-label')].find((x) => /price candles/.test(x.textContent)); const r = l && (l.closest('.vela-field-span') || l.parentElement); return r && r.querySelector('.vela-switch[role="switch"]'); };
const OK = () => [...document.querySelectorAll('.vela-dialog--settings .vela-sd-btn')].find((x) => x.textContent === 'Ok');
(async () => {
  const b = await launch();
  try {
    for (const [name, W, H, light] of [['1440-dark', 1440, 900, false], ['1440-light', 1440, 900, true], ['390-dark', 390, 844, false]]) {
      const ctx = await b.newContext({ viewport: { width: W, height: H } });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
      await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
      const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(String(e)));
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' }); await ready(p);
      if (light) { await theme(p, 'light'); await p.waitForTimeout(500); }
      await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator('ema'));
      await p.waitForTimeout(1200);
      let s = await st(p);
      check(s.shown && !s.hidden && s.inds >= 1 && s.btn === 'false', name + ': default = candles shown, indicator added', s);
      await p.screenshot({ path: `${OUT}/hidecandles-before-${name}.png` });
      if (name === '1440-dark') {
        // settings dialog switch
        await pressEl(p, () => document.getElementById('stkc-settings-btn'));
        await p.waitForSelector('.vela-dialog--settings .stk-sd-extra', { timeout: 8000, state: 'attached' });
        await pressEl(p, SYMTAB);
        check(!!(await p.evaluate((f) => (0, eval)('(' + f + ')')() !== null, SW.toString())), 'settings: "Hide price candles" row exists');
        await pressEl(p, SW); await pressEl(p, OK); await p.waitForTimeout(500);
        s = await st(p); check(s.hidden && !s.shown && s.btn === 'true', 'settings switch hides candles', s);
        await pressEl(p, () => document.getElementById('stkc-hideprice-btn')); await p.waitForTimeout(400);
        s = await st(p); check(!s.hidden && s.btn === 'false', 'top-bar eye shows them again', s);
        // right-click menu
        const box = await p.evaluate(() => { const r = document.querySelector('.vela-chart, .vela-host, canvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 3 }; });
        await p.mouse.click(box.x, box.y, { button: 'right' }); await p.waitForTimeout(500);
        const item = await p.evaluate(() => { const e = [...document.querySelectorAll('.vela-menu *, [role=menu] *, [role=menuitem]')].find((x) => x.children.length === 0 && /^(Hide|Show) price candles$/.test(x.textContent.trim())); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: e.textContent }; });
        check(!!item, 'right-click menu has the entry', item);
        if (item) { await p.mouse.click(item.x, item.y); await p.waitForTimeout(500); }
      } else {
        await pressEl(p, () => document.getElementById('stkc-hideprice-btn')); await p.waitForTimeout(500);
      }
      s = await st(p);
      check(s.hidden && !s.shown && s.btn === 'true' && s.inds >= 1, name + ': candles hidden, indicator still on chart', s);
      await p.screenshot({ path: `${OUT}/hidecandles-after-${name}.png` });
      if (name === '1440-dark') {
        await p.waitForTimeout(2000);
        await p.reload({ waitUntil: 'domcontentloaded' }); await ready(p);
        s = await st(p); check(s.hidden && s.btn === 'true', 'still hidden after reload', s);
        await pressEl(p, () => document.getElementById('stkc-hideprice-btn')); await p.waitForTimeout(500);
        s = await st(p); check(s.shown && !s.hidden, 'toggle off again works', s);
      }
      check(p.errors.length === 0, name + ': no page errors', p.errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
