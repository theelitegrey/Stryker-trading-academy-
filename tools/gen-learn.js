#!/usr/bin/env node
// Stryker Trading Academy — "Learn" article generator
//
// Builds the public, crawlable Learn section from tools/learn/<slug>.html
// (article body only) and the ARTICLES list below:
//   learn.html               index of all articles
//   learn-<slug>.html        one page per article
// Each page gets the site nav/footer, canonical + Open Graph tags, Article and
// BreadcrumbList JSON-LD, the end-of-article signup CTA (tagged
// utm_source=google&utm_medium=organic&utm_campaign=<slug>), and the
// education-only disclaimer. The cache version comes from assets/version.json,
// and the pages are ordinary root *.html files, so check.py and the build
// bump cover them like every other page.
//
//   node tools/gen-learn.js           write the pages
//   node tools/gen-learn.js --check   exit 1 if any page is out of date
//
// To add an article: write tools/learn/<slug>.html, add an entry below, add
// '/learn-<slug>' to tools/gen-sitemap.js, run this, then check.py.

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://strykertrading.com';
const BUILD = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/version.json'), 'utf8')).build;

const ARTICLES = [
  {
    slug: 'fair-value-gap',
    title: 'What Is a Fair Value Gap (FVG)? The Three-Candle Rule Explained',
    short: 'What is a fair value gap (FVG)?',
    description: 'A fair value gap is a three-candle pattern where the wicks of candles 1 and 3 do not overlap. Learn how to spot bullish and bearish FVGs, why traders watch them, and common mistakes.',
    dek: 'The three-candle pattern behind one of the most-used ICT concepts: how to identify it with a strict rule, why traders watch it, and where beginners go wrong.',
    published: '2026-09-23', modified: '2026-09-23'
  },
  {
    slug: 'order-blocks',
    title: 'Order Blocks Explained: How to Identify a Valid Order Block',
    short: 'Order blocks explained',
    description: 'An order block is the last opposing candle before a strong move. Learn bullish and bearish order blocks, the three checks that make one worth watching, and mitigated vs unmitigated blocks.',
    dek: 'A tighter definition of one of the most loosely used ideas in smart money trading, with the checks that separate a real order block from a random candle.',
    published: '2026-09-23', modified: '2026-09-23'
  },
  {
    slug: 'liquidity-sweeps',
    title: 'Liquidity Sweeps and Stop Hunts: What They Are and How to Spot Them',
    short: 'Liquidity sweeps and stop hunts',
    description: 'A liquidity sweep is a quick move beyond an obvious high or low that closes back inside the range. Learn where stops cluster, how to tell a sweep from a breakout, and common mistakes.',
    dek: 'Why price so often spikes through an obvious level and then reverses, where the orders behind that move sit, and how to tell a sweep from a genuine breakout.',
    published: '2026-09-23', modified: '2026-09-23'
  },
  {
    slug: 'prop-firm-challenge-rules',
    title: 'How to Pass a Prop Firm Challenge: Drawdown, Daily Loss & Consistency Rules',
    short: 'How to pass a prop firm challenge: the rules that matter',
    description: 'Static vs end-of-day vs intraday trailing drawdown, daily loss limits, consistency and payout rules, quoted from Topstep, Apex, Tradeify and other firms, with a calculator.',
    dek: 'Most challenges end on a rule, not a bad read. Static, end-of-day and intraday trailing drawdown on the same trades, daily loss limits, consistency and payout rules, quoted from the firms themselves.',
    published: '2026-09-23', modified: '2026-09-23',
    cta: 'signup'
  },
  {
    slug: 'bos-vs-choch',
    title: 'Break of Structure vs Change of Character (BOS vs CHoCH) Explained',
    short: 'Break of structure vs change of character (BOS vs CHoCH)',
    description: 'BOS is a break of a swing point with the trend; CHoCH is the first break against it. Step through an interactive chart and learn which swing counts, wicks vs closes, and common mistakes.',
    dek: 'The two market structure labels every smart money chart uses, stepped through on an interactive chart: what each break means, which swing counts, and why a wick is not a break.',
    published: '2026-09-23', modified: '2026-09-23'
  },
  {
    slug: 'smt-divergence',
    title: 'SMT Divergence Explained: ES vs NQ and Correlated Pairs',
    short: 'SMT divergence explained',
    description: 'SMT divergence is when two correlated markets such as ES and NQ disagree at a high or low. See bullish and bearish SMT side by side, how traders use it, and its limits.',
    dek: 'When two markets that normally move together disagree at a key high or low. Bullish and bearish SMT side by side on ES and NQ, inverse pairs like EUR/USD and DXY, and where the idea breaks down.',
    published: '2026-09-23', modified: '2026-09-23'
  },
  {
    slug: 'volume-profile',
    title: 'Volume Profile Explained: POC, Value Area, HVN and LVN',
    short: 'Volume profile explained',
    description: 'A volume profile shows how much traded at each price. Learn the point of control, the 70% value area and how to calculate it, HVNs and LVNs, and why futures volume beats forex tick volume.',
    dek: 'How a volume profile is built, what the POC, value area, HVNs and LVNs mean, a value-area calculation by hand, and why the data behind the profile matters.',
    published: '2026-09-24', modified: '2026-09-24',
    cta: 'signup'
  },
  {
    slug: 'order-flow',
    title: 'Order Flow Trading Explained: The DOM, Footprint Charts and Delta',
    short: 'Order flow trading explained',
    description: 'Order flow is the study of the orders behind price. Learn market vs limit orders, the DOM, FIFO matching, footprint charts, delta and diagonal imbalances, and what order flow cannot tell you.',
    dek: 'Market and limit orders, the order book, how CME matches trades, footprint charts, delta and imbalances, worked through on illustrative data, plus the limits of what order flow shows.',
    published: '2026-09-24', modified: '2026-09-24',
    cta: 'signup'
  },
  {
    slug: 'how-prop-firms-work',
    title: 'How Prop Firms Work: Evaluations, Funded Accounts and How They Make Money',
    short: 'How prop firms work',
    description: 'How futures and forex prop firms work: the evaluation, what a funded account really is, how firms make money, a worked cost example, and what to check before you pay.',
    dek: 'The evaluation, what "funded" usually means, where the money goes, a worked cost example with published prices, and a checklist for vetting a firm before you pay.',
    published: '2026-09-25', modified: '2026-09-25',
    cta: 'signup'
  }
];

