// Screenshot + perf script for preview variation C. Run: node tools/tests/home-combo-c-shot.js <outdir>
const lib = require('/root/projects/stryker-trading-academy/tools/tests/lib.js');
const { chromium } = require('/root/projects/stryker-trading-academy/node_modules/playwright-core');
const OUT = process.argv[2] || '/tmp';
const URL = process.env.U || 'http://127.0.0.1:8853/home-preview-c.html';
(async () => {
  const b = await chromium.launch({ executablePath: lib.executablePath ? lib.executablePath() : undefined, args: ['--no-sandbox'] });
  const runs = [
    { n: '390-day', w: 390, h: 844, theme: 'day', mobile: true },
    { n: '390-dark', w: 390, h: 844, theme: 'dark', mobile: true },
    { n: '390-rm', w: 390, h: 844, theme: 'day', mobile: true, rm: true },
    { n: '1440-day', w: 1440, h: 900, theme: 'day' },
    { n: '1440-dark', w: 1440, h: 900, theme: 'dark' },
  ];
  for (const r of runs) {
    const ctx = await b.newContext({ viewport: { width: r.w, height: r.h }, deviceScaleFactor: 2, isMobile: !!r.mobile, hasTouch: !!r.mobile,
      reducedMotion: r.rm ? 'reduce' : 'no-preference' });
    await ctx.addInitScript(t => { try { localStorage.setItem('stryker_theme', t); } catch (e) {} }, r.theme);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL, { waitUntil: 'load' });
    await p.evaluate(() => document.getElementById('hcc').scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(r.rm ? 800 : 6500);
    const info = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      on: [...document.querySelectorAll('.hcc-ro.on b')].map(e => e.textContent), cardW: document.getElementById('hcc').getBoundingClientRect().width }));
    console.log(r.n, JSON.stringify(info), errs.join('|'));
    await (await p.$('#hcc')).screenshot({ path: `${OUT}/c-${r.n}.png` });
    if (r.n === '390-day') await p.screenshot({ path: `${OUT}/c-390-page.png` });
    await ctx.close();
  }
  if (process.env.PERF) {
    for (const w of [390, 1440]) {
      const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
      const p = await ctx.newPage();
      const cdp = await ctx.newCDPSession(p);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await p.goto(URL, { waitUntil: 'load' });
      await p.evaluate(() => document.getElementById('hcc').scrollIntoView({ block: 'center' }));
      const f = await p.evaluate(() => new Promise(res => { const d = []; let last = performance.now(); const t0 = last;
        (function fr(n) { d.push(n - last); last = n; if (n - t0 < 12000) requestAnimationFrame(fr); else res(d.slice(1)); })(last); }));
      f.sort((a, b) => a - b);
      const q = x => f[Math.floor(f.length * x)].toFixed(1);
      console.log('perf', w, 'frames', f.length, 'median', q(.5), 'p95', q(.95), 'max', f[f.length - 1].toFixed(1), 'jank>50ms', f.filter(x => x > 50).length);
      await ctx.close();
    }
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
