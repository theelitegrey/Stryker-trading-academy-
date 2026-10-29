// Delayed-futures pill + "Get live futures data" sheet (Owner 2026-10-30, second pass: the old strip under the
// toolbar was "too provoking"). Against chart-dev-server.mjs.
//   CHART_BASE=http://127.0.0.1:8093 node tools/tests/t6-banner-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8093';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

async function run(b, { who, w, h, mobile, sym, vela, shot, layout, syms, hiddenDay }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([who, sym, hiddenDay]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      if (hiddenDay) localStorage.setItem('stryker_data_pill_hidden_ist', hiddenDay);
      if (sym) localStorage.setItem('vela-workspace', JSON.stringify({ layout: '1', cells: { A: { symbol: sym, timeframe: '15' } }, symbol: sym, timeframe: '15' })); } catch (e) {}
    if (who !== 'signed-out') {
      const user = { uid: 'u-' + who, getIdToken: () => Promise.resolve('dummy.' + who + '.token') };
      firebase.apps = [{}];
      const a = firebase.auth(); a.currentUser = user; a.onIdTokenChanged = (cb) => { setTimeout(() => cb(user), 20); return () => {}; };
    }
  }, [who, sym, hiddenDay || '']);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  await ctx.route('**/api/chart/rt', (r) => r.fulfill({ json: { admin: /Bearer dummy\.(admin|addon)\./.test(r.request().headers().authorization || '') }, headers: { 'cache-control': 'no-store' } }));
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html' + (vela ? '?vela=0.6' : ''), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_DATA_BANNER, null, { timeout: 45000 });
  if (sym) await p.evaluate(async (sy) => { const c = window.STRYKER_VELA.context().cells[0]; await c.chart.setMarket({ symbol: sy }); }, sym);
  if (layout) {
    await p.evaluate(async ([layout, syms]) => {
      window.STRYKER_CHART_UI.setLayout(layout);
      await new Promise((r) => setTimeout(r, 600));
      const ws = window.STRYKER_VELA;
      ws.context().cells.forEach((c, i) => { if (syms[i]) ws.cell(c.id).setSymbol(syms[i]); });
    }, [layout, syms]);
  }
  await p.waitForTimeout(7000);
  const info = await geo(p);
  if (shot) await p.screenshot({ path: `${OUT}/${shot}.png` });
  return { ctx, p, info };
}
// Pill state + geometry vs the active pane's plot, price axis, time axis and legend.
function geo(p) {
  return p.evaluate(() => {
    const pill = document.getElementById('stkdp');
    const cap = pill && pill.querySelector('.stkdp-cap');
    const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const ws = window.STRYKER_VELA; const a = ws.active; const rr = a.chart.renderer.renderer;
    const cv = R(rr.input.el); const plotR = cv.l + rr.coords.width;
    const cellEl = document.querySelector('#vela-chart .vela-cell[data-cell-id="' + a.id + '"]');
    const legend = R(cellEl && cellEl.querySelector('.vela-statusline'));
    const pr = R(pill), cr = R(cap);
    const ov = (x, y) => !!(x && y && x.l < y.r && x.r > y.l && x.t < y.b && x.b > y.t);
    const n = document.querySelectorAll('.stkdp').length;
    const visiblePills = [...document.querySelectorAll('.stkdp')].filter((e) => !e.hidden).length;
    return { sym: a.symbol, cells: ws.context().cells.length, hidden: pill.hidden, n, visiblePills,
      text: cap ? cap.innerText.replace(/\s+/g, ' ').trim() : '', capH: cr && Math.round(cr.h), hitH: pr && Math.round(pr.h),
      inPlotX: !!(cr && cr.l >= cv.l && cr.r <= plotR), aboveTimeAxis: !!(cr && cr.b <= cv.b - 20), lowerHalf: !!(cr && cr.t > cv.t + cv.h / 2),
      overLegend: ov(cr, legend), overStrip: !!document.getElementById('stkdb'),
      cellTop: cellEl && Math.round(R(cellEl).t), panelTop: Math.round(R(document.querySelector('.stkchart-panel')).t),
      vw: innerWidth, sw: document.documentElement.scrollWidth, bg: cap && getComputedStyle(cap).backgroundColor,
      cap: cr && [Math.round(cr.l), Math.round(cr.t), Math.round(cr.w)], plot: [Math.round(cv.l), Math.round(cv.t), Math.round(rr.coords.width), Math.round(cv.h)] };
  });
}
const sheetState = (p) => p.evaluate(() => { const s = document.getElementById('stkdp-sheet'); const r = s.getBoundingClientRect();
  return { open: !s.hidden, cls: s.className, t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), w: Math.round(r.width), text: s.innerText,
    buy: document.getElementById('stkdp-buy').getAttribute('href'), why: document.getElementById('stkdp-why').getAttribute('href') }; });

