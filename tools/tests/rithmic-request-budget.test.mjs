// Rithmic resource-use budget (conformance passed 2026-10-19; Rithmic is stricter on excessive
// snapshot/replay use). Pure node, no browser, no network, virtual clock:
//   node tools/tests/rithmic-request-budget.test.mjs            (RITHMIC_SRC=<dir> to test another checkout's assets/)
// Typical session: connect, load NQ 1m, switch to 5m, back to 1m, scroll back (the same page twice),
// then idle 2 minutes with the usual repeating readers (watchlist, off-chart paper, built interval).
// Asserts: no timer-driven data repeat in the idle stretch, history in-flight cap, cache of
// scroll-back pages, no replay while the tab is hidden, backoff after errors, plain-English
// login errors, and that the client has no order-routing messages. Prints the request counts.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const SRC = path.resolve(process.env.RITHMIC_SRC || new URL('../../assets', import.meta.url).pathname);
const imp = (f) => import(pathToFileURL(path.join(SRC, f)).href);
const { T, encode, decode } = await imp('rithmic-proto.js');

let now = Date.UTC(2026, 9, 20, 14, 0, 0);
const timers = new Map(); let tid = 0;
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
    const [id, t] = next; now = t.at;
    if (t.every) t.at += t.every; else timers.delete(id);
    try { t.fn(...t.a); } catch (e) {}
  }
  now = end; await flush();
}

const sent = []; let phase = 'setup'; const socks = new Set();
let histDelay = 2, histInflight = 0, histPeak = 0, histFail = false, loginReject = null;
class FakeWS {
  constructor(url) { this.url = url; this.readyState = 0; this.subs = new Set(); socks.add(this); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 5); }
  reply(msg, d = 2) { setTimeout(() => { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: encode(msg).buffer }); }, d); }
  send(buf) {
    const m = decode(buf), um = m.user_msg;
    if (m.template_id === T.LOGIN) this.plant = m.infra_type === 1 ? 'ticker' : 'history';
    sent.push({ phase, plant: this.plant || 'system', tid: m.template_id, request: m.request });
    switch (m.template_id) {
      case T.LOGIN: this.reply(loginReject ? { template_id: T.LOGIN_R, user_msg: um, rp_code: loginReject } : { template_id: T.LOGIN_R, user_msg: um, rp_code: ['0'], unique_user_id: 'm', heartbeat_interval: 60 }); break;
      case T.LOGOUT: this.reply({ template_id: T.LOGOUT_R, user_msg: um, rp_code: ['0'] }); break;
      case T.FRONT_MONTH: this.reply({ template_id: T.FRONT_MONTH_R, user_msg: um, rp_code: ['0'], symbol: m.symbol, exchange: m.exchange, trading_symbol: m.symbol + 'Z6', trading_exchange: m.exchange }); break;
      case T.MD_UPDATE:
        if (m.request === 1) this.subs.add(m.symbol); else this.subs.delete(m.symbol);
        this.reply({ template_id: T.MD_UPDATE_R, user_msg: um, rp_code: ['0'] });
        if (!this.tick) this.tick = setInterval(() => { for (const s of this.subs) { const sec = Math.floor(now / 1000); this.reply({ template_id: T.LAST_TRADE, symbol: s, exchange: 'CME', trade_price: 100 + (sec % 7) * 0.25, trade_size: 1, aggressor: 1, ssboe: sec, source_ssboe: sec }); } }, 2000);
        break;
      case T.TIME_BAR_REPLAY: {
        histInflight++; histPeak = Math.max(histPeak, histInflight);
        const finish = () => {
          histInflight--;
          if (histFail) { this.reply({ template_id: T.TIME_BAR_REPLAY_R, user_msg: um, rp_code: ['3', 'boom'] }, 0); return; }
          const step = m.bar_type === 2 ? (m.bar_type_period || 1) * 60 : 86400;
          const end = Math.min(m.finish_index, Math.floor(now / 1000));
          const n = Math.min(m.user_max_count || 10000, Math.floor((end - m.start_index) / step) + 1);
          let close = Math.floor(end / step) * step + step; const rows = [];
          for (let i = 0; i < n && close - step >= m.start_index; i++, close -= step) rows.push(close);
          rows.reverse().forEach((mk) => this.reply({ template_id: T.TIME_BAR_REPLAY_R, user_msg: um, symbol: m.symbol, exchange: m.exchange, type: m.bar_type, marker: mk, open_price: 100, high_price: 101, low_price: 99, close_price: 100.5, volume: 10 }, 0));
          this.reply({ template_id: T.TIME_BAR_REPLAY_R, user_msg: um, rp_code: ['0'] }, 0);
        };
        setTimeout(finish, histDelay);
        break;
      }
    }
  }
  close() { if (this.readyState === 3) return; this.readyState = 3; clearInterval(this.tick); setTimeout(() => this.onclose && this.onclose(), 1); }
}
globalThis.WebSocket = FakeWS;
const vis = { visibilityState: 'visible', hidden: false, _l: [], addEventListener(t, f) { if (t === 'visibilitychange') this._l.push(f); }, removeEventListener() {} };
globalThis.document = vis;
const setVisible = (v) => { vis.visibilityState = v ? 'visible' : 'hidden'; vis.hidden = !v; vis._l.forEach((f) => f()); };

