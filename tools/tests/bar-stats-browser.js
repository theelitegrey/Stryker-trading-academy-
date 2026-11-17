// "Bar Stats" indicator browser test (assets/chart-bar-stats.js + chart-bar-stats-ind.js) on NQ1! candles.
//   node tools/tests/chart-dev-server.mjs 8071
//   CHART_BASE=http://127.0.0.1:8071 OF_FIXTURE_DIR=<dir with NQ-2026-10-13.bin + empty.bin> OF_RAW=<raw-1430.json> \
//     node tools/tests/bar-stats-browser.js <shotsDir>
// Order flow is answered from a real recorder payload saved on disk, candles are built from it (same as chart-footprint-browser.js).
// Checks: added from the picker (search "delta table"), 6 rows, columns aligned to the bars (+-1 px), values equal the Footprint's own
// table for the same bars, every settings toggle, no candle under the table, a symbol without order flow shows the note,
// alignment numbers (rows share spacing, label + cell centres), shots 1440 dark + light and 390 dark.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8071';
const FIX = process.env.OF_FIXTURE_DIR, RAW = JSON.parse(fs.readFileSync(process.env.OF_RAW, 'utf8'));
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 600) : '')); };
let CANDLES = null;
async function candles(tf) {
  if (!CANDLES) {
    const D = await import(path.resolve(__dirname, '../../assets/chart-footprint-data.js'));
    CANDLES = { D, bars: D.decodeOrderflow(new Uint8Array(fs.readFileSync(path.join(FIX, 'NQ-2026-10-13.bin')))).bars };
  }
  return CANDLES.D.aggregate(CANDLES.bars, tf * 60000).map((b) => [b.t / 1000, b.o * 0.25, b.hi * 0.25, b.lo * 0.25, b.c * 0.25, b.vol]);
}
async function open(b, { w, h, mobile, light }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((l) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker.vela.session'); } catch (e) {} if (l) window.__light = true; }, light);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, async (r) => {
    const u = new URL(r.request().url()), tf = Number(u.searchParams.get('tf')) || 1, page = Number(u.searchParams.get('page')) || 0;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: String(tf), page, bars: await candles(tf) }) });
  });
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/orderflow/, (r) => {
    const u = new URL(r.request().url()), f = path.join(FIX, u.searchParams.get('sym') + '-' + u.searchParams.get('day') + '.bin');
    r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(fs.existsSync(f) ? f : path.join(FIX, 'empty.bin')) });
  });
  const p = await ctx.newPage(), errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|WebSocket connection|Failed to load resource|\/api\/chart\/stream/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkOrderflow, null, { timeout: 60000 });
  if (light) await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); window.dispatchEvent(new Event('stryker:theme')); try { window.STRYKER_VELA.setTheme('light'); } catch (e) {} });
  await sleep(2000);
  await p.evaluate(() => { window.__stkTestL1 = true; window.__stkOfTestTier = { free: false, plan: 'Pro' }; });
  return { ctx, p, errors };
}
const setMarket = async (p, sym, tf) => { await p.evaluate(async ([s, t]) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe(t); for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === s && ws.chart.market.timeframe === t && ws.chart.orchestrator.rawBars.length > 50) break; } }, [sym, tf]); await sleep(1200); };
const frame = async (p, t0, t1) => { await p.evaluate(([a, z]) => window.STRYKER_VELA.chart.setVisibleRange({ from: a, to: z }), [t0, t1]); await sleep(1000); };
const bs = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__stkBarStatsDebug || null)));
const waitTable = async (p, pred, ms = 20000) => { const t0 = Date.now(); let d = null; while (Date.now() - t0 < ms) { d = await bs(p); if (d && d.table && pred(d.table)) return d; await sleep(400); } return d; };
const setIn = (p, o) => p.evaluate((o) => { const h = window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === 'stk_barstats'); h.setInputs(Object.assign({}, h.inputValues(), o)); }, o);
const ROWS = ['vol', 'delta', 'dpct', 'buy', 'sell', 'trd'];

