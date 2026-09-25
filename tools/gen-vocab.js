#!/usr/bin/env node
// Stryker Trading Academy — homepage Core Vocabulary generator ("Constellation")
//
// Writes the #concepts section body on index.html: 14 term nodes, the links
// between them, and one detail panel per term (name, definition, mini chart,
// level and chapter). Everything between the VOCAB:GENERATED markers is
// replaced; nothing outside them is touched. assets/vocab-constellation.js
// animates the result and holds no content of its own.
//
//   node tools/gen-vocab.js           rewrite index.html
//   node tools/gen-vocab.js --check   exit 1 if index.html is out of date
//
// Chapter numbers are checked, not trusted: each term names the chapter that
// teaches it and a pattern that must match that chapter's title or one of its
// lesson titles in tools/content/chapters-data.js. If a chapter is renamed or
// renumbered so the pattern no longer matches, the script stops instead of
// putting a wrong "Ch. NN" on the homepage. The chapter title and level shown
// on each card are read from the same data.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const START = '<!-- VOCAB:GENERATED start — edit tools/gen-vocab.js, not this block -->';
const END = '<!-- VOCAB:GENERATED end -->';

// Course order. `proof` must match the chapter title or a lesson title.
// pos = [x%, y%] in the field on wide screens; ppos = the same at 900px and below.
const TERMS = [
  { k: 'ms', ab: 'MS', nm: 'Market Structure', ch: '04', proof: /swing points|higher-highs/i,
    d: 'Swing highs and lows that define the trend, and show when it shifts.',
    pos: [8, 46], ppos: [11, 50] },
  { k: 'liq', ab: 'BSL/SSL', nm: 'Buy / Sell-Side Liquidity', ch: '07', proof: /BSL, SSL/,
    d: 'Stops resting above old highs (buy-side) and below old lows (sell-side).',
    pos: [21, 15], ppos: [24, 12] },
  { k: 'bos', ab: 'BOS', nm: 'Break of Structure', ch: '08', proof: /Break of Structure/,
    d: 'A close beyond a prior swing in the trend’s direction: continuation.',
    pos: [17, 82], ppos: [12, 87] },
  { k: 'choch', ab: 'CHoCH', nm: 'Change of Character', ch: '08', proof: /CHoCH/,
    d: 'The first close through the last swing against the trend, such as below the last higher low: an early reversal sign.',
    pos: [34, 62], ppos: [33, 66] },
  { k: 'ob', ab: 'OB', nm: 'Order Block', ch: '09', proof: /Order Blocks/,
    d: 'The last opposing candle before a displacement that breaks structure.',
    pos: [40, 26], ppos: [54, 26] },
  { k: 'fvg', ab: 'FVG', nm: 'Fair Value Gap', ch: '10', proof: /Fair Value Gaps/,
    d: 'A three-candle gap where the wicks of candles 1 and 3 don’t overlap.',
    pos: [53, 46], ppos: [60, 54] },
  { k: 'pd', ab: 'PD', nm: 'Premium / Discount', ch: '11', proof: /Premium & Discount/,
    d: 'Above a range’s 50% level is premium; below it is discount.',
    pos: [50, 85], ppos: [46, 89] },
  { k: 'sweep', ab: 'SWEEP', nm: 'Liquidity Sweep', ch: '12', proof: /Liquidity Sweeps/,
    d: 'Price wicks through an old high or low to take the stops resting there, then closes back inside.',
    pos: [62, 13], ppos: [78, 12] },
  { k: 'kz', ab: 'KZ', nm: 'Killzones', ch: '13', proof: /Killzones/,
    d: 'The London and New York windows when displacement is most likely.',
    pos: [68, 68], ppos: [80, 72] },
  { k: 'smt', ab: 'SMT', nm: 'SMT Divergence', ch: '18', proof: /Introduction to SMT Divergence/,
    d: 'Correlated markets disagree: one makes a new high or low, one fails to.',
    pos: [81, 34], ppos: [88, 40] },
  { k: 'judas', ab: 'JUDAS', nm: 'Judas Swing', ch: '23', proof: /Judas Swing/,
    d: 'A false move at the session open that runs liquidity one way before the real move goes the other.',
    pos: [84, 87], ppos: [88, 90] },
  { k: 'amd', ab: 'AMD', nm: 'Power of Three', ch: '24', proof: /Power of Three/,
    d: 'The daily cycle in three phases: accumulation in a range, a manipulation move out of it, then distribution, the real move.',
    pos: [93, 60], ppos: [66, 88] },
  { k: 'ote', ab: 'OTE', nm: 'Optimal Trade Entry', ch: '26', proof: /Optimal Trade Entry/,
    d: 'The 62–79% retracement of a swing, centred on 70.5%: the zone where entries are placed.',
    pos: [92, 14], ppos: [16, 28] },
  { k: 'disp', ab: 'DISP', nm: 'Displacement', ch: '09', proof: /before displacement/i,
    d: 'A fast, one-way run of large-bodied candles that breaks structure and often leaves a fair value gap.',
    pos: [27, 38], ppos: [34, 36] },
];

