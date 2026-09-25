// Stryker Trading Academy — one place for the monitor-data feed URL (server side).
//
// Mirrors assets/data-config.js on the site. Every Cloud Function that reads
// monitor-data.json (xAutopost.js, refreshWorldData.js) requires this
// instead of hardcoding the raw.githubusercontent.com URL, so the repo can
// go private with one file to repoint.
//
// TODAY: PRIMARY and FALLBACK are the same URL — no behaviour change.
// When the data host moves, change PRIMARY here only; keep FALLBACK as the
// current raw URL until the new host is verified working, then drop it.

const MONITOR_DATA_URL = 'https://raw.githubusercontent.com/theelitegrey/Stryker-trading-academy-/data/monitor-data.json';
const MONITOR_DATA_URL_FALLBACK = 'https://raw.githubusercontent.com/theelitegrey/Stryker-trading-academy-/data/monitor-data.json';

module.exports = { MONITOR_DATA_URL, MONITOR_DATA_URL_FALLBACK };
