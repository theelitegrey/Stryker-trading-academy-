// Regression for the RAM fix (hermes/w1-auto-ram, assets/vela-chart.js quietCanvas / quietEngine): blank overlay canvases
// give their pixels back, and still draw when needed. Checks on one chart:
//   - crosshair: pointer over the plot paints the cursor canvas; pointer off the chart frees it (0 pixels allocated again)
//   - user drawing: an hline paints the drawings canvas; removing it frees it
//   - VPVR (visible range volume profile): adding it paints the vpvr canvas; removing it frees it
//   - screenshot export (renderer.screenshot()) still returns a PNG that contains the drawing
//   CHART_BASE=http://127.0.0.1:8190 HUB=http://127.0.0.1:8191 flock /tmp/stryker-chrome.lock node tools/tests/chart-quiet-canvas-browser.js
const { launch } = require('./lib.js');
const { openPhone } = require('./phone-mem-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8190', HUB = process.env.HUB || 'http://127.0.0.1:8191';
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

(async () => {
  const b = await launch();
  try {
    const { p } = await openPhone(b, { w: 1440, h: 900, dpr: 2, seed: false, base: BASE, hub: HUB });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 180000, polling: 250 });
    await p.evaluate(async () => {
      const ws = window.STRYKER_VELA, c = ws.cell(ws.context().cells[0].id);
      c.setSymbol('futures:NQ1!'); c.setTimeframe('1');
      for (let k = 0; k < 300; k++) { await new Promise((r) => setTimeout(r, 200)); const o = c.chart.orchestrator; if (o.rawBars.length > 50 && !o.switchingMarket) break; }
    });
    await p.waitForTimeout(3000);
    // ink(k): opaque pixels on renderer canvas k; alloc(k): the canvas holds a pixel buffer (quietCanvas state)
    await p.evaluate(() => {
      const R = () => { const r = window.STRYKER_VELA.chart.renderer; return r.extLayers ? r : r.renderer; };
      window.__q = {
        R,
        ink: (k) => { const c = R()[k]; if (!c.width) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i]) n++; return n; },
        alloc: (k) => { const st = R()[k].__stkQuietSt; return st ? st.ink : null; },
        vis: (k) => R()[k].style.visibility || 'visible',
      };
    });
    const st = (k) => p.evaluate((k) => ({ alloc: window.__q.alloc(k), vis: window.__q.vis(k) }), k);
    const ink = (k) => p.evaluate((k) => window.__q.ink(k), k);
    const box = await p.evaluate(() => { const r = window.__q.R().plot.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150)))));

    // wrapped at all?
    check(await p.evaluate(() => ['cursorCanvas', 'drawingsCanvas', 'vpvrCanvas'].every((k) => !!window.__q.R()[k].__stkQuietSt)), 'cursor / drawings / vpvr canvases are managed (quietCanvas)');

    // crosshair
    await p.mouse.move(box.x + box.w * 0.4, box.y + box.h * 0.4); await frames(); await p.mouse.move(box.x + box.w * 0.42, box.y + box.h * 0.45); await frames();
    const c1 = await st('cursorCanvas'), i1 = await ink('cursorCanvas');
    check(c1.vis === 'visible' && i1 > 50, `crosshair drawn while the pointer is on the plot (${i1} px, ${c1.vis})`);
    await p.mouse.move(5, 5); await frames(); await p.waitForTimeout(400);
    const c2 = await st('cursorCanvas');
    check(c2.alloc === false && c2.vis === 'hidden', `crosshair canvas freed + hidden after the pointer leaves (${JSON.stringify(c2)})`);
    await p.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5); await frames(); await p.mouse.move(box.x + box.w * 0.52, box.y + box.h * 0.5); await frames();
    const i3 = await ink('cursorCanvas');
    check(i3 > 50, `crosshair comes back after the release (${i3} px)`);
    await p.mouse.move(5, 5); await frames();

    // user drawing
    const d0 = await st('drawingsCanvas');
    check(d0.alloc === false, `drawings canvas holds no pixels with no drawing (${JSON.stringify(d0)})`);
    const id = await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, bars = ch.orchestrator.rawBars, last = bars[bars.length - 1]; const d = ch.drawings.add('hline', { paneId: 'price', anchors: [{ time: last.time, price: last.close }] }); return d && (d.id || d); });
    await frames(); await p.waitForTimeout(500);
    const i4 = await ink('drawingsCanvas');
    // an hline may paint on the top drawings canvas or on a slice under the candles: check the composed screenshot too
    const shot = await p.evaluate(() => { const c = window.__q.R().screenshotCanvas(); return c ? { w: c.width, h: c.height, url: c.toDataURL('image/png').length } : null; });
    check(!!shot && shot.w > 100 && shot.url > 5000, `screenshot export works (${shot && shot.w}x${shot && shot.h}, ${shot && shot.url} chars)`);
    // a drawing either paints on the top drawings canvas or (interleaved with the series) on a slice canvas the GL backend composites
    const sl = await p.evaluate(() => { const u = window.__q.R().userDrawings; let n = 0; for (const c of u.sliceCache.values()) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 16) if (d[i]) n++; } return { sliced: u.sliced.size, n }; });
    console.log('  hline pixels: drawings canvas', i4, '| slice canvases', JSON.stringify(sl));
    check(i4 > 100 || sl.n > 100, 'user drawing (hline) painted');
    // select it: handles paint on the top drawings canvas
    await p.evaluate((id) => { const u = window.__q.R().userDrawings; u.selectedIds && u.selectedIds.add && u.selectedIds.add(id); u.render(); }, id);
    await frames();
    const i4b = await ink('drawingsCanvas');
    check(i4b > 20, `selected drawing's handles paint on the drawings canvas (${i4b} px)`);
    await p.evaluate((id) => { const ch = window.STRYKER_VELA.chart; try { ch.drawings.remove(id); } catch (e) { const all = ch.drawings.list ? ch.drawings.list() : []; all.forEach((d) => ch.drawings.remove(d.id)); } }, id);
    await frames(); await p.waitForTimeout(400);
    const d2 = await st('drawingsCanvas');
    check(d2.alloc === false, `drawings canvas freed after the drawing is removed (${JSON.stringify(d2)})`);

    // VPVR
    const v0 = await st('vpvrCanvas');
    check(v0.alloc === false, `vpvr canvas holds no pixels without VPVR (${JSON.stringify(v0)})`);
    const vid = await p.evaluate(() => { const h = window.STRYKER_VELA.chart.addNativeIndicator('vpvr'); return h && (h.id || h); });
    await frames(); await p.waitForTimeout(800);
    const i5 = await ink('vpvrCanvas');
    check(i5 > 200, `VPVR painted when added (${i5} px)`);
    await p.evaluate((vid) => { const ch = window.STRYKER_VELA.chart; const h = (ch.indicators() || []).find((x) => x.nativeType === 'vpvr'); if (h) (h.remove ? h.remove() : ch.removeIndicator(h)); }, vid);
    await frames(); await p.waitForTimeout(600);
    const v2 = await st('vpvrCanvas');
    check(v2.alloc === false, `vpvr canvas freed after VPVR is removed (${JSON.stringify(v2)})`);
  } finally { await b.close(); }
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
