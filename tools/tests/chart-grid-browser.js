// Charts grid picker + Sync in layout (assets/chart-grid.js) against
// tools/tests/chart-dev-server.mjs. Needs network (Yahoo via the dev server, jsDelivr).
//   CHART_BASE=http://127.0.0.1:8046 node tools/tests/chart-grid-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8046';
const OUT = process.argv[2] || '/tmp';
const ONLY = process.env.ONLY || '';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const SHAPES = ['1', '2h', '2v', '3c', '3r', '3l', '4', '4c', '4r', '4l', '5a', '5l', '6', '6r', '8', '8r'];

async function open(b, { w, h, mobile, tablet }) {
  const ua = mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
    : tablet ? 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Tablet' : undefined;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!(mobile || tablet), userAgent: ua });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_CHART_UI && window.STRYKER_CHART_UI.grid, null, { timeout: 40000 });
  await p.waitForTimeout(2500);
  return { ctx, p, errors };
}
const settle = (p) => p.evaluate(async () => {
  const ws = window.STRYKER_VELA;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    if (ws.cells().every((c) => { try { return c.chart.orchestrator.rawBars.length > 0; } catch (e) { return false; } })) break;
  }
});

async function desktop(b, w, h) {
  const { ctx, p, errors } = await open(b, { w, h });
  const tag = 'd' + w;
  for (const id of SHAPES) {
    await p.click('#stkc-layout-btn');
    await p.click(`.stkg-ic[data-layout="${id}"]`);
    await settle(p);
    await p.waitForTimeout(600);
    const r = await p.evaluate(() => {
      const ws = window.STRYKER_VELA;
      const rects = ws.cells().map((c) => c.host.getBoundingClientRect()).map((r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]);
      return { id: ws.layout.id, n: ws.cells().length, rects, minW: Math.min(...rects.map((x) => x[2])), minH: Math.min(...rects.map((x) => x[3])), sw: document.documentElement.scrollWidth, btn: document.getElementById('stkc-layout-btn').textContent };
    });
    const want = { '1': 1, '2h': 2, '2v': 2, '3c': 3, '3r': 3, '3l': 3, '4': 4, '4c': 4, '4r': 4, '4l': 4, '5a': 5, '5l': 5, '6': 6, '6r': 6, '8': 8, '8r': 8 }[id];
    check(r.id === id && r.n === want && r.minW > 100 && r.minH > 60 && r.sw <= w + 1, `${tag} ${id}: ${r.n} cells, smallest ${r.minW}x${r.minH}, btn "${r.btn}"`);
    if (w === 1440 || ['3l', '4l', '5a', '5l', '6', '8', '8r'].includes(id)) await p.screenshot({ path: `${OUT}/grid-${w}-${id}.png` });
  }
  // Picker open (shows greyed 10-16) — screenshot
  await p.click('#stkc-layout-btn');
  await p.hover('.stkg-off');
  await p.waitForTimeout(300);
  const pk = await p.evaluate(() => ({ grey: [...document.querySelectorAll('.stkg-off')].map((e) => e.title), disabled: [...document.querySelectorAll('.stkg-ic[aria-disabled="true"]')].length, pressed: document.querySelector('.stkg-ic[aria-pressed="true"]').dataset.layout }));
  check(pk.grey.length === 4 && pk.grey.every((t) => t === 'Up to 8 charts on our site for smooth performance') && pk.disabled === 0, `${tag} picker: 4 greyed with tooltip, none disabled, pressed ${pk.pressed}`);
  await p.screenshot({ path: `${OUT}/picker-${w}.png` });
  await p.keyboard.press('Escape');
  check(errors.length === 0, `${tag} no page errors ${errors.slice(0, 3).join(' | ')}`);
  return { ctx, p };
}

