// Stryker Trading Academy — shared output-encoding and sanitising helpers
// Depends on: assets/vendor/purify.min.js (DOMPurify), loaded BEFORE this file
// on any page that renders user-authored HTML.
//
// WHY THIS FILE EXISTS
//
// Every rendering path on this site builds HTML by string concatenation and
// assigns it with innerHTML. That is fine for markup we wrote, and it is a
// stored-XSS hole the moment a user-controlled value lands in it unescaped.
// Before this file there were roughly forty-five per-file escape helpers of
// varying quality — several escaped only < and >, which is safe in a text
// node and useless inside an attribute, where a bare " ends the value and the
// next token can be onerror=. One helper, one behaviour, one place to audit.
//
// THE RULES
//
//   stkEsc(v)        text or attribute value  -> always safe
//   stkAttr(v)       alias of stkEsc, reads better at attribute sites
//   stkUrl(v)        href/src value           -> '' unless http(s) or a
//                                                 relative same-site path
//   stkImgUrl(v)     img src                  -> '' unless https: or a
//                                                 data:image/ payload
//   stkHtml(v)       user-authored rich text  -> DOMPurify with a tight
//                                                 allow-list
//
// FAIL CLOSED. If DOMPurify has not loaded, stkHtml escapes its input instead
// of returning it. A post that renders as visible tag soup is a bug report; a
// post that renders as an attacker's script is an incident.

(function (global) {
  'use strict';

  var AMP = /&/g, LT = /</g, GT = />/g, QUOT = /"/g, APOS = /'/g;

  // Escapes all five characters that matter in HTML. The apostrophe is not
  // optional: single-quoted attributes are used throughout this codebase.
  function stkEsc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(AMP, '&amp;')
      .replace(LT, '&lt;')
      .replace(GT, '&gt;')
      .replace(QUOT, '&quot;')
      .replace(APOS, '&#39;');
  }

  // Strips the characters a URL parser skips but a naive scheme check does
  // not: "java\tscript:alert(1)" is a working javascript: URL in browsers.
  var URL_NOISE = /[\u0000-\u0020\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u3000\ufeff]/g;

  function normaliseScheme(raw) {
    return String(raw).replace(URL_NOISE, '').toLowerCase();
  }

  // Characters that must never appear raw in a URL destined for an HTML
  // attribute. These two return a *scheme-safe* URL, not an escaped one — the
  // caller still wraps the result in stkEsc when building markup by hand.
  // Rejecting them here as well means a missed stkEsc downgrades from "script
  // runs" to "image does not load".
  var URL_BREAKOUT = /["'<>`]/;

  // Link targets. Absolute http(s) and relative in-site paths only. Anything
  // that could carry script (javascript:, data:, vbscript:, blob:) is dropped,
  // as is a protocol-relative //evil.example URL.
  function stkUrl(value) {
    if (!value) return '';
    var raw = String(value).trim();
    if (URL_BREAKOUT.test(raw)) return '';
    var flat = normaliseScheme(raw);
    if (flat.indexOf('//') === 0) return '';
    if (flat.indexOf('http://') === 0 || flat.indexOf('https://') === 0) return raw;
    if (/^[a-z][a-z0-9+.-]*:/.test(flat)) return '';   // any other scheme
    return raw;                                        // relative path
  }

  // Image sources. Remote images must be https (an http image on an https
  // page is blocked as mixed content anyway); inline images must be a real
  // base64 image payload, which is what the composer produces.
  function stkImgUrl(value) {
    if (!value) return '';
    var raw = String(value).trim();
    if (URL_BREAKOUT.test(raw)) return '';
    var flat = normaliseScheme(raw);
    if (flat.indexOf('https://') === 0) return raw;
    if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+$/.test(flat)) return raw;
    if (flat.indexOf(':') === -1 && flat.indexOf('//') !== 0) return raw;  // relative asset
    return '';
  }

  // The allow-list for user-authored rich text. It is deliberately close to
  // what the Trading Floor composer can actually produce with execCommand:
  // bold, italic, underline, strike, lists, links, line breaks, and the
  // hashtag/mention spans linkifyTags adds afterwards.
  var RICH_TAGS = [
    'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'mark',
    'p', 'br', 'div', 'span', 'a', 'ul', 'ol', 'li', 'blockquote',
    'code', 'pre', 'h3', 'h4', 'h5', 'h6', 'img'
  ];
  var RICH_ATTRS = ['href', 'target', 'rel', 'title', 'class', 'data-tag', 'data-mention', 'src', 'alt'];

  var purifyConfigured = false;

  function configurePurify(dp) {
    if (purifyConfigured || !dp || !dp.addHook) return;
    purifyConfigured = true;
    // Every surviving link leaves the site in a new tab with no window.opener
    // handle back to us, and every surviving image must pass stkImgUrl.
    dp.addHook('afterSanitizeAttributes', function (node) {
      if (node.tagName === 'A') {
        var safe = stkUrl(node.getAttribute('href') || '');
        if (!safe) {
          node.removeAttribute('href');
        } else {
          node.setAttribute('href', safe);
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer nofollow ugc');
        }
      }
      if (node.tagName === 'IMG') {
        var src = stkImgUrl(node.getAttribute('src') || '');
        if (!src) node.remove();
        else node.setAttribute('src', src);
      }
    });
  }

  // User-authored HTML. Returns markup that is safe to assign to innerHTML.
  function stkHtml(value) {
    if (value === null || value === undefined) return '';
    var dp = global.DOMPurify;
    if (!dp || typeof dp.sanitize !== 'function') {
      // Fail closed: show the markup as text rather than run it.
      if (global.console && console.warn) {
        console.warn('Stryker: DOMPurify is not loaded — rich text is being escaped, not rendered.');
      }
      return stkEsc(value);
    }
    configurePurify(dp);
    return dp.sanitize(String(value), {
      ALLOWED_TAGS: RICH_TAGS,
      ALLOWED_ATTR: RICH_ATTRS,
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'svg', 'math'],
      FORBID_ATTR: ['style', 'srcset', 'formaction', 'xlink:href']
    });
  }

  global.stkEsc = stkEsc;
  global.stkAttr = stkEsc;
  global.stkUrl = stkUrl;
  global.stkImgUrl = stkImgUrl;
  global.stkHtml = stkHtml;
})(typeof window !== 'undefined' ? window : this);
