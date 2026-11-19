// Homepage (index.html, v2 live 19 Nov) layout + hero test. Offline: local static server, everything else aborted.
//   node tools/tests/home-hero-browser.js [shotsDir]
// At 360/390/412/768/1024/1280/1440/1920, dark + light:
//   no horizontal overflow; the shared header (#site-nav with Download menu, Products, FAQ, theme) sits at the top and the
//   hero is the first block under it; hero canvas draws (real NQ bars file); CTAs >= 44 px and not covered; ids other
//   pages link to (/#faq, /#concepts, /#curriculum, /#pricing, #platform) exist; no noindex; no page errors.
// Then reduced motion (canvas still drawn, reveals visible) and full-page shots at 390/1024/1440 dark + light when a dir is given.
const path = require('path');
const R = require('./bt-rig.js');
const OUT = process.argv[2];
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

const probe = () => {
  const q = (s) => document.querySelector(s);
  const nav = q('#site-nav'), hero = q('.hv-hero'), cv = q('.hv-hero canvas[data-hv-canvas]');
  const nr = nav.getBoundingClientRect(), hr = hero.getBoundingClientRect();
  let drawn = false;
  try { const c = cv.getContext('2d'), d = c.getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) { drawn = true; break; } } catch (e) {}
  const ctas = [...document.querySelectorAll('.hv-hero .hv-cta a')].map((a) => { const r = a.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { h: r.height, ok: a.contains(el), href: a.getAttribute('href') }; });
  return {
    vw: innerWidth, docW: document.documentElement.scrollWidth, navTop: nr.top, navB: nr.bottom, heroTop: hr.top,
    firstInMain: q('main').firstElementChild === hero, drawn, ctas,
    dl: !!nav.querySelector('.dl-menu .dl-pill-btn') && !!nav.querySelector('.dl-drawer'), prod: !!nav.querySelector('.hn-prod .hn-menu a'),
    faq: nav.querySelector('[data-hn-faq]').getAttribute('href'), theme: !!nav.querySelector('[data-hn-theme]'),
    ids: ['faq', 'concepts', 'curriculum', 'pricing', 'platform', 'modules', 'build', 'top'].filter((i) => !document.getElementById(i)),
    robots: (q('meta[name=robots]') || {}).content || '', title: document.title, canon: (q('link[rel=canonical]') || {}).href,
    lcp: !!q('link[rel=preload][as=image][href*="hero-orderflow"]')
  };
};

(async () => {
  const srv = await R.serve(); const b = await R.launch();
  const open = async (w, theme, rm) => {
    const mob = w < 700;
    const ctx = await b.newContext({ viewport: { width: w, height: mob ? 844 : 900 }, deviceScaleFactor: 1, isMobile: mob, hasTouch: mob, reducedMotion: rm ? 'reduce' : 'no-preference' });
    await ctx.addInitScript(`try{localStorage.setItem('stryker_theme','${theme}');localStorage.setItem('stryker_install_prompt_dismissed','1');localStorage.setItem('tz_consent',JSON.stringify({v:1,at:Date.now()}))}catch(e){}`);
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const p = await ctx.newPage();
    p.errs = []; p.on('pageerror', (e) => { if (!/reading 'collection'|firebase is not defined/.test(String(e))) p.errs.push(String(e)); }); // offline: Firebase aborted
    await p.goto(srv.base + '/index.html', { waitUntil: 'load' });
    await p.waitForTimeout(rm ? 800 : 2500);
    return { ctx, p };
  };
  try {
    for (const theme of ['night', 'day']) {
      for (const w of [360, 390, 412, 768, 1024, 1280, 1440, 1920]) {
        const { ctx, p } = await open(w, theme);
        const s = await p.evaluate(probe);
        const tag = theme + ' ' + w + ':';
        check(s.docW <= s.vw, `${tag} no horizontal overflow (${s.docW} <= ${s.vw})`);
        check(s.navTop === 0 && s.firstInMain && s.heroTop <= s.navB + 0.5, `${tag} shared header on top, hero is the first block under it (hero top ${Math.round(s.heroTop)}, nav bottom ${Math.round(s.navB)})`);
        check(s.dl && s.prod && s.theme && s.faq === '/#faq', `${tag} shared header: Download menu, Products, theme, FAQ -> /#faq`);
        check(s.drawn, `${tag} hero canvas draws the recorded NQ session`);
        check(s.ctas.length === 2 && s.ctas.every((c) => c.h >= 44 && c.ok) && s.ctas[0].href === '/signup', `${tag} hero CTAs >= 44 px, not covered, Start free -> /signup`);
        check(!s.ids.length, `${tag} anchor ids other pages link to exist ${s.ids.join(',')}`);
        check(!/noindex/.test(s.robots) && !/preview/i.test(s.title) && s.canon === 'https://tradezoro.com/' && s.lcp, `${tag} indexable, live title + canonical, LCP image preloaded`);
        check(!p.errs.length, `${tag} no page errors ${p.errs.slice(0, 2).join(' | ')}`);
        if (OUT && [390, 1024, 1440].includes(w)) {
          // reveal everything below the fold first so the full-page shot shows the real final state
          // (real wheel steps: the page has smooth scroll, so a scrollTo loop never lets the reveal observers fire)
          const H = await p.evaluate(() => document.documentElement.scrollHeight);
          for (let y = 0; y < H; y += 400) { await p.mouse.wheel(0, 400); await p.waitForTimeout(80); }
          await p.waitForTimeout(900);
          check(await p.evaluate(() => !document.querySelector('.hv-rv:not(.in)')), `${tag} every reveal block shown after scrolling`);
          await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, 0); });
          await p.waitForTimeout(400);
          await p.screenshot({ path: path.join(OUT, `home-${w}-${theme === 'night' ? 'dark' : 'light'}.png`), fullPage: true });
          await p.screenshot({ path: path.join(OUT, `home-${w}-${theme === 'night' ? 'dark' : 'light'}-top.png`) });
        }
        await ctx.close();
      }
    }
    const { ctx, p } = await open(1440, 'night', true);
    const rm = await p.evaluate(() => ({ rm: document.documentElement.classList.contains('hv-rm'), op: [...document.querySelectorAll('.hv-rv')].every((e) => getComputedStyle(e).opacity === '1') }));
    const s = await p.evaluate(probe);
    check(rm.rm && rm.op && s.drawn, `reduced motion: html.hv-rm, every reveal visible, hero drawn as its final frame`);
    check(!p.errs.length, `reduced motion: no page errors ${p.errs.slice(0, 2).join(' | ')}`);
    await ctx.close();
  } finally { await b.close(); srv.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
