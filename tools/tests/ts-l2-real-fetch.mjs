// Pulls REAL archive snapshots (Tick-stream /v1/history/book) + one live snapshot for NQ or ES and writes bucketed samples
// (the Worker's own bucketSnapshot + coarseRule) to a JSON fixture for ts-l2-browser.js (REAL=<file>). Counts only on stdout; the key is
// read from TICKSTREAM_ENV (never printed, never written to the fixture).
//   TICKSTREAM_ENV=/path/tickstream.env node tools/tests/ts-l2-real-fetch.mjs NQ 6 out.json
import fs from 'fs';
import { bucketSnapshot } from '../../workers/book-recorder/src/bucket.js';
import { coarseRule } from '../../workers/book-recorder/src/ts-hub.js';
const [sym = 'NQ', hours = '6', out = 'real.json'] = process.argv.slice(2);
const key = /TICKSTREAM_API_KEY=(.*)/.exec(fs.readFileSync(process.env.TICKSTREAM_ENV, 'utf8'))[1].trim().replace(/^["']|["']$/g, '');
const H = { authorization: 'Bearer ' + key }, now = Math.floor(Date.now() / 1000), samples = [];
for (let t = now - Number(hours) * 3600; t < now - 180; t += 300) {
  try {
    const r = await fetch(`https://api.tick-stream.xyz/v1/history/book?symbol=${sym}&start=${t}&end=${t + 2}&limit=900`, { headers: H });
    if (!r.ok) { console.log('http', r.status); continue; }
    const rows = ((await r.json()).book || []), ts0 = rows[0] && rows[0].ts; if (!ts0) continue;
    const bids = [], asks = [];
    for (const x of rows) { if (x.ts !== ts0 || x.flag) continue; (x.side === 'bid' ? bids : asks).push([Number(x.price), Number(x.size)]); }
    if (!bids.length || !asks.length) continue;
    const mid = (Math.max(...bids.map((x) => x[0])) + Math.min(...asks.map((x) => x[0]))) / 2;
    const s = bucketSnapshot({ bids, asks }, t * 1000, coarseRule(mid, sym));
    if (s) samples.push({ ts: t * 1000, mid: s.mid, bb: s.bb, ba: s.ba, step: s.step, i0: s.i0, v: Array.from(s.v) });
  } catch (e) { console.log('err', String(e.message).slice(0, 60)); }
}
const live = await new Promise((res) => {
  const ws = new WebSocket('wss://stream.tick-stream.xyz/v1/stream?key=' + key);
  ws.onopen = () => ws.send(JSON.stringify({ op: 'subscribe', channel: 'book', symbols: [sym] }));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.op === 'ping' || m.type === 'ping') { ws.send('{"op":"pong"}'); return; } if (m.type === 'book') { ws.close(); res(m); } };
  setTimeout(() => res(null), 15000);
});
let liveS = null;
if (live) { const mid = (live.bids[0][0] + live.asks[0][0]) / 2; const s = bucketSnapshot({ bids: live.bids, asks: live.asks }, Date.now(), coarseRule(mid, sym)); liveS = { mid: s.mid, bb: s.bb, ba: s.ba, step: s.step, i0: s.i0, v: Array.from(s.v), bids: live.bids.slice(0, 150), asks: live.asks.slice(0, 150) }; }
fs.writeFileSync(out, JSON.stringify({ sym, samples, live: liveS }));
const q = (a, p) => { a = a.slice().sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) * p)] : 0; };
for (const [name, v] of [['history', samples.flatMap((s) => s.v.map(Math.abs).filter(Boolean))], ['live', liveS ? liveS.v.map(Math.abs).filter(Boolean) : []]]) console.log(name, 'rows', v.length, 'p50', q(v, .5), 'p97', q(v, .97), 'max', Math.max(...v));
const side = (s) => [s.v.filter((x) => x > 0).length, s.v.filter((x) => x < 0).length];
console.log('samples', samples.length, 'bid/ask rows first', JSON.stringify(side(samples[0])), 'last', JSON.stringify(side(samples.at(-1))), 'live', liveS && JSON.stringify(side(liveS)));
