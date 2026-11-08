// Levels for other platforms: pack maths, formats, secret links, Pro gate. node workers/book-recorder/test/levels-feed.test.mjs
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { zoInit } from '../src/zoro.js';
import { lvSnapshot, etDay, buildPack, packCsv, packTv, packTos, packJson, packPrices, lvParams, lvRoute, lvInit, lvTokPut, lvTokGet, lvTokInfo, lvTokDel, lvTokTouch, lvTokUsed,
  newSecret, sha256Hex, TOKEN_RE, lvProUntil, LV_DP_MIN } from '../src/levels-feed.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
const FX = (f) => JSON.parse(readFileSync(new URL('../../../tools/fixtures/zoro/' + f, import.meta.url)));
const s = FX('summary.json');   // the feeder's own SPX sample (real shape)
const slim = (j) => ({ u: j.u, built: j.built, day: j.day, spot: j.spot, levels: j.levels, ranges: j.ranges, nodes: j.nodes.slice(0, 12), fut: j.fut });
const T = 1794000000000;
const spy = Object.assign(slim(s), { u: 'SPY', spot: 740, built: s.built + 60 });
const snap = {
  at: 1, sums: { SPX: slim(s), SPY: spy },
  dp: { SPY: { t: 1, day: '2026-11-06', rows: [[T, 741.5, 40000], [T + 1, 741.5, 40000], [T + 2, 738, 100000], [T + 3, 739, 1000]] } }   // $29.7M twice at 741.5, $73.8M at 738, $0.7M (below the cut)
};
// the Worker keeps only prints >= $25M; the snapshot builder does that, so give buildPack the filtered rows as lvSnapshot would
snap.dp.SPY.rows = snap.dp.SPY.rows.filter((r) => r[1] * r[2] >= LV_DP_MIN);

// ---- snapshot from stored data (real tables, in memory)
{
  const d2 = new DatabaseSync(':memory:');
  const q2 = { exec(q, ...a) { const st = d2.prepare(q); const rows = /^\s*SELECT/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows }; } };
  zoInit(q2); q2.exec('CREATE TABLE IF NOT EXISTS scan (part TEXT PRIMARY KEY, t INTEGER NOT NULL, gz BLOB NOT NULL) WITHOUT ROWID');
  q2.exec('INSERT INTO zo (route, u, sub, t, gz) VALUES (?, ?, ?, ?, ?)', 'summary', 'SPX', '', s.built, new Uint8Array(gzipSync(JSON.stringify(s))));
  const day = etDay(T);
  const dp = { v: 1, t: 1794000000, sym: 'SPY', min: 1e6, days: ['2000-01-01', day], cols: ['t', 'p', 's', 'c'], rows: [[T, 741.5, 40000, ''], [T + 1, 741.5, 40000, 'B'], [T + 2, 600, 100, ''], [T - 5 * 864e5, 741.5, 99999, '']] };
  q2.exec('INSERT INTO scan (part, t, gz) VALUES (?, ?, ?)', 'dp_spy', 1, new Uint8Array(gzipSync(JSON.stringify(dp))));
  const sn = await lvSnapshot(q2, T);
  ok(sn.sums.SPX && sn.sums.SPX.levels.call_ceiling === 7450 && !sn.sums.SPY, 'snapshot: the stored summary, a missing one stays missing');
  ok(sn.dp.SPY.rows.length === 1 && sn.dp.SPY.rows[0][1] === 741.5, 'snapshot: only the last session, >= $25M, market-price prints (average-price print and old day dropped)');
  ok(!('dex' in sn.sums.SPX) && !('iv' in sn.sums.SPX), 'snapshot keeps only the small slice it needs');
}

// ---- params
ok(lvParams(new URLSearchParams('u=es&inc=gex,dp')).u === 'ES', 'params: symbol upper-cased');
ok(lvParams(new URLSearchParams('u=AAPL')).error, 'params: bad symbol refused');
ok(lvParams(new URLSearchParams('inc=gex,evil')).error, 'params: bad include refused');
ok(lvParams(new URLSearchParams('')).inc.length === 4, 'params: default = everything');

