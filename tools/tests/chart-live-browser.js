// ZoroCharts LIVE broker orders (admin only, 2026-11-15) browser test. EVERY /connect/finatic/* call is answered by a local mock in this
// file: no request ever leaves 127.0.0.1, no real order can be sent. Runs 1440 / 412 / 390, dark + light.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-live-browser.js <shotsDir>
// ORDER PANEL (2026-11-16): the floating panel (assets/chart-order-panel.js) replaces the bottom live strip: Scalp Buy/Sell + qty cap,
// Join Bid/Ask = limit at the best bid/ask, Order tab (limit tick-rounding; Stop/SL/TP/Trail disabled live with the reason), DOM tab
// embeds the ladder, footer kill switch, Flatten, 10 orders/min, 2-contract cap; members: the same panel on PAPER with SL/TP bracket,
// Trail, Stop, Join Bid/Ask, hotkeys (off by default), remembered position/size/tab; phone = bottom sheet. Waits on state, not sleeps.
// Checks: picker hidden for non-admins; Paper is the default; picking the account -> red LIVE badge (panel + chart); first order needs the
// contract typed; then a tap; "skip" after the first; payload (contract, qty, idemKey unique); read failure blocks; working-order + position
// lines; drag = modify (confirm); cancel+new when modify isn't allowed; DOM ladder click = limit at that price; flatten = server op with
// a key; Connect a broker opens the Nemesis sheet; alignment numbers (getBoundingClientRect) printed for the report.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/chartlive';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, +(process.env.XLEN || 400)) : '')); };
const globex = (s) => { const d = new Date((s - 5 * 3600) * 1000), wd = d.getUTCDay(), h = d.getUTCHours(); return !(wd === 6 || (wd === 5 && h >= 17) || (wd === 0 && h < 18) || h === 17); };   // EST approx (fixture)
const ACC = '123e4567-e89b-12d3-a456-426614174000', US = '0aaa1111-2222-3333-4444-555566667777';

