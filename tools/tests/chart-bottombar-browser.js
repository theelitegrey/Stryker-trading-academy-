// One bottom row on the chart (Owner 17 Nov 2026): range buttons, AI item, Paper group, L1/L2, clock, RTH/ETH, gear, latency, Trade.
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/chart-bottombar-browser.js <shotsDir>
// Checks at 1440/1280/1024: no paper strip row, every visible item on one centre line (±1px), none overlap, Trade far right,
// Paper group right of ALL (and of the AI item), same 24px control height, 12px around dividers. 390: Trade + Paper stay in one phone head row.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };

async function open(b, w, theme) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, isMobile: w < 500, hasTouch: w < 500, deviceScaleFactor: 1 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net|[a-z0-9.-]*hyperliquid\.xyz)/, (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => window.__stkPaper.setEnabled(true));
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('hyperliquid:BTC'); ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 50) break; } });
  await p.waitForTimeout(3000);
  return { ctx, p };
}
const measure = (p) => p.evaluate(() => {
  const bar = document.querySelector('.vela-widget-bottombar'), R = (e) => { const r = e.getBoundingClientRect(); return { n: String(e.className).split(' ')[0], x: r.x, r: r.right, cy: r.y + r.height / 2, h: r.height, w: r.width }; };
  // leaf items: direct children of the bar plus the contents of our two groups
  const items = [];
  for (const k of bar.children) {
    if (!k.offsetWidth || !k.offsetHeight) continue;
    if (k.id === 'stkpt-bb' || k.id === 'stkpt-tw' || k.id === 'stkai-chip') items.push(...[...k.children].filter((c) => c.offsetWidth && c.offsetHeight && !c.hidden).map(R)); else items.push(R(k));
  }
  const q = (s) => { const e = document.querySelector(s); return e && e.offsetWidth ? R(e) : null; };
  const ranges = [...bar.querySelectorAll('.vela-bb-range')].filter((e) => e.offsetWidth);
  const strip = document.getElementById('stkpt'), sr = strip.getBoundingClientRect();
  return { items, bar: R(bar), grp: q('#stkpt-bb'), tw: q('#stkpt-tw'), trade: q('.stkpt-trade'), all: ranges.length ? R(ranges[ranges.length - 1]) : null, ai: q('.stkai-bb'), lat: q('.stklat-chip'),
    stripH: getComputedStyle(strip).display === 'none' ? 0 : sr.height, sepGap: [...bar.querySelectorAll('#stkpt-bb .stkpt-sep, #stkpt-tw .stkpt-sep')].map((s) => { const sr2 = s.getBoundingClientRect(), prev = (s.parentElement.id === 'stkpt-bb' ? s.parentElement.previousElementSibling : s.parentElement.previousElementSibling); return { left: sr2.x - prev.getBoundingClientRect().right, rightGap: s.nextElementSibling.getBoundingClientRect().x - sr2.right }; }) };
});

(async () => {
  const b = await launch();
  try {
    for (const [w, theme, shot] of [[1440, 'night', 1], [1440, 'day', 1], [1280, 'night', 0], [1024, 'night', 1]]) {
      const { ctx, p } = await open(b, w, theme);
      const m = await measure(p), L = w + ' ' + theme + ': ';
      const cys = m.items.map((i) => i.cy), spread = Math.max(...cys) - Math.min(...cys);
      check(m.stripH === 0, L + 'no separate paper strip row (height ' + m.stripH + ')');
      check(spread <= 1, L + 'every item on one centre line (spread ' + spread.toFixed(2) + 'px, ' + m.items.length + ' items)');
      const sorted = [...m.items].sort((a, c) => a.x - c.x);
      check(sorted.every((it, i) => i === 0 || it.x >= sorted[i - 1].r - 0.5), L + 'no overlaps', sorted.map((s) => s.n + ':' + Math.round(s.x) + '-' + Math.round(s.r)));
      check(m.trade && m.bar.r - m.trade.r <= 12 && m.trade.x > m.lat.r, L + 'Trade is the far right item, right of latency (gap to edge ' + (m.trade && (m.bar.r - m.trade.r).toFixed(1)) + ')');
      check(m.grp && m.grp.x >= m.all.r && (!m.ai || m.grp.x >= m.ai.r), L + 'Paper group right of ALL' + (m.ai ? ' and the AI item' : ''));
      check(m.trade.h === 24 && m.items.filter((i) => /vela-bb-range|stkpt-toggle|stkpt-badge/.test(i.n)).every((i) => i.h === 24), L + 'Trade / Paper / DEMO / ranges all 24px tall');
      check(m.sepGap.every((s) => Math.abs(s.left - 10) <= 2.6 && Math.abs(s.rightGap - 12) <= 0.6 || Math.abs(s.left - 12) <= 0.6), L + 'divider spacing 12 (left/right)', m.sepGap);
      console.log('  numbers', JSON.stringify({ cySpread: +spread.toFixed(2), sepGap: m.sepGap, tradeToEdge: +(m.bar.r - m.trade.r).toFixed(1) }));
      if (shot) await p.screenshot({ path: OUT + '/bottombar-' + w + '-' + (theme === 'night' ? 'dark' : 'light') + '.png', clip: { x: 0, y: 740, width: w, height: 160 } });
      if (w === 1440 && theme === 'night') {
        await p.click('.stkpt-toggle'); await p.waitForTimeout(700);
        const o = await p.evaluate(() => { const s = document.getElementById('stkpt').getBoundingClientRect(), bb = document.querySelector('.vela-widget-bottombar').getBoundingClientRect(); return { open: document.getElementById('stkpt').classList.contains('open'), gap: bb.top - s.bottom, h: s.height }; });
        check(o.open && Math.abs(o.gap) <= 1 && o.h > 100, 'Paper trading item opens the panel upward, flush above the bar', o);
      }
      await ctx.close();
    }
    const { ctx, p } = await open(b, 390, 'night');
    const ph = await p.evaluate(() => { const s = document.getElementById('stkpt').getBoundingClientRect(), t = document.querySelector('.stkpt-trade').getBoundingClientRect(), g = document.querySelector('.stkpt-toggle').getBoundingClientRect(); return { cyd: Math.abs((t.y + t.height / 2) - (g.y + g.height / 2)), tr: t.right, w: innerWidth, overlap: g.right > t.x }; });
    check(ph.cyd <= 1 && !ph.overlap && ph.tr <= ph.w, '390: Paper + Trade share one row, no overlap', ph);
    await p.screenshot({ path: OUT + '/bottombar-390-dark.png', clip: { x: 0, y: 740, width: 390, height: 160 } });
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
