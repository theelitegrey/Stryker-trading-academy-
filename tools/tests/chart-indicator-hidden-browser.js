// HIDDEN INDICATORS STAY HIDDEN (member bug report 2026-11-08: "after re-opening the chart, by default all the
// indicators are ON"). An indicator hidden with the legend eye must come back hidden after a reload (signed-out
// local save), a 2-chart layout, a saved named layout (signed-in cloud save), a template and a setup. Covers a
// built-in Pine script (Liquidity Master), a Vela native (VWAP) and a TradeZoro overlay (GEX Levels).
// Old saved states without the flag still load visible. Fixture bars (no network), in-memory Firestore.
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/chart-indicator-hidden-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };

const MIN = Math.floor(Date.now() / 60000), N = 600;
const price = (m) => 28650 + Math.sin((m - MIN) / 17) * 40 + Math.sin((m - MIN) / 5) * 9;
const rows = []; for (let m = MIN - N; m < MIN; m++) { const o = price(m), c = price(m + 1); rows.push([m * 60, o, Math.max(o, c) + 3, Math.min(o, c) - 3, c, 500]); }

// Same in-memory Firestore as chart-layout-size-browser.js.
function memDb() {
  window.__mem = window.__mem || {};
  const real = window.firebase.firestore;
  const fv = real.FieldValue;
  const doc = (path) => ({ id: path.split('/').pop(),
    get: async () => ({ id: path.split('/').pop(), exists: !!window.__mem[path], data: () => window.__mem[path] }),
    set: async (d, o) => { window.__mem[path] = Object.assign({}, o && o.merge ? window.__mem[path] : {}, JSON.parse(JSON.stringify(d))); },
    update: async (d) => { if (!window.__mem[path]) throw new Error('not-found'); Object.assign(window.__mem[path], JSON.parse(JSON.stringify(d))); },
    delete: async () => { delete window.__mem[path]; },
    collection: (s) => col(path + '/' + s) });
  let auto = 0;
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

// The visible flag of every indicator on every chart, by kind: { cellIndex: { pine: [..], vwap: [..], stk_gex: [..] } }
const vis = (p) => p.evaluate(() => {
  const out = [];
  window.STRYKER_VELA.context().cells.forEach((c) => {
    const o = { pine: [], vwap: [], stk_gex: [] };
    c.chart.indicators().forEach((h) => {
      if (window.STRYKER_PINE.pineHandles(c.chart).includes(h)) o.pine.push(h.visible !== false);
      else if (h.nativeType === 'vwap' || h.nativeType === 'stk_gex') o[h.nativeType].push(h.visible !== false);
    });
    out.push(o);
  });
  return out;
});
// Wait until a cell has its Pine script back (restore is async).
const waitPine = (p, n, cell) => p.waitForFunction(([k, ci]) => { const c = window.STRYKER_VELA.context().cells[ci]; return c && window.STRYKER_PINE.pineHandles(c.chart).length === k; }, [n, cell || 0], { timeout: 60000 }).then(() => true).catch(() => false);
const settle = async (p, n, cells) => { for (let i = 0; i < (cells || 1); i++) await waitPine(p, n, i); await sleep(1500); };
const HIDDEN_ONE = (v) => v && v.pine.join() === 'false' && v.vwap.join() === 'false' && v.stk_gex.join() === 'true';
const HIDDEN_TWO = (v) => v && v.pine.join() === 'false' && v.vwap.join() === 'true' && v.stk_gex.join() === 'false';   // chart 2 hides the GEX overlay

// Add LM (Pine) + VWAP + GEX Levels to cell ci, then hide the Pine script and VWAP with the legend's own path (handle.setVisible).
async function addAndHide(p, ci, nat) {
  await p.evaluate(async (ci) => {
    const v = document.querySelector('script[src*="chart-templates.js"]').src.split('v=')[1];
    const { builtinSource } = await import('/assets/chart-pine-builtins.js?v=' + v);
    const c = window.STRYKER_VELA.context().cells[ci].chart;
    if (ci > 0) { const cell = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[ci].id); cell.setSymbol('futures:NQ1!'); cell.setTimeframe('1'); }
    for (let i = 0; i < 80 && !(c.orchestrator.rawBars.length > 100); i++) await new Promise((r) => setTimeout(r, 250));
    const r = await window.STRYKER_PINE.runOnChart(c, await builtinSource('liquidity-master-tradezoro'), {}, false, { engine: 'next' });
    if (!r.ok) throw new Error('Pine add failed on chart ' + ci + ': ' + r.msg + ' bars ' + c.orchestrator.rawBars.length);
    c.addNativeIndicator('vwap'); c.addNativeIndicator('stk_gex');
  }, ci);
  await waitPine(p, 1, ci);
  await sleep(1500);
  await p.evaluate(([ci, nat]) => {
    const c = window.STRYKER_VELA.context().cells[ci].chart;
    window.STRYKER_PINE.pineHandles(c)[0].setVisible(false);
    c.indicators().find((h) => h.nativeType === nat).setVisible(false);
  }, [ci, nat]);
  await sleep(1200);   // state:changed -> Vela's local autosave (debounced)
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, tag] of [[390, 844, true, '390'], [1440, 900, false, '1440']]) {
      const { ctx, p, errors } = await open(b, w, h, mobile);
      await addAndHide(p, 0, 'vwap');
      let v = await vis(p);
      check(HIDDEN_ONE(v[0]), tag + ': setup: Pine + VWAP hidden, GEX Levels shown', v[0]);
      const st = await p.evaluate(() => window.STRYKER_VELA.getState());
      const pine = st.charts[0].ext['stryker.pine'];
      check(pine && pine[0] && pine[0].hidden === true, tag + ': saved state marks the hidden Pine script', pine && pine.map((x) => ({ n: x.name, hidden: x.hidden })));
      // 1. Reload (signed-out local save: Vela's localStorage document)
      await p.waitForTimeout(1500);
      await p.reload({ waitUntil: 'domcontentloaded' });
      await boot(p);
      await settle(p, 1);
      v = await vis(p);
      check(HIDDEN_ONE(v[0]), tag + ': after a reload the 2 hidden indicators stay hidden', v[0]);
      await p.screenshot({ path: OUT + '/' + tag + '-dark-after-reload.png' });
      // 2. Saved named layout (signed-in cloud save) -> clear -> open
      await p.evaluate(() => window.STRYKER_LAYOUTS.saveAsNew('Hidden test'));
      await sleep(800);
      const lid = await p.evaluate(() => { const k = Object.keys(window.__mem).find((x) => /chartLayouts\//.test(x)); return k && k.split('/').pop(); });
      await p.evaluate(() => localStorage.setItem('stryker_chart_layout_auto_' + firebase.auth().currentUser.uid, 'false'));
      await p.evaluate(() => { const c = window.STRYKER_VELA.chart; c.indicators().filter((x) => x.nativeType !== 'volume').forEach((x) => x.remove()); });
      await sleep(800);
      await p.evaluate((id) => window.STRYKER_LAYOUTS.openById(id), lid);
      await settle(p, 1);
      v = await vis(p);
      check(HIDDEN_ONE(v[0]), tag + ': a saved layout opens with the 2 indicators still hidden', v[0]);
      // 3. Template (applySaved = saved template / library setup path) and a setup
      const doc = await p.evaluate(() => window.STRYKER_VELA.getState());
      await p.evaluate((d) => window.STRYKER_CHART_UI.applySaved({ state: JSON.stringify(d) }), doc);
      await settle(p, 1);
      v = await vis(p);
      check(HIDDEN_ONE(v[0]), tag + ': a template keeps the 2 indicators hidden', v[0]);
      await p.evaluate((d) => window.STRYKER_CHART_UI.applySaved({ state: JSON.stringify(window.STRYKER_CHART_UI.setupOf(d)) }), doc);
      await settle(p, 1);
      v = await vis(p);
      check(HIDDEN_ONE(v[0]), tag + ': a setup keeps the 2 indicators hidden', v[0]);
      // 4. Old state without the flag: everything visible
      const old = JSON.parse(JSON.stringify(doc));
      old.charts.forEach((c) => { (c.ext['stryker.pine'] || []).forEach((x) => delete x.hidden); if (c.indicators) c.indicators.natives = c.indicators.natives.map((n) => (typeof n === 'object' ? n.type : n)); });
      await p.evaluate((d) => window.STRYKER_CHART_UI.applySaved({ state: JSON.stringify(d) }), old);
      await settle(p, 1);
      v = await vis(p);
      check(v[0].pine.join() === 'true' && v[0].vwap.join() === 'true' && v[0].stk_gex.join() === 'true', tag + ': an old state with no hidden flag loads everything visible', v[0]);
      // 5. 2-chart layout: hide in BOTH charts, reload
      await p.evaluate(() => localStorage.setItem('stryker_chart_layout_auto_' + firebase.auth().currentUser.uid, 'true'));
      await p.evaluate((d) => window.STRYKER_CHART_UI.applySaved({ state: JSON.stringify(d) }), doc);
      await settle(p, 1);
      await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('2h'));
      await sleep(2500);
      const n2 = await p.evaluate(() => window.STRYKER_VELA.context().cells.length);
      check(n2 === 2, tag + ': 2-chart layout', n2);
      await addAndHide(p, 1, 'stk_gex');
      await p.waitForTimeout(1500);
      await p.reload({ waitUntil: 'domcontentloaded' });
      await boot(p);
      await settle(p, 1, 2);
      v = await vis(p);
      check(v.length === 2 && HIDDEN_ONE(v[0]) && HIDDEN_TWO(v[1]), tag + ': 2-chart layout: both charts keep their hidden indicators after a reload (chart 2: Pine + GEX Levels hidden)', v);
      await p.screenshot({ path: OUT + '/' + tag + '-dark-2chart-after-reload.png' });
      check(errors.length === 0, tag + ': no page errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
