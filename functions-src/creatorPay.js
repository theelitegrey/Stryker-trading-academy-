/**
 * TradeZoro Creator Hub: creators get paid for paid community plans through STRIPE CONNECT.
 *
 * MODEL (CoS 2026-10-30; liability stays with the seller, as in the Creator Terms draft "the creator handles refunds
 * and taxes"):
 *   - Each creator has ONE connected account, created with controller properties (no account `type`):
 *       controller.stripe_dashboard.type = 'full'     the creator gets the full Stripe Dashboard
 *       controller.fees.payer            = 'account'  Stripe bills its processing fees to the creator's account
 *       controller.losses.payments       = 'stripe'   the PLATFORM is not liable for the creator's negative balances
 *                                                     (refunds, chargebacks); Stripe recovers them from the creator
 *       controller.requirement_collection = 'stripe'  Stripe-hosted onboarding, Stripe does the KYC
 *     Stripe REFUSES dashboard 'express' with losses 'stripe' ("When stripe_dashboard[type]=express, your platform must
 *     collect fees and be liable for negative balances or refunds and chargebacks"), so 'full' is the only setting that
 *     keeps TradeZoro out of the loss chain. Docs: https://docs.stripe.com/connect/migrate-to-controller-properties
 *     and https://docs.stripe.com/connect/direct-charges ("recommended for accounts with the full Stripe Dashboard").
 *   - DIRECT CHARGES: every Checkout Session, Customer, Product, Price and Subscription lives ON THE CREATOR'S ACCOUNT
 *     (Stripe-Account header). Platform fee = settings/commerce.creatorFeePct (a percent, 0 at launch: Founding
 *     Creators). One-time: payment_intent_data.application_fee_amount = round(cents * pct / 100), only sent when > 0.
 *     Subscriptions: subscription_data.application_fee_percent = pct, only sent when > 0. Never hard-coded.
 *   - Payouts: Stripe's automatic schedule on the creator's account. We never move money.
 *
 * SWITCH: settings/commerce.creatorPayments (default false). gate():
 *   live key  -> open when the switch is on; admins and QA throwaways (stryker-qa-*@example.com) may always test
 *   test key  -> admins and QA throwaways only (a test card must never buy real access)
 *
 * CALLABLE  creatorPay({ action, ... })
 *   status     {}                       my payout record, refreshed from Stripe when I have an account
 *   onboard    { country, agree, cid }  create my connected account (once) + a Stripe-hosted onboarding link
 *   dashboard  {}                       a login link to the Stripe Dashboard (full-dashboard accounts: stripe.com login)
 *   checkout   { cid, planId }          a Checkout Session on the creator's account; returns { url }
 *   portal     { cid }                  Billing Portal session on the creator's account for my subscription
 *   cancel     { cid, resume? }         cancel (at period end) / resume my subscription
 *   suspend    { cid, suspend, reason } ADMIN: suspend/unsuspend a community; suspension stops renewals at period end
 *   adminList  {}                       ADMIN: every creator's payout status
 * HTTPS     creatorConnectWebhook   Connect endpoint (events FROM connected accounts), own secret
 *           STRIPE_CONNECT_WEBHOOK_SECRET. No secret = every event refused (500, Stripe retries). Bad signature = 400.
 *
 * FIRESTORE (written only here; rules: functions-src/firestore.rules "CREATOR PAYMENTS")
 *   creatorAccounts/{uid}   payout status (owner + admins read, nobody writes from a client)
 *   creatorSales/{id}       one doc per paid invoice / one-time payment (creator + admins read)
 *   creatorSubs/{subId}, creatorSessions/{id}, creatorCustomers/{id}, creatorPrices/{id}, creatorEvents/{id}: functions only
 *   communities/{cid}.sellerReady / sellerStatus, communities/{cid}/members/{uid} (source 'paid', pay.{...}).
 *
 * ENV: STRIPE_SECRET_KEY (existing, unchanged), STRIPE_CONNECT_WEBHOOK_SECRET (live Connect endpoint secret), STRIPE_CONNECT_WEBHOOK_SECRET_TEST (optional, test endpoint), SITE_ORIGIN (optional).
 * LEGAL NAME: settings/commerce.creatorPlatformLegalName (default 'Gaurav Singh LLC'); one Firestore edit changes every creator-payments text.
 * LIVE GATE: live key + creatorPayments=true still refuse paid actions until creatorLive.liveReady() passes (key permissions) and a webhook secret is set.
 * DEPLOY: firebase deploy --only functions:creatorPay,functions:creatorConnectWebhook
 * TESTS: node tools/creator-pay/paytest.js (offline); node tools/creator-pay/live-check.js (live key permissions, read-only).
 */
'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const STRIPE_API = 'https://api.stripe.com/v1/';
const STRIPE_VERSION = '2024-06-20';
const GRACE_MS = 3 * 86400000;          // past_due grace after a failed renewal (and webhook-lag cover)
const MIN_USD = 1, MAX_USD = 999, MAX_TRIAL = 30;
const QA_EMAIL = /^stryker-qa-[a-z0-9._-]+@example\.com$/i;
const RULES_VERSION = '2026-10-30';
// Countries a creator can pick for payouts. Stripe self-serve Connect countries; India (and other invite-only Stripe
// countries) are left out: Stripe accounts in India are invite-only, so a platform outside India cannot onboard an
// India-based creator by itself (https://support.stripe.com/questions/stripe-accounts-are-invite-only-in-india).
// Kept in step with assets/creator-config.js PAYOUT_COUNTRIES (paytest.js checks they match).
const PAYOUT_COUNTRIES = ['AT', 'AU', 'BE', 'BG', 'CA', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GI', 'GR',
  'HK', 'HR', 'HU', 'IE', 'IT', 'JP', 'LI', 'LT', 'LU', 'LV', 'MT', 'MX', 'NL', 'NO', 'NZ', 'PL', 'PT', 'RO', 'SE', 'SG', 'SI', 'SK',
  'US', 'AE', 'MY', 'TH', 'BR'];
const INTERVALS = { month: 'month', year: 'year', lifetime: null };

const { verifySignature, formEncode } = require('./stripe').__stripeInternals;

