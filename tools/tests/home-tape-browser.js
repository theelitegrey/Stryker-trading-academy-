// Homepage ticker tape (index.html, v2). Local dev server first:
//   node tools/tests/chart-dev-server.mjs 8047 &  node tools/tests/home-tape-browser.js http://127.0.0.1:8047 <outdir>
// Checks: real prices load, layout/alignment, no overflow, motion + pause, links, reduced motion, cache fallback, page errors.
const { launch } = require('./lib.js');
const BASE = process.argv[2] || 'http://127.0.0.1:8047';
const OUT = (process.argv[3] || '/tmp') + '/';
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 400)); };

async function open(b, w, theme, o = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: o.h || 900 }, deviceScaleFactor: o.dpr || 1, isMobile: w < 700, hasTouch: w < 700, reducedMotion: o.rm ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(([th, cache]) => { try { localStorage.setItem('stryker_install_prompt_dismissed', '1'); localStorage.setItem('tz_consent', JSON.stringify({ v: 1, at: Date.now() })); if (th === 'day') localStorage.setItem('stryker_theme', 'day'); if (cache) localStorage.setItem('hv_tape_v1', cache); } catch (e) {} }, [theme, o.cache || '']);
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  if (o.block) await ctx.route(o.block, (r) => r.abort());
  else {
    // the recorder's CORS answers only the production origin; in this local test the stock table is fetched as the site would
    await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/scan\?/, async (r) => { const res = await r.fetch({ headers: { origin: 'https://tradezoro.com' } }); await r.fulfill({ response: res, headers: Object.assign({}, res.headers(), { 'access-control-allow-origin': '*' }) }); });
  }
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => { if (!/reading 'collection'/.test(e.message)) p.errs.push(e.message); }); // Firebase SDK stubbed empty: db is null in the shared account scripts (not the page)
  await p.goto(BASE + '/index.html', { waitUntil: 'load' });
  return { ctx, p };
}
const ready = (p, n = 17) => p.waitForFunction((n) => { const s = document.querySelector('[data-hv-tape]'); return s && !s.hidden && Object.keys(window.__hvTape.data).length >= n; }, n, { timeout: 30000 }).then(() => true).catch(() => false);

