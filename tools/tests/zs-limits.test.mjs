// Zscript hard limits: runaway loops, op budget, memory caps, drawing caps, output caps.
//   node tools/tests/zs-limits.test.mjs
import { t, done, exec, makeBars, assert, comp, Session } from './zs-helpers.mjs';

const err = (body, o) => { const r = exec(body, o); assert.equal(r.ok, false, 'expected a runtime error'); return r.error; };
const ms = (f) => { const a = Date.now(); f(); return Date.now() - a; };

t('infinite while stopped (E404)', () => { let e; const took = ms(() => { e = err('i = 0\nwhile true\n    i += 1\nplot(i)', { n: 5 }); }); assert.equal(e.code, 'E404'); assert.ok(took < 5000, took + 'ms'); });
t('infinite while with no body work', () => assert.equal(err('while true\n    x = 1\nplot(close)', { n: 5 }).code, 'E404'));
t('huge for stopped (E404)', () => assert.equal(err('s = 0\nfor i = 0 to 1000000000\n    s += 1\nplot(s)', { n: 5 }).code, 'E404'));
t('loop limit is per bar, not per run', () => assert.equal(exec('s = 0\nfor i = 0 to 50000\n    s += 1\nplot(s)', { n: 20 }).ok, true));
t('nested loops stopped', () => assert.ok(['E403', 'E404'].includes(err('s = 0\nfor i = 0 to 1000\n    for j = 0 to 1000\n        s += 1\nplot(s)', { n: 2 }).code)));
t('op budget per bar (E403)', () => { const L = 'for i = 0 to 90000\n    s += math.sqrt(i) * 2 + 1 - math.abs(s) / 3 + i % 7 + i * i - i\n'; assert.equal(err('s = 0.0\n' + L.repeat(4) + 'plot(s)', { n: 2 }).code, 'E403'); });
t('error reports line', () => assert.equal(err('i = 0\nwhile true\n    i += 1\nplot(i)', { n: 2 }).line, 4));
t('error has hint', () => assert.ok(err('while true\n    x = 1\nplot(close)', { n: 2 }).hint.length > 3));
t('error output still has empty arrays', () => { const r = exec('while true\n    x = 1\nplot(close)', { n: 2 }); assert.ok(Array.isArray(r.plots) && Array.isArray(r.labels)); });
t('error stops at the bar it happened', () => { const r = exec('if bar_index == 7\n    while true\n        x = 1\nplot(close)', { n: 20 }); assert.equal(r.error.bar, 7); });
t('wall-clock limit (E401) via tiny deadline', () => {
  const p = comp('s = 0.0\nfor i = 0 to 90000\n    s += 1\nplot(s)').program;
  const r = new Session(p, { timeframe: '1', limitsOverride: { firstRunMs: 1 } }).run(makeBars(3000));
  assert.equal(r.ok, false); assert.equal(r.error.code, 'E401');
});
t('limitsOverride can only lower limits', () => {
  const p = comp('i = 0\nwhile true\n    i += 1\nplot(i)').program;
  const r = new Session(p, { timeframe: '1', limitsOverride: { loopIters: 1e12 } }).run(makeBars(2));
  assert.equal(r.error.code, 'E404');
});
t('array size cap (E405)', () => assert.equal(err('a = array.new_float(200000, 0)\nplot(close)', { n: 2 }).code, 'E405'));
t('array push cap (E405)', () => assert.equal(err('var a = array.new_float(0)\nfor i = 0 to 60000\n    a.push(i)\nplot(close)', { n: 3 }).code, 'E405'));
t('per-bar allocation cap (E405)', () => assert.equal(err('for i = 0 to 30\n    a = array.new_float(90000, 0)\nplot(close)', { n: 2 }).code, 'E405'));
t('run-total allocation cap (E405)', () => assert.equal(err('a = array.new_float(90000, 0)\nb = array.new_float(90000, 0)\nplot(close)', { n: 400 }).code, 'E405'));
t('map size cap (E406)', () => assert.equal(err('var m = map.new<int, int>()\nfor i = 0 to 60000\n    m.put(bar_index * 100000 + i, 1)\nplot(close)', { n: 2 }).code, 'E406'));
t('string length cap (E407)', () => assert.equal(err('var s = "x"\nfor i = 0 to 20\n    s := s + s\nplot(close)', { n: 2 }).code, 'E407'));
t('str.repeat cap (E407)', () => assert.equal(err('s = str.repeat("abc", 100000)\nplot(close)', { n: 2 }).code, 'E407'));
t('str.split cap ok on small', () => assert.equal(exec('a = str.split("a,b", ",")\nplot(a.size())', { n: 2 }).ok, true));
t('bars cap (E413)', () => { const p = comp('plot(close)').program; const r = new Session(p, { timeframe: '1' }).run(makeBars(50001)); assert.equal(r.error.code, 'E413'); });
t('labels capped (oldest dropped)', () => assert.equal(exec('label.new(bar_index, close, "x")\nplot(close)', { n: 900, header: '//@zscript 1\nindicator("t", max_labels_count=500)\n' }).labels.length, 500));
t('lines capped', () => assert.equal(exec('line.new(bar_index, close, bar_index + 1, close)\nplot(close)', { n: 900, header: '//@zscript 1\nindicator("t", max_lines_count=9999)\n' }).lines.length, 500));
t('boxes capped default 50', () => assert.equal(exec('box.new(bar_index, high, bar_index + 1, low)\nplot(close)', { n: 120 }).boxes.length, 50));
t('table cells cap (E416)', () => assert.equal(err('var t = table.new(position.top_left, 100, 100)\nif barstate.isfirst\n    for c = 0 to 99\n        for r = 0 to 20\n            table.cell(t, c, r, "x")\nplot(close)', { n: 2 }).code, 'E416'));
t('plots cap is a compile error', () => assert.equal(comp(Array.from({ length: 65 }, () => 'plot(close)').join('\n')).ok, false));
t('security cap is a compile error', () => assert.equal(comp(Array.from({ length: 17 }, (_, i) => `a${i} = request.security("", "60", close)`).join('\n') + '\nplot(close)').ok, false));
t('source size cap', () => assert.equal(comp('x = 1\n'.repeat(60000)).ok, false));
t('history cap E402', () => assert.equal(err('k = 501\nplot(close[k])', { n: 600 }).code, 'E402'));
t('deep call nesting caught at compile', () => { const src = Array.from({ length: 80 }, (_, i) => `f${i + 1}(x) => f${i}(x) + 1`).join('\n'); const r = comp('f0(x) => x\n' + src + '\nplot(f80(close))'); assert.equal(r.ok, false); });
t('code size cap at compile', () => { const body = 'f(x) => ' + Array.from({ length: 200 }, () => 'x').join(' + ') + '\ng(x) => ' + Array.from({ length: 200 }, () => 'f(x)').join(' + ') + '\nh(x) => ' + Array.from({ length: 200 }, () => 'g(x)').join(' + ') + '\nplot(h(close))'; const r = comp(body); assert.equal(r.ok, false); assert.ok(r.diagnostics.some((d) => ['E325', 'E342', 'E499'].includes(d.code)), r.diagnostics.map((d) => d.code).join()); });
t('alerts per run capped', () => assert.equal(exec('alert(str.tostring(bar_index), alert.freq_all)\nplot(close)', { n: 900 }).alerts.length, 500));
t('normal script well inside limits', () => assert.equal(exec('plot(ta.ema(close, 9))\nplot(ta.rsi(close, 14))', { n: 5000 }).ok, true));

done('zs-limits');
