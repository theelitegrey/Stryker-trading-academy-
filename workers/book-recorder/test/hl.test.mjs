// Hyperliquid wallet intel (src/hl.js): validation, merging, query rules, and the full round trip
// feeder payload -> /hl-ingest -> Durable Object -> /hl-* reads on a real BookRecorder (node:sqlite).
// Fixtures are trimmed REAL payloads from a live dry run of hl-feeder/hl_feeder.py (2026-11-07).
//   node workers/book-recorder/test/hl.test.mjs
// With --write-fixtures DIR it also writes the /hl-* responses S2 builds against.
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { validateMinute, validateState, validateLabels, mergeCoin, packCoin, candleQuery, hlPlan, shortId, levelBody, hlKeepFor, hlGuard, HL_KEEP_MS, HL_KEEP_SHORT_MS } from '../src/hl.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS ' + m); };
const fx = (f) => JSON.parse(readFileSync(new URL('./fixtures/' + f, import.meta.url)));
const MINS = fx('hl-minutes.json'), STATE = fx('hl-state.json'), LABELS = fx('hl-labels.json');
const T0 = MINS[0].t, NOW = MINS[MINS.length - 1].t + 70000;
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- validation
ok(validateMinute(MINS[0], NOW) === '', 'real minute payload valid');
ok(validateMinute(Object.assign(clone(MINS[0]), { t: T0 + 1 }), NOW) === 'bad header', 'minute t must be whole minutes');
ok(validateMinute(MINS[0], T0 + 8 * 86400000) === 'stale or future t', 'minute older than 7 days rejected');
ok(validateMinute(Object.assign(clone(MINS[0]), { w: ['0xnope'] }), NOW) === 'bad wallets', 'bad address rejected');
{ const m = clone(MINS[0]); m.c.BTC.r[0][0] = m.w.length; ok(/bad rows/.test(validateMinute(m, NOW)), 'wallet index out of range rejected'); }
{ const m = clone(MINS[0]); m.c.BTC.r[0][2] = -1; ok(/bad rows/.test(validateMinute(m, NOW)), 'negative size rejected'); }
{ const m = clone(MINS[0]); m.c['BTC<script>'] = m.c.BTC; ok(validateMinute(m, NOW) === 'bad coin', 'odd coin name rejected'); }
ok(validateState(STATE, STATE.t + 60000) === '', 'real state payload valid');
ok(validateState(STATE, STATE.t + 31 * 60000) === 'stale or bad header', 'state older than 30 min rejected');
{ const s = clone(STATE); s.coins.BTC.liq[0].w[0].a = 'x'; ok(/bad buckets/.test(validateState(s, STATE.t)), 'bucket wallet address checked'); }
ok(validateLabels(LABELS, LABELS.t + 1000) === '', 'real labels valid');
{ const l = clone(LABELS); Object.values(l.labels)[0].tags = ['famous fund']; ok(validateLabels(l, LABELS.t) === 'bad tags', 'only our three tags allowed'); }

// ---- merging: buys = sells = notional for every coin-minute (each fill has a buyer and a seller)
{
  const m = MINS[1], x = m.c.BTC, acc = new Map(), tot = [0, 0, 0, 0, 0];
  mergeCoin(acc, tot, m.w, x);
  let b = 0, s = 0;
  for (const v of acc.values()) { b += v[1]; s += v[3]; }
  // the feeder kept the top 100 wallets + "others", so the identity holds on the totals
  ok(Math.abs(b - tot[2]) < 1e-6 * tot[2] + 1e-6 && Math.abs(s - tot[2]) < 1e-6 * tot[2] + 1e-6, 'buy notional = sell notional = candle notional');
  ok(Math.abs(tot[3] + tot[4] - tot[2]) < 1e-6 * tot[2] + 1e-6, 'taker buy + taker sell = notional');
  const p = packCoin(acc, tot, 3);
  ok(p.w.length === 3 && p.r[p.r.length - 1][0] === -1, 'packCoin keeps top N and sums the tail');
  const acc2 = new Map(), tot2 = [0, 0, 0, 0, 0];
  mergeCoin(acc2, tot2, p.w, p);
  let b2 = 0; for (const v of acc2.values()) b2 += v[1];
  ok(Math.abs(b2 - b) < 1e-6 * b, 'nothing lost through pack + merge');
}

