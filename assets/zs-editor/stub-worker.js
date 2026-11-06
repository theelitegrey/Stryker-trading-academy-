// TradeZoro — Zscript PREVIEW engine (classic Web Worker). Started by assets/chart-zscript.js ONLY while the real
// engine (assets/zs/worker.js, Zscript stream 1) is not in the repo. Same message protocol as the real one:
// /root/projects/stryker-notes/reports/workers/zscript/contract.md, "S2 -> S1".
//
// WHAT IT DOES: no interpreter. It reads the script's declarations with regular expressions (indicator title and
// overlay, input.* calls, the plot/hline/fill/plotshape calls and their title / colour / width / style). A plot is
// computed only when its value is a plain ta.sma / ta.ema / ta.rsi of a price source (through simple `x = ...`
// assignments); every other plot draws na. Every result carries a notice saying so. It never evaluates member text (no eval, no Function, no imports, no network).
'use strict';

const NOTE = 'Preview engine: the Zscript engine is not switched on yet, so only simple averages and RSI are drawn.';
const HEADER = /^\s*\/\/@zscript\s+1\s*$/;
const COLORS = { aqua: '#00BCD4', black: '#363A45', blue: '#2196F3', fuchsia: '#E040FB', gray: '#787B86', green: '#4CAF50', lime: '#00E676', maroon: '#880E4F', navy: '#311B92', olive: '#808000', orange: '#FF9800', purple: '#9C27B0', red: '#F23645', silver: '#B2B5BE', teal: '#089981', white: '#FFFFFF', yellow: '#FDD835' };

const strip = (line) => { // drop a // comment that is not inside a string
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
};

// Unbalanced brackets / unterminated strings, with line:col.
function syntax(lines){
  const stack = [];
  for (let n = 0; n < lines.length; n++) {
    const s = strip(lines[n]);
    let q = null, qc = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; qc = i; continue; }
      if (c === '(' || c === '[') stack.push({ c, line: n + 1, col: i + 1 });
      else if (c === ')' || c === ']') {
        const top = stack.pop();
        const want = c === ')' ? '(' : '[';
        if (!top || top.c !== want) return { line: n + 1, col: i + 1, severity: 'error', message: 'Unexpected "' + c + '".', hint: top ? 'The "' + top.c + '" opened on line ' + top.line + ' is not closed yet.' : 'Remove it, or add the matching "' + want + '" before it.' };
      }
    }
    if (q) return { line: n + 1, col: qc + 1, severity: 'error', message: 'This text is missing its closing ' + q + '.', hint: 'Add ' + q + ' at the end of the text.' };
  }
  const t = stack.pop();
  return t ? { line: t.line, col: t.col, severity: 'error', message: 'This "' + t.c + '" is never closed.', hint: 'Add the matching "' + (t.c === '(' ? ')' : ']') + '".' } : null;
}

