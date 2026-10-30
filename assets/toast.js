// TradeZoro — toast popups
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
  var DEFAULT_MS = { success: 4000, info: 5000, warning: 6000, error: 7000 };

  // One icon family, 20px, stroke 2.
  var ICONS = {
    success: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    error:   '<path d="M12 7v6M12 17h.01"/>',
    info:    '<path d="M12 11v5M12 8h.01"/>',
    warning: '<path d="M12 8v5M12 16.5h.01"/>'
  };

  function host() {
    var el = document.getElementById(HOST_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = HOST_ID;
    el.className = 'toast-host';
    // aria-live so a screen reader announces it without stealing focus.
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

  function svg(inner, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  function showToast(type, message, options) {
    // A few older callers pass (message, type); accept both orders.
    if (!ICONS[type] && ICONS[message]) { var t0 = type; type = message; message = t0; }
    var opts = options || {};
    type = ICONS[type] ? type : 'info';
    // Short one-line toasts ("Saved", "Link copied") read as a title, not a secondary line.
    var title = opts.title || '', msg = message;
    if (!title && msg && String(msg).length <= 28 && !/[.!?]$/.test(String(msg).trim()) ) { title = msg; msg = ''; }

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.innerHTML =
      '<span class="toast-grab" aria-hidden="true"></span>' +
      '<span class="toast-icon">' + svg(ICONS[type], 20) + '</span>' +
      '<div class="toast-body">' +
        (title ? '<span class="toast-title">' + esc(title) + '</span>' : '') +
        (msg ? '<span class="toast-msg">' + esc(msg) + '</span>' : '') +
      '</div>' +
      '<div class="toast-end">' +
        (opts.action ? '<button type="button" class="toast-action">' + esc(opts.action.label) + '</button>' : '') +
        '<button type="button" class="toast-close" aria-label="Dismiss">' + svg('<path d="M6 6l12 12M18 6L6 18"/>', 20) + '</button>' +
      '</div>' +
      '<span class="toast-bar" aria-hidden="true"><i></i></span>';
    if (!title) toast.querySelector('.toast-msg').style.cssText = 'font-size:15px;line-height:20px;font-weight:600;color:var(--tg-t1)';

    var life = opts.duration || DEFAULT_MS[type];
    toast.style.setProperty('--life', life + 'ms');
    if (opts.hold) toast.classList.add('hold');

    host().appendChild(toast);
    // Next frame, so the start position registers before the class change animates away from it.
    requestAnimationFrame(function () { toast.classList.add('in'); });

    var settled = false, timer = null, startedAt = 0, remaining = life, hovering = false, touching = false;

    return new Promise(function (resolve) {
      function remove() {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
        resolve();
      }
      function close() {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        toast.classList.remove('in');
        toast.classList.add('out');
        toast.addEventListener('transitionend', remove, { once: true });
        // Belt and braces: if the transition never fires (reduced motion, background tab).
        setTimeout(remove, 400);
      }
      function arm() {
        if (opts.hold || settled) return;
        startedAt = Date.now();
        timer = setTimeout(close, remaining);
      }
      function pause() {
        if (opts.hold || settled || !timer) return;
        clearTimeout(timer); timer = null;
        remaining = Math.max(600, remaining - (Date.now() - startedAt));
        toast.classList.add('paused');
      }
      function resume() {
        if (hovering || touching || timer) return;
        toast.classList.remove('paused');
        arm();
      }

      toast.querySelector('.toast-close').addEventListener('click', close);
      var act = toast.querySelector('.toast-action');
      if (act) act.addEventListener('click', function () { close(); try { opts.action.onClick(); } catch (e) {} });

      // Pause the countdown (timer and bar) while the pointer is over it or a finger is on it.
      toast.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'mouse') return; hovering = true; pause(); });
      toast.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'mouse') return; hovering = false; resume(); });
      toast.addEventListener('focusin', function () { hovering = true; pause(); });
      toast.addEventListener('focusout', function () { hovering = false; resume(); });

      // Swipe to dismiss (touch / pen): drag sideways past 80px, or flick.
      var sx = 0, sy = 0, dx = 0, st = 0, drag = false;
      toast.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' || e.target.closest('button')) return;
        touching = true; pause(); sx = e.clientX; sy = e.clientY; dx = 0; st = Date.now(); drag = false;
        try { toast.setPointerCapture(e.pointerId); } catch (x) {}
      });
      toast.addEventListener('pointermove', function (e) {
        if (!touching) return;
        dx = e.clientX - sx;
        if (!drag && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - sy)) { drag = true; toast.classList.add('dragging'); }
        if (drag) { toast.style.transform = 'translateX(' + dx + 'px)'; toast.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 260)); }
      });
      function end() {
        if (!touching) return;
        touching = false;
        toast.classList.remove('dragging');
        var fast = Math.abs(dx) / Math.max(1, Date.now() - st) > 0.5;
        if (drag && (Math.abs(dx) > 80 || (fast && Math.abs(dx) > 30))) {
          toast.style.transition = 'opacity .18s cubic-bezier(.2,0,0,1), transform .18s cubic-bezier(.2,0,0,1)';
          toast.style.transform = 'translateX(' + (dx > 0 ? 120 : -120) + '%)'; toast.style.opacity = '0';
          settled = true; if (timer) clearTimeout(timer);
          setTimeout(remove, 200);
        } else {
          toast.style.transform = ''; toast.style.opacity = '';
          resume();
        }
      }
      toast.addEventListener('pointerup', end);
      toast.addEventListener('pointercancel', end);

      arm();
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
