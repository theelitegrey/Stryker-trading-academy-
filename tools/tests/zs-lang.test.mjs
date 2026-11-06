// Zscript language tests: lexer, parser, checker, diagnostics.  node tools/tests/zs-lang.test.mjs
import { t, done, comp, codes, errCodes, H, assert, compile } from './zs-helpers.mjs';
import { lex } from '../../assets/zs/lexer.js';
import { parse } from '../../assets/zs/parser.js';
import { catalogJSON, FUNCTIONS } from '../../assets/zs/catalog.js';

const has = (body, code) => { const c = codes(body); assert.ok(c.includes(code), `expected ${code}, got [${c.join(',')}]`); };
const clean = (body) => { const c = errCodes(body); assert.deepEqual(c, [], `expected no errors, got [${c.join(',')}] ` + comp(body).diagnostics.map((d) => d.message).join(' / ')); };
const diag0 = (body) => comp(body).diagnostics.find((d) => d.severity === 'error');

// ---------- lexer ----------
const toks = (s) => lex(s).toks.filter((x) => !['nl', 'eof', 'indent', 'dedent'].includes(x.t)).map((x) => x.t + ':' + x.v);
t('lex ints', () => assert.deepEqual(toks('12 0 1_000'), ['num:12', 'num:0', 'num:1000']));
t('lex floats', () => assert.deepEqual(toks('1.5 .5 2. 1e3 1.5e-2'), ['num:1.5', 'num:0.5', 'num:2', 'num:1000', 'num:0.015']));
t('lex int flag', () => { const k = lex('3 3.0').toks; assert.equal(k[0].int, true); assert.equal(k[1].int, false); });
t('lex strings both quotes', () => assert.deepEqual(toks(`"a" 'b'`), ['str:a', 'str:b']));
t('lex string escapes', () => assert.deepEqual(toks('"a\\nb\\"c"'), ['str:a\nb"c']));
t('lex unterminated string', () => assert.ok(lex('"abc').diags.some((d) => d.code === 'E102')));
t('lex color 6', () => assert.deepEqual(toks('#FF0000'), ['color:#ff0000ff']));
t('lex color 8', () => assert.deepEqual(toks('#ff000080'), ['color:#ff000080']));
t('lex bad color', () => assert.ok(lex('#ff00').diags.some((d) => d.code === 'E103')));
t('lex keywords', () => assert.deepEqual(toks('if else and or not var varip na true'), ['kw:if', 'kw:else', 'kw:and', 'kw:or', 'kw:not', 'kw:var', 'kw:varip', 'kw:na', 'kw:true']));
t('lex two-char ops', () => assert.deepEqual(toks(':= += -= *= /= %= == != <= >= =>'), [':=', '+=', '-=', '*=', '/=', '%=', '==', '!=', '<=', '>=', '=>'].map((x) => 'op:' + x)));
t('lex comment', () => assert.deepEqual(toks('a // b c'), ['id:a']));
t('lex bad char', () => assert.ok(lex('a $ b').diags.some((d) => d.code === 'E101')));
t('lex bad number 1x', () => assert.ok(lex('12abc').diags.some((d) => d.code === 'E104')));
t('lex indent/dedent', () => { const k = lex('if a\n    b\nc').toks.map((x) => x.t); assert.deepEqual(k, ['kw', 'id', 'nl', 'indent', 'id', 'nl', 'dedent', 'id', 'nl', 'eof']); });
t('lex tab indent', () => { const k = lex('if a\n\tb').toks.map((x) => x.t); assert.ok(k.includes('indent')); });
t('lex bad dedent', () => assert.ok(lex('if a\n        b\n    c').diags.some((d) => d.code === 'E105')));
t('lex paren continuation', () => { const k = lex('f(1,\n2)').toks.filter((x) => x.t === 'nl').length; assert.equal(k, 1); });
t('lex operator continuation', () => { const k = lex('a = 1 +\n    2').toks.filter((x) => x.t === 'nl').length; assert.equal(k, 1); });
t('lex leading ? continuation', () => { const k = lex('a = c\n    ? 1\n    : 2').toks.filter((x) => x.t === 'nl').length; assert.equal(k, 1); });
t('lex header read', () => assert.equal(lex('//@zscript 1\nx').header.version, '1'));
t('lex header after blank', () => assert.equal(lex('\n\n//@zscript 1\n').header.version, '1'));
t('lex header missing', () => assert.equal(lex('x = 1').header.version, null));
t('lex CRLF', () => assert.deepEqual(toks('a\r\nb'), ['id:a', 'id:b']));
t('lex size limit', () => assert.ok(lex('a'.repeat(300 * 1024)).diags.some((d) => d.code === 'E106')));
t('lex positions', () => { const k = lex('ab  cd').toks; assert.equal(k[1].c, 5); assert.equal(k[1].l, 1); });
t('lex non-string input', () => assert.equal(lex(null).toks.at(-1).t, 'eof'));
t('lex unclosed paren does not swallow file', () => { const k = lex('a = (1 +\nb = 2\nc = 3').toks.filter((x) => x.t === 'nl').length; assert.ok(k >= 2); });

