// Data plans: /pricing + settings data card shots (390 + 1440, dark + light) and text checks.
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/data-plans-pages-shots.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=512'] });
  try {
    for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) for (const theme of ['dark', 'light']) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
      await ctx.addInitScript(stub);
      await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} }, theme);
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
      const p = await ctx.newPage();
      const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
      const tag = w + '-' + theme;
      await p.goto(BASE + '/pricing.html', { waitUntil: 'domcontentloaded' }); await sleep(3500);
      const pt = await p.evaluate(() => document.body.innerText);
      if (theme === 'dark') {
        check(/Data feed L1/.test(pt) && /Data feed L2/.test(pt) && /\$7/.test(pt) && /\$20/.test(pt), tag + ': pricing has L1 $7 + L2 $20');
        check(!/Get Pro|Join Pro/.test(pt), tag + ': pricing sells no Pro');
      }
      await p.screenshot({ path: OUT + '/dp-pricing-' + tag + '.png', fullPage: false });
      await p.evaluate(() => { const g = document.querySelector('.pricing-grid'); if (g) g.scrollIntoView({ block: 'start' }); });
      await sleep(400);
      await p.screenshot({ path: OUT + '/dp-pricing-cards-' + tag + '.png', fullPage: false });
      await p.goto(BASE + '/settings.html', { waitUntil: 'domcontentloaded' }); await sleep(3500);
      const card = await p.$('#settings-livedata-panel');
      const ct = card ? await card.innerText() : '';
      if (theme === 'dark') check(/Data/.test(ct) && /(None|L1|L2)/.test(ct), tag + ': settings data card', ct.slice(0, 200));
      if (card) { await card.scrollIntoViewIfNeeded(); await sleep(300); await card.screenshot({ path: OUT + '/dp-settings-' + tag + '.png' }); }
      check(errs.length === 0, tag + ': no page errors', errs);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
