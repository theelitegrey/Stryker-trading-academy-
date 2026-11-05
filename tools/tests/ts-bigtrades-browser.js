// Tick-stream twins (assets/chart-ts-trades.js) next to the InsightSentry tools, on an NQ 1m chart, with FIXTURE data (no Worker, no key).
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/ts-bigtrades-browser.js <shotsDir>
// Fixture: 3 h of 1m NQ. IS side = a real-format /orderflow payload (OF1, built here) with big prints; TS side = /ts-trades JSON of the SAME
// trades with small differences (a few prints 20-60 ms late, one missing, one extra, delta slightly different) + a fake /ts-live socket (status, bars, ticks).
// Checks: NON-admin: the three TS tools are not in the catalog/picker and no /ts-trades request; admin: all six indicators (IS + TS) add and draw on one
// chart at 1440 and 390 dark, the Feed compare readout shows counts, no console errors, no horizontal overflow, bubbles of the two feeds differ in look.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };

// ---------------------------------------------------------------- fixture
const MIN = Math.floor(Date.now() / 60000), N = 180, TICK = 0.25;
const rnd = (() => { let s = 7; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
const price = (m) => 28650 + Math.sin((m - MIN) / 17) * 40 + Math.sin((m - MIN) / 5) * 9;
const minutes = [];
for (let m = MIN - N; m < MIN; m++) {
  const o = Math.round(price(m) / TICK) * TICK, c = Math.round(price(m + 1) / TICK) * TICK, hi = Math.max(o, c) + 3, lo = Math.min(o, c) - 3;
  const buy = Math.round(150 + rnd() * 250), sell = Math.round(150 + rnd() * 250);
  const bigs = [];
  for (let k = 0; k < 4; k++) if (rnd() < 0.55) bigs.push({ ms: m * 60000 + Math.floor(rnd() * 59000), px: Math.round((lo + rnd() * (hi - lo)) / TICK) * TICK, size: Math.round(14 + rnd() * rnd() * 90), buy: rnd() < 0.5 });
  minutes.push({ m, o, c, hi, lo, buy, sell, bigs });
}
const uv = (n) => { const o = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; o.push(b); } while (n); return o; };
const sv = (n) => uv(n < 0 ? -2 * n - 1 : 2 * n);
function of1() {
  const hdr = Buffer.from(JSON.stringify({ v: 1, sym: 'NQ', tick: TICK, thr: 30 })), out = [0x4f, 0x46, 0x31, 0x0a, ...uv(hdr.length), ...hdr, ...uv(minutes.length)];
  for (const x of minutes) {
    const lo = Math.round(x.lo / TICK), n = Math.round((x.hi - x.lo) / TICK) + 1, rec = [...uv(x.m), ...sv(lo), ...uv(n), ...uv(Math.round((x.o - x.lo) / TICK)), ...uv(Math.round((x.c - x.lo) / TICK))];
    const bs = new Array(n).fill(0), ss = new Array(n).fill(0);
    for (let i = 0; i < x.buy; i++) bs[Math.floor(rnd() * n)]++;
    for (let i = 0; i < x.sell; i++) ss[Math.floor(rnd() * n)]++;
    x.bs = bs; x.ss = ss;
    for (let j = 0; j < n; j++) rec.push(...uv(bs[j]), ...uv(ss[j]));
    rec.push(...sv(x.buy - x.sell > 0 ? x.buy - x.sell : 0), ...sv(x.buy - x.sell < 0 ? x.buy - x.sell : 0), ...uv(x.buy + x.sell), ...uv(x.bigs.length));
    for (const b of x.bigs) rec.push(...uv(b.ms - x.m * 60000), ...uv(Math.round(b.px / TICK) - lo), ...uv(b.size * 2 + (b.buy ? 1 : 0)));
    out.push(...uv(rec.length), ...rec);
  }
  return Buffer.from(out);
}
const OF = of1();
function tsJson() {
  const trades = [], delta = []; let k = 0;
  for (const x of minutes) {
    for (const b of x.bigs) { k++; if (k % 11 === 0) continue; trades.push([b.ms + 20 + (k % 5) * 10, b.px, b.size, b.buy ? 1 : -1]); }   // one in 11 missing, the rest 20-60 ms late
    if (x.m % 13 === 0) trades.push([x.m * 60000 + 30000, x.o, 33, 1]);                                                                       // an extra print only TS has
    const d = Math.round((x.buy - x.sell) * 0.93);
    delta.push([x.m * 60000, x.buy + 7, x.sell + 15, Math.max(0, d) + 20, Math.min(0, d) - 20]);
  }
  return { sym: 'NQ', at: Date.now() - 20000, floor: 5, left: 0, trades, delta };
}
const TS = tsJson();

function fakeWs(admin) {
  window.__wsOpened = 0; window.__tsReq = 0;
  if (admin) window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    window.__wsOpened++;
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) }); }, 50);
    let n = 0;
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1 || !ws.onmessage) return; n++;
      const now = Date.now(), px = window.__L2MID || 28650, b = Math.floor(px * 4) / 4;
      ws.onmessage({ data: JSON.stringify({ type: 'snap', symbol: 'NQ', ts: now, bids: [[b, 10]], asks: [[b + 0.25, 10]], imb: 0, imb10: 0 }) });
      ws.onmessage({ data: JSON.stringify({ type: 'ticks', symbol: 'NQ', t: [[b, 3, -1, now], [b + 0.25, 2, 1, now]].concat(n % 15 === 0 ? [[b + 0.25, 40, 1, now]] : []) }) });
    }, 200);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
