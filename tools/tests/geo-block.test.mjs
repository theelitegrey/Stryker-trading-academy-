// Sanctions geo-block tests (Owner order 09 Nov 2026). No network.
//   node tools/tests/geo-block.test.mjs
// Proves: every blocked country and Ukraine region is blocked in both code forms; UA elsewhere, US, IN, GB allowed;
// all five copies of the list agree; the Pages middleware returns 451 (HTML page, JSON on /api) for a faked
// request.cf, lets the block page / robots / favicon through, leaves allowed visitors (and crawlers from allowed
// countries) alone and keeps the legacy 301; both Workers answer 451 {error:"unavailable_region"} before any route,
// including a websocket upgrade.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('PASS', name); };

const G = await import(path.join(root, 'functions/_geo-block.js'));
const C = require(path.join(root, 'functions-src/geoBlock.js'));
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'assets/geo-block-list.js'), 'utf8'), ctx);
const B = ctx.window.TZGeoBlock;

await t('blocked countries: CU IR KP SY RU BY (any case)', () => {
  for (const c of ['CU', 'IR', 'KP', 'SY', 'RU', 'BY', 'ru', ' by ']) {
    assert.ok(G.isBlockedPlace(c), c); assert.ok(C.isBlockedPlace(c), c); assert.ok(B.isBlockedResidence(c), c);
  }
});
await t('blocked UA regions in Cloudflare form (43 40 14 09) and ISO form (UA-43 ...), plus unpadded 9', () => {
  for (const r of ['43', '40', '14', '09', 'UA-43', 'UA-40', 'UA-14', 'UA-09', 'ua-09', '9']) {
    assert.ok(G.isBlockedPlace('UA', r), r); assert.ok(C.isBlockedPlace('UA', r), r);
  }
  for (const r of ['UA-43', 'UA-40', 'UA-14', 'UA-09']) { assert.ok(B.isBlockedResidence(r), r); assert.ok(C.isBlockedResidence(r), r); }
});
await t('UA region name fallback when the code is missing', () => {
  assert.ok(G.isBlockedPlace('UA', '', 'Crimea')); assert.ok(G.isBlockedPlace('UA', '', 'Luhansk'));
  assert.ok(!G.isBlockedPlace('UA', '', 'Kyiv City'));
});
await t('allowed: UA outside those regions, US, IN, GB, unknown/empty', () => {
  for (const [c, r] of [['UA', '30'], ['UA', 'UA-30'], ['UA', '46'], ['UA', '51'], ['UA', ''], ['US', 'CA'], ['IN', 'MH'], ['GB', 'ENG'], ['', ''], ['XX', '']]) {
    assert.ok(!G.isBlockedPlace(c, r), c + r); assert.ok(!C.isBlockedPlace(c, r), c + r);
  }
  for (const c of ['UA', 'UA-30', 'US', 'IN', 'GB', '']) { assert.ok(!B.isBlockedResidence(c), c); assert.ok(!C.isBlockedResidence(c), c); }
  // a region code that is blocked in UA is NOT blocked in another country
  assert.ok(!G.isBlockedPlace('US', '43')); assert.ok(!G.isBlockedPlace('IN', '09'));
});
await t('all copies carry the same lists (no drift)', () => {
  const want = JSON.stringify([G.BLOCKED_COUNTRIES, G.BLOCKED_UA_REGIONS]);
  assert.equal(JSON.stringify([C.BLOCKED_COUNTRIES, C.BLOCKED_UA_REGIONS]), want);
  assert.equal(JSON.stringify([Array.from(B.BLOCKED_COUNTRIES), Array.from(B.BLOCKED_UA_REGIONS)]), want);
  const canon = fs.readFileSync(path.join(root, 'functions/_geo-block.js'), 'utf8');
  for (const w of ['book-recorder', 'discord-roles']) assert.equal(fs.readFileSync(path.join(root, 'workers', w, 'src/geo-block.js'), 'utf8'), canon, w);
  assert.equal(C.REGION_MESSAGE, G.REGION_MESSAGE); assert.equal(B.REGION_MESSAGE, G.REGION_MESSAGE);
});
await t('country picker: ~250 places, blocked ones flagged, US/IN/GB/UA selectable', () => {
  const o = B.options();
  assert.ok(o.length > 240, String(o.length));
  const blocked = o.filter((x) => x.blocked).map((x) => x.code).sort();
  assert.equal(JSON.stringify(blocked), JSON.stringify(['BY', 'CU', 'IR', 'KP', 'RU', 'SY', 'UA-09', 'UA-14', 'UA-40', 'UA-43']));
  for (const c of ['US', 'IN', 'GB', 'UA']) assert.ok(o.find((x) => x.code === c && !x.blocked), c);
});
await t('Stripe address check: country, and UA oblast in state/city', () => {
  assert.ok(C.isBlockedAddress({ country: 'RU', city: 'Moscow' }));
  assert.ok(C.isBlockedAddress({ country: 'UA', state: 'Crimea' }));
  assert.ok(C.isBlockedAddress({ country: 'UA', state: 'UA-14' }));
  assert.ok(C.isBlockedAddress({ country: 'UA', state: '', city: 'Sevastopol' }));
  assert.ok(!C.isBlockedAddress({ country: 'UA', state: 'Kyiv', city: 'Kyiv' }));
  assert.ok(!C.isBlockedAddress({ country: 'US', state: 'NY' }));
  assert.ok(!C.isBlockedAddress(null));
  assert.ok(C.isBlockedStudent({ residenceCountry: 'IR' })); assert.ok(C.isBlockedStudent({ sanctionsLocked: true }));
  assert.ok(!C.isBlockedStudent({ residenceCountry: 'IN' })); assert.ok(!C.isBlockedStudent({}));
});

