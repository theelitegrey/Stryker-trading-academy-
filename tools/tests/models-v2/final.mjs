// Final pass: node final.mjs <base> <outdir> [mainBase]
// list (11) + filter chips, the 5 new model pages + fvg-model-b + orb-model-a, 390/1440 x night/day,
// Option B (no stats anywhere, all 11 pages), reduced motion, signed-out paywall (branch vs main),
// overflow, console errors. Which pages expect a player is read from MODELS_SEED (storyboard present).
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
const SEED = (() => { const src = fs.readFileSync(process.env.SEED_JS || new URL('../../../assets/models-data.js', import.meta.url), 'utf8');
  return new Function(src.replace('const MODELS_SEED', 'var MODELS_SEED') + '; return MODELS_SEED;')(); })();
const HAS_SB = Object.fromEntries(SEED.map((m) => [m.id, !!m.storyboard]));
const NEW5 = ['silver-bullet-model', 'turtle-soup-model', 'ib-80-rule-model', 'unicorn-model', 'vwap-reversion-model'];
const PAGES = [...NEW5, 'fvg-model-b', 'orb-model-a'];
const PLAYERS = PAGES.filter((id) => HAS_SB[id]);
const GROUPS = { 'Opening & Session': ['orb-model-a', 'judas-swing-model', 'silver-bullet-model', 'ib-80-rule-model'],
  'Liquidity & Reversal': ['turtle-soup-model', 'crt-model', 'ict-2022-model'],
  'Imbalance / FVG': ['fvg-model-b', 'ifvg-model-c', 'unicorn-model'], 'Mean Reversion': ['vwap-reversion-model'] };
