// Stryker Trading Academy — Trade Journal: Add/Edit Trade form + Settings tab
// Depends on: assets/journal-calc.js, assets/journal-data.js, assets/avatars.js
// (reuses resizeAvatarToDataUrl for the screenshot upload — it's a generic
// image-resize helper despite the name), and the global JOURNAL_UID /
// JOURNAL_SETTINGS / JOURNAL_TRADES state from assets/journal-main.js

let JOURNAL_EDIT_ID = null;
let JOURNAL_SELECTED_TAGS = [];
let JOURNAL_SCREENSHOT_DATA_URL = null;

const JF_FIELD_IDS = ['jf-instrument', 'jf-direction', 'jf-date', 'jf-time', 'jf-entry', 'jf-exit', 'jf-size', 'jf-fees', 'jf-stop', 'jf-target', 'jf-session', 'jf-setup', 'jf-notes'];

function populateTradeFormDropdowns(){
  const s = JOURNAL_SETTINGS || journalDefaultSettings();
  const instSel = document.getElementById('jf-instrument');
  const sessionSel = document.getElementById('jf-session');
  const setupSel = document.getElementById('jf-setup');
  const prevInst = instSel.value, prevSession = sessionSel.value, prevSetup = setupSel.value;

  instSel.innerHTML = s.instruments.map((i) => '<option value="' + escapeJournalHtml(i) + '">' + escapeJournalHtml(i) + '</option>').join('');
  sessionSel.innerHTML = s.sessions.map((x) => '<option value="' + escapeJournalHtml(x) + '">' + escapeJournalHtml(x) + '</option>').join('');
  setupSel.innerHTML = s.setups.map((x) => '<option value="' + escapeJournalHtml(x) + '">' + escapeJournalHtml(x) + '</option>').join('');

  // Trading account: Personal plus every firm on the Prop firms tab, so a
  // trade can be attributed to the account it was actually taken on.
  const acctSel = document.getElementById('jf-account');
  if (acctSel) {
    const prevAcct = acctSel.value;
    const firms = (typeof PF_DATA !== 'undefined' && PF_DATA.firms) ? PF_DATA.firms.map((f) => f.name) : [];
    acctSel.innerHTML = '<option value="">Personal</option>' +
      firms.map((n) => '<option value="' + escapeJournalHtml(n) + '">' + escapeJournalHtml(n) + '</option>').join('');
    if (prevAcct) acctSel.value = prevAcct;
  }

  // Re-selecting a value that no longer exists in the list is a silent no-op
  // in the DOM (falls back to the first option) — that's fine here since it
  // only happens if the option was actually removed in Settings.
  if (prevInst) instSel.value = prevInst;
  if (prevSession) sessionSel.value = prevSession;
  if (prevSetup) setupSel.value = prevSetup;

  const tagsWrap = document.getElementById('jf-tags-wrap');
  tagsWrap.innerHTML = '';
  s.tags.forEach((tag) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'journal-tag-chip' + (JOURNAL_SELECTED_TAGS.includes(tag) ? ' active' : '');
    chip.textContent = tag;
    chip.addEventListener('click', () => {
      const idx = JOURNAL_SELECTED_TAGS.indexOf(tag);
      if (idx === -1) { JOURNAL_SELECTED_TAGS.push(tag); chip.classList.add('active'); }
      else { JOURNAL_SELECTED_TAGS.splice(idx, 1); chip.classList.remove('active'); }
    });
    tagsWrap.appendChild(chip);
  });
}

function resetTradeForm(){
  JOURNAL_EDIT_ID = null;
  JOURNAL_SELECTED_TAGS = [];
  JOURNAL_SCREENSHOT_DATA_URL = null;
  document.getElementById('journal-form-heading').textContent = 'New trade';
  document.getElementById('jf-cancel-edit-btn').style.display = 'none';
  document.getElementById('jf-date').value = new Date().toISOString().slice(0, 10);
  ['jf-time', 'jf-entry', 'jf-exit', 'jf-size', 'jf-fees', 'jf-stop', 'jf-target', 'jf-notes'].forEach((id) => { document.getElementById(id).value = ''; });
  document.getElementById('jf-direction').value = 'long';
  document.getElementById('jf-screenshot-preview').style.display = 'none';
  document.getElementById('jf-screenshot-status').textContent = '';
  populateTradeFormDropdowns();
  updateLiveCalc();
}