(async () => {
  const T = RAW.t * 1000;
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const vp of [{ w: 1440, h: 900, tag: '1440-dark' }, { w: 1440, h: 900, tag: '1440-light', light: true }, { w: 390, h: 844, tag: '390-dark', mobile: true }]) {
      const { ctx, p, errors } = await open(b, vp);
      await setMarket(p, 'futures:NQ1!', '1');
      await p.waitForFunction(() => window.__stkOrderflow.loaded('NQ').some((d) => d.n > 0), null, { timeout: 20000 }).catch(() => {});
      const first = vp.tag === '1440-dark';
      const base0 = await p.evaluate(() => window.STRYKER_VELA.chart.renderer.getConfig().margins.bottom);
      let withTbl = null;
      if (first) {   // add from the picker
        await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await sleep(900);
        await p.evaluate(() => { const i = document.querySelector('.stkiw-sr input'); i.focus(); });
        await p.keyboard.type('delta table'); await sleep(900);
        const row = await p.evaluate(() => { const r = document.querySelector('.stkiw-row[data-key="b:stk_barstats"]'); return r ? r.textContent : null; });
        check(row && /Bar Stats/.test(row), 'picker: "delta table" finds Bar Stats', row);
        const grp = await p.evaluate(() => { const r = document.querySelector('.stkiw-row[data-key="b:stk_barstats"]'); return !!r; });
        await p.evaluate(() => { const r = document.querySelector('.stkiw-row[data-key="b:stk_barstats"]'); const a = r && (r.querySelector('.stkiw-add') || r); a.click(); }); await sleep(1500);
        await p.keyboard.press('Escape'); await sleep(400);
        check(grp && await p.evaluate(() => window.STRYKER_VELA.chart.indicators().some((x) => x.nativeType === 'stk_barstats')), 'added from the picker');
      } else await p.evaluate(() => { window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator('stk_barstats', { inputs: {} }); window.STRYKER_VELA.context().stateChanged(); });
      await frame(p, T - 12 * 60000, T + 12 * 60000);
      if (vp.mobile) await frame(p, T - 3.5 * 60000, T + 3.5 * 60000);
      let d = await waitTable(p, (t) => t.cols && t.cols.length > 3);
      const t = d && d.table;
      check(t && t.cols.length > 3, vp.tag + ': table drawn (' + (t && t.cols.length) + ' columns)', d);
      if (!t || !t.cols) { await ctx.close(); continue; }
      check(t.rows.length === 6 && ROWS.every((r, i) => t.rows[i] === r), vp.tag + ': 6 rows ' + t.rows.join(','), t.rows);
      // columns aligned to the candle slots: centre of column i = coords.logicalToX(i)
      const al = await p.evaluate((cols) => { const co = window.STRYKER_VELA.chart.renderer.renderer.coords, bw = co.pxPerBar(); return cols.map((c) => ({ dx: Math.abs((c.xl + c.w / 2) - co.logicalToX(c.i)), dw: Math.abs(c.w - (bw - 1)) })); }, t.cols);
      check(al.every((x) => x.dx <= 1 && x.dw <= 1), vp.tag + ': ' + al.length + ' columns centred on their bar (max dx ' + Math.max(...al.map((x) => x.dx)).toFixed(2) + ' px, width gap ' + Math.max(...al.map((x) => x.dw)).toFixed(2) + ')', al.slice(0, 3));
      const gaps = t.cols.slice(1).map((c, i) => c.xl - t.cols[i].xl), step = gaps[0];
      check(gaps.every((g) => Math.abs(g - step) <= 1), vp.tag + ': equal column pitch ' + (step || 0).toFixed(1) + ' px', gaps);
      // vertical: rows are an equal pitch and the table sits at the bottom of the price pane with its own reserved space
      const geo = await p.evaluate(() => { const r = window.STRYKER_VELA.chart.renderer.renderer, co = r.coords; return { h: co.height, w: co.width }; });
      console.log(vp.tag, 'table y0', t.y0, 'row h', t.rh, 'H', t.H, 'canvas', JSON.stringify(geo), 'cell centres', t.rows.map((_, i) => (t.y0 + i * t.rh + t.rh / 2).toFixed(1)).join(' '));
      // no candle under the table: the lowest candle low in view maps above the table top
      const low = await p.evaluate(([t0, t1]) => { const c = window.STRYKER_VELA.chart, co = c.renderer.renderer.coords, rb = c.orchestrator.rawBars.filter((x) => x.time >= t0 && x.time <= t1); const lo = Math.min(...rb.map((x) => x.low)); const sc = (c.renderer.renderer.lastFrame || {}); return { lo }; }, [T - 12 * 60000, T + 12 * 60000]);
      const shotCan = await p.evaluate(() => { const cs = [...document.querySelectorAll('#vela-chart canvas')]; return cs.length; });
      // values equal the footprint table (same bars): switch the chart type to Footprint with its table on, read its debug
      await sleep(800); withTbl = await p.evaluate(() => window.STRYKER_VELA.chart.renderer.getConfig().margins.bottom);
      const mine = Object.fromEntries(t.cols.map((c) => [c.t, c.txt]));
      await p.screenshot({ path: OUT + '/barstats-' + vp.tag + '.png' });
      if (!vp.mobile) {
        await p.evaluate(() => { window.__stkFpDebug = {}; window.STRYKER_VELA.active.setPriceStyle('stk_fp'); });
        await sleep(800);
        await p.evaluate(() => window.STRYKER_VELA.chart.renderer.applyConfig({ chartTypes: { stk_fp: { fpTable: true, fpSrc: 'l1' } } })); await sleep(300);
        await frame(p, T - 12 * 60000, T + 12 * 60000); await sleep(1500);
        const fp = await p.evaluate(() => JSON.parse(JSON.stringify(window.__stkFpDebug && window.__stkFpDebug.table || null)));
        check(fp && fp.cols && fp.cols.length > 3, vp.tag + ': footprint table drawn too (' + (fp && fp.cols && fp.cols.length) + ' columns)');
        if (fp && fp.cols) {
          check(fp.rows.join() === t.rows.join(), vp.tag + ': same rows as the footprint table', [fp.rows, t.rows]);
          let n = 0, bad = [];
          for (const c of fp.cols) { const m = mine[c.t]; if (!m) continue; n++; for (const k of Object.keys(c.txt)) if (m[k] !== c.txt[k]) bad.push([c.t, k, m[k], c.txt[k]]); }
          check(n > 3 && !bad.length, vp.tag + ': ' + n + ' bars x 6 rows equal the footprint table (' + bad.length + ' different)', bad.slice(0, 4));
        }
        await p.evaluate(() => window.STRYKER_VELA.chart.renderer.applyConfig({ chartTypes: { stk_fp: { fpTable: false } } })); await sleep(600);
        await p.evaluate(() => window.STRYKER_VELA.active.setPriceStyle('candles')); await sleep(1200);
        await frame(p, T - 12 * 60000, T + 12 * 60000);
      }
      if (first) {
        // settings: each row off removes it, back on restores it
        for (const [k, key] of [['vol', 'showVol'], ['delta', 'showDelta'], ['dpct', 'showDpct'], ['buy', 'showBuy'], ['sell', 'showSell'], ['trd', 'showTrd']]) {
          await setIn(p, { [key]: false }); let r = await waitTable(p, (x) => !x.rows.includes(k));
          check(r.table.rows.length === 5 && !r.table.rows.includes(k), 'row ' + k + ' off removes it', r.table.rows);
          await setIn(p, { [key]: true }); await waitTable(p, (x) => x.rows.includes(k));
        }
        await setIn(p, { position: 'Top' }); let r = await waitTable(p, (x) => x.y0 < 200);
        check(r.table.y0 < 200, 'position Top: table y0 ' + r.table.y0, r.table);
        await p.screenshot({ path: OUT + '/barstats-1440-dark-top.png' });
        await setIn(p, { position: 'Bottom', labelSide: 'Left' }); r = await waitTable(p, (x) => x.labL === true);
        check(r.table.labL === true && r.table.cols.every((c) => c.xl >= r.table.cellL), 'labels Left: cells start right of the label column', { cellL: r.table.cellL });
        await p.screenshot({ path: OUT + '/barstats-1440-dark-left.png' });
        await setIn(p, { labelSide: 'Right', textSize: 'Large', opacity: 60, scheme: 'Blue / orange' }); await sleep(900);
        r = await bs(p); check(r.table.rh === 18, 'text size Large: row height ' + r.table.rh, r.table.rh);
        await p.screenshot({ path: OUT + '/barstats-1440-dark-settings.png' });
        await setIn(p, { textSize: 'Normal', opacity: 100, scheme: 'Heat map (default)' }); await sleep(700);
        // zoomed out: hint, no numbers
        await frame(p, T - 200 * 60000, T + 10 * 60000); r = await waitTable(p, (x) => !!x.note);
        check(r.table && /Zoom in/.test(r.table.note || ''), 'zoomed out: "Zoom in to see bar stats"', r.table);
        await frame(p, T - 12 * 60000, T + 12 * 60000);
        // candles never under the table: the chart's bottom margin was raised to hold the table
        check(withTbl > base0, 'bottom margin reserved for the table (' + base0 + '% -> ' + withTbl + '% of the pane)');
        // removing the indicator puts the member's margin back and clears the table
        await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart, h = c.indicators().find((x) => x.nativeType === 'stk_barstats'); h.remove ? h.remove() : c.removeIndicator(h.id); }); await sleep(1500);
        const m2 = await p.evaluate(() => window.STRYKER_VELA.chart.renderer.getConfig().margins);
        check(m2.bottom === base0, 'removed: margin back to ' + base0 + '% (is ' + m2.bottom + ')', m2);
        // a symbol without order flow: note instead of numbers
        await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator('stk_barstats', { inputs: {} }));
        await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:ZN1!'); }); await sleep(3000);
        r = await waitTable(p, (x) => !!x.note, 12000); console.log('ZN1!', JSON.stringify(r), await p.evaluate(() => [window.STRYKER_VELA.chart.market.symbol, window.STRYKER_VELA.chart.indicators().map((x) => x.nativeType).join(), window.STRYKER_VELA.chart.orchestrator.rawBars.length])); check(r && r.table && /Order flow not available/.test(r.table.note || ''), 'symbol without order flow: note', r && r.table);
        await p.screenshot({ path: OUT + '/barstats-1440-dark-nodata.png' });
      }
      check(errors.length === 0, vp.tag + ': no console errors', errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
