// OKX end to end in a real browser on the LIVE public network (no fixtures): candles paint, price moves, symbol list has
// spot + perpetuals, Book panel and Trades fill. Shots: <dir>/C-*.png.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8735 flock /tmp/stryker-chrome.lock node tools/tests/okx-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8735';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
const SYMS = (process.env.SYMS || 'okx:BTC-USDT-SWAP,okx:ETH-USDT').split(',');
async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); if (t) localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/firestore|Firebase|googleapis|ERR_FAILED|net::|status of 4|status of 5|451|Failed to load resource|Ping received|Unexpected response code/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)))
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(1500);
  return { ctx, p, errors };
}
const setSym = (p, s, tf) => p.evaluate(async ([s, tf]) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe(tf); for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === s && ws.chart.orchestrator.rawBars.length > 20) break; } return ws.chart.orchestrator.rawBars.length; }, [s, tf]);
const last = (p) => p.evaluate(() => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars; const l = rb[rb.length - 1]; return { n: rb.length, c: l && (l.close != null ? l.close : l.c), t: l && (l.time != null ? l.time : l.t) }; });
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, theme, tag] of [[1440, 900, false, 'dark', '1440-dark'], [1440, 900, false, 'light', '1440-light'], [390, 844, true, 'dark', '390-dark'], [412, 915, true, 'dark', '412-dark']]) {
      const { ctx, p, errors } = await open(b, { w, h, mobile, theme });
      for (const sym of SYMS) {
        await setSym(p, sym, '15');
        const a = await last(p);
        check(a.n > 100 && a.c > 0, tag + ' ' + sym + ': 15m candles loaded (' + a.n + ')', a);
        if (tag === '1440-dark') {
          await setSym(p, sym, '1');
          const f = await last(p); let moved = false;
          for (let i = 0; i < 30 && !moved; i++) { await sleep(1000); const n = await last(p); moved = n.c !== f.c || n.t !== f.t || n.n !== f.n; }
          check(moved, sym + ': last price / bar updates within 30 s', f);
          for (const tf of ['5', '60', '240', 'D', 'W']) { await setSym(p, sym, tf); const x = await last(p); check(x.n > 50, sym + ': timeframe ' + tf + ' (' + x.n + ' bars)'); }
        }
        await setSym(p, sym, '15'); await sleep(600);
        await p.screenshot({ path: OUT + '/C-' + sym.replace(/[^A-Za-z0-9]/g, '') + '-' + tag + '.png' });
      }
      const found = await p.evaluate(async () => { const m = await import('/assets/vendor/vela-0.6.17-s3/providers/okx.js'); const l = await new m.OkxProvider().listSymbols(); return { n: l.length, spot: l.some((x) => x.ticker === 'BTC-USDT'), swap: l.some((x) => x.ticker === 'BTC-USDT-SWAP') }; });
      check(found.spot && found.swap && found.n > 200, tag + ': OKX symbol list has spot + perpetuals (' + found.n + ')', found);
      const credit = await p.evaluate(() => (document.querySelector('.stkchart-credit') || {}).textContent || '');
      check(/public exchange market data/i.test(credit) && !/real-time/i.test(credit), tag + ': credit line names crypto data, no real-time claim', credit);
      await setSym(p, 'okx:BTC-USDT-SWAP', '1');
      await p.evaluate(() => window.__stkBookPanel.open());
      await sleep(500);
      await p.selectOption('.stkbp-src', 'okx').catch(() => {});
      await (mobile ? p.tap('.stkbp-tabs [data-t=book]') : p.click('.stkbp-tabs [data-t=book]')).catch(() => {});
      let rows = 0; for (let i = 0; i < 20 && rows < 9; i++) { await sleep(1000); rows = await p.evaluate(() => document.querySelectorAll('.stkbp-list .stkbp-r').length); }
      check(rows >= 9, tag + ': Book panel fills from OKX (' + rows + ' rows)');
      await p.screenshot({ path: OUT + '/C-book-' + tag + '.png' });
      const sel = '.stkbp-tabs [data-t=trades]';
      await (mobile ? p.tap(sel) : p.click(sel)).catch(() => {});
      let tr = 0; for (let i = 0; i < 20 && !tr; i++) { await sleep(1000); tr = await p.evaluate(() => document.querySelectorAll('.stkbp-list .stkbp-r').length); }
      check(tr > 0, tag + ': Trades tab shows prints (' + tr + ')');
      check(errors.filter((e) => !/firestore|firebase|googleapis|CORS/i.test(e)).length === 0, tag + ': no console errors', errors.filter((e) => !/firestore|googleapis|CORS/i.test(e)));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