const { RithmicClient, friendlyLoginError } = await imp('rithmic-client.js');
const { RithmicFuturesProvider } = await imp('rithmic-provider.js');
let n = 0, bad = 0; const ok = (c, m) => { if (process.env.BASELINE) { if (!c) bad++; console.log(c ? 'PASS' : 'FAIL', m); n++; return; } assert.ok(c, m); n++; console.log('PASS', m); };
const count = (f) => sent.filter(f).length;
const replays = (ph) => count((s) => s.tid === T.TIME_BAR_REPLAY && (!ph || s.phase === ph));
const fallback = { info: () => ({ capabilities: {} }), getBars: async () => { throw new Error('fallback used'); }, subscribe: () => () => {} };
const client = new RithmicClient({ gateway: 'wss://mock', appName: 'test', appVersion: '1', templateVersion: '5.55' });
const prov = new RithmicFuturesProvider(client, fallback, {});
const get = async (sym, tf, r) => { const p = prov.getBars(sym, tf, r); await advance(300); return p; };

phase = 'login';
const c = client.connect({ user: 'demo', password: 'x', systemName: 'Rithmic Test' }); await advance(100); await c;
ok(client.connected, 'connected');

phase = 'load';        const nq1 = await get('NQ1!', '1', { limit: 500 });
phase = 'tf5';         await get('NQ1!', '5', { limit: 500 });
phase = 'tf1-back';    await get('NQ1!', '1', { limit: 500 });
ok(nq1.length > 100, 'NQ 1m loaded');
ok(replays('load') === 1 && replays('tf5') === 1, 'one replay per timeframe on first load');
ok(replays('tf1-back') === 0, 'switching back to a timeframe already loaded: served from memory (0 replays)');

phase = 'scroll1';     const older1 = await get('NQ1!', '1', { to: nq1[0].time - 1, limit: 500 });
phase = 'scroll2';     const older2 = await get('NQ1!', '1', { to: nq1[0].time - 1, limit: 500 });
ok(older1.length > 100 && older2.length === older1.length, 'scroll-back page returned');
ok(replays('scroll1') === 1 && replays('scroll2') === 0, 'same scroll-back page requested twice: ONE replay (cached)');

