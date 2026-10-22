// Drawing settings window (TradingView layout) on the Vela 0.9.0 admin trial.
//   CHART_BASE=http://127.0.0.1:PORT node tools/tests/chart-vela090-dsp-browser.js <shotsDir>
// Local dev server + stubbed Firebase; no live data needed beyond what the dev server serves.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };

async function open(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
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
  return { ctx, p, errors };
}
const R = (p, src, arg) => p.evaluate(([src, arg]) => { const ws = window.STRYKER_VELA; const cell = ws.cell(ws.active.id); const r = cell.chart.renderer.renderer; return (new Function('ws', 'cell', 'r', 'arg', src))(ws, cell, r, arg); }, [src, arg]);
const plotBox = (p) => p.evaluate(() => {
  const c = [...document.querySelectorAll('#vela-chart canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height };
});
const all = (p) => R(p, 'return r.userDrawings.drawings.map((d) => d.serialize());');
const dlg = '.vela-dialog.vela-dsp';
const tabs = (p) => p.$$eval(dlg + ' .stk-dsp-tabs > button', (bs) => bs.map((b) => b.textContent));
const tab = async (p, key) => { await p.click(`${dlg} .stk-dsp-tabs > button[data-tab=${key}]`); await p.waitForTimeout(150); };

(async () => {
  const b = await launch();
  let { ctx, p, errors } = await open(b, { w: 1440, h: 900 });
  await R(p, 'r.applyViewport({ barSpacing: 8, rightOffset: 10 }); return 1;');
  const box = await plotBox(p);
  const cx = box.x + box.w * 0.45, cy = box.y + box.h * 0.45;

  // draw a box (press-drag-release) and open its settings by double-click
  await R(p, 'cell.chart.drawings.setTool("box"); return 1;');
  await p.mouse.move(cx - 150, cy - 90); await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(cx - 150 + i * 30, cy - 90 + i * 18);
  await p.mouse.up(); await p.waitForTimeout(300);
  let ds = await all(p);
  const boxDoc = ds.find((d) => d.type === 'box');
  check(!!boxDoc, 'box drawn', ds.map((d) => d.type));
  check(boxDoc && boxDoc.text && boxDoc.text.size === '12', 'new box text defaults to 12 px', boxDoc && boxDoc.text);
  await p.mouse.dblclick(cx, cy - 90 + 1); await p.waitForTimeout(600);
  let shown = await p.$(dlg);
  check(!!shown, 'double-click on the box border opens the window');
  if (!shown) { await p.screenshot({ path: OUT + '/dsp-fail.png' }); }
  check(JSON.stringify(await tabs(p)) === JSON.stringify(['Style', 'Text', 'Coordinates', 'Visibility']), 'tabs Style | Text | Coordinates | Visibility', await tabs(p));
  const head = await p.evaluate((sel) => ({ title: document.querySelector(sel + ' .vela-dialog-title')?.textContent, pen: !!document.querySelector(sel + ' .stk-dsp-pen'), foot: [...document.querySelectorAll(sel + ' .vela-dialog-footer button')].map((x) => x.textContent.trim()) }), dlg);
  check(head.title === 'Rectangle' || head.title === 'Box' || /rect|box/i.test(head.title || ''), 'title is the tool name', head.title);
  check(head.pen, 'pencil next to the title');
  check(head.foot.join('|') === 'Template|Cancel|OK' || head.foot.join('|') === 'Template|Cancel|Ok', 'footer Template + Cancel + Ok', head.foot);

  // Style tab
  await tab(p, 'style');
  await p.screenshot({ path: OUT + '/dsp-1440-style.png' });
  const styleTexts = await p.$eval(dlg + ' .stk-dsp-pane[data-pane=style]', (e) => e.innerText);
  check(/Extend/.test(styleTexts) && /Border/.test(styleTexts) && /Middle line/.test(styleTexts) && /Background/.test(styleTexts), 'Style: Extend, Border, Middle line, Background', styleTexts.replace(/\n/g, ' | '));
  await p.selectOption(dlg + ' .stk-dsp-pane[data-pane=style] select', 'right');
  await p.click(dlg + ' .stk-dsp-pane[data-pane=style] label.stk-dsp-cb:has-text("Middle line") input');
  await p.click(dlg + ' .stk-dsp-pane[data-pane=style] label.stk-dsp-cb:has-text("Background") input');
  await p.waitForTimeout(200);
  let d = (await all(p)).find((x) => x.type === 'box');
  check(d.style.extendRight === true && !d.style.extendLeft, 'Extend right saved', d.style);
  check(d.style.midLine === true, 'Middle line on', d.style.midLine);
  check(!d.style.fillColor, 'Background unticked clears the fill', d.style.fillColor);
  await p.click(dlg + ' .stk-dsp-pane[data-pane=style] label.stk-dsp-cb:has-text("Background") input');
  await p.waitForTimeout(150);
  d = (await all(p)).find((x) => x.type === 'box');
  check(!!d.style.fillColor, 'Background ticked brings the fill back', d.style.fillColor);

  // Text tab
  await tab(p, 'text');
  await p.fill(dlg + ' .stk-dsp-text textarea', 'Supply zone\nweekly');
  const sels = await p.$$(dlg + ' .stk-dsp-pane[data-pane=text] select');
  check(sels.length === 3, 'Text: size + vertical + horizontal dropdowns', sels.length);
  await sels[0].selectOption('16');
  await sels[1].selectOption('top');
  await sels[2].selectOption('right');
  await p.click(dlg + ' .stk-dsp-pane[data-pane=text] .vela-dsp-chip:has-text("B")');
  await p.waitForTimeout(250);
  d = (await all(p)).find((x) => x.type === 'box');
  check(d.text.value === 'Supply zone\nweekly' && d.text.size === '16' && d.text.stkV === 'top' && d.text.stkH === 'right' && d.text.bold === true, 'Text saved (words, 16 px, top/right, bold)', d.text);
  const lay = await R(p, `const d = r.userDrawings.drawings.find((x) => x.type === 'box'); const pts = d.handlePoints(r.drawingProjector()); return { pts, w: r.coords.width };`);
  check(!!lay.pts, 'box geometry readable', lay);
  await p.screenshot({ path: OUT + '/dsp-1440-text.png' });

  // Coordinates tab: edit point A price
  await tab(p, 'coords');
  const inputs = await p.$$(dlg + ' .stk-dsp-pane[data-pane=coords] input');
  check(inputs.length === 2, 'Coordinates: two editable prices', inputs.length);
  const before = (await all(p)).find((x) => x.type === 'box').anchors[0].price;
  const target = Math.round(before) + 3;
  await inputs[0].fill(String(target)); await inputs[0].press('Tab'); await p.waitForTimeout(200);
  d = (await all(p)).find((x) => x.type === 'box');
  check(Math.abs(d.anchors[0].price - target) < 1e-6, 'point A price edited', [before, d.anchors[0].price]);
  await p.screenshot({ path: OUT + '/dsp-1440-coords.png' });

  // Visibility tab
  await tab(p, 'vis');
  const nBoxes = await p.$$eval(dlg + ' .stk-dsp-vis input', (x) => x.length);
  check(nBoxes === 9, 'Visibility: a box per timeframe band', nBoxes);
  await p.click(dlg + ' .stk-dsp-vis label[data-band="1"] input'); await p.waitForTimeout(150);
  d = (await all(p)).find((x) => x.type === 'box');
  check(Array.isArray(d.showOn) && !d.showOn.includes('1') && d.showOn.length === 8, 'unticking 1m hides it there only', d.showOn);
  await p.screenshot({ path: OUT + '/dsp-1440-vis.png' });

  // Ok keeps; reopen remembers last tab; Cancel reverts
  await p.click(dlg + ' .vela-dialog-footer button:has-text("Ok"), ' + dlg + ' .vela-dialog-footer button:has-text("OK")');
  await p.waitForTimeout(300);
  check(!(await p.$(dlg)), 'Ok closes the window');
  await p.screenshot({ path: OUT + '/dsp-1440-chart.png' });
  const kept = (await all(p)).find((x) => x.type === 'box');
  await p.mouse.dblclick(cx, cy - 90 + 1); await p.waitForTimeout(500);
  if (!(await p.$(dlg))) { const bb = await R(p, `const d = r.userDrawings.drawings.find((x) => x.type === 'box'); const pp = d.handlePoints(r.drawingProjector()); return pp;`); await p.mouse.dblclick(box.x + bb[0][0] + 20, box.y + bb[0][1]); await p.waitForTimeout(500); }
  const cur = await p.$eval(dlg + ' .stk-dsp-tabs > button[aria-selected=true]', (x) => x.textContent).catch(() => null);
  check(cur === 'Visibility', 'reopens on the last tab used', cur);
  await tab(p, 'text');
  await p.fill(dlg + ' .stk-dsp-text textarea', 'changed');
  await p.waitForTimeout(150);
  await p.click(dlg + ' .vela-dialog-footer button:has-text("Cancel")');
  await p.waitForTimeout(300);
  d = (await all(p)).find((x) => x.type === 'box');
  check(d.text.value === kept.text.value, 'Cancel puts the text back', [d.text.value, kept.text.value]);

  // Rename with the pencil
  await p.mouse.dblclick(cx, cy - 90 + 1); await p.waitForTimeout(500);
  if (await p.$(dlg)) {
    await p.click(dlg + ' .stk-dsp-pen');
    await p.fill(dlg + ' .stk-dsp-name', 'NY supply');
    await p.press(dlg + ' .stk-dsp-name', 'Enter');
    await p.waitForTimeout(150);
    const t = await p.$eval(dlg + ' .vela-dialog-title', (e) => e.textContent);
    check(t === 'NY supply', 'pencil renames the drawing', t);
    // Template menu opens
    await p.click(dlg + ' .vela-dsp-style'); await p.waitForTimeout(300);
    const menu = await p.evaluate(() => [...document.querySelectorAll('.vela-dsp-menu, [role=menu]')].filter((e) => e.offsetParent).map((e) => e.innerText.slice(0, 120)));
    check(menu.length > 0 && /Save/i.test(menu.join(' ')), 'Template menu opens with Save as style', menu);
    await p.screenshot({ path: OUT + '/dsp-1440-template.png' });
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    await p.click(dlg + ' .vela-dialog-footer button:has-text("Ok"), ' + dlg + ' .vela-dialog-footer button:has-text("OK")').catch(() => {});
    await p.waitForTimeout(200);
  } else check(false, 'reopen for rename');

  // trend line + horizontal line + fib: window opens with the right tabs
  for (const [tool, want] of [['trendline', ['Style', 'Text', 'Coordinates', 'Visibility']], ['hline', ['Style', 'Text', 'Coordinates', 'Visibility']], ['fibretracement', null]]) {
    await R(p, 'cell.chart.drawings.setTool(arg); return 1;', tool);
    const y0 = box.y + box.h * 0.75;
    await p.mouse.click(box.x + box.w * 0.15, y0); await p.waitForTimeout(150);
    if (tool !== 'hline') { await p.mouse.click(box.x + box.w * 0.3, y0 - 60); await p.waitForTimeout(250); }
    const id = await R(p, 'const a = r.userDrawings.drawings; return a[a.length - 1].id;');
    await R(p, 'r.userDrawings.openSettings(arg); return 1;', id).catch((e) => console.log('openSettings', String(e)));
    await p.waitForTimeout(500);
    const t = await tabs(p).catch(() => []);
    if (want) check(JSON.stringify(t) === JSON.stringify(want), tool + ' window tabs', t);
    else check(t.includes('Style') && t.includes('Coordinates') && t.includes('Visibility'), tool + ' window has Style/Coordinates/Visibility', t);
    if (tool === 'hline') {
      await tab(p, 'text');
      const n = await p.$$eval(dlg + ' .stk-dsp-pane[data-pane=text] select', (x) => x.length);
      check(n === 3, 'hline Text tab has size + alignment', n);
    }
    if (tool === 'fibretracement') await p.screenshot({ path: OUT + '/dsp-1440-fib.png' });
    await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  }

  // floating toolbar gear opens it too
  const trend = await R(p, 'const a = r.userDrawings.drawings.filter((d) => d.type === "trendline"); return a[a.length - 1].id;');
  await R(p, 'r.userDrawings.select ? r.userDrawings.select([arg]) : cell.chart.drawings.select([arg]); return 1;', trend).catch(() => {});
  await p.waitForTimeout(400);
  const gear = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((x) => x.offsetParent && /setting/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.title || '')) && x.closest('[class*=toolbar], [class*=dtb], [class*=floating]'));
    const g = btns[0]; if (!g) return null; const r = g.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, cls: g.closest('[class]').className };
  });
  if (gear) { await p.mouse.click(gear.x, gear.y); await p.waitForTimeout(500); }
  check(!!gear && !!(await p.$(dlg)), 'floating toolbar gear opens the window', gear);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  check(errors.length === 0, 'no page errors 1440', errors.slice(0, 4));
  await ctx.close();

  // phone
  ({ ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true }));
  await R(p, `const a = r.userDrawings.store; return 1;`);
  const id = await R(p, `
    const v = r.coords; const L = v.barCount - 20; const bar = r.bars[L]; const bar2 = r.bars[L + 8];
    cell.chart.drawings.add ? 0 : 0;
    const t1 = bar.time, t2 = bar2.time;
    const doc = { type: 'box', anchors: [{ time: t1, price: bar.high }, { time: t2, price: bar2.low }] };
    const res = cell.chart.drawings.add ? cell.chart.drawings.add(doc) : null;
    const all = r.userDrawings.drawings; return all.length ? all[all.length - 1].id : res;`).catch((e) => String(e));
  await R(p, 'r.userDrawings.openSettings(arg); return 1;', id).catch((e) => console.log('phone open', String(e)));
  await p.waitForTimeout(600);
  const fits = await p.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth, t: r.top, b: r.bottom, h: innerHeight }; }, dlg);
  check(!!fits && fits.l >= 0 && fits.r <= fits.w && fits.b <= fits.h, 'phone: window fits the screen', fits);
  await p.screenshot({ path: OUT + '/dsp-390-style.png' });
  if (fits) { await tab(p, 'text'); await p.screenshot({ path: OUT + '/dsp-390-text.png' }); }
  check(errors.length === 0, 'no page errors 390', errors.slice(0, 4));
  await ctx.close();
  await b.close();
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
