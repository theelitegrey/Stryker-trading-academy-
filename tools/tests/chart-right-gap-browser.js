// Charts right gap (Owner 2026-10-26: "The price has too much gap on right, reduce it so that chart
// area is more bigger"). MNQ1! 3m with Liquidity Master + GEX Levels + Absorption + Delta (H1), on a
// phone (390x844, 412x915, touch) and 1440x900, Vela 0.9.0 and 0.6.17. Measures, in ONE evaluate:
// the plot width, the price-scale column width, the empty strip right of the last bar (px and bars),
// then: a real touch pan + pinch, a real tap on Latest, and a reload.
// Candles + order flow = REAL recorded NQ order flow (fixtures/orderflow, 20-21 Oct); GEX = the saved
// QQQ response shifted next to those candles; GEX history = gex-history-fixture.js (synthetic).
// Test input only: every non-local request is aborted (no InsightSentry, no live data).
//   node tools/tests/chart-fixture-server.mjs 8231 <any fixture.json> &
//   CHART_BASE=http://127.0.0.1:8231 systemd-run --user --scope -p MemoryMax=1000M flock /tmp/stryker-chrome.lock \
//     node tools/tests/chart-right-gap-browser.js <outDir> <tag>
// Env: RG_ENG=09|06 (default both), RG_W=390|412|1440 (default all), RG_EXPECT=1 turns on the
// pass/fail limits of the fix (phone: gap <= 6 bars and <= 9% of the plot; axis column <= 60 px).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const { session, packed } = require('./gex-history-fixture.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8231';
const OUT = process.argv[2] || '.';
const TAG = process.argv[3] || 'run';
const EXPECT = process.env.RG_EXPECT === '1';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
const FIX = path.join(__dirname, 'fixtures');
const BODY = {};
for (const d of ['2026-10-20', '2026-10-21']) BODY[d] = zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'orderflow', 'NQ-' + d + '.bin.gz')));
const NOW = Date.UTC(2026, 9, 21, 17, 0);
let CAND = null;
async function candles(tfMin) {
  if (!CAND) {
    const D = await import(path.resolve(__dirname, '../../assets/chart-footprint-data.js'));
    CAND = { D, bars: [].concat(...Object.values(BODY).map((u) => D.decodeOrderflow(new Uint8Array(u)).bars)) };
  }
  return CAND.D.aggregate(CAND.bars, tfMin * 60000).map((b) => [b.t / 1000, b.o * 0.25, b.hi * 0.25, b.lo * 0.25, b.c * 0.25, b.vol]);
}
async function gexBody() {
  const j = JSON.parse(fs.readFileSync(path.join(FIX, 'gex', 'QQQ-0.json')));
  const c1 = (await candles(1)).filter((x) => x[0] * 1000 < NOW);
  const close = c1[c1.length - 1][4];
  for (const k of ['NQ', 'MNQ']) {
    const f = j.futures[k], d = close - f.futures_price;
    f.basis += d; f.futures_price += d;
    for (const n of Object.keys(f.levels)) f.levels[n] += d;
    const s = j.session[k];
    for (const n of Object.keys(s)) if (typeof s[n] === 'number') s[n] = Math.round((s[n] + d) * 4) / 4;
    s.prior_vah = close + 70; s.overnight_high = close + 40; s.prior_poc = close + 18; s.overnight_low = close - 6; s.prior_val = close - 60;
  }
  return JSON.stringify(j);
}
const DAYS = ['2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21'];
const ALL = (U, d) => DAYS.flatMap((day) => session(U, d, day));

