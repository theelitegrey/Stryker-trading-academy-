// Fixed Range Volume Profile (assets/chart-frvp.js) browser test: member report 11 Nov (lines run past B, clicks inside the range move it,
// thin rows, delta bars, anchored VWAP). NQ1! 1m on REAL recorded NQ order flow (fixtures/orderflow, 20-21 Oct, Pro test tier), plus BTCUSDT 1m
// on the offline Binance mock. Every non-local request is aborted.
//   node tools/tests/chart-fixture-server.mjs 8241 tools/tests/fixtures/monitor-live.json &
//   CHART_BASE=http://127.0.0.1:8241 flock /tmp/stryker-chrome.lock node tools/tests/frvp-browser.js <outDir> [after|before]
// "before" (origin/main served from a detached worktree) only takes the comparison screenshots and records what the old code does.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8241';
const OUT = process.argv[2] || '.';
const MODE = 'compvp';
const AFTER = MODE === 'after';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
const note = (msg, x) => console.log('NOTE ' + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400)));
const FIX = path.join(__dirname, 'fixtures');
const BODY = {};
for (const d of ['2026-10-20', '2026-10-21']) BODY[d] = zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'orderflow', 'NQ-' + d + '.bin.gz')));
const NOW = Date.UTC(2026, 9, 21, 17, 0);
let CAND = null;
async function candles(tfMin) {
  if (!CAND) {
    const D = await import(path.resolve(__dirname, '../../assets/chart-footprint-data.js'));
    CAND = { D, bars: [].concat(...Object.values(BODY).map((u) => D.decodeOrderflow(new Uint8Array(u)).bars)) };
  }
  return CAND.D.aggregate(CAND.bars, tfMin * 60000).map((b) => [b.t / 1000, b.o * 0.25, b.hi * 0.25, b.lo * 0.25, b.c * 0.25, b.vol]);
}

