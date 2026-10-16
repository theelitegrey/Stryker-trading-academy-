// TradeZoro — real-time CME futures access (ES module)
// Depends on: Firebase compat auth (window.firebase, started by assets/auth.js); GET /api/chart/rt
// (functions/api/chart/rt.js).
// Owner order 2026-10-16: real-time CME futures data is ADMIN ONLY. Everyone else (signed out, free,
// Pro) gets data 10 minutes behind. The SERVER enforces it (stream, /api/chart/bars, the recorder's
// /orderflow + /ticks1s all check a verified Firebase ID token); this module only (1) carries the ID
// token to those endpoints and (2) tells the UI which mode it is in, so it never opens a stream that
// would be refused and shows the right data dot. A client "admin" answer is never trusted by a server.
const st = { ready: false, admin: false, uid: '', token: '' };
const subs = new Set();
let readyP = null, readyRes = null, started = false;

const emit = () => subs.forEach((f) => { try { f(); } catch (e) {} });
function done() { if (!st.ready) { st.ready = true; if (readyRes) readyRes(); } emit(); }

async function checkAdmin(token) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch('/api/chart/rt', { headers: { authorization: 'Bearer ' + token } });
      if (r.ok) return (await r.json()).admin === true;
    } catch (e) {}
    await new Promise((res) => setTimeout(res, 2500));
  }
  return false;
}
async function onUser(user) {
  if (!user) { st.admin = false; st.uid = ''; st.token = ''; done(); return; }
  let token = '';
  try { token = await user.getIdToken(); } catch (e) {}
  if (!token) { st.admin = false; st.token = ''; done(); return; }
  st.token = token;
  if (user.uid !== st.uid || !st.ready) { st.uid = user.uid; st.admin = await checkAdmin(token); }
  done();
}
function start() {
  if (started) return;
  started = true;
  readyP = new Promise((res) => { readyRes = res; });
  if (typeof window === 'undefined') { done(); return; }   // tests / workers: signed-out behaviour
  const giveUp = setTimeout(done, 8000); // no Firebase on this page: signed-out behaviour
  let tries = 0;
  const hook = () => {
    try {
      if (window.firebase && firebase.apps && firebase.apps.length) {
        clearTimeout(giveUp);
        firebase.auth().onIdTokenChanged((u) => { onUser(u); });
        return;
      }
    } catch (e) {}
    if (++tries < 80) setTimeout(hook, 100);
  };
  hook();
}
start();

export const rtReady = () => readyP;
export const isRealtimeAdmin = () => st.ready && st.admin;
export const rtToken = () => st.token;                 // '' when signed out
export const rtHeaders = () => (st.token ? { authorization: 'Bearer ' + st.token } : {});
export const rtOnChange = (f) => { subs.add(f); return () => subs.delete(f); };
// Waits (up to ms) for the first auth answer, then returns the headers for a data request.
export async function rtHeadersReady(ms = 4000) {
  if (!st.ready) await Promise.race([readyP, new Promise((r) => setTimeout(r, ms))]);
  return rtHeaders();
}
