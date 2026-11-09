// DOM Signals browser test with the book-panel FIXTURE streams (no network).
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/dom-signals-browser.js <shotsDir>
// 390 / 1440, dark / light, crypto + futures: columns render, tags show and fade, summary, legend, settings, no page errors.
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
      for (const [sym, name] of [['binance:BTCUSDT', 'btc'], ['futures:NQ1!', 'nq']]) {
        await setSym(p, sym);
        await p.evaluate(() => window.__stkBookPanel.open()); await sleep(1200);
        await tab(p, 'dom', mobile); await sleep(7000);
        const T = tag + ' ' + name;
        const click = (sel) => (mobile ? p.tap(sel) : p.click(sel));
        check(await p.evaluate(() => !!document.querySelector('.stkbp-cols .h-sg') && !!document.querySelector('.stkbp-cols .h-zs') && document.querySelectorAll('.stkbp-list[data-t=dom] .stkbp-r .sg').length >= 8), T + ': Signals and ± Size columns render');
        check(await p.evaluate(() => [...document.querySelectorAll('.stkbp-r .zs')].some((n) => n.textContent.trim())), T + ': ± Size has values from the book');
        check(await p.evaluate(() => { const s = document.querySelector('.stkbp-sum'); return !s.hidden && /Bids [+−]/.test(s.textContent) && /Offers/.test(s.textContent) && /(Support building|Resistance building|Balanced|Collecting)/.test(s.textContent); }), T + ': summary line with approved wording');
        const shown = await p.evaluate((mob) => {
          const bp = window.__stkBookPanel, e = bp._signals(), keys = [...document.querySelectorAll('.stkbp-list[data-t=dom] .stkbp-r')].map((r) => +r.dataset.k), now = Date.now();
          e.update = () => false; e.tags.clear(); 'IRASBPE'.split('').forEach((t, i) => e.setTag(keys[1 + i], t, i % 2 ? 1 : -1, now)); bp._paint();
          const ns = [...document.querySelectorAll('.stkbp-r .sg[data-k]')], n = document.querySelector('.stkbp-r .sg[data-k=I]') || document.querySelector('.stkbp-r .sg');
          const em = n.querySelector('em'), bd = n.querySelector('b');
          return { tags: ns.map((x) => x.dataset.k).join(''), style: mob ? getComputedStyle(bd).display !== 'none' && getComputedStyle(em).display === 'none' && bd.textContent === 'I' : getComputedStyle(em).display !== 'none' && em.textContent === 'Iceberg' };
        }, mobile);
        check('IRASBPE'.split('').every((c) => shown.tags.includes(c)), T + ': all seven tags show', shown.tags);
        check(shown.style, T + (mobile ? ': phone shows 1-letter badges' : ': desktop shows plain words'));
        check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll('.stkbp-list[data-t=dom] .stkbp-r')].every((x) => x.scrollWidth <= x.clientWidth + 1)), T + ': no overflow, no clipped row');
        await p.screenshot({ path: OUT + '/ds-' + tag + '-' + name + '-dom.png' });
        await p.evaluate(() => { const bp = window.__stkBookPanel, e = bp._signals(); e.tags.clear(); const k = +document.querySelectorAll('.stkbp-list[data-t=dom] .stkbp-r')[3].dataset.k; e.setTag(k, 'I', 1, Date.now()); e.setTag(k - 1, 'E', 1, Date.now()); bp._state().S.sf = 1500; e.fadeMs = 1500; bp._paint(); window.__k = k; window.__both = [k, k - 1].map((x) => ((document.querySelector('.stkbp-r[data-k="' + x + '"] .sg') || {dataset:{k:'?'}}).dataset.k)).join(''); }); check(await p.evaluate(() => window.__both) === 'IE', T + ': tags appear on their levels'); await sleep(2600);
        check(await p.evaluate(() => { const k = window.__k; return [k, k - 1].every((x) => { const n = document.querySelector('.stkbp-r[data-k="' + x + '"] .sg'); return !n || !['I', 'E'].includes(n.dataset.k); }); }), T + ': tags fade away');
        await p.evaluate(() => { window.__stkBookPanel._state().S.sf = 20000; });
        await click('.stkbp-cols .h-sg'); await sleep(400);
        check(await p.evaluate(() => { const l = document.querySelector('.stkbp-leg'); return !l.hidden && ['Iceberg', 'Refill', 'Absorb', 'Sweep', 'Big', 'Pulled', 'Eaten'].every((t) => l.textContent.includes(t)) && !/spoof/i.test(l.textContent) && l.getBoundingClientRect().right <= innerWidth + 1; }), T + ': header tap opens the legend, all seven explained, no "spoof"');
        check(await p.evaluate(() => [...document.querySelectorAll('.stkbp-cols .h-sg, .stkbp-cols .h-zs')].every((x) => x.getBoundingClientRect().height >= (innerWidth < 700 ? 44 : 24)) && [...document.querySelectorAll('.stkbp-leg button')].every((x) => { const r = x.getBoundingClientRect(); return innerWidth > 700 || (r.height >= 36 && r.width >= 36); })), T + ': touch targets');
        await p.screenshot({ path: OUT + '/ds-' + tag + '-' + name + '-legend.png' });
        await click('.stkbp-leg [data-tog=zs]'); await sleep(600);
        check(await p.evaluate(() => getComputedStyle(document.querySelector('.stkbp-cols .h-zs')).display === 'none' && getComputedStyle(document.querySelector('.stkbp-cols .h-sg')).display !== 'none'), T + ': ± Size column can be hidden');
        await click('.stkbp-leg [data-tog=sg]'); await sleep(600);
        check(await p.evaluate(() => getComputedStyle(document.querySelector('.stkbp-cols .h-sg')).display === 'none'), T + ': Signals column can be hidden');
        await click('.stkbp-leg [data-tog=zs]'); await click('.stkbp-leg [data-tog=sg]'); await sleep(300);
        await click('.stkbp-leg [data-set=sw][data-v="60000"]'); await sleep(600);
        check(await p.evaluate(() => window.__stkBookPanel._state().S.sw === 60000 && window.__stkBookPanel._signals().winMs === 60000), T + ': window setting applies');
        await click('.stkbp-leg [data-close]'); await sleep(300);
        await click('.stkbp-sum .stkbp-i'); await sleep(400);
        check(await p.evaluate(() => /not a signal to trade/.test(document.querySelector('.stkbp-leg').textContent)), T + ': the "i" explains the summary');
        await p.screenshot({ path: OUT + '/ds-' + tag + '-' + name + '-summary-info.png' });
        await p.evaluate(() => { window.__stkBookPanel._state().S.sw = 30000; window.__stkBookPanel.close(); }); await sleep(300);
      }
      check(errors.length === 0, tag + ': no page errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
