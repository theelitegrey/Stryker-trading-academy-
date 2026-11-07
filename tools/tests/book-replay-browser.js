// ORDER BOOK REPLAY (BOOK-REPLAY 2026-11-07): during Charts bar replay the Book / DOM panel, the futures DOM heatmap (L2) and the
// Depth Heatmap (L2) show the RECORDED book at the replay clock, never the current one.
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/book-replay-browser.js <shotsDir>
// FIXTURE data only: the fake /ts-live hub streams a CURRENT book around 28,750; the fake /ts-book-history holds one recorded sample
// a minute around 25,600 (the bars' own price) for the last 5 h. A panel that still showed the current book would show 28,7xx.
// Checks (1440 dark, 1440 light, 390 dark): panel says Replay + "book at HH:MM:SS" <= the clock, best bid = the recorded one at the
// clock, a step forward moves the book with the bar, history read in aligned 1 h chunks, both heatmaps cut at the clock, no
// console errors; after exit the panel is back on the current book.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };

const MIN = 60000, TICK = 0.25, NOW = Math.floor(Date.now() / MIN) * MIN;
const FIRST = NOW - 300 * MIN;
const price = (m) => 25600 + Math.sin(m / 17) * 30 + Math.sin(m / 5) * 7;
const recBid = (t) => Math.floor((price(t / MIN) - 0.25) / TICK) * TICK;   // the recorded best bid of the minute starting at t
const BARS = [];
for (let t = FIRST; t <= NOW; t += MIN) {
  const m = t / MIN, o = Math.round(price(m) / TICK) * TICK, c = Math.round(price(m + 1) / TICK) * TICK;
  BARS.push([t / 1000, o, Math.max(o, c) + 3, Math.min(o, c) - 3, c, 400 + (m % 7) * 30]);
}

