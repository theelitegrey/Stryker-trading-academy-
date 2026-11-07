// Local stand-in for the book-recorder Worker for the Hyperliquid wallet-intel dev run: the real src/index.js +
// BookRecorder DO on node:sqlite, so the real feeder can POST live data and the chart UI can read /hl-* before
// the Worker is deployed. Nothing is deployed. Listens on 127.0.0.1 only.
//   HL_SECRET=<32+ chars> [HL_DB=/path/hl.sqlite] node workers/book-recorder/test/hl-local-server.mjs 8790
//   BOOK_RECORDER_URL=http://127.0.0.1:8790 BOOK_INGEST_SECRET=<same> python3 workers/book-recorder/hl-feeder/hl_feeder.py
// Browser reads: CORS is the Worker's (tradezoro.com / strykertrading.com); a request with no Origin header
// (curl, or a page served from 127.0.0.1 via a proxy) is answered as usual. --cors-any adds
// access-control-allow-origin: * for a local preview page (dev only).
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import nodeCrypto from 'node:crypto';
import worker, { BookRecorder } from '../src/index.js';

crypto.subtle.timingSafeEqual = (a, b) => nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const db = new DatabaseSync(process.env.HL_DB || ':memory:');
const conv = (a) => a.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x));
const sql = { exec(q, ...a) { const st = db.prepare(q); const rows = /^\s*SELECT/i.test(q) ? st.all(...conv(a)) : (st.run(...conv(a)), []); return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() }; }, get databaseSize() { return 0; } };
const env = { INGEST_SECRET: process.env.HL_SECRET || '', SYMBOLS: 'BTCUSDT' };
if (env.INGEST_SECRET.length < 32) { console.error('HL_SECRET (32+ chars) missing'); process.exit(2); }
const doObj = new BookRecorder({ storage: { sql, deleteAlarm: async () => {}, get: async () => null, put: async () => {} } }, env);
env.RECORDER = { idFromName: () => 'id', get: () => ({ fetch: (u, init) => doObj.fetch(new Request(u, init)) }) };
const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { if (store.size > 2000) store.clear(); store.set(r.url, res); } } };
const anyOrigin = process.argv.includes('--cors-any');
const port = Number(process.argv[2] || 8790);
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = Object.assign({}, req.headers);
  if (anyOrigin) delete headers.origin;
  try {
    const r = await worker.fetch(new Request('http://127.0.0.1:' + port + req.url, { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body }), env, { waitUntil: () => {} });
    const buf = Buffer.from(await r.arrayBuffer());
    const h = Object.fromEntries(r.headers);
    if (anyOrigin) h['access-control-allow-origin'] = '*';
    res.writeHead(r.status, h); res.end(buf);
    console.log(new Date().toISOString().slice(11, 19), req.method, req.url.slice(0, 90), r.status, buf.length);
  } catch (e) { res.writeHead(500); res.end(String(e)); console.log('ERR', req.url, e); }
}).listen(port, '127.0.0.1', () => console.log('hl local worker on ' + port));
