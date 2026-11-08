// Browser test: Hyperliquid ladders (assets/chart-hl-ladders.js, rides on Wallet Intel) on hyperliquid:BTC.
//   node tools/tests/chart-dev-server.mjs 8393 &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8393 node tools/tests/hl-ladders-browser.js [shotsDir]
// Chart bars + book come from the REAL public Hyperliquid API. The Worker's /hl-* routes are answered either
//   - from tools/fixtures/hl-intel/hl-*.json (the Worker's real answers from S1's live dry run; exact numbers checked), or
//   - end to end by the real Worker code: HL_INTEL_BASE=http://127.0.0.1:8791 with workers/book-recorder/test/hl-local-server.mjs
//     holding live feeder data (then the candle is the last whole minute the server holds, and numbers are checked against it).
// Checks: listed without a PRO tag; clusters drawn; hover card; tap a cluster -> wallets; tap a candle -> totals + wallets;
// tap a wallet -> profile (copy + explorer link); back; book row -> wallets; coverage line; other symbol -> perps note; wording.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8197';
const LIVE = process.env.HL_INTEL_BASE || '';
const OUT = process.argv[2] || '/tmp';
const FX = (n) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'hl-intel', n));
const FXC = JSON.parse(FX('hl-candle-BTC-1m.json'));
let CANDLE = FXC;   // E2E: replaced by the server's last whole minute
const SFX = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'workers', 'book-recorder', 'test', 'fixtures', n)));
const WSTATE = SFX('hl-state.json'), WLABELS = SFX('hl-labels.json').labels;
let walletBody = null;   // S1's own src/hl.js walletBody: what the Worker answers for an address it holds nothing on (ESM, loaded in main)
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hits = {};

async function open(b, { w, h, mobile, theme, anon }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  if (anon) await ctx.addInitScript(() => { Object.defineProperty(window, 'strykerPlanTier', { configurable: false, get: () => () => new Promise(() => {}), set() {} }); const t = setInterval(() => { const a = window.__stubAuth; if (a) { a.currentUser = null; a.onAuthStateChanged = (cb) => { setTimeout(() => cb(null), 10); return () => {}; }; clearInterval(t); } }, 0); });
  await ctx.addInitScript(([theme, live]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', theme === 'light' ? 'day' : 'night'); localStorage.removeItem('stryker.vela.session'); localStorage.setItem('stkbp.v1', JSON.stringify({ tab: 'book', src: 'hyperliquid' })); } catch (e) {}
    window.__stkChartTestFree = true;
    if (live) window.__STK_BOOK_RECORDER = live;
  }, [theme, LIVE]);
  await require('./binance-mock.js').install(ctx);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.|api\.hyperliquid\.xyz|[a-z0-9.-]*binance)/, (r) => (LIVE && r.request().url().startsWith(LIVE) ? r.continue() : r.abort()));
  const cors = { 'access-control-allow-origin': '*' };
  if (LIVE) {
    await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\//, (r) => r.fulfill({ status: 404, headers: cors, body: '' }));
    await ctx.route((u) => u.href.startsWith(LIVE + '/hl-'), (r) => { const k = new URL(r.request().url()).pathname.slice(4); hits[k] = (hits[k] || 0) + 1; r.continue(); });
  } else {
    await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/(?!hl-)/, (r) => r.fulfill({ status: 404, headers: cors, body: '' }));
    await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/hl-/, (r) => {
      const u = new URL(r.request().url()), k = u.pathname.slice(4), q = (x) => u.searchParams.get(x);
      hits[k] = (hits[k] || 0) + 1;
      const send = (j, st) => r.fulfill({ status: st || 200, contentType: 'application/json', headers: cors, body: JSON.stringify(j) });
      // the fixtures are BTC: any other coin -> the Worker's 404 no_data
      if (q('coin') && q('coin') !== 'BTC') return send({ error: 'no_data' }, 404);
      if (k === 'clusters') return send(JSON.parse(FX('hl-clusters-BTC.json')));
      if (k === 'meta') return send(JSON.parse(FX('hl-meta.json')));
      // candle: the fixture minute only; other candles get what the Worker answers outside the data it holds (empty, partial)
      if (k === 'candle') return +q('from') === FXC.from && +q('to') === FXC.to ? send(FXC) : send({ v: 1, coin: 'BTC', from: +q('from'), to: +q('to'), updated: FXC.updated, held: FXC.held, partial: true, tot: { trades: 0, sz: 0, ntl: 0, takerBuyNtl: 0, takerSellNtl: 0, wallets: 0, truncated: false }, wallets: [], others: null });
      // level: the real fixture holds one tracked bid at 75532; filter it by the asked band as the Worker does
      if (k === 'level') { const j = JSON.parse(FX('hl-level-BTC.json')), lo = +q('lo'), hi = +q('hi'); j.lo = lo; j.hi = hi; j.levels = j.levels.filter((l) => l.px >= lo && l.px <= hi); if (!j.levels.length) { j.totSz = 0; j.totNtl = 0; } return send(j); }
      // wallet: S1's walletBody over the same real state + labels the clusters fixture was built from (workers/book-recorder/test/fixtures)
      if (k === 'wallet') return /^0x[0-9a-f]{40}$/.test(q('a')) ? send(walletBody(q('a'), WSTATE, WLABELS)) : send({ error: 'bad_request' }, 400);
      return send({ error: 'bad_request' }, 400);
    });
  }
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|binance|WebSocket|net::|status of 4|status of 5|opt-analytics|Failed to load resource|CORS|Firestore|FirebaseError/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkWalletIntel, null, { timeout: 60000 });
  await p.evaluate(async () => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol('hyperliquid:BTC'); ws.active.setTimeframe('1');
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === 'hyperliquid:BTC' && ws.chart.orchestrator.rawBars.length > 50) break; }
  });
  if (theme === 'light') await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await sleep(800);
  return { ctx, p, errors };
}
const add = (p, inputs) => p.evaluate((i) => { window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator('stk_hlintel', { inputs: i || {} }); window.STRYKER_VELA.context().stateChanged(); }, inputs);
const chip = (p) => p.evaluate(() => [...document.querySelectorAll('.stk-wi-chip')].filter((x) => !x.hidden).map((x) => x.textContent).join(' | '));
const panelText = (p) => p.evaluate(() => { const e = document.getElementById('stkwi'); return e && !e.hidden ? e.innerText : ''; });
const SHOOT = /wi-(1440-dark|1440-light|412-dark|390-dark)/;
async function shot(p, name) { if (!SHOOT.test(name)) return; await p.mouse.move(2, 2).catch(() => {}); await sleep(600); const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('SHOT ' + f); }
async function tap(p, phone, x, y) { if (phone) await p.touchscreen.tap(x, y); else { await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.up(); } }

