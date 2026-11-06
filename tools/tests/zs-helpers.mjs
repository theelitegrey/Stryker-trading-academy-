// Shared helpers for the Zscript engine tests (node tools/tests/zs-*.test.mjs).
import assert from 'node:assert/strict';
import { compile, run, Session } from '../../assets/zs/index.js';

let passed = 0, failed = 0;
const fails = [];
export function t(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; fails.push(name + ': ' + (e && e.message ? e.message.split('\n').slice(0, 6).join(' | ') : e)); }
}
export function done(file) {
  for (const f of fails) console.log('FAIL', f);
  console.log(`${file}: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
  return { passed, failed };
}

// Deterministic bars (random walk). seed -> same bars every time.
export function makeBars(n, seed = 1, tfMs = 60000, t0 = Date.UTC(2026, 0, 5, 0, 0)) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const b = { time: [], open: [], high: [], low: [], close: [], volume: [] };
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p; p = Math.max(1, p + (rnd() - 0.5) * 2);
    b.time.push(t0 + i * tfMs); b.open.push(o); b.close.push(p);
    b.high.push(Math.max(o, p) + rnd()); b.low.push(Math.min(o, p) - rnd());
    b.volume.push(Math.round(100 + rnd() * 900));
  }
  return b;
}
export const H = '//@zscript 1\nindicator("t")\n';
export function comp(body, header = H) { return compile(header + body); }
export function codes(body, header = H) { return comp(body, header).diagnostics.map((d) => d.code); }
export function errCodes(body, header = H) { return comp(body, header).diagnostics.filter((d) => d.severity === 'error').map((d) => d.code); }
export function exec(body, opts = {}) {
  const r = comp(body, opts.header);
  if (!r.ok) throw new Error('compile failed: ' + r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.line + ':' + d.col + ' ' + d.code + ' ' + d.message).join('; '));
  return run(r.program, Object.assign({ bars: opts.bars || makeBars(opts.n || 50), timeframe: '1', symbol: { ticker: 'TEST', tickerid: 'X:TEST', mintick: 0.25 } }, opts));
}
// values of plot `i` (default the first)
export function vals(body, opts = {}, i = 0) {
  const o = exec(body, opts);
  if (!o.ok) throw new Error('run failed: ' + o.error.code + ' ' + o.error.message + ' @' + o.error.line + ':' + o.error.col);
  return Array.from(o.plots[i].values);
}
export function last(body, opts = {}) { const v = vals(body, opts); return v[v.length - 1]; }
export function near(a, b, eps = 1e-9, msg = '') {
  if (Number.isNaN(a) && Number.isNaN(b)) return;
  const tol = eps * Math.max(1, Math.abs(b));
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg} expected ${b}, got ${a}`);
}
export function nearArr(a, b, eps = 1e-9, msg = '') {
  assert.equal(a.length, b.length, msg + ' length');
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = Number.isFinite(b[i]) ? b[i] : NaN;
    if (Number.isNaN(x) !== Number.isNaN(y)) throw new Error(`${msg} [${i}] expected ${y}, got ${x}`);
    if (!Number.isNaN(x)) near(x, y, eps, `${msg} [${i}]`);
  }
}
export { assert, compile, run, Session };
