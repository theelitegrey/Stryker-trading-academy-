// Homepage hero layering test (Owner 2026-11-01). Offline: local static server, everything else aborted.
//   node tools/tests/home-hero-browser.js [shotsDir]
// At 360/390/412/768/1024/1280/1440/1920, dark + light:
//   no horizontal overflow; back screens, phone, pill and every visible card inside the viewport;
//   no card / phone / back screen covers the CTAs, the pill or the main frame's top bar (its controls);
//   visible cards never overlap each other or the phone; card count = 3 / 4 / 6 by width.
// Then a touch test at 390 (pill tap opens the tooltip, tap outside closes it, CTAs are >=44px and hit-testable)
// and the reduced-motion pill (dot static). Shots at 390/768/1440 dark + light when a dir is given.
const path = require('path');
const R = require('./bt-rig.js');
const OUT = process.argv[2];
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

const probe = () => {
  const vw = innerWidth, sx = scrollX, sy = scrollY;
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top + sy, r: r.right, b: r.bottom + sy, w: r.width, h: r.height }; };
  const vis = (e) => e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
  const q = (s) => document.querySelector(s);
  const cards = [...document.querySelectorAll('.hh-fl')].filter(vis).map((e) => ({ n: e.className.match(/hh-c\d/)[0], ...box(e.querySelector('.zc-fc')) }));
  const toast = q('.hh-toasts'); if (vis(toast)) cards.push({ n: 'toast', ...box(toast) });
  return {
    vw, docW: document.documentElement.scrollWidth, cards,
    backs: [...document.querySelectorAll('.hh-back .hh-scr')].filter(vis).map(box),
    phone: box(q('.hh-phone .zc-phone')), pill: box(q('.hh-rt .zc-rt-b')),
    bar: box(q('.cm-fl-main .cm-bar')), main: box(q('.cm-fl-main .cm-frame')),
    ctas: [...document.querySelectorAll('.cm-hero .cm-cta a')].map(box),
    fine: !!q('.cm-hero .cm-fine'), sub: q('.cm-hero .cm-sub').textContent
  };
};
const hit = (a, b, pad = 0) => a.l < b.r - pad && b.l < a.r - pad && a.t < b.b - pad && b.t < a.b - pad;
const inside = (a, vw) => a.l >= -0.5 && a.r <= vw + 0.5;

