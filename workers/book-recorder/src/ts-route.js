// Book-recorder /ts-* routing hardening (security review 2026-11-14, ALL TOOLS FREE follow-up). Pure, no I/O.
//
// 1. Live vs delayed is decided ONLY from the path + the verified token and plan (src/ts-access.js). A request
//    header (Upgrade / Connection / Sec-WebSocket-*) never changes which gate runs: the ONLY socket route is /ts-live,
//    and an upgrade request on any history route is refused (400) instead of being routed anywhere.
// 2. History responses carry Cache-Control: private, no-store and Vary: Authorization, Origin, so no shared or browser
//    cache can hand a live (paid) response to a delayed member.
// 3. Query parameters are allow-listed per route and value-checked. Anything else (including a client-sent tier, lane
//    or cut) is dropped before the request reaches the Durable Object; the Worker then sets tier / to / fill itself.
// Education only. Not financial advice.

export const TS_ROUTES = new Set(['/ts-live', '/ts-book-history', '/ts-aux', '/ts-trades']);
export const TS_HISTORY = new Set(['/ts-book-history', '/ts-aux', '/ts-trades']);

// per route: allowed client params -> value check (returns the clean string, or null = drop it)
const SYM = (v) => (/^[A-Za-z0-9]{1,8}$/.test(v) ? v.toUpperCase() : null);
const MS = (v) => (/^\d{1,15}$/.test(v) ? v : null);                      // epoch ms, digits only (no 1e20, NaN, Infinity, negatives)
const FILL = (v) => (v === '0' ? '0' : null);                             // the client may only switch the archive fill OFF
const LEVELS = (v) => (/^\d{1,3}$/.test(v) && +v >= 1 && +v <= 200 ? String(+v) : null);
export const TS_PARAMS = {
  '/ts-live': { symbol: SYM, levels: LEVELS },
  '/ts-book-history': { symbol: SYM, from: MS, to: MS, fill: FILL },
  '/ts-aux': { symbol: SYM, from: MS, to: MS },
  '/ts-trades': { sym: SYM, symbol: SYM, from: MS, to: MS, fill: FILL }
};

// The path alone says socket or history. Header tricks on a history path are refused, never honoured.
// -> 'live' (the /ts-live socket) | 'history' | 'bad_upgrade' | 'ws_required' | null (not a /ts-* route)
export function tsKind(pathname, headers) {
  if (!TS_ROUTES.has(pathname)) return null;
  const up = String((headers && headers.get && headers.get('upgrade')) || '').toLowerCase();
  if (pathname === '/ts-live') return up === 'websocket' ? 'live' : 'ws_required';
  return up ? 'bad_upgrade' : 'history';
}

// Clean URL for the Durable Object: only allow-listed params (first value only), then the Worker's own tier and,
// for a delayed read, to = min(to, cut) and fill = 0. `cutMs` is a number (delayed) or 0/null (live).
export function tsForwardUrl(u, { tier, cutMs }) {
  const allow = TS_PARAMS[u.pathname] || {};
  const out = new URL('https://do' + u.pathname);
  for (const k of Object.keys(allow)) {
    if (!u.searchParams.has(k)) continue;
    const v = allow[k](String(u.searchParams.get(k)));
    if (v !== null) out.searchParams.set(k, v);
  }
  if (cutMs) {
    const to = Number(out.searchParams.get('to'));
    out.searchParams.set('to', String(to > 0 ? Math.min(to, cutMs) : cutMs));
    if (out.searchParams.has('from') && Number(out.searchParams.get('from')) > Number(out.searchParams.get('to'))) out.searchParams.set('from', out.searchParams.get('to'));
    out.searchParams.set('fill', '0');
  }
  if (tier) out.searchParams.set('tier', tier);
  return out.toString();
}

// Headers on every /ts-* history response (and on its refusals): never cached, keyed on the caller.
export const TS_NO_CACHE = { 'cache-control': 'private, no-store', vary: 'Authorization, Origin' };
