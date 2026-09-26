#!/usr/bin/env node
// Stryker Trading Academy — homepage curriculum generator
//
// Writes the #curriculum "price path" block on index.html from
// tools/content/chapters-data.js, so the chapter numbers, titles, level counts and
// ranges on the homepage come from the same data the courses page is seeded
// from and are never retyped. Everything between the CURRICULUM:GENERATED
// markers in index.html is replaced; nothing outside them is touched.
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
//
// Layout: an illustrative rising price line crosses three level zones, then
// four cards (Foundation, Intermediate, Advanced, Start here). The chart is
// written here as finished static SVG (one wide, one phone-sized, swapped by
// CSS), so without scripting, or with reduced motion, the section shows the
// final frame and nothing shifts when the animation starts. The line is a
// drawing, not market data. assets/curriculum-path.js animates it.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { trackChapters } = require('./gen-chapters-index.js');

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
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'content', 'chapters-data.js'), 'utf8');
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

  const lv3 = LEVELS.map(([lv, label, cls]) => ({ lv, label, cls, list: of(lv) }));
  const total = chapters.length;
  const ty = t => `<em class="cp-ty">${esc(t)}</em>`;

  const card = ({ lv, label, cls, list }, i) => {
    const body = PICKS[lv]
      ? `<ul class="cp-list">
${PICKS[lv].map(n => `          <li><span>${n}</span>${ty(byNum[n].title)}</li>`).join('\n')}
        </ul>`
      : `<ul class="cp-list cp-th">
${ADV_GROUPS.map(([name, nums]) => `          <li>${ty(name)}<b>${ranges(nums).replace('CH. ', '')}</b></li>`).join('\n')}
        </ul>`;
    return `    <div class="cp-cell"><div class="cp-card ${cls}" id="cp-card-${i}">
        <div class="cur-glow" aria-hidden="true"></div>
        <div class="cp-top"><div class="cp-big" aria-hidden="true" data-n="${list.length}">${pad(list.length)}</div><div><h3>${label}</h3><div class="cp-rng">${ranges(list.map(c => c.num))} · ${list.length} chapters</div></div></div>
        ${body}
      </div></div>`;
  };

  return `${START}
  <div class="cp">
    <div class="cp-chart" aria-hidden="true">
${chart(lv3, false)}
${chart(lv3, true)}
    </div>
    <div class="cp-tabs" role="group" aria-label="Show a level">
${['Foundation', 'Intermediate', 'Advanced', 'Start'].map((t, i) => `      <button type="button" class="cp-tab" aria-controls="cp-card-${i}" aria-pressed="${i === 3}">${t}</button>`).join('\n')}
    </div>
    <div class="cp-cards">
${lv3.map(card).join('\n')}
    <div class="cp-cell"><div class="cp-card cp-start" id="cp-card-3">
        <span class="cp-sweep" aria-hidden="true"></span>
        <div><div class="cur-k">Start here · Free</div><h3>${esc(byNum['01'].title)}</h3><p>Chapters 1–7 free with a free account. No card required.</p></div>
        <a href="chapter?ch=01" class="btn btn-primary"><span class="cp-sweep" aria-hidden="true"></span>Start Chapter 01</a>
      </div></div>
    </div>
    <div class="cur-foot cp-foot">
      <a href="courses" class="btn btn-ghost">See all ${total + trackChapters().length} chapters</a>
    </div>
  </div>
  ${END}`;
}

// ---- the illustrative chart ------------------------------------------------
// A deterministic rising line (no randomness, so --check is stable) through
// three equal zones, one per level. phone=true is a narrower, taller-scaled
// version with fewer candles. Numbers are rounded to keep the markup small.
const ZC = ['#00adb5', '#03c988', '#f08488'];
const ZRGB = ['0,173,181', '3,201,136', '240,132,136'];
const r1 = v => Math.round(v * 10) / 10;