// ---- query rules
const U = (q) => new URL('https://x/hl-candle?' + q);
ok(candleQuery(U('coin=BTC&from=' + (T0 + 5) + '&to=' + (T0 + 30000)), NOW).from === T0, 'from rounded down to the minute');
ok(candleQuery(U('coin=BTC&from=' + T0 + '&to=' + (T0 + 30000)), NOW).to === T0 + 60000, 'to rounded up to the minute');
ok(candleQuery(U('coin=BTC&from=' + T0 / 1000 + '&to=' + (T0 / 1000 + 60)), NOW).to === T0 + 60000, 'seconds accepted');
ok(candleQuery(U('coin=BTC&from=' + T0 + '&to=' + (T0 + 4 * 3600000)), T0 + 5 * 3600000).hourly === true, '>= 1 h uses hour rows');
ok(candleQuery(U('coin=BTC&from=' + (T0 - 8 * 86400000) + '&to=' + T0), NOW) === null, 'span over 7 days refused');
ok(candleQuery(U('coin=../x&from=1&to=2'), NOW) === null, 'bad coin refused');
ok(candleQuery(U('coin=@107&from=' + T0 + '&to=' + (T0 + 60000)), NOW) !== null, 'spot coin @107 accepted');
ok(candleQuery(U('coin=BTC&from=' + T0 + '&to=' + (T0 + 60000) + '&n=5000'), NOW).n === 100, 'n capped at 100');
ok(hlPlan(new URL('https://x/hl-level?coin=BTC&lo=70000&hi=75000'), NOW) === null, 'level band > 2% refused');
ok(hlPlan(new URL('https://x/hl-wallet?a=0xABC'), NOW) === null, 'bad wallet address refused');
ok(hlPlan(new URL('https://x/hl-wallet?a=' + '0x' + 'Ab'.repeat(20)), NOW).path === '/hl/wallet?a=0x' + 'ab'.repeat(20), 'address lower-cased (one cache entry)');
ok(shortId('0x1234567890abcdef1234567890abcdef123456ab') === '0x1234\u2026ab', 'short id 0x1234…ab');
{
  const lv = STATE.coins.BTC.levels[0];
  const b = levelBody(STATE.coins.BTC, lv[0], lv[0], '', LABELS.labels);
  ok(b.levels.length >= 1 && b.levels[0].w[0].a === lv[2][0][0] && b.totNtl > 0, 'level lookup returns the wallets at that price');
}

