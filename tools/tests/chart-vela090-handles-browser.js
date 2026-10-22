// Box handles + cursors (TradingView look) on the Vela 0.9.0 engine.
//   CHART_BASE=http://127.0.0.1:PORT node tools/tests/chart-vela090-handles-browser.js <shotsDir>
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };

(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); } catch (e) {}
    let L; Object.defineProperty(window, 'StrykerPineLibrary', { configurable: true, get() { return L; }, set(v) { if (v) v.isAdmin = () => Promise.resolve(true); L = v; } });
  });
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick|workers\.dev|binance)\./, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e)); });
  await p.goto(BASE + '/charts.html?vela=0.9', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { try { const ws = window.STRYKER_VELA; return ws && ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount > 50; } catch (e) { return false; } }, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  const R = (src, arg) => p.evaluate(([src, arg]) => { const ws = window.STRYKER_VELA; const cell = ws.cell(ws.active.id); const r = cell.chart.renderer.renderer; return (new Function('ws', 'cell', 'r', 'arg', src))(ws, cell, r, arg); }, [src, arg]);
  await R('r.applyViewport({ barSpacing: 8, rightOffset: 10 }); return 1;');
  const box = await p.evaluate(() => { const c = [...document.querySelectorAll('#vela-chart canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; const q = c.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height }; });
  const X = (x) => box.x + x, Y = (y) => box.y + y;
  const boxDoc = () => R('const d = r.userDrawings.drawings.find((x) => x.type === "box"); return d ? { a: d.anchors.map((q) => ({ ...q })), s: { ...d.style }, h: d.handlePoints(r.drawingProjector()) } : null;');
  const cursor = async (x, y) => { await p.mouse.move(X(x), Y(y)); await p.waitForTimeout(120); return p.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); let e = el; while (e && getComputedStyle(e).cursor === 'auto') e = e.parentElement; return e ? getComputedStyle(e).cursor : 'auto'; }, [X(x), Y(y)]); };

  // draw a box
  await R('cell.chart.drawings.setTool("box"); return 1;');
  const x0 = box.w * 0.3, y0 = box.h * 0.3, x1 = box.w * 0.55, y1 = box.h * 0.55;
  await p.mouse.move(X(x0), Y(y0)); await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(X(x0 + (x1 - x0) * i / 10), Y(y0 + (y1 - y0) * i / 10));
  await p.mouse.up(); await p.waitForTimeout(300);
  let d = await boxDoc();
  check(!!d, 'box drawn');
  check(d.s.lineColor.toLowerCase() === '#2962ff' && /^#2962ff/i.test(d.s.fillColor || ''), 'default box is TradingView blue with see-through fill', d.s);
  // select it
  await p.mouse.click(X((x0 + x1) / 2), Y(y0)); await p.waitForTimeout(250);
  d = await boxDoc();
  check(d.h.length === 8 && d.h.filter((h) => h[2] === 'sq').length === 4, '8 handles: 4 corners + 4 edge squares', d.h);
  await p.screenshot({ path: OUT + '/handles-1440-selected.png', clip: { x: X(x0) - 40, y: Y(y0) - 40, width: (x1 - x0) + 80, height: (y1 - y0) + 80 } });
  // painted pixels: white centre at a corner and at an edge midpoint
  const px = await p.evaluate(([pts]) => {
    const cs = [...document.querySelectorAll('#vela-chart canvas')];
    const out = [];
    for (const [x, y] of pts) {
      let hit = null;
      for (const c of cs) {
        const q = c.getBoundingClientRect(); const sx = c.width / q.width;
        const g = c.getContext('2d', { willReadFrequently: true }); if (!g) continue;
        const v = g.getImageData(Math.round((x - q.left) * sx), Math.round((y - q.top) * sx), 1, 1).data;
        if (v[3] > 200 && v[0] > 240 && v[1] > 240 && v[2] > 240) hit = true;
      }
      out.push(!!hit);
    }
    return out;
  }, [[[X(d.h[2][0]) + 2.5, Y(d.h[2][1])], [X(d.h[4][0]) + 2.5, Y(d.h[4][1])]]]);
  check(px.every(Boolean), 'handles painted white-filled (corner circle + edge square)', px);

  // cursors
  const cur = {};
  cur.inside = await cursor((x0 + x1) / 2, (y0 + y1) / 2 + 5);
  cur.top = await cursor(d.h[4][0], d.h[4][1]);
  cur.left = await cursor(d.h[6][0], d.h[6][1]);
  cur.c0 = await cursor(d.h[0][0], d.h[0][1]);
  cur.c2 = await cursor(d.h[2][0], d.h[2][1]);
  check(cur.inside === 'move', 'move cursor inside the box', cur);
  check(cur.top === 'ns-resize' && cur.left === 'ew-resize', 'edge cursors ns / ew', cur);
  check(cur.c0 === 'nwse-resize' && cur.c2 === 'nesw-resize', 'corner cursors nwse / nesw', cur);

  // edge drag: top edge moves price only
  const drag = async (fx, fy, tx, ty) => { await p.mouse.move(X(fx), Y(fy)); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(X(fx + (tx - fx) * i / 8), Y(fy + (ty - fy) * i / 8)); await p.mouse.up(); await p.waitForTimeout(250); };
  let before = await boxDoc();
  await drag(before.h[4][0], before.h[4][1], before.h[4][0] + 60, before.h[4][1] - 40);
  let after = await boxDoc();
  check(after.a[0].time === before.a[0].time && after.a[1].time === before.a[1].time && after.a[0].price > before.a[0].price && after.a[1].price === before.a[1].price, 'top edge moves only the top price', { before: before.a, after: after.a });
  // right edge moves time only
  before = after;
  await drag(before.h[7][0], before.h[7][1], before.h[7][0] + 80, before.h[7][1] + 30);
  after = await boxDoc();
  check(after.a[1].time > before.a[1].time && after.a[0].time === before.a[0].time && after.a[0].price === before.a[0].price && after.a[1].price === before.a[1].price, 'right edge moves only the right time', { before: before.a, after: after.a });
  // corner (bottom-left = handle 2) moves a.time + b.price
  before = after;
  await drag(before.h[2][0], before.h[2][1], before.h[2][0] - 50, before.h[2][1] + 40);
  after = await boxDoc();
  check(after.a[0].time < before.a[0].time && after.a[1].price < before.a[1].price && after.a[0].price === before.a[0].price && after.a[1].time === before.a[1].time, 'corner moves both sides it touches', { before: before.a, after: after.a });
  // body drag moves all
  before = after;
  const cxm = (before.h[0][0] + before.h[1][0]) / 2, cym = (before.h[0][1] + before.h[1][1]) / 2;
  await drag(cxm, cym, cxm + 40, cym + 30);
  after = await boxDoc();
  check(after.a[0].time > before.a[0].time && after.a[1].time > before.a[1].time && after.a[0].price < before.a[0].price, 'inside drag moves the whole box', { before: before.a, after: after.a });
  await p.screenshot({ path: OUT + '/handles-1440-after.png' });

  // other tools: round white handles
  await R('cell.chart.drawings.setTool("trendline"); return 1;');
  await p.mouse.click(X(box.w * 0.2), Y(box.h * 0.75)); await p.waitForTimeout(150);
  await p.mouse.click(X(box.w * 0.4), Y(box.h * 0.65)); await p.waitForTimeout(250);
  await p.mouse.click(X(box.w * 0.3), Y(box.h * 0.70)); await p.waitForTimeout(250);
  await p.screenshot({ path: OUT + '/handles-1440-trendline.png', clip: { x: X(box.w * 0.2) - 30, y: Y(box.h * 0.65) - 30, width: box.w * 0.2 + 60, height: box.h * 0.1 + 60 } });
  const tl = await R('const d = r.userDrawings.drawings.find((x) => x.type === "trendline"); return d.handlePoints(r.drawingProjector());');
  const tc = await cursor(tl[0][0], tl[0][1]);
  check(tc === 'grab', 'trend line point shows a grab cursor', tc);
  check(errors.length === 0, 'no page errors', errors.slice(0, 4));
  await b.close();
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
