// Stryker Trading Academy — SEO admin module (seo-admin.html)
// Depends on: assets/admin-guard.js, assets/progress.js (db), assets/toast.js
//
// Four tabs:
//   Audit    — fetches every public page (same origin) and runs the checks a
//              crawler cares about: title, description, one H1, canonical,
//              robots, OG image, image alts, word count, internal links.
//   Pages    — per-page SEO editor with a live Google-result preview and a
//              Yoast-style focus-keyphrase analysis against the real page.
//   Sitemap  — the live sitemap.xml and robots.txt, with print and download.
//              The deploy workflow regenerates the sitemap on every publish,
//              so "update" happens by itself; this tab is where you see it.
//   Settings — site name, title template, default OG image, social profiles
//              for the Organization schema, and the master visibility switch.
//
// Per-page overrides land in seoPages/{page}; site-wide settings in
// settings/seo. assets/seo.js applies both on the public pages. Google
// indexes what that script sets (it renders JS); social link previews do not
// run JS and keep reading the baked tags — the UI says so where it matters.

/* eslint-disable no-var */

var SEO_PAGES = [
  { key: 'index',         label: 'Homepage',       path: '/' },
  { key: 'about',         label: 'About',          path: '/about' },
  { key: 'signup',        label: 'Sign up',        path: '/signup' },
  { key: 'login',         label: 'Log in',         path: '/login' },
  { key: 'contact',       label: 'Contact',        path: '/contact' },
  { key: 'support',       label: 'Support',        path: '/support' },
  { key: 'terms',         label: 'Terms',          path: '/terms' },
  { key: 'privacy',       label: 'Privacy',        path: '/privacy' },
  { key: 'cookies',       label: 'Cookies',        path: '/cookies' },
  { key: 'gdpr',          label: 'GDPR',           path: '/gdpr' },
  { key: 'refund-policy', label: 'Refund policy',  path: '/refund-policy' }
];

var SEO_ORIGIN = 'https://strykertrading.com';
var SEO_CACHE = {};        // pageKey -> parsed page facts
var SEO_OVERRIDES = {};    // pageKey -> stored seoPages doc
var SEO_SETTINGS = {};     // settings/seo doc

function seoEsc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Page fetching + fact extraction (everything the checks look at, in one pass)
// ---------------------------------------------------------------------------

function fetchPageFacts(page){
  if (SEO_CACHE[page.key]) return Promise.resolve(SEO_CACHE[page.key]);
  return fetch(page.key === 'index' ? 'index.html' : page.key + '.html', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var body = doc.body;
      // scripts and styles are not content
      body.querySelectorAll('script, style, noscript').forEach(function (el) { el.remove(); });
      var text = (body.textContent || '').replace(/\s+/g, ' ').trim();
      var words = text ? text.split(' ').length : 0;

      var imgs = [].slice.call(doc.querySelectorAll('img'));
      var links = [].slice.call(doc.querySelectorAll('a[href]'));
      var internal = links.filter(function (a) {
        var h = a.getAttribute('href') || '';
        return h && !/^https?:\/\//.test(h) || h.indexOf('strykertrading.com') !== -1;
      });

      var metaDesc = doc.querySelector('meta[name="description"]');
      var robots = doc.querySelector('meta[name="robots"]');
      var canonical = doc.querySelector('link[rel="canonical"]');
      var ogImage = doc.querySelector('meta[property="og:image"]');
      var h1s = doc.querySelectorAll('h1');
      var facts = {
        title: (doc.querySelector('title') || {}).textContent || '',
        description: metaDesc ? metaDesc.getAttribute('content') : '',
        robots: robots ? robots.getAttribute('content') : '',
        canonical: canonical ? canonical.getAttribute('href') : '',
        ogImage: ogImage ? ogImage.getAttribute('content') : '',
        h1Count: h1s.length,
        h1Text: h1s.length ? (h1s[0].textContent || '').trim() : '',
        firstParagraph: (function () {
          var ps = doc.querySelectorAll('p');
          for (var i = 0; i < ps.length; i++) {
            var t = (ps[i].textContent || '').trim();
            if (t.length > 40) return t;
          }
          return '';
        })(),
        words: words,
        text: text.toLowerCase(),
        imgTotal: imgs.length,
        imgMissingAlt: imgs.filter(function (im) { return !(im.getAttribute('alt') || '').trim(); }).length,
        internalLinks: internal.length,
        externalLinks: links.length - internal.length
      };
      SEO_CACHE[page.key] = facts;
      return facts;
    });
}

