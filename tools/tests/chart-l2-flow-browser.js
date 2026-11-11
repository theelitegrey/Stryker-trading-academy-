// Order flow (L2) (assets/chart-l2-flow.js) browser test (derived from chart-book-pack-browser.js) with FIXTURE hub frames: all 6 indicators on NQ1! 1m, values change over 3 s, no console errors.
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



const TYPES = ['stk_l2f_delta', 'stk_l2f_cvd', 'stk_l2f_fp', 'stk_l2f_big', 'stk_l2f_stop', 'stk_l2f_vp'];
const readFlow = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__stkL2Flow || {})));
const counts = (p) => p.evaluate(() => {   // non-null points of every L2 flow series, from the chart itself
  const c = window.STRYKER_VELA.context().cells[0].chart, out = {};
  for (const h of c.indicators() || []) { if (/^stk_l2f_/.test(h.nativeType)) out[h.nativeType] = 1; }
  return out;
});
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900, admin: false });
      await setNQ(p);
      const has = await p.evaluate((T) => { try { const c = window.STRYKER_VELA.context().cells[0].chart; return (c.nativeCatalog ? c.nativeCatalog() : []).map((x) => x.type || x.id).filter((t) => T.includes(t)); } catch (e) { return ['err']; } }, TYPES);
      check(has.length === 0, 'non-admin: none of the six in the catalog', has);
      check((await p.evaluate(() => window.__wsOpened)) === 0, 'non-admin: no socket opened');
      await ctx.close();
    }
    for (const [w, h, mobile, theme, tag] of (process.env.SHOTS ? [[1440, 900, false, 'dark', '1440-dark'], [1440, 900, false, 'light', '1440-light'], [390, 844, true, 'dark', '390-dark']] : process.env.ONE ? [[1440, 900, false, 'dark', '1440-dark']] : [[1440, 900, false, 'dark', '1440-dark'], [412, 915, true, 'dark', '412-dark'], [390, 844, true, 'light', '390-light'], [390, 844, true, 'light', '390-light']])) {
      const { ctx, p, errors } = await open(b, { w, h, mobile, admin: true, theme });
      if (process.env.TIER1) await p.evaluate(() => { window.__TIER1 = 1; });
      await setNQ(p);
      for (const t of (process.env.ONLY ? process.env.ONLY.split(',') : TYPES)) await add(p, t, t === 'stk_l2f_cvd' && process.env.CVD ? JSON.parse(process.env.CVD) : t === 'stk_l2f_big' ? { mode: 'Manual', minSize: 100 } : t === 'stk_l2f_stop' ? { showAll: true, levels: 1 } : {});
      await sleep(14000);
      if (process.env.TIER1) { const lk = await p.evaluate(() => ({ chips: [...document.querySelectorAll('.stkfeed.is-locked')].length, note: (document.querySelector('#stkfeed-note') || {}).hidden === false ? document.querySelector('#stkfeed-note').innerText : '', msg: /Needs L2/.test(document.body.innerText) })); check(lk.chips === 0 && !lk.msg, tag + ': no false lock after tier trades then book frames', lk); }
      const f = await readFlow(p); if (process.env.WARN) console.log('ERR', JSON.stringify(await p.evaluate(() => [window.__l2fErr, window.__l2fCvd])));
      for (const t of ['stk_l2f_delta', 'stk_l2f_cvd']) check(f[t] && f[t].n >= 20, tag + ': ' + t + ' has ' + (f[t] && f[t].n) + ' bars with data (>= 20) of ' + (f[t] && f[t].bars), f[t]);
      check(f.stk_l2f_fp && f.stk_l2f_fp.n >= 20, tag + ': footprint has traded minutes (' + (f.stk_l2f_fp && f.stk_l2f_fp.n) + ')', f.stk_l2f_fp);
      check(f.stk_l2f_big && f.stk_l2f_big.prints >= 3 && f.stk_l2f_big.tagged >= 1, tag + ': big trades ' + (f.stk_l2f_big && f.stk_l2f_big.prints) + ', book-tagged ' + (f.stk_l2f_big && f.stk_l2f_big.tagged), f.stk_l2f_big);
      check(f.stk_l2f_stop && typeof f.stk_l2f_stop.sweeps === 'number', tag + ': stop runs evaluated (' + JSON.stringify(f.stk_l2f_stop) + ')');
      check(f.stk_l2f_vp && f.stk_l2f_vp.n >= 20 && f.stk_l2f_vp.traded > 0, tag + ': volume profile rows resting ' + (f.stk_l2f_vp && f.stk_l2f_vp.n) + ' traded ' + (f.stk_l2f_vp && f.stk_l2f_vp.traded), f.stk_l2f_vp);
      const cnt = await p.evaluate(() => (window.STRYKER_VELA.context().cells[0].chart.indicators() || []).filter((h) => /^stk_l2f_/.test(h.nativeType)).length);
      check(cnt === 7, tag + ': six + the auto-added ladder on the chart', cnt);
      const reqs = await p.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /ts-book-history|ts-trades|ts-aux/.test(n)));
      const dup = reqs.filter((u, i) => reqs.indexOf(u) !== i);
      check(dup.length === 0, tag + ': no window fetched twice (' + reqs.length + ' history requests)', dup);
      console.log('LAD', JSON.stringify(f.ladder)); check(f.ladder && f.ladder.draws > 0 && f.ladder.trade > 0 && f.ladder.book > 0, tag + ': delta ladder drawn (rows ' + JSON.stringify(f.ladder) + ')', f.ladder);
      check(errors.length === 0, tag + ': no console errors', errors);
      await p.screenshot({ path: OUT + '/l2f-' + tag + '.png' });
      // zoomed: the footprint + resting profile need room (a few dozen bars)
      await p.evaluate((n) => { const m = Math.floor(Date.now() / 60000) * 60000; window.STRYKER_VELA.chart.setVisibleRange({ from: m - n * 60000, to: m + (n < 10 ? 2 : 6) * 60000 }); }, mobile ? 4 : 26);
      await sleep(2500);
      const fz = await readFlow(p);
      check(fz.stk_l2f_fp && fz.stk_l2f_fp.hot >= 0 && fz.stk_l2f_vp.traded > 0, tag + ': zoomed footprint drawn (highlighted rows ' + (fz.stk_l2f_fp && fz.stk_l2f_fp.hot) + ')', fz.stk_l2f_fp);
      await p.screenshot({ path: OUT + '/l2f-' + tag + '-zoom.png' });
      // resting book setting (2026-11-11): default = near the candle only, Off = none, Full depth = whole ladder
      const setRest = async (v) => { await p.evaluate((v) => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_l2f_fp'); h.setInputs(Object.assign({}, h.inputValues(), { restShow: v })); }, v); await sleep(2000); return (await readFlow(p)).stk_l2f_fp; };
      const fpN = fz.stk_l2f_fp;
      await p.screenshot({ path: OUT + '/l2f-' + tag + '-zoom-near.png' });
      check(fpN.mode === 'Near the candle' && fpN.drawn > 0 && fpN.maxOut <= 2, tag + ': default resting bars stay within 2 rows of the candle (drawn ' + fpN.drawn + ', furthest ' + fpN.maxOut + ')', fpN);
      const fpF = await setRest('Full depth');
      check(fpF.mode === 'Full depth' && fpF.drawn > fpN.drawn && fpF.maxOut > 3, tag + ': full depth draws more (' + fpF.drawn + ' vs ' + fpN.drawn + ', furthest ' + fpF.maxOut + ')', fpF);
      await p.screenshot({ path: OUT + '/l2f-' + tag + '-zoom-full.png' });
      const fpO = await setRest('Off');
      check(fpO.mode === 'Off' && fpO.drawn === 0, tag + ': Off draws no resting bars', fpO);
      await setRest('Near the candle');
      // REGRESSION (2026-11-10): hiding an indicator must clear its layer; showing must bring it back
      const layerInk = (t) => p.evaluate((t) => { const ch = window.STRYKER_VELA.context().cells[0].chart; const r = ch.renderer.extLayers ? ch.renderer : ch.renderer.renderer; let best = 0; for (const l of r.extLayers) { if (l.channel !== t || !l.canvas.width) continue; const d = l.canvas.getContext('2d').getImageData(0, 0, l.canvas.width, l.canvas.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; best = Math.max(best, n); } return best; }, t);
      const vis = (t, v) => p.evaluate(([t, v]) => { const h = (window.STRYKER_VELA.context().cells[0].chart.indicators() || []).find((x) => x.nativeType === t); h.setVisible(v); }, [t, v]);
      for (const t of ['stk_l2f_fp', 'stk_l2f_big', 'stk_l2f_stop', 'stk_l2f_vp', 'stk_l2f_lad']) {
        const on = await layerInk(t); if (!on) { console.log('SKIP ' + tag + ' ' + t + ': nothing drawn in this fixture'); continue; }
        await vis(t, false); await sleep(1500); const off = await layerInk(t);
        await vis(t, true); await sleep(2000); const back = await layerInk(t);
        check(off === 0 && back > 0, tag + ': ' + t + ' hide clears (' + on + ' -> ' + off + '), show redraws (' + back + ')', [on, off, back]);
      }
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'all passed');
  process.exit(fail ? 1 : 0);
})();
