// Final pass: node final.mjs <base> <outdir> [mainBase]
// list (11) + model pages (3 players + 2 without), 390/1440 x night/day, reduced motion,
// signed-out paywall (branch vs main), overflow, console errors.
import { chromium } from 'playwright-core';
import { STUB } from './mv2.mjs';
import fs from 'fs';
const [base, out, mainBase] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const EXE = '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const res = [];
const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : ''));
const clean = (e) => e.filter((x) => !/ERR_FAILED/.test(x));
const SIGNED_OUT = STUB.replace("currentUser:user", "currentUser:null").replace(/cb\(user\)/g, 'cb(null)');

async function open(url, { w, h = w < 700 ? 844 : 900, theme = 'night', reduced = false, signedOut = false }) {
  const mob = w < 700;
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: w, height: h }, deviceScaleFactor: mob ? 2 : 1, isMobile: mob, hasTouch: mob,
    reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t); localStorage.setItem('stryker_install_prompt_shown_u-test', '1'); localStorage.setItem('stryker_tour_done', '1'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => {
    const u = r.request().url();
    if (/gstatic\.com\/firebasejs\/.*firebase-app-compat/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: signedOut ? SIGNED_OUT : STUB });
    if (/gstatic\.com\/firebasejs/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* stub */' });
    return r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message).slice(0, 200)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}
const sw = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));

try {
  for (const w of [390, 1440]) for (const theme of ['night', 'day']) {
    // list
    { const { ctx, page, errors } = await open(base + '/models.html', { w, theme });
      const n = await page.evaluate(() => new Set([...document.querySelectorAll('a[href*="model.html?id="]')].map((a) => a.getAttribute('href'))).size);
      const o = await sw(page);
      ok(`list ${w} ${theme}: 11 models`, n === 11, n); ok(`list ${w} ${theme}: no overflow`, o.sw <= o.iw, `${o.sw}/${o.iw}`);
      ok(`list ${w} ${theme}: console`, clean(errors).length === 0, JSON.stringify(clean(errors)));
      await page.screenshot({ path: `${out}/list-${w}-${theme}.png`, fullPage: w === 390 ? false : true }); await ctx.close(); }
    for (const [id, player] of [['fvg-model-b', true], ['silver-bullet-model', true], ['turtle-soup-model', true], ['ib-80-rule-model', false], ['orb-model-a', false]]) {
      const { ctx, page, errors } = await open(base + '/model.html?id=' + id, { w, theme });
      const r = await page.evaluate(() => { const s = document.getElementById('model-player-slot'); return { hidden: !s || s.hidden, kids: s ? s.children.length : -1, sp: document.querySelectorAll('.sp').length,
        badge: /Illustrative example/.test((document.querySelector('.sp') || {}).textContent || ''), h1: (document.querySelector('h1') || {}).textContent, body: (document.getElementById('reader-content-wrap') || document.body).innerText.length,
        pay: getComputedStyle(document.getElementById('guest-paywall-overlay') || document.body).display }; });
      const o = await sw(page);
      if (player) { ok(`${id} ${w} ${theme}: one player + badge`, !r.hidden && r.sp === 1 && r.badge, JSON.stringify(r)); }
      else ok(`${id} ${w} ${theme}: no player, slot hidden+empty`, r.hidden && r.kids === 0 && r.sp === 0, JSON.stringify(r));
      ok(`${id} ${w} ${theme}: article rendered, no paywall (signed in)`, r.body > 1500 && r.pay === 'none', r.body + ' ' + r.pay);
      ok(`${id} ${w} ${theme}: no overflow`, o.sw <= o.iw, `${o.sw}/${o.iw}`);
      ok(`${id} ${w} ${theme}: console`, clean(errors).length === 0, JSON.stringify(clean(errors)));
      if (player) { await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; const r = document.querySelector('.sp').getBoundingClientRect(); scrollTo(0, scrollY + r.top - 84); }); await page.waitForTimeout(2500); }
      await page.screenshot({ path: `${out}/${id}-${w}-${theme}.png` });
      await ctx.close();
    }
  }
  // reduced motion, each player, 390 + 1440
  for (const w of [390, 1440]) for (const id of ['fvg-model-b', 'silver-bullet-model', 'turtle-soup-model']) {
    const { ctx, page, errors } = await open(base + '/model.html?id=' + id, { w, reduced: true });
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; const r = document.querySelector('.sp').getBoundingClientRect(); scrollTo(0, scrollY + r.top - 84); });
    await page.waitForTimeout(2000);
    const r = await page.evaluate(() => ({ step: document.querySelector('.sp-stepno').textContent, playing: document.querySelector('.sp').classList.contains('is-playing'),
      anims: document.getAnimations().filter((a) => a.playState === 'running').length, mmrv: document.documentElement.classList.contains('mm-rv'), pill: !!document.querySelector('.mm-pill:not([hidden])') }));
    ok(`reduced ${id} ${w}: no autoplay, 0 running animations, no reveal gate`, !r.playing && /Step 1 of/.test(r.step) && r.anims === 0 && !r.mmrv, JSON.stringify(r));
    ok(`reduced ${id} ${w}: console`, clean(errors).length === 0, JSON.stringify(clean(errors)));
    if (id === 'turtle-soup-model') await page.screenshot({ path: `${out}/reduced-${id}-${w}.png` });
    await ctx.close();
  }
  // signed-out paywall: branch vs main, same page state
  const snap = async (bb, id, w) => { const { ctx, page, errors } = await open(bb + '/model.html?id=' + id, { w, signedOut: true });
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => { const ov = document.getElementById('guest-paywall-overlay'); const c = document.getElementById('reader-content-wrap');
      return { overlay: ov ? getComputedStyle(ov).display : null, dimmed: c ? c.classList.contains('paywall-dimmed') : null, pending: c ? c.classList.contains('gate-pending') : null,
        heading: (document.getElementById('paywall-heading') || {}).textContent, actions: [...document.querySelectorAll('#paywall-actions a,#paywall-actions button')].map((a) => a.textContent.trim()).join('|'),
        playing: !!document.querySelector('.sp.is-playing'), pill: [...document.querySelectorAll('.mm-pill')].filter((p) => getComputedStyle(p).display !== 'none' && !p.hidden).length }; });
    const o = await sw(page); r.overflow = o.sw > o.iw; r.errors = clean(errors).length;
    if (w === 390) await page.screenshot({ path: `${out}/signedout-${id}-${bb === base ? 'branch' : 'main'}-${w}.png` });
    await ctx.close(); return r; };
  for (const w of [390, 1440]) for (const id of ['fvg-model-b', 'orb-model-a']) {
    const br = await snap(base, id, w);
    ok(`signed-out ${id} ${w}: paywall shown, content dimmed, no autoplay/pill behind it`, br.overlay === 'flex' && br.dimmed && !br.pending && !br.playing && br.pill === 0 && !br.overflow && br.errors === 0, JSON.stringify(br));
    if (mainBase) { const mr = await snap(mainBase, id, w); const same = ['overlay', 'dimmed', 'pending', 'heading', 'actions'].every((k) => mr[k] === br[k]);
      ok(`signed-out ${id} ${w}: same as main (338)`, same, 'main=' + JSON.stringify(mr)); }
  }
} finally { await b.close(); }
console.log(res.join('\n'));
const f = res.filter((x) => x.startsWith('FAIL')).length;
console.log(f ? `FAILED ${f}/${res.length}` : `ALL PASS ${res.length}`);