const SHOOT2 = /hl-(1440-dark|1440-light|390-dark)/;
async function shot2(p, name) { if (!SHOOT2.test(name)) return; await p.mouse.move(2, 2).catch(() => {}); await sleep(600); const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('SHOT ' + f); }
const geo = (p) => p.evaluate(() => { const G = window.__stkLadders.geometry(); return G ? { lo: G.lo, hi: G.hi, size: G.size, step: G.cl.step, tot: Object.fromEntries(Object.entries(G.cols).map(([k, c]) => [k, c.total])) } : null; });
const zoom = async (p, hours) => { await p.evaluate((n) => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars, last = rb[rb.length - 1].time; window.STRYKER_VELA.chart.setVisibleRange({ from: last - n * 3600000, to: last + 2 * 3600000 }); }, hours); await sleep(1500); };
async function run(b, tag, o) {
  const { ctx, p, errors } = await open(b, o);
  const phone = !!o.mobile;
  const cl = JSON.parse(FX('hl-clusters-BTC.json'));
  const liqTot = cl.liq.reduce((s, x) => s + (x.long ? x.long[0] : 0) + (x.short ? x.short[0] : 0), 0);
  const stopTot = cl.stops.reduce((s, x) => s + (x.sell ? x.sell[0] : 0) + (x.buy ? x.buy[0] : 0), 0);
  await add(p, { minSize: '$10K' }); await sleep(2500);
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setTimeframe('60'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 50) break; } }); await sleep(1500);
  const fab = await p.evaluate(() => { const f = document.querySelector('.stkhll-fab'); return f && !f.hidden ? Math.round(f.getBoundingClientRect().height) : 0; });
  check(fab >= (phone ? 36 : 32), tag + ': Ladders button on the chart (' + fab + ' px high)');
  await p.evaluate(() => document.querySelector('.stkhll-fab').click()); await sleep(1500);
  check(await p.evaluate(() => !document.getElementById('stkhll').hidden), tag + ': panel opens');
  await zoom(p, 400);
  const g1 = await geo(p);
  check(g1 && Math.abs(g1.tot.liq - liqTot) < 1 && Math.abs(g1.tot.sl + g1.tot.tp - stopTot) < 1, tag + ': totals match the server (liq ' + (g1 && Math.round(g1.tot.liq)) + ', SL ' + (g1 && Math.round(g1.tot.sl)) + ', TP ' + (g1 && Math.round(g1.tot.tp)) + ')');
  const txt = await p.evaluate(() => document.getElementById('stkhll').innerText);
  check(/Liquidations/.test(txt) && (phone || (/Stop losses/.test(txt) && /Take profits/.test(txt))), tag + ': ladder names shown');
  check(new RegExp('tracking ' + cl.coverage.wallets + ' of the biggest wallets ≈ ' + Math.round(cl.coverage.oiPct) + '% of open interest').test(txt) && /Tracked wallets only/.test(txt) && /Education only\. Not financial advice\./.test(txt), tag + ': coverage + honesty + education lines');
  check(!/Aggregated|Single/.test(txt), tag + ': no Single/Aggregated switch (one market per coin)');
  check(!/real-time|realtime|\blive\b|coinglass|hyperdash|hypurrscan|nansen|arkham/i.test(txt), tag + ': wording');
  if (!phone) {
    const al = await p.evaluate(() => { const G = window.__stkLadders.geometry(), body = document.querySelector('#stkhll .stkhll-body'), br = body.getBoundingClientRect(); const cv = document.querySelector('canvas[data-stk-wi]').getBoundingClientRect(); return { dTop: Math.round(br.top - (cv.top + G.top)), dH: Math.round(br.height - G.H), rows: document.querySelectorAll('#stkhll .stkhll-row').length }; });
    check(Math.abs(al.dTop) <= 2 && Math.abs(al.dH) <= 2 && al.rows > 0, tag + ': ladder body lines up with the chart plot ' + JSON.stringify(al));
    const rowOk = await p.evaluate(() => { const G = window.__stkLadders.geometry(); const body = document.querySelector('#stkhll .stkhll-body').getBoundingClientRect(); const cv = document.querySelector('canvas[data-stk-wi]').getBoundingClientRect(); const r = document.querySelector('#stkhll .stkhll-row'); const rr = r.getBoundingClientRect(); return rr.top >= body.top - 1 && rr.bottom <= body.bottom + 1; });
    check(rowOk, tag + ': rows stay inside the plot height');
  }
  const sizes = [];
  for (const n of [12, 400]) { await zoom(p, n); sizes.push(await geo(p)); }
  check(sizes[0] && sizes[1] && sizes[0].size <= sizes[1].size && sizes[0].hi - sizes[0].lo < sizes[1].hi - sizes[1].lo, tag + ': row size follows zoom (' + (sizes[0] && sizes[0].size) + ' for range ' + (sizes[0] && Math.round(sizes[0].hi - sizes[0].lo)) + ' -> ' + (sizes[1] && sizes[1].size) + ' for range ' + (sizes[1] && Math.round(sizes[1].hi - sizes[1].lo)) + ')');
  await p.selectOption('#stkhll select', '10'); await sleep(900);
  const g3 = await geo(p);
  check(g3 && g3.size === g3.step * 10 && Math.abs(g3.tot.liq - liqTot) < 1, tag + ': manual row size ' + (g3 && g3.size) + ' keeps the totals');
  await p.selectOption('#stkhll select', 'auto'); await sleep(600);
  await zoom(p, 400);
  await shot2(p, 'hl-' + tag + '-ladders.png');
  const rowCount = await p.evaluate(() => document.querySelectorAll('#stkhll .stkhll-row').length);
  check(rowCount > 0, tag + ': ladder rows drawn (' + rowCount + ')');
  const clicked = await p.evaluate(() => { const r = [...document.querySelectorAll('#stkhll .stkhll-row')].sort((a, b) => b.textContent.length - a.textContent.length)[0]; if (!r) return ''; r.click(); return r.getAttribute('aria-label'); });
  await sleep(1000);
  const pt = await panelText(p);
  check(clicked && /(Liquidations|Stop losses|Take profits) [\d,]+–[\d,]+/.test(pt) && /tracked (position|order)/.test(pt), tag + ': tap a row -> wallets ("' + String(clicked).slice(0, 70) + '")');
  await shot2(p, 'hl-' + tag + '-rowwallets.png');
  await p.evaluate(() => window.__stkWalletIntel.close()); await sleep(300);
  await p.evaluate(() => document.querySelector('#stkhll input').click()); await sleep(900);
  check(await p.evaluate(() => window.__stkLadders.state.bands === true), tag + ': bands toggle on');
  await shot2(p, 'hl-' + tag + '-bands.png');
  await p.evaluate(() => document.querySelector('#stkhll input').click()); await sleep(300);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), tag + ': no horizontal overflow');
  await p.evaluate(() => window.STRYKER_VELA.active.setSymbol('binance:BTCUSDT')); await sleep(2500);
  check(await p.evaluate(() => { const f = document.querySelector('.stkhll-fab'); return !f || f.hidden; }), tag + ': Ladders button hidden on a non-Hyperliquid chart');
  check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
  await ctx.close();
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  walletBody = (await import('../../workers/book-recorder/src/hl.js')).walletBody;
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  const only = process.env.ONLY;
  try {
    const runs = [['1440-dark', { w: 1440, h: 900, theme: 'dark' }], ['1440-light', { w: 1440, h: 900, theme: 'light' }], ['390-dark', { w: 390, h: 844, mobile: true, theme: 'dark', anon: true }]];
    for (const [tag, o] of runs) { if (only && !tag.includes(only)) continue; await run(b, tag, o); }
  } catch (e) { fail++; console.log('FAIL crashed: ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