(async () => {
  const b = await launch();
  const sizes = [[390, 844, true], [412, 915, true], [1440, 900, false]];
  for (const [w, h, mobile] of sizes) {
    for (const vela of (w === 412 ? [false] : [false, true])) {
      const tag = `${w}${vela ? '-v06' : ''}`;
      let r = await run(b, { who: 'signed-out', w, h, mobile, vela });
      check(/BTCUSDT/i.test(r.info.sym) && r.info.hidden, `${tag} fresh visitor opens BTC, no pill (${r.info.sym})`); await r.ctx.close();

      r = await run(b, { who: 'signed-out', w, h, mobile, vela, sym: 'futures:NQ1!', shot: vela ? null : `pill-${w}` });
      const i = r.info;
      check(!i.hidden && i.n === 1, `${tag} NQ signed out: one pill visible`);
      check(w >= 768 ? i.text === 'Futures delayed 10 min' : i.text === 'Delayed 10 min', `${tag} pill text "${i.text}"`);
      check(i.capH === 32 && i.hitH >= 44, `${tag} capsule ${i.capH}px, hit target ${i.hitH}px`);
      check(i.inPlotX && i.aboveTimeAxis && i.lowerHalf, `${tag} pill in the lower plot, off the price + time axis ${JSON.stringify({ cap: i.cap, plot: i.plot })}`);
      check(!i.overLegend, `${tag} pill does not cover the legend`);
      check(!i.overStrip && Math.abs(i.cellTop - i.panelTop) <= 2, `${tag} old top strip gone, chart starts at the panel top (${i.cellTop} vs ${i.panelTop})`);
      check(/rgba\(22, 23, 27, 0\.72\)/.test(i.bg), `${tag} translucent capsule ${i.bg}`);
      check(i.sw <= i.vw + 1, `${tag} no horizontal overflow`);

      if (!vela) {
        await r.p.click('#stkdp'); await r.p.waitForTimeout(450);
        const s = await sheetState(r.p);
        check(s.open && /Get live futures data/.test(s.text) && /CME futures are 10 minutes delayed on free data\./.test(s.text)
          && /Connect your prop firm/.test(s.text) && /Use your own Rithmic login\. Free\./.test(s.text)
          && /Live data add-on/.test(s.text) && /\$5 a month\. Cancel anytime\./.test(s.text) && /Why is it delayed\?/.test(s.text) && /Hide for today/.test(s.text),
          `${tag} tap opens the sheet with both rows`);
        check(/LiveData/.test(s.buy) && /help\.html#free-data-delay/.test(s.why), `${tag} row b -> checkout, footer -> help answer`);
        if (mobile) check(/phone/.test(s.cls) && Math.abs(s.b - h) <= 1 && s.l === 0 && s.w === w, `${tag} bottom sheet docked to the bottom ${JSON.stringify({ b: s.b, l: s.l, w: s.w })}`);
        else check(/pop/.test(s.cls) && s.b <= (await r.p.evaluate(() => document.getElementById('stkdp').getBoundingClientRect().top)) + 1 && s.w <= 360, `${tag} desktop popover above the pill`);
        await r.p.screenshot({ path: `${OUT}/sheet-${w}.png` });
        // Row b: the add-on is on sale (plans/LiveData exists) -> the add-on checkout. The rich stub has no LiveData plan,
        // so first check the "opens today" toast path, then add the plan doc and check the checkout path.
        await r.p.click('#stkdp-buy'); await r.p.waitForTimeout(600);
        check(/charts\.html/.test(r.p.url()) && (await r.p.evaluate(() => /opens today/.test(document.body.innerText))), `${tag} row b before plans/LiveData exists: toast, no dead checkout`);
        await r.p.evaluate(() => { const col = window.db.collection.bind(window.db); window.db.collection = (n) => n === 'plans'
          ? { doc: (id) => (id === 'LiveData' ? { get: () => Promise.resolve({ exists: true, data: () => ({ name: 'Live futures data', addon: true }) }) } : col(n).doc(id)) } : col(n); });
        await r.p.click('#stkdp'); await r.p.waitForTimeout(400);
        await Promise.all([r.p.waitForURL(/checkout\.html\?plan=LiveData/, { timeout: 8000 }).catch(() => {}), r.p.click('#stkdp-buy')]);
        check(/checkout\.html\?plan=LiveData/.test(r.p.url()), `${tag} row b opens the add-on checkout (${r.p.url().replace(BASE, '')})`);
      }
      await r.ctx.close();

      r = await run(b, { who: 'addon', w, h, mobile, vela, sym: 'futures:NQ1!' });
      check(r.info.hidden, `${tag} live member (add-on/approved/admin): no pill`); await r.ctx.close();
      r = await run(b, { who: 'free', w, h, mobile, vela, sym: 'binance:BTCUSDT', shot: vela ? null : `btc-${w}` });
      check(r.info.hidden, `${tag} crypto: no pill`); await r.ctx.close();
    }
  }

  // Row a (signed in): closes this sheet and opens the Rithmic sheet. Data dot opens the sheet. Hide for today.
  for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
    const r = await run(b, { who: 'free', w, h, mobile, sym: 'futures:NQ1!' });
    await r.p.evaluate(() => { window.__opened = 0; window.STRYKER_RITHMIC = window.STRYKER_RITHMIC || {}; window.STRYKER_RITHMIC.open = () => { window.__opened++; }; });
    await r.p.click('#stkdp'); await r.p.waitForTimeout(400);
    await r.p.click('#stkdp-connect'); await r.p.waitForTimeout(600);
    check(await r.p.evaluate(() => window.__opened) >= 1 && !(await sheetState(r.p)).open, `${w} row a closes the sheet and opens the Rithmic sheet`);
    await r.p.evaluate(() => { const d = document.querySelector('.stkc-dd[data-s="delayed"]'); if (d) d.click(); });
    await r.p.waitForTimeout(400);
    check((await sheetState(r.p)).open, `${w} tapping the amber data dot opens the same sheet`);
    await r.p.click('#stkdp-hide'); await r.p.waitForTimeout(400);
    const after = await r.p.evaluate(() => ({ hidden: document.getElementById('stkdp').hidden, ls: localStorage.getItem('stryker_data_pill_hidden_ist'),
      ist: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()), open: !document.getElementById('stkdp-sheet').hidden }));
    check(after.hidden && !after.open && after.ls === after.ist, `${w} Hide for today hides the pill, stored IST day ${after.ls}`);
    await r.ctx.close();
  }
  let r = await run(b, { who: 'free', w: 390, h: 844, mobile: true, sym: 'futures:NQ1!', hiddenDay: '2020-01-01' });
  check(!r.info.hidden, 'a hide from an earlier IST day has expired: pill back'); await r.ctx.close();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  r = await run(b, { who: 'free', w: 390, h: 844, mobile: true, sym: 'futures:NQ1!', hiddenDay: today });
  check(r.info.hidden, 'hidden today: stays hidden after a reload'); await r.ctx.close();
  r = await run(b, { who: 'free', w: 1440, h: 900, sym: 'futures:NQ1!' });
  const bx = await r.p.evaluate(() => { const c = document.querySelector('#stkdp .stkdp-cap').getBoundingClientRect(); return [c.left + c.width / 2, c.top + c.height / 2]; });
  await r.p.mouse.move(bx[0], bx[1]); await r.p.mouse.down(); await r.p.waitForTimeout(700); await r.p.mouse.up(); await r.p.waitForTimeout(300);
  const lp = await r.p.evaluate(() => ({ hidden: document.getElementById('stkdp').hidden, open: !document.getElementById('stkdp-sheet').hidden }));
  check(lp.hidden && !lp.open, 'long-press hides the pill for today (no sheet)'); await r.ctx.close();

  // 2x2: one pill for the whole layout if any pane is delayed; none if every pane is crypto.
  for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
    r = await run(b, { who: 'free', w, h, mobile, sym: 'futures:NQ1!', layout: '4', syms: ['binance:BTCUSDT', 'futures:NQ1!', 'futures:ES1!', 'coinbase:ETH-USD'], shot: `grid-${w}` });
    check(r.info.cells === 4 && r.info.n === 1 && r.info.visiblePills === 1, `${w} 2x2 with futures: exactly one pill (${r.info.cells} panes)`);
    check(r.info.inPlotX && r.info.aboveTimeAxis, `${w} 2x2 pill at the bottom of the active pane ${JSON.stringify({ cap: r.info.cap, plot: r.info.plot })}`);
    await r.p.evaluate(() => { const ws = window.STRYKER_VELA; const s = ['binance:BTCUSDT', 'binance:ETHUSDT', 'coinbase:BTC-USD', 'coinbase:ETH-USD']; ws.context().cells.forEach((c, i) => ws.cell(c.id).setSymbol(s[i])); });
    await r.p.waitForTimeout(3500);
    check(await r.p.evaluate(() => document.getElementById('stkdp').hidden), `${w} 2x2 all crypto: no pill`);
    await r.ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
