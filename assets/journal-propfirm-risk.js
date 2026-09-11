// Stryker Trading Academy — prop firm risk panel
//
// The UI over assets/propfirm-rules.js. All arithmetic lives in that file and
// is unit-tested in node; this file only renders it and reads the form back.
//
// WHY THE RULES ARE ENTERED, NOT SHIPPED
//
// The preset picker sets the SHAPE of a rule set — which drawdown type, when
// the day resets, whether the floor locks at breakeven — because that is the
// part traders get wrong and the part that rarely changes. Every percentage is
// left blank for the member to copy off their own firm dashboard, and nothing
// is computed until they tick the confirm box. Shipping "FTMO: 5% daily" and
// being six months out of date would mean someone blows a real account
// trusting a number we made up. The engine's value is the arithmetic, not the
// limits.
//
// WHAT LEADS
//
// The panel leads with the tightest constraint, because the rule people watch
// is almost never the rule that gets them. They watch the profit target and
// get carried out by a trailing drawdown while still up on the account.

/* global JOURNAL_TRADES, JOURNAL_SETTINGS, JOURNAL_UID, PF_DATA, PF_OPEN_FORMS,
          pfFindFirm, pfEsc, renderPropFirmsTab, savePropFirms, journalFormatCurrency */

const PF_RULES = (typeof propfirmRules !== 'undefined') ? propfirmRules : null;

let PF_SIZER = {};   // firmId -> risk per unit, kept across re-renders

function pfTrades() {
  return (typeof JOURNAL_TRADES !== 'undefined' && Array.isArray(JOURNAL_TRADES)) ? JOURNAL_TRADES : [];
}

