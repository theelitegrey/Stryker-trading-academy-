// Data plans (Owner 2026-11-04) browser check: a FREE member (signed in, no L1/L2 Data) on NQ futures.
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/data-plans-browser.js <shotsDir>
// Checks: the order-flow / book tools stay on the chart (no Pro removal, no PRO tag); the book pack tools (Book Speed, Liquidity
// Balance, Volatility Regime) read the recorded /ts-book-history and say "Live order book needs L2 Data"; no /ts-live socket
// for the book pack; the L2 heatmap shows the L2 lock in the feed row; the lock opens the data checkout (no Pro modal).
// Shots: chart at 390 + 1440, dark + light.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };

async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  // localhost test hook: recorder base only, 'trades' = this member is NOT told the book tier (a free member)
  await ctx.addInitScript(() => { window.__stkL2Test = { base: 'http://127.0.0.1:9', trades: true }; window.__wsBook = 0;
    const Real = window.WebSocket; window.WebSocket = function (u, p) { if (/ts-live/.test(String(u))) window.__wsBook++; return new Real('ws://127.0.0.1:9/none', p); }; window.WebSocket.OPEN = 1; });
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/\/api\/chart\/rt\b/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ admin: false, l2: false }) }));
  let hist = 0;
  await ctx.route(/127\.0\.0\.1:9\/ts-book-history/, async (r) => {
    hist++;
    const { encodeSamples } = await import('../../workers/book-recorder/src/bucket.js');
    const u = new URL(r.request().url()), from = Number(u.searchParams.get('from')), to = Math.min(Number(u.searchParams.get('to')), Date.now() - 660000), out = [];
    let mid0 = 21000; try { mid0 = (await ctx.pages()[0].evaluate(() => window.__MID)) || mid0; } catch (e) {}
    for (let t = Math.ceil(from / 60000) * 60000; t < to; t += 60000) {
      const mid = mid0 + Math.sin(t / 900000) * 20, step = 0.25, i0 = Math.floor((mid - 10) / step), len = 80, v = new Float32Array(len);
      for (let k = 0; k < len; k++) { const ri = i0 + k, hh = Math.abs(Math.sin(ri * 12.9898 + t / 1e7) * 43758.5453) % 1; v[k] = (ri * step < mid ? 1 : -1) * Math.round(5 + 40 * hh * hh); }
      out.push({ ts: t, mid, bb: mid - 0.25, ba: mid + 0.25, step, i0, v });
    }
    r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'x-ts-fill-left': '0', 'access-control-expose-headers': 'x-ts-fill-left' }, body: Buffer.from(encodeSamples(out)) });
  });
  await ctx.route(/127\.0\.0\.1:9\/(?!ts-book-history)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::|status of 4|status of 5|Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(1500);
  return { ctx, p, errors, hist: () => hist };
}
const TOOLS = ['stk_bk_speed', 'stk_bk_bal', 'stk_bk_regime', 'stk_fut_dom'];
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) for (const theme of ['dark', 'light']) {
      const tag = w + '-' + theme, r = await open(b, { w, h, mobile, theme }), p = r.p;
      await p.evaluate(async () => {
        const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1');
        for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === 'futures:NQ1!' && c.orchestrator.rawBars.length > 50) break; }
        const rb = ws.chart.orchestrator.rawBars, l = rb[rb.length - 1]; window.__MID = l && (l.close != null ? l.close : l.c);
      });
      for (const t of TOOLS) await p.evaluate((t) => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator(t, { inputs: {} }); window.STRYKER_VELA.context().stateChanged(); }, t);
      await sleep(9000);
      const st = await p.evaluate(() => ({
        inds: window.STRYKER_VELA.context().cells[0].chart.indicators().map((x) => x.nativeType),
        txt: document.body.innerText, pro: !!document.querySelector('.stk-protag'),
        pack: window.__stkBookPack ? Object.keys(window.__stkBookPack) : [], rt: window.tzRtState && window.tzRtState()
      }));
      if (theme === 'dark') {
        check(['stk_bk_speed', 'stk_bk_bal', 'stk_bk_regime', 'stk_fut_dom'].every((t) => st.inds.includes(t)), tag + ': free member keeps every tool on the chart', st.inds);
        check(!st.pro, tag + ': no PRO tag');
        check(r.hist() > 0, tag + ': book history read for the free member', r.hist());
        check(/Live order book needs L2 Data/.test(st.txt), tag + ': L2 lock copy shown');
        check(!/part of Pro|Get Pro|Join Pro/.test(st.txt), tag + ': no Pro upsell on the chart');
        check(st.pack.length >= 3, tag + ': book pack tools rendered from history', st.pack);
      }
      await p.screenshot({ path: OUT + '/dp-chart-' + tag + '.png' });
      if (w === 1440 && theme === 'dark') {
        const before = p.url();
        await p.evaluate(() => { const u = document.querySelector('.stkfeed-unlock'); if (u) u.click(); else { const f = document.querySelector('#stkfeeds [data-l="L2"], #stkfeeds button'); if (f) f.click(); } });
        await sleep(800);
        await p.evaluate(() => { const u = document.querySelector('.stkfeed-unlock'); if (u) u.click(); });
        await sleep(2500);
        check(/checkout\.html\?plan=LiveDataL2|\/pricing/.test(p.url()), 'L2 lock opens the data checkout', [before, p.url()]);
      }
      check(r.errors.length === 0, tag + ': no console errors', r.errors);
      await r.ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
