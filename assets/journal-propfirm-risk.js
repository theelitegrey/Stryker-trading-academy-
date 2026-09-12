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
let PF_SIM = {};     // firmId -> the last study, so a re-render does not re-run it
const PF_SIM_MODULE = (typeof propfirmSim !== 'undefined') ? propfirmSim : null;
const PF_NEWS_MODULE = (typeof propfirmNews !== 'undefined') ? propfirmNews : null;
const PF_PAYOUT_MODULE = (typeof propfirmPayout !== 'undefined') ? propfirmPayout : null;

let PF_WITHDRAW = {};   // firmId -> the amount being considered

// The economic calendar, fetched once and shared by every firm card. null
// means not fetched yet; false means the fetch failed and should not retry on
// every render.
let PF_CAL = null;
let PF_CAL_TICK = null;

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
    pfNewsBlock(firm) +
    pfPayoutBlock(firm, st) +
    pfSimBlock(firm) +
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


// ---- the challenge simulator -----------------------------------------------
//
// Answers "can this account pass, and at what size" with the member's own
// numbers. It is deliberately behind a button: it replays thousands of
// evaluations and takes a few hundred milliseconds, and a panel that stalls
// every time it renders is a panel people stop opening.

function pfSimBlock(firm) {
  if (!PF_SIM_MODULE || !PF_RULES || !PF_RULES.isConfigured(firm.rules)) return '';

  // The profile is recomputed on every render. It is one pass over the trades,
  // and caching it would leave "you need 18 more graded trades" frozen on
  // screen after the member had added them — with no button to clear it,
  // because a refusal has nothing to re-run. This way it heals itself.
  const profile = PF_SIM_MODULE.profileFrom(pfTrades(), {
    account: firm.name, rules: firm.rules
  });
  if (!profile.ok) return pfSimRefusal(firm, { profile: profile });

  let cached = PF_SIM[firm.id];
  // A study computed from fewer trades than the journal now holds is stale.
  if (cached && cached.ok && cached.profile && cached.profile.trades !== profile.trades) {
    cached = null;
    delete PF_SIM[firm.id];
  }

  if (!cached) {
    return '<div class="pfr-sim">' +
      '<div class="pfr-sim-head"><span class="pfr-kicker">Odds of getting paid</span>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="run-sim">Run the numbers</button></div>' +
      '<p class="pfr-sim-intro">Replays this evaluation thousands of times using your own ' +
        'win rate and R distribution, against the rules above, and reports what share of ' +
        'those runs reached a payout — at each position size.</p>' +
    '</div>';
  }

  if (cached.pending) {
    return '<div class="pfr-sim"><div class="pfr-sim-head">' +
      '<span class="pfr-kicker">Odds of getting paid</span></div>' +
      '<p class="pfr-sim-intro">Replaying…</p></div>';
  }

  if (!cached.ok) return pfSimRefusal(firm, cached);

  return '<div class="pfr-sim">' +
    '<div class="pfr-sim-head"><span class="pfr-kicker">Odds of getting paid</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="run-sim">Run again</button></div>' +
    pfSimResult(firm, cached) +
  '</div>';
}

// A refusal is not an error state. It says what is missing and why it matters,
// because "record your stops" is a more useful instruction than a number
// computed from twelve trades would have been.
function pfSimRefusal(firm, study) {
  const p = study.profile || {};
  let body;
  if (p.reason === 'r' && p.missingStops > p.have) {
    body = '<b>' + p.missingStops + ' of your ' + p.closed + ' trades on this account have no ' +
      'stop recorded</b>, so there is no R-multiple to resample. The simulator needs R ' +
      'because the question it answers is about position size, and size only means ' +
      'something relative to risk. Add the stop to past trades, or start recording it, ' +
      'and this becomes available at ' + PF_SIM_MODULE.MIN_TRADES + ' graded trades.';
  } else if (p.reason === 'days') {
    body = '<b>' + p.have + ' trading days is not enough to resample a day.</b> ' +
      'Daily loss limits bite on how many trades you take in a session, so the ' +
      'simulator needs ' + PF_SIM_MODULE.MIN_DAYS + ' days of that shape. ' +
      p.need + ' more to go.';
  } else {
    body = '<b>' + (p.have || 0) + ' graded trades on this account.</b> ' +
      'The simulator needs ' + PF_SIM_MODULE.MIN_TRADES + ' before it will give you a ' +
      'number — ' + (p.need || 0) + ' more. Below that the answer would be noise ' +
      'dressed up as a probability.';
  }
  return '<div class="pfr-sim"><div class="pfr-sim-head">' +
    '<span class="pfr-kicker">Odds of getting paid</span></div>' +
    '<p class="pfr-sim-intro">' + body + '</p></div>';
}