// ---- pack
let p = buildPack(snap, 'SPX', ['gex']);
ok(p.rows.length === 4 && p.rows[0].label === 'Call Ceiling' && p.rows[0].price === 7450, 'SPX gex rows: ' + p.rows.map((r) => r.price).join(','));
ok(p.rows.find((r) => r.type === 'flip_line').price === 7514.56, 'flip line value');
p = buildPack(snap, 'SPX', ['em']);
ok(p.rows.length === 4 && p.rows[0].price === 7453.07 && p.rows[1].price === 7355.87, 'range rows (0DTE high/low, weekly high/low)');
p = buildPack(snap, 'SPX', ['nodes']);
ok(p.rows.length === 5 && p.rows[0].type === 'zoro_level' && p.rows[0].value >= p.rows[1].value, 'five Zoro Levels, biggest share first');
p = buildPack(snap, 'SPX', ['dp']);
ok(p.rows.length === 2 && p.rows.every((r) => r.type === 'dark_pool'), 'dark pool: two price levels (sub-$25M print dropped)');
const sc = 7404.47 / 740;
ok(Math.abs(p.rows[0].price - 741.5 * sc) < 0.01 || Math.abs(p.rows[1].price - 741.5 * sc) < 0.01, 'dark pool moved from SPY to SPX scale by spot ratio');
ok(p.rows.find((r) => r.price > 7400 && r.value === 59) || p.rows.some((r) => r.value === 59), 'same-price prints add up ($29.7M + $29.7M = $59M)');
ok(p.notes.some((t) => /SPY/.test(t)), 'note says the prints were moved');
p = buildPack(snap, 'SPY', ['dp']);
ok(p.rows.length === 2 && p.rows.some((r) => r.price === 741.5), 'SPY dark pool at its own prices, no scaling');
p = buildPack(snap, 'ES', ['gex']);
ok(p.rows[0].price === 7486.25 && p.notes.some((t) => /mapped/.test(t)), 'ES = the summary\'s own mapped futures levels');
ok(buildPack(snap, 'ES', ['dp']).rows.length === 0 || buildPack(snap, 'ES', ['dp']).notes.length > 0, 'ES dark pool: only with a same-time price pair, else left out with a note');
ok(buildPack(snap, 'NQ', ['gex']).error === 'no data', 'NQ with no stored QQQ summary -> no data (nothing invented)');
ok(buildPack({ sums: {}, dp: {} }, 'SPX', []).error === 'no data', 'empty snapshot -> no data');
const noRange = JSON.parse(JSON.stringify(snap)); noRange.sums.SPX.ranges = { w: [1, 2] };
ok(buildPack(noRange, 'SPX', ['em']).rows.length === 2, 'missing 0DTE range stays missing (teaser-like data)');

