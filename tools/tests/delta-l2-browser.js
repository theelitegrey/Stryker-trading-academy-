// Delta (L2) in a browser with a FIXTURE hub ticking ~10 trades/s (no Worker, no key): NQ1! 1m at 412 and 1440, dark.
//   node tools/tests/chart-dev-server.mjs 8022
//   CHART_BASE=http://127.0.0.1:8022 flock -w 3600 /tmp/stryker-chrome.lock node tools/tests/delta-l2-browser.js <shotsDir>
// Checks: the forming bar's numbers change between two reads 1 s apart; the live part makes no REST request (/orderflow, /ts-aux) after the
// first load; redraws stay <= ~6/s; hidden tab = no redraws, back = gap read; the existing Delta moves live too; no console errors; no overflow.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8022';
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

const FP = minutes.map((x) => ({ t: x.m, lv: x.bs.map((b, j) => [Math.round(x.lo / TICK) * TICK + j * TICK, b, x.ss[j]]).filter((r) => r[1] || r[2]) }));

function fakeWs() {
  window.__wsOpened = 0; window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    window.__wsOpened++;
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) }); }, 50);
    let n = 0, seed = 5;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    ws.iv = setInterval(() => {   // ~10 trades a second: a frame of 2-3 every 250 ms
      if (ws.readyState !== 1 || !ws.onmessage) return; n++;
      const now = Date.now(), mid = Math.floor((window.__L2MID || 28650) * 4) / 4, t = [];
      for (let k = 0; k < 2 + (n % 2); k++) { const buy = rnd() < 0.55; t.push([mid + Math.round((rnd() - 0.5) * 14) * 0.25, 1 + Math.floor(rnd() * 12), buy ? 1 : -1, now]); }
      ws.onmessage({ data: JSON.stringify({ type: 'snap', symbol: 'NQ', ts: now, bids: [[mid, 10]], asks: [[mid + 0.25, 10]], imb: 0, imb10: 0 }) });
      ws.onmessage({ data: JSON.stringify({ type: 'ticks', symbol: 'NQ', t }) });
    }, 250);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
async function open(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeWs);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const reqs = [];
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => {
    const rows = minutes.map((x) => [x.m * 60, x.o, x.hi, x.lo, x.c, x.buy + x.sell]);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page: 0, bars: rows }) });
  });
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/orderflow/, (r) => { reqs.push({ t: Date.now(), u: 'orderflow' }); r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: OF }); });
  await ctx.route(/127\.0\.0\.1:9\/ts-aux/, (r) => { reqs.push({ t: Date.now(), u: 'ts-aux' }); r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ imb: [], fp: FP }) }); });
  await ctx.route(/127\.0\.0\.1:9\/(?!ts-aux)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
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
const h1 = (p, type) => p.evaluate((t) => (window.__dsH1 && window.__dsH1.type === t ? Object.assign({}, window.__dsH1) : null), type);
const zoom = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.chart; const rb = c.orchestrator.rawBars, n = rb.length; c.setVisibleRange({ from: rb[Math.max(0, n - 60)].time, to: rb[n - 1].time + 120000 }); });
const vis = (p, hidden) => p.evaluate((h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, tag] of [[1440, 900, false, '1440'], [412, 860, true, '412']]) {
      const { ctx, p, errors, reqs } = await open(b, { w, h, mobile });
      await setNQ(p);
      await add(p, 'stk_ts_dsuite', { style: 'H1 Session delta profile' });
      await add(p, 'stk_ts_dpane', { style: 'V1 Delta bars' });
      await sleep(3000);
      const inds = await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.indicators().map((x) => x.nativeType));
      check(inds.includes('stk_ts_dsuite') && inds.includes('stk_ts_dpane'), tag + ': both L2 indicators on the chart', inds);
      check((await p.evaluate(() => window.__wsOpened)) === 1, tag + ': ONE hub socket');
      await zoom(p); await sleep(1500);
      const nReq0 = reqs.length, t0 = Date.now();
      const A = await h1(p, 'stk_ts_dsuite'); await p.screenshot({ path: OUT + '/delta-l2-' + tag + '-a.png' });
      await sleep(1000);
      const B = await h1(p, 'stk_ts_dsuite'); await p.screenshot({ path: OUT + '/delta-l2-' + tag + '-b.png' });
      console.log('INFO ' + tag + ' A ' + JSON.stringify(A) + ' B ' + JSON.stringify(B));
      check(A && B && (A.net !== B.net || A.topBuy !== B.topBuy || A.topSell !== B.topSell), tag + ': profile numbers changed 1 s apart (net / top buy / top sell)', [A, B]);
      const live = () => p.evaluate(() => window.__dsLive || 0);
      const d0 = await live(); await sleep(5000); const d1 = await live();
      const rate = (d1 - d0) / 5;
      check(rate >= 1 && rate <= 11, tag + ': hub-driven renders ' + rate.toFixed(1) + '/s (2 indicators, each at most ~5/s: 1-11)', rate);
      check(reqs.length === nReq0, tag + ': no REST request in the ' + Math.round((Date.now() - t0) / 1000) + ' s live window', reqs.slice(nReq0));
      const before = await live();
      await vis(p, true); await sleep(2500); const mid = await live();
      check(mid - before <= 1, tag + ': hidden tab: no renders (' + (mid - before) + ')', [before, mid]);
      const r0 = reqs.length;
      await vis(p, false); await sleep(1500);
      check(reqs.length > r0 && reqs[reqs.length - 1].u === 'ts-aux', tag + ': back in the tab: the gap is back-filled', reqs.slice(r0));
      check((await live()) > mid, tag + ': renders resume');
      check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ': no horizontal overflow');
      await p.screenshot({ path: OUT + '/delta-l2-' + tag + '-final.png' });
      check(errors.length === 0, tag + ': no console errors', errors);
      await ctx.close();
    }
    {   // the existing Delta takes the hub ticks on a hub symbol
      const { ctx, p, errors } = await open(b, { w: 412, h: 860, mobile: true });
      await setNQ(p);
      await add(p, 'stk_dsuite', { style: 'H1 Session delta profile' });
      await sleep(3500); await zoom(p); await sleep(1200);
      const A = await h1(p, 'stk_dsuite'); await sleep(1000); const B = await h1(p, 'stk_dsuite');
      console.log('INFO delta(existing) A ' + JSON.stringify(A) + ' B ' + JSON.stringify(B));
      check(A && B && A.net !== B.net, 'existing Delta: the forming bar moves live (no 5 s wait)', [A, B]);
      await p.screenshot({ path: OUT + '/delta-existing-412.png' });
      check(errors.length === 0, 'existing Delta: no console errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
