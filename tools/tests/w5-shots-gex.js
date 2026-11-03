// Charts "TradeZoro GEX Levels" browser test (assets/chart-gex-levels.js).
//   node tools/tests/chart-dev-server.mjs 8031     (site + /api/chart/bars, binds 127.0.0.1)
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-gex-indicator-browser.js [shotsDir]
// /api/gex/levels/* is answered from tools/tests/fixtures/gex/*.json (real API responses,
// saved 2026-10-07), so the expected numbers are known. Firebase is stubbed (richstub.js, an
// Elite member); the Free case forces window.strykerPlanTier to report a Free plan.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp'; fs0=require('fs');
const FIX = path.join(__dirname, 'fixtures', 'gex');
const SPX = JSON.parse(fs.readFileSync(path.join(FIX, 'SPX-0.json')));
const QQQ = JSON.parse(fs.readFileSync(path.join(FIX, 'QQQ-0.json')));
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (v) => Math.round(v * 100) / 100;

async function open(b, { w, h, mobile, free }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((free) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
    if (free) Object.defineProperty(window, 'strykerPlanTier', { configurable: false, get: () => () => Promise.resolve({ free: true }), set() {} });
  }, !!free);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const gexHits = [];
  await ctx.route(/\/api\/gex\/levels\//, (r) => {
    const u = new URL(r.request().url()); gexHits.push(u.pathname + u.search);
    const name = u.pathname.split('/').pop().toUpperCase();
    const body = name === 'SPX' ? SPX : name === 'QQQ' ? QQQ : null;
    if (!body) return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"unknown market"}' });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 45000 });
  await waitBars(p);
  return { ctx, p, errors, gexHits };
}
const waitBars = (p) => p.evaluate(async () => {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {}
  }
  return false;
});
const setSym = async (p, sym, tf) => { await p.evaluate(([s, tf]) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol(s); if (tf) c.setTimeframe(tf); }, [sym, tf]); await sleep(2500); await waitBars(p); await sleep(1500); };
// The payload the indicator pushed to its renderer layer (what gets painted).
const gexData = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.context().cells[0].chart;
  const seen = new Set();
  const find = (o, d) => {
    if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null;
    seen.add(o);
    if (o.nativeData instanceof Map && o.nativeData.has('stk_gex')) return o.nativeData.get('stk_gex');
    for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} }
    return null;
  };
  return JSON.parse(JSON.stringify(find(c, 0) || null));
});
const chip = (p) => p.evaluate(() => { const c = document.querySelector('.stk-gex-chip'); return c && !c.hidden ? { text: c.textContent, href: (c.querySelector('a') || {}).href || null, r: c.getBoundingClientRect().toJSON() } : null; });
const natives = (p) => p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.indicators().filter((h) => h.nativeType).map((h) => ({ type: h.nativeType, inputs: h.inputValues() })));
// Label boxes the renderer layer painted last frame (canvas.__stkGexTags test hook).
const tagsOf = (p) => p.evaluate(() => { for (const c of document.querySelectorAll('canvas')) if (c.__stkGexTags) return c.__stkGexTags; return []; });
const noOverlap = (tg) => tg.every((a, i) => tg.every((b, j) => i >= j || a.box.y + a.box.h <= b.box.y || b.box.y + b.box.h <= a.box.y));
async function shot(p, name) { await p.mouse.move(5, 5).catch(() => {}); await sleep(500); await p.screenshot({ path: OUT + '/' + name }); console.log('SHOT ' + OUT + '/' + name); }

async function addFromWindow(p) {
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await sleep(600);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.stkiw-side button, .stkiw-side a')].find((x) => /Technicals/.test(x.textContent)); if (b) b.click(); });
  await sleep(400);
  const info = await p.evaluate(() => {
    const grps = [...document.querySelectorAll('.stkiw-list .stkiw-grp')].map((g) => g.textContent);
    const first = document.querySelector('.stkiw-list .stkiw-row');
    const row = document.querySelector('.stkiw-row[data-key="b:stk_gex"]');
    return { grps: grps.slice(0, 3), first: first && first.getAttribute('data-key'), text: row && row.textContent, vela: /vela|luxalgo/i.test(document.querySelector('.stkiw-list').textContent) };
  });
  await p.evaluate(() => document.querySelector('.stkiw-row[data-key="b:stk_gex"] .stkiw-name').click());
  await sleep(500);
  return info;
}


(async () => {
  const b = await launch();
  try {
    for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
      const { ctx, p, errors } = await open(b, { w, h, mobile });
      await p.addStyleTag({ content: '.tzc,.toast{display:none!important}' });
      await setSym(p, 'futures:ES1!', '5');
      await p.evaluate(() => { window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator('stk_gex'); });
      await sleep(3000);
      const es = SPX.futures.ES.levels;
      await p.evaluate(([lo, hi]) => { try { window.STRYKER_VELA.context().cells[0].chart.setPriceRange(lo, hi); } catch (e) {} }, [es.put_wall - 40, es.call_wall + 40]);
      await sleep(1500);
      await p.screenshot({ path: OUT + '/gex-' + w + '.png' });
      console.log(w, 'errors', errors.length, errors.slice(0, 2));
      await ctx.close();
    }
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
