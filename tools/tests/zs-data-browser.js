// Zscript data hub browser test (derived from chart-l2-flow-browser.js; fixture hub frames + mocked GEX/ZoroOptions). Was: Order flow (L2) (assets/chart-l2-flow.js) browser test (derived from chart-book-pack-browser.js) with FIXTURE hub frames: all 6 indicators on NQ1! 1m, values change over 3 s, no console errors.
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
async function open(b, { w, h, mobile, admin, theme, extra }) {
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
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/gex-history/, (r) => {
    const now = Math.floor(Date.now() / 1000), t = [], day = [], x = [], s = [], cw = [], pw = [], zg = [], n = [], em = [], g = [];
    for (let i = 0; i < 90; i++) { t.push(now - (90 - i) * 120); day.push('2026-11-06'); x.push(''); s.push(700); cw.push(720); pw.push(680); zg.push(698 + (i % 5)); n.push(1); em.push([700, 6]); g.push([1, -2, -1, 1, 3, 0.5]); }
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ t, day, x, s, cw, pw, zg, n, em, k: [680, 690, 700, 710, 720, 730], g, fa: null }) });
  });
  await ctx.route(/\/api\/gex\/levels\/QQQ/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ call_wall: 720, put_wall: 680, zero_gamma: 699, spot: 700, fetched_at: Math.floor(Date.now() / 1000), max_pain: 705, market: { state: 'closed' },
    ladder: [{ strike: 680, gex: -2e6 }, { strike: 690, gex: -1e6 }, { strike: 700, gex: 1e6 }, { strike: 710, gex: 3e6 }, { strike: 720, gex: 5e5 }], futures: { NQ: { ratio: 41, basis: 0, levels: { spot: 28750, call_wall: 29520, put_wall: 27880, zero_gamma: 28650 } } } }) }));
  await ctx.route(/\/api\/zo\/summary/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ u: 'QQQ', built: Math.floor(Date.now() / 1000), spot: 700, zone: 'cushion', levels: { call: 720, put: 680, flip: 699, pin: 705 },
    nodes: [{ k: 710, g: 3 }, { k: 680, g: -2 }], ranges: [{ k: '0DTE', lo: 694, hi: 706 }, { k: 'Weekly', lo: 688, hi: 712 }], iv: { rank: 37, pct: 40, iv30: 22 }, pc: { volume: 0.83, oi: 0.9 } }) }));
  await require('./binance-mock.js').install(ctx);   // offline Binance for the BTC case (CI is geo-blocked)
  // the mock's backfill ids (now - i) are higher than its live ids (1, 2, ...), so the chart drops every live trade: give the backfill low ids
  await ctx.route(/api\.binance\.com\/api\/v3\/aggTrades|fapi\.binance\.com\/fapi\/v1\/aggTrades/, (r) => { const now = Date.now(); r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ a: i - 1000, p: '77000.00', q: '0.05', f: i - 1000, l: i - 1000, T: now - (200 - i) * 150, m: i % 2 === 0 }))) }); });
  if (extra) await extra(ctx);   // more init scripts / routes (tools/tests/zs-e2e-browser.js)
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|\/api\/chart\/stream|Failed to load resource|Ping received after close|status of 451|Unexpected response code: 451/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (process.env.WARN && m.type() === 'warning' && /TradeZoro/.test(m.text())) console.log('WARN', m.text().slice(0, 300)); });
  await p.goto(BASE + '/charts.html?zs=1', { waitUntil: 'domcontentloaded' });
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




// ---- Zscript data hub: one session per case, every namespace, evaluated with the pure ops (the same ones the worker uses) ----
const CALLS = ['book.bid(1)', 'book.ask(1)', 'book.bidsize(1)', 'book.asksize(1)', 'book.depth("bid",5)', 'book.imbalance(5)', 'book.wall("ask",50)', 'book.heat(PX)',
  'flow.buyvol', 'flow.sellvol', 'flow.delta', 'flow.cvd', 'flow.trades', 'flow.bigtrades(2)', 'flow.footprint(PX)', 'flow.poc', 'flow.vah', 'flow.val',
  'gex.callwall', 'gex.putwall', 'gex.flip', 'gex.zero_upper', 'gex.zero_lower', 'gex.net', 'gex.level(1)',
  'opt.node(1)', 'opt.range("0dte")', 'opt.ivrank', 'opt.pc', 'opt.maxpain', 'opt.zone'];
