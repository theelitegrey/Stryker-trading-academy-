// Every right-rail panel is a window: floating by default (Watchlist + News docked), drag, resize, Dock to right / Undock,
// two docked at once (vertical split), reload keeps it, phones keep the bottom sheets. assets/chart-panel-dock.js.
//   node tools/tests/panel-dock-browser.js <shotsDir>      (CHART_BASE=http://127.0.0.1:PORT)
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/dock-shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
// rail button, panel, default mode
const PANELS = [
  ['watchlist', '.stkw-rail > .stkw-railbtn:not([class*=" stk"])', '#stkw', 'dock'],
  ['news', '.stknw-railbtn', '#stknw', 'dock'],
  ['symbol-info', '.stkin-railbtn', '#stkin', 'float'],
  ['gex-ladder', '.stkgl-railbtn', '#stkgl', 'float'],
  ['book', '.stkbp-railbtn', '#stkbp', 'float'],
  ['spectra', '.stksp-railbtn', '#stksp', 'float'],
  ['phantom', '.stkph-railbtn', '#stkph', 'float'],
  ['darkpool', '.stkdkp-railbtn', '#stkdkp', 'float'],
  ['data-window', '.vela-widget-panel-dataWindow', '.vela-panel.vela-dw', 'float'],
  ['object-tree', '.vela-widget-panel-objects', '.vela-panel.vela-ot', 'float']
];

async function open(b, { w, h, mobile, theme, keep }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); window.__stkChartFree = false; if (t) localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); if (!sessionStorage.getItem('pdclr')) { sessionStorage.setItem('pdclr', '1'); ['stkpd.v1', 'stkbp.v1', 'stk_drag_pos.v1'].forEach((k) => localStorage.removeItem(k)); Object.keys(localStorage).filter((k) => /open/i.test(k)).forEach((k) => localStorage.removeItem(k)); } } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(2500);
  return { ctx, p, errors };
}
const rect = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.offsetWidth) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; }, sel);
// a point on the header that is not a button / input (a real user grabs the bar, not the title picker)
const grab = (p, sel) => p.evaluate((s) => {
  const hd = document.querySelector(s + ' .stkpd-hd'), b = hd.getBoundingClientRect(), y = b.top + Math.min(b.height / 2, 14);
  for (let x = b.left + 8; x < b.right - 8; x += 4) { const e = document.elementFromPoint(x, y); if (e && hd.contains(e) && !e.closest('button,a,input,select,textarea,label,[role=button],[role=tab]')) return { x, y }; }
  return null;
}, sel);
const chartW = (p) => p.evaluate(() => Math.round(document.getElementById('vela-chart').getBoundingClientRect().width));
const isOpen = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!(e && !e.hidden && e.offsetWidth); }, sel);
async function toggle(p, it, want) {
  if ((await isOpen(p, it[2])) === want) return true;
  const ok = await p.evaluate((s) => { const b = document.querySelector(s); if (!b || b.hidden || !b.offsetWidth) return false; b.click(); return true; }, it[1]);
  await sleep(700);
  return ok;
}
// alignment gate for the header: title + buttons share one centre line, dock + X both 28 px, dock directly before X
const header = (p, sel) => p.evaluate((s) => {
  const P = document.querySelector(s), hd = P && P.querySelector('.stkpd-hd'); if (!hd) return null;
  const dk = hd.querySelector('.stkpd-dk'), x = dk && dk.nextElementSibling;
  const R = (e) => { const b = e.getBoundingClientRect(); return { cy: b.top + b.height / 2, w: b.width, h: b.height, l: b.left, r: b.right }; };
  const vis = [...hd.children].filter((e) => e.offsetWidth && e.offsetHeight && getComputedStyle(e).visibility !== 'hidden' && !/-sp$|stksp-map/.test(e.className)).map(R);
  const svg = dk.querySelector('svg').getBoundingClientRect(), d = R(dk);
  return { dk: d, x: x && R(x), xLabel: x && (x.getAttribute('aria-label') || x.title), cySpread: Math.max(...vis.map((v) => v.cy)) - Math.min(...vis.map((v) => v.cy)), icoOff: Math.abs(svg.left + svg.width / 2 - (d.l + d.w / 2)) + Math.abs(svg.top + svg.height / 2 - d.cy), label: dk.getAttribute('aria-label'), lastIsX: hd.lastElementChild === x || ![...hd.children].slice([...hd.children].indexOf(x) + 1).some((e) => e.offsetWidth) };
}, sel);

