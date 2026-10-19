// TradeZoro — Charts "Connect broker" (Rithmic) config + feature flag (ES module)
// Depends on: the global `auth` from assets/auth.js (a top-level `let`, so it is a global
// lexical binding, NOT window.auth; read only, to get the member uid).
// Imported by assets/vela-chart.js on every Charts load. It is deliberately tiny: when the
// flag is OFF for this member (the default for everyone), nothing else Rithmic-related is
// ever downloaded and the Charts page behaves exactly as before.
//
// WHAT THIS FEATURE IS: a member connects THEIR OWN Rithmic login (e.g. through their prop
// firm: Apex, TradeSea, Tradeify ...) and the Charts page streams futures from Rithmic under
// THEIR data entitlement. The browser talks to Rithmic's R|Protocol gateway directly over a
// WebSocket. TradeZoro never relays data and never sees, sends or stores the password.
//
// TO GO LIVE (Rithmic passed conformance 2026-10-19; production URIs arrive by email):
//   1. Paste each URI Rithmic emails us into its GATEWAYS entry below (replace `uri: null`).
//   2. Set MODE = 'production'. That is the whole switch: the Connect sheet then offers the
//      production gateways that have a URI (and no longer the Test server). Nothing else to edit.
//   3. Add member uids to RITHMIC_FLAG.allowUids (or approve rithmicBeta) as before.
//      wss://*.rithmic.com is already in connect-src (_headers).
// DATA ONLY: this feature never places, modifies or cancels orders (no order templates exist
// in rithmic-proto.js); it reads prices and bars.

// The ONE place the application name lives. Rithmic registered it for us: "Stryker Charts".
export const APP_NAME = 'Stryker Charts';

// 'test'       -> only the Rithmic Test server (the default until production is approved).
// 'production' -> every gateway below that is not a test server AND has a uri.
export const MODE = 'test';

// One entry per gateway. `system` is a hint of the Rithmic system(s) it serves (the member
// still picks the exact system from the list the gateway itself returns). A gateway with
// `uri: null` is never offered and never contacted. Do NOT put anything but a wss:// URI here.
export const GATEWAYS = [
  { id: 'test', label: 'Rithmic Test', test: true, uri: 'wss://rituz00100.rithmic.com:443' },
  // Production (URIs to be emailed by Rithmic; leave null until then):
  { id: 'paper', label: 'Rithmic Paper Trading', test: false, uri: null },
  { id: 'r01', label: 'Rithmic 01', test: false, uri: null }
  // Regional/other production gateways: add { id, label, test: false, uri } lines here.
];

// Gateways offered to members in the current MODE.
export function activeGateways() {
  return GATEWAYS.filter((g) => g.uri && /^wss:\/\//.test(g.uri) && (MODE === 'production' ? !g.test : g.test));
}

// app_version: the Test server accepted this exact value on 2026-10-05; production uses the site build.
const TEST_APP_VERSION = '0.3.0.0';

export const RITHMIC_CONFIG = {
  // R|Protocol template version the official kit (R|Protocol API 0.90.0.0) samples send;
  // Rithmic Test answered with 5.56 and accepted the login (2026-10-05).
  templateVersion: '5.55',
  // Bar `marker` from a time-bar replay is the bar's END (close) time in epoch seconds
  // (async_rithmic exposes it as bar_end_datetime). Confirmed on Rithmic Test 2026-10-05: a
  // replay at 17:12:59 UTC returned a newest 1-minute ES bar with marker 17:13:00.
  markerIsBarEnd: true
};

// ON, but ONLY for the uids in `allowUids` (Firebase uids). Everyone else gets nothing:
// no button, and no Rithmic file is downloaded. 2026-10-06: the Owner's account only.
export const RITHMIC_FLAG = { enabled: true, allowUids: ['0hC8vmnsh0O2CkyWiyw9X1kn1XL2'] };

// app_version = the site build (the page's stryker-build meta mirrors assets/version.json).
export function appVersion() {
  const m = typeof document !== 'undefined' && document.querySelector('meta[name="stryker-build"]');
  return (m && m.getAttribute('content')) || '0';
}

// Local development / the browser test only: on 127.0.0.1 or localhost, a localStorage key
// can switch the feature on and point it at the local mock gateway. Ignored on any other host,
// so it can never turn the feature on for the live site.
function devOverride() {
  try {
    const h = location.hostname;
    if (h !== '127.0.0.1' && h !== 'localhost') return null;
    const raw = localStorage.getItem('stryker_rithmic_dev');
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (o && typeof o.gateway === 'string' && /^wss?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(o.gateway)) return o;
  } catch (e) { /* no override */ }
  return null;
}

// Access = the feature flag AND either (a) the uid is in allowUids (the Owner) or (b) the
// member's own students/{uid} doc carries rithmicBeta === true. (b) is how the Rithmic
// conformance reviewers get in without a redeploy: they sign up on /rithmic-review, which files
// rithmicReview/{uid}; an admin approves by setting rithmicBeta with the Admin SDK. The rules make
// rithmicBeta a privileged field, so a member can never set it on themselves.
export function rithmicEnabledFor(uid, beta) {
  if (devOverride()) return true;
  if (!RITHMIC_FLAG.enabled) return false;
  return !!uid && (RITHMIC_FLAG.allowUids.includes(uid) || beta === true);
}

// Reads the signed-in member's own docs (rules: self-read only). Never throws.
async function readOwn(coll, uid) {
  try {
    // eslint-disable-next-line no-undef
    const d = typeof db !== 'undefined' ? db : null;
    if (!d || !uid) return null;
    const snap = await d.collection(coll).doc(uid).get();
    return snap.exists ? (snap.data() || {}) : null;
  } catch (e) { return null; }
}

// Called by vela-chart.js after the login gate. Returns the Rithmic module (provider + UI)
// for members with access, or null (nothing else loads).
export async function loadRithmicIfEnabled() {
  let uid = null;
  try {
    // eslint-disable-next-line no-undef
    const a = typeof auth !== 'undefined' ? auth : null;
    uid = (a && a.currentUser && a.currentUser.uid) || null;
  } catch (e) {}
  let beta = false;
  if (RITHMIC_FLAG.enabled && uid && !RITHMIC_FLAG.allowUids.includes(uid) && !devOverride()) {
    const st = await readOwn('students', uid);
    beta = !!(st && st.rithmicBeta === true);
    if (!beta) {
      // A reviewer who signed up on /rithmic-review and is waiting for approval: say so once.
      const req = await readOwn('rithmicReview', uid);
      if (req) {
        try { if (window.showToast) window.showToast('info', 'Rithmic review access requested. Connect broker appears here once we switch it on for your account; reload this page then.'); } catch (e) {}
      }
    }
  }
  if (!rithmicEnabledFor(uid, beta)) return null;
  const dev = devOverride();
  let gateways = activeGateways();
  if (dev) gateways = [{ id: 'dev', label: 'Local mock', test: true, uri: dev.gateway }];
  if (!gateways.length) return null; // production mode but no URI filled in yet: show nothing
  const allTest = gateways.every((g) => g.test);
  const cfg = { ...RITHMIC_CONFIG, appName: APP_NAME, appVersion: allTest ? TEST_APP_VERSION : appVersion(),
    gateways, gateway: gateways[0].uri, isTest: allTest };
  const ui = await import('./rithmic-ui.js?v=601');
  return ui.createRithmic(cfg);
}
