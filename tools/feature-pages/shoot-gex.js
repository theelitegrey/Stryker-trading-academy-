// Screenshots for /features/gex (FEATA redesign, 19 Nov 2026): the REAL Omega page (gex.html) driven with the
// repo's recorded fixtures, so every image shows the tool working. Output: PNGs (2x) in <outDir>, cropped to
// webp by tools/feature-pages/crop.py.
//   node tools/tests/chart-dev-server.mjs 8093 &      (site + /api/chart/bars from our server)
//   tools/chrome-slot.sh env CHART_BASE=http://127.0.0.1:8093 node tools/feature-pages/shoot-gex.js <outDir> [scene...]
// Data: /api/gex/levels = tools/tests/fixtures/gex/{SPX,QQQ}-0.json (real API replies, 7 Oct 2026); the page clock is set
// to that capture time so "updated X min ago" reads as it did then. Candles = /api/chart/bars (our server) for the same day.
// Heatmap = the synthetic session in tools/tests/gex-history-fixture.js; flow / greeks / options = real feeder fixtures.
// Every image is labelled "Sample data" on the feature page.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('../tests/lib.js');
const stub = require('../tests/richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8093';
const OUT = process.argv[2] || '/tmp/gexshots';
const ONLY = process.argv.slice(3);
const T = path.join(__dirname, '..', 'tests');
const FIX = (p) => path.join(T, 'fixtures', p);
const J = (p) => JSON.parse(fs.readFileSync(FIX(p)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const LV = { SPX: J('gex/SPX-0.json'), QQQ: J('gex/QQQ-0.json'), GLD: J('gex/GLD-0.json') };
const CAP_T = LV.QQQ.market.data_ts;   // 2026-10-07 15:44 UTC

const { packed, BASE: HBASE, open930 } = require('../tests/gex-history-fixture.js');
// Heatmap sample session: the real 2026-10-14 feeder snapshot (hist-base) for the strikes and GEX, moved along the REAL
// ES 2-minute path of 8 Oct 2026 (from /api/chart/bars, loaded in main()) instead of the test fixture's sine curve.
let ES_PATH = null;
const r2 = (v) => Math.round(v * 100) / 100;
function session(u, d, day) {
  const b = HBASE[u + ':' + d];
  if (!b || !ES_PATH) return [];
  const t0 = open930(day), seed = day === HPREV ? 40 : 0, out = [];
  const k = u === 'QQQ' ? b.s / 6600 : b.s / ES_PATH[0];   // ES points -> this market's points
  for (let i = 0; i < 196; i++) {
    const es = ES_PATH[Math.min(ES_PATH.length - 1, i + seed)], s = r2(b.s + (es - ES_PATH[seed]) * (u === 'QQQ' ? k : 1));
    const sc = 0.7 + 0.6 * (i / 195);
    out.push({ u, d, day, t: t0 + i * 120, fa: t0 + i * 120 + 600, x: b.x, s, cw: b.cw, pw: b.pw, zg: r2(b.zg + (s - b.s) * 0.25), n: r2(b.n * sc), em: [b.em[0], b.em[1]],
      k: b.k.slice(), g: b.g.map((v, j) => r2(v * sc * (1 + 0.35 * Math.exp(-Math.pow((b.k[j] - s) / (b.s * 0.004), 2))))) });
  }
  return out;
}
const F_FLOW = (u) => JSON.parse(zlib.gunzipSync(fs.readFileSync(FIX('gex/flow-' + u + '-near.json.gz'))).toString());
let flowMod = null;
const HDAY = '2026-10-14', HPREV = '2026-10-13';
async function ctxFor(b, { w = 1440, h = 900, light = false, clockT = CAP_T + 180 } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { if (window.firebase && window.firebase.apps && !window.firebase.apps.length) window.firebase.apps.push({ name: '[DEFAULT]' }); } catch (e) {} });
  await ctx.addInitScript((light) => {
    try {
      localStorage.setItem('tz_consent', JSON.stringify({ v: 1, essential: true, analytics: false, at: new Date().toISOString() }));
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      if (light) localStorage.setItem('stryker_theme', 'day'); else localStorage.removeItem('stryker_theme');
    } catch (e) {}
    const fn = () => Promise.resolve({ free: false }); Object.defineProperty(window, 'strykerPlanTier', { get: () => fn, set: () => {}, configurable: true });
  }, light);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
  const H = { 'access-control-allow-origin': '*' };
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\//, (r) => {
    const u = new URL(r.request().url()), U = u.searchParams.get('u');
    if (u.pathname === '/gex-sessions') {
      const d = Number(u.searchParams.get('dte'));
      const list = [HDAY, HPREV].map((day) => { const s = session(U, d, day); return s.length ? { u: U, d, day, n: s.length, t0: s[0].t, t1: s[s.length - 1].t } : null; }).filter(Boolean);
      return r.fulfill({ status: 200, contentType: 'application/json', headers: H, body: JSON.stringify(list) });
    }
    if (u.pathname === '/gex-history') {
      const d = Number(u.searchParams.get('dte')), from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to'));
      const rows = [HDAY, HPREV].flatMap((day) => session(U, d, day)).filter((x) => x.t >= from && x.t <= to).sort((a, b) => a.t - b.t);
      return r.fulfill({ status: 200, contentType: 'application/json', headers: H, body: JSON.stringify(packed(U, d, rows)) });
    }
    if (u.pathname === '/opt-analytics') {
      const f = FIX('opt-analytics-' + U + '.json');
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, headers: H, body: 'no' });
      const j = JSON.parse(fs.readFileSync(f)); j.t = Math.floor(Date.now() / 1000) - 7 * 60;
      return r.fulfill({ status: 200, contentType: 'application/json', headers: H, body: JSON.stringify(j) });
    }
    r.fulfill({ status: 404, contentType: 'application/json', headers: H, body: '[]' });
  });
  await ctx.route(/\/api\/gex\/flow\//, (r) => {
    const U = r.request().url().split('?')[0].split('/').pop().toUpperCase();
    try { const o = flowMod.flowFromChain(F_FLOW(U)); o.u = U; o.fetched_at = Math.floor(Date.now() / 1000) - 6 * 60; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) }); }
    catch (e) { r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }); }
  });
  await ctx.route(/\/api\/gex\/ladder/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ u: { SPX: LV.SPX, QQQ: LV.QQQ } }) }));
  await ctx.route(/\/api\/zo\//, (r) => {
    const u = new URL(r.request().url()), name = u.pathname.split('/').pop(), sym = u.searchParams.get('u');
    let body = null; const now = Math.floor(Date.now() / 1000);
    try {
      if (name === 'profile') { const x = u.searchParams.get('x'); body = J('greeks/profile-' + sym + '-' + (x === '0dte' ? '0' : x === 'next' ? '1' : x) + '.json'); body.t = body.built = now - 240; }
      else if (name === 'summary') { body = J('greeks/summary-' + sym + '.json'); body.t = body.built = now - 240; }
    } catch (e) {}
    r.fulfill({ status: body ? 200 : 404, contentType: 'application/json', body: JSON.stringify(body || { error: 'n/a' }) });
  });
  await ctx.route(/\/api\/gex\/levels\//, (r) => {
    const name = new URL(r.request().url()).pathname.split('/').pop().toUpperCase();
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LV[name] || LV.SPX) });
  });
  await ctx.route(/\/api\/gex\/candles\//, async (r) => {
    const u = new URL(r.request().url());
    const fut = u.pathname.split('/').pop().toUpperCase().replace(/^M/, '');
    const tf = (u.searchParams.get('interval') || '5m').replace('m', '');
    const page = Math.floor(CAP_T / (tf === '1' ? 8 * 3600 : 48 * 3600 * (tf === '5' ? 1 : 1)));
    let bars = [];
    for (const pg of tf === '5' ? [10366, 10365] : [page, page - 1]) {
      try { const j = await (await fetch(BASE + '/api/chart/bars/' + fut + '?tf=' + tf + '&page=' + pg)).json(); bars = (j.bars || []).concat(bars); } catch (e) {}
    }
    const candles = bars.filter((x) => x[0] <= CAP_T).sort((a, b) => a[0] - b[0]).map((x) => ({ time: x[0], open: x[1], high: x[2], low: x[3], close: x[4] }));
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candles }) });
  });
  const p = await ctx.newPage();
  if (clockT) { await p.clock.install({ time: new Date(clockT * 1000) }); await p.clock.resume(); }
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  return { ctx, p };
}
const hideChrome = (p) => p.addStyleTag({ content: '.tzc,.toast,#cookie-notice,.cookie-notice,.cn-bar{display:none!important}' }).catch(() => {});
// vendor / data-provider names and timing words never appear in a marketing image (brief 19 Nov)
const scrub = (p) => p.evaluate(() => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const hit = [];
  while (w.nextNode()) hit.push(w.currentNode);
  hit.forEach((n) => { const t = n.nodeValue; const v = t.replace(/\s*·\s*TRADINGVIEW CHART/i, '').replace(/\s*·?\s*TradingView\s*/gi, ' ').replace(/\s*·\s*Cboe [0-9T:\-]+/g, '').replace(/\(Cboe chain time, ET\)/g, '(chain time, ET)').replace(/Cboe\s*/g, '');
    if (v !== t) n.nodeValue = v; });
});
async function el(p, sel, name) {
  await scrub(p);
  const h = await p.$(sel);
  if (!h) { console.log('MISSING', sel); return; }
  await h.evaluate((e) => window.scrollTo(0, scrollY + e.getBoundingClientRect().top - 140)); await sleep(500);
  // sticky site bars would sit on top of a panel that is scrolled to the top edge
  await p.evaluate(() => document.querySelectorAll('header,nav,.dash-topbar,.site-nav,.appnav-dock,.gex-sticky').forEach((e) => { if (/sticky|fixed/.test(getComputedStyle(e).position)) e.style.visibility = 'hidden'; }));
  await h.screenshot({ path: path.join(OUT, name + '.png') });
  await p.evaluate(() => document.querySelectorAll('header,nav,.dash-topbar,.site-nav,.appnav-dock,.gex-sticky').forEach((e) => { e.style.visibility = ''; }));
  console.log('SHOT', name, sel);
}
async function openGex(b, o) {
  const { ctx, p } = await ctxFor(b, o);
  await p.goto(BASE + '/gex.html', { waitUntil: 'domcontentloaded' });
  await sleep(5000);
  await hideChrome(p);
  return { ctx, p };
}
const pick = async (p, sel) => { const h = await p.$(sel); if (h) { await h.click(); await sleep(2500); } else console.log('no', sel); };

