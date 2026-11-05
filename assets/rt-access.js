// TradeZoro — real-time CME futures access (ES module)
// Depends on: Firebase compat auth (window.firebase, started by assets/auth.js); GET /api/chart/rt
// (functions/api/chart/rt.js).
// Owner order 2026-10-16: real-time CME futures data is ADMIN ONLY. Everyone else (signed out, free,
// Pro) gets data 10 minutes behind. The SERVER enforces it (stream, /api/chart/bars, the recorder's
// /orderflow + /ticks1s all check a verified Firebase ID token); this module only (1) carries the ID
// token to those endpoints and (2) tells the UI which mode it is in, so it never opens a stream that
// would be refused and shows the right data dot. A client "admin" answer is never trusted by a server.
// "admin" here means "the server grants real-time": admins, the demo account, members with the $7 Live Futures Data add-on, any member with the current Market Data Agreement (free L1, Owner 2026-11-04; L1 only, the L2 book is a separate server tier), early Pro members kept live (liveFeedGrandfathered, only while Pro stays active; Owner 2026-10-30) AND members
// the admin switched on (students/{uid}.liveFeed, assets/admin-live-feed.js). /api/chart/rt answers yes for all three,
// so a liveFeed member gets the stream lane and the same "Real-time data" badge as an admin with no other client change.
// Switched off: the server closes their stream (4003) and cuts their bars; failed() / rtNoteBars re-ask and drop to poll.
// REFRESH FIX 2026-11-05 (member "every refresh gives a different result"): three states, never two. `known` = the answer is decided
// (signed out, or the server said yes / no for this user). `ready` = callers may stop waiting (known, or the 30 s cap). Unknown is never
// shown as "no": the delayed pill waits for `known` (rtKnown), and a server that cannot be reached keeps the answer unknown and is re-asked fast.
// `authed` = Firebase said who the user is (null or a user with a token): data requests wait for this, not for the server answer.
const st = { ready: false, known: false, authed: false, admin: false, uid: '', token: '', exp: 0, checked: false, lastBars: null, liveAt: 0 };
const subs = new Set();
let readyP = null, readyRes = null, started = false, curUser = null, recheckTm = null, recheckN = 0, checking = null;

const emit = () => subs.forEach((f) => { try { f(); } catch (e) {} });
function done() { if (!st.ready) { st.ready = true; if (readyRes) readyRes(); } emit(); }
function authKnown() { st.authed = true; }
// JWT expiry (epoch s) without verifying: only used to decide when to ask Firebase for a new token.
function expOf(token) { try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp || 0; } catch (e) { return 0; } }

// -> true / false (server answered) / null (could not reach the server: UNKNOWN, never treated as "not admin")
async function askServer(token) {
  try {
    const r = await fetch('/api/chart/rt', { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' });
    if (r.ok) return (await r.json()).admin === true;
  } catch (e) {}
  return null;
}
// Frozen-candles fix 2026-10-20: the answer used to be asked once (2 tries) and a failure meant
// "not admin" for the whole page life, so the Owner sat on the 10-minute delayed feed with a live
// countdown. Now: an unknown or negative answer for a signed-in user is re-asked on a back-off
// (3 s, 6 s ... 60 s, then every 60 s), with a fresh token, until the server says yes; a "yes" is
// re-confirmed on every token refresh.
async function recheck(force) {
  if (!curUser) return st.admin;
  if (checking) return checking;
  const me = curUser;
  checking = (async () => {
    let token = st.token;
    try { token = force ? await curUser.getIdToken(true) : await curUser.getIdToken(); } catch (e) {}
    if (token) { st.token = token; st.exp = expOf(token); }
    const ans = token ? await askServer(token) : null;
    if (me !== curUser) return st.admin;   // signed out / switched user meanwhile: this answer is for nobody
    const was = st.admin, wasKnown = st.known;
    if (ans !== null) { st.admin = ans; st.checked = true; st.known = true; done(); }   // unknown (unreachable) stays unknown: never "not live"
    if (st.admin !== was || st.known !== wasKnown) emit();
    clearTimeout(recheckTm); recheckTm = null;
    if (curUser && !st.admin && (ans === null || recheckN < 4)) {   // unknown: keep asking (fast at first); a definite "no": 4 more looks (a late admin doc / read blip), then stop
      recheckN++;
      const wait = ans === null ? Math.min(15000, 1000 * Math.pow(2, Math.min(recheckN - 1, 4))) : Math.min(60000, 3000 * Math.pow(2, Math.min(recheckN, 5)));
      recheckTm = setTimeout(() => recheck(recheckN % 3 === 0), wait);
    } else recheckN = 0;
    return st.admin;
  })().finally(() => { checking = null; });
  return checking;
}
async function onUser(user) {
  if (!user) { const was = st.admin || !st.known; curUser = null; st.admin = false; st.uid = ''; st.token = ''; st.exp = 0; st.checked = false; st.known = true; recheckN = 0; clearTimeout(recheckTm); recheckTm = null; authKnown(); done(); if (was) emit(); return; }
  if (user.uid !== st.uid) { st.known = false; st.admin = false; st.checked = false; recheckN = 0; }   // a new user: the old answer is not theirs
  curUser = user;
  let token = '';
  try { token = await user.getIdToken(); } catch (e) {}
  if (curUser !== user) return;
  if (!token) { st.token = ''; authKnown(); recheck(true); return; }
  st.token = token; st.exp = expOf(token);
  authKnown();
  if (user.uid !== st.uid || !st.known || !st.admin) { st.uid = user.uid; await recheck(false); }
  else done();
}
// Keep the token fresh ourselves: Firebase refreshes on a timer that a sleeping laptop / throttled
// background tab can miss, which left an EXPIRED token in every request (the server then treats the
// caller as signed out = delayed feed). Checked every 30 s and the moment the tab is visible again.
// Awaitable: resolves with a token that has > minLeft seconds left, refreshing from Firebase if needed
// (a tab hidden for a while wakes up with an expired ID token; every request made with it is treated as
// signed out = 10-min delayed feed, and the stream is refused). Never rejects; falls back to the old token.
let freshP = null;
export function rtSecsLeft() { return st.exp ? st.exp - Date.now() / 1000 : 1e9; }
export function rtEnsureFresh(minLeft = 120) {
  if (!curUser || rtSecsLeft() > minLeft) return Promise.resolve(st.token);
  if (!freshP) freshP = curUser.getIdToken(true).then((t) => { if (t) { st.token = t; st.exp = expOf(t); emit(); } return st.token; }).catch(() => st.token).finally(() => { freshP = null; });
  return freshP;
}
function keepFresh() {
  if (!curUser || !st.exp) return;
  if (st.exp - Date.now() / 1000 < 300) {
    curUser.getIdToken(true).then((t) => { if (t) { st.token = t; st.exp = expOf(t); emit(); } }).catch(() => {});
  }
}
function start() {
  if (started) return;
  started = true;
  readyP = new Promise((res) => { readyRes = res; });
  if (typeof window === 'undefined') { st.known = true; authKnown(); done(); return; }   // tests / workers: signed-out behaviour
  // No Firebase app on the page after 8 s: signed out (known), as before. Once Firebase is hooked, the answer comes from the user + the
  // server only; an unreachable server keeps it UNKNOWN (no 10-minute pill), never a guessed "no". A late app still hooks (lane reload).
  const noFb = setTimeout(() => { st.known = true; authKnown(); done(); }, 8000);
  let tries = 0;
  const hook = () => {
    try {
      if (window.firebase && firebase.apps && firebase.apps.length) {
        clearTimeout(noFb);
        firebase.auth().onIdTokenChanged((u) => { onUser(u); });
        setInterval(keepFresh, 30000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) { rtEnsureFresh(600); if (curUser && !st.admin) recheck(true); } });
        return;
      }
    } catch (e) {}
    if (++tries < 300) setTimeout(hook, 100);
  };
  hook();
}
start();

