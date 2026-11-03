// Alpaca + tastytrade sign-in sheet test + shots. CHART_BASE=http://127.0.0.1:8044 node tools/tests/oauth-more-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8011';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 200))); };
async function open(b, w, h, mobile, theme, configured) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
  await ctx.route(/\/connect\/(alpaca|tastytrade)\/token/, (r) => configured ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":true,"client_id":"FAKECLIENTID1"}' }) : r.fulfill({ status: 503, contentType: 'application/json', body: '{"configured":false}' }));
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
  const AUTH = { alpaca: ['app.alpaca.markets', '/oauth/authorize', 'data', 'Sign in with Alpaca'], tastytrade: ['my.tastytrade.com', '/auth.html', 'read', 'Sign in with tastytrade'] };
  for (const [w, h, mobile, theme, tag] of [[1440, 900, false, 'dark', 'd1440'], [390, 844, true, 'dark', 'd390'], [1440, 900, false, 'day', 'l1440'], [390, 844, true, 'day', 'l390']]) {
    for (const cfg of [false, true]) {
      const { ctx, p } = await open(b, w, h, mobile, theme, cfg);
      await p.evaluate(() => document.querySelector('#byo-btn').click());
      await p.waitForSelector('.byo-row[data-src="alpaca"]'); await p.waitForTimeout(500);
      for (const id of ['alpaca', 'tastytrade']) {
        const t = tag + (cfg ? ' on ' : ' off ') + id + ': ';
        const btn = await p.$eval(`.byo-row[data-src="${id}"] button`, (x) => [x.textContent, x.disabled]);
        check(btn[0] === (cfg ? 'Sign in' : 'Connect') && !btn[1], t + 'row button', btn);
        if (id === 'alpaca') await p.screenshot({ path: `${OUT}/oauth-list-${tag}-${cfg ? 'on' : 'off'}.png` });
        await p.evaluate((i) => document.querySelector(`.byo-row[data-src="${i}"] button`).click(), id);
        await p.waitForTimeout(350);
        if (cfg) {
          const si = await p.$('#byo-signin'), alt = await p.$('#byo-keyalt');
          check(!!si && !!alt, t + 'Sign in button + key link');
          if (si) {
            check((await si.textContent()).trim() === AUTH[id][3], t + 'button label');
            check(await p.$eval('#byo-signin img', (i) => i.complete && i.naturalWidth > 0 && /brokers\/(alpaca|tastytrade)\./.test(i.src)).catch(() => false), t + 'official logo loaded');
            check((await alt.textContent()).trim() === 'Use an API key instead', t + 'key link text');
            if (id === 'tastytrade') check(/two-factor/i.test(await p.$eval('.byo-body', (x) => x.textContent)), t + '2FA line shown');
          }
          check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), t + 'no horizontal overflow');
          await p.screenshot({ path: `${OUT}/oauth-${id}-signin-${tag}.png` });
          if (alt) { await alt.click(); await p.waitForTimeout(300); }
          check(!!(await p.$('form input')), t + 'key link opens the existing key form');
          await p.screenshot({ path: `${OUT}/oauth-${id}-keyform-${tag}.png` });
          if (tag === 'd1440') {   // back to the sign-in view, press Sign in: lands on the broker with ONLY the data scope
            await p.evaluate(() => document.querySelector('.byo-back').click()); await p.waitForTimeout(200);
            await p.evaluate((i) => document.querySelector(`.byo-row[data-src="${i}"] button`).click(), id); await p.waitForTimeout(300);
            await ctx.route(new RegExp(AUTH[id][0].replace(/\./g, '\\.')), (r) => r.fulfill({ status: 200, contentType: 'text/html', body: id }));
            await p.evaluate(() => document.querySelector('#byo-signin').click());
            await p.waitForURL(new RegExp(AUTH[id][0].replace(/\./g, '\\.')), { timeout: 5000 }).catch(() => {});
            const u = new URL(p.url());
            check(u.hostname === AUTH[id][0] && u.pathname === AUTH[id][1] && u.searchParams.get('scope') === AUTH[id][2] && u.searchParams.get('response_type') === 'code' && u.searchParams.get('redirect_uri') === `https://tradezoro.com/connect/${id}/callback` && (u.searchParams.get('state') || '').length >= 20, t + 'goes to broker with data-only scope', u.search);
            await p.goBack().catch(() => {}); await p.waitForTimeout(500);
            break;
          }
        } else {
          check(!!(await p.$('form input')) && !(await p.$('#byo-signin')), t + 'flag off: existing key form, no sign-in');
          if (id === 'tastytrade') await p.screenshot({ path: `${OUT}/oauth-${id}-keyform-${tag}-off.png` });
        }
        await p.evaluate(() => document.querySelector('.byo-back').click()); await p.waitForTimeout(250);
      }
      await ctx.close();
    }
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: !!mobile });
    await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(BASE + '/oauth-callback.html?error=access_denied&error_description=%3Cb%3Ex%3C/b%3E', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(600);
    check(!p.url().includes('error'), tag + ' callback strips the query', p.url());
    check(!(await p.$('main b')), tag + ' callback shows nothing from the URL');
    await p.screenshot({ path: `${OUT}/oauth-callback-${tag}.png` });
    await ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
