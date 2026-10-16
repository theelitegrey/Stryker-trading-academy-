// Fit price + Latest buttons browser test (bottom right of the chart; 1440 + 390).
//   node tools/tests/chart-dev-server.mjs 8092
//   flock -w 900 /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8092 node --max-old-space-size=768 tools/tests/chart-gex-ladder-browser.js [shotsDir]
// GEX history = the SYNTHETIC sessions of gex-history-fixture.js (4 weekdays ending today, ET), /api/gex/levels =
// saved real responses. Test input only, NOT market data.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const { session, packed } = require('./gex-history-fixture.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8092';
const OUT = process.argv[2] || '/tmp';
const FIX = path.join(__dirname, 'fixtures', 'gex');
const LV = { SPX: JSON.parse(fs.readFileSync(path.join(FIX, 'SPX-0.json'))), QQQ: JSON.parse(fs.readFileSync(path.join(FIX, 'QQQ-0.json'))) };
// SPY fixture: SPX / 10 with its own strikes and different values (never the QQQ data)
LV.SPY = (() => { const x = JSON.parse(JSON.stringify(LV.SPX)); const by = new Map();
  x.ladder.forEach((r) => { const k = Math.round(r.strike / 10); const o = by.get(k) || { strike: k, gex: 0, dex: 0, oi: 0 }; o.gex += r.gex * 0.093; o.oi += r.oi; by.set(k, o); });
  x.ladder = [...by.values()].sort((p, q) => q.strike - p.strike); x.spot = Math.round(x.spot / 10 * 100) / 100 + 0.17; x.underlying = 'SPY'; x.net_gex = x.ladder.reduce((t, r) => t + r.gex, 0); delete x.futures; return x; })();
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const etDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
const DAY = etDay(Date.now());
const DAYS = (() => { const out = [DAY]; let t = Date.parse(DAY + 'T12:00:00Z'); while (out.length < 4) { t -= 86400000; if (![0, 6].includes(new Date(t).getUTCDay())) out.push(new Date(t).toISOString().slice(0, 10)); } return out; })();   // newest first
const ALL = (U, d) => DAYS.slice().reverse().flatMap((day) => session(U, d, day));

async function open(b, { w, h, mobile, free, anon }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((anon) => { if (anon) Object.defineProperty(window, 'strykerPlanTier', { configurable: false, get: () => () => new Promise(() => {}), set() {} }); }, !!anon);
  await ctx.addInitScript((free) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker_bar_replay_v1'); localStorage.setItem('stryker.volume', '1'); } catch (e) {}
    if (free) Object.defineProperty(window, 'strykerPlanTier', { configurable: false, get: () => () => Promise.resolve({ free: true }), set() {} });
  }, !!free);
  const hits = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/gex-(history|sessions)/, (r) => {
    const u = new URL(r.request().url()); hits.push({ path: u.pathname, u: u.searchParams.get('u'), from: +u.searchParams.get('from'), to: +u.searchParams.get('to') });
    const U = u.searchParams.get('u'), d = Number(u.searchParams.get('dte'));
    const hdr = { 'access-control-allow-origin': '*' };
    if (u.pathname === '/gex-sessions') {
      const list = U === 'SPX' || U === 'QQQ' ? DAYS.map((day) => { const s = session(U, d, day); return { u: U, d, day, n: s.length, t0: s[0].t, t1: s[s.length - 1].t }; }) : [];
      return r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(list) });
    }
    const from = +u.searchParams.get('from'), to = +u.searchParams.get('to');
    r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(packed(U, d, ALL(U, d).filter((x) => x.t >= from && x.t <= to))) });
  });
  await ctx.route(/\/api\/gex\/levels\//, (r) => {
    const name = new URL(r.request().url()).pathname.split('/').pop().toUpperCase();
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LV[name] || LV.SPX) });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|WebSocket connection|CORS policy|econ-calendar/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.__stkBarReplay, null, { timeout: 45000 });
  await waitBars(p);
  return { ctx, p, errors, hits };
}
const waitBars = (p) => p.evaluate(async () => {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {}
  }
  return false;
});
const setSym = async (p, sym, tf) => { await p.evaluate(([s, tf]) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol(s); if (tf) c.setTimeframe(tf); }, [sym, tf]); await sleep(2500); await waitBars(p); await sleep(2500); };
const gexData = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.context().cells[0].chart, seen = new Set();
  const find = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null; seen.add(o); if (o.nativeData instanceof Map && o.nativeData.has('stk_gex')) return o.nativeData.get('stk_gex'); for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} } return null; };
  return JSON.parse(JSON.stringify(find(c, 0) || null));
});
const tagsOf = (p) => p.evaluate(() => { for (const c of document.querySelectorAll('canvas')) if (c.__stkGexTags) return c.__stkGexTags; return []; });
const noOverlap = (tg) => tg.every((a, i) => tg.every((b, j) => i >= j || a.box.y + a.box.h <= b.box.y || b.box.y + b.box.h <= a.box.y));
const setInputs = (p, o) => p.evaluate((o) => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_gex'); h.setInputs(Object.assign({}, h.inputValues(), o)); window.STRYKER_VELA.context().stateChanged(); }, o);
const addGex = (p, inputs) => p.evaluate((inputs) => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_gex', { inputs: inputs || {} }); window.STRYKER_VELA.context().stateChanged(); }, inputs || {});
// The fixture levels sit away from today's real bars: widen the price axis (manual scale) so they are in view.
const wide = (p, lo, hi) => p.evaluate(([lo, hi]) => { const R = window.STRYKER_VELA.context().cells[0].chart.renderer.renderer; for (const pane of R.scene.panes.values()) { if (pane.kind === 'price' || pane.id === 'price' || pane.id === 'main') { pane.manualScale = { min: lo, max: hi }; } } R.scheduler.invalidate(4); }, [lo, hi]);
async function shot(p, name) { await p.mouse.move(5, 5).catch(() => {}); await sleep(600); await p.screenshot({ path: OUT + '/' + name }); console.log('SHOT ' + OUT + '/' + name); }

const state = (p) => p.evaluate(() => {
  const root = document.querySelector('#stkgl .stkgl-body') || document.querySelector('#gex-ladder-card .stkgl-body');
  if (!root) return null;
  const cols = [...root.querySelectorAll('.stkgl-col')].map((c) => {
    const l = c.querySelector('.stkgl-list'), rows = [...c.querySelectorAll('.stkgl-row')];
    const sp = c.querySelector('[data-spot]');
    let spotVisible = false;
    if (l && sp) { const a = l.getBoundingClientRect(), b = sp.getBoundingClientRect(); spotVisible = b.top >= a.top - 1 && b.bottom <= a.bottom + 1; }
    return { api: c.dataset.api, shown: c.offsetParent !== null, locked: !!c.querySelector('.stkgl-lock'), pro: !!c.querySelector('.stkgl-pro'), n: rows.length,
      max: rows.filter((r) => r.classList.contains('is-max')).length, maxK: (rows.find((r) => r.classList.contains('is-max')) || {}).dataset ? rows.find((r) => r.classList.contains('is-max')).dataset.k : null,
      spotVisible, head: (c.querySelector('.stkgl-ch') || {}).innerText || '', first: rows[0] && rows[0].innerText.replace(/\n/g, ' '), bg: rows.slice(0, 40).map((r) => r.style.backgroundImage.match(/\) ([\d.]+)%/)).filter(Boolean).length,
      scroll: l ? l.scrollHeight > l.clientHeight : false };
  });
  return { cols, foot: (root.querySelector('.stkgl-foot') || {}).innerText, tabsVisible: root.querySelector('.stkgl-tabs').offsetParent !== null };
});
const flashData = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart, seen = new Set();
  const find = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null; seen.add(o); if (o.nativeData instanceof Map && o.nativeData.has('stk_gexflash')) return o.nativeData.get('stk_gexflash'); for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} } return null; };
  const v = find(c, 0); return v ? JSON.parse(JSON.stringify(v)) : null; });
