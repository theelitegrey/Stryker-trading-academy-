// INDICATOR PICKER ("Add to chart" window, assets/chart-indicator-window.js; Owner order 2026-11-15 redesign).
// Desktop 1440: opens with title + target chip, icon rail with counts, rich rows; search "gamma" finds the GEX
// tools with highlighted matches and a typo ("gama levls") still finds GEX Levels; Enter adds the highlighted row;
// multi-select two rows and "Add 2" adds both; Shift+Enter adds and opens the settings dialog; F stars a row and
// the favourite survives a reload (signed-out localStorage, the same stryker_chart_favs data as before); the
// details pane shows Works on + Inputs + the /indicators/<slug> link; every built-in row still adds (no regressions);
// the community notice still shows on Community > Top. Phone 390: tapping a row opens the bottom sheet, its Add
// button adds, Escape closes the sheet first. Fixture bars, no network.
//   node tools/tests/chart-dev-server.mjs 8066
//   CHART_BASE=http://127.0.0.1:8066 tools/chrome-slot.sh node tools/tests/chart-indpicker-browser.js
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8066';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };

const MIN = Math.floor(Date.now() / 60000), N = 600;
const price = (m) => 28650 + Math.sin((m - MIN) / 17) * 40 + Math.sin((m - MIN) / 5) * 9;
const rows = []; for (let m = MIN - N; m < MIN; m++) { const o = price(m), c = price(m + 1); rows.push([m * 60, o, Math.max(o, c) + 3, Math.min(o, c) - 3, c, 500]); }

async function page(ctx) {
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_PINE && window.StrykerIndicatorWindow, null, { timeout: 90000 });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 100) break; } });
  // signed out: favourites live in localStorage (the same data the old window kept)
  await p.evaluate(() => { try { const a = firebase.auth(); Object.defineProperty(a, 'currentUser', { get: () => null, configurable: true }); } catch (e) {} });
  await sleep(600);
  return { p, errors };
}
async function ctxFor(b, w, h, mobile) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page: 0, bars: rows }) }));
  return ctx;
}
const openWin = async (p) => { await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await p.waitForSelector('.stkiw-row', { timeout: 15000 }); await sleep(300); };
const types = (p) => p.evaluate(() => window.STRYKER_VELA.chart.indicators().map((x) => x.nativeType || x.name || 'script'));
const count = (p) => p.evaluate(() => window.STRYKER_VELA.chart.indicators().length);
const search = async (p, q) => { await p.fill('.stkiw-search', q); await sleep(250); };