// ---------- header ----------
t('missing header E201', () => assert.ok(compile('indicator("x")').diagnostics.some((d) => d.code === 'E201')));
t('bad header text E201', () => assert.ok(compile('// zscript\nindicator("x")').diagnostics.some((d) => d.code === 'E201')));
t('wrong version E202', () => assert.ok(compile('//@zscript 2\nindicator("x")').diagnostics.some((d) => d.code === 'E202')));
t('header hint text', () => assert.match(compile('indicator("x")').diagnostics[0].hint, /\/\/@zscript 1/));
t('E201 has line 1', () => assert.equal(compile('indicator("x")').diagnostics[0].line, 1));
t('missing indicator E301', () => assert.ok(compile('//@zscript 1\nplot(close)').diagnostics.some((d) => d.code === 'E301')));
t('double indicator E302', () => has('indicator("y")', 'E302'));
t('empty script E301', () => assert.ok(compile('//@zscript 1\n').diagnostics.some((d) => d.code === 'E301')));

// ---------- parser: valid forms ----------
const okForms = {
  'assign': 'x = 1\nplot(x)',
  'typed decl': 'float x = 1\nplot(x)',
  'typed int': 'int x = 1\nplot(x)',
  'series qualifier': 'series float x = close\nplot(x)',
  'var': 'var x = 0\nx += 1\nplot(x)',
  'varip': 'varip x = 0\nx += 1\nplot(x)',
  'var typed': 'var float x = na\nx := close\nplot(x)',
  'reassign ops': 'x = 1.0\nx += 1\nx -= 1\nx *= 2\nx /= 2\nx %= 5\nplot(x)',
  'ternary': 'plot(close > open ? 1 : 0)',
  'nested ternary': 'plot(close > open ? 1 : close < open ? -1 : 0)',
  'multiline ternary': 'x = close > open\n     ? 1\n     : 0\nplot(x)',
  'history': 'plot(close[1])',
  'history of expr': 'plot((close + open)[2])',
  'history of call': 'plot(ta.sma(close, 3)[1])',
  'if block': 'x = 0\nif close > open\n    x := 1\nplot(x)',
  'if else': 'x = 0\nif close > open\n    x := 1\nelse\n    x := 2\nplot(x)',
  'else if': 'x = 0\nif close > open\n    x := 1\nelse if close < open\n    x := 2\nelse\n    x := 3\nplot(x)',
  'if value': 'x = if close > open\n    1\nelse\n    2\nplot(x)',
  'for': 's = 0\nfor i = 0 to 9\n    s += i\nplot(s)',
  'for by': 's = 0\nfor i = 0 to 9 by 3\n    s += i\nplot(s)',
  'for down': 's = 0\nfor i = 9 to 0\n    s += i\nplot(s)',
  'for in': 'a = array.from(1, 2, 3)\ns = 0.0\nfor x in a\n    s += x\nplot(s)',
  'for [i,x] in': 'a = array.from(1, 2, 3)\ns = 0.0\nfor [i, x] in a\n    s += i * x\nplot(s)',
  'while': 'i = 0\nwhile i < 5\n    i += 1\nplot(i)',
  'break/continue': 's = 0\nfor i = 0 to 9\n    if i == 2\n        continue\n    if i == 5\n        break\n    s += i\nplot(s)',
  'switch subject': 'm = input.string("a", options=["a", "b"])\nx = switch m\n    "a" => 1\n    "b" => 2\n    => 0\nplot(x)',
  'switch no subject': 'x = switch\n    close > open => 1\n    => 0\nplot(x)',
  'switch block case': 'x = switch\n    close > open =>\n        y = 2\n        y * 2\n    => 0\nplot(x)',
  'func one line': 'f(a) => a * 2\nplot(f(close))',
  'func block': 'f(a, b) =>\n    c = a + b\n    c / 2\nplot(f(close, open))',
  'func default': 'f(a, b = 2) => a * b\nplot(f(close))',
  'func named arg': 'f(a, b = 2) => a * b\nplot(f(close, b = 3))',
  'func typed param': 'f(float a) => a * 2\nplot(f(close))',
  'func tuple': 'f() => [close, open]\n[a, b] = f()\nplot(a - b)',
  'tuple builtin': '[m, s, h] = ta.macd(close, 12, 26, 9)\nplot(m)\nplot(s)\nplot(h)',
  'tuple underscore': '[_, up, _] = ta.bb(close, 20, 2)\nplot(up)',
  'named args builtin': 'plot(close, title="c", color=color.red, linewidth=2)',
  'array generic': 'a = array.new<float>(3, 0)\nplot(a.size())',
  'map generic': 'm = map.new<string, float>()\nm.put("a", 1)\nplot(m.get("a"))',
  'array typed decl': 'array<float> a = array.new_float(0)\nplot(a.size())',
  'method chain arg': 'a = array.new_float(0)\na.push(close)\nplot(a.get(0))',
  'not': 'plot(not (close > open) ? 1 : 0)',
  'and or': 'plot(close > open and volume > 0 or false ? 1 : 0)',
  'unary minus': 'plot(-close)',
  'color literal': 'plot(close, color=#ff000080)',
  'comment lines': '// hi\nplot(close) // end',
  'blank lines in block': 'x = 0\nif true\n\n    x := 1\n\nplot(x)',
  'multiline call': 'plot(close,\n     title="x",\n     color=color.red)',
  'na literal': 'x = na\nplot(x)',
  'nz': 'plot(nz(close[1]))',
  'string concat': 'label.new(bar_index, close, "a" + str.tostring(close))\nplot(close)',
  'hline fill': 'h1 = hline(1)\nh2 = hline(2)\nfill(h1, h2)\nplot(close)',
  'plot fill': 'p1 = plot(high)\np2 = plot(low)\nfill(p1, p2, color=color.new(color.blue, 80))',
  'bgcolor': 'bgcolor(close > open ? color.green : na)\nplot(close)',
  'plotshape': 'plotshape(close > open, style=shape.triangleup, location=location.belowbar)',
  'alertcondition': 'alertcondition(close > open, "up", "Up!")\nplot(close)',
  'request.security': 'h = request.security("", "60", close)\nplot(h)',
  'request.security tuple': '[o, c] = request.security("", "60", [open, close])\nplot(c - o)',
  'input.source': 'src = input.source(close, "Src")\nplot(src)',
  'input options': 'm = input.string("EMA", "Type", options=["EMA", "SMA"])\nplot(m == "EMA" ? 1 : 0)',
  'all inputs': 'a = input.int(1)\nb = input.float(1.5)\nc = input.bool(true)\nd = input.color(color.red)\ne = input.timeframe("60")\nf = input.price(100)\ng = input("x")\nplot(a + b)',
  'book namespace': 'plot(book.imbalance(10))',
  'flow vars': 'plot(flow.delta)\nplot(flow.cvd)',
  'gex vars': 'plot(gex.callwall)\nplot(gex.level(0))',
  'opt': 'plot(opt.ivrank)\n[lo, hi] = opt.range("day")\nplot(hi - lo)',
  'barstate': 'plot(barstate.islast ? 1 : 0)',
  'ta.obv var': 'plot(ta.obv)',
  'ta.tr var': 'plot(ta.tr)',
  'math consts': 'plot(math.pi + math.e)',
  'timeframe vars': 'plot(timeframe.isintraday ? timeframe.multiplier : 0)',
  'syminfo': 'plot(syminfo.mintick)',
  'deep nesting ok': 'x = ((((((((((1))))))))))\nplot(x)',
  'table': 'var t = table.new(position.top_right, 2, 2)\ntable.cell(t, 0, 0, "a")\nplot(close)',
  'line box label': 'l = line.new(bar_index - 1, low, bar_index, high)\nb = box.new(bar_index - 1, high, bar_index, low)\nlb = label.new(bar_index, high, "x")\nplot(close)',
  'varip + var mix': 'var a = 0\nvarip b = 0\na += 1\nb += 1\nplot(a + b)',
  'int to float var': 'float x = 1\nx := 2\nplot(x)',
};
for (const [name, body] of Object.entries(okForms)) t('parses+checks: ' + name, () => clean(body));

