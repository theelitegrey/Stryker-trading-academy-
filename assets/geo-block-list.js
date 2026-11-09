// TradeZoro - sanctions geo-block list (browser copy) + the country-of-residence options.
// Owner order 09 Nov 2026 via the CoS: TradeZoro is a US LLC; US sanctions (OFAC) forbid serving these places
// at all, free or paid. Matches Stripe's prohibited list (https://stripe.com/legal/restricted-businesses)
// PLUS Russia and Belarus. Canonical copy: functions/_geo-block.js (tools/tests/geo-block.test.mjs checks they agree).
// The browser copy is for the sign-up picker only; the real checks run at Cloudflare's edge and in Cloud Functions.
// Depends on: nothing. Exposes window.TZGeoBlock.
(function () {
  var BLOCKED_COUNTRIES = ['CU', 'IR', 'KP', 'SY', 'RU', 'BY'];
  var BLOCKED_UA_REGIONS = ['43', '40', '14', '09'];
  var REGION_MESSAGE = "TradeZoro isn't available in your region. Due to US regulations, we can't offer our services in this location.";
  var ATTEST_TEXT = 'I confirm I am not located in, ordinarily resident in, or a citizen of Cuba, Iran, North Korea, Syria, Russia, Belarus, or the Crimea, Donetsk or Luhansk regions.';
  // ISO 3166-1 alpha-2 (plus XK Kosovo). Names come from the browser (Intl.DisplayNames) so the list stays short.
  var CODES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ');
  // Picker-only entries so a resident of an occupied region can say so (and is then shown the region message).
  var UA_REGION_OPTIONS = [['UA-43', 'Ukraine - Crimea'], ['UA-40', 'Ukraine - Sevastopol'], ['UA-14', 'Ukraine - Donetsk region'], ['UA-09', 'Ukraine - Luhansk region']];

  function isBlockedResidence(code) {
    var s = String(code || '').trim().toUpperCase();
    if (!s) return false;
    var p = s.split('-');
    if (BLOCKED_COUNTRIES.indexOf(p[0]) !== -1) return true;
    return p[0] === 'UA' && !!p[1] && BLOCKED_UA_REGIONS.indexOf(p[1].length === 1 ? '0' + p[1] : p[1]) !== -1;
  }
  function countryName(code) {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch (e) { return code; }
  }
  // [{code, name, blocked}] sorted by name; blocked places included (shown disabled) so people see why.
  function options() {
    var list = CODES.map(function (c) { return { code: c, name: countryName(c), blocked: isBlockedResidence(c) }; });
    UA_REGION_OPTIONS.forEach(function (r) { list.push({ code: r[0], name: r[1], blocked: true }); });
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return list;
  }
  // Fills a <select>: placeholder first; blocked places are listed with "(not available)" so the picker can show the
  // region message when one is chosen (the form then refuses to continue; an existing member is locked).
  function fillSelect(sel) {
    if (!sel || sel.options.length > 1) return;
    var ph = document.createElement('option');
    ph.value = ''; ph.textContent = 'Select your country'; ph.disabled = true; ph.selected = true;
    sel.appendChild(ph);
    options().forEach(function (o) {
      var op = document.createElement('option');
      op.value = o.code;
      op.textContent = o.blocked ? o.name + ' (not available)' : o.name;
      if (o.blocked) op.setAttribute('data-blocked', '1');
      sel.appendChild(op);
    });
  }
  window.TZGeoBlock = { BLOCKED_COUNTRIES: BLOCKED_COUNTRIES, BLOCKED_UA_REGIONS: BLOCKED_UA_REGIONS, REGION_MESSAGE: REGION_MESSAGE,
    ATTEST_TEXT: ATTEST_TEXT, CODES: CODES, isBlockedResidence: isBlockedResidence, options: options, fillSelect: fillSelect, countryName: countryName };
})();
