// Shared hover-open for every dropdown / flyout (Owner 15 Nov). Mouse only (pointer:fine); touch/pen keep tap.
// One delegated listener; each menu's own click code does the real open/close (so aria-expanded etc. stay theirs).
//   hover trigger 80 ms -> trigger.click() opens; leave the trigger+panel box 180 ms -> closes (exit fade first).
//   A click on the trigger or inside the panel "pins" the menu: it then stays until a normal click-away / Esc.
//   Never opens while a mouse button is down (chart drag), and not on phone widths (those are bottom sheets).
// Animation lives in style.css (.mh-* rules + keyframes); this file only adds .mh-out for the exit.
(function () {
  'use strict';
  if (window.__mh) return;
  var mq = function (q) { try { return window.matchMedia(q).matches; } catch (e) { return false; } };
  var FINE = '(hover:hover) and (pointer:fine)';
  var IN_MS = 80, OUT_MS = 180, EXIT_MS = 100;

  function qs(root, sel) { try { return root.querySelector(sel); } catch (e) { return null; } }
  function vis(el) { return !!(el && !el.hidden && el.getClientRects().length); }
  function byCtl(t) { var id = t.getAttribute('aria-controls'); return id ? document.getElementById(id) : null; }
  function scoped(sel, anc) { return function (t) { var a = anc ? t.closest(anc) : t.parentElement; return byCtl(t) || (a && qs(a, sel)) || qs(document, sel); }; }

  // t: trigger selector. p(t): panel element. keep: extra selector whose elements count as "inside" (nested popups).
  var MENUS = [
    { t: '#account-trigger', p: scoped('#account-panel') },
    { t: '.stk-iv-caret', p: scoped('#stk-iv-menu') },
    { t: '#stkl-btn, #stkc-layout-btn, #stkr-btn, #stkc-tpl-btn, #stkws-btn, #stkc-more-btn', p: scoped('.stkc-pop, .stkc-ob-pop', '.stkc-menu'), min: 600 },
    { t: '#vela-bb-tz', p: function (t) { return byCtl(t); }, keep: '.vela-menu, .vela-popover', min: 600, esc: true },
    { t: '.vela-dtb-arrow', p: function () { return qs(document, '.vela-dtb-flyout'); }, open: function (t) { var c = t.closest('.vela-dtb-cell'); return !!(c && c.classList.contains('vela-open')); } },
    { t: '.mclock-pill', p: scoped('.mclock-pop') },
    { t: '.stkw-title, .stkw-ib[aria-haspopup="menu"]', p: function () { return [].filter.call(document.querySelectorAll('.stkw-menu:not(.stkw-ctx)'), vis)[0] || qs(document, '.stkw-menu:not(.stkw-ctx)'); } },
    { t: '.stk-sd-tplbtn', p: scoped('.stk-sd-menu') }
  ];

  var cur = null;          // { m, t, p, pinned, byHover }
  var tIn = 0, tOut = 0, down = false, last = { x: 0, y: 0 }, busy = false;

  function find(t) { for (var i = 0; i < MENUS.length; i++) { var h = t.closest(MENUS[i].t); if (h) return { m: MENUS[i], t: h }; } return null; }
  function isOpen(m, t, p) {
    if (m.open) return m.open(t);
    if (t.getAttribute('aria-expanded') === 'true') return true;
    return t.hasAttribute('aria-expanded') ? false : vis(p);
  }
  function ok(m) { return mq(FINE) && window.innerWidth >= (m.min || 0); }
  function clickT(t, m) {
    if (m && m.esc && t.getAttribute('aria-expanded') === 'true') { var c = byCtl(t); (c || t).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); return; }
    busy = true; try { if (t.tagName === 'SUMMARY') t.parentElement.open = !t.parentElement.open; else t.click(); } finally { busy = false; } }

  function exitThen(p, fn) {
    if (!p || mq('(prefers-reduced-motion: reduce)')) { fn(); return; }
    p.classList.add('mh-out');
    setTimeout(function () { p.classList.remove('mh-out'); fn(); }, EXIT_MS);
  }
  function closeCur() {
    var c = cur; clearTimeout(tOut); if (!c) return; cur = null;
    if (isOpen(c.m, c.t, c.p)) exitThen(c.p, function () { if (isOpen(c.m, c.t, c.p)) clickT(c.t, c.m); });
  }
  function inside(x, y, target) {
    if (!cur) return false;
    if (target && target.closest && (cur.t.contains(target) || (cur.p && cur.p.contains(target)) || (cur.m.keep && target.closest(cur.m.keep)))) return true;
    var a = cur.t.getBoundingClientRect(), b = cur.p ? cur.p.getBoundingClientRect() : a;
    // hover bridge: the box around trigger + panel, so a diagonal move never leaves it
    var L = Math.min(a.left, b.left) - 4, R = Math.max(a.right, b.right) + 4, T = Math.min(a.top, b.top) - 4, B = Math.max(a.bottom, b.bottom) + 4;
    return x >= L && x <= R && y >= T && y <= B;
  }

  document.addEventListener('pointerdown', function (e) { down = e.buttons !== 0 && e.pointerType === 'mouse'; clearTimeout(tIn); if (cur && inside(e.clientX, e.clientY, e.target)) cur.pinned = true; }, true);
  document.addEventListener('pointerup', function () { down = false; }, true);
  document.addEventListener('pointercancel', function () { down = false; }, true);
  document.addEventListener('focusin', function (e) { if (cur && cur.p && cur.p.contains(e.target) && Date.now() - cur.at > 300) cur.pinned = true; });   // 300 ms: ignore the focus our own open moved
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { clearTimeout(tIn); cur = null; } }, true);

  document.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    last.x = e.clientX; last.y = e.clientY;
    if (!cur || cur.pinned) return;
    if (inside(e.clientX, e.clientY, e.target)) clearTimeout(tOut);
    else if (!tOut) tOut = setTimeout(function () { tOut = 0; closeCur(); }, OUT_MS);
  }, true);

  document.addEventListener('pointerover', function (e) {
    if (e.pointerType !== 'mouse' || down || e.buttons) return;
    var f = e.target.closest && find(e.target);
    if (!f || !ok(f.m)) { clearTimeout(tIn); return; }
    var t = f.t, m = f.m;
    if (cur && cur.t === t) { if (isOpen(cur.m, t, cur.p)) { clearTimeout(tOut); tOut = 0; return; } cur = null; }
    clearTimeout(tIn);
    tIn = setTimeout(function () {
      if (down || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
      var p = m.p(t), o = isOpen(m, t, p);
      if (o) { cur = { m: m, t: t, p: p, pinned: true }; return; }   // already open by click: leave it alone
      if (cur) { var old = cur; cur = null; if (isOpen(old.m, old.t, old.p)) clickT(old.t, old.m); }
      clickT(t);
      p = m.p(t) || p;
      cur = { m: m, t: t, p: p, pinned: false, at: Date.now() }; tOut = 0;   // Vela menus set aria-expanded a tick later; closeCur re-checks
    }, IN_MS);
  }, true);

  // A click on a hover-opened trigger keeps it open (pins) instead of toggling it shut; a click that closes plays the exit.
  document.addEventListener('click', function (e) {
    if (busy || !e.isTrusted) return;
    var f = e.target.closest && find(e.target); if (!f) return;
    if (cur && cur.t === f.t && !cur.pinned) { cur.pinned = true; e.preventDefault(); e.stopImmediatePropagation(); return; }
    var p = f.m.p(f.t);
    if (ok(f.m) && isOpen(f.m, f.t, p) && p && !mq('(prefers-reduced-motion: reduce)')) {
      e.preventDefault(); e.stopImmediatePropagation(); cur = null;
      exitThen(p, function () { clickT(f.t, f.m); });
    }
  }, true);

  document.documentElement.addEventListener('mouseleave', function () { clearTimeout(tIn); });
  window.__mh = { MENUS: MENUS, state: function () { return cur; } };
})();
