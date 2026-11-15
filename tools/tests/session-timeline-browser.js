// Session clock popover + timeline. node tools/tests/session-timeline-browser.js [shotsDir]
// Needs a static server (CHART_BASE or STRYKER_TEST_BASE, default http://localhost:8000).
// Mocked time Tue 17 Nov 2026 10:00 UTC, browser zone Asia/Kolkata (15:30 local): Asia 05:30-14:30 over, London 13:30-22:30 on, New York 18:30-03:30 wraps midnight (two segments).
const fs = require('fs');
const lib = require('./lib.js'), { launch } = lib;
const BASE = process.env.CHART_BASE || lib.BASE;   // release runner passes CHART_BASE (chart-dev-server); by hand STRYKER_TEST_BASE / :8000
const OUT = process.argv[2] || (process.env.TMPDIR || '/tmp');
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x) : '')); };
const near = (a, b, t) => Math.abs(a - b) <= t;
const MEASURE = () => {
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, cy: r.top + r.height / 2 }; };
  const rows = [...document.querySelectorAll('.mtl-row')].map((row) => ({
    name: R(row.querySelector('.mtl-name')), track: R(row.querySelector('.mtl-track')), hrs: R(row.querySelector('.mtl-hrs')), row: R(row),
    dot: R(row.querySelector('.mtl-dot')), text: row.querySelector('.mtl-hrs').textContent, k: row.dataset.k,
    bars: [...row.querySelectorAll('.mtl-bar')].map((b) => ({ l: R(b).x, w: R(b).w, on: b.classList.contains('is-on') })) }));
  const pop = R(document.querySelector('.mclock-pop')), now = R(document.querySelector('.mtl-now'));
  return { rows, pop, now, ticks: [...document.querySelectorAll('.mtl-ticks i')].map((i) => i.textContent), head: document.querySelector('.mclock-pstate').textContent,
    foot: document.querySelector('.mclock-foot span').textContent, over: document.documentElement.scrollWidth > innerWidth };
};
(async () => {
  const b = await launch();
  for (const [label, vp, theme, mobile] of [['1440-dark', { width: 1440, height: 900 }, 'dark', false], ['1440-light', { width: 1440, height: 900 }, 'light', false], ['390-dark', { width: 390, height: 844 }, 'dark', true]]) {
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'Asia/Kolkata', hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.clock.install({ time: new Date('2026-11-17T10:00:00Z') });
    await p.goto(BASE + '/'+(process.env.PAGE||'economic-calendar.html')+'', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.mclock-pill', { timeout: 20000 });
    await p.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    if (mobile) await p.tap('.mclock-pill'); else await p.hover('.mclock-pill');
    await p.clock.runFor(1500);
    await p.waitForSelector('.mclock-pop:not([hidden])', { timeout: 3000 }).catch(() => {});
    const m = await p.evaluate(MEASURE);
    console.log('--- ' + label);
    check(m.pop.w > 0, label + ' popover opens (' + (mobile ? 'tap' : 'hover') + ')');
    check(m.rows.length === 4, label + ' 4 rows', m.rows.length);
    check(m.rows.map((r) => r.k).join() === 'asia,london,ny,cme', label + ' row order');
    check(m.ticks.join() === '00:00,06:00,12:00,18:00', label + ' ticks', m.ticks);
    const tr = m.rows[0].track;
    check(m.rows.every((r) => near(r.track.x, tr.x, 0.5) && near(r.track.w, tr.w, 0.5)), label + ' track x/width identical', m.rows.map((r) => [r.track.x, r.track.w]));
    check(m.rows.every((r) => near(r.name.x, m.rows[0].name.x, 0.5) && near(r.name.w, m.rows[0].name.w, 0.5)), label + ' name column identical');
    check(m.rows.every((r) => near(r.hrs.r, m.rows[0].hrs.r, 0.5)), label + ' hours right edges identical');
    check(m.rows.every((r) => near(r.row.h, 28, 0.6)), label + ' row heights 28 (page zoom 0.985)');
    check(m.rows.every((r) => near(r.name.cy, r.track.cy, 1) && near(r.hrs.cy, r.track.cy, 1) && near(r.dot.cy, r.track.cy, 1)), label + ' row centres aligned +-1');
    const nowX = tr.x + tr.w * (15.5 / 24);
    check(near(m.now.x + m.now.w / 2, nowX, 2), label + ' now line x matches 15:30', [m.now.x + m.now.w / 2, nowX]);
    const frac = (bb) => [(bb.l - tr.x) / tr.w * 24, (bb.l + bb.w - tr.x) / tr.w * 24];
    const exp = { asia: [[5.5, 14.5]], london: [[13.5, 22.5]], ny: [[0, 3.5], [18.5, 24]] };
    for (const k of Object.keys(exp)) {
      const got = m.rows.find((r) => r.k === k).bars.map(frac);
      check(got.length === exp[k].length && got.every((g, i) => near(g[0], exp[k][i][0], 0.15) && near(g[1], exp[k][i][1], 0.15)), label + ' ' + k + ' bars', got);
    }
    check(m.rows[1].bars[0].on && !m.rows[0].bars[0].on && !m.rows[2].bars.some((x) => x.on), label + ' only London bar bright');
    check(m.rows.map((r) => r.text).slice(0, 3).join() === '05:30–14:30,13:30–22:30,18:30–03:30', label + ' hours text', m.rows.map((r) => r.text));
    check(m.rows[3].bars.length >= 2, label + ' CME daily break is a gap', m.rows[3].bars.length);
    check(/London Session is Open/.test(m.head), label + ' head', m.head);
    check(m.foot === 'Times in your time zone · holidays not included', label + ' one-line note');
    check(!m.over, label + ' no page overflow');
    if (mobile) check(near(m.pop.r, 390, 6) && near(m.pop.b, 844, 6) && m.pop.x < 1, label + ' bottom sheet', m.pop);
    console.log('MEASURE ' + label + ' ' + JSON.stringify({ pop: [m.pop.w, m.pop.h], nameX: m.rows[0].name.x, nameW: m.rows[0].name.w, trackX: tr.x, trackW: tr.w, hrsR: m.rows[0].hrs.r, rowH: m.rows.map((r) => r.row.h), cy: m.rows.map((r) => r.track.cy) }));
    await p.clock.runFor(800); await p.addStyleTag({ content: '.tzc{display:none!important}' }); await p.screenshot({ path: OUT + '/sessbar-' + label + '.png' });
    const t1 = await p.textContent('.mclock-pmk'); await p.clock.runFor(2000); const t2 = await p.textContent('.mclock-pmk');
    check(t1 !== t2, label + ' countdown ticks', [t1, t2]);
    await ctx.close();
  }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
