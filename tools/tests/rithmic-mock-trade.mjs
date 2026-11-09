// Order plant + PnL plant simulation for the local Rithmic mock (tools/tests/rithmic-mock.mjs). Not deployed.
// Used only by sessions that log in with the fake user `demo-trade` (password demo-pass). SYNTHETIC: fills are made up by
// this mock at its own synthetic prices; nothing here talks to Rithmic. Binds nowhere itself (the mock binds 127.0.0.1).
// Paper accounts: PAPER-1, PAPER-2. Tick 0.25 (index futures in the tests).
// Behaviour:
//   312 new order: market fills at once; limit fills at once only if marketable, else works; stop works.
//   330 bracket: as 312, and when the parent fills the mock opens a TP limit + SL stop (children, original_basket_id =
//       parent) at fill +/- ticks; when one child fills the other is cancelled (OCO).
//   314 modify, 316 cancel, 346 cancel all, 3504 exit position (market order against the net position).
//   308/336/400 subscriptions; 320 show orders; 402 snapshot; 310 trade routes.
// Control (GET /__trade/<cmd>): state | fill?basket=ID | reject?n=1 (next N orders rejected) | slow?ms=N (delay acks) |
//   silent?n=1 (next N order requests never answered) | freeze?on=1 (price stream stops) | reset
const TICK = 0.25;
const ORDER_IDS = [312, 314, 316, 330, 346, 3504];
const PAPER = ['Rithmic Test', 'Rithmic Paper Trading'];
const ACCTS = [{ id: 'PAPER-1', name: 'Paper 50K' }, { id: 'PAPER-2', name: 'Paper 100K' }];
const POINT = { MES: 5, MNQ: 2, ES: 50, NQ: 20 };
const rootOf = (s) => String(s).replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '');

