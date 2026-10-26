const R = require('./bt-rig.js');
(async () => {
  const srv = await R.serve(); const b = await R.launch();
  const { ctx, p, errors } = await R.page(b, srv, 'desktop');
  await R.startSession(p, srv.base, 'chart=tz'); await p.waitForTimeout(5000);
  console.log(JSON.stringify(await p.evaluate(async () => {
    const ws = window.STRYKER_VELA, c = ws.active, ch = c.chart; const o = {};
    const keys = (x) => { const r = []; for (let q = x; q && q !== Object.prototype; q = Object.getPrototypeOf(q)) r.push(...Object.getOwnPropertyNames(q)); return [...new Set(r)].filter((k) => !k.startsWith('_')); };
    o.cellKeys = keys(c).filter((k) => /ind|draw|layout|symbol|timeframe|hist|native/i.test(k));
    o.chartKeys = keys(ch).filter((k) => /ind|draw|native|screenshot|scroll|visible|range|fit/i.test(k));
    o.drawKeys = ch.drawings ? keys(ch.drawings) : null;
    o.wsKeys = keys(ws).filter((k) => /layout|screenshot|cell/i.test(k));
    try { const h = ch.addNativeIndicator('ema'); o.addNative = typeof h + ':' + (h && keys(h).slice(0, 25).join(',')); } catch (e) { o.addNative = 'err ' + e.message; }
    try { const d = ch.drawings.add('trendline', { paneId: 'price', anchors: [{ time: 1792108800000, price: 29950 }, { time: 1792109800000, price: 29960 }] }); o.addDraw = d && (d.id || typeof d); o.all = ch.drawings.all().map((x) => x.type); } catch (e) { o.addDraw = 'err ' + e.message; }
    for (const t of ['rect', 'rectangle', 'fibretracement', 'measure', 'pricerange', 'ray', 'hline']) { try { const d = ch.drawings.add(t, { paneId: 'price', anchors: [{ time: 1792108800000, price: 29950 }, { time: 1792109800000, price: 29960 }] }); o['t_' + t] = d ? 'ok' : 'null'; } catch (e) { o['t_' + t] = 'err'; } }
    try { o.inds = [...ch.renderer.renderer.scene.indicators.entries()].map(([k, v]) => k + ':' + (v.native && v.native.type) + ':' + Object.keys(v).join('|')); } catch (e) { o.inds = 'err ' + e.message; }
    try { o.layouts = ws.layout.id + ' ' + JSON.stringify(ws.layout.cells.length); } catch (e) {}
    return o;
  })));
  await b.close(); srv.close();
})();
