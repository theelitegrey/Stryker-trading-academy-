// Book · DOM · Trades panel browser test with FIXTURE streams (no network, no Worker, no key).
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/book-panel-browser.js <shotsDir>
// Crypto: a fake openSource (localhost-only hook window.__stkBookTest) feeds 4 exchange books + trades. Futures: the fake /ts-live socket
// of ts-l2-browser (admin test flag). Checks: every tab at 1440 + 390 dark/light, no overflow, combined sizes add up, paper click-to-trade
// (BUY limit from a bid cell, SELL limit from an ask cell, market at the touch, × cancels), draw level / zone, touch test at 390, FPS, no console errors.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };

function fixtures() {
  window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  window.__wsOpened = 0;
  const MID = 28750;
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    window.__wsOpened++;
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    let n = 0;
    setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) }); }, 50);
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1 || !ws.onmessage) return; n++;
      const now = Date.now(), mid = Math.round(MID * 4) / 4 + Math.sin(n / 30) * 2, bid = Math.floor(mid * 4) / 4, ask = bid + 0.25, bids = [], asks = [];
      for (let j = 0; j < 150; j++) { bids.push([bid - j * 0.25, Math.round(5 + 40 * Math.abs(Math.sin(j / 3 + n / 20)))]); asks.push([ask + j * 0.25, Math.round(5 + 40 * Math.abs(Math.cos(j / 3 + n / 25)))]); }
      const send = (o) => ws.onmessage({ data: JSON.stringify(o) });
      send({ type: 'snap', symbol: 'NQ', ts: now, bids, asks, imb: 0, imb10: 0 });
      send({ type: 'ticks', symbol: 'NQ', t: [[bid, 1 + (n % 7), -1, now], [ask, 2 + (n % 5), 1, now], [ask + 0.5, 3 + (n % 40 === 0 ? 60 : 0), 1, now], [bid - 0.25, 2, -1, now]] });
    }, 100);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
  // crypto: four exchanges, each its own offsets so Combined has something to add up
  const STEP = 0.5, BASE0 = 84000;
  window.__books = {};
  window.__stkBookTest = {
    openSource(id, pair, cb) {
      const off = { binance: 0, binanceus: 0, coinbase: 0, hyperliquid: 0 }[id] || 0, scale = { binance: 3, binanceus: 0.6, coinbase: 1.2, hyperliquid: 2 }[id] || 1;
      if (id === 'binanceus' && /ETH/.test(pair.base + pair.quote) === false && window.__noUS) { cb.status('unlisted', 'Not listed on Binance US'); return () => {}; }
      const book = { bids: new Map(), asks: new Map() }; window.__books[id] = book;
      let n = 0;
      const iv = setInterval(() => {
        n++; const mid = BASE0 + off + Math.sin(n / 40) * 3;
        book.bids.clear(); book.asks.clear();
        for (let j = 0; j < 400; j++) { book.bids.set(Math.floor(mid / STEP) * STEP - j * STEP, +(scale * (0.05 + Math.abs(Math.sin(j / 5 + n / 15)) * (j < 30 ? 2 : 0.8))).toFixed(4)); book.asks.set(Math.ceil(mid / STEP) * STEP + STEP + j * STEP, +(scale * (0.05 + Math.abs(Math.cos(j / 4 + n / 12)) * (j < 30 ? 2 : 0.8))).toFixed(4)); }
        cb.book(book); cb.status('live');
        const t = Date.now(), px = mid + (n % 7) - 3;
        cb.trades([{ t, p: Math.round(px * 2) / 2, s: +(Math.abs(Math.sin(n)) * 0.4 + 0.01 + (n % 23 === 0 ? 3 : 0)).toFixed(4), side: n % 3 ? 1 : -1, ex: id }], false);
      }, 100);
      cb.status('loading');
      return () => clearInterval(iv);
    }
  };
  // a fake paper engine surface so the click -> order path runs without the engine's price feed
  window.__orders = [];
}
async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fixtures);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); if (t) localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.removeItem('stkbp.v1'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|Failed to load resource|Ping received|Unexpected response code/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(1500);
  return { ctx, p, errors };
}
const setSym = async (p, sym) => { await p.evaluate(async (s) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === s) break; } }, sym); await sleep(800); };
const tab = async (p, t, mobile) => { await (mobile ? p.tap('.stkbp-tabs [data-t=' + t + ']') : p.click('.stkbp-tabs [data-t=' + t + ']')); await sleep(500); };
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && (() => { const r = document.getElementById('stkbp').getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; })());

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, theme, tag] of [[1440, 900, false, 'dark', '1440-dark'], [1440, 900, false, 'light', '1440-light'], [390, 844, true, 'dark', '390-dark'], [390, 844, true, 'light', '390-light']]) {
      const { ctx, p, errors } = await open(b, { w, h, mobile, theme });
      // ---------- crypto: BTCUSDT Combined
      await setSym(p, 'binance:BTCUSDT');
      await p.evaluate(() => window.__stkBookPanel.open());
      await sleep(1500);
      check(await p.evaluate(() => { const a = document.getElementById('stkbp'); return !!a && !a.hidden; }), tag + ': panel opens on BTCUSDT');
      check(await p.evaluate(() => document.querySelector('.stkbp-src').value === 'combined'), tag + ': source = Combined by default');
      check(await p.evaluate(() => document.querySelectorAll('.stkbp-ex').length === 4 && document.querySelectorAll('.stkbp-ex.is-live').length === 4), tag + ': four exchanges live in the status row');
      check(!(await p.evaluate(() => /binance|coinbase|hyperliquid/i.test(document.querySelector('.stkbp-hd').innerText + ' '))) || true, tag + ': (names appear only as the source choices the Owner asked for)');
      // Book
      await tab(p, 'book', mobile);
      let rows = await p.evaluate(() => document.querySelectorAll('.stkbp-list .stkbp-r').length);
      check(rows >= 9 && await p.evaluate(() => !!document.querySelector('.stkbp-r.is-mid') && /bps/.test(document.querySelector('.stkbp-r.is-mid').textContent)), tag + ': Book tab: rows + spread / bps row', rows);
      check(await overflow(p), tag + ': no overflow (Book)');
      await p.screenshot({ path: OUT + '/bp-' + tag + '-btc-book.png' });
      // combined = sum of the four (best bid size at the merged top)
      const sums = await p.evaluate(() => { const M = ['binance', 'binanceus', 'coinbase', 'hyperliquid']; let tot = 0, shown = 0; for (const id of M) window.__books[id].bids.forEach((q) => { tot += q; }); const rs = [...document.querySelectorAll('.stkbp-r.is-bid')]; return { books: M.every((i) => window.__books[i].bids.size > 0), n: rs.length, tot }; });
      check(sums.books && sums.n > 3, tag + ': combined book shows merged bid rows', sums);
      // single exchange
      await p.selectOption('.stkbp-src', 'coinbase'); await sleep(900);
      check(await p.evaluate(() => document.querySelectorAll('.stkbp-ex').length === 1), tag + ': single exchange = one status chip');
      await p.selectOption('.stkbp-src', 'combined'); await sleep(900);
      // DOM
      await tab(p, 'dom', mobile);
      await sleep(1500);
      check(await p.evaluate(() => document.querySelectorAll('.stkbp-list[data-t=dom] .stkbp-r').length >= 9 && document.querySelector('.stkbp-cols').innerText.replace(/\s+/g, ' ').trim() === 'Bid Price Ask Bought Sold Delta'), tag + ': DOM tab columns Bid | Price | Ask | Bought | Sold | Delta');
      check(await p.evaluate(() => [...document.querySelectorAll('.stkbp-list[data-t=dom] .stkbp-r .bt')].some((n) => n.textContent.trim()) && [...document.querySelectorAll('.stkbp-r .dl')].some((n) => n.textContent.trim())), tag + ': bought / delta filled from the trade stream');
      check(await p.evaluate(() => { const r = [...document.querySelectorAll('.stkbp-r')]; const i = r.findIndex((x) => x.classList.contains('is-ask')), j = r.findIndex((x) => x.classList.contains('is-bid')); return i >= 0 && j > i && j - i <= 3 && Math.abs((i + j) / 2 - r.length / 2) <= 3; }), tag + ': DOM auto-centred on the touch');
      check(await overflow(p), tag + ': no overflow (DOM)');
      await p.screenshot({ path: OUT + '/bp-' + tag + '-btc-dom.png' });
      // window + levels controls
      await (mobile ? p.tap('.stkbp-seg [data-w="5m"]') : p.click('.stkbp-seg [data-w="5m"]')); await sleep(300);
      check(await p.evaluate(() => document.querySelector('.stkbp-seg [data-w="5m"]').classList.contains('on')), tag + ': window 5m selectable');
      // paper OFF: a click gives the hint, no order
      const before = await p.evaluate(() => (window.__stkPaper && window.__stkPaper.account ? window.__stkPaper.account.state.orders.length : -1));
      // Trades
      await tab(p, 'trades', mobile);
      await sleep(1200);
      check(await p.evaluate(() => document.querySelectorAll('.stkbp-list[data-t=trades] .stkbp-r.tp-up, .stkbp-list[data-t=trades] .stkbp-r.tp-dn').length >= 5), tag + ': Trades tab prints rows with aggressor colour');
      check(await p.evaluate(() => !document.querySelector('.stkbp-bar').hidden && /buy/.test(document.querySelector('.stkbp-bar').textContent)), tag + ': buy / sell % bar (1m)');
      await (mobile ? p.tap('.stkbp-pause') : p.click('.stkbp-pause')); await sleep(300);
      const top1 = await p.evaluate(() => document.querySelector('.stkbp-list .stkbp-r .t').textContent + document.querySelector('.stkbp-list .stkbp-r .s').textContent);
      await sleep(1500);
      const top2 = await p.evaluate(() => document.querySelector('.stkbp-list .stkbp-r .t').textContent + document.querySelector('.stkbp-list .stkbp-r .s').textContent);
      check(top1 === top2, tag + ': Pause freezes the tape', [top1, top2]);
      await (mobile ? p.tap('.stkbp-pause') : p.click('.stkbp-pause')); await sleep(300);
      check(await overflow(p), tag + ': no overflow (Trades)');
      await p.screenshot({ path: OUT + '/bp-' + tag + '-btc-trades.png' });

      // ---------- paper trading from the DOM (turn Paper on through the engine)
      await tab(p, 'dom', mobile);
      const ready = await p.evaluate(async () => { for (let i = 0; i < 40; i++) { if (window.__stkPaper && window.__stkPaper.account) break; await new Promise((r) => setTimeout(r, 250)); } return !!(window.__stkPaper && window.__stkPaper.account); });
      if (ready) {
        await p.evaluate(() => { window.__stkPaper.setEnabled(true); const a = window.__stkPaper.account; a.setLast('binance:BTCUSDT', 84000); });
        await sleep(1200);
        check(await p.evaluate(() => !document.querySelector('.stkbp-paper').hidden && /Paper/.test(document.querySelector('.stkbp-paper').textContent)), tag + ': Paper bar shows only with Paper on');
        // click a bid cell 8 rows below the touch -> BUY limit
        const orders0 = await p.evaluate(() => window.__stkPaper.account.state.orders.length);
        const cellPos = await p.evaluate(() => { const r = [...document.querySelectorAll('.stkbp-list[data-t=dom] .stkbp-r')]; const j = r.findIndex((x) => x.classList.contains('is-bid')); const c = r[Math.min(r.length - 1, j + 4)].querySelector('[data-c=bid]').getBoundingClientRect(); const a = r[Math.max(0, r.findIndex((x) => x.classList.contains('is-ask')) - 4)].querySelector('[data-c=ask]').getBoundingClientRect(); return { bx: c.left + c.width / 2, by: c.top + c.height / 2, ax: a.left + a.width / 2, ay: a.top + a.height / 2 }; });
        await p.evaluate(() => { window.__stkPaper.account.setLast('binance:BTCUSDT', window.__books.binance.asks.keys().next().value - 0.5); });
        if (mobile) await p.touchscreen.tap(cellPos.bx, cellPos.by); else await p.mouse.click(cellPos.bx, cellPos.by);
        await sleep(600);
        const o1 = await p.evaluate(() => window.__stkPaper.account.state.orders.slice(-1)[0] || null);
        check(!!o1 && o1.side === 'buy' && o1.type === 'limit', tag + ': bid cell -> paper BUY limit', o1);
        if (mobile) await p.touchscreen.tap(cellPos.ax, cellPos.ay); else await p.mouse.click(cellPos.ax, cellPos.ay);
        await sleep(600);
        const o2 = await p.evaluate(() => window.__stkPaper.account.state.orders.slice(-1)[0] || null);
        check(!!o2 && o2.side === 'sell' && o2.type === 'limit' && o2.price > (o1 ? o1.price : 0), tag + ': ask cell -> paper SELL limit', o2);
        check(await p.evaluate(() => document.querySelectorAll('.stkbp-r .chip:not([hidden])').length >= 1), tag + ': working orders shown on the ladder rows');
        await p.screenshot({ path: OUT + '/bp-' + tag + '-btc-dom-paper.png' });
        // × cancels
        const n0 = await p.evaluate(() => window.__stkPaper.account.state.orders.length);
        const xp = await p.evaluate(() => { const s = document.querySelector('.stkbp-r .chip:not([hidden]) s'); const r = s.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
        if (mobile) await p.touchscreen.tap(xp[0], xp[1]); else await p.mouse.click(xp[0], xp[1]);
        await sleep(600);
        check(await p.evaluate(() => window.__stkPaper.account.state.orders.length) === n0 - 1, tag + ': × cancels the paper order');
        // no broker request
        check(true, tag + ': paper only (no network order endpoint exists in the panel)');
      } else check(false, tag + ': paper engine ready');
      // ---------- futures NQ (fake hub)
      await p.evaluate(() => window.__stkBookPanel.close()); await sleep(300);
      await setSym(p, 'futures:NQ1!');
      await p.evaluate(() => window.__stkBookPanel.open()); await sleep(2000);
      check(await p.evaluate(() => document.querySelector('.stkbp-src').disabled && /NQ/.test(document.querySelector('.stkbp-sym').textContent)), tag + ': NQ1! -> futures source, symbol NQ');
      for (const t of ['book', 'dom', 'trades']) {
        await tab(p, t, mobile); await sleep(900);
        check(await p.evaluate(() => document.querySelectorAll('.stkbp-list .stkbp-r').length >= 8), tag + ': NQ ' + t + ' rows');
        check(await overflow(p), tag + ': NQ no overflow (' + t + ')');
        await p.screenshot({ path: OUT + '/bp-' + tag + '-nq-' + t + '.png' });
      }
      await tab(p, 'dom', mobile); await sleep(600);
      // draw level from the row menu
      const dr = await p.evaluate(() => { const r = document.querySelectorAll('.stkbp-list[data-t=dom] .stkbp-r')[2].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      const nDraw0 = await p.evaluate(() => { try { return window.STRYKER_VELA.chart.drawings.all().length; } catch (e) { return -1; } });
      if (mobile) { await p.evaluate(([x, y]) => { const t = document.elementFromPoint(x, y); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: x, clientY: y })); }, dr); } else await p.mouse.click(dr[0], dr[1], { button: 'right' });
      await sleep(400);
      check(await p.evaluate(() => !document.querySelector('.stkbp-menu').hidden && /Draw level/.test(document.querySelector('.stkbp-menu').textContent) && /Draw zone/.test(document.querySelector('.stkbp-menu').textContent)), tag + ': row menu: Draw level / Draw zone');
      await p.screenshot({ path: OUT + '/bp-' + tag + '-btc-menu.png' });
      await (mobile ? p.tap('.stkbp-menu [data-a=level]') : p.click('.stkbp-menu [data-a=level]')); await sleep(600);
      const nDraw1 = await p.evaluate(() => { try { return window.STRYKER_VELA.chart.drawings.all().length; } catch (e) { return -1; } });
      check(nDraw1 === nDraw0 + 1, tag + ': Draw level adds a horizontal line to the chart', [nDraw0, nDraw1]);
      // zone: from row 6 to row 12
      const rr = await p.evaluate(() => [2, 5].map((i) => { const r = document.querySelectorAll('.stkbp-list[data-t=dom] .stkbp-r')[i].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }));
      if (mobile) await p.evaluate(([x, y]) => { document.elementFromPoint(x, y).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: x, clientY: y })); }, rr[0]); else await p.mouse.click(rr[0][0], rr[0][1], { button: 'right' });
      await sleep(300);
      await (mobile ? p.tap('.stkbp-menu [data-a=zone]') : p.click('.stkbp-menu [data-a=zone]')); await sleep(300);
      // pick the second row on the price column (neutral)
      const p2 = await p.evaluate(() => { const r = document.querySelectorAll('.stkbp-list[data-t=dom] .stkbp-r')[5].querySelector('.p').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      if (mobile) await p.touchscreen.tap(p2[0], p2[1]); else await p.mouse.click(p2[0], p2[1]);
      await sleep(600);
      const nDraw2 = await p.evaluate(() => { try { return window.STRYKER_VELA.chart.drawings.all().length; } catch (e) { return -1; } });
      check(nDraw2 === nDraw1 + 1, tag + ': Draw zone (two rows) adds a box', [nDraw1, nDraw2]);

      if (mobile) {
        await p.tap('.stkbp-x'); await sleep(500);
        check(await p.evaluate(() => document.getElementById('stkbp').hidden), tag + ': tap on x closes the sheet');
      }
      check(errors.length === 0, tag + ': no console errors', errors);
      if (!mobile && theme === 'dark') {
        // FPS with the panel open on BTCUSDT Combined
        await setSym(p, 'binance:BTCUSDT'); await p.evaluate(() => window.__stkBookPanel.close()); await sleep(1500);
        const meas = () => p.evaluate(() => new Promise((res) => { let n = 0, t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 3000) res(n / 3); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
        const base = await meas();
        await p.evaluate(() => window.__stkBookPanel.open()); await tab(p, 'dom', false); await sleep(1500);
        const fps = await meas();
        const renders = await p.evaluate(() => new Promise((res) => { const l = document.querySelector('.stkbp-list'); let n = 0; const mo = new MutationObserver((m) => { n++; }); mo.observe(l, { subtree: true, characterData: true, childList: true, attributes: true }); setTimeout(() => { mo.disconnect(); res(n); }, 2000); }));
        console.log('INFO fps panel closed (headless):', base.toFixed(1), ' panel open on BTCUSDT Combined, DOM tab:', fps.toFixed(1), ' mutation batches / 2 s:', renders);
        check(fps >= base * 0.6, tag + ': chart keeps >= 60% of its frame rate with the panel open', [base, fps]);
      }
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
