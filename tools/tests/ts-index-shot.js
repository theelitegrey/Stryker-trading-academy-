// Fixture shot: a 1m chart whose current candle follows 'quote' frames (the SPX path). STAND-IN: the chart catalog has no SPX
// series yet, so the ES chart is fed quote frames with SPX-like levels; this proves the mechanism (candle moves, volume 0, no delayed pill).
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/ts-index-shot.js <dir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031', OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fakeWs() {
  window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    let n = 0; const base = window.__LVL || 7600;
    setTimeout(() => {
      ws.readyState = 1; ws.onopen && ws.onopen(); const send = (o) => ws.onmessage({ data: JSON.stringify(o) });
      send({ event: 'status', state: 'live' });
      const m0 = Math.floor(Date.now() / 60000) * 60000, b = [];
      for (let k = 12; k >= 0; k--) { const o = base + Math.sin(k) * 5; b.push([m0 - k * 60000, o, o + 4, o - 4, o + 1.5, 0]); }
      send({ type: 'bars', symbol: 'ES', b });
      ws.iv = setInterval(() => { n++; send({ type: 'quote', symbol: 'ES', p: base + 8 + Math.sin(n / 3) * 9 + n * 0.15, ts: Date.now() }); }, 150);
    }, 50);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addInitScript(stub); await ctx.addInitScript(fakeWs);
    await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); localStorage.setItem('stryker_theme', 'night'); } catch (e) {} });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
    await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
    const p = await ctx.newPage(), errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
    await sleep(2000);
    await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:ES1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); if (ws.chart.market.symbol === 'futures:ES1!' && ws.chart.orchestrator.rawBars.length > 50) break; } });
    await sleep(4000);
    const r = await p.evaluate(() => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars, l = rb[rb.length - 1]; return { fed: !!(window.__stkL2Live && window.__stkL2Live.has('ES')), vol: l.volume != null ? l.volume : l.v, c: l.close != null ? l.close : l.c, pill: !!(document.getElementById('stkdp') && !document.getElementById('stkdp').hidden) }; });
    console.log(JSON.stringify(r), 'errors', errors.length);
    await p.screenshot({ path: OUT + '/ts-index-1m-390-dark.png' });
    await ctx.close();
  } finally { await b.close(); }
})();