// End-of-article calls to action. 'cheatsheet' is the default.
const CTAS = {
  cheatsheet: (slug, utm) => `<h2 id="cta-${slug}">Get the free FVG &amp; Order Block cheat sheet</h2>
<p>Two pages with the rules we teach for fair value gaps and order blocks. Create a free account to download it and read the first chapters of the curriculum.</p>
<a class="btn btn-primary" href="cheat-sheet.html?${utm}">Get the free cheat sheet</a>
<a class="btn btn-ghost" href="signup.html?${utm}">Create a free account</a>`,
  signup: (slug, utm) => `<h2 id="cta-${slug}">Learn the method as written lessons with chart diagrams</h2>
<p>Create a free account to read the first chapters of the curriculum and get the free FVG &amp; Order Block cheat sheet. The course is education only and makes no promise that you will pass a challenge.</p>
<a class="btn btn-primary" href="signup.html?${utm}">Create a free account</a>
<a class="btn btn-ghost" href="cheat-sheet.html?${utm}">Get the free cheat sheet</a>`
};

// FAQ pairs for FAQPage JSON-LD: every <h3> + following <p> inside .lx-faq.
function faqs(body) {
  const m = body.match(/<div class="lx-faq">([\s\S]*?)<\/div>/);
  if (!m) return [];
  const txt = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return [...m[1].matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((x) => (
    { '@type': 'Question', name: txt(x[1]), acceptedAnswer: { '@type': 'Answer', text: txt(x[2]) } }));
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const V = (p) => `${p}?v=${BUILD}`;
const LOGO = `${ORIGIN}/assets/images/logo-header.png`;
const OG_IMAGE = `${ORIGIN}/assets/images/og-image.png`;
const DISCLAIMER = 'Education only. Not financial advice. Trading foreign exchange, indices, futures and commodities carries a high level of risk and may not be suitable for everyone. The concepts here describe how some traders read charts; they do not predict what price will do.';

function words(html) {
  return html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').split(/\s+/).filter(Boolean).length;
}

function head({ title, description, url, ogType, jsonld }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="stryker-build" content="${BUILD}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="Stryker Trading Academy">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${OG_IMAGE}">
<meta name="theme-color" content="#050506">
<title>${esc(title)} | Stryker Trading Academy</title>
<link rel="canonical" href="${url}">
${HEAD_ASSETS}
<script type="application/ld+json">
${JSON.stringify(jsonld, null, 2)}
</script>
</head>`;
}

// Nav and footer are the site's standard public ones (as on about.html).
const about = fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8');
const NAV = about.slice(about.indexOf('<nav class="nav"'), about.indexOf('</nav>') + 6)
  .replace('<a href="features.html">Features</a>', '<a href="features.html">Features</a>\n      <a href="learn.html">Learn</a>');
const FOOTER = about.slice(about.indexOf('<footer>'), about.indexOf('</footer>') + 9)
  ;  // about.html's footer already links Learn
if (!NAV.includes('learn.html') || !FOOTER.includes('learn.html')) throw new Error('nav/footer anchors moved; update gen-learn.js');

// Everything else in <head> (stylesheet, scripts, icons, theme snippet) and
// the scripts after the footer are copied from about.html, so Learn pages load
// exactly what every other public page loads (auth, theme, seo overrides,
// first-touch tracking) and pick up changes to that list automatically.
const ver = (html) => html.replace(/\?v=\d+/g, '?v=' + BUILD);
const HEAD_ASSETS = ver(about.slice(about.indexOf('<link rel="stylesheet"'), about.indexOf('</head>')).trim())
  .replace(/(<link rel="stylesheet" href="assets\/style\.css\?v=\d+">)/, `$1\n<link rel="stylesheet" href="${V('assets/learn.css')}">`);
if (!HEAD_ASSETS.includes('learn.css') || /application\/ld\+json|<title|canonical/.test(HEAD_ASSETS)) throw new Error('about.html <head> layout changed; update gen-learn.js');
const SCRIPTS = '\n' + ver(about.slice(about.indexOf('</footer>') + 9, about.indexOf('</body>')).trim());
if (!SCRIPTS.includes('auth.js') || !SCRIPTS.includes('theme.js')) throw new Error('about.html footer scripts changed; update gen-learn.js');

function page(parts) {
  return `${head(parts)}
<body data-page-key="${parts.key}">
<a class="skip-link" href="#main">Skip to content</a>

${NAV}
<main id="main" tabindex="-1">
${parts.main}
</main>
${FOOTER}
${SCRIPTS}
</body>
</html>
`;
}

const PUBLISHER = { '@type': 'Organization', name: 'Stryker Trading Academy', url: ORIGIN + '/',
  logo: { '@type': 'ImageObject', url: LOGO } };

function articlePage(a) {
  const url = `${ORIGIN}/learn-${a.slug}`;
  const body = fs.readFileSync(path.join(__dirname, 'learn', a.slug + '.html'), 'utf8').trim();
  const n = words(body);
  // Launch articles were 900-1400; the in-depth standard from batch 2 on is 1200-2500.
  if (n < 900 || n > 2500) throw new Error(`${a.slug}: ${n} words, outside 900-2500`);
  if (/<!-- FIG:/.test(body) && /<!-- FIG:(\w+) -->\s*<!-- \/FIG/.test(body)) throw new Error(`${a.slug}: empty figure, run python3 tools/learn/figs.py`);
  const faq = faqs(body);
  const interactive = /class="[^"]*\b(lx-ix|lx-quiz|lx-calc)\b/.test(body);
  const utm = `utm_source=google&utm_medium=organic&utm_campaign=${a.slug}`;
  const others = ARTICLES.filter((x) => x.slug !== a.slug);
  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Article', headline: a.short.replace(/\?$/, '?'), name: a.title, description: a.description,
        image: [OG_IMAGE], datePublished: a.published, dateModified: a.modified, wordCount: n,
        inLanguage: 'en', author: PUBLISHER, publisher: PUBLISHER,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url }, isAccessibleForFree: true },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: ORIGIN + '/' },
        { '@type': 'ListItem', position: 2, name: 'Learn', item: ORIGIN + '/learn' },
        { '@type': 'ListItem', position: 3, name: a.short, item: url } ] }
    ].concat(faq.length ? [{ '@type': 'FAQPage', mainEntity: faq }] : [])
  };
  const d = new Date(a.modified + 'T00:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const main = `<div class="lx-wrap">
<nav class="lx-crumbs" aria-label="Breadcrumb"><a href="index.html">Home</a> / <a href="learn.html">Learn</a> / <span aria-current="page">${esc(a.short)}</span></nav>
<article>
<header class="lx-head">
<h1>${esc(a.short)}</h1>
<p class="lx-dek">${esc(a.dek)}</p>
<p class="lx-meta">Stryker Trading Academy · Updated <time datetime="${a.modified}">${d}</time> · ${Math.max(1, Math.round(n / 220))} min read</p>
</header>
<div class="lx-body">
${body}
</div>
<aside class="lx-cta" aria-labelledby="cta-${a.slug}">
${CTAS[a.cta || 'cheatsheet'](a.slug, utm)}
</aside>
<p class="lx-disclaimer">${DISCLAIMER}</p>
</article>
<section class="lx-related" aria-labelledby="rel-${a.slug}">
<h2 id="rel-${a.slug}">Keep reading</h2>
<ul class="lx-list">
${others.slice(0, 4).map((o) => `<li><a class="lx-card" href="learn-${o.slug}.html"><h3>${esc(o.short)}</h3><p>${esc(o.dek)}</p><span>Read the article →</span></a></li>`).join('\n')}
</ul>
</section>
</div>`;
  const extra = interactive ? `\n<script src="${V('assets/learn-ix.js')}" defer></script>` : '';
  return page({ title: a.title, description: a.description, url, ogType: 'article', jsonld, key: 'learn-' + a.slug, main: main + extra });
}

function indexPage() {
  const url = `${ORIGIN}/learn`;
  const description = 'Free, plain-English guides to ICT and smart money concepts: market structure, fair value gaps, order blocks, liquidity sweeps, SMT divergence and prop firm rules.';
  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', name: 'Learn: free ICT & smart money guides', description, url, publisher: PUBLISHER,
        hasPart: ARTICLES.map((a) => ({ '@type': 'Article', headline: a.short, url: `${ORIGIN}/learn-${a.slug}` })) },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: ORIGIN + '/' },
        { '@type': 'ListItem', position: 2, name: 'Learn', item: url } ] }
    ]
  };
  const main = `<div class="lx-wrap">
<nav class="lx-crumbs" aria-label="Breadcrumb"><a href="index.html">Home</a> / <span aria-current="page">Learn</span></nav>
<header class="lx-head">
<h1>Learn</h1>
<p class="lx-dek">Free, plain-English guides to the ICT and smart money concepts we teach, with simple diagrams. Start with any of them.</p>
</header>
<ul class="lx-list">
${ARTICLES.map((a) => `<li><a class="lx-card" href="learn-${a.slug}.html"><h2>${esc(a.short)}</h2><p>${esc(a.dek)}</p><span>Read the article →</span></a></li>`).join('\n')}
</ul>
<aside class="lx-cta" aria-labelledby="cta-learn">
<h2 id="cta-learn">Get the free FVG &amp; Order Block cheat sheet</h2>
<p>Two pages with the rules we teach. Create a free account to download it.</p>
<a class="btn btn-primary" href="cheat-sheet.html?utm_source=google&amp;utm_medium=organic&amp;utm_campaign=learn">Get the free cheat sheet</a>
</aside>
<p class="lx-disclaimer">${DISCLAIMER}</p>
</div>`;
  return page({ title: 'Learn: Free ICT & Smart Money Trading Guides', description, url, ogType: 'website', jsonld, key: 'learn', main });
}

const out = { 'learn.html': indexPage() };
ARTICLES.forEach((a) => { out[`learn-${a.slug}.html`] = articlePage(a); });

const check = process.argv.includes('--check');
let stale = 0;
for (const [f, html] of Object.entries(out)) {
  const p = path.join(ROOT, f);
  const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  if (cur === html) continue;
  if (check) { console.error(`${f} is out of date: run node tools/gen-learn.js`); stale++; }
  else { fs.writeFileSync(p, html); console.log('wrote', f); }
}
if (check) { if (stale) process.exit(1); console.log('learn pages up to date'); }

module.exports = { ARTICLES };
