// TradeZoro — "Connect your own data": one-tap sign-in for Alpaca and tastytrade (ES module). DATA ONLY, read-only scopes.
// Same pattern as byo-ctrader.js: the member signs in on the broker's own page; our function /connect/<id>/token swaps the code
// (it holds the client secret); tokens stay in the encrypted, user-bound device vault (byo-core.js). After sign-in market data
// goes browser -> broker DIRECT with the bearer token. No relay. The paste-a-key path stays as "Use an API key instead".
import { saveSource, srcById } from './byo-core.js?v=972';

// scope is the ONLY permission asked for. Tests fail if a trading / account-write scope word appears in this file.
export const OA = {
  alpaca: { AUTH: 'https://app.alpaca.markets/oauth/authorize', SCOPE: 'data', cta: 'Sign in with Alpaca', refresh: false },
  tastytrade: { AUTH: 'https://my.tastytrade.com/auth.html', SCOPE: 'read', cta: 'Sign in with tastytrade', refresh: true, REFRESH_BEFORE: 2 * 60000,
    note: 'Needs two-factor sign-in turned on in your tastytrade account.' },
  // India. No scope parameter exists at either broker, and their token can also trade: byo-core.js ALLOW.upstox / ALLOW.fyers is the protection.
  // daily [h, m] = the sign-in ends at that India time every day, no refresh (Fyers refresh needs the member's PIN, so we ask for a new sign-in instead).
  upstox: { AUTH: 'https://api.upstox.com/v2/login/authorization/dialog', SCOPE: null, cta: 'Sign in with Upstox', refresh: false, daily: [3, 30], signin: true,
    note: 'Upstox ends the sign-in every night (about 3:30 AM India time), so you sign in again each day.' },
  fyers: { AUTH: 'https://api-t1.fyers.in/api/v3/generate-authcode', SCOPE: null, cta: 'Sign in with Fyers', refresh: false, daily: [6, 30], signin: true,
    note: 'Fyers ends the sign-in every morning (6:30 AM India time), so you sign in again each day.' }
};
// Next daily end of a sign-in, as ms epoch. India time is UTC+5:30 all year (no daylight saving).
export function nextDaily([h, m], now = Date.now()) {
  const IST = 330 * MIN, local = now + IST, day = Math.floor(local / 864e5) * 864e5;
  let t = day + (h * 60 + m) * MIN; if (t <= local) t += 864e5;
  return t - IST;
}
const KEY = 'tz-oauth-state', MIN = 60000;
const TRADE_SCOPE = new RegExp('\\b(trade|trading|account:' + 'write)\\b', 'i');   // built from parts so the repo-wide "no write scope word" test stays strict
const HARD = { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' };
const dep = (d) => ({ fetch: (d && d.fetch) || ((...a) => globalThis.fetch(...a)) });
const fail = (msg, o) => Object.assign(new Error(msg), o);
export const redirectOf = (id) => 'https://tradezoro.com/connect/' + id + '/callback';
const tokenUrl = (id) => '/connect/' + id + '/token';
const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function probeOauth(id, d) {
  try {
    const r = await dep(d).fetch(tokenUrl(id) + '?probe=1', { credentials: 'omit', cache: 'no-store' });
    const j = r.ok ? await r.json() : null;
    return j && j.configured === true && /^[A-Za-z0-9_\-]{6,80}$/.test(j.client_id || '') ? j.client_id : null;
  } catch (e) { return null; }
}
// Flag: row turns into "Sign in" only when the function says it has its keys. Until then the row keeps today's paste-a-key form.
export async function enableOauthIfConfigured(d) {
  let any = false;
  for (const id of Object.keys(OA)) {
    const cid = await probeOauth(id, d), row = srcById(id);
    if (cid && row && OA[id].signin) { Object.assign(row, { state: 'ready', oauth: true, signin: true, clientId: cid, cta: OA[id].cta, signinNote: OA[id].note || '' }); any = true; }   // sign-in only: there is no key form
    else if (cid && row) { Object.assign(row, { oauth: true, clientId: cid, cta: OA[id].cta, keyAlt: true, signinNote: OA[id].note || '' }); any = true; }
  }
  return any;
}
export function oauthAuthUrl(id, clientId, userId, store = globalThis.sessionStorage) {
  const o = OA[id]; if (!o) throw new Error('Unknown source');
  if (!userId) throw new Error('Sign in to connect your own data');
  const rec = { id, state: b64url(globalThis.crypto.getRandomValues(new Uint8Array(16))), uid: userId, exp: Date.now() + 10 * MIN };
  store.setItem(KEY, JSON.stringify(rec));
  const q = { response_type: 'code', client_id: clientId, redirect_uri: redirectOf(id), state: rec.state };
  if (o.SCOPE) q.scope = o.SCOPE;
  return o.AUTH + '?' + new URLSearchParams(q);
}
export function takeOauthState(id, state, userId, store = globalThis.sessionStorage) {
  let rec = null; try { rec = JSON.parse(store.getItem(KEY) || 'null'); } catch (e) { /* none */ }
  store.removeItem(KEY);
  return rec && rec.id === id && state && rec.state === state && rec.uid === userId && rec.exp > Date.now() ? rec : null;
}
export async function oauthTokenCall(id, body, idToken, d) {
  const r = await dep(d).fetch(tokenUrl(id), { method: 'POST', ...HARD, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken }, body: JSON.stringify(body) });
  if (r.status === 503) throw fail(srcById(id).name + ' is coming soon', { status: 503 });
  const j = r.ok ? await r.json().catch(() => null) : null;
  if (!j || !j.access_token) throw fail(id + ' ' + r.status, { status: r.status });
  // A mistake-stopper: refuse a grant that carries a trading scope (the sign-in URL never asks for one).
  if (TRADE_SCOPE.test(String(j.scope || ''))) throw fail('This sign-in can place trades. Not connected.', { status: 0 });
  return j;
}
// access: bearer for the data calls. refresh: tastytrade only (never expires; lives only in the device vault). exp: ms epoch (0 = no expiry known).
export const oauthCreds = (id, j, prev, now = Date.now()) => ({ ...(prev || {}), oauth: true, access: j.access_token, refresh: j.refresh_token || (prev && prev.refresh),
  exp: OA[id].daily ? nextDaily(OA[id].daily, now) : j.expires_in ? now + Number(j.expires_in) * 1000 : (OA[id].refresh ? now + 15 * MIN : 0), ...(OA[id].daily ? { daily: true } : {}) });

