// ACCESS GATE for the futures L2 / L1 trades feed. ALL TOOLS FREE (Owner order 2026-11-13): the tools are free for every signed-in
// member; only the LIVE data feed is paid (the existing Pro subscription), because the exchange's rules make it paid.
// Worker var TS_ACCESS = 'pro' (wrangler.jsonc) opens the LIVE L2 book to isLiveDataToken (admin, demo, active Pro incl. grandfathered).
// Unset or unknown = 'admin' only for the live book (fails closed).
import { isAdminToken, isLiveDataToken, isRealtimeToken, isMemberToken, RT_DELAY_S } from './rt-auth.js';

export const tsAccess = (env) => (env && String(env.TS_ACCESS || '').toLowerCase() === 'pro' ? 'pro' : 'admin');
// LIVE L2 book (the /ts-live 'book' tier and the undelayed book history)
export async function tsAllowed(env, token, opts = {}) {
  if (!token) return false;
  return tsAccess(env) === 'pro' ? isLiveDataToken(token, opts) : isAdminToken(token, opts);
}

// TIERS for the /ts-live WebSocket (unchanged rules, Owner 2026-11-03 / 2026-11-04):
//   'book'   = tsAllowed() above: trades AND the live L2 book (the paid data feed).
//   'trades' = isRealtimeToken (L1 live: admin, demo, switched-on members, the live-data add-on, kept-live early Pro, and any member
//              with the signed market data agreement): trades, candles and quotes only, never the book.
//   null     = nobody else (signed out, anonymous, bad token, no agreement). Fails closed; the server is the gate, the page only hides things.
export async function tsTier(env, token, opts = {}) {
  if (!token) return null;
  if (await tsAllowed(env, token, opts)) return 'book';
  return (await isRealtimeToken(token, opts)) ? 'trades' : null;
}

// HISTORY reads (/ts-book-history, /ts-aux, /ts-trades) feed the free tools (Footprint (L2), the DOM heatmap's history, the book pack),
// so ANY signed-in, non-anonymous member may read them, but only up to now - 11 min (the 10-minute exchange delay + 60 s) unless they
// hold the LIVE level for that data:
//   /ts-book-history, /ts-aux (book-derived): live = tsAllowed (L2, the paid feed).
//   /ts-trades (trade prints + delta): live = isRealtimeToken (L1: the signed agreement is enough, as on /ts-live) or the L2 level
//   (the 'book' tier always carried trades, so a payer without the agreement keeps live prints, as before).
// -> { cutMs } (0 = no cut, live) or null = refused (no token, anonymous, bad token).
export const TS_HIST_CUT_MS = RT_DELAY_S * 1000 + 60000;
export async function tsHistoryAccess(env, token, path, opts = {}) {
  if (!token || !(await isMemberToken(token, opts))) return null;
  const live = (await tsAllowed(env, token, opts)) || (path === '/ts-trades' && (await isRealtimeToken(token, opts)));
  return { cutMs: live ? 0 : (opts.nowMs || Date.now()) - TS_HIST_CUT_MS };
}
