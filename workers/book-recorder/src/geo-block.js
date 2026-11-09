// SANCTIONS GEO-BLOCK: the one list of places TradeZoro does not serve (Pages Functions copy, ES module).
// Owner order 09 Nov 2026 via the CoS ("no chances"): TradeZoro is a US LLC, so US sanctions (OFAC) forbid serving
// these places at all, free or paid. The list matches Stripe's prohibited-countries list
// (https://stripe.com/legal/restricted-businesses and https://docs.stripe.com/payments/countries-and-regions),
// PLUS Russia and Belarus by the Owner's own decision.
// COPIES (keep identical; tools/tests/geo-block.test.mjs fails if they drift):
//   functions/_geo-block.js (this file), workers/book-recorder/src/geo-block.js, workers/discord-roles/src/geo-block.js,
//   functions-src/geoBlock.js (Cloud Functions, CommonJS), assets/geo-block-list.js (browser).
// Ukraine regions: Cloudflare request.cf.regionCode is the ISO 3166-2 subdivision code WITHOUT the "UA-" prefix
// (Crimea "43", Sevastopol "40", Donetsk "14", Luhansk "09"); we also accept "UA-43", lower case and an unpadded "9".
export const BLOCKED_COUNTRIES = ['CU', 'IR', 'KP', 'SY', 'RU', 'BY'];
export const BLOCKED_UA_REGIONS = ['43', '40', '14', '09'];
// Backup when a region code is missing but the region NAME is present (cf.region).
const UA_REGION_NAMES = /crimea|krym|sevastopol|donetsk|luhansk|lugansk/i;

export function normRegion(code) {
  let r = String(code || '').trim().toUpperCase();
  if (r.startsWith('UA-')) r = r.slice(3);
  if (/^\d$/.test(r)) r = '0' + r;
  return r;
}

// country: ISO2; region: ISO 3166-2 subdivision (with or without "UA-"); regionName: optional free text.
export function isBlockedPlace(country, region, regionName) {
  const c = String(country || '').trim().toUpperCase();
  if (BLOCKED_COUNTRIES.includes(c)) return true;
  if (c === 'UA') {
    if (BLOCKED_UA_REGIONS.includes(normRegion(region))) return true;
    if (regionName && UA_REGION_NAMES.test(String(regionName))) return true;
  }
  return false;
}

// Cloudflare request -> blocked? Uses request.cf (set by Cloudflare's edge), cf-ipcountry as a fallback.
export function isBlockedRequest(request) {
  const cf = (request && request.cf) || {};
  const country = cf.country || (request && request.headers && request.headers.get('cf-ipcountry')) || '';
  return isBlockedPlace(country, cf.regionCode, cf.region);
}

export const REGION_MESSAGE = "TradeZoro isn't available in your region. Due to US regulations, we can't offer our services in this location.";

// Worker answer for blocked visitors (JSON APIs, websocket upgrades).
export function blockedJson(extraHeaders) {
  return new Response(JSON.stringify({ error: 'unavailable_region', message: REGION_MESSAGE }), {
    status: 451,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', vary: 'cf-ipcountry' }, extraHeaders || {})
  });
}
