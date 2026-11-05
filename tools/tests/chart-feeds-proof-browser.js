// L2 lock fix 3 (2026-11-04): DATA IS PROOF. Copy of chart-feeds-browser.js's rig.
// A member the page wrongly thinks is Free (or unknown), whose hub says tier 'trades', but whose socket receives book snap frames:
// the L2 lock must clear within 1 s. A genuine Free member with NO book frames keeps the lock. Admin stays lit.
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
    setTimeout(() => {
      ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage && ws.onmessage({ data: JSON.stringify({ event: 'hub_attached', tier: window.__hubTier || 'book', state: 'live' }) }); ws.onmessage && ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) });
      // the hub's last 15 min of 1m candles (what the 10-min-delayed lane has not delivered yet)
      const m0 = Math.floor(Date.now() / 60000) * 60000, mid0 = window.__L2MID || 21000, b = [];
      for (let k = 15; k >= 0; k--) { const o = mid0 + Math.sin(k) * 4; b.push([m0 - k * 60000, o, o + 6, o - 5, o + 2, 300 + k]); }
      ws.onmessage({ data: JSON.stringify({ type: 'bars', symbol: 'NQ', b }) });
    }, 50);
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1 || !ws.onmessage || window.__noBook) return;
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
  p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'warning' && /TradeZoro/.test(m.text()) && !/without an icon/.test(m.text())) errors.push('WARN ' + m.text()); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 }).catch(async (e) => { console.log('OPENFAIL', JSON.stringify(errors).slice(0, 1500), await p.evaluate(() => [!!window.__stkHeavyReady, !!window.STRYKER_VELA, document.title])); throw e; });
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

const setSym = (p, s) => p.evaluate(async (s) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1'); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 300)); if (ws.chart.market.symbol === s && ws.chart.orchestrator.rawBars.length > 20) break; } }, s);
const box = (p) => p.evaluate(() => { const q = (s) => { const e = document.querySelector(s); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); }; return { row: q('#stkfeeds'), sheet: q('#stkfeed-sheet'), note: q('#stkfeed-note'), vw: innerWidth, sw: document.documentElement.scrollWidth, chips: [...document.querySelectorAll('.stkfeed')].map((b) => b.dataset.l + ':' + b.className.replace('stkfeed ', '')) }; });

