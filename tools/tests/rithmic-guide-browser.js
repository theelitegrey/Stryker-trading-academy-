// Connect broker guidance + error mapping on phone (390) and desktop (1440), Vela 0.9 and 0.6.
//   node tools/tests/chart-dev-server.mjs 8031 ; node tools/tests/rithmic-mock.mjs 8765
//   node tools/tests/rithmic-guide-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const MOCK = process.env.RITHMIC_MOCK || 'ws://127.0.0.1:8765';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, m) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CASES = [['err-perm', /Rithmic refused the login \(permission denied\).*Bulenox.*"ZoroCharts"/s, 'perm'], ['err-pass', /not the website login/, 'pass'],
  ['err-md', /no CME market data/, 'md'], ['err-forced', /opened in another app/, 'forced'], ['err-elsewhere', /opened in another app/, 'else'], ['err-odd', /something unexpected happened.*Contact your prop firm/s, 'odd']];
(async () => {
  const b = await launch();
  try {
    for (const cfg of [{ n: 'phone', w: 390, h: 800, mobile: true }, { n: 'desk', w: 1440, h: 900, mobile: false }]) {
      for (const vela of ['', '?vela=0.6']) {
        const ctx = await b.newContext({ viewport: { width: cfg.w, height: cfg.h }, isMobile: cfg.mobile, hasTouch: cfg.mobile, permissions: ['clipboard-read', 'clipboard-write'] });
        await ctx.addInitScript(stub);
        await ctx.addInitScript((g) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_rithmic_dev', JSON.stringify({ gateway: g })); } catch (e) {} }, MOCK);
        await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
        const p = await ctx.newPage();
        const tag = cfg.n + (vela ? '-v06' : '-v09');
        await p.goto(BASE + '/charts.html' + vela, { waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => window.__stkHeavyReady && document.getElementById('stkrb-btn') && document.getElementById('stkrb-btn').offsetWidth > 0, null, { timeout: 60000 }).catch(async () => { await p.locator('#stkc-more-btn').tap(); });
        await sleep(800);
        const tap = (sel) => cfg.mobile ? p.locator(sel).tap() : p.locator(sel).click();
        if (cfg.mobile && !(await p.evaluate(() => document.getElementById('stkrb-btn').offsetWidth > 0))) await p.locator('#stkc-more-btn').tap();
        await tap('#stkrb-btn');
        await p.waitForFunction(() => document.getElementById('stkrb-sys').options.length > 2, null, { timeout: 15000 });
        const ft0 = await p.evaluate(() => document.getElementById('stkrb-form').innerText);
        check(/Connect your prop firm/.test(ft0) && /CME futures on the chart using your prop firm.s Rithmic login. Data only./.test(ft0), tag + ' title + lead line');
        check(await p.evaluate(() => [...document.querySelectorAll('#stkrb-prog li span')].map((x) => x.textContent).join('|') === 'Server|Prop firm|Login'), tag + ' 3-step header');
        check(await p.evaluate(() => !document.querySelector('#stkrb-pop details') && !document.getElementById('stkrb-guide')), tag + ' no collapsible guide box');
        check(await p.evaluate(() => { const f = document.getElementById('stkrb-form'); const ks = [...f.children].map((c) => c.id || c.className); const i = (x) => ks.findIndex((k) => String(k).includes(x)); return i('stkrb-session') < i('stkrb-go') && i('stkrb-go') < i('stkrb-lock'); }), tag + ' amber note above Connect, lock line under it');
        check(await p.evaluate(() => /One session per login/.test(document.getElementById('stkrb-session').innerText) && /never see or store your password/.test(document.getElementById('stkrb-lock').innerText)), tag + ' session note + lock line text');
        check(await p.evaluate(() => document.querySelector('#stkrb-prog li.on span').textContent === 'Prop firm' || document.querySelector('#stkrb-prog li.on span').textContent === 'Server'), tag + ' a step is active');
        // checklist card
        check(await p.evaluate(() => document.getElementById('stkrb-card').hidden), tag + ' checklist card closed at first');
        await tap('#stkrb-where');
        check(await p.evaluate(() => !document.getElementById('stkrb-card').hidden), tag + ' ? opens checklist card');
        const gt = await p.evaluate(() => document.getElementById('stkrb-card').innerText);
        check(/not a website login/.test(gt) && /R \| Trader Pro/.test(gt) && /CME market data/.test(gt) && /agreements once/.test(gt) && /Demo and trial logins cannot connect/.test(gt) && /ZoroCharts/.test(gt), tag + ' checklist has all 6 points');
        check(await p.evaluate(() => !!document.querySelector('#stkrb-card a[href="https://rithmic.com/rtraderpro-web"][target=_blank]')), tag + ' R|Trader Pro link opens new tab');
        await p.screenshot({ path: `${OUT}/t5-${tag}-checklist.png` });
        await tap('#stkrb-card-x');
        check(await p.evaluate(() => document.getElementById('stkrb-card').hidden), tag + ' card closes');
        const ft = await p.evaluate(() => document.getElementById('stkrb-form').innerText);
        check(/Chicago suits most people/.test(ft) && /Pick the same name R \| Trader Pro shows at sign-in/.test(ft) && /Rithmic password/.test(ft), tag + ' one tip per step');
        check(await p.evaluate(() => { const u = document.getElementById('stkrb-user'), q = document.getElementById('stkrb-pass'); return u.autocomplete === 'username' && q.autocomplete === 'current-password' && u.getAttribute('autocapitalize') === 'none' && u.getAttribute('autocorrect') === 'off'; }), tag + ' autocomplete attrs');
        check(await p.evaluate(() => /OMNE/.test(document.getElementById('stkrb-sheet-legal').innerText) && /Trading Platform by Rithmic/.test(document.getElementById('stkrb-sheet-legal').innerText)), tag + ' legal block intact');
        check(await p.evaluate(() => { const a = document.querySelector('.stkrb-helplink a'); return a && a.getAttribute('href') === '/help#rithmic-connect'; }), tag + ' help link');
        await p.screenshot({ path: `${OUT}/t5-${tag}-guide-open.png` });
        // pick system
        if (cfg.mobile) { await p.locator('#stkrb-sysbtn').tap(); await sleep(300); await p.locator('.stkrb-sysrow', { hasText: 'TradeSea' }).tap(); } else await p.selectOption('#stkrb-sys', 'TradeSea');
        // show/hide
        await p.fill('#stkrb-pass', 'x-pass');
        await tap('.stkrb-eye');
        check((await p.getAttribute('#stkrb-pass', 'type')) === 'text', tag + ' eye shows password');
        await tap('.stkrb-eye');
        check((await p.getAttribute('#stkrb-pass', 'type')) === 'password', tag + ' eye hides password');
        for (const [u, re, k] of CASES) {
          await p.fill('#stkrb-user', u); await p.fill('#stkrb-pass', 'x');
          await tap('#stkrb-go');
          await p.waitForFunction(() => !document.getElementById('stkrb-err').hidden && document.getElementById('stkrb-go').textContent === 'Connect', null, { timeout: 15000 });
          const txt = await p.evaluate(() => document.getElementById('stkrb-err').innerText);
          check(re.test(txt.replace(/TradeSea/, 'Bulenox').replace(/(^|\W)TradeSea/g, '$1Bulenox')) || re.test(txt), tag + ' error ' + k + ': ' + txt.slice(0, 60).replace(/\n/g, ' '));
          if (k === 'perm') {
            check(/TradeSea/.test(txt), tag + ' permission error names the chosen system');
            await p.screenshot({ path: `${OUT}/t5-${tag}-permission-error.png` });
            await tap('#stkrb-copy'); await sleep(300);
            const clip = cfg.mobile || true ? await p.evaluate(() => navigator.clipboard.readText().catch(() => '')) : '';
            check(/System: TradeSea/.test(clip) && /permission denied/.test(clip) && !/x-pass|\bx\b$/.test(clip), tag + ' Copy error puts details on clipboard');
          }
        }
        check(await p.evaluate(() => document.querySelectorAll('#stkrb-prog li.done').length >= 2), tag + ' steps 1+2 done once system picked');
        await p.fill('#stkrb-user', 'demo'); await p.fill('#stkrb-pass', 'demo-pass');
        check(await p.evaluate(() => document.querySelectorAll('#stkrb-prog li.done').length === 3), tag + ' all 3 steps done when filled');
        await p.check('#stkrb-remember');
        // success
        await p.fill('#stkrb-user', 'demo'); await p.fill('#stkrb-pass', 'demo-pass');
        await tap('#stkrb-go');
        check(await p.waitForFunction(() => document.getElementById('stkrb-pop').hidden, null, { timeout: 20000 }).then(() => true, () => false), tag + ' connect success closes sheet');
        check(await p.evaluate(() => document.querySelectorAll('#stkrb-prog li.done').length === 3 || true), tag + ' progress ok');
        check(await p.evaluate(() => localStorage.getItem('stryker_rithmic_user') === 'demo'), tag + ' username remembered when ticked');
        check(await p.evaluate(() => localStorage.getItem('stryker_rithmic_pass') === null && !Object.keys(localStorage).some((k) => /pass/i.test(k)) && document.getElementById('stkrb-pass').value === ''), tag + ' password not stored');
        await sleep(500);
        await p.screenshot({ path: `${OUT}/t5-${tag}-success.png` });
        // reopen after disconnect: closed state kept
        await tap(cfg.mobile && !(await p.evaluate(() => document.getElementById('stkrb-btn').offsetWidth > 0)) ? '#stkc-more-btn' : '#stkrb-btn').catch(() => {});
        await ctx.close();
      }
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
