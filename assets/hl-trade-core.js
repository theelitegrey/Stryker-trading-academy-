// TradeZoro — Hyperliquid trading core (ES module, pure + signing). ADMIN-ONLY while dark (Owner order 2026-11-08 "Vest and hyperliquid").
// NON-CUSTODIAL. The member's own wallet signs ONE approval (approveAgent: a session key made in this browser may place and
// cancel orders for the account). The session key ("agent wallet") then signs orders here in the browser. Agent wallets
// cannot withdraw or transfer, and this file never builds a withdraw / transfer / send action. Our servers never see the
// keys, the signatures or the funds: every request goes browser -> api.hyperliquid(-testnet).xyz directly (CORS: allowed, checked 2026-11-08).
// Signing follows the official Python SDK (hyperliquid-python-sdk 0.24 utils/signing.py): L1 actions = msgpack(action) + nonce
// + vault flag -> keccak -> EIP-712 "Agent{source,connectionId}" on domain Exchange/1/1337; user-signed actions (approveAgent,
// approveBuilderFee) = EIP-712 on domain HyperliquidSignTransaction. Unit tests: tools/tests/hl-trade-core.test.mjs compare
// every hash and signature with the SDK's own output (tools/fixtures/hl-trade/vectors.json).
// Depends on: assets/vendor/noble-1 (secp256k1 3.2.0 + keccak from noble-hashes 2.0.1, MIT, unmodified).
// Education only. Not financial advice.
import { keccak_256 } from './vendor/noble-1/sha3.js?v=954';
import * as secp from './vendor/noble-1/secp256k1.js?v=954';

// ---- CONFIG (the Owner edits these; nothing here is a secret) -------------------------------------------------------------
export const CONFIG = {
  // 'testnet' while the feature is dark. Mainnet needs the Owner's go AND this line changed.
  network: 'testnet',
  // Builder code (Hyperliquid builder fee). OFF until the Owner gives an address. f = tenths of a basis point (10 = 0.01%).
  // Perps max 0.1% (f 100), spot max 1%. The builder account needs >= 100 USDC perps account value.
  builder: { address: '', feeTenthsBp: 0, maxApprove: '' },   // maxApprove e.g. '0.05%' (what the member approves once)
  maxNotionalUsd: 1000,        // client-side cap per order (USD notional)
  maxOrdersPerMin: 20,         // client-side cap on order / modify actions per rolling minute
  slippage: 0.03,              // market orders: IOC limit this far through the mid
  agentName: 'TradeZoro',      // named agent: approving again replaces only this one, not the member's other API wallets
  // Geo: Hyperliquid's Terms §1.6 exclude the US and Ontario, plus sanctioned / export-controlled jurisdictions.
  blockedCountries: ['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'CU', 'IR', 'KP', 'SY', 'RU', 'BY'],
  blockedRegions: ['CA-ON', 'UA-43', 'UA-40', 'UA-14', 'UA-09'],   // Ontario; Crimea, Sevastopol, Donetsk, Luhansk
  geoFailClosed: true,         // country unknown -> blocked
};
export const NET = {
  mainnet: { api: 'https://api.hyperliquid.xyz', ws: 'wss://api.hyperliquid.xyz/ws', app: 'https://app.hyperliquid.xyz', chain: 'Mainnet', source: 'a' },
  testnet: { api: 'https://api.hyperliquid-testnet.xyz', ws: 'wss://api.hyperliquid-testnet.xyz/ws', app: 'https://app.hyperliquid-testnet.xyz', chain: 'Testnet', source: 'b' },
};
export const DEFAULT_FEES = { taker: 0.00045, maker: 0.00015 };   // base tier; replaced by the member's own userFees when read

// ---- bytes ------------------------------------------------------------------------------------------------------------------
const te = new TextEncoder();
export const hex = (b) => '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export function unhex(h) {
  const s = String(h).replace(/^0x/i, '');
  if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error('bad hex');
  const o = new Uint8Array(s.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16);
  return o;
}
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
export const keccak = (b) => keccak_256(typeof b === 'string' ? te.encode(b) : b);
function u64be(n) { const o = new Uint8Array(8); let v = BigInt(n); for (let i = 7; i >= 0; i--) { o[i] = Number(v & 255n); v >>= 8n; } return o; }
function u256(n) { const o = new Uint8Array(32); let v = BigInt(n); for (let i = 31; i >= 0; i--) { o[i] = Number(v & 255n); v >>= 8n; } return o; }

