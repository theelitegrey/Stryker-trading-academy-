// Delta / Vanna / Charm Exposure: browser test + screenshots, on the REAL feeder profiles in tools/tests/fixtures/greeks
// (zoro_feeder.analyse on the QQQ / SPX chains of 2026-11-06; times moved to "2 min ago", expiry dates moved by the same days).
//   node tools/tests/chart-dev-server.mjs 8077 &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8077 node tools/tests/greek-exposure-browser.js [shotsDir]
// 1) charts.html, NQ1! (mapped from QQQ): the three indicators draw bars + 3 lines, the 0DTE / Next expiry settings ask the right
//    profile mode, the status says "updated 2 min ago", Free sees the Pro pill and no fetch, replay hides them.
// 2) gex.html: the "Delta, vanna and charm exposure" panel (tiles = feeder totals, strike table, 3-way toggle, SPX with no 0DTE).
// 3) zoro-options.html?fixture=1: the greeks panel's new "Vol GEX" tab (GEX from today's volume).
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8077';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOW = Math.floor(Date.now() / 1000);
const FIX = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'greeks', n), 'utf8'));
const etDay = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t * 1000)).slice(0, 10);
const BANNED = /real-time|realtime|delayed|\bbehind\b|bullish|bearish|call resistance|put support|\bHVL\b|gamma wall/i;
// shift a fixture so its chain time is 2 min ago and its expiry dates keep the same distance from "today" (New York)
let CHAIN_T = 0;   // chart test: the last NQ bar's time (on a weekend 'now' has no bar to map futures with)
function moved(name) {
  const f = FIX(name), t = CHAIN_T || NOW - 120;
  const days = Math.round((Date.parse(etDay(t)) - Date.parse(etDay(f.t))) / 86400000);
  const sh = (d) => new Date(Date.parse(d) + days * 86400000).toISOString().slice(0, 10);
  return Object.assign({}, f, { t, built: t, expiry: (f.expiry || []).map(sh) });
}
const profile = (u, x) => { try { return moved('profile-' + u + '-' + x + '.json'); } catch (e) { return null; } };

async function ctxFor(b, o) {
  const { w, h, mobile, free, light } = o;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  // gex-auth.js (GEX+ page) sends the stub token at once only when firebase looks initialised; on charts.html this would make
  // rtHeadersReady wait for a real token, so it is set for the pages only
  if (!o.chart) await ctx.addInitScript(() => { try { if (window.firebase && window.firebase.apps && !window.firebase.apps.length) window.firebase.apps.push({ name: '[DEFAULT]' }); } catch (e) {} });
  await ctx.addInitScript((o) => {
    try {
      localStorage.setItem('tz_consent', JSON.stringify({ v: 1, essential: true, analytics: false, at: new Date().toISOString() }));
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      localStorage.setItem('zo_preview', '1');
      if (o.light) localStorage.setItem('stryker_theme', 'day'); else localStorage.removeItem('stryker_theme');
    } catch (e) {}
    if (o.free) window.__zoTestFree = true;
    const fn = () => Promise.resolve({ free: !!o.free }); Object.defineProperty(window, 'strykerPlanTier', { get: () => fn, set: () => {}, configurable: true });
  }, { free: !!free, light: !!light });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const hits = [];
  await ctx.route(/\/api\/zo\//, (r) => {
    const u = new URL(r.request().url()); hits.push(u.pathname.split('/').pop() + '?' + u.searchParams.toString());
    const name = u.pathname.split('/').pop(), sym = u.searchParams.get('u');
    let body = null;
    if (name === 'profile') body = profile(sym, u.searchParams.get('x'));
    else if (name === 'summary') { try { body = Object.assign(FIX('summary-' + sym + '.json'), { t: NOW - 120, built: NOW - 120 }); } catch (e) {} }
    r.fulfill({ status: body ? 200 : 404, contentType: 'application/json', body: JSON.stringify(body || { error: 'n/a' }) });
  });
  // ZoroOptions fixture mode: the greeks panel reads the real greeks fixtures (they carry gexv)
  await ctx.route(/\/tools\/tests\/fixtures\/zoro\/profile-(SPX|QQQ)-(all|0|1)\.json/, (r) => {
    const m = /profile-(SPX|QQQ)-(all|0|1)\.json/.exec(r.request().url());
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile(m[1], m[2])) });
  });
  await ctx.route(/\/api\/gex\//, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"x"}' }));
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|WebSocket|wss?:\/\//.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, p, errors, hits };
}
async function shot(p, name, el) { await p.mouse.move(5, 5).catch(() => {}); await sleep(500); const f = path.join(OUT, name); if (el) await p.locator(el).screenshot({ path: f }); else await p.screenshot({ path: f }); console.log('SHOT ' + f); }
const dataOf = (p, type) => p.evaluate((t) => {
  const c = window.STRYKER_VELA.context().cells[0].chart, seen = new Set();
  const find = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null; seen.add(o); if (o.nativeData instanceof Map && o.nativeData.has(t)) return o.nativeData.get(t); for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} } return null; };
  return JSON.parse(JSON.stringify(find(c, 0) || null));
}, type);
const drawn = (p) => p.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => c.__stkGreek).filter(Boolean).filter((x) => x.bars || x.lines));
const TYPES = ['stk_dex', 'stk_vex', 'stk_cex'];

