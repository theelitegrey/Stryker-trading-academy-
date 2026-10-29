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
import { validateGexChain, validateGexFast, GEX_PARTS, GEX_MAX_BODY } from './gex.js';
import { validateSnaps, packHistory, HIST_SYMBOLS, KEEP_DAYS, SNAP_MAX_BODY } from './gex-history.js';
import { validateOpt, dayRow, OPT_SYMBOLS, OPT_MAX_BODY, OPT_KEEP_DAYS } from './options.js';
import { validateScan, SCAN_PARTS, SCAN_MAX_BODY } from './scan.js';
import { newsRoute, newsIngestRoute, calRoute, calIngestRoute, newsDo, storeInit } from './news-routes.js';
import { terminalInit, terminalDo, terminalIngestRoute, terminalRoute } from './terminal.js';
import { isAdminToken, isRealtimeToken, bearerOf, RT_DELAY_S } from './rt-auth.js';
import { ISHub, isHubFetch, hubOpts } from './is-hub.js';
import { addNote, setBase, summary, sigOk, emptyUse } from './is-usage.js';
import { validateOfIngest, buildPayload, ofRange, ticksRange, ticksJson, barsTailJson, joinPath, OF_SYMBOLS, OF_TICK, OF_KEEP_DAYS, OF_MAX_BODY } from './orderflow.js';

