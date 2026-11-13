// Visual order: Zoro Levels (stk_gex) vs an order-flow layer (Footprint (L2), stk_l2f_fp; Delta needs a live trade feed, covered by the L2 test); Bring to front via the legend menu, order kept after reload.
//   node tools/tests/chart-dev-server.mjs 8041 &   CHART_BASE=http://127.0.0.1:8041 node tools/tests/chart-zorder-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8041';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
// DOM paint order of the two layers' canvases (index in the plot; higher = drawn on top) + the scene z keys
const order = (p) => p.evaluate(() => {
  const ch = window.STRYKER_VELA.context().cells[0].chart; const R = ch.renderer.extLayers ? ch.renderer : ch.renderer.renderer;
  const kids = [...R.plot.children], at = (t) => { const l = R.extLayers.find((x) => x.channel === t || x.def.id === t); return l ? kids.indexOf(l.canvas) : -1; };
  const z = {}; for (const m of R.scene.indicators.values()) if (m.native) z[m.native.type] = R.scene.zOf(m.id);
  return { gex: at('stk_gex'), delta: at('stk_l2f_fp'), z, sig: R.layerOrderSig };
});
// The legend row's own menu, opened by right-click (what a member does), then the item by its text
async function menu(p, type, label) {
  const id = await p.evaluate((t) => { const ch = window.STRYKER_VELA.context().cells[0].chart; const R = ch.renderer.extLayers ? ch.renderer : ch.renderer.renderer; for (const m of R.scene.indicators.values()) if (m.native && m.native.type === t) return m.id; return null; }, type);
  // phone: the legend is folded under a chip and has no right-click; open it and use the row's "..." (move) button, as a thumb would
  const mobile = p.viewportSize().width < 700;
  if (mobile) {
    await p.evaluate(() => { const ch = window.STRYKER_VELA.context().cells[0].chart; const R = ch.renderer.extLayers ? ch.renderer : ch.renderer.renderer; const f = document.querySelector('.vela-ind-fold'); if (f && R.inputsUI.legendFolded) f.click(); });
    await sleep(500);
    // a tap on the row's name selects it and reveals its buttons
    const nm = await p.evaluate((id) => { const ch = window.STRYKER_VELA.context().cells[0].chart; const R = ch.renderer.extLayers ? ch.renderer : ch.renderer.renderer; const r = R.inputsUI.rows.get(id).el.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; }, id);
    await p.touchscreen.tap(nm.x, nm.y); await sleep(600);
    const btn = await p.evaluate((id) => { const ch = window.STRYKER_VELA.context().cells[0].chart; const R = ch.renderer.extLayers ? ch.renderer : ch.renderer.renderer; const b = R.inputsUI.rows.get(id).el.querySelector('[data-vela-ctl="move"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, id);
    if (btn) await p.touchscreen.tap(btn.x, btn.y);
  } else {
    const box = await p.evaluate((id) => { const ch = window.STRYKER_VELA.context().cells[0].chart; const R = ch.renderer.extLayers ? ch.renderer : ch.renderer.renderer; const r = R.inputsUI.rows.get(id).el.getBoundingClientRect(); return { x: r.left + 12, y: r.top + r.height / 2 }; }, id);
    await p.mouse.click(box.x, box.y, { button: 'right' });
  }
  await sleep(400);
  const names = await p.evaluate(() => [...document.querySelectorAll('.vela-menu-item')].map((e) => e.textContent.trim()));
  if (label) { const it = p.locator('.vela-menu-item', { hasText: label }).first(); await (mobile ? it.tap() : it.click()); await sleep(900); }
  return names;
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, tag] of [[1440, 900, false, '1440'], [390, 844, true, '390']]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', 'night'); } catch (e) {} });
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
      const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
      const boot = async () => { await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 120000 }); await sleep(2500); };
      await boot();
      await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('5'); for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); if (ws.context().cells[0].chart.orchestrator.rawBars.length > 20) break; } });
      await sleep(1500);
      await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_gex', { inputs: {} }); });
      await sleep(1500);
      await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_l2f_fp', { inputs: {} }); });
      await sleep(2500);
      const o0 = await order(p);
      check(o0.gex > 0 && o0.delta > 0, `${tag}: both layers mounted`, o0);
      check(o0.delta > o0.gex, `${tag}: before, Footprint (L2) is drawn over Zoro Levels (as added)`, o0);
      await p.screenshot({ path: `${OUT}/${tag}-before.png` });
      // menu shows the four steps; the top one is Bring to front on Zoro Levels
      const names = await menu(p, 'stk_gex', null);
      for (const n of ['Bring to front', 'Bring forward', 'Send backward', 'Send to back']) check(names.includes(n), `${tag}: menu has "${n}"`, names);
      if (mobile) await p.screenshot({ path: `${OUT}/${tag}-menu.png` });
      await (mobile ? p.locator('.vela-menu-item', { hasText: 'Bring to front' }).first().tap() : p.locator('.vela-menu-item', { hasText: 'Bring to front' }).first().click()); await sleep(1200);
      const o1 = await order(p);
      check(o1.gex > o1.delta, `${tag}: Bring to front puts Zoro Levels over Footprint (L2)`, o1);
      await p.screenshot({ path: `${OUT}/${tag}-after.png` });
      // one step back, then to back, then front again (each is a real change)
      await menu(p, 'stk_gex', 'Send backward'); const o2 = await order(p);
      check(o2.delta > o2.gex, `${tag}: Send backward puts Zoro Levels under Footprint (L2)`, o2);
      await menu(p, 'stk_gex', 'Bring forward'); const o3 = await order(p);
      check(o3.gex > o3.delta, `${tag}: Bring forward puts Zoro Levels over Footprint (L2) again`, o3);
      await menu(p, 'stk_gex', 'Send to back'); const o4 = await order(p);
      check(o4.z.stk_gex < o4.z.stk_l2f_fp, `${tag}: Send to back is under every other layer`, o4);
      await menu(p, 'stk_gex', 'Bring to front'); const o5 = await order(p);
      check(o5.gex > o5.delta, `${tag}: front again`, o5);
      // settings: the same four steps (Style tab)
      const hasSettings = await p.evaluate(async () => {
        const ch = window.STRYKER_VELA.context().cells[0].chart; const R = ch.renderer.extLayers ? ch.renderer : ch.renderer.renderer;
        for (const m of R.scene.indicators.values()) if (m.native && m.native.type === 'stk_gex') R.inputsUI.openSettingsFor(m.id);
        await new Promise((r) => setTimeout(r, 800));
        const t = document.querySelector('.stk-is-tab[data-stk-tab="style"]'); if (t) t.click(); await new Promise((r) => setTimeout(r, 500));
        const z = document.querySelector('[data-stk-zorder]'); return z ? [...z.querySelectorAll('button')].map((x) => x.textContent + (x.disabled ? '(off)' : '')) : null;
      });
      check(Array.isArray(hasSettings) && hasSettings.length === 4, `${tag}: settings Style tab has Visual order`, hasSettings);
      if (mobile) await p.screenshot({ path: `${OUT}/${tag}-settings.png` });
      await p.keyboard.press('Escape'); await sleep(300);
      await p.evaluate(() => { const b = [...document.querySelectorAll('.vela-dialog-footer button')].find((x) => /cancel|ok/i.test(x.textContent)); if (b) b.click(); });
      await sleep(1500);   // let the workspace save
      // saved: reload, order kept
      await boot(); await sleep(3500);
      const o6 = await order(p);
      check(o6.gex > 0 && o6.delta > 0, `${tag}: both layers back after reload`, o6);
      check(o6.gex > o6.delta, `${tag}: order kept after reload (Zoro Levels over Footprint (L2))`, o6);
      await p.screenshot({ path: `${OUT}/${tag}-reload.png` });
      check(errors.length === 0, tag + ': no page errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
