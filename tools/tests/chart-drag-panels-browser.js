// Floating panels can be dragged by their title row (assets/chart-draggable.js). FIXTURE only (no network, no key).
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/chart-drag-panels-browser.js <shotsDir>
// Per panel at 1440: open -> drag the header ~200px -> it moves; a button in the header still clicks (and does not move it);
// a plain click on the title does not move it; reload -> position kept; double-click -> back to the default spot;
// drag far off screen -> >= 48px of the header stays visible. Then 390 phone: a bottom/full-screen sheet is not draggable.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };

// name, how to open (runs in the page), panel selector, header selector, a header button (selector, optional) whose click must still work
const PANELS = [
  ['heatmap', () => window.__stkHeatmapPanel.open(), '.stkhm', '.stkhm-h'],
  ['book/DOM/trades', () => window.__stkBookPanel.open(), '.stkbp', '.stkbp-hd'],
  ['replay bar', () => { const b = document.getElementById('stkr-bar'); b.hidden = false; }, '#stkr-bar', '.stkr-grip'],
  ['alerts', () => window.__stkAlerts.open(), '.stk-al-box', '.stk-al-head'],
  ['alert sounds', () => window.__stkAlerts.openSounds(), '.stk-snd-box', '.stk-al-head'],
  ['indicators window', () => window.STRYKER_VELA.indicatorPicker.open(), '.stkiw-card', '.stkiw-hd'],
  ['chart settings', () => window.STRYKER_VELA.active.chart.renderer.openSettings(), '.vela-dialog--settings', '.vela-dialog-header'],
  ['indicator settings', () => { const c = window.STRYKER_VELA.active.chart; c.renderer.openIndicatorSettings(c.indicators()[0].id); }, '.vela-ind-dialog', '.vela-dialog-header'],
  ['object tree', () => window.STRYKER_VELA.objectTree && window.STRYKER_VELA.objectTree.open && window.STRYKER_VELA.objectTree.open(), '.vela-panel', '.vela-panel-header', true],
  ['script editor', () => { const b = document.querySelector('[data-stk-open-editor], #stkc-pine-btn, .stkc-pine-open'); if (b) b.click(); else window.__stkOpenEditor && window.__stkOpenEditor(); }, '.stkc-pine.sed', '.sed-hd', true]
];

async function open(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (!sessionStorage.s0) { sessionStorage.s0 = 1; localStorage.setItem('stryker.vela.session', ''); } } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, p, errors };
}
const boot = async (p) => {
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(1500);
};
const rect = (p, sel) => p.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.offsetParent || getComputedStyle(x).position === 'fixed'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, vis: r.width > 0 && r.height > 0 && !e.hidden }; }, sel);
const dragBy = async (p, from, dx, dy) => { await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 }); await p.mouse.move(from.x + dx, from.y + dy, { steps: 6 }); await p.mouse.up(); await sleep(150); };
// a point on the header that is not a button/input: scan along the row's vertical centre
const grabPoint = (p, hsel) => p.evaluate((s) => { const h = [...document.querySelectorAll(s)].find((x) => x.getBoundingClientRect().width > 0); if (!h) return null; const r = h.getBoundingClientRect(); const y = r.top + r.height / 2;
  for (let x = Math.max(r.left, 0) + 6; x < Math.min(r.right, innerWidth) - 2; x += 4) { const t = document.elementFromPoint(x, y); if (t && h.contains(t) && !t.closest('button,a,input,select,textarea,label,[role=switch],[role=button]')) return { x, y }; } return null; }, hsel);

