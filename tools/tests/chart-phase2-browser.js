// Charts phase 2 smoke test (layouts, sync, splitter, templates on the
// localStorage path, credits popover, full-bleed sizing) against
// tools/tests/chart-dev-server.mjs. Needs network (jsDelivr + Yahoo).
//   CHART_BASE=http://localhost:8032 node tools/tests/chart-phase2-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://localhost:8031';
const OUT = process.argv[2] || '/tmp';
const ONLY = process.env.ONLY || '';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_CHART_UI, null, { timeout: 30000 });
  await p.waitForTimeout(4000);
  return { ctx, p, errors };
}
const cells = (p) => p.evaluate(() => window.STRYKER_VELA.context().cells.map((c) => c.symbol + ' ' + c.timeframe));
const settle = async (p) => {
  await p.evaluate(async () => {
    const ws = window.STRYKER_VELA;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const ok = ws.context().cells.every((c) => { try { return c.chart.orchestrator.rawBars.length > 0; } catch (e) { return false; } });
      if (ok) break;
    }
  });
  await p.waitForTimeout(800);
};

async function desktop(b, w, h, theme, tag) {
  const { ctx, p, errors } = await open(b, { w, h, theme });
  const frame = await p.evaluate(() => {
    const r = document.getElementById('vela-chart').getBoundingClientRect();
    return { l: r.left, r: r.right, b: r.bottom, docH: document.documentElement.scrollHeight, vh: innerHeight, sw: document.documentElement.scrollWidth,
      wm: [...document.querySelectorAll('.vela-attribution, .vela-attribution-custom')].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== 'none').length, footer: document.querySelector('.stkchart-credit').textContent,
      sidebarVisible: getComputedStyle(document.querySelector('.dash-shell > .sidebar')).visibility };
  });
  check(frame.l <= 1 && frame.r >= w - 1, `${tag}: chart spans full width (${frame.l}..${frame.r} of ${w})`);
  check(frame.docH <= h + 1 && frame.sw <= w + 1, `${tag}: no page scroll (docH ${frame.docH} vh ${frame.vh}, sw ${frame.sw})`);
  check(frame.b >= h - 40, `${tag}: chart reaches the bottom (bottom ${Math.round(frame.b)} of ${h})`);
  check(frame.wm === 0, `${tag}: no Vela logomark on canvas`);
  check(!/vela|luxalgo/i.test(frame.footer) && /Education only\. Not financial advice\./.test(frame.footer), `${tag}: footer has no brand text, keeps disclaimer`);
  check(frame.sidebarVisible === 'hidden', `${tag}: sidebar collapsed`);
  if (w === 1920) { await p.screenshot({ path: `${OUT}/p2-${tag}-1.png` }); await ctx.close(); check(!errors.length, `${tag}: console errors ${errors.slice(0, 3).join(' | ') || 'none'}`); return; }

  // credits popover
  await p.click('#stkc-credits-btn');
  const cred = await p.evaluate(() => { const c = document.getElementById('stkc-credits'); return { vis: !c.hidden, txt: c.textContent, href: [...c.querySelectorAll('a')].map((a) => a.getAttribute('href')) }; });
  check(cred.vis && /Vela/.test(cred.txt) && cred.href.includes('https://luxalgo.com/vela') && cred.href.includes('assets/vendor/VELA-NOTICE.txt'), `${tag}: credits popover with Vela + luxalgo.com/vela + NOTICE`);
  await p.screenshot({ path: `${OUT}/p2-${tag}-credits.png` });
  await p.keyboard.press('Escape');

  // layouts via our picker
  for (const id of ['2h', '2v', '3l', '4', '1']) {
    await p.click('#stkc-layout-btn');
    if (id === '2h') await p.screenshot({ path: `${OUT}/p2-${tag}-layoutmenu.png` });
    await p.click(`#stkc-layout-pop [data-layout="${id}"]`);
    await settle(p);
    const n = await p.evaluate(() => ({ id: window.STRYKER_VELA.layout.id, n: window.STRYKER_VELA.context().cells.length }));
    check(n.id === id && n.n === ({ '1': 1, '2h': 2, '2v': 2, '3l': 3, '4': 4 })[id], `${tag}: layout ${id} -> ${n.n} cells ${JSON.stringify(await cells(p))}`);
    if (id !== '1') await p.screenshot({ path: `${OUT}/p2-${tag}-L${id}.png` });
  }
  // starter templates
  for (const s of ['starter:index-pair', 'starter:nq-scalp', 'starter:quad']) {
    await p.evaluate((sid) => { const U = window.STRYKER_CHART_UI; U.applyStarter(U.STARTERS.find((x) => x.id === sid)); }, s);
    await settle(p);
    const c = await cells(p);
    const sync = await p.evaluate(() => window.STRYKER_VELA.sync.state());
    console.log(tag, s, c, JSON.stringify(sync));
    const exp = { 'starter:index-pair': ['futures:NQ1! 5', 'futures:ES1! 5'], 'starter:nq-scalp': ['futures:NQ1! 1', 'futures:NQ1! 5'], 'starter:quad': ['futures:NQ1! 15', 'futures:ES1! 15', 'futures:GC1! 15', 'futures:CL1! 15'] }[s];
    check(JSON.stringify(c) === JSON.stringify(exp), `${tag}: ${s} cells ${c.join(' | ')}`);
    if (s === 'starter:nq-scalp') check(!!sync.crosshair && !!sync.viewport, `${tag}: nq-scalp sync crosshair+time on`);
    await p.screenshot({ path: `${OUT}/p2-${tag}-${s.split(':')[1]}.png` });
  }
  // sync toggles via UI (index pair: 2 cells)
  await p.evaluate(() => { const U = window.STRYKER_CHART_UI; U.applyStarter(U.STARTERS[1]); });
  await settle(p);
  await p.click('#stkc-layout-btn');
  for (const k of ['crosshair', 'viewport', 'symbol', 'timeframe']) {
    await p.click(`#stkc-layout-pop input[data-sync="${k}"]`);
    const on = await p.evaluate((k) => !!window.STRYKER_VELA.sync.state()[k], k);
    check(on, `${tag}: sync ${k} toggled on`);
  }
  // timeframe sync: change active cell timeframe -> other follows
  await p.keyboard.press('Escape');
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.active.setTimeframe('60'); });
  await p.waitForTimeout(1500);
  const tfs = await cells(p);
  check(tfs.every((x) => / 60$/.test(x)), `${tag}: interval sync propagates ${tfs.join(' | ')}`);
  await p.click('#stkc-layout-btn');
  for (const k of ['crosshair', 'viewport', 'symbol', 'timeframe']) await p.click(`#stkc-layout-pop input[data-sync="${k}"]`);
  const offs = await p.evaluate(() => window.STRYKER_VELA.sync.state());
  check(!Object.values(offs).some(Boolean), `${tag}: sync toggles off again ${JSON.stringify(offs)}`);
  await p.keyboard.press('Escape');

  // splitter drag
  const sp = await p.evaluate(() => {
    const cand = [...document.querySelectorAll('#vela-chart *')].filter((e) => /split|gutter|resiz/i.test(e.className && e.className.baseVal === undefined ? e.className : '') && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 100);
    const e = cand[0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, cls: e.className };
  });
  if (sp) {
    const before = await p.evaluate(() => [...window.STRYKER_VELA.context().cells].map((c) => Math.round(c.chart.element ? 0 : 0)));
    const w0 = await p.evaluate(() => document.querySelector('#vela-chart [data-cell], #vela-chart .vela-cell') ? document.querySelector('#vela-chart [data-cell], #vela-chart .vela-cell').getBoundingClientRect().width : -1);
    await p.mouse.move(sp.x, sp.y); await p.mouse.down(); await p.mouse.move(sp.x - 200, sp.y, { steps: 8 }); await p.mouse.up();
    await p.waitForTimeout(600);
    const st = await p.evaluate(() => window.STRYKER_VELA.getState().trackSizes);
    const w1 = await p.evaluate(() => document.querySelector('#vela-chart [data-cell], #vela-chart .vela-cell') ? document.querySelector('#vela-chart [data-cell], #vela-chart .vela-cell').getBoundingClientRect().width : -1);
    console.log(tag, 'splitter', sp.cls, w0, '->', w1, JSON.stringify(st));
    check(JSON.stringify(st || {}).includes('2h'), `${tag}: splitter drag changes track sizes ${JSON.stringify(st)}`);
    await p.screenshot({ path: `${OUT}/p2-${tag}-splitter.png` });
  } else check(false, `${tag}: splitter element found`);

  // templates (localStorage path in the stub)
  const T = await p.evaluate(async () => {
    const T = window.StrykerChartTemplates; const ws = window.STRYKER_VELA; const out = {};
    const id = await T.save('Test pair', ws.getState());
    out.size = JSON.stringify(ws.getState()).length;
    let r = await T.list(); out.n1 = r.items.length;
    await T.rename(id, 'Renamed pair'); r = await T.list(); out.name = r.items[0].name;
    await T.setDefault(id); r = await T.list(); out.def = r.defaultId === id;
    window.STRYKER_CHART_UI.setLayout('1');
    window.STRYKER_CHART_UI.applySaved(r.items[0]);
    out.afterLoad = ws.context().cells.map((c) => c.symbol + ' ' + c.timeframe);
    out.id = id;
    return out;
  });
  console.log(tag, 'templates', JSON.stringify(T));
  check(T.n1 === 1 && T.name === 'Renamed pair' && T.def && T.afterLoad.length === 2, `${tag}: save/rename/default/load (state ${T.size} chars)`);
  await p.click('#stkc-tpl-btn');
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/p2-${tag}-templates.png` });
  const scrollbad = await p.evaluate(() => [...document.querySelectorAll('.stkc-pop')].filter((e) => !e.hidden && e.scrollHeight > e.clientHeight + 2).map((e) => getComputedStyle(e).scrollbarWidth));
  console.log(tag, 'scrolling popovers', scrollbad);
  await p.keyboard.press('Escape');
  // default applies on a fresh load with no session
  await p.evaluate(() => localStorage.removeItem('vela-workspace'));
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_CHART_UI, null, { timeout: 30000 });
  await p.waitForTimeout(5000);
  const afterDef = await cells(p);
  check(afterDef.length === 2, `${tag}: default template opens when no session (${afterDef.join(' | ')})`);
  // session wins over default
  await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('1'));
  await p.waitForTimeout(1500);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_CHART_UI, null, { timeout: 30000 });
  await p.waitForTimeout(5000);
  const afterSess = await cells(p);
  check(afterSess.length === 1, `${tag}: saved session wins over default (${afterSess.join(' | ')})`);
  const del = await p.evaluate(async () => { const T = window.StrykerChartTemplates; const r = await T.list(); for (const t of r.items) await T.remove(t.id); return (await T.list()).items.length; });
  check(del === 0, `${tag}: delete`);
  await ctx.close();
  check(!errors.length, `${tag}: console errors ${errors.slice(0, 3).join(' | ') || 'none'}`);
}

async function phone(b, w, h, theme, tag) {
  const { ctx, p, errors } = await open(b, { w, h, mobile: true, theme });
  const f = await p.evaluate(() => { const r = document.getElementById('vela-chart').getBoundingClientRect(); const d = document.getElementById('appnav-dock').getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, dockTop: d.top, docH: document.documentElement.scrollHeight, wm: [...document.querySelectorAll('.vela-attribution, .vela-attribution-custom')].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== 'none').length }; });
  check(f.l <= 1 && f.r >= w - 1 && f.docH <= h + 1, `${tag}: full width, no page scroll (docH ${f.docH})`);
  check(f.b <= f.dockTop + 1 && f.b >= f.dockTop - 40, `${tag}: chart ends above the dock (${Math.round(f.b)} vs dock ${Math.round(f.dockTop)})`);
  check(f.wm === 0, `${tag}: no logomark`);
  await p.screenshot({ path: `${OUT}/p2-${tag}-1.png` });
  await p.evaluate(() => { const U = window.STRYKER_CHART_UI; U.applyStarter(U.STARTERS[1]); });
  await settle(p);
  const sw = await p.evaluate(() => ({ chips: [...document.querySelectorAll('.stkc-cell')].map((c) => c.textContent), max: window.STRYKER_VELA.maximizedCell }));
  if (w > 700) {
    check(sw.chips.length === 0 && !sw.max, `${tag}: tablet shows both charts (no switcher)`);
    await p.screenshot({ path: `${OUT}/p2-${tag}-pair.png` });
    await ctx.close();
    check(!errors.length, `${tag}: console errors ${errors.slice(0, 3).join(' | ') || 'none'}`);
    return;
  }
  check(sw.chips.length === 2 && !!sw.max, `${tag}: phone cell switcher ${sw.chips.join(',')} maximized ${sw.max}`);
  await p.screenshot({ path: `${OUT}/p2-${tag}-pair-a.png` });
  await p.click('.stkc-cell:nth-child(2)');
  await p.waitForTimeout(1500);
  const sw2 = await p.evaluate(() => ({ max: window.STRYKER_VELA.maximizedCell, on: document.querySelector('.stkc-cell.on').textContent }));
  check(sw2.max && sw2.max !== sw.max, `${tag}: switch to chart 2 (${sw2.on})`);
  await p.screenshot({ path: `${OUT}/p2-${tag}-pair-b.png` });
  await p.click('#stkc-tpl-btn'); await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/p2-${tag}-templates.png` });
  await p.keyboard.press('Escape');
  await p.click('#stkc-credits-btn'); await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/p2-${tag}-credits.png` });
  await ctx.close();
  check(!errors.length, `${tag}: console errors ${errors.slice(0, 3).join(' | ') || 'none'}`);
}

(async () => {
  const b = await launch();
  try {
    if (!ONLY || ONLY === 'desk') await desktop(b, 1440, 900, 'dark', 'desk-dark');
    if (!ONLY || ONLY === 'wide') await desktop(b, 1920, 1080, 'dark', 'w1920');
    if (!ONLY || ONLY === 'phone') await phone(b, 390, 844, 'dark', 'phone-dark');
    if (!ONLY || ONLY === 'tab') await phone(b, 768, 1024, 'day', 'tab-day');
    if (!ONLY || ONLY === 'day') await desktop(b, 1440, 900, 'day', 'desk-day');
  } finally { await b.close(); }
  console.log(`\n${fail} failures`);
  process.exit(fail ? 1 : 0);
})();
