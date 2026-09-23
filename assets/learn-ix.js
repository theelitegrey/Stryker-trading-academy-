/* learn-ix.js — small interactive figures for the public Learn articles.
   Purpose: step-through charts, variant toggles, a tiny quiz and a
   consistency-rule calculator inside tools/learn/<slug>.html bodies.
   Depends on: nothing (no Firebase, no other modules). Loaded with defer by
   tools/gen-learn.js only on articles whose body contains "lx-ix".
   Without JS every figure shows its complete, final state, so nothing is
   hidden from readers or crawlers; the controls only appear once this runs.
   Motion: the only animation is a CSS fade, disabled under
   prefers-reduced-motion in learn.css. */
(function () {
  'use strict';

  // Step-through: <figure class="lx-ix" data-ix="steps"> with [data-step] parts
  // inside the SVG and <li data-cap="n"> captions.
  function stepper(fig) {
    var parts = fig.querySelectorAll('[data-step]');
    var caps = fig.querySelectorAll('[data-cap]');
    var max = 0;
    parts.forEach(function (p) { max = Math.max(max, +p.getAttribute('data-step')); });
    if (!max) return;
    var cur = 1;
    var bar = document.createElement('div');
    bar.className = 'lx-ctrl';
    bar.innerHTML = '<button type="button" data-d="-1" aria-label="Previous step">← Back</button>' +
      '<span class="lx-ctrl-n" aria-live="polite"></span>' +
      '<button type="button" data-d="1" aria-label="Next step">Next →</button>';
    fig.insertBefore(bar, fig.querySelector('figcaption'));
    var n = bar.querySelector('.lx-ctrl-n');
    var back = bar.querySelector('[data-d="-1"]');
    var next = bar.querySelector('[data-d="1"]');
    function show() {
      parts.forEach(function (p) {
        var s = +p.getAttribute('data-step');
        p.classList.toggle('ix-off', s > cur);
        p.classList.toggle('ix-new', s === cur);
      });
      caps.forEach(function (c) { c.hidden = +c.getAttribute('data-cap') !== cur; });
      n.textContent = 'Step ' + cur + ' of ' + max;
      back.disabled = cur === 1;
      next.disabled = cur === max;
    }
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.disabled) return;
      cur = Math.min(max, Math.max(1, cur + +b.getAttribute('data-d')));
      show();
    });
    fig.classList.add('ix-on');
    show();
  }

  // Toggle: <figure class="lx-ix" data-ix="toggle" data-attr="mode"> with
  // <button data-val="x"> in .lx-seg, parts marked data-<attr>="x", and
  // <p data-for="x"> captions. The first button is the initial state.
  function toggle(fig) {
    var attr = fig.getAttribute('data-attr');
    var btns = fig.querySelectorAll('.lx-seg button');
    if (!attr || !btns.length) return;
    function set(val) {
      fig.querySelectorAll('[data-' + attr + ']').forEach(function (p) {
        p.classList.toggle('ix-off', p.getAttribute('data-' + attr) !== val);
      });
      fig.querySelectorAll('[data-for]').forEach(function (p) { p.hidden = p.getAttribute('data-for') !== val; });
      btns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-val') === val)); });
    }
    fig.querySelector('.lx-seg').hidden = false;
    btns.forEach(function (b) { b.addEventListener('click', function () { set(b.getAttribute('data-val')); }); });
    fig.classList.add('ix-on');
    set(btns[0].getAttribute('data-val'));
  }

  // Quiz: <div class="lx-quiz"> with <button data-ok="1|0"> and <p class="lx-quiz-a">.
  function quiz(q) {
    var a = q.querySelector('.lx-quiz-a');
    q.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        q.querySelectorAll('button').forEach(function (x) { x.classList.remove('ok', 'no'); x.setAttribute('aria-pressed', 'false'); });
        var ok = b.getAttribute('data-ok') === '1';
        b.classList.add(ok ? 'ok' : 'no');
        b.setAttribute('aria-pressed', 'true');
        a.hidden = false;
        a.firstElementChild.textContent = ok ? 'Correct. ' : 'Not quite. ';
      });
    });
    a.hidden = true;
  }

  // Consistency calculator: best day / total profit against a percentage cap.
  function calc(box) {
    var best = box.querySelector('[name="best"]');
    var total = box.querySelector('[name="total"]');
    var cap = box.querySelector('[name="cap"]');
    var out = box.querySelector('output');
    var money = function (v) { return '$' + Math.round(v).toLocaleString('en-US'); };
    function run() {
      var b = parseFloat(best.value), t = parseFloat(total.value), c = parseFloat(cap.value) / 100;
      if (!(b > 0) || !(c > 0) || !(c < 1) || isNaN(t)) { out.textContent = 'Enter a best day above $0, a total profit and a percentage between 1 and 99.'; return; }
      if (t <= 0) { out.textContent = 'No net profit yet, so the ratio cannot be met. Most firms need positive profit before this check can pass.'; return; }
      if (b > t) { out.textContent = 'Your best day (' + money(b) + ') is bigger than your whole net profit (' + money(t) + '), which happens after losing days. You need total profit of at least ' + money(b / c) + ', made on other days.'; return; }
      var r = b / t, need = b / c - t;
      out.textContent = 'Best day is ' + (r * 100).toFixed(1) + '% of total profit. ' +
        (r <= c ? 'That is within a ' + (c * 100) + '% rule.' :
          'That is above a ' + (c * 100) + '% rule: you need about ' + money(need) + ' more profit, made on other days, with no single day bigger than ' + money(b) + '.');
    }
    box.addEventListener('input', run);
    box.hidden = false;
    run();
  }

  function init() {
    document.querySelectorAll('.lx-ix[data-ix="steps"]').forEach(stepper);
    document.querySelectorAll('.lx-ix[data-ix="toggle"]').forEach(toggle);
    document.querySelectorAll('.lx-quiz').forEach(quiz);
    document.querySelectorAll('.lx-calc').forEach(calc);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
