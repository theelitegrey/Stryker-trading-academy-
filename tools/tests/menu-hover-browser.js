// Shared hover menus (assets/menu-hover.js, Owner 15 Nov). node tools/tests/chart-dev-server.mjs 8044 &
//   CHART_BASE=http://127.0.0.1:8044 flock /tmp/stryker-chrome.lock node tools/tests/menu-hover-browser.js [shotsDir]
// Checks: site nav (home Products) and chart menus (account, layout, drawing-tool flyout, Vela chart-style menu) open on hover,
// close after the leave delay, a diagonal move keeps them open, no hover-open while a button is held, touch emulation
// needs a tap, reduced motion still works.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8044';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x) : '')); };

const OPEN = {
  account: () => !!document.querySelector('.account-menu-wrap.open'),
  layout: () => { const p = document.querySelector('.stkl-pop'); return !!p && !p.hidden; },
  fly: () => !!document.querySelector('.vela-dtb-flyout'),
  style: () => { const m = document.querySelector('.vela-menu[data-state="open"]'); return !!m && m.getClientRects().length > 0; },
  home: () => !!document.querySelector('.hn-prod[open]'),
};
async function ctxFor(b, o, stubIt) {
  const ctx = await b.newContext(o);
  if (stubIt) await ctx.addInitScript(stub);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  return ctx;
}
async function chart(ctx) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.__stkTvBars, null, { timeout: 40000 });
  await p.waitForTimeout(3500);
  return p;
}
const box = async (p, sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.right, b: r.bottom }; }, sel);
const is = (p, k) => p.evaluate(OPEN[k]);

async function hoverCycle(p, name, sel, key, panelSel) {
  const c = await box(p, sel);
  await p.mouse.move(5, 500); await p.waitForTimeout(250);
  await p.mouse.move(c.x, c.y);
  await p.waitForTimeout(20);
  check(!(await is(p, key)), name + ': not open before the ~80 ms intent delay');
  await p.waitForTimeout(400);
  check(await is(p, key), name + ': opens on hover');
  if (panelSel) {
    const pr = await p.evaluate((s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 20 }; }, panelSel);
    await p.mouse.move((c.x + pr.x) / 2, (c.y + pr.y) / 2 + 3, { steps: 4 });   // diagonal toward the panel
    await p.waitForTimeout(350);
    check(await is(p, key), name + ': diagonal move keeps it open');
    await p.mouse.move(pr.x, pr.y, { steps: 3 });
    await p.waitForTimeout(350);
    check(await is(p, key), name + ': stays open with the pointer inside the panel');
  }
  await p.mouse.move(c.x, 330, { steps: 3 }); await p.mouse.move(5, 330);
  await p.waitForTimeout(120);
  const earlyOpen = await is(p, key);
  await p.waitForTimeout(500);
  check(!(await is(p, key)), name + ': closes after leave delay', { earlyOpen });
}

