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
  var TITLES = { success: 'Done', error: 'Something went wrong', info: 'Heads up', warning: 'Warning' };

  // One icon family, 20px, stroke 2.
  var ICONS = {
    success: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    error:   '<path d="M7 7l10 10M17 7L7 17"/>',
    info:    '<path d="M12 11v5M12 8h.01"/>',
    warning: '<path d="M12 8v5M12 16.5h.01"/>',
    loading: '<path d="M12 3a9 9 0 1 0 9 9" class="toast-spin"/>'
  };

  // Look: compact dark pill that morphs (gooey SVG filter) into a card when it has a
  // description or action. Dark in both themes, like the reference. Injected here so every
  // page that loads toast.js gets it without touching a stylesheet.
  var CSS = '' +
  '.toast-host{position:fixed;z-index:1000;top:calc(12px + env(safe-area-inset-top,0px));left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:18px;pointer-events:none}' +
  '.toast{--tc:#03c988;--tw:max-content;position:relative;width:min(340px,calc(100vw - 24px));display:flex;flex-direction:column;align-items:center;pointer-events:none;color:#fff;' +
    'opacity:0;transform:translateY(-120%) scale(.85);transform-origin:50% 0;transition:transform .5s cubic-bezier(.34,1.56,.64,1),opacity .2s ease}' +
  '.toast{touch-action:none}.toast.pill{width:auto}' +
  '.toast.in{opacity:1;transform:none}' +
  '.toast.out{opacity:0;transform:translateY(-50%) scale(.5);transition:transform .28s cubic-bezier(.4,0,1,1),opacity .28s ease}' +
  '.toast.dragging{transition:none}' +
  '.toast-success{--tc:#2fd98f}.toast-error{--tc:#ff6b70}.toast-info{--tc:#5aa9ff}.toast-warning{--tc:#f5b44a}.toast-loading{--tc:rgba(255,255,255,.7)}' +
  '.tz-goo{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;filter:url(#tz-goo) drop-shadow(0 6px 14px rgba(0,0,0,.35)) drop-shadow(0 0 .5px rgba(255,255,255,.35))}' +
  '.tz-goo i{display:block;background:#0b0b0d}' +
  '.tz-goo .gt{height:36px;width:var(--tw);border-radius:18px;flex:none;transition:width .45s cubic-bezier(.34,1.3,.64,1)}' +
  '.tz-goo .gb{flex:1;width:100%;margin-top:-8px;border-radius:20px;transform:scale(.3,.1);transform-origin:50% 0;opacity:0;transition:transform .5s cubic-bezier(.34,1.3,.64,1),opacity .2s}' +
  '.toast.open .gb{transform:none;opacity:1}' +
  '.tz-tab{position:relative;height:36px;box-sizing:border-box;width:var(--tw);max-width:100%;overflow:hidden;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 14px 0 10px;white-space:nowrap;pointer-events:auto;cursor:pointer;transition:width .45s cubic-bezier(.34,1.3,.64,1);-webkit-tap-highlight-color:transparent}' +
  '.tz-tab:focus-within{outline:2px solid var(--tc);outline-offset:-2px;border-radius:18px}' +
  '.toast-icon{display:inline-flex;flex:none;color:var(--tc);width:20px;height:20px;transition:color .3s}' +
  '.toast-icon.swap,.toast-title.swap{animation:toast-swap .4s cubic-bezier(.34,1.56,.64,1)}' +
  '@keyframes toast-swap{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:none}}' +
  '.toast-spin{transform-origin:12px 12px;animation:toast-rot .8s linear infinite}@keyframes toast-rot{to{transform:rotate(360deg)}}' +
  '.toast-title{flex:none;max-width:260px;font:600 14px/20px sans-serif;font-family:inherit;color:var(--tc);overflow:hidden;text-overflow:ellipsis;transition:color .3s}' +
  '.toast-close{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);border:0;padding:0}' +
  '.tz-card{position:relative;width:100%;display:grid;grid-template-rows:0fr;pointer-events:none;transition:grid-template-rows .5s cubic-bezier(.34,1.2,.64,1)}' +
  '.toast.open .tz-card{grid-template-rows:1fr;pointer-events:auto}' +
  '.tz-card-in{min-height:0;overflow:hidden;opacity:0;transition:opacity .25s ease}' +
  '.toast.open .tz-card-in{opacity:1;transition-delay:.12s}' +
  '.tz-card-pad{padding:6px 16px 16px;display:flex;flex-direction:column;gap:12px}' +
  '.toast-msg{margin:0;font:400 13px/18px sans-serif;font-family:inherit;color:rgba(255,255,255,.74);word-break:break-word}' +
  '.toast-action{min-height:44px;width:100%;border:0;border-radius:12px;cursor:pointer;background:rgba(255,255,255,.1);color:var(--tc);font:600 14px/20px sans-serif;font-family:inherit;transition:background .15s}' +
  '.toast-action:hover{background:rgba(255,255,255,.16)}.toast-action:focus-visible{outline:2px solid var(--tc);outline-offset:2px}' +
  '@media (prefers-reduced-motion:reduce){.toast,.toast.in,.toast.out{transform:none;transition:opacity .15s linear}.tz-goo .gt,.tz-goo .gb,.tz-tab,.tz-card,.tz-card-in{transition:none}.toast-icon.swap,.toast-title.swap{animation:none}}';

  function injectStyle() {
    if (document.getElementById('stryker-toast-css')) return;
    var st = document.createElement('style');
    st.id = 'stryker-toast-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function host() {
    var el = document.getElementById(HOST_ID);
    if (el) return el;
    injectStyle();
    el = document.createElement('div');
    el.id = HOST_ID;
    el.className = 'toast-host';
    // aria-live so a screen reader announces it without stealing focus.
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('role', 'status');
    // Gooey filter: blur then threshold the alpha so touching shapes fuse like liquid.
    el.innerHTML = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
      '<filter id="tz-goo" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="6"/>' +
      '<feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"/></filter></defs></svg>';
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

  // Split (message, options) into the pill title and the card description.
  function split(type, message, opts) {
    var title = opts.title || '', msg = message === null || message === undefined ? '' : String(message);
    if (opts.description) { msg = opts.description; if (!title) title = String(message || ''); }
    else if (!title && msg && msg.length <= 28 && !/[.!?]$/.test(msg.trim())) { title = msg; msg = ''; }
    if (!title) title = TITLES[type] || 'Heads up';
    return { title: title, msg: msg };
  }

  // Build one toast. Returns a controller: { update(type, message, opts), close(), arm(ms), promise }.
  function create(type, message, opts) {
    type = ICONS[type] ? type : 'info';
    var sp = split(type, message, opts);
    var toast = document.createElement('div');
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.innerHTML =
      '<div class="tz-goo" aria-hidden="true"><i class="gt"></i><i class="gb"></i></div>' +
      '<div class="tz-tab"><span class="toast-icon"></span><span class="toast-title"></span>' +
        '<button type="button" class="toast-close" aria-label="Dismiss">Dismiss</button></div>' +
      '<div class="tz-card"><div class="tz-card-in"><div class="tz-card-pad"><p class="toast-msg"></p>' +
        '<button type="button" class="toast-action"></button></div></div></div>';
    var tab = toast.querySelector('.tz-tab'), icon = toast.querySelector('.toast-icon'),
        ttl = toast.querySelector('.toast-title'), msgEl = toast.querySelector('.toast-msg'),
        actEl = toast.querySelector('.toast-action');
    var cur = opts;

    function fill(swap) {
      toast.className = 'toast toast-' + type + (toast.classList.contains('in') ? ' in' : '') +
        (toast.classList.contains('open') ? ' open' : '') + (toast.classList.contains('hold') ? ' hold' : '');
      icon.innerHTML = svg(ICONS[type], 20);
      ttl.textContent = sp.title;
      msgEl.textContent = sp.msg; msgEl.style.display = sp.msg ? '' : 'none';
      actEl.textContent = cur.action ? cur.action.label : ''; actEl.style.display = cur.action ? '' : 'none';
      var card = !!(sp.msg || cur.action);
      toast.classList.toggle('pill', !card);
      toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
      if (swap) { [icon, ttl].forEach(function (n) { n.classList.remove('swap'); void n.offsetWidth; n.classList.add('swap'); }); }
      toast._card = card;
      fit();
    }
    // Pin the tab to its natural width so it can animate between sizes.
    function fit() {
      if (!toast.parentElement) return;
      tab.style.transition = 'none'; tab.style.width = 'max-content'; tab.style.maxWidth = 'none';
      var w = Math.min(tab.offsetWidth + 1, window.innerWidth - 24);
      tab.style.width = ''; tab.style.maxWidth = ''; tab.style.transition = '';
      toast.style.setProperty('--tw', w + 'px');
    }
    if (opts.hold) toast.classList.add('hold');
    fill(false);

    var settled = false, timer = null, startedAt = 0, remaining = 0, hovering = false, touching = false, openT = null, resolveFn;
    var promise = new Promise(function (r) { resolveFn = r; });

    function remove() {
      if (toast.parentElement) toast.parentElement.removeChild(toast);
      resolveFn();
    }
    function leave() {
      toast.classList.remove('in'); toast.classList.add('out');
      toast.addEventListener('transitionend', remove, { once: true });
      setTimeout(remove, 450);
    }
    function close() {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      clearTimeout(openT);
      // Card folds back into the pill first, then the pill leaves.
      if (toast.classList.contains('open')) { toast.classList.remove('open'); setTimeout(leave, 380); } else leave();
    }
    function arm(ms) {
      if (settled) return;
      if (ms) remaining = ms;
      if (cur.hold && ms === undefined) return;
      clearTimeout(timer);
      startedAt = Date.now();
      timer = setTimeout(close, remaining);
    }
    function pause() {
      if (settled || !timer) return;
      clearTimeout(timer); timer = null;
      remaining = Math.max(600, remaining - (Date.now() - startedAt));
    }
    function resume() { if (hovering || touching || timer || settled || (cur.hold && !cur._armed)) return; arm(); }
    function openCard() { clearTimeout(openT); if (toast._card) openT = setTimeout(function () { toast.classList.add('open'); }, 280); }

    tab.addEventListener('click', close);
    toast.querySelector('.toast-close').addEventListener('click', close);
    actEl.addEventListener('click', function () { close(); try { cur.action.onClick(); } catch (e) {} });
    toast.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'mouse') return; hovering = true; pause(); });
    toast.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'mouse') return; hovering = false; resume(); });
    toast.addEventListener('focusin', function () { hovering = true; pause(); });
    toast.addEventListener('focusout', function () { hovering = false; resume(); });

    // Swipe to dismiss (touch / pen): sideways past 80px, or flick up.
    var sx = 0, sy = 0, dx = 0, dy = 0, st = 0, drag = false;
    toast.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' || e.target.closest('button')) return;
      touching = true; pause(); sx = e.clientX; sy = e.clientY; dx = dy = 0; st = Date.now(); drag = false;
      try { toast.setPointerCapture(e.pointerId); } catch (x) {}
    });
    toast.addEventListener('pointermove', function (e) {
      if (!touching) return;
      dx = e.clientX - sx; dy = Math.min(0, e.clientY - sy);
      if (!drag && (Math.abs(dx) > 8 || dy < -8)) { drag = true; toast.classList.add('dragging'); }
      if (drag) { toast.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; toast.style.opacity = String(Math.max(0.2, 1 - Math.max(Math.abs(dx), -dy) / 200)); }
    });
    function end() {
      if (!touching) return;
      touching = false;
      toast.classList.remove('dragging');
      var d = Math.max(Math.abs(dx), -dy), fast = d / Math.max(1, Date.now() - st) > 0.5;
      if (drag && (d > 60 || (fast && d > 30))) {
        toast.style.transition = 'opacity .18s ease, transform .18s ease';
        toast.style.transform = 'translate(' + (-dy > Math.abs(dx) ? '0,-120%' : (dx > 0 ? '120%' : '-120%') + ',0') + ')'; toast.style.opacity = '0';
        settled = true; if (timer) clearTimeout(timer); clearTimeout(openT);
        setTimeout(remove, 200);
      } else { toast.style.transform = ''; toast.style.opacity = ''; resume(); }
    }
    toast.addEventListener('pointerup', end);
    toast.addEventListener('pointercancel', end);

    host().appendChild(toast);
    fit();
    // Refit when the title's real width changes (web font arriving after first paint).
    if (window.ResizeObserver) new ResizeObserver(fit).observe(ttl);
    // Next frame, so the start position registers before the class change animates away from it.
    requestAnimationFrame(function () { toast.classList.add('in'); openCard(); });

    return {
      promise: promise, close: close, el: toast,
      arm: function (ms) { cur._armed = true; arm(ms); },
      update: function (t2, m2, o2) {
        if (settled) return;
        type = ICONS[t2] ? t2 : 'info'; cur = o2 || {}; sp = split(type, m2, cur);
        var wasOpen = toast.classList.contains('open');
        fill(true);
        if (!toast._card) toast.classList.remove('open'); else if (!wasOpen) openCard();
      }
    };
  }

  function showToast(type, message, options) {
    // A few older callers pass (message, type); accept both orders.
    if (!ICONS[type] && ICONS[message]) { var t0 = type; type = message; message = t0; }
    var opts = options || {};
    type = ICONS[type] && type !== 'loading' ? type : 'info';
    var c = create(type, message, opts);
    if (!opts.hold) c.arm(opts.duration || DEFAULT_MS[type] + (c.el._card ? 1500 : 0));
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
      c.arm(o.duration || DEFAULT_MS[type] + (c.el._card ? 1500 : 0));
    }
    Promise.resolve(p).then(function (r) { done('success', m.success, r, 'Done'); },
                            function (e) { done('error', m.error, e, 'Something went wrong'); });
    return p;
  };

  window.showToast = showToast;

  // Drop-in for alert(). Kept deliberately separate so the intent at each call
  // site stays readable, and so a future change to alert handling doesn't have
  // to touch every one of them.
  window.toastAlert = function (message) {
    return showToast('info', message);
  };

})();
