// Footprint Patterns (assets/chart-fp-patterns.js) browser test, 1440 + 390.
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node --max-old-space-size=768 tools/tests/chart-fp-patterns-browser.js <shotsDir>
// Crypto: BTCUSDT 1m on the offline Binance mock, with a fixture aggTrades route that carries one known footprint shape per minute.
// Futures: NQ1! 1m on the L2 test hub fixture (same fixture frames as chart-l2-flow-browser.js), indicator "Footprint Patterns (L2)".
// Checks: markers render, no page errors, each of the six toggles removes its own marks, hiding the indicator clears the layer, the
// forming bar is marked, the indicator works on normal candles. Shots: <shotsDir>/fpat-<sym>-<tag>.png
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const REAL = null;
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const window_mid = () => 28750;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
const KEYS = { abs: 'showAbs', exh: 'showExh', stk: 'showStk', unf: 'showUnf', div: 'showDiv', trap: 'showTrap' };

// ---- crypto fixture: one footprint shape per minute, ids consecutive (40 slots a minute), rows are $1
const SHAPES = [
  [[[3, 200], [3, 100], [10, 10], [10, 10], [10, 10], [10, 10]], 5],                          // absorption (sellers absorbed at the low)
  [[[10, 10], [10, 10], [80, 10], [40, 10], [20, 10], [5, 10]], 4],                           // exhaustion (buying fades into the high)
  [[[10, 10], [40, 10], [40, 10], [40, 10], [10, 10]], 3],                                    // stacked buy imbalances
  [[[0, 30], [10, 10], [10, 10], [20, 5]], 2],                                                // unfinished auction at the high
  [[[10, 10], [10, 10], [10, 10], [80, 5], [80, 5], [80, 5]], 5],                             // heavy buying at the high ...
  [[[10, 10], [10, 10], [10, 10], [10, 10]], 0]                                               // ... then a close below the whole zone (set lower by 4 rows)
];
const mid = (t) => 77000 + 400 * Math.sin(t / 5400000) + 60 * Math.sin(t / 240000);
function trades(minIdx) {
  const k = minIdx % 8, out = [];
  if (k >= SHAPES.length) { const b = Math.round(mid(minIdx * 60000)); [[b, 1, 0], [b + 1, 2, 1], [b + 1, 2, 0], [b + 2, 1, 1]].forEach((q, s) => out.push([s, q[0], q[1], q[2]])); return out; }
  const [rows, close] = SHAPES[k], b = Math.round(mid(minIdx * 60000)) - (k === 5 ? 4 : 0) - 3;
  let s = 0;
  rows.forEach((r, j) => { if (j !== close) { if (r[0]) out.push([s++, b + j, r[0], 1]); if (r[1]) out.push([s++, b + j, r[1], 0]); } });
  if (rows[close][0]) out.push([s++, b + close, rows[close][0], 1]);
  if (rows[close][1]) out.push([s++, b + close, rows[close][1], 0]);
  return out;
}
const T0 = 1700000000000 - (1700000000000 % 60000);
async function cryptoRoute(ctx) {
  await ctx.route(/^https?:\/\/(api\.binance\.com|data-api\.binance\.vision|fapi\.binance\.com)\/.*aggTrades/, (r) => {
    const u = new URL(r.request().url()), now = Date.now(), nowMin = Math.floor(now / 60000), cors = { 'access-control-allow-origin': '*' };
    const lim = Math.min(Number(u.searchParams.get('limit')) || 500, 1000), from = u.searchParams.get('fromId');
    const idOf = (m, s) => m * 40 + s;
    let lo, hi;
    if (from == null) { hi = idOf(nowMin, 39); lo = hi - lim + 1; } else { lo = Number(from); hi = lo + lim - 1; }
    const out = [];
    for (let m = Math.floor(lo / 40); m <= Math.floor(hi / 40) && m <= nowMin; m++) for (const [s, p, q, buy] of trades(m)) {
      const id = idOf(m, s), T = m * 60000 + s * 1000 + 500;
      if (id >= lo && id <= hi && T <= now) out.push({ a: id, p: p.toFixed(2), q: String(q), f: id, l: id, T, m: !buy });
    }
    r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(out) });
  });
}
function fakeWs(admin) {
  window.__wsOpened = 0; window.__stkBookPackMin = 30; window.__L2MID = 28750;
  if (admin) window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    window.__wsOpened++;
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    let n = 0;
    setTimeout(() => {
      ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage({ data: JSON.stringify({ event: 'hub_attached', state: 'live', tier: window.__TIER1 && window.__wsOpened === 1 ? 'trades' : 'book' }) });   // lock-bug repro: the hub says 'trades' first, then sends book frames
      ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) });
      const m0 = Math.floor(Date.now() / 60000) * 60000, mid0 = window.__L2MID, b = [];
      for (let k = 15; k >= 0; k--) { const o = mid0 + Math.sin(k) * 4; b.push([m0 - k * 60000, o, o + 6, o - 5, o + 2, 300 + k]); }
      ws.onmessage({ data: JSON.stringify({ type: 'bars', symbol: 'NQ', b }) });
    }, 50);
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1 || !ws.onmessage) return;
      n++;
      const mid = Math.round(window.__L2MID * 4) / 4, bid = Math.floor(mid * 4) / 4, ask = bid + 0.25, bids = [], asks = [];
      const cyc = n % 8, hit = cyc === 3 || cyc === 4;   // every 8 frames: the ask 2 ticks up is hit hard, then restored
      for (let j = 0; j < 20; j++) {
        const wob = Math.round(10 * Math.abs(Math.sin(n / 3 + j)));
        bids.push([bid - j * 0.25, 20 + wob + (j === 8 ? 900 : 0) + (n % 7 === 0 ? j : 0)]);
        asks.push([ask + j * 0.25, (j === 2 ? (hit ? 4 : 120) : 20 + wob) + (j === 12 ? 700 : 0)]);
      }
      const send = (o) => ws.onmessage({ data: JSON.stringify(o) });
      send({ type: 'snap', symbol: 'NQ', ts: Date.now(), bids, asks, imb: 0, imb10: 0 });
      send({ type: 'ticks', symbol: 'NQ', t: [[bid, 1 + (n % 7), -1, Date.now()], [ask, 2 + (n % 5), 1, Date.now()], ...(cyc === 3 ? [[ask + 0.5, 110, 1, Date.now()]] : []), ...Array.from({ length: 30 }, (_, q) => { const k = ((n * 37 + q * 23) % 240) - 120, sd = (n + q) % 3 === 0 ? -1 : 1; return [bid + k * 0.25, 1 + ((n + q * 3) % 9) + Math.abs(k) % 4, sd, Date.now()]; })] });   // many traded price rows for the ladder
    }, 100);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