// What the sweep actually shows, rather than assuming smaller is always better.
// Under-sizing has its own failure mode: the target is never reached inside the
// horizon, which a member reading only the breach rate would never see coming.
function pfSimShape(study) {
  const rs = study.results;
  const best = study.best;
  const i = rs.indexOf(best);
  if (i === 0) {
    return 'That was the smallest size tried, and every larger one did worse — ' +
      'worth testing smaller still if the target is reachable in the time.';
  }
  if (i === rs.length - 1) {
    return 'That was the largest size tried. Smaller sizes ran out of time before ' +
      'reaching the target more often than they breached.';
  }
  const under = rs[0];
  return 'Sizes above it breached more often; below it, ' + under.timeoutRate.toFixed(0) +
    '% of runs ran out of time before reaching the target.';
}

function pfSimResult(firm, study) {
  const fmt = pfCurrencyFmt();
  const p = study.profile;
  const best = study.best;
  const max = Math.max.apply(null, study.results.map((r) => r.passRate).concat([1]));

  // Horizontal bars, one per size. Single measure, single series — so no
  // legend, and the optimum is marked with a label and an outline rather than
  // a different colour. Colour tracking rank instead of identity is how a
  // chart starts lying when the data changes.
  const bars = study.results.map((r) => {
    const isBest = r.riskPct === best.riskPct;
    return '<li class="pfr-sim-row' + (isBest ? ' is-best' : '') + '">' +
      '<span class="pfr-sim-risk">' + r.riskPct + '%' +
        '<em>' + fmt(r.riskAmount) + '</em></span>' +
      '<span class="pfr-sim-track">' +
        '<i style="width:' + ((r.passRate / max) * 100).toFixed(1) + '%"></i>' +
      '</span>' +
      '<span class="pfr-sim-pct">' + r.passRate.toFixed(0) + '%' +
        (isBest ? '<em>best</em>' : '') + '</span>' +
    '</li>';
  }).join('');

  const killer = study.killerRule
    ? '<div class="pfr-row"><span class="pfr-row-k">Usually killed by</span>' +
      '<span class="pfr-row-v">' +
        (study.killerRule === 'maxDrawdown' ? 'The drawdown floor' : 'The daily loss limit') +
      '</span></div>'
    : '';

  const timing = best.medianDaysToPass !== null
    ? '<div class="pfr-row"><span class="pfr-row-k">Typical time</span>' +
      '<span class="pfr-row-v">' + best.medianDaysToPass + ' trading days at ' +
        best.riskPct + '%.</span></div>'
    : '';

  return '<div class="pfr-sim-body">' +
    '<div class="pfr-sim-lead">' +
      '<span class="pfr-sim-big">' + best.passRate.toFixed(0) + '%</span>' +
      '<span class="pfr-sim-lead-txt">of runs reached a payout, risking <b>' +
        best.riskPct + '%</b> per trade — the best of the sizes tried. ' +
        (study.funded
          ? 'On a funded account that means surviving ' + study.maxDays + ' days without a breach.'
          : pfSimShape(study)) +
      '</span>' +
    '</div>' +

    '<h5 class="pfr-sim-h">Pass rate by position size</h5>' +
    '<ul class="pfr-sim-chart">' + bars + '</ul>' +
    '<div class="sr-only"><table><caption>Pass rate by risk per trade</caption>' +
      '<thead><tr><th scope="col">Risk per trade</th><th scope="col">Reached a payout</th>' +
      '<th scope="col">Breached</th></tr></thead><tbody>' +
      study.results.map((r) => '<tr><th scope="row">' + r.riskPct + '%</th><td>' +
        r.passRate.toFixed(0) + '%</td><td>' + r.breachRate.toFixed(0) + '%</td></tr>').join('') +
      '</tbody></table></div>' +

    '<div class="pfr-rows">' + timing + killer +
      '<div class="pfr-row"><span class="pfr-row-k">Built from</span>' +
        '<span class="pfr-row-v">' + p.trades + ' graded trades over ' + p.days + ' days — ' +
          p.winRate.toFixed(0) + '% win rate, ' + p.avgR.toFixed(2) + 'R average. ' +
          study.iterations.toLocaleString() + ' replays per size.</span></div>' +
    '</div>' +

    '<p class="pfr-caveat"><b>Read this as an optimistic bound.</b> Replays draw your past ' +
      'trades independently, but real losses cluster — a bad morning becomes a bad week, and ' +
      'people size up to make it back. Clustering makes a drawdown breach more likely than ' +
      'these numbers suggest, so your real odds are lower than the figure above. It also ' +
      'assumes the edge still works: this is what your past results did against these rules, ' +
      'not a forecast.</p>' +
  '</div>';
}

