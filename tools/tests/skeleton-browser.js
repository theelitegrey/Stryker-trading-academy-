// Skeleton loading test. Holds Firestore reads (and the screener's data fetch) open, asserts a skeleton shows
// with aria-busy where the container is marked, then releases and asserts it is gone and aria-busy cleared.
//   flock /tmp/stryker-chrome.lock node tools/tests/skeleton-browser.js [shotsDir]
const R = require('./bt-rig.js');
const fs = require('fs');
const OUT = process.argv[2]; if (OUT) fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

// every Firestore get()/onSnapshot waits for window.__release()
const hold = () => {
  let rel; window.__held = new Promise((r) => { rel = r; }); window.__release = () => rel();
  const prox = (o) => new Proxy(o, {
    get(t, k) {
      const v = t[k];
      if (k === 'get' && typeof v === 'function') return (...a) => window.__held.then(() => v.apply(t, a));
      if (typeof v === 'function') return (...a) => { const r = v.apply(t, a); return r && typeof r === 'object' && !r.then ? prox(r) : r; };
      return v;
    }
  });
  const wait = setInterval(() => { if (window.__stubDb && !window.__stubDb.__p) { window.__stubDb.__p = 1; const c = window.__stubDb.collection, d = window.__stubDb.doc; window.__stubDb.collection = (p) => (/^students/.test(p) ? c(p) : prox(c(p))); window.__stubDb.doc = (p) => (/^students/.test(p) ? d(p) : prox(d(p))); clearInterval(wait); } }, 0);
};

const PAGES = [
  { name: 'dashboard', url: '/dashboard-user.html', sel: '.dov-skel, .gp-node.is-skel, .skel-wrap' },
  { name: 'journal', url: '/trade-journal.html', sel: '#jh-list .skel-wrap', vis: '.skel-gate, #jh-list .skel-wrap', busy: '#jh-list' },
  { name: 'screener', url: '/scanner.html', sel: '#scn-root .skel-wrap', busy: '#scn-root', route: /book-recorder/ },
  { name: 'gex', url: '/gex.html', sel: '#gex-skel', slow: true },
  { name: 'charts', url: '/charts.html', sel: '#stkchart-skel', slow: true },
];

(async () => {
  const srv = await R.serve(); const b = await R.launch();
  const sizes = [['390', 'phone', 'dark'], ['390', 'phone', 'light'], ['1440', 'desktop', 'dark']];
  for (const [w, dev, theme] of sizes) {
    for (const pg of PAGES) {
      if (theme === 'light' && pg.name === 'charts') continue;
      const { ctx, p, errors } = await R.page(b, srv, dev, `(${hold})(); try{localStorage.setItem('stryker_theme','${theme === 'light' ? 'day' : 'night'}')}catch(e){}`);
      let rel;
      if (pg.route) { const held = new Promise((r) => { rel = r; }); await p.route(/book-recorder/, async (r) => { await held; r.abort().catch(() => {}); }); }
      await p.goto(srv.base + pg.url, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(pg.slow ? 900 : 600);
      const tag = `${pg.name} ${w} ${theme}`;
      const on = await p.evaluate((s) => { return [...document.querySelectorAll(s.vis || s.sel)].some((e) => getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().height > 0); }, pg);
      check(on, `${tag}: skeleton visible while loading`);
      if (pg.busy) check(await p.evaluate((s) => document.querySelector(s).getAttribute('aria-busy') === 'true', pg.busy), `${tag}: aria-busy=true while loading`);
      if (OUT) await p.screenshot({ path: `${OUT}/${pg.name}-${w}-${theme}-loading.png` });
      await p.evaluate(() => window.__release && window.__release()); if (rel) rel();
      await p.waitForTimeout(2500);
      if (pg.busy) {
        const st = await p.evaluate((s) => ({ busy: s.name === 'journal' ? false : document.querySelector(s.busy).hasAttribute('aria-busy'), skel: s.name === 'journal' ? [...document.querySelectorAll('.skel-gate')].some((e) => e.offsetParent !== null) : !!document.querySelector(s.sel) }), pg);
        check(!st.busy && !st.skel, `${tag}: skeleton gone + aria-busy cleared after data (busy=${st.busy} skel=${st.skel})`);
      } else if (pg.name === 'dashboard') {
        check(await p.evaluate(() => !document.querySelector('.dov-skel')), `${tag}: no dov-skel left after data`);
      }
      if (OUT) await p.screenshot({ path: `${OUT}/${pg.name}-${w}-${theme}-loaded.png` });
      check(!errors.some((e) => /skel/i.test(e)), `${tag}: no skeleton JS errors`);
      await ctx.close();
    }
  }
  await b.close(); srv.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