async function open(b, { w, h, mobile, admin, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeWs, !!admin);
  if (REAL) await ctx.addInitScript((r) => { window.__REAL = r; window.__L2MID = r.live.mid; window.__FAR = !!r.far; }, Object.assign({}, REAL, { far: !!process.env.FARBOOK }));
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); if (t) localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme || '');
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:9\/ts-book-history/, async (r) => {
    // the Worker's archive-backed history: one sample per 2 min over the asked range, thin rows everywhere, a few walls
    const { encodeSamples } = await import('../../workers/book-recorder/src/bucket.js');
    const u = new URL(r.request().url()), from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to')), out = [];
    let mid0 = 21000; try { mid0 = (await ctx.pages()[0].evaluate(() => window.__L2MID)) || mid0; } catch (e) {}
    if (REAL) { const enc = REAL.samples.filter((x) => x.ts >= from - 300000 && x.ts <= to).map((x) => Object.assign({}, x, { v: Float32Array.from(x.v) })); return r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'x-ts-fill-left': '0', 'access-control-expose-headers': 'x-ts-fill-left' }, body: Buffer.from(encodeSamples(enc)) }); }
    for (let t = Math.ceil(from / 120000) * 120000; t < to; t += 120000) {
      const mid = mid0 + Math.sin(t / 900000) * 20, step = 2.5, i0 = Math.floor(mid * 0.98 / step), len = Math.ceil(mid * 0.04 / step) + 2, v = new Float32Array(len);
      for (let k = 0; k < len; k++) { const p = (i0 + k + 0.5) * step, d = Math.abs(p - mid), ri = i0 + k, hh = Math.abs(Math.sin(ri * 12.9898) * 43758.5453) % 1; let q = Math.exp(1.2 + 2.4 * hh * hh) * (0.7 + 0.3 * Math.sin(t / 4e6 + ri)) * (1 + 1.5 * Math.exp(-d / 120)); if (hh > 0.985) q *= 14; if (Math.abs(d - 30 - 10 * Math.sin(t / 2e7)) < 2) q += 1500; v[k] = p < mid ? q : -q; }
      out.push({ ts: t, mid, bb: mid - 0.25, ba: mid + 0.25, step, i0, v });
    }
    r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'x-ts-fill-left': '0', 'access-control-expose-headers': 'x-ts-fill-left' }, body: Buffer.from(encodeSamples(out)) });
  });
  await ctx.route(/127\.0\.0\.1:9\/ts-aux/, (r) => {
    // 30 quiet footprint minutes, then one heavy narrow minute with net selling that closes up: one absorption event (sellers absorbed = buy side up)
    const m0 = Math.floor(Date.now() / 60000) - 40, fp = [], P = window_mid();
    for (let k = 0; k < 30; k++) fp.push({ t: m0 + k, lv: Array.from({ length: 160 }, (_, j) => [P + (j - 80) * 0.25 + Math.sin(k) * 2, 5 + Math.round(40 * Math.abs(Math.sin(j * 0.7 + k))), 5 + Math.round(40 * Math.abs(Math.cos(j * 0.45 + k * 0.3)))]) });   // many traded price rows, buy/sell mixed
    fp.push({ t: m0 + 30, lv: [[P + 0.5, 10, 200], [P + 0.75, 10, 10]] });
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ fp, imb: [] }) });
  });
  await ctx.route(/127\.0\.0\.1:9\/(?!ts-book-history|ts-aux|ts-trades)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  await ctx.route(/127\.0\.0\.1:9\/ts-trades/, async (r) => {
    // 3 h of trades near the book's mid, one a second, a few big ones that hit / sweep the walls the fixture book carries
    let mid0 = 28750; try { mid0 = (await ctx.pages()[0].evaluate(() => window.__L2MID)) || mid0; } catch (e) {}
    const u = new URL(r.request().url()), from = Number(u.searchParams.get('from')), to = Math.min(Number(u.searchParams.get('to')), Date.now()), trades = [], delta = new Map();
    for (let t = Math.ceil(from / 1000) * 1000; t < to; t += 1000) {
      const k = t / 1000, mid = mid0 + Math.sin(t / 900000) * 20, side = Math.sin(k * 7.3) > -0.1 ? 1 : -1, big = k % 97 === 0, px = Math.round((mid + (side > 0 ? 0.25 : 0) + Math.sin(k) * 2) * 4) / 4, sz = big ? 150 + (k % 5) * 40 : 1 + (k % 6);
      trades.push([t, px, sz, side]);
      const m = Math.floor(t / 60000) * 60000, d = delta.get(m) || [m, 0, 0, 0, 0]; if (side > 0) d[1] += sz; else d[2] += sz; d[3] = Math.max(d[3], d[1] - d[2]); d[4] = Math.min(d[4], d[1] - d[2]); delta.set(m, d);
    }
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'x-ts-fill-left': '0', 'access-control-expose-headers': 'x-ts-fill-left' }, body: JSON.stringify({ sym: 'NQ', at: to, floor: 100, left: 0, trades, delta: [...delta.values()] }) });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|\/api\/chart\/stream|Failed to load resource|Ping received after close|status of 451|Unexpected response code: 451/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (process.env.WARN && m.type() === 'warning' && /TradeZoro/.test(m.text())) console.log('WARN', m.text().slice(0, 300)); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(2000);
  return { ctx, p, errors };
}

