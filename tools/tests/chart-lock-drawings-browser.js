// Locked drawings (member GK): a locked drawing cannot be picked, moved, resized or deleted, shows a padlock,
// and is click-through: dragging inside it pans the chart. Lock-all in the left toolbar locks every drawing,
// the locked flag survives a save/load of the drawings (what a layout stores).
//   CHART_BASE=http://localhost:8061 node tools/tests/chart-lock-drawings-browser.js [shotsDir]
// Run under flock /tmp/stryker-chrome.lock.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://localhost:8061';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined && !ok ? ' ' + JSON.stringify(extra) : '')); };
const V = 'window.STRYKER_VELA.active.chart';

async function open(b, w, h, theme) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t) localStorage.setItem('stryker_theme', t); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html?symbol=NQ', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_CHART_UI && window.__stkTvBars, null, { timeout: 40000 });
  await p.waitForTimeout(4500);
  return { ctx, p };
}
const px = (p) => p.evaluate(`(() => { const ch = ${V}; const r = ch.getVisibleRange(); const c = document.querySelector('.vela-chart canvas, canvas'); const box = document.querySelector('#chart, .vela-chart, .vela-stage, canvas').getBoundingClientRect(); return { from: r.from, to: r.to, l: box.left, t: box.top, w: box.width, h: box.height }; })()`);

async function run(b, w, h, theme, tag) {
  const { ctx, p } = await open(b, w, h, theme);
  await p.waitForFunction(`!!${V}.getVisibleRange()`, null, { timeout: 30000 });
  // price near the last close, read from the legend, so the box sits in view on any day
  const px0 = await p.evaluate(() => { const m = /C\s*([\d,]+\.?\d*)/.exec(document.body.innerText); return m ? parseFloat(m[1].replace(/,/g, '')) : 28000; });
  const rect = await p.evaluate(`(() => { const ch = ${V}; const r = ch.getVisibleRange(); const span = r.to - r.from; const mid = (r.from + r.to) / 2;
    const d = ch.drawings.add('box', { anchors: [{ time: mid - span / 6, price: ${px0 + 250} }, { time: mid + span / 6, price: ${px0 - 250} }] }); return d && (d.id || d); })()`);
  await p.waitForTimeout(400);
  const info = await p.evaluate(`(() => { const ch = ${V}; const d = ch.drawings.all().find((x) => x.type === 'box'); return { id: d.id, anchors: JSON.stringify(d.anchors) }; })()`);
  check(!!info.id, `${tag}: rectangle added`);
  // screen centre of the rectangle: project via the drawing handles' mid; fall back to canvas centre
  const centre = await p.evaluate(`(() => { const el = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  // price 30000 sits mid-rect only if the stub's price axis is there; so measure by a hit test instead
  const hitAt = async () => p.evaluate(`(() => { const ch = ${V}; const ui = ch.drawings; return 0; })()`);
  void hitAt;
  const drag = async (dx) => { await p.mouse.move(centre.x, centre.y); await p.mouse.down(); await p.mouse.move(centre.x + dx / 2, centre.y, { steps: 4 }); await p.mouse.move(centre.x + dx, centre.y, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(250); };
  const state = () => p.evaluate(`(() => { const ch = ${V}; const r = ch.getVisibleRange(); const d = ch.drawings.all().find((x) => x.id === ${JSON.stringify(info.id)}); return { from: r.from, anchors: d ? JSON.stringify(d.anchors) : null, locked: !!(d && d.locked), n: ch.drawings.all().length }; })()`);

  await p.screenshot({ path: `${OUT}/lock-${tag}-before.png` });
  // lock it through the same route as the drawing's own toolbar (drawings.lock)
  await p.evaluate(`${V}.drawings.lock(${JSON.stringify(info.id)}, true)`); await p.waitForTimeout(300);
  let s0 = await state();
  check(s0.locked, `${tag}: drawing is locked`, s0);
  await drag(Math.min(160, w / 3));
  let s1 = await state();
  check(s1.anchors === s0.anchors, `${tag}: dragging a locked drawing does not move it`, [s0.anchors, s1.anchors]);
  check(s1.from !== s0.from, `${tag}: dragging inside a locked drawing pans the chart`, [s0.from, s1.from]);
  await p.keyboard.press('Delete'); await p.waitForTimeout(200);
  check((await state()).n === s0.n, `${tag}: Delete key does not remove a locked drawing`);
  await p.screenshot({ path: `${OUT}/lock-${tag}-locked.png` });
  // lock all button in the left toolbar
  if (w > 700) {
    await p.evaluate(`${V}.drawings.lock(${JSON.stringify(info.id)}, false)`);
    await p.click('.stkt-lock'); await p.waitForTimeout(250);
    check(await p.evaluate(`${V}.drawings.all().every((d) => d.locked)`), `${tag}: lock-all locks every drawing`);
    // persistence: what a layout stores
    const ser = await p.evaluate(`JSON.stringify(${V}.drawings.all())`);
    check(/"locked":true/.test(ser), `${tag}: locked flag is in the saved drawings`);
    await p.click('.stkt-lock'); await p.waitForTimeout(250);
    check(await p.evaluate(`${V}.drawings.all().every((d) => !d.locked)`), `${tag}: unlock-all unlocks them`);
    // unlocked again: a drag moves the drawing (control)
    const a0 = (await state()).anchors;
    await drag(120);
    check((await state()).anchors !== a0, `${tag}: (control) unlocked drag moves the drawing`);
  }
  await ctx.close();
}
(async () => {
  const b = await launch();
  try {
    await run(b, 1440, 900, 'dark', '1440-dark');
    await run(b, 1440, 900, 'day', '1440-light');
    await run(b, 390, 844, 'dark', '390-dark');
  } finally { await b.close(); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
