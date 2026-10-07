// Charts "Stryker GEX Levels" browser test (assets/chart-gex-levels.js).
//   node tools/tests/chart-dev-server.mjs 8031     (site + /api/chart/bars, binds 127.0.0.1)
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-gex-indicator-browser.js [shotsDir]
// /api/gex/levels/* is answered from tools/tests/fixtures/gex/*.json (real API responses,
// saved 2026-10-07), so the expected numbers are known. Firebase is stubbed (richstub.js, an
// Elite member); the Free case forces window.strykerPlanTier to report a Free plan.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const FIX = path.join(__dirname, 'fixtures', 'gex');
const SPX = JSON.parse(fs.readFileSync(path.join(FIX, 'SPX-0.json')));
const QQQ = JSON.parse(fs.readFileSync(path.join(FIX, 'QQQ-0.json')));
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (v) => Math.round(v * 100) / 100;

async function open(b, { w, h, mobile, free }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((free) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
    if (free) Object.defineProperty(window, 'strykerPlanTier', { configurable: false, get: () => () => Promise.resolve({ free: true }), set() {} });
  }, !!free);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const gexHits = [];
  await ctx.route(/\/api\/gex\/levels\//, (r) => {
    const u = new URL(r.request().url()); gexHits.push(u.pathname + u.search);
    const name = u.pathname.split('/').pop().toUpperCase();
    const body = name === 'SPX' ? SPX : name === 'QQQ' ? QQQ : null;
    if (!body) return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"unknown market"}' });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA, null, { timeout: 45000 });
  await waitBars(p);
  return { ctx, p, errors, gexHits };
}
const waitBars = (p) => p.evaluate(async () => {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {}
  }
  return false;
});
const setSym = async (p, sym, tf) => { await p.evaluate(([s, tf]) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol(s); if (tf) c.setTimeframe(tf); }, [sym, tf]); await sleep(2500); await waitBars(p); await sleep(1500); };
// The payload the indicator pushed to its renderer layer (what gets painted).
const gexData = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.context().cells[0].chart;
  const seen = new Set();
  const find = (o, d) => {
    if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null;
    seen.add(o);
    if (o.nativeData instanceof Map && o.nativeData.has('stk_gex')) return o.nativeData.get('stk_gex');
    for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} }
    return null;
  };
  return JSON.parse(JSON.stringify(find(c, 0) || null));
});
const chip = (p) => p.evaluate(() => { const c = document.querySelector('.stk-gex-chip'); return c && !c.hidden ? { text: c.textContent, href: (c.querySelector('a') || {}).href || null, r: c.getBoundingClientRect().toJSON() } : null; });
const natives = (p) => p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.indicators().filter((h) => h.nativeType).map((h) => ({ type: h.nativeType, inputs: h.inputValues() })));
async function shot(p, name) { await p.mouse.move(5, 5).catch(() => {}); await sleep(500); await p.screenshot({ path: OUT + '/' + name }); console.log('SHOT ' + OUT + '/' + name); }

async function addFromWindow(p) {
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await sleep(600);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.stkiw-side button, .stkiw-side a')].find((x) => /Technicals/.test(x.textContent)); if (b) b.click(); });
  await sleep(400);
  const info = await p.evaluate(() => {
    const grps = [...document.querySelectorAll('.stkiw-list .stkiw-grp')].map((g) => g.textContent);
    const first = document.querySelector('.stkiw-list .stkiw-row');
    const row = document.querySelector('.stkiw-row[data-key="b:stk_gex"]');
    return { grps: grps.slice(0, 3), first: first && first.getAttribute('data-key'), text: row && row.textContent, vela: /vela|luxalgo/i.test(document.querySelector('.stkiw-list').textContent) };
  });
  await p.evaluate(() => document.querySelector('.stkiw-row[data-key="b:stk_gex"] .stkiw-name').click());
  await sleep(500);
  return info;
}

