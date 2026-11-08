// INDICATOR SETTINGS ARE SAVED (member report 2026-11-08: "if any changes is made to indicator in a certain layout,
// when chart is reloaded, it's showing default, indicator settings are not being saved").
// Changes made in an indicator's settings must come back after a reload (Vela's local save), a saved named layout
// (cloud save, in-memory Firestore) opened back, a template, and in a 2-chart layout (each chart its own values).
// Covers a built-in Pine script (Liquidity Master: 3 inputs + 1 colour), two Vela natives (VWAP anchor, RSI length)
// and a TradeZoro overlay (GEX Levels). Fixture bars (no network).
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/chart-indicator-settings-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 500) : '')); };

const MIN = Math.floor(Date.now() / 60000), N = 600;
const price = (m) => 28650 + Math.sin((m - MIN) / 17) * 40 + Math.sin((m - MIN) / 5) * 9;
const rows = []; for (let m = MIN - N; m < MIN; m++) { const o = price(m), c = price(m + 1); rows.push([m * 60, o, Math.max(o, c) + 3, Math.min(o, c) - 3, c, 500]); }

// Same in-memory Firestore as chart-indicator-hidden-browser.js, but kept in sessionStorage so the account's
// documents survive a reload (like a real cloud save).
function memDb() {
  try { window.__mem = window.__mem || JSON.parse(sessionStorage.getItem('__mem') || '{}'); } catch (e) { window.__mem = {}; }
  const keep = () => { try { sessionStorage.setItem('__mem', JSON.stringify(window.__mem)); } catch (e) {} };
  const real = window.firebase.firestore;
  const fv = real.FieldValue;
  const doc = (path) => ({ id: path.split('/').pop(),
    get: async () => ({ id: path.split('/').pop(), exists: !!window.__mem[path], data: () => window.__mem[path] }),
    set: async (d, o) => { window.__mem[path] = Object.assign({}, o && o.merge ? window.__mem[path] : {}, JSON.parse(JSON.stringify(d))); keep(); },
    update: async (d) => { if (!window.__mem[path]) throw new Error('not-found'); Object.assign(window.__mem[path], JSON.parse(JSON.stringify(d))); keep(); },
    delete: async () => { delete window.__mem[path]; keep(); },
    collection: (s) => col(path + '/' + s) });
  let auto = Object.keys(window.__mem).length;
  const col = (path) => ({ doc: (id) => doc(path + '/' + (id || ('AutoId' + String(++auto).padStart(14, '0')))),
    get: async () => { const xs = Object.keys(window.__mem).filter((k) => k.startsWith(path + '/') && k.slice(path.length + 1).indexOf('/') < 0); return { size: xs.length, docs: xs, forEach: (f) => xs.forEach((k) => f({ id: k.split('/').pop(), data: () => window.__mem[k] })) }; },
    add: async (d) => { const r = doc(path + '/AutoId' + String(++auto).padStart(14, '0')); await r.set(d); return r; },
    where() { return this; }, orderBy() { return this; }, limit() { return this; } });
  const db = { collection: col, batch: () => ({ ops: [], set(r, d) { this.ops.push(() => r.set(d)); }, update(r, d) { this.ops.push(() => r.update(d)); }, delete(r) { this.ops.push(() => r.delete()); }, async commit() { for (const f of this.ops) await f(); } }) };
  window.firebase.firestore = Object.assign(() => db, { FieldValue: fv || { serverTimestamp: () => Date.now() } });
  if (!window.firebase.apps || !window.firebase.apps.length) window.firebase.apps = [{}];
}

async function boot(p) {
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_PINE && window.STRYKER_LAYOUTS && window.StrykerStateCodec, null, { timeout: 90000 });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 100) break; } });
  await sleep(800);
  await p.evaluate(memDb);
}
async function open(b, w, h, mobile) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page: 0, bars: rows }) }));
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await boot(p);
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 100) break; } });
  return { ctx, p, errors };
}