async function syncTests(p) {
  // 4 charts, all switches on
  await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('4'));
  await settle(p);
  await p.click('#stkc-layout-btn');
  for (const k of ['symbol', 'timeframe', 'crosshair', 'viewport', 'dateRange']) {
    const on = await p.$eval(`input[data-sync="${k}"]`, (e) => e.checked);
    if (!on) await p.click(`input[data-sync="${k}"]`);
  }
  await p.screenshot({ path: `${OUT}/sync-panel-1440.png` });
  await p.keyboard.press('Escape');
  const st = await p.evaluate(() => window.STRYKER_CHART_UI.grid.syncState());
  check(st.symbol && st.timeframe && st.crosshair && st.viewport && st.dateRange, 'sync: all five on ' + JSON.stringify(st));
  // Interval: change active cell's tf -> all follow
  const tf = await p.evaluate(async () => {
    const ws = window.STRYKER_VELA; ws.setActiveCell(ws.cells()[0].id); ws.cells()[0].setTimeframe('5');
    await new Promise((r) => setTimeout(r, 1500)); return ws.cells().map((c) => c.timeframe);
  });
  check(tf.every((x) => x === '5'), 'sync Interval: ' + tf.join(','));
  // Symbol
  const sy = await p.evaluate(async () => {
    const ws = window.STRYKER_VELA; ws.cells()[0].setSymbol('futures:ES1!');
    await new Promise((r) => setTimeout(r, 1500)); return ws.cells().map((c) => c.symbol);
  });
  check(sy.every((x) => /ES1!/.test(x)), 'sync Symbol: ' + sy.join(','));
  // Turn symbol + interval off for independent cells, then date range
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.sync.set('symbol', false); ws.sync.set('timeframe', false); ws.sync.set('viewport', false); });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.cells()[1].setSymbol('futures:NQ1!'); ws.cells()[2].setSymbol('futures:GC1!'); await new Promise((r) => setTimeout(r, 300)); });
  await settle(p);
  // Click a range chip in the bottom bar (applies to the active cell; we fan out)
  const chip = await p.$('.vela-workspace [data-range="1M"], .vela-workspace button:has-text("1M")');
  let how = 'api';
  if (chip) { await chip.click(); how = 'chip'; } else await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.active.applyRange({ id: '1M', tf: '30', preset: '1M', bars: 1500 }); });
  await p.waitForTimeout(500);
  await settle(p);
  await p.waitForTimeout(2500);
  const dr = await p.evaluate(() => window.STRYKER_VELA.cells().map((c) => { const r = c.chart.getVisibleRange(); return { tf: c.timeframe, range: c.activeRangeId, days: r ? Math.round((r.to - r.from) / 864e5) : null }; }));
  check(dr.every((x) => x.tf === '30' && x.range === '1M'), `sync Date range (${how}): ` + JSON.stringify(dr));
  await p.screenshot({ path: `${OUT}/sync-daterange-1440.png` });
  // Date range OFF: only the active cell changes
  await p.evaluate(() => window.STRYKER_CHART_UI.grid.setDateRange(false));
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.setActiveCell(ws.cells()[0].id); ws.active.applyRange({ id: '7D', tf: '5', preset: '1W', bars: 2100 }); });
  await p.waitForTimeout(2500);
  const dr2 = await p.evaluate(() => window.STRYKER_VELA.cells().map((c) => c.timeframe + '/' + c.activeRangeId));
  check(dr2[0] === '5/7D' && dr2.slice(1).every((x) => x === '30/1M'), 'Date range off -> only active cell: ' + dr2.join(','));
  // Persist: dateRange rides state ext
  await p.evaluate(() => window.STRYKER_CHART_UI.grid.setDateRange(true));
  const ext = await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.context().stateDirty(); return ws.getState().ext; });
  check(ext && ext['stryker.grid'] && ext['stryker.grid'].dateRange === true, 'Date range persists in state.ext');
  // Time sync: pan cell 0 -> others follow
  await p.evaluate(() => window.STRYKER_VELA.sync.set('viewport', true));
  const tv = await p.evaluate(async () => {
    const ws = window.STRYKER_VELA; const c = ws.cells();
    const r = c[0].chart.getVisibleRange(); c[0].chart.setVisibleRange({ from: r.from - 3 * 864e5, to: r.to - 3 * 864e5 });
    await new Promise((x) => setTimeout(x, 800));
    return c.map((x) => { const v = x.chart.getVisibleRange(); return v ? Math.round(v.to / 6e4) : null; });
  });
  check(tv.every((x) => Math.abs(x - tv[0]) <= 60), 'sync Time: right edges ' + tv.join(','));
  // Crosshair: move over cell 0, others show a crosshair
  const cr = await p.evaluate(() => window.STRYKER_VELA.sync.state().crosshair);
  check(cr === true, 'Crosshair link on');
}