(async () => {
  const b = await launch();
  const shots = [];
  for (const [w, h, theme] of [[1440, 900, 'dark'], [1024, 768, 'light']]) {
    const tag = w + '-' + theme;
    let { ctx, p, errors } = await open(b, { w, h, theme });
    const W0 = await chartW(p);
    const host = await rect(p, '.stkchart-panel');
    const rail = await rect(p, '.stkw-rail');
    let tested = 0;
    for (const it of PANELS) {
      const [key, btnSel, sel, def] = it;
      if (!(await toggle(p, it, true))) { console.log('SKIP ' + tag + ' ' + key + ' (no rail button on this chart)'); continue; }
      tested++;
      const st = await p.evaluate(() => window.StkPanelDock._state());
      const docked0 = await p.evaluate((k) => window.StkPanelDock.isDocked(k), key);
      check(docked0 === (def === 'dock'), tag + ' ' + key + ' default = ' + def, st[key]);
      const hd = await header(p, sel);
      check(hd && hd.label === (docked0 ? 'Undock' : 'Dock to right'), tag + ' ' + key + ' header has the dock button', hd);
      if (hd) {
        check(hd.dk.w === 28 && hd.dk.h === 28 && hd.x && hd.x.w === 28 && hd.x.h === 28, tag + ' ' + key + ' dock + X are 28 px', { dk: hd.dk, x: hd.x });
        check(hd.cySpread <= 1.01 && Math.abs(hd.dk.cy - hd.x.cy) <= 0.5, tag + ' ' + key + ' header items on one centre line', hd.cySpread);
        check(hd.icoOff <= 1, tag + ' ' + key + ' icon centred in the dock button', hd.icoOff);
        check(/close/i.test(hd.xLabel || '') && hd.lastIsX, tag + ' ' + key + ' order: [Dock] [X] at the end', hd.xLabel);
      }
      // make it floating
      if (docked0) { await p.click(sel + ' .stkpd-dk'); await sleep(500); }
      let r = await rect(p, sel);
      check(r && (await chartW(p)) === W0 && r.r <= rail.l && r.t >= host.t && r.b <= host.b, tag + ' ' + key + ' floating: over the chart, chart full width, inside the chart area', { r, cw: await chartW(p), W0 });
      await p.screenshot({ path: OUT + '/' + key + '-float-' + tag + '.png' }); shots.push(key + '-float-' + tag);
      // drag the header
      const g = await grab(p, sel);
      check(!!g, tag + ' ' + key + ' header has a free spot to grab');
      await p.mouse.move(g.x, g.y); await p.mouse.down(); await p.mouse.move(g.x - 60, g.y + 20, { steps: 4 }); await p.mouse.move(g.x - 200, g.y + 40, { steps: 6 }); await p.mouse.up(); await sleep(300);
      const r2 = await rect(p, sel), et = Math.min(r.t + 40, host.b - r.h);
      check(r2 && Math.abs(r2.l - (r.l - 200)) <= 2 && Math.abs(r2.t - et) <= 2, tag + ' ' + key + ' drags by its header', { r, r2, et });
      // drag far outside: stays inside
      const h2 = await grab(p, sel);
      await p.mouse.move(h2.x, h2.y); await p.mouse.down(); await p.mouse.move(-400, -300, { steps: 6 }); await p.mouse.up(); await sleep(300);
      const r3 = await rect(p, sel); Object.assign(host, await rect(p, '.stkchart-panel'));   // (the top bar can change height when the chart width changes)
      check(r3.l >= host.l - 1 && r3.t >= host.t - 1, tag + ' ' + key + ' kept inside the chart area', r3);
      // resize from the corner
      const se = await rect(p, sel + ' > .stkpd-h-se');
      await p.mouse.move(se.l + 8, se.t + 8); await p.mouse.down(); await p.mouse.move(se.l + 68, se.t + 48, { steps: 5 }); await p.mouse.up(); await sleep(300);
      const r4 = await rect(p, sel);
      const H0 = await rect(p, '.stkchart-panel'), dh = Math.min(40, H0.b - r3.b, H0.h - 16 - r3.h);   // max height = chart area - 2 x 8 px
      check(r4.w - r3.w >= 55 && r4.w - r3.w <= 61 && Math.abs(r4.h - r3.h - dh) <= 2, tag + ' ' + key + ' resizes from the bottom-right corner', { r3, r4 });
      // dock
      await p.click(sel + ' .stkpd-dk'); await sleep(700);
      const r5 = await rect(p, sel), cw = await chartW(p), vc = await rect(p, '#vela-chart'); Object.assign(host, await rect(p, '.stkchart-panel'));
      check(r5.r === rail.l && r5.t === host.t && r5.b === host.b, tag + ' ' + key + ' docked: full height, against the rail', r5);
      check(Math.abs(W0 - cw - r5.w) <= 1 && vc.r <= r5.l + 1, tag + ' ' + key + ' docked: chart shrinks by the dock width, no overlap', { W0, cw, r5, vc });
      const hd2 = await header(p, sel); check(hd2 && hd2.label === 'Undock', tag + ' ' + key + ' button says Undock when docked', hd2 && hd2.label);
      await p.screenshot({ path: OUT + '/' + key + '-dock-' + tag + '.png' }); shots.push(key + '-dock-' + tag);
      // resize the dock column by its left edge
      const we = await rect(p, sel + ' > .stkpd-h-w');
      const dx = r5.w > 400 ? 40 : -40;   // narrower when wide, wider when narrow (stays inside 260-640)
      await p.mouse.move(we.l + 3, we.t + 200); await p.mouse.down(); await p.mouse.move(we.l + 3 + dx, we.t + 200, { steps: 5 }); await p.mouse.up(); await sleep(500);
      const r6 = await rect(p, sel);
      check(Math.abs(r5.w - r6.w - dx) <= 2 && Math.abs(W0 - (await chartW(p)) - r6.w) <= 1, tag + ' ' + key + ' dock column resizes from its left edge', { r5, r6 });
      // undock by dragging the header out
      const h3 = await grab(p, sel);
      await p.mouse.move(h3.x, h3.y); await p.mouse.down(); await p.mouse.move(h3.x - 300, h3.y + 120, { steps: 8 }); await p.mouse.up(); await sleep(600);
      check(!(await p.evaluate((k) => window.StkPanelDock.isDocked(k), key)) && (await chartW(p)) === W0, tag + ' ' + key + ' dragging the header out undocks', await chartW(p));
      // back to its default; close
      if (def === 'dock') { await p.click(sel + ' .stkpd-dk'); await sleep(400); }
      await toggle(p, it, false);
      check(!(await isOpen(p, sel)) && (await chartW(p)) === W0, tag + ' ' + key + ' closes, chart full width again');
    }
    check(tested >= 8, tag + ' panels tested: ' + tested);

    // two docked at once + a floating one; reload keeps all three
    const A = PANELS[2], B = PANELS[3], C = PANELS[7];
    await toggle(p, A, true); await p.click(A[2] + ' .stkpd-dk'); await sleep(300);
    await toggle(p, B, true); await p.click(B[2] + ' .stkpd-dk'); await sleep(300);
    await toggle(p, C, true); await sleep(500);
    const ra = await rect(p, A[2]), rb = await rect(p, B[2]), rc = await rect(p, C[2]); Object.assign(host, await rect(p, '.stkchart-panel'));
    check(ra && rb && ra.l === rb.l && ra.w === rb.w && ra.t === host.t && Math.abs(ra.b - rb.t) <= 1 && rb.b === host.b, tag + ' two docked panels split the column top / bottom', { ra, rb });
    check(Math.abs(W0 - (await chartW(p)) - ra.w) <= 1, tag + ' chart narrower by one column width only');
    check(rc && rc.r <= ra.l + 1, tag + ' floating panel stays over the chart, left of the dock', rc);
    // the divider
    const dv = await rect(p, B[2] + ' > .stkpd-h-n');
    await p.mouse.move(dv.l + 100, dv.t + 3); await p.mouse.down(); await p.mouse.move(dv.l + 100, dv.t - 97, { steps: 5 }); await p.mouse.up(); await sleep(400);
    const ra2 = await rect(p, A[2]), rb2 = await rect(p, B[2]);
    check(Math.abs(ra2.h - (ra.h - 100)) <= 2 && Math.abs(rb2.t - ra2.b) <= 1, tag + ' divider moves the split', { ra, ra2, rb2 });
    // click a floating panel: it comes to the front
    const z0 = await p.evaluate((s) => +getComputedStyle(document.querySelector(s)).zIndex, C[2]);
    await p.mouse.click(rc.l + 40, rc.b - 30); await sleep(200);
    check((await p.evaluate((s) => +getComputedStyle(document.querySelector(s)).zIndex, C[2])) >= z0, tag + ' click brings a floating panel to the front');
    await p.screenshot({ path: OUT + '/two-docked-' + tag + '.png' }); shots.push('two-docked-' + tag);
    const before = { a: await rect(p, A[2]), b: await rect(p, B[2]), c: await rect(p, C[2]) };
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });   // (reload hits the pretty URL the page rewrote to; static server 404s it)
    try { await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 }); } catch (e) { await p.screenshot({ path: OUT + '/reload-stuck-' + tag + '.png' }); console.log('RELOAD STUCK', errors.slice(-5), await p.evaluate(() => [!!window.__stkHeavyReady, !!window.STRYKER_VELA])); throw e; }
    await sleep(2500);
    for (const it of [A, B, C]) await toggle(p, it, true);
    await sleep(600);
    const after = { a: await rect(p, A[2]), b: await rect(p, B[2]), c: await rect(p, C[2]) };
    check(JSON.stringify(before) === JSON.stringify(after), tag + ' reload keeps docked split + floating spot and size', { before, after });
    // the order panel keeps its own dock: docked next to our column, nothing overlaps
    if (await p.evaluate(() => { const b = document.querySelector('.stkop-railbtn'); if (!b || !b.offsetWidth) return false; b.click(); return true; })) {
      await sleep(900);
      const dk = await p.evaluate(() => { const b = document.querySelector('.stkop-mode[data-a=dock]'); if (!b || !b.offsetWidth) return false; b.click(); return true; });
      await sleep(900);
      const op = await p.evaluate(() => { const e = [...document.querySelectorAll('.stkop, [class*=stkop-panel], #stkop')].find((x) => x.offsetWidth > 200); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), id: e.id, cls: e.className }; });
      const vc2 = await rect(p, '#vela-chart'), ra3 = await rect(p, A[2]);
      check(dk && op && op.r <= ra3.l + 1 && vc2.r <= op.l + 1, tag + ' order panel docked sits between the chart and the dock column', { op, ra3, vc2 });
      const rc3 = await rect(p, C[2]); check(rc3.r <= op.l + 1 || (rc3.w === 260 && rc3.l === host.l), tag + ' floating panel moves left of the docked order panel', { rc3, op });
      await p.screenshot({ path: OUT + '/order-panel-dock-' + tag + '.png' }); shots.push('order-panel-dock-' + tag);
      await p.evaluate(() => { const b = document.querySelector('.stkop-mode[data-a=float]'); if (b) b.click(); }); await sleep(300);
      await p.evaluate(() => { const b = document.querySelector('.stkop-railbtn'); if (b) b.click(); }); await sleep(400);
    } else console.log('SKIP ' + tag + ' order panel (no Trading panel button)');
    check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), tag + ' no horizontal scroll');
    const errs = errors.filter((e) => !/docChanges|onSnapshot|Failed to fetch|NetworkError|ERR_/.test(e));
    check(errs.length === 0, tag + ' no page errors', errs);
    await ctx.close();
  }
  // phones: bottom sheets, no dock button, nothing positioned by the helper
  for (const w of [390, 412]) {
    const { ctx, p } = await open(b, { w, h: 844, mobile: true, theme: 'dark' });
    const btn = await p.evaluate(() => { const b = document.querySelector('.stknw-phonebtn, .stkw-phonebtn'); return b ? b.className : ''; });
    const opened = await p.evaluate(() => { try { window.__stkNews.open(); return true; } catch (e) { return false; } });
    await sleep(800);
    const r = await rect(p, '#stknw');
    const st = await p.evaluate(() => ({ cls: document.getElementById('stknw').className, left: document.getElementById('stknw').style.left, dk: !!(document.querySelector('#stknw .stkpd-dk') && document.querySelector('#stknw .stkpd-dk').offsetWidth) }));
    check(opened && r && r.w >= w - 2 && !st.dk && !/stkpd-p/.test(st.cls) && !st.left, w + ' News is a full-width sheet, no dock button', { r, st, btn });
    check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), w + ' no horizontal scroll');
    await p.screenshot({ path: OUT + '/news-sheet-' + w + '.png' }); shots.push('news-sheet-' + w);
    await ctx.close();
  }
  await b.close();
  console.log('SHOTS ' + OUT + ' ' + shots.length);
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