function pfRunSim(firm, card) {
  if (!PF_SIM_MODULE || !PF_RULES) return;
  PF_SIM[firm.id] = { pending: true };
  renderPropFirmsTab();
  // Yield a frame so the "Replaying…" state paints before the main thread is
  // taken for a few hundred milliseconds.
  setTimeout(() => {
    try {
      const profile = PF_SIM_MODULE.profileFrom(pfTrades(), {
        account: firm.name, rules: firm.rules
      });
      const study = PF_SIM_MODULE.study(profile, firm, { iterations: 2500, seed: 20260912 });
      // Only a real result is cached. A refusal is derived fresh each render
      // from the profile, so it can never outlive the condition that caused it.
      if (study.ok) PF_SIM[firm.id] = study;
      else delete PF_SIM[firm.id];
    } catch (err) {
      console.error('Stryker: simulation failed', err);
      delete PF_SIM[firm.id];
      if (typeof showToast === 'function') showToast('error', 'The simulation could not run.');
    }
    renderPropFirmsTab();
  }, 30);
}


// ---- the news blackout guard -----------------------------------------------
//
// Most firms void trades, or fail accounts, for trading inside a window around
// high-impact news. The economic calendar already holds every release as a UTC
// instant, so the windows come for free. The audit does not: see the timezone
// note in assets/propfirm-news.js.

function pfLoadCalendar() {
  if (PF_CAL !== null) return Promise.resolve(PF_CAL);
  PF_CAL = false;   // claim it, so a slow fetch does not start a second one
  return fetch('assets/econ-calendar.json?t=' + Math.floor(Date.now() / 60000))
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((d) => { PF_CAL = d; renderPropFirmsTab(); return d; })
    .catch((err) => {
      console.error('Stryker: economic calendar could not be loaded for the news guard', err);
      PF_CAL = false;
      return false;
    });
}

function pfNewsWindows(firm) {
  if (!PF_NEWS_MODULE || !PF_CAL || !PF_CAL.events) return [];
  return PF_NEWS_MODULE.windowsFor(PF_CAL.events, firm.rules || {});
}

function pfNewsBlock(firm) {
  if (!PF_NEWS_MODULE || !PF_RULES || !PF_RULES.isConfigured(firm.rules)) return '';
  const rules = firm.rules || {};
  if (!PF_NEWS_MODULE.isConfigured(rules)) return '';

  if (PF_CAL === null) { pfLoadCalendar(); }
  if (!PF_CAL) {
    return '<div class="pfr-news"><span class="pfr-kicker">News blackout</span>' +
      '<p class="pfr-news-note">The economic calendar could not be loaded, so windows ' +
      'cannot be worked out right now.</p></div>';
  }

  const windows = pfNewsWindows(firm);
  const st = PF_NEWS_MODULE.status(windows, Date.now());
  const before = Number(rules.newsBeforeMin) || 0;
  const after = Number(rules.newsAfterMin) || 0;

  return '<div class="pfr-news' + (st.inside ? ' is-blocked' : '') + '" data-firm-news="' + pfEsc(firm.id) + '">' +
    '<div class="pfr-news-head">' +
      '<span class="pfr-kicker">News blackout</span>' +
      '<span class="pfr-news-rule">' + before + ' min before, ' + after + ' min after ' +
        (rules.newsImpact === 'medium' ? 'medium and high' : 'high') + '-impact releases</span>' +
    '</div>' +
    pfNewsStatus(st) +
    pfNewsUpcoming(windows) +
    pfNewsAudit(firm, windows) +
  '</div>';
}

