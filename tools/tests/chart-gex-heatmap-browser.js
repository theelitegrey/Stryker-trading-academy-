// Charts "TradeZoro GEX Heatmap" browser test (assets/chart-gex-heatmap.js).
//   node tools/tests/chart-dev-server.mjs 8091   (site + the real /api/chart/bars, live Yahoo upstream)
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8091 node --max-old-space-size=768 tools/tests/chart-gex-heatmap-browser.js [shotsDir]
// GEX history = the SYNTHETIC session of tools/tests/gex-history-fixture.js (real 2026-10-14
// snapshot shape, scaled) for TODAY's date, so it lines up with today's real futures bars.
// /api/gex/levels = saved real responses (fixtures/gex/*.json) for the NQ ratio.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const { session, packed } = require('./gex-history-fixture.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8091';
const OUT = process.argv[2] || '/tmp';
const FIX = path.join(__dirname, 'fixtures', 'gex');
const LV = { SPX: JSON.parse(fs.readFileSync(path.join(FIX, 'SPX-0.json'))), QQQ: JSON.parse(fs.readFileSync(path.join(FIX, 'QQQ-0.json'))) };
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const etDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
// test sessions: today and the previous weekday (ET)
const DAY = process.env.HEAT_DAY || etDay(Date.now());
const PREV = (() => { let t = Date.parse(DAY + 'T12:00:00Z') - 86400000; while ([0, 6].includes(new Date(t).getUTCDay())) t -= 86400000; return new Date(t).toISOString().slice(0, 10); })();
// the synthetic session spot follows SPX/QQQ levels; ES/NQ heat is re-anchored to the chart's bars

