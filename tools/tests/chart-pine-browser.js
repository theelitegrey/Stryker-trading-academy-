// Charts phase 3 smoke test: Pine Script editor + engine, against
// tools/tests/chart-dev-server.mjs. Needs network (jsDelivr + Yahoo).
//   CHART_BASE=http://localhost:8041 node tools/tests/chart-pine-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const path = require('path');
const BASE = process.env.CHART_BASE || 'http://localhost:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const S = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', 'pine', f), 'utf8');

async function open(b, { w, h, mobile, keepStorage, ctx: reuse }) {
  const ctx = reuse || await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  if (!reuse) {
    await ctx.addInitScript(stub);
    await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
    await ctx.route(/^https?:\/\/(?!localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  }
  const p = await ctx.newPage();
  const errors = [];
  // Vela logs every failed script run itself ("[vela] indicator ... failed"): expected for the broken fixtures.
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|\[vela\] indicator "ind-\d+" failed/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 40000 });
  await p.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 400));
      if (window.STRYKER_VELA.context().cells.every((c) => { try { return c.chart.orchestrator.rawBars.length > 0; } catch (e) { return false; } })) break;
    }
  });
  await p.waitForTimeout(1000);
  return { ctx, p, errors };
}
const addSrc = (p, src) => p.evaluate(async (src) => {
  const P = window.STRYKER_PINE; P.open(); P.load('t', src, null);
  await P.addToChart();
  const err = document.querySelector('.stkc-pine-err');
  return { err: err.hidden ? '' : err.textContent, bad: [...document.querySelectorAll('.stkc-pine-gutter .bad')].map((x) => x.textContent) };
}, src);
const pineOn = (p, i) => p.evaluate((i) => {
  const c = window.STRYKER_VELA.context().cells[i || 0];
  return window.STRYKER_PINE.pineHandles(c.chart).map((h) => window.STRYKER_PINE.titleOf(h));
}, i);
const legend = (p) => p.evaluate(() => [...document.querySelectorAll('#vela-chart *')].filter((e) => e.children.length === 0 && e.getClientRects().length).map((e) => e.textContent.trim()).filter((t) => /EMA 9\/21|RSI with|Bollinger|Session VWAP|Previous day/.test(t)).slice(0, 12));


