// Build tools/zs-book/src/reference.json from the engine's catalog (assets/zs/catalog.js) so the reference never drifts.
//   node tools/zs-book/gen-reference.mjs        (ZS_CATALOG=/path/to/catalog.js to override)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib.mjs';

const cands = [process.env.ZS_CATALOG, path.join(ROOT, 'assets/zs/catalog.js'), '/root/projects/wt/web-temp-1/assets/zs/catalog.js'].filter(Boolean);
const p = cands.find((c) => fs.existsSync(c));
if (!p) { console.log('catalog.js not found'); process.exit(1); }
const cat = (await import(pathToFileURL(p).href)).catalogJSON();

const GROUPS = [
  ['general', 'General', 'Core helpers: testing for missing values and changing types.', (n) => !n.includes('.') && /^(na|nz|fixnan|int|float|bool|string|color|indicator|input|alert|alertcondition|time|timestamp)$/.test(n) && !/^(indicator|input|alert|alertcondition)$/.test(n)],
  ['declaration', 'Declaration and inputs', 'The indicator() line and every input.* setting.', (n) => n === 'indicator' || n === 'input' || n.startsWith('input.')],
  ['ta', 'Indicators (ta)', 'Moving averages, oscillators, volatility and pattern helpers. Each call keeps its own running memory, so call them on every bar.', (n) => n.startsWith('ta.')],
  ['math', 'Math', 'Numbers and arithmetic.', (n) => n.startsWith('math.')],
  ['str', 'Text (str)', 'Building and reading text.', (n) => n.startsWith('str.')],
  ['color', 'Colors', 'Named colors and ways to make your own.', (n) => n.startsWith('color.')],
  ['array', 'Arrays', 'Lists of values. Method style works too: prices.push(close).', (n) => n.startsWith('array.')],
  ['map', 'Maps', 'Lookup tables from a key to a value.', (n) => n.startsWith('map.')],
  ['plots', 'Plots and chart colors', 'Everything that draws one value per bar. Call these at the top level of your script.', (n) => /^(plot|plotshape|plotchar|plotarrow|plotcandle|plotbar|hline|fill|bgcolor|barcolor)$/.test(n)],
  ['labels', 'Labels', 'Text notes at a price and bar.', (n) => n.startsWith('label.')],
  ['lines', 'Lines', 'Line segments between two points.', (n) => n.startsWith('line.')],
  ['boxes', 'Boxes', 'Rectangles between two corners.', (n) => n.startsWith('box.')],
  ['tables', 'Tables', 'A grid of text pinned to a corner of the pane.', (n) => n.startsWith('table.')],
  ['alerts', 'Alerts', 'Rules and messages that notify you.', (n) => n === 'alert' || n === 'alertcondition'],
  ['request', 'Other symbols and timeframes', 'Read values from another timeframe or symbol. Never looks ahead.', (n) => n.startsWith('request.')],
  ['book', 'Order book (book)', 'Level 2 data: resting orders. Follows your plan like the charts do. Where there is no depth feed you get na and one notice.', (n) => n.startsWith('book.'), 'Pro data. Returns na (plus one notice) when your plan does not include it.'],
  ['flow', 'Order flow (flow)', 'Trades, delta, big trades, footprint and value area, per bar.', (n) => n.startsWith('flow.'), 'Pro data. Returns na (plus one notice) when your plan does not include it.'],
  ['gex', 'GEX levels (gex)', 'Option gamma levels from GEX+. Updated a few minutes at a time, not an instant feed.', (n) => n.startsWith('gex.'), 'GEX+ data. Returns na (plus one notice) when your plan does not include it.'],
  ['opt', 'ZoroOptions (opt)', 'Gamma nodes, ranges, IV rank and more. Updated a few minutes at a time, not an instant feed.', (n) => n.startsWith('opt.'), 'Pro data. Returns na (plus one notice) when your plan does not include it.'],
  ['builtin-vars', 'Built-in variables', 'Values that exist in every script, such as close, bar_index and barstate.islast.', (n) => true],
];
const RET = { num: 'a number', int: 'a whole number', float: 'a number', bool: 'true or false', string: 'text', color: 'a color', void: 'nothing', arg0: 'the same type as the first argument', any: 'any value' };
const retText = (r) => RET[r] || r.replace(/^arr:(.*)$/, 'an array of $1').replace(/^\[(.*)\]$/, 'several values: [$1]');
const defText = (d) => (d === undefined ? '' : d.na ? 'na' : d.var ? d.var : d.color ? String(d.v).slice(0, 7) : JSON.stringify(d.v));

const fnGroup = (name) => GROUPS.find((g) => g[0] !== 'builtin-vars' && g[3](name));
const groups = new Map(GROUPS.map((g) => [g[0], { id: g[0], title: g[1], desc: g[2], plan: g[4] || '' }]));
const functions = [];
for (const f of cat.functions) {
  const g = fnGroup(f.name) || fnGroup('general');
  const gid = fnGroup(f.name) ? g[0] : 'general';
  const sig = f.name + '(' + f.params.map((q) => (q.rest ? '...' : '') + q.name + (q.def !== undefined ? '=' + defText(q.def) : '')).join(', ') + ')';
  const nd = f.data ? ` Needs ${f.data} data on your plan.` : '';
  const notes = [f.state ? 'Call on every bar: it keeps its own running memory.' : '', f.top ? 'Call at the top level of the script.' : ''].filter(Boolean).join(' ');
  functions.push({ group: gid, name: f.name, signature: sig, desc: (f.doc || '') + nd + (notes ? ' ' + notes : ''), returns: retText(f.ret),
    params: f.params.map((q) => ({ name: q.name, type: q.type, desc: q.def !== undefined ? 'Default ' + defText(q.def) : '' })) });
}
const varGroup = (n) => (/^book\./.test(n) ? 'book' : /^flow\./.test(n) ? 'flow' : /^gex\./.test(n) ? 'gex' : /^opt\./.test(n) ? 'opt' : /^ta\./.test(n) ? 'ta' : 'builtin-vars');
for (const v of cat.variables) {
  functions.push({ group: varGroup(v.name), name: v.name, signature: v.name, desc: (v.doc || '') + (v.data ? ` Needs ${v.data} data on your plan.` : ''), returns: retText(v.type), params: [] });
}
const consts = new Map();
for (const c of cat.constants) { const ns = c.name.split('.')[0]; if (!consts.has(ns)) consts.set(ns, []); consts.get(ns).push(c.name); }
const cs = [...consts.entries()].filter(([ns]) => ns !== 'math').map(([ns, names]) => `${ns}: ${names.join(', ')}`).join('\n');
const ordered = GROUPS.map((g) => groups.get(g[0])).filter((g) => functions.some((f) => f.group === g.id));
const out = { generated: path.relative(ROOT, p), counts: { functions: cat.functions.length, variables: cat.variables.length, constants: cat.constants.length }, groups: ordered, functions,
  constantsText: cs, keywords: cat.keywords, types: cat.types };
fs.writeFileSync(path.join(ROOT, 'tools/zs-book/src/reference.json'), JSON.stringify(out, null, 1));
console.log('reference.json:', functions.length, 'entries,', ordered.length, 'groups, from', p);
