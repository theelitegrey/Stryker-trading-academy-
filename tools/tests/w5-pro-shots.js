// /pro rich page: shots at 390/412/1440 dark+light, overflow, touch tabs + rail, weight. node tools/tests/w5-pro-shots.js <outDir>
const { launch } = require('./lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8055', OUT = process.argv[2] || '/tmp/w5s/pro';
require('fs').mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await launch();
  try {
    for (const [w, h, mobile] of [[390, 844, true], [412, 915, true], [1440, 900, false]]) for (const th of ['dark', 'light']) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
      await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_cookie_ok', '1'); } catch (e) {} }, th);
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
      const p = await ctx.newPage(); const errs = []; let bytes = 0;
      p.on('pageerror', (e) => errs.push(String(e)));
      p.on('response', async (r) => { try { const l = r.headers()['content-length']; if (l) bytes += +l; } catch (e) {} });
      await p.goto(BASE + '/pro.html', { waitUntil: 'load' }); await sleep(1500);
      await p.addStyleTag({ content: '.tzc{display:none!important} html{scroll-behavior:auto!important}' });
      const first = Math.round(bytes / 1024);
      const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      // scroll through to trigger reveals + lazy images
      const H = await p.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < H; y += 500) { await p.evaluate((y) => scrollTo(0, y), y); await sleep(120); }
      await sleep(600);
      const secs = await p.evaluate(() => ['toolkit', 'g-flow', 'g-book', 'g-tape', 'g-gex', 'g-replay', 'g-soon', 'compare', 'faq'].map((i) => { const e = document.getElementById(i); return e ? Math.round(e.getBoundingClientRect().top + scrollY) : null; }));
      const broken = await p.evaluate(() => [...document.images].filter((i) => i.complete && !i.naturalWidth).map((i) => i.src));
      console.log(w, th, 'firstload KB', first, 'scrollW', sw.join('/'), 'errors', errs.length, errs.slice(0, 2), 'broken', broken);
      await p.evaluate(() => scrollTo(0, 0)); await sleep(500);
      await p.screenshot({ path: `${OUT}/hero-${w}-${th}.png` });
      const ids = ['toolkit', 'g-flow', 'g-book', 'g-gex', 'g-soon', 'compare', 'faq'];
      for (const id of ids) {
        await p.evaluate((id) => { const e = document.getElementById(id); scrollTo(0, e.getBoundingClientRect().top + scrollY - 70); }, id); await sleep(700);
        await p.screenshot({ path: `${OUT}/${id}-${w}-${th}.png` });
      }
      await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await sleep(700);
      await p.screenshot({ path: `${OUT}/end-${w}-${th}.png` });
      if (mobile && th === 'dark' && w === 390) {
        // touch tests: tab tap, rail swipe
        await p.evaluate(() => { const e = document.querySelector('#g-book .pp-dev'); scrollTo(0, e.getBoundingClientRect().top + scrollY - 200); }); await sleep(600);
        await p.evaluate(() => { const e = document.getElementById('g-book-t1'); scrollTo(0, e.getBoundingClientRect().top + scrollY - 400); }); await sleep(400); const t1 = await p.$('#g-book-t1'); const bb = await t1.boundingBox(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(500);
        console.log('URL', p.url(), bb); console.log('TOUCH tab2 selected', await p.evaluate(() => [document.getElementById('g-book-t1').getAttribute('aria-selected'), document.getElementById('g-book-p1').hidden, document.getElementById('g-book-p0').hidden]), 'tab size', Math.round(bb.height));
        await p.screenshot({ path: `${OUT}/tab-390.png` });
        await p.evaluate(() => { const e = document.getElementById('pp-soon'); scrollTo(0, e.getBoundingClientRect().top + scrollY - 250); }); await sleep(500);
        const r = await p.$('#pp-soon'); const rb = await r.boundingBox();
        const cdp = await ctx.newCDPSession(p);
        const y0 = Math.max(40, Math.min(800, rb.y + 60)); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 330, y: y0 }] }); for (let k = 1; k <= 10; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 330 - k * 25, y: y0 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(900);
        console.log('TOUCH rail scrollLeft', await p.evaluate(() => document.getElementById('pp-soon').scrollLeft), 'bodyOverflow', await p.evaluate(() => document.documentElement.scrollWidth));
        await p.screenshot({ path: `${OUT}/rail-390.png` });
      }
      await ctx.close();
    }
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
