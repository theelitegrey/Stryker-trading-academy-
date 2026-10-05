// Charts interval picker, stage 2: crypto seconds + tick bars, custom intervals, typed box, guard.
//   node tools/tests/chart-dev-server.mjs 8044
//   CHART_BASE=http://127.0.0.1:8044 node tools/tests/chart-intervals2-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8044';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bars = (p, cell = 0, tries = 80) => p.evaluate(async ([cell, tries]) => { for (let i = 0; i < tries; i++) { await new Promise((r) => setTimeout(r, 300)); try { const b = window.STRYKER_VELA.context().cells[cell].chart.orchestrator.rawBars; if (b.length > 0) return b.length; } catch (e) {} } return 0; }, [cell, tries]);
const raw = (p) => p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.map((b) => ({ t: b.time, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume })));
const tf = (p) => p.evaluate(() => window.STRYKER_VELA.active.timeframe);
const toasts = (p) => p.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | '));
async function shot(p, name) { await sleep(500); await p.screenshot({ path: OUT + '/' + name }); console.log('SHOT ' + OUT + '/' + name); }
(async () => {
  const b = await launch();
  try {
    for (const theme of [null, 'day']) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(stub);
      await ctx.addInitScript((theme) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (theme) localStorage.setItem('stryker_theme', theme); } catch (e) {} }, theme);
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance\.com|data-api\.binance\.vision)/, (r) => r.abort());
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(String(e)));
      p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5/.test(m.text())) errors.push(m.text()); });
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.STRYKER_VELA && window.__stkIntervals, null, { timeout: 45000 });
      await bars(p);
      if (theme === 'day') {
        await p.evaluate(() => window.__stkIntervals.openCustom()); await sleep(300);
        await shot(p, 'iv2-custom-1440-day.png');
        await ctx.close(); continue;
      }
      // typed box: "4h" + Enter on the chart (NQ)
      await p.mouse.click(700, 450); await sleep(200);
      await p.keyboard.press('4'); await sleep(250);
      const qOpen = await p.evaluate(() => { const q = document.querySelector('.stk-iv-dlg.quick'); return !!q && !q.hidden && document.activeElement === q.querySelector('input'); });
      const velaQuick = await p.evaluate(() => !!document.querySelector('.vela-tq-input') && document.querySelector('.vela-tq-input').offsetParent !== null);
      check(qOpen && !velaQuick, 'typing "4" on the chart opens our interval box (Vela box not shown)');
      await p.keyboard.type('h'); await sleep(150);
      const hint = await p.evaluate(() => document.querySelector('.stk-iv-dlg.quick .msg').textContent);
      await shot(p, 'iv2-typed-1440-dark.png');
      await p.keyboard.press('Enter'); await sleep(600);
      check(hint === '4 hours' && (await tf(p)) === '240', 'typed 4h + Enter -> 4h (hint "' + hint + '")');
      // typing inside an input never opens the box
      await p.evaluate(() => { const i = document.createElement('input'); i.id = 'tst-in'; document.body.appendChild(i); i.focus(); });
      await p.keyboard.press('5'); await sleep(250);
      check(await p.evaluate(() => document.querySelector('.stk-iv-dlg.quick').hidden && document.getElementById('tst-in').value === '5'), 'digits inside an input stay in the input');
      await p.evaluate(() => document.getElementById('tst-in').remove());
      // typed D
      await p.mouse.click(700, 450); await p.keyboard.press(','); await sleep(200); await p.keyboard.type('D'); await p.keyboard.press('Enter'); await sleep(600);
      check((await tf(p)) === 'D', '"," then D + Enter -> daily');
      // NQ 100T -> Rithmic message
      await p.evaluate(() => window.__stkIntervals.apply('100T')); await sleep(400);
      check((await tf(p)) === 'D' && /Rithmic connection/.test(await toasts(p)), 'NQ 100 ticks: Rithmic message, no switch');
      // custom interval add / remove
      await p.evaluate(() => window.__stkIntervals.openCustom()); await sleep(200);
      await p.fill('.stk-iv-dlg:not(.quick) input', '7'); await p.selectOption('.stk-iv-dlg:not(.quick) select', 'min');
      await shot(p, 'iv2-custom-1440-dark.png');
      await p.click('.stk-iv-dlg:not(.quick) .ok'); await sleep(300);
      let st = await p.evaluate(() => ({ c: window.__stkIntervals.custom(), f: window.__stkIntervals.favs(), row: [...document.querySelectorAll('.stk-iv-row .stk-iv-b[data-iv]')].map((b) => b.dataset.iv) }));
      check(st.c.includes('7') && st.f.includes('7') && st.row.includes('7'), 'custom 7m added, starred, in the row: ' + st.row.join(' '));
      await p.evaluate(() => window.__stkIntervals.apply('7')); await bars(p); await sleep(1500);
      const r7 = await raw(p);
      const step7 = Math.min(...r7.slice(1).map((x, i) => x.t - r7[i].t).filter((d) => d > 0));
      check(r7.length > 20 && step7 === 7 * 60000, 'NQ 7m built: ' + r7.length + ' bars, step ' + step7 / 60000 + 'm');
      await p.evaluate(() => window.__stkIntervals.open()); await sleep(300);
      check(await p.evaluate(() => !!document.querySelector('.stk-iv-r[data-iv="7"] .stk-iv-x')), 'custom row in Minutes with a remove button');
      await shot(p, 'iv2-menu-custom-1440-dark.png');
      await p.click('.stk-iv-r[data-iv="7"] .stk-iv-x'); await sleep(300);
      st = await p.evaluate(() => ({ c: window.__stkIntervals.custom(), row: [...document.querySelectorAll('.stk-iv-row .stk-iv-b[data-iv]')].map((b) => b.dataset.iv) }));
      check(!st.c.includes('7'), 'custom 7m removed');
      await p.keyboard.press('Escape');
      // BTC seconds
      await p.evaluate(() => { window.STRYKER_VELA.active.setSymbol('binance:BTCUSDT'); }); await sleep(1500);
      for (const [id, n] of [['1S', 1], ['15S', 15]]) {
        await p.evaluate((id) => window.__stkIntervals.apply(id), id); await sleep(300);
        const nb = await bars(p);
        await sleep(3500);
        const r = await raw(p);
        const steps = r.slice(1).map((x, i) => x.t - r[i].t);
        const okStep = Math.min(...steps.filter((d) => d > 0)) === n * 1000;
        const aligned = r.every((x) => x.t % (n * 1000) === 0);
        const last = r[r.length - 1];
        check(nb > 50 && okStep && aligned && Date.now() - last.t < 120000, 'BTC ' + id + ': ' + r.length + ' bars, step ' + n + 's, aligned, newest ' + Math.round((Date.now() - last.t) / 1000) + 's old');
        if (id === '15S') await shot(p, 'iv2-btc15s-1440-dark.png');
      }
      // BTC 100 ticks
      await p.evaluate(() => window.__stkIntervals.apply('100T')); await sleep(300);
      const nt = await bars(p, 0, 60);
      await sleep(6000);
      const rt = await raw(p);
      const mono = rt.every((x, i) => i === 0 || x.t > rt[i - 1].t);
      const sane = rt.every((x) => x.h >= Math.max(x.o, x.c) && x.l <= Math.min(x.o, x.c));
      const note = await p.evaluate(() => (document.querySelector('.stk-iv-note') || {}).textContent || '');
      check(nt > 5 && mono && sane, 'BTC 100 ticks: ' + rt.length + ' bars from recent trades, times increasing, OHLC sane');
      check(/Built from recent trades|Building from now/.test(note), 'tick note shown: "' + note + '"');
      const before = rt.length;
      await sleep(8000);
      const after = (await raw(p)).length;
      check(after >= before, 'BTC 100 ticks keeps building live (' + before + ' -> ' + after + ')');
      await shot(p, 'iv2-btc100t-1440-dark.png');
      // guard: a futures cell left on seconds goes back to 1m (symbol switch)
      await p.evaluate(() => window.__stkIntervals.apply('15S')); await bars(p);
      await p.evaluate(() => window.STRYKER_VELA.active.setSymbol('futures:NQ1!')); await sleep(2500);
      check((await tf(p)) === '1' && /Showing 1 minute/.test(await toasts(p)), 'NQ on 15s (symbol switch) falls back to 1m with a message: ' + (await tf(p)));
      check((await bars(p)) > 0, 'NQ chart not blank after the fallback');
      check(errors.length === 0, 'no page errors (' + errors.slice(0, 3).join(' | ') + ')');
      await ctx.close();
    }
    // phone: custom dialog + typed box fit
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(stub);
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance\.com|data-api\.binance\.vision)/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkIntervals, null, { timeout: 45000 }); await bars(p);
    await p.evaluate(() => window.__stkIntervals.openCustom()); await sleep(300);
    const box = await p.evaluate(() => { const r = document.querySelector('.stk-iv-dlg:not(.quick)').getBoundingClientRect(); return { l: r.left, r: r.right, sw: document.documentElement.scrollWidth }; });
    check(box.l >= 0 && box.r <= 390 && box.sw <= 390, 'phone: custom dialog inside the screen');
    await shot(p, 'iv2-custom-390-dark.png');
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? 'FAILURES ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