async function open(b, { w, h, mobile, theme, admin = true, connected = true, flat = false }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(({ t, admin, connected, US }) => {
    window.__stkLiveTest = { isAdmin: () => admin, last: () => 28750 };
    window.__stkOpTest = { q: { bid: 28749.75, ask: 28750 }, quote() { return this.q; } };   // order panel best bid / ask fixture (localhost only)
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
    const bars = []; for (let t = page * P; t < (page + 1) * P && t <= now; t += 60) { const m = t / 60, c = flat ? 28750 : Math.round((28750 + 6 * Math.sin(m / 9)) * 4) / 4; /* flat: member paper fills land on 28,750 */ bars.push([t, c - 0.5, c + 1.5, c - 1.5, c, 100]); }
    if (process.env.DBG) console.log('DBG route', u.pathname + u.search, bars.length);
    return r.fulfill({ json: { s: 'NQ', tf: '1', page, bars, rt: true } });
  });
  const M = { calls: [], positions: [], orders: [], failRead: false, modify: true, n: 0, delay: 0 };
  ctx.M = M;
  const j = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/connect/finatic/**', async (r) => {
    const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    M.calls.push({ path: u.pathname, body, at: Date.now() });
    if (M.delay && u.pathname.endsWith('/order') && ['place', 'cancel', 'modify', 'flatten'].includes(body.op)) await sleep(M.delay);
    if (!admin) return r.fulfill(j({ error: 'Admins only' }, 403));
    if (u.pathname.endsWith('/session') && r.request().method() === 'GET') return r.fulfill(j({ configured: true }));
    if (u.pathname.endsWith('/session')) return r.fulfill(j({ portalUrl: 'http://127.0.0.1:1/portal', sessionId: 's1' }));
    if (u.pathname.endsWith('/data')) {
      if (body.op === 'accounts') return r.fulfill(j({ userId: US, data: [{ accountId: ACC, accountName: 'DEMO 5551234', accountNumber: 'DEMO5551234', brokerName: 'tradovate' }] }));
      if (body.op === 'live') return M.failRead ? r.fulfill(j({ error: 'Broker data is unavailable right now', code: 'upstream' }, 503)) : r.fulfill(j({ data: { positions: M.positions, orders: M.orders } }));
      return r.fulfill(j({ data: [] }));
    }
    if (u.pathname.endsWith('/order')) {
      if (body.op === 'env') return r.fulfill(j({ env: 'live', enabled: true }));
      if (body.op === 'schema') return body.action === 'modify' && !M.modify ? r.fulfill(j({ error: 'not supported', code: 'upstream' }, 503)) : r.fulfill(j({ data: { fields: { symbol: {}, orderQty: {} } }, env: 'live' }));
      M.n++;
      if (body.op === 'place' && M.timing) { const x = j({ ok: true, accepted: true, orderId: 'o' + M.n, status: 'SUBMITTED' }); x.headers = { 'server-timing': 'auth;dur=1, fin;dur=61, total;dur=70' }; if (body.type === 'limit') M.orders.push({ orderId: 'o' + M.n, status: 'SUBMITTED', orderType: 'LIMIT', legs: [{ securityId: body.symbol, side: body.side.toUpperCase(), quantity: body.qty, limitPrice: body.limitPrice }] }); return r.fulfill(x); }
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
  p.on('pageerror', (e) => { errors.push(String(e)); if (process.env.DBG) console.log('DBG stack', e.stack); });
  p.on('crash', () => { errors.push('renderer crashed'); console.log('FAIL renderer crashed'); });
  if (process.env.DBG) p.on('console', (m) => console.log('DBG', m.type(), m.text().slice(0, 300)));
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

// ---- floating order panel helpers (assets/chart-order-panel.js, 2026-11-16) ----
const opWait = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 10000 }).then(() => true, () => false);
const toastsSince = (p, n) => p.evaluate((n) => window.__toasts.slice(n).concat((window.__stkPaper.toasts || []).map((t) => t.msg)), n);
async function openOP(p, mobile) {
  const inBar = await p.evaluate(() => { const t = document.getElementById('stkc-paper-btn'); return !!(t && t.getBoundingClientRect().width > 0 && !t.closest('.stkc-ob-pop')); });
  // Trade button = the account menu (main 2026-11-16); its checked row (Paper or the active live account) opens the panel
  if (inBar) { await tap(p, '#stkc-paper-btn', mobile); await p.waitForSelector('#stkc-trade-pop:not([hidden]) .stktm-pick[aria-checked=true]', { timeout: 5000 }); await p.evaluate(() => document.querySelector('#stkc-trade-pop .stktm-pick[aria-checked=true]').click()); }   // the row's centre holds the edit / disconnect icons
  else await p.evaluate(() => window.__stkPaper.orderPanel());
  return opWait(p, () => { const o = document.getElementById('stkop'); return o && !o.hidden && o.getBoundingClientRect().height > 100; });
}
const opTab = async (p, t, mobile) => { await tap(p, '#stkop .stkop-tabs [data-tab=' + t + ']', mobile); await opWait(p, (t) => document.getElementById('stkop').dataset.tab === t, t); };
const blockFree = (p) => opWait(p, () => window.__stkLive.blockReason === '' && !window.__stkLive.state.busy, null, 10000);
async function confirmYes(p, mobile) { const ok = await p.waitForSelector('#stklv-cf', { timeout: 5000 }).then(() => true, () => false); if (ok) await tap(p, '#stklv-cf [data-k=yes]', mobile); return ok; }
const nWrites = (M, n) => (p) => p.waitForFunction(() => true).then(() => writes(M).length >= n);
async function waitWrites(p, M, n, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 8000)) { if (writes(M).length >= n) return true; await sleep(100); } return writes(M).length >= n; }

async function run(b, w, h, mobile, theme) {
  const tag = w + '-' + theme;
  const { ctx, p, errors, M } = await open(b, { w, h, mobile, theme });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.pick && window.__stkLive.state.accounts.length, null, { timeout: 20000 });
  check(await openOP(p, mobile), tag + ': Trade opens the floating order panel');
  // footer account picker: Paper first + default, then the broker account as broker + last 4
  await opWait(p, () => document.querySelector('#stkop select[data-f=acct] option[value="123e4567-e89b-12d3-a456-426614174000"]'));
  const opts = await p.$$eval('#stkop select[data-f=acct] option', (o) => o.map((x) => [x.value, x.textContent]));
  check(opts[0][0] === '' && opts[0][1] === 'Paper' && (await p.$eval('#stkop select[data-f=acct]', (s) => s.value)) === '', tag + ': Paper is the first and default account', opts);
  check(opts.some((o) => o[1] === 'Tradovate DEMO5551234'), tag + ': account shown as broker + the account number the broker shows', opts);
  check(!(await p.evaluate(() => /finatic/i.test(document.getElementById('stkop').innerText))), tag + ': no vendor name in the panel');
  // pick live
  await p.selectOption('#stkop select[data-f=acct]', ACC);
  await p.waitForFunction(() => document.querySelector('#stkop.is-live') && window.__stkLive.state.lastOkStart > 0 && window.__stkLive.state.placeSchema, null, { timeout: 10000 });
  await p.evaluate(() => window.__stkPaper.account && window.__stkPaper.account.setLast('futures:NQ1!', 28750));
  const code = await p.evaluate(() => window.__stkLive.info('futures:NQ1!').code);
  check(/^NQ[HMUZ]\d$/.test(code), tag + ': NQ1! maps to the front month ' + code);
  await opWait(p, () => /^NQ/.test(document.querySelector('.stkop-sym small').textContent));
  const hd = await p.evaluate(() => ({ sym: document.querySelector('.stkop-sym b').textContent, code: document.querySelector('.stkop-sym small').textContent, live: (document.querySelector('#stkop .stkop-chip.live') || {}).textContent, liveBg: (() => { const e = document.querySelector('#stkop .stkop-chip.live'); return e ? getComputedStyle(e).backgroundColor : ''; })(), strip: (() => { const s = document.getElementById('stkpt'); return !s || s.hidden || getComputedStyle(s).display === 'none'; })(), chip: (document.querySelector('.stkop-lchip') || {}).textContent || '', cbadge: (document.querySelector('.stklv-cbadge') || {}).textContent || '' }));
  check(hd.sym === 'CME:NQ' && hd.code === code, tag + ': header CME:NQ with the contract small', hd);
  check(hd.live === 'LIVE' && hd.liveBg === 'rgb(217, 45, 32)', tag + ': red LIVE badge in the footer', hd);
  check(hd.strip, tag + ': old bottom "Live trading" strip is gone while live', hd);
  check(/^LIVE …1234 · NQ/.test(hd.chip), tag + ': small LIVE status chip on the chart', hd);
  check(/^LIVE Tradovate DEMO5551234 · NQ[HMUZ]\d$/.test(hd.cbadge), tag + ': red LIVE badge on the chart with the contract', hd);
  // ---- Scalp: Buy market. First live order = typed contract
  await opTab(p, 'scalp', mobile);
  await blockFree(p);
  if (theme === 'dark' || w === 1440) await p.screenshot({ path: OUT + '/op-' + tag + '-1-scalp-live.png' });
  await tap(p, '#stkop .stkop-scalp [data-a=buy]', mobile);
  await p.waitForSelector('#stklv-cf');
  const cf1 = await p.evaluate(() => ({ t: document.getElementById('stklv-cf').innerText, dis: document.querySelector('#stklv-cf [data-k=yes]').disabled, typing: !!document.querySelector('.stklv-cf-type input') }));
  check(cf1.typing && cf1.dis && cf1.t.includes(code) && /Tradovate DEMO5551234/.test(cf1.t), tag + ': first live order needs the contract typed', cf1);
  await p.fill('.stklv-cf-type input', 'NQ'); check(await p.$eval('#stklv-cf [data-k=yes]', (e) => e.disabled), tag + ': wrong text keeps Send disabled');
  if (theme === 'dark' || w === 1440) await p.screenshot({ path: OUT + '/op-' + tag + '-2-typed.png' });
  await p.fill('.stklv-cf-type input', code.toLowerCase());
  await tap(p, '#stklv-cf [data-k=yes]', mobile);
  await waitWrites(p, M, 1);
  let W = writes(M);
  check(W.length === 1 && W[0].op === 'place' && W[0].symbol === code && W[0].qty === 1 && W[0].type === 'market' && W[0].side === 'buy' && W[0].src === 'chart' && /^[A-Za-z0-9-]{16,64}$/.test(W[0].idemKey || '') && W[0].accountId === ACC, tag + ': Scalp Buy = market BUY 1 with contract + idemKey', W[0]);
  // SPEED (main 2026-11-16): the 'env' call that pre-warms the server carries the broker user; reads run straight after the write
  check(M.calls.some((c) => c.path.endsWith('/order') && c.body.op === 'env' && c.body.userId === US), tag + ': panel open pre-warms the server (env + userId)');
  { const wAt = M.calls.filter((c) => c.body.op === 'place').at(-1).at; let rAt = null;
    for (let k = 0; k < 30 && !rAt; k++) { rAt = M.calls.find((c) => c.body.op === 'live' && c.at > wAt); if (!rAt) await sleep(100); }
    check(rAt && rAt.at - wAt < 700, tag + ': positions re-read within 0.7 s of the order', rAt && rAt.at - wAt); }
  check(await opWait(p, () => /^Order sent in \d+ ms/.test(document.querySelector('#stkop [data-k=status]').textContent)), tag + ': panel status shows the measured round trip', await p.$eval('#stkop [data-k=status]', (e) => e.textContent.slice(0, 80)));
  // qty stepper: capped at 2 contracts live
  await p.evaluate(() => window.__stkLive.read()); await blockFree(p);
  await tap(p, '#stkop .stkop-scalp [data-q="1"]', mobile); await tap(p, '#stkop .stkop-scalp [data-q="1"]', mobile).catch(() => {});
  const qv = await p.evaluate(() => ({ v: document.querySelector('#stkop .stkop-scalp [data-f=qty]').value, plus: document.querySelector('#stkop .stkop-scalp [data-q="1"]').disabled }));
  check(qv.v === '2' && qv.plus, tag + ': live quantity stepper stops at 2 contracts', qv);
  await tap(p, '#stkop .stkop-scalp [data-q="-1"]', mobile);
  // ---- Join Ask = SELL LIMIT at the best ask (second order = one tap)
  const jd = await p.evaluate(() => ({ bid: document.querySelector('#stkop .stkop-join.bid b').textContent, ask: document.querySelector('#stkop .stkop-join.ask b').textContent, bidC: getComputedStyle(document.querySelector('#stkop .stkop-join.bid b')).color, askC: getComputedStyle(document.querySelector('#stkop .stkop-join.ask b')).color }));
  check(jd.bid === '28,749.75' && jd.ask === '28,750.00', tag + ': Join Bid / Join Ask show the live best bid / ask', jd);
  await p.evaluate(() => { window.__stkOpTest.q = { bid: 28755.75, ask: 28756 }; });
  await opWait(p, () => document.querySelector('#stkop .stkop-join.ask b').textContent === '28,756.00');
  check(true, tag + ': bid / ask update live');
  await blockFree(p);
  await tap(p, '#stkop [data-a=jask]', mobile);
  await p.waitForSelector('#stklv-cf');
  const cf2 = await p.evaluate(() => ({ typing: !!document.querySelector('.stklv-cf-type input'), skip: !!document.querySelector('#stklv-cf [data-k=skip]'), t: document.getElementById('stklv-cf').innerText }));
  check(!cf2.typing && cf2.skip && /SELL 1 NQ.. LIMIT @ 28,756.00/.test(cf2.t), tag + ': Join Ask = SELL LIMIT at the ask, one tap', cf2);
  if (theme === 'dark' || w === 1440) await p.screenshot({ path: OUT + '/op-' + tag + '-3-tap.png' });
  M.delay = 1200; M.timing = true;
  await tap(p, '#stklv-cf [data-k=yes]', mobile);
  { const okS = await opWait(p, () => [...document.querySelectorAll('.stkpt-chip[data-live]')].some((c) => /^SENDING SELL 1 LMT/.test(c.textContent)), null, 1000);
    const sending = await p.evaluate(() => ({ chips: [...document.querySelectorAll('.stkpt-chip[data-live]')].map((c) => c.textContent), st: document.querySelector('#stkop [data-k=status]').textContent }));
    check(okS && sending.chips.some((t) => /^SENDING SELL 1 LMT28,756\.00/.test(t)) && /^Sending/.test(sending.st), tag + ': order line drawn at once as SENDING while the broker answers', sending);
    if (theme === 'dark' || w === 1440) await p.screenshot({ path: OUT + '/op-' + tag + '-3b-sending.png' });
    const nW = writes(M).length; await p.evaluate(() => { const c = [...document.querySelectorAll('.stkpt-chip[data-live]')].find((x) => /SENDING/.test(x.textContent)); if (c) c.querySelector('.stkpt-chip-x').click(); });
    check(writes(M).length === nW, tag + ': × on a SENDING line sends nothing'); }
  await waitWrites(p, M, 2);
  await opWait(p, () => !window.__stkLive.state.busy, null, 5000); M.delay = 0;
  await opWait(p, () => /^Order sent in/.test(document.querySelector('#stkop [data-k=status]').textContent), null, 6000);   // after the confirming read
  { const after = await p.evaluate(() => ({ chips: [...document.querySelectorAll('.stkpt-chip[data-live]')].map((c) => c.textContent), st: document.querySelector('#stkop [data-k=status]').textContent }));
    check(!after.chips.some((t) => /SENDING/.test(t)) && /^Order sent in \d{4} ms \(broker 61 ms\)\./.test(after.st), tag + ': SENDING line gone on the answer; status: round trip + broker time from Server-Timing', after); }
  M.timing = false;
  W = writes(M);
  check(W.length === 2 && W[1].type === 'limit' && W[1].limitPrice === 28756 && W[1].side === 'sell' && W[1].idemKey !== W[0].idemKey, tag + ': SELL limit sent, fresh idemKey', W[1]);
  await p.evaluate(() => { window.__stkOpTest.q = { bid: 28749.75, ask: 28750 }; });
  await p.evaluate(() => window.__stkLive.read()); await blockFree(p);
  const ft = await p.evaluate(() => ({ pos: document.querySelector('#stkop [data-k=pos]').textContent, wk: document.querySelector('#stkop [data-k=wk]').textContent }));
  check(/^Long 1 NQ/.test(ft.pos) && ft.wk === '1 working', tag + ': footer shows the live position + working count', ft);
  // working-order + position lines on the chart
  const chips = await p.evaluate(() => [...document.querySelectorAll('.stkpt-chip[data-live]')].map((c) => [c.dataset.kind, c.textContent]));
  check(chips.some((c) => c[0] === 'pos' && /LIVE LONG 1/.test(c[1])) && chips.some((c) => c[0] === 'ord' && /LIVE SELL LMT 1/.test(c[1])), tag + ': live position + working order lines on the chart', chips);
  // ---- Order tab: Stop / SL / TP disabled with the reason (the chart route takes market + limit only)
  await opTab(p, 'order', mobile);
  const od = await p.evaluate(() => ({ stop: document.querySelector('#stkop [data-type=stop]').disabled, sl: document.querySelector('#stkop [data-f="sl.on"]').disabled, tp: document.querySelector('#stkop [data-f="tp.on"]').disabled, trail: document.querySelector('#stkop [data-f=trail]').disabled, why: document.querySelector('#stkop [data-k=why]').textContent, bid: document.querySelector('#stkop .stkop-side.buy em').textContent }));
  check(od.stop && od.sl && od.tp && od.trail && /market and limit orders from the chart only/.test(od.why), tag + ': live: Stop, SL, TP, Trail disabled with a short reason', od);
  check(od.bid === '28,749.75', tag + ': Buy card shows the live BID', od);
  // limit BUY at a typed price, tick-rounded; skip on -> straight out
  await p.evaluate(() => { window.__stkLive.state.skip = true; });
  await tap(p, '#stkop [data-type=limit]', mobile);
  await p.fill('#stkop [data-f=price]', '28745.1'); await p.locator('#stkop [data-f=price]').blur();
  check((await p.$eval('#stkop [data-f=price]', (e) => e.value)) === '28745.00', tag + ': limit price rounded to the tick');
  await blockFree(p);
  await tap(p, '#stkop [data-k=confirm]', mobile);
  await waitWrites(p, M, 3);
  W = writes(M);
  check(W.length === 3 && W[2].type === 'limit' && W[2].limitPrice === 28745 && W[2].side === 'buy' && !(await p.$('#stklv-cf')), tag + ': Order tab Confirm = BUY LIMIT 28,745 (skip honoured)', W[2]);
  if (theme === 'dark' || w === 1440) await p.screenshot({ path: OUT + '/op-' + tag + '-4-order-live.png' });
  // exposure: long 1 + working buy 1 = 2; one more buy is refused in the browser
  await p.evaluate(() => window.__stkLive.read()); await blockFree(p);
  await p.fill('#stkop [data-f=price]', '28744'); await p.locator('#stkop [data-f=price]').blur();
  const n0 = (await p.evaluate(() => window.__toasts.length));
  await tap(p, '#stkop [data-k=confirm]', mobile); await opWait(p, (n) => window.__toasts.length > n, n0, 4000);
  check(writes(M).length === 3 && /more than 2 contracts/.test((await toastsSince(p, n0)).join(' ')), tag + ': worst-case exposure over 2 contracts refused (2-contract cap)');
  // 10 orders a minute: the 11th is refused in the browser before any confirm
  await p.evaluate(() => { const t = Date.now(); window.__stkLive.state.sentAt = Array.from({ length: 10 }, () => t); });
  const n1 = (await p.evaluate(() => window.__toasts.length));
  await tap(p, '#stkop [data-type=market]', mobile); await tap(p, '#stkop [data-side=sell]', mobile);
  await tap(p, '#stkop [data-k=confirm]', mobile); await opWait(p, (n) => window.__toasts.length > n, n1, 4000);
  check(writes(M).length === 3 && !(await p.$('#stklv-cf')) && /Order limit: 10 a minute/.test((await toastsSince(p, n1)).join(' ')), tag + ': 10 orders a minute enforced', await toastsSince(p, n1));
  await p.evaluate(() => { window.__stkLive.state.sentAt = []; });
  // drag a working order = modify (confirm, never skipped)
  const ordChip = await p.evaluate(() => { const c = [...document.querySelectorAll('.stkpt-chip[data-live][data-kind=ord]')].find((x) => /SELL/.test(x.textContent)); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
  const nBefore0 = writes(M).length;
  if (ordChip && !mobile) {
    await p.evaluate(() => window.__stkOrderPanel.close());
    await p.mouse.move(ordChip.x, ordChip.y); await p.mouse.down(); await p.mouse.move(ordChip.x, ordChip.y - 30, { steps: 6 }); await p.mouse.up();
    const sheet = await p.waitForSelector('#stklv-cf', { timeout: 4000 }).then(() => true, () => false);
    check(sheet && /Move SELL 1/.test(await p.$eval('#stklv-cf', (e) => e.innerText)), tag + ': drag opens a Move confirm even with skip on');
    if (sheet) { await tap(p, '#stklv-cf [data-k=yes]', mobile); await waitWrites(p, M, nBefore0 + 1); }
    W = writes(M); check(W.at(-1).op === 'modify' && W.at(-1).limitPrice > 28756, tag + ': modify sent with the dragged price', W.at(-1));
    check(await openOP(p, mobile), tag + ": order panel opens again after the drag"); if (process.env.DBG2) { await p.screenshot({ path: OUT + "/dbg-reopen.png" }); console.log("DBG2", JSON.stringify(await p.evaluate(() => { const o = document.getElementById("stkop"); return { hidden: o.hidden, cls: o.className, tab: o.dataset.tab, r: o.getBoundingClientRect(), pop: !document.getElementById("stkc-trade-pop").hidden }; }))); }
  } else if (!mobile) check(false, tag + ': SELL order chip present for drag');
  // ---- DOM tab: the Book panel's ladder inside the order panel (desktop); a click = live LIMIT at that price
  if (!mobile) {
    await opTab(p, 'dom', mobile);
    const emb = await opWait(p, () => { const b = document.querySelector('#stkop .stkop-dom > .stkbp.stkbp-embed'); return b && !b.hidden && b.getBoundingClientRect().height > 100; });
    check(emb && (await p.evaluate(() => window.__stkBookPanel.embedded)), tag + ': DOM tab embeds the Book/DOM ladder');
    if (theme === 'dark' || w === 1440) await p.screenshot({ path: OUT + '/op-' + tag + '-5-dom.png' });
    await p.evaluate(() => { window.__stkLive.state.skip = false; window.__stkLive.state.reading = false; return window.__stkLive.read(); });
    check(await blockFree(p), tag + ': fresh read after the move: orders allowed again', await p.evaluate(() => window.__stkLive.blockReason));
    const nL = writes(M).length;
    await p.evaluate(() => { window.__stkPaper.live.ladder('futures:NQ1!', 'ask', 28770, 28749.75, 28750, 1); });   // don't await: it waits for the confirm
    const ls = await p.waitForSelector('#stklv-cf', { timeout: 5000 }).then(() => true, () => false); const lt = ls ? await p.$eval('#stklv-cf', (e) => e.innerText) : '';
    check(ls && /SELL 1 NQ.. LIMIT @ 28,770.00/.test(lt), tag + ': DOM ask click = live SELL LIMIT at the clicked price', [lt.slice(0, 160), await toastsSince(p, 0).then((t) => t.slice(-3)), await p.evaluate(() => window.__stkLive.blockReason)]);
    if (ls) await tap(p, '#stklv-cf [data-k=no]', mobile);
    await opWait(p, () => !document.getElementById('stklv-cf'));
    check(writes(M).length === nL, tag + ': Cancel in the confirm sends nothing');
    await opTab(p, 'scalp', mobile);
    check(await opWait(p, () => !window.__stkBookPanel.embedded), tag + ': leaving the DOM tab releases the ladder');
  }
  if (mobile) await opTab(p, 'scalp', mobile);   // phone sheet has Scalp + Order only (no DOM tab)
  // read failure blocks new orders
  M.failRead = true; await p.evaluate(() => { window.__stkLive.state.reading = false; return window.__stkLive.read(); });
  await opWait(p, () => !!window.__stkLive.state.readErr);
  // a failed read blocks once the last good read is older than 25 s (chart-live.js STALE_MS): age it instead of waiting 25 s
  await p.evaluate(() => { const S = window.__stkLive.state; S.lastOkStart = Date.now() - 30000; window.__stkLive.render && window.__stkLive.render(); });
  await opWait(p, () => document.querySelector('#stkop .stkop-scalp [data-a=buy]').disabled);
  const blk = await p.evaluate(() => ({ dis: document.querySelector('#stkop .stkop-scalp [data-a=buy]').disabled, st: document.querySelector('#stkop [data-k=status]').textContent }));
  check(blk.dis && /could not be read/.test(blk.st), tag + ': unreadable positions/orders = Buy disabled + reason', blk);
  M.failRead = false; await p.evaluate(() => { window.__stkLive.state.reading = false; return window.__stkLive.read(); });
  await p.waitForFunction(() => !window.__stkLive.state.readErr && !window.__stkLive.state.reading, null, { timeout: 10000 }).catch(() => {});
  // ---- kill switch: footer button -> confirm -> settings/liveTrading off -> every order blocked
  p.removeAllListeners('dialog'); p.on('dialog', (d) => d.accept());
  await tap(p, '#stkop [data-a=kill]', mobile);
  check(await opWait(p, () => window.__stkLive.state.killed === true && document.querySelector('#stkop [data-a=killon]')), tag + ': "Turn off live trading" switches live trading off');
  await opWait(p, () => document.querySelector('#stkop .stkop-scalp [data-a=buy]').disabled);
  check(await p.evaluate(() => document.querySelector('#stkop .stkop-scalp [data-a=buy]').disabled && /switched off/.test(document.querySelector('#stkop [data-k=status]').textContent)), tag + ': kill switch on = Buy disabled with the reason');
  if (theme === 'dark' || w === 1440) await p.screenshot({ path: OUT + '/op-' + tag + '-6-killed.png' });
  p.removeAllListeners('dialog'); p.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('LIVE') : d.accept()));
  await tap(p, '#stkop [data-a=killon]', mobile);
  check(await opWait(p, () => window.__stkLive.state.killed === false), tag + ': switched back on only after typing LIVE');
  p.removeAllListeners('dialog'); p.on('dialog', (d) => d.dismiss());
  // flatten from the footer: server op with a key, confirm never skippable
  await p.evaluate(() => { window.__stkLive.state.skip = true; });
  await blockFree(p);
  await tap(p, '#stkop [data-a=flat]', mobile);
  const fs2 = await p.waitForSelector('#stklv-cf', { timeout: 5000 }).then(() => true, () => false);
  check(fs2 && !(await p.$('#stklv-cf [data-k=skip]')), tag + ': Flatten confirm has no skip');
  if (fs2) { const nf = writes(M).length; await tap(p, '#stklv-cf [data-k=yes]', mobile); await waitWrites(p, M, nf + 1); }
  W = writes(M); check(W.at(-1).op === 'flatten' && W.at(-1).symbol === code && /^[A-Za-z0-9-]{16,64}$/.test(W.at(-1).idemKey), tag + ': Flatten = server op with a deterministic key', W.at(-1));
  // ---- alignment (getBoundingClientRect)
  await p.evaluate(() => window.__stkLive.read()); await blockFree(p);
  await opTab(p, 'scalp', mobile);
  const A = await alignOP(p);
  console.log('ALIGN ' + tag + ' ' + JSON.stringify(A));
  alignChecks(A, tag, mobile);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ': no horizontal page scroll');
  const opEl = await p.$('#stkop'); if (opEl) await opEl.screenshot({ path: OUT + '/crop-op-scalp-live-' + tag + '.png' });
  await opTab(p, 'order', mobile);
  const A2 = await alignOP(p); console.log('ALIGN-ORDER ' + tag + ' ' + JSON.stringify(A2)); alignChecks(A2, tag + ' order', mobile);
  if (opEl) await opEl.screenshot({ path: OUT + '/crop-op-order-live-' + tag + '.png' });
  // back to paper from the footer
  await p.selectOption('#stkop select[data-f=acct]', '');
  check(await opWait(p, () => !window.__stkLive.state.acct && !document.querySelector('#stkop.is-live') && !document.querySelector('.stklv-cbadge') && !document.querySelector('.stkpt-chip[data-live]') && !document.querySelector('.stkop-lchip')), tag + ': back on Paper: no badge, no chip, no live lines');
  check(M.calls.every((c) => /^\/connect\/finatic\//.test(c.path)), tag + ': only the local mock was called');
  check(errors.length === 0, tag + ': no console errors ' + errors.slice(0, 2).join(' | '));
  await ctx.close();
}
// measure the panel: header row, scalp trio, join row, footer rows, order rows
const alignOP = (p) => p.evaluate(() => {
  const R = (e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left * 10) / 10, r: Math.round(b.right * 10) / 10, t: Math.round(b.top * 10) / 10, h: Math.round(b.height * 10) / 10, cy: Math.round((b.top + b.height / 2) * 10) / 10 }; };
  const vis = (e) => e && e.getClientRects().length && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden';
  const row = (sel, items) => { const r = document.querySelector(sel); if (!vis(r)) return null; const its = [...r.querySelectorAll(items)].filter(vis).map(R).sort((a, b) => a.l - b.l); const rr = R(r), cs = getComputedStyle(r); const cys = its.map((i) => i.cy); return { n: its.length, cySpread: its.length ? Math.round((Math.max(...cys) - Math.min(...cys)) * 10) / 10 : 0, hs: its.map((i) => i.h), gaps: its.slice(1).map((it, k) => Math.round((it.l - its[k].r) * 10) / 10), insetL: its.length ? Math.round((its[0].l - rr.l) * 10) / 10 : null, insetR: its.length ? Math.round((rr.r - its[its.length - 1].r) * 10) / 10 : null, padL: cs.paddingLeft, padR: cs.paddingRight }; };
  return {
    head: row('#stkop .stkop-hd', ':scope > .stkop-tabs, :scope > .stkop-sym, .stkop-ib'),
    tabs: row('#stkop .stkop-tabs', 'button'),
    trio: row('#stkop .stkop-trio', ':scope > *'),
    joins: row('#stkop .stkop-joins', ':scope > *'),
    srow: row('#stkop .stkop-srow', ':scope > .stkop-hk'),
    sides: row('#stkop .stkop-sides', ':scope > *'),
    otype: row('#stkop .stkop-otype', ':scope > *'),
    seg: row('#stkop .stkop-seg', 'button'),
    go: row('#stkop .stkop-go', ':scope > .stkop-pill'),
    pre: row('#stkop .stkop-br[data-leg=sl] .stkop-pre', 'button'),
    pair: row('#stkop .stkop-br[data-leg=sl] .stkop-pair', 'input'),
    ft1: row('#stkop .stkop-fr:nth-child(1)', ':scope > *:not(.stkop-sp)'),
    ft2: row('#stkop .stkop-fr:nth-child(2)', ':scope > *:not(.stkop-sp):not(:empty)'),
    body: (() => { const s = document.querySelector('#stkop .stkop-scalp, #stkop .stkop-oscroll'); if (!s) return null; const cs = getComputedStyle(s); return { padL: cs.paddingLeft, padR: cs.paddingRight, padT: cs.paddingTop }; })(),
    ft: (() => { const s = document.querySelector('#stkop .stkop-ft'); const cs = getComputedStyle(s); return { padL: cs.paddingLeft, padR: cs.paddingRight }; })()
  };
});
const GRID = (v) => [0, 4, 8, 12, 16, 24].includes(Math.round(v));
function alignChecks(A, tag, mobile) {
  for (const k of ['head', 'tabs', 'trio', 'joins', 'sides', 'otype', 'seg', 'go', 'pre', 'pair', 'ft1', 'ft2']) {
    const r = A[k]; if (!r || !r.n) continue;
    check(r.cySpread <= 1, tag + ': ' + k + ' items share one centre (±1px)', r);
    if (['trio', 'joins', 'sides', 'go', 'pre', 'pair', 'tabs', 'seg'].includes(k)) check(r.gaps.every(GRID), tag + ': ' + k + ' gaps on the 4/8 grid', r.gaps);
    if (['joins', 'sides', 'pre', 'pair', 'go'].includes(k)) check(new Set(r.hs).size === 1, tag + ': ' + k + ' same-role controls same height', r.hs);
    if (['trio', 'joins', 'sides', 'pre', 'pair'].includes(k)) check(Math.abs(r.insetL - r.insetR) <= 1, tag + ': ' + k + ' equal left/right inset', [r.insetL, r.insetR]);
  }
  if (A.body) check(A.body.padL === A.body.padR && A.body.padL === '16px', tag + ': body padding 16 left = right', A.body);
  check(A.ft.padL === A.ft.padR && A.ft.padL === '16px', tag + ': footer padding 16 left = right', A.ft);
}
// ---- member (non-admin): the same panel for PAPER, no broker words; SL/TP bracket, Join Bid/Ask, Stop, Trail, Flatten
async function memberPaper(b, w, h, mobile, theme) {
  const tag = 'member-' + w + '-' + theme;
  const { ctx, p, errors, M } = await open(b, { w, h, mobile, theme, admin: false, flat: true });
  await p.waitForFunction(() => window.__stkPaper.account, null, { timeout: 20000 });
  await p.evaluate(() => { const MH = window.StrykerMarketHours; MH.futuresStatus = () => ({ open: true, until: Date.now() + 3600e3 }); window.__stkPaper.setEnabled(true); window.__stkPaper.account.setLast('futures:NQ1!', 28750); });
  check(await openOP(p, mobile), tag + ': Trade opens the order panel');
  const t0 = await p.evaluate(() => ({ txt: document.getElementById('stkop').innerText, sel: !!document.querySelector('#stkop select[data-f=acct]') }));
  check(!/tradovate|broker|finatic|LIVE/i.test(t0.txt.replace(/live bid/ig, '')) && !t0.sel, tag + ': paper only: no broker names, no account picker', t0.txt.slice(0, 200));
  check(/Paper/.test(t0.txt) && /Education only\. Not financial advice\./.test(t0.txt), tag + ': Paper chip + disclaimer in the footer');
  // Scalp
  await opTab(p, 'scalp', mobile);
  await opWait(p, () => document.querySelector('#stkop .stkop-join.bid b').textContent === '28,749.75' && !document.querySelector('#stkop .stkop-scalp [data-a=buy]').disabled);
  const jc = await p.evaluate(() => ({ bc: getComputedStyle(document.querySelector('#stkop .stkop-join.bid b')).color, ac: getComputedStyle(document.querySelector('#stkop .stkop-join.ask b')).color }));
  check(jc.bc !== jc.ac, tag + ': Join Bid price green, Join Ask price red', jc);
  if (w === 1440 || theme === 'dark') await p.screenshot({ path: OUT + '/op-' + tag + '-1-scalp.png' });
  const ops = await p.$('#stkop'); await ops.screenshot({ path: OUT + '/crop-op-scalp-' + tag + '.png' });
  const A = await alignOP(p); console.log('ALIGN ' + tag + ' ' + JSON.stringify(A)); alignChecks(A, tag, mobile);
  await tap(p, '#stkop .stkop-scalp [data-q="1"]', mobile);
  await tap(p, '#stkop .stkop-scalp [data-a=buy]', mobile);
  check(await opWait(p, () => { const q = window.__stkPaper.account.position('futures:NQ1!'); return q && q.qty === 2 && q.side === 'buy'; }), tag + ': Scalp Buy 2 = paper market BUY 2');
  await tap(p, '#stkop [data-a=jbid]', mobile);
  check(await opWait(p, () => window.__stkPaper.account.state.orders.some((o) => o.type === 'limit' && o.side === 'buy' && o.price === 28749.75)), tag + ': Join Bid = paper BUY LIMIT at the best bid');
  await p.evaluate(() => { const a = window.__stkPaper.account; a.setLast('futures:NQ1!', 28752); });
  await p.evaluate(() => { window.__stkOpTest.q = { bid: 28751.75, ask: 28752.25 }; });
  await tap(p, '#stkop [data-a=jask]', mobile);
  check(await opWait(p, () => window.__stkPaper.account.state.orders.some((o) => o.type === 'limit' && o.side === 'sell' && o.price === 28752.25)), tag + ': Join Ask = paper SELL LIMIT at the best ask');
  check(await opWait(p, () => document.querySelector('#stkop [data-k=wk]').textContent === '2 working' && /^Long 2/.test(document.querySelector('#stkop [data-k=pos]').textContent)), tag + ': footer: position + working count');
  // hotkeys: off by default; on -> S sells at market
  const hk0 = await p.evaluate(() => window.__stkOrderPanel.prefs.hk);
  check(hk0 === false, tag + ': B / S hotkeys off by default');
  await tap(p, '#stkop .stkop-scalp [data-q="-1"]', mobile);   // back to 1 lot: S then sells 1 of the long 2
  check(await p.$eval('#stkop .stkop-scalp [data-f=qty]', (e) => e.value) === '1', tag + ': quantity stepper back to 1');
  if (!mobile) {
    await p.check('#stkop [data-f=hk]'); await p.mouse.click(Math.round(w * 0.35), Math.round(h * 0.5));
    await p.keyboard.press('s');
    check(await opWait(p, () => { const q = window.__stkPaper.account.position('futures:NQ1!'); return q && q.qty === 1; }), tag + ': hotkey S (when switched on) = sell 1 at market');
    await p.uncheck('#stkop [data-f=hk]');
  }
  // Flatten (paper)
  await tap(p, '#stkop [data-a=flat]', mobile);
  check(await opWait(p, () => !window.__stkPaper.account.position('futures:NQ1!') && !window.__stkPaper.account.state.orders.length), tag + ': Flatten closes the paper position and cancels its orders');
  // Order tab: market BUY 1 with SL 20 ticks + TP preset 50 ticks = bracket
  await opTab(p, 'order', mobile);
  await p.evaluate(() => { window.__stkOpTest.q = { bid: 28749.75, ask: 28750 }; window.__stkPaper.account.setLast('futures:NQ1!', 28750); });
  await tap(p, '#stkop [data-side=buy]', mobile); await tap(p, '#stkop [data-type=market]', mobile);
  const mk = await p.$eval('#stkop [data-k=mkt]', (e) => e.textContent); check(mk === '28,750.00', tag + ': Market shows the live price (the ask for a buy)', mk);
  await p.check('#stkop [data-f="sl.on"]'); await p.fill('#stkop [data-f="sl.ticks"]', '20');
  await tap(p, '#stkop .stkop-br[data-leg=tp] [data-pre="50"]', mobile);
  await opWait(p, () => document.querySelector('#stkop [data-f="tp.price"]').value === '28762.50' && document.querySelector('#stkop [data-f="sl.price"]').value === '28745.00');
  const lg = await p.evaluate(() => ({ sl: document.querySelector('#stkop [data-f="sl.price"]').value, tp: document.querySelector('#stkop [data-f="tp.price"]').value, sum: document.querySelector('#stkop [data-k=sum]').textContent, tpOn: document.querySelector('#stkop [data-f="tp.on"]').checked }));
  check(lg.sl === '28745.00' && lg.tp === '28762.50' && lg.tpOn, tag + ': SL 20 ticks -> 28,745; TP preset 50 ticks -> 28,762.50 (price <-> ticks)', lg);
  check(/Risk \$100\.00 · Reward \$250\.00 · R:R 1:2\.50/.test(lg.sum), tag + ': risk / reward line from the contract spec', lg.sum);
  // price -> ticks the other way
  await p.fill('#stkop [data-f="sl.price"]', '28740'); await p.locator('#stkop [data-f="sl.price"]').blur();
  check(await opWait(p, () => document.querySelector('#stkop [data-f="sl.ticks"]').value === '40'), tag + ': SL price 28,740 -> 40 ticks');
  if (w === 1440 || theme === 'dark') await p.screenshot({ path: OUT + '/op-' + tag + '-2-order.png' });
  await ops.screenshot({ path: OUT + '/crop-op-order-' + tag + '.png' });
  const A2 = await alignOP(p); console.log('ALIGN-ORDER ' + tag + ' ' + JSON.stringify(A2)); alignChecks(A2, tag + ' order', mobile);
  await p.check('#stkop [data-f=trail]');
  await tap(p, '#stkop [data-k=confirm]', mobile);
  check(await opWait(p, () => { const q = window.__stkPaper.account.position('futures:NQ1!'); return q && q.sl != null && q.tp != null; }), tag + ': Confirm = market BUY with the bracket');
  const pos = await p.evaluate(() => JSON.parse(JSON.stringify(window.__stkPaper.account.position('futures:NQ1!'))));
  check(pos.side === 'buy' && pos.qty === 1 && pos.sl === 28740 && pos.tp === pos.avg + 0 + (28762.5 - 28750) && pos.trail > 0, tag + ': SL 28,740, TP 28,762.50, trailing on', pos);
  // limit and stop: tick-rounded, stop above the market for a buy
  await tap(p, '#stkop [data-type=stop]', mobile);
  const sp = await p.$eval('#stkop [data-f=price]', (e) => e.value); check(sp === '28752.50', tag + ': Stop price prefilled 10 ticks above for a buy', sp);
  await p.uncheck('#stkop [data-f="sl.on"]'); await p.uncheck('#stkop [data-f="tp.on"]');
  await tap(p, '#stkop [data-k=confirm]', mobile);
  check(await opWait(p, () => window.__stkPaper.account.state.orders.some((o) => o.type === 'stop' && o.side === 'buy' && o.price === 28752.5)), tag + ': Stop order placed (paper)');
  // remembers tab + size + position per user
  if (!mobile) {
    const hd = await p.$('#stkop .stkop-hd'); const bb = await hd.boundingBox();
    await p.mouse.move(bb.x + bb.width / 2, bb.y + 10); await p.mouse.down(); await p.mouse.move(bb.x + bb.width / 2 - 200, bb.y + 60, { steps: 6 }); await p.mouse.up();
    const rs = await p.$('#stkop .stkop-rs'); const rb = await rs.boundingBox();
    await p.mouse.move(rb.x + 8, rb.y + 8); await p.mouse.down(); await p.mouse.move(rb.x + 48, rb.y + 8, { steps: 4 }); await p.mouse.up();
    const pr = await p.evaluate(() => JSON.parse(localStorage.getItem('stryker_op_u1')));
    const box = await p.evaluate(() => document.getElementById('stkop').getBoundingClientRect().toJSON());
    check(pr && pr.tab === 'order' && pr.x === Math.round(box.left) && pr.w === Math.round(box.width) && pr.w >= 395, tag + ': drag + resize + tab saved per user (stryker_op_<uid>)', [pr, box]);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkPaper && window.__stkPaper.account, null, { timeout: 60000 });
    const back = await opWait(p, () => { const o = document.getElementById('stkop'); return o && !o.hidden && o.dataset.tab === 'order'; }, null, 15000);
    const box2 = await p.evaluate(() => { const o = document.getElementById('stkop'); return o ? o.getBoundingClientRect().toJSON() : null; });
    check(back && box2 && Math.abs(box2.left - box.left) <= 1 && Math.abs(box2.width - box.width) <= 1, tag + ': after a reload the panel comes back where it was, same size + tab', [box, box2]);
    // minimise / expand
    await p.click('#stkop [data-a=min]'); check(await opWait(p, () => document.getElementById('stkop').getBoundingClientRect().height <= 56), tag + ': minimise leaves the header only');
    await p.click('#stkop [data-a=min]'); await p.click('#stkop [data-a=max]');
    check(await opWait(p, () => document.getElementById('stkop').classList.contains('is-max') && document.getElementById('stkop').getBoundingClientRect().height > 600), tag + ': expand fills the chart height');
    await p.click('#stkop [data-a=max]');
  } else {
    const sh = await p.evaluate(() => { const o = document.getElementById('stkop'), r = o.getBoundingClientRect(); return { sheet: o.classList.contains('is-sheet'), l: r.left, r: r.right, b: Math.round(r.bottom), vh: innerHeight, vw: innerWidth, dom: getComputedStyle(o.querySelector('[data-tab=dom]')).display }; });
    check(sh.sheet && sh.l === 0 && Math.abs(sh.r - sh.vw) <= 1 && sh.dom === 'none', tag + ': phone = bottom sheet, Scalp + Order only', sh);
  }
  check(M.calls.length === 0, tag + ': member: no broker calls at all', M.calls.length);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ': no horizontal page scroll');
  check(errors.length === 0, tag + ': no console errors ' + errors.slice(0, 2).join(' | '));
  await ctx.close();
}
async function nonAdmin(b) {
  const { ctx, p, errors, M } = await open(b, { w: 1440, h: 900, theme: 'dark', admin: false });
  await sleep(2500);
  await openOP(p, false);
  const r = await p.evaluate(() => ({ pick: !!document.querySelector('.stklv-pick, #stkop select[data-f=acct]'), mod: !!(window.__stkLive && window.__stkLive.pick), live: [...document.scripts].some((s) => /chart-live/.test(s.src)) }));
  check(!r.pick && !r.mod, 'non-admin: no account picker, live module never loaded', r);
  check(M.calls.length === 0, 'non-admin: no broker calls at all', M.calls.length);
  await ctx.close();
}
async function notConnected(b) {
  const { ctx, p, M } = await open(b, { w: 1440, h: 900, theme: 'dark', connected: false });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.state.loaded && window.__stkLive.pick, null, { timeout: 20000 });
  await openOP(p, false);
  await p.waitForFunction(() => document.querySelector('#stkop select[data-f=acct] option[value="__connect"]'), null, { timeout: 20000 });
  const opts = await p.$$eval('#stkop select[data-f=acct] option', (o) => o.map((x) => x.textContent));
  check(opts.join('|') === 'Paper|Connect a broker…', 'not connected: Paper + Connect a broker…', opts);
  await p.evaluate(() => { window.open = () => ({ location: {}, close() {} }); });
  await p.selectOption('#stkop select[data-f=acct]', '__connect');
  const sheet = await p.waitForSelector('#fjs', { timeout: 10000 }).then(() => true, () => false);
  check(sheet && (await p.$eval('#stkop select[data-f=acct]', (s) => s.value)) === '', 'Connect a broker opens the Nemesis connect sheet; picker stays on Paper');
  await p.screenshot({ path: OUT + '/live-connect-1440.png' });
  check(!writes(M).length, 'connect flow sends no order');
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const only = process.env.ONLY || '';
    if (!only || only === 'base') { await nonAdmin(b); await notConnected(b); }
    const sizes = [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [412, 915, true, 'dark'], [412, 915, true, 'light'], [390, 844, true, 'dark'], [390, 844, true, 'light']];
    for (const [w, h, mobile, theme] of sizes) if (!only || only === w + '-' + theme) await run(b, w, h, mobile, theme);
    for (const [w, h, mobile, theme] of sizes) if (!only || only === 'member-' + w + '-' + theme) await memberPaper(b, w, h, mobile, theme);
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
