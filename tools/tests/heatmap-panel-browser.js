// Heatmap panel (fixtures as depth-heatmap-browser.js) in the charts page (Owner 2026-11-07). FIXTURE data only (1m NQ bars + a fake /ts-live socket with book snaps,
// whole-book rows and ticks; BTC book samples loaded through the page's own debug loader). No Worker, no key.
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/depth-heatmap-browser.js <shotsDir>
// Checks at 1440 + 390 dark (+ 1440 light for Pro):
//   Pro: the picker lists "Depth Heatmap (L2)" on NQ and BTC; it draws on NQ (heatmap columns on the graphics card, price trace,
//        volume bars, the book column) and on BTC; the light theme keeps the heatmap's own dark field; no console errors.
//   Free: the row carries the PRO tag, a click opens the upgrade modal and adds nothing; a saved chart with it is swept (no broken pane).
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 500) : '')); };

const MIN = Math.floor(Date.now() / 60000), N = 180, TICK = 0.25;
const price = (m) => 28650 + Math.sin((m - MIN) / 17) * 40 + Math.sin((m - MIN) / 5) * 9;
const BARS = [];
for (let m = MIN - N; m < MIN; m++) {
  const o = Math.round(price(m) / TICK) * TICK, c = Math.round(price(m + 1) / TICK) * TICK;
  BARS.push([m * 60, o, Math.max(o, c) + 3, Math.min(o, c) - 3, c, 400 + (m % 7) * 30]);
}

function fakeWs(opt) {
  window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  if (opt.free) window.__stkChartTestFree = true;
  window.openPlanUpgradeModal = (why) => { window.__upsell = why; };
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) }); }, 50);
    let n = 0;
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1 || !ws.onmessage) return; n++;
      const now = Date.now(), b = Math.floor((window.__L2MID || 28650) * 4) / 4;
      const bids = [], asks = [];
      for (let i = 0; i < 12; i++) { bids.push([b - i * 0.25, 10 + ((i * 7 + n) % 30)]); asks.push([b + 0.25 + i * 0.25, 10 + ((i * 5 + n) % 30)]); }
      ws.onmessage({ data: JSON.stringify({ type: 'snap', symbol: 'NQ', ts: now, bids, asks, imb: 0, imb10: 0 }) });
      ws.onmessage({ data: JSON.stringify({ type: 'ticks', symbol: 'NQ', t: [[b, 3, -1, now], [b + 0.25, 2, 1, now]].concat(n % 15 === 0 ? [[b + 0.25, 60, 1, now]] : []) }) });
      if (n % 5 === 0) {   // the whole book in 2.75-point rows once a second, with two walls
        const step = 2.75, i0 = Math.floor((b - 120) / step), v = [];
        for (let k = 0; k < 88; k++) { const p = (i0 + k + 0.5) * step, w = Math.abs(p - (b + 30)) < 2 || Math.abs(p - (b - 45)) < 2 ? 900 : 20 + ((k * 13) % 50); v.push(p < b ? w : -w); }
        ws.onmessage({ data: JSON.stringify({ type: 'coarse', symbol: 'NQ', ts: now, mid: b, bb: b, ba: b + 0.25, step, i0, v }) });
      }
    }, 200);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