// The settings under test, per chart. Chart 2 uses other values so a mix-up between charts shows.
const WANT = [
  { pine: { fvgMax: 7, f5: true, mergeTk: 9, fvgBullBg: '#FF000080' }, vwap: { anchor: 'Week' }, rsi: { length: 21 }, stk_gex: { showCall: false } },
  { pine: { fvgMax: 3, f10: true, mergeTk: 2, fvgBearBg: '#00FF0080' }, vwap: { anchor: 'Month' }, rsi: { length: 9 }, stk_gex: { showZero: false } }
];
// Style tab overrides (one element of the script's catalogue), per chart.
const STYLE = [{ width: 4, lineStyle: 'dashed' }, { width: 2, lineStyle: 'dotted' }];
// Read the current values of the keys under test: [{ pine: {...}, vwap: {...}, rsi: {...}, stk_gex: {...} }] per cell.
// Indicator ids are per chart ("ind-1" on both charts), so the Style tab is read / written through the module's own
// getStyle / setStyle with the chart's orchestrator (window.STRYKER_IND_STYLE looks an id up in the first chart only).
const read = (p) => p.evaluate(async (W) => {
  const M = await import('/assets/chart-ind-style.js?v=' + document.querySelector('script[src*="chart-templates.js"]').src.split('v=')[1]);
  return window.STRYKER_VELA.context().cells.map((c, ci) => {
    const want = W[ci] || W[0], o = {};
    const pine = window.STRYKER_PINE.pineHandles(c.chart)[0];
    const pick = (h, keys) => { if (!h) return null; const v = h.inputValues(); const r = {}; keys.forEach((k) => { r[k] = v[k]; }); return r; };
    o.pine = pick(pine, Object.keys(want.pine));
    const rec = pine && c.chart.orchestrator.registry.get(pine.id);
    const st = rec && M.getStyle(c.chart.orchestrator, rec);
    o.style = st && st.el ? Object.values(st.el)[0] || null : null;   // Style tab (line width / line style) of the Pine script
    ['vwap', 'rsi', 'stk_gex'].forEach((t) => { o[t] = pick(c.chart.indicators().find((h) => h.nativeType === t), Object.keys(want[t])); });
    return o;
  });
}, WANT);
const same = (got, ci) => !!got && JSON.stringify(Object.assign({}, got, { style: undefined })) === JSON.stringify(WANT[ci]) && JSON.stringify(got.style) === JSON.stringify(STYLE[ci]);
// Restored Pine inputs land once the script has compiled: wait for that, not a fixed time.
const settle = (p, cells) => p.waitForFunction((n) => {
  const cs = window.STRYKER_VELA.context().cells;
  if (cs.length < n) return false;
  for (let i = 0; i < n; i++) { const h = window.STRYKER_PINE.pineHandles(cs[i].chart)[0]; if (!h || !h.inputs || !h.inputs.length) return false; }
  return true;
}, cells || 1, { timeout: 60000 }).then(() => sleep(1500)).catch(() => {});

