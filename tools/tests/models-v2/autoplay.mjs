// autoplay regression: node autoplay.mjs <base> [--label]
// Reproduces the website manager's report: player scrolled into view, wait 6s, must be playing.
// Case G: the scroll happens while the reader is still .gate-pending (access check not finished),
// then the gate lifts with no further scroll. Case T: tall player vs short viewport.
import { launch } from './mv2.mjs';
import { STUB } from './mv2.mjs';
const [base] = process.argv.slice(2);
const b = await launch();
const res = [];
async function ctxFor(w, h, theme, authDelay) {
  const isMobile = w < 700;
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile, hasTouch: isMobile });
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t); localStorage.setItem('stryker_install_prompt_shown_u-test', '1'); } catch (e) {} }, theme);
  const stub = STUB.replace('setTimeout(()=>cb(user), 30)', `setTimeout(()=>cb(user), ${authDelay})`);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => { const u = r.request().url(); if (/firebase-app-compat/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: stub }); if (/gstatic/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }); return r.abort(); });
  return ctx;
}
const state = (p) => p.evaluate(() => { const s = document.querySelector('.sp'); return s ? s.querySelector('.sp-stepno').textContent + ' playing=' + s.classList.contains('is-playing') : 'no player'; });
try {
  for (const [w, h, theme] of [[390, 844, 'day'], [390, 844, 'night'], [1440, 900, 'day'], [1440, 900, 'night']]) {
    // G: scroll into view immediately at DOMContentLoaded-ish, gate lifts 2.5s later
    const ctx = await ctxFor(w, h, theme, 2500);
    const p = await ctx.newPage();
    await p.goto(base + '/model.html?id=fvg-model-b', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.sp', { state: 'attached' });
    await p.evaluate(() => { const r = document.querySelector('.sp').getBoundingClientRect(); window.scrollTo(0, scrollY + r.top - 84); });
    const gated = await p.evaluate(() => document.getElementById('reader-content-wrap').className);
    await p.waitForTimeout(2500 + 6000);
    const s = await state(p);
    res.push(`${s.includes('playing=true') ? 'PASS' : 'FAIL'} G ${w}x${h} ${theme} (scrolled while "${gated}") -> ${s}`);
    await ctx.close();
  }
  // T: short landscape phone viewport, player taller than 45% threshold allows? scroll to its top
  for (const [w, h] of [[844, 390], [390, 520]]) {
    const ctx = await ctxFor(w, h, 'night', 30);
    const p = await ctx.newPage();
    await p.goto(base + '/model.html?id=fvg-model-b', { waitUntil: 'load' });
    await p.waitForTimeout(600);
    await p.evaluate(() => { const r = document.querySelector('.sp').getBoundingClientRect(); window.scrollTo(0, scrollY + r.top - 60); });
    await p.waitForTimeout(6000);
    const info = await p.evaluate(() => { const r = document.querySelector('.sp').getBoundingClientRect(); return 'h=' + Math.round(r.height) + ' vis=' + Math.round(Math.min(innerHeight, r.bottom) - Math.max(0, r.top)); });
    const s = await state(p);
    res.push(`${s.includes('playing=true') ? 'PASS' : 'FAIL'} T ${w}x${h} (${info}) -> ${s}`);
    await ctx.close();
  }
} finally { await b.close(); }
console.log(res.join('\n'));
