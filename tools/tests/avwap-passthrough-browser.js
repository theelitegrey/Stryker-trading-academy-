// Member bug (raajans, 16 Nov): with an Anchored VWAP on the chart you could not move the cursor, pan or select other drawings inside its range:
// the drawing hit-tested its whole band polygon (and the fixed range profile its whole box), so every press there grabbed it.
// Fix: tools/vela-090-hit-patch.py (vela-0.9.0-s10): hit-test only the lines, handles and profile bars.
//   node tools/tests/chart-fixture-server.mjs 8241 tools/tests/fixtures/monitor-live.json &
//   CHART_BASE=http://127.0.0.1:8241 flock /tmp/stryker-chrome.lock node tools/tests/avwap-passthrough-browser.js <outDir>
// Harness below is forked from frvp-pin-browser.js.
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
// show the last n bars; returns plot rect + bar times
const view = (p, n) => p.evaluate((n) => {
  const ch = window.STRYKER_VELA.chart, R = ch.renderer.renderer, raw = ch.orchestrator.rawBars, last = raw[raw.length - 1].time;
  const tf = raw[raw.length - 1].time - raw[raw.length - 2].time;
  ch.setVisibleRange({ from: last - n * tf, to: last + 8 * tf });
  return true;
}, n);
const setProps = (p, patch) => p.evaluate((patch) => { const ch = window.STRYKER_VELA.chart, d = ch.drawings.all().find((x) => x.type === 'fixedrangevp'); ch.drawings.update(d.id, { props: Object.assign({}, d.props, patch) }); }, patch);
const shot = async (p, name) => { const f = path.join(OUT, MODE + '-' + name + '.png'); await p.screenshot({ path: f }); console.log('SHOT ' + f); };
const geo = (p) => p.evaluate(() => { const R = window.STRYKER_VELA.chart.renderer.renderer, proj = R.drawingProjector(), d = R.userDrawings.drawings.find((x) => x.type === 'fixedrangevp'), L = d.layout(proj);
  return L ? { x0: L.x0, x1: L.x1, anchorX: L.anchorX, grow: L.grow, maxW: L.maxW, poc: L.profile.rows[L.profile.poc].price, rows: L.profile.rows.length, total: L.profile.rows.reduce((s, r) => s + r.up + r.down, 0), W: proj.width } : null; });

