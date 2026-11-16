// Order route speed bench: runs the order handler of origin/main (OLD, copied to a temp dir) and of this branch (NEW) against the same
// mocked upstreams with fixed per-host latencies, and prints the server time of a chart LIVE place (warm isolate, 2nd order) and of
// the first order after the panel opens. No network. Latencies are inputs (see LAT below; measured from the NYC VPS 16 Nov unless marked).
//   node tools/tests/order-speed-bench.mjs [oldRef=origin/main]
import { execSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { generateKeyPairSync, createSign } from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ref = process.argv[2] || 'origin/main';
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'ordbench-'));
for (const f of ['functions/connect/finatic/order.js', 'functions/connect/finatic/_fin.js', 'functions/connect/finatic/_audit.js', 'functions/connect/_token.js', 'functions/api/chart/_rt.js', 'assets/chart-live-core.js']) {
  fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true });
  fs.writeFileSync(path.join(tmp, f), execSync('git show ' + ref + ':' + f, { cwd: ROOT }));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tok = () => { const n = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: 'admin1', iat: n - 5, exp: n + 3000 }); return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url'); };
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const sa = JSON.stringify({ client_email: 'x@y', private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const US = '0aaa1111-2222-3333-4444-555566667777', ACC = '123e4567-e89b-12d3-a456-426614174000';
const ok = (d) => new Response(JSON.stringify({ data: d, errors: [] }));

async function bench(dir, LAT) {
  const O = await import(path.join(dir, 'functions/connect/finatic/order.js') + '?' + Math.random());
  const verifyFetch = async (u) => { if (String(u).includes('jwk')) return new Response(JSON.stringify({ keys: [jwk] })); await sleep(LAT.firestore); return new Response('{}'); };
  let sid = 0;
  const finFetch = async (u, i) => { await sleep(LAT.fin); const p = new URL(u).pathname;
    if (p.endsWith('/session/init')) return ok({ one_time_token: 'o' }); if (p.endsWith('/session/start')) return ok({ session_id: 's' + (++sid), status: 'active', user_id: US });
    if (i.method === 'POST') return ok({ accepted: true, order: { orderId: 'n', status: 'SUBMITTED' } }); return ok([]); };
  const docs = new Set();
  const auditFetch = async (u, i = {}) => { const s = String(u);
    if (s.includes('oauth2')) { await sleep(LAT.oauth); return new Response(JSON.stringify({ access_token: 'a' })); }
    await sleep(LAT.firestore); if (s.includes('liveTrading')) return new Response('{}', { status: 404 }); return new Response('{}'); };
  const kv = new Map(); const PASSKEYS = { get: async (k) => { await sleep(LAT.kvGet); return kv.get(k) || null; }, put: async (k, v) => { await sleep(LAT.kvPut); kv.set(k, v); } };
  const env = { FINATIC_API_KEY: 'fntc_live_X', FINATIC_LIVE_ORDERS: '1', FIREBASE_SA_KEY: sa, PASSKEYS };
  const pend = []; const deps = { verifyFetch, finFetch, auditFetch, defer: (p) => { pend.push(p); return p; } };
  let ip = 0, n = 0;
  const call = async (b) => { const r = new Request('https://tradezoro.com/connect/finatic/order', { method: 'POST', headers: { 'cf-connecting-ip': '10.0.0.' + (++ip), origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + tok() }, body: JSON.stringify({ src: 'chart', accountId: ACC, userId: US, ...b }) });
    const a = performance.now(); const res = await O.handle(r, env, deps); const ms = performance.now() - a; await res.text(); await Promise.all(pend.splice(0)); return { ms, st: res.status, timing: res.headers.get('server-timing') || '' }; };
  const place = () => ({ op: 'place', symbol: 'NQZ6', side: 'buy', qty: 1, type: 'market', idemKey: 'bench' + String(++n).padStart(14, '0') });
  await call({ op: 'env' });                                     // panel open (pre-warm on NEW; just the badge on OLD)
  await sleep(LAT.betweenMs || 0);
  const first = await call(place());
  const warm = []; for (let i = 0; i < 3; i++) { await sleep(6000 / 100); O._resetRate && O._resetRate(); warm.push(await call(place())); }
  warm.sort((a, b) => a.ms - b.ms);
  return { first: Math.round(first.ms), firstSt: first.st, warm: Math.round(warm[1].ms), timing: warm[1].timing };
}

const SCEN = {
  // Pages function at the visitor's edge near the broker (US east): Finatic ~22 ms per call (measured NYC), Google OAuth 230, Firestore 140 (measured)
  'edge in US east (measured latencies)': { fin: 22, oauth: 230, firestore: 140, kvGet: 10, kvPut: 60 },
  // Owner in India: the Pages function runs at the Mumbai/Chennai edge, each broker call crosses to Virginia (~200 ms RTT, ESTIMATE)
  'edge in India (estimated 200 ms to the broker)': { fin: 210, oauth: 60, firestore: 60, kvGet: 10, kvPut: 60 },
  // NEW + the placed Worker in aws:us-east-1: broker ~2 ms away + its own ~18 ms (from the 22 ms above); Google from Virginia
  'placed Worker aws:us-east-1 (estimate)': { fin: 20, oauth: 120, firestore: 40, kvGet: 10, kvPut: 60 },
};
for (const [name, LAT] of Object.entries(SCEN)) {
  const old = name.startsWith('placed') ? null : await bench(tmp, LAT);
  const neu = await bench(ROOT, LAT);
  console.log(name + ':' + (old ? '  OLD first ' + old.first + ' ms, warm ' + old.warm + ' ms |' : '') + '  NEW first ' + neu.first + ' ms, warm ' + neu.warm + ' ms  [' + neu.timing + ']');
}
fs.rmSync(tmp, { recursive: true, force: true });
