// Fixed Range Volume Profile "Always visible" browser test (fork of frvp-browser.js harness). Usage: see frvp-browser.js; arg3 = before|after.
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
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await ready(p); await setMarket(p, 'futures:NQ1!', '1'); await view(p, 140); await sleep(800);
  await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars; const a = raw[raw.length - 110], b = raw[raw.length - 60];
    ch.drawings.add ? 0 : 0; window.__a = a.time; window.__b = b.time; });
  const t = await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, R = ch.renderer.renderer, proj = R.drawingProjector(), raw = ch.orchestrator.rawBars; return { xa: proj.xOf(raw[raw.length - 110].time), xb: proj.xOf(raw[raw.length - 60].time) }; });
  const cr = await p.evaluate(() => { const r = window.STRYKER_VELA.chart.renderer.renderer.input.el.getBoundingClientRect(); return { x: r.left, y: r.top }; });
  await p.evaluate(() => window.STRYKER_VELA.chart.drawings.setTool('fixedrangevp'));
  await p.mouse.move(cr.x + t.xa, cr.y + 300); await p.mouse.down(); await p.mouse.move(cr.x + (t.xa + t.xb) / 2, cr.y + 320, { steps: 6 }); await p.mouse.move(cr.x + t.xb, cr.y + 340, { steps: 6 }); await p.mouse.up();
  await sleep(1000);
  const tag = z.tag, g0 = await geo(p);
  check(!!g0, tag + ': drawing created'); if (!g0) { await ctx.close(); return; }
  check((await p.evaluate(() => { const d = window.STRYKER_VELA.chart.drawings.all().find((x) => x.type === 'fixedrangevp'); return d.props.alwaysVisible; })) !== true, tag + ': default is off');
  // scroll so the whole range is off the LEFT edge: show only the newest 40 bars
  await view(p, 40); await sleep(700);
  const off = await geo(p);
  check(off && off.anchorX + off.grow * off.maxW < 0 || off.x1 < 0, tag + ': range is off screen', off);
  await shot(p, tag + '-off');
  if (AFTER) {
    await setProps(p, { alwaysVisible: true }); await sleep(700);
    const on = await geo(p);
    check(on && on.x0 >= 0 && on.x0 < on.W, tag + ': always visible: profile pinned inside the plot', on);
    check(on && on.rows === off.rows && on.poc === off.poc && on.total === off.total, tag + ': same profile values as the off-screen range', [on && on.rows, on && on.poc, on && on.total, off.rows, off.poc, off.total]);
    await shot(p, tag + '-pinned');
    await view(p, 140); await sleep(700);
    const back = await geo(p);
    check(Math.abs(back.x0 - g0.x0) < 2 && Math.abs(back.x1 - g0.x1) < 2, tag + ': scrolled back, it sits on its own range again', [back.x0, g0.x0]);
    await setProps(p, { alwaysVisible: false }); await view(p, 40); await sleep(700);
    const o2 = await geo(p); check(o2.x1 < 0 || o2.anchorX + o2.grow * o2.maxW < 0, tag + ': switched off again: scrolls away', o2);
  }
  check(errors.length === 0, tag + ': no console errors', errors);
  await ctx.close();
}
(async () => {
  const b = await launch();
  for (const z of [{ w: 1440, h: 900, theme: 'dark', tag: '1440-dark' }, { w: 1440, h: 900, theme: 'light', tag: '1440-light' }, { w: 390, h: 800, theme: 'dark', tag: '390-dark', mobile: true }]) await run(b, z);
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
