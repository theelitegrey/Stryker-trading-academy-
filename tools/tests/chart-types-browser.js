// Chart types browser test + contact sheet.  CHART_BASE=http://127.0.0.1:8033 node tools/tests/chart-types-browser.js [shotsDir] [ids,csv] [sym] [tf]
// Switches the chart through every extra type: no console errors, crosshair works, last element moves on a live tick.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8033';
const OUT = process.argv[2] || '/tmp/ct';
const IDS = (process.argv[3] || '').split(',').filter(Boolean);
const SYM = process.argv[4] || 'binance:BTCUSDT';
const TF = process.argv[5] || '1';
require('fs').mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const ALL = ['candles', 'bars', 'stk_hollow', 'stk_volcandle', 'line', 'stk_linemark', 'stk_step', 'area', 'stk_hlcarea', 'baseline', 'stk_columns', 'stk_highlow', 'stk_fp', 'heikinashi', 'stk_renko', 'stk_linebreak', 'stk_kagi', 'stk_pnf', 'stk_range'];

(async () => {
  const b = await launch();
  const sizes = [{ w: 390, h: 800, mobile: true, tag: '390' }, { w: 1440, h: 900, tag: '1440' }];
  for (const theme of ['dark', 'day']) for (const z of sizes) {
    if (theme === 'day' && z.tag === '390') continue;
    const ctx = await b.newContext({ viewport: { width: z.w, height: z.h }, deviceScaleFactor: z.mobile ? 2 : 1, isMobile: !!z.mobile, hasTouch: !!z.mobile });
    await ctx.addInitScript(stub);
    await ctx.addInitScript(([t, sym, tf]) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, [theme, SYM, TF]);
    await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|WebSocket|Failed to load resource|blocked by CORS/.test(m.text())) errors.push(m.text()); });
    await p.goto(BASE + '/charts.html?symbol=' + encodeURIComponent(SYM) + '&tf=' + TF, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && document.querySelector('.vela-cell'), null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(3500);
    const info = await p.evaluate(() => { const ws = window.STRYKER_VELA; const c = ws.active; return { sym: c.symbol, tf: c.timeframe, n: (c.chart && c.chart.bars && c.chart.bars.length) || null }; });
    console.log(theme, z.tag, 'chart', JSON.stringify(info));
    const ids = IDS.length ? IDS : ALL;
    for (const id of ids) {
      errors.length = 0;
      const r = await p.evaluate(async (id) => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const ws = window.STRYKER_VELA; const c = ws.active;
        try { c.setPriceStyle(id); } catch (e) { return { err: String(e) }; }
        await wait(1400);
        const o = c.inner.orchestrator;
        const bars = o.bars;
        const last = bars[bars.length - 1];
        // live tick: push a +/-1.5% move into the newest raw bar; the last element must change (or a new one appear)
        const raw = o.rawBars, rl = raw[raw.length - 1], before = JSON.stringify(bars[bars.length - 1]), n0 = bars.length;
        const px = rl.close * 1.015;
        o.applyBar({ ...rl, high: Math.max(rl.high, px), close: px });
        await wait(300);
        const after = o.bars, moved = after.length !== n0 || JSON.stringify(after[after.length - 1]) !== before;
        o.applyBar(rl); await wait(200);
        return { style: c.priceStyle, n: bars.length, moved, last: last ? [last.open, last.high, last.low, last.close].map((x) => +x.toFixed(2)) : null };
      }, id);
      const host = await p.$('#vela-chart');
      if (host) {
        const bb = await host.boundingBox();
        await p.mouse.move(bb.x + bb.width * 0.6, bb.y + bb.height * 0.45); await p.waitForTimeout(250);
      }
      await p.screenshot({ path: `${OUT}/${theme}-${z.tag}-${id}.png` });
      check(!r.err && r.style === id && r.n > 0 && r.moved && errors.length === 0, `${theme} ${z.tag} ${id}`, { r, errors: errors.slice(0, 3) });
    }
    await ctx.close();
  }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'all ok');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