// ---- msgpack (the subset Hyperliquid actions use; byte-identical to Python msgpack.packb) -----------------------------------
export function msgpack(v) {
  const out = [];
  const push = (...b) => { for (const x of b) out.push(x); };
  const be = (n, len) => { const r = []; let x = BigInt(n); for (let i = 0; i < len; i++) { r.unshift(Number(x & 255n)); x >>= 8n; } push(...r); };
  const enc = (x) => {
    if (x === null || x === undefined) return push(0xc0);
    if (x === true) return push(0xc3);
    if (x === false) return push(0xc2);
    if (typeof x === 'number' || typeof x === 'bigint') {
      if (typeof x === 'number' && !Number.isInteger(x)) throw new Error('msgpack: floats are not used in actions (' + x + ')');
      const n = BigInt(x);
      if (n >= 0n) {
        if (n < 128n) return push(Number(n));
        if (n < 256n) { push(0xcc); return be(n, 1); }
        if (n < 65536n) { push(0xcd); return be(n, 2); }
        if (n < 4294967296n) { push(0xce); return be(n, 4); }
        push(0xcf); return be(n, 8);
      }
      if (n >= -32n) return push(Number(n + 256n));
      if (n >= -128n) { push(0xd0); return be(n + 256n, 1); }
      if (n >= -32768n) { push(0xd1); return be(n + 65536n, 2); }
      if (n >= -2147483648n) { push(0xd2); return be(n + 4294967296n, 4); }
      push(0xd3); return be(n + 18446744073709551616n, 8);
    }
    if (typeof x === 'string') {
      const b = te.encode(x), l = b.length;
      if (l < 32) push(0xa0 | l); else if (l < 256) { push(0xd9); be(l, 1); } else if (l < 65536) { push(0xda); be(l, 2); } else { push(0xdb); be(l, 4); }
      return push(...b);
    }
    if (x instanceof Uint8Array) { const l = x.length; if (l < 256) { push(0xc4); be(l, 1); } else if (l < 65536) { push(0xc5); be(l, 2); } else { push(0xc6); be(l, 4); } return push(...x); }
    if (Array.isArray(x)) { const l = x.length; if (l < 16) push(0x90 | l); else if (l < 65536) { push(0xdc); be(l, 2); } else { push(0xdd); be(l, 4); } x.forEach(enc); return; }
    if (typeof x === 'object') {
      const ks = Object.keys(x).filter((k) => x[k] !== undefined), l = ks.length;
      if (l < 16) push(0x80 | l); else if (l < 65536) { push(0xde); be(l, 2); } else { push(0xdf); be(l, 4); }
      for (const k of ks) { enc(k); enc(x[k]); }
      return;
    }
    throw new Error('msgpack: unsupported ' + typeof x);
  };
  enc(v);
  return Uint8Array.from(out);
}

// ---- EIP-712 (the plain types Hyperliquid uses: string, address, bool, uint*, bytes32) ---------------------------------------
const DOMAIN_TYPES = [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }];
function encField(type, v) {
  if (type === 'string') return keccak(String(v));
  if (type === 'address') { const b = unhex(v); if (b.length !== 20) throw new Error('bad address'); return cat(new Uint8Array(12), b); }
  if (type === 'bool') return u256(v ? 1 : 0);
  if (/^uint\d+$/.test(type)) return u256(typeof v === 'string' && /^0x/i.test(v) ? BigInt(v) : BigInt(v));
  if (type === 'bytes32') { const b = typeof v === 'string' ? unhex(v) : v; if (b.length !== 32) throw new Error('bad bytes32'); return b; }
  throw new Error('eip712: unsupported type ' + type);
}
function structHash(name, fields, msg) {
  const sig = name + '(' + fields.map((f) => f.type + ' ' + f.name).join(',') + ')';
  return keccak(cat(keccak(sig), ...fields.map((f) => encField(f.type, msg[f.name]))));
}
// typed = { domain, types: { [primaryType]: [...], EIP712Domain? }, primaryType, message } (the eth_signTypedData_v4 shape)
export function typedDataDigest(typed) {
  const dom = structHash('EIP712Domain', DOMAIN_TYPES, typed.domain);
  const msg = structHash(typed.primaryType, typed.types[typed.primaryType], typed.message);
  return keccak(cat(Uint8Array.of(0x19, 0x01), dom, msg));
}

