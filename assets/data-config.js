// Stryker Trading Academy — one place for the monitor-data feed URL.
//
// WHY THIS FILE EXISTS
// Every reader of monitor-data.json (Global Monitor, dashboard overview,
// homepage ticker, admin AI brief) used to hardcode
// 'https://raw.githubusercontent.com/theelitegrey/Stryker-trading-academy-/data/monitor-data.json'
// directly. The repo is moving to private, and raw.githubusercontent.com
// stops serving that URL the moment it does (private raw links need a
// token, which a public static site can never hold). This file gives every
// reader ONE constant to repoint instead of six.
//
// TODAY: PRIMARY and FALLBACK are the same URL, so nothing changes live.
// When the data host moves (see reports/workers/w1-private-prep.md for the
// plan), only PRIMARY changes here — FALLBACK stays the current raw URL
// until the flip is confirmed working, then gets removed.
//
// Depends on: nothing. Load this before global-monitor.js, dash-overview.js,
// home-motion.js, admin-ai.js.

var STRYKER_MONITOR_DATA_URL = 'https://raw.githubusercontent.com/theelitegrey/Stryker-trading-academy-/data/monitor-data.json';
var STRYKER_MONITOR_DATA_URL_FALLBACK = 'https://raw.githubusercontent.com/theelitegrey/Stryker-trading-academy-/data/monitor-data.json';

// Wraps a one-argument fetch function (url -> Promise) so callers get the
// fallback URL for free: try PRIMARY, and only if it rejects (network error,
// non-2xx handled by the caller as a throw/rejection) try FALLBACK. When the
// two constants are equal (today) this costs nothing extra on success and
// simply reports the same failure twice on total outage.
function strykerFetchMonitorData(fetchOneUrl) {
  return fetchOneUrl(STRYKER_MONITOR_DATA_URL).catch(function (err) {
    if (STRYKER_MONITOR_DATA_URL_FALLBACK === STRYKER_MONITOR_DATA_URL) throw err;
    return fetchOneUrl(STRYKER_MONITOR_DATA_URL_FALLBACK);
  });
}
