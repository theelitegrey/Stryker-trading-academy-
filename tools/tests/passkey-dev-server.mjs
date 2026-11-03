// Local server for the passkey browser test: static files + /api/passkey/* (real handler, in-memory KV, DEV=1)
// + /__test/idtoken (a fake Firebase ID token signed with a throwaway key; the handler's JWKS fetch is stubbed).
// Google's token endpoint and accounts:lookup are stubbed too, so the custom-token step is the real signing code
// with a throwaway service-account key. Run: node tools/tests/passkey-dev-server.mjs [port]
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import path from 'node:path';
import { handle } from '../../functions/api/passkey/[[path]].js';
import { b64u } from '../../functions/api/passkey/_webauthn.js';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname), PORT = Number(process.argv[2] || 8044);
const mem = new Map();
const KV = { get: async (k) => mem.get(k) ?? null, put: async (k, v) => { mem.set(k, v); }, delete: async (k) => { mem.delete(k); } };
const rsa = () => crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const idk = await rsa(), sak = await rsa();
const idjwk = { ...(await crypto.subtle.exportKey('jwk', idk.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const pem = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', sak.privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----\n';
const env = { PASSKEYS: KV, DEV: '1', FIREBASE_SA_KEY: JSON.stringify({ client_email: 'sa@test.iam.gserviceaccount.com', private_key: pem }) };
const fetchImpl = async (u, init) => {
  u = String(u);
  if (u.includes('securetoken@system')) return new Response(JSON.stringify({ keys: [idjwk] }), { headers: { 'cache-control': 'max-age=3600' } });
  if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'x' }));
  if (u.includes('accounts:lookup')) return new Response(JSON.stringify({ users: [{ localId: JSON.parse(init.body).localId[0] }] }));
  throw new Error('unexpected fetch');
};
async function idToken(uid, ago) {
  const now = Math.floor(Date.now() / 1000), h = b64u(Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })));
  const p = b64u(Buffer.from(JSON.stringify({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now, exp: now + 3600, auth_time: now - ago })));
  return h + '.' + p + '.' + b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', idk.privateKey, Buffer.from(h + '.' + p)));
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:' + PORT);
    if (url.pathname.startsWith('/api/passkey')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env, { fetchImpl });
      res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(Buffer.from(await r.arrayBuffer()));
    }
    if (url.pathname === '/__test/idtoken') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(await idToken(url.searchParams.get('uid'), Number(url.searchParams.get('ago') || 0))); }
    let f = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f));
  } catch (e) { res.writeHead(500); res.end('err'); }
}).listen(PORT, '127.0.0.1', () => console.log('listening ' + PORT));