async function charts(b, o, tag) {
  const { ctx, p, errors, hits } = await ctxFor(b, Object.assign({ chart: true }, o));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 45000 });
  await p.evaluate(async () => { for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return; } catch (e) {} } });
  await p.evaluate(() => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol('futures:NQ1!'); c.setTimeframe('5'); });
  await sleep(3000);
  CHAIN_T = await p.evaluate(() => { const rb = window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars; const t = rb.length ? rb[rb.length - 1].time : 0; return t ? Math.floor(t / 1000) + 60 : 0; });
  const AGO = Math.max(0, Math.floor((NOW - (CHAIN_T || NOW - 120)) / 60));
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await sleep(700);
  const keys = await p.evaluate(() => [...document.querySelectorAll('.stkiw-row')].map((r) => r.getAttribute('data-key')));
  if (!o.free) for (const k of TYPES) check(keys.includes('b:' + k), tag + ': b:' + k + ' in the indicator list');
  await p.keyboard.press('Escape'); await sleep(300);
  await p.evaluate((ts) => { const c = window.STRYKER_VELA.context().cells[0].chart; ts.forEach((t) => c.addNativeIndicator(t, { inputs: {} })); window.STRYKER_VELA.context().stateChanged(); }, o.free ? ['stk_vex'] : TYPES);
  await sleep(4000);
  if (o.free) {
    const d = await dataOf(p, 'stk_vex');
    const nat = await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.indicators().filter((h) => h.nativeType).map((h) => h.nativeType));
    check((!nat.includes('stk_vex') || (d && /Pro/.test(d.pill || ''))) && !hits.some((x) => /^profile/.test(x)), tag + ': Free: locked (' + JSON.stringify(d && d.pill) + ', natives ' + nat.join(',') + '), no profile fetch');
    check(!errors.length, tag + ': no console errors ' + errors.slice(0, 2).join(' | '));
    await ctx.close(); return;
  }
  const want = profile('QQQ', 'all');
  for (const t of TYPES) {
    const d = await dataOf(p, t), col = { stk_dex: 'dex', stk_vex: 'vanna', stk_cex: 'charm' }[t];
    check(d && d.rows && d.rows.length === want.rows.length && d.top && d.top.length === 3, tag + ': ' + t + ' ' + (d && d.rows && d.rows.length) + ' bars + ' + (d && d.top && d.top.length) + ' lines ' + (d && !d.rows ? JSON.stringify(d) : ''));
    check(d && /(updated (\d+ (min|h) ago|\d+ days ago)|live)/.test(d.status) && /mapped from QQQ/.test(d.status) && /all expiries/.test(d.status) && !BANNED.test(d.status), tag + ': status "' + (d && d.status) + '"');
    const tot = want.tot[col];
    check(d && String(d.status).includes('net '), tag + ': ' + t + ' net total shown (feeder ' + tot + ' $M)');
  }
  const dr = await drawn(p);
  // lines are painted only when their strike is on screen (the largest can sit far from spot), so bars are the paint check
  check(dr.length === 3 && dr.every((x) => x.bars >= 5 && x.lines <= 3), tag + ': three canvases painted ' + JSON.stringify(dr));
  await shot(p, 'greeks-chart-' + tag + '.png');
  // 0DTE on Vanna, Next expiry on Charm: QQQ has a same-day expiry on the fixture day
  await p.evaluate(() => { const hs = window.STRYKER_VELA.context().cells[0].chart.indicators(); const f = (t) => hs.find((h) => h.nativeType === t);
    f('stk_vex').setInputs(Object.assign({}, f('stk_vex').inputValues(), { expiry: '0DTE' })); f('stk_cex').setInputs(Object.assign({}, f('stk_cex').inputValues(), { expiry: 'Next expiry' }));
    f('stk_dex').setInputs(Object.assign({}, f('stk_dex').inputValues(), { bars: false })); });
  await sleep(3000);
  const v0 = await dataOf(p, 'stk_vex'), c1 = await dataOf(p, 'stk_cex'), d0 = await dataOf(p, 'stk_dex');
  const fx0 = profile('QQQ', '0');
  const day0 = fx0.expiry[0] === etDay(fx0.t);
  if (day0) {
    check(v0 && /0DTE/.test(v0.status) && v0.rows.length === fx0.rows.length, tag + ': Vanna 0DTE uses mode 0 (' + (v0 && v0.status) + ')');
    check(c1 && /next expiry/.test(c1.status) && hits.some((x) => /profile\?u=QQQ&x=1/.test(x)), tag + ': Charm next expiry asks x=1 (' + JSON.stringify(c1 && (c1.status || c1.note)) + ')');
  } else {
    check(v0 && /No same-day expiry today/.test(v0.note || ''), tag + ': Vanna 0DTE on a day with no same-day expiry says so');
    check(c1 && /next expiry/.test(c1.status), tag + ': Charm next expiry = mode 0');
  }
  check(d0 && d0.rows.length === 0 && d0.top.length === 3, tag + ': Delta "Bars by strike" off -> lines only');
  // replay hides them
  await p.evaluate(() => { window.__stkReplay = { on: true, E: Date.now() - 3600e3 }; window.STRYKER_VELA.context().cells[0].chart.indicators().filter((h) => /stk_[dvc]ex/.test(h.nativeType)).forEach((h) => h.setInputs(Object.assign({}, h.inputValues()))); });
  await sleep(1500);
  const rv = await dataOf(p, 'stk_vex');
  check(rv && /hidden during bar replay/.test(rv.note || ''), tag + ': replay: hidden');
  await p.evaluate(() => { window.__stkReplay = { on: false }; });
  check(!errors.length, tag + ': no console errors ' + errors.slice(0, 2).join(' | '));
  CHAIN_T = 0;
  await ctx.close();
}