phase = 'idle';
const ids = [
  setInterval(() => { prov.getBars('NQ1!', 'D', { limit: 2 }); }, 25000),
  setInterval(() => { prov.getBars('NQ1!', '1', { limit: 5 }); }, 5000),
  setInterval(() => { prov.getBars('NQ1!', '5', { limit: 40 }); }, 20000)
];
await advance(26000); // the watchlist's first daily read = that series' one snapshot
const snap = replays('idle');
await advance(2 * 60000);
ids.forEach(clearInterval);
const DATA = new Set([T.MD_UPDATE, T.FRONT_MONTH, T.TIME_BAR_REPLAY]);
const idleData = count((s) => s.phase === 'idle' && DATA.has(s.tid) && !(s.tid === T.MD_UPDATE && s.request === 2));
ok(snap <= 1 && replays('idle') === snap, 'idle 2 min with repeating readers: no timer-driven replay after the one daily snapshot (' + replays('idle') + ')');
ok(idleData === snap, 'idle 2 min: no data request except that snapshot (' + idleData + ')');

// in-flight cap
phase = 'cap'; histDelay = 50; histPeak = 0;
const many = [];
for (let i = 0; i < 6; i++) many.push(prov.rithmicBars('NQ', '5', { to: nq1[0].time - 1 - (i + 3) * 3600000, limit: 100 }));
await advance(2000); await Promise.all(many);
ok(replays('cap') === 6 && histPeak <= 2, 'six parallel history requests: at most 2 in flight (peak ' + histPeak + ')');
histDelay = 2;

// hidden tab
phase = 'hidden'; setVisible(false);
const hp = prov.rithmicBars('NQ', '15', { to: nq1[0].time - 1 - 50 * 3600000, limit: 100 });
await advance(60000);
ok(replays('hidden') === 0, 'tab hidden: no history request is sent');
setVisible(true); await advance(500); await hp;
ok(replays('hidden') === 1, 'tab visible again: the waiting request goes out once');

// error backoff
const tryPage = async (h) => { const p = prov.rithmicBars('NQ', '30', { to: nq1[0].time - 1 - h * 3600000, limit: 100 }).catch(() => {}); await advance(500); await p; };
phase = 'err'; histFail = true;
await tryPage(80);
const e1 = replays('err');
await tryPage(90);
ok(e1 === 1 && replays('err') === 1, 'after a failed replay, the next one is held back (no hammering)');
histFail = false; await advance(6000);
await tryPage(90);
ok(replays('err') === 2, 'after the pause it is allowed again');

// login errors in plain English (mapped by rp code AND text; message names the member's system)
const { explainLoginError, FORCED_LOGOUT_MSG } = await imp('rithmic-client.js');
const X = (codes, extra) => explainLoginError({ codes, system: 'Bulenox', gateway: 'Chicago', appName: 'ZoroCharts', ...(extra || {}) });
ok(X(['13', 'permission denied']).kind === 'permission' && X(['13', 'permission denied']).message.includes('Bulenox') && X(['13', 'permission denied']).message.includes('"ZoroCharts"'), 'rp 13 permission -> names system + app');
ok(X(['13']).kind === 'permission', 'rp 13 with no text -> permission');
ok(X(['2', 'application not allowed for user']).kind === 'permission', 'app-not-allowed text, other code -> permission');
ok(X(['13', 'invalid user id or password']).kind === 'credentials' && X(['11', 'invalid password']).message.includes('not the website login'), 'wrong password -> credentials message');
ok(X(['7', 'no market data subscription']).kind === 'marketdata' && X(['7', 'no market data subscription']).message.includes('Bulenox'), 'market data');
ok(X(['77', 'forced logout']).message === FORCED_LOGOUT_MSG && X(['77']).kind === 'forced', 'rp 77 -> forced logout');
ok(X(['5', 'user already logged in elsewhere']).kind === 'forced', 'logged in elsewhere text');
ok(X(['5', 'maximum number of sessions exceeded']).kind === 'forced', 'max sessions text');
ok(X([], { text: 'Could not reach Rithmic' }).message.includes("Rithmic's Chicago server"), 'network -> gateway name');
ok(X([], { text: 'Rithmic did not answer in time' }).kind === 'network', 'timeout -> network');
const unk = X(['99', 'something odd']);
ok(unk.kind === 'unknown' && unk.message.includes('something odd') && unk.message.includes('Contact your prop firm'), 'unknown shows Rithmic text + contact firm');
ok(explainLoginError({ codes: '13 | permission denied', system: 'Apex' }).message.includes('Apex'), 'rpRaw string form works');
ok(explainLoginError({ codes: ['13', 'permission denied'], system: 'Apex', appName: 'X App' }).message.includes('"X App"'), 'app name flows from config');
ok(friendlyLoginError('invalid password') !== '' , 'friendlyLoginError recognises credentials');

