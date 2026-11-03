// Live-from-the-hub browser test with a FIXTURE hub (no Worker, no key).
//   node tools/tests/chart-dev-server.mjs 8055
//   CHART_BASE=http://127.0.0.1:8055 flock /tmp/stryker-chrome.lock node tools/tests/live-hub-browser.js <shotsDir>
// Per symbol (NQ1!, CL1!, SI1! trades-only, SPX index) at 390 and 1440: the last candle moves with the fixture hub's ticks, the chart says Live,
// and NOTHING opens /api/chart/stream (WebSocket or HTTP). Then the hub is killed: within 20 s the status goes to reconnecting + delayed bars, and
// still no /api/chart/stream. Also: a trades-tier account (hub_attached tier 'trades') gets candles but no book button / ladder.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8055', OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
function fakeHub(cfg) {
  window.__stkL2Test = { base: 'http://127.0.0.1:9', trades: cfg.tier === 'trades' };
  window.__wsAll = []; window.__hubDown = false;
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    window.__wsAll.push(String(url));
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    window.__hubWs = ws; const sym = new URL(String(url)).searchParams.get('symbol') || cfg.sym; let n = 0;
    setTimeout(() => {
      if (window.__hubDown) { ws.readyState = 3; ws.onclose && ws.onclose({ code: 1006 }); return; }
      ws.readyState = 1; ws.onopen && ws.onopen(); const send = (o) => ws.onmessage && ws.onmessage({ data: JSON.stringify(o) });
      send({ event: 'hub_attached', state: 'live', tier: cfg.tier }); send({ event: 'status', state: 'live' });
      const m0 = Math.floor(Date.now() / 60000) * 60000, b = [];
      for (let k = 12; k >= 0; k--) { const o = cfg.base + Math.sin(k) * cfg.base * 0.0005; b.push([m0 - k * 60000, o, o + cfg.base * 0.0004, o - cfg.base * 0.0004, o + cfg.base * 0.0001, cfg.quote ? 0 : 100]); }
      send({ type: 'bars', symbol: sym, b });
      ws.iv = setInterval(() => {
        if (window.__hubDown) { clearInterval(ws.iv); ws.readyState = 3; ws.onclose && ws.onclose({ code: 1006 }); return; }
        n++; const p = Math.round((cfg.base * (1 + 0.003 + Math.sin(n / 4) * 0.002 + n * 0.00005)) / cfg.tick) * cfg.tick;
        window.__lastPx = p;
        if (cfg.quote) send({ type: 'quote', symbol: sym, p, ts: Date.now() });
        else send({ type: 'ticks', symbol: sym, t: [[p, 1 + (n % 4), n % 2 ? 1 : -1, Date.now()]] });
      }, 150);
    }, 40);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
const CASES = [
  { id: 'NQ', chart: 'futures:NQ1!', sym: 'NQ', base: 28000, tick: 0.25, tier: 'book' },
  { id: 'CL', chart: 'futures:CL1!', sym: 'CL', base: 60, tick: 0.01, tier: 'book' },
  { id: 'SI', chart: 'futures:SI1!', sym: 'SI', base: 50, tick: 0.005, tier: 'trades' },
  { id: 'SPX', chart: 'idx:SPX', sym: 'SPX', base: 7600, tick: 0.01, tier: 'trades', quote: true }
];
async function run(b, c, w, h, mobile) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(stub); await ctx.addInitScript(fakeHub, c);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); localStorage.setItem('stryker_theme', 'night'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage(), streamReq = [], errors = [];
  p.on('request', (q) => { if (/\/api\/chart\/stream/.test(q.url())) streamReq.push(q.url()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(1500);
  await p.evaluate(async (ch) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(ch); ws.active.setTimeframe('1'); for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); if (ws.chart.market.symbol === ch && ws.chart.orchestrator.rawBars.length > 20) break; } }, c.chart);
  await sleep(3500);
  const last = () => p.evaluate(() => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars, l = rb[rb.length - 1]; return { c: l.close != null ? l.close : l.c, t: l.time != null ? l.time : l.t, px: window.__lastPx, n: rb.length }; });
  const a = await last(); await sleep(1500); const a2 = await last();
  const tag = c.id + '@' + w;
  check(a2.c === a2.px || Math.abs(a2.c - a2.px) < c.tick * 2, tag + ': last candle close follows the hub tick (' + a2.c + ' vs ' + a2.px + ')', [a, a2]);
  check(a.c !== a2.c, tag + ': candle moves between reads', [a, a2]);
  const st = await p.evaluate((s) => ({ fed: !!(window.__stkL2Live && window.__stkL2Live.has(s)), tags: [...document.querySelectorAll('.stkc-dd-t')].map((x) => x.textContent), book: !!document.querySelector('.stkl2-rail-btn:not([hidden]), .stkl2-phone-btn:not([hidden])') }), c.sym);
  check(st.fed, tag + ': hub feeds the chart', st);
  check(st.tags.some((t) => /^Live/.test(t)) && !st.tags.some((t) => /insight|tick-?stream/i.test(t)), tag + ': badge says Live, no vendor name', st.tags);
  if (c.tier === 'trades') check(!st.book, tag + ': trades tier shows no book button', st);
  await p.screenshot({ path: OUT + '/' + c.id + '-' + w + '.png' });
  // fallback: kill the hub
  if (w === 390 && c.id !== 'CL') {
    await p.evaluate(() => { window.__hubDown = true; try { window.__hubWs.close(); } catch (e) {} });
    let ok = false, t0 = Date.now(), info = null;
    while (Date.now() - t0 < 20000) { await sleep(1000); info = await p.evaluate((s) => ({ fed: !!(window.__stkL2Live && window.__stkL2Live.has(s)), tags: [...document.querySelectorAll('.stkc-dd-t')].map((x) => x.textContent) }), c.sym); if (!info.fed) { ok = true; break; } }
    check(ok, tag + ': hub killed -> chart leaves the live state within 20 s (' + Math.round((Date.now() - t0) / 1000) + ' s)', info);
    await sleep(1500);
    info = await p.evaluate(() => [...document.querySelectorAll('.stkc-dd-t')].map((x) => x.textContent));
    check(!info.some((t) => /^Live/.test(t)), tag + ': status no longer Live after the kill: ' + JSON.stringify(info), info);
    await p.screenshot({ path: OUT + '/' + c.id + '-' + w + '-hubdown.png' });
  }
  const ws = await p.evaluate(() => window.__wsAll);
  check(streamReq.length === 0 && !ws.some((u) => /\/api\/chart\/stream/.test(u)), tag + ': nothing opened /api/chart/stream (http ' + streamReq.length + ', ws ' + ws.filter((u) => /chart\/stream/.test(u)).length + ')', { streamReq, ws });
  check(errors.length === 0, tag + ': no page errors', errors);
  await ctx.close();
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const c of CASES) { await run(b, c, 390, 844, true); await run(b, c, 1440, 900, false); }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
