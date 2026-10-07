// Browser test: Community batch B built-ins (ICT Pro+ | TimmyNQ, iFVG Ultimate+ Deluxe, CISD
// Model+, Forever Pro°, Unicorn Model) on the Charts page.
//   CHART_BASE=http://127.0.0.1:8093 IDS=ict-pro-plus-timmynq node tools/tests/chart-pine-community-b-browser.js
// Run under `flock /tmp/stryker-chrome.lock` with a dev server (tools/tests/chart-dev-server.mjs).
// Optional DEEP=5000: load that many bars first and time the run (20 s cap). OUT=<dir> screenshots.
// SYMS=futures:NQ1!@5,binance:BTCUSDT@1 picks the markets (default NQ1! 5m).
// Checks per script: the served source is byte-identical to the file the Owner sent; it is
// listed under COMMUNITY > "Community indicators" with its own author (never Stryker); adding
// it from the window draws (lines/boxes/labels/tables/series > 0) within the cap; no console
// errors; phone 390 adds it too. Third-party scripts run AS SENT: no wording checks.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const path = require('path');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8093';
const OUT = process.env.OUT || path.join(require('os').tmpdir(), 'pine-community-b');
fs.mkdirSync(OUT, { recursive: true });
const ORIG_DIR = process.env.ORIG || '/root/projects/stryker-notes/reports/workers/pine-imports/community';
const ALL = {
  'ict-pro-plus-timmynq': ['ICT Pro+ | TimmyNQ [TakingProphets]', 'TimmyNQ (TakingProphets)'],
  'ifvg-ultimate-deluxe-dodgysdd': ['iFVG Ultimate+ Deluxe | DodgysDD', 'DodgysDD'],
  'cisd-model-plus-triton': ['CISD Model+ | Triton Trades', 'Triton Trades'],
  'forever-pro': ['Forever Pro°', 'Community'],
  'unicorn-model': ['Unicorn Model', 'Community']
};
const IDS = (process.env.IDS || Object.keys(ALL).join(',')).split(',').filter((x) => ALL[x]);
const SYMS = (process.env.SYMS || 'futures:NQ1!@5').split(',').map((s) => s.split('@'));
const CAP = 20000;
const IGNORE = /ERR_FAILED|WebGL|GroupMarker|GPU stall|favicon|firebase|Failed to load resource/i;
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

