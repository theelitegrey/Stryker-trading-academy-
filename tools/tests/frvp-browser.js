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
const MODE = process.argv[3] || 'after';
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
    const body = u.pathname === '/orderflow' && u.searchParams.get('sym') === 'NQ' && BODY[u.searchParams.get('day')];
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
function emptyCandlePoint(g, wholeBox) {
  const lo = wholeBox ? g.x0 : Math.min(g.anchorX, g.anchorX + g.grow * g.maxW), hi = wholeBox ? g.x1 : Math.max(g.anchorX, g.anchorX + g.grow * g.maxW);
  const rowW = (y) => { for (let k = 0; k < g.rows.length; k++) { const a = g.yEdges[k], b = g.yEdges[k + 1]; if (y >= Math.min(a, b) - 2 && y <= Math.max(a, b) + 2) return g.rows[k] / g.maxTotal * g.maxW; } return -1; };
  for (const b of g.bars.slice().reverse()) {
    if (b.x < lo + 4 || b.x > hi - 2) continue;
    const y = (b.o + b.c) / 2;
    const w = rowW(y), w2 = Math.max(rowW(y - 3), rowW(y + 3));
    if (w < 0 || Math.abs(b.x - g.anchorX) < Math.max(w, w2) + 6) continue;
    if ([g.pocY, g.vahY, g.valY].some((ly) => ly != null && Math.abs(ly - y) < 12)) continue;
    if (g.handles.some((hp) => Math.hypot(hp[0] - b.x, hp[1] - y) < 14)) continue;
    return { x: b.x, y };
  }
  return null;
}

