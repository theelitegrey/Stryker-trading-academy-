// Admin-only READ pass-through to Finatic for the journal's broker sync (beta). POST {op, ...}.
// Allow-list below is the whole surface: every op maps to a fixed GET path (plus the grant revoke used by "Disconnect").
// There is deliberately NO order create / modify / cancel path, and the client never supplies a path. Stores and logs nothing.
import { gate, readBody, fin, startSession, sessionHeaders, json, fail, UUID, ID } from './_fin.js';

const A = (id) => '/api/v1/accounts/' + encodeURIComponent(id);
export const OPS = {
  accounts: () => '/api/v1/accounts',
  grants: () => '/api/v1/account-grants',
  orders: (b) => A(b.accountId) + '/orders',
  transactions: (b) => A(b.accountId) + '/transactions',
  positions: (b) => A(b.accountId) + '/positions',
  balances: (b) => A(b.accountId) + '/balances',
};
const MAX_ORDERS_PER_CALL = 25;

export async function handle(request, env, deps = {}) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  const g = await gate(request, env, deps, 'finatic-data');
  if (g instanceof Response) return g;
  const b = await readBody(request);
  if (!b || typeof b !== 'object') return fail(400, 'Bad request');
  const op = b.op;
  const isRead = Object.prototype.hasOwnProperty.call(OPS, op);
  if (!isRead && op !== 'fills' && op !== 'revoke') return fail(400, 'Not allowed');
  if (op !== 'accounts' && op !== 'grants' && op !== 'revoke' && !(typeof b.accountId === 'string' && UUID.test(b.accountId))) return fail(400, 'accountId missing');
  if (op === 'revoke' && !(typeof b.grantId === 'string' && UUID.test(b.grantId))) return fail(400, 'grantId missing');
  if (op === 'fills' && !(Array.isArray(b.orderIds) && b.orderIds.length >= 1 && b.orderIds.length <= MAX_ORDERS_PER_CALL && b.orderIds.every((x) => typeof x === 'string' && ID.test(x)))) return fail(400, 'orderIds missing');

  // Finatic user: the id the Connect portal created for this admin. Known id (kept by the admin's browser) or the session that just ran the portal.
  let finUser = typeof b.userId === 'string' && UUID.test(b.userId) ? b.userId : '';
  if (!finUser && typeof b.sessionId === 'string' && ID.test(b.sessionId)) {
    const u = await fin(env, deps, 'GET', '/api/v1/sessions/' + encodeURIComponent(b.sessionId) + '/user');
    finUser = (u.ok && u.data && (u.data.userId || u.data.user_id)) || '';
  }
  if (!finUser) return json({ error: 'Not connected yet', needsConnect: true }, 409);
  const s = await startSession(env, deps, finUser);
  if (!s || !s.authenticated) return json({ error: 'Not connected yet', needsConnect: true }, 409);
  const h = sessionHeaders(s);
  const page = { limit: Math.min(Math.max(parseInt(b.limit, 10) || 100, 1), 1000), offset: Math.max(parseInt(b.offset, 10) || 0, 0) };

  if (op === 'revoke') {
    const r = await fin(env, deps, 'POST', '/api/v1/account-grants/' + encodeURIComponent(b.grantId) + '/revoke', { headers: h });
    return r.ok ? json({ ok: true, userId: finUser }) : fail(502, 'Could not disconnect');
  }
  if (op === 'fills') {
    const out = [];
    for (const oid of b.orderIds) {
      const r = await fin(env, deps, 'GET', A(b.accountId) + '/orders/' + encodeURIComponent(oid) + '/fills', { headers: h });
      if (!r.ok) return fail(502, 'Broker data is unavailable right now');
      (Array.isArray(r.data) ? r.data : []).forEach((f) => out.push(f));
    }
    return json({ data: out, userId: finUser });
  }
  const r = await fin(env, deps, 'GET', OPS[op](b), { headers: h, query: op === 'accounts' ? { ...page, include_sync_status: 'true' } : page });
  if (!r.ok) return fail(502, 'Broker data is unavailable right now');
  return json({ data: r.data, userId: finUser });
}
export const onRequest = ({ request, env }) => handle(request, env);
