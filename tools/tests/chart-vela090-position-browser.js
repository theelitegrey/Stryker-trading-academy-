// Long/Short Position tool (TradingView look) on the Vela 0.9.0 engine.
//   CHART_BASE=http://127.0.0.1:PORT node tools/tests/chart-vela090-position-browser.js <shotsDir>
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
const ADMIN = process.env.AS_MEMBER ? false : true;
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };

(async () => {
  const b = await launch();
  for (const vp of [{ width: 1440, height: 900, tag: '1440' }, { width: 390, height: 844, tag: '390' }]) {
    const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, hasTouch: vp.width < 600 });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((admin) => {
      try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); } catch (e) {}
      let L; Object.defineProperty(window, 'StrykerPineLibrary', { configurable: true, get() { return L; }, set(v) { if (v) v.isAdmin = () => Promise.resolve(admin); L = v; } });
    }, ADMIN);
    await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick|workers\.dev|binance)\./, (r) => r.abort());
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e)); });
    await p.goto(BASE + '/charts.html?vela=0.9', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => { try { const ws = window.STRYKER_VELA; return ws && ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount > 50; } catch (e) { return false; } }, null, { timeout: 60000 });
    await p.waitForTimeout(2500);
    const R = (src, arg) => p.evaluate(([src, arg]) => { const ws = window.STRYKER_VELA; const cell = ws.cell(ws.active.id); const r = cell.chart.renderer.renderer; return (new Function('ws', 'cell', 'r', 'arg', src))(ws, cell, r, arg); }, [src, arg]);
    await R('r.applyViewport({ barSpacing: arg, rightOffset: 5 }); return 1;', vp.width < 600 ? 6 : 9);
    const box = await p.evaluate(() => { const c = [...document.querySelectorAll('#vela-chart canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; const q = c.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height }; });
    const X = (x) => box.x + x, Y = (y) => box.y + y;
    // entry at a bar about 40 bars back, at that bar's close
    const at = await R(`const n = r.bars.length; const bar = r.bars[n - 40]; const proj = r.drawingProjector(); const pid = r.scene.panes.keys().next().value; return { x: proj.xOf(bar.time), y: proj.yOf(bar.close, pid), close: bar.close, time: bar.time };`);
    await R('cell.chart.drawings.setTool("position"); return 1;');
    if (vp.width < 600) { await p.touchscreen.tap(X(at.x), Y(at.y)); await p.waitForTimeout(200); await p.touchscreen.tap(X(at.x + 4), Y(at.y - 1)); }
    else { await p.mouse.click(X(at.x), Y(at.y)); await p.waitForTimeout(150); await p.mouse.click(X(at.x + 2), Y(at.y)); }
    await p.waitForTimeout(400);
    const info = await R(`const d = r.userDrawings.drawings.find((x) => x.type === "position"); if (!d) return null; const proj = r.drawingProjector(); return { a: d.anchors.map((q) => ({ ...q })), pc: d.profitColor, lc: d.lossColor, line: d.style.lineColor, h: d.handlePoints(proj), bars: proj.barsBetween(d.anchors[0].time, d.anchors[1].time), id: d.id };`);
    check(!!info && info.a.length === 3, vp.tag + ' long position placed (3 anchors)', info && info.a);
    if (!info) { await ctx.close(); continue; }
    check(info.bars >= 20 && info.bars <= 30, vp.tag + ' default width about 25 bars', info.bars);
    check(info.pc === '#089981' && info.lc === '#f23645', vp.tag + ' TradingView teal / red zones', [info.pc, info.lc]);
    check(info.a[2].price > info.a[0].price && info.a[1].price < info.a[0].price, vp.tag + ' long: target above, stop below');
    check(info.h.length === 4 && info.h[3][2] === 'sq', vp.tag + ' 4 handles: entry, stop, target, width', info.h);
    // the "run" over the bars after the entry (progress shading + path line)
    const run = await p.evaluate(() => { const ws = window.STRYKER_VELA; const r = ws.cell(ws.active.id).chart.renderer.renderer; const d = r.userDrawings.drawings.find((x) => x.type === 'position'); const proj = r.drawingProjector(); const bars = proj.barsInRange(d.anchors[0].time, d.anchors[1].time); return { n: bars.length }; });
    check(run.n > 10, vp.tag + ' bars inside the box drive the progress shading', run);
    // select it -> labels + handles
    const sel = async () => { await R('r.userDrawings.openSettings ? 0 : 0; return 1;'); };
    await sel();
    if (vp.width < 600) await p.touchscreen.tap(X(at.x + 30), Y((info.h[0][1] + info.h[2][1]) / 2));
    else await p.mouse.click(X(at.x + 60), Y((info.h[0][1] + info.h[2][1]) / 2));
    await p.waitForTimeout(400);
    const selected = await R('return [...(r.userDrawings.targets?.selected || [])];');
    check(selected.includes(info.id), vp.tag + ' click inside selects the position', selected);
    const top = Math.min(...info.h.map((q) => q[1])) - 60, bot = Math.max(...info.h.map((q) => q[1])) + 60;
    const left = Math.max(0, info.h[0][0] - 120);
    await p.screenshot({ path: `${OUT}/position-${vp.tag}-selected.png`, clip: { x: X(left), y: Y(Math.max(0, top)), width: Math.min(box.w - left, (info.h[3][0] - info.h[0][0]) + 240), height: Math.min(box.h - Math.max(0, top), bot - top) } });
    if (vp.width >= 600) {
      // width handle drag
      const before = info.a;
      await p.mouse.move(X(info.h[3][0]), Y(info.h[3][1])); await p.mouse.down();
      for (let i = 1; i <= 8; i++) await p.mouse.move(X(info.h[3][0] + 10 * i), Y(info.h[3][1] + 2));
      await p.mouse.up(); await p.waitForTimeout(250);
      const after = await R('const d = r.userDrawings.drawings.find((x) => x.type === "position"); return d.anchors.map((q) => ({ ...q }));');
      check(after[1].time > before[1].time && after[1].time === after[2].time && after[0].price === before[0].price && after[2].price === before[2].price, 'right-edge handle widens the box only', { before, after });
      // target handle drag
      const h2 = await R('const d = r.userDrawings.drawings.find((x) => x.type === "position"); return d.handlePoints(r.drawingProjector());');
      await p.mouse.move(X(h2[2][0]), Y(h2[2][1])); await p.mouse.down();
      for (let i = 1; i <= 8; i++) await p.mouse.move(X(h2[2][0] + 1), Y(h2[2][1] - 5 * i));
      await p.mouse.up(); await p.waitForTimeout(250);
      const after2 = await R('const d = r.userDrawings.drawings.find((x) => x.type === "position"); return d.anchors.map((q) => ({ ...q }));');
      check(after2[2].price > after[2].price && after2[0].price === after[0].price && after2[1].price === after[1].price, 'target handle moves only the target', { after, after2 });
      // cursors
      const cur = async (x, y) => { await p.mouse.move(X(x), Y(y)); await p.waitForTimeout(120); return p.evaluate(([x, y]) => { let e = document.elementFromPoint(x, y); while (e && getComputedStyle(e).cursor === 'auto') e = e.parentElement; return e ? getComputedStyle(e).cursor : 'auto'; }, [X(x), Y(y)]); };
      const h3 = await R('const d = r.userDrawings.drawings.find((x) => x.type === "position"); return d.handlePoints(r.drawingProjector());');
      const cs = { width: await cur(h3[3][0], h3[3][1]), target: await cur(h3[2][0], h3[2][1]) };
      check(cs.width === 'ew-resize' && cs.target === 'ns-resize', 'resize cursors on the width and target handles', cs);
      // settings window: Inputs + Style
      await R('const d = r.userDrawings.drawings.find((x) => x.type === "position"); r.userDrawings.openSettings(d.id); r.userDrawings.popup.openPanel(); return 1;');
      await p.waitForTimeout(500);
      const tabs = await p.evaluate(() => [...document.querySelectorAll('.stk-dsp-tabs [role=tab]')].map((t) => t.textContent.trim()));
      check(tabs.join(',') === 'Inputs,Style,Coordinates,Visibility', 'settings tabs Inputs / Style / Coordinates / Visibility', tabs);
      const unitOpts = await p.evaluate(() => { const out = new Set(); for (const s of document.querySelectorAll('.vela-dsp-grid select, .vela-dsp-grid [role=listbox], .vela-dsp-grid option')) out.add(s.textContent.trim()); return [...out].join('|'); });
      check(/Ticks/.test(unitOpts) || /Ticks/.test(await p.evaluate(() => document.body.innerText)), 'stop / target can be typed in ticks', unitOpts.slice(0, 120));
      await p.screenshot({ path: `${OUT}/position-1440-inputs.png` });
      await p.evaluate(() => { const t = [...document.querySelectorAll('.stk-dsp-tabs [role=tab]')].find((x) => x.textContent.trim() === 'Style'); t && t.click(); });
      await p.waitForTimeout(300);
      const styleTxt = await p.evaluate(() => { const pane = [...document.querySelectorAll('[role=tabpanel]')].find((x) => !x.hidden && x.offsetParent); return pane ? pane.innerText : ''; });
      check(/Profit zone/.test(styleTxt) && /Stop zone/.test(styleTxt) && /Compact stats mode/.test(styleTxt) && /Show labels/.test(styleTxt), 'Style tab has zone colours, labels, compact stats', styleTxt.slice(0, 200));
      await p.screenshot({ path: `${OUT}/position-1440-style.png` });
      await p.keyboard.press('Escape');
      await p.waitForTimeout(200);
      // short position: target below
      await R('cell.chart.drawings.setTool("shortposition"); return 1;');
      const at2 = await R(`const n = r.bars.length; const bar = r.bars[n - 80]; const proj = r.drawingProjector(); const pid = r.scene.panes.keys().next().value; return { x: proj.xOf(bar.time), y: proj.yOf(bar.close, pid) };`);
      await p.mouse.click(X(at2.x), Y(at2.y)); await p.waitForTimeout(150); await p.mouse.click(X(at2.x + 2), Y(at2.y)); await p.waitForTimeout(400);
      const sh = await R('const d = r.userDrawings.drawings.find((x) => x.type === "shortposition"); return d ? d.anchors.map((q) => q.price) : null;');
      check(sh && sh[2] < sh[0] && sh[1] > sh[0], 'short position: target below, stop above', sh);
      await p.mouse.click(X(at2.x + 40), Y(at2.y + 10)); await p.waitForTimeout(300);
      await p.screenshot({ path: `${OUT}/position-1440-chart.png` });
    }
    check(errors.length === 0, vp.tag + ' no page errors', errors.slice(0, 4));
    await ctx.close();
  }
  await b.close();
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
