// FRVP regression (member reports 14-16 Nov): profile stays inside its own A-B range; delta shows on every row that has order flow.
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
const LONG = !!process.env.FR_LONG;   // FR_LONG=1: the clock is 14 Nov and the 4h chart has synthetic candles from 1 Sep to 14 Nov around the real 20-21 Oct ones (the member's case: a profile far older than 14 days)
const NOW = LONG ? Date.UTC(2026, 10, 14, 10, 0) : Date.UTC(2026, 9, 21, 17, 0);
const DAYS_ASKED = new Set();
let CAND = null;
async function candles(tfMin) {
  if (!CAND) {
    const D = await import(path.resolve(__dirname, '../../assets/chart-footprint-data.js'));
    CAND = { D, bars: [].concat(...Object.values(BODY).map((u) => D.decodeOrderflow(new Uint8Array(u)).bars)) };
  }
  const real = CAND.D.aggregate(CAND.bars, tfMin * 60000).map((b) => [b.t / 1000, b.o * 0.25, b.hi * 0.25, b.lo * 0.25, b.c * 0.25, b.vol]);
  if (!LONG || tfMin !== 240) return real;
  const pre = [], t1 = real[0][0], px0 = real[0][1];
  for (let t = Date.UTC(2026, 8, 1) / 1000, i = 0; t < t1; t += 14400, i++) { const c = px0 - 300 + 300 * Math.sin(i / 25) + 40 * Math.sin(i / 3); pre.push([t, c - 8, c + 25, c - 25, c + 5, 1000 + (i % 7) * 300]); }
  const post = [], tl = real[real.length - 1], pxl = tl[4];
  for (let t = tl[0] + 14400, i = 0; t * 1000 < NOW; t += 14400, i++) { const c = pxl + 8 * i + 40 * Math.sin(i / 3); post.push([t, c - 8, c + 25, c - 25, c + 5, 1000 + (i % 7) * 300]); }   // candles up to the clock: no order flow after 21 Oct
  return pre.concat(real, post);
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
    if (u.pathname === '/orderflow') DAYS_ASKED.add(u.searchParams.get('day'));
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
const view = (p, n) => p.evaluate((n) => {
  const ch = window.STRYKER_VELA.chart, R = ch.renderer.renderer, raw = ch.orchestrator.rawBars, last = raw[raw.length - 1].time;
  const tf = raw[raw.length - 1].time - raw[raw.length - 2].time;
  ch.setVisibleRange({ from: last - n * tf, to: last + 8 * tf });
  return true;
}, n);
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
// Regression (member reports 14-16 Nov): an older profile stays inside its own A-B range at every zoom, whatever the default; the
// setting "Extend right to current bar" (frvp.extendRight, off by default) runs it on to the newest candle; B dragged past the newest
// candle ends on the newest candle. Checked on the painted pixels of the POC line and on the drawing's layout.
// Delta bars when A is at / past the left edge of the screen (member report 14 Nov, thread 1569943438840037466): the delta side is left of A, so it
// was off screen. Now the bars go inside the histogram and every row with order flow shows one, on screen.
async function deltaEdge(b) {
  const { ctx, p, errors } = await context(b, { w: 1440, h: 900, theme: 'dark' });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await ready(p);
  await setMarket(p, 'futures:NQ1!', '15'); await sleep(800);
  await p.evaluate(() => {
    const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars, n = raw.length;
    ch.drawings.add('fixedrangevp', { paneId: 'price', anchors: [{ time: raw[n - 150].time, price: raw[n - 150].close }, { time: raw[n - 1].time, price: raw[n - 1].close }], props: { extendRight: false, thinRows: false, deltaBars: 'left' } });
    ch.setVisibleRange({ from: raw[n - 110].time, to: raw[n - 1].time + 6 * (raw[n - 1].time - raw[n - 2].time) });   // A is off screen left
  });
  let g = null; for (let i = 0; i < 30; i++) { await sleep(700); g = await probe(p); if (g.delta > 0) break; }
  await sleep(500);
  const r = await p.evaluate(() => { const d = window.STRYKER_VELA.chart.renderer.renderer.userDrawings.drawings.find((x) => x.type === 'fixedrangevp'), W = window.STRYKER_VELA.chart.renderer.renderer.drawingProjector().width; return { n: d.__stkDelta ? d.__stkDelta.length : 0, onScreen: d.__stkDelta ? d.__stkDelta.filter((q) => q[0] >= 0 && q[0] + q[2] <= W && q[2] >= 3).length : 0 }; });
  check(r.n > 0 && r.onScreen >= r.n * 0.9, 'A off screen left: delta bars are drawn on screen (inside the histogram)', r);
  await shot(p, 'delta-a-offscreen');
  await ctx.close();
}
// Member report 17 Nov (GK, thread 1571736092619710566): an older profile must keep its drawn end when zooming / panning; "Extend lines right"
// (frvp.extendLines, off by default) is the only thing that runs the POC / VAH / VAL lines on to the chart's right edge.
async function lines(b, theme, w, h) {
  const tag = 'lines-' + w + '-' + theme;
  const { ctx, p, errors } = await context(b, { w, h, mobile: w < 500, theme });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await ready(p);
  await setMarket(p, 'futures:NQ1!', '15'); await sleep(800);
  await p.evaluate(() => {
    const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars, n = raw.length;
    ch.drawings.add('fixedrangevp', { paneId: 'price', anchors: [{ time: raw[n - 160].time, price: raw[n - 160].close }, { time: raw[n - 100].time, price: raw[n - 100].close }], props: { thinRows: true } });   // no extendLines key = a drawing saved before the setting
  });
  await sleep(1200);
  const tail = async (g) => {   // ink on the POC row between B and the right edge of the plot
    const x0 = g.x1 + 8, x1 = g.width - 4;
    return x1 > x0 + 4 ? ink(p, (x0 + x1) / 2, g.pocY, (x1 - x0) / 2, 1) : -1;
  };
  const views = [[200, 6], [120, 6], [90, 6], [80, 30], [60, 2]];
  for (const [nb, ahead] of views) {   // zoom in, then pan right past the drawing
    await p.evaluate(([nb, ahead]) => { const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars, n = raw.length, tf = raw[n - 1].time - raw[n - 2].time; ch.setVisibleRange({ from: raw[n - 1].time - nb * tf, to: raw[n - 1].time + ahead * tf }); }, [nb, ahead]);
    await sleep(800);
    const g = await probe(p);
    const t = await tail(g);
    if (t < 0) { note(tag + ' view ' + nb + ': no room right of B, skipped'); continue; }
    check(t === 0, tag + ' view ' + nb + ' bars: default, no line ink right of the drawn end (zoom / pan never extends it)', [t, Math.round(g.x1)]);
  }
  await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars, n = raw.length, tf = raw[n - 1].time - raw[n - 2].time; ch.setVisibleRange({ from: raw[n - 1].time - 130 * tf, to: raw[n - 1].time + 6 * tf }); });
  await sleep(800);
  let g = await probe(p); const before = { anchors: g.anchors.map((a) => a.time), x1: g.x1, rows: g.rows.join() };
  check(g.frvp.extendLines !== true && (await tail(g)) === 0, tag + ': off by default', g.frvp.extendLines);
  await shot(p, tag + '-off');
  await setProps(p, { extendLines: true }); await sleep(900);
  g = await probe(p);
  check((await tail(g)) > 0, tag + ': "Extend lines right" on: POC line runs to the right edge');
  check(g.anchors.map((a) => a.time).join() === before.anchors.join() && Math.abs(g.x1 - before.x1) < 1 && g.rows.join() === before.rows, tag + ': on: range, anchors and profile unchanged (lines only)');
  await shot(p, tag + '-on');
  await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars, n = raw.length, tf = raw[n - 1].time - raw[n - 2].time; ch.setVisibleRange({ from: raw[n - 1].time - 90 * tf, to: raw[n - 1].time + 20 * tf }); });
  await sleep(800); g = await probe(p);
  check((await tail(g)) > 0, tag + ': on: still reaches the right edge after zoom / pan');
  await setProps(p, { extendLines: false }); await sleep(900); g = await probe(p);
  check((await tail(g)) === 0, tag + ': off again: back to the drawn end');
  check(!errors.length, tag + ': no console errors', errors.slice(0, 3));
  await ctx.close();
}
// Alignment gate: the settings panel rows around the new "Extend to now" toggle (label + switch share one centre), dark + light, 1440 + 390.
async function ui(b, theme, w, h) {
  const tag = 'ui-' + w + '-' + theme;
  const { ctx, p, errors } = await context(b, { w, h, mobile: w < 500, theme });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await ready(p);
  await setMarket(p, 'futures:NQ1!', '15'); await sleep(800);
  await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars, n = raw.length; ch.drawings.add('fixedrangevp', { paneId: 'price', anchors: [{ time: raw[n - 90].time, price: raw[n - 90].close }, { time: raw[n - 30].time, price: raw[n - 30].close }], props: { extendRight: false, thinRows: true } }); });
  await sleep(1200);
  const id = await p.evaluate(() => window.STRYKER_VELA.chart.drawings.all().find((x) => x.type === 'fixedrangevp').id);
  await p.evaluate((id) => window.STRYKER_VELA.chart.drawings.select([id]), id); await sleep(500);
  const g = await probe(p);
  await p.mouse.dblclick(g.cr.x + g.x0 + 20, g.cr.y + g.pocY); await sleep(1200);
  const open = await p.evaluate(() => !!document.querySelector('.vela-dsp-scroll'));
  check(open, tag + ': settings window opened');
  await p.evaluate(() => { const el = [...document.querySelectorAll('.vela-dsp-scroll')].pop(); if (el) el.scrollTop = el.scrollHeight / 2; }); await sleep(300);
  const rows = await p.evaluate(() => {
    const out = [];
    for (const lab of [...document.querySelectorAll('*')].filter((e) => !e.children.length && ['Extend lines right', 'Extend to now', 'Always visible', 'Thin rows', 'Composite'].includes(e.textContent.trim()))) {
      let row = lab.parentElement; for (let i = 0; i < 4 && row; i++) { if (row.querySelector('input,button,[role=switch],[role=checkbox]')) break; row = row.parentElement; }
      const ctl = row && row.querySelector('input,button,[role=switch],[role=checkbox]');
      if (!ctl) { out.push({ t: lab.textContent.trim(), err: 'no control' }); continue; }
      const a = lab.getBoundingClientRect(), c = ctl.getBoundingClientRect(), rr = row.getBoundingClientRect();
      out.push({ t: lab.textContent.trim(), labCy: +(a.top + a.height / 2).toFixed(1), ctlCy: +(c.top + c.height / 2).toFixed(1), ctlH: Math.round(c.height), labL: Math.round(a.left - rr.left), ctlR: Math.round(rr.right - c.right), cut: lab.scrollWidth > lab.clientWidth });
    }
    return out;
  });
  console.log('MEASURE ' + tag + ' ' + JSON.stringify(rows));
  check(rows.length === 5 && rows.every((r) => !r.err && Math.abs(r.labCy - r.ctlCy) <= 1 && !r.cut), tag + ': label + switch share one vertical centre (+-1 px), label not cut', rows);
  check(new Set(rows.map((r) => r.ctlH)).size === 1, tag + ': same-role switches have one height', rows.map((r) => r.ctlH));
  check(new Set(rows.map((r) => r.ctlR)).size === 1 && new Set(rows.map((r) => r.labL)).size === 1, tag + ': equal left / right inner padding across rows', rows.map((r) => [r.labL, r.ctlR]));
  await shot(p, tag);
  await ctx.close();
}
async function run(b) {
  const { ctx, p, errors } = await context(b, { w: 1440, h: 900, theme: 'dark' });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await ready(p);
  await setMarket(p, 'futures:NQ1!', '15'); await sleep(800);
  await p.evaluate(() => {
    const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars, n = raw.length;
    const a = raw[n - 120], bb = raw[n - 70];
    ch.drawings.add('fixedrangevp', { paneId: 'price', anchors: [{ time: a.time, price: a.close }, { time: bb.time, price: bb.close }], props: {} });   // props {} = a drawing saved before the setting
  });
  await sleep(1500);
  const last = await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars; return raw[raw.length - 1].time; });
  const B = await p.evaluate(() => window.STRYKER_VELA.chart.drawings.all().find((x) => x.type === 'fixedrangevp').anchors[1].time);
  const between = async (g) => {
    const [lx, bx] = await p.evaluate(([t, bt]) => { const pr = window.STRYKER_VELA.chart.renderer.renderer.drawingProjector(); return [pr.xOf(t), pr.xOf(bt)]; }, [last, B]);
    const x0 = Math.max(bx + 6, 0), x1 = Math.min(lx - 6, g.width);
    return x1 > x0 ? ink(p, (x0 + x1) / 2, g.pocY, (x1 - x0) / 2, 1) : -1;   // ink on the POC row between B and the newest candle
  };
  for (const nb of [160, 100, 70, 40]) {
    await p.evaluate((nb) => { const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars, n = raw.length, tf = raw[n - 1].time - raw[n - 2].time; ch.setVisibleRange({ from: raw[n - 1].time - nb * tf, to: raw[n - 1].time + 6 * tf }); }, nb);
    await sleep(900);
    let g = await probe(p);
    const off = await between(g);
    if (off < 0) { note('zoom ' + nb + ': B off screen, skipped'); continue; }
    check(off === 0 && g.anchors[1].time === B, 'zoom ' + nb + ' bars: default, no ink between B and the newest candle, anchor untouched', [off, g.anchors[1].time === B]);
  }
  await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars, n = raw.length, tf = raw[n - 1].time - raw[n - 2].time; ch.setVisibleRange({ from: raw[n - 1].time - 160 * tf, to: raw[n - 1].time + 6 * tf }); });
  await setProps(p, { extendRight: true }); await sleep(900);
  let g = await probe(p);
  const lx = await p.evaluate((t) => window.STRYKER_VELA.chart.renderer.renderer.drawingProjector().xOf(t), last);
  check(Math.abs(g.x1 - lx) < 2, 'extend right on: range ends on the newest candle', [g.x1, lx]);
  check(await between(g) > 0, 'extend right on: POC line drawn up to the newest candle');
  check(g.anchors[1].time === B, 'extend right on: the saved anchor B is not changed');
  await shot(p, 'extend-on');
  await setProps(p, { extendRight: false }); await sleep(900);
  g = await probe(p);
  check(Math.abs(g.x1 - (await p.evaluate((t) => window.STRYKER_VELA.chart.renderer.renderer.drawingProjector().xOf(t), B))) < 2, 'extend right off again: back to B', g.x1);
  await shot(p, 'extend-off');
  // B dragged / placed in the empty space right of the newest candle: it is put on the newest candle (and stays there when new candles arrive)
  await setProps(p, { extendRight: false });
  await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars, n = raw.length, tf = raw[n - 1].time - raw[n - 2].time, d = ch.drawings.all().find((x) => x.type === 'fixedrangevp'); ch.drawings.remove(d.id);
    ch.drawings.add('fixedrangevp', { paneId: 'price', anchors: [{ time: raw[n - 120].time, price: raw[n - 120].close }, { time: raw[n - 1].time + 6 * tf, price: raw[n - 1].close }], props: {} }); });
  await sleep(900);
  g = await probe(p);
  check(Math.abs(g.x1 - lx) < 2, 'B in the empty space right of the data: the range ends on the newest candle', [g.x1, lx]);
  check(!errors.length, 'no console errors', errors.slice(0, 3));
  await ctx.close();
}
(async () => { const b = await launch({ args: ['--js-flags=--max-old-space-size=700'] }); try { await deltaEdge(b); await run(b); for (const [t, w, h] of [['dark', 1440, 900], ['light', 1440, 900], ['dark', 390, 844]]) await lines(b, t, w, h); for (const [t, w, h] of [['dark', 1440, 900], ['light', 1440, 900]]) await ui(b, t, w, h); } finally { await b.close(); } console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0); })();