const isTestKey = () => /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY || '');
const isLive = () => !isTestKey();
const siteOrigin = () => (process.env.SITE_ORIGIN || 'https://tradezoro.com').replace(/\/$/, '');
const HttpsError = functions.https.HttpsError;
const fail = (code, msg) => new HttpsError(code, msg);
const modeOk = (d) => !!d && (d.live === true) === isLive();
const now = () => Date.now();
const safeId = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '_');

function stripeKey() {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw fail('failed-precondition', 'Card payments are not configured on the server yet.');
  return k;
}

// Stripe REST call; acct = connected account id (Stripe-Account header) for direct charges.
async function stripe(method, path, params, opts) {
  opts = opts || {};
  const headers = { Authorization: 'Bearer ' + stripeKey(), 'Stripe-Version': STRIPE_VERSION, 'Content-Type': 'application/x-www-form-urlencoded' };
  if (opts.acct) headers['Stripe-Account'] = opts.acct;
  if (opts.idem) headers['Idempotency-Key'] = opts.idem;
  let url = STRIPE_API + path, body;
  if (params && method === 'GET') url += (url.includes('?') ? '&' : '?') + formEncode(params);
  else if (params) body = formEncode(params);
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(20000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json && json.error;
    console.error('Stripe ' + method + ' ' + path.split('?')[0] + (opts.acct ? ' @' + opts.acct : '') + ' failed:', res.status,
      (e && (e.type + ' ' + (e.code || '') + ' ' + (e.message || ''))) || '');
    const err = fail(res.status === 401 ? 'permission-denied' : 'internal',
      res.status === 401 ? 'The card-payment gateway rejected our credentials.' : 'The card-payment gateway could not complete that request.');
    err.stripeStatus = res.status; err.stripeCode = e && e.code; err.stripeMessage = e && e.message;
    throw err;
  }
  return json;
}

// Accounts v2 (JSON). Stripe now requires POST /v2/core/accounts to create connected accounts (v1 create is refused for new
// Connect platforms). Everything after creation (GET account, account_links, webhooks) works on the same acct_ id through v1.
const STRIPE_V2_VERSION = '2026-09-30.endive';
async function stripeV2(method, path, body, opts) {
  opts = opts || {};
  const headers = { Authorization: 'Bearer ' + stripeKey(), 'Stripe-Version': STRIPE_V2_VERSION, 'Content-Type': 'application/json' };
  if (opts.idem) headers['Idempotency-Key'] = opts.idem;
  const res = await fetch('https://api.stripe.com/v2/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json && json.error;
    console.error('Stripe v2 ' + method + ' ' + path + ' failed:', res.status, (e && ((e.code || '') + ' ' + (e.message || ''))) || '');
    const err = fail('internal', 'The card-payment gateway could not complete that request.');
    err.stripeStatus = res.status; err.stripeCode = e && e.code; err.stripeMessage = e && e.message;
    throw err;
  }
  return json;
}

function requireAuth(context) {
  if (!context.auth || !context.auth.uid) throw fail('unauthenticated', 'Sign in first.');
  return context.auth.uid;
}
async function isAdminUid(uid) { return (await db.collection('admins').doc(uid).get()).exists; }
async function commerce() {
  const s = await db.collection('settings').doc('commerce').get();
  return s.exists ? s.data() : {};
}
// The platform fee, in percent. 0..30, anything else = 0. Read on every checkout, never cached.
function feePctOf(com) {
  const p = Number(com && com.creatorFeePct);
  return Number.isFinite(p) && p > 0 && p <= 30 ? p : 0;
}
// The platform's legal name for creator payments: settings/commerce.creatorPlatformLegalName (one Firestore edit, no deploy).
const DEFAULT_LEGAL_NAME = 'Gaurav Singh LLC';
function legalNameOf(com) {
  const n = String((com && com.creatorPlatformLegalName) || '').replace(/\s+/g, ' ').trim();
  return n && n.length <= 120 ? n : DEFAULT_LEGAL_NAME;
}
const platformLine = (name) => 'Payments processed by Stripe on the TradeZoro platform, operated by ' + name + '.';

const { liveReady } = require('./creatorLive');
// Live mode: paid actions stay closed until the live key passes the permission probe AND the Connect webhook secret is set.
// Returns { ready, reason }. Test mode is always "ready" (the test gate already limits it to admins and QA).
async function payReady() {
  if (!isLive()) return { ready: true, reason: 'test' };
  return liveReady(stripeKey(), !!connectSecrets().length);
}
const SWITCHING_ON = 'Payouts are being switched on. Paid plans open as soon as the payment setup is finished. Check back soon.';
async function gate(uid, context) {
  const email = String((context.auth.token && context.auth.token.email) || '');
  if (QA_EMAIL.test(email)) return;
  if (await isAdminUid(uid)) return;
  if (!isTestKey() && (await commerce()).creatorPayments === true) {
    if ((await payReady()).ready) return;
    throw fail('failed-precondition', SWITCHING_ON);
  }
  throw fail('failed-precondition', 'Paid checkout opens soon.');
}
function connectSecrets() {
  return [process.env.STRIPE_CONNECT_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET_TEST].map((x) => String(x || '').trim()).filter(Boolean);
}

// ---- account status ----------------------------------------------------------------------------------------------
// Stripe account object -> our record. status: incomplete | pending | active | restricted | disabled
function accountState(a) {
  const req = a.requirements || {};
  const due = [].concat(req.past_due || [], req.currently_due || []).filter((v, i, s) => s.indexOf(v) === i);
  const reason = req.disabled_reason || null;
  let status;
  if (reason && /^rejected/.test(reason)) status = 'disabled';
  else if (a.charges_enabled && a.payouts_enabled) status = 'active';
  else if (!a.details_submitted) status = 'incomplete';
  else if (reason === 'requirements.pending_verification' || (!reason && !due.length)) status = 'pending';
  else status = 'restricted';
  return {
    acct: a.id, country: a.country || null, status,
    chargesEnabled: !!a.charges_enabled, payoutsEnabled: !!a.payouts_enabled, detailsSubmitted: !!a.details_submitted,
    disabledReason: reason,
    currentlyDue: due.slice(0, 20),
    pendingVerification: (req.pending_verification || []).slice(0, 20),
    errors: (req.errors || []).slice(0, 10).map((e) => ({ code: e.code || '', reason: String(e.reason || '').slice(0, 300), field: e.requirement || '' })),
    currentDeadline: req.current_deadline || null,
    live: isLive()
  };
}

