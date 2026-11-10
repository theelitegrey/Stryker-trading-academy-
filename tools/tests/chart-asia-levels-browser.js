// BUG-ASIA browser repro on the real Charts page (real NQ bars from the local dev server's Yahoo feed).
// The 1m chart is cut so its data STARTS 2 h into the latest finished Asia session (22:00 NY): before the fix the
// Liquidity Master drew that partial high/low as "Asia High/Low" while the 15m chart (full history) drew the true one.
// Passes when every Asia level on the 1m chart also exists (same price) on the 15m chart.
//   node tools/tests/chart-dev-server.mjs 8071      (kill it by PID afterwards)
//   CHART_BASE=http://127.0.0.1:8071 OUT=/tmp/asia THEME=dark flock /tmp/stryker-chrome.lock node tools/tests/chart-asia-levels-browser.js
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs'), path = require('path');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8071';
const OUT = process.env.OUT || '/tmp/asia';
const THEME = process.env.THEME || 'dark';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fail++; };
async function open(b, w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, colorScheme: THEME });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t); } catch (e) {} }, THEME);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 60000 });
  return { ctx, p };
}
async function load(p, tf, startAsia) {
  await p.evaluate((t) => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id); c.setSymbol('futures:NQ1!'); c.setTimeframe(t); }, tf);
  return p.evaluate(async ([tf, startAsia]) => {
    const chart = window.STRYKER_VELA.context().cells[0].chart, o = chart.orchestrator;
    for (let i = 0; i < 90; i++) { await new Promise((r) => setTimeout(r, 500)); try { if (o.rawBars.length > 50 && o.historyState !== 'backfill' && chart.market.timeframe === tf) break; } catch (e) {} }
    await chart.setMarket({ bars: 4000 }); await chart.historyComplete();
    const nyMin = (t) => { const q = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t); return +q[0].value * 60 + +q[2].value; };
    let n = o.rawBars.length;
    if (startAsia) {
      const bars = o.rawBars; let i = bars.length - 1; while (i > 0 && nyMin(bars[i].time) !== 22 * 60) i--;
      n = bars.length - i;
      await chart.setMarket({ bars: n }); await chart.historyComplete();
    }
    return { n, first: o.rawBars[0].time };
  }, [tf, startAsia]);
}
async function addLM(p) {
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await p.waitForSelector('.stkiw-row', { timeout: 20000 });
  await p.evaluate(() => document.querySelector('.stkiw-tab[data-k="picks"]').click());
  await p.waitForTimeout(300);
  const before = await p.evaluate(() => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).length);
  await p.evaluate(() => [...document.querySelectorAll('.stkiw-row')].find((r) => (r.querySelector('.stkiw-nm') || {}).textContent === 'Liquidity Master [TradeZoro]').querySelector('.stkiw-name').click());
  await p.waitForFunction((n) => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).length > n, before, { timeout: 60000 });
  await p.evaluate(() => { try { window.STRYKER_VELA.indicatorPicker.close(); } catch (e) {} });
}
async function asia(p) {
  return p.evaluate(async () => {
    const chart = window.STRYKER_VELA.context().cells[0].chart;
    const h = window.STRYKER_PINE.pineHandles(chart).slice(-1)[0];
    for (let i = 0; i < 160; i++) {
      const rec = [...chart.orchestrator.registry.all()].find((r) => r.model && r.model.id === h.id);
      if (rec && rec.model && rec.model.tables && rec.model.tables.length) {
        const snap = () => (rec.model.labels || []).filter((l) => /Asia (High|Low)/.test(l.text || '')).map((l) => l.text + ' ' + (+l.y).toFixed(2));
        window.__snaps = [snap().join(';')];
        for (const w of [1500, 4000, 8000]) { await new Promise((r) => setTimeout(r, w)); const r2 = [...chart.orchestrator.registry.all()].find((r) => r.model && r.model.id === h.id); window.__snaps.push(w + 'ms: ' + (r2.model.labels || []).filter((l) => /Asia (High|Low)/.test(l.text || '')).map((l) => l.text + ' ' + (+l.y).toFixed(2)).join(';') + ' nBars=' + chart.orchestrator.rawBars.length); }
        const ob = chart.orchestrator.rawBars;
        const T0 = Date.UTC(2026, 10, 10, 1, 0), nb = ob.filter((x) => x.time >= T0 && x.time < T0 + 4 * 36e5);
        window.__raw = ob.map((x) => [x.time, x.open, x.high, x.low, x.close, x.volume]);
        window.__asiaDbg = { nightBars: nb.length, nightMax: Math.max(...nb.map((x) => x.high)), nightMin: Math.min(...nb.map((x) => x.low)), nightFirst: nb[0] && new Date(nb[0].time).toISOString(), bars: ob.length, first: new Date(ob[0].time).toISOString(), last: new Date(ob[ob.length - 1].time).toISOString(), lbl: (rec.model.labels || []).filter((l) => /Asia (High|Low)/.test(l.text || '')).map((l) => l.text + ' ' + l.y + ' @' + new Date(l.x).toISOString()) };
        return (rec.model.labels || []).filter((l) => /Asia (High|Low)/.test(l.text || '')).map((l) => +(+l.y).toFixed(2)).sort((a, b) => a - b);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  });
}
(async () => {
  const b = await launch();
  try {
    const res = {};
    for (const [tf, startAsia, w, h, shot] of [['15', false, 1440, 900, 'asia-15m-1440.png'], ['1', true, 1440, 900, 'asia-1m-1440.png'], ['1', true, 390, 844, 'asia-1m-390.png'], ['15', false, 390, 844, 'asia-15m-390.png']]) {
      const { ctx, p } = await open(b, w, h);
      const info = await load(p, tf, startAsia);
      await addLM(p);
      const a = await asia(p);
      console.log(`INFO ${tf}m @${w} bars ${info.n} from ${new Date(info.first).toISOString()} Asia levels: ${JSON.stringify(a)}`);
      console.log('SNAPS', JSON.stringify(await p.evaluate(() => window.__snaps)));
      if (process.env.DUMP && tf === '1' && w === 1440) fs.writeFileSync(process.env.DUMP, JSON.stringify(await p.evaluate(() => window.__raw)));
      if (w === 1440) res[tf] = a;
      await p.waitForTimeout(800);
      await p.screenshot({ path: path.join(OUT, shot) });
      await ctx.close();
    }
    check(res['15'] && res['15'].length >= 2, '15m chart draws Asia levels: ' + JSON.stringify(res['15']));
    check(res['1'] && res['15'] && res['1'].every((y) => res['15'].some((z) => Math.abs(z - y) < 0.01)), '1m (starts mid-Asia) draws no Asia level the 15m chart lacks: ' + JSON.stringify(res['1']));
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
