// Script editor (Zscript + Pine import panels, assets/chart-script-editor.js) browser test + screenshots.
//   node tools/tests/chart-dev-server.mjs 8091 &   (needs Yahoo for futures bars)
//   CHART_BASE=http://localhost:8091 tools/chrome-slot.sh node tools/tests/chart-editor-browser.js [shotsDir]
// Covers: open, type, compile error shows line:col + gutter marker + squiggle, click jumps to the line, fix -> "Compiled OK",
// Add to chart -> "Update on chart", Ctrl+S save persists across reload, resize (width remembered), wide mode library,
// Expand / collapse, library tabs + Docs insert, More menu, Pine (import) add + error line, phone full-screen sheet.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://localhost:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined && !ok ? ' ' + JSON.stringify(extra) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(b, { w, h, mobile, light, ctx }) {
  ctx = ctx || await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((light) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (light) localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, !!light);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket connection|ERR_FAILED|\[vela\] indicator "ind-\d+" failed|404|Failed to load resource|Failed to fetch/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  if (process.env.DEBUG) p.on('console', (m) => { if (/TradeZoro/.test(m.text())) console.log('  console:', m.text().slice(0, 200)); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_PINE && window.STRYKER_ZS, null, { timeout: 60000 });
  await p.evaluate(() => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol('futures:NQ1!'); c.setTimeframe('1'); });
  await p.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 400));
      if (window.STRYKER_VELA.context().cells.every((c) => { try { return c.chart.orchestrator.rawBars.length > 0; } catch (e) { return false; } })) break;
    }
  });
  await p.waitForTimeout(800);
  return { ctx, p, errors };
}
const Z = '#stkc-zs';
const openZs = (p) => p.evaluate(async () => { window.STRYKER_ZS.open(); for (let i = 0; i < 80 && !document.querySelector('#stkc-zs .cm-editor'); i++) await new Promise((r) => setTimeout(r, 100)); });
const st = (p, sel) => p.evaluate((sel) => {
  const pn = document.querySelector(sel), q = (s) => pn.querySelector(s);
  const r = pn.getBoundingClientRect();
  return { open: !pn.hidden, w: Math.round(r.width), l: Math.round(r.left), t: Math.round(r.top), b: Math.round(r.bottom), wide: pn.classList.contains('is-wide'), max: pn.classList.contains('is-max'), view: pn.dataset.view,
    status: q('.sed-status').hidden ? '' : q('.sed-status').textContent, prob: q('.sed-prob-hd').textContent, probS: q('.sed-prob-hd').dataset.s, rows: [...pn.querySelectorAll('.sed-prob-row')].map((x) => x.textContent),
    primary: q('.sed-btn.is-primary').textContent, name: q('.sed-name').value, chip: q('.sed-chip').textContent,
    marks: pn.querySelectorAll('.cm-lint-marker-error').length, squiggles: pn.querySelectorAll('.cm-lintRange-error').length,
    libVisible: !!q('.sed-lib').getClientRects().length, codeVisible: !!q('.sed-ed').getClientRects().length };
}, sel);
const waitProb = (p, sel, re, ms) => p.waitForFunction(([sel, re]) => new RegExp(re).test(document.querySelector(sel + ' .sed-prob-hd').textContent), [sel, re.source], { timeout: ms || 8000 }).catch(() => null);
const zsOn = (p) => p.evaluate(() => window.STRYKER_ZS.handles(window.STRYKER_VELA.context().cells[0].chart).map((h) => window.STRYKER_ZS.titleOf(h.source)));
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

