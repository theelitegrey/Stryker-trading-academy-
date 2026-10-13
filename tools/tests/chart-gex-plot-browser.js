// GEX audit 2026-10-13: are the "TradeZoro GEX Levels" lines painted at the API's level prices?
//   node tools/tests/chart-dev-server.mjs 8031 &        (site + local /api/chart/bars)
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8031 [GEX_LIVE=1] \
//     node --max-old-space-size=768 tools/tests/chart-gex-plot-browser.js [shotsDir]
// Default: /api/gex/levels answered from tools/tests/fixtures/gex/*.json with market.options_ts
// moved to "now" so the basis re-anchor runs against the chart's own 1-minute bars.
// GEX_LIVE=1: /api/gex/levels and /api/chart/bars are proxied to https://tradezoro.com (the
// production numbers at test time). For NQ1!, MNQ1!, ES1!, MES1! it checks, per painted line:
//   price == API futures[fut].levels[f] + shift (shift = chart 1m close at the options time -
//   API futures price, recomputed here from the same bars), the painted pixel row maps back to
//   that price within one pixel (coords.yToPrice), and the right-edge label shows that price.
// Then the same after a timeframe change and after a forced data refresh (new API numbers).
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const LIVE = process.env.GEX_LIVE === '1';
const PROD = 'https://tradezoro.com';
const FIX = path.join(__dirname, 'fixtures', 'gex');
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (v) => Math.round(v * 100) / 100;
const FIELDS = { call: 'call_wall', zero: 'zero_gamma', put: 'put_wall', ivhi: 'iv68_hi', ivlo: 'iv68_lo' };
const fmt = (v) => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2));

const apiData = {};      // api name -> the JSON the page received last
let bump = 0;            // added to every level on refresh (refresh test)
async function gexBody(name) {
  let d;
  if (LIVE) d = await (await fetch(PROD + '/api/gex/levels/' + name + '?dte=0', { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' } })).json();
  else {
    d = JSON.parse(fs.readFileSync(path.join(FIX, name + '-0.json')));
    // fixture saved 2026-10-07: pretend it was published 1 min ago so the re-anchor runs
    const now = Date.now() / 1000;
    d.market = Object.assign({}, d.market, { state: 'open', options_ts: now - 60, now, data_ts: now - 600 });
    d.fetched_at = now;
  }
  if (bump) for (const f of Object.values(d.futures || {})) if (f.levels) for (const k of Object.keys(f.levels)) f.levels[k] += bump;
  apiData[name] = d;
  return d;
}
const barLog = [];
async function barsFor(fut, page) {
  const u = (LIVE ? PROD : BASE) + '/api/chart/bars/' + fut + '1!?tf=1&page=' + page;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' } });
      if (res.ok) return (await res.json()).bars || [];
      barLog.push('test ' + fut + ' ' + res.status);
    } catch (e) { barLog.push('test ' + fut + ' ' + e.message); }
    await sleep(1000);
  }
  return [];
}
// Same rule as assets/chart-gex-levels.js anchorShift (kept independent on purpose).
function expectShift(d, fut, rows) {
  const F = d.futures[fut]; const t = d.market && d.market.options_ts;
  if (!d.market || d.market.state !== 'open' || !t || !rows.length) return 0;
  let bar = null; for (const r of rows) if (r[0] + 60 <= t) bar = r;
  if (!bar || t - (bar[0] + 60) > 120) return 0;
  const s = r2(bar[4] - F.futures_price);
  return Math.abs(s) <= F.futures_price * 0.03 ? s : 0;
}

async function open(b) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/\/api\/gex\/levels\//, async (r) => {
    const name = new URL(r.request().url()).pathname.split('/').pop().toUpperCase();
    try { r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await gexBody(name)) }); }
    catch (e) { console.log('INFO gex route ' + name + ' failed: ' + e.message); r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"upstream"}' }); }
  });
  if (LIVE) await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, async (r) => {
    const u = new URL(r.request().url());
    try {
      const res = await fetch(PROD + u.pathname + u.search, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' } });
      if (!res.ok) barLog.push('page ' + u.pathname + u.search + ' ' + res.status);
      r.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    } catch (e) { barLog.push('page ' + u.pathname + ' ' + e.message); r.fulfill({ status: 502, body: '{}' }); }
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA, null, { timeout: 45000 });
  await waitBars(p);
  return { ctx, p, errors };
}
const waitBars = (p) => p.evaluate(async () => {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {}
  }
  return false;
});
const setSym = async (p, sym, tf) => { await p.evaluate(([s, tf]) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol(s); if (tf) c.setTimeframe(tf); }, [sym, tf]); await sleep(2500); await waitBars(p); await sleep(2500); };
const painted = (p) => p.evaluate(() => { for (const c of document.querySelectorAll('canvas')) if (c.__stkGexLines) return { lines: c.__stkGexLines, tags: c.__stkGexTags }; return null; });
// Pin the price pane to [lo, hi] (Vela's own manual-scale path, as a price-axis drag does) so every level is in view.
const fit = (p, lo, hi) => p.evaluate(([lo, hi]) => {
  const c = window.STRYKER_VELA.context().cells[0].chart;
  const seen = new Set();
  const find = (o, d) => {
    if (!o || typeof o !== 'object' || d > 5 || seen.has(o)) return null;
    seen.add(o);
    if (typeof o.setManualScale === 'function' && o.scene && o.scene.panes) return o;
    for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} }
    return null;
  };
  const r = find(c, 0);
  if (!r) return false;
  for (const pane of r.scene.panes.values()) if (pane.kind === 'price') r.setManualScale(pane, Object.assign({}, pane.scale, { min: lo, max: hi }));
  return true;
}, [lo, hi]);
const lastClose = (p) => p.evaluate(() => { const b = window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars; const x = b[b.length - 1]; return x && (x.close != null ? x.close : x.c); });

