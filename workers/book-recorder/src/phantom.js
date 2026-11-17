// Phantom: options money flow per contract (Owner order 17 Nov, roadmap card "phantom").
//
// The GEX feeder (gex-feeder/gex_feeder.py + phantom.py) already downloads the Cboe chains once a minute. For SPX, SPY, QQQ and
// GLD it turns the change in each contract's volume since the previous sample into a premium estimate (new volume x price x 100)
// and a bought / sold split from where the last trade sat in the spread (the ZoroTide method, per contract). There is no trade
// tape: every number is "estimated from options volume and quotes, per minute". Never trades, prints, sweeps or blocks.
//
// POST /phantom-ingest?u=SPX (shared ingest secret, gzip JSON, <= PH_MAX_BODY). The DO validates (gunzip + parse is past the
// Worker's CPU), then stores:
//   phb  (u, day) -> the day-so-far board, re-gzipped without the minute map (replaced every sample; 30 days kept: past sessions)
//   phx  (u, day) -> t, spot, from, tot, moves, lm as JSON (small: the whale list, the net impact and the alert engine read it)
//   phm  (u, t)   -> this sample's {contract: [new volume, premium]} as JSON text (the drilldown reads one key with json_extract);
//                    PH_MINUTE_DAYS sessions kept (~15 MB a day for the four symbols)
// GET (signed-in member token, or the ingest secret for the alert engine; edge-cached):
//   /phantom/summary[?day=]          every symbol's {t, spot, from, tot, moves, lm} for the newest (or that) day  (net impact, whales)
//   /phantom/board?u=SPX[&day=]      the board gzip bytes (x-ph-gzip: 1; the page un-gzips)                     (strike flow)
//   /phantom/days?u=SPX              the stored days, newest first
//   /phantom/contract?u=SPX&day=&k=OCC[,OCC...]   per-minute [t, new volume, premium] for up to 4 contracts + next morning's OI
// Education only. Not financial advice.
export const PH_SYMBOLS = ['SPX', 'SPY', 'QQQ', 'GLD'];
export const PH_MAX_BODY = 512 * 1024;
export const PH_KEEP_DAYS = 30;
export const PH_MINUTE_DAYS = 5;
export const PH_MAX_K = 4;
const OCC = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const BOARD_COLS = ['k', 'x', 's', 'c', 'v', 'oi', 'p', 'n', 'px', 'doi', 'pv'];
const MOVE_COLS = ['t', 'k', 'dv', 'p', 'px', 'v', 'oi'];
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const int = (x) => Number.isInteger(x);
const intOrNull = (x) => x === null || Number.isInteger(x);

async function gunzipJson(buf) {
  const text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  if (text.length > 8 * 1024 * 1024) throw new Error('too big unpacked');
  return JSON.parse(text);
}
export async function gzipText(text) {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}

// One body -> { d } (the board, minute map split off as d.minute) or { error }. Pure apart from the gunzip.
export async function validatePhantom(u, buf, nowMs) {
  if (!PH_SYMBOLS.includes(u)) return { error: 'bad u' };
  if (!buf || buf.byteLength < 20 || buf.byteLength > PH_MAX_BODY) return { error: 'bad size' };
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return { error: 'not gzip' };
  let d;
  try { d = await gunzipJson(buf); } catch (e) { return { error: 'bad gzip/json' }; }
  const bad = checkBoard(u, d, nowMs / 1000);
  return bad ? { error: bad } : { d };
}

