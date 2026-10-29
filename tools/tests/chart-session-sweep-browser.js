// Session Sweep SMT + IFVG [TradeZoro]: smoke on the real Charts page (NQ1! 5m).
//   node tools/tests/chart-dev-server.mjs 8083 &
//   CHART_BASE=http://127.0.0.1:8083 OUT=/tmp/sweep W=1440 [VELA=0.6] [DUMP=1] flock /tmp/stryker-chrome.lock node tools/tests/chart-session-sweep-browser.js
// Adds it from the picker (Editors' picks), reads the drawn model, optionally dumps the bars + model to OUT/dump.json.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const path = require('path');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8083';
const OUT = process.env.OUT || '/tmp/sweep';
const W = +process.env.W || 1440, H = W < 500 ? 844 : 860;
const NAME = 'Session Sweep SMT + IFVG [TradeZoro]';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fail++; };
const IGNORE = /ERR_FAILED|WebGL|GroupMarker|GPU stall|favicon|firebase|Failed to load resource|WebSocket connection/i;
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  try {
    const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: W < 500, hasTouch: W < 500 });
    await ctx.addInitScript(stub);
    await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage();
    const errs = [];
    p.on('console', (m) => { if (/sweep|pine/i.test(m.text())) console.log('CONSOLE', m.type(), m.text().slice(0, 300)); if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text().slice(0, 300)); });
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await p.goto(BASE + '/charts.html' + (process.env.VELA ? '?vela=' + process.env.VELA : ''), { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 60000 });
    const bars = await p.evaluate(async (deep) => {
      const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id); c.setSymbol('futures:NQ1!'); c.setTimeframe('5');
      const chart = window.STRYKER_VELA.context().cells[0].chart;
      for (let i = 0; i < 90; i++) { await new Promise((r) => setTimeout(r, 500)); try { if (chart.market.symbol === 'futures:NQ1!' && chart.orchestrator.rawBars.length > 50 && chart.orchestrator.historyState !== 'backfill') break; } catch (e) {} }
      await chart.setMarket({ bars: deep }); await chart.historyComplete();
      return chart.orchestrator.rawBars.length;
    }, +process.env.DEEP || 3000);
    console.log('INFO bars', bars);
    // picker: open -> picks -> add
    await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
    await p.waitForSelector('.stkiw-row', { timeout: 20000 });
    await p.evaluate(() => document.querySelector('.stkiw-tab[data-k="picks"]').click());
    await p.waitForTimeout(300);
    const row = await p.evaluate((n) => { const r = [...document.querySelectorAll('.stkiw-row')].find((r) => (r.querySelector('.stkiw-nm') || {}).textContent === n); return r ? { key: r.dataset.key, sub: (r.querySelector('.stkiw-sub') || {}).textContent } : null; }, NAME);
    check(!!row && row.key === 'x:session-sweep-smt-ifvg' && row.sub === 'TradeZoro', 'listed in Editors picks ' + JSON.stringify(row));
    const t0 = Date.now();
    await p.evaluate((n) => [...document.querySelectorAll('.stkiw-row')].find((r) => (r.querySelector('.stkiw-nm') || {}).textContent === n).querySelector('.stkiw-name').click(), NAME);
    await p.evaluate(() => { try { window.STRYKER_VELA.indicatorPicker.close(); } catch (e) {} });
    const m = await p.evaluate(async (DUMP) => {
      const chart = window.STRYKER_VELA.context().cells[0].chart;
      for (let i = 0; i < 160; i++) {
        const hs = window.STRYKER_PINE.pineHandles(chart); const h = hs[hs.length - 1];
        const rec = h && [...chart.orchestrator.registry.all()].find((r) => r.model && r.model.id === h.id);
        if (rec && rec.model && ((rec.model.lines || []).length + (rec.model.labels || []).length) > 0) {
          await new Promise((r) => setTimeout(r, 1500));
          const mm = rec.model;
          return { title: h.title, lines: (mm.lines || []).length, boxes: (mm.boxes || []).length, labels: (mm.labels || []).length,
            labelText: (mm.labels || []).map((l) => l.text || '').filter(Boolean), model: DUMP ? JSON.parse(JSON.stringify(mm)) : null };
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      return { timeout: true };
    }, !!process.env.DUMP);
    const ms = Date.now() - t0;
    console.log('INFO draw ms', ms, 'lines', m.lines, 'boxes', m.boxes, 'labels', m.labels);
    const cnt = {}; (m.labelText || []).forEach((t) => { cnt[t] = (cnt[t] || 0) + 1; });
    console.log('INFO labels', JSON.stringify(cnt));
    check(!m.timeout, 'model arrived');
    check(m.lines > 0 && m.labels > 0, 'draws lines and labels');
    check(m.lines <= 500 && m.boxes <= 200 && m.labels <= 500, 'within limits');
    check(!(m.labelText || []).some((t) => /buy|sell|signal|entry|stop|target|\bTP\b|\bSL\b/i.test(t)), 'no trading wording in labels');
    if (process.env.DUMP) {
      const raw = await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.map((b) => [b.time, b.open, b.high, b.low, b.close]));
      fs.writeFileSync(path.join(OUT, 'dump.json'), JSON.stringify({ bars: raw, model: m.model }));
    }
    await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(OUT, `sweep-${W}.png`) });


    // optional zoomed shots: RANGES="name:fromISO:toISO,..." (UTC), e.g. ex1:2026-10-28T08:30:00Z:2026-10-28T11:30:00Z
    for (const r of (process.env.RANGES || '').split(',').filter(Boolean)) {
      const [nm, f, t] = [r.split(':')[0], r.slice(r.indexOf(':') + 1, r.indexOf(':') + 21), r.slice(r.indexOf(':') + 22)];
      await p.evaluate(([f, t]) => window.STRYKER_VELA.context().cells[0].chart.setVisibleRange({ from: Date.parse(f), to: Date.parse(t) }), [f, t]);
      await p.waitForTimeout(1200);
      await p.screenshot({ path: path.join(OUT, `${nm}-${W}.png`) });
    }
    // settings: open the dialog, click the Table switch, OK; the table must arrive; then remove
    const info = await p.evaluate(() => { const chart = window.STRYKER_VELA.context().cells[0].chart; const h = window.STRYKER_PINE.pineHandles(chart).slice(-1)[0]; return { id: h.id, keys: Object.keys(h.inputValues()) }; });
    console.log('INFO inputs', info.keys.join(','));
    await p.evaluate((id) => window.STRYKER_VELA.context().cells[0].chart.renderer.openIndicatorSettings(id), info.id);
    await p.waitForSelector('.vela-ind-dialog', { timeout: 10000 });
    await p.waitForTimeout(300);
    const key = info.keys.find((k) => /showTbl/i.test(k));
    check(!!key, 'settings dialog lists the table input (' + key + ')');
    if (process.env.SHOT_SETTINGS) await p.screenshot({ path: path.join(OUT, `settings-${W}.png`) });
    const ts = Date.now();
    await p.click('.vela-ind-dialog [id="vela-inp-' + info.id + '-' + key + '"]');
    await p.evaluate(() => { const b = [...document.querySelectorAll('.vela-ind-dialog button')].find((x) => /^ok$/i.test(x.textContent.trim())); if (b) b.click(); });
    const tbl = await p.evaluate(async (id) => {
      const chart = window.STRYKER_VELA.context().cells[0].chart; const t0 = performance.now();
      while (performance.now() - t0 < 30000) {
        const rec = chart.orchestrator.registry.get(id);
        if (rec && rec.model && (rec.model.tables || []).length && JSON.stringify(rec.model.tables).includes('Swept')) return { ms: Math.round(performance.now() - t0), text: JSON.stringify(rec.model.tables).match(/"text":"[^"]*"/g).join(' ').slice(0, 500) };
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    }, info.id);
    check(!!tbl, 'table on after the settings click: ' + (tbl ? tbl.ms + ' ms (full re-run, ' + bars + ' bars) ' + tbl.text : 'never'));
    await p.waitForTimeout(600);
    await p.screenshot({ path: path.join(OUT, `table-${W}.png`) });
    const gone = await p.evaluate(async () => {
      const chart = window.STRYKER_VELA.context().cells[0].chart;
      window.STRYKER_PINE.pineHandles(chart).forEach((h) => h.remove());
      await new Promise((r) => setTimeout(r, 800));
      return window.STRYKER_PINE.pineHandles(chart).length;
    });
    check(gone === 0, 'indicator removed (pine handles left: ' + gone + ')');
    check(!errs.length, 'console errors: ' + (errs.slice(0, 3).join(' | ') || 'none'));
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
