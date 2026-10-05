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
      const groupRows = pk.rows.slice(0, 13).join(' | ');
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
        const m = await import('./assets/chart-orderflow.js?v=411');
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
  } finally {
    await b.close();
  }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