// Mirror the account's sellability onto every community the creator owns (the page reads it without a server call).
async function syncCommunities(uid, state) {
  const q = await db.collection('communities').where('ownerUid', '==', uid).get();
  const ready = state.status === 'active';
  await Promise.all(q.docs.map((d) => {
    const c = d.data();
    if (c.sellerReady === ready && c.sellerStatus === state.status) return null;
    return d.ref.set({ sellerReady: ready, sellerStatus: state.status }, { merge: true });
  }));
}

async function saveAccount(uid, a, extra) {
  const state = Object.assign(accountState(a), extra || {}, { updatedAt: FV.serverTimestamp() });
  await db.collection('creatorAccounts').doc(uid).set(state, { merge: true });
  await syncCommunities(uid, state);
  return state;
}

async function myAccount(uid) {
  const s = await db.collection('creatorAccounts').doc(uid).get();
  return s.exists && modeOk(s.data()) && s.data().acct ? s.data() : null;
}

async function uidForAcct(acct) {
  const q = await db.collection('creatorAccounts').where('acct', '==', acct).limit(2).get();
  const hits = q.docs.filter((d) => modeOk(d.data()));
  return hits.length === 1 ? hits[0].id : null;
}

function publicState(rec) {
  if (!rec) return { status: 'none' };
  const keys = ['status', 'country', 'chargesEnabled', 'payoutsEnabled', 'detailsSubmitted', 'disabledReason', 'currentlyDue',
    'pendingVerification', 'errors', 'currentDeadline'];
  const o = {}; keys.forEach((k) => { o[k] = rec[k] === undefined ? null : rec[k]; });
  return o;
}

async function accountLink(acct, cid) {
  const back = siteOrigin() + '/creator?c=' + encodeURIComponent(cid || '') + '&tab=dash&payouts=';
  const link = await stripe('POST', 'account_links', { account: acct, type: 'account_onboarding',
    refresh_url: back + 'refresh', return_url: back + 'return', collection_options: { fields: 'eventually_due' } });
  return link.url;
}

// ---- actions -----------------------------------------------------------------------------------------------------
const actions = {};

actions.status = async (uid) => {
  const rec = await myAccount(uid);
  const com = await commerce();
  const legalName = legalNameOf(com);
  const sw = (isLive() && com.creatorPayments === true) ? { switchingOn: !(await payReady()).ready } : { switchingOn: false };
  if (!rec) return Object.assign({ account: { status: 'none' }, countries: PAYOUT_COUNTRIES, legalName }, sw);
  const a = await stripe('GET', 'accounts/' + rec.acct);
  return Object.assign({ account: publicState(await saveAccount(uid, a)), countries: PAYOUT_COUNTRIES, legalName }, sw);
};

actions.onboard = async (uid, data, context) => {
  const cid = String(data.cid || '');
  const cm = cid ? await db.collection('communities').doc(cid).get() : null;
  if (!cm || !cm.exists || cm.data().ownerUid !== uid) throw fail('permission-denied', 'Open this from your own community.');
  let rec = await myAccount(uid);
  if (!rec) {
    if (data.agree !== true) throw fail('failed-precondition', 'Tick the box to agree to the Creator Rules first.');
    const country = String(data.country || '').toUpperCase();
    if (country === 'IN') throw fail('failed-precondition', 'Payouts for India-based creators are not available yet. Your community can stay free or invite-only.');
    if (PAYOUT_COUNTRIES.indexOf(country) < 0) throw fail('failed-precondition', 'Payouts aren\'t available in your country yet.');
    const email = String((context.auth.token && context.auth.token.email) || '') || undefined;
    let a;
    try {
      // Platform NOT liable: Stripe collects requirements, fees and losses (see header + report). Full Stripe Dashboard for the creator.
      const v2 = await stripeV2('POST', 'core/accounts', {
        contact_email: email, display_name: String(cm.data().ownerName || cm.data().name || 'Creator').slice(0, 100),
        dashboard: 'full',
        identity: { country },
        configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
        defaults: { currency: 'usd', responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
          profile: { business_url: siteOrigin() + '/c/' + cid, product_description: 'Trading education community on TradeZoro (memberships)' } },
        metadata: { uid, cid, platform: 'tradezoro' }
      }, { idem: (isLive() ? 'live_' : 'test_') + 'acct2_' + uid + '_' + country });
      a = await stripe('GET', 'accounts/' + v2.id);   // same acct_ id: v1 view carries charges_enabled / payouts_enabled / requirements
    } catch (e) {
      if (e.stripeStatus === 400 && /country|identity/i.test(e.stripeMessage || '')) throw fail('failed-precondition', 'Payouts aren\'t available in your country yet.');
      throw e;
    }
    rec = await saveAccount(uid, a, { createdAt: FV.serverTimestamp(), rulesAcceptedAt: FV.serverTimestamp(), rulesVersion: RULES_VERSION, cid });
  }
  if (rec.status === 'disabled') throw fail('failed-precondition', 'Stripe has closed payouts on this account. Contact Stripe support from your Stripe Dashboard.');
  return { url: await accountLink(rec.acct, cid) };
};

actions.dashboard = async (uid) => {
  const rec = await myAccount(uid);
  if (!rec) throw fail('not-found', 'Set up payouts first.');
  // Full-dashboard accounts sign in at dashboard.stripe.com; login links are only for Express-style accounts.
  try { const l = await stripe('POST', 'accounts/' + rec.acct + '/login_links', {}); return { url: l.url }; }
  catch (e) { return { url: 'https://dashboard.stripe.com/' + (isTestKey() ? 'test/' : '') + 'dashboard' }; }
};