function pfNewsStatus(st) {
  if (st.inside) {
    return '<div class="pfr-news-now is-blocked">' +
      '<b>Restricted right now — ' + pfEsc(st.inside.event) + '</b>' +
      '<span class="pfr-news-cd" data-until="' + st.inside.to + '" data-mode="clear">—</span>' +
      '<em>until the window clears</em>' +
    '</div>';
  }
  if (st.next) {
    return '<div class="pfr-news-now">' +
      '<b>Next window — ' + pfEsc(st.next.event) + '</b>' +
      '<span class="pfr-news-cd" data-until="' + st.next.from + '" data-mode="open">—</span>' +
      '<em>until it opens</em>' +
    '</div>';
  }
  return '<div class="pfr-news-now is-quiet">' +
    '<b>No further windows on the calendar.</b>' +
    '<em>Nothing left in the published range.</em></div>';
}

function pfNewsUpcoming(windows) {
  const now = Date.now();
  const soon = windows.filter((w) => w.to > now).slice(0, 4);
  if (!soon.length) return '';
  const t = (ms) => new Date(ms).toLocaleString(undefined,
    { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  return '<ul class="pfr-news-list">' + soon.map((w) =>
    '<li><span class="pfr-news-when">' + pfEsc(t(w.from)) + ' – ' +
      pfEsc(new Date(w.to).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })) +
      '</span><span class="ec-code">' + pfEsc(w.cur) + '</span>' +
      '<b>' + pfEsc(w.event) + '</b></li>').join('') + '</ul>';
}

// The retrospective half. Gated on a confirmed journal timezone, because a
// four-minute window compared against a time of unknown zone can be hours out,
// and both kinds of wrong answer here are harmful: a false accusation, or a
// clean bill of health for a trade that did breach.
function pfNewsAudit(firm, windows) {
  const rules = firm.rules || {};
  if (!PF_NEWS_MODULE.canAudit(rules)) {
    const guess = pfGuessTz();
    return '<div class="pfr-news-audit is-locked">' +
      '<b>Past trades are not checked yet.</b>' +
      '<p>Your journal records a time but not a timezone, and the difference decides ' +
        'the answer — the same trade can be clear in one zone and a breach in another. ' +
        'Tell the rules editor which zone your entry times are in (it looks like <b>' +
        pfEsc(guess) + '</b> from this browser) and past trades get checked against ' +
        'every window.</p>' +
    '</div>';
  }

  const res = PF_NEWS_MODULE.audit(pfTrades(), windows, {
    account: firm.name, journalTz: rules.journalTz,
    rangeStart: PF_CAL.rangeStart, rangeEnd: PF_CAL.rangeEnd
  });

  // Three counts, always. A clean result that quietly skipped most of the
  // journal is not a clean result, and the skipped ones have different fixes.
  const gaps = [];
  if (res.noTime) gaps.push(res.noTime + ' with no entry time recorded');
  if (res.outOfRange) gaps.push(res.outOfRange + ' outside the calendar’s range');
  const gapLine = gaps.length
    ? '<p class="pfr-news-gap">Not checked: ' + pfEsc(gaps.join(', ')) + '. ' +
      (res.outOfRange ? 'The calendar covers ' + pfEsc(PF_CAL.rangeStart || '') + ' to ' +
        pfEsc(PF_CAL.rangeEnd || '') + '. ' : '') +
      'Those are neither cleared nor flagged.</p>'
    : '';

  if (!res.hits.length) {
    return '<div class="pfr-news-audit">' +
      '<b>' + (res.checked
        ? res.checked + ' trade' + (res.checked === 1 ? '' : 's') + ' checked, none inside a window.'
        : 'No trades could be checked.') + '</b>' + gapLine +
    '</div>';
  }

  return '<div class="pfr-news-audit is-hit">' +
    '<b>' + res.hits.length + ' trade' + (res.hits.length === 1 ? '' : 's') +
      ' landed inside a restricted window.</b>' +
    '<ul>' + res.hits.slice(0, 6).map((h) =>
      '<li><span>' + pfEsc(h.trade.date || '') + ' ' + pfEsc(h.trade.time || '') + '</span>' +
        (h.trade.instrument ? '<em>' + pfEsc(h.trade.instrument) + '</em>' : '') +
        '<b>' + pfEsc(h.window.event) + '</b></li>').join('') +
    '</ul>' + gapLine +
    '<p class="pfr-news-gap">Whether that breaches your agreement is your firm’s call, ' +
      'not this page’s — rules differ on held positions and on which releases count.</p>' +
  '</div>';
}

