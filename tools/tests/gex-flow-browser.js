// GEX page "Options volume by strike" panel (assets/gex-flow.js) at 1440 and 390, Pro and Free.
// /api/gex/flow/:u is answered with functions/api/gex/_flow.js run on REAL stored chains (fixtures/gex/flow-*-near.json.gz,
// session 2026-10-23), fetched_at pinned to 9 min ago. No network.
//   node tools/tests/chart-dev-server.mjs 8073
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8073 node --max-old-space-size=768 tools/tests/gex-flow-browser.js [shotsDir]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8073';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let F;
const body = (u) => { const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/gex/flow-' + u + '-near.json.gz'))).toString()); const o = F.flowFromChain(d); o.u = u; o.fetched_at = Math.floor(Date.now() / 1000) - 9 * 60; return o; };

async function run(b, w, h, free) {
  const mobile = w < 500;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((isFree) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
    const fn = () => Promise.resolve({ free: isFree });
    Object.defineProperty(window, 'strykerPlanTier', { get: () => fn, set: () => {}, configurable: true });
  }, free);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const asked = [];
  await ctx.route(/127\.0\.0\.1:\d+\/api\/gex\/flow\//, (r) => {
    const u = r.request().url().split('/').pop().toUpperCase(); asked.push(u);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body(u)) });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE + '/gex.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.querySelector('#gex-flow .gexf-row, #gex-flow .gexo-empty:not(:empty)'), null, { timeout: 20000 });
  await p.waitForFunction(() => document.querySelector('#gex-flow .gexf-row'), null, { timeout: 10000 }).catch(() => {});
  await sleep(500);
  const tag = (free ? 'free' : 'pro') + '-' + w;
  const want = body('SPX');
  const s = await p.evaluate(() => {
    const host = document.getElementById('gex-flow');
    return { rows: [...host.querySelectorAll('.gexf-row')].map((r) => r.title), spot: host.querySelectorAll('.gexf-spot').length, chips: [...host.querySelectorAll('.gexf-exp')].map((x) => x.textContent),
      stats: [...host.querySelectorAll('.gexo-stat b')].map((x) => x.textContent), ago: host.querySelector('.gexf-ago').textContent, text: host.innerText,
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, over: [...host.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').length };
  });
  check(s.rows.length === 20 && s.spot === 1, tag + ': 20 strikes around spot + one spot line (' + s.rows.length + ')');
  check(s.chips.length === 4 && s.chips[3] === 'All 3', tag + ': expiry chips ' + s.chips.join('|'));
  const e0 = want.expiries[0];
  const k = (v) => v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e4 ? Math.round(v / 1e3) + 'K' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(v);
  check(s.stats[0] === k(e0.calls) && s.stats[1] === k(e0.puts) && s.stats[2] === e0.pc.toFixed(2), tag + ': totals match the API (' + s.stats.join(' / ') + ')');
  check(/updated 9 min ago/.test(s.ago), tag + ': "' + s.ago + '"');
  check(!/\b(live|real-time|realtime|bullish|bearish|bought|sold)\b/i.test(s.text), tag + ': no live / real-time / direction wording');
  check(/Education only\. Not financial advice\./.test(s.text), tag + ': education disclaimer');
  check(s.sw <= s.cw + 1 && s.over === 0, tag + ': no horizontal overflow, no scroll regions');
  await p.locator('#gex-flow').scrollIntoViewIfNeeded(); await sleep(200);
  await p.locator('#gex-flow').screenshot({ path: path.join(OUT, 'gex-flow-' + tag + '.png') });
  await p.click('#gex-flow .gexf-exp:last-child'); await sleep(300);
  const all = await p.evaluate(() => [...document.querySelectorAll('#gex-flow .gexo-stat b')].map((x) => x.textContent));
  check(all[0] === k(want.all.calls), tag + ': "All 3" totals (' + all[0] + ')');
  await p.click('#gex-flow .gexf-tab[data-u="QQQ"]'); await sleep(700);
  const q = await p.evaluate(() => ({ lock: !!document.querySelector('#gex-flow .plan-lock, #gex-flow .gexo-empty'), rows: document.querySelectorAll('#gex-flow .gexf-row').length }));
  if (free) check(q.rows === 0 && !asked.includes('QQQ'), tag + ': QQQ locked for Free, not fetched');
  else { check(q.rows === 20 && asked.includes('QQQ'), tag + ': QQQ shows its ladder'); await p.locator('#gex-flow').screenshot({ path: path.join(OUT, 'gex-flow-' + tag + '-qqq.png') }); }
  check(!errs.length, tag + ': no page errors ' + errs.slice(0, 2).join(' | '));
  await ctx.close();
}

(async () => {
  F = await import(path.resolve(__dirname, '../../functions/api/gex/_flow.js'));
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    await run(b, 1440, 1000, false);
    await run(b, 390, 844, false);
    await run(b, 390, 844, true);
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
