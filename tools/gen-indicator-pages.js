#!/usr/bin/env node
// TradeZoro — indicator pages generator ("like TradingView's script pages", Owner 2026-11-04)
//
// One public page per row of the ZoroCharts Indicators window, plus the /indicators hub:
//   indicators.html               the catalogue (search, group chips, cards)
//   indicators/<slug>.html        one page per indicator (served at /indicators/<slug>)
//   assets/indicators-catalog.json  the data file the pages are built from
// Sources (nothing hand-typed here): tools/indicator-pages/catalog.js (window rows from registry.json,
// PICKER_SCRIPTS, the Pine examples, the Pro lists) + the write-ups in tools/indicator-pages/content/<slug>.json
// + the chart captures (tools/indicator-pages/capture.js -> images.py).
//
// A new indicator gets a page by: re-running dump-registry.js (natives) -> writing content/<slug>.json ->
// capture.js + images.py -> this script -> python3 tools/og/gen_og.py --only <its pages> -> check.py.
// Slugs are permanent (tools/indicator-pages/slugs.json).
//
//   node tools/gen-indicator-pages.js           write everything
//   node tools/gen-indicator-pages.js --check   exit 1 if any output is out of date (also run after a build bump)
'use strict';
const fs = require('fs');
const path = require('path');
const { buildCatalog, GROUPS } = require('./indicator-pages/catalog.js');
const { toDual } = require('./app-shell/dual-shell.js');

const ROOT = path.join(__dirname, '..');
const HERE = path.join(__dirname, 'indicator-pages');
const ORIGIN = 'https://tradezoro.com';
const BUILD = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/version.json'), 'utf8')).build;
const DEFAULT_UPDATED = '2026-11-04';
const IMG = 'assets/images/indicators/pages';
const DISCLAIMER = 'Education only. Not financial advice. Indicators mark what happened on the chart; they do not predict what price will do. Trading futures, forex, crypto and other markets carries a high level of risk and may not be suitable for everyone.';
// Display names where two window rows share a name.
const DISPLAY = { 'b:stk_ts_dsuite': 'Delta styles (L1)' };
const GROUP_SLUG = (g) => g.toLowerCase().replace(/[^a-z]+/g, '-');
// Words that never reach a page (copy rules): vendor names in third-party tooltips are dropped with the tooltip.
const BANNED = /tradingview|luxalgo|\bvela\b|rithmic|insightsentry|tick-stream|databento|profit|win rate|winrate|accura|guarantee|probab/i;

// Code tooltips use exchange names; pages say it plainly.
const TIP = (s) => String(s || '').replace(/\bthe CME day\b/g, 'the futures trading day').replace(/delayed one bar/g, 'one bar back').replace(/the live candles/g, 'the latest candles');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const V = (p) => `/${p}?v=${BUILD}`;

// ---- learn articles (slug + short title) from gen-learn.js, read as text (requiring it writes files) ----
const LEARN = {};
for (const m of fs.readFileSync(path.join(__dirname, 'gen-learn.js'), 'utf8').matchAll(/slug: '([^']+)',\s*title: '(?:[^'\\]|\\.)*',\s*short: '((?:[^'\\]|\\.)*)'/g)) LEARN[m[1]] = m[2].replace(/\\'/g, "'");

// ---- versions + changelog: assets/indicator-versions.js (the chart's manifest, an ES module: its VERSIONS object is read as data),
// else v1.0 on the first release date (tools/indicator-pages/first-release.json). Newest first on the page.
const VERSIONS = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'assets/indicator-versions.js'), 'utf8');
  const m = src.match(/export const VERSIONS = (\{[\s\S]*?\n\});/);
  if (!m) throw new Error('assets/indicator-versions.js: VERSIONS block not found');
  return require('vm').runInNewContext('(' + m[1] + ')');
})();
const FIRST = JSON.parse(fs.readFileSync(path.join(HERE, 'first-release.json'), 'utf8'));
function changelogOf(it) {
  const e = VERSIONS[it.key];
  const list = e ? e.versions.map((x) => ({ v: x.v, date: x.date, notes: x.notes, pick: !x.all }))
    : [{ v: '1.0', date: FIRST[it.key] || DEFAULT_UPDATED, notes: [it.third ? 'Added to ZoroCharts.' : 'First release.'] }];
  for (const x of list) {
    const bad = x.notes.join(' ').match(/\b(tradingview|luxalgo|vela|cme|finra|rithmic|win rate|profitable|guaranteed?|real-time)\b/i);
    if (bad) throw new Error(`${it.slug}: changelog uses "${bad[1]}" (copy rules)`);
  }
  return { current: list[list.length - 1].v, pickable: list.filter((x) => x.pick).length > 1, list: list.slice().reverse() };
}

