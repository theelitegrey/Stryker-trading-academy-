// Unit tests: assets/hl-trade-core.js (Hyperliquid signing, rounding, order building, errors, limits, geo) + hl-trade.js pure parts.
// tools/fixtures/hl-trade/vectors.json was written by the OFFICIAL hyperliquid-python-sdk 0.24 (utils/signing.py: action_hash,
// sign_l1_action, sign_agent, sign_approve_builder_fee, float_to_wire) with eth-account, private key 0x11..11. Our JS must give the
// same action hashes and the same signatures byte for byte.
//   node tools/tests/hl-trade-core.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.window = globalThis.window || {};
const M = await import('../../assets/hl-trade-core.js');
const T = await import('../../assets/hl-trade.js');
const V = JSON.parse(fs.readFileSync(new URL('../fixtures/hl-trade/vectors.json', import.meta.url)));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS ' + m); };
const sk = M.unhex('0x' + '11'.repeat(32));
const sameSig = (a, b) => BigInt(a.r) === BigInt(b.r) && BigInt(a.s) === BigInt(b.s) && a.v === b.v;   // SDK's to_hex drops leading zeros

// --- keys + msgpack + L1 signing
ok(M.addressOf(sk) === V.addr.toLowerCase(), 'address from private key = SDK (eth-account)');
ok(M.hex(M.msgpack({ a: 1, b: [true, false, null], c: 'x' })) === '0x83a16101a16293c3c2c0a163a178', 'msgpack map/array/bool/nil/str');
ok(M.hex(M.msgpack(64814289034)) === '0xcf0000000f173b908a' && M.hex(M.msgpack(300)) === '0xcd012c' && M.hex(M.msgpack(-1)) === '0xff', 'msgpack uint64 / uint16 / negative fixint (= Python msgpack)');
assert.throws(() => M.msgpack({ p: 1.5 })); n++; console.log('PASS msgpack refuses floats (prices/sizes go as strings)');
for (const [i, c] of V.cases.entries()) {
  ok(M.hex(M.actionHash(c.action, null, c.nonce, null)).slice(2) === c.hash, 'case ' + i + ' (' + c.action.type + (c.action.builder ? ' + builder' : '') + '): action hash = SDK');
  const s = await M.signL1(c.action, c.nonce, sk, c.mainnet);
  ok(sameSig(s, c.sig), 'case ' + i + ': L1 signature = SDK (' + (c.mainnet ? 'mainnet' : 'testnet') + ')');
  ok(M.recoverAddress(M.typedDataDigest(M.l1Typed(M.actionHash(c.action, null, c.nonce, null), c.mainnet)), s) === V.addr.toLowerCase(), 'case ' + i + ': signature recovers the signer');
}
ok(M.hex(M.actionHash(V.cases[0].action, null, V.cases[0].nonce, null)) !== M.hex(M.actionHash(V.cases[0].action, '0x' + '22'.repeat(20), V.cases[0].nonce, null)), 'vault address changes the hash');
ok(M.hex(M.actionHash(V.cases[0].action, null, V.cases[0].nonce, null)) !== M.hex(M.actionHash(V.cases[0].action, null, V.cases[0].nonce + 1, null)), 'nonce changes the hash');

