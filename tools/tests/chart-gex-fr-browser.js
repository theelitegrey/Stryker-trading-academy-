// Charts GEX Levels: Levels to show + gamma regime badge (browser test) + shots.
//   node tools/tests/chart-dev-server.mjs 8092
//   flock -w 900 /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8092 node --max-old-space-size=768 tools/tests/chart-gex-ranked-browser.js [shotsDir]
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
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const etDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
const DAY = etDay(Date.now());
const DAYS = (() => { const out = [DAY]; let t = Date.parse(DAY + 'T12:00:00Z'); while (out.length < 4) { t -= 86400000; if (![0, 6].includes(new Date(t).getUTCDay())) out.push(new Date(t).toISOString().slice(0, 10)); } return out; })();   // newest first
const ALL = (U, d) => DAYS.slice().reverse().flatMap((day) => session(U, d, day));

async function open(b, { w, h, mobile, free }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
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
    const o = JSON.parse(JSON.stringify(LV[name] || LV.SPX)); o.market.options_ts = Math.floor(Date.now() / 1000) - 20; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
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

const chipText = (p, cls) => p.evaluate((cls) => { const e = document.querySelector(cls); return e && !e.hidden ? e.textContent : null; }, '.stk-gex-regime');
const theme = (p, t) => p.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, t);
(async () => {
  const b = await launch();
  try {
    let { ctx, p, errors } = await open(b, { w: 1440, h: 900 });
    await setSym(p, 'futures:ES1!', '5');
    await addGex(p, {}); await sleep(4500);
    let d = await gexData(p);
    const idsNoPrev = (x) => (x.lines || []).map((l) => l.id).filter((i) => !/^pv/.test(i)).join();
    const base = idsNoPrev(d);
    check(!d.regime && (await chipText(p)) === null, 'default: no regime badge');
    check(!(d.lines || []).some((l) => /^oi/.test(l.id)), 'default: no OI lines; lines ' + base);
    await setInputs(p, { showRegime: true }); await sleep(1500);
    d = await gexData(p);
    const t = await chipText(p);
    check(d.regime && /^Net GEX [+-]\d/.test(d.regime.text) && /(Positive|Negative) gamma/.test(d.regime.text), 'badge text: ' + (t || '').trim());
    check(/GEX live$/.test(d.regime.text) && !/delayed/i.test(t || ''), 'fresh data says "GEX live", never delayed');
    check(t && t.includes(d.regime.text), 'chip on the chart shows it');
    await setInputs(p, { showOi: true, oiCount: 4 }); await sleep(1200);
    d = await gexData(p);
    check((d.lines || []).filter((l) => /^oi\d$/.test(l.id)).length === 4 && (d.lines || []).some((l) => l.text === 'OI #1'), 'OI top 4 drawn, tags "OI #n"');
    await wide(p, 7640, 8000); await sleep(800);
    await shot(p, 'fr-1440-dark-all.png');
    await theme(p, 'light'); await sleep(800); await shot(p, 'fr-1440-light-all.png'); await theme(p, 'dark');
    await setInputs(p, { onlyGamma: true }); await sleep(1200);
    d = await gexData(p);
    check(!(d.lines || []).some((l) => /^(vah|poc|val|onh|onl|pv|ivhi|ivlo)/.test(l.id)) && d.lines.some((l) => l.id === 'call') && d.lines.some((l) => /^oi/.test(l.id)), 'only gamma: market/IV/previous days gone, walls + OI stay: ' + d.lines.map((l) => l.id).join());
    await shot(p, 'fr-1440-dark-onlygamma.png');
    await setInputs(p, { onlyGamma: false, showOi: false, showRegime: false }); await sleep(1200);
    d = await gexData(p);
    check(idsNoPrev(d) === base && (await chipText(p)) === null, 'all new options off: same lines as the start, badge hidden');
    check(errors.length === 0, 'no console errors ' + errors.slice(0, 2).join(' | '));
    await ctx.close();
    // phone
    ({ ctx, p, errors } = await open(b, { w: 390, h: 800, mobile: true }));
    await setSym(p, 'futures:ES1!', '5');
    await addGex(p, { showRegime: true, showOi: true, oiCount: 3 }); await sleep(4500);
    await wide(p, 7640, 8000); await sleep(800);
    const m = await p.evaluate(() => { const e = document.querySelector('.stk-gex-regime'), c = document.querySelector('.stk-gex-chip:not(.stk-gex-regime)'); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(), q = c.getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth, overlap: !(r.bottom <= q.top || q.bottom <= r.top), clipped: e.scrollWidth > e.clientWidth + 1, text: e.textContent }; });
    check(m && m.r <= m.w && !m.overlap, '390: badge inside the screen, not on the updated chip ' + JSON.stringify(m));
    await shot(p, 'fr-390-dark.png');
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
