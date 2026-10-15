// Charts toolbars, TradingView layout (Owner order 2026-10-14 part 2; assets/chart-tv-toolbars.js,
// assets/chart-onebar.js) against tools/tests/chart-dev-server.mjs. Needs network (jsDelivr + Yahoo).
//   CHART_BASE=http://localhost:8061 node --max-old-space-size=768 tools/tests/chart-toolbars-tv-browser.js [shotsDir]
// Run under flock /tmp/stryker-chrome.lock (one Chrome at a time on the 4 GB server).
// Checks:
//   - left column order: cursor | groups | measure, zoom | magnet, stay, lock, hide | eraser, trash | sync, fav | collapse
//   - group ▸ flyout opens with tool names; picking a tool arms it and the group button shows it (last used)
//   - long press on a group button opens its flyout
//   - lock all / hide all switch every drawing and back; trash removes them (one undo brings them back)
//   - zoom in narrows the visible range; collapse « hides the column and expands again
//   - right icon bar holds Watchlist + alert log + data window + object tree, each toggles its panel
//   - top row: one line, 38-44 px, TradingView order, every icon has a tooltip/label, fullscreen button
//   - phone 390: one slim top row with symbol / interval / Indicators / pencil, no left column,
//     the pencil opens the drawings sheet with group tabs; no horizontal scroll
//   - screenshots 2560 / 1440 / 1024 / 390, no console errors
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://localhost:8061';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined && !ok ? ' ' + JSON.stringify(extra) : '')); };

async function open(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|\/api\/chart\/stream/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_CHART_UI && window.__stkTvBars, null, { timeout: 40000 });
  await p.waitForTimeout(4500);
  return { ctx, p, errors };
}
const wait = (p, ms) => p.waitForTimeout(ms);

