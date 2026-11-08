// Browser test: metric alerts (assets/chart-metric-alerts.js). Alerts window "+ Metric alert" form (metric picker, field switching,
// create / list / pause / delete in students/{uid}/metricAlerts, options metrics saved as zoroAlerts), the GEX Levels settings "Alerts"
// group (one doc ind-gex-SPX / ind-zone-SPX, no write on load, off deletes), Pro gate for GEX metrics, free crypto metrics, 20 cap.
//   node tools/tests/chart-dev-server.mjs 8198 &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8198 node tools/tests/metric-alerts-browser.js [shotsDir]
// No market data is needed: alerts are only stored here (the server engine checks them; tools/tests/metric-alerts-test.py).
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8198';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// in-memory metricAlerts + zoroAlerts under students/{uid}
const mem = () => {
  const t = setInterval(() => {
    const db = window.__stubDb; if (!db || db.__ma) return;
    clearInterval(t); db.__ma = true;
    window.__mw = [];
    const mk = (name) => {
      const store = new Map(); let n = 0;
      const docRef = (id) => ({ id, get: async () => ({ id, exists: store.has(id), data: () => store.get(id) || {} }),
        set: async (d) => { window.__mw.push(['set', name, id, d]); store.set(id, Object.assign({}, d)); },
        update: async (d) => { window.__mw.push(['update', name, id, d]); store.set(id, Object.assign({}, store.get(id), d)); },
        delete: async () => { window.__mw.push(['delete', name, id]); store.delete(id); } });
      return { store, col: { doc: (id) => docRef(id || name.slice(0, 2) + String(++n).padStart(18, '0')),
        get: async () => ({ docs: [...store].map(([id, d]) => ({ id, data: () => d })), size: store.size, empty: !store.size, forEach(f) { this.docs.forEach(f); } }),
        orderBy() { return this; }, limit() { return this; }, where() { return this; }, onSnapshot(cb) { cb(this.__snap()); return () => {}; },
        __snap() { return { docs: [...store].map(([id, d]) => ({ id, data: () => d })), size: store.size, empty: !store.size, forEach(f) { this.docs.forEach(f); } }; } } };
    };
    const M = mk('metricAlerts'), Z = mk('zoroAlerts');
    window.__mStore = M.store; window.__zStore = Z.store;
    const orig = db.collection;
    db.collection = (name) => {
      const c = orig(name);
      if (name !== 'students') return c;
      const od = c.doc;
      return Object.assign({}, c, { doc: (uid) => { const d = od(uid); const oc = d.collection; return Object.assign({}, d, { collection: (sub) => (sub === 'metricAlerts' ? M.col : sub === 'zoroAlerts' ? Z.col : oc(sub)) }); } });
    };
  }, 0);
};

async function open(b, { w, h, mobile, theme, free }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(mem);
  await ctx.addInitScript(([theme, free]) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', theme === 'light' ? 'day' : 'night'); } catch (e) {} window.__stkChartTestFree = !!free; window.__toasts = []; window.__upg = []; const t = setInterval(() => { if (window.showToast && !window.showToast.__w) { const o = window.showToast; window.showToast = (ty, m) => { window.__toasts.push(String(m)); return o(ty, m); }; window.showToast.__w = 1; } window.openPlanUpgradeModal = (why) => window.__upg.push(why); }, 50); }, [theme, free]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|binance|WebSocket|net::|status of 4|status of 5|opt-analytics|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.__stkAlerts, null, { timeout: 60000 });
  await sleep(2500);
  if (theme === 'light') await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol('IDX:SPX'); });
  await sleep(2500);
  return { ctx, p, errors };
}
const writes = (p) => p.evaluate(() => window.__mw.slice());
const formState = (p) => p.evaluate(() => {
  const f = document.querySelector('#stk-al .stk-al-mform'); if (!f || f.hidden) return null;
  const vis = [...f.querySelectorAll('[data-m]')].filter((l) => !l.hidden).map((l) => l.dataset.m);
  const r = f.getBoundingClientRect(), pnl = document.getElementById('stk-al');
  const tooSmall = [...f.querySelectorAll('select,input,button')].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 40).length;
  return { vis, note: f.querySelector('.stk-al-mnote').textContent, l: r.left, r: r.right, vw: innerWidth, sx: pnl.scrollWidth - pnl.clientWidth, tooSmall };
});
const fill = (p, o) => p.evaluate((o) => { const f = document.querySelector('#stk-al .stk-al-mform'); for (const [k, v] of Object.entries(o)) { f[k].value = v; f[k].dispatchEvent(new Event('change', { bubbles: true })); } }, o);
const submit = async (p) => { await p.evaluate(() => document.querySelector('#stk-al .stk-al-mform .stk-al-save').click()); await sleep(900); };
async function shot(p, name) { await p.mouse.move(2, 2).catch(() => {}); await sleep(500); const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('SHOT ' + f); }
const H = (p, fn, arg) => p.evaluate(`(async () => { const ws = window.STRYKER_VELA, cell = ws.cell(ws.context().cells[0].id), h = () => cell.chart.indicators().find((x) => x.nativeType === 'stk_gex'); return (${fn})(${JSON.stringify(arg === undefined ? null : arg)}, cell, h, ws); })()`);

