// Big Trades old vs new on a REAL recorded NQ session (tools/tests/fixtures/orderflow/NQ-2026-10-21.bin.gz), 1m and 5m, 390 + 1440 dark.
//   CHART_BASE=http://127.0.0.1:8031 TAG=new flock /tmp/stryker-chrome.lock node tools/tests/bigtrades-shots.js <outDir>
// Prints the marker counts (old: prints >= 99.5th percentile; new: select() result) and saves one screenshot per size / timeframe.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE, TAG = process.env.TAG || 'new', OUT = process.argv[2] || '/tmp', DAY = '2026-10-21';
const FIX = path.join(__dirname, 'fixtures/orderflow'), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hdr = Buffer.from('{"v":1,"sym":"NQ","tick":0.25,"thr":0}'), EMPTY = Buffer.from([0x4f, 0x46, 0x31, 0x0a, hdr.length, ...hdr, 0]);
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const D = await import(path.resolve(__dirname, '../../assets/chart-footprint-data.js'));
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'NQ-' + DAY + '.bin.gz')));
  const bars = D.decodeOrderflow(new Uint8Array(raw)).bars;
  const t0 = Date.UTC(2026, 9, 21, 13, 30), t1 = Date.UTC(2026, 9, 21, 20, 0);   // the US cash session
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) for (const tf of [1, 5]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker.vela.session'); } catch (e) {} });
      await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
      await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => { const agg = D.aggregate(bars, tf * 60000); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: String(tf), page: 0, bars: agg.map((x) => [x.t / 1000, x.o * 0.25, x.hi * 0.25, x.lo * 0.25, x.c * 0.25, x.vol]) }) }); });
      await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/orderflow/, (r) => { const u = new URL(r.request().url()); const d = u.searchParams.get('day'); const ok = d === DAY; r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'x-of-gzip': ok ? '0' : '0' }, body: ok ? raw : EMPTY }).catch(() => {}); });
      const p = await ctx.newPage(); const errs = [];
      p.on('pageerror', (e) => errs.push(String(e)));
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkOrderflow, null, { timeout: 60000 });
      await sleep(2000);
      await p.evaluate(async (tf) => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe(String(tf)); for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 50) break; } window.STRYKER_VELA.active.setPriceStyle('candles'); }, tf);
      await sleep(1000);
      await p.evaluate(() => window.STRYKER_VELA.chart.addNativeIndicator('stk_of_big'));
      await p.evaluate(([a, z]) => window.STRYKER_VELA.chart.setVisibleRange({ from: a, to: z }), [t0, t1]);
      await sleep(2500);
      const n = await p.evaluate(([a, z]) => { const O = window.__stkOrderflow; const bs = O.minuteBars('NQ', a, z); return bs.reduce((s, x) => s + (x.bigs || []).filter((y) => y[0] >= a && y[0] <= z).length, 0); }, [t0, t1]);
      console.log(TAG, w + 'px', tf + 'm', 'recorder big prints in session:', n, 'errors', errs.length);
      const sh = await p.evaluate(() => (window.__stkBigShown ? window.__stkBigShown() : null));
      if (sh) {
        console.log(TAG, w + 'px', tf + 'm', 'markers drawn:', sh.n);
        if (mobile && tf === 1 && sh.d.length) {   // a real touch tap on the biggest marker opens the card
          const m = sh.d.slice().sort((x, y) => y.r - x.r)[0];
          await p.touchscreen.tap(m.c + m.x, m.t + m.y); await sleep(500);
          console.log('EV', JSON.stringify(await p.evaluate(() => window.__ev)), await p.evaluate(() => { const e = document.querySelector('.stk-bigtip'); return e ? e.outerHTML.slice(0, 120) : 'none'; }));
          const card = await p.evaluate(() => { const e = document.querySelector('.stk-bigtip'); return e && !e.hidden ? e.innerText : null; });
          await p.evaluate(() => { window.__ev = []; for (const t of ['pointerdown', 'touchstart', 'click']) document.addEventListener(t, (e) => window.__ev.push(t + ':' + Math.round(e.clientX || 0)), true); });
          console.log('DBG', JSON.stringify(m), await p.evaluate(() => [innerWidth, devicePixelRatio, [...document.querySelectorAll('canvas')].filter((c) => c.__bigTip).map((c) => { const r = c.getBoundingClientRect(); return [r.left, r.top, r.width, r.height, c.width]; })]));
          console.log(TAG, 'tap card:', JSON.stringify(card));
          await p.screenshot({ path: OUT + '/bt-' + TAG + '-390-tap.png' });
        }
      }
      await p.screenshot({ path: OUT + '/bt-' + TAG + '-' + w + '-' + tf + 'm.png' });
      await ctx.close();
    }
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