// ---------------------------------------------------------------------------
// Checks. Each returns { level: 'good'|'warn'|'bad', text }.
// ---------------------------------------------------------------------------

function check(level, text){ return { level: level, text: text }; }

function pageChecks(page, f){
  var out = [];
  var tLen = (f.title || '').length;
  out.push(!f.title ? check('bad', 'No <title> at all.')
    : tLen < 30 ? check('warn', 'Title is short (' + tLen + ' chars) — 30–60 uses the space search results give it.')
    : tLen > 65 ? check('warn', 'Title is ' + tLen + ' chars — Google truncates around 60.')
    : check('good', 'Title length is good (' + tLen + ' chars).'));

  var dLen = (f.description || '').length;
  out.push(!f.description ? check('bad', 'No meta description — Google will improvise one.')
    : dLen < 70 ? check('warn', 'Description is short (' + dLen + ' chars) — 70–160 earns the full snippet.')
    : dLen > 165 ? check('warn', 'Description is ' + dLen + ' chars — it will be cut off around 160.')
    : check('good', 'Description length is good (' + dLen + ' chars).'));

  out.push(f.h1Count === 1 ? check('good', 'Exactly one H1.')
    : f.h1Count === 0 ? check('bad', 'No H1 on the page.')
    : check('warn', f.h1Count + ' H1s — one per page keeps the hierarchy unambiguous.'));

  out.push(f.canonical ? check('good', 'Canonical URL set.')
    : check('bad', 'No canonical link — duplicate URLs (with/without .html) split ranking signals.'));

  out.push(/noindex/.test(f.robots || '')
    ? check(page.key === 'index' ? 'bad' : 'warn', 'Page is set to noindex' + (page.key === 'index' ? ' — the HOMEPAGE is invisible to search.' : '.'))
    : check('good', 'Indexable (no noindex).'));

  out.push(f.ogImage ? check('good', 'Open Graph image set for link previews.')
    : check('warn', 'No og:image — shared links show no picture.'));

  out.push(f.imgTotal === 0 || f.imgMissingAlt === 0
    ? check('good', 'All ' + f.imgTotal + ' images carry alt text.')
    : check('warn', f.imgMissingAlt + ' of ' + f.imgTotal + ' images have no alt text.'));

  out.push(f.words >= 300 ? check('good', f.words + ' words of content.')
    : f.words >= 120 ? check('warn', 'Thin content (' + f.words + ' words) — 300+ gives search something to rank.')
    : check('bad', 'Almost no crawlable text (' + f.words + ' words).'));

  out.push(f.internalLinks >= 3 ? check('good', f.internalLinks + ' internal links.')
    : check('warn', 'Only ' + f.internalLinks + ' internal links — linking related pages spreads authority.'));

  return out;
}