const FOOT = 'Illustrative candles drawn to teach the pattern. Not real market data and not a trade record.';
// Option B: nothing that reads as a performance record may render (rule limits like "max 2 trades per day" are not stats)
const STATS_TXT = /win[ -]?rate|profit factor|expectancy|(?<!(?:max(?:imum)?|at most|up to|limit(?: of)?) )\b\d[\d,]* (?:trades|wins|losses)\b(?! (?:per|a) (?:day|session|window))|net (?:profit|P&L)|max(?:imum)? drawdown of/i;
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
    for (const id of PAGES) {
      const player = HAS_SB[id];
      const { ctx, page, errors } = await open(base + '/model.html?id=' + id, { w, theme });
      const r = await page.evaluate(() => { const s = document.getElementById('model-player-slot'); return { hidden: !s || s.hidden, kids: s ? s.children.length : -1, sp: document.querySelectorAll('.sp').length,
        badge: /Illustrative example/.test((document.querySelector('.sp') || {}).textContent || ''), foot: ((document.querySelector('.sp-foot') || {}).textContent || '').trim(),
        h1: (document.querySelector('h1') || {}).textContent, body: (document.getElementById('reader-content-wrap') || document.body).innerText.length,
        pay: getComputedStyle(document.getElementById('guest-paywall-overlay') || document.body).display }; });
      const o = await sw(page);
      if (player) { ok(`${id} ${w} ${theme}: one player + badge + approved footer`, !r.hidden && r.sp === 1 && r.badge && r.foot === FOOT, JSON.stringify(r)); }
      else ok(`${id} ${w} ${theme}: no player, slot hidden+empty`, r.hidden && r.kids === 0 && r.sp === 0, JSON.stringify(r));
      ok(`${id} ${w} ${theme}: article rendered, no paywall (signed in)`, r.body > 1500 && r.pay === 'none', r.body + ' ' + r.pay);
      ok(`${id} ${w} ${theme}: no overflow`, o.sw <= o.iw, `${o.sw}/${o.iw}`);
      ok(`${id} ${w} ${theme}: console`, clean(errors).length === 0, JSON.stringify(clean(errors)));
      if (player) { await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; const r = document.querySelector('.sp').getBoundingClientRect(); scrollTo(0, scrollY + r.top - 84); }); await page.waitForTimeout(2500); }
      await page.screenshot({ path: `${out}/${id}-${w}-${theme}.png` });
      await ctx.close();
    }
  }
  // filter chips: 4 groups + All, aria-pressed, keyboard, counts, 390 wrap, both themes
  for (const w of [390, 1440]) for (const theme of ['night', 'day']) {
    const { ctx, page, errors } = await open(base + '/models.html', { w, theme });
    const chips = await page.evaluate(() => [...document.querySelectorAll('.mdl-chips [data-mfilter]')].map((c) => {
      const r = c.getBoundingClientRect(); return { k: c.dataset.mfilter, p: c.getAttribute('aria-pressed'), n: +(c.querySelector('i') || {}).textContent, l: r.left, r: r.right }; }));
    ok(`chips ${w} ${theme}: All + 4 groups in order`, JSON.stringify(chips.map((c) => c.k)) === JSON.stringify(['all', ...Object.keys(GROUPS)]), JSON.stringify(chips.map((c) => c.k)));
    ok(`chips ${w} ${theme}: counts 11/4/3/3/1`, chips.map((c) => c.n).join('/') === '11/4/3/3/1', chips.map((c) => c.n).join('/'));
    ok(`chips ${w} ${theme}: aria-pressed (All true, rest false)`, chips.map((c) => c.p).join() === 'true,false,false,false,false');
    ok(`chips ${w} ${theme}: inside the viewport`, chips.every((c) => c.l >= 0 && c.r <= w), JSON.stringify(chips.map((c) => [c.l | 0, c.r | 0])));
    for (const [g, ids] of Object.entries(GROUPS)) {
      await page.click(`.mdl-chips [data-mfilter="${g}"]`); await page.waitForTimeout(150);
      const got = await page.evaluate(() => [...document.querySelectorAll('.mdl-grid a.mdl-card')].map((a) => new URL(a.href).searchParams.get('id')).sort());
      const pr = await page.evaluate((k) => document.querySelector(`.mdl-chips [data-mfilter="${k}"]`).getAttribute('aria-pressed'), g);
      ok(`chips ${w} ${theme}: "${g}" shows exactly its models, pressed`, JSON.stringify(got) === JSON.stringify([...ids].sort()) && pr === 'true', JSON.stringify(got));
      const sub = await page.evaluate(() => [...document.querySelectorAll('.mdl-grid .mdl-cat')].length === document.querySelectorAll('.mdl-grid a.mdl-card').length);
      ok(`chips ${w} ${theme}: "${g}" cards keep their detailed sub-tag`, sub);
      const o = await sw(page); ok(`chips ${w} ${theme}: "${g}" no overflow`, o.sw <= o.iw, `${o.sw}/${o.iw}`);
      if (g === 'Opening & Session') await page.screenshot({ path: `${out}/chips-${w}-${theme}-opening.png` });
    }
    // keyboard: focus All, Tab to "Mean Reversion" by keys, Enter / Space toggle
    await page.click('.mdl-chips [data-mfilter="all"]'); await page.focus('.mdl-chips [data-mfilter="all"]');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
    await page.keyboard.press('Enter'); await page.waitForTimeout(150);
    let kb = await page.evaluate(() => ({ f: document.activeElement.dataset.mfilter, p: document.activeElement.getAttribute('aria-pressed'), n: document.querySelectorAll('.mdl-grid a.mdl-card').length }));
    ok(`chips ${w} ${theme}: keyboard Tab+Enter selects, focus kept`, kb.f === 'Mean Reversion' && kb.p === 'true' && kb.n === 1, JSON.stringify(kb));
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Space'); await page.waitForTimeout(150);
    kb = await page.evaluate(() => ({ f: document.activeElement.dataset.mfilter, p: document.activeElement.getAttribute('aria-pressed'), n: document.querySelectorAll('.mdl-grid a.mdl-card').length,
      ring: getComputedStyle(document.activeElement).outlineStyle }));
    ok(`chips ${w} ${theme}: keyboard Shift+Tab+Space selects, focus ring`, kb.f === 'Imbalance / FVG' && kb.p === 'true' && kb.n === 3 && kb.ring !== 'none', JSON.stringify(kb));
    if (w === 390) await page.screenshot({ path: `${out}/chips-${w}-${theme}-keyboard.png` });
    ok(`chips ${w} ${theme}: console`, clean(errors).length === 0, JSON.stringify(clean(errors)));
    await ctx.close();
  }
  // Option B: no model carries approved stats; no stats card or stats text on the list or any of the 11 pages
  ok('option B: no seed model has stats.approved === true', SEED.every((m) => !(m.stats && m.stats.approved === true)), SEED.filter((m) => m.stats).map((m) => m.id).join());
  { const { ctx, page, errors } = await open(base + '/models.html', { w: 1440 });
    const t = await page.evaluate(() => ({ card: document.querySelectorAll('.mdl-stats-card').length, text: document.body.innerText }));
    ok('option B: list page has no stats card / stats text', t.card === 0 && !STATS_TXT.test(t.text), (t.text.match(STATS_TXT) || [''])[0]);
    await ctx.close(); }
  for (const m of SEED) {
    const { ctx, page, errors } = await open(base + '/model.html?id=' + m.id, { w: 1440 });
    const t = await page.evaluate(() => { const s = document.getElementById('model-stats-slot');
      return { card: document.querySelectorAll('.mdl-stats-card,.mdl-stats-head').length, slot: s ? s.innerHTML.trim().length + (s.hidden ? 'h' : '') : 'none',
        text: (document.getElementById('reader-content-wrap') || document.body).innerText,
        edu: (document.body.innerText.match(/Education only\. Not financial advice\./g) || []).length }; });
    const hit = (t.text.match(STATS_TXT) || [''])[0];
    ok(`option B: ${m.id}: no stats card, stats slot empty, no stats wording`, t.card === 0 && (t.slot === 0 || t.slot === '0h' || t.slot === 'none') && !hit, JSON.stringify({ card: t.card, slot: t.slot, hit }));
    if (NEW5.includes(m.id)) ok(`footer: ${m.id}: short "Education only. Not financial advice." exactly once, no long disclaimer`, t.edu === 1 && !/disclaimer/i.test(t.text), 'count ' + t.edu);
    ok(`option B: ${m.id}: console`, clean(errors).length === 0, JSON.stringify(clean(errors)));
    await ctx.close();
  }
  // reduced motion, each player, 390 + 1440
  for (const w of [390, 1440]) for (const id of PLAYERS) {
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