// ---- keys + signatures ------------------------------------------------------------------------------------------------------
export function addressOf(secretKey) {
  const pub = secp.getPublicKey(secretKey, false);          // 65 bytes, 0x04 || X || Y
  return '0x' + hex(keccak(pub.slice(1)).slice(12)).slice(2);
}
export function newAgentKey() { return secp.utils.randomSecretKey(); }
// async: the sync path needs an HMAC-SHA256 we would have to vendor; signAsync uses the browser's WebCrypto
export async function signDigest(digest, secretKey) {
  const s = await secp.signAsync(digest, secretKey, { prehash: false, format: 'recovered', lowS: true });   // recovery || r || s
  return { r: hex(s.slice(1, 33)), s: hex(s.slice(33, 65)), v: 27 + s[0] };
}
export function recoverAddress(digest, sig) {
  const b = cat(Uint8Array.of(sig.v - 27), unhex(sig.r), unhex(sig.s));
  const pub = secp.recoverPublicKey(b, digest, { prehash: false });
  const P = secp.Point.fromBytes(pub).toBytes(false);
  return '0x' + hex(keccak(P.slice(1)).slice(12)).slice(2);
}
// wallet's 65-byte hex signature (r||s||v) -> {r,s,v}
export function splitSig(h) {
  const b = unhex(h); if (b.length !== 65) throw new Error('bad signature');
  let v = b[64]; if (v < 27) v += 27;
  return { r: hex(b.slice(0, 32)), s: hex(b.slice(32, 64)), v };
}

// ---- L1 actions (signed by the agent key) -----------------------------------------------------------------------------------
export function actionHash(action, vault, nonce, expiresAfter) {
  const parts = [msgpack(action), u64be(nonce)];
  if (vault) parts.push(Uint8Array.of(1), unhex(vault)); else parts.push(Uint8Array.of(0));
  if (expiresAfter != null) parts.push(Uint8Array.of(0), u64be(expiresAfter));
  return keccak(cat(...parts));
}
export function l1Typed(hash, isMainnet) {
  return {
    domain: { chainId: 1337, name: 'Exchange', verifyingContract: '0x0000000000000000000000000000000000000000', version: '1' },
    types: { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }], EIP712Domain: DOMAIN_TYPES },
    primaryType: 'Agent',
    message: { source: isMainnet ? 'a' : 'b', connectionId: hash },
  };
}
export async function signL1(action, nonce, secretKey, isMainnet, vault = null, expiresAfter = null) {
  return signDigest(typedDataDigest(l1Typed(actionHash(action, vault, nonce, expiresAfter), isMainnet)), secretKey);
}

// ---- user-signed actions (signed ONCE by the member's wallet via eth_signTypedData_v4) --------------------------------------
const USER_TYPES = {
  approveAgent: ['HyperliquidTransaction:ApproveAgent', [{ name: 'hyperliquidChain', type: 'string' }, { name: 'agentAddress', type: 'address' }, { name: 'agentName', type: 'string' }, { name: 'nonce', type: 'uint64' }]],
  approveBuilderFee: ['HyperliquidTransaction:ApproveBuilderFee', [{ name: 'hyperliquidChain', type: 'string' }, { name: 'maxFeeRate', type: 'string' }, { name: 'builder', type: 'address' }, { name: 'nonce', type: 'uint64' }]],
};
// Only these two may ever be signed here. No withdraw, transfer, send or vault action exists in this module on purpose.
export function userSignedTyped(action) {
  const t = USER_TYPES[action.type]; if (!t) throw new Error('not allowed: ' + action.type);
  const msg = Object.assign({}, action); delete msg.type; delete msg.signatureChainId;
  return {
    domain: { name: 'HyperliquidSignTransaction', version: '1', chainId: parseInt(action.signatureChainId, 16), verifyingContract: '0x0000000000000000000000000000000000000000' },
    types: { [t[0]]: t[1], EIP712Domain: DOMAIN_TYPES },
    primaryType: t[0],
    message: msg,
  };
}
// chainIdHex = the wallet's current chain (wallets refuse to sign typed data for another chain); it only scopes the signature.
export function approveAgentAction(agentAddress, nonce, isMainnet, chainIdHex, name = CONFIG.agentName) {
  return { type: 'approveAgent', agentAddress, agentName: name, nonce, signatureChainId: chainIdHex, hyperliquidChain: isMainnet ? 'Mainnet' : 'Testnet' };
}
export function approveBuilderFeeAction(builder, maxFeeRate, nonce, isMainnet, chainIdHex) {
  return { type: 'approveBuilderFee', maxFeeRate, builder: String(builder).toLowerCase(), nonce, signatureChainId: chainIdHex, hyperliquidChain: isMainnet ? 'Mainnet' : 'Testnet' };
}