function priceShape(plan) {
  const pr = plan.price || {};
  const interval = pr.interval;
  if (!(interval in INTERVALS)) throw fail('failed-precondition', 'This plan can\'t be bought online.');
  if (pr.currency !== 'USD') throw fail('failed-precondition', 'Paid plans are sold in US dollars only.');
  const amt = Number(pr.amount);
  if (!(amt >= MIN_USD && amt <= MAX_USD)) throw fail('failed-precondition', 'This plan\'s price is outside $1 to $999.');
  const cents = Math.round(amt * 100);
  const trial = interval === 'lifetime' ? 0 : Math.max(0, Math.min(MAX_TRIAL, parseInt(plan.trialDays, 10) || 0));
  return { interval, cents, trial };
}

async function ensurePrice(acct, cid, pid, plan, shape, cmName) {
  const key = safeId([acct, cid, pid, shape.cents, shape.interval, isLive() ? 'live' : 'test'].join('_'));
  const ref = db.collection('creatorPrices').doc(key);
  const snap = await ref.get();
  if (snap.exists && snap.data().priceId && modeOk(snap.data())) return snap.data().priceId;
  const mode = isLive() ? 'live_' : 'test_';
  const prodRef = db.collection('creatorPrices').doc(safeId(['product', acct, cid, pid, isLive() ? 'live' : 'test'].join('_')));
  const ps = await prodRef.get();
  let productId = ps.exists && modeOk(ps.data()) ? ps.data().productId : null;
  if (!productId) {
    const p = await stripe('POST', 'products', { name: (cmName + ' · ' + (plan.name || pid)).slice(0, 120), metadata: { cid, planId: pid, platform: 'tradezoro' } },
      { acct, idem: mode + 'cprod_' + acct + '_' + cid + '_' + pid });
    productId = p.id;
    await prodRef.set({ productId, acct, cid, planId: pid, live: isLive(), createdAt: FV.serverTimestamp() });
  }
  const params = { product: productId, currency: 'usd', unit_amount: shape.cents, metadata: { cid, planId: pid } };
  if (shape.interval !== 'lifetime') params.recurring = { interval: shape.interval };
  const price = await stripe('POST', 'prices', params, { acct, idem: mode + 'cprice_' + key });
  await ref.set({ priceId: price.id, productId, acct, cid, planId: pid, cents: shape.cents, interval: shape.interval, live: isLive(), createdAt: FV.serverTimestamp() });
  return price.id;
}

async function ensureCustomer(acct, uid, token) {
  const ref = db.collection('creatorCustomers').doc(safeId(acct + '_' + uid));
  const s = await ref.get();
  if (s.exists && s.data().customerId && modeOk(s.data())) return s.data().customerId;
  const c = await stripe('POST', 'customers', { email: (token && token.email) || undefined, name: (token && token.name) || undefined, metadata: { uid, platform: 'tradezoro' } },
    { acct, idem: (isLive() ? 'live_' : 'test_') + 'ccus_' + acct + '_' + uid });
  await ref.set({ customerId: c.id, acct, uid, live: isLive(), createdAt: FV.serverTimestamp() });
  return c.id;
}

const memRef = (cid, uid) => db.collection('communities').doc(cid).collection('members').doc(uid);
const isActiveMember = (m) => !!m && m.status === 'active' && (!m.expiresAt || toMs(m.expiresAt) > now());
function toMs(t) { if (!t) return 0; if (typeof t === 'number') return t; if (t.toMillis) return t.toMillis(); if (t instanceof Date) return t.getTime(); return new Date(t).getTime() || 0; }

actions.checkout = async (uid, data, context) => {
  const cid = String(data.cid || ''), pid = String(data.planId || '');
  if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(cid) || !/^p[1-8]$/.test(pid)) throw fail('invalid-argument', 'Bad request.');
  const cmSnap = await db.collection('communities').doc(cid).get();
  if (!cmSnap.exists) throw fail('not-found', 'Community not found.');
  const cm = cmSnap.data();
  if (cm.status !== 'active') throw fail('failed-precondition', 'This community is not taking new members right now.');
  if (cm.ownerUid === uid) throw fail('failed-precondition', 'This is your own community.');
  if (cm.visibility === 'private') throw fail('failed-precondition', 'This community is invite-only.');
  const planSnap = await db.collection('communities').doc(cid).collection('plans').doc(pid).get();
  if (!planSnap.exists || planSnap.data().status !== 'live') throw fail('not-found', 'That plan is not available.');
  const plan = planSnap.data();
  if ((plan.joinMode || 'open') !== 'open') throw fail('failed-precondition', 'This plan is invite-only.');
  const shape = priceShape(plan);
  const refundRule = String(cm.refundRule || '').trim();
  if (!refundRule) throw fail('failed-precondition', 'The creator hasn\'t set a refund rule yet, so this plan can\'t be bought.');
  const email = String((context.auth.token && context.auth.token.email) || '').toLowerCase();
  if (email && (await db.collection('communities').doc(cid).collection('bans').doc(email).get()).exists) throw fail('permission-denied', 'You cannot join this community.');

  const seller = await myAccount(cm.ownerUid);
  if (!seller || seller.status !== 'active') throw fail('failed-precondition', 'This creator can\'t take payments yet.');
  const acct = seller.acct;

  const mSnap = await memRef(cid, uid).get();
  const m = mSnap.exists ? mSnap.data() : null;
  if (m && m.status === 'banned') throw fail('permission-denied', 'You cannot join this community.');
  if (m && isActiveMember(m) && m.source === 'paid' && m.pay && ['active', 'trialing', 'past_due', 'one_time'].indexOf(m.pay.status) >= 0) {
    throw fail('already-exists', 'You already have a paid plan here. Manage it from the community page.');
  }

  const feePct = feePctOf(await commerce());
  const priceId = await ensurePrice(acct, cid, pid, plan, shape, cm.name || cid);
  const customer = await ensureCustomer(acct, uid, context.auth.token);
  const back = siteOrigin() + '/c/' + cid;
  const meta = { buyerUid: uid, cid, planId: pid, creatorUid: cm.ownerUid, platform: 'tradezoro' };
  const sub = shape.interval !== 'lifetime';
  const params = {
    mode: sub ? 'subscription' : 'payment',
    customer, client_reference_id: uid,
    line_items: [{ price: priceId, quantity: 1 }],
    payment_method_types: ['card'],        // Apple Pay / Google Pay ride on card in Checkout
    billing_address_collection: 'auto',
    adaptive_pricing: { enabled: 'false' },
    metadata: meta,
    custom_text: { submit: { message: ('Sold by ' + (cm.ownerName || 'the creator') + ', an independent creator. ' + platformLine(legalNameOf(await commerce())) + ' Refunds: ask the creator first; their refund rule: ' + refundRule).slice(0, 1200) } },
    success_url: back + '?paid=1&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: back + '?paid=0'
  };
  if (sub) {
    params.subscription_data = { metadata: meta };
    if (shape.trial > 0) {
      params.subscription_data.trial_period_days = shape.trial;
      params.subscription_data.trial_settings = { end_behavior: { missing_payment_method: 'cancel' } };
      params.payment_method_collection = 'always';
    }
    if (feePct > 0) params.subscription_data.application_fee_percent = feePct;
  } else {
    params.payment_intent_data = { metadata: meta };
    const fee = Math.round(shape.cents * feePct / 100);
    if (fee > 0) params.payment_intent_data.application_fee_amount = fee;
    params.customer_creation = undefined;
  }
  const session = await stripe('POST', 'checkout/sessions', params, { acct });
  await db.collection('creatorSessions').doc(session.id).set({
    buyerUid: uid, cid, planId: pid, planName: plan.name || pid, creatorUid: cm.ownerUid, acct, customer, priceId,
    kind: sub ? 'subscription' : 'one_time', interval: shape.interval, cents: shape.cents, trialDays: shape.trial, feePct,
    status: 'created', live: isLive(), createdAt: FV.serverTimestamp()
  });
  return { url: session.url, sessionId: session.id };
};

