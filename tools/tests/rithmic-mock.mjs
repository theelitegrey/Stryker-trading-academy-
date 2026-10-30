// Local mock of a Rithmic R|Protocol gateway, for the Charts "Connect broker" tests. Not deployed.
//   node tools/tests/rithmic-mock.mjs [port]        (default 8765, binds 127.0.0.1 ONLY)
// Speaks the same protobuf templates as Rithmic (via assets/rithmic-proto.js): system info,
// login (ticker + history plants), heartbeat, front month, market data subscribe with a
// synthetic NQ/ES trade stream, time-bar replay, logout. Prices are SYNTHETIC test data.
// The only accepted login is the fake pair demo / demo-pass (never a real account).
// Control endpoints (HTTP, same port): GET /__stats, GET /__drop (closes every socket).
// Zero dependencies: a minimal RFC 6455 server (binary frames, ping/close) is hand-rolled.
import http from 'node:http';
import crypto from 'node:crypto';
import { T, encode, decode } from '../../assets/rithmic-proto.js';
import { ACCOUNTS, DATES, SETS, PNL_TODAY } from './rithmic-orders-fixtures.mjs';

const PORT = Number(process.argv[2] || process.env.RITHMIC_MOCK_PORT || 8765);
const SYSTEMS = ['Rithmic Test', 'Rithmic Paper Trading', 'TradeSea', 'Apex'];
const FRONT = { NQ: 'NQZ6', MNQ: 'MNQZ6', ES: 'ESZ6', MES: 'MESZ6', GC: 'GCZ6', CL: 'CLX6' };
// Deliberately unlike any real price, so a test can tell mock bars from the normal data.
const BASE = { NQZ6: 11111, MNQZ6: 11111, ESZ6: 3333, MESZ6: 3333, GCZ6: 999, CLX6: 33 };
const stats = { forbidden: [], orderReqs: {}, connections: 0, logins: 0, loginsByInfra: {}, badLogins: 0, replays: 0, subscribes: 0, heartbeats: 0, logouts: 0, drops: 0 };
const sockets = new Set();

// Deterministic synthetic price: a smooth function of time (seconds), so history and live agree.
function px(sym, t) {
  const b = BASE[sym] || 100;
  const v = Math.sin(t / 3700) * 0.004 + Math.sin(t / 611) * 0.0015 + Math.sin(t / 97) * 0.0004;
  return Math.round(b * (1 + v) * 4) / 4;
}

// ---- tiny websocket server -------------------------------------------------------------
function frame(buf, op = 2) {
  const len = buf.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, buf]);
}
function makeConn(sock) {
  let acc = Buffer.alloc(0);
  const conn = { sock, plant: null, subs: new Set(), timer: null, hb: null, open: true,
    send(msg) { if (conn.open) sock.write(frame(Buffer.from(encode(msg)))); },
    close() { if (!conn.open) return; conn.open = false; try { sock.write(frame(Buffer.from([0x03, 0xe8]), 8)); } catch (e) {} sock.end(); cleanup(); } };
  const cleanup = () => { conn.open = false; clearInterval(conn.timer); sockets.delete(conn); };
  sock.on('data', (d) => {
    acc = Buffer.concat([acc, d]);
    while (acc.length >= 2) {
      const op = acc[0] & 0x0f;
      let len = acc[1] & 0x7f, off = 2;
      if (len === 126) { if (acc.length < 4) return; len = acc.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (acc.length < 10) return; len = Number(acc.readBigUInt64BE(2)); off = 10; }
      const masked = acc[1] & 0x80;
      if (acc.length < off + (masked ? 4 : 0) + len) return;
      let payload = acc.subarray(off + (masked ? 4 : 0), off + (masked ? 4 : 0) + len);
      if (masked) { const mk = acc.subarray(off, off + 4); payload = Buffer.from(payload.map((b, i) => b ^ mk[i % 4])); }
      acc = acc.subarray(off + (masked ? 4 : 0) + len);
      if (op === 8) { conn.close(); return; }
      if (op === 9) { sock.write(frame(payload, 10)); continue; }
      if (op === 2) { try { onMessage(conn, decode(payload)); } catch (e) { console.error('mock: bad frame', e.message); } }
    }
  });
  sock.on('close', cleanup);
  sock.on('error', cleanup);
  return conn;
}

