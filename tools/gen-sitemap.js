#!/usr/bin/env node
// Stryker Trading Academy — sitemap generator
//
// Emits sitemap.xml for the public, indexable pages. Run by the deploy
// workflow on every publish (so <lastmod> is always the current deploy) and
// runnable by hand: node tools/gen-sitemap.js
//
// URLs are extensionless because that is what Cloudflare Pages serves as
// canonical (it 308s /about.html to /about) — a sitemap full of .html URLs
// would list nothing but redirects.

const fs = require('fs');
const path = require('path');

const ORIGIN = 'https://strykertrading.com';

// path (extensionless), priority, changefreq. The homepage and signup carry
// the weight; legal pages exist to be findable, not to rank.
const PAGES = [
  ['/',              '1.0', 'weekly'],
  ['/about',         '0.8', 'monthly'],
  ['/signup',        '0.8', 'monthly'],
  ['/login',         '0.5', 'monthly'],
  ['/contact',       '0.6', 'monthly'],
  ['/support',       '0.6', 'monthly'],
  ['/terms',         '0.3', 'yearly'],
  ['/privacy',       '0.3', 'yearly'],
  ['/cookies',       '0.3', 'yearly'],
  ['/gdpr',          '0.3', 'yearly'],
  ['/refund-policy', '0.3', 'yearly']
];

const today = new Date().toISOString().slice(0, 10);
const xml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  PAGES.map(([p, pri, freq]) =>
    '  <url>\n' +
    '    <loc>' + ORIGIN + p + '</loc>\n' +
    '    <lastmod>' + today + '</lastmod>\n' +
    '    <changefreq>' + freq + '</changefreq>\n' +
    '    <priority>' + pri + '</priority>\n' +
    '  </url>'
  ).join('\n') + '\n' +
  '</urlset>\n';

const out = path.join(__dirname, '..', 'sitemap.xml');
fs.writeFileSync(out, xml);
console.log('sitemap.xml written:', PAGES.length, 'URLs, lastmod', today);