async function mySubFor(uid, cid) {
  const m = await memRef(cid, uid).get();
  const pay = m.exists && m.data().pay;
  if (!pay || !pay.subId) throw fail('not-found', 'No subscription for this community on your account.');
  const s = await db.collection('creatorSubs').doc(pay.subId).get();
  if (!s.exists || s.data().buyerUid !== uid || !modeOk(s.data())) throw fail('not-found', 'No subscription for this community on your account.');
  return Object.assign({ id: pay.subId }, s.data());
}

actions.portal = async (uid, data) => {
  const cid = String(data.cid || '');
  const sub = await mySubFor(uid, cid);
  const params = { customer: sub.customer, return_url: siteOrigin() + '/c/' + cid };
  try {
    return { url: (await stripe('POST', 'billing_portal/sessions', params, { acct: sub.acct })).url };
  } catch (e) {
    if (e.stripeStatus !== 400) throw e;
    // The creator's account has no default portal configuration yet: create one (card update, invoices, cancel at
    // period end) once, cache it on the creator record and retry.
    const cfg = await stripe('POST', 'billing_portal/configurations', {
      business_profile: { headline: 'Manage your membership' },
      features: { payment_method_update: { enabled: true }, invoice_history: { enabled: true },
        subscription_cancel: { enabled: true, mode: 'at_period_end' } }
    }, { acct: sub.acct, idem: (isLive() ? 'live_' : 'test_') + 'cportal_' + sub.acct });
    await db.collection('creatorAccounts').doc(sub.creatorUid).set({ portalConfig: cfg.id }, { merge: true });
    params.configuration = cfg.id;
    return { url: (await stripe('POST', 'billing_portal/sessions', params, { acct: sub.acct })).url };
  }
};

actions.cancel = async (uid, data) => {
  const cid = String(data.cid || '');
  const sub = await mySubFor(uid, cid);
  const s = await stripe('POST', 'subscriptions/' + sub.id, { cancel_at_period_end: data.resume === true ? 'false' : 'true' }, { acct: sub.acct });
  await onSubChanged(s, false, sub.acct);
  return { cancelAtPeriodEnd: !!s.cancel_at_period_end, periodEnd: subPeriodEnd(s) };
};

actions.suspend = async (uid, data) => {
  if (!(await isAdminUid(uid))) throw fail('permission-denied', 'Admins only.');
  const cid = String(data.cid || '');
  const ref = db.collection('communities').doc(cid);
  const c = await ref.get();
  if (!c.exists) throw fail('not-found', 'Community not found.');
  const sus = data.suspend === true;
  await ref.set(sus ? { status: 'suspended', suspendedReason: String(data.reason || '').slice(0, 300), suspendedAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() }
    : { status: 'active', updatedAt: FV.serverTimestamp() }, { merge: true });
  // Suspended: no new sales (checkout refuses), and no renewals: every live subscription cancels at period end, so
  // members keep what they paid for. Unsuspending does not restart them (members re-join).
  let stopped = 0;
  if (sus) {
    const subs = await db.collection('creatorSubs').where('cid', '==', cid).get();
    for (const d of subs.docs) {
      const s = d.data();
      if (!modeOk(s) || ['canceled', 'incomplete_expired'].indexOf(s.status) >= 0 || s.cancelAtPeriodEnd) continue;
      try { await stripe('POST', 'subscriptions/' + d.id, { cancel_at_period_end: 'true', metadata: { stoppedBy: 'tradezoro_suspension' } }, { acct: s.acct }); stopped++;
        await d.ref.set({ cancelAtPeriodEnd: true, stoppedBySuspension: true }, { merge: true }); }
      catch (e) { console.error('suspend: could not stop', d.id, e.message); }
    }
  }
  return { status: sus ? 'suspended' : 'active', renewalsStopped: stopped };
};

actions.adminList = async (uid) => {
  if (!(await isAdminUid(uid))) throw fail('permission-denied', 'Admins only.');
  const q = await db.collection('creatorAccounts').get();
  return { creators: q.docs.filter((d) => modeOk(d.data())).map((d) => Object.assign({ uid: d.id, acct: d.data().acct, cid: d.data().cid || null }, publicState(d.data()))),
    mode: isLive() ? 'live' : 'test' };
};

const OPEN_ACTIONS = { status: 1, adminList: 1, suspend: 1 };   // no payments gate (they move no money)

exports.creatorPay = functions
  .runWith({ maxInstances: 20, timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const uid = requireAuth(context);
    data = data && typeof data === 'object' ? data : {};
    const action = String(data.action || '');
    const fn = Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : null;
    if (!fn) throw fail('invalid-argument', 'Unknown action.');
    stripeKey();
    // Checkout, portal and cancel serve buyers; onboarding and dashboard serve creators. All of them wait for the switch.
    if (!OPEN_ACTIONS[action]) await gate(uid, context);
    return fn(uid, data, context);
  });

