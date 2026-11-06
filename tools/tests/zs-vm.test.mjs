// Zscript VM tests: series semantics, outputs, drawings, data namespaces, request.security,
// live updates.   node tools/tests/zs-vm.test.mjs
import { t, done, vals, last, exec, makeBars, near, nearArr, assert, comp, Session, H } from './zs-helpers.mjs';

const B = makeBars(40, 11);
const C = B.close;
const v = (body, o) => vals(body, Object.assign({ bars: B }, o || {}));

// ---------- series / var / history ----------
t('plain var re-made each bar', () => assert.deepEqual(v('x = 0\nx += 1\nplot(x)').slice(0, 3), [1, 1, 1]));
t('var keeps value', () => assert.deepEqual(v('var x = 0\nx += 1\nplot(x)').slice(0, 4), [1, 2, 3, 4]));
t('var init once even if expensive', () => assert.deepEqual(v('var x = bar_index * 10\nplot(x)').slice(0, 3), [0, 0, 0]));
t('var inside if inits first time reached', () => { const r = v('y = 0.0\nif bar_index >= 5\n    var z = bar_index\n    y := z\nplot(y)'); assert.equal(r[4], 0); assert.equal(r[5], 5); assert.equal(r[9], 5); });
t('varip keeps value', () => assert.equal(last('varip x = 0\nx += 1\nplot(x)', { bars: B }), 40));
t('history x[1]', () => { const r = v('plot(close[1])'); assert.ok(Number.isNaN(r[0])); near(r[1], C[0]); near(r[39], C[38]); });
t('history x[0] = x', () => nearArr(v('plot(close[0])'), C));
t('history beyond first bar is na', () => assert.ok(Number.isNaN(v('plot(close[100])')[39])));
t('history of user var', () => { const r = v('x = bar_index * 2\nplot(x[3])'); assert.ok(Number.isNaN(r[2])); assert.equal(r[3], 0); assert.equal(r[10], 14); });
t('history of var var', () => { const r = v('var c = 0\nc += 1\nplot(c[1])'); assert.equal(r[5], 5); });
t('history of expression', () => { const r = v('plot((close - open)[2])'); near(r[10], C[8] - B.open[8]); });
t('history of ta call', () => { const a = v('plot(ta.sma(close, 3))'), b = v('plot(ta.sma(close, 3)[1])'); near(b[10], a[9]); });
t('history with variable offset', () => { const r = v('n = bar_index % 2\nplot(close[n])'); near(r[11], C[10]); near(r[12], C[12]); });
t('history negative offset is na (no lookahead)', () => assert.ok(v('plot(close[-1])').every(Number.isNaN)));
t('history of user var negative is na', () => assert.ok(v('x = close\nplot(x[-2])').every(Number.isNaN)));
t('history float offset truncates', () => near(v('plot(close[1.9])')[5], C[4]));
t('history na offset is na', () => assert.ok(Number.isNaN(v('plot(close[na])')[5])));
t('history of block var on bars it did not run', () => { const r = v('x = 0.0\nif bar_index % 2 == 0\n    x := 1\nplot(x[1])'); assert.equal(r[1], 1); assert.equal(r[2], 0); });
t('history beyond max_bars_back E402', () => { const o = exec('n = 600\nplot(close[n])', { n: 700 }); assert.equal(o.ok, false); assert.equal(o.error.code, 'E402'); assert.match(o.error.hint, /max_bars_back/); });
t('max_bars_back raised works', () => { const o = exec('n = 600\nplot(close[n])', { n: 700, header: '//@zscript 1\nindicator("t", max_bars_back=1000)\n' }); assert.equal(o.ok, true); });
t('time history', () => assert.equal(v('plot(time[1])')[3], B.time[2]));
t('bar_index history', () => assert.equal(v('plot(bar_index[2])')[7], 5));

// ---------- na rules ----------
t('na + 1 = na', () => assert.ok(Number.isNaN(v('plot(na + 1)')[0])));
t('na comparison false', () => assert.equal(v('plot(na > 1 ? 1 : 0)')[0], 0));
t('na == na false', () => assert.equal(v('x = close[100]\nplot(x == x ? 1 : 0)')[5], 0));
t('na(x)', () => assert.deepEqual(v('plot(na(close[1]) ? 1 : 0)').slice(0, 2), [1, 0]));
t('nz default 0', () => assert.equal(v('plot(nz(close[1]))')[0], 0));
t('nz replacement', () => assert.equal(v('plot(nz(close[1], -5))')[0], -5));
t('division by zero = na', () => assert.ok(Number.isNaN(v('plot(close / 0)')[3])));
t('mod by zero = na', () => assert.ok(Number.isNaN(v('plot(5 % 0)')[3])));
t('int division is float', () => assert.equal(v('plot(5 / 2)')[0], 2.5));
t('modulo', () => assert.equal(v('plot(-7 % 3)')[0], -1));
t('if on na is false', () => assert.equal(v('x = 0\nif close[100]\n    x := 1\nplot(x)')[5], 0));
t('na string', () => assert.equal(v('s = "a"\ns := na\nplot(na(s) ? 1 : 0)')[0], 1));
t('bool cast', () => assert.deepEqual(v('plot(bool(0) ? 1 : 0)\nplot(bool(2) ? 1 : 0)').slice(0, 1), [0]));
t('int() truncates', () => assert.equal(v('plot(int(-2.7))')[0], -2));
t('float(na) stays na', () => assert.ok(Number.isNaN(v('plot(float(na))')[0])));

