/**
 * The site's own published data files. Each is a JSON the website renders;
 * this platform only ever reads them, so a post can never say something the
 * site does not.
 */
const { env } = require('../config');
const { fetchJson } = require('../util');

const url = (p) => env.siteUrl + p;

async function brief() { return fetchJson(url('/assets/market-brief.json')); }
async function calendar() { return fetchJson(url('/assets/econ-calendar.json')); }
async function marketMap() { return fetchJson(url('/assets/market-map.json')); }
async function monitor() { return fetchJson(env.monitorUrl); }

/** True if the brief is for `day` and not past goodUntil. */
function briefIsFresh(b, t) {
  if (!b || !b.sessionDate || !b.headline) return false;
  const day = new Date(t).toISOString().slice(0, 10);
  if (b.sessionDate !== day) return false;
  const goodUntil = b.goodUntil ? Date.parse(b.goodUntil) : null;
  return !(goodUntil && goodUntil < t);
}

/**
 * Six headline prints for the brief card and video, from the market map:
 * percentage moves over the 1D window for five tickers plus the 10Y yield.
 * Only numbers the site already shows. Returns [] on any failure.
 */
function keyPrints(map) {
  try {
    const rows = {};
    (map.groups || []).forEach((g) => (g.rows || []).forEach((r) => { rows[r.ticker] = r; }));
    const pct = (t, label) => {
      const r = rows[t]; if (!r || !r.v || typeof r.v[0] !== 'number') return null;
      const v = r.v[0];
      return { label, text: (v > 0 ? '+' : (v < 0 ? '\u2212' : '')) + Math.abs(v).toFixed(2) + '%', dir: v > 0 ? 1 : (v < 0 ? -1 : 0) };
    };
    const y10 = ((map.curve || {}).points || []).find((p) => p.label === '10Y');
    const out = [
      pct('SPY', 'S&P 500'),
      y10 && typeof y10.yield === 'number' ? { label: '10Y yield', text: y10.yield.toFixed(2) + '%', dir: 0 } : null,
      pct('CLUSD', 'WTI'), pct('GCUSD', 'Gold'), pct('USDJPY', 'USD/JPY'), pct('BTCUSD', 'Bitcoin')
    ].filter(Boolean);
    return out.length >= 4 ? out : [];
  } catch (e) { return []; }
}

/** High-impact calendar events between `from` and `to` (ms). */
function upcomingHighImpact(cal, from, to) {
  const out = [];
  for (const ev of (cal && cal.events) || []) {
    if (String(ev.impact || '').toLowerCase() !== 'high') continue;
    const at = Date.parse(ev.at || ev.time || ev.datetime || '');
    if (!at || at < from || at > to) continue;
    out.push(Object.assign({}, ev, { atMs: at }));
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

module.exports = { brief, calendar, marketMap, monitor, briefIsFresh, keyPrints, upcomingHighImpact };