async function topRow(p, w, tag) {
  const L = await p.evaluate(() => {
    const bar = document.getElementById('stkc-bar');
    const br = bar.getBoundingClientRect();
    const vis = [];
    const walk = (n) => { for (const c of n.children) { const cs = getComputedStyle(c); if (cs.display === 'contents') { walk(c); continue; } if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed' || c.classList.contains('stkc-ob-sp')) continue; const r = c.getBoundingClientRect(); if (r.width < 1) continue; vis.push({ c, r }); } };
    walk(bar);
    const tops = new Set(vis.map((v) => Math.round((v.r.top + v.r.bottom) / 12)));
    const untitled = vis.filter((v) => !v.c.classList.contains('stkc-tv-div') && !v.c.classList.contains('vela-widget-tf-group') && !v.c.classList.contains('stkc-bar-l') && !v.c.classList.contains('stkc-bar-r') && !v.c.classList.contains('vela-mobilebar'))
      .flatMap((v) => (v.c.matches('button') ? [v.c] : [...v.c.querySelectorAll(':scope > button')]))
      .filter((b) => !(b.title || b.getAttribute('aria-label') || '').trim()).map((b) => b.outerHTML.slice(0, 60));
    const x = (s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length || e.closest('#stkc-more-pop')) return null; const r = e.getBoundingClientRect(); return r.width ? Math.round(r.left) : null; };
    return { h: Math.round(br.height), rows: tops.size, sw: document.documentElement.scrollWidth, scroll: bar.scrollWidth - bar.clientWidth, untitled,
      o: [x('.vela-widget-symbol'), x('.vela-widget-tf-group'), x('#vela-topbar-style'), x('.vela-widget-indicators'), x('#stkc-alerts-btn'), x('#stkr-btn'), x('.vela-widget-undo'), x('#stkl-btn'), x('#stkc-layout-btn'), x('#stkc-settings-btn'), x('#stkc-fs-btn'), x('#stkc-credits-btn')] };
  });
  check(L.rows === 1 && L.h >= 38 && L.h <= 44 && L.scroll <= 1 && L.sw <= w + 1, `${tag}: top row is one line, ${L.h}px, no scroll`, L);
  const seq = L.o.filter((v) => v != null);
  if (w > 700) check(seq.every((v, i) => i === 0 || v > seq[i - 1]), `${tag}: top row in TradingView order`, L.o);
  check(L.untitled.length === 0, `${tag}: every top-row button has a tooltip/label`, L.untitled);
}

async function desktop(b, w, h, tag, deep) {
  const { ctx, p, errors } = await open(b, { w, h });
  await topRow(p, w, tag);
  const col = await p.evaluate(() => {
    const c = document.querySelector('.vela-dtb');
    const names = [...c.children].filter((n) => getComputedStyle(n).display !== 'none').map((n) => {
      if (n.classList.contains('stkt-div') || (!n.getAttribute('aria-label') && !n.querySelector('[aria-label]'))) return '|';
      return (n.getAttribute('aria-label') || n.querySelector('.vela-dtb-icon').getAttribute('aria-label')).split(' ')[0];
    });
    const r = c.getBoundingClientRect();
    return { names: names.join(' '), w: Math.round(r.width), rail: [...document.querySelectorAll('.stkw-rail button')].map((x) => x.getAttribute('aria-label')).join('|') };
  });
  console.log(tag, 'left:', col.names, '| rail:', col.rail);
  check(/^Cursor \| (\S+ ){5,}\| Measure Zoom \| Magnet Stay Lock Hide \| Eraser Remove \| (Sync )?(Hide|Show) Collapse$/.test(col.names), `${tag}: left column in TradingView grouping`, col.names);
  check(col.w >= 40 && col.w <= 52, `${tag}: left column ${col.w}px wide`);
  check(/Watchlist/.test(col.rail) && /Alerts/.test(col.rail) && /Data window/i.test(col.rail) && /Object tree/i.test(col.rail), `${tag}: right icon bar has Watchlist, alerts, data window, object tree`, col.rail);
  await p.screenshot({ path: `${OUT}/tvbars-${tag}.png` });
  console.log('screenshot', `${OUT}/tvbars-${tag}.png`);

  if (deep) {
    // group flyout + last used
    await p.hover('.vela-dtb .vela-dtb-cell:has([aria-label="Lines"])').catch(() => {});
    await p.click('.vela-dtb .vela-dtb-cell:has(.vela-dtb-icon[aria-label="Lines"]) .vela-dtb-arrow').catch(async () => {
      await p.evaluate(() => [...document.querySelectorAll('.vela-dtb .vela-dtb-arrow')][0].click());
    });
    await wait(p, 300);
    const fly = await p.evaluate(() => { const f = document.querySelector('.vela-dtb-flyout'); return f ? [...f.querySelectorAll('.vela-dtb-item')].map((i) => i.getAttribute('aria-label')) : null; });
    check(fly && fly.length >= 3, 'group ▸ opens a flyout with tool names', fly);
    await p.screenshot({ path: `${OUT}/tvbars-${tag}-flyout.png` });
    const pick = fly && (fly.find((n) => /^Ray$/i.test(n)) || fly[2]);
    await p.click(`.vela-dtb-flyout .vela-dtb-item[aria-label="${pick}"]`);
    await wait(p, 300);
    const armed = await p.evaluate(() => { try { return window.STRYKER_VELA.active.chart.drawings.getTool(); } catch (e) { return 'ERR'; } });
    const btnTip = await p.evaluate(() => { const cell = [...document.querySelectorAll('.vela-dtb .vela-dtb-cell')][0]; return cell.querySelector('.vela-dtb-icon').innerHTML.length; });
    check(!!armed && armed !== 'ERR', `picking "${pick}" arms it (${armed})`);
    await p.keyboard.press('Escape'); await wait(p, 200);
    await p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.setTool(null));
    // clicking the group icon re-arms the last used tool
    await p.evaluate(() => [...document.querySelectorAll('.vela-dtb .vela-dtb-cell')][0].querySelector('.vela-dtb-icon').click());
    await wait(p, 200);
    const again = await p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.getTool());
    check(again === armed, `group button re-arms the last used tool (${again})`, { btnTip });
    await p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.setTool(null));
    // long press opens the flyout
    const box = await p.evaluate(() => { const r = [...document.querySelectorAll('.vela-dtb .vela-dtb-cell')][1].querySelector('.vela-dtb-icon').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.evaluate(() => { window.__lp = []; for (const t of ['pointerdown', 'pointerup', 'click']) document.addEventListener(t, (e) => window.__lp.push(t + ':' + e.isTrusted + ':' + window.STRYKER_VELA.active.chart.drawings.getTool()), true); });
    await p.mouse.move(box.x, box.y); await p.mouse.down(); await wait(p, 650);
    const lpMid = await p.evaluate(() => ({ fly: !!document.querySelector('.vela-dtb-flyout'), tool: window.STRYKER_VELA.active.chart.drawings.getTool() }));
    await p.mouse.up(); await wait(p, 200);
    const lp = await p.evaluate(() => ({ fly: !!document.querySelector('.vela-dtb-flyout'), tool: window.STRYKER_VELA.active.chart.drawings.getTool(), log: window.__lp }));
    lp.mid = lpMid; lp.box = box;
    check(lp.fly && !lp.tool, 'long press on a group button opens its flyout (does not arm)', lp);
    await p.mouse.click(w / 2, h / 2); await wait(p, 200);

    // drawings: add 2, lock all / hide all / trash
    const n0 = await p.evaluate(() => {
      const ch = window.STRYKER_VELA.active.chart; const r = ch.getVisibleRange(); const bars = ch.drawings.all().length;
      const mid = (r.from + r.to) / 2; const span = r.to - r.from;
      ch.drawings.add('hline', { anchors: [{ time: mid, price: 30000 }] });
      ch.drawings.add('trendline', { anchors: [{ time: mid - span / 4, price: 29900 }, { time: mid, price: 30100 }] });
      return ch.drawings.all().length - bars;
    });
    check(n0 === 2, `two test drawings added (${n0})`);
    const all = () => p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.all().map((d) => ({ l: !!d.locked, v: d.visible !== false })));
    await p.click('.stkt-lock'); await wait(p, 200);
    let d = await all();
    check(d.length && d.every((x) => x.l), 'Lock all locks every drawing', d);
    await p.click('.stkt-lock'); await wait(p, 200);
    d = await all();
    check(d.every((x) => !x.l), 'Unlock all unlocks them again', d);
    await p.click('.stkt-hide'); await wait(p, 200);
    d = await all();
    check(d.every((x) => !x.v), 'Hide all hides every drawing', d);
    await p.screenshot({ path: `${OUT}/tvbars-${tag}-hidden.png` });
    await p.click('.stkt-hide'); await wait(p, 200);
    d = await all();
    check(d.every((x) => x.v), 'Show all shows them again', d);
    await p.click('.stkt-trash .vela-dtb-arrow'); await wait(p, 250);
    const tm = await p.evaluate(() => [...document.querySelectorAll('.stkt-fly .stkt-fly-i')].map((i) => i.textContent));
    check(tm.some((t) => /Remove 2 drawings/.test(t)), 'trash ▸ menu offers "Remove 2 drawings"', tm);
    await p.click('.stkt-fly .stkt-fly-i'); await wait(p, 250);
    d = await all();
    check(d.length === 0, 'Remove drawings clears the chart', d);
    await p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.undo()); await wait(p, 200);
    d = await all();
    check(d.length === 2, 'one undo brings both back', d);
    // zoom
    const span = () => p.evaluate(() => { const r = window.STRYKER_VELA.active.chart.getVisibleRange(); return r.to - r.from; });
    const s0 = await span();
    await p.click('.stkt-zoom .vela-dtb-icon'); await wait(p, 300);
    const s1 = await span();
    check(s1 < s0, `zoom in narrows the visible range (${s0} -> ${s1})`);
    // right bar toggles
    for (const lab of ['Watchlist', 'Data window', 'Object tree']) {
      const sel = `.stkw-rail button[aria-label="${lab}"]`;
      const before = await p.evaluate(() => Math.round(document.querySelector('#vela-chart .vela-ws-grid').getBoundingClientRect().width));
      await p.click(sel); await wait(p, 450);
      const after = await p.evaluate(() => Math.round(document.querySelector('#vela-chart .vela-ws-grid').getBoundingClientRect().width));
      check(after < before, `right bar "${lab}" opens its panel (chart ${before} -> ${after}px)`);
      if (lab === 'Object tree') await p.screenshot({ path: `${OUT}/tvbars-${tag}-objtree.png` });
      await p.click(sel); await wait(p, 450);
    }
    // collapse
    await p.click('.vela-dtb-collapse'); await wait(p, 300);
    const cw = await p.evaluate(() => Math.round(document.querySelector('.vela-dtb').getBoundingClientRect().width));
    check(cw <= 20, `collapse « shrinks the column (${cw}px)`);
    await p.click('.vela-dtb-collapse'); await wait(p, 300);
    const ew = await p.evaluate(() => Math.round(document.querySelector('.vela-dtb').getBoundingClientRect().width));
    check(ew >= 40, `expand » restores it (${ew}px)`);
    // fullscreen button present (headless cannot always enter fullscreen)
    check(await p.evaluate(() => !!document.getElementById('stkc-fs-btn')), 'fullscreen button present');
  }
  check(!errors.length, `${tag}: no console errors`, errors.slice(0, 3));
  await ctx.close();
}