// ---------- control flow ----------
t('if value', () => { const r = v('x = if close > open\n    1\nelse\n    -1\nplot(x)'); r.forEach((x, i) => assert.equal(x, C[i] > B.open[i] ? 1 : -1)); });
t('if no else value na', () => { const r = v('x = if bar_index > 100\n    1\nplot(x)'); assert.ok(Number.isNaN(r[0])); });
t('else if chain', () => assert.equal(v('x = if bar_index < 1\n    1\nelse if bar_index < 2\n    2\nelse\n    3\nplot(x)')[1], 2));
t('switch subject', () => assert.equal(v('m = "b"\nx = switch m\n    "a" => 1\n    "b" => 2\n    => 3\nplot(x)')[0], 2));
t('switch default', () => assert.equal(v('m = "z"\nx = switch m\n    "a" => 1\n    => 3\nplot(x)')[0], 3));
t('switch no match na', () => assert.ok(Number.isNaN(v('m = "z"\nx = switch m\n    "a" => 1\nplot(x)')[0])));
t('switch conditions', () => assert.equal(v('x = switch\n    bar_index == 0 => 10\n    => 20\nplot(x)')[0], 10));
t('for sum', () => assert.equal(v('s = 0\nfor i = 1 to 10\n    s += i\nplot(s)')[0], 55));
t('for by step', () => assert.equal(v('s = 0\nfor i = 0 to 10 by 5\n    s += i\nplot(s)')[0], 15));
t('for counts down', () => assert.equal(v('s = 0\nfor i = 3 to 1\n    s := s * 10 + i\nplot(s)')[0], 321));
t('for down with by', () => assert.equal(v('s = 0\nfor i = 10 to 0 by 5\n    s := s * 100 + i\nplot(s)')[0], 100500));
t('for single iteration', () => assert.equal(v('s = 0\nfor i = 4 to 4\n    s += 1\nplot(s)')[0], 1));
t('for value is last', () => assert.equal(v('x = for i = 1 to 3\n    i * 2\nplot(x)')[0], 6));
t('for break', () => assert.equal(v('s = 0\nfor i = 0 to 100\n    if i == 4\n        break\n    s += 1\nplot(s)')[0], 4));
t('for continue', () => assert.equal(v('s = 0\nfor i = 0 to 9\n    if i % 2 == 0\n        continue\n    s += i\nplot(s)')[0], 25));
t('nested loops break inner', () => assert.equal(v('s = 0\nfor i = 0 to 2\n    for j = 0 to 10\n        if j == 2\n            break\n        s += 1\nplot(s)')[0], 6));
t('while', () => assert.equal(v('i = 1\nwhile i < 100\n    i *= 2\nplot(i)')[0], 128));
t('while continue', () => assert.equal(v('i = 0\ns = 0\nwhile i < 6\n    i += 1\n    if i == 3\n        continue\n    s += i\nplot(s)')[0], 18));
t('for in sum', () => assert.equal(v('a = array.from(1, 2, 3, 4)\ns = 0.0\nfor x in a\n    s += x\nplot(s)')[0], 10));
t('for [i, x] in', () => assert.equal(v('a = array.from(5, 6)\ns = 0.0\nfor [i, x] in a\n    s += i * 10 + x\nplot(s)')[0], 21));
t('for in empty', () => assert.equal(v('a = array.new_float(0)\ns = 1\nfor x in a\n    s := 2\nplot(s)')[0], 1));
t('and short-circuits', () => assert.equal(v('a = array.new_float(0)\nx = a.size() > 0 and a.get(0) > 1 ? 1 : 0\nplot(x)')[0], 0));
t('or short-circuits', () => assert.equal(v('a = array.new_float(0)\nx = a.size() == 0 or a.get(0) > 1 ? 1 : 0\nplot(x)')[0], 1));
t('ternary lazy', () => assert.equal(v('a = array.new_float(0)\nplot(a.size() > 0 ? a.get(0) : -1)')[0], -1));
t('not', () => assert.equal(v('plot(not true ? 1 : 0)')[0], 0));

// ---------- functions ----------
t('function result', () => nearArr(v('f(a, b) => a * b\nplot(f(close, 2))'), C.map((c) => c * 2)));
t('function default + named', () => assert.equal(v('f(a, b = 10) => a + b\nplot(f(1, b = 5) + f(1))')[0], 17));
t('function block local scope', () => assert.equal(v('f(a) =>\n    t = a * 2\n    t + 1\nplot(f(3))')[0], 7));
t('function tuple', () => assert.equal(v('f(a) => [a, a * 2]\n[p, q] = f(3)\nplot(p + q)')[0], 9));
t('each call site own ta state', () => {
  const r1 = v('f(s) => ta.sma(s, 3)\na = f(close)\nb = f(open)\nplot(a)'); const r2 = v('plot(ta.sma(close, 3))');
  nearArr(r1, r2);
});
t('each call site own var', () => assert.deepEqual(v('f() =>\n    var c = 0\n    c += 1\n    c\na = f()\nb = f()\nplot(a + b)').slice(0, 3), [2, 4, 6]));
t('function calling function', () => assert.equal(v('g(x) => x + 1\nf(x) => g(x) * 2\nplot(f(1))')[0], 4));
t('function sees globals', () => assert.equal(v('k = 3\nf(x) => x * k\nplot(f(2))')[0], 6));
t('function with loop', () => assert.equal(v('f(n) =>\n    s = 0\n    for i = 1 to n\n        s += i\n    s\nplot(f(4))')[0], 10));
t('function history of param', () => near(v('f(x) => x[1]\nplot(f(close))')[5], C[4]));

