// TradeZoro book recorder (Cloudflare Worker + one SQLite-backed Durable Object).
//
// WHY: the Charts "Crypto DOM Heatmap" only knew the order book from the moment a Charts tab was
// opened, so older candles had no heatmap. This Worker keeps 24 h of the book per symbol so the
// heatmap is filled across the whole visible chart as soon as it opens (Owner approved 2026-10-12).
//
// WRITE: Binance refuses Cloudflare's egress IPs (api.binance.com HTTP 451, data-api.binance.vision
// HTTP 403, seen from this Worker 2026-10-13), so the Worker does NOT fetch Binance. A small feeder
// on our own server (workers/book-recorder/feeder/feeder.py, systemd timer, once a minute) fetches
// the depth snapshot, buckets it with the same rule (parity-tested) and POSTs it to /ingest with a
// shared secret (header x-ingest-key, compared in constant time; Worker secret INGEST_SECRET).
// Every sample is validated (symbol, size, freshness, the step rule, row band) before it is
// stored; 24 h per symbol is kept, older rows deleted on every insert.
// READ: GET /book-history?symbol=BTCUSDT[&from=ms][&to=ms] -> compact binary (src/bucket.js
// encodeSamples). GET /status -> JSON health. CORS: tradezoro.com + strykertrading.com only.
// Edge-cached 30 s, rate-limited per IP (20/min for /book-history and /status; /status is also
// memoised 30 s in the DO). Public market data only: no user data.
import { decodeSamples, encodeSamples, storeRule } from './bucket.js';
import { validateGexChain, GEX_PARTS, GEX_MAX_BODY } from './gex.js';

const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_BODY = 64 * 1024;      // one ingest = one sample per symbol, ~0.4 KB each
const MAX_ROWS = 1000;           // +-2% at ~0.05% rows is <= ~82 rows; anything far bigger is wrong
const FRESH_MS = 3 * 60000;      // a sample must be stamped within 3 min of the Worker's clock
const ALIGN_MS = 15 * 60000;     // 'from' rounded down to 15 min, as the client does (assets/chart-orderflow.js BOOK_REMOTE_ALIGN_MS)
const STATUS_MEMO_MS = 30000;    // /status is computed at most once per 30 s in the DO
const ORIGINS = new Set(['https://tradezoro.com', 'https://www.tradezoro.com', 'https://strykertrading.com', 'https://www.strykertrading.com']);

const symbolsOf = (env) => String(env.SYMBOLS || 'BTCUSDT,ETHUSDT').split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{3,20}$/.test(s));

// Shape checks for one ingest. Returns '' when valid, else the reason (sent back to the feeder).
export function validateIngest(syms, list, allowed, now) {
  if (!list) return 'bad body';
  if (!syms.length || syms.length !== list.length) return 'symbols / samples mismatch';
  if (new Set(syms).size !== syms.length) return 'duplicate symbol';
  for (let k = 0; k < list.length; k++) {
    const s = list[k], sym = syms[k];
    if (!allowed.includes(sym)) return sym + ': not recorded';
    if (!Number.isFinite(s.ts) || Math.abs(now - s.ts) > FRESH_MS) return sym + ': stale or future ts';
    if (!(s.mid > 0) || !Number.isFinite(s.mid)) return sym + ': bad mid';
    if (s.step !== storeRule(s.mid).step) return sym + ': step breaks the bucketing rule';
    if (!Number.isInteger(s.i0)) return sym + ': bad i0';
    if (!s.v.length || s.v.length > MAX_ROWS) return sym + ': row count';
    for (let j = 0; j < s.v.length; j++) if (!Number.isFinite(s.v[j])) return sym + ': non-finite row';
    if (s.i0 * s.step < s.mid * 0.975 || (s.i0 + s.v.length) * s.step > s.mid * 1.025) return sym + ': rows outside +-2% band';
    if (s.bb && s.ba && !(s.bb <= s.mid && s.mid <= s.ba)) return sym + ': mid outside best bid / ask';
  }
  return '';
}