// ---- plain-English explainers (tools/indicator-pages/explain.json: slug -> shows / use / limits) ----
const EXPLAIN = JSON.parse(fs.readFileSync(path.join(HERE, 'explain.json'), 'utf8'));
function explainOf(slug, it) {
  const x = EXPLAIN[slug];
  if (!x) return null;
  for (const k of ['shows', 'use', 'limits']) if (!Array.isArray(x[k]) || !x[k].length) throw new Error(`${slug}: explain.json is missing \"${k}\"`);
  const text = JSON.stringify(x);
  const bad = text.match(/\b(tradingview|luxalgo|vela|cme|finra|rithmic|win rate|profitable|guaranteed?|real-time)\b/i);
  if (bad) throw new Error(`${slug}: explainer uses \"${bad[1]}\" (copy rules)`);
  if (it.proKind === 'gex' && /\b(live|real-time|delayed|behind)\b/i.test(text)) throw new Error(`${slug}: GEX explainer uses a banned timing word`);
  const lines = x.shows.length + x.use.length + x.limits.length;
  if (lines < 5 || lines > 9) throw new Error(`${slug}: explainer has ${lines} lines (want 5-9 total)`);
  return x;
}

// ---- data ----
function loadItems() {
  const cat = buildCatalog();
  const caps = fs.existsSync(path.join(HERE, 'captures.json')) ? JSON.parse(fs.readFileSync(path.join(HERE, 'captures.json'), 'utf8')) : {};
  const items = cat.items.map((it) => {
    const f = path.join(HERE, 'content', it.slug + '.json');
    if (!fs.existsSync(f)) throw new Error(`${it.slug}: no write-up (tools/indicator-pages/content/${it.slug}.json)`);
    const w = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const k of ['summary', 'overview', 'how', 'use', 'notes']) if (!w[k] || !w[k].length) throw new Error(`${it.slug}: write-up is missing "${k}"`);
    const text = JSON.stringify(w);
    const bad = text.match(/\b(tradingview|luxalgo|vela|cme|finra|win rate|profitable|guaranteed?|real-time)\b/i);
    if (bad && !(bad[1].toLowerCase() === 'real-time' && it.third)) throw new Error(`${it.slug}: write-up uses "${bad[1]}" (copy rules)`);
    if (it.proKind === 'gex' && /\b(live|real-time|delayed|behind)\b/i.test(text)) throw new Error(`${it.slug}: GEX copy uses a banned timing word`);
    const hasImg = fs.existsSync(path.join(ROOT, IMG, it.slug + '.webp'));
    if (!hasImg) throw new Error(`${it.slug}: no image (run tools/indicator-pages/images.py)`);
    const settings = (it.settings || []).map((s) => Object.assign({}, s, { tooltip: it.third || BANNED.test(s.tooltip || '') ? '' : TIP(s.tooltip) }))
      .filter((s) => !BANNED.test(s.title) && !BANNED.test((s.options || []).join(' ')) && s.title !== 'Version');   // Version: its own section (Changelog)
    return {
      slug: it.slug, key: it.key, name: DISPLAY[it.key] || it.name, windowName: it.name, author: it.author, third: it.third, group: it.group,
      plan: it.plan, kind: it.kind, short: it.short, summary: w.summary, overview: w.overview, how: w.how, use: w.use, notes: w.notes,
      explain: explainOf(it.slug, it), changelog: changelogOf(it), alerts: w.alerts || '', learn: w.learn && LEARN[w.learn] ? w.learn : '', updated: [w.updated || DEFAULT_UPDATED, ...((VERSIONS[it.key] || { versions: [] }).versions.map((x) => x.date))].sort().pop(),
      licence: it.licence || '', originalUrl: it.originalUrl || '', settings,
      capture: caps[it.slug] === 'ok' ? 'chart' : 'preview',
      image: `/${IMG}/${it.slug}.webp`, thumb: `/${IMG}/${it.slug}-t.webp`
    };
  });
  return { items, skipped: cat.skipped };
}