export const rtReady = () => readyP;
// Decided: signed out, or the server answered for this user. The "10 min old" pill and data dot wait for this.
export const rtKnown = () => st.known;
export const isRealtimeAdmin = () => st.ready && st.admin;
export const rtToken = () => st.token;
export const rtRecheck = (force) => recheck(force);
// The server's own word on the LAST futures bars answer (admin => real rows, else cut 10 min): null until one arrives.
export const rtNoteBars = (rt) => { if (st.lastBars !== rt) { st.lastBars = rt; emit(); } };
// A bar that arrived over the admin-only stream is itself proof of the real-time lane (the server refuses the socket otherwise).
export const rtNoteStreamBar = () => { const was = rtConfirmed(); st.liveAt = Date.now(); if (rtConfirmed() !== was) emit(); };
// Truthful badge input: real-time only when the server confirmed admin AND the last bars answer was not cut.
export const rtConfirmed = () => st.ready && st.admin && (Date.now() - (st.liveAt || 0) < 30000 || (st.lastBars !== false && st.lastBars !== 'lag'));
export const rtState = () => ({ ready: st.ready, known: st.known, authed: st.authed, admin: st.admin, uid: st.uid ? st.uid.slice(0, 4) + '…' : '', tokenSecsLeft: st.exp ? Math.round(st.exp - Date.now() / 1000) : null, lastBarsRt: st.lastBars });
if (typeof window !== 'undefined') window.tzRtState = rtState;                 // '' when signed out
export const rtHeaders = () => (st.token ? { authorization: 'Bearer ' + st.token } : {});
export const rtOnChange = (f) => { subs.add(f); return () => subs.delete(f); };
// Waits (up to ms) until the answer is decided (signed out, or the server said yes / no for this user), then returns the headers for a
// data request. It used to wait 4 s: a slower sign-in sent the first bars before the answer, so the history lane differed load to load.
export async function rtHeadersReady(ms = 15000) {
  if (!st.ready) await Promise.race([readyP, new Promise((r) => setTimeout(r, ms))]);
  if (st.token && rtSecsLeft() < 120) await Promise.race([rtEnsureFresh(120), new Promise((r) => setTimeout(r, 4000))]);
  return rtHeaders();
}
// tests only (node): pretend the auth answer is in
export function _rtSetForTests(admin, token = 'test-token') { st.ready = true; st.known = true; st.authed = true; st.admin = admin; st.token = token; if (readyRes) readyRes(); emit(); }
// tests only (node): drive the real sign-in path with a fake user (getIdToken) and a fake /api/chart/rt (globalThis.fetch)
export const _rtOnUserForTests = (u) => onUser(u);
export function _rtResetForTests() { Object.assign(st, { ready: false, known: false, authed: false, admin: false, uid: '', token: '', exp: 0, checked: false, lastBars: null, liveAt: 0 }); curUser = null; recheckN = 0; clearTimeout(recheckTm); recheckTm = null; checking = null; }
// tests only (node): a fake signed-in user whose getIdToken(true) hands out a fresh token; exp = secs left on the current one
export function _rtSetUserForTests(secsLeft, fresh = 'fresh-token') { curUser = { getIdToken: async () => { st.exp = 0; return fresh; } }; st.exp = Date.now() / 1000 + secsLeft; const o = curUser.getIdToken; curUser.getIdToken = async () => fresh; }
