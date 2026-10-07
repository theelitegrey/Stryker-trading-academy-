// Browser test: Stryker Pine built-ins (assets/chart-pine-builtins.js) on the Charts page.
//   CHART_BASE=http://127.0.0.1:8061 node tools/tests/chart-pine-imports-browser.js
// Run under `flock /tmp/stryker-chrome.lock`. Optional DEEP=5000 loads that many bars first
// and prints run times (perf check). OUT=<dir> for screenshots.
// Checks: each built-in is in the Indicators window under "Stryker"; adding it on NQ1! 5m and
// BTCUSDT 15m draws (boxes/lines/labels/tables > 0); the settings dialog opens and a changed
// input re-renders; no console errors; no buy/sell wording in the DOM or the drawn text;
// phone 390 opens the window and adds it.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061';
const OUT = process.env.OUT || require('path').join(require('os').tmpdir(), 'pine-imports');
fs.mkdirSync(OUT, { recursive: true });
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const NAMES = ['Stoic Edge Compass', 'WCSMC + SP v3.0 [WinWorld]', 'SMT Divergence Pro [Stryker]'].filter((n) => !ONLY.length || ONLY.some((o) => n.startsWith(o)));
// The Owner's own scripts: listed under Editors' picks (or the Stryker group before the picker
// sections landed), author Stryker.
const PICKS = new Set(['SMT Divergence Pro [Stryker]', 'IFVG Pro+ [Stryker]', 'HTF PO3 Lens [Stryker]']);
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const BAD = /\b(buy|buys|sell|sells|long|short)\b|look for/i;
const IGNORE = /ERR_FAILED|WebGL|GroupMarker|GPU stall|favicon|firebase|Failed to load resource/i;

