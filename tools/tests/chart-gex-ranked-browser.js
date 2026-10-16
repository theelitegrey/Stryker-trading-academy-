// Charts GEX Levels: "Top 10 ranked" tags + previous days' big levels (browser test).
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
const tagRe = /^\d{1,2}\/\d{1,2} · \$[\d.]+[MB]$/;

(async () => {
  const b = await launch();
  try {
    console.log('test days', DAYS.join(' '));
    // ---- Pro, desktop, ES (SPX) ----
    let { ctx, p, errors, hits } = await open(b, { w: 1440, h: 900 });
    await setSym(p, 'futures:ES1!', '5');
    await addGex(p, { showRanked: true }); await sleep(4500);
    let d = await gexData(p);
    check((d.lines || []).filter((l) => /^rk\d+$/.test(l.id)).length === 5, 'default: top 5 ranked strikes shown');
    await setInputs(p, { rankedCount: '10' }); await sleep(1200);
    d = await gexData(p);
    const rk = (d.lines || []).filter((l) => /^rk\d+$/.test(l.id));
    check(rk.length === 10, 'ES: ten ranked strike lines (' + rk.length + ')');
    check(rk.every((l) => /^#\d+ (Support|Resistance|Magnet|Accelerant)$/.test(l.text)), 'ranked tags read "#n Role": ' + rk.slice(0, 3).map((l) => l.text).join(' | '));
    check(rk.every((l, i) => l.rank === i + 1 && l.share <= 1 && (i === 0 || l.share <= rk[i - 1].share + 1e-9)), 'ranks 1..10, sizes fall from rank 1');
    const roles = new Set(rk.map((l) => l.text.split(' ')[1]));
    check(roles.size >= 2, 'roles present: ' + [...roles].join(', '));
    const zero = d.lines.find((l) => l.id === 'zero');
    check(zero && /Flip/.test(zero.text), 'zero gamma line carries the Flip tag: ' + (zero && zero.text));
    const pv = (d.lines || []).filter((l) => /^pv\d+_\d+$/.test(l.id));
    check(pv.length === 4 && pv.every((l) => tagRe.test(l.text) && l.dash === 'dotted' && l.faint), 'previous days: 2 days x 2 strikes, faded dotted, tags like "10/15 · $1.6B": ' + pv.map((l) => l.text).join(' | '));
    const wantDays = DAYS.slice(1, 3).map((x) => +x.slice(5, 7) + '/' + +x.slice(8, 10));
    check(pv.every((l) => wantDays.includes(l.text.split(' ')[0])), 'previous days are the last two sessions before today (' + wantDays.join(', ') + ')');
    await wide(p, 7640, 8000); await sleep(800);
    let tg = await tagsOf(p);
    check(tg.length > 4 && noOverlap(tg), '1440: ' + tg.length + ' tags, none overlap');
    await shot(p, 'ranked-es-1440.png');
    // N = 0 -> none, N = 3 -> six
    await setInputs(p, { prevDays: 0 }); await sleep(1200);
    d = await gexData(p);
    check(!(d.lines || []).some((l) => /^pv/.test(l.id)), 'previous days = 0: none drawn');
    await setInputs(p, { prevDays: 3 }); await sleep(2500);
    d = await gexData(p);
    check((d.lines || []).filter((l) => /^pv/.test(l.id)).length === 6, 'previous days = 3: six lines');
    await setInputs(p, { prevDays: 2, showPrev: false }); await sleep(1000);
    d = await gexData(p);
    check(!(d.lines || []).some((l) => /^pv/.test(l.id)), 'previous days toggle off: none drawn');
    await setInputs(p, { showPrev: true, showRanked: false }); await sleep(1000);
    d = await gexData(p);
    check(!(d.lines || []).some((l) => /^rk/.test(l.id)) && (d.lines || []).filter((l) => /^pv/.test(l.id)).length === 4, 'ranked toggle off: no ranked tags, previous days stay');
    await setInputs(p, { showRanked: true, rankedCount: '10' });
    // NQ conversion
    await setSym(p, 'futures:NQ1!', '5'); await sleep(3000);
    d = await gexData(p);
    const nq = LV.QQQ.futures.NQ;
    const rk1 = (d.lines || []).find((l) => l.id === 'rk1');
    check(rk1 && rk1.price > LV.QQQ.spot * nq.ratio * 0.9 && rk1.price < LV.QQQ.spot * nq.ratio * 1.1, 'NQ: ranked strikes converted to futures prices (rk1 ' + (rk1 && rk1.price) + ')');
    const pvq = (d.lines || []).filter((l) => /^pv/.test(l.id));
    check(pvq.length === 4 && pvq.every((l) => l.price > 10000), 'NQ: previous-day lines converted to NQ prices (' + pvq.map((l) => l.price).join(', ') + ')');
    hits.length = 0;
    // ---- bar replay: only days before the replay day ----
    await setSym(p, 'futures:ES1!', '5');
    const mid = session('SPX', 0, DAYS[2]);          // replay inside the 3rd newest day
    const E = (mid[60].t + 1) * 1000;
    await p.evaluate(async (E) => { await window.__stkBarReplay.setStepTf('5'); await window.__stkBarReplay.start(E); }, E);
    await p.waitForFunction(() => window.__stkBarReplay.state.on && !window.__stkBarReplay.state.busy, null, { timeout: 30000 });
    await sleep(5000);
    d = await gexData(p);
    const pvr = (d.lines || []).filter((l) => /^pv/.test(l.id));
    const allowed = DAYS.slice(3).map((x) => +x.slice(5, 7) + '/' + +x.slice(8, 10));   // only the day before the replay day exists
    check(pvr.length === 2 && pvr.every((l) => allowed.includes(l.text.split(' ')[0])), 'replay: only days before the replay day (' + pvr.map((l) => l.text).join(' | ') + '; allowed ' + allowed.join(',') + ')');
    check(!pvr.some((l) => l.text.startsWith(+DAYS[2].slice(5, 7) + '/' + +DAYS[2].slice(8, 10))) && !pvr.some((l) => l.text.startsWith(+DAY.slice(5, 7) + '/' + +DAY.slice(8, 10))), 'replay: the replay day and later days never appear');
    check((d.lines || []).filter((l) => /^rk/.test(l.id)).length > 0, 'replay: ranked strikes come from the recorded snapshot (' + (d.lines || []).filter((l) => /^rk/.test(l.id)).length + ')');
    check(hits.filter((x) => x.path === '/gex-history').every((x) => x.to <= Math.floor(E / 1000) + 6 * 3600 + 60 || DAYS.slice(3).some((dd) => x.to < Date.parse(dd + 'T23:59:59Z') / 1000 + 3600)), 'replay: no history request reaches past the replay window (' + hits.filter((x) => x.path === '/gex-history').length + ' requests)');
    await shot(p, 'ranked-replay-1440.png');
    await p.evaluate(async () => { await window.__stkBarReplay.exit && window.__stkBarReplay.exit(); });
    check(!errors.length, 'no page errors (' + errors.slice(0, 3).join(' | ') + ')');
    await ctx.close();

    // ---- phone 390 Pro ----
    ({ ctx, p, errors, hits } = await open(b, { w: 390, h: 844, mobile: true }));
    await setSym(p, 'futures:ES1!', '5');
    await addGex(p, { showRanked: true, rankedCount: '10' }); await sleep(4500);
    await wide(p, 7640, 8000); await sleep(800);
    tg = await tagsOf(p);
    check(tg.length > 3 && noOverlap(tg), '390: ' + tg.length + ' tags, none overlap');
    check(tg.every((t) => t.box.x >= 0 && t.box.w <= 390 * 0.62), '390: tags stay narrow (max ' + Math.max(...tg.map((t) => t.box.w)) + ' px)');
    await shot(p, 'ranked-es-390.png');
    check(!errors.length, '390: no page errors (' + errors.slice(0, 3).join(' | ') + ')');
    await ctx.close();

    // ---- Free: ES yes, NQ locked ----
    ({ ctx, p, errors, hits } = await open(b, { w: 1440, h: 900, free: true }));
    await setSym(p, 'futures:ES1!', '5');
    await addGex(p, { showRanked: true, rankedCount: '10' }); await sleep(4500);
    d = await gexData(p);
    check((d.lines || []).filter((l) => /^rk/.test(l.id)).length === 10 && (d.lines || []).filter((l) => /^pv/.test(l.id)).length === 4, 'Free ES: ranked + previous days work on SPX/ES');
    hits.length = 0;
    await setSym(p, 'futures:NQ1!', '5'); await sleep(2500);
    d = await gexData(p);
    check(d && d.pill && /Pro/.test(d.pill) && !(d.lines || []).length, 'Free NQ: Pro pill, no lines (' + (d && d.pill) + ')');
    check(!hits.some((x) => x.u === 'QQQ'), 'Free NQ: no QQQ history requested');
    await shot(p, 'ranked-nq-free-1440.png');
    check(!errors.length, 'free: no page errors (' + errors.slice(0, 3).join(' | ') + ')');
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
