// Badge placement + no false lock. node tools/tests/chart-dev-server.mjs 8011; CHART_BASE=http://127.0.0.1:8011 node tools/tests/chart-feeds-place-browser.js <shotsDir>
// admin test flag with trades:true = liveVisible() true while bookTier stays null (Pro, hub silent): must NOT show a lock.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8011', OUT = process.argv[2] || '/tmp/w1shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (ok, m, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + m + (ok ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const cases = [['none', [], 'pro'], ['delta', ['stk_ts_dsuite'], 'pro'], ['heat', ['stk_fut_dom'], 'pro'], ['big', ['stk_ts_big'], 'pro'], ['free', [], 'free']];
    const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null, WS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : null;   // quick runs: ONLY=delta,free WIDTHS=412,1440
    for (const [w, h, mobile] of [[390, 844, true], [412, 915, true], [1440, 900, false]]) for (const theme of ['dark', 'light']) for (const [name, types, plan] of cases) {
      if ((ONLY && !ONLY.includes(name)) || (WS && !WS.includes(w))) continue;
      const tag = name + '-' + w + '-' + theme;
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(([plan, t]) => { if (plan === 'pro') window.__stkL2Test = { base: 'http://127.0.0.1:9', trades: true }; window.__stkChartTestFree = plan === 'free';
        try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, [plan, theme]);
      await ctx.addInitScript(() => { window.__canvasTxt = []; const f = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t) { if (/part of Pro|Needs L[12]/i.test(String(t))) window.__canvasTxt.push(String(t)); return f.apply(this, arguments); }; });   // any lock text drawn on a canvas
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
      await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
      const p = await ctx.newPage();
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
      await sleep(1500);
      await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:MNQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 300)); if (ws.chart.market.symbol === 'futures:MNQ1!' && ws.chart.orchestrator.rawBars.length > 20) break; } });
      for (const t of types) await p.evaluate((t) => { window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator(t, { inputs: {} }); window.STRYKER_VELA.context().stateChanged(); }, t);
      if (plan === 'free') await p.evaluate(() => window.STRYKER_FEEDS.setPanel('t_l2', true, { needs: 'L2', title: 'Order book heatmap (L2)', mkt: 'futures' }));   // Free: the gate strips real L2 tools, so fake one panel
      await sleep(3500);
      const r = await p.evaluate(() => {
        const q = (s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.offsetWidth) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
        const row = q('#stkfeeds'), note = q('#stkfeed-note');
        const others = ['.stkdp', '#stkdp', '.vela-statusline', '.vela-ind-fold', '.vela-fab', '[class*="fab"]', '[class*="gex"]'].map((s) => [s, [...document.querySelectorAll(s)].filter((e) => e.offsetWidth && !e.closest('#stkfeeds,#stkfeed-note,#stkfeed-sheet')).map((e) => e.getBoundingClientRect())]);
        const hit = [];
        for (const box of [row, note]) if (box) for (const [s, rs] of others) for (const o of rs) if (o.width < 400 && o.left < box[2] && o.right > box[0] && o.top < box[3] && o.bottom > box[1]) hit.push(s);
        return { row, note, chips: [...document.querySelectorAll('.stkfeed')].map((x) => x.dataset.l + ':' + x.className.replace('stkfeed ', '')), noteText: (document.getElementById('stkfeed-note') || {}).textContent, hit, vw: innerWidth, canvasTxt: window.__canvasTxt.slice() };
      });
      console.log('INFO ' + tag, JSON.stringify(r));
      if (name !== 'none') check(!!r.row && r.row[0] >= 0 && r.row[2] <= r.vw && r.row[1] < 300, tag + ': chip row visible, top-left', r);
      if (name === 'none') check(!r.row, tag + ': no chips when nothing uses a feed', r);
      check(!r.canvasTxt.length, tag + ': no lock text drawn on the canvas (all plans)', r.canvasTxt);
      check(!r.hit.length, tag + ': chips/note overlap nothing', r.hit);
      if (plan === 'pro') check(!r.note && !r.chips.some((c) => /locked/.test(c)), tag + ': Pro, tier unknown: no lock', r);
      if (name === 'delta' || name === 'big') check(r.chips.some((c) => c.startsWith('L1:is-lit')) && r.chips.some((c) => c.startsWith('L2:is-dim')), tag + ': L1 lit, L2 dim', r.chips);
      if (name === 'free') check(r.chips.some((c) => /locked/.test(c)) && /Needs L2/.test(r.noteText || '') && r.note && (r.note[3] - r.note[1] < 100 || w > 700), tag + ': Free: locked chip + short note', r);
      if (theme === 'dark' || w === 412) await p.screenshot({ path: OUT + '/place-' + tag + '.png' });
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
