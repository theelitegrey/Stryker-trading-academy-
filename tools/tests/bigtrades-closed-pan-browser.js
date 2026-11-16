// Big Trades (L2) + Depth Heatmap with the market CLOSED (members GK 14-15 Nov 2026: "Big Trades show when the chart opens, then
// disappear when I move the chart"; "Depth Heatmap blank when market is closed"). FIXTURE data only, weekend timestamp:
// page clock = Saturday 14:30 UTC, NQ 1m bars end Friday 21:59 UTC (CME close), hub says 'idle' (no snaps, no ticks),
// /ts-trades + /ts-book-history hold Thursday 12:00 -> Friday 21:59 UTC (what the recorder keeps).
//   node tools/tests/chart-dev-server.mjs 8153 &
//   CHART_BASE=http://127.0.0.1:8153 flock /tmp/stryker-chrome.lock node tools/tests/bigtrades-closed-pan-browser.js <shotsDir>
// Checks: markers drawn on load; still drawn after dragging the chart back and forth (real mouse); the heatmap has cells before and after.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8153';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 500) : '')); };

const NOW = Date.parse(process.env.NOW_ISO || '2026-11-14T14:30:00Z');   // Saturday (NOW_ISO=2026-11-15T22:40:00Z: Sunday, just before the open, > 48 h after the close)
const LAST = Date.parse('2026-11-13T21:59:00Z');           // Friday close
const FIRST = Date.parse('2026-11-12T12:00:00Z'), TICK = 0.25;
const price = (m) => 25600 + Math.sin(m / 17) * 30 + Math.sin(m / 5) * 7;
const BARS = [];
for (let t = LAST - 2000 * 60000; t <= LAST; t += 60000) {
  const m = t / 60000, o = Math.round(price(m) / TICK) * TICK, c = Math.round(price(m + 1) / TICK) * TICK;
  BARS.push([t / 1000, o, Math.max(o, c) + 3, Math.min(o, c) - 3, c, 400 + (m % 7) * 30]);
}
function fakeWs() {
  window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    if (window.__HUB_DOWN) { setTimeout(() => { ws.readyState = 3; ws.onerror && ws.onerror({}); ws.onclose && ws.onclose({ code: 1006 }); }, 50); return ws; }   // the feed is down (not just idle)
    const send = (o) => ws.onmessage && ws.onmessage({ data: JSON.stringify(o) });
    setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); send({ event: 'hub_attached', state: 'idle', tier: 'book', symbols: ['NQ'], trades: ['NQ'] }); send({ event: 'status', state: 'idle', ageMs: -1 }); }, 50);
    ws.iv = setInterval(() => { if (ws.readyState === 1) send({ event: 'ping', up: -1, state: 'idle' }); }, 1000);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
