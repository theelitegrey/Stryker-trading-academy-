// GEX compact chains (workers/book-recorder/gex-feeder/gex_feeder.py -> /gex-ingest -> DO).
// The full Cboe chain (QQQ ~5 MB, SPX ~13 MB) is too big for the site's Pages Function (error 1102,
// build 528), so our server compacts it and this Worker only checks, stores and serves it.
export const GEX_SYMBOLS = ['QQQ', 'SPX', 'SPY', 'GLD'];
export const GEX_PARTS = ['near', 'term'];
export const GEX_MAX_BODY = 256 * 1024;
const FRESH_S = 10 * 60;   // the feeder stamps fetched_at; refuse anything older than 10 min or in the future

async function gunzipJson(buf) {
  const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
  const text = await ds.text();
  if (text.length > 4 * 1024 * 1024) throw new Error('too big unpacked');
  return JSON.parse(text);
}

// Returns { fetched_at } when valid, else { error }.
export async function validateGexChain(sym, part, buf, nowMs) {
  if (!GEX_SYMBOLS.includes(sym)) return { error: 'symbol not served' };
  if (!GEX_PARTS.includes(part)) return { error: 'bad part' };
  if (!buf || buf.byteLength < 20 || buf.byteLength > GEX_MAX_BODY) return { error: 'bad size' };
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return { error: 'not gzip' };
  let d;
  try { d = await gunzipJson(buf); } catch (e) { return { error: 'bad gzip/json' }; }
  if (!d || d.v !== 1 || d.part !== part) return { error: 'bad header' };
  if (String(d.symbol || '').replace(/^\^/, '') !== sym) return { error: 'symbol mismatch' };
  if (!(d.spot > 0) || !Number.isFinite(d.spot)) return { error: 'bad spot' };
  const now = nowMs / 1000;
  if (!Number.isFinite(d.fetched_at) || d.fetched_at > now + 60 || now - d.fetched_at > FRESH_S) return { error: 'stale or future fetched_at' };
  if (!d.expiries || typeof d.expiries !== 'object') return { error: 'no expiries' };
  for (const [e, rows] of Object.entries(d.expiries)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e) || !Array.isArray(rows) || rows.length > 3000) return { error: 'bad expiry ' + e };
    for (const r of rows) if (!Array.isArray(r) || r.length !== 8 || !(r[0] > 0) || (r[1] !== 'C' && r[1] !== 'P')) return { error: 'bad row in ' + e };
  }
  return { fetched_at: d.fetched_at };
}

// Fast GEX blob (gex_fast.py): { v:1, built, spots:{U:{p,t}}, u:{ SPX:{ built, '0':blk, '1':blk }, ... } }, blk = { x, s0, T, k[], c[], p[], ci[], pi[] }.
export async function validateGexFast(buf, nowMs) {
  if (!buf || buf.byteLength < 20 || buf.byteLength > GEX_MAX_BODY) return { error: 'bad size' };
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return { error: 'not gzip' };
  let d;
  try { d = await gunzipJson(buf); } catch (e) { return { error: 'bad gzip/json' }; }
  if (!d || d.v !== 1 || !d.u || typeof d.u !== 'object') return { error: 'bad header' };
  const now = nowMs / 1000;
  if (!Number.isFinite(d.built) || d.built > now + 60 || now - d.built > FRESH_S) return { error: 'stale or future built' };
  for (const [u, e] of Object.entries(d.u)) {
    if (!['SPX', 'QQQ', 'SPY'].includes(u) || !e || !Number.isFinite(e.built)) return { error: 'bad symbol ' + u };
    for (const m of ['0', '1']) {
      const k = e[m]; if (k === undefined) continue;
      if (!(k.s0 > 0) || !(k.T > 0) || !Array.isArray(k.k) || k.k.length > 600) return { error: 'bad block ' + u + m };
      for (const f of ['c', 'p', 'ci', 'pi']) if (!Array.isArray(k[f]) || k[f].length !== k.k.length) return { error: 'bad block ' + u + m };
    }
  }
  return { built: Math.round(d.built) };
}
