// Futures DOM (L2) heatmap with the market CLOSED (Owner bug 2026-11-07: "Heatmap not loading?" on a Saturday).
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/heatmap-closed-browser.js <shotsDir>
// FIXTURE data only: the page clock is pinned to Saturday 14:30 UTC; NQ 1m bars end Friday 21:59 UTC (CME close); the fake /ts-live
// hub says state 'idle' (no snaps, no ticks); /ts-book-history holds one sample a minute from Friday 12:00 to 21:59 UTC.
// Checks (1440 + 390 dark, Midnight + Classic): heatmap columns are drawn from Friday's samples, the history is asked for Friday
// (not only the last 6 h of the clock), the note says "Market closed" (never "Reconnecting"), no console errors.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 500) : '')); };

const NOW = Date.parse('2026-11-07T14:30:00Z');            // Saturday
const LAST = Date.parse('2026-11-06T21:59:00Z');           // Friday, the minute before the 17:00 ET close
const FIRST = Date.parse('2026-11-06T12:00:00Z'), TICK = 0.25;
const price = (m) => 25600 + Math.sin(m / 17) * 30 + Math.sin(m / 5) * 7;
const BARS = [];
for (let t = LAST - 300 * 60000; t <= LAST; t += 60000) {
  const m = t / 60000, o = Math.round(price(m) / TICK) * TICK, c = Math.round(price(m + 1) / TICK) * TICK;
  BARS.push([t / 1000, o, Math.max(o, c) + 3, Math.min(o, c) - 3, c, 400 + (m % 7) * 30]);
}

function fakeWs() {
  window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  try { document.documentElement.setAttribute('data-theme', 'dark'); } catch (e) {}
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    const send = (o) => ws.onmessage && ws.onmessage({ data: JSON.stringify(o) });
    // the hub on a weekend: attached, tier book, no data, state idle (ts-hub.js liveState: open socket + CME closed = 'idle')
    setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); send({ event: 'hub_attached', state: 'idle', tier: 'book', symbols: ['NQ'], trades: ['NQ'] }); send({ event: 'status', state: 'idle', ageMs: -1 }); }, 50);
    ws.iv = setInterval(() => { if (ws.readyState === 1) send({ event: 'ping', up: -1, state: 'idle' }); }, 1000);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
