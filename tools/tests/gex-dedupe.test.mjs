// SPX / SPXW duplicate contracts: one consistent pick (CoS decision 2026-10-16).  node tools/tests/gex-dedupe.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedupeRoots, insightQuoteMap, parseOptions } from '../../functions/api/gex/_engine.js';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
const e = new Date('2026-10-16T00:00:00Z'), e2 = new Date('2026-10-19T00:00:00Z');
// 1. dedupeRoots: weekly wins where it exists, plain root kept only where weekly does not list the expiry
const rows = [
  { root: 'SPX', exp: e, strike: 7650, cp: 'C', oi: 100 }, { root: 'SPXW', exp: e, strike: 7650, cp: 'C', oi: 900 },
  { root: 'SPX', exp: e2, strike: 7650, cp: 'C', oi: 50 }
];
const out = dedupeRoots(rows.map((r) => ({ ...r })));
ok(out.length === 2 && out.find((r) => r.exp === e).root === 'SPXW' && out.find((r) => r.exp === e2).root === 'SPX', 'dedupeRoots: SPXW for the shared expiry, SPX kept for an SPX-only expiry');
const flipped = dedupeRoots(rows.slice().reverse().map((r) => ({ ...r })));
ok(flipped.length === 2 && flipped.map((r) => r.root).sort().join() === 'SPX,SPXW', 'dedupeRoots: input order does not matter');
ok(dedupeRoots([{ root: 'QQQ', exp: e }, { root: 'QQQ', exp: e }]).length === 2, 'dedupeRoots: QQQ (no weekly root) untouched');
// 2. insightQuoteMap: same answer in either order
const q = (codes) => ({ last_price: 7650, data: codes.map(([code, iv]) => ({ code, expiration: 20261016, type: 'CALL', strike_price: 7650, implied_volatility: iv, bid_price: 1, ask_price: 2 })) });
const a = insightQuoteMap(q([['OPRA:SPX261016C7650.0', 0.9], ['OPRA:SPXW261016C7650.0', 0.2]]), '2026-10-16').byKey.get('C|7650').iv;
const b = insightQuoteMap(q([['OPRA:SPXW261016C7650.0', 0.2], ['OPRA:SPX261016C7650.0', 0.9]]), '2026-10-16').byKey.get('C|7650').iv;
ok(a === 0.2 && b === 0.2, 'insightQuoteMap: weekly (SPXW) IV wins in either order');
// 3. parseOptions on a raw Cboe-shaped chain
const raw = { current_price: 7650, options: [
  { option: 'SPX261016C07650000', open_interest: 100, gamma: 0.001, iv: 0.3 }, { option: 'SPXW261016C07650000', open_interest: 900, gamma: 0.001, iv: 0.2 },
  { option: 'SPX261016P07650000', open_interest: 100, gamma: 0.001, iv: 0.3 }, { option: 'SPXW261016P07650000', open_interest: 800, gamma: 0.001, iv: 0.2 } ] };
const pr = parseOptions(raw, 0, Date.UTC(2026, 9, 16, 15) / 1000);
ok(pr.contracts.length === 2 && pr.contracts.every((c) => c.oi >= 800), 'parseOptions: only the SPXW rows (OI not double counted)');
// 4. the Cboe feeder (python) applies the same rule
const dir = mkdtempSync(join(tmpdir(), 'dedupe-')), f = join(dir, 'c.json');
const o = (opt, oi) => `{"option": "${opt}", "bid": 1.0, "ask": 1.1, "iv": 0.2, "open_interest": ${oi}.0, "volume": 5.0, "delta": 0.5, "gamma": 0.1}`;
writeFileSync(f, '{"timestamp": "2026-10-16 15:00:00", "data": {"options": [' + [o('SPX261016C07650000', 100), o('SPXW261016C07650000', 900), o('SPX261019C07650000', 50), o('SPXW261020C07650000', 70)].join(', ') + '], "symbol": "^SPX", "current_price": 7650.0, "iv30": 18.0, "last_trade_time": "2026-10-16T11:00:00"}, "symbol": "^SPX"}');
const feeder = fileURLToPath(new URL('../../workers/book-recorder/gex-feeder/gex_feeder.py', import.meta.url));
const co = JSON.parse(execFileSync('python3', [feeder, '--compact', f, String(Date.UTC(2026, 9, 16, 15) / 1000)]));
const ex = co.near.expiries;
ok(ex['2026-10-16'].length === 1 && ex['2026-10-16'][0][2] === 900, 'feeder: shared expiry keeps only the SPXW row (OI 900)');
ok(ex['2026-10-19'].length === 1 && ex['2026-10-19'][0][2] === 50, 'feeder: SPX-only expiry keeps the SPX row');
console.log('gex-dedupe.test: ' + n + ' checks passed');