async function open(b, { w, h, mobile, free }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((free) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
    if (free) Object.defineProperty(window, 'strykerPlanTier', { configurable: false, get: () => () => Promise.resolve({ free: true }), set() {} });
  }, !!free);
  const hits = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/gex-(history|sessions)/, (r) => {
    const u = new URL(r.request().url()); hits.push(u.pathname + u.search);
    const U = u.searchParams.get('u'), d = Number(u.searchParams.get('dte'));
    const hdr = { 'access-control-allow-origin': '*' };
    if (u.pathname === '/gex-sessions') {
      const list = U === 'SPX' || U === 'QQQ' ? [DAY, PREV].map((day) => { const s = session(U, d, day); return { u: U, d, day, n: s.length, t0: s[0].t, t1: s[s.length - 1].t }; }) : [];
      return r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(list) });
    }
    const from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to'));
    const rows = [PREV, DAY].flatMap((day) => session(U, d, day)).filter((x) => x.t >= from && x.t <= to);
    r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(packed(U, d, rows)) });
  });
  await ctx.route(/\/api\/gex\/levels\//, (r) => {
    const name = new URL(r.request().url()).pathname.split('/').pop().toUpperCase();
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LV[name] || LV.SPX) });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|WebSocket connection/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA, null, { timeout: 45000 });
  await waitBars(p);
  return { ctx, p, errors, hits };
}
const waitBars = (p) => p.evaluate(async () => {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {}
  }
  return false;
});
const setSym = async (p, sym, tf) => { await p.evaluate(([s, tf]) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol(s); if (tf) c.setTimeframe(tf); }, [sym, tf]); await sleep(2500); await waitBars(p); await sleep(2500); };
// the layer's last frame (canvas.__stkGexHeat hook)
const frame = (p) => p.evaluate(() => { for (const c of document.querySelectorAll('canvas')) if (c.__stkGexHeat) return c.__stkGexHeat; return null; });
// force a few repaints and take the worst frame time
const worstMs = (p) => p.evaluate(async () => {
  const ch = window.STRYKER_VELA.context().cells[0].chart; let worst = 0;
  for (let i = 0; i < 6; i++) {
    try { ch.scrollBy ? ch.scrollBy(i % 2 ? 3 : -3) : ch.requestRender && ch.requestRender(); } catch (e) {}
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (const c of document.querySelectorAll('canvas')) if (c.__stkGexHeat) worst = Math.max(worst, c.__stkGexHeat.ms);
  }
  return worst;
});
// anchor check: for the newest snapshot that has a conversion, mul*spot+add == chart close at that time
const anchor = (p) => p.evaluate(() => {
  const T = window.__stkGexHeat; const h = [...T.heats.values()].pop(); if (!h) return null;
  const ch = window.STRYKER_VELA.context().cells[0].chart; const bars = ch.orchestrator.rawBars;
  let i = h.rows.length - 1; while (i >= 0 && !h.conv[i]) i--;
  if (i < 0) return { none: true, rows: h.rows.length, r0: h.rows[0] && h.rows[0].t, rN: h.rows.length && h.rows[h.rows.length - 1].t, b0: bars[0], bN: bars[bars.length - 1], nb: bars.length };
  const r = h.rows[i], c = h.conv[i];
  return { t: r.t, spot: r.s, mul: c.mul, add: c.add, mapped: c.mul * r.s + c.add, close: T.closeAt(bars, r.t, 3600), convN: h.conv.filter(Boolean).length, rows: h.rows.length };
});
async function shot(p, name) { await p.mouse.move(5, 5).catch(() => {}); await sleep(600); await p.screenshot({ path: OUT + '/' + name }); console.log('SHOT ' + OUT + '/' + name); }
const addHeat = (p, inputs) => p.evaluate((inputs) => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_gexheat', { inputs: inputs || {} }); window.STRYKER_VELA.context().stateChanged(); }, inputs || {});

(async () => {
  const b = await launch();
  try {
    console.log('test days', DAY, PREV);
    // ---- Pro member, desktop: picker row, NQ, ES ----
    let { ctx, p, errors, hits } = await open(b, { w: 1440, h: 900 });
    await setSym(p, 'futures:NQ1!', '5');
    await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
    await p.waitForSelector('.stkiw-row[data-key="b:stk_gexheat"]', { timeout: 15000 }).catch(() => {});
    const row = await p.evaluate(() => { const r = document.querySelector('.stkiw-row[data-key="b:stk_gexheat"]'); return r && r.textContent; });
    check(/TradeZoro GEX Heatmap/.test(row || '') && /Net GEX at every strike/.test(row || ''), 'indicator window lists "TradeZoro GEX Heatmap": ' + row);
    if (row) await p.evaluate(() => document.querySelector('.stkiw-row[data-key="b:stk_gexheat"] .stkiw-name').click());
    else await addHeat(p);
    await sleep(500);
    await p.keyboard.press('Escape'); await sleep(4000);
    let f = await frame(p);
    if (process.env.DBG) console.log('DBG', JSON.stringify(await anchor(p)));
    check(f && f.cols > 20, 'NQ: heat columns painted behind the candles (' + (f && f.cols) + '), status "' + (f && f.text) + '"');
    check(f && /QQQ/.test(f.text) && /updated/.test(f.text) && !/live|real-time|delayed/i.test(f.text), 'NQ status wording ok');
    let a = await anchor(p);
    const k = LV.QQQ.futures.NQ.ratio;
    check(a && !a.none && Math.abs(a.mul - k) < 1e-9, 'NQ: QQQ strikes x API NQ ratio ' + k + ' (got ' + (a && a.mul) + ')');
    check(a && a.close != null && Math.abs(a.mapped - a.close) < 0.01, 'NQ: re-anchored, QQQ spot ' + (a && a.spot) + ' maps to the chart close ' + (a && a.close) + ' at the snapshot time (' + (a && a.mapped) + ')');
    let ms = await worstMs(p);
    check(ms < 8, 'NQ: heat layer frame ' + ms.toFixed(2) + ' ms (< 8 ms)');
    check(hits.some((x) => /u=QQQ&dte=0/.test(x)), 'NQ asked the recorder for QQQ 0DTE');
    await shot(p, 'chart-gexheat-nq-1440.png');
    // opacity setting
    await p.evaluate(() => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_gexheat'); h.setInputs(Object.assign({}, h.inputValues(), { opacity: 0.9 })); });
    await sleep(800);
    const op = await p.evaluate(() => { const T = window.__stkGexHeat; const c = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_gexheat'); return c.inputValues().opacity; });
    check(op === 0.9, 'opacity setting applies (' + op + ')');
    await setSym(p, 'futures:ES1!', '5');
    await sleep(2500);
    f = await frame(p); a = await anchor(p);
    check(f && f.cols > 20 && /ES \(from SPX\)/.test(f.text), 'ES: heat painted from SPX (' + (f && f.cols) + ' cols) "' + (f && f.text) + '"');
    check(a && Math.abs(a.mul - 1) < 1e-9 && a.close != null && Math.abs(a.mapped - a.close) < 0.01, 'ES: ratio 1 + basis from the chart close (' + (a && [a.mapped, a.close].join(' = ')) + ')');
    ms = await worstMs(p);
    check(ms < 8, 'ES: frame ' + ms.toFixed(2) + ' ms (< 8 ms)');
    await shot(p, 'chart-gexheat-es-1440.png');
    await setSym(p, 'futures:CL1!', '5');
    f = await frame(p);
    check(f && f.cols === 0 && /available for SPX/.test(f.text), 'CL: nothing drawn, note "' + (f && f.text) + '"');
    check(!errors.length, 'no page errors (' + errors.slice(0, 3).join(' | ') + ')');
    await ctx.close();

    // ---- Free member, phone: ES free, NQ locked ----
    ({ ctx, p, errors, hits } = await open(b, { w: 390, h: 844, mobile: true, free: true }));
    await setSym(p, 'futures:ES1!', '5');
    await addHeat(p, { dte: '1' }); await sleep(4000);
    f = await frame(p);
    check(f && f.cols > 0 && /0DTE/.test(f.text), 'Free ES: heat drawn, forced to 0DTE "' + (f && f.text) + '"');
    await shot(p, 'chart-gexheat-es-390-free.png');
    hits.length = 0;
    await setSym(p, 'futures:NQ1!', '5'); await sleep(1500);
    f = await frame(p);
    check(f && f.cols === 0 && /Unlock NQ GEX heatmap with Pro/.test(f.text), 'Free NQ: Pro pill, nothing drawn "' + (f && f.text) + '"');
    check(!hits.some((x) => /u=QQQ/.test(x)), 'Free NQ: no QQQ history requested');
    await shot(p, 'chart-gexheat-nq-390-free.png');
    check(!errors.length, 'no page errors (free) (' + errors.slice(0, 3).join(' | ') + ')');
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