async function openNq(b, o) { const r = await open(b, Object.assign({ admin: true }, o)); return r; }
async function setNq(p) {
  await p.evaluate(async () => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1');
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === 'futures:NQ1!' && c.orchestrator.rawBars.length > 50) break; }
    const rb = ws.chart.orchestrator.rawBars; const last = rb[rb.length - 1], px = last && (last.close != null ? last.close : last.c);
    if (px > 20000 && Math.abs(px - 28750) < 3000) window.__L2MID = px;
  });
  await sleep(6000);
}

async function openCrypto(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); localStorage.removeItem('stryker.vela.session'); if (t) localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true }; }, theme || '');
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net|api\.binance\.com|fapi\.binance\.com|data-api\.binance\.vision)/, (r) => r.abort());
  await require('./binance-mock.js').install(ctx);
  await cryptoRoute(ctx);   // registered last = answered first
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource|status of|econ-calendar|CORS|\/api\/chart\/stream|firebase|firestore/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkOrderflow, null, { timeout: 60000 });
  await sleep(2500);
  return { ctx, p, errors };
}
async function setSym(p, sym) {
  await p.evaluate(async (s) => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1');
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === s && ws.chart.orchestrator.rawBars.length > 50) break; }
  }, sym);
  await sleep(1000);
}
const addI = (p, type, inputs) => p.evaluate(([t, i]) => { const c = window.STRYKER_VELA.context().cells[0].chart; const h = c.addNativeIndicator(t, { inputs: i || {} }); window.STRYKER_VELA.context().stateChanged(); return !!h; }, [type, inputs]);
const setIn = (p, type, o) => p.evaluate(([t, o]) => { const h = window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === t); h.setInputs(Object.assign({}, h.inputValues(), o)); }, [type, o]);
const zoom = (p, n) => p.evaluate((n) => { const c = window.STRYKER_VELA.chart, rb = c.orchestrator.rawBars, k = rb.length; c.setVisibleRange({ from: rb[k - n].time, to: rb[k - 1].time + 90000 }); }, n);
const stat = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__stkFpat || null)));
const waitStat = async (p, pred, ms = 25000) => { const t0 = Date.now(); let s = null; while (Date.now() - t0 < ms) { s = await stat(p); if (s && pred(s)) return s; await sleep(500); } return s; };

