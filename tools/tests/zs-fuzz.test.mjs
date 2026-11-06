// Zscript parser/compiler fuzz: 10,000+ random and mutated inputs; none may crash, hang,
// or throw out of compile(); every diagnostic must be well formed. Programs that compile
// are also run on a few bars (runtime errors are fine, crashes are not).
//   node tools/tests/zs-fuzz.test.mjs            (ZS_FUZZ_N=50000 for a longer run)
import { t, done, makeBars, assert, compile, run } from './zs-helpers.mjs';
import { lex } from '../../assets/zs/lexer.js';

const N = Number(process.env.ZS_FUZZ_N) || 10000;
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ATOMS = ['close', 'open', 'high', 'x', 'y', 'f', 'a', '1', '2.5', '0', 'na', 'true', '"s"', "'q'", '#ff0000', 'ta.ema(close, 9)', 'ta.rsi', 'math.max', 'array.new_float(3, 0)',
  'plot', 'input.int(5)', 'bar_index', 'book.bid(0)', 'flow.delta', 'gex.flip', 'opt.range("day")', 'color.red', 'str.tostring', 'label.new', 'request.security', 'constructor', '__proto__', 'prototype',
  'self', 'fetch', 'importScripts', 'globalThis', 'eval', 'Function', 'this', 'window', 'toString', 'valueOf', 'hasOwnProperty'];
const PUNCT = ['(', ')', '[', ']', ',', '.', '=', ':=', '+=', '?', ':', '=>', '+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=', 'and', 'or', 'not', 'if', 'else', 'for', 'to', 'by', 'in', 'while', 'switch', 'var', 'varip', 'break', 'continue', '\n', '\n    ', '\n        ', '\t', '//', '"', "'", '#', '<float>', '\\', '\u0000', '\u2028', '😀', '$', '@', '`'];
const VALID = [
  'plot(ta.ema(close, 9))',
  'len = input.int(14)\nr = ta.rsi(close, len)\nplot(r)\nhline(70)\nhline(30)',
  'f(a, b = 2) =>\n    c = a * b\n    c + 1\nplot(f(close))',
  'var c = 0\nif close > open\n    c += 1\nelse\n    c -= 1\nplot(c)',
  '[m, s, h] = ta.macd(close, 12, 26, 9)\nplot(m)\nplot(s)\nplot(h, style=plot.style_histogram)',
  's = 0.0\nfor i = 0 to 9\n    s += close[i]\nplot(s / 10)',
  'x = switch\n    close > open => 1\n    => -1\nplot(x)',
  'var a = array.new_float(0)\na.push(close)\nif a.size() > 5\n    a.shift()\nplot(a.avg())',
  'h = request.security("", "60", close)\nplot(h)',
  'if barstate.islast\n    label.new(bar_index, high, str.tostring(close, "#.##"))\nplot(close)',
];
const H = '//@zscript 1\nindicator("f")\n';

function randomTokens() { let s = ''; const n = 1 + Math.floor(rnd() * 40); for (let i = 0; i < n; i++) s += (rnd() < 0.5 ? pick(ATOMS) : pick(PUNCT)) + (rnd() < 0.6 ? ' ' : ''); return s; }
function randomChars() { let s = ''; const n = Math.floor(rnd() * 120); for (let i = 0; i < n; i++) s += String.fromCharCode(rnd() < 0.9 ? 9 + Math.floor(rnd() * 118) : Math.floor(rnd() * 0xffff)); return s; }
function mutate(src) {
  const a = src.split('');
  const k = 1 + Math.floor(rnd() * 6);
  for (let i = 0; i < k; i++) {
    const p = Math.floor(rnd() * (a.length + 1)), r = rnd();
    if (r < 0.33) a.splice(p, 1);
    else if (r < 0.66) a.splice(p, 0, pick(PUNCT));
    else a.splice(p, 0, ...pick(ATOMS).split(''));
  }
  return a.join('');
}
function deep() { const d = 10 + Math.floor(rnd() * 400); const k = pick(['(', '[', '-', 'not ', 'f(', 'a ? ', 'if x\n' + ' '.repeat(4)]); return 'x = ' + k.repeat(d) + '1' + (k === '(' ? ')'.repeat(d) : k === '[' ? ']'.repeat(d) : k === 'f(' ? ')'.repeat(d) : ''); }

