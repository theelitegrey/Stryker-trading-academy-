#!/usr/bin/env node
// Stryker Trading Academy — homepage curriculum generator
//
// Writes the #curriculum bento on index.html from assets/chapters-data.js, so
// the chapter numbers, titles, level counts and ranges on the homepage come
// from the same data the courses page is seeded from and are never retyped.
// Everything between the CURRICULUM:GENERATED markers in index.html is
// replaced; nothing outside them is touched.
//
//   node tools/gen-curriculum.js           rewrite index.html
//   node tools/gen-curriculum.js --check   exit 1 if index.html is out of date
//
// Run it after changing chapter titles or levels in chapters-data.js. The
// live site reads chapters from Firestore once seeded; if a title is edited
// there instead, edit the seed too so the homepage and the reader agree.
//
// The Advanced level is shown as six groups. Groups are defined here by chapter
// number; the script fails if any Advanced chapter is missing from a group or
// listed twice, so a new chapter cannot silently drop off the homepage.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const START = '<!-- CURRICULUM:GENERATED start — edit tools/gen-curriculum.js, not this block -->';
const END = '<!-- CURRICULUM:GENERATED end -->';

// Chapters picked to represent Foundation and Intermediate on their cards.
const PICKS = { foundation: ['01', '02', '04', '07'], intermediate: ['08', '09', '10', '14'] };

// Advanced, grouped by theme. Every Advanced chapter must appear exactly once.
const ADV_GROUPS = [
  ['SMT divergence', ['17', '18', '19', '20', '27', '28', '29']],
  ['Refinement: OB, FVG, OTE', ['21', '22', '26']],
  ['Price delivery & ranges', ['23', '24', '25', '30', '31', '32', '33']],
  ['Your playbook', ['34', '35', '42']],
  ['Risk & execution', ['36', '37', '38']],
  ['Review, live & funded', ['39', '40', '41']],
];

const LEVELS = [
  ['foundation', 'Foundation', 'cur-f'],
  ['intermediate', 'Intermediate', 'cur-i'],
  ['advanced', 'Advanced', 'cur-a'],
];

function loadChapters() {
  const src = fs.readFileSync(path.join(ROOT, 'assets', 'chapters-data.js'), 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + '\n;this.__C = CHAPTERS_SEED;', ctx);
  return ctx.__C.map(c => ({ num: c.num, title: c.title, level: c.level }));
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad = n => String(n).padStart(2, '0');

// "17, 18, 19, 20, 27" -> "CH. 17–20 · 27"
function ranges(nums) {
  const ns = nums.map(Number).sort((a, b) => a - b);
  const out = [];
  let a = ns[0], b = ns[0];
  for (const n of ns.slice(1).concat([null])) {
    if (n === b + 1) { b = n; continue; }
    out.push(a === b ? pad(a) : pad(a) + '–' + pad(b));
    a = b = n;
  }
  return 'CH. ' + out.join(' · ');
}

function build() {
  const chapters = loadChapters();
  const byNum = Object.fromEntries(chapters.map(c => [c.num, c]));
  const of = lv => chapters.filter(c => c.level === lv);

  for (const [lv] of LEVELS) if (!of(lv).length) throw new Error('no chapters at level ' + lv);
  for (const [lv, picks] of Object.entries(PICKS)) {
    for (const n of picks) {
      if (!byNum[n]) throw new Error('pick ' + n + ' is not a chapter');
      if (byNum[n].level !== lv) throw new Error('pick ' + n + ' is not ' + lv);
    }
  }
  const adv = of('advanced').map(c => c.num);
  const grouped = ADV_GROUPS.flatMap(g => g[1]);
  const missing = adv.filter(n => !grouped.includes(n));
  const extra = grouped.filter(n => !adv.includes(n));
  const dupes = grouped.filter((n, i) => grouped.indexOf(n) !== i);
  if (missing.length || extra.length || dupes.length) {
    throw new Error('Advanced groups out of step with the data — missing: [' + missing +
      '] not advanced: [' + extra + '] listed twice: [' + dupes + ']');
  }
  if (!byNum['01']) throw new Error('chapter 01 missing');

  const card = (lv, label, cls) => {
    const list = of(lv);
    const nums = list.map(c => c.num);
    return `    <div class="cur-card ${cls}">
      <div class="cur-glow" aria-hidden="true"></div>
      <div class="cur-big">${pad(list.length)}</div>
      <h3>${label}</h3>
      <div class="cur-rng">${ranges(nums)} · ${list.length} chapters</div>
      <ul class="cur-list">
${PICKS[lv].map(n => `        <li><span>${n}</span>${esc(byNum[n].title)}</li>`).join('\n')}
      </ul>
    </div>`;
  };

  const advList = of('advanced');
  const total = chapters.length;
  return `${START}
  <div class="cur-bento">
${card('foundation', 'Foundation', 'cur-f')}
${card('intermediate', 'Intermediate', 'cur-i')}
    <div class="cur-card cur-start">
      <div>
        <div class="cur-k">Start here · Free</div>
        <h3>${esc(byNum['01'].title)}</h3>
        <p>Chapter 01 is free with an account. Each chapter after it unlocks the next.</p>
      </div>
      <a href="chapter.html?ch=01" class="btn btn-primary">Start Chapter 01</a>
    </div>
    <div class="cur-card cur-a">
      <div class="cur-glow" aria-hidden="true"></div>
      <div>
        <div class="cur-big">${pad(advList.length)}</div>
        <h3>Advanced</h3>
        <div class="cur-rng">${ranges(advList.map(c => c.num))} · ${advList.length} chapters</div>
        <p>Where the method becomes execution — divergence, delivery, and your own rules.</p>
      </div>
      <ul class="cur-themes">
${ADV_GROUPS.map(([name, nums]) => `        <li class="cur-theme"><h4>${esc(name)}</h4><p>${ranges(nums)}</p></li>`).join('\n')}
      </ul>
    </div>
  </div>

  <div class="cur-foot">
    <a href="courses.html" class="btn btn-ghost">See all ${total} chapters</a>
  </div>
  ${END}`;
}

function main() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a < 0 || b < 0 || b < a) throw new Error('CURRICULUM:GENERATED markers not found in index.html');
  const next = html.slice(0, a) + build() + html.slice(b + END.length);
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('index.html curriculum is out of date — run node tools/gen-curriculum.js'); process.exit(1); }
    console.log('curriculum block up to date');
    return;
  }
  fs.writeFileSync(INDEX, next);
  console.log(next === html ? 'curriculum block unchanged' : 'curriculum block rewritten');
}

try { main(); } catch (e) { console.error('gen-curriculum: ' + e.message); process.exit(1); }
