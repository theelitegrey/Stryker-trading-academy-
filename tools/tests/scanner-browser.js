// Screener page (scanner.html + assets/scanner.js): 4 markets x 390/1440 x dark/light, filter sheet touch test, row -> charts.
// /scan?part= is answered from tools/tests/fixtures/scan2/*.json.gz (real feeder output 2026-11-02),
// sent as the Worker sends it (gzip bytes + x-scan-gzip: 1).
//   node tools/tests/chart-dev-server.mjs 8061
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8061 node tools/tests/scanner-browser.js [shotsDir]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061';
const OUT = process.argv[2] || '/tmp';
const FIX = path.join(__dirname, 'fixtures', 'scan2');
const fresh = (name) => {
  const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FIX, name + '.json.gz'))));
  d.t = Math.floor(Date.now() / 1000) - 120;
  return { d, gz: zlib.gzipSync(JSON.stringify(d)) };
};
const PARTS = { stock: fresh('stock'), etf: fresh('etf'), crypto: fresh('crypto'), fut: fresh('fut') };
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(b, { w, h, mobile, light, url, free }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((free) => {
    Object.defineProperty(window, 'strykerPlanTier', { configurable: false, get: () => () => Promise.resolve({ free: !!free }), set() {} });
    window.__plan = []; window.openPlanUpgradeModal = (w) => { window.__plan.push(w); };
  }, !!free);
  await ctx.route(/\/api\/gex\/levels\//, (r) => {
    const m = r.request().url().match(/levels\/([A-Z]+)/)[1];
    const lv = { SPX: { call_wall: 7000, zero_gamma: 6900, put_wall: 6800, futures: { ES: { levels: { call_wall: 7010, zero_gamma: 6910, put_wall: 6810 } }, MES: { levels: { call_wall: 7010, zero_gamma: 6910, put_wall: 6810 } } } }, SPY: { call_wall: 700, zero_gamma: 690, put_wall: 680 }, QQQ: { call_wall: 600, zero_gamma: 590, put_wall: 580 }, GLD: { call_wall: 400, zero_gamma: 390, put_wall: 380 } }[m] || {};
    r.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(lv) });
  });
  await ctx.addInitScript((light) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker_screener'); if (light) localStorage.setItem('stryker_theme', 'day'); } catch (e) {}
  }, !!light);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const asked = [];
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/scan/, (r) => {
    const part = new URL(r.request().url()).searchParams.get('part'); asked.push(part);
    const x = PARTS[part];
    if (!x) return r.fulfill({ status: 404, body: 'no data' });
    r.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'x-scan-gzip': '1', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-scan-gzip,x-scan-t' }, body: x.gz });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(url || (BASE + '/scanner.html'), { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#scn-root .scn-r', { timeout: 30000 }).catch(() => {});
  await p.evaluate(() => { document.querySelectorAll('.gate-pending').forEach((e) => e.classList.remove('gate-pending')); });
  await sleep(400);
  return { ctx, p, errors, asked };
}
const state = (p) => p.evaluate(() => {
  const rows = [...document.querySelectorAll('#scn-root .scn-r')];
  const st = window.__stkScn || {};
  return {
    tabs: [...document.querySelectorAll('.scn-seg [role=tab]')].map((t) => t.textContent.trim()),
    on: (document.querySelector('.scn-seg [aria-selected=true]') || {}).textContent,
    drawn: rows.length, total: (st.view || []).length, all: (st.rows || []).length,
    count: (document.querySelector('.scn-count') || {}).textContent,
    ago: (document.getElementById('scn-ago') || {}).textContent,
    edu: /Education only\. Not financial advice\./.test(document.body.innerText),
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    heads: [...document.querySelectorAll('.scn-hd .scn-h')].map((h) => h.getAttribute('data-sort')),
    first: (st.view || []).slice(0, 5).map((r) => r.s),
    dark: getComputedStyle(document.body).backgroundColor,
    banned: /insightsentry|tick-?stream|tradingview|luxalgo|vela|delayed|real-time/i.test(document.body.innerText)
  };
});
async function shot(p, name) { await p.mouse.move(2, 2).catch(() => {}); await sleep(250); await p.screenshot({ path: OUT + '/' + name }); console.log('shot ' + OUT + '/' + name); }

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const vp of [{ w: 1440, h: 900 }, { w: 390, h: 844, mobile: true }, { w: 412, h: 915, mobile: true }]) {
      for (const light of [false, true]) {
        const tag = vp.w + (light ? 'L' : 'D');
        const { ctx, p, errors, asked } = await open(b, Object.assign({ light }, vp));
        let s = await state(p);
        check(s.tabs.join() === 'Stocks,ETFs,Crypto,Futures', tag + ': market tabs ' + s.tabs.join('|'));
        check(s.drawn > 0 && s.drawn < 80, tag + ': virtualised, ' + s.drawn + ' of ' + s.total + ' rows in the DOM');
        check(/^Updated \d+ min ago$/.test(s.ago || ''), tag + ': status "' + s.ago + '"');
        check(s.edu && !s.banned, tag + ': education line, no banned words');
        check(s.overflowX <= 0, tag + ': no page-level sideways scroll (' + s.overflowX + ')');
        check(!!light === (await p.evaluate(() => document.documentElement.getAttribute('data-theme') === 'light')), tag + ': theme applied');
        if (vp.w !== 412) await shot(p, 'screener-stocks-' + tag + '.png');
        if (vp.w === 412 && !light) await shot(p, 'screener-stocks-' + tag + '.png');
        for (const [m, name] of [['etf', 'ETFs'], ['crypto', 'Crypto'], ['fut', 'Futures']]) {
          await p.click('.scn-seg [data-m="' + m + '"]');
          await p.waitForFunction((m) => window.__stkScn && window.__stkScn.m === m && window.__stkScn.tables[m] && window.__stkScn.tables[m].rows && document.querySelector('.scn-r'), m, { timeout: 8000 }).catch(() => {});
          await sleep(300);
          s = await state(p);
          check(s.on === name && s.total > 0 && s.drawn > 0, tag + ': ' + name + ' tab shows ' + s.total + ' of ' + s.all);
          if (m === 'fut') check(!s.heads.some((k) => ['imb', 'bw', 'aw', 'delta', 'bigN'].includes(k)) && !(await p.$('[data-set="flow"]')), tag + ': futures book columns and set hidden without the gate');
          if (vp.w !== 412) await shot(p, 'screener-' + name.toLowerCase() + '-' + tag + '.png');
        }
        check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
        await ctx.close();
      }
    }
    // ---- interaction at 390 (touch) ----
    const { ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true });
    const n0 = (await state(p)).total;
    await p.tap('[data-fadd]'); await sleep(400);
    const sh = await p.evaluate(() => { const d = document.querySelector('.mv-sheet'); const r = d && d.getBoundingClientRect(); const btn = document.querySelector('.mv-sheet .btn'); const br = btn && btn.getBoundingClientRect(); return d ? { bottom: r.bottom, left: r.left, right: r.right, top: r.top, btnH: br.height, selH: document.querySelector('.mv-sheet select').getBoundingClientRect().height } : null; });
    check(sh && sh.bottom >= 843 && sh.left >= -1 && sh.right <= 391, '390: filter sheet is a bottom sheet inside the viewport');
    check(sh && sh.btnH >= 44 && sh.selH >= 44, '390: sheet controls >= 44px (' + (sh && sh.btnH) + '/' + (sh && sh.selH) + ')');
    await shot(p, 'screener-filter-sheet-390.png');
    await p.selectOption('.mv-sheet select[name=f]', 'chg'); await p.selectOption('.mv-sheet select[name=op]', 'gt'); await p.fill('.mv-sheet input[name=v]', '3');
    await p.tap('.mv-sheet button[type=submit]'); await sleep(400);
    let s = await state(p);
    const st = PARTS.stock.d, want = st.d.chg.filter((v) => typeof v === 'number' && v > 3).length;
    check(s.total === want && want > 0 && want < n0, '390: Change % > 3 -> ' + s.total + ' (expect ' + want + ')');
    check(!(await p.$('.mv-sheet-wrap')), '390: sheet closed after Add');
    const chip = await p.evaluate(() => document.querySelector('.scn-fchip').innerText);
    check(/Change/i.test(chip), '390: chip shows "' + chip.replace(/\n/g, ' ') + '"');
    // the quick screen's own condition was carried into the chips: remove every chip
    for (let i = 0; i < 4 && (await p.$('[data-fdel="0"]')); i++) { await p.tap('[data-fdel="0"]'); await sleep(250); }
    check((await state(p)).total === (await state(p)).all, '390: removing the chips clears the filter');
    // between + cross
    await p.tap('[data-fadd]'); await sleep(300);
    await p.selectOption('.mv-sheet select[name=f]', 'rsi'); await p.selectOption('.mv-sheet select[name=op]', 'bt'); await p.fill('.mv-sheet input[name=v]', '60'); await p.fill('.mv-sheet input[name=v2]', '70');
    await p.tap('.mv-sheet button[type=submit]'); await sleep(300);
    s = await state(p);
    const ri = st.cols.indexOf('rsi'); const wantR = st.d.rsi.filter((v) => typeof v === 'number' && v >= 60 && v <= 70).length;
    check(s.total === wantR, '390: RSI between 60 and 70 -> ' + s.total + ' (expect ' + wantR + ')');
    // sort on tap
    await p.tap('[data-sort="c"]'); await sleep(300);
    const asc = await p.evaluate(() => window.__stkScn.view.slice(0, 20).map((r) => r.c));
    check(asc.every((v, i) => i === 0 || (v != null && asc[i - 1] <= v)) || asc.every((v, i) => i === 0 || asc[i - 1] >= v), '390: tap header sorts price');
    // column picker
    await p.tap('[data-pick]'); await sleep(300);
    await shot(p, 'screener-columns-sheet-390.png');
    await p.tap('.mv-sheet input[value="atr"]'); await p.tap('.mv-sheet [data-apply]'); await sleep(300);
    check((await state(p)).heads.includes('atr'), '390: column picker adds ATR');
    // column set
    await p.tap('[data-set="tech"]'); await sleep(300);
    check((await state(p)).heads.includes('rsi'), '390: Technicals set');
    // virtual scroll
    await p.tap('[data-fdel="0"]').catch(() => {});
    await p.evaluate(() => { const v = document.getElementById('scn-vp'); v.scrollTop = 56 * 300; }); await sleep(300);
    const mid = await p.evaluate(() => ({ first: +document.querySelector('.scn-r').getAttribute('data-i'), n: document.querySelectorAll('.scn-r').length }));
    check(mid.first > 200 && mid.n < 80, '390: scrolled deep, rows ' + mid.first + '+ (' + mid.n + ' in DOM)');
    // row -> charts (futures)
    await p.tap('.scn-seg [data-m="fut"]'); await sleep(800);
    const [nav] = await Promise.all([p.waitForRequest((r) => /charts\?symbol=/.test(r.url()), { timeout: 5000 }).catch(() => null), p.tap('.scn-r')]);
    check(nav && /charts\?symbol=futures%3A[A-Z0-9]+1!$/.test(nav.url()), '390: futures row opens ' + (nav && nav.url()));
    check(!errors.length, '390: no page errors ' + errors.join(' | ').slice(0, 300));
    await ctx.close();
    // ---- Pro gate: GEX levels ----
    {
      const o = await open(b, { w: 390, h: 844, mobile: true, free: true });
      await o.p.tap('.scn-seg [data-m="etf"]'); await sleep(800);
      check(!!(await o.p.$('[data-lock="gex"]')), '390 free: GEX levels chip is locked with a PRO tag');
      const txt = await o.p.evaluate(() => document.body.innerText);
      check(!/\$\s?\d/.test(txt.replace(/\$[A-Z]/g, '')), '390 free: no prices on the page');
      check(!(await o.p.$('[data-sort="cw"]')), '390 free: no GEX column in the table');
      await o.p.evaluate(() => { window.__plan = []; window.openPlanUpgradeModal = (w) => { window.__plan.push(w); }; });
      await o.p.tap('[data-lock="gex"]'); await sleep(200);
      check((await o.p.evaluate(() => window.__plan)).length === 1, '390 free: tap opens the plan modal');
      await shot(o.p, 'screener-gex-locked-390.png');
      await o.ctx.close();
      const q = await open(b, { w: 390, h: 844, mobile: true });
      await q.p.tap('.scn-seg [data-m="etf"]'); await sleep(600);
      await q.p.tap('[data-set="gexs"]'); await q.p.waitForFunction(() => window.__stkScn.rows.some((x) => x.cw != null), null, { timeout: 9000 }).catch(() => {}); await sleep(300);
      const cw = await q.p.evaluate(() => { const r = window.__stkScn.rows.filter((x) => /:SPY$/.test(x.s))[0]; return r && [r.cw, r.zg, r.pw]; });
      check(cw && cw.join() === '700,690,680', '390 pro: SPY GEX levels ' + cw);
      await shot(q.p, 'screener-gex-pro-390.png');
      await q.ctx.close();
    }
    // ---- share link: build in one page, open in a fresh one ----
    {
      const o = await open(b, { w: 390, h: 844, mobile: true });
      await o.p.tap('[data-fadd]'); await sleep(300);
      await o.p.selectOption('.mv-sheet select[name=f]', 'chg'); await o.p.selectOption('.mv-sheet select[name=op]', 'gt'); await o.p.fill('.mv-sheet input[name=v]', '3');
      await o.p.tap('.mv-sheet button[type=submit]'); await sleep(300);
      await o.p.evaluate(() => { window.prompt = (m, u) => { window.__link = u; }; Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); });
      await o.p.tap('[data-share]'); await sleep(300);
      const link = await o.p.evaluate(() => window.__link);
      check(/scanner\.html\?s=/.test(link || ''), '390: share link built ' + (link || '').slice(0, 80));
      const want = PARTS.stock.d.d.chg.filter((v) => typeof v === 'number' && v > 3).length;
      await o.ctx.close();
      const o2 = await open(b, { w: 390, h: 844, mobile: true, url: link });
      const s2 = await state(o2.p);
      check(s2.total === want, '390: opened share link -> ' + s2.total + ' rows (expect ' + want + ')');
      await o2.p.tap('[data-saved]'); await sleep(300);
      check(/Sign in/.test(await o2.p.evaluate(() => (document.querySelector('.mv-sheet') || {}).innerText || '')), '390: saved screens ask for sign-in when signed out');
      await shot(o2.p, 'screener-saved-signedout-390.png');
      await o2.ctx.close();
    }
    // ---- crypto row + stock row ----
    const o = await open(b, { w: 1440, h: 900 });
    await o.p.click('.scn-seg [data-m="crypto"]'); await sleep(700);
    const [nav2] = await Promise.all([o.p.waitForRequest((r) => /charts\?symbol=/.test(r.url()), { timeout: 5000 }).catch(() => null), o.p.click('.scn-r')]);
    check(nav2 && /charts\?symbol=(binance|coinbase)%3A[A-Z0-9]+$/.test(nav2.url()), '1440: crypto row opens ' + (nav2 && nav2.url()));
    await o.ctx.close();
    const o2 = await open(b, { w: 1440, h: 900 });
    await o2.p.click('.scn-r'); await sleep(300);
    check(!!(await o2.p.$('.mv-sheet')), '1440: single stock row opens the info sheet');
    await shot(o2.p, 'screener-info-sheet-1440.png');
    await o2.ctx.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
