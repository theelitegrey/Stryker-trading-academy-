/**
 * Stryker Trading Academy — Meta Conversions API helper (server side)
 *
 * WHAT THIS IS
 * A single sendEvent() call used from a few marked hook points (Razorpay
 * verify-payment success, sign-up). It does nothing — no network call, no
 * throw, no log noise beyond one debug line — unless BOTH of these are set:
 *   - process.env.META_CAPI_TOKEN   (a Meta system-user access token)
 *   - process.env.META_PIXEL_ID     (the same pixel id the browser loader
 *                                     reads from settings/commerce.metaPixelId)
 * Neither exists yet, so today this module is inert everywhere it's called.
 *
 * WHY IT CAN NEVER BLOCK PAYMENT OR SIGN-UP
 * sendEvent() never throws — every failure path (missing config, network
 * error, non-2xx response) resolves the promise instead of rejecting it. The
 * one-line call sites additionally wrap it in try/catch + .catch() as a
 * second layer, so a bug in this file, a Meta outage, or a slow network
 * can never delay or fail the payment/sign-up flow that calls it.
 *
 * WHAT IT SENDS
 *   - event_name, event_time, event_id  (event_id is shared with the browser
 *     pixel call for the same real-world event, so Meta dedupes the two
 *     deliveries of one event rather than double-counting it)
 *   - event_source_url                  (the page the action happened on)
 *   - action_source: 'website'
 *   - user_data.em / external_id        (SHA-256 hashed per Meta's spec —
 *     raw email/uid are NEVER sent)
 *   - custom_data                       (event-specific — e.g. value+currency
 *     for Purchase)
 *
 * DEPLOY (once ids exist — NOT yet):
 *   firebase functions:secrets:set META_CAPI_TOKEN
 *   cat >> .env << 'ENV'
 *   META_PIXEL_ID=...
 *   ENV
 * Nothing else changes: the call sites already exist and are already
 * wired, they just stay silent until the two values above are set.
 */

const crypto = require('crypto');

const GRAPH_VERSION = 'v21.0';

function sha256Lower(value) {
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

/**
 * Send one event to the Meta Conversions API. Resolves with
 * { sent: boolean, reason?: string } — it never rejects.
 *
 * @param {Object} opts
 * @param {string} opts.eventName        e.g. 'Purchase', 'Lead', 'CompleteRegistration', 'InitiateCheckout'
 * @param {string} opts.eventId          shared with the matching browser pixel call, for dedup
 * @param {string} opts.eventSourceUrl   the page the action happened on
 * @param {string} [opts.email]          plaintext email — hashed here, never sent raw
 * @param {string} [opts.externalId]     plaintext uid — hashed here, never sent raw
 * @param {Object} [opts.customData]     e.g. { value: 49, currency: 'USD' } for Purchase
 * @param {string} [opts.clientIpAddress]
 * @param {string} [opts.clientUserAgent]
 * @param {Function} [opts.fetchImpl]    injectable for tests; defaults to global fetch
 */
async function sendEvent(opts) {
  const token = process.env.META_CAPI_TOKEN;
  const pixelId = process.env.META_PIXEL_ID;
  if (!token || !pixelId) {
    // Not configured — this is the expected state until ids exist. Silent,
    // not an error: logging on every call would spam the function logs on
    // every single payment/sign-up, forever, until someone configures it.
    return { sent: false, reason: 'not_configured' };
  }
  if (!opts || !opts.eventName || !opts.eventId) {
    return { sent: false, reason: 'missing_required_fields' };
  }

  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) {
    return { sent: false, reason: 'no_fetch_available' };
  }

  const userData = {};
  if (opts.email) userData.em = [sha256Lower(opts.email)];
  if (opts.externalId) userData.external_id = [sha256Lower(opts.externalId)];
  if (opts.clientIpAddress) userData.client_ip_address = opts.clientIpAddress;
  if (opts.clientUserAgent) userData.client_user_agent = opts.clientUserAgent;

  const payload = {
    data: [{
      event_name: opts.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: opts.eventId,
      event_source_url: opts.eventSourceUrl || undefined,
      action_source: 'website',
      user_data: userData,
      custom_data: opts.customData || undefined
    }]
  };

  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;
    const resp = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error('metaCapi.sendEvent: Meta rejected the event', resp.status, body.slice(0, 300));
      return { sent: false, reason: 'http_' + resp.status };
    }
    return { sent: true };
  } catch (e) {
    console.error('metaCapi.sendEvent: request failed', e && e.message);
    return { sent: false, reason: 'request_failed' };
  }
}

module.exports = { sendEvent, sha256Lower, __internals: { GRAPH_VERSION } };