// ---- formats
p = buildPack(snap, 'SPX', ['gex', 'em']);
const csv = packCsv(p).split('\n');
ok(csv[0] === 'symbol,type,label,price,value,day,updated' && csv[1].startsWith('SPX,call_ceiling,Call Ceiling,7450,,2026-11-06,'), 'csv header + first row: ' + csv[1]);
ok(csv.some((l) => /^# Education only/.test(l)) && !/live|real-time|delayed/i.test(packCsv(p)), 'csv carries the notice, no banned words');
ok(packPrices(p).split('\n')[1] === '7450,Call Ceiling,#ef4444', 'price list: price,label,colour');
const tv = packTv(p);
ok(tv.startsWith('ZL1|SPX|2026-11-06|') && tv.includes(';Call Ceiling=7450;') && !/\n/.test(tv), 'tradingview text is one line: ' + tv.slice(0, 80));
const tos = packTos(p);
ok(/plot L1 = 7450;/.test(tos) && /SetDefaultColor\(Color\.RED\)/.test(tos) && /Education only/.test(tos), 'thinkScript plots the values');
ok(!/[;=]/.test(p.rows.map((r) => r.label).join('')), 'labels never hold the separators');
const js = JSON.parse(packJson(p));
ok(js.levels.length === 8 && js.notice && js.symbol === 'SPX', 'json shape');

// ---- secrets
const sec = newSecret();
ok(TOKEN_RE.test(sec) && sec !== newSecret(), 'secret is 43 url-safe chars and unique');
ok((await sha256Hex('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256 correct');
const db = new DatabaseSync(':memory:');
const sql = { exec(q, ...a) { const st = db.prepare(q); const rows = /^\s*SELECT/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows }; } };
lvInit(sql);
lvTokPut(sql, 'h1', 'u1', 5000, 1000); lvTokPut(sql, 'h2', 'u1', 6000, 2000);
ok(!lvTokGet(sql, 'h1') && lvTokGet(sql, 'h2').uid === 'u1', 'a new link replaces the old one at once');
lvTokUsed(sql, 'h2', 9000); ok(lvTokInfo(sql, 'u1').last === 9000, 'last used is recorded');
lvTokTouch(sql, 'u1', 7777); ok(lvTokInfo(sql, 'u1').exp === 7777, 'expiry extends while Pro');
lvTokDel(sql, 'u1'); ok(!lvTokGet(sql, 'h2'), 'revoked link is gone');

// ---- Pro check (fake Firestore)
const R = (over) => Object.assign({ verifyIdToken: async (t) => (t === 'good' ? 'uid1' : null), isAdminToken: async () => false, RT_PROJECT: 'p',
  isActiveProDoc: (f) => f.plan.stringValue === 'pro', paidPlanNames: async () => new Set(['pro']) }, over || {});
const fsRes = (fields, status = 200) => async () => ({ status, json: async () => ({ fields }) });
const NOW = 1.8e12;
ok(!(await lvProUntil('bad', R(), fsRes({}), NOW)), 'bad token -> no');
ok(!(await lvProUntil('good', R(), fsRes({ plan: { stringValue: 'free' } }), NOW)), 'free member -> no');
ok(!(await lvProUntil('good', R(), fsRes({}, 403), NOW)), 'Firestore refuses -> no (fail closed)');
let w = await lvProUntil('good', R(), fsRes({ plan: { stringValue: 'pro' }, paidThroughMillis: { integerValue: String(NOW + 5 * 864e5) } }), NOW);
ok(w && w.uid === 'uid1' && w.exp === NOW + 8 * 864e5, 'Pro: link lasts to paid-through + 3 days grace');
w = await lvProUntil('good', R(), fsRes({ plan: { stringValue: 'pro' } }), NOW);
ok(w && w.exp === NOW + 30 * 864e5, 'Pro with no end date: 30 days, then needs a visit');
ok((await lvProUntil('good', R({ isAdminToken: async () => true }), fsRes({}, 500), NOW)).exp === NOW + 30 * 864e5, 'admin passes');

// ---- route (fake Durable Object + cache + rate limit)
const doDb = new DatabaseSync(':memory:');
const dsql = { exec(q, ...a) { const st = doDb.prepare(q); const rows = /^\s*SELECT/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows }; } };
lvInit(dsql);
const stub = () => ({ fetch: async (url) => {
  const u = new URL(url), q = u.searchParams, J = (x) => new Response(JSON.stringify(x));
  switch (u.pathname) {
    case '/lv-snap': return J(snap);
    case '/lv-tok-get': return J(lvTokGet(dsql, q.get('h')));
    case '/lv-tok-used': lvTokUsed(dsql, q.get('h'), Date.now()); return new Response('ok');
    case '/lv-tok-info': return J(lvTokInfo(dsql, q.get('uid')));
    case '/lv-tok-touch': lvTokTouch(dsql, q.get('uid'), Number(q.get('exp'))); return new Response('ok');
    case '/lv-tok-del': lvTokDel(dsql, q.get('uid')); return new Response('ok');
    case '/lv-tok-put': lvTokPut(dsql, q.get('h'), q.get('uid'), Number(q.get('exp')), Date.now()); return new Response('ok');
  } return new Response('?', { status: 404 }); } });
const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
let allow = true; const env = { RL_LV: { limit: async () => ({ success: allow }) } };
const ctx = { waitUntil: (p) => p };
let proUntil = async (t) => (t === 'good' ? { uid: 'uid1', exp: Date.now() + 864e5 } : null);
const deps = { stub, bearer: (r) => (/^Bearer (\S+)$/.exec(r.headers.get('authorization') || '') || [])[1] || '', now: () => Date.now(), proUntil: (t) => proUntil(t) };
const call = (path, init) => lvRoute(new Request('https://w.dev' + path, init), new URL('https://w.dev' + path), env, ctx, {}, deps);
const auth = { headers: { authorization: 'Bearer good' } };

let r = await call('/lv/pack?u=SPX&format=csv'); ok(r.status === 403, 'pack without sign-in -> 403');
r = await call('/lv/pack?u=SPX&format=csv', { headers: { authorization: 'Bearer nope' } }); ok(r.status === 403, 'pack with a free/unknown token -> 403');
r = await call('/lv/token'); ok(r.status === 403, 'token status without sign-in -> 403');
r = await call('/lv/token', { method: 'POST' }); ok(r.status === 403, 'making a link without sign-in -> 403');
r = await call('/lv/pack?u=SPX&inc=gex&format=csv', auth); let t = await r.text();
ok(r.status === 200 && /text\/csv/.test(r.headers.get('content-type')) && r.headers.get('cache-control') === 'private, no-store' && t.includes('Call Ceiling'), 'Pro: pack csv, private no-store');
r = await call('/lv/pack?u=SPX&format=xml', auth); ok(r.status === 400, 'bad format -> 400');
r = await call('/lv/pack?u=ZZZ&format=csv', auth); ok(r.status === 400, 'bad symbol -> 400');
r = await call('/lv/pack?u=NQ&format=csv', auth); ok(r.status === 404, 'no data -> 404');
r = await call('/lv/token', auth); ok((await r.json()).active === false, 'no link yet');
r = await call('/lv/token', Object.assign({ method: 'POST' }, auth)); let j = await r.json();
ok(r.status === 200 && TOKEN_RE.test(j.secret) && j.exp > Date.now(), 'POST makes a link');
const secret = j.secret;
ok(!JSON.stringify(dsql.exec('SELECT * FROM lvtok').toArray()).includes(secret), 'the secret itself is never stored (hash only)');
r = await call('/lv/feed/' + secret + '.csv?u=SPX&inc=gex'); t = await r.text();
ok(r.status === 200 && t.startsWith('symbol,type,label,price') && r.headers.get('cache-control') === 'private, no-store' && r.headers.get('x-robots-tag') === 'noindex', 'the link serves csv with no sign-in');
r = await call('/lv/feed/' + secret + '.tv?u=SPX'); ok((await r.text()).startsWith('ZL1|SPX|'), 'link serves the TradingView text');
r = await call('/lv/feed/' + secret + '.exe?u=SPX'); ok(r.status === 404, 'unknown extension -> 404');
r = await call('/lv/feed/' + 'x'.repeat(43) + '.csv'); const bad = await r.json(); ok(r.status === 404 && bad.error === 'link not active', 'unknown secret -> 404');
r = await call('/lv/feed/short.csv'); ok(r.status === 404, 'malformed secret -> 404');
r = await call('/lv/feed/' + secret + '.csv', { method: 'POST' }); ok(r.status === 405, 'link is GET only');
allow = false; r = await call('/lv/feed/' + secret + '.csv?u=SPX'); ok(r.status === 429 && r.headers.get('retry-after') === '60', 'link is rate limited'); allow = true;
r = await call('/lv/token', auth); j = await r.json(); ok(j.active === true && j.exp > Date.now() && !('secret' in j), 'status says active, never returns the secret again');
r = await call('/lv/token', Object.assign({ method: 'POST' }, auth)); const j2 = await r.json();
r = await call('/lv/feed/' + secret + '.csv'); ok(r.status === 404, 'making a new link kills the old one at once');
r = await call('/lv/feed/' + j2.secret + '.csv'); ok(r.status === 200, 'the new link works');
proUntil = async () => null;   // plan lapsed: the member can no longer manage it, but the stored expiry still decides the link
r = await call('/lv/token', auth); ok(r.status === 403, 'lapsed member cannot read or make links');
proUntil = async (t) => (t === 'good' ? { uid: 'uid1', exp: Date.now() + 864e5 } : null);
r = await call('/lv/token', Object.assign({ method: 'DELETE' }, auth)); ok((await r.json()).active === false, 'DELETE turns the link off');
r = await call('/lv/feed/' + j2.secret + '.csv'); ok(r.status === 404, 'revoked link returns nothing');
dsql.exec('INSERT INTO lvtok (h, uid, exp, made, last) VALUES (?, ?, ?, ?, 0)', await sha256Hex('E'.repeat(43)), 'u9', Date.now() - 1000, 1);
r = await call('/lv/feed/' + 'E'.repeat(43) + '.csv'); ok(r.status === 404, 'expired link returns nothing');
r = await call('/lv/other', auth); ok(r.status === 404, 'unknown route -> 404');
console.log('ALL PASS ' + n);
