// Indicator versions (assets/indicator-versions.js + assets/chart-ind-versions.js) in the real chart, with fixture L2 frames.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8331 node tools/tests/indicator-versions-browser.js <shotsDir>
// Run 1 (the shipped manifest): a new add is on the latest version, no update button; the Version picker goes 1.1 -> 1.0 -> 1.1
//   and the footprint really draws the old way on 1.0; the saved chart keeps a pin; an instance with no stored version = base.
// Run 2 (a TEST manifest where v1.2 "ships"): the same saved chart loads unchanged (no-version instance stays 1.1, the pinned one
//   stays 1.0), both show the update button, Update moves one to 1.2 keeping its settings, Not now hides the other (and stays
//   hidden after a reload), a new add starts on 1.2. Then the generated indicator page shows the Changelog.
// SHOTS=1: screenshots at 1440 dark, 1440 light, 390 dark (legend button, popover, Version picker, changelog page).
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8331';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };

function fakeWs() {
  window.__stkL2Test = { base: 'http://127.0.0.1:9' }; window.__stkBookPackMin = 30;
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    const MID = 28750; let n = 0;
    setTimeout(() => {
      ws.readyState = 1; ws.onopen && ws.onopen();
      ws.onmessage({ data: JSON.stringify({ event: 'hub_attached', state: 'live', tier: 'book' }) });
      ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) });
      const m0 = Math.floor(Date.now() / 60000) * 60000, b = [];
      for (let k = 15; k >= 0; k--) { const o = MID + Math.sin(k) * 4; b.push([m0 - k * 60000, o, o + 6, o - 5, o + 2, 300 + k]); }
      ws.onmessage({ data: JSON.stringify({ type: 'bars', symbol: 'NQ', b }) });
    }, 50);
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1 || !ws.onmessage) return;
      n++;
      const bid = MID, ask = MID + 0.25, bids = [], asks = [];
      for (let j = 0; j < 40; j++) { bids.push([bid - j * 0.25, 20 + Math.round(10 * Math.abs(Math.sin(n / 3 + j))) + (j === 30 ? 900 : 0)]); asks.push([ask + j * 0.25, 20 + Math.round(10 * Math.abs(Math.cos(n / 3 + j))) + (j === 28 ? 700 : 0)]); }
      const send = (o) => ws.onmessage({ data: JSON.stringify(o) });
      send({ type: 'snap', symbol: 'NQ', ts: Date.now(), bids, asks, imb: 0, imb10: 0 });
      send({ type: 'ticks', symbol: 'NQ', t: [[bid, 1 + (n % 7), -1, Date.now()], [ask, 2 + (n % 5), 1, Date.now()]] });
    }, 100);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