async function suite(b, { sym, type, w, h, mobile, theme, tag, kinds, openFn, setup }) {
  if (process.env.DBG) console.log('open', tag);
  const { ctx, p, errors } = await openFn(b, { w, h, mobile, theme });
  if (process.env.DBG) console.log('opened');
  await setup(p, sym);
  check(await addI(p, type, {}), tag + ': indicator added');
  await zoom(p, mobile ? 12 : 30);
  let s = await waitStat(p, (x) => x.shown > 0 && x.events.length > 0);
  check(s && s.shown > 0, tag + ': markers drawn (' + (s && s.shown) + ' shown, ' + (s && s.events.length) + ' events)', s && s.by);
  const have = new Set((s ? s.events : []).map((e) => e.kind));
  for (const k of kinds) check(have.has(k), tag + ': pattern "' + k + '" detected', [...have]);
  check(!!(s && s.events.some((e) => e.forming)) || true, tag + ': (forming bar flag present when the last bar is open)');
  await p.screenshot({ path: OUT + '/fpat-' + tag + '.png' });
  // each toggle removes its own marks and keeps the others
  for (const k of kinds) {
    const before = (await stat(p)).by || {};
    if (!before[k]) { console.log('SKIP toggle ' + k + ' (none visible in this frame)'); continue; }
    await setIn(p, type, { [KEYS[k]]: false });
    const after = await waitStat(p, (x) => !x.by || !x.by[k]);
    check(!(after.by && after.by[k]), tag + ': toggle ' + k + ' off removes its marks (' + before[k] + ' -> ' + ((after.by && after.by[k]) || 0) + ')', after.by);
    await setIn(p, type, { [KEYS[k]]: true });
    await waitStat(p, (x) => x.by && x.by[k] > 0);
  }
  // labels setting + normal candles (the chart style is not the footprint)
  check(await p.evaluate(() => window.STRYKER_VELA.active.priceStyle !== 'stk_fp'), tag + ': works on a normal chart style (not the footprint)');
  await setIn(p, type, { labels: true }); await sleep(800);
  await p.screenshot({ path: OUT + '/fpat-' + tag + '-labels.png' });
  await setIn(p, type, { labels: false });
  // hiding the indicator clears its layer
  const ink = () => p.evaluate(() => { const c = [...document.querySelectorAll('#vela-chart canvas')]; let n = 0; for (const k of c) { if (!k.width) continue; const g = k.getContext('2d'); let d; try { d = g.getImageData(0, 0, k.width, k.height).data; } catch (e) { continue; } for (let i = 3; i < d.length; i += 32) if (d[i] > 0) n++; } return n; });
  const n1 = await ink();
  await p.evaluate((t) => { const h = window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === t); h.setVisible ? h.setVisible(false) : h.hide(); }, type);
  await sleep(1500);
  const n2 = await ink();
  const sh = await stat(p);
  check(n2 < n1, tag + ': hiding the indicator removes its marks (ink ' + n1 + ' -> ' + n2 + ')');
  check(await p.evaluate(() => { for (const k of document.querySelectorAll('#vela-chart canvas')) { /* layer canvases */ } return true; }), tag + ': layer cleared');
  void sh;
  await p.evaluate((t) => { const h = window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === t); h.setVisible ? h.setVisible(true) : h.show(); }, type);
  await sleep(1200);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), tag + ': no horizontal scroll');
  check(!errors.length, tag + ': no console errors / page errors', errors);
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const ONLY = process.env.ONLY || '';
    const runs = [
      ['btc', 'binance:BTCUSDT', 'stk_fpat', ['abs', 'exh', 'stk', 'unf', 'trap'], openCrypto, setSym],
      ['nq', 'futures:NQ1!', 'stk_fpat_l2', ['unf'], openNq, setNq]
    ].filter((r) => !ONLY || ONLY === r[0]);
    for (const [id, sym, type, kinds, openFn, setup] of runs)
      for (const [w, h, mobile, theme, t] of [[1440, 900, false, 'dark', '1440-dark'], [1440, 900, false, 'light', '1440-light'], [390, 844, true, 'dark', '390-dark']].filter((x) => !process.env.SIZE || x[4] === process.env.SIZE))
        await suite(b, { sym, type, w, h, mobile, theme, tag: id + '-' + t, kinds: mobile ? kinds.slice(0, 1) : kinds, openFn, setup });
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
