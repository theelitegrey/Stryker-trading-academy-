// ZoroOptions: ingest validation, teaser filters, and the levels download (spec zoro-options-spec.md section 6).
// Pure helpers shared by the Worker (src/index.js), the Durable Object, and the site's Pages Function (functions/api/zo/*).
// The feeder (book-feeder/zoro_feeder.py) POSTs gzip JSON envelopes {v:1, built, ...payload} to /zo-ingest; this file checks them.
// The Worker stores one latest blob per (route, symbol, variant); summaries also append to a history table (tier A 90 d, tier B 30 d).
// Education only. Not financial advice.
import { etParts, etAt } from './gex-close.js';
import { OF_TICK, readUv, readSv } from './orderflow.js';

export const ZO_ROUTES = ['summary', 'profile', 'surface', 'history', 'activity', 'screen', 'cme', 'note'];
export const ZO_INGEST_ROUTES = ['summary', 'profile', 'surface', 'activity', 'screen', 'cme', 'note'];   // history is derived from summaries + gexsnap
export const ZO_TIER_A = ['SPX', 'SPY', 'QQQ', 'IWM', 'GLD', 'USO'];
export const ZO_KEEP_DAYS = { A: 90, B: 30 };
export const ZO_NOTE_KEEP_DAYS = 90;
export const ZO_PROFILE_X = ['0', '1', 'w', 'm', 'all'];
export const ZO_SURFACE_KIND = ['gamma', 'iv'];
export const ZO_ACT_KIND = ['fresh', 'burst', 'active'];
export const ZO_CME_ROOTS = ['ES', 'NQ', 'RTY', 'GC', 'CL'];
// size caps (gzip body bytes) per route; unpacked cap is ZO_MAX_RAW
export const ZO_MAX_GZ = { summary: 32 * 1024, profile: 128 * 1024, surface: 256 * 1024, activity: 96 * 1024, screen: 128 * 1024, cme: 128 * 1024, note: 32 * 1024 };
export const ZO_MAX_RAW = 3 * 1024 * 1024;
const HIST_ROW_MAX = 8 * 1024;       // a slimmed summary bigger than this is stored as "latest" only, not appended to history
// fields left out of the history copy (daily or latest-only data; S1 request 3): keeps SPX at ~4 KB instead of ~12 KB
const HIST_DROP = ['fresh_top', 'burst_top', 'term', 'term5', 'levels_full', 'range_info', '_fixture'];
export function zoSlim(d) {
  const o = {};
  for (const k of Object.keys(d)) if (!HIST_DROP.includes(k)) o[k] = d[k];
  if (d.iv && typeof d.iv === 'object') { o.iv = Object.assign({}, d.iv); delete o.iv.t; delete o.iv.v; }
  return o;
}
export const ZO_NOTE_KINDS = ['morning', 'close'];
export const ZO_ACT_KEEP_S = 8 * 86400;   // activity marks: 5 sessions (+ weekend)
export const ZO_HIST_MAX_SPAN = 31 * 86400;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const STOCK_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;

export const zoTier = (u) => (ZO_TIER_A.includes(u) ? 'A' : 'B');
export const zoSymbolOk = (u) => ZO_TIER_A.includes(u) || STOCK_RE.test(u);

async function gunzipJson(buf) {
  const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
  const text = await ds.text();
  if (text.length > ZO_MAX_RAW) throw new Error('too big unpacked');
  return JSON.parse(text);
}
export { gunzipJson as zoGunzip };

// Query -> { route, u, sub } or { error }. `sub` is the variant key stored with the blob.
export function zoIngestKey(route, q) {
  const g = (k) => String(q.get ? q.get(k) || '' : q[k] || '');
  if (!ZO_INGEST_ROUTES.includes(route)) return { error: 'bad route' };
  if (route === 'screen') return { route, u: '*', sub: '' };
  if (route === 'note') {
    const day = g('day'), kind = g('kind') || 'morning';
    if (!ZO_NOTE_KINDS.includes(kind)) return { error: 'bad kind' };
    return DAY_RE.test(day) ? { route, u: '*', sub: day + ':' + kind } : { error: 'bad day' };
  }
  if (route === 'cme') { const r = g('root').toUpperCase(); return ZO_CME_ROOTS.includes(r) ? { route, u: r, sub: '' } : { error: 'bad root' }; }
  const u = g('u').toUpperCase();
  if (route === 'activity') {
    const kind = g('kind');
    if (!ZO_ACT_KIND.includes(kind)) return { error: 'bad kind' };
    if (u !== 'ALL' && !zoSymbolOk(u)) return { error: 'bad symbol' };
    return { route, u, sub: kind };
  }
  if (!zoSymbolOk(u)) return { error: 'bad symbol' };
  if (route === 'summary') return { route, u, sub: '' };
  if (route === 'profile') { const x = g('x'); return ZO_PROFILE_X.includes(x) ? { route, u, sub: x } : { error: 'bad x' }; }
  const kind = g('kind');   // surface
  return ZO_SURFACE_KIND.includes(kind) ? { route, u, sub: kind } : { error: 'bad kind' };
}

