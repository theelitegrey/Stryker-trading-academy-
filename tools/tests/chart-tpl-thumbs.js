// Regenerates the ready-made template thumbnails: assets/images/templates/<id>.webp (dark) and <id>-light.webp.
// Each template is APPLIED on the recorded NQ test bars (fixtures/orderflow, same rig as chart-tpl-browser.js) and
// the chart cell is screenshotted, then cropped to 16:9 and saved 640x360 webp. GEX tools read the saved GEX
// fixtures (fixtures/gex). Test input, NOT market data: the gallery labels every thumbnail "Sample data".
//   node tools/tests/chart-fixture-server.mjs 8261 any.json        (any.json = {})
//   CHART_BASE=http://127.0.0.1:8261 flock -w 3600 /tmp/stryker-chrome.lock node tools/tests/chart-tpl-thumbs.js [id ...]
// Needs python3 + Pillow for the webp step.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { launch } = require('./lib.js');
const { newCtx, openPage, sleep } = require('./phone-layouts-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8261';
const OUT = path.join(__dirname, '../../assets/images/templates');
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'tplthumb-'));
const FIX = path.join(__dirname, 'fixtures', 'gex');
const LV = { SPX: JSON.parse(fs.readFileSync(path.join(FIX, 'SPX-0.json'))), QQQ: JSON.parse(fs.readFileSync(path.join(FIX, 'QQQ-0.json'))) };
const ONLY = process.argv.slice(2);
const L2_IDS = ['scalp-nq', 'footprint', 'depth-heatmap'];
const L2SRC = fs.readFileSync(path.join(__dirname, 'chart-l2-flow-browser.js'), 'utf8');
const L2_FAKE = L2SRC.slice(L2SRC.indexOf('function fakeWs('), L2SRC.indexOf('\nasync function open('));   // shortcut: copies the test's fake feed by text; move it to a shared module if it ever changes shape
// recorded NQ order flow (the same sessions as the bars), so the order-flow tools draw instead of "Connecting"
const zlib = require('zlib');
const OF = {}; for (const d of ['2026-10-20', '2026-10-21']) OF[d] = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'orderflow', 'NQ-' + d + '.bin.gz')));
const ofHdr = Buffer.from('{"v":1,"sym":"NQ","tick":0.25,"thr":0}'), OF_EMPTY = Buffer.from([0x4f, 0x46, 0x31, 0x0a, ofHdr.length, ...ofHdr, 0]);
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await launch();
  try {
    for (const theme of ['dark', 'light']) {
      const ctx = await newCtx(b, { w: 1180, h: 760 });
      await ctx.addInitScript((th) => {
        try { localStorage.setItem('stryker_theme', th === 'light' ? 'day' : 'night'); } catch (e) {}
        if (th === 'light' && document.documentElement) document.documentElement.setAttribute('data-theme', 'light');
      }, theme);
      await ctx.route(/\/api\/gex\/levels\//, (r) => {
        const name = new URL(r.request().url()).pathname.split('/').pop().toUpperCase();
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LV[name] || LV.QQQ) });
      });
      // order-book tools (L2): the synthetic book feed of chart-l2-flow-browser.js (fakeWs), centred on the fixture's last price
      await ctx.addInitScript('window.__L2MID_INIT = 30069;' + L2_FAKE + ';fakeWs(true);window.__L2MID = 30069;');
      await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/orderflow/, (r) => {
        const d = new URL(r.request().url()).searchParams.get('day');
        r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: OF[d] || OF_EMPTY }).catch(() => {});
      });
      const { p } = await openPage(ctx, BASE, true);
      const ids = await p.evaluate(async () => (await import('/assets/chart-tpl-gallery.js')).TEMPLATES.map((t) => t.id));
      for (const id of ids) {
        if (ONLY.length && !ONLY.includes(id)) continue;
        await p.evaluate(async (id) => {
          const m = await import('/assets/chart-tpl-gallery.js');
          const T = m.TEMPLATES.find((x) => x.id === id);
          // every template draws on the same recorded bars; the symbol is kept on NQ so the fixture always loads
          m.applyTemplate(Object.assign({}, T, { symbol: 'futures:NQ1!' }), { ws: window.STRYKER_VELA, Pine: { clearAllPine() {} }, toast() {} });
        }, id);
        await sleep(L2_IDS.includes(id) ? 12000 : 6000);
        if (id === 'footprint') { await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart, bars = c.orchestrator.rawBars, l = bars[bars.length - 1].time; c.setVisibleRange({ from: l - 14 * 300e3, to: l + 600e3 }); }); await sleep(4000); }
        // the thumbnail is the chart only: no status line / feed badge / data notice / toasts (they would read as live state)
        await p.addStyleTag({ content: '.vela-statusline,.vela-legend,.stk-toast,.stk-toasts,[class*="feed-note"],[class*="datanote"],[class*="stkdn"]{visibility:hidden!important}' });
        await p.evaluate(() => {
          document.querySelectorAll('.stkc-pop:not([hidden])').forEach((x) => x.remove());
          document.querySelectorAll('body *').forEach((n) => { if (n.children.length === 0 && /min delayed|updated .* ago|data agreement|Connecting to|^\s*Live\s*$|Sign in to|Loading|Fresh Volume|options flow/i.test(n.textContent || '')) (n.closest('button,a,[class*="pill"],[class*="note"],[class*="chip"]') || n).style.visibility = 'hidden'; });
        });
        await sleep(300);
        const r = await p.evaluate(() => { const q = document.querySelector('.vela-cell').getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; });
        const w = Math.floor(Math.min(r.w, r.h * 16 / 9)), h = Math.floor(w * 9 / 16);
        const png = path.join(TMP, id + '-' + theme + '.png');
        await p.screenshot({ path: png, clip: { x: r.x, y: r.y, width: w, height: h } });
        const dst = path.join(OUT, id + (theme === 'light' ? '-light' : '') + '.webp');
        execFileSync('python3', ['-c', 'import sys;from PIL import Image;Image.open(sys.argv[1]).convert("RGB").resize((640,360),Image.LANCZOS).save(sys.argv[2],"WEBP",quality=80,method=6)', png, dst]);
        console.log('wrote', path.relative(process.cwd(), dst), fs.statSync(dst).size + ' B');
      }
      await ctx.close();
    }
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
