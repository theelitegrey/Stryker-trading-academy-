// Probe for the homepage stat strip (not part of check.py): opens charts.html on the local chart dev server and
// prints what the chart itself offers: the Indicators window's built-in rows and the symbol-search pool by type.
//   node tools/tests/chart-dev-server.mjs 8047 &
//   tools/chrome-slot.sh env CHART_BASE=http://127.0.0.1:8047 node tools/tests/home-stats-probe.js
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8047';
(async () => {
  const b = await launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(stub);
    const p = await ctx.newPage();
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 90000 });
    await p.mouse.click(5, 450);   // releases the late symbol lists (vela-chart.js lateLists)
    await p.waitForTimeout(25000);
    const out = await p.evaluate(async () => {
      const ws = window.STRYKER_VELA;
      const core = await import('/assets/chart-search-core.js');
      const raw = ws.feed.symbols() || [];
      const seen = new Set(), by = {}, venue = {};
      for (const d of raw) {
        if (!d || !d.ticker || d.provider === 'formula') continue;
        const k = core.keyOf(core.symOf(d)); if (seen.has(k)) continue; seen.add(k);
        const c = core.classify(d); by[c] = (by[c] || 0) + 1;
        const v = core.venueOf(d); venue[v] = (venue[v] || 0) + 1;
      }
      const rows = ws.active.libraryRows().filter((r) => r && r.category !== 'Community');
      return { pool: seen.size, by, venue, libRows: rows.length, libVisible: rows.filter((r) => !r.hidden).length };
    });
    console.log(JSON.stringify(out, null, 1));
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
