// Live TESTNET probe for assets/hl-trade-core.js (never mainnet; refuses to run if CONFIG.network is not 'testnet').
// Makes two fresh random keys in memory (a "member wallet" and an agent), funds nothing, prints nothing secret.
// Hyperliquid recovers the signer from every signature and names it in its error: when the named address is OUR address,
// the EIP-712 / msgpack signing is right. A tampered signature must name a different address.
//   node tools/tests/hl-trade-testnet-probe.mjs
const M = await import('../../assets/hl-trade-core.js');
if (M.CONFIG.network !== 'testnet') { console.error('refusing: network is not testnet'); process.exit(2); }
const API = M.NET.testnet.api;
const post = async (p, b) => { const r = await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => null) }; };
let fail = 0;
const check = (c, m) => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const master = M.newAgentKey(), agent = M.newAgentKey();
const mAddr = M.addressOf(master), aAddr = M.addressOf(agent);
console.log('member wallet (fresh, unfunded) ' + mAddr + '\nagent key address              ' + aAddr);
const meta = M.parseMeta((await post('/info', { type: 'meta' })).body);
const mid = +(await post('/info', { type: 'allMids' })).body.BTC;
console.log('testnet BTC asset ' + meta.BTC.asset + ', szDecimals ' + meta.BTC.szDecimals + ', mid ' + mid);
const names = (r) => String(r.body && r.body.response).toLowerCase();
const send = async (label, action, key, expectAddr) => {
  const nonce = M.nextNonce(), signature = await M.signL1(action, nonce, key, false);
  const r = await post('/exchange', { action, nonce, signature, vaultAddress: null });
  console.log('  ' + label + ' -> HTTP ' + r.status + ' ' + JSON.stringify(r.body));
  check(r.status === 200 && names(r).includes(expectAddr), label + ': Hyperliquid recovered our signer ' + expectAddr);
  console.log('  plain English: ' + M.plainError(r.body && r.body.response));
};
// 1 approveAgent, signed as the member's wallet would (eth_signTypedData_v4 digest)
{
  const act = M.approveAgentAction(aAddr, M.nextNonce(), false, '0x66eee');
  const signature = await M.signDigest(M.typedDataDigest(M.userSignedTyped(act)), master);
  const r = await post('/exchange', { action: act, nonce: act.nonce, signature, vaultAddress: null });
  console.log('  approveAgent -> HTTP ' + r.status + ' ' + JSON.stringify(r.body));
  check(names(r).includes(mAddr), 'approveAgent (user-signed EIP-712): Hyperliquid recovered the member wallet');
}
const w = M.orderWire({ m: meta.BTC, isBuy: true, sz: 0.001, kind: 'limit', px: mid * 0.5 });
await send('limit order (agent)', M.orderAction([w], 'na', null), agent, aAddr);
await send('order + TP + SL, normalTpsl (agent)', M.orderAction([w, M.orderWire({ m: meta.BTC, isBuy: false, sz: 0.001, kind: 'tp', trigger: mid * 0.6 }), M.orderWire({ m: meta.BTC, isBuy: false, sz: 0.001, kind: 'sl', trigger: mid * 0.4 })], 'normalTpsl', null), agent, aAddr);
await send('order with builder {b,f} (agent)', M.orderAction([w], 'na', { b: '0x' + '00'.repeat(19) + '01', f: 10 }), agent, aAddr);
await send('modify (agent)', M.modifyAction(1, w), agent, aAddr);
await send('cancel (agent)', M.cancelAction([{ asset: meta.BTC.asset, oid: 1 }]), agent, aAddr);
await send('update leverage (agent)', M.leverageAction(meta.BTC.asset, true, 5), agent, aAddr);
await send('market order (member key)', M.orderAction([M.orderWire({ m: meta.BTC, isBuy: true, sz: 0.001, kind: 'market', mid })], 'na', null), master, mAddr);
{
  const action = M.orderAction([w], 'na', null), nonce = M.nextNonce(), signature = await M.signL1(action, nonce, agent, false);
  signature.s = '0x' + (BigInt(signature.s) ^ 1n).toString(16).padStart(64, '0');
  const r = await post('/exchange', { action, nonce, signature, vaultAddress: null });
  console.log('  tampered signature -> ' + JSON.stringify(r.body));
  check(!names(r).includes(aAddr) && !names(r).includes(mAddr), 'tampered signature recovers a different address (rejected)');
}
console.log(fail ? fail + ' FAILED' : 'all passed');
process.exit(fail ? 1 : 0);
