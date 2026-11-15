// Charts SYMBOL SEARCH panel (assets/chart-search.js), real keys / clicks / taps on the chart page:
//   1440 desktop: Ctrl+K opens it (and "/"), open < 100 ms, type NQ -> NQ1! row with highlighted letters, keystroke < 50 ms,
//   arrow keys move the highlight, the right pane lists contract months (FRONT / FUT), Enter opens -> the chart symbol changes;
//   the star saves a favourite that is still there after a reload (and shows under Favourites on an empty query),
//   the picked symbol shows under Recent, Esc closes, the toolbar symbol button opens the same panel, a ratio row (ES/NQ)
//   opens a formula chart, category tabs + exchange filter, light theme.
//   390 phone: full-screen sheet, tabs scroll sideways, Filters button opens the rail sheet, a tap on a row opens it.
// Offline: exchanges get the small mocked symbol lists, the page itself is the speed server.
//   node tools/tests/chart-speed-server.mjs 8291 &
//   CHART_BASE=http://127.0.0.1:8291 node tools/tests/chart-search-browser.js [shotsDir]
const fs = require('fs');
const { launch } = require('./lib.js');
const { speedInit } = require('./chart-phone-speed-init.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8291';
const OUT = process.argv[2];
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const BIN_SPOT = { symbols: ['BTC', 'ETH', 'SOL'].flatMap((b) => ['USDT', 'USDC', 'BTC'].filter((q) => q !== b).map((q) => ({ symbol: b + q, status: 'TRADING', baseAsset: b, quoteAsset: q, filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }] }))) };
const BIN_FUT = { symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', contractType: 'PERPETUAL', baseAsset: 'BTC', quoteAsset: 'USDT', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] }] };
const SYMINFO = { v: 1, t: 0, syms: { NQ: { kind: 'fut', name: 'E-mini Nasdaq-100 Futures', ex: 'CME', tick: 0.25, pv: 20, roll: [{ c: 'NQZ2026', d: '20261218' }, { c: 'NQH2027', d: '20270319' }, { c: 'NQM2027', d: '20270617' }] } } };

async function context(b, w, h, mobile, theme) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' : undefined });
  await speedInit(ctx);
  // the stub's Firestore forgets writes: back students/{uid}/chartFavorites with localStorage so a reload sees them
  await ctx.addInitScript(() => {
    const D = window.__stubDb; if (!D) return;
    const K = '__fake_chartFavorites', all = () => JSON.parse(localStorage.getItem(K) || '{}'), save = (o) => localStorage.setItem(K, JSON.stringify(o));
    const favCol = { limit: () => favCol, get: () => Promise.resolve({ forEach: (f) => Object.entries(all()).forEach(([id, v]) => f({ id, data: () => v })) }),
      doc: (id) => ({ set: (v) => { const o = all(); o[id] = Object.assign({}, v, { at: 1 }); save(o); return Promise.resolve(); }, delete: () => { const o = all(); delete o[id]; save(o); return Promise.resolve(); } }) };
    const c0 = D.collection;
    D.collection = (name) => { const c = c0(name); if (name !== 'students') return c; const d0 = c.doc; c.doc = (id) => { const d = d0(id); const s0 = d.collection; d.collection = (sub) => (sub === 'chartFavorites' ? favCol : s0(sub)); return d; }; return c; };
  });
  if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t); localStorage.setItem('theme', t); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/^https:\/\/(api\.binance\.com|fapi\.binance\.com|api\.binance\.us|api\.hyperliquid\.xyz|api\.exchange\.coinbase\.com)\//, (r) => {
    const u = r.request().url();
    if (/\/ping/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (/fapi\/v1\/exchangeInfo/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BIN_FUT) });
    if (/exchangeInfo/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BIN_SPOT) });
    if (/coinbase/.test(u) && /products$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'BTC-USD', base_currency: 'BTC', quote_currency: 'USD', status: 'online', trading_disabled: false, quote_increment: '0.01' }]) });
    return r.abort();
  });
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/scan\?part=syminfo/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SYMINFO) }));
  // stocks: the server search (assets/chart-stocks-provider.js installStockSearch) knows a stock the page does not
  await ctx.addInitScript(() => { window.__STK_BOOK_RECORDER = 'https://sk.fixture.test'; });
  await ctx.route(/^https:\/\/sk\.fixture\.test\/sk-search/, (r) => { const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization', 'content-type': 'application/json' }; if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: h }); return r.fulfill({ status: 200, headers: h, body: JSON.stringify({ r: [{ code: 'NSE:RELIANCE', description: 'Reliance Industries', type: 'stock', exchange: 'NSE', country: 'IN' }] }) }); });
  await ctx.route(/\/api\/vest\/exchangeInfo/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(__dirname + '/fixtures/vest/exchangeInfo.json', 'utf8') }));
  return ctx;
}
async function boot(ctx, errors) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkSearch && document.querySelector('.vela-widget-symbol, .vela-mb-symbol'), null, { timeout: 60000 });
  await sleep(2500);
  return p;
}
const state = (p) => p.evaluate(() => {
  const r = document.querySelector('.stkss');
  const rows = [...document.querySelectorAll('.stkss-row')].map((e) => ({ sym: e.dataset.sym, tk: e.querySelector('.stkss-tk').textContent, mark: (e.querySelector('.stkss-tk mark') || {}).textContent || '', sel: e.getAttribute('aria-selected') === 'true' }));
  return { open: !!r && !r.hidden, rows, groups: [...document.querySelectorAll('.stkss-gh')].map((e) => e.textContent), sym: window.STRYKER_VELA.active.symbol, focus: document.activeElement && document.activeElement.className, perf: window.__stkSearchPerf || {} };
});