function readTradeForm(){
  return {
    instrument: document.getElementById('jf-instrument').value,
    direction: document.getElementById('jf-direction').value,
    date: document.getElementById('jf-date').value,
    time: document.getElementById('jf-time').value || null,
    entryPrice: document.getElementById('jf-entry').value,
    exitPrice: document.getElementById('jf-exit').value,
    positionSize: document.getElementById('jf-size').value,
    fees: document.getElementById('jf-fees').value || 0,
    stopLoss: document.getElementById('jf-stop').value || null,
    takeProfit: document.getElementById('jf-target').value || null,
    session: document.getElementById('jf-session').value,
    setup: document.getElementById('jf-setup').value,
    account: (document.getElementById('jf-account') || {}).value || '',
    tags: JOURNAL_SELECTED_TAGS.slice(),
    notes: document.getElementById('jf-notes').value.trim(),
    screenshotDataUrl: JOURNAL_SCREENSHOT_DATA_URL
  };
}

function updateLiveCalc(){
  const raw = readTradeForm();
  const balance = (JOURNAL_SETTINGS && JOURNAL_SETTINGS.accountBalance) || 10000;
  const currency = (JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD';
  const derived = journalComputeDerived(raw, balance);

  const pnlEl = document.getElementById('jf-calc-pnl');
  pnlEl.textContent = journalFormatCurrency(derived.pnl, currency);
  pnlEl.style.color = derived.pnl > 0 ? '#03c988' : (derived.pnl < 0 ? '#e5484d' : '');

  document.getElementById('jf-calc-risk').textContent =
    derived.riskAmount !== null ? journalFormatCurrency(derived.riskAmount, currency) + (derived.riskPercent !== null ? ' (' + derived.riskPercent.toFixed(2) + '%)' : '') : '—';

  document.getElementById('jf-calc-r').textContent = derived.rMultiple !== null ? derived.rMultiple.toFixed(2) + 'R' : '—';
}

function startEditTrade(tradeId){
  const trade = (JOURNAL_TRADES || []).find((t) => t.id === tradeId);
  if (!trade) return;
  JOURNAL_EDIT_ID = tradeId;
  JOURNAL_SELECTED_TAGS = (trade.tags || []).slice();
  JOURNAL_SCREENSHOT_DATA_URL = trade.screenshotDataUrl || null;

  document.getElementById('journal-form-heading').textContent = 'Edit trade';
  document.getElementById('jf-cancel-edit-btn').style.display = 'inline-flex';
  populateTradeFormDropdowns();

  document.getElementById('jf-instrument').value = trade.instrument || '';
  document.getElementById('jf-direction').value = trade.direction || 'long';
  document.getElementById('jf-date').value = trade.date || '';
  document.getElementById('jf-time').value = trade.time || '';
  document.getElementById('jf-entry').value = trade.entryPrice !== undefined ? trade.entryPrice : '';
  document.getElementById('jf-exit').value = trade.exitPrice !== undefined ? trade.exitPrice : '';
  document.getElementById('jf-size').value = trade.positionSize !== undefined ? trade.positionSize : '';
  document.getElementById('jf-fees').value = trade.fees !== undefined ? trade.fees : '';
  document.getElementById('jf-stop').value = trade.stopLoss !== undefined && trade.stopLoss !== null ? trade.stopLoss : '';
  document.getElementById('jf-target').value = trade.takeProfit !== undefined && trade.takeProfit !== null ? trade.takeProfit : '';
  document.getElementById('jf-session').value = trade.session || '';
  document.getElementById('jf-setup').value = trade.setup || '';
  const editAcct = document.getElementById('jf-account');
  if (editAcct) editAcct.value = trade.account || '';
  document.getElementById('jf-notes').value = trade.notes || '';

  const preview = document.getElementById('jf-screenshot-preview');
  if (trade.screenshotDataUrl) { preview.src = trade.screenshotDataUrl; preview.style.display = 'block'; }
  else { preview.style.display = 'none'; }

  switchJournalTab('add');
  updateLiveCalc();
}

function saveTradeFromForm(){
  const errEl = document.getElementById('journal-form-error');
  const okEl = document.getElementById('journal-form-success');
  errEl.style.display = 'none'; okEl.style.display = 'none';

  const raw = readTradeForm();
  if (!raw.instrument || !raw.date || raw.entryPrice === '' || raw.exitPrice === '' || raw.positionSize === '') {
    errEl.textContent = 'Instrument, date, entry, exit, and position size are required.';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('jf-save-btn');
  btn.disabled = true;
  const balance = (JOURNAL_SETTINGS && JOURNAL_SETTINGS.accountBalance) || 10000;

  saveTrade(JOURNAL_UID, raw, balance, JOURNAL_EDIT_ID)
    .then(() => {
      okEl.textContent = JOURNAL_EDIT_ID ? 'Trade updated.' : 'Trade saved.';
      okEl.style.display = 'block';
      if (typeof showToast === 'function') showToast('success', JOURNAL_EDIT_ID ? 'Trade updated.' : 'Trade saved.');
      resetTradeForm();
      return reloadJournalData();
    })
    .catch((err) => {
      errEl.textContent = err.message || 'Could not save trade.';
      errEl.style.display = 'block';
    })
    .finally(() => { btn.disabled = false; });
}

// ---- Settings tab ----
let JOURNAL_SETTINGS_DRAFT = null;

function renderSettingsTab(){
  JOURNAL_SETTINGS_DRAFT = JSON.parse(JSON.stringify(JOURNAL_SETTINGS || journalDefaultSettings()));
  document.getElementById('js-balance').value = JOURNAL_SETTINGS_DRAFT.accountBalance;
  document.getElementById('js-risk').value = JOURNAL_SETTINGS_DRAFT.defaultRiskPercent;
  document.getElementById('js-currency').value = JOURNAL_SETTINGS_DRAFT.currency;

  renderTagEditorList('js-instruments-list', 'instruments', 'New instrument');
  renderTagEditorList('js-setups-list', 'setups', 'New setup');
  renderTagEditorList('js-sessions-list', 'sessions', 'New session');
  renderTagEditorList('js-tags-list', 'tags', 'New tag');
}

function renderTagEditorList(elId, settingsKey, placeholder){
  const wrap = document.getElementById(elId);
  wrap.innerHTML = '';
  JOURNAL_SETTINGS_DRAFT[settingsKey].forEach((item, idx) => {
    const chip = document.createElement('span');
    chip.className = 'journal-tag-chip active';
    chip.innerHTML = escapeJournalHtml(item) + ' <span class="journal-tag-remove">✕</span>';
    chip.querySelector('.journal-tag-remove').addEventListener('click', () => {
      JOURNAL_SETTINGS_DRAFT[settingsKey].splice(idx, 1);
      renderTagEditorList(elId, settingsKey, placeholder);
    });
    wrap.appendChild(chip);
  });

  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.className = 'journal-tag-add-input';
  addInput.placeholder = placeholder;
  addInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const val = addInput.value.trim();
    if (val && !JOURNAL_SETTINGS_DRAFT[settingsKey].includes(val)) {
      JOURNAL_SETTINGS_DRAFT[settingsKey].push(val);
      renderTagEditorList(elId, settingsKey, placeholder);
    }
  });
  wrap.appendChild(addInput);
}