export function createTradePlant({ stats, px, sockets, setBase, resetBase }) {
  let seq = 0;
  const S = { orders: new Map(), pos: new Map(), realized: {}, rejectN: 0, slowMs: 0, silentN: 0 };
  const api = { frozen: false };
  stats.trade = { reqs: {}, orders: [], nonPaper: [] };
  const conns = () => [...sockets()].filter((c) => c.trade && c.open);
  const mkt = (sym) => Math.round(px(sym, Date.now() / 1000) / TICK) * TICK;

  function note(o, extra) {
    return { template_id: 351, fcm_id: 'MOCK', ib_id: 'MOCK', account_id: o.account, symbol: o.symbol, exchange: o.exchange, basket_id: o.basket,
      original_basket_id: o.parent || undefined, status: o.status, transaction_type: o.side, price_type: o.ptype, quantity_64: o.qty,
      price: o.price ?? undefined, trigger_price: o.trigger ?? undefined, total_fill_size_64: o.filled, total_unfilled_size_64: o.qty - o.filled,
      avg_fill_price: o.avg ?? undefined, user_tag: o.tag, completion_reason: o.reason || undefined, notify_type: 1, ssboe: Math.floor(Date.now() / 1000), ...(extra || {}) };
  }
  const toOrderConns = (acct, msg) => { for (const c of conns()) if (c.plant === 2 && c.orderSubs && c.orderSubs.has(acct)) c.send(msg); };
  const toPnlConns = (acct, msg) => { for (const c of conns()) if (c.plant === 4 && c.pnlSubs && c.pnlSubs.has(acct)) c.send(msg); };
  const pushOrder = (o) => toOrderConns(o.account, note(o));
  function pnlMsgs(acct) {
    const out = []; let open = 0, net = 0;
    for (const [k, p] of S.pos) {
      if (!k.startsWith(acct + '|')) continue;
      const pv = POINT[rootOf(p.symbol)] || 1, m = mkt(p.symbol);
      const op = p.net ? (m - p.avg) * p.net * pv : 0; open += op; net += p.net;
      out.push({ template_id: 450, fcm_id: 'MOCK', ib_id: 'MOCK', account_id: acct, symbol: p.symbol, exchange: p.exchange, net_quantity: p.net,
        avg_open_fill_price: p.net ? p.avg : 0, open_position_pnl: open.toFixed(2), open_position_quantity: Math.abs(p.net), day_closed_pnl: S.realized[acct] || 0 });
    }
    const real = S.realized[acct] || 0;
    out.push({ template_id: 451, fcm_id: 'MOCK', ib_id: 'MOCK', account_id: acct, account_balance: (50000 + real).toFixed(2), open_position_pnl: open.toFixed(2),
      day_pnl: (real + open).toFixed(2), day_closed_pnl: real.toFixed(2), net_quantity: net });
    return out;
  }
  const pushPnl = (acct) => { for (const m of pnlMsgs(acct)) toPnlConns(acct, m); };
  setInterval(() => { for (const a of ACCTS) if (conns().some((c) => c.pnlSubs && c.pnlSubs.has(a.id))) pushPnl(a.id); }, 1000).unref();

  function fill(o, price) {
    price = Math.round(price / TICK) * TICK;
    const q = o.qty - o.filled; if (q <= 0) return;
    o.filled = o.qty; o.avg = price; o.status = 'complete'; o.reason = 'Fill';
    const k = o.account + '|' + o.symbol, p = S.pos.get(k) || { symbol: o.symbol, exchange: o.exchange, net: 0, avg: 0 };
    const d = o.side === 1 ? q : -q, pv = POINT[rootOf(o.symbol)] || 1;
    if (p.net === 0 || Math.sign(p.net) === Math.sign(d)) { p.avg = (p.avg * Math.abs(p.net) + price * q) / (Math.abs(p.net) + q); p.net += d; }
    else {
      const close = Math.min(Math.abs(p.net), q);
      S.realized[o.account] = (S.realized[o.account] || 0) + (price - p.avg) * close * Math.sign(p.net) * pv;
      p.net += d;
      if (p.net !== 0 && Math.sign(p.net) === Math.sign(d)) p.avg = price; else if (p.net === 0) p.avg = 0;
    }
    S.pos.set(k, p);
    toOrderConns(o.account, { template_id: 352, notify_type: 5, fcm_id: 'MOCK', ib_id: 'MOCK', account_id: o.account, symbol: o.symbol, exchange: o.exchange, basket_id: o.basket,
      transaction_type: o.side, fill_price: price, fill_size_64: q, fill_id: o.basket + '-F', ssboe: Math.floor(Date.now() / 1000) });
    pushOrder(o);
    // bracket: parent filled -> open the children; a child filled -> cancel its sibling
    if (o.bracket) {
      const { tp, sl } = o.bracket, s = o.side === 1 ? 1 : -1, other = o.side === 1 ? 2 : 1;
      if (tp) addOrder({ account: o.account, symbol: o.symbol, exchange: o.exchange, side: other, ptype: 1, qty: q, price: price + s * tp * TICK, parent: o.basket, tag: o.tag + ':tp' });
      if (sl) addOrder({ account: o.account, symbol: o.symbol, exchange: o.exchange, side: other, ptype: 4, qty: q, trigger: price - s * sl * TICK, parent: o.basket, tag: o.tag + ':sl' });
      toOrderConns(o.account, { template_id: 353, fcm_id: 'MOCK', ib_id: 'MOCK', account_id: o.account, basket_id: o.basket, target_ticks: tp || 0, stop_ticks: sl || 0, target_quantity: q, stop_quantity: q });
    }
    if (o.parent) for (const x of S.orders.values()) if (x.parent === o.parent && x !== o && x.status === 'open') { x.status = 'cancelled'; x.reason = 'OCO'; pushOrder(x); }
    pushPnl(o.account);
  }
  function addOrder(f) {
    const o = { basket: 'M' + (++seq), filled: 0, status: 'open', ...f };
    S.orders.set(o.basket, o);
    pushOrder(o);
    return o;
  }
  function onNew(c, m, um) {
    const bracket = m.template_id === 330 ? { tp: (m.target_ticks || [])[0] || 0, sl: (m.stop_ticks || [])[0] || 0 } : null;
    if (S.rejectN > 0) { S.rejectN--; c.send({ template_id: m.template_id + 1, user_msg: um, rp_code: ['3', 'order rejected by mock risk check'] }); return; }
    const o = { basket: 'M' + (++seq), account: m.account_id, symbol: m.symbol, exchange: m.exchange, side: m.transaction_type, ptype: m.price_type,
      qty: m.quantity_64, price: m.price, trigger: m.trigger_price, tag: m.user_tag, filled: 0, status: 'open', bracket };
    S.orders.set(o.basket, o);
    c.send({ template_id: m.template_id + 1, user_msg: um, user_tag: m.user_tag, basket_id: o.basket, rp_code: ['0'] });
    pushOrder(o);
    const p = mkt(o.symbol);
    if (o.ptype === 2) fill(o, p);
    else if (o.ptype === 1 && (o.side === 1 ? o.price >= p : o.price <= p)) fill(o, o.price);
  }

  api.onMessage = (c, m) => {
    const um = m.user_msg, tid = m.template_id;
    if (c.plant !== 2 && c.plant !== 4) return false;
    stats.trade.reqs[tid] = (stats.trade.reqs[tid] || 0) + 1;
    if (ORDER_IDS.includes(tid)) {
      stats.trade.orders.push({ tid, system: c.system, account: m.account_id, tag: m.user_tag || '' });
      if (!PAPER.includes(c.system)) stats.trade.nonPaper.push({ tid, system: c.system });
      if (S.silentN > 0) { S.silentN--; return true; }
      if (S.slowMs) { const d = S.slowMs; setTimeout(() => handle(c, m, um), d); return true; }
    }
    return handle(c, m, um);
  };
  function handle(c, m, um) {
    const tid = m.template_id, acct = m.account_id, base = { fcm_id: 'MOCK', ib_id: 'MOCK' };
    switch (tid) {
      case 300: c.send({ template_id: 301, user_msg: um, rp_code: ['0'], ...base, user_type: 3 }); return true;
      case 302: ACCTS.forEach((a) => c.send({ template_id: 303, user_msg: um, rq_handler_rp_code: ['0'], ...base, account_id: a.id, account_name: a.name, account_currency: 'USD' }));
        c.send({ template_id: 303, user_msg: um, rp_code: ['0'] }); return true;
      case 310: for (const ex of ['CME', 'CBOT', 'COMEX', 'NYMEX']) c.send({ template_id: 311, user_msg: um, rq_handler_rp_code: ['0'], ...base, exchange: ex, trade_route: 'simulator', status: 'UP', is_default: true });
        c.send({ template_id: 311, user_msg: um, rp_code: ['0'] }); return true;
      case 308: (c.orderSubs = c.orderSubs || new Set()).add(acct); c.send({ template_id: 309, user_msg: um, rp_code: ['0'] }); return true;
      case 336: c.send({ template_id: 337, user_msg: um, rp_code: ['0'] }); return true;
      case 320: for (const o of S.orders.values()) if (o.account === acct && o.status === 'open') c.send({ ...note(o), user_msg: um, is_snapshot: true });
        c.send({ template_id: 321, user_msg: um, rp_code: ['0'] }); return true;
      case 400: (c.pnlSubs = c.pnlSubs || new Set())[m.request === 2 ? 'delete' : 'add'](acct); c.send({ template_id: 401, user_msg: um, rp_code: ['0'] }); return true;
      case 402: for (const x of pnlMsgs(acct)) c.send({ ...x, is_snapshot: true }); c.send({ template_id: 403, user_msg: um, rp_code: ['0'] }); return true;
      case 312: case 330: onNew(c, m, um); return true;
      case 314: {
        const o = S.orders.get(m.basket_id);
        if (!o || o.status !== 'open') { c.send({ template_id: 315, user_msg: um, rp_code: ['5', 'order is not working'] }); return true; }
        if (m.price != null) o.price = m.price; if (m.trigger_price != null) o.trigger = m.trigger_price;
        c.send({ template_id: 315, user_msg: um, basket_id: o.basket, rp_code: ['0'] }); toOrderConns(o.account, note(o, { notify_type: 2 })); return true;
      }
      case 316: {
        const o = S.orders.get(m.basket_id);
        if (!o || o.status !== 'open') { c.send({ template_id: 317, user_msg: um, rp_code: ['5', 'order is not working'] }); return true; }
        o.status = 'cancelled'; o.reason = 'Cancel'; c.send({ template_id: 317, user_msg: um, basket_id: o.basket, rp_code: ['0'] }); pushOrder(o); return true;
      }
      case 346: for (const o of S.orders.values()) if (o.account === acct && o.status === 'open') { o.status = 'cancelled'; o.reason = 'Cancel all'; pushOrder(o); }
        c.send({ template_id: 347, user_msg: um, rp_code: ['0'] }); return true;
      case 3504: {
        c.send({ template_id: 3505, user_msg: um, rp_code: ['0'], symbol: m.symbol, exchange: m.exchange });
        for (const [k, p] of S.pos) {
          if (!k.startsWith(acct + '|') || !p.net || (m.symbol && m.symbol !== p.symbol)) continue;
          const o = addOrder({ account: acct, symbol: p.symbol, exchange: p.exchange, side: p.net > 0 ? 2 : 1, ptype: 2, qty: Math.abs(p.net), tag: 'exit' });
          fill(o, mkt(p.symbol));
        }
        return true;
      }
    }
    return false;
  }
  api.control = (u) => {
    const cmd = u.pathname.replace('/__trade/', '').replace('/__trade', 'state'), q = u.searchParams;
    if (cmd === 'fill') { const o = S.orders.get(q.get('basket')); if (o && o.status === 'open') fill(o, o.ptype === 1 ? o.price : o.trigger ?? mkt(o.symbol)); return { ok: !!o }; }
    if (cmd === 'reject') S.rejectN = Number(q.get('n') || 1);
    if (cmd === 'slow') S.slowMs = Number(q.get('ms') || 0);
    if (cmd === 'silent') S.silentN = Number(q.get('n') || 1);
    if (cmd === 'freeze') api.frozen = q.get('on') === '1';
    if (cmd === 'base' && setBase) setBase(q.get('sym'), Number(q.get('px')));
    if (cmd === 'reset') { if (resetBase) resetBase(); S.orders.clear(); S.pos.clear(); S.realized = {}; S.rejectN = S.slowMs = S.silentN = 0; api.frozen = false; stats.trade = { reqs: {}, orders: [], nonPaper: [] }; }
    return { orders: [...S.orders.values()].map((o) => ({ ...o })), pos: Object.fromEntries(S.pos), realized: S.realized, trade: stats.trade, frozen: api.frozen };
  };
  return api;
}
