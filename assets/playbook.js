// Stryker Trading Academy — Trade Journal: Playbook tab
// Depends on: playbook-data.js, playbook-analytics.js, journal-calc.js
// (currency formatting), and the JOURNAL_* globals from journal-main.js.
//
// The idea: the academy teaches six models with explicit rule steps, and the
// journal records what a student actually did. This tab joins them. A student
// adopts a taught model (or writes their own), ticks its rules when logging a
// trade, and the analytics answer the question that actually changes results —
// not "how am I doing" but "which rule am I skipping when I lose".
//
// Everything numeric comes from playbook-analytics.js, which refuses to
// produce a comparison from too few trades. This file's job is to render that
// refusal honestly rather than filling the gap with a confident-looking zero.

let PB_DATA = { playbooks: [] };
let PB_VIEW = 'library';        // 'library' | 'detail'
let PB_OPEN_ID = null;
let PB_MODELS_CACHE = null;

const PB = () => window.PlaybookAnalytics;

// ---- small helpers ---------------------------------------------------------

function pbEsc(s) {
  return (typeof stkEsc === 'function')
    ? stkEsc(s)
    : String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function pbMoney(n) {
  const cur = (JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD';
  if (typeof journalFormatCurrency === 'function') return journalFormatCurrency(n, cur);
  return (n < 0 ? '-' : '') + '$' + Math.abs(n || 0).toFixed(2);
}

function pbPct(n, digits) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return n.toFixed(digits === undefined ? 1 : digits) + '%';
}

function pbSigned(n) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return (n > 0 ? '+' : '') + n.toFixed(1);
}

function pbToneClass(n) {
  if (n === null || n === undefined || !isFinite(n) || n === 0) return '';
  return n > 0 ? ' pb-up' : ' pb-down';
}

function pbFind(id) {
  return (PB_DATA.playbooks || []).find((p) => p.id === id) || null;
}

function pbTradesFor(id) {
  return (JOURNAL_TRADES || []).filter((t) => t.playbookId === id);
}

function pbPersist() {
  return savePlaybooks(JOURNAL_UID, PB_DATA)
    .catch((err) => {
      console.error('Stryker: could not save playbooks', err);
      showToast('error', 'Could not save your playbook. Check your connection and try again.');
      throw err;
    });
}

