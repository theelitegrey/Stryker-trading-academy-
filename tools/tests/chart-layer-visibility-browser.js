// Renderer layers stay visible when they draw (assets/vela-chart.js "EMPTY LAYER CANVASES OFF"):
// an SDK layer canvas is hidden only after a render that cleared it and drew nothing. Checks, on
// both engines, with GEX Levels on ES (fixture API answers, fixtures/gex/SPX-0.json):
//   - the GEX layer paints its right-edge tags (canvas.__stkGexTags) and its canvas is VISIBLE;
//   - pixels are really on it (non-transparent pixels where the first tag box is);
//   - layers no indicator uses stay hidden.
//   node tools/tests/chart-dev-server.mjs 8073 &
//   CHART_BASE=http://127.0.0.1:8073 flock /tmp/stryker-chrome.lock node tools/tests/chart-layer-visibility-browser.js [shotsDir]
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8073';
const OUT = process.argv[2] || '.';
const FIX = path.join(__dirname, 'fixtures', 'gex');
// The fixture's ES levels (~7,820-7,900) sit above the dev server's synthetic ES price (~7,670), off
// screen, and Vela has no price-range setter; so they are moved next to the live price (same
// spacing) and the market is marked closed (no futures re-anchoring fetch).
const SPXJ = JSON.parse(fs.readFileSync(path.join(FIX, 'SPX-0.json'), 'utf8'));
let SPX = '';
function spxNear(price){
  const d = JSON.parse(JSON.stringify(SPXJ)), es = d.futures.ES, off = Math.round(es.futures_price - price);
  for (const k of Object.keys(es.levels)) es.levels[k] = Math.round((es.levels[k] - off) * 100) / 100;
  es.futures_price -= off; d.market.state = 'closed';
  return JSON.stringify(d);
}
const QQQ = fs.readFileSync(path.join(FIX, 'QQQ-0.json'), 'utf8');
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await launch();
  try {
    for (const v09 of [true, false]) {
      const eng = v09 ? 'v09' : 'v06';
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('vela-workspace'); localStorage.removeItem('vela-workspace-090'); localStorage.removeItem('stryker.vela.session'); } catch (e) {} });
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
      await ctx.route(/\/api\/gex\/levels\//, (r) => {
        const name = new URL(r.request().url()).pathname.split('/').pop().toUpperCase();
        r.fulfill({ status: name === 'SPX' || name === 'QQQ' ? 200 : 404, contentType: 'application/json', body: name === 'SPX' ? SPX : name === 'QQQ' ? QQQ : '{}' });
      });
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
      await p.goto(BASE + '/charts.html?vela=' + (v09 ? '0.9' : '0.6'), { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
      await p.evaluate(async () => {
        const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:ES1!'); ws.active.setTimeframe('5');
        for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 50) break; }
      });
      await sleep(1500);
      SPX = spxNear(await p.evaluate(() => window.STRYKER_VELA.chart.orchestrator.rawBars.slice(-1)[0].close));
      const before = await p.evaluate(() => [...document.querySelectorAll('.vela-cell canvas')].filter((c) => c.style.visibility === 'hidden').length);
      check(before >= 10, eng + ': unused layer canvases are hidden (' + before + ')');
      await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
      await p.waitForSelector('.stkiw-row[data-key="b:stk_gex"]', { timeout: 20000 });
      await p.evaluate(() => document.querySelector('.stkiw-row[data-key="b:stk_gex"] .stkiw-name').click());
      await p.evaluate(() => { try { window.STRYKER_VELA.indicatorPicker.close(); } catch (e) {} });
      let st = null;
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        st = await p.evaluate(() => {
          const c = [...document.querySelectorAll('canvas')].find((x) => x.__stkGexTags && x.__stkGexTags.length);
          if (!c) return null;
          const t = c.__stkGexTags[0].box, dpr = c.width / c.clientWidth || 1;
          const px = c.getContext('2d').getImageData(Math.round((t.x + t.w / 2) * dpr), Math.round((t.y + t.h / 2) * dpr), 1, 1).data;
          return { tags: c.__stkGexTags.length, vis: c.style.visibility || 'visible', cssVis: getComputedStyle(c).visibility, alpha: px[3], first: c.__stkGexTags[0].text };
        });
        if (st) break;
        if (i === 39) st = await p.evaluate(() => ({ dbg: [...document.querySelectorAll('canvas')].filter((x) => '__stkGexTags' in x).map((x) => ({ n: x.__stkGexTags.length, lines: (x.__stkGexLines || []).length, vis: x.style.visibility })), bars: window.STRYKER_VELA.chart.orchestrator.rawBars.slice(-1)[0] }));
      }
      check(!!st && st.tags >= 3 && st.vis !== undefined, eng + ': GEX tags painted', st);
      check(!!st && st.vis !== 'hidden' && st.cssVis === 'visible', eng + ': the GEX layer canvas is visible', st);
      check(!!st && st.alpha > 0, eng + ': pixels are on the GEX canvas under the first tag', st);
      await p.mouse.move(5, 5); await sleep(400);
      await p.screenshot({ path: path.join(OUT, 'layer-vis-gex-' + eng + '.png') });
      check(!errors.length, eng + ': no page errors', errors);
      await ctx.close();
    }
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
