// Dumps the chart's built-in indicator list (every row of the Indicators window's built-in
// groups, with each native's settings schema and defaults) to tools/indicator-pages/registry.json.
// tools/gen-indicator-pages.js reads that file, so the catalogue follows the real chart code.
//   node tools/tests/chart-dev-server.mjs 8047 &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8047 node tools/indicator-pages/dump-registry.js
// Re-run it when a native indicator is added or renamed.
const fs = require('fs');
const path = require('path');
const { launch } = require('../tests/lib.js');
const stub = require('../tests/richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8047';

(async () => {
  const b = await launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(stub);
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
    await p.waitForTimeout(6000);   // late installers (news, tide, flow, offex, footprint)
    const out = await p.evaluate(async () => {
      const ws = window.STRYKER_VELA;
      const rows = ws.active.libraryRows();
      const build = document.querySelector('meta[name=stryker-build]').content;
      const reg = await import('/assets/vendor/vela-0.9.0-s7/chunk-YRCL3WMD.js');
      const txt = (v) => (v && typeof v === 'object' ? (v.fallback || v.defaultMessage || v.text || v.message || JSON.stringify(v)) : v);
      const schemaOf = (type) => {
        const d = reg.nativeIndicatorEntry(type);
        if (!d) return null;
        let inputs = [];
        try { inputs = (d.inputsSchema ? d.inputsSchema() : []) || []; } catch (e) {}
        let defs = {};
        try { defs = d.defaultInputs ? d.defaultInputs() : {}; } catch (e) {}
        return { title: txt(d.title), short: txt(d.shortTitle), overlay: !!d.overlay, pane: d.paneHint,
          inputs: inputs.filter((i) => i && i.key).map((i) => ({ key: i.key, type: i.type, title: txt(i.title || i.label || i.name),
            tooltip: txt(i.tooltip), def: defs[i.key] !== undefined ? defs[i.key] : i.defval, options: (i.options || []).map((o) => (o && typeof o === 'object' ? txt(o.title || o.label || o.value) : o)).slice(0, 20),
            group: txt(i.group) })) };
      };
      // The Indicators window as members see it: Technicals (grouped), Order Flow, TradeZoro, Top.
      const iw = window.StrykerIndicatorWindow;
      iw.open(); await new Promise((r) => setTimeout(r, 800));
      const tab = async (k) => { document.querySelector('.stkiw-tab[data-k="' + k + '"]').click(); await new Promise((r) => setTimeout(r, 500)); };
      const scrape = (fixed) => { let grp = fixed || null; const out = [];
        document.querySelectorAll('.stkiw-list > *').forEach((n) => {
          if (n.classList.contains('stkiw-grp')) grp = n.textContent.trim();
          else if (n.classList.contains('stkiw-row')) out.push({ key: n.getAttribute('data-key'), name: (n.querySelector('.stkiw-nm') || {}).textContent, author: (n.querySelector('.stkiw-auth') || {}).textContent,
            desc: ((n.querySelector('.stkiw-desc') || {}).textContent) || '', third: !!n.querySelector('.is-third'), beta: /\bbeta\b/.test((n.querySelector('.stkiw-name') || {}).textContent || ''), grp: fixed || grp });
        }); return out; };
      const window_ = {};
      await tab('tech'); window_.tech = scrape();
      await tab('orderflow'); window_.orderflow = scrape('Order Flow');
      await tab('stryker'); window_.stryker = scrape('TradeZoro');
      await tab('top'); window_.top = scrape('Community');
      iw.close();
      return { build, window: window_, rows: rows.filter((r) => r && r.category !== 'Community').map((r) => Object.assign({ name: r.name, category: r.category, native: !!r.native, nativeType: r.nativeType || null,
        pseudo: r.pseudo || null, beta: !!r.beta, hidden: !!r.hidden }, r.native ? { schema: schemaOf(r.nativeType) } : {})) };
    });
    const file = path.join(__dirname, 'registry.json');
    fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
    console.log('rows', out.rows.length, '->', file);
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
