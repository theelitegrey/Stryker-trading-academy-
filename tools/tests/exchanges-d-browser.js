// Bitget + Kraken in the browser, REAL public endpoints (needs network; not run in CI).
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/exchanges-d-browser.js <shotsDir>
// Per symbol (bitget:BTCUSDT.P, bitget:BTCUSDT, kraken:XBTUSD): candles paint, last bar moves within 30 s, D / 4h load,
// older bars page in, the Book panel and Trades tab fill. Plus symbol search finds both venues. Shots 390/412/1440 dark + 1440 light.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
const SYMS = [['bitget:BTCUSDT.P', 'bitget'], ['bitget:BTCUSDT', 'bitget'], ['kraken:XBTUSD', 'kraken']];

async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); if (t) localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.removeItem('stkbp.v1'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net|api\.bitget\.com|ws\.bitget\.com|api\.kraken\.com|ws\.kraken\.com|futures\.kraken\.com|static\.ledger\.com)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource|binance\.com|451/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(1500);
  return { ctx, p, errors };
}
const setSym = (p, sym, tf) => p.evaluate(async ([s, tf]) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe(tf || '1'); for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === s && c.orchestrator.rawBars.length > 20) break; } const c = ws.chart; return { sym: c.market.symbol, n: c.orchestrator.rawBars.length }; }, [sym, tf]);
const last = (p) => p.evaluate(() => { const r = window.STRYKER_VELA.chart.orchestrator.rawBars; const b = r[r.length - 1]; return b ? { t: b.time, c: b.close, v: b.volume, n: r.length, first: r[0].time } : null; });
const pickSrc = (p, v) => p.evaluate((v) => { const s = document.querySelector('.stkbp-src'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, v);

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const { ctx, p, errors } = await open(b, { w: 1440, h: 900, theme: 'dark' });
    for (const [sym, v] of SYMS) {
      const r = await setSym(p, sym, '1');
      check(r.sym === sym && r.n > 20, sym + ': 1m candles load (' + r.n + ' bars)', r);
      const a = await last(p); check(a && a.c > 100 && a.t % 60000 === 0, sym + ': newest bar sane', a);
      const n0 = a.n;
      await p.evaluate(() => { const c = window.STRYKER_VELA.chart; try { c.scrollToTime ? c.scrollToTime(Date.now() - 6 * 864e5) : c.setVisibleRange && c.setVisibleRange({ from: Date.now() - 6 * 864e5, to: Date.now() }); } catch (e) {} });
      await sleep(5000);
      const a2 = await last(p); check(a2.n > n0 || a2.first < a.first, sym + ': older bars page in (' + n0 + ' -> ' + a2.n + ')', [a.first, a2.first]);
      let moved = false; const t0 = Date.now();
      while (Date.now() - t0 < 30000) { await sleep(1500); const x = await last(p); if (x.c !== a2.c || x.v !== a2.v || x.t !== a2.t) { moved = true; break; } }
      check(moved, sym + ': last bar updates within 30 s');
      for (const tf of ['D', '240']) { const q = await setSym(p, sym, tf); check(q.n > 20, sym + ': timeframe ' + tf + ' loads (' + q.n + ' bars)', q); }
      await setSym(p, sym, '1');
      const credit = await p.evaluate(() => (document.querySelector('.stkchart-credit') || {}).textContent || '');
      check(/Crypto: public exchange market data/.test(credit), sym + ': source line is the crypto line', credit.slice(0, 80));
      check(!/real-?time/i.test(credit), sym + ': no "real-time" wording');
      await p.evaluate(() => window.__stkBookPanel.open()); await sleep(500);
      await pickSrc(p, v);
      let rows = 0; for (let i = 0; i < 20 && rows < 9; i++) { await sleep(800); rows = await p.evaluate(() => document.querySelectorAll('.stkbp-list .stkbp-r').length); }
      check(rows >= 9, sym + ': Book panel fills (' + rows + ' rows)');
      await p.click('.stkbp-tabs [data-t=trades]'); let tr = 0; for (let i = 0; i < 20 && tr < 1; i++) { await sleep(800); tr = await p.evaluate(() => document.querySelectorAll('.stkbp-list .stkbp-r').length); }
      check(tr >= 1, sym + ': Trades tab shows trades (' + tr + ')');
      await p.click('.stkbp-tabs [data-t=book]');
      await p.evaluate(() => window.__stkBookPanel.close && window.__stkBookPanel.close());
    }
    for (const q of ['BTCUSDT', 'XBT']) {
      await p.evaluate(() => { const c = [...document.querySelectorAll('button, [role=button]')].filter((e) => e.getClientRects().length && /^\s*(BITGET|KRAKEN|BTC|XBT)/i.test(e.textContent) && e.textContent.length < 40).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]; c && c.click(); });
      await sleep(900);
      await p.keyboard.type(q, { delay: 50 });
      let rows = []; for (let i = 0; i < 30; i++) { await sleep(400); rows = await p.evaluate(() => [...document.querySelectorAll('.vela-sp-row')].filter((e) => e.getClientRects().length).map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60))); if (rows.some((t) => /bitget|kraken/i.test(t))) break; }
      const want = q === 'XBT' ? /kraken/i : /bitget/i;
      check(rows.some((t) => want.test(t)), 'search "' + q + '" lists ' + want, rows.slice(0, 8));
      await p.screenshot({ path: OUT + '/D-search-' + q + '.png' });
      await p.keyboard.press('Escape'); await sleep(500);
    }
    check(errors.length === 0, 'no console / page errors', errors);
    await ctx.close();

    for (const [w, h, mobile, theme, tag] of [[1440, 900, false, 'dark', '1440-dark'], [1440, 900, false, 'light', '1440-light'], [390, 844, true, 'dark', '390-dark'], [412, 915, true, 'dark', '412-dark']]) {
      const o = await open(b, { w, h, mobile, theme });
      for (const [sym, v] of [['bitget:BTCUSDT.P', 'bitget'], ['kraken:XBTUSD', 'kraken']]) {
        await setSym(o.p, sym, '15'); await sleep(2500);
        await o.p.evaluate(() => window.__stkBookPanel.open()); await sleep(500);
        await pickSrc(o.p, v);
        await sleep(5000);
        check(await o.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ' ' + sym + ': no horizontal overflow');
        await o.p.screenshot({ path: OUT + '/D-' + v + '-' + tag + '.png' });
        await o.p.evaluate(() => window.__stkBookPanel.close && window.__stkBookPanel.close()); await sleep(400);
      }
      await o.ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
