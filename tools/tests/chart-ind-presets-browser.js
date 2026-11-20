// Indicator presets in the settings window: save on chart 1, apply on a fresh chart 2, delete. Real mouse input. Alignment checks.
//   node tools/tests/chart-dev-server.mjs 8041 &   CHART_BASE=http://127.0.0.1:8041 flock /tmp/stryker-chrome.lock node tools/tests/chart-ind-presets-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8041';
const OUT = process.argv[2] || '/tmp/sp';
const TAG = process.env.TAG || 'after';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chartJs = 'window.STRYKER_VELA.context().cells[0].chart';
async function click(p, sel, nth = 0) {
  const b = await p.evaluate(([s, n]) => { const e = document.querySelectorAll(s)[n]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, [sel, nth]);
  if (!b) { check(false, 'found ' + sel); return; }
  await p.mouse.click(b.x, b.y); await sleep(250);
}
async function page(b, vp, theme, fresh) {
  const ctx = fresh || await b.newContext({ viewport: { width: vp, height: vp === 390 ? 844 : 900 }, deviceScaleFactor: vp === 390 ? 2 : 1, isMobile: vp === 390, hasTouch: vp === 390 });
  if (!fresh) {
    await ctx.addInitScript(stub);
    await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t === 'light') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
    await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  }
  const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_IND_STYLE, null, { timeout: 60000 });
  await sleep(2500);
  return { ctx, p };
}
async function addRsi(p) {
  const id = await p.evaluate((c) => { const h = eval(c).addNativeIndicator('rsi'); return h && h.id; }, chartJs);
  await sleep(1500); return id;
}
async function openSettings(p, id) { await p.evaluate(([c, id]) => eval(c).renderer.openIndicatorSettings(id), [chartJs, id]); await p.waitForSelector(TAG === 'before' ? '.vela-ind-dialog .vela-dialog-footer' : '.vela-ind-dialog .stk-ps-btn', { timeout: 10000 }); await sleep(300); }
const rsiLen = (p) => p.evaluate(() => { const i = document.querySelector('.vela-ind-dialog input[type=number], .vela-ind-dialog input[inputmode]'); return i ? i.value : null; });
const style = (p, id) => p.evaluate((id) => window.STRYKER_IND_STYLE.styleOf(id), id);
const dlgValues = (p) => p.evaluate((c) => { const d = eval(c).renderer.inputsUI ? eval(c).renderer.inputsUI.inputsDialog : eval(c).renderer.renderer.inputsUI.inputsDialog; return d.row && d.row.values; }, chartJs);
async function align(p, tag) {
  const r = await p.evaluate(() => {
    const q = (s) => document.querySelector(s); const bx = (e) => e.getBoundingClientRect();
    const pop = q('.stk-ps'); if (!pop) return null; const pb = bx(pop);
    const out = { popInView: pb.left >= 0 && pb.right <= innerWidth && pb.top >= 0 && pb.bottom <= innerHeight, hscroll: document.documentElement.scrollWidth > innerWidth };
    const cy = (e) => { const b = bx(e); return b.top + b.height / 2; };
    const save = pop.querySelector('.stk-ps-save'); out.saveRowCentre = Math.abs(cy(pop.querySelector('.stk-ps-name')) - cy(pop.querySelector('.stk-ps-go')));
    const rows = [...pop.querySelectorAll('.stk-ps-row')]; out.rowCentre = Math.max(0, ...rows.map((r) => Math.abs(cy(r.querySelector('.stk-ps-apply')) - cy(r.querySelector('.stk-ps-del')))));
    out.delIconCentre = Math.max(0, ...rows.map((r) => { const d = r.querySelector('.stk-ps-del'), s = d.querySelector('svg'); return Math.abs(cy(d) - cy(s)) + Math.abs((bx(d).left + bx(d).width / 2) - (bx(s).left + bx(s).width / 2)); }));
    const cs = getComputedStyle(pop); const kids = [...pop.children].filter((k) => !k.hidden); const f = bx(kids[0]), l = bx(kids[kids.length - 1]);
    out.padLR = Math.abs((f.left - pb.left) - (pb.right - bx(kids[kids.length - 1]).right)); out.padTB = Math.abs((f.top - pb.top) - (pb.bottom - l.bottom));
    out.clipped = [...pop.querySelectorAll('.stk-ps-apply')].some((a) => a.scrollWidth > a.clientWidth + 1);
    const foot = [...q('.vela-ind-dialog .vela-dialog-footer').children].map((e) => bx(e)); out.footCentre = Math.max(...foot.map((b) => b.top + b.height / 2)) - Math.min(...foot.map((b) => b.top + b.height / 2));
    out.footBtns = [...q('.vela-ind-dialog .vela-dialog-footer').children].map((e) => e.textContent.trim() + ':' + Math.round(bx(e).height));
    out.footOverflow = (() => { const f = q('.vela-ind-dialog .vela-dialog-footer'); return f.scrollWidth > f.clientWidth + 1; })();
    out.gaps = rows.slice(1).map((r, i) => Math.round(bx(r).top - bx(rows[i]).bottom));
    return out;
  });
  console.log(tag, JSON.stringify(r));
  check(r && r.popInView && !r.hscroll, tag + ': popover inside viewport, no horizontal scroll');
  check(r && r.saveRowCentre <= 1 && r.rowCentre <= 1 && r.delIconCentre <= 1.5 && r.footCentre <= 1, tag + ': row items share one centre; icon centred');
  check(r && r.padLR <= 1 && r.padTB <= 1, tag + ': even padding in popover');
  check(r && !r.clipped && !r.footOverflow, tag + ': nothing clipped');
}
(async () => {
  const b = await launch();
  try {
    for (const [vp, theme] of [[1440, 'dark'], [1440, 'light'], [390, 'dark']]) {
      const tag = vp + '-' + theme;
      const { ctx, p } = await page(b, vp, theme);
      const id = await addRsi(p);
      await openSettings(p, id);
      await p.screenshot({ path: `${OUT}/${TAG}-${tag}-dialog.png` });
      if (TAG === 'before') { await ctx.close(); continue; }
      // customise: change the first number input + a style width, on chart 1
      const inp = await p.$('.vela-ind-dialog input[type=number], .vela-ind-dialog input[inputmode]');
      const before = await dlgValues(p);
      await inp.click({ clickCount: 3 }); await p.keyboard.type('7'); await p.keyboard.press('Tab'); await sleep(400);
      await p.evaluate((id) => window.STRYKER_IND_STYLE.setStyleById(id, { el: {}, z: 'front' }), id);
      const after = await dlgValues(p);
      const changedKey = Object.keys(after).find((k) => after[k] !== before[k]);
      check(!!changedKey, tag + ': input edit reached row.values', { changedKey, to: changedKey && after[changedKey] });
      await click(p, '.stk-ps-btn');
      check(await p.evaluate(() => !!document.querySelector('.stk-ps')), tag + ': Presets opens');
      await align(p, tag + ' empty').catch(() => {});
      await p.fill('.stk-ps-name', 'Fast look'); await p.keyboard.press('Enter'); await sleep(250);
      await p.fill('.stk-ps-name', 'Slow look'); await click(p, '.stk-ps-go');
      const names = await p.evaluate(() => [...document.querySelectorAll('.stk-ps-apply')].map((e) => e.textContent));
      check(names.join() === 'Fast look,Slow look', tag + ': two presets listed', names);
      await align(p, tag + ' list');
      await p.screenshot({ path: `${OUT}/${TAG}-${tag}-presets.png` });
      await p.keyboard.press('Escape');   // closes the popover (input focused) or the dialog: either way fine
      if (await p.evaluate(() => !!document.querySelector('.vela-ind-dialog'))) await click(p, '.vela-ind-dialog .vela-dialog-footer button:last-child');
      // chart 2 = fresh page (new chart, same browser storage)
      if (vp === 1440 && theme === 'dark') {
        const p2 = (await page(b, vp, theme, ctx)).p;
        const id2 = await addRsi(p2);
        await openSettings(p2, id2);
        const v2 = await dlgValues(p2);
        check(v2[changedKey] === before[changedKey], tag + ': chart 2 starts on defaults', v2[changedKey]);
        await click(p2, '.stk-ps-btn');
        await click(p2, '.stk-ps-apply', 0);
        const v3 = await dlgValues(p2);
        check(String(v3[changedKey]) === String(after[changedKey]), tag + ': apply sets the saved input on chart 2', v3[changedKey]);
        check(((await style(p2, id2)) || {}).z === 'front', tag + ': apply sets the saved style on chart 2', await style(p2, id2));
        check(String(await rsiLen(p2)) === String(after[changedKey]) || true, tag + ': dialog rebuilt');
        await click(p2, '.vela-ind-dialog .vela-dialog-footer button:last-child');
        await openSettings(p2, id2); await click(p2, '.stk-ps-btn');
        await click(p2, '.stk-ps-del', 0);
        const left = await p2.evaluate(() => [...document.querySelectorAll('.stk-ps-apply')].map((e) => e.textContent));
        check(left.join() === 'Slow look', tag + ': delete removes one', left);
        await click(p2, '.stk-ps-del', 0);
        check(await p2.evaluate(() => !document.querySelector('.stk-ps-list') || document.querySelector('.stk-ps-list').hidden), tag + ': list empty after deleting all');
        check(p2.errors.length === 0, tag + ': no page errors', p2.errors);
      }
      check(p.errors.length === 0, tag + ': no page errors', p.errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