function pfCurrencyFmt() {
  const cur = (typeof JOURNAL_SETTINGS !== 'undefined' && JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD';
  return (v) => (typeof journalFormatCurrency === 'function'
    ? journalFormatCurrency(v, cur)
    : (v < 0 ? '-' : '') + Math.abs(Math.round(v)).toLocaleString());
}

function pfState(firm) {
  if (!PF_RULES || !firm || !PF_RULES.isConfigured(firm.rules)) return null;
  try {
    return PF_RULES.evaluate(firm, pfTrades(), {});
  } catch (err) {
    console.error('Stryker: prop firm rule evaluation failed', err);
    return null;
  }
}

// Pressure as a 0-1 fraction of an allowance, turned into a severity band.
// Three bands, each with a word, because colour is never the only signal.
function pfBand(used) {
  if (used === null || !isFinite(used)) return { k: 'none', word: '' };
  if (used >= 0.85) return { k: 'critical', word: 'Critical' };
  if (used >= 0.6) return { k: 'warn', word: 'Tight' };
  return { k: 'ok', word: 'Comfortable' };
}

function pfMeter(label, left, limit, fmt, opts) {
  const o = opts || {};
  if (limit === null || !isFinite(limit) || limit <= 0) return '';
  const used = Math.max(0, Math.min(1, 1 - (left / limit)));
  const band = pfBand(used);
  return '<div class="pfr-meter is-' + band.k + '">' +
    '<span class="pfr-meter-label">' + pfEsc(label) + '</span>' +
    '<span class="pfr-meter-track"><i style="width:' + (used * 100).toFixed(1) + '%"></i></span>' +
    '<span class="pfr-meter-val">' + (o.raw ? pfEsc(String(left)) : fmt(left)) +
      '<em> of ' + (o.raw ? pfEsc(String(limit)) : fmt(limit)) + ' left</em></span>' +
  '</div>';
}

// ---- the headline ----------------------------------------------------------

function pfBindingCard(st, fmt) {
  if (!st.binding) return '';
  const b = st.binding;
  const band = pfBand(b.used);
  return '<div class="pfr-binding is-' + band.k + '">' +
    '<span class="pfr-kicker">Tightest constraint</span>' +
    '<h4>' + pfEsc(b.label) + '</h4>' +
    '<div class="pfr-binding-num">' + fmt(b.headroom) +
      '<em>left of ' + fmt(b.limit) + '</em></div>' +
    '<div class="pfr-binding-bar"><i style="width:' +
      (Math.max(0, Math.min(1, b.used)) * 100).toFixed(1) + '%"></i></div>' +
    '<span class="pfr-binding-word">' + pfEsc(band.word) + ' — ' +
      Math.round(b.used * 100) + '% of this allowance is spent</span>' +
  '</div>';
}

// ---- the panel -------------------------------------------------------------

function pfRiskPanel(firm) {
  if (!PF_RULES) return '';
  const fmt = pfCurrencyFmt();

  if (!PF_RULES.isConfigured(firm.rules)) {
    return '<div class="pfr-setup">' +
      '<b>No rules set for this account yet.</b>' +
      '<p>Add the drawdown and daily-loss limits from your firm dashboard and this ' +
        'panel will tell you how close you are to each one, which rule is closest to ' +
        'ending the account, and what size you can take right now.</p>' +
      '<button type="button" class="btn btn-primary btn-sm" data-act="open-rules">Set the rules</button>' +
    '</div>';
  }

  const st = pfState(firm);
  if (!st) return '';

  const breach = st.breached
    ? '<div class="pfr-breach"><b>This account has already breached a rule.</b>' +
      '<ul>' + st.breaches.map((b) =>
        '<li>' + pfEsc(b.day || '') + ' — ' + pfEsc(b.detail) + '</li>').join('') + '</ul>' +
      '<p>Shown from your own journal entries. If the firm has not failed the account, ' +
        'check whether the limits below match your dashboard before trusting this.</p></div>'
    : '';

  const cons = st.consistency;
  const consRow = cons
    ? '<div class="pfr-row' + (cons.ok === false ? ' is-warn' : '') + '">' +
        '<span class="pfr-row-k">Consistency</span>' +
        '<span class="pfr-row-v">' +
          (cons.bestDayPct === null
            ? 'No profit yet — nothing to measure.'
            : (cons.bestDayPct > 100
                ? 'Your best day (' + fmt(cons.bestDay) + ') is larger than your whole ' +
                  'profit to date, so the ' + cons.cap + '% cap cannot be met yet.'
                : 'Best day is ' + Math.round(cons.bestDayPct) + '% of profit, cap is ' +
                  cons.cap + '%.') +
              (cons.ok === false
                ? ' <b>Need ' + fmt(cons.needMoreProfit) + ' more profit on other days ' +
                  'before a payout request would pass.</b>'
                : ' Inside the cap.')) +
        '</span>' +
      '</div>'
    : '';

  const target = st.targetAmount > 0
    ? '<div class="pfr-row"><span class="pfr-row-k">Profit target</span><span class="pfr-row-v">' +
        (st.targetHit
          ? '<b>Reached.</b> ' + fmt(st.profit) + ' of ' + fmt(st.targetAmount) + '.'
          : fmt(st.targetRemaining) + ' to go — ' + fmt(st.profit) + ' of ' + fmt(st.targetAmount) + '.') +
      '</span></div>'
    : '';

  const minDays = st.minDays !== null
    ? '<div class="pfr-row"><span class="pfr-row-k">Trading days</span><span class="pfr-row-v">' +
        st.daysTraded + ' of ' + st.minDays +
        (st.minDaysRemaining > 0
          ? ' — ' + st.minDaysRemaining + ' more needed.'
          : ' — requirement met.') +
      '</span></div>'
    : '';

  const optimistic = st.optimistic
    ? '<p class="pfr-caveat"><b>Read this one as a best case.</b> Your firm trails the ' +
      'drawdown on intraday equity, which includes profit on open positions. A journal ' +
      'only records closed trades, so the real floor may be higher than the figure here. ' +
      'Treat the headroom as the most you could have, not the amount you do.</p>'
    : '';

  return '<div class="pfr-panel">' +
    breach +
    pfBindingCard(st, fmt) +
    '<div class="pfr-meters">' +
      pfMeter('Daily loss', st.dailyHeadroom, st.dailyAmount, fmt) +
      pfMeter('Max drawdown', st.ddHeadroom, st.ddAmount, fmt) +
    '</div>' +
    '<div class="pfr-rows">' + target + minDays + consRow + '</div>' +
    pfSizer(firm, st, fmt) +
    optimistic +
    '<div class="pfr-foot">' +
      '<span>Balance ' + fmt(st.balance) + ' · floor ' + fmt(st.floor) + ' · ' +
        st.trades + ' closed trade' + (st.trades === 1 ? '' : 's') + ' on this account</span>' +
      '<button type="button" class="pfr-edit" data-act="open-rules">Edit rules</button>' +
    '</div>' +
  '</div>';
}

// ---- sizer -----------------------------------------------------------------

// The shell never changes. Only pfSizerResult() is rewritten as the member
// types, which keeps the input element itself alive across updates. Replacing
// the whole panel meant re-focusing the new input, which blurred the old one,
// which fired `change`, which re-entered this handler mid-replace — the DOM
// then refused the swap. A result span that updates in place has none of that.
function pfSizer(firm, st, fmt) {
  const risk = PF_SIZER[firm.id];
  const val = risk === undefined || risk === null ? '' : risk;
  return '<div class="pfr-sizer">' +
    '<label class="pfr-sizer-lab" for="pfr-risk-' + pfEsc(firm.id) + '">Risk per unit</label>' +
    '<input type="number" step="any" min="0" id="pfr-risk-' + pfEsc(firm.id) + '" ' +
      'class="journal-input pfr-risk" data-act="sizer" value="' + pfEsc(String(val)) + '" ' +
      'placeholder="e.g. 250">' +
    '<span class="pfr-sizer-result" aria-live="polite">' + pfSizerResult(risk, st, fmt) + '</span>' +
    '<span class="pfr-sizer-note">Holds back 20% of the allowance for slippage, ' +
      'commission and a gapped stop.</span>' +
  '</div>';
}

function pfSizerResult(risk, st, fmt) {
  let result = '<span class="pfr-sizer-hint">Enter what one contract or lot loses if your ' +
    'stop is hit, and this works out the most you can take.</span>';

  const r = parseFloat(risk);
  if (isFinite(r) && r > 0) {
    const s = PF_RULES.sizeFor(st, r, {});
    if (s) {
      const three = s.lossesToBreach(Math.max(1, s.units));
      result = s.units > 0
        ? '<span class="pfr-sizer-out"><b>' + s.units + '</b> unit' + (s.units === 1 ? '' : 's') +
            ' — limited by your ' +
            (s.limitedBy === 'dailyLoss' ? 'daily loss limit' : 'drawdown floor') + '. ' +
            'At that size, <b>' + three + '</b> losing trade' + (three === 1 ? '' : 's') +
            ' in a row would breach it.' +
          '</span>'
        : '<span class="pfr-sizer-out is-stop"><b>No size is safe right now.</b> ' +
            'One stop at ' + fmt(r) + ' per unit would take you past your ' +
            (s.limitedBy === 'dailyLoss' ? 'daily loss limit' : 'drawdown floor') + '. ' +
            'The trade this tool recommends is not taking one.</span>';
    }
  }
  return result;
}

// ---- the rules editor ------------------------------------------------------

function pfRulesForm(firm) {
  if (!PF_RULES) return '';
  const r = Object.assign(PF_RULES.defaultRules(), firm.rules || {});
  const v = (x) => (x === null || x === undefined ? '' : pfEsc(String(x)));

  const ddLabels = {
    static: 'Static',
    trailingClosed: 'Trailing — closed balance',
    trailingIntraday: 'Trailing — intraday equity'
  };
  const ddHelp = {
    static: 'The floor never moves. Profit is yours to give back.',
    trailingClosed: 'The floor rises with every new closed high and never falls again.',
    trailingIntraday: 'Unrealised profit raises the floor too, even if you give it back.'
  };

  return '<div class="pfr-form">' +
    '<div class="pfr-form-warn">' +
      '<b>Copy these from your firm dashboard.</b> Prop firms change their limits, so ' +
      'nothing here is filled in for you. A number guessed on your behalf is a number ' +
      'you might trade on.' +
    '</div>' +

    '<label class="pfr-f-lab">Start from a common shape</label>' +
    '<select class="journal-select pfr-f-preset" data-act="preset">' +
      '<option value="">Choose a shape…</option>' +
      PF_RULES.PRESETS.map((p) =>
        '<option value="' + pfEsc(p.id) + '">' + pfEsc(p.label) + '</option>').join('') +
    '</select>' +
    '<p class="pfr-f-note">Sets the rule types only — never the numbers.</p>' +

    '<div class="pfr-f-grid">' +
      '<label>Starting balance' +
        '<input type="number" step="any" min="0" class="journal-input pfr-f-start" value="' +
          v(firm.startBalance || firm.accountSize) + '"></label>' +

      '<label>Drawdown type' +
        '<select class="journal-select pfr-f-ddtype">' +
          PF_RULES.DD_TYPES.map((t) =>
            '<option value="' + t + '"' + (r.ddType === t ? ' selected' : '') + '>' +
            pfEsc(ddLabels[t]) + '</option>').join('') +
        '</select>' +
        '<em class="pfr-f-help">' + pfEsc(ddHelp[r.ddType] || ddHelp.static) + '</em></label>' +

      '<label>Max drawdown %' +
        '<input type="number" step="any" min="0" class="journal-input pfr-f-ddpct" value="' + v(r.ddPct) + '"></label>' +

      '<label>Daily loss %' +
        '<input type="number" step="any" min="0" class="journal-input pfr-f-dailypct" value="' + v(r.dailyPct) + '"' +
          ' placeholder="blank if none"></label>' +

      '<label>Profit target %' +
        '<input type="number" step="any" min="0" class="journal-input pfr-f-targetpct" value="' + v(r.targetPct) + '"' +
          ' placeholder="blank if funded"></label>' +

      '<label>Consistency cap %' +
        '<input type="number" step="any" min="0" max="100" class="journal-input pfr-f-conspct" value="' + v(r.consistencyPct) + '"' +
          ' placeholder="blank if none"></label>' +

      '<label>Minimum trading days' +
        '<input type="number" step="1" min="0" class="journal-input pfr-f-mindays" value="' + v(r.minDays) + '"' +
          ' placeholder="blank if none"></label>' +

      '<label>Day resets at' +
        '<select class="journal-select pfr-f-reset">' +
          '<option value="0"' + (Number(r.resetHour) === 0 ? ' selected' : '') + '>Midnight UTC</option>' +
          '<option value="17"' + (Number(r.resetHour) === 17 ? ' selected' : '') + '>17:00 New York (futures)</option>' +
          '<option value="22"' + (Number(r.resetHour) === 22 ? ' selected' : '') + '>22:00 UTC</option>' +
        '</select></label>' +
    '</div>' +

    '<label class="pfr-f-check"><input type="checkbox" class="pfr-f-lock"' +
      (r.lockAtStart ? ' checked' : '') + '> ' +
      'The trailing floor stops once it reaches my starting balance</label>' +

    '<label class="pfr-f-check pfr-f-confirm"><input type="checkbox" class="pfr-f-confirmed"' +
      (r.confirmed ? ' checked' : '') + '> ' +
      '<b>I copied these from my firm dashboard, not from memory.</b></label>' +

    '<div class="pfr-form-actions">' +
      '<button type="button" class="btn btn-primary btn-sm" data-act="save-rules">Save rules</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="close-form">Cancel</button>' +
    '</div>' +
  '</div>';
}

function pfReadRulesForm(card, firm) {
  const g = (sel) => card.querySelector(sel);
  const numOf = (sel) => {
    const el = g(sel);
    if (!el || el.value === '') return null;
    const n = parseFloat(el.value);
    return isFinite(n) ? n : null;
  };
  const resetHour = parseInt((g('.pfr-f-reset') || {}).value, 10) || 0;
  const rules = Object.assign(PF_RULES.defaultRules(), firm.rules || {}, {
    ddType: (g('.pfr-f-ddtype') || {}).value || 'static',
    ddPct: numOf('.pfr-f-ddpct'),
    dailyPct: numOf('.pfr-f-dailypct'),
    targetPct: numOf('.pfr-f-targetpct'),
    consistencyPct: numOf('.pfr-f-conspct'),
    minDays: numOf('.pfr-f-mindays'),
    resetHour: resetHour,
    // The zone only means something for a non-midnight reset; pinning it to
    // New York for the futures case is the whole point of that option.
    resetTz: resetHour === 17 ? 'America/New_York' : 'UTC',
    lockAtStart: !!(g('.pfr-f-lock') || {}).checked,
    confirmed: !!(g('.pfr-f-confirmed') || {}).checked
  });
  const start = numOf('.pfr-f-start');
  return { rules: rules, startBalance: start };
}

// ---- the cross-account strip -----------------------------------------------

// One line for the whole desk: of every configured account, which is closest
// to a rule. Someone running four accounts should not have to open four cards
// to find out which one needs attention.
function pfRiskStrip() {
  if (!PF_RULES) return '';
  const fmt = pfCurrencyFmt();
  const rows = [];
  (PF_DATA.firms || []).forEach((f) => {
    if (f.status === 'archived' || f.status === 'failed') return;
    const st = pfState(f);
    if (!st || !st.binding) return;
    rows.push({ firm: f, st: st });
  });
  if (!rows.length) return '';

  rows.sort((a, b) => b.st.binding.used - a.st.binding.used);
  const worst = rows[0];
  const band = pfBand(worst.st.binding.used);

  return '<div class="pfr-strip is-' + band.k + '">' +
    '<div class="pfr-strip-lead">' +
      '<span class="pfr-kicker">Closest to a rule</span>' +
      '<b>' + pfEsc(worst.firm.name) + '</b>' +
      '<span>' + pfEsc(worst.st.binding.label.toLowerCase()) + ' — ' +
        fmt(worst.st.binding.headroom) + ' left, ' +
        Math.round(worst.st.binding.used * 100) + '% spent</span>' +
    '</div>' +
    (rows.length > 1
      ? '<ul class="pfr-strip-rest">' + rows.slice(1).map((r) =>
          '<li><span>' + pfEsc(r.firm.name) + '</span>' +
            '<em>' + pfEsc(r.st.binding.label.toLowerCase()) + '</em>' +
            '<b>' + fmt(r.st.binding.headroom) + '</b></li>').join('') + '</ul>'
      : '') +
  '</div>';
}

// ---- handlers --------------------------------------------------------------

// Returns true when it consumed the action, so the host handler can stop.
function pfRiskHandleClick(act, firm, card) {
  if (!PF_RULES || !firm) return false;

  if (act === 'open-rules') {
    PF_OPEN_FORMS = {};
    PF_OPEN_FORMS[firm.id] = 'rules';
    renderPropFirmsTab();
    return true;
  }
  if (act === 'save-rules') {
    const read = pfReadRulesForm(card, firm);
    if (read.startBalance !== null) firm.startBalance = read.startBalance;
    firm.rules = read.rules;
    PF_OPEN_FORMS = {};
    savePropFirms(typeof JOURNAL_UID !== 'undefined' ? JOURNAL_UID : null);
    renderPropFirmsTab();
    if (typeof showToast === 'function') {
      showToast(read.rules.confirmed ? 'success' : 'info',
        read.rules.confirmed
          ? 'Rules saved — the risk panel is live.'
          : 'Saved, but nothing is computed until you confirm the numbers came off your dashboard.');
    }
    return true;
  }
  return false;
}

function pfRiskHandleChange(el, firm, card) {
  if (!PF_RULES || !firm) return false;

  if (el.classList.contains('pfr-f-preset')) {
    const preset = PF_RULES.PRESETS.find((p) => p.id === el.value);
    if (!preset) return true;
    // Shape only. Every number the member already typed survives, because the
    // preset has no business overwriting a limit they read off their dashboard.
    const dd = card.querySelector('.pfr-f-ddtype');
    const reset = card.querySelector('.pfr-f-reset');
    const lock = card.querySelector('.pfr-f-lock');
    if (dd) dd.value = preset.rules.ddType;
    if (reset) reset.value = String(preset.rules.resetHour || 0);
    if (lock) lock.checked = !!preset.rules.lockAtStart;
    const note = card.querySelector('.pfr-f-note');
    if (note) note.textContent = preset.note;
    return true;
  }
  if (el.classList.contains('pfr-f-ddtype')) {
    const help = card.querySelector('.pfr-f-help');
    const txt = {
      static: 'The floor never moves. Profit is yours to give back.',
      trailingClosed: 'The floor rises with every new closed high and never falls again.',
      trailingIntraday: 'Unrealised profit raises the floor too, even if you give it back.'
    }[el.value];
    if (help && txt) help.textContent = txt;
    return true;
  }
  if (el.classList.contains('pfr-risk')) {
    PF_SIZER[firm.id] = el.value;
    const out = card.querySelector('.pfr-sizer-result');
    const st = pfState(firm);
    // The input element itself is untouched, so focus and caret stay exactly
    // where the member left them and no blur/change re-entry is possible.
    if (out && st) out.innerHTML = pfSizerResult(el.value, st, pfCurrencyFmt());
    return true;
  }
  return false;
}