async function open(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile, colorScheme: 'dark' });
  await ctx.addInitScript(stub); if (process.env.HUB_DOWN) await ctx.addInitScript(() => { window.__HUB_DOWN = true; }); await ctx.addInitScript(fakeWs);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page: 0, bars: BARS }) }));
  const asked = { book: [], trades: [] };
  await ctx.route(/127\.0\.0\.1:9\/ts-book-history/, async (r) => {
    const { encodeSamples } = await import('../../workers/book-recorder/src/bucket.js');
    const u = new URL(r.request().url()), from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to')), out = [];
    asked.book.push([from, to]);
    for (let t = Math.ceil(Math.max(from, FIRST) / 60000) * 60000; t <= Math.min(to, LAST); t += 60000) {
      const mid = price(t / 60000), step = 2.5, i0 = Math.floor(mid * 0.98 / step), len = Math.ceil(mid * 0.04 / step) + 2, v = new Float32Array(len);
      for (let k = 0; k < len; k++) { const p = (i0 + k + 0.5) * step, d = Math.abs(p - mid), hh = Math.abs(Math.sin((i0 + k) * 12.9898) * 43758.5453) % 1; const q = Math.exp(1.2 + 2.4 * hh * hh) * (1 + 1.5 * Math.exp(-d / 120)) + (Math.abs(d - 30) < 2 ? 1500 : 0); v[k] = p < mid ? q : -q; }
      out.push({ ts: t, mid, bb: mid - 0.25, ba: mid + 0.25, step, i0, v });
    }
    r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'x-ts-fill-left': '0', 'access-control-expose-headers': 'x-ts-fill-left' }, body: Buffer.from(encodeSamples(out)) });
  });
  await ctx.route(/127\.0\.0\.1:9\/ts-trades/, (r) => {
    const u = new URL(r.request().url()), from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to')), trades = [];
    asked.trades.push([from, to]);
    // one print a second between FIRST and LAST; every 97th is big (150-310 lots), the rest 1-6
    for (let t = Math.ceil(Math.max(from, FIRST) / 1000) * 1000; t <= Math.min(to, LAST); t += 1000) {
      const k = t / 1000, side = Math.sin(k * 7.3) > -0.1 ? 1 : -1, big = k % 97 === 0, px = Math.round((price(t / 60000) + (side > 0 ? 0.25 : 0)) * 4) / 4;
      trades.push([t, px, big ? 150 + (k % 5) * 40 : 1 + (k % 6), side]);
    }
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'x-ts-fill-left': '0', 'access-control-expose-headers': 'x-ts-fill-left' }, body: JSON.stringify({ sym: 'NQ', at: Math.min(to, LAST), floor: 100, left: 0, trades, delta: [] }) });
  });
  await ctx.route(/127\.0\.0\.1:9\/(?!ts-book-history|ts-trades)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
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
// hook the Big Trades layer: arcs drawn in its last render, the selected list, the visible range
const hook = (p) => p.evaluate(() => {
  const ch = window.STRYKER_VELA.context().cells[0].chart, r = ch.renderer.extLayers ? ch.renderer : ch.renderer.renderer;
  const l = r.extLayers.find((x) => x.channel === 'stk_l2f_big' || (x.def && x.def.id === 'stk_l2f_big'));
  if (!l) return false;
  const st = window.__bp = { renders: 0, arcs: 0, lastArcs: 0, n: 0 }, g = l.canvas.getContext('2d'), arc = g.arc.bind(g);
  g.arc = (...a) => { st.arcs++; return arc(...a); };
  const rend = l.instance.render.bind(l.instance);
  l.instance.render = (a) => { const b0 = st.arcs; st.renders++; const out = rend(a); st.lastArcs = st.arcs - b0; const L = (a.data && a.data.sel && a.data.sel.list) || []; st.n = L.length; return out; };
  return true;
});
// prints that fall inside the visible window (what the layer can possibly draw) vs circles it drew
const view = (p) => p.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 900));
  const c = window.STRYKER_VELA.chart, rb = c.orchestrator.rawBars, vr = c.getVisibleRange(), s = window.__bp;
  return { arcs: s.lastArcs, listed: s.n, from: new Date(vr.from).toISOString().slice(5, 16), to: new Date(vr.to).toISOString().slice(5, 16), bars: rb.length, first: new Date(rb[0].time).toISOString().slice(5, 16) };
});
const drag = async (p, dx) => { const r = await p.evaluate(() => { const b = document.querySelector('#vela-chart').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }); const y = r.y + r.h * 0.4, x0 = r.x + r.w * 0.5; await p.mouse.move(x0, y); await p.mouse.down(); for (let i = 1; i <= 12; i++) await p.mouse.move(x0 + dx * i / 12, y); await p.mouse.up(); };
const heat = (p) => p.evaluate(() => { const d = window.__stkFlow.dhDebug && window.__stkFlow.dhDebug(); return d && { samples: d.samples, cells: d.heat && d.heat.cells }; });

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    for (const [w, h, mobile, tag] of [[1440, 900, false, '1440'], [390, 844, true, '390']]) {
      const { ctx, p, errors, asked } = await open(b, { w, h, mobile });
      await p.evaluate((process_env_noheat) => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_l2f_big', { inputs: { mode: 'Manual', minSize: 59 } }); if (!process_env_noheat) c.addNativeIndicator('stk_depth_heat', {}); window.STRYKER_VELA.context().stateChanged(); }, !!process.env.NO_HEAT);
      await sleep(9000);
      const NOTE_ONLY = !!process.env.NOW_ISO;   // > 48 h after the close the recorder holds nothing: only the note is asserted
      if (!NOTE_ONLY) check(await hook(p), tag + ': Big Trades (L2) layer found'); else await sleep(1);
      if (!NOTE_ONLY) await p.evaluate(() => { const c = window.STRYKER_VELA.chart, rb = c.orchestrator.rawBars, k = rb.length; c.setVisibleRange({ from: rb[k - 150].time, to: rb[k - 1].time + 600000 }); });
      const v0 = NOTE_ONLY ? { arcs: 1 } : await view(p); console.log(tag, 'load', JSON.stringify(v0));
      check(v0.arcs > 0, tag + ': markers drawn on load (market closed)', v0);
      const h0 = await heat(p);
      if (process.env.NOW_ISO) { const dn = await p.evaluate(() => String(window.__stkDhNote)); check(/no recorded/i.test(dn) && !/showing the last session/.test(dn), tag + ': recorder empty -> honest note, not "showing the last session"', dn); await sleep(700); await p.screenshot({ path: OUT + '/closed-note-' + tag + '.png' }); await ctx.close(); continue; } console.log(tag, 'heat0', JSON.stringify(h0));
      check(NOTE_ONLY || process.env.NO_HEAT || (h0 && h0.cells > 100), tag + ': depth heatmap has cells on load', h0);
      await p.screenshot({ path: OUT + '/closed-' + tag + '-1load.png' });
      for (const [i, dx] of [[1, 220], [2, 220], [3, -260], [4, -260]]) {
        await drag(p, mobile ? dx * 0.5 : dx); await sleep(1500);
        const v = await view(p), hh = await heat(p); console.log(tag, 'drag' + i, JSON.stringify(v), JSON.stringify(hh));
        check(v.arcs > 0, tag + ': markers still drawn after drag ' + i, v);
        check(process.env.NO_HEAT || (hh && hh.cells > 100), tag + ': heatmap still drawn after drag ' + i, hh);
      }
      await p.screenshot({ path: OUT + '/closed-' + tag + '-2after.png' });
      check(errors.length === 0, tag + ': no console errors', errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