// A short list rather than the full IANA set. These cover the platform clocks
// members actually see — broker servers are overwhelmingly in the EET band,
// exchanges in Chicago and New York — plus whatever this browser reports, so
// the right answer is always present without a 400-entry dropdown.
const PF_TZ_LIST = [
  'UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Athens', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Sao_Paulo',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'
];

function pfTzOptions(selected) {
  const list = PF_TZ_LIST.slice();
  const mine = pfGuessTz();
  selected = pfCanonTz(selected);
  if (list.indexOf(mine) < 0) list.unshift(mine);
  if (selected && list.indexOf(selected) < 0) list.unshift(selected);
  return list.map((z) =>
    '<option value="' + pfEsc(z) + '"' + (z === selected ? ' selected' : '') + '>' +
      pfEsc(z.replace(/_/g, ' ')) + (z === mine ? ' (this browser)' : '') +
    '</option>').join('');
}

// Chromium still reports several zones under names their countries retired
// decades ago. Left alone, the browser's "Asia/Calcutta" appears in the picker
// as a SECOND entry beside "Asia/Kolkata" — two options for one zone, one of
// them a name India stopped using in 2001. They resolve to identical offsets,
// so this is presentation only and changes no arithmetic.
const PF_TZ_ALIASES = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'Australia/Canberra': 'Australia/Sydney',
  'US/Eastern': 'America/New_York',
  'US/Central': 'America/Chicago',
  'US/Pacific': 'America/Los_Angeles'
};

function pfCanonTz(z) {
  return PF_TZ_ALIASES[z] || z;
}

