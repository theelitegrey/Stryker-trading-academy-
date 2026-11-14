// Order flow pro tools in the browser, both chart engines, 1440 + 390: Big Trades, Absorption,
// Imbalance Zones, Volume Profile (session / swing + naked POC), Market Profile (TPO), Effort vs Result.
// Recorder /orderflow and the chart's candles are answered from REAL recorded NQ order flow
// (fixtures/orderflow/NQ-2026-10-2x.bin.gz), so nothing live is called.
//   node tools/tests/chart-dev-server.mjs 8071 &
//   CHART_BASE=http://127.0.0.1:8071 flock /tmp/stryker-chrome.lock \
//     node --max-old-space-size=768 tools/tests/chart-of-pro-browser.js <shotsDir> [ids...]
// Checks per engine: the six tools sit in the Order Flow group; each adds, paints pixels (or fills its
// own pane) and throws nothing; ZN shows the no-data note; no horizontal scroll; no console errors.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8071';
const OUT = process.argv[2] || '.';
const ONLY = process.argv.slice(3);
const FIX = path.join(__dirname, 'fixtures/orderflow');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
const BODY = {};
for (const d of ['2026-10-20', '2026-10-21']) BODY[d] = zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'NQ-' + d + '.bin.gz')));
let CAND = null;
async function candles(tf) {
  if (!CAND) {
    const D = await import(path.resolve(__dirname, '../../assets/chart-footprint-data.js'));
    const bars = [].concat(...Object.values(BODY).map((u) => D.decodeOrderflow(new Uint8Array(u)).bars));
    CAND = { D, bars };
  }
  return CAND.D.aggregate(CAND.bars, tf * 60000).map((b) => [b.t / 1000, b.o * 0.25, b.hi * 0.25, b.lo * 0.25, b.c * 0.25, b.vol]);
}
// The chart's "now": 21 Oct 17:00 UTC (13:00 New York), mid-session, so some levels still hold
const NOW = Date.UTC(2026, 9, 21, 17, 0);

async function open(b, { w, h, mobile, v09 }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([now, theme]) => {
    try { if (theme) localStorage.setItem('stryker_theme', theme); localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1');
      localStorage.removeItem('stryker.vela.session'); localStorage.removeItem('vela-workspace'); localStorage.removeItem('vela-workspace-090'); } catch (e) {}
    const RealDate = Date, off = now - RealDate.now();
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
    window.Date = FakeDate;
    window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true };
  }, [NOW, process.env.OFP_THEME || '']);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, async (r) => {
    const u = new URL(r.request().url());
    const tf = Number(u.searchParams.get('tf')) || 1, page = Number(u.searchParams.get('page')) || 0;
    const bars = (await candles(tf)).filter((x) => x[0] * 1000 < NOW);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: String(tf), page, bars }) });
  });
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/stream/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/orderflow/, (r) => {
    const u = new URL(r.request().url());
    const body = u.searchParams.get('sym') === 'NQ' && BODY[u.searchParams.get('day')];
    if (!body) { r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }); return; }
    r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/stream\.binance\.com.*451|ERR_FAILED|Failed to load resource|\/api\/chart\/stream|firebase|firestore|CORS/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
  await p.goto(BASE + '/charts.html?vela=' + (v09 ? '0.9' : '0.6'), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkOrderflow, null, { timeout: 60000 });
  await sleep(2500);
  return { ctx, p, errors };
}
async function setMarket(p, sym, tf) {
  await p.evaluate(async ([sym, tf]) => {
    const ws = window.STRYKER_VELA;
    ws.active.setSymbol(sym); ws.active.setTimeframe(tf);
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); const c = ws.chart; if (c.market.symbol === sym && c.market.timeframe === tf && c.orchestrator.rawBars.length > 50) break; }
  }, [sym, tf]);
  await sleep(1200);
}
const frameOn = (p, a, z) => p.evaluate(([a, z]) => window.STRYKER_VELA.chart.setVisibleRange({ from: a, to: z }), [a, z]).then(() => sleep(900));
const clearInd = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.chart; for (const h of c.indicators()) if (/^stk_(of_|d)/.test(h.nativeType || '')) { try { h.remove(); } catch (e) {} } });
const add = (p, type, inputs) => p.evaluate(([type, inputs]) => !!window.STRYKER_VELA.chart.addNativeIndicator(type, { inputs }), [type, inputs || {}]);
const ink = (p) => p.evaluate(() => {
  let n = 0;
  for (const c of document.querySelectorAll('#vela-chart canvas')) {
    if (!c.width || !c.height) continue;
    const g = c.getContext('2d'); if (!g) continue;
    let d; try { d = g.getImageData(0, 0, c.width, c.height).data; } catch (e) { continue; }
    for (let i = 3; i < d.length; i += 32) if (d[i] > 0) n++;
  }
  return n;
});
const tablesOf = (p, type) => p.evaluate((type) => { try { return [...window.STRYKER_VELA.chart.renderer.renderer.scene.indicators.values()].filter((m) => m.native && m.native.type === type).map((m) => (m.tables || []).map((t) => t.cells[0][0].text)); } catch (e) { return String(e); } }, type);

const D21 = (h, m) => Date.UTC(2026, 9, 21, h, m);
// TPO "Rows per session" shots: auto vs fixed 20 / 40, two sessions in view. usage: node tporows-shots.js <outDir> (OFP_THEME=light for day)
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
      const { ctx, p, errors } = await open(b, { w, h, mobile, v09: true });
      await setMarket(p, 'futures:NQ1!', '5');
      const a = Date.UTC(2026, 9, 20, 13, 0), z = D21(17, 0);
      for (const rows of [0, 20, 40]) {
        await clearInd(p); await sleep(300);
        await frameOn(p, w < 500 ? z - (z - a) * 0.4 : a, z);
        check(await add(p, 'stk_of_tpo', rows ? { rows } : {}), w + ' rows=' + rows + ' added');
        await sleep(2600);
        const n = await ink(p);
        check(n > 0, w + ' rows=' + rows + ' paints', n);
        await p.screenshot({ path: path.join(OUT, 'tpo-' + (process.env.OFP_THEME || 'dark') + '-' + w + '-rows' + rows + '.png') });
      }
      check(!errors.length, w + ' no console errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  process.exit(fail ? 1 : 0);
})();
