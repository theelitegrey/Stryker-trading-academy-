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
  await ctx.addInitScript(([now]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1');
      localStorage.removeItem('stryker.vela.session'); localStorage.removeItem('vela-workspace'); localStorage.removeItem('vela-workspace-090'); } catch (e) {}
    const RealDate = Date, off = now - RealDate.now();
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
    window.Date = FakeDate;
    window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true };
  }, [NOW]);
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
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|\/api\/chart\/stream|firebase|firestore|CORS/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
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
// [id, type, inputs, tf, frame from, frame to (phone frame is the last 40% of it)]
const CASES = [
  ['big', 'stk_of_big', {}, '1', D21(13, 30), D21(14, 30)],
  ['big2x', 'stk_of_big', { mult: 2, minSize: 50 }, '1', D21(13, 30), D21(14, 30)],
  ['abs', 'stk_of_abs', {}, '1', D21(8, 50), D21(12, 50)],
  ['imb', 'stk_of_imb', {}, '5', D21(10, 0), D21(17, 0)],
  ['vp-session', 'stk_of_vp', { range: 'session' }, '5', Date.UTC(2026, 9, 19, 22, 0), D21(17, 0)],
  ['vp-swing', 'stk_of_vp', { range: 'swing', swingLen: 10 }, '5', D21(4, 0), D21(17, 0)],
  ['tpo', 'stk_of_tpo', {}, '5', Date.UTC(2026, 9, 20, 13, 0), D21(17, 0)],
  ['tpo-zoom', 'stk_of_tpo', {}, '5', D21(13, 25), D21(17, 0)],
  ['evr', 'stk_of_evr', {}, '5', D21(4, 0), D21(17, 0)]
].filter((c) => !ONLY.length || ONLY.includes(c[0]));

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const v09 of (process.env.OFP_ENG === '09' ? [true] : process.env.OFP_ENG === '06' ? [false] : [true, false])) {
      const eng = v09 ? 'v09' : 'v06';
      for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]].filter((x) => !process.env.OFP_W || String(x[0]) === process.env.OFP_W)) {
        const { ctx, p, errors } = await open(b, { w, h, mobile, v09 });
        const meta = await p.evaluate(() => ({ v09: window.__stkVela090 === true }));
        check(meta.v09 === v09, eng + ' ' + w + ': engine ' + (v09 ? '0.9.0' : '0.6.17'), meta);
        if (w === 1440) {
          await p.waitForFunction(() => { try { return window.STRYKER_VELA.active.libraryRows().some((r) => r.category === 'Order Flow'); } catch (e) { return false; } }, null, { timeout: 30000 }).catch(() => {});
          const rows = await p.evaluate(() => window.STRYKER_VELA.active.libraryRows().filter((r) => r.category === 'Order Flow').map((r) => r.name));
          const want = ['Big Trades', 'Absorption', 'Imbalance Zones', 'Volume Profile (trades', 'Market Profile (TPO)', 'Effort vs Result'];
          check(want.every((x) => rows.some((r) => r.startsWith(x))), eng + ': the six tools are in the Order Flow group', rows);
        }
        let tfNow = '';
        for (const [id, type, inputs, tf, a, z] of CASES) {
          await clearInd(p); await sleep(300);
          if (tf !== tfNow) { await setMarket(p, 'futures:NQ1!', tf); tfNow = tf; }
          await frameOn(p, w < 500 ? z - (z - a) * 0.4 : a, z);
          await sleep(700);
          const base = await ink(p);
          check(await add(p, type, inputs), eng + ' ' + w + ' ' + id + ': added');
          await sleep(2600);
          if (type === 'stk_of_evr') {
            const st = await p.evaluate(() => { const r = window.STRYKER_VELA.chart.renderer.renderer; const ms = [...r.scene.indicators.values()].filter((m) => m.native && m.native.type === 'stk_of_evr');
              return ms.map((m) => ({ pane: m.paneId, series: m.series.map((x) => x.kind + ':' + (x.points || []).filter((q) => q && q.value != null).length), flags: (m.series[0].points || []).filter((q) => q && q.color === '#f5b301').length })); });
            check(st.length === 1 && st[0].pane !== 'price' && /^histogram:[1-9]/.test(st[0].series[0]) && /^line:[1-9]/.test(st[0].series[1]) && st[0].flags > 0, eng + ' ' + w + ' evr: own pane, effort bars + result line, flagged bars', st);
          } else if (type === 'stk_of_abs') {
            // rare, small marks: it must draw, and hiding broken levels must remove ink
            const n = await ink(p);
            check(n > base + 10, eng + ' ' + w + ' abs: draws markers + levels (' + base + ' -> ' + n + ' px)');
            await p.evaluate(() => { const h = window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === 'stk_of_abs'); h.setInputs(Object.assign({}, h.inputValues(), { broken: false })); });
            await sleep(1500);
            const n2 = await ink(p);
            check(n2 < n, eng + ' ' + w + ' abs: "hide broken levels" setting removes them (' + n + ' -> ' + n2 + ' px)');
            await p.screenshot({ path: path.join(OUT, 'ofp-' + eng + '-' + w + '-abs-hidden.png') });
            await p.evaluate(() => { const h = window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === 'stk_of_abs'); h.setInputs(Object.assign({}, h.inputValues(), { broken: true })); });
            await sleep(1500);
          } else {
            const n = await ink(p);
            check(n > base + base * 0.003 + 25, eng + ' ' + w + ' ' + id + ': draws (' + base + ' -> ' + n + ' px)');
          }
          const tb = await tablesOf(p, type);
          check(JSON.stringify(tb).indexOf('Needs order-flow') < 0 && JSON.stringify(tb).indexOf('unavailable') < 0, eng + ' ' + w + ' ' + id + ': no error note', tb);
          await p.screenshot({ path: path.join(OUT, 'ofp-' + eng + '-' + w + '-' + id + '.png') });
        }
        if (w === 1440 && !ONLY.length) {
          await clearInd(p);
          await setMarket(p, 'futures:ZN1!', '5');
          await add(p, 'stk_of_abs', {}); await sleep(1800);
          const tb = await tablesOf(p, 'stk_of_abs');
          check(/Needs order-flow data/.test(JSON.stringify(tb)), eng + ': ZN (no trade data) shows the no-data note', tb);
        }
        const hs = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
        check(hs, eng + ' ' + w + ': no horizontal scroll');
        check(!errors.length, eng + ' ' + w + ': no console errors', errors);
        await ctx.close();
      }
    }
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