// ---------- strings / math / color ----------
const sv = (expr) => exec(`label.new(0, 0, ${expr})\nplot(close)`, { bars: makeBars(1) }).labels[0].text;
t('str.tostring int', () => assert.equal(sv('str.tostring(5)'), '5'));
t('str.tostring float', () => assert.equal(sv('str.tostring(1.5)'), '1.5'));
t('str.tostring format #.##', () => assert.equal(sv('str.tostring(3.14159, "#.##")'), '3.14'));
t('str.tostring format 0.000', () => assert.equal(sv('str.tostring(2, "0.000")'), '2.000'));
t('str.tostring thousands', () => assert.equal(sv('str.tostring(1234567.891, "#,###.##")'), '1,234,567.89'));
t('str.tostring percent', () => assert.equal(sv('str.tostring(12.345, format.percent)'), '12.35%'));
t('str.tostring price uses mintick', () => assert.equal(sv('str.tostring(10, format.price)'), '10.00'));
t('str.tostring volume', () => assert.equal(sv('str.tostring(1500000, format.volume)'), '1.5M'));
t('str.tostring bool', () => assert.equal(sv('str.tostring(true)'), 'true'));
t('str.tostring na', () => assert.equal(sv('str.tostring(na)'), 'NaN'));
t('str concat', () => assert.equal(sv('"a" + "b"'), 'ab'));
t('str.format', () => assert.equal(sv('str.format("{0} and {1}", "x", 2)'), 'x and 2'));
t('str.format number', () => assert.equal(sv('str.format("{0,number,#.#}", 1.26)'), '1.3'));
t('str.upper/lower/trim', () => assert.equal(sv('str.upper(str.trim("  ab ")) + str.lower("C")'), 'ABc'));
t('str.replace / replace_all', () => assert.equal(sv('str.replace("a-a-a", "-", "+") + str.replace_all("a-a", "-", "")'), 'a+a-aaa'));
t('str.substring', () => assert.equal(sv('str.substring("hello", 1, 3)'), 'el'));
t('str.repeat', () => assert.equal(sv('str.repeat("ab", 3, "-")'), 'ab-ab-ab'));
t('str.split join', () => assert.equal(sv('array.join(str.split("a,b,c", ","), "|")'), 'a|b|c'));
t('str.length/contains/pos', () => assert.equal(v('plot(str.length("abc") + (str.contains("abc", "b") ? 10 : 0) + str.pos("abc", "c"))')[0], 15));
t('str.pos missing na', () => assert.ok(Number.isNaN(v('plot(str.pos("abc", "z"))')[0])));
t('str.tonumber', () => assert.deepEqual([v('plot(str.tonumber("12.5"))')[0], Number.isNaN(v('plot(str.tonumber("x1"))')[0])], [12.5, true]));
t('str.startswith/endswith', () => assert.equal(v('plot(str.startswith("abc", "a") and str.endswith("abc", "c") ? 1 : 0)')[0], 1));
t('math.min/max/avg variadic', () => assert.equal(v('plot(math.min(3, 1, 2) + math.max(3, 9, 2) * 10 + math.avg(2, 4))')[0], 94));
t('math.min with na is na', () => assert.ok(Number.isNaN(v('plot(math.min(1, na))')[0])));
t('math.round precision', () => assert.equal(v('plot(math.round(2.345, 2))')[0], 2.35));
t('math.round int', () => assert.equal(v('plot(math.round(2.5))')[0], 3));
t('math.floor/ceil/abs/sign', () => assert.equal(v('plot(math.floor(2.7) + math.ceil(2.1) + math.abs(-4) + math.sign(-3))')[0], 8));
t('math.pow/sqrt/log/exp', () => near(v('plot(math.pow(2, 10) + math.sqrt(16) + math.log(math.e) + math.exp(0))')[0], 1030));
t('math.sqrt negative na', () => assert.ok(Number.isNaN(v('plot(math.sqrt(-1))')[0])));
t('math.log10', () => near(v('plot(math.log10(1000))')[0], 3));
t('math trig', () => near(v('plot(math.sin(math.pi / 2) + math.cos(0) + math.todegrees(math.pi))')[0], 182));
t('math.random repeatable', () => { const a = v('plot(math.random(0, 1, 42))'), b = v('plot(math.random(0, 1, 42))'); nearArr(a, b); assert.ok(a.every((x) => x >= 0 && x < 1)); });
t('math.round_to_mintick', () => near(v('plot(math.round_to_mintick(10.13))', { symbol: { mintick: 0.25 } })[0], 10.25));
const cv = (expr) => exec(`label.new(0, 0, "x", color=${expr})\nplot(close)`, { bars: makeBars(1) }).labels[0].color;
t('color constant', () => assert.equal(cv('color.red'), '#f23645ff'));
t('color.new transp', () => assert.equal(cv('color.new(#ff0000, 50)'), '#ff000080'));
t('color.rgb', () => assert.equal(cv('color.rgb(255, 0, 0, 0)'), '#ff0000ff'));
t('color.from_gradient mid', () => assert.equal(cv('color.from_gradient(50, 0, 100, #000000, #ffffff)'), '#808080ff'));
t('color.from_gradient clamps', () => assert.equal(cv('color.from_gradient(500, 0, 100, #000000, #ffffff)'), '#ffffffff'));
t('color.r/g/b/t', () => assert.equal(v('c = color.new(#102030, 25)\nplot(color.r(c) + color.g(c) + color.b(c) + color.t(c))')[0], 16 + 32 + 48 + 25));
t('color na', () => assert.equal(cv('na'), null));

// ---------- arrays / maps ----------
t('array push/get/size', () => assert.equal(v('a = array.new_float(0)\na.push(1)\na.push(2)\nplot(a.get(1) + a.size())')[0], 4));
t('array negative index', () => assert.equal(v('a = array.from(1, 2, 3)\nplot(a.get(-1))')[0], 3));
t('array out of range E410', () => { const o = exec('a = array.from(1)\nplot(a.get(5))'); assert.equal(o.ok, false); assert.equal(o.error.code, 'E410'); assert.match(o.error.message, /5/); });
t('array error has line', () => { const o = exec('a = array.from(1)\nplot(a.get(5))'); assert.equal(o.error.line, 4); });
t('array pop empty E410', () => assert.equal(exec('a = array.new_float(0)\nx = a.pop()\nplot(close)').error.code, 'E410'));
t('array set', () => assert.equal(v('a = array.new_float(3, 0)\na.set(1, 7)\nplot(a.sum())')[0], 7));
t('array shift/unshift', () => assert.equal(v('a = array.from(1, 2)\na.unshift(0)\nx = a.shift()\nplot(x * 10 + a.get(0))')[0], 1));
t('array insert/remove', () => assert.equal(v('a = array.from(1, 3)\na.insert(1, 2)\nr = a.remove(0)\nplot(r * 100 + a.get(0) * 10 + a.get(1))')[0], 123));
t('array sort asc/desc', () => assert.equal(v('a = array.from(3, 1, 2)\na.sort()\nb = array.from(3, 1, 2)\nb.sort(order.descending)\nplot(a.get(0) * 10 + b.get(0))')[0], 13));
t('array sort_indices', () => assert.equal(v('a = array.from(30, 10, 20)\nix = a.sort_indices()\nplot(ix.get(0) * 100 + ix.get(1) * 10 + ix.get(2))')[0], 120));
t('array stats', () => assert.equal(v('a = array.from(1, 2, 3, 4)\nplot(a.avg() + a.min() + a.max() + a.median() + a.range())')[0], 2.5 + 1 + 4 + 2.5 + 3));
t('array stdev', () => near(v('a = array.from(2, 4, 4, 4, 5, 5, 7, 9)\nplot(a.stdev())')[0], 2));
t('array includes/indexof', () => assert.equal(v('a = array.from(5, 6, 5)\nplot((a.includes(6) ? 100 : 0) + a.indexof(5) * 10 + a.lastindexof(5))')[0], 102));
t('array slice copy', () => assert.equal(v('a = array.from(1, 2, 3, 4)\nb = a.slice(1, 3)\nb.set(0, 9)\nplot(b.size() * 10 + a.get(1))')[0], 22));
t('array copy independent', () => assert.equal(v('a = array.from(1)\nb = a.copy()\nb.set(0, 5)\nplot(a.get(0))')[0], 1));
t('array concat', () => assert.equal(v('a = array.from(1)\nb = array.from(2, 3)\na.concat(b)\nplot(a.size())')[0], 3));
t('array reverse/first/last', () => assert.equal(v('a = array.from(1, 2, 3)\na.reverse()\nplot(a.first() * 10 + a.last())')[0], 31));
t('array fill', () => assert.equal(v('a = array.new_float(4, 0)\na.fill(2, 1, 3)\nplot(a.sum())')[0], 4));
t('array abs', () => assert.equal(v('a = array.from(-1, -2)\nplot(a.abs().sum())')[0], 3));
t('var array persists', () => assert.equal(v('var a = array.new_float(0)\na.push(close)\nplot(a.size())')[39], 40));
t('plain array re-made', () => assert.equal(v('a = array.new_float(0)\na.push(close)\nplot(a.size())')[39], 1));
t('array.new generic initial', () => assert.equal(v('a = array.new<int>(3, 7)\nplot(a.sum())')[0], 21));
t('array of strings join', () => assert.equal(sv('array.join(array.from("a", "b"), "-")'), 'a-b'));
t('map put/get/size', () => assert.equal(v('m = map.new<string, float>()\nm.put("a", 1)\nm.put("b", 2)\nplot(m.get("b") + m.size())')[0], 4));
t('map missing key na', () => assert.ok(Number.isNaN(v('m = map.new<string, float>()\nplot(m.get("x"))')[0])));
t('map contains/remove', () => assert.equal(v('m = map.new<string, float>()\nm.put("a", 1)\nr = m.remove("a")\nplot(r * 10 + (m.contains("a") ? 1 : 0))')[0], 10));
t('map keys/values', () => assert.equal(v('m = map.new<string, float>()\nm.put("a", 1)\nm.put("b", 2)\nplot(m.values().sum() + m.keys().size())')[0], 5));
t('map __proto__ key is just a key', () => assert.equal(v('m = map.new<string, float>()\nm.put("__proto__", 1)\nm.put("constructor", 2)\nplot(m.get("__proto__") + m.get("constructor") + m.size())')[0], 5));
t('var map persists', () => assert.equal(v('var m = map.new<int, int>()\nm.put(bar_index, 1)\nplot(m.size())')[39], 40));
t('map copy/clear/put_all', () => assert.equal(v('m = map.new<int, int>()\nm.put(1, 1)\nn = m.copy()\nm.clear()\nm.put_all(n)\nplot(m.size())')[0], 1));
t('method on na array errors', () => { const o = exec('array<float> a = na\nplot(a.size())'); assert.equal(o.ok, false); assert.equal(o.error.code, 'E411'); });