const geo = (p) => p.evaluate(() => {
  const s = document.querySelector('[data-hv-tape]'), r = s.getBoundingClientRect(), hero = document.querySelector('.hv-hero').getBoundingClientRect(), say = document.querySelector('.hv-say').getBoundingClientRect();
  const items = [...s.querySelectorAll('.hv-tape-g:first-child .hv-tk')].slice(0, 6).map((a) => {
    const ar = a.getBoundingClientRect(), mid = (e) => { const x = e.getBoundingClientRect(); return x.top + x.height / 2; };
    const kids = [a.querySelector('.hv-tk-ic'), a.querySelector('.hv-tk-s'), a.querySelector('.hv-tk-p'), a.querySelector('.hv-tk-c')];
    const ms = kids.map(mid);
    return { k: a.dataset.k, h: ar.height, dv: Math.max(...ms) - Math.min(...ms), am: ar.top + ar.height / 2 - ms[0], fs: kids.map((e) => parseFloat(getComputedStyle(e).fontSize)),
      clip: kids.some((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline'), href: a.getAttribute('href') };
  });
  const gaps = (() => { const a = [...s.querySelectorAll('.hv-tape-g:first-child .hv-tk')].slice(0, 8).map((x) => x.getBoundingClientRect()); return a.slice(1).map((x, i) => Math.round(x.left - a[i].right)); })();
  return { top: r.top - hero.bottom, below: say.top - r.bottom, left: r.left, width: r.width, vw: innerWidth, sw: document.documentElement.scrollWidth,
    bt: getComputedStyle(s).borderTopWidth, bb: getComputedStyle(s).borderBottomWidth, mask: getComputedStyle(s.querySelector('.hv-tape-vp')).maskImage || getComputedStyle(s.querySelector('.hv-tape-vp')).webkitMaskImage,
    anim: getComputedStyle(s.querySelector('.hv-tape-tr')).animationName, dur: getComputedStyle(s.querySelector('.hv-tape-tr')).animationDuration,
    gw: s.querySelector('.hv-tape-g').scrollWidth, groups: s.querySelectorAll('.hv-tape-g').length, items, gaps, txt: s.textContent };
});
const xOf = (p) => p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.hv-tape-tr')).transform).m41);

(async () => {
  const b = await launch();
  try {
    for (const [w, theme, dpr] of [[1440, 'dark', 1], [2560, 'dark', 1], [390, 'dark', 2], [1440, 'day', 1], [2560, 'day', 1], [390, 'day', 2], [360, 'dark', 2], [412, 'dark', 2], [1024, 'dark', 1]]) {
      const tag = w + '-' + theme;
      const { ctx, p } = await open(b, w, theme, { dpr });
      t(tag + ' prices load (all 17 items)', await ready(p));
      await p.evaluate(() => document.querySelector('[data-hv-tape]').scrollIntoView({ block: 'center' }));
      await p.waitForTimeout(600);
      const g = await geo(p);
      t(tag + ' sits right under the hero, before the statement', Math.abs(g.top) < 1 && Math.abs(g.below) < 1, [g.top, g.below]);
      t(tag + ' full width, hairlines, edge mask', g.left === 0 && Math.abs(g.width - g.vw) < 1 && g.bt === '1px' && g.bb === '1px' && /gradient/.test(g.mask), g);
      t(tag + ' no horizontal page scroll', g.sw <= g.vw, [g.sw, g.vw]);
      t(tag + ' marquee runs at 40-60 px/s', g.anim === 'hv-tape' && g.groups === 2 && g.gw >= g.vw && (() => { const v = g.gw / parseFloat(g.dur); return v >= 40 && v <= 60; })(), [g.gw, g.dur, g.groups]);
      t(tag + ' items share one centre (<= 1 px), icon centred in the row', g.items.every((i) => i.dv <= 1 && Math.abs(i.am) <= 1), g.items.map((i) => [i.k, i.dv, i.am]));
      t(tag + ' text >= 12 px, nothing clipped', g.items.every((i) => i.fs.slice(1).every((f) => f >= 12) && !i.clip), g.items.map((i) => i.fs));
      t(tag + ' even gaps', new Set(g.gaps).size === 1, g.gaps);
      t(tag + ' no vendor names / no live wording', !/binance|yahoo|insight|vela|real-?time|delayed|live/i.test(g.txt));
      t(tag + ' links open the chart on the symbol', g.items.every((i) => /^\/charts\?symbol=/.test(i.href)), g.items.map((i) => i.href));
      t(tag + ' page errors 0', p.errs.length === 0, p.errs);
      // whole-page shots for the three widths asked, tape crops for all
      const box = await p.$eval('[data-hv-tape]', (e) => { const r = e.getBoundingClientRect(); return { x: 0, y: r.top + scrollY, width: r.width, height: r.height }; });
      await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300);
      await p.screenshot({ path: OUT + 'tape-' + tag + '.png', clip: { x: 0, y: Math.max(0, box.y - (w < 700 ? 420 : 560)), width: w, height: box.height + (w < 700 ? 620 : 820) }, fullPage: true });
      await p.screenshot({ path: OUT + 'tape-strip-' + tag + '.png', clip: box, fullPage: true });
      if (w === 1440 && theme === 'dark') {
        await p.evaluate(() => document.querySelector('[data-hv-tape]').scrollIntoView({ block: 'center' }));
        await p.waitForTimeout(500);
        const v = await p.evaluate(() => new Promise((res) => { const tr = document.querySelector('.hv-tape-tr'), x = () => new DOMMatrix(getComputedStyle(tr).transform).m41;
          const a = x(), t0 = performance.now(); setTimeout(() => res((a - x()) / ((performance.now() - t0) / 1000)), 3000); }));
        t('moves at 40-60 px/s (measured over 3 s)', v >= 40 && v <= 60, v);
        const r = await p.$eval('.hv-tape-g:first-child .hv-tk:nth-child(3)', (e) => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
        await p.mouse.move(300, r[1]); await p.waitForTimeout(200);
        const h0 = await xOf(p); await p.waitForTimeout(800); const h1 = await xOf(p);
        t('pauses on hover', h0 === h1, [h0, h1]);
        await p.mouse.move(5, 5);
        await p.evaluate(() => scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(400);
        const o0 = await xOf(p); await p.waitForTimeout(700); const o1 = await xOf(p);
        t('pauses off screen', o0 === o1, [o0, o1]);
        // flash: feed a changed price through the real paint path
        await p.evaluate(() => { const d = window.__hvTape.data; d.NQ = Object.assign({}, d.NQ, { last: d.NQ.last + 1 }); });
        await p.evaluate(() => document.querySelector('[data-hv-tape]').scrollIntoView({ block: 'center' }));
        await p.evaluate(() => window.dispatchEvent(new Event('resize')));
      }
      await ctx.close();
    }
    // reduced motion: static, scrollable
    {
      const { ctx, p } = await open(b, 390, 'dark', { rm: true, dpr: 2 });
      t('rm prices load', await ready(p));
      const g = await geo(p);
      const sc = await p.$eval('.hv-tape-vp', (e) => ({ ov: getComputedStyle(e).overflowX, sw: e.scrollWidth, cw: e.clientWidth }));
      t('rm: no animation, one group, row scrolls sideways', g.anim === 'none' && g.groups === 1 && sc.ov === 'auto' && sc.sw > sc.cw, [g.anim, g.groups, sc]);
      t('rm no page overflow', g.sw <= g.vw);
      await p.$eval('[data-hv-tape]', (e) => e.scrollIntoView({ block: 'center' }));
      await p.screenshot({ path: OUT + 'tape-strip-390-rm.png', clip: await p.$eval('[data-hv-tape]', (e) => { const r = e.getBoundingClientRect(); return { x: 0, y: r.top, width: r.width, height: r.height }; }) });
      t('rm page errors 0', p.errs.length === 0, p.errs);
      await ctx.close();
    }
    // every source down: cached values shown; no cache: strip hidden
    {
      const cache = JSON.stringify({ at: Date.now() - 3600000, q: { NQ: { last: 27000.25, pct: 0.5 }, BTC: { last: 60000, pct: -1.2 } } });
      const block = /\/api\/chart\/bars|book-recorder|binance/;
      let o = await open(b, 1440, 'dark', { cache, block });
      await o.p.waitForTimeout(3000);
      const s1 = await o.p.evaluate(() => ({ hidden: document.querySelector('[data-hv-tape]').hidden, keys: [...new Set([...document.querySelectorAll('.hv-tk')].map((a) => a.dataset.k))] }));
      t('offline + cache: cached items shown', !s1.hidden && s1.keys.join() === 'NQ,BTC', s1);
      await o.ctx.close();
      o = await open(b, 1440, 'dark', { block });
      await o.p.waitForTimeout(3000);
      t('offline + no cache: strip hidden', await o.p.evaluate(() => document.querySelector('[data-hv-tape]').hidden));
      t('offline page errors 0', o.p.errs.length === 0, o.p.errs);
      await o.ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
