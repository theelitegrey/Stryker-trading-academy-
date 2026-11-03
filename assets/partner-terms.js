// TradeZoro Partner programme: terms and pure helpers (partner.html, partners-admin.html).
// EVERY number and name of the programme lives in PARTNER_TERMS below: change a value here and the
// page copy, the form checks and the admin flags follow. The server copy of the grant length is
// functions-src/partnerAdmin.js (GRANT_DAYS); tools/tests/partner-grant.test.js fails if they differ.
(function (root) {
  'use strict';
  var PARTNER_TERMS = {
    minFollowers: 100,
    minAccountMonths: 3,
    postsPerWeek: 2,
    maxLinksPerWeek: 10,
    keepPostsDays: 30,
    grantDays: 31,          // Pro is given this many days at a time
    graceDays: 7,
    missedWeeksToPause: 2,  // missed weeks in one month
    reapplyDays: 30,
    reviewDueDays: 5,       // admin list: "Due for review" this close to proUntil
    historyWeeks: 8,
    handle: '@thetradezoro',
    bioLine: 'Partner @thetradezoro',
    link: 'tradezoro.com',
    tags: ['#partner', '#ad'],
    platforms: [
      { id: 'instagram', name: 'Instagram' },
      { id: 'x', name: 'X' },
      { id: 'youtube', name: 'YouTube' },
      { id: 'tiktok', name: 'TikTok' }
    ]
  };

  // ISO 8601 week key for a date, e.g. "2026-W45" (UTC).
  function isoWeekKey(ms) {
    var d = new Date(ms);
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);              // Thursday of this week decides the year
    var y = d.getUTCFullYear();
    var w = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
    return y + '-W' + (w < 10 ? '0' : '') + w;
  }
  // Monday 00:00 UTC of the week that contains ms.
  function weekStartMs(ms) {
    var d = new Date(ms);
    var day = d.getUTCDay() || 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day - 1));
  }
  // Completed weeks (newest first) since the partner was approved, within the last `lookback` weeks,
  // that have fewer than postsPerWeek links. The current week and the approval week are never counted.
  function missedWeeks(weeks, approvedAtMs, nowMs, lookback) {
    var T = PARTNER_TERMS, out = [];
    if (!approvedAtMs) return out;
    var firstFull = weekStartMs(approvedAtMs) + 7 * 864e5;  // first week that started after approval week
    var cur = weekStartMs(nowMs);
    for (var i = 1; i <= (lookback || T.historyWeeks); i++) {
      var start = cur - i * 7 * 864e5;
      if (start < firstFull) break;
      var key = isoWeekKey(start + 3 * 864e5);
      var n = weeks && Array.isArray(weeks[key]) ? weeks[key].length : 0;
      if (n < T.postsPerWeek) out.push(key);
    }
    return out;
  }
  // Only https links, no spaces, sane length (mirrors the Firestore rule).
  function cleanLink(s) {
    s = String(s || '').trim();
    return /^https:\/\/[^\s]{4,300}$/.test(s) ? s : '';
  }

  var api = { PARTNER_TERMS: PARTNER_TERMS, isoWeekKey: isoWeekKey, weekStartMs: weekStartMs, missedWeeks: missedWeeks, cleanLink: cleanLink };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PartnerTerms = api;
})(typeof window !== 'undefined' ? window : this);