// The sparkline behind a playbook card: cumulative P&L, nothing else. Scaled
// to its own range so a small playbook is still readable next to a big one.
function pbSparkline(curve, colour) {
  if (!curve || curve.length < 2) return '';
  const w = 120, h = 30;
  const min = Math.min(0, ...curve), max = Math.max(0, ...curve);
  const span = (max - min) || 1;
  const pts = curve.map((v, i) => {
    const x = (i / (curve.length - 1)) * w;
    const y = h - ((v - min) / span) * h;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  const zeroY = (h - ((0 - min) / span) * h).toFixed(1);
  return '<svg class="pb-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
    '<line x1="0" y1="' + zeroY + '" x2="' + w + '" y2="' + zeroY + '" class="pb-spark-zero"/>' +
    '<polyline points="' + pts + '" fill="none" stroke="' + pbEsc(colour) + '" stroke-width="1.6" ' +
      'stroke-linejoin="round" stroke-linecap="round"/>' +
    '</svg>';
}

// ---- library view ----------------------------------------------------------

function pbStatusChip(status) {
  const s = PB_STATUS[status] || PB_STATUS.testing;
  return '<span class="pb-chip" style="color:' + pbEsc(s.colour) + '; border-color:' + pbEsc(s.colour) + '55;">' +
    pbEsc(s.label) + '</span>';
}

function pbCardHtml(row) {
  const p = row.playbook;
  const s = row.stats;
  const dd = PB().drawdown(pbTradesFor(p.id));
  const adh = row.adherence;

  // On a compact card there is no room for a sentence; the detail page says
  // "No losses yet" in full where it fits.
  const pf = s.profitFactor === null ? '—' : s.profitFactor.toFixed(2);

  return '<button type="button" class="pb-card" data-pb-open="' + pbEsc(p.id) + '">' +
    '<span class="pb-card-bar" style="background:' + pbEsc(p.colour) + ';"></span>' +
    '<span class="pb-card-head">' +
      '<span class="pb-card-name">' + pbEsc(p.name || 'Untitled playbook') + '</span>' +
      pbStatusChip(p.status) +
    '</span>' +
    '<span class="pb-card-sub">' +
      (p.source === 'model' ? 'From the academy models' : 'Your own model') +
      (p.market ? ' · ' + pbEsc(p.market) : '') +
      (p.timeframe ? ' · ' + pbEsc(p.timeframe) : '') +
      ' · ' + (p.rules || []).length + ' rule' + ((p.rules || []).length === 1 ? '' : 's') +
    '</span>' +
    pbSparkline(dd.curve, p.colour) +
    '<span class="pb-card-stats">' +
      '<span class="pb-stat"><b class="' + (s.net >= 0 ? 'pb-up' : 'pb-down') + '">' + pbMoney(s.net) + '</b><i>Net P&amp;L</i></span>' +
      '<span class="pb-stat"><b>' + s.n + '</b><i>Trades</i></span>' +
      '<span class="pb-stat"><b>' + pbPct(s.winRate, 0) + '</b><i>Win rate</i></span>' +
      '<span class="pb-stat"><b>' + pf + '</b><i>Profit factor</i></span>' +
      '<span class="pb-stat"><b>' + (adh.pct === null ? '—' : pbPct(adh.pct, 0)) + '</b><i>Followed</i></span>' +
    '</span>' +
    (row.mature ? '' : '<span class="pb-card-young">Needs ' + Math.max(PB().MIN_SAMPLE - s.n, 0) +
       ' more trade' + (PB().MIN_SAMPLE - s.n === 1 ? '' : 's') + ' before the numbers mean anything</span>') +
  '</button>';
}

function renderPlaybookLibrary() {
  const wrap = document.getElementById('pb-body');
  const books = PB_DATA.playbooks || [];

  if (!books.length) {
    wrap.innerHTML =
      '<div class="pb-empty">' +
        '<h3>Turn what you were taught into something measurable</h3>' +
        '<p>A playbook is one strategy with its rules written down. Tick those rules as you log each trade and this tab will show you which of your models actually makes money, and which rule is costing you when you skip it.</p>' +
        '<div class="pb-empty-actions">' +
          '<button type="button" class="btn btn-primary" id="pb-adopt-btn">Start from an academy model</button>' +
          '<button type="button" class="btn btn-ghost" id="pb-new-btn">Write my own</button>' +
        '</div>' +
      '</div>';
    return;
  }

  const grouped = {};
  books.forEach((p) => { (grouped[p.id] = pbTradesFor(p.id)); });
  const cmp = PB().compare(books, grouped);

  const unfiled = (JOURNAL_TRADES || []).filter((t) => !t.playbookId && t.pnl !== null && t.pnl !== undefined);

  let html =
    '<div class="pb-toolbar">' +
      '<div class="pb-toolbar-actions">' +
        '<button type="button" class="btn btn-primary btn-sm" id="pb-adopt-btn">Add from a model</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="pb-new-btn">New playbook</button>' +
      '</div>' +
    '</div>';

  if (unfiled.length) {
    html += '<div class="pb-note">' +
      '<b>' + unfiled.length + ' logged trade' + (unfiled.length === 1 ? '' : 's') + ' not filed to a playbook.</b> ' +
      'Open a trade in History and pick its playbook to bring it into these numbers.' +
      '</div>';
  }

  if (cmp.ranked.length) {
    html += '<h4 class="pb-section-title">Ranked by expectancy per trade</h4>' +
      '<div class="pb-grid">' + cmp.ranked.map(pbCardHtml).join('') + '</div>';
  }
  if (cmp.gathering.length) {
    html += '<h4 class="pb-section-title">Still gathering data</h4>' +
      '<div class="pb-grid">' + cmp.gathering.map(pbCardHtml).join('') + '</div>';
  }

  wrap.innerHTML = html;
}

// ---- detail view -----------------------------------------------------------

function pbRuleRowHtml(r, colour) {
  let verdict;
  if (!r.enough) {
    verdict = '<span class="pb-rule-verdict pb-muted">Needs ' + r.need +
      ' more graded trade' + (r.need === 1 ? '' : 's') + ' on both sides</span>';
  } else {
    const wr = r.winRateDelta;
    const exp = r.expectancyDelta;
    verdict =
      '<span class="pb-rule-verdict">' +
        '<b class="' + (wr > 0 ? 'pb-up' : wr < 0 ? 'pb-down' : '') + '">' + pbSigned(wr) + '%</b> win rate, ' +
        '<b class="' + (exp > 0 ? 'pb-up' : exp < 0 ? 'pb-down' : '') + '">' +
          (exp > 0 ? '+' : '') + pbMoney(exp) + '</b> per trade when you follow it' +
      '</span>';
  }

  return '<li class="pb-rule-row">' +
    '<span class="pb-rule-dot" style="background:' + pbEsc(colour) + ';"></span>' +
    '<span class="pb-rule-main">' +
      '<span class="pb-rule-text">' + pbEsc(r.text) + '</span>' +
      verdict +
    '</span>' +
    '<span class="pb-rule-skip" title="How often this rule was skipped">' +
      (r.skipRate === null ? '—' : 'skipped ' + pbPct(r.skipRate, 0)) +
    '</span>' +
  '</li>';
}

function pbBucketRowsHtml(buckets, label) {
  const eligible = (buckets || []).filter((b) => b.n > 0)
    .sort((a, b) => b.expectancy - a.expectancy);
  if (!eligible.length) return '';
  const max = Math.max(...eligible.map((b) => Math.abs(b.expectancy))) || 1;
  return '<div class="pb-panel">' +
    '<h5>' + pbEsc(label) + '</h5>' +
    '<ul class="pb-bars">' + eligible.map((b) => {
      const w = (Math.abs(b.expectancy) / max) * 100;
      const thin = b.n < PB().MIN_SIDE;
      return '<li' + (thin ? ' class="pb-bar-thin"' : '') + '>' +
        '<span class="pb-bar-key">' + pbEsc(b.key) + '</span>' +
        '<span class="pb-bar-track"><span class="pb-bar-fill' + (b.expectancy >= 0 ? ' pb-up-bg' : ' pb-down-bg') +
          '" style="width:' + w.toFixed(1) + '%;"></span></span>' +
        '<span class="pb-bar-val">' + pbMoney(b.expectancy) + '<i>' + b.n + ' trade' + (b.n === 1 ? '' : 's') + '</i></span>' +
      '</li>';
    }).join('') + '</ul>' +
    '<p class="pb-panel-foot">Average result per trade. Rows with fewer than ' + PB().MIN_SIDE +
      ' trades are dimmed because they are not yet worth acting on.</p>' +
  '</div>';
}

function renderPlaybookDetail() {
  const wrap = document.getElementById('pb-body');
  const p = pbFind(PB_OPEN_ID);
  if (!p) { PB_VIEW = 'library'; renderPlaybookTab(); return; }

  const trades = pbTradesFor(p.id);
  const rep = PB().report(p, trades);
  const s = rep.stats;

  // The headline. This is the number the whole feature exists to produce, so
  // it either says something real or explains why it cannot yet.
  let headline;
  if (rep.discipline.enough) {
    const d = rep.discipline;
    headline =
      '<div class="pb-headline">' +
        '<div class="pb-headline-side">' +
          '<span class="pb-headline-label">When you followed every rule</span>' +
          '<span class="pb-headline-num pb-up">' + pbMoney(d.followed.expectancy) + '</span>' +
          '<span class="pb-headline-sub">per trade · ' + pbPct(d.followed.winRate, 0) + ' win rate · ' +
            d.followed.n + ' trades</span>' +
        '</div>' +
        '<div class="pb-headline-vs">vs</div>' +
        '<div class="pb-headline-side">' +
          '<span class="pb-headline-label">When you skipped one</span>' +
          '<span class="pb-headline-num ' + (d.broken.expectancy >= 0 ? '' : 'pb-down') + '">' +
            pbMoney(d.broken.expectancy) + '</span>' +
          '<span class="pb-headline-sub">per trade · ' + pbPct(d.broken.winRate, 0) + ' win rate · ' +
            d.broken.n + ' trades</span>' +
        '</div>' +
      '</div>';
  } else {
    headline =
      '<div class="pb-headline pb-headline-waiting">' +
        '<span class="pb-headline-label">Discipline comparison</span>' +
        '<p>Tick this playbook’s rules on ' + rep.discipline.need + ' more logged trade' +
          (rep.discipline.need === 1 ? '' : 's') +
          ' and this will show what following the plan is actually worth to you, in money per trade. ' +
          'It needs trades on both sides — some where you followed every rule, some where you did not.</p>' +
      '</div>';
  }

  const costly = rep.costliest
    ? '<div class="pb-callout pb-callout-warn">' +
        '<b>The rule that costs you most:</b> ' + pbEsc(rep.costliest.text) + '. ' +
        'Following it is worth ' + pbMoney(rep.costliest.expectancyDelta) + ' per trade, and you skip it ' +
        pbPct(rep.costliest.skipRate, 0) + ' of the time.' +
      '</div>'
    : '';

  const edge = [];
  if (rep.bestSession) edge.push('best in the <b>' + pbEsc(rep.bestSession.key) + '</b> session (' + pbMoney(rep.bestSession.expectancy) + ' per trade)');
  if (rep.bestWeekday) edge.push('strongest on <b>' + pbEsc(rep.bestWeekday.key) + '</b>');
  if (rep.bestHour) edge.push('best around <b>' + pbEsc(rep.bestHour.key) + ':00</b>');
  const edgeHtml = edge.length
    ? '<div class="pb-callout"><b>Where this works for you:</b> ' + edge.join(', ') + '.</div>'
    : '';

  const pf = s.profitFactor === null ? (s.n ? 'No losses yet' : '—') : s.profitFactor.toFixed(2);

  wrap.innerHTML =
    '<div class="pb-detail-head">' +
      '<button type="button" class="btn btn-ghost btn-sm" id="pb-back">&larr; All playbooks</button>' +
      '<div class="pb-detail-title">' +
        '<span class="pb-card-bar" style="background:' + pbEsc(p.colour) + ';"></span>' +
        '<h3>' + pbEsc(p.name || 'Untitled playbook') + '</h3>' +
        pbStatusChip(p.status) +
      '</div>' +
      '<div class="pb-detail-actions">' +
        (p.sourceModelId ? '<a class="btn btn-ghost btn-sm" href="model.html?id=' + encodeURIComponent(p.sourceModelId) + '">Read the lesson</a>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm" id="pb-edit">Edit rules</button>' +
      '</div>' +
    '</div>' +

    (p.notes ? '<p class="pb-notes">' + pbEsc(p.notes) + '</p>' : '') +

    '<div class="pb-kpis">' +
      '<div class="pb-kpi"><span class="' + (s.net >= 0 ? 'pb-up' : 'pb-down') + '">' + pbMoney(s.net) + '</span><i>Net P&amp;L</i></div>' +
      '<div class="pb-kpi"><span>' + s.n + '</span><i>Closed trades</i></div>' +
      '<div class="pb-kpi"><span>' + pbPct(s.winRate, 0) + '</span><i>Win rate</i></div>' +
      '<div class="pb-kpi"><span>' + pbMoney(s.expectancy) + '</span><i>Per trade</i></div>' +
      '<div class="pb-kpi"><span>' + pf + '</span><i>Profit factor</i></div>' +
      '<div class="pb-kpi"><span>' + (s.avgR === null ? '—' : s.avgR.toFixed(2) + 'R') + '</span><i>Average R</i></div>' +
      '<div class="pb-kpi"><span class="pb-down">' + pbMoney(rep.drawdown.maxDrawdown) + '</span><i>Max drawdown</i></div>' +
      '<div class="pb-kpi"><span>' + (rep.adherence.pct === null ? '—' : pbPct(rep.adherence.pct, 0)) + '</span><i>Rules followed</i></div>' +
    '</div>' +

    headline + costly + edgeHtml +

    '<div class="pb-panel">' +
      '<h5>Rules, and what each one is worth</h5>' +
      ((p.rules || []).length
        ? '<ul class="pb-rules">' + rep.rules.map((r) => pbRuleRowHtml(r, p.colour)).join('') + '</ul>'
        : '<p class="pb-muted">This playbook has no rules yet. Add them with <b>Edit rules</b> — they become the checklist you tick when logging a trade.</p>') +
      '<p class="pb-panel-foot">Each row compares the trades where you met that rule against the ones where you did not. ' +
        'A rule only gets a number once there are at least ' + PB().MIN_SIDE + ' trades on each side.</p>' +
    '</div>' +

    pbBucketRowsHtml(rep.breakdowns.bySession, 'By session') +
    pbBucketRowsHtml(rep.breakdowns.byWeekday, 'By day of week') +
    pbBucketRowsHtml(rep.breakdowns.byDirection, 'By direction');
}

function renderPlaybookTab() {
  if (!document.getElementById('pb-body')) return;
  if (PB_VIEW === 'detail') renderPlaybookDetail();
  else renderPlaybookLibrary();
}

// ---- editor ----------------------------------------------------------------

function pbRuleEditorRow(rule) {
  return '<li class="pb-edit-rule" data-rule-id="' + pbEsc(rule.id) + '">' +
    '<input type="text" class="journal-input pb-rule-input" value="' + pbEsc(rule.text) + '" placeholder="e.g. Wait for the sweep before entering">' +
    '<button type="button" class="pb-rule-del" data-pb-del-rule="' + pbEsc(rule.id) + '" aria-label="Remove rule">&times;</button>' +
  '</li>';
}

function openPlaybookEditor(id) {
  const isNew = !id;
  const p = isNew ? pbBlank((PB_DATA.playbooks || []).length) : Object.assign({}, pbFind(id));
  if (!p) return;
  p.rules = (p.rules || []).map((r) => Object.assign({}, r));

  const modal = document.getElementById('pb-modal');
  const body = document.getElementById('pb-modal-body');
  document.getElementById('pb-modal-title').textContent = isNew ? 'New playbook' : 'Edit playbook';

  body.innerHTML =
    '<div class="field"><label for="pb-f-name">Name</label>' +
      '<input type="text" id="pb-f-name" class="journal-input" value="' + pbEsc(p.name) + '" placeholder="e.g. London sweep reversal"></div>' +
    '<div class="form-row-2">' +
      '<div class="field"><label for="pb-f-market">Market</label>' +
        '<input type="text" id="pb-f-market" class="journal-input" value="' + pbEsc(p.market) + '" placeholder="NQ, EURUSD…"></div>' +
      '<div class="field"><label for="pb-f-tf">Timeframe</label>' +
        '<input type="text" id="pb-f-tf" class="journal-input" value="' + pbEsc(p.timeframe) + '" placeholder="5m, 15m…"></div>' +
    '</div>' +
    '<div class="form-row-2">' +
      '<div class="field"><label for="pb-f-status">Status</label>' +
        '<select id="pb-f-status" class="journal-select">' +
          Object.keys(PB_STATUS).map((k) =>
            '<option value="' + k + '"' + (p.status === k ? ' selected' : '') + '>' + pbEsc(PB_STATUS[k].label) + '</option>').join('') +
        '</select></div>' +
      '<div class="field"><label for="pb-f-dir">Direction</label>' +
        '<select id="pb-f-dir" class="journal-select">' +
          ['both', 'long', 'short'].map((d) =>
            '<option value="' + d + '"' + (p.direction === d ? ' selected' : '') + '>' +
            (d === 'both' ? 'Both ways' : d === 'long' ? 'Long only' : 'Short only') + '</option>').join('') +
        '</select></div>' +
    '</div>' +
    '<div class="field"><label for="pb-f-notes">Notes</label>' +
      '<textarea id="pb-f-notes" class="journal-input" rows="2" placeholder="What this setup is, in one line.">' + pbEsc(p.notes) + '</textarea></div>' +
    '<div class="field">' +
      '<label>Rules <span style="color:var(--ink-3); font-weight:400;">— these become the checklist you tick on every trade</span></label>' +
      '<ul class="pb-edit-rules" id="pb-edit-rules">' + p.rules.map(pbRuleEditorRow).join('') + '</ul>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="pb-add-rule">Add a rule</button>' +
    '</div>';

  modal.dataset.pbEditing = isNew ? '' : p.id;
  modal.dataset.pbNew = isNew ? '1' : '';
  modal._draft = p;
  modal.style.display = 'flex';

  body.querySelector('#pb-add-rule').addEventListener('click', () => {
    const rule = { id: pbNewId('r'), text: '', detail: '' };
    modal._draft.rules.push(rule);
    document.getElementById('pb-edit-rules').insertAdjacentHTML('beforeend', pbRuleEditorRow(rule));
    const rows = document.querySelectorAll('#pb-edit-rules .pb-rule-input');
    if (rows.length) rows[rows.length - 1].focus();
  });

  body.addEventListener('click', (e) => {
    const del = e.target.closest('[data-pb-del-rule]');
    if (!del) return;
    const rid = del.dataset.pbDelRule;
    modal._draft.rules = modal._draft.rules.filter((r) => r.id !== rid);
    const row = del.closest('.pb-edit-rule');
    if (row) row.remove();
  });
}

function closePlaybookEditor() {
  const modal = document.getElementById('pb-modal');
  modal.style.display = 'none';
  modal._draft = null;
}

function savePlaybookFromEditor() {
  const modal = document.getElementById('pb-modal');
  const draft = modal._draft;
  if (!draft) return;

  const name = document.getElementById('pb-f-name').value.trim();
  if (!name) { showToast('error', 'Give the playbook a name first.'); return; }

  draft.name = name;
  draft.market = document.getElementById('pb-f-market').value.trim();
  draft.timeframe = document.getElementById('pb-f-tf').value.trim();
  draft.status = document.getElementById('pb-f-status').value;
  draft.direction = document.getElementById('pb-f-dir').value;
  draft.notes = document.getElementById('pb-f-notes').value.trim();
  draft.updatedAt = Date.now();

  // Read the rule text back from the inputs, keeping each rule's id so trades
  // already graded against it stay attached to the right rule.
  const rows = Array.from(document.querySelectorAll('#pb-edit-rules .pb-edit-rule'));
  draft.rules = rows.map((row) => {
    const id = row.dataset.ruleId;
    const existing = (draft.rules || []).find((r) => r.id === id) || {};
    return {
      id: id,
      text: row.querySelector('.pb-rule-input').value.trim(),
      detail: existing.detail || ''
    };
  }).filter((r) => r.text);

  const isNew = modal.dataset.pbNew === '1';
  if (isNew) {
    PB_DATA.playbooks = (PB_DATA.playbooks || []).concat([draft]);
  } else {
    PB_DATA.playbooks = (PB_DATA.playbooks || []).map((p) => (p.id === draft.id ? draft : p));
  }

  pbPersist().then(() => {
    closePlaybookEditor();
    showToast('success', isNew ? 'Playbook created.' : 'Playbook saved.');
    if (typeof populateTradeFormDropdowns === 'function') populateTradeFormDropdowns();
    renderPlaybookTab();
  }).catch(() => {});
}

function deleteOpenPlaybook() {
  const p = pbFind(PB_OPEN_ID);
  if (!p) return;
  const used = pbTradesFor(p.id).length;
  const warning = used
    ? '\n\n' + used + ' logged trade' + (used === 1 ? '' : 's') + ' reference this playbook. They stay in your journal, but they will no longer be grouped here.'
    : '';
  if (!confirm('Delete "' + (p.name || 'this playbook') + '"?' + warning)) return;

  PB_DATA.playbooks = (PB_DATA.playbooks || []).filter((x) => x.id !== p.id);
  pbPersist().then(() => {
    PB_VIEW = 'library';
    PB_OPEN_ID = null;
    showToast('success', 'Playbook deleted.');
    if (typeof populateTradeFormDropdowns === 'function') populateTradeFormDropdowns();
    renderPlaybookTab();
  }).catch(() => {});
}

// ---- adopt a taught model --------------------------------------------------

function openAdoptPicker() {
  const modal = document.getElementById('pb-adopt-modal');
  const body = document.getElementById('pb-adopt-body');
  modal.style.display = 'flex';
  body.innerHTML = '<p class="pb-muted">Loading the academy models…</p>';

  const load = PB_MODELS_CACHE
    ? Promise.resolve(PB_MODELS_CACHE)
    : pbLoadAdoptableModels().then((m) => { PB_MODELS_CACHE = m; return m; });

  load.then((models) => {
    if (!models.length) {
      body.innerHTML = '<p class="pb-muted">The academy models could not be loaded right now. ' +
        'You can still write your own playbook from scratch.</p>';
      return;
    }
    const taken = new Set((PB_DATA.playbooks || []).map((p) => p.sourceModelId).filter(Boolean));
    body.innerHTML = '<ul class="pb-adopt-list">' + models.map((m) => {
      const already = taken.has(m.id);
      const steps = (m.steps || []).length;
      return '<li>' +
        '<div class="pb-adopt-main">' +
          '<b>' + pbEsc(m.name || 'Untitled model') + '</b>' +
          '<span>' + pbEsc(m.summary || '') + '</span>' +
          '<i>' + steps + ' rule' + (steps === 1 ? '' : 's') + ' will be copied into your checklist</i>' +
        '</div>' +
        '<button type="button" class="btn btn-sm ' + (already ? 'btn-ghost' : 'btn-primary') + '" ' +
          'data-pb-adopt="' + pbEsc(m.id) + '"' + (already ? ' disabled' : '') + '>' +
          (already ? 'Added' : 'Add') + '</button>' +
      '</li>';
    }).join('') + '</ul>';
  });
}

function adoptModel(modelId) {
  const model = (PB_MODELS_CACHE || []).find((m) => m.id === modelId);
  if (!model) return;
  const pb = pbFromModel(model, (PB_DATA.playbooks || []).length);
  PB_DATA.playbooks = (PB_DATA.playbooks || []).concat([pb]);
  pbPersist().then(() => {
    document.getElementById('pb-adopt-modal').style.display = 'none';
    showToast('success', pb.name + ' added to your playbooks.');
    if (typeof populateTradeFormDropdowns === 'function') populateTradeFormDropdowns();
    PB_VIEW = 'detail';
    PB_OPEN_ID = pb.id;
    renderPlaybookTab();
  }).catch(() => {});
}

// ---- wiring ----------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  const body = document.getElementById('pb-body');
  if (!body) return;

  body.addEventListener('click', (e) => {
    const open = e.target.closest('[data-pb-open]');
    if (open) { PB_VIEW = 'detail'; PB_OPEN_ID = open.dataset.pbOpen; renderPlaybookTab(); return; }
    if (e.target.closest('#pb-back')) { PB_VIEW = 'library'; PB_OPEN_ID = null; renderPlaybookTab(); return; }
    if (e.target.closest('#pb-edit')) { openPlaybookEditor(PB_OPEN_ID); return; }
    if (e.target.closest('#pb-adopt-btn')) { openAdoptPicker(); return; }
    if (e.target.closest('#pb-new-btn')) { openPlaybookEditor(null); return; }
  });

  const modal = document.getElementById('pb-modal');
  if (modal) {
    document.getElementById('pb-modal-save').addEventListener('click', savePlaybookFromEditor);
    document.getElementById('pb-modal-cancel').addEventListener('click', closePlaybookEditor);
    document.getElementById('pb-modal-cancel-2').addEventListener('click', closePlaybookEditor);
    document.getElementById('pb-modal-delete').addEventListener('click', () => {
      closePlaybookEditor();
      deleteOpenPlaybook();
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) closePlaybookEditor(); });
  }

  const adopt = document.getElementById('pb-adopt-modal');
  if (adopt) {
    adopt.addEventListener('click', (e) => {
      if (e.target === adopt || e.target.closest('#pb-adopt-close')) { adopt.style.display = 'none'; return; }
      const btn = e.target.closest('[data-pb-adopt]');
      if (btn && !btn.disabled) adoptModel(btn.dataset.pbAdopt);
    });
  }
});