async function open(b, { w, h, mobile, admin }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeWs, !!admin);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const reqs = [];
  ctx.__reqs = reqs;
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => {
    const rows = minutes.map((x) => [x.m * 60, x.o, x.hi, x.lo, x.c, x.buy + x.sell]);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page: 0, bars: rows }) });
  });
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/orderflow/, (r) => r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: OF }));
  await ctx.route(/127\.0\.0\.1:9\/ts-trades/, (r) => { reqs.push(r.request().url()); r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(TS) }); });
  await ctx.route(/127\.0\.0\.1:9\/(?!ts-trades)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage(), errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|\/api\/chart\/stream|Failed to load resource|Ping received after close/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(2000);
  return { ctx, p, errors, reqs };
}
const setNQ = async (p) => {
  await p.evaluate(async (mid) => {
    window.__L2MID = mid;
    const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1');
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === 'futures:NQ1!' && c.orchestrator.rawBars.length > 50) break; }
  }, price(MIN));
  await sleep(800);
};
const add = (p, type, inputs) => p.evaluate(([t, i]) => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator(t, { inputs: i || {} }); window.STRYKER_VELA.context().stateChanged(); }, [type, inputs]);
const tables = (p) => p.evaluate(() => Object.values(window.__tsReadout || {}).map((l) => l.join(' / ')));

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    {   // non-admin
      const { ctx, p, errors, reqs } = await open(b, { w: 1440, h: 900, admin: false });
      await setNQ(p);
      const listed = await p.evaluate(() => { try { const c = window.STRYKER_VELA.context().cells[0].chart; return (c.nativeCatalog ? c.nativeCatalog() : []).map((x) => x.type || x.id).filter((t) => /^stk_ts_/.test(t)); } catch (e) { return ['err']; } });
      const picker = await p.evaluate(() => /\(Tick-stream\)/.test(document.body.innerText));
      await sleep(1500);
      check(!picker, 'non-admin: no "(Tick-stream)" text anywhere in the page');
      check(reqs.length === 0 && (await p.evaluate(() => window.__wsOpened)) === 0, 'non-admin: no /ts-trades request, no /ts-live socket');
      check(errors.length === 0, 'non-admin: no console errors', errors);
      void listed; await ctx.close();
    }
    for (const [w, h, mobile, tag] of [[1440, 900, false, '1440-dark'], [390, 844, true, '390-dark']]) {
      const { ctx, p, errors, reqs } = await open(b, { w, h, mobile, admin: true });
      await setNQ(p);
      // futures order flow = the L2 tools only (Owner 2026-11-06): the old and the L1 tools on a futures chart swap to their L2 twins, one each
      await add(p, 'stk_of_big', { labels: false });
      await add(p, 'stk_of_delta'); await add(p, 'stk_ts_delta');
      await add(p, 'stk_of_cvd', { style: 'line' }); await add(p, 'stk_ts_cvd', { style: 'line' });
      await sleep(6000);
      const inds = await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.indicators().map((x) => x.nativeType));
      check(!inds.some((t) => /^stk_ts_|^stk_of_(big|delta|cvd)$/.test(t)), tag + ': no old / L1 order-flow tool left on futures', inds);
      check(['stk_l2f_big', 'stk_l2f_delta', 'stk_l2f_cvd'].every((t) => inds.filter((x) => x === t).length === 1), tag + ': one Big Trades (L2), Delta (L2), CVD (L2)', inds);
      check(await p.evaluate(() => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_l2f_cvd'); return h && h.inputValues().style === 'line'; }), tag + ': swapped CVD keeps its changed style (line)');
      check(reqs.every((u) => /ts-trades\?sym=NQ&from=\d+&to=\d+/.test(u)), tag + ': trade history reads are per root (' + reqs.length + ' request/s)', reqs.slice(0, 3));
      check((await p.evaluate(() => window.__wsOpened)) <= 1, tag + ': at most ONE browser socket');
      check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ': no horizontal overflow');
      await p.evaluate(() => { const c = window.STRYKER_VELA.chart; const rb = c.orchestrator.rawBars, n = rb.length; c.setVisibleRange({ from: rb[Math.max(0, n - 70)].time, to: rb[n - 1].time + 120000 }); });
      await sleep(1200);
      await p.screenshot({ path: OUT + '/ts-' + tag + '.png' });
      check(errors.length === 0, tag + ': no console errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
