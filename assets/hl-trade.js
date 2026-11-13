// TradeZoro — ZoroCharts: Hyperliquid trading from the member's OWN wallet (ES module). DARK: admins only (admins/{uid}), testnet,
// until the Owner signs off (Owner order 2026-11-08 "Vest and hyperliquid"). No public copy, no marketing, no result claims.
// NON-CUSTODIAL: connect an injected wallet (MetaMask / Rabby / Coinbase, EIP-1193) -> "Enable trading" = the wallet signs ONE
// approveAgent for a session key made in this browser (assets/hl-trade-core.js) -> that key signs orders here. The key lives in
// memory (or this device's IndexedDB if the member ticks "Remember on this device"; "Forget" deletes it). Agent keys cannot
// withdraw or transfer; this module never asks for any withdraw / transfer signature. Every request goes browser -> Hyperliquid.
// Lines on the chart: position entry, liquidation, open orders + TP/SL (drag to modify, x to cancel). A confirm sheet comes
// before EVERY order or modify. Client caps: CONFIG.maxNotionalUsd per order, CONFIG.maxOrdersPerMin.
// Geo: /api/hl-geo (Cloudflare's country / region) against CONFIG.blockedCountries / blockedRegions; unknown = blocked.
// Depends on: assets/hl-trade-core.js (lazy, only for admins), the Vela workspace (ws.cells, renderer layers), firebase compat
// (auth + db for the admin check), style.css tokens (--bg-*, --ink-*, --line*). Browser test: tools/tests/hl-trade-browser.js.
// Education only. Not financial advice.

export const LAYER = 'stk_hltrade';
const KEY_DB = 'stk-hl-trade', UI_KEY = 'stk.hltrade.ui';
let CORE = null, WS = null, C = null, panel = null, sheet = null, sock = null, limiter = null;
const S = { admin: false, geo: '', geoInfo: null, addr: '', chainId: '', agentKey: null, agentAddr: '', remember: false, enabled: false, meta: {}, mids: {}, ch: null, orders: [], fills: [], fees: null, lev: {}, msg: '', busy: false, builderOk: false,
  t: { side: 'buy', kind: 'market', unit: 'coin', size: '', px: '', trig: '', lev: '', cross: true, ro: false, brMode: 'price', tp: '', sl: '' } };
const net = () => C.NET[C.CONFIG.network];
const isMain = () => C.CONFIG.network === 'mainnet';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (m, type) => { try { if (window.showToast) window.showToast(type || 'success', m); } catch (e) {} };
const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');
const usd = (v, sign) => { if (!Number.isFinite(v)) return '—'; const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (v < 0 ? '-$' : sign && v > 0 ? '+$' : '$') + s; };
const num = (v, d = 6) => (Number.isFinite(v) ? (+v.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d }) : '—');
export function coinOf(symbol) {
  const m = /^hyperliquid:(.+)$/i.exec(String(symbol || '').trim());
  const c = m ? m[1].replace(/\.P$/i, '') : '';
  return /^[A-Za-z0-9]{1,16}$/.test(c) ? c : '';
}
const DISCLAIMER = 'Education only. Not financial advice.';
const CUSTODY = 'Orders go to Hyperliquid from your wallet. TradeZoro never holds your funds.';

