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
    for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) for (const tf of [1]) {
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
      const shot = async (n) => { await p.addStyleTag({ content: '.tzc,.toast{display:none!important}' }).catch(() => {}); await sleep(500); await p.screenshot({ path: OUT + '/' + n + '-' + w + '.png' }); };
      const add = (t) => p.evaluate((t) => { const c = window.STRYKER_VELA.chart; const h = c.addNativeIndicator(t); return h && h.id; }, t);
      const range = (a, z) => p.evaluate(([a, z]) => window.STRYKER_VELA.chart.setVisibleRange({ from: a, to: z }), [a, z]);
      await add('stk_of_big'); await range(t0, t1); await sleep(2500); await shot('big');
      await add('stk_of_abs'); await sleep(1500); await shot('abs');
      await add('stk_of_cvd'); await add('stk_of_delta'); await sleep(2000); await shot('cvd');
      await p.evaluate(() => { const c = window.STRYKER_VELA.chart; c.indicators().filter((h) => h.nativeType === 'stk_of_big' || h.nativeType === 'stk_of_abs').forEach((h) => c.removeIndicator ? c.removeIndicator(h.id) : h.remove && h.remove()); });
      await add('stk_footprint'); const t2 = Date.UTC(2026, 9, 21, 15, 0); await range(t2, t2 + 14 * tf * 60000); await sleep(3000); await shot('fp');
      await add('stk_of_vp'); await range(t0, t1); await sleep(2500); await shot('vp');
      console.log(w, 'errors', errs.length, errs.slice(0, 2));
      await ctx.close();
    }
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