async function context(b, { w, h, mobile, theme, crypto }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([now, theme, crypto]) => {
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1');
      if (!sessionStorage.getItem('fr_once')) { sessionStorage.setItem('fr_once', '1'); localStorage.removeItem('vela-workspace'); localStorage.removeItem('vela-workspace-090'); localStorage.removeItem('stryker_bar_replay_v1'); }
      localStorage.setItem('stryker_theme', theme === 'light' ? 'day' : 'night');
    } catch (e) {}
    if (!crypto) {
      const RealDate = Date, off = now - RealDate.now();
      class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
      window.Date = FakeDate;
    }
    window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true };
    window.__stkChartTestFree = false;
  }, [NOW, theme, !!crypto]);
  if (crypto) await require('./binance-mock.js').install(ctx);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.|api\.binance\.com|data-api\.binance\.vision|fapi\.binance\.com)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, async (r) => {
    const u = new URL(r.request().url());
    const tf = Number(u.searchParams.get('tf')) || 1, page = Number(u.searchParams.get('page')) || 0;
    const bars = (await candles(tf)).filter((x) => x[0] * 1000 < NOW);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: String(tf), page, bars }) });
  });
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/stream/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/.*/, (r) => {
    const u = new URL(r.request().url()); const hdr = { 'access-control-allow-origin': '*' };
    const body = u.pathname === '/orderflow' && u.searchParams.get('sym') === 'NQ' && !(process.env.FR_GAP && u.searchParams.get('day') === '2026-10-20') && BODY[u.searchParams.get('day')];
    return body ? r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: hdr, body }) : r.fulfill({ status: 404, headers: hdr, body: '' });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|\/api\/chart\/stream|firebase|firestore|CORS|WebSocket|econ-calendar/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
  return { ctx, p, errors };
}
async function ready(p) {
  await p.waitForFunction(() => { try { return !!window.STRYKER_VELA.chart.renderer.renderer.userDrawings; } catch (e) { return false; } }, null, { timeout: 60000 });
  await sleep(2000);
}
async function setMarket(p, sym, tf) {
  await p.evaluate(async ([sym, tf]) => {
    const ws = window.STRYKER_VELA;
    ws.active.setSymbol(sym); ws.active.setTimeframe(tf);
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); const c = ws.chart; if (c.market.symbol === sym && c.orchestrator.rawBars.length > 50) break; }
  }, [sym, tf]);
  await sleep(1500);
}
// show the last n bars; returns plot rect + bar times
const view = (p, n) => p.evaluate((n) => {
  const ch = window.STRYKER_VELA.chart, R = ch.renderer.renderer, raw = ch.orchestrator.rawBars, last = raw[raw.length - 1].time;
  const tf = raw[raw.length - 1].time - raw[raw.length - 2].time;
  ch.setVisibleRange({ from: last - n * tf, to: last + 8 * tf });
  return true;
}, n);
// everything about the FRVP drawing (instance + geometry), in plot coordinates
const probe = (p) => p.evaluate(() => {
  const ch = window.STRYKER_VELA.chart, R = ch.renderer.renderer, U = R.userDrawings, proj = R.drawingProjector();
  const d = U.drawings.find((x) => x.type === 'fixedrangevp');
  const cr = R.input.el.getBoundingClientRect(), dc = R.drawingsCanvas.getBoundingClientRect();
  if (!d) return { none: true, cr: { x: cr.left, y: cr.top } };
  const L = d.layout(proj); if (!L) return { none: true, noLayout: true, cr: { x: cr.left, y: cr.top } };
  const P = L.profile;
  const raw = ch.orchestrator.rawBars, inSpan = raw.filter((b) => b.time >= Math.min(d.anchors[0].time, d.anchors[1].time) && b.time <= Math.max(d.anchors[0].time, d.anchors[1].time));
  return { id: d.id, anchors: d.anchors.map((a) => ({ ...a })), frvp: { ...d.frvp }, cr: { x: cr.left, y: cr.top, w: cr.width, h: cr.height }, dc: { x: dc.left, y: dc.top },
    x0: L.x0, x1: L.x1, anchorX: L.anchorX, maxW: L.maxW, grow: L.grow, pocY: L.pocY, vahY: L.vahY, valY: L.valY, yEdges: L.yEdges, rows: P.rows.map((r) => r.up + r.down), maxTotal: P.maxTotal,
    width: proj.width, lastX: proj.xOf(raw[raw.length - 1].time), handles: d.handlePoints(proj),
    bars: inSpan.map((b) => ({ x: proj.xOf(b.time), o: proj.yOf(b.open, 'price'), c: proj.yOf(b.close, 'price'), h: proj.yOf(b.high, 'price'), l: proj.yOf(b.low, 'price') })),
    delta: d.__stkDelta ? d.__stkDelta.length : null, vwap: d.__stkVwap ? d.__stkVwap.map((x) => x.length) : null, avail: d.__stkAvail || null, selected: [...(U.selectedIds || [])] };
});
// how many painted pixels on the DRAWINGS canvas in a small box (plot coords)
// interleaved drawings (the profile sits under the candles) paint into slice canvases; the rest into the top drawings canvas
const ink = (p, x, y, rw = 3, rh = 3) => p.evaluate(([x, y, rw, rh]) => {
  const R = window.STRYKER_VELA.chart.renderer.renderer, U = R.userDrawings, top = R.drawingsCanvas, k = top.width / top.getBoundingClientRect().width;
  let best = 0;
  for (const c of [top, ...(U.sliceCache ? U.sliceCache.values() : [])]) {
    const d = c.getContext('2d').getImageData(Math.round((x - rw) * k), Math.round((y - rh) * k), Math.max(1, Math.round(2 * rw * k)), Math.max(1, Math.round(2 * rh * k))).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++; best = Math.max(best, n);
  }
  return best;
}, [x, y, rw, rh]);
const setProps = (p, patch) => p.evaluate((patch) => {
  const ch = window.STRYKER_VELA.chart, d = ch.drawings.all().find((x) => x.type === 'fixedrangevp');
  ch.drawings.update(d.id, { props: Object.assign({}, d.props, patch) });
}, patch);
const shot = async (p, name) => { const f = path.join(OUT, MODE + '-' + name + '.png'); await p.screenshot({ path: f }); console.log('SHOT ' + f); };
// a candle point inside the histogram zone that is NOT on a drawn row, a line or a handle
function emptyCandlePoint(g, wholeBox, free) {
  const lo = wholeBox ? g.x0 : Math.min(g.anchorX, g.anchorX + g.grow * g.maxW), hi = wholeBox ? g.x1 : Math.max(g.anchorX, g.anchorX + g.grow * g.maxW);
  const rowW = (y) => { for (let k = 0; k < g.rows.length; k++) { const a = g.yEdges[k], b = g.yEdges[k + 1]; if (y >= Math.min(a, b) - 2 && y <= Math.max(a, b) + 2) return g.rows[k] / g.maxTotal * g.maxW; } return -1; };
  for (const b of g.bars.slice().reverse()) {
    if (b.x < lo + 4 || b.x > hi - 2) continue;
    const y = (b.o + b.c) / 2;
    const w = rowW(y), w2 = Math.max(rowW(y - 3), rowW(y + 3));
    if (w < 0 || Math.abs(b.x - g.anchorX) < Math.max(w, w2) + 6) continue;
    if ([g.pocY, g.vahY, g.valY].some((ly) => ly != null && Math.abs(ly - y) < 12)) continue;
    if (g.handles.some((hp) => Math.hypot(hp[0] - b.x, hp[1] - y) < 22)) continue;   // 22 = finger-size corner handle reach (18) + margin
    if (free && !free(b.x, y)) continue;
    return { x: b.x, y };
  }
  return null;
}

