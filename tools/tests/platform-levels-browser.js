// "Use our levels in your platform" page. Needs the repo served on PL_BASE (python3 -m http.server 8097 --directory <repo>).
//   flock /tmp/stryker-chrome.lock env PL_BASE=http://127.0.0.1:8097 node tools/tests/platform-levels-browser.js [shotsDir]
// The /api/lv/* answers come from tools/tests/fixtures/platform-levels (made from the feeder sample by the same code as the Worker).
const fs = require('fs'), path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.PL_BASE || 'http://127.0.0.1:8097';
const OUT = process.argv[2] || '/tmp';
const FX = path.join(__dirname, 'fixtures', 'platform-levels');
const rd = (f) => fs.readFileSync(path.join(FX, f), 'utf8');
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SECRET = 'S'.repeat(43);

async function mock(ctx, state) {
  await ctx.route('**/api/lv/**', (r) => {
    const u = new URL(r.request().url()), m = r.request().method();
    state.calls.push(m + ' ' + u.pathname + u.search);
    if (state.mode === 'free') return r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"pro_required"}' });
    if (u.pathname.endsWith('/pack')) {
      const f = u.searchParams.get('format');
      return r.fulfill({ status: 200, contentType: f === 'json' ? 'application/json' : 'text/plain', body: rd(f === 'json' ? 'pack-json.json' : 'pack-' + f + '.txt') });
    }
    if (u.pathname.endsWith('/token')) {
      if (m === 'POST') { state.active = true; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: true, secret: SECRET, exp: Date.now() + 30 * 864e5 }) }); }
      if (m === 'DELETE') { state.active = false; return r.fulfill({ status: 200, contentType: 'application/json', body: '{"active":false}' }); }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.active ? { active: true, made: 1, exp: Date.now() + 29 * 864e5, last: null } : { active: false }) });
    }
    return r.fulfill({ status: 404, body: '{}' });
  });
}

