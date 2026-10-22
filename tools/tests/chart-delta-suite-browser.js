// Delta suite (assets/chart-delta-suite.js) in the browser, both chart engines, 1440 + 390.
// Recorder /orderflow and the chart's candles are answered from REAL recorded NQ order flow
// (fixtures/orderflow/NQ-2026-10-2x.bin.gz), so nothing live is called.
//   node tools/tests/chart-dev-server.mjs 8071 &
//   CHART_BASE=http://127.0.0.1:8071 flock /tmp/stryker-chrome.lock \
//     node --max-old-space-size=768 tools/tests/chart-delta-suite-browser.js <shotsDir> [styleIds...]
// Checks per engine: "Delta" + "Delta: pane" are the first rows of the Order Flow group; each style
// adds, paints pixels and throws nothing; two "Delta" copies (H1 + H5) both draw; SPY shows the
// no-data note; 1440 + 390 shots.
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
// The fixture day's clock: the 21 Oct NY open (the chart's "now" is the end of the recorded day)
const NOW = Date.UTC(2026, 9, 21, 23, 0);

async function open(b, { w, h, mobile, v09 }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([now, v09]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1');
      localStorage.removeItem('stryker.vela.session'); localStorage.removeItem('vela-workspace'); localStorage.removeItem('vela-workspace-090'); } catch (e) {}
    const RealDate = Date, off = now - RealDate.now();
    // the recorded day is "today" for the order-flow store (so the past-day fetches line up)
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
    window.Date = FakeDate;
    window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true };
    if (v09) { let L; Object.defineProperty(window, 'StrykerPineLibrary', { configurable: true, get() { return L; }, set(v) { if (v) v.isAdmin = () => Promise.resolve(true); L = v; } }); }
  }, [NOW, v09]);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, async (r) => {
    const u = new URL(r.request().url());
    const tf = Number(u.searchParams.get('tf')) || 1, page = Number(u.searchParams.get('page')) || 0;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: String(tf), page, bars: await candles(tf) }) });
  });
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/stream/, (r) => r.abort());
  ctx.on('request', (rq) => { if (/ZN1/i.test(rq.url()) && process.env.DS_DEBUG) console.log('REQ ' + rq.url().slice(0, 160)); });
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
  await p.goto(BASE + '/charts.html' + (v09 ? '?vela=0.9' : ''), { waitUntil: 'domcontentloaded' });
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
const clearInd = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.chart; for (const h of c.indicators()) if (/^stk_d(suite|pane)$/.test(h.nativeType || '')) { try { h.remove(); } catch (e) {} } });
async function add(p, type, style) {
  return p.evaluate(([type, style]) => {
    const h = window.STRYKER_VELA.chart.addNativeIndicator(type, { inputs: { style } });
    return !!h;
  }, [type, style]);
}
// count opaque pixels on every canvas of the active cell; returns the total
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

