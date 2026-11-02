// DOM ladder root resolution (futures:, rith:, bare, contract months, symbol switch, active cell). Fixture WS, no Worker.
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
    setTimeout(() => {
      ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage && ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) });
      // the hub's last 15 min of 1m candles (what the 10-min-delayed lane has not delivered yet)
      const m0 = Math.floor(Date.now() / 60000) * 60000, mid0 = window.__L2MID || 21000, b = [];
      for (let k = 15; k >= 0; k--) { const o = mid0 + Math.sin(k) * 4; b.push([m0 - k * 60000, o, o + 6, o - 5, o + 2, 300 + k]); }
      ws.onmessage({ data: JSON.stringify({ type: 'bars', symbol: 'NQ', b }) });
    }, 50);
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
  });
  await sleep(800);
}
const add = (p, type, inputs) => p.evaluate(([t, i]) => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator(t, { inputs: i || {} }); window.STRYKER_VELA.context().stateChanged(); }, [type, inputs]);
const pickerHas = (p) => p.evaluate(() => { const t = document.body.innerText; return /Futures DOM Heatmap \(L2\)|Liquidity Walls \(L2\)|Book Imbalance \(L2\)/.test(t); });
const canv = (p) => p.evaluate(() => { let best = 0; for (const c of document.querySelectorAll('#vela-chart canvas')) { if (!c.width) continue; const g = c.getContext('2d'); if (!g) continue; let d; try { d = g.getImageData(0, 0, c.width, c.height).data; } catch (e) { continue; } let n = 0; for (let i = 3; i < d.length; i += 64) if (d[i] > 0) n++; best = Math.max(best, n); } return best; });

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const { ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true, admin: true, theme: 'dark' });
    const root = () => p.evaluate(() => (document.querySelector('.stkl2-sym') || {}).textContent || '');
    const info = () => p.evaluate(() => ({ rows: document.querySelectorAll('.stkl2-row').length, empty: (document.querySelector('.stkl2-empty') || {}).textContent || '' }));
    const setSym = async (s) => { await p.evaluate((s) => window.STRYKER_VELA.active.setSymbol(s), s); await sleep(1500); };
    const act = (id) => p.evaluate((id) => { const ws = window.STRYKER_VELA; (ws.setActive || ws.setActiveCell).call(ws, id); }, id);
    await p.evaluate(() => window.__stkL2Ladder.open()); await sleep(800);
    for (const [s, want] of [['futures:NQ1!', 'NQ'], ['futures:MNQ1!', 'MNQ'], ['futures:MES1!', 'MES'], ['futures:CL1!', 'CL'], ['futures:GC1!', 'GC'], ['CME_MINI:MNQ1!', 'MNQ'], ['MNQ1!', 'MNQ'], ['futures:MNQZ2026', 'MNQ'], ['rith:MNQZ6', 'MNQ'], ['futures:NQ1!', 'NQ']]) {
      await setSym(s); const r = await root(), i = await info();
      check(r === want && !i.empty.includes('Open an'), 'switch ' + s + ' -> ' + want, [r, i]);
      if (s === 'futures:MNQ1!') await p.screenshot({ path: OUT + '/dom-mnq-390-dark.png' });
    }
    await setSym('BINANCE:BTCUSDT'); check((await root()) === '', 'crypto -> empty', await root());
    await setSym('futures:MNQ1!');
    await p.evaluate(async () => { window.STRYKER_VELA.setLayout('2h'); await new Promise((r) => setTimeout(r, 1500)); });
    const ids = await p.evaluate(() => window.STRYKER_VELA.cells().map((c) => c.id));
    check(ids.length >= 2, '2 cells', ids);
    await act(ids[1]); await p.evaluate(() => window.STRYKER_VELA.active.setSymbol('futures:GC1!')); await sleep(1500);
    check((await root()) === 'GC', 'cell 2 GC', await root());
    await act(ids[0]); await sleep(1500);
    check((await root()) !== 'GC' && (await root()) !== '', 'cell 1 active -> its own root', await root());
    await act(ids[1]); await sleep(1500);
    check((await root()) === 'GC', 'back to cell 2 -> GC', await root());
    await p.screenshot({ path: OUT + '/dom-2cell-390-dark.png' });
    check(!errors.length, 'no console errors', errors);
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