// Validates one ingest. Returns { key, t, json } or { error }. Reads the gzip body; nothing is stored here.
export async function validateZoIngest(route, q, buf, nowMs) {
  const key = zoIngestKey(route, q);
  if (key.error) return key;
  if (!buf || buf.byteLength < 20 || buf.byteLength > ZO_MAX_GZ[route]) return { error: 'bad size' };
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return { error: 'not gzip' };
  let d;
  try { d = await gunzipJson(buf); } catch (e) { return { error: 'bad gzip/json' }; }
  if (!d || typeof d !== 'object' || Array.isArray(d) || d.v !== 1) return { error: 'bad header' };
  const now = nowMs / 1000;
  if (!Number.isInteger(d.built) || d.built > now + 60 || now - d.built > 86400) return { error: 'stale or future built' };
  if (d.u !== undefined && key.u !== '*' && key.u !== 'ALL' && d.u !== key.u && d.u !== key.sub) return { error: 'symbol mismatch' };
  const t = Number.isInteger(d.t) && d.t <= now + 60 && now - d.t < 86400 * 2 ? d.t : d.built;
  return { key, t, json: d };
}

// ---- Pro gate shape: which requests the free tier may read (SPX teaser panels, spec section 2) -----------------------------------
export const ZO_TEASER_ROUTES = ['summary', 'profile', 'note'];
// true when a request WITHOUT Pro may be answered with the teaser slice. Everything else is Pro-only (403 pro_required).
export function teaserEligible(route, q) {
  const g = (k) => String(q.get ? q.get(k) || '' : q[k] || '');
  if (!ZO_TEASER_ROUTES.includes(route)) return false;
  if (route === 'note') return true;                         // first 3 SPX lines only (zoNoteTeaser)
  if (g('u').toUpperCase() !== 'SPX') return false;
  if (route === 'profile') return (g('x') || '0') === '0';   // 0DTE only
  return true;
}

const pick = (o, keys) => { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; };
// Allow-lists (fail closed: a field the lists do not name is NOT shown to Free, so a new Pro field never leaks by default).
// Names follow the feeder contract (tools/fixtures/zoro/*.json); adjust here if the fixture differs.
const TEASER_SUMMARY = ['v', 'u', 'built', 't', 'day', 'tier', 'spot', 'chg', 'chg_pct', 'zone', 'levels', 'pc', 'src', 'close'];
const TEASER_RANGES = ['0', 'w'];                  // panel 3.1 teaser: 0DTE + weekly (feeder keys '0','1','w','m')
const TEASER_IV = ['rank', 'pct', 'rank_src', 'iv30', 'iv30_chg', 't', 'v'];   // 3.2: rank, percentile, IV30, 1-year sparkline
const TEASER_PROFILE = ['v', 'u', 'x', 'built', 't', 'spot', 'expiry', 'k', 'gex', 'vol', 'cw', 'pw', 'zg'];   // 2.1 + 4.1; no dex / vanna / charm / oi / nodes
const TEASER_PROFILE_COLS = ['k', 'gex', 'cvol', 'pvol'];   // per-strike columns Free may see (4.1 needs calls and puts apart)
export function zoTeaser(route, d) {
  if (!d || typeof d !== 'object') return null;
  if (route === 'summary') {
    const o = pick(d, TEASER_SUMMARY);
    if (d.ranges && typeof d.ranges === 'object') o.ranges = pick(d.ranges, TEASER_RANGES);
    if (d.range_info && typeof d.range_info === 'object') o.range_info = pick(d.range_info, TEASER_RANGES);
    if (d.pin !== undefined) o.pin = Array.isArray(d.pin) ? d.pin.slice(0, 1) : d.pin && d.pin.next ? { next: d.pin.next } : undefined;   // 4.7: next expiry only
    if (d.iv && typeof d.iv === 'object') o.iv = pick(d.iv, TEASER_IV);
    o.teaser = true;
    return o;
  }
  if (route === 'profile') {
    const o = Object.assign(pick(d, TEASER_PROFILE), { teaser: true });
    if (Array.isArray(d.cols) && Array.isArray(d.rows)) {
      const ix = TEASER_PROFILE_COLS.map((c) => d.cols.indexOf(c));
      if (ix.every((i) => i >= 0)) { o.cols = TEASER_PROFILE_COLS.slice(); o.rows = d.rows.map((r) => ix.map((i) => r[i])); }
    }
    return o;
  }
  if (route === 'note') {
    // 5.1: S5 note {day, kind, ok, title, teaser:[3 SPX lines], footer, sections...}; Free gets only the head + teaser lines.
    const sec = Array.isArray(d.sections) ? d.sections.find((i) => i && (i.sym || i.u) === 'SPX') : null;
    const it = Array.isArray(d.items) ? d.items.find((i) => i && i.u === 'SPX') : null;
    const lines = Array.isArray(d.teaser) ? d.teaser : sec && Array.isArray(sec.lines) ? sec.lines : it && Array.isArray(it.lines) ? it.lines : [];
    return { v: d.v, day: d.day, kind: d.kind, ok: d.ok, built: d.built, title: d.title, footer: d.footer, teaser: lines.slice(0, 3).map(String) };
  }
  return null;
}

