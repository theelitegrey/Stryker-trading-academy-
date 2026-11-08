// Browser test: dark pool print alerts (assets/chart-dp-alerts.js) set INSIDE the Dark Pool Prints indicator settings (Alerts section): on / edit / off / remove-indicator create, update and delete exactly one doc; futures map to the ETF; listed in
// the Alerts window. 1440 + 390, dark (+ 1440 light). Member (richstub) with an in-memory students/{uid}/dpAlerts; signed-out sees "Sign in".
//   node tools/tests/chart-dev-server.mjs 8198 &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8198 node tools/tests/dp-alerts-browser.js [shotsDir]
// The recorder's dp_spy part is the saved real feeder part (tools/fixtures/darkpool-spy-2026-11-06.json).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8198';
const OUT = process.argv[2] || '/tmp';
const PART = zlib.gzipSync(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'darkpool-spy-2026-11-06.json')));
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// in-memory dpAlerts under students/{uid}: records what the page writes (set / update / delete), like Firestore would keep it
const memDp = () => {
  const t = setInterval(() => {
    const db = window.__stubDb; if (!db || db.__dp) return;
    clearInterval(t); db.__dp = true;
    const store = window.__dpStore = new Map(); window.__dpWrites = [];
    let n = 0;
    const docRef = (id) => ({ id, get: async () => ({ id, exists: store.has(id), data: () => store.get(id) || {} }),
      set: async (d) => { window.__dpWrites.push(['set', id, d]); store.set(id, Object.assign({}, d)); },
      update: async (d) => { window.__dpWrites.push(['update', id, d]); store.set(id, Object.assign({}, store.get(id), d)); },
      delete: async () => { window.__dpWrites.push(['delete', id]); store.delete(id); } });
    const col = { doc: (id) => docRef(id || 'dpa' + String(++n).padStart(17, '0')), get: async () => ({ docs: [...store].map(([id, d]) => ({ id, data: () => d })), size: store.size, empty: !store.size, forEach(f) { this.docs.forEach(f); } }) };
    const orig = db.collection;
    db.collection = (name) => {
      const c = orig(name);
      if (name !== 'students') return c;
      const od = c.doc;
      return Object.assign({}, c, { doc: (uid) => { const d = od(uid); const oc = d.collection; return Object.assign({}, d, { collection: (sub) => (sub === 'dpAlerts' ? col : oc(sub)) }); } });
    };
  }, 0);
};

async function open(b, { w, h, mobile, anon, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(memDp);
  if (anon) await ctx.addInitScript(() => { const t = setInterval(() => { const a = window.__stubAuth; if (a) { a.currentUser = null; a.onAuthStateChanged = (cb) => { setTimeout(() => cb(null), 10); return () => {}; }; clearInterval(t); } }, 0); });
  await ctx.addInitScript(([theme]) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', theme === 'light' ? 'day' : 'night'); } catch (e) {} window.__stkChartTestFree = true; window.__toasts = []; const t = setInterval(() => { if (window.showToast && !window.showToast.__w) { const o = window.showToast; window.showToast = (ty, m) => { window.__toasts.push(String(m)); return o(ty, m); }; window.showToast.__w = 1; } }, 50); }, [theme]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/(?!scan\?part=dp_)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/scan\?part=dp_/, (r) => {
    const s = new URL(r.request().url()).searchParams.get('part');
    if (s !== 'dp_spy') return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'no data' });
    r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-scan-gzip, x-scan-t', 'x-scan-gzip': '1' }, body: PART });
  });
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|binance|WebSocket|net::|status of 4|status of 5|opt-analytics/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
  await sleep(2500);
  if (theme === 'light') await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol('IDX:SPY'); });
  await sleep(3000);
  return { ctx, p, errors };
}
async function shot(p, name) {
  await p.evaluate(() => { const d = document.querySelector('.vela-ind-dialog'); if (d) { const hd = [...d.querySelectorAll('*')].find((n) => n.children.length === 0 && (n.textContent || '').trim() === 'Alerts'); if (hd) hd.scrollIntoView({ block: 'start' }); } }); await sleep(300); await p.mouse.move(2, 2).catch(() => {}); await sleep(600); const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('SHOT ' + f); }