async function phone(b) {
  const { ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true });
  await topRow(p, 390, '390');
  const r = await p.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return !!(e && e.getClientRects().length && e.getBoundingClientRect().width > 0 && !e.closest('#stkc-more-pop')); };
    const col = document.querySelector('.vela-dtb');
    return { sym: vis('#stkc-bar .vela-mb-symbol'), tf: vis('#stkc-bar .vela-mb-tf'), ind: vis('#stkc-bar .vela-mb-indicators'), pen: vis('#stkc-bar .vela-mb-drawings'), more: vis('#stkc-more-btn'),
      col: !!(col && col.getBoundingClientRect().width > 0), bottom: !!document.querySelector('#vela-chart .vela-mobilebar') };
  });
  check(r.sym && r.tf && r.ind && r.pen && r.more, '390: slim top row has symbol, interval, Indicators, pencil, ⋯', r);
  check(!r.col && !r.bottom, '390: no left column, no second (bottom) bar on the chart', r);
  await p.screenshot({ path: `${OUT}/tvbars-390.png` });
  console.log('screenshot', `${OUT}/tvbars-390.png`);
  await p.click('#stkc-bar .vela-mb-drawings'); await wait(p, 600);
  const sh = await p.evaluate(() => { const tabs = [...document.querySelectorAll('.vela-dd-tab')].filter((t) => t.getClientRects().length).map((t) => t.textContent); const l = document.querySelector('.vela-dd-list'); return { tabs, rows: l ? l.children.length : 0, sw: document.documentElement.scrollWidth }; });
  check(sh.tabs.length >= 5 && sh.rows > 0 && sh.sw <= 391, '390: pencil opens the drawings sheet with group tabs', sh);
  await p.screenshot({ path: `${OUT}/tvbars-390-sheet.png` });
  console.log('screenshot', `${OUT}/tvbars-390-sheet.png`);
  await p.keyboard.press('Escape'); await wait(p, 300);
  await p.click('#stkc-more-btn'); await wait(p, 300);
  const mp = await p.evaluate(() => { const r = document.getElementById('stkc-more-pop').getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), n: document.querySelectorAll('#stkc-more-pop > *').length }; });
  check(mp.l >= 0 && mp.r <= 390 && mp.n > 0, '390: ⋯ More opens inside the screen', mp);
  await p.screenshot({ path: `${OUT}/tvbars-390-more.png` });
  console.log('screenshot', `${OUT}/tvbars-390-more.png`);
  check(!errors.length, '390: no console errors', errors.slice(0, 3));
  await ctx.close();
}

(async () => {
  const b = await launch();
  try {
    await desktop(b, 1440, 900, '1440', true);
    await desktop(b, 2560, 1300, '2560', false);
    await desktop(b, 1024, 768, '1024', false);
    await phone(b);
  } finally { await b.close(); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