export function checkBoard(u, d, now) {
  if (!d || d.v !== 1 || d.u !== u) return 'bad header';
  if (!int(d.t) || d.t > now + 60 || now - d.t > 86400) return 'bad t';
  if (!DAY.test(String(d.day)) || (d.prevDay != null && !DAY.test(String(d.prevDay)))) return 'bad day';
  if (!(fin(d.spot) && d.spot > 0) || !intOrNull(d.from ?? null)) return 'bad spot/from';
  if (!Array.isArray(d.exps) || d.exps.length > 40 || !d.exps.every((e) => DAY.test(String(e)))) return 'bad exps';
  if (JSON.stringify(d.cols) !== JSON.stringify(BOARD_COLS) || JSON.stringify(d.mcols) !== JSON.stringify(MOVE_COLS)) return 'bad cols';
  if (!Array.isArray(d.rows) || d.rows.length > 20000) return 'bad rows';
  for (const r of d.rows) {
    if (!Array.isArray(r) || r.length !== 11 || !OCC.test(r[0]) || !int(r[1]) || r[1] < 0 || r[1] >= d.exps.length) return 'bad row';
    if (!(fin(r[2]) && r[2] > 0) || (r[3] !== 'C' && r[3] !== 'P') || !int(r[4]) || r[4] < 0 || !int(r[5]) || r[5] < 0) return 'bad row ' + r[0];
    if (!int(r[6]) || r[6] < 0 || !int(r[7]) || Math.abs(r[7]) > r[6] || !fin(r[8]) || r[8] < 0 || !intOrNull(r[9]) || !intOrNull(r[10])) return 'bad row ' + r[0];
  }
  const t = d.tot || {};
  if (!['cp', 'pp', 'cn', 'pn', 'cv', 'pv'].every((k) => int(t[k])) || t.cp < 0 || t.pp < 0 || Math.abs(t.cn) > t.cp || Math.abs(t.pn) > t.pp) return 'bad tot';
  if (!Array.isArray(d.moves) || d.moves.length > 300) return 'bad moves';
  for (const m of d.moves) if (!Array.isArray(m) || m.length !== 7 || !int(m[0]) || !OCC.test(m[1]) || !int(m[2]) || !int(m[3]) || m[3] < 0 || !fin(m[4]) || !int(m[5]) || !int(m[6])) return 'bad move';
  if (!Array.isArray(d.lm) || d.lm.length > 50) return 'bad lm';
  for (const m of d.lm) if (!Array.isArray(m) || m.length !== 5 || !OCC.test(m[0]) || !m.slice(1).every(int)) return 'bad lm row';   // [k, new volume, premium, day volume, OI]
  const mn = d.minute;
  if (!mn || typeof mn !== 'object' || Array.isArray(mn)) return 'bad minute';
  const keys = Object.keys(mn);
  if (keys.length > 20000) return 'bad minute';
  for (const k of keys) { const v = mn[k]; if (!OCC.test(k) || !Array.isArray(v) || v.length !== 2 || !int(v[0]) || v[0] <= 0 || !int(v[1]) || v[1] < 0) return 'bad minute ' + k; }
  // one minute of one symbol above $50B means a broken diff, not a market (same guard as /tide-snap)
  if (keys.reduce((a, k) => a + mn[k][1], 0) > 5e10) return 'premium too big';
  return '';
}

// ---- Durable Object storage --------------------------------------------------------------------
export function phInit(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS phb (u TEXT NOT NULL, day TEXT NOT NULL, t INTEGER NOT NULL, gz BLOB, PRIMARY KEY (u, day)) WITHOUT ROWID');
  sql.exec('CREATE TABLE IF NOT EXISTS phx (u TEXT NOT NULL, day TEXT NOT NULL, t INTEGER NOT NULL, j TEXT NOT NULL, PRIMARY KEY (u, day)) WITHOUT ROWID');
  sql.exec('CREATE TABLE IF NOT EXISTS phm (u TEXT NOT NULL, t INTEGER NOT NULL, day TEXT NOT NULL, j TEXT NOT NULL, PRIMARY KEY (u, t)) WITHOUT ROWID');
}

export async function phIngest(sql, d, nowSec, lastTrim) {
  const minute = d.minute;
  delete d.minute;
  sql.exec('INSERT OR REPLACE INTO phm (u, t, day, j) VALUES (?, ?, ?, ?)', d.u, d.t, d.day, JSON.stringify(minute));
  sql.exec('INSERT OR REPLACE INTO phx (u, day, t, j) VALUES (?, ?, ?, ?)', d.u, d.day, d.t,
    JSON.stringify({ t: d.t, spot: d.spot, from: d.from ?? null, tot: d.tot, mcols: d.mcols, moves: d.moves, lm: d.lm }));
  sql.exec('INSERT OR REPLACE INTO phb (u, day, t, gz) VALUES (?, ?, ?, ?)', d.u, d.day, d.t, await gzipText(JSON.stringify(d)));
  let trimmed = false;
  if (nowSec - (lastTrim || 0) > 3600) {
    for (const u of PH_SYMBOLS) {
      const days = sql.exec('SELECT day FROM phb WHERE u = ? ORDER BY day DESC', u).toArray().map((r) => r.day);
      if (days.length > PH_KEEP_DAYS) { sql.exec('DELETE FROM phb WHERE u = ? AND day < ?', u, days[PH_KEEP_DAYS - 1]); sql.exec('DELETE FROM phx WHERE u = ? AND day < ?', u, days[PH_KEEP_DAYS - 1]); }
      const md = sql.exec('SELECT DISTINCT day FROM phm WHERE u = ? ORDER BY day DESC', u).toArray().map((r) => r.day);
      if (md.length > PH_MINUTE_DAYS) sql.exec('DELETE FROM phm WHERE u = ? AND day < ?', u, md[PH_MINUTE_DAYS - 1]);
    }
    trimmed = true;
  }
  return { n: Object.keys(minute).length, trimmed };
}