const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_BODY = 64 * 1024;      // one ingest = one sample per symbol, ~0.4 KB each
const MAX_ROWS = 1000;           // +-2% at ~0.05% rows is <= ~82 rows; anything far bigger is wrong
const FRESH_MS = 3 * 60000;      // a sample must be stamped within 3 min of the Worker's clock
const ALIGN_MS = 15 * 60000;     // 'from' rounded down to 15 min, as the client does (assets/chart-orderflow.js BOOK_REMOTE_ALIGN_MS)
const STATUS_MEMO_MS = 30000;    // /status is computed at most once per 30 s in the DO
const HIST_MAX_RANGE_S = 8 * 86400;  // one /gex-history reply covers at most 8 days
const HIST_BUCKET_S = 120;
const OF_MEM_MIN = 26 * 60;  // (unused since the 2026-10-15 quota fix)          // order-flow minutes kept in the DO's memory (today + the rest of yesterday)           // edge cache key bucket = the feeder's 2-min cadence
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
    // GEX history (src/gex-history.js): one row per underlying + 0/1DTE + Cboe chain time, 90 days.
    // j = the snapshot's other fields as JSON (day, x, s, cw, pw, zg, n, em, k, g).
    this.sql.exec(`CREATE TABLE IF NOT EXISTS gexsnap (u TEXT NOT NULL, d INTEGER NOT NULL, t INTEGER NOT NULL, j TEXT NOT NULL, PRIMARY KEY (u, d, t)) WITHOUT ROWID`);
    // per-day summary so /gex-sessions never scans the snapshots
    storeInit(this.sql);   // news + economic calendar (src/news.js)
    terminalInit(this.sql);   // brief / market map / econ calendar files (src/terminal.js)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS gexday (u TEXT NOT NULL, d INTEGER NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, t0 INTEGER NOT NULL, t1 INTEGER NOT NULL, PRIMARY KEY (u, d, day)) WITHOUT ROWID`);
    // Options analytics (src/options.js): latest blob per underlying + one summary row per NY day.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS opt (u TEXT PRIMARY KEY, t INTEGER NOT NULL, j TEXT NOT NULL) WITHOUT ROWID`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS optday (u TEXT NOT NULL, day TEXT NOT NULL, j TEXT NOT NULL, PRIMARY KEY (u, day)) WITHOUT ROWID`);
    // Market scanner (src/scan.js): the latest gzip part per name, stored as it came.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS scan (part TEXT PRIMARY KEY, t INTEGER NOT NULL, gz BLOB NOT NULL) WITHOUT ROWID`);
    // Order flow (src/orderflow.js): one closed 1-minute footprint bar per row (b) plus its
    // 1-second path (s, for tick replay /ticks1s), 90 days. The open
    // bar is held in memory (ofLive) so the live tail writes no rows.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ofbar (sym TEXT NOT NULL, t INTEGER NOT NULL, b BLOB NOT NULL, s BLOB, PRIMARY KEY (sym, t)) WITHOUT ROWID`);
    this.ofLive = new Map(); this.ofMeta = new Map(); this.ofAt = new Map(); this.ofFirst = new Map();
    // the site's ONE InsightSentry realtime socket (src/is-hub.js); idle (no socket) until an admin chart attaches
    this.isHub = new ISHub(ctx.storage, env.INSIGHTSENTRY_WEBSOCKET_API_KEY || '', hubOpts(env));
  }
  // QUOTA (2026-10-15 outage): the Durable Object is evicted ~10 s after its last request and the
  // feeder posts every 30 s, so every post used to start a fresh DO and reload 26 h x 6 symbols
  // (~9,400 rows) from SQLite: ~1.1 M rows read/hour, free tier = 5 M rows read/day, exhausted at
  // 04:58 UTC. Now an ingest reads NO bars: it writes the closed ones and keeps the recent (open)
  // ones in ofLive; a read queries only the range asked for (edge-cached) and overlays ofLive.
  ofLiveFor(sym) {
    let m = this.ofLive.get(sym);
    if (!m) { m = new Map(); this.ofLive.set(sym, m); }
    return m;
  }
  ofIngest(sym, header, bars) {
    const now = Date.now(), nowMin = Math.floor(now / 60000);
    const live = this.ofLiveFor(sym);
    let stored = 0, open = 0;
    for (const { t, fp, path } of bars) {
      // closed = its minute ended 3 s or more ago (the feeder sends a bar's final state >= 5 s after);
      // the open bar is memory-only (no row written every 30 s)
      if ((t + 1) * 60000 + 3000 <= now) {
        this.sql.exec('INSERT OR REPLACE INTO ofbar (sym, t, b, s) VALUES (?, ?, ?, ?)', sym, t, fp, path);
        stored++;
      } else open++;
      if (t >= nowMin - 30) live.set(t, { fp, path });
    }
    for (const t of live.keys()) if (t < nowMin - 30) live.delete(t);
    // meta row only when the threshold or the contract changes (not on every POST)
    const prev = this.ofMeta.get(sym) || JSON.parse(this.meta('of:' + sym) || '{}');
    const m = { thr: header.thr || prev.thr || 0, src: String(header.src || prev.src || '') };
    if (m.thr !== prev.thr || m.src !== prev.src) this.meta('of:' + sym, JSON.stringify(m));
    this.ofMeta.set(sym, m);
    this.ofAt.set(sym, now);
    const lastTrim = this.ofTrimAt || 0;
    if (now - lastTrim > 6 * 3600000) {   // 6-hourly, and only once per DO life (not on every cold start)
      this.ofTrimAt = now;
      const cut = nowMin - OF_KEEP_DAYS * 1440;
      for (const s of OF_SYMBOLS) this.sql.exec('DELETE FROM ofbar WHERE sym = ? AND t < ?', s, cut);
    }
    return stored + ' stored, ' + open + ' open';
  }
  // withPath: the full record (footprint + 1-second path) for /ticks1s; else the footprint only
  ofRecs(sym, from, to, withPath) {
    const pick = (fp, path) => (withPath ? joinPath(fp, path) : fp);
    // The SQL part is memoised 5 min per (sym, range, withPath): a busy chart refreshes "today"
    // every 15 s, and re-reading ~1,440 rows each time would burn the free 5 M rows/day. Bars from
    // the last 30 min are overlaid from ofLive (always current), so the memo cannot serve stale data.
    const key = sym + '|' + from + '|' + to + '|' + (withPath ? 1 : 0), now = Date.now();
    if (!this.ofSqlMemo) this.ofSqlMemo = new Map();
    let hit = this.ofSqlMemo.get(key);
    if (!hit || now - hit.at > 300000) {
      const rows = new Map();
      const q = withPath ? 'SELECT t, b, s FROM ofbar' : 'SELECT t, b FROM ofbar';
      for (const r of this.sql.exec(q + ' WHERE sym = ? AND t >= ? AND t <= ? ORDER BY t', sym, from, to).toArray()) rows.set(r.t, pick(new Uint8Array(r.b), new Uint8Array(r.s || [0])));
      hit = { at: now, rows };
      if (this.ofSqlMemo.size > 24) this.ofSqlMemo.clear();
      this.ofSqlMemo.set(key, hit);
    }
    const byT = new Map(hit.rows);
    for (const [t, e] of this.ofLiveFor(sym)) if (t >= from && t <= to) byT.set(t, pick(e.fp, e.path));
    return [...byT.keys()].sort((x, y) => x - y).map((t) => byT.get(t));
  }
  ofRead(sym, from, to) {
    const recs = this.ofRecs(sym, from, to);
    this.ofLastN = recs.length;
    if (!this.ofFirst.has(sym)) {
      const f = this.sql.exec('SELECT MIN(t) AS t FROM ofbar WHERE sym = ?', sym).toArray()[0];
      if (f && f.t) this.ofFirst.set(sym, f.t);
    }
    const m = this.ofMeta.get(sym) || JSON.parse(this.meta('of:' + sym) || '{}');
    const header = { v: 1, sym, tick: OF_TICK[sym], thr: m.thr || 0, src: m.src || '', from, to, first: this.ofFirst.get(sym) || 0, at: this.ofAt.get(sym) || 0 };
    return buildPayload(header, recs);
  }
  ofStatus() {
    // MIN/MAX per symbol are index lookups. The full COUNT/SUM reads every row (up to 90 days x 6
    // symbols, ~0.5 M rows): it is kept in the meta table and recomputed at most once a day, so a
    // /status call after a DO restart never scans the table (free tier: 5 M rows read/day).
    const now = Date.now();
    if (!this.ofCount) { try { this.ofCount = JSON.parse(this.meta('ofCount') || 'null'); } catch (e) { this.ofCount = null; } }
    if (!this.ofCount || now - this.ofCount.at > 86400000) {
      const c = {};
      for (const r of this.sql.exec('SELECT sym, COUNT(*) AS n FROM ofbar GROUP BY sym').toArray()) c[r.sym] = { bars: r.n };
      this.ofCount = { at: now, c };
      this.meta('ofCount', JSON.stringify(this.ofCount));
    }
    const out = {};
    for (const sym of OF_SYMBOLS) {
      const lo = this.sql.exec('SELECT MIN(t) AS t FROM ofbar WHERE sym = ?', sym).toArray()[0];
      const hi = this.sql.exec('SELECT MAX(t) AS t FROM ofbar WHERE sym = ?', sym).toArray()[0];
      out[sym] = Object.assign({ from: lo && lo.t ? lo.t * 60 : 0, to: hi && hi.t ? hi.t * 60 : 0, meta: JSON.parse(this.meta('of:' + sym) || 'null'), lastIngest: this.ofAt.get(sym) || 0 },
        this.ofCount.c[sym] || { bars: 0 }, { countedAt: this.ofCount.at });
    }
    return out;
  }
  optIngest(items) {
    for (const a of items) {
      this.sql.exec('INSERT OR REPLACE INTO opt (u, t, j) VALUES (?, ?, ?)', a.u, a.t, JSON.stringify(a));
      this.sql.exec('INSERT OR REPLACE INTO optday (u, day, j) VALUES (?, ?, ?)', a.u, a.day, JSON.stringify(dayRow(a)));
    }
    const now = Math.floor(Date.now() / 1000), lastTrim = Number(this.meta('optTrim') || 0);
    if (now - lastTrim > 86400) {
      const cut = new Date((now - OPT_KEEP_DAYS * 86400) * 1000).toISOString().slice(0, 10);
      for (const u of OPT_SYMBOLS) this.sql.exec('DELETE FROM optday WHERE u = ? AND day < ?', u, cut);
      this.meta('optTrim', now);
    }
    return items.length;
  }
  optRead(u) {
    const r = this.sql.exec('SELECT j FROM opt WHERE u = ?', u).toArray()[0];
    if (!r) return null;
    const out = JSON.parse(r.j);
    out.hist = this.sql.exec('SELECT j FROM optday WHERE u = ? ORDER BY day DESC LIMIT 400', u).toArray().map((x) => JSON.parse(x.j)).reverse();
    return out;
  }
  snapIngest(snaps) {
    let added = 0;
    for (const s of snaps) {
      const { u, d, t, ...rest } = s;
      const had = this.sql.exec('SELECT 1 AS x FROM gexsnap WHERE u = ? AND d = ? AND t = ?', u, d, t).toArray().length;
      this.sql.exec('INSERT OR REPLACE INTO gexsnap (u, d, t, j) VALUES (?, ?, ?, ?)', u, d, t, JSON.stringify(rest));
      // the same Cboe chain time twice (Cboe did not reprint) replaces the row; count it once
      if (!had) {
        added++;
        this.sql.exec(`INSERT INTO gexday (u, d, day, n, t0, t1) VALUES (?, ?, ?, 1, ?, ?)
          ON CONFLICT (u, d, day) DO UPDATE SET n = n + 1, t0 = MIN(t0, excluded.t0), t1 = MAX(t1, excluded.t1)`, u, d, s.day, t, t);
      }
    }
    // 90-day trim, at most once an hour (by index: PRIMARY KEY (u, d, t))
    const now = Math.floor(Date.now() / 1000), lastTrim = Number(this.meta('gexTrim') || 0);
    if (now - lastTrim > 3600) {
      const cut = now - KEEP_DAYS * 86400;
      for (const u of HIST_SYMBOLS) for (const d of [0, 1]) {
        this.sql.exec('DELETE FROM gexsnap WHERE u = ? AND d = ? AND t < ?', u, d, cut);
        this.sql.exec('DELETE FROM gexday WHERE u = ? AND d = ? AND t1 < ?', u, d, cut);
      }
      this.meta('gexTrim', now);
    }
    this.meta('gexSnapLast', JSON.stringify({ ts: now, n: snaps.length, added }));
    return added;
  }
  snapHistory(u, d, from, to) {
    const rows = this.sql.exec('SELECT t, j FROM gexsnap WHERE u = ? AND d = ? AND t >= ? AND t <= ? ORDER BY t', u, d, from, to).toArray()
      .map((r) => Object.assign({ t: r.t }, JSON.parse(r.j)));
    return packHistory(u, d, rows);
  }
  snapSessions(u, d) {
    const q = u ? this.sql.exec('SELECT u, d, day, n, t0, t1 FROM gexday WHERE u = ? AND d = ? ORDER BY day DESC', u, d)
      : this.sql.exec('SELECT u, d, day, n, t0, t1 FROM gexday ORDER BY day DESC, u, d');
    return q.toArray();
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
    out.gexHistory = { keepDays: KEEP_DAYS, last: JSON.parse(this.meta('gexSnapLast') || 'null'),
      days: this.sql.exec('SELECT u, d, COUNT(*) AS days, SUM(n) AS snaps, MIN(day) AS first, MAX(day) AS lastDay FROM gexday GROUP BY u, d').toArray() };
    try { out.news = newsDo.stats(this); } catch (e) { out.news = { error: String(e) }; }
    out.orderflow = this.ofStatus();
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
    if (u.pathname === '/gex-snap') {
      const { snaps } = await req.json();
      return new Response('stored ' + this.snapIngest(snaps) + ' new of ' + snaps.length);
    }
    if (u.pathname === '/gex-history') {
      const p = this.snapHistory(u.searchParams.get('u'), Number(u.searchParams.get('d')), Number(u.searchParams.get('from')), Number(u.searchParams.get('to')));
      return Response.json(p);
    }
    if (u.pathname === '/gex-sessions') {
      const uu = u.searchParams.get('u');
      return Response.json(this.snapSessions(uu, Number(u.searchParams.get('d'))));
    }
    if (u.pathname === '/opt-ingest') {
      const { items } = await req.json();
      return new Response('stored ' + this.optIngest(items));
    }
    if (u.pathname === '/scan-ingest') {
      // validated here (gunzip + parse of a ~1 MB table is past the Worker's 10 ms CPU)
      const part = u.searchParams.get('part');
      const buf = await req.arrayBuffer();
      const v = await validateScan(part, buf, Date.now());
      if (v.error) return new Response(v.error, { status: 400 });
      this.sql.exec('INSERT OR REPLACE INTO scan (part, t, gz) VALUES (?, ?, ?)', part, v.t, buf);
      return new Response('stored ' + part);
    }
    if (u.pathname === '/scan') {
      const r = this.sql.exec('SELECT t, gz FROM scan WHERE part = ?', u.searchParams.get('part')).toArray()[0];
      if (!r) return new Response('no data', { status: 404 });
      return new Response(r.gz, { headers: { 'content-type': 'application/octet-stream', 'x-scan-t': String(r.t) } });
    }
    if (u.pathname === '/opt-analytics') {
      const out = this.optRead(u.searchParams.get('u'));
      return out ? Response.json(out) : new Response('no data', { status: 404 });
    }
    if (u.pathname === '/of-ingest') {
      // validated here, not in the Worker: gunzip + decoding ~300 bars is more than the free
      // plan's 10 ms Worker CPU; a Durable Object request has a much larger CPU budget
      const sym = u.searchParams.get('sym');
      const v = await validateOfIngest(sym, await req.arrayBuffer(), Date.now());
      if (v.error) return new Response(v.error, { status: 400 });
      return new Response(this.ofIngest(sym, v.header, v.bars));
    }
    if (u.pathname === '/ticks-read') {
      const sym = u.searchParams.get('sym');
      const j = ticksJson(sym, this.ofRecs(sym, Number(u.searchParams.get('from')), Number(u.searchParams.get('to')), true));
      return Response.json(j, { headers: { 'x-of-n': String(j.m.length) } });
    }
    if (u.pathname === '/bars-tail-read') {
      const sym = u.searchParams.get('sym');
      const nowMin = Math.floor(Date.now() / 60000);
      try { return Response.json(barsTailJson(sym, this.ofRecs(sym, Math.floor((nowMin - 480) / 10) * 10, nowMin, false))); } catch (e) { return new Response('tail error ' + String(e && e.message || e), { status: 500 }); }
    }
    if (u.pathname === '/of-read') {
      const buf = this.ofRead(u.searchParams.get('sym'), Number(u.searchParams.get('from')), Number(u.searchParams.get('to')));
      const gz = await new Response(new Blob([buf]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
      return new Response(gz, { headers: { 'content-type': 'application/octet-stream', 'x-of-raw': String(buf.length), 'x-of-n': String(this.ofLastN || 0) } });
    }
    if (u.pathname === '/is-note') {
      // monthly REST counter (src/is-usage.js): {src, n} adds requests; {base: {at, used}} sets the dashboard baseline
      const b = await req.json();
      let use = (await this.ctx.storage.get('isUse')) || emptyUse();
      if (b.base) use = setBase(use, Number(b.base.at), Number(b.base.used));
      if (b.n) use = addNote(use, String(b.src || 'other'), Number(b.n), Date.now());
      await this.ctx.storage.put('isUse', use);
      return new Response('noted');
    }
    if (u.pathname === '/is-stats') {
      // the 3 h WebSocket window (is-hub) + the monthly REST quota block
      const r = await isHubFetch(this.isHub, this.env, u, req);
      const j = await r.json();
      j.month = summary(await this.ctx.storage.get('isUse'), Date.now());
      return Response.json(j);
    }
    if (u.pathname === '/is-live') return isHubFetch(this.isHub, this.env, u, req);
    if (u.pathname === '/status') return Response.json(this.status());
    if (u.pathname.startsWith('/t/')) return terminalDo(this, u, req);   // terminal files (src/terminal.js)
    if (u.pathname.startsWith('/n/')) return newsDo(this, u, req);   // news + calendar (src/news-routes.js)
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
  if (o && ORIGINS.has(o)) { h['access-control-allow-origin'] = o; h['access-control-allow-methods'] = 'GET, OPTIONS'; h['access-control-allow-headers'] = 'authorization'; h['access-control-max-age'] = '86400'; h['access-control-expose-headers'] = 'x-book-from'; }
  return h;
}
const stub = (env) => env.RECORDER.get(env.RECORDER.idFromName('main'));

// The range a /gex-history request is served for (epoch seconds). Default: the last 24 h. `from`
// is rounded DOWN to the hour and `to` UP to the 2-min bucket (never past the current one), so
// callers share edge-cache entries; at most HIST_MAX_RANGE_S, never older than 90 days.
export function histRange(fromQ, toQ, nowSec) {
  const B = HIST_BUCKET_S, nowB = Math.ceil(nowSec / B) * B;
  let to = Number(toQ) || nowSec, from = Number(fromQ) || to - 86400;
  if (to > 1e11) to = Math.floor(to / 1000);          // accept ms too
  if (from > 1e11) from = Math.floor(from / 1000);
  to = Math.min(Math.ceil(to / B) * B, nowB);
  from = Math.max(Math.floor(from / 3600) * 3600, to - HIST_MAX_RANGE_S, Math.floor((nowSec - KEEP_DAYS * 86400) / 3600) * 3600);
  return { from, to, final: to < nowSec - 3600 };
}

// GET /gex-history?u=SPX&dte=0[&from=][&to=]  and  GET /gex-sessions[?u=SPX&dte=0]
// Public market data, our two sites' origins only (CORS), edge-cached per 2-min bucket (a range
// that ended over an hour ago never changes: cached a day). The JSON is gzip/brotli'd by
// Cloudflare's edge for clients that accept it. Plan gating (SPX 0DTE free, the rest Pro) is done
// by the site, as for the GEX levels API.
async function gexHistoryRoute(u, env, ctx, h) {
  const nowSec = Date.now() / 1000;
  const uu = String(u.searchParams.get('u') || '').toUpperCase();
  const d = Number(u.searchParams.get('dte') ?? u.searchParams.get('d') ?? 0);
  const sessions = u.pathname === '/gex-sessions';
  if ((uu || !sessions) && (!HIST_SYMBOLS.includes(uu) || (d !== 0 && d !== 1))) return new Response('bad request', { status: 400, headers: h });
  let doUrl, ckey, maxAge = 60;
  const bucket = Math.floor(nowSec / HIST_BUCKET_S);
  if (sessions) {
    doUrl = 'https://do/gex-sessions?' + (uu ? 'u=' + uu + '&d=' + d : '');
    ckey = 'https://book-recorder.cache/gex-sessions/' + (uu ? uu + '/' + d : 'all') + '/' + bucket;
  } else {
    const r = histRange(u.searchParams.get('from'), u.searchParams.get('to'), nowSec);
    if (!(r.to > r.from)) return new Response('bad range', { status: 400, headers: h });
    doUrl = 'https://do/gex-history?u=' + uu + '&d=' + d + '&from=' + r.from + '&to=' + r.to;
    ckey = 'https://book-recorder.cache/gex-history/' + uu + '/' + d + '/' + r.from + '/' + r.to + (r.final ? '' : '/' + bucket);
    if (r.final) maxAge = 86400;
  }
  const cache = caches.default, key = new Request(ckey);
  let res = await cache.match(key);
  if (!res) {
    const dr = await stub(env).fetch(doUrl);
    res = new Response(await dr.arrayBuffer(), { status: dr.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + maxAge } });
    if (dr.status === 200) ctx.waitUntil(cache.put(key, res.clone()));
  }
  const out = new Response(res.body, res);
  Object.entries(h).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}

// GET /opt-analytics?u=SPX  (options analytics, src/options.js). Edge-cached 60 s per underlying,
// so every visitor shares one DO read a minute. Plan gating (SPX free, the rest Pro) is the site's.
async function optRoute(u, env, ctx, h) {
  const uu = String(u.searchParams.get('u') || '').toUpperCase();
  if (!OPT_SYMBOLS.includes(uu)) return new Response('bad request', { status: 400, headers: h });
  const key = new Request('https://book-recorder.cache/opt/' + uu + '/' + Math.floor(Date.now() / 60000));
  let res = await caches.default.match(key);
  if (!res) {
    const dr = await stub(env).fetch('https://do/opt-analytics?u=' + uu);
    res = new Response(await dr.arrayBuffer(), { status: dr.status, headers: { 'content-type': dr.status === 200 ? 'application/json; charset=utf-8' : 'text/plain', 'cache-control': 'public, max-age=60' } });
    if (dr.status === 200) ctx.waitUntil(caches.default.put(key, res.clone()));
  }
  const out = new Response(res.body, res);
  Object.entries(h).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}

// GET /scan?part=presets|stock|etf|crypto  (market scanner, src/scan.js). The stored gzip bytes as
// application/octet-stream + x-scan-gzip: 1 (the page un-gzips). Edge-cached 60 s per part, so all
// visitors share one DO read a minute; InsightSentry is only called by the feeder.
async function scanRoute(u, env, ctx, h) {
  const part = String(u.searchParams.get('part') || '');
  if (!SCAN_PARTS.includes(part)) return new Response('bad request', { status: 400, headers: h });
  const key = new Request('https://book-recorder.cache/scan/' + part + '/' + Math.floor(Date.now() / 60000));
  let res = await caches.default.match(key);
  if (!res) {
    const dr = await stub(env).fetch('https://do/scan?part=' + part);
    res = new Response(await dr.arrayBuffer(), { status: dr.status, headers: { 'content-type': dr.status === 200 ? 'application/octet-stream' : 'text/plain', 'x-scan-gzip': dr.status === 200 ? '1' : '0', 'x-scan-t': dr.headers.get('x-scan-t') || '', 'cache-control': 'public, max-age=60' } });
    if (dr.status === 200) ctx.waitUntil(caches.default.put(key, res.clone()));
  }
  const out = new Response(res.body, res);
  Object.entries(h).forEach(([k, v]) => out.headers.set(k, v));
  out.headers.set('access-control-expose-headers', 'x-scan-gzip, x-scan-t');
  return out;
}

// GET /orderflow?sym=NQ&day=YYYY-MM-DD  or  &from=&to=  (see ofRange). Binary payload
// (src/orderflow.js), gzip'd in the DO and sent as application/octet-stream with x-of-gzip: 1; the
// client un-gzips with DecompressionStream (a stored gzip body with content-encoding does not
// survive the Cache API reliably). Edge-cached: a closed range a day, the range holding now 15 s.
// Micros ask for their mini (the site maps MNQ -> NQ). Plan gating is done by the site.
async function orderflowRoute(u, env, ctx, h, req) {
  const sym = String(u.searchParams.get('sym') || '').toUpperCase();
  if (!OF_SYMBOLS.includes(sym)) return new Response('symbol not recorded', { status: 404, headers: Object.assign({ 'cache-control': 'public, max-age=300' }, h) });
  const ticks = u.pathname === '/ticks1s';
  // CME futures real time is ADMIN ONLY (Owner 2026-10-16). Everyone else is served the range as it
  // stood 10 min ago: the clock the range is clamped to is moved back by 10 min plus one minute (only
  // minutes that were complete 10 min ago; the forming minute and the live tail are never included).
  // Admin = a verified Firebase ID token (Authorization: Bearer) whose uid has an admins/{uid} doc.
  const tok = bearerOf(req);
  const admin = tok ? await isRealtimeToken(tok) : false;
  const now = Date.now(), clock = admin ? now : now - RT_DELAY_S * 1000 - 60000;
  let r = ticks ? ticksRange(u.searchParams, clock) : ofRange(u.searchParams, clock);
  // a non-admin range that lies wholly inside the last 10 min is an EMPTY valid reply, not an error
  if (!r && !admin && !(u.searchParams.get('day') && !/^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('day')))) { const m = Math.floor(clock / 60000); r = { from: m + 1, to: m, final: false }; }
  if (!r) return new Response('bad range', { status: 400, headers: h });
  const bucket = Math.floor(clock / 15000);
  // A closed range is cached 1 h, not a day: the backfill and the 00:20 UTC rebuild of the
  // previous day rewrite closed bars. An empty reply (no data yet) is cached 60 s only.
  const ttl = (n) => (Number(n) > 0 ? (r.final ? 3600 : 15) : 60);
  const ckey = new Request('https://book-recorder.cache/v2/' + (ticks ? 't1s/' : 'of/') + sym + '/' + r.from + '/' + r.to + (r.final ? '' : '/' + bucket));
  const cache = caches.default;
  let res = await cache.match(ckey);
  if (!res && ticks) {
    // JSON; Cloudflare's edge gzip/brotli's it for clients that accept it (as /gex-history)
    const d = await stub(env).fetch('https://do/ticks-read?sym=' + sym + '&from=' + r.from + '&to=' + r.to);
    res = new Response(await d.arrayBuffer(), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + ttl(d.headers.get('x-of-n')) } });
    ctx.waitUntil(cache.put(ckey, res.clone()));
  }
  if (!res) {
    const d = await stub(env).fetch('https://do/of-read?sym=' + sym + '&from=' + r.from + '&to=' + r.to);
    res = new Response(await d.arrayBuffer(), { headers: { 'content-type': 'application/octet-stream', 'x-of-gzip': '1', 'cache-control': 'public, max-age=' + ttl(d.headers.get('x-of-n')) } });
    ctx.waitUntil(cache.put(ckey, res.clone()));
  }
  const out = new Response(res.body, res);
  Object.entries(h).forEach(([k, v]) => out.headers.set(k, v));
  out.headers.set('access-control-expose-headers', 'x-book-from, x-of-gzip');
  out.headers.set('vary', 'Origin, Authorization');
  if (admin) out.headers.set('cache-control', 'private, no-store');
  return out;
}

