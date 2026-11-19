// Live account balance + header strip P&L (Owner bug 2026-11-19 "the balance is not updated"). EVERY /connect/finatic/* call is answered
// by the local mock below (Sample data): nothing leaves 127.0.0.1, no order op is ever sent. 1440 / 390, dark + light.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-livebal-browser.js <shotsDir>
// Checks: the NEWEST balance snapshot is shown (the list starts with an older one, like the broker link's answer); "updated X min ago"
// under the balance when the snapshot is > 2 min old; a fill / position change re-reads balances + fills at once; balance = snapshot +
// realised P&L of the fills after it; strip RP&L = today's fills (net of commission), UP&L = open position x last price; the 30 s
// refresh while the strip / menu is on screen; alignment of the balance cell; no vendor name; members: no live calls (other test).
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/livebal';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 600) : '')); };
const ACC = '123e4567-e89b-12d3-a456-426614174000', US = '0aaa1111-2222-3333-4444-555566667777';
const iso = (ms) => new Date(ms).toISOString();

async function run(b, w, h, mobile, theme) {
  const tag = w + '-' + theme;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(({ t, US }) => {
    window.__off = 0;
    window.__stkLiveTest = { isAdmin: () => true, last: () => 28750, fastRetry: true, balMs: 700, now: () => Date.now() + window.__off };
    window.__stkOpTest = { q: { bid: 28749.75, ask: 28750 }, quote() { return this.q; } };
    Object.defineProperty(window, 'showToast', { configurable: true, get: () => () => Promise.resolve(), set: () => {} });
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_broker_sync_user_u1', US);
    } catch (e) {}
  }, { t: theme, US });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route('**/api/chart/bars/**', (r) => {
    const u = new URL(r.request().url()), tf = Number(u.searchParams.get('tf') || 1), P = 8 * 3600, now = Math.floor(Date.now() / 1000);
    const page = u.searchParams.has('page') ? Number(u.searchParams.get('page')) : Math.floor(now / P);
    if (!/NQ/.test(u.pathname) || tf !== 1 || page < Math.floor(now / P) - 12) return r.fulfill({ json: { bars: [] } });
    const bars = []; for (let t = page * P; t < (page + 1) * P && t <= now; t += 60) bars.push([t, 28749.5, 28751.5, 28748.5, 28750, 100]);
    return r.fulfill({ json: { s: 'NQ', tf: '1', page, bars, rt: true } });
  });
  const T0 = Date.now();
  // Sample data: three snapshots, the OLDEST first (the old code showed that one: $53,582.88)
  const M = { calls: [], positions: [], orders: [], fills: [],
    balances: [
      { balanceId: 'b1', balanceType: 'ACCOUNT', currencyCode: 'USD', cashBalance: '53582.88', netLiquidationValue: '53582.88', totalRealizedPnl: '3582.88', balanceCreatedAt: iso(T0 - 6 * 3600e3), lastUpdated: iso(T0 - 6 * 3600e3) },
      { balanceId: 'b2', balanceType: 'ACCOUNT', currencyCode: 'USD', cashBalance: '53582.88', netLiquidationValue: '53742.38', totalRealizedPnl: '3742.38', balanceCreatedAt: iso(T0 - 6 * 3600e3), lastUpdated: iso(T0 - 10 * 60e3) },
    ] };
  const j = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/connect/finatic/**', async (r) => {
    const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    M.calls.push({ path: u.pathname, op: body.op, body, at: Date.now() });
    if (u.pathname.endsWith('/session')) return r.fulfill(j({ configured: true }));
    if (u.pathname.endsWith('/data')) {
      if (body.op === 'accounts') return r.fulfill(j({ userId: US, data: [{ accountId: ACC, accountName: 'DEMO 5551234', accountNumber: 'DEMO5551234', brokerName: 'tradovate', currency: 'USD' }] }));
      if (body.op === 'live') return r.fulfill(j({ data: { positions: M.positions, orders: M.orders } }));
      if (body.op === 'balances') return r.fulfill(j({ data: M.balances }));
      if (body.op === 'fills') return r.fulfill(j({ data: M.fills.filter((f) => body.orderIds.includes(f.orderId)) }));
      return r.fulfill(j({ data: [] }));
    }
    if (u.pathname.endsWith('/order')) {
      if (body.op === 'env') return r.fulfill(j({ env: 'live', enabled: true }));
      if (body.op === 'bracket') return r.fulfill(j({ ok: true, group: null, did: 'none' }));   // SL/TP sync read (the server mock: nothing to do)
      if (body.op === 'schema') return r.fulfill(j({ data: { fields: { symbol: {}, orderQty: {} } }, env: 'live' }));
      M.calls.push({ WRITE: body.op });   // never expected
      if (process.env.DBG) console.log('DBG order op', JSON.stringify(body).slice(0, 200));
      return r.fulfill(j({ error: 'Not allowed in this test' }, 400));
    }
    return r.fulfill(j({ error: 'Not allowed' }, 400));
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource|Ping received|Unexpected response code|WebSocket/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper, null, { timeout: 60000 });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === 'futures:NQ1!') break; } });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.pick && window.__stkLive.state.accounts.length, null, { timeout: 20000 });
  const wait = (fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 10000 }).then(() => true, () => false);
  const strip = () => p.evaluate(() => { const s = document.getElementById('stkas'); const q = (k) => { const i = s && s.querySelector('[data-k=' + k + ']'); return i ? { t: i.querySelector('.stkas-v').textContent, c: i.querySelector('.stkas-v').className, tip: i.title } : null; }; return s && !s.hidden ? { bal: q('bal'), rp: q('rp'), up: q('up'), pop: [...s.querySelectorAll('.stkas-pop > *')].map((e) => e.textContent) } : null; });
  const openMenu = async () => { await p.evaluate(() => window.__stkPaper.openTradeMenu()); await p.waitForSelector('#stkc-trade-pop:not([hidden]) .stktm-pick', { timeout: 5000 }); };
  const menuBal = () => p.evaluate((id) => { const c = document.querySelector('#stkc-trade-pop [data-bal="' + id + '"]'); return c ? { v: c.querySelector('.stktm-bv').textContent, age: (c.querySelector('.stktm-age') || {}).textContent || '', tip: c.title } : null; }, ACC);
  const n = (op) => M.calls.filter((c) => c.op === op).length;

  // ---- pick the live account (Trade menu row)
  await openMenu();
  await p.evaluate((id) => document.querySelector('#stkc-trade-pop [data-a=live][data-id="' + id + '"]').click(), ACC);
  await wait(() => window.__stkLive.state.acct && window.__stkLive.state.lastOkStart > 0);
  // A: newest snapshot, its age; no fills today; flat
  check(await wait(() => { const s = document.getElementById('stkas'); return s && !s.hidden && /53,742\.38/.test(s.querySelector('[data-k=bal] .stkas-v').textContent); }), tag + ': strip Bal = the NEWEST snapshot $53,742.38 (not the first row $53,582.88)', await strip());
  let s = await strip();
  check(/updated 10 min ago/.test(s.bal.tip), tag + ': Bal tooltip says "updated 10 min ago"', s.bal);
  check(s.rp.t.replace(/\s/g, '') === '$0.00' && s.up.t.replace(/\s/g, '') === '$--', tag + ': RP&L $0.00 (no fills today), UP&L $ -- (flat, like paper)', s);
  await openMenu();
  check(await wait((id) => { const c = document.querySelector('#stkc-trade-pop [data-bal="' + id + '"] .stktm-age'); return c && /updated 10 min ago/.test(c.textContent); }, ACC), tag + ': Trade menu shows "updated 10 min ago" under the balance', await menuBal());
  let mb = await menuBal();
  check(mb.v === '$53,742.38', tag + ': Trade menu balance = newest snapshot', mb);
  check(!(await p.evaluate(() => /delayed|real.?time|finatic/i.test(document.getElementById('stkc-trade-pop').innerText))), tag + ': no "delayed" / "real-time" / vendor wording');
  // alignment: balance cell: label, amount, age right-aligned on one right edge, tabular digits, nothing clipped
  const al = await p.evaluate((id) => {
    const c = document.querySelector('#stkc-trade-pop [data-bal="' + id + '"]'), row = c.closest('.stktm-row') || c.parentElement;
    const r = (e) => e.getBoundingClientRect(), k = c.querySelector('.stktm-bk'), v = c.querySelector('.stktm-bv'), a = c.querySelector('.stktm-age');
    const clip = [k, v, a].filter(Boolean).some((e) => e.scrollWidth > e.clientWidth + 1);
    const tr = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); return rg.getBoundingClientRect().right; };
    return { rights: [k, v, a].map((e) => Math.round(tr(e))), clip, tab: getComputedStyle(v).fontVariantNumeric, inRow: r(c).top >= r(row).top - 0.5 && r(c).bottom <= r(row).bottom + 0.5, ageColor: getComputedStyle(a).color, vColor: getComputedStyle(v).color, hscroll: document.documentElement.scrollWidth > innerWidth };
  }, ACC);
  const rs = al.rights, spread = Math.max(...rs) - Math.min(...rs);
  check(!al.clip && al.inRow && /tabular-nums/.test(al.tab) && !al.hscroll, tag + ': balance cell: nothing clipped, inside its row, tabular digits, no horizontal scroll', al);
  console.log('ALIGN ' + tag + ' balance cell text right edges ' + JSON.stringify(rs) + ' spread ' + spread);
  await p.screenshot({ path: OUT + '/livebal-' + tag + '-1-menu-aged.png' });
  await p.keyboard.press('Escape'); await p.evaluate(() => { const m = document.getElementById('stkc-trade-pop'); if (m) m.hidden = true; });

  // B: the Owner trades: a round trip on MNQ after the snapshot (+10 pt x $2 = +20, 2 x $0.62 fees) and an NQ long still open
  const t1 = T0 - 5 * 60e3, t2 = T0 - 3 * 60e3, t3 = T0 - 2 * 60e3;
  M.orders = [
    { orderId: 'o1', status: 'FILLED', orderType: 'MARKET', orderUpdatedAt: iso(t1), legs: [{ securityId: 'MNQZ6', side: 'BUY', quantity: 1, filledQuantity: 1 }] },
    { orderId: 'o2', status: 'FILLED', orderType: 'MARKET', orderUpdatedAt: iso(t2), legs: [{ securityId: 'MNQZ6', side: 'SELL', quantity: 1, filledQuantity: 1 }] },
    { orderId: 'o3', status: 'FILLED', orderType: 'MARKET', orderUpdatedAt: iso(t3), legs: [{ securityId: 'NQZ6', side: 'BUY', quantity: 1, filledQuantity: 1 }] },
    { orderId: 'old', status: 'FILLED', orderType: 'MARKET', orderUpdatedAt: iso(T0 - 30 * 3600e3), legs: [{ securityId: 'NQZ6', side: 'BUY', quantity: 1 }] },
  ];
  M.fills = [
    { fillId: 'f1', orderId: 'o1', securityId: 'MNQZ6', side: 'BUY', quantity: 1, price: 25000, executedAt: iso(t1), commission: 0.62 },
    { fillId: 'f2', orderId: 'o2', securityId: 'MNQZ6', side: 'SELL', quantity: 1, price: 25010, executedAt: iso(t2), commission: 0.62 },
    { fillId: 'f3', orderId: 'o3', securityId: 'NQZ6', side: 'BUY', quantity: 1, price: 28740, executedAt: iso(t3), commission: 0 },
  ];
  M.positions = [{ securityId: 'NQZ6', quantity: 1, averageBuyPrice: 28740, status: 'OPEN' }];
  const b0 = n('balances'), f0 = n('fills');
  await p.evaluate(() => { window.__stkLive.state.reading = false; return window.__stkLive.read(); });
  check(await wait((b0) => true, b0) && await (async () => { for (let i = 0; i < 50; i++) { if (n('balances') > b0 && n('fills') > f0) return true; await sleep(100); } return false; })(), tag + ': a fill / position change re-reads balances and fills at once', { b: n('balances') - b0, f: n('fills') - f0 });
  const fc = M.calls.filter((c) => c.op === 'fills').at(-1);
  check(fc && fc.body.orderIds.join() === 'o1,o2,o3', tag + ': fills asked for today\'s filled orders only (not yesterday\'s)', fc && fc.body.orderIds);
  // balance = 53,742.38 + 20 - 1.24 (+0 NQ open buy has no realised); RP&L +18.76; UP&L (28750-28740) x $20 = +200
  check(await wait(() => /53,761\.14/.test(document.querySelector('#stkas [data-k=bal] .stkas-v').textContent)), tag + ': Bal moves with the trades: $53,761.14 = snapshot + realised since', await strip());
  s = await strip();
  check(/18\.76/.test(s.rp.t) && /up/.test(s.rp.c) && /fills/.test(s.rp.tip), tag + ': RP&L +$18.76 from today\'s fills after commission', s.rp);
  check(/200\.00/.test(s.up.t) && /up/.test(s.up.c), tag + ': UP&L +$200.00 = open NQ x last price', s.up);
  check(!/updated/.test(s.bal.tip) && /plus 3 fills since it/.test(s.bal.tip), tag + ': adjusted balance: tooltip explains it, no age', s.bal);
  if (mobile) {
    await p.tap('.stkas-b'); await sleep(400);
    await p.screenshot({ path: OUT + '/livebal-' + tag + '-2-strip-pop.png' });
    s = await strip();
    check(s.pop.join('|').includes('Realized P&L today') && !s.pop.some((x) => /^Updated/.test(x)), tag + ': phone popover rows (no age line once adjusted)', s.pop);
    await p.tap('.stkas-b').catch(() => {}); await sleep(200);
  } else await p.screenshot({ path: OUT + '/livebal-' + tag + '-2-strip.png', clip: { x: 0, y: 0, width: w, height: 120 } });
  const f1 = n('fills');
  await p.evaluate(() => { window.__stkLive.state.reading = false; return window.__stkLive.read(); });
  await sleep(600);
  check(n('fills') === f1, tag + ': unchanged positions: filled orders\' fills are not re-read (cache)', n('fills') - f1);

  // C: 30 s later the broker has a new snapshot (incl. the trades); the strip is on screen -> re-read without a menu open
  M.balances = M.balances.concat([{ balanceId: 'b3', balanceType: 'ACCOUNT', currencyCode: 'USD', cashBalance: '53761.14', netLiquidationValue: '53961.14', unrealizedPnl: '200', lastUpdated: iso(T0 + 1000) }]);
  const b1 = n('balances');
  await p.evaluate(() => { window.__off = 31000; });
  check(await (async () => { for (let i = 0; i < 40; i++) { if (n('balances') > b1) return true; await sleep(100); } return false; })(), tag + ': 30 s refresh while the strip is on screen (no menu open)');
  check(await wait(() => /53,961\.14/.test(document.querySelector('#stkas [data-k=bal] .stkas-v').textContent)), tag + ': newer snapshot replaces the figure (no fills after it, so not added twice)', await strip());
  await openMenu();
  mb = await menuBal();
  check(mb && mb.v === '$53,961.14' && mb.age === '', tag + ': Trade menu: new balance, no age line (snapshot is fresh)', mb);
  await p.screenshot({ path: OUT + '/livebal-' + tag + '-3-menu-fresh.png' });
  check(!M.calls.some((c) => c.WRITE && ['place', 'cancel', 'modify', 'flatten'].includes(c.WRITE)), tag + ': no order op was sent', M.calls.filter((c) => c.WRITE).map((c) => c.WRITE));
  check(errors.length === 0, tag + ': no console errors ' + errors.slice(0, 2).join(' | '));
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const only = process.env.ONLY || '';
    for (const [w, h, mobile, theme] of [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [390, 844, true, 'dark'], [390, 844, true, 'light']]) if (!only || only === w + '-' + theme) await run(b, w, h, mobile, theme);
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
