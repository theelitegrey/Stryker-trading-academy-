// Stryker Trading Academy — Trade Journal: AI Coach
// Depends on: assets/journal-calc.js, Chart.js, journal-main.js globals,
// jCountUp from journal-propfirms.js.
//
// Everything here runs ON THE STUDENT'S DEVICE from their own journal — no
// trade ever leaves their account, no API, no keys. The intelligence is a
// battery of rule-based diagnostics that professional trading coaches
// actually run: expectancy, drawdown, edge by setup/session/day, early-exit
// detection, revenge-trading detection, overtrading, risk creep, fee drag.
// The page says exactly that; it never pretends to be a chatbot.

let JAI_CHART = null;
let JAI_TYPED = false;

// ---- helpers ----------------------------------------------------------------
function jaiEsc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function jaiMean(arr){ return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function jaiStd(arr){
  if (arr.length < 2) return 0;
  const m = jaiMean(arr);
  return Math.sqrt(jaiMean(arr.map((v) => (v - m) * (v - m))));
}
function jaiFmt(v, currency){ return journalFormatCurrency(v, currency); }

function jaiGroup(trades, keyFn){
  const g = {};
  trades.forEach((t) => {
    const k = keyFn(t);
    if (!k) return;
    (g[k] = g[k] || []).push(t);
  });
  return g;
}
function jaiGroupStats(groups, minTrades){
  return Object.keys(groups)
    .map((k) => {
      const list = groups[k];
      const wins = list.filter((t) => t.pnl > 0).length;
      return { key: k, n: list.length, pnl: list.reduce((s, t) => s + t.pnl, 0),
               winRate: (wins / list.length) * 100,
               expectancy: list.reduce((s, t) => s + t.pnl, 0) / list.length };
    })
    .filter((r) => r.n >= minTrades)
    .sort((a, b) => b.expectancy - a.expectancy);
}

// ---- the analysis engine ----------------------------------------------------
// Returns { score, verdict, summary, insights[], actions[], rBuckets } or
// { locked: n } when there isn't enough history to say anything honest.
function jaiAnalyse(trades, settings){
  const currency = (settings && settings.currency) || 'USD';
  const closed = trades
    .filter((t) => t.pnl !== null && t.pnl !== undefined && t.date)
    .sort((a, b) => ((a.date || '') + 'T' + (a.time || '00:00'))
      .localeCompare((b.date || '') + 'T' + (b.time || '00:00')));

  if (closed.length < 5) return { locked: closed.length };

  const insights = [];
  const actions = [];
  let score = 70;                      // discipline starts neutral, earns or loses

  const stats = journalAggregateStats(closed);
  const expectancy = stats.totalPnl / closed.length;

  // --- equity & drawdown
  let equity = 0, peak = 0, maxDD = 0;
  closed.forEach((t) => {
    equity += t.pnl;
    if (equity > peak) peak = equity;
    if (peak - equity > maxDD) maxDD = peak - equity;
  });
  const currentDD = peak - equity;

  // --- headline expectancy
  if (expectancy > 0) {
    score += 8;
    insights.push({ sev: 'good', title: 'You have a real edge',
      body: 'Expectancy is ' + jaiFmt(expectancy, currency) + ' per trade over ' + closed.length +
        ' closed trades (profit factor ' + (isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞') +
        '). Protect it — the rest of this report is about not giving it back.' });
  } else {
    score -= 10;
    insights.push({ sev: 'crit', title: 'Negative expectancy right now',
      body: 'You lose ' + jaiFmt(-expectancy, currency) + ' per trade on average across ' + closed.length +
        ' trades. Until this flips positive, size down: the goal is tuition, not profit.' });
    actions.push('Cut position size in half until your last 20 trades show positive expectancy.');
  }

  // --- drawdown
  if (maxDD > 0 && stats.grossWin > 0) {
    const ddSev = maxDD > stats.grossWin * 0.5 ? 'warn' : 'info';
    if (ddSev === 'warn') score -= 6;
    insights.push({ sev: ddSev, title: 'Deepest drawdown: ' + jaiFmt(maxDD, currency),
      body: currentDD > 0.01
        ? 'You are currently ' + jaiFmt(currentDD, currency) + ' below your equity peak. Drawdowns are where discipline is graded — smaller size, A+ setups only, until the curve makes a new high.'
        : 'You are trading at your equity high. This is exactly when overconfidence creeps in — keep size flat.' });
  }

  // --- winners vs losers in R
  const withR = closed.filter((t) => typeof t.rMultiple === 'number' && isFinite(t.rMultiple));
  if (withR.length >= 5) {
    const winR = withR.filter((t) => t.rMultiple > 0).map((t) => t.rMultiple);
    const lossR = withR.filter((t) => t.rMultiple < 0).map((t) => t.rMultiple);
    const avgWinR = jaiMean(winR), avgLossR = Math.abs(jaiMean(lossR));

    if (lossR.length && avgLossR > 1.35) {
      score -= 12;
      insights.push({ sev: 'crit', title: 'Losses are running past your stop',
        body: 'Your average loser is ' + avgLossR.toFixed(1) + 'R — losing more than the risk you planned. That means stops are being moved or ignored. A 1R loss is a business expense; a ' +
          avgLossR.toFixed(1) + 'R loss is a discipline failure.' });
      actions.push('Hard rule: the stop set at entry is never widened. Log any violation with the "Plan broken" tag.');
    } else if (lossR.length) {
      score += 6;
      insights.push({ sev: 'good', title: 'Stops are being respected',
        body: 'Average loser is ' + avgLossR.toFixed(2) + 'R — right where it should be. Losing exactly what you planned to lose is a professional habit.' });
    }

    // early-exit detection: planned R vs realized R on winners
    const winnersWithPlan = withR.filter((t) => t.rMultiple > 0 && typeof t.plannedRR === 'number' && t.plannedRR > 0.5);
    if (winnersWithPlan.length >= 3) {
      const realized = jaiMean(winnersWithPlan.map((t) => t.rMultiple));
      const planned = jaiMean(winnersWithPlan.map((t) => t.plannedRR));
      if (realized < planned * 0.6) {
        score -= 8;
        insights.push({ sev: 'warn', title: 'You cut winners early',
          body: 'You plan for ' + planned.toFixed(1) + 'R but bank ' + realized.toFixed(1) +
            'R on average — taking roughly ' + Math.round((realized / planned) * 100) +
            '% of what your own plan offers. Your losers are full-size; your winners are not. That asymmetry is where most edges die.' });
        actions.push('Take partials at 1R if you must, but leave a runner to your original target on every A+ setup.');
      }
    }
  }

  // --- best / worst dimensions
  const currencyFmt = (v) => jaiFmt(v, currency);
  const bySetup = jaiGroupStats(jaiGroup(closed, (t) => t.setup), 3);
  if (bySetup.length >= 2) {
    const best = bySetup[0], worst = bySetup[bySetup.length - 1];
    if (best.expectancy > 0) {
      insights.push({ sev: 'good', title: 'Best setup: ' + best.key,
        body: best.key + ' earns ' + currencyFmt(best.expectancy) + ' per trade over ' + best.n +
          ' trades at ' + Math.round(best.winRate) + '% win rate. This is your bread and butter — take more of these.' });
    }
    if (worst.expectancy < 0) {
      score -= 4;
      insights.push({ sev: 'warn', title: 'Worst setup: ' + worst.key,
        body: worst.key + ' costs you ' + currencyFmt(-worst.expectancy) + ' per trade over ' + worst.n +
          ' trades. Either it needs refinement in study, or it comes out of the live rotation.' });
      actions.push('Pause trading "' + worst.key + '" live; backtest it for a week instead.');
    }
  }
  const bySession = jaiGroupStats(jaiGroup(closed, (t) => t.session), 3);
  if (bySession.length >= 2) {
    const best = bySession[0], worst = bySession[bySession.length - 1];
    if (best.expectancy > 0 && worst.expectancy < 0) {
      insights.push({ sev: 'info', title: best.key + ' pays you; ' + worst.key + ' bills you',
        body: 'Session split: ' + best.key + ' at ' + currencyFmt(best.expectancy) + '/trade vs ' +
          worst.key + ' at ' + currencyFmt(worst.expectancy) + '/trade. Consider concentrating your trading window.' });
    }
  }
  const byDow = jaiGroupStats(jaiGroup(closed, (t) => {
    const d = new Date((t.date || '') + 'T00:00:00');
    return isNaN(d) ? null : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
  }), 3);
  if (byDow.length >= 2 && byDow[byDow.length - 1].expectancy < 0) {
    const worst = byDow[byDow.length - 1];
    insights.push({ sev: 'info', title: worst.key + 's are your leak',
      body: worst.key + ' runs ' + currencyFmt(worst.expectancy) + ' per trade across ' + worst.n +
        ' trades — the worst day on your calendar. Worth asking what is different about it.' });
  }

  // --- revenge trading: trades after 2 consecutive same-day losses
  let revengePnl = 0, revengeN = 0;
  const byDay = jaiGroup(closed, (t) => t.date);
  Object.keys(byDay).forEach((day) => {
    const list = byDay[day];
    let streak = 0;
    list.forEach((t) => {
      if (streak >= 2) { revengePnl += t.pnl; revengeN++; }
      streak = t.pnl < 0 ? streak + 1 : 0;
    });
  });
  if (revengeN >= 3) {
    if (revengePnl < 0) {
      score -= 12;
      insights.push({ sev: 'crit', title: 'The third trade after two losses is bleeding',
        body: 'Trades taken after two consecutive same-day losses: ' + revengeN + ', for ' +
          currencyFmt(revengePnl) + ' total. That is the revenge-trading fingerprint — the market took two, and the next click tries to take them back.' });
      actions.push('Two losses in a day = done for the day. Write it on the monitor.');
    } else {
      score += 4;
      insights.push({ sev: 'good', title: 'You stay composed after losses',
        body: 'Trades taken after two same-day losses are net ' + currencyFmt(revengePnl) + ' — no tilt signature in your data.' });
    }
  }

  // --- tag discipline
  const tagged = closed.filter((t) => Array.isArray(t.tags) && t.tags.length);
  if (tagged.length >= 5) {
    const broken = tagged.filter((t) => t.tags.indexOf('Plan broken') !== -1);
    const impulse = tagged.filter((t) => t.tags.indexOf('Revenge trade') !== -1 || t.tags.indexOf('FOMO') !== -1);
    if (broken.length / tagged.length > 0.2) {
      score -= 10;
      const cost = broken.reduce((s, t) => s + t.pnl, 0);
      insights.push({ sev: 'warn', title: 'One in ' + Math.round(tagged.length / broken.length) + ' trades breaks your own plan',
        body: 'Self-tagged "Plan broken" trades: ' + broken.length + ', worth ' + currencyFmt(cost) +
          '. You already know these are mistakes — the journal is just showing you the invoice.' });
    }
    if (impulse.length) {
      const cost = impulse.reduce((s, t) => s + t.pnl, 0);
      if (cost < 0) {
        score -= 6;
        insights.push({ sev: 'warn', title: 'Impulse trades cost ' + currencyFmt(-cost),
          body: impulse.length + ' trades tagged FOMO or Revenge, net ' + currencyFmt(cost) +
            '. Deleting just these from your history would have left the rest of your edge intact.' });
      }
    }
  }

  // --- overtrading
  const dayCounts = Object.keys(byDay).map((d) => byDay[d].length);
  if (dayCounts.length >= 5) {
    const median = dayCounts.slice().sort((a, b) => a - b)[Math.floor(dayCounts.length / 2)];
    const heavyThreshold = Math.max(4, median * 2);
    const heavyDays = Object.keys(byDay).filter((d) => byDay[d].length >= heavyThreshold);
    if (heavyDays.length) {
      const heavyPnl = heavyDays.reduce((s, d) => s + byDay[d].reduce((x, t) => x + t.pnl, 0), 0);
      if (heavyPnl < 0) {
        score -= 8;
        insights.push({ sev: 'warn', title: 'Heavy days hurt you',
          body: 'On days with ' + heavyThreshold + '+ trades (' + heavyDays.length + ' of them) you netted ' +
            currencyFmt(heavyPnl) + '. Your normal day is ~' + median + ' trades — beyond that, quality is clearly dropping.' });
        actions.push('Set a daily cap of ' + Math.max(2, median + 1) + ' trades. The cap is the edge.');
      }
    }
  }

  // --- risk consistency & creep
  const risks = closed.map((t) => t.riskPercent).filter((v) => typeof v === 'number' && isFinite(v) && v > 0);
  if (risks.length >= 8) {
    const sd = jaiStd(risks), mean = jaiMean(risks);
    if (mean > 0 && sd / mean > 0.6) {
      score -= 6;
      insights.push({ sev: 'warn', title: 'Position sizing is inconsistent',
        body: 'Risk per trade swings from ' + Math.min(...risks).toFixed(1) + '% to ' + Math.max(...risks).toFixed(1) +
          '% (average ' + mean.toFixed(1) + '%). Inconsistent risk means your results are decided by WHICH trades were big, not whether you traded well.' });
      actions.push('Fix risk at ' + ((settings && settings.defaultRiskPercent) || 1) + '% per trade for the next 20 trades — no exceptions.');
    } else {
      score += 6;
      insights.push({ sev: 'good', title: 'Sizing is consistent',
        body: 'Risk per trade holds near ' + mean.toFixed(1) + '% with low variance — your results reflect skill, not bet-size luck.' });
    }
    const recent = risks.slice(-8), earlier = risks.slice(0, -8);
    if (earlier.length >= 8 && jaiMean(recent) > jaiMean(earlier) * 1.5) {
      score -= 6;
      insights.push({ sev: 'warn', title: 'Risk is creeping up',
        body: 'Your last 8 trades risk ' + jaiMean(recent).toFixed(1) + '% on average vs ' + jaiMean(earlier).toFixed(1) +
          '% before. Size creep after a good run is how good months get given back in bad weeks.' });
    }
  }

  // --- fee drag
  const totalFees = closed.reduce((s, t) => s + (parseFloat(t.fees) || 0), 0);
  if (totalFees > 0 && stats.grossWin > 0 && totalFees > stats.grossWin * 0.15) {
    insights.push({ sev: 'info', title: 'Fees are eating ' + Math.round((totalFees / stats.grossWin) * 100) + '% of your gross wins',
      body: currencyFmt(totalFees) + ' paid in fees so far. Fewer, better trades is also a cost decision.' });
  }

  // --- R distribution buckets for the histogram
  const rBuckets = { labels: [], counts: [] };
  if (withR.length >= 5) {
    const edges = [-3, -2, -1, 0, 1, 2, 3, 5];
    const labels = ['≤-3R', '-3…-2R', '-2…-1R', '-1…0R', '0…1R', '1…2R', '2…3R', '3…5R', '>5R'];
    const counts = new Array(labels.length).fill(0);
    withR.forEach((t) => {
      const r = t.rMultiple;
      let i = edges.findIndex((e) => r <= e);
      if (i === -1) i = labels.length - 1;
      counts[i]++;
    });
    rBuckets.labels = labels; rBuckets.counts = counts;
  }

  score = Math.max(5, Math.min(98, Math.round(score)));
  const verdict =
    score >= 85 ? 'Professional-grade discipline. Your problems are market problems, not behavior problems.' :
    score >= 70 ? 'Solid foundation with specific, fixable leaks — the cards below name them.' :
    score >= 50 ? 'Your edge and your habits are fighting each other. Fix the two red cards first; ignore everything else this week.' :
    'Right now the biggest risk to this account is behavior, not the market. Small size, hard rules, and re-read the red cards before every session.';

  const summary = 'Analysed ' + closed.length + ' closed trades: ' + Math.round(stats.winRate) + '% win rate, ' +
    (isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞') + ' profit factor, ' +
    jaiFmt(expectancy, currency) + ' expectancy per trade, deepest drawdown ' + jaiFmt(maxDD, currency) + '. ' + verdict;

  const rank = { crit: 0, warn: 1, good: 2, info: 3 };
  insights.sort((a, b) => rank[a.sev] - rank[b.sev]);

  return { score, verdict, summary, insights, actions: actions.slice(0, 3), rBuckets };
}

// ---- render -----------------------------------------------------------------
var JAI_SEV = {
  crit: { label: 'FIX FIRST', colour: '#e5484d' },
  warn: { label: 'LEAK', colour: '#f5a524' },
  good: { label: 'STRENGTH', colour: '#03c988' },
  info: { label: 'PATTERN', colour: '#00adb5' }
};

function renderAiCoachTab(){
  const host = document.getElementById('jai-body');
  if (!host) return;
  const result = jaiAnalyse(JOURNAL_TRADES || [], JOURNAL_SETTINGS || {});

  if (result.locked !== undefined) {
    const n = result.locked;
    host.innerHTML =
      '<div class="pf-empty">' +
        '<h3>The coach needs a little history first.</h3>' +
        '<p>Log <b>' + (5 - n) + ' more closed trade' + (5 - n === 1 ? '' : 's') + '</b> and this tab starts grading your discipline, ' +
        'finding your best and worst setups, and catching revenge trades and early exits in your own data.</p>' +
        '<div class="gm-tension-bar" style="max-width:280px; margin:14px auto 0;"><i style="width:' + (n / 5 * 100) + '%"></i></div>' +
        '<p style="font-family:var(--font-mono); font-size:11px; color:var(--ink-3); margin-top:8px;">' + n + ' / 5 trades</p>' +
      '</div>';
    return;
  }

  // gauge hue tracks the score band
  const hue = result.score >= 70 ? '#03c988' : (result.score >= 50 ? '#f5a524' : '#e5484d');
  const circ = 2 * Math.PI * 54;
  const dash = (result.score / 100) * circ * 0.75;

  host.innerHTML =
    '<div class="jai-hero">' +
      '<div class="jai-gauge">' +
        '<svg viewBox="0 0 140 112">' +
          '<path d="M18 96 A 54 54 0 1 1 122 96" fill="none" stroke="#1e1e22" stroke-width="11" stroke-linecap="round"/>' +
          '<path d="M18 96 A 54 54 0 1 1 122 96" fill="none" stroke="' + hue + '" stroke-width="11" stroke-linecap="round" ' +
            'stroke-dasharray="0 ' + circ.toFixed(1) + '" style="filter:drop-shadow(0 0 6px ' + hue + '66)">' +
            '<animate attributeName="stroke-dasharray" from="0 ' + circ.toFixed(1) + '" to="' + dash.toFixed(1) + ' ' + circ.toFixed(1) + '" dur="1s" fill="freeze" calcMode="spline" keySplines="0.2 0.7 0.3 1"/>' +
          '</path>' +
          '<text x="70" y="78" text-anchor="middle" class="jai-gauge-num" fill="' + hue + '">' + result.score + '</text>' +
          '<text x="70" y="96" text-anchor="middle" class="jai-gauge-sub" fill="#5c6472">DISCIPLINE</text>' +
        '</svg>' +
      '</div>' +
      '<div class="jai-verdict">' +
        '<div class="gm-onair" style="color:var(--gold);"><i style="background:var(--gold); box-shadow:0 0 10px var(--gold);"></i>COACH REPORT</div>' +
        '<p class="gm-brief-type" id="jai-typed" data-full="' + jaiEsc(result.summary).replace(/"/g, '&quot;') + '"></p>' +
      '</div>' +
    '</div>' +

    (result.actions.length ?
      '<div class="jai-actions"><h4>This week, do exactly three things</h4><ol>' +
        result.actions.map((a) => '<li>' + jaiEsc(a) + '</li>').join('') +
      '</ol></div>' : '') +

    '<div class="jai-cards gm-anim">' +
      result.insights.map((ins) => {
        const m = JAI_SEV[ins.sev];
        return '<div class="jai-card" style="border-left-color:' + m.colour + '">' +
          '<span class="jai-card-tag" style="color:' + m.colour + '; border-color:' + m.colour + '55; background:' + m.colour + '12">' + m.label + '</span>' +
          '<h5>' + jaiEsc(ins.title) + '</h5>' +
          '<p>' + jaiEsc(ins.body) + '</p>' +
        '</div>';
      }).join('') +
    '</div>' +

    (result.rBuckets.labels.length ?
      '<div class="panel" style="margin-top:20px;"><div class="panel-head"><h2>R-multiple distribution</h2></div>' +
        '<p class="gm-side-note">Losses should cluster at −1R and never left of it; winners should stretch right. Gaps left of −1R are stop violations made visible.</p>' +
        '<div style="position:relative; height:220px;"><canvas id="jai-r-chart"></canvas></div>' +
      '</div>' : '') +

    '<p class="gm-fineprint" style="margin-top:16px;">Runs privately on your device from your own journal — rule-based analysis, regenerated every visit. Not financial advice; it grades process, not predictions.</p>';

  renderJaiRChart(result.rBuckets);
  JAI_TYPED = false;
  jaiTypeSummary();
}

function renderJaiRChart(buckets){
  const canvas = document.getElementById('jai-r-chart');
  if (!canvas || typeof Chart === 'undefined' || !buckets.labels.length) return;
  if (JAI_CHART) { JAI_CHART.destroy(); JAI_CHART = null; }
  JAI_CHART = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: buckets.labels,
      datasets: [{
        data: buckets.counts,
        backgroundColor: buckets.labels.map((l) =>
          l.indexOf('≤') === 0 || l.indexOf('-') === 0 || l === '-1…0R'
            ? 'rgba(229,72,77,0.75)' : 'rgba(3,201,136,0.75)'),
        borderRadius: 4, borderSkipped: false, maxBarThickness: 42
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ctx.parsed.y + ' trade' + (ctx.parsed.y === 1 ? '' : 's') } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: JCOLOR.ink3 } },
        y: { grid: { color: 'rgba(62,69,80,0.35)' }, ticks: { color: JCOLOR.ink3, precision: 0 } }
      }
    }
  });
}

function jaiTypeSummary(){
  const el = document.getElementById('jai-typed');
  if (!el || JAI_TYPED) return;
  JAI_TYPED = true;
  const full = el.getAttribute('data-full') || '';
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { el.textContent = full; return; }
  el.classList.add('is-typing');
  let i = 0;
  const timer = setInterval(() => {
    i += 2;
    el.textContent = full.slice(0, i);
    if (i >= full.length) { clearInterval(timer); el.classList.remove('is-typing'); }
  }, 14);
}