// ---------- built-in variables ----------
t('ohlc vars', () => { const o = exec('plot(open)\nplot(high)\nplot(low)\nplot(volume)', { bars: B }); nearArr(Array.from(o.plots[0].values), B.open); nearArr(Array.from(o.plots[3].values), B.volume); });
t('hl2/hlc3/ohlc4/hlcc4', () => { const r = v('plot(hl2 + hlc3 + ohlc4 + hlcc4)'); const i = 7; near(r[i], (B.high[i] + B.low[i]) / 2 + (B.high[i] + B.low[i] + C[i]) / 3 + (B.open[i] + B.high[i] + B.low[i] + C[i]) / 4 + (B.high[i] + B.low[i] + 2 * C[i]) / 4); });
t('bar_index / last_bar_index', () => { const r = v('plot(bar_index)\nplot(last_bar_index)'); assert.equal(r[39], 39); });
t('time / time_close', () => { const o = exec('plot(time)\nplot(time_close)', { bars: B, timeframe: '1' }); assert.equal(o.plots[0].values[3], B.time[3]); assert.equal(o.plots[1].values[3], B.time[3] + 60000); });
t('date parts UTC', () => { const D = makeBars(2, 1, 60000, Date.UTC(2026, 2, 4, 13, 45, 0)); const o = exec('plot(year)\nplot(month)\nplot(dayofmonth)\nplot(dayofweek)\nplot(hour)\nplot(minute)', { bars: D }); assert.deepEqual(o.plots.map((p) => p.values[0]), [2026, 3, 4, 4, 13, 45]); });
t('barstate.isfirst/islast', () => { const r = v('plot(barstate.isfirst ? 1 : barstate.islast ? 2 : 0)'); assert.equal(r[0], 1); assert.equal(r[39], 2); assert.equal(r[5], 0); });
t('barstate.ishistory on history', () => assert.ok(v('plot(barstate.ishistory ? 1 : 0)').every((x) => x === 1)));
t('syminfo', () => { const o = exec('label.new(0, 0, syminfo.ticker + "|" + syminfo.tickerid)\nplot(syminfo.mintick)', { bars: makeBars(1), symbol: { ticker: 'NQ', tickerid: 'CME:NQ', mintick: 0.25 } }); assert.equal(o.labels[0].text, 'NQ|CME:NQ'); assert.equal(o.plots[0].values[0], 0.25); });
t('timeframe vars', () => { const o = exec('plot(timeframe.multiplier)\nplot(timeframe.isintraday ? 1 : 0)\nplot(timeframe.isdaily ? 1 : 0)', { bars: makeBars(1), timeframe: 'D' }); assert.deepEqual(o.plots.map((p) => p.values[0]), [1, 0, 1]); });
t('timeframe.period', () => assert.equal(exec('label.new(0, 0, timeframe.period)\nplot(close)', { bars: makeBars(1), timeframe: '15' }).labels[0].text, '15'));
t('timestamp()', () => assert.equal(v('plot(timestamp(2026, 1, 2, 3, 4, 5))')[0], Date.UTC(2026, 0, 2, 3, 4, 5)));

// ---------- inputs ----------
const prog = (body) => comp(body).program;
const runP = (p, o) => new Session(p, o).run(o.bars || B);
t('input default used', () => assert.equal(runP(prog('n = input.int(7)\nplot(n)'), { bars: B }).plots[0].values[0], 7));
t('input override', () => assert.equal(runP(prog('n = input.int(7)\nplot(n)'), { bars: B, inputs: { 0: 9 } }).plots[0].values[0], 9));
t('input int truncated', () => assert.equal(runP(prog('n = input.int(7)\nplot(n)'), { bars: B, inputs: { 0: 9.8 } }).plots[0].values[0], 9));
t('input clamped to min/max', () => assert.equal(runP(prog('n = input.int(7, minval=1, maxval=10)\nplot(n)'), { bars: B, inputs: { 0: 99 } }).plots[0].values[0], 10));
t('input wrong type -> default', () => assert.equal(runP(prog('n = input.int(7)\nplot(n)'), { bars: B, inputs: { 0: 'x' } }).plots[0].values[0], 7));
t('input options enforced', () => { const o = runP(prog('m = input.string("a", options=["a", "b"])\nplot(m == "a" ? 1 : 2)'), { bars: B, inputs: { 0: 'zzz' } }); assert.equal(o.plots[0].values[0], 1); });
t('input options accepted', () => { const o = runP(prog('m = input.string("a", options=["a", "b"])\nplot(m == "a" ? 1 : 2)'), { bars: B, inputs: { 0: 'b' } }); assert.equal(o.plots[0].values[0], 2); });
t('input.source switch', () => { const o = runP(prog('s = input.source(close)\nplot(s)'), { bars: B, inputs: { 0: 'high' } }); nearArr(Array.from(o.plots[0].values), B.high); });
t('input.source bad name -> default', () => { const o = runP(prog('s = input.source(low)\nplot(s)'), { bars: B, inputs: { 0: 'constructor' } }); nearArr(Array.from(o.plots[0].values), B.low); });
t('input.bool', () => assert.equal(runP(prog('b = input.bool(false)\nplot(b ? 1 : 0)'), { bars: B, inputs: { 0: true } }).plots[0].values[0], 1));
t('input.color', () => assert.equal(runP(prog('c = input.color(color.red)\nplot(close, color=c)'), { bars: B, inputs: { 0: '#00ff00' } }).plots[0].color, '#00ff00ff'));
t('input.color bad -> default', () => assert.equal(runP(prog('c = input.color(color.red)\nplot(close, color=c)'), { bars: B, inputs: { 0: 'javascript:x' } }).plots[0].color, '#f23645ff'));