// ---- shared head/nav/footer, copied from about.html like gen-learn.js ----
const about = fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8');
const ver = (h) => h.replace(/\?v=\d+/g, '?v=' + BUILD);
const absol = (h) => h.replace(/(\s(?:href|src|srcset)=")(?!https?:|\/|#|mailto:|data:|tel:)/g, '$1/').replace(/(srcset="[^"]*)/g, (m) => m.replace(/(,\s*)(?!https?:|\/)(assets\/)/g, '$1/$2'));
const NAV = about.slice(about.indexOf('<nav class="nav"'), about.indexOf('</nav>') + 6);
const FOOTER = about.slice(about.indexOf('<footer>'), about.indexOf('</footer>') + 9);
const HEAD_START = about.indexOf('<link rel="preload"') >= 0 && about.indexOf('<link rel="preload"') < about.indexOf('<link rel="stylesheet"')
  ? about.indexOf('<link rel="preload"') : about.indexOf('<link rel="stylesheet"');
const HEAD_ASSETS = ver(about.slice(HEAD_START, about.indexOf('</head>')).trim())
  .replace(/(<link rel="stylesheet" href="assets\/style\.css\?v=\d+">)/, `$1\n<link rel="stylesheet" href="assets/indicator-pages.css?v=${BUILD}">`);
if (!HEAD_ASSETS.includes('indicator-pages.css') || /application\/ld\+json|<title|canonical/.test(HEAD_ASSETS)) throw new Error('about.html <head> layout changed; update gen-indicator-pages.js');
const SCRIPTS = '\n' + ver(about.slice(about.indexOf('</footer>') + 9, about.indexOf('</body>')).trim());
if (!SCRIPTS.includes('auth.js') || !SCRIPTS.includes('theme.js')) throw new Error('about.html footer scripts changed; update gen-indicator-pages.js');

const OG_TABLE = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'og', 'pages.json'), 'utf8'));
function ogFor(page) {
  const e = OG_TABLE().pages.find((x) => x.page === page);
  if (!e) throw new Error(`${page}: no entry in tools/og/pages.json`);
  const stem = page.slice(0, -5).replace(/\//g, '_');
  const ext = ['png', 'jpg'].find((x) => fs.existsSync(path.join(ROOT, 'assets/images/og/share', `${stem}.${x}`)));
  if (!ext) throw new Error(`${page}: run python3 tools/og/gen_og.py --only ${page}`);
  return { url: `${ORIGIN}/assets/images/og/share/${stem}.${ext}?v=${BUILD}`, type: ext === 'png' ? 'image/png' : 'image/jpeg', alt: e.alt, title: e.og_title || e.title };
}

function head({ title, description, url, page, jsonld }) {
  const og = ogFor(page);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="stryker-build" content="${BUILD}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="TradeZoro">
<meta property="og:title" content="${esc(og.title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${og.url}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="${og.type}">
<meta property="og:image:alt" content="${esc(og.alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(og.title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${og.url}">
<meta name="twitter:image:alt" content="${esc(og.alt)}">
<meta name="theme-color" content="#050506">
<title>${esc(title)} | TradeZoro</title>
<link rel="canonical" href="${url}">
${HEAD_ASSETS}
<script type="application/ld+json">
${JSON.stringify(jsonld, null, 2)}
</script>
</head>`;
}

function page(parts) {
  return toDual(absol(`${head(parts)}
<body data-page-key="${parts.key}">
<a class="skip-link" href="#main">Skip to content</a>

${NAV}
<main id="main" tabindex="-1">
${parts.main}
</main>
${FOOTER}
${SCRIPTS}
<script src="assets/indicator-pages.js?v=${BUILD}" defer></script>
</body>
</html>
`));
}

const PUBLISHER = { '@type': 'Organization', name: 'TradeZoro', url: ORIGIN + '/' };
const STAR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
const PLUS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const EXT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
const fmtDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const chip = (t, cls) => `<span class="ixp-chip${cls ? ' ' + cls : ''}">${esc(t)}</span>`;
const initials = (a) => esc(String(a).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'C');

function fmtDef(s) {
  const d = typeof s.def === 'string' ? s.def.replace(/^[A-Z_]+:(?=\w+1!$)/, '') : s.def;   // CME_MINI:ES1! -> ES1! (no exchange names on pages)
  if (d === true || d === 'true') return 'On';
  if (d === false || d === 'false') return 'Off';
  if (d === null || d === undefined || d === '') return '<span class="ixp-dim">None</span>';
  if (s.type === 'color' || /^#[0-9a-f]{3,8}$/i.test(String(d)) || /^(rgba?|color\.)/i.test(String(d))) {
    const m = String(d).match(/^#[0-9a-f]{6}/i);
    return (m ? `<i class="ixp-sw" style="background:${m[0]}"></i>` : '') + `<code>${esc(String(d).slice(0, 40))}</code>`;
  }
  if (typeof d === 'object') return `<code>${esc(JSON.stringify(d).slice(0, 40))}</code>`;
  return esc(String(d).slice(0, 60));
}

function settingsTable(it) {
  if (!it.settings.length) return '<p>This tool has no settings: you add it, then click or drag on the chart.</p>';
  const rows = [];
  let grp = null;
  for (const s of it.settings) {
    if ((s.group || '') !== grp) { grp = s.group || ''; if (grp) rows.push(`<tr class="ixp-grp"><th colspan="2" scope="colgroup">${esc(grp)}</th></tr>`); }
    const opts = s.options && s.options.length > 1 ? `<span class="ixp-opt">Options: ${esc(s.options.slice(0, 8).join(', '))}${s.options.length > 8 ? '…' : ''}</span>` : '';
    rows.push(`<tr><td><span class="ixp-set">${esc(s.title)}</span>${s.tooltip ? `<span class="ixp-tip">${esc(s.tooltip)}</span>` : ''}${opts}</td><td>${fmtDef(s)}</td></tr>`);
  }
  const table = (r) => `<div class="ixp-tablewrap scroll-x"><table class="ixp-table"><thead><tr><th scope="col">Setting</th><th scope="col">Default</th></tr></thead><tbody>\n${r.join('\n')}\n</tbody></table></div>`;
  if (rows.length <= 16) return table(rows);
  return `${table(rows.slice(0, 12))}
<details class="ixp-more"><summary>Show all ${it.settings.length} settings</summary>
${table(rows.slice(12))}
</details>`;
}

function changelog(it) {
  const c = it.changelog;
  const pick = c.pickable ? '<p class="ixp-cl-note">On a chart, an indicator stays on the version it was added with. When a newer version is out, a small update button appears next to its name. You can switch versions any time in its settings, under Version.</p>' : '';
  return `<ol class="ixp-cl">
${c.list.map((x, i) => `<li><div class="ixp-cl-head"><span class="ixp-cl-v">v${esc(x.v)}</span>${i === 0 ? '<span class="ixp-chip is-free">Latest</span>' : ''}<time datetime="${x.date}">${fmtDate(x.date)}</time></div><ul>${x.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></li>`).join('\n')}
</ol>
${pick}`;
}

function credit(it) {
  if (!it.third) return '';
  const who = it.author === 'Community' ? 'The script does not name its author.' : `Script by <strong>${esc(it.author)}</strong>.`;
  const src = it.originalUrl ? ` <a href="${esc(it.originalUrl)}" rel="noopener nofollow" target="_blank">Original public script page ${EXT}</a>.` : '';
  const lic = it.licence ? ` Licence: ${esc(it.licence)}.` : ' No licence is stated in the script.';
  return `<aside class="ixp-credit" aria-label="Credit">
<p><strong>Community script.</strong> ${who}${src}${lic} TradeZoro did not write it. ZoroCharts runs it as the author published it, and its source code is not shown here.</p>
</aside>`;
}

function dataNote(it) {
  if (/\(L2\)|L1\+L2/.test(it.windowName)) return 'Pro: needs the full order book (Data feed L2).';
  if (/\(L1\)/.test(it.windowName)) return 'Uses the futures trade stream (Data feed L1). Futures L1 data is free for members who sign the market data agreement.';
  return '';
}

function card(it, h) {
  return `<li class="ixh-card" data-group="${esc(GROUP_SLUG(it.group))}" data-q="${esc((it.name + ' ' + it.author + ' ' + it.group + ' ' + it.windowName).toLowerCase())}">
<a href="/indicators/${it.slug}"><span class="ixh-thumb"><img src="${it.thumb}" alt="" width="480" height="270" loading="lazy" decoding="async"></span>
<span class="ixh-body"><${h} class="ixh-name">${esc(it.name)}</${h}><span class="ixh-meta"><span class="ixh-auth">${esc(it.author)}</span>${chip(it.plan, it.plan === 'Pro' ? 'is-pro' : 'is-free')}</span></span></a></li>`;
}

function indicatorPage(it, all) {
  const url = `${ORIGIN}/indicators/${it.slug}`;
  const related = all.filter((x) => x.group === it.group && x.slug !== it.slug);
  const i = all.indexOf(it);
  related.sort((a, b) => Math.abs(all.indexOf(a) - i) - Math.abs(all.indexOf(b) - i));
  const rel = related.slice(0, 5);
  const note = dataNote(it);
  const title = `${it.name}: indicator guide and settings`;
  const description = it.summary;
  const jsonld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', name: title, description, url, dateModified: it.updated, inLanguage: 'en', publisher: PUBLISHER, isAccessibleForFree: true,
      about: { '@type': 'Thing', name: it.name }, author: it.third ? { '@type': 'Person', name: it.author } : PUBLISHER },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: ORIGIN + '/' },
      { '@type': 'ListItem', position: 2, name: 'Indicators', item: ORIGIN + '/indicators' },
      { '@type': 'ListItem', position: 3, name: it.name, item: url }] }] };
  const list = (a) => `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const paras = (a) => a.map((x) => `<p>${esc(x)}</p>`).join('\n');
  const main = `<div class="ixp-wrap">
<nav class="ixp-crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/indicators">Indicators</a><span aria-hidden="true">/</span><a href="/indicators#${GROUP_SLUG(it.group)}">${esc(it.group)}</a></nav>
<header class="ixp-head">
<h1>${esc(it.name)}</h1>
<div class="ixp-meta">
<span class="ixp-author"><span class="ixp-ava${it.third ? '' : ' is-tz'}" aria-hidden="true">${it.third ? initials(it.author) : 'TZ'}</span><span>${it.third ? '' : ''}${esc(it.author)}</span></span>
${chip(it.group)}${chip(it.plan, it.plan === 'Pro' ? 'is-pro' : 'is-free')}
<span class="ixp-upd"><a href="#changelog">v${esc(it.changelog.current)}</a> · Updated <time datetime="${it.updated}">${fmtDate(it.updated)}</time></span>
</div>
</header>
<figure class="ixp-fig">
<img src="${it.image}" alt="${esc(it.capture === 'chart' ? it.name + ' on an NQ futures chart in ZoroCharts' : it.name + ': preview')}" width="1280" height="720" fetchpriority="high" decoding="async">
${it.capture === 'chart' ? '' : '<figcaption>Preview. Add it to a chart to see it on your own symbol.</figcaption>'}
</figure>
<div class="ixp-actions">
<a class="btn btn-primary ixp-add" href="/charts?ind=${encodeURIComponent(it.key)}" data-ind-add="${esc(it.key)}">${PLUS}Add to chart</a>
<button type="button" class="btn btn-ghost ixp-fav" data-ind-fav="${esc(it.key)}" data-ind-name="${esc(it.windowName)}" aria-pressed="false">${STAR}<span>Favourite</span></button>
</div>
<div class="ixp-cols">
<article class="ixp-body">
<p class="ixp-lede">${esc(it.summary)}</p>
${credit(it)}
${it.explain ? `<section class="ixp-plain" id="plain" aria-label="In plain English">
<h2>In plain English</h2>
<h3>What it shows</h3>
${list(it.explain.shows)}
<h3>How traders use it</h3>
${list(it.explain.use)}
<h3>What it does not tell you</h3>
${list(it.explain.limits)}
</section>\n` : ''}<h2 id="overview">Overview</h2>
${paras(it.overview)}
<h2 id="how">How it works</h2>
${paras(it.how)}
<h2 id="use">How to use it</h2>
${list(it.use)}
<p class="ixp-edu">These are ways some traders read it, for learning. They are not trade signals.</p>
<h2 id="settings">Settings</h2>
${settingsTable(it)}
${it.alerts ? `<h2 id="alerts">Alerts</h2>\n<p>${esc(it.alerts.replace(/^Alerts:\s*/i, '').replace(/^./, (c) => c.toUpperCase()))}</p>` : ''}
<h2 id="notes">Notes and limits</h2>
${list((note ? [note] : []).concat(it.notes))}
<h2 id="changelog">Changelog</h2>
${changelog(it)}
<p class="ixp-disclaimer">${DISCLAIMER}</p>
</article>
<aside class="ixp-rail" aria-label="More">
<section class="ixp-box ixp-open">
<h2>Open ZoroCharts</h2>
<p>Every indicator here runs in ZoroCharts, in your browser. Sign up free to open it.</p>
<a class="btn btn-primary ixp-add" href="/charts?ind=${encodeURIComponent(it.key)}" data-ind-add="${esc(it.key)}">Add ${esc(it.name.length > 24 ? 'it' : it.name)} to a chart</a>
<a class="ixp-link" href="/charts">Open ZoroCharts</a>
</section>
${it.learn ? `<section class="ixp-box"><h2>Learn the concept</h2><a class="ixp-learn" href="/learn-${it.learn}"><span>${esc(LEARN[it.learn])}</span><small>Free article · ZoroAcademy</small></a></section>` : ''}
${rel.length ? `<section class="ixp-box"><h2>More in ${esc(it.group)}</h2><ul class="ixp-rel">${rel.map((x) => `<li><a href="/indicators/${x.slug}"><img src="${x.thumb}" alt="" width="96" height="54" loading="lazy" decoding="async"><span><b>${esc(x.name)}</b><small>${esc(x.author)} · ${x.plan}</small></span></a></li>`).join('')}</ul><a class="ixp-link" href="/indicators#${GROUP_SLUG(it.group)}">All ${esc(it.group)} indicators</a></section>` : ''}
</aside>
</div>
</div>`;
  return page({ title, description, url, page: `indicators/${it.slug}.html`, key: 'indicator-page', jsonld, main });
}

function hubPage(all) {
  const url = `${ORIGIN}/indicators`;
  const description = `Every indicator in ZoroCharts, ${all.length} in total: TradeZoro tools, order flow, moving averages, oscillators, volatility, volume, trend, levels and community scripts. What each one shows and how to read it.`;
  const counts = Object.fromEntries(GROUPS.map((g) => [g, all.filter((x) => x.group === g).length]));
  const jsonld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'CollectionPage', name: 'ZoroCharts indicators', description, url, publisher: PUBLISHER,
      hasPart: all.map((x) => ({ '@type': 'WebPage', name: x.name, url: `${ORIGIN}/indicators/${x.slug}` })) },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: ORIGIN + '/' },
      { '@type': 'ListItem', position: 2, name: 'Indicators', item: url }] }] };
  const main = `<div class="ixh-wrap">
<nav class="ixp-crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><span aria-current="page">Indicators</span></nav>
<header class="ixh-head">
<h1>Indicators</h1>
<p class="ixh-dek">Every indicator in ZoroCharts, with what it shows, how it works and its settings. Open one, then add it to a chart in one click.</p>
</header>
<div class="ixh-tools">
<label class="ixh-search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><span class="sr-only">Search indicators</span><input type="search" id="ixh-q" placeholder="Search ${all.length} indicators" autocomplete="off" spellcheck="false"></label>
<div class="ixh-chips scroll-x" role="group" aria-label="Filter by group">
<button type="button" class="ixh-chipb" data-g="" aria-pressed="true">All <span>${all.length}</span></button>
${GROUPS.filter((g) => counts[g]).map((g) => `<button type="button" class="ixh-chipb" data-g="${GROUP_SLUG(g)}" aria-pressed="false">${esc(g)} <span>${counts[g]}</span></button>`).join('\n')}
</div>
</div>
<p class="ixh-empty" id="ixh-empty" hidden>No indicator matches. Try another word.</p>
${GROUPS.filter((g) => counts[g]).map((g) => `<section class="ixh-sec" id="${GROUP_SLUG(g)}" data-sec="${GROUP_SLUG(g)}" aria-labelledby="h-${GROUP_SLUG(g)}">
<h2 id="h-${GROUP_SLUG(g)}">${esc(g)}${g === 'Community' ? ' <small>third-party scripts, credited to their authors</small>' : ''}</h2>
<ul class="ixh-grid">
${all.filter((x) => x.group === g).map((x) => card(x, 'h3')).join('\n')}
</ul>
</section>`).join('\n')}
<section class="ixh-sec ixh-access dual-app" aria-labelledby="h-access">
<h2 id="h-access">Your TradingView indicator access</h2>
<p>Private TradingView indicators, your access request and the indicator guides from the curriculum are on their own page.</p>
<a class="btn btn-ghost" href="/indicators-access">Open indicator access</a>
</section>
<p class="ixp-disclaimer">${DISCLAIMER}</p>
</div>`;
  return page({ title: 'Indicators: every ZoroCharts indicator explained', description, url, page: 'indicators.html', key: 'indicators-hub', jsonld, main });
}

