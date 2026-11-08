// DEEP HISTORY local preview (history-gap2): the Charts dev server with the deep-history switch ON and the book-recorder's
// /hist-bars answered from the backfill files on disk (tools/hist/backfill_m1.py --out DIR), through the same hist-store.js code
// the Worker runs. Not deployed.  node tools/hist/hist-serve.mjs <port> <dir>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { onRequestGet } from '../../functions/api/chart/bars/[sym].js';
import { _setDeepForTests, RECORDER_URL } from '../../functions/api/chart/_bars.js';
import { histMemory, histIngest, histFetch } from '../../workers/book-recorder/src/hist-store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.argv[2] || 8095), DIR = process.argv[3] || '/root/tz-hist';
_setDeepForTests(true);
const store = histMemory();
let days = 0, rows = 0;
for (const sym of fs.existsSync(DIR) ? fs.readdirSync(DIR) : []) {
  const d = path.join(DIR, sym); if (!fs.statSync(d).isDirectory()) continue;
  for (const f of fs.readdirSync(d)) {
    const m = /^(\d{4}-\d{2}-\d{2})\.json\.gz$/.exec(f); if (!m) continue;
    const r = histIngest(store, { sym, day: m[1], rows: JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(d, f)))) });
    if (r.ok) { days++; rows += r.n; } else console.log('skip', sym, f, r.error);
  }
}
console.log('hist store loaded', days, 'days', rows, 'rows');
const cache = new Map();
globalThis.caches = { default: {
  async match(req) { const e = cache.get(req.url); if (!e || e.exp < Date.now()) return undefined; return e.res.clone(); },
  async put(req, res) { const m = /s-maxage=(\d+)/.exec(res.headers.get('cache-control') || ''); cache.set(req.url, { res: res.clone(), exp: Date.now() + (m ? +m[1] : 60) * 1000 }); }
} };
const realFetch = globalThis.fetch;
let histReads = 0;
globalThis.fetch = async (u, init) => {
  const s = String(u && u.url || u);
  if (s.startsWith(RECORDER_URL + '/hist-')) { histReads++; return histFetch(store, new URL(s), new Request(s), async () => false); }
  return realFetch(u, init);
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/chart/bars/')) {
    const r = await onRequestGet({ request: new Request(url.href), params: { sym: decodeURIComponent(url.pathname.split('/').pop()) } });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  if (url.pathname === '/__hist_reads') { res.end(String(histReads)); return; }
  let p = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html';
  if (!fs.existsSync(p)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('hist-serve on', PORT));
