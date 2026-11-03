// Dhan symbol list (security-id master). DATA ONLY, public file, no token and no sign-in involved. GET ?seg=NSE_EQ|BSE_EQ|IDX_I|NSE_FNO|MCX_COMM.
// Reads Dhan's own per-segment CSV (api.dhan.co/v2/instrument/<seg>, a public redirect to a CSV file; the futures file is about 15 MB), keeps only what the chart needs
// (stocks, indexes, futures) and answers a few KB of JSON: [[securityId, symbol, instrument, expiry yyyy-mm-dd or '', exchange], ...]. Cached for 6 hours at the edge.
import { json, fail, rateLimited } from '../_token.js';

const SEGS = { NSE_EQ: 1, BSE_EQ: 1, IDX_I: 1, NSE_FNO: 1, MCX_COMM: 1 };
export function splitCsv(line) {   // quote-aware: a display name may hold a comma
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur); return out;
}
export function pick(seg, text) {
  const lines = text.split(/\r?\n/), head = splitCsv(lines[0]), ix = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  const need = ['EXCH_ID', 'SECURITY_ID', 'INSTRUMENT', 'UNDERLYING_SYMBOL', 'INSTRUMENT_TYPE', 'SERIES', 'SM_EXPIRY_DATE'];
  if (need.some((k) => ix[k] == null)) return null;
  const out = [], seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = splitCsv(lines[i]), ins = c[ix.INSTRUMENT], sym = c[ix.UNDERLYING_SYMBOL], id = c[ix.SECURITY_ID];
    if (!/^\d{1,10}$/.test(id) || !sym) continue;
    if (seg === 'IDX_I') { if (ins === 'INDEX') out.push([+id, sym, 'INDEX', '', c[ix.EXCH_ID]]); continue; }
    if (seg === 'NSE_FNO' || seg === 'MCX_COMM') { if (/^FUT(IDX|STK|COM)$/.test(ins) && /^\d{4}-\d{2}-\d{2}$/.test(c[ix.SM_EXPIRY_DATE])) out.push([+id, sym, ins, c[ix.SM_EXPIRY_DATE], c[ix.EXCH_ID]]); continue; }
    const okSeries = seg === 'NSE_EQ' ? c[ix.SERIES] === 'EQ' : /^(A|B|X|T)$/.test(c[ix.SERIES]);
    if (ins === 'EQUITY' && /^(ES|ETF)$/.test(c[ix.INSTRUMENT_TYPE]) && okSeries && c[ix.EXCH_ID] === seg.slice(0, 3) && !seen.has(sym)) { seen.add(sym); out.push([+id, sym, 'EQUITY', '', c[ix.EXCH_ID]]); }
  }
  return out;
}
export async function handle(request, env, deps = {}) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } });
  const seg = new URL(request.url).searchParams.get('seg');
  if (!SEGS[seg]) return fail(400, 'Bad request');
  if (await rateLimited(env, request, 'dhan-master')) return fail(429, 'Too many tries. Wait a minute.');
  let r;
  try { r = await (deps.fetchImpl || fetch)('https://api.dhan.co/v2/instrument/' + seg, { redirect: 'follow', signal: AbortSignal.timeout(20000), cf: { cacheTtl: 21600, cacheEverything: true } }); }
  catch (e) { return fail(502, 'Dhan did not answer'); }
  if (!r.ok) return fail(502, 'Dhan did not answer');
  const rows = pick(seg, await r.text());
  if (!rows || !rows.length) return fail(502, 'Dhan list changed');
  const res = json(rows); res.headers.set('cache-control', 'public, max-age=21600'); return res;
}
export const onRequest = ({ request, env }) => handle(request, env);