(async () => {
  const b = await launch();
  try {
    for (const [tag, vw, mobile, theme] of [['390-dark', 390, true, 'dark'], ['1440-dark', 1440, false, 'dark'], ['1440-light', 1440, false, 'day']]) {
      const ctx = await b.newContext({ viewport: { width: vw, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
      await ctx.addInitScript(stub);
      await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t); localStorage.setItem('tz_consent', JSON.stringify({ v: 1, essential: true, analytics: false, at: new Date().toISOString() })); } catch (e) {} }, theme);
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      const state = { mode: 'pro', active: false, calls: [] };
      await mock(ctx, state);
      const p = await ctx.newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(BASE + '/platform-levels.html', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => document.querySelector('#pl-prev tbody tr') || !document.getElementById('pl-wall').hidden, null, { timeout: 15000 }).catch(() => {}); await sleep(600);
      await p.screenshot({ path: path.join(OUT, 'pl-' + tag + '-top.png') }); console.log('SHOT ' + path.join(OUT, 'pl-' + tag + '-top.png'));
      check(await p.isVisible('#pl-app'), tag + ': page shows for a Pro member');
      check(await p.evaluate(() => document.querySelectorAll('#pl-prev tbody tr:not(.pl-g)').length) === 15, tag + ': 15 level rows in the preview');
      check(await p.evaluate(() => document.querySelectorAll('#pl-list details').length) === 9, tag + ': nine platform rows');
      const txt = await p.evaluate(() => document.body.innerText);
      check(/Updated (\d+ (min|h|d) ago|just now)/.test(txt) && !/delayed|real-time|\blive\b|behind/i.test(txt), tag + ': says updated X ago, no banned words');
      check(!/\$\s?\d+\s*\/\s*(mo|month)|per month/i.test(txt), tag + ': no prices on the page');
      check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ': no horizontal scroll');
      const hs = await p.evaluate(() => [...document.querySelectorAll('.pl-btn, .pl-seg button')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => r.height));
      check(hs.every((h) => h >= 40), tag + ': buttons at least 40 high (' + Math.min(...hs) + ')');
      await p.click('#pl-syms button[data-u="ES"]'); await sleep(400);
      check(state.calls.some((c) => /\/pack\?u=ES&inc=gex,em,nodes,dp&format=json/.test(c)), tag + ': picking ES asks for ES');
      await p.click('#pl-syms button[data-u="SPX"]');
      await p.uncheck('input[data-inc="dp"]'); await sleep(400);
      check(state.calls.some((c) => /u=SPX&inc=gex,em,nodes&format=json/.test(c)), tag + ': unticking dark pool drops it from the request');
      await p.check('input[data-inc="dp"]'); await sleep(300);
      check(await p.isHidden('#pl-link'), tag + ': no link box before a link exists');
      await p.click('#pl-make'); await sleep(600);
      const url = await p.inputValue('#pl-url');
      check(url === BASE + '/api/lv/feed/' + SECRET + '.csv?u=SPX&inc=gex,em,nodes,dp', tag + ': link box shows the private link: ' + url.replace(SECRET, '<secret>'));
      check(await p.isVisible('#pl-off'), tag + ': Turn link off is offered');
      await p.click('details[data-p="nt8"] summary'); await sleep(200);
      check((await p.locator('details[data-p="nt8"] .pl-steps li').count()) === 3, tag + ': NinjaTrader has a 3-step guide');
      await p.click('details[data-p="nt8"] button[data-a="1"]'); await sleep(300);
      const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
      check(clip === url, tag + ': Copy link puts the link on the clipboard');
      await p.click('details[data-p="tv"] summary'); await sleep(200);
      await p.click('details[data-p="tv"] button[data-a="0"]'); await sleep(500);
      const clip2 = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
      check(/^ZL1\|SPX\|/.test(clip2) && clip2.includes(';Call Ceiling=7450;'), tag + ': TradingView copy = the one-line levels string');
      await p.click('details[data-p="sc"] summary'); await sleep(200);
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 6000 }).catch(() => null), p.click('details[data-p="sc"] button[data-a="0"]')]);
      check(dl && dl.suggestedFilename() === 'tradezoro-levels-SPX.csv', tag + ': Sierra file downloads as ' + (dl && dl.suggestedFilename()));
      const sc = dl ? fs.readFileSync(await dl.path(), 'utf8') : '';
      check(sc.startsWith('symbol,type,label,price,value,day,updated'), tag + ': file has the header row');
      const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 6000 }).catch(() => null), p.click('details[data-p="tv"] button[data-a="1"]')]);
      check(dl2 && dl2.suggestedFilename() === 'tradezoro-levels.pine', tag + ': Pine script downloads');
      await p.screenshot({ path: path.join(OUT, 'pl-' + tag + '.png'), fullPage: tag === '390-dark' }); console.log('SHOT ' + path.join(OUT, 'pl-' + tag + '.png'));
      await p.click('#pl-off'); await sleep(500);
      check(await p.isHidden('#pl-link') && state.calls.some((c) => c.startsWith('DELETE')), tag + ': Turn link off calls DELETE and hides the link');
      check(!(await p.evaluate(() => localStorage.getItem('tz_lv_secret'))), tag + ': secret removed from this browser');
      check(!errors.length, tag + ': no page errors ' + errors.slice(0, 2).join(' / '));
      state.mode = 'free';
      await p.goto(BASE + '/platform-levels.html', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => document.querySelector('#pl-prev tbody tr') || !document.getElementById('pl-wall').hidden, null, { timeout: 15000 }).catch(() => {}); await sleep(600);
      check(await p.isHidden('#pl-app') && await p.isVisible('#pl-wall'), tag + ': free member sees the Pro card, not the tools');
      check(!/\$\d/.test(await p.evaluate(() => document.getElementById('pl-wall').innerText)), tag + ': Pro card shows no price here');
      if (tag === '390-dark') { await p.screenshot({ path: path.join(OUT, 'pl-' + tag + '-locked.png') }); console.log('SHOT ' + path.join(OUT, 'pl-' + tag + '-locked.png')); }
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
