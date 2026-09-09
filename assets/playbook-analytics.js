// Stryker Trading Academy — Playbook analytics (pure, no DOM, no Firebase)
//
// WHAT THIS IS FOR
//
// The academy teaches six models with explicit rule steps. The journal records
// what a student actually did. Until now nothing joined the two, so nobody
// could answer the only question that matters: does this model work for ME,
// and which rule am I skipping when it doesn't?
//
// Every function here takes plain trade objects (the journal's own shape) and
// returns plain numbers. That keeps it unit-testable in node, and it means the
// same maths can run over backtest trades later without touching this file.
//
// A NOTE ON HONESTY
//
// It is very easy to build a feature like this that lies. Split forty trades
// six ways and every bucket looks like a signal. So every comparative number
// here carries its sample size, and anything computed from fewer than
// MIN_SAMPLE trades on either side of a comparison is returned as null with a
// `need` count instead of a confident-looking percentage. A student is better
// served by "log 6 more trades to find out" than by a decisive number built on
// four coin flips.

(function (root) {
  'use strict';

  // Below this, a comparison is noise. Chosen to be small enough to be
  // reachable in a few weeks of journalling and large enough that one outlier
  // cannot flip the sign.
  var MIN_SAMPLE = 8;
  // A per-side minimum for two-way splits (rule met vs rule broken). Lower
  // than MIN_SAMPLE because both sides together still have to clear it.
  var MIN_SIDE = 4;

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }

  function isClosed(t) {
    return t && num(t.pnl) !== null;
  }

  // ---- core stats -------------------------------------------------------

  // The single stat block everything else is built from. Currency P&L and
  // R-multiples are tracked separately: R is comparable across instruments and
  // account sizes, currency is what pays the bills, and a playbook can be
  // great at one and poor at the other.
  function stats(trades) {
    var closed = (trades || []).filter(isClosed);
    var n = closed.length;
    var wins = [], losses = [], rs = [];
    var net = 0, grossWin = 0, grossLoss = 0;

    for (var i = 0; i < n; i++) {
      var pnl = num(closed[i].pnl) || 0;
      net += pnl;
      if (pnl > 0) { wins.push(pnl); grossWin += pnl; }
      else if (pnl < 0) { losses.push(-pnl); grossLoss += -pnl; }
      var r = num(closed[i].rMultiple);
      if (r !== null) rs.push(r);
    }

    var winRate = n ? (wins.length / n) * 100 : 0;
    var avgWin = wins.length ? grossWin / wins.length : 0;
    var avgLoss = losses.length ? grossLoss / losses.length : 0;

    // Expectancy in currency per trade. Uses the realised averages rather than
    // a planned R, because what a student actually banks is the point.
    var expectancy = n ? net / n : 0;
    var avgR = rs.length ? rs.reduce(function (a, b) { return a + b; }, 0) / rs.length : null;

    return {
      n: n,
      net: net,
      wins: wins.length,
      losses: losses.length,
      breakEven: n - wins.length - losses.length,
      winRate: winRate,
      avgWin: avgWin,
      avgLoss: avgLoss,
      grossWin: grossWin,
      grossLoss: grossLoss,
      // Infinity is not useful in a UI; a playbook with no losses yet reports
      // null and the caller shows "no losses yet".
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
      expectancy: expectancy,
      avgR: avgR,
      rSamples: rs.length
    };
  }

  // Peak-to-trough on the running P&L, in the order the trades were taken.
  function drawdown(trades) {
    var closed = sortByTime((trades || []).filter(isClosed));
    var run = 0, peak = 0, maxDd = 0, curDd = 0;
    var curve = [];
    for (var i = 0; i < closed.length; i++) {
      run += num(closed[i].pnl) || 0;
      if (run > peak) peak = run;
      curDd = peak - run;
      if (curDd > maxDd) maxDd = curDd;
      curve.push(run);
    }
    return { maxDrawdown: maxDd, currentDrawdown: curDd, curve: curve, final: run };
  }

  function tradeTime(t) {
    return String((t && t.date) || '') + 'T' + String((t && t.time) || '00:00');
  }

  function sortByTime(trades) {
    return (trades || []).slice().sort(function (a, b) {
      return tradeTime(a).localeCompare(tradeTime(b));
    });
  }

  // ---- rule adherence ---------------------------------------------------

  // A trade's rulesMet is an array of rule ids ticked when it was logged.
  // Absent (an older trade, or one logged before the playbook had rules) means
  // "not graded" — which is different from "no rules met" and must never be
  // counted as a broken rule.
  function isGraded(trade) {
    return !!(trade && Array.isArray(trade.rulesMet));
  }

  function metRule(trade, ruleId) {
    return isGraded(trade) && trade.rulesMet.indexOf(ruleId) !== -1;
  }

  function followedAll(trade, rules) {
    if (!isGraded(trade) || !rules || !rules.length) return false;
    for (var i = 0; i < rules.length; i++) {
      if (!metRule(trade, rules[i].id)) return false;
    }
    return true;
  }

  // What share of graded trades followed the whole checklist.
  function adherence(trades, rules) {
    var graded = (trades || []).filter(function (t) { return isGraded(t) && isClosed(t); });
    if (!graded.length || !rules || !rules.length) {
      return { graded: 0, clean: 0, pct: null };
    }
    var clean = graded.filter(function (t) { return followedAll(t, rules); }).length;
    return { graded: graded.length, clean: clean, pct: (clean / graded.length) * 100 };
  }

  // THE headline comparison: what happens when the plan is followed versus
  // when it is not. Returns null-ish with a `need` count rather than a
  // misleading number when either side is too thin.
  function disciplineSplit(trades, rules) {
    var graded = (trades || []).filter(function (t) { return isGraded(t) && isClosed(t); });
    var clean = [], broken = [];
    for (var i = 0; i < graded.length; i++) {
      (followedAll(graded[i], rules) ? clean : broken).push(graded[i]);
    }
    var a = stats(clean), b = stats(broken);
    var enough = a.n >= MIN_SIDE && b.n >= MIN_SIDE && (a.n + b.n) >= MIN_SAMPLE;
    return {
      followed: a,
      broken: b,
      enough: enough,
      // How many more graded trades are needed before this is worth reading.
      need: enough ? 0 : Math.max(
        MIN_SIDE - a.n, MIN_SIDE - b.n, MIN_SAMPLE - (a.n + b.n), 0
      ),
      winRateDelta: enough ? a.winRate - b.winRate : null,
      expectancyDelta: enough ? a.expectancy - b.expectancy : null
    };
  }

  // Per-rule impact. For each rule, split the graded trades on whether that one
  // rule was met and compare. The rules that matter show a large, well-sampled
  // gap; the rest are noise and are labelled as such.
  function ruleImpact(trades, rules) {
    var graded = (trades || []).filter(function (t) { return isGraded(t) && isClosed(t); });
    return (rules || []).map(function (rule) {
      var met = [], missed = [];
      for (var i = 0; i < graded.length; i++) {
        (metRule(graded[i], rule.id) ? met : missed).push(graded[i]);
      }
      var a = stats(met), b = stats(missed);
      var enough = a.n >= MIN_SIDE && b.n >= MIN_SIDE;
      return {
        id: rule.id,
        text: rule.text,
        met: a,
        missed: b,
        enough: enough,
        need: enough ? 0 : Math.max(MIN_SIDE - a.n, MIN_SIDE - b.n),
        // How often this rule is skipped — useful even without enough data
        // for an impact number.
        skipRate: graded.length ? (b.n / graded.length) * 100 : null,
        winRateDelta: enough ? a.winRate - b.winRate : null,
        expectancyDelta: enough ? a.expectancy - b.expectancy : null
      };
    });
  }

  // The one rule costing the most money, if any is clearly worse than the
  // rest. Returns null when nothing is separable yet — which is the honest
  // answer most of the time early on.
  function costliestRule(trades, rules) {
    var impacts = ruleImpact(trades, rules).filter(function (r) {
      return r.enough && r.expectancyDelta !== null && r.expectancyDelta > 0;
    });
    if (!impacts.length) return null;
    impacts.sort(function (x, y) { return y.expectancyDelta - x.expectancyDelta; });
    return impacts[0];
  }

  // ---- breakdowns -------------------------------------------------------

  function group(trades, keyFn) {
    var map = {};
    (trades || []).filter(isClosed).forEach(function (t) {
      var k = keyFn(t);
      if (k === null || k === undefined || k === '') k = '—';
      k = String(k);
      (map[k] = map[k] || []).push(t);
    });
    return Object.keys(map).map(function (k) {
      return Object.assign({ key: k, trades: map[k] }, stats(map[k]));
    });
  }

  function hourOf(t) {
    var m = /^(\d{1,2}):/.exec(String((t && t.time) || ''));
    return m ? parseInt(m[1], 10) : null;
  }

  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function weekdayOf(t) {
    var d = new Date(String((t && t.date) || '') + 'T12:00:00');
    return isNaN(d.getTime()) ? null : WEEKDAYS[d.getDay()];
  }

  function breakdowns(trades) {
    return {
      bySession: group(trades, function (t) { return t.session; }),
      byHour: group(trades, hourOf),
      byWeekday: group(trades, weekdayOf),
      byDirection: group(trades, function (t) { return t.direction; }),
      byInstrument: group(trades, function (t) { return t.instrument; })
    };
  }

  // The best-performing bucket in a breakdown, but only when it has enough
  // trades to mean anything and actually beats the playbook average.
  function bestBucket(buckets, overallExpectancy) {
    var eligible = (buckets || []).filter(function (b) { return b.n >= MIN_SIDE; });
    if (!eligible.length) return null;
    eligible.sort(function (a, b) { return b.expectancy - a.expectancy; });
    var top = eligible[0];
    if (eligible.length < 2) return null;                    // nothing to compare against
    if (top.expectancy <= overallExpectancy) return null;    // not actually better
    return top;
  }

  function worstBucket(buckets, overallExpectancy) {
    var eligible = (buckets || []).filter(function (b) { return b.n >= MIN_SIDE; });
    if (eligible.length < 2) return null;
    eligible.sort(function (a, b) { return a.expectancy - b.expectancy; });
    var bottom = eligible[0];
    if (bottom.expectancy >= overallExpectancy) return null;
    return bottom;
  }

  // ---- the full report for one playbook ---------------------------------

  function report(playbook, trades) {
    var rules = (playbook && playbook.rules) || [];
    var s = stats(trades);
    var b = breakdowns(trades);
    return {
      playbookId: playbook && playbook.id,
      stats: s,
      drawdown: drawdown(trades),
      adherence: adherence(trades, rules),
      discipline: disciplineSplit(trades, rules),
      rules: ruleImpact(trades, rules),
      costliest: costliestRule(trades, rules),
      breakdowns: b,
      bestSession: bestBucket(b.bySession, s.expectancy),
      worstSession: worstBucket(b.bySession, s.expectancy),
      bestWeekday: bestBucket(b.byWeekday, s.expectancy),
      bestHour: bestBucket(b.byHour, s.expectancy),
      // Enough data to draw conclusions at all?
      mature: s.n >= MIN_SAMPLE
    };
  }

  // Rank playbooks against each other. Only those with a real sample compete;
  // the rest are listed as "still gathering data" rather than sorted into a
  // misleading order.
  function compare(playbooks, tradesByPlaybook) {
    var rows = (playbooks || []).map(function (p) {
      var t = (tradesByPlaybook && tradesByPlaybook[p.id]) || [];
      var s = stats(t);
      return {
        playbook: p,
        stats: s,
        adherence: adherence(t, p.rules || []),
        mature: s.n >= MIN_SAMPLE
      };
    });
    var mature = rows.filter(function (r) { return r.mature; })
      .sort(function (a, b) { return b.stats.expectancy - a.stats.expectancy; });
    var young = rows.filter(function (r) { return !r.mature; })
      .sort(function (a, b) { return b.stats.n - a.stats.n; });
    return { ranked: mature, gathering: young, all: rows };
  }

  root.PlaybookAnalytics = {
    MIN_SAMPLE: MIN_SAMPLE,
    MIN_SIDE: MIN_SIDE,
    stats: stats,
    drawdown: drawdown,
    adherence: adherence,
    disciplineSplit: disciplineSplit,
    ruleImpact: ruleImpact,
    costliestRule: costliestRule,
    breakdowns: breakdowns,
    bestBucket: bestBucket,
    worstBucket: worstBucket,
    report: report,
    compare: compare,
    group: group,
    sortByTime: sortByTime,
    isGraded: isGraded,
    followedAll: followedAll,
    WEEKDAYS: WEEKDAYS
  };
})(typeof window !== 'undefined' ? window : globalThis);