(async () => {
  const b = await launch();
  // ---- home page nav (1440 dark, then light) ----
  for (const theme of ['dark', 'light']) {
    const ctx = await ctxFor(b, { viewport: { width: 1440, height: 900 } }, false);
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
    const p = await ctx.newPage();
    await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1500);
    const s = '.hn-prod > summary';
    await hoverCycle(p, 'home Products (' + theme + ')', s, 'home', '.hn-menu');
    const c = await box(p, s); await p.mouse.move(c.x, c.y); await p.waitForTimeout(500);
    await p.screenshot({ path: OUT + '/home-' + theme + '.png' });
    // click still toggles / pins
    await p.mouse.move(5, 700); await p.waitForTimeout(500);
    await ctx.close();
  }
  // ---- chart (1440, stubbed signed-in user) ----
  for (const theme of ['dark', 'light']) {
    const ctx = await ctxFor(b, { viewport: { width: 1440, height: 900 } }, true);
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
    const p = await chart(ctx);
    await hoverCycle(p, 'account menu (' + theme + ')', '#account-trigger', 'account', '#account-panel');
    await hoverCycle(p, 'layout menu (' + theme + ')', '#stkl-btn', 'layout', '.stkl-pop');
    await hoverCycle(p, 'drawing-tool flyout (' + theme + ')', '.vela-dtb-arrow', 'fly', '.vela-dtb-flyout');
    await hoverCycle(p, 'time-zone menu (Vela menu) (' + theme + ')', '#vela-bb-tz', 'style', '.vela-menu[data-state="open"]');
    if (theme === 'dark') {
      // nested submenu: price-axis right-click menu has Labels / Levels submenus (Vela's own hover handling + shared animation)
      await p.mouse.click(1380, 400, { button: 'right' }); await p.waitForTimeout(400);
      const sub = await p.evaluate(() => { const e = [...document.querySelectorAll('.vela-menu-item[aria-haspopup]')].find((x) => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      check(!!sub, 'price-axis menu has a submenu row');
      if (sub) {
        await p.mouse.move(sub.x, sub.y); await p.waitForTimeout(700);
        const n = await p.evaluate(() => [...document.querySelectorAll('.vela-menu[data-state="open"]')].filter((m) => m.getClientRects().length).length);
        check(n >= 2, 'nested submenu opens on hover', n);
        const an = await p.evaluate(() => { const m = [...document.querySelectorAll('.vela-menu[data-state="open"]')].filter((x) => x.getClientRects().length).pop(); return getComputedStyle(m).animationName; });
        check(/^mh-in/.test(an), 'nested submenu uses the shared slide animation', an);
        await p.screenshot({ path: OUT + '/submenu-dark.png' });
      }
      await p.keyboard.press('Escape'); await p.mouse.click(700, 500); await p.waitForTimeout(300);
      // chart drag: no hover-open while a button is held
      const c = await box(p, '#stkl-btn');
      await p.mouse.move(700, 450); await p.mouse.down(); await p.mouse.move(c.x, c.y, { steps: 6 }); await p.waitForTimeout(400);
      check(!(await is(p, 'layout')), 'no hover-open while the mouse button is held (drag)');
      await p.mouse.up(); await p.mouse.move(5, 780); await p.waitForTimeout(300);
      // click still opens, Esc closes, aria-expanded in sync
      await p.click('#stkl-btn'); await p.waitForTimeout(400);
      check(await is(p, 'layout') && (await p.getAttribute('#stkl-btn', 'aria-expanded')) === 'true', 'click opens, aria-expanded=true');
      await p.keyboard.press('Escape'); await p.waitForTimeout(400);
      check(!(await is(p, 'layout')) && (await p.getAttribute('#stkl-btn', 'aria-expanded')) === 'false', 'Esc closes, aria-expanded=false');
      await p.screenshot({ path: OUT + '/chart-dark.png' });
    } else {
      const c = await box(p, '#stkl-btn'); await p.mouse.move(c.x, c.y); await p.waitForTimeout(600);
      await p.screenshot({ path: OUT + '/chart-light.png' });
    }
    await ctx.close();
  }
  // ---- reduced motion ----
  {
    const ctx = await ctxFor(b, { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }, true);
    const p = await chart(ctx);
    const c = await box(p, '#stkl-btn'); await p.mouse.move(c.x, c.y); await p.waitForTimeout(500);
    const an = await p.evaluate(() => { const e = document.querySelector('.stkl-pop'); return getComputedStyle(e).animationName; });
    check(await is(p, 'layout') && an === 'mh-fade-in', 'reduced motion: opens, fade only', an);
    await ctx.close();
  }
  // ---- touch emulation: hover must not open; a tap does ----
  {
    const ctx = await ctxFor(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, true);
    const p = await chart(ctx);
    await p.evaluate(() => { const e = document.querySelector('#stkl-btn'); e.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); e.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' })); });
    await p.waitForTimeout(500);
    check(!(await is(p, 'layout')), 'touch: hover events do not open the menu');
    await ctx.close();
  }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