// --- user-signed: approveAgent + approveBuilderFee (the wallet signs these via eth_signTypedData_v4)
{
  const act = Object.assign({ signatureChainId: '0x66eee' }, V.agent.action);
  const typed = M.userSignedTyped(act);
  ok(typed.primaryType === 'HyperliquidTransaction:ApproveAgent' && typed.domain.chainId === 0x66eee && typed.domain.name === 'HyperliquidSignTransaction' && !('type' in typed.message), 'approveAgent typed data shape');
  ok(sameSig(await M.signDigest(M.typedDataDigest(typed), sk), V.agent.sig), 'approveAgent signature = SDK sign_agent');
  const b = Object.assign({ signatureChainId: '0x66eee', hyperliquidChain: 'Mainnet' }, V.builder.action);
  ok(sameSig(await M.signDigest(M.typedDataDigest(M.userSignedTyped(b)), sk), V.builder.sig), 'approveBuilderFee signature = SDK sign_approve_builder_fee');
  const built = M.approveAgentAction('0x' + 'cd'.repeat(20), 1794126205631, false, '0x66eee', 'TradeZoro');
  ok(M.hex(M.typedDataDigest(M.userSignedTyped(built))) === M.hex(M.typedDataDigest(typed)), 'approveAgentAction builds the same message');
  for (const bad of ['withdraw3', 'usdSend', 'spotSend', 'usdClassTransfer', 'sendAsset', 'vaultTransfer', 'subAccountTransfer'])
    assert.throws(() => M.userSignedTyped({ type: bad, signatureChainId: '0x1' }), new RegExp('not allowed'));
  n++; console.log('PASS no withdraw / transfer / send action can be signed');
  const sig = await M.signDigest(M.typedDataDigest(typed), sk);
  const h = sig.r + sig.s.slice(2).padStart(64, '0') + (sig.v).toString(16);
  ok(sameSig(M.splitSig(h), sig) && M.splitSig(sig.r + sig.s.slice(2).padStart(64, '0') + '00').v === 27, 'wallet 65-byte signature -> {r,s,v} (v 0/1 -> 27/28)');
}
ok(!Object.keys(M).some((k) => /withdraw|transfer|send/i.test(k)), 'core exports nothing for withdraw / transfer / send');

// --- wire + rounding (docs: Tick and lot size)
for (const [x, w] of V.wire) ok(M.floatToWire(x) === w, 'float_to_wire ' + x + ' -> ' + w + ' (= SDK)');
assert.throws(() => M.floatToWire(0.123456789)); n++; console.log('PASS float_to_wire refuses values that would round');
ok(M.roundPx(1234.56, 3) === 1234.6 && M.roundPx(123456, 0) === 123456 && M.roundPx(75774.53, 5) === 75775, 'price: 5 significant figures, integers always allowed');
ok(M.roundPx(0.0012347, 0) === 0.001235 && M.roundPx(0.0123467, 1) === 0.01235 && M.roundPx(0.0123467, 2) === 0.0123, 'price: max 6 - szDecimals decimals (perps)');
ok(M.roundPx(0.00012347, 1, true) === 0.0001235 && M.roundPx(0.00012347, 3, true) === 0.00012, 'price: max 8 - szDecimals decimals (spot)');
ok(M.roundSz(0.123456, 5) === 0.12345 && M.roundSz(1.9999, 0) === 1 && M.roundSz(0.30000000000000004, 2) === 0.3, 'size: to szDecimals, never more than asked');
ok(M.marketPx(75000, true, 5) === 77250 && M.marketPx(75000, false, 5) === 72750 && M.marketPx(2245.83, true, 4) === 2313.2, 'market IOC price = mid +/- 3%, rounded like the SDK');