async function open(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile, colorScheme: 'dark' });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeWs);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page: 0, bars: BARS }) }));
  const asked = [];
  await ctx.route(/127\.0\.0\.1:9\/ts-book-history/, async (r) => {
    const { encodeSamples } = await import('../../workers/book-recorder/src/bucket.js');
    const u = new URL(r.request().url()), from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to')), out = [];
    asked.push([from, to]);
    for (let t = Math.ceil(Math.max(from, FIRST) / 60000) * 60000; t <= Math.min(to, LAST); t += 60000) {
      const mid = price(t / 60000), step = 2.5, i0 = Math.floor(mid * 0.98 / step), len = Math.ceil(mid * 0.04 / step) + 2, v = new Float32Array(len);
      for (let k = 0; k < len; k++) { const p = (i0 + k + 0.5) * step, d = Math.abs(p - mid), hh = Math.abs(Math.sin((i0 + k) * 12.9898) * 43758.5453) % 1; const q = Math.exp(1.2 + 2.4 * hh * hh) * (1 + 1.5 * Math.exp(-d / 120)) + (Math.abs(d - 30) < 2 ? 1500 : 0); v[k] = p < mid ? q : -q; }
      out.push({ ts: t, mid, bb: mid - 0.25, ba: mid + 0.25, step, i0, v });
    }
    r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'x-ts-fill-left': '0', 'access-control-expose-headers': 'x-ts-fill-left' }, body: Buffer.from(encodeSamples(out)) });
  });
  await ctx.route(/127\.0\.0\.1:9\/(?!ts-book-history)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage(), errors = [];
  await p.clock.install({ time: new Date(NOW) });
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|\/api\/chart\/stream|Failed to load resource|Ping received after close/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(1500);
  await p.evaluate(async () => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1');
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === 'futures:NQ1!' && c.orchestrator.rawBars.length > 50) break; }
  });
  return { ctx, p, errors, asked };
}
const notes = (p) => p.evaluate(() => String(window.__stkL2Note));   // the note chart-futures-l2.js last drew (top right)

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });   // software GL: the default heatmap path draws in the shots
  try {
    for (const [w, h, mobile, vp] of [[1440, 900, false, '1440'], [390, 844, true, '390']]) {
      for (const look of ['Midnight', 'Classic', 'depth']) {
        const tag = vp + '-dark-' + look;
        const { ctx, p, errors, asked } = await open(b, { w, h, mobile });
        await p.evaluate((look) => { const c = window.STRYKER_VELA.context().cells[0].chart; if (look === 'depth') c.addNativeIndicator('stk_depth_heat', {}); else c.addNativeIndicator('stk_fut_dom', { inputs: { look } }); window.STRYKER_VELA.context().stateChanged(); }, look);
        await sleep(9000);
        if (look === 'depth') {   // Depth Heatmap (L2), chart-depth-heatmap.js: the same feed, its own note
          const dh = await p.evaluate(() => window.__stkFlow.dhDebug && window.__stkFlow.dhDebug());
          check(asked.length && asked[0][1] <= LAST + 5 * 60000, tag + ': first read starts at the close', asked.slice(0, 2).map((x) => x.map((y) => new Date(y).toISOString().slice(5, 16))));
          check(dh && dh.samples > 10 && dh.heat && dh.heat.cells > 100, tag + ': depth heatmap drawn from Friday', dh && { s: dh.samples, heat: dh.heat });
          const dn = await p.evaluate(() => String(window.__stkDhNote));
          check(/Market closed/.test(dn) && !/Reconnecting/.test(dn), tag + ': note says market closed', dn);
          await p.screenshot({ path: OUT + '/heatmap-closed-' + tag + '.png' });
          check(errors.length === 0, tag + ': no console errors', errors);
          await ctx.close(); continue;
        }
        const d = await p.evaluate(() => window.__stkFlow && window.__stkFlow.domDebug && window.__stkFlow.domDebug());
        const lastBar = await p.evaluate(() => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars; return rb[rb.length - 1].time; });
        check(lastBar <= LAST + 60000, tag + ': fixture bars end Friday', new Date(lastBar).toISOString());
        check(asked.some(([f, t]) => f < LAST && t > FIRST), tag + ': history is asked for Friday', asked.map((x) => x.map((y) => new Date(y).toISOString().slice(5, 16))));
        check(asked.length && asked[0][1] <= LAST + 5 * 60000, tag + ': first read starts at the end of the data (the close), not at the clock', asked.slice(0, 2).map((x) => x.map((y) => new Date(y).toISOString().slice(5, 16))));
        check(d && d.samples > 30, tag + ': Friday book samples in the frame', d && { s: d.samples, rs: d.remoteSamples, st: d.remoteState });
        check(d && (d.columns > 10 || (d.bm && d.bm.cells > 500)) && d.cells > 100, tag + ': heatmap columns drawn', d && { cols: d.columns, cells: d.cells, bm: d.bm && d.bm.cells });
        if (look === 'Midnight') {   // the GL field must be on screen: vela-chart.js hid it with the empty 2D layer canvas (found 2026-11-07)
          const glv = await p.evaluate(() => { const c = document.querySelector('canvas[data-stk-heatmap-gl]'); return c ? getComputedStyle(c).visibility + '/' + getComputedStyle(c).display : 'none'; });
          check(glv === 'visible/block', tag + ': GL heatmap canvas is visible', glv);
        } else check(d.heatX0 != null && d.heatX0 <= 60, tag + ': heatmap starts at the left edge', d.heatX0);
        const n = await notes(p);
        check(/Market closed/.test(n) && !/Reconnecting/.test(n), tag + ': note says market closed, not reconnecting', n);
        await p.screenshot({ path: OUT + '/heatmap-closed-' + tag + '.png' });
        check(errors.length === 0, tag + ': no console errors', errors);
        await ctx.close();
      }
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
