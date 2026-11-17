// Exchange-form futures symbols on the chart (Owner bug 17 Nov): an MNQ chart named "CME_MINI:MNQ1!" showed
// "Open a crypto or futures chart ... to see its order book." in the DOM panel. Every futures tool must treat
// CME:/CME_MINI:/CBOT:/COMEX:/NYMEX: (and contract codes) exactly like "futures:".
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 tools/chrome-slot.sh node tools/tests/cme-symbol-browser.js <shotsDir>
// Fixture: the fake /ts-live socket of book-panel-browser.js (admin test flag), books for NQ, MNQ and ES.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };

function fixtures() {
  window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  const MIDS = { NQ: 21000, MNQ: 21000, ES: 6000 };
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    let n = 0;
    setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) }); }, 50);
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1 || !ws.onmessage) return; n++;
      const now = Date.now(), send = (o) => ws.onmessage({ data: JSON.stringify(o) });
      const want = (/[?&]symbol=([A-Z0-9]+)/.exec(String(url)) || [])[1];   // one socket per root: answer only for that root
      for (const [sym, MID] of Object.entries(MIDS)) {
        if (want && sym !== want) continue;
        const mid = MID + Math.sin(n / 30) * 2, bid = Math.floor(mid * 4) / 4, ask = bid + 0.25, bids = [], asks = [];
        for (let j = 0; j < 150; j++) { bids.push([bid - j * 0.25, 5 + (j % 9) * 4]); asks.push([ask + j * 0.25, 6 + (j % 7) * 5]); }
        send({ type: 'snap', symbol: sym, ts: now, bids, asks, imb: 0, imb10: 0 });
        send({ type: 'ticks', symbol: sym, t: [[bid, 1 + (n % 7), -1, now], [ask, 2 + (n % 5), 1, now]] });
      }
    }, 100);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
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
const setSym = async (p, sym) => { await p.evaluate(async (s) => { const ws = window.STRYKER_VELA; window.__prevSym = ws.active.symbol; ws.active.setSymbol(s); ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.active.symbol && ws.active.symbol !== window.__prevSym) break; } }, sym); await sleep(800); };
const tab = async (p, t, mobile) => { await (mobile ? p.tap('.stkbp-tabs [data-t=' + t + ']') : p.click('.stkbp-tabs [data-t=' + t + ']')); await sleep(500); };

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const runs = (process.env.CME_RUNS || '1440-dark,390-light').split(',');
    const VIEWS = { '1440-dark': [1440, 900, false, 'dark'], '1440-light': [1440, 900, false, 'light'], '390-dark': [390, 844, true, 'dark'], '390-light': [390, 844, true, 'light'] };
    for (const tag of runs) {
      const [w, h, mobile, theme] = VIEWS[tag];
      const { ctx, p, errors } = await open(b, { w, h, mobile, theme });
      // A: the normal path (search / watchlist / phone / Pine pick) -> the cell holds 'futures:ROOT1!'
      // B: a cell that still holds the exchange form (a layout saved before the fix): the readers must cope
      for (const [sym, root, mode] of [['CME_MINI:MNQ1!', 'MNQ', 'A'], ['CME:ES1!', 'ES', 'A'], ['MNQZ6', 'MNQ', 'A'], ['CME_MINI:MNQ1!', 'MNQ', 'B'], ['CME:ES1!', 'ES', 'B']]) {
        const name = sym.replace(/[^A-Z0-9]+/gi, '-') + '-' + mode;
        await p.evaluate(() => window.__stkBookPanel.close()); await sleep(300);
        if (mode === 'A') await setSym(p, sym);
        else await p.evaluate(async (s) => { const c = window.STRYKER_VELA.active; Object.getPrototypeOf(c).__stkRawSetSymbol.call(c, s); await new Promise((r) => setTimeout(r, 1500)); }, sym);
        const active = await p.evaluate(() => window.STRYKER_VELA.active.symbol);
        check(active === (mode === 'A' ? 'futures:' + root + '1!' : sym), tag + ' ' + mode + ': ' + sym + ' -> cell holds ' + active);
        await p.evaluate(() => window.__stkBookPanel.open()); await sleep(2000);
        await tab(p, 'dom', mobile); await sleep(1200);
        const st = await p.evaluate(() => ({ empty: (document.querySelector('#stkbp .stkbp-list') || {}).innerText || '', rows: document.querySelectorAll('.stkbp-list[data-t=dom] .stkbp-r').length, sym: (document.querySelector('.stkbp-sym') || {}).textContent || '' }));
        check(!/Open a crypto or futures chart/.test(st.empty), tag + ' ' + mode + ': ' + sym + ' DOM panel does not say "open a futures chart"', st.empty.slice(0, 120));
        check(st.rows >= 8, tag + ' ' + mode + ': ' + sym + ' DOM ladder rows', st.rows);
        check(new RegExp(root).test(st.sym), tag + ' ' + mode + ': ' + sym + ' panel names ' + root, st.sym);
        await p.screenshot({ path: OUT + '/cme-' + tag + '-' + name + '-dom.png' });
      }
      // crypto unchanged
      await p.evaluate(() => window.__stkBookPanel.close()); await sleep(300);
      await setSym(p, 'binance:BTCUSDT');
      check(await p.evaluate(() => window.STRYKER_VELA.active.symbol) === 'binance:BTCUSDT', tag + ': binance:BTCUSDT left as it is');
      // order panel DOM tab (embeds the same book panel) on CME_MINI:MNQ1! -- desktop only: the phone panel has no DOM tab (chart-order-panel.js shownTab), the DOM sheet above covers it
      if (!mobile) {
      await p.evaluate(() => window.__stkBookPanel.close()); await sleep(300);
      await p.evaluate(async () => { const c = window.STRYKER_VELA.active; Object.getPrototypeOf(c).__stkRawSetSymbol.call(c, 'CME_MINI:MNQ1!'); await new Promise((r) => setTimeout(r, 1500)); });   // the Owner's case: the raw exchange form on the cell
      const hasOp = await p.evaluate(async () => { for (let i = 0; i < 40; i++) { if (window.__stkPaper && window.__stkPaper.account) break; await new Promise((r) => setTimeout(r, 250)); } if (!window.__stkPaper || !window.__stkPaper.account) return false; window.__stkPaper.setEnabled(true); window.__stkPaper.orderPanel({ tab: 'dom' }); for (let i = 0; i < 40; i++) { if (window.__stkOrderPanel) break; await new Promise((r) => setTimeout(r, 250)); } return !!window.__stkOrderPanel; });
      if (hasOp) {
        await sleep(2500);
        const op = await p.evaluate(() => { const r = document.querySelector('#stkop'); return { txt: r ? r.innerText : '', rows: r ? r.querySelectorAll('.stkbp-r').length : 0 }; });
        check(!/Open a crypto or futures chart/.test(op.txt) && op.rows >= 8, tag + ': order panel DOM tab shows the MNQ book', { rows: op.rows, txt: op.txt.slice(0, 160) });
        await p.screenshot({ path: OUT + '/cme-' + tag + '-orderpanel-dom.png' });
      } else check(false, tag + ': order panel loads');
      }
      check(errors.length === 0, tag + ': no console errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
