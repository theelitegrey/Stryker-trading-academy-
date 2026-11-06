// Dev-only server for the ZoroOptions "real responses" browser test: serves the repo and forwards /api/zo/* to the
// local Worker (workers/book-recorder/test/zoro-local-server.mjs). A request with a Bearer token is forwarded with the
// local ingest key (stand-in for a verified Pro token; no Firestore here); a request without one goes as Free.
//   ZO_WORKER=http://127.0.0.1:8788 ZO_KEY_FILE=<key file> node tools/tests/zoro-dev-proxy.mjs 8096
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const W = process.env.ZO_WORKER || 'http://127.0.0.1:8788', K = fs.readFileSync(process.env.ZO_KEY_FILE, 'utf8').trim();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/zo/')) {
    const pro = /^Bearer\s+\S+/.test(req.headers.authorization || '') && !/(^|;\s*)zo_free=1/.test(req.headers.cookie || '');   // cookie zo_free=1: test a Free member
    const r = await fetch(W + '/zo/' + u.pathname.slice(8) + u.search, { headers: pro ? { 'x-ingest-key': K } : {} });
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let f = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(Number(process.argv[2] || 8096), '127.0.0.1', () => console.log('zoro dev proxy on ' + (process.argv[2] || 8096)));
