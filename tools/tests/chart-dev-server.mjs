// Local preview for the Charts futures provider: static files + the real /api/chart/bars
// Pages Function (live Yahoo upstream, in-memory edge-cache stand-in). Not deployed.
//   node tools/tests/chart-dev-server.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestGet } from '../../functions/api/chart/bars/[sym].js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.argv[2] || 8031);
const store = new Map();
globalThis.caches = { default: {
  async match(req) { const e = store.get(req.url); if (!e || e.exp < Date.now()) return undefined; return e.res.clone(); },
  async put(req, res) { const m = /s-maxage=(\d+)/.exec(res.headers.get('cache-control') || ''); store.set(req.url, { res: res.clone(), exp: Date.now() + (m ? +m[1] : 60) * 1000 }); }
} };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp' };
let apiCount = 0;
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/chart/bars/')) {
    apiCount++;
    const sym = decodeURIComponent(url.pathname.split('/').pop());
    const t0 = Date.now();
    const r = await onRequestGet({ request: new Request(url.href), params: { sym } });
    const body = Buffer.from(await r.arrayBuffer());
    console.log(`API ${r.status} ${url.pathname}${url.search} ${body.length}B ${Date.now() - t0}ms`);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(body); return;
  }
  if (url.pathname === '/__api_count') { res.end(String(apiCount)); return; }
  let p = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html';
  if (!fs.existsSync(p)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('chart dev server on', PORT));
