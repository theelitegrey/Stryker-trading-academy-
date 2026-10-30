/**
 * TradeZoro — roadmap data (shared by the dashboard strip,
 * the Roadmap page and the admin editor)
 *
 * Source of truth is Firestore settings/roadmap:
 *   { heading, note, updatedAt,
 *     items: [{ id, title, desc, status: 'shipped'|'progress'|'planned',
 *               when, progress (0-100), link, sub: [..], details,
 *               milestones: [{ label, done }], build, date: 'YYYY-MM-DD' }],
 *     changelog: [{ build, date, title }] }
 * On top of whichever of those is used, load() appends the auto-generated
 * assets/roadmap-log.json (tools/gen-roadmap.js; commits with a `Roadmap:` trailer).
 * DEFAULT below is what shows until that document exists; the admin editor
 * starts from it too. Keep it factual: only things that shipped or are
 * actually being built.
 */
(function (root) {
  'use strict';
  const DEFAULT = {
    heading: "What's next at TradeZoro",
    note: 'Built in the open. Members see new modules the day they ship.',
    items: [
      { id: 'market-stats', title: 'Market Stats', desc: 'How often gap fills, opening range breaks and prior-day levels played out on NQ, ES and SPX, with sample sizes.', status: 'shipped', when: 'Shipped', link: 'market-stats.html', build: 708, date: '2026-10-29',
        details: 'Free for every member. Historical frequencies with sample sizes and 95% intervals, with the sessions behind each number one tap away on ZoroCharts.' },
      { id: 'charts-free', title: 'ZoroCharts free for everyone', desc: 'ZoroCharts open to every member on the Free plan.', status: 'shipped', when: 'Shipped', link: 'charts.html', build: 706, date: '2026-10-28',
        details: 'Charts are free on every plan. Real-time CME futures, order flow tools and GEX on charts stay on Pro or the live data add-on.' },
      { id: 'creator-hub', title: 'Creator Hub', desc: 'Any member can run a trading community: plans, invites, indicators, courses and community life in one place.', status: 'shipped', when: 'Shipped', link: 'creators.html', build: 746, date: '2026-10-30', sub: ['Communities and plans', 'Indicator access on ZoroCharts', 'Courses', 'Feed, events and Discord'],
        details: 'Communities with plans, invite codes and a directory are live. Creators can sell and manage access to their indicators on ZoroCharts, publish courses with video, text and PDF lessons, and run a members-only feed, events and a leaderboard. Discord roles and paid community plans are built and switch on as their setup finishes.',
        milestones: [{ label: 'Communities, plans, invites and directory', done: true }, { label: 'Sell and manage indicator access on ZoroCharts', done: true }, { label: 'Courses: video, text and PDFs', done: true }, { label: 'Community feed, events and Discord access', done: true }] },
      { id: 'faster-indicators', title: 'Faster indicators on charts', desc: 'Heavy indicators load reliably even when a chart already has several others on it.', status: 'progress', when: 'In progress', progress: 50, link: 'charts.html',
        details: 'A shared cache for higher-timeframe data in indicators has shipped. Next: each indicator gets its own lane, so one script no longer waits behind the others before it can draw.',
        milestones: [{ label: 'Find what slows heavy indicators on busy charts', done: true }, { label: 'Shared cache for higher-timeframe data', done: true }, { label: 'Own lane per indicator', done: false }, { label: 'Tested on charts with many indicators, then shipped', done: false }] },
      { id: 'backtesting-full', title: 'Replay One: full backtesting', desc: 'Strategy testing, deeper analytics and Pine Script integration on top of the replay.', status: 'planned', when: 'Planned', sub: ['Strategy testing', 'Pine Script integration', 'Portfolio-level stats'],
        details: 'Turning the replay into a complete testing desk. Backtesting already runs on the same chart engine as ZoroCharts. Still to come: rule-based strategies you can run across a whole dataset, your own Pine Script inside the replay, and stats across markets and sessions.',
        milestones: [{ label: 'Bar-by-bar replay with simulated orders', done: true }, { label: 'Analytics: performance, drawdown, Monte Carlo', done: true }, { label: 'Backtesting on the ZoroCharts engine', done: true }, { label: 'Strategy testing: rule-based entries and exits over a whole dataset', done: false }, { label: 'Pine Script integration for custom indicators', done: false }, { label: 'Portfolio-level stats across markets and sessions', done: false }] },
      { id: 'mobile-app', title: 'Native phone app', desc: 'TradeZoro on the App Store and Google Play.', status: 'planned', when: 'Planned' },
      { id: 'more-live-symbols', title: 'More futures symbols with live data', desc: 'Live data on more futures symbols at the same time.', status: 'planned', when: 'Planned' },
      { id: 'futures-dom', title: 'Futures order book for members', desc: 'Order book and depth on futures charts for every member, once the data licence allows it.', status: 'planned', when: 'Planned' },
      { id: 'chart-alerts-indicators', title: 'Alerts on indicator conditions', desc: 'Set an alert on an indicator condition on ZoroCharts, the way TradingView does.', status: 'shipped', when: 'Shipped', link: 'charts.html', build: 619, date: '2026-10-22' },
      { id: 'chart-layouts-sync', title: 'Chart layouts on every device', desc: 'Saved chart layouts live in your account and open on any device you sign in on.', status: 'shipped', when: 'Shipped', link: 'charts.html', build: 420, date: '2026-10-05' },
      { id: 'charts-light-theme', title: 'Light theme for charts', desc: 'Charts follow the site day theme, switched from the profile menu.', status: 'shipped', when: 'Shipped', link: 'charts.html', build: 400, date: '2026-10-05' },
      { id: 'backtest-app', title: 'Replay One app', desc: 'Dashboard, sessions, trades and analytics in one in-site app with a TradingView-style replay.', status: 'shipped', when: 'Shipped', link: 'backtests.html', build: 281, date: '2026-09-08',
        details: 'Left rail app inside the site. Dashboard with KPIs and P&L over time, session cards, a filterable trade list, and FX-desk analytics: RR and ideal RR, expectancy, profit factor, winners and losers, by side and by session, drawdown analysis and Monte Carlo simulation. The replay got a tool rail, object tree, floating controls, right-click orders and a bottom trade bar.' },
      { id: 'backtest-replay', title: 'Replay One bar replay', desc: 'Bar-by-bar replay with simulated orders, indicators and a coach.', status: 'shipped', when: 'Shipped', link: 'replay.html', build: 279, date: '2026-09-08',
        details: 'TradingView Lightweight Charts engine, draggable stops and targets, classic and ICT indicators, setup tags, mistakes and notes per trade, chart snapshots, one-click copy into JournalX, and a rule-based coach.' },
      { id: 'feature-pages', title: 'Feature pages', desc: 'A hub and a page per module explaining what each part of the academy does.', status: 'shipped', when: 'Shipped', link: 'features.html', build: 277, date: '2026-09-08' },
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
      { build: 276, date: '2026-09-08', title: 'ZoroCharts' },
      { build: 275, date: '2026-09-08', title: 'Smart Money desk visual overhaul' },
      { build: 274, date: '2026-09-08', title: 'Live session end and complete controls, HD playback, timezone-correct countdowns' },
      { build: 271, date: '2026-09-08', title: 'Quick notes on every admin page' },
      { build: 270, date: '2026-09-08', title: 'Daily USD to INR market rate' }
    ]
  };
  // assets/roadmap-log.json is written by tools/gen-roadmap.js on every
  // deploy, from `Roadmap:` trailers in the git log. Entries: {build, date, title, link}.
  function fetchLog() {
    return new Promise((resolve) => {
      if (typeof fetch !== 'function') { resolve([]); return; }
      const t = setTimeout(() => resolve([]), 4000);
      // hourly cache key: /assets is cached "immutable" and the file changes without a ?v= bump
      fetch('assets/roadmap-log.json?t=' + Math.floor(Date.now() / 3600000)).then((r) => (r.ok ? r.json() : [])).then((j) => { clearTimeout(t); resolve(Array.isArray(j) ? j : []); }).catch(() => { clearTimeout(t); resolve([]); });
    });
  }
  const slug = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  function withLog(base, log) {
    if (!log.length) return base;
    const have = new Set((base.items || []).map((i) => String(i.title).toLowerCase()));
    const haveCl = new Set((base.changelog || []).map((c) => String(c.title).toLowerCase()));
    const items = (base.items || []).concat(log.filter((e) => e && e.title && !have.has(String(e.title).toLowerCase())).map((e) => ({ id: 'log-' + e.build + '-' + slug(e.title), title: e.title, desc: '', status: 'shipped', when: 'Shipped', link: e.link || '', build: e.build, date: e.date, auto: true })));
    const changelog = (base.changelog || []).concat(log.filter((e) => e && e.title && !haveCl.has(String(e.title).toLowerCase())).map((e) => ({ build: e.build, date: e.date, title: e.title })));
    return Object.assign({}, base, { items, changelog });
  }
  function loadBase() {
    return new Promise((resolve) => {
      if (typeof db === 'undefined' || !db) { resolve(DEFAULT); return; }
      let done = false; const t = setTimeout(() => { if (!done) { done = true; resolve(DEFAULT); } }, 3000);
      db.collection('settings').doc('roadmap').get().then((doc) => { if (done) return; done = true; clearTimeout(t); const d = doc.exists ? doc.data() : null; resolve(d && Array.isArray(d.items) && d.items.length ? Object.assign({}, DEFAULT, d) : DEFAULT); }).catch(() => { if (!done) { done = true; clearTimeout(t); resolve(DEFAULT); } });
    });
  }
  // load({ raw: true }) skips the auto log: the admin editor edits only the hand-written part.
  function load(opts) {
    if (opts && opts.raw) return loadBase();
    return Promise.all([loadBase(), fetchLog()]).then((r) => withLog(r[0], r[1]));
  }
  root.StrykerRoadmap = { DEFAULT, load };
})(window);
