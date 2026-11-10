// Futures L2 (assets/chart-futures-l2.js) browser test with FIXTURE frames, no Worker and no key.
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/ts-l2-browser.js <shotsDir>
// A fake WebSocket answers /ts-live with snap / coarse / ticks frames in the Worker's own shapes (ts-hub.js header).
// Checks: NON-admin (no test flag): no L2 indicator in the picker list, no socket opened, no ladder button;
// admin (localhost test flag): heatmap, walls (PULLED / CONSUMED tags), imbalance pane and DOM ladder render at 1440 and 390,
// dark + light; touch on the 390 sheet (open, level switch, close); no console errors; no "real-time"/"live" copy except "Live L2".
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const REAL = process.env.REAL ? JSON.parse(fs.readFileSync(process.env.REAL, 'utf8')) : null;   // real archive + live snapshot (ts-l2-real-fetch.mjs)
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };

function fakeWs(admin) {
  window.__wsOpened = 0; window.__L2MID = 28750;
  if (admin) window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    window.__wsOpened++;
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    const T0 = Date.now(); let n = 0;
    window.__l2ws = ws;
    // the socket opens only after setNQ pinned __L2MID to the real NQ bars: an earlier open pushes 15 fake bars at the default mid,
    // setNQ then reads the fake close and the fixture book sits ~2000 pts off the real candles (2 size labels; CI flake 2026-11-05)
    const opened = () => {
      if (ws.readyState === 3) return;
      if (!window.__L2READY) return setTimeout(opened, 50);
      ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage && ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) });
      // the hub's last 15 min of 1m candles (what the 10-min-delayed lane has not delivered yet)
      const m0 = Math.floor(Date.now() / 60000) * 60000, mid0 = window.__L2MID || 21000, b = [];
      for (let k = 15; k >= 0; k--) { const o = mid0 + Math.sin(k) * 4; b.push([m0 - k * 60000, o, o + 6, o - 5, o + 2, 300 + k]); }
      ws.onmessage({ data: JSON.stringify({ type: 'bars', symbol: 'NQ', b }) });
    };
    setTimeout(opened, 50);
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1 || !ws.onmessage) return;
      n++;
      const mid = Math.round((window.__L2MID || 21000) * 4) / 4 + Math.sin(n / 9) * 3, now = Date.now();
      const step = 2.5, i0 = Math.floor(mid * 0.996 / step), len = Math.ceil(mid * 0.008 / step) + 2;
      const v = new Array(len).fill(0);
      for (let k = 0; k < len; k++) {
        const p = (i0 + k + 0.5) * step, d = Math.abs(p - mid);
        let q = 30 + 25 * Math.abs(Math.sin(k * 1.7 + n / 40)) + Math.max(0, 200 - d * 4);
        if (Math.abs(d - 14) < 1.1) q += 900;                       // standing wall each side
        if (p > mid && Math.abs(d - 40) < 1.1 && n < 90) q += 700;  // a wall that is pulled at n=90
        v[k] = p < mid ? Math.round(q) : -Math.round(q);
      }
      const bid = Math.floor(mid * 4) / 4, ask = bid + 0.25, bids = [], asks = [];
      for (let j = 0; j < 150; j++) { bids.push([bid - j * 0.25, Math.round(5 + 40 * Math.abs(Math.sin(j / 3 + n / 20)) + (j === 40 ? 500 : 0))]); asks.push([ask + j * 0.25, Math.round(5 + 40 * Math.abs(Math.cos(j / 3 + n / 25)) + (j === 52 ? 450 : 0))]); }
      const send = (o) => ws.onmessage({ data: JSON.stringify(o) });
      if (window.__HUBF) { for (const fr of window.__HUBF) send(Object.assign({}, fr, { ts: now })); return; }   // frames the REAL hub code built (crossed-book section)
      if (window.__REAL) { const L = window.__REAL.live; send({ type: 'snap', symbol: 'NQ', ts: now, bids: L.bids.filter((x) => x[0] < L.mid), asks: L.asks.filter((x) => x[0] > L.mid), imb: 0, imb10: 0 }); let lv = L.v, li0 = L.i0;
        if (window.__FAR) { const lo = Math.floor(L.mid * 0.98 / L.step), hi = Math.ceil(L.mid * 1.02 / L.step), nv = new Array(hi - lo + 1).fill(0); for (let k = 0; k < L.v.length; k++) nv[L.i0 + k - lo] = L.v[k]; for (let k = 0; k < nv.length; k += 7) if (!nv[k]) nv[k] = (lo + k + 0.5) * L.step < L.mid ? 1 : -1; lv = nv; li0 = lo; }
        send({ type: 'coarse', symbol: 'NQ', ts: now, mid: L.mid, bb: L.bb, ba: L.ba, step: L.step, i0: li0, v: lv }); const b0 = L.bb, a0 = L.ba; send({ type: 'ticks', symbol: 'NQ', t: [[b0, 1 + (n % 7), -1, now], [a0, 2 + (n % 5), 1, now], [a0 + 0.5, 3, 1, now]] }); return; }
      send({ type: 'snap', symbol: 'NQ', ts: now, bids, asks, imb: Math.sin(n / 30) * 0.6, imb10: Math.sin(n / 30 + 0.7) * 0.45 });
      send({ type: 'coarse', symbol: 'NQ', ts: now, mid, bb: bid, ba: ask, step, i0, v });
      send({ type: 'ticks', symbol: 'NQ', t: [[bid, 1 + (n % 7), -1, now], [ask, 2 + (n % 5), 1, now], [ask + 0.5, 3, 1, now]] });
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
  await ctx.route(/127\.0\.0\.1:9\/(?!ts-book-history)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage();
  if (process.env.DBG) { p.on('request', (q) => { if (/127\.0\.0\.1:9/.test(q.url())) console.log('REQ', q.url().slice(0, 120)); }); p.on('console', (m) => { if (/L2|history|bad body/i.test(m.text())) console.log('CON', m.text().slice(0, 200)); }); }
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|\/api\/chart\/stream|Failed to load resource|Ping received after close|status of 451|Unexpected response code: 451/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(2000);
  return { ctx, p, errors };
}
const chartOf = (p) => p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.market.symbol);
async function setNQ(p) {
  await p.evaluate(async () => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1');
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === 'futures:NQ1!' && c.orchestrator.rawBars.length > 50) break; }
    const rb = ws.chart.orchestrator.rawBars; const last = rb[rb.length - 1], px = last && (last.close != null ? last.close : last.c);
    if (px > 20000 && Math.abs(px - 28750) < 3000) window.__L2MID = px;
    window.__L2READY = 1;
  });
  await sleep(800);
}
const add = (p, type, inputs) => p.evaluate(([t, i]) => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator(t, { inputs: i || {} }); window.STRYKER_VELA.context().stateChanged(); }, [type, inputs]);
const pickerHas = (p) => p.evaluate(() => { const t = document.body.innerText; return /Futures DOM Heatmap \(L2\)|Liquidity Walls \(L2\)|Book Imbalance \(L2\)/.test(t); });
const canv = (p) => p.evaluate(() => { let best = 0; for (const c of document.querySelectorAll('#vela-chart canvas')) { if (!c.width) continue; const g = c.getContext('2d'); if (!g) continue; let d; try { d = g.getImageData(0, 0, c.width, c.height).data; } catch (e) { continue; } let n = 0; for (let i = 3; i < d.length; i += 64) if (d[i] > 0) n++; best = Math.max(best, n); } return best; });