async function session([sym, tf, uses, wait, CALLS]) {
  const hub = await import('/assets/zs/data/hub.js?v=895'), ops = await import('/assets/zs/data/ops.js?v=895');
  hub.resetHubForTests();
  const ws = window.STRYKER_VELA, ch = ws.chart;
  const raw = ch.orchestrator.rawBars.map((b) => ({ time: b.time != null ? b.time : b.t, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
  const msgs = [], s = hub.getHub().open({ sessionId: 1, symbol: sym, provider: sym.split(':')[0], timeframe: tf, uses, post: (m) => msgs.push(m) });
  await new Promise((r) => setTimeout(r, 500)); s.setBars(raw);
  await new Promise((r) => setTimeout(r, wait));
  const frames = new Map(); let live = null;
  for (const m of msgs) { if (m.kind === 'zs.data.frames') m.frames.forEach(([t, f]) => frames.set(t, f)); if (m.kind === 'zs.data.live') { frames.set(m.t, m.frame); live = m.t; } }
  const lastT = raw[raw.length - 1].time, last = {};
  for (const ns of ['book', 'flow', 'gex', 'opt']) { const ts = [...frames.keys()].sort((a, b) => b - a).filter((t) => frames.get(t) && frames.get(t)[ns]); last[ns] = ts.length ? frames.get(ts[0]) : null; }
  const px = Math.round(raw[raw.length - 1].close * 4) / 4, out = {};
  for (const nm of CALLS) {
    const m = /^(\w+\.\w+)(?:\((.*)\))?$/.exec(nm), args = m[2] ? m[2].split(',').map((a) => (a === 'PX' ? px : /^"/.test(a) ? a.slice(1, -1) : Number(a))) : [];
    out[nm] = ops.evalData(m[1], last[m[1].split('.')[0]], args);
  }
  const init = msgs.find((m) => m.kind === 'zs.data.init'), cnt = (ns) => [...frames.values()].filter((f) => f && f[ns]).length;
  const bad = [...frames.entries()].filter(([t, f]) => t !== lastT && f && ((f.book && f.book.ts > t + init.tfMs) || (f.gex && f.gex.ts * 1000 > t + init.tfMs))).length;
  const res = { n: raw.length, tfMs: init && init.tfMs, status: init && init.status, notices: msgs.filter((m) => m.kind === 'zs.data.notice').map((m) => m.text), frames: frames.size,
    withBook: cnt('book'), withFlow: cnt('flow'), withGex: cnt('gex'), withOpt: cnt('opt'), live: !!live, lastHasOpt: !!(frames.get(lastT) && frames.get(lastT).opt), out, lookahead: bad, sockets: window.__wsOpened };
  s.close();
  return res;
}
module.exports = { open, setNQ, launch };
if (require.main === module) (async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, tf, tag] of [[1440, 900, false, '1', 'NQ-1440'], [390, 844, true, '5', 'NQ-390']]) {
      const { ctx, p, errors } = await open(b, { w, h, mobile, admin: true, theme: 'dark' });
      await setNQ(p);
      const r = await p.evaluate(session, ['futures:NQ1!', tf, ['book', 'flow', 'gex', 'opt'], 14000, CALLS]);
      console.log(tag, JSON.stringify(r).slice(0, 2200));
      check(r.status && r.status.book === 'ok' && r.status.flow === 'ok', tag + ': book + flow allowed on NQ (Pro/admin)', r.status);
      check(r.withBook >= 1 && r.out['book.bid(1)'] > 20000 && r.out['book.ask(1)'] > r.out['book.bid(1)'], tag + ': book.bid/ask real levels', [r.withBook, r.out['book.bid(1)'], r.out['book.ask(1)']]);
      check(r.out['book.depth("bid",5)'] > 0 && r.out['book.imbalance(5)'] !== null && Math.abs(r.out['book.imbalance(5)']) <= 1, tag + ': depth + imbalance', [r.out['book.depth("bid",5)'], r.out['book.imbalance(5)']]);
      check(r.withFlow >= 1 && r.out['flow.buyvol'] > 0 && r.out['flow.sellvol'] > 0 && r.out['flow.trades'] > 0, tag + ': flow buy/sell/trades', [r.withFlow, r.out['flow.buyvol'], r.out['flow.sellvol']]);
      check(r.out['flow.poc'] > 20000 && r.out['flow.vah'] >= r.out['flow.poc'] && r.out['flow.val'] <= r.out['flow.poc'], tag + ': poc / value area', [r.out['flow.poc'], r.out['flow.vah'], r.out['flow.val']]);
      check(r.status.gex === 'ok' && r.withGex >= 1 && r.out['gex.callwall'] > 20000 && r.out['gex.putwall'] < r.out['gex.callwall'], tag + ': gex walls on NQ prices', [r.status.gex, r.withGex, r.out['gex.callwall'], r.out['gex.putwall']]);
      check(r.out['gex.net'] !== null && r.out['gex.flip'] > 20000, tag + ': gex net + flip', [r.out['gex.net'], r.out['gex.flip']]);
      check(r.status.opt === 'na' && r.notices.some((t) => /ZoroOptions/.test(t)) && r.out['opt.pc'] === null, tag + ': opt = na + one notice while the ZoroOptions flag is off', [r.status.opt, r.notices]);
      check(r.lookahead === 0, tag + ': no frame carries data newer than its bar close', r.lookahead);
      check(r.sockets <= 1, tag + ': at most the chart\'s own hub socket (no new sockets)', r.sockets);
      check(errors.length === 0, tag + ': no console errors', errors.slice(0, 3));
      await ctx.close();
    }
    {
      const { ctx, p } = await open(b, { w: 1440, h: 900, admin: true, theme: 'dark' });
      await p.evaluate(() => localStorage.setItem('stk_zoro_options', '1'));
      await setNQ(p);
      const r = await p.evaluate(session, ['futures:NQ1!', '1', ['opt', 'gex'], 7000, CALLS]);
      console.log('NQ-zoro', JSON.stringify(r.out), JSON.stringify(r.status), r.notices);
      check(r.status.opt === 'ok' && r.withOpt >= 1, 'zoro on: opt allowed + frames', [r.status, r.withOpt]);
      check(r.out['opt.ivrank'] === 37 && r.out['opt.pc'] === 0.83 && r.out['opt.zone'] === 'cushion', 'opt.ivrank / pc / zone from the summary', [r.out['opt.ivrank'], r.out['opt.pc'], r.out['opt.zone']]);
      check(Array.isArray(r.out['opt.range("0dte")']) && r.out['opt.range("0dte")'][0] > 20000 && r.out['opt.node(1)'] > 20000, 'opt.range / node on NQ prices', [r.out['opt.range("0dte")'], r.out['opt.node(1)']]);
      check(r.out['opt.maxpain'] > 20000, 'opt.maxpain mapped to NQ', r.out['opt.maxpain']);
      check(r.lastHasOpt, 'the forming bar carries an opt frame');
      await ctx.close();
    }
    {
      const { ctx, p } = await open(b, { w: 1440, h: 900, admin: true, theme: 'dark' });
      await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('binance:BTCUSDT'); ws.active.setTimeframe('1'); for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === 'binance:BTCUSDT' && c.orchestrator.rawBars.length > 50) break; } });
      const r = await p.evaluate(session, ['binance:BTCUSDT', '1', ['book', 'flow', 'gex', 'opt'], 80000, CALLS]);   // the mock's 30 s trade backfill covers a bar only after the next minute starts
      console.log('BTC', JSON.stringify(r).slice(0, 1500));
      check(r.status.book === 'ok' && r.out['book.bid(1)'] > 1000 && r.out['book.ask(1)'] > r.out['book.bid(1)'], 'BTC: book.bid/ask', [r.status, r.out['book.bid(1)']]);
      check(r.status.flow === 'ok' && r.out['flow.trades'] > 0 && r.out['flow.buyvol'] + r.out['flow.sellvol'] > 0, 'BTC: flow from the trade feed', [r.status.flow, r.out['flow.trades']]);
      check(r.status.gex === 'na' && r.status.opt === 'na' && r.out['gex.flip'] === null && r.out['opt.pc'] === null, 'BTC: gex/opt na + notice', [r.status, r.notices]);
      await ctx.close();
    }
    {
      const { ctx, p } = await open(b, { w: 1440, h: 900, admin: false });
      await p.evaluate(() => { window.__stkChartTestFree = true; });
      await setNQ(p);
      const r = await p.evaluate(session, ['futures:NQ1!', '1', ['book', 'flow', 'gex', 'opt'], 3000, CALLS]);
      check(['book', 'flow', 'gex', 'opt'].every((k) => r.status[k] === 'locked') && r.withBook === 0 && r.withFlow === 0 && r.withGex === 0, 'Free: all four locked, no data frames', [r.status, r.withBook]);
      check(r.notices.length === 4 && r.out['book.bid(1)'] === null && r.out['gex.flip'] === null, 'Free: na values + four one-time notices', [r.notices.length]);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