async function page(b, w, h){
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
  await ctx.addInitScript(stub);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance|data-api\.binance|fapi\.binance|stream\.binance|data-stream\.binance)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (/pine|worker|Stryker/i.test(m.text())) console.log('CONSOLE', m.type(), m.text().slice(0, 200)); if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text().slice(0, 300)); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await ctx.addInitScript(() => { window.__lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch (e) {} });
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
// Open the Indicators window, find the row in the Stryker group, click it; wait for the script.
async function addViaWindow(p, name){
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await p.waitForSelector('.stkiw-row', { timeout: 20000 });
  const inGroup = await p.evaluate((name) => {
    const rows = [...document.querySelectorAll('.stkiw-row')];
    const row = rows.find((r) => (r.querySelector('.stkiw-nm') || {}).textContent === name);
    if (!row) return { found: false };
    // group heading = nearest preceding heading element in the list
    let el = row, head = null;
    while ((el = el.previousElementSibling)) { if (!el.classList.contains('stkiw-row')) { head = el.textContent.trim(); break; } }
    return { found: true, head, gex: rows.some((r) => /GEX Levels/.test(r.textContent)) };
  }, name);
  check(inGroup.found && (PICKS.has(name) ? /^(Editors|Stryker)/ : /^(Stryker|Community)/).test(inGroup.head || ''), name + ': listed under "' + inGroup.head + '" in the Indicators window');
  const before = await p.evaluate(() => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).length);
  const t0 = Date.now();
  await p.evaluate((name) => [...document.querySelectorAll('.stkiw-row')].find((r) => (r.querySelector('.stkiw-nm') || {}).textContent === name).querySelector('.stkiw-name').click(), name);
  await p.waitForFunction((n) => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).length > n, before, { timeout: 30000 }).catch(() => {});
  const ms = Date.now() - t0;
  await p.evaluate(() => { try { window.STRYKER_VELA.indicatorPicker.close(); } catch (e) {} });
  return ms;
}
// Drawn objects of the newest Pine indicator (chart.inspect() + its model's text).
async function counts(p){
  return p.evaluate(async () => {
    const chart = window.STRYKER_VELA.context().cells[0].chart;
    const hs = window.STRYKER_PINE.pineHandles(chart); const h = hs[hs.length - 1];
    for (let i = 0; i < 160; i++) {
      const ind = (chart.inspect().indicators || []).find((x) => x.id === h.id);
      if (ind && (Object.keys(ind.series || {}).length || ind.boxes || ind.labels)) {
        await new Promise((r) => setTimeout(r, 1500));
        const s2 = (chart.inspect().indicators || []).find((x) => x.id === h.id);
        let txt = '';
        try {
          const rec = [...chart.orchestrator.registry.all()].find((r) => r.model && r.model.id === h.id);
          const m = rec.model;
          txt = [].concat((m.labels || []).map((l) => l.text || ''), (m.boxes || []).map((b) => b.text || ''),
            ...(m.tables || []).map((t) => JSON.stringify(t).match(/"text":"[^"]*"/g) || [])).join(' | ');
        } catch (e) { txt = '(text n/a ' + e.message + ')'; }
        return { series: Object.values(s2.series).reduce((a, b) => a + b, 0), lines: s2.lines, boxes: s2.boxes, labels: s2.labels, tables: s2.tables, text: txt };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return { timeout: true, handles: hs.map((x) => x.title), toasts: [...document.querySelectorAll('[class*="toast"]')].map((x) => x.textContent).join(' / ').slice(0, 300), inds: JSON.stringify(chart.inspect().indicators.map((x) => [x.id, x.title, x.labels])) };
  });
}

(async () => {
  const b = await launch();
  try {
    // ---- desktop ----
    const { ctx, p, errs } = await page(b, 1440, 900);
    for (const [sym, tf] of (process.env.DEEP ? [['futures:NQ1!', '5'], ['binance:BTCUSDT', '1']] : [['futures:NQ1!', '5'], ['binance:BTCUSDT', '15']])) {
      // fresh chart per market: a stopped run cannot be aborted inside the worker (it finishes
      // in the background), so switching with WCSMC attached would queue those runs first.
      await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; window.STRYKER_PINE.pineHandles(c).forEach((h) => h.remove()); });
      const n = await setMarket(p, sym, tf, +process.env.DEEP || 0);
      console.log('INFO', sym, tf, n, 'bars');
      for (const name of NAMES) {
        await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; window.STRYKER_PINE.pineHandles(c).forEach((h) => h.remove()); });
        const ms = await addViaWindow(p, name);
        await p.evaluate(() => { window.__lt = []; });
        const t1 = Date.now();
        const c = await counts(p);
        const lt = await p.evaluate(() => window.__lt.slice().sort((a, b) => b - a).slice(0, 3));
        console.log('PERF', name, sym, tf, 'bars', n, 'first drawing after', ms + Date.now() - t1 - 1500, 'ms; longest main-thread tasks', JSON.stringify(lt));
        console.log('INFO', name, sym, tf, 'added in', ms, 'ms', JSON.stringify({ ...c, text: (c.text || '').slice(0, 300) }));
        check((c.boxes + c.lines + c.labels) > 0, `${name} ${sym} ${tf}: draws (series ${c.series}, boxes ${c.boxes}, lines ${c.lines}, labels ${c.labels})`);
        check(c.tables > 0, `${name} ${sym} ${tf}: panel/table renders (${c.tables})`);
        check(!BAD.test(c.text || ''), `${name} ${sym} ${tf}: no buy/sell/long/short wording in drawn text`);
        await p.waitForTimeout(800);
        await p.screenshot({ path: `${OUT}/${name.split(' ')[0].toLowerCase()}-${sym.split(':')[1].replace('!', '')}-${tf}-1440.png` });
      }
    }
    // ---- settings dialog: change an input, model re-renders ----
    for (const name of NAMES) {
      await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; window.STRYKER_PINE.pineHandles(c).forEach((h) => h.remove()); });
      await addViaWindow(p, name);
      await counts(p);
      const r = await p.evaluate(async () => {
        const chart = window.STRYKER_VELA.context().cells[0].chart;
        const hs = window.STRYKER_PINE.pineHandles(chart); const h = hs[hs.length - 1];
        const inputs = h.inputValues ? h.inputValues() : {};
        const keys = Object.keys(inputs);
        // open the legend settings (gear) for this indicator if present
        let opened = false;
        // the legend row's "Indicator settings" menu entry calls this
        let gearInfo = '';
        try { chart.renderer.openIndicatorSettings(h.id); await new Promise((r) => setTimeout(r, 900)); } catch (e) { gearInfo = e.message; }
        const dlg = [...document.querySelectorAll('[role="dialog"], [class*="dialog"], [class*="modal"]')].find((x) => x.offsetParent && /Stoic|WCSMC|SMT|IFVG|PO3/.test(x.textContent));
        opened = !!dlg;
        const dialogInputs = dlg ? dlg.querySelectorAll('input, select, button[role="switch"], [role="checkbox"]').length : 0;
        const key = ['i_showPanel', 'showSmt', 'on1'].find((k) => typeof inputs[k] === 'boolean') || keys.find((k) => typeof inputs[k] === 'boolean');
        const before = JSON.stringify(chart.inspect().indicators.find((x) => x.id === h.id));
        const v0 = inputs[key];
        h.setInputs ? h.setInputs({ [key]: !v0 }) : h.update({ [key]: !v0 });
        await new Promise((r) => setTimeout(r, 4000));
        const v1 = (h.inputValues ? h.inputValues() : {})[key];
        let after = before;
        for (let i = 0; i < 40 && after === before; i++) { await new Promise((r) => setTimeout(r, 500)); after = JSON.stringify(chart.inspect().indicators.find((x) => x.id === h.id)); }
        const rerendered = after !== before;
        return { n: keys.length, key, v0, v1, rerendered, before, after, opened, gearInfo, dialogInputs, dialogText: dlg ? dlg.textContent.slice(0, 160) : '' };
      });
      console.log('INFO settings', name, JSON.stringify(r));
      check(r.n >= 10, `${name}: ${r.n} inputs exposed to the settings dialog`);
      check(r.opened, `${name}: settings dialog opens from the legend`);
      check(r.v1 === !r.v0 && r.rerendered, `${name}: changing "${r.key}" (${r.v0} -> ${r.v1}) re-rendered the drawing`);
      check(r.dialogInputs >= 5, `${name}: settings dialog shows the script inputs (${r.dialogInputs} controls)`);
      await p.screenshot({ path: `${OUT}/${name.split(' ')[0].toLowerCase()}-settings-1440.png` });
      await p.keyboard.press('Escape');
    }
    const dom = await p.evaluate(() => document.body.innerText);
    const hit = (dom.match(/.{0,30}\b(look for buys|look for sells|buy signal|sell signal|buy|sell)\b.{0,30}/gi) || []);
    check(!hit.length, 'no buy/sell signal wording in the page text ' + hit.join(' / '));
    check(errs.length === 0, 'desktop console errors: ' + (errs.slice(0, 4).join(' | ') || 'none'));
    await ctx.close();
    // ---- phone 390 ----
    const ph = await page(b, 390, 844);
    await setMarket(ph.p, 'futures:NQ1!', '5', 0);
    for (const name of NAMES) {
      await ph.p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; window.STRYKER_PINE.pineHandles(c).forEach((h) => h.remove()); });
      await addViaWindow(ph.p, name);
      const c = await counts(ph.p);
      check((c.series + c.boxes + c.labels) > 0, `phone 390: ${name} added (series ${c.series}, boxes ${c.boxes}, labels ${c.labels}, tables ${c.tables})`);
      await ph.p.waitForTimeout(800);
      await ph.p.screenshot({ path: `${OUT}/phone-390-${name.split(' ')[0].toLowerCase()}.png` });
    }
    await ph.p.waitForTimeout(800);
    await ph.p.screenshot({ path: `${OUT}/phone-390.png` });
    check(ph.errs.length === 0, 'phone console errors: ' + (ph.errs.slice(0, 4).join(' | ') || 'none'));
    await ph.ctx.close();
  } finally { await b.close(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED', '| screenshots in', OUT);
  process.exit(fails ? 1 : 0);
})();
