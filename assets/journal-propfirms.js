// Stryker Trading Academy — Trade Journal: Prop firm tracker
// Depends on: assets/progress.js (`db`), assets/journal-calc.js (currency
// formatting), Chart.js, and the JOURNAL_* globals from journal-main.js.
//
// Storage: students/{uid}/journal/_propfirms — one reserved document in the
// existing journal subcollection, same trick as _settings, so the existing
// security rule covers it and no new Firestore rules are needed. A single
// document comfortably holds years of fee/payout entries (they're tiny), and
// one doc means one read on page load.
//
// Shape:
//   { firms: [{ id, name, status, accountSize, expenses:[{id,label,amount,date}],
//               payouts:[{id,amount,date,note}] }], updatedAt }

const JOURNAL_PROPFIRMS_DOC_ID = '_propfirms';

let PF_DATA = { firms: [] };
let PF_CHART = null;
let PF_OPEN_FORMS = {};      // firmId -> 'expense' | 'payout' | null

const PF_STATUS = {
  evaluation: { label: 'Evaluation', colour: '#f5c542' },
  funded:     { label: 'Funded',     colour: '#03c988' },
  failed:     { label: 'Failed',     colour: '#e5484d' },
  archived:   { label: 'Archived',   colour: '#5c6472' }
};

const PF_KNOWN_FIRMS = ['FTMO', 'Topstep', 'Apex Trader Funding', 'FundedNext',
  'The5ers', 'FundingPips', 'E8 Markets', 'Alpha Capital', 'MyFundedFutures'];

const PF_EXPENSE_LABELS = ['Challenge fee', 'Reset fee', 'Activation fee', 'Data fee', 'Other'];

// ---- data -------------------------------------------------------------------
function loadPropFirms(uid){
  return journalCollectionRef(uid).doc(JOURNAL_PROPFIRMS_DOC_ID).get()
    .then((doc) => (doc.exists ? (doc.data() || {}) : {}))
    .then((d) => ({ firms: Array.isArray(d.firms) ? d.firms : [] }))
    .catch((err) => {
      console.error('Stryker: failed to load prop firms', err);
      return { firms: [] };
    });
}

function savePropFirms(uid){
  return journalCollectionRef(uid).doc(JOURNAL_PROPFIRMS_DOC_ID).set({
    firms: PF_DATA.firms,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }).catch((err) => {
    console.error('Stryker: failed to save prop firms', err);
    if (typeof showToast === 'function') showToast('error', 'Could not save — check your connection.');
  });
}

function pfId(){ return 'pf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function pfFirmTotals(firm){
  const spent = (firm.expenses || []).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const received = (firm.payouts || []).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  return { spent, received, net: received - spent,
           roi: spent > 0 ? ((received - spent) / spent) * 100 : null };
}

