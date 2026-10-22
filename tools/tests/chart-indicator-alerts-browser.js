// Indicator alerts like TradingView (Owner 2026-10-22: "why getting alerts for indicators, add alert
// setting to indicators like tradingview as well"). NO live data: /api/chart/bars is answered from a
// seeded synthetic NQ series generated here (fixture), every other outside request is aborted, the
// stream WebSocket has no server (the provider falls back to polling the fixture).
//   python3 -m http.server 8147 --bind 127.0.0.1   (repo root, any free port)
//   CHART_BASE=http://127.0.0.1:8147 node tools/tests/chart-indicator-alerts-browser.js [shotsDir]
// Run under: systemd-run --user --scope -q -p MemoryMax=1400M flock /tmp/stryker-chrome.lock node ...
// Checks:
//  1. Volume Bubbles on the chart + live fixture bars with big volume: NO toast, NO sound (default off),
//     even though the script's alertcondition() calls reach the alert router.
//  2. The Create alert dialog lists Price, then "Volume Bubbles → Big Cluster / Med+ Cluster / Any Cluster"
//     (+ plots); the TV trigger options; message prefilled from the script; expiration; popup/sound.
//  3. Legend-row bell "Add alert…" and the settings window "Add alert…" open the form with it preselected.
//  4. Create "Big Cluster" (Once per bar): one big-volume fixture bar → exactly one toast; more ticks of
//     the same bar → still one; the next big bar → a second one. Once per bar close fires only after the
//     next bar opens. Pause → silent; Delete → silent. Saved per user (localStorage) and survives reload.
//  5. 1440 + 390 screenshots of the dialog.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8147';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };

// ---- fixture: deterministic NQ-like bars for any requested page ----
const PAGE = { '1': 8 * 3600, '5': 2 * 86400, '15': 5 * 86400, '60': 20 * 86400 };
function rnd(seed){ let x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); }
function fixtureBars(tf, page){
  const step = (tf === 'D' ? 1440 : Number(tf) || 5) * 60;
  const P = PAGE[tf] || 2 * 86400;
  const from = page * P, now = Math.floor(Date.now() / 1000) - (step >= 300 ? 3 * 3600 : 0); // 5m+ history ends 3 h back: pushed live bars keep real 1m data under them (lower-TF request)
  const to = Math.min((page + 1) * P, now);
  const out = [];
  for (let t = Math.ceil(from / step) * step; t < to; t += step) {
    const i = t / step;
    const base = 21000 + 400 * Math.sin(t / 86400 / 3) + 60 * Math.sin(t / 7200);
    const o = Math.round((base + (rnd(i) - 0.5) * 20) * 4) / 4;
    const c = Math.round((o + (rnd(i + 1) - 0.5) * 24) * 4) / 4;
    const h = Math.max(o, c) + Math.round(rnd(i + 2) * 8 * 4) / 4, l = Math.min(o, c) - Math.round(rnd(i + 3) * 8 * 4) / 4;
    out.push([t, o, h, l, c, Math.round(800 + rnd(i + 4) * 600)]);
  }
  return out;
}

