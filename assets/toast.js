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
//   showToast('success' | 'error' | 'info' | 'warning' | 'loading', message, options)
// Look: calm card that follows the theme; behaviour: stack of up to 3 with a timer line (Owner 17 Nov 2026).
// Chart toasts (Vela's own) are routed here too, see assets/vela-chart.js.
//
// A NOTE ON BLOCKING
// alert() halts execution until dismissed; a toast does not. That is almost
// always an improvement, but it matters for the handful of places that alert
// and then immediately navigate — the toast would be destroyed with the page
// before it could be read. Those call sites pass { hold: true }, which returns
// a promise resolving when the toast closes, so the caller can await it.

(function () {

  var HOST_ID = 'stryker-toast-host';
  // success/info 4 s, warning 6 s; error and loading stay until closed/resolved.
  var DEFAULT_MS = { success: 4000, info: 4000, warning: 6000 };
  var TITLES = { success: 'Done', error: 'Something went wrong', info: 'Heads up', warning: 'Warning', loading: 'Loading…' };
  var MAX = 10, GAP = 8;

  var ICONS = {
    success: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    error:   '<path d="M7 7l10 10M17 7L7 17"/>',
    info:    '<path d="M12 11v5M12 8h.01"/>',
    warning: '<path d="M12 7.5v5.5M12 16.5h.01"/>',
    loading: '<path d="M12 3a9 9 0 1 0 9 9" class="toast-spin"/>'
  };

  var CSS = '' +
  '.toast-host{--card:#16171b;--line:#2a2c33;--ink:#f2f3f5;--ink2:#a3a7b0;--ink3:#8a8f9a;--sh:0 10px 28px rgba(0,0,0,.45);' +
    'position:fixed;z-index:2147483001;width:min(340px,calc(100vw - 24px));height:0;top:calc(var(--topbar-h,68px) + 16px);right:16px;pointer-events:none}' +
  'html:has(#stkc-bar) .toast-host{top:calc(var(--stkc-top,var(--topbar-h,68px)) + 56px)}' +
  ':root[data-theme="light"] .toast-host{--card:#fff;--line:#e3e5ea;--ink:#111;--ink2:#5b6070;--ink3:#6b7080;--sh:0 10px 30px rgba(20,24,40,.12)}' +
  '@media (max-width:600px){html:not(.bt-tz) .toast-host{top:auto;right:auto;left:50%;margin-left:calc(min(340px,100vw - 24px) / -2);bottom:calc(16px + env(safe-area-inset-bottom,0px) + var(--stkc-dock,0px))}}' +
  '@media (max-width:820px){body.has-appdock .toast-host,body.nav-authed .toast-host{bottom:calc(84px + env(safe-area-inset-bottom,0px))}}' +
  '.toast{--tc:#22c55e;position:absolute;left:0;right:0;top:0;transform-origin:50% 0;box-sizing:border-box;display:flex;align-items:flex-start;gap:12px;padding:12px 10px 12px 12px;overflow:hidden;' +
    'background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--sh);color:var(--ink);font-family:inherit;pointer-events:auto;touch-action:pan-y;' +
    'transition:transform .28s cubic-bezier(.2,.8,.2,1),opacity .28s ease}' +
  '.toast.up{top:auto;bottom:0;transform-origin:50% 100%}.toast.dragging{transition:none}' +
  '.toast-success{--tc:#22c55e}.toast-info{--tc:#4c8dff}.toast-warning{--tc:#e8b44c}.toast-error{--tc:#ef4444}.toast-loading{--tc:#a3a7b0}' +
  ':root[data-theme="light"] .toast-success{--tc:#16a34a}:root[data-theme="light"] .toast-info{--tc:#2563eb}:root[data-theme="light"] .toast-warning{--tc:#b7791f}:root[data-theme="light"] .toast-error{--tc:#dc2626}:root[data-theme="light"] .toast-loading{--tc:#5b6070}' +
  '.toast-icon{flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;color:var(--tc);background:color-mix(in srgb,var(--tc) 16%,transparent)}' +
  '.toast-icon svg{width:14px;height:14px;display:block}' +
  '.toast-spin{transform-origin:12px 12px;animation:toast-rot .8s linear infinite}@keyframes toast-rot{to{transform:rotate(360deg)}}' +
  '.toast-body{flex:1;min-width:0;padding-top:2px}' +
  '.toast-title,.toast-msg{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;overflow-wrap:anywhere;white-space:pre-line;margin:0;font-family:inherit}' +
  '.toast-title{font-size:13.5px;font-weight:500;line-height:18px;color:var(--ink)}' +
  '.toast-msg{font-size:12.5px;font-weight:400;line-height:17px;color:var(--ink2);margin-top:2px}' +
  '.toast-action,.toast-close{align-self:center;flex:none;font-family:inherit}' +
  '.toast-action{font-size:12.5px;font-weight:600;line-height:1;height:28px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer;white-space:nowrap;max-width:45%;overflow:hidden;text-overflow:ellipsis}' +
  '.toast-action:hover{background:color-mix(in srgb,var(--ink) 8%,transparent)}' +
  '.toast-close{position:relative;width:22px;height:22px;display:grid;place-items:center;padding:0;border:0;border-radius:6px;background:transparent;color:var(--ink3);cursor:pointer;font-size:0}' +
  '.toast-close svg{width:14px;height:14px}.toast-close::after{content:"";position:absolute;inset:-8px}' +
  '.toast-close:hover{color:var(--ink)}' +
  '.toast-action:focus-visible,.toast-close:focus-visible{outline:2px solid var(--tc);outline-offset:2px}' +
  '.toast-timer{position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--tc);transform-origin:0 50%;animation:toast-tm var(--ms) linear forwards;animation-play-state:var(--ps,running)}' +
  '@keyframes toast-tm{from{transform:scaleX(1)}to{transform:scaleX(0)}}' +
  '@media (prefers-reduced-motion:reduce){.toast{transition:opacity .15s linear}.toast-spin{animation-duration:1.6s}}';

  function injectStyle() {
    if (document.getElementById('stryker-toast-css')) return;
    var st = document.createElement('style');
    st.id = 'stryker-toast-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  var list = [];            // newest first
  var fanned = false, leaveT = null;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)');
  var noMotion = function () { return !!(reduce && reduce.matches); };
  var isUp = function () { return window.innerWidth <= 600 && !document.documentElement.classList.contains('bt-tz'); };   // phones: bottom centre, stack grows upward (replay trainer keeps the top, clear of Sell/Buy)

  function host() {
    var el = document.getElementById(HOST_ID);
    if (el) return el;
    injectStyle();
    el = document.createElement('div');
    el.id = HOST_ID;
    el.className = 'toast-host';
    el.addEventListener('pointerover', function (e) { if (e.pointerType !== 'mouse') return; clearTimeout(leaveT); setFan(true); });
    el.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'mouse') return; leaveT = setTimeout(function () { setFan(false); }, 120); });
    el.addEventListener('focusin', function () { setFan(true); });
    el.addEventListener('focusout', function () { setFan(false); });
    document.body.appendChild(el);
    return el;
  }

  function setFan(v) {
    if (fanned === v) return;
    fanned = v;
    list.forEach(function (c) { c.hold(v); });
    layout();
  }

  // Collapsed = 3-deep stack (newest in front); fanned (hover/focus) = a list.
  function layout() {
    if (!list.length) fanned = false;   // the hovered toast vanished under the cursor: no pointerleave will come
    var up = isUp(), off = 0;
    list.forEach(function (c, i) {
      var el = c.el, y, s = 1, o = 1;
      el.classList.toggle('up', up);
      if (fanned) { y = off; off += el.offsetHeight + GAP; }
      else {
        y = i === 0 ? 0 : i === 1 ? 10 : 22;
        s = i === 0 ? 1 : i === 1 ? .95 : .9; o = i === 0 ? 1 : i === 1 ? .75 : i === 2 ? .45 : 0;
      }
      if (noMotion()) s = 1;
      el.style.zIndex = String(100 - i);
      el.style.opacity = String(o);
      el.style.pointerEvents = (!fanned && i > 0) ? 'none' : '';
      if (!el._drag) el.style.transform = 'translateY(' + (up ? -y : y) + 'px) scale(' + s + ')';
    });
  }

  function svg(inner) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  // A lone message is the title; with a description the message is the title.
  function split(type, message, opts) {
    var m = message === null || message === undefined ? '' : String(message);
    var title = opts.title ? String(opts.title) : '', msg = '';
    if (opts.description) { msg = String(opts.description); if (!title) title = m; }
    else if (title) msg = m;
    else title = m;
    if (!title) title = TITLES[type] || TITLES.info;
    return { title: title, msg: msg };
  }

  function create(type, message, opts) {
    type = ICONS[type] ? type : 'info';
    var sp = split(type, message, opts), cur = opts;
    var toast = document.createElement('div');
    toast.innerHTML = '<span class="toast-icon"></span><div class="toast-body"><p class="toast-title"></p><p class="toast-msg"></p></div>' +
      '<button type="button" class="toast-action"></button>' +
      '<button type="button" class="toast-close" aria-label="Dismiss notification">' + svg('<path d="M6 6l12 12M18 6L6 18"/>') + '</button>';
    var icon = toast.firstChild, ttl = toast.querySelector('.toast-title'), msgEl = toast.querySelector('.toast-msg'),
        actEl = toast.querySelector('.toast-action');
    var settled = false, timer = null, startedAt = 0, remaining = 0, paused = false, touching = false, resolveFn;
    var promise = new Promise(function (r) { resolveFn = r; });
    var api = { el: toast, promise: promise };

    function fill() {
      toast.className = 'toast toast-' + type + (isUp() ? ' up' : '');
      toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
      icon.innerHTML = svg(ICONS[type]);
      ttl.textContent = sp.title;
      msgEl.textContent = sp.msg; msgEl.style.display = sp.msg ? '' : 'none';
      actEl.textContent = cur.action ? cur.action.label : ''; actEl.style.display = cur.action ? '' : 'none';
    }
    fill();

    function unlist() { var i = list.indexOf(api); if (i >= 0) list.splice(i, 1); }
    function remove() { if (toast.parentElement) toast.parentElement.removeChild(toast); unlist(); layout(); resolveFn(); }
    function close() {
      if (settled) return;
      settled = true; clearTimeout(timer);
      toast.style.opacity = '0'; toast.style.pointerEvents = 'none';
      unlist(); layout();
      setTimeout(remove, noMotion() ? 150 : 280);
    }
    function line(ms) {
      var t = toast.querySelector('.toast-timer');
      if (!ms) { if (t) t.remove(); return; }
      if (!t) { t = document.createElement('i'); t.className = 'toast-timer'; toast.appendChild(t); }
      t.style.setProperty('--ms', ms + 'ms'); t.style.setProperty('--ps', paused ? 'paused' : 'running');
      t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    }
    function arm(ms) {
      if (settled) return;
      clearTimeout(timer); remaining = ms || 0;
      line(ms);
      if (!ms) return;
      startedAt = Date.now();
      if (!paused) timer = setTimeout(close, remaining);
    }
    // Hover / focus / touch pauses the countdown and the timer line.
    function hold(v) {
      if (settled) return;
      v = v || touching;
      if (v === paused) return;
      paused = v;
      if (remaining) {
        if (v) { clearTimeout(timer); remaining = Math.max(300, remaining - (Date.now() - startedAt)); }
        else { startedAt = Date.now(); timer = setTimeout(close, remaining); }
        var t = toast.querySelector('.toast-timer');
        if (t) t.style.setProperty('--ps', v ? 'paused' : 'running');
      }
    }
    api.hold = hold;

    actEl.addEventListener('click', function () { close(); try { cur.action.onClick(); } catch (e) {} });
    toast.querySelector('.toast-close').addEventListener('click', close);
    toast.addEventListener('focusin', function () { hold(true); });
    toast.addEventListener('focusout', function () { if (!fanned) hold(false); });

    // Swipe sideways to dismiss (touch / pen).
    var sx = 0, dx = 0, st = 0, drag = false;
    toast.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' || e.target.closest('button')) return;
      touching = true; hold(true); sx = e.clientX; dx = 0; st = Date.now(); drag = false;
      try { toast.setPointerCapture(e.pointerId); } catch (x) {}
    });
    toast.addEventListener('pointermove', function (e) {
      if (!touching) return;
      dx = e.clientX - sx;
      if (!drag && Math.abs(dx) > 8) { drag = true; toast._drag = true; toast.classList.add('dragging'); }
      if (drag) { toast.style.transform = 'translateX(' + dx + 'px)'; toast.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 240)); }
    });
    function end() {
      if (!touching) return;
      touching = false; toast.classList.remove('dragging');
      var d = Math.abs(dx), fast = d / Math.max(1, Date.now() - st) > 0.5;
      if (drag && (d > 80 || (fast && d > 30))) {
        toast.style.transition = 'transform .18s ease, opacity .18s ease';
        toast.style.transform = 'translateX(' + (dx > 0 ? '120%' : '-120%') + ')'; toast.style.opacity = '0';
        settled = true; clearTimeout(timer); unlist(); layout();
        setTimeout(remove, 200);
      } else { toast._drag = false; toast.style.opacity = ''; hold(false); layout(); }
    }
    toast.addEventListener('pointerup', end);
    toast.addEventListener('pointercancel', end);

    var h = host();
    toast.style.transition = 'none'; toast.style.opacity = '0';
    toast.style.transform = 'translateY(' + (isUp() ? 14 : -14) + 'px) scale(.96)';
    h.appendChild(toast);
    list.unshift(api);
    while (list.length > MAX) list[list.length - 1].close();
    if (fanned) paused = true;
    void toast.offsetWidth; toast.style.transition = '';
    layout();

    api.close = close;
    api.arm = function (ms) { cur._armed = true; arm(ms); };
    api.update = function (t2, m2, o2) {
      if (settled) return;
      type = ICONS[t2] ? t2 : 'info'; cur = o2 || {}; sp = split(type, m2, cur);
      fill(); line(0); clearTimeout(timer); remaining = 0;
      layout();
    };
    return api;
  }

  function showToast(type, message, options) {
    // A few older callers pass (message, type); accept both orders.
    if (!ICONS[type] && ICONS[message]) { var t0 = type; type = message; message = t0; }
    var opts = options || {};
    type = ICONS[type] && type !== 'loading' ? type : 'info';
    var c = create(type, message, opts);
    if (!opts.hold) c.arm(opts.duration || DEFAULT_MS[type] || 0);
    var p = c.promise; p.toast = c;
    return p;
  }

  // showToast.promise(p, { loading, success, error }). Each is a string, an options object
  // ({ title, description, action }) or a function of the result / error returning either.
  showToast.promise = function (p, m) {
    function norm(v, arg, dflt) {
      if (typeof v === 'function') v = v(arg);
      if (v === undefined || v === null) v = dflt;
      return typeof v === 'string' ? { title: v } : v;
    }
    var l = norm(m.loading, undefined, 'Loading…');
    var c = create('loading', l.title || '', { hold: true, description: l.description });
    function done(type, v, arg, dflt) {
      var o = norm(v, arg, dflt);
      c.update(type, o.title ? '' : (o.message || ''), o);
      c.arm(o.duration || DEFAULT_MS[type] || 0);
    }
    Promise.resolve(p).then(function (r) { done('success', m.success, r, 'Done'); },
                            function (e) { done('error', m.error, e, 'Something went wrong'); });
    return p;
  };

  window.showToast = showToast;

  // Drop-in for alert().
  window.toastAlert = function (message) {
    return showToast('info', message);
  };

})();