function pfGuessTz() {
  try { return pfCanonTz(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'); }
  catch (e) { return 'UTC'; }
}

// One interval for every countdown on the page, started only when at least one
// exists. Re-rendering the whole tab every second to move a clock would fight
// with the sizer input and every open form.
function pfNewsTick() {
  const els = document.querySelectorAll('.pfr-news-cd[data-until]');
  if (!els.length) {
    if (PF_CAL_TICK) { clearInterval(PF_CAL_TICK); PF_CAL_TICK = null; }
    return;
  }
  const now = Date.now();
  let expired = false;
  els.forEach((el) => {
    const left = Number(el.getAttribute('data-until')) - now;
    if (left <= 0) { expired = true; el.textContent = 'now'; return; }
    const s = Math.floor(left / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    el.textContent = h > 0
      ? h + 'h ' + String(m).padStart(2, '0') + 'm'
      : m + 'm ' + String(ss).padStart(2, '0') + 's';
  });
  // A window that has just opened or closed changes the whole block, so it is
  // the one case worth a re-render.
  if (expired) renderPropFirmsTab();
}

function pfNewsStartTick() {
  if (PF_CAL_TICK) return;
  if (!document.querySelector('.pfr-news-cd[data-until]')) return;
  pfNewsTick();
  PF_CAL_TICK = setInterval(pfNewsTick, 1000);
}


// ---- the payout planner ----------------------------------------------------
//
// Turns the fee-and-payout ledger from a record of the past into a forward
// plan. The hero is the before-and-after: a withdrawal lowers the balance, and
// on most trailing accounts the floor does not follow it down, so the money
// leaving the account comes straight out of the headroom.

function pfPayoutBlock(firm, st) {
  if (!PF_PAYOUT_MODULE || !PF_RULES || !PF_RULES.isConfigured(firm.rules)) return '';
  const rules = firm.rules || {};
  const fmt = pfCurrencyFmt();

  if (!PF_PAYOUT_MODULE.isConfigured(rules)) {
    return '<div class="pfr-payout">' +
      '<span class="pfr-kicker">Payout plan</span>' +
      '<p class="pfr-payout-intro">Add your profit split and say whether a withdrawal ' +
        'lowers your drawdown floor, and this works out when you can request a payout, ' +
        'how much you can safely take, and what the account looks like the moment after ' +
        'it lands. That last one matters more than people expect.</p>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="open-rules">Add the payout terms</button>' +
    '</div>';
  }

  const plan = PF_PAYOUT_MODULE.plan(firm, st, {});
  if (!plan) return '';

  return '<div class="pfr-payout">' +
    '<div class="pfr-news-head"><span class="pfr-kicker">Payout plan</span>' +
      '<span class="pfr-news-rule">' + (rules.profitSplitPct) + '% split &middot; floor ' +
        (rules.payoutFloorBehaviour === 'reduces' ? 'drops with the withdrawal' : 'stays put') +
      '</span></div>' +
    pfPayoutEligibility(plan, fmt) +
    pfPayoutWithdraw(firm, st, plan, fmt) +
    pfPayoutScaling(plan, fmt) +
    pfPayoutLedger(plan, fmt) +
  '</div>';
}

function pfPayoutEligibility(plan, fmt) {
  const e = plan.eligibility;
  if (e.eligible) {
    return '<div class="pfr-payout-elig is-ok">' +
      '<b>Eligible to request a payout.</b>' +
      '<span>Every condition you have entered is met.</span></div>';
  }
  // Every blocker, not just the first. Someone told only "you need more
  // profit" will hit the day requirement next and feel misled.
  const word = (b) => {
    if (b.rule === 'minProfit') return 'another ' + fmt(b.need) + ' of profit';
    if (b.rule === 'minDays') return b.need + ' more trading day' + (b.need === 1 ? '' : 's');
    if (b.rule === 'cycle') return b.need + ' more day' + (b.need === 1 ? '' : 's') + ' of the cycle';
    if (b.rule === 'consistency') return fmt(b.need) + ' more profit on days other than your best';
    return '';
  };
  return '<div class="pfr-payout-elig">' +
    '<b>Not eligible yet — ' + e.blockers.length + ' condition' +
      (e.blockers.length === 1 ? '' : 's') + ' outstanding.</b>' +
    '<ul>' + e.blockers.map((b) =>
      '<li><span>' + pfEsc(b.label) + '</span><em>' + pfEsc(word(b)) + '</em></li>').join('') + '</ul>' +
  '</div>';
}

function pfPayoutWithdraw(firm, st, plan, fmt) {
  const raw = PF_WITHDRAW[firm.id];
  const amount = raw === undefined || raw === null || raw === ''
    ? plan.maxSafe : parseFloat(raw);
  const val = raw === undefined || raw === null ? (plan.maxSafe || '') : raw;
  // While a condition is outstanding the calculator is a planning tool, not a
  // permission slip. Labelling it "Withdraw" beside "not eligible yet" reads
  // as contradiction; "If you withdrew" reads as what it is.
  const hypothetical = !plan.eligibility.eligible;
  return '<div class="pfr-payout-calc' + (hypothetical ? ' is-hypothetical' : '') + '">' +
    '<label class="pfr-sizer-lab" for="pfr-wd-' + pfEsc(firm.id) + '">' +
      (hypothetical ? 'If you withdrew' : 'Withdraw') + '</label>' +
    '<input type="number" step="any" min="0" id="pfr-wd-' + pfEsc(firm.id) + '" ' +
      'class="journal-input pfr-withdraw" value="' + pfEsc(String(val)) + '">' +
    '<span class="pfr-payout-result">' + pfPayoutImpact(firm, st, amount, plan, fmt) + '</span>' +
  '</div>';
}

// The before-and-after. This is the whole feature.
function pfPayoutImpact(firm, st, amount, plan, fmt) {
  const a = parseFloat(amount);
  if (!isFinite(a) || a <= 0) {
    return '<span class="pfr-payout-hint">Nothing to withdraw yet, or enter an amount to ' +
      'see what the account looks like afterwards.</span>';
  }
  const i = PF_PAYOUT_MODULE.impact(firm, st, a);
  if (!i) return '';

  const safe = plan.maxSafe;
  const verdict = i.breaches
    ? '<span class="pfr-payout-verdict is-stop"><b>This withdrawal fails the account.</b> ' +
      'It leaves the balance at or below the drawdown floor.</span>'
    : (safe !== null && a > safe
        ? '<span class="pfr-payout-verdict is-warn"><b>Above what is comfortable.</b> ' +
          fmt(safe) + ' keeps a quarter of the drawdown allowance in reserve.</span>'
        : '<span class="pfr-payout-verdict is-ok"><b>Leaves a working buffer.</b></span>');

  return verdict +
    '<span class="pfr-payout-pays">You receive <b>' +
      (i.received === null ? '—' : fmt(i.received)) + '</b>' +
      (i.split !== null ? ' at your ' + i.split + '% split' : '') + '.</span>' +
    '<span class="pfr-payout-ba">' +
      '<span><em>Headroom now</em><b>' + fmt(i.headroomBefore) + '</b></span>' +
      '<span class="pfr-payout-arrow" aria-hidden="true">&rarr;</span>' +
      '<span class="' + (i.breaches ? 'is-stop' : '') + '"><em>After</em><b>' +
        fmt(i.headroomAfter) + '</b></span>' +
    '</span>' +
    (i.floorStays
      ? '<span class="pfr-payout-why">Your floor stays at ' + fmt(i.floorAfter) +
        ' — every pound withdrawn is a pound of headroom gone.</span>'
      : '<span class="pfr-payout-why">Your floor drops to ' + fmt(i.floorAfter) +
        ' with the withdrawal, so headroom is unchanged.</span>');
}

function pfPayoutScaling(plan, fmt) {
  const s = plan.scaling;
  if (!s) return '';
  if (s.reached) {
    return '<div class="pfr-row"><span class="pfr-row-k">Scaling</span>' +
      '<span class="pfr-row-v"><b>Target reached.</b>' +
      (s.newSize ? ' The account scales to ' + fmt(s.newSize) + '.' : '') + '</span></div>';
  }
  return '<div class="pfr-row"><span class="pfr-row-k">Scaling</span>' +
    '<span class="pfr-row-v">' + fmt(s.remaining) + ' more profit to the next step' +
      (s.newSize ? ', which takes the account to ' + fmt(s.newSize) : '') + '. ' +
      Math.round(s.progress * 100) + '% of the way.</span></div>';
}

// Fees against money actually banked, kept separate from profit still sitting
// in the account. Counting unbanked profit as a return is how people convince
// themselves a losing run of challenges was working.
function pfPayoutLedger(plan, fmt) {
  const t = plan.totals;
  return '<div class="pfr-payout-ledger">' +
    '<span><em>Fees paid</em><b>' + fmt(t.spent) + '</b></span>' +
    '<span><em>Banked</em><b>' + fmt(t.received) + '</b></span>' +
    '<span class="' + (t.net > 0 ? 'is-up' : (t.net < 0 ? 'is-down' : '')) + '">' +
      '<em>Net so far</em><b>' + (t.net > 0 ? '+' : '') + fmt(t.net) + '</b></span>' +
    '<span><em>Still in the account</em><b>' + fmt(plan.unrealised) + '</b></span>' +
  '</div>';
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

      '<label>News blackout, minutes before' +
        '<input type="number" step="1" min="0" class="journal-input pfr-f-newsbefore" value="' +
          v(r.newsBeforeMin) + '" placeholder="blank if none"></label>' +

      '<label>Minutes after' +
        '<input type="number" step="1" min="0" class="journal-input pfr-f-newsafter" value="' +
          v(r.newsAfterMin) + '" placeholder="blank if none"></label>' +

      '<label>Blackout applies to' +
        '<select class="journal-select pfr-f-newsimpact">' +
          '<option value="high"' + (r.newsImpact !== 'medium' ? ' selected' : '') + '>High impact only</option>' +
          '<option value="medium"' + (r.newsImpact === 'medium' ? ' selected' : '') + '>Medium and high</option>' +
        '</select></label>' +

      '<label>My journal times are in' +
        '<select class="journal-select pfr-f-journaltz">' +
          pfTzOptions(r.journalTz || pfGuessTz()) +
        '</select>' +
        '<em class="pfr-f-help">The journal stores a time but not a zone. This decides ' +
          'whether a trade was inside a window.</em></label>' +

      '<label>Profit split, my share %' +
        '<input type="number" step="any" min="0" max="100" class="journal-input pfr-f-split" value="' +
          v(r.profitSplitPct) + '" placeholder="e.g. 80"></label>' +

      '<label>On a withdrawal, my drawdown floor' +
        '<select class="journal-select pfr-f-floorbehave">' +
          '<option value=""' + (!r.payoutFloorBehaviour ? ' selected' : '') + '>Choose…</option>' +
          '<option value="stays"' + (r.payoutFloorBehaviour === 'stays' ? ' selected' : '') + '>Stays where it is</option>' +
          '<option value="reduces"' + (r.payoutFloorBehaviour === 'reduces' ? ' selected' : '') + '>Drops by the amount withdrawn</option>' +
        '</select>' +
        '<em class="pfr-f-help">The most expensive thing to be wrong about. Most firms leave ' +
          'the floor where it is, so the money you take out comes straight off your headroom.</em></label>' +

      '<label>Minimum profit before a payout %' +
        '<input type="number" step="any" min="0" class="journal-input pfr-f-minprofit" value="' +
          v(r.payoutMinProfitPct) + '" placeholder="blank if none"></label>' +

      '<label>Minimum trading days before a payout' +
        '<input type="number" step="1" min="0" class="journal-input pfr-f-paydays" value="' +
          v(r.payoutMinDays) + '" placeholder="blank if none"></label>' +

      '<label>Payout cycle, days' +
        '<input type="number" step="1" min="0" class="journal-input pfr-f-cycle" value="' +
          v(r.payoutCycleDays) + '" placeholder="blank if none"></label>' +

      '<label>Scales at profit %' +
        '<input type="number" step="any" min="0" class="journal-input pfr-f-scaleat" value="' +
          v(r.scaleAtProfitPct) + '" placeholder="blank if none"></label>' +

      '<label>Scales to account size' +
        '<input type="number" step="any" min="0" class="journal-input pfr-f-scalesize" value="' +
          v(r.scaleNewSize) + '" placeholder="blank if none"></label>' +

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

    '<label class="pfr-f-check"><input type="checkbox" class="pfr-f-tzconfirmed"' +
      (r.journalTzConfirmed ? ' checked' : '') + '> ' +
      'My journal entry times really are in that zone (needed before past trades ' +
      'are checked against news windows)</label>' +

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
    profitSplitPct: numOf('.pfr-f-split'),
    payoutFloorBehaviour: (g('.pfr-f-floorbehave') || {}).value || null,
    payoutMinProfitPct: numOf('.pfr-f-minprofit'),
    payoutMinDays: numOf('.pfr-f-paydays'),
    payoutCycleDays: numOf('.pfr-f-cycle'),
    scaleAtProfitPct: numOf('.pfr-f-scaleat'),
    scaleNewSize: numOf('.pfr-f-scalesize'),
    newsBeforeMin: numOf('.pfr-f-newsbefore'),
    newsAfterMin: numOf('.pfr-f-newsafter'),
    newsImpact: (g('.pfr-f-newsimpact') || {}).value || 'high',
    journalTz: (g('.pfr-f-journaltz') || {}).value || 'UTC',
    journalTzConfirmed: !!(g('.pfr-f-tzconfirmed') || {}).checked,
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
  if (act === 'run-sim') {
    pfRunSim(firm, card);
    return true;
  }
  if (act === 'save-rules') {
    const read = pfReadRulesForm(card, firm);
    if (read.startBalance !== null) firm.startBalance = read.startBalance;
    firm.rules = read.rules;
    // Everything derived from the OLD limits goes. A pass rate computed against
    // rules that no longer apply is worse than none, and a withdrawal amount
    // that was safe under the previous floor behaviour may now fail the
    // account outright.
    delete PF_SIM[firm.id];
    delete PF_WITHDRAW[firm.id];
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
  if (el.classList.contains('pfr-withdraw')) {
    PF_WITHDRAW[firm.id] = el.value;
    const out = card.querySelector('.pfr-payout-result');
    const st = pfState(firm);
    if (out && st && PF_PAYOUT_MODULE) {
      const plan = PF_PAYOUT_MODULE.plan(firm, st, {});
      out.innerHTML = pfPayoutImpact(firm, st, el.value, plan, pfCurrencyFmt());
    }
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
