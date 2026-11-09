// Probe: WHO keeps an old (stopped) Pine run alive in the worker after a scroll-back. Tags every 1m run context with
// at most STALE bars (default 3000 = the first load's run) with a StaleMark object, takes a heap snapshot of the
// worker to a file (it is >1 GB, so it is parsed from a Buffer, not as one JSON string), then prints the retainer
// path from the GC root to each StaleMark.
//   SCROLL=19000 CHART_BASE=... HUB=... flock /tmp/stryker-chrome.lock node --max-old-space-size=9000 tools/tests/phone-retainer-probe.js
const fs = require('fs');
const { launch } = require('./lib.js');
const { openPhone } = require('./phone-mem-lib.js');
const TARGET = +(process.env.SCROLL || 19000), STALE = +(process.env.STALE || 3000), FILE = process.env.SNAP || '/tmp/w3-worker.heapsnapshot';

function parseSnapshot(buf) {
  const find = (s, from) => { const i = buf.indexOf(s, from || 0); if (i < 0) throw new Error('no ' + s); return i + s.length; };
  const ints = (start) => { const out = []; let v = 0, inNum = false, i = start; for (; ; i++) { const c = buf[i]; if (c >= 48 && c <= 57) { v = v * 10 + (c - 48); inNum = true; } else { if (inNum) { out.push(v); v = 0; inNum = false; } if (c === 93) break; } } return Uint32Array.from(out); };
  const metaEnd = find('"nodes":[');
  const head = buf.slice(0, metaEnd - '"nodes":['.length).toString().replace(/,\s*$/, '') + '}';
  const meta = JSON.parse(head.replace(/^\{"snapshot":/, '{"snapshot":')).snapshot.meta;
  const nodes = ints(metaEnd);
  const edges = ints(find('"edges":['));
  const sStart = find('"strings":[') - 1;
  let depth = 0, i = sStart, q = false;
  for (; i < buf.length; i++) { const c = buf[i]; if (q) { if (c === 92) i++; else if (c === 34) q = false; continue; } if (c === 34) q = true; else if (c === 91) depth++; else if (c === 93) { depth--; if (!depth) break; } }
  const strings = JSON.parse(buf.slice(sStart, i + 1).toString());
  return { meta, nodes, edges, strings };
}

(async () => {
  const b = await launch();
  let tagged = '';
  try {
    const { p } = await openPhone(b, { base: process.env.CHART_BASE || 'http://127.0.0.1:8460', hub: process.env.HUB || 'http://127.0.0.1:8461' });
    await p.waitForFunction(() => window.__stkFirstCandles && window.__stkHeavyReady && !document.documentElement.classList.contains('stk-pine-busy'), null, { timeout: 180000, polling: 250 });
    await p.waitForFunction(() => { try { return window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.chart).length >= 2; } catch (e) { return false; } }, null, { timeout: 120000 });
    await p.waitForTimeout(4000);
    await p.waitForFunction(() => !document.documentElement.classList.contains('stk-pine-busy'), null, { timeout: 120000, polling: 500 });
    const bs = await b.newBrowserCDPSession();
    let t;
    for (let i = 0; i < 40 && !t; i++) { const { targetInfos } = await bs.send('Target.getTargets'); t = targetInfos.find((x) => x.type === 'worker' && /pine-next-worker/.test(x.url)); if (!t) await p.waitForTimeout(500); }
    const { sessionId } = await bs.send('Target.attachToTarget', { targetId: t.targetId, flatten: false });
    let id = 0; const waits = new Map(), evs = new Map();
    bs.on('Target.receivedMessageFromTarget', (e) => { if (e.sessionId !== sessionId) return; const m = JSON.parse(e.message); if (m.id && waits.has(m.id)) { waits.get(m.id)(m.result || m.error); waits.delete(m.id); } else if (m.method && evs.has(m.method)) evs.get(m.method)(m.params); });
    const send = (method, params) => new Promise((res) => { const i = ++id; waits.set(i, res); bs.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: i, method, params: params || {} }) }); });
    let n = 0;
    for (let i = 0; i < 80; i++) {
      n = await p.evaluate(() => { const c = window.STRYKER_VELA.chart, b = c.orchestrator.rawBars, v = c.getVisibleRange(); c.setVisibleRange({ from: b[0].time, to: b[0].time + (v.to - v.from) }); return b.length; });
      if (n >= TARGET) break;
      await p.waitForTimeout(1500);
    }
    await p.waitForTimeout(1500);
    await p.waitForFunction(() => !document.documentElement.classList.contains('stk-pine-busy'), null, { timeout: 240000, polling: 500 }).catch(() => {});
    await p.waitForTimeout(8000);
    await send('HeapProfiler.collectGarbage');
    const proto = await send('Runtime.evaluate', { expression: "import('https://cdn.jsdelivr.net/npm/pinets@0.11.0/dist/pinets.min.browser.es.js').then((m) => m.Context.prototype)", awaitPromise: true });
    const q = await send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId });
    const r = await send('Runtime.callFunctionOn', { objectId: q.objects.objectId, returnByValue: true, functionDeclaration: `function(){
      class StaleMark {}
      const roots = new Set(this.map((c) => c.fullContext || c));
      const out = [];
      for (const c of roots) { if (c.timeframe !== '1' || !c.data || !c.data.close) continue; const len = c.data.close.data.length; if (len > 100 && len <= ${STALE}) { c.__staleMark = new StaleMark(); out.push(len); } }
      return JSON.stringify(out);
    }` });
    tagged = r.result.value;
    console.log('bars', n, 'tagged', tagged);
    if (tagged === '[]') return;
    const ws = fs.createWriteStream(FILE);
    evs.set('HeapProfiler.addHeapSnapshotChunk', (pr) => ws.write(pr.chunk));
    await send('HeapProfiler.enable');
    await send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    await new Promise((res) => ws.end(res));
  } finally { await b.close(); }
  if (tagged === '[]') return;
  const s = parseSnapshot(fs.readFileSync(FILE));
  fs.unlinkSync(FILE);
  const m = s.meta, nf = m.node_fields, N = nf.length, ef = m.edge_fields, E = ef.length, nt = m.node_types[0], et = m.edge_types[0];
  const iT = nf.indexOf('type'), iN = nf.indexOf('name'), iEC = nf.indexOf('edge_count'), iET = ef.indexOf('type'), iEN = ef.indexOf('name_or_index'), iTo = ef.indexOf('to_node');
  const cnt = s.nodes.length / N, first = new Uint32Array(cnt + 1);
  for (let i = 0, e = 0; i < cnt; i++) { first[i] = e; e += s.nodes[i * N + iEC]; }
  first[cnt] = s.edges.length / E;
  const rc = new Uint32Array(cnt + 1);
  for (let e = 0; e < s.edges.length; e += E) rc[s.edges[e + iTo] / N]++;
  const rs = new Uint32Array(cnt + 1); for (let i = 0, a = 0; i <= cnt; i++) { rs[i] = a; a += rc[i]; }
  const rFrom = new Uint32Array(s.edges.length / E), rEdge = new Uint32Array(s.edges.length / E), fill = rs.slice();
  for (let i = 0; i < cnt; i++) for (let e = first[i]; e < first[i + 1]; e++) { const to = s.edges[e * E + iTo] / N; rFrom[fill[to]] = i; rEdge[fill[to]] = e; fill[to]++; }
  const name = (i) => s.strings[s.nodes[i * N + iN]], type = (i) => nt[s.nodes[i * N + iT]];
  const eType = (e) => et[s.edges[e * E + iET]];
  const eName = (e) => { const t = eType(e), v = s.edges[e * E + iEN]; return (t === 'element' || t === 'hidden') ? '[' + v + ']' : (s.strings[v] !== undefined ? s.strings[v] : String(v)); };
  const marks = []; for (let i = 0; i < cnt; i++) if (type(i) === 'object' && name(i) === 'StaleMark') marks.push(i);
  console.log('StaleMark objects', marks.length);
  for (const mk of marks.slice(0, 3)) {
    const prev = new Int32Array(cnt).fill(-1), pe = new Int32Array(cnt).fill(-1); const qq = [mk]; prev[mk] = mk; let hit = -1, h = 0;
    while (h < qq.length && hit < 0) { const x = qq[h++]; for (let k = rs[x]; k < rs[x + 1]; k++) { const f = rFrom[k], e = rEdge[k]; if (eType(e) === 'weak' || prev[f] >= 0) continue; prev[f] = x; pe[f] = e; if (f === 0) { hit = f; break; } qq.push(f); } }
    const path = []; for (let x = hit; x >= 0 && x !== mk; x = prev[x]) path.push(`${type(x)}:${name(x).slice(0, 60)} -${eName(pe[x])}->`);
    console.log('PATH', hit < 0 ? '(none)' : path.join('\n   '));
  }
})().catch((e) => { console.error(e); process.exit(2); });