// ---------- Pages middleware with a faked request.cf ----------
const mw = await import(path.join(root, 'functions/_middleware.js'));
const page = fs.readFileSync(path.join(root, 'unavailable.html'), 'utf8');
const env = { ASSETS: { fetch: async (r) => (new URL(r.url).pathname === '/unavailable.html' ? new Response(page) : new Response('x', { status: 404 })) } };
function req(url, cf, init) { const r = new Request(url, init); Object.defineProperty(r, 'cf', { value: cf }); return r; }
const next = () => new Response('NEXT');
const run = (url, cf, init) => mw.onRequest({ request: req(url, cf, init), next, env });

await t('middleware: blocked country gets 451 + the block page on pages and static files', async () => {
  for (const p of ['/', '/charts', '/login.html', '/assets/style.css?v=929', '/assets/images/og/share/signup.png', '/manifest.json', '/__/auth/handler']) {
    const r = await run('https://tradezoro.com' + p, { country: 'IR' });
    assert.equal(r.status, 451, p);
    const body = await r.text();
    assert.match(body, /TradeZoro isn't available in your region\. Due to US regulations, we can't offer our services in this location\./, p);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
  }
});
await t('middleware: blocked UA region (Cloudflare code) gets 451; Kyiv passes', async () => {
  for (const rc of ['43', '40', '14', '09']) assert.equal((await run('https://tradezoro.com/', { country: 'UA', regionCode: rc })).status, 451, rc);
  assert.equal(await (await run('https://tradezoro.com/', { country: 'UA', regionCode: '30' })).text(), 'NEXT');
});
await t('middleware: /api and websocket upgrades get JSON 451 unavailable_region', async () => {
  const r = await run('https://tradezoro.com/api/gex/ladder', { country: 'RU' });
  assert.equal(r.status, 451); assert.equal((await r.json()).error, 'unavailable_region');
  const w = await run('https://tradezoro.com/api/chart/stream/BTC', { country: 'KP' }, { headers: { upgrade: 'websocket' } });
  assert.equal(w.status, 451); assert.equal((await w.json()).error, 'unavailable_region');
});
await t('middleware: block page, robots.txt, favicon pass for blocked visitors', async () => {
  for (const p of ['/unavailable', '/unavailable.html', '/robots.txt', '/favicon.ico', '/assets/images/favicon-32.png', '/assets/version-check.js', '/assets/version.json']) {
    assert.equal(await (await run('https://tradezoro.com' + p, { country: 'SY' })).text(), 'NEXT', p);
  }
});
await t('middleware: cf-ipcountry header fallback when request.cf is absent', async () => {
  const r = await mw.onRequest({ request: new Request('https://tradezoro.com/', { headers: { 'cf-ipcountry': 'CU' } }), next, env });
  assert.equal(r.status, 451);
});
await t('middleware: allowed countries untouched; crawlers judged by country only', async () => {
  for (const c of ['US', 'IN', 'GB', 'DE', undefined]) assert.equal(await (await run('https://tradezoro.com/charts', c ? { country: c } : undefined)).text(), 'NEXT', String(c));
  const bot = { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } };
  assert.equal(await (await run('https://tradezoro.com/', { country: 'US' }, bot)).text(), 'NEXT');
  assert.equal((await run('https://tradezoro.com/', { country: 'BY' }, bot)).status, 451);
});
await t('middleware: legacy 301 kept for pages, not for static files; HEAD gets 451 with no body', async () => {
  const r = await run('https://strykertrading.com/login?x=1', { country: 'US' });
  assert.equal(r.status, 301); assert.equal(r.headers.get('location'), 'https://tradezoro.com/login?x=1');
  assert.equal(await (await run('https://strykertrading.com/assets/style.css', { country: 'US' })).text(), 'NEXT');
  const h = await run('https://tradezoro.com/', { country: 'RU' }, { method: 'HEAD' });
  assert.equal(h.status, 451); assert.equal(await h.text(), '');
});
await t('middleware: inline fallback page if ASSETS fails', async () => {
  const r = await mw.onRequest({ request: req('https://tradezoro.com/', { country: 'IR' }), next, env: {} });
  assert.equal(r.status, 451); assert.match(await r.text(), /Due to US regulations/);
});
await t('_routes.json: every path goes through the middleware (no excludes)', () => {
  const rj = JSON.parse(fs.readFileSync(path.join(root, '_routes.json'), 'utf8'));
  assert.deepEqual(rj.include, ['/*']); assert.deepEqual(rj.exclude, []);
});
await t('block page: noindex, exact text, inline styles only, light + dark tokens', () => {
  assert.match(page, /name="robots" content="noindex/);
  assert.ok(!/<link rel="stylesheet"/.test(page));
  assert.match(page, /data-theme="light"/); assert.match(page, /prefers-color-scheme: light/);
});

// ---------- Workers: the check sits first in fetch ----------
for (const w of ['book-recorder', 'discord-roles']) {
  await t('worker ' + w + ': imports geo-block and checks it first in the default fetch', () => {
    const src = fs.readFileSync(path.join(root, 'workers', w, 'src/index.js'), 'utf8');
    assert.match(src, /import \{ isBlockedRequest, blockedJson \} from '\.\/geo-block\.js';/);
    const i = src.indexOf('export default {'); const body = src.slice(i, i + 600);
    const f = body.indexOf('async fetch(req, env, ctx) {'); const g = body.indexOf('if (isBlockedRequest(req)) return blockedJson(cors(req));');
    assert.ok(f > 0 && g > f, 'geo check must be the first statement of fetch');
    assert.ok(!/route\(|stub|handleInteraction/.test(body.slice(f, g)), 'nothing runs before the geo check');
  });
}
await t('worker blockedJson: 451 JSON {error:"unavailable_region"} with the CORS headers passed in', async () => {
  const W = await import(path.join(root, 'workers/book-recorder/src/geo-block.js'));
  const r = W.blockedJson({ 'access-control-allow-origin': 'https://tradezoro.com' });
  assert.equal(r.status, 451); assert.equal((await r.json()).error, 'unavailable_region');
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://tradezoro.com');
  assert.ok(W.isBlockedRequest(req('https://x/ts-live', { country: 'UA', regionCode: '14' }, { headers: { upgrade: 'websocket' } })));
  assert.ok(!W.isBlockedRequest(req('https://x/ts-live', { country: 'US' })));
});

console.log(n + ' passed');