// ---- round trip on a real Durable Object
let sqlite = null;
try { sqlite = await import('node:sqlite'); } catch (e) {}
if (!sqlite) { console.log('SKIP DO round trip (no node:sqlite)'); } else {
  const nodeCrypto = await import('node:crypto');
  const realNow = Date.now;
  // pretend "now" is just after the fixture minutes so freshness checks pass
  Date.now = () => NOW;
  const { default: worker, BookRecorder } = await import('../src/index.js');
  crypto.subtle.timingSafeEqual = (a, b) => nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const db = new sqlite.DatabaseSync(':memory:');
  const conv = (a) => a.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x));
  const sql = { exec(q, ...a) { const st = db.prepare(q); const rows = /^\s*SELECT/i.test(q) ? st.all(...conv(a)) : (st.run(...conv(a)), []); return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() }; }, get databaseSize() { return 0; } };
  const SECRET = 'z'.repeat(40);
  const env = { INGEST_SECRET: SECRET };
  const doObj = new BookRecorder({ storage: { sql, deleteAlarm: async () => {}, get: async () => null, put: async () => {} } }, env);
  env.RECORDER = { idFromName: () => 'id', get: () => ({ fetch: (u, init) => doObj.fetch(new Request(u, init)) }) };
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
  const ctx = { waitUntil: (p) => p };
  const post = (kind, obj, key = SECRET) => worker.fetch(new Request('https://w/hl-ingest?kind=' + kind, { method: 'POST', headers: { 'x-ingest-key': key }, body: gzipSync(JSON.stringify(obj)) }), env, ctx);
  const get = async (path, origin = 'https://tradezoro.com') => { const r = await worker.fetch(new Request('https://w' + path, { headers: { origin } }), env, ctx); return { r, j: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };

  ok((await post('min', MINS[0], 'wrong'.repeat(8))).status === 401, 'ingest without the secret refused');
  ok((await post('nope', MINS[0])).status === 400, 'unknown kind refused');
  for (const m of MINS) { const r = await post('min', m); ok(r.status === 200, 'minute ' + m.t + ' stored: ' + (await r.text())); }
  Date.now = () => STATE.t + 60000;
  ok((await post('state', STATE)).status === 200, 'state stored');
  ok((await post('labels', Object.assign(clone(LABELS), { t: STATE.t }))).status === 200, 'labels stored');

  const from = MINS[1].t, to = from + 60000;
  const c = await get('/hl-candle?coin=BTC&from=' + from + '&to=' + to + '&n=10');
  ok(c.r.status === 200 && c.r.headers.get('access-control-allow-origin') === 'https://tradezoro.com', 'candle 200 with CORS');
  const src = MINS[1].c.BTC;
  ok(c.j.tot.trades === src.tot[0] && Math.abs(c.j.tot.ntl - src.tot[2]) < 0.01, 'candle totals = the feeder minute');
  ok(c.j.wallets.length === Math.min(10, src.r.filter((r) => r[0] >= 0).length) && c.j.wallets[0].pct > 0, 'top wallets with % of candle');
  ok(c.j.wallets.every((w, i, a) => i === 0 || a[i - 1].buyNtl + a[i - 1].sellNtl >= w.buyNtl + w.sellNtl), 'wallets sorted by volume');
  ok(c.j.wallets.every((w) => typeof w.l === 'string' && Array.isArray(w.tags)), 'every wallet has a label and tags');
  const w0 = c.j.wallets[0];
  ok(w0.buyAvgPx === null || (w0.buyAvgPx > 50000 && w0.buyAvgPx < 150000), 'avg buy price is a BTC price');
  const all = await get('/hl-candle?coin=BTC&from=' + MINS[0].t + '&to=' + (MINS[2].t + 60000) + '&n=100');
  const sumTr = MINS.reduce((s, m) => s + m.c.BTC.tot[0], 0);
  ok(all.j.tot.trades === sumTr, '3-minute candle sums the minutes');
  ok(all.j.partial === false, 'range inside the held minutes is not partial');

  const cl = await get('/hl-clusters?coin=BTC');
  ok(cl.r.status === 200 && cl.j.liq.length > 0 && cl.j.coverage.oiPct > 0, 'clusters with liquidation buckets + coverage');
  ok(cl.j.liq.every((b) => b.w.every((w) => w.l && (w.side === 'long' || w.side === 'short'))), 'cluster wallets labelled');
  ok((await get('/hl-clusters?coin=NOPE')).r.status === 404, 'coin without data -> 404');
  const lv = STATE.coins.BTC.levels[0];
  const lr = await get('/hl-level?coin=BTC&lo=' + lv[0] + '&hi=' + lv[0]);
  ok(lr.r.status === 200 && lr.j.levels[0].w.length === lv[2].length, 'level wallets');
  const named = Object.entries(LABELS.labels).find(([, v]) => v.name)[0];
  const wa = Object.keys(STATE.wallets)[0];
  const wr = await get('/hl-wallet?a=' + wa);
  ok(wr.r.status === 200 && wr.j.tracked === true && Array.isArray(wr.j.pos), 'wallet profile');
  ok((await get('/hl-wallet?a=' + named)).j.l === LABELS.labels[named].name, 'named wallet shows its public name');
  const meta = await get('/hl-meta');
  ok(meta.j.coins.includes('BTC') && meta.j.updated === MINS[2].t && meta.j.keepDays === 7, 'meta (keepDays 7)');
  ok((await get('/hl-candle?coin=BTC&from=1&to=2', 'https://evil.example')).r.status === 403, 'other origins refused');
  ok((await get('/hl-candle?coin=BTC')).r.status === 400, 'missing range -> 400');

  // hour roll-up: a minute in the next hour rolls the previous hour, and an hourly read sums it
  {
    const h0 = Math.floor(MINS[0].t / 3600000) * 3600000;
    const late = Object.assign(clone(MINS[0]), { t: h0 + 3600000 });
    Date.now = () => late.t + 70000;
    const r = await post('min', late);
    ok(/rolled/.test(await r.text()), 'next hour triggers the roll-up');
    const hr = await get('/hl-candle?coin=BTC&from=' + h0 + '&to=' + (h0 + 3600000));
    ok(hr.j.tot.trades === sumTr, 'hourly read = sum of that hour\'s minutes');
  }

  // storage guard: past 1 GB keep 3 days (and trim at once), back to 7 days once 7 days would fit under 0.8 GB
  ok(hlKeepFor(350e6, HL_KEEP_MS) === HL_KEEP_MS && hlKeepFor(1.2e9, HL_KEEP_MS) === HL_KEEP_SHORT_MS, 'guard: 350 MB keeps 7 days, 1.2 GB drops to 3');
  ok(hlKeepFor(0.9e9, HL_KEEP_SHORT_MS) === HL_KEEP_SHORT_MS && hlKeepFor(0.3e9, HL_KEEP_SHORT_MS) === HL_KEEP_MS, 'guard: stays at 3 days until 7 days fit under 0.8 GB');
  {
    const g = hlGuard(doObj, Date.now());
    ok(g.bytes > 0 && g.keep === HL_KEEP_MS && doObj.meta('hlKeepMs') === null, 'guard: measures the hl tables (' + g.bytes + ' B), 7 days kept');
    // a minute 4 days old survives 7-day keep, is trimmed when the guard drops to 3 days
    const old = Date.now() - 4 * 86400000 - (Date.now() % 60000);
    doObj.sql.exec('INSERT OR REPLACE INTO hlmin (t, gz) VALUES (?, ?)', old, new Uint8Array(gzipSync('{}')));
    const warn = console.warn; let logged = ''; console.warn = (m) => { logged = m; };
    const realQ = doObj.sql.exec.bind(doObj.sql);
    doObj.sql = { exec: (q, ...a) => (/^SELECT SUM\(length\(gz\)\) AS b FROM hlmin/.test(q) ? { toArray: () => [{ b: 1.5e9 }] } : realQ(q, ...a)) };
    const g2 = hlGuard(doObj, Date.now());
    doObj.sql = sql; console.warn = warn;
    ok(g2.keep === HL_KEEP_SHORT_MS && doObj.meta('hlKeepMs') === String(HL_KEEP_SHORT_MS) && /storage guard: \d+ MB, keep 7 -> 3 days/.test(logged), 'guard: over 1 GB -> 3 days, logged "' + logged + '"');
    ok(sql.exec('SELECT COUNT(*) AS n FROM hlmin WHERE t = ?', old).toArray()[0].n === 0, 'guard: data older than 3 days trimmed');
    doObj.meta('hlKeepMs', String(HL_KEEP_MS));
  }

  if (process.argv.includes('--write-fixtures')) {
    const dir = process.argv[process.argv.indexOf('--write-fixtures') + 1];
    mkdirSync(dir, { recursive: true });
    const w = (f, o) => writeFileSync(dir + '/' + f, JSON.stringify(o, null, 1));
    w('hl-candle-BTC-1m.json', c.j); w('hl-candle-BTC-3m.json', all.j); w('hl-clusters-BTC.json', cl.j); w('hl-level-BTC.json', lr.j);
    w('hl-wallet.json', wr.j); w('hl-wallet-named.json', (await get('/hl-wallet?a=' + named)).j); w('hl-meta.json', meta.j);
    console.log('fixtures written to ' + dir);
  }
  Date.now = realNow;
}
console.log(n + ' passed');