(async () => {
  const b = await launch();
  try {
    for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
      const { ctx, p, errors } = await open(b, { w, h, mobile });
      await setSym(p, 'futures:ES1!', '5'); await sleep(2500);
      const R = (f) => p.evaluate(f);
      // Latest: scroll far back, click, expect the right margin back (6 = default rightBars)
      await R(() => { const r = window.STRYKER_VELA.chart.renderer.renderer; const v = r.coords.getViewport(); r.applyViewport({ barSpacing: v.barSpacing, rightOffset: -80 }); });
      await sleep(400);
      const ro0 = await R(() => window.STRYKER_VELA.chart.renderer.renderer.coords.getViewport().rightOffset);
      await p.click('.stkc-fl button:nth-child(2)'); await sleep(900);
      const ro1 = await R(() => window.STRYKER_VELA.chart.renderer.renderer.coords.getViewport().rightOffset);
      check(ro0 < 0 && Math.abs(ro1 - 6) < 0.6, w + ': Latest: offset ' + ro0.toFixed(1) + ' -> ' + ro1.toFixed(1) + ' (normal right margin)');
      // Fit price: set a manual scale far off, click, expect manualScale null
      await R(() => { const r = window.STRYKER_VELA.chart.renderer.renderer; for (const pane of r.scene.panes.values()) pane.manualScale = { ...pane.scale, min: pane.scale.min - 500, max: pane.scale.max + 500 }; r.scheduler.invalidate(4); });
      await sleep(300);
      const m0 = await R(() => [...window.STRYKER_VELA.chart.renderer.renderer.scene.panes.values()].filter((x) => x.manualScale).length);
      await p.click('.stkc-fl button:nth-child(1)'); await sleep(600);
      const m1 = await R(() => [...window.STRYKER_VELA.chart.renderer.renderer.scene.panes.values()].filter((x) => x.manualScale).length);
      check(m0 >= 1 && m1 === 0, w + ': Fit price clears the manual scale (' + m0 + ' -> ' + m1 + ')');
      check(await R(() => { const r = document.querySelector('.stkc-fl').getBoundingClientRect(); const c = document.querySelector('.vela-cell').getBoundingClientRect(); return r.right < c.right && r.bottom < c.bottom && r.left > c.left; }), w + ': buttons inside the chart');
      await shot(p, 'fitlatest-' + w + '.png');
      check(!errors.length, w + ': no page errors ' + errors.slice(0, 2).join(' | '));
      await ctx.close();
    }
    console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exitCode = fail ? 1 : 0;
  } finally { await b.close(); }
})();
