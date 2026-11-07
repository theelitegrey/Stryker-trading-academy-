/* zscript-quiz.js — tiny quiz for the Zscript course pages. Buttons carry data-correct="1|0";
   a tap marks the answer and reveals the explanation. No network, no storage. */
(function () {
  'use strict';
  document.querySelectorAll('.lx-quiz').forEach(function (q) {
    var btns = q.querySelectorAll('button[data-correct]'), a = q.querySelector('.lx-quiz-a');
    if (a) a.hidden = true;
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (x) { x.disabled = true; x.classList.toggle('is-right', x.getAttribute('data-correct') === '1'); });
        if (b.getAttribute('data-correct') !== '1') b.classList.add('is-wrong');
        if (a) a.hidden = false;
      });
    });
  });
})();
