// Phone chart space (Owner 2026-10-26, add-on to "phone chart clutter"): one top bar, compact market
// clock, footnote behind ⓘ, bottom nav behind a handle, full screen. Real taps at 390x844 on both
// engines, plus 1440 (desktop keeps its header; full screen works there too).
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 flock -w 600 /tmp/stryker-chrome.lock \
//     node tools/tests/chart-phone-space-browser.js <outDir> [tag]
// Env: PS_ENG=09|06 (default both), PS_W=390|1440 (default both).
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
const TAG = process.argv[3] || 'ps';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };

async function open(b, { w, h, mobile, v09, keepLs }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|WebSocket|Failed to load resource|blocked by CORS/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + '/charts.html' + (v09 ? '' : '?vela=0.6'), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 40000 });
  await sleep(3000);
  return { ctx, p, errors };
}
const tapSel = async (p, sel, mobile) => {
  const el = await p.$(sel);
  const bb = el && await el.boundingBox();
  if (!bb) return false;
  const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2;
  const top = await p.evaluate(([x, y, sel]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest(sel)); }, [x, y, sel]);
  if (mobile) await p.touchscreen.tap(x, y); else await p.mouse.click(x, y);
  await sleep(400);
  return top;
};
const layout = (p) => p.evaluate(() => {
  const R = (e) => { if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null; if (getComputedStyle(e).visibility === 'hidden') return null; return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom) }; };
  const onScreen = (r) => !!(r && r.y < innerHeight && r.b > 0);
  const panel = R(document.querySelector('.stkchart-panel'));
  const bar = document.getElementById('stkc-bar');
  const dock = R(document.getElementById('appnav-dock'));
  return { vh: innerHeight, panel, plotPct: panel ? +(panel.h / innerHeight * 100).toFixed(1) : 0, head: R(document.querySelector('.mobile-topnav')), bar: R(bar),
    barOverflow: bar ? bar.scrollWidth > bar.clientWidth + 1 : null, credit: R(document.querySelector('.stkchart-credit')), dock, dockOnScreen: onScreen(dock) && dock.y < innerHeight - 4,
    handle: R(document.getElementById('stkcps-handle')), menu: R(document.getElementById('stkcps-menu')), clock: R(document.getElementById('mclock')), clockInBar: !!(bar && bar.contains(document.getElementById('mclock'))),
    tiny: (document.querySelector('#mclock .mclock-tiny') || {}).textContent || '', fs: document.documentElement.classList.contains('stk-chart-fs'), fsBtn: R(document.getElementById('stkc-fs-btn')),
    cps: document.documentElement.classList.contains('stk-cps') };
});

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  const all = {};
  try {
    for (const v09 of (process.env.PS_ENG === '09' ? [true] : process.env.PS_ENG === '06' ? [false] : [true, false])) {
      const eng = v09 ? 'v09' : 'v06';
      for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]].filter((x) => !process.env.PS_W || String(x[0]) === process.env.PS_W)) {
        const key = eng + '-' + w;
        const { ctx, p, errors } = await open(b, { w, h, mobile, v09 });
        const L = await layout(p);
        all[key] = L;
        await p.screenshot({ path: path.join(OUT, TAG + '-' + key + '.png') });
        console.log('SHOT ' + path.join(OUT, TAG + '-' + key + '.png') + '  plot ' + (L.panel && L.panel.h) + ' px = ' + L.plotPct + '%');
        if (mobile) {
          check(L.cps && !L.head, key + ': site header hidden, one top bar', { cps: L.cps, head: L.head });
          check(!L.credit, key + ': footnote strip hidden', L.credit);
          check(!L.dockOnScreen && !!L.handle, key + ': bottom nav hidden, handle shown', { dock: L.dock, handle: L.handle });
          check(L.plotPct >= 85, key + ': plot >= 85% of the screen height', L.plotPct);
          check(L.clockInBar && !!L.clock, key + ': market clock is a dot (+ short text when it fits) in the toolbar', L.tiny);
          check(L.barOverflow === false, key + ': toolbar does not overflow');
          // menu button -> side menu
          check(await tapSel(p, '#stkcps-menu', true), key + ': menu button tappable');
          const side = await p.evaluate(() => document.querySelector('.sidebar').classList.contains('mobile-open'));
          check(side, key + ': menu button opens the side menu');
          await p.evaluate(() => { const bd = document.getElementById('dash-sidebar-backdrop'); if (bd) bd.click(); });
          await sleep(400);
          // clock -> popover with the full text
          check(await tapSel(p, '#mclock .mclock-pill', true), key + ': market clock tappable');
          const pop = await p.evaluate(() => { const e = document.getElementById('mclock-pop'); const r = e && e.getBoundingClientRect(); return e && !e.hidden && r.width > 100 && r.left >= 0 && r.right <= innerWidth ? e.querySelector('.mclock-pstate').textContent : null; });
          check(!!pop, key + ': tap shows the full session text on screen', pop);
          await p.screenshot({ path: path.join(OUT, TAG + '-' + key + '-clock.png') });
          await p.touchscreen.tap(150, 500); await sleep(300);
          // ⓘ -> the footnote text
          const infoSel = (await p.$('#stkc-bar .stkin-phonebtn')) ? '#stkc-bar .stkin-phonebtn' : null;
          let src = null;
          if (infoSel) {
            await tapSel(p, infoSel, true);
            src = await p.evaluate(() => { const e = document.querySelector('#stkin:not([hidden]) .stkin-src'); return e && e.getClientRects().length ? e.textContent : null; });
            await p.screenshot({ path: path.join(OUT, TAG + '-' + key + '-info.png') });
            await p.evaluate(() => { const c = document.querySelector('#stkin .stkin-close'); if (c) c.click(); });
            await sleep(300);
          }
          check(!!src && /Not financial advice/.test(src), key + ': footnote text is in the ⓘ panel', src && src.slice(0, 80));
          // handle -> bottom nav, link tappable, auto-hide
          check(await tapSel(p, '#stkcps-handle', true), key + ': handle tappable');
          await sleep(350);
          const L2 = await layout(p);
          check(L2.dockOnScreen, key + ': handle brings the bottom nav back', L2.dock);
          const gexTop = await p.evaluate(() => { const a = document.querySelector('#appnav-dock [data-nav="gex"]'); const r = a.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(e && e.closest('[data-nav="gex"]')); });
          check(gexTop, key + ': a bottom-nav link is on top (tappable)');
          await p.screenshot({ path: path.join(OUT, TAG + '-' + key + '-nav.png') });
          await sleep(4600);
          const L3 = await layout(p);
          check(!L3.dockOnScreen, key + ': bottom nav hides again by itself', L3.dock);
          // swipe up from the bottom edge
          const cdp = await ctx.newCDPSession(p);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: h - 6 }] });
          for (const y of [h - 20, h - 40, h - 60]) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120, y }] }); await sleep(30); }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await sleep(350);
          check((await layout(p)).dockOnScreen, key + ': swipe up from the bottom shows the bottom nav');
          await p.touchscreen.tap(150, 450); await sleep(400);
          check(!(await layout(p)).dockOnScreen, key + ': a tap on the chart hides it');
        } else {
          check(!L.cps && !!L.head, key + ': desktop keeps its header', L.head);
        }
        // full screen: the button (in the bar or in ⋯ More)
        let fsSel = '#stkc-fs-btn';
        const fsVisible = await p.evaluate(() => { const b = document.getElementById('stkc-fs-btn'); return !!(b && b.getClientRects().length && b.getBoundingClientRect().width); });
        if (!fsVisible) { await tapSel(p, '#stkc-more-btn', mobile); }
        check(await tapSel(p, fsSel, mobile), key + ': full-screen button tappable');
        await sleep(600);
        const F = await layout(p);
        check(F.fs && !F.head && !F.dockOnScreen && !F.credit, key + ': full screen shows only the chart + toolbar', { fs: F.fs, head: F.head, plot: F.plotPct });
        await p.screenshot({ path: path.join(OUT, TAG + '-' + key + '-fs.png') });
        all[key + '-fs'] = F;
        // remembered after a reload
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 40000 });
        await sleep(2500);
        check((await layout(p)).fs, key + ': full screen remembered after reload');
        // Esc (desktop) / the button (phone) exits
        if (mobile) {
          const vis = await p.evaluate(() => { const b = document.getElementById('stkc-fs-btn'); return !!(b && b.getClientRects().length && b.getBoundingClientRect().width); });
          if (!vis) await tapSel(p, '#stkc-more-btn', true);
          await tapSel(p, '#stkc-fs-btn', true);
        } else { await p.mouse.click(w / 2, h / 2); await p.keyboard.press('Escape'); }
        await sleep(600);
        const X = await layout(p);
        check(!X.fs && (mobile ? X.cps : !!X.head), key + ': full screen exits (' + (mobile ? 'button' : 'Esc') + ')', { fs: X.fs });
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 40000 });
        await sleep(2000);
        check(!(await layout(p)).fs, key + ': exit remembered after reload');
        check(!errors.length, key + ': no console errors', errors.slice(0, 3));
        await ctx.close();
      }
    }
  } finally { await b.close(); }
  fs.writeFileSync(path.join(OUT, TAG + '-metrics.json'), JSON.stringify(all, null, 1));
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
