// Static server for a worktree; /api/* proxied to the live site (127.0.0.1 only). node static-proxy.mjs ROOT PORT
import http2 from 'node:http2'; import zlib from 'node:zlib'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.argv[2]); const PORT = +process.argv[3] || 8041;
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };
// HTTP/2 over a throwaway self-signed cert (like Cloudflare): HTTP/1.1 would cap 6 connections and fake a slow phone.
http2.createSecureServer({ key: fs.readFileSync(process.env.TLS_KEY), cert: fs.readFileSync(process.env.TLS_CERT), allowHTTP1: true }, async (req, res) => {
  const u = new URL(req.url, 'https://x');
  if (u.pathname.startsWith('/api/')) {
    try {
      const r = await fetch('https://tradezoro.com' + u.pathname + u.search);
      const h = Object.fromEntries(r.headers); delete h['content-encoding']; delete h['content-length']; delete h['transfer-encoding'];
      res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.writeHead(502); res.end(); }
    return;
  }
  let p = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html';
  if (!fs.existsSync(p)) { res.writeHead(404); res.end('nf'); return; }
  const ct = T[path.extname(p)] || 'application/octet-stream';
  // like Cloudflare: brotli for text
  if (/html|javascript|css|json|svg/.test(ct) && /br/.test(req.headers['accept-encoding'] || '')) { res.writeHead(200, { 'content-type': ct, 'content-encoding': 'br' }); res.end(zlib.brotliCompressSync(fs.readFileSync(p), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })); return; }
  res.writeHead(200, { 'content-type': ct }); fs.createReadStream(p).pipe(res);
}).listen(PORT, '127.0.0.1');
