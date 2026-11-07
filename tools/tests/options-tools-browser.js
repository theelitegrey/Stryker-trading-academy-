// Options tools browser test + screenshots (options-calculator.html, iv-skew.html), fixture data from tools/fixtures/zoro (SPX).
//   python3 -m http.server 8097 --bind 127.0.0.1   (repo root)
//   flock /tmp/stryker-chrome.lock env OC_BASE=http://127.0.0.1:8097 node tools/tests/options-tools-browser.js [shotsDir]
// Cases: signed-out calculator (flat volatility), signed-in calculator (stub, volatility surface), every preset draws and gives sane numbers,
// leg edits + sliders move the numbers, skew page (two expiries, term structure, risk reversal), signed-out skew prompts sign-in,
// no banned words, no horizontal overflow at 390, no page errors, light + dark.
const fs = require('fs'); const path = require('path');
const { launch } = require('./lib.js'); const stub = require('./richstub.js');
const BASE = process.env.OC_BASE || 'http://127.0.0.1:8097'; const OUT = process.argv[2] || '/tmp';
let fail = 0; const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BANNED = /\blive\b|real-time|realtime|delayed|\bbehind\b|guarantee|win rate|bullish|bearish|smart money|whale/i;
async function open(b, o) {
  const ctx = await b.newContext({ viewport: { width: o.w, height: o.h || 900 }, deviceScaleFactor: o.mobile ? 2 : 1, isMobile: !!o.mobile, hasTouch: !!o.mobile });
  if (o.signedIn) await ctx.addInitScript(stub);
  await ctx.addInitScript((o) => { try { localStorage.setItem('tz_consent', JSON.stringify({ v: 1, essential: true, analytics: false, at: new Date().toISOString() })); if (o.light) localStorage.setItem('stryker_theme', 'day'); else localStorage.removeItem('stryker_theme'); if (o.signedIn) localStorage.setItem('stryker_nav_authed', '1'); } catch (e) {} }, o);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  if (o.lockSurface) await ctx.route('**/tools/fixtures/zoro/surface-iv.json', (r) => r.fulfill({ status: 403, body: '{"error":"pro_required"}' }));
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => { if (!/firebase|collection/i.test(String(e))) errors.push(String(e)); });   // Firebase is blocked offline in this test
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource|firebase|Firestore|reading 'collection'|collection/i.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + '/' + o.page + '.html?fixture=1', { waitUntil: 'domcontentloaded' }); await sleep(o.wait || 1800);
  return { ctx, p, errors };
}
async function shot(p, name) { await p.mouse.move(2, 2).catch(() => {}); await sleep(250); const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('SHOT ' + f); }
const txt = (p, s) => p.evaluate((s) => (document.querySelector(s) || {}).textContent || '', s);
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch();
  try {
    // ---- calculator, signed out, 390 dark ----
    let c = await open(b, { page: 'options-calculator', w: 390, h: 900, mobile: true, lockSurface: true });
    const p = c.p;
    check((await txt(p, '#oc-spot')).length > 2, 'calculator: spot shown');
    check(/Sample data/.test(await txt(p, '#oc-upd')) && /ago|just now/.test(await txt(p, '#oc-upd')), 'calculator: sample label + "Updated X ago"');
    check(await p.evaluate(() => !document.getElementById('oc-note-iv').hidden), 'calculator: signed-out note about one volatility level');
    check(await p.evaluate(() => document.querySelectorAll('.oc-leg').length === 1), 'calculator: default long call = 1 leg');
    const ids = await p.evaluate(() => Array.from(document.querySelectorAll('#oc-presets button')).map((b) => b.dataset.p));
    check(ids.length === 10, 'calculator: 10 presets');
    for (const id of ids) {
      await p.click('#oc-presets button[data-p="' + id + '"]'); await sleep(80);
      const r = await p.evaluate(() => { const c = document.getElementById('oc-chart'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 0) n++; return { n, stats: document.getElementById('oc-stats').innerText.replace(/\s+/g, ' '), legs: document.querySelectorAll('.oc-leg').length, nan: /NaN|undefined|Infinity/.test(document.getElementById('oc-stats').innerText + document.getElementById('oc-greeks').innerText) }; });
      check(r.n > 400 && !r.nan && r.legs >= 1, 'preset ' + id + ': chart painted, ' + r.legs + ' legs, no NaN');
    }
    await p.click('#oc-presets button[data-p="iron-condor"]'); await sleep(100);
    check(await p.evaluate(() => document.querySelectorAll('.oc-leg').length === 4), 'iron condor = 4 legs');
    check(/Estimate/.test(await txt(p, '#oc-stats')), 'chance of profit labelled Estimate');
    check(await p.evaluate(() => /Max profit/.test(document.getElementById('oc-stats').innerText) && /Break-evens/.test(document.getElementById('oc-stats').innerText)), 'max profit + break-evens shown');
    const before = await txt(p, '#oc-stats');
    await p.evaluate(() => { const s = document.getElementById('oc-ivs'); s.value = '50'; s.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(80);
    check((await txt(p, '#oc-iv-v')).startsWith('+50%'), 'IV slider label');
    await p.evaluate(() => { const s = document.getElementById('oc-date'); s.value = String(Math.round(s.max / 2)); s.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(80);
    check(await p.evaluate(() => !document.getElementById('oc-key-sel').hidden), 'date slider shows the selected-date curve');
    await p.click('#oc-presets button[data-p="long-call"]'); await sleep(80);
    const maxLossA = await txt(p, '.oc-stats');
    await p.fill('.oc-leg input[data-f="qty"]', '3'); await p.dispatchEvent('.oc-leg input[data-f="qty"]', 'change'); await sleep(80);
    check(await txt(p, '.oc-stats') !== maxLossA, 'quantity changes the numbers');
    await p.fill('.oc-leg input[data-f="px"]', '2.00'); await p.dispatchEvent('.oc-leg input[data-f="px"]', 'change'); await sleep(80);
    check(/\$600/.test(await txt(p, '.oc-stats')), 'typed price 2.00 x 3 contracts = $600 cost');
    await p.click('#oc-add'); await sleep(80);
    check(await p.evaluate(() => document.querySelectorAll('.oc-leg').length === 2), 'add leg');
    await p.click('.oc-leg[data-i="1"] .oc-x'); await sleep(80);
    check(await p.evaluate(() => document.querySelectorAll('.oc-leg').length === 1), 'remove leg');
    await p.click('#oc-presets button[data-p="iron-condor"]'); await sleep(150);
    await p.evaluate(() => document.getElementById('oc-chart').scrollIntoView({ block: 'center' }));
    const box = await p.evaluate(() => { const r = document.getElementById('oc-chart').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    await p.mouse.move(box.x + box.w * 0.4, box.y + box.h / 2); await sleep(120);
    check(/At\s/.test(await txt(p, '#oc-read')), 'hover readout');
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal overflow at 390');
    check(await p.evaluate(() => { const bad = []; document.querySelectorAll('.oc button, .oc input, .oc select').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width && (r.height < 39.5)) bad.push((e.id || e.className) + ':' + Math.round(r.height)); }); return !bad.length ? true : (console.log('SMALL', bad.join(',')), false); }), 'controls at least 40 high');
    check(!BANNED.test(await p.evaluate(() => document.querySelector('.oc').innerText)), 'no banned words');
    check(/Education only\. Not financial advice\./.test(await p.evaluate(() => document.querySelector('.oc').innerText)), 'disclaimer line');
    await p.evaluate(() => window.scrollTo(0, 0)); await shot(p, 'oc-calc-390-dark-top.png');
    await p.evaluate(() => document.querySelector('.oc-grid').children[1].scrollIntoView()); await shot(p, 'oc-calc-390-dark-payoff.png');
    await p.evaluate(() => document.getElementById('oc-greeks').scrollIntoView()); await shot(p, 'oc-calc-390-dark-greeks.png');
    check(c.errors.length === 0, 'calculator 390: no page errors ' + c.errors.join('|'));
    await c.ctx.close();

    // ---- calculator, signed in, 1440 dark + light ----
    for (const light of [false, true]) {
      c = await open(b, { page: 'options-calculator', w: 1440, h: 1000, signedIn: true, light, wait: 2600 });
      check(await c.p.evaluate(() => document.getElementById('oc-note-iv').hidden), 'signed in: volatility-by-strike (no flat note)');
      await c.p.click('#oc-presets button[data-p="iron-condor"]'); await sleep(150);
      await c.p.evaluate(() => { const s = document.getElementById('oc-date'); s.value = String(Math.round(s.max / 2)); s.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(150);
      await shot(c.p, 'oc-calc-1440-' + (light ? 'light' : 'dark') + '.png');
      check(await c.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal overflow at 1440' + (light ? ' light' : ''));
      check(c.errors.length === 0, 'calculator 1440: no page errors ' + c.errors.join('|'));
      await c.ctx.close();
    }
    // ---- skew ----
    for (const [w, light, name] of [[390, false, 'oc-skew-390-dark.png'], [1440, false, 'oc-skew-1440-dark.png'], [1440, true, 'oc-skew-1440-light.png']]) {
      c = await open(b, { page: 'iv-skew', w, h: w === 390 ? 900 : 1000, mobile: w === 390, signedIn: true, light, wait: 2200 });
      check(await c.p.evaluate(() => !document.getElementById('sk-body').hidden), 'skew ' + w + ': body shown');
      const nOpt = await c.p.evaluate(() => document.getElementById('sk-a').options.length);
      check(nOpt > 5, 'skew: expiries listed (' + nOpt + ')');
      await c.p.selectOption('#sk-b', { index: 6 }); await sleep(150);
      check(await c.p.evaluate(() => !document.getElementById('sk-kb-w').hidden), 'skew: compare adds second line');
      check(await c.p.evaluate(() => document.querySelectorAll('#sk-rr tbody tr').length > 3), 'skew: risk reversal rows');
      check(await c.p.evaluate(() => !/NaN|undefined/.test(document.querySelector('.oc').innerText)), 'skew: no NaN');
      check(await c.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'skew ' + w + ': no horizontal overflow');
      check(!BANNED.test(await c.p.evaluate(() => document.querySelector('.oc').innerText)), 'skew: no banned words');
      await shot(c.p, name);
      if (w === 390) { await c.p.evaluate(() => document.getElementById('sk-term').scrollIntoView({ block: 'center' })); await shot(c.p, 'oc-skew-390-dark-term.png'); }
      check(c.errors.length === 0, 'skew: no page errors ' + c.errors.join('|'));
      await c.ctx.close();
    }
    c = await open(b, { page: 'iv-skew', w: 390, mobile: true, lockSurface: true, wait: 1800 });
    check(await c.p.evaluate(() => !document.getElementById('sk-lock').hidden && document.getElementById('sk-body').hidden), 'skew signed out: sign-in prompt, no panels');
    await shot(c.p, 'oc-skew-390-signedout.png'); await c.ctx.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
