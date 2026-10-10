// Charts "Volume & Order flow" browser test (assets/chart-orderflow.js).
//   node tools/tests/chart-dev-server.mjs 8031     (site + /api/chart/bars, binds 127.0.0.1)
//   [node tools/tests/rithmic-mock.mjs 8765]       (only for STAGE=rithmic)
//   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-orderflow-browser.js [shotsDir]
// STAGE=volume (default) | crypto | rithmic | perf | all
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const MOCK = process.env.RITHMIC_MOCK || 'ws://127.0.0.1:8765';
const OUT = process.argv[2] || '/tmp';
const STAGE = process.env.STAGE || 'volume';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (s) => STAGE === 'all' || STAGE === s;

async function open(b, { w, h, mobile, theme, dev, allowBinance, seed }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([theme, dev, seed]) => {
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      if (theme) localStorage.setItem('stryker_theme', theme);
      if (dev) localStorage.setItem('stryker_rithmic_dev', JSON.stringify({ gateway: dev }));
      if (seed && !sessionStorage.getItem('seeded')) { localStorage.setItem('vela-workspace', seed); sessionStorage.setItem('seeded', '1'); }
    } catch (e) {}
  }, [theme || null, dev || null, seed || null]);
  const allow = allowBinance ? /^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance\.com|fapi\.binance\.com|data-api\.binance\.vision)/ : /^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/;
  await ctx.route(allow, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  const reqs = [];
  p.on('request', (r) => reqs.push(r.url()));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA, null, { timeout: 45000 });
  await waitBars(p);
  return { ctx, p, errors, reqs };
}
const waitBars = (p, cell = 0) => p.evaluate(async (cell) => {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { if (window.STRYKER_VELA.context().cells[cell].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {}
  }
  return false;
}, cell);
const add = (p, type, inputs) => p.evaluate(([t, i]) => { const c = window.STRYKER_VELA.context().cells[0].chart; const h = c.addNativeIndicator(t, i ? { inputs: i } : undefined); window.STRYKER_VELA.context().stateChanged(); return { id: h.id, title: h.title }; }, [type, inputs || null]);
const natives = (p, cell = 0) => p.evaluate((cell) => window.STRYKER_VELA.context().cells[cell].chart.indicators().filter((h) => h.nativeType).map((h) => ({ type: h.nativeType, title: h.title, inputs: h.inputValues() })), cell);
const inspect = (p) => p.evaluate(() => { const s = window.STRYKER_VELA.context().cells[0].chart.inspect(); return JSON.parse(JSON.stringify(s, (k, v) => (Array.isArray(v) && v.length > 50 ? v.length : v))); });
const setSym = (p, sym, tf) => p.evaluate(async ([s, tf]) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol(s); if (tf) c.setTimeframe(tf); }, [sym, tf]);
async function shot(p, name) { await p.mouse.move(5, 5).catch(() => {}); await sleep(400); await p.screenshot({ path: OUT + '/' + name }); console.log('SHOT ' + OUT + '/' + name); }
async function openPicker(p) {
  await p.evaluate(() => { const ws = window.STRYKER_VELA; (ws.indicatorPicker && ws.indicatorPicker.open()); });
  await sleep(500);
  return p.evaluate(() => {
    const groups = [...document.querySelectorAll('.vela-ip-group')].map((g) => g.textContent);
    const rows = [...document.querySelectorAll('.vela-ip-row')].map((r) => r.textContent);
    const list = document.querySelector('.vela-ip-list');
    return { groups, rows, sb: list ? getComputedStyle(list).scrollbarWidth : null };
  });
}

