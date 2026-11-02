// LICENCE GATE for the Tick-stream L2 feed (Owner order 2026-11-02). Tick-stream's pricing needs a Redistribution licence
// before data is shown to people outside the company, and the Owner has not confirmed it. Until he does, only admins
// get in. ONE flag flips it: Worker var TS_ACCESS (wrangler.jsonc vars, redeploy) = 'admin' (default, anything unknown
// also means admin) or 'pro' (adds the demo account and active Pro members, the same rule as GEX+). Fails closed.
import { isAdminToken, isGexProToken } from './rt-auth.js';

export const tsAccess = (env) => (env && String(env.TS_ACCESS || '').toLowerCase() === 'pro' ? 'pro' : 'admin');
export async function tsAllowed(env, token, opts = {}) {
  if (!token) return false;
  return tsAccess(env) === 'pro' ? isGexProToken(token, opts) : isAdminToken(token, opts);
}
