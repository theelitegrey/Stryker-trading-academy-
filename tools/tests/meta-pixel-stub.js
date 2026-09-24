// Stub test for assets/meta-pixel.js — no browser, no network.
// Simulates: pixel id present (fake), consent granted, DOM absent (so the
// auto-bootstrap block never runs) — exercises init()/track() directly, the
// same functions the real page calls once Firestore hands back an id.
'use strict';
const assert = require('assert');
const path = require('path');

const modPath = path.join(__dirname, '..', '..', 'assets', 'meta-pixel.js');
delete require.cache[require.resolve(modPath)];
const StrykerPixel = require(modPath);

// ---- fake fbq + fake DOM, just enough for _loadPixelScript()/init() -------
const calls = []; // records every fbq('track', ...) call, in order
function fakeFbq() {
  const args = Array.prototype.slice.call(arguments);
  if (args[0] === 'track') {
    calls.push({ event: args[1], params: args[2], eventId: (args[3] || {}).eventID });
  }
}
fakeFbq.queue = [];
fakeFbq.callMethod = function () { fakeFbq.apply(null, arguments); };

const fakeScriptEl = { async: false, src: '' };
const fakeAnchor = { parentNode: { insertBefore: function () {} } };
global.document = {
  createElement: function () { return fakeScriptEl; },
  getElementsByTagName: function () { return [fakeAnchor]; },
  addEventListener: function () {} // stub: never fires, so the auto-bootstrap block never runs here
};
global.window = global; // so `root` in the module resolves consistently
global.window.fbq = fakeFbq; // pre-seed so init()'s `_loadPixelScript` no-ops and our fake stays wired

// 1. Before init(): disabled, track() is silently swallowed (still returns an id).
const preId = StrykerPixel.track('PageView', {});
assert.ok(preId, 'track() should always return an id, even disabled');
assert.strictEqual(calls.length, 0, 'no fbq calls before init() — pixel must stay silent with no id');

// 2. init() with a fake id + consent granted -> fires PageView immediately.
const ok = StrykerPixel.init('fake_pixel_id_123', global.window);
assert.strictEqual(ok, true, 'init() should report enabled when id + consent are both present');
assert.strictEqual(calls.length, 1, 'init() should fire exactly one PageView');
assert.strictEqual(calls[0].event, 'PageView');
assert.ok(calls[0].eventId, 'PageView call must carry an event_id');

// 3. Explicit events in order, each with an event_id, InitiateCheckout -> Purchase
// with a shared, caller-supplied id (dedup key with the server CAPI call).
const leadId = StrykerPixel.track('Lead', { content_name: 'cheat sheet' });
const checkoutId = StrykerPixel.track('InitiateCheckout', { value: 49, currency: 'USD' });
const purchaseId = StrykerPixel.track('Purchase', { value: 49, currency: 'USD' }, 'purchase_order_123');

assert.strictEqual(calls.length, 4, 'PageView + Lead + InitiateCheckout + Purchase, in order');
assert.deepStrictEqual(calls.map(c => c.event), ['PageView', 'Lead', 'InitiateCheckout', 'Purchase']);
assert.strictEqual(calls[3].eventId, 'purchase_order_123', 'Purchase event_id must be the caller-supplied dedup key');
assert.notStrictEqual(calls[1].eventId, calls[2].eventId, 'auto-generated ids must differ between calls');
assert.strictEqual(leadId, calls[1].eventId);
assert.strictEqual(checkoutId, calls[2].eventId);
assert.strictEqual(purchaseId, 'purchase_order_123');

// 4. Consent declined -> init() must refuse and stay silent (no fbq calls at all).
delete require.cache[require.resolve(modPath)];
const StrykerPixel2 = require(modPath);
calls.length = 0;
const fakeWinDeclined = { localStorage: { getItem: function (k) { return k === 'stryker_consent' ? JSON.stringify({ marketing: false }) : null; } }, fbq: fakeFbq };
const declinedOk = StrykerPixel2.init('fake_pixel_id_456', fakeWinDeclined);
assert.strictEqual(declinedOk, false, 'init() must refuse when consent is explicitly declined');
StrykerPixel2.track('PageView', {});
assert.strictEqual(calls.length, 0, 'no fbq calls at all when consent is declined');

// 5. Sale price + coupon + INR: what the caller (checkout.js) actually sends
// is what the pixel must relay untouched — never re-derived, never defaulted
// back to a list price or to USD. This mirrors checkoutTotalDue()'s math
// (sale price, minus a coupon, in whatever currency the page is showing)
// without needing checkout.js's DOM, and is the regression guard for the
// "Purchase/InitiateCheckout sent list price in USD" bug this fixes.
delete require.cache[require.resolve(modPath)];
const StrykerPixel3 = require(modPath);
calls.length = 0;
global.window.fbq = fakeFbq;
StrykerPixel3.init('fake_pixel_id_789', global.window);
calls.length = 0; // drop the auto-fired PageView, only the events below matter here

const listPriceUsd = 199;      // Elite plan list price
const salePriceUsd = 149;      // active launch-sale price
const couponOff = 20;          // fixed coupon on top of the sale price
const usdInrRate = 88;
const totalDueUsd = Math.max(salePriceUsd - couponOff, 0); // 129 — checkoutTotalDue()'s math
const totalDueInr = Math.round(totalDueUsd * usdInrRate);  // 11352 — planMoneyDisplay's rounding

// InitiateCheckout in INR (Indian visitor, sale + coupon already applied).
StrykerPixel3.track('InitiateCheckout', { content_name: 'Elite', value: totalDueInr, currency: 'INR' });
// Purchase in INR for the same order, with the server-dedup event_id — the
// value here comes from the Razorpay order (o.amount/100, o.currency), which
// for an INR order equals the same rounded rupee total the page showed.
StrykerPixel3.track('Purchase', { content_name: 'Elite', value: totalDueInr, currency: 'INR' }, 'purchase_order_inr_1');

assert.strictEqual(calls.length, 2, 'InitiateCheckout + Purchase only (PageView from init() was dropped above)');
const [checkoutCall, purchaseCall] = calls;
assert.strictEqual(checkoutCall.event, 'InitiateCheckout');
assert.strictEqual(checkoutCall.params.value, 11352, 'InitiateCheckout must carry the sale+coupon rupee total, not the USD list price');
assert.strictEqual(checkoutCall.params.currency, 'INR');
assert.strictEqual(purchaseCall.event, 'Purchase');
assert.strictEqual(purchaseCall.params.value, 11352, 'Purchase must carry the actually-charged rupee amount, not the USD list price');
assert.strictEqual(purchaseCall.params.currency, 'INR');
assert.strictEqual(purchaseCall.eventId, 'purchase_order_inr_1');
assert.notStrictEqual(checkoutCall.params.value, listPriceUsd, 'sanity: the relayed value must differ from the raw USD list price');

console.log('ALL PASS — meta-pixel.js stub test (event order + event_ids + consent gate)');