async function open(b, w, h, mobile){
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', JSON.stringify({ _anon: 1, u1: 1 })); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/\/api\/chart\/bars\//, (r) => {
    const u = new URL(r.request().url());
    const tf = u.searchParams.get('tf') || '5', page = Number(u.searchParams.get('page') || 0);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bars: fixtureBars(tf, page), rt: false }) });
  });
  await ctx.route(/\/api\/(?!chart\/bars)/, (r) => r.fulfill({ status: 404, body: '{}' }));
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e)); });  // richstub onSnapshot has no docChanges (existing alertFires listener)
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await setup(p);
  return { ctx, p, errors };
}
async function setup(p){
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE && window.__stkAlerts && window.__stkIndAlerts, null, { timeout: 60000 });
  await p.evaluate(async () => {
    const ws = window.STRYKER_VELA; const c = ws.cell(ws.active.id);
    if (c.symbol !== 'futures:NQ1!') c.setSymbol('futures:NQ1!');
    c.setTimeframe('5');
    const chart = ws.context().cells[0].chart;
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 400)); try { if (chart.orchestrator.rawBars.length > 200 && chart.orchestrator.historyState !== 'backfill') break; } catch (e) {} }
  });
  // count every toast path: our alert toasts, Vela's toast host, the app's showToast
  await p.evaluate(() => {
    window.__toasts = [];
    const ob = new MutationObserver(() => {
      document.querySelectorAll('.stk-al-toast:not([data-seen])').forEach((t) => { t.dataset.seen = '1'; window.__toasts.push('stk:' + t.textContent); });
      document.querySelectorAll('.vela-toast[data-open]:not([data-seen])').forEach((t) => { t.dataset.seen = '1'; window.__toasts.push('vela:' + t.textContent); });
    });
    ob.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-open'] });
    const st = window.showToast; window.showToast = function(){ window.__toasts.push('app:' + [...arguments].map(String).join('|')); return st && st.apply(this, arguments); };
    window.__routed = 0; const ev = window.__stkIndAlerts.event; window.__stkIndAlerts.event = (e) => { if (e.kind === 'alert') window.__routed++; return ev(e); };
  });
}
const addBubbles = (p) => p.evaluate(async () => {
  window.__vb = 1;
  const m = await import('/assets/chart-pine-builtins.js?v=' + document.querySelector('meta[name=stryker-build]').content);
  const src = await m.builtinSource('volume-bubbles-quantalgo');
  const r = await window.STRYKER_PINE.addSource('Volume Bubbles [QuantAlgo]', src, { engine: 'next', builtin: true });
  const chart = window.STRYKER_VELA.context().cells[0].chart;
  for (let i = 0; i < 80; i++) {
    await new Promise((r2) => setTimeout(r2, 500));
    const ind = (chart.inspect().indicators || []).find((x) => /Volume Bubbles/.test(x.title || ''));
    if (ind && ((ind.labels || 0) + Object.keys(ind.series || {}).length) > 0) return { ok: r.ok, msg: r.msg, ms: i * 500 };
  }
  return { ok: false, msg: 'no drawing', r };
});
// Push live bars: a big-volume new bar (time = last + 5m) then ticks of it, through the same seam a
// live feed uses (orchestrator.onBar).
const pushBar = (p, opt) => p.evaluate(async (o) => {
  const chart = window.STRYKER_VELA.context().cells[0].chart; const O = chart.orchestrator;
  const last = O.rawBars[O.rawBars.length - 1];
  const t = o.same ? last.time : last.time + 300000;
  const c = last.close + (o.up ? 6 : -6);
  O.onBar({ time: t, open: o.same ? last.open : last.close, high: Math.max(last.close, c) + 2, low: Math.min(last.close, c) - 2, close: c, volume: o.vol });
  await new Promise((r) => setTimeout(r, o.wait || 4500));
  return { t, toasts: window.__toasts.slice(), routed: window.__routed, fires: window.__stkIndAlertFires };
}, opt);

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  let { ctx, p, errors } = await open(b, 1440, 900, false);
  const add = await addBubbles(p);
  check(add.ok, 'Volume Bubbles added to the fixture NQ1! 5m chart', add);
  await p.waitForTimeout(2500);
  await p.evaluate(() => { window.__toasts.length = 0; });
  // 1. default: silent
  let r = await pushBar(p, { vol: 500000, up: true });
  r = await pushBar(p, { vol: 900000, up: false });
  check(r.routed > 0, 'the script\'s alertcondition() calls reach the alert router on live bars', r);
  check(r.toasts.length === 0, 'DEFAULT: no toast for Volume Bubbles alertconditions (no alert created)', r.toasts);
  const beeps0 = await p.evaluate(() => window.__stkAlertBeeps || 0);
  check(beeps0 === 0, 'DEFAULT: no alert sound', beeps0);

  // 2. dialog contents
  const dlg = await p.evaluate(() => {
    window.__stkAlerts.open({ symbol: 'futures:NQ1!', src: { kind: 'cond', title: 'Volume Bubbles [QuantAlgo]', pick: true } });
    const f = document.querySelector('.stk-al-form');
    const opts = [...f.src.options].map((o) => o.textContent);
    return { opts, sel: f.src.options[f.src.selectedIndex].textContent, freqs: [...f.freq.options].map((o) => o.textContent), freq: f.freq.value, msg: f.message.value, exp: [...f.expires.options].map((o) => o.textContent), expHidden: f.querySelector('.stk-al-xw').hidden, notify: !f.querySelector('.stk-al-nw').hidden, popup: f.popup.checked, sound: f.sound.checked, priceHidden: f.querySelector('.stk-al-pw').hidden };
  });
  check(dlg.opts[0] === 'Price', 'Condition list starts with Price', dlg.opts);
  for (const t of ['Big Cluster', 'Med+ Cluster', 'Any Cluster']) check(dlg.opts.includes('Volume Bubbles [QuantAlgo] \u2192 ' + t), 'Condition list has Volume Bubbles \u2192 ' + t);
  check(dlg.sel === 'Volume Bubbles [QuantAlgo] \u2192 Big Cluster', 'indicator preselected (its first condition)', dlg.sel);
  check(dlg.freqs.join('|') === 'Only once|Once per bar|Once per bar close' && dlg.freq === 'bar', 'Trigger options like TradingView, default Once per bar', dlg);
  check(dlg.msg === 'Big volume cluster detected!', 'Message prefilled from the alertcondition message', dlg.msg);
  check(!dlg.expHidden && dlg.exp[0] === 'Open-ended' && dlg.notify && dlg.popup && dlg.sound && dlg.priceHidden, 'Expiration + popup/sound shown, price hidden', dlg);
  const msg2 = await p.evaluate(() => { const f = document.querySelector('.stk-al-form'); f.src.value = String([...f.src.options].findIndex((o) => /Any Cluster/.test(o.textContent)) - 1); f.src.onchange(); const m = f.message.value; f.src.value = String([...f.src.options].findIndex((o) => /Big Cluster/.test(o.textContent)) - 1); f.src.onchange(); return [m, f.message.value]; });
  check(msg2[0] === 'New volume cluster detected!' && msg2[1] === 'Big volume cluster detected!', 'message follows the picked condition', msg2);
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, 'ind-alerts-dialog-1440.png') });

  // 3. entry points: legend bell + settings window
  await p.evaluate(() => { document.querySelector('.stk-al-cancel').click(); document.querySelector('#stk-al .stk-al-x').click(); });
  const leg = await p.evaluate(async () => {
    const btns = [...document.querySelectorAll('[data-legend-action="stk-add-alert"]')];
    if (!btns.length) return { n: 0 };
    btns[btns.length - 1].click();
    await new Promise((r) => setTimeout(r, 300));
    const f = document.querySelector('.stk-al-form');
    const out = { n: btns.length, open: !document.getElementById('stk-al').hidden && !f.hidden, sel: f.src.options[f.src.selectedIndex].textContent };
    document.querySelector('.stk-al-cancel').click(); document.querySelector('#stk-al .stk-al-x').click();
    return out;
  });
  check(leg.n >= 1 && leg.open && /Volume Bubbles .* Big Cluster/.test(leg.sel), 'legend row bell "Add alert\u2026" opens the form with the indicator preselected', leg);
  await p.evaluate(() => window.__stkAlerts.open({ symbol: 'futures:NQ1!', src: { kind: 'cond', title: 'Volume Bubbles [QuantAlgo]', pick: true } }));
  // 4. create Big Cluster, Once per bar
  await p.evaluate(() => { const f = document.querySelector('.stk-al-form'); f.freq.value = 'bar'; f.requestSubmit(); });
  await p.waitForTimeout(500);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('stryker_chart_alerts_ind') || '[]'));
  check(saved.length === 1 && saved[0].src.kind === 'cond' && saved[0].src.cond === 'Big Cluster' && saved[0].freq === 'bar', 'alert saved for this user (local store)', saved);
  const listTxt = await p.evaluate(() => document.querySelector('.stk-al-list').textContent);
  check(/Volume Bubbles \[QuantAlgo\] \u2192 Big Cluster/.test(listTxt) && /Once per bar/.test(listTxt), 'shows in the Alerts list', listTxt.slice(0, 200));
  await p.evaluate(() => { document.querySelector('#stk-al .stk-al-x').click(); window.__toasts.length = 0; window.__stkAlertBeeps = 0; });
  r = await pushBar(p, { vol: 2000000, up: true });
  const firstFire = r.toasts.filter((t) => /Big Cluster/.test(t));
  check(firstFire.length === 1 && /Big volume cluster detected!/.test(firstFire[0]), 'Big Cluster alert: exactly one toast on the big fixture bar', r);
  r = await pushBar(p, { vol: 2100000, up: true, same: true });
  r = await pushBar(p, { vol: 2200000, up: true, same: true });
  check(r.toasts.filter((t) => /Big Cluster/.test(t)).length === 1, 'Once per bar: more ticks of the same bar do not toast again', r.toasts);
  check(r.toasts.every((t) => /^stk:/.test(t)), 'only our alert toast (no Vela/app toast)', r.toasts);
  r = await pushBar(p, { vol: 4000000, up: false });
  check(r.toasts.filter((t) => /Big Cluster/.test(t)).length === 2, 'next big bar fires once more', r.toasts);

  // reload: the alert is still there and still active
  await p.reload({ waitUntil: 'domcontentloaded' });
  await setup(p);
  await addBubbles(p); await p.waitForTimeout(2500);
  const kept = await p.evaluate(() => window.__stkAlerts.alerts.filter((a) => a.src && a.src.kind === 'cond').map((a) => [a.src.cond, a.active, a.freq]));
  check(kept.length === 1 && kept[0][0] === 'Big Cluster' && kept[0][1] === true, 'alert survives a reload', kept);

  // Once per bar close: no toast while the bar forms, one toast when the next bar opens
  await p.evaluate(() => { const a = window.__stkAlerts.alerts.find((x) => x.src && x.src.kind === 'cond'); a.freq = 'close'; window.__toasts.length = 0; });
  r = await pushBar(p, { vol: 3000000, up: true });
  const during = r.toasts.filter((t) => /Big Cluster/.test(t)).length;
  r = await pushBar(p, { vol: 900, up: false });
  const after = r.toasts.filter((t) => /Big Cluster/.test(t)).length;
  check(during === 0 && after === 1, 'Once per bar close: fires only after the bar closes', { during, after });
  // Only once: one fire, then the list says Triggered and it is silent
  await p.evaluate(() => { const a = window.__stkAlerts.alerts.find((x) => x.src && x.src.kind === 'cond'); a.freq = 'once'; window.__toasts.length = 0; });
  r = await pushBar(p, { vol: 3500000, up: true });
  r = await pushBar(p, { vol: 3600000, up: false });
  const trig = await p.evaluate(() => { window.__stkAlerts.open(); const row = [...document.querySelectorAll('.stk-al-row')].find((x) => /Big Cluster/.test(x.textContent)); const t2 = row.textContent; row.querySelector('[data-k=pause]').click(); document.querySelector('#stk-al .stk-al-x').click(); return t2; });
  check(r.toasts.filter((t) => /Big Cluster/.test(t)).length === 1 && /Triggered/.test(trig), 'Only once: one toast, then shown as Triggered', { toasts: r.toasts, trig });
  await p.waitForTimeout(300);

  // Pause -> silent; Delete -> silent
  await p.evaluate(() => { window.__stkAlerts.open(); const row = [...document.querySelectorAll('.stk-al-row')].find((x) => /Big Cluster/.test(x.textContent)); row.querySelector('[data-k=pause]').click(); window.__toasts.length = 0; });
  await p.waitForTimeout(300);
  const pz = await p.evaluate(() => [...document.querySelectorAll('.stk-al-row')].find((x) => /Big Cluster/.test(x.textContent)).textContent);
  check(/Paused/.test(pz), 'paused alert shows as Paused', pz);
  await p.evaluate(() => { document.querySelector('#stk-al .stk-al-x').click(); const a = window.__stkAlerts.alerts.find((x) => x.src && x.src.kind === 'cond'); a.freq = 'bar'; });
  r = await pushBar(p, { vol: 5000000, up: true });
  check(r.toasts.length === 0, 'paused alert is silent', r.toasts);
  await p.evaluate(() => { window.__stkAlerts.open(); const row = [...document.querySelectorAll('.stk-al-row')].find((x) => /Big Cluster/.test(x.textContent)); row.querySelector('[data-k=del]').click(); });
  await p.waitForTimeout(400);
  await p.evaluate(() => { document.querySelector('#stk-al .stk-al-x').click(); window.__toasts.length = 0; });
  r = await pushBar(p, { vol: 6000000, up: false });
  const left = await p.evaluate(() => JSON.parse(localStorage.getItem('stryker_chart_alerts_ind') || '[]').length);
  check(r.toasts.length === 0 && left === 0 && r.routed > 0, 'deleted: silent again, store empty', { toasts: r.toasts, left, routed: r.routed });
  const sett = await p.evaluate(async () => {
    const chart = window.STRYKER_VELA.context().cells[0].chart;
    const rec = chart.orchestrator.registry.all().find((r) => r.source && /Volume Bubbles/.test((r.prepared && r.prepared.meta.title) || ''));
    const n = chart.renderer.inputsUI ? chart.renderer : chart.renderer.renderer;
    n.inputsUI.openSettingsFor(rec.id);
    for (let i = 0; i < 20 && !document.querySelector('.stk-al-dlgbtn'); i++) await new Promise((r) => setTimeout(r, 150));
    const b2 = document.querySelector('.stk-al-dlgbtn'); if (!b2) return { btn: false };
    b2.click(); await new Promise((r) => setTimeout(r, 300));
    const f = document.querySelector('.stk-al-form');
    return { btn: true, dlgClosed: !document.querySelector('.vela-ind-dialog'), sel: f.src.options[f.src.selectedIndex].textContent };
  });
  check(sett.btn && /Big Cluster/.test(sett.sel || ''), 'settings window "Add alert\u2026" opens the form with the indicator preselected', sett);

  await p.evaluate(() => { const f = document.querySelector('.stk-al-form'); if (f && !f.hidden) document.querySelector('.stk-al-cancel').click(); const x = document.querySelector('#stk-al .stk-al-x'); if (x) x.click(); window.__toasts.length = 0; });
  r = await pushBar(p, { vol: 7000000, up: true });
  check(!r.toasts.some((t) => /^vela:/.test(t)), 'no indicator error after the settings window was opened/closed', r.toasts);
  check(errors.length === 0, 'no page errors (desktop)', errors.slice(0, 3));
  await ctx.close();

  // 5. phone 390
  ({ ctx, p, errors } = await open(b, 390, 844, true));
  await addBubbles(p); await p.waitForTimeout(1500);
  const ph = await p.evaluate(() => {
    window.__stkAlerts.open({ symbol: 'futures:NQ1!', src: { kind: 'cond', title: 'Volume Bubbles [QuantAlgo]', pick: true } });
    const box = document.querySelector('.stk-al-box').getBoundingClientRect();
    return { w: box.width, sw: document.documentElement.scrollWidth, sel: (() => { const f = document.querySelector('.stk-al-form'); return f.src.options[f.src.selectedIndex].textContent; })() };
  });
  check(ph.w <= 390 && ph.sw <= 390 && /Big Cluster/.test(ph.sel), 'phone 390: dialog fits, indicator preselected', ph);
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(OUT, 'ind-alerts-dialog-390.png') });
  check(errors.length === 0, 'no page errors (phone)', errors.slice(0, 3));
  await ctx.close();
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
