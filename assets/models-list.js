// Stryker Trading Academy — trading models listing (models.html)
//
// The page used to be a flat list of link rows. Each model now gets a card
// with its animated vignette (assets/models-showcase.js), the category, the
// write-up length, its first few steps as a preview, and a "resume where you
// left off" marker driven by the per-model step checklist saved on the model
// page. Categories filter the grid client-side; the "more models on the way"
// box closes the page out.

var MODELS_FILTER = 'all';

function modelStepsDone(id){
  try {
    var raw = localStorage.getItem('stryker_model_steps_' + id);
    if (!raw) return [];
    var arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

// Filter chips: 4 fixed groups (CoS decision, 26 Sep 2026). Each model names
// its group in the `group` field (assets/models-data.js). Live Firestore docs
// seeded before that field existed fall back to the bundled seed's value for
// the same id. The detailed `category` stays on the card as a sub-tag.
var MODEL_GROUPS = ['Opening & Session', 'Liquidity & Reversal', 'Imbalance / FVG', 'Mean Reversion'];

function modelGroup(m){
  if (m && typeof m.group === 'string' && m.group) return m.group;
  if (typeof MODELS_SEED !== 'undefined' && m) {
    for (var i = 0; i < MODELS_SEED.length; i++) {
      if (MODELS_SEED[i].id === m.id) return MODELS_SEED[i].group || '';
    }
  }
  return '';
}

function modelCardHtml(m){
  var steps = m.steps || [];
  var done = modelStepsDone(m.id).filter(function (v){ return v; }).length;
  var mins = (typeof modelReadMinutes === 'function') ? modelReadMinutes(m) : 0;
  var scene = (typeof modelSceneHtml === 'function') ? modelSceneHtml(m) : '';

  var preview = steps.slice(0, 3).map(function (s, i){
    return '<li><b>' + (i + 1) + '</b>' + escapeModelText(s.title || ('Step ' + (i + 1))) + '</li>';
  }).join('');
  var moreSteps = steps.length > 3 ? '<li class="mdl-more">+ ' + (steps.length - 3) + ' more</li>' : '';

  var progress = '';
  if (done > 0 && steps.length) {
    var pct = Math.round((done / steps.length) * 100);
    progress =
      '<div class="mdl-prog" title="' + done + ' of ' + steps.length + ' steps checked">' +
        '<span style="width:' + pct + '%"></span>' +
      '</div>' +
      '<span class="mdl-prog-txt">' + done + '/' + steps.length + ' steps checked</span>';
  }

  return '<a class="mdl-card" href="model.html?id=' + encodeURIComponent(m.id) + '">' +
    '<div class="mdl-demo">' + scene + '</div>' +
    '<div class="mdl-card-body">' +
      '<div class="mdl-card-top">' +
        '<h3>' + escapeModelText(m.name || 'Untitled model') + '</h3>' +
        (m.category ? '<span class="mdl-cat">' + escapeModelText(m.category) + '</span>' : '') +
      '</div>' +
      '<p class="mdl-sum">' + escapeModelText(m.summary || '') + '</p>' +
      (steps.length ? '<ul class="mdl-steps">' + preview + moreSteps + '</ul>' : '') +
      '<div class="mdl-foot">' +
        '<span>' + steps.length + ' step' + (steps.length === 1 ? '' : 's') + '</span>' +
        (mins ? '<span>· ' + mins + ' min read</span>' : '') +
        '<span class="mdl-go">Open playbook →</span>' +
      '</div>' +
      progress +
    '</div>' +
  '</a>';
}

function escapeModelText(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderModels(){
  const container = document.getElementById('models-render-target');
  if (!container || typeof MODELS === 'undefined') return;

  if (!MODELS.length) {
    container.innerHTML = (typeof modelsMoreBoxHtml === 'function') ? modelsMoreBoxHtml() :
      '<p style="color:var(--ink-3); font-size:13.5px;">No trading models have been published yet — check back soon.</p>';
    return;
  }

  var list = MODELS.slice().sort(function (a, b){ return (a.name || '').localeCompare(b.name || ''); });
  if (MODELS_FILTER !== 'all' && MODEL_GROUPS.indexOf(MODELS_FILTER) === -1) MODELS_FILTER = 'all';
  var shown = list.filter(function (m){ return MODELS_FILTER === 'all' || modelGroup(m) === MODELS_FILTER; });

  var chip = function (key, label, n){
    var on = MODELS_FILTER === key;
    return '<button type="button" class="mdl-chip' + (on ? ' on' : '') + '" aria-pressed="' + (on ? 'true' : 'false') +
      '" data-mfilter="' + escapeModelText(key) + '">' + escapeModelText(label) + ' <i aria-hidden="true">' + n + '</i>' +
      '<span class="sr-only"> (' + n + ' model' + (n === 1 ? '' : 's') + ')</span></button>';
  };
  var chips = chip('all', 'All', list.length) +
    MODEL_GROUPS.map(function (g){
      return chip(g, g, list.filter(function (m){ return modelGroup(m) === g; }).length);
    }).join('');

  container.innerHTML =
    '<div class="mdl-head">' +
      '<h2>The model library</h2>' +
      '<p>Each model is a complete playbook — the conditions it needs, the exact entry criteria, and a written walkthrough. Work through one at a time, tick off its steps as you learn them, and journal every trade against the model you actually used.</p>' +
    '</div>' +
    '<div class="mdl-chips" role="group" aria-label="Filter models by type">' + chips + '</div>' +
    '<div class="mdl-grid">' + shown.map(modelCardHtml).join('') + '</div>' +
    ((typeof modelsMoreBoxHtml === 'function') ? modelsMoreBoxHtml() : '');

  container.querySelectorAll('[data-mfilter]').forEach(function (btn){
    btn.addEventListener('click', function (){
      MODELS_FILTER = btn.dataset.mfilter;
      renderModels();
      // the chips are re-drawn; keep keyboard focus on the one just pressed
      var again = container.querySelector('[data-mfilter="' + (window.CSS && CSS.escape ? CSS.escape(MODELS_FILTER) : MODELS_FILTER) + '"]');
      if (again) again.focus();
    });
  });
}

function showGuestPaywall(show){
  const overlay = document.getElementById('guest-paywall-overlay');
  const content = document.getElementById('models-content-wrap');
  if (overlay) overlay.style.display = show ? 'flex' : 'none';
  if (content) content.classList.toggle('paywall-dimmed', show);
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('models-render-target');
  if (container) showLoadingAnimation(container, 'Loading trading models…');

  loadModels().then(() => renderModels());

  if (!auth) {
    showGuestPaywall(true);
    return;
  }

  auth.onAuthStateChanged((user) => {
    showGuestPaywall(!user);
  });
});