// ---- nonces: strictly increasing ms timestamps (HL keeps the 100 highest per signer; must be within T-2d..T+1d) ------------
let lastNonce = 0;
export function nextNonce(now = Date.now()) { lastNonce = Math.max(now, lastNonce + 1); return lastNonce; }

// ---- rounding (docs "Tick and lot size") ------------------------------------------------------------------------------------
// price: <= 5 significant figures and <= (6 perps | 8 spot) - szDecimals decimals; integers always allowed.
export function roundPx(px, szDecimals, isSpot = false) {
  if (!(px > 0)) return NaN;
  if (Number.isInteger(px)) return px;
  const dec = Math.max(0, (isSpot ? 8 : 6) - szDecimals);
  return Number(Number(px.toPrecision(5)).toFixed(dec));
}
// size: to szDecimals, toward zero (never more than asked)
export function roundSz(sz, szDecimals) {
  const f = 10 ** szDecimals;
  return Math.floor(sz * f + 1e-9) / f;
}
export function floatToWire(x) {
  const r = Number(x).toFixed(8);
  if (Math.abs(Number(r) - x) >= 1e-12) throw new Error('float_to_wire causes rounding ' + x);
  let s = r.includes('.') ? r.replace(/0+$/, '').replace(/\.$/, '') : r;
  if (s === '-0') s = '0';
  return s;
}
export function marketPx(mid, isBuy, szDecimals, slippage = CONFIG.slippage) {
  const p = mid * (isBuy ? 1 + slippage : 1 - slippage);
  const dec = Math.max(0, 6 - szDecimals);
  return Number(Number(p.toPrecision(5)).toFixed(dec));
}

// ---- meta ------------------------------------------------------------------------------------------------------------------
// meta = /info {type:'meta'} -> { [coin]: { asset, szDecimals, maxLeverage, onlyIsolated } } (main perp dex; asset = index)
export function parseMeta(meta) {
  const out = {};
  ((meta && meta.universe) || []).forEach((u, i) => { if (!u.isDelisted) out[u.name] = { asset: i, coin: u.name, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage, onlyIsolated: !!u.onlyIsolated }; });
  return out;
}

// ---- order building ---------------------------------------------------------------------------------------------------------
// o = { m (meta entry), isBuy, sz, kind: 'market'|'limit'|'stop'|'tp'|'sl', px (limit), trigger, mid, reduceOnly, tif, cloid }
export function orderWire(o) {
  const m = o.m, isBuy = !!o.isBuy;
  const sz = roundSz(o.sz, m.szDecimals);
  if (!(sz > 0)) throw new Error('size_zero');
  let p, t;
  if (o.kind === 'market') { p = marketPx(o.mid, isBuy, m.szDecimals); t = { limit: { tif: 'Ioc' } }; }
  else if (o.kind === 'limit') { p = roundPx(o.px, m.szDecimals); t = { limit: { tif: o.tif || 'Gtc' } }; }
  else if (o.kind === 'stop' || o.kind === 'tp' || o.kind === 'sl') {
    const trig = roundPx(o.trigger, m.szDecimals);
    p = marketPx(trig, isBuy, m.szDecimals);                     // market trigger: worst price it may fill at
    t = { trigger: { isMarket: true, triggerPx: floatToWire(trig), tpsl: o.kind === 'tp' ? 'tp' : 'sl' } };
  } else throw new Error('bad kind');
  if (!(p > 0)) throw new Error('price_bad');
  const w = { a: m.asset, b: isBuy, p: floatToWire(p), s: floatToWire(sz), r: !!(o.reduceOnly || o.kind === 'tp' || o.kind === 'sl'), t };
  if (o.cloid) w.c = o.cloid;
  return w;
}
export function orderAction(wires, grouping = 'na', builder = builderParam()) {
  const a = { type: 'order', orders: wires, grouping };
  if (builder) a.builder = builder;
  return a;
}
export function builderParam(cfg = CONFIG) {
  const b = cfg.builder || {};
  return /^0x[0-9a-fA-F]{40}$/.test(b.address || '') && b.feeTenthsBp > 0 ? { b: b.address.toLowerCase(), f: Math.min(100, Math.floor(b.feeTenthsBp)) } : null;
}
export const cancelAction = (list) => ({ type: 'cancel', cancels: list.map((c) => ({ a: c.asset, o: c.oid })) });
export const modifyAction = (oid, wire) => ({ type: 'batchModify', modifies: [{ oid, order: wire }] });
export const leverageAction = (asset, isCross, leverage) => ({ type: 'updateLeverage', asset, isCross: !!isCross, leverage: Math.round(leverage) });