(async () => {
  const srv = await R.serve(); const b = await R.launch();
  try {
    for (const theme of ['night', 'day']) {
      for (const w of [360, 390, 412, 768, 1024, 1280, 1440, 1920]) {
        const mob = w < 700;
        const ctx = await b.newContext({ viewport: { width: w, height: mob ? 844 : 900 }, deviceScaleFactor: mob ? 2 : 1, isMobile: mob, hasTouch: mob });
        await ctx.addInitScript(`try{localStorage.setItem('stryker_theme','${theme}')}catch(e){}`);
        await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
        const p = await ctx.newPage();
        const errs = []; p.on('pageerror', (e) => { if (!/reading 'collection'/.test(String(e))) errs.push(String(e)); }); // offline: Firebase is aborted, db is null (pre-existing, not the hero)
        await p.goto(srv.base + '/index.html', { waitUntil: 'load' });
        await p.waitForTimeout(3200); // entrance animations done
        const s = await p.evaluate(probe);
        const tag = theme + ' ' + w + ':';
        check(s.docW <= s.vw, `${tag} no horizontal overflow (${s.docW} <= ${s.vw})`);
        const want = w >= 1100 ? 6 : w >= 700 ? 4 : 3;
        check(s.cards.length === want, `${tag} ${s.cards.length} cards visible (want ${want})`);
        const all = [...s.cards, ...s.backs, s.phone, s.pill];
        check(all.every((a) => inside(a, s.vw)), `${tag} cards, back screens, phone and pill inside the viewport`);
        const front = [...s.cards, s.phone, ...s.backs];
        check(!front.some((a) => s.ctas.some((c) => hit(a, c))), `${tag} nothing covers the CTAs`);
        check(![...s.cards, s.phone].some((a) => hit(a, s.pill)), `${tag} nothing covers the real-time pill (back screens sit behind it)`);
        check(![...s.cards, s.phone].some((a) => hit(a, s.bar)), `${tag} nothing covers the chart frame's top bar`);
        let ov = []; for (let i = 0; i < s.cards.length; i++) for (let j = i + 1; j < s.cards.length; j++) if (hit(s.cards[i], s.cards[j])) ov.push(s.cards[i].n + '/' + s.cards[j].n);
        s.cards.forEach((c) => { if (hit(c, s.phone)) ov.push(c.n + '/phone'); });
        check(!ov.length, `${tag} cards do not overlap each other or the phone ${ov.join(' ')}`);
        check(hit(s.phone, s.main), `${tag} phone overlaps the main chart`);
        check(s.backs.length === 2 && s.backs.every((k) => k.t < s.main.t), `${tag} both back screens peek out above the main chart`);
        check(!s.fine && !/No card needed/.test(await p.evaluate(() => document.querySelector('.cm-hero').textContent)), `${tag} "No card needed" line removed`);
        check(!errs.length, `${tag} no page errors ${errs.slice(0, 2).join(' | ')}`);
        if (OUT && [390, 768, 1440].includes(w)) {
          // a viewport tall enough for the whole hero (an element screenshot resizes the viewport, which re-runs the
          // media queries and restarts the cards' entrance animation mid-capture)
          const hb = await p.evaluate(() => Math.ceil(document.querySelector('.cm-hero').getBoundingClientRect().bottom + scrollY));
          await p.setViewportSize({ width: w, height: hb }); await p.waitForTimeout(3200);
          await p.screenshot({ path: path.join(OUT, `hero-${w}-${theme === 'night' ? 'dark' : 'light'}.png`) });
          await p.setViewportSize({ width: w, height: mob ? 844 : 900 }); await p.waitForTimeout(3200);
        }
        if (w === 390 && theme === 'night') {
          // touch: tap the pill, tooltip shows inside the viewport; tap elsewhere closes it
          await p.tap('.hh-rt .zc-rt-b');
          await p.waitForTimeout(250);
          const t = await p.evaluate(() => { const e = document.getElementById('hh-rt-tip'), r = e.getBoundingClientRect(); return { op: +getComputedStyle(e).opacity, l: r.left, r: r.right, txt: e.textContent, exp: document.querySelector('.hh-rt .zc-rt-b').getAttribute('aria-expanded') }; });
          check(t.op === 1 && t.exp === 'true', '390 touch: tapping the pill opens the tooltip');
          check(t.l >= 0 && t.r <= 390, `390 touch: tooltip inside the viewport (${Math.round(t.l)}-${Math.round(t.r)})`);
          check(/otherwise 10 minutes delayed\.$/.test(t.txt), '390 touch: tooltip wording');
          if (OUT) await p.screenshot({ path: path.join(OUT, 'hero-390-dark-tooltip.png') });
          await p.tap('h1');
          await p.waitForTimeout(250);
          check(await p.evaluate(() => +getComputedStyle(document.getElementById('hh-rt-tip')).opacity === 0), '390 touch: tapping elsewhere closes it');
          const cta = await p.evaluate(() => [...document.querySelectorAll('.cm-hero .cm-cta a')].map((a) => { const r = a.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { h: r.height, ok: a.contains(el) }; }));
          check(cta.every((c) => c.h >= 44 && c.ok), '390 touch: both CTAs >=44px tall and not covered');
        }
        await ctx.close();
      }
    }
    // reduced motion: pill dot is static, cards don't bob
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const p = await ctx.newPage(); await p.goto(srv.base + '/index.html', { waitUntil: 'load' }); await p.waitForTimeout(800);
    const rm = await p.evaluate(() => ({ dot: getComputedStyle(document.querySelector('.hh-rt .zc-dot'), '::after').animationName, card: getComputedStyle(document.querySelector('.hh-fl .zc-fc')).animationName }));
    check(rm.dot === 'none' && rm.card === 'none', `reduced motion: pill dot and cards static (${rm.dot}, ${rm.card})`);
    await ctx.close();
  } finally { await b.close(); srv.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
