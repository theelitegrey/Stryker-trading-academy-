// Browser test: Community Indicators Disclaimer (assets/chart-community-disclaimer.js).
//   CHART_BASE=http://127.0.0.1:8061 OUT=<dir> node tools/tests/chart-community-disclaimer-browser.js
// Run under `flock /tmp/stryker-chrome.lock`.
// Checks (1440 and 390): the notice line sits at the top of Top and Trending only and above
// the "Community" heading in search results; "Read full disclaimer" expands the exact full text;
// the first community add asks "I understand" once (Cancel = not added, I understand = stored
// per uid in localStorage); the second add does not ask again; no console errors.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061';
const OUT = process.env.OUT || require('path').join(require('os').tmpdir(), 'community-disclaimer');
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const IGNORE = /ERR_FAILED|WebGL|GroupMarker|GPU stall|favicon|firebase|Failed to load resource/i;
const SHORT = 'Community indicators are made by third-party members, not by Stryker. Education only. Not financial advice.';

async function run(b, w, h){
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, deviceScaleFactor: w < 500 ? 2 : 1 });
  await ctx.addInitScript(stub);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text().slice(0, 300)); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_PINE && window.StrykerCommunityDisclaimer && window.STRYKER_PINE.__stkcdWrapped && window.StrykerIndicatorWindow, null, { timeout: 60000 });
  const tag = w + 'px';
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await p.waitForSelector('.stkiw-tab[data-k="top"]', { timeout: 20000 });
  for (const k of ['picks', 'stryker', 'top', 'trending']) {
    await p.click('.stkiw-tab[data-k="' + k + '"]');
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => { const l = document.querySelector('.stkiw-list'); const n = l.querySelector(':scope > .stkcd-note'); return { has: !!n, first: l.firstElementChild === n, text: n ? n.querySelector('.stkcd-line span').textContent.trim() : '' }; });
    // Owner order 2026-10-08: the notice only on Top and Trending (third-party lists).
    if (k === 'top' || k === 'trending') check(r.first && r.text === SHORT, tag + ' ' + k + ': notice is the first thing in the list');
    else check(!r.has, tag + ' ' + k + ': no notice (Stryker-only list)');
  }
  await p.click('.stkcd-more');
  await p.waitForTimeout(200);
  const full = await p.evaluate(() => { const b = document.querySelector('.stkcd-body'); const r = b.getBoundingClientRect(); return { shown: !b.hidden && r.height > 50, paras: [...b.querySelectorAll('.stkcd-full p')].map((x) => x.textContent), t: b.querySelector('.stkcd-t').textContent, sw: document.documentElement.scrollWidth, vw: innerWidth }; });
  const FULL = await p.evaluate(() => window.StrykerCommunityDisclaimer.FULL);
  check(full.shown && full.t === 'Community Indicators Disclaimer' && full.paras.length === 4 && JSON.stringify(full.paras) === JSON.stringify(FULL), tag + ': Read full disclaimer expands the full text (4 paragraphs)');
  check(full.paras[3].endsWith('data loss, or other consequences arising from the use of any community indicator.'), tag + ': last sentence complete');
  check(full.sw <= full.vw, tag + ': no horizontal overflow');
  await p.screenshot({ path: OUT + '/notice-' + tag + '.png' });
  // search: notice above the Community heading when community rows exist
  await p.fill('.stkiw-search', 'a');
  await p.waitForTimeout(400);
  const sr = await p.evaluate(() => { const l = document.querySelector('.stkiw-list'); const g = [...l.querySelectorAll('.stkiw-grp')].find((x) => /^community/i.test(x.textContent)); const n = l.querySelector(':scope > .stkcd-note'); return { hasGrp: !!g, ok: !g || (n && n.nextElementSibling === g) }; });
  check(sr.ok, tag + ': search results: notice ' + (sr.hasGrp ? 'sits above the Community heading' : '(no community hits; nothing to check)'));
  await p.fill('.stkiw-search', '');
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.close());
  // acknowledgement: stub addShared's engine call to count real adds
  await p.evaluate(() => { localStorage.removeItem(window.StrykerCommunityDisclaimer.KEY); });
  const fake = { id: 'test', name: 'Test community', source: '//@version=5\nindicator("T")\nplot(close)', version: 1, openSource: true, ownerUid: 'x' };
  const addP = p.evaluate((s) => window.STRYKER_PINE.addShared(s), fake);
  await p.waitForSelector('.stkcd-card', { timeout: 5000 });
  const dlg = await p.evaluate(() => { const c = document.querySelector('.stkcd-card'); const r = c.getBoundingClientRect(); return { h: c.querySelector('h2').textContent, n: c.querySelectorAll('.stkcd-full p').length, inView: r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1, btn: c.querySelector('.stkcd-ok').textContent }; });
  check(dlg.h === 'Community Indicators Disclaimer' && dlg.n === 4 && dlg.btn === 'I understand' && dlg.inView, tag + ': first community add shows the I understand dialog in view');
  await p.screenshot({ path: OUT + '/ack-' + tag + '.png' });
  await p.click('.stkcd-cancel');
  const r1 = await addP;
  check(!r1.ok && /disclaimer/i.test(r1.msg) && !(await p.evaluate(() => window.StrykerCommunityDisclaimer.acked())), tag + ': Cancel = not added, not remembered');
  const addP2 = p.evaluate((s) => window.STRYKER_PINE.addShared(s), fake);
  await p.waitForSelector('.stkcd-card', { timeout: 5000 });
  await p.click('.stkcd-ok');
  const r2 = await addP2;
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem(window.StrykerCommunityDisclaimer.KEY) || '{}'));
  check(r2.ok && Object.keys(stored).length === 1, tag + ': I understand = added and remembered (' + Object.keys(stored).join(',') + ')');
  const t0 = Date.now();
  const addP3 = p.evaluate((s) => window.STRYKER_PINE.addShared(s), fake);
  await p.waitForTimeout(600);
  const again = await p.evaluate(() => !!document.querySelector('.stkcd-card'));
  const r3 = await addP3;
  check(!again && r3.ok, tag + ': second add does not ask again (' + (Date.now() - t0) + ' ms)');
  check(!errs.length, tag + ': no console errors ' + JSON.stringify(errs.slice(0, 3)));
  await ctx.close();
}

(async () => {
  const b = await launch();
  try { await run(b, 1440, 900); await run(b, 390, 844); }
  catch (e) { console.log('FAIL exception', e && e.stack || e); fails++; }
  finally { await b.close(); }
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