(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600'] });
  // ---------------- desktop 1440, dark ----------------
  {
    const errors = [];
    const ctx = await context(b, 1440, 900, false);
    let p = await boot(ctx, errors);
    await p.evaluate(() => { localStorage.removeItem('tz_sym_favs'); localStorage.removeItem('tz_sym_recent'); });
    await sleep(3000);   // the panel pre-builds at idle after the chart is up
    await p.mouse.click(700, 500);   // focus on the chart, not a field
    await p.keyboard.press('Control+k'); await sleep(400);
    let s = await state(p);
    check(s.open, '1440: Ctrl+K opens the search');
    check(/stkss-input/.test(s.focus), '1440: the search field has focus', s.focus);
    check(s.perf.open < 100 && s.perf.paint < 150, '1440: open < 100 ms (first frame painted < 150 ms)', s.perf);
    check(s.groups.includes('Popular'), '1440: empty query shows Popular', s.groups);
    await sleep(2500);   // the crypto lists (released by the key press) land and the open panel repaints
    check(await p.evaluate(() => !!document.querySelector('.stkss-row[data-sym="binance:BTCUSDT"]')), '1440: Popular includes BTC once the crypto lists land');
    if (OUT) await p.screenshot({ path: OUT + '/1440-dark-empty.png' });
    await p.keyboard.type('NQ', { delay: 80 }); await sleep(500);
    s = await state(p);
    check(s.rows[0] && s.rows[0].tk === 'NQ1!', '1440: "NQ" ranks NQ1! first', s.rows.slice(0, 4));
    check(s.rows[0] && s.rows[0].mark === 'NQ', '1440: matched letters highlighted', s.rows[0]);
    check(s.perf.keyMax < 50, '1440: keystroke < 50 ms', s.perf);
    await sleep(1200);
    const side = await p.evaluate(() => ({ t: (document.querySelector('.stkss-shead-t') || {}).textContent, rows: [...document.querySelectorAll('.stkss-side .stkss-srow')].map((e) => e.textContent) }));
    check(side.t === 'NQ' && side.rows.some((x) => /FRONT/.test(x) && /FUT/.test(x) && /Dec 2026/.test(x)), '1440: right pane lists contract months with FRONT / FUT', side);
    if (OUT) await p.screenshot({ path: OUT + '/1440-dark-nq.png' });
    // star NQ1! (favourite)
    await p.click('.stkss-row[data-i="0"] .stkss-star'); await sleep(300);
    check(await p.evaluate(() => window.__stkSearch.favs().includes('CME:NQ1!')), '1440: star saves NQ1! as a favourite');
    // arrow down then up, Enter opens the highlighted row
    await p.keyboard.press('ArrowDown'); await sleep(100);
    s = await state(p);
    check(s.rows[1] && s.rows[1].sel, '1440: ArrowDown moves the highlight', s.rows.slice(0, 3));
    await p.keyboard.press('ArrowUp'); await p.keyboard.press('Enter'); await sleep(1500);
    s = await state(p);
    check(!s.open && /NQ1!$/.test(s.sym), '1440: Enter opens NQ1! on the chart', s.sym);
    // "/" opens, Esc closes
    await p.mouse.click(700, 500); await p.keyboard.press('/'); await sleep(300);
    s = await state(p);
    check(s.open && s.groups.includes('Recent') && s.groups.includes('Favourites'), '1440: "/" opens, Favourites + Recent listed', s.groups);
    await p.keyboard.press('Escape'); await sleep(300);
    check(!(await state(p)).open, '1440: Esc closes');
    // ratio ES/NQ opens a formula chart
    await p.keyboard.press('Control+k'); await sleep(200);
    await p.keyboard.type('EUR/USD', { delay: 40 }); await sleep(400);
    s = await state(p);
    check(s.rows[0] && s.rows[0].sym === 'FX:EURUSD', '1440: "EUR/USD" is the forex pair, not a ratio', s.rows.slice(0, 2));
    await p.fill('.stkss-input', ''); await p.keyboard.type('ES/NQ', { delay: 40 }); await sleep(400);
    s = await state(p);
    check(s.rows.length === 1 && /^formula:/.test(s.rows[0].sym), '1440: "ES/NQ" offers a ratio row', s.rows);
    if (OUT) await p.screenshot({ path: OUT + '/1440-dark-ratio.png' });
    await p.keyboard.press('Enter'); await sleep(1500);
    s = await state(p);
    check(/^formula:/i.test(s.sym), '1440: the ratio opens on the chart', s.sym);
    // tabs + exchange filter
    await p.keyboard.press('Control+k'); await sleep(200);
    await p.click('.stkss-tab[data-tab="crypto"]'); await sleep(300);
    s = await state(p);
    check(s.rows.length && s.rows.every((r) => /^(binance|coinbase|hyperliquid|bybit|okx|bitget|kraken|vest):/i.test(r.sym)), '1440: Crypto tab lists crypto only', s.rows.slice(0, 3).map((r) => r.sym));
    const tabsShown = await p.evaluate(() => [...document.querySelectorAll('.stkss-tab')].map((e) => e.textContent));
    check(tabsShown[0] === 'All' && tabsShown.includes('Futures') && !tabsShown.includes('Options'), '1440: only categories with data', tabsShown);
    await p.keyboard.type('BTC'); await sleep(800);
    const venues = await p.evaluate(() => [...document.querySelectorAll('.stkss-side .stkss-srow')].length);
    check(venues >= 2, '1440: crypto row shows its venues on the right', venues);
    if (OUT) await p.screenshot({ path: OUT + '/1440-dark-crypto.png' });
    await p.selectOption('.stkss-rail select[aria-label="Exchange"]', 'coinbase'); await sleep(300);
    s = await state(p);
    check(s.rows.length && s.rows.every((r) => /^coinbase:/i.test(r.sym)), '1440: exchange filter', s.rows.map((r) => r.sym));
    await p.keyboard.press('Escape'); await sleep(200);
    // toolbar symbol button opens the same panel
    const bb = await p.evaluate(() => { const e = document.querySelector('.vela-widget-symbol'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    if (bb) { await p.mouse.click(bb.x, bb.y); await sleep(400); check((await state(p)).open, '1440: toolbar symbol button opens the new search'); await p.keyboard.press('Escape'); }
    // bare typing on the chart seeds the search (Vela routeTyping -> symbolPicker.type)
    await p.mouse.click(700, 500); await p.keyboard.type('ETH', { delay: 60 }); await sleep(400);
    s = await state(p);
    check(s.open && (await p.inputValue('.stkss-input')) === 'ETH', '1440: typing on the chart opens search seeded', await p.inputValue('.stkss-input').catch(() => ''));
    await p.keyboard.press('Escape');
    // a stock only the server search knows appears while typing
    await p.keyboard.press('Control+k'); await sleep(200);
    await p.click('.stkss-tab[data-tab="all"]');
    await p.keyboard.type('RELIA', { delay: 60 });
    let rel = false; for (let i = 0; i < 20 && !rel; i++) { await sleep(300); rel = await p.evaluate(() => !!document.querySelector('.stkss-row[data-sym="stocks:NSE:RELIANCE"]')); }
    check(rel, '1440: stock server search result appears in the panel');
    await p.keyboard.press('Escape');
    // favourite survives a reload
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkSearch, null, { timeout: 60000 }); await sleep(1500);
    await p.mouse.click(700, 500); await p.keyboard.press('Control+k'); await sleep(300);
    s = await state(p);
    check(s.groups[0] === 'Favourites' && s.rows[0].sym === 'CME:NQ1!', '1440: favourite persists after reload', { g: s.groups, r: s.rows.slice(0, 2) });
    check(errors.length === 0, '1440: no page errors', errors);
    await ctx.close();
  }
  // ---------------- desktop 1440, light ----------------
  {
    const errors = [];
    const ctx = await context(b, 1440, 900, false, 'light');
    const p = await boot(ctx, errors);
    await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); });
    await p.mouse.click(700, 500); await p.keyboard.press('Control+k'); await sleep(200);
    await p.keyboard.type('NQ', { delay: 40 }); await sleep(1500);
    const bg = await p.evaluate(() => getComputedStyle(document.querySelector('.stkss-box')).backgroundColor);
    check(bg === 'rgb(255, 255, 255)', '1440 light: white panel', bg);
    if (OUT) await p.screenshot({ path: OUT + '/1440-light-nq.png' });
    check(errors.length === 0, '1440 light: no page errors', errors);
    await ctx.close();
  }
  // ---------------- phones ----------------
  for (const [w, h] of [[390, 844], [412, 915]]) {
    const errors = [];
    const ctx = await context(b, w, h, true);
    const p = await boot(ctx, errors);
    const bb = await p.evaluate(() => { const c = [...document.querySelectorAll('button, [role=button]')].filter((e) => e.getClientRects().length && /^\s*(NQ1!|BTCUSDT)/.test(e.textContent) && e.textContent.length < 40); c.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top); const e = c[0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    check(!!bb, w + ': symbol button found');
    if (!bb) { await ctx.close(); continue; }
    await p.touchscreen.tap(bb.x, bb.y); await sleep(700);
    const g = await p.evaluate(() => { const r = document.querySelector('.stkss-box').getBoundingClientRect(); const t = document.querySelector('.stkss-tabs'); return { phone: document.querySelector('.stkss').classList.contains('is-phone'), x: r.left, y: r.top, w: r.width, h: r.height, tabsScroll: t.scrollWidth > t.clientWidth, docW: document.documentElement.scrollWidth, filter: getComputedStyle(document.querySelector('.stkss-filter-btn')).display, rail: getComputedStyle(document.querySelector('.stkss-rail')).display }; });
    check(g.phone && g.x === 0 && g.y === 0 && g.w === w && g.h === h, w + ': full-screen sheet', g);
    check(g.filter !== 'none' && g.rail === 'none', w + ': rail collapsed into a Filters button', g);
    check(g.tabsScroll && g.docW <= w, w + ': tabs scroll sideways, no page overflow', g);
    if (OUT) await p.screenshot({ path: OUT + '/' + w + '-empty.png' });
    await p.keyboard.type('NQ', { delay: 60 }); await sleep(1200);
    if (OUT) await p.screenshot({ path: OUT + '/' + w + '-nq.png' });
    await p.touchscreen.tap(...(await p.evaluate(() => { const r = document.querySelector('.stkss-filter-btn').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }))); await sleep(400);
    check(await p.evaluate(() => getComputedStyle(document.querySelector('.stkss-rail')).display !== 'none'), w + ': Filters opens the rail sheet');
    if (OUT) await p.screenshot({ path: OUT + '/' + w + '-filters.png' });
    await p.touchscreen.tap(...(await p.evaluate(() => { const r = document.querySelector('.stkss-filter-btn').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }))); await sleep(300);
    const row = await p.evaluate(() => { const e = document.querySelector('.stkss-row[data-sym="CME:NQ1!"] .stkss-tk'); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await p.touchscreen.tap(...row); await sleep(1500);
    const s = await state(p);
    check(!s.open && /NQ1!$/.test(s.sym), w + ': tap on NQ1! opens it', s.sym);
    check(errors.length === 0, w + ': no page errors', errors);
    await ctx.close();
  }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
