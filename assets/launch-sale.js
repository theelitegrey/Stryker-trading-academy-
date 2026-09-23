// Stryker Trading Academy: launch sale banner (build 319)
//
// Reads the REAL seat count from settings/commerce.launchSale
// ({ active, limit, taken }), which only the launchSaleOnOrder function
// writes (functions-src/launchSale.js), counting members who actually paid a
// launch price. No count, no banner: nothing here ever invents a number, and
// there is no countdown timer.
//
//   #launch-banner   full banner at the top of the pricing section
//   .launch-strip    slim one-line version, injected under the nav on public
//                    pages that load this file
(function () {
  function fetchState() {
    if (typeof strykerPreviewMode === 'function' && strykerPreviewMode()) {
      return fetch('tools/launch-sale/commerce.preview.json').then(function (r) { return r.json(); })
        .then(function (d) { return d.launchSale || null; });
    }
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return Promise.resolve(null);
    return firebase.firestore().collection('settings').doc('commerce').get()
      .then(function (doc) { return doc.exists ? (doc.data().launchSale || null) : null; })
      .catch(function () { return null; });
  }

  function valid(s) {
    return s && s.active === true && isFinite(s.limit) && s.limit > 0 &&
      isFinite(s.taken) && s.taken >= 0 && s.taken < s.limit;
  }

  // "up to N% OFF" from the real prices in the visitor's own currency (the
  // rupee and dollar discounts differ), never a hardcoded figure.
  function maxOff() {
    if (typeof strykerLoadPlans !== 'function' || typeof planSaleInfo !== 'function') return Promise.resolve(0);
    var fx = (typeof strykerFxReady === 'function') ? strykerFxReady() : Promise.resolve();
    return Promise.all([strykerLoadPlans(), fx]).then(function (r) {
      return (r[0] || []).filter(function (p) { return !p.hidden; })
        .reduce(function (m, p) { var i = planSaleInfo(p); return i.active ? Math.max(m, i.pct) : m; }, 0);
    }).catch(function () { return 0; });
  }

  function renderBanner(el, s, off) {
    var left = s.limit - s.taken;
    var pct = Math.min(100, Math.round((s.taken / s.limit) * 100));
    el.innerHTML =
      '<div class="ls-head"><span class="ls-fire" aria-hidden="true">🔥</span>' +
        '<b>LAUNCH SALE' + (off > 0 ? ': up to ' + off + '% OFF' : '') + '</b></div>' +
      '<p class="ls-sub">First ' + s.limit + ' members keep this price while subscribed · ' +
        '<b class="ls-left">' + left + ' spot' + (left === 1 ? '' : 's') + ' left</b></p>' +
      '<div class="ls-bar" role="progressbar" aria-label="Launch spots taken" aria-valuemin="0" aria-valuemax="' +
        s.limit + '" aria-valuenow="' + s.taken + '"><i style="transform:scaleX(' + (pct / 100) + ')"></i></div>';
    el.hidden = false;
  }

  function renderStrip(s) {
    var nav = document.getElementById('site-nav');
    if (!nav || document.querySelector('.launch-strip')) return;
    var left = s.limit - s.taken;
    var a = document.createElement('a');
    a.className = 'launch-strip';
    a.href = 'index.html#pricing';
    a.innerHTML = '<span aria-hidden="true">🔥</span><b>Launch sale</b>' +
      '<span class="ls-long">: founding prices for the first ' + s.limit + ' members</span>' +
      '<span class="ls-dot">·</span>' + left + ' spot' + (left === 1 ? '' : 's') + ' left' +
      '<span class="ls-go">See prices →</span>';
    nav.parentNode.insertBefore(a, nav);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var banner = document.getElementById('launch-banner');
    var wantStrip = !banner && document.body && !document.body.hasAttribute('data-no-launch-strip');
    if (!banner && !wantStrip) return;
    Promise.all([fetchState(), banner ? maxOff() : 0]).then(function (r) {
      var s = r[0];
      if (!valid(s)) return;            // sale off, sold out or unreadable: show nothing
      if (banner) renderBanner(banner, s, r[1]);
      else renderStrip(s);
    });
  });
})();