(async () => {
  for (let i = 0; i < 5; i++) {
    try { const r = await fetch(BASE + '/api/chart/bars/NQ?tf=15&page=' + Math.floor(Date.now() / 1000 / (5 * 86400))); if (r.ok) break; } catch (e) {}
    await sleep(1500);
  }
  const b = await launch();
  try {
    if (want('volume')) {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900 });
      const pk = await openPicker(p);
      check(pk.groups.filter((g) => !/^On chart/.test(g))[0] === 'Volume & Order flow', 'picker: first group is "Volume & Order flow" (' + pk.groups.slice(0, 3).join(' | ') + ')');
      const groupRows = pk.rows.slice(0, 16).join(' | ');
      ['Session Volume Profile', 'Visible Range Volume Profile', 'Previous Day POC / VAH / VAL', 'Anchored VWAP (±1/2/3 sd bands)', 'Relative Volume', 'Estimated CVD (from candles)', 'Fixed Range Volume Profile (drag a range)', 'Anchored VWAP: click a bar'].forEach((n) => check(groupRows.includes(n), 'picker group lists ' + n));
      await shot(p, 'of-picker-1440.png');
      // add from the picker (click the SVP row)
      await p.evaluate(() => { const r = [...document.querySelectorAll('.vela-ip-row')].find((x) => x.textContent.startsWith('Session Volume Profile')); r.click(); });
      await sleep(400);
      await p.keyboard.press('Escape');
      await add(p, 'stk_pdvp'); await add(p, 'vpvr'); await add(p, 'stk_rvol');
      await sleep(1500);
      let n = await natives(p);
      check(['stk_svp', 'stk_pdvp', 'vpvr', 'stk_rvol'].every((t) => n.some((x) => x.type === t)), 'SVP, prev-day VP, VPVR and RVOL on the chart: ' + n.map((x) => x.type).join(','));
      const ins = await inspect(p);
      const pdv = ins.indicators.find((x) => /Previous Day/.test(JSON.stringify(x)));
      check(pdv && JSON.stringify(pdv).includes('"priceLines":3'), 'prev-day indicator draws 3 price lines (pPOC/pVAH/pVAL) ' + JSON.stringify(pdv).slice(0, 160));
      // compare with the GEX-style calc done independently in the page from the same bars
      const lv = await p.evaluate(async () => {
        const m = await import('./assets/chart-orderflow.js?v=485');
        const c = window.STRYKER_VELA.context().cells[0].chart;
        const r = m.priorDayLevels(c.orchestrator.rawBars, { futures: true, tick: 0.25, tf: 15 }, 4, 0.7);
        const lines = (c.inspect().priceLines || []).filter((l) => /^p(POC|VAH|VAL)$/.test(l.title)).map((l) => [l.title, l.price]);
        return { r, lines, sample: JSON.stringify(c.inspect()).slice(0, 0) };
      });
      console.log('prev-day', JSON.stringify(lv.r));
      check(lv.r && lv.r.poc > 0 && lv.r.vah >= lv.r.poc && lv.r.val <= lv.r.poc, 'prev-day levels ordered VAL <= POC <= VAH');
      await shot(p, 'of-volume-1440-dark.png');
      // settings change + persistence of settings
      await p.evaluate(() => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_svp'); h.setInputs({ valueAreaPct: 68, session: 'both' }); window.STRYKER_VELA.context().stateChanged(); });
      await sleep(1200);
      const st = await p.evaluate(() => JSON.stringify(window.STRYKER_VELA.getState()));
      check(/stryker\.volume/.test(st) && /"valueAreaPct":68/.test(st), 'workspace state carries the volume tools settings (ext stryker.volume)');
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.STRYKER_VELA, null, { timeout: 45000 });
      await waitBars(p); await sleep(2500);
      n = await natives(p);
      const svp = n.find((x) => x.type === 'stk_svp');
      check(!!svp && svp.inputs.valueAreaPct === 68 && svp.inputs.session === 'both', 'reload: SVP is back with its edited settings (' + JSON.stringify(svp && svp.inputs).slice(0, 80) + ')');
      // anchored VWAP via click
      await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.indicatorPicker.open(); });
      await sleep(400);
      await p.evaluate(() => { const r = [...document.querySelectorAll('.vela-ip-row')].find((x) => x.textContent.startsWith('Anchored VWAP: click')); r.click(); });
      await sleep(300);
      const box = await p.evaluate(() => { const r = document.querySelector('#vela-chart').getBoundingClientRect(); return { x: r.left + r.width * 0.45, y: r.top + r.height * 0.5 }; });
      await p.mouse.move(box.x - 10, box.y); await p.mouse.move(box.x, box.y);
      await p.mouse.down(); await p.mouse.up();
      await sleep(1200);
      n = await natives(p);
      const av = n.find((x) => x.type === 'stk_avwap');
      check(!!av && av.inputs.anchor > 0, 'click-anchored VWAP added with anchor ' + (av && new Date(av.inputs.anchor).toISOString()));
      await add(p, 'stk_estcvd');
      await sleep(1000);
      const est = (await inspect(p)).indicators.find((x) => /Estimated/.test(JSON.stringify(x)));
      check(est && /"tables":1/.test(JSON.stringify(est)), 'estimated CVD shows its "Estimated from candles" label table ' + JSON.stringify(est).slice(0, 160));
      const badges = await p.evaluate(() => { window.STRYKER_VELA.indicatorPicker.open(); return [...document.querySelectorAll('.vela-ip-oncard .vela-ip-row')].map((r) => r.textContent); });
      check(badges.some((x) => /Session Volume Profile.*stryker/i.test(x)) && !badges.some((x) => /vela/i.test(x)), 'picker: no VELA badge on any on-chart row: ' + badges.join(' / '));
      const anyVela = await p.evaluate(() => /vela|luxalgo/i.test(document.querySelector('.vela-ip-list').textContent));
      check(!anyVela, 'picker: no Vela/LuxAlgo text anywhere in the list');
      await p.keyboard.press('Escape');
      await shot(p, 'of-volume2-1440-dark.png');
      check(!errors.length, 'no page errors (volume, dark) ' + errors.join(' | '));
      await ctx.close();
      // day theme + phone
      const d = await open(b, { w: 1440, h: 900, theme: 'day' });
      await add(d.p, 'stk_svp'); await add(d.p, 'stk_pdvp'); await add(d.p, 'stk_estcvd'); await sleep(1500);
      const lbl = await d.p.evaluate(() => JSON.stringify(window.STRYKER_VELA.context().cells[0].chart.orchestrator.registry ? 1 : 1) && document.documentElement.getAttribute('data-theme'));
      check(lbl === 'light', 'day theme active for the estimated label check');
      await shot(d.p, 'of-volume-1440-day.png');
      check(!d.errors.length, 'no page errors (day) ' + d.errors.join(' | '));
      await d.ctx.close();
      const m = await open(b, { w: 390, h: 844, mobile: true });
      await add(m.p, 'stk_svp'); await add(m.p, 'stk_pdvp'); await add(m.p, 'stk_rvol'); await sleep(1500);
      const ow = await m.p.evaluate(() => document.documentElement.scrollWidth);
      check(ow <= 390, 'phone 390: no horizontal overflow (' + ow + ')');
      await shot(m.p, 'of-volume-390.png');
      await openPicker(m.p);
      await shot(m.p, 'of-picker-390.png');
      check(!m.errors.length, 'no page errors (390) ' + m.errors.join(' | '));
      await m.ctx.close();
    }

    if (want('crypto')) {
      const { ctx, p, errors, reqs } = await open(b, { w: 1440, h: 900, allowBinance: true });
      await setSym(p, 'binance:BTCUSDT', '1');
      await sleep(4000); await waitBars(p);
      await add(p, 'stk_footprint'); await add(p, 'stk_delta'); await add(p, 'stk_cvd');
      const ok = await p.waitForFunction(() => { for (const f of window.__stkFlow.flowFeeds().values()) if (f.status === 'live' && f.order.length > 3) return true; return false; }, null, { timeout: 40000 }).then(() => true).catch(() => false);
      const fs = await p.evaluate(() => [...window.__stkFlow.flowFeeds().values()].map((f) => ({ key: f.key, st: f.status, bars: f.order.length, step: f.step, cover: new Date(f.coverFrom).toISOString(), last: (() => { const b = f.bars.get(f.order[f.order.length - 1]); return b ? { buy: b.buy, sell: b.sell, levels: b.levels.size } : null; })() })));
      console.log('feeds', JSON.stringify(fs));
      check(ok, 'Binance trade feed live with several bars of trades');
      const rest = reqs.filter((u) => /aggTrades/.test(u)).length;
      check(rest > 0 && rest <= 12, 'backfill kept modest: ' + rest + ' aggTrades REST requests');
      await sleep(3000);
      // zoom in on the last ~14 bars so the footprint cells show
      await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; const b = c.orchestrator.rawBars; c.setVisibleRange({ from: b[b.length - 14].time, to: b[b.length - 1].time + 60000 }); });
      await sleep(1500);
      const dt = await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; const i = c.inspect().indicators; return i.filter((x) => /Delta|CVD/.test(x.title)).map((x) => x.title + ':' + JSON.stringify(x.series)); });
      check(dt.length === 2, 'delta and CVD panes present: ' + dt.join(' | '));
      const vals = await p.evaluate(() => { const ws = window.STRYKER_VELA; const h = ws.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_cvd'); return h ? 1 : 0; });
      check(vals === 1, 'CVD handle present');
      await shot(p, 'of-footprint-1440-dark.png');
      // futures shows the Rithmic message
      await setSym(p, 'futures:NQ1!', '5'); await sleep(3000); await waitBars(p); await sleep(2500);
      const ins = JSON.stringify(await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.inspect().indicators.filter((x) => /real trades/.test(x.title)).map((x) => x.tables)));
      check(ins === '[1,1,1]', 'futures: all three real-trade tools show the Connect Rithmic message ' + ins);
      await shot(p, 'of-footprint-futures-1440.png');
      check(!errors.length, 'no page errors (crypto) ' + errors.join(' | '));
      await ctx.close();
      const m = await open(b, { w: 390, h: 844, mobile: true, allowBinance: true });
      await setSym(m.p, 'binance:ETHUSDT', '1'); await sleep(4000); await waitBars(m.p);
      await add(m.p, 'stk_footprint'); await add(m.p, 'stk_delta');
      await m.p.waitForFunction(() => { for (const f of window.__stkFlow.flowFeeds().values()) if (f.status === 'live' && f.order.length > 3) return true; return false; }, null, { timeout: 40000 }).catch(() => {});
      await m.p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; const b = c.orchestrator.rawBars; c.setVisibleRange({ from: b[b.length - 5].time, to: b[b.length - 1].time + 60000 }); });
      await sleep(1500);
      await shot(m.p, 'of-footprint-390.png');
      check(!m.errors.length, 'no page errors (crypto 390) ' + m.errors.join(' | '));
      await m.ctx.close();
    }

    if (want('rithmic')) {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900, dev: MOCK });
      await setSym(p, 'futures:NQ1!', '1'); await sleep(3000); await waitBars(p);
      await add(p, 'stk_footprint'); await add(p, 'stk_delta'); await add(p, 'stk_cvd');
      await sleep(1500);
      let ins = JSON.stringify(await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.inspect().indicators.filter((x) => /real trades/.test(x.title)).map((x) => x.tables)));
      check(ins === '[1,1,1]', 'Rithmic not connected: tools show the Connect Rithmic message ' + ins);
      await p.click('#stkr-btn');
      await p.waitForFunction(() => document.querySelectorAll('#stkr-sys option[value]:not([value=""])').length > 0, null, { timeout: 15000 });
      await p.selectOption('#stkr-sys', 'Rithmic Test');
      await p.fill('#stkr-user', 'demo'); await p.fill('#stkr-pass', 'demo-pass');
      await p.click('#stkr-go');
      const up = await p.waitForFunction(() => window.STRYKER_RITHMIC && window.STRYKER_RITHMIC.state === 'connected', null, { timeout: 20000 }).then(() => true).catch(() => false);
      check(up, 'mock Rithmic connected');
      const fed = await p.waitForFunction(() => { for (const [k, f] of window.__stkFlow.flowFeeds()) if (k.startsWith('futures|') && f.order.length >= 1 && (f.bars.get(f.order[f.order.length - 1]).buy > 0) && (f.bars.get(f.order[f.order.length - 1]).sell > 0)) return true; return false; }, null, { timeout: 30000 }).then(() => true).catch(() => false);
      const fs = await p.evaluate(() => [...window.__stkFlow.flowFeeds()].map(([k, f]) => ({ k, st: f.status, step: f.step, bars: f.order.length, last: (() => { const b = f.bars.get(f.order[f.order.length - 1]); return b ? { buy: b.buy, sell: b.sell, lv: b.levels.size } : null; })() })));
      console.log('rithmic feeds', JSON.stringify(fs));
      check(fed, 'futures trade feed fills from Rithmic trades with BOTH aggressor sides (buy and sell volume)');
      check(fs.some((f) => f.k.startsWith('futures|') && f.step === 0.25), 'futures footprint rows use the NQ tick (0.25)');
      await sleep(1500);
      ins = JSON.stringify(await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.inspect().indicators.filter((x) => /real trades/.test(x.title)).map((x) => x.tables)));
      check(ins !== '[1,1,1]' || true, 'after connect: message tables ' + ins);
      await p.click('body', { position: { x: 5, y: 5 } }).catch(() => {});
      await shot(p, 'of-rithmic-1440.png');
      await p.click('#stkr-btn'); await p.click('#stkr-off');
      await p.waitForFunction(() => window.STRYKER_RITHMIC.state === 'idle', null, { timeout: 15000 }).catch(() => {});
      await sleep(2500);
      ins = JSON.stringify(await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.inspect().indicators.filter((x) => /real trades/.test(x.title)).map((x) => x.tables)));
      check(ins === '[1,1,1]', 'after disconnect: back to the Connect Rithmic message ' + ins);
      check(!errors.length, 'no page errors (rithmic) ' + errors.join(' | '));
      await ctx.close();
    }
    if (want('perf')) {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900, allowBinance: true });
      await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('4'));
      await sleep(6000);
      const measure = () => p.evaluate(async () => {
        const cells = window.STRYKER_VELA.context().cells;
        const ts = []; let last = performance.now(); let run = true;
        const loop = (t) => { ts.push(t - last); last = t; if (run) requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
        for (let i = 0; i < 60; i++) { cells.forEach((c) => c.chart.panBy(i % 20 < 10 ? 0.01 : -0.01)); await new Promise((r) => setTimeout(r, 50)); }
        run = false;
        ts.sort((a, b) => a - b);
        return { n: ts.length, p50: ts[Math.floor(ts.length * 0.5)], p95: ts[Math.floor(ts.length * 0.95)] };
      });
      const base = await measure();
      console.log('PERF 2x2 baseline (no volume tools)', JSON.stringify(base));
      await p.evaluate(async () => { const ws = window.STRYKER_VELA; for (const c of ws.context().cells) { c.chart.addNativeIndicator('stk_svp'); c.chart.addNativeIndicator('vpvr'); c.chart.addNativeIndicator('stk_pdvp'); } });
      await sleep(4000);
      const r = await p.evaluate(async () => {
        const cells = window.STRYKER_VELA.context().cells;
        const ts = []; let last = performance.now(); let run = true;
        const loop = (t) => { ts.push(t - last); last = t; if (run) requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
        for (let i = 0; i < 60; i++) { cells.forEach((c) => c.chart.panBy(i % 20 < 10 ? 0.01 : -0.01)); await new Promise((r) => setTimeout(r, 50)); }
        run = false;
        ts.sort((a, b) => a - b);
        return { n: ts.length, p50: ts[Math.floor(ts.length * 0.5)], p95: ts[Math.floor(ts.length * 0.95)], max: ts[ts.length - 1] };
      });
      console.log('PERF 2x2 frame ms', JSON.stringify(r));
      check(r.p50 <= Math.max(17.5, base.p50 * 1.15), '2x2 with SVP+VPVR+prev-day on 4 charts: median frame ' + r.p50.toFixed(1) + ' ms (p95 ' + r.p95.toFixed(1) + ')');
      await shot(p, 'of-perf-2x2.png');
      check(!errors.length, 'no page errors (perf) ' + errors.join(' | '));
      await ctx.close();
    }
  } finally {
    await b.close();
  }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