async function desktop(b, theme) {
  const tag = '1440-' + theme;
  const { ctx, p, errors } = await context(b, { w: 1440, h: 900, theme });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await ready(p);
  await setMarket(p, 'futures:NQ1!', '1');
  await view(p, 140); await sleep(800);
  let g = await probe(p);
  // drag-create: A = 110 bars back, B = 30 bars back (inside the data), by a real mouse drag
  const t = await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, R = ch.renderer.renderer, proj = R.drawingProjector(), raw = ch.orchestrator.rawBars; const a = raw[raw.length - 110], bb = raw[raw.length - 30]; return { xa: proj.xOf(a.time), xb: proj.xOf(bb.time), y: R.coords.heightPx ? R.coords.heightPx * 0.5 : 400 }; });
  await p.evaluate(() => window.STRYKER_VELA.chart.drawings.setTool('fixedrangevp'));
  const Y = g.cr.y + 300;
  await p.mouse.move(g.cr.x + t.xa, Y); await p.mouse.down(); await p.mouse.move(g.cr.x + (t.xa + t.xb) / 2, Y + 20, { steps: 6 }); await p.mouse.move(g.cr.x + t.xb, Y + 40, { steps: 6 }); await p.mouse.up();
  await sleep(1200);
  g = await probe(p);
  check(!g.none, tag + ': drag-create made a Fixed Range Volume Profile', g.none ? g : g.anchors);
  if (g.none) { await ctx.close(); return; }
  check(Math.abs(g.x1 - t.xb) < 2, tag + ': range right edge is B', [g.x1, t.xb]);
  if (AFTER) check(g.frvp.extendRight === false && g.frvp.thinRows === true && !g.frvp.deltaBars && !g.frvp.vwap, tag + ': new drawing defaults: lines stop at B, thin rows on, delta and VWAP off', g.frvp);
  // 1. lines stop at B (pixels right of B on the POC line are empty), extend when the setting is on
  await p.mouse.move(g.cr.x + 5, g.cr.y + g.cr.h - 60); await p.evaluate(() => window.STRYKER_VELA.chart.drawings.select([])); await sleep(500);
  const rightOfB = () => ink(p, (g.x1 + Math.min(g.width, g.lastX + 200)) / 2 + 40, g.pocY, 6, 1);
  const inside = await ink(p, (g.x0 + g.x1) / 2 + g.maxW / 3, g.pocY, 6, 1);
  const out0 = await rightOfB();
  check(inside > 0, tag + ': POC line drawn inside the range', inside);
  if (AFTER) check(out0 === 0, tag + ': POC line stops at B by default (no ink right of B)', out0); else note(tag + ' (old code) ink on the POC line right of B', out0);
  await shot(p, tag + '-created');
  // GK's case: B dropped in the empty space right of the newest candle. Lines must stop at the newest candle, not run on to B.
  {
    const g0 = await probe(p);
    await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars, d = ch.drawings.all().find((x) => x.type === 'fixedrangevp'), tf = raw[raw.length - 1].time - raw[raw.length - 2].time;
      ch.drawings.update(d.id, { anchors: [d.anchors[0], { time: raw[raw.length - 1].time + 6 * tf, price: d.anchors[1].price }] }); });
    await sleep(600);
    const gf = await probe(p);
    const past = await ink(p, (gf.lastX + gf.x1) / 2, gf.pocY, Math.max(2, (gf.x1 - gf.lastX) / 2 - 6), 1);
    if (AFTER) check(gf.x1 > gf.lastX + 20 && past === 0, tag + ': B right of the newest candle: POC stops at the newest candle', [gf.lastX, gf.x1, past]);
    else note(tag + ' (old code) B right of the newest candle: ink on the POC between the newest candle and B', past);
    await shot(p, tag + '-future-b');
    await p.evaluate((a) => { const ch = window.STRYKER_VELA.chart, d = ch.drawings.all().find((x) => x.type === 'fixedrangevp'); ch.drawings.update(d.id, { anchors: a }); }, g0.anchors);
    await sleep(500);
  }
  if (AFTER) {
    await setProps(p, { extendRight: true }); await sleep(600);
    const out1 = await rightOfB();
    check(out1 > 0, tag + ': "Extend lines right" on: POC runs past B', out1);
    await setProps(p, { extendRight: false }); await sleep(400);
  }
  // 2. a press + drag on a candle inside the range must not move the profile (the chart pans instead), and a click must not select it
  g = await probe(p);
  const pt = emptyCandlePoint(g);
  check(!!pt, tag + ': found a candle inside the histogram zone, off its bars and lines', pt);
  if (pt) {
    const hit = await p.evaluate(([x, y]) => !!window.STRYKER_VELA.chart.renderer.renderer.userDrawings.interaction.hitAt(x, y), [pt.x, pt.y]);
    if (AFTER) check(!hit, tag + ': hit-test on the candle point = nothing', hit); else note(tag + ' (old code) hit-test on a candle inside the range grabs the profile', hit);
    const a0 = JSON.stringify(g.anchors);
    await p.mouse.move(g.cr.x + pt.x, g.cr.y + pt.y); await p.mouse.down(); await p.mouse.move(g.cr.x + pt.x + 60, g.cr.y + pt.y + 30, { steps: 8 }); await p.mouse.up(); await sleep(600);
    const g2 = await probe(p);
    if (AFTER) check(JSON.stringify(g2.anchors) === a0, tag + ': drag on a candle inside the range did NOT move the profile', [a0, g2.anchors]);
    else note(tag + ' (old code) drag on a candle inside the range moved the profile', JSON.stringify(g2.anchors) !== a0);
    if (JSON.stringify(g2.anchors) !== a0) { await p.evaluate(() => window.STRYKER_VELA.chart.drawings.undo()); await sleep(400); }
    await view(p, 140); await sleep(600); g = await probe(p);
    const pt2 = emptyCandlePoint(g) || pt;
    await p.mouse.click(g.cr.x + pt2.x, g.cr.y + pt2.y); await sleep(500);
    const g3 = await probe(p);
    const cross = await p.evaluate(() => { try { const c = window.STRYKER_VELA.chart.renderer.renderer.crosshair || {}; return c.x != null || c.time != null || true; } catch (e) { return null; } });
    if (AFTER) check(!g3.selected.includes(g3.id) && JSON.stringify(g3.anchors) === JSON.stringify(g.anchors), tag + ': click on a candle inside the range: profile not selected, not moved', g3.selected);
    note(tag + ' crosshair after the click', cross);
    await p.mouse.move(g.cr.x + pt2.x, g.cr.y + pt2.y); await sleep(300);
    const cur = await p.evaluate(() => getComputedStyle(window.STRYKER_VELA.chart.renderer.renderer.input.el).cursor);
    if (AFTER) check(cur !== 'move', tag + ': cursor over the candle is the chart cursor, not "move"', cur);
  }
  // the profile still takes its own bars / lines: a click on the POC line selects it, then dragging handle B moves B
  g = await probe(p);
  await p.mouse.click(g.cr.x + (g.x0 + g.x1) / 2 + g.maxW / 2, g.cr.y + g.pocY); await sleep(500);
  g = await probe(p);
  check(g.selected.includes(g.id), tag + ': click on the POC line selects the profile', g.selected);
  await p.keyboard.press('Escape'); await sleep(300);
  await p.mouse.click(g.cr.x + (g.x0 + g.x1) / 2 + g.maxW / 2, g.cr.y + g.pocY); await sleep(400);
  g = await probe(p);
  const hB = g.handles[1], b0 = g.anchors[1].time;
  await p.mouse.move(g.cr.x + hB[0], g.cr.y + hB[1]); await p.mouse.down(); await p.mouse.move(g.cr.x + hB[0] - 80, g.cr.y + hB[1], { steps: 8 }); await p.mouse.up(); await sleep(600);
  const gH = await probe(p);
  check(gH.anchors[1].time < b0, tag + ': dragging handle B still moves B', [b0, gH.anchors[1].time]);
  await p.evaluate(() => window.STRYKER_VELA.chart.drawings.undo()); await sleep(400);
  const gU = await probe(p);
  check(gU.anchors[1].time === b0, tag + ': undo puts B back', [b0, gU.anchors[1].time]);
  if (AFTER) {
    // a click on a drawn histogram bar still selects (the profile body = its bars)
    g = await probe(p);
    const k = g.rows.indexOf(g.maxTotal), yk = (g.yEdges[k] + g.yEdges[k + 1]) / 2;
    const onBar = await p.evaluate(([x, y]) => !!window.STRYKER_VELA.chart.renderer.renderer.userDrawings.interaction.hitAt(x, y), [g.anchorX + g.grow * g.maxW * 0.5, yk]);
    check(onBar, tag + ': hit-test on its biggest histogram bar = the profile', [g.anchorX, yk]);
    // 3. thin rows: more rows -> some rows under 2 % of the biggest; their 1 px line is drawn
    await setProps(p, { rows: 160 }); await sleep(700); g = await probe(p);
    const thinK = g.rows.map((v, i) => [v, i]).filter(([v]) => v < 0.02 * g.maxTotal).map(([, i]) => i);
    check(thinK.length > 0, tag + ': 160 rows give thin rows (' + thinK.length + ')', thinK.length);
    let thinInk = 0; for (const i of thinK.slice(0, 12)) thinInk += (await ink(p, g.anchorX + g.grow * 1, (g.yEdges[i] + g.yEdges[i + 1]) / 2, 1, 1.5)) > 0 ? 1 : 0;
    check(thinInk >= Math.min(thinK.length, 12) * 0.8, tag + ': thin rows drawn as a line (' + thinInk + ' of ' + Math.min(thinK.length, 12) + ')', thinInk);
    await shot(p, tag + '-thin');
    await setProps(p, { thinRows: false }); await sleep(500);
    let off = 0; for (const i of thinK.filter((i) => !g.rows[i] && !g.rows[i - 1] && !g.rows[i + 1]).slice(0, 12)) off += (await ink(p, g.anchorX + g.grow * 1, (g.yEdges[i] + g.yEdges[i + 1]) / 2, 1, 1)) > 0 ? 1 : 0;
    check(off === 0, tag + ': thin rows off: empty rows are gaps again', [off, thinK.filter((i) => !g.rows[i] && !g.rows[i - 1] && !g.rows[i + 1]).length]);
    await setProps(p, { thinRows: true, rows: 60 }); await sleep(400);
    // 4. delta bars (order flow) + anchored VWAP with bands
    await setProps(p, { deltaBars: 'left', vwap: true, vwapSd1: true, vwapSd2: true });
    let gd = null; for (let i = 0; i < 30; i++) { await sleep(700); gd = await probe(p); if (gd.delta > 0) break; }
    check(gd.delta > 0, tag + ': delta bars drawn (' + gd.delta + ' rows) from the recorded order flow', gd.avail);
    const leftInk = await ink(p, gd.anchorX - 6, (gd.yEdges[0] + gd.yEdges[gd.yEdges.length - 1]) / 2, 4, Math.abs(gd.yEdges[0] - gd.yEdges[gd.yEdges.length - 1]) / 2 - 2);
    check(leftInk > 0, tag + ': delta bars sit left of the anchor', leftInk);
    check(gd.vwap && gd.vwap.length === 5 && gd.vwap.every((n) => n > 20), tag + ': anchored VWAP + 1 SD + 2 SD bands drawn', gd.vwap);
    await p.mouse.move(gd.cr.x + 5, gd.cr.y + gd.cr.h - 60); await sleep(400);
    await shot(p, tag + '-delta-vwap');
    // settings window lists the new options
    await p.mouse.click(gd.cr.x + (gd.x0 + gd.x1) / 2 + gd.maxW / 2, gd.cr.y + gd.pocY); await sleep(600);
    await p.evaluate(() => { const U = window.STRYKER_VELA.chart.renderer.renderer.userDrawings, d = U.drawings.find((x) => x.type === 'fixedrangevp'); U.openSettingsById(d.id, 0, 0); U.popup.openPanel(); });
    await sleep(900);
    await p.evaluate(() => { const t = [...document.querySelectorAll('.stk-dsp-tabs button')].find((b) => /Style/.test(b.textContent)); if (t) t.click(); });
    await sleep(500);
    await p.evaluate(() => { const el = [...document.querySelectorAll('.vela-dsp-scroll')].pop(); if (el) el.scrollTop = el.scrollHeight; });
    await sleep(300);
    const txt = await p.evaluate(() => [...document.querySelectorAll('*')].filter((e) => !e.children.length && /\S/.test(e.textContent) && e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim()).join(' | '));
    for (const w of ['Extend right', 'Thin rows', 'Delta bars', 'VWAP', '\u00b11 SD bands', '\u00b12 SD bands']) check(txt.includes(w), tag + ': settings show "' + w + '"', txt.slice(0, 200));
    await shot(p, tag + '-settings');
    // the settings live in the saved chart: a reload keeps them
    await p.keyboard.press('Escape'); await sleep(300);
    await p.evaluate(() => window.STRYKER_VELA.context().stateChanged && window.STRYKER_VELA.context().stateChanged()); await sleep(2500);
    await p.reload({ waitUntil: 'domcontentloaded' }); await ready(p);
    let gr = null; for (let i = 0; i < 30; i++) { await sleep(700); gr = await probe(p); if (!gr.none) break; }
    check(!gr.none && gr.frvp.deltaBars === 'left' && gr.frvp.vwap === true && gr.frvp.extendRight === false && gr.frvp.thinRows === true, tag + ': reload keeps the profile and its settings', gr.frvp);
    // an OLD saved drawing (no new keys) keeps the old look: lines to B, no thin rows
    await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, d = ch.drawings.all().find((x) => x.type === 'fixedrangevp'); const pr = Object.assign({}, d.props); for (const k of ['extendRight', 'thinRows', 'deltaBars', 'vwap', 'vwapSd1', 'vwapSd2']) delete pr[k]; ch.drawings.remove(d.id); ch.drawings.add('fixedrangevp', { anchors: d.anchors, props: pr, style: d.style }); });
    await sleep(700); const go = await probe(p);
    check(go.frvp.extendRight === undefined && go.frvp.thinRows === undefined && go.delta === null && go.vwap === null, tag + ': a drawing saved before this has no new keys (old look)', go.frvp);
  }
  check(!errors.length, tag + ': no console errors', errors.slice(0, 3));
  await ctx.close();
}

