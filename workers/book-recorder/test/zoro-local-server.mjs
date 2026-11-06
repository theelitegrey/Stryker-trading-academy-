// Local stand-in for the book-recorder Worker (real src/index.js + BookRecorder DO on node:sqlite) for the ZoroOptions
// end-to-end run: the real feeder / note job / alert engine POST and GET against it; nothing is deployed.
//   ZO_SECRET=<40+ chars> ZO_DB=/path/zo.sqlite node workers/book-recorder/test/zoro-local-server.mjs 8788
// Pro tokens are not checked here (no Firestore): the ingest key is the only way past the gate, as for the server jobs.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import nodeCrypto from 'node:crypto';
import worker, { BookRecorder } from '../src/index.js';

crypto.subtle.timingSafeEqual = (a, b) => nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const db = new DatabaseSync(process.env.ZO_DB || ':memory:');
const sql = { exec(q, ...a) { const st = db.prepare(q); const rows = /^\s*SELECT/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows }; }, get databaseSize() { return 0; } };
const env = { INGEST_SECRET: process.env.ZO_SECRET || '', SYMBOLS: 'BTCUSDT' };
if (env.INGEST_SECRET.length < 32) { console.error('ZO_SECRET (32+ chars) missing'); process.exit(2); }
const doObj = new BookRecorder({ storage: { sql, deleteAlarm: async () => {} } }, env);
env.RECORDER = { idFromName: () => 'id', get: () => ({ fetch: (u, init) => doObj.fetch(new Request(u, init)) }) };
const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
const port = Number(process.argv[2] || 8788);
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  try {
    const r = await worker.fetch(new Request('http://127.0.0.1:' + port + req.url, { method: req.method, headers: req.headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body }), env, { waitUntil: () => {} });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(buf);
    console.log(req.method, req.url.slice(0, 90), r.status, buf.length);
  } catch (e) { res.writeHead(500); res.end(String(e)); console.log('ERR', req.url, e); }
}).listen(port, '127.0.0.1', () => console.log('zoro local worker on ' + port));