// Add LM + VWAP + RSI + GEX Levels to chart ci and change their settings through the handle (the settings dialog
// calls the same path: onChange -> applyInputs).
async function addAndEdit(p, ci) {
  await p.evaluate(async (ci) => {
    const v = document.querySelector('script[src*="chart-templates.js"]').src.split('v=')[1];
    const { builtinSource } = await import('/assets/chart-pine-builtins.js?v=' + v);
    const c = window.STRYKER_VELA.context().cells[ci].chart;
    if (ci > 0) { const cell = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[ci].id); cell.setSymbol('futures:NQ1!'); cell.setTimeframe('1'); }
    for (let i = 0; i < 80 && !(c.orchestrator.rawBars.length > 100); i++) await new Promise((r) => setTimeout(r, 250));
    const r = await window.STRYKER_PINE.runOnChart(c, await builtinSource('liquidity-master-tradezoro'), {}, false, { engine: 'next' });
    if (!r.ok) throw new Error('Pine add failed on chart ' + ci + ': ' + r.msg);
    c.addNativeIndicator('vwap'); c.addNativeIndicator('rsi'); c.addNativeIndicator('stk_gex');
  }, ci);
  await settle(p, ci + 1);
  await p.evaluate(([ci, W]) => {
    const c = window.STRYKER_VELA.context().cells[ci].chart, w = W[ci];
    const h = window.STRYKER_PINE.pineHandles(c)[0];
    Object.keys(w.pine).forEach((k) => h.setInput(k, w.pine[k]));   // one edit at a time, like the dialog
    ['vwap', 'rsi', 'stk_gex'].forEach((t) => c.indicators().find((x) => x.nativeType === t).setInputs(w[t]));
  }, [ci, WANT]);
  // Style tab: line width + line style on the script's first drawn element (same call the tab makes)
  await p.waitForFunction((ci) => { const c = window.STRYKER_VELA.context().cells[ci].chart, h = window.STRYKER_PINE.pineHandles(c)[0], r = h && c.orchestrator.registry.get(h.id); return !!(r && r.__stkRaw); }, ci, { timeout: 60000 }).catch(() => {});
  await p.evaluate(async ([ci, S]) => {
    const M = await import('/assets/chart-ind-style.js?v=' + document.querySelector('script[src*="chart-templates.js"]').src.split('v=')[1]);
    const c = window.STRYKER_VELA.context().cells[ci].chart, h = window.STRYKER_PINE.pineHandles(c)[0];
    const rec = c.orchestrator.registry.get(h.id);
    const k = M.catalog(rec.__stkRaw)[0].key;
    M.setStyle(c.orchestrator, rec, { el: { [k]: S[ci] } });
  }, [ci, STYLE]);
  await sleep(3000);   // Vela's local autosave + the named layout's 2 s autosave
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, tag] of [[390, 844, true, '390'], [1440, 900, false, '1440']]) {
      const { ctx, p, errors } = await open(b, w, h, mobile);
      // 0. A named layout is open (signed in, autosave on), as for the member
      await p.evaluate(() => window.STRYKER_LAYOUTS.saveAsNew('Settings test'));
      await sleep(800);
      const lid = await p.evaluate(() => window.STRYKER_LAYOUTS.current && window.STRYKER_LAYOUTS.current.id);
      check(!!lid, tag + ': named layout open', lid);
      await addAndEdit(p, 0);
      let v = await read(p);
      check(same(v[0], 0), tag + ': settings changed', v[0]);
      const st = await p.evaluate(() => window.STRYKER_VELA.getState());
      const pe = (st.charts[0].ext['stryker.pine'] || [])[0];
      check(pe && pe.inputs && pe.inputs.fvgMax === 7 && pe.inputs.fvgBullBg === '#FF000080', tag + ': saved state has the Pine inputs + colour', pe && pe.inputs && { fvgMax: pe.inputs.fvgMax, f5: pe.inputs.f5, mergeTk: pe.inputs.mergeTk, fvgBullBg: pe.inputs.fvgBullBg });
      // 1. Reload
      await p.reload({ waitUntil: 'domcontentloaded' });
      await boot(p);
      await settle(p, 1);
      v = await read(p);
      check(same(v[0], 0), tag + ': after a reload every changed setting is back', v[0]);
      await p.screenshot({ path: OUT + '/' + tag + '-dark-after-reload.png' });
      // 2. The named layout in the account has the edits (autosave), and opens with them
      const saved = await p.evaluate((id) => { const k = Object.keys(window.__mem).find((x) => x.endsWith('/' + id)); return k ? window.__mem[k].state : null; }, lid);
      check(!!saved, tag + ': named layout is in the account', !!saved);
      await p.evaluate(() => { const c = window.STRYKER_VELA.chart; c.indicators().filter((x) => x.nativeType !== 'volume').forEach((x) => x.remove()); });
      await sleep(800);
      await p.evaluate((id) => window.STRYKER_LAYOUTS.openById(id), lid);
      await settle(p, 1);
      v = await read(p);
      check(same(v[0], 0), tag + ': the saved named layout opens with the changed settings', v[0]);
      // 3. Template (applySaved: saved template / library path) over a chart at defaults
      const doc = await p.evaluate(() => window.STRYKER_VELA.getState());
      await p.evaluate(() => { const c = window.STRYKER_VELA.chart; c.indicators().filter((x) => x.nativeType !== 'volume').forEach((x) => x.remove()); });
      await sleep(500);
      await p.evaluate((d) => window.STRYKER_CHART_UI.applySaved({ state: JSON.stringify(d) }), doc);
      await settle(p, 1);
      v = await read(p);
      check(same(v[0], 0), tag + ': a template keeps the changed settings', v[0]);
      // 4. 2-chart layout: chart 2 gets its own settings; reload
      await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('2h'));
      await sleep(2500);
      const n2 = await p.evaluate(() => window.STRYKER_VELA.context().cells.length);
      check(n2 === 2, tag + ': 2-chart layout', n2);
      await addAndEdit(p, 1);
      await p.reload({ waitUntil: 'domcontentloaded' });
      await boot(p);
      await settle(p, 2);
      v = await read(p);
      check(v.length === 2 && same(v[0], 0) && same(v[1], 1), tag + ': 2-chart layout: each chart keeps its own settings after a reload', v);
      await p.screenshot({ path: OUT + '/' + tag + '-dark-2chart-after-reload.png' });
      check(errors.length === 0, tag + ': no page errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
