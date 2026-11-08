// LAYOUT-PERF Part 1 browser test: big layouts save (built-in Pine by reference + gzip past 200 KB), open back
// exactly, old inline-source layouts still open and re-save small. Fixture bars (no network), in-memory Firestore.
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/chart-layout-size-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };

const MIN = Math.floor(Date.now() / 60000), N = 600;
const price = (m) => 28650 + Math.sin((m - MIN) / 17) * 40 + Math.sin((m - MIN) / 5) * 9;
const rows = []; for (let m = MIN - N; m < MIN; m++) { const o = price(m), c = price(m + 1); rows.push([m * 60, o, Math.max(o, c) + 3, Math.min(o, c) - 3, c, 500]); }

// In-memory Firestore for chartLayouts / chartShared (set/get/update/delete, merge) behind the rich stub.
function memDb() {
  window.__mem = {};
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
  if (!window.firebase.apps || !window.firebase.apps.length) window.firebase.apps = [{}];   // the layout menu checks apps.length
}

async function open(b, w, h, mobile) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page: 0, bars: rows }) }));
  const p = await ctx.newPage(), errors = [], toasts = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.exposeFunction('__toastSeen', (t, m) => toasts.push(t + ': ' + m));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_PINE && window.STRYKER_LAYOUTS && window.StrykerStateCodec, null, { timeout: 90000 });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 100) break; } });
  await sleep(1000);
  await p.evaluate(memDb);
  await p.evaluate(() => { const s = window.showToast; window.showToast = function (t, m, o) { window.__toastSeen(t, String(m)); return s && s.apply(this, arguments); }; });
  return { ctx, p, errors, toasts };
}
const pineCount = (p) => p.evaluate(() => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.chart).length);
const waitPine = (p, n) => p.waitForFunction((k) => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.chart).length === k, n, { timeout: 60000 }).then(() => true).catch(() => false);
const drawCount = (p) => p.evaluate(() => window.STRYKER_VELA.chart.drawings.all().length);
const BUILTINS = ['ict-pro-plus-timmynq', 'liquidity-master-tradezoro', 'fvg-relay-stryker'];

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, tag] of [[390, 844, true, '390'], [1440, 900, false, '1440']]) {
      const { ctx, p, errors, toasts } = await open(b, w, h, mobile);
      // 3 ICT-style built-ins + order flow + 2 natives + drawings
      await p.evaluate(async (ids) => {
        const { builtinSource } = await import('/assets/chart-pine-builtins.js?v=' + (document.querySelector('script[src*="chart-templates.js"]').src.split('v=')[1]));
        for (const id of ids) { const src = await builtinSource(id); await window.STRYKER_PINE.addSource(id, src, { engine: 'next', builtin: true }); }
        const c = window.STRYKER_VELA.chart; for (const t of ['ema', 'vwap']) { try { c.addNativeIndicator(t, {}); } catch (e) {} }
      }, BUILTINS);
      check(await waitPine(p, 3), tag + ': 3 built-in Pine indicators on the chart', await p.evaluate(() => ({ n: window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.chart).length, sym: window.STRYKER_VELA.chart.market.symbol, bars: window.STRYKER_VELA.chart.orchestrator.rawBars.length, url: location.href })));
      // enough drawings for > 200 KB of JSON (the member's case was 260 KB)
      await p.evaluate(() => { const c = window.STRYKER_VELA.chart, bars = c.orchestrator.rawBars, n = bars.length;
        for (let i = 0; i < 1400; i++) { const a = bars[(i * 7) % (n - 12)], z = bars[(i * 7) % (n - 12) + 10]; c.drawings.add(i % 3 ? 'trendline' : 'rectangle', { paneId: 'price', anchors: [{ time: a.time, price: a.low }, { time: z.time, price: z.high }] }); }
        window.STRYKER_VELA.context().stateChanged(); });
      await sleep(500);
      const nDraw = await drawCount(p);
      const st = await p.evaluate(() => { const s = window.STRYKER_VELA.getState(); const pine = s.charts[0].ext['stryker.pine']; return { len: JSON.stringify(s).length, refs: pine.map((x) => x.builtin || null), srcs: pine.filter((x) => typeof x.source === 'string').length }; });
      check(st.refs.filter(Boolean).length === 3 && st.srcs === 0, tag + ': unchanged built-ins saved by reference, no source in the state', st.refs);
      check(st.len > 200000, tag + ': fixture state is over the old 200 KB cap (' + Math.round(st.len / 1024) + ' KB JSON, ' + nDraw + ' drawings)');
      // Save as new
      await p.evaluate(() => window.STRYKER_LAYOUTS.saveAsNew('Heavy BTC'));
      await sleep(800);
      const saved = await p.evaluate(() => { const k = Object.keys(window.__mem).find((x) => /chartLayouts\//.test(x)); const d = k && window.__mem[k]; return d ? { id: k.split('/').pop(), len: d.state.length, tz: d.state.startsWith('tz1:'), indicators: d.indicators } : null; });
      check(saved && saved.tz && saved.len < 200000, tag + ': saved compressed (' + (saved && Math.round(saved.len / 1024)) + ' KB stored)', saved);
      check(!toasts.some((t) => /^error/.test(t)), tag + ': no error toast on save', toasts);
      await p.screenshot({ path: OUT + '/' + tag + '-dark-heavy-saved.png' });
      // Clear the chart, then open it back
      // autosave off, else clearing the chart would be saved over the layout
      await p.evaluate(() => localStorage.setItem('stryker_chart_layout_auto_' + firebase.auth().currentUser.uid, 'false'));
      await p.evaluate(() => { window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.chart).forEach((h) => h.remove()); const d = window.STRYKER_VELA.chart.drawings; d.removeMany(d.all().map((x) => x.id)); });
      await sleep(1500);
      check((await pineCount(p)) === 0 && (await drawCount(p)) === 0, tag + ': chart cleared');
      const t0 = Date.now();
      await p.evaluate((id) => window.STRYKER_LAYOUTS.openById(id), saved.id);
      const back = await waitPine(p, 3);
      check(back, tag + ': open restores the 3 built-ins (' + (Date.now() - t0) + ' ms to all 3 handles)');
      check((await drawCount(p)) === nDraw, tag + ': open restores every drawing', { want: nDraw, got: await drawCount(p) });
      // Old layout: inline source (as saved before this change) still opens, and re-saves with refs
      const old = await p.evaluate(async (ids) => {
        const v = document.querySelector('script[src*="chart-templates.js"]').src.split('v=')[1];
        const { builtinSource, PICKER_SCRIPTS } = await import('/assets/chart-pine-builtins.js?v=' + v);
        const src = await builtinSource(ids[1]);
        const name = PICKER_SCRIPTS.find((x) => x.id === ids[1]).name;
        const st = { version: 1, layout: '1', charts: [{ id: 'A', symbol: 'futures:NQ1!', timeframe: '1', drawings: [], ext: { 'stryker.pine': [{ name, source: src, inputs: {}, engine: 'next' }] } }] };
        const uid = firebase.auth().currentUser.uid;
        window.__mem['students/' + uid + '/chartLayouts/OldLayoutInlineSrc01'] = { name: 'Old', state: JSON.stringify(st), shared: false };
        return JSON.stringify(st).length;
      }, BUILTINS);
      await p.evaluate(() => window.STRYKER_LAYOUTS.openById('OldLayoutInlineSrc01'));
      check(await waitPine(p, 1), tag + ': an old layout with inline built-in source opens (' + Math.round(old / 1024) + ' KB)');
      await p.evaluate(() => localStorage.setItem('stryker_chart_layout_auto_' + firebase.auth().currentUser.uid, 'true'));
      await p.evaluate(() => window.STRYKER_LAYOUTS.saveNow(false));
      await sleep(600);
      const re = await p.evaluate(async () => { const k = Object.keys(window.__mem).find((x) => /OldLayoutInlineSrc01/.test(x)); const s = window.__mem[k].state; const d = await window.StrykerStateCodec.decode(s); return { len: s.length, ref: d.charts[0].ext['stryker.pine'][0].builtin || null }; });
      check(re.ref === 'liquidity-master-tradezoro' && re.len < 5000, tag + ': re-saved old layout stores a ref (' + Math.round(old / 1024) + ' KB -> ' + (re.len / 1024).toFixed(1) + ' KB)', re);
      // Share: a viewer opening a shared layout with refs gets the built-ins (sanitizeShared keeps refs)
      check(errors.length === 0, tag + ': no page errors', errors);
      await ctx.close();
    }
    // Shared-doc safety still runs on non-ref Pine; refs pass (unit level, in page)
    {
      const { ctx, p } = await open(b, 1440, 900, false);
      const r = await p.evaluate(async () => {
        const v = document.querySelector('script[src*="chart-templates.js"]').src.split('v=')[1];
        const m = await import('/assets/chart-layouts.js?v=' + v);
        const d = { charts: [{ ext: { 'stryker.pine': [{ name: 'x', builtin: 'fvg-relay-stryker', inputs: {} }, { name: 'bad', builtin: '../../evil', inputs: {} }, { name: 'y', source: 'x = eval(1)', inputs: {} }] } }] };
        const s = m.sanitizeShared(d); return { kept: s.doc.charts[0].ext['stryker.pine'].map((x) => x.name), dropped: s.dropped };
      });
      check(r.kept.join() === 'x' && r.dropped === 2, 'shared layout: a built-in ref is kept, a bad ref and an unsafe script are dropped', r);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
