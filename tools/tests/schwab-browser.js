// Schwab row browser test + shots. CHART_BASE=http://127.0.0.1:8044 node tools/tests/schwab-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8044';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 200))); };
async function open(b, w, h, mobile, theme, configured) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
  await ctx.route(/\/connect\/schwab\/token/, (r) => configured ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":true,"client_id":"FAKECLIENTID1"}' }) : r.fulfill({ status: 503, contentType: 'application/json', body: '{"configured":false}' }));
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const reqs = []; ctx.on('request', (r) => reqs.push(r.url()));
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && document.querySelector('#byo-btn'), null, { timeout: 45000 });
  await p.waitForTimeout(800);
  return { ctx, p, reqs };
}
(async () => {
  const b = await launch();
  for (const [w, h, mobile, theme, tag] of [[1440, 900, false, 'dark', 'd1440'], [390, 844, true, 'dark', 'd390'], [1440, 900, false, 'day', 'l1440'], [390, 844, true, 'day', 'l390']]) {
    for (const cfg of [false, true]) {
      const { ctx, p, reqs } = await open(b, w, h, mobile, theme, cfg);
      const t = tag + (cfg ? ' on: ' : ' off: ');
      await p.evaluate(() => document.querySelector('#byo-btn').click());
      await p.waitForSelector('.byo-row[data-src="schwab"]');
      await p.waitForTimeout(500);
      const txt = await p.$eval('.byo-row[data-src="schwab"] button', (x) => [x.textContent, x.disabled]);
      check(cfg ? txt[0] === 'Connect' && !txt[1] : txt[0] === 'Coming soon' && txt[1], t + 'Schwab button', txt);
      await p.screenshot({ path: `${OUT}/schwab-${tag}-${cfg ? 'on' : 'off'}.png` });
      check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), t + 'no horizontal overflow');
      if (cfg && tag === 'd1440') {   // stub user is signed in: Connect must leave for Schwab's own page with state, nothing else
        await ctx.route(/api\.schwabapi\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'schwab' }));
        await p.evaluate(() => { document.querySelector('.byo-row[data-src="schwab"] button').click(); });
        await p.waitForURL(/api\.schwabapi\.com\/v1\/oauth\/authorize/, { timeout: 5000 }).catch(() => {});
        const u = new URL(p.url());
        check(u.hostname === 'api.schwabapi.com' && u.searchParams.get('client_id') === 'FAKECLIENTID1' && u.searchParams.get('redirect_uri') === 'https://tradezoro.com/connect/schwab/callback' && (u.searchParams.get('state') || '').length >= 20, t + 'Connect goes to Schwab authorize with state', u.search);
      }
      await ctx.close();
    }
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: !!mobile });
    await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(BASE + '/schwab-callback.html?error=access_denied&error_description=%3Cb%3Ex%3C/b%3E', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(600);
    check(!p.url().includes('error'), tag + ' callback strips the query', p.url());
    check(!(await p.$('main b')), tag + ' callback shows nothing from the URL');
    await p.screenshot({ path: `${OUT}/schwab-callback-${tag}.png` });
    await ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
