// Probe: heap snapshot of the page and of the Pine worker, summarised by constructor (self size, count), plus
// detached DOM nodes. Answers "what is in the 130 MB".
//   CHART_BASE=... HUB=... flock /tmp/stryker-chrome.lock node tools/tests/phone-heap-probe.js [waitSecs] [page|worker|both]
const { launch } = require('./lib.js');
const { openPhone } = require('./phone-mem-lib.js');
const WAIT = +(process.argv[2] || 30), WHICH = process.argv[3] || 'both';

function summarise(json, label) {
  const s = JSON.parse(json);
  const m = s.snapshot.meta, nf = m.node_fields, nt = m.node_types[0], N = nf.length;
  const iT = nf.indexOf('type'), iN = nf.indexOf('name'), iS = nf.indexOf('self_size');
  const by = new Map(); let tot = 0, det = 0, detN = 0;
  for (let i = 0; i < s.nodes.length; i += N) {
    const type = nt[s.nodes[i + iT]], name = s.strings[s.nodes[i + iN]], sz = s.nodes[i + iS];
    tot += sz;
    const k = type === 'object' || type === 'native' ? name.slice(0, 60) : '(' + type + ')';
    if (/^Detached /.test(name)) { det += sz; detN++; }
    const e = by.get(k) || [0, 0]; e[0] += sz; e[1]++; by.set(k, e);
  }
  console.log('==', label, 'total self MB', (tot / 1048576).toFixed(1), 'detached nodes', detN, (det / 1048576).toFixed(2), 'MB');
  [...by.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, 30).forEach(([k, [sz, n]]) => console.log('  ', (sz / 1048576).toFixed(2).padStart(7), 'MB', String(n).padStart(8), k));
  // objects grouped by their property names (shape), and arrays by length bucket + owner property
  const ef = m.edge_fields, et = m.edge_types[0], E = ef.length, iEC = nf.indexOf('edge_count'), iET = ef.indexOf('type'), iEN = ef.indexOf('name_or_index'), iTo = ef.indexOf('to_node');
  const shapes = new Map(), arrOwner = new Map(); let e = 0;
  for (let i = 0; i < s.nodes.length; i += N) {
    const cnt = s.nodes[i + iEC], type = nt[s.nodes[i + iT]], name = s.strings[s.nodes[i + iN]];
    const props = [];
    for (let k = 0; k < cnt; k++) {
      const eo = (e + k) * E, t = et[s.edges[eo + iET]];
      if (t === 'property' && props.length < 6) props.push(s.strings[s.edges[eo + iEN]]);
      if (t === 'property' || t === 'element') {
        const to = s.edges[eo + iTo], tt = nt[s.nodes[to + iT]];
        if (tt === 'array') { const pn = t === 'property' ? s.strings[s.edges[eo + iEN]] : '[i]'; const key = name.slice(0, 20) + '.' + pn; const v = arrOwner.get(key) || [0, 0]; v[0] += s.nodes[to + iS]; v[1]++; arrOwner.set(key, v); }
      }
    }
    e += cnt;
    if (type === 'object' && props.length) { const k = name.slice(0, 16) + '{' + props.join(',') + '}'; const v = shapes.get(k) || [0, 0]; v[0] += s.nodes[i + iS]; v[1]++; shapes.set(k, v); }
  }
  console.log('   top object shapes:'); [...shapes.entries()].sort((a, b) => b[1][1] - a[1][1]).slice(0, 15).forEach(([k, [sz, n]]) => console.log('     ', String(n).padStart(8), (sz / 1048576).toFixed(1).padStart(6), 'MB', k.slice(0, 110)));
  // retained-ish size of each JS Array = its own size + its elements backing store; then grouped by the property that holds it
  const firstEdge = new Uint32Array(s.nodes.length / N + 1); { let ee = 0; for (let i = 0, j = 0; i < s.nodes.length; i += N, j++) { firstEdge[j] = ee; ee += s.nodes[i + iEC]; } }
  const arrSz = new Map();
  for (let i = 0, j = 0; i < s.nodes.length; i += N, j++) {
    if (nt[s.nodes[i + iT]] !== 'object' || s.strings[s.nodes[i + iN]] !== 'Array') continue;
    let sz = s.nodes[i + iS];
    for (let k = 0; k < s.nodes[i + iEC]; k++) { const eo = (firstEdge[j] + k) * E; if (et[s.edges[eo + iET]] === 'internal' && s.strings[s.edges[eo + iEN]] === 'elements') sz += s.nodes[s.edges[eo + iTo] + iS]; }
    arrSz.set(i, sz);
  }
  for (let i = 0, j = 0; i < s.nodes.length; i += N, j++) {
    const name = s.strings[s.nodes[i + iN]];
    for (let k = 0; k < s.nodes[i + iEC]; k++) {
      const eo = (firstEdge[j] + k) * E, t = et[s.edges[eo + iET]];
      if (t !== 'property') continue;
      const to = s.edges[eo + iTo], sz = arrSz.get(to);
      if (!sz) continue;
      const key = name.slice(0, 20) + '.' + String(s.strings[s.edges[eo + iEN]]).replace(/^glb\d+_/, 'glb_').slice(0, 30);
      const v = arrOwner.get(key) || [0, 0]; v[0] += sz; v[1]++; arrOwner.set(key, v);
    }
  }
  console.log('   arrays by owner.property:'); [...arrOwner.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, 25).forEach(([k, [sz, n]]) => console.log('     ', String(n).padStart(8), (sz / 1048576).toFixed(1).padStart(6), 'MB', k));
  const dn = [...by.entries()].filter(([k]) => /^Detached /.test(k)).sort((a, b) => b[1][1] - a[1][1]).slice(0, 10);
  if (dn.length) console.log('   detached by kind:', JSON.stringify(dn.map(([k, [, n]]) => [k, n])));
}

