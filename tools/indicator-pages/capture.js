// Captures one chart image per indicator page: NQ (recorded session, tools/tests/fixtures/orderflow) on the dark
// chart with the indicator added through the Indicators window's own addByKey (the same path as /charts?ind=<key>).
//   node tools/tests/chart-dev-server.mjs 8047 &
//   flock -w 600 /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8047 node tools/indicator-pages/capture.js [slug,slug...]
// Writes assets/images/indicators/pages/<slug>.webp (1280x720) and tools/indicator-pages/captures.json
// ({slug: 'ok' | 'fallback: <why>'}). A capture that adds nothing visible (no data on the test chart: L2 book, options
// data, news...) is marked fallback and the page shows a generated preview instead (gen-indicator-pages.js).
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { launch } = require('../tests/lib.js');
const stub = require('../tests/richstub.js');
const { buildCatalog } = require('./catalog.js');
const ROOT = path.join(__dirname, '..', '..');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8047';
const OUT = path.join(ROOT, 'assets/images/indicators/pages');
const RES = path.join(__dirname, 'captures.json');
const FIX = path.join(ROOT, 'tools/tests/fixtures');
const DAYS = ['2026-10-20', '2026-10-21'];
// zoomed in (footprint-style tools only draw when bars are wide); never captured (options / news data not in the fixtures)
const ZOOM = /footprint|stk_fp|stk_l2f_fp|stk_of_tpo|stk_l2f_lad/;
const NO_SHOT = /^b:stk_(gex|gexheat|em|tide|optflow|news|earn|econ|offex|offex_lv|darkpool)$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
  const items = buildCatalog().items.filter((x) => !only || only.has(x.slug));
  const results = fs.existsSync(RES) ? JSON.parse(fs.readFileSync(RES, 'utf8')) : {};
  const D = await import(path.join(ROOT, 'assets/chart-footprint-data.js'));
  const raw = {}, bars = [];
  for (const d of DAYS) { raw[d] = zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'orderflow/NQ-' + d + '.bin.gz'))); bars.push(...D.decodeOrderflow(new Uint8Array(raw[d])).bars); }
  const hdr = Buffer.from('{"v":1,"sym":"NQ","tick":0.25,"thr":0}'), EMPTY = Buffer.from([0x4f, 0x46, 0x31, 0x0a, hdr.length, ...hdr, 0]);
  const QQQ = fs.readFileSync(path.join(FIX, 'gex/QQQ-0.json'));
  const b = await launch({ args: ['--js-flags=--max-old-space-size=900'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker.vela.session'); localStorage.setItem('stryker_community_disclaimer_ack_v1', JSON.stringify({ u1: 1, _anon: 1 })); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => {
    const tf = +(new URL(r.request().url()).searchParams.get('tf') || 5) || 5;
    const agg = D.aggregate(bars, tf * 60000);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: String(tf), page: 0, bars: agg.map((x) => [x.t / 1000, x.o * 0.25, x.hi * 0.25, x.lo * 0.25, x.c * 0.25, x.vol]) }) });
  });
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/orderflow/, (r) => { const d = new URL(r.request().url()).searchParams.get('day'); r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: raw[d] || EMPTY }).catch(() => {}); });
  await ctx.route(/\/api\/gex\/levels\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: QQQ }));
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.StrykerIndicatorWindow && window.StrykerIndicatorWindow.addByKey, null, { timeout: 90000 });
  await sleep(3000);
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('5'); for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 50) break; } ws.active.setPriceStyle('candles'); });
  // Pine tables are left out of the page images: some community scripts print backtest stats (wins, win rate,
  // PnL) in them, and result claims never go on a public page. Capture-only: the chart itself still draws them.
  await p.evaluate(() => {
    const sl = window.STRYKER_VELA.chart.renderer.renderer.indicatorSlices, proto = Object.getPrototypeOf(sl), orig = proto.paintEntry;
    proto.paintEntry = function (ctx, e) { return orig.apply(this, [ctx, e && e.tables && e.tables.length ? Object.assign({}, e, { tables: [] }) : e].concat([].slice.call(arguments, 2))); };
  });
  await p.addStyleTag({ content: '.tzc,.toast,.stk-toast,#stk-toasts,.cookie-notice{display:none!important}' }).catch(() => {});
  const t1 = Date.UTC(2026, 9, 21, 20, 0), t0 = t1 - 26 * 3600000;
  const clear = () => p.evaluate(() => {
    const ws = window.STRYKER_VELA, c = ws.chart;
    try { (window.STRYKER_PINE.pineHandles(c) || []).forEach((h) => { try { h.remove(); } catch (e) {} }); } catch (e) {}
    try { c.indicators().forEach((h) => { try { c.removeIndicator ? c.removeIndicator(h.id) : h.remove(); } catch (e) {} }); } catch (e) {}
    try { window.StrykerIndicatorWindow.close(); } catch (e) {}
    document.querySelectorAll('.stkiw-ov,.stk-modal,.stkc-modal').forEach((n) => n.remove());
  });
  const range = () => p.evaluate(([a, z]) => window.STRYKER_VELA.chart.setVisibleRange({ from: a, to: z }), [t0, t1]);
  const box = await p.evaluate(() => { const r = document.querySelector('.vela-chart, canvas').closest('[class*=cell]') || document.querySelector('canvas'); const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  await clear(); await range(); await sleep(1500);
  // The capture shows the plot only: no header, data-status chips, delay pill or footnote.
  const shot = async () => {
    const clip = await p.evaluate(() => {
      const hide = /delayed|CME|Sign for|Zoom in to see|Connect broker/i;
      document.querySelectorAll('body *').forEach((n) => { if (n.children.length <= 2 && hide.test(n.textContent || '') && (n.textContent || '').length < 160) n.style.visibility = 'hidden'; });
      let x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0;
      document.querySelectorAll('canvas').forEach((c) => { const r = c.getBoundingClientRect(); if (r.width < 300 || r.height < 60) return; x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); });
      return { x: Math.max(0, x0), y: Math.max(0, y0), width: Math.min(innerWidth, x1) - Math.max(0, x0), height: Math.min(innerHeight, y1) - Math.max(0, y0) };
    });
    return p.screenshot({ type: 'png', clip });
  };
  const zoom = () => p.evaluate(([a, z]) => window.STRYKER_VELA.chart.setVisibleRange({ from: a, to: z }), [t1 - 100 * 60000, t1]);
  const blank = await shot();
  const { PNG } = (() => { try { return require('pngjs'); } catch (e) { return {}; } })();
  for (const it of items) {
    const file = path.join(OUT, it.slug + '.png');
    try {
      await clear(); await range(); await sleep(400);
      const ok = await p.evaluate((k) => Promise.race([window.StrykerIndicatorWindow.addByKey(k), new Promise((r) => setTimeout(() => r('timeout'), 60000))]), it.key);
      await sleep(it.kind === 'pine' ? 9000 : 3500);
      if (ZOOM.test(it.key)) await zoom(); else await range();
      await sleep(1500);
      const png = await shot();
      const note = await p.evaluate(() => { const t = document.body.innerText; const m = t.match(/Needs L2[^\n]*|Connecting to the order book[^\n]*|needs order-flow data[^\n]*|not available on this chart[^\n]*|Could not (load|add)[^\n]*|Pine error[^\n]*|No data[^\n]*/i); return m ? m[0].slice(0, 120) : ''; });
      const same = png.equals(blank) || diffPct(png, blank, PNG) < 0.004;
      if (NO_SHOT.test(it.key)) results[it.slug] = 'fallback: needs options / news data the test chart does not have';
      else if (ok !== true) results[it.slug] = 'fallback: add ' + ok;
      else if (note) results[it.slug] = 'fallback: ' + note;
      else if (same) results[it.slug] = 'fallback: nothing drawn on the test chart';
      else results[it.slug] = 'ok';
      if (results[it.slug] === 'ok') fs.writeFileSync(file, png); else if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (e) { results[it.slug] = 'fallback: ' + String(e.message || e).slice(0, 100); }
    console.log(it.slug, results[it.slug]);
    fs.writeFileSync(RES, JSON.stringify(results, null, 1) + '\n');
  }
  await b.close();
  void box;
})().catch((e) => { console.error(e); process.exit(1); });

// share of pixels that differ (pngjs when installed; otherwise a byte-level estimate on the compressed data)
function diffPct(a, b, PNG) {
  if (!PNG) return a.equals(b) ? 0 : 1;
  const x = PNG.sync.read(a), y = PNG.sync.read(b);
  if (x.width !== y.width) return 1;
  let n = 0; const d = x.data, e = y.data;
  for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i] - e[i]) + Math.abs(d[i + 1] - e[i + 1]) + Math.abs(d[i + 2] - e[i + 2]) > 30) n++;
  return n / (d.length / 16);
}