function saveSettingsFromDraft(){
  const errEl = document.getElementById('js-error');
  const okEl = document.getElementById('js-success');
  errEl.style.display = 'none'; okEl.style.display = 'none';

  JOURNAL_SETTINGS_DRAFT.accountBalance = parseFloat(document.getElementById('js-balance').value) || 0;
  JOURNAL_SETTINGS_DRAFT.defaultRiskPercent = parseFloat(document.getElementById('js-risk').value) || 0;
  JOURNAL_SETTINGS_DRAFT.currency = document.getElementById('js-currency').value;

  const btn = document.getElementById('js-save-btn');
  btn.disabled = true;
  saveJournalSettings(JOURNAL_UID, JOURNAL_SETTINGS_DRAFT)
    .then(() => {
      JOURNAL_SETTINGS = JSON.parse(JSON.stringify(JOURNAL_SETTINGS_DRAFT));
      okEl.textContent = 'Settings saved.';
      okEl.style.display = 'block';
      if (typeof showToast === 'function') showToast('success', 'Settings saved.');
    })
    .catch((err) => {
      errEl.textContent = err.message || 'Could not save settings.';
      errEl.style.display = 'block';
    })
    .finally(() => { btn.disabled = false; });
}

document.addEventListener('DOMContentLoaded', () => {
  JF_FIELD_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateLiveCalc);
  });

  document.getElementById('jf-save-btn').addEventListener('click', saveTradeFromForm);
  document.getElementById('jf-cancel-edit-btn').addEventListener('click', resetTradeForm);

  document.getElementById('jf-screenshot-btn').addEventListener('click', () => document.getElementById('jf-screenshot-input').click());
  document.getElementById('jf-screenshot-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('jf-screenshot-status').textContent = 'Processing…';
    resizeAvatarToDataUrl(file, 900).then((dataUrl) => {
      JOURNAL_SCREENSHOT_DATA_URL = dataUrl;
      const preview = document.getElementById('jf-screenshot-preview');
      preview.src = dataUrl;
      preview.style.display = 'block';
      document.getElementById('jf-screenshot-status').textContent = 'Attached.';
    }).catch((err) => {
      document.getElementById('jf-screenshot-status').textContent = 'Could not process image: ' + (err.message || err);
    });
    e.target.value = '';
  });

  document.getElementById('js-save-btn').addEventListener('click', saveSettingsFromDraft);
});
