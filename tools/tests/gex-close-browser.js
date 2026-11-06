// GEX "Daily close" levels option (Owner 2026-11-06), browser test: the GEX+ page "Levels" switch and the chart
// indicator's "Levels from" input. /api/gex/levels/* is mocked: the default request answers an intraday response whose
// walls move on EVERY request (a new update each time); ?basis=close answers a fixed close response. Checks: switching
// shows the close values + "Levels from Thu 5 Nov close", a new intraday update does not move them, switching back
// restores the intraday levels, the choice is remembered, saved charts (no input) keep today's behaviour.
//   node tools/tests/chart-dev-server.mjs 8091
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8091 node --max-old-space-size=768 tools/tests/gex-close-browser.js [shotsDir]
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8091';
const OUT = process.argv[2] || '/tmp';
const SPX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'gex', 'SPX-0.json')));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 240))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));
const shift = (d, by) => {
  d.call_wall += by; d.put_wall += by; d.zero_gamma += by;
  for (const f of Object.values(d.futures)) for (const k of ['call_wall', 'put_wall', 'zero_gamma']) f.levels[k] += by;
  return d;
};
// the close response: walls 40 points lower, close block, market state 'close'
const CLOSE = Object.assign(shift(clone(SPX), -40), { basis: 'close', close: { day: '2026-11-05', label: 'Thu 5 Nov', ct: 1793908860, source: 'chain', fallback: false } });
CLOSE.market = { state: 'close', options_ts: 1793908860, data_ts: 1793908860 };

async function open(b, { w, h, light, page, basis }) {
  const mobile = w < 500;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([light, basis]) => {
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      if (light) localStorage.setItem('stryker_theme', 'day');
      if (basis !== undefined && !sessionStorage.getItem('__b')) { sessionStorage.setItem('__b', '1'); if (basis) localStorage.setItem('stryker_gex_basis', basis); else localStorage.removeItem('stryker_gex_basis'); }
    } catch (e) {}
    const fn = () => Promise.resolve({ free: false });
    Object.defineProperty(window, 'strykerPlanTier', { get: () => fn, set: () => {}, configurable: true });
  }, [!!light, basis]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const hits = [];
  let n = 0;
  await ctx.route(/\/api\/gex\/levels\//, (r) => {
    const u = new URL(r.request().url());
    hits.push(u.pathname + u.search.replace(/&t=\d+/, ''));
    const close = u.searchParams.get('basis') === 'close';
    const body = close ? CLOSE : Object.assign(shift(clone(SPX), 5 * n++), { fetched_at: Date.now() / 1000 });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + page, { waitUntil: 'domcontentloaded' });
  return { ctx, p, errors, hits, live: () => n };
}
async function shot(p, name) { await sleep(400); const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('SHOT ' + f); }

// ---- GEX page ----
const pageLevels = (p) => p.evaluate(() => {
  const d = window.strykerGexData && window.strykerGexData.data;
  return { cw: d && d.call_wall, basis: window.strykerGexData && window.strykerGexData.basis, tag: (document.getElementById('gex-chart-tag') || {}).textContent || '',
    fresh: document.getElementById('gex-freshness-text').innerText, pressed: [...document.querySelectorAll('#gex-basis [data-b]')].map((b) => b.getAttribute('aria-pressed')).join(','),
    row: (document.querySelector('.gex-level.call .px') || {}).textContent, sw: document.documentElement.scrollWidth, cw2: document.documentElement.clientWidth,
    seg: (() => { const r = document.getElementById('gex-basis').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right) }; })(), text: document.body.innerText };
});
const waitData = (p, basis) => p.waitForFunction((b) => window.strykerGexData && window.strykerGexData.basis === b && window.strykerGexData.data, basis, { timeout: 20000 });

