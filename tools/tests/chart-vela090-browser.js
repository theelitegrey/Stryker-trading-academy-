// Vela 0.9.0 admin trial (?vela=0.9): boots, feel numbers vs TradingView, drawings, phone.
//   CHART_BASE=http://127.0.0.1:PORT node tools/tests/chart-vela090-browser.js <shotsDir>
// Runs against tools/tests/chart-dev-server.mjs. Firebase is stubbed (richstub) and the admin
// check answers yes, so the trial flag stays on.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };

async function open(b, { w, h, mobile, flag = '0.9' }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); } catch (e) {}
    let L; Object.defineProperty(window, 'StrykerPineLibrary', { configurable: true, get() { return L; }, set(v) { if (v) v.isAdmin = () => Promise.resolve(true); L = v; } });
  });
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e)); });
  p.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource|firebase|firestore|CORS policy/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
  await p.goto(BASE + '/charts.html?vela=' + flag, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { try { const ws = window.STRYKER_VELA; return ws && ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount > 50; } catch (e) { return false; } }, null, { timeout: 60000 });
  await p.waitForTimeout(3000);
  return { ctx, p, errors };
}
const R = (p, fn, arg) => p.evaluate(([src, arg]) => { const ws = window.STRYKER_VELA; const cell = ws.cell(ws.active.id); const r = cell.chart.renderer.renderer; return (new Function('ws', 'cell', 'r', 'arg', src))(ws, cell, r, arg); }, [fn, arg]);
const vp = (p) => R(p, 'const v = r.coords.getViewport(); return { bs: v.barSpacing, ro: v.rightOffset, w: r.coords.width, n: r.coords.barCount };');
async function plotBox(p) {
  return p.evaluate(() => {
    const ws = window.STRYKER_VELA; const host = ws.cell(ws.active.id).host || document.querySelector('.vela-cell');
    const c = [...host.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height };
  });
}
const resetView = (p) => R(p, 'r.applyViewport({ barSpacing: 6, rightOffset: 10 }); return 1;');
const drawings = (p) => R(p, 'const d = cell.chart.drawings; try { return (d.list ? d.list() : d.all ? d.all() : r.userDrawings.store.all()).length; } catch (e) { try { return r.userDrawings.drawings().length; } catch (e2) { return -1; } }');