async function phone(b) {
  const tag = '390-dark';
  const { ctx, p, errors } = await context(b, { w: 390, h: 844, mobile: true, theme: 'dark' });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await ready(p);
  await setMarket(p, 'futures:NQ1!', '1');
  await view(p, 60); await sleep(800);
  await p.evaluate((after) => {
    const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars, a = raw[raw.length - 50], bb = raw[raw.length - 12];
    const props = after ? { extendRight: false, thinRows: true, deltaBars: 'left', vwap: true, vwapSd1: true, vwapSd2: true } : undefined;
    ch.drawings.add('fixedrangevp', { paneId: 'price', anchors: [{ time: a.time, price: a.close }, { time: bb.time, price: bb.close }], props });
  }, AFTER);
  if (AFTER) await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, d = ch.drawings.all().find((x) => x.type === 'fixedrangevp'); ch.drawings.update(d.id, { props: Object.assign({}, (window.__fr0 = d.props)) }); });
  let g = null; for (let i = 0; i < 20; i++) { await sleep(600); g = await probe(p); if (!AFTER || g.delta > 0) break; }
  check(!g.none, tag + ': profile on the chart', g.none);
  if (AFTER) {
    const out = await ink(p, g.x1 + 25, g.pocY, 3, 1);
    check(out === 0 || g.x1 + 25 > g.width, tag + ': POC stops at B', out);
    check(g.delta > 0 && g.vwap && g.vwap.length === 5, tag + ': delta bars + VWAP drawn', [g.delta, g.vwap]);
  }
  const pt = emptyCandlePoint(g) || emptyCandlePoint(g, true);
  check(!!pt, tag + ': found a candle inside the range, off the profile', pt);
  if (pt) {
    const a0 = JSON.stringify(g.anchors);
    const cdp = await ctx.newCDPSession(p);
    const X = g.cr.x + pt.x, Y = g.cr.y + pt.y;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: X, y: Y }] });
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: X + 4 * i, y: Y + 2 * i }] }); await sleep(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(600);
    const g2 = await probe(p);
    if (AFTER) check(JSON.stringify(g2.anchors) === a0, tag + ': touch drag on a candle inside the range did NOT move the profile', [a0, g2.anchors]);
    else note(tag + ' (old code) touch drag on a candle inside the range moved the profile', JSON.stringify(g2.anchors) !== a0);
    await p.touchscreen.tap(X, Y); await sleep(500);
    const g3 = await probe(p);
    if (AFTER) check(!g3.selected.includes(g3.id), tag + ': tap on a candle inside the range does not select the profile', g3.selected);
    if (JSON.stringify(g3.anchors) !== a0) { await p.evaluate(() => window.STRYKER_VELA.chart.drawings.undo()); }
  }
  await view(p, 60); await sleep(800);
  await p.evaluate(() => window.STRYKER_VELA.chart.drawings.select([])); await sleep(300);
  await shot(p, tag);
  check(!errors.length, tag + ': no console errors', errors.slice(0, 3));
  await ctx.close();
}

