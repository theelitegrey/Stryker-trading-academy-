// Charts data-status dot test (assets/chart-data-dot.js) against tools/tests/chart-dev-server.mjs.
// Needs network (jsDelivr for Pine + Yahoo + Binance). Run while CME Globex is open for the
// amber case; the closed case uses a fixed fake clock (Saturday).
//   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-datadot-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

async function open(b, { w, h, mobile, theme, fixedTime }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 3 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  if (fixedTime) await p.clock.setFixedTime(new Date(fixedTime));
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|^WebSocket connection to/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_DATA_DOT, null, { timeout: 40000 });
  await p.waitForTimeout(3000);
  return { ctx, p, errors };
}
const dots = (p) => p.evaluate(() => [...document.querySelectorAll('#vela-chart .vela-cell[data-cell-id]')].map((c) => {
  const d = c.querySelector('.stkc-dd');
  const sym = c.querySelector('.vela-sl-symbol');
  const meta = c.querySelector('.vela-sl-meta');
  const mk = c.querySelector('.vela-sl-market');
  const i = d && d.querySelector('.stkc-dd-dot');
  const r = d && d.getBoundingClientRect();
  const sl = c.querySelector('.vela-statusline').getBoundingClientRect();
  const cs = i && getComputedStyle(i);
  return { cell: c.getAttribute('data-cell-id'), sym: sym && sym.textContent, s: d && d.dataset.s, tip: d && d.dataset.tip, tag: d && d.querySelector('.stkc-dd-t').textContent,
    after: !!(d && d.previousElementSibling === meta), color: cs && cs.backgroundColor, dw: cs && cs.width, ring: cs && cs.boxShadow,
    vis: !!(r && r.width && r.height && r.right <= sl.right + 1 && r.top >= sl.top - 1 && r.bottom <= sl.bottom + 1), oneRow: sl.height <= 30,
    velaBadge: !!(mk && mk.getClientRects().length) };
}));
async function waitLag(p) {
  await p.waitForFunction(() => [...document.querySelectorAll('.stkc-dd[data-s="delayed"]')].every((d) => /about \d+ min/.test(d.dataset.tip || '')), null, { timeout: 20000 }).catch(() => {});
}
async function setSyms(p, layout, syms) {
  await p.evaluate(async ([layout, syms]) => {
    window.STRYKER_CHART_UI.setLayout(layout);
    await new Promise((r) => setTimeout(r, 500));
    const ws = window.STRYKER_VELA;
    ws.context().cells.forEach((c, i) => { if (syms[i]) ws.cell(c.id).setSymbol(syms[i]); });
  }, [layout, syms]);
  await p.waitForTimeout(5000);
}