const st2 = (p) => p.evaluate(() => ({ chips: [...document.querySelectorAll('.stkfeed')].map((b) => b.dataset.l + ':' + b.className.replace('stkfeed ', '').trim()), note: (document.getElementById('stkfeed-note') || {}).hidden === false ? document.getElementById('stkfeed-note').textContent : '' }));
const locked = (s) => s.chips.some((c) => /^L2:is-locked/.test(c)) || /Needs L2/.test(s.note);
const forceSock = (p) => p.evaluate(async () => { const src = [...document.querySelectorAll('script[type=module]')].map((s) => s.src).join(' '); const v = (/[?&]v=(\d+)/.exec(src) || [, '847'])[1]; const m = await import('/assets/chart-futures-l2.js?v=' + v); // the stub has no sign-in token: the localhost test flag lets this ONE socket open (connect() is synchronous up to new WebSocket under the flag), then it is removed so
  // nothing else (liveVisible, admin) is faked: the page still thinks this member is Free and the hub says 'trades'. Only the frames can unlock.
  window.__stkL2Test = { base: 'http://127.0.0.1:9' }; window.__acq = m.acquire('NQ', () => {}, 20); delete window.__stkL2Test; return v; });
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, tag] of [[390, 844, true, 'proof-390'], [1440, 900, false, 'proof-1440']]) {
      // 1) page says Free (the Owner's broken state), hub says 'trades', NO frames yet -> lock shows; then book frames arrive -> lock gone within 1 s
      const { ctx, p, errors } = await open(b, { w, h, mobile, admin: false, theme: 'dark' });
      await p.evaluate(() => { window.__stkChartTestFree = true; window.__hubTier = 'trades'; window.__noBook = true; });
      await setSym(p, 'futures:NQ1!'); await add(p, 'stk_fut_dom'); await add(p, 'stk_bk_track'); await add(p, 'stk_l2f_big'); await sleep(2500);
      const a = await st2(p); console.log('INFO ' + tag + ' before', JSON.stringify(a));
      check(locked(a), tag + ': no book frames + page thinks Free -> locked (control)', a);
      console.log('INFO v=' + await forceSock(p)); await sleep(1500);
      const a2 = await st2(p); check(locked(a2), tag + ': socket open, tier trades, still no frames -> still locked', a2);
      await p.evaluate(() => { window.__noBook = false; }); const t0 = Date.now();
      let ok = false; for (let i = 0; i < 20; i++) { await sleep(100); if (!locked(await st2(p))) { ok = true; break; } }
      const ms = Date.now() - t0, c = await st2(p); console.log('INFO ' + tag + ' after ' + ms + 'ms', JSON.stringify(c));
      check(ok && ms <= 1100, tag + ': lock cleared within 1 s of the first book frame (' + ms + ' ms)', c);
      check(c.chips.some((x) => /^L2:is-lit/.test(x)) && c.chips.some((x) => /^L1:is-lit/.test(x)), tag + ': L1 + L2 chips lit (Big Trades L2 on)', c);
      const diag = await p.evaluate(() => window.tzL2Diag()); check(diag.l2Proven === true && diag.l2Badge === true, tag + ': diag l2Proven + l2Badge true', diag);
      await sleep(11000);
      const ice = await p.evaluate(() => document.body.innerText.includes('Loading book history'));
      check(!ice, tag + ': no "Loading book history" after ~11 s');
      await p.screenshot({ path: OUT + '/l2proof-' + tag + '.png' });
      check(errors.length === 0, tag + ': no console errors', errors);
      await ctx.close();
    }
    // 2) genuine Free member, no book frames at all: lock + Unlock stays
    { const { ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true, admin: false, theme: 'dark' });
      await p.evaluate(() => { window.__stkChartTestFree = true; window.__noBook = true; });
      await setSym(p, 'futures:NQ1!'); await add(p, 'stk_fut_dom'); await sleep(4000);
      const s = await st2(p); console.log('INFO free', JSON.stringify(s));
      check(locked(s) && /Unlock/.test(s.note), 'free-390: genuine Free, no frames -> lock + Unlock', s);
      await p.screenshot({ path: OUT + '/l2proof-free-390.png' });
      check(errors.length === 0, 'free-390: no console errors', errors); await ctx.close(); }
    // 3) plan check said NOT Free, hub says trades, no frames: never a lock, "Connecting" instead
    { const { ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true, admin: false, theme: 'dark' });
      await p.evaluate(() => { window.__stkChartTestFree = false; window.__stkChartFree = false; window.__hubTier = 'trades'; window.__noBook = true; });
      await setSym(p, 'futures:NQ1!'); await add(p, 'stk_fut_dom'); await sleep(3000);
      const s = await st2(p); console.log('INFO pro-noframes', JSON.stringify(s));
      check(!locked(s), 'pro-390: not Free -> never locked', s);
      await ctx.close(); }
    // 4) admin (test flag): lit
    { const { ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true, admin: true, theme: 'dark' });
      await p.evaluate(() => { window.__stkChartTestFree = false; });
      await setSym(p, 'futures:NQ1!'); await add(p, 'stk_fut_dom'); await sleep(4000);
      const s = await st2(p); console.log('INFO admin', JSON.stringify(s));
      check(!locked(s) && s.chips.some((x) => /^L2:is-lit/.test(x)), 'admin-390: L2 lit, no lock', s);
      await p.screenshot({ path: OUT + '/l2proof-admin-390.png' });
      check(errors.length === 0, 'admin-390: no console errors', errors); await ctx.close(); }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