// --- meta + order building
const meta = M.parseMeta({ universe: [{ name: 'SOL', szDecimals: 2, maxLeverage: 10 }, { name: 'OLD', szDecimals: 1, maxLeverage: 3, isDelisted: true }, { name: 'ETH', szDecimals: 4, maxLeverage: 25 }, { name: 'BTC', szDecimals: 5, maxLeverage: 40 }] });
ok(meta.BTC.asset === 3 && meta.ETH.asset === 2 && !meta.OLD && meta.SOL.szDecimals === 2, 'asset id = index in meta.universe (delisted skipped, index kept)');
{
  const w = M.orderWire({ m: meta.BTC, isBuy: true, sz: 0.0012345, kind: 'limit', px: 75012.37 });
  ok(JSON.stringify(w) === '{"a":3,"b":true,"p":"75012","s":"0.00123","r":false,"t":{"limit":{"tif":"Gtc"}}}', 'limit wire: rounded price + size, key order as the SDK');
  const mk = M.orderWire({ m: meta.ETH, isBuy: false, sz: 0.5, kind: 'market', mid: 2245.8 });
  ok(mk.p === '2178.4' && mk.t.limit.tif === 'Ioc' && mk.r === false, 'market = IOC limit 3% through the mid');
  const sl = M.orderWire({ m: meta.ETH, isBuy: false, sz: 0.5, kind: 'sl', trigger: 2100.04 });
  ok(sl.r === true && sl.t.trigger.tpsl === 'sl' && sl.t.trigger.triggerPx === '2100' && sl.t.trigger.isMarket === true, 'stop loss = reduce-only market trigger');
  const tp = M.orderWire({ m: meta.ETH, isBuy: false, sz: 0.5, kind: 'tp', trigger: 2400 });
  ok(tp.t.trigger.tpsl === 'tp' && tp.r === true, 'take profit = reduce-only tp trigger');
  const st = M.orderWire({ m: meta.ETH, isBuy: true, sz: 0.5, kind: 'stop', trigger: 2300 });
  ok(st.r === false && st.t.trigger.tpsl === 'sl', 'entry stop is not reduce-only');
  assert.throws(() => M.orderWire({ m: meta.BTC, isBuy: true, sz: 0.000001, kind: 'limit', px: 1 }), /size_zero/); n++; console.log('PASS size that rounds to 0 is refused');
  const a = M.orderAction([w], 'na', null);
  ok(!('builder' in a) && M.builderParam() === null, 'builder fee OFF by default (empty config)');
  ok(JSON.stringify(M.builderParam({ builder: { address: '0x' + 'AB'.repeat(20), feeTenthsBp: 250 } })) === '{"b":"0x' + 'ab'.repeat(20) + '","f":100}', 'builder: address lowercased, fee capped at 0.1% (f=100) for perps');
  ok(M.builderParam({ builder: { address: 'nope', feeTenthsBp: 10 } }) === null, 'builder: bad address -> off');
  ok(JSON.stringify(M.orderAction([w], 'normalTpsl', { b: '0xab', f: 10 })).endsWith('"grouping":"normalTpsl","builder":{"b":"0xab","f":10}}'), 'builder goes after grouping (msgpack key order = SDK)');
  ok(JSON.stringify(M.cancelAction([{ asset: 3, oid: 9 }])) === '{"type":"cancel","cancels":[{"a":3,"o":9}]}', 'cancel action');
  ok(JSON.stringify(M.modifyAction(9, w)).startsWith('{"type":"batchModify","modifies":[{"oid":9,"order":{"a":3'), 'modify action');
  ok(JSON.stringify(M.leverageAction(3, false, 7.4)) === '{"type":"updateLeverage","asset":3,"isCross":false,"leverage":7}', 'leverage action');
}
ok(M.sizeFrom('coin', '0.0123456', { px: 1, szDecimals: 5 }) === 0.01234 && M.sizeFrom('usd', 1000, { px: 2000, szDecimals: 4 }) === 0.5 && M.sizeFrom('pct', 10, { px: 100, equity: 5000, leverage: 5, szDecimals: 2 }) === 25, 'size in coins / USD / % of equity x leverage');
ok(M.bracketPx('pts', 50, 2000, true, 'tp') === 2050 && M.bracketPx('pts', 50, 2000, true, 'sl') === 1950 && M.bracketPx('pct', 1, 2000, false, 'tp') === 1980 && M.bracketPx('price', 2100, 2000, true, 'tp') === 2100 && Number.isNaN(M.bracketPx('pts', '', 2000, true, 'tp')), 'bracket by price / points / %');
{ const a = M.nextNonce(), b = M.nextNonce(), c = M.nextNonce(1); ok(b > a && c === b + 1, 'nonces strictly increase (same ms -> +1; clock going back never repeats one)'); }

