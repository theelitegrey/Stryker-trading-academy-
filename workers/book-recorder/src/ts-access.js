// ACCESS GATE for the futures L2 / L1 trades feed. Released to Pro by the Owner (2026-11-03): Worker var TS_ACCESS = 'pro'
// (wrangler.jsonc) lets admins, the demo account and active Pro members in (same rule as GEX+). Unset or unknown = 'admin'
// only (fails closed). Free, signed-out and expired members are refused.
import { isAdminToken, isGexProToken, isRealtimeToken } from './rt-auth.js';

export const tsAccess = (env) => (env && String(env.TS_ACCESS || '').toLowerCase() === 'pro' ? 'pro' : 'admin');
export async function tsAllowed(env, token, opts = {}) {
  if (!token) return false;
  return tsAccess(env) === 'pro' ? isGexProToken(token, opts) : isAdminToken(token, opts);
}

// TIERS (Owner order 2026-11-03, "live futures from the hub, not the old vendor"): who may open /ts-live and at what level.
//   'book'   = tsAllowed() above (admins; plus Pro when TS_ACCESS='pro'): trades AND the L2 book.
//   'trades' = anyone the site already gives live futures (isRealtimeToken: admin, demo, switched-on members, the live-data add-on,
//              kept-live early Pro): trades, candles and quotes only, never the book.
//   null     = nobody else (free, signed out, bad token). Fails closed; the server is the gate, the page only hides things.
export async function tsTier(env, token, opts = {}) {
  if (!token) return null;
  if (await tsAllowed(env, token, opts)) return 'book';
  return (await isRealtimeToken(token, opts)) ? 'trades' : null;
}
