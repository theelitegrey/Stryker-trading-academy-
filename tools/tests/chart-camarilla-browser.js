// Charts "Camarilla Pivots" browser test (assets/chart-camarilla.js) on NQ 5m at 1440 (dark + light) and 390 (dark).
//   node tools/tests/chart-dev-server.mjs 8061
//   CHART_BASE=http://127.0.0.1:8061 node tools/tests/chart-camarilla-browser.js [shotsDir]
// Bars come from the dev server's /api/chart/bars. Expected levels are recomputed here from the chart's OWN bars with the pure maths.
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || process.env.STRYKER_TEST_BASE || 'http://127.0.0.1:8061';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 500) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitBars = (p) => p.evaluate(async () => {
  for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 200) return true; } catch (e) {} }
  return false;
});
async function open(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
  return { ctx, p, errors };
}
const painted = (p) => p.evaluate(() => { for (const c of document.querySelectorAll('canvas')) if (c.__stkCam && c.__stkCam.length) return c.__stkCam; return []; });
const camData = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.context().cells[0].chart, seen = new Set();
  const find = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null; seen.add(o); if (o.nativeData instanceof Map && o.nativeData.has('stk_camarilla')) return o.nativeData.get('stk_camarilla'); for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} } return null; };
  return JSON.parse(JSON.stringify(find(c, 0) || null));
});
async function shot(p, name) { await p.mouse.move(5, 5).catch(() => {}); await sleep(700); await p.screenshot({ path: OUT + '/' + name }); console.log('SHOT ' + OUT + '/' + name); }

(async () => {
  const D = await import(path.resolve(__dirname, '../../assets/chart-camarilla-data.js'));
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [name, W, H, mobile, light] of [['1440-dark', 1440, 900, false, false], ['1440-light', 1440, 900, false, true], ['390-dark', 390, 844, true, false]]) {
      const { ctx, p, errors } = await open(b, { w: W, h: H, mobile });
      if (light) await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); window.dispatchEvent(new Event('stryker:theme')); try { window.STRYKER_VELA.setTheme('light'); } catch (e) {} });
      await p.evaluate(() => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol('futures:NQ1!'); c.setTimeframe('5'); });
      await sleep(2500); check(await waitBars(p), name + ': NQ 5m bars loaded');
      if (name === '1440-dark') {
        await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await sleep(800);
        const row = await p.evaluate(() => { const r = document.querySelector('.stkiw-row[data-key="b:stk_camarilla"]'); return r ? r.textContent : null; });
        check(row && /Camarilla Pivots/.test(row) && !/lizard/i.test(row), 'picker row: ' + row);
        const lock = await p.evaluate(() => { const r = document.querySelector('.stkiw-row[data-key="b:stk_camarilla"]'); return r ? !!r.querySelector('[class*=lock], [class*=pro]') : null; });
        check(lock === false, 'no Pro lock on the row');
        await p.keyboard.press('Escape'); await sleep(400);
      }
      await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_camarilla', { inputs: {} }); window.STRYKER_VELA.context().stateChanged(); });
      await sleep(2500);
      const d = await camData(p);
      check(d && d.sets && d.sets.length >= 1 && d.sets.length <= 5, name + ': level sets (' + (d && d.sets && d.sets.length) + ')', d);
      if (d && d.sets) {
        const raw = await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.map((x) => ({ time: x.time, high: x.high, low: x.low, close: x.close })));
        const exp = D.levelSets(raw, 'D', true, 300000, 5), last = exp[exp.length - 1], got = d.sets[d.sets.length - 1];
        check(got.last && got.start === last.start, name + ': today set starts at the 18:00 NY session open ' + new Date(got.start).toISOString());
        const byId = Object.fromEntries(got.lines.map((l) => [l.id, l.price]));
        check(Object.keys(last.levels).every((k) => Math.abs(byId[k] - last.levels[k]) <= 0.125 + 1e-6 && Math.abs(byId[k] / 0.25 - Math.round(byId[k] / 0.25)) < 1e-6) && got.lines.length === 15, name + ': 15 levels equal the formula, rounded to the 0.25 tick');
        check(got.lines.map((l) => l.label).join(' ') === 'R5 R4 RB3 R3 R2 R1 Y-High Y-Close Y-Low S1 S2 S3 SB3 S4 S5', name + ': labels in order');
        check(!/lizard/i.test(JSON.stringify(d)), name + ': no vendor name in data');
      }
      const pp = await painted(p);
      check(pp.length >= 1 || name === '390-dark', name + ': tags painted (' + pp.length + ' of 15 on screen; phone default scale may show none)');
      await shot(p, 'camarilla-nq5m-' + name + '.png');
      if (name === '1440-dark') {
        await p.evaluate(() => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_camarilla'); h.setInputs(Object.assign({}, h.inputValues(), { g5: false, yc: false })); });
        await sleep(1200);
        const d2 = await camData(p);
        check(d2.sets[0].lines.length === 12 && !d2.sets[0].lines.some((l) => l.id === 'R5' || l.id === 'YC'), 'toggle R5/S5 + Y-Close off -> 12 lines');
        await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setTimeframe('D'); });
        await sleep(3500);
        const d3 = await camData(p);
        check(d3 && ((d3.sets && d3.sets.length === 1) || d3.note), 'daily chart: one newest set or a short note', d3);
      }
      check(errors.length === 0, name + ': no page errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
