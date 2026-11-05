// TICK ENGINE history on seconds + tick charts (Owner bug 2026-11-05: "on ticks and seconds, old candles not showing").
// FIXTURE hub (tools/tests/tick-engine-hub.py: 8 h tape, "live record" from 1 h ago, a seconds read older than that answers `more` the
// first time = the Worker's budgeted archive fill). No Worker, no key, no provider.
//   python3 tools/tests/tick-engine-hub.py 8077 &  node tools/tests/chart-dev-server.mjs 8055 &
//   CHART_BASE=http://127.0.0.1:8055 TE_HUB=http://127.0.0.1:8077 node tools/tests/tick-engine-history-browser.js <shotsDir>
// NQ 1S 5S 15S 100T 500T: >= 300 bars on first load; dragging the chart back loads older bars (the normal scroll-back path); bars
// strictly ascending, seconds have no holes, every closed bar = the hub's tape; after a reload the same bars. Shots at 390 + 1440.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8055', HUB = process.env.TE_HUB || 'http://127.0.0.1:8077', OUT = process.argv[2] || '/tmp/te-hist';
fs.mkdirSync(OUT, { recursive: true });
const V = JSON.parse(fs.readFileSync(__dirname + '/../../assets/version.json', 'utf8')).build;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
const hub = (p) => fetch(HUB + p).then((r) => r.json());

async function setTf(p, tf) {
  return p.evaluate(async ([v, tf]) => {
    (await import('/assets/rt-access.js?v=' + v))._rtSetForTests(true, 'test-token');
    const ws = window.STRYKER_VELA, c = ws.cell(ws.active.id);
    if (c.symbol !== 'futures:NQ1!') c.setSymbol('futures:NQ1!');
    c.setTimeframe(tf);
    const t0 = Date.now();
    while (Date.now() - t0 < 40000) {
      const o = c.chart.orchestrator;
      if (String(o.config.market.timeframe) === tf && o.config.market.symbol === 'futures:NQ1!' && o.rawBars.length > 50 && o.historyCompleted && !o.switchingMarket) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 1500));
    return c.chart.orchestrator.rawBars.length;
  }, [V, tf]);
}
const bars = (p) => p.evaluate(() => { const ws = window.STRYKER_VELA, c = ws.cell(ws.active.id); return c.chart.orchestrator.rawBars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume]); });
const rect = (p) => p.evaluate(() => { const ws = window.STRYKER_VELA, c = ws.cell(ws.active.id), R = c.chart.renderer.renderer; const r = R.wrapper.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
async function dragBack(p, times) {
  const r = await rect(p), y = r.y + r.h * 0.45, x0 = r.x + r.w * 0.2;
  for (let i = 0; i < times; i++) {
    await p.mouse.move(x0, y); await p.mouse.down();
    for (let k = 1; k <= 10; k++) { await p.mouse.move(x0 + (r.w * 0.6 * k) / 10, y); await sleep(16); }
    await sleep(150); await p.mouse.up(); await sleep(350);
  }
}
// closed bars of the page vs the hub (the forming bar and the bar before it may still move)
async function compare(p, tf, tag) {
  const got = await bars(p), now = Date.now();
  let ordered = true; for (let i = 1; i < got.length; i++) if (!(got[i][0] > got[i - 1][0])) ordered = false;
  check(ordered, tag + ': times strictly ascending (' + got.length + ' bars)');
  const g = got.slice(0, -2);
  let ref;
  if (/T$/.test(tf)) ref = (await hub('/te-bars?sym=NQ&tf=' + tf + '&limit=5000&to=' + (now + 60000))).b;
  else {
    const q = '/te-bars?sym=NQ&tf=' + tf + '&from=' + (g[0][0] - 60000) + '&to=' + (g[g.length - 1][0] + Number(tf.slice(0, -1)) * 1000);
    let r = await hub(q); if (r.more) r = await hub(q);   // the fixture's archive emulation answers `more` once per range
    ref = r.b;
    const ms = Number(tf.slice(0, -1)) * 1000; let gaps = 0; for (let i = 1; i < g.length; i++) if (g[i][0] - g[i - 1][0] !== ms) gaps++;
    check(gaps === 0, tag + ': no holes (the fixture tape trades every second)', gaps);
  }
  const by = new Map(ref.map((b) => [b[0], b.slice(0, 6)]));
  const diff = g.filter((b) => JSON.stringify(by.get(b[0])) !== JSON.stringify(b));
  check(diff.length === 0, tag + ': every closed bar = the hub tape (OHLCV)', diff.slice(0, 3).map((d) => [d, by.get(d[0])]));
  return got;
}

(async () => {
  const b = await launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((h) => { window.__STK_BOOK_RECORDER = h; try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', 'night'); } catch (e) {} }, HUB);
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage(), errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(BASE + '/charts.html?engine=1', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkHistoryPager, null, { timeout: 60000 });
    const firsts = {};
    for (const tf of ['1S', '5S', '15S', '100T', '500T']) {
      const n0 = await setTf(p, tf);
      check(n0 >= 300, tf + ': first load ' + n0 + ' bars (>= 300)');
      const a = await compare(p, tf, tf + ' first load');
      firsts[tf] = a;
      await dragBack(p, 6); await sleep(2500);
      const c = await compare(p, tf, tf + ' after scroll-back');
      const all = /T$/.test(tf) ? (await hub('/te-bars?sym=NQ&tf=' + tf + '&limit=5000&to=' + (Date.now() + 60000))).b : null;
      if (all && all.length <= a.length + 2) check(a[0][0] === all[0][0], tf + ': the first load already holds the whole fixture tape (' + all.length + ' bars, nothing older to page)');
      else check(c.length > a.length && c[0][0] < a[0][0], tf + ': scroll-back loaded older bars (' + a.length + ' -> ' + c.length + ', oldest ' + new Date(a[0][0]).toISOString().slice(11, 19) + ' -> ' + new Date(c[0][0]).toISOString().slice(11, 19) + ')', [a.length, c.length]);
      if (tf === '15S' || tf === '500T') { await p.screenshot({ path: OUT + '/te-hist-' + tf + '-1440.png' }); }
    }
    // reload: the same bars (tick bars counted from the session open, seconds from the record)
    for (const tf of ['5S', '100T']) {
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
      await setTf(p, tf);
      const g = await bars(p), f = firsts[tf], by = new Map(f.slice(0, -2).map((x) => [x[0], JSON.stringify(x)]));
      const common = g.slice(0, -2).filter((x) => by.has(x[0]));
      const same = common.every((x) => by.get(x[0]) === JSON.stringify(x));
      check(common.length >= 200 && same, tf + ': after a reload the same bars (' + common.length + ' compared)', common.length);
    }
    await p.setViewportSize({ width: 390, height: 844 }); await sleep(1500);
    await p.screenshot({ path: OUT + '/te-hist-100T-390.png' });
    check(errors.length === 0, 'no page errors', errors.slice(0, 3));
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