(async () => {
  const b = await launch();
  let { ctx, p, errors } = await open(b, { w: 1440, h: 900 });
  const meta = await p.evaluate(() => ({ flag: window.__stkVela090, map: document.querySelector('script[type=importmap]').textContent.includes('0.9.0-s3') }));
  check(meta.flag && meta.map, 'flag on, import map points at 0.9.0-s3', meta);
  const box = await plotBox(p);
  const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.45;
  await p.screenshot({ path: OUT + '/vela090-1440-start.png' });

  // #2 wheel notch, #3 instant
  await resetView(p); await p.mouse.move(cx, cy); await p.waitForTimeout(200);
  let a = await vp(p); await p.mouse.wheel(0, -100); await p.waitForTimeout(30);
  let z = await vp(p); await p.waitForTimeout(400); let z2 = await vp(p);
  check(Math.abs(z2.bs / a.bs - 1.10) < 0.02, 'wheel notch zoom ~x1.10', z2.bs / a.bs);
  check(Math.abs(z.bs - z2.bs) < 1e-6, 'zoom instant (no ease)', [z.bs, z2.bs]);
  // #11 max zoom-in ~9 bars
  for (let i = 0; i < 60; i++) await p.mouse.wheel(0, -300);
  await p.waitForTimeout(200); z = await vp(p);
  check(Math.abs(z.w / z.bs - 9) < 1.5, 'max zoom-in ~9 bars', z.w / z.bs);
  // #5 right empty space <= ~half
  await resetView(p);
  await p.mouse.move(cx, cy); await p.mouse.down();
  for (let i = 1; i <= 30; i++) await p.mouse.move(cx - i * 40, cy);
  await p.mouse.up(); await p.waitForTimeout(300); z = await vp(p);
  const visBars = z.w / z.bs;
  check(z.ro / visBars <= 0.52, 'empty space past last bar <= ~half the plot', { ro: z.ro, visBars, frac: z.ro / visBars });
  // #4 drag stops where released
  await resetView(p); await p.waitForTimeout(100);
  await p.mouse.move(cx, cy); await p.mouse.down();
  for (let i = 1; i <= 10; i++) { await p.mouse.move(cx + i * 20, cy); await p.waitForTimeout(8); }
  await p.mouse.up(); a = await vp(p); await p.waitForTimeout(800); z = await vp(p);
  check(Math.abs(a.ro - z.ro) < 0.05, 'mouse drag stops on release (no glide)', [a.ro, z.ro]);
  // #7 time-axis drag 100 px left -> x1.16
  await resetView(p); a = await vp(p);
  const ty = box.y + box.h - 8;
  await p.mouse.move(cx, ty); await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(cx - i * 10, ty);
  await p.mouse.up(); z = await vp(p);
  check(Math.abs(z.bs / a.bs - 1.16) < 0.04, 'time-axis drag 100px ~x1.16', z.bs / a.bs);
  // #6 price-axis drag 100 px up -> range x0.85
  await resetView(p); await p.waitForTimeout(300);
  const rng = () => R(p, 'const s = r.scene.panes.get("price").scale; return s.max - s.min;');
  const r0 = await rng(); const px = box.x + box.w - 25;
  await p.mouse.move(px, cy); await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(px, cy - i * 10);
  await p.mouse.up(); await p.waitForTimeout(400); const r1 = await rng();
  check(Math.abs(r1 / r0 - 0.85) < 0.05, 'price-axis drag 100px ~x0.85', r1 / r0);
  await p.mouse.dblclick(px, cy); await p.waitForTimeout(300);
  // #15 shift+wheel direction (TV: wheel down with shift scrolls back in time = view moves left)
  await resetView(p); await p.mouse.move(cx, cy); await p.waitForTimeout(100); a = await vp(p);
  await p.keyboard.down('Shift'); await p.mouse.wheel(0, 100); await p.keyboard.up('Shift'); await p.waitForTimeout(200);
  z = await vp(p);
  check(Math.abs((z.ro - a.ro) * z.bs + 80) < 3, 'shift+wheel 100 moves 80px, TV direction', (z.ro - a.ro) * z.bs);

  // #8 press-drag-release trend line + box; click-click still works
  await resetView(p); await p.waitForTimeout(300);
  const n0 = await drawings(p);
  for (const [tool, ox, oy] of [['trendline', -200, -40], ['box', 150, -200]]) {
    await R(p, 'cell.chart.drawings.setTool(arg); return 1;', tool);
    await p.mouse.move(cx + ox, cy + oy); await p.mouse.down();
    for (let i = 1; i <= 10; i++) await p.mouse.move(cx + ox + i * 15, cy + oy + i * 6);
    await p.mouse.up(); await p.waitForTimeout(300);
    console.log('  after', tool, await drawings(p));
    await p.keyboard.press('Escape');
  }
  const n1 = await drawings(p);
  check(n1 - n0 === 2, 'press-drag-release made trend line + box', [n0, n1]);
  await R(p, 'cell.chart.drawings.setTool("trendline"); return 1;');
  await p.mouse.click(cx + 50, cy + 60); await p.waitForTimeout(150); await p.mouse.click(cx + 180, cy + 20); await p.waitForTimeout(300);
  const n2 = await drawings(p);
  check(n2 - n1 === 1, 'click-click trend line still works', [n1, n2]);
  await p.screenshot({ path: OUT + '/vela090-1440-drawings.png' });

  // #9 strong magnet lands exactly on bar time + OHLC (5 anchors)
  const snaps = await R(p, `
    const out = []; const W = r.coords.width;
    for (let k = 0; k < 5; k++) {
      const x = W * (0.2 + k * 0.13), y = 200 + k * 37;
      const pt = r.drawingProjector().pxToPoint(x, y, 'price');
      const s = r.snapToCandle(pt, 'price', 'strong');
      const bar = r.bars.find((b) => b.time === s.time);
      out.push(!!bar && [bar.open, bar.high, bar.low, bar.close].includes(s.price));
    }
    const pt = r.drawingProjector().pxToPoint(W * 0.5, 300, 'price');
    const i = Math.round(r.coords.timeToLogical(pt.time)); const b = r.bars[i];
    const py = r.drawingProjector().yOf(b.high, 'price'), bx = r.drawingProjector().xOf(b.time);
    const near = r.snapToCandle(r.drawingProjector().pxToPoint(bx + 3, py + 15, 'price'), 'price', 'weak', { x: bx + 3, y: py + 15 });
    const raw = r.drawingProjector().pxToPoint(bx + 3, py + 15, 'price');
    return { strong: out, weakAt15px: near.price !== raw.price && (() => { const nb = r.bars.find((x) => x.time === near.time); return !!nb && [nb.open, nb.high, nb.low, nb.close].includes(near.price); })(), dbg: { raw, near, b, py, bx } };`);
  check(snaps.strong.every(Boolean), 'strong magnet exact OHLC on 5 anchors', snaps.strong);
  check(snaps.weakAt15px, 'weak magnet snaps from 15px (radius 20)', snaps.dbg);

  // drawings survive a timeframe change
  const before = await drawings(p);
  await R(p, 'cell.setTimeframe("5"); return 1;'); await p.waitForTimeout(5000);
  await R(p, 'cell.setTimeframe("15"); return 1;'); await p.waitForTimeout(5000);
  check(await drawings(p) === before, 'drawings kept after 15m->5m->15m', before);

  // double-click a drawing opens the settings panel
  await R(p, 'cell.chart.drawings.setTool(null); return 1;');
  await p.mouse.dblclick(cx + 115, cy + 40); await p.waitForTimeout(800);
  const dlg = await p.evaluate(() => !![...document.querySelectorAll('[role=dialog], .vela-dialog, .vela-drawing-settings')].find((e) => e.offsetParent !== null));
  check(dlg, 'double-click on a drawing opens its settings panel');
  await p.screenshot({ path: OUT + '/vela090-1440-dblclick.png' });
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // Alt+H / Alt+V from a clean state (0.9.0: add a line at the crosshair)
  await p.mouse.click(cx - 300, cy + 100); await p.mouse.move(cx - 290, cy + 90); await p.waitForTimeout(200);
  const h0 = await drawings(p);
  await p.keyboard.press('Alt+h'); await p.waitForTimeout(300); await p.keyboard.press('Alt+v'); await p.waitForTimeout(300);
  check(await drawings(p) - h0 === 2, 'Alt+H and Alt+V each add a line', [h0, await drawings(p)]);

  // settings toggle exists for admins + margins rows still work on 0.9.0
  const mg = await p.evaluate(() => { try { return window.__stkMarginsProbe ? window.__stkMarginsProbe() : null; } catch (e) { return String(e); } });
  check(mg && mg.ok, 'Settings margins reach 0.9.0 (style.margins)', mg);
  check(errors.length === 0, 'no page errors on 1440', errors.slice(0, 5));
  await ctx.close();

  // ---- phone 390: boots, pinch keeps the midpoint bar ----
  ({ ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true }));
  await p.screenshot({ path: OUT + '/vela090-390-start.png' });
  const pb = await plotBox(p);
  const pin = await R(p, `
    const ip = r.input; const W = r.coords.width; const mid = W * 0.5;
    const L0 = r.coords.xToLogical(mid); const bs0 = r.coords.getViewport().barSpacing;
    return { L0, bs0, mid };`);
  const cdp = await ctx.newCDPSession(p);
  const tp = (pts) => pts.map(([x, y], i) => ({ x: pb.x + x, y: pb.y + y, id: i }));
  const my = pb.h * 0.45;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[pin.mid - 30, my], [pin.mid + 30, my]]) });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([[pin.mid - 30 - i * 10, my], [pin.mid + 30 + i * 10, my]]) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(400);
  const pin2 = await R(p, 'return { L1: r.coords.xToLogical(arg), bs1: r.coords.getViewport().barSpacing };', pin.mid);
  check(pin2.bs1 / pin.bs0 > 1.5, 'pinch zooms in', pin2.bs1 / pin.bs0);
  check(Math.abs(pin2.L1 - pin.L0) < 2, 'pinch keeps the bar under the fingers', [pin.L0, pin2.L1]);
  await p.screenshot({ path: OUT + '/vela090-390-pinch.png' });
  check(errors.length === 0, 'no page errors on 390', errors.slice(0, 5));
  await ctx.close();

  // ---- members unaffected: no flag -> 0.6.17-s3 ----
  ({ ctx, p, errors } = await open(b, { w: 1440, h: 900, flag: '0.6' }));
  const m = await p.evaluate(() => ({ flag: window.__stkVela090, map: document.querySelector('script[type=importmap]').textContent.includes('0.6.17-s3') }));
  check(!m.flag && m.map, 'without the flag the page stays on 0.6.17-s3', m);
  await ctx.close();
  await b.close();
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
