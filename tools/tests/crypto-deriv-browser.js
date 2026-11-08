// Browser test: crypto derivatives tools (assets/chart-crypto-deriv.js): Liquidations, Liquidations per bar, Open Interest,
// Funding Rate, Long/Short Ratio.
//   node tools/tests/chart-dev-server.mjs 8238 &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8238 node tools/tests/crypto-deriv-browser.js [shotsDir]
// Run "real": okx:BTC-USDT-SWAP 5m with the REAL public endpoints (OKX + Hyperliquid answer from this server; Binance (451) and
//   Bybit (403) refuse it by region, which is exactly the "not available in your region" path a member there would see).
// Run "mock": binance:BTCUSDT.P with tools/tests/binance-mock.js candles + a scripted @forceOrder socket (fixture prints at the mock
//   price), to check bubble placement, the card wording and the per-bar pane deterministically. Plus a Free member: PRO lock.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8238';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 400) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IGNORE = /ERR_FAILED|net::|Failed to load resource|status of|CORS|Firestore|FirebaseError|offline|binance|bybit|WebSocket/i;

async function open(b, { w, h, mobile, theme, sym, mock, free }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([t, free]) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker.vela.session'); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); if (!sessionStorage.getItem('cdt')) { sessionStorage.setItem('cdt', '1'); Object.keys(localStorage).filter((k) => /^stk\.liq/.test(k)).forEach((k) => localStorage.removeItem(k)); } } catch (e) {} if (free) window.__stkChartTestFree = true; }, [theme, !!free]);
  if (mock) {
    await require('./binance-mock.js').install(ctx);
    const bm = require('./binance-mock.js');
    // scripted forceOrder prints around the mock price, both sides, sizes 5k..600k USD
    await ctx.routeWebSocket(/fstream\.binance\.com\/ws\/btcusdt@forceOrder/, (ws) => {
      let n = 0;
      const iv = setInterval(() => {
        n++; const now = Date.now(), px = bm.mid(now) + (n % 2 ? 15 : -15), usd = [5e3, 40e3, 120e3, 600e3][n % 4], q = (usd / px).toFixed(3);
        try { ws.send(JSON.stringify({ e: 'forceOrder', E: now, o: { s: 'BTCUSDT', S: n % 2 ? 'BUY' : 'SELL', o: 'LIMIT', f: 'IOC', q, p: px.toFixed(2), ap: px.toFixed(2), X: 'FILLED', l: q, z: q, T: now } })); } catch (e) { clearInterval(iv); }
      }, 400);
      ws.onClose(() => clearInterval(iv));
    });
    await ctx.routeWebSocket(/stream\.bybit\.com|ws\.okx\.com/, (ws) => ws.close());
    await ctx.route(/^https:\/\/(api\.bybit\.com|www\.okx\.com|api\.hyperliquid\.xyz)\//, (r) => r.fulfill({ status: 403, contentType: 'text/html', body: 'blocked' }));
  }
  const p = await ctx.newPage(); const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(2500);
  await p.evaluate(async (s) => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('5');
    for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 250)); try { if (ws.chart.market.symbol === s && ws.chart.orchestrator.rawBars.length > 50) break; } catch (e) {} }
  }, sym);
  if (theme === 'light') await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await sleep(1000);
  return { ctx, p, errors };
}
const add = (p, type, inputs) => p.evaluate(([t, i]) => { window.STRYKER_VELA.chart.addNativeIndicator(t, { inputs: i || {} }); window.STRYKER_VELA.context().stateChanged(); }, [type, inputs]);
const types = (p) => p.evaluate(() => window.STRYKER_VELA.chart.indicators().map((x) => x.nativeType).filter(Boolean));
const chip = (p) => p.evaluate(() => [...document.querySelectorAll('.stk-liq-chip')].filter((x) => !x.hidden).map((x) => x.textContent).join(' | '));
// legend DOM text + the in-pane notes (pane notes are drawn on canvas; the tool mirrors them on window.__stkCdNotes)
const text = (p) => p.evaluate(() => document.getElementById('vela-chart').innerText + '\n' + Object.values(window.__stkCdNotes || {}).join('\n') + '\n' + JSON.stringify(window.__stkOi || {}));
async function shot(p, name) { await p.mouse.move(2, 2).catch(() => {}); await sleep(800); const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('SHOT ' + f); }
const painted = (p) => p.evaluate(() => { let n = 0; for (const c of document.querySelectorAll('canvas[data-stk-liq]')) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 60) n++; } return n; });