async function run(b, z) {
  const { ctx, p, errors } = await context(b, { w: z.w, h: z.h, theme: z.theme, mobile: z.mobile });
  const tag = z.tag;
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await ready(p); await setMarket(p, 'futures:NQ1!', '1'); await view(p, 140); await sleep(800);
  const ids = await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars, n = raw.length;
    const mid = raw.slice(n - 140).reduce((s, x) => s + x.close, 0) / 140;
    const a = ch.drawings.add('anchoredvwap', { anchors: [{ time: raw[n - 120].time, price: mid }] });
    const t = ch.drawings.add('trendline', { anchors: [{ time: raw[n - 100].time, price: mid + 20 }, { time: raw[n - 60].time, price: mid + 40 }] });
    return { a: a && (a.id || a), t: t && (t.id || t) }; });
  await sleep(900);
  await p.evaluate(() => window.STRYKER_VELA.chart.drawings.select && window.STRYKER_VELA.chart.drawings.select([]));
  const cr = await p.evaluate(() => { const r = window.STRYKER_VELA.chart.renderer.renderer.input.el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  // what the drawing layer would grab: ask each drawing's own hit test over a grid of the plot
  const grid = (type) => p.evaluate((type) => { const R = window.STRYKER_VELA.chart.renderer.renderer, proj = R.drawingProjector(), d = R.userDrawings.drawings.find((x) => x.type === type);
    const L = d.layout(proj); if (!L) return null; let hit = 0, tot = 0, inBand = 0, bandHit = 0;
    for (let y = 8; y < proj.paneRect(d.paneId).height; y += 6) for (let x = 8; x < proj.width; x += 6) { tot++; const h = d.hitTest(x, y, proj, 6); if (h) hit++;
      if (type === 'anchoredvwap') { const xs = L.mid.map((q) => q[0]); if (x > Math.min(...xs) + 20 && x < Math.max(...xs) - 20) { const dist = (arr) => { let m = 1e9; for (let i = 1; i < arr.length; i++) { const [ax, ay] = arr[i - 1], [bx, by] = arr[i], dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, dx * dx + dy * dy ? ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy) : 0)); m = Math.min(m, Math.hypot(x - ax - t * dx, y - ay - t * dy)); } return m; }; if ([L.mid, L.upper, L.lower].every((a) => dist(a) > 14) && Math.hypot(x - L.mid[0][0], y - L.mid[0][1]) > 20) { inBand++; if (h) bandHit++; } } } }
    return { hit, tot, inBand, bandHit, midY: L.mid && L.mid[Math.floor(L.mid.length / 2)], upper: L.upper && L.upper[Math.floor(L.upper.length / 2)], lower: L.lower && L.lower[Math.floor(L.lower.length / 2)], mid: L.mid[Math.floor(L.mid.length / 2)] }; }, type);
  const g = await grid('anchoredvwap');
  check(!!g && g.inBand > 200, tag + ': avwap geometry found, grid points away from its lines', g && g.inBand);
  check(g && g.bandHit === 0, tag + ': no point away from the VWAP lines is grabbed by the drawing', g && g.bandHit);
  // the line itself is still grabbable
  const online = await p.evaluate(() => { const R = window.STRYKER_VELA.chart.renderer.renderer, proj = R.drawingProjector(), d = R.userDrawings.drawings.find((x) => x.type === 'anchoredvwap'), L = d.layout(proj), q = L.mid[Math.floor(L.mid.length / 2)]; return { x: q[0], y: q[1], hit: d.hitTest(q[0], q[1], proj, 6), hitH: d.hitTest(q[0], q[1] + 3, proj, 6) }; });
  check(online.hit && online.hitH, tag + ': the VWAP line is still hit', online);
  // real mouse: press-drag inside the band (not on a line) pans the chart and leaves the VWAP alone
  const bandPt = { x: online.x, y: online.y + 12 };
  const lowerY = g.lower && g.lower[1], upperY = g.upper && g.upper[1];
  const before = await p.evaluate((id) => { const ch = window.STRYKER_VELA.chart, v = ch.getVisibleRange(); return { from: v.from, an: JSON.stringify(ch.drawings.all().find((d) => d.id === id).anchors) }; }, ids.a);
  await p.mouse.move(cr.x + bandPt.x, cr.y + bandPt.y); await sleep(150);
  const cur = await p.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y) || document.body).cursor, [cr.x + bandPt.x, cr.y + bandPt.y]);
  check(cur !== 'move' && cur !== 'pointer', tag + ': cursor over the band is not the drawing cursor', cur);
  await p.mouse.down(); await p.mouse.move(cr.x + bandPt.x - 60, cr.y + bandPt.y, { steps: 6 }); await p.mouse.up(); await sleep(500);
  const after = await p.evaluate((id) => { const ch = window.STRYKER_VELA.chart, v = ch.getVisibleRange(); return { from: v.from, an: JSON.stringify(ch.drawings.all().find((d) => d.id === id).anchors), sel: ch.drawings.all().filter((d) => d.selected).length }; }, ids.a);
  check(after.an === before.an, tag + ': dragging inside the VWAP range does not move the VWAP', [before.an, after.an]);
  check(after.from !== before.from, tag + ': the drag panned the chart instead', [before.from, after.from]);
  // a second drawing sitting inside the range is selectable by click
  const tl = await p.evaluate((id) => { const R = window.STRYKER_VELA.chart.renderer.renderer, proj = R.drawingProjector(), d = R.userDrawings.drawings.find((x) => x.id === id), pts = d.handlePoints(proj); return { x: (pts[0][0] + pts[1][0]) / 2, y: (pts[0][1] + pts[1][1]) / 2 }; }, ids.t);
  await p.mouse.click(cr.x + tl.x, cr.y + tl.y); await sleep(500);
  const selId = await p.evaluate(() => { const R = window.STRYKER_VELA.chart.renderer.renderer; return [...R.userDrawings.selectedIds].map((id) => R.userDrawings.drawings.find((d) => d.id === id).type); });
  check(selId.length === 1 && selId[0] === 'trendline', tag + ': a trendline inside the VWAP range is selectable', selId);
  await p.screenshot({ path: path.join(OUT, tag + '-avwap.png') }); console.log('SHOT ' + path.join(OUT, tag + '-avwap.png'));
  // locked drawing: right-click it, the menu offers Unlock (and Lock when unlocked)
  await p.evaluate((id) => window.STRYKER_VELA.chart.drawings.lock(id, true), ids.t); await sleep(300);
  await p.mouse.click(cr.x + 5, cr.y + 5); await sleep(200);
  await p.mouse.move(cr.x + tl.x, cr.y + tl.y); await sleep(100);
  await p.mouse.click(cr.x + tl.x, cr.y + tl.y, { button: 'right' }); await sleep(500);
  const menuTxt = await p.evaluate(() => [...document.querySelectorAll('[role=menuitem],[role=menu] *')].map((e) => e.textContent.trim()).filter((t) => /^(un)?lock drawing$/i.test(t)));
  check(menuTxt.includes('Unlock drawing'), tag + ': right-click on a locked drawing offers Unlock', menuTxt);
  const rows = await p.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(), ic = e.querySelector('svg,img,[class*=icon]'), ir = ic && ic.getBoundingClientRect(), tx = [...e.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.trim()), tr = tx && tx.getBoundingClientRect(); return { t: e.textContent.trim(), h: Math.round(r.height * 10) / 10, mid: Math.round((r.top + r.height / 2) * 10) / 10, icMid: ir && Math.round((ir.top + ir.height / 2) * 10) / 10, txMid: tr && Math.round((tr.top + tr.height / 2) * 10) / 10, icL: ir && Math.round(ir.left - r.left), r: Math.round(r.width) }; }));
  console.log('MENU ' + tag + ' ' + JSON.stringify(rows));
  const un = rows.find((x) => /^Unlock drawing$/.test(x.t)), rs = rows.find((x) => /^Reset chart view$/.test(x.t));
  check(un && rs && un.h === rs.h && un.icL === rs.icL && Math.abs(un.icMid - un.txMid) <= 1, tag + ': Unlock row same height / icon inset as the other rows, icon and text share one centre', [un, rs]);
  await p.screenshot({ path: path.join(OUT, tag + '-lockmenu.png') }); console.log('SHOT ' + path.join(OUT, tag + '-lockmenu.png'));
  const item = await p.evaluateHandle(() => [...document.querySelectorAll('[role=menuitem]')].find((e) => /^unlock drawing$/i.test(e.textContent.trim())));
  if (item.asElement()) { await item.asElement().click(); await sleep(400); }
  check(await p.evaluate((id) => !window.STRYKER_VELA.chart.drawings.all().find((d) => d.id === id).locked, ids.t), tag + ': choosing it unlocks the drawing');
  // fixed range volume profile: empty box is free, bars/lines still hit
  await p.evaluate((id) => window.STRYKER_VELA.chart.drawings.remove(id), ids.a); await sleep(300);
  await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars, n = raw.length; const hi = Math.max(...raw.slice(n - 100).map((x) => x.high)), lo = Math.min(...raw.slice(n - 100).map((x) => x.low));
    ch.drawings.add('fixedrangevp', { anchors: [{ time: raw[n - 100].time, price: hi }, { time: raw[n - 30].time, price: lo }] }); });
  await sleep(1200);
  const fr = await p.evaluate(() => { const R = window.STRYKER_VELA.chart.renderer.renderer, proj = R.drawingProjector(), d = R.userDrawings.drawings.find((x) => x.type === 'fixedrangevp'), L = d.layout(proj);
    if (!L) return null; const midY = (L.yEdges[0] + L.yEdges[L.yEdges.length - 1]) / 2; const farX = L.grow === 1 ? L.x1 - 4 : L.x0 + 4;
    return { barHit: d.hitTest(L.anchorX + L.grow * 3, L.pocY, proj, 6), pocLine: d.hitTest((L.x0 + L.x1) / 2, L.pocY, proj, 6), emptyHit: d.hitTest(farX, midY + 7, proj, 6), maxW: L.maxW, span: L.x1 - L.x0 }; });
  check(fr && fr.barHit && fr.pocLine, tag + ': profile bars and POC line are still hit', fr);
  check(fr && !fr.emptyHit, tag + ': empty part of the profile box is not grabbed', fr);
  check(errors.length === 0, tag + ': no console errors', errors);
  await ctx.close();
}
(async () => {
  const b = await launch();
  try { for (const z of [{ w: 1440, h: 900, theme: 'dark', tag: '1440-dark' }, { w: 1440, h: 900, theme: 'light', tag: '1440-light' }, { w: 390, h: 800, theme: 'dark', tag: '390-dark', mobile: true }]) await run(b, z); }
  finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
