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
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); if (t) localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); if (!sessionStorage.getItem('bpclr')) { sessionStorage.setItem('bpclr', '1'); localStorage.removeItem('stkbp.v1'); } } catch (e) {} }, theme);
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



const R = (p) => p.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; }; return { bp: r('#stkbp'), chart: r('#vela-chart'), rail: r('.stkw-rail'), dk: r('#stkbp .stkpd-dk'), x: r('.stkbp-x'), hd: r('.stkbp-hd'), dkl: document.querySelector('#stkbp .stkpd-dk') && document.querySelector('#stkbp .stkpd-dk').getAttribute('aria-label'), vw: innerWidth }; });
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, theme] of [[1440, 900, 'dark'], [1280, 800, 'light']]) {
      const { ctx, p, errors } = await open(b, { w, h, theme }); const tag = w + '-' + theme;
      await setSym(p, 'binance:BTCUSDT');
      await p.evaluate(() => window.__stkBookPanel.open()); await sleep(1500);
      let a = await R(p);
      // (19 Nov: rail panels are windows, chart-panel-dock.js; the Book panel now opens floating by default)
      check(a.dkl === 'Dock to right' && a.chart.r >= a.rail.l - 1, tag + ': default floating, chart full width', a);
      await p.screenshot({ path: OUT + '/dock-' + tag + '-floating.png' });
      const fullW = a.chart.w;
      await p.click('#stkbp .stkpd-dk'); await sleep(600);
      a = await R(p); const w1 = a.chart.w;
      check(a.dkl === 'Undock' && a.bp.r <= a.rail.l + 1 && a.chart.r <= a.bp.l + 1 && w1 < fullW && a.bp.t === a.rail.t && a.bp.b === a.rail.b, tag + ': Dock -> right column, chart narrower, no overlap', { w1, fullW, a });
      check(Math.abs((a.dk.t + a.dk.h / 2) - (a.x.t + a.x.h / 2)) <= 1 && a.dk.w === 28 && a.dk.h === 28 && a.dk.r <= a.x.l && a.x.l - a.dk.r <= 8 && a.dk.w === a.x.w, tag + ': dock button left of X, same size, centred', { dk: a.dk, x: a.x });
      // drag resize
      const g = await p.evaluate(() => { const r = document.querySelector('#stkbp > .stkpd-h-w').getBoundingClientRect(); return [r.left + r.width / 2, r.top + 200]; });
      await p.mouse.move(g[0], g[1]); await p.mouse.down(); await p.mouse.move(g[0] - 60, g[1], { steps: 5 }); await p.mouse.up(); await sleep(500);
      a = await R(p); check(a.bp.w === 460 && a.chart.r <= a.bp.l + 1, tag + ': drag edge resizes (400 -> 460)', a.bp);
      await p.mouse.move(a.bp.l + 1, g[1]); await p.mouse.down(); await p.mouse.move(a.bp.l + 700, g[1], { steps: 5 }); await p.mouse.up(); await sleep(400);
      a = await R(p); check(a.bp.w === 260, tag + ': min 260', a.bp.w);
      await p.mouse.move(a.bp.l + 1, g[1]); await p.mouse.down(); await p.mouse.move(a.bp.l - 700, g[1], { steps: 5 }); await p.mouse.up(); await sleep(400);
      a = await R(p); check(a.bp.w === 640, tag + ': max 640 (shared dock column)', a.bp.w);
      await p.screenshot({ path: OUT + '/dock-' + tag + '-docked640.png' });
      // reload keeps docked + width
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 }); await sleep(1500);
      await setSym(p, 'binance:BTCUSDT'); await p.evaluate(() => window.__stkBookPanel.open()); await sleep(1200);
      a = await R(p); check(a.dkl === 'Undock' && a.bp.w === 640, tag + ': reload keeps docked + width', a);
      // DOM click-to-trade still works docked: click a bid cell
      await p.click('.stkbp-tabs [data-t=dom]'); await sleep(1000);
      check(await p.evaluate(() => { const c = document.querySelector('.stkbp-list[data-t=dom] .c[data-c=bid]'); if (!c) return false; const r = c.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(e && e.closest('#stkbp')); }), tag + ': DOM cells hit-testable in docked panel');
      // header drag undocks
      const hd = await p.evaluate(() => { const r = document.querySelector('.stkbp-hd').getBoundingClientRect(); const q = document.querySelector('.stkbp-sp').getBoundingClientRect(); return [q.left + q.width / 2, r.top + 20]; });
      await p.mouse.move(hd[0], hd[1]); await p.mouse.down(); await p.mouse.move(hd[0] - 200, hd[1] + 80, { steps: 8 }); await p.mouse.up(); await sleep(500);
      a = await R(p); check(a.dkl === 'Dock to right' && a.chart.r >= a.rail.l - 1, tag + ': header drag undocks', a);
      await p.screenshot({ path: OUT + '/dock-' + tag + '-dragged.png' });
      await p.click('#stkbp .stkpd-dk'); await sleep(500); a = await R(p);
      check(a.dkl === 'Undock' && a.bp.r <= a.rail.l + 1, tag + ': Dock after drag snaps back', a);
      check(errors.length === 0, tag + ': no console errors', errors);
      await ctx.close();
    }
    { const { ctx, p } = await open(b, { w: 390, h: 844, mobile: true, theme: 'dark' });
      await setSym(p, 'binance:BTCUSDT'); await p.evaluate(() => window.__stkBookPanel.open()); await sleep(1200);
      check(await p.evaluate(() => { return [...document.querySelectorAll('.stkbp-dk, #stkbp .stkpd-dk')].every((d) => getComputedStyle(d).display === 'none' || d.hidden); }), '390: dock button hidden');
      await p.screenshot({ path: OUT + '/dock-390.png' }); await ctx.close(); }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
