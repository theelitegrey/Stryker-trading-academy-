// Gold GEX browser test: ZoroCharts GC1! 5m with the GEX Levels indicator (Pro + Free) and the GEX+ page Gold tab.
//   node tools/tests/chart-dev-server.mjs 8031 &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-gex-gold-browser.js [shotsDir]
// /api/gex/levels/* answered from tools/tests/fixtures/gex/*.json (GLD-0.json = real API response saved 2026-10-29).
const fs = require('fs'), path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const FIX = path.join(__dirname, 'fixtures', 'gex');
const J = (n) => JSON.parse(fs.readFileSync(path.join(FIX, n)));
const FX = { SPX: J('SPX-0.json'), QQQ: J('QQQ-0.json'), GLD: J('GLD-0.json') };
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(b, { w, h, mobile, free, vela, page }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((free) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
    if (free) Object.defineProperty(window, 'strykerPlanTier', { configurable: false, get: () => () => Promise.resolve({ free: true }), set() {} });
  }, !!free);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/\/api\/gex\/levels\//, (r) => {
    const name = new URL(r.request().url()).pathname.split('/').pop().toUpperCase();
    const body = FX[name];
    r.fulfill(body ? { status: 200, contentType: 'application/json', body: JSON.stringify(body) } : { status: 404, contentType: 'application/json', body: '{"error":"unknown market"}' });
  });
  await ctx.route(/\/api\/gex\/ladder/, (r) => { const u = (new URL(r.request().url()).searchParams.get('u') || '').split(','); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dte: 0, u: Object.fromEntries(u.filter((x) => FX[x]).map((x) => [x, FX[x]])) }) }); });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + page, { waitUntil: 'domcontentloaded' });
  return { ctx, p, errors };
}
const shot = async (p, n) => { await p.mouse.move(5, 5).catch(() => {}); await sleep(500); await p.screenshot({ path: OUT + '/' + n }); console.log('SHOT ' + OUT + '/' + n); };
const waitBars = (p) => p.evaluate(async () => { for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {} } return false; });
const gexData = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.context().cells[0].chart, seen = new Set();
  const find = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null; seen.add(o); if (o.nativeData instanceof Map && o.nativeData.has('stk_gex')) return o.nativeData.get('stk_gex'); for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} } return null; };
  return JSON.parse(JSON.stringify(find(c, 0) || null));
});
async function addGex(p) {
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await sleep(700);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.stkiw-side button, .stkiw-side a')].find((x) => /Technicals/.test(x.textContent)); if (b) b.click(); });
  await sleep(400);
  await p.click('.stkiw-row[data-key="b:stk_gex"] .stkiw-name');
  await sleep(500);
  await p.keyboard.press('Escape');
}
async function chart(b, opt) {
  const { ctx, p, errors } = await open(b, Object.assign({ page: '/charts.html' + (opt.vela ? '?vela=' + opt.vela : '') }, opt));
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
  await waitBars(p);
  await p.evaluate(() => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol('futures:GC1!'); c.setTimeframe('5'); });
  await sleep(3000); const got = await waitBars(p);
  const bars = await p.evaluate(() => { const r = window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars; const l = r[r.length - 1]; return { n: r.length, close: l && (l.close != null ? l.close : l[4]) }; });
  return { ctx, p, errors, bars, got };
}
(async () => {
  const b = await launch();
  try {
    for (const [vela, tag] of [['0.9', 'v09'], ['0.6', 'v06']]) {
      for (const [w, h, mob] of [[1440, 900, false], [390, 844, true]]) {
        const { ctx, p, errors, bars } = await chart(b, { w, h, mobile: mob, vela });
        console.log('GC bars', JSON.stringify(bars));
        await addGex(p);
        await sleep(3500);
        const d = await gexData(p);
        const gc = FX.GLD.futures.GC.levels;
        const ids = d && d.lines ? Object.fromEntries(d.lines.map((l) => [l.id, l.price])) : {};
        check(d && d.lines && d.lines.length >= 3, `${tag} ${w}: GC GEX lines pushed (${d && d.lines && d.lines.map((l) => l.id + '=' + l.price).join(', ')})`);
        check(ids.call && Math.abs(ids.call - gc.call_wall) < 0.6 && Math.abs(ids.put - gc.put_wall) < 0.6 && Math.abs(ids.zero - gc.zero_gamma) < 0.6, `${tag} ${w}: call/put/zero match API futures.GC.levels (${gc.call_wall}/${gc.put_wall}/${gc.zero_gamma})`);
        if (bars.close) check(Math.abs(ids.call / bars.close - 1) < 0.08 && Math.abs(ids.put / bars.close - 1) < 0.08, `${tag} ${w}: walls within 8% of GC close ${bars.close}`);
        check(d && /^GEX updated/.test(d.status || '') && !/live|real-time|delayed/i.test(d.status || ''), `${tag} ${w}: status "${d && d.status}"`);
        if (d && d.lines && d.lines.length) await p.evaluate(([lo, hi]) => { try { window.STRYKER_VELA.context().cells[0].chart.setPriceRange(lo, hi); } catch (e) {} }, [gc.put_wall - 40, gc.call_wall + 40]);
        await shot(p, `gc-pro-${tag}-${w}.png`);
        check(!errors.length, `${tag} ${w}: no page errors ${errors.join(' | ').slice(0, 200)}`);
        await ctx.close();
      }
    }
    // Free: PRO pill
    { const { ctx, p } = await chart(b, { w: 1440, h: 900, free: true, vela: '0.9' });
      await addGex(p);
      await sleep(3500);
      const n = await p.evaluate(() => document.body.innerText.match(/Pro|PRO/g) || []);
      const d = await gexData(p);
      console.log('free payload', JSON.stringify(d).slice(0, 300));
      await shot(p, 'gc-free-1440.png'); await ctx.close(); }
    // GEX+ page, Gold tab
    for (const [w, h, mob] of [[1440, 900, false], [390, 844, true]]) {
      const { ctx, p, errors } = await open(b, { w, h, mobile: mob, page: '/gex.html' });
      await sleep(3000);
      await p.click('.gex-tab[data-m="GLD"]'); await sleep(3500);
      const t = await p.evaluate(() => ({ tab: document.querySelector('.gex-tab.is-on').textContent, body: document.body.innerText, opt: document.getElementById('gex-options').hidden, flow: document.getElementById('gex-flow').hidden }));
      check(/Gold/.test(t.tab) && /GLD\/GC\/MGC/.test(t.tab), `gex page ${w}: tab "${t.tab}"`);
      check(t.opt && t.flow, `gex page ${w}: options + options-volume cards hidden for Gold`);
      const gl = FX.GLD;
      check(new RegExp(String(gl.call_wall)).test(t.body) && new RegExp(String(gl.put_wall)).test(t.body), `gex page ${w}: GLD call/put wall ${gl.call_wall}/${gl.put_wall} shown`);
      await shot(p, `gex-gold-${w}.png`);
      await p.click('.gex-vtab[data-view="heat"]').catch(() => {}); await sleep(1500);
      const heat = await p.evaluate(() => (document.getElementById('gex-heat-empty') || {}).textContent);
      check(/building history/.test(heat || ''), `gex page ${w}: heatmap says "${(heat || '').slice(0, 60)}"`);
      await shot(p, `gex-gold-heat-${w}.png`);
      check(!errors.length, `gex page ${w}: no page errors ${errors.join(' | ').slice(0, 200)}`);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