const scenes = {
  // QQQ -> NQ, 5m, walls + market levels on the chart
  async chart(b) {
    const { ctx, p } = await openGex(b, {});
    await pick(p, '#gex-tabs [data-m="QQQ"]');
    await pick(p, '.gex-dte[data-d="0"]');
    await sleep(3000);
    await scrub(p); await p.evaluate(() => window.scrollTo(0, 140)); await sleep(500);
    await p.screenshot({ path: path.join(OUT, 'page-top.png') });
    await el(p, '.gex-chart-card', 'chart-qqq');
    await el(p, '.gex-grid > div > section.gex-card', 'levels-qqq');
    await el(p, '.gex-grid aside .gex-card', 'ladder-qqq');
    await el(p, '.gex-grid > div > section.gex-card:nth-of-type(2)', 'market-qqq');
    console.log('errors', p.errors.slice(0, 3));
    await ctx.close();
  },
  async spx(b) {
    const { ctx, p } = await openGex(b, {});
    await pick(p, '#gex-tabs [data-m="SPX"]');
    await pick(p, '.gex-dte[data-d="0"]');
    await sleep(3000);
    await el(p, '.gex-chart-card', 'chart-spx');
    await el(p, '.gex-grid > div > section.gex-card', 'levels-spx');
    await el(p, '.gex-grid aside .gex-card', 'ladder-spx');
    await el(p, '#gex-options', 'options-spx');
    await el(p, '#gex-flow', 'flow-spx');
    await el(p, '#gex-greeks', 'greeks-spx');
    await el(p, '.gex-head', 'head-spx');
    await pick(p, '.gex-vtab[data-view="ladder"]');
    await sleep(1500);
    for (const a of ['GLD', 'SPY', 'QQQ']) { const h = await p.$('.stkgl-pk[data-pk="' + a + '"].on'); if (h) { await h.click(); await sleep(800); } }
    await sleep(3000);
    const lad = await p.$('.gex-vtab[data-view="ladder"]');
    if (lad) { const id = await p.evaluate(() => { const c = [...document.querySelectorAll('.gex-card')].find((e) => !e.hidden && /ladder/i.test(e.id || e.className)); return c && (c.id ? '#' + c.id : null); }); console.log('ladder card', id); if (id) await el(p, id, 'laddertab-spx'); }
    console.log('errors', p.errors.slice(0, 3));
    await ctx.close();
  },
  async heat(b) {
    const { ctx, p } = await openGex(b, { clockT: Date.UTC(2026, 9, 14, 20, 20) / 1000 });
    await pick(p, '#gex-tabs [data-m="SPX"]');
    await pick(p, '.gex-dte[data-d="0"]');
    await pick(p, '.gex-vtab[data-view="heat"]');
    await sleep(3000);
    await el(p, '#gex-heat-card', 'heatmap-spx');
    console.log('errors', p.errors.slice(0, 3));
    await ctx.close();
  },
};

(async () => {
  // ES 1-minute bars of 8 Oct 2026 13:30-20:00 UTC from our bars API, sampled every 2 minutes
  { const j = await (await fetch(BASE + '/api/chart/bars/ES?tf=1&page=' + Math.floor(Date.UTC(2026, 9, 8, 14) / 1000 / 28800))).json();
    const j2 = await (await fetch(BASE + '/api/chart/bars/ES?tf=1&page=' + Math.floor(Date.UTC(2026, 9, 8, 19) / 1000 / 28800))).json();
    const t0 = Date.UTC(2026, 9, 8, 13, 30) / 1000, rows = [...(j.bars || []), ...(j2.bars || [])].filter((x) => x[0] >= t0 && x[0] < t0 + 6.5 * 3600 && (x[0] - t0) % 120 === 0).sort((a, b) => a[0] - b[0]);
    ES_PATH = rows.map((x) => x[4]); console.log('ES path', ES_PATH.length, ES_PATH[0], ES_PATH[ES_PATH.length - 1]); }
  flowMod = await import(path.join(__dirname, '..', '..', 'functions/api/gex/_flow.js'));
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [n, fn] of Object.entries(scenes)) if (!ONLY.length || ONLY.includes(n)) await fn(b);
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