// ---- webhook (Connect) -------------------------------------------------------------------------------------------
function subPeriodEnd(sub) {
  if (sub.current_period_end) return sub.current_period_end;
  const ends = ((sub.items && sub.items.data) || []).map((i) => i.current_period_end).filter(Boolean);
  return ends.length ? Math.max.apply(null, ends) : null;
}
function invSubId(inv) {
  if (inv.subscription) return typeof inv.subscription === 'string' ? inv.subscription : inv.subscription.id;
  const d = inv.parent && inv.parent.subscription_details;
  return (d && (typeof d.subscription === 'string' ? d.subscription : d.subscription && d.subscription.id)) || null;
}
function invSubMeta(inv) {
  return (inv.subscription_details && inv.subscription_details.metadata) ||
    (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.metadata) || {};
}
const idOf = (x) => (x && typeof x === 'object' ? x.id : x) || null;

function notify(uid, type, message, link) {
  if (!uid) return null;
  return db.collection('notifications').add({ recipientUid: uid, type, message, link: link || null, read: false, createdAt: FV.serverTimestamp() })
    .catch((e) => console.error('creatorPay notify failed', uid, e.message));
}

// Write / extend the buyer's member doc. expiresAtMs null = no end (one-time purchase).
async function grantMember(o) {
  const cref = db.collection('communities').doc(o.cid), mref = memRef(o.cid, o.buyerUid);
  return db.runTransaction(async (tx) => {
    const [c, m] = await Promise.all([tx.get(cref), tx.get(mref)]);
    if (!c.exists) return 'no community';
    const cur = m.exists ? m.data() : null;
    if (cur && cur.status === 'banned') return 'banned member, not granted';
    if (cur && cur.role === 'owner') return 'owner, not granted';
    const exp = o.expiresAtMs == null ? null : admin.firestore.Timestamp.fromMillis(o.expiresAtMs);
    const patch = { uid: o.buyerUid, planId: o.planId, source: 'paid', status: 'active', expiresAt: exp,
      pay: Object.assign({}, (cur && cur.pay) || {}, o.pay, { live: isLive(), updatedAt: now() }) };
    if (!cur) {
      Object.assign(patch, { role: 'member', joinedAt: FV.serverTimestamp(), lastActiveAt: FV.serverTimestamp(), displayName: String(o.displayName || 'Member').slice(0, 60) });
      tx.set(mref, patch);
      tx.update(cref, { memberCount: FV.increment(1) });
      return 'member added';
    }
    tx.set(mref, patch, { merge: true });
    return 'member updated';
  });
}

async function setMemberPay(cid, buyerUid, pay, extra) {
  const ref = memRef(cid, buyerUid);
  const m = await ref.get();
  if (!m.exists || m.data().source !== 'paid') return false;
  const patch = Object.assign({ pay: Object.assign({}, m.data().pay || {}, pay, { updatedAt: now() }) }, extra || {});
  await ref.set(patch, { merge: true });
  return true;
}

async function saleCreate(id, doc) {
  try { await db.collection('creatorSales').doc(id).create(Object.assign({ live: isLive(), createdAt: FV.serverTimestamp() }, doc)); return true; }
  catch (e) { if (e && (e.code === 6 || /already exists/i.test(e.message || ''))) return false; throw e; }
}

async function subRecord(subId, meta, acct) {
  const s = await db.collection('creatorSubs').doc(subId).get();
  if (s.exists) return Object.assign({ ref: s.ref }, s.data());
  if (meta && meta.buyerUid && meta.cid && meta.planId) return { ref: s.ref, pending: true, buyerUid: meta.buyerUid, cid: meta.cid, planId: meta.planId, creatorUid: meta.creatorUid || null, acct };
  return null;
}

async function onCheckoutCompleted(session, acct) {
  const ref = db.collection('creatorSessions').doc(session.id);
  const rec = await db.runTransaction(async (tx) => {
    const d = await tx.get(ref);
    if (!d.exists) return null;
    const r = d.data();
    if (r.acct !== acct) return 'acct';
    if (session.client_reference_id && session.client_reference_id !== r.buyerUid) return 'mismatch';
    if (r.status === 'paid') return 'dup';
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return 'unpaid';
    tx.update(ref, { status: 'paid', subId: idOf(session.subscription), paymentIntent: idOf(session.payment_intent), paidAt: FV.serverTimestamp() });
    return r;
  });
  if (rec === null) return 'unknown session';
  if (typeof rec === 'string') return rec === 'dup' ? 'duplicate session' : rec === 'unpaid' ? 'ignored: payment_status ' + session.payment_status : 'refused: ' + rec;
  const name = (session.customer_details && session.customer_details.name) || 'Member';
  const email = (session.customer_details && session.customer_details.email) || null;

  if (rec.kind === 'one_time') {
    const pi = idOf(session.payment_intent);
    await grantMember({ cid: rec.cid, buyerUid: rec.buyerUid, planId: rec.planId, expiresAtMs: null, displayName: name,
      pay: { kind: 'one_time', status: 'one_time', acct, paymentIntent: pi, sessionId: session.id, periodEnd: null, graceUntil: null } });
    await saleCreate('pi_' + safeId(pi || session.id), { creatorUid: rec.creatorUid, buyerUid: rec.buyerUid, buyerEmail: email, cid: rec.cid, planId: rec.planId, planName: rec.planName,
      acct, kind: 'one_time', amountCents: Number(session.amount_total || rec.cents), currency: 'usd', feePct: rec.feePct, status: 'paid', paymentIntent: pi, sessionId: session.id });
    await notify(rec.buyerUid, 'creator_join', 'You joined ' + rec.cid + ' (' + rec.planName + '). ' + platformLine(legalNameOf(await commerce())), '/c/' + rec.cid);
    return 'one-time access granted to ' + rec.buyerUid;
  }
  const subId = idOf(session.subscription);
  const sub = await stripe('GET', 'subscriptions/' + subId, null, { acct });
  const end = subPeriodEnd(sub) * 1000;
  await db.collection('creatorSubs').doc(subId).set({ buyerUid: rec.buyerUid, cid: rec.cid, planId: rec.planId, planName: rec.planName, creatorUid: rec.creatorUid, acct,
    customer: rec.customer, sessionId: session.id, status: sub.status, cancelAtPeriodEnd: !!sub.cancel_at_period_end, currentPeriodEnd: end, trial: sub.status === 'trialing',
    live: isLive(), createdAt: FV.serverTimestamp() }, { merge: true });
  await grantMember({ cid: rec.cid, buyerUid: rec.buyerUid, planId: rec.planId, expiresAtMs: end + GRACE_MS, displayName: name,
    pay: { kind: 'subscription', status: sub.status === 'trialing' ? 'trialing' : 'active', acct, subId, periodEnd: end, graceUntil: null, cancelAtPeriodEnd: !!sub.cancel_at_period_end } });
  await notify(rec.buyerUid, 'creator_join', 'You joined ' + rec.cid + ' (' + rec.planName + '). ' + platformLine(legalNameOf(await commerce())), '/c/' + rec.cid);
  return 'subscription access granted to ' + rec.buyerUid + ' until ' + new Date(end).toISOString();
}