function chart(levels, phone) {
  const W = phone ? 360 : 1160, H = phone ? 178 : 228;
  // R leaves room for the glowing head (r=12) at the end of the line.
  const L = phone ? 8 : 14, R = W - (phone ? 18 : 22), TOP = phone ? 44 : 46, BOT = H - 12;
  const NC = phone ? 27 : 39, step = (R - L) / NC;
  const cl = [];
  for (let k = 0; k <= NC; k++) cl.push(100 + k * 1.05 + 2.4 * Math.sin(k * 1.25) + 1.3 * Math.sin(k * 0.57 + 1));
  const lo = Math.min(...cl) - 3, hi = Math.max(...cl) + 3;
  const X = k => L + (k + 0.5) * step, Y = p => TOP + (hi - p) / (hi - lo) * (BOT - TOP);
  const bx = k => L + k * (R - L) / 3;
  const fs1 = phone ? 10.5 : 12, fs2 = phone ? 9.5 : 11;
  const id = phone ? 'm' : 'd';
  let s = `      <svg class="cp-svg cp-svg-${id}" viewBox="0 0 ${W} ${H}" data-l="${L}" data-r="${R}" data-step="${r1(step)}" focusable="false">
      <defs><linearGradient id="cp-g-${id}" x1="${L}" x2="${R}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${ZC[0]}"/><stop offset=".333" stop-color="${ZC[0]}"/><stop offset=".333" stop-color="${ZC[1]}"/><stop offset=".666" stop-color="${ZC[1]}"/><stop offset=".666" stop-color="${ZC[2]}"/><stop offset="1" stop-color="${ZC[2]}"/></linearGradient>
      <clipPath id="cp-c-${id}"><rect class="cp-clip" x="${L}" y="0" width="${R - L}" height="${H}"/></clipPath></defs>\n`;
  levels.forEach(({ label, list }, k) => {
    s += `      <g class="cp-band"><rect x="${r1(bx(k))}" y="${TOP - 36}" width="${r1((R - L) / 3)}" height="${r1(BOT - TOP + 36)}" fill="rgba(${ZRGB[k]},.06)"/>`;
    if (k) s += `<line x1="${r1(bx(k))}" y1="${TOP - 36}" x2="${r1(bx(k))}" y2="${BOT}" stroke="rgba(${ZRGB[k]},.45)" stroke-dasharray="3 4"/>`;
    s += `<text x="${r1(bx(k) + 8)}" y="${TOP - 20}" fill="${ZC[k]}" font-size="${fs1}" font-weight="700" letter-spacing=".08em">${label.toUpperCase()}</text>`;
    s += `<text x="${r1(bx(k) + 8)}" y="${TOP - 6}" fill="#8b93a0" font-size="${fs2}">${ranges(list.map(c => c.num))}</text></g>\n`;
  });
  for (let i = 0; i < 4; i++) { const yy = r1(TOP + i * (BOT - TOP) / 3); s += `      <line x1="${L}" y1="${yy}" x2="${R}" y2="${yy}" stroke="#15161a"/>\n`; }
  const bw = r1(Math.min(14, step * 0.5));
  for (let k = 0; k < NC; k++) {
    const o = cl[k], c = cl[k + 1], col = c >= o ? '#03c988' : '#e5484d';
    const h = Math.max(o, c) + 0.5 + 0.6 * Math.abs(Math.sin(k * 2.1)), l = Math.min(o, c) - 0.5 - 0.6 * Math.abs(Math.cos(k * 1.7));
    const top = Y(Math.max(o, c)), bh = Math.max(2, Math.abs(Y(o) - Y(c)));
    s += `      <g class="cp-cn" data-x="${r1(X(k))}"><line x1="${r1(X(k))}" y1="${r1(Y(h))}" x2="${r1(X(k))}" y2="${r1(Y(l))}" stroke="${col}" stroke-width="1.3" opacity=".55"/><rect x="${r1(X(k) - bw / 2)}" y="${r1(top)}" width="${bw}" height="${r1(bh)}" rx="1.5" fill="${col}" opacity=".45"/></g>\n`;
  }
  const pts = [];
  for (let k = 0; k <= NC; k++) pts.push([r1(k === 0 ? L : (k === NC ? R : X(k - 0.5) + step / 2)), r1(Y(cl[k]))]);
  const ps = pts.map(p => p.join(',')).join(' ');
  const [ex, ey] = pts[pts.length - 1];
  s += `      <g clip-path="url(#cp-c-${id})"><polyline class="cp-line" points="${ps}" fill="none" stroke="url(#cp-g-${id})" stroke-width="${phone ? 2.6 : 3}" stroke-linejoin="round" stroke-linecap="round"/></g>
      <circle class="cp-halo" r="12" fill="rgba(79,227,172,.25)" transform="translate(${ex} ${ey})"/><circle class="cp-head" r="5" fill="#fff" transform="translate(${ex} ${ey})"/>
      </svg>`;
  return s;
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
