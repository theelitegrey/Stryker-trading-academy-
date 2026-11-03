// Formula symbols: parser (good + bad input) and bar alignment.  node tools/tests/formula.test.mjs
import assert from 'node:assert/strict';
import { parseFormula, combineBars, canonicalSymbol, evalAst, MAX_CHARS } from '../../assets/chart-formula-core.js';
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const ev = (s, vals) => { const r = parseFormula(s); assert.ok(r.ok, s); return evalAst(r.ast, vals); };

// good input
assert.deepEqual(parseFormula('ES1!-NQ1!*0.25').symbols, ['ES1!', 'NQ1!']);
assert.equal(ev('ES1!-NQ1!*0.25', { 'ES1!': 100, 'NQ1!': 40 }), 90); ok('precedence: * before -');
assert.equal(ev('(AAPL+MSFT)/2', { AAPL: 10, MSFT: 20 }), 15); ok('brackets');
assert.equal(ev('SPY/QQQ', { SPY: 1, QQQ: 4 }), 0.25); ok('divide');
assert.equal(ev('A-B-C', { A: 10, B: 3, C: 2 }), 5); assert.equal(ev('A/B/C', { A: 8, B: 2, C: 2 }), 2); ok('left associative');
assert.equal(ev('-A+B', { A: 1, B: 3 }), 2); assert.equal(ev('A--B', { A: 1, B: 3 }), 4); ok('unary minus');
assert.deepEqual(parseFormula('btcusdt/ethusdt').symbols, ['BTCUSDT', 'ETHUSDT']); ok('case folded');
assert.deepEqual(parseFormula('BINANCE:BTCUSDT / 2*COINBASE:ETH').symbols, ['BINANCE:BTCUSDT', 'COINBASE:ETH']); ok('venue prefix');
assert.equal(parseFormula('6E1!/ES1!').ok, true); assert.equal(parseFormula('BRK.B/SPY').ok, true); ok('6E1! and BRK.B');
assert.equal(parseFormula(' ES1! - ( NQ1! * 0.25 ) ').text, 'ES1!-NQ1!*0.25'); ok('canonical text drops spaces and spare brackets');
assert.equal(parseFormula('A-(B-C)').text, 'A-(B-C)'); assert.equal(parseFormula('A/(B*C)').text, 'A/(B*C)'); assert.equal(parseFormula('(A+B)*C').text, '(A+B)*C'); ok('needed brackets kept');
assert.equal(canonicalSymbol('formula: es1! - nq1! '), 'formula:ES1!-NQ1!'); assert.equal(canonicalSymbol('formula:ES1!'), null); ok('canonicalSymbol');
assert.equal(parseFormula('A+B+C+D').ok, true); assert.equal(parseFormula('A/A+B').symbols.length, 2); ok('4 symbols ok, repeats counted once');

// bad input: never throws, always {ok:false}
const bad = {
  '': 'empty', '   ': 'empty', 'A': 'too_few', 'A*2': 'too_few', '5+5': 'too_few',
  'A+B+C+D+E': 'too_many', 'A+': 'syntax', '+': 'syntax', '*A+B': 'syntax', 'A B': 'syntax', 'A++B*': 'syntax', 'A+B)': 'syntax', '(A+B': 'syntax',
  '()': 'syntax', '(A+B)(C)': 'syntax', 'A+B;': 'bad_char', 'A^2+B': 'bad_char', 'A,B': 'bad_char', 'alert(1)': 'syntax',
  'constructor.constructor("x")()': 'bad_char', 'A+B//': 'syntax', '1.2.3+A+B': 'bad_token', 'A+B\n+C': 'bad_char', '$A+B': 'bad_char',
  'A!!+B': 'bad_char', 'A+B%2': 'bad_char', 'A=B': 'bad_char', '`A`+B': 'bad_char', 'A+B+"x"': 'bad_char', ':A+B': 'bad_char'
};
for (const [s, code] of Object.entries(bad)) {
  const r = parseFormula(s); assert.equal(r.ok, false, JSON.stringify(s)); assert.ok(r.message, s);
  if (code === 'syntax' && !['constructor', 'alert'].some((x) => s.startsWith(x))) assert.equal(r.code, code, JSON.stringify(s));
  else if (code !== 'syntax') assert.equal(r.code, code, JSON.stringify(s));
}
ok('bad input rejected with a message (' + Object.keys(bad).length + ' cases)');
assert.equal(parseFormula('A+'.repeat(40) + 'B').code, 'too_long'); assert.equal(parseFormula('A'.repeat(MAX_CHARS + 1)).code, 'too_long');
assert.equal(parseFormula('A+B' + ' '.repeat(MAX_CHARS)).ok, true);   // trimmed first
ok('64 character limit');
assert.equal(parseFormula('('.repeat(30) + 'A+B' + ')'.repeat(30)).ok, false); assert.equal(parseFormula('-'.repeat(40) + 'A+B').ok, false); ok('depth limit, no stack overflow');
assert.equal(parseFormula(null).ok, false); assert.equal(parseFormula(undefined).ok, false); assert.equal(parseFormula(12).ok, false); ok('non-strings');
assert.equal(typeof globalThis.pwned, 'undefined'); ok('nothing executed');

// bar alignment
const bar = (time, o, h, l, c) => ({ time, open: o, high: h, low: l, close: c, volume: 5 });
const A = [bar(1, 10, 12, 9, 11), bar(2, 11, 13, 10, 12), bar(3, 12, 14, 11, 13), bar(5, 1, 1, 1, 1)];
const B = [bar(2, 2, 3, 1, 2), bar(3, 2, 2, 2, 2), bar(4, 4, 4, 4, 4), bar(5, 0, 0, 0, 0)];
const p = parseFormula('A-B*2');
const out = combineBars(p.ast, p.symbols, { A, B });
assert.deepEqual(out.map((b) => b.time), [2, 3, 5]); ok('only times every symbol has (t=1 and t=4 skipped)');
// field by field: open 11-2*2=7, high 13-2*3=7, low 10-2*1=8, close 12-2*2=8 -> high/low swapped, so repaired to a valid candle
assert.deepEqual(out[0], { time: 2, open: 7, high: 8, low: 7, close: 8, volume: 0 }); ok('O/H/L/C each computed, then kept a valid candle; volume 0');
const z = parseFormula('A/B'); const zb = combineBars(z.ast, z.symbols, { A: [bar(1, 1, 1, 1, 1), bar(2, 1, 1, 1, 1)], B: [bar(1, 0, 1, 1, 1), bar(2, 1, 1, 1, 1)] });
assert.deepEqual(zb.map((b) => b.time), [2]); ok('divide by zero bar skipped');
assert.deepEqual(combineBars(p.ast, p.symbols, { A, B: [] }), []); assert.deepEqual(combineBars(p.ast, p.symbols, {}), []); ok('missing series -> no bars');
console.log(n + ' groups passed');
