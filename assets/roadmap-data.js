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
      { id: 'everything-in-pro', title: 'Everything in Pro page', desc: 'One page that lists every Pro tool: the order book, order flow, Omega and what is coming next. No prices.', status: 'shipped', when: 'Shipped', link: 'pro.html' },
      { id: 'passkey-signin', title: 'Passkey sign-in', desc: 'Sign in with your fingerprint, face or screen lock instead of a password. Add passkeys in Settings.', status: 'shipped', when: 'Shipped', link: 'settings.html' },
      { id: 'partner-programme', title: 'Partner programme', desc: 'Share TradeZoro with your audience and use Pro for free while you are a partner. Apply from the dashboard.', status: 'shipped', when: 'Shipped', link: 'partner.html' },
      { id: 'delta-profile', title: 'Delta profile (L2)', desc: 'Buy minus sell volume at every price, for a range you pick on the chart or a rolling window like the last 15 or 30 minutes. Futures, Pro.', status: 'shipped', when: 'Shipped', link: 'charts.html', sub: ['Fixed range you draw', 'Rolling time window (15 / 30 min and more)', 'Delta at each price level'] },
      { id: 'swing-vwap-vp', title: 'Swing VWAP + Volume Profile (L2)', desc: 'Automatically draws an anchored VWAP and a volume profile for every swing, high to low and low to high, with POC, VAH and VAL, and keeps updating as new swings form. Futures, Pro.', status: 'shipped', when: 'Shipped', link: 'charts.html', sub: ['Detects new swings by itself', 'Anchored VWAP per swing', 'Volume profile per swing with POC, VAH, VAL'] },
      { id: 'footprint-patterns', title: 'Footprint Patterns', desc: 'Marks six footprint patterns on any chart style: absorption, exhaustion, stacked imbalances, unfinished auctions, delta divergence and trapped traders. Futures (L2) and crypto, Pro.', status: 'shipped', when: 'Shipped', link: 'charts.html' },
      { id: 'windows-app', title: 'TradeZoro Windows app', desc: 'A dedicated Windows desktop app: pop charts out onto a second monitor, keep a window always on top, Windows alerts, and automatic updates.', status: 'shipped', when: 'Shipped' },
      { id: 'workspaces', title: 'Workspaces', desc: 'Save your whole chart setup as a named workspace (charts, layout, symbols, timeframes, indicators and panels) and switch between workspaces in one tap from the top bar.', status: 'shipped', when: 'Shipped' },
      { id: 'chart-order-panel-v2', title: 'New order panel on charts', desc: 'A floating order panel with Scalp, DOM and Order tabs: one-tap Buy/Sell with live bid and ask, Market/Limit/Stop, quantity stepper, stop loss and take profit in price or ticks with quick presets, Join Bid/Join Ask. Works for paper trading and connected brokers.', status: 'shipped', when: 'Shipped' },
      { id: 'ai-bar-chip', title: 'AI connection button in the chart\'s bottom bar', desc: 'Connect your AI app straight from the chart\'s bottom bar, next to the time ranges, and see at a glance when it\'s connected or paused.', status: 'shipped', when: 'Shipped' },
      { id: 'phantom', title: 'Phantom: options money flow by market and strike', desc: 'A new module that shows where options money is going: net call and put premium per market through the day, the biggest movers, calls versus puts by strike and expiry, and alerts when unusual premium shows up.', status: 'progress', when: 'In progress' },
      { id: 'spectra', title: 'Spectra: dealer exposure map by strike and expiry', desc: 'A new module that maps options dealer exposure at every strike across several expiries in one grid, with the strongest strike starred, a GEX and VEX switch, which strikes are growing or shrinking, alerts on any strike, and a view of whether SPX, SPY and QQQ agree.', status: 'progress', when: 'In progress' },
      { id: 'bar-stats-indicator', title: 'Bar Stats indicator for any chart', desc: 'A table under the candles showing each bar\'s total volume, delta, delta %, buy volume, sell volume and trades, colour-coded so strong buying and selling stand out. Works on normal candle charts, not only footprint.', status: 'progress', when: 'In progress' },
      { id: 'chart-trade-menu-v2', title: 'New Trade menu with broker logos', desc: 'The Trade button shows the active account\'s logo and name. The menu lists Paper trading and each connected broker account with its logo, status and a tick on the active one, plus a Connect a broker button.', status: 'progress', when: 'Planned' },
      { id: 'connection-latency', title: 'Connection and latency panel', desc: 'A live connection chip in the chart corner with real ping for each data feed, quality, jitter, data age, a 2-minute history chart, your nearest edge location and one-tap reconnect.', status: 'shipped', when: 'Shipped', date: '2026-11-16' },
      { id: 'indicator-picker-v2', title: 'New indicator picker', desc: 'A redesigned Add to chart window: search by name or by what you want, category rail with counts, preview cards with market tags, a detail pane, add several indicators at once, and full keyboard control.', status: 'shipped', when: 'Shipped', date: '2026-11-15' },
      { id: 'composite-vp', title: 'Composite volume profile', desc: 'One volume profile built across several sessions or a range of days, with POC, VAH and VAL.', status: 'shipped', when: 'Shipped', date: '2026-11-15' },
      { id: 'workspace-close-reopen', title: 'Close a workspace without deleting it', desc: 'Close a workspace tab without deleting it, and reopen it any time from the workspace menu.', status: 'shipped', when: 'Shipped', date: '2026-11-16' },
      { id: 'tpo-rows', title: 'TPO: choose the number of rows', desc: 'Set the row count for the TPO profile yourself, so every session uses the same rows at the same zoom.', status: 'progress', when: 'In progress' },
      { id: 'tpo-align-left', title: 'TPO: Align left option', desc: 'Line the TPO profile up on the left, like the volume profile, so the two sit side by side without overlapping.', status: 'shipped', when: 'Shipped', date: '2026-11-15' },
      { id: 'vp-always-visible', title: 'Volume profiles stay visible while you scroll', desc: 'An Always visible option for every volume profile, so a profile you placed stays on screen while you move or scroll the chart.', status: 'shipped', when: 'Shipped' },
      { id: 'days-to-load-exact', title: 'Days to load: exact limit per timeframe', desc: 'When you pick a fixed number of days to load, the chart loads exactly that much history and no more.', status: 'shipped', when: 'Shipped', date: '2026-11-15' },
      { id: 'longer-history', title: 'Longer history to load', desc: 'Days of history to load now goes as far as the data really goes for each timeframe: years on hourly and daily charts. Long loads come in pages so the chart stays fast, and composite volume profiles cover the whole loaded range.', status: 'shipped', when: 'Shipped' },
      { id: 'period-vp', title: 'Daily, weekly and monthly profile templates', desc: 'Ready-made volume profile templates for each day, week and month.', status: 'planned', when: 'Planned' },
      { id: 'all-tools-free', title: 'Every tool free, only live data paid', desc: 'All Pro tools free for every member: order flow, DOM, heatmap, Omega and options tools. Only the live data feed is paid, because exchanges set those fees.', status: 'shipped', when: 'Shipped' },
      { id: 'screener-all-markets', title: 'Screener for stocks, ETFs, crypto and futures', desc: 'Filter and sort every market, pick your columns, and open any row on ZoroCharts. Saved screens and share links next.', status: 'progress', progress: 40, when: 'In progress', link: 'scanner.html' },
      { id: 'book-dom-trades', title: 'Order book, DOM and trades panel', desc: 'Book, DOM and Trades tabs beside the chart for crypto and futures: one exchange or several combined, bought / sold / delta per price, and paper trading from the ladder (simulated).', status: 'shipped', when: 'Shipped', link: 'charts.html' },
      { id: 'futures-dom', title: 'Futures order book for members', desc: 'Full order book (L2), DOM ladder, liquidity walls and L1 Big Trades and Delta on NQ, ES, MNQ, MES, YM, RTY, CL and GC charts. Part of Pro.', status: 'shipped', when: 'Shipped', link: 'features/orderflow.html', build: 802, date: '2026-11-03' },
      { id: 'orderbook-heatmap', title: 'Order book heatmap', desc: 'A heatmap of resting orders over time, drawn on the chart for crypto and futures. Part of Pro.', status: 'shipped', when: 'Shipped', link: 'features/orderflow.html', build: 802, date: '2026-11-03' },

      { id: 'more-live-symbols', title: 'More futures symbols with live data', desc: 'Live candles and order flow for NQ, ES, MNQ, MES, YM, RTY, CL, GC, silver, copper, bonds, euro and the micro contracts, plus live index charts.', status: 'shipped', when: 'Shipped', link: 'charts.html' },
      { id: 'live-index-prices', title: 'Live index & ETF prices (SPX, NDX, VIX, QQQ, SPY...)', desc: 'SPX, NDX, VIX, RUT, QQQ, SPY, IWM and DIA charts with GEX levels on SPX, SPY and QQQ.', status: 'shipped', when: 'Shipped', link: 'charts.html', build: 793, date: '2026-11-03' },
      { id: 'android-app', title: 'TradeZoro Android app', desc: 'A dedicated Android app on Google Play: full screen, its own icon, push notifications for your alerts, and every new feature the same day it ships on the site.', status: 'shipped', when: 'Shipped',
        milestones: [{ label: 'App build and phone testing', done: false }, { label: 'Google Play listing', done: false }, { label: 'Live on Google Play', done: false }] },
      { id: 'ios-app', title: 'TradeZoro iPhone app', desc: 'A dedicated iPhone and iPad app on the App Store, with push notifications for your alerts.', status: 'planned', when: 'Planned',
        milestones: [{ label: 'App build and testing', done: false }, { label: 'Live on the App Store', done: false }] },
      { id: 'indicator-lanes', title: 'Indicators: own lane per script', desc: 'Heavy indicators load reliably even when a chart already has several others on it.', status: 'progress', progress: 60, when: 'In progress', link: 'charts.html',
        details: 'A shared cache for higher-timeframe data and first-run priority for indicators have shipped. Next: each indicator gets its own lane, so one script no longer waits behind the others before it can draw.',
        milestones: [{ label: 'Find what slows heavy indicators on busy charts', done: true }, { label: 'Shared cache for higher-timeframe data', done: true }, { label: 'First-run priority and time limit for heavy scripts', done: true }, { label: 'Own lane per indicator', done: false }, { label: 'Tested on charts with many indicators, then shipped', done: false }] },
      { id: 'wallet-intel', title: 'Wallet Intel for Hyperliquid', desc: 'Tap any candle to see the wallets that traded it, plus liquidation and stop clusters, the wallets behind order book levels and wallet profiles. Free.', status: 'shipped', progress: 15, when: 'In progress', link: 'charts.html',
        milestones: [{ label: 'Wallet data collector', done: true }, { label: 'Chart panels and clusters', done: true }, { label: 'Tested on phone and desktop, then shipped', done: true }] },
      { id: 'dark-pool-alerts', title: 'Dark pool alerts', desc: 'Get a bell and phone alert when a big dark pool print hits a stock you follow, even with the chart closed. Free. Next: set it inside the Dark Pool Prints indicator.', status: 'shipped', when: 'Shipped', link: 'indicators/dark-pool-prints.html', build: 906, date: '2026-11-07' },
      { id: 'dark-pool-prints', title: 'Dark Pool Prints', desc: 'Off-exchange trades of $1M+ at their exact price and time on 29 US stocks and ETFs, a Dark pool list beside the chart, and SPY / QQQ / DIA / IWM prints shown on ES, NQ, YM and RTY. Free.', status: 'shipped', when: 'Shipped', link: 'indicators/dark-pool-prints.html', build: 905, date: '2026-11-07' },
      { id: 'zscript', title: 'Zscript: build your own indicators', desc: 'Our own indicator language with order book, order flow, GEX and options data, an editor in ZoroCharts, a Script Library where creators can sell scripts, and the free Zscript Book. Free.', status: 'shipped', when: 'Shipped', link: 'zscript/', build: 902, date: '2026-11-07' },
      { id: 'zoro-options', title: 'ZoroOptions', desc: 'Options positioning, levels and flow for indexes, ETFs and futures, plus Zoro Levels on the chart. Free for signed-in members (pre-beta).', status: 'shipped', when: 'Shipped', link: 'zoro-options.html', build: 897, date: '2026-11-07' },
      { id: 'depth-heatmap', title: 'Depth Heatmap (L2)', desc: 'A new futures order book heatmap with a smooth option, plus the heatmap now shows the last session when the market is closed. Part of Pro.', status: 'shipped', when: 'Shipped', link: 'indicators/depth-heatmap-l2.html', build: 904, date: '2026-11-07' },
      { id: 'pro-trial', title: '7-day free Pro trial', desc: 'Try every Pro tool free for 7 days.', status: 'shipped', when: 'Shipped', link: 'pro.html', date: '2026-11-07' },
      { id: 'replay-orderbook', title: 'Order book history in Kronos', desc: 'Replay the order book along with the bars.', status: 'planned', when: 'Planned', link: 'replay.html' },
      { id: 'free-for-all', title: 'TradeZoro is free', desc: 'Every module is free. Pro adds order flow and Omega.', status: 'shipped', when: 'Shipped', link: 'pricing.html', build: 780, date: '2026-11-01' },
      { id: 'phone-chart-menus', title: 'ZoroCharts phone menus', desc: 'Chart menus rebuilt for phones.', status: 'shipped', when: 'Shipped', link: 'charts.html', build: 782, date: '2026-11-02' },
      { id: 'new-homepage', title: 'New homepage', desc: 'A redesigned homepage.', status: 'shipped', when: 'Shipped', link: 'index.html', build: 783, date: '2026-11-02' },
      { id: 'visual-market-pages', title: 'Visual market pages', desc: 'Scanner heatmap, Map treemap, Brief ladder and Calendar timeline.', status: 'shipped', when: 'Shipped', link: 'scanner.html', build: 784, date: '2026-11-02' },
      { id: 'new-feature-pages', title: 'New feature pages', desc: 'Every feature page rebuilt.', status: 'shipped', when: 'Shipped', link: 'features.html', build: 785, date: '2026-11-02' },
      { id: 'menu-sections', title: 'Menu in sections', desc: 'The app menu is grouped into sections.', status: 'shipped', when: 'Shipped', link: 'dashboard-user.html', build: 786, date: '2026-11-02' },
      { id: 'new-dashboard', title: 'New member dashboard', desc: 'A redesigned member dashboard.', status: 'shipped', when: 'Shipped', link: 'dashboard-user.html', build: 787, date: '2026-11-02' },
      { id: 'market-stats', title: 'Market Stats', desc: 'How often gap fills, opening range breaks and prior-day levels played out on NQ, ES and SPX, with sample sizes.', status: 'shipped', when: 'Shipped', link: 'market-stats.html', build: 708, date: '2026-10-29',
        details: 'Free for every member. Historical frequencies with sample sizes and 95% intervals, with the sessions behind each number one tap away on ZoroCharts.' },
      { id: 'charts-free', title: 'ZoroCharts free for everyone', desc: 'ZoroCharts open to every member on the Free plan.', status: 'shipped', when: 'Shipped', link: 'charts.html', build: 706, date: '2026-10-28',
        details: 'Charts are free on every plan. Live CME futures (L1) are free for every member who signs the market data agreement, or through Rithmic.' },
      { id: 'creator-hub', title: 'Creator Hub', desc: 'Any member can run a trading community: plans, invites, indicators, courses and community life in one place.', status: 'shipped', when: 'Shipped', link: 'creators.html', build: 746, date: '2026-10-30', sub: ['Communities and plans', 'Indicator access on ZoroCharts', 'Courses', 'Feed, events and Discord'],
        details: 'Communities with plans, invite codes and a directory are live. Creators can sell and manage access to their indicators on ZoroCharts, publish courses with video, text and PDF lessons, and run a members-only feed, events and a leaderboard. Discord roles and paid community plans with Stripe payouts are available.',
        milestones: [{ label: 'Communities, plans, invites and directory', done: true }, { label: 'Sell and manage indicator access on ZoroCharts', done: true }, { label: 'Courses: video, text and PDFs', done: true }, { label: 'Community feed, events and Discord access', done: true }] },
      { id: 'creator-hub-polish', title: 'Creator Hub: community page polish', desc: 'A cleaner community page and a ready-made demo community to explore.', status: 'shipped', when: 'Shipped', link: 'creators.html', build: 768, date: '2026-10-31',
        details: 'Demo community support, the redesigned community page and the Creator Hub app menu have shipped and were checked on phone and desktop.',
        milestones: [{ label: 'Demo community support and Creator Hub menu section', done: true }, { label: 'Community page redesign', done: true }, { label: 'Checked on phone and desktop, then shipped', done: true }] },
      { id: 'backtesting-full', title: 'Kronos: full backtesting', desc: 'Strategy testing, deeper analytics and Pine Script integration on top of the replay.', status: 'planned', when: 'Planned', sub: ['Strategy testing', 'Pine Script integration', 'Portfolio-level stats'],
        details: 'Turning the replay into a complete testing desk. Backtesting already runs on the same chart engine as ZoroCharts. Still to come: rule-based strategies you can run across a whole dataset, your own Pine Script inside the replay, and stats across markets and sessions.',
        milestones: [{ label: 'Bar-by-bar replay with simulated orders', done: true }, { label: 'Analytics: performance, drawdown, Monte Carlo', done: true }, { label: 'Backtesting on the ZoroCharts engine', done: true }, { label: 'Strategy testing: rule-based entries and exits over a whole dataset', done: false }, { label: 'Pine Script integration for custom indicators', done: false }, { label: 'Portfolio-level stats across markets and sessions', done: false }] },
      { id: 'chart-trading', title: 'Trade from the chart', desc: 'Place, move and cancel orders straight from ZoroCharts and the DOM on your own broker account, with brackets and one-click flatten.', status: 'shipped', when: 'Shipped', sub: ['Orders on the chart', 'DOM trading', 'Brackets and stops', 'One-click flatten'], date: '2026-11-16' },
      { id: 'copy-trading', title: 'Copy trading across your accounts', desc: 'Place a trade once and copy it to your other linked accounts, with per-account size rules.', status: 'planned', when: 'Planned', sub: ['Leader and follower accounts', 'Size rules per account', 'Instant stop for all'] },
      { id: 'tradovate-full', title: 'Tradovate: full integration', desc: 'Live data, trade history and order placement for your Tradovate account inside TradeZoro.', status: 'planned', when: 'Planned' },
      { id: 'ninjatrader-full', title: 'NinjaTrader: full integration', desc: 'Your NinjaTrader account\'s data, trades and orders inside TradeZoro.', status: 'planned', when: 'Planned' },
      { id: 'rithmic-full', title: 'Rithmic: full integration', desc: 'Rithmic-based prop firm accounts: data, trade history and order placement inside TradeZoro.', status: 'planned', when: 'Planned' },
      { id: 'chart-alerts-indicators', title: 'Alerts on indicator conditions', desc: 'Set an alert on an indicator condition on ZoroCharts, the way TradingView does.', status: 'shipped', when: 'Shipped', link: 'charts.html', build: 619, date: '2026-10-22' },
      { id: 'chart-layouts-sync', title: 'Chart layouts on every device', desc: 'Saved chart layouts live in your account and open on any device you sign in on.', status: 'shipped', when: 'Shipped', link: 'charts.html', build: 420, date: '2026-10-05' },
      { id: 'charts-light-theme', title: 'Light theme for charts', desc: 'Charts follow the site day theme, switched from the profile menu.', status: 'shipped', when: 'Shipped', link: 'charts.html', build: 400, date: '2026-10-05' },
      { id: 'backtest-app', title: 'Kronos app', desc: 'Dashboard, sessions, trades and analytics in one in-site app with a TradingView-style replay.', status: 'shipped', when: 'Shipped', link: 'backtests.html', build: 281, date: '2026-09-08',
        details: 'Left rail app inside the site. Dashboard with KPIs and P&L over time, session cards, a filterable trade list, and FX-desk analytics: RR and ideal RR, expectancy, profit factor, winners and losers, by side and by session, drawdown analysis and Monte Carlo simulation. The replay got a tool rail, object tree, floating controls, right-click orders and a bottom trade bar.' },
      { id: 'backtest-replay', title: 'Kronos bar replay', desc: 'Bar-by-bar replay with simulated orders, indicators and a coach.', status: 'shipped', when: 'Shipped', link: 'replay.html', build: 279, date: '2026-09-08',
        details: 'TradingView Lightweight Charts engine, draggable stops and targets, classic and ICT indicators, setup tags, mistakes and notes per trade, chart snapshots, one-click copy into Nemesis, and a rule-based coach.' },
      { id: 'feature-pages', title: 'Feature pages', desc: 'A hub and a page per module explaining what each part of the academy does.', status: 'shipped', when: 'Shipped', link: 'features.html', build: 277, date: '2026-09-08' },
      { id: 'smart-money', title: 'Smart Money desk', desc: 'Congress trades and insider filings, refreshed daily and sourced on every row.', status: 'shipped', when: 'Shipped', link: 'smart-money.html', build: 275, date: '2026-09-08' }
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
  // The admin editor saves settings/roadmap in the database; cards added in this file (feature requests) must still show.
  // Merge by id: keep the database order and text, add file cards it lacks, and let a file card move a status forward
  // (planned -> progress -> shipped), never back.
  const RANK = { planned: 0, progress: 1, shipped: 2 };
  function mergeBase(d) {
    const out = (d.items || []).map((x) => Object.assign({}, x));
    const byId = new Map(out.map((x) => [x.id, x]));
    (DEFAULT.items || []).forEach((f) => {
      const x = byId.get(f.id);
      if (!x) { out.push(Object.assign({}, f)); return; }
      if ((RANK[f.status] || 0) > (RANK[x.status] || 0)) { x.status = f.status; x.when = f.when; if (f.date) x.date = f.date; if (f.status === 'shipped') delete x.progress; }
    });
    return Object.assign({}, DEFAULT, d, { items: out });
  }
  function loadBase() {
    return new Promise((resolve) => {
      if (typeof db === 'undefined' || !db) { resolve(DEFAULT); return; }
      let done = false; const t = setTimeout(() => { if (!done) { done = true; resolve(DEFAULT); } }, 3000);
      db.collection('settings').doc('roadmap').get().then((doc) => { if (done) return; done = true; clearTimeout(t); const d = doc.exists ? doc.data() : null; resolve(d && Array.isArray(d.items) && d.items.length ? mergeBase(d) : DEFAULT); }).catch(() => { if (!done) { done = true; clearTimeout(t); resolve(DEFAULT); } });
    });
  }
  // load({ raw: true }) skips the auto log: the admin editor edits only the hand-written part.
  function load(opts) {
    if (opts && opts.raw) return loadBase();
    return Promise.all([loadBase(), fetchLog()]).then((r) => withLog(r[0], r[1]));
  }
  root.StrykerRoadmap = { DEFAULT, load };
})(window);
