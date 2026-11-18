// Local Charts preview that never touches a live data source: static files from the repo plus
// /api/chart/bars served from a FIXTURE file (bars saved earlier), so Pine drawing tests can run
// while upstream quotas are tight. Not deployed. The stream socket is refused (the chart then
// just shows the fixture bars).
//   node tools/tests/chart-fixture-server.mjs <port> <fixture.json>
// Fixture shape: { "<tf>": [[t, o, h, l, c, v], ...], ... } with tf as in /api/chart/bars
// ("1", "5", "15", "60", "D"); t = bar open, epoch seconds. Any root is answered with the same
// rows (the fixture is NQ). Pages follow functions/api/chart/_bars.js TIMEFRAMES.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIMEFRAMES, normTf } from '../../functions/api/chart/_bars.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.argv[2] || 8097);
const FX = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp', '.pine': 'text/plain', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };
// 2h / 4h are built from 1h rows like the real route does (agg).
function rowsFor(tf){
  const t = TIMEFRAMES[tf]; if (!t) return [];
  if (FX[tf]) return FX[tf];
  const src = FX['60'] || []; const step = t.step || 0;
  if (!t.agg || !step) return [];
  const out = [];
  for (const r of src) {
    const b = Math.floor(r[0] / step) * step, l = out[out.length - 1];
    if (l && l[0] === b) { l[2] = Math.max(l[2], r[2]); l[3] = Math.min(l[3], r[3]); l[4] = r[4]; l[5] += r[5] || 0; }
    else out.push([b, r[1], r[2], r[3], r[4], r[5] || 0]);
  }
  return out;
}
http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname.startsWith('/api/chart/bars/')) {
      const tf = normTf(url.searchParams.get('tf') || '15');
      const rows = tf ? rowsFor(tf) : [];
      const P = tf && TIMEFRAMES[tf].page;
      const last = rows.length ? rows[rows.length - 1][0] : 0;
      const page = url.searchParams.has('page') ? Number(url.searchParams.get('page')) : (P ? Math.floor(last / P) : 0);
      const bars = P ? rows.filter((r) => Math.floor(r[0] / P) === page) : rows;
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-tz-rt': '0' });
      res.end(JSON.stringify({ s: 'NQ', tf, page, bars, rt: false }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"fixture server"}'); return;
  }
  let p = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html';
  if (!fs.existsSync(p)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).on('upgrade', (req, sock) => sock.destroy()).listen(PORT, '127.0.0.1', () => console.log('chart fixture server on', PORT));