export function phDays(sql, u) {
  return sql.exec('SELECT day, t FROM phb WHERE u = ? ORDER BY day DESC', u).toArray().map((r) => r.day);
}

export function phSummary(sql, day) {
  const out = { v: 1, day: null, u: {} };
  const want = day || (sql.exec('SELECT MAX(day) AS d FROM phx').toArray()[0] || {}).d;
  if (!want) return out;
  out.day = want;
  for (const r of sql.exec('SELECT u, j FROM phx WHERE day = ?', want).toArray()) out.u[r.u] = JSON.parse(r.j);
  return out;
}

export function phBoard(sql, u, day) {
  const r = day ? sql.exec('SELECT day, t, gz FROM phb WHERE u = ? AND day = ?', u, day).toArray()[0]
    : sql.exec('SELECT day, t, gz FROM phb WHERE u = ? ORDER BY day DESC LIMIT 1', u).toArray()[0];
  return r || null;
}

// Per-minute series of up to PH_MAX_K contracts on one day (OCC keys are checked by the caller: letters and digits only).
export async function phContract(sql, u, day, keys) {
  const out = { v: 1, u, day, k: keys, t: [], s: keys.map(() => []), next: null };
  const sel = keys.map((_, i) => `json_extract(j, '$.${keys[i]}') AS c${i}`).join(', ');
  const rows = sql.exec(`SELECT t, ${sel} FROM phm WHERE u = ? AND day = ? ORDER BY t`, u, day).toArray();
  for (const r of rows) {
    const vals = keys.map((_, i) => (r['c' + i] ? JSON.parse(r['c' + i]) : null));
    if (!vals.some(Boolean)) continue;
    out.t.push(r.t);
    vals.forEach((v, i) => out.s[i].push(v ? v : [0, 0]));
  }
  // next morning's OI change: the next stored session's board row (its doi = that morning's OI minus this day's OI)
  const nb = sql.exec('SELECT day, gz FROM phb WHERE u = ? AND day > ? ORDER BY day LIMIT 1', u, day).toArray()[0];
  if (nb) {
    const b = await gunzipJson(nb.gz instanceof ArrayBuffer ? nb.gz : new Uint8Array(nb.gz).buffer);
    const by = new Map(b.rows.map((r) => [r[0], r]));
    out.next = { day: nb.day, oi: keys.map((k) => (by.get(k) ? by.get(k)[5] : null)), doi: keys.map((k) => (by.get(k) ? by.get(k)[9] : null)) };
  }
  return out;
}

// GET /phantom/* query -> { route, u, day, keys } or { error }. Pure.
export function phQuery(u) {
  const route = u.pathname.slice('/phantom/'.length);
  if (!['summary', 'board', 'days', 'contract'].includes(route)) return { error: 'not found', status: 404 };
  const sym = String(u.searchParams.get('u') || '').toUpperCase();
  const day = u.searchParams.get('day') || '';
  if (day && !DAY.test(day)) return { error: 'bad day', status: 400 };
  if (route !== 'summary' && !PH_SYMBOLS.includes(sym)) return { error: 'bad u', status: 400 };
  let keys = [];
  if (route === 'contract') {
    keys = [...new Set(String(u.searchParams.get('k') || '').toUpperCase().split(',').filter(Boolean))];
    if (!day || !keys.length || keys.length > PH_MAX_K || !keys.every((k) => OCC.test(k))) return { error: 'bad k/day', status: 400 };
  }
  return { route, u: sym, day, keys };
}