async function open(b, { w, h, mobile, free, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile, colorScheme: theme });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeWs, { free: !!free });
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  // BTC candles (the exchange is blocked in tests): 1m klines around 76 000 for the last 3 hours
  await ctx.route(/binance[^/]*\/(api\/v3|fapi\/v1)\/klines/, (r) => {
    const u = new URL(r.request().url()), e = Number(u.searchParams.get('endTime')) || Date.now(), m1 = Math.floor(e / 60000), k = [];
    if (!u.searchParams.get('endTime')) for (let m = m1 - 180; m <= m1; m++) { const o = 76000 + Math.sin(m / 9) * 40, c = 76000 + Math.sin((m + 1) / 9) * 40; k.push([m * 60000, String(o), String(Math.max(o, c) + 5), String(Math.min(o, c) - 5), String(c), '12', m * 60000 + 59999, '0', 10, '6', '0', '0']); }
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(k) });
  });
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page: 0, bars: BARS }) }));
  await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage(), errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|\/api\/chart\/stream|Failed to load resource|Ping received after close/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(1500);
  return { ctx, p, errors };
}
const setSym = (p, sym) => p.evaluate(async ([s, mid]) => {
  window.__L2MID = mid;
  const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1');
  for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === s && c.orchestrator.rawBars.length > 20) break; }
}, [sym, price(MIN)]);
const types = (p) => p.evaluate(() => window.STRYKER_VELA.chart.indicators().map((x) => x.nativeType));
const dbg = (p) => p.evaluate(() => window.__stkFlow.dhDebug && window.__stkFlow.dhDebug());
async function search(p, q) {
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await p.waitForSelector('.stkiw-row', { timeout: 20000 });
  await p.fill('.stkiw-search', q); await sleep(600);
  return p.evaluate(() => [...document.querySelectorAll('.stkiw-row')].filter((r) => r.offsetParent).map((r) => ({ n: (r.querySelector('.stkiw-nm') || {}).textContent || '', pro: !!r.querySelector('.stk-protag') })));
}
const closePicker = async (p) => { await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.close()); await sleep(300); };
const NAME = 'Depth Heatmap (L2)';
const panelBtn = (p) => p.evaluate(() => !!document.getElementById('stkc-heatmap-btn'));
const st = (p) => p.evaluate(() => window.__stkHeatmapPanel.state());
const tabs = (p) => p.evaluate(() => [...document.querySelectorAll('.stkhm-sec:first-child .stkhm-seg button')].map((b) => b.textContent + (b.disabled ? '(off)' : '')));
const clickText = (p, t, scope) => p.evaluate(([t, sc]) => { const b = [...document.querySelectorAll((sc || '.stkhm') + ' button')].find((x) => x.textContent.trim() === t && !x.disabled); if (b) b.click(); return !!b; }, [t, scope]);
const sw = async (p) => { await p.evaluate(() => document.querySelector('.stkhm-sw').click()); await sleep(2500); };
const heat = (p) => p.evaluate(() => { const d = window.__stkFlow.dhDebug && window.__stkFlow.dhDebug(); return d && d.heat ? { cells: d.heat.cells, show: d.ladderRows, spread: d.spread, values: d.values } : null; });
const shot = (p, name) => p.screenshot({ path: OUT + '/hm-' + name + '.png' });
const theme = (p) => p.evaluate(() => { const h = window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === 'stk_depth_heat'); return h && h.inputValues().hmTheme; });
const pix = async (p) => { await p.evaluate(() => window.__stkHeatmapPanel.close()); await sleep(600); const b64 = (await p.screenshot()).toString('base64'); await p.evaluate(() => window.__stkHeatmapPanel.open()); return p.evaluate(async (b) => { const im = new Image(); im.src = 'data:image/png;base64,' + b; await im.decode(); const t = document.createElement('canvas'); t.width = im.width; t.height = im.height; const g = t.getContext('2d'); g.drawImage(im, 0, 0); const x0 = Math.round(im.width * 0.8), y0 = Math.round(im.height * 0.15), w = Math.round(im.width * 0.12), h = Math.round(im.height * 0.7); const d = g.getImageData(x0, y0, w, h).data; let lit = 0, hue = 0; for (let i = 0; i < d.length; i += 4) { if (Math.max(d[i], d[i + 1], d[i + 2]) > 60) lit++; hue += d[i] * 3 - d[i + 2] * 2; } return { lit, hue }; }, b64); };
const glSum = (p) => p.evaluate(() => { const c = [...document.querySelectorAll('canvas')].find((x) => x.dataset.stkHeatmapGl === '1'); if (!c) return -1; const t = document.createElement('canvas'); t.width = 64; t.height = 64; const g = t.getContext('2d'); g.drawImage(c, 0, 0, 64, 64); const d = g.getImageData(0, 0, 64, 64).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] * 3 - d[i + 2]; return s; });
(async () => {
  const b = await launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--max-old-space-size=768'] });
  try {
    const ALL = [[false, 1440, 900, false, 'dark'], [false, 1440, 900, false, 'light'], [false, 390, 844, true, 'dark'], [true, 1440, 900, false, 'dark']];
    const only = process.env.HM_ONLY; 
    for (const [free, w, h, mobile, thm] of ALL.filter((r, i) => !only || String(i) === only)) {
      const tag = (free ? 'free-' : 'pro-') + w + '-' + thm;
      const { ctx, p, errors } = await open(b, { w, h, mobile, free, theme: thm });
      await setSym(p, 'futures:NQ1!');
      check(await panelBtn(p), tag + ': toolbar has the Heatmap button');
      await p.evaluate(() => window.__stkHeatmapPanel.open()); await sleep(1500);
      if (free) {
        await p.evaluate(() => { window.__upsell = ''; window.openPlanUpgradeModal = (why) => { window.__upsell = why; }; });
        await p.evaluate(() => document.querySelector('.stkhm-sw').click()); await sleep(1000);
        check(/Pro/.test(await p.evaluate(() => window.__upsell || '')) && !(await types(p)).includes('stk_depth_heat'), tag + ': Free sees the Pro upsell, nothing added');
        await ctx.close(); continue;
      }
      check((await tabs(p)).join() === 'Order book,Liquidations(off),Options', tag + ': NQ tabs = Order book + Options (from QQQ options), no Liquidations', await tabs(p));
      check(await p.evaluate(() => /crypto pairs only/.test(document.querySelector('.stkhm-b').textContent)), tag + ': a one-line reason is shown for the hidden tabs');
      check(!(await types(p)).includes('stk_depth_heat'), tag + ': OFF = no layer subscribed');
      await sw(p); await sleep(8000);
      check((await types(p)).includes('stk_depth_heat') && (await st(p)).on, tag + ': ON adds the Depth Heatmap layer');
      const h1 = await heat(p);
      check(h1 && h1.cells > 100, tag + ': cells drawn', h1);
      if (w > 1000 && thm === 'dark') {
        await shot(p, 'nq-' + tag);
        await clickText(p, 'Fire'); await sleep(1800);
        check((await theme(p)) === 'Fire', tag + ': theme Fire stored');
        const a = await pix(p);
        await clickText(p, 'Green'); await sleep(1800);
        const bb = await pix(p);
        check(a.hue !== bb.hue && a.lit > 100, tag + ': changing the theme changes pixels', [a, bb]);
        await clickText(p, 'Classic', '.stkhm-sws');
        await sleep(1200);
        const c0 = await pix(p);
        for (let i = 0; i < 12; i++) await p.evaluate(() => document.querySelector('[aria-label="Threshold higher"]').click());
        await sleep(2500);
        const c1 = await pix(p);
        check(c1.lit < c0.lit, tag + ': Threshold lowers the drawn cell count (lit pixels)', [c0.lit, c1.lit]);
        await clickText(p, 'Reset'); await sleep(1800);
        await clickText(p, 'Both'); await sleep(2000);
        let d = await heat(p); check(d && d.cells > 0 && d.show > 3, tag + ': Both = cells + side profile', d);
        await clickText(p, 'Profile'); await sleep(2000);
        d = await heat(p); check(d && d.cells === 0 && d.show > 3, tag + ': Profile = side profile only', d);
        await clickText(p, 'Heatmap', '.stkhm-b'); await sleep(1800);
        await clickText(p, 'Volumetric'); await sleep(1200);
        check(await p.evaluate(() => /blur/.test((document.querySelector('canvas[data-stk-heatmap-gl="1"]') || { style: { filter: '' } }).style.filter)), tag + ': Volumetric blurs the glow');
        await clickText(p, 'Classic', '.stkhm-b');
        await clickText(p, 'Values'); await sleep(2500);
        d = await heat(p); check(d && d.values > 0, tag + ': Values draws size numbers', d);
        await p.evaluate(() => { document.querySelector('.stkhm-in').value = 'T1'; document.querySelector('.stkhm-save').click(); }); await sleep(600);
        await clickText(p, 'Fire'); await sleep(900);
        await clickText(p, 'T1', '.stkhm-tp'); await sleep(1500);
        check((await theme(p)) === 'Classic', tag + ': a saved template loads', await theme(p));
        await clickText(p, 'Fire'); await sleep(900);
        await p.evaluate(() => { const c = window.STRYKER_VELA.context(); c.stateChanged && c.stateChanged(); }); await sleep(3500);
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 }); await sleep(7000);
        check((await types(p)).includes('stk_depth_heat'), tag + ': reload keeps the layer', await types(p));
        check((await theme(p)) === 'Fire', tag + ': reload keeps the theme', await theme(p));
        await p.evaluate(() => window.__stkHeatmapPanel.open()); await sleep(1200);
        check((await st(p)).on, tag + ': reload keeps the panel switch ON');
      }
      if (w < 520) { await shot(p, 'nq-' + tag); }
      if (w > 1000 && thm === 'light') { await shot(p, 'nq-' + tag); }
      await sw(p);
      check(!(await types(p)).includes('stk_depth_heat') && !(await st(p)).on, tag + ': OFF removes the layer', await types(p));
      const rows = await search(p, 'heatmap');
      check(!rows.some((r) => /^Heatmap$/i.test(r.n)), tag + ': the Indicators list has no "Heatmap" entry', rows.map((r) => r.n));
      await closePicker(p);
      if (thm === 'dark' && w > 1000) {
        await setSym(p, 'binance:BTCUSDT'); await sleep(1500);
        await p.evaluate(() => window.__stkHeatmapPanel.open()); await sleep(1800);
        const tb = await tabs(p); check(tb.join() === 'Order book,Liquidations,Options(off)', tag + ': BTC tabs = Order book + Liquidations', tb);
        await sw(p); await sleep(5000);
        check((await types(p)).includes('stk_depth_heat'), tag + ': BTC ON adds the book layer');
        check(await p.evaluate(() => /Denomination/.test(document.querySelector('.stkhm-b').textContent)), tag + ': BTC shows Denomination');
        await clickText(p, 'USD'); await sleep(1200);
        await clickText(p, 'Liquidations'); await sleep(2500);
        const t2 = await types(p); check(t2.includes('stk_liq') && !t2.includes('stk_depth_heat'), tag + ': Liquidations tab swaps the layer', t2);
        check(await p.evaluate(() => !/TP \/ SL|TP-SL/.test(document.querySelector('.stkhm-b').textContent)), tag + ': no TP/SL toggle');
        await sw(p);
        await setSym(p, 'SPY'); await sleep(2500);
        await p.evaluate(() => window.__stkHeatmapPanel.open()); await sleep(2000);
        const ts = await tabs(p); check(ts.join() === 'Order book(off),Liquidations(off),Options', tag + ': SPY tabs = Options only', ts);
        await sw(p); await sleep(3000);
        check((await types(p)).includes('stk_gexheat'), tag + ': SPY ON adds the GEX heatmap layer', await types(p));
        await sw(p);
      }
      check(errors.length === 0, tag + ': no page errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