// "v1.2 ships": a test manifest (only the Footprint (L2) entry; the rest are unversioned in this run)
function testManifest() {
  window.__stkIndVerTest = { 'b:stk_l2f_fp': { base: '1.1', versions: [
    { v: '1.0', date: '2026-11-03', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-11', notes: ['Resting book bars now show only near each candle by default.'] },
    { v: '1.2', date: '2026-11-20', notes: ['Sharper volume numbers in every cell.', 'A new setting to choose how many rows beyond the candle to show.'],
      migrate: (i) => (i.restRows != null ? { restRows: i.restRows } : {}) }] } };
}

async function open(b, { w, h, mobile, theme, test, store }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeWs);
  if (test) await ctx.addInitScript(testManifest);
  await ctx.addInitScript(([t, st]) => {
    try {
      if (sessionStorage.getItem('__ivSeeded')) return;   // a reload keeps what the page itself saved
      sessionStorage.setItem('__ivSeeded', '1');
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      if (st) for (const k in st) localStorage.setItem(k, st[k]); else localStorage.setItem('stryker.vela.session', '');
      if (t) localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night');
    } catch (e) {}
  }, [theme || '', store || null]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource|\/api\/chart\/stream|Ping received after close|status of 451|response code: 451|ERR_UNSAFE_PORT|WebSocket is closed before/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await boot(p);
  return { ctx, p, errors };
}
async function boot(p, reload) {
  if (reload) await p.reload({ waitUntil: 'domcontentloaded' }); else await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_INDVER, null, { timeout: 60000 });
  await sleep(1500);
}
async function setNQ(p) {
  await p.evaluate(async () => {
    const ws = window.STRYKER_VELA;
    if (ws.chart.market.symbol !== 'futures:NQ1!') { ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); }
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === 'futures:NQ1!' && c.orchestrator.rawBars.length > 10) break; }
  });
  await sleep(800);
}
const fps = (p) => p.evaluate(() => (window.STRYKER_VELA.context().cells[0].chart.indicators() || []).filter((h) => h.nativeType === 'stk_l2f_fp').map((h) => ({ id: h.id, ver: h.inputValues().ver, restShow: h.inputValues().restShow, restRows: h.inputValues().restRows })));
const add = (p, inputs) => p.evaluate((i) => { const c = window.STRYKER_VELA.context().cells[0].chart; const h = c.addNativeIndicator('stk_l2f_fp', { inputs: i || {} }); window.STRYKER_VELA.context().stateChanged(); return h && h.id; }, inputs || null);
const setIn = (p, id, v) => p.evaluate(([id, v]) => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.id === id); h.setInputs(v); window.STRYKER_VELA.context().stateChanged(); }, [id, v]);
const btns = (p) => p.evaluate(() => [...document.querySelectorAll('.stk-iv-btn')].map((b) => { const r = b.getBoundingClientRect(), row = b.parentElement; return { label: b.getAttribute('aria-label'), w: r.width, h: r.height, x: r.x + r.width / 2, y: r.y + r.height / 2, row: row && row.textContent.slice(0, 40), vis: r.width > 0 && getComputedStyle(b).visibility !== 'hidden' }; }));
const store = (p) => p.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
const lastDraw = (p) => p.evaluate(() => JSON.parse(JSON.stringify((window.__stkL2Flow || {}).stk_l2f_fp || {})));
const zoom = (p, n) => p.evaluate((n) => { const m = Math.floor(Date.now() / 60000) * 60000; window.STRYKER_VELA.chart.setVisibleRange({ from: m - n * 60000, to: m + 3 * 60000 }); }, n);
// the Version dropdown in the open settings window (the chart's own select: a trigger button + a popup list)
const VER_TRIG = '.vela-ind-dialog button[id$="-ver"].vela-select-trigger';
const dlgVer = async (p) => {
  const v = await p.evaluate((sel) => { const t = document.querySelector(sel); return t ? t.textContent : null; }, VER_TRIG);
  if (v == null) return null;
  await p.click(VER_TRIG); await sleep(400);
  const opts = await p.evaluate(() => [...document.querySelectorAll('.vela-select-item')].map((e) => e.textContent));
  await p.keyboard.press('Escape'); await sleep(200);
  return { value: v, opts };
};
const openDlg = (p, id) => p.evaluate((id) => { const c = window.STRYKER_VELA.context().cells[0].chart, r = c.renderer.inputsUI ? c.renderer : c.renderer.renderer; r.inputsUI.openDialog(id); }, id);
const pickVer = async (p, v, shot) => {
  await p.click(VER_TRIG); await sleep(400);
  if (shot) await p.screenshot({ path: shot });
  const items = await p.$$('.vela-select-item');
  for (const it of items) if ((await it.textContent()).startsWith('v' + v + ' ')) { await it.click(); break; }
  await sleep(300);
};
const closeDlg = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart, r = c.renderer.inputsUI ? c.renderer : c.renderer.renderer; r.inputsUI.closeOpenDialog(); window.STRYKER_VELA.context().stateChanged(); });
const sessOf = (st) => Object.values(st).filter((v) => /stk_l2f_fp/.test(v || '')).join('\n');

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  const SHOTS = !!process.env.SHOTS;
  const views = SHOTS ? [[1440, 900, false, 'dark', '1440-dark'], [1440, 900, false, 'light', '1440-light'], [390, 844, true, 'dark', '390-dark']] : [[1440, 900, false, 'dark', '1440-dark']];
  try {
    // ---------------- run 1: the shipped manifest
    let saved0, saved1, fid;
    {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900, theme: 'dark' });
      await setNQ(p);
      fid = await add(p, { restRows: 5 });
      await sleep(2500);
      let f = await fps(p);
      check(f.length === 1 && f[0].ver === '1.1', 'shipped: a new add starts on the latest version (1.1)', f);
      check((await btns(p)).length === 0, 'shipped: nobody sees an update button today');
      await p.evaluate(() => window.STRYKER_VELA.context().stateChanged()); await sleep(2500);
      saved0 = await store(p);
      // a chart saved BEFORE versions has no ver anywhere: strip it from this save to make one (run 2a loads it)
      for (const k in saved0) if (/stk_l2f_fp/.test(saved0[k] || '')) saved0[k] = saved0[k].replace(/,?\\?"ver\\?":\\?"[0-9.]+\\?"/g, '').replace(/\{,/g, '{');
      check(/stk_l2f_fp/.test(sessOf(saved0)) && !/"ver"/.test(sessOf(saved0).replace(/\\"/g, '"')), 'made an old-style saved chart (no version stored)', sessOf(saved0).slice(0, 200));
      // Version picker: 1.1 -> 1.0 -> 1.1 -> 1.0, and the drawing really changes
      await zoom(p, 12); await sleep(2500);
      const dNew = await lastDraw(p);
      check(dNew.ver === '1.1' && dNew.mode === 'Near the candle', 'v1.1 draws the resting book near the candle', dNew);
      await openDlg(p, fid); await sleep(700);
      const dv = await dlgVer(p);
      check(dv && /^v1\.1 · 11 Nov 2026 \(latest\)$/.test(dv.value) && dv.opts.length === 2 && /v1\.0 · 3 Nov 2026/.test(dv.opts.join('|')), 'picker: Version lists both versions with dates, on 1.1', dv);
      await pickVer(p, '1.0'); await sleep(1500);
      f = await fps(p);
      check(f[0].ver === '1.0' && f[0].restRows === 5, 'picker: back to 1.0, other settings kept', f);
      const rows = await p.evaluate(() => [...document.querySelectorAll('.vela-ind-dialog')].map((d) => d.innerText).join(''));
      check(!/Rows beyond the candle/.test(rows), 'picker: on 1.0 the 1.1-only setting is hidden');
      await pickVer(p, '1.1'); await sleep(800);
      check((await fps(p))[0].ver === '1.1', 'picker: forward to 1.1 again');
      await pickVer(p, '1.0'); await sleep(500);
      await closeDlg(p); await sleep(2500);
      const dOld = await lastDraw(p);
      check(dOld.ver === '1.0' && dOld.mode === 'Full depth', 'v1.0 really draws the old full-depth resting book', dOld);
      await p.evaluate(() => window.STRYKER_VELA.context().stateChanged()); await sleep(2500);
      saved1 = await store(p);
      check(/"ver":"1\.0"/.test(sessOf(saved1)), 'saved chart keeps the pin (ver 1.0)', sessOf(saved1).slice(0, 300));
      check(errors.length === 0, 'shipped: no console errors', errors);
      await ctx.close();
    }
    // ---------------- run 2a: v1.2 ships (test manifest), the chart saved with no version
    {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900, theme: 'dark', test: true, store: saved0 });
      await setNQ(p); await sleep(2500);
      const f = await fps(p);
      check(f.length === 1 && f[0].ver === '1.1' && f[0].restRows === 5, 'old saved chart (no version) loads unchanged after v1.2 ships: on 1.1, settings as saved', f);
      const bs = await btns(p);
      check(bs.length === 1 && bs[0].label === 'Update available: v1.2', 'it shows the update button', bs);
      check(errors.length === 0, 'run 2a: no console errors', errors);
      await ctx.close();
    }
    // ---------------- run 2b: v1.2 ships, the chart pinned to 1.0, every view
    for (const [w, h, mobile, theme, tag] of views) {
      const { ctx, p, errors } = await open(b, { w, h, mobile, theme, test: true, store: saved1 });
      await setNQ(p); await sleep(2500);
      let f = await fps(p);
      check(f.length === 1 && f[0].ver === '1.0' && f[0].restRows === 5, tag + ': pinned 1.0 stays 1.0 after v1.2 ships', f);
      if (mobile) {   // the phone legend starts folded: the toggle carries a dot, tapping it shows the rows
        const fd = await p.evaluate(() => { const f = document.querySelector('.vela-ind-fold'); return f && { has: f.classList.contains('stk-iv-has'), label: f.getAttribute('aria-label'), shown: f.getBoundingClientRect().width > 0 }; });
        check(fd && fd.has && /^Show.*update available/.test(fd.label), tag + ': folded legend: the toggle shows the update dot', fd);
        if (SHOTS) await p.screenshot({ path: OUT + '/iv-' + tag + '-folded.png' });
        if (fd && fd.shown && !(await btns(p)).some((x) => x.vis)) { await (await p.$('.vela-ind-fold')).tap(); await sleep(700); }
      }
      let bs = await btns(p);
      check(bs.length === 1 && bs[0].vis && bs[0].label === 'Update available: v1.2', tag + ': the legend row shows the update button', bs);
      if (mobile) { const t = await p.evaluate(() => { const b = document.querySelector('.stk-iv-btn'); const r = b.getBoundingClientRect(); const e = getComputedStyle(b, '::before'); return { w: r.width - 2 * parseFloat(e.left), h: r.height - 2 * parseFloat(e.top) }; }); check(t.w >= 44 && t.h >= 44, tag + ': touch target >= 44 x 44', t); }
      if (SHOTS) await p.screenshot({ path: OUT + '/iv-' + tag + '-legend.png' });
      const tapBtn = async () => { if (mobile && !(await btns(p)).some((x) => x.vis)) { await (await p.$('.vela-ind-fold')).tap(); await sleep(700); } const bh = await p.$('.stk-iv-btn'); if (mobile) await bh.tap(); else await bh.click(); await sleep(500); };
      await tapBtn();
      const pop = await p.evaluate(() => { const d = document.querySelector('.stk-iv-pop'); if (!d) return null; const r = d.getBoundingClientRect(); return { text: d.innerText, l: r.left, r: r.right, t: r.top, b: r.bottom, W: innerWidth, H: innerHeight, btnH: [...d.querySelectorAll('button')].map((x) => x.getBoundingClientRect().height) }; });
      check(pop && /Update available: v1\.2/.test(pop.text) && /This chart uses v1\.0/.test(pop.text) && /Sharper volume numbers/.test(pop.text) && /Resting book bars now show/.test(pop.text) && /Not now/.test(pop.text) && /Update/.test(pop.text), tag + ': popover: title, what is new since 1.0, two buttons', pop);
      check(pop && pop.l >= 0 && pop.r <= pop.W && pop.t >= 0 && pop.b <= pop.H, tag + ': popover fits the screen', pop);
      check(pop && !/TradingView|LuxAlgo|Vela/i.test(pop.text), tag + ': popover: no vendor names');
      if (SHOTS) await p.screenshot({ path: OUT + '/iv-' + tag + '-popover.png' });
      // Not now: hidden, version unchanged, still hidden after a reload
      await p.click('.stk-iv-pop .stk-iv-later'); await sleep(500);
      check((await btns(p)).length === 0 && (await fps(p))[0].ver === '1.0', tag + ': Not now hides the button, the version stays 1.0');
      await boot(p, true); await setNQ(p); await sleep(2500);
      check((await btns(p)).length === 0 && (await fps(p))[0].ver === '1.0', tag + ': after reload: still 1.0, still hidden');
      // "the next version": forget the dismissal (same as a newer version shipping), Update
      await p.evaluate(() => { localStorage.removeItem('stk_ind_ver_dismissed'); window.STRYKER_INDVER.refresh(); }); await sleep(300);
      check((await btns(p)).length === 1, tag + ': button back for the next version');
      await tapBtn();
      await p.click('.stk-iv-pop .stk-iv-go'); await sleep(1500);
      f = await fps(p);
      check(f[0].ver === '1.2' && f[0].restRows === 5, tag + ': Update: on 1.2, settings kept (rows beyond the candle = 5)', f);
      check((await btns(p)).length === 0, tag + ': updated row has no button any more');
      // Version picker: 3 versions, back to 1.0 brings the button back
      await openDlg(p, f[0].id); await sleep(800);
      const dv = await dlgVer(p);
      check(dv && /^v1\.2 /.test(dv.value) && dv.opts.length === 3, tag + ': picker lists 3 versions, on 1.2', dv);
      await pickVer(p, '1.0', SHOTS ? OUT + '/iv-' + tag + '-picker.png' : null); await sleep(800);
      check((await fps(p))[0].ver === '1.0', tag + ': picker: back from 1.2 to 1.0');
      await closeDlg(p); await sleep(2500);
      check((await btns(p)).length === 1, tag + ': on 1.0 again the update button is back');
      // a new add (after removing it) starts on 1.2
      await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; const h = c.indicators().find((x) => x.nativeType === 'stk_l2f_fp'); h.remove(); }); await sleep(800);
      await add(p); await sleep(1000);
      f = await fps(p);
      check(f.length === 1 && f[0].ver === '1.2' && (await btns(p)).length === 0, tag + ': a new add starts on the latest (1.2), no button', f);
      check(errors.length === 0, tag + ': no console errors', errors);
      await ctx.close();
    }
    // ---------------- the generated page
    for (const [w, h, mobile, theme, tag] of views) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
      await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      const p = await ctx.newPage();
      await p.goto(BASE + '/indicators/footprint-l2.html', { waitUntil: 'domcontentloaded' }); await sleep(800);
      const cl = await p.evaluate(() => { const h = document.getElementById('changelog'); const ol = h && h.nextElementSibling; return h && ol ? { h: h.textContent, items: [...ol.children].map((li) => li.querySelector('.ixp-cl-head').textContent), text: ol.innerText, meta: (document.querySelector('.ixp-upd') || {}).textContent, over: document.documentElement.scrollWidth > innerWidth } : null; });
      check(cl && cl.h === 'Changelog' && cl.items.length >= 2 && /^v1\.\dLatest/.test(cl.items[0]) && /^v1\.0/.test(cl.items[cl.items.length - 1]) && /Resting book shown/.test(cl.text) && cl.meta.includes(cl.items[0].slice(0, 4)) && !cl.over, tag + ': indicator page shows the Changelog, newest first, version in the header', cl);
      if (SHOTS) { await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; const e = document.getElementById('changelog'); window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 120); }); await sleep(800); await p.screenshot({ path: OUT + '/iv-' + tag + '-changelog.png' }); }
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'all passed');
  process.exit(fail ? 1 : 0);
})();
