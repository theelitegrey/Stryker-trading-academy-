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
// Label boxes the renderer layer painted last frame (canvas.__stkGexTags test hook).
const tagsOf = (p) => p.evaluate(() => { for (const c of document.querySelectorAll('canvas')) if (c.__stkGexTags) return c.__stkGexTags; return []; });
const noOverlap = (tg) => tg.every((a, i) => tg.every((b, j) => i >= j || a.box.y + a.box.h <= b.box.y || b.box.y + b.box.h <= a.box.y));
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
    check(/Stryker GEX Levels/.test(info.text || '') && /Call wall, put wall, zero gamma, IV ±68% and market levels/.test(info.text || ''), 'window row has name + short description: ' + info.text);
    check(!info.vela, 'window: no Vela/LuxAlgo text');
    await shot(p, 'gex-window-1440.png');
    await p.keyboard.press('Escape'); await sleep(2500);
    let d = await gexData(p);
    const es = SPX.futures.ES.levels;
    const ses = SPX.session.ES;
    // Every line the GEX page chart draws for ES (gex.js collectLines), same name/colour/style.
    const want = [
      ['call', 'CALL WALL', es.call_wall, '#ef4444', 'solid', 2], ['zero', 'ZERO GAMMA', es.zero_gamma, '#f59e0b', 'dashed', 2],
      ['put', 'PUT WALL', es.put_wall, '#22c55e', 'solid', 2], ['ivhi', 'IV +68%', es.iv68_hi, '#8b7cf6', 'dashed', 1],
      ['ivlo', 'IV -68%', es.iv68_lo, '#8b7cf6', 'dashed', 1], ['vah', 'pVAH', ses.prior_vah, '#38bdf8', 'dashed', 1],
      ['poc', 'pPOC', ses.prior_poc, '#38bdf8', 'solid', 1], ['val', 'pVAL', ses.prior_val, '#38bdf8', 'dashed', 1],
      ['onh', 'ONH', ses.overnight_high, '#64748b', 'dashed', 1], ['onl', 'ONL', ses.overnight_low, '#64748b', 'dashed', 1]];
    check(d && d.lines && d.lines.length === want.length, 'ES: ' + want.length + ' lines pushed (' + (d && d.lines && d.lines.map((l) => l.id).join(',')) + ')');
    want.forEach(([id, lbl, v, colr, dash, w]) => {
      const l = d && d.lines && d.lines.find((x) => x.id === id);
      check(l && Math.abs(l.price - r2(v)) < 0.011 && l.text.startsWith(lbl + ' ') && l.color === colr && l.dash === dash && l.w === w,
        'ES ' + lbl + ' = API ' + v + ' ' + colr + ' ' + dash + ' w' + w + ' (got ' + (l && [l.text, l.color, l.dash, l.w].join(' ')) + ')');
    });
    check(d && /^GEX updated (just now|\d+ (min|h) ago|\d+ days ago)/.test(d.status) && !/live|real-time|delayed/i.test(d.status), 'status: ' + (d && d.status));
    // labels: painted tag boxes never overlap; close levels share one tag
    await p.evaluate(([lo, hi]) => { try { const ch = window.STRYKER_VELA.context().cells[0].chart; if (ch.setPriceRange) ch.setPriceRange(lo, hi); } catch (e) {} }, [es.iv68_lo - 10, es.iv68_hi + 10]);
    await sleep(800);
    let tg = await tagsOf(p);
    check(tg.length >= 5 && noOverlap(tg), 'ES: ' + tg.length + ' label tags painted, none overlapping');
    let c = await chip(p);
    check(c && /GEX updated/.test(c.text), 'status chip visible: ' + (c && c.text));
    check(gexHits.some((x) => /\/SPX\?dte=0$/.test(x)), 'fetched /api/gex/levels/SPX?dte=0');
    // zoom the price scale to the levels so the screenshot shows them
    await p.evaluate(([lo, hi]) => { try { const ch = window.STRYKER_VELA.context().cells[0].chart; ch.setPriceRange ? ch.setPriceRange(lo, hi) : null; } catch (e) {} }, [es.put_wall - 40, es.call_wall + 40]);
    await shot(p, 'gex-es-1440.png');

    // merge: force two levels to the same price via a synthetic payload check of the pure helper
    const merged = await p.evaluate(async () => {
      const m = await import('/assets/chart-gex-levels.js?v=' + (document.querySelector('meta[name=stryker-build]') || {}).content);
      const g = m.mergeTags([{ y: 100.5, l: { id: 'poc', name: 'pPOC', price: 7881, text: 'pPOC 7881', color: '#38bdf8' } }, { y: 102.5, l: { id: 'zero', name: 'ZERO GAMMA', price: 7881.5, text: 'ZERO GAMMA 7881.5', color: '#f59e0b' } }, { y: 140.5, l: { id: 'put', name: 'PUT WALL', price: 7870, text: 'PUT WALL 7870', color: '#22c55e' } }]);
      m.layoutTags(g, 0, 400);
      return g.map((x) => ({ text: x.text, yc: x.yc }));
    });
    check(merged.length === 2 && merged[0].text === 'pPOC · ZERO GAMMA 7881 / 7881.50' && merged[1].yc - merged[0].yc >= 17, 'close levels merge into one tag: ' + JSON.stringify(merged));
    // settings: toggles + extras + style, then persistence across reload
    await p.evaluate(() => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_gex'); h.setInputs(Object.assign({}, h.inputValues(), { showEm: true, showStrikes: true, showPoc: false, showOnh: false, showIv: false, showPrth: true, showPclose: true, showRth: true, showRthOpen: true, showIv80: true, lineStyle: 'dashed', callColor: '#ff00aa', vahColor: '#00ffaa' })); window.STRYKER_VELA.context().stateChanged(); });
    await sleep(800);
    d = await gexData(p);
    const ids = d ? d.lines.map((l) => l.id) : [];
    check(d && d.band && Math.abs(d.band.lo - r2(es.iv68_lo)) < 0.011 && Math.abs(d.band.hi - r2(es.iv68_hi)) < 0.011, 'expected move band = API ES iv68 (' + JSON.stringify(d && d.band) + ')');
    check(d && d.lines.filter((l) => /^GEX strike/.test(l.text)).length === 3, 'next 3 big strikes drawn');
    check(!ids.includes('poc') && !ids.includes('onh') && !ids.includes('ivhi') && ids.includes('vah') && ids.includes('onl'), 'toggles: pPOC, ONH, IV 68% off; pVAH, ONL still on (' + ids.join(',') + ')');
    const extra = { prth_hi: ses.prior_rth_high, prth_lo: ses.prior_rth_low, pclose: ses.prior_close, rth_open: ses.rth_open, rth_hi: ses.rth_high, rth_lo: ses.rth_low, iv80hi: es.iv80_hi, iv80lo: es.iv80_lo };
    check(Object.entries(extra).every(([k, v]) => { const l = d.lines.find((x) => x.id === k); return l && Math.abs(l.price - r2(v)) < 0.011; }), 'extras (prior RTH H/L, prior close, RTH open/H/L, IV ±80%) = API values');
    const cl = d && d.lines.find((l) => l.id === 'call'), vh = d && d.lines.find((l) => l.id === 'vah');
    check(cl && cl.color === '#ff00aa' && cl.dash === 'dashed' && vh && vh.color === '#00ffaa', 'settings applied (call colour, pVAH colour, dashed)');
    tg = await tagsOf(p);
    check(noOverlap(tg), 'with extras: ' + tg.length + ' tags, none overlapping');
    const hits0 = gexHits.length;
    await shot(p, 'gex-es-extras-1440.png');
    await sleep(1200);
    const st = await p.evaluate(() => JSON.stringify(window.STRYKER_VELA.getState()));
    check(/stryker\.gex/.test(st) && /"callColor":"#ff00aa"/.test(st), 'workspace state carries GEX settings (ext stryker.gex)');
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_VELA, null, { timeout: 45000 });
    await waitBars(p); await sleep(3000);
    const n = (await natives(p)).find((x) => x.type === 'stk_gex');
    check(n && n.inputs.showEm === true && n.inputs.callColor === '#ff00aa' && n.inputs.lineStyle === 'dashed' && n.inputs.showPoc === false && n.inputs.vahColor === '#00ffaa' && n.inputs.showRth === true, 'reload: GEX Levels back with its settings (incl. market-level toggles/colours)');
    check(hits0 >= 1, 'API hits so far: ' + gexHits.length);

    // NQ (Pro): QQQ levels converted with futures.NQ
    await p.evaluate(() => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_gex'); h.setInputs(Object.assign({}, h.inputValues(), { showEm: false, showStrikes: false, showPoc: true, showOnh: true, showIv: true, showPrth: false, showPclose: false, showRth: false, showRthOpen: false, showIv80: false, lineStyle: 'as GEX page', callColor: '#ef4444', vahColor: '#38bdf8' })); });
    await setSym(p, 'futures:NQ1!', '5');
    d = await gexData(p);
    const nq = QQQ.futures.NQ.levels;
    const nqs = QQQ.session.NQ, gl = (id) => d && d.lines && d.lines.find((l) => l.id === id);
    check(d && d.lines && d.lines.length === 10 && Math.abs(gl('call').price - r2(nq.call_wall)) < 0.011 && Math.abs(gl('put').price - r2(nq.put_wall)) < 0.011 && Math.abs(gl('ivlo').price - r2(nq.iv68_lo)) < 0.011, 'NQ (Pro): QQQ levels converted to NQ ' + (d && d.lines && d.lines.map((l) => l.text).join(' / ')));
    check(gl('vah') && gl('vah').price === nqs.prior_vah && gl('poc').price === nqs.prior_poc && gl('val').price === nqs.prior_val && gl('onh').price === nqs.overnight_high && gl('onl').price === nqs.overnight_low, 'NQ market levels = API session.NQ');
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
    check(d && d.lines && d.lines.length === 10 && !d.lines.some((l) => /^strike/.test(l.id)) && Math.abs(d.lines[0].price - r2(es.call_wall)) < 0.011, 'Free on ES: SPX-derived GEX + market levels drawn, strikes extra stays off (' + (d && d.lines && d.lines.length) + ' lines)');
    await f.p.evaluate(([lo, hi]) => { try { const ch = window.STRYKER_VELA.context().cells[0].chart; if (ch.setPriceRange) ch.setPriceRange(lo, hi); } catch (e) {} }, [es.iv68_lo - 10, es.iv68_hi + 10]);
    await sleep(800);
    const ftg = await tagsOf(f.p);
    check(ftg.length >= 3 && noOverlap(ftg) && ftg.every((x) => x.box.x >= 0), 'phone: ' + ftg.length + ' tags, none overlapping, inside the plot');
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
