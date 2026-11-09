// Probe: where the renderer's memory goes (Chrome memory-infra dump, per allocator) + which DOM nodes keep piling up.
//   CHART_BASE=... HUB=... flock /tmp/stryker-chrome.lock node tools/tests/phone-memdump-probe.js [waitSecs]
const { launch } = require('./lib.js');
const { openPhone } = require('./phone-mem-lib.js');
const WAIT = +(process.argv[2] || 40);
async function dump(b) {
  const bs = await b.newBrowserCDPSession();
  const chunks = [];
  bs.on('Tracing.dataCollected', (e) => chunks.push(...e.value));
  const done = new Promise((r) => bs.once('Tracing.tracingComplete', r));
  await bs.send('Tracing.start', { traceConfig: { includedCategories: ['disabled-by-default-memory-infra'], excludedCategories: ['*'], memoryDumpConfig: { triggers: [] } }, transferMode: 'ReportEvents' });
  await new Promise((r) => setTimeout(r, 500));
  await bs.send('Tracing.requestMemoryDump', { deterministic: true, levelOfDetail: 'detailed' });
  await bs.send('Tracing.end'); await done;
  const out = {};
  for (const ev of chunks) {
    if (ev.ph !== 'v' || !ev.args || !ev.args.dumps) continue;
    const ad = ev.args.dumps.allocators || {};
    const pid = ev.pid;
    const top = {};
    for (const [k, v] of Object.entries(ad)) {
      if (k.split('/').length > 2) continue;
      const s = v.attrs && (v.attrs.effective_size || v.attrs.size);
      if (!s) continue;
      top[k] = Math.round(parseInt(s.value, 16) / 1048576 * 10) / 10;
    }
    out[pid] = Object.fromEntries(Object.entries(top).filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]).slice(0, 25));
    if (ev.args.dumps.process_totals) out[pid].__resident = Math.round(parseInt(ev.args.dumps.process_totals.resident_set_bytes || '0', 16) / 1048576);
  }
  await bs.detach().catch(() => {});
  return out;
}
(async () => {
  const b = await launch({ args: ['--enable-precise-memory-info'] });
  try {
    const { p } = await openPhone(b, { base: process.env.CHART_BASE || 'http://127.0.0.1:8460', hub: process.env.HUB || 'http://127.0.0.1:8461', seed: process.env.SEED !== '0', w: +(process.env.W || 390), dpr: +(process.env.DPR || 3) });
    await p.waitForFunction(() => window.__stkFirstCandles && window.__stkHeavyReady, null, { timeout: 120000 });
    await p.waitForTimeout(WAIT * 1000);
    const tally = () => p.evaluate(() => { const m = {}; document.querySelectorAll('*').forEach((n) => { const k = n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/)[0] : '') + ' < ' + (n.parentElement ? (n.parentElement.className && typeof n.parentElement.className === 'string' ? n.parentElement.className.trim().split(/\s+/)[0] : n.parentElement.tagName.toLowerCase()) : ''); m[k] = (m[k] || 0) + 1; }); return m; });
    const a = await tally();
    console.log(JSON.stringify(await dump(b), null, 1));
    await p.waitForTimeout(30000);
    const c = await tally();
    const grew = Object.entries(c).map(([k, v]) => [k, v - (a[k] || 0)]).filter(([, d]) => d > 0).sort((x, y) => y[1] - x[1]).slice(0, 15);
    console.log('DOM growth in 30 s:', JSON.stringify(grew));
    console.log('cells', await p.evaluate(() => ({ dom: document.querySelectorAll('.vela-cell').length, shown: [...document.querySelectorAll('.vela-cell')].filter((x) => x.offsetParent).length, ctx: window.STRYKER_VELA.context().cells.length, layers: (() => { try { return window.STRYKER_VELA.chart.renderer.renderer.extLayers.map((l) => l.def.id); } catch (e) { return String(e); } })() })));
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