// ---------- outputs ----------
t('plot output fields', () => { const o = exec('plot(close, "C", color=color.blue, linewidth=2, style=plot.style_stepline)', { bars: B }); const p = o.plots[0]; assert.equal(p.title, 'C'); assert.equal(p.kind, 'stepline'); assert.equal(p.linewidth, 2); assert.equal(p.color, '#2962ffff'); assert.ok(p.values instanceof Float64Array); assert.equal(p.colors, null); });
t('plot per-bar colors', () => { const o = exec('plot(close, color=close > open ? color.green : color.red)', { bars: B }); assert.ok(Array.isArray(o.plots[0].colors)); assert.equal(o.plots[0].colors.length, 40); });
t('plot offset prop', () => assert.equal(exec('plot(close, offset=2)', { bars: B }).plots[0].offset, 2));
t('plotshape values only where true', () => { const o = exec('plotshape(bar_index % 2 == 0, style=shape.circle)', { bars: B }); assert.equal(o.plots[0].values[0], 1); assert.ok(Number.isNaN(o.plots[0].values[1])); assert.equal(o.plots[0].kind, 'shape'); assert.equal(o.plots[0].style, 'circle'); });
t('plotchar', () => { const o = exec('plotchar(true, char="x")', { bars: B }); assert.equal(o.plots[0].char, 'x'); assert.equal(o.plots[0].kind, 'char'); });
t('plotarrow', () => { const o = exec('plotarrow(close - open)', { bars: B }); assert.equal(o.plots[0].kind, 'arrow'); });
t('plotcandle', () => { const o = exec('plotcandle(open, high, low, close)', { bars: B }); const p = o.plots[0]; assert.equal(p.kind, 'candle'); nearArr(Array.from(p.high), B.high); });
t('plotbar', () => assert.equal(exec('plotbar(open, high, low, close)', { bars: B }).plots[0].kind, 'bar'));
t('bgcolor/barcolor', () => { const o = exec('bgcolor(close > open ? color.green : na)\nbarcolor(color.red)', { bars: B }); assert.equal(o.plots[0].kind, 'bgcolor'); assert.equal(o.plots[1].kind, 'barcolor'); });
t('hline output', () => { const o = exec('h = hline(50, "Mid", color=color.gray)\nplot(close)', { bars: B }); assert.deepEqual([o.hlines[0].price, o.hlines[0].title], [50, 'Mid']); });
t('fill between plots', () => { const o = exec('a = plot(high)\nb = plot(low)\nfill(a, b, color=color.new(color.blue, 90))', { bars: B }); assert.deepEqual([o.fills[0].a, o.fills[0].b, o.fills[0].between], [0, 1, 'plot']); });
t('fill between hlines', () => { const o = exec('a = hline(1)\nb = hline(2)\nfill(a, b)', { bars: B }); assert.equal(o.fills[0].between, 'hline'); });
t('alertcondition values', () => { const o = exec('alertcondition(bar_index == 3, "T", "M")\nplot(close)', { bars: B }); assert.equal(o.alertconditions[0].values[3], 1); assert.equal(o.alertconditions[0].values[2], 0); assert.equal(o.alertconditions[0].title, 'T'); });
t('alert() fires', () => { const o = exec('if bar_index == 5\n    alert("hi")\nplot(close)', { bars: B }); assert.deepEqual(o.alerts.map((a) => [a.bar, a.message]), [[5, 'hi']]); });
t('alert once per bar dedup', () => { const o = exec('if bar_index == 5\n    alert("hi")\n    alert("hi")\nplot(close)', { bars: B }); assert.equal(o.alerts.length, 1); });
t('alert freq_all not dedup', () => { const o = exec('if bar_index == 5\n    alert("hi", alert.freq_all)\n    alert("hi", alert.freq_all)\nplot(close)', { bars: B }); assert.equal(o.alerts.length, 2); });
t('alerts capped at 500', () => assert.equal(exec('alert("a" + str.tostring(bar_index))\nplot(close)', { n: 800 }).alerts.length, 500));
t('output is structured-clone safe', () => { const o = exec('plot(close)\nlabel.new(bar_index, high, "x")', { bars: B }); structuredClone(o); });
t('notices empty by default', () => assert.deepEqual(exec('plot(close)', { bars: B }).notices, []));

