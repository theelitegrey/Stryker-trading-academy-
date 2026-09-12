// Stryker Trading Academy — prop firm challenge simulator
//
// Pure. Node-testable, seeded, deterministic. Answers one question with the
// member's OWN numbers: what are the odds this account survives to a payout,
// and what position size makes those odds best?
//
// WHY BOOTSTRAP RESAMPLING AND NOT A FITTED DISTRIBUTION
//
// Drawing outcomes from the member's actual R-multiples preserves the shape of
// their results — the fat left tail, the one outlier win that carries the
// month, the real win rate. Fitting a normal or lognormal to it would smooth
// exactly the features that decide whether a drawdown rule gets hit, and would
// flatter almost everyone.
//
// WHAT THIS DELIBERATELY CANNOT DO
//
// Resampling assumes trades are independent. Real trading is not: losses
// cluster, people size up to make it back, and a bad morning becomes a bad
// week. Clustering makes drawdown breaches MORE likely than independent draws
// suggest, so every number here is an optimistic bound. The UI says so. A
// simulator that quietly overstates someone's odds of passing is worse than no
// simulator, because they will size up on it.
//
// A SIMULATION IS NOT A FORECAST
//
// It reports what this edge, at this size, did across thousands of replays of
// the past. It says nothing about whether the edge still works.

