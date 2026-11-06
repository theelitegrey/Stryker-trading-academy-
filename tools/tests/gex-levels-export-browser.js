// GEX+ "Download levels" dialog (ZoroOptions S3).  flock /tmp/stryker-chrome.lock env ZO_BASE=http://127.0.0.1:8095 node tools/tests/gex-levels-export-browser.js [shotsDir]
// ?fixture=1 downloads tools/tests/fixtures/zoro/levels-export.csv; the 403 case is routed to check the plan modal.
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.ZO_BASE || 'http://127.0.0.1:8095';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await launch();
  try {
    for (const [tag, vw, mobile] of [['1440', 1440, false], ['390', 390, true]]) {
      const ctx = await b.newContext({ viewport: { width: vw, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(() => { try { localStorage.setItem('tz_consent', JSON.stringify({ v: 1, essential: true, analytics: false, at: new Date().toISOString() })); localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      const p = await ctx.newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(BASE + '/gex.html?fixture=1', { waitUntil: 'domcontentloaded' }); await sleep(2500);
      check(await p.isVisible('#gex-dl-btn'), tag + ': Download levels button visible');
      const bh = await p.evaluate(() => document.getElementById('gex-dl-btn').getBoundingClientRect().height);
      check(bh >= (mobile ? 44 : 40), tag + ': button height ' + bh);
      await p.click('#gex-dl-btn'); await sleep(400);
      check(await p.evaluate(() => document.getElementById('gex-dl').open), tag + ': dialog opens');
      const v = await p.evaluate(() => ({ f: document.getElementById('gex-dl-from').value, t: document.getElementById('gex-dl-to').value }));
      check(/^\d{4}-\d\d-\d\d$/.test(v.f) && v.f < v.t, tag + ': default range ' + v.f + ' to ' + v.t);
      const ow = await p.evaluate(() => { const r = document.getElementById('gex-dl').getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1; });
      check(ow, tag + ': dialog inside the viewport');
      await p.screenshot({ path: path.join(OUT, 'S3-gex-dl-' + tag + '.png') }); console.log('SHOT ' + path.join(OUT, 'S3-gex-dl-' + tag + '.png'));
      // bad range
      await p.fill('#gex-dl-from', '2026-11-05'); await p.fill('#gex-dl-to', '2026-11-01'); await p.click('#gex-dl-go'); await sleep(200);
      check(/after the end/.test(await p.textContent('#gex-dl-msg')), tag + ': from > to refused');
      await p.fill('#gex-dl-from', '2026-11-01'); await p.fill('#gex-dl-to', '2026-11-03');
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }).catch(() => null), p.click('#gex-dl-go')]);
      check(!!dl, tag + ': file downloaded ' + (dl ? dl.suggestedFilename() : ''));
      check(dl && /^zoro-levels-SPX-2026-11-01_2026-11-03-15m\.csv$/.test(dl.suggestedFilename()), tag + ': file name carries symbol, range, step');
      // non-Pro: a 403 opens the plan modal
      await p.route('**/levels-export.csv', (r) => r.fulfill({ status: 403, body: '{"error":"pro_required"}' }));
      await p.click('#gex-dl-x'); await sleep(200); await p.click('#gex-dl-btn'); await sleep(200); await p.click('#gex-dl-go'); await sleep(800);
      check(await p.evaluate(() => !document.getElementById('gex-dl').open && !!document.querySelector('#plan-upgrade-modal.open, .plan-modal-overlay.open, [id*=plan][class*=open]')), tag + ': 403 closes the dialog and opens the plan modal');
      check(!errors.length, tag + ': no page errors ' + errors.slice(0, 2).join(' / '));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
