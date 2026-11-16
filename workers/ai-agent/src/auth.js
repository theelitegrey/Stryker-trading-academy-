// TradeZoro AI agent: Firebase ID token check for the Worker. Reuses the site's own verifier (signature against Google's
// keys, issuer, audience, expiry, anonymous refused: functions/api/chart/_rt.js) and adds the two claims we need here.
import { verifyIdToken } from '../../../functions/api/chart/_rt.js';

function payloadOf(t) {
  try { const p = String(t).split('.')[1]; return JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return {}; }
}
// -> { uid, exp, authTime } or null. opts.fetchImpl / nowSec for tests; env.__TEST_VERIFY lets the local test rig stand in.
// LOCAL TEST ONLY: with DEV=1 and DEV_FAKE_AUTH=1 (passed with --var by tools/tests/ai-agent-dev.sh, never in wrangler.jsonc)
// and a LOOPBACK host (127.0.0.1 / localhost / ::1), "devtok.<uid>" stands for a signed-in member. Dead on every real host.
export const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/;
export async function verifyMember(token, env, opts = {}) {
  if (env && typeof env.__TEST_VERIFY === 'function') return env.__TEST_VERIFY(token);
  if (env && env.DEV === '1' && env.DEV_FAKE_AUTH === '1' && LOOPBACK.test(String(opts.host || ''))) {
    const m = /^devtok\.([A-Za-z0-9]{1,40})$/.exec(String(token || ''));
    return m ? { uid: m[1], exp: Math.floor(Date.now() / 1000) + 3600, authTime: Math.floor(Date.now() / 1000) - 60 } : null;
  }
  const uid = await verifyIdToken(token, opts);
  if (!uid) return null;
  const p = payloadOf(token);
  return { uid, exp: Number(p.exp) || 0, authTime: Number(p.auth_time) || 0 };
}
export function deviceName(ua) {
  ua = String(ua || '');
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Browser';
}
