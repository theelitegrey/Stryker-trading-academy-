// Market pages visual test + shots. usage: node market-visual-browser.js <tag> [page] [outDir]; serve repo root on MV_BASE; 4 pages x 390/1440 x dark/light
const fs = require('fs');
const zlib = require('zlib');
const R = require('path').resolve(__dirname, '..', '..');
const { launch } = require(R + '/tools/tests/lib.js');
const stub = require(R + '/tools/tests/richstub.js');
const tag = process.argv[2] || 'x', only = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3] : null;
const OUT = process.argv[4] || '/tmp';
const FIX = R + '/tools/tests/fixtures/scan';
const fresh = (n) => { const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(FIX + '/' + n + '.json.gz'))); d.t = Math.floor(Date.now() / 1000) - 120; return zlib.gzipSync(JSON.stringify(d)); };
const PARTS = { presets: fresh('presets'), stock: fresh('stock'), crypto: fresh('crypto') };
const pages = { brief: 'market-brief.html', scanner: 'scanner.html', map: 'market-map.html', cal: 'economic-calendar.html' };
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=512'] });
  const res = [];
  for (const [k, f] of Object.entries(pages)) {
    if (only && only !== k) continue;
    for (const w of [390, 1440]) for (const th of ['dark', 'light']) {
      const ctx = await b.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, isMobile: w < 500, hasTouch: w < 500 });
      await ctx.addInitScript(stub);
      await ctx.addInitScript((th) => { try { localStorage.setItem('stryker_theme', th === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} Object.defineProperty(window, 'strykerPlanTier', { configurable: false, get: () => () => Promise.resolve({ free: false }), set() {} }); }, th);
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => {
        const u = r.request().url();
        if (/book-recorder.*\/scan/.test(u)) { const part = new URL(u).searchParams.get('part'); const x = PARTS[part]; if (!x) return r.fulfill({ status: 404, body: 'no' }); return r.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'x-scan-gzip': '1', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-scan-gzip' }, body: x }); }
        r.abort();
      });
      const p = await ctx.newPage(); const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|ERR_BLOCKED|net::/.test(m.text())) errs.push('c:' + m.text()); });
      await p.goto((process.env.MV_BASE || 'http://127.0.0.1:8088') + '/' + f, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(2500);
      await p.evaluate(() => { document.querySelectorAll('.gate-pending').forEach((e) => e.classList.remove('gate-pending')); document.querySelectorAll('.stk-rise').forEach((e) => e.classList.add('is-in')); });
      await p.waitForTimeout(900);
      const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await p.screenshot({ path: `${OUT}/${tag}-${k}-${w}-${th}.png`, fullPage: true });
      let extra = '';
      const tapSel = k === 'map' ? '[data-mmtile]' : k === 'scanner' ? '.mv-tile[data-row]' : null;
      if (k === 'scanner') { extra += ' views=' + (await p.evaluate(() => document.querySelectorAll('[data-view]').length)); }
      if (tapSel) {
        await p.evaluate((s) => { const t = document.querySelector(s); t && t.scrollIntoView({ block: 'center' }); }, tapSel);
        const bx = await p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, tapSel);
        if (w < 500) await p.touchscreen.tap(bx[0], bx[1]); else await p.mouse.click(bx[0], bx[1]);
        await p.waitForTimeout(600);
        const sh = await p.evaluate(() => { const e = document.querySelector('.mv-sheet, .scn-sheet'); if (!e) return null; const r = e.getBoundingClientRect(); return { w: r.width, bottom: r.bottom, vh: innerHeight, vw: innerWidth, left: r.left, right: r.right }; });
        extra += ' sheet=' + JSON.stringify(sh);
        await p.screenshot({ path: `${OUT}/${tag}-${k}-${w}-${th}-sheet.png` });
        await p.keyboard.press('Escape');
        await p.evaluate(() => { document.querySelectorAll('.mv-sheet-wrap,.scn-sheet-wrap').forEach((e) => e.remove()); });
      }
      if (k === 'scanner') { await p.evaluate(() => document.querySelector('[data-view="cards"]').click()); await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${tag}-${k}-${w}-${th}-cards.png` }); extra += ' cardsOv=' + (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)); await p.evaluate(() => document.querySelector('[data-view="list"]').click()); await p.waitForTimeout(400); extra += ' listRows=' + (await p.evaluate(() => document.querySelectorAll('.scn-table tbody tr').length)); extra += ' listOv=' + (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)); }
      if (k === 'map') { await p.evaluate(() => window.dispatchEvent(new Event('stryker:theme'))); await p.waitForTimeout(300); extra += ' tiles=' + (await p.evaluate(() => document.querySelectorAll('.mv-tile').length)); }
      if (k === 'brief') extra += ' ladders=' + (await p.evaluate(() => document.querySelectorAll('.mv-lad').length)) + ' details=' + (await p.evaluate(() => document.querySelectorAll('.mv-det').length)) + ' stale=' + (await p.evaluate(() => !!document.querySelector('.mb-stale')));
      res.push(`${k} ${w} ${th} overflow=${ov}${extra} errs=${errs.join('|').slice(0, 200)}`);
      await ctx.close();
    }
  }
  await b.close(); console.log(res.join('\n'));
})();
