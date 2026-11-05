// TICK ENGINE browser test with a FIXTURE hub (tools/tests/tick-engine-hub.py: no Worker, no key, no provider).
//   python3 tools/tests/tick-engine-hub.py 8077 &  node tools/tests/chart-dev-server.mjs 8055 &
//   CHART_BASE=http://127.0.0.1:8055 TE_HUB=http://127.0.0.1:8077 node tools/tests/tick-engine-browser.js <shotsDir>
// /charts NQ 1m in 2 tabs of ONE browser: one socket for both (SharedWorker); both tabs show the same bars as the hub's tape (no gaps, no
// out-of-order times, no double count); switching tabs keeps the socket; the socket is killed -> it comes back, trades missed meanwhile are
// replayed, the bars still equal the tape; 10 reloads -> same bars every time, still one socket. Then the same with ?feed=leader (no
// SharedWorker: BroadcastChannel + Web Lock leader tab). Prints the delivery latency (trade time -> page receive) p50 / p95. Shots at 390 + 1440.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8055', HUB = process.env.TE_HUB || 'http://127.0.0.1:8077', OUT = process.argv[2] || '/tmp/te-shots';
fs.mkdirSync(OUT, { recursive: true });
const V = JSON.parse(fs.readFileSync(__dirname + '/../../assets/version.json', 'utf8')).build;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
const hub = (p) => fetch(HUB + p).then((r) => r.json());