// ---------- parser: errors ----------
t('missing ) E204', () => has('plot(close', 'E204'));
t('missing ] E204', () => has('plot(close[1)', 'E204'));
t('= in condition E209', () => has('if close = open\n    x = 1', 'E209'));
t('= in expr E209', () => has('plot(close) = 1', 'E209'));
t('no block after if E205', () => has('if close > open\nplot(close)', 'E205'));
t('no block after for E205', () => has('for i = 0 to 3\nplot(close)', 'E205'));
t('break outside loop E208', () => has('break', 'E208'));
t('continue outside loop E208', () => has('continue', 'E208'));
t('reserved word import E210', () => has('import x', 'E210'));
t('reserved word type E210', () => has('type Foo', 'E210'));
t('unexpected token E203', () => has('plot(,)', 'E203'));
t('for without to E203', () => has('for i = 0 3\n    x = 1', 'E203'));
t('error recovery: 3 errors on 3 lines', () => {
  const d = compile(H + 'a = (1 +\nb = ]\nc = )\nplot(close)').diagnostics.filter((x) => x.severity === 'error');
  assert.ok(d.length >= 2, 'got ' + d.length);
});
t('error recovery keeps parsing next lines', () => {
  const d = compile(H + 'x = )\nplot(foo)').diagnostics;
  assert.ok(d.some((e) => e.line === 3), 'later lines also parsed');
});
t('nested function def E319', () => { const r = parse('//@zscript 1\nf() =>\n    g() => 1\n    2'); assert.ok(r.diags.some((d) => d.code === 'E319')); });
t('nesting too deep E207', () => has('x = ' + '('.repeat(200) + '1' + ')'.repeat(200), 'E207'));
t('deep unary does not crash', () => has('x = ' + '-'.repeat(500) + '1', 'E207'));
t('switch default not last E206', () => has('x = switch\n    => 0\n    close > open => 1\nplot(x)', 'E206'));
t('error has line and col', () => { const d = diag0('plot(close'); assert.equal(d.line, 3); assert.ok(d.col >= 1); });
t('error message is text', () => assert.equal(typeof diag0('plot(close').message, 'string'));
t('max 50 parse errors', () => assert.ok(compile(H + 'x = )\n'.repeat(200)).diagnostics.length <= 60));

