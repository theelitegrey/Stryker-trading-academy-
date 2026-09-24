// Stryker Trading Academy — Meta Pixel loader (browser side)
//
// Loads NOTHING — no script tag, no network request to facebook.net, not
// even the fbq stub — unless BOTH of these are true:
//   1. settings/commerce.metaPixelId is set to a non-empty string in
//      Firestore (admin-controlled; there is no default pixel id).
//   2. Marketing/ad cookie consent is granted, if the site has a consent
//      mechanism at all. There is no consent banner shipped yet, so by
//      default nothing blocks loading; the moment a consent system exists
//      (window.strykerConsent, or a `stryker_consent` localStorage record —
//      see strykerMetaConsentGranted below) this file honours it without
//      needing to be touched again.
//
// Until an id is configured in the Commerce admin panel this file is a
// complete no-op: no fetch, no <script> tag, no fbq global, nothing that
// could be seen in a network tab. That is the whole point of shipping this
// disabled — there are no live pixel/CAPI ids yet.
//
// Depends on: assets/progress.js (global `db`), loaded on public pages only
// (never on admin/editor pages — those have nothing to advertise).
//
// Usage from other modules, once loaded:
//   strykerTrack('Lead', { content_name: 'FVG cheat sheet' });
//   strykerTrack('Purchase', { value: 49, currency: 'USD' }, 'purchase_' + orderId);
// The third argument is the event_id. Pass a DETERMINISTIC id (e.g.
// 'purchase_' + orderId, 'signup_' + uid) for any event that is also sent
// server-side via functions-src/metaCapi.js, so Meta can dedupe the two
// deliveries of the same real-world event. Omit it for events with no
// server-side twin (PageView, ViewContent, InitiateCheckout, Lead) — an id
// is still generated so every call has one, per spec, it just has nothing to
// match against.

(function (root) {
  'use strict';

  // ---- Pure logic, testable under Node with no DOM -----------------------

  // True unless a recognised consent record explicitly says marketing/ads
  // cookies were declined. No consent system exists on the site yet, so the
  // default is "granted" — there's nothing yet to respect. This function is
  // the single place that changes the moment one ships.
  function strykerMetaConsentGranted(win) {
    win = win || root;
    try {
      var c = win && win.strykerConsent;
      if (c) {
        if (typeof c.marketingAllowed === 'function') return !!c.marketingAllowed();
        if (typeof c.marketingAllowed === 'boolean') return c.marketingAllowed;
      }
      var raw = win && win.localStorage ? win.localStorage.getItem('stryker_consent') : null;
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed.marketing === 'boolean') return parsed.marketing;
      }
    } catch (e) { /* fail open — see comment above */ }
    return true;
  }

  // Random event id for client-only events. Deterministic ids for
  // client+server events are built by the caller (see file header).
  function strykerMetaEventId() {
    try {
      if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    } catch (e) {}
    return 'ev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  // Queues track() calls made before the pixel script has finished loading
  // (or forever, if it's disabled) so callers never need to know pixel state.
  var _queue = [];
  var _ready = false;
  var _enabled = false; // becomes true only after id + consent both check out

  function strykerTrack(eventName, params, eventId) {
    var id = eventId || strykerMetaEventId();
    if (!_enabled) return id; // disabled: swallow silently, still return an id
    var call = { eventName: eventName, params: params || {}, eventId: id };
    if (_ready && typeof root.fbq === 'function') {
      root.fbq('track', call.eventName, call.params, { eventID: call.eventId });
    } else {
      _queue.push(call);
    }
    return id;
  }

  function _flushQueue() {
    if (typeof root.fbq !== 'function') return;
    while (_queue.length) {
      var call = _queue.shift();
      root.fbq('track', call.eventName, call.params, { eventID: call.eventId });
    }
  }

  // Standard Meta Pixel base code, unmodified apart from formatting. Only
  // ever called once we already know an id is set and consent is granted.
  function _loadPixelScript() {
    /* eslint-disable */
    if (root.fbq) return;
    var n = root.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!root._fbq) root._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    var t = document.createElement('script'); t.async = true;
    t.src = 'https://connect.facebook.net/en_US/fbevents.js';
    var s = document.getElementsByTagName('script')[0];
    s.parentNode.insertBefore(t, s);
    /* eslint-enable */
  }

  function initStrykerPixel(pixelId, win) {
    win = win || root;
    if (!pixelId || !strykerMetaConsentGranted(win)) return false;
    _enabled = true;
    _loadPixelScript();
    win.fbq('init', pixelId);
    _ready = true;
    _flushQueue();
    win.fbq('track', 'PageView', {}, { eventID: strykerMetaEventId() });
    return true;
  }

  // ---- ViewContent on the pricing section ---------------------------------
  // Fires once per page view, the first time #pricing (index.html) scrolls
  // into the viewport. A no-op on pages without that element.
  function _wirePricingViewContent(doc) {
    var el = doc.getElementById('pricing');
    if (!el || typeof root.IntersectionObserver !== 'function') return;
    var fired = false;
    var io = new root.IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (fired || !entry.isIntersecting) return;
        fired = true;
        strykerTrack('ViewContent', { content_name: 'Pricing' });
        io.disconnect();
      });
    }, { threshold: 0.25 });
    io.observe(el);
  }

  var api = {
    consentGranted: strykerMetaConsentGranted,
    buildEventId: strykerMetaEventId,
    track: strykerTrack,
    init: initStrykerPixel,
    _wirePricingViewContent: _wirePricingViewContent,
    _isEnabled: function () { return _enabled; }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.StrykerPixel = api;
    root.strykerTrack = strykerTrack;
    root.strykerMetaEventId = strykerMetaEventId;
  }

  // ---- Browser bootstrap: read the id from Firestore, then maybe init -----
  // Skipped entirely under Node (no `document`) and on any page that hasn't
  // loaded progress.js (no global `db`) — never throws either way.
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      try {
        if (typeof db === 'undefined' || !db) return; // Firestore not ready — do nothing
        db.collection('settings').doc('commerce').get().then(function (doc) {
          var id = doc.exists ? String(doc.data().metaPixelId || '').trim() : '';
          if (!id) return; // no pixel configured — stay fully inert
          initStrykerPixel(id, window);
          _wirePricingViewContent(document);
        }).catch(function () { /* Firestore read failed — stay inert, never block the page */ });
      } catch (e) { /* never let pixel setup break the page */ }
    });
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