// ---- install / mount -------------------------------------------------------------------------------------------------------
export function installHlTrade(Core) {
  CORE = Core;
  try { Core.registerRendererLayer({ id: LAYER, placement: 'above-data', create: layerFactory }); } catch (e) { console.warn('TradeZoro HL trade: layer', e); }
}
export function mountHlTrade(ws, opts) {
  WS = ws;
  const bar = opts && opts.bar;
  const go = (uid) => {
    const d = window.db || (window.firebase && firebase.firestore && firebase.firestore());
    if (!d || !uid) return;
    d.collection('admins').doc(uid).get().then((a) => { if (a.exists) { S.admin = true; addButton(bar); setInterval(pushLines, 2000); } }).catch(() => {});
  };
  try { firebase.auth().onAuthStateChanged((u) => { if (u && !S.admin) go(u.uid); }); } catch (e) {}
}
function addButton(bar) {
  if (!bar || document.getElementById('stkhl-btn')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'stkhl-btn'; b.className = 'stkc-btn'; b.title = 'Hyperliquid trading (admin beta, testnet)'; b.setAttribute('aria-label', 'Hyperliquid trading');
  b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M16 12.5h2M3 10h18"/></svg><span class="stkc-btn-l">Wallet</span>';
  b.onclick = () => openPanel();
  bar.insertBefore(b, bar.firstChild);
}
async function loadCore() {
  if (C) return C;
  C = await import('./hl-trade-core.js?v=964');
  limiter = C.makeLimiter();
  return C;
}
export async function openPanel() {
  await loadCore();
  if (!document.getElementById('stkhl-css')) { const st = document.createElement('style'); st.id = 'stkhl-css'; st.textContent = CSS; document.head.appendChild(st); }
  if (!panel) buildPanel();
  panel.hidden = false;
  document.getElementById('stkhl-btn')?.setAttribute('aria-expanded', 'true');
  if (!S.geoInfo) await checkGeo();
  if (!Object.keys(S.meta).length) loadMarket();
  render();
}
function closePanel() { if (panel) panel.hidden = true; document.getElementById('stkhl-btn')?.setAttribute('aria-expanded', 'false'); }

// ---- network ---------------------------------------------------------------------------------------------------------------
async function info(body) {
  const r = await fetch(net().api + '/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('info ' + r.status);
  return r.json();
}
const ALLOWED = new Set(['order', 'cancel', 'batchModify', 'updateLeverage']);   // agent-signed actions this panel may send. Nothing else.
async function exchange(action, counted) {
  if (!ALLOWED.has(action.type)) throw new Error('blocked action ' + action.type);
  if (!S.agentKey) throw new Error('Trading is not enabled on this device.');
  if (counted && !limiter.take()) return [{ ok: false, error: 'Slow down: more than ' + C.CONFIG.maxOrdersPerMin + ' orders in a minute from this panel.' }];
  const nonce = C.nextNonce();
  const signature = await C.signL1(action, nonce, S.agentKey, isMain());
  let j = null;
  try {
    const r = await fetch(net().api + '/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, nonce, signature, vaultAddress: null }) });
    j = await r.json().catch(() => null);
  } catch (e) { return [{ ok: false, error: 'Could not reach Hyperliquid. Check your connection; nothing was placed.' }]; }
  const res = C.parseExchange(j);
  if (res.some((x) => !x.ok && /not enabled for this wallet/.test(x.error))) { S.enabled = false; render(); }
  return res;
}
async function postUserSigned(action, signature) {
  const r = await fetch(net().api + '/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, nonce: action.nonce, signature, vaultAddress: null }) });
  return C.parseExchange(await r.json().catch(() => null))[0];
}
async function checkGeo() {
  try { const r = await fetch('/api/hl-geo', { cache: 'no-store' }); S.geoInfo = r.ok ? await r.json() : {}; } catch (e) { S.geoInfo = {}; }
  S.geo = C.geoBlock(S.geoInfo);
}
async function loadMarket() {
  try { const [m, mids] = await Promise.all([info({ type: 'meta' }), info({ type: 'allMids' })]); S.meta = C.parseMeta(m); Object.assign(S.mids, mids); render(); } catch (e) { S.msg = 'Could not load Hyperliquid markets. Try again in a moment.'; render(); }
}
async function loadAccount() {
  if (!S.addr) return;
  try {
    const [ch, oo, fills, fees] = await Promise.all([
      info({ type: 'clearinghouseState', user: S.addr }), info({ type: 'frontendOpenOrders', user: S.addr }),
      info({ type: 'userFills', user: S.addr }), info({ type: 'userFees', user: S.addr }).catch(() => null)]);
    S.ch = C.normState(ch); S.orders = C.normOrders(oo); S.fills = (fills || []).slice(0, 30);
    if (fees && fees.userCrossRate) S.fees = { taker: +fees.userCrossRate, maker: +fees.userAddRate };
    const b = C.CONFIG.builder;
    if (C.builderParam()) { const mx = await info({ type: 'maxBuilderFee', user: S.addr, builder: b.address.toLowerCase() }).catch(() => 0); S.builderOk = +mx >= b.feeTenthsBp; }
  } catch (e) { S.msg = 'Could not read the account from Hyperliquid.'; }
  render(); pushLines(true);
}
let refT = 0;
const refreshOrders = () => { clearTimeout(refT); refT = setTimeout(async () => { try { S.orders = C.normOrders(await info({ type: 'frontendOpenOrders', user: S.addr })); render(); pushLines(true); } catch (e) {} }, 250); };
function openSocket() {
  if (sock || !S.addr) return;
  let backoff = 1000, ping = 0;
  const connect = () => {
    const ws = new WebSocket(net().ws); sock = ws;
    ws.onopen = () => {
      backoff = 1000;
      for (const s of [{ type: 'allMids' }, { type: 'clearinghouseState', user: S.addr }, { type: 'openOrders', user: S.addr }, { type: 'userFills', user: S.addr }, { type: 'orderUpdates', user: S.addr }])
        ws.send(JSON.stringify({ method: 'subscribe', subscription: s }));
      ping = setInterval(() => { try { ws.send('{"method":"ping"}'); } catch (e) {} }, 50e3);
    };
    ws.onmessage = (m) => {
      let d; try { d = JSON.parse(m.data); } catch (e) { return; }
      if (d.channel === 'allMids' && d.data && d.data.mids) { Object.assign(S.mids, d.data.mids); renderLive(); }
      else if (d.channel === 'clearinghouseState' && d.data) { S.ch = C.normState(d.data.clearinghouseState); renderLive(); pushLines(); }
      else if (d.channel === 'userFills' && d.data) { if (!d.data.isSnapshot) { S.fills = (d.data.fills || []).concat(S.fills).slice(0, 30); for (const f of d.data.fills || []) toast('Filled: ' + (f.side === 'B' ? 'bought ' : 'sold ') + f.sz + ' ' + f.coin + ' at ' + f.px); } refreshOrders(); }
      else if (d.channel === 'orderUpdates' || d.channel === 'openOrders') refreshOrders();
    };
    ws.onclose = () => { clearInterval(ping); if (sock !== ws) return; sock = null; if (S.addr) setTimeout(() => { if (!sock && S.addr) connect(); }, backoff); backoff = Math.min(15e3, backoff * 2); };
  };
  connect();
}
function closeSocket() { const s = sock; sock = null; try { s && s.close(); } catch (e) {} }

// ---- wallet ----------------------------------------------------------------------------------------------------------------
async function connectWallet() {
  const eth = window.ethereum;
  if (!eth) { S.msg = 'No browser wallet found. Install MetaMask, Rabby or Coinbase Wallet, then reload.'; render(); return; }
  try {
    const accts = await eth.request({ method: 'eth_requestAccounts' });
    S.addr = String(accts[0] || '').toLowerCase(); S.chainId = await eth.request({ method: 'eth_chainId' });
    S.msg = '';
    if (eth.on && !eth.__stkhl) { eth.__stkhl = 1; eth.on('accountsChanged', (a) => { if (String(a[0] || '').toLowerCase() !== S.addr) disconnect(); }); eth.on('chainChanged', (c) => { S.chainId = c; }); }
    await restoreKey();
    openSocket(); await loadAccount();
  } catch (e) { S.msg = e && e.code === 4001 ? 'You declined in the wallet. Nothing was connected.' : 'The wallet did not connect.'; render(); }
}
function disconnect() { closeSocket(); Object.assign(S, { addr: '', agentKey: null, agentAddr: '', enabled: false, ch: null, orders: [], fills: [] }); render(); pushLines(true); }
async function enableTrading() {
  if (S.geo) return;
  const key = C.newAgentKey(), agentAddr = C.addressOf(key);
  const action = C.approveAgentAction(agentAddr, C.nextNonce(), isMain(), S.chainId || '0x1');
  S.busy = true; S.msg = 'Confirm in your wallet. It approves a trading key for this browser. It cannot withdraw.'; render();
  try {
    const typed = C.userSignedTyped(action);
    const sigHex = await window.ethereum.request({ method: 'eth_signTypedData_v4', params: [S.addr, JSON.stringify(typed)] });
    const res = await postUserSigned(action, C.splitSig(sigHex));
    if (!res.ok) { S.msg = res.error; return; }
    S.agentKey = key; S.agentAddr = agentAddr; S.enabled = true; S.msg = '';
    if (S.remember) await saveKey();
    toast('Trading enabled for this browser.');
  } catch (e) { S.msg = e && e.code === 4001 ? 'You declined in the wallet. Trading is not enabled.' : 'Could not enable trading: ' + ((e && e.message) || e); }
  finally { S.busy = false; render(); }
}
async function approveBuilder() {
  const b = C.CONFIG.builder; if (!C.builderParam() || !b.maxApprove) return;
  const action = C.approveBuilderFeeAction(b.address, b.maxApprove, C.nextNonce(), isMain(), S.chainId || '0x1');
  try {
    const sigHex = await window.ethereum.request({ method: 'eth_signTypedData_v4', params: [S.addr, JSON.stringify(C.userSignedTyped(action))] });
    const res = await postUserSigned(action, C.splitSig(sigHex));
    if (res.ok) { S.builderOk = true; toast('Builder fee approved.'); } else S.msg = res.error;
  } catch (e) { S.msg = 'Builder fee not approved.'; }
  render();
}
// key storage: IndexedDB, one record per wallet + network, only when the member asks
function idb() { return new Promise((ok, no) => { const r = indexedDB.open(KEY_DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('k'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }
const recId = () => C.CONFIG.network + ':' + S.addr;
async function saveKey() { try { const d = await idb(); d.transaction('k', 'readwrite').objectStore('k').put({ key: S.agentKey, agent: S.agentAddr }, recId()); } catch (e) {} }
async function restoreKey() {
  try {
    const d = await idb();
    const rec = await new Promise((ok) => { const q = d.transaction('k').objectStore('k').get(recId()); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); });
    if (rec && rec.key) { S.agentKey = rec.key; S.agentAddr = rec.agent; S.enabled = true; S.remember = true; }
  } catch (e) {}
}
async function forgetKey() { try { const d = await idb(); d.transaction('k', 'readwrite').objectStore('k').delete(recId()); } catch (e) {} S.agentKey = null; S.agentAddr = ''; S.enabled = false; S.remember = false; toast('Trading key removed from this browser.'); render(); }

// ---- ticket -> orders ------------------------------------------------------------------------------------------------------
function activeCoin() { try { return coinOf(WS.active.symbol || WS.chart.market.symbol); } catch (e) { return ''; } }
function curLev(coin) {
  const p = S.ch && S.ch.positions.find((x) => x.coin === coin);
  if (S.lev[coin]) return S.lev[coin];
  if (p) return { lev: p.lev, cross: p.cross };
  const m = S.meta[coin]; return { lev: Math.min(10, m ? m.maxLeverage : 10), cross: !(m && m.onlyIsolated) };
}
// -> { err } or { coin, m, isBuy, size, px, notional, lev, cross, wires[], grouping, tp, sl, fee, liq, changeLev }
export function buildTicket(t, ctx) {
  const { coin, m, mid, equity, fees, otherMaint, accountValue } = ctx;
  if (!m) return { err: 'Open a Hyperliquid perp chart to trade it here.' };
  if (!(mid > 0)) return { err: 'No price yet for ' + coin + '.' };
  const isBuy = t.side === 'buy';
  const lev = Math.max(1, Math.min(m.maxLeverage, Math.round(+t.lev || ctx.lev.lev || 1)));
  const cross = m.onlyIsolated ? false : !!t.cross;
  const px = t.kind === 'market' ? mid : t.kind === 'limit' ? C.roundPx(+t.px, m.szDecimals) : C.roundPx(+t.trig, m.szDecimals);
  if (!(px > 0)) return { err: t.kind === 'limit' ? 'Enter a limit price.' : t.kind === 'stop' ? 'Enter a stop price.' : 'No price.' };
  if (t.kind === 'stop' && (isBuy ? px <= mid : px >= mid)) return { err: isBuy ? 'A buy stop must be above the price.' : 'A sell stop must be below the price.' };
  const size = C.sizeFrom(t.unit, t.size, { px, equity, leverage: lev, szDecimals: m.szDecimals });
  if (!(size > 0)) return { err: 'Enter a size.' };
  const notional = size * px;
  const cap = C.checkOrder({ notional, reduceOnly: t.ro }); if (cap) return { err: cap };
  const tp = C.bracketPx(t.brMode, t.tp, px, isBuy, 'tp'), sl = C.bracketPx(t.brMode, t.sl, px, isBuy, 'sl');
  if (Number.isFinite(tp) && (isBuy ? tp <= px : tp >= px)) return { err: 'Take profit must be ' + (isBuy ? 'above' : 'below') + ' the entry.' };
  if (Number.isFinite(sl) && (isBuy ? sl >= px : sl <= px)) return { err: 'Stop loss must be ' + (isBuy ? 'below' : 'above') + ' the entry.' };
  const wires = [C.orderWire({ m, isBuy, sz: size, kind: t.kind, px, trigger: px, mid, reduceOnly: t.ro })];
  if (Number.isFinite(tp)) wires.push(C.orderWire({ m, isBuy: !isBuy, sz: size, kind: 'tp', trigger: tp }));
  if (Number.isFinite(sl)) wires.push(C.orderWire({ m, isBuy: !isBuy, sz: size, kind: 'sl', trigger: sl }));
  const fee = C.feeEst(notional, t.kind === 'limit', fees || C.DEFAULT_FEES);
  const liq = t.ro ? NaN : C.liqEst({ side: t.side, entry: px, size, leverage: lev, maxLeverage: m.maxLeverage, isCross: cross, accountValue, otherMaint });
  const changeLev = !t.ro && (lev !== ctx.lev.lev || cross !== ctx.lev.cross);
  return { coin, m, isBuy, size, px, notional, lev, cross, wires, grouping: wires.length > 1 ? 'normalTpsl' : 'na', tp, sl, fee, liq, changeLev, kind: t.kind, ro: t.ro, margin: notional / lev };
}
function ctxFor(coin) {
  const ch = S.ch || { equity: 0, maint: 0 };
  return { coin, m: S.meta[coin], mid: +S.mids[coin], equity: ch.equity, accountValue: ch.equity, otherMaint: ch.maint, fees: S.fees, lev: curLev(coin) };
}
async function review() {
  const coin = activeCoin(), o = buildTicket(S.t, ctxFor(coin));
  if (o.err) { S.msg = o.err; render(); return; }
  const kindTxt = { market: 'Market', limit: 'Limit', stop: 'Stop market' }[o.kind];
  const rows = [['Market', coin + '-USD perp'], ['Side', o.isBuy ? 'Buy / long' : 'Sell / short'], ['Type', kindTxt + (o.ro ? ', reduce-only' : '')], ['Size', num(o.size, o.m.szDecimals) + ' ' + coin + ' (' + usd(o.notional) + ')'],
    [o.kind === 'market' ? 'Est. price' : o.kind === 'limit' ? 'Limit price' : 'Stop price', num(o.px) + (o.kind === 'market' ? ' (fills within ' + C.CONFIG.slippage * 100 + '%)' : '')],
    ['Leverage', o.lev + 'x ' + (o.cross ? 'cross' : 'isolated') + (o.changeLev ? ' (will be set first)' : '')], ['Margin', usd(o.margin)],
    ['Est. fees', usd(o.fee.total) + (o.fee.builder ? ' (incl. builder ' + usd(o.fee.builder) + ')' : '')], ['Est. liquidation', Number.isFinite(o.liq) ? (o.liq > 0 ? num(o.liq) : 'none at this size') : '—']];
  if (Number.isFinite(o.tp)) rows.push(['Take profit', num(C.roundPx(o.tp, o.m.szDecimals))]);
  if (Number.isFinite(o.sl)) rows.push(['Stop loss', num(C.roundPx(o.sl, o.m.szDecimals))]);
  if (!(await confirmSheet((o.isBuy ? 'Buy ' : 'Sell ') + coin, rows, o.isBuy ? 'buy' : 'sell'))) return;
  if (o.changeLev) {
    const r = await exchange(C.leverageAction(o.m.asset, o.cross, o.lev), false);
    if (!r[0].ok) { toast(r[0].error, 'error'); return; }
    S.lev[coin] = { lev: o.lev, cross: o.cross };
  }
  const res = await exchange(C.orderAction(o.wires, o.grouping, S.builderOk ? C.builderParam() : null), true);
  report(res);
}
function report(res) {
  const bad = res.find((r) => !r.ok);
  if (bad) toast(bad.error, 'error');
  else { const f = res.find((r) => r.filled); toast(f ? 'Filled ' + f.filled.sz + ' at ' + f.filled.px : res.some((r) => r.resting || r.waiting) ? 'Order placed.' : 'Done.'); }
  loadAccount();
}
async function closePosition(coin, pct = 100) {
  const p = S.ch && S.ch.positions.find((x) => x.coin === coin); const m = S.meta[coin]; if (!p || !m) return;
  const sz = C.roundSz(Math.abs(p.size) * pct / 100, m.szDecimals), mid = +S.mids[coin];
  if (!(await confirmSheet('Close ' + coin, [['Market', coin + '-USD perp'], ['Side', p.side === 'buy' ? 'Sell (closes long)' : 'Buy (closes short)'], ['Size', num(sz, m.szDecimals) + ' ' + coin], ['Type', 'Market, reduce-only'], ['Est. price', num(mid)], ['Est. fees', usd(C.feeEst(sz * mid, false, S.fees || C.DEFAULT_FEES, S.builderOk ? C.builderParam() : null).total)]], 'sell'))) return;
  report(await exchange(C.orderAction([C.orderWire({ m, isBuy: p.side !== 'buy', sz, kind: 'market', mid, reduceOnly: true })], 'na', S.builderOk ? C.builderParam() : null), true));
}
async function cancel(list) {
  if (!list.length) return;
  const res = await exchange(C.cancelAction(list.map((o) => ({ asset: S.meta[o.coin].asset, oid: o.oid }))), false);
  const bad = res.find((r) => !r.ok); toast(bad ? bad.error : (list.length > 1 ? 'Cancelled ' + list.length + ' orders.' : 'Order cancelled.'), bad ? 'error' : 'success');
  loadAccount();
}
// a position TP/SL at price px (new, or moves the existing one)
async function setBracket(coin, which, px) {
  const p = S.ch && S.ch.positions.find((x) => x.coin === coin); const m = S.meta[coin]; if (!p || !m) return;
  const isBuy = p.side !== 'buy', trig = C.roundPx(px, m.szDecimals);
  if (which === 'tp' ? (p.side === 'buy' ? trig <= +S.mids[coin] : trig >= +S.mids[coin]) : (p.side === 'buy' ? trig >= +S.mids[coin] : trig <= +S.mids[coin])) { toast((which === 'tp' ? 'Take profit' : 'Stop loss') + ' would trigger at once at that price. Not placed.', 'error'); return; }
  const old = S.orders.find((o) => o.coin === coin && o.trigger != null && o.reduceOnly && o.tpsl === which);
  const wire = C.orderWire({ m, isBuy, sz: Math.abs(p.size), kind: which, trigger: trig });
  if (!(await confirmSheet((old ? 'Move ' : 'Set ') + (which === 'tp' ? 'take profit' : 'stop loss'), [['Market', coin + '-USD perp'], ['Trigger', num(trig)], ['Size', num(Math.abs(p.size), m.szDecimals) + ' ' + coin + ' (whole position)'], ['Type', 'Market when triggered, reduce-only'], ['Est. fees', usd(C.feeEst(Math.abs(p.size) * trig, false, S.fees || C.DEFAULT_FEES).total)]], 'buy'))) return;
  report(old ? await exchange(C.modifyAction(old.oid, wire), true) : await exchange(C.orderAction([wire], 'positionTpsl', S.builderOk ? C.builderParam() : null), true));
}
const breakeven = (coin) => { const p = S.ch && S.ch.positions.find((x) => x.coin === coin); if (p) setBracket(coin, 'sl', p.entry); };
async function moveOrder(o, px) {
  const m = S.meta[o.coin]; if (!m) return;
  const p = S.ch && S.ch.positions.find((x) => x.coin === o.coin);
  const sz = o.sz > 0 ? o.sz : p ? Math.abs(p.size) : 0;
  const kind = o.trigger == null ? 'limit' : o.reduceOnly ? (o.tpsl === 'tp' ? 'tp' : 'sl') : 'stop';
  const wire = C.orderWire({ m, isBuy: o.side === 'buy', sz, kind, px, trigger: px, reduceOnly: o.reduceOnly });
  if (!(await confirmSheet('Move order', [['Market', o.coin + '-USD perp'], ['Order', (o.side === 'buy' ? 'Buy ' : 'Sell ') + o.type], ['From', num(o.trigger != null ? o.trigger : o.px)], ['To', num(C.roundPx(px, m.szDecimals))], ['Size', num(sz, m.szDecimals) + ' ' + o.coin]], o.side))) { pushLines(true); return; }
  report(await exchange(C.modifyAction(o.oid, wire), true));
}

// ---- confirm sheet (every order / modify) ----------------------------------------------------------------------------------
function confirmSheet(title, rows, side) {
  return new Promise((done) => {
    if (!sheet) { sheet = document.createElement('div'); sheet.id = 'stkhl-cf'; sheet.className = 'stkhl-scrim'; document.body.appendChild(sheet); }
    sheet.innerHTML = '<div class="stkhl-dlg" role="dialog" aria-modal="true" aria-labelledby="stkhl-cf-t"><div class="stkhl-grab" aria-hidden="true"></div><div class="stkhl-hd"><h2 id="stkhl-cf-t">' + esc(title) + '</h2><button type="button" class="stkhl-ib" data-x aria-label="Cancel">' + IC_X + '</button></div>' +
      '<dl class="stkhl-kv">' + rows.map((r) => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl>' +
      '<p class="stkhl-note">' + CUSTODY + (isMain() ? '' : ' Testnet: test money only.') + '</p>' +
      '<div class="stkhl-acts"><button type="button" class="stkhl-btn stkhl-ghost" data-x>Cancel</button><button type="button" class="stkhl-btn stkhl-go ' + (side === 'sell' ? 'sell' : 'buy') + '" data-ok>Confirm</button></div></div>';
    sheet.hidden = false;
    const end = (v) => { sheet.hidden = true; document.removeEventListener('keydown', key, true); done(v); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); end(false); } };
    document.addEventListener('keydown', key, true);
    sheet.onclick = (e) => { if (e.target === sheet || e.target.closest('[data-x]')) end(false); else if (e.target.closest('[data-ok]')) end(true); };
    sheet.querySelector('[data-ok]').focus();
  });
}

// ---- panel -----------------------------------------------------------------------------------------------------------------
const IC_X = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
function buildPanel() {
  panel = document.createElement('aside'); panel.id = 'stkhl'; panel.className = 'stkhl'; panel.setAttribute('aria-label', 'Hyperliquid trading'); panel.hidden = true;
  panel.innerHTML = '<div class="stkhl-grab" aria-hidden="true"></div><div class="stkhl-hd"><div class="stkhl-ttl"><h2>Hyperliquid</h2><span class="stkhl-tag"></span></div><button type="button" class="stkhl-ib" data-a="close" aria-label="Close">' + IC_X + '</button></div><div class="stkhl-body"></div>' +
    '<p class="stkhl-foot">' + CUSTODY + ' ' + DISCLAIMER + '</p>';
  document.body.appendChild(panel);
  panel.addEventListener('click', onClick);
  panel.addEventListener('input', onInput);
  panel.addEventListener('change', onInput);
  for (const ev of ['keydown', 'keyup']) panel.addEventListener(ev, (e) => e.stopPropagation());
}
function onInput(e) {
  const f = e.target.dataset.f; if (!f) return;
  S.t[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (f === 'remember') { S.remember = e.target.checked; if (S.remember && S.agentKey) saveKey(); }
  if (e.type === 'change') renderSummary();
  else renderSummary();
}
function onClick(e) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, v = b.dataset.v;
  if (a === 'close') return closePanel();
  if (a === 'connect') return connectWallet();
  if (a === 'disconnect') return disconnect();
  if (a === 'enable') return enableTrading();
  if (a === 'builder') return approveBuilder();
  if (a === 'forget') return forgetKey();
  if (a === 'set') { S.t[b.dataset.k] = b.dataset.k === 'cross' ? v === '1' : v; S.msg = ''; return render(); }
  if (a === 'review') { S.msg = ''; return review(); }
  if (a === 'closepos') return closePosition(v);
  if (a === 'be') return breakeven(v);
  if (a === 'cancel') { const o = S.orders.find((x) => String(x.oid) === v); return o && cancel([o]); }
  if (a === 'cancelall') return S.orders.length && cancel(S.orders.slice());
}
function seg(k, opts) {
  return '<div class="stkhl-seg" role="group">' + opts.map(([v, l]) => '<button type="button" data-a="set" data-k="' + k + '" data-v="' + v + '" aria-pressed="' + (String(S.t[k] === true ? '1' : S.t[k] === false ? '0' : S.t[k]) === v) + '">' + l + '</button>').join('') + '</div>';
}
function render() {
  if (!panel || !C) return;
  panel.querySelector('.stkhl-tag').textContent = 'Admin beta · ' + (isMain() ? 'Mainnet' : 'Testnet');
  const body = panel.querySelector('.stkhl-body');
  const msg = S.msg ? '<p class="stkhl-msg" role="alert">' + esc(S.msg) + '</p>' : '';
  if (S.geo) {
    body.innerHTML = '<p class="stkhl-lead">Hyperliquid trading is not available in your region.</p><p class="stkhl-note">Hyperliquid\'s terms exclude some countries and regions' + (S.geo === 'unknown' ? ', and we could not tell where you are connecting from' : '') + '. Charts and market data still work.</p>';
    return;
  }
  if (!S.addr) {
    body.innerHTML = '<p class="stkhl-lead">Trade Hyperliquid perps from your own wallet, right on the chart.</p><ul class="stkhl-pts"><li>Your funds stay in your Hyperliquid account. TradeZoro never holds them.</li><li>One wallet signature lets this browser place and cancel orders. It cannot withdraw.</li><li>Every order is shown to you before it is sent.</li></ul>' + msg +
      '<button type="button" class="stkhl-btn stkhl-pri" data-a="connect">Connect wallet</button>';
    return;
  }
  const head = '<div class="stkhl-who"><span class="stkhl-dot' + (sock && sock.readyState === 1 ? ' on' : '') + '" aria-hidden="true"></span><code>' + short(S.addr) + '</code><button type="button" class="stkhl-txt" data-a="disconnect">Disconnect</button></div>';
  if (!S.enabled) {
    const fund = S.ch && S.ch.equity === 0 ? '<p class="stkhl-note">This wallet has no funds on Hyperliquid' + (isMain() ? '' : ' testnet') + '. <a href="' + net().app + '/portfolio" target="_blank" rel="noopener">Deposit on Hyperliquid</a> first.</p>' : '';
    body.innerHTML = head + acctHtml() + '<p class="stkhl-lead">Enable trading on this browser</p><p class="stkhl-note">Your wallet signs once to approve a trading key made here. The key can place and cancel orders only. It cannot withdraw or move funds.</p>' + fund + msg +
      '<label class="stkhl-chk"><input type="checkbox" data-f="remember"' + (S.remember ? ' checked' : '') + '> Remember on this device</label>' +
      '<button type="button" class="stkhl-btn stkhl-pri" data-a="enable"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Waiting for wallet…' : 'Enable trading') + '</button>';
    return;
  }
  const coin = activeCoin(), m = S.meta[coin], t = S.t;
  const ticket = !m ? '<p class="stkhl-note">Open a Hyperliquid perp chart (for example hyperliquid:BTC) to trade it here.</p>' :
    '<div class="stkhl-tk"><div class="stkhl-tkh"><b>' + esc(coin) + '-USD</b><span class="stkhl-mid" data-live="mid">' + num(+S.mids[coin]) + '</span></div>' +
    '<div class="stkhl-sides" role="group"><button type="button" class="buy" data-a="set" data-k="side" data-v="buy" aria-pressed="' + (t.side === 'buy') + '">Buy / Long</button><button type="button" class="sell" data-a="set" data-k="side" data-v="sell" aria-pressed="' + (t.side === 'sell') + '">Sell / Short</button></div>' +
    seg('kind', [['market', 'Market'], ['limit', 'Limit'], ['stop', 'Stop']]) +
    (t.kind === 'limit' ? fld('Limit price', 'px', num(+S.mids[coin])) : t.kind === 'stop' ? fld('Stop price', 'trig', '') : '') +
    '<div class="stkhl-f"><label for="stkhl-size">Size</label><div class="stkhl-row"><input id="stkhl-size" data-f="size" inputmode="decimal" autocomplete="off" value="' + esc(t.size) + '" placeholder="0">' + seg('unit', [['coin', esc(coin)], ['usd', 'USD'], ['pct', '%']]) + '</div></div>' +
    '<div class="stkhl-f"><label for="stkhl-lev">Leverage (max ' + m.maxLeverage + 'x)</label><div class="stkhl-row"><input id="stkhl-lev" data-f="lev" inputmode="numeric" value="' + esc(t.lev || curLev(coin).lev) + '">' + (m.onlyIsolated ? '<span class="stkhl-note">Isolated only</span>' : seg('cross', [['1', 'Cross'], ['0', 'Isolated']])) + '</div></div>' +
    '<div class="stkhl-f"><span class="stkhl-lbl">Take profit / stop loss</span>' + seg('brMode', [['price', 'Price'], ['pts', 'Points'], ['pct', '%']]) + '<div class="stkhl-row2"><input data-f="tp" inputmode="decimal" aria-label="Take profit" placeholder="Take profit" value="' + esc(t.tp) + '"><input data-f="sl" inputmode="decimal" aria-label="Stop loss" placeholder="Stop loss" value="' + esc(t.sl) + '"></div></div>' +
    '<label class="stkhl-chk"><input type="checkbox" data-f="ro"' + (t.ro ? ' checked' : '') + '> Reduce-only</label>' +
    '<p class="stkhl-sum" data-live="sum"></p>' + msg +
    '<button type="button" class="stkhl-btn stkhl-go ' + t.side + '" data-a="review">Review ' + (t.side === 'buy' ? 'buy' : 'sell') + '</button></div>';
  const builder = C.builderParam() && !S.builderOk && C.CONFIG.builder.maxApprove ? '<button type="button" class="stkhl-btn stkhl-ghost" data-a="builder">Approve builder fee (max ' + esc(C.CONFIG.builder.maxApprove) + ')</button>' : '';
  body.innerHTML = head + acctHtml() + ticket + posHtml() + ordHtml() + fillsHtml() + builder +
    '<div class="stkhl-links"><a href="' + net().app + '/portfolio" target="_blank" rel="noopener">Deposit or withdraw on Hyperliquid</a><button type="button" class="stkhl-txt" data-a="forget">Forget trading key</button></div>';
  renderSummary();
}
const fld = (label, f, ph) => '<div class="stkhl-f"><label for="stkhl-' + f + '">' + label + '</label><input id="stkhl-' + f + '" data-f="' + f + '" inputmode="decimal" autocomplete="off" placeholder="' + esc(ph) + '" value="' + esc(S.t[f]) + '"></div>';
function acctHtml() {
  const a = S.ch; if (!a) return '';
  return '<div class="stkhl-stats"><div><span>Equity</span><b data-live="eq">' + usd(a.equity) + '</b></div><div><span>Margin used</span><b data-live="mu">' + usd(a.marginUsed) + '</b></div><div><span>Withdrawable</span><b data-live="wd">' + usd(a.withdrawable) + '</b></div></div>';
}
function posHtml() {
  const ps = (S.ch && S.ch.positions) || [];
  return '<h3 class="stkhl-h">Positions</h3>' + (ps.length ? ps.map((p) => '<div class="stkhl-item"><div class="stkhl-l"><b class="' + (p.side === 'buy' ? 'up' : 'dn') + '">' + (p.side === 'buy' ? 'Long ' : 'Short ') + num(Math.abs(p.size)) + ' ' + esc(p.coin) + '</b><span>Entry ' + num(p.entry) + ' · Liq ' + (p.liq ? num(p.liq) : '—') + ' · ' + p.lev + 'x ' + (p.cross ? 'cross' : 'isolated') + '</span></div><b class="stkhl-pnl ' + (p.upnl >= 0 ? 'up' : 'dn') + '">' + usd(p.upnl, true) + '</b>' +
    '<div class="stkhl-btns"><button type="button" class="stkhl-btn stkhl-sm" data-a="be" data-v="' + esc(p.coin) + '">Breakeven</button><button type="button" class="stkhl-btn stkhl-sm" data-a="closepos" data-v="' + esc(p.coin) + '">Close</button></div></div>').join('') : '<p class="stkhl-empty">No open positions.</p>');
}
function ordHtml() {
  const os = S.orders;
  return '<div class="stkhl-hrow"><h3 class="stkhl-h">Open orders</h3>' + (os.length > 1 ? '<button type="button" class="stkhl-txt" data-a="cancelall">Cancel all</button>' : '') + '</div>' + (os.length ? os.map((o) => '<div class="stkhl-item"><div class="stkhl-l"><b class="' + (o.side === 'buy' ? 'up' : 'dn') + '">' + (o.side === 'buy' ? 'Buy ' : 'Sell ') + esc(o.coin) + ' · ' + esc(o.type) + '</b><span>' + (o.sz > 0 ? num(o.sz) : 'Whole position') + ' at ' + num(o.trigger != null ? o.trigger : o.px) + (o.reduceOnly ? ' · reduce-only' : '') + '</span></div><button type="button" class="stkhl-btn stkhl-sm" data-a="cancel" data-v="' + o.oid + '">Cancel</button></div>').join('') : '<p class="stkhl-empty">No open orders.</p>');
}
function fillsHtml() {
  const fs = S.fills.slice(0, 8);
  return '<h3 class="stkhl-h">Recent fills</h3>' + (fs.length ? fs.map((f) => '<div class="stkhl-item stkhl-fill"><div class="stkhl-l"><b>' + esc(f.dir || (f.side === 'B' ? 'Buy' : 'Sell')) + ' ' + esc(f.sz) + ' ' + esc(f.coin) + '</b><span>' + esc(f.px) + ' · fee ' + esc(f.fee) + ' ' + esc(f.feeToken || '') + ' · ' + new Date(f.time).toLocaleTimeString() + '</span></div></div>').join('') : '<p class="stkhl-empty">No fills yet.</p>');
}
function renderSummary() {
  const el = panel && panel.querySelector('[data-live="sum"]'); if (!el) return;
  const coin = activeCoin(); const o = buildTicket(S.t, ctxFor(coin));
  el.textContent = o.err ? '' : num(o.size, o.m.szDecimals) + ' ' + coin + ' ≈ ' + usd(o.notional) + ' · margin ' + usd(o.margin) + ' · fees ≈ ' + usd(o.fee.total) + (Number.isFinite(o.liq) && o.liq > 0 ? ' · liq ≈ ' + num(o.liq) : '');
}
function renderLive() {
  if (!panel || panel.hidden) return;
  const set = (k, v) => { const e = panel.querySelector('[data-live="' + k + '"]'); if (e && e.textContent !== v) e.textContent = v; };
  const coin = activeCoin(); if (coin) set('mid', num(+S.mids[coin]));
  if (S.ch) { set('eq', usd(S.ch.equity)); set('mu', usd(S.ch.marginUsed)); set('wd', usd(S.ch.withdrawable)); }
  const now = Date.now(); if (now - (renderLive.t || 0) > 3000) { renderLive.t = now; const f = document.activeElement; if (!f || !panel.contains(f) || f.tagName !== 'INPUT') { const y = panel.querySelector('.stkhl-body').scrollTop; render(); panel.querySelector('.stkhl-body').scrollTop = y; } }
}

// ---- chart lines -----------------------------------------------------------------------------------------------------------
const COL = { buy: '#03c988', sell: '#f23645', liq: '#f7a600', tp: '#03c988', sl: '#f23645', ord: '#00adb5' };
export function linesFor(coin, st = S) {
  if (!coin || !st.addr) return [];
  const out = [];
  const p = st.ch && st.ch.positions.find((x) => x.coin === coin);
  if (p) {
    out.push({ id: 'pos', kind: 'pos', price: p.entry, color: p.side === 'buy' ? COL.buy : COL.sell, a: (p.side === 'buy' ? 'LONG ' : 'SHORT ') + num(Math.abs(p.size)), b: usd(p.upnl, true), neg: p.upnl < 0 });
    if (p.liq) out.push({ id: 'liq', kind: 'liq', price: p.liq, color: COL.liq, a: 'LIQ', b: num(p.liq) });
  }
  for (const o of st.orders) {
    if (o.coin !== coin) continue;
    const px = o.trigger != null ? o.trigger : o.px;
    const k = o.trigger != null && o.reduceOnly ? o.tpsl : 'ord';
    out.push({ id: 'o' + o.oid, kind: k, oid: o.oid, price: px, color: k === 'tp' ? COL.tp : k === 'sl' ? COL.sl : COL.ord, a: k === 'tp' ? 'TP' : k === 'sl' ? 'SL' : (o.side === 'buy' ? 'BUY ' : 'SELL ') + (o.trigger != null ? 'STP ' : 'LMT ') + num(o.sz), b: num(px) });
  }
  return out;
}
const inner = (cell) => { try { return cell.chart.renderer.renderer; } catch (e) { return null; } };
const cells = () => { try { return (WS.context().cells || []).map((c) => WS.cell(c.id)).filter(Boolean); } catch (e) { return []; } };
const layerInst = (R) => { try { const l = R.extLayers.find((x) => x.def.id === LAYER); return l && l.instance; } catch (e) { return null; } };
const drag = { on: false };
const sigs = new WeakMap();
function pushLines(force) {
  if (!WS) return;
  for (const cell of cells()) {
    const R = inner(cell); if (!R || !R.setNativeData) continue;
    const inst = layerInst(R); if (!inst) continue;
    const lines = S.admin ? linesFor(coinOf(cell.symbol)) : [];
    if (drag.on && drag.cell === cell) for (const l of lines) if (l.id === drag.id) { l.price = drag.price; l.b = num(drag.price); }
    syncChips(cell, inst, lines);
    const sig = JSON.stringify(lines.map((l) => [l.id, l.price, l.color]));
    if (!force && sigs.get(R) === sig) continue;
    sigs.set(R, sig);
    try { R.setNativeData(LAYER, { lines }); } catch (e) {}
  }
}
function layerFactory() {
  let canvas = null, overlay = null, last = null, ys = {};
  const inst = {
    get overlay() { return overlay; }, get args() { return last; },
    mount(c) { canvas = c; overlay = document.createElement('div'); overlay.className = 'stkhl-ov'; (c.parentElement || c).appendChild(overlay); },
    render(a) {
      if (!canvas) return;
      last = a;
      const co = a.coords, dpr = co.dpr || 1, W = co.width, g = canvas.getContext('2d');
      const lines = (a.data && a.data.lines) || [];
      if (!lines.length && !Object.keys(ys).length) return;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const top = a.bounds.top, bot = top + a.bounds.height; ys = {};
      for (const l of lines) {
        const y = Math.round(co.priceToY(l.price, a.scale, a.bounds)) + 0.5; ys[l.id] = y;
        if (y < top || y > bot) continue;
        g.strokeStyle = l.color; g.lineWidth = 1; g.setLineDash(l.kind === 'pos' ? [] : l.kind === 'liq' ? [2, 3] : [6, 3]);
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      }
      g.setLineDash([]);
      if (overlay) for (const chip of overlay.querySelectorAll('.stkhl-chip')) {
        const y = ys[chip.dataset.id];
        if (y == null || y < top || y > bot) { chip.style.visibility = 'hidden'; continue; }
        chip.style.visibility = ''; chip.style.transform = 'translate3d(0,' + Math.round(y - 11) + 'px,0)'; chip.style.right = Math.round(canvas.width / dpr - W + 140) + 'px';
      }
    },
    destroy() { if (overlay) overlay.remove(); canvas = null; overlay = null; },
  };
  return inst;
}
function syncChips(cell, inst, lines) {
  const ov = inst.overlay; if (!ov) return;
  const have = new Map([...ov.querySelectorAll('.stkhl-chip')].map((c) => [c.dataset.id, c]));
  for (const l of lines) {
    let chip = have.get(l.id);
    if (!chip) {
      chip = document.createElement('div'); chip.className = 'stkhl-chip'; chip.dataset.id = l.id;
      chip.innerHTML = '<span class="a"></span><span class="b"></span>' + (l.kind === 'liq' ? '' : '<button type="button" class="x" aria-label="' + (l.kind === 'pos' ? 'Close position' : 'Cancel order') + '">×</button>');
      const x = chip.querySelector('.x');
      if (x) { x.addEventListener('pointerdown', (e) => e.stopPropagation()); x.addEventListener('click', (e) => { e.stopPropagation(); onChipX(cell, chip.dataset.id); }); }
      if (l.kind !== 'liq') chip.addEventListener('pointerdown', (e) => onChipDown(e, cell, inst, chip));
      ov.appendChild(chip);
    }
    have.delete(l.id);
    chip.dataset.kind = l.kind; chip.style.setProperty('--c', l.color); chip.classList.toggle('neg', !!l.neg);
    chip.title = l.kind === 'pos' ? 'Drag up or down to set a take profit or stop loss' : l.kind === 'liq' ? 'Liquidation price (from Hyperliquid)' : 'Drag to move · × to cancel';
    const A = chip.querySelector('.a'), B = chip.querySelector('.b');
    if (A.textContent !== l.a) A.textContent = l.a;
    if (B.textContent !== l.b) B.textContent = l.b;
  }
  for (const [, c] of have) c.remove();
}
function onChipX(cell, id) {
  const coin = coinOf(cell.symbol);
  if (id === 'pos') return closePosition(coin);
  const o = S.orders.find((x) => 'o' + x.oid === id); if (o) cancel([o]);
}
function onChipDown(e, cell, inst, chip) {
  if (e.button != null && e.button !== 0) return;
  const a = inst.args; if (!a) return;
  e.preventDefault(); e.stopPropagation();
  const id = chip.dataset.id, coin = coinOf(cell.symbol), m = S.meta[coin]; if (!m) return;
  const R = inner(cell), rect = ((R && R.input && R.input.el) || inst.overlay).getBoundingClientRect();
  const l = linesFor(coin).find((x) => x.id === id); if (!l) return;
  Object.assign(drag, { on: true, cell, id, price: l.price, moved: false, y0: e.clientY });
  try { chip.setPointerCapture(e.pointerId); } catch (e2) {}
  const move = (ev) => {
    if (!drag.moved && Math.abs(ev.clientY - drag.y0) < 3) return;
    drag.moved = true;
    const A = inst.args || a;
    drag.price = C.roundPx(A.coords.yToPrice(ev.clientY - rect.top, A.scale, A.bounds), m.szDecimals);
    pushLines();
  };
  const up = () => {
    chip.removeEventListener('pointermove', move); chip.removeEventListener('pointerup', up); chip.removeEventListener('pointercancel', up);
    const d = Object.assign({}, drag); drag.on = false;
    if (!d.moved) { pushLines(true); return; }
    if (id === 'pos') { const p = S.ch.positions.find((x) => x.coin === coin); const inProfit = (d.price - p.entry) * (p.side === 'buy' ? 1 : -1) > 0; setBracket(coin, inProfit ? 'tp' : 'sl', d.price).then(() => pushLines(true)); return; }
    const o = S.orders.find((x) => 'o' + x.oid === id); if (o) moveOrder(o, d.price).then(() => pushLines(true));
  };
  chip.addEventListener('pointermove', move); chip.addEventListener('pointerup', up); chip.addEventListener('pointercancel', up);
}

// test hook (tools/tests/hl-trade-browser.js), only on the test harness: never puts the agent key on window in production
if (window.__stkChartTestFree) window.__stkHlTrade = { S, openPanel, pushLines, buildTicket, get core() { return C; } };

const CSS = `
.stkhl{ --hl-up:#03c988; --hl-dn:#f23645; position:fixed; z-index:8020; top:72px; right:16px; bottom:16px; width:360px; display:flex; flex-direction:column; background:var(--bg-1, #0b0b0d); color:var(--ink-0);
  border:1px solid var(--line-soft, rgba(255,255,255,.08)); border-radius:16px; box-shadow:0 16px 48px rgba(0,0,0,.45);
  font:400 14px/20px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; font-variant-numeric:tabular-nums; }
:root[data-theme="light"] .stkhl, :root[data-theme="light"] .stkhl-dlg{ --hl-up:#047857; --hl-dn:#c81e2e; background:#fff; box-shadow:0 16px 48px rgba(0,0,0,.18); }
.stkhl[hidden], .stkhl-scrim[hidden]{ display:none; }
.stkhl-grab{ display:none; }
.stkhl-hd{ flex:none; display:flex; align-items:center; gap:8px; min-height:56px; padding:4px 4px 4px 16px; border-bottom:1px solid var(--line-soft); }
.stkhl-ttl{ flex:1; min-width:0; display:flex; align-items:center; gap:8px; }
.stkhl-hd h2{ margin:0; font-size:17px; line-height:22px; font-weight:600; }
.stkhl-tag{ font-size:11px; line-height:13px; padding:4px 8px; border-radius:999px; color:#b26b00; background:rgba(247,166,0,.14); white-space:nowrap; }
:root:not([data-theme="light"]) .stkhl-tag{ color:#f7a600; }
.stkhl-ib{ flex:none; display:inline-flex; align-items:center; justify-content:center; width:44px; height:44px; border:0; border-radius:50%; background:transparent; color:var(--ink-1, var(--ink-0)); cursor:pointer; }
.stkhl-ib:hover{ background:var(--bg-2); }
.stkhl-body{ flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:16px; display:flex; flex-direction:column; gap:16px; }
.stkhl-body > *{ margin:0; }
.stkhl-foot{ flex:none; margin:0; padding:8px 16px; border-top:1px solid var(--line-soft); font-size:12px; line-height:16px; color:var(--ink-2); }
.stkhl-lead{ font-size:15px; line-height:22px; font-weight:600; }
.stkhl-note, .stkhl-empty{ font-size:13px; line-height:18px; color:var(--ink-2); }
.stkhl-note a, .stkhl-links a{ color:var(--teal, #00adb5); }
.stkhl-pts{ padding:0 0 0 20px; display:flex; flex-direction:column; gap:8px; color:var(--ink-1, var(--ink-0)); font-size:14px; line-height:20px; }
.stkhl-msg{ padding:8px 12px; border-radius:12px; background:rgba(242,54,69,.12); color:var(--ink-0); font-size:13px; line-height:18px; }
.stkhl-btn{ display:inline-flex; align-items:center; justify-content:center; min-height:48px; padding:0 16px; border-radius:12px; border:1px solid var(--line); background:transparent; color:var(--ink-0); font:600 15px/20px inherit; font-family:inherit; cursor:pointer; }
.stkhl-btn:disabled{ opacity:.5; cursor:default; }
.stkhl-pri{ background:#03c988; border-color:#03c988; color:#04140d; }
.stkhl-pri:hover{ background:#4fe3ac; }
.stkhl-ghost{ min-height:40px; }
.stkhl-sm{ min-height:32px; padding:0 12px; font-size:13px; border-radius:8px; }
.stkhl-go{ width:100%; border:0; color:#fff; }
.stkhl-go.buy{ background:#03c988; color:#04140d; } .stkhl-go.sell{ background:#f23645; }
.stkhl-txt{ border:0; background:none; color:var(--teal, #00adb5); font:500 13px/18px inherit; font-family:inherit; cursor:pointer; padding:12px 4px; min-height:44px; }
.stkhl-btn:focus-visible, .stkhl-ib:focus-visible, .stkhl-txt:focus-visible, .stkhl-seg button:focus-visible, .stkhl-sides button:focus-visible, .stkhl input:focus-visible{ outline:2px solid #03c988; outline-offset:2px; }
.stkhl-who{ display:flex; align-items:center; gap:8px; }
.stkhl-who code{ flex:1; font:400 13px/18px ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--ink-1, var(--ink-0)); }
.stkhl-dot{ width:8px; height:8px; border-radius:50%; background:var(--ink-3, #666); }
.stkhl-dot.on{ background:#03c988; }
.stkhl-stats{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
.stkhl-stats div{ display:flex; flex-direction:column; gap:2px; padding:8px 12px; border:1px solid var(--line-soft); border-radius:12px; min-width:0; }
.stkhl-stats span{ font-size:11px; line-height:13px; color:var(--ink-2); }
.stkhl-stats b{ font-size:14px; line-height:20px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stkhl-tk{ display:flex; flex-direction:column; gap:12px; padding:16px; border:1px solid var(--line-soft); border-radius:16px; }
.stkhl-tkh{ display:flex; justify-content:space-between; align-items:baseline; font-size:15px; line-height:22px; }
.stkhl-mid{ font-size:13px; color:var(--ink-2); }
.stkhl-sides{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.stkhl-sides button{ min-height:44px; border-radius:12px; border:1px solid var(--line); background:transparent; color:var(--ink-1, var(--ink-0)); font:600 14px/20px inherit; font-family:inherit; cursor:pointer; }
.stkhl-sides .buy[aria-pressed="true"]{ background:#03c988; border-color:#03c988; color:#04140d; }
.stkhl-sides .sell[aria-pressed="true"]{ background:#f23645; border-color:#f23645; color:#fff; }
.stkhl-seg{ display:flex; padding:2px; border-radius:8px; background:var(--bg-2); min-width:0; }
.stkhl-seg button{ flex:1; min-width:0; min-height:32px; padding:0 8px; border:0; border-radius:6px; background:none; color:var(--ink-2); font:500 13px/18px inherit; font-family:inherit; cursor:pointer; white-space:nowrap; }
.stkhl-seg button[aria-pressed="true"]{ background:var(--bg-0); color:var(--ink-0); box-shadow:0 0 0 1px var(--line-soft); }
.stkhl-f{ display:flex; flex-direction:column; gap:8px; }
.stkhl-f label, .stkhl-lbl{ font-size:13px; line-height:18px; font-weight:500; color:var(--ink-1, var(--ink-0)); }
.stkhl-row{ display:flex; gap:8px; align-items:center; } .stkhl-row input{ flex:1; min-width:0; } .stkhl-row .stkhl-seg{ flex:none; }
.stkhl-row2{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.stkhl input:not([type=checkbox]){ width:100%; min-width:0; height:44px; padding:0 12px; border-radius:8px; border:1px solid var(--line); background:var(--bg-0); color:var(--ink-0); font:400 16px/22px inherit; font-family:inherit; font-variant-numeric:tabular-nums; box-sizing:border-box; }
.stkhl-chk{ display:flex; align-items:center; gap:8px; min-height:44px; font-size:14px; cursor:pointer; }
.stkhl-chk input{ width:20px; height:20px; margin:0; accent-color:#03c988; }
.stkhl-sum{ font-size:12px; line-height:16px; color:var(--ink-2); min-height:16px; }
.stkhl-h{ margin:0; font-size:13px; line-height:18px; font-weight:600; }
.stkhl-hrow{ display:flex; align-items:center; justify-content:space-between; margin:0 0 -16px; }
.stkhl-item{ display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; padding:8px 0; border-bottom:1px solid var(--line-soft); margin-top:-8px; }
.stkhl-l{ display:flex; flex-direction:column; gap:2px; min-width:0; }
.stkhl-l b{ font-size:14px; line-height:20px; font-weight:600; } .stkhl-l span{ font-size:12px; line-height:16px; color:var(--ink-2); }
.stkhl .up{ color:var(--hl-up); } .stkhl .dn{ color:var(--hl-dn); }
.stkhl-pnl{ font-size:14px; font-weight:600; }
.stkhl-btns{ grid-column:1/-1; display:flex; gap:8px; }
.stkhl-links{ display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; font-size:13px; }
.stkhl-scrim{ position:fixed; inset:0; z-index:9100; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; padding:16px; }
.stkhl-dlg{ --hl-up:#03c988; width:min(400px,100%); max-height:calc(100dvh - 32px); overflow:auto; background:var(--bg-1, #0b0b0d); color:var(--ink-0); border:1px solid var(--line-soft); border-radius:16px;
  font:400 14px/20px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; font-variant-numeric:tabular-nums; }
.stkhl-dlg .stkhl-hd h2{ flex:1; }
.stkhl-kv{ display:grid; grid-template-columns:auto minmax(0,1fr); gap:8px 16px; margin:0; padding:16px; }
.stkhl-kv dt{ color:var(--ink-2); font-size:13px; } .stkhl-kv dd{ margin:0; text-align:right; font-weight:500; overflow-wrap:anywhere; }
.stkhl-dlg .stkhl-note{ margin:0; padding:0 16px; }
.stkhl-acts{ display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:16px; }
.stkhl-acts .stkhl-btn{ min-height:48px; }
.stkhl-ov{ position:absolute; inset:0; pointer-events:none; overflow:hidden; z-index:5; }
.stkhl-chip{ position:absolute; top:0; right:140px; height:22px; display:flex; align-items:stretch; pointer-events:auto; cursor:ns-resize; user-select:none; touch-action:none; border:1px solid var(--c); border-radius:4px; overflow:hidden;
  background:#131316; color:rgba(255,255,255,.92); font:600 11px/20px -apple-system,BlinkMacSystemFont,Roboto,sans-serif; font-variant-numeric:tabular-nums; will-change:transform; }
:root[data-theme="light"] .stkhl-chip{ background:#fff; color:#1d1d1f; }
.stkhl-chip .a{ background:var(--c); color:#fff; padding:0 8px; white-space:nowrap; }
.stkhl-chip .b{ padding:0 8px; white-space:nowrap; font-weight:500; }
.stkhl-chip[data-kind="liq"]{ cursor:default; border-style:dashed; } .stkhl-chip[data-kind="liq"] .a{ color:#1d1d1f; }
.stkhl-chip[data-kind="pos"] .b{ color:#03c988; } .stkhl-chip[data-kind="pos"].neg .b{ color:#f23645; }
.stkhl-chip .x{ border:0; border-left:1px solid var(--c); background:none; color:inherit; width:24px; padding:0; cursor:pointer; font-size:14px; }
.stkhl-chip .x:hover{ background:var(--c); color:#fff; }
.stkhl-body, .stkhl-dlg{ scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.18) transparent; }
:root[data-theme="light"] .stkhl-body, :root[data-theme="light"] .stkhl-dlg{ scrollbar-color:rgba(0,0,0,.2) transparent; }
.stkhl-body::-webkit-scrollbar, .stkhl-dlg::-webkit-scrollbar{ width:8px; } .stkhl-body::-webkit-scrollbar-button, .stkhl-dlg::-webkit-scrollbar-button{ display:none; }
.stkhl-body::-webkit-scrollbar-thumb, .stkhl-dlg::-webkit-scrollbar-thumb{ background:rgba(127,127,127,.35); border-radius:999px; border:2px solid transparent; background-clip:padding-box; }
@media (prefers-reduced-motion:no-preference){ .stkhl-btn, .stkhl-seg button, .stkhl-sides button{ transition:background-color .15s cubic-bezier(.2,0,0,1), color .15s cubic-bezier(.2,0,0,1); } }
@media (max-width:700px){
  .stkhl{ top:auto; left:0; right:0; bottom:var(--stkc-dock, 0px); width:auto; height:min(85dvh, 760px); border-radius:24px 24px 0 0; border-bottom:0; }
  .stkhl-grab{ display:block; flex:none; width:36px; height:4px; border-radius:2px; margin:8px auto 0; background:var(--line, rgba(255,255,255,.2)); }
  .stkhl-hd .stkhl-ib{ background:var(--bg-2); width:36px; height:36px; margin:4px 8px; }
  .stkhl-scrim{ align-items:flex-end; padding:0; }
  .stkhl-dlg{ width:100%; border-radius:24px 24px 0 0; padding-bottom:env(safe-area-inset-bottom); }
  .stkhl-dlg .stkhl-grab{ display:block; }
  .stkhl-foot{ padding-bottom:calc(8px + env(safe-area-inset-bottom)); }
}
`;