async function open(ctx, feed) {
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html?engine=1' + (feed ? '&feed=' + feed : ''), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await p.evaluate(async (v) => { (await import('/assets/rt-access.js?v=' + v))._rtSetForTests(true, 'test-token'); const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 300)); if (ws.chart.market.symbol === 'futures:NQ1!' && ws.chart.orchestrator.rawBars.length > 30) break; } }, V);
  p.errors = errors;
  return p;
}
// the page's bars vs the hub tape, minute by minute (the forming minute may be a few trades behind: compared up to the last closed minute)
async function compare(p, tag) {
  const got = await p.evaluate(() => window.STRYKER_VELA.chart.orchestrator.rawBars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume]));
  const now = Date.now(), lastClosed = Math.floor((now - 2000) / 60000) * 60000 - 60000;   // closed >= 2 s ago (the stream is ~0.1 s behind the tape)
  const ref = (await hub('/te-bars?sym=NQ&tf=1&from=' + (now - 3 * 3600000) + '&to=' + (lastClosed + 60000))).b.map((b) => b.slice(0, 6));
  const g = got.filter((b) => b[0] >= ref[0][0] && b[0] <= lastClosed), r = ref.filter((b) => b[0] <= lastClosed);
  let ordered = true; for (let i = 1; i < got.length; i++) if (!(got[i][0] > got[i - 1][0])) ordered = false;
  let gaps = 0; for (let i = 1; i < g.length; i++) if (g[i][0] - g[i - 1][0] !== 60000) gaps++;
  const diff = []; for (let i = 0; i < Math.max(g.length, r.length); i++) if (JSON.stringify(g[i]) !== JSON.stringify(r[i])) diff.push([g[i], r[i]]);
  check(ordered, tag + ': times strictly ascending');
  check(gaps === 0, tag + ': no gaps (' + g.length + ' closed minutes)', gaps);
  check(diff.length === 0 && g.length >= 100, tag + ': every closed minute = the hub tape (OHLCV, ' + g.length + ' bars)', diff.slice(0, 3));
  return g;
}
async function suite(b, feed) {
  const label = feed || 'shared';
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((h) => { window.__STK_BOOK_RECORDER = h; try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', 'night'); } catch (e) {} }, HUB);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const s0 = await hub('/stats');
  const A = await open(ctx, feed), B = await open(ctx, feed);
  await sleep(4000);
  let st = await hub('/stats');
  check(st.open === 1, label + ': 2 chart tabs, ONE socket to the hub', st);
  const m = await A.evaluate(async (v) => (await import('/assets/tick-feed.js?v=' + v)).feedStats(), V);
  check(m.mode === label, label + ': feed mode ' + m.mode, m);
  await compare(A, label + ' tab A'); await compare(B, label + ' tab B');
  check(st.protos.length > 0 && st.protos.every((x) => x[0] === 'tz-auth' && x[1]), label + ': the socket uses the tz-auth subprotocol + token', st.protos);
  // every tick consumer gets the engine's trades (chart-futures-l2.js teTicks): the live footprint's forming minute grows in real time
  const lo = async () => A.evaluate(() => { const s = window.tzLiveOfStats('NQ'); return { prints: s.prints, ago: s.lastPrintAgoMs, live: s.live }; });
  const lo1 = await lo(); await sleep(3000); const lo2 = await lo();
  check(lo1.prints > 0 && lo2.prints > lo1.prints && lo2.ago != null && lo2.ago < 3000, label + ': live footprint fed from the engine socket (prints ' + lo1.prints + ' -> ' + lo2.prints + ' in 3 s)', [lo1, lo2]);
  // switch tabs: B to the front, A in the background, 6 s
  await B.bringToFront(); await sleep(6000); await A.bringToFront(); await sleep(1500);
  st = await hub('/stats'); check(st.open === 1 && st.opened - s0.opened === 1, label + ': tab switches keep the same socket', st);
  // kill the socket: the feed reconnects and replays what it missed
  await fetch(HUB + '/kill'); await sleep(6000);
  st = await hub('/stats'); check(st.open === 1, label + ': socket killed -> back, still one', st);
  await compare(A, label + ' after kill A'); await compare(B, label + ' after kill B');
  // 10 reloads of tab B
  let first = null, same = true;
  for (let i = 0; i < 10; i++) {
    await B.reload({ waitUntil: 'domcontentloaded' });
    await B.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
    await B.evaluate(async (v) => { (await import('/assets/rt-access.js?v=' + v))._rtSetForTests(true, 'test-token'); const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 300)); if (ws.chart.orchestrator.rawBars.length > 30) break; } }, V);
    await sleep(1500);
    const g = await B.evaluate(() => window.STRYKER_VELA.chart.orchestrator.rawBars.slice(-120, -2).map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume]));
    if (!first) first = g; else { const k = first.findIndex((x) => x[0] === g[0][0]); const a = first.slice(Math.max(0, k)), c = g.slice(0, a.length); if (k < 0 || JSON.stringify(a.slice(0, c.length - 2)) !== JSON.stringify(c.slice(0, c.length - 2))) same = false; }
  }
  check(same, label + ': 10 reloads -> the same bars every time');
  await sleep(2000);
  st = await hub('/stats'); check(st.open === 1, label + ': after 10 reloads still ONE socket', st);
  await compare(B, label + ' after reloads B');
  const lat = await A.evaluate(async (v) => (await import('/assets/tick-feed.js?v=' + v)).feedStats(), V);
  console.log('LATENCY ' + label + ' (fixture hub on localhost, trade time -> page receive) n=' + lat.latency.n + ' p50=' + lat.latency.p50 + ' ms p95=' + lat.latency.p95 + ' ms');
  check(A.errors.length === 0 && B.errors.length === 0, label + ': no page errors', A.errors.concat(B.errors).slice(0, 3));
  if (!feed) {
    await A.screenshot({ path: OUT + '/te-NQ-1440.png' });
    await A.setViewportSize({ width: 390, height: 844 }); await sleep(1500); await A.screenshot({ path: OUT + '/te-NQ-390.png' });
  }
  // the tab that owns the socket goes away (leader mode: tab A holds the lock): the other tab takes over and still has every trade
  await A.close(); await sleep(6000);
  st = await hub('/stats'); check(st.open === 1, label + ': tab A closed -> tab B still fed by one socket', st);
  await compare(B, label + ' after tab A closed, B');
  await ctx.close(); await sleep(25000);   // the hub socket closes LINGER_MS after the last tab
  st = await hub('/stats'); check(st.open === 0, label + ': all tabs closed -> socket closed', st);
}
(async () => {
  const b = await launch();
  try { await suite(b, ''); await suite(b, 'leader'); } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
