// Unit + proxy checks for the Google sign-in custom authDomain (build-time only;
// tools/ is not deployed).
//   node tools/tests/auth-domain.test.mjs          unit tests only
//   node tools/tests/auth-domain.test.mjs --net    also hits firebaseapp.com through the proxy
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = fs.readFileSync(path.join(root, 'assets/auth.js'), 'utf8');

// Evaluate only the authDomain block (top of auth.js, before firebaseConfig).
const block = src.slice(0, src.indexOf('const firebaseConfig'));
function load(store) {
  const ctx = { window: { localStorage: store } };
  vm.createContext(ctx);
  vm.runInContext(block + '\n;this.__p = pickAuthDomain; this.__r = readAuthDomainOverride; this.__f = USE_SITE_AUTH_DOMAIN;', ctx);
  return ctx;
}
const DEF = 'strykertrades-e0cd8.firebaseapp.com';
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

const c = load({ getItem: () => null });
t('flag ships OFF', () => assert.equal(c.__f, false));
t('tradezoro, flag off, no override -> default', () => assert.equal(c.__p('tradezoro.com', false, null), DEF));
t('tradezoro, override 1 -> tradezoro.com', () => assert.equal(c.__p('tradezoro.com', false, '1'), 'tradezoro.com'));
t('tradezoro, override 0 -> default', () => assert.equal(c.__p('tradezoro.com', false, '0'), DEF));
t('tradezoro, flag on -> tradezoro.com', () => assert.equal(c.__p('tradezoro.com', true, null), 'tradezoro.com'));
for (const h of ['localhost', '127.0.0.1', 'strykertrading.com', 'www.tradezoro.com', 'x.pages.dev', 'evil-tradezoro.com']) {
  t(h + ' flag on + override -> default', () => assert.equal(c.__p(h, true, '1'), DEF));
}
t('override read from localStorage', () => assert.equal(load({ getItem: (k) => (k === 'stk_auth_domain' ? '1' : null) }).__r(), '1'));
t('localStorage throwing -> null (fail safe)', () => assert.equal(load({ getItem: () => { throw new Error('blocked'); } }).__r(), null));
t('firebaseConfig uses pickAuthDomain', () => assert.match(src, /authDomain:\s*pickAuthDomain\(window\.location\.hostname, USE_SITE_AUTH_DOMAIN, readAuthDomainOverride\(\)\)/));
t('apiKey unchanged (session storage key firebase:authUser:<apiKey>:[DEFAULT])', () => assert.match(src, /apiKey: "AIzaSyC8nqRVQ7wpuplYygZObKgNx2ojj5ZwbSQ"/));

const mw = await import(path.join(root, 'functions/_middleware.js'));
const ap = await import(path.join(root, 'functions/_auth-proxy.js'));
t('paths matched', () => {
  for (const p of ['/__/auth/handler', '/__/auth/iframe', '/__/firebase/init.json']) assert.ok(ap.isAuthProxyPath(p), p);
  for (const p of ['/', '/__/', '/__auth/handler', '/login', '/api/gex/ladder', '/__/authx']) assert.ok(!ap.isAuthProxyPath(p), p);
});
// Legacy redirect still works for normal pages, and /__/ paths are proxied before it.
{
  const r = await mw.onRequest({ request: new Request('https://strykertrading.com/login?x=1'), next: () => new Response('next') });
  t('legacy host still 301s', () => { assert.equal(r.status, 301); assert.equal(r.headers.get('location'), 'https://tradezoro.com/login?x=1'); });
  const r2 = await mw.onRequest({ request: new Request('https://tradezoro.com/login'), next: () => new Response('next') });
  const r2t = await r2.text();
  t('tradezoro page -> next()', () => assert.equal(r2t, 'next'));
}

if (process.argv.includes('--net')) {
  for (const p of ['/__/auth/handler', '/__/auth/iframe', '/__/firebase/init.json', '/__/auth/handler.js', '/__/auth/iframe.js', '/__/auth/experiments.js']) {
    for (const host of ['tradezoro.com', 'strykertrading.com']) {
      const viaProxy = await mw.onRequest({ request: new Request('https://' + host + p + '?apiKey=x&appName=%5BDEFAULT%5D', { headers: { 'user-agent': 'auth-test' } }), next: () => new Response('WRONG') });
      const direct = await fetch(ap.FIREBASE_AUTH_ORIGIN + p + '?apiKey=x&appName=%5BDEFAULT%5D', { headers: { 'user-agent': 'auth-test' } });
      const [a, b] = [await viaProxy.text(), await direct.text()];
      t(`${host}${p} status ${viaProxy.status} == upstream ${direct.status}, same body (${a.length} B), no-store`, () => {
        assert.equal(viaProxy.status, direct.status);
        if (!p.startsWith('/__/firebase/')) assert.equal(viaProxy.status, 200);
        assert.equal(a, b); assert.equal(viaProxy.headers.get('cache-control'), 'no-store');
      });
    }
  }
  // POST passes through (method + body).
  const post = await ap.proxyAuth(new Request('https://tradezoro.com/__/auth/handler', { method: 'POST', body: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
  const postD = await fetch(ap.FIREBASE_AUTH_ORIGIN + '/__/auth/handler', { method: 'POST', body: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  t(`POST passes through (status ${post.status} == ${postD.status})`, () => assert.equal(post.status, postD.status));
}
console.log(`\n${n} checks passed`);
