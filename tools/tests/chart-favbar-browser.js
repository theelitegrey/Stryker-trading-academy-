// Charts floating Favorites toolbar test (assets/chart-fav-toolbar.js) against
// tools/tests/chart-dev-server.mjs. Firebase is stubbed (no network writes), so this covers the
// UI + localStorage path; the Firestore path is covered by the rules suite + a live e2e.
//   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-favbar-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 240))); };
const FOUR = ['fibretracement', 'box', 'position', 'trendline'];

async function open(b, ctx) {
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|WebSocket|Failed to load resource/.test(m.text())) p.errors.push(m.text()); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_FAVBAR && document.querySelector('.vela-dtb'), null, { timeout: 40000 });
  await p.waitForTimeout(2500);
  return p;
}
async function newCtx(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 3 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  return ctx;
}
const barInfo = (p) => p.evaluate(() => {
  const bar = document.querySelector('.stk-fb');
  const g = document.querySelector('#vela-chart .vela-ws-grid').getBoundingClientRect();
  const r = bar.getBoundingClientRect();
  const ps = document.querySelector('#vela-chart .vela-cell');
  return { hidden: bar.hidden, types: [...bar.querySelectorAll('.stk-fb-b')].map((x) => x.dataset.type), on: [...bar.querySelectorAll('.stk-fb-b.on')].map((x) => x.dataset.type),
    r: { l: Math.round(r.left - g.left), t: Math.round(r.top - g.top), w: Math.round(r.width), h: Math.round(r.height) }, g: { w: Math.round(g.width), h: Math.round(g.height) },
    inside: r.left >= g.left - 0.5 && r.top >= g.top - 0.5 && r.right <= g.right + 0.5 && r.bottom <= g.bottom + 0.5,
    st: window.STRYKER_FAVBAR.state, ls: localStorage.getItem('stryker_chart_favbar'), bg: getComputedStyle(bar).backgroundColor };
});
// Star a tool the way a member does: open its group flyout and click the star on its row.
async function starViaFlyout(p, type) {
  return p.evaluate(async (type) => {
    const tb = document.querySelector('.vela-dtb');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    if (!window.__labels || !window.__labels[type]) { const m = await import('./assets/vendor/vela-0.6.17-s3/index.js'); window.__labels = window.__labels || {}; window.__labels[type] = m.getDrawingType(type).label; }
    for (const a of [...tb.querySelectorAll('.vela-dtb-arrow')]) {
      a.click(); await wait(100);
      const fly = document.querySelector('.vela-dtb-flyout');
      const row = fly && [...fly.querySelectorAll('.vela-dtb-item')].find((r) => r.getAttribute('aria-label') === window.__labels[type]);
      if (row) {
        row.querySelector('.vela-dtb-star').click(); await wait(80);
        const still = !!document.querySelector('.vela-dtb-flyout');   // star must not close the menu
        a.click(); await wait(60);
        return still;
      }
      a.click(); await wait(40);
    }
    return false;
  }, type);
}
async function dragHandle(p, toX, toY, touch) {
  const h = await p.$('.stk-fb-h');
  const hb = await h.boundingBox();
  const sx = hb.x + hb.width / 2, sy = hb.y + hb.height / 2;
  if (!touch) {
    await p.mouse.move(sx, sy); await p.mouse.down();
    for (let i = 1; i <= 8; i++) await p.mouse.move(sx + (toX - sx) * i / 8, sy + (toY - sy) * i / 8);
    await p.mouse.up();
  } else {
    await p.evaluate(([sx, sy, tx, ty]) => {
      const h = document.querySelector('.stk-fb-h');
      const ev = (type, x, y) => h.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1 }));
      ev('pointerdown', sx, sy);
      for (let i = 1; i <= 8; i++) ev('pointermove', sx + (tx - sx) * i / 8, sy + (ty - sy) * i / 8);
      ev('pointerup', tx, ty);
    }, [sx, sy, toX, toY]);
  }
  await p.waitForTimeout(250);
}
const shot = async (p, n) => { await p.screenshot({ path: OUT + '/' + n + '.png' }); console.log('shot', OUT + '/' + n + '.png'); };