(async () => {
  const b = await launch();
  const AMBER = 'rgb(245, 166, 35)', GREEN = 'rgb(8, 153, 129)', GREY = 'rgb(120, 123, 134)';

  for (const theme of ['dark', 'day']) {
    // ---- desktop 1440: NQ amber, BTC green, 2x2 mix ----
    let { ctx, p, errors } = await open(b, { w: 1440, h: 900, theme });
    await setSyms(p, '1', ['futures:NQ1!']);
    await waitLag(p);
    let d = await dots(p);
    check(d.length === 1 && d[0].s === 'delayed' && d[0].color === AMBER && d[0].after && d[0].dw === '10px' && /2px/.test(d[0].ring) && /^Delayed \d+m$/.test(d[0].tag) && d[0].vis && !d[0].velaBadge, `${theme} 1440 NQ amber dot after symbol ${JSON.stringify(d)}`);
    check(/^Delayed data · about \d+ min$/.test(d[0].tip), `${theme} NQ tooltip "${d[0].tip}"`);
    await p.hover('.stkc-dd');
    await p.waitForTimeout(300);
    const tip = await p.evaluate(() => { const t = document.getElementById('stkc-dd-tip'); return { vis: !t.hidden, txt: t.textContent }; });
    check(tip.vis && /Delayed data/.test(tip.txt), `${theme} hover shows tooltip "${tip.txt}"`);
    await p.screenshot({ path: `${OUT}/dd-${theme}-1440-nq.png` });
    await p.mouse.move(700, 500);

    await setSyms(p, '1', ['binance:BTCUSDT']);
    d = await dots(p);
    check(d[0].s === 'rt' && d[0].color === GREEN && d[0].tip === 'Real-time data' && d[0].tag === 'Real-time' && d[0].vis, `${theme} BTC green ${JSON.stringify(d[0])}`);
    await p.hover('.stkc-dd'); await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/dd-${theme}-1440-btc.png` });
    await p.mouse.move(700, 500);

    await setSyms(p, '4', ['futures:NQ1!', 'binance:BTCUSDT', 'futures:ES1!', 'coinbase:ETH-USD']);
    await waitLag(p);
    d = await dots(p);
    check(d.length === 4 && d.map((x) => x.s).join(',') === 'delayed,rt,delayed,rt' && d.every((x) => x.after && x.vis && x.oneRow && !x.velaBadge && /^(Real-time|Delayed \d+m)$/.test(x.tag)), `${theme} 2x2 mix ${JSON.stringify(d.map((x) => [x.sym, x.s, x.tip]))}`);
    await p.screenshot({ path: `${OUT}/dd-${theme}-1440-2x2.png` });
    // Layout / shared-link path: chart-layouts.js loads both through ui.applySaved -> ws.applyState.
    const saved = await p.evaluate(() => JSON.stringify(window.STRYKER_VELA.getState()));
    await setSyms(p, '1', ['futures:GC1!']);
    await p.evaluate((s) => window.STRYKER_CHART_UI.applySaved({ state: s }), saved);
    await p.waitForTimeout(5000);
    d = await dots(p);
    check(d.length === 4 && d.every((x) => x.s && x.after && x.vis), `${theme} after applySaved (layout/shared link) 4 dots ${JSON.stringify(d.map((x) => [x.sym, x.s, x.tag]))}`);
    // Pine still works
    if (theme === 'dark') {
      const pine = await p.evaluate(() => !!document.querySelector('#stkc-bar-l') && [...document.querySelectorAll('#stkc-bar-l .stkc-btn')].map((x) => x.textContent.trim()));
      check(Array.isArray(pine) && pine.some((t) => /Pine/.test(t)) && pine.some((t) => /Templates/.test(t)), `toolbar keeps Pine + Templates ${JSON.stringify(pine)}`);
      // template round trip: starter quad keeps 4 dots
      await p.evaluate(() => { const U = window.STRYKER_CHART_UI; U.applyStarter(U.STARTERS.find((x) => x.id === 'starter:quad')); });
      await p.waitForTimeout(5000);
      d = await dots(p);
      check(d.length === 4 && d.every((x) => x.s === 'delayed' && x.vis), `starter quad -> 4 amber dots ${JSON.stringify(d.map((x) => [x.sym, x.s]))}`);
    }
    await setSyms(p, '1', ['futures:NQ1!']);
    const foot = await p.evaluate(() => document.querySelector('.stkchart-credit').textContent);
    check(!/20 seconds/.test(foot) && /Education only\. Not financial advice\./.test(foot), `${theme} footer "${foot}"`);
    check(!errors.length, `${theme} 1440 console errors: ${errors.slice(0, 3).join(' | ') || 'none'}`);
    await ctx.close();

    // ---- phone 390: tap popover ----
    ({ ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true, theme }));
    await setSyms(p, '1', ['futures:NQ1!']);
    await waitLag(p);
    d = await dots(p);
    check(d[0].s === 'delayed' && d[0].vis && /^Delayed \d+m$/.test(d[0].tag), `${theme} 390 NQ amber + tag ${JSON.stringify(d[0])}`);
    await p.tap('.stkc-dd');
    await p.waitForTimeout(300);
    const pt = await p.evaluate(() => { const t = document.getElementById('stkc-dd-tip'); const r = t.getBoundingClientRect(); return { vis: !t.hidden, txt: t.textContent, l: r.left, r: r.right, sh: t.scrollHeight, ch: t.clientHeight, sw: document.documentElement.scrollWidth }; });
    check(pt.vis && pt.l >= 0 && pt.r <= 390 && pt.sh <= pt.ch + 1 && pt.sw <= 391, `${theme} 390 tap popover in view, no scroll ${JSON.stringify(pt)}`);
    await p.screenshot({ path: `${OUT}/dd-${theme}-390-nq-tap.png` });
    await p.tap('.stkc-dd');
    await p.waitForTimeout(200);
    check(await p.evaluate(() => document.getElementById('stkc-dd-tip').hidden), `${theme} 390 second tap closes popover`);
    await setSyms(p, '1', ['binance:BTCUSDT']);
    await p.tap('.stkc-dd'); await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/dd-${theme}-390-btc-tap.png` });
    check(!errors.length, `${theme} 390 console errors: ${errors.slice(0, 3).join(' | ') || 'none'}`);
    await ctx.close();
  }

  // ---- closed: fixed fake clock on Saturday 2026-10-10 12:00 UTC ----
  for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
    const { ctx, p } = await open(b, { w, h, mobile, theme: 'dark', fixedTime: '2026-10-10T12:00:00Z' });
    await setSyms(p, '1', ['futures:NQ1!']);
    const d = await dots(p);
    check(d[0].s === 'closed' && d[0].color === GREY && /^Market closed · opens Mon 03:30 IST$/.test(d[0].tip) && d[0].tag === 'Closed' && d[0].vis, `${w} closed (Sat) grey ${JSON.stringify(d[0])}`);
    if (mobile) await p.tap('.stkc-dd'); else await p.hover('.stkc-dd');
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/dd-dark-${w}-nq-closed.png` });
    await ctx.close();
  }
  // pure clock checks (daily break, Friday close, Sunday open)
  const { ctx, p } = await open(b, { w: 1440, h: 900, theme: 'dark' });
  const clk = await p.evaluate(() => { const D = window.STRYKER_DATA_DOT; const t = (s) => D.globexOpen(Date.parse(s));
    return { brk: t('2026-10-06T21:30:00Z'), wk: t('2026-10-06T15:00:00Z'), friLate: t('2026-10-09T21:30:00Z'), sunOpen: t('2026-10-11T22:30:00Z'), sunEarly: t('2026-10-11T21:30:00Z'),
      next: new Date(D.nextOpen(Date.parse('2026-10-10T12:00:00Z'))).toISOString() }; });
  check(!clk.brk && clk.wk && !clk.friLate && clk.sunOpen && !clk.sunEarly && clk.next === '2026-10-11T22:00:00.000Z', `globex clock ${JSON.stringify(clk)}`);
  await ctx.close();
  await b.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