async function gexPage(b, o, tag) {
  CHAIN_T = 0;
  const { ctx, p, errors, hits } = await ctxFor(b, o);
  await p.goto(BASE + '/gex.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.querySelector('#gex-greeks .gexg-table, #gex-greeks .gexo-empty'), null, { timeout: 25000 });
  await sleep(800);
  const read = () => p.evaluate(() => { const h = document.getElementById('gex-greeks');
    return { tiles: [...h.querySelectorAll('.gexg-stat')].map((x) => x.querySelector('span').textContent + '=' + x.querySelector('b').textContent), rows: h.querySelectorAll('.gexg-table tbody tr').length,
      ago: h.querySelector('.gexo-ago').textContent, text: h.innerText, empty: (h.querySelector('.gexo-empty') || {}).textContent || '', on: (h.querySelector('.gexg-exp.is-on') || {}).textContent,
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }; });
  let s = await read();
  const spx = profile('SPX', 'all');
  const M = (m) => { const a = Math.abs(m), sg = m < 0 ? '-' : '+'; return a >= 1000 ? sg + '$' + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'B' : a >= 1 ? sg + '$' + a.toFixed(a >= 100 ? 0 : 1) + 'M' : sg + '$' + Math.round(a * 1000) + 'K'; };
  check(s.rows === 25 && s.on === 'All expiries', tag + ': SPX all expiries, 25 strikes (' + s.rows + ')');
  check(s.tiles.length === 5 && s.tiles[0].endsWith(M(spx.tot.gex) + ' /1%') && s.tiles[2].endsWith(M(spx.tot.dex)), tag + ': tiles = feeder totals ' + s.tiles.join(' | '));
  check(/(Updated (\d+ min ago|\d+ h ago)|Live)/.test(s.ago) && !BANNED.test(s.text) && /Education only\. Not financial advice\./.test(s.text) && /How it\u2019s calculated/.test(s.text), tag + ': "' + s.ago + '", wording, disclaimer, how note');
  check(s.sw <= s.cw + 1, tag + ': no horizontal page overflow');
  await p.locator('#gex-greeks').scrollIntoViewIfNeeded();
  await shot(p, 'greeks-gexplus-' + tag + '.png', '#gex-greeks');
  // SPX fixture's first expiry is the next session -> 0DTE says so
  await p.click('#gex-greeks .gexg-exp[data-x="0dte"]'); await sleep(800);
  s = await read();
  const s0 = profile('SPX', '0');
  check(s0.expiry[0] === etDay(s0.t) ? s.rows === 25 : /no same-day expiry/.test(s.empty), tag + ': SPX 0DTE (' + (s.empty || s.rows + ' rows') + ')');
  await p.click('#gex-greeks .gexg-exp[data-x="next"]'); await sleep(800);
  s = await read();
  check(s.rows > 0 && /expiry/.test(s.text), tag + ': SPX next expiry has rows');
  // market tab QQQ + 0DTE
  await p.click('#gex-tabs [data-m="QQQ"]').catch(() => {}); await sleep(1200);
  await p.click('#gex-greeks .gexg-exp[data-x="0dte"]'); await sleep(1000);
  s = await read();
  check(hits.some((x) => /profile\?u=QQQ&x=0/.test(x)) && (s.rows === 25 || /no same-day expiry/.test(s.empty)), tag + ': QQQ tab -> QQQ profile (' + (s.empty || s.rows + ' rows') + ')');
  check(s.tiles.some((x) => /today\u2019s volume/.test(x)) || !!s.empty, tag + ': GEX from today\u2019s volume tile');
  await shot(p, 'greeks-gexplus-' + tag + '-qqq0.png', '#gex-greeks');
  check(!errors.length, tag + ': no console errors ' + errors.slice(0, 2).join(' | '));
  await ctx.close();
}

async function zoPage(b, o, tag) {
  const { ctx, p, errors } = await ctxFor(b, o);
  await p.goto(BASE + '/zoro-options.html?fixture=1', { waitUntil: 'domcontentloaded' });
  await sleep(5000);
  if (await p.locator('#zo-greek-seg').isVisible()) await p.click('#zo-greek-seg [data-g="gexv"]');   // phone: one greek at a time; desktop shows all four await sleep(600);
  const s = await p.evaluate(() => { const g = document.getElementById('zo-gk3'); const c = g && g.querySelector('canvas[data-bars="gexv"]'); let n = 0;
    if (c && c.width) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 0) n++; }
    return { show: g && g.dataset.show, tot: (g && (g.querySelector('[data-tot="gexv"]') || {}).textContent) || '', px: n, vis: c ? getComputedStyle(c.closest('.zo-gk')).display : '', sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }; });
  check((o.mobile ? s.show === 'gexv' : true) && s.vis !== 'none' && s.tot && s.px > 50, tag + ': ZoroOptions Vol GEX panel painted ' + JSON.stringify(s));
  const wide = await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 4).map((e) => e.tagName + '.' + e.className + '#' + e.id));
  // the page-wide nav dock overflows at 390 on main too (not this job); the greeks panel itself must fit
  const pr = await p.evaluate(() => { const e = document.querySelector('[data-panel="greeks"]'); const r = e.getBoundingClientRect(); return { right: r.right, sw: e.scrollWidth, cw: e.clientWidth }; });
  check(pr.right <= s.cw + 1 && pr.sw <= pr.cw + 1, tag + ': greeks panel fits the screen ' + JSON.stringify(pr) + (s.sw > s.cw + 1 ? ' (page ' + s.sw + ': ' + JSON.stringify(wide) + ')' : ''));
  await p.locator('[data-panel="greeks"]').scrollIntoViewIfNeeded().catch(() => {});
  await shot(p, 'greeks-zo-' + tag + '.png', '[data-panel="greeks"]');
  check(!errors.length, tag + ': no console errors ' + errors.slice(0, 2).join(' | '));
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    if (process.env.GK_ONLY !== 'zo') {
    await charts(b, { w: 1440, h: 900 }, '1440-dark');
    await charts(b, { w: 390, h: 844, mobile: true }, '390-dark');
    await charts(b, { w: 1440, h: 900, light: true }, '1440-light');
    await charts(b, { w: 1440, h: 900, free: true }, 'free-1440');
    await gexPage(b, { w: 1440, h: 1000 }, '1440-dark');
    await gexPage(b, { w: 390, h: 844, mobile: true }, '390-dark');
    await gexPage(b, { w: 1440, h: 1000, light: true }, '1440-light');
    }
    await zoPage(b, { w: 1440, h: 1000 }, '1440-dark');
    await zoPage(b, { w: 390, h: 844, mobile: true }, '390-dark');
    await zoPage(b, { w: 1440, h: 1000, light: true }, '1440-light');
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