// --- estimates
{
  const f = M.feeEst(10000, false, { taker: 0.00045, maker: 0.00015 }, { b: '0x', f: 10 });
  ok(Math.abs(f.exchange - 4.5) < 1e-9 && Math.abs(f.builder - 1) < 1e-9 && Math.abs(f.total - 5.5) < 1e-9, 'fees: taker 4.5 bp + builder f=10 (1 bp) on $10K');
  // isolated long 1 BTC @ 75000, 10x, maxLeverage 40: margin 7500, l = 1/80 -> liq = 75000 - 7500 / (1 - 1/80)
  const liq = M.liqEst({ side: 'buy', entry: 75000, size: 1, leverage: 10, maxLeverage: 40, isCross: false });
  ok(Math.abs(liq - (75000 - 7500 / (1 - 1 / 80))) < 1e-6, 'liquidation estimate (isolated long, docs formula)');
  const lq2 = M.liqEst({ side: 'sell', entry: 2000, size: 2, leverage: 5, maxLeverage: 25, isCross: true, accountValue: 1000, otherMaint: 0 });
  ok(Math.abs(lq2 - (2000 + 1000 / 2 / (1 + 1 / 50))) < 1e-6, 'liquidation estimate (cross short)');
  // the real testnet account read on 2026-11-08: SOL long 284.58 @ 89.4574, cross, account value 13921.78, other maint ~= total maint - SOL maint
}
// --- limits
{ let t = 0; const L = M.makeLimiter(3, () => t); ok(L.take() && L.take() && L.take() && !L.take(), 'max orders per minute'); t = 60001; ok(L.take(), 'limit frees after a minute'); }
ok(M.checkOrder({ notional: 5000 }, { maxNotionalUsd: 1000 }).includes('$1,000') && M.checkOrder({ notional: 5000, reduceOnly: true }, { maxNotionalUsd: 1000 }) === '' && /at least \$10/.test(M.checkOrder({ notional: 5 }, { maxNotionalUsd: 1000 })), 'max notional per order (reduce-only exempt), $10 minimum');
// --- geo
ok(M.geoBlock({ country: 'US' }) === 'US' && M.geoBlock({ country: 'IR' }) === 'IR' && M.geoBlock({ country: 'KP' }) === 'KP', 'US + sanctioned countries blocked');
ok(M.geoBlock({ country: 'CA', region: 'ON' }) === 'CA-ON' && M.geoBlock({ country: 'CA', region: 'BC' }) === '' && M.geoBlock({ country: 'UA', region: '43' }) === 'UA-43', 'regions: Ontario + Crimea blocked, rest of Canada allowed');
ok(M.geoBlock({ country: 'IN' }) === '' && M.geoBlock({ country: 'GB' }) === '' && M.geoBlock({}) === 'unknown' && M.geoBlock({ country: 'T1' }) === 'unknown', 'others allowed; unknown / Tor -> blocked (fail closed)');
// --- errors (texts are Hyperliquid's real answers, incl. the testnet run of 2026-11-08)
ok(/no funds on Hyperliquid/.test(M.plainError('Must deposit before performing actions. User: 0x961c32918ac7cf507dd37c187fbf96a462ddf042')), 'error: must deposit');
ok(/not enabled for this wallet/.test(M.plainError('User or API Wallet 0xb4f3d09e2b1f0367762ae69280cc6aad5ee4e604 does not exist.')), 'error: agent not approved');
ok(/Not enough margin/.test(M.plainError('Insufficient margin to place order. asset=3')) && /at least \$10/.test(M.plainError('Order must have minimum value of $10. asset=3')), 'error: margin / minimum');
ok(/Reduce-only/.test(M.plainError('Reduce only order would increase position. asset=3')) && /Post-only/.test(M.plainError('Post only order would have immediately matched, bbo was 75000@75001. asset=3')), 'error: reduce-only / post-only');
ok(/nothing filled/.test(M.plainError('Order could not immediately match against any resting orders. asset=3')), 'error: IOC no match');
ok(M.plainError('weird new thing') === 'Hyperliquid said: weird new thing' && /Nothing was placed/.test(M.plainError('')), 'error: unknown text passed through, empty handled');
{
  const r = M.parseExchange({ status: 'ok', response: { type: 'order', data: { statuses: [{ filled: { totalSz: '0.02', avgPx: '1891.4', oid: 77738308 } }, { resting: { oid: 77738309 } }, 'waitingForTrigger', { error: 'Insufficient margin to place order. asset=1' }] } } });
  ok(r[0].ok && r[0].filled.px === 1891.4 && r[1].resting && r[1].oid === 77738309 && r[2].waiting && !r[3].ok && /margin/.test(r[3].error), 'exchange answer: filled / resting / waiting / error per order');
  ok(!M.parseExchange({ status: 'err', response: 'Must deposit before performing actions.' })[0].ok && M.parseExchange({ status: 'ok', response: { type: 'cancel', data: { statuses: ['success'] } } })[0].ok, 'exchange answer: err / cancel success');
  ok(!M.parseExchange(null)[0].ok, 'exchange answer: unreadable -> not ok');
}
// --- account normalisation (real testnet clearinghouseState shape, 2026-11-08)
{
  const st = M.normState({ marginSummary: { accountValue: '13921.782635', totalNtlPos: '67918.0189', totalMarginUsed: '13583.60378' }, crossMaintenanceMarginUsed: '2045.109893', withdrawable: '338.178855',
    assetPositions: [{ type: 'oneWay', position: { coin: 'SOL', szi: '284.58', leverage: { type: 'cross', value: 5 }, entryPx: '89.4574', positionValue: '25391.6505', unrealizedPnl: '-66.14626', liquidationPx: '45.294432915', marginUsed: '5078.3301', maxLeverage: 10 } },
      { type: 'oneWay', position: { coin: 'ETH', szi: '-7.3432', leverage: { type: 'isolated', value: 5 }, entryPx: '2249.09', positionValue: '16492.8272', unrealizedPnl: '22.74346', liquidationPx: null, marginUsed: '3298.56544', maxLeverage: 25 } }] });
  ok(st.equity === 13921.782635 && st.positions.length === 2 && st.positions[0].side === 'buy' && st.positions[1].side === 'sell' && !st.positions[1].cross && st.positions[1].liq === null, 'account state -> equity, positions (side, cross/isolated, liq)');
  const os = M.normOrders([{ coin: 'BTC', side: 'A', limitPx: '70000', sz: '0.0', oid: 5, timestamp: 1, triggerPx: '70000', isTrigger: true, orderType: 'Stop Market', reduceOnly: true, isPositionTpsl: true },
    { coin: 'BTC', side: 'B', limitPx: '60000', sz: '0.01', oid: 6, timestamp: 2, triggerPx: '0.0', isTrigger: false, orderType: 'Limit', reduceOnly: false }]);
  ok(os[0].tpsl === 'sl' && os[0].trigger === 70000 && os[0].positionTpsl && os[1].trigger === null && os[1].side === 'buy', 'open orders -> trigger / limit, tp/sl kind');
  // chart lines from that state
  const lines = T.linesFor('BTC', { addr: '0x1', ch: { positions: [{ coin: 'BTC', side: 'buy', size: 0.5, entry: 75000, upnl: 12, liq: 40000 }] }, orders: os });
  ok(lines.map((l) => l.kind).join(',') === 'pos,liq,sl,ord' && lines[1].price === 40000 && lines[2].price === 70000, 'chart lines: entry, liquidation, SL trigger, limit order');
  ok(T.linesFor('BTC', { addr: '', ch: null, orders: [] }).length === 0 && T.coinOf('hyperliquid:BTC') === 'BTC' && T.coinOf('binance:BTCUSDT') === '' && T.coinOf('hyperliquid:PURR/USDC') === '', 'no wallet -> no lines; perps only');
}
console.log('\n' + n + ' passed');
