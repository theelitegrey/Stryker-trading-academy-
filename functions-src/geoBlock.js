// SANCTIONS GEO-BLOCK: the one list of places TradeZoro does not serve (Cloud Functions copy, CommonJS).
// Owner order 09 Nov 2026 via the CoS ("no chances"): TradeZoro is a US LLC, so US sanctions (OFAC) forbid serving
// these places at all, free or paid. The list matches Stripe's prohibited-countries list
// (https://stripe.com/legal/restricted-businesses and https://docs.stripe.com/payments/countries-and-regions),
// PLUS Russia and Belarus by the Owner's own decision.
// Canonical copy: functions/_geo-block.js. tools/tests/geo-block.test.mjs fails if the lists drift.
// Cloud Functions are NOT behind Cloudflare, so here the check runs on what the member told us
// (students/{uid}.residenceCountry) and on what Stripe tells us (billing address country, card country).
const BLOCKED_COUNTRIES = ['CU', 'IR', 'KP', 'SY', 'RU', 'BY'];
const BLOCKED_UA_REGIONS = ['43', '40', '14', '09'];
const UA_REGION_NAMES = /crimea|krym|sevastopol|donetsk|luhansk|lugansk|крим|крым|севастопол|донецьк|донецк|луганськ|луганск/i;
// Ukrainian postal codes (first two digits): Donetsk oblast 83-87, Luhansk oblast 91-94, Crimea 95-98, Sevastopol 99.
// Whole oblasts, on purpose (Owner: "no chances").
const UA_BLOCKED_POSTAL = /^(8[3-7]|9[1-9])\d{3}$/;
const REGION_MESSAGE = "TradeZoro isn't available in your region. Due to US regulations, we can't offer our services in this location.";

function normRegion(code) {
  let r = String(code || '').trim().toUpperCase();
  if (r.startsWith('UA-')) r = r.slice(3);
  if (/^\d$/.test(r)) r = '0' + r;
  return r;
}
function isBlockedPlace(country, region, regionName) {
  const c = String(country || '').trim().toUpperCase();
  if (BLOCKED_COUNTRIES.includes(c)) return true;
  if (c === 'UA') {
    if (BLOCKED_UA_REGIONS.includes(normRegion(region))) return true;
    if (regionName && UA_REGION_NAMES.test(String(regionName))) return true;
  }
  return false;
}
// students/{uid}.residenceCountry is either an ISO2 ("US") or a blocked-region code ("UA-43"), see assets/geo-block-list.js.
function isBlockedResidence(code) {
  const s = String(code || '').trim().toUpperCase();
  if (!s) return false;
  const [c, r] = s.split('-');
  return isBlockedPlace(c, r ? 'UA-' + r : '');
}
// A Stripe address object ({country, state, city, line1...}). For UA the state field may hold the oblast name or code.
function isBlockedAddress(addr) {
  if (!addr || typeof addr !== 'object') return false;
  const c = String(addr.country || '').toUpperCase();
  if (BLOCKED_COUNTRIES.includes(c)) return true;
  if (c !== 'UA') return false;
  const text = [addr.state, addr.city, addr.line1, addr.line2].filter(Boolean).join(' ');
  if (isBlockedPlace('UA', addr.state, text)) return true;
  return UA_BLOCKED_POSTAL.test(String(addr.postal_code || addr.postalCode || '').replace(/\s/g, ''));
}

// Payment signals -> verdict. signals: { residence, cardCountries: [], addresses: [] } (Stripe address objects).
// blocked: any signal points to a blocked place. unknown: no card country AND no billing country at all.
function paymentVerdict(signals) {
  const s = signals || {};
  const cards = (s.cardCountries || []).filter(Boolean).map((c) => String(c).toUpperCase());
  const addrs = (s.addresses || []).filter((a) => a && a.country);
  if (s.locked === true) return { blocked: true, reason: 'locked' };
  if (isBlockedResidence(s.residence)) return { blocked: true, reason: 'residence', country: String(s.residence).toUpperCase() };
  const card = cards.find((c) => BLOCKED_COUNTRIES.includes(c));
  if (card) return { blocked: true, reason: 'card', country: card };
  const addr = addrs.find(isBlockedAddress);
  if (addr) return { blocked: true, reason: 'billing', country: String(addr.country).toUpperCase() };
  return { blocked: false, unknown: !cards.length && !addrs.length };
}
// Student doc -> blocked? (locked flag set by the server, or a blocked residence)
function isBlockedStudent(s) {
  return !!(s && (s.sanctionsLocked === true || isBlockedResidence(s.residenceCountry)));
}

// Callable gate for every purchase path (Stripe, free checkout, coupons, Razorpay, creator checkout). Throws an
// HttpsError (failed-precondition) built with the caller's own functions module. billingCountry: optional client value.
function assertCanBuy(functions, student, billingCountry) {
  const s = student || {};
  if (isBlockedStudent(s) || (billingCountry && isBlockedResidence(billingCountry))) {
    throw new functions.https.HttpsError('failed-precondition', REGION_MESSAGE, { code: 'unavailable_region' });
  }
  if (!s.residenceCountry || s.sanctionsAttest !== true) {
    throw new functions.https.HttpsError('failed-precondition',
      'Please confirm your country of residence first: reload this page and answer the short question.', { code: 'residence_required' });
  }
}

module.exports = { BLOCKED_COUNTRIES, BLOCKED_UA_REGIONS, REGION_MESSAGE, normRegion, isBlockedPlace, isBlockedResidence, isBlockedAddress,
  isBlockedStudent, paymentVerdict, assertCanBuy };