// Split call arguments at top-level commas.
function args(s){
  const out = []; let depth = 0, q = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') { cur += s[++i] || ''; } else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') { if (depth === 0) break; depth--; }
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  const pos = [], named = {};
  out.forEach((a) => { const m = /^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]*)$/.exec(a); if (m) named[m[1]] = m[2]; else pos.push(a); });
  return { pos, named };
}
const str = (a) => { const m = /^(["'])((?:\\.|(?!\1).)*)\1$/.exec(String(a || '').trim()); return m ? m[2].replace(/\\(.)/g, '$1') : null; };
const num = (a) => { const v = Number(String(a || '').trim()); return Number.isFinite(v) ? v : null; };
function color(a){
  a = String(a || '').trim();
  let m = /^color\.(\w+)$/.exec(a); if (m && COLORS[m[1]]) return COLORS[m[1]];
  m = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(a); if (m) return a;
  m = /^color\.new\(\s*color\.(\w+)\s*,\s*(\d+(?:\.\d+)?)\s*\)$/.exec(a);
  if (m && COLORS[m[1]]) { const al = Math.round(255 * (1 - Math.min(100, +m[2]) / 100)); return COLORS[m[1]] + al.toString(16).padStart(2, '0'); }
  return null;
}

// Every call of `fn(` in the script: { line, assign, args }
function calls(lines, fn){
  const out = [];
  const re = new RegExp('(?:^|[^\\w.])' + fn.replace('.', '\\.') + '\\s*\\(', 'g');
  lines.forEach((raw, n) => {
    const s = strip(raw);
    re.lastIndex = 0; let m;
    while ((m = re.exec(s))) {
      const start = m.index + m[0].length;
      const asg = /^\s*([A-Za-z_]\w*)\s*=(?!=)/.exec(s.slice(0, m.index + 1));
      out.push({ line: n + 1, assign: asg ? asg[1] : null, args: args(s.slice(start)) });
    }
  });
  return out;
}

function compile(source){
  const lines = String(source || '').split('\n');
  const diagnostics = [];
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first < 0 || !HEADER.test(lines[first])) {
    diagnostics.push({ line: Math.max(1, first + 1), col: 1, severity: 'error', message: 'A Zscript file starts with the line //@zscript 1.', hint: 'Add //@zscript 1 as the first line.' });
    return { ok: false, diagnostics };
  }
  const bad = syntax(lines);
  if (bad) return { ok: false, diagnostics: [bad] };
  const ind = calls(lines, 'indicator')[0];
  if (!ind) return { ok: false, diagnostics: [{ line: first + 2, col: 1, severity: 'error', message: 'The script has no indicator(...) declaration.', hint: 'Add indicator("My script", overlay=true) after the first line.' }] };
  const title = (str(ind.args.pos[0] || ind.args.named.title) || 'Zscript').slice(0, 80);
  const overlay = /^true$/.test(String(ind.args.named.overlay || '').trim());
  const inputs = [];
  ['int', 'float', 'bool', 'string', 'color', 'source', 'timeframe'].forEach((t) => calls(lines, 'input.' + t).forEach((c) => {
    const d = c.args.pos[0] != null ? c.args.pos[0] : c.args.named.defval;
    let defval = t === 'int' || t === 'float' ? num(d) : t === 'bool' ? /^true$/.test(String(d).trim()) : t === 'color' ? (color(d) || '#089981') : t === 'source' ? String(d || 'close').trim() : (str(d) || '');
    if (defval == null) defval = 0;
    const key = c.assign || ('in' + inputs.length);
    const inp = { key, title: str(c.args.pos[1] || c.args.named.title) || key, type: t, defval, line: c.line };
    ['minval', 'maxval', 'step'].forEach((k, i) => { const v = num(c.args.named[k]); if (v != null) inp[['min', 'max', 'step'][i]] = v; });
    const g = str(c.args.named.group); if (g) inp.group = g;
    const opts = /^\[(.*)\]$/.exec(String(c.args.named.options || '').trim());
    if (opts) inp.options = opts[1].split(',').map((x) => str(x) != null ? str(x) : x.trim()).filter((x) => x !== '');
    inputs.push(inp);
  }));
  inputs.sort((a, b) => a.line - b.line);
  inputs.forEach((i) => delete i.line);
  const program = {
    title, overlay, inputs,
    plots: calls(lines, 'plot').map((c, k) => ({ k, line: c.line, assign: c.assign, expr: c.args.pos[0] || c.args.named.series || '', title: str(c.args.pos[1] || c.args.named.title) || 'Plot ' + (k + 1), color: color(c.args.named.color), linewidth: num(c.args.named.linewidth) || 1, style: (/plot\.style_(\w+)/.exec(c.args.named.style || '') || [])[1] || 'line' })),
    hlines: calls(lines, 'hline').map((c, k) => ({ k, assign: c.assign, price: num(c.args.pos[0]), title: str(c.args.pos[1] || c.args.named.title) || 'Level', color: color(c.args.named.color) || '#787B86', linestyle: (/hline\.style_(\w+)/.exec(c.args.named.linestyle || '') || [])[1] || 'dashed' })).filter((h) => h.price != null),
    fills: calls(lines, 'fill').map((c) => ({ a: c.args.pos[0], b: c.args.pos[1], color: color(c.args.pos[2] || c.args.named.color) || '#08998122' })),
    shapes: calls(lines, 'plotshape').map((c, k) => ({ k, cond: c.args.pos[0] || c.args.named.series || '', title: str(c.args.pos[1] || c.args.named.title) || 'Shape', shape: (/shape\.(\w+)/.exec(c.args.named.style || '') || [])[1] || 'circle', location: (/location\.(\w+)/.exec(c.args.named.location || '') || [])[1] || 'abovebar', color: color(c.args.named.color) || '#089981', size: (/size\.(\w+)/.exec(c.args.named.size || '') || [])[1] || 'small' }))
  };
  program.vars = {};
  lines.forEach((raw) => { const m = /^\s*(?:var\s+|varip\s+)?(?:(?:int|float|bool|string|color)\s+)?([A-Za-z_]\w*)\s*=(?!=)\s*(.+)$/.exec(strip(raw)); if (m && !/^(?:input|plot|hline|fill|plotshape|indicator)\b/.test(m[2].trim()) && program.vars[m[1]] == null) program.vars[m[1]] = m[2].trim(); });
  return { ok: true, meta: { title, overlay }, inputs, diagnostics, program };
}

// Placeholder maths: ONLY the plain forms below are computed (correctly) from the bars; anything else draws na.
// Never invent values (no fake order book / GEX numbers): a plot that needs the real engine stays empty.
function sma(v, n){ const out = []; let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; out.push(i < n - 1 ? NaN : s / n); } return out; }
function ema(v, n){ const out = []; const k = 2 / (n + 1); let e = NaN; for (let i = 0; i < v.length; i++) { e = i === 0 ? v[0] : v[i] * k + e * (1 - k); out.push(i < n - 1 ? NaN : e); } return out; }
function rsi(v, n){
  const out = []; let up = 0, dn = 0;
  for (let i = 0; i < v.length; i++) {
    const d = i ? v[i] - v[i - 1] : 0;
    if (i <= n) { up += Math.max(d, 0) / n; dn += Math.max(-d, 0) / n; }
    else { up = (up * (n - 1) + Math.max(d, 0)) / n; dn = (dn * (n - 1) + Math.max(-d, 0)) / n; }
    out.push(i < n ? NaN : dn === 0 ? 100 : 100 - 100 / (1 + up / dn));
  }
  return out;
}
function sources(bars){
  const o = bars.map((b) => +b.open), h = bars.map((b) => +b.high), l = bars.map((b) => +b.low), c = bars.map((b) => +b.close);
  return { open: o, high: h, low: l, close: c, volume: bars.map((b) => +b.volume || 0),
    hl2: h.map((x, i) => (x + l[i]) / 2), hlc3: h.map((x, i) => (x + l[i] + c[i]) / 3), ohlc4: h.map((x, i) => (x + l[i] + c[i] + o[i]) / 4) };
}

function run(p, bars, inputs){
  const src = sources(bars), n = bars.length, NA = () => new Array(n).fill(NaN);
  const inp = {}; (p.inputs || []).forEach((i) => { inp[i.key] = inputs && inputs[i.key] != null ? inputs[i.key] : i.defval; });
  const memo = new Map();
  const len = (a, d) => { a = String(a || '').trim(); const v = /^\d+$/.test(a) ? +a : inp[a] != null ? +inp[a] : NaN; return Math.max(1, Math.min(5000, Math.round(Number.isFinite(v) ? v : d))); };
  function series(expr, depth){
    expr = String(expr || '').trim();
    if (depth > 6) return null;
    if (src[expr]) return src[expr];
    if (typeof inp[expr] === 'string' && src[inp[expr]]) return src[inp[expr]];
    if (p.vars[expr] != null) { if (!memo.has(expr)) memo.set(expr, series(p.vars[expr], depth + 1)); return memo.get(expr); }
    const m = /^ta\.(ema|sma|rsi)\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*|\d+)\s*\)$/.exec(expr);
    if (!m) return null;
    const s = series(m[2], depth + 1);
    if (!s) return null;
    return (m[1] === 'ema' ? ema : m[1] === 'sma' ? sma : rsi)(s, len(m[3], 14));
  }
  let computed = 0;
  const plots = p.plots.map((pl) => {
    const v = series(pl.expr, 0);
    if (v) computed++;
    return { id: 'p' + pl.k, title: pl.title, style: pl.style, values: v || NA(), color: pl.color || ['#089981', '#FF9800', '#2196F3', '#E040FB'][pl.k % 4], linewidth: pl.linewidth };
  });
  const hlines = p.hlines.map((h) => ({ id: 'h' + h.k, title: h.title, price: h.price, color: h.color, linestyle: h.linestyle, linewidth: 1 }));
  const ref = (name) => { const pl = p.plots.find((x) => x.assign === name); if (pl) return 'p' + pl.k; const h = p.hlines.find((x) => x.assign === name); return h ? 'h' + h.k : null; };
  const fills = p.fills.map((f, i) => ({ id: 'f' + i, a: ref(f.a), b: ref(f.b), color: f.color })).filter((f) => f.a && f.b);
  const shapes = p.shapes.map((s) => {
    const marks = [];
    const m = /^ta\.(crossover|crossunder)\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*\)$/.exec(s.cond);
    const a = m && series(m[2], 0), b = m && series(m[3], 0);
    if (a && b) for (let i = 1; i < n; i++) {
      const hit = m[1] === 'crossover' ? a[i] > b[i] && a[i - 1] <= b[i - 1] : a[i] < b[i] && a[i - 1] >= b[i - 1];
      if (hit) marks.push({ i, location: s.location, shape: s.shape, color: s.color, size: s.size });
    }
    return { id: 's' + s.k, title: s.title, marks };
  });
  const notices = [NOTE];
  if (computed < plots.length) notices.push('Preview engine: ' + (plots.length - computed) + ' of ' + plots.length + ' plots need the Zscript engine and are empty for now.');
  return { plots, hlines, fills, shapes, notices };
}

const programs = new Map(); // sessionId -> program
self.onmessage = (e) => {
  const m = e.data || {};
  try {
    if (m.kind === 'compile') {
      const r = compile(m.source);
      self.postMessage(Object.assign({ kind: 'compiled', reqId: m.reqId }, r));
    } else if (m.kind === 'run') {
      let p = m.program;
      if (!p) { const r = compile(m.source); if (!r.ok) { self.postMessage({ kind: 'error', sessionId: m.sessionId, diag: r.diagnostics[0] }); return; } p = r.program; }
      programs.set(m.sessionId, p);
      self.postMessage({ kind: 'result', sessionId: m.sessionId, output: run(p, m.bars || [], m.inputs || {}) });
    } else if (m.kind === 'stop') programs.delete(m.sessionId);
  } catch (err) {
    self.postMessage({ kind: 'error', sessionId: m.sessionId, reqId: m.reqId, diag: { line: 1, col: 1, severity: 'error', message: 'The preview engine failed: ' + String(err && err.message || err) } });
  }
};