// Synthetic depth: 20 levels a side around the synthetic price; walls at fixed offsets that come and go.
function sendBook(c, symbol, exchange, full) {
  const now = Date.now(), p = px(symbol, now / 1000), tick = symbol.startsWith('GC') ? 0.1 : 0.25;
  const mid = Math.round(p / tick) * tick, s = Math.floor(now / 1000);
  const bp = [], bs = [], ap = [], as = [];
  const wall = (k, side) => { const ph = Math.floor(now / 20000) + k * 7 + side; return (ph % 5 < 3) ? 120 + (ph % 7) * 40 : 0; };
  for (let k = 1; k <= 24; k++) {
    bp.push(mid - k * tick); bs.push(full || k < 4 ? 5 + ((now / 250 + k * 3) % 11 | 0) + wall(k, 1) : 0 + 5 + wall(k, 1));
    ap.push(mid + k * tick); as.push(full || k < 4 ? 5 + ((now / 250 + k * 5) % 13 | 0) + wall(k, 2) : 0 + 5 + wall(k, 2));
  }
  c.send({ template_id: T.ORDER_BOOK, symbol, exchange, presence_bits: 3, update_type: full ? 3 : 7, bid_price: bp, bid_size: bs, ask_price: ap, ask_size: as, ssboe: s, usecs: (now % 1000) * 1000 });
}


// ---- order plant (Journal import): synthetic order history from rithmic-orders-fixtures.mjs ----
const ORDER_ENTRY = new Set([312, 314, 316, 330, 332, 334, 346, 3500, 3502, 3504, 3508]);
const dayKey = (d) => d;                  // YYYYMMDD
// ExchangeOrderNotification rows. Order level (summary): one row per order; fill level (detail): one per fill.
function orderRow(o, acct) {
  const total = o.fills.reduce((a, f) => a + f[0], 0);
  return { template_id: T.EXCHANGE_ORDER_NOTIFY, notify_type: 1, is_snapshot: true, fcm_id: 'MOCK', ib_id: 'MOCK', account_id: acct, symbol: o.sym, exchange: 'CME',
    basket_id: o.basket, status: 'complete', transaction_type: o.side === 'buy' ? 1 : 2, quantity_64: total, total_fill_size_64: total, total_unfilled_size_64: 0,
    avg_fill_price: o.fills.reduce((a, f) => a + f[0] * f[1], 0) / total, price_type: 2, ssboe: Math.floor(o.fills[0][2] / 1000) };
}
function fillRows(o, acct) {
  return o.fills.map((f, i) => ({ template_id: T.EXCHANGE_ORDER_NOTIFY, notify_type: 5, is_snapshot: true, fcm_id: 'MOCK', ib_id: 'MOCK', account_id: acct, symbol: o.sym, exchange: 'CME',
    basket_id: o.basket, transaction_type: o.side === 'buy' ? 1 : 2, fill_price: f[1], fill_size_64: f[0], fill_id: o.basket + '-F' + (i + 1),
    commission_fill_rate: f[3] != null ? String(f[3]) : undefined,
    ssboe: Math.floor(f[2] / 1000) + 1, usecs: 0, source_ssboe: Math.floor(f[2] / 1000), source_usecs: (f[2] % 1000) * 1000 }));
}
function onOrderPlant(c, m) {
  const um = m.user_msg;
  stats.orderReqs[m.template_id] = (stats.orderReqs[m.template_id] || 0) + 1;
  if (ORDER_ENTRY.has(m.template_id)) { stats.forbidden.push(m.template_id); c.send({ template_id: T.REJECT, user_msg: um, rp_code: ['1', 'order entry is not available in the mock'] }); return true; }
  const deny = c.noHistory && [T.OH_DATES, T.OH_SUMMARY, T.OH_DETAIL, T.SHOW_ORDERS].includes(m.template_id);
  if (deny) { c.send({ template_id: m.template_id + 1, user_msg: um, rp_code: ['13', 'permission denied: order history is not enabled for this app'] }); return true; }
  const acct = m.account_id;
  switch (m.template_id) {
    case T.LOGIN_INFO: c.send({ template_id: T.LOGIN_INFO_R, user_msg: um, rp_code: ['0'], fcm_id: 'MOCK', ib_id: 'MOCK', user_type: 3, op_max_session_count: 1 }); return true;
    case T.ACCOUNT_LIST: {
      const list = c.oneAccount ? ACCOUNTS.slice(0, 1) : ACCOUNTS;
      list.forEach((a) => c.send({ template_id: T.ACCOUNT_LIST_R, user_msg: um, rq_handler_rp_code: ['0'], fcm_id: 'MOCK', ib_id: 'MOCK', account_id: a.id, account_name: a.name, account_currency: a.currency }));
      c.send({ template_id: T.ACCOUNT_LIST_R, user_msg: um, rp_code: ['0'] }); return true;
    }
    case T.OH_DATES: DATES.forEach((d) => c.send({ template_id: T.OH_DATES_R, user_msg: um, rq_handler_rp_code: ['0'], date: [d] }));
      c.send({ template_id: T.OH_DATES_R, user_msg: um, rp_code: ['0'] }); return true;
    case T.SHOW_ORDERS: case T.OH_SUMMARY: {
      const day = m.template_id === T.SHOW_ORDERS ? 'today' : m.date;
      const orders = (SETS[acct] && SETS[acct][day]) || [];
      orders.forEach((o) => c.send({ ...orderRow(o, acct), user_msg: um }));
      if (!orders.length) c.send({ template_id: m.template_id + 1, user_msg: um, rp_code: ['7', 'no data'] });
      else c.send({ template_id: m.template_id + 1, user_msg: um, rp_code: ['0'] });
      return true;
    }
    case T.OH_DETAIL: {
      const sets = (SETS[acct] || {});
      const all = Object.values(sets).flat();
      const o = all.find((x) => x.basket === m.basket_id);
      (o ? fillRows(o, acct) : []).forEach((r) => c.send({ ...r, user_msg: um }));
      c.send({ template_id: T.OH_DETAIL_R, user_msg: um, rp_code: ['0'] }); return true;
    }
    case T.PNL_SNAPSHOT:
      c.send({ template_id: T.PNL_ACCOUNT, is_snapshot: true, fcm_id: 'MOCK', ib_id: 'MOCK', account_id: acct, day_closed_pnl: String(PNL_TODAY[acct] ?? 0), rms_account_commission: '0' });
      c.send({ template_id: T.PNL_SNAPSHOT_R, user_msg: um, rp_code: ['0'] }); return true;
  }
  return false;
}