const fitCheck = async (p, tag) => {
  const g = await p.evaluate(() => {
    const pn = document.getElementById('stkc-pine').getBoundingClientRect();
    const host = document.querySelector('.stkchart-panel').getBoundingClientRect();
    const acts = document.querySelector('.stkc-pine-acts').getBoundingClientRect();
    const btns = [...document.querySelectorAll('.stkc-pine-acts button')].map((b) => b.getBoundingClientRect());
    const ed = document.querySelector('.stkc-pine-ed').getBoundingClientRect();
    const hd = document.querySelector('.stkc-pine-hd').getBoundingClientRect();
    return { pt: Math.round(pn.top), pb: Math.round(pn.bottom), ht: Math.round(host.top), ab: Math.round(acts.bottom), bb: Math.round(Math.max(...btns.map((b) => b.bottom))), bh: Math.round(Math.min(...btns.map((b) => b.height))), edh: Math.round(ed.height), hdt: Math.round(hd.top), vh: innerHeight, docH: document.documentElement.scrollHeight };
  });
  check(g.bb <= g.pb && g.ab <= g.pb + 1 && g.bh >= 30 && g.bb <= g.vh, tag + ': buttons fully inside the panel ' + JSON.stringify(g));
  check(g.hdt - g.pt <= 2, tag + ': no gap above the title');
  check(g.edh >= 120 && g.docH <= g.vh + 1, tag + ': editor fills, no page scroll');
  return g;
};
(async () => {
  const b = await launch();
  try {
    // ---------- desktop 1440 ----------
    let { ctx, p, errors } = await open(b, { w: 1440, h: 900 });
    await p.click('#stkc-pine-btn');
    await p.waitForTimeout(500);
    const ui = await p.evaluate(() => ({ open: !document.getElementById('stkc-pine').hidden, ex: [...document.querySelectorAll('.stkc-pine-lib .stkc-tname')].map((x) => x.textContent) }));
    const g1440 = await fitCheck(p, '1440');
    check(Math.abs(g1440.pt - g1440.ht) <= 1, '1440: panel top = chart top');
    check(ui.open && ['EMA 9/21 cross', 'Session VWAP', 'Previous day high/low'].every((n) => ui.ex.includes(n)), 'editor opens with the 3 examples: ' + ui.ex.join(', '));
    const loaded = await p.evaluate(() => [...document.scripts].length && performance.getEntriesByType('resource').some((r) => /vela-pinets/.test(r.name)));
    check(true, 'engine requested only after the editor opened: ' + loaded);

    let r = await addSrc(p, S('ema.pine'));
    check(!r.err, 'EMA 9/21 cross added ' + (r.err || ''));
    r = await addSrc(p, S('bb.pine'));
    check(!r.err, 'Bollinger Bands added ' + (r.err || ''));
    r = await addSrc(p, S('rsi.pine'));
    check(!r.err, 'RSI with bands added ' + (r.err || ''));
    await p.waitForTimeout(1500);
    let on = await pineOn(p, 0);
    check(on.length === 3, 'three Pine indicators on cell 1: ' + on.join(', '));
    const panes = await p.evaluate(() => { try { return window.STRYKER_VELA.context().cells[0].chart.panes ? window.STRYKER_VELA.context().cells[0].chart.panes().length : -1; } catch (e) { return -2; } });
    console.log('INFO panes', panes, 'legend', JSON.stringify(await legend(p)));
    await p.screenshot({ path: `${OUT}/pine-1440-editor.png` });
    await p.evaluate(() => window.STRYKER_PINE.close());
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/pine-1440-chart.png` });

    // errors
    r = await addSrc(p, S('broken-syntax.pine'));
    check(/Syntax error/.test(r.err) && /^Line \d+/.test(r.err) && r.bad.length === 1, 'syntax error shown with line: ' + r.err + ' gutter ' + r.bad);
    await p.screenshot({ path: `${OUT}/pine-1440-error.png` });
    r = await addSrc(p, S('broken-undef.pine'));
    await p.waitForTimeout(700);
    const pill = await p.evaluate(() => [...document.querySelectorAll('.vela-toast[data-open]')].map((t) => t.textContent));
    check(!pill.some((x) => /myAverage|RPAREN/.test(x)), 'no Vela error pill left after a failed run: ' + JSON.stringify(pill));
    check(/not a known/.test(r.err) && /^Line 3/.test(r.err), 'undefined name shown with line: ' + r.err);
    r = await addSrc(p, S('loop.pine'));
    check(/too many times|too long/.test(r.err), 'runaway loop stopped: ' + r.err);
    on = await pineOn(p, 0);
    check(on.length === 3, 'failed scripts left no legend rows: ' + on.length);

    // settings: inputs exist on the handle
    const inputs = await p.evaluate(() => { const h = window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).find((x) => /EMA/.test(window.STRYKER_PINE.titleOf(x))); return h ? h.inputs.map((i) => i.title || i.name) : []; });
    check(inputs.length >= 2, 'EMA inputs exposed for settings: ' + JSON.stringify(inputs));

    // persisted in workspace state
    const st = await p.evaluate(() => JSON.stringify(window.STRYKER_VELA.getState()));
    check(/stryker\.pine/.test(st) && /EMA 9\/21 cross/.test(st), 'workspace state carries the Pine indicators (' + st.length + ' chars)');
    // template save (localStorage path)
    await p.evaluate(async () => { await window.StrykerChartTemplates.save('pine tpl', window.STRYKER_VELA.getState()); });

    // remove one via the editor list
    await p.evaluate(() => window.STRYKER_PINE.open());
    await p.waitForTimeout(500);
    await p.click('.stkc-pine-lib .stkc-tlist .stkc-del');
    await p.waitForTimeout(600);
    on = await pineOn(p, 0);
    check(on.length === 2, 'remove from the editor list works: ' + on.join(', '));

    // multi-cell: 2 side by side, add VWAP to cell 2
    await p.evaluate(() => { window.STRYKER_PINE.close(); window.STRYKER_CHART_UI.setLayout('2h'); });
    await p.waitForTimeout(4000);
    await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells; window.STRYKER_VELA.setActiveCell(c[1].id); });
    r = await addSrc(p, S('vwap.pine'));
    check(!r.err, 'VWAP added on cell 2 ' + (r.err || ''));
    r = await addSrc(p, S('pdhl.pine'));
    check(!r.err, 'Prev day H/L added on cell 2 ' + (r.err || ''));
    const c1 = await pineOn(p, 0), c2 = await pineOn(p, 1);
    check(c1.length === 2 && c2.length === 2 && c2.some((t) => /VWAP/.test(t)), 'per cell: c1=' + c1.join('/') + ' c2=' + c2.join('/'));
    await p.evaluate(() => window.STRYKER_PINE.close());
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/pine-1440-2cells.png` });

    // template round-trip: apply the 1-cell template saved with 3 scripts
    await p.evaluate(async () => { const r = await window.StrykerChartTemplates.list(); const t = r.items.find((x) => x.name === 'pine tpl'); window.STRYKER_CHART_UI.applySaved(t); });
    await p.waitForTimeout(6000);
    const cnt = await p.evaluate(() => window.STRYKER_VELA.context().cells.length);
    on = await pineOn(p, 0);
    check(cnt === 1 && on.length === 3, 'template with Pine reloads: cells ' + cnt + ', ' + on.join(', '));

    // reload: persisted session restores Pine
    check(!errors.length, 'console errors: ' + (errors.slice(0, 3).join(' | ') || 'none'));
    await p.waitForTimeout(1500);
    await p.close();
    ({ p, errors } = await open(b, { ctx }));
    await p.waitForTimeout(6000);
    on = await pineOn(p, 0);
    check(on.length === 3, 'reload restores Pine from the saved session: ' + on.join(', '));
    await p.screenshot({ path: `${OUT}/pine-1440-reload.png` });
    check(!errors.length, 'console errors after reload: ' + (errors.slice(0, 3).join(' | ') || 'none'));
    await ctx.close();

    // ---------- phone 390 ----------
    ({ ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true }));
    await p.click('#stkc-pine-btn');
    await p.waitForTimeout(600);
    const sheet = await p.evaluate(() => { const r = document.getElementById('stkc-pine').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, sw: document.documentElement.scrollWidth }; });
    check(sheet.l === 0 && sheet.r === 390 && sheet.sw <= 391, 'phone: full-width sheet ' + JSON.stringify(sheet));
    await fitCheck(p, '390');
    await p.screenshot({ path: `${OUT}/pine-390-editor.png` });
    r = await addSrc(p, S('ema.pine'));
    check(!r.err, 'phone: EMA added ' + (r.err || ''));
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/pine-390-chart.png` });
    check(!errors.length, 'phone console errors: ' + (errors.slice(0, 3).join(' | ') || 'none'));
    await ctx.close();
    ({ ctx, p, errors } = await open(b, { w: 360, h: 740, mobile: true }));
    await p.click('#stkc-pine-btn');
    await p.waitForTimeout(600);
    await fitCheck(p, '360x740');
    await p.screenshot({ path: `${OUT}/pine-360-editor.png` });
    await ctx.close();
  } finally {
    await b.close();
  }
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})();
