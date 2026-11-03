// Order-book pack (assets/chart-book-pack.js) browser test with FIXTURE hub frames: all 6 indicators on NQ1! 1m, values change over 3 s, no console errors.
//   node tools/tests/chart-dev-server.mjs 8022 &   CHART_BASE=http://127.0.0.1:8022 node tools/tests/chart-book-pack-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const REAL = process.env.REAL ? JSON.parse(fs.readFileSync(process.env.REAL, 'utf8')) : null;   // real archive + live snapshot (ts-l2-real-fetch.mjs)
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const window_mid = () => 28750;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
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
      ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) });
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
      send({ type: 'ticks', symbol: 'NQ', t: [[bid, 1 + (n % 7), -1, Date.now()], [ask, 2 + (n % 5), 1, Date.now()], ...(cyc === 3 ? [[ask + 0.5, 110, 1, Date.now()]] : [])] });
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
    for (let k = 0; k < 30; k++) fp.push({ t: m0 + k, lv: [0, 1, 2, 3, 4].map((j) => [P + j * 0.25, 5, 5]) });
    fp.push({ t: m0 + 30, lv: [[P + 0.5, 10, 200], [P + 0.75, 10, 10]] });
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ fp, imb: [] }) });
  });
  await ctx.route(/127\.0\.0\.1:9\/(?!ts-book-history|ts-aux)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage();
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
const _unused = (p) => 0; const pickerHas = (p) => p.evaluate(() => { const t = document.body.innerText; return /Futures DOM Heatmap \(L2\)|Liquidity Walls \(L2\)|Book Imbalance \(L2\)/.test(t); });
const canv = (p) => p.evaluate(() => { let best = 0; for (const c of document.querySelectorAll('#vela-chart canvas')) { if (!c.width) continue; const g = c.getContext('2d'); if (!g) continue; let d; try { d = g.getImageData(0, 0, c.width, c.height).data; } catch (e) { continue; } let n = 0; for (let i = 3; i < d.length; i += 64) if (d[i] > 0) n++; best = Math.max(best, n); } return best; });


const TYPES = (process.env.TYPES || 'stk_bk_speed,stk_bk_bal,stk_bk_refill,stk_bk_regime,stk_bk_large,stk_bk_track').split(',');
const read = (p) => p.evaluate(() => {
  const st = [...(window.__stkBookPackStores || new Map()).values()][0];
  const v = st && st.views.get(20), rf = st && [...st.refills.values()][0], lg = st && [...st.larges.values()][0];
  const tabs = [...document.querySelectorAll('.stkchart-panel *')].length;
  return { stores: window.__stkBookPackStores ? window.__stkBookPackStores.size : -1, v: st ? st.v : -1, bid: v ? v.cur.bid : -1, ask: v ? v.cur.ask : -1, speedN: v ? v.speed.t.length : -1, sd: v && v.cur.sd,
    abs: st ? st.absEv.length : -1, absSum: st ? st.absEv.reduce((a, e) => a + e.d, 0) : 0, hid: document.hidden, refills: rf ? rf.events.length : -1, thr: lg ? lg.thr : -1, live: lg ? lg.tr.live.size : -1, perf: window.__stkBookPack || {}, tabs };
});
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    // non-admin: the six are not offered and nothing opens
    {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900, admin: false });
      await setNQ(p);
      const has = await p.evaluate((T) => { try { const c = window.STRYKER_VELA.context().cells[0].chart; return (c.nativeCatalog ? c.nativeCatalog() : []).map((x) => x.type || x.id).filter((t) => T.includes(t)); } catch (e) { return ['err']; } }, TYPES);
      check(has.length === 0, 'non-admin: no book-pack indicator in the catalog', has);
      check((await p.evaluate(() => window.__wsOpened)) === 0, 'non-admin: no socket opened');
      check(errors.length === 0, 'non-admin: no console errors', errors);
      await ctx.close();
    }
    for (const [w, h, mobile, theme, tag] of (process.env.ONE ? [[1440, 900, false, 'dark', '1440-dark']] : [[1440, 900, false, 'dark', '1440-dark'], [1440, 900, false, 'light', '1440-light'], [390, 844, true, 'dark', '390-dark'], [390, 844, true, 'light', '390-light']])) {
      const { ctx, p, errors } = await open(b, { w, h, mobile, admin: true, theme });
      await setNQ(p);
      for (const t of TYPES) await add(p, t);
      await sleep(12000);
      const a = await read(p); await sleep(3000); let c = await read(p);
      for (let k = 0; k < 10 && c.refills < 1; k++) { await sleep(1500); c = await read(p); }   // a loaded machine drops fixture frames
      check(a.stores === 1, tag + ': one shared store for six indicators', a.stores);
      check(c.v > a.v && c.speedN > a.speedN - 1, tag + ': book updates keep coming (' + a.v + ' -> ' + c.v + ')');
      check(c.bid > 0 && c.ask > 0 && (c.bid !== a.bid || c.ask !== a.ask), tag + ': liquidity values change over 3 s (bid ' + a.bid + ' -> ' + c.bid + ')', [a, c]);
      check(c.speedN >= 5, tag + ': book speed has per-second samples (' + c.speedN + ')');
      check(c.refills >= 1, tag + ': refill detector found the fixture refills (' + c.refills + ')', c);
      check(c.thr > 0 && c.live >= 1, tag + ': large resting orders threshold learned (' + c.thr + ', live ' + c.live + ')', c);
      check(c.abs >= 1 && c.absSum >= 1, tag + ': absorption tracker subscribed: the fixture absorption minute counts, buy side up (' + c.abs + ')', c);
      for (const t of TYPES) { const m = c.perf[t]; check(m && m.renders > 3 && m.avgMs < 2.5, tag + ': ' + t + ' avg ' + (m ? m.avgMs.toFixed(2) : '?') + ' ms per draw (limit 2.5 on this shared, software-rendered browser; draws run at most 5 a second), ' + (m && m.renders) + ' draws', m); }
      const cnt = await p.evaluate(() => (window.STRYKER_VELA.context().cells[0].chart.indicators() || []).filter((h) => /^stk_bk_/.test(h.nativeType)).length);
      check(cnt === TYPES.length, tag + ': six indicators on the chart', cnt);
      // hidden tab: no work
      const before = await p.evaluate(() => JSON.stringify(window.__stkBookPack));
      check(errors.length === 0, tag + ': no console errors', errors);
      await p.screenshot({ path: OUT + '/bk-' + tag + '.png' });
      await ctx.close();
    }
    // hidden tab: no book work while hidden
    {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900, admin: true, theme: 'dark' });
      await setNQ(p); for (const t of TYPES) await add(p, t); await sleep(4000);
      await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(300); const a = await read(p); const pa = JSON.stringify(a.perf); await sleep(3000); const c = await read(p);
      check(c.v === a.v && JSON.stringify(c.perf) === pa, 'hidden tab: no book updates and no redraws (' + a.v + ' -> ' + c.v + ')', [a.v, c.v]);
      await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(2500); const d = await read(p);
      check(d.v > c.v, 'visible again: updates resume (' + c.v + ' -> ' + d.v + ')');
      check(errors.length === 0, 'hidden tab: no console errors', errors);
      await ctx.close();
    }
    // crypto book (BTC on Binance): fake REST depth + stream
    {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(() => {
        const Real = window.WebSocket; window.__cws = 0;
        window.WebSocket = function (url, proto) {
          if (!/stream\.binance|fstream\.binance/.test(String(url))) return new Real(url, proto);
          window.__cws++;
          const ws = { readyState: 1, send() {}, close() { clearInterval(this.iv); this.onclose && this.onclose({}); } };
          let n = 0, u = 1000;
          setTimeout(() => ws.onopen && ws.onopen(), 20);
          ws.iv = setInterval(() => {
            n++; u++;
            const row = (p, q) => [String(p), String(q)];
            const d = { e: 'depthUpdate', u, b: [row(67000 - (n % 5) * 0.1, 1 + n)], a: [row(67000.1 + (n % 4) * 0.1, 2 + n)] };
            ws.onmessage && ws.onmessage({ data: JSON.stringify({ data: d }) });
            if (n % 3 === 0) ws.onmessage({ data: JSON.stringify({ data: { e: 'aggTrade', T: Date.now(), p: '67000.1', q: '0.5', m: n % 2 === 0 } }) });
          }, 100);
          return ws;
        };
      });
      await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); } catch (e) {} });
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => {
        const u = r.request().url();
        if (/api\.binance\.com\/api\/v3\/depth/.test(u)) {
          const bids = [], asks = []; for (let j = 0; j < 100; j++) { bids.push([String(67000 - j * 0.1), String(1 + (j % 7))]); asks.push([String(67000.1 + j * 0.1), String(1 + (j % 5))]); }
          return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ lastUpdateId: 1, bids, asks }) });
        }
        if (/aggTrades/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' });
        return r.abort();
      });
      const p = await ctx.newPage(); const errors = [];
      p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|Failed to load resource|Unexpected re/.test(m.text())) errors.push(m.text()); });
      p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
      await sleep(2000);
      await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('binance:BTCUSDT'); ws.active.setTimeframe('1'); await new Promise((r) => setTimeout(r, 2500)); });
      for (const t of TYPES) await add(p, t);
      await sleep(6000);
      const a = await read(p); await sleep(3000); const c = await read(p);
      check(a.stores === 1 && (await p.evaluate(() => window.__cws)) >= 1, 'crypto: one store, exchange stream opened', a.stores);
      check(c.v > a.v && c.bid > 0 && c.ask > 0 && (c.bid !== a.bid || c.ask !== a.ask), 'crypto: BTC book values change over 3 s (bid ' + a.bid + ' -> ' + c.bid + ')', [a, c]);
      check(c.speedN >= 5, 'crypto: book speed has samples (' + c.speedN + ')');
      check(errors.length === 0, 'crypto: no console errors', errors);
      await p.screenshot({ path: OUT + '/bk-crypto-1440.png' });
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'all passed');
  process.exit(fail ? 1 : 0);
})();
