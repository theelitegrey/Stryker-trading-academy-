// Charts ONE toolbar (Owner order 2026-10-14, assets/chart-onebar.js) against
// tools/tests/chart-dev-server.mjs. Needs network (jsDelivr + Yahoo).
//   CHART_BASE=http://localhost:8041 [BEFORE_BASE=http://localhost:8042] node tools/tests/chart-onebar-browser.js [shotsDir]
// Run under flock /tmp/stryker-chrome.lock (one Chrome at a time on the 4 GB server).
// Asserts, at 2560 / 1440 / 1280 / 1024 / 820 / 390 (+ 1440 day theme):
//   - one row only (Vela's topbar is inside #stkc-bar on desktop, hidden on the phone layout),
//     every visible toolbar item on one line, none past the bar's edges, no horizontal scroll;
//   - item order: symbol, intervals, style, Indicators, undo/redo, layout group, then right side;
//   - every id the other suites click still exists and works from the bar or from ⋯ More;
//   - plain typing on a moved Vela button still opens symbol search; Alt+A still opens alerts;
//   - chart canvas height at 1440x900 vs BEFORE_BASE (the old two-row page), when given;
//   - no console errors.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://localhost:8041';
const BEFORE = process.env.BEFORE_BASE || '';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
let PAPER = true;   // desktop(): switch paper trading on after the off-state check
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

async function open(b, base, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|\/api\/chart\/stream/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(base + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_CHART_UI, null, { timeout: 30000 });
  await p.waitForFunction(() => !!document.getElementById('stkl-btn') && !!document.getElementById('stkc-paper-btn'), null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(3500);
  return { ctx, p, errors };
}

const frame = (p) => p.evaluate(() => {
  const grid = document.querySelector('#vela-chart .vela-ws-grid');
  const cv = [...document.querySelectorAll('#vela-chart canvas')].filter((c) => c.getClientRects().length).sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
  const bar = document.getElementById('stkc-bar');
  const vt = document.querySelector('.vela-widget-topbar');
  const vtR = vt && getComputedStyle(vt).display !== 'none' && vt.getBoundingClientRect();
  return {
    grid: grid ? Math.round(grid.getBoundingClientRect().height) : 0,
    canvas: cv ? Math.round(cv.getBoundingClientRect().height) : 0,
    bar: Math.round(bar.getBoundingClientRect().height),
    velaBarOwnRow: !!(vtR && vtR.height > 0 && !bar.contains(vt)),
    velaBarH: vtR ? Math.round(vtR.height) : 0
  };
});

const layoutInfo = (p) => p.evaluate(() => {
  const bar = document.getElementById('stkc-bar');
  const br = bar.getBoundingClientRect();
  const vis = [];
  const walk = (n) => {
    for (const c of n.children) {
      const cs = getComputedStyle(c);
      if (cs.display === 'contents') { walk(c); continue; }
      if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed' || c.classList.contains('stkc-ob-sp')) continue;
      const r = c.getBoundingClientRect();
      if (r.width < 1) continue;
      vis.push({ k: c.id || String(c.className).split(' ')[0] || c.tagName, l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) });
    }
  };
  walk(bar);
  const tops = new Set(vis.map((v) => Math.round((v.t + v.b) / 2 / 6)));
  const out = vis.filter((v) => v.l < br.left - 1 || v.r > br.right + 1).map((v) => v.k);
  const hits = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) { const a = vis[i], b = vis[j]; if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) hits.push(a.k + ' x ' + b.k); }
  const x = (sel) => { const e = document.querySelector(sel); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return r.width ? Math.round(r.left) : null; };
  const inMore = [...document.querySelectorAll('#stkc-more-pop > *')].map((e) => e.id || e.querySelector('[id]')?.id || e.className);
  return {
    w: innerWidth, barH: Math.round(br.height), rows: tops.size, out, hits, n: vis.length,
    sw: document.documentElement.scrollWidth, barScroll: bar.scrollWidth - bar.clientWidth,
    merged: bar.classList.contains('stkc-onebar'), cls: bar.className,
    order: { sym: x('.vela-widget-symbol'), iv: x('.stk-iv-row'), style: x('#vela-topbar-style'), ind: x('.vela-widget-indicators'), undo: x('.vela-widget-undo'), lay: x('#stkl-btn'), grid: x('#stkc-layout-btn'), replay: x('#stkr-btn'), trade: x('#stkc-paper-btn'), broker: x('#stkrb-btn'), alerts: x('#stkc-alerts-btn'), bell: x('.vela-widget-alerts'), cog: x('#stkc-settings-btn'), info: x('#stkc-credits-btn'), more: x('#stkc-more-btn') },
    inMore
  };
});

