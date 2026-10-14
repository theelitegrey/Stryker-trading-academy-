// GEX history: feeder snapshot parity with the site engine, Worker ingest validation, the history
// store (90-day trim, query, sessions) and the no-lookahead lookup.
// node workers/book-recorder/test/gex-history.test.mjs     (needs python3 for the feeder side)
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSnaps, packHistory, unpackHistory, snapAt, KEEP_DAYS } from '../src/gex-history.js';
import { compactToContracts, ownGamma, profile, levels, straddleRange } from '../../../functions/api/gex/_engine.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const feeder = here('../gex-feeder/gex_feeder.py');
const dir = mkdtempSync(join(tmpdir(), 'gexhist-'));

// 1. parity: python snapshot == JS engine (Cboe spot + IV, the API's compare.cboe_only path)
const fx = JSON.parse(readFileSync(here('./fixtures/gex-near-20261014.json'), 'utf8'));
for (const [u, chain] of Object.entries(fx)) {
  const f = join(dir, u + '.json'); writeFileSync(f, JSON.stringify(chain));
  const now = chain.fetched_at;
  for (const dte of [0, 1]) {
    const py = JSON.parse(execFileSync('python3', [feeder, '--snapshot', f, u, String(dte), String(now)]));
    const t = py.t;
    const p = compactToContracts(chain, dte, t);
    const cs = ownGamma(p.contracts, p.spot, t);
    const pr = profile(p.spot, cs), lv = levels(p.spot, pr.gex, cs, pr, t);
    const em = straddleRange(p.spot, cs, t);
    ok(py.cw === lv.call_wall && py.pw === lv.put_wall, `${u} ${dte}DTE walls match the engine (${py.cw}/${py.pw})`);
    ok(Math.abs(py.zg - lv.zero_gamma) < 0.02, `${u} ${dte}DTE zero gamma matches (${py.zg} vs ${lv.zero_gamma && lv.zero_gamma.toFixed(2)})`);
    ok(Math.abs(py.em[1] - em.sigma) < 0.002, `${u} ${dte}DTE expected-range sigma matches (${py.em[1]})`);
    let worst = 0;
    py.k.forEach((k, i) => { worst = Math.max(worst, Math.abs(py.g[i] - pr.gex.get(k) / 1e6)); });
    ok(py.k.length > 10 && worst <= 0.006 && py.k.every((k) => Math.abs(k - p.spot) / p.spot <= 0.05), `${u} ${dte}DTE ${py.k.length} strikes within +-5%, per-strike GEX equal (max diff ${worst.toFixed(4)} $M)`);
    ok(py.x === [...new Set(cs.map((c) => c.exp.toISOString().slice(0, 10)))][0], `${u} ${dte}DTE expiry ${py.x}`);
  }
}

// 2. ingest validation
const now = 1792000087;
const one = JSON.parse(execFileSync('python3', [feeder, '--snapshot', join(dir, 'SPX.json'), 'SPX', '0', String(now)]));
const gz = (d) => { const b = gzipSync(JSON.stringify(d)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const v = (snaps, at = now) => validateSnaps(gz({ v: 1, snaps }), at * 1000);
ok(!(await v([one])).error && (await v([one])).snaps.length === 1, 'valid snapshot accepted');
ok((await v([{ ...one, u: 'AAPL' }])).error.startsWith('bad u'), 'unknown underlying refused');
ok((await v([{ ...one, d: 7 }])).error.startsWith('bad d'), 'only 0/1 DTE');
ok((await v([{ ...one, t: now + 600 }])).error.startsWith('bad t'), 'future snapshot refused');
ok((await v([{ ...one, g: one.g.slice(1) }])).error.startsWith('bad strikes'), 'k/g length mismatch refused');
ok((await v([{ ...one, k: one.k.map((k) => k * 2) }])).error.startsWith('bad strikes'), 'strikes outside +-5% refused');
ok((await v([one, one])).error === 'duplicate', 'duplicate u+d refused');
ok((await validateSnaps(new TextEncoder().encode(JSON.stringify({ v: 1, snaps: [one] })).buffer, now * 1000)).error === 'not gzip', 'gzip only');

// 3. pack/unpack + no-lookahead lookup
const rows = [0, 1, 2, 3].map((i) => ({ ...one, t: one.t + i * 120, s: one.s + i, cw: one.cw + (i === 3 ? 5 : 0) }));
const packed = packHistory('SPX', 0, rows);
const back = unpackHistory(packed);
ok(back.length === 4 && back[3].cw === one.cw + 5 && back[2].s === one.s + 2 && back[1].k.length === one.k.length, 'pack -> unpack round trip');
ok(JSON.stringify(packed).length < 1.3 * JSON.stringify(rows).length, 'packed form is compact (shared strike axis)');
ok(snapAt(back, one.t - 1) === null, 'before the history begins -> null (no snapshot)');
ok(snapAt(back, one.t).t === one.t, 'exactly at a snapshot time -> that snapshot');
ok(snapAt(back, one.t + 239).t === one.t + 120, 'between snapshots -> the earlier one (no lookahead)');
ok(snapAt(back, one.t + 360).t === one.t + 360 && snapAt(back, one.t + 99999).t === one.t + 360, 'after the last -> the last');
ok(snapAt(back, one.t + 99999, 1800) === null, 'stale beyond maxAge -> null');
ok(KEEP_DAYS === 90, 'keeps 90 days');
console.log(n + ' checks, ALL PASS');