async function runReal(b, tag, o) {
  const { ctx, p, errors } = await open(b, Object.assign({ sym: 'okx:BTC-USDT-SWAP' }, o));
  for (const t of ['stk_liq', 'stk_oi', 'stk_funding']) await add(p, t);
  if (tag === '1440-dark') { await add(p, 'stk_liq_bars'); await add(p, 'stk_lsr'); }
  await sleep(9000);
  const ty = await types(p);
  check(['stk_liq', 'stk_oi', 'stk_funding'].every((t) => ty.includes(t)), tag + ': indicators added ' + ty.join(','));
  const liq = await p.evaluate(() => window.__stkLiq);
  check(liq && liq.base === 'BTC' && liq.n > 0, tag + ': OKX recent liquidations loaded (real REST)', liq);
  check(liq && liq.st.okx === 'live', tag + ': OKX liquidation socket open', liq && liq.st);
  const oi = await p.evaluate(() => window.__stkOi);
  check(oi && oi.ready.includes('okx') && oi.n > 20 && oi.last > 1e8, tag + ': OI from OKX per bar (' + (oi && oi.n) + ' bars, last ' + (oi && Math.round(oi.last / 1e6)) + 'M)', oi);
  check(oi && oi.failed.includes('binance') && oi.failed.includes('bybit'), tag + ': Binance + Bybit OI refused here -> listed as missing', oi);
  const fu = await p.evaluate(() => window.__stkFunding);
  check(fu && fu.now.okx && fu.now.hyperliquid && fu.now.okx.intervalH === 8, tag + ': funding now from OKX + Hyperliquid', fu && Object.keys(fu.now));
  const tx = await text(p);
  const nx = fu && fu.now.okx && fu.now.okx.next;
  check(nx > Date.now() && nx - Date.now() <= 8 * 3600e3 + 60e3, tag + ': OKX next settlement within the 8h interval (countdown source)', nx);
  check(/not available in your region|not reachable from here/.test(tx), tag + ': blocked exchanges say so in plain words');
  if (tag === '1440-dark') {
    // Binance is the default L/S source and is refused here: plain note, no crash
    check(/Long\/short ratio: Binance (not available in your region|not reachable)/.test(tx), tag + ': L/S ratio note when the exchange refuses');
    await p.evaluate(() => { const h = window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === 'stk_funding'); h.setInputs(Object.assign(h.inputValues(), { source: 'OKX' })); }); await sleep(3000);
    const fu2 = await p.evaluate(() => window.__stkFunding);
    check(fu2 && fu2.src === 'okx' && fu2.hist > 10 && fu2.bars > 20, tag + ': OKX funding history per bar', fu2);
  }
  check(/liquidations|liq\. in view/.test(await chip(p)), tag + ': liquidations status pill "' + (await chip(p)) + '"');
  const words = await text(p) + ' ' + await chip(p);
  check(!/tradingview|coinglass|coinalyze|vela|luxalgo|profit|win rate/i.test(words), tag + ': no vendor / result words');
  await shot(p, 'cd-real-' + tag + '.png');
  // not crypto: notes, no requests
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); await new Promise((r) => setTimeout(r, 4000)); });
  const tx2 = await text(p);
  check(/crypto perpetuals only/.test(tx2), tag + ': futures chart -> "crypto perpetuals only"');
  check(!errors.length, tag + ': no page errors', errors);
  await ctx.close();
}
async function runMock(b, tag, o) {
  const { ctx, p, errors } = await open(b, Object.assign({ sym: 'binance:BTCUSDT.P', mock: true }, o));
  if (o.free) {
    const r = await p.evaluate(() => { const cell = window.STRYKER_VELA.active, rows = cell.libraryRows(); const i = rows.findIndex((x) => x.native && x.nativeType === 'stk_liq'); if (i < 0) return { i }; cell.addFromLibrary(i); return { i, cat: rows[i].category, n: window.STRYKER_VELA.chart.indicators().filter((x) => x.nativeType === 'stk_liq').length }; });
    await sleep(600);
    const modal = await p.evaluate(() => !!document.querySelector('.plan-modal, .stk-plan-modal, [class*="upgrade"]') || !!window.__planModalOpened);
    check(r.i >= 0 && r.cat === 'Order Flow' && r.n === 0, tag + ': Free member: Liquidations listed under Order Flow and not added (Pro)', r);
    check(!errors.length, tag + ': no page errors', errors);
    await ctx.close(); return;
  }
  await add(p, 'stk_liq', { minUsd: 0 }); await add(p, 'stk_liq_bars');
  await sleep(8000);
  const liq = await p.evaluate(() => window.__stkLiq);
  check(liq && liq.n >= 10 && liq.st.binance === 'live', tag + ': forceOrder prints collected (' + (liq && liq.n) + ')', liq);
  check(liq && (liq.st.okx === 'blocked' || liq.st.okx === 'error') , tag + ': OKX refused -> marked', liq && liq.st);
  await p.evaluate(() => { const c = window.STRYKER_VELA.chart; const r = c.getVisibleRange(); c.setVisibleRange({ from: Date.now() - 3 * 3600e3, to: Date.now() + 15 * 60e3 }); });
  await sleep(1500);
  const px = await painted(p);
  check(px > 200, tag + ': bubbles painted (' + px + ' px)');
  const c1 = await chip(p);
  check(/BTC (liquidations|liq\.) in view: longs \$[\d.]+[KM] · shorts \$[\d.]+[KM] · lower bound/.test(c1), tag + ': pill "' + c1 + '"');
  // hover the biggest bubble
  const pos = await p.evaluate(() => { const cv = document.querySelector('canvas[data-stk-liq]'); const r = cv.getBoundingClientRect(), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, dpr = cv.width / r.width; let best = null; for (let y = 0; y < cv.height; y += 2) for (let x = cv.width - 1; x > 0; x -= 2) { const i = (y * cv.width + x) * 4; if (d[i + 3] > 100 && (d[i] > 200 || d[i + 1] > 150)) { best = { x: r.left + x / dpr - 3, y: r.top + y / dpr + 3 }; return best; } } return best; });
  let t = null;
  if (pos) for (let k = 0; k < 10 && !t; k++) { await p.mouse.move(pos.x - k, pos.y + k); await sleep(200); t = await p.evaluate(() => { const t = document.querySelector('.stk-liq-tip'); return t && !t.hidden ? t.innerText : null; }); }
  check(!!t && /(Long|Short) liquidated · \$/.test(t) && /Exchange\s+Binance/.test(t) && /Size/.test(t) && /lower bound/.test(t) && /one per symbol per second/.test(t), tag + ': card "' + String(t).replace(/\n/g, ' | ') + '"');
  if (t) await shot(p, 'cd-mock-' + tag + '-tip.png');
  const types = await p.evaluate(() => window.STRYKER_VELA.chart.indicators().map((h) => h.nativeType));
  check(types.includes('stk_liq_bars'), tag + ': per-bar pane present', types);
  await shot(p, 'cd-mock-' + tag + '.png');
  // kept across a reload on this device
  await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(100);
  const kept = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => /^stk\.liq\.v1\.BTC$/.test(x)); return k ? JSON.parse(localStorage.getItem(k)).list.length : 0; });
  check(kept >= 5, tag + ': prints saved on this device for the per-bar history (' + kept + ')');
  check(!errors.length, tag + ': no page errors', errors);
  await ctx.close();
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  const only = process.env.ONLY;
  try {
    const runs = [['real', '1440-dark', { w: 1440, h: 900, theme: 'dark' }], ['real', '1440-light', { w: 1440, h: 900, theme: 'light' }], ['real', '390-dark', { w: 390, h: 844, mobile: true, theme: 'dark' }],
      ['mock', '1440-dark', { w: 1440, h: 900, theme: 'dark' }], ['mock', '390-dark', { w: 390, h: 844, mobile: true, theme: 'dark' }], ['mock', '1440-free', { w: 1440, h: 900, theme: 'dark', free: true }]];
    for (const [k, t, o] of runs) if (!only || only.split(',').includes(k + ':' + t)) await (k === 'real' ? runReal : runMock)(b, t, o);
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