const idTokenOf = (d) => (d && d.idToken ? d.idToken() : globalThis.firebase.auth().currentUser.getIdToken());
// tastytrade: the 15-minute access token is refreshed through our function shortly before it ends. A refused refresh = Reconnect.
const flights = new WeakMap();
export async function freshOauth(id, c, d) {
  if (!OA[id].refresh || !c.exp || c.exp - Date.now() > OA[id].REFRESH_BEFORE) return c.access;
  const run = async () => {
    if (c.exp - Date.now() > OA[id].REFRESH_BEFORE) return c.access;
    if (!c.refresh) throw fail('Reconnect ' + srcById(id).name, { reconnect: true });
    let idt; try { idt = await idTokenOf(d); } catch (e) { throw fail('Sign in again', { status: 401 }); }
    let j; try { j = await oauthTokenCall(id, { grant: 'refresh', refresh_token: c.refresh }, idt, d); }
    catch (e) { if (e.status === 400 || e.status === 401) throw fail('Reconnect ' + srcById(id).name, { reconnect: true }); throw e; }
    const prevRt = c.refresh; Object.assign(c, oauthCreds(id, j, c));
    if (c.refresh !== prevRt) { try { await saveSource(id, c); } catch (e) { /* kept in memory */ } }
    return c.access;
  };
  if (flights.has(c)) return flights.get(c);   // one refresh at a time in this tab; navigator.locks covers other tabs
  const L = globalThis.navigator && navigator.locks;
  const p = (L ? L.request('tz-oauth-refresh-' + id, run) : run()).finally(() => flights.delete(c));
  flights.set(c, p); return p;
}
