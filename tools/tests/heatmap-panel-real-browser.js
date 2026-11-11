// Heatmap panel with the REAL chart symbol strings (bug 2026-11-11: Order book was off on "NQ1!" because only "futures:" counted).
// FIXTURE data only: 1m bars per root, a fake /ts-live socket that answers for the root it is asked for, synthetic GEX history
// (tools/tests/gex-history-fixture.js, NOT market data) shifted so it either ends now (fresh) or 11 h ago (stale).
//   node tools/tests/chart-dev-server.mjs 8057
//   CHART_BASE=http://127.0.0.1:8057 flock /tmp/stryker-chrome.lock node tools/tests/heatmap-panel-real-browser.js <shotsDir>
// Checks: Order book tab enabled on NQ1! / CME:NQ1! / ES1! / GC1! / MNQ1! and the book heatmap draws on NQ1!, ES1!, GC1!;
// Options adds exactly ONE layer, draws columns when the data is fresh, and with 11 h old data shows the plain US-hours note.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const { session, packed } = require('./gex-history-fixture.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8057';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const LVQ = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'gex', 'QQQ-0.json')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };

const MID = { NQ: 28650, ES: 6800, GC: 4000, MNQ: 28650 }, TK = { NQ: 0.25, ES: 0.25, GC: 0.1, MNQ: 0.25 };
const MIN = Math.floor(Date.now() / 60000), N = 180;
const barsFor = (root) => { const m0 = MID[root] || 28650, t = TK[root] || 0.25, out = [];
  for (let m = MIN - N; m < MIN; m++) { const px = (k) => m0 * (1 + 0.0014 * Math.sin((k - MIN) / 17)); const o = Math.round(px(m) / t) * t, c = Math.round(px(m + 1) / t) * t;
    out.push([m * 60, o, Math.max(o, c) + 8 * t, Math.min(o, c) - 8 * t, c, 400 + (m % 7) * 30]); } return out; };
// GEX rows: one fixture session shifted so the last snapshot is `endAgoS` seconds ago
const etDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
const gexRows = (u, d, endAgoS) => { const s = session(u, d, '2026-10-14'), sh = Math.floor(Date.now() / 1000) - endAgoS - s[s.length - 1].t;
  return s.map((r) => Object.assign({}, r, { t: r.t + sh, fa: r.t + sh, day: etDay((r.t + sh) * 1000) })); };

function fakeWs() {
  window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  window.openPlanUpgradeModal = () => {};
  const MIDS = { NQ: 28650, ES: 6800, GC: 4000, MNQ: 28650 }, TKS = { NQ: 0.25, ES: 0.25, GC: 0.1, MNQ: 0.25 };
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const root = (/symbol=([A-Z0-9]+)/.exec(String(url)) || [])[1] || 'NQ', t = TKS[root] || 0.25, mid = MIDS[root] || 28650;
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) }); }, 50);
    let n = 0;
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1 || !ws.onmessage) return; n++;
      const now = Date.now(), b = Math.floor(mid / t) * t, bids = [], asks = [];
      for (let i = 0; i < 12; i++) { bids.push([+(b - i * t).toFixed(2), 10 + ((i * 7 + n) % 30)]); asks.push([+(b + t + i * t).toFixed(2), 10 + ((i * 5 + n) % 30)]); }
      ws.onmessage({ data: JSON.stringify({ type: 'snap', symbol: root, ts: now, bids, asks, imb: 0, imb10: 0 }) });
      ws.onmessage({ data: JSON.stringify({ type: 'ticks', symbol: root, t: [[b, 3, -1, now], [+(b + t).toFixed(2), 2, 1, now]] }) });
      if (n % 5 === 0) { const step = t * 11, i0 = Math.floor((b - 480 * t) / step), v = [];
        for (let k = 0; k < 88; k++) { const p = (i0 + k + 0.5) * step, w = 20 + ((k * 13) % 50) + (k % 17 === 0 ? 800 : 0); v.push(p < b ? w : -w); }
        ws.onmessage({ data: JSON.stringify({ type: 'coarse', symbol: root, ts: now, mid: b, bb: b, ba: b + t, step, i0, v }) }); }
    }, 200);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
async function open(b, { w, h, mobile, gexAgoS }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile, colorScheme: 'dark' });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeWs);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); localStorage.setItem('stryker_theme', 'night'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => { const s = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop()).toUpperCase().replace(/1!$/, '').replace(/^[A-Z_]+:/, '');
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s, tf: '1', page: 0, bars: barsFor(s) }) }); });
  await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  await ctx.route(/\/api\/gex\/levels\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LVQ) }));
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/gex-(history|sessions)/, (r) => {
    const u = new URL(r.request().url()), U = u.searchParams.get('u'), d = Number(u.searchParams.get('dte')), hdr = { 'access-control-allow-origin': '*' };
    const rows = U === 'QQQ' ? gexRows(U, d, gexAgoS) : [];
    if (u.pathname === '/gex-sessions') return r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(rows.length ? [{ u: U, d, day: rows[0].day, n: rows.length, t0: rows[0].t, t1: rows[rows.length - 1].t }] : []) });
    const from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to'));
    r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(packed(U, d, rows.filter((x) => x.t >= from && x.t <= to))) });
  });
  const p = await ctx.newPage(), errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|\/api\/chart\/stream|Failed to load resource|Ping received after close|WebSocket connection/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(1500);
  return { ctx, p, errors };
}
const setSym = (p, sym) => p.evaluate(async (s) => {
  const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1');
  for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === s && c.orchestrator.rawBars.length > 20) break; }
}, sym);
const types = (p) => p.evaluate(() => window.STRYKER_VELA.chart.indicators().map((x) => x.nativeType));
const st = (p) => p.evaluate(() => window.__stkHeatmapPanel.state());
const tabs = (p) => p.evaluate(() => [...document.querySelectorAll('.stkhm-sec:first-child .stkhm-seg button')].map((b) => b.textContent + (b.disabled ? '(off)' : '')));
const clickText = (p, t) => p.evaluate((t) => { const b = [...document.querySelectorAll('.stkhm button')].find((x) => x.textContent.trim() === t && !x.disabled); if (b) b.click(); return !!b; }, t);
const sw = async (p) => { await p.evaluate(() => document.querySelector('.stkhm-sw').click()); await sleep(2500); };
const heat = (p) => p.evaluate(() => { const d = window.__stkFlow.dhDebug && window.__stkFlow.dhDebug(); return d && d.heat ? d.heat.cells : 0; });
const gexFrame = (p) => p.evaluate(() => { for (const c of document.querySelectorAll('canvas')) if (c.__stkGexHeat) return c.__stkGexHeat; return null; });
const optNoteText = (p) => p.evaluate(() => { const n = document.querySelector('.stkhm-optnote'); return n ? n.textContent : null; });
const reopen = async (p) => { await p.evaluate(() => { window.__stkHeatmapPanel.close(); window.__stkHeatmapPanel.open(); }); await sleep(1800); };

