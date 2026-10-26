// Static server that behaves like Cloudflare Pages for load-speed tests: brotli on text files and the
// Cache-Control rules from the repo's _headers (last matching rule wins per header, as on Pages).
// /api/chart/bars/* answers from the recorded NQ order-flow fixture (fixtures/orderflow, the same
// candles as phone-layouts-lib.js, clock fixed at 2026-10-21 17:00 UTC); other /api/* 404. Not deployed.
//   node tools/tests/chart-speed-server.mjs <port> [siteRoot]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
const PORT = Number(process.argv[2] || 8263);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp', '.pine': 'text/plain', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };
// _headers: blocks of "<pattern>" then indented "Name: value" lines.
const RULES = [];
try {
  let cur = null;
  for (const line of fs.readFileSync(path.join(ROOT, '_headers'), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { cur = { re: new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), h: {} }; RULES.push(cur); }
    else if (cur && line.trim().startsWith('!')) cur.h[line.trim().slice(1).trim().toLowerCase()] = null; // "! Name" detaches
    else if (cur) { const i = line.indexOf(':'); cur.h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
  }
} catch (e) {}
const headersFor = (p) => { const h = {}; for (const r of RULES) if (r.re.test(p)) Object.assign(h, r.h); delete h['content-security-policy-report-only']; for (const k in h) if (h[k] == null) delete h[k]; return h; };
const brCache = new Map();
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'orderflow');
const NOW = Date.UTC(2026, 9, 21, 17, 0);
let CAND = null;
async function candles(tfMin) {
  if (!CAND) {
    const D = await import(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'chart-footprint-data.js'));
    const bars = [];
    for (const d of ['2026-10-20', '2026-10-21']) bars.push(...D.decodeOrderflow(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'NQ-' + d + '.bin.gz'))))).bars);
    CAND = { D, bars };
  }
  return CAND.D.aggregate(CAND.bars, tfMin * 60000).map((b) => [b.t / 1000, b.o * 0.25, b.hi * 0.25, b.lo * 0.25, b.c * 0.25, b.vol]).filter((x) => x[0] * 1000 < NOW);
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/chart/bars/')) {
    const tfs = url.searchParams.get('tf') || '1';
    const tf = /^\d+$/.test(tfs) ? Number(tfs) : (tfs === 'D' ? 1440 : 60);
    const page = Number(url.searchParams.get('page')) || 0;
    const bars = await candles(Math.min(tf, 240));
    await new Promise((r) => setTimeout(r, 120));   // edge + upstream think time
    const rt = /^Bearer admin\./.test(req.headers.authorization || '');   // the lane, as the real endpoint decides it
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-tz-rt': rt ? '1' : '0' }); res.end(JSON.stringify(Object.assign({ s: 'NQ', tf: tfs, page, bars }, /^Bearer (admin|member)\./.test(req.headers.authorization || '') ? { rt } : {}))); return;   // rt only for the access test's tokens (speed runs unchanged)
  }
  // /api/chart/rt: like functions/api/chart/rt.js, admin only for an admin token (tests use 'admin.*' / 'member.*')
  if (url.pathname === '/api/chart/rt') {
    const admin = /^Bearer admin\./.test(req.headers.authorization || '');
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ admin })); return;
  }
  if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return; }
  let p = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html';
  if (!fs.existsSync(p)) { res.writeHead(404); res.end('nf'); return; }
  const ext = path.extname(p);
  const h = Object.assign({ 'content-type': TYPES[ext] || 'application/octet-stream' }, headersFor(url.pathname));
  const st = fs.statSync(p); const etag = '"' + st.size + '-' + Math.round(st.mtimeMs) + '"';
  h.etag = etag;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); res.end(); return; }
  let body = fs.readFileSync(p);
  if (/^(text|application\/(json|javascript)|image\/svg)/.test(h['content-type']) && /br/.test(req.headers['accept-encoding'] || '')) {
    const k = p + etag; if (!brCache.has(k)) brCache.set(k, zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }));
    body = brCache.get(k); h['content-encoding'] = 'br'; h.vary = 'accept-encoding';
  }
  h['content-length'] = body.length;
  res.writeHead(200, h); res.end(body);
}).on('upgrade', (req, sock) => sock.destroy()).listen(PORT, '127.0.0.1', () => console.log('speed server on', PORT, ROOT));
