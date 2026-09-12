// Stryker Trading Academy — payout and scaling planner
//
// Pure. Turns the bookkeeping tab from a record of the past into a forward
// plan: when a payout can be requested, how much can safely be taken, and what
// the account looks like the moment after it lands.
//
// THE TRAP THIS EXISTS FOR
//
// A withdrawal reduces the account balance. On most trailing-drawdown accounts
// the FLOOR DOES NOT COME DOWN WITH IT. Someone sitting $8,000 above their
// floor who withdraws $8,000 is not left comfortable — they are left at the
// floor, and the next losing trade ends the account. A few firms lower the
// floor by the withdrawn amount; most do not, and the difference is the single
// most expensive thing a funded trader can be wrong about.
//
// So `payoutFloorBehaviour` is a required choice, not a default, and the
// planner shows the after-withdrawal headroom next to the before.
//
// WHAT IT WILL NOT DO
//
// It does not know any firm's payout schedule. Cycle length, minimum profit,
// minimum days and the split are all entered by the member from their own
// agreement, and nothing computes until they are. Same rule as the rest of
// this feature set: the arithmetic is ours, the numbers are theirs.

(function (root) {
  'use strict';

  function num(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }

  const DAY = 86400000;

  function lastPayoutMs(firm) {
    const ps = (firm && firm.payouts) || [];
    let best = null;
    ps.forEach((p) => {
      const t = Date.parse(String(p.date || '') + 'T12:00:00Z');
      if (isFinite(t) && (best === null || t > best)) best = t;
    });
    return best;
  }

  function totals(firm) {
    const spent = ((firm && firm.expenses) || [])
      .reduce((s, e) => s + (num(e.amount) || 0), 0);
    const received = ((firm && firm.payouts) || [])
      .reduce((s, p) => s + (num(p.amount) || 0), 0);
    return { spent: spent, received: received, net: received - spent };
  }

  // ---- eligibility ---------------------------------------------------------

  // Every unmet condition is returned, not just the first. A member told only
  // "you need more profit" will hit the day requirement next and feel lied to.
  function eligibility(firm, state, opts) {
    const o = opts || {};
    const rules = (firm && firm.rules) || {};
    const now = o.now || Date.now();
    const start = state ? state.start : 0;

    const minProfit = num(rules.payoutMinProfitPct) !== null && start > 0
      ? start * (num(rules.payoutMinProfitPct) / 100)
      : num(rules.payoutMinProfit);
    const minDays = num(rules.payoutMinDays);
    const cycle = num(rules.payoutCycleDays);

    const blockers = [];
    const profit = state ? state.profit : 0;

    if (minProfit !== null && minProfit > 0 && profit < minProfit) {
      blockers.push({ rule: 'minProfit', need: minProfit - profit,
                      label: 'Profit below the payout minimum' });
    }
    if (minDays !== null && minDays > 0) {
      const traded = state ? state.daysTraded : 0;
      if (traded < minDays) {
        blockers.push({ rule: 'minDays', need: minDays - traded,
                        label: 'Not enough trading days yet' });
      }
    }
    let nextCycleAt = null;
    if (cycle !== null && cycle > 0) {
      const last = lastPayoutMs(firm);
      // With no payout history the cycle is measured from the account's start
      // date if there is one. Assuming "eligible now" would be optimistic in
      // exactly the situation where the member most wants a real answer.
      const anchor = last !== null ? last
        : (firm && firm.startedAt ? Date.parse(firm.startedAt + 'T12:00:00Z') : null);
      if (anchor !== null && isFinite(anchor)) {
        nextCycleAt = anchor + cycle * DAY;
        if (now < nextCycleAt) {
          blockers.push({ rule: 'cycle', need: Math.ceil((nextCycleAt - now) / DAY),
                          label: last !== null ? 'Too soon since the last payout'
                                               : 'Too soon since the account started' });
        }
      }
    }

    // The consistency cap is a payout condition, not a trading one — this is
    // where people are blindsided, having passed everything else.
    const cons = state && state.consistency;
    if (cons && cons.ok === false) {
      blockers.push({ rule: 'consistency', need: cons.needMoreProfit,
                      label: 'Consistency cap not satisfied' });
    }

    return {
      eligible: blockers.length === 0,
      blockers: blockers,
      nextCycleAt: nextCycleAt,
      lastPayoutAt: lastPayoutMs(firm),
      minProfit: minProfit,
      cycleDays: cycle
    };
  }

  // ---- the withdrawal itself -----------------------------------------------

  // What the account looks like the moment after a withdrawal of `gross`.
  // The floor behaviour is the whole point: with 'stays', every pound taken
  // out is a pound of headroom gone.
  function impact(firm, state, gross) {
    const rules = (firm && firm.rules) || {};
    const g = num(gross);
    if (g === null || g < 0 || !state) return null;
    const stays = rules.payoutFloorBehaviour !== 'reduces';
    const split = num(rules.profitSplitPct);

    const balanceAfter = state.balance - g;
    const floorAfter = stays ? state.floor : state.floor - g;
    const headroomAfter = balanceAfter - floorAfter;

    return {
      gross: g,
      // What actually reaches the member's bank. The account loses the gross.
      received: split !== null ? g * (split / 100) : null,
      split: split,
      floorStays: stays,
      balanceBefore: state.balance, balanceAfter: balanceAfter,
      floorBefore: state.floor, floorAfter: floorAfter,
      headroomBefore: state.ddHeadroom, headroomAfter: headroomAfter,
      // A withdrawal that lands the account at or under its own floor is not a
      // payout, it is a failed account with a bank transfer attached.
      breaches: headroomAfter <= 0,
      ddAmount: state.ddAmount
    };
  }

  // The largest withdrawal that still leaves `buffer` of the drawdown
  // allowance intact. Rounded DOWN to whole currency, for the same reason the
  // position sizer rounds down.
  function maxSafe(firm, state, opts) {
    const o = opts || {};
    if (!state) return null;
    const rules = (firm && firm.rules) || {};
    const stays = rules.payoutFloorBehaviour !== 'reduces';
    const buffer = o.buffer === undefined ? 0.25 : Math.max(0, Math.min(0.95, o.buffer));

    // With a floor that follows the balance down, headroom is untouched and
    // the only ceiling is the profit actually made.
    let cap = stays
      ? state.ddHeadroom - (state.ddAmount * buffer)
      : Math.max(0, state.profit);

    // You cannot withdraw more than the account has made, whatever the floor does.
    cap = Math.min(cap, Math.max(0, state.profit));

    const capPct = num(rules.payoutMaxPct);
    if (capPct !== null && capPct > 0 && state.start > 0) {
      cap = Math.min(cap, state.start * (capPct / 100));
    }
    return Math.max(0, Math.floor(cap));
  }

  // ---- scaling -------------------------------------------------------------

  function scaling(firm, state) {
    const rules = (firm && firm.rules) || {};
    const atPct = num(rules.scaleAtProfitPct);
    const newSize = num(rules.scaleNewSize);
    if (atPct === null || atPct <= 0 || !state || !state.start) return null;
    const target = state.start * (atPct / 100);
    return {
      targetProfit: target,
      remaining: Math.max(0, target - state.profit),
      reached: state.profit >= target,
      newSize: newSize,
      progress: target > 0 ? Math.max(0, Math.min(1, state.profit / target)) : 0
    };
  }

  // ---- the whole picture ---------------------------------------------------

  function plan(firm, state, opts) {
    if (!firm || !state) return null;
    const o = opts || {};
    const t = totals(firm);
    const elig = eligibility(firm, state, o);
    const safe = maxSafe(firm, state, o);
    const split = num((firm.rules || {}).profitSplitPct);

    return {
      totals: t,
      eligibility: elig,
      maxSafe: safe,
      maxSafeReceived: split !== null && safe !== null ? safe * (split / 100) : null,
      impact: safe !== null ? impact(firm, state, safe) : null,
      scaling: scaling(firm, state),
      // The number that answers "has this account been worth it" — fees paid
      // against money actually received, plus what is still sitting in it.
      unrealised: state.profit,
      trueNet: t.received - t.spent
    };
  }

  function isConfigured(rules) {
    if (!rules) return false;
    return num(rules.profitSplitPct) !== null && !!rules.payoutFloorBehaviour;
  }

  root.propfirmPayout = {
    totals: totals,
    lastPayoutMs: lastPayoutMs,
    eligibility: eligibility,
    impact: impact,
    maxSafe: maxSafe,
    scaling: scaling,
    plan: plan,
    isConfigured: isConfigured
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.propfirmPayout;
})(typeof window !== 'undefined' ? window : globalThis);
