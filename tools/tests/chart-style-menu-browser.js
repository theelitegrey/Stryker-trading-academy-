// Regression: the Charts chart-style dropdown must open on a real click, stay open while the
// mouse travels from the button to an item, and every style must be pickable (real mouse path /
// tap, never element.click()).   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-style-menu-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function newPage(b, mobile) {
  const ctx = await b.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  await p.addInitScript(() => { window.__stkOfTestTier = { free: false, plan: 'Pro' }; });
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && document.querySelector('.vela-dtb'), null, { timeout: 40000 });
  await p.waitForTimeout(3000);
  await p.evaluate(() => { window.STRYKER_VELA.active.setSymbol('futures:NQ1!'); }); await p.waitForTimeout(2500);
  return p;
}
const btnBox = async (p) => { const el = await p.$('[aria-label^="Chart style"]'); return el && await el.boundingBox(); };
const menuItems = (p) => p.evaluate(() => [...document.querySelectorAll('[role="menuitemradio"],[role="menuitem"]')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
const curStyle = (p) => p.evaluate(() => { try { const a = window.STRYKER_VELA.active; return a.getPriceStyle ? a.getPriceStyle() : (a.priceStyle || null); } catch (e) { return 'err'; } });
(async () => {
  const b = await launch();
  for (const mobile of [false, true]) {
    const tag = mobile ? '390' : '1440';
    const p = await newPage(b, mobile);
    const EXPECT = ['Candles', 'Bars', 'Line', 'Area', 'Baseline', 'Heikin Ashi', 'Footprint'];
    const tap = async (loc) => { const q = await loc.boundingBox(); await p.touchscreen.tap(q.x + q.width / 2, q.y + q.height / 2); };
    if (mobile) {
      // phone: More (kebab) -> Chart type -> pick; all by touch taps
      for (const name of EXPECT) {
        await tap(p.locator('.vela-mb-more')); await sleep(600);
        await tap(p.getByText('Chart type', { exact: true })); await sleep(600);
        if (name === 'Candles') await p.screenshot({ path: OUT + '/cs-390-sheet.png' });
        const row = p.getByText(name, { exact: true }).last();
        if (!(await row.count())) { check(false, tag + ': sheet lists ' + name); continue; }
        await tap(row); await sleep(1000);
        const st = await curStyle(p);
        check(st && st.toLowerCase().replace(/\s/g, '') .includes(name.toLowerCase().split(' ')[0].slice(0, 4)) || (name === 'Footprint' && st === 'stk_fp') || (name === 'Heikin Ashi' && st === 'heikinashi'), tag + ': tapped ' + name, st);
        if (/heikin|foot|line/i.test(name)) await p.screenshot({ path: OUT + '/cs-390-' + name.replace(/\W+/g, '_') + '.png' });
      }
      check(!p.errors.length, tag + ': no page errors', p.errors);
      await p.context().close();
      continue;
    }
    const bb = await btnBox(p);
    check(!!bb, tag + ': chart-style button present', bb);
    if (!bb) continue;
    const click = async (x, y) => { await p.mouse.move(x, y, { steps: 6 }); await p.mouse.down(); await p.mouse.up(); };
    await click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await sleep(500);
    const items = await menuItems(p);
    check(items.length >= 7 && items.some((i) => i.t === 'Footprint'), tag + ': single click opens the menu incl. Footprint', items.map((i) => i.t));
    await p.screenshot({ path: OUT + '/cs-' + tag + '-open.png' });
    const names = items.map((i) => i.t);
    for (let i = 0; i < names.length; i++) {
      const bx = await btnBox(p);
      if (!(await menuItems(p)).length) { await click(bx.x + bx.width / 2, bx.y + bx.height / 2); await sleep(400); }
      const it = (await menuItems(p)).find((x) => x.t === names[i]);
      if (!it) { check(false, tag + ': item present ' + names[i]); continue; }
      const sx = bx.x + bx.width / 2, sy = bx.y + bx.height / 2;
      await p.mouse.move(sx, sy, { steps: 4 });
      for (let s = 1; s <= 12; s++) { await p.mouse.move(sx + (it.x - sx) * s / 12, sy + (it.y - sy) * s / 12); await sleep(40); }
      await sleep(300);
      if (!(await menuItems(p)).length) { check(false, tag + ': menu stayed open while travelling to ' + names[i]); await p.screenshot({ path: OUT + '/cs-' + tag + '-closed.png' }); continue; }
      const before = await curStyle(p);
      await click(it.x, it.y);
      await sleep(900);
      const after = await curStyle(p);
      check(!(await menuItems(p)).length && (names[i] === 'Candles' ? true : after !== before), tag + ': picked ' + names[i] + ', menu closed, chart style changed', { before, after });
      if (/heikin|foot|line/i.test(names[i])) await p.screenshot({ path: OUT + '/cs-' + tag + '-' + names[i].replace(/\W+/g, '_') + '.png' });
    }
    const bx = await btnBox(p);
    await click(bx.x + bx.width / 2, bx.y + bx.height / 2); await sleep(400);
    await p.keyboard.press('Escape'); await sleep(300);
    check(!(await menuItems(p)).length, tag + ': Esc closes');
    await click(bx.x + bx.width / 2, bx.y + bx.height / 2); await sleep(400);
    await click(bx.x + bx.width / 2, 600); await sleep(300);
    check(!(await menuItems(p)).length, tag + ': outside click closes');
    // sibling top-bar dropdowns: the panel must be what the pointer hits (not the chart canvas) at its centre
    for (const [nm, sel] of [['indicators', 'button:has-text("Indicators")'], ['layout', 'button:has-text("chart")'], ['templates', 'button:has-text("Templates")']]) {
      const el = await p.$(sel + ':visible'); const q = el && await el.boundingBox();
      if (!q) { check(false, tag + ': ' + nm + ' button found'); continue; }
      await p.mouse.move(q.x + q.width / 2, q.y + q.height / 2, { steps: 5 }); await p.mouse.down(); await p.mouse.up(); await sleep(700);
      const hit = await p.evaluate(() => {
        const cands = [...document.querySelectorAll('.vela-ui-layer > *, .vela-popover, .vela-dialog, [role=dialog], [role=menu], .stkc-pop, .stkt-pop')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 80 && b.height > 80 && b.top < 400 && b.top > 40; });
        if (!cands.length) return null;
        return cands.some((e) => { const b = e.getBoundingClientRect(); const t = document.elementFromPoint(b.x + b.width / 2, b.y + 30); return t && (e.contains(t)) ; });
      });
      check(hit === true, tag + ': ' + nm + ' panel opens and is hit-testable (not under the canvas)', hit);
      await p.keyboard.press('Escape'); await p.mouse.click(700, 500); await sleep(300);
    }
    // interval dropdown: caret opens, pointer travels down onto a row, the row picks a new timeframe
    {
      const el = await p.$('.stk-iv-caret:visible'); const q = el && await el.boundingBox();
      check(!!q, tag + ': interval caret found');
      if (q) {
        const tfBefore = await p.evaluate(() => window.STRYKER_VELA.active.timeframe);
        const sx = q.x + q.width / 2, sy = q.y + q.height / 2;
        await p.mouse.move(sx, sy, { steps: 5 }); await p.mouse.down(); await p.mouse.up(); await sleep(600);
        const rows = await p.evaluate((b) => [...document.querySelectorAll('.stk-iv-menu .stk-iv-r:not(.na)')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return { t: e.querySelector('.l') ? e.querySelector('.l').textContent : e.textContent, x: r.x + r.width / 3, y: r.y + r.height / 2, on: e.classList.contains('on') }; }), 0);
        check(rows.length > 3, tag + ': interval menu opens', rows.length);
        const tgt = rows.find((r) => r.t === '1 hour' || r.t === '2 hours');
        if (tgt) {
          for (let k = 1; k <= 12; k++) { await p.mouse.move(sx + (tgt.x - sx) * k / 12, sy + (tgt.y - sy) * k / 12); await sleep(40); }
          await sleep(300);
          const stillOpen = await p.evaluate(() => !![...document.querySelectorAll('.stk-iv-menu')].find((e) => e.getBoundingClientRect().width > 0));
          check(stillOpen, tag + ': interval menu stays open while travelling');
          await p.screenshot({ path: OUT + '/cs-' + tag + '-interval.png' });
          await p.mouse.down(); await p.mouse.up(); await sleep(1200);
          const tfAfter = await p.evaluate(() => window.STRYKER_VELA.active.timeframe);
          check(tfAfter !== tfBefore, tag + ': interval row picked, timeframe changed', { tfBefore, tfAfter, row: tgt.t });
        }
      }
      await p.keyboard.press('Escape'); await p.mouse.click(700, 500); await sleep(300);
    }
    check(!p.errors.length, tag + ': no page errors', p.errors);
    await p.context().close();
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
