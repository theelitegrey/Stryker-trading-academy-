// ACCESS GATE for the futures L2 / L1 trades feed. Released to Pro by the Owner (2026-11-03): Worker var TS_ACCESS = 'pro'
// (wrangler.jsonc) lets admins, the demo account and active Pro members in (same rule as GEX+). Unset or unknown = 'admin'
// only (fails closed). Free, signed-out and expired members are refused.
import { isAdminToken, isGexProToken } from './rt-auth.js';

export const tsAccess = (env) => (env && String(env.TS_ACCESS || '').toLowerCase() === 'pro' ? 'pro' : 'admin');
export async function tsAllowed(env, token, opts = {}) {
  if (!token) return false;
  return tsAccess(env) === 'pro' ? isGexProToken(token, opts) : isAdminToken(token, opts);
}