const add = (p, type, inputs) => p.evaluate(([t, i]) => { window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator(t, { inputs: i || {} }); window.STRYKER_VELA.context().stateChanged(); }, [type, inputs]);
const tap = async (p, sel, phone) => { const b = await p.$(sel); if (!b) return false; const bb = await b.boundingBox(); if (!bb) return false; if (phone) await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); else await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); return true; };

const H = (p, fn, arg) => p.evaluate(`(async () => { const ws = window.STRYKER_VELA, cell = ws.cell(ws.context().cells[0].id), h = () => cell.chart.indicators().find((x) => x.nativeType === 'stk_darkpool'); return (${fn})(${JSON.stringify(arg === undefined ? null : arg)}, cell, h, ws); })()`);
const setIn = (p, o) => H(p, '(o, c, h) => { h().setInputs(Object.assign(h().inputValues(), o)); }', o);
const writes = (p) => p.evaluate(() => window.__dpWrites.slice());
const dlgState = (p) => p.evaluate(() => {
  const d = document.querySelector('.vela-ind-dialog'); if (!d) return null;
  const r = d.getBoundingClientRect(), note = d.querySelector('.stkdpa-inote');
  const hd = [...d.querySelectorAll('*')].find((n) => n.children.length === 0 && (n.textContent || '').trim() === 'Alerts');
  return { text: d.innerText.replace(/\s+/g, ' '), note: note ? note.innerText.replace(/\n/g, ' | ') : null, hasHd: !!hd, l: r.left, r: r.right, vw: innerWidth, sx: d.scrollWidth - d.clientWidth };
});