const STY = [
  ['H1', 'stk_dsuite', 'H1 Session delta profile'],
  ['H5', 'stk_dsuite', 'H5 Delta profile per time block'],
  ['H2', 'stk_dsuite', 'H2 Split bid/ask profile'],
  ['H3', 'stk_dsuite', 'H3 Volume profile + delta'],
  ['H4', 'stk_dsuite', 'H4 Visible range vs last 30 min'],
  ['H6', 'stk_dsuite', 'H6 Delta ladder'],
  ['V3', 'stk_dsuite', 'V3 Delta numbers', 1],
  ['V4', 'stk_dsuite', 'V4 Delta-coloured candles + absorption', 1],
  ['V5', 'stk_dsuite', 'V5 Footprint-lite', 2],
  ['V8', 'stk_dsuite', 'V8 Delta heat strip + CVD'],
  ['V6', 'stk_dsuite', 'V6 Big delta bubbles'],
  ['V7', 'stk_dsuite', 'V7 Session delta box'],
  ['V1', 'stk_dpane', 'V1 Delta bars'],
  ['V2', 'stk_dpane', 'V2 CVD + divergence']
].filter((s) => !ONLY.length || ONLY.includes(s[0]));
const T0 = Date.UTC(2026, 9, 21, 13, 30), T1 = Date.UTC(2026, 9, 21, 16, 0);

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const v09 of [false, true]) {
      const eng = v09 ? 'v09' : 'v06';
      for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
        const { ctx, p, errors } = await open(b, { w, h, mobile, v09 });
        const meta = await p.evaluate(() => ({ v09: window.__stkVela090 === true }));
        check(meta.v09 === v09, eng + ' ' + w + ': engine ' + (v09 ? '0.9.0' : '0.6.17'), meta);
        await setMarket(p, 'futures:NQ1!', '1');
        if (w === 1440) {
          await p.waitForFunction(() => { try { return window.STRYKER_VELA.active.libraryRows().some((r) => r.category === 'Order Flow'); } catch (e) { return false; } }, null, { timeout: 30000 }).catch(() => {});
          const rows = await p.evaluate(() => window.STRYKER_VELA.active.libraryRows().filter((r) => r.category === 'Order Flow').map((r) => r.name));
          check(rows[0] === 'Delta' && /^Delta: pane/.test(rows[1]), eng + ': Order Flow group starts with Delta, Delta: pane', rows);
        }
        for (const [id, type, style, zoom] of STY) {
          await clearInd(p); await sleep(400);
          // V3 / V5 need room per candle: 40 / 16 minutes in view (12 / 8 on the phone)
          if (zoom) await frameOn(p, Date.UTC(2026, 9, 21, 14, 20), Date.UTC(2026, 9, 21, 14, 20) + (zoom === 1 ? (w < 500 ? 12 : 40) : (w < 500 ? 6 : 16)) * 60000);
          else await frameOn(p, T0, T1);
          await sleep(900);
          const base = await ink(p);
          await add(p, type, style);
          await sleep(2200);
          if (type === 'stk_dpane') {
            // own pane: count the pane's series points that carry real order-flow values
            const st = await p.evaluate(() => { const r = window.STRYKER_VELA.chart.renderer.renderer; const ms = [...r.scene.indicators.values()].filter((m) => m.native && m.native.type === 'stk_dpane');
              return ms.map((m) => ({ pane: m.paneId, series: m.series.map((x) => x.kind + ':' + ((x.points || x.bars || []).filter((q) => q && (q.value != null || q.close != null)).length)) })); });
            check(st.length === 1 && st[0].pane !== 'price' && /^(histogram|candle):[1-9]/.test(st[0].series[0]), eng + ' ' + w + ' ' + id + ': own pane with real values', st);
          } else {
            const n = await ink(p);
            check(n > base + (id === 'V3' ? 30 : base * 0.01 + 50), eng + ' ' + w + ' ' + id + ': draws (' + base + ' -> ' + n + ' px)');
          }
          await p.screenshot({ path: path.join(OUT, 'ds-' + eng + '-' + w + '-' + id + '.png') });
        }
        if (!ONLY.length || ONLY.includes('combo')) {
          await clearInd(p); await sleep(300);
          await frameOn(p, T0, T1);
          await add(p, 'stk_dsuite', 'H5 Delta profile per time block'); await sleep(800);
          const a = await ink(p);
          await add(p, 'stk_dsuite', 'H1 Session delta profile'); await sleep(1800);
          const z = await ink(p);
          const cnt = await p.evaluate(() => window.STRYKER_VELA.chart.indicators().filter((h) => h.nativeType === 'stk_dsuite').length);
          check(cnt === 2 && z > a * 1.02, eng + ' ' + w + ': H1 + H5 together (2 copies, ' + a + ' -> ' + z + ' px)', cnt);
          await p.screenshot({ path: path.join(OUT, 'ds-' + eng + '-' + w + '-combo.png') });
          // the no-data note on a symbol without trade data
          if (w === 1440) {
            await setMarket(p, 'futures:ZN1!', '1');   // a market without recorded trades (stocks / forex behave the same: no root)
            await sleep(1500);
            const txt = await p.evaluate(() => { try { return JSON.stringify(window.STRYKER_VELA.chart.renderer.renderer.scene ? [...window.STRYKER_VELA.chart.renderer.renderer.scene.indicators.values()].map((m) => (m.tables || []).map((t) => t.cells[0][0].text)) : []); } catch (e) { return String(e); } });
            check(/Delta needs order-flow data/.test(txt), eng + ': ZN (no trade data) shows the no-data note', txt);
            await p.screenshot({ path: path.join(OUT, 'ds-' + eng + '-1440-spy.png') });
          }
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
