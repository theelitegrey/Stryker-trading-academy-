// Indicator Settings → Inputs: input.symbol opens the chart's symbol search (Owner 2026-10-12).
// CHART_BASE=http://127.0.0.1:8071 OUT=/path flock /tmp/stryker-chrome.lock node tools/tests/chart-symbol-input-picker-browser.js
// Needs tools/tests/chart-dev-server.mjs on CHART_BASE (live /api/chart/bars upstream).
// Opens SMT Divergence Pro [TradeZoro] settings, clicks Symbol 1, searches "YM", picks the
// first row and asserts: the field shows CBOT_MINI:YM1!, the indicator input is that ticker,
// the indicator re-ran (a new YM1! series fetch + a new model), no console errors. Also: the
// Owner's contracts are findable, rows our feeds cannot load are not offered, Escape closes only
// the search, the type-it box normalises "mgc" -> COMEX_MINI:MGC1!, and at 390 px the search is
// full-screen with tappable rows. Screenshots at 1280 and 390 go to OUT.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const path = require('path');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8071';
const OUT = process.env.OUT || '/tmp/symbol-input-picker';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fail++; };
const IGNORE = /ERR_FAILED|WebGL|GroupMarker|GPU stall|favicon|firebase|Failed to load resource|WebSocket connection .*\/api\/chart\/stream\/.*Unexpected response code: 404/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(browser, w, h){
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, deviceScaleFactor: w < 500 ? 2 : 1 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch(e){} });
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance|data-api\.binance|fapi\.binance|stream\.binance|data-stream\.binance)/, r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text().slice(0, 300)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE && window.STRYKER_SYMBOL_INPUT, null, { timeout: 60000 });
  await p.evaluate(() => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id); c.setSymbol('futures:NQ1!'); c.setTimeframe('5'); });
  await p.evaluate(async () => {
    const chart = window.STRYKER_VELA.context().cells[0].chart;
    for (let i = 0; i < 90; i++) { await new Promise(r => setTimeout(r, 500)); try { if (chart.orchestrator.rawBars.length > 50) break; } catch(e){} }
  });
  return { ctx, p, errs };
}

async function addSmt(p){
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await p.waitForSelector('.stkiw-row', { timeout: 20000 });
  await p.evaluate(() => document.querySelector('.stkiw-tab[data-k="picks"]').click());
  await sleep(300);
  await p.evaluate(() => [...document.querySelectorAll('.stkiw-row')].find(r => (r.querySelector('.stkiw-nm') || {}).textContent === 'SMT Divergence Pro [TradeZoro]').querySelector('.stkiw-name').click());
  await p.waitForFunction(() => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).length > 0, null, { timeout: 60000 });
  await p.evaluate(() => { try { window.STRYKER_VELA.indicatorPicker.close(); } catch(e){} });
  // Wait for the first model, then instrument: series fetches + model count.
  return p.evaluate(async () => {
    const chart = window.STRYKER_VELA.context().cells[0].chart;
    const h = window.STRYKER_PINE.pineHandles(chart)[0];
    for (let i = 0; i < 80; i++) {
      const rec = [...chart.orchestrator.registry.all()].find(r => r.model && r.model.id === h.id);
      if (rec && rec.model) break;
      await new Promise(r => setTimeout(r, 500));
    }
    window.__fetchLog = [];
    const f = window.STRYKER_VELA.feed; const o = f.loadRange.bind(f);
    f.loadRange = async (cfg, r) => { window.__fetchLog.push(cfg.symbol); return o(cfg, r); };
    h.setInputs({ autoSym: false });   // manual symbols: Symbol 1 is what the indicator compares
    await new Promise(r => setTimeout(r, 2500));
    return h.id;
  });
}

const modelStamp = (p) => p.evaluate(() => {
  const chart = window.STRYKER_VELA.context().cells[0].chart;
  const h = window.STRYKER_PINE.pineHandles(chart)[0];
  const rec = [...chart.orchestrator.registry.all()].find(r => r.model && r.model.id === h.id);
  return rec && rec.model ? rec.model : null;
}).then(() => p.evaluate(() => {
  const chart = window.STRYKER_VELA.context().cells[0].chart;
  const h = window.STRYKER_PINE.pineHandles(chart)[0];
  const rec = [...chart.orchestrator.registry.all()].find(r => r.model && r.model.id === h.id);
  if (!rec.model.__stkStamp) rec.model.__stkStamp = Math.random();
  return rec.model.__stkStamp;
}));