// ---------- checker ----------
t('unknown name E303', () => has('plot(clse)', 'E303'));
t('did you mean name', () => assert.match(diag0('plot(clse)').hint, /close/));
t('unknown function E304', () => has('plot(ta.emaa(close, 3))', 'E304'));
t('did you mean function', () => assert.match(diag0('plot(ta.emaa(close, 3))').hint, /ta\.ema/));
t('did you mean user function', () => assert.match(diag0('myfunc(a) => a\nplot(myfun(close))').hint, /myfunc/));
t('unknown member of namespace', () => assert.match(diag0('plot(color.redd)').hint, /color\.red/));
t('redeclare E305', () => has('x = 1\nx = 2\nplot(x)', 'E305'));
t('redeclare hint :=', () => assert.match(diag0('x = 1\nx = 2\nplot(x)').hint, /:=/));
t(':= before decl E306', () => has('x := 1', 'E306'));
t('arg count too many E307', () => has('plot(ta.sma(close, 3, 4))', 'E307'));
t('arg count too few E307', () => has('plot(ta.sma(close))', 'E307'));
t('unknown named arg E308', () => has('plot(close, colour=color.red)', 'E308'));
t('named arg did you mean', () => assert.match(diag0('plot(close, colour=color.red)').hint, /color/));
t('arg type E309', () => has('plot(ta.sma("a", 3))', 'E309'));
t('arg type color E309', () => has('plot(close, color=1)', 'E309'));
t('decl type E310', () => has('int x = "a"\nplot(close)', 'E310'));
t('reassign type E311', () => has('x = 1\nx := "a"\nplot(close)', 'E311'));
t('float to int var ok? no: E311', () => has('x = 1\nx := 1.5\nplot(x)', 'E311'));
t('op type E312 string minus', () => has('x = "a" - 1\nplot(close)', 'E312'));
t('op type E312 string+num', () => has('x = "a" + 1\nplot(close)', 'E312'));
t('op hint str.tostring', () => assert.match(diag0('x = "a" + 1\nplot(close)').hint, /str\.tostring/));
t('op type compare string<num', () => has('x = "a" < 1\nplot(close)', 'E312'));
t('condition type E313', () => has('if "a"\n    x = 1\nplot(close)', 'E313'));
t('tuple count E314', () => has('[a, b] = ta.macd(close, 12, 26, 9)\nplot(a)', 'E314'));
t('tuple from non-tuple E314', () => has('[a, b] = close\nplot(a)', 'E314'));
t('tuple to single var E314', () => has('x = ta.bb(close, 20, 2)\nplot(close)', 'E314'));
t('call non-function E315', () => has('x = 1\nplot(x())', 'E315'));
t('function used as value E315', () => has('plot(ta.ema)', 'E315'));
t('history on string ok', () => clean('s = "a"\nx = s[1]\nplot(close)'));
t('history needs number E316', () => has('plot(close["a"])', 'E316'));
t('assign builtin E317', () => has('close := 1', 'E317'));
t('assign loop var E317', () => has('for i = 0 to 3\n    i := 2\nplot(close)', 'E317'));
t('recursion E318', () => has('f(n) => n <= 0 ? 0 : f(n - 1)\nplot(f(3))', 'E318'));
t('mutual recursion E318', () => has('f(n) => g(n)\ng(n) => f(n)\nplot(f(3))', 'E318'));
t('method missing E320', () => has('a = array.new_float(0)\na.pushh(1)\nplot(close)', 'E320'));
t('method did you mean', () => assert.match(diag0('a = array.new_float(0)\na.pushh(1)\nplot(close)').hint, /push/));
t('method on number E320', () => has('x = close.push(1)\nplot(close)', 'E320'));
t('positional after named E321', () => has('plot(close, title="a", color.red)', 'E321'));
t('duplicate function E322', () => has('f() => 1\nf() => 2\nplot(f())', 'E322'));
t('branch type mismatch E323', () => has('x = close > open ? 1 : "a"\nplot(close)', 'E323'));
t('array history E324', () => has('a = array.new_float(0)\nx = a[1]\nplot(close)', 'E324'));
t('void assigned E326', () => has('x = plot(close) == 1 ? alert("a") : na', 'E326'));
t('void in arithmetic E326', () => has('x = 1 + alert("a")\nplot(close)', 'E326'));
t('reserved namespace as var E327', () => has('ta = 1\nplot(close)', 'E327'));
t('nested arrays E328', () => has('a = array.new<array<float>>(0)\nplot(close)', 'E328'));
t('non-literal indicator arg E329', () => has('x = 1\nindicator("x", overlay=x > 0)', 'E329') );
t('input not literal E330', () => has('x = 5\nlen = input.int(x)\nplot(close)', 'E330'));
t('input in block E330', () => has('if true\n    len = input.int(5)\nplot(close)', 'E330'));
t('plot in if E340', () => has('if close > open\n    plot(close)', 'E340'));
t('plot in function E340', () => has('f() => plot(close)\nf()', 'E340'));
t('plot in loop E340', () => has('for i = 0 to 2\n    plot(close)', 'E340'));
t('plot hint', () => assert.match(diag0('if close > open\n    plot(close)').hint, /cond \? value : na/));
t('too many plots E341', () => has(Array.from({ length: 70 }, () => 'plot(close)').join('\n'), 'E341'));
t('security uses script var E350', () => has('x = close * 2\nh = request.security("", "60", x)\nplot(h)', 'E350'));
t('security var hint', () => assert.match(diag0('x = close * 2\nh = request.security("", "60", x)\nplot(h)').hint, /function/));
t('security with function ok', () => clean('f() => close * 2\nh = request.security("", "60", f())\nplot(h)'));
t('security with input ok', () => clean('len = input.int(5)\nh = request.security("", "60", ta.sma(close, 5))\nplot(h)'));
t('security lookahead E351', () => has('h = request.security("", "60", close, lookahead=true)\nplot(h)', 'E351'));
t('security lookahead barmerge E351', () => has('h = request.security("", "60", close, lookahead=barmerge.lookahead_on)\nplot(h)', 'E351'));
t('security lookahead off ok', () => clean('h = request.security("", "60", close, lookahead=barmerge.lookahead_off)\nplot(h)'));
t('too many security E353', () => has(Array.from({ length: 17 }, (_, i) => `s${i} = request.security("", "60", close)`).join('\n') + '\nplot(close)', 'E353'));
t('security tf from input', () => clean('tf = input.timeframe("60")\nh = request.security("", tf, close)\nplot(h)'));
t('security tf not fixed E329', () => has('h = request.security("", str.tostring(close), close)\nplot(h)', 'E329'));
t('W101 ta in if', () => assert.ok(codes('x = 0.0\nif close > open\n    x := ta.ema(close, 3)\nplot(x)').includes('W101')));
t('W102 ta in loop', () => assert.ok(codes('x = 0.0\nfor i = 0 to 2\n    x := ta.sma(close, 3)\nplot(x)').includes('W102')));
t('W103 unused', () => assert.ok(codes('zz = 1\nplot(close)').includes('W103')));
t('warnings do not block', () => assert.equal(comp('zz = 1\nplot(close)').ok, true));
t('scope: block var invisible after', () => has('if true\n    y = 1\nplot(y)', 'E303'));
t('scope: shadow in block allowed', () => clean('x = 1\nif true\n    x = 2\n    plot2 = x\nplot(x)'));
t('scope: function cannot see globals? it can', () => clean('k = 2\nf(a) => a * k\nplot(f(close))'));
t('function default param type', () => clean('f(a, b = 1.5) => a + b\nplot(f(close))'));
t('user fn bad named arg E308', () => has('f(a) => a\nplot(f(b = 1))', 'E308'));
t('user fn too many args E307', () => has('f(a) => a\nplot(f(1, 2))', 'E307'));
t('user fn too few args E307', () => has('f(a, b) => a\nplot(f(1))', 'E307'));
t('user fn typed param mismatch E309', () => has('f(string a) => a\nx = f(1)\nplot(close)', 'E309'));
t('fn name collides with builtin E317', () => has('plot(a) => a\nplot(1)', 'E317'));
t('for-in over number E309', () => has('for x in 5\n    y = x\nplot(close)', 'E309'));
t('array elem type flows', () => has('a = array.from("a", "b")\nx = a.get(0) + 1\nplot(close)', 'E312'));
t('map value type flows', () => clean('m = map.new<string, float>()\nx = m.get("a") + 1\nplot(x)'));
t('fill wrong args E309', () => has('fill(1, 2)', 'E309'));
t('fill mixed plot/hline E309', () => has('p = plot(close)\nh = hline(1)\nfill(p, h)', 'E309'));
t('100+ errors stop cleanly', () => { const r = compile(H + 'plot(zz)\n'.repeat(300)); assert.equal(r.ok, false); });