// The Yoast half: the focus keyphrase measured against the real page.
function keyphraseChecks(kp, f, pathStr){
  var out = [];
  var k = (kp || '').trim().toLowerCase();
  if (!k) return [check('warn', 'No focus keyphrase set — add the term this page should rank for.')];

  var inTitle = (f.title || '').toLowerCase().indexOf(k) !== -1;
  var inDesc = (f.description || '').toLowerCase().indexOf(k) !== -1;
  var inH1 = (f.h1Text || '').toLowerCase().indexOf(k) !== -1;
  var inFirst = (f.firstParagraph || '').toLowerCase().indexOf(k) !== -1;
  var inUrl = (pathStr || '').toLowerCase().replace(/[-_/]/g, ' ').indexOf(k.replace(/[-_]/g, ' ')) !== -1;

  out.push(inTitle ? check('good', 'Keyphrase appears in the title.')
                   : check('bad', 'Keyphrase is missing from the title — the strongest single signal.'));
  out.push(inDesc ? check('good', 'Keyphrase appears in the meta description.')
                  : check('warn', 'Keyphrase not in the description (it gets bolded in results when it matches the query).'));
  out.push(inH1 ? check('good', 'Keyphrase appears in the H1.')
                : check('warn', 'Keyphrase not in the H1.'));
  out.push(inFirst ? check('good', 'Keyphrase appears in the opening paragraph.')
                   : check('warn', 'Keyphrase does not appear early in the content.'));
  out.push(inUrl ? check('good', 'Keyphrase appears in the URL.')
                 : check('warn', 'Keyphrase not in the URL (fine for an existing page — do not break URLs to chase this).'));

  var occurrences = f.words ? (f.text.split(k).length - 1) : 0;
  var density = f.words ? (occurrences * k.split(' ').length / f.words) * 100 : 0;
  out.push(occurrences === 0 ? check('bad', 'Keyphrase never appears in the page text.')
    : density > 3 ? check('warn', 'Keyphrase appears ' + occurrences + ' times (' + density.toFixed(1) + '%) — reads as stuffing past ~3%.')
    : check('good', 'Keyphrase used ' + occurrences + ' time' + (occurrences === 1 ? '' : 's') + ' (' + density.toFixed(1) + '% density).'));
  return out;
}

function scoreOf(checks){
  var bad = checks.filter(function (c) { return c.level === 'bad'; }).length;
  var warn = checks.filter(function (c) { return c.level === 'warn'; }).length;
  return bad ? 'bad' : (warn > 2 ? 'warn' : (warn ? 'ok' : 'good'));
}

// ---------------------------------------------------------------------------
// Tab: Audit
// ---------------------------------------------------------------------------

function runAudit(){
  var host = document.getElementById('seo-audit-list');
  if (!host) return;
  host.innerHTML = '<p class="seo-muted">Crawling ' + SEO_PAGES.length + ' public pages…</p>';

  Promise.all(SEO_PAGES.map(function (page) {
    return fetchPageFacts(page)
      .then(function (f) { return { page: page, facts: f, checks: pageChecks(page, f) }; })
      .catch(function (err) { return { page: page, error: String(err.message || err) }; });
  })).then(function (rows) {
    var goods = rows.filter(function (r) { return !r.error && scoreOf(r.checks) === 'good'; }).length;
    document.getElementById('seo-audit-summary').textContent =
      goods + ' of ' + rows.length + ' pages pass every check.';

    host.innerHTML = rows.map(function (r) {
      if (r.error) {
        return '<div class="seo-page-row"><span class="seo-dot seo-bad"></span><b>' + seoEsc(r.page.label) +
               '</b><span class="seo-muted">could not fetch: ' + seoEsc(r.error) + '</span></div>';
      }
      var s = scoreOf(r.checks);
      return '<details class="seo-page-row">' +
        '<summary><span class="seo-dot seo-' + s + '"></span><b>' + seoEsc(r.page.label) + '</b>' +
        '<span class="seo-muted">' + seoEsc(r.facts.title || 'no title') + '</span>' +
        '<em>' + r.checks.filter(function (c) { return c.level !== 'good'; }).length + ' issues</em></summary>' +
        '<ul class="seo-checklist">' + r.checks.map(function (c) {
          return '<li class="seo-' + c.level + '">' + seoEsc(c.text) + '</li>';
        }).join('') + '</ul>' +
      '</details>';
    }).join('');
  });
}

// ---------------------------------------------------------------------------
// Tab: Pages (editor + SERP preview + keyphrase analysis)
// ---------------------------------------------------------------------------

var SEO_CURRENT_PAGE = null;

