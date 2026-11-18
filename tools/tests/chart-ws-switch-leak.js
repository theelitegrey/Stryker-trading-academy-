// Workspace switching must not leak (member GK 18 Nov: RAM/GPU higher than a few days ago; workspaces-as-tabs landed 14-17 Nov).
// Builds the chart-memory-browser.js layout (2 charts, NATIVES mix), makes a second workspace, then switches back and forth
// ROUNDS times. After a forced GC it compares live canvases (pixels held), GL contexts, DOM nodes / listeners and JS heap to
// the first round. FAILS when the held canvas pixels, GL contexts or listeners keep growing with the number of switches.
//   TE_ALLSYM=1 python3 tools/tests/tick-engine-hub.py 8191 &  node tools/tests/chart-dev-server.mjs 8190 &
// env: ROUNDS (8), SNAP (dir: heap snapshots after the first and last round, for retainer paths)
//   CHART_BASE=http://127.0.0.1:8190 HUB=http://127.0.0.1:8191 flock /tmp/stryker-chrome.lock node tools/tests/chart-ws-switch-leak.js
const { launch } = require('./lib.js');
const { build, snapshot } = require('./chart-memory-browser.js');
const { measure } = require('./phone-mem-lib.js');
const ROUNDS = +(process.env.ROUNDS || 8);
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const held = (p) => p.evaluate(() => {
  let mp = 0, gl = 0, n = 0, det = 0;
  for (const r of window.__cvAll || []) { const c = r.deref(); if (!c || !(c.__gl || c.__px)) continue; n++; mp += c.width * c.height / 1e6; if (c.__gl) gl++; if (!c.isConnected) det++; }
  return { n, det, gl, mp: Math.round(mp * 10) / 10 };
});
async function sample(b, p, cdp) {
  for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage'); await p.waitForTimeout(300); }
  const dom = await cdp.send('Memory.getDOMCounters'), heap = await cdp.send('Runtime.getHeapUsage');
  let rssMB = null; try { const m = await measure(b, p, cdp, process.pid); rssMB = Math.round((m.rss.renderer + m.rss.gpu) / 1024); } catch (e) {}
  return { cv: await held(p), nodes: dom.nodes, listeners: dom.jsEventListeners, heapMB: Math.round(heap.usedSize / 1048576 * 10) / 10, rssMB };
}
(async () => {
  const b = await launch();
  try {
    const { p, cdp, errors } = await build(b);
    const W = () => p.evaluate(() => window.STRYKER_WORKSPACES && window.STRYKER_WORKSPACES.index);
    const ix0 = await W(); check(!!ix0, 'workspaces api present');
    const a = ix0.active;
    await p.evaluate(() => window.STRYKER_WORKSPACES.createNew && window.STRYKER_WORKSPACES.createNew('Leak B'));
    await p.waitForTimeout(4000);
    const ix1 = await W(), bId = ix1.items.map((x) => x.id).find((id) => id !== a);
    check(!!bId, 'second workspace made (' + ix1.items.length + ')');
    const go = async (id) => { await p.evaluate((id) => window.STRYKER_WORKSPACES.switchTo(id), id); for (let i = 0; i < 60; i++) { await p.waitForTimeout(250); if (!(await p.evaluate(() => window.STRYKER_WORKSPACES.busy))) break; } await p.waitForTimeout(2500); };
    const s = [];
    for (let r = 0; r < ROUNDS; r++) {
      await go(bId); await go(a);
      if (r === 0 || r === ROUNDS - 1) { const m = await sample(b, p, cdp); if (process.env.SNAP) await snapshot(cdp, process.env.SNAP + '/ws-r' + (r + 1) + '.heapsnapshot'); m.round = r + 1; s.push(m); console.log('after ' + (r + 1) + ' round trips: ' + JSON.stringify(m)); }
    }
    const [f, l] = [s[0], s[s.length - 1]];
    check(l.cv.mp <= f.cv.mp + 2, `canvas pixels held ${f.cv.mp} -> ${l.cv.mp} MP over ${ROUNDS - 1} more round trips`);
    check(l.cv.gl <= f.cv.gl, `GL contexts ${f.cv.gl} -> ${l.cv.gl}`);
    check(l.listeners <= f.listeners * 1.05 + 20, `listeners ${f.listeners} -> ${l.listeners}`);
    check(l.heapMB <= f.heapMB + 15, `page heap ${f.heapMB} -> ${l.heapMB} MB`);
    check(!errors.length, 'no page errors ' + errors.slice(0, 3).join(' | '));
  } finally { await b.close(); }
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