async function frameTime(p) {
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.sync.set('crosshair', true); window.STRYKER_CHART_UI.setLayout('8'); });
  await settle(p);
  await p.waitForTimeout(3000);
  const box = await p.evaluate(() => { const r = window.STRYKER_VELA.cells()[0].host.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  // rAF intervals + time spent in main-thread work per frame while the crosshair sweeps.
  await p.evaluate(() => {
    window.__ft = { d: [], busy: [] }; let last = performance.now();
    const loop = (t) => { window.__ft.d.push(t - last); last = t; if (window.__ft.d.length < 400) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  const t0 = Date.now();
  for (let i = 0; i < 160; i++) {
    await p.mouse.move(box.x + 20 + (i * 5) % (box.w - 40), box.y + box.h / 2 + 30 * Math.sin(i / 8));
    if (i % 40 === 39) await p.mouse.wheel(0, i % 80 ? -120 : 120);
  }
  const elapsed = Date.now() - t0;
  await p.waitForTimeout(500);
  const ft = await p.evaluate(() => { const d = window.__ft.d.slice(5); const avg = d.reduce((s, x) => s + x, 0) / d.length; const s = [...d].sort((a, b) => a - b); return { n: d.length, avg: +avg.toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) }; });
  check(ft.avg <= 20, `8-chart frame time at 1440 (crosshair sweep + zoom, ${elapsed} ms): avg ${ft.avg} ms, p95 ${ft.p95}, max ${ft.max}, n ${ft.n}`);
  await p.screenshot({ path: `${OUT}/grid-1440-8-crosshair.png` });
  return ft;
}

async function small(b, w, h, mobile, tablet) {
  const { ctx, p, errors } = await open(b, { w, h, mobile, tablet });
  const tag = mobile ? 'phone' + w : 'tablet' + w;
  const cap = await p.evaluate(() => {
    const ws = window.STRYKER_VELA; window.STRYKER_CHART_UI.setLayout('8');
    return { tried8: ws.layout.id, n: ws.cells().length };
  });
  await p.waitForTimeout(300);
  check(cap.n <= 4, `${tag}: 8 refused/capped -> ${cap.tried8} (${cap.n} cells)`);
  await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('4l'));
  await settle(p);
  await p.waitForTimeout(800);
  await p.click('#stkc-layout-btn');
  await p.waitForTimeout(300);
  const st = await p.evaluate(() => ({ dis: [...document.querySelectorAll('.stkg-ic[aria-disabled="true"]')].map((e) => e.dataset.layout), note: document.querySelector('.stkg-note').textContent, pop: (() => { const r = document.getElementById('stkc-layout-pop').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; })(), sw: document.documentElement.scrollWidth }));
  check(st.dis.join(',') === '5a,5l,6,6r,8,8r' && st.pop[0] >= 0 && st.pop[1] <= w && st.sw <= w + 1, `${tag}: 5+ disabled (${st.dis.join(',')}), note "${st.note}", pop ${st.pop}`);
  await p.screenshot({ path: `${OUT}/${tag}-picker.png` });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  const sw = await p.evaluate(() => ({ chips: document.querySelectorAll('.stkc-cell').length, max: window.STRYKER_VELA.maximizedCell, n: window.STRYKER_VELA.cells().length }));
  if (mobile) check(sw.chips === 4 && sw.max, `${tag}: one chart at a time, ${sw.chips} switcher chips, maximized ${sw.max}`);
  else check(sw.n === 4 && !sw.max, `${tag}: 1+3 grid shown (${sw.n} cells)`);
  await p.screenshot({ path: `${OUT}/${tag}-4l.png` });
  // An 8-chart layout loaded from a saved doc on this device: drops to 4, remembers 8
  const capd = await p.evaluate(async () => {
    const ws = window.STRYKER_VELA; const st = ws.getState(); st.layout = '8';
    ws.applyState(st); window.STRYKER_CHART_UI.refreshLayoutUi();
    await new Promise((r) => setTimeout(r, 300));
    // afterStructural runs the cap
    window.STRYKER_CHART_UI.grid.enforceCap();
    return { id: ws.layout.id, from: window.STRYKER_CHART_UI.grid.capFrom(), btn: document.getElementById('stkc-layout-btn').getAttribute('aria-label') };
  });
  check(capd.id === '4' && capd.from === '8', `${tag}: 8-chart doc -> ${capd.id}, capFrom ${capd.from}, ${capd.btn}`);
  check(errors.length === 0, `${tag} no page errors ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

(async () => {
  const b = await launch();
  try {
    if (!ONLY || ONLY.includes('d')) {
      const { ctx, p } = await desktop(b, 1440, 900);
      await syncTests(p);
      await frameTime(p);
      await ctx.close();
    }
    if (!ONLY || ONLY.includes('w')) { const r = await desktop(b, 1920, 1080); await r.ctx.close(); }
    if (!ONLY || ONLY.includes('t')) await small(b, 768, 1024, false, true);
    if (!ONLY || ONLY.includes('m')) await small(b, 390, 844, true, false);
  } catch (e) { fail++; console.log('FAIL exception', e.message); }
  await b.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
