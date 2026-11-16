#!/usr/bin/env node
// Ship a new version of an indicator in one command (Owner 15 Nov 2026). docs/INDICATOR-VERSIONS.md.
//   node tools/indver-bump.js <key> <v> "<note>" ["<note 2>" ...] [--date YYYY-MM-DD] [--all] [--root DIR]
//     key   b:<native type> | x:<built-in Pine id> | p:<drawing tool> (the Indicators-window key)
//     v     the new version, above the current one ('1.1')
//     --all the change reaches every chart (a fix): changelog only, no pin, no update button
// What it does:
//   - appends { v, date, notes } to the key's entry in assets/indicator-versions.js (VERSIONS stays plain data).
//   - x: (built-in Pine), unless --all: copies the CURRENT source (git HEAD of assets/pine/<id>.pine when the file has
//     uncommitted edits, else the file itself) to assets/pine-versions/<id>/<old v>.pine and marks that version src: true,
//     so charts on it keep it. Then put the new source in assets/pine/<id>.pine (if you have not already) and bump the build.
//   - b: (native), unless --all: only the manifest line. Gate the old behaviour in the indicator with below(inputs, '<v>').
// --root: run on a copy of the repo (tests).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const ROOT = path.resolve(opt('--root') || path.join(__dirname, '..'));
const DATE = opt('--date') || new Date().toISOString().slice(0, 10);
const ALL = flag('--all');
const [key, v, ...notes] = args;
const die = (m) => { console.error('indver-bump: ' + m); process.exit(1); };
if (!key || !v || !notes.length) die('usage: indver-bump.js <key> <v> "<note>" [--date YYYY-MM-DD] [--all]');
if (!/^(b|x|p|c):[A-Za-z0-9_.-]+$/.test(key)) die('bad key ' + key);
if (!/^\d+\.\d+$/.test(v)) die('bad version ' + v + " (want '1.1')");
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) die('bad --date');
const BANNED = /\b(tradingview|luxalgo|vela|cme|finra|rithmic|insightsentry|databento|bookmap|win rate|profit\w*|guaranteed?|real-time)\b/i;
for (const n of notes) { const b = n.match(BANNED); if (b) die('note uses "' + b[1] + '" (copy rules): ' + n); }

const MAN = path.join(ROOT, 'assets/indicator-versions.js');
const src = fs.readFileSync(MAN, 'utf8');
const block = (s) => { const m = s.match(/export const VERSIONS = (\{[\s\S]*?\n\});/); if (!m) die('VERSIONS block not found'); return m; };
const VERSIONS = vm.runInNewContext('(' + block(src)[1] + ')');
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return (x[0] - y[0]) || (x[1] - y[1]); };
const e = VERSIONS[key];
if (!e) die(key + ' is not in the manifest (run node tools/indver-seed.js, or add its entry by hand)');
const last = e.versions[e.versions.length - 1];
if (cmp(v, last.v) <= 0) die(key + ': ' + v + ' is not above the current ' + last.v);
if (DATE < last.date) die('--date is before the current version\'s date ' + last.date);

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
// The entry's text in the file: from "  '<key>': {" to the matching "] }," / "] }\n" (entries are one balanced object).
const head = '  ' + q(key) + ': {';
const at = src.indexOf(head);
if (at < 0) die(key + ': entry not found as text');
let i = at + head.length - 1, depth = 0, inStr = null;
for (; i < src.length; i++) {
  const c = src[i];
  if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
  if (c === "'" || c === '"' || c === '`') inStr = c;
  else if (c === '{' || c === '[') depth++;
  else if (c === '}' || c === ']') { depth--; if (!depth) break; }
}
const entryText = src.slice(at, i + 1);
// the versions array ends right before the entry's closing brace
const arrEnd = entryText.lastIndexOf(']');
let body = entryText.slice(0, arrEnd).replace(/\s+$/, '');

// x: keep the current source for pinned charts
let snap = null;
if (key.startsWith('x:') && !ALL) {
  const id = key.slice(2);
  const rel = 'assets/pine/' + id + '.pine';
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) die(rel + ' not found (only built-ins with a .pine file can be pinned)');
  let old = null;
  try { old = execFileSync('git', ['-C', ROOT, 'show', 'HEAD:' + rel], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }); } catch (err) { old = null; }
  if (!old) old = fs.readFileSync(file);
  snap = path.join(ROOT, 'assets/pine-versions', id, last.v + '.pine');
  if (fs.existsSync(snap) && !fs.readFileSync(snap).equals(old)) die(path.relative(ROOT, snap) + ' already exists with other text');
  fs.mkdirSync(path.dirname(snap), { recursive: true });
  fs.writeFileSync(snap, old);
  // mark the current last version src: true (its text is the last "{ v: '<last>'" object in the entry)
  const lv = body.lastIndexOf("{ v: " + q(last.v));
  if (lv < 0) die('could not find v' + last.v + ' in the entry text');
  if (!/src: true/.test(body.slice(lv))) body = body.slice(0, lv) + "{ v: " + q(last.v) + ', src: true' + body.slice(lv + ("{ v: " + q(last.v)).length);
}
const line = '{ v: ' + q(v) + ', date: ' + q(DATE) + (ALL ? ', all: true' : '') + ', notes: [' + notes.map(q).join(', ') + '] }';
const one = !/\n/.test(entryText);
const newEntry = one ? body + ', ' + line + entryText.slice(arrEnd) : body + ',\n    ' + line + '\n  ' + entryText.slice(arrEnd);
const out = src.slice(0, at) + newEntry + src.slice(i + 1);
const check = vm.runInNewContext('(' + block(out)[1] + ')');
const ne = check[key];
if (!ne || ne.versions[ne.versions.length - 1].v !== v || ne.base !== e.base) die('internal: the edit did not parse back');
fs.writeFileSync(MAN, out);
console.log(key + ': v' + last.v + ' -> v' + v + (ALL ? ' (all charts)' : '') + (snap ? '; kept ' + path.relative(ROOT, snap) : ''));
if (snap) console.log('next: put the new source in assets/pine/' + key.slice(2) + '.pine, then node tools/gen-indicator-pages.js and bump the build');
else console.log('next: node tools/gen-indicator-pages.js' + (key.startsWith('b:') && !ALL ? "; gate the old behaviour with below(inputs, '" + v + "')" : ''));
