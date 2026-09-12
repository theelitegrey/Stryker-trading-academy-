// Stryker Trading Academy — prop firm rule engine
//
// Pure. No DOM, no Firestore, no globals beyond the one it exports. Everything
// here is arithmetic over a list of closed trades, which means it is testable
// in node and IS tested there — because a bug in this file does not produce a
// visual glitch, it tells someone they have room to trade when they do not.
//
// WHAT THIS KNOWS THAT MOST TRADERS DO NOT
//
// The three drawdown types behave completely differently and people routinely
// think they are on one when they are on another:
//
//   static            floor = start - maxDD. Never moves. Profit is yours to
//                     give back all the way down to the original floor.
//   trailingClosed    floor = highest closed balance - maxDD. Rises with every
//                     new equity high and NEVER falls. Give back too much of a
//                     good run and you breach while still up on the account.
//   trailingIntraday  same, but the peak includes unrealised profit. The
//                     brutal one: an open trade that ran +$2,000 and came back
//                     to flat has permanently raised your floor by $2,000.
//   lockAtStart       any trailing type can stop trailing once the floor
//                     reaches the starting balance. floor = min(peak-DD, start).
//
// The consistency rule is the other silent killer: pass the profit target,
// then get the payout denied because one day was too large a share of it.
//
// AN HONESTY CONSTRAINT, STATED IN THE OUTPUT
//
// A trade journal records closed trades. It cannot see the intraday equity
// peak of an open position. So for trailingIntraday the peak computed here is
// the peak of the CLOSED balance, which is a lower bound — the real floor may
// be higher than this says. evaluate() returns `optimistic: true` for that
// case so the UI can say so rather than implying a precision it does not have.
// Quietly under-reporting a floor is exactly how someone breaches.