(async () => {
  const b = await launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--max-old-space-size=768'] });
  try {
    // ---- desktop 1440
    if (process.env.DRAG_ONLY !== 'phone') {
    const { ctx, p: p0, errors } = await open(b, { w: 1440, h: 900 });
    let p = p0;
    // "reload" = close the page and open a new one in the same context (same localStorage), which also frees the heavy WebGL page
    const fresh = async () => { await p.close(); const n = await ctx.newPage(); n.on('pageerror', (e) => errors.push(String(e))); return n; };
    await boot(p);
    await p.evaluate(() => { const c = window.STRYKER_VELA.active.chart; if (!c.indicators().length) c.addIndicator && c.addIndicator('sma'); });
    const listed = [];
    for (const [name, opener, psel, hsel, soft] of PANELS) {
      await p.evaluate(opener).catch(() => {}); await sleep(1300);
      let r0 = await rect(p, psel);
      if (!r0 || !r0.vis) { if (soft) { console.log('SKIP ' + name + ' (no opener in this fixture)'); continue; } check(false, name + ': opens', r0); continue; }
      listed.push(name);
      const gp = await grabPoint(p, hsel);
      if (!gp) { check(false, name + ': has a grabbable header point'); continue; }
      // plain click on the title: no move
      await p.mouse.click(gp.x, gp.y); await sleep(100);
      let r1 = await rect(p, psel);
      check(Math.abs(r1.x + r1.w / 2 - r0.x - r0.w / 2) < 1 && Math.abs(r1.y + r1.h / 2 - r0.y - r0.h / 2) < 1, name + ': click on the title does not move it');
      // drag 200px left / 120px down (right-docked), fall back to right/up if it was clamped
      await dragBy(p, gp, -200, 120);
      let r2 = await rect(p, psel);
      let moved = Math.hypot(r2.x - r0.x, r2.y - r0.y);
      if (moved < 150) { const g2 = await grabPoint(p, hsel); await dragBy(p, g2, 200, -80); r2 = await rect(p, psel); moved = Math.hypot(r2.x - r0.x, r2.y - r0.y); }
      check(moved >= 100, name + ': drag moves it', { r0, r2 });
      await p.screenshot({ path: OUT + '/drag-' + name.replace(/\W+/g, '-') + '.png' });
      // header button still clicks and does not drag
      const btn = await p.evaluate((s) => { const h = [...document.querySelectorAll(s)].find((x) => x.getBoundingClientRect().width > 0); const bt = h && [...h.querySelectorAll('button')].find((x) => x.getBoundingClientRect().width > 0); if (!bt) return null; const r = bt.getBoundingClientRect(); window.__btnHit = 0; bt.addEventListener('click', () => { window.__btnHit++; }, true); return { x: r.left + r.width / 2, y: r.top + r.height / 2, aria: bt.getAttribute('aria-label') || bt.className }; }, hsel);
      if (btn && !/close|exit|x$/i.test(btn.aria)) {
        const b0 = await rect(p, psel); await dragBy(p, btn, -80, 60); const b1 = await rect(p, psel);
        check(Math.abs(b1.x - b0.x) < 1 && Math.abs(b1.y - b0.y) < 1, name + ': pressing a header button does not drag (' + btn.aria + ')');
      } else if (btn) {
        await p.mouse.click(btn.x, btn.y); await sleep(100);
        check(await p.evaluate(() => window.__btnHit) >= 1, name + ': header button still clicks (' + btn.aria + ')');
        await p.evaluate(opener).catch(() => {}); await sleep(600);
      } else console.log('NOTE ' + name + ': no header button');
      // reload -> kept
      const key = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('stk_drag_pos.v1') || '{}')));
      const rBefore = await rect(p, psel);
      p = await fresh(); await boot(p);
      await p.evaluate(() => { const c = window.STRYKER_VELA.active.chart; if (!c.indicators().length) c.addIndicator && c.addIndicator('sma'); });
      await p.evaluate(opener).catch(() => {}); await sleep(700);
      const rAfter = await rect(p, psel);
      check(rAfter && Math.abs(rAfter.x + rAfter.w / 2 - rBefore.x - rBefore.w / 2) < 2 && Math.abs(rAfter.y + rAfter.h / 2 - rBefore.y - rBefore.h / 2) < 12, name + ': position kept after reload', { rBefore, rAfter, key });
      // double-click -> default
      const g3 = await grabPoint(p, hsel); await p.mouse.dblclick(g3.x, g3.y); await sleep(200);
      const rd = await rect(p, psel);
      check(Math.hypot(rd.x + rd.w / 2 - r0.x - r0.w / 2, rd.y + rd.h / 2 - r0.y - r0.h / 2) < 2, name + ': double-click resets to the default spot', { r0, rd });
      // far off screen -> clamped (>= 48px of header visible)
      const g4 = await grabPoint(p, hsel); await dragBy(p, g4, -3000, -3000);
      const hv = await p.evaluate((s) => { const h = [...document.querySelectorAll(s)].find((x) => x.getBoundingClientRect().width > 0 || x.getBoundingClientRect().height > 0); let r = h.getBoundingClientRect(); if (r.width < 48) r = h.closest('#stkr-bar, .stkc-pine, [role=dialog], aside, div[id]').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, bo: r.bottom, hw: r.width, hh: r.height }; }, hsel);
      check(hv.r >= Math.min(47, hv.hw) && hv.bo >= Math.min(47, hv.hh) && hv.t >= 0, name + ': dragged off screen stays reachable (clamped)', hv);
      // the 48px sliver left on screen can sit under other chart UI (e.g. the left toolbar): then use the helper's reset instead
      const g5 = await grabPoint(p, hsel); if (g5) await dragBy(p, g5, 3000, 3000); else { console.log('NOTE ' + name + ': sliver covered by other UI, bottom-right check skipped'); await p.evaluate(() => window.StkDraggable.reset('x')); }
      const hv2 = await p.evaluate((s) => { const h = [...document.querySelectorAll(s)].find((x) => x.getBoundingClientRect().width > 0); const r = h.getBoundingClientRect(); return { l: r.left, t: r.top, w: document.documentElement.clientWidth, h: innerHeight, hw: r.width, hh: r.height }; }, hsel);
      if (g5) check(hv2.w - hv2.l >= Math.min(47, hv2.hw) && hv2.h - hv2.t >= Math.min(47, hv2.hh), name + ': far bottom-right stays reachable', hv2);
      // reset for the next panel
      const g6 = await grabPoint(p, hsel); if (g6) await p.mouse.dblclick(g6.x, g6.y); else await p.evaluate(() => localStorage.removeItem('stk_drag_pos.v1')); await sleep(150);
      await p.keyboard.press('Escape'); await sleep(300);
    }
    console.log('Panels checked: ' + listed.join(', '));
    check(!errors.length, 'no page errors', errors);
    await ctx.close();
    }
    if (process.env.DRAG_ONLY !== 'desktop') {
    // ---- phone 390: sheets are not draggable
    const ph = await open(b, { w: 390, h: 844, mobile: true });
    await boot(ph.p);
    for (const [name, opener, psel, hsel] of PANELS.filter((x) => ['book/DOM/trades', 'alerts', 'indicators window'].includes(x[0]))) {
      await ph.p.evaluate(opener).catch(() => {}); await sleep(700);
      const r0 = await rect(ph.p, psel); if (!r0 || !r0.vis) { check(false, '390 ' + name + ': opens'); continue; }
      const gp = await grabPoint(ph.p, hsel); if (!gp) { console.log('NOTE 390 ' + name + ': no grab point'); continue; }
      await dragBy(ph.p, gp, -100, -150);
      const r1 = await rect(ph.p, psel);
      check(Math.abs(r1.x - r0.x) < 1 && Math.abs(r1.y - r0.y) < 1, '390 ' + name + ': phone sheet stays put');
      await ph.p.screenshot({ path: OUT + '/drag-390-' + name.replace(/\W+/g, '-') + '.png' });
      await ph.p.keyboard.press('Escape'); await sleep(300);
    }
    await ph.ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
