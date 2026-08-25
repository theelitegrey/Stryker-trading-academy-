// Stryker Trading Academy — toast popups
//
// Replaces two things:
//   1. Inline status strips wedged into the page (the green "Order complete"
//      bar on checkout), which shift the layout, are easy to miss when the
//      page is scrolled elsewhere, and look like part of the content.
//   2. Native alert(), which is blocking, unstyled, and on mobile renders a
//      system dialog with the site's hostname in it.
//
// One global entry point so every confirmation across the site looks the same:
//   showToast('success' | 'error' | 'info', message, options)
//
// A NOTE ON BLOCKING
// alert() halts execution until dismissed; a toast does not. That is almost
// always an improvement, but it matters for the handful of places that alert
// and then immediately navigate — the toast would be destroyed with the page
// before it could be read. Those call sites pass { hold: true }, which returns
// a promise resolving when the toast closes, so the caller can await it.

(function () {

  var HOST_ID = 'stryker-toast-host';
  var DEFAULT_MS = { success: 4000, info: 5000, error: 7000 };

  var ICONS = {
    success: '<path d="M20 6L9 17l-5-5"/>',
    error:   '<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>',
    info:    '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'
  };

  function host() {
    var el = document.getElementById(HOST_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = HOST_ID;
    el.className = 'toast-host';
    // aria-live so a screen reader announces it without stealing focus, which
    // is the one genuine advantage alert() had.
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
    return el;
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function showToast(type, message, options) {
    var opts = options || {};
    type = ICONS[type] ? type : 'info';

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.innerHTML =
      '<span class="toast-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2.2">' + ICONS[type] + '</svg></span>' +
      '<div class="toast-body">' +
        (opts.title ? '<span class="toast-title">' + esc(opts.title) + '</span>' : '') +
        '<span class="toast-msg">' + esc(message) + '</span>' +
      '</div>' +
      '<button type="button" class="toast-close" aria-label="Dismiss">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
      '</button>';

    host().appendChild(toast);
    // Next frame, so the browser registers the starting position before the
    // class change animates away from it. Setting both in one frame skips the
    // transition entirely.
    requestAnimationFrame(function () { toast.classList.add('in'); });

    var settled = false;
    var timer = null;

    return new Promise(function (resolve) {
      function close() {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        toast.classList.remove('in');
        toast.addEventListener('transitionend', function () {
          if (toast.parentElement) toast.parentElement.removeChild(toast);
          resolve();
        }, { once: true });
        // Belt and braces: if the transition never fires (reduced motion,
        // background tab) the node would otherwise be orphaned forever.
        setTimeout(function () {
          if (toast.parentElement) toast.parentElement.removeChild(toast);
          resolve();
        }, 400);
      }

      toast.querySelector('.toast-close').addEventListener('click', close);

      var life = opts.duration || DEFAULT_MS[type];
      // hold:true keeps it up until dismissed — used where the caller awaits
      // this before navigating away.
      if (!opts.hold) timer = setTimeout(close, life);
    });
  }

  window.showToast = showToast;

  // Drop-in for alert(). Kept deliberately separate so the intent at each call
  // site stays readable, and so a future change to alert handling doesn't have
  // to touch every one of them.
  window.toastAlert = function (message) {
    return showToast('info', message);
  };

})();