function onMessage(c, m) {
  const um = m.user_msg;
  if (c.plant === 2 || c.plant === 4) { if (m.template_id !== T.HEARTBEAT && m.template_id !== T.LOGOUT && onOrderPlant(c, m)) return; }
  switch (m.template_id) {
    case T.SYSTEM_INFO:
      // RITHMIC_MOCK_DELAY=ms makes the systems list slow (picker tests).
      setTimeout(() => c.send({ template_id: T.SYSTEM_INFO_R, user_msg: um, rp_code: ['0'], system_name: SYSTEMS, has_aggregated_quotes: SYSTEMS.map(() => false) }), Number(process.env.RITHMIC_MOCK_DELAY || 0));
      break;
    case T.LOGIN: {
      // Error modes: log in with the fake user name err-<mode> to get that Rithmic answer.
      const ERR = { 'err-perm': ['13', 'permission denied'], 'err-pass': ['11', 'invalid user id or password'], 'err-md': ['13', 'no market data subscription for this user'],
        'err-forced': ['77', 'forced logout'], 'err-elsewhere': ['5', 'user already logged in elsewhere'], 'err-odd': ['99', 'something unexpected happened'] };
      if (ERR[m.user]) { stats.badLogins++; c.send({ template_id: T.LOGIN_R, user_msg: um, rp_code: ERR[m.user] }); break; }
      const ok = (m.user === 'demo' || m.user === 'demo-nohist' || m.user === 'demo-one') && m.password === 'demo-pass' && SYSTEMS.includes(m.system_name) && !!m.app_name;
      if (!ok) { stats.badLogins++; c.send({ template_id: T.LOGIN_R, user_msg: um, rp_code: ['13', 'permission denied'] }); break; }
      stats.logins++;
      stats.loginsByInfra[m.infra_type] = (stats.loginsByInfra[m.infra_type] || 0) + 1;
      stats.lastApp = { app_name: m.app_name, app_version: m.app_version, template_version: m.template_version, system_name: m.system_name };
      c.plant = m.infra_type; c.system = m.system_name; c.noHistory = m.user === 'demo-nohist'; c.oneAccount = m.user === 'demo-one';
      c.send({ template_id: T.LOGIN_R, user_msg: um, rp_code: ['0'], template_version: '3.9', fcm_id: 'MOCK', ib_id: 'MOCK', unique_user_id: 'mock-user', heartbeat_interval: 5 });
      break;
    }
    case T.HEARTBEAT: stats.heartbeats++; break;
    case T.LOGOUT: stats.logouts++; c.send({ template_id: T.LOGOUT_R, user_msg: um, rp_code: ['0'] }); break;
    case T.FRONT_MONTH: {
      const sym = FRONT[m.symbol];
      // Like the real Rithmic Test on 2026-10-05: NQ gets rp_code 7 "no data", so the client's
      // calendar fallback is exercised. Other roots answer normally.
      if (!sym || m.symbol === 'NQ') c.send({ template_id: T.FRONT_MONTH_R, user_msg: um, rp_code: ['7', 'no data'] });
      else c.send({ template_id: T.FRONT_MONTH_R, user_msg: um, rp_code: ['0'], symbol: m.symbol, exchange: m.exchange, is_front_month_symbol: true, symbol_name: sym, trading_symbol: sym, trading_exchange: m.exchange });
      break;
    }
    case T.MD_UPDATE: {
      const key = m.symbol + '|' + m.exchange;
      if (m.update_bits === 4) {   // order book only (Liquidity Map). System 'TradeSea' = a login with no depth entitlement.
        if (c.system === 'TradeSea') { c.send({ template_id: T.MD_UPDATE_R, user_msg: um, rp_code: ['13', 'permission denied: no level 2 entitlement'] }); break; }
        c.books = c.books || new Set();
        if (m.request === 1) { c.books.add(key); stats.bookSubs = (stats.bookSubs || 0) + 1; } else c.books.delete(key);
        c.send({ template_id: T.MD_UPDATE_R, user_msg: um, rp_code: ['0'] });
        if (m.request === 1) sendBook(c, m.symbol, m.exchange, true);
        if (!c.bookTimer) c.bookTimer = setInterval(() => { for (const k of c.books) { const [s0, e0] = k.split('|'); sendBook(c, s0, e0, false); } }, 250);
        break;
      }
      if (m.request === 1) { c.subs.add(key); stats.subscribes++; } else c.subs.delete(key);
      c.send({ template_id: T.MD_UPDATE_R, user_msg: um, rp_code: ['0'] });
      if (!c.timer) c.timer = setInterval(() => {
        const now = Date.now();
        const s = Math.floor(now / 1000), us = (now % 1000) * 1000;
        for (const k of c.subs) {
          const [symbol, exchange] = k.split('|');
          const p = px(symbol, now / 1000) + (Math.random() < 0.5 ? -0.25 : 0.25);
          c.send({ template_id: T.LAST_TRADE, symbol, exchange, presence_bits: 1, trade_price: p, trade_size: 1 + Math.floor(Math.random() * 4), aggressor: Math.random() < 0.5 ? 1 : 2, ssboe: s, usecs: us, source_ssboe: s, source_usecs: us });
          c.send({ template_id: T.BBO, symbol, exchange, presence_bits: 3, bid_price: p - 0.25, bid_size: 5, ask_price: p, ask_size: 6, ssboe: s, usecs: us });
        }
      }, 200);
      break;
    }
    case T.TIME_BAR_REPLAY: {
      stats.replays++;
      const sym = m.symbol;
      const step = m.bar_type === 2 ? (m.bar_type_period || 1) * 60 : 86400;
      const now = Math.floor(Date.now() / 1000);
      const end = Math.min(m.finish_index || now, now);
      const max = Math.min(m.user_max_count || 10000, 10000);
      const out = [];
      // bars close at multiples of step; marker = bar END time; skip the daily 21:00-22:00 UTC break
      let close = Math.floor(end / step) * step + step; // newest = the forming bar
      while (close - step >= (m.start_index || 0) && out.length < max) {
        const open = close - step;
        const h = new Date(open * 1000).getUTCHours();
        const dow = new Date(open * 1000).getUTCDay();
        if (step >= 86400 || !(h === 21 || dow === 6 || (dow === 5 && h > 21) || (dow === 0 && h < 22))) out.push(open);
        close -= step;
      }
      out.reverse();
      for (const open of out) {
        const o = px(sym, open), cl = px(sym, Math.min(open + step, now));
        const hi = Math.max(o, cl) + 1.25, lo = Math.min(o, cl) - 1.25;
        c.send({ template_id: T.TIME_BAR_REPLAY_R, user_msg: um, request_key: 'k', symbol: sym, exchange: m.exchange, type: m.bar_type,
          period: String(m.bar_type_period || 1), marker: open + step, open_price: o, high_price: hi, low_price: lo, close_price: cl, volume: 100 + (open % 900), num_trades: 50 });
      }
      c.send({ template_id: T.TIME_BAR_REPLAY_R, user_msg: um, rp_code: ['0'], rq_handler_rp_code: [] });
      break;
    }
    default:
      c.send({ template_id: T.REJECT, user_msg: um, rp_code: ['1', 'unsupported template ' + m.template_id] });
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  if (req.url === '/__stats') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ...stats, open: sockets.size })); return; }
  if (req.url === '/__drop') { stats.drops++; for (const c of [...sockets]) { c.open = false; c.sock.destroy(); sockets.delete(c); clearInterval(c.timer); } res.end('dropped'); return; }
  res.writeHead(404); res.end();
});
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  stats.connections++;
  sockets.add(makeConn(sock));
});
server.listen(PORT, '127.0.0.1', () => console.log('rithmic mock on ws://127.0.0.1:' + PORT));