async function crypto(b) {
  const tag = 'btc-1440';
  const { ctx, p, errors } = await context(b, { w: 1440, h: 900, theme: 'dark', crypto: true });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await ready(p);
  await setMarket(p, 'binance:BTCUSDT', '1');
  await view(p, 80); await sleep(1000);
  await p.evaluate(() => {
    const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars, a = raw[raw.length - 60], bb = raw[raw.length - 1];
    ch.drawings.add('fixedrangevp', { paneId: 'price', anchors: [{ time: a.time, price: a.close }, { time: bb.time, price: bb.close }], props: { extendRight: false, thinRows: true, deltaBars: 'left', vwap: true, vwapSd1: true, vwapSd2: false } });
  });
  let g = null; for (let i = 0; i < 20; i++) { await sleep(700); g = await probe(p); if (g.vwap) break; }
  check(!g.none && g.vwap && g.vwap.length === 3, tag + ': BTCUSDT: profile + VWAP + 1 SD bands (2 SD off)', g.vwap);
  check(g.avail && g.avail.delta === '', tag + ': BTCUSDT: delta option available (crypto order flow)', g.avail);
  note(tag + ' delta rows (the mock only serves trades at one price, near the end of the range)', g.delta);
  await shot(p, tag);
  check(!errors.length, tag + ': no console errors', errors.slice(0, 3));
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=700'] });
  try {
    const only = process.env.FR_ONLY ? process.env.FR_ONLY.split(',') : ['dark', 'light', 'phone', 'btc'];
    if (only.includes('dark')) await desktop(b, 'dark');
    if (only.includes('light')) await desktop(b, 'light');
    if (only.includes('phone')) await phone(b);
    if (only.includes('btc') && AFTER) await crypto(b);
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