(function (root) {
  'use strict';

  // Enough trades that a resampled distribution means something. Below this
  // the honest output is a refusal and a count, not a confident percentage —
  // same rule the playbook analytics already follows.
  const MIN_TRADES = 30;
  const MIN_DAYS = 8;

  function num(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }

  // Seeded so a run is reproducible: the same inputs must give the same
  // answer twice, or nobody can check the tool and the tests cannot pin it.
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- the profile ---------------------------------------------------------

  // Pulls the member's own R distribution and trades-per-day shape out of
  // their journal. Returns a `need` count instead of a profile when there is
  // not enough to resample honestly.
  function profileFrom(trades, opts) {
    const o = opts || {};
    const account = o.account || null;
    const rules = o.rules || {};
    const resetHour = num(rules.resetHour) || 0;
    const tz = rules.resetTz || 'UTC';
    const day = (root.propfirmRules && root.propfirmRules.sessionDay) || null;

    const mine = (trades || []).filter((t) =>
      t && num(t.pnl) !== null && (!account || (t.account || '') === account));

    const withR = [];
    const byDay = {};
    mine.forEach((t) => {
      const r = num(t.rMultiple);
      const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(String(t.date || ''))
        ? t.date + 'T12:00:00' : (t.closedAt || t.date));
      const k = (day && isFinite(ms)) ? day(ms, resetHour, tz) : (t.date || 'x');
      byDay[k] = (byDay[k] || 0) + 1;
      // An R of exactly 0 is a scratch and is kept; null means no stop was
      // recorded, which is a different thing and must not be treated as zero.
      if (r !== null) withR.push(r);
    });

    const days = Object.keys(byDay);
    const perDay = days.map((k) => byDay[k]);

    if (withR.length < MIN_TRADES) {
      return {
        ok: false,
        reason: 'r',
        have: withR.length,
        need: MIN_TRADES - withR.length,
        closed: mine.length,
        // The actionable part: it is usually not that they have traded too
        // little, it is that the stop was never recorded so R cannot exist.
        missingStops: mine.length - withR.length
      };
    }
    if (days.length < MIN_DAYS) {
      return { ok: false, reason: 'days', have: days.length, need: MIN_DAYS - days.length,
               closed: mine.length, missingStops: mine.length - withR.length };
    }

    const wins = withR.filter((r) => r > 0).length;
    const sum = withR.reduce((s, r) => s + r, 0);
    return {
      ok: true,
      rSamples: withR,
      tradesPerDay: perDay,
      trades: withR.length,
      days: days.length,
      winRate: (wins / withR.length) * 100,
      avgR: sum / withR.length,
      expectancy: sum / withR.length,
      missingStops: mine.length - withR.length
    };
  }

  // ---- one run -------------------------------------------------------------

  // Replays a whole evaluation once and reports how it ended. The rule checks
  // here mirror assets/propfirm-rules.js deliberately — same floor behaviour,
  // same daily reset, same consistency test — and the test suite compares the
  // two implementations against each other so they cannot drift apart.
  function runOnce(profile, cfg, rand) {
    const start = cfg.start;
    const riskAmt = start * (cfg.riskPct / 100);
    const ddAmt = cfg.ddAmount;
    const dailyAmt = cfg.dailyAmount;
    const targetAmt = cfg.targetAmount;
    const trailing = cfg.ddType === 'trailingClosed' || cfg.ddType === 'trailingIntraday';
    const rs = profile.rSamples, rn = rs.length;
    const pd = profile.tradesPerDay, pn = pd.length;

    let bal = start, peak = start, floor = start - ddAmt;
    let daysTraded = 0, bestDay = 0;

    for (let d = 1; d <= cfg.maxDays; d++) {
      const n = pd[(rand() * pn) | 0];
      let dayPnl = 0;

      for (let i = 0; i < n; i++) {
        const pnl = rs[(rand() * rn) | 0] * riskAmt;
        bal += pnl;
        dayPnl += pnl;
        if (bal > peak) peak = bal;
        if (trailing) {
          floor = peak - ddAmt;
          if (cfg.lockAtStart && floor > start) floor = start;
        }
        // Checked per trade, not per day: a trailing floor can be breached
        // mid-session and the account is gone at that moment, not at the close.
        if (ddAmt > 0 && bal < floor - 1e-9) return { end: 'breach', rule: 'maxDrawdown', day: d };
      }

      if (n > 0) daysTraded++;
      if (dayPnl > bestDay) bestDay = dayPnl;
      if (dailyAmt > 0 && dayPnl < -dailyAmt - 1e-9) return { end: 'breach', rule: 'dailyLoss', day: d };

      const profit = bal - start;
      if (targetAmt > 0 && profit >= targetAmt && daysTraded >= cfg.minDays) {
        // Hitting the target is not passing. A consistency cap can hold the
        // payout back until more profit is made on other days, and people who
        // do not model that are surprised by it at exactly the worst moment.
        const consOk = cfg.consistencyPct === null || profit <= 0
          || (bestDay / profit) * 100 <= cfg.consistencyPct + 1e-9;
        if (consOk) return { end: 'pass', day: d, profit: profit, days: daysTraded };
      }
    }
    return { end: 'timeout', day: cfg.maxDays, profit: bal - start, days: daysTraded };
  }

  // ---- the study -----------------------------------------------------------

  function median(arr) {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Turns a firm record into the flat numbers the hot loop needs, using the
  // rule engine's own amount helpers so a percentage is never interpreted two
  // different ways in two different files.
  function cfgFrom(firm, riskPct, opts) {
    const o = opts || {};
    const rules = (firm && firm.rules) || {};
    const start = num(firm && (firm.startBalance || firm.accountSize)) || 0;
    const PR = root.propfirmRules;
    return {
      start: start,
      riskPct: riskPct,
      ddType: rules.ddType || 'static',
      lockAtStart: !!rules.lockAtStart,
      ddAmount: PR ? PR.ddAmount(start, rules) : 0,
      dailyAmount: PR ? PR.dailyAmount(start, rules) : 0,
      targetAmount: PR ? PR.targetAmount(start, rules) : 0,
      minDays: num(rules.minDays) || 0,
      consistencyPct: num(rules.consistencyPct),
      maxDays: num(o.maxDays) || 60
    };
  }

  function atRisk(profile, firm, riskPct, opts) {
    const o = opts || {};
    const cfg = cfgFrom(firm, riskPct, o);
    const iterations = o.iterations || 4000;
    // Common random numbers: every risk level is replayed against the SAME
    // random stream, so a difference between two levels is the sizing and not
    // sampling noise. Without this the sweep jitters and the "best" level
    // moves between runs on identical inputs.
    const rand = rng(o.seed || 20260912);

    let pass = 0, breach = 0, timeout = 0;
    const byRule = { maxDrawdown: 0, dailyLoss: 0 };
    const passDays = [], endProfit = [];

    for (let i = 0; i < iterations; i++) {
      const r = runOnce(profile, cfg, rand);
      if (r.end === 'pass') { pass++; passDays.push(r.day); }
      else if (r.end === 'breach') { breach++; byRule[r.rule] = (byRule[r.rule] || 0) + 1; }
      else { timeout++; endProfit.push(r.profit); }
    }

    const funded = !(cfg.targetAmount > 0);
    return {
      riskPct: riskPct,
      iterations: iterations,
      // On a funded account there is no target to hit, so surviving the
      // horizon IS the good outcome. Counting it as a timeout would report a
      // 0% success rate on an account that never came close to a breach.
      passRate: funded ? (timeout / iterations) * 100 : (pass / iterations) * 100,
      breachRate: (breach / iterations) * 100,
      timeoutRate: funded ? 0 : (timeout / iterations) * 100,
      byRule: byRule,
      medianDaysToPass: median(passDays),
      medianEndProfit: median(endProfit),
      funded: funded,
      riskAmount: cfg.start * (riskPct / 100)
    };
  }

  // Sweeps a range of position sizes and reports which one gives the best odds.
  // The answer is rarely the smallest: risk too little and the horizon runs out
  // before the target is reached, which is its own kind of failure.
  function study(profile, firm, opts) {
    const o = opts || {};
    if (!profile || !profile.ok) return { ok: false, profile: profile };

    const PR = root.propfirmRules;
    if (!PR || !PR.isConfigured((firm || {}).rules)) return { ok: false, reason: 'rules' };

    const risks = o.risks || [0.1, 0.15, 0.25, 0.5, 0.75, 1, 1.5, 2];
    const results = risks.map((r) => atRisk(profile, firm, r, o));
    const best = results.reduce((a, b) => (b.passRate > a.passRate ? b : a), results[0]);

    const killer = results.reduce((acc, r) => {
      Object.keys(r.byRule).forEach((k) => { acc[k] = (acc[k] || 0) + r.byRule[k]; });
      return acc;
    }, {});
    const killerRule = Object.keys(killer).sort((a, b) => killer[b] - killer[a])[0] || null;

    return {
      ok: true,
      results: results,
      best: best,
      funded: results[0].funded,
      killerRule: killer[killerRule] > 0 ? killerRule : null,
      maxDays: (o.maxDays || 60),
      iterations: results[0].iterations,
      profile: profile
    };
  }

  root.propfirmSim = {
    MIN_TRADES: MIN_TRADES,
    MIN_DAYS: MIN_DAYS,
    rng: rng,
    profileFrom: profileFrom,
    cfgFrom: cfgFrom,
    runOnce: runOnce,
    atRisk: atRisk,
    study: study,
    median: median
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.propfirmSim;
})(typeof window !== 'undefined' ? window : globalThis);
