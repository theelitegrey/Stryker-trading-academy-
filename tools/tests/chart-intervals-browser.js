// Charts interval picker browser test (assets/chart-intervals.js).
//   node tools/tests/chart-dev-server.mjs 8044
//   CHART_BASE=http://127.0.0.1:8044 node tools/tests/chart-intervals-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8044';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((theme) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (theme) localStorage.setItem('stryker_theme', theme); } catch (e) {} }, theme || null);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance\.com|data-api\.binance\.vision)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.__stkIntervals, null, { timeout: 45000 });
  await bars(p);
  return { ctx, p, errors };
}
const bars = (p, cell = 0) => p.evaluate(async (cell) => { for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); try { const b = window.STRYKER_VELA.context().cells[cell].chart.orchestrator.rawBars; if (b.length > 0) return b.length; } catch (e) {} } return 0; }, cell);
const rowIvs = (p) => p.evaluate(() => [...document.querySelectorAll('.stk-iv-row .stk-iv-b[data-iv]')].map((b) => b.dataset.iv + (b.classList.contains('on') ? '*' : '')));
const setTf = async (p, tf) => { await p.evaluate((tf) => window.__stkIntervals.apply(tf), tf); await sleep(400); return bars(p); };
const times = (p) => p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.slice(-400).map((b) => b.time));
async function shot(p, name) { await sleep(500); await p.screenshot({ path: OUT + '/' + name }); console.log('SHOT ' + OUT + '/' + name); }
(async () => {
  const b = await launch();
  try {
    // ---- 1440 dark ----
    let { ctx, p, errors } = await open(b, { w: 1440, h: 900 });
    check(JSON.stringify(await rowIvs(p)) === JSON.stringify(['1', '5', '15*', '60', '240', 'D']), 'default row 1m 5m 15m 1h 4h D, 15m active: ' + (await rowIvs(p)).join(' '));
    const vis = await p.evaluate(() => { const c = document.querySelector('.vela-widget-tf-group > .vela-widget-tf-caret'); return c ? getComputedStyle(c).display : 'none'; });
    check(vis === 'none', 'Vela caret hidden');
    await p.click('.stk-iv-caret'); await sleep(300);
    const m = await p.evaluate(() => { const m = document.getElementById('stk-iv-menu'); return { open: !m.hidden, heads: [...m.querySelectorAll('.stk-iv-h')].map((h) => h.textContent), on: (m.querySelector('.stk-iv-r.on') || {}).textContent, ov: getComputedStyle(m).overflowY, rows: m.querySelectorAll('.stk-iv-r').length, add: m.querySelector('.stk-iv-add').textContent }; });
    check(m.open && m.heads.join(',') === 'Ticks,Seconds,Minutes,Hours,Days', 'menu open with 5 sections: ' + m.heads.join(','));
    check(m.rows === 28 && /15 minutes/.test(m.on || ''), 'menu 28 rows, active "15 minutes"');
    check(m.ov === 'auto' && /custom/.test(m.add), 'menu scrolls inside itself; "+ Add custom interval…" on top');
    await p.hover('.stk-iv-r[data-iv="45"]'); await shot(p, 'iv-menu-1440-dark.png');
    // star 45m -> row gains it; unstar 4h -> row loses it
    await p.click('.stk-iv-r[data-iv="45"] .stk-iv-star'); await sleep(200);
    await p.click('.stk-iv-r[data-iv="240"] .stk-iv-star'); await sleep(200);
    let r = await rowIvs(p);
    check(r.includes('45') && !r.includes('240') && r.indexOf('45') === r.indexOf('15*') + 1, 'star 45m / unstar 4h updates the row in time order: ' + r.join(' '));
    // collapse Ticks, remembered
    await p.click('.stk-iv-h[aria-controls="stk-iv-sec-ticks"]'); await sleep(200);
    check(await p.evaluate(() => document.getElementById('stk-iv-sec-ticks').hidden), 'Ticks section collapses');
    // NQ 10s -> Rithmic message, no switch
    const tag = await p.evaluate(() => (document.querySelector('.stk-iv-r[data-iv="10S"] .tag') || {}).textContent);
    check(tag === 'Rithmic', 'NQ seconds row carries the Rithmic tag');
    await p.click('.stk-iv-r[data-iv="10S"]'); await sleep(500);
    const t1 = await p.evaluate(() => ({ tf: window.STRYKER_VELA.active.timeframe, toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join('|') }));
    check(t1.tf === '15' && /Rithmic connection/.test(t1.toast), 'NQ 10s shows the Rithmic message and stays on 15m (' + t1.toast.trim().slice(0, 80) + ')');
    await p.keyboard.press('Escape');
    // 2m and 45m on NQ, aggregated and session-aligned
    for (const [tf, mins] of [['2', 2], ['45', 45], ['180', 180]]) {
      const n = await setTf(p, tf);
      const ts = await times(p);
      const steps = ts.slice(1).map((t, i) => t - ts[i]);
      const minStep = Math.min(...steps.filter((s) => s > 0));
      // every bar start is a whole bucket from that day's 18:00 New York open
      const off = await p.evaluate((ts) => { const f = (t) => { const d = new Date(t); const s = d.toLocaleString('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }); const [h, m] = s.split(':').map(Number); return ((h * 60 + m) - 18 * 60 + 1440) % 1440; }; return ts.map(f); }, ts);
      const aligned = off.every((o) => o % mins === 0);
      check(n > 20 && minStep === mins * 60000 && aligned, 'NQ ' + tf + ': ' + n + ' bars, step ' + minStep / 60000 + 'm, all aligned to the 18:00 ET open: ' + aligned);
      if (tf === '45') await shot(p, 'iv-nq45-1440-dark.png');
    }
    const n3 = await setTf(p, '3M');
    check(n3 > 5, 'NQ 3M builds from monthly bars: ' + n3 + ' bars');
    await setTf(p, '15');
    // BTC seconds -> next update message
    await p.evaluate(() => window.STRYKER_VELA.active.setSymbol('binance:BTCUSDT')); await sleep(1500); await bars(p);
    await p.evaluate(() => window.__stkIntervals.open()); await sleep(300);
    const btc = await p.evaluate(() => ({ tag: !!document.querySelector('.stk-iv-r[data-iv="15S"] .tag'), title: document.querySelector('.stk-iv-r[data-iv="15S"]').title }));
    check(!btc.tag && /next update/.test(btc.title), 'BTC seconds: no Rithmic tag, says next update');
    await p.keyboard.press('Escape');
    const nb = await setTf(p, '45');
    check(nb > 20, 'BTC 45m loads ' + nb + ' bars');
    // 2x2 with Interval sync on
    await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.setLayout('4'); }); await sleep(2500);
    await p.evaluate(() => window.STRYKER_VELA.sync.set('timeframe', true)); await sleep(500);
    await setTf(p, '10'); await sleep(2500);
    const tfs = await p.evaluate(() => window.STRYKER_VELA.context().cells.map((c) => c.timeframe));
    check(tfs.length === 4 && tfs.every((t) => t === '10'), '2x2 + Interval sync: every cell on 10m: ' + tfs.join(','));
    await shot(p, 'iv-2x2-1440-dark.png');
    check(errors.length === 0, 'no page errors (' + errors.slice(0, 3).join(' | ') + ')');
    // reload: favourites + collapse persist
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkIntervals, null, { timeout: 45000 }); await sleep(1500);
    r = await rowIvs(p);
    await p.evaluate(() => window.__stkIntervals.open()); await sleep(300);
    const col = await p.evaluate(() => document.getElementById('stk-iv-sec-ticks').hidden);
    check(r.includes('45') && !r.includes('240') && col, 'reload keeps favourites and collapsed Ticks: ' + r.join(' '));
    await ctx.close();
    // ---- 1440 day ----
    ({ ctx, p, errors } = await open(b, { w: 1440, h: 900, theme: 'day' }));
    await p.click('.stk-iv-caret'); await sleep(300); await p.hover('.stk-iv-r[data-iv="60"]');
    await shot(p, 'iv-menu-1440-day.png');
    await ctx.close();
    // ---- 390 phone ----
    ({ ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true }));
    const ph = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, row: [...document.querySelectorAll('.stk-iv-row .stk-iv-b[data-iv]')].map((b) => b.dataset.iv), mb: !!document.querySelector('.vela-mb-tf') }));
    check(ph.sw <= 390, 'phone: no sideways overflow (' + ph.sw + ')');
    check(ph.row.length <= 1, 'phone topbar row collapsed to the active interval: ' + ph.row.join(','));
    if (ph.mb) { await p.click('#vela-chart .vela-mb-tf'); } else { await p.click('.stk-iv-caret'); }
    await sleep(400);
    const sh = await p.evaluate(() => { const m = document.getElementById('stk-iv-menu'); const r = m.getBoundingClientRect(); return { open: !m.hidden, sheet: m.classList.contains('sheet'), l: r.left, rr: r.right }; });
    check(sh.open && sh.l >= 0 && sh.rr <= 390, 'phone: menu opens inside the screen (sheet ' + sh.sheet + ')');
    await shot(p, 'iv-menu-390-dark.png');
    await p.click('.stk-iv-r[data-iv="5"]'); await sleep(600);
    check(await p.evaluate(() => window.STRYKER_VELA.active.timeframe) === '5', 'phone: picking 5 minutes switches the chart');
    await shot(p, 'iv-chart-390-dark.png');
    check(errors.length === 0, 'phone: no page errors (' + errors.slice(0, 3).join(' | ') + ')');
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? 'FAILURES ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