// ---------- drawings ----------
t('label.new fields', () => { const o = exec('if barstate.islast\n    label.new(bar_index, high, "Hi", color=color.red, style=label.style_label_up)\nplot(close)', { bars: B }); const l = o.labels[0]; assert.deepEqual([l.x, l.text, l.color, l.style, l.xloc], [39, 'Hi', '#f23645ff', 'label_up', 'bar_index']); near(l.y, B.high[39]); });
t('label set_*', () => { const o = exec('var l = label.new(0, 0, "a")\nlabel.set_text(l, "b")\nl.set_xy(bar_index, close)\nplot(close)', { bars: B }); assert.equal(o.labels.length, 1); assert.equal(o.labels[0].text, 'b'); assert.equal(o.labels[0].x, 39); });
t('label get_*', () => assert.equal(v('l = label.new(5, 7, "q")\nplot(label.get_x(l) + label.get_y(l))')[0], 12));
t('label.delete', () => assert.equal(exec('l = label.new(bar_index, close, "x")\nlabel.delete(l)\nplot(close)', { bars: B }).labels.length, 0));
t('label oldest removed at 50', () => { const o = exec('label.new(bar_index, close, str.tostring(bar_index))\nplot(close)', { n: 120 }); assert.equal(o.labels.length, 50); assert.equal(o.labels[0].text, '70'); });
t('max_labels_count raises the cap', () => assert.equal(exec('label.new(bar_index, close, "x")\nplot(close)', { n: 120, header: '//@zscript 1\nindicator("t", max_labels_count=100)\n' }).labels.length, 100));
t('label.copy', () => assert.equal(exec('l = label.new(0, 0, "a")\nc = label.copy(l)\nlabel.set_text(c, "b")\nplot(close)', { bars: makeBars(1) }).labels.map((x) => x.text).join(), 'a,b'));
t('label on na id is ignored', () => assert.equal(exec('label l = na\nlabel.set_text(l, "x")\nplot(close)', { bars: B }).ok, true));
t('line.new + get_price', () => assert.equal(v('l = line.new(0, 0, 10, 100)\nplot(line.get_price(l, 5))')[0], 50));
t('line set/extend', () => { const o = exec('var l = line.new(0, 0, 1, 1)\nline.set_xy2(l, bar_index, close)\nline.set_extend(l, extend.right)\nplot(close)', { bars: B }); assert.equal(o.lines[0].x2, 39); assert.equal(o.lines[0].extend, 'right'); });
t('box.new + set', () => { const o = exec('var b = box.new(0, 10, 5, 0, bgcolor=color.new(color.blue, 80))\nbox.set_right(b, bar_index)\nplot(close)', { bars: B }); assert.equal(o.boxes[0].right, 39); assert.equal(o.boxes[0].bgcolor, '#2962ff33'); });
t('box get', () => assert.equal(v('b = box.new(1, 9, 3, 2)\nplot(box.get_left(b) + box.get_top(b) + box.get_right(b) + box.get_bottom(b))')[0], 15));
t('table cells', () => { const o = exec('var t = table.new(position.top_right, 2, 2, bgcolor=color.black)\nif barstate.islast\n    table.cell(t, 0, 0, "A")\n    table.cell(t, 1, 1, str.tostring(close, "#.##"), text_color=color.white)\nplot(close)', { bars: B }); const tb = o.tables[0]; assert.equal(tb.position, 'top_right'); assert.equal(tb.cells.length, 2); assert.equal(tb.cells[0].text, 'A'); });
t('table cell out of range E410', () => assert.equal(exec('t = table.new(position.top_right, 1, 1)\ntable.cell(t, 3, 3, "x")\nplot(close)', { bars: B }).error.code, 'E410'));
t('table cell_set_text', () => assert.equal(exec('var t = table.new(position.top_left, 1, 1)\ntable.cell_set_text(t, 0, 0, "z")\nplot(close)', { bars: B }).tables[0].cells[0].text, 'z'));
t('table.clear', () => assert.equal(exec('var t = table.new(position.top_left, 2, 1)\ntable.cell(t, 0, 0, "a")\ntable.cell(t, 1, 0, "b")\ntable.clear(t, 0, 0)\nplot(close)', { bars: makeBars(1) }).tables[0].cells.length, 1));
t('too many tables E408', () => assert.equal(exec('t = table.new(position.top_left, 1, 1)\nplot(close)', { n: 30 }).error.code, 'E408'));
t('drawing ids are numbers', () => assert.equal(typeof exec('label.new(0, 0, "x")\nplot(close)', { bars: makeBars(1) }).labels[0].id, 'number'));
t('xloc.bar_time', () => assert.equal(exec('label.new(time, close, "x", xloc=xloc.bar_time)\nplot(close)', { bars: makeBars(1) }).labels[0].xloc, 'bar_time'));
t('drawings in arrays', () => { const o = exec('var a = array.new_label(0)\na.push(label.new(bar_index, close, "x"))\nif a.size() > 3\n    label.delete(a.shift())\nplot(close)', { bars: B }); assert.equal(o.labels.length, 3); });

// ---------- live updates ----------
const live = (body, n = 30) => { const all = makeBars(n + 1, 4); const hist = {}; for (const k of Object.keys(all)) hist[k] = all[k].slice(0, n); const p = comp(body).program; const s = new Session(p, { timeframe: '1' }); return { s, all, first: s.run(hist), n }; };
t('update same bar re-runs last bar', () => {
  const { s, all, n } = live('plot(close * 2)');
  const o = s.update({ time: all.time[n - 1], open: 1, high: 9, low: 0, close: 5, volume: 1 });
  assert.equal(o.plots[0].values.length, n); assert.equal(o.plots[0].values[n - 1], 10);
});
t('update new bar appends', () => {
  const { s, all, n } = live('plot(close * 2)');
  const o = s.update({ time: all.time[n], open: 1, high: 9, low: 0, close: 6, volume: 1 });
  assert.equal(o.plots[0].values.length, n + 1); assert.equal(o.plots[0].values[n], 12);
});
t('var rolls back on same-bar update', () => {
  const { s, all, n } = live('var c = 0\nc += 1\nplot(c)');
  s.update({ time: all.time[n - 1], open: 1, high: 2, low: 0, close: 1, volume: 1 });
  const o = s.update({ time: all.time[n - 1], open: 1, high: 2, low: 0, close: 1, volume: 1 });
  assert.equal(o.plots[0].values[n - 1], n);
});
t('varip does not roll back', () => {
  const { s, all, n } = live('varip c = 0\nc += 1\nplot(c)');
  s.update({ time: all.time[n - 1], open: 1, high: 2, low: 0, close: 1, volume: 1 });
  const o = s.update({ time: all.time[n - 1], open: 1, high: 2, low: 0, close: 1, volume: 1 });
  assert.equal(o.plots[0].values[n - 1], n + 2);
});
t('ta state rolls back (ema same as full run)', () => {
  const { s, all, n } = live('plot(ta.ema(close, 5))');
  s.update({ time: all.time[n - 1], open: 1, high: 2, low: 0, close: 999, volume: 1 });
  const o = s.update({ time: all.time[n - 1], open: all.open[n - 1], high: all.high[n - 1], low: all.low[n - 1], close: all.close[n - 1], volume: all.volume[n - 1] });
  const full = vals('plot(ta.ema(close, 5))', { bars: Object.fromEntries(Object.entries(all).map(([k, a]) => [k, a.slice(0, n)])) });
  near(o.plots[0].values[n - 1], full[n - 1]);
});
t('live then new bar equals full run', () => {
  const body = 'var c = 0\nc += 1\nplot(ta.rsi(close, 5) + c)';
  const { s, all, n } = live(body);
  s.update({ time: all.time[n - 1], open: 1, high: 2, low: 0, close: 50, volume: 1 });
  s.update({ time: all.time[n - 1], open: all.open[n - 1], high: all.high[n - 1], low: all.low[n - 1], close: all.close[n - 1], volume: all.volume[n - 1] });
  const o = s.update({ time: all.time[n], open: all.open[n], high: all.high[n], low: all.low[n], close: all.close[n], volume: all.volume[n] });
  nearArr(Array.from(o.plots[0].values), vals(body, { bars: all }));
});
t('drawings roll back on update', () => {
  const { s, all, n } = live('label.new(bar_index, close, "x")\nplot(close)');
  const before = s.update({ time: all.time[n - 1], open: 1, high: 2, low: 0, close: 1, volume: 1 }).labels.length;
  const after = s.update({ time: all.time[n - 1], open: 1, high: 2, low: 0, close: 1, volume: 1 }).labels.length;
  assert.equal(before, after);
});
t('isrealtime on live bar', () => {
  const { s, all, n } = live('plot(barstate.isrealtime ? 1 : 0)');
  const o = s.update({ time: all.time[n], open: 1, high: 2, low: 0, close: 1, volume: 1 });
  assert.equal(o.plots[0].values[n], 1); assert.equal(o.plots[0].values[n - 1], 0);
});
t('isnew false on rerun', () => {
  const { s, all, n } = live('plot(barstate.isnew ? 1 : 0)');
  const o = s.update({ time: all.time[n - 1], open: 1, high: 2, low: 0, close: 1, volume: 1 });
  assert.equal(o.plots[0].values[n - 1], 0);
});
t('older bar update ignored', () => {
  const { s, all, n } = live('plot(close)');
  const o = s.update({ time: all.time[0] - 60000, open: 1, high: 2, low: 0, close: 1, volume: 1 });
  assert.equal(o.plots[0].values.length, n);
});
t('alert once_per_bar_close waits for close', () => {
  const { s, all, n, first } = live('alert("c", alert.freq_once_per_bar_close)\nplot(close)');
  assert.equal(first.alerts.at(-1).bar, n - 2);
  void s; void all;
});

