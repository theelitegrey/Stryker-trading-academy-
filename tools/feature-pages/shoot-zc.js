// Screenshots for /features/charts and /features/indicators (FEATB, 19 Nov 2026): the REAL ZoroCharts page (charts.html)
// with real futures candles from our /api/chart/bars (tools/tests/chart-dev-server.mjs proxies the same upstream as
// production). Firebase = tools/tests/richstub.js (a signed-in member), every other host is blocked.
// Feed-state words (delayed / real-time / live), exchange and data-provider names are hidden in every capture (brief 19 Nov).
// Output: PNGs (2x) in <outDir>; tools/feature-pages/crop.py turns them into the page webps.
//   node tools/tests/chart-dev-server.mjs 8094 &
//   tools/chrome-slot.sh env CHART_BASE=http://127.0.0.1:8094 node tools/feature-pages/shoot-zc.js <outDir> [scene...]
const fs = require('fs'), path = require('path');
const { launch } = require('../tests/lib.js');
const stub = require('../tests/richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8094';
const OUT = process.argv[2] || '/tmp/zcshots', ONLY = process.argv.slice(3);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(b, { w = 1440, h = 900, mobile = false, light = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile,
    userAgent: mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' : undefined });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((light) => { try {
    ['stryker_install_prompt_shown_u1', 'stryker_push_prompt_shown_u1'].forEach((k) => localStorage.setItem(k, '1'));
    localStorage.setItem('stryker_community_disclaimer_ack_v1', JSON.stringify({ u1: 1, _anon: 1 }));
    localStorage.setItem('tz_consent', JSON.stringify({ v: 1, essential: true, analytics: false, at: new Date().toISOString() }));
    ['stryker.vela.session', 'vela-workspace', 'vela-workspace-090'].forEach((k) => localStorage.removeItem(k));
    if (light) localStorage.setItem('stryker_theme', 'day'); else localStorage.removeItem('stryker_theme');
  } catch (e) {} }, light);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  p.errors = []; p.on('pageerror', (e) => p.errors.push(String(e).slice(0, 160)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.StrykerIndicatorWindow, null, { timeout: 90000 });
  await sleep(2500);
  await p.addStyleTag({ content: '.tzc,.toast,.stk-toast,#stk-toasts,.cookie-notice,#cookie-notice{display:none!important}' }).catch(() => {});
  return { ctx, p };
}
const sym = (p, s, tf) => p.evaluate(async ([s, tf]) => {
  const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe(tf);
  for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 50) break; }
  ws.active.setPriceStyle('candles');
}, [s, tf]);
const ind = (p, k) => p.evaluate((k) => Promise.race([window.StrykerIndicatorWindow.addByKey(k), new Promise((r) => setTimeout(() => r('timeout'), 60000))]), k);
const native = (p, t, inputs) => p.evaluate(([t, i]) => !!window.STRYKER_VELA.chart.addNativeIndicator(t, i ? { inputs: i } : undefined), [t, inputs || null]);
const clearInd = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.chart;
  try { (window.STRYKER_PINE.pineHandles(c) || []).forEach((h) => { try { h.remove(); } catch (e) {} }); } catch (e) {}
  c.indicators().filter((h) => h.nativeType !== 'volume').forEach((h) => { try { c.removeIndicator ? c.removeIndicator(h.id) : h.remove(); } catch (e) {} });
});
// last N bars of the active chart (plus a little room on the right)
const lastBars = (p, n, pad = 6) => p.evaluate(([n, pad]) => {
  const c = window.STRYKER_VELA.chart, raw = c.orchestrator.rawBars, k = raw.length - 1, dt = raw[k].time - raw[k - 1].time;
  c.setVisibleRange({ from: raw[Math.max(0, k - n)].time, to: raw[k].time + pad * dt });
  return raw.slice(-n).map((b) => [b.time, b.high, b.low]);
}, [n, pad]);
// vendor / feed names and timing words never appear in a marketing image (brief 19 Nov)
const scrub = (p) => p.evaluate(() => {
  const hide = /^\s*(Real-time|Realtime|Live|Delayed|Sample)\s*$|min delayed|delayed|updated \d+ min ago|data agreement|Sign for|Connect broker/i;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const hit = [];
  while (w.nextNode()) hit.push(w.currentNode);
  hit.forEach((n) => { const t = n.nodeValue;
    if (hide.test(t) && t.length < 120 && n.parentElement) { const el = n.parentElement.closest('button, a, [class*=pill], [class*=chip]') || n.parentElement; el.style.visibility = 'hidden'; return; }
    const v = t.replace(/\s*·\s*(CME|COMEX|NYMEX|CBOT|BINANCE|Yahoo Finance|Yahoo|TradingView)\b/gi, '').replace(/\b(Yahoo Finance|Yahoo|TradingView|BINANCE)\b\s*·?\s*/gi, '');
    if (v !== t) n.nodeValue = v; });
});
async function shot(p, n, clip) {
  await scrub(p); await p.mouse.move(2, 2).catch(() => {}); await sleep(700);
  await p.screenshot({ path: path.join(OUT, n + '.png'), clip });
  console.log('SHOT', n, p.errors.length ? 'errors ' + p.errors.slice(0, 2).join(' | ') : '');
}
const rect = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, sel);

