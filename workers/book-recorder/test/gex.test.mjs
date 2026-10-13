// GEX compact-chain ingest checks (src/gex.js validateGexChain) + the feeder's compact format.
// node workers/book-recorder/test/gex.test.mjs     (needs python3 for the feeder round trip)
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGexChain } from '../src/gex.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
const now = Date.UTC(2026, 9, 13, 17, 50) / 1000;
const good = (o = {}) => ({ v: 1, part: 'near', symbol: '^SPX', spot: 7797.5, iv30: 12.2, chain_time: '2026-10-13T13:34:00', fetched_at: now - 30,
  cols: ['strike', 'cp', 'oi', 'iv', 'bid', 'ask', 'vol', 'delta'], expiries: { '2026-10-13': [[7800, 'C', 1200, 0.08, 4, 4.2, 900, 0.45], [7800, 'P', 1500, 0.08, 6.5, 6.8, 800, -0.55]] }, ...o });
const gz = (d) => { const b = gzipSync(JSON.stringify(d)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const v = (sym, part, d) => validateGexChain(sym, part, d instanceof ArrayBuffer ? d : gz(d), now * 1000);

ok((await v('SPX', 'near', good())).fetched_at === now - 30, 'valid SPX near chain accepted');
ok((await v('QQQ', 'near', good())).error === 'symbol mismatch', 'symbol must match the URL');
ok((await v('AAPL', 'near', good({ symbol: 'AAPL' }))).error === 'symbol not served', 'only QQQ/SPX/SPY/GLD');
ok((await v('SPX', 'wide', good())).error === 'bad part', 'part near|term only');
ok((await v('SPX', 'near', good({ fetched_at: now - 3600 }))).error.startsWith('stale'), 'stale chain refused');
ok((await v('SPX', 'near', good({ fetched_at: now + 600 }))).error.startsWith('stale'), 'future chain refused');
ok((await v('SPX', 'near', good({ spot: -1 }))).error === 'bad spot', 'bad spot refused');
ok((await v('SPX', 'near', good({ expiries: { 'x': [] } }))).error.startsWith('bad expiry'), 'bad expiry key refused');
ok((await v('SPX', 'near', good({ expiries: { '2026-10-13': [[7800, 'X', 1, 0, 0, 0, 0, 0]] } }))).error.startsWith('bad row'), 'bad row refused');
const plain = new TextEncoder().encode(JSON.stringify(good())).buffer;
ok((await v('SPX', 'near', plain)).error === 'not gzip', 'plain JSON refused (gzip only)');
ok((await v('SPX', 'near', new ArrayBuffer(300 * 1024))).error === 'bad size', 'over 256 KB refused');

// feeder round trip: a tiny Cboe-shaped file -> compact -> accepted by the Worker
const dir = mkdtempSync(join(tmpdir(), 'gexfeed-'));
const f = join(dir, 'q.json');
writeFileSync(f, '{"timestamp": "2026-10-13 17:49:03", "data": {"options": [' +
  [['C', 742000, 0.13], ['P', 742000, 0.128], ['C', 900000, 0.5], ['C', 745000, 0.12]].map(([cp, k, iv]) => `{"option": "QQQ261013${cp}00${k}", "bid": 1.0, "ask": 1.1, "iv": ${iv}, "open_interest": 100.0, "volume": 5.0, "delta": 0.5, "gamma": 0.1}`).join(', ') +
  '], "symbol": "QQQ", "current_price": 741.6, "iv30": 18.47, "last_trade_time": "2026-10-13T13:34:01"}, "symbol": "QQQ"}');
const feeder = fileURLToPath(new URL('../gex-feeder/gex_feeder.py', import.meta.url));
const out = JSON.parse(execFileSync('python3', [feeder, '--compact', f, String(now - 30)]));
ok(out.near.expiries['2026-10-13'].length === 3 && out.near.spot === 741.6 && out.near.symbol === 'QQQ', 'feeder: near part keeps the 3 strikes within +-12% (900 dropped)');
ok(JSON.stringify(out.near.expiries['2026-10-13'][0]) === JSON.stringify([742, 'C', 100, 0.13, 1, 1.1, 5, 0.5]), 'feeder row = [strike, cp, oi, iv, bid, ask, vol, delta]');
ok((await v('QQQ', 'near', out.near)).fetched_at === now - 30 && (await v('QQQ', 'term', out.term)).fetched_at === now - 30, 'feeder output accepted by the Worker (near + term)');
console.log(n + ' checks, ALL PASS');
