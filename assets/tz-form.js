// TradeZoro — shared form behaviour for the .tz-* form system (assets/style.css)
//
// Owner 2026-10-26 "form controls sweep". The CSS gives every control one look;
// this file adds the few behaviours CSS cannot:
//   1. [data-tz-thousands] text inputs show money as 100,000. Focus keeps the
//      formatted text editable; blur re-formats; [data-min] clamps on blur.
//      Readers strip the commas (Number(v.replace(/[,\s$]/g, ''))).
//   2. [data-tz-stepper] number inputs get − / + buttons (one step each,
//      respecting min/max/step) and fire 'input' + 'change' like typing would.
//   3. Phone bottom sheets (.tz-modal-sheet > .tz-sheet): --tz-vvh tracks the
//      visual viewport so the on-screen keyboard never covers the sheet, and
//      the focused field is scrolled into view inside the sheet only (setting
//      the sheet's own scrollTop, never scrollIntoView, which would also drag
//      every scrollable ancestor).
//   4. Escape closes an open .tz-modal-sheet through its [data-close] button,
//      so the page's own close handler runs.
// Never changes ids, names or validation attributes. Depends on: nothing.
(function () {
  'use strict';
  function fmt(v) {
    var raw = String(v == null ? '' : v).replace(/[,\s$]/g, '');
    if (raw === '' || isNaN(Number(raw))) return String(v == null ? '' : v);
    var parts = raw.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  function onBlur(e) {
    var el = e.target; if (!el.matches || !el.matches('[data-tz-thousands]')) return;
    var n = Number(String(el.value).replace(/[,\s$]/g, ''));
    var min = el.getAttribute('data-min');
    if (el.value.trim() !== '' && isFinite(n) && min != null && n < Number(min)) n = Number(min);
    if (el.value.trim() !== '' && isFinite(n)) el.value = fmt(n);
  }
  function onInput(e) {
    var el = e.target; if (!el.matches || !el.matches('[data-tz-thousands]')) return;
    // keep only digits, one dot, and the commas the user sees; re-group live keeping the caret
    var before = el.value, caret = el.selectionStart || 0;
    var digitsLeft = before.slice(0, caret).replace(/[^\d.]/g, '').length;
    var clean = before.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
    var out = clean === '' ? '' : fmt(clean);
    if (out === before) return;
    el.value = out;
    var pos = 0, seen = 0; while (pos < out.length && seen < digitsLeft) { if (/[\d.]/.test(out[pos])) seen++; pos++; }
    try { el.setSelectionRange(pos, pos); } catch (err) {}
  }
  function initThousands(root) {
    (root || document).querySelectorAll('[data-tz-thousands]').forEach(function (el) { if (el.value) el.value = fmt(el.value); });
  }
  function initSteppers(root) {
    (root || document).querySelectorAll('input[data-tz-stepper]:not([data-tz-stepped])').forEach(function (el) {
      el.setAttribute('data-tz-stepped', '1');
      var wrap = document.createElement('span'); wrap.className = 'tz-stepper';
      el.parentNode.insertBefore(wrap, el);
      var dn = document.createElement('button'); dn.type = 'button'; dn.textContent = '−'; dn.setAttribute('aria-label', 'Decrease');
      var up = document.createElement('button'); up.type = 'button'; up.textContent = '+'; up.setAttribute('aria-label', 'Increase');
      wrap.appendChild(dn); wrap.appendChild(el); wrap.appendChild(up);
      function bump(dir) {
        try { if (dir > 0) el.stepUp(); else el.stepDown(); }
        catch (err) { var s = Number(el.step) || 1; el.value = String((Number(el.value) || 0) + dir * s); }
        el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      dn.addEventListener('click', function () { bump(-1); }); up.addEventListener('click', function () { bump(1); });
    });
  }
  // keyboard-safe bottom sheets
  var vv = window.visualViewport;
  function syncVv() { if (vv) document.documentElement.style.setProperty('--tz-vvh', Math.round(vv.height) + 'px'); }
  function revealFocused() {
    var el = document.activeElement; if (!el || !el.closest) return;
    var sheet = el.closest('.tz-modal-sheet > .tz-sheet'); if (!sheet) return;
    var sr = sheet.getBoundingClientRect(), er = el.getBoundingClientRect();
    var footer = sheet.querySelector('.tz-actions'); var fh = footer && getComputedStyle(footer).position === 'sticky' ? footer.offsetHeight : 0;
    var visBottom = Math.min(sr.bottom, vv ? vv.offsetTop + vv.height : innerHeight) - fh - 12;
    if (er.bottom > visBottom) sheet.scrollTop += er.bottom - visBottom;
    else if (er.top < sr.top + 12) sheet.scrollTop -= (sr.top + 12 - er.top);
  }
  if (vv) { vv.addEventListener('resize', function () { syncVv(); setTimeout(revealFocused, 60); }); syncVv(); }
  document.addEventListener('focusin', function () { setTimeout(revealFocused, 250); });
  document.addEventListener('blur', onBlur, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = Array.prototype.filter.call(document.querySelectorAll('.tz-modal-sheet'), function (m) { return !m.hidden; }).pop();
    var x = open && open.querySelector('[data-close]'); if (x) x.click();
  });
  function init(root) { initThousands(root); initSteppers(root); }
  window.tzForm = { init: init, format: fmt };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); }); else init();
})();
