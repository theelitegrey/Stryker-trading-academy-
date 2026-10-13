// Rithmic conformance (implementation check, 2026-10-13): the app must SUBSCRIBE for updates and
// take ONE snapshot, never poll Rithmic for data. Pure node, no browser, no network:
//   node tools/tests/rithmic-no-poll.test.mjs
// An in-process mock gateway (a fake WebSocket speaking assets/rithmic-proto.js) counts every
// request the real client + provider send over a simulated 30-minute session on a virtual clock:
// NQ 1m, ES 5m, scroll-back, timeframe change, the watchlist / paper / data-dot style "latest bars"
// reads that repeat every few seconds, tab hide + resume (chart-live-resume.js resync + Vela's
// gap heal), a dropped connection, then logout. Expected: a small fixed set of data requests and
// ZERO data requests during the long idle stretches (only heartbeats).
import assert from 'node:assert/strict';
import { T, encode, decode } from '../../assets/rithmic-proto.js';

// ---- virtual clock ---------------------------------------------------------------------------
let now = Date.UTC(2026, 9, 13, 14, 0, 0); // Tue 14:00 UTC, market open
const timers = new Map();
let tid = 0;
const realNow = Date.now;
Date.now = () => now;
globalThis.setTimeout = (fn, ms = 0, ...a) => { const id = ++tid; timers.set(id, { at: now + Math.max(0, ms), fn, a, every: 0 }); return id; };
globalThis.setInterval = (fn, ms = 0, ...a) => { const id = ++tid; timers.set(id, { at: now + Math.max(1, ms), fn, a, every: Math.max(1, ms) }); return id; };
globalThis.clearTimeout = globalThis.clearInterval = (id) => { timers.delete(id); };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); await new Promise((r) => setImmediate(r)); };
async function advance(ms) {
  const end = now + ms;
  for (;;) {
    await flush();
    let next = null;
    for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
    if (!next) break;
    const [id, t] = next;
    now = t.at;
    if (t.every) t.at += t.every; else timers.delete(id);
    try { t.fn(...t.a); } catch (e) { /* timer errors are the code's own business */ }
  }
  now = end;
  await flush();
}