(async () => {
  const b = await launch();
  try {
    // ---- Pro/Elite member, desktop ----
    const { ctx, p, errors, gexHits } = await open(b, { w: 1440, h: 900 });
    await setSym(p, 'futures:ES1!', '5');
    const info = await addFromWindow(p);
    check(info.grps[0] === 'Stryker' && info.first === 'b:stk_gex', 'window: "Stryker" group first, GEX Levels first row (' + info.grps.join(' | ') + ')');
    check(/Stryker GEX Levels/.test(info.text || '') && /Call wall, put wall and zero gamma/.test(info.text || ''), 'window row has name + short description: ' + info.text);
    check(!info.vela, 'window: no Vela/LuxAlgo text');
    await shot(p, 'gex-window-1440.png');
    await p.keyboard.press('Escape'); await sleep(2500);
    let d = await gexData(p);
    const es = SPX.futures.ES.levels;
    const want = [['Call wall', es.call_wall], ['Zero gamma', es.zero_gamma], ['Put wall', es.put_wall]];
    check(d && d.lines && d.lines.length === 3, 'ES: 3 lines pushed (' + (d && d.lines && d.lines.length) + ')');
    want.forEach(([lbl, v], i) => check(d && d.lines && d.lines[i] && Math.abs(d.lines[i].price - r2(v)) < 0.011 && d.lines[i].text.startsWith(lbl), 'ES ' + lbl + ' = API futures.ES ' + v + ' (got ' + (d && d.lines && d.lines[i] && d.lines[i].text) + ')'));
    check(d && d.lines && d.lines[0].color === '#ef4444' && d.lines[1].color === '#f59e0b' && d.lines[2].color === '#22c55e', 'GEX page colours (call red, zero amber, put green)');
    check(d && /^GEX updated (just now|\d+ (min|h) ago|\d+ days ago)/.test(d.status) && !/live|real-time|delayed/i.test(d.status), 'status: ' + (d && d.status));
    let c = await chip(p);
    check(c && /GEX updated/.test(c.text), 'status chip visible: ' + (c && c.text));
    check(gexHits.some((x) => /\/SPX\?dte=0$/.test(x)), 'fetched /api/gex/levels/SPX?dte=0');
    // zoom the price scale to the levels so the screenshot shows them
    await p.evaluate(([lo, hi]) => { try { const ch = window.STRYKER_VELA.context().cells[0].chart; ch.setPriceRange ? ch.setPriceRange(lo, hi) : null; } catch (e) {} }, [es.put_wall - 40, es.call_wall + 40]);
    await shot(p, 'gex-es-1440.png');

    // settings: extras + style, then persistence across reload
    await p.evaluate(() => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_gex'); h.setInputs({ showEm: true, showStrikes: true, lineStyle: 'dashed', callColor: '#ff00aa' }); window.STRYKER_VELA.context().stateChanged(); });
    await sleep(800);
    d = await gexData(p);
    check(d && d.band && Math.abs(d.band.lo - r2(es.iv68_lo)) < 0.011 && Math.abs(d.band.hi - r2(es.iv68_hi)) < 0.011, 'expected move band = API ES iv68 (' + JSON.stringify(d && d.band) + ')');
    check(d && d.lines.filter((l) => /^GEX strike/.test(l.text)).length === 3, 'next 3 big strikes drawn');
    check(d && d.lines[0].color === '#ff00aa' && d.lines[0].dash === 'dashed', 'settings applied (call colour, dashed)');
    const hits0 = gexHits.length;
    await shot(p, 'gex-es-extras-1440.png');
    await sleep(1200);
    const st = await p.evaluate(() => JSON.stringify(window.STRYKER_VELA.getState()));
    check(/stryker\.gex/.test(st) && /"callColor":"#ff00aa"/.test(st), 'workspace state carries GEX settings (ext stryker.gex)');
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_VELA, null, { timeout: 45000 });
    await waitBars(p); await sleep(3000);
    const n = (await natives(p)).find((x) => x.type === 'stk_gex');
    check(n && n.inputs.showEm === true && n.inputs.callColor === '#ff00aa' && n.inputs.lineStyle === 'dashed', 'reload: GEX Levels back with its settings');
    check(hits0 >= 1, 'API hits so far: ' + gexHits.length);

    // NQ (Pro): QQQ levels converted with futures.NQ
    await p.evaluate(() => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_gex'); h.setInputs({ showEm: false, showStrikes: false, lineStyle: 'solid', callColor: '#ef4444' }); });
    await setSym(p, 'futures:NQ1!', '5');
    d = await gexData(p);
    const nq = QQQ.futures.NQ.levels;
    check(d && d.lines && d.lines.length === 3 && Math.abs(d.lines[0].price - r2(nq.call_wall)) < 0.011 && Math.abs(d.lines[2].price - r2(nq.put_wall)) < 0.011, 'NQ (Pro): QQQ levels converted to NQ ' + (d && d.lines && d.lines.map((l) => l.text).join(' / ')));
    check(gexHits.some((x) => /\/QQQ\?dte=0$/.test(x)), 'fetched /api/gex/levels/QQQ?dte=0');
    await shot(p, 'gex-nq-1440.png');

    // unsupported symbol
    await setSym(p, 'futures:CL1!', '5');
    d = await gexData(p); c = await chip(p);
    check(d && !d.lines && d.note === 'GEX levels available for SPX, ES, NQ' && c && c.text === 'GEX levels available for SPX, ES, NQ', 'CL: note shown, nothing drawn');
    await shot(p, 'gex-cl-1440.png');

    // performance: no repaint pushes on mouse move
    await setSym(p, 'futures:ES1!', '5');
    const pushes = await p.evaluate(async () => {
      const c = window.STRYKER_VELA.context().cells[0].chart;
      const h = c.indicators().find((x) => x.nativeType === 'stk_gex');
      return !!h;
    });
    const rect = await p.evaluate(() => document.querySelector('#vela-chart').getBoundingClientRect().toJSON());
    const before = JSON.stringify(await gexData(p));
    for (let i = 0; i < 30; i++) await p.mouse.move(rect.x + 100 + i * 10, rect.y + 200 + (i % 5) * 20);
    const after = JSON.stringify(await gexData(p));
    check(pushes && before === after, 'mouse moves do not change the pushed payload');
    check(!errors.length, 'no page errors (pro) ' + errors.join(' | '));
    await ctx.close();

    // ---- Free member, phone ----
    const f = await open(b, { w: 390, h: 844, mobile: true, free: true });
    await setSym(f.p, 'futures:ES1!', '5');
    await f.p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_gex', { inputs: { dte: '7', showStrikes: true } }); window.STRYKER_VELA.context().stateChanged(); });
    await sleep(2500);
    d = await gexData(f.p);
    check(d && d.lines && d.lines.length === 3 && Math.abs(d.lines[0].price - r2(es.call_wall)) < 0.011, 'Free on ES: SPX-derived levels drawn, strikes extra stays off (' + (d && d.lines && d.lines.length) + ' lines)');
    check(f.gexHits.every((x) => /dte=0$/.test(x)), 'Free: only 0DTE requested (' + f.gexHits.join(',') + ')');
    await shot(f.p, 'gex-es-390-free.png');
    await setSym(f.p, 'futures:NQ1!', '5');
    d = await gexData(f.p); c = await chip(f.p);
    check(d && !d.lines && c && /Unlock NQ GEX with Pro/.test(c.text) && /\/#pricing$/.test(c.href || ''), 'Free on NQ: pill "' + (c && c.text) + '" -> ' + (c && c.href));
    check(c && c.r.right <= 390 && c.r.left >= 0, 'phone: chip inside the 390 viewport');
    check(!f.gexHits.some((x) => /QQQ/.test(x)), 'Free: no QQQ request');
    const sw = await f.p.evaluate(() => document.documentElement.scrollWidth);
    check(sw <= 390, 'phone: no horizontal overflow (' + sw + ')');
    await shot(f.p, 'gex-nq-390-free.png');
    check(!f.errors.length, 'no page errors (free phone) ' + f.errors.join(' | '));
    await f.ctx.close();
  } catch (e) {
    fail++; console.log('FAIL exception ' + (e && e.stack || e));
  } finally {
    await b.close();
  }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