function loadPageEditor(key){
  var page = SEO_PAGES.filter(function (p) { return p.key === key; })[0] || SEO_PAGES[0];
  SEO_CURRENT_PAGE = page;
  var ov = SEO_OVERRIDES[page.key] || {};

  fetchPageFacts(page).then(function (f) {
    document.getElementById('seo-f-title').value = ov.title || '';
    document.getElementById('seo-f-title').placeholder = f.title || 'Page title';
    document.getElementById('seo-f-desc').value = ov.description || '';
    document.getElementById('seo-f-desc').placeholder = f.description || 'Meta description';
    document.getElementById('seo-f-keyphrase').value = ov.keyphrase || '';
    document.getElementById('seo-f-canonical').value = ov.canonical || '';
    document.getElementById('seo-f-canonical').placeholder = f.canonical || (SEO_ORIGIN + page.path);
    document.getElementById('seo-f-noindex').checked = !!ov.noindex;
    refreshEditorPreview();
  });
}

function refreshEditorPreview(){
  var page = SEO_CURRENT_PAGE;
  if (!page) return;
  var f = SEO_CACHE[page.key] || {};
  var title = document.getElementById('seo-f-title').value.trim() || f.title || '';
  var desc = document.getElementById('seo-f-desc').value.trim() || f.description || '';
  var kp = document.getElementById('seo-f-keyphrase').value.trim();

  var tl = title.length, dl = desc.length;
  var tEl = document.getElementById('seo-count-title');
  tEl.textContent = tl + ' / 60';
  tEl.className = 'seo-count ' + (tl > 65 || tl < 30 ? 'seo-warn-t' : 'seo-good-t');
  var dEl = document.getElementById('seo-count-desc');
  dEl.textContent = dl + ' / 160';
  dEl.className = 'seo-count ' + (dl > 165 || dl < 70 ? 'seo-warn-t' : 'seo-good-t');

  document.getElementById('serp-title').textContent = title || 'Page title';
  document.getElementById('serp-url').textContent = SEO_ORIGIN + page.path;
  document.getElementById('serp-desc').textContent =
    (desc || 'The meta description appears here.').slice(0, 165) + (dl > 165 ? '…' : '');

  // analysis merges the general page checks with the keyphrase ones, against
  // the EDITED values, so the lights answer "if I save this, what happens?"
  var merged = Object.assign({}, f, { title: title, description: desc });
  var checks = pageChecks(page, merged).concat(keyphraseChecks(kp, merged, page.path));
  document.getElementById('seo-editor-analysis').innerHTML =
    '<ul class="seo-checklist">' + checks.map(function (c) {
      return '<li class="seo-' + c.level + '">' + seoEsc(c.text) + '</li>';
    }).join('') + '</ul>';
}

function savePageSeo(){
  var page = SEO_CURRENT_PAGE;
  if (!page) return;
  var doc = {
    title: document.getElementById('seo-f-title').value.trim() || null,
    description: document.getElementById('seo-f-desc').value.trim() || null,
    keyphrase: document.getElementById('seo-f-keyphrase').value.trim() || null,
    canonical: document.getElementById('seo-f-canonical').value.trim() || null,
    noindex: document.getElementById('seo-f-noindex').checked,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  db.collection('seoPages').doc(page.key).set(doc, { merge: true }).then(function () {
    SEO_OVERRIDES[page.key] = Object.assign({}, SEO_OVERRIDES[page.key] || {}, doc);
    if (typeof showToast === 'function') showToast('success', page.label + ' SEO saved — live on next page load.');
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('error', 'Could not save: ' + (err.message || err));
  });
}

// ---------------------------------------------------------------------------
// Tab: Sitemap & robots
// ---------------------------------------------------------------------------

function loadSitemapTab(){
  fetch('sitemap.xml', { cache: 'no-store' }).then(function (r) {
    return r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status));
  }).then(function (xml) {
    document.getElementById('seo-sitemap-view').textContent = xml;
    var urls = (xml.match(/<loc>/g) || []).length;
    var lastmod = (xml.match(/<lastmod>([^<]+)</) || [])[1] || '—';
    document.getElementById('seo-sitemap-meta').textContent =
      urls + ' URLs · lastmod ' + lastmod + ' · regenerated automatically on every deploy';
  }).catch(function (err) {
    document.getElementById('seo-sitemap-view').textContent = 'Could not load /sitemap.xml — ' + (err.message || err);
  });
  fetch('robots.txt', { cache: 'no-store' }).then(function (r) { return r.text(); })
    .then(function (txt) { document.getElementById('seo-robots-view').textContent = txt; })
    .catch(function () {});
}

