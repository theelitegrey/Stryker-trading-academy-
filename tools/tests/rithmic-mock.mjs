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

const PORT = Number(process.argv[2] || process.env.RITHMIC_MOCK_PORT || 8765);
const SYSTEMS = ['Rithmic Test', 'Rithmic Paper Trading', 'TradeSea'];
const FRONT = { NQ: 'NQZ6', MNQ: 'MNQZ6', ES: 'ESZ6', MES: 'MESZ6', GC: 'GCZ6', CL: 'CLX6' };
// Deliberately unlike any real price, so a test can tell mock bars from the normal data.
const BASE = { NQZ6: 11111, MNQZ6: 11111, ESZ6: 3333, MESZ6: 3333, GCZ6: 999, CLX6: 33 };
const stats = { connections: 0, logins: 0, loginsByInfra: {}, badLogins: 0, replays: 0, subscribes: 0, heartbeats: 0, logouts: 0, drops: 0 };
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

function onMessage(c, m) {
  const um = m.user_msg;
  switch (m.template_id) {
    case T.SYSTEM_INFO:
      c.send({ template_id: T.SYSTEM_INFO_R, user_msg: um, rp_code: ['0'], system_name: SYSTEMS, has_aggregated_quotes: SYSTEMS.map(() => false) });
      break;
    case T.LOGIN: {
      const ok = m.user === 'demo' && m.password === 'demo-pass' && SYSTEMS.includes(m.system_name) && !!m.app_name;
      if (!ok) { stats.badLogins++; c.send({ template_id: T.LOGIN_R, user_msg: um, rp_code: ['13', 'permission denied'] }); break; }
      stats.logins++;
      stats.loginsByInfra[m.infra_type] = (stats.loginsByInfra[m.infra_type] || 0) + 1;
      stats.lastApp = { app_name: m.app_name, app_version: m.app_version, template_version: m.template_version, system_name: m.system_name };
      c.plant = m.infra_type;
      c.send({ template_id: T.LOGIN_R, user_msg: um, rp_code: ['0'], template_version: '3.9', fcm_id: 'MOCK', ib_id: 'MOCK', unique_user_id: 'mock-user', heartbeat_interval: 5 });
      break;
    }
    case T.HEARTBEAT: stats.heartbeats++; break;
    case T.LOGOUT: stats.logouts++; c.send({ template_id: T.LOGOUT_R, user_msg: um, rp_code: ['0'] }); break;
    case T.FRONT_MONTH: {
      const sym = FRONT[m.symbol];
      if (!sym) c.send({ template_id: T.FRONT_MONTH_R, user_msg: um, rp_code: ['7', 'no data'] });
      else c.send({ template_id: T.FRONT_MONTH_R, user_msg: um, rp_code: ['0'], symbol: m.symbol, exchange: m.exchange, is_front_month_symbol: true, symbol_name: sym, trading_symbol: sym, trading_exchange: m.exchange });
      break;
    }
    case T.MD_UPDATE: {
      const key = m.symbol + '|' + m.exchange;
      if (m.request === 1) { c.subs.add(key); stats.subscribes++; } else c.subs.delete(key);
      c.send({ template_id: T.MD_UPDATE_R, user_msg: um, rp_code: ['0'] });
      if (!c.timer) c.timer = setInterval(() => {
        const now = Date.now();
        const s = Math.floor(now / 1000), us = (now % 1000) * 1000;
        for (const k of c.subs) {
          const [symbol, exchange] = k.split('|');
          const p = px(symbol, now / 1000) + (Math.random() < 0.5 ? -0.25 : 0.25);
          c.send({ template_id: T.LAST_TRADE, symbol, exchange, presence_bits: 1, trade_price: p, trade_size: 1 + Math.floor(Math.random() * 4), aggressor: 1, ssboe: s, usecs: us, source_ssboe: s, source_usecs: us });
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