async function onInvoicePaid(inv, acct) {
  const subId = invSubId(inv);
  if (!subId) return 'ignored: no subscription';
  const rec = await subRecord(subId, invSubMeta(inv), acct);
  if (!rec) return 'unknown subscription';
  if (rec.acct && rec.acct !== acct) return 'refused: acct';
  const ends = ((inv.lines && inv.lines.data) || []).map((l) => l.period && l.period.end).filter(Boolean);
  const end = ends.length ? Math.max.apply(null, ends) * 1000 : null;
  const paid = Number(inv.amount_paid || 0);
  let fresh = false;
  if (paid > 0) {
    fresh = await saleCreate('inv_' + safeId(inv.id), { creatorUid: rec.creatorUid, buyerUid: rec.buyerUid, buyerEmail: inv.customer_email || null, cid: rec.cid,
      planId: rec.planId, planName: rec.planName || rec.planId, acct, kind: inv.billing_reason === 'subscription_create' ? 'first' : 'renewal',
      amountCents: paid, currency: String(inv.currency || 'usd'), status: 'paid', invoice: inv.id, charge: idOf(inv.charge), paymentIntent: idOf(inv.payment_intent), subId });
  }
  if (rec.pending) return 'invoice before checkout record: sale ' + (fresh ? 'recorded' : 'skipped');
  if (end) {
    await rec.ref.set({ currentPeriodEnd: end, status: 'active', lastPaidInvoice: inv.id }, { merge: true });
    // Paid: never move the end backwards (max).
    const m = await memRef(rec.cid, rec.buyerUid).get();
    const curExp = m.exists ? toMs(m.data().expiresAt) : 0;
    await setMemberPay(rec.cid, rec.buyerUid, { status: 'active', periodEnd: end, graceUntil: null }, { status: 'active', expiresAt: admin.firestore.Timestamp.fromMillis(Math.max(curExp, end + GRACE_MS)) });
  }
  if (fresh && inv.billing_reason !== 'subscription_create') await notify(rec.buyerUid, 'creator_renewed', 'Your ' + (rec.planName || 'membership') + ' in ' + rec.cid + ' renewed.', '/c/' + rec.cid);
  return (fresh ? 'sale recorded, ' : 'repeat, ') + 'paid through ' + (end ? new Date(end).toISOString() : '?');
}

async function onInvoiceFailed(inv, acct) {
  const subId = invSubId(inv);
  if (!subId) return 'ignored: no subscription';
  const rec = await subRecord(subId, invSubMeta(inv), acct);
  if (!rec || rec.pending) return 'unknown subscription';
  if (rec.acct !== acct) return 'refused: acct';
  const m = await memRef(rec.cid, rec.buyerUid).get();
  const exp = m.exists ? toMs(m.data().expiresAt) : 0;
  // Grace: access runs to the last period end + 3 days (already the member's expiresAt); never extended by a failure.
  const grace = Math.max(exp, (rec.currentPeriodEnd || 0) + GRACE_MS) || now() + GRACE_MS;
  await rec.ref.set({ status: 'past_due', lastFailedInvoice: inv.id }, { merge: true });
  await setMemberPay(rec.cid, rec.buyerUid, { status: 'past_due', graceUntil: grace }, { expiresAt: admin.firestore.Timestamp.fromMillis(grace) });
  if ((inv.attempt_count || 1) === 1) {
    await notify(rec.buyerUid, 'creator_payment_failed', 'We couldn\'t charge your card for ' + rec.cid + '. Stripe will retry. Update your card from the community page to keep access.', '/c/' + rec.cid);
  }
  return 'past_due, grace until ' + new Date(grace).toISOString();
}

async function onSubChanged(sub, deleted, acct) {
  const rec = await subRecord(sub.id, sub.metadata || {}, acct);
  if (!rec || rec.pending) return 'unknown subscription';
  if (rec.acct !== acct) return 'refused: acct';
  const end = (subPeriodEnd(sub) || 0) * 1000;
  await rec.ref.set({ status: deleted ? 'canceled' : sub.status, cancelAtPeriodEnd: !!sub.cancel_at_period_end, currentPeriodEnd: end || rec.currentPeriodEnd || null }, { merge: true });
  if (deleted || sub.status === 'canceled' || sub.status === 'incomplete_expired' || sub.status === 'unpaid') {
    await setMemberPay(rec.cid, rec.buyerUid, { status: 'ended', cancelAtPeriodEnd: false, graceUntil: null }, { status: 'expired', expiresAt: admin.firestore.Timestamp.fromMillis(now()) });
    return 'membership ended';
  }
  const st = sub.status === 'past_due' ? 'past_due' : sub.status === 'trialing' ? 'trialing' : 'active';
  await setMemberPay(rec.cid, rec.buyerUid, { status: st, cancelAtPeriodEnd: !!sub.cancel_at_period_end, periodEnd: end || null });
  return 'subscription ' + sub.status + (sub.cancel_at_period_end ? ' (ends at period end)' : '');
}