async function openSettings(p, id){
  await p.evaluate((id) => window.STRYKER_VELA.context().cells[0].chart.renderer.openIndicatorSettings(id), id);
  await p.waitForSelector('.vela-ind-dialog', { timeout: 10000 });
  await sleep(400);
}

async function run(browser, w, h){
  const tag = w + '';
  const { ctx, p, errs } = await page(browser, w, h);
  const id = await addSmt(p);
  check(!!id, `${tag}: SMT Divergence Pro added (${id})`);
  await openSettings(p, id);
  const sel = `#vela-inp-${id}-symS1`;
  const field = await p.evaluate((sel) => {
    const b = document.querySelector(sel); if (!b) return null;
    const tk = b.querySelector('.stk-symin-tk');
    if (!tk) return { debug: b.outerHTML.slice(0, 400), patched: window.STRYKER_SYMBOL_INPUT.patched, hasPicker: !!window.STRYKER_VELA.context().cells[0].chart.renderer.symbolPicker };
    const br = b.getBoundingClientRect(), tr = tk.getBoundingClientRect();
    return { cls: b.className, sym: b.dataset.symbol, title: b.title, tk: tk.textContent, tkInside: tr.right <= br.right + 0.5 && tr.left >= br.left - 0.5,
      tkClipped: tk.scrollWidth > tk.clientWidth + 1, w: Math.round(br.width), icon: !!b.querySelector('.stk-symin-ico svg'), edit: !!b.parentElement.querySelector('.stk-symin-edit') };
  }, sel);
  console.log('INFO field', JSON.stringify(field));
  if (field && field.debug) { check(false, `${tag}: picker control not installed`); await ctx.close(); return; }
  check(field && field.cls.includes('stk-symin-btn') && field.icon, `${tag}: Symbol 1 is a button with a search icon`);
  check(field && field.sym === 'CME_MINI:ES1!' && /CME_MINI:ES1!/.test(field.title) && /S&P 500/.test(field.title), `${tag}: shows CME_MINI:ES1! with full-ticker tooltip (${field && field.title})`);
  check(field && field.tk === 'ES1!' && field.tkInside && !field.tkClipped, `${tag}: contract ES1! fully visible, not clipped (w ${field && field.w}px)`);
  check(field && field.edit, `${tag}: type-it button present`);
  const all = await p.evaluate(() => [...document.querySelectorAll('.stk-symin-btn')].map(b => b.dataset.symbol));
  check(all.length === 3 && all.includes('CBOT_MINI:YM1!') && all.includes('CME_MINI:RTY1!'), `${tag}: all three symbol inputs use the picker (${all.join(', ')})`);

  if (w >= 1000) await p.screenshot({ path: path.join(OUT, `settings-${tag}.png`) });

  // Click Symbol 1 -> the search opens (seeded with ES), then search YM.
  await p.click(sel);
  await p.waitForSelector('.stk-symin-list .vela-sp-row', { timeout: 10000 });
  const seeded = await p.evaluate(() => document.querySelector('.stk-symin-search').value);
  check(seeded === 'ES', `${tag}: search opens seeded with the current contract (${seeded})`);
  const tabs = await p.evaluate(() => [...document.querySelector('.stk-symin-list').parentElement.querySelectorAll('.vela-sp-tab')].map(t => t.textContent));
  check(['All', 'Crypto', 'Futures', 'Forex', 'Commodities'].every(t => tabs.includes(t)), `${tag}: same category tabs (${tabs.join(', ')})`);
  await p.fill('.stk-symin-search', 'YM');
  await sleep(500);
  const rows = await p.evaluate(() => [...document.querySelectorAll('.stk-symin-list .vela-sp-row')].map(r => ({ t: (r.querySelector('.vela-sp-ticker') || {}).textContent, h: Math.round(r.getBoundingClientRect().height) })));
  console.log('INFO YM rows', JSON.stringify(rows.slice(0, 8)));
  check(rows[0] && rows[0].t === 'YM1!' && rows.some(r => r.t === 'MYM1!'), `${tag}: "YM" lists YM1! first and MYM1!`);
  if (w < 500) {
    const geo = await p.evaluate(() => { let el = document.querySelector('.stk-symin-list'), panel = el; while ((el = el.parentElement) && el !== document.body) { if (/vela-dialog/.test(el.className) && el.getBoundingClientRect().height >= panel.getBoundingClientRect().height) panel = el; } const r = panel.getBoundingClientRect(); const c = (window.STRYKER_VELA.root || document.querySelector('.vela-workspace') || document.getElementById('vela-chart')).getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: Math.round(c.height), top: Math.round(r.top), ctop: Math.round(c.top) }; });
    console.log('INFO phone dialog', JSON.stringify(geo));
    check(geo.w >= geo.vw - 2 && geo.h >= geo.vh - 4 && Math.abs(geo.top - geo.ctop) <= 2, `${tag}: search fills the whole chart area on phone, like the header search (${geo.w}x${geo.h} of ${geo.vw}x${geo.vh})`);
    check(rows.slice(0, 5).every(r => r.h >= 40), `${tag}: rows are tappable (>= 40 px: ${rows.slice(0, 5).map(r => r.h).join(',')})`);
    await p.screenshot({ path: path.join(OUT, `search-${tag}.png`) });
  } else {
    await p.screenshot({ path: path.join(OUT, `search-${tag}.png`) });
  }

  // Pick the YM1! row.
  const before = await modelStamp(p);
  await p.evaluate(() => { window.__fetchLog.length = 0; });
  if (w < 500) await p.tap('.stk-symin-list .vela-sp-row[data-i="0"]'); else await p.click('.stk-symin-list .vela-sp-row[data-i="0"]');
  await sleep(300);
  const after = await p.evaluate((sel) => ({ open: !!document.querySelector('.stk-symin-list .vela-sp-row') && !!document.querySelector('.stk-symin-search') && document.querySelector('.stk-symin-search').offsetParent !== null,
    dlg: !!document.querySelector('.vela-ind-dialog'), sym: (document.querySelector(sel) || {}).dataset ? document.querySelector(sel).dataset.symbol : null,
    shown: document.querySelector(sel) ? document.querySelector(sel).textContent : null }), sel);
  check(!after.open && after.dlg, `${tag}: search closed, settings dialog still open`);
  check(after.sym === 'CBOT_MINI:YM1!' && after.shown === 'CBOT_MINI:YM1!', `${tag}: input shows CBOT_MINI:YM1! (${after.shown})`);
  const rerun = await p.evaluate(async (before) => {
    const chart = window.STRYKER_VELA.context().cells[0].chart;
    const h = window.STRYKER_PINE.pineHandles(chart)[0];
    let stamp = before;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500));
      const rec = [...chart.orchestrator.registry.all()].find(r => r.model && r.model.id === h.id);
      if (rec && rec.model && rec.model.__stkStamp !== before && window.__fetchLog.length) { stamp = 'new'; break; }
    }
    return { input: (typeof h.inputValues === 'function' ? h.inputValues() : h.inputValues).symS1, fetched: window.__fetchLog.slice(), stamp };
  }, before);
  console.log('INFO rerun', JSON.stringify(rerun));
  check(rerun.input === 'CBOT_MINI:YM1!', `${tag}: indicator input symS1 = CBOT_MINI:YM1!`);
  check(rerun.stamp === 'new' && rerun.fetched.some(s => /YM1!/.test(s)), `${tag}: indicator re-ran (new model, fetched ${[...new Set(rerun.fetched)].join(',')})`);
  if (w >= 1000) await p.screenshot({ path: path.join(OUT, `picked-${tag}.png`) });
  else await p.screenshot({ path: path.join(OUT, `picked-${tag}.png`) });

  if (w >= 1000) {
    // Owner's contracts are findable, each the first or second row.
    await p.click(`#vela-inp-${id}-symS2`);
    await p.waitForSelector('.stk-symin-list .vela-sp-row', { timeout: 10000 });
    const finds = {};
    for (const q of ['MYM', 'GC', 'MGC', 'SI', 'SIL', 'CL', 'MCL', 'ES', 'MES', 'NQ', 'MNQ']) {
      await p.fill('.stk-symin-search', q); await sleep(250);
      finds[q] = await p.evaluate(() => [...document.querySelectorAll('.stk-symin-list .vela-sp-row .vela-sp-ticker')].slice(0, 3).map(t => t.textContent));
    }
    console.log('INFO finds', JSON.stringify(finds));
    check(Object.entries(finds).every(([q, r]) => r.slice(0, 2).includes(q + '1!')), `${tag}: YM/MYM GC/MGC SI/SIL CL/MCL ES/MES NQ/MNQ each in the top 2`);
    // Keyboard nav: ArrowDown + Enter on "GC" picks the second row.
    await p.fill('.stk-symin-search', 'GC'); await sleep(250);
    const second = await p.evaluate(() => document.querySelectorAll('.stk-symin-list .vela-sp-row .vela-sp-ticker')[1].textContent);
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await sleep(300);
    const s2 = await p.evaluate((id) => document.querySelector(`#vela-inp-${id}-symS2`).dataset.symbol, id);
    check(s2 === (second === 'MGC1!' ? 'COMEX_MINI:MGC1!' : 'COMEX:' + second), `${tag}: keyboard ArrowDown+Enter picks ${second} -> ${s2}`);
    // Only loadable rows: every offered row resolves back to its own provider.
    await p.click(`#vela-inp-${id}-symS3`);
    await p.waitForSelector('.stk-symin-list .vela-sp-row', { timeout: 10000 });
    const pool = await p.evaluate(() => { const sp = window.STRYKER_SYMBOL_INPUT.picker; const pool = sp.pool(); const raw = window.STRYKER_VELA.feed.symbols();
      const bad = pool.filter(d => { const r = window.STRYKER_VELA.feed.resolveSymbol(d.ticker); return !r || r.provider !== d.provider; });
      return { offered: pool.length, total: raw.length, bad: bad.length, eth: pool.filter(d => d.ticker === 'BTCUSDT').map(d => d.provider) }; });
    console.log('INFO pool', JSON.stringify(pool));
    check(pool.bad === 0 && pool.offered > 100 && pool.offered <= pool.total, `${tag}: only loadable rows offered (${pool.offered}/${pool.total}, bad ${pool.bad})`);
    // Escape closes only the search.
    await p.keyboard.press('Escape'); await sleep(300);
    const esc = await p.evaluate(() => ({ sp: !!document.querySelector('.stk-symin-search') && document.querySelector('.stk-symin-search').offsetParent !== null, dlg: !!document.querySelector('.vela-ind-dialog') }));
    check(!esc.sp && esc.dlg, `${tag}: Escape closes the search, keeps settings open`);
    // Type it by hand: "mgc" -> COMEX_MINI:MGC1!; "binance:ethusdt" -> BINANCE:ETHUSDT.
    for (const [typed, want] of [['mgc', 'COMEX_MINI:MGC1!'], ['binance:ethusdt', 'BINANCE:ETHUSDT']]) {
      await p.click(`#vela-inp-${id}-symS3 + .stk-symin-edit`);
      await p.waitForSelector('.stk-symin-in', { timeout: 3000 });
      await p.fill('.stk-symin-in', typed); await p.keyboard.press('Enter'); await sleep(300);
      const v = await p.evaluate((id) => ({ shown: document.querySelector(`#vela-inp-${id}-symS3`).dataset.symbol, input: (() => { const h = window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart)[0]; return (typeof h.inputValues === 'function' ? h.inputValues() : h.inputValues).symS3; })() }), id);
      check(v.shown === want && v.input === want, `${tag}: typed "${typed}" -> ${v.shown} / input ${v.input}`);
    }
  }
  await sleep(1500);
  check(!errs.length, `${tag}: console errors: ${errs.slice(0, 3).join(' | ') || 'none'}`);
  await ctx.close();
}

(async () => {
  const b = await launch();
  try {
    await run(b, 1280, 860);
    await run(b, 390, 844);
  } finally { await b.close(); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
