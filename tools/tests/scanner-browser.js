// Market scanner page (scanner.html + assets/scanner.js) at 1440 and 390, Pro and Free.
// /scan?part= is answered from tools/tests/fixtures/scan/*.json.gz (real feeder output 2026-10-14),
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
const FIX = path.join(__dirname, 'fixtures', 'scan');
const fresh = (name) => {
  const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FIX, name + '.json.gz'))));
  d.t = Math.floor(Date.now() / 1000) - 120;
  return { d, gz: zlib.gzipSync(JSON.stringify(d)) };
};
const PARTS = { presets: fresh('presets'), stock: fresh('stock'), crypto: fresh('crypto') };
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(b, { w, h, mobile, free }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((free) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker_scanner'); } catch (e) {}
    Object.defineProperty(window, 'strykerPlanTier', { configurable: false, get: () => () => Promise.resolve({ free: !!free }), set() {} });
  }, !!free);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const asked = [];
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/scan/, (r) => {
    const part = new URL(r.request().url()).searchParams.get('part'); asked.push(part);
    const x = PARTS[part];
    if (!x) return r.fulfill({ status: 404, body: 'no data' });
    r.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'x-scan-gzip': '1', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-scan-gzip, x-scan-t' }, body: x.gz });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/scanner.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.querySelector('#scn-root .scn-table, #scn-root .scn-empty:not(:first-child)'), null, { timeout: 30000 }).catch(() => {});
  await p.waitForFunction(() => document.querySelector('#scn-root .scn-table'), null, { timeout: 20000 }).catch(() => {});
  // the access gate's stub user cannot pass a real plan check: show the page shell for screenshots
  await p.evaluate(() => { document.querySelectorAll('.gate-pending').forEach((e) => e.classList.remove('gate-pending')); });
  await sleep(500);
  return { ctx, p, errors, asked };
}
const state = (p) => p.evaluate(() => {
  const rows = [...document.querySelectorAll('#scn-root .scn-table tbody tr')];
  const tw = document.querySelector('.scn-tw');
  return {
    tabs: [...document.querySelectorAll('.scn-tab')].map((t) => t.textContent.trim()),
    on: (document.querySelector('.scn-tab.on') || {}).textContent,
    n: rows.length,
    first: rows.slice(0, 5).map((r) => r.querySelector('th b').textContent),
    chg: rows.map((r) => r.querySelectorAll('td')[1].textContent),
    count: (document.querySelector('.scn-count') || {}).textContent,
    ago: (document.getElementById('scn-ago') || {}).textContent,
    edu: /Education only\. Not financial advice\./.test(document.body.innerText),
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    twScroll: tw ? getComputedStyle(tw).overflowX : null,
    lock: !!document.querySelector('.scn-lock .plan-lock, .scn-lock'),
    lockText: (document.querySelector('.scn-lock') || {}).textContent || ''
  };
});
const pnum = (s) => parseFloat(String(s).replace(/[+%×,]/g, ''));
async function shot(p, name) { await p.mouse.move(2, 2).catch(() => {}); await sleep(300); await p.screenshot({ path: OUT + '/' + name }); console.log('shot ' + OUT + '/' + name); }

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const vp of [{ w: 1440, h: 1000 }, { w: 390, h: 844, mobile: true }]) {
      const tag = vp.w;
      // ---- Pro ----
      let { ctx, p, errors, asked } = await open(b, vp);
      let s = await state(p);
      const pre = PARTS.presets.d.presets;
      check(s.on && /Top gainers/.test(s.on) && s.n === pre.gainers.rows.length, tag + ': gainers preset first, ' + s.n + ' rows');
      check(s.first[0] === pre.gainers.rows[0][0].split(':')[1], tag + ': first row = feeder first gainer ' + s.first[0]);
      check(s.tabs.length >= 14 && s.tabs.some((t) => /52-week highs/.test(t)) && s.tabs.some((t) => /Crypto gainers/.test(t)) && s.tabs.some((t) => /Custom filters/.test(t)), tag + ': tabs ' + s.tabs.length);
      check(/^Updated \d+ min ago$/.test(s.ago || ''), tag + ': status "' + s.ago + '"');
      check(!/live|real-time|delayed|behind/i.test(s.ago || ''), tag + ': no banned words');
      check(s.edu, tag + ': education line');
      check(s.overflowX <= 0, tag + ': no page-level sideways scroll (' + s.overflowX + ')');
      check(asked.every((x) => x === 'presets'), tag + ': presets only until custom is opened: ' + asked.join(','));
      if (tag === 1440) await shot(p, 'scanner-pro-1440.png'); else await shot(p, 'scanner-pro-390.png');
      // sort by Chg % ascending
      await p.click('[data-sort="chg"]'); await sleep(200);
      s = await state(p);
      const d1 = s.chg.map(pnum);
      check(d1.every((v, i) => i === 0 || d1[i - 1] >= v), tag + ': Chg % sorted desc on first click');
      await p.click('[data-sort="chg"]'); await sleep(200);
      s = await state(p);
      const d2 = s.chg.map(pnum);
      check(d2.every((v, i) => i === 0 || d2[i - 1] <= v), tag + ': second click sorts asc');
      // stock row -> info sheet
      await p.click('#scn-root tbody tr'); await sleep(300);
      const sheet = await p.evaluate(() => { const d = document.querySelector('.scn-sheet'); return d ? { t: d.innerText, r: d.getBoundingClientRect().toJSON() } : null; });
      check(sheet && /52-week high/i.test(sheet.t) && /Education only/i.test(sheet.t), tag + ': stock row opens the info sheet');
      check(sheet && sheet.r.right <= vp.w + 1 && sheet.r.left >= -1, tag + ': sheet inside the viewport');
      if (tag === 390) await shot(p, 'scanner-sheet-390.png'); else await shot(p, 'scanner-sheet-1440.png');
      await p.keyboard.press('Escape'); await sleep(200);
      check(!(await p.$('.scn-sheet')), tag + ': Escape closes the sheet');
      // other presets
      await p.click('[data-tab="high52"]'); await sleep(200);
      s = await state(p);
      check(s.n === pre.high52.rows.length, tag + ': 52-week highs ' + s.n);
      // custom filters (Pro)
      await p.click('[data-tab="__custom"]');
      await p.waitForSelector('.scn-filters', { timeout: 5000 });
      await p.waitForFunction(() => document.querySelector('.scn-count'), null, { timeout: 10000 });
      s = await state(p);
      const st = PARTS.stock.d, ci = st.cols.indexOf('chg');
      const want = st.d.chg.filter((v) => typeof v === 'number' && v > 3).length;
      check(new RegExp('^' + want + ' match').test(s.count || ''), tag + ': default filter chg > 3 -> ' + want + ' matches (' + s.count + ')');
      check(asked.includes('stock'), tag + ': the stock table loads only for custom');
      await p.fill('.scn-frow[data-i="0"] [data-fv]', '8'); await sleep(700);
      s = await state(p);
      const want8 = st.d.chg.filter((v) => typeof v === 'number' && v > 8).length;
      check(new RegExp('^' + want8 + ' match').test(s.count || ''), tag + ': typing 8 -> ' + want8 + ' (' + s.count + ')');
      check(await p.evaluate(() => document.activeElement && document.activeElement.matches('[data-fv]')), tag + ': focus stays in the value box');
      await p.click('[data-fadd]'); await sleep(300);
      s = await state(p);
      const want2 = st.cols.length && st.d.chg.filter((v, i) => typeof v === 'number' && v > 8 && typeof st.d.rvol[i] === 'number' && st.d.rvol[i] > 2).length;
      check(new RegExp('^' + want2 + ' match').test(s.count || ''), tag + ': + rvol > 2 -> ' + want2 + ' (' + s.count + ')');
      if (tag === 1440) await shot(p, 'scanner-custom-1440.png'); else await shot(p, 'scanner-custom-390.png');
      // crypto row -> charts link
      await p.selectOption('[data-cm]', 'crypto'); await sleep(600);
      await p.fill('.scn-frow[data-i="0"] [data-fv]', '-100'); await sleep(700);
      await p.click('.scn-frow[data-i="1"] [data-fx]'); await sleep(500);
      const [nav] = await Promise.all([p.waitForRequest((r) => /charts\?symbol=/.test(r.url()), { timeout: 5000 }).catch(() => null), p.click('#scn-root tbody tr')]);
      check(nav && /charts\?symbol=binance%3A[A-Z0-9]+USDT$/.test(nav.url()), tag + ': crypto row opens /charts?symbol=binance:XXXUSDT (' + (nav && nav.url()) + ')');
      check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
      await ctx.close();
      // ---- Free ----
      ({ ctx, p, errors, asked } = await open(b, Object.assign({ free: true }, vp)));
      s = await state(p);
      check(s.n > 0, tag + ' free: presets work');
      check(s.tabs.some((t) => /Custom filters\s*PRO/.test(t)), tag + ' free: Custom tab marked PRO');
      await p.click('[data-tab="__custom"]'); await sleep(800);
      s = await state(p);
      check(!(await p.$('.scn-filters')) && /Pro/.test(s.lockText), tag + ' free: custom shows the Pro lock card, no filters');
      check(!asked.includes('stock') && !asked.includes('crypto'), tag + ' free: no table download');
      if (tag === 390) await shot(p, 'scanner-free-lock-390.png'); else await shot(p, 'scanner-free-lock-1440.png');
      check(!errors.length, tag + ' free: no page errors ' + errors.join(' | ').slice(0, 300));
      await ctx.close();
    }
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