// The range a /book-history request is served for. `from` is aligned DOWN to 15 min (not just the
// minute) so a caller that changes `from` on every request still lands on one of a few cache
// entries and DO reads; `to` is whole minutes, never past the current minute.
export function alignRange(fromQ, toQ, now) {
  const M = 60000;
  let to = Number(toQ) || now, from = Number(fromQ) || now - KEEP_MS;
  to = Math.min(Math.ceil(Math.min(to, now) / M) * M, Math.ceil(now / M) * M);
  from = Math.max(Math.floor(from / ALIGN_MS) * ALIGN_MS, Math.floor((now - KEEP_MS) / M) * M);
  return { from, to };
}

async function authorized(req, env) {
  const secret = env.INGEST_SECRET;
  if (!secret || secret.length < 32) return false;
  const enc = new TextEncoder();
  // hash both sides first: equal lengths for timingSafeEqual, no length leak
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(req.headers.get('x-ingest-key') || '')),
    crypto.subtle.digest('SHA-256', enc.encode(secret))
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export class BookRecorder {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql; this.cache = new Map(); this.alarmCleared = false; this.statusMemo = null;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS samples (sym TEXT NOT NULL, ts INTEGER NOT NULL, mid REAL, bb REAL, ba REAL, step REAL, i0 INTEGER, v BLOB, PRIMARY KEY (sym, ts)) WITHOUT ROWID`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID`);
    // GEX compact chains (gex-feeder): one gzip blob per symbol + part, replaced on every ingest
    this.sql.exec(`CREATE TABLE IF NOT EXISTS gex (sym TEXT NOT NULL, part TEXT NOT NULL, ts INTEGER NOT NULL, body BLOB, PRIMARY KEY (sym, part)) WITHOUT ROWID`);
  }
  meta(k, v) {
    if (v === undefined) { const r = this.sql.exec('SELECT v FROM meta WHERE k = ?', k).toArray()[0]; return r ? r.v : null; }
    this.sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', k, String(v));
  }
  // The first version fetched Binance from an alarm; Binance refuses Cloudflare's IPs, so that
  // alarm is retired. A leftover alarm runs this once and does not re-arm.
  async alarm() {}
  ingest(syms, list, feed) {
    const now = Date.now();
    list.forEach((s, k) => {
      const bytes = new Uint8Array(s.v.buffer, s.v.byteOffset, s.v.byteLength);
      this.sql.exec('INSERT OR REPLACE INTO samples (sym, ts, mid, bb, ba, step, i0, v) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', syms[k], Math.round(s.ts), s.mid, s.bb || 0, s.ba || 0, s.step, s.i0, bytes);
      this.sql.exec('DELETE FROM samples WHERE sym = ? AND ts < ?', syms[k], now - KEEP_MS);
    });
    this.meta('last', JSON.stringify({ ts: now, feed: String(feed || '').slice(0, 80), symbols: syms, rows: list.map((s) => s.v.length) }));
    this.cache.clear();
  }
  history(sym, from, to) {
    const key = sym + '|' + from + '|' + to, hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 30000) return hit.buf;
    const rows = this.sql.exec('SELECT ts, mid, bb, ba, step, i0, v FROM samples WHERE sym = ? AND ts >= ? AND ts <= ? ORDER BY ts', sym, from, to).toArray();
    const list = rows.map((r) => {
      const b = r.v instanceof ArrayBuffer ? r.v : new Uint8Array(r.v).buffer;
      return { ts: r.ts, mid: r.mid, bb: r.bb, ba: r.ba, step: r.step, i0: r.i0, v: new Float32Array(b.slice(0)) };
    });
    const buf = encodeSamples(list);
    if (this.cache.size > 64) this.cache.clear();
    this.cache.set(key, { at: Date.now(), buf });
    return buf;
  }
  status() {
    // memoised: the COUNT/MIN/MAX/SUM pass reads every row (~2,880), so do it at most every 30 s
    const m = this.statusMemo;
    if (m && Date.now() - m.at < STATUS_MEMO_MS) return m.out;
    const gex = {};
    for (const r of this.sql.exec('SELECT sym, part, ts, LENGTH(body) AS b FROM gex').toArray()) gex[r.sym + ':' + r.part] = { fetched_at: r.ts, bytes: r.b };
    const out = { gex, symbols: {}, keepHours: 24, source: 'server feeder (Binance spot depth, limit=5000), 1 sample/min', last: JSON.parse(this.meta('last') || 'null') };
    for (const s of symbolsOf(this.env)) {
      const c = this.sql.exec('SELECT COUNT(*) AS n, MIN(ts) AS t0, MAX(ts) AS t1, SUM(LENGTH(v)) AS b FROM samples WHERE sym = ?', s).toArray()[0];
      out.symbols[s] = { samples: c.n, from: c.t0, to: c.t1, rowBytes: c.b, avgRowBytes: c.n ? Math.round(c.b / c.n) : 0 };
    }
    out.dbBytes = this.ctx.storage.sql.databaseSize;
    this.statusMemo = { at: Date.now(), out };
    return out;
  }
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/ingest') {
      if (!this.alarmCleared) { this.alarmCleared = true; try { await this.ctx.storage.deleteAlarm(); } catch (e) {} }
      const syms = String(u.searchParams.get('symbols') || '').split(',');
      const list = decodeSamples(await req.arrayBuffer());
      const bad = validateIngest(syms, list, symbolsOf(this.env), Date.now());
      if (bad) return new Response(bad, { status: 400 });
      this.ingest(syms, list, req.headers.get('x-feed'));
      return new Response('stored ' + list.length);
    }
    if (u.pathname === '/gex-ingest') {
      const sym = u.searchParams.get('sym'), part = u.searchParams.get('part'), ts = Number(u.searchParams.get('ts'));
      this.sql.exec('INSERT OR REPLACE INTO gex (sym, part, ts, body) VALUES (?, ?, ?, ?)', sym, part, Math.round(ts), new Uint8Array(await req.arrayBuffer()));
      return new Response('stored ' + sym + ' ' + part);
    }
    if (u.pathname === '/gex-chain') {
      const r = this.sql.exec('SELECT ts, body FROM gex WHERE sym = ? AND part = ?', u.searchParams.get('sym'), u.searchParams.get('part')).toArray()[0];
      if (!r) return new Response('no chain', { status: 404 });
      return new Response(r.body instanceof ArrayBuffer ? r.body : new Uint8Array(r.body), { headers: { 'content-type': 'application/octet-stream', 'x-gex-fetched-at': String(r.ts) } });
    }
    if (u.pathname === '/status') return Response.json(this.status());
    if (u.pathname === '/history') {
      const sym = u.searchParams.get('symbol');
      const buf = this.history(sym, Number(u.searchParams.get('from')), Number(u.searchParams.get('to')));
      // oldest sample held for this symbol: the client shows the recorder's real coverage
      const first = this.sql.exec('SELECT MIN(ts) AS t FROM samples WHERE sym = ?', sym).toArray()[0];
      return new Response(buf, { headers: { 'content-type': 'application/octet-stream', 'x-book-from': String(first && first.t || 0) } });
    }
    return new Response('not found', { status: 404 });
  }
}