// ---------- meta ----------
t('meta title/overlay', () => { const m = compile('//@zscript 1\nindicator("My EMA", overlay=true)\nplot(close)').meta; assert.equal(m.title, 'My EMA'); assert.equal(m.overlay, true); });
t('meta inputs', () => {
  const m = comp('len = input.int(14, "Length", minval=1, maxval=100, group="G")\nplot(close)').meta;
  assert.deepEqual([m.inputs[0].kind, m.inputs[0].defval, m.inputs[0].title, m.inputs[0].minval, m.inputs[0].maxval, m.inputs[0].group], ['int', 14, 'Length', 1, 100, 'G']);
});
t('meta source input', () => { const m = comp('s = input.source(hl2, "S")\nplot(s)').meta; assert.equal(m.inputs[0].kind, 'source'); assert.equal(m.inputs[0].defval, 'hl2'); });
t('meta generic input bool', () => assert.equal(comp('b = input(true)\nplot(close)').meta.inputs[0].kind, 'bool'));
t('meta generic input color', () => assert.equal(comp('c = input(#ff0000)\nplot(close)').meta.inputs[0].kind, 'color'));
t('meta needs', () => { const m = comp('plot(book.imbalance(5) + flow.delta)').meta; assert.equal(m.needs.book, true); assert.equal(m.needs.flow, true); assert.equal(m.needs.gex, false); });
t('meta plots', () => { const m = comp('plot(close, "C")\nplotshape(true, "S")').meta; assert.deepEqual(m.plots.map((p) => [p.title, p.kind]), [['C', 'line'], ['S', 'shape']]); });
t('meta plot style', () => assert.equal(comp('plot(close, style=plot.style_histogram)').meta.plots[0].kind, 'histogram'));
t('meta alertconditions', () => assert.deepEqual(comp('alertcondition(true, "T", "M")\nplot(close)').meta.alertconditions[0], { id: 0, title: 'T', message: 'M' }));
t('meta securities', () => assert.equal(comp('h = request.security("BINANCE:BTCUSDT", "D", close)\nplot(h)').meta.securities[0].symbol.v, 'BINANCE:BTCUSDT'));
t('max_bars_back clamps', () => assert.equal(compile('//@zscript 1\nindicator("x", max_bars_back=999999)\nplot(close)').program.limits.maxBarsBack, 5000));
t('max_bars_back from literal history', () => assert.equal(comp('plot(close[1200])').program.limits.maxBarsBack, 1200));
t('drawing limits clamp', () => { const p = compile('//@zscript 1\nindicator("x", max_labels_count=9999, max_tables_count=99)\nplot(close)').program; assert.equal(p.limits.labels, 500); assert.equal(p.limits.tables, 20); });