(function (root) {
  'use strict';

  const DD_TYPES = ['static', 'trailingClosed', 'trailingIntraday'];
  const DAILY_BASIS = ['prevClose', 'startBalance'];

  function num(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }

  function tradeTime(t) {
    if (!t) return null;
    const raw = t.closedAt || t.date || t.openedAt;
    if (!raw) return null;
    // A bare YYYY-MM-DD has no time. Treat it as midday rather than midnight
    // so a reset-hour rule does not silently push every dateless trade into
    // the previous session.
    const s = /^\d{4}-\d{2}-\d{2}$/.test(String(raw)) ? raw + 'T12:00:00' : raw;
    const ms = Date.parse(s);
    return isFinite(ms) ? ms : null;
  }

  // The session a timestamp belongs to, given the firm's reset hour and zone.
  // Futures firms reset at 17:00 New York, so a trade at 18:00 on Monday is
  // part of TUESDAY's session and counts against Tuesday's daily loss limit.
  // Getting this wrong moves a loss into the wrong bucket and can hide a
  // breach entirely.
  function sessionDay(ms, resetHour, tz) {
    if (!isFinite(ms)) return null;
    const hour = Number(resetHour) || 0;
    let y, m, d, h;
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz || 'UTC', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit'
      }).formatToParts(new Date(ms));
      const g = (k) => parts.find((p) => p.type === k).value;
      y = +g('year'); m = +g('month'); d = +g('day');
      h = +g('hour') % 24;          // some locales render midnight as 24
    } catch (e) {
      const dt = new Date(ms);
      y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate(); h = dt.getUTCHours();
    }
    const base = Date.UTC(y, m - 1, d);
    const shifted = hour > 0 && h >= hour ? base + 86400000 : base;
    return new Date(shifted).toISOString().slice(0, 10);
  }

  function pnlOf(t) {
    const p = num(t && t.pnl);
    if (p === null) return null;
    const fees = num(t && t.fees);
    // pnl is already net in this journal; fees are recorded for reporting.
    // Subtracting again would double-count, so it is deliberately not done.
    return p;
  }

  function isClosed(t) {
    return pnlOf(t) !== null;
  }

  // ---- shaping -------------------------------------------------------------

  // Trades belonging to one firm, closed only, oldest first, each tagged with
  // its session day.
  function sessionTrades(trades, firm, rules) {
    const name = firm && firm.name;
    const resetHour = (rules && num(rules.resetHour)) || 0;
    const tz = (rules && rules.resetTz) || 'UTC';
    return (trades || [])
      .filter((t) => t && isClosed(t) && (!name || (t.account || '') === name))
      .map((t) => ({ t: t, ms: tradeTime(t), pnl: pnlOf(t) }))
      .filter((x) => x.ms !== null)
      .sort((a, b) => a.ms - b.ms)
      .map((x) => ({ ms: x.ms, pnl: x.pnl, day: sessionDay(x.ms, resetHour, tz), trade: x.t }));
  }

  // P&L per session day, in order.
  function dailyPnl(st) {
    const out = [];
    let cur = null;
    st.forEach((x) => {
      if (!cur || cur.day !== x.day) { cur = { day: x.day, pnl: 0, trades: 0 }; out.push(cur); }
      cur.pnl += x.pnl;
      cur.trades += 1;
    });
    return out;
  }

  // ---- the floor -----------------------------------------------------------

  // Walks the trade sequence and returns the drawdown floor after every trade,
  // plus the peak that produced it. Written as a walk rather than a formula
  // because a trailing floor depends on the ORDER of results, not just the
  // total: +5k then -5k is a very different account from -5k then +5k, and a
  // closed-form calculation cannot tell them apart.
  function floorWalk(st, start, rules) {
    const ddAmt = ddAmount(start, rules);
    const type = (rules && rules.ddType) || 'static';
    const lock = !!(rules && rules.lockAtStart);
    let bal = start, peak = start, floor = start - ddAmt;
    const steps = [];
    const trailing = type === 'trailingClosed' || type === 'trailingIntraday';

    steps.push({ ms: null, bal: bal, peak: peak, floor: floor, breached: false });
    st.forEach((x) => {
      bal += x.pnl;
      if (bal > peak) peak = bal;
      if (trailing) {
        floor = peak - ddAmt;
        // A floor that locks stops rising once it reaches the starting
        // balance — from then on the account behaves like a static one.
        if (lock && floor > start) floor = start;
      }
      steps.push({ ms: x.ms, day: x.day, bal: bal, peak: peak, floor: floor,
                   breached: bal < floor - 1e-9 });
    });
    return { steps: steps, balance: bal, peak: peak, floor: floor, ddAmount: ddAmt };
  }

  function ddAmount(start, rules) {
    if (!rules) return 0;
    const abs = num(rules.ddAmount);
    if (abs !== null && abs > 0) return abs;
    const pct = num(rules.ddPct);
    return pct !== null && pct > 0 ? start * (pct / 100) : 0;
  }

  function dailyAmount(start, rules) {
    if (!rules) return 0;
    const abs = num(rules.dailyAmount);
    if (abs !== null && abs > 0) return abs;
    const pct = num(rules.dailyPct);
    return pct !== null && pct > 0 ? start * (pct / 100) : 0;
  }

  function targetAmount(start, rules) {
    if (!rules) return 0;
    const abs = num(rules.targetAmount);
    if (abs !== null && abs > 0) return abs;
    const pct = num(rules.targetPct);
    return pct !== null && pct > 0 ? start * (pct / 100) : 0;
  }

  // ---- consistency ---------------------------------------------------------

  // Best single winning day as a share of total profit. Returns null rather
  // than a number when there is no profit yet: a consistency ratio on a losing
  // account is meaningless, and showing "0%" would read as passing.
  function consistency(days, totalProfit, capPct) {
    const cap = num(capPct);
    if (cap === null || cap <= 0) return null;
    const wins = days.filter((d) => d.pnl > 0);
    if (!wins.length || totalProfit <= 0) {
      return { cap: cap, bestDay: wins.length ? Math.max.apply(null, wins.map((d) => d.pnl)) : 0,
               bestDayPct: null, ok: null, needMoreProfit: null, totalProfit: totalProfit };
    }
    const best = wins.reduce((a, d) => (d.pnl > a.pnl ? d : a), wins[0]);
    const pct = (best.pnl / totalProfit) * 100;
    // To satisfy best/total <= cap you need total >= best/cap. That difference
    // is the actionable number: how much more profit, made on OTHER days.
    const needTotal = best.pnl / (cap / 100);
    return {
      cap: cap, bestDay: best.pnl, bestDayOn: best.day, bestDayPct: pct,
      totalProfit: totalProfit, ok: pct <= cap + 1e-9,
      needMoreProfit: pct <= cap ? 0 : needTotal - totalProfit
    };
  }

  // ---- the whole picture ---------------------------------------------------

  function evaluate(firm, trades, opts) {
    const o = opts || {};
    const rules = (firm && firm.rules) || {};
    const start = num(firm && (firm.startBalance || firm.accountSize)) || 0;
    const st = sessionTrades(trades, firm, rules);
    const days = dailyPnl(st);
    const walk = floorWalk(st, start, rules);

    const now = o.now || Date.now();
    const today = sessionDay(now, num(rules.resetHour) || 0, rules.resetTz || 'UTC');
    const todayRow = days.find((d) => d.day === today);
    const todayPnl = todayRow ? todayRow.pnl : 0;

    const dailyAmt = dailyAmount(start, rules);
    const targetAmt = targetAmount(start, rules);
    const profit = walk.balance - start;

    // Daily headroom is what is left of today's allowance, not the distance to
    // a balance: the limit resets, the balance does not.
    const dailyHeadroom = dailyAmt > 0 ? dailyAmt + Math.min(0, todayPnl) : null;
    const ddHeadroom = walk.ddAmount > 0 ? walk.balance - walk.floor : null;

    const minDays = num(rules.minDays);
    const countedDays = rules.minDayPnl
      ? days.filter((d) => d.pnl >= num(rules.minDayPnl)).length
      : days.length;

    const cons = consistency(days, profit, rules.consistencyPct);

    // Which rule is closest to killing the account, expressed as the fraction
    // of its own allowance already spent. People watch the profit target and
    // get carried out by the trailing drawdown.
    const pressures = [];
    if (dailyAmt > 0) {
      pressures.push({ rule: 'dailyLoss', label: 'Daily loss',
                       used: Math.max(0, -todayPnl) / dailyAmt,
                       headroom: dailyHeadroom, limit: dailyAmt });
    }
    if (walk.ddAmount > 0) {
      pressures.push({ rule: 'maxDrawdown', label: 'Max drawdown',
                       used: Math.max(0, (walk.peak - walk.balance)) / walk.ddAmount,
                       headroom: ddHeadroom, limit: walk.ddAmount });
    }
    pressures.sort((a, b) => b.used - a.used);

    const breachStep = walk.steps.find((s) => s.breached);
    const breaches = [];
    if (breachStep) {
      breaches.push({ rule: 'maxDrawdown', day: breachStep.day,
                      detail: 'Balance fell below the drawdown floor.' });
    }
    if (dailyAmt > 0) {
      days.forEach((d) => {
        if (d.pnl < -dailyAmt - 1e-9) {
          breaches.push({ rule: 'dailyLoss', day: d.day,
                          detail: 'Lost more than the daily allowance in one session.' });
        }
      });
    }

    return {
      start: start,
      balance: walk.balance,
      peak: walk.peak,
      floor: walk.floor,
      profit: profit,
      ddType: rules.ddType || 'static',
      ddAmount: walk.ddAmount,
      ddHeadroom: ddHeadroom,
      ddHeadroomPct: walk.ddAmount > 0 ? (ddHeadroom / walk.ddAmount) * 100 : null,
      // Said out loud, not buried: a journal cannot see the intraday peak of
      // an open position, so a trailing-intraday floor computed from closed
      // trades is a lower bound on the real one.
      optimistic: (rules.ddType === 'trailingIntraday'),
      dailyAmount: dailyAmt,
      todayPnl: todayPnl,
      today: today,
      dailyHeadroom: dailyHeadroom,
      dailyHeadroomPct: dailyAmt > 0 ? (dailyHeadroom / dailyAmt) * 100 : null,
      targetAmount: targetAmt,
      targetRemaining: targetAmt > 0 ? Math.max(0, targetAmt - profit) : null,
      targetHit: targetAmt > 0 ? profit >= targetAmt : null,
      daysTraded: countedDays,
      minDays: minDays,
      minDaysRemaining: minDays !== null ? Math.max(0, minDays - countedDays) : null,
      consistency: cons,
      binding: pressures.length ? pressures[0] : null,
      pressures: pressures,
      breaches: breaches,
      breached: breaches.length > 0,
      days: days,
      trades: st.length,
      steps: walk.steps
    };
  }

  // ---- sizing --------------------------------------------------------------

  // What can be risked right now without putting a rule in reach. riskPerUnit
  // is the money lost per contract/lot if the planned stop is hit.
  //
  // Returns whole units, always rounded DOWN. A sizer that rounds up to a
  // number that breaches is worse than no sizer.
  function sizeFor(state, riskPerUnit, opts) {
    const o = opts || {};
    const risk = num(riskPerUnit);
    if (risk === null || risk <= 0) return null;

    // A buffer keeps the answer off the exact edge, where commissions, slippage
    // and a gapped stop live. Default 20% of the binding allowance.
    const buffer = o.buffer === undefined ? 0.2 : Math.max(0, Math.min(0.9, o.buffer));
    const caps = [];
    if (state.dailyHeadroom !== null) caps.push({ rule: 'dailyLoss', room: state.dailyHeadroom });
    if (state.ddHeadroom !== null) caps.push({ rule: 'maxDrawdown', room: state.ddHeadroom });
    if (!caps.length) return null;

    const tight = caps.reduce((a, c) => (c.room < a.room ? c : a), caps[0]);
    const usable = tight.room * (1 - buffer);
    const units = Math.max(0, Math.floor(usable / risk));

    return {
      units: units,
      limitedBy: tight.rule,
      room: tight.room,
      usable: usable,
      riskPerUnit: risk,
      buffer: buffer,
      // The question people should ask and usually do not.
      lossesToBreach: (n) => {
        const size = num(n);
        if (size === null || size <= 0) return null;
        return Math.floor(tight.room / (size * risk));
      }
    };
  }

  // ---- presets -------------------------------------------------------------

  // DELIBERATELY NO PERCENTAGES.
  //
  // Prop firms change their limits often, and a hardcoded "5% daily" that has
  // since moved would be a number someone trusts while blowing a real account.
  // So a preset sets the rule SHAPE — which drawdown type, what the daily limit
  // is measured against, whether the floor locks — because that is the part
  // traders actually get wrong and the part that rarely changes. The
  // percentages come off the user's own dashboard in ten seconds and are the
  // part that must never be guessed on their behalf.
  const PRESETS = [
    { id: 'static-2step', label: 'Two-step evaluation, static drawdown',
      note: 'Most FX-style evaluations. The floor never moves, so profit is yours to give back.',
      rules: { ddType: 'static', lockAtStart: false, dailyBasis: 'prevClose',
               resetHour: 0, resetTz: 'UTC' } },
    { id: 'trail-closed', label: 'Trailing drawdown on closed balance',
      note: 'The floor rises with every new closed equity high and never falls again.',
      rules: { ddType: 'trailingClosed', lockAtStart: false, dailyBasis: 'prevClose',
               resetHour: 17, resetTz: 'America/New_York' } },
    { id: 'trail-intraday', label: 'Trailing drawdown on intraday equity',
      note: 'The harshest. Unrealised profit raises the floor permanently, even if you give it back.',
      rules: { ddType: 'trailingIntraday', lockAtStart: false, dailyBasis: 'prevClose',
               resetHour: 17, resetTz: 'America/New_York' } },
    { id: 'trail-lock', label: 'Trailing until breakeven, then locked',
      note: 'Trails up to the starting balance and stops there. Common on funded futures accounts.',
      rules: { ddType: 'trailingIntraday', lockAtStart: true, dailyBasis: 'prevClose',
               resetHour: 17, resetTz: 'America/New_York' } },
    { id: 'no-daily', label: 'No daily loss limit, drawdown only',
      note: 'Some instant-funding accounts. One rule to watch, and it is the unforgiving one.',
      rules: { ddType: 'trailingClosed', lockAtStart: false, dailyBasis: 'prevClose',
               resetHour: 17, resetTz: 'America/New_York' } }
  ];

  function defaultRules() {
    return { ddType: 'static', ddPct: null, dailyPct: null, targetPct: null,
             lockAtStart: false, dailyBasis: 'prevClose', resetHour: 0, resetTz: 'UTC',
             minDays: null, minDayPnl: null, consistencyPct: null,
             // news blackout
             newsBeforeMin: null, newsAfterMin: null, newsImpact: 'high',
             journalTz: null, journalTzConfirmed: false,
             // payout and scaling
             profitSplitPct: null, payoutFloorBehaviour: null, payoutMinProfitPct: null,
             payoutMinDays: null, payoutCycleDays: null, payoutMaxPct: null,
             scaleAtProfitPct: null, scaleNewSize: null,
             confirmed: false };
  }

  // A rule set is only usable once the person has confirmed the numbers came
  // off their own dashboard. Anything less and the engine should say so
  // instead of computing a headroom nobody should act on.
  function isConfigured(rules) {
    if (!rules) return false;
    const hasLimit = (num(rules.ddPct) > 0 || num(rules.ddAmount) > 0);
    return !!(hasLimit && rules.confirmed);
  }

  root.propfirmRules = {
    DD_TYPES: DD_TYPES,
    DAILY_BASIS: DAILY_BASIS,
    PRESETS: PRESETS,
    defaultRules: defaultRules,
    isConfigured: isConfigured,
    sessionDay: sessionDay,
    sessionTrades: sessionTrades,
    dailyPnl: dailyPnl,
    floorWalk: floorWalk,
    ddAmount: ddAmount,
    dailyAmount: dailyAmount,
    targetAmount: targetAmount,
    consistency: consistency,
    evaluate: evaluate,
    sizeFor: sizeFor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.propfirmRules;
})(typeof window !== 'undefined' ? window : globalThis);