async function context(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([now]) => {
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1');
      if (!sessionStorage.getItem('rg_once')) { sessionStorage.setItem('rg_once', '1'); localStorage.removeItem('vela-workspace'); localStorage.removeItem('vela-workspace-090'); localStorage.removeItem('stryker_bar_replay_v1'); }
    } catch (e) {}
    const RealDate = Date, off = now - RealDate.now();
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
    window.Date = FakeDate;
    window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true };
  }, [NOW]);
  const gex = await gexBody();
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, async (r) => {
    const u = new URL(r.request().url());
    const tf = Number(u.searchParams.get('tf')) || 1, page = Number(u.searchParams.get('page')) || 0;
    const bars = (await candles(tf)).filter((x) => x[0] * 1000 < NOW);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: String(tf), page, bars }) });
  });
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/stream/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/gex\/levels\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: gex }));
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/.*/, (r) => {
    const u = new URL(r.request().url()); const hdr = { 'access-control-allow-origin': '*' };
    if (u.pathname === '/orderflow') {
      const body = u.searchParams.get('sym') === 'NQ' && BODY[u.searchParams.get('day')];
      return body ? r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: hdr, body }) : r.fulfill({ status: 404, headers: hdr, body: '' });
    }
    const U = u.searchParams.get('u'), d = Number(u.searchParams.get('dte'));
    if (u.pathname === '/gex-sessions') return r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(DAYS.map((day) => { const s = session(U, d, day); return { u: U, d, day, n: s.length, t0: s[0].t, t1: s[s.length - 1].t }; })) });
    if (u.pathname === '/gex-history') { const from = +u.searchParams.get('from'), to = +u.searchParams.get('to'); return r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(packed(U, d, ALL(U, d).filter((x) => x.t >= from && x.t <= to))) }); }
    return r.fulfill({ status: 404, headers: hdr, body: '' });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|\/api\/chart\/stream|firebase|firestore|CORS|WebSocket|econ-calendar/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
  return { ctx, p, errors };
}
async function ready(p) {
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_PINE, null, { timeout: 60000 });
  await p.waitForFunction(() => { try { return window.STRYKER_VELA.chart.renderer.renderer.coords.barCount > 50; } catch (e) { return false; } }, null, { timeout: 60000 });
  await sleep(2500);
}
async function setMarket(p, sym, tf) {
  await p.evaluate(async ([sym, tf]) => {
    const ws = window.STRYKER_VELA;
    ws.active.setSymbol(sym); ws.active.setTimeframe(tf);
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); const c = ws.chart; if (c.market.symbol === sym && c.orchestrator.rawBars.length > 50) break; }
  }, [sym, tf]);
  await sleep(1500);
}
async function addLM(p) {
  return p.evaluate(async () => {
    const chart = window.STRYKER_VELA.chart;
    const before = window.STRYKER_PINE.pineHandles(chart).length;
    window.STRYKER_VELA.indicatorPicker.open();
    for (let i = 0; i < 60 && !document.querySelector('.stkiw-row'); i++) await new Promise((r) => setTimeout(r, 300));
    const tab = document.querySelector('.stkiw-tab[data-k="picks"]'); if (tab) tab.click();
    await new Promise((r) => setTimeout(r, 400));
    const row = [...document.querySelectorAll('.stkiw-row')].find((r) => (r.querySelector('.stkiw-nm') || {}).textContent === 'Liquidity Master [TradeZoro]');
    if (!row) return 'no row';
    row.querySelector('.stkiw-name').click();
    for (let i = 0; i < 120 && window.STRYKER_PINE.pineHandles(chart).length <= before; i++) await new Promise((r) => setTimeout(r, 500));
    try { window.STRYKER_VELA.indicatorPicker.close(); } catch (e) {}
    for (let i = 0; i < 120; i++) {
      const ms = [...chart.renderer.renderer.scene.indicators.values()];
      if (ms.some((m) => (m.tables || []).length)) return 'ok';
      await new Promise((r) => setTimeout(r, 500));
    }
    return 'no tables';
  });
}
const addNative = (p, type, inputs) => p.evaluate(([type, inputs]) => { const r = !!window.STRYKER_VELA.chart.addNativeIndicator(type, { inputs }); window.STRYKER_VELA.context().stateChanged(); return r; }, [type, inputs || {}]);
// plot / axis / gap, one frame
const measure = (p) => p.evaluate(() => {
  const R = window.STRYKER_VELA.chart.renderer.renderer, c = R.coords, n = c.barCount;
  const vp = c.getViewport();
  const lastX = c.logicalToX(n - 1);
  const gap = c.widthPx - lastX;
  const cv = R.input && R.input.el; const cr = cv.getBoundingClientRect();
  return { vw: innerWidth, plotW: Math.round(c.widthPx), axisW: R.rightAxisW, cellW: Math.round(cr.width), plotPct: +(100 * c.widthPx / cr.width).toFixed(1),
    gapPx: Math.round(gap), gapBars: +(gap / c.pxPerBar()).toFixed(1), gapPct: +(100 * gap / c.widthPx).toFixed(1), ro: +vp.rightOffset.toFixed(2), bs: +vp.barSpacing.toFixed(2),
    margin: R.scene && R.scene.style && R.scene.style.margins ? R.scene.style.margins.right : null };
});
async function touchDrag(cdp, x0, y0, x1, y1, steps) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }] }); await sleep(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function pinch(cdp, cx, cy, d0, d1, steps) {
  const pts = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + (d1 - d0) * i / steps) }); await sleep(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapLatest(p, mobile) {
  const btn = await p.evaluateHandle(() => [...document.querySelectorAll('#vela-chart .vela-cell .stkc-fl button')].find((x) => x.textContent === 'Latest') || null);
  const bb = btn.asElement() && await btn.asElement().boundingBox();
  if (!bb) return false;
  const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
  const onIt = await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('.stkc-fl')); }, [cx, cy]);
  if (mobile) await p.touchscreen.tap(cx, cy); else await p.mouse.click(cx, cy);
  return onIt;
}
const shot = async (p, name) => { const f = path.join(OUT, TAG + '-' + name + '.png'); await p.screenshot({ path: f }); console.log('SHOT ' + f); };

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  const all = {};
  try {
    for (const v09 of (process.env.RG_ENG === '09' ? [true] : process.env.RG_ENG === '06' ? [false] : [true, false])) {
      const eng = v09 ? 'v09' : 'v06';
      for (const [w, h, mobile] of [[390, 844, true], [412, 915, true], [1440, 900, false]].filter((x) => !process.env.RG_W || String(x[0]) === process.env.RG_W)) {
        const key = eng + '-' + w;
        const { ctx, p, errors } = await context(b, { w, h, mobile });
        await p.goto(BASE + '/charts.html?vela=' + (v09 ? '0.9' : '0.6'), { waitUntil: 'domcontentloaded' });
        await ready(p);
        await setMarket(p, 'futures:MNQ1!', '3');
        const lm = await addLM(p);
        check(lm === 'ok', key + ': Liquidity Master drew its tables', lm);
        check(await addNative(p, 'stk_gex', {}), key + ': GEX Levels added');
        check(await addNative(p, 'stk_of_abs', {}), key + ': Absorption added');
        check(await addNative(p, 'stk_dsuite', { style: 'H1 Session delta profile' }), key + ': Delta H1 added');
        await sleep(6000);
        const m0 = await measure(p); all[key + '-load'] = m0; console.log('METRICS ' + key + ' load ' + JSON.stringify(m0));
        await shot(p, key + '-load');
        // zoom + pan by real touch (phone) / wheel + drag (desktop), then a real tap on Latest
        const pl = await p.evaluate(() => { const r = window.STRYKER_VELA.chart.renderer.renderer; const cr = r.input.el.getBoundingClientRect(); return { x: cr.left, y: cr.top, w: r.coords.widthPx, h: cr.height }; });
        const cx = pl.x + pl.w * 0.5, cy = pl.y + pl.h * 0.45;
        if (mobile) {
          const cdp = await ctx.newCDPSession(p);
          await pinch(cdp, cx, cy, 80, 180, 12); await sleep(700);
          await touchDrag(cdp, cx - 60, cy, cx + 120, cy, 14); await sleep(900);
        } else {
          await p.mouse.move(cx, cy); await p.mouse.wheel(0, -400); await sleep(700);
          await p.mouse.move(cx - 100, cy); await p.mouse.down(); await p.mouse.move(cx + 200, cy, { steps: 12 }); await p.mouse.up(); await sleep(900);
        }
        const m1 = await measure(p); all[key + '-moved'] = m1; console.log('METRICS ' + key + ' moved ' + JSON.stringify(m1));
        check(m1.ro < m0.ro - 2 || Math.abs(m1.bs - m0.bs) > 0.3, key + ': the touch/mouse gestures moved the view', { before: m0, after: m1 });
        const onIt = await tapLatest(p, mobile); await sleep(1800);
        const m2 = await measure(p); all[key + '-latest'] = m2; console.log('METRICS ' + key + ' latest ' + JSON.stringify(m2));
        check(onIt, key + ': Latest reachable by a real tap');
        await shot(p, key + '-latest');
        // reload (the saved workspace brings the indicators back)
        await p.reload({ waitUntil: 'domcontentloaded' });
        await ready(p); await sleep(6000);
        const m3 = await measure(p); all[key + '-reload'] = m3; console.log('METRICS ' + key + ' reload ' + JSON.stringify(m3));
        await shot(p, key + '-reload');
        if (EXPECT) {
          if (mobile) {
            for (const [nm, m] of [['load', m0], ['Latest', m2], ['reload', m3]]) check(m.gapBars >= 2.5 && m.gapBars <= 6.05 && m.gapPct <= 9, key + ' ' + nm + ': small right gap (3-6 bars, <= 9% of plot)', m);
            check(m0.axisW <= 60, key + ': price scale column narrowed', m0.axisW);
          } else {
            // desktop keeps main's rule (>= 6 bars, ~7% of the plot): recorded, and never under 6 bars
            for (const [nm, m] of [['load', m0], ['Latest', m2], ['reload', m3]]) check(m.gapBars >= 5.9 && m.axisW === 64, key + ' ' + nm + ': desktop right gap unchanged (>= 6 bars, 64 px scale)', m);
          }
        }
        check(!errors.length, key + ': no console errors', errors.slice(0, 3));
        await ctx.close();
      }
    }
  } finally { await b.close(); }
  fs.writeFileSync(path.join(OUT, TAG + '-metrics.json'), JSON.stringify(all, null, 1));
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