export default {
  // A Durable Object failure (free-tier quota, overload) must be a clean 503, not a bare 1101 page
  // with no CORS headers: the site treats 503 as "no recorded data" and draws its charts without it.
  async fetch(req, env, ctx) {
    try { return await route(req, env, ctx); } catch (e) {
      return new Response('recorder unavailable', { status: 503, headers: Object.assign({ 'cache-control': 'no-store', 'retry-after': '60' }, cors(req)) });
    }
  }
};

async function route(req, env, ctx) {
  {
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
    if (u.pathname === '/is-note') {
      // InsightSentry monthly REST counter (src/is-usage.js). Server feeders: the ingest secret, any source, n <= 100000,
      // and the dashboard baseline. Pages Functions: x-is-sig = HMAC of the minute keyed with the IS key they hold;
      // source 'pages' only, n <= 10 per note. The body is tiny JSON.
      if (req.method !== 'POST') return new Response('POST only', { status: 405 });
      if (Number(req.headers.get('content-length') || 0) > 512) return new Response('too large', { status: 413 });
      const full = await authorized(req, env);
      const pages = !full && (await sigOk(env.INSIGHTSENTRY_WEBSOCKET_API_KEY || '', req.headers.get('x-is-sig') || ''));
      if (!full && !pages) return new Response('unauthorized', { status: 401 });
      let b;
      try { b = JSON.parse((await req.text()).slice(0, 512)); } catch (e) { return new Response('bad json', { status: 400 }); }
      const n = Math.floor(Number(b && b.n) || 0);
      const body = { src: pages ? 'pages' : String(b.src || 'other').slice(0, 16), n: pages ? Math.min(10, n) : n };
      if (full && b.base && Number(b.base.at) > 0 && Number(b.base.used) >= 0) body.base = { at: Number(b.base.at), used: Number(b.base.used) };
      if (!(body.n > 0) && !body.base) return new Response('nothing to note', { status: 400 });
      return stub(env).fetch('https://do/is-note', { method: 'POST', body: JSON.stringify(body) });
    }
    if (u.pathname === '/gex-fast-ingest') {
      // Fast GEX feeder (gex_fast.py, InsightSentry + Cboe OI): per-strike gamma x OI, ~every 2 s. Same secret, gzip JSON <= 256 KB.
      if (req.method !== 'POST') return new Response('POST only', { status: 405 });
      if (!(await authorized(req, env))) return new Response('unauthorized', { status: 401 });
      if (Number(req.headers.get('content-length') || 0) > GEX_MAX_BODY) return new Response('too large', { status: 413 });
      const buf = await req.arrayBuffer();
      const v = await validateGexFast(buf, Date.now());
      if (v.error) return new Response(v.error, { status: 400 });
      return stub(env).fetch('https://do/gex-ingest?sym=FAST&part=fast&ts=' + v.built, { method: 'POST', body: buf });
    }
    if (u.pathname === '/gex-fast') {
      // Read by the site's /api/gex/ladder Function (server to server). Edge-cached 1 s.
      if (req.method !== 'GET') return new Response('GET only', { status: 405 });
      if (req.headers.get('origin')) return new Response('server use only', { status: 403 });
      const ckey = new Request('https://book-recorder.cache/gexfast/' + Math.floor(Date.now() / 1000));
      let r = await caches.default.match(ckey);
      if (!r) {
        const d = await stub(env).fetch('https://do/gex-chain?sym=FAST&part=fast');
        if (d.status !== 200) return new Response('no data ' + d.status + ' ' + (await d.text()).slice(0, 160), { status: 404, headers: { 'cache-control': 'no-store' } });
        r = new Response(await d.arrayBuffer(), { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=1', 'x-gex-built': d.headers.get('x-gex-fetched-at') || '0' } });
        ctx.waitUntil(caches.default.put(ckey, r.clone()));
      }
      return r;
    }
    if (u.pathname === '/gex-snap') {
      // GEX history snapshots from the feeder: same shared secret, gzip JSON, <= 64 KB
      if (req.method !== 'POST') return new Response('POST only', { status: 405 });
      if (!(await authorized(req, env))) return new Response('unauthorized', { status: 401 });
      if (Number(req.headers.get('content-length') || 0) > SNAP_MAX_BODY) return new Response('too large', { status: 413 });
      const v = await validateSnaps(await req.arrayBuffer(), Date.now());
      if (v.error) return new Response(v.error, { status: 400 });
      return stub(env).fetch('https://do/gex-snap', { method: 'POST', body: JSON.stringify({ snaps: v.snaps }) });
    }
    if (u.pathname === '/opt-ingest') {
      // options analytics feeder (server -> Worker): same shared secret, gzip JSON, <= 64 KB
      if (req.method !== 'POST') return new Response('POST only', { status: 405 });
      if (!(await authorized(req, env))) return new Response('unauthorized', { status: 401 });
      if (Number(req.headers.get('content-length') || 0) > OPT_MAX_BODY) return new Response('too large', { status: 413 });
      const v = await validateOpt(await req.arrayBuffer(), Date.now());
      if (v.error) return new Response(v.error, { status: 400 });
      return stub(env).fetch('https://do/opt-ingest', { method: 'POST', body: JSON.stringify({ items: v.items }) });
    }
    if (u.pathname === '/scan-ingest') {
      // market scanner feeder (server -> Worker): same shared secret, gzip JSON part, <= 512 KB;
      // the DO validates (CPU)
      if (req.method !== 'POST') return new Response('POST only', { status: 405 });
      if (!(await authorized(req, env))) return new Response('unauthorized', { status: 401 });
      const part = u.searchParams.get('part');
      if (!SCAN_PARTS.includes(part)) return new Response('bad part', { status: 400 });
      if (Number(req.headers.get('content-length') || 0) > SCAN_MAX_BODY) return new Response('too large', { status: 413 });
      const buf = await req.arrayBuffer();
      if (buf.byteLength > SCAN_MAX_BODY) return new Response('too large', { status: 413 });
      return stub(env).fetch('https://do/scan-ingest?part=' + part, { method: 'POST', body: buf });
    }
    if (u.pathname === '/news-ingest') return newsIngestRoute(req, env, authorized, stub);
    if (u.pathname === '/cal-ingest') return calIngestRoute(req, env, u, authorized, stub);
    if (u.pathname === '/terminal-ingest') return terminalIngestRoute(req, env, u, authorized, stub);
    if (u.pathname === '/of-ingest') {
      // order-flow feeder (server -> Worker): same shared secret, gzip binary bars, <= 256 KB
      if (req.method !== 'POST') return new Response('POST only', { status: 405 });
      if (!(await authorized(req, env))) return new Response('unauthorized', { status: 401 });
      if (Number(req.headers.get('content-length') || 0) > OF_MAX_BODY) return new Response('too large', { status: 413 });
      const sym = String(u.searchParams.get('sym') || '').toUpperCase();
      if (!OF_SYMBOLS.includes(sym)) return new Response('symbol not recorded', { status: 400 });
      const buf = await req.arrayBuffer();
      if (buf.byteLength > OF_MAX_BODY) return new Response('too large', { status: 413 });
      return stub(env).fetch('https://do/of-ingest?sym=' + sym, { method: 'POST', body: buf });
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
    // ONE InsightSentry realtime socket for the site (src/is-hub.js, 2026-10-22 P0 "chart froze": IS throttled us at
    // 141 requests / window, limit 120). GET /is-live = WebSocket from the site's /api/chart/stream Function (server to
    // server, the admin's ID token forwarded and re-verified here). GET /is-health = the request counter (public, no
    // secrets: counts and states only), edge-cached 10 s.
    if (u.pathname === '/is-live') {
      if (req.headers.get('origin')) return new Response('server use only', { status: 403 });
      if (req.headers.get('upgrade') !== 'websocket') return new Response('websocket required', { status: 426 });
      if (!(await isRealtimeToken(bearerOf(req)))) return new Response('forbidden', { status: 403 });
      return stub(env).fetch(new Request('https://do/is-live' + u.search, req));
    }
    if (u.pathname === '/is-health') {
      const ckey = new Request('https://book-recorder.cache/is-health/' + Math.floor(Date.now() / 10000));
      let r = await caches.default.match(ckey);
      if (!r) {
        const d = await stub(env).fetch('https://do/is-stats');
        r = new Response(await d.arrayBuffer(), { status: d.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=10' } });
        if (d.status === 200) ctx.waitUntil(caches.default.put(ckey, r.clone()));
      }
      return new Response(r.body, { status: r.status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, cors(req)) });
    }
    const h = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method !== 'GET') return new Response('read-only', { status: 405, headers: h });
    // A browser on another site gets no CORS header (blocked by the browser); a cross-origin
    // request from a non-allowed origin is refused outright.
    const o = req.headers.get('origin');
    if (o && !ORIGINS.has(o)) return new Response('origin not allowed', { status: 403, headers: h });
    // news + calendar reads: their own per-IP limit (search typing), edge-cached (src/news-routes.js)
    // brief / market map / econ calendar (src/terminal.js): edge-cached 60 s, no per-IP limit needed
    if (u.pathname.startsWith('/terminal/')) return terminalRoute(u, env, ctx, h, stub, /^\/terminal\/market-(map|brief)/.test(u.pathname) && bearerOf(req) ? await isAdminToken(bearerOf(req)) : false);
    if (u.pathname === '/news' || u.pathname === '/cal') return (u.pathname === '/news' ? newsRoute : calRoute)(req, u, env, ctx, h, stub);
    // GET /bars-tail?sym=NQ: the newest ~8 h of 1-minute OHLCV rows (incl. the forming minute), for the site's
    // /api/chart/bars Function (server to server; it forwards the caller's ID token). ADMIN ONLY: the token is
    // verified here too (real time is admin only, Owner 2026-10-16). Edge-cached 3 s per symbol, so any number of
    // chart requests cost one Durable Object read per symbol per 3 s.
    if (u.pathname === '/bars-tail') {
      if (req.method !== 'GET') return new Response('GET only', { status: 405 });
      if (req.headers.get('origin')) return new Response('server use only', { status: 403 });
      const sym = String(u.searchParams.get('sym') || '').toUpperCase();
      if (!OF_SYMBOLS.includes(sym)) return new Response('symbol not recorded', { status: 404, headers: { 'cache-control': 'no-store' } });
      if (!(await isRealtimeToken(bearerOf(req)))) return new Response('forbidden', { status: 403, headers: { 'cache-control': 'no-store' } });
      const ckey = new Request('https://book-recorder.cache/bars-tail/' + sym + '/' + Math.floor(Date.now() / 3000));
      let r = await caches.default.match(ckey);
      if (!r) {
        const d = await stub(env).fetch('https://do/bars-tail-read?sym=' + sym);
        if (d.status !== 200) return new Response('no data ' + d.status + ' ' + (await d.text()).slice(0, 160), { status: 502, headers: { 'cache-control': 'no-store' } });
        r = new Response(await d.arrayBuffer(), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3' } });
        ctx.waitUntil(caches.default.put(ckey, r.clone()));
      }
      return new Response(r.body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } });
    }
    const ip = req.headers.get('cf-connecting-ip') || 'anon';
    // /orderflow has its own limiter (60/min: a footprint chart loads one request per UTC day plus a
    // 30 s live poll), so it never starves the heatmap / GEX history readers
    const rl = u.pathname === '/orderflow' || u.pathname === '/ticks1s' ? env.RL_OF : env.RL;
    if (rl) { try { const { success } = await rl.limit({ key: ip }); if (!success) return new Response('slow down', { status: 429, headers: Object.assign({ 'retry-after': '60' }, h) }); } catch (e) {} }

    if (u.pathname === '/gex-history' || u.pathname === '/gex-sessions') return gexHistoryRoute(u, env, ctx, h);
    if (u.pathname === '/opt-analytics') return optRoute(u, env, ctx, h);
    if (u.pathname === '/scan') return scanRoute(u, env, ctx, h);
    if (u.pathname === '/orderflow' || u.pathname === '/ticks1s') return orderflowRoute(u, env, ctx, h, req);
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
}
