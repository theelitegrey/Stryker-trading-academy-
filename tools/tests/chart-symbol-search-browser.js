// Symbol search after the lazy crypto symbol lists (assets/vela-chart.js lateLists), REAL taps / clicks:
// tap the chart's symbol button, type BTC then NQ, the list shows matching rows; phone 390 + desktop
// 1440, both engines. Exchanges are not reachable here, so the crypto venues' symbol lists come from a
// small mocked answer (same shape as Binance / Hyperliquid / Coinbase) served by Playwright for
// those hosts only; the chart page itself is the speed server (no route() on it).
//   node tools/tests/chart-speed-server.mjs 8261 &
//   CHART_BASE=http://127.0.0.1:8261 node tools/tests/chart-symbol-search-browser.js [shotsDir]
const fs = require('fs');
const { launch } = require('./lib.js');
const { speedInit } = require('./chart-phone-speed-init.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8261';
const OUT = process.argv[2];
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const BIN_SPOT = { symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }] }, { symbol: 'ETHUSDT', status: 'TRADING', baseAsset: 'ETH', quoteAsset: 'USDT', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }] }] };
const BIN_FUT = { symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', contractType: 'PERPETUAL', baseAsset: 'BTC', quoteAsset: 'USDT', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] }] };
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600'] });
  for (const eng of ['0.9', '0.6']) {
    for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
      const tag = 'v' + eng + '-' + w;
      const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' : undefined });
      await speedInit(ctx);
      // Playwright tries the LAST registered route first: the catch-all goes first, the exchanges after
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
      const asked = [];
      await ctx.route(/^https:\/\/(api\.binance\.com|fapi\.binance\.com|api\.binance\.us|api\.hyperliquid\.xyz|api\.exchange\.coinbase\.com)\//, (r) => {
        const u = r.request().url(); asked.push(u.slice(0, 60));
        if (/\/ping/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        if (/fapi\/v1\/exchangeInfo/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BIN_FUT) });
        if (/exchangeInfo/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BIN_SPOT) });
        if (/coinbase/.test(u) && /products$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'BTC-USD', base_currency: 'BTC', quote_currency: 'USD', status: 'online', trading_disabled: false, quote_increment: '0.01' }]) });
        return r.abort();
      });
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
      await p.goto(BASE + '/charts.html?vela=' + eng, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkFirstCandles && window.__stkOneBar, null, { timeout: 60000 });
      await sleep(2500);
      // the symbol button: a visible button whose own text is the chart symbol (NQ1!)
      const bb = await p.evaluate(() => {
        const c = [...document.querySelectorAll('button, [role=button]')].filter((e) => e.getClientRects().length && /^\s*NQ1!/.test(e.textContent) && e.textContent.length < 40);
        c.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        const e = c[0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: e.textContent.trim().slice(0, 20) };
      });
      check(!!bb, tag + ': symbol button found', bb);
      if (!bb) { await ctx.close(); continue; }
      for (const q of ['BTC', 'NQ']) {
        if (mobile) await p.touchscreen.tap(bb.x, bb.y); else await p.mouse.click(bb.x, bb.y);
        await sleep(900);
        const inp = await p.evaluate(() => { const i = [...document.querySelectorAll('input')].find((x) => x.getClientRects().length && /search|symbol/i.test((x.placeholder || '') + (x.getAttribute('aria-label') || '') + (x.className || ''))); return !!i; });
        check(inp, tag + ': tapping the symbol opens search (' + q + ')');
        await p.keyboard.type(q, { delay: 60 });
        let rows = [];
        for (let i = 0; i < 20; i++) {
          await sleep(300);
          rows = await p.evaluate(() => [...document.querySelectorAll('.vela-sp-row')].filter((e) => e.getClientRects().length).map((e) => ((e.querySelector('.vela-sp-ticker') || e).textContent || '').trim().slice(0, 24)));
          if (rows.some((t) => t.toUpperCase().includes(q))) break;
        }
        check(rows.some((t) => t.toUpperCase().includes(q)), tag + ': search "' + q + '" lists matching rows', rows.slice(0, 6));
        if (OUT) await p.screenshot({ path: OUT + '/' + tag + '-' + q + '.png' });
        await p.keyboard.press('Escape'); await sleep(500);
        await p.evaluate(() => { const i = document.activeElement; if (i && i.blur) i.blur(); });
      }
      check(asked.some((u) => /exchangeInfo/.test(u)), tag + ': crypto lists were fetched (after candles / on the tap)', asked.length);
      check(errors.length === 0, tag + ': no page errors', errors);
      await ctx.close();
    }
  }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