// How the ideas connect. Each pair is drawn as a line; the card lists them.
const EDGES = [
  ['ms', 'bos'], ['ms', 'choch'], ['bos', 'choch'], ['liq', 'sweep'], ['liq', 'kz'],
  ['sweep', 'disp'], ['disp', 'fvg'], ['disp', 'ob'], ['disp', 'choch'], ['fvg', 'ob'],
  ['fvg', 'pd'], ['ob', 'pd'], ['pd', 'ote'], ['fvg', 'ote'], ['sweep', 'judas'],
  ['kz', 'judas'], ['kz', 'amd'], ['judas', 'amd'], ['smt', 'sweep'], ['smt', 'choch'],
  ['liq', 'ms'], ['amd', 'sweep'],
];

// Order the spotlight walks through when nobody is interacting.
const ORDER = ['sweep', 'disp', 'fvg', 'ob', 'choch', 'smt', 'kz', 'liq', 'pd', 'ote', 'judas', 'amd', 'ms', 'bos'];

// Shown when motion is reduced, and before the script runs.
const STILL = 'fvg';

const LEVELS = { foundation: ['Foundation', 'vc-lv-f'], intermediate: ['Intermediate', 'vc-lv-i'], advanced: ['Advanced', 'vc-lv-a'] };

// ---- mini charts (static SVG; .dr strokes and .fx pieces are animated in by the script)
const UP = '#03c988', DN = '#e5484d';
function cndl(x, o, h, l, c, w = 12) {
  const col = c <= o ? UP : DN, top = Math.min(o, c), bh = Math.max(2, Math.abs(c - o));
  return `<line class="fx" x1="${x}" y1="${h}" x2="${x}" y2="${l}" stroke="${col}" stroke-width="1.4"/><rect class="fx" x="${x - w / 2}" y="${top}" width="${w}" height="${bh}" rx="1.5" fill="${col}"/>`;
}
const pl = (pts, stroke = '#c9cdd3', w = 2) => `<polyline class="dr" pathLength="1" points="${pts}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linejoin="round" stroke-dasharray="1"/>`;
const mini = inner => `<svg class="vc-mini" viewBox="0 0 240 130" aria-hidden="true" focusable="false">${inner}</svg>`;
const MINI = {
  ms: () => mini(pl('14,108 54,70 78,88 124,44 150,64 200,22 226,34') + [[54, 70, 'HH', 't'], [124, 44, 'HH', 't'], [200, 22, 'HH', 't'], [78, 88, 'HL', 'b'], [150, 64, 'HL', 'b']].map(([x, y, t, p]) => `<g class="fx"><circle cx="${x}" cy="${y}" r="3.5" fill="#03c988"/><text class="lbl" x="${x - 8}" y="${p === 't' ? y - 9 : y + 17}">${t}</text></g>`).join('')),
  liq: () => mini(`<g class="fx"><line x1="20" y1="30" x2="232" y2="30" stroke="#4fe3ac" stroke-dasharray="4 4"/><text class="lbl" x="200" y="22">BSL</text></g><g class="fx"><line x1="20" y1="102" x2="232" y2="102" stroke="#f08488" stroke-dasharray="4 4"/><text class="lbl-r" x="200" y="120">SSL</text></g>` + pl('16,70 50,31 80,78 116,32 146,101 176,58 204,31')),
  bos: () => mini(pl('12,104 56,62 96,44 128,86 170,70 214,20') + `<g class="fx"><line x1="96" y1="44" x2="232" y2="44" stroke="#4fe3ac" stroke-width="1.2" stroke-dasharray="4 4"/><text class="lbl" x="118" y="36">BOS</text></g><g class="fx"><circle cx="96" cy="44" r="3.5" fill="#4fe3ac"/><circle cx="194" cy="44" r="4.5" fill="none" stroke="#4fe3ac" stroke-width="1.6"/></g>`),
  choch: () => mini(pl('12,24 48,60 76,44 110,86 136,62 164,104 196,50 228,30') + `<g class="fx"><line x1="136" y1="62" x2="232" y2="62" stroke="#4fe3ac" stroke-width="1.2" stroke-dasharray="4 4"/><text class="lbl" x="196" y="78">CHoCH</text></g><g class="fx"><text x="128" y="54">LH</text><text x="156" y="122">LL</text></g>`),
  ob: () => mini(`<rect class="fx" x="86" y="68" width="28" height="44" rx="3" fill="rgba(3,201,136,.14)" stroke="#4fe3ac" stroke-dasharray="3 3"/><rect class="fx" x="114" y="68" width="116" height="44" fill="rgba(3,201,136,.06)"/>` + cndl(28, 48, 44, 64, 58) + cndl(50, 58, 54, 76, 70) + cndl(72, 70, 66, 90, 84) + cndl(100, 84, 70, 112, 106) + cndl(128, 104, 58, 108, 62) + cndl(152, 62, 28, 66, 32) + cndl(176, 34, 16, 40, 20) + `<text class="lbl fx" x="82" y="126">OB</text>`),
  fvg: () => mini(`<g class="fx"><rect x="60" y="54" width="172" height="26" fill="rgba(3,201,136,.16)"/><line x1="60" y1="54" x2="232" y2="54" stroke="#4fe3ac" stroke-dasharray="3 3"/><line x1="60" y1="80" x2="232" y2="80" stroke="#4fe3ac" stroke-dasharray="3 3"/></g>` + cndl(60, 104, 80, 116, 88, 14) + cndl(100, 88, 24, 94, 30, 16) + cndl(140, 30, 18, 54, 40, 14) + cndl(176, 40, 34, 58, 50) + cndl(204, 50, 26, 54, 32) + `<text class="lbl fx" x="196" y="72">FVG</text>`),
  pd: () => mini(`<rect class="fx" x="20" y="14" width="212" height="51" fill="rgba(229,72,77,.10)"/><rect class="fx" x="20" y="65" width="212" height="51" fill="rgba(3,201,136,.10)"/><g class="fx"><line x1="20" y1="65" x2="232" y2="65" stroke="#c9cdd3" stroke-dasharray="4 4"/><text x="28" y="61">EQ 50%</text><text class="lbl-r" x="28" y="30">PREMIUM</text><text class="lbl" x="28" y="110">DISCOUNT</text></g>` + pl('104,110 142,20 176,94 202,84 226,46')),
  sweep: () => mini(`<g class="fx"><line x1="20" y1="96" x2="232" y2="96" stroke="#f08488" stroke-dasharray="4 4"/><text class="lbl-r" x="200" y="112">SSL</text></g>` + pl('12,50 40,94 66,60 96,95 126,58 150,114 172,70 210,34') + `<g class="fx"><circle cx="150" cy="114" r="7" fill="none" stroke="#4fe3ac" stroke-width="1.6"/><text class="lbl" x="92" y="124">sweep</text></g>`),
  kz: () => mini(`<rect class="fx" x="20" y="58" width="212" height="18" rx="4" fill="#1e1e22"/><rect class="fx" x="54" y="58" width="44" height="18" rx="3" fill="rgba(0,173,181,.55)"/><rect class="fx" x="140" y="58" width="44" height="18" rx="3" fill="rgba(3,201,136,.6)"/><g class="fx"><text x="56" y="48">LONDON</text><text x="138" y="48">NEW YORK</text></g><g class="fx">${[20, 73, 126, 179, 232].map(x => `<line x1="${x}" y1="80" x2="${x}" y2="86" stroke="#5c6472"/>`).join('')}<text x="20" y="104">one trading day</text></g>`),
  smt: () => mini(`<text class="fx" x="12" y="16">EURUSD</text>` + pl('12,56 56,30 88,48 132,22 166,44') + `<text class="fx" x="12" y="80">GBPUSD</text>` + pl('12,120 56,92 88,110 132,100 166,114', '#8b93a0') + `<g class="fx"><line x1="56" y1="30" x2="132" y2="22" stroke="#4fe3ac" stroke-width="1.4"/><text class="lbl" x="140" y="18">higher high</text></g><g class="fx"><line x1="56" y1="92" x2="132" y2="100" stroke="#f08488" stroke-width="1.4"/><text class="lbl-r" x="140" y="96">lower high</text></g><text class="lbl fx" x="182" y="66">SMT</text>`),
  judas: () => mini(`<g class="fx"><line x1="70" y1="14" x2="70" y2="120" stroke="#5c6472" stroke-dasharray="3 3"/><text x="76" y="22">open</text></g>` + pl('14,64 70,62 96,90 110,102 132,70 170,40 226,24') + `<g class="fx"><circle cx="110" cy="102" r="7" fill="none" stroke="#f08488" stroke-width="1.6"/><text class="lbl-r" x="122" y="116">Judas</text></g><text class="lbl fx" x="176" y="58">real move</text>`),
  amd: () => mini(`<rect class="fx" x="14" y="14" width="80" height="102" fill="rgba(0,173,181,.08)"/><rect class="fx" x="94" y="14" width="44" height="102" fill="rgba(229,72,77,.08)"/><rect class="fx" x="138" y="14" width="94" height="102" fill="rgba(3,201,136,.08)"/>` + pl('16,70 30,64 44,72 58,66 72,70 90,68 108,104 124,92 150,62 180,42 226,22') + `<g class="fx"><text x="46" y="28" text-anchor="middle">A</text><text x="116" y="28" text-anchor="middle" class="lbl-r">M</text><text x="186" y="28" text-anchor="middle" class="lbl">D</text></g>`),
  ote: () => mini(`<g class="fx"><rect x="120" y="77" width="112" height="16" fill="rgba(3,201,136,.16)"/><line x1="120" y1="77" x2="232" y2="77" stroke="#4fe3ac" stroke-dasharray="3 3"/><line x1="120" y1="93" x2="232" y2="93" stroke="#4fe3ac" stroke-dasharray="3 3"/></g>` + pl('16,112 120,20 170,80 226,36') + `<g class="fx"><text class="lbl" x="176" y="108">OTE 62–79%</text></g>`),
  disp: () => mini(cndl(24, 78, 72, 88, 82, 10) + cndl(42, 82, 74, 90, 76, 10) + cndl(60, 76, 70, 86, 80, 10) + cndl(78, 80, 72, 88, 74, 10) + cndl(102, 74, 56, 76, 58, 14) + cndl(124, 58, 36, 60, 38, 14) + cndl(146, 38, 18, 40, 20, 14) + cndl(170, 20, 14, 30, 26, 10) + cndl(190, 26, 16, 30, 18, 10) + `<text class="lbl fx" x="20" y="32">displacement</text>`),
};