// ---------- request.security ----------
const m5 = makeBars(48, 21, 5 * 60000, Date.UTC(2026, 0, 5, 0, 0));
const h1 = (() => { const o = { time: [], open: [], high: [], low: [], close: [], volume: [] }; for (let i = 0; i < 48; i += 12) { o.time.push(m5.time[i]); o.open.push(m5.open[i]); o.close.push(m5.close[i + 11]); o.high.push(Math.max(...m5.high.slice(i, i + 12))); o.low.push(Math.min(...m5.low.slice(i, i + 12))); o.volume.push(1); } return o; })();
const secRun = (body, extra) => { const p = comp(body).program; return new Session(p, Object.assign({ timeframe: '5', symbol: { ticker: 'NQ', tickerid: 'CME:NQ' }, securities: { 0: { bars: h1 } } }, extra || {})).run(m5); };
t('security HTF close only after the HTF bar closed', () => {
  const o = secRun('h = request.security("", "60", close)\nplot(h)');
  const v2 = Array.from(o.plots[0].values);
  for (let i = 0; i < 11; i++) assert.ok(Number.isNaN(v2[i]), 'no value before the first hour closes, bar ' + i);
  near(v2[11], h1.close[0]); near(v2[12], h1.close[0]); near(v2[23], h1.close[1]); near(v2[47], h1.close[3]);
});
t('security never shows a later HTF bar (no lookahead)', () => {
  const o = secRun('h = request.security("", "60", close)\nplot(h)');
  const v2 = Array.from(o.plots[0].values);
  for (let i = 0; i < 48; i++) { const hour = Math.floor((i + 1) / 12) - 1; if (hour >= 0) near(v2[i], h1.close[hour]); }
});
t('security with ta expression', () => {
  const o = secRun('h = request.security("", "60", ta.sma(close, 2))\nplot(h)');
  near(o.plots[0].values[47], (h1.close[2] + h1.close[3]) / 2);
});
t('security tuple', () => { const o = secRun('[a, b] = request.security("", "60", [open, close])\nplot(a)\nplot(b)'); near(o.plots[0].values[47], h1.open[3]); near(o.plots[1].values[47], h1.close[3]); });
t('security with user function', () => { const o = secRun('f() => close * 2\nh = request.security("", "60", f())\nplot(h)'); near(o.plots[0].values[47], h1.close[3] * 2); });
t('security same tf = own series', () => { const o = new Session(comp('h = request.security("", "", close)\nplot(h)').program, { timeframe: '5' }).run(m5); nearArr(Array.from(o.plots[0].values), m5.close); });
t('security missing data -> na + notice', () => { const o = new Session(comp('h = request.security("CME:ES", "60", close)\nplot(h)').program, { timeframe: '5' }).run(m5); assert.ok(Array.from(o.plots[0].values).every(Number.isNaN)); assert.ok(o.notices.some((x) => /not available/.test(x))); });
t('security lower timeframe refused', () => { const o = new Session(comp('h = request.security("", "1", close)\nplot(h)').program, { timeframe: '5', securities: { 0: { bars: m5 } } }).run(m5); assert.ok(o.notices.length === 1); assert.ok(Array.from(o.plots[0].values).every(Number.isNaN)); });
t('security meta resolves input tf', () => { const p = comp('tf = input.timeframe("60")\nh = request.security("", tf, close)\nplot(h)').program; assert.equal(p.meta.securities[0].timeframe.input, 0); });

// ---------- our data namespaces ----------
const N = 6;
const DB = makeBars(N, 2, 60000);
const book = DB.time.map((tm, i) => ({ t: tm + 30000, bids: [[100 - i, 10], [99 - i, 50], [98 - i, 5]], asks: [[101 - i, 20], [102 - i, 5], [103 - i, 80]] }));
const flow = { buyvol: [5, 6, 7, 8, 9, 10], sellvol: [1, 2, 3, 4, 5, 6], trades: [10, 11, 12, 13, 14, 15],
  bigtrades: DB.time.map(() => [[100, 50, 'b'], [100, 5, 's'], [101, 120, 's']]), footprint: DB.time.map(() => [[100, 10, 30], [100.25, 50, 50], [100.5, 5, 5]]) };
