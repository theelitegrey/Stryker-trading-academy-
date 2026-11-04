// TradeZoro — indicator catalogue builder (node only; used by tools/gen-indicator-pages.js).
//
// Every row of the ZoroCharts Indicators window, from code:
//   tools/indicator-pages/registry.json  the window's built-in rows + each native's settings schema,
//                                        dumped from a real chart by dump-registry.js (re-run it when a
//                                        native indicator is added or renamed)
//   assets/chart-pine-builtins.js        PICKER_SCRIPTS (TradeZoro picks + third-party community scripts)
//   assets/chart-pine-scripts.js         the Pine examples
//   assets/chart-pro-gate.js             OF_TYPES / GEX_TYPES = the Pro tools
// Hand-written write-ups: tools/indicator-pages/content/<slug>.json, merged in by the generator.
// Slugs are permanent: tools/indicator-pages/slugs.json maps window key -> slug; new keys get a new
// slug appended, an existing one is never changed (links, favourites and search results rely on it).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const HERE = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Hub groups, in chip order.
const GROUPS = ['TradeZoro', 'Order flow', 'Moving averages', 'Oscillators', 'Volatility', 'Volume', 'Trend', 'Levels', 'Community'];
const WIN_GROUP = { 'Order Flow': 'Order flow' };

function pickerScripts() {
  const src = read('assets/chart-pine-builtins.js');
  const m = src.match(/export const PICKER_SCRIPTS = (\[[\s\S]*?\n\]);/);
  const list = vm.runInNewContext(m[1]);
  // Third-party sources and licence notes live in the comment block above each entry.
  const lines = src.split('\n');
  list.forEach((b) => {
    const i = lines.findIndex((l) => l.includes("id: '" + b.id + "'"));
    const notes = [];
    for (let j = i - 1; j >= 0 && /^\s*\/\//.test(lines[j]); j--) notes.unshift(lines[j].replace(/^\s*\/\/\s?/, ''));
    b.comment = notes.join(' ');
  });
  const picks = vm.runInNewContext(src.match(/export const STRYKER_PICKS = (\[[^\]]*\]);/)[1]);
  return { list, picks };
}

function examples() {
  const src = read('assets/chart-pine-scripts.js');
  const m = src.match(/var EXAMPLES = (\[[\s\S]*?\n  \]);/);
  return vm.runInNewContext(m[1]);
}

function proTypes() {
  const src = read('assets/chart-pro-gate.js');
  const arr = (name) => vm.runInNewContext(src.match(new RegExp('export const ' + name + ' = (\\[[\\s\\S]*?\\]);'))[1]);
  return { of: arr('OF_TYPES'), gex: arr('GEX_TYPES') };
}

// ---- Pine input() parser: settings table for Pine scripts --------------------------------------
function splitTop(s) {
  const out = []; let depth = 0, cur = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') { cur += s[++i] || ''; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const unq = (s) => (/^(["']).*\1$/s.test(s) ? s.slice(1, -1) : null);

