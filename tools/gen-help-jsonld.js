#!/usr/bin/env node
// TradeZoro — Help Center static markup generator.
//
// Reads assets/help/help-data.json and rewrites two marked regions of help.html
// so crawlers and no-JS visitors see real content without running help.js:
//   <!--HELP-JSONLD--> … <!--/HELP-JSONLD-->   FAQPage JSON-LD (every question)
//   <!--HELP-STATIC--> … <!--/HELP-STATIC-->   <noscript> list: every category and
//                                              sub-topic, first questions answered
// Run by hand after editing the data:  node tools/gen-help-jsonld.js
// Run by the deploy workflow too, so the page can never drift from the data.
// Pass --check to exit 1 if help.html is out of date (used by tools/check.py).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'assets', 'help', 'help-data.json');
const PAGE = path.join(ROOT, 'help.html');
const ORIGIN = 'https://tradezoro.com';
const FIRST_PER_CATEGORY = 3;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// answers are our own trusted HTML; keep text-only tags for the structured data
function cleanHtml(html) {
  return String(html).replace(/<p>\s*<img[^>]*>\s*<\/p>/gi, '').replace(/<img[^>]*>/gi, '');
}
function answerHtml(it) {
  let h = cleanHtml(it.a || '');
  if (it.steps && it.steps.length) h += '<ol>' + it.steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>';
  if (it.path) h += '<p>Where to find it: ' + esc(it.path) + '</p>';
  return h;
}
function abs(href) {
  if (/^https?:/i.test(href)) return href;
  return ORIGIN + (href.charAt(0) === '/' ? '' : '/') + href;
}

function build(data) {
  const items = [];
  data.categories.forEach((c) => c.subs.forEach((s) => s.items.forEach((it) => items.push(it))));

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    url: ORIGIN + '/help',
    mainEntity: items.map((it) => ({
      '@type': 'Question',
      name: it.q,
      url: ORIGIN + '/help#' + it.id,
      acceptedAnswer: { '@type': 'Answer', text: answerHtml(it) },
    })),
  };
  const jsonld = '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>';

  let st = '<noscript>\n<div class="hc-static">\n<h2>All topics</h2>\n';
  data.categories.forEach((c) => {
    const n = c.subs.reduce((a, s) => a + s.items.length, 0);
    st += '<section class="hc-static-cat"><h3>' + esc(c.title) + ' (' + n + ')</h3><p>' + esc(c.desc || '') + '</p>\n';
    st += '<p>' + c.subs.map((s) => esc(s.title)).join(' · ') + '</p>\n';
    const first = [];
    c.subs.forEach((s) => s.items.forEach((it) => first.length < FIRST_PER_CATEGORY && first.push(it)));
    first.forEach((it) => {
      st += '<details><summary>' + esc(it.q) + '</summary><div>' + cleanHtml(it.a || '');
      if (it.steps && it.steps.length) st += '<ol>' + it.steps.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol>';
      if (it.path) st += '<p><strong>Where to find it:</strong> ' + esc(it.path) + '</p>';
      st += '</div></details>\n';
    });
    st += '</section>\n';
  });
  st += '<p>Turn on JavaScript to search all ' + items.length + ' questions. Need a person? <a href="support">Go to Support</a> or email <a href="mailto:support@tradezoro.com">support@tradezoro.com</a>.</p>\n</div>\n</noscript>';
  return { jsonld, st, count: items.length };
}

function splice(html, tag, body) {
  const a = '<!--' + tag + '-->', b = '<!--/' + tag + '-->';
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0 || j < i) throw new Error('markers ' + tag + ' missing in help.html');
  return html.slice(0, i + a.length) + '\n' + body + '\n' + html.slice(j);
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const out = build(data);
  const html = fs.readFileSync(PAGE, 'utf8');
  const next = splice(splice(html, 'HELP-JSONLD', out.jsonld), 'HELP-STATIC', out.st);
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('help.html is out of date: run node tools/gen-help-jsonld.js'); process.exit(1); }
    console.log('help.html matches help-data.json (' + out.count + ' questions)');
    return;
  }
  if (next !== html) fs.writeFileSync(PAGE, next);
  console.log('help.html: FAQPage JSON-LD + static fallback for ' + out.count + ' questions' + (next === html ? ' (unchanged)' : ''));
}
main();
