// ZoroCharts LIVE broker orders (admin only, 2026-11-15) browser test. EVERY /connect/finatic/* call is answered by a local mock in this
// file: no request ever leaves 127.0.0.1, no real order can be sent. Runs 1440 / 412 / 390, dark + light.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-live-browser.js <shotsDir>
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
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
const globex = (s) => { const d = new Date((s - 5 * 3600) * 1000), wd = d.getUTCDay(), h = d.getUTCHours(); return !(wd === 6 || (wd === 5 && h >= 17) || (wd === 0 && h < 18) || h === 17); };   // EST approx (fixture)
const ACC = '123e4567-e89b-12d3-a456-426614174000', US = '0aaa1111-2222-3333-4444-555566667777';

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

async function run(b, w, h, mobile, theme) {
  const tag = w + '-' + theme;
  const { ctx, p, errors, M } = await open(b, { w, h, mobile, theme });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.pick && document.querySelector('.stklv-pick select option[value="' + '123e4567-e89b-12d3-a456-426614174000' + '"]'), null, { timeout: 20000 });
  const opts = await p.$$eval('.stklv-pick select option', (o) => o.map((x) => [x.value, x.textContent]));
  check(opts[0][0] === '' && opts[0][1] === 'Paper' && (await p.$eval('.stklv-pick select', (s) => s.value)) === '', tag + ': Paper is the first and default choice', opts);
  check(opts.some((o) => o[1] === 'Tradovate DEMO5551234'), tag + ': account shown as broker + the account number the broker shows', opts);
  check(!(await p.evaluate(() => /finatic/i.test(document.getElementById('stkpt').innerText))), tag + ': no vendor name in the panel');
  // pick live
  await p.selectOption('.stklv-pick select', ACC);
  await p.waitForFunction(() => document.querySelector('.stkpt.is-live') && window.__stkLive.state.lastOkStart > 0 && window.__stkLive.state.placeSchema, null, { timeout: 10000 });
  await p.evaluate(() => window.__stkPaper.openPanel());
  await sleep(600);
  const badge = await p.evaluate(() => ({ panel: (() => { const b = document.querySelector('.stkpt-head .stklv-badge'); return b ? [...b.children].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.textContent).join('') : ''; })(), chart: (document.querySelector('.stklv-cbadge') || {}).textContent || '', bg: (() => { const e = document.querySelector('.stklv-cbadge'); return e ? getComputedStyle(e).backgroundColor : ''; })() }));
  check(/^LIVE Tradovate DEMO5551234 · NQ[HMUZ]\d$/.test(badge.chart) && badge.bg === 'rgb(217, 45, 32)', tag + ': big red LIVE badge on the chart with the contract', badge);
  check(mobile ? /LIVE …1234$/.test(badge.panel) : /^LIVE Tradovate DEMO5551234/.test(badge.panel), tag + ': LIVE badge in the panel head', badge);
  check(await p.evaluate(() => { const t = document.querySelector('.stkpt-trade'); return !t || getComputedStyle(t).display === 'none'; }), tag + ': paper Trade button hidden while live');
  check(await p.evaluate(() => window.STRYKER_VELA && window.__stkPaper.live !== null), tag + ': live hook active');
  const code = await p.evaluate(() => window.__stkLive.info('futures:NQ1!').code);
  check(/^NQ[HMUZ]\d$/.test(code), tag + ': NQ1! maps to the front month ' + code);
  check(await p.evaluate((c) => document.querySelector('.stklv-ctr').textContent.includes('NQ1! → ' + c), code), tag + ': mapping shown in the form');
  if (!mobile) await p.evaluate(() => { const g = document.querySelector('.stkpt-grip'); });
  const nb = await p.waitForFunction(() => (window.STRYKER_VELA.active.chart.orchestrator.rawBars || []).length > 50, null, { timeout: 20000 }).then(() => true, () => false);
  if (process.env.DBG) console.log('DBG bars', nb, await p.evaluate(() => { const ws = window.STRYKER_VELA; const o = {}; try { o.wsChart = (ws.chart.orchestrator.rawBars || []).length; } catch (e) { o.e = e.message; } try { const b = ws.chart.orchestrator.rawBars; o.last = b[b.length - 1]; } catch (e) {} try { o.same = ws.chart === ws.active.chart; } catch (e) {} return o; }));
  await p.evaluate(() => window.__stkPaper.account && window.__stkPaper.account.setLast('futures:NQ1!', 28750));
  if (theme === 'dark' || w === 1440) await p.screenshot({ path: OUT + '/live-' + tag + '-1-panel.png' });

  // --- first order: typed confirm
  await tap(p, '.stklv-send', mobile);
  await p.waitForSelector('#stklv-cf');
  const cf1 = await p.evaluate(() => ({ t: document.getElementById('stklv-cf').innerText, dis: document.querySelector('#stklv-cf [data-k=yes]').disabled, typing: !!document.querySelector('.stklv-cf-type input') }));
  check(cf1.typing && cf1.dis && cf1.t.includes(code) && /Tradovate DEMO5551234/.test(cf1.t), tag + ': first order needs the contract typed; confirm shows the contract + account', cf1);
  await p.fill('.stklv-cf-type input', 'NQ'); check(await p.$eval('#stklv-cf [data-k=yes]', (e) => e.disabled), tag + ': wrong text keeps Send disabled');
  if (theme === 'dark' || w === 1440) await p.screenshot({ path: OUT + '/live-' + tag + '-2-typed.png' });
  await p.fill('.stklv-cf-type input', code.toLowerCase());
  await tap(p, '#stklv-cf [data-k=yes]', mobile);
  await p.waitForFunction((n) => true, null); await sleep(900);
  let W = writes(M);
  // SPEED (2026-11-16): the 'env' call that pre-warms the server carries the broker user; reads ran straight after the write
  check(M.calls.some((c) => c.path.endsWith('/order') && c.body.op === 'env' && c.body.userId === US), tag + ': panel open pre-warms the server (env + userId)');
  { const wAt = M.calls.filter((c) => c.body.op === 'place').at(-1).at, rAt = M.calls.find((c) => c.body.op === 'live' && c.at > wAt);
    check(rAt && rAt.at - wAt < 700, tag + ': positions re-read within 0.7 s of the order', rAt && rAt.at - wAt); }
  check(/^Order sent in \d+ ms\. LIVE account/.test(await p.$eval('.stkpt-foot', (e) => e.textContent)), tag + ': footer shows the measured round trip', await p.$eval('.stkpt-foot', (e) => e.textContent.slice(0, 80)));
  check(W.length === 1 && W[0].op === 'place' && W[0].symbol === code && W[0].qty === 1 && W[0].type === 'market' && W[0].src === 'chart' && /^[A-Za-z0-9-]{16,64}$/.test(W[0].idemKey || '') && W[0].accountId === ACC, tag + ': market BUY 1 sent with contract + idemKey', W[0]);
  // --- second order: a tap, no typing, skip offered
  await p.evaluate(() => { window.__stkLive.state.form.side = 'sell'; window.__stkLive.state.form.type = 'limit'; window.__stkLive.state.form.price = '28756'; window.__stkPaper.renderAll(); });
  await p.waitForFunction(() => window.__stkLive.blockReason === '', null, { timeout: 8000 }).catch(() => {});
  await sleep(400);
  await tap(p, '.stklv-send', mobile);
  await p.waitForSelector('#stklv-cf');
  const cf2 = await p.evaluate(() => ({ typing: !!document.querySelector('.stklv-cf-type input'), skip: !!document.querySelector('#stklv-cf [data-k=skip]'), t: document.getElementById('stklv-cf').innerText }));
  check(!cf2.typing && cf2.skip && /SELL 1 NQ.. LIMIT @ 28,756.00/.test(cf2.t), tag + ': later orders = one tap, with "skip for this session"', cf2);
  if (theme === 'dark' || w === 1440) await p.screenshot({ path: OUT + '/live-' + tag + '-3-tap.png' });
  M.delay = 1200; M.timing = true;
  await p.check('#stklv-cf [data-k=skip]'); await tap(p, '#stklv-cf [data-k=yes]', mobile); await sleep(250);
  { const sending = await p.evaluate(() => ({ chips: [...document.querySelectorAll('.stkpt-chip[data-live]')].map((c) => c.textContent), foot: document.querySelector('.stkpt-foot').textContent }));
    check(sending.chips.some((t) => /^SENDING SELL 1 LMT28,756\.00/.test(t)) && /^Sending… /.test(sending.foot), tag + ': order line drawn at once as SENDING while the broker answers', sending);
    if (theme === 'dark' || w === 1440) await p.screenshot({ path: OUT + '/live-' + tag + '-3b-sending.png' });
    const nW = writes(M).length; await p.evaluate(() => { const c = [...document.querySelectorAll('.stkpt-chip[data-live]')].find((x) => /SENDING/.test(x.textContent)); if (c) c.querySelector('.stkpt-chip-x').click(); });
    check(writes(M).length === nW, tag + ': × on a SENDING line sends nothing'); }
  await sleep(1400); M.delay = 0;
  { const after = await p.evaluate(() => ({ chips: [...document.querySelectorAll('.stkpt-chip[data-live]')].map((c) => c.textContent), foot: document.querySelector('.stkpt-foot').textContent }));
    check(!after.chips.some((t) => /SENDING/.test(t)) && /^Order sent in \d{4} ms \(broker 61 ms\)\./.test(after.foot), tag + ': SENDING line gone on the answer; footer: round trip + broker time from Server-Timing', after);
    if (w === 1440 || theme === 'dark') { const f = await p.$('.stkpt-foot'); if (f) await f.screenshot({ path: OUT + '/crop-foot-' + tag + '.png' }); } }
  M.timing = false;
  W = writes(M);
  check(W.length === 2 && W[1].type === 'limit' && W[1].limitPrice === 28756 && W[1].side === 'sell' && W[1].idemKey !== W[0].idemKey, tag + ': SELL limit sent, fresh idemKey', W[1]);
  // working-order + position lines
  await p.evaluate(() => window.__stkLive.read()); await sleep(900);
  const chips = await p.evaluate(() => [...document.querySelectorAll('.stkpt-chip[data-live]')].map((c) => [c.dataset.kind, c.textContent]));
  check(chips.some((c) => c[0] === 'pos' && /LIVE LONG 1/.test(c[1])) && chips.some((c) => c[0] === 'ord' && /LIVE SELL LMT 1/.test(c[1])), tag + ': live position + working order lines on the chart', chips);
  // skip on: next order goes straight out (no sheet)
  await p.evaluate(() => { window.__stkLive.state.form.side = 'buy'; window.__stkLive.state.form.type = 'limit'; window.__stkLive.state.form.price = '28745'; window.__stkPaper.renderAll(); });
  await sleep(300);
  // exposure: long 1 + buy 1 more is fine (2), a third contract not
  await tap(p, '.stklv-send', mobile); await sleep(900);
  W = writes(M);
  check(W.length === 3 && !(await p.$('#stklv-cf')), tag + ': skip honoured for a normal order', W.length);
  await p.evaluate(() => window.__stkLive.read()); await sleep(700);
  await p.evaluate(() => { window.__stkLive.state.form.qty = 1; window.__stkLive.state.form.price = '28744'; window.__stkPaper.renderAll(); });
  await tap(p, '.stklv-send', mobile); await sleep(700);
  check(writes(M).length === 3, tag + ': worst-case exposure over 2 contracts refused in the browser');
  // drag a working order = modify (confirm, never skipped)
  const ordChip = await p.evaluate(() => { const c = [...document.querySelectorAll('.stkpt-chip[data-live][data-kind=ord]')].find((x) => /SELL/.test(x.textContent)); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
  if (process.env.DBG) { await p.screenshot({ path: OUT + '/dbg-drag.png' }); console.log('DBG chip', ordChip, await p.evaluate(() => [...document.querySelectorAll('.stkpt-chip')].map((c) => [c.dataset.id, c.dataset.live, getComputedStyle(c).display, c.style.visibility, c.style.transform, c.getBoundingClientRect().top])), await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.className : null; }, [ordChip ? ordChip.x : 0, ordChip ? ordChip.y : 0])); }
  if (ordChip) {
    await p.mouse.move(ordChip.x, ordChip.y); await p.mouse.down(); await p.mouse.move(ordChip.x, ordChip.y - 30, { steps: 6 }); await p.mouse.up();
    const sheet = await p.waitForSelector('#stklv-cf', { timeout: 4000 }).then(() => true, () => false);
    check(sheet && /Move SELL 1/.test(await p.$eval('#stklv-cf', (e) => e.innerText)), tag + ': drag opens a Move confirm even with skip on', await p.evaluate(() => window.__toasts.slice(-3)));
    if (sheet) { await tap(p, '#stklv-cf [data-k=yes]', mobile); await sleep(900); }
    W = writes(M); check(W.at(-1).op === 'modify' && W.at(-1).limitPrice > 28756, tag + ': modify sent with the dragged price', W.at(-1));
  } else check(false, tag + ': SELL order chip present for drag (desktop-size chart)');
  // cancel+new when the broker has no modify
  M.modify = false; await p.evaluate(() => { window.__stkLive.state.modifyOk = false; });
  const o2 = await p.evaluate(() => { const o = window.__stkLive.info('futures:NQ1!').working.find((x) => x.side === 'sell'); return o && o.id; });
  const nBefore = writes(M).length;
  const dragP = p.evaluate((id) => window.__stkPaper.live.drag('futures:NQ1!', { id: 'L' + id, price: 28800 }), o2);
  await p.waitForSelector('#stklv-cf'); check(/cancelled first/.test(await p.$eval('#stklv-cf', (e) => e.innerText)), tag + ': no-modify broker: the confirm says cancel + new');
  await tap(p, '#stklv-cf [data-k=yes]', mobile); await dragP;
  W = writes(M).slice(nBefore); check(W.length === 2 && W[0].op === 'cancel' && W[1].op === 'place' && W[1].limitPrice === 28800, tag + ': cancel, then the new limit, after the cancel was read back', W);
  // read failure blocks new orders
  M.failRead = true; await p.evaluate(() => { window.__stkLive.state.reading = false; return window.__stkLive.read(); }); await sleep(400);
  const blk = await p.evaluate(() => ({ dis: document.querySelector('.stklv-send').disabled, st: document.querySelector('.stklv-status').textContent }));
  check(blk.dis && /could not be read/.test(blk.st), tag + ': unreadable positions/orders = Send disabled + reason', blk);
  if (theme === 'dark' || w === 1440) await p.screenshot({ path: OUT + '/live-' + tag + '-4-blocked.png' });
  M.failRead = false; await p.evaluate(() => { window.__stkLive.state.reading = false; return window.__stkLive.read(); });
  // wait for a clean read (no readErr) instead of a fixed sleep: slow CI runners took >500 ms and the ladder stayed blocked
  await p.waitForFunction(() => !window.__stkLive.state.readErr && !window.__stkLive.state.reading, null, { timeout: 10000 }).catch(() => {});
  // DOM ladder: a bid click = live BUY limit at that price (always a limit)
  await p.evaluate(() => window.__stkBookPanel && window.__stkBookPanel.open && window.__stkBookPanel.open());
  await sleep(500);
  const lad = await p.evaluate(() => { const S = window.__stkLive.state; S.skip = false; const r = window.__stkPaper.live.ladder('futures:NQ1!', 'ask', 28770, 28749.75, 28750, 1); return !!r; });
  const ls = await p.waitForSelector('#stklv-cf', { timeout: 5000 }).then(() => true, () => false); const lt = ls ? await p.$eval('#stklv-cf', (e) => e.innerText) : await p.evaluate(() => 'TOASTS ' + window.__toasts.slice(-3).join(' | '));
  check(ls && /SELL 1 NQ.. LIMIT @ 28,770.00/.test(lt), tag + ': DOM ask click = live SELL LIMIT at the clicked price', lt.slice(0, 160));
  if (ls) await tap(p, '#stklv-cf [data-k=no]', mobile); await sleep(200);
  check(writes(M).at(-1).op === 'place' && writes(M).length === nBefore + 2, tag + ': Cancel in the confirm sends nothing');
  await p.evaluate(() => window.__stkBookPanel && window.__stkBookPanel.close && window.__stkBookPanel.close());
  // flatten: server op with a key, confirm never skippable
  await p.evaluate(() => { window.__stkLive.state.skip = true; });
  const fp = p.evaluate(() => window.__stkPaper.live.flatten('futures:NQ1!'));
  const fs2 = await p.waitForSelector('#stklv-cf', { timeout: 5000 }).then(() => true, () => false); check(fs2 && !(await p.$('#stklv-cf [data-k=skip]')), tag + ': flatten confirm has no skip', await p.evaluate(() => window.__toasts.slice(-3)));
  if (!fs2) { await ctx.close(); return; }
  await tap(p, '#stklv-cf [data-k=yes]', mobile); await fp;
  W = writes(M); check(W.at(-1).op === 'flatten' && W.at(-1).symbol === code && /^[A-Za-z0-9-]{16,64}$/.test(W.at(-1).idemKey), tag + ': flatten = server op with a deterministic key', W.at(-1));
  // alignment
  await p.evaluate(() => window.__stkLive.read()); await sleep(800);
  const A = {
    head: await measure(p, '.stkpt-head', ':scope > .stkpt-toggle, .stklv-pick select, .stkpt-head .stklv-badge, .stkpt-hsum span, :scope > .stkpt-trade'),
    seg: await measure(p, '.stklv-two', '.stklv-seg'),
    segBtns: await measure(p, '.stklv-seg[aria-label=side]', 'button'),
    tools: await measure(p, '.stklv-tools', '.stklv-btn'),
    foot: await p.evaluate(() => { const f = document.querySelector('.stkpt-foot'), r = f.getBoundingClientRect(), cs = getComputedStyle(f); return { h: Math.round(r.height), padL: cs.paddingLeft, padR: cs.paddingRight, padT: cs.paddingTop, padB: cs.paddingBottom, overflowX: f.scrollWidth > f.clientWidth + 1 && cs.whiteSpace !== 'nowrap' }; }),
    chips: await p.evaluate(() => [...document.querySelectorAll('.stkpt-chip[data-live]')].map((c) => ({ t: c.textContent.slice(0, 18), h: Math.round(c.getBoundingClientRect().height) })))
  };
  console.log('ALIGN ' + tag + ' ' + JSON.stringify(A));
  check(A.head && A.head.cySpread <= 1, tag + ': panel head items share one centre (±1px)', A.head && A.head.items);
  check(A.segBtns && A.segBtns.cySpread <= 1 && new Set(A.segBtns.items.map((i) => i.h)).size === 1, tag + ': Buy/Sell same height + centre', A.segBtns);
  check(A.tools && A.tools.cySpread <= 1 || (A.tools && mobile), tag + ': tool buttons centred (row may wrap on phones)', A.tools);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ': no horizontal page scroll');
  await p.screenshot({ path: OUT + '/live-' + tag + '-5-after.png' });
  const head = await p.$('.stkpt-head'); if (head) await head.screenshot({ path: OUT + '/crop-head-' + tag + '.png' });
  const form = await p.$('.stklv-view'); if (form) await form.screenshot({ path: OUT + '/crop-view-' + tag + '.png' });
  // back to paper
  await p.selectOption('.stklv-pick select', '');
  await sleep(500);
  check(await p.evaluate(() => !document.querySelector('.stkpt.is-live') && !document.querySelector('.stklv-cbadge') && !document.querySelector('.stkpt-chip[data-live]')), tag + ': back on Paper: no badge, no live lines');
  check(M.calls.every((c) => /^\/connect\/finatic\//.test(c.path)), tag + ': only the local mock was called');
  check(errors.length === 0, tag + ': no console errors ' + errors.slice(0, 2).join(' | '));
  await ctx.close();
}
async function nonAdmin(b) {
  const { ctx, p, errors, M } = await open(b, { w: 1440, h: 900, theme: 'dark', admin: false });
  await sleep(2500);
  const r = await p.evaluate(() => ({ pick: !!document.querySelector('.stklv-pick'), mod: !!(window.__stkLive && window.__stkLive.pick), live: [...document.scripts].some((s) => /chart-live/.test(s.src)) }));
  check(!r.pick && !r.mod, 'non-admin: no account picker, live module never loaded', r);
  check(M.calls.length === 0, 'non-admin: no broker calls at all', M.calls.length);
  await ctx.close();
}
async function notConnected(b) {
  const { ctx, p, M } = await open(b, { w: 1440, h: 900, theme: 'dark', connected: false });
  await p.waitForFunction(() => document.querySelector('.stklv-pick select option[value="__connect"]'), null, { timeout: 20000 });
  const opts = await p.$$eval('.stklv-pick select option', (o) => o.map((x) => x.textContent));
  check(opts.join('|') === 'Paper|Connect a broker…', 'not connected: Paper + Connect a broker…', opts);
  await p.evaluate(() => { window.open = () => ({ location: {}, close() {} }); });
  await p.selectOption('.stklv-pick select', '__connect');
  const sheet = await p.waitForSelector('#fjs', { timeout: 10000 }).then(() => true, () => false);
  check(sheet && (await p.$eval('.stklv-pick select', (s) => s.value)) === '', 'Connect a broker opens the Nemesis connect sheet; picker stays on Paper');
  await p.screenshot({ path: OUT + '/live-connect-1440.png' });
  check(!writes(M).length, 'connect flow sends no order');
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const only = process.env.ONLY || '';
    if (!only) { await nonAdmin(b); await notConnected(b); }
    for (const [w, h, mobile, theme] of [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [412, 915, true, 'dark'], [390, 844, true, 'dark'], [390, 844, true, 'light']]) if (!only || only === w + '-' + theme) await run(b, w, h, mobile, theme);
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
