// ZoroCharts Trade toolbar menu (2026-11-16) browser test. Every /connect/finatic/* call is a local mock: no real order can be sent.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-trade-btn-browser.js <shotsDir>
const fs = require("fs");
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/chartlive';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
const globex = (s) => { const d = new Date((s - 5 * 3600) * 1000), wd = d.getUTCDay(), h = d.getUTCHours(); return !(wd === 6 || (wd === 5 && h >= 17) || (wd === 0 && h < 18) || h === 17); };   // EST approx (fixture)
const ACC2 = '223e4567-e89b-12d3-a456-426614174001', ACC = '123e4567-e89b-12d3-a456-426614174000', US = '0aaa1111-2222-3333-4444-555566667777';

async function open(b, { w, h, mobile, theme, admin = true, connected = true }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(({ t, admin, connected, US }) => {
    window.__stkLiveTest = { isAdmin: () => admin, last: () => 28750 };
    window.__toasts = []; const keep = () => (t, m) => { window.__toasts.push(String(m)); return Promise.resolve(); };
    Object.defineProperty(window, 'showToast', { configurable: true, get: () => keep(), set: () => {} });
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night');
      if (connected) localStorage.setItem('stryker_broker_sync_user_u1', US); else localStorage.removeItem('stryker_broker_sync_user_u1');
    } catch (e) {}
  }, { t: theme, admin, connected, US });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  // fixture NQ 1m bars around 28,750 (every minute, so a weekend run still has a last price)
  await ctx.route('**/api/chart/bars/**', (r) => {

    const u = new URL(r.request().url()), tf = Number(u.searchParams.get('tf') || 1), P = 8 * 3600, now = Math.floor(Date.now() / 1000);
    const page = u.searchParams.has('page') ? Number(u.searchParams.get('page')) : Math.floor(now / P);
    if (!/NQ/.test(u.pathname) || tf !== 1 || page < Math.floor(now / P) - 12) return r.fulfill({ json: { bars: [] } });
    const bars = []; for (let t = page * P; t < (page + 1) * P && t <= now; t += 60) { const m = t / 60, c = Math.round((28750 + 6 * Math.sin(m / 9)) * 4) / 4; bars.push([t, c - 0.5, c + 1.5, c - 1.5, c, 100]); }
    if (process.env.DBG) console.log('DBG route', u.pathname + u.search, bars.length);
    return r.fulfill({ json: { s: 'NQ', tf: '1', page, bars, rt: true } });
  });
  const M = { calls: [], positions: [], orders: [], failRead: false, modify: true, n: 0 };
  ctx.M = M;
  const j = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/connect/finatic/**', (r) => {
    const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    M.calls.push({ path: u.pathname, body });
    if (!admin) return r.fulfill(j({ error: 'Admins only' }, 403));
    if (u.pathname.endsWith('/session') && r.request().method() === 'GET') return r.fulfill(j({ configured: true }));
    if (u.pathname.endsWith('/session')) return r.fulfill(j({ portalUrl: 'http://127.0.0.1:1/portal', sessionId: 's1' }));
    if (u.pathname.endsWith('/data')) {
      if (body.op === 'accounts') return r.fulfill(j({ userId: US, data: [{ accountId: ACC, accountName: 'DEMO 5551234', accountNumber: 'DEMO5551234', brokerName: 'tradovate' }, { accountId: ACC2, accountName: 'ACME 7770042', accountNumber: 'ACME7770042', brokerName: 'rithmic' }] }));
      if (body.op === 'live') return M.failRead ? r.fulfill(j({ error: 'Broker data is unavailable right now', code: 'upstream' }, 503)) : r.fulfill(j({ data: { positions: M.positions, orders: M.orders } }));
      return r.fulfill(j({ data: [] }));
    }
    if (u.pathname.endsWith('/order')) {
      if (body.op === 'env') return r.fulfill(j({ env: 'live', enabled: true }));
      if (body.op === 'schema') return body.action === 'modify' && !M.modify ? r.fulfill(j({ error: 'not supported', code: 'upstream' }, 503)) : r.fulfill(j({ data: { fields: { symbol: {}, orderQty: {} } }, env: 'live' }));
      M.n++;
      if (body.op === 'place') { const id = 'o' + M.n; if (body.type === 'limit') M.orders.push({ orderId: id, status: 'SUBMITTED', orderType: 'LIMIT', legs: [{ securityId: body.symbol, side: body.side.toUpperCase(), quantity: body.qty, limitPrice: body.limitPrice }] }); else { M.positions = [{ securityId: body.symbol, quantity: (body.side === 'buy' ? 1 : -1) * body.qty, averageBuyPrice: 28750, averageSellPrice: 28750 }]; } return r.fulfill(j({ ok: true, accepted: true, orderId: id, status: 'SUBMITTED' })); }
      if (body.op === 'cancel') { M.orders = M.orders.filter((o) => o.orderId !== body.orderId); return r.fulfill(j({ ok: true, accepted: true, status: 'CANCELLED' })); }
      if (body.op === 'modify') { if (!M.modify) return r.fulfill(j({ error: 'modify not supported', code: 'rejected' }, 400)); M.orders.forEach((o) => { if (o.orderId === body.orderId) o.legs[0].limitPrice = body.limitPrice; }); return r.fulfill(j({ ok: true, accepted: true, status: 'SUBMITTED' })); }
      if (body.op === 'flatten') { M.orders = []; M.positions = []; return r.fulfill(j({ ok: true, cancelled: [], closed: { side: 'sell', qty: 1 } })); }
    }
    return r.fulfill(j({ error: 'Not allowed' }, 400));
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource|Ping received|Unexpected response code|WebSocket/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  if (process.env.DBG) p.on('console', (m) => { if (/bar|futures|provider|error/i.test(m.text())) console.log('DBG console', m.type(), m.text().slice(0, 200)); });
  p.on('dialog', (d) => d.dismiss());
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper, null, { timeout: 60000 });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === 'futures:NQ1!') break; } });
  await sleep(1200);
  return { ctx, p, errors, M };
}
const writes = (M) => M.calls.filter((c) => c.path.endsWith('/order') && ['place', 'cancel', 'modify', 'flatten'].includes(c.body.op)).map((c) => c.body);
const tap = (p, sel, mobile) => (mobile ? p.tap(sel) : p.click(sel));

// alignment: one row's items -> centres, heights, gaps, paddings
const measure = (p, rowSel, itemSel) => p.evaluate(([rs, is]) => {
  const row = document.querySelector(rs); if (!row) return null;
  const R = row.getBoundingClientRect(), cs = getComputedStyle(row);
  const items = [...row.querySelectorAll(is)].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0).map((e) => { const b = e.getBoundingClientRect(); return { cls: (e.className && e.className.baseVal === undefined ? e.className : e.tagName).toString().split(' ')[0] || e.tagName, top: Math.round(b.top * 10) / 10, h: Math.round(b.height * 10) / 10, cy: Math.round((b.top + b.height / 2) * 10) / 10, l: Math.round(b.left), r: Math.round(b.right) }; });
  const cys = items.map((i) => i.cy); const spread = cys.length ? Math.max(...cys) - Math.min(...cys) : 0;
  const gaps = items.slice(1).map((it, k) => it.l - items[k].r);
  const first = items[0], last = items[items.length - 1];
  return { row: { h: Math.round(R.height * 10) / 10, padL: cs.paddingLeft, padR: cs.paddingRight }, items, cySpread: Math.round(spread * 10) / 10, gaps, insetL: first ? first.l - Math.round(R.left) : null, insetR: last ? Math.round(R.right) - last.r : null };
}, [rowSel, itemSel]);


const barMeasure = (p) => p.evaluate(() => {
  const bar = document.getElementById('stkc-bar'); const B = bar.getBoundingClientRect();
  const its = [...bar.querySelectorAll('.stkc-btn, .stkc-ib')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && e.offsetParent !== null && !e.closest('.stkc-pop,.stkc-ob-pop'); })
    .map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.className.toString().slice(0, 24), l: Math.round(r.left), r: Math.round(r.right), h: Math.round(r.height * 10) / 10, cy: Math.round((r.top + r.height / 2) * 10) / 10 }; })
    .sort((a, b) => a.l - b.l);
  const cys = its.map((i) => i.cy), gaps = its.slice(1).map((it, k) => it.l - its[k].r);
  const tr = document.getElementById('stkc-paper-btn'), ds = document.getElementById('byo-btn');
  return { barCy: Math.round((B.top + B.height / 2) * 10) / 10, cySpread: Math.round((Math.max(...cys) - Math.min(...cys)) * 10) / 10, items: its, gaps, tradeH: tr && tr.getBoundingClientRect().height, dsH: ds && ds.getBoundingClientRect().height, tradeBeforeData: !!(tr && ds && tr.getBoundingClientRect().right <= ds.getBoundingClientRect().left + 1), insetR: Math.round(B.right - Math.max(...its.map((i) => i.r))) };
});
const menuProbe = (p) => p.evaluate(() => {
  const pop = document.getElementById('stkc-trade-pop'), q = (r) => Math.round(r * 10) / 10;
  const rows = [...pop.querySelectorAll('.stktm-row')].map((r) => { const R = r.getBoundingClientRect(), cs = getComputedStyle(r); const cy = [...r.children].map((c) => { const b = c.getBoundingClientRect(); return b.top + b.height / 2; }); return { h: q(R.height), cySpread: q(Math.max(...cy) - Math.min(...cy)), padL: cs.paddingLeft, padR: cs.paddingRight }; });
  const imgs = [...pop.querySelectorAll('.stktm-logo img')];
  const P = pop.getBoundingClientRect(), add = pop.querySelector('.stktm-add'), man = pop.querySelector('.stktm-manage');
  const cyOf = (e) => { const b = e.getBoundingClientRect(); return q(b.top + b.height / 2); };
  return { w: q(P.width), radius: getComputedStyle(pop).borderRadius, rows, logos: imgs.length, imgOk: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
    logoSizes: [...pop.querySelectorAll('.stktm-logo')].map((l) => { const b = l.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height); }),
    paperSub: pop.querySelector('.stktm-row .stktm-sub').textContent, subs: [...pop.querySelectorAll('[data-a=live] .stktm-sub')].map((e) => e.textContent.trim()),
    foot: add ? { addH: q(add.getBoundingClientRect().height), cySpread: q(Math.abs(cyOf(add) - cyOf(man))), padL: q(add.getBoundingClientRect().left - P.left), padR: q(P.right - man.getBoundingClientRect().right) } : null };
});
const keyboardTest = async (p, tag) => {
  const act = () => p.evaluate(() => { const e = document.activeElement; return e && e.dataset && e.dataset.a ? e.dataset.a + (e.dataset.id ? ':' + e.dataset.id.slice(0, 3) : '') : (e && e.id) || ''; });
  check(await act() === 'paper', tag + ': kbd: menu opens focused on the checked row', await act());
  await p.keyboard.press('ArrowDown'); check((await act()).startsWith('live:123'), tag + ': kbd: ArrowDown -> first account', await act());
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); check(await act() === 'connect', tag + ': kbd: ArrowDown x2 -> Connect', await act());
  await p.keyboard.press('ArrowUp'); check((await act()).startsWith('live:223'), tag + ': kbd: ArrowUp', await act());
  await p.keyboard.press('Home'); check(await act() === 'paper', tag + ': kbd: Home');
  const roles = await p.evaluate(() => ({ menu: document.getElementById('stkc-trade-pop').getAttribute('role'), radios: document.querySelectorAll('#stkc-trade-pop [role=menuitemradio]').length }));
  check(roles.menu === 'menu' && roles.radios === 3, tag + ': aria menu + 3 menuitemradio', roles);
  await p.keyboard.press('Escape'); await sleep(100);
  check(await p.evaluate(() => document.getElementById('stkc-trade-pop').hidden && document.activeElement.id === 'stkc-paper-btn'), tag + ': kbd: Esc closes, focus back on button');
  await p.keyboard.press('Enter'); await sleep(300);
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await sleep(600);
  check(await p.waitForFunction(() => window.__stkLive.state.acct && window.__stkLive.state.acct.id.startsWith('123'), null, { timeout: 8000 }).then(() => true, () => false), tag + ': kbd: Enter on account row picks it');
  await p.evaluate(() => window.__stkLive.leave(true)); await sleep(500);
  await p.click('#stkc-paper-btn'); await sleep(300);
};
const rows = (p) => p.$$eval('#stkc-trade-pop [data-a]', (n) => n.map((x) => x.dataset.a + ':' + ((x.querySelector('.stktm-nm') || x).textContent.replace(/\s+/g, ' ').trim()) + (x.getAttribute('aria-checked') === 'true' ? ' ✓' : '')));

async function run(b, w, h, mobile, theme) {
  const tag = w + '-' + theme;
  const { ctx, p, errors, M } = await open(b, { w, h, mobile, theme });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.connect && window.__stkLive.state.accounts.length > 1, null, { timeout: 20000 });
  const m = await barMeasure(p);
  console.log('ALIGN ' + tag + ' ' + JSON.stringify(m));
  const inBar = await p.evaluate(() => { const t = document.getElementById('stkc-paper-btn'); return !!(t && t.getBoundingClientRect().width > 0 && !t.closest('.stkc-ob-pop')); });
  console.log(tag + ': Trade in bar = ' + inBar);
  if (inBar) {
    check(m.cySpread <= 1, tag + ': toolbar items share one centre (±1px)', m);
    check(m.tradeBeforeData && m.tradeH === m.dsH, tag + ': Trade sits before Data source, same height', m);
    { const i = m.items.findIndex((x) => x.id === 'stkc-paper-btn'); check(m.items[i].l - m.items[i - 1].r === 2 && m.items[i + 1].l - m.items[i].r === 2, tag + ': Trade has the same 2px gap as every neighbour (8pt: bar gap token)', [m.items[i - 1], m.items[i], m.items[i + 1]]); }
    await p.click('#stkc-paper-btn');
  } else {
    await p.click('#stkc-more-btn'); await sleep(300);
    await p.evaluate(() => document.querySelector('#stkc-more-pop [data-ob-label="Trade"]').click());
  }
  await sleep(400);
  const items = await rows(p);
  check(items.join('|') === 'paper:Paper trading ✓|live:Tradovate …1234|live:Rithmic …0042|connect:Connect a broker', tag + ': admin menu rows + check on Paper', items);
  const menu = await menuProbe(p); console.log('MENU ' + tag + ' ' + JSON.stringify(menu));
  check(menu.logos === 2 && menu.imgOk === 2 && menu.paperSub.startsWith('Simulated · balance $'), tag + ': 2 broker logos load, paper sub line has balance', menu);
  check(menu.subs.join('|') === 'Connected|Connected', tag + ': account status lines', menu.subs);
  check(menu.rows.every((r) => r.h >= 40 && r.cySpread <= 1 && r.padL === r.padR), tag + ': rows >=40px, icon/text/tick on one centre, equal side padding', menu.rows);
  check(menu.logoSizes.slice(1).every((x) => x === '24x24'), tag + ': logos 24x24', menu.logoSizes);
  check(menu.foot && menu.foot.cySpread <= 1 && menu.foot.padL === menu.foot.padR, tag + ': footer pill + Manage on one centre, equal side inset', menu.foot);
  if (!mobile) await keyboardTest(p, tag);
    if (theme === 'dark' || w === 1440) await p.screenshot({ path: OUT + '/trade-' + tag + '-menu.png' });
  await p.evaluate((id) => document.querySelector('#stkc-trade-pop [data-id="' + id + '"]').click(), ACC);
  await p.waitForFunction(() => document.querySelector('.stkpt.is-live') && window.__stkLive.state.placeSchema, null, { timeout: 10000 });
  await sleep(500);
  const lbl = await p.evaluate(() => { const b = document.getElementById('stkc-paper-btn'); const l = b.querySelector('.stkc-btn-l'); return { t: l.textContent, logo: !!b.querySelector('.stktm-logo img'), dot: !!b.querySelector('.stktm-live'), c: getComputedStyle(b).color, open: document.querySelector('.stkpt').classList.contains('open') }; });
  check(lbl.t === 'Tradovate' && lbl.logo && lbl.dot && (!inBar || lbl.c === 'rgb(242, 54, 69)'), tag + ': button = Tradovate logo + name + live dot, red', lbl);
  check(lbl.open, tag + ': panel open on the live account');
  const m2 = await barMeasure(p); console.log('ALIGN-LIVE ' + tag + ' ' + JSON.stringify(m2));
  if (inBar) check(m2.cySpread <= 1 && m2.tradeH === m2.dsH, tag + ': one centre line with the long label', m2);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ': no horizontal page scroll');
  if (inBar) {
    await p.click('#stkc-paper-btn'); await sleep(300);
    const it2 = await rows(p);
    check(it2[0] === 'paper:Paper trading' && it2[1] === 'live:Tradovate …1234 ✓', tag + ': check mark moved to the live account', it2);
    if (theme === 'dark' || w === 1440) await p.screenshot({ path: OUT + '/trade-' + tag + '-menu-live.png' });
    const bar = await p.$('#stkc-bar'); await bar.screenshot({ path: OUT + '/crop-bar-' + tag + '.png' });
    await p.evaluate(() => document.querySelector('#stkc-trade-pop [data-a=paper]').click());
  } else { await p.screenshot({ path: OUT + '/trade-' + tag + '-live.png' }); await p.evaluate(() => window.__stkLive.leave(true)); }
  await sleep(600);
  check(await p.evaluate(() => !window.__stkLive.state.acct), tag + ': back on Paper');
  if (inBar) check((await p.$eval('#stkc-paper-btn .stkc-btn-l', (e) => e.textContent)) === 'Paper', tag + ': label back to Paper');
  const w2 = M.calls.filter((c) => c.path.endsWith('/order') && ['place', 'cancel', 'modify', 'flatten'].includes(c.body.op));
  check(!w2.length, tag + ': no order sent');
  check(errors.length === 0, tag + ': no console errors ' + errors.slice(0, 2).join(' | '));
  await ctx.close();
}

async function member(b) {
  const { ctx, p, M } = await open(b, { w: 1440, h: 900, theme: 'dark', admin: false });
  await sleep(2500);
  check(await p.$('#stkc-paper-btn') !== null, 'member: Trade button present');
  await p.click('#stkc-paper-btn'); await sleep(300);
  const items = await rows(p);
  check(items.join('|') === 'paper:Paper trading ✓', 'member: menu has Paper trading only', items);
  check(!(await p.evaluate(() => /tradovate|broker|finatic|live/i.test(document.getElementById('stkc-trade-pop').innerText + document.getElementById('stkc-paper-btn').innerText))), 'member: no broker words in button or menu');
  await p.screenshot({ path: OUT + '/trade-member-menu.png' });
  await p.evaluate(() => document.querySelector('#stkc-trade-pop [data-a=paper]').click()); await sleep(500);
  check(M.calls.length === 0, 'member: no broker calls');
  await ctx.close();
}
async function connectRow(b) {
  const { ctx, p } = await open(b, { w: 1440, h: 900, theme: 'dark', connected: false });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.connect && window.__stkLive.state.loaded, null, { timeout: 20000 });
  await p.evaluate(() => { window.open = () => ({ location: {}, close() {} }); });
  await p.click('#stkc-paper-btn'); await sleep(300);
  const items = await rows(p);
  check(items.join('|') === 'paper:Paper trading ✓|connect:Connect a broker', 'admin, none connected: Paper + Connect a broker', items);
  await p.evaluate(() => document.querySelector('#stkc-trade-pop [data-a=connect]').click());
  check(await p.waitForSelector('#fjs', { timeout: 10000 }).then(() => true, () => false), 'Connect a broker… opens the connect sheet');
  await ctx.close();
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    await member(b); await connectRow(b);
    for (const [w, h, mobile, theme] of [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [412, 915, true, 'dark'], [390, 844, true, 'dark']]) await run(b, w, h, mobile, theme);
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