(async () => {
  const b = await launch();
  try {
    for (const theme of ['dark', 'day']) {
      const ctx = await newCtx(b, { w: 1440, h: 900, theme });
      let p = await open(b, ctx);
      await p.evaluate(() => { window.__labels = {}; });
      // labels from the registry via the bar's own meta: arm a dummy render
      await p.evaluate(async () => {
        const m = await import('./assets/vendor/vela-0.6.17-s3/index.js');
        for (const t of ['fibretracement', 'box', 'position', 'trendline', 'hline']) window.__labels[t] = m.getDrawingType(t).label;
      });
      let i0 = await barInfo(p);
      check(i0.hidden && i0.types.length === 0, theme + ': no favourites -> bar hidden', i0.types);
      check(await p.$('.stk-fb-tog') != null, theme + ': show/hide star button in the left toolbar');
      for (const t of FOUR) check(await starViaFlyout(p, t), theme + ': starred via flyout ' + t);
      await p.waitForTimeout(300);
      let i1 = await barInfo(p);
      check(!i1.hidden && i1.types.join() === FOUR.join(), theme + ': bar shows the 4 in starred order', i1.types);
      check(i1.inside, theme + ': default position inside the grid', i1.r);
      check(Math.abs(i1.r.l + i1.r.w / 2 - i1.g.w / 2) < 3 && i1.r.t > 20 && i1.r.t < 120, theme + ': default top-centre under the legend', i1.r);
      if (theme === 'dark') check(i1.bg === 'rgb(30, 34, 45)', 'dark pill colour', i1.bg);
      // Arm each and draw
      for (const t of FOUR) {
        await p.click('.stk-fb-b[data-type="' + t + '"]');
        await p.waitForTimeout(120);
        const armed = await p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.getTool());
        const on = (await barInfo(p)).on;
        check(armed === t && on.join() === t, theme + ': click arms ' + t + ' + highlight', { armed, on });
        const n0 = await p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.list ? window.STRYKER_VELA.active.chart.drawings.list().length : JSON.parse(JSON.stringify(window.STRYKER_VELA.active.chart.drawings.toJSON())).drawings.length);
        const g = await p.evaluate(() => { const r = document.querySelector('#vela-chart .vela-cell canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
        const x1 = g.x + g.w * 0.35, y1 = g.y + g.h * 0.45, x2 = g.x + g.w * 0.55, y2 = g.y + g.h * 0.6;
        await p.mouse.click(x1, y1); await p.waitForTimeout(100);
        await p.mouse.move(x2, y2, { steps: 4 }); await p.mouse.click(x2, y2); await p.waitForTimeout(200);
        await p.keyboard.press('Escape');
        const n1 = await p.evaluate(() => JSON.parse(JSON.stringify(window.STRYKER_VELA.active.chart.drawings.toJSON())).drawings.length);
        check(n1 > n0, theme + ': a ' + t + ' drawing was made', { n0, n1 });
        if (theme === 'dark' && t === 'position') await shot(p, 'fb-1440-dark-drawn');
      }
      await p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.setTool(null));
      // Tooltip
      await p.hover('.stk-fb-b[data-type="fibretracement"]'); await p.waitForTimeout(600);
      const tipTxt = await p.evaluate(() => { const t = document.querySelector('.stk-fb-tip'); return t.hidden ? null : t.textContent; });
      check(tipTxt === await p.evaluate(() => window.__labels.fibretracement), theme + ': tooltip shows tool name', tipTxt);
      await shot(p, 'fb-1440-' + theme + '-default');
      // Drag to 3 positions
      const gb = await p.evaluate(() => { const r = document.querySelector('#vela-chart .vela-ws-grid').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      await dragHandle(p, gb.x + 5000, gb.y + gb.h + 900);
      let d1 = await barInfo(p);
      check(d1.inside && Math.abs(d1.r.l + d1.r.w - d1.g.w) <= 1 && Math.abs(d1.r.t + d1.r.h - d1.g.h) <= 1, theme + ': dragged past bottom-right -> clamped in the corner', d1.r);
      await dragHandle(p, gb.x - 400, gb.y - 300);
      let d2 = await barInfo(p);
      check(d2.inside && d2.r.l === 0 && d2.r.t === 0, theme + ': dragged past top-left -> clamped at 0,0', d2.r);
      await dragHandle(p, gb.x + gb.w * 0.3, gb.y + gb.h * 0.7);
      let d3 = await barInfo(p);
      check(d3.inside && Math.abs(d3.st.x - (d3.r.l / d3.g.w)) < 0.01, theme + ': mid drag stored as fraction', { r: d3.r, x: d3.st.x, y: d3.st.y });
      if (theme === 'dark') await shot(p, 'fb-1440-dark-moved');
      // Reorder: drag trendline icon to the front
      const tl = await (await p.$('.stk-fb-b[data-type="trendline"]')).boundingBox();
      const fr = await (await p.$('.stk-fb-b[data-type="fibretracement"]')).boundingBox();
      await p.mouse.move(tl.x + tl.width / 2, tl.y + tl.height / 2); await p.mouse.down();
      for (let i = 1; i <= 8; i++) await p.mouse.move(tl.x + (fr.x - tl.x) * i / 8, tl.y + tl.height / 2);
      await p.mouse.up(); await p.waitForTimeout(200);
      const ro = await barInfo(p);
      check(ro.types[0] === 'trendline' && ro.types.length === 4, theme + ': drag icon reorders', ro.types);
      check(await p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.getTool()) == null, theme + ': reorder drag did not arm a tool');
      // Reload -> same tools, order, position
      const before = await barInfo(p);
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_FAVBAR, null, { timeout: 40000 });
      await p.waitForTimeout(2500);
      const after = await barInfo(p);
      check(after.types.join() === before.types.join() && Math.abs(after.r.l - before.r.l) <= 1 && Math.abs(after.r.t - before.r.t) <= 1, theme + ': reload keeps tools, order and position', { before: [before.types, before.r], after: [after.types, after.r] });
      // Resize keeps relative position
      await p.setViewportSize({ width: 1200, height: 800 }); await p.waitForTimeout(600);
      const rs = await barInfo(p);
      check(rs.inside && Math.abs(rs.r.l / rs.g.w - after.st.x) < 0.02, theme + ': resize keeps relative position', { r: rs.r, g: rs.g, x: after.st.x });
      await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(600);
      // Hide via context menu, show via toggle
      await p.click('.stk-fb-h', { button: 'right' }); await p.waitForTimeout(200);
      const mtxt = await p.evaluate(() => { const m = document.querySelector('.stk-fb-menu'); return m && m.textContent; });
      check(mtxt === 'Hide favorites toolbar', theme + ': right-click menu', mtxt);
      if (theme === 'day') await shot(p, 'fb-1440-day-menu');
      await p.click('.stk-fb-menu button'); await p.waitForTimeout(200);
      check((await barInfo(p)).hidden, theme + ': hidden after "Hide"');
      const tl1 = await p.$eval('.stk-fb-tog', (x) => x.getAttribute('aria-label'));
      check(tl1 === 'Show favorites toolbar', theme + ': toggle says Show', tl1);
      await p.click('.stk-fb-tog'); await p.waitForTimeout(250);
      check(!(await barInfo(p)).hidden, theme + ': toggle shows it again');
      // Unfavourite one via flyout -> removed; then all -> hidden
      check(await starViaFlyout(p, 'box'), theme + ': unstar box via flyout');
      await p.waitForTimeout(200);
      const u1 = await barInfo(p);
      check(!u1.types.includes('box') && u1.types.length === 3, theme + ': unfavourite removes it', u1.types);
      for (const t of ['fibretracement', 'position', 'trendline']) await starViaFlyout(p, t);
      await p.waitForTimeout(200);
      const u2 = await barInfo(p);
      check(u2.hidden && u2.types.length === 0, theme + ': zero favourites -> hidden', u2.types);
      // 2x2 layout: favourite 2, click cell D, arm -> armed on D only
      for (const t of ['hline', 'trendline']) await starViaFlyout(p, t);
      await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('4')); await p.waitForTimeout(3500);
      const four = await p.evaluate(() => window.STRYKER_VELA.cells().map((c) => c.id));
      const dEl = await p.evaluate((id) => { const r = document.querySelector('.vela-cell[data-cell-id="' + id + '"]').getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 }; }, four[3]);
      await p.mouse.click(dEl.x, dEl.y); await p.waitForTimeout(300);
      await p.click('.stk-fb-b[data-type="hline"]'); await p.waitForTimeout(150);
      const armedPer = await p.evaluate(() => window.STRYKER_VELA.cells().map((c) => [c.id, c.chart.drawings.getTool(), c.chart.drawings.favorites().join('+')]));
      check(armedPer[3][1] === 'hline' && armedPer.slice(0, 3).every((x) => x[1] == null), theme + ': 2x2 arms the active (last-clicked) cell only', armedPer);
      const g4 = await barInfo(p);
      check(!g4.hidden && g4.inside && g4.types.join() === 'hline,trendline', theme + ': 2x2 one bar, inside grid', g4);
      await p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.setTool(null));
      await shot(p, 'fb-1440-' + theme + '-2x2');
      await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('1')); await p.waitForTimeout(1500);
      check(p.errors.length === 0, theme + ': no page errors', p.errors);
      await ctx.close();
    }
    // ---- phone 390 ----
    for (const theme of ['dark', 'day']) {
      const ctx = await newCtx(b, { w: 390, h: 844, mobile: true, theme });
      await ctx.addInitScript(() => { try { if (!localStorage.getItem('stryker_chart_favbar')) localStorage.setItem('stryker_chart_favbar', JSON.stringify({ tools: ['fibretracement', 'box', 'position', 'trendline'], x: null, y: null, visible: true })); } catch (e) {} });
      const p = await open(b, ctx);
      const i = await barInfo(p);
      const axis = await p.evaluate(() => { const c = document.querySelector('#vela-chart .vela-cell'); const g = document.querySelector('#vela-chart .vela-ws-grid').getBoundingClientRect(); const cv = [...c.querySelectorAll('canvas')].map((x) => x.getBoundingClientRect()).sort((a, b) => b.width - a.width)[0]; return Math.round(g.right - 60 - g.left); });
      check(!i.hidden && i.types.length === 4 && i.inside, theme + ' 390: bar shows from localStorage, inside', i.r);
      check(i.r.l + i.r.w <= axis, theme + ' 390: does not cover the price axis by default', { right: i.r.l + i.r.w, axisFrom: axis });
      await shot(p, 'fb-390-' + theme + '-default');
      const gb = await p.evaluate(() => { const r = document.querySelector('#vela-chart .vela-ws-grid').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      await dragHandle(p, gb.x + 20, gb.y + gb.h * 0.75, true);
      const t1 = await barInfo(p);
      check(t1.inside && t1.r.t > gb.h * 0.5, theme + ' 390: touch drag moves it', t1.r);
      await dragHandle(p, gb.x + 900, gb.y + 2000, true);
      const t2 = await barInfo(p);
      check(t2.inside, theme + ' 390: touch drag clamped', t2.r);
      // tap arms
      await p.tap('.stk-fb-b[data-type="box"]'); await p.waitForTimeout(150);
      check(await p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.getTool()) === 'box', theme + ' 390: tap arms the tool');
      await p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.setTool(null));
      if (theme === 'dark') { await dragHandle(p, gb.x + 40, gb.y + gb.h * 0.55, true); await shot(p, 'fb-390-dark-moved'); }
      check(p.errors.length === 0, theme + ' 390: no page errors', p.errors);
      await ctx.close();
    }
  } catch (e) { fail++; console.log('FAIL exception', e && e.stack); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
