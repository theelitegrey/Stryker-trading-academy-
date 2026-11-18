// Charts bottom bar must never wrap per letter (member report 1572555568923549717, MacBook Pro 14", ~1512x982), plus the Data source back button.
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/bottombar-browser.js <shotsDir>
// Asserts at 1512x982, 1470x956, 1440x900, 1280x800, 1100x800, 800x800, 390x844 (dark + light at 1440/1512): no bottom-bar item taller than 1 line (> 2x
// its font line, i.e. > 32px), all visible items share one vertical centre (+-1px), same-role ranges same height, nothing past the bar edges.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };

async function open(b, w, h, theme, mobile) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && document.querySelector('.vela-widget-bottombar, #byo-btn'), null, { timeout: 60000 });
  await sleep(2500);
  // show the paper group + Trade so the widest real bar is measured
  await p.evaluate(() => { for (const i of ['stkpt-bb', 'stkpt-tw']) { const e = document.getElementById(i); if (e) e.hidden = false; } });
  // the member's bar also carried the Positions & Orders button, the L1/L2 feed chips and the Equity summary: show the same load here
  await p.evaluate(() => {
    const bar = document.querySelector('#vela-chart .vela-widget-bottombar'); if (!bar) return;
    const po = bar.querySelector('.stkpo-btn'); if (po) { po.hidden = false; po.style.display = 'inline-flex'; }
    const hs = bar.querySelector('.stkpt-hsum'); if (hs && !hs.textContent.trim()) hs.innerHTML = '<span><em>Equity</em> $231,501.95</span> <span><em>Open P&L</em> $0.00</span> <span><em>Day</em> +$1,635.00</span>';
  });
  await sleep(400);
  return { ctx, p };
}