// ---- animated numbers -------------------------------------------------------
// Counts a stat up from 0 (or its previous value) to the target. Instant
// under prefers-reduced-motion.
function jCountUp(el, target, format){
  if (!el) return;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !isFinite(target)) { el.textContent = format(target); return; }
  const from = parseFloat(el.dataset.countVal || '0') || 0;
  el.dataset.countVal = String(target);
  const t0 = performance.now(), dur = 650;
  function tick(now){
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = format(from + (target - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ---- render -----------------------------------------------------------------
function renderPropFirmsTab(){
  const currency = (JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD';
  const fmt = (v) => journalFormatCurrency(v, currency);

  let spent = 0, received = 0, funded = 0;
  PF_DATA.firms.forEach((f) => {
    const t = pfFirmTotals(f);
    spent += t.spent; received += t.received;
    if (f.status === 'funded') funded++;
  });
  const net = received - spent;

  jCountUp(document.getElementById('pf-stat-spent'), spent, (v) => fmt(v));
  jCountUp(document.getElementById('pf-stat-received'), received, (v) => fmt(v));
  const netEl = document.getElementById('pf-stat-net');
  jCountUp(netEl, net, (v) => (v > 0 ? '+' : '') + fmt(v));
  if (netEl) netEl.style.color = net > 0 ? '#03c988' : (net < 0 ? '#e5484d' : '#eeeeee');
  const countEl = document.getElementById('pf-stat-firms');
  if (countEl) countEl.textContent = PF_DATA.firms.length + (funded ? ' · ' + funded + ' funded' : '');

  renderPfCashflowChart();
  renderPfFirmCards(fmt);
}

// Monthly net cash flow (payouts − fees) as polarity bars, with the running
// net as a single line — both in account currency, one axis.
function renderPfCashflowChart(){
  const canvas = document.getElementById('pf-cashflow-chart');
  const wrap = document.getElementById('pf-chart-panel');
  if (!canvas || typeof Chart === 'undefined') return;

  const monthly = {};
  PF_DATA.firms.forEach((f) => {
    (f.expenses || []).forEach((e) => {
      const m = (e.date || '').slice(0, 7);
      if (m) monthly[m] = (monthly[m] || 0) - (parseFloat(e.amount) || 0);
    });
    (f.payouts || []).forEach((p) => {
      const m = (p.date || '').slice(0, 7);
      if (m) monthly[m] = (monthly[m] || 0) + (parseFloat(p.amount) || 0);
    });
  });
  const months = Object.keys(monthly).sort();
  if (wrap) wrap.style.display = months.length ? '' : 'none';
  if (PF_CHART) { PF_CHART.destroy(); PF_CHART = null; }
  if (!months.length) return;

  let running = 0;
  const cumulative = months.map((m) => { running += monthly[m]; return +running.toFixed(2); });
  const flows = months.map((m) => +monthly[m].toFixed(2));

  PF_CHART = new Chart(canvas.getContext('2d'), {
    data: {
      labels: months,
      datasets: [
        { type: 'bar', label: 'Monthly net', data: flows,
          backgroundColor: flows.map((v) => v >= 0 ? 'rgba(3,201,136,0.75)' : 'rgba(229,72,77,0.75)'),
          borderRadius: 4, maxBarThickness: 26, borderSkipped: false },
        { type: 'line', label: 'Running net', data: cumulative,
          borderColor: JCOLOR.gold, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
          tension: 0.25, fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { boxWidth: 10, boxHeight: 10, color: JCOLOR.ink2 } },
        tooltip: { callbacks: { label: (ctx) =>
          ctx.dataset.label + ': ' + journalFormatCurrency(ctx.parsed.y, (JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD') } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: JCOLOR.ink3, maxRotation: 0 } },
        y: { grid: { color: 'rgba(62,69,80,0.35)' }, ticks: { color: JCOLOR.ink3 } }
      }
    }
  });
}

function pfEsc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPfFirmCards(fmt){
  const host = document.getElementById('pf-firms');
  if (!host) return;

  if (!PF_DATA.firms.length) {
    host.innerHTML =
      '<div class="pf-empty">' +
        '<h3>Track every dollar you give a prop firm — and every dollar it gives back.</h3>' +
        '<p>Add a firm, log the challenge fees and resets you pay, log the payouts you receive, ' +
        'and this tab keeps a running scorecard of which firms are actually worth your money.</p>' +
      '</div>';
    return;
  }

  const maxAbs = Math.max(1, ...PF_DATA.firms.map((f) => {
    const t = pfFirmTotals(f);
    return Math.max(t.spent, t.received);
  }));

  host.innerHTML = PF_DATA.firms.map((firm) => {
    const t = pfFirmTotals(firm);
    const st = PF_STATUS[firm.status] || PF_STATUS.evaluation;
    const spentPct = Math.round((t.spent / maxAbs) * 100);
    const recvPct = Math.round((t.received / maxAbs) * 100);
    const openForm = PF_OPEN_FORMS[firm.id] || null;

    const entryRows = []
      .concat((firm.expenses || []).map((e) => ({ kind: 'expense', ...e })))
      .concat((firm.payouts || []).map((p) => ({ kind: 'payout', label: p.note || 'Payout', ...p })))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    return '<div class="pf-card" data-firm="' + firm.id + '">' +
      '<div class="pf-card-head">' +
        '<div class="pf-card-title">' +
          '<b>' + pfEsc(firm.name) + '</b>' +
          (firm.accountSize ? '<span class="pf-acct">' + fmt(firm.accountSize) + ' account</span>' : '') +
        '</div>' +
        '<select class="pf-status-select" data-act="status" style="color:' + st.colour + '; border-color:' + st.colour + '55;">' +
          Object.keys(PF_STATUS).map((k) =>
            '<option value="' + k + '"' + (firm.status === k ? ' selected' : '') + '>' + PF_STATUS[k].label + '</option>'
          ).join('') +
        '</select>' +
      '</div>' +

      '<div class="pf-bars">' +
        '<div class="pf-bar-row"><span class="pf-bar-label">Spent</span>' +
          '<div class="pf-bar"><i class="is-loss" style="width:' + Math.max(2, spentPct) + '%"></i></div>' +
          '<span class="pf-bar-val">' + fmt(t.spent) + '</span></div>' +
        '<div class="pf-bar-row"><span class="pf-bar-label">Payouts</span>' +
          '<div class="pf-bar"><i class="is-win" style="width:' + Math.max(2, recvPct) + '%"></i></div>' +
          '<span class="pf-bar-val">' + fmt(t.received) + '</span></div>' +
      '</div>' +

      '<div class="pf-net-row">' +
        '<span class="pf-net ' + (t.net > 0 ? 'gm-up' : (t.net < 0 ? 'gm-down' : '')) + '">' +
          (t.net > 0 ? '+' : '') + fmt(t.net) + ' net</span>' +
        (t.roi !== null ? '<span class="pf-roi">' + (t.roi > 0 ? '+' : '') + Math.round(t.roi) + '% return on fees</span>' : '') +
      '</div>' +

      (entryRows.length ?
        '<details class="pf-entries"><summary>' + entryRows.length + ' entr' + (entryRows.length === 1 ? 'y' : 'ies') + '</summary>' +
        entryRows.map((r) =>
          '<div class="pf-entry">' +
            '<i class="' + (r.kind === 'payout' ? 'is-win' : 'is-loss') + '"></i>' +
            '<span class="pf-entry-label">' + pfEsc(r.label || (r.kind === 'payout' ? 'Payout' : 'Fee')) + '</span>' +
            '<span class="pf-entry-date">' + pfEsc(r.date || '') + '</span>' +
            '<span class="pf-entry-amt ' + (r.kind === 'payout' ? 'gm-up' : 'gm-down') + '">' +
              (r.kind === 'payout' ? '+' : '−') + fmt(parseFloat(r.amount) || 0) + '</span>' +
            '<button type="button" class="pf-entry-del" data-act="del-entry" data-kind="' + r.kind + '" data-id="' + r.id + '" title="Delete entry">×</button>' +
          '</div>'
        ).join('') + '</details>' : '') +

      '<div class="pf-card-actions">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="open-expense">+ Fee</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="open-payout">+ Payout</button>' +
        '<button type="button" class="pf-delete-firm" data-act="del-firm" title="Delete firm">Remove</button>' +
      '</div>' +

      (openForm ?
        '<div class="pf-inline-form">' +
          (openForm === 'expense'
            ? '<select class="journal-select pf-f-label">' +
                PF_EXPENSE_LABELS.map((l) => '<option>' + l + '</option>').join('') + '</select>'
            : '<input type="text" class="pf-f-note" placeholder="Note (optional)">') +
          '<input type="number" step="any" min="0" class="pf-f-amount" placeholder="Amount">' +
          '<input type="date" class="pf-f-date">' +
          '<button type="button" class="btn btn-primary btn-sm" data-act="save-entry" data-kind="' + openForm + '">Save</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="close-form">Cancel</button>' +
        '</div>' : '') +
    '</div>';
  }).join('');

  host.classList.remove('gm-anim'); void host.offsetWidth; host.classList.add('gm-anim');

  // default the inline-form date to today
  host.querySelectorAll('.pf-f-date').forEach((inp) => {
    if (!inp.value) inp.value = new Date().toISOString().slice(0, 10);
  });
}

// ---- interactions -----------------------------------------------------------
function pfFindFirm(id){ return PF_DATA.firms.find((f) => f.id === id) || null; }

function pfHandleClick(e){
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const card = e.target.closest('.pf-card');
  const firm = card ? pfFindFirm(card.dataset.firm) : null;
  const act = btn.dataset.act;

  if (act === 'open-expense' || act === 'open-payout') {
    PF_OPEN_FORMS = {};
    PF_OPEN_FORMS[firm.id] = act === 'open-expense' ? 'expense' : 'payout';
    renderPropFirmsTab();
  } else if (act === 'close-form') {
    PF_OPEN_FORMS = {};
    renderPropFirmsTab();
  } else if (act === 'save-entry') {
    const amount = parseFloat(card.querySelector('.pf-f-amount').value);
    const date = card.querySelector('.pf-f-date').value;
    if (!firm || isNaN(amount) || amount <= 0) {
      if (typeof showToast === 'function') showToast('error', 'Enter an amount above zero.');
      return;
    }
    if (btn.dataset.kind === 'expense') {
      const label = card.querySelector('.pf-f-label').value || 'Fee';
      (firm.expenses = firm.expenses || []).push({ id: pfId(), label, amount, date });
    } else {
      const note = (card.querySelector('.pf-f-note').value || '').slice(0, 60);
      (firm.payouts = firm.payouts || []).push({ id: pfId(), amount, date, note });
    }
    PF_OPEN_FORMS = {};
    savePropFirms(JOURNAL_UID);
    renderPropFirmsTab();
    if (typeof showToast === 'function') showToast('success', btn.dataset.kind === 'expense' ? 'Fee logged.' : 'Payout logged. Nice.');
  } else if (act === 'del-entry') {
    if (!firm) return;
    const list = btn.dataset.kind === 'expense' ? firm.expenses : firm.payouts;
    const i = (list || []).findIndex((x) => x.id === btn.dataset.id);
    if (i !== -1) { list.splice(i, 1); savePropFirms(JOURNAL_UID); renderPropFirmsTab(); }
  } else if (act === 'del-firm') {
    if (!firm) return;
    if (!confirm('Remove ' + firm.name + ' and all its logged fees and payouts?')) return;
    PF_DATA.firms = PF_DATA.firms.filter((f) => f.id !== firm.id);
    savePropFirms(JOURNAL_UID);
    renderPropFirmsTab();
  }
}

function pfHandleChange(e){
  const sel = e.target.closest('.pf-status-select');
  if (!sel) return;
  const card = e.target.closest('.pf-card');
  const firm = card ? pfFindFirm(card.dataset.firm) : null;
  if (!firm) return;
  firm.status = sel.value;
  savePropFirms(JOURNAL_UID);
  renderPropFirmsTab();
}

function pfAddFirm(){
  const nameInput = document.getElementById('pf-new-name');
  const sizeInput = document.getElementById('pf-new-size');
  const name = (nameInput.value || '').trim().slice(0, 40);
  if (!name) {
    if (typeof showToast === 'function') showToast('error', 'Give the firm a name.');
    return;
  }
  const size = parseFloat(sizeInput.value);
  PF_DATA.firms.unshift({
    id: pfId(), name, status: 'evaluation',
    accountSize: isNaN(size) ? null : size,
    expenses: [], payouts: []
  });
  nameInput.value = ''; sizeInput.value = '';
  savePropFirms(JOURNAL_UID);
  renderPropFirmsTab();
}

document.addEventListener('DOMContentLoaded', () => {
  const tab = document.getElementById('tab-propfirms');
  if (!tab) return;
  tab.addEventListener('click', pfHandleClick);
  tab.addEventListener('change', pfHandleChange);

  const addBtn = document.getElementById('pf-add-btn');
  if (addBtn) addBtn.addEventListener('click', pfAddFirm);

  // quick-pick chips fill the name field
  const chips = document.getElementById('pf-known-chips');
  if (chips) {
    chips.innerHTML = PF_KNOWN_FIRMS.map((n) =>
      '<button type="button" class="term-cat" data-name="' + pfEsc(n) + '">' + pfEsc(n) + '</button>').join('');
    chips.addEventListener('click', (e) => {
      const b = e.target.closest('.term-cat');
      if (b) document.getElementById('pf-new-name').value = b.dataset.name;
    });
  }
});
