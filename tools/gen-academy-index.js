#!/usr/bin/env node
// Writes assets/academy-index.json (search index + path data for /academy) from the real chapter
// catalog (assets/chapters-index.js), the article pages, model seed and the homepage glossary list.
// Prints the counts the stat strip on academy.html must show; --check fails if the page disagrees.
const fs = require('fs'), vm = require('vm'), path = require('path');
const R = path.join(__dirname, '..'), rd = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(rd('assets/chapters-index.js') + ';this.S=CHAPTERS_SEED', ctx);
vm.runInContext(rd('assets/models-data.js').replace(/^const /mg, 'var '), ctx);
const ch = ctx.S;
const articles = fs.readdirSync(R).filter((f) => /^learn-.*\.html$/.test(f)).sort().map((f) => ({
  t: (rd(f).match(/<h1[^>]*>([^<]*)/) || [, f])[1].replace(/&amp;/g, '&').trim(), u: f.replace('.html', '') }));
const gloss = [...rd('tools/gen-vocab.js').matchAll(/nm: '([^']+)', ch: '(\d+)'/g)].map((m) => [m[1], m[2]]);
const idx = {
  ch: ch.map((c) => [c.num, c.title, c.level, c.lessons.map((l) => l.title)]),
  a: articles, g: gloss, m: ctx.MODELS_SEED.map((m) => m.name),
};
const stats = { chapters: ch.length, lessons: ch.reduce((n, c) => n + c.lessons.length, 0), articles: articles.length, glossary: gloss.length, tracks: 2, sheets: 2 };
if (process.argv.includes('--check')) {
  const h = rd('academy.html'); let bad = 0;
  for (const [k, v] of Object.entries(stats)) if (!h.includes('data-stat="' + k + '" data-n="' + v + '"')) { console.log('academy.html stat mismatch:', k, v); bad = 1; }
  process.exit(bad);
}
fs.writeFileSync(path.join(R, 'assets/academy-index.json'), JSON.stringify(idx));
console.log(stats, fs.statSync(path.join(R, 'assets/academy-index.json')).size + ' bytes');