const measure = (p) => p.evaluate(() => {
  const bar = document.querySelector('#vela-chart .vela-widget-bottombar');
  if (!bar || getComputedStyle(bar).display === 'none') return null;
  const br = bar.getBoundingClientRect();
  const items = [...bar.querySelectorAll('button, .stkpt-badge, .stkpt-hsum > *, .stklat-v, .stkpt-tw .stkpt-b')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(e).visibility !== 'hidden'; });
  const rows = items.map((e) => { const r = e.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.3; return { t: (e.textContent || '').trim().slice(0, 14), c: e.className.toString().slice(0, 24), l: Math.round(r.left), r: Math.round(r.right), h: Math.round(r.height), cy: +((r.top + r.bottom) / 2).toFixed(1), lh }; });
  const ranges = rows.filter((x) => /vela-bb-range/.test(x.c));
  const gaps = ranges.slice(1).map((x, i) => x.l - ranges[i].r);
  return { bar: { l: Math.round(br.left), r: Math.round(br.right), h: Math.round(br.height), cy: +((br.top + br.bottom) / 2).toFixed(1), sw: bar.scrollWidth, cw: bar.clientWidth }, rows, gaps, rangeH: [...new Set(ranges.map((x) => x.h))] };
});

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const cases = [[1177, 737, 'dark'], [1000, 800, 'dark'], [900, 800, 'dark'], [700, 800, 'dark'], [1250, 800, 'dark'], [1360, 800, 'dark'], [1512, 982, 'dark'], [1470, 956, 'dark'], [1440, 900, 'dark'], [1440, 900, 'light'], [1512, 982, 'light'], [1280, 800, 'dark'], [1100, 800, 'dark'], [800, 800, 'dark'], [390, 844, 'dark', true]];
    for (const [w, h, theme, mobile] of cases) {
      const tag = w + 'x' + h + '-' + theme;
      const { ctx, p } = await open(b, w, h, theme, mobile);
      const m = await measure(p);
      // the fixture's stub volume bars paint over the bar in screenshots only; lift the bar for the picture
      await p.evaluate(() => { const bb = document.querySelector('.vela-widget-bottombar'); if (bb) { bb.style.position = 'relative'; bb.style.zIndex = 99; bb.style.background = getComputedStyle(document.documentElement).getPropertyValue('--bg-0') || '#111'; } });
      await p.screenshot({ path: OUT + '/' + tag + '.png' });
      if (!m) { console.log('INFO ' + tag + ': library bottom bar hidden here (phone): nothing to wrap'); await ctx.close(); continue; }
      console.log('MEASURE ' + tag + ' ' + JSON.stringify({ bar: m.bar, rangeH: m.rangeH, gaps: m.gaps, cy: [...new Set(m.rows.map((x) => Math.round(x.cy)))] }));
      check(m.rows.every((x) => x.h <= 2 * Math.max(x.lh, 16)), tag + ': no bottom-bar item taller than 2x a line (no per-letter wrap)', m.rows.filter((x) => x.h > 2 * Math.max(x.lh, 16)));
      check(m.rows.every((x) => x.h <= 32), tag + ': every item <= 32px tall', m.rows.filter((x) => x.h > 32));
      check(m.rangeH.length <= 1, tag + ': all range buttons share one height', m.rangeH);
      const cys = m.rows.map((x) => x.cy), spread = Math.max(...cys) - Math.min(...cys);
      check(spread <= 1.01, tag + ': items share one vertical centre (+-1px) spread=' + spread.toFixed(1), m.rows.filter((x) => Math.abs(x.cy - m.bar.cy) > 1));
      check(m.rows.every((x) => x.l >= m.bar.l && x.r <= m.bar.r + 1), tag + ': nothing outside the bar edges', m.rows.filter((x) => x.l < m.bar.l || x.r > m.bar.r + 1));
      check(m.bar.sw <= m.bar.cw + 1, tag + ': bar has no horizontal overflow', m.bar);
      await ctx.close();
    }
    // Data source sheet: Back hidden on the list root, works from a source page, aligned with the title + close button
    for (const [w, h, theme, mobile] of [[1512, 982, 'dark'], [1440, 900, 'light'], [390, 844, 'dark', true]]) {
      const tag = 'byo-' + w + '-' + theme;
      const { ctx, p } = await open(b, w, h, theme, mobile);
      await p.evaluate(() => document.getElementById('byo-btn').click());
      await p.waitForSelector('#byo-sheet:not([hidden])', { timeout: 10000 });
      await sleep(600);
      check(await p.evaluate(() => { const e = document.querySelector('.byo-back'); return getComputedStyle(e).display === 'none' && e.getBoundingClientRect().width === 0; }), tag + ': Back not shown on the list root');
      await p.screenshot({ path: OUT + '/' + tag + '-list.png' });
      const row = await p.$('.byo-row-b.soon');
      if (row) {
        await row.click(); await sleep(700);
        console.log('INFO ' + tag + ' title after click: ' + (await p.evaluate(() => document.getElementById('byo-title').textContent.trim() + ' | ' + (document.querySelector('.byo-err') || {}).textContent)));
        const g = await p.evaluate(() => { const q = (s) => { const e = document.querySelector(s); return e && e.getBoundingClientRect(); }; const bk = q('.byo-back'), t = q('#byo-title'), x = q('.byo-x'); return bk && t && x ? { shown: bk.width > 0, bkCy: (bk.top + bk.bottom) / 2, tCy: (t.top + t.bottom) / 2, xCy: (x.top + x.bottom) / 2, w: bk.width, h: bk.height, xw: x.width, xh: x.height, bkL: bk.left - document.querySelector('.byo-head').getBoundingClientRect().left } : null; });
        check(g && g.shown && Math.abs(g.bkCy - g.xCy) <= 1 && Math.abs(g.bkCy - g.tCy) <= 1 && g.w === g.xw && g.h === g.xh, tag + ': Back shows on a source page, same size + centre as Close and title', g);
        console.log('MEASURE ' + tag + ' ' + JSON.stringify(g));
        await p.screenshot({ path: OUT + '/' + tag + '-detail.png' });
        await p.click('.byo-back'); await sleep(500);
        check(await p.evaluate(() => document.getElementById('byo-title').textContent.trim() === 'Data source' && getComputedStyle(document.querySelector('.byo-back')).display === 'none'), tag + ': Back returns to the Data source list');
      } else check(false, tag + ': a source row exists');
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
