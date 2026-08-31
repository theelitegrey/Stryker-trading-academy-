// Stryker Trading Academy — SEO runtime (public pages)
// Depends on: assets/progress.js (`db`)
//
// Applies what the SEO admin module stores in Firestore over the baked-in
// tags: settings/seo for the site-wide pieces, seoPages/{page} for per-page
// overrides. The baked tags stay the fallback — with Firestore unreachable or
// empty, the page is exactly what shipped.
//
// HONEST LIMITS OF THIS APPROACH, stated once: Google renders JavaScript, so
// titles, descriptions and robots directives set here are seen and indexed.
// Social link crawlers (WhatsApp, X, Facebook) do NOT run JS — Open Graph
// changes made here improve nothing for link previews; those come from the
// baked tags. The admin module says the same next to the fields it affects.

(function () {

  function pageKey(){
    var f = (location.pathname.split('/').pop() || 'index').toLowerCase().replace(/\.html$/, '');
    return f === '' ? 'index' : f;
  }

  function setMeta(attr, name, content){
    if (content == null || content === '') return;
    var el = document.querySelector('meta[' + attr + '="' + name + '"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, name);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }

  function apply(global, page){
    var g = global || {}, p = page || {};

    // Master visibility switch (Yoast's "discourage search engines"): wins
    // over everything, including a per-page choice.
    if (g.discourageIndexing) setMeta('name', 'robots', 'noindex, nofollow');
    else if (p.noindex) setMeta('name', 'robots', 'noindex, follow');

    var title = p.title ||
      (p.titleBase && g.titleTemplate
        ? g.titleTemplate.replace('%page%', p.titleBase).replace('%site%', g.siteName || 'Stryker Trading Academy')
        : null);
    if (title) {
      document.title = title;
      setMeta('property', 'og:title', title);
      setMeta('name', 'twitter:title', title);
    }
    var desc = p.description || null;
    if (desc) {
      setMeta('name', 'description', desc);
      setMeta('property', 'og:description', desc);
      setMeta('name', 'twitter:description', desc);
    }
    if (p.canonical) {
      var link = document.querySelector('link[rel="canonical"]');
      if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link); }
      link.href = p.canonical;
    }
    if (g.ogImage) {
      setMeta('property', 'og:image', g.ogImage);
      setMeta('name', 'twitter:image', g.ogImage);
    }

    // Organization schema with the social profiles from settings (sameAs is
    // how the knowledge panel connects the site to its accounts).
    var social = (g.socialProfiles || []).filter(Boolean);
    if (social.length && !document.getElementById('seo-org-ld')) {
      var ld = document.createElement('script');
      ld.type = 'application/ld+json';
      ld.id = 'seo-org-ld';
      ld.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        '@id': 'https://strykertrading.com/#org-social',
        name: g.siteName || 'Stryker Trading Academy',
        url: 'https://strykertrading.com/',
        sameAs: social
      });
      document.head.appendChild(ld);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof db === 'undefined' || !db) return;
    Promise.all([
      db.collection('settings').doc('seo').get().catch(function(){ return null; }),
      db.collection('seoPages').doc(pageKey()).get().catch(function(){ return null; })
    ]).then(function (res) {
      var g = res[0] && res[0].exists ? res[0].data() : null;
      var p = res[1] && res[1].exists ? res[1].data() : null;
      if (g || p) apply(g, p);
    }).catch(function(){ /* baked tags stand */ });
  });

  window.__seoApply = apply;   // exercised directly by tests and the admin preview
})();