async function gexPage(b, vp) {
  const tag = vp.w + (vp.light ? ' light' : ' dark');
  const s = await open(b, Object.assign({ page: '/gex.html', basis: '' }, vp));
  const { p } = s;
  await waitData(p, '');
  await sleep(600);
  let L = await pageLevels(p);
  check(L.cw === SPX.call_wall && L.pressed === 'true,false', tag + ': default = Updated through the day, intraday levels', [L.cw, L.pressed]);
  check(!/Levels from .* close/.test(L.text), tag + ': no close note by default');
  if (vp.before) await shot(p, 'gex-page-' + vp.w + (vp.light ? '-light' : '-dark') + '-default.png');
  // switch to Daily close (real click / tap)
  const btn = await p.$('#gex-basis [data-b="close"]');
  if (vp.w < 500) await btn.tap(); else await btn.click();
  await waitData(p, 'close');
  await sleep(600);
  L = await pageLevels(p);
  check(L.cw === CLOSE.call_wall && L.pressed === 'false,true', tag + ': Daily close -> close levels', [L.cw, L.row]);
  check(/Levels from Thu 5 Nov close/.test(L.tag) && /Levels from Thu 5 Nov close/.test(L.fresh), tag + ': note "Levels from Thu 5 Nov close"', [L.tag, L.fresh]);
  check(s.hits.some((x) => /basis=close/.test(x)), tag + ': asked ?basis=close');
  check(L.sw <= L.cw2, tag + ': no horizontal scroll', [L.sw, L.cw2]);
  check(L.seg.h >= 40 && L.seg.r <= vp.w, tag + ': control size + inside the screen', L.seg);
  check(!/\b(live|real-time|realtime|delayed|behind)\b/i.test((await p.evaluate(() => document.querySelector('.gex-head').innerText + ' ' + document.querySelector('.gex-status').innerText))), tag + ': no live / real-time / delayed / behind in GEX header + status');
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot(p, 'gex-page-' + vp.w + (vp.light ? '-light' : '-dark') + '-close.png');
  // a new intraday update arrives (the page's 60 s refresh): close levels stay
  const before = s.live();
  await p.evaluate(() => document.querySelector('.gex-dte.is-on').click());
  await sleep(1500);
  L = await pageLevels(p);
  check(L.cw === CLOSE.call_wall && s.live() === before, tag + ': refresh in close mode keeps the close levels (no intraday request)', [L.cw, s.live() - before]);
  // remembered across reload
  await p.reload({ waitUntil: 'domcontentloaded' });
  await waitData(p, 'close');
  L = await pageLevels(p);
  check(L.cw === CLOSE.call_wall && L.pressed === 'false,true', tag + ': choice remembered after reload');
  // back to through the day
  const b2 = await p.$('#gex-basis [data-b=""]');
  if (vp.w < 500) await b2.tap(); else await b2.click();
  await waitData(p, '');
  await sleep(500);
  L = await pageLevels(p);
  check(L.cw !== CLOSE.call_wall && L.basis === '' && !/close/.test(L.tag), tag + ': back to Updated through the day', [L.cw, L.tag]);
  check(!s.errors.length, tag + ': no page errors', s.errors);
  await s.ctx.close();
}