async function page(b, w, h){
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_community_disclaimer_ack_v1', JSON.stringify({ _anon: 1, u1: 1 })); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance|data-api\.binance|fapi\.binance|stream\.binance|data-stream\.binance)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text().slice(0, 300)); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 60000 });
  return { ctx, p, errs };
}
async function setMarket(p, sym, tf, deep){
  await p.evaluate(([s, t]) => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id); c.setSymbol(s); c.setTimeframe(t); }, [sym, tf]);
  return p.evaluate(async ([s, deep]) => {
    const chart = window.STRYKER_VELA.context().cells[0].chart;
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 500)); try { if (chart.market.symbol === s && chart.orchestrator.rawBars.length > 50 && chart.orchestrator.historyState !== 'backfill') break; } catch (e) {} }
    if (deep) { await chart.setMarket({ bars: deep }); await chart.historyComplete(); }
    return chart.orchestrator.rawBars.length;
  }, [sym, deep]);
}
const clearPine = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; window.STRYKER_PINE.pineHandles(c).forEach((h) => h.remove()); });
// Open the window on COMMUNITY > Community indicators, find the row, click it, wait for the
// first drawing. Returns { listed, sub, auth, ms, c }.
async function addViaWindow(p, id, name){
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await p.waitForSelector('.stkiw-row', { timeout: 20000 });
  await p.evaluate(() => { const t = document.querySelector('.stkiw-tab[data-k="community"]'); if (t) t.click(); });
  await p.waitForTimeout(400);
  const row = await p.evaluate((id) => {
    const r = document.querySelector('.stkiw-list .stkiw-row[data-key="x:' + id + '"]');
    if (!r) return null;
    const t = (s) => ((r.querySelector(s) || {}).textContent || '').trim();
    return { name: t('.stkiw-nm'), sub: t('.stkiw-sub'), auth: t('.stkiw-auth'), tag: [...r.querySelectorAll('.stkiw-pick')].map((x) => x.textContent).join(',') };
  }, id);
  if (!row) return { listed: false };
  const t0 = Date.now();
  await p.evaluate((id) => document.querySelector('.stkiw-row[data-key="x:' + id + '"] .stkiw-name').click(), id);
  await p.evaluate(() => { try { window.STRYKER_VELA.indicatorPicker.close(); } catch (e) {} });
  const c = await p.evaluate(async (cap) => {
    const chart = window.STRYKER_VELA.context().cells[0].chart;
    const t0 = performance.now();
    while (performance.now() - t0 < cap + 25000) {
      const hs = window.STRYKER_PINE.pineHandles(chart); const h = hs[hs.length - 1];
      const ind = h && (chart.inspect().indicators || []).find((x) => x.id === h.id);
      const n = ind ? (Object.keys(ind.series || {}).length + (ind.boxes || 0) + (ind.labels || 0) + (ind.lines || 0) + (ind.tables || 0)) : 0;
      if (n > 0) {
        const ms = Math.round(performance.now() - t0);
        await new Promise((r) => setTimeout(r, 1500));
        const s2 = (chart.inspect().indicators || []).find((x) => x.id === h.id) || ind;
        return { ms, title: h.title, series: Object.keys(s2.series || {}).length, lines: s2.lines, boxes: s2.boxes, labels: s2.labels, tables: s2.tables };
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return { timeout: true, toasts: [...document.querySelectorAll('[class*="toast"]')].map((x) => x.textContent).join(' / ').slice(0, 300) };
  }, CAP);
  return { listed: true, row, ms: Date.now() - t0, c };
}

(async () => {
  const b = await launch();
  try {
    const { ctx, p, errs } = await page(b, 1440, 900);
    for (const id of IDS) {
      const [name, author] = ALL[id];
      const orig = fs.readFileSync(path.join(ORIG_DIR, id + '.pine'), 'utf8');
      const served = await p.evaluate(async (id) => { const m = await import('/assets/chart-pine-builtins.js?v=' + document.querySelector('meta[name=stryker-build]').content); return m.builtinSource(id); }, id);
      check(served === orig, `${name}: served source byte-identical to the Owner file (${served.length} / ${orig.length} chars, CRLF kept)`);
    }
    for (const [sym, tf] of SYMS) {
      const n = await setMarket(p, sym, tf, +process.env.DEEP || 0);
      for (const id of IDS) {
        const [name, author] = ALL[id];
        await clearPine(p);
        const r = await addViaWindow(p, id, name);
        check(r.listed, `${name}: listed in COMMUNITY > Community indicators`);
        if (!r.listed) continue;
        check(r.row.name === name && r.row.sub === author && !/stryker/i.test(r.row.sub + r.row.auth), `${name}: row "${r.row.name}" by "${r.row.sub}" tag "${r.row.tag}"`);
        const c = r.c;
        console.log('PERF', name, sym, tf, 'bars', n, 'first drawing', c.ms, 'ms', JSON.stringify(c));
        check(!c.timeout && c.ms <= CAP, `${name} ${sym} ${tf} (${n} bars): draws in ${c.ms} ms (cap ${CAP})`);
        await p.waitForTimeout(1000);
        await p.screenshot({ path: `${OUT}/${id}-${sym.split(':')[1].replace('!', '')}-${tf}-1440.png` });
      }
    }
    await clearPine(p);
    check(errs.length === 0, 'desktop console errors: ' + (errs.slice(0, 4).join(' | ') || 'none'));
    await ctx.close();
    if (!process.env.NO_PHONE) {
      const ph = await page(b, 390, 844);
      await setMarket(ph.p, 'futures:NQ1!', '5', 0);
      for (const id of IDS) {
        await clearPine(ph.p);
        const r = await addViaWindow(ph.p, id, ALL[id][0]);
        check(r.listed && !r.c.timeout, `phone 390: ${ALL[id][0]} added (${JSON.stringify(r.c || {})})`);
        await ph.p.waitForTimeout(1000);
        await ph.p.screenshot({ path: `${OUT}/phone-390-${id}.png` });
      }
      check(ph.errs.length === 0, 'phone console errors: ' + (ph.errs.slice(0, 4).join(' | ') || 'none'));
      await ph.ctx.close();
    }
  } finally { await b.close(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED', '| screenshots in', OUT);
  process.exit(fails ? 1 : 0);
})();
