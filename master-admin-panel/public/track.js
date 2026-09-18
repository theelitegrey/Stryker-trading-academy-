/* Master Admin Panel tracker. Embed on your site:
   <script defer src="https://YOUR-PANEL/track.js" data-site="SITE_ID"></script>
   Cookieless: sends path + referrer only. */
(function () {
  var s = document.currentScript || document.querySelector('script[data-site]');
  if (!s) return;
  var site = s.getAttribute('data-site');
  var base = s.getAttribute('data-endpoint') || s.src.replace(/\/track\.js.*$/, '');
  var last = '';
  function hit() {
    var p = location.pathname;
    if (p === last) return; last = p;
    if (/^localhost$|^127\./.test(location.hostname) && !s.hasAttribute('data-allow-local')) return;
    var u = base + '/collect?s=' + encodeURIComponent(site) + '&p=' + encodeURIComponent(p) + '&r=' + encodeURIComponent(document.referrer || '');
    if (navigator.sendBeacon) navigator.sendBeacon(u); else { var i = new Image(); i.src = u; }
  }
  hit();
  var push = history.pushState;
  history.pushState = function () { push.apply(this, arguments); setTimeout(hit, 0); };
  addEventListener('popstate', hit);
})();