// ---- mock gateway ----------------------------------------------------------------------------
const sent = [];       // { t, plant, tid, request? }
let phase = 'setup';
const socks = new Set();
class FakeWS {
  constructor(url) {
    this.url = url; this.readyState = 0; this.plant = null; this.subs = new Set(); this.tick = null;
    socks.add(this);
    setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 5);
  }
  reply(msg) { setTimeout(() => { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: encode(msg).buffer }); }, 2); }
  send(buf) {
    const m = decode(buf);
    const um = m.user_msg;
    if (m.template_id === T.LOGIN) this.plant = m.infra_type === 1 ? 'ticker' : 'history';
    sent.push({ t: now, phase, plant: this.plant || 'system', tid: m.template_id, request: m.request, need_updates: m.need_updates });
    switch (m.template_id) {
      case T.LOGIN: this.reply({ template_id: T.LOGIN_R, user_msg: um, rp_code: ['0'], unique_user_id: 'mock-' + this.plant, heartbeat_interval: 60 }); break;
      case T.LOGOUT: this.reply({ template_id: T.LOGOUT_R, user_msg: um, rp_code: ['0'] }); break;
      case T.FRONT_MONTH: this.reply({ template_id: T.FRONT_MONTH_R, user_msg: um, rp_code: ['0'], symbol: m.symbol, exchange: m.exchange, trading_symbol: m.symbol + 'Z6', trading_exchange: m.exchange }); break;
      case T.MD_UPDATE: {
        const k = m.symbol + '|' + m.exchange;
        if (m.request === 1) this.subs.add(k); else this.subs.delete(k);
        this.reply({ template_id: T.MD_UPDATE_R, user_msg: um, rp_code: ['0'] });
        if (m.request === 1) this.reply({ template_id: T.LAST_TRADE, symbol: m.symbol, exchange: m.exchange, is_snapshot: true, trade_price: 100, trade_size: 1, ssboe: Math.floor(now / 1000) });
        if (!this.tick) this.tick = setInterval(() => {
          for (const key of this.subs) {
            const [symbol, exchange] = key.split('|');
            const s = Math.floor(now / 1000);
            this.reply({ template_id: T.LAST_TRADE, symbol, exchange, trade_price: 100 + (s % 7) * 0.25, trade_size: 1, aggressor: 1, ssboe: s, source_ssboe: s });
          }
        }, 2000);
        break;
      }
      case T.TIME_BAR_REPLAY: {
        const step = m.bar_type === 2 ? (m.bar_type_period || 1) * 60 : 86400;
        const end = Math.min(m.finish_index, Math.floor(now / 1000));
        const n = Math.min(m.user_max_count || 10000, Math.floor((end - m.start_index) / step) + 1);
        let close = Math.floor(end / step) * step + step;
        const rows = [];
        for (let i = 0; i < n && close - step >= m.start_index; i++, close -= step) rows.push(close);
        rows.reverse().forEach((mk) => this.reply({ template_id: T.TIME_BAR_REPLAY_R, user_msg: um, symbol: m.symbol, exchange: m.exchange, type: m.bar_type, marker: mk, open_price: 100, high_price: 101, low_price: 99, close_price: 100.5, volume: 10 }));
        this.reply({ template_id: T.TIME_BAR_REPLAY_R, user_msg: um, rp_code: ['0'] });
        break;
      }
      default: break;
    }
  }
  close() { if (this.readyState === 3) return; this.readyState = 3; clearInterval(this.tick); socks.delete(this); setTimeout(() => this.onclose && this.onclose(), 1); }
  drop() { this.readyState = 3; clearInterval(this.tick); socks.delete(this); this.onclose && this.onclose(); }
}
globalThis.WebSocket = FakeWS;