async function verify(p, api, fut, tag) {
  for (let i = 0; i < 40 && !apiData[api]; i++) await sleep(500);
  const d = apiData[api];
  if (!d) { check(false, tag + ': page never requested ' + api); return; }
  const F = d.futures[fut];
  const t = d.market.options_ts;
  const rows = await barsFor(fut, Math.floor(t / 28800));
  const sh = expectShift(d, fut, rows);
  const L = F.levels;
  const pad = (Math.max(L.call_wall, L.iv68_hi) - Math.min(L.put_wall, L.iv68_lo)) * 0.06;
  const fitted = await fit(p, Math.min(L.put_wall, L.iv68_lo) + sh - pad, Math.max(L.call_wall, L.iv68_hi) + sh + pad);
  if (!fitted) check(false, tag + ': could not pin the price scale');
  await sleep(900);
  const g = await painted(p);
  check(!!(g && g.lines.length), tag + ': lines painted (' + (g ? g.lines.length : 0) + ')');
  if (!g) return;
  for (const [id, f] of Object.entries(FIELDS)) {
    const l = g.lines.find((x) => x.id === id);
    const want = r2(L[f] + sh);
    check(l && Math.abs(l.price - want) < 0.011, tag + ' ' + id + ': line price ' + (l && l.price) + ' == API ' + fut + ' ' + f + ' ' + L[f] + (sh ? ' + chart re-anchor ' + sh : '') + ' = ' + want);
    if (!l) continue;
    check(Math.abs(l.yPrice - l.price) <= l.pxPrice + 1e-6, tag + ' ' + id + ': pixel row ' + (l.y - 0.5) + ' -> price ' + l.yPrice.toFixed(2) + ' (within 1px = ' + l.pxPrice.toFixed(2) + ' pts)');
    const tg = g.tags.find((x) => x.ids.includes(id));
    check(tg && tg.text.includes(fmt(l.price)), tag + ' ' + id + ': label "' + (tg && tg.text) + '" shows ' + fmt(l.price));
  }
  if (fail) console.log('INFO anchor state ' + JSON.stringify(await p.evaluate(async () => (await import('/assets/chart-gex-levels.js?v=' + (document.querySelector('meta[name=stryker-build]') || {}).content)).gexAnchorState())) + ' options_ts ' + t);
  return { sh, api: F.futures_price, chart: await lastClose(p) };
}

(async () => {
  const b = await launch();
  const report = [];
  try {
    const { ctx, p, errors } = await open(b);
    await setSym(p, 'futures:NQ1!', '5');
    await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_gex', { inputs: { dte: '0' } }); window.STRYKER_VELA.context().stateChanged(); });
    await sleep(4000);
    for (const [sym, api, fut] of [['futures:NQ1!', 'QQQ', 'NQ'], ['futures:MNQ1!', 'QQQ', 'MNQ'], ['futures:ES1!', 'SPX', 'ES'], ['futures:MES1!', 'SPX', 'MES']]) {
      await setSym(p, sym, '5');
      const r = await verify(p, api, fut, fut + ' 5m');
      if (r) report.push(fut + ': API futures ' + r.api + ', chart last ' + r.chart + ', re-anchor shift ' + r.sh);
      if (fut === 'NQ' || fut === 'ES') await p.screenshot({ path: OUT + '/gex-audit-' + fut.toLowerCase() + '-1280.png' }), console.log('SHOT ' + OUT + '/gex-audit-' + fut.toLowerCase() + '-1280.png');
    }
    // timeframe change: same prices on 1m and 15m
    await setSym(p, 'futures:NQ1!', '1');
    await verify(p, 'QQQ', 'NQ', 'NQ 1m');
    await setSym(p, 'futures:NQ1!', '15');
    await verify(p, 'QQQ', 'NQ', 'NQ 15m');
    // refresh: new API numbers (+5 on every futures level) must replace the old lines
    bump = 5;
    await p.evaluate(async () => {
      const m = await import('/assets/chart-gex-levels.js?v=' + (document.querySelector('meta[name=stryker-build]') || {}).content);
      await m.gexFetch('QQQ', 0, true);
      const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_gex');
      h.setInputs(Object.assign({}, h.inputValues()));
    });
    await sleep(3000);
    await verify(p, 'QQQ', 'NQ', 'NQ after refresh');
    check(!errors.length, 'no page errors ' + errors.join(' | '));
    await ctx.close();
  } catch (e) {
    fail++; console.log('FAIL exception ' + (e && e.stack || e));
  } finally {
    await b.close();
  }
  report.forEach((x) => console.log('INFO ' + x));
  if (barLog.length) console.log('INFO bars fetch problems: ' + barLog.slice(0, 10).join(' | '));
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
