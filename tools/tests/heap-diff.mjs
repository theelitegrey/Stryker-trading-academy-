// Compare two V8 heap snapshots (.heapsnapshot, e.g. from chart-memory-browser.js SNAP=dir): which constructors grew.
//   node tools/tests/heap-diff.mjs a.heapsnapshot b.heapsnapshot [top=25]
// Prints, per constructor (node type + name), the count and self-size growth from a to b, biggest first,
// and for the top grower a sample retainer path in b (who keeps it alive).
import fs from 'node:fs';

function load(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const m = j.snapshot.meta, nf = m.node_fields, ef = m.edge_fields, NF = nf.length, EF = ef.length;
  const types = m.node_types[0], etypes = m.edge_types[0];
  const iT = nf.indexOf('type'), iN = nf.indexOf('name'), iS = nf.indexOf('self_size'), iE = nf.indexOf('edge_count'), iId = nf.indexOf('id');
  const eT = ef.indexOf('type'), eN = ef.indexOf('name_or_index'), eTo = ef.indexOf('to_node');
  const { nodes, edges, strings } = j;
  const agg = new Map();
  const n = nodes.length / NF;
  const key = (i) => types[nodes[i * NF + iT]] + ':' + String(strings[nodes[i * NF + iN]]).slice(0, 60);
  for (let i = 0; i < n; i++) {
    const k = key(i), a = agg.get(k) || { c: 0, s: 0 };
    a.c++; a.s += nodes[i * NF + iS]; agg.set(k, a);
  }
  return { agg, j, NF, EF, iT, iN, iE, iId, eT, eN, eTo, types, etypes, key, n };
}

function retainerPath(S, want) {
  // reverse edges once, then walk up from one node of the wanted key (shortest-ish: first non-weak retainer)
  const { j, NF, EF, iE, eT, eN, eTo, etypes, key, n } = S, { nodes, edges, strings } = j;
  const first = new Uint32Array(n);
  let e = 0; for (let i = 0; i < n; i++) { first[i] = e; e += nodes[i * NF + iE] * EF; }
  const rev = new Map();
  for (let i = 0; i < n; i++) {
    const c = nodes[i * NF + iE];
    for (let k = 0; k < c; k++) {
      const ei = first[i] + k * EF, t = etypes[edges[ei + eT]];
      if (t === 'weak' || t === 'shortcut') continue;
      const to = edges[ei + eTo] / NF;
      if (!rev.has(to)) rev.set(to, []);
      rev.get(to).push([i, t === 'element' || t === 'hidden' ? '[' + edges[ei + eN] + ']' : String(strings[edges[ei + eN]])]);
    }
  }
  let at = -1; for (let i = n - 1; i >= 0; i--) if (key(i) === want) { at = i; break; }
  const out = []; const seen = new Set();
  for (let d = 0; d < 14 && at >= 0; d++) {
    seen.add(at);
    const r = (rev.get(at) || []).find(([p]) => !seen.has(p));
    if (!r) break;
    out.push(key(r[0]) + ' .' + r[1]);
    at = r[0];
  }
  return out;
}

const [A, B, TOP] = process.argv.slice(2);
const a = load(A), b = load(B);
const rows = [];
for (const [k, v] of b.agg) { const o = a.agg.get(k) || { c: 0, s: 0 }; rows.push([k, v.c - o.c, v.s - o.s, v.c, v.s]); }
const tot = (S) => [...S.agg.values()].reduce((x, v) => x + v.s, 0);
console.log(`self size total: ${(tot(a) / 1048576).toFixed(1)} MB -> ${(tot(b) / 1048576).toFixed(1)} MB`);
rows.sort((x, y) => y[2] - x[2]);
for (const r of rows.slice(0, +(TOP || 25))) console.log(`${(r[2] / 1048576).toFixed(2).padStart(7)} MB ${String(r[1]).padStart(8)} objs  now ${r[3]} / ${(r[4] / 1048576).toFixed(1)} MB  ${r[0]}`);
if (process.env.PATHS) for (const r of rows.slice(0, +process.env.PATHS)) console.log('\nretainers of', r[0], '\n  ' + retainerPath(b, r[0]).join('\n  '));