const { RithmicClient } = await import('../../assets/rithmic-client.js');
const { RithmicFuturesProvider } = await import('../../assets/rithmic-provider.js');
const { liveSubscribe } = await import('../../assets/chart-live-resume.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
const DATA = new Set([T.MD_UPDATE, T.FRONT_MONTH, T.TIME_BAR_REPLAY]);
const count = (f) => sent.filter(f).length;
const replays = (ph) => count((s) => s.tid === T.TIME_BAR_REPLAY && (!ph || s.phase === ph));
// Data FETCHES (an unsubscribe is a release, not a fetch: it is allowed when a contract is no longer shown).
const dataIn = (ph) => count((s) => DATA.has(s.tid) && !(s.tid === T.MD_UPDATE && s.request === 2) && s.phase === ph);

const fallback = { info: () => ({ capabilities: {} }), getBars: async () => { throw new Error('fallback used'); }, subscribe: () => () => {} };
const client = new RithmicClient({ gateway: 'wss://mock', appName: 'test', appVersion: '1', templateVersion: '5.55' });
// Charts makes a new provider instance per chart cell; the live series must be shared.
const P = () => new RithmicFuturesProvider(client, fallback, {});
const prov = P(), prov2 = P();

// A chart as Vela + chart-live-resume drive it: initial load, live subscription with resync.
const charts = new Map();
async function openChart(sym, tf) {
  const p = charts.size % 2 ? prov2 : prov;
  const bars = await p.getBars(sym, tf, { limit: 500 });
  const st = { bars: bars.slice(), updates: 0 };
  st.stop = liveSubscribe((cb) => p.subscribe(sym, tf, cb), (r) => p.getBars(sym, tf, r), tf, (b) => {
    st.updates++;
    const last = st.bars[st.bars.length - 1];
    if (last && b.time === last.time) st.bars[st.bars.length - 1] = b; else if (!last || b.time > last.time) st.bars.push(b);
  });
  st.p = p; st.sym = sym; st.tf = tf;
  charts.set(sym + tf, st);
  return st;
}
const closeChart = (k) => { const c = charts.get(k); if (c) { c.stop(); charts.delete(k); } };

// The other Charts readers that ask for the latest bars over and over:
//   watchlist: getBars(sym, 'D', {limit:2}) every 25 s; paper feedOffChart: getBars(sym, '1', {limit:5})
//   every 5 s; built interval (3m) poll: getBars(sym, '1', {limit:..}) every 20 s; Vela gap heal on tab
//   return: loadRange {from: last}. All must be answered from the live series.
function startPollers() {
  const ids = [];
  ids.push(setInterval(() => { prov.getBars('NQ1!', 'D', { limit: 2 }); prov.getBars('ES1!', 'D', { limit: 2 }); }, 25000));
  ids.push(setInterval(() => { prov2.getBars('NQ1!', '1', { limit: 5 }); }, 5000));
  ids.push(setInterval(() => { prov.getBars('ES1!', '5', { limit: 40 }); }, 20000));
  return () => ids.forEach(clearInterval);
}

// ---- the session ------------------------------------------------------------------------------
phase = 'login';
const conn = client.connect({ user: 'demo', password: 'x', systemName: 'Rithmic Test' });
await advance(100); await conn;
ok(client.connected, 'connected (ticker + history plants)');
const ids = client.sessions();
ok(ids.length === 2 && ids[0].uniqueUserId === 'mock-ticker' && ids[1].uniqueUserId === 'mock-history' && ids.every((x) => x.loginAt === ids[0].loginAt || x.loginAt > 0),
  'unique_user_id kept per plant from the login response');

phase = 'nq1m';
const nqP = openChart('NQ1!', '1'); await advance(500); const nq = await nqP;
ok(nq.bars.length > 100, 'NQ 1m history loaded (' + nq.bars.length + ' bars)');
ok(replays('nq1m') === 1, 'NQ 1m: one time-bar replay');
ok(count((s) => s.phase === 'nq1m' && s.tid === T.MD_UPDATE && s.request === 1) === 1, 'NQ: one market-data subscribe');
ok(count((s) => s.phase === 'nq1m' && s.tid === T.FRONT_MONTH) === 1 && sent.filter((s) => s.tid === T.FRONT_MONTH).every((s) => !s.need_updates), 'NQ: one front-month lookup, need_updates false');

phase = 'es5m';
const esP = openChart('ES1!', '5'); await advance(500); const es = await esP;
closeChart('NQ1!1');
await advance(5000);
ok(replays('es5m') === 1, 'ES 5m: one time-bar replay');
ok(count((s) => s.phase === 'es5m' && s.tid === T.MD_UPDATE && s.request === 1) === 1, 'ES: one market-data subscribe');
ok(count((s) => s.phase === 'es5m' && s.tid === T.MD_UPDATE && s.request === 2) <= 1, 'NQ unsubscribed at most once when its chart closed');

phase = 'scroll';
const first = es.bars[0].time;
const older = await (async () => { const pr = es.p.getBars('ES1!', '5', { to: first - 1, limit: 500 }); await advance(500); return pr; })();
ok(older.length > 100 && older[0].time < first - 100 * 300000, 'scroll-back page loaded older bars');
ok(replays('scroll') === 1, 'scroll-back: exactly one replay for one page');

phase = 'tf';
closeChart('ES1!5');
const es15P = openChart('ES1!', '15'); await advance(500); const es15 = await es15P;
ok(replays('tf') === 1, 'timeframe change ES 5m -> 15m: one replay');
ok(count((s) => s.phase === 'tf' && s.tid === T.MD_UPDATE) === 0, 'timeframe change: no new subscribe (same contract)');

// Idle 10 min with every repeating reader running, the tab hidden for 3 min and resumed.
// The watchlist opens: its first daily read per symbol is that series' one snapshot.
phase = 'watchlist';
const stopPollers = startPollers();
await advance(26000);
ok(replays('watchlist') === 2, 'watchlist opened: one daily snapshot replay per symbol (NQ, ES)');
phase = 'idle';
const before = es15.updates;
await advance(4 * 60000);
if (typeof document === 'undefined') {
  // chart-live-resume: on return it closes + reopens the feed and back-fills from the newest bar.
  globalThis.document = { visibilityState: 'visible', hidden: false, addEventListener() {}, removeEventListener() {} };
}
await advance(3 * 60000);                     // "hidden": nothing special server-side
// tab resume: every chart resyncs (re-open subscription + backfill from newest bar) and Vela heals
for (const c of charts.values()) { const last = c.bars[c.bars.length - 1]; c.p.getBars(c.sym, c.tf, { from: last.time }); }
await advance(3 * 60000 + 2000);
stopPollers();
ok(es15.updates > before + 100, 'forming bar kept moving from LastTrade updates (' + (es15.updates - before) + ' updates)');
const lastBar = es15.bars[es15.bars.length - 1];
ok(lastBar.time > now - 20 * 60000, 'new 5m candles were rolled from trades, not re-fetched');
ok(dataIn('idle') === 0, '10 min idle incl. watchlist/paper/built-interval reads + tab resume: ZERO data requests (got ' + dataIn('idle') + ')');
const hb = sent.filter((s) => s.phase === 'idle' && s.tid === T.HEARTBEAT);
ok(hb.length <= 2 * 2 * 11, 'heartbeats only at the server interval (' + hb.length + ' in 10 min, 2 plants, 60 s interval)');

// A dropped connection: reconnect ONCE, re-subscribe once, replay only the gap.
phase = 'drop';
for (const s of [...socks]) s.drop();
await advance(1500);
ok(client.connected, 'reconnected after one drop');
const es5 = await (async () => { const pr = es15.p.getBars('ES1!', '15', { limit: 500 }); await advance(500); return pr; })();
await advance(30000);
ok(count((s) => s.phase === 'drop' && s.tid === T.LOGIN) === 2, 'one login per plant on reconnect');
const live = client.marketSubs.size;
ok(count((s) => s.phase === 'drop' && s.tid === T.MD_UPDATE && s.request === 1) === live, 'one re-subscribe per contract still in use (' + live + ')');
ok(replays('drop') === 1, 'one gap replay (only for the series that was read) after the reconnect');
const gapReq = sent.filter((s) => s.phase === 'drop' && s.tid === T.TIME_BAR_REPLAY);
ok(es5.length >= 400, 'chart still has its full history after the gap fill');

phase = 'quiet';
await advance(19 * 60000);
ok(dataIn('quiet') === 0, 'another 19 min quiet: zero data fetches (' + count((x) => x.phase === 'quiet' && x.tid === T.MD_UPDATE && x.request === 2) + ' unsubscribe for a contract no chart shows any more)');

phase = 'logout';
const d = client.disconnect(); await advance(3000); await d;
ok(count((s) => s.phase === 'logout' && s.tid === T.LOGOUT) === 2, 'clean logout on both plants');
ok(client.sessionLog.length >= 2 && client.sessionLog.every((x) => x.logoutAt >= x.loginAt), 'session log has login + logout times');

// ---- totals -------------------------------------------------------------------------------------
const tally = {};
for (const s of sent) { const k = s.plant + ' ' + s.tid + (s.tid === T.MD_UPDATE ? (s.request === 2 ? ' unsub' : ' sub') : ''); tally[k] = (tally[k] || 0) + 1; }
const totalData = count((s) => DATA.has(s.tid));
console.log('requests over the simulated session:', JSON.stringify(tally));
ok(totalData <= 16, 'whole session: bounded data requests (' + totalData + ')');
const span = (sent[sent.length - 1].t - sent[0].t) / 60000;
ok(span >= 30, 'simulated session length ' + Math.round(span) + ' min');
Date.now = realNow;
console.log(`\n${n} checks passed`);
process.exit(0);
