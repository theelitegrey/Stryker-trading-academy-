// TradeZoro corner mark on every chart (Owner order 2026-11-09). Fixtures only (phone-layouts-lib).
//   STRYKER_TEST_BASE=http://127.0.0.1:8137 node tools/tests/chart-brand-browser.js <outDir>
const { launch, BASE } = require('./lib.js');
const { newCtx, openPage, sleep } = require('./phone-layouts-lib.js');
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };

// Per cell: mark box, hit-test at its centre, overlap with the time axis (bottom of the plot) and price scale.
const probe = () => {
  const ws = window.STRYKER_VELA;
  return ws.cells().map((c) => {
    const R = c.chart.renderer.renderer, el = R.plot.querySelector('.tz-brand');
    if (!el) return { id: c.id, mark: false };
    const m = el.getBoundingClientRect(), pl = R.plot.getBoundingClientRect(), pane = R.scene.panes.get('price');
    const hit = document.elementFromPoint(m.left + m.width / 2, m.top + m.height / 2);
    const axisTop = pl.top + R.coords.height, axisLeft = pl.right - R.rightAxisW;
    return {
      id: c.id, mark: true, w: Math.round(m.width), h: Math.round(m.height), op: +getComputedStyle(el).opacity,
      shown: getComputedStyle(el).display !== 'none' && m.width > 0,
      left: Math.round(m.left - pl.left), toPaneBottom: Math.round(pl.top + pane.bounds.top + pane.bounds.height - m.bottom),
      hitIsMark: !!(hit && el.contains(hit)), pe: getComputedStyle(el).pointerEvents, anchors: el.querySelectorAll('a').length,
      overAxisY: m.bottom > axisTop + 0.5, overScale: m.right > axisLeft + 0.5, src: el.querySelector('img').getAttribute('src'),
      inPane: m.top >= pl.top + pane.bounds.top - 0.5,
    };
  });
};

(async () => {
  const b = await launch();
  for (const [w, h, mobile, theme] of [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [390, 844, true, 'dark'], [390, 844, true, 'light']]) {
    const tag = `${w}-${theme}`;
    const ctx = await newCtx(b, { w, h, mobile });
    if (theme === 'light') await ctx.addInitScript(() => { try { localStorage.setItem('stryker_theme', 'day'); } catch (e) {} });
    const { p, errors } = await openPage(ctx, BASE, true);
    await sleep(1500);
    let r = await p.evaluate(probe);
    const one = r[0] || {};
    check(r.length === 1 && one.mark && one.shown, `${tag}: single chart has one mark`, r);
    check(one.h === (mobile ? 19 : 24) && one.op === 0.4, `${tag}: size ${mobile ? 19 : 24}px, opacity .4`, one);
    check(one.left >= 8 && one.left <= 12 && one.toPaneBottom >= 8 && one.toPaneBottom <= 12, `${tag}: 8-12 px from left and bottom of the main pane`, one);
    check(one.hitIsMark === false && one.pe === 'none' && one.anchors === 0, `${tag}: pointer-events none, hit goes to the chart, no link`, one);
    check(!one.overAxisY && !one.overScale && one.inPane, `${tag}: clear of time axis and price scale`, one);
    check(/tradezoro-tzmark-1014-/.test(one.src || '') && !/panther|494|logo-full|emblem|header|master/.test(one.src || ''), `${tag}: TZ mark art`, one.src);
    // the chart's own screenshot carries the mark: export pixels in the corner, with and without the element
    const ex = await p.evaluate(async () => {
      const ws = window.STRYKER_VELA, R = ws.cells()[0].chart.renderer.renderer;
      const load = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
      const el = R.plot.querySelector('.tz-brand'), pl = R.plot.getBoundingClientRect(), m = el.getBoundingClientRect();
      const grab = async () => {
        const i = await load(ws.screenshot()); const cv = document.createElement('canvas'); cv.width = i.width; cv.height = i.height;
        const g = cv.getContext('2d'); g.drawImage(i, 0, 0); const k = i.width / pl.width;
        return Array.from(g.getImageData(Math.round((m.left - pl.left) * k), Math.round((m.top - pl.top) * k), Math.round(m.width * k), Math.round(m.height * k)).data);
      };
      const a = await grab(); el.removeAttribute('data-vela-screenshot');
      const z = await grab(); el.setAttribute('data-vela-screenshot', '1');
      let d = 0; for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - z[i]) + Math.abs(a[i + 1] - z[i + 1]) + Math.abs(a[i + 2] - z[i + 2]);
      return { diff: d, px: a.length / 4 };
    });
    check(ex.diff / ex.px > 2, `${tag}: chart screenshot contains the mark`, ex);
    const sets = await p.evaluate(() => /tradezoro (logo|mark)|brand|watermark|corner (logo|mark)/i.test([...document.querySelectorAll('[class*="settings"], [id*="settings"], #stkc-more-pop')].map((e) => e.textContent).join(' ')));
    check(!sets, `${tag}: no setting row mentions the mark`);
    await p.screenshot({ path: `${OUT}/brand-${tag}.png` });
    if (theme === 'dark') {
      await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('4')); await sleep(3500);
      r = await p.evaluate(probe);
      check(r.length === 4 && r.every((x) => x.mark && x.shown && !x.hitIsMark && !x.overAxisY && !x.overScale && x.inPane), `${tag}: 2x2 layout, every cell has a mark`, r.map((x) => [x.id, x.mark, x.shown]));
      await p.screenshot({ path: `${OUT}/brand-${tag}-2x2.png` });
    }
    check(!errors.length, `${tag}: no page errors`, errors);
    await ctx.close();
  }
  await b.close();
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