const scenes = {
  // ZoroCharts page
  async desk(b) {
    const { ctx, p } = await open(b);
    await sym(p, 'futures:NQ1!', '5'); await native(p, 'ema', { length: 20 }); await native(p, 'vwap'); await sleep(1500);
    const bars = await lastBars(p, 150, 10);
    // a few drawings on real swings: a trend line under two lows, a horizontal level at the session high, a long position
    await p.evaluate((bars) => {
      const c = window.STRYKER_VELA.chart, n = bars.length;
      let lo1 = 0; for (let i = 0; i < n / 2; i++) if (bars[i][2] < bars[lo1][2]) lo1 = i;
      let lo2 = Math.floor(n * 0.6); for (let i = Math.floor(n * 0.6); i < n - 5; i++) if (bars[i][2] < bars[lo2][2]) lo2 = i;
      let hi = 0; for (let i = 0; i < n; i++) if (bars[i][1] > bars[hi][1]) hi = i;
      try { c.drawings.add('trendline', { paneId: 'price', anchors: [{ time: bars[lo1][0], price: bars[lo1][2] }, { time: bars[lo2][0], price: bars[lo2][2] }] }); } catch (e) {}
      try { c.drawings.add('hline', { paneId: 'price', anchors: [{ time: bars[hi][0], price: bars[hi][1] }] }); } catch (e) {}
      try { c.drawings.select([]); } catch (e) {}
    }, bars);
    await sleep(1200); await shot(p, 'zc-desk');
    // light theme of the same chart
    await ctx.close();
    const L = await open(b, { light: true });
    await sym(L.p, 'futures:NQ1!', '5'); await native(L.p, 'ema', { length: 20 }); await native(L.p, 'vwap'); await lastBars(L.p, 150, 10); await sleep(1500);
    await shot(L.p, 'zc-desk-light'); await L.ctx.close();
  },
  async pickers(b) {
    const { ctx, p } = await open(b);
    await sym(p, 'futures:ES1!', '15'); await lastBars(p, 160, 8); await sleep(800);
    await p.evaluate(() => window.STRYKER_VELA.symbolPicker.open('')); await sleep(1800); await shot(p, 'zc-symbols');
    await p.keyboard.press('Escape'); await sleep(500);
    await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await sleep(2000); await shot(p, 'zc-indicators');
    await p.keyboard.press('Escape'); await sleep(400);
    await ctx.close();
  },
  async grid(b) {
    const { ctx, p } = await open(b);
    await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('4')); await sleep(1500);
    const S = [['futures:NQ1!', '5'], ['futures:ES1!', '5'], ['futures:GC1!', '15'], ['futures:YM1!', '15']];
    for (let i = 0; i < 4; i++) {
      await p.evaluate((i) => { const ws = window.STRYKER_VELA; ws.setActiveCell(ws.cells()[i].id); }, i);
      await sleep(400); await sym(p, S[i][0], S[i][1]); await lastBars(p, 110, 4);
    }
    await sleep(2500); await shot(p, 'zc-grid'); await ctx.close();
  },
  async replay(b) {
    const { ctx, p } = await open(b);
    await sym(p, 'futures:NQ1!', '5'); await native(p, 'ema', { length: 20 }); await sleep(800);
    await p.evaluate(() => window.__stkBarReplay && window.__stkBarReplay.startRandom()); await sleep(3500);
    await shot(p, 'zc-replay'); await ctx.close();
  },
  async paper(b) {
    const { ctx, p } = await open(b);
    await sym(p, 'futures:NQ1!', '1'); await lastBars(p, 90, 14); await sleep(600);
    // paper trading = demo money, simulated fills (assets/chart-paper.js): one market buy with a 40 / 20 tick bracket
    for (let i = 0; i < 40 && !(await p.evaluate(() => window.__stkPaper && Number.isFinite(window.__stkPaper.account.last['futures:NQ1!']))); i++) await sleep(250);
    await p.evaluate(() => { window.__stkPaper.setEnabled(true); window.__stkPaper.tradeUi(true); window.__stkPaper.openPanel('positions'); window.__stkPaper.openTicket(); });
    await p.waitForSelector('#stkpt-tk:not([hidden])', { timeout: 8000 }).catch(() => {});
    await p.click('#stkpt-tk [data-side=buy]').catch(() => {}); await p.click('#stkpt-tk [data-type=market]').catch(() => {});
    await p.fill('#stkpt-tk input[name=qty]', '1').catch(() => {});
    await p.check('#stkpt-tk input[name=tpon]').catch(() => {}); await p.check('#stkpt-tk input[name=slon]').catch(() => {});
    await p.fill('#stkpt-tk input[name=tpv]', '40').catch(() => {}); await p.fill('#stkpt-tk input[name=slv]', '20').catch(() => {});
    await sleep(500); await shot(p, 'zc-ticket');
    await p.click('#stkpt-tk .stkpt-go').catch(() => {}); await sleep(2500);
    console.log('paper position', await p.evaluate(() => JSON.stringify(window.__stkPaper.account.position('futures:NQ1!'))));
    await shot(p, 'zc-paper'); await ctx.close();
  },
  async phone(b) {
    for (const light of [false, true]) {
      const { ctx, p } = await open(b, { w: 390, h: 844, mobile: true, light });
      await sym(p, 'futures:NQ1!', '5'); await native(p, 'ema', { length: 20 }); await lastBars(p, 70, 4); await sleep(1500);
      await shot(p, light ? 'zc-phone-light' : 'zc-phone'); await ctx.close();
    }
  },
  // Indicators page: TradeZoro scripts on a real NQ chart
  async scripts(b) {
    const { ctx, p } = await open(b);
    await sym(p, 'futures:NQ1!', '5');
    // Pine tables stay out of the images (some scripts print stats there; result figures never go on a public page)
    await p.evaluate(() => { const sl = window.STRYKER_VELA.chart.renderer.renderer.indicatorSlices, proto = Object.getPrototypeOf(sl), orig = proto.paintEntry;
      proto.paintEntry = function (ctx, e) { return orig.apply(this, [ctx, e && e.tables && e.tables.length ? Object.assign({}, e, { tables: [] }) : e].concat([].slice.call(arguments, 2))); }; });
    const K = { 'ind-liquidity-master': 'x:liquidity-master-tradezoro', 'ind-smt': 'x:smt-pro-stryker', 'ind-ifvg': 'x:ifvg-pro-stryker',
      'ind-fvg-relay': 'x:fvg-relay-stryker', 'ind-po3': 'x:htf-po3-lens-stryker', 'ind-fractal': 'x:tz-fractal-model', 'ind-sweep': 'x:session-sweep-smt-ifvg' };
    for (const [n, k] of Object.entries(K)) {
      if (process.env.IND && !process.env.IND.split(',').includes(n)) continue;
      await clearInd(p); await sleep(500);
      const ok = await ind(p, k); await sleep(9000); await lastBars(p, 220, 14); await sleep(2000);
      console.log(n, ok); await shot(p, n);
    }
    // the Indicators window on the TradeZoro tab
    await clearInd(p);
    await p.evaluate(() => window.StrykerIndicatorWindow.open()); await sleep(1500);
    await p.evaluate(() => { const t = [...document.querySelectorAll('button, a, [role=tab], li')].find((x) => /^\s*TradeZoro\s*\d*\s*$/.test(x.textContent)); t && t.click(); }); await sleep(1500);
    await shot(p, 'ind-window'); await ctx.close();
  },
};

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=900'] });
  try { for (const [n, fn] of Object.entries(scenes)) if (!ONLY.length || ONLY.includes(n)) { try { await fn(b); } catch (e) { console.log('SCENE FAIL', n, String(e).slice(0, 300)); } } }
  finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