// Crossed-book frames through the REAL hub (workers/book-recorder/src/ts-hub.js): both sides full (400 a side) plus ONE stray ask far below
// the bids. Before the fix the hub's mid moved down with it and the coarse column / depth bars kept no bid below the price (Owner 2026-11-09).
async function hubFrames(mid) {
  const { TSHub } = await import(process.env.OLD_HUB || '../../workers/book-recorder/src/ts-hub.js')   // OLD_HUB=<abs path to an older ts-hub.js>: red-check the test;
  class W { constructor() { this.l = {}; W.s = this; setTimeout(() => this.emit('open'), 1); } addEventListener(e, f) { (this.l[e] = this.l[e] || []).push(f); } emit(e, ev) { for (const f of this.l[e] || []) f(ev); } send() {} close() {} }
  const hub = new TSHub({ putMin() {}, prune() {}, range() { return []; } }, 'K', { WebSocket: W, RECORD: false, FLUSH_MS: 10, MIN_GAP_MS: 20, COARSE_MS: 20 });
  const got = [], c = { send(s) { got.push(JSON.parse(s)); }, close() {} };
  hub.attach(c, 'NQ', 150, 'book'); hub.poke(); await sleep(20);
  const t = Math.round(mid * 4) / 4, bids = [], asks = [];
  for (let i = 0; i < 400; i++) { bids.push([t - 0.25 - i * 0.25, 4 + (i % 9) * 3 + (i % 37 === 0 ? 200 : 0)]); asks.push([t + 0.25 + i * 0.25, 4 + (i % 7) * 3 + (i % 41 === 0 ? 180 : 0)]); }
  asks.unshift([t - 400, 1]);   // the stray level, below all 400 bids (100 pts): the old mid sat ~200 pts low, every bid row was dropped
  W.s.emit('message', { data: JSON.stringify({ type: 'book', symbol: 'NQ', bids, asks, imbalance: 0, ts: 1 }) });
  await sleep(80); hub.shutdown();
  return [got.filter((m) => m.type === 'snap').at(-1), got.filter((m) => m.type === 'coarse').at(-1)];
}
// REAL stale-ask book (Owner 2026-11-10 21:25 IST: heatmap stopped at the 09:31 ET open, DOM still live). The vendor's NQ book at 15:57 UTC
// (workers/book-recorder/test/fixtures/nq-stale-asks.json): asks frozen below the traded price, stale bids above it. Shifted onto the chart's
// price, a trade at the traded price, then through the REAL hub. Old hub: snaps but NO coarse frame = no live heatmap column at all.
async function staleFrames(mid) {
  const { TSHub } = await import(process.env.OLD_HUB || '../../workers/book-recorder/src/ts-hub.js');
  const bad = JSON.parse(fs.readFileSync(__dirname + '/../../workers/book-recorder/test/fixtures/nq-stale-asks.json', 'utf8')).books[1];
  const d = Math.round((mid - bad.P) * 4) / 4, sh = (l) => l.map((x) => [x[0] + d, x[1]]);
  class W { constructor() { this.l = {}; W.s = this; setTimeout(() => this.emit('open'), 1); } addEventListener(e, f) { (this.l[e] = this.l[e] || []).push(f); } emit(e, ev) { for (const f of this.l[e] || []) f(ev); } send() {} close() {} }
  const hub = new TSHub({ putMin() {}, prune() {}, range() { return []; } }, 'K', { WebSocket: W, RECORD: false, FLUSH_MS: 10, MIN_GAP_MS: 20, COARSE_MS: 20 });
  const got = [], c = { send(s) { got.push(JSON.parse(s)); }, close() {} };
  hub.attach(c, 'NQ', 150, 'book'); hub.poke(); await sleep(20);
  W.s.emit('message', { data: JSON.stringify({ type: 'tick', symbol: 'NQ', price: bad.P + d, size: 1, side: 'buy', ts: 1 }) });
  W.s.emit('message', { data: JSON.stringify({ type: 'book', symbol: 'NQ', bids: sh(bad.bids), asks: sh(bad.asks), imbalance: 0, ts: 1 }) });
  await sleep(120); hub.shutdown();
  return [got.filter((m) => m.type === 'snap').at(-1), got.filter((m) => m.type === 'coarse').at(-1)].filter(Boolean);
}
async function staleBook(b) {
  for (const [w, h, mobile, tag] of [[1440, 900, false, '1440-dark'], [390, 844, true, '390-dark']]) {
    const { ctx, p, errors } = await open(b, { w, h, mobile, admin: true, theme: 'dark' });
    await setNQ(p);
    const mid = await p.evaluate(() => window.__L2MID);
    const fr = await staleFrames(mid);
    console.log('INFO ' + tag + ' stale-ask hub frames: ' + fr.map((x) => x.type).join(','));
    await p.evaluate((f) => { window.__HUBF = f; }, fr);
    await add(p, 'stk_depth_heat');
    await sleep(9000);
    const d = await p.evaluate(() => {
      const h = window.__stkFlow.acquireBookFeed('tsl2', 'NQ', () => {}), f = h.feed, now = Date.now();
      const live = f.history.filter((s) => now - s.ts < 8000), y = window.__stkFlow.dhDebug(); h.release();
      return { live: live.length, history: f.history.length, newestAgo: f.history.length ? now - f.history[f.history.length - 1].ts : null, heatCols: y && y.heat && y.heat.columns };
    });
    console.log('INFO ' + tag + ' stale-ask book', JSON.stringify(d));
    check(d.live >= 5 && d.newestAgo < 3000, tag + ': stale-ask book: live heatmap columns keep being written (' + d.live + ' in the last 8 s)', d);
    check(errors.length === 0, tag + ': stale-ask book: no console errors', errors);
    await p.screenshot({ path: OUT + '/l2-stale-' + tag + '.png' });
    await ctx.close();
  }
}
// REAL frozen bid side (Owner 2026-11-10 22:56 IST: "why heatmap lower portion not showing?"). MNQ 16:59-17:02 UTC
// (workers/book-recorder/test/fixtures/mnq-frozen-bids.json): the vendor re-sent the same 400 bids, all above the price. Run through the REAL
// hub on a fake clock until it marks the side stale, shifted onto the chart's price. Then the clean 13:00 UTC book: the note must go.
async function frozenFrames(mid, which) {
  const { TSHub } = await import('../../workers/book-recorder/src/ts-hub.js');
  const FX = JSON.parse(fs.readFileSync(__dirname + '/../../workers/book-recorder/test/fixtures/mnq-frozen-bids.json', 'utf8'));
  const px0 = FX.frozen.at(-1).ticks.at(-1)[0], d = Math.round((mid - px0) * 4) / 4, sh = (l) => l.map((x) => [x[0] + d, x[1]]);
  let T = FX.frozen[0].t; const hub = new TSHub({ putMin() {}, prune() {}, range() { return []; } }, 'K', { now: () => T, RECORD: false, SYMBOLS: ['NQ'] });
  const feed = (f) => { T = f.t; for (const x of f.ticks) hub.feed([{ type: 'tick', symbol: 'NQ', price: x[0] + d, size: x[1], side: x[2] > 0 ? 'buy' : 'sell' }]); hub.feed([{ type: 'book', symbol: 'NQ', bids: sh(f.bids), asks: sh(f.asks) }]); };
  for (const f of FX.frozen) feed(f);
  if (which === 'clean') { const c = FX.clean[0], dc = Math.round((mid - c.ticks.at(-1)[0]) * 4) / 4; T += 5000; hub.feed([{ type: 'book', symbol: 'NQ', bids: c.bids.map((x) => [x[0] + dc, x[1]]), asks: c.asks.map((x) => [x[0] + dc, x[1]]) }]); }
  const got = [], c = { send(s) { got.push(JSON.parse(s)); }, close() {} };
  hub.attach(c, 'NQ', 150, 'book'); hub.tick(); hub.shutdown();
  return [got.find((m) => m.type === 'snap'), got.find((m) => m.type === 'coarse')].filter(Boolean);
}
async function frozenSide(b) {
  for (const [w, h, mobile, tag] of [[1440, 900, false, '1440-dark'], [390, 844, true, '390-dark']]) {
    const { ctx, p, errors } = await open(b, { w, h, mobile, admin: true, theme: 'dark' });
    await setNQ(p);
    const mid = await p.evaluate(() => window.__L2MID);
    const fr = await frozenFrames(mid, 'frozen'), clean = await frozenFrames(mid, 'clean');
    check(fr.length === 2 && fr.every((m) => m.stale === 'bid') && fr[0].bids.length === 0, tag + ': frozen side: the real hub marks the frames stale:bid', fr.map((m) => [m.type, m.stale]));
    check(clean.length === 2 && clean.every((m) => !m.stale), tag + ': frozen side: the clean book clears stale', clean.map((m) => [m.type, m.stale]));
    await p.evaluate((f) => { window.__HUBF = f; }, fr);
    await add(p, 'stk_depth_heat'); await add(p, 'stk_bk_walls', {});
    if (!mobile) await p.evaluate(() => window.__stkBookPanel.open());
    await sleep(4000);
    const st = () => p.evaluate(() => ({ dh: window.__stkDhNote || '', drawn: (window.__stkFlow.dhDebug() || {}).staleNote || '', dom: (document.querySelector('.stkbp-stat .stkbp-stale') || {}).textContent || '', wall: (window.__stkWallLegend || []).join(' / ') }));
    const a = await st();
    console.log('INFO ' + tag + ' frozen', JSON.stringify(a));
    check(a.dh === 'Bid side unavailable from the data feed' && a.drawn === a.dh, tag + ': heatmap note shows (drawn on the heatmap) on a stale bid side', a);
    if (!mobile) check(a.dom === 'Bid side unavailable from the data feed', tag + ': DOM panel note shows on a stale bid side', a);
    check(!/NaN|undefined/.test(a.wall), tag + ': Wall Events legend keeps working on the one-sided book', a.wall);
    await p.screenshot({ path: OUT + '/l2-frozen-' + tag + '.png' });
    await p.evaluate((f) => { window.__HUBF = f; }, clean); await sleep(2500);
    const z = await st();
    check(z.dh === '' && z.drawn === '' && z.dom === '', tag + ': both notes gone once the side returns', z);
    check(errors.length === 0, tag + ': frozen side: no console errors', errors);
    await p.screenshot({ path: OUT + '/l2-frozen-back-' + tag + '.png' });
    await ctx.close();
  }
}
async function crossedBook(b) {
  for (const [w, h, mobile, tag] of [[1440, 900, false, '1440-dark'], [390, 844, true, '390-dark']]) {
    const { ctx, p, errors } = await open(b, { w, h, mobile, admin: true, theme: 'dark' });
    await setNQ(p);
    const mid = await p.evaluate(() => window.__L2MID);
    await p.evaluate((f) => { window.__HUBF = f; }, await hubFrames(mid));
    await add(p, 'stk_fut_dom', { look: 'Zoro' });
    await add(p, 'stk_depth_heat');
    await sleep(6000);
    const d = await p.evaluate((mid) => {
      const x = window.__stkFlow.domDebug(), y = window.__stkFlow.dhDebug(), h = window.__stkFlow.acquireBookFeed('tsl2', 'NQ', () => {}), f = h.feed;
      const s = f.history[f.history.length - 1]; let bidRows = 0; for (let k = 0; s && k < s.v.length; k++) if (s.v[k] > 0 && (s.i0 + k + 1) * s.step <= mid) bidRows++;
      let bookBids = 0; f.book.bids.forEach((q, px) => { if (q > 0 && px < mid) bookBids++; }); h.release();
      return { mid: x.mid, bidRows, bookBids, rowLo: x.rowLo, depthLo: x.depthLo, depthBars: x.depthBars, bb: y && y.bestBidSize, lad: y && y.ladderRows };
    }, mid);
    console.log('INFO ' + tag + ' crossed book', JSON.stringify(d));
    check(Math.abs(d.mid - mid) < 2, tag + ': crossed book: the live column mid stays at the real touch', { mid: d.mid, want: mid });
    check(d.bidRows >= 20, tag + ': crossed book: the live heatmap column has bid rows below the price (' + d.bidRows + ')', d);
    check(d.bookBids >= 20 && d.depthLo < mid - 5, tag + ': crossed book: bid depth bars drawn below the price (' + d.bookBids + ' bid rows)', d);
    check(d.bb > 0, tag + ': crossed book: Depth Heatmap best bid size shown', d.bb);
    check(errors.length === 0, tag + ': crossed book: no console errors', errors);
    await p.screenshot({ path: OUT + '/l2-crossed-' + tag + '.png' });
    await ctx.close();
  }
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    if (!process.env.ONLY_FROZEN) await staleBook(b);
    if (!process.env.ONLY_STALE) await frozenSide(b);
    if (!process.env.ONLY_STALE && !process.env.ONLY_FROZEN) await crossedBook(b);
    if (!process.env.ONLY_CROSSED && !process.env.ONLY_STALE && !process.env.ONLY_FROZEN) {
    // ---- NON-admin: nothing new, nothing opened
    {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900, admin: false });
      await setNQ(p);
      // try to add anyway: the registry must not list it
      const listed = await p.evaluate(() => { try { const c = window.STRYKER_VELA.context().cells[0].chart; return (c.nativeCatalog ? c.nativeCatalog() : []).map((x) => x.type || x.id).filter((t) => /^stk_fut_/.test(t)); } catch (e) { return ['err']; } });
      const ladderBtn = await p.evaluate(() => { const b = document.querySelector('.stkl2-railbtn'); return !b || b.hidden || getComputedStyle(b).display === 'none'; });
      await sleep(1500);
      check(listed.length === 0, 'non-admin: no L2 indicator in the catalog', listed);
      // the old DOM ladder button is gone: the Book/DOM/Trades panel (chart-book-panel.js) owns that rail button and is tested in book-panel-browser.js
      check(await p.evaluate(() => window.__wsOpened) === 0, 'non-admin: no /ts-live socket opened');
      check(!(await p.evaluate(() => !!document.getElementById('stkl2-badge'))), 'non-admin: no Live L2 badge');
      check(errors.length === 0, 'non-admin: no console errors', errors);
      await p.screenshot({ path: OUT + '/l2-nonadmin-1440.png' });
      await ctx.close();
    }
    // ---- admin: 1440 dark + light, then 390 dark + light
    for (const [w, h, mobile, theme, tag] of (process.env.ONE === "m" ? [[390, 844, true, "dark", "390-dark"]] : process.env.ONE ? [[1440, 900, false, "dark", "1440-dark"]] : [[1440, 900, false, "dark", "1440-dark"], [1440, 900, false, "light", "1440-light"], [390, 844, true, "dark", "390-dark"], [390, 844, true, "light", "390-light"]])) {
      const { ctx, p, errors } = await open(b, { w, h, mobile, admin: true, theme });
      await setNQ(p);
      await add(p, 'stk_fut_dom', { style: process.env.DOMSTYLE || 'Combined (heatmap + depth + walls)' });
      await add(p, 'stk_fut_imb');
      await sleep(9000);   // ~90 fake coarse columns
      // heatmap fills the visible window from the left edge (backfill), and no empty band inside the book's price range
      const hm = await p.evaluate(() => { const d = window.__stkFlow && window.__stkFlow.domDebug && window.__stkFlow.domDebug(); return d || null; });
      if (process.env.DBG) console.log('HM', JSON.stringify(hm && { rs: hm.remoteSamples, st: hm.remoteState, s: hm.samples, cols: hm.columns, vis: hm.visFrom, cells: hm.cells }));
      if (hm) { check(hm.remoteSamples > 5, tag + ': history backfill samples loaded (' + hm.remoteSamples + ')'); check(hm.heatX0 != null && hm.heatX0 <= 60, tag + ': heatmap starts at the left edge of the screen', hm.heatX0); }
      // Bookmap: perf at this size (rebuild cost; cached blits cost ~0), full-height rows, dark field, no wall tags
      if (hm && hm.bm) {
        check(hm.bm.cells > 2000, tag + ': bookmap paints rows (' + hm.bm.cells + ' cells)');
        const ms = [];
        for (const g of [1.3, 0.8, 1.1]) {   // a new contrast = a new cache key = a real rebuild
          await p.evaluate((g) => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_fut_dom'); h.setInputs(Object.assign({}, h.inputs, { contrast: g })); }, g);
          await sleep(700); ms.push((await p.evaluate(() => window.__stkFlow.domDebug())).bm.ms);
        }
        console.log('INFO ' + tag + ' bookmap REBUILD ms', JSON.stringify(ms));
        check(ms.slice().sort((x, y) => x - y)[1] <= (mobile ? 20 : 30), tag + ': median rebuild ok (headless 4 GB server CPU; real phone target <= 4 ms)', ms);
        const t2 = await p.evaluate(() => window.__stkFlow.domDebug());
        console.log('INFO ' + tag + ' bookmap rebuild ms', JSON.stringify(t2.bm && t2.bm.ms), 'frame ms', t2.ms);
        check(t2.ms <= 25, tag + ': frame time at 390 stays small', t2.ms);
        check(t2.walls.length === 0, tag + ': no wall labels in Bookmap style');
        console.log('INFO ' + tag + ' blue share of coloured pixels', t2.bm && t2.bm.blueShare, '%', JSON.stringify(t2.bm));
        check(!t2.bm || t2.bm.blueShare === undefined || t2.bm.blueShare >= 60, tag + ': >= 60% of coloured cells read as blue (rank colouring)', t2.bm && t2.bm.blueShare);
        check(t2.sizeLabels >= 3, tag + ': depth bars carry size numbers (' + t2.sizeLabels + ')', t2.sizeLabels);
      }
      if (process.env.DBG2) console.log('BARS', JSON.stringify(await p.evaluate(() => { const c = window.STRYKER_VELA.chart, o = c.orchestrator; const r = o.renderer; return { n: o.rawBars.length, vis: c.getVisibleRange && c.getVisibleRange(), style: c.priceStyle || (window.STRYKER_VELA.active && window.STRYKER_VELA.active.priceStyle), lastT: o.rawBars[o.rawBars.length - 1].time, keys: Object.keys(r).slice(0, 40) }; })));
      if (hm && process.env.DBG3) console.log('SCALE', JSON.stringify(await p.evaluate(() => { const c = window.STRYKER_VELA.chart, st = window.__stkFlow.domDebug(), o = c.orchestrator, vr = c.getVisibleRange(), rb = o.rawBars.filter((b) => b.time >= vr.from && b.time <= vr.to); return { scale: [st.scaleMin, st.scaleMax], vis: [Math.min(...rb.map((b) => b.low)), Math.max(...rb.map((b) => b.high))], n: rb.length, fitBtn: !!document.querySelector('.vela-fit-price, [data-fit-price]'), api: Object.getOwnPropertyNames(Object.getPrototypeOf(c)).filter((k) => /scale|fit|auto|range/i.test(k)) }; })));
      if (process.env.DBG5) console.log('LAYERS', JSON.stringify(await p.evaluate(() => { const cs = [...document.querySelectorAll('#vela-chart canvas')]; if (!cs.length) return []; const par = cs[0].parentElement; return [...par.children].filter((c) => c.tagName === 'CANVAS').map((c, i) => { let d; try { d = c.getContext('2d').getImageData(0, Math.floor(c.height * 0.3), c.width, 1).data; } catch (e) { return [i, -1, 0]; } let n = 0, op = 0; for (let k = 3; k < d.length; k += 4) { if (d[k] > 0) n++; if (d[k] > 250) op++; } return [i, n, op]; }).filter((x) => x[1] > 0); })));
      if (process.env.DBG6) {   // which canvas draws the thin vertical / horizontal stripes? hide one canvas at a time and compare a screenshot strip
        const png = require('fs');
        const n = await p.evaluate(() => document.querySelectorAll('#vela-chart canvas').length);
        for (let k = 0; k < n; k++) {
          const info = await p.evaluate((k) => { const c = document.querySelectorAll('#vela-chart canvas')[k]; let nz = 0; try { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let q = 3; q < d.length; q += 4 * 61) if (d[q]) nz++; } catch (e) {} return nz; }, k);
          if (!info) continue;
          await p.evaluate((k) => { document.querySelectorAll('#vela-chart canvas')[k].style.visibility = 'hidden'; }, k);
          await p.screenshot({ path: OUT + '/dbg6-hide-' + k + '.png' });
          await p.evaluate((k) => { document.querySelectorAll('#vela-chart canvas')[k].style.visibility = ''; }, k);
          console.log('DBG6 hid canvas', k, 'nonzero', info);
        }
      }
      if (process.env.DBG7) console.log('TAIL', JSON.stringify(await p.evaluate(() => { const d = window.__stkFlow.domDebug(); return { cols: d.columns, samples: d.samples, hist: d.histFrom && new Date(d.histFrom).toISOString().slice(11, 19), bm: d.bm, w: d.width, heatX0: d.heatX0, now: new Date().toISOString().slice(11, 19) }; })));
      const nSock = await p.evaluate(() => window.__wsOpened);
      // candles: the hub's ticks + 1m bars carry the chart past the 10-min delayed bars; no gap, no duplicate; pill hidden; back on drop
      const cd = await p.evaluate(() => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars.map((x) => x.time); return { n: rb.length, last: rb[rb.length - 1], tail: rb.slice(-16), now: Date.now() }; });
      const minNow = Math.floor(cd.now / 60000) * 60000;
      check(cd.last >= minNow - 60000, tag + ': newest candle is the current minute (not 10 min behind)', { lag: Math.round((cd.now - cd.last) / 60000) });
      check(cd.tail.every((t, i, a) => i === 0 || (a[i] > a[i - 1] && (a[i] - a[i - 1]) % 60000 === 0)), tag + ': candles strictly increasing, whole minutes (no duplicate bar)', cd.tail.slice(-5));
      check(cd.tail.every((t, i, a) => i === 0 || a[i] - a[i - 1] === 60000) || process.env.CME_CLOSED, tag + ': no gap in the last 15 candles', cd.tail.slice(-5));
      check(await p.evaluate(() => { const pl = document.getElementById('stkdp'); return !pl || pl.hidden || getComputedStyle(pl).display === 'none'; }), tag + ': delayed pill hidden while Live L2 feeds the chart');
      await p.evaluate(() => window.__l2ws.close());
      await sleep(700);
      check(await p.evaluate(() => !(window.__stkL2Live && window.__stkL2Live.has('NQ'))), tag + ': L2 drop releases the candle feed');
      check(await p.evaluate(() => { const pl = document.getElementById('stkdp'); return !!pl && !pl.hidden; }), tag + ': delayed pill is back after the drop');
      await sleep(4000);   // the hook reconnects on its own backoff
      const n = nSock;
      check(n === 1, tag + ': ONE browser socket shared by dom + imbalance (+ ladder)', n);
      check((await canv(p)) > 300, tag + ': heatmap / depth pixels drawn', await canv(p));
      const txt = await p.evaluate(() => document.body.innerText);
      check(!/real-?time/i.test(txt), tag + ': no "real-time" wording');
      await p.screenshot({ path: OUT + '/l2-' + tag + '-heatmap.png' });
      // walls view with PULLED / CONSUMED tags
      await add(p, 'stk_fut_walls');
      await sleep(3000);
      await p.screenshot({ path: OUT + '/l2-' + tag + '-walls.png' });
      // The old DOM ladder (#stkl2) was replaced by the Book/DOM/Trades panel (chart-book-panel.js, build 8xx); its rows, centring,
      // traded-at-price column and phone sheet are asserted in book-panel-browser.js. Kept here: the phone header and page overflow.
      // phone: the top-bar symbol button is abbreviated now (icons share the bar); the chart legend carries the full symbol
      if (mobile) check(await p.evaluate(() => /NQ1!\s*·\s*CME/.test(document.getElementById('vela-chart').parentElement.innerText + document.body.innerText)), tag + ': legend shows "NQ1! · CME" in full');
      check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ': no horizontal overflow');
      await p.screenshot({ path: OUT + '/l2-' + tag + '-heatmap2.png' });
      if (hm) {   // C: with the DOM ladder open, depth bars + sizes on and (FARBOOK) a +-2% live column, the axis still fits the candles
        const sc = await p.evaluate(() => { const c = window.STRYKER_VELA.chart, st = window.__stkFlow.domDebug(), vr = c.getVisibleRange(), rb = c.orchestrator.rawBars.filter((b) => b.time >= vr.from && b.time <= vr.to); return { lo: st.scaleMin, hi: st.scaleMax, cl: Math.min(...rb.map((b) => b.low)), ch: Math.max(...rb.map((b) => b.high)) }; });
        const pad = (sc.ch - sc.cl) * 0.6 + 20;
        console.log('INFO ' + tag + ' axis', JSON.stringify(sc));
        check(sc.lo >= sc.cl - pad && sc.hi <= sc.ch + pad, tag + ': price axis fits the candles (not the book / far strip)', sc);
      }
      check(errors.length === 0, tag + ': no console errors', errors);
      await ctx.close();
    }
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