const bars = makeBars(30, 3);
const stats = { compiled: 0, ran: 0, maxMs: 0 };
function check(src, tag) {
  const t0 = Date.now();
  let r;
  try { r = compile(src); } catch (e) { throw new Error(`${tag}: compile threw ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e}\n--- input ---\n${JSON.stringify(src)}`); }
  const ms = Date.now() - t0; stats.maxMs = Math.max(stats.maxMs, ms);
  if (ms > 2000) throw new Error(`${tag}: compile took ${ms} ms on ${JSON.stringify(src).slice(0, 300)}`);
  if (!r || typeof r.ok !== 'boolean' || !Array.isArray(r.diagnostics)) throw new Error(tag + ': bad result shape');
  for (const d of r.diagnostics) {
    if (!/^[EW]\d{3}$/.test(d.code) || !Number.isInteger(d.line) || !Number.isInteger(d.col) || d.line < 1 || d.col < 1 || typeof d.message !== 'string' || !d.message || /\{\w+\}|undefined/.test(d.message))
      throw new Error(`${tag}: bad diagnostic ${JSON.stringify(d)} for ${JSON.stringify(src).slice(0, 200)}`);
  }
  if (r.ok !== !r.diagnostics.some((d) => d.severity === 'error')) throw new Error(tag + ': ok flag disagrees with diagnostics');
  if (r.ok) {
    stats.compiled++;
    let o;
    try { o = run(r.program, { bars, timeframe: '1', limitsOverride: { firstRunMs: 2000 } }); } catch (e) { throw new Error(`${tag}: run threw ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e} for ${JSON.stringify(src)}`); }
    if (!o || typeof o.ok !== 'boolean') throw new Error(tag + ': bad run output');
    if (!o.ok && (!o.error || !/^E\d{3}$/.test(o.error.code))) throw new Error(tag + ': bad runtime error ' + JSON.stringify(o.error));
    if (!o.ok && o.error.code === 'E499') throw new Error(`${tag}: internal error ${o.error.message} for ${JSON.stringify(src)}`);
    stats.ran++;
  }
}

let fuzzErr = null, count = 0;
const tStart = Date.now();
try {
  for (let i = 0; i < N; i++) {
    const r = i % 10;
    let src;
    if (r < 3) src = H + randomTokens();
    else if (r < 7) src = H + mutate(pick(VALID));
    else if (r < 8) src = (rnd() < 0.5 ? H : '') + randomChars();
    else if (r < 9) src = H + deep();
    else src = mutate(H + pick(VALID) + '\n' + pick(VALID));
    check(src, 'case ' + i);
    count++;
  }
  for (let i = 0; i < 500; i++) { const s = randomChars() + randomTokens(); try { lex(s); } catch (e) { throw new Error('lex threw on ' + JSON.stringify(s)); } count++; }
} catch (e) { fuzzErr = e; }

t(`fuzz ${N} compile+run inputs, no crash/hang`, () => { if (fuzzErr) throw fuzzErr; assert.ok(count >= N); });
t('fuzz: some inputs compiled and ran', () => assert.ok(stats.ran >= 100, 'ran ' + stats.ran));
t('fuzz: slowest compile under 2 s', () => assert.ok(stats.maxMs < 2000, stats.maxMs));
t('fuzz: all valid seeds compile', () => { for (const v of VALID) assert.equal(compile(H + v).ok, true, v); });
console.log(`fuzz: ${count} inputs, ${stats.compiled} compiled, ${stats.ran} ran, slowest compile ${stats.maxMs} ms, total ${Date.now() - tStart} ms`);
done('zs-fuzz');
