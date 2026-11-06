// Zscript editor + chart smoke test, against tools/tests/chart-dev-server.mjs (needs Yahoo for the bars).
//   CHART_BASE=http://localhost:8043 node tools/tests/chart-zscript-browser.js [shotsDir]
// Run under the Chrome lock: flock /tmp/stryker-chrome.lock node tools/tests/chart-zscript-browser.js
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://localhost:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

async function open(b, { w, h, mobile, light }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((light) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (light) localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, !!light);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket connection|ERR_FAILED|\[vela\] indicator "ind-\d+" failed|404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_PINE && window.STRYKER_ZS, null, { timeout: 60000 });
  // Futures bars come through the dev server's /api/chart/bars (crypto venues may be blocked from the test box)
  await p.evaluate(() => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol('futures:ES1!'); c.setTimeframe('15'); });
  await p.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 400));
      if (window.STRYKER_VELA.context().cells.every((c) => { try { return c.chart.orchestrator.rawBars.length > 0; } catch (e) { return false; } })) break;
    }
  });
  await p.waitForTimeout(800);
  return { ctx, p, errors };
}
const zsOn = (p) => p.evaluate(() => window.STRYKER_ZS.handles(window.STRYKER_VELA.context().cells[0].chart).map((h) => window.STRYKER_ZS.titleOf(h.source)));
const pineOn = (p) => p.evaluate(() => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).length);
const openZs = (p) => p.evaluate(async () => { window.STRYKER_ZS.open(); for (let i = 0; i < 50 && !document.querySelector('#stkc-zs .cm-editor'); i++) await new Promise((r) => setTimeout(r, 100)); });
const addSrc = (p, src) => p.evaluate(async (src) => {
  const Z = window.STRYKER_ZS; Z.open(); await Z.load('t', src, null); await Z.addToChart();
  const e = document.querySelector('#stkc-zs .stkc-zs-err');
  return { err: e.hidden ? '' : e.textContent, marks: document.querySelectorAll('#stkc-zs .cm-lintRange-error').length };
}, src);
const inspect = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.context().cells[0].chart;
  const ins = c.inspect();
  return JSON.stringify(ins).length;
});

