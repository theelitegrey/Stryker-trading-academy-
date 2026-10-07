// Browser test: Indicators window sections after the Owner order of 2026-10-08
// (assets/chart-indicator-window.js + assets/chart-community-disclaimer.js).
//   CHART_BASE=http://127.0.0.1:8061 OUT=<dir> node tools/tests/chart-picker-stryker-tab-browser.js
// Run under `flock /tmp/stryker-chrome.lock`.
// Checks (1440 and 390): BUILT-IN > Stryker sits right under Technicals and lists every Stryker
// script (STRYKER_PICKS + every PICKER_SCRIPTS 'picks' entry); Editors' picks lists the same;
// no "Community indicators" tab; Top and Trending both list every PICKER_SCRIPTS 'community'
// entry with its own author + third-party tag; no /boost/i text anywhere in the window; the
// disclaimer notice only on Top and Trending; no horizontal overflow; no console errors.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061';
const OUT = process.env.OUT || require('path').join(require('os').tmpdir(), 'picker-stryker-tab');
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const IGNORE = /ERR_FAILED|WebGL|GroupMarker|GPU stall|favicon|firebase|Failed to load resource/i;

async function run(b, w, h){
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, deviceScaleFactor: w < 500 ? 2 : 1 });
  await ctx.addInitScript(stub);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push(m.text().slice(0, 300)); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.StrykerIndicatorWindow && window.StrykerCommunityDisclaimer, null, { timeout: 60000 });
  const tag = w + 'px';
  const data = await p.evaluate(async () => {
    const m = await import('/assets/chart-pine-builtins.js?v=' + document.querySelector('meta[name=stryker-build]').content);
    return { picks: m.STRYKER_PICKS.concat(m.PICKER_SCRIPTS.filter((x) => x.section === 'picks').map((x) => 'x:' + x.id)),
      third: m.PICKER_SCRIPTS.filter((x) => x.section === 'community').map((x) => ({ key: 'x:' + x.id, author: x.author || 'Community' })) };
  });
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await p.waitForSelector('.stkiw-tab[data-k="stryker"]', { timeout: 20000 });
  const tabs = await p.evaluate(() => [...document.querySelectorAll('.stkiw-tab')].map((x) => x.dataset.k + '=' + x.textContent));
  const ti = tabs.indexOf('tech=Technicals');
  check(ti >= 0 && tabs[ti + 1] === 'stryker=Stryker', tag + ': Stryker tab right under Technicals (' + tabs.join(' | ') + ')');
  check(!tabs.some((t) => /Community indicators/.test(t)), tag + ': no "Community indicators" tab');
  const rowsOf = () => p.evaluate(() => [...document.querySelectorAll('.stkiw-list .stkiw-row')].map((r) => ({ key: r.dataset.key, sub: (r.querySelector('.stkiw-sub') || {}).textContent, tag: [...r.querySelectorAll('.stkiw-pick')].map((x) => x.textContent).join(',') })));
  const tab = async (k) => { await p.click('.stkiw-tab[data-k="' + k + '"]'); await p.waitForTimeout(400); };
  const state = () => p.evaluate(() => { const c = document.querySelector('.stkiw-card'); const l = document.querySelector('.stkiw-list'); return { boost: /boost/i.test(c.innerText) || !!c.querySelector('[class*="boost"],[title*="oost"],[aria-label*="oost"]'), note: !!l.querySelector(':scope > .stkcd-note'), sw: document.documentElement.scrollWidth, vw: innerWidth }; });
  for (const k of ['stryker', 'picks']) {
    await tab(k);
    const r = await rowsOf(); const keys = r.map((x) => x.key);
    check(data.picks.every((x) => keys.includes(x)) && r.every((x) => x.sub === 'Stryker' || !data.third.some((t) => t.key === x.key)), tag + ' ' + k + ': all ' + data.picks.length + ' Stryker scripts listed (' + keys.join(', ') + ')');
    check(!data.third.some((t) => keys.includes(t.key)), tag + ' ' + k + ': no third-party script');
    const s = await state();
    check(!s.note, tag + ' ' + k + ': no disclaimer notice');
    check(!s.boost, tag + ' ' + k + ': no boost text');
    await p.screenshot({ path: OUT + '/' + k + '-' + tag + '.png' });
  }
  for (const k of ['top', 'trending']) {
    await tab(k);
    const r = await rowsOf();
    const ok = data.third.every((t) => { const x = r.find((y) => y.key === t.key); return x && x.sub === t.author && /Community · third-party/.test(x.tag); });
    check(ok && r.some((x) => x.key === 'x:stoic-edge-compass') && r.some((x) => x.key === 'x:wcsmc-sp'), tag + ' ' + k + ': all ' + data.third.length + ' third-party built-ins with their authors');
    const s = await state();
    check(s.note && await p.evaluate(() => document.querySelector('.stkiw-list').firstElementChild.classList.contains('stkcd-note')), tag + ' ' + k + ': disclaimer notice at the top');
    check(!s.boost, tag + ' ' + k + ': no boost text');
    check(s.sw <= s.vw, tag + ' ' + k + ': no horizontal overflow');
    await p.screenshot({ path: OUT + '/' + k + '-' + tag + '.png' });
  }
  await tab('tech');
  check(!(await state()).boost, tag + ' tech: no boost text');
  await p.fill('.stkiw-search', 'wcsmc');
  await p.waitForTimeout(400);
  const sr = await p.evaluate(() => { const l = document.querySelector('.stkiw-list'); return { hit: !!l.querySelector('.stkiw-row[data-key="x:wcsmc-sp"]'), note: !!l.querySelector(':scope > .stkcd-note') }; });
  check(sr.hit && sr.note, tag + ': search finds WCSMC with the notice above it');
  await p.fill('.stkiw-search', 'fvg relay');
  await p.waitForTimeout(400);
  check(await p.evaluate(() => !!document.querySelector('.stkiw-row[data-key="x:fvg-relay-stryker"]')), tag + ': search finds FVG Relay');
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