function fakeWs() {
  window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    const send = (o) => ws.onmessage && ws.onmessage({ data: JSON.stringify(o) });
    let n = 0;
    setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); send({ event: 'hub_attached', state: 'live', tier: 'book', symbols: ['NQ'], trades: ['NQ'] }); send({ event: 'status', state: 'live' }); }, 50);
    ws.iv = setInterval(() => {   // the CURRENT book, far from the recorded one
      if (ws.readyState !== 1) return; n++;
      const bid = 28750, ask = 28750.25, bids = [], asks = [];
      for (let j = 0; j < 60; j++) { bids.push([bid - j * 0.25, 10 + (j % 5)]); asks.push([ask + j * 0.25, 9 + (j % 4)]); }
      send({ type: 'snap', symbol: 'NQ', ts: Date.now(), bids, asks, imb: 0, imb10: 0 });
    }, 200);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile, colorScheme: theme });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeWs);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.removeItem('stkbp.v1'); localStorage.removeItem('stryker_bar_replay_v1'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => {
    const u = new URL(r.request().url()), to = Number(u.searchParams.get('to')) * 1000 || Infinity;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page: 0, bars: BARS.filter((x) => x[0] * 1000 <= to) }) });
  });
  const asked = [];
  await ctx.route(/127\.0\.0\.1:9\/ts-book-history/, async (r) => {
    const { encodeSamples } = await import('../../workers/book-recorder/src/bucket.js');
    const u = new URL(r.request().url()), from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to')), out = [];
    asked.push([from, to]);
    for (let t = Math.ceil(Math.max(from, FIRST) / MIN) * MIN; t <= Math.min(to, NOW); t += MIN) {
      const mid = price(t / MIN), step = 2.5, bb = recBid(t), ba = bb + TICK, i0 = Math.floor(mid * 0.995 / step), len = Math.ceil(mid * 0.01 / step) + 2, v = new Float32Array(len);
      const im = Math.floor(mid / step);
      for (let k = 0; k < len; k++) { const i = i0 + k; if (i === im) continue; const q = 20 + ((i * 7) % 13) * 4 + (k % 17 === 0 ? 300 : 0); v[k] = i < im ? q : -q; }
      out.push({ ts: t, mid, bb, ba, step, i0, v });
    }
    r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'x-ts-fill-left': '0', 'access-control-expose-headers': 'x-ts-fill-left' }, body: Buffer.from(encodeSamples(out)) });
  });
  await ctx.route(/127\.0\.0\.1:9\/(?!ts-book-history)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage(), errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|\/api\/chart\/stream|Failed to load resource|Ping received after close|Unexpected response code/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkBarReplay && window.__stkBookPanel, null, { timeout: 60000 });
  await sleep(1500);
  await p.evaluate(async () => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1');
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === 'futures:NQ1!' && c.orchestrator.rawBars.length > 50) break; }
  });
  return { ctx, p, errors, asked };
}
const panel = (p) => p.evaluate(() => {
  const st = document.querySelector('.stkbp-stat'), bid = document.querySelector('.stkbp-list .stkbp-r.is-bid'), f = window.__stkBookPanel._feed();
  const bb = f ? f.bb : null;
  return { stat: st ? st.innerText.replace(/\s+/g, ' ').trim() : '', bidRow: bid ? bid.innerText.replace(/\s+/g, ' ') : '', bb, key: f && f.key, empty: (document.querySelector('.stkbp-empty') || {}).textContent || '' };
});
const E = () => window.__stkBarReplay.state.E;

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, theme, tag] of [[1440, 900, false, 'dark', '1440-dark'], [1440, 900, false, 'light', '1440-light'], [390, 844, true, 'dark', '390-dark']]) {
      const { ctx, p, errors, asked } = await open(b, { w, h, mobile, theme });
      await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_fut_dom', { inputs: { look: 'Midnight' } }); });
      await p.evaluate(() => window.__stkBookPanel.open()); await sleep(2500);
      let s = await panel(p);
      check(/28,?750/.test(s.bidRow), tag + ': live: the panel shows the current book (28,750)', s);
      // ---- enter bar replay 2 h back, stepping 1 m
      const E0 = NOW - 120 * MIN, nLive = asked.length;   // reads before replay are the live heatmap's own (not chunked)
      await p.evaluate(async (e) => { await window.__stkBarReplay.setStepTf('1'); await window.__stkBarReplay.start(e); }, E0);
      for (let i = 0; i < 60; i++) { await sleep(250); if (await p.evaluate(() => window.__stkBarReplay.state.on && !window.__stkBarReplay.state.busy)) break; }
      await sleep(3500);
      const e1 = await p.evaluate(E);
      s = await panel(p);
      const want1 = recBid(Math.floor(e1 / MIN) * MIN);
      check(/Replay/.test(s.stat) && /book at \d\d:\d\d:\d\d/.test(s.stat), tag + ': replay: status says Replay + book time', s.stat);
      check(s.key && /\|rp$/.test(s.key), tag + ': replay: a separate replay feed (never the live one)', s.key);
      check(s.bb === want1 || (s.bb != null && Math.abs(s.bb - recBid(Math.floor(e1 / MIN) * MIN - MIN)) < 1e-9), tag + ': replay: best bid = the RECORDED one at the clock', { bb: s.bb, want: want1, E: new Date(e1).toISOString() });
      check(!/28,?7\d\d/.test(s.bidRow) && s.bidRow.length > 0, tag + ': replay: the DOM row is not the current book', s.bidRow);
      const rpAsked = asked.slice(nLive);
      check(rpAsked.length > 0 && rpAsked.every(([f, t]) => f % 3600000 === 0 && t - f === 3600000), tag + ': replay history read in aligned 1 h chunks', rpAsked.map((x) => x.map((y) => new Date(y).toISOString().slice(11, 16))));
      const d = await p.evaluate(() => window.__stkFlow.domDebug());
      check(d && d.replayCut === e1 && d.histTo <= e1 && d.samples > 10, tag + ': DOM heatmap (L2): recorded columns, none after the clock', d && { cut: d.replayCut, to: d.histTo, s: d.samples });
      await p.screenshot({ path: OUT + '/book-replay-' + tag + '.png' });
      // ---- step forward 5 bars: the book moves with the bars
      for (let k = 0; k < 5; k++) { await p.evaluate(() => window.__stkBarReplay.stepForward()); await sleep(300); }
      await sleep(1200);
      const e2 = await p.evaluate(E), s2 = await panel(p);
      const ok2 = [recBid(Math.floor(e2 / MIN) * MIN), recBid(Math.floor(e2 / MIN) * MIN - MIN)].includes(s2.bb);
      check(e2 > e1 && ok2, tag + ': step forward: the book follows the clock', { e1, e2, bb: s2.bb, want: recBid(Math.floor(e2 / MIN) * MIN) });
      // ---- Depth Heatmap (L2) in replay
      await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_depth_heat', {}); }); await sleep(3000);
      const dh = await p.evaluate(() => window.__stkFlow.dhDebug && window.__stkFlow.dhDebug());
      check(dh && dh.replay === true && dh.samples > 10, tag + ': Depth Heatmap (L2): replay frame from recorded samples', dh && { r: dh.replay, s: dh.samples });
      if (!mobile) { await p.evaluate(() => window.__stkBookPanel.setTab('dom')); await sleep(800); await p.screenshot({ path: OUT + '/book-replay-' + tag + '-dom.png' }); }
      // ---- exit: back to the current book
      await p.evaluate(() => window.__stkBarReplay.exit()); await sleep(3000);
      s = await panel(p);
      check(!/\|rp$/.test(String(s.key)) && /28,?750/.test(s.bidRow), tag + ': after exit: the current book again', s);
      check(errors.length === 0, tag + ': no console errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
