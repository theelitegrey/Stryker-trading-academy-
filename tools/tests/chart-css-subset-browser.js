// Charts CSS subset (assets/style-charts.css, tools/build-charts-css.py) == full style.css on the Charts page.
// Opens charts.html (fixture data), opens a set of panels / menus, and in that SAME DOM snaps the computed
// style of every element (all properties, plus ::before/::after) with the subset, then disables the subset,
// enables the full style.css and snaps again synchronously (no script can react in between). Any
// difference = FAIL with the element and property.
//   node tools/tests/chart-speed-server.mjs 8261 &
//   CHART_BASE=http://127.0.0.1:8261 node tools/tests/chart-css-subset-browser.js
const { launch } = require('./lib.js');
const { speedInit } = require('./chart-phone-speed-init.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8261';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 900))); };

// every element's full computed style (+ pseudo), keyed by a DOM path
const SNAP = () => {
  const path = (e) => { const a = []; while (e && e.nodeType === 1 && a.length < 40) { let i = 0, s = e; while ((s = s.previousElementSibling)) i++; a.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + ':' + i); e = e.parentElement; } return a.join('>'); };
  const out = {};
  const skip = /^(transition|animation|will-change|--shine-)/;   // --shine-* are random per load (JS)
  for (const e of document.querySelectorAll('body *')) {
    if (e.closest('canvas,svg defs,script,style,noscript')) continue;
    const k = path(e);
    for (const ps of [null, '::before', '::after']) {
      const cs = getComputedStyle(e, ps);
      if (ps && (cs.content === 'none' || cs.content === 'normal')) continue;
      const o = [];
      for (let i = 0; i < cs.length; i++) { const p = cs[i]; if (!skip.test(p)) o.push(p + ':' + cs.getPropertyValue(p)); }
      out[k + (ps || '')] = o.sort().join(';');
    }
  }
  return out;
};

const STATES = {
  load: async () => {},
  more: async (p) => { await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getClientRects().length && /more|⋯/i.test((x.getAttribute('aria-label') || '') + (x.title || '') + x.textContent)); if (b) b.click(); }); },
  indicators: async (p) => { await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getClientRects().length && /^indicators/i.test((x.getAttribute('aria-label') || x.title || x.textContent || '').trim())); if (b) b.click(); }); },
  watchlist: async (p) => { await p.evaluate(() => { const b = document.querySelector('.stkw-railbtn'); if (b) b.click(); }); },
  ladder: async (p) => { await p.evaluate(() => { const b = document.querySelector('.stkgl-railbtn'); if (b) b.click(); }); },
  news: async (p) => { await p.evaluate(() => { const b = document.querySelector('.stknw-railbtn, [aria-label="News"]'); if (b) b.click(); }); },
  settings: async (p) => { await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getClientRects().length && /settings/i.test((x.getAttribute('aria-label') || '') + (x.title || ''))); if (b) b.click(); }); },
  symbol: async (p) => { await p.evaluate(() => { const c = [...document.querySelectorAll('button,[role=button]')].filter((e) => e.getClientRects().length && /^\s*NQ1!/.test(e.textContent) && e.textContent.length < 40); if (c[0]) c[0].click(); }); },
};

(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE cdn.jsdelivr.net'] });
  const sizes = (process.env.CSS_SIZES || '390x844,1440x900').split(',');
  const engs = (process.env.CSS_ENG || '0.9,0.6').split(',');
  const themes = (process.env.CSS_THEMES || 'dark,day').split(',');
  for (const eng of engs) for (const sz of sizes) for (const theme of themes) {
    const [w, h] = sz.split('x').map(Number);
    const mobile = w < 800;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
    await speedInit(ctx);
    if (theme === 'day') await ctx.addInitScript(() => { try { localStorage.setItem('stryker_theme', 'day'); } catch (e) {} });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
    for (const [name, act] of Object.entries(STATES)) {
      await p.goto(BASE + '/charts.html?vela=' + eng, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady, null, { timeout: 90000 }).catch(() => {});
      await p.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' });
      await sleep(800);
      await act(p);
      await sleep(900);
      if (process.env.CSS_NOLAYOUT) await p.evaluate(() => { window.__lay = 1; });
      const r = await p.evaluate(async ({ SNAPSRC, FULLURL }) => {
        const SNAP = eval('(' + SNAPSRC + ')');
        const sub = [...document.styleSheets].find((s) => /style-charts\.css/.test(s.href || ''));
        if (!sub) return { err: 'no subset sheet' };
        const nSub = sub.cssRules.length;
        // the full sheet as a real <link> (so url()s resolve the same), placed right after the subset's <link>
        const full = document.createElement('link');
        full.rel = 'stylesheet'; full.href = FULLURL;
        await new Promise((res) => { full.onload = full.onerror = res; sub.ownerNode.after(full); });
        await document.fonts.ready;
        full.sheet.disabled = true;
        const A = SNAP();
        full.sheet.disabled = false; sub.disabled = true;
        const B = SNAP();
        sub.disabled = false; full.remove();
        const diffs = [];
        for (const k of Object.keys(A)) {
          if (A[k] === B[k]) continue;
          if (B[k] === undefined) { diffs.push([k.slice(-90), 'pseudo only with the subset']); continue; }
          const LAY = /^(width|height|inline-size|block-size|inset|top|left|right|bottom|perspective-origin|transform-origin|min-|max-)/;
          const a = new Set(A[k].split(';').filter((x) => !(window.__lay && LAY.test(x)))), bb = new Set(B[k].split(';').filter((x) => !(window.__lay && LAY.test(x))));
          if (window.__lay && [...a].every((x) => bb.has(x))) continue;
          diffs.push([k.slice(-90), 'subset', [...a].filter((x) => !bb.has(x)).slice(0, 4), 'full', [...bb].filter((x) => !a.has(x)).slice(0, 4)]);
        }
        for (const k of Object.keys(B)) if (A[k] === undefined) diffs.push([k.slice(-90), 'pseudo only with the full sheet']);
        return { n: Object.keys(A).length, nSub, diffs };
      }, { SNAPSRC: SNAP.toString(), FULLURL: '/assets/style.css' });
      if (r.err) { check(false, `${eng} ${sz} ${theme} ${name}: ${r.err}`); continue; }
      check(r.diffs.length === 0, `${eng} ${sz} ${theme} ${name}: computed styles identical, subset vs full style.css (${r.n} element boxes, subset ${r.nSub} rules)`, r.diffs.slice(0, 4));
    }
    check(errs.length === 0, `${eng} ${sz} ${theme}: no page errors`, errs);
    await ctx.close();
  }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