function pineInputs(source) {
  const src = source.replace(/\r/g, '');
  // string constants (GROUP = "Settings", var string G_X = '...') so group= identifiers resolve
  const consts = {};
  for (const m of src.matchAll(/^\s*(?:var\s+)?(?:const\s+)?(?:string\s+)?([A-Za-z_]\w*)\s*=\s*("[^"\n]*"|'[^'\n]*')\s*(?:\/\/.*)?$/gm)) consts[m[1]] = m[2].slice(1, -1);
  const val = (s) => { if (s == null) return null; const u = unq(s); if (u != null) return u; return consts[s] != null ? consts[s] : null; };
  const rows = [];
  const re = /\binput(?:\.(int|float|bool|string|color|source|timeframe|session|symbol|price|time|text_area|enum))?\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    // skip comments
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    if (src.slice(lineStart, m.index).includes('//')) continue;
    let i = re.lastIndex, depth = 1, q = null;
    for (; i < src.length && depth; i++) {
      const c = src[i];
      if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'") q = c; else if (c === '(') depth++; else if (c === ')') depth--;
    }
    const args = splitTop(src.slice(re.lastIndex, i - 1).replace(/\n\s*/g, ' '));
    re.lastIndex = i;
    const pos = [], kw = {};
    args.forEach((a) => { const k = a.match(/^([a-z_]+)\s*=(?!=)\s*([\s\S]*)$/); if (k) kw[k[1]] = k[2].trim(); else pos.push(a); });
    let def = kw.defval || pos[0] || '';
    const title = val(kw.title || pos[1]) || '';
    if (!title) continue;
    const type = m[1] || (/^(true|false)$/.test(def) ? 'bool' : /^-?\d+$/.test(def) ? 'int' : /^-?[\d.]+$/.test(def) ? 'float' : unq(def) != null ? 'string' : 'source');
    const dq = unq(def); if (dq != null) def = dq;
    let options = [];
    if (kw.options) options = splitTop(kw.options.replace(/^\[|\]$/g, '')).map((o) => (unq(o) != null ? unq(o) : o));
    rows.push({ title, type, def: def.slice(0, 60), options: options.slice(0, 16), group: val(kw.group) || '', tooltip: (val(kw.tooltip) || '').slice(0, 220) });
  }
  return rows;
}

function pineAlerts(source) {
  const src = source.replace(/\r/g, '');
  const out = [];
  for (const m of src.matchAll(/^\s*alertcondition\s*\(([^\n]*)\)/gm)) {
    const a = splitTop(m[1]);
    const kw = {}; const pos = [];
    a.forEach((x) => { const k = x.match(/^([a-z_]+)\s*=(?!=)\s*(.*)$/); if (k) kw[k[1]] = k[2]; else pos.push(x); });
    const t = unq(kw.title || pos[1] || '');
    if (t && !out.includes(t)) out.push(t);
  }
  const anyAlert = /^\s*(?:if .*\n\s+)?alert\s*\(/m.test(src) || /\balert\s*\(\s*["'a-zA-Z]/.test(src.replace(/alertcondition\s*\(/g, ''));
  return { conditions: out, anyAlert };
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[°+]/g, (c) => (c === '+' ? ' plus ' : '')).replace(/%/g, ' percent ').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 70).replace(/-+$/, '');
}

// Licence text from the source header: never ship a page for NonCommercial scripts.
function licenceOf(source) {
  const head = source.slice(0, 3000);
  if (/NonCommercial|by-nc|non-commercial/i.test(head)) return 'CC BY-NC-SA 4.0';
  if (/Mozilla Public License 2\.0/i.test(head)) return 'MPL 2.0';
  return '';
}

// Names that would collide or read badly as a slug.
const SLUG_HINT = { 'b:stk_of_delta': 'delta-trades', 'b:stk_of_cvd': 'cumulative-delta-trades', 'b:stk_dsuite': 'delta-styles', 'b:stk_ts_dsuite': 'delta-styles-l1',
  'b:stk_dpane': 'delta-pane', 'b:stk_ts_dpane': 'delta-pane-l1', 'b:stk_footprint': 'footprint', 'b:stk_of_sweep': 'stop-runs-sweeps', 'b:stk_of_vp': 'volume-profile-trades',
  'b:stk_of_vwap': 'vwap-trades', 'b:stk_tide': 'zorotide', 'b:stk_offex': 'off-exchange-volume', 'b:stk_offex_lv': 'off-exchange-levels', 'b:stk_avwap': 'anchored-vwap',
  'p:avwap-click': 'anchored-vwap-click', 'p:frvp': 'fixed-range-volume-profile', 'b:stk_estcvd': 'estimated-cvd', 'b:stk_liqmap': 'liquidity-map', 'b:stk_bk_track': 'absorption-iceberg-tracker',
  'x:realtime-big-trades-bubbles-samet-lezki': 'real-time-big-trades-bubbles', 'x:dynamic-liquidity-heatmap-profile-bigbeluga': 'dynamic-liquidity-heatmap-profile',
  'x:ifvg-degree-pro-plus': 'ifvg-degree-pro-plus', 'x:trinity-atr-levels': 'trinity-atr-levels', 'x:ict-pro-plus-timmynq': 'ict-pro-plus-timmynq', 'x:wcsmc-sp': 'wcsmc-sp-v3' };

function buildCatalog() {
  const reg = JSON.parse(fs.readFileSync(path.join(HERE, 'registry.json'), 'utf8'));
  const schemaByType = new Map(reg.rows.filter((r) => r.native).map((r) => [r.nativeType, r.schema]));
  const { list: picker, picks } = pickerScripts();
  const exList = examples();
  const pro = proTypes();
  const items = new Map();   // key -> item
  const skipped = [];
  const add = (it) => { if (!items.has(it.key)) items.set(it.key, it); else Object.assign(items.get(it.key), { also: it.group }); };

  // window order: Technicals (grouped), Order Flow, TradeZoro tab, Top (third-party)
  const rows = [].concat(reg.window.tech, reg.window.orderflow, reg.window.stryker, reg.window.top);
  for (const r of rows) {
    const k = r.key;
    const kind = k.startsWith('b:') ? 'native' : k.startsWith('p:') ? 'tool' : 'pine';
    const id = k.slice(2);
    const it = { key: k, kind, id, name: r.name, author: r.author === 'Built-in' ? 'TradeZoro' : r.author, builtIn: r.author === 'Built-in',
      group: r.third ? 'Community' : (WIN_GROUP[r.grp] || r.grp), short: r.desc || '', third: !!r.third };
    if (kind === 'native') {
      it.type = id;
      // The L2 tick-stream tools all run on the Pro order-book feed; the Delta Ladder is added by Delta (L2) / CVD (L2).
      it.plan = pro.of.includes(id) || pro.gex.includes(id) || /^stk_l2f_/.test(id) ? 'Pro' : 'Free';
      it.proKind = pro.of.includes(id) ? 'of' : pro.gex.includes(id) ? 'gex' : null;
      const sc = schemaByType.get(id);
      if (sc) { it.overlay = sc.overlay; it.settings = (sc.inputs || []).map((i) => ({ title: i.title, type: i.type, def: i.def, options: i.options || [], group: i.group || '', tooltip: i.tooltip || '' })); }
      it.alerts = { plot: !/^stk_/.test(id) };
    } else if (kind === 'tool') {
      it.plan = 'Free'; it.settings = [];
    } else {
      const b = picker.find((x) => x.id === id);
      const ex = exList.find((x) => x.id === 'example:' + id);
      let source = '';
      if (b) {
        source = read('assets/' + b.source.split('?')[0]);
        it.sourceFile = 'assets/' + b.source.split('?')[0];
        it.licence = licenceOf(source);
        it.comment = b.comment;
        const url = (b.comment + ' ' + source.slice(0, 3000)).match(/https:\/\/www\.tradingview\.com\/(?:script|v)\/[A-Za-z0-9]+[^\s)$]*/);
        it.originalUrl = url ? url[0].replace(/[),.]+$/, '') : '';
        if (!it.short && b.desc) it.short = b.desc;
        it.short = it.short.replace(/\s*Source: tradingview\.com\/\S+/i, '');
      } else if (ex) { source = ex.source; it.sourceFile = 'assets/chart-pine-scripts.js'; }
      it.plan = 'Free';
      it.settings = pineInputs(source);
      it.alerts = pineAlerts(source);
      it.lines = source.split('\n').length;
      if (it.licence === 'CC BY-NC-SA 4.0' || /NonCommercial|NOT shipped/i.test(it.comment || '')) {
        if (it.licence === 'CC BY-NC-SA 4.0') { skipped.push({ key: k, name: r.name, why: 'licence is CC BY-NC-SA 4.0 (NonCommercial) in the source header' }); continue; }
      }
    }
    add(it);
  }
  // TradeZoro natives not in the window list (none expected) would be missed: report them.
  const picksMissing = picks.filter((k) => !items.has(k));

  // permanent slugs
  const slugFile = path.join(HERE, 'slugs.json');
  const slugs = fs.existsSync(slugFile) ? JSON.parse(fs.readFileSync(slugFile, 'utf8')) : {};
  const used = new Set(Object.values(slugs));
  for (const it of items.values()) {
    if (!slugs[it.key]) {
      let s = SLUG_HINT[it.key] || slugify(it.name.replace(/\s*\[TradeZoro\]/, '').replace(/^TradeZoro /, '').replace(/\s*\((?!L1|L2)[^)]*\)/g, ''));
      if (used.has(s)) s = slugify(it.name + ' ' + it.id.replace(/^stk_/, ''));
      let n = 2; while (used.has(s)) s = s + '-' + n++;
      slugs[it.key] = s; used.add(s);
    }
    it.slug = slugs[it.key];
  }
  fs.writeFileSync(slugFile, JSON.stringify(slugs, null, 1) + '\n');
  return { items: [...items.values()], skipped, picksMissing, groups: GROUPS, build: reg.build };
}

module.exports = { buildCatalog, pineInputs, pineAlerts, slugify, GROUPS };

if (require.main === module) {
  const c = buildCatalog();
  const by = {};
  c.items.forEach((x) => { by[x.group] = (by[x.group] || 0) + 1; });
  console.log(c.items.length, 'items', by, 'skipped', c.skipped, 'picks missing', c.picksMissing);
  if (process.argv[2] === '--list') c.items.forEach((x) => console.log([x.slug, x.key, x.group, x.plan, x.author, x.name, (x.settings || []).length, x.licence || '', x.originalUrl || ''].join(' | ')));
}