const gex = DB.time.map((tm) => ({ t: tm, callwall: 110, putwall: 90, flip: 100, zero_upper: 105, zero_lower: 95, net: 1.5e9, levels: [100, 110, 90] }));
const opt = DB.time.map((tm) => ({ t: tm - 60000, nodes: [101, 99], ranges: { day: [95, 105], week: [90, 110] }, ivrank: 42, pc: 0.8, maxpain: 100, zone: 'mid' }));
const ALL = { book: true, flow: true, gex: true, opt: true };
const dv = (body, o) => { const r = exec(body, Object.assign({ bars: DB, allowed: ALL, data: { book, flow, gex, opt }, symbol: { mintick: 0.25 } }, o || {})); if (!r.ok) throw new Error(r.error.message); return r; };
const d0 = (body, o) => Array.from(dv(body, o).plots[0].values);
t('book.bid/ask level 0', () => { const r = d0('plot(book.bid() * 1000 + book.ask(0))'); assert.equal(r[0], 100 * 1000 + 101); });
t('book levels and sizes', () => assert.equal(d0('plot(book.bid(1) + book.bidsize(1) + book.asksize(2))')[0], 99 + 50 + 80));
t('book level out of range na', () => assert.ok(Number.isNaN(d0('plot(book.bid(10))')[0])));
t('book.depth', () => assert.equal(d0('plot(book.depth(book.side_bid, 2) * 1000 + book.depth(book.side_ask, 10))')[0], 60 * 1000 + 105));
t('book.imbalance', () => near(d0('plot(book.imbalance(3))')[0], (65 - 105) / (65 + 105)));
t('book.wall', () => assert.equal(d0('plot(book.wall(book.side_ask, 50))')[0], 103));
t('book.wall none na', () => assert.ok(Number.isNaN(d0('plot(book.wall(book.side_bid, 1000))')[0])));
t('book.heat', () => assert.equal(d0('plot(book.heat(99))')[0], 50));
t('book frame from the future is ignored', () => { const fut = book.map((f) => Object.assign({}, f, { t: f.t + 120000 })); assert.ok(d0('plot(book.bid())', { data: { book: fut } }).every(Number.isNaN)); });
t('flow vars', () => { const o = dv('plot(flow.buyvol)\nplot(flow.sellvol)\nplot(flow.delta)\nplot(flow.trades)'); assert.deepEqual(o.plots.map((p) => p.values[2]), [7, 3, 4, 12]); });
t('flow.cvd running total', () => assert.deepEqual(d0('plot(flow.cvd)'), [4, 8, 12, 16, 20, 24]));
t('flow.cvd uses only bars so far', () => { const o = dv('plot(flow.cvd)'); assert.equal(o.plots[0].values[0], 4); });
t('flow.bigtrades', () => assert.equal(d0('plot(flow.bigtrades(50) * 1000 + flow.bigtrades_vol(50))')[0], 2 * 1000 + 170));
t('flow.footprint', () => assert.equal(d0('plot(flow.footprint(100) + flow.footprint(100, flow.side_buy) * 1000)')[0], 40 + 30000));
t('flow.footprint missing price 0', () => assert.equal(d0('plot(flow.footprint(120))')[0], 0));
t('flow.poc/vah/val', () => { const o = dv('plot(flow.poc)\nplot(flow.vah)\nplot(flow.val)'); assert.deepEqual(o.plots.map((p) => p.values[0]), [100.25, 100.25, 100]); });
t('gex vars', () => { const o = dv('plot(gex.callwall)\nplot(gex.putwall)\nplot(gex.flip)\nplot(gex.net)\nplot(gex.level(1))\nplot(gex.zero_upper - gex.zero_lower)'); assert.deepEqual(o.plots.map((p) => p.values[0]), [110, 90, 100, 1.5e9, 110, 10]); });
t('gex.updated', () => assert.equal(d0('plot(gex.updated)')[0], DB.time[0]));
t('opt vars', () => { const o = dv('plot(opt.ivrank)\nplot(opt.pc)\nplot(opt.maxpain)\nplot(opt.node(1))'); assert.deepEqual(o.plots.map((p) => p.values[0]), [42, 0.8, 100, 99]); });
t('opt.range tuple', () => { const o = dv('[lo, hi] = opt.range("week")\nplot(lo)\nplot(hi)'); assert.deepEqual([o.plots[0].values[0], o.plots[1].values[0]], [90, 110]); });
t('opt.range unknown kind na', () => assert.ok(Number.isNaN(d0('[lo, hi] = opt.range("year")\nplot(lo)')[0])));
t('opt.zone string', () => assert.equal(dv('label.new(0, 0, opt.zone)\nplot(close)').labels.at(-1).text, 'mid'));
t('locked namespace -> na + one notice', () => {
  const o = dv('plot(book.bid())\nplot(book.ask())\nplot(flow.delta)', { allowed: { book: false, flow: true } });
  assert.ok(Array.from(o.plots[0].values).every(Number.isNaN)); assert.ok(!Number.isNaN(o.plots[2].values[0]));
  assert.equal(o.notices.length, 1); assert.match(o.notices[0], /Pro/);
});
t('locked: every namespace has its own notice', () => assert.equal(dv('plot(book.bid() + flow.delta + gex.flip + opt.ivrank)', { allowed: {} }).notices.length, 4));
t('missing data -> na + notice', () => { const o = dv('plot(gex.flip)', { data: {} }); assert.ok(Array.from(o.plots[0].values).every(Number.isNaN)); assert.match(o.notices[0], /No gex data/i); });
t('notice wording never says live/real-time', () => { const o = dv('plot(book.bid() + flow.delta + gex.flip + opt.ivrank)', { allowed: {} }); assert.ok(o.notices.every((s) => !/live|real-?time|delayed|behind/i.test(s))); });
t('null frames are na', () => assert.ok(Number.isNaN(d0('plot(gex.flip)', { data: { gex: [null, null, null, null, null, null] } })[0])));
t('garbage frames do not crash', () => { const o = dv('plot(book.bid(0) + book.depth(book.side_bid) + gex.level(0) + opt.node(0) + flow.footprint(1))', { data: { book: [1, 'x', { bids: 'no' }, null, {}, []], gex: [{ levels: 'x' }], opt: [{ nodes: {} }], flow: { footprint: ['x'] } } }); assert.equal(o.ok, true); });
t('live update merges data', () => {
  const p = comp('plot(flow.delta)').program; const s = new Session(p, { timeframe: '1', allowed: ALL, data: { flow: { buyvol: [1, 2], sellvol: [0, 0] } } });
  const hist = { time: DB.time.slice(0, 2), open: DB.open.slice(0, 2), high: DB.high.slice(0, 2), low: DB.low.slice(0, 2), close: DB.close.slice(0, 2), volume: DB.volume.slice(0, 2) };
  s.run(hist);
  const o = s.update({ time: DB.time[2], open: 1, high: 1, low: 1, close: 1, volume: 1, data: { flow: { buyvol: 9, sellvol: 4 } } });
  assert.equal(o.plots[0].values[2], 5);
});

done('zs-vm');