function downloadText(filename, text, mime){
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
  a.download = filename;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
}

// ---------------------------------------------------------------------------
// Tab: Settings
// ---------------------------------------------------------------------------

function loadSettingsTab(){
  var g = SEO_SETTINGS || {};
  document.getElementById('seo-s-sitename').value = g.siteName || 'Stryker Trading Academy';
  document.getElementById('seo-s-template').value = g.titleTemplate || '%page% — %site%';
  document.getElementById('seo-s-ogimage').value = g.ogImage || '';
  document.getElementById('seo-s-social').value = (g.socialProfiles || []).join('\n');
  document.getElementById('seo-s-discourage').checked = !!g.discourageIndexing;
}

function saveSettingsTab(){
  var doc = {
    siteName: document.getElementById('seo-s-sitename').value.trim(),
    titleTemplate: document.getElementById('seo-s-template').value.trim() || '%page% — %site%',
    ogImage: document.getElementById('seo-s-ogimage').value.trim() || null,
    socialProfiles: document.getElementById('seo-s-social').value.split('\n')
      .map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 10),
    discourageIndexing: document.getElementById('seo-s-discourage').checked,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  db.collection('settings').doc('seo').set(doc, { merge: true }).then(function () {
    SEO_SETTINGS = Object.assign({}, SEO_SETTINGS, doc);
    if (typeof showToast === 'function') {
      showToast(doc.discourageIndexing ? 'error' : 'success',
        doc.discourageIndexing
          ? 'Saved — the WHOLE SITE is now marked noindex. Turn this off before launch.'
          : 'SEO settings saved.');
    }
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('error', 'Could not save: ' + (err.message || err));
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {
  if (!document.getElementById('seo-tabs')) return;

  // tab switching
  document.querySelectorAll('#seo-tabs [data-seo-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#seo-tabs [data-seo-tab]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('.seo-tab-panel').forEach(function (p) {
        p.style.display = p.id === 'seo-tab-' + btn.dataset.seoTab ? '' : 'none';
      });
      if (btn.dataset.seoTab === 'sitemap') loadSitemapTab();
    });
  });

  // page picker
  var picker = document.getElementById('seo-page-picker');
  picker.innerHTML = SEO_PAGES.map(function (p) {
    return '<option value="' + p.key + '">' + seoEsc(p.label) + ' · ' + p.path + '</option>';
  }).join('');
  picker.addEventListener('change', function () { loadPageEditor(picker.value); });

  ['seo-f-title', 'seo-f-desc', 'seo-f-keyphrase'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', refreshEditorPreview);
  });
  document.getElementById('seo-save-page').addEventListener('click', savePageSeo);
  document.getElementById('seo-run-audit').addEventListener('click', runAudit);
  document.getElementById('seo-save-settings').addEventListener('click', saveSettingsTab);
  document.getElementById('seo-print-sitemap').addEventListener('click', function () { window.print(); });
  document.getElementById('seo-dl-sitemap').addEventListener('click', function () {
    downloadText('sitemap.xml', document.getElementById('seo-sitemap-view').textContent, 'application/xml');
  });
  document.getElementById('seo-dl-robots').addEventListener('click', function () {
    downloadText('robots.txt', document.getElementById('seo-robots-view').textContent, 'text/plain');
  });

  // stored data, then first render
  var ready = (typeof db !== 'undefined' && db)
    ? Promise.all([
        db.collection('settings').doc('seo').get().catch(function(){ return null; }),
        db.collection('seoPages').get().catch(function(){ return null; })
      ])
    : Promise.resolve([null, null]);

  ready.then(function (res) {
    SEO_SETTINGS = res[0] && res[0].exists ? res[0].data() : {};
    if (res[1]) res[1].forEach(function (d) { SEO_OVERRIDES[d.id] = d.data(); });
    loadSettingsTab();
    loadPageEditor('index');
    runAudit();
  });
});
