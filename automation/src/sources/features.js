/**
 * The features pages, in rotation order. Descriptions are the pages' own
 * meta descriptions so a promo never claims something the page does not.
 * Kept in step with functions-src/xAutopost.js by hand.
 */
const FEATURES = [
  { page: 'features-curriculum.html', title: 'The Curriculum',
    blurb: 'A chapter-by-chapter ICT and SMT curriculum with tracked progress, quizzes, and achievements — structured the way a trading desk trains a new analyst.' },
  { page: 'features-charts.html', title: 'Charts Workspace',
    blurb: 'A full interactive charting workspace inside the academy — live crypto data, 70+ indicators, drawing tools, and layouts that save themselves.' },
  { page: 'features-models.html', title: 'Trading Models',
    blurb: 'Complete, rule-based trading models — context, entry, invalidation and management — documented step by step in the Stryker model library.' },
  { page: 'features-indicators.html', title: 'Private Indicators',
    blurb: 'Invite-only TradingView indicators — Liquidity Master, SMT Divergence Pro, IFVG Pro, FVG Relay and HTF PO3 Lens — with licensed access granted to your TradingView username.' },
  { page: 'features-live.html', title: 'Live Sessions',
    blurb: 'Live trading sessions with real-time chat, session replays with recap stats, and a next-session countdown shown in your own timezone.' },
  { page: 'features-monitor.html', title: 'Global Monitor',
    blurb: 'A single screen for global market context — the monitor every Stryker student checks before the session starts.' },
  { page: 'features-smart-money.html', title: 'Smart Money Desk',
    blurb: 'What Congress and corporate insiders are actually trading — congressional disclosures and SEC insider filings, refreshed daily, every row linked to the official document.' },
  { page: 'features-community.html', title: 'Community & Tools',
    blurb: 'The Trading Floor community, private messages, a structured trade journal, achievements, referrals and giveaways — the layer that keeps you consistent.' }
];

module.exports = { FEATURES };