// ---- chart indicator ----
const gexData = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.context().cells[0].chart, seen = new Set();
  const find = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null; seen.add(o);
    if (o.nativeData instanceof Map && o.nativeData.has('stk_gex')) return o.nativeData.get('stk_gex');
    for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} } return null; };
  return JSON.parse(JSON.stringify(find(c, 0) || null));
});
const waitBars = (p) => p.evaluate(async () => { for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {} } return false; });
const callLine = async (p) => { for (let i = 0; i < 30; i++) { const d = await gexData(p); const l = d && d.lines && d.lines.find((x) => x.id === 'call'); if (l) return { price: l.price, status: d.status }; await sleep(400); } return null; };
const setInputs = (p, o) => p.evaluate((o) => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_gex'); h.setInputs(Object.assign({}, h.inputValues(), o)); window.STRYKER_VELA.context().stateChanged(); }, o);

async function chart(b, vp) {
  const tag = 'chart ' + vp.w;
  const s = await open(b, Object.assign({ page: '/charts.html' }, vp));
  const { p } = s;
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
  await waitBars(p);
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol('futures:ES1!'); });
  await sleep(2500); await waitBars(p);
  // a saved chart from before this option: no 'basis' input at all
  await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_gex', { inputs: { dte: '0' } }); window.STRYKER_VELA.context().stateChanged(); });
  let L = await callLine(p);
  const live0 = L && L.price;
  check(L && Math.abs(L.price - SPX.futures.ES.levels.call_wall) < 0.02 + 5 * 3 && /^GEX updated/.test(L.status), tag + ': saved chart without the input = Updated through the day', L);
  const inp = await p.evaluate(() => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_gex'); return h.inputValues().levelsFrom; });
  check(inp === undefined || inp === 'Updated through the day', tag + ': default input value', inp);
  // the "Levels from" input in the settings dialog
  await p.evaluate(() => { const ch = window.STRYKER_VELA.context().cells[0].chart; const n = ch.renderer.inputsUI ? ch.renderer : ch.renderer.renderer; const id = ch.indicators().find((x) => x.nativeType === 'stk_gex').id; const r = n.inputsUI.rows.get(id); const cog = r && [...r.el.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Settings'); if (cog) cog.click(); });
  await p.waitForSelector('.vela-ind-dialog', { timeout: 8000 }).catch(() => {});
  const dlg = await p.evaluate(() => { const d = document.querySelector('.vela-ind-dialog'); if (!d) return null; const t = d.innerText; return { has: /Levels from/.test(t), opts: /Updated through the day/.test(t), first: t.indexOf('Levels from') < t.indexOf('Expiry') }; });
  check(dlg && dlg.has && dlg.opts && dlg.first, tag + ': settings dialog shows "Levels from" first, default Updated through the day', dlg);
  await shot(p, 'chart-settings-' + vp.w + (vp.light ? '-light' : '-dark') + '.png');
  await p.evaluate(() => { const b = [...document.querySelectorAll('.vela-ind-dialog button')].find((x) => /^cancel$/i.test(x.textContent.trim())); if (b) b.click(); });
  await sleep(500);
  // switch to Daily close
  await setInputs(p, { levelsFrom: 'Daily close' });
  await sleep(1500);
  L = await callLine(p);
  check(L && Math.abs(L.price - CLOSE.futures.ES.levels.call_wall) < 0.02, tag + ': Daily close -> ES call wall = close value ' + CLOSE.futures.ES.levels.call_wall, L);
  check(L && /^Levels from Thu 5 Nov close/.test(L.status) && !/\b(live|real-time|delayed|behind)\b/i.test(L.status), tag + ': status "Levels from Thu 5 Nov close"', L && L.status);
  // a new intraday update lands in the shared cache (5-minute poll): the close lines stay
  await p.evaluate(async () => { const m = await import('/assets/chart-gex-levels.js?v=' + document.querySelector('meta[name=stryker-build]').content); await m.gexFetch('SPX', 0, true, ''); });
  await setInputs(p, { showIv: true });   // forces a rebuild of the payload
  await sleep(1200);
  L = await callLine(p);
  check(L && Math.abs(L.price - CLOSE.futures.ES.levels.call_wall) < 0.02, tag + ': new intraday update arrived, close lines unchanged', L);
  if (vp.shotChart) { await shot(p, 'chart-close-' + vp.w + '-dark.png'); }
  // and back
  await setInputs(p, { levelsFrom: 'Updated through the day' });
  await sleep(1500);
  L = await callLine(p);
  check(L && Math.abs(L.price - CLOSE.futures.ES.levels.call_wall) > 1 && /^GEX updated/.test(L.status), tag + ': back to Updated through the day', [L, live0]);
  check(!s.errors.length, tag + ': no page errors', s.errors);
  await s.ctx.close();
}

(async () => {
  const b = await launch();
  try {
    if (!process.env.SKIP_PAGE) for (const vp of [{ w: 1440, h: 900, before: true }, { w: 1440, h: 900, light: true, before: true }, { w: 390, h: 844, before: true }, { w: 412, h: 915, before: true }]) await gexPage(b, vp);
    if (!process.env.SKIP_CHART) for (const vp of [{ w: 1440, h: 900, shotChart: true }, { w: 1440, h: 900, light: true, basis: undefined }, { w: 390, h: 844 }, { w: 412, h: 915 }]) await chart(b, vp);
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
