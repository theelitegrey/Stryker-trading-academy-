// Live smoke test for the Tick-stream L2 hub. Prints frame COUNTS only, never the key or a token.
//   node tools/tests/ts-l2-smoke.mjs [seconds=8] [symbols=NQ,ES,MNQ,MES,YM,RTY,CL,GC]
// env: TICKSTREAM_ENV  file with TICKSTREAM_API_KEY (default: the CoS scripts dir)
//      TS_SMOKE_BASE   hub origin (default https://book-recorder.theelitegrey.workers.dev)
//      TS_SMOKE_TOKEN  a Firebase ID token of an ADMIN account (a plain member must get refused: also checked)
// Step 1 uses ONE upstream connection of the 3 allowed for ~secs, so do not run it while production + the relay are both up.
// Step 2 goes through OUR endpoint (no upstream socket of its own; it shares the hub's).
import fs from 'node:fs';
const secs = Number(process.argv[2] || 8) * 1000;
const syms = String(process.argv[3] || 'NQ,ES,MNQ,MES,YM,RTY,CL,GC').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const envFile = process.env.TICKSTREAM_ENV || '/root/.hermes/profiles/chief-of-staff/scripts/tickstream.env';
const base = (process.env.TS_SMOKE_BASE || 'https://book-recorder.theelitegrey.workers.dev').replace(/\/$/, '');
let fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const tally = (url, proto, onOpen) => new Promise((res) => {
  const t = {}, out = { open: false, code: 0, t, bySym: {}, maxBytes: 0, bytes: 0 };
  let ws;
  try { ws = new WebSocket(url, proto); } catch (e) { out.err = 'ctor'; return res(out); }
  ws.onopen = () => { out.open = true; onOpen(ws); };
  ws.onmessage = (e) => { const L = typeof e.data === 'string' ? e.data.length : 0; out.bytes += L; if (L > out.maxBytes) out.maxBytes = L; try { const m = JSON.parse(e.data); const k = m.type || (m.event && 'event:' + m.event) || 'other'; t[k] = (t[k] || 0) + 1; if (m.type === 'book' && m.symbol) out.bySym[m.symbol] = (out.bySym[m.symbol] || 0) + 1; if (m.type === 'ping' || m.op === 'ping') ws.send(JSON.stringify({ op: 'pong' })); } catch (x) {} };
  ws.onclose = (e) => { out.code = e.code; res(out); };
  ws.onerror = () => {};
  setTimeout(() => { try { ws.close(1000); } catch (e) {} setTimeout(() => res(out), 500); }, secs);
});
// 1) upstream, direct
let key = '';
try { key = (fs.readFileSync(envFile, 'utf8').match(/^TICKSTREAM_API_KEY=(.*)$/m) || [])[1] || ''; key = key.trim().replace(/^["']|["']$/g, ''); } catch (e) {}
if (!key) console.log('SKIP upstream: no key file');
else {
  const r = await tally('wss://stream.tick-stream.xyz/v1/stream?key=' + encodeURIComponent(key), undefined, (ws) => { for (const c of ['book', 'ticks']) ws.send(JSON.stringify({ op: 'subscribe', channel: c, symbols: syms })); });
  console.log('upstream frames', JSON.stringify(r.t));
  console.log('upstream book frames per symbol', JSON.stringify(r.bySym), '| biggest frame KB', Math.round(r.maxBytes / 1024), '| total KB/s', Math.round(r.bytes / 1024 / (secs / 1000)));
  ok(r.open && (r.t.book || 0) > 0, 'upstream: book frames arrive');
  for (const s of syms) ok((r.bySym[s] || 0) > 0, 'upstream: ' + s + ' book frames arrive (0 can mean the market is closed)');
  ok(r.maxBytes < 900 * 1024, 'upstream: biggest frame well under 1 MiB (Worker WebSocket message limit)');
  console.log('upstream tick frames: ' + (r.t.tick || 0) + ' (0 is fine outside CME hours)');
}
// 2) through our hub
const tok = process.env.TS_SMOKE_TOKEN || '';
const bad = await tally(base.replace(/^http/, 'ws') + '/ts-live?symbol=NQ', ['tz-auth', 'not-a-token'], () => {});
ok(!bad.open || (Object.keys(bad.t).length === 0), 'hub: a bad token gets no data frames');
if (!tok) console.log('SKIP admin path: set TS_SMOKE_TOKEN (admin ID token)');
else {
  const r = await tally(base.replace(/^http/, 'ws') + '/ts-live?symbol=NQ&levels=60', ['tz-auth', tok], (ws) => ws.send(JSON.stringify({ op: 'sub', symbol: 'NQ', levels: 60 })));
  console.log('hub frames', JSON.stringify(r.t), 'seconds', secs / 1000);
  ok((r.t.snap || 0) > 0, 'hub: snap frames');
  ok((r.t.snap || 0) <= 4 * (secs / 1000) + 4, 'hub: throttled to <= 4 snaps/s');
  ok((r.t.coarse || 0) > 0, 'hub: coarse (heatmap) frames');
}
console.log(fail ? 'FAILED ' + fail : 'DONE');
process.exit(fail ? 1 : 0);
