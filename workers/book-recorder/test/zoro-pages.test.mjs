// functions/api/zo/[name].js: the Pages-side gate fails closed and only the SPX teaser reads pass without Pro.
import assert from 'node:assert/strict';
import { onRequestGet } from '../../../functions/api/zo/[name].js';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
let hits = 0;
globalThis.fetch = async () => { hits++; return new Response('{}', { status: 403 }); };   // token check (Firestore) and Worker both refuse
const call = (name, qs, auth) => onRequestGet({ request: new Request('https://s.dev/api/zo/' + name + qs, { headers: auth ? { authorization: 'Bearer ' + auth } : {} }), params: { name }, env: {} });
for (const [name, qs] of [['surface', '?u=SPX'], ['history', '?u=SPX'], ['screen', ''], ['cme', '?root=ES'], ['activity', '?u=ALL'], ['profile', '?u=QQQ'], ['profile', '?u=SPX&x=all'], ['summary', '?u=QQQ'], ['levels-export', '?u=SPX']]) {
  hits = 0; const r = await call(name, qs); ok(r.status === 403 && hits === 0 && r.headers.get('cache-control') === 'no-store', 'no token -> 403, Worker not called: ' + name + qs);
}
hits = 0; let r = await call('summary', '?u=SPX', 'bad.jwt.token'); ok(r.status === 403 && hits === 1, 'teaser read passes the gate and goes to the Worker (Worker answered 403 here)');
r = await call('nothing', ''); ok(r.status === 404, 'unknown route -> 404');
console.log(n + ' checks passed');
