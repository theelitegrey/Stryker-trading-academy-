// /download page: full-page shots + alignment gate (Owner 19 Nov). Usage: node tools/tests/download-page-browser.js <outdir> [base]
const { launch } = require('./lib');
const stub = require('./stub.js');
const fs = require('fs');
const OUT = process.argv[2] || 'out';
const BASE = process.argv[3] || 'http://localhost:8817';
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch();
  let fails = 0, errors = 0;
  for (const theme of ['dark', 'light']) for (const w of [1440, 1024, 390, 360]) {
    const ua = w < 600 ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36';
    const ctx = await b.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, userAgent: ua });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((t) => { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('tz_consent', '{"v":1,"essential":true}'); }, theme);
    await ctx.route(/gstatic|googleapis/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/download.html', { waitUntil: 'load' });
    // reveal everything for the full-page shot
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } scrollTo(0, 0); document.querySelectorAll('.dp-rv').forEach((e) => e.classList.add('in')); });
    await p.waitForTimeout(900);
    const m = await p.evaluate(() => {
      const out = [], box = (e) => e.getBoundingClientRect();
      const sx = document.documentElement.scrollWidth;
      if (sx > innerWidth) out.push('h-scroll ' + sx);
      // platform buttons: logo + text share a centre; left/right padding
      document.querySelectorAll('.dp-plat').forEach((a, i) => {
        const r = box(a), lg = box(a.querySelector('.dl-logo')), t = box(a.querySelector('.dp-plat-t'));
        const cy = r.top + r.height / 2;
        if (Math.abs(lg.top + lg.height / 2 - cy) > 1 || Math.abs(t.top + t.height / 2 - cy) > 1) out.push('plat' + i + ' centre');
        if (t.right > r.right - 12) out.push('plat' + i + ' text overflow');
      });
      const pl = [...document.querySelectorAll('.dp-hero .dp-plat')].map(box);
      if (pl.length === 2 && pl[0].top === pl[1].top && Math.abs(pl[0].height - pl[1].height) > 0.5) out.push('plat heights differ');
      // rows inside the mini UIs
      document.querySelectorAll('.dp-row').forEach((r, i) => { const rb = box(r); [...r.children].forEach((c) => { const cb = box(c); if (Math.abs(cb.top + cb.height / 2 - (rb.top + rb.height / 2)) > 1) out.push('row' + i + ' centre ' + c.className); if (c.scrollWidth > c.clientWidth + 1 && getComputedStyle(c).textOverflow !== 'ellipsis') out.push('row' + i + ' clip'); }); });
      // seg tabs, faq, table cells: no clipped text
      document.querySelectorAll('.dp-seg button, .dp-faq summary, .dp-cmp th, .dp-card h3, .dp-step, .dp-tk-b span').forEach((e) => { if (e.scrollWidth > e.clientWidth + 1) out.push('clip ' + e.className + ' ' + e.textContent.trim().slice(0, 20)); });
      // card padding even
      document.querySelectorAll('.dp-card').forEach((c, i) => { const s = getComputedStyle(c); if (s.paddingLeft !== s.paddingRight || s.paddingTop !== s.paddingBottom) out.push('card' + i + ' padding'); });
      // header over the hero: hero starts at 0
      const hero = box(document.querySelector('.dp-hero'));
      if (Math.abs(hero.top) > 0.5) out.push('hero top ' + hero.top);
      const rec = document.querySelector('.dp-plat.is-rec');
      return { out, rec: rec && rec.id, h: document.body.scrollHeight };
    });
    const name = `download-${w}-${theme}`;
    await p.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
    await p.screenshot({ path: `${OUT}/${name}-top.png` });
    console.log(name, 'rec=' + m.rec, m.out.length ? 'FAIL ' + m.out.join('; ') : 'PASS', errs.length ? 'ERR ' + errs.join(' | ') : '');
    fails += m.out.length; errors += errs.length;
    await ctx.close();
  }
  await b.close();
  console.log('fails', fails, 'page errors', errors);
  process.exit(fails || errors ? 1 : 0);
})();