(async () => {
  const b = await launch();
  try {
    // ---------- desktop 1440 dark ----------
    let { ctx, p, errors } = await open(b, { w: 1440, h: 900 });
    // Pine panel shows the language switch
    await p.evaluate(() => window.STRYKER_PINE.open());
    await p.waitForTimeout(300);
    const seg = await p.evaluate(() => [...document.querySelectorAll('#stkc-pine .stkc-langseg-b')].map((x) => x.textContent + (x.classList.contains('on') ? '*' : '')));
    check(seg.join() === 'Pine Script*,Zscript', 'Pine panel has the language switch: ' + seg.join());
    await p.click('#stkc-pine .stkc-langseg-b:not(.on)');
    await p.waitForSelector('#stkc-zs .cm-editor', { timeout: 15000 });
    const st = await p.evaluate(() => ({ zs: !document.getElementById('stkc-zs').hidden, pine: !document.getElementById('stkc-pine').hidden, ex: [...document.querySelectorAll('#stkc-zs .stkc-pine-lib .stkc-tname')].map((x) => x.textContent) }));
    check(st.zs && !st.pine, 'switch opens Zscript, closes Pine');
    check(['EMA cross', 'RSI with zones', 'VWAP bands', 'Order book imbalance', 'GEX walls'].every((n) => st.ex.some((t) => t.startsWith(n) && /Example$/.test(t))), '5 examples labelled Example: ' + st.ex.join(' | '));
    // autocomplete
    await p.click('#stkc-zs .cm-content');
    await p.keyboard.press('Control+End');
    await p.keyboard.type('\nx = ta.sm');
    await p.waitForSelector('.cm-tooltip-autocomplete', { timeout: 4000 }).catch(() => {});
    const ac = await p.evaluate(() => [...document.querySelectorAll('.cm-tooltip-autocomplete li')].map((x) => x.textContent).slice(0, 5));
    check(ac.some((t) => /ta\.sma/.test(t)), 'autocomplete offers ta.sma: ' + ac.join(', '));
    await p.screenshot({ path: `${OUT}/S2-1440-autocomplete.png` });
    await p.keyboard.press('Escape');
    // run the EMA cross example
    let r = await addSrc(p, await p.evaluate(() => window.STRYKER_ZS.examples[0].source));
    check(!r.err, 'EMA cross added ' + r.err);
    r = await addSrc(p, await p.evaluate(() => window.STRYKER_ZS.examples[1].source));
    check(!r.err, 'RSI with zones added ' + r.err);
    await p.waitForTimeout(1200);
    let on = await zsOn(p);
    check(on.length === 2 && on.includes('EMA cross') && on.includes('RSI with zones'), 'two Zscript indicators on chart: ' + on.join(', '));
    check(await pineOn(p) === 0, 'Pine list does not show Zscript handles');
    const model = await p.evaluate(() => {
      const c = window.STRYKER_VELA.context().cells[0].chart;
      const ins = c.inspect();
      const t = ins.indicators.map((x) => x.title + ':' + Object.values(x.series || {}).reduce((a, b) => a + b, 0) + ':' + (x.priceLines || 0));
      return { t, ema: t.some((x) => /^EMA cross:2:/.test(x)), rsi: t.some((x) => /^RSI with zones:\d+:[23]/.test(x)) };
    });
    check(model.ema && model.rsi, 'plots reached the chart model ' + JSON.stringify(model));
    await p.evaluate(() => window.STRYKER_ZS.close());
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/S2-1440-chart.png` });
    // error with line:col + inline mark
    r = await addSrc(p, '//@zscript 1\nindicator("Bad", overlay=true)\nplot(ta.sma(close, 20)\n');
    check(/^Line \d+:\d+ /.test(r.err) && r.marks >= 1, 'syntax error shows Line:col + inline mark: ' + r.err + ' marks=' + r.marks);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/S2-1440-dark-error.png` });
    r = await addSrc(p, 'indicator("No header")\n');
    check(/zscript 1/.test(r.err), 'missing header explained: ' + r.err);
    r = await addSrc(p, '//@zscript 1\nindicator("Typo", overlay=true)\nplot(ta.smaa(close, 20))\n');
    check(/^Line 3:\d+ .*Did you mean `ta\.sma`/.test(r.err), 'unknown name gets a did-you-mean hint: ' + r.err);
    for (const k of [2, 3]) { r = await addSrc(p, await p.evaluate((k) => window.STRYKER_ZS.examples[k].source, k)); check(!r.err, 'example ' + k + ' runs: ' + r.err); }
    await p.waitForTimeout(800);
    await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; window.STRYKER_ZS.handles(c).filter((x) => /VWAP bands|Order book imbalance/.test(x.source)).forEach((h) => h.remove()); });
    // engine runs in the sandboxed worker, and data calls without data give na + a notice (never invented values)
    r = await addSrc(p, await p.evaluate(() => window.STRYKER_ZS.examples[4].source));
    check(!r.err, 'GEX walls example runs: ' + r.err);
    await p.waitForTimeout(800);
    await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; const h = window.STRYKER_ZS.handles(c).find((x) => /GEX walls/.test(x.source)); if (h) h.remove(); });
    on = await zsOn(p);
    check(on.length === 2, 'failed scripts left no indicator: ' + on.length);
    // inputs exposed for the settings dialog
    const inputs = await p.evaluate(() => { const h = window.STRYKER_ZS.handles(window.STRYKER_VELA.context().cells[0].chart).find((x) => /EMA/.test(x.source)); return h ? h.inputs.map((i) => i.title + ':' + i.type) : []; });
    check(inputs.join() === 'Fast EMA:int,Slow EMA:int', 'inputs for the settings dialog: ' + inputs.join());
    // input change re-runs
    const changed = await p.evaluate(async () => {
      const h = window.STRYKER_ZS.handles(window.STRYKER_VELA.context().cells[0].chart).find((x) => /EMA/.test(x.source));
      h.setInputs ? h.setInputs({ 0: 5 }) : h.setInput('0', 5);
      await new Promise((r) => setTimeout(r, 800));
      return h.inputValues()['0'];
    }).catch((e) => 'err ' + e.message);
    check(changed === 5, 'input change applied: ' + changed);
    // save -> My scripts
    await p.evaluate(async () => { const Z = window.STRYKER_ZS; Z.open(); await Z.load('My EMA', Z.examples[0].source, null); document.querySelector('#stkc-zs .stkc-pine-acts button:nth-of-type(3)').click(); });
    await p.waitForTimeout(800);
    const saved = await p.evaluate(async () => (await window.STRYKER_ZS.store.list()).items.map((x) => x.name));
    check(saved.includes('My EMA'), 'Save puts it in My scripts: ' + saved.join());
    // persistence in workspace state
    const stj = await p.evaluate(() => JSON.stringify(window.STRYKER_VELA.getState()));
    check(/stryker\.zscript/.test(stj) && /EMA cross/.test(stj), 'Zscript indicators in workspace state');
    // indicator window: Zscript section
    await p.evaluate(() => window.STRYKER_ZS.close());
    await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.indicatorPicker.open(); });
    await p.waitForTimeout(800);
    const tab = await p.$('.stkiw-tab[data-k="zscript"]');
    check(!!tab, 'indicator window has a Zscript tab');
    if (tab) { await tab.click(); await p.waitForTimeout(300); }
    const rows = await p.evaluate(() => [...document.querySelectorAll('.stkiw-row .stkiw-nm')].map((x) => x.textContent));
    check(rows[0] === 'New Zscript' && rows.includes('GEX walls'), 'Zscript tab rows: ' + rows.join(', '));
    await p.screenshot({ path: `${OUT}/S2-1440-picker.png` });
    await p.click('.stkiw-row[data-key="zn:new"] .stkiw-name');
    await p.waitForTimeout(700);
    check(await p.evaluate(() => !document.getElementById('stkc-zs').hidden && /My script/.test(document.querySelector('#stkc-zs .cm-content').textContent)), 'New Zscript opens the editor with a starter script');
    // Example in Zscript editor, dark: final editor shot
    await p.evaluate(async () => { const Z = window.STRYKER_ZS; await Z.load('VWAP bands', Z.examples[2].source, null); });
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/S2-1440-dark.png` });
    // reload keeps them
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_ZS && window.STRYKER_VELA, null, { timeout: 60000 });
    await p.waitForTimeout(6000);
    on = await zsOn(p);
    check(on.length === 2, 'reload restores Zscript indicators: ' + on.join(', '));
    check(errors.length === 0, 'no page errors: ' + errors.slice(0, 3).join(' || '));
    await ctx.close();

    // ---------- 1440 light ----------
    ({ ctx, p, errors } = await open(b, { w: 1440, h: 900, light: true }));
    await openZs(p);
    await p.waitForTimeout(400);
    check(await p.evaluate(() => document.documentElement.dataset.theme === 'light'), 'light theme on');
    await p.screenshot({ path: `${OUT}/S2-1440-light.png` });
    await ctx.close();

    // ---------- phones ----------
    for (const w of [390, 412]) {
      ({ ctx, p, errors } = await open(b, { w, h: 844, mobile: true }));
      await openZs(p);
      await p.waitForTimeout(500);
      const g = await p.evaluate(() => {
        const pn = document.getElementById('stkc-zs').getBoundingClientRect();
        const btns = [...document.querySelectorAll('#stkc-zs .stkc-pine-acts button')].map((b) => b.getBoundingClientRect());
        const ed = document.querySelector('#stkc-zs .stkc-pine-ed').getBoundingClientRect();
        return { l: pn.left, r: pn.right, vw: innerWidth, vh: innerHeight, bb: Math.max(...btns.map((b) => b.bottom)), bh: Math.min(...btns.map((b) => b.height)), edh: ed.height, run: document.querySelector('#stkc-zs .stkc-zs-run').textContent, docW: document.documentElement.scrollWidth };
      });
      check(g.l <= 0 && g.r >= g.vw - 1 && g.docW <= g.vw, w + ': full-width sheet, no sideways scroll ' + JSON.stringify(g));
      check(g.bb <= g.vh && g.bh >= 40 && g.edh >= 160, w + ': buttons visible >= 40 high, editor >= 160');
      check(g.run === 'Run', w + ': phone primary button says Run');
      await p.screenshot({ path: `${OUT}/S2-${w}-dark.png` });
      if (w === 390) {
        const rr = await p.evaluate(async () => { await window.STRYKER_ZS.addToChart(); return { open: !document.getElementById('stkc-zs').hidden, n: window.STRYKER_ZS.handles(window.STRYKER_VELA.context().cells[0].chart).length }; });
        await p.waitForTimeout(1200);
        check(!rr.open && rr.n === 1, '390: Run adds and closes the sheet ' + JSON.stringify(rr));
        await p.screenshot({ path: `${OUT}/S2-390-chart.png` });
      }
      check(errors.length === 0, w + ': no page errors: ' + errors.slice(0, 3).join(' || '));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