function loadChapters() {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'content', 'chapters-data.js'), 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + '\n;this.__C = CHAPTERS_SEED;', ctx);
  return ctx.__C;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function build() {
  const chapters = loadChapters();
  const byNum = Object.fromEntries(chapters.map(c => [c.num, c]));
  const T = Object.fromEntries(TERMS.map(t => [t.k, t]));
  const errors = [];

  for (const t of TERMS) {
    const c = byNum[t.ch];
    if (!c) { errors.push(`${t.ab}: chapter ${t.ch} does not exist`); continue; }
    const hay = [c.title, ...(c.lessons || []).map(l => l.title)];
    if (!hay.some(h => t.proof.test(h))) errors.push(`${t.ab}: nothing in chapter ${t.ch} ("${c.title}") matches ${t.proof}`);
    if (!LEVELS[c.level]) errors.push(`${t.ab}: chapter ${t.ch} has unknown level "${c.level}"`);
    if (!MINI[t.k]) errors.push(`${t.ab}: no mini chart`);
  }
  for (const [a, b] of EDGES) if (!T[a] || !T[b]) errors.push(`link ${a}–${b} names an unknown term`);
  if (new Set(ORDER).size !== TERMS.length || ORDER.some(k => !T[k])) errors.push('ORDER must list every term exactly once');
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

  const rel = k => EDGES.filter(e => e.includes(k)).map(e => (e[0] === k ? e[1] : e[0]));
  const I = '  ';

  const nodes = TERMS.map(t =>
    `${I}${I}${I}<li class="vc-node" data-k="${t.k}" style="--x:${t.pos[0]}%;--y:${t.pos[1]}%;--px:${t.ppos[0]}%;--py:${t.ppos[1]}%">` +
    `<div class="vc-sc"><span class="vc-ring" aria-hidden="true"></span>` +
    `<button type="button" class="vc-pill" aria-controls="vc-card"${t.k === STILL ? ' aria-current="true"' : ''} aria-label="${esc(t.nm)}, chapter ${t.ch}">${esc(t.ab)}<small aria-hidden="true">CH ${t.ch}</small></button></div></li>`
  ).join('\n');

  const panels = TERMS.map(t => {
    const c = byNum[t.ch];
    const [lvName, lvCls] = LEVELS[c.level];
    return `${I}${I}<div class="vc-in${t.k === STILL ? ' on' : ''}" data-k="${t.k}"${t.k === STILL ? '' : ' hidden'}>\n` +
      `${I}${I}${I}<h3 class="vc-k">${esc(t.nm)}</h3>\n` +
      `${I}${I}${I}<div class="vc-ab">${esc(t.ab)}</div>\n` +
      `${I}${I}${I}<p class="vc-d">${esc(t.d)}</p>\n` +
      `${I}${I}${I}${MINI[t.k]()}\n` +
      `${I}${I}${I}<div class="vc-meta"><span class="vc-lv ${lvCls}">${lvName}</span><span class="vc-ch">Ch. ${t.ch} · ${esc(c.title)}</span></div>\n` +
      `${I}${I}${I}<div class="vc-rel">Links to <b>${rel(t.k).map(k => esc(T[k].ab)).join(' · ')}</b></div>\n` +
      `${I}${I}</div>`;
  }).join('\n');

  return [
    START,
    `${I}<div class="vc">`,
    `${I}${I}<div class="vc-field" data-order="${ORDER.join(' ')}" data-still="${STILL}" data-edges="${EDGES.map(e => e.join(':')).join(' ')}">`,
    `${I}${I}${I}<div class="vc-glow" aria-hidden="true"></div>`,
    `${I}${I}${I}<svg class="vc-edges" aria-hidden="true" focusable="false"></svg>`,
    `${I}${I}${I}<ul class="vc-nodes" aria-label="Core vocabulary: ${TERMS.length} terms">`,
    nodes,
    `${I}${I}${I}</ul>`,
    `${I}${I}${I}<span class="vc-axis" aria-hidden="true">${TERMS.length} terms · ${EDGES.length} links</span>`,
    `${I}${I}${I}<button type="button" class="vc-pause" aria-pressed="false" hidden>Pause motion</button>`,
    `${I}${I}</div>`,
    `${I}${I}<div class="vc-card" id="vc-card" role="region" aria-label="Selected term">`,
    panels,
    `${I}${I}</div>`,
    `${I}${I}<p class="sr-only" id="vc-live" aria-live="polite"></p>`,
    `${I}</div>`,
    `${I}${END}`,
  ].join('\n');
}

const html = fs.readFileSync(INDEX, 'utf8');
const a = html.indexOf(START), b = html.indexOf(END);
if (a < 0 || b < 0 || b < a) { console.error('VOCAB:GENERATED markers not found in index.html'); process.exit(1); }
const next = html.slice(0, a) + build() + html.slice(b + END.length);
if (process.argv.includes('--check')) {
  if (next !== html) { console.error('vocab block is out of date: run node tools/gen-vocab.js'); process.exit(1); }
  console.log('vocab block up to date');
} else {
  fs.writeFileSync(INDEX, next);
  console.log(`wrote ${TERMS.length} terms, ${EDGES.length} links`);
}