// ---- GET /zo/levels-export: gex-history snapshots as a download --------------------------------------------------------------------
export const EXPORT_SYMBOLS = { SPX: { src: 'SPX' }, SPY: { src: 'SPY' }, QQQ: { src: 'QQQ' }, ES: { src: 'SPX', fut: 'ES' }, NQ: { src: 'QQQ', fut: 'NQ' } };
export const EXPORT_STEPS = { '5m': 300, '15m': 900, '1h': 3600, close: 0 };
export const EXPORT_MAX_DAYS = 90;
export const EXPORT_MAX_ROWS = 60000;
export const EXPORT_COLUMNS = ['time_et', 'symbol', 'spot', 'call_ceiling', 'put_floor', 'flip_line', 'range0_upper', 'range0_lower', 'net_gex_m'];
const dayNum = (s) => Date.parse(s + 'T12:00:00Z') / 86400000;
const dayAdd = (s, n) => new Date(Date.parse(s + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// -> { u, src, fut, step, format, from, to, fromT, toT } or { error }
export function exportParams(q, nowSec) {
  const g = (k) => String(q.get ? q.get(k) || '' : q[k] || '');
  const u = g('u').toUpperCase(), spec = EXPORT_SYMBOLS[u];
  if (!spec) return { error: 'bad u (SPX, SPY, QQQ, ES, NQ)' };
  const step = g('step') || '15m', format = g('format') || 'csv';
  if (!(step in EXPORT_STEPS)) return { error: 'bad step (5m, 15m, 1h, close)' };
  if (format !== 'csv' && format !== 'json') return { error: 'bad format (csv, json)' };
  const today = etParts(nowSec).day;
  const to = g('to') || today, retained = dayAdd(today, -EXPORT_MAX_DAYS);
  const from = g('from') || dayAdd(to, -7);
  if (!DAY_RE.test(to) || !DAY_RE.test(from) || Number.isNaN(dayNum(to)) || Number.isNaN(dayNum(from))) return { error: 'bad date (YYYY-MM-DD, ET)' };
  if (from > to) return { error: 'from is after to' };
  if (dayNum(to) - dayNum(from) + 1 > EXPORT_MAX_DAYS) return { error: 'range over 90 days' };
  const f = from < retained ? retained : from;   // history is kept 90 days
  if (f > to) return { error: 'no history that old' };
  return { u, src: spec.src, fut: spec.fut || null, step, format, from: f, to, fromT: etAt(f, 0), toT: etAt(dayAdd(to, 1), 0) - 1 };
}

// Futures price (ticks index * tick size) from one stored order-flow record: t, lo, n, o, c -> close.
export function recordClose(b, sym) {
  try { let i = 0, t, lo, n, o, c; [t, i] = readUv(b, i); [lo, i] = readSv(b, i); [n, i] = readUv(b, i); [o, i] = readUv(b, i); [c, i] = readUv(b, i); return (lo + c) * OF_TICK[sym]; } catch (e) { return null; }
}

// rows = lightweight snapshot rows [{t, day, s, cw, pw, zg, n, e0, e1}] sorted by t -> one row per step bucket (the last snapshot in it).
export function pickSteps(rows, step) {
  const out = [];
  if (step === 'close') { for (const r of rows) { if (out.length && out[out.length - 1].day === r.day) out[out.length - 1] = r; else out.push(r); } return out; }
  const w = EXPORT_STEPS[step];
  for (const r of rows) { const b = Math.floor(r.t / w); if (out.length && Math.floor(out[out.length - 1].t / w) === b) out[out.length - 1] = r; else out.push(r); }
  return out;
}

const r2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const etStamp = (t) => { const p = etParts(t); return p.day + ' ' + String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'); };
// ratio(t) = futures price / underlying spot at that moment, or null (then the row is skipped: no made-up values).
export function exportRows(snaps, u, ratio) {
  const out = [];
  for (const r of snaps) {
    const k = ratio ? ratio(r) : 1;
    if (!(k > 0)) continue;
    const m = (x) => (x === null || x === undefined ? null : r2(x * k));
    const hasEm = r.e0 !== null && r.e0 !== undefined && r.e1 !== null && r.e1 !== undefined;
    out.push([etStamp(r.t), u, m(r.s), m(r.cw), m(r.pw), m(r.zg), hasEm ? m(r.e0 + r.e1) : null, hasEm ? m(r.e0 - r.e1) : null, r.n === null || r.n === undefined ? null : r2(r.n)]);
  }
  return out;
}
export const exportCsv = (rows) => EXPORT_COLUMNS.join(',') + '\n' + rows.map((r) => r.map((x) => (x === null ? '' : x)).join(',')).join('\n') + (rows.length ? '\n' : '');
export const NOTICE = 'Education only. Not financial advice.';

// ---- Durable Object storage (sql = ctx.storage.sql) -----------------------------------------------------------------------------------
export function zoInit(sql) {
  // latest blob per route + symbol + variant (gzip as it came)
  sql.exec(`CREATE TABLE IF NOT EXISTS zo (route TEXT NOT NULL, u TEXT NOT NULL, sub TEXT NOT NULL, t INTEGER NOT NULL, gz BLOB NOT NULL, PRIMARY KEY (route, u, sub)) WITHOUT ROWID`);
  // summary history: tier A 90 days, tier B 30 days
  sql.exec(`CREATE TABLE IF NOT EXISTS zohist (u TEXT NOT NULL, t INTEGER NOT NULL, j TEXT NOT NULL, PRIMARY KEY (u, t)) WITHOUT ROWID`);
  // activity marks for the charts (S4): fresh rows keep the first time a contract showed up that day, bursts keep every sample; 8 days
  sql.exec(`CREATE TABLE IF NOT EXISTS zoact (u TEXT NOT NULL, kind TEXT NOT NULL, k TEXT NOT NULL, t INTEGER NOT NULL, j TEXT NOT NULL, PRIMARY KEY (u, kind, k)) WITHOUT ROWID`);
}
export function zoPut(sql, key, t, buf, json, nowSec) {
  sql.exec('INSERT OR REPLACE INTO zo (route, u, sub, t, gz) VALUES (?, ?, ?, ?, ?)', key.route, key.u, key.sub, t, new Uint8Array(buf));
  let hist = false;
  if (key.route === 'summary') {
    const j = JSON.stringify(zoSlim(json));
    if (j.length <= HIST_ROW_MAX) { sql.exec('INSERT OR REPLACE INTO zohist (u, t, j) VALUES (?, ?, ?)', key.u, t, j); hist = true; }
  }
  if (key.route === 'activity' && key.u !== 'ALL' && (key.sub === 'fresh' || key.sub === 'burst') && Array.isArray(json.rows)) {
    for (const r of json.rows.slice(0, 200)) {
      if (!r || !Number.isInteger(r.t)) continue;
      const id = (key.sub === 'fresh' ? etParts(r.t).day : r.t) + ':' + r.side + ':' + r.k + ':' + r.x;
      sql.exec('INSERT OR IGNORE INTO zoact (u, kind, k, t, j) VALUES (?, ?, ?, ?, ?)', key.u, key.sub, id, r.t, JSON.stringify(r));
    }
  }
  return { hist };
}
// hourly trim, called by the DO after a put
export function zoTrim(sql, nowSec) {
  for (const [tier, days] of Object.entries(ZO_KEEP_DAYS)) {
    const cut = nowSec - days * 86400;
    if (tier === 'A') sql.exec(`DELETE FROM zohist WHERE t < ? AND u IN (${ZO_TIER_A.map(() => '?').join(',')})`, cut, ...ZO_TIER_A);
    else sql.exec(`DELETE FROM zohist WHERE t < ? AND u NOT IN (${ZO_TIER_A.map(() => '?').join(',')})`, cut, ...ZO_TIER_A);
  }
  sql.exec("DELETE FROM zo WHERE route = 'note' AND sub < ?", dayAdd(etParts(nowSec).day, -ZO_NOTE_KEEP_DAYS));
  sql.exec('DELETE FROM zoact WHERE t < ?', nowSec - ZO_ACT_KEEP_S);
}
// activity marks of one symbol, oldest first (last 5 sessions)
export function zoActItems(sql, u, kind, nowSec) {
  return sql.exec('SELECT j FROM zoact WHERE u = ? AND kind = ? AND t >= ? ORDER BY t DESC LIMIT 3000', u, kind, nowSec - ZO_ACT_KEEP_S).toArray().map((r) => JSON.parse(r.j)).reverse();
}
export function zoGet(sql, route, u, sub) {
  const r = sql.exec('SELECT t, gz FROM zo WHERE route = ? AND u = ? AND sub = ?', route, u, sub).toArray()[0];
  return r ? { t: r.t, gz: r.gz instanceof ArrayBuffer ? r.gz : new Uint8Array(r.gz) } : null;
}
// stored note key 'YYYY-MM-DD:kind'. kind given -> that note; no kind -> the newest built note of that day; no day -> newest day.
export function zoNoteKey(sql, day, kind) {
  let r;
  if (day && kind) r = sql.exec("SELECT sub FROM zo WHERE route = 'note' AND sub = ?", day + ':' + kind).toArray()[0];
  else if (day) r = sql.exec("SELECT sub FROM zo WHERE route = 'note' AND substr(sub, 1, 10) = ? ORDER BY t DESC LIMIT 1", day).toArray()[0];
  else r = sql.exec("SELECT sub FROM zo WHERE route = 'note'" + (kind ? ' AND sub LIKE ?' : '') + ' ORDER BY substr(sub, 1, 10) DESC, t DESC LIMIT 1', ...(kind ? ['%:' + kind] : [])).toArray()[0];
  return r ? r.sub : null;
}
// one ET day of one symbol, the fixture shape (tools/fixtures/zoro/history.json): {v, u, tier, day, step_s, t:[], snaps:[packed /gex-history rows]}
export function zoHistDay(sql, u, day) {
  const rows = sql.exec("SELECT t, json_extract(j, '$.snap') AS s FROM zohist WHERE u = ? AND t >= ? AND t <= ? ORDER BY t", u, etAt(day, 0), etAt(dayAdd(day, 1), 0) - 1).toArray().filter((r) => r.s);
  return { v: 1, u, tier: zoTier(u), day, step_s: zoTier(u) === 'A' ? 120 : 900, t: rows.map((r) => r.t), snaps: rows.map((r) => JSON.parse(r.s)) };
}
// snapshots between from and to (epoch s) as raw rows for packHistory (gex-history shape; S4 Gamma over time)
export function zoHistRange(sql, u, from, to) {
  return sql.exec("SELECT t, json_extract(j, '$.snap') AS s FROM zohist WHERE u = ? AND t >= ? AND t <= ? ORDER BY t", u, from, to).toArray()
    .filter((r) => r.s).map((r) => Object.assign(JSON.parse(r.s), { t: r.t })).filter((r) => Array.isArray(r.k) && Array.isArray(r.g));
}
// /gex-sessions shape: [{u, d, day, n, t0, t1}] newest first
export function zoHistSessions(sql, u) {
  return sql.exec("SELECT json_extract(j, '$.snap.day') AS day, json_extract(j, '$.snap.d') AS d, COUNT(*) AS n, MIN(t) AS t0, MAX(t) AS t1 FROM zohist WHERE u = ? AND json_extract(j, '$.snap') IS NOT NULL GROUP BY day ORDER BY day DESC", u)
    .toArray().map((r) => ({ u, d: r.d, day: r.day, n: r.n, t0: r.t0, t1: r.t1 }));
}
// basis=close: the last stored summary of the last finished session (before 16:00 ET: yesterday's; after: today's last)
export function zoCloseRow(sql, u, nowSec) {
  const p = etParts(nowSec), cut = p.h >= 16 ? nowSec : etAt(p.day, 0) - 1;
  const r = sql.exec('SELECT t, j FROM zohist WHERE u = ? AND t <= ? ORDER BY t DESC LIMIT 1', u, cut).toArray()[0];
  if (!r) return null;
  const d = JSON.parse(r.j), day = etParts(r.t).day, dt = new Date(day + 'T12:00:00Z');
  d.close = { day, label: dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '') };
  return d;
}
export function zoLastHistDay(sql, u) {
  const r = sql.exec('SELECT MAX(t) AS t FROM zohist WHERE u = ?', u).toArray()[0];
  return r && r.t ? etParts(r.t).day : null;
}
// Levels export, DO side: 0DTE snapshots (gexsnap d=0) as light rows via json_extract (no strike arrays parsed), then the step pick.
export function exportSnaps(sql, p) {
  const rows = sql.exec(`SELECT t, json_extract(j,'$.day') AS day, json_extract(j,'$.s') AS s, json_extract(j,'$.cw') AS cw, json_extract(j,'$.pw') AS pw,
    json_extract(j,'$.zg') AS zg, json_extract(j,'$.n') AS n, json_extract(j,'$.em[0]') AS e0, json_extract(j,'$.em[1]') AS e1
    FROM gexsnap WHERE u = ? AND d = 0 AND t >= ? AND t <= ? ORDER BY t`, p.src, p.fromT, p.toT).toArray();
  return pickSteps(rows, p.step);
}
// futures ratio at each snapshot: the futures 1-minute close at the snapshot's own minute (or the latest bar up to 10 min before) / spot.
export function futuresRatio(sql, fut) {
  const q = (m) => sql.exec('SELECT b FROM ofbar WHERE sym = ? AND t <= ? AND t >= ? ORDER BY t DESC LIMIT 1', fut, m, m - 10).toArray()[0];
  return (r) => { const row = q(Math.floor(r.t / 60)); if (!row) return null; const p = recordClose(new Uint8Array(row.b), fut); return p > 0 && r.s > 0 ? p / r.s : null; };
}

// ---- HTTP routes (called from src/index.js) -------------------------------------------------------------------------------------------
const JSON_H = { 'content-type': 'application/json; charset=utf-8' };
const deny = (status, error, h, extra = {}) => new Response(JSON.stringify({ error, message: error === 'pro_required' ? 'ZoroOptions is part of Pro.' : error, notice: NOTICE }), { status, headers: Object.assign({}, JSON_H, { 'cache-control': 'no-store' }, extra, h) });

// Request -> { route, u, sub } or { error }; defaults per spec section 6.
export function zoGetKey(route, q) {
  const g = (k) => String(q.get(k) || '');
  const u = g('u').toUpperCase();
  switch (route) {
    case 'summary': { const b = g('basis'); return zoSymbolOk(u) && (!b || b === 'close') ? { route, u, sub: '', basis: b } : { error: 'bad u' }; }
    case 'profile': { const x = g('x') || '0'; return zoSymbolOk(u) && ZO_PROFILE_X.includes(x) ? { route, u, sub: x } : { error: 'bad u or x' }; }
    case 'surface': { const k = g('kind') || 'gamma'; return zoSymbolOk(u) && ZO_SURFACE_KIND.includes(k) ? { route, u, sub: k } : { error: 'bad u or kind' }; }
    case 'history': {
      const day = g('day'), from = Number(g('from')), to = Number(g('to')) || null, dte = g('dte');
      if (!zoSymbolOk(u) || (day && !DAY_RE.test(day)) || (dte && dte !== '0' && dte !== '1')) return { error: 'bad u, day or dte' };
      if (g('sessions')) return { route, u, sub: day, sessions: true, dte };
      if (g('from')) { if (!(from > 0) || (to && !(to > from)) || ((to || from) - from) > ZO_HIST_MAX_SPAN) return { error: 'bad from/to (max 31 days)' }; return { route, u, sub: day, from, to, dte }; }
      return { route, u, sub: day };
    }
    case 'activity': { const k = g('kind') || 'fresh', a = u || 'ALL'; return ZO_ACT_KIND.includes(k) && (a === 'ALL' || zoSymbolOk(a)) ? { route, u: a, sub: k } : { error: 'bad u or kind' }; }
    case 'screen': return { route, u: '*', sub: '' };
    case 'cme': { const r = g('root').toUpperCase() || u; return ZO_CME_ROOTS.includes(r) ? { route, u: r, sub: '' } : { error: 'bad root' }; }
    case 'note': { const day = g('day'), kind = g('kind'); return (!day || DAY_RE.test(day)) && (!kind || ZO_NOTE_KINDS.includes(kind)) ? { route, u: '*', sub: day, kind } : { error: 'bad day or kind' }; }
  }
  return { error: 'not found' };
}

// POST /zo-ingest?route=summary&u=SPX... (server to server; the caller already checked the ingest secret)
export async function zoIngestRoute(req, u, env, stub) {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  if (!u.searchParams.get('route') && u.searchParams.get('name')) u.searchParams.set('route', u.searchParams.get('name'));   // S5 contract spelling
  const route = u.searchParams.get('route') || '';
  if (!ZO_MAX_GZ[route]) return new Response('bad route', { status: 400 });
  if (Number(req.headers.get('content-length') || 0) > ZO_MAX_GZ[route]) return new Response('too large', { status: 413 });
  const buf = await req.arrayBuffer();
  if (buf.byteLength > ZO_MAX_GZ[route]) return new Response('too large', { status: 413 });
  // cheap header check here, the full parse in the DO (CPU)
  const key = zoIngestKey(route, u.searchParams);
  if (key.error) return new Response(key.error, { status: 400 });
  return stub(env).fetch('https://do/zo-ingest?' + u.searchParams.toString(), { method: 'POST', body: buf });
}

// GET /zo/<route>. deps = { isPro(token) -> bool, bearer(req) -> token, stub(env), now(), service?(req) -> bool (feeder ingest key: note job + alert engine) }
export async function zoGetRoute(req, u, env, ctx, h, deps) {
  if (req.method !== 'GET') return new Response('GET only', { status: 405, headers: h });
  const name = u.pathname.slice(4);
  if (!ZO_ROUTES.includes(name)) return new Response('not found', { status: 404, headers: h });
  const key = zoGetKey(name, u.searchParams);
  if (key.error) return deny(400, key.error, h);
  // GATE (fail closed; before any cache or storage read): Pro token, else the SPX teaser slice, else 403.
  let pro = false;
  try { pro = !!(deps.service && (await deps.service(req))) || !!(await deps.isPro(deps.bearer(req))); } catch (e) { pro = false; }
  const teaser = !pro && teaserEligible(name, u.searchParams);
  if (!pro && !teaser) return deny(403, 'pro_required', h);
  if (env.RL) { try { const { success } = await env.RL.limit({ key: req.headers.get('cf-connecting-ip') || 'anon' }); if (!success) return new Response('slow down', { status: 429, headers: Object.assign({ 'retry-after': '60' }, h) }); } catch (e) {} }
  const nowSec = Math.floor(deps.now() / 1000);
  let sub = key.sub, ukey = key.u;
  const st = deps.stub(env);
  let body;   // object
  if (name === 'history') {
    // from the stored summaries' packed snapshot (tier A 90 d, tier B 30 d). ?day= (or none = newest day): the fixture shape;
    // ?from=&to=: the /gex-history packed shape; ?sessions=1: the /gex-sessions list
    const qs = new URLSearchParams({ u: key.u });
    if (key.sub) qs.set('day', key.sub);
    if (key.sessions) qs.set('sessions', '1');
    if (key.from) { qs.set('from', String(key.from)); qs.set('to', String(key.to || nowSec)); qs.set('dte', key.dte || '0'); }
    const r = await st.fetch('https://do/zo-history?' + qs);
    if (r.status !== 200) return deny(404, 'no data', h);
    body = await r.json();
    if (Array.isArray(body)) return new Response(JSON.stringify(body), { status: 200, headers: Object.assign({}, JSON_H, h, { 'cache-control': 'private, max-age=15', vary: 'Authorization, Origin' }) });
  } else if (name === 'summary' && key.basis === 'close') {
    const r = await st.fetch('https://do/zo-close?u=' + key.u);
    if (r.status !== 200) return deny(404, 'no data', h);
    body = await r.json();
  } else {
    if (name === 'note') {
      const d = await (await st.fetch('https://do/zo-note-day?day=' + (sub || '') + '&kind=' + (key.kind || ''))).json();
      if (!d.sub) return deny(404, 'no data', h);
      sub = d.sub;
    }
    const r = await st.fetch('https://do/zo-get?route=' + name + '&u=' + encodeURIComponent(ukey) + '&sub=' + encodeURIComponent(sub));
    if (r.status !== 200) return deny(404, 'no data', h);
    try { body = await gunzipJson(await r.arrayBuffer()); } catch (e) { return deny(502, 'bad stored data', h); }
    if (name === 'activity' && ukey !== 'ALL' && (sub === 'fresh' || sub === 'burst')) {
      const a = await st.fetch('https://do/zo-act?u=' + encodeURIComponent(ukey) + '&kind=' + sub);
      if (a.status === 200) body.items = await a.json();   // last 5 sessions of marks (S4); rows = the latest pull
    }
  }
  if (teaser) { body = zoTeaser(name, body); if (!body) return deny(403, 'pro_required', h); }
  // Pro answers are private (a shared cache must never keep them); the teaser slice is public SPX data but still vary-safe.
  const cc = pro ? 'private, max-age=15' : 'private, max-age=30';
  return new Response(JSON.stringify(Object.assign({ notice: NOTICE }, body)), { status: 200, headers: Object.assign({}, JSON_H, h, { 'cache-control': cc, vary: 'Authorization, Origin' }) });
}

// GET /zo/levels-export?u=&from=&to=&step=&format= : Pro only, 90 days max, own rate limit (RL_ZX, else RL), edge-cached 5 min inside the Worker.
export async function zoExportRoute(req, u, env, ctx, h, deps) {
  if (req.method !== 'GET') return new Response('GET only', { status: 405, headers: h });
  let pro = false;
  try { pro = !!(await deps.isPro(deps.bearer(req))); } catch (e) { pro = false; }
  if (!pro) return deny(403, 'pro_required', h);
  const nowSec = Math.floor(deps.now() / 1000);
  const rl = env.RL_ZX || env.RL;
  if (rl) { try { const { success } = await rl.limit({ key: 'zx:' + (req.headers.get('cf-connecting-ip') || 'anon') }); if (!success) return new Response('slow down', { status: 429, headers: Object.assign({ 'retry-after': '60' }, h) }); } catch (e) {} }
  const p = exportParams(u.searchParams, nowSec);
  if (p.error) return deny(400, p.error, h);
  const ckey = new Request('https://book-recorder.cache/zo-export/' + [p.u, p.from, p.to, p.step].join('/') + '/' + Math.floor(nowSec / 300));
  let rows;
  const hit = await caches.default.match(ckey);
  if (hit) rows = (await hit.json()).rows;
  else {
    const r = await deps.stub(env).fetch('https://do/zo-export?p=' + encodeURIComponent(JSON.stringify(p)));
    if (r.status !== 200) return deny(502, 'export failed', h);
    const j = await r.json(); rows = j.rows;
    ctx.waitUntil(caches.default.put(ckey, new Response(JSON.stringify(j), { headers: { 'cache-control': 'public, max-age=300' } })));
  }
  if (rows.length > EXPORT_MAX_ROWS) return deny(400, 'too many rows, use a coarser step', h);
  if (!rows.length) return deny(404, 'no history for that range', h);
  const name = `zoro-levels-${p.u}-${p.from}_${p.to}-${p.step}.${p.format}`;
  const base = { 'cache-control': 'private, no-store', vary: 'Authorization, Origin', 'content-disposition': `attachment; filename="${name}"` };
  if (p.format === 'csv') return new Response(exportCsv(rows) + '# ' + NOTICE + (p.fut ? ' Futures levels are mapped from ' + p.src + '.' : '') + '\n', { headers: Object.assign({ 'content-type': 'text/csv; charset=utf-8' }, h, base) });
  return new Response(JSON.stringify({ notice: NOTICE, u: p.u, mapped_from: p.fut ? p.src : null, from: p.from, to: p.to, step: p.step, columns: EXPORT_COLUMNS, rows }), { headers: Object.assign({}, JSON_H, h, base) });
}