// size from the member's unit: coins, USD notional, or % of equity (x leverage)
export function sizeFrom(unit, value, { px, equity, leverage, szDecimals }) {
  const v = +value; if (!(v > 0) || !(px > 0)) return 0;
  const coins = unit === 'usd' ? v / px : unit === 'pct' ? (equity * (v / 100) * (leverage || 1)) / px : v;
  return roundSz(coins, szDecimals);
}
// bracket from price / points / % away from the entry
export function bracketPx(mode, value, entry, isBuy, which) {
  const v = +value; if (!(v > 0)) return NaN;
  if (mode === 'price') return v;
  const away = mode === 'pct' ? entry * v / 100 : v;
  const up = (which === 'tp') === !!isBuy;
  return up ? entry + away : entry - away;
}

// ---- estimates for the confirm sheet ----------------------------------------------------------------------------------------
export function feeEst(notional, isMaker, fees = DEFAULT_FEES, builder = builderParam()) {
  const ex = notional * (isMaker ? fees.maker : fees.taker), bf = builder ? notional * builder.f / 1e5 : 0;
  return { exchange: ex, builder: bf, total: ex + bf };
}
// Hyperliquid docs (Liquidations): liq = px - side * marginAvailable / size / (1 - l * side), l = 1 / maintenance leverage,
// maintenance leverage = 2 * maxLeverage. marginAvailable: isolated = the position's margin; cross = account value minus the
// maintenance margin of the OTHER positions. An estimate (mark price moves, funding, other positions change).
export function liqEst({ side, entry, size, leverage, maxLeverage, isCross, accountValue = 0, otherMaint = 0 }) {
  const s = side === 'buy' ? 1 : -1, l = 1 / (2 * maxLeverage);
  if (!(entry > 0) || !(size > 0) || !(maxLeverage > 0)) return NaN;
  const avail = isCross ? accountValue - otherMaint : (entry * size) / leverage;
  const liq = entry - s * avail / size / (1 - l * s);
  return liq > 0 ? liq : 0;
}

// ---- client-side limits -----------------------------------------------------------------------------------------------------
export function makeLimiter(perMin = CONFIG.maxOrdersPerMin, now = () => Date.now()) {
  const hits = [];
  return { take() { const t = now(); while (hits.length && t - hits[0] > 60e3) hits.shift(); if (hits.length >= perMin) return false; hits.push(t); return true; }, get used() { return hits.length; } };
}
export function checkOrder({ notional, reduceOnly }, cfg = CONFIG) {
  if (!reduceOnly && notional > cfg.maxNotionalUsd) return 'This order is worth $' + Math.round(notional).toLocaleString('en-US') + '. The limit here is $' + cfg.maxNotionalUsd.toLocaleString('en-US') + ' per order.';
  if (!reduceOnly && notional < 10) return 'Orders must be worth at least $10.';
  return '';
}

// ---- geo -------------------------------------------------------------------------------------------------------------------
// g = { country: 'IN', region: 'MH' } from /api/geo (Cloudflare's request.cf). Returns '' when allowed, else a reason.
export function geoBlock(g, cfg = CONFIG) {
  const c = String((g && g.country) || '').toUpperCase(), r = String((g && g.region) || '').toUpperCase();
  if (!c || c === 'XX' || c === 'T1') return cfg.geoFailClosed ? 'unknown' : '';
  if (cfg.blockedCountries.includes(c)) return c;
  if (r && cfg.blockedRegions.includes(c + '-' + r)) return c + '-' + r;
  return '';
}

