// Synthetic GEX history session for the browser tests (heatmap tab, chart indicator, replay).
// Base = REAL feeder snapshots of 2026-10-14 (fixtures/gex/hist-base-20261014.json, made by
// gex_feeder.py --snapshot from the real Cboe chain). Each 2-min slot from 09:30 to 16:14 ET moves
// spot along a fixed curve and scales the per-strike GEX, so every number is reproducible.
// NOT market data: test input only.
const fs = require('fs');
const path = require('path');
const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'gex', 'hist-base-20261014.json')));
const r2 = (v) => Math.round(v * 100) / 100;

// 09:30 ET on an EDT day (UTC-4; both test days are in October)
const open930 = (day) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), 13, 30) / 1000;

function session(u, d, day) {
  const b = BASE[u + ':' + d];
  if (!b) return [];
  const t0 = open930(day), seed = day === '2026-10-13' ? 1.7 : 0;
  const out = [];
  for (let i = 0; i < 203; i++) {
    const f = Math.sin(i / 28 + seed), sc = 0.75 + 0.5 * (i / 202);
    const s = r2(b.s * (1 + 0.0035 * f));
    out.push({ u, d, day, t: t0 + i * 120, fa: t0 + i * 120 + 900, x: b.x, s,
      cw: b.cw, pw: b.pw, zg: r2(b.zg - b.s * 0.001 * f), n: r2(b.n * sc), em: [b.em[0], b.em[1]],
      k: b.k.slice(), g: b.g.map((v) => r2(v * sc)) });
  }
  return out;
}

// same as workers/book-recorder/src/gex-history.js packHistory
function packed(u, d, rows) {
  const axis = [...new Set(rows.flatMap((r) => r.k))].sort((a, b) => a - b);
  const idx = new Map(axis.map((k, i) => [k, i]));
  const col = (f) => rows.map(f);
  return { v: 1, u, d, k: axis, t: col((r) => r.t), fa: col((r) => r.fa), day: col((r) => r.day), x: col((r) => r.x), s: col((r) => r.s), cw: col((r) => r.cw), pw: col((r) => r.pw),
    zg: col((r) => r.zg), n: col((r) => r.n), em: col((r) => r.em),
    g: rows.map((r) => { const i0 = idx.get(r.k[0]), vals = new Array(idx.get(r.k[r.k.length - 1]) - i0 + 1).fill(null); r.k.forEach((k, j) => { vals[idx.get(k) - i0] = r.g[j]; }); return [i0].concat(vals); }) };
}

module.exports = { session, packed, BASE, open930 };