async function saleForCharge(ch) {
  const inv = idOf(ch.invoice), pi = idOf(ch.payment_intent);
  for (const id of [inv && 'inv_' + safeId(inv), pi && 'pi_' + safeId(pi)].filter(Boolean)) {
    const s = await db.collection('creatorSales').doc(id).get();
    if (s.exists) return s;
  }
  if (pi) {   // renewal invoices: our sale doc is keyed by invoice; look it up by payment intent
    const q = await db.collection('creatorSales').where('paymentIntent', '==', pi).limit(1).get();
    if (!q.empty) return q.docs[0];
  }
  return null;
}

async function onChargeRefunded(ch, acct) {
  const s = await saleForCharge(ch);
  if (!s) throw new Error('sale not recorded yet; Stripe will retry');   // event raced ahead of checkout.session.completed / invoice.paid: 500 so Stripe redelivers
  const sale = s.data();
  if (sale.acct !== acct) return 'refused: acct';
  const full = ch.refunded === true || Number(ch.amount_refunded || 0) >= Number(ch.amount || 0);
  await s.ref.set({ status: full ? 'refunded' : 'partially_refunded', refundedCents: Number(ch.amount_refunded || 0), refundedAt: FV.serverTimestamp() }, { merge: true });
  // A full refund of a one-time purchase ends that access. Subscriptions: the refund is the creator's call (goodwill
  // refunds happen); access follows the subscription itself (cancel it in Stripe and the deleted event ends access).
  if (full && sale.kind === 'one_time') {
    await setMemberPay(sale.cid, sale.buyerUid, { status: 'refunded' }, { status: 'expired', expiresAt: admin.firestore.Timestamp.fromMillis(now()) });
    return 'refunded, one-time access ended';
  }
  return full ? 'refunded (subscription access unchanged)' : 'partially refunded';
}

async function onDispute(dp, acct) {
  const ch = await stripe('GET', 'charges/' + idOf(dp.charge), null, { acct });
  const s = await saleForCharge(ch);
  if (!s) throw new Error('sale not recorded yet; Stripe will retry');   // event raced ahead of checkout.session.completed / invoice.paid: 500 so Stripe redelivers
  const sale = s.data();
  if (sale.acct !== acct) return 'refused: acct';
  await s.ref.set({ status: 'disputed', disputeId: dp.id, disputeReason: dp.reason || null, disputedAt: FV.serverTimestamp() }, { merge: true });
  // A buyer who disputes the charge loses access now, and a subscription stops (no more charges to a disputing card).
  await setMemberPay(sale.cid, sale.buyerUid, { status: 'disputed' }, { status: 'expired', expiresAt: admin.firestore.Timestamp.fromMillis(now()) });
  if (sale.subId) {
    try { await stripe('DELETE', 'subscriptions/' + sale.subId, null, { acct }); } catch (e) { console.error('dispute: cancel failed', sale.subId, e.message); }
    await db.collection('creatorSubs').doc(sale.subId).set({ status: 'canceled', disputed: true }, { merge: true });
  }
  await notify(sale.creatorUid, 'creator_dispute', 'A buyer disputed a payment for ' + sale.cid + '. Respond in your Stripe Dashboard before the deadline.', '/creator?c=' + sale.cid);
  return 'disputed, access ended';
}

async function onAccountUpdated(a) {
  const uid = await uidForAcct(a.id);
  if (!uid) return 'unknown account';
  const st = await saveAccount(uid, a);
  return 'account ' + st.status;
}

async function handleConnectEvent(event) {
  const acct = event.account;
  const obj = event.data && event.data.object;
  if (!acct) return 'ignored: not a Connect event';
  // Only accounts we created. account.updated is checked by uidForAcct itself.
  if (event.type !== 'account.updated' && !(await uidForAcct(acct))) return 'ignored: unknown account';
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': return onCheckoutCompleted(obj, acct);
    case 'invoice.paid': return onInvoicePaid(obj, acct);
    case 'invoice.payment_failed': return onInvoiceFailed(obj, acct);
    case 'customer.subscription.updated': return onSubChanged(obj, false, acct);
    case 'customer.subscription.deleted': return onSubChanged(obj, true, acct);
    case 'charge.refunded': return onChargeRefunded(obj, acct);
    case 'charge.dispute.created': return onDispute(obj, acct);
    case 'account.updated': return onAccountUpdated(obj);
    default: return 'ignored: ' + event.type;
  }
}

async function webhookHandler(req, res) {
  // Live secret = STRIPE_CONNECT_WEBHOOK_SECRET. A separate test-mode endpoint secret may be set in STRIPE_CONNECT_WEBHOOK_SECRET_TEST.
  const secrets = connectSecrets();
  if (!secrets.length) { console.warn('creatorConnectWebhook: STRIPE_CONNECT_WEBHOOK_SECRET not set, event refused'); res.status(500).send('webhook secret not configured'); return; }
  if (!secrets.some((sec) => verifySignature(req.rawBody, req.headers['stripe-signature'], sec))) { res.status(400).send('bad signature'); return; }
  let event;
  try { event = JSON.parse(req.rawBody.toString('utf8')); } catch (e) { res.status(400).send('bad json'); return; }
  if (event.livemode !== isLive()) { res.status(200).send('mode mismatch, ignored'); return; }
  const evRef = db.collection('creatorEvents').doc(String(event.id));
  const seen = await evRef.get();
  if (seen.exists && seen.data().done) { res.status(200).send('duplicate'); return; }
  try {
    const result = await handleConnectEvent(event);
    await evRef.set({ type: event.type, account: event.account || null, done: true, result: String(result).slice(0, 200), at: FV.serverTimestamp() });
    console.log('creatorConnectWebhook', event.type, event.id, event.account, result);
    res.status(200).send('ok');
  } catch (err) {
    console.error('creatorConnectWebhook failed', event.type, event.id, err.message);
    res.status(500).send('error');
  }
}

exports.creatorConnectWebhook = functions
  .runWith({ maxInstances: 30, timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest(webhookHandler);

// Not a function (the loader ignores it): for the offline tests.
exports.__creatorPayInternals = { stripeV2, accountState, feePctOf, priceShape, handleConnectEvent, webhookHandler, actions, gate, payReady, legalNameOf, platformLine, DEFAULT_LEGAL_NAME, PAYOUT_COUNTRIES, GRACE_MS };
