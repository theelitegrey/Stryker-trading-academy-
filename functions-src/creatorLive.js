/**
 * Creator payments: live-mode readiness probe. Shared by the creatorPay gate (functions) and tools/creator-pay/live-check.js.
 * Only READ / list calls. Nothing is created, nothing moves money. Never returns or logs the key.
 * probe(key, fetchFn) -> { ok, results: [{ id, label, needs, pass, status }] }
 */
'use strict';

const V1 = 'https://api.stripe.com/v1/';
const V1_VERSION = '2024-06-20';
const V2_VERSION = '2026-09-30.endive';

// id, what the Owner ticks in the restricted-key screen, request
const CHECKS = [
  { id: 'accounts_v2',  label: 'Accounts v2 (create/read connected accounts)', needs: 'Connect > Accounts: Write', v2: 'core/accounts?limit=1' },
  { id: 'accounts_v1',  label: 'Accounts (read, v1)',                            needs: 'Connect > Accounts: Write', path: 'accounts?limit=1' },
  { id: 'account_links', label: 'Account Links',                                 needs: 'Connect > Account Links: Write', probe: 'link' },
  { id: 'login_links',  label: 'Login Links',                                    needs: 'Connect > Login Links: Write', probe: 'login' },
  { id: 'products',     label: 'Products',                                       needs: 'Products: Write', path: 'products?limit=1', wpost: 'products/prod_0000000000000000', acct: true },
  { id: 'prices',       label: 'Prices',                                         needs: 'Prices: Write', path: 'prices?limit=1', wpost: 'prices/price_0000000000000000', acct: true },
  { id: 'customers',    label: 'Customers',                                      needs: 'Customers: Write', path: 'customers?limit=1', wpost: 'customers/cus_0000000000000000', acct: true },
  { id: 'checkout',     label: 'Checkout Sessions',                              needs: 'Checkout Sessions: Write', path: 'checkout/sessions?limit=1', wpost: 'checkout/sessions/cs_live_0000000000000000/expire', acct: true },
  { id: 'subscriptions', label: 'Subscriptions',                                 needs: 'Subscriptions: Write', path: 'subscriptions?limit=1', wpost: 'subscriptions/sub_0000000000000000', acct: true },
  { id: 'portal',       label: 'Billing portal (configurations + sessions)',     needs: 'Customer portal: Write', path: 'billing_portal/configurations?limit=1', wpost: 'billing_portal/configurations/bpc_0000000000000000', acct: true },
  { id: 'charges',      label: 'Charges (read)',                                 needs: 'Charges: Read', path: 'charges?limit=1', acct: true },
  { id: 'disputes',     label: 'Disputes (read)',                                needs: 'Disputes: Read', path: 'disputes?limit=1', acct: true },
  { id: 'invoices',     label: 'Invoices (read)',                                needs: 'Invoices: Read', path: 'invoices?limit=1', acct: true }
];

async function call(fetchFn, key, url, version, acct, method, body) {
  const headers = { Authorization: 'Bearer ' + key, 'Stripe-Version': version };
  if (acct) headers['Stripe-Account'] = acct;
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  const r = await fetchFn(url, { method: method || 'GET', headers, body, signal: AbortSignal.timeout(15000) });
  let j = {}; try { j = await r.json(); } catch (e) { /* ignore */ }
  return { status: r.status, json: j };
}

// Denied = the key lacks a permission. Stripe also answers 403 "does not have access to account ... (or that account does not exist)"
// for a made-up account id: that means "no such account", so the key is allowed. Real denial says "required permissions".
function denied(res) {
  const e = (res.json && res.json.error) || {};
  const m = String(e.message || '');
  if (/does not have access to account|account does not exist/i.test(m) && !/required permissions/i.test(m)) return false;
  if (/required permissions|not allowed|permission/i.test(m) || /permission/i.test(String(e.type || '') + ' ' + String(e.code || ''))) return true;
  return res.status === 401 || res.status === 403;
}

async function probe(key, fetchFn) {
  fetchFn = fetchFn || fetch;
  const results = [];
  let acct = null, acctNote = '';
  // Find one connected account so Stripe-Account header calls can be tried (if the platform has none yet, the same list call runs on the platform itself: the key permission is the same).
  try {
    const l = await call(fetchFn, key, V1 + 'accounts?limit=1', V1_VERSION);
    if (l.status === 200 && l.json.data && l.json.data[0]) acct = l.json.data[0].id;
  } catch (e) { /* the accounts check below reports it */ }
  for (const c of CHECKS) {
    let status = 0, pass = false, skip = false;
    try {
      let res;
      if (c.v2) res = await call(fetchFn, key, 'https://api.stripe.com/v2/' + c.v2, V2_VERSION);
      else if (c.probe === 'link') res = await call(fetchFn, key, V1 + 'account_links', V1_VERSION, null, 'POST', 'account=acct_0000000000000000&type=account_onboarding');
      else if (c.probe === 'login') res = await call(fetchFn, key, V1 + 'accounts/acct_0000000000000000/login_links', V1_VERSION, null, 'POST', '');
      else res = await call(fetchFn, key, V1 + c.path, V1_VERSION, c.acct ? acct : null);   // no connected account yet: same list call on the platform (same key permission)
      if (c.wpost && !denied(res) && res.status === 200) {
        // Write permission: an UPDATE of an id that does not exist. Never creates anything. 404 = allowed, 403 = not allowed.
        const w = await call(fetchFn, key, V1 + c.wpost, V1_VERSION, c.acct ? acct : null, 'POST', c.wpost.indexOf('/expire') > 0 ? '' : 'metadata[probe]=1');
        res = denied(w) ? w : res;
      }
      status = res.status;
      // The fake-account probes (links) never succeed; a permission denial is the only thing counted as FAIL.
      pass = !skip && !denied(res) && (c.probe ? status >= 400 && status < 500 : status === 200);
      if (c.probe && !denied(res) && status >= 400 && status < 500) pass = true;
    } catch (e) { status = -1; pass = false; }
    results.push({ id: c.id, label: c.label, needs: c.needs, pass, skip, status });
  }
  return { ok: results.every((r) => r.pass), results, hadAccount: !!acct };
}

// Server-side cached readiness. Live mode only. Positive cached 10 min, negative 60 s.
let CACHE = null;
async function liveReady(key, hasWebhookSecret, fetchFn) {
  const t = Date.now();
  if (!hasWebhookSecret) return { ready: false, reason: 'webhook_secret_missing' };
  if (CACHE && CACHE.key === key && t - CACHE.at < (CACHE.ready ? 600000 : 60000)) return { ready: CACHE.ready, reason: CACHE.reason };
  let ready = false, reason = 'key_permissions';
  try { const p = await probe(key, fetchFn); ready = p.ok; reason = ready ? 'ok' : 'key_permissions'; }
  catch (e) { ready = false; reason = 'probe_error'; }
  CACHE = { key, at: t, ready, reason };
  return { ready, reason };
}
function resetCache() { CACHE = null; }

module.exports = { CHECKS, probe, liveReady, resetCache, denied };
