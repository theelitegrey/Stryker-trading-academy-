// ZoroCharts Trade toolbar menu (2026-11-16, v2 same day: brand logos, broker account number, balances, pencil editor, disconnect)
// browser test. Every /connect/finatic/* call is a local mock and Firestore is the in-page stub: no real order, no real write.
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
const G1 = '9aaa1111-2222-3333-4444-555566660001', G2 = '9aaa1111-2222-3333-4444-555566660002';
// realistic Finatic v1 account records: Finatic UUID + the broker's INTERNAL id (brokerAccountId) + the name the broker shows
const ACCOUNTS = [
  { accountId: ACC, brokerId: 'tradovate', brokerName: 'tradovate', brokerAccountId: '37552029', accountName: 'APEX-1234567-01', accountType: 'futures', currencyCode: 'USD', syncStatus: 'ready' },
  { accountId: ACC2, brokerId: 'rithmic', brokerName: 'rithmic', brokerAccountId: '88001234', accountName: 'TOPSTEP50K-PRACTICE-88001234', currencyCode: 'USD', syncStatus: 'ready' }];
const GRANTS = [{ id: G1, brokerId: 'tradovate', brokerAccountId: '37552029', status: 'ACTIVE', canRead: true, canTrade: true }, { id: G2, brokerId: 'rithmic', brokerAccountId: '88001234', status: 'ACTIVE', canRead: true, canTrade: true }];
const BAL = { [ACC]: [{ balanceType: 'ACCOUNT', currencyCode: 'USD', cashBalance: '50000.00', netLiquidationValue: '50312.40', unrealizedPnl: '312.40' }], [ACC2]: [] };

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
    // Firestore students/u1/brokerAccounts: in-page store (the rich stub answers everything else). ACC2 already has notes.
    window.__meta = { u1: { '223e4567-e89b-12d3-a456-426614174001': { label: 'Topstep 50K combine (practice)', firm: 'Topstep', type: 'eval', updatedAt: 'TS' } } };
    window.__metaWrites = []; window.__metaFail = false;
    const fakeCol = (u) => { const st = window.__meta[u] || (window.__meta[u] = {}); return {
      get: () => Promise.resolve({ docs: Object.keys(st).map((id) => ({ id, data: () => st[id] })) }),
      doc: (id) => ({ set: (v) => { if (window.__metaFail) return Promise.reject(new Error('offline')); window.__metaWrites.push({ u, id, v }); st[id] = v; return Promise.resolve(); },
        delete: () => { window.__metaWrites.push({ u, id, del: true }); delete st[id]; return Promise.resolve(); } }) }; };
    const real = window.__stubDb;
    window.__stubDb = Object.assign({}, real, { collection: (n) => { const c = real.collection(n); if (n !== 'students') return c; const od = c.doc; c.doc = (id) => { const d = od(id); const oc = d.collection; d.collection = (sub) => (sub === 'brokerAccounts' ? fakeCol(id) : oc(sub)); return d; }; return c; } });
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
  const M = { calls: [], positions: [], orders: [], failRead: false, modify: true, n: 0, revoked: new Set(), balDelay: 700 };
  ctx.M = M;
  const j = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/connect/finatic/**', (r) => {
    const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    M.calls.push({ path: u.pathname, body });
    if (!admin) return r.fulfill(j({ error: 'Admins only' }, 403));
    if (u.pathname.endsWith('/session') && r.request().method() === 'GET') return r.fulfill(j({ configured: true }));
    if (u.pathname.endsWith('/session')) return r.fulfill(j({ portalUrl: 'http://127.0.0.1:1/portal', sessionId: 's1' }));
    if (u.pathname.endsWith('/data')) {
      if (body.op === 'accounts') return r.fulfill(j({ userId: US, data: ACCOUNTS.filter((a) => !M.revoked.has(GRANTS.find((g) => g.brokerAccountId === a.brokerAccountId).id)) }));
      if (body.op === 'grants') return r.fulfill(j({ userId: US, data: GRANTS.map((g) => (M.revoked.has(g.id) ? Object.assign({}, g, { revokedAt: '2026-11-16T00:00:00Z', status: 'REVOKED' }) : g)) }));
      if (body.op === 'revoke') { M.revoked.add(body.grantId); return r.fulfill(j({ ok: true, userId: US })); }
      if (body.op === 'balances') return sleep(M.balDelay).then(() => r.fulfill(j({ userId: US, data: BAL[body.accountId] || [] })));
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
  // paper trading switched on (a member who trades paper). Paper OFF = no row ticked + the "Trade" face: chart-live-browser.js memberDock
  await p.waitForFunction(() => window.__stkPaper.account, null, { timeout: 20000 }).catch(() => {});
  await p.evaluate(() => { try { window.__stkPaper.setEnabled(true); } catch (e) {} });
  await sleep(1200);
  return { ctx, p, errors, M };
}

const writes = (M) => M.calls.filter((c) => c.path.endsWith('/order') && ['place', 'cancel', 'modify', 'flatten'].includes(c.body.op)).map((c) => c.body);
const q = (r) => Math.round(r * 10) / 10;

const barMeasure = (p) => p.evaluate(() => {
  const bar = document.getElementById('stkc-bar'); const B = bar.getBoundingClientRect();
  const its = [...bar.querySelectorAll('.stkc-btn, .stkc-ib')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && e.offsetParent !== null && !e.closest('.stkc-pop,.stkc-ob-pop'); })
    .map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.className.toString().slice(0, 24), l: Math.round(r.left), r: Math.round(r.right), h: Math.round(r.height * 10) / 10, cy: Math.round((r.top + r.height / 2) * 10) / 10 }; })
    .sort((a, b) => a.l - b.l);
  const cys = its.map((i) => i.cy), gaps = its.slice(1).map((it, k) => it.l - its[k].r);
  const tr = document.getElementById('stkc-paper-btn'), ds = document.getElementById('byo-btn');
  return { barCy: Math.round((B.top + B.height / 2) * 10) / 10, cySpread: Math.round((Math.max(...cys) - Math.min(...cys)) * 10) / 10, items: its, gaps, tradeH: tr && tr.getBoundingClientRect().height, dsH: ds && ds.getBoundingClientRect().height, tradeBeforeData: !!(tr && ds && tr.getBoundingClientRect().right <= ds.getBoundingClientRect().left + 1), insetR: Math.round(B.right - Math.max(...its.map((i) => i.r))) };
});
// ALIGNMENT GATE for the menu: per row the logo, text block, buttons and tick share one centre; edges; sizes; footer
const menuProbe = (p) => p.evaluate(() => {
  const pop = document.getElementById('stkc-trade-pop'), q = (r) => Math.round(r * 10) / 10, P = pop.getBoundingClientRect(), pcs = getComputedStyle(pop);
  const box = (e) => e && e.getBoundingClientRect();
  const rows = [...pop.querySelectorAll('.stktm-row')].map((r) => {
    const R = box(r), parts = [r.querySelector('.stktm-logo'), r.querySelector('.stktm-tx'), ...r.querySelectorAll('.stktm-act'), r.querySelector('.stktm-tick')].filter(Boolean);
    const cy = parts.map((c) => { const b = box(c); return b.top + b.height / 2; });
    const logo = box(r.querySelector('.stktm-logo')), tick = box(r.querySelector('.stktm-tick')), tx = box(r.querySelector('.stktm-tx'));
    const acts = [...r.querySelectorAll('.stktm-act')].map((a) => { const b = box(a); return q(b.width) + 'x' + q(b.height); });
    const l1 = box(r.querySelector('.stktm-l1')), l2 = box(r.querySelector('.stktm-l2'));
    return { id: r.dataset.row.slice(0, 3), h: q(R.height), cySpread: q(Math.max(...cy) - Math.min(...cy)), logo: q(logo.width) + 'x' + q(logo.height), logoL: q(logo.left - P.left), tickR: q(P.right - tick.right),
      gapLogoTx: q(tx.left - logo.right), acts, txOverflow: r.querySelector('.stktm-tx').scrollWidth > r.querySelector('.stktm-tx').clientWidth + 1, lines: q(l2.top - l1.bottom),
      num: (r.querySelector('.stktm-num') || {}).textContent || '', numFont: r.querySelector('.stktm-num') ? getComputedStyle(r.querySelector('.stktm-num')).fontFamily.split(',')[0] : '',
      phR: r.querySelector('.stktm-ph') ? q(P.right - box(r.querySelector('.stktm-ph')).right) : null, editR: r.querySelector('[data-x=edit]') ? q(P.right - box(r.querySelector('[data-x=edit]')).right) : null, offR: r.querySelector('[data-x=off],[data-x=paperoff]') ? q(P.right - box(r.querySelector('[data-x=off],[data-x=paperoff]')).right) : null,
      bal: ((r.querySelector('.stktm-bal') || {}).textContent || '').trim(), skel: !!r.querySelector('.stktm-skel'), actOpacity: [...r.querySelectorAll('.stktm-act')].map((a) => getComputedStyle(a).opacity) };
  });
  const imgs = [...pop.querySelectorAll('.stktm-logo img')];
  const add = pop.querySelector('.stktm-add'), man = pop.querySelector('.stktm-manage');
  const cyOf = (e) => { const b = box(e); return q(b.top + b.height / 2); };
  const hs = [...pop.querySelectorAll('.stktm-h')].map((h) => q(box(h).left - P.left));
  return { w: q(P.width), padL: pcs.paddingLeft, padR: pcs.paddingRight, radius: pcs.borderRadius, rows, logos: imgs.length, imgOk: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, imgSrc: imgs.map((i) => i.getAttribute('src').split('/').pop()), headerL: hs,
    foot: add ? { addH: q(box(add).height), manH: q(box(man).height), cySpread: q(Math.abs(cyOf(add) - cyOf(man))), padL: q(box(add).left - P.left), padR: q(P.right - box(man).right) } : null,
    scrollW: pop.scrollWidth <= pop.clientWidth + 1 };
});
const rowsText = (p) => p.$$eval('#stkc-trade-pop .stktm-row, #stkc-trade-pop [data-a=connect]', (n) => n.map((x) => {
  const b = x.matches('[data-a]') ? x : x.querySelector('[data-a]');
  const nm = x.querySelector('.stktm-nm'), num = x.querySelector('.stktm-num');
  return b.dataset.a + ':' + (nm ? nm.textContent + (num ? ' ' + num.textContent : '') : b.textContent.trim()) + (b.getAttribute('aria-checked') === 'true' ? ' ✓' : '');
}));
const act = (p) => p.evaluate(() => { const e = document.activeElement; if (!e) return ''; if (e.dataset && e.dataset.x) return e.dataset.x + ':' + e.dataset.id.slice(0, 3); return e.dataset && e.dataset.a ? e.dataset.a + (e.dataset.id ? ':' + e.dataset.id.slice(0, 3) : '') : (e.name || e.id || e.tagName); });

const keyboardTest = async (p, tag) => {
  check(await act(p) === 'paper', tag + ': kbd: menu opens focused on the checked row', await act(p));
  await p.keyboard.press('ArrowDown'); check((await act(p)) === 'live:123', tag + ': kbd: ArrowDown -> first account', await act(p));
  await p.keyboard.press('ArrowRight'); check((await act(p)) === 'edit:123', tag + ': kbd: ArrowRight -> pencil', await act(p));
  await p.keyboard.press('ArrowRight'); check((await act(p)) === 'off:123', tag + ': kbd: ArrowRight -> disconnect', await act(p));
  await sleep(250); const vis = await p.evaluate(() => getComputedStyle(document.activeElement).opacity); check(vis === '1', tag + ': focused icon button is visible', vis);
  await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); check((await act(p)) === 'live:123', tag + ': kbd: ArrowLeft x2 -> back to the row', await act(p));
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); check(await act(p) === 'connect', tag + ': kbd: ArrowDown x2 -> Connect', await act(p));
  await p.keyboard.press('ArrowUp'); check((await act(p)) === 'live:223', tag + ': kbd: ArrowUp', await act(p));
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter'); await sleep(200);
  check(await p.evaluate(() => !!document.querySelector('#stkc-trade-pop .stktm-ed') && document.activeElement.name === 'label'), tag + ': kbd: Enter on the pencil opens the editor, focus in Label');
  await p.keyboard.press('Escape'); await sleep(100);
  check(await p.evaluate(() => !document.querySelector('#stkc-trade-pop .stktm-ed') && !document.getElementById('stkc-trade-pop').hidden), tag + ': kbd: Esc closes the editor first, menu stays open');
  check((await act(p)) === 'edit:223', tag + ': kbd: focus back on the pencil', await act(p));
  await p.keyboard.press('Home'); check(await act(p) === 'paper', tag + ': kbd: Home');
  const roles = await p.evaluate(() => ({ menu: document.getElementById('stkc-trade-pop').getAttribute('role'), radios: document.querySelectorAll('#stkc-trade-pop [role=menuitemradio]').length, labels: [...document.querySelectorAll('#stkc-trade-pop .stktm-act')].map((b) => b.getAttribute('aria-label')) }));
  check(roles.menu === 'menu' && roles.radios === 3 && roles.labels.length === 5 && roles.labels[0] === 'Turn off paper trading on this chart' && roles.labels.slice(1).every((l) => /^(Edit|Disconnect) /.test(l)), tag + ': aria menu + 3 menuitemradio + labelled icon buttons', roles);
  await p.keyboard.press('Escape'); await sleep(100);
  check(await p.evaluate(() => document.getElementById('stkc-trade-pop').hidden && document.activeElement.id === 'stkc-paper-btn'), tag + ': kbd: Esc closes, focus back on button');
  await p.keyboard.press('Enter'); await sleep(300);
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await sleep(600);
  check(await p.waitForFunction(() => window.__stkLive.state.acct && window.__stkLive.state.acct.id.startsWith('123'), null, { timeout: 8000 }).then(() => true, () => false), tag + ': kbd: Enter on account row picks it');
  await p.evaluate(() => window.__stkLive.leave(true)); await sleep(500);
};
const openMenu = async (p, inBar) => {
  if (inBar) await p.click('#stkc-paper-btn');
  else { if (await p.evaluate(() => { const m = document.getElementById('stkc-more-pop'); return !m || m.hidden || !m.getBoundingClientRect().width; })) { await p.click('#stkc-more-btn'); await sleep(300); } await p.evaluate(() => document.querySelector('#stkc-more-pop [data-ob-label]#stkc-paper-btn, #stkc-more-pop #stkc-paper-btn').click()); }
  await sleep(250);
  if (process.env.DBG) console.log('DBG openMenu', JSON.stringify(await p.evaluate(() => { const t = document.getElementById('stkc-trade-pop'), r = t.getBoundingClientRect(), mp = document.getElementById('stkc-more-pop'); return { hidden: t.hidden, r: [r.left, r.top, r.width, r.height], disp: getComputedStyle(t).display, vis: getComputedStyle(t).visibility, parent: t.parentElement && t.parentElement.id, more: mp && mp.hidden, btnIn: !!document.querySelector('#stkc-more-pop #stkc-paper-btn'), panel: !!document.querySelector('.stkpt-panel:not([hidden])') }; })));
};
const popShot = async (p, file) => { const el = await p.$('#stkc-trade-pop'); if (el) await el.screenshot({ path: file }); };

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
  }
  await openMenu(p, inBar);
  const m0 = await menuProbe(p);
  check(m0.rows.find((r) => r.id === '123').skel, tag + ': balance shows a skeleton while loading', m0.rows.map((r) => r.bal + (r.skel ? '[skel]' : '')));
  await p.waitForFunction(() => !document.querySelector('#stkc-trade-pop .stktm-skel'), null, { timeout: 5000 }).catch(() => {});
  const items = await rowsText(p);
  check(items.join('|') === 'paper:Paper trading ✓|live:Tradovate APEX-1234567-01|live:Topstep 50K combine (practice) TOPSTEP50K-PRACTICE-88001234|connect:Connect a broker', tag + ': rows: label or broker + the broker account number (never …2029, never a UUID)', items);
  check(!(await p.evaluate(() => /2029|…|[0-9a-f]{8}-[0-9a-f]{4}/.test(document.getElementById('stkc-trade-pop').innerText))), tag + ': no internal id / last-4 mask / UUID text in the menu');
  const menu = await menuProbe(p); console.log('MENU ' + tag + ' ' + JSON.stringify(menu));
  check(menu.logos === 2 && menu.imgOk === 2 && menu.imgSrc.join() === 'tradovate.png,rithmic.png', tag + ': 2 broker brand marks load', menu.imgSrc);
  const r1 = menu.rows.find((r) => r.id === '123'), r2 = menu.rows.find((r) => r.id === '223'), r0 = menu.rows[0];
  check(r1.bal === '$50,312.40+$312.40' && r2.bal === '—' && /^\$[\d,]+\.\d\d/.test(r0.bal), tag + ': balances: $50,312.40 (+open P&L), "—" when none, paper balance', menu.rows.map((r) => r.bal));
  check(M.calls.filter((c) => c.body.op === 'balances').length === 2, tag + ': one balances read per account on open', M.calls.filter((c) => c.body.op === 'balances').length);
  check(/Archivo Tnum/.test(r1.numFont), tag + ': account number in the data font (Archivo, tabular digits; no mono since 17 Nov)', r1.numFont);
  check(menu.rows.every((r) => r.cySpread <= 1), tag + ': each row: logo, text, buttons, tick on one centre (±1px)', menu.rows.map((r) => r.cySpread));
  check(menu.rows.every((r) => r.logo === '28x28'), tag + ': logos 28x28', menu.rows.map((r) => r.logo));
  const L0 = menu.rows.map((r) => r.logoL), T0 = menu.rows.map((r) => r.tickR);
  check(Math.max(...L0) - Math.min(...L0) <= 0.5 && Math.max(...T0) - Math.min(...T0) <= 0.5 && Math.abs(L0[0] - T0[0]) <= 1, tag + ': logos share one left edge, ticks one right edge, equal left/right inset', { L0, T0 });
  check(menu.rows.every((r) => r.gapLogoTx === 12), tag + ': 12px logo-to-text gap', menu.rows.map((r) => r.gapLogoTx));
  const actSz = mobile ? '40x40' : '32x32';
  check([r1, r2].every((r) => r.acts.length === 2 && r.acts.every((a) => a === actSz)), tag + ': pencil + disconnect hit areas ' + actSz, [r1.acts, r2.acts]);
  if (mobile) check([r1, r2].every((r) => r.actOpacity.every((o) => o === '1')), tag + ': touch: icon buttons always visible', [r1.actOpacity, r2.actOpacity]);
  else check(menu.rows.filter((r) => r.acts.length && r.id !== 'pap').every((r) => r.actOpacity.some((o) => o === '0') || r.id === '123'), tag + ': desktop: broker icon buttons hidden until hover/focus', menu.rows.map((r) => r.actOpacity));
  // 2026-11-17: Paper row = reserved edit slot + disconnect (always visible while paper is on), same columns as the broker rows
  const r0p = menu.rows.find((r) => r.id === 'pap');
  check(r0p && r0p.phR != null && Math.abs(r0p.phR - r1.editR) <= 0.5 && (r0p.acts.length === 0 || (r0p.acts[0] === actSz && r0p.actOpacity[0] === '1' && Math.abs(r0p.offR - r1.offR) <= 0.5)), tag + ': Paper row: edit slot + disconnect line up with the broker rows\' columns', { r0p, r1 });
  check(menu.rows.every((r) => r.h >= 56) && menu.rows.every((r) => r.lines >= 0 && r.lines <= 4), tag + ': rows >= 56px, two lines', menu.rows.map((r) => r.h + '/' + r.lines));
  check(menu.foot && menu.foot.cySpread <= 1 && menu.foot.addH === menu.foot.manH && Math.abs(menu.foot.padL - menu.foot.padR) <= 1, tag + ': footer pills: same height, one centre, equal inset', menu.foot);
  check(menu.padL === menu.padR && menu.scrollW, tag + ': menu padding equal, no sideways scroll', [menu.padL, menu.padR]);
  if (!mobile) { await p.hover('#stkc-trade-pop .stktm-row[data-row="' + ACC + '"]'); await sleep(200); }
  await p.screenshot({ path: OUT + '/trade-' + tag + '-menu.png' }); await popShot(p, OUT + '/crop-menu-' + tag + '.png');
  if (!mobile) {
    // copy-on-click: the number copies, the row is NOT picked
    await p.evaluate(() => { window.__copied = ''; try { navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; } catch (e) {} });
    await p.click('#stkc-trade-pop .stktm-row[data-row="' + ACC + '"] .stktm-num'); await sleep(200);
    const cp = await p.evaluate(() => ({ c: window.__copied, t: window.__toasts.slice(-1)[0], acct: !!window.__stkLive.state.acct, open: !document.getElementById('stkc-trade-pop').hidden }));
    check(cp.c === 'APEX-1234567-01' && /copied/i.test(cp.t) && !cp.acct && cp.open, tag + ': click on the number copies it (no pick, menu stays open)', cp);
    await p.keyboard.press('Escape'); await sleep(150); await p.mouse.move(5, 400); await openMenu(p, inBar);
    await keyboardTest(p, tag);
    await openMenu(p, inBar);
  }
  // ---- pencil: label + prop firm + type, saved to students/u1/brokerAccounts/ACC and shown in the row + the Trade button
  if (!mobile) await p.hover('#stkc-trade-pop .stktm-row[data-row="' + ACC + '"]');
  await p.click('#stkc-trade-pop [data-x=edit][data-id="' + ACC + '"]'); await sleep(250);
  check(await p.evaluate(() => !!document.querySelector('#stkc-trade-pop .stktm-ed') && document.querySelectorAll('#stkc-trade-pop .stktm-ed select option').length === 14), tag + ': editor opens with the firm list (12 + None + Other)');
  await p.fill('#stkc-trade-pop .stktm-ed [name=label]', 'Apex 150K evaluation account 1');
  await p.selectOption('#stkc-trade-pop .stktm-ed select', 'Apex');
  await p.click('#stkc-trade-pop .stktm-ed [data-ty=eval]');
  const edM = await p.evaluate(() => { const ed = document.querySelector('#stkc-trade-pop .stktm-ed'), P = document.getElementById('stkc-trade-pop').getBoundingClientRect(), E = ed.getBoundingClientRect(), cs = getComputedStyle(ed);
    const btns = [...ed.querySelectorAll('.stktm-ed-btns .stktm-pill')].map((b) => { const r = b.getBoundingClientRect(); return { h: Math.round(r.height), cy: Math.round(r.top + r.height / 2) }; });
    const fields = [...ed.querySelectorAll('input:not([hidden]), select')].filter((x) => x.offsetParent).map((x) => Math.round(x.getBoundingClientRect().height));
    return { padL: cs.paddingLeft, padR: cs.paddingRight, gap: cs.rowGap, btns, fields, insideL: Math.round(E.left - P.left), insideR: Math.round(P.right - E.right), segH: [...ed.querySelectorAll('.stktm-seg button')].map((b) => Math.round(b.getBoundingClientRect().height)) }; });
  console.log('EDITOR ' + tag + ' ' + JSON.stringify(edM));
  check(edM.padL === edM.padR && edM.btns[0].h === edM.btns[1].h && edM.btns[0].cy === edM.btns[1].cy && new Set(edM.fields).size === 1 && edM.insideL === edM.insideR, tag + ': editor: equal padding, same-height fields and buttons, one button centre', edM);
  await p.screenshot({ path: OUT + '/trade-' + tag + '-edit.png' }); await popShot(p, OUT + '/crop-edit-' + tag + '.png');
  await p.click('#stkc-trade-pop .stktm-ed .stktm-pri'); await sleep(400);
  const wr = await p.evaluate(() => window.__metaWrites.slice(-1)[0]);
  check(wr && wr.u === 'u1' && wr.id === '123e4567-e89b-12d3-a456-426614174000' && wr.v.label === 'Apex 150K evaluation account 1' && wr.v.firm === 'Apex' && wr.v.type === 'eval' && wr.v.updatedAt === 'TS' && Object.keys(wr.v).sort().join() === 'firm,label,type,updatedAt', tag + ': saved to students/u1/brokerAccounts/<accountId> with exactly label, firm, type, server time', wr);
  const it2 = await rowsText(p);
  check(it2[1] === 'live:Apex 150K evaluation account 1 APEX-1234567-01', tag + ': row now shows the label + the account number', it2);
  const sub = await p.$eval('#stkc-trade-pop .stktm-row[data-row="' + ACC + '"] .stktm-meta', (e) => e.textContent);
  check(sub === 'Apex · Tradovate · Evaluation', tag + ': second line: firm · broker · type (status = dot)', sub);
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('stryker_broker_meta_u1') || '{}')['123e4567-e89b-12d3-a456-426614174000'].firm === 'Apex'), tag + ': mirrored in localStorage');
  // localStorage fallback when Firestore is unreachable
  await p.evaluate(() => { window.__metaFail = true; });
  await p.click('#stkc-trade-pop [data-x=edit][data-id="' + ACC2 + '"]'); await sleep(200);
  await p.selectOption('#stkc-trade-pop .stktm-ed select', '__other'); await p.fill('#stkc-trade-pop .stktm-ed [name=other]', 'Funded Next Futures');
  await p.click('#stkc-trade-pop .stktm-ed .stktm-pri'); await sleep(400);
  const fb = await p.evaluate(() => ({ t: window.__toasts.slice(-1)[0], ls: JSON.parse(localStorage.getItem('stryker_broker_meta_u1') || '{}')['223e4567-e89b-12d3-a456-426614174001'], meta: document.querySelector('#stkc-trade-pop .stktm-row[data-row="223e4567-e89b-12d3-a456-426614174001"] .stktm-meta').textContent }));
  check(/this device/i.test(fb.t) && fb.ls.firm === 'Funded Next Futures' && /^Funded Next Futures · Rithmic/.test(fb.meta), tag + ': Firestore down: kept in localStorage, free-text firm shown', fb);
  await p.evaluate(() => { window.__metaFail = false; });
  // pick the account: the Trade button carries label + firm
  await p.evaluate((id) => document.querySelector('#stkc-trade-pop .stktm-pick[data-id="' + id + '"]').click(), ACC);
  await p.waitForFunction(() => window.__stkLive.state.acct && window.__stkLive.state.placeSchema, null, { timeout: 10000 });
  await sleep(400);
  const lbl = await p.evaluate(() => { const b = document.getElementById('stkc-paper-btn'); return { t: b.querySelector('.stkc-btn-l').textContent, logo: (b.querySelector('.stktm-logo img') || {}).src || '', dot: !!b.querySelector('.stktm-live'), aria: b.getAttribute('aria-label'), title: b.title }; });
  check(lbl.t === 'Apex 150K evaluation account 1 · Apex' && /tradovate\.png$/.test(lbl.logo) && lbl.dot && /Tradovate APEX-1234567-01/.test(lbl.aria + lbl.title), tag + ': Trade button = brand mark + label · firm + live dot; full account in aria/title', lbl);
  check(await p.waitForFunction(() => { const o = document.getElementById('stkop'); return o && !o.hidden && o.classList.contains('is-live'); }, null, { timeout: 8000 }).then(() => true, () => false), tag + ': picking the account opens the floating order panel on it (order panel 2026-11-16)');
  if (inBar) { const m2 = await barMeasure(p); console.log('ALIGN-LIVE ' + tag + ' ' + JSON.stringify(m2)); check(m2.cySpread <= 1 && m2.tradeH === m2.dsH, tag + ': one centre line with the long label', m2); }
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ': no horizontal page scroll');
  // ---- disconnect the ACTIVE account: confirm -> revoke its grant -> Paper -> list refreshed
  await openMenu(p, inBar); await sleep(200);
  if (!mobile) await p.hover('#stkc-trade-pop .stktm-row[data-row="' + ACC + '"]');
  if (theme === 'light' || w === 1440) await p.screenshot({ path: OUT + '/trade-' + tag + '-menu-live.png' });
  await popShot(p, OUT + '/crop-menu-live-' + tag + '.png');
  await p.click('#stkc-trade-pop [data-x=off][data-id="' + ACC + '"]'); await sleep(300);
  const dlg = await p.evaluate(() => { const d = document.querySelector('#stktm-dlg [role=alertdialog]'); if (!d) return null; const bs = [...d.querySelectorAll('.stktm-dlg-btns .stktm-pill')].map((b) => { const r = b.getBoundingClientRect(); return { h: Math.round(r.height), cy: Math.round(r.top + r.height / 2) }; }); return { h: d.querySelector('h2').textContent, p: d.querySelector('#stktm-dlg-d').textContent, focus: document.activeElement.dataset.k, bs, menuHidden: document.getElementById('stkc-trade-pop').hidden }; });
  check(dlg && dlg.h === 'Disconnect Tradovate APEX-1234567-01?' && /You can connect it again any time\./.test(dlg.p) && dlg.focus === 'no' && dlg.menuHidden, tag + ': confirm dialog wording, focus on Cancel', dlg);
  check(dlg && dlg.bs[0].h === dlg.bs[1].h && dlg.bs[0].cy === dlg.bs[1].cy, tag + ': dialog buttons same height, one centre', dlg && dlg.bs);
  await p.screenshot({ path: OUT + '/trade-' + tag + '-disconnect.png' });
  await p.keyboard.press('Escape'); await sleep(150);
  check(await p.evaluate(() => !document.getElementById('stktm-dlg') && !!window.__stkLive.state.acct) && !M.calls.some((c) => c.body.op === 'revoke'), tag + ': Esc cancels, nothing revoked, still live');
  await openMenu(p, inBar);
  if (!mobile) await p.hover('#stkc-trade-pop .stktm-row[data-row="' + ACC + '"]');
  await p.click('#stkc-trade-pop [data-x=off][data-id="' + ACC + '"]'); await sleep(200);
  await p.click('#stktm-dlg [data-k=yes]');
  await p.waitForFunction(() => !document.getElementById('stktm-dlg'), null, { timeout: 8000 }).catch(() => {});
  await sleep(500);
  const rv = M.calls.filter((c) => c.body.op === 'revoke').map((c) => c.body.grantId);
  check(rv.length === 1 && rv[0] === G1, tag + ': revoke called once with the Tradovate account\'s grant', rv);
  const after = await p.evaluate(() => ({ acct: !!window.__stkLive.state.acct, ids: window.__stkLive.state.accounts.map((a) => a.id.slice(0, 3)), btn: document.querySelector('#stkc-paper-btn .stkc-btn-l').textContent, t: window.__toasts.slice(-1)[0] }));
  check(!after.acct && after.btn === 'Paper' && after.ids.join() === '223' && /disconnected/i.test(after.t), tag + ': back on Paper, list refreshed without the account', after);
  check(!writes(M).length, tag + ': no order sent');
  check(errors.length === 0, tag + ': no console errors ' + errors.slice(0, 2).join(' | '));
  await ctx.close();
}

async function member(b) {
  const { ctx, p, M } = await open(b, { w: 1440, h: 900, theme: 'dark', admin: false });
  await sleep(2500);
  check(await p.$('#stkc-paper-btn') !== null, 'member: Trade button present');
  await p.click('#stkc-paper-btn'); await sleep(300);
  const items = await rowsText(p);
  check(items.join('|') === 'paper:Paper trading ✓', 'member: menu has Paper trading only', items);
  const t = await p.evaluate(() => ({ txt: document.getElementById('stkc-trade-pop').innerText + document.getElementById('stkc-paper-btn').innerText, acts: document.querySelectorAll('#stkc-trade-pop .stktm-act:not([data-x=paperoff]),#stkc-trade-pop .stktm-logo img,#stkc-trade-pop .stktm-foot').length, bal: (document.querySelector('#stkc-trade-pop .stktm-bal') || {}).textContent || '' }));
  check(!/tradovate|rithmic|broker|finatic|live|disconnect/i.test(t.txt) && t.acts === 0, 'member: no broker words, logos, edit/disconnect buttons or footer', t);
  check(/^\$[\d,]+\.\d\d/.test(t.bal), 'member: paper balance shown', t.bal);
  await p.screenshot({ path: OUT + '/trade-member-menu.png' });
  await p.evaluate(() => document.querySelector('#stkc-trade-pop [data-a=paper]').click()); await sleep(500);
  check(M.calls.length === 0, 'member: no broker calls');
  check(await p.evaluate(() => window.__metaWrites.length === 0), 'member: no account-notes reads/writes');
  await ctx.close();
}
async function connectRow(b) {
  const { ctx, p } = await open(b, { w: 1440, h: 900, theme: 'dark', connected: false });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.connect && window.__stkLive.state.loaded, null, { timeout: 20000 });
  await p.evaluate(() => { window.open = () => ({ location: {}, close() {} }); });
  await p.click('#stkc-paper-btn'); await sleep(300);
  const items = await rowsText(p);
  check(items.join('|') === 'paper:Paper trading ✓|connect:Connect a broker', 'admin, none connected: Paper + Connect a broker', items);
  await p.evaluate(() => document.querySelector('#stkc-trade-pop [data-a=connect]').click());
  check(await p.waitForSelector('#fjs', { timeout: 10000 }).then(() => true, () => false), 'Connect a broker… opens the connect sheet');
  await ctx.close();
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  const only = process.env.ONLY || '';
  try {
    if (!only) { await member(b); await connectRow(b); }
    for (const [w, h, mobile, theme] of [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [412, 915, true, 'dark'], [412, 915, true, 'light'], [390, 844, true, 'dark'], [390, 844, true, 'light']]) if (!only || only === w + '-' + theme) await run(b, w, h, mobile, theme);
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