async function snap(send, on, off) {
  const chunks = [];
  const h = (e) => chunks.push(e.chunk);
  on('HeapProfiler.addHeapSnapshotChunk', h);
  await send('HeapProfiler.enable');
  await send('HeapProfiler.collectGarbage');
  await send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  off('HeapProfiler.addHeapSnapshotChunk', h);
  return chunks.join('');
}

(async () => {
  const b = await launch();
  try {
    const { p, cdp } = await openPhone(b, { base: process.env.CHART_BASE || 'http://127.0.0.1:8460', hub: process.env.HUB || 'http://127.0.0.1:8461', seed: process.env.SEED !== '0' });
    await p.waitForFunction(() => window.__stkFirstCandles && window.__stkHeavyReady, null, { timeout: 120000 });
    await p.waitForTimeout(WAIT * 1000);
    if (WHICH !== 'worker') summarise(await snap((m, a) => cdp.send(m, a), (e, f) => cdp.on(e, f), (e, f) => cdp.off(e, f)), 'page');
    if (WHICH !== 'page') {
      const bs = await b.newBrowserCDPSession();
      const { targetInfos } = await bs.send('Target.getTargets');
      const t = targetInfos.find((x) => x.type === 'worker' && /pine-next-worker/.test(x.url));
      const { sessionId } = await bs.send('Target.attachToTarget', { targetId: t.targetId, flatten: false });
      let id = 0; const waits = new Map(), evs = new Map();
      bs.on('Target.receivedMessageFromTarget', (e) => { if (e.sessionId !== sessionId) return; const m = JSON.parse(e.message); if (m.id && waits.has(m.id)) { waits.get(m.id)(m.result); waits.delete(m.id); } else if (m.method && evs.has(m.method)) evs.get(m.method).forEach((f) => f(m.params)); });
      const send = (method, params) => new Promise((res) => { const i = ++id; waits.set(i, res); bs.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: i, method, params: params || {} }) }); });
      const on = (e, f) => { if (!evs.has(e)) evs.set(e, new Set()); evs.get(e).add(f); }, off = (e, f) => evs.get(e) && evs.get(e).delete(f);
      summarise(await snap(send, on, off), 'pine worker');
    }
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