(async () => {
  const b = await launch();
  try {
    // ---------- 1440 dark: the Zscript panel ----------
    let { ctx, p, errors } = await open(b, { w: 1440, h: 900 });
    await p.evaluate(() => { localStorage.removeItem('stk_script_ed_w'); });
    await openZs(p);
    await waitProb(p, Z, /Compiled OK/, 10000);
    let s = await st(p, Z);
    check(s.open && s.w === 560 && !s.wide && s.view === 'code', 'opens as a 560 side panel, code view', s);
    check(/Compiled OK · \d+ plots?/.test(s.prob) && s.probS === 'ok', 'example compiles: ' + s.prob);
    check(s.status === 'Example' && s.primary === 'Add to chart', 'status Example, primary Add to chart', s);
    check(/NQ · 1m|NQ · 1/.test(s.chip), 'target chip shows symbol · timeframe: ' + s.chip);
    const seg = await p.evaluate(() => [...document.querySelectorAll('#stkc-zs .stkc-langseg-b')].map((x) => x.textContent + (x.classList.contains('on') ? '*' : '')));
    check(seg.join() === 'Zscript*,Pine (import)', 'segmented control Zscript first: ' + seg.join());
    // soft wrap: no horizontal scroll in the code box
    const wrap = await p.evaluate(() => { const sc = document.querySelector('#stkc-zs .cm-scroller'); return { sw: sc.scrollWidth, cw: sc.clientWidth, pressed: document.querySelector('#stkc-zs .sed-tool[aria-pressed]').getAttribute('aria-pressed') }; });
    check(wrap.pressed === 'true' && wrap.sw <= wrap.cw + 1, 'soft wrap on by default, nothing cut off', wrap);
    // line numbers align with text lines
    const align = await p.evaluate(() => {
      const g = [...document.querySelectorAll('#stkc-zs .cm-lineNumbers .cm-gutterElement')].filter((e) => /^\d+$/.test(e.textContent) && getComputedStyle(e).visibility !== 'hidden');
      const lines = [...document.querySelectorAll('#stkc-zs .cm-line')];
      return g.slice(0, 5).map((e, i) => Math.abs(e.getBoundingClientRect().top - lines[i].getBoundingClientRect().top)).every((d) => d < 1.5);
    });
    check(align, 'line numbers aligned to text lines');
    await p.screenshot({ path: `${OUT}/after-zs-1440-dark.png` });

    // type: New script, then a broken line -> error with line:col, gutter dot, squiggle
    await p.click(Z + ' .sed-ft .sed-btn:nth-child(3)');   // New
    await p.waitForTimeout(300);
    s = await st(p, Z);
    check(s.status === 'Unsaved' && s.name === '', 'New: empty name, Unsaved', s);
    await p.fill(Z + ' .sed-name', 'Test EMA');
    await p.click(Z + ' .cm-content');
    await p.keyboard.press(mod + '+End');
    await p.keyboard.type('plot(ta.emaa(close, 9), "E")');
    await waitProb(p, Z, /problem/, 8000);
    await p.waitForTimeout(400);
    s = await st(p, Z);
    check(s.probS === 'err' && s.rows.some((r) => /^Line 5:\d+ .*ta\.ema/.test(r)) && s.status === 'Error', 'typing an error: problems strip shows Line 5:col, status Error', s);
    check(s.marks >= 1 && s.squiggles >= 1, 'red gutter marker + squiggle on the line', { marks: s.marks, sq: s.squiggles });
    await p.screenshot({ path: `${OUT}/after-zs-1440-error.png` });
    // click the problem -> cursor jumps to line 5
    await p.click(Z + ' .sed-prob-row');
    const curLine = await p.evaluate(() => { const a = document.querySelector('#stkc-zs .cm-activeLineGutter'); return a ? a.textContent : ''; });
    check(curLine === '5', 'clicking the problem jumps to line 5: ' + curLine);
    // fix it
    await p.keyboard.press('Home'); await p.keyboard.press('Shift+End');
    await p.keyboard.type('plot(ta.ema(close, 9), "E")');
    await waitProb(p, Z, /Compiled OK/, 8000);
    s = await st(p, Z);
    check(s.probS === 'ok' && s.marks === 0, 'fixed: Compiled OK, markers gone: ' + s.prob);
    // Ctrl+/ comments the line, again uncomments
    await p.keyboard.press(mod + '+/');
    let ln = await p.evaluate(() => [...document.querySelectorAll('#stkc-zs .cm-line')][4].textContent);
    check(/^\/\/ ?plot\(ta\.ema/.test(ln), 'Ctrl+/ comments the line: ' + ln);
    await p.keyboard.press(mod + '+/');
    // auto-indent after an if
    await p.keyboard.press(mod + '+End');
    await p.keyboard.type('\nif close > open');
    await p.keyboard.press('Enter');
    ln = await p.evaluate(() => { const l = [...document.querySelectorAll('#stkc-zs .cm-line')]; return l[l.length - 1].textContent; });
    check(ln === '    ', 'auto-indent after "if": 4 spaces', ln);
    await p.keyboard.type('x = 1');
    // bracket matching
    await p.keyboard.press(mod + '+Home');
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('End');
    const bm = await p.evaluate(() => document.querySelectorAll('#stkc-zs .cm-matchingBracket').length);
    check(bm >= 1, 'bracket matching highlights the pair: ' + bm);
    // Ctrl+F opens find
    await p.keyboard.press(mod + '+f');
    await p.waitForTimeout(200);
    check(await p.evaluate(() => !!document.querySelector('#stkc-zs .cm-search')), 'Ctrl+F opens find');
    await p.screenshot({ path: `${OUT}/after-zs-1440-find.png` });
    await p.keyboard.press('Escape');
    check(await p.evaluate(() => !document.getElementById('stkc-zs').hidden && !document.querySelector('#stkc-zs .cm-search')), 'Escape closes find, panel stays');
    // remove the if block we typed (keep the script simple)
    await p.evaluate(() => { const v = document.querySelector('#stkc-zs .cm-content').cmView; });
    await p.click(Z + ' .cm-content');
    await p.keyboard.press(mod + '+End');
    for (let i = 0; i < 2; i++) { await p.keyboard.press('Shift+Home'); await p.keyboard.press('Shift+Home'); await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace'); }
    await waitProb(p, Z, /Compiled OK/, 8000);

    // Ctrl+Enter adds to chart -> Update on chart
    await p.click(Z + ' .cm-content');
    await p.keyboard.press(mod + '+Enter');
    await p.waitForFunction(() => /Update on chart/.test(document.querySelector('#stkc-zs .sed-btn.is-primary').textContent), null, { timeout: 15000 }).catch(() => null);
    let on = await zsOn(p);
    s = await st(p, Z);
    check(on.length === 1 && s.primary === 'Update on chart', 'Ctrl+Enter adds to chart; button says Update on chart', { on, primary: s.primary });
    // edit + update replaces, never stacks
    await p.keyboard.press(mod + '+End');
    await p.keyboard.type('\nplot(ta.sma(close, 50), "S")');
    await p.click(Z + ' .sed-btn.is-primary');
    await p.waitForTimeout(2500);
    on = await zsOn(p);
    check(on.length === 1, 'Update on chart replaces the script (1 on chart): ' + on.length);
    // Ctrl+S save
    await p.click(Z + ' .cm-content');
    const foc = await p.evaluate(() => document.activeElement && document.activeElement.className);
    await p.keyboard.press(mod + '+s');
    await p.waitForTimeout(800);
    if (process.env.DEBUG) console.log('focus before Ctrl+S:', foc, await p.evaluate(() => [...document.querySelectorAll('.stk-toast, .toast, [class*=toast]')].map((t) => t.textContent.slice(0, 80)).filter(Boolean).slice(0, 5)));
    s = await st(p, Z);
    const saved = await p.evaluate(async () => (await window.STRYKER_ZS.store.list()).items.map((x) => x.name));
    check(saved.includes('Test EMA') && s.status === 'Saved', 'Ctrl+S saves: My scripts has Test EMA, status Saved', { saved, status: s.status });
    // typing again -> Unsaved
    await p.keyboard.type(' ');
    await p.waitForTimeout(100);
    check((await st(p, Z)).status === 'Unsaved', 'edit after save -> Unsaved');
    await p.keyboard.press('Backspace');

    // library (narrow): Library view
    await p.click(Z + ' .sed-view-b[data-v="lib"]');
    await p.click(Z + ' .sed-tab[data-k="mine"]');
    await p.waitForTimeout(300);
    s = await st(p, Z);
    const mine = await p.evaluate(() => [...document.querySelectorAll('#stkc-zs .sed-pane:not([hidden]) .sed-row-nm')].map((x) => x.textContent));
    check(s.libVisible && !s.codeVisible && mine.includes('Test EMA'), 'narrow: Library view shows My scripts', { mine, s });
    await p.screenshot({ path: `${OUT}/after-zs-1440-library-narrow.png` });
    // examples tab: 5 rows, aligned actions
    await p.click(Z + ' .sed-tab[data-k="examples"]');
    const ex = await p.evaluate(() => { const rows = [...document.querySelectorAll('#stkc-zs .sed-pane:not([hidden]) .sed-row')]; return { n: rows.length, right: [...new Set(rows.map((r) => Math.round(r.querySelector('.sed-row-acts').getBoundingClientRect().right)))].length }; });
    check(ex.n === 5 && ex.right === 1, '5 examples, action columns right-aligned', ex);
    await p.click(Z + ' .sed-view-b[data-v="code"]');

    // resize: drag the left edge to ~860 -> wide mode; width remembered
    const g = await p.evaluate(() => { const r = document.querySelector('#stkc-zs .sed-grip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.mouse.move(g.x, g.y); await p.mouse.down(); await p.mouse.move(g.x - 150, g.y, { steps: 5 }); await p.mouse.move(g.x - 300, g.y, { steps: 5 }); await p.mouse.up();
    await p.waitForTimeout(300);
    s = await st(p, Z);
    const lsW = await p.evaluate(() => +localStorage.getItem('stk_script_ed_w'));
    check(s.w >= 840 && s.w <= 880 && s.wide && s.libVisible && s.codeVisible && Math.abs(lsW - s.w) <= 1, 'drag left edge: ~860 wide, library beside code, width remembered', { w: s.w, lsW, wide: s.wide });
    await p.click(Z + ' .sed-tab[data-k="docs"]');
    await p.fill(Z + ' .sed-search', 'ta.vwap');
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/after-zs-1440-wide.png` });
    // Docs: insert at the cursor
    await p.click(Z + ' .cm-content'); await p.keyboard.press(mod + '+End'); await p.keyboard.press('Enter');
    const before = await p.evaluate(() => document.querySelector('#stkc-zs .cm-content').textContent.length);
    await p.click(Z + ' .sed-doc-b');
    const ins = await p.evaluate(() => document.querySelector('#stkc-zs .cm-content').textContent);
    check(/ta\.vwap\(\)/.test(ins) && ins.length > before, 'Docs row inserts ta.vwap() at the cursor');
    await p.keyboard.press(mod + '+z');
    // Expand / collapse
    await p.click(Z + ' .sed-expand');
    await p.waitForTimeout(400);
    s = await st(p, Z);
    check(s.max && s.w >= 1100 && s.l >= 100 && s.wide, 'Expand: large centred editor (~80%)', { w: s.w, l: s.l });
    await p.screenshot({ path: `${OUT}/after-zs-1440-expanded.png` });
    await p.click(Z + ' .sed-expand');
    await p.waitForTimeout(300);
    s = await st(p, Z);
    check(!s.max && Math.abs(s.w - lsW) <= 2, 'collapse: back to the side panel at the remembered width', { w: s.w, lsW });
    // More menu
    await p.click(Z + ' .sed-btn.is-icon');
    const menu = await p.evaluate(() => [...document.querySelectorAll('#stkc-zs .sed-mi')].map((x) => x.textContent + (x.disabled ? '(off)' : '')));
    check(menu.join() === 'Duplicate,Export .zs,Import file…,Publish to the Script Library,Delete', 'More menu items: ' + menu.join());
    await p.screenshot({ path: `${OUT}/after-zs-1440-more.png` });
    await p.click(Z + ' .sed-mi[data-k="dup"]');
    s = await st(p, Z);
    check(s.name === 'Test EMA copy' && s.status === 'Unsaved', 'Duplicate -> "Test EMA copy", Unsaved', s.name);
    // reload: width + saved script + chart script persist
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_ZS && window.STRYKER_VELA, null, { timeout: 60000 });
    await p.waitForTimeout(5000);
    await openZs(p);
    await p.waitForTimeout(500);
    s = await st(p, Z);
    const saved2 = await p.evaluate(async () => (await window.STRYKER_ZS.store.list()).items.map((x) => x.name));
    on = await zsOn(p);
    check(Math.abs(s.w - lsW) <= 2 && saved2.includes('Test EMA') && on.length === 1, 'after reload: width, saved script and chart script kept', { w: s.w, saved2, on });
    // On chart tab -> open it -> Update on chart
    await p.click(Z + ' .sed-tab[data-k="chart"]');
    await p.click(Z + ' .sed-pane:not([hidden]) .sed-row-main');
    await p.waitForTimeout(300);
    check((await st(p, Z)).primary === 'Update on chart', 'opening from On chart -> Update on chart');
    check(errors.length === 0, 'no page errors (dark)', errors.slice(0, 3));
    // Pine (import) panel
    await p.click(Z + ' .stkc-langseg-b[data-k="pine"]');
    await p.waitForSelector('#stkc-pine .cm-editor', { timeout: 15000 });
    s = await st(p, '#stkc-pine');
    check(s.open && s.status === 'Example' && /EMA 9\/21 cross/.test(s.name), 'Pine (import) panel opens with its example', s);
    const pr = await p.evaluate(async () => { const P = window.STRYKER_PINE; await P.addToChart(); return P.pineHandles(window.STRYKER_VELA.context().cells[0].chart).length; });
    s = await st(p, '#stkc-pine');
    check(pr === 1 && s.primary === 'Update on chart', 'Pine example added; Update on chart', { pr, primary: s.primary });
    const pe = await p.evaluate(async () => { const P = window.STRYKER_PINE; P.load('Bad', '//@version=5\nindicator("Bad")\nplot(close\n', null); await P.addToChart(); return 1; });
    await p.waitForTimeout(500);
    s = await st(p, '#stkc-pine');
    check(s.probS === 'err' && s.rows.some((r) => /^Line \d+/.test(r)) && s.marks >= 1, 'Pine error: Line N in problems + gutter marker', s);
    await p.screenshot({ path: `${OUT}/after-pine-1440-error.png` });
    check(errors.length === 0, 'no page errors (pine)', errors.slice(0, 3));
    await ctx.close();

    // ---------- 1440 light ----------
    ({ ctx, p, errors } = await open(b, { w: 1440, h: 900, light: true }));
    await p.evaluate(() => { localStorage.removeItem('stk_script_ed_w'); });
    await openZs(p);
    await waitProb(p, Z, /Compiled OK/, 10000);
    check(await p.evaluate(() => document.documentElement.dataset.theme === 'light'), 'light theme on');
    await p.screenshot({ path: `${OUT}/after-zs-1440-light.png` });
    await p.click(Z + ' .sed-expand'); await p.waitForTimeout(400);
    await p.click(Z + ' .sed-tab[data-k="examples"]'); await p.waitForTimeout(200);
    await p.screenshot({ path: `${OUT}/after-zs-1440-light-expanded.png` });
    await ctx.close();

    // ---------- phones ----------
    for (const w of [390, 412]) {
      ({ ctx, p, errors } = await open(b, { w, h: w === 390 ? 844 : 915, mobile: true }));
      await openZs(p);
      await waitProb(p, Z, /Compiled OK/, 10000);
      const ph = await p.evaluate(() => {
        const pn = document.getElementById('stkc-zs').getBoundingClientRect();
        const btns = [...document.querySelectorAll('#stkc-zs .sed-ft .sed-btn')].map((b) => b.getBoundingClientRect());
        const ed = document.querySelector('#stkc-zs .sed-ed').getBoundingClientRect();
        const fs = parseFloat(getComputedStyle(document.querySelector('#stkc-zs .cm-content')).fontSize);
        return { l: pn.left, r: pn.right, vw: innerWidth, vh: innerHeight, bb: Math.max(...btns.map((b) => b.bottom)), br: Math.max(...btns.map((b) => b.right)), bh: Math.min(...btns.map((b) => b.height)), heights: [...new Set(btns.map((b) => Math.round(b.height)))].length, edh: ed.height, fs, docW: document.documentElement.scrollWidth,
          expand: getComputedStyle(document.querySelector('#stkc-zs .sed-expand')).display, grip: getComputedStyle(document.querySelector('#stkc-zs .sed-grip')).display };
      });
      check(ph.l <= 0 && ph.r >= ph.vw - 1 && ph.docW <= ph.vw, w + ': full-width sheet, no sideways scroll', ph);
      check(ph.bb <= ph.vh && ph.br <= ph.vw && ph.bh >= 44 && ph.heights === 1 && ph.edh >= 300, w + ': footer visible, buttons 44 high and equal, editor >= 300', ph);
      check(ph.fs >= 16 && ph.expand === 'none' && ph.grip === 'none', w + ': code 16px (no iOS zoom), no expand/grip on phone', ph);
      await p.screenshot({ path: `${OUT}/after-zs-${w}-dark.png` });
      await p.click(Z + ' .sed-view-b[data-v="lib"]');
      await p.click(Z + ' .sed-tab[data-k="examples"]');
      await p.waitForTimeout(300);
      const lib = await p.evaluate(() => ({ n: document.querySelectorAll('#stkc-zs .sed-pane:not([hidden]) .sed-row').length, minH: Math.min(...[...document.querySelectorAll('#stkc-zs .sed-pane:not([hidden]) .sed-row-acts .sed-ib')].map((b) => b.getBoundingClientRect().height)) }));
      check(lib.n === 5 && lib.minH >= 44, w + ': library behind its tab, 44px row actions', lib);
      await p.screenshot({ path: `${OUT}/after-zs-${w}-library.png` });
      if (w === 390) {
        await p.click(Z + ' .sed-view-b[data-v="code"]');
        const rr = await p.evaluate(async () => { await window.STRYKER_ZS.addToChart(); return { open: !document.getElementById('stkc-zs').hidden, n: window.STRYKER_ZS.handles(window.STRYKER_VELA.context().cells[0].chart).length }; });
        check(!rr.open && rr.n === 1, '390: Add to chart adds and closes the sheet', rr);
      }
      check(errors.length === 0, w + ': no page errors', errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