// Composite (all loaded bars) mode of the Fixed Range Volume Profile: off by default (same profile as before), on = first..last loaded candle + HVN / LVN.
//   CHART_BASE=http://127.0.0.1:8241 tools/chrome-slot.sh node tools/tests/compvp-browser.js <outDir>
async function run(b, theme, w, h, mobile) {
  const tag = w + '-' + theme;
  const { ctx, p, errors } = await context(b, { w, h, mobile, theme });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await ready(p);
  await setMarket(p, 'futures:NQ1!', '5');
  await view(p, 90); await sleep(800);
  const g0 = await probe(p);
  const t = await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, R = ch.renderer.renderer, proj = R.drawingProjector(), raw = ch.orchestrator.rawBars; return { xa: proj.xOf(raw[raw.length - 70].time), xb: proj.xOf(raw[raw.length - 20].time) }; });
  await p.evaluate(() => window.STRYKER_VELA.chart.drawings.setTool('fixedrangevp'));
  const Y = g0.cr.y + 300;
  await p.mouse.move(g0.cr.x + t.xa, Y); await p.mouse.down(); await p.mouse.move(g0.cr.x + t.xb, Y + 30, { steps: 8 }); await p.mouse.up(); await sleep(1000);
  await p.evaluate(() => window.STRYKER_VELA.chart.drawings.select([])); await sleep(500);
  const g = await probe(p);
  check(!g.none, tag + ': profile drawn', g.none);
  check(g.frvp.composite !== true, tag + ': composite is off by default', g.frvp.composite);
  const spanOff = g.x1 - g.x0;
  await shot(p, tag + '-off');
  const volAll = await p.evaluate(() => window.STRYKER_VELA.chart.orchestrator.rawBars.reduce((s, b) => s + (b.volume || 0), 0));
  await setProps(p, { composite: true }); await view(p, 90); await sleep(900);
  const g1 = await probe(p);
  check(g1.x1 - g1.x0 > spanOff * 1.3 && g1.x0 >= 0 && g1.x1 <= g1.width, tag + ': composite range is wider than the dragged range', [spanOff, g1.x1 - g1.x0]);
  const tot = g1.rows.reduce((a, b) => a + b, 0);
  check(Math.abs(tot - volAll) / volAll < 0.01, tag + ': composite profile holds the volume of every loaded bar', [tot, volAll]);
  check(g1.pocY != null && g1.vahY != null && g1.valY != null, tag + ': POC, VAH, VAL present');
  check(g1.handles.length === 0, tag + ': no drag handles in composite mode', g1.handles.length);
  await shot(p, tag + '-on');
  await setProps(p, { composite: true, showNodes: false }); await sleep(500);
  await shot(p, tag + '-on-nonodes');
  await setProps(p, { composite: false, showNodes: true }); await view(p, 90); await sleep(800);
  const g2 = await probe(p);
  check(Math.abs((g2.x1 - g2.x0) - spanOff) < 2 && g2.pocY === g.pocY, tag + ': turning it off restores the original profile', [g2.x1 - g2.x0, g2.pocY, g.pocY]);
  check(errors.length === 0, tag + ': no page errors', errors);
  await ctx.close();
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=700'] });
  try { await run(b, 'dark', 1440, 900); await run(b, 'light', 1440, 900); await run(b, 'dark', 390, 844, true); } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