// ---------- program format: no identifiers ----------
t('program has no member identifiers', () => {
  const r = comp('mySecretVariableName = ta.ema(close, 9)\nhelperFnName(q) => q * 2\nplot(helperFnName(mySecretVariableName), "Shown")');
  const s = JSON.stringify(r.program);
  assert.ok(!s.includes('mySecretVariableName') && !s.includes('helperFnName'));
  assert.ok(s.includes('Shown'));
});
t('program is JSON-safe', () => { const r = comp('plot(ta.rsi(close, 14))'); assert.deepEqual(JSON.parse(JSON.stringify(r.program)), r.program); });
t('program has no source text', () => { const r = comp('// a comment that must not leak\nplot(close)'); assert.ok(!JSON.stringify(r.program).includes('must not leak')); });

// ---------- catalog ----------
const cat = catalogJSON();
t('catalog has 250+ functions', () => assert.ok(cat.functions.length >= 250, cat.functions.length));
t('catalog every function has doc', () => assert.ok(cat.functions.every((f) => f.doc && f.doc.length > 5)));
t('catalog every variable has doc', () => assert.ok(cat.variables.every((f) => f.doc && f.doc.length > 3)));
t('catalog has all SPEC ta names', () => {
  for (const n of ['sma', 'ema', 'rma', 'wma', 'vwma', 'hma', 'rsi', 'macd', 'stoch', 'atr', 'tr', 'bb', 'kc', 'cci', 'mfi', 'vwap', 'crossover', 'crossunder', 'highest', 'lowest', 'pivothigh', 'pivotlow', 'change', 'cum', 'valuewhen', 'barssince', 'stdev', 'correlation', 'linreg', 'supertrend']) assert.ok(FUNCTIONS.has('ta.' + n), n);
});
t('catalog has data namespaces', () => { for (const n of ['book.bid', 'book.ask', 'book.bidsize', 'book.asksize', 'book.depth', 'book.imbalance', 'book.wall', 'book.heat', 'flow.bigtrades', 'flow.footprint', 'gex.level', 'opt.node', 'opt.range']) assert.ok(FUNCTIONS.has(n), n); });
t('catalog has no rival names', () => assert.ok(!/pine|tradingview/i.test(JSON.stringify(cat))));
const { BUILTINS } = await import('../../assets/zs/builtins.js');
t('every catalog function implemented (sync)', () => {
  const missing = cat.functions.map((f) => f.name).filter((n) => !['indicator', 'request.security', 'input'].includes(n) && !n.startsWith('input.') && !BUILTINS[n]);
  assert.deepEqual(missing, []);
});

done('zs-lang');