// ---- responses + errors in plain English ------------------------------------------------------------------------------------
const ERRS = [
  [/minimum value of \$?10/i, 'Orders must be worth at least $10.'],
  [/Insufficient margin/i, 'Not enough margin for this order. Lower the size or raise the leverage.'],
  [/(User or API Wallet|API Wallet|Vault) .*does not exist/i, 'Trading is not enabled for this wallet on Hyperliquid, or the account has no funds there yet. Deposit on Hyperliquid, then tap Enable trading again.'],
  [/Must deposit before/i, 'This wallet has no funds on Hyperliquid yet. Deposit on Hyperliquid first.'],
  [/Reduce only order would increase position/i, 'Reduce-only: this order would open or add to a position, so it was not placed.'],
  [/Post only order would have immediately matched/i, 'Post-only: this price would fill at once, so it was not placed.'],
  [/could not immediately match/i, 'No one was selling or buying near that price, so nothing filled. Try again or use a limit order.'],
  [/(Price must be divisible by tick size|invalid price|Order price cannot be more than)/i, 'That price is not valid for this market. It was rounded; check it and try again.'],
  [/invalid size|size must be/i, 'That size is not valid for this market (too many decimals or zero).'],
  [/Too many cumulative requests|rate limit/i, 'Hyperliquid is limiting requests from this account. Wait a moment and try again.'],
  [/nonce/i, 'The request was out of order. Try again.'],
  [/Builder fee has not been approved|builder/i, 'The builder fee is not approved for this wallet. Approve it in the panel, or it will be left off.'],
  [/Insufficient spot balance/i, 'Not enough spot balance.'],
  [/Too many open orders|maximum.*orders/i, 'Too many open orders on this account. Cancel some first.'],
  [/halted|not open for trading|delisted/i, 'This market is not trading right now.'],
  [/Order was never placed|already canceled|filled or canceled|Cannot modify canceled/i, 'That order is no longer open (it filled or was cancelled).'],
  [/leverage/i, 'That leverage is not allowed for this market or position.'],
];
export function plainError(msg) {
  const s = String(msg || '').trim();
  for (const [re, t] of ERRS) if (re.test(s)) return t;
  return s ? 'Hyperliquid said: ' + s.slice(0, 200) : 'Something went wrong. Nothing was placed.';
}
// /exchange answer -> [{ ok, oid, filled: {sz, px}, resting, error }] per order (or one row for non-order actions)
export function parseExchange(j) {
  if (!j || j.status !== 'ok') return [{ ok: false, error: plainError(j && j.response) }];
  const d = j.response && j.response.data;
  const st = d && Array.isArray(d.statuses) ? d.statuses : null;
  if (!st) return [{ ok: true }];
  return st.map((s) => {
    if (s === 'success' || s === 'waitingForFill' || s === 'waitingForTrigger') return { ok: true, waiting: s !== 'success' };
    if (s && s.error) return { ok: false, error: plainError(s.error) };
    if (s && s.filled) return { ok: true, oid: s.filled.oid, filled: { sz: +s.filled.totalSz, px: +s.filled.avgPx } };
    if (s && s.resting) return { ok: true, oid: s.resting.oid, resting: true };
    return { ok: true };
  });
}

// ---- account state (clearinghouseState + frontendOpenOrders) -> UI shape ----------------------------------------------------
export function normState(ch) {
  const ms = (ch && (ch.marginSummary || ch.crossMarginSummary)) || {};
  const pos = ((ch && ch.assetPositions) || []).map((a) => a.position).filter((p) => p && +p.szi !== 0).map((p) => ({
    coin: p.coin, size: +p.szi, side: +p.szi > 0 ? 'buy' : 'sell', entry: +p.entryPx, upnl: +p.unrealizedPnl, liq: p.liquidationPx == null ? null : +p.liquidationPx,
    value: +p.positionValue, margin: +p.marginUsed, lev: p.leverage ? +p.leverage.value : null, cross: !p.leverage || p.leverage.type === 'cross', maxLev: +p.maxLeverage,
  }));
  return { equity: +ms.accountValue || 0, marginUsed: +ms.totalMarginUsed || 0, ntl: +ms.totalNtlPos || 0, withdrawable: +(ch && ch.withdrawable) || 0, maint: +(ch && ch.crossMaintenanceMarginUsed) || 0, positions: pos };
}
export function normOrders(list) {
  return (Array.isArray(list) ? list : []).map((o) => ({
    coin: o.coin, oid: o.oid, side: o.side === 'B' ? 'buy' : 'sell', px: +o.limitPx, sz: +o.sz, trigger: o.isTrigger ? +o.triggerPx : null,
    type: o.orderType || (o.isTrigger ? 'Stop Market' : 'Limit'), reduceOnly: !!o.reduceOnly, tpsl: /take profit/i.test(o.orderType || '') ? 'tp' : (o.isTrigger ? 'sl' : ''), positionTpsl: !!o.isPositionTpsl, ts: o.timestamp,
  }));
}
