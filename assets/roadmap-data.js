/**
 * Stryker Trading Academy — roadmap data (shared by the dashboard strip,
 * the Roadmap page and the admin editor)
 *
 * Source of truth is Firestore settings/roadmap:
 *   { heading, note, updatedAt,
 *     items: [{ id, title, desc, status: 'shipped'|'progress'|'planned',
 *               when, progress (0-100), link, sub: [..], details,
 *               milestones: [{ label, done }], build, date: 'YYYY-MM-DD' }],
 *     changelog: [{ build, date, title }] }
 * DEFAULT below is what shows until that document exists; the admin editor
 * starts from it too. Keep it factual: only things that shipped or are
 * actually being built.
 */
(function (root) {
  'use strict';
  const DEFAULT = {
    heading: "What's next at Stryker",
    note: 'Built in the open. Members see new modules the day they ship.',
    items: [
      { id: 'backtesting-full', title: 'Full backtesting module', desc: 'In-depth analytics, strategy testing and Pine Script integration.', status: 'progress', when: 'In progress', progress: 45, sub: ['In-depth analytics', 'Strategy testing', 'Pine Script integration', 'Portfolio-level stats'],
        details: 'Turning the replay into a complete testing desk: the analytics you would expect from a prop-firm dashboard, rule-based strategies you can run across months of data without clicking through bars, and your own Pine Script indicators running inside the replay.',
        milestones: [{ label: 'Bar-by-bar replay with simulated orders', done: true }, { label: 'Classic and ICT indicator library', done: true }, { label: 'Coach: post-session report, live nudges, checklist', done: true }, { label: 'Analytics: performance, drawdown, Monte Carlo', done: true }, { label: 'Strategy testing: rule-based entries and exits over a whole dataset', done: false }, { label: 'Pine Script integration for custom indicators', done: false }, { label: 'Portfolio-level stats across markets and sessions', done: false }] },
      { id: 'backtest-app', title: 'Backtesting app', desc: 'Dashboard, sessions, trades and analytics in one in-site app with a TradingView-style replay.', status: 'shipped', when: 'Shipped', link: 'backtests.html', build: 281, date: '2026-09-08',
        details: 'Left rail app inside the site. Dashboard with KPIs and P&L over time, session cards, a filterable trade list, and FX-desk analytics: RR and ideal RR, expectancy, profit factor, winners and losers, by side and by session, drawdown analysis and Monte Carlo simulation. The replay got a tool rail, object tree, floating controls, right-click orders and a bottom trade bar.' },
      { id: 'backtest-replay', title: 'Backtest replay', desc: 'Bar-by-bar replay with simulated orders, indicators and a coach.', status: 'shipped', when: 'Shipped', link: 'replay.html', build: 279, date: '2026-09-08',
        details: 'TradingView Lightweight Charts engine, draggable stops and targets, classic and ICT indicators, setup tags, mistakes and notes per trade, chart snapshots, one-click copy into the Trade journal, and a rule-based coach.' },
      { id: 'feature-pages', title: 'Feature pages', desc: 'A hub and a page per module explaining what each part of the academy does.', status: 'shipped', when: 'Shipped', link: 'features.html', build: 277, date: '2026-09-08' },
      { id: 'charts', title: 'Charts workspace', desc: 'Live multi-provider charting inside the academy.', status: 'shipped', when: 'Shipped', link: 'charts.html', build: 276, date: '2026-09-08' },
      { id: 'smart-money', title: 'Smart Money desk', desc: 'Congress trades and insider filings, refreshed daily and sourced on every row.', status: 'shipped', when: 'Shipped', link: 'smart-money.html', build: 275, date: '2026-09-08' },
      { id: 'live-controls', title: 'Live session controls', desc: 'End and complete controls for streams, forced HD playback, timezone-correct countdowns.', status: 'shipped', when: 'Shipped', link: 'live-sessions.html', build: 274, date: '2026-09-08' },
      { id: 'fx-rate', title: 'Live USD to INR pricing', desc: 'Prices convert at the market rate, refreshed once a day.', status: 'shipped', when: 'Shipped', build: 270, date: '2026-09-08' }
    ],
    changelog: [
      { build: 281, date: '2026-09-08', title: 'Backtesting app with analytics, drawdown and Monte Carlo; TradingView-style replay chrome' },
      { build: 280, date: '2026-09-08', title: 'Roadmap strip on the dashboard' },
      { build: 279, date: '2026-09-08', title: 'Replay on Lightweight Charts, indicator library, coach, trade tags and snapshots' },
      { build: 278, date: '2026-09-08', title: 'Backtest replay, first version' },
      { build: 277, date: '2026-09-08', title: 'Feature pages for every module' },
      { build: 276, date: '2026-09-08', title: 'Charts workspace' },
      { build: 275, date: '2026-09-08', title: 'Smart Money desk visual overhaul' },
      { build: 274, date: '2026-09-08', title: 'Live session end and complete controls, HD playback, timezone-correct countdowns' },
      { build: 271, date: '2026-09-08', title: 'Quick notes on every admin page' },
      { build: 270, date: '2026-09-08', title: 'Daily USD to INR market rate' }
    ]
  };
  function load() {
    return new Promise((resolve) => {
      if (typeof db === 'undefined' || !db) { resolve(DEFAULT); return; }
      let done = false; const t = setTimeout(() => { if (!done) { done = true; resolve(DEFAULT); } }, 3000);
      db.collection('settings').doc('roadmap').get().then((doc) => { if (done) return; done = true; clearTimeout(t); const d = doc.exists ? doc.data() : null; resolve(d && Array.isArray(d.items) && d.items.length ? Object.assign({}, DEFAULT, d) : DEFAULT); }).catch(() => { if (!done) { done = true; clearTimeout(t); resolve(DEFAULT); } });
    });
  }
  root.StrykerRoadmap = { DEFAULT, load };
})(window);