// data only: no order templates anywhere in the client / proto
const fs = await import('node:fs');
const src = ['rithmic-proto.js', 'rithmic-client.js', 'rithmic-provider.js', 'rithmic-ui.js'].map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
ok(!/(RequestNewOrder|RequestModifyOrder|RequestCancelOrder|RequestBracketOrder|RequestOcoOrder|RequestSubscribeForOrderUpdates|RequestShowOrders|RequestEnterPosition)/.test(src), 'DATA ONLY: no order request in the Rithmic code');

// Rithmic's own reason is carried on the login error (shown in small grey print by the sheet)
{
  const c2 = new RithmicClient({ gateway: 'wss://mock', appName: 'x', appVersion: '1', templateVersion: '5.55' });
  loginReject = ['13', 'permissions: app not enabled for user'];
  let caught = null;
  const pr = c2.connect({ user: 'u', password: 'SECRET-PW-123', systemName: 'tradesea' }).catch((e) => { caught = e; });
  await advance(300); await pr;
  loginReject = null;
  ok(caught && caught.rpRaw === '13 | permissions: app not enabled for user', 'login error carries Rithmic raw response text');
  ok(caught && !JSON.stringify([caught.message, caught.rpRaw]).includes('SECRET-PW-123'), 'raw reason never contains the password');
}
// config: production gateways, Test for admins only, one app name
const cfgm = await imp('rithmic-config.js');
const mem = cfgm.activeGateways(false), adm = cfgm.activeGateways(true);
ok(cfgm.APP_NAME === 'ZoroCharts', 'app name is exactly "ZoroCharts"');
ok(mem.length === 12 && mem[0].uri === 'wss://rprotocol.rithmic.com:443' && mem.every((g) => !g.test && /^wss:\/\/rprotocol(-[a-z0-9]+)?\.rithmic\.com:443$/.test(g.uri)), 'members: 12 production gateways, Chicago first, no Test, no Colo75 (' + mem.length + ')');
ok(adm.length === 13 && adm.some((g) => g.test), 'admins additionally get Rithmic Test');
ok(cfgm.nearestGatewayId('Asia/Kolkata') === 'in' && cfgm.nearestGatewayId('Europe/Dublin') === 'ie' && cfgm.nearestGatewayId('Europe/Paris') === 'de' && cfgm.nearestGatewayId('America/Chicago') === 'chicago' && cfgm.nearestGatewayId('Antarctica/Troll') === null, 'nearest-by-timezone hints');
ok(cfgm.SYSTEM_FIRST.join('|') === 'Rithmic 01|Rithmic Paper Trading', 'system order head');
ok(!/['"]ZoroCharts['"]|STRK_Stryker|TradeZoro Charts/.test(fs.readFileSync(path.join(SRC, 'rithmic-client.js'), 'utf8') + fs.readFileSync(path.join(SRC, 'rithmic-ui.js'), 'utf8')), 'app name not repeated in client/ui');

const tally = {}; sent.filter((s) => s.tid !== T.HEARTBEAT).forEach((s) => { const k = s.plant + ' ' + s.tid + (s.request ? ' r' + s.request : ''); tally[k] = (tally[k] || 0) + 1; });
console.log('requests (all phases, no heartbeats):', JSON.stringify(tally));
console.log(`\n${n} checks passed`);
process.exit(0);
