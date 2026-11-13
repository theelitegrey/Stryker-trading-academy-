// Charts: the "Fit price" / "Latest" pills (.stkc-fl) must not churn (DOM rebuild, style/class toggles) while live ticks arrive.
// Counts MutationObserver records on the pills (and re-creations in the pane host) over several seconds.
//   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-fit-latest-blink-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const WATCH_MS = Number(process.env.WATCH_MS || 10000);
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
async function run(b, { w, h, mobile, theme, sym, tag, shot, hover, fp }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  if (fp) await ctx.addInitScript(() => {   // fixture L2 hub: book snaps + ticks every 200 ms (as the live feed), admin on
    window.__L2MID = 28750; window.__stkL2Test = { base: 'http://127.0.0.1:9' }; window.__stkBookPackMin = 30;
    const Real = window.WebSocket;
    window.WebSocket = function (url, proto) {
      if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
      const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
      setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage({ data: JSON.stringify({ event: 'hub_attached', state: 'live', tier: 'book' }) }); ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) }); }, 50);
      let n = 0;
      ws.iv = setInterval(() => {
        if (ws.readyState !== 1 || !ws.onmessage) return; n++;
        const now = Date.now(), b = Math.floor(window.__L2MID * 4) / 4, bids = [], asks = [];
        for (let i = 0; i < 12; i++) { bids.push([b - i * 0.25, 10 + ((i * 7 + n) % 30)]); asks.push([b + 0.25 + i * 0.25, 10 + ((i * 5 + n) % 30)]); }
        ws.onmessage({ data: JSON.stringify({ type: 'snap', symbol: 'NQ', ts: now, bids, asks, imb: 0, imb10: 0 }) });
        ws.onmessage({ data: JSON.stringify({ type: 'ticks', symbol: 'NQ', t: [[b, 3, -1, now], [b + 0.25, 2, 1, now]].concat(n % 15 === 0 ? [[b + 0.25, 150, 1, now]] : []) }) });
      }, 200);
      return ws;
    };
    window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
  });
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance\.com|fapi\.binance\.com|data-api\.binance\.vision)/, (r) => r.abort());
  await require('./binance-mock.js').install(ctx);
  if (fp) {   // main's footprint (L2) needs a trade history to draw bars: 404 the rest of the fixture hub, serve 1 trade/s for the last 30 min
    await ctx.route(/127\.0\.0\.1:9\/(?!ts-trades)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
    await ctx.route(/127\.0\.0\.1:9\/ts-trades/, (r) => {
      const to = Date.now(), trades = [], delta = new Map();
      for (let t = Math.ceil((to - 1800000) / 1000) * 1000; t < to; t += 1000) { const k = t / 1000, side = Math.sin(k * 7.3) > -0.1 ? 1 : -1, px = Math.round((28750 + (side > 0 ? 0.25 : 0) + Math.sin(k) * 2) * 4) / 4, sz = 1 + (k % 6); trades.push([t, px, sz, side]); const m = Math.floor(t / 60000) * 60000, d = delta.get(m) || [m, 0, 0, 0, 0]; if (side > 0) d[1] += sz; else d[2] += sz; d[3] = Math.max(d[3], d[1] - d[2]); d[4] = Math.min(d[4], d[1] - d[2]); delta.set(m, d); }
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'x-ts-fill-left': '0', 'access-control-expose-headers': 'x-ts-fill-left' }, body: JSON.stringify({ sym: 'NQ', at: to, floor: 100, left: 0, trades, delta: [...delta.values()] }) });
    });
  }
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 45000 });
  await p.waitForTimeout(4000);
  await p.evaluate((s) => window.STRYKER_VELA.active.setSymbol(s), sym);
  await p.waitForTimeout(8000);
  if (fp) {   // GK's setup: Footprint (L2) + Big Trades (L2) on NQ with live-like fixture ticks, then settle
    await p.evaluate(() => { window.STRYKER_VELA.active.setTimeframe('1'); window.STRYKER_VELA.active.setPriceStyle('stk_fp'); });   // the Footprint chart type is what raises the pills (flag stk-fp-stats)
    await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; ['stk_l2f_fp', 'stk_l2f_big'].forEach((t) => c.addNativeIndicator(t, { inputs: t === 'stk_l2f_big' ? { mode: 'Manual', minSize: 100 } : {} })); window.STRYKER_VELA.context().stateChanged(); });
    await p.waitForTimeout(6000);
    if (w > 800) { await p.evaluate(() => window.STRYKER_VELA.active.setTimeframe('5')); await p.waitForTimeout(1500); await p.evaluate(() => window.STRYKER_VELA.active.setTimeframe('1')); await p.waitForTimeout(3000); }   // desktop: re-ask the bars once so the flow picks up the hub
    await p.waitForFunction(() => document.querySelector('.vela-cell.stk-fp-stats'), null, { timeout: 25000 }).catch(() => {});   // the fixture flow loads async; the flag shows once bars draw
  }
  if (hover) { await p.mouse.move(hover[0], hover[1]); await p.waitForTimeout(800); }   // cursor parked on the pane: opacity must stay put while ticks arrive
  const r = await p.evaluate((ms) => new Promise((res) => {
    const fl = document.querySelector('.stkc-fl');
    if (!fl) return res({ missing: true });
    const log = {};
    const bump = (k) => { log[k] = (log[k] || 0) + 1; };
    const mo = new MutationObserver((recs) => recs.forEach((m) => bump(m.type + ':' + (m.attributeName || '') + ':' + (m.target.className || m.target.nodeName))));
    mo.observe(fl, { attributes: true, childList: true, subtree: true, characterData: true });
    const mh = new MutationObserver((recs) => recs.forEach((m) => { [...m.addedNodes, ...m.removedNodes].forEach((n) => { if (n.classList && n.classList.contains('stkc-fl')) bump('host-rebuild'); }); }));
    mh.observe(fl.parentElement, { childList: true });
    // style changes that are not DOM mutations (CSS animation / transition loops)
    let trans = 0; const onT = () => trans++;
    fl.addEventListener('transitionstart', onT); fl.addEventListener('animationstart', onT);
    // computed look (rules can change it without touching the DOM): count changes of opacity/display/visibility/rect per frame
    const look = () => { const bs = fl.querySelectorAll('button'); const c = getComputedStyle(fl); const r = fl.getBoundingClientRect(); return [c.opacity, c.display, c.visibility, Math.round(r.left), Math.round(r.top), bs.length, ...[...bs].map((x) => getComputedStyle(x).opacity + getComputedStyle(x).borderColor)].join('|'); };
    // body class + the pills' computed style, sampled every frame (footprint ON: the body class must never be written)
    let bodyCls = 0; const mb = new MutationObserver((recs) => recs.forEach((m) => { if (m.attributeName === 'class') bodyCls++; })); mb.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    let prev = look(), looks = 0, raf = 0; const loop = () => { const n = look(); if (n !== prev) { looks++; prev = n; } raf = requestAnimationFrame(loop); }; loop();
    setTimeout(() => { cancelAnimationFrame(raf); bump('computed-look-changes:' + looks); if (!looks) delete log['computed-look-changes:0']; mo.disconnect(); mh.disconnect(); mb.disconnect(); if (bodyCls) bump('body-class-writes:' + bodyCls); res({ log, trans, total: Object.values(log).reduce((a, b) => a + b, 0), ticks: window.__tickCount || null }); }, ms);
  }), WATCH_MS);
  check(!r.missing, `${tag}: pills present`);
  if (!r.missing) check(r.total === 0 && r.trans === 0, `${tag}: ${r.total} mutations, ${r.trans} transitions in ${WATCH_MS / 1000}s ${JSON.stringify(r.log)}`);
  if (fp) {   // paint: the pills' own pixels, sampled once a second alongside; ticks repaint the chart beneath, the pills must stay equal
    const box = await p.evaluate(() => { const r = document.querySelector('.stkc-fl').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; });
    const shots = []; for (let i = 0; i < 6; i++) { shots.push((await p.screenshot({ clip: box })).toString('base64')); await p.waitForTimeout(1000); }
    const hot = await p.evaluate(() => !!document.querySelector('.vela-cell.stk-fp-stats'));
    check(hot, `${tag}: footprint flag on the pane cell`);
    console.log(`INFO ${tag}: pill pixels differ in ${new Set(shots).size}/${shots.length} samples (pills are translucent over a live footprint; class, computed look and position are asserted per frame above)`);
  }
  if (shot) await p.screenshot({ path: `${OUT}/blink-${shot}.png` });
  check(errors.length === 0, `${tag}: no page errors ${errors.slice(0, 2).join(' | ')}`);
  await ctx.close();
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    if (!process.env.FP_ONLY) await run(b, { w: 1440, h: 900, theme: 'dark', sym: 'binance:BTCUSDT', tag: 'desk crypto dark', shot: 'desk-dark' });
    if (!process.env.FP_ONLY) await run(b, { w: 1440, h: 900, theme: 'dark', sym: 'futures:NQ1!', tag: 'desk NQ1! dark', hover: [600, 400] });
    if (!process.env.FP_ONLY) await run(b, { w: 1440, h: 900, theme: 'light', sym: 'binance:BTCUSDT', tag: 'desk crypto light', hover: [1200, 793], shot: 'desk-light' });
    await run(b, { w: 1440, h: 900, theme: 'dark', sym: 'futures:NQ1!', tag: 'desk footprint+bigtrades dark', fp: true, shot: 'desk-fp' });
    await run(b, { w: 390, h: 844, mobile: true, theme: 'dark', sym: 'futures:NQ1!', tag: 'phone footprint+bigtrades dark', fp: true, shot: 'phone-fp' });
    if (!process.env.FP_ONLY) await run(b, { w: 390, h: 844, mobile: true, theme: 'dark', sym: 'binance:BTCUSDT', tag: 'phone crypto dark', shot: 'phone-dark' });
  } finally { await b.close(); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