(async () => {
  const b = await launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--max-old-space-size=768'] });
  try {
    // ---- 1440 dark, fresh options data ----
    let { ctx, p, errors } = await open(b, { w: 1440, h: 900, gexAgoS: 30 });
    for (const sym of ['NQ1!', 'CME:NQ1!', 'ES1!', 'GC1!', 'MNQ1!']) {
      await setSym(p, sym); await reopen(p);
      const tb = await tabs(p);
      check(/^Order book,/.test(tb.join()), sym + ': Order book tab enabled', tb);
      if (['NQ1!', 'ES1!', 'GC1!'].includes(sym)) {
        await sw(p); await sleep(6000);
        const t = await types(p), cells = await heat(p);
        check(t.filter((x) => x === 'stk_depth_heat').length === 1 && cells > 100, sym + ': ON adds one Depth Heatmap layer and it draws (' + cells + ' cells)', { t, cells });
        if (sym === 'NQ1!') { await p.screenshot({ path: OUT + '/hmfix-nq1-book-1440.png' }); console.log('SHOT ' + OUT + '/hmfix-nq1-book-1440.png'); }
        await sw(p);
        check(!(await types(p)).includes('stk_depth_heat'), sym + ': OFF removes it');
      }
    }
    await setSym(p, 'NQ1!'); await reopen(p);
    await clickText(p, 'Options'); await sleep(600);
    await sw(p); await sleep(7000);
    let t = await types(p), f = await gexFrame(p);
    check(t.filter((x) => x === 'stk_gexheat').length === 1 && !t.includes('stk_depth_heat'), 'NQ1! Options: exactly one layer (stk_gexheat)', t);
    check(f && f.cols > 20, 'NQ1! Options fresh: heat columns drawn (' + (f && f.cols) + ')', f);
    check(f && /QQQ/.test(f.text) && /GEX heatmap/.test(f.text) && !/delayed|behind|real-time/i.test(f.text), 'status wording: "' + (f && f.text) + '"');
    await reopen(p);
    check((await optNoteText(p)) === '', 'fresh data: no US-hours note', await optNoteText(p));
    await p.screenshot({ path: OUT + '/hmfix-nq1-options-fresh-1440.png' }); console.log('SHOT ' + OUT + '/hmfix-nq1-options-fresh-1440.png');
    // switching sources never stacks layers
    await clickText(p, 'Order book'); await sleep(3000); await clickText(p, 'Options'); await sleep(3000);
    t = await types(p);
    check(t.filter((x) => x === 'stk_gexheat').length === 1 && !t.includes('stk_depth_heat'), 'Order book -> Options: still one layer', t);
    await sw(p);
    check(errors.length === 0, '1440 fresh: no page errors', errors);
    await ctx.close();

    // ---- 1440 + 390 dark, options data 11 h old (overnight) ----
    for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
      ({ ctx, p, errors } = await open(b, { w, h, mobile, gexAgoS: 11 * 3600 + 120 }));
      await setSym(p, 'NQ1!'); await reopen(p);
      const tb = await tabs(p);
      check(/^Order book,/.test(tb.join()), w + ' NQ1!: Order book tab enabled', tb);
      await clickText(p, 'Options'); await sleep(600);
      await sw(p); await sleep(7000);
      t = await types(p); f = await gexFrame(p);
      check(t.filter((x) => x === 'stk_gexheat').length === 1, w + ' stale: one layer', t);
      check(f && f.cols === 0 && /updated 11 h ago/.test(f.text), w + ' stale: nothing in view, status "' + (f && f.text) + '"', f);
      await reopen(p); await sleep(2500);
      const note = await optNoteText(p);
      check(/^Options data updates during US market hours; last update 11 h ago\./.test(note || '') && !/delayed|behind|real-time/i.test(note), w + ' stale: panel note "' + note + '"', note);
      const shotP = OUT + '/hmfix-nq1-options-stale-' + w + '.png';
      await p.screenshot({ path: shotP }); console.log('SHOT ' + shotP);
      if (mobile) { await clickText(p, 'Order book'); await sleep(5000); const c = await heat(p); check(c > 100, '390 NQ1! book draws (' + c + ')'); await p.evaluate(() => window.__stkHeatmapPanel.close()); await sleep(500); await p.screenshot({ path: OUT + '/hmfix-nq1-book-390.png' }); console.log('SHOT ' + OUT + '/hmfix-nq1-book-390.png'); }
      check(errors.length === 0, w + ' stale: no page errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