(async () => {
  const b = await launch();
  try {
    // ---------------- desktop ----------------
    const ctx = await ctxFor(b, 1440, 900);
    let { p, errors } = await page(ctx);
    await p.evaluate(() => localStorage.removeItem('stryker_chart_favs'));
    await openWin(p);
    const head = await p.evaluate(() => ({
      title: document.querySelector('.stkiw-hd h2').textContent, chip: document.querySelector('.stkiw-ctx').textContent,
      ph: document.querySelector('.stkiw-search').placeholder,
      rail: [...document.querySelectorAll('.stkiw-side .stkiw-tab')].map((t) => [t.dataset.k, !!t.querySelector('svg'), t.querySelector('.stkiw-rc').textContent]),
      thumbs: [...document.querySelectorAll('.stkiw-row .stkiw-thumb')].filter((t) => t.querySelector(':scope > img, :scope > svg')).length, rowsN: document.querySelectorAll('.stkiw-row').length,
      oldTable: !!document.querySelector('.stkiw-cols, .stkiw-c-auth'), oldTitle: /Indicators, metrics/.test(document.querySelector('.stkiw-card').textContent),
      detail: !!document.querySelector('.stkiw-detail h3'), foot: document.querySelector('.stkiw-foot').textContent }));
    check(head.title === 'Add to chart' && /NQ\s·\s1m/.test(head.chip), 'title "Add to chart" + target chip', [head.title, head.chip]);
    check(/^Search \d+\+ indicators, or describe/.test(head.ph), 'search placeholder with live count', head.ph);
    const railKeys = head.rail.map((r) => r[0]);
    check(['fav', 'onchart', 'orderflow', 'gex', 'volume', 'trend', 'momentum', 'volatility', 'levels', 'community'].every((k) => railKeys.includes(k)) && head.rail.every((r) => r[1]), 'rail has every group, each with an icon', railKeys);
    check(head.rail.filter((r) => /^\d+$/.test(r[2])).length >= 8, 'rail shows counts', head.rail.map((r) => r[2]));
    check(head.rowsN > 100 && head.thumbs === head.rowsN, 'every row has a preview thumbnail', [head.rowsN, head.thumbs]);
    check(!head.oldTable && !head.oldTitle, 'no TradingView-style table / title left');
    check(head.detail, 'details pane shows the highlighted indicator');
    check(/Publish or manage community scripts/.test(head.foot) && /Education only\. Not financial advice\./.test(head.foot), 'footer keeps community link + education note');

    // search "gamma": GEX tools first, matches highlighted; a typo still finds GEX Levels
    await search(p, 'gamma');
    const g = await p.evaluate(() => ({ names: [...document.querySelectorAll('.stkiw-row .stkiw-nm')].slice(0, 6).map((n) => n.textContent), marks: document.querySelectorAll('.stkiw-row mark').length,
      keys: [...document.querySelectorAll('.stkiw-row')].map((r) => r.dataset.key) }));
    check(g.keys.includes('b:stk_gex') && g.keys.includes('b:stk_gexheat') && g.marks > 0, 'search "gamma" finds GEX Levels + heatmap, highlighted', g.names);
    await search(p, 'gama levls');
    const ty = await p.evaluate(() => [...document.querySelectorAll('.stkiw-row')].slice(0, 5).map((r) => r.dataset.key));
    check(ty.includes('b:stk_gex'), 'typo "gama levls" still finds GEX Levels', ty);
    await search(p, 'volume spikes');
    const vs = await p.evaluate(() => [...document.querySelectorAll('.stkiw-row .stkiw-nm')].slice(0, 5).map((n) => n.textContent));
    check(vs.length > 0, 'plain-language "volume spikes" returns results', vs);

    // Enter adds the highlighted row (search VWAP)
    await search(p, 'vwap');
    const hi = await p.evaluate(() => document.querySelector('.stkiw-row.is-hi') && document.querySelector('.stkiw-row.is-hi').dataset.key);
    let n0 = await count(p);
    await p.keyboard.press('Enter'); await sleep(1200);
    check(await count(p) === n0 + 1, 'Enter adds the highlighted row', hi);
    check(await p.evaluate(() => !!document.querySelector('.stkiw-ov')), 'window stays open after a desktop add');

    // multi-select two rows -> "Add 2"
    await search(p, 'rsi');
    const ks = await p.evaluate(() => [...document.querySelectorAll('.stkiw-row')].filter((r) => r.querySelector('.stkiw-chk') && r.dataset.key.startsWith('b:')).slice(0, 1).map((r) => r.dataset.key));
    await p.hover('.stkiw-row[data-key="' + ks[0] + '"]'); await p.click('.stkiw-row[data-key="' + ks[0] + '"] .stkiw-chk');
    await search(p, 'macd');
    const k2 = await p.evaluate(() => [...document.querySelectorAll('.stkiw-row')].find((r) => r.querySelector('.stkiw-chk') && r.dataset.key.startsWith('b:')).dataset.key);
    await p.hover('.stkiw-row[data-key="' + k2 + '"]'); await p.click('.stkiw-row[data-key="' + k2 + '"] .stkiw-chk');
    const bar = await p.evaluate(() => ({ shown: !document.querySelector('.stkiw-selbar').hidden, label: document.querySelector('.stkiw-addsel').textContent }));
    check(bar.shown && bar.label === 'Add 2', 'selection bar shows "Add 2"', bar);
    n0 = await count(p);
    await p.click('.stkiw-addsel'); await sleep(2000);
    check(await count(p) === n0 + 2, 'Add 2 adds both indicators', [ks[0], k2]);
    check(await p.evaluate(() => document.querySelector('.stkiw-selbar').hidden), 'selection clears after adding');

    // details pane: Works on, inputs, guide link
    await search(p, 'gex levels');
    await p.hover('.stkiw-row[data-key="b:stk_gex"]'); await sleep(200);
    const det = await p.evaluate(() => { const d = document.querySelector('.stkiw-detail'); return { t: d.querySelector('h3').textContent, h4: [...d.querySelectorAll('h4')].map((x) => x.textContent), href: (d.querySelector('a[href^="/indicators/"]') || {}).getAttribute && d.querySelector('a[href^="/indicators/"]').getAttribute('href'), mk: [...d.querySelectorAll('.stkiw-mk')].map((x) => x.textContent) }; });
    check(/^(GEX|Zoro) Levels$/.test(det.t) && det.h4.includes('Works on') && det.h4.includes('Inputs') && /^\/indicators\/gex-levels/.test(det.href || ''), 'details: Works on, Inputs and the guide link', det);

    // F favourites the highlighted row; it persists across a reload
    await p.focus('.stkiw-row[data-key="b:stk_gex"]');
    await p.evaluate(() => document.querySelector('.stkiw-row[data-key="b:stk_gex"]').focus());
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowUp');
    const hk = await p.evaluate(() => document.querySelector('.stkiw-row.is-hi').dataset.key);
    await p.keyboard.press('f'); await sleep(300);
    const ls = await p.evaluate(() => JSON.parse(localStorage.getItem('stryker_chart_favs') || '[]'));
    check(ls.some((x) => x.key === hk), 'F stars the highlighted row (saved in stryker_chart_favs)', [hk, ls]);

    // Shift+Enter adds and opens its settings
    await search(p, 'obv');
    n0 = await count(p);
    await p.keyboard.press('Shift+Enter'); await sleep(2500);
    const set = await p.evaluate(() => ({ closed: !document.querySelector('.stkiw-ov'), dialog: !!document.querySelector('[role="dialog"]:not(.stkiw-card), .vela-modal, .vela-dialog, .vela-settings, [class*="settings"][class*="modal"], [class*="Settings"]') }));
    check(await count(p) === n0 + 1 && set.closed && set.dialog, 'Shift+Enter adds and opens its settings', set);
    await p.keyboard.press('Escape'); await sleep(300);

    // every built-in row still adds (fresh page so the chart stays light)
    await p.reload(); ({ p } = { p }); await p.waitForFunction(() => window.__stkHeavyReady && window.StrykerIndicatorWindow, null, { timeout: 90000 });
    await p.evaluate(() => { try { const a = firebase.auth(); Object.defineProperty(a, 'currentUser', { get: () => null, configurable: true }); } catch (e) {} });
    await sleep(800);
    await openWin(p);
    const favRow = await p.evaluate(async (k) => { document.querySelector('.stkiw-tab[data-k="fav"]').click(); await new Promise((r) => setTimeout(r, 300)); return [...document.querySelectorAll('.stkiw-row')].map((r) => r.dataset.key).includes(k); }, hk);
    check(favRow, 'favourite persists after a reload (Favourites tab)', hk);
    const recent = await p.evaluate(async () => { document.querySelector('.stkiw-tab[data-k="all"]').click(); await new Promise((r) => setTimeout(r, 300)); return document.querySelector('.stkiw-list .stkiw-grp').textContent; });
    check(/Recently used/.test(recent), 'Recently used heads the list with no query', recent);
    // community notice on Community > Top
    const cn = await p.evaluate(async () => { document.querySelector('.stkiw-tab[data-k="community"]').click(); await new Promise((r) => setTimeout(r, 500)); return { note: !!document.querySelector('.stkiw-list .stkcd-note'), sub: !!document.querySelector('.stkiw-ctab[data-k="top"][aria-selected="true"]') }; });
    check(cn.note && cn.sub, 'Community > Top shows the community notice', cn);
    const all = await p.evaluate(async () => {
      const iw = window.StrykerIndicatorWindow, ws = window.STRYKER_VELA, bad = [];
      const keys = ws.active.libraryRows().filter((r) => r && r.native && r.category !== 'Community' && !r.hidden).map((r) => 'b:' + r.nativeType);
      for (const k of keys) {
        if (ws.chart.indicators().some((h) => 'b:' + h.nativeType === k)) continue;   // one-per-chart types already on it (Volume, ...)
        const before = ws.chart.indicators().length;
        const ok = await Promise.race([iw.addByKey(k), new Promise((r) => setTimeout(() => r('timeout'), 8000))]);
        await new Promise((r) => setTimeout(r, 60));
        const after = ws.chart.indicators();
        if (ok !== true || after.length !== before + 1) { if (!document.querySelector('.stk-pro-gate, .stkpg-ov, [class*="upgrade"]')) bad.push([k, ok, after.length - before]); document.querySelectorAll('.stk-pro-gate, .stkpg-ov').forEach((n) => n.remove()); }
        else { try { after[after.length - 1].remove(); } catch (e) {} }
      }
      return { n: keys.length, bad, skipped: keys.filter((k) => ws.chart.indicators().some((h) => 'b:' + h.nativeType === k)) };
    });
    check(all.n > 100 && all.bad.length === 0, 'every built-in indicator still adds (' + all.n + ', already on the chart: ' + all.skipped.join(' ') + ')', all.bad);
    check(errors.length === 0, 'no page errors (desktop)', errors);
    await ctx.close();

    // ---------------- phone 390 ----------------
    const pc = await ctxFor(b, 390, 844, true);
    const ph = await page(pc);
    p = ph.p;
    await openWin(p);
    const ov = await p.evaluate(() => ({ w: document.documentElement.scrollWidth, card: document.querySelector('.stkiw-card').getBoundingClientRect().width, det: getComputedStyle(document.querySelector('.stkiw-detail')).display }));
    check(ov.w <= 390 && ov.card === 390 && ov.det === 'none', 'phone: full-screen, no detail column, no side scroll', ov);
    await search(p, 'gamma');
    await p.tap('.stkiw-row[data-key="b:stk_gex"] .stkiw-name'); await sleep(500);
    const sh = await p.evaluate(() => { const s = document.querySelector('.stkiw-sheet'); const c = s.querySelector('.stkiw-sheet-card').getBoundingClientRect(); return { open: !s.hidden, t: s.querySelector('h3').textContent, bottom: Math.round(c.bottom), add: !!s.querySelector('.stkiw-d-add') }; });
    check(sh.open && /^(GEX|Zoro) Levels$/.test(sh.t) && sh.bottom === 844 && sh.add, 'phone: tapping a row opens the bottom sheet', sh);
    await p.keyboard.press('Escape'); await sleep(200);
    check(await p.evaluate(() => document.querySelector('.stkiw-sheet').hidden && !!document.querySelector('.stkiw-ov')), 'phone: Escape closes the sheet first');
    await p.tap('.stkiw-row[data-key="b:stk_gex"] .stkiw-name'); await sleep(400);
    n0 = await count(p);
    await p.tap('.stkiw-sheet .stkiw-d-add'); await sleep(1500);
    check(await count(p) === n0 + 1, 'phone: Add in the sheet adds it');
    const tap = await p.evaluate(() => { document.querySelector('.stkiw-search').value = ''; document.querySelector('.stkiw-search').dispatchEvent(new Event('input')); const r = document.querySelector('.stkiw-row .stkiw-add').getBoundingClientRect(); const s = document.querySelector('.stkiw-row .stkiw-star').getBoundingClientRect(); return [r.width, r.height, s.width, s.height]; });
    check(tap.every((x) => x >= 40), 'phone: Add and star targets >= 40px', tap);
    check(ph.errors.length === 0, 'no page errors (phone)', ph.errors);
    await pc.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
