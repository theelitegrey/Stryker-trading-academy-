// Smoke: GEX page heatmap tab on the REAL book-recorder history (live Worker), local page.
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8091 node --max-old-space-size=768 tools/tests/gex-heatmap-live-smoke.js <shotsDir>
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const path = require('path');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8091';
const OUT = process.argv[2] || '/tmp';
(async () => {
  const b = await launch();
  let fail = 0;
  try {
    for (const [w, h, mob] of [[1280, 860, false], [390, 844, true]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mob ? 2 : 1, isMobile: mob, hasTouch: mob });
      await ctx.addInitScript(stub);
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
      // the recorder allows only our two origins: present the request as strykertrading.com
      await ctx.route(/book-recorder\.theelitegrey\.workers\.dev/, async (r) => {
        const res = await fetch(r.request().url(), { headers: { origin: 'https://strykertrading.com' } });
        r.fulfill({ status: res.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await res.text() });
      });
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(BASE + '/gex.html', { waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 4000));
      await p.click('.gex-dte[data-d="0"]');
      await p.click('.gex-vtab[data-view="heat"]');
      const ok = await p.waitForFunction(() => { const s = window.strykerGexHeatmap.state; return s.heat && s.rows.length > 0; }, null, { timeout: 20000 }).then(() => true, () => false);
      const info = await p.evaluate(() => { const s = window.strykerGexHeatmap.state; return { n: s.rows.length, day: s.day, status: document.getElementById('gex-heat-status').innerText, ms: document.getElementById('gex-heat-canvas').dataset.ms }; });
      console.log((ok && !errors.length ? 'PASS ' : 'FAIL ') + w + ' real history: ' + JSON.stringify(info) + ' errors=' + errors.length);
      if (!ok || errors.length) fail++;
      await p.evaluate(() => { const c = document.getElementById('gex-view-tabs'); window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - (window.innerWidth < 700 ? 64 : 84)); });
      await new Promise((r) => setTimeout(r, 400));
      await p.screenshot({ path: path.join(OUT, 'gex-heatmap-real-' + w + '.png') });
      console.log('shot', path.join(OUT, 'gex-heatmap-real-' + w + '.png'));
      await ctx.close();
    }
  } finally { await b.close(); }
  process.exit(fail ? 1 : 0);
})();