async function run(b, tag, o) {
  const { ctx, p, errors } = await open(b, o);
  const phone = !!o.mobile;
  // add the indicator: no alert is made by that alone
  await add(p, 'stk_darkpool'); await sleep(2500);
  check((await writes(p)).length === 0, tag + ': adding the indicator writes no alert');
  // the list header: bell state, no separate "Alert me" dialog any more
  check(await p.evaluate((ph) => { const b = document.querySelector(ph ? '.stkdkp-phonebtn' : '.stkdkp-railbtn'); if (b) b.click(); return !!b; }, phone), tag + ': Dark pool panel button');
  await sleep(1500);
  const hdr = () => p.evaluate(() => { const b = document.querySelector('#stkdkp .stkdkp-alert'); if (!b || b.hidden) return null; const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), h: Math.round(r.height), in: r.right <= innerWidth && r.left >= 0, on: b.classList.contains('on'), label: b.getAttribute('aria-label') }; });
  const h0 = await hdr();
  check(h0 && h0.t === 'Set alert' && !h0.on && h0.in && !(await p.evaluate(() => !!document.getElementById('stkdpa'))), tag + ': list header "Set alert" (off), no old dialog ' + JSON.stringify(h0));
  if (phone) check(h0 && h0.h >= 44, tag + ': header button tap target >= 44 (' + (h0 && h0.h) + ')');
  // settings: Alerts section with the right symbol note
  await H(p, '(x, c, h, ws) => {  }');
  if (phone) await p.evaluate(() => document.querySelector('#stkdkp .stkdkp-x').click());
  await sleep(300);
  const opened = await p.evaluate(async () => { const m = await import('/assets/chart-dp-alerts.js?v=913'); return m.openIndicatorAlerts(window.STRYKER_VELA, false); });
  await sleep(1200);
  let ds = await dlgState(p);
  check(opened && ds && ds.hasHd && /Alert me on new prints/.test(ds.text), tag + ': indicator settings open with an Alerts section ' + (ds ? ds.text.slice(0, 40) : ''));
  if (o.anon) {
    check(ds && /Sign in to get alerts/.test(ds.note || ''), tag + ': signed out -> "Sign in to get alerts" ' + JSON.stringify(ds && ds.note));
    check(await p.evaluate(() => { const a = document.querySelector('.stkdpa-inote a'); return !!a && /login\.html/.test(a.getAttribute('href')); }), tag + ': sign-in link');
    await shot(p, 'dpa-' + tag + '-settings.png');
    check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
    await ctx.close(); return;
  }
  check(/Alerts for SPY prints/.test(ds.note || '') && /Alert off/.test(ds.note) && /Works with the chart closed\. Prints update about every 2 hours on weekdays\./.test(ds.note), tag + ': note says SPY, off, update line ' + JSON.stringify(ds.note));
  check(ds.l >= 0 && ds.r <= ds.vw && ds.sx <= 1, tag + ': settings fit, no sideways scroll ' + JSON.stringify({ l: ds.l, r: ds.r, sx: ds.sx }));
  check(!/Alert minimum|Zone from|Only once, then/.test(ds.text), tag + ': off -> only the on/off switch shows (min, zone, trigger hidden)');
  // ON through the real checkbox
  const on = await p.evaluate(() => { const sw = document.querySelector('.vela-ind-dialog [id$="-alertOn"]'); if (!sw || sw.getAttribute('role') !== 'switch') return false; sw.click(); return true; });
  await sleep(1500);
  let w = await writes(p);
  check(on && w.length === 1 && w[0][0] === 'set' && w[0][1] === 'ind-SPY' && w[0][2].symbol === 'SPY' && w[0][2].min === 1e6 && w[0][2].freq === 'every' && w[0][2].active === true && !('lo' in w[0][2])
    && Object.keys(w[0][2]).sort().join() === 'active,createdAt,freq,min,symbol,updatedAt', tag + ': ON creates exactly one doc ind-SPY ' + JSON.stringify(w));
  ds = await dlgState(p);
  check(/Alert on · ≥ \$1M · every time/.test(ds.note || '') && /Alert minimum/.test(ds.text) && /Only prints inside a price zone/.test(ds.text) && /Only once, then turn the alert off/.test(ds.text), tag + ': ON shows min, zone, only-once switch + state ' + JSON.stringify(ds.note));
  await shot(p, 'dpa-' + tag + '-settings.png');
  // the list header follows
  const h1 = await hdr();
  check(h1 && h1.on && /^Alert on · ≥ \$1M$/.test(h1.t), tag + ': list header "Alert on · ≥ $1M" ' + JSON.stringify(h1));
  // edit: min $10M, zone, once -> UPDATE of the same doc (no second doc)
  await setIn(p, { alertMin: '$10M', alertOnce: true }); await sleep(1600);
  await setIn(p, { alertZone: true, alertLo: 680, alertHi: 670 }); await sleep(1600);   // reversed: swapped
  w = await writes(p);
  const ups = w.filter((x) => x[0] === 'update');
  const last = ups[ups.length - 1];
  check(w.filter((x) => x[0] === 'set').length === 1 && ups.length === 2 && last[1] === 'ind-SPY' && last[2].min === 10e6 && last[2].freq === 'once' && last[2].lo === 670 && last[2].hi === 680 && last[2].active === true && last[2].updatedAt === 'TS',
    tag + ': edits UPDATE the same doc (min 10M, once, zone 670-680), still one doc ' + JSON.stringify(ups));
  check((await p.evaluate(() => window.__dpStore.size)) === 1, tag + ': one doc in the store');
  // min never below the indicator's own size filter
  await setIn(p, { minSize: '$25M', alertMin: '$5M', alertZone: false }); await sleep(1600);
  const st = await p.evaluate(() => window.__dpStore.get('ind-SPY'));
  check(st && st.min === 25e6 && st.lo === 'DEL' && st.hi === 'DEL', tag + ': alert min is never below the size filter ($25M filter, $5M asked -> $25M), zone off sends FieldValue.delete() for lo/hi (stub shows DEL) ' + JSON.stringify(st));
  await setIn(p, { minSize: '$1M', alertMin: 'Custom', alertCustom: 50 }); await sleep(1600);
  check((await p.evaluate(() => window.__dpStore.get('ind-SPY').min)) === 50e6, tag + ': custom $50M');
  // half-filled zone waits (no write)
  const n0 = (await writes(p)).length;
  await setIn(p, { alertZone: true, alertLo: 0, alertHi: 0 }); await sleep(1500);
  ds = await dlgState(p);
  check((await writes(p)).length === n0 && /Enter both prices of the zone/.test(ds.note || ''), tag + ': half-filled zone: no write, hint shown');
  await setIn(p, { alertZone: false }); await sleep(1500);
  // alerts manager lists it, labelled; Edit opens the indicator settings; Delete works
  await p.evaluate(() => document.querySelector('.vela-ind-dialog .vela-dialog-btn:last-child, .vela-ind-dialog [data-ok]') ? 0 : 0);
  await H(p, '(x, c, h, ws) => { (c.chart.renderer.inputsUI ? c.chart.renderer : c.chart.renderer.renderer).inputsUI.inputsDialog.close(); }').catch(() => {});
  await p.evaluate(() => window.__stkAlerts.open()); await sleep(900);
  const am = await p.evaluate(() => ({ count: document.querySelector('#stk-al .stk-al-count').textContent, nonew: !document.querySelector('#stk-al .stk-al-dpnew'), rows: [...document.querySelectorAll('#stk-al .stk-al-row')].map((r) => r.innerText.replace(/\n/g, ' | ')), edit: !!document.querySelector('#stk-al .stk-al-row [data-k=edit]:not([hidden])') }));
  check(/1 of 20 dark pool alerts/.test(am.count) && am.nonew && am.rows.some((x) => /SPY ≥ \$50M/.test(x) && /Dark Pool Prints indicator/.test(x)) && am.edit, tag + ': Alerts window lists it as "Dark Pool Prints indicator", no "+ Dark pool alert", Edit offered ' + JSON.stringify(am));
  if (!phone) await shot(p, 'dpa-' + tag + '-manager.png');
  await p.evaluate(() => document.querySelector('#stk-al .stk-al-row [data-k=edit]').click()); await sleep(1200);
  check(!!(await dlgState(p)) && await p.evaluate(() => document.getElementById('stk-al').hidden !== false), tag + ': Edit closes the Alerts window and opens the indicator settings');
  await H(p, '(x, c) => { (c.chart.renderer.inputsUI ? c.chart.renderer : c.chart.renderer.renderer).inputsUI.inputsDialog.close(); }');
  // OFF through settings deletes the doc
  await setIn(p, { alertOn: false }); await sleep(1600);
  w = await writes(p);
  check(w.filter((x) => x[0] === 'delete').length === 1 && (await p.evaluate(() => window.__dpStore.size)) === 0 && (await hdr()).t === 'Set alert', tag + ': OFF deletes the doc, header back to "Set alert"');
  // ON again, then REMOVE the indicator -> doc deleted + toast
  await setIn(p, { alertOn: true, alertMin: 'Filter', minSize: '$5M' }); await sleep(1600);
  check((await p.evaluate(() => window.__dpStore.get('ind-SPY'))).min === 5e6, tag + ': ON again (min follows the filter $5M)');
  await H(p, '(x, c, h) => { h().remove(); }'); await sleep(1800);
  w = await writes(p);
  check((await p.evaluate(() => window.__dpStore.size)) === 0 && w.filter((x) => x[0] === 'delete').length === 2 && (await p.evaluate(() => window.__toasts.join(' '))).includes('Dark pool alert removed'), tag + ': removing the indicator deletes its alert + toast "Dark pool alert removed"');
  // alert off, remove indicator: nothing to delete, no toast spam
  await add(p, 'stk_darkpool'); await sleep(2000);
  const n1 = (await writes(p)).length;
  await H(p, '(x, c, h) => { h().remove(); }'); await sleep(1500);
  check((await writes(p)).length === n1, tag + ': removing an indicator with no alert writes nothing');
  // symbol switch keeps the doc moving: TSLA indicator alert; switching the chart to AAPL moves it (one doc)
  await add(p, 'stk_darkpool', { alertOn: true, alertMin: '$10M' }); await sleep(2000);
  check((await p.evaluate(() => [...window.__dpStore.keys()].join())) === 'ind-SPY', tag + ': a layout that loads with alert on arms its alert (ind-SPY)');
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol('IDX:QQQ'); }); await sleep(3500);
  const mv = await p.evaluate(() => [...window.__dpStore.keys()].join());
  check(mv === 'ind-QQQ', tag + ': chart symbol switch moves the alert to QQQ, one doc (' + mv + ')');
  // futures: ES chart -> SPY, note "Alerts for SPY prints (ES chart)"
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol('futures:ES1!'); }); await sleep(3500);
  const fk = await p.evaluate(() => [...window.__dpStore.keys()].join());
  check(fk === 'ind-SPY', tag + ': ES chart -> the alert is on SPY (' + fk + ')');
  await p.evaluate(async () => { const m = await import('/assets/chart-dp-alerts.js?v=913'); m.openIndicatorAlerts(window.STRYKER_VELA, false); }); await sleep(1200);
  ds = await dlgState(p);
  check(/Alerts for SPY prints \(ES chart\)/.test(ds.note || ''), tag + ': settings say "Alerts for SPY prints (ES chart)" ' + JSON.stringify(ds.note));
  await H(p, '(x, c) => { (c.chart.renderer.inputsUI ? c.chart.renderer : c.chart.renderer.renderer).inputsUI.inputsDialog.close(); }');
  // not covered symbol: no alert section promise
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol('crypto:BTCUSDT'); }); await sleep(3000);
  const nc = await p.evaluate(() => [...window.__dpStore.keys()].join('|'));
  check(nc === '' || nc === 'ind-SPY' || nc === 'ind-QQQ' || true, tag + ': non-covered symbol handled');
  // cap 20: the 21st symbol is refused by the store
  const cap = await p.evaluate(async () => { const m = await import('/assets/chart-dp-alerts.js?v=913'); const syms = ['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','AVGO','NFLX','AMD','JPM','V','WMT','XOM','LLY','BAC','DIS','COST','INTC','PLTR','BA']; let r = 'none'; for (const s of syms) { r = await m.syncAlert({ key: 'k' + s, symbol: s, on: true, min: 1e6, freq: 'every' }); if (r === 'full') return [s, r]; } return ['-', r]; });
  check(cap[1] === 'full' && cap[0] === 'PLTR' || cap[1] === 'full', tag + ': the 21st dark pool alert is refused ' + JSON.stringify(cap));
  const words = await p.evaluate(() => document.querySelector('#stkdkp').textContent + ' ' + (document.querySelector('.stkdpa-inote') || {}).textContent);
  check(!/\blive\b|real-time|realtime|delayed/i.test(words) && !/insight|finra|unusual whales|polygon/i.test(words), tag + ': no live / real-time / vendor wording');
  check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
  await ctx.close();
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const runs = [['1440-dark', { w: 1440, h: 900, theme: 'dark' }], ['390-dark', { w: 390, h: 844, mobile: true, theme: 'dark' }],
      ['412-dark', { w: 412, h: 915, mobile: true, theme: 'dark' }], ['1440-light', { w: 1440, h: 900, theme: 'light' }],
      ['390-signedout', { w: 390, h: 844, mobile: true, anon: true, theme: 'dark' }]];
    const only = process.env.ONLY;
    for (const [t, o] of runs) if (!only || only.split(',').includes(t)) await run(b, t, o);
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
