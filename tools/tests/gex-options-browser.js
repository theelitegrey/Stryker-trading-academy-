// GEX page "Options analytics" panel (assets/gex-options.js) at 1440 and 390, Pro and Free.
// The recorder's /opt-analytics is answered from fixtures (real feeder output, 2026-10-14).
//   node tools/tests/chart-dev-server.mjs 8061
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8061 node --max-old-space-size=768 tools/tests/gex-options-browser.js [shotsDir]
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061';
const OUT = process.argv[2] || '/tmp';
const FX = (u) => path.join(__dirname, 'fixtures', 'opt-analytics-' + u + '.json');
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(b, w, h, free) {
  const mobile = w < 500;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((isFree) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
    // plan-limits.js assigns window.strykerPlanTier; pin it to the plan under test.
    const fn = () => Promise.resolve({ free: isFree });
    Object.defineProperty(window, 'strykerPlanTier', { get: () => fn, set: () => {}, configurable: true });
  }, free);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const asked = [];   // registered after the catch-all abort: Playwright tries the newest route first
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/opt-analytics/, (r) => {
    const u = new URL(r.request().url()).searchParams.get('u');
    asked.push(u);
    const f = FX(u);
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'no data' });
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j.t = Math.floor(Date.now() / 1000) - 7 * 60;   // "updated 7 min ago"
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(j) });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE + '/gex.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.querySelector('#gex-options .gexo-table, #gex-options .plan-lock, #gex-options .gexo-empty'), null, { timeout: 20000 });
  await sleep(600);
  const tag = (free ? 'free' : 'pro') + '-' + w;
  const s = await p.evaluate(() => {
    const host = document.getElementById('gex-options');
    const rows = [...host.querySelectorAll('.gexo-table tbody tr')].map((tr) => tr.innerText.replace(/\s+/g, ' ').trim());
    return { rows, head: [...host.querySelectorAll('.gexo-table thead th')].map((x) => x.textContent), stats: [...host.querySelectorAll('.gexo-stat')].map((x) => x.innerText.replace(/\s+/g, ' ')),
      svgs: host.querySelectorAll('.gexo-svg').length, dots: host.querySelectorAll('.gexo-dot').length, bars: host.querySelectorAll('.gexo-bar-pos, .gexo-bar-neg').length,
      ago: host.querySelector('.gexo-ago').textContent, text: host.innerText, edu: !!host.querySelector('.gex-edu'),
      tableFits: (() => { const w = host.querySelector('.gexo-tablewrap'); return !w || w.scrollWidth <= w.clientWidth + 1; })(), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, hostW: host.getBoundingClientRect().width };
  });
  check(!/\b(live|real-time|realtime|delayed|behind)\b/i.test(s.text), tag + ': no live / real-time / delayed / behind wording');
  check(s.edu && /Education only\. Not financial advice\./.test(s.text), tag + ': education disclaimer');
  check(s.sw <= s.cw + 1 && s.tableFits, tag + ': no horizontal page overflow (' + s.sw + ' <= ' + s.cw + ')');
  check(s.rows.length >= 3 && new Set(s.rows.map((r) => r.split(' ')[1] + r.split(' ')[2])).size === s.rows.length && /^0DTE/.test(s.rows[0]), tag + ': expected move rows ' + JSON.stringify(s.rows.slice(0, 2)));
  check(s.head.some((x) => /ES move/.test(x)), tag + ': ES column for SPX');
  check(s.stats.length === 6 && /IV rank \(VIX\)/i.test(s.stats[0]), tag + ': six stats incl. IV rank (VIX): ' + s.stats[0]);
  check(s.svgs === 2 && s.dots > 10 && s.bars > 10, tag + ': term structure + skew charts drawn (' + s.dots + ' dots, ' + s.bars + ' bars)');
  check(/updated 7 min ago/.test(s.ago), tag + ': "' + s.ago + '"');
  await p.locator('#gex-options').scrollIntoViewIfNeeded();
  await sleep(200);
  const shot = path.join(OUT, 'gex-options-' + tag + '.png');
  await p.locator('#gex-options').screenshot({ path: shot });
  console.log('shot', shot);
  // QQQ: Pro sees NQ mapping; Free sees the lock card
  await p.click('#gex-options .gexo-tab[data-u="QQQ"]');
  await sleep(700);
  const q = await p.evaluate(() => ({ lock: !!document.querySelector('#gex-options .plan-lock'), head: [...document.querySelectorAll('#gex-options .gexo-table thead th')].map((x) => x.textContent), stat0: (document.querySelector('#gex-options .gexo-stat') || {}).innerText || '' }));
  if (free) check(q.lock && !asked.includes('QQQ'), tag + ': QQQ locked for Free, not fetched');
  else check(!q.lock && q.head.some((x) => /NQ move/.test(x)) && /VXN/.test(q.stat0), tag + ': QQQ shows NQ mapping + VXN rank');
  if (free) {
    const shot2 = path.join(OUT, 'gex-options-' + tag + '-qqq-lock.png');
    await p.locator('#gex-options').screenshot({ path: shot2 });
    console.log('shot', shot2);
  }
  check(!errs.length, tag + ': no page errors ' + errs.slice(0, 2).join(' | '));
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    await run(b, 1440, 1000, false);
    await run(b, 390, 844, false);
    await run(b, 390, 844, true);
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