async function run(b, tag, o) {
  const { ctx, p, errors } = await open(b, o);
  const phone = !!o.mobile;
  await p.evaluate(() => window.__stkAlerts.open()); await sleep(900);
  check(await p.evaluate(() => !!document.querySelector('#stk-al .stk-al-mnew')), tag + ': "+ Metric alert" button in the Alerts window');
  await p.evaluate(() => document.querySelector('#stk-al .stk-al-mnew').click()); await sleep(400);
  let fs0 = await formState(p);
  check(fs0 && fs0.vis.join() === 'sym,level,cdir' && /Education only\. Not financial advice\./.test(fs0.note), tag + ': form opens on "Price crosses a GEX level" (symbol, level, direction) ' + JSON.stringify(fs0 && fs0.vis));
  check(fs0 && fs0.l >= 0 && fs0.r <= fs0.vw && fs0.sx <= 1, tag + ': form fits, no sideways scroll');
  if (phone) check(fs0 && fs0.tooSmall === 0, tag + ': every control >= 40 px tall (' + (fs0 && fs0.tooSmall) + ' smaller)');
  await fill(p, { ml: 'em_low' });
  check((await formState(p)).vis.includes('range'), tag + ': expected-move level shows the range picker');
  if (o.free) {
    await submit(p);
    check((await writes(p)).length === 0 && (await p.evaluate(() => window.__upg.length)) > 0, tag + ': FREE member: GEX metric -> upgrade, nothing written');
    await fill(p, { mm: 'funding', mc: 'BTC', mv: 'hl', md: 'above', mval: '0.01' }); await submit(p);
    const w = await writes(p);
    check(w.length === 1 && w[0][1] === 'metricAlerts' && w[0][3].metric === 'funding' && w[0][3].p.venue === 'hl', tag + ': FREE member: crypto funding alert is free ' + JSON.stringify(w[0] && w[0][3]));
    await shot(p, 'ma-' + tag + '-manager.png');
    check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
    await ctx.close(); return;
  }
  // GEX cross on ES -> SPX underlying
  await fill(p, { ml: 'call_wall', ms: 'ES1!', mx: 'up', mf: 'every' });
  await shot(p, 'ma-' + tag + '-form.png');
  await submit(p);
  let w = await writes(p);
  check(w.length === 1 && w[0][0] === 'set' && w[0][1] === 'metricAlerts' && w[0][3].metric === 'gex_cross' && w[0][3].symbol === 'SPX' && JSON.stringify(w[0][3].p) === '{"level":"call_wall","dir":"up"}'
    && Object.keys(w[0][3]).sort().join() === 'active,createdAt,freq,message,metric,p,symbol,updatedAt', tag + ': GEX cross saved (ES -> SPX) ' + JSON.stringify(w[0] && w[0][3]));
  // OI change + funding
  await p.evaluate(() => document.querySelector('#stk-al .stk-al-mnew').click()); await sleep(300);
  await fill(p, { mm: 'oi_change' });
  check((await formState(p)).vis.join() === 'coin,venue,odir,value,mins', tag + ': OI change shows coin, exchange, change, value, minutes');
  await fill(p, { mc: 'eth-usdt-swap', mv: 'okx', mo: 'up', mval: '2.5', mn: '60' }); await submit(p);
  w = await writes(p);
  check(w.length === 2 && w[1][3].symbol === 'ETH' && JSON.stringify(w[1][3].p) === '{"venue":"okx","dir":"up","value":2.5,"mins":60}', tag + ': OI change saved (ETH-USDT-SWAP -> ETH) ' + JSON.stringify(w[1] && w[1][3]));
  // bad value -> toast, no write
  await p.evaluate(() => document.querySelector('#stk-al .stk-al-mnew').click()); await sleep(300);
  await fill(p, { mm: 'funding', mc: 'BTC', mval: '9' }); await submit(p);
  check((await writes(p)).length === 2 && (await p.evaluate(() => window.__toasts.join(' '))).includes('between -5% and 5%'), tag + ': funding 9% refused with a plain message');
  // IV rank -> zoroAlerts iv_rank (one engine per metric)
  await fill(p, { mm: 'iv_rank', ms: 'NVDA', md: 'below', mval: '20' }); await submit(p);
  w = await writes(p);
  check(w.length === 3 && w[2][1] === 'zoroAlerts' && w[2][3].type === 'iv_rank' && w[2][3].symbol === 'NVDA' && JSON.stringify(w[2][3].p) === '{"dir":"below","value":20}', tag + ': IV rank saved as a ZoroOptions iv_rank alert ' + JSON.stringify(w[2] && w[2][3]));
  await sleep(800);
  // list
  let rows = await p.evaluate(() => [...document.querySelectorAll('#stk-al .stk-al-row')].map((r) => r.innerText.replace(/\n/g, ' | ')));
  const cnt = await p.evaluate(() => document.querySelector('#stk-al .stk-al-count').textContent);
  check(rows.some((r) => /SPX crosses above its Call Ceiling/.test(r)) && rows.some((r) => /ETH open interest on OKX up 2\.5% in 60 min/.test(r)) && /2 of 20 metric alerts/.test(cnt), tag + ': both listed, count "2 of 20 metric alerts" ' + JSON.stringify(rows) + ' ' + cnt);
  check(rows.some((r) => /NVDA IV rank moves below 20/.test(r)), tag + ': the IV rank alert is listed with the options alerts');
  await shot(p, 'ma-' + tag + '-manager.png');
  // pause + edit + delete
  await p.evaluate(() => { const r = [...document.querySelectorAll('#stk-al .stk-al-row')].find((x) => /Call Ceiling/.test(x.innerText)); r.querySelector('[data-k=pause]').click(); }); await sleep(700);
  w = await writes(p);
  check(w[w.length - 1][0] === 'update' && w[w.length - 1][3].active === false, tag + ': Pause writes active:false');
  await p.evaluate(() => { const r = [...document.querySelectorAll('#stk-al .stk-al-row')].find((x) => /ETH open/.test(x.innerText)); r.querySelector('[data-k=edit]').click(); }); await sleep(400);
  const ed = await p.evaluate(() => { const f = document.querySelector('#stk-al .stk-al-mform'); return { mm: f.mm.value, dis: f.mm.disabled, v: f.mval.value, n: f.mn.value }; });
  check(ed.mm === 'oi_change' && ed.dis && ed.v === '2.5' && ed.n === '60', tag + ': Edit fills the form, metric fixed ' + JSON.stringify(ed));
  await fill(p, { mval: '5' }); await submit(p);
  w = await writes(p);
  check(w[w.length - 1][0] === 'update' && w[w.length - 1][3].p.value === 5 && (await p.evaluate(() => window.__mStore.size)) === 2, tag + ': Save updates the same doc');
  await p.evaluate(() => { const r = [...document.querySelectorAll('#stk-al .stk-al-row')].find((x) => /ETH open/.test(x.innerText)); r.querySelector('[data-k=del]').click(); }); await sleep(700);
  check((await p.evaluate(() => window.__mStore.size)) === 1, tag + ': Delete removes it');
  // 20 cap
  const cap = await p.evaluate(async () => { const m = await import('/assets/chart-metric-alerts.js?v=913'); let e = null; for (let i = 0; i < 20 && !e; i++) { try { await m.save(m.buildMetric({ metric: 'funding', symbol: 'C' + i, venue: 'okx', dir: 'above', value: 0.1 }), null); } catch (x) { e = x; } } return [m.metricAlerts().length, e && e.full]; });
  check(cap[0] === 20 && cap[1] === 20, tag + ': the 21st metric alert is refused ' + JSON.stringify(cap));
  await p.evaluate(async () => { const m = await import('/assets/chart-metric-alerts.js?v=913'); for (const a of m.metricAlerts().filter((x) => /^C\d/.test(x.symbol))) await m.remove(a); });
  await p.evaluate(() => window.__stkAlerts.close && window.__stkAlerts.close());
  await p.keyboard.press('Escape').catch(() => {});
  // GEX Levels settings group
  const n0 = (await writes(p)).length;
  await p.evaluate(() => { window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator('stk_gex', { inputs: {} }); window.STRYKER_VELA.context().stateChanged(); }); await sleep(2500);
  check((await writes(p)).length === n0, tag + ': adding GEX Levels with alerts off writes nothing');
  await H(p, '(x, c, h) => { const n = c.chart.renderer.inputsUI ? c.chart.renderer : c.chart.renderer.renderer; n.inputsUI.openDialog(h().id); }').catch(() => {});
  await sleep(1200);
  const dlg = await p.evaluate(() => { const d = document.querySelector('.vela-ind-dialog'); if (!d) return null; const hd = [...d.querySelectorAll('*')].find((n) => n.children.length === 0 && (n.textContent || '').trim() === 'Alerts'); if (hd) hd.scrollIntoView({ block: 'start' }); const r = d.getBoundingClientRect(); return { t: d.innerText.replace(/\s+/g, ' '), hd: !!hd, l: r.left, r: r.right, vw: innerWidth }; });
  check(dlg && dlg.hd && /Alert when price crosses a level/.test(dlg.t) && /Alert when the gamma regime flips/.test(dlg.t) && !/Only once, then turn/.test(dlg.t), tag + ': GEX Levels settings have an Alerts group (sub-options hidden while off)');
  check(dlg && dlg.l >= 0 && dlg.r <= dlg.vw, tag + ': settings fit the screen');
  const sw = await p.evaluate(() => { const s = document.querySelector('.vela-ind-dialog [id$="-alertCross"]'); if (!s) return false; s.click(); return true; }); await sleep(1500);
  w = (await writes(p)).slice(n0);
  check(sw && w.length === 1 && w[0][0] === 'set' && w[0][2] === 'ind-gex-SPX' && w[0][3].p.level === 'gamma_flip' && w[0][3].freq === 'every', tag + ': switch on -> one doc ind-gex-SPX (Flip Line, every time) ' + JSON.stringify(w));
  await sleep(300);
  await p.evaluate(() => { const d = document.querySelector('.vela-ind-dialog'); const hd = [...d.querySelectorAll('*')].find((n) => n.children.length === 0 && (n.textContent || '').trim() === 'Alerts'); if (hd) hd.scrollIntoView({ block: 'start' }); });
  await shot(p, 'ma-' + tag + '-settings.png');
  await H(p, '(x, c, h) => { h().setInputs(Object.assign(h().inputValues(), { alertLevel: "Put Floor (put wall)", alertDir: "Crossing down", alertRegime: true })); }'); await sleep(1800);
  w = (await writes(p)).slice(n0);
  const up = w.filter((x) => x[0] === 'update' && x[2] === 'ind-gex-SPX').pop(), zr = w.find((x) => x[1] === 'zoroAlerts' && x[2] === 'ind-zone-SPX');
  check(up && JSON.stringify(up[3].p) === '{"level":"put_wall","dir":"down"}' && zr && zr[3].type === 'zone_change' && (await p.evaluate(() => window.__mStore.has('ind-gex-SPX'))), tag + ': edit updates the same doc + regime adds ind-zone-SPX ' + JSON.stringify([up, zr]));
  const nn = (await writes(p)).length;
  await H(p, '(x, c, h) => { h().setInputs(Object.assign(h().inputValues(), { showStatus: false })); }'); await sleep(1500);
  check((await writes(p)).length === nn, tag + ': an unrelated settings change writes nothing');
  await H(p, '(x, c, h) => { h().setInputs(Object.assign(h().inputValues(), { alertCross: false, alertRegime: false })); }'); await sleep(1800);
  check(!(await p.evaluate(() => window.__mStore.has('ind-gex-SPX') || window.__zStore.has('ind-zone-SPX'))), tag + ': both off -> both docs deleted');
  const words = await p.evaluate(() => (document.getElementById('stk-al') || {}).textContent + ' ' + ((document.querySelector('.vela-ind-dialog') || {}).textContent || ''));
  check(!/\blive\b|real-time|realtime|delayed|okx|hyperliquid.*api|insight|vela|luxalgo/i.test(words.replace(/OKX|Hyperliquid/g, '')), tag + ': no live / real-time / delayed / vendor wording');
  check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
  await ctx.close();
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const runs = [['1440-dark', { w: 1440, h: 900, theme: 'dark' }], ['390-dark', { w: 390, h: 844, mobile: true, theme: 'dark' }],
      ['412-dark', { w: 412, h: 915, mobile: true, theme: 'dark' }], ['1440-light', { w: 1440, h: 900, theme: 'light' }],
      ['390-free', { w: 390, h: 844, mobile: true, theme: 'dark', free: true }]];
    const only = process.env.ONLY;
    for (const [t, o] of runs) if (!only || only.split(',').includes(t)) await run(b, t, o);
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