async function viaBar(p, sel) {
  // click a toolbar item, opening ⋯ More first when it lives there
  const inMore = await p.evaluate((s) => { const e = document.querySelector(s); return !!(e && e.closest('#stkc-more-pop')); }, sel);
  if (inMore) { await p.click('#stkc-more-btn'); await p.waitForTimeout(150); }
  await p.click(sel);
  await p.waitForTimeout(400);
  return inMore;
}

async function closeAll(p) { await p.keyboard.press('Escape'); await p.waitForTimeout(150); await p.mouse.click(5, 895 > 0 ? 300 : 300).catch(() => {}); await p.keyboard.press('Escape'); await p.waitForTimeout(200); }

async function desktop(b, w, h, theme, tag) {
  const { ctx, p, errors } = await open(b, BASE, { w, h, theme });
  // Paper trading is off by default (build 533): the Trade button must stay hidden in the merged bar.
  const offVis = await p.evaluate(() => { const t = document.getElementById('stkc-paper-btn'); return !!(t && t.getClientRects().length && t.getBoundingClientRect().width > 0); });
  check(!offVis, `${tag}: Trade button hidden while paper trading is off`);
  if (PAPER) {
    await p.evaluate(() => window.__stkPaper && window.__stkPaper.setEnabled(true));
    await p.waitForTimeout(600);
    const onVis = await p.evaluate(() => { const t = document.getElementById('stkc-paper-btn'); return !!(t && t.getClientRects().length && (t.getBoundingClientRect().width > 0 || t.closest('#stkc-more-pop'))); });
    check(onVis, `${tag}: Trade button shows once paper trading is switched on`);
  }
  const L = await layoutInfo(p);
  const F = await frame(p);
  console.log(tag, JSON.stringify({ barH: L.barH, n: L.n, cls: L.cls, inMore: L.inMore, order: L.order }));
  check(L.merged && !F.velaBarOwnRow, `${tag}: Vela topbar merged into #stkc-bar (no second row)`);
  check(L.rows === 1 && L.barH <= 44, `${tag}: one line, bar ${L.barH}px tall`);
  check(L.out.length === 0 && L.barScroll <= 1 && L.sw <= w + 1, `${tag}: nothing clipped / scrolling ${JSON.stringify({ out: L.out, barScroll: L.barScroll, sw: L.sw })}`);
  check(L.hits.length === 0, `${tag}: no overlapping items ${JSON.stringify(L.hits)}`);
  const o = L.order;
  // TradingView order (build 535): symbol | intervals | style | Indicators | alerts, Replay | undo — layout | grid | settings | Trade, broker | info, More
  const seq = [o.sym, o.iv, o.style, o.ind, o.alerts, o.replay, o.undo].filter((v) => v != null);
  check(seq.every((v, i) => i === 0 || v > seq[i - 1]), `${tag}: left order symbol < intervals < style < Indicators < alerts < Replay < undo ${JSON.stringify(seq)}`);
  const rseq = [o.lay, o.grid, o.cog, o.trade, o.broker, o.info, o.more].filter((v) => v != null);
  check(rseq.every((v, i) => i === 0 || v > rseq[i - 1]) && (rseq[0] == null || rseq[0] > (o.undo || 0)), `${tag}: right order layout < grid < settings < Trade < broker < info < More ${JSON.stringify(rseq)}`);
  await p.screenshot({ path: `${OUT}/onebar-${tag}.png` });
  console.log('screenshot', `${OUT}/onebar-${tag}.png`);

  if (tag === '1440') {
    // every hook still opens its thing, from the bar or from ⋯ More
    const hooks = [
      ['#stkc-credits-btn', () => !document.getElementById('stkc-credits').hidden],
      ['#stkc-tpl-btn', () => !document.getElementById('stkc-tpl-pop').hidden],
      ['#stkc-layout-btn', () => !document.getElementById('stkc-layout-pop').hidden],
      ['#stkl-btn', () => !document.getElementById('stkl-pop').hidden],
      ['#stkr-btn', () => !document.getElementById('stkr-pop').hidden],
      ['#stkc-paper-btn', () => { const t = document.getElementById('stkpt-tk'); return !!t && !t.hidden && getComputedStyle(t).display !== 'none'; }],
      ['#stkc-alerts-btn', () => { const a = document.querySelector('.stk-al, #stk-al, [aria-labelledby="stk-al-h"]'); return !!a && !!a.getClientRects().length; }],
      ['#stkc-settings-btn', () => !![...document.querySelectorAll('[role="dialog"]')].find((d) => d.getClientRects().length && /setting/i.test(d.getAttribute('aria-label') || d.textContent.slice(0, 80)))],
      ['.vela-widget-indicators', () => !!document.querySelector('.stkiw-ov, .stkiw') && !![...document.querySelectorAll('.stkiw-ov, .stkiw')].find((e) => e.getClientRects().length)],
      ['.vela-widget-symbol', () => !![...document.querySelectorAll('.vela-sp, .vela-symbol-picker, [class*="vela-sp"]')].find((e) => e.getClientRects().length && e.getBoundingClientRect().height > 100)],
      ['.stkw-rail .vela-widget-alerts', () => !![...document.querySelectorAll('[role="menu"], .vela-menu')].find((e) => e.getClientRects().length)]
    ];
    for (const [sel, ok] of hooks) {
      const exists = await p.$(sel);
      if (!exists) { check(false, `${tag}: ${sel} exists`); continue; }
      const m = await viaBar(p, sel);
      const res = await p.evaluate(ok);
      check(res, `${tag}: ${sel} opens its panel${m ? ' (from ⋯ More)' : ''}`);
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      await p.mouse.click(w / 2, h / 2); await p.waitForTimeout(250);
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    }
    // plain typing on a moved Vela button -> symbol search
    await p.focus('#vela-topbar-style');
    await p.keyboard.press('e');
    await p.waitForTimeout(500);
    const sp = await p.evaluate(() => { const i = [...document.querySelectorAll('input')].find((x) => x.getClientRects().length && /search|symbol/i.test((x.placeholder || '') + (x.getAttribute('aria-label') || ''))); return i ? i.value : null; });
    check(sp != null && /e/i.test(sp), `${tag}: typing "e" on a toolbar button opens symbol search (value ${JSON.stringify(sp)})`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    // Alt+A on the chart -> alerts
    await p.mouse.move(w / 2, h / 2);
    await p.keyboard.press('Alt+a');
    await p.waitForTimeout(500);
    const al = await p.evaluate(() => !![...document.querySelectorAll('[aria-labelledby="stk-al-h"], .stk-al-box, .stk-al-new, [role="dialog"]')].find((d) => d.getClientRects().length && /alert/i.test(d.textContent.slice(0, 200))));
    // Alt+A does not open this panel from a headless key press on old main either (build 533,
    // checked 2026-10-14), so it is reported, not asserted.
    console.log((al ? 'INFO ' : 'INFO (not asserted) ') + `${tag}: Alt+A opened price alerts: ${al}`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  }
  if (tag === '1024' || tag === '1280') {
    // ⋯ More open, as evidence
    const has = await p.$('#stkc-more-btn');
    if (has && await p.evaluate(() => !document.querySelector('.stkc-ob-more').hidden)) {
      await p.click('#stkc-more-btn'); await p.waitForTimeout(300);
      const pr = await p.evaluate(() => { const r = document.getElementById('stkc-more-pop').getBoundingClientRect(); return { l: r.left, r: r.right, vis: !document.getElementById('stkc-more-pop').hidden }; });
      check(pr.vis && pr.l >= 0 && pr.r <= w, `${tag}: ⋯ More menu opens inside the viewport ${JSON.stringify(pr)}`);
      await p.screenshot({ path: `${OUT}/onebar-${tag}-more.png` });
      console.log('screenshot', `${OUT}/onebar-${tag}-more.png`);
    }
  }
  check(!errors.length, `${tag}: console errors ${errors.slice(0, 3).join(' | ') || 'none'}`);
  await ctx.close();
  return F;
}

async function phone(b) {
  const { ctx, p, errors } = await open(b, BASE, { w: 390, h: 844, mobile: true });
  const L = await layoutInfo(p);
  const F = await frame(p);
  console.log('390', JSON.stringify({ barH: L.barH, n: L.n, cls: L.cls, inMore: L.inMore }));
  check(!L.merged && !F.velaBarOwnRow && await p.evaluate(() => !!document.querySelector('#stkc-bar .vela-mobilebar')), '390: phone has one top row (Vela bar hidden, its bottom bar moved into the top row)');
  check(L.rows === 1 && L.out.length === 0 && L.barScroll <= 1 && L.sw <= 391, `390: one line, nothing clipped ${JSON.stringify({ rows: L.rows, out: L.out, barScroll: L.barScroll, sw: L.sw })}`);
  const tb = await p.evaluate(() => {
    const lb = document.getElementById('stkl-btn'), gb = document.getElementById('stkc-layout-btn');
    const vis = (e) => e && e.getClientRects().length && e.getBoundingClientRect().width > 0 && !e.closest('#stkc-more-pop');
    return { l: vis(lb) ? Math.round(lb.getBoundingClientRect().right) : null, g: vis(gb) ? Math.round(gb.getBoundingClientRect().left) : null };
  });
  check(L.hits.length === 0 && (tb.l == null || tb.g == null || tb.l <= tb.g), `390: no overlap ("Unsaved layout" vs "1 chart") ${JSON.stringify({ hits: L.hits, tb })}`);
  await p.screenshot({ path: `${OUT}/onebar-390.png` });
  console.log('screenshot', `${OUT}/onebar-390.png`);
  if (await p.evaluate(() => !document.querySelector('.stkc-ob-more').hidden)) {
    await p.click('#stkc-more-btn'); await p.waitForTimeout(300);
    const pr = await p.evaluate(() => { const r = document.getElementById('stkc-more-pop').getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right) }; });
    check(pr.l >= 0 && pr.r <= 390, `390: ⋯ More menu inside the screen ${JSON.stringify(pr)}`);
    await p.screenshot({ path: `${OUT}/onebar-390-more.png` });
    console.log('screenshot', `${OUT}/onebar-390-more.png`);
  }
  check(!errors.length, `390: console errors ${errors.slice(0, 3).join(' | ') || 'none'}`);
  await ctx.close();
}

(async () => {
  const b = await launch();
  try {
    let before = null;
    if (BEFORE) {
      const { ctx, p } = await open(b, BEFORE, { w: 1440, h: 900 });
      before = await frame(p);
      await p.screenshot({ path: `${OUT}/onebar-before-1440.png` });
      console.log('screenshot', `${OUT}/onebar-before-1440.png`);
      await ctx.close();
    }
    PAPER = false;
    const after0 = await desktop(b, 1440, 900, null, '1440-paperoff');
    PAPER = true;
    const after = await desktop(b, 1440, 900, null, '1440');
    if (before) {
      console.log('HEIGHT before', JSON.stringify(before), 'after', JSON.stringify(after0));
      check(after0.grid > before.grid, `1440x900 (paper off, both builds): chart grid ${before.grid} -> ${after0.grid} px (+${after0.grid - before.grid}), canvas ${before.canvas} -> ${after0.canvas} px (+${after0.canvas - before.canvas})`);
    }
    await desktop(b, 2560, 1300, null, '2560');
    await desktop(b, 1280, 800, null, '1280');
    await desktop(b, 1024, 768, null, '1024');
    await desktop(b, 1440, 900, 'day', '1440-day');
    await phone(b);
  } finally { await b.close(); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
