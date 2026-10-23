// Liquidity Master [TradeZoro] on NQ1! 1m: time to the FULL result in the real chart page (Pine
// worker), on recorded NQ candles (fixtures/orderflow/NQ-2026-10-2x.bin.gz -> 1m OHLCV, ~2 trading
// days, what a 1m chart loads for Pine). Nothing live is called. Target: the full result (Asia,
// London and NY sessions + previous-day levels) in under 15 s on both engines.
// Also checks the page side of the speed fix: html.stk-pine-busy is cleared once the result is
// drawn (paused decorative animations resume).
//   node tools/tests/chart-dev-server.mjs 8073 &
//   CHART_BASE=http://127.0.0.1:8073 flock /tmp/stryker-chrome.lock node tools/tests/chart-lm-speed-browser.js <shotsDir>
// LM_ENG=09|06 runs one engine only; LM_TARGET_MS overrides the target.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8073';
const OUT = process.argv[2] || '.';
const TARGET_MS = Number(process.env.LM_TARGET_MS || 15000);
const FIX = path.join(__dirname, 'fixtures/orderflow');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 600))); };
const NAME = 'Liquidity Master [TradeZoro]';
const NOW = Date.UTC(2026, 9, 21, 20, 0);   // 16:00 New York on 21 Oct: two NY sessions and a previous day
let CAND = null;
async function candles(tf) {
  if (!CAND) {
    const D = await import(path.resolve(__dirname, '../../assets/chart-footprint-data.js'));
    const bars = [].concat(...['2026-10-20', '2026-10-21'].map((d) => D.decodeOrderflow(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'NQ-' + d + '.bin.gz'))))).bars));
    CAND = { D, bars };
  }
  return CAND.D.aggregate(CAND.bars, tf * 60000).filter((b) => b.t < NOW).map((b) => [b.t / 1000, b.o * 0.25, b.hi * 0.25, b.lo * 0.25, b.c * 0.25, b.vol]);
}
async function open(b, v09) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([now]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1');
      localStorage.removeItem('stryker.vela.session'); localStorage.removeItem('vela-workspace'); localStorage.removeItem('vela-workspace-090'); } catch (e) {}
    const RealDate = Date, off = now - RealDate.now();
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
    window.Date = FakeDate;
  }, [NOW]);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, async (r) => {
    const u = new URL(r.request().url());
    const tf = Number(u.searchParams.get('tf')) || 1, page = Number(u.searchParams.get('page')) || 0;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: String(tf), page, bars: await candles(tf) }) });
  });
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/stream/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|\/api\/chart\/stream|firebase|firestore|CORS|WebSocket/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
  await p.goto(BASE + '/charts.html?vela=' + (v09 ? '0.9' : '0.6'), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 90000 });
  await sleep(1500);
  return { ctx, p, errors };
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=900'] });
  try {
    for (const v09 of (process.env.LM_ENG === '06' ? [false] : process.env.LM_ENG === '09' ? [true] : [true, false])) {
      const eng = v09 ? 'v09' : 'v06';
      const { ctx, p, errors } = await open(b, v09);
      await p.evaluate(async () => {
        const ws = window.STRYKER_VELA;
        ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1');
        const c = ws.chart;
        for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 250)); if (c.market.symbol === 'futures:NQ1!' && c.market.timeframe === '1' && c.orchestrator.rawBars.length > 50 && c.orchestrator.historyState !== 'backfill') break; }
      });
      await sleep(1500);
      // add from the picker (Editors' picks), like a member
      await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
      await p.waitForSelector('.stkiw-row', { timeout: 20000 });
      await p.evaluate(() => document.querySelector('.stkiw-tab[data-k="picks"]').click());
      await sleep(300);
      await p.evaluate((nm) => [...document.querySelectorAll('.stkiw-row')].find((r) => (r.querySelector('.stkiw-nm') || {}).textContent === nm).querySelector('.stkiw-name').click(), NAME);
      await p.evaluate(() => { try { window.STRYKER_VELA.indicatorPicker.close(); } catch (e) {} });
      // poll the model: first draw, then the full result (sessions + PDH, computed on all loaded history)
      const res = await p.evaluate(async () => {
        const chart = window.STRYKER_VELA.chart, t0 = performance.now();
        let first = null, full = null, last = null;
        for (let i = 0; i < 600; i++) {
          const hs = window.STRYKER_PINE.pineHandles(chart);
          const h = hs[hs.length - 1];
          const rec = h && [...chart.orchestrator.registry.all()].find((r) => r.model && r.model.id === h.id);
          const m = rec && rec.model;
          if (m && m.tables && m.tables.length) {
            const lbl = (m.labels || []).map((l) => l.text || '').join('|'), tt = JSON.stringify(m.tables);
            const s = { ms: Math.round(performance.now() - t0), lines: (m.lines || []).length, labels: (m.labels || []).length, boxes: (m.boxes || []).length, pdh: /PDH/.test(lbl + tt), ny: /NY High|NY Low/.test(lbl + tt), asia: /Asia/.test(lbl + tt), ldn: /London/.test(lbl + tt), bars: chart.orchestrator.rawBars.length };
            if (!first) first = s;
            last = s;
            if (s.pdh && s.ny && s.asia && s.ldn) { full = s; break; }
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        return { first, full, last };
      });
      console.log('INFO ' + eng + ' first ' + JSON.stringify(res.first) + ' full ' + JSON.stringify(res.full));
      check(!!res.full, eng + ': full result (Asia, London, NY sessions + PDH) arrives', res.last);
      if (res.full) {
        check(res.full.bars > 2000, eng + ': the full result is computed on the whole loaded 1m history (' + res.full.bars + ' bars)');
        check(res.full.ms < TARGET_MS, eng + ': full result in ' + res.full.ms + ' ms (target < ' + TARGET_MS + ')');
      }
      await sleep(1500);
      const busyLeft = await p.evaluate(() => document.documentElement.classList.contains('stk-pine-busy'));
      check(!busyLeft, eng + ': the busy class is cleared once the result is drawn (animations resume)');
      await p.screenshot({ path: path.join(OUT, 'lm-1m-' + eng + '-1440.png') });
      check(!errors.length, eng + ': no console errors', errors);
      await ctx.close();
    }
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