function cors(req) {
  const o = req.headers.get('origin');
  const h = { 'vary': 'Origin', 'x-content-type-options': 'nosniff' };
  if (o && ORIGINS.has(o)) { h['access-control-allow-origin'] = o; h['access-control-allow-methods'] = 'GET, OPTIONS'; h['access-control-max-age'] = '86400'; h['access-control-expose-headers'] = 'x-book-from'; }
  return h;
}
const stub = (env) => env.RECORDER.get(env.RECORDER.idFromName('main'));

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.pathname === '/ingest') {
      // server-to-server only: POST, the shared secret, a small binary body; no CORS headers
      if (req.method !== 'POST') return new Response('POST only', { status: 405 });
      if (!(await authorized(req, env))) return new Response('unauthorized', { status: 401 });
      const len = Number(req.headers.get('content-length') || 0);
      if (len > MAX_BODY) return new Response('too large', { status: 413 });
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_BODY || buf.byteLength < 8) return new Response('bad size', { status: 413 });
      const syms = String(u.searchParams.get('symbols') || '').toUpperCase().split(',');
      const bad = validateIngest(syms, decodeSamples(buf), symbolsOf(env), Date.now());
      if (bad) return new Response(bad, { status: 400 });
      return stub(env).fetch('https://do/ingest?symbols=' + syms.join(','), { method: 'POST', body: buf, headers: { 'x-feed': req.headers.get('x-feed') || '' } });
    }
    if (u.pathname === '/gex-ingest') {
      // GEX chain feeder (server -> Worker): same shared secret as /ingest, gzip JSON, <= 256 KB
      if (req.method !== 'POST') return new Response('POST only', { status: 405 });
      if (!(await authorized(req, env))) return new Response('unauthorized', { status: 401 });
      if (Number(req.headers.get('content-length') || 0) > GEX_MAX_BODY) return new Response('too large', { status: 413 });
      const buf = await req.arrayBuffer();
      const sym = String(u.searchParams.get('sym') || '').toUpperCase(), part = String(u.searchParams.get('part') || '');
      const v = await validateGexChain(sym, part, buf, Date.now());
      if (v.error) return new Response(v.error, { status: 400 });
      return stub(env).fetch('https://do/gex-ingest?sym=' + sym + '&part=' + part + '&ts=' + v.fetched_at, { method: 'POST', body: buf });
    }
    if (u.pathname === '/gex-chain') {
      // Read by the site's /api/gex/levels Function (server to server, no Origin). Edge-cached
      // 30 s; not rate-limited per IP because the callers are Cloudflare's own Function hosts.
      const sym = String(u.searchParams.get('sym') || '').toUpperCase(), part = String(u.searchParams.get('part') || 'near');
      if (req.method !== 'GET') return new Response('GET only', { status: 405 });
      if (req.headers.get('origin')) return new Response('server use only', { status: 403 });
      if (!/^[A-Z]{1,6}$/.test(sym) || !GEX_PARTS.includes(part)) return new Response('bad request', { status: 400 });
      const ckey = new Request('https://book-recorder.cache/gex/' + sym + '/' + part + '/' + Math.floor(Date.now() / 30000));
      let r = await caches.default.match(ckey);
      if (!r) {
        const d = await stub(env).fetch('https://do/gex-chain?sym=' + sym + '&part=' + part);
        if (d.status !== 200) return new Response('no chain', { status: 404, headers: { 'cache-control': 'no-store' } });
        r = new Response(await d.arrayBuffer(), { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=30', 'x-gex-fetched-at': d.headers.get('x-gex-fetched-at') || '0' } });
        ctx.waitUntil(caches.default.put(ckey, r.clone()));
      }
      return r;
    }
    const h = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method !== 'GET') return new Response('read-only', { status: 405, headers: h });
    // A browser on another site gets no CORS header (blocked by the browser); a cross-origin
    // request from a non-allowed origin is refused outright.
    const o = req.headers.get('origin');
    if (o && !ORIGINS.has(o)) return new Response('origin not allowed', { status: 403, headers: h });
    const ip = req.headers.get('cf-connecting-ip') || 'anon';
    if (env.RL) { try { const { success } = await env.RL.limit({ key: ip }); if (!success) return new Response('slow down', { status: 429, headers: Object.assign({ 'retry-after': '60' }, h) }); } catch (e) {} }

    if (u.pathname === '/status') {
      const r = await stub(env).fetch('https://do/status');
      return new Response(r.body, { headers: Object.assign({ 'content-type': 'application/json', 'cache-control': 'public, max-age=30' }, h) });
    }
    if (u.pathname !== '/book-history') return new Response('not found', { status: 404, headers: h });
    const sym = String(u.searchParams.get('symbol') || '').toUpperCase();
    if (!symbolsOf(env).includes(sym)) return new Response('symbol not recorded', { status: 404, headers: Object.assign({ 'cache-control': 'public, max-age=300' }, h) });
    // from: 15-min aligned, to: whole minutes, so viewers share cache entries (alignRange)
    const { from, to } = alignRange(u.searchParams.get('from'), u.searchParams.get('to'), Date.now());
    if (!(to > from)) return new Response('bad range', { status: 400, headers: h });
    const ckey = new Request('https://book-recorder.cache/' + sym + '/' + from + '/' + to);
    const cache = caches.default;
    let r = await cache.match(ckey);
    if (!r) {
      const d = await stub(env).fetch('https://do/history?symbol=' + sym + '&from=' + from + '&to=' + to);
      r = new Response(await d.arrayBuffer(), { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=30', 'x-book-from': d.headers.get('x-book-from') || '0' } });
      ctx.waitUntil(cache.put(ckey, r.clone()));
    }
    const out = new Response(r.body, r);
    Object.entries(h).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  }
};
