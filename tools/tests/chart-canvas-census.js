// Canvas census (member GK 18 Nov: two charts + 12 indicators = ~1.65 GB RAM, ~600 MB GPU). Builds the chart-memory-browser.js
// layout (2 charts, the NATIVES mix) and lists every canvas that holds pixels, grouped by its owner (class / nearest id),
// so the biggest backing stores are visible. Read-only probe; prints a table and exits 0.
//   TE_ALLSYM=1 python3 tools/tests/tick-engine-hub.py 8191 &  node tools/tests/chart-dev-server.mjs 8190 &
//   CHART_BASE=http://127.0.0.1:8190 HUB=http://127.0.0.1:8191 NATIVES=... flock /tmp/stryker-chrome.lock node tools/tests/chart-canvas-census.js
const { launch } = require('./lib.js');
const { build } = require('./chart-memory-browser.js');
(async () => {
  const b = await launch();
  const nc = b.newContext.bind(b);   // tag every canvas with where it was made
  b.newContext = async (o) => { const ctx = await nc(o); await ctx.addInitScript(() => { const ce = Document.prototype.createElement; Document.prototype.createElement = function (t) { const el = ce.apply(this, arguments); if (String(t).toLowerCase() === 'canvas') el.__made = (new Error().stack || '').split('\n').slice(2, 6).map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\/assets\//, '').replace(/\?v=\d+/, '')).join(' < '); return el; }; }); return ctx; };
  try {
    const { p, cdp } = await build(b);
    for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage'); await p.waitForTimeout(500); }   // only canvases something still holds
    const stacks = await p.evaluate(() => {   // where the detached ones were made (stack recorded by the init hook below)
      const m = new Map();
      for (const r of window.__cvAll || []) { const c = r.deref(); if (!c || c.isConnected || !(c.__gl || c.__px) || c.width < 100) continue; const k = c.__made || '?'; m.set(k, (m.get(k) || 0) + 1); }
      return [...m];
    });
    for (const [k, n] of stacks) console.log('detached x' + n + ' made at: ' + k);
    const rows = await p.evaluate(() => {
      const out = new Map();
      for (const r of window.__cvAll || []) {
        const c = r.deref(); if (!c || !(c.__gl || c.__px)) continue;
        let el = c, tag = '';
        for (let i = 0; i < 8 && el && !tag; i++, el = el.parentElement) tag = (el.id ? '#' + el.id : '') || (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '');
        const key = (c.__gl ? 'gl ' : '2d ') + (c.isConnected ? '' : '[detached] ') + (tag || '?') + ' ' + c.width + 'x' + c.height + ' css ' + (c.style.width || '-') + (c.style.display === 'none' || (c.isConnected && !c.offsetParent) ? ' hidden' : '');
        const o = out.get(key) || { n: 0, mp: 0 }; o.n++; o.mp += c.width * c.height / 1e6; out.set(key, o);
      }
      return [...out].map(([k, o]) => [k, o.n, Math.round(o.mp * 10) / 10]).sort((a, b) => b[2] - a[2]);
    });
    let tot = 0; for (const [k, n, mp] of rows) { tot += mp; console.log(String(mp).padStart(6) + ' MP  x' + n + '  ' + k); }
    console.log('TOTAL ' + Math.round(tot * 10) / 10 + ' MP');
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