// ---- og table + catalogue data ----
function cardTitle(name) {
  let t = name.replace(/^TradeZoro /, '').replace(/\s*\[[^\]]*\]/g, '').replace(/\s*\((?!L1|L2)[^)]*\)/g, '').replace(/\s*\|.*$/, '').replace(/°/g, '').trim();
  if (t.length > 26) { const w = t.split(' '); t = ''; for (const x of w) { if ((t + ' ' + x).trim().length > 26) break; t = (t + ' ' + x).trim(); } }
  return t.replace(/[\s&+:-]+$/, '');
}
function ogEntries(all) {
  const tab = OG_TABLE();
  const others = tab.pages.filter((e) => !/^indicators(\/|\.html$)/.test(e.page));
  const used = new Set(others.map((e) => e.title.toLowerCase()));
  const take = (t) => { let s = t; if (used.has(s.toLowerCase())) s = t + ' indicator'; let n = 2; while (used.has(s.toLowerCase())) s = t + ' ' + n++; used.add(s.toLowerCase()); return s; };
  const mine = [{ page: 'indicators.html', title: take('Indicator Library'), og_title: 'Indicator Library: every ZoroCharts indicator explained', visual: [IMG + '/footprint.webp', IMG + '/big-trades.webp', IMG + '/smt-divergence-pro.webp', IMG + '/bollinger-bands.webp'].filter((p) => fs.existsSync(path.join(ROOT, p))), alt: 'ZoroCharts indicators: footprint, big trades, SMT divergence and Bollinger Bands on NQ charts' }];
  if (mine[0].visual.length !== 4) mine[0].visual = 'brand';
  for (const it of all) {
    const t = take(cardTitle(it.name));
    mine.push({ page: `indicators/${it.slug}.html`, title: t, og_title: `${t}: ZoroCharts indicator guide`, visual: [`${IMG}/${it.slug}.webp`], focus: '0.5,0.5',
      alt: it.capture === 'chart' ? `${it.name} drawn on an NQ futures chart in ZoroCharts` : `${it.name} preview card` });
  }
  tab.pages = others.concat(mine);
  return JSON.stringify(tab, null, 2).replace(/\n {6}("[^"]+",?)\n/g, ' $1\n') + '\n';
}

// ---- write ----
function outputs() {
  const { items, skipped } = loadItems();
  const out = {};
  out['tools/og/pages.json'] = ogEntries(items);
  // og entries first (head() reads the table from disk): in --check mode compare against the file as it is
  const data = { _doc: 'Generated by tools/gen-indicator-pages.js from the chart code + tools/indicator-pages/content. Do not edit by hand.', build: BUILD, groups: GROUPS,
    count: items.length, skipped, items: items.map((x) => Object.assign({}, x, { settings: x.settings.map((s) => ({ title: s.title, type: s.type, def: s.def, group: s.group || undefined, options: s.options && s.options.length ? s.options : undefined })) })) };
  out['assets/indicators-catalog.json'] = JSON.stringify(data, null, 1) + '\n';
  // in-chart help (Indicators window "?" button): window key -> explainer, small enough to fetch on demand
  const ex = {};
  items.forEach((x) => { if (x.explain) ex[x.key] = x.explain; });
  out['assets/indicator-explain.json'] = JSON.stringify(ex) + '\n';
  return { out, items };
}

const check = process.argv.includes('--check');
const { out, items } = outputs();
const write = (rel, s) => { fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true }); fs.writeFileSync(path.join(ROOT, rel), s); };
let stale = 0;
const settle = (rel, s) => {
  const p = path.join(ROOT, rel);
  const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  if (cur === s) return;
  if (check) { console.error(`${rel} is out of date: run node tools/gen-indicator-pages.js`); stale++; } else { write(rel, s); }
};
settle('tools/og/pages.json', out['tools/og/pages.json']);
settle('assets/indicators-catalog.json', out['assets/indicators-catalog.json']);
settle('assets/indicator-explain.json', out['assets/indicator-explain.json']);
{ // app-shell allowlist: hub + every page are public-and-app (dual) pages
  const p = path.join(__dirname, 'tests', 'app-shell-allowlist.json');
  const al = JSON.parse(fs.readFileSync(p, 'utf8'));
  const dual = {};
  for (const [k, v] of Object.entries(al.dual)) if (!/^indicators(\/|$)/.test(k)) dual[k] = v;
  dual.indicators = 'indicator library hub (SEO); app shell when signed in';
  items.forEach((it) => { dual['indicators/' + it.slug] = 'indicator page (SEO, generated)'; });
  al.dual = dual;
  settle('tools/tests/app-shell-allowlist.json', JSON.stringify(al, null, 1) + '\n');
}
let missingOg = 0;
const pages = { 'indicators.html': () => hubPage(items) };
items.forEach((it) => { pages[`indicators/${it.slug}.html`] = () => indicatorPage(it, items); });
for (const [rel, fn] of Object.entries(pages)) {
  let html;
  try { html = fn(); } catch (e) { if (/gen_og/.test(e.message)) { missingOg++; console.error(e.message); continue; } throw e; }
  settle(rel, html);
}
// pages for slugs that are gone
const dir = path.join(ROOT, 'indicators');
if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.html') && !pages['indicators/' + f]) { if (check) { console.error(`indicators/${f} has no catalogue row`); stale++; } else fs.unlinkSync(path.join(dir, f)); }
if (missingOg) { console.error(`${missingOg} pages need share images: python3 tools/og/gen_og.py --only <pages>, then re-run`); process.exit(1); }
if (check) { if (stale) process.exit(1); console.log(`indicator pages up to date (${items.length})`); }
else console.log(`wrote ${Object.keys(pages).length} pages (${items.length} indicators)`);
module.exports = { cardTitle };
