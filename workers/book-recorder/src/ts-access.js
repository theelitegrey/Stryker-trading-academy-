// ACCESS GATE for the futures L2 / L1 trades feed. DATA PLANS (Owner 2026-11-04): the tools are free, the LIVE data is paid.
// Worker var TS_ACCESS = 'pro' (wrangler.jsonc) opens the live L2 book to isL2Token (admin, demo, L2 Data add-on, active Pro while it
// lasts). Unset or unknown = 'admin' only for the live book (fails closed).
import { isAdminToken, isL2Token, isRealtimeToken, isMemberToken, RT_DELAY_S } from './rt-auth.js';

export const tsAccess = (env) => (env && String(env.TS_ACCESS || '').toLowerCase() === 'pro' ? 'pro' : 'admin');
// LIVE L2 book (the /ts-live 'book' tier and the undelayed book history)
export async function tsAllowed(env, token, opts = {}) {
  if (!token) return false;
  return tsAccess(env) === 'pro' ? isL2Token(token, opts) : isAdminToken(token, opts);
}

// TIERS for the /ts-live WebSocket:
//   'book'   = tsAllowed() above: trades AND the live L2 book.
//   'trades' = isRealtimeToken (L1 live: admin, demo, switched-on members, L1 or L2 add-on, active Pro): trades, candles, quotes, never the book.
//   null     = nobody else (free members use the delayed history routes, signed out, bad token). Fails closed.
export async function tsTier(env, token, opts = {}) {
  if (!token) return null;
  if (await tsAllowed(env, token, opts)) return 'book';
  return (await isRealtimeToken(token, opts)) ? 'trades' : null;
}

// HISTORY reads (/ts-book-history, /ts-aux, /ts-trades): the recorded data feeds free tools, so any signed-in member may read it,
// but only up to now - 10 min (the L1 delay) unless they hold the live tier for that data. -> { cutMs } (0 = no cut) or null = refused.
//   /ts-book-history, /ts-aux (book-derived): live = tsAllowed (L2).  /ts-trades (trade prints + delta): live = isRealtimeToken (L1).
export async function tsHistoryAccess(env, token, path, opts = {}) {
  if (!token || !(await isMemberToken(token, opts))) return null;
  const live = path === '/ts-trades' ? await isRealtimeToken(token, opts) : await tsAllowed(env, token, opts);
  return { cutMs: live ? 0 : (opts.nowMs || Date.now()) - RT_DELAY_S * 1000 - 60000 };
}
