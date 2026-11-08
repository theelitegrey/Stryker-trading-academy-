// DEEP HISTORY store (history-gap2, 2026-11-08). 1-minute futures bars, one year+ back, built server-side from the data vendor's
// tick archive by tools/hist/backfill_m1.py (one-time backfill + a daily top-up) and kept HERE, so a member's scroll-back reads
// our store and never spends the vendor allowance.
//   POST /hist-ingest   (x-ingest-key, gzip JSON {sym, day: 'YYYY-MM-DD', rows: [[t_sec, o, h, l, c, v, buyV, n], ..]}): replaces that UTC day
//   GET  /hist-bars?sym=NQ&tf=5&from=<sec>&to=<sec>  -> { sym, tf, bars: [[t_sec, o, h, l, c, v], ..] }  (public, delayed lane:
//        nothing newer than now - 10 min ever leaves here; closed history only is cached by the caller)
// Same handler for the Durable Object (SQLite) and the local test server (memory store). Real trades only: a minute with no
// trades has no row; nothing is interpolated.
export const HIST_SYMS = ['NQ', 'ES', 'MNQ', 'MES', 'YM', 'RTY', 'CL', 'GC'];
export const HIST_TFS = { 1: 60, 5: 300, 15: 900, 30: 1800 };
export const HIST_DELAY_S = 600;
const MAX_SPAN_S = 40 * 86400;   // one read: at most 40 days (a 30m page is 10 days; bigger reads are a misuse)

export function histSql(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS hist1 (sym TEXT NOT NULL, t INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v REAL, PRIMARY KEY (sym, t)) WITHOUT ROWID');
  return {
    replace(sym, t0, t1, rows) {
      sql.exec('DELETE FROM hist1 WHERE sym = ? AND t >= ? AND t < ?', sym, t0, t1);
      for (const r of rows) sql.exec('INSERT OR REPLACE INTO hist1 (sym, t, o, h, l, c, v) VALUES (?, ?, ?, ?, ?, ?, ?)', sym, r[0], r[1], r[2], r[3], r[4], r[5]);
    },
    range(sym, t0, t1) { return sql.exec('SELECT t, o, h, l, c, v FROM hist1 WHERE sym = ? AND t >= ? AND t < ? ORDER BY t', sym, t0, t1).toArray().map((r) => [r.t, r.o, r.h, r.l, r.c, r.v]); },
    stats() { return sql.exec('SELECT sym, COUNT(*) AS n, MIN(t) AS t0, MAX(t) AS t1 FROM hist1 GROUP BY sym').toArray(); }
  };
}
// memory double (tests, tools/hist/hist-serve.mjs)
export function histMemory() {
  const m = new Map();
  return {
    replace(sym, t0, t1, rows) { const s = m.get(sym) || m.set(sym, new Map()).get(sym); for (const t of [...s.keys()]) if (t >= t0 && t < t1) s.delete(t); for (const r of rows) s.set(r[0], r.slice(0, 6)); },
    range(sym, t0, t1) { const s = m.get(sym); if (!s) return []; return [...s.values()].filter((r) => r[0] >= t0 && r[0] < t1).sort((a, b) => a[0] - b[0]); },
    stats() { return [...m].map(([sym, s]) => ({ sym, n: s.size, t0: Math.min(...s.keys()), t1: Math.max(...s.keys()) })); }
  };
}

// a day's upload -> { ok, n } | { error }. Validates every row (the trust boundary between the server and the store).
export function histIngest(store, body) {
  const sym = String(body && body.sym || '').toUpperCase();
  if (!HIST_SYMS.includes(sym)) return { error: 'unknown symbol' };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(body.day || ''));
  if (!m) return { error: 'bad day' };
  const t0 = Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000, t1 = t0 + 86400;
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows || rows.length > 1440) return { error: 'bad rows' };
  const ok = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 6) return { error: 'bad row' };
    const [t, o, h, l, c, v] = r.map(Number);
    if (!(t >= t0 && t < t1 && t % 60 === 0)) return { error: 'row outside the day' };
    if (![o, h, l, c].every((x) => x > 0 && Number.isFinite(x)) || !(h >= Math.max(o, c, l) && l <= Math.min(o, c)) || !(v >= 0)) return { error: 'bad prices' };
    ok.push([t, o, h, l, c, v]);
  }
  store.replace(sym, t0, t1, ok);
  return { ok: true, n: ok.length };
}

// 1m rows -> tf bars (epoch-aligned buckets, like the chart's pages). Only minutes at or before the delay cut.
export function aggregateRows(rows, step, cutS = Infinity) {
  const out = [];
  for (const r of rows) {
    if (r[0] > cutS) break;
    const b = Math.floor(r[0] / step) * step, last = out[out.length - 1];
    if (last && last[0] === b) { if (r[2] > last[2]) last[2] = r[2]; if (r[3] < last[3]) last[3] = r[3]; last[4] = r[4]; last[5] += r[5]; }
    else out.push([b, r[1], r[2], r[3], r[4], r[5]]);
  }
  return out;
}

export function histBars(store, sym, tf, from, to, nowS = Math.floor(Date.now() / 1000)) {
  const step = HIST_TFS[tf];
  if (!HIST_SYMS.includes(sym) || !step || !(to > from) || to - from > MAX_SPAN_S) return null;
  return aggregateRows(store.range(sym, Math.floor(from / step) * step, to), step, nowS - HIST_DELAY_S).filter((b) => b[0] >= from && b[0] < to);
}

// the routes (Durable Object side; the Worker front checks the ingest key before forwarding, `authorized` is a second check)
export async function histFetch(store, u, req, authorized) {
  if (u.pathname === '/hist-ingest') {
    if (req.method !== 'POST') return new Response('POST only', { status: 405 });
    if (!(await authorized(req))) return new Response('unauthorized', { status: 401 });
    let body;
    try {
      let raw = req.body;
      if ((req.headers.get('content-encoding') || '') === 'gzip' && typeof DecompressionStream === 'function') raw = raw.pipeThrough(new DecompressionStream('gzip'));
      body = JSON.parse(await new Response(raw).text());
    } catch (e) { return new Response('bad json', { status: 400 }); }
    const r = histIngest(store, body);
    return Response.json(r, { status: r.error ? 400 : 200 });
  }
  if (u.pathname === '/hist-bars') {
    const sym = String(u.searchParams.get('sym') || '').toUpperCase(), tf = String(u.searchParams.get('tf') || '');
    const b = histBars(store, sym, tf, Number(u.searchParams.get('from')), Number(u.searchParams.get('to')));
    if (!b) return new Response('bad request', { status: 400 });
    return Response.json({ sym, tf, bars: b });
  }
  if (u.pathname === '/hist-stats') return Response.json({ syms: store.stats() });
  return new Response('not found', { status: 404 });
}
