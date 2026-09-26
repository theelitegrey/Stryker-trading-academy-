// Screen recording + hero shots: node record.mjs <base> <outdir> <model-id> [theme] [speed]
// Records the player auto-playing through every frame at 1440 (webm, Playwright recordVideo),
// and writes the 4 hero PNGs (list 390 night, list 1440 day, player 390 day, player 1440 night).
import { chromium } from 'playwright-core';
import { STUB } from './mv2.mjs';
import fs from 'fs';
const [base, out, id, theme = 'night', speed = '2'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const EXE = '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
async function ctxFor(w, th, video) {
  const mob = w < 700;
  const h = mob ? 844 : 900;
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: w, height: h }, deviceScaleFactor: mob ? 2 : 1, isMobile: mob, hasTouch: mob,
    ...(video ? { recordVideo: { dir: out, size: { width: w, height: h } } } : {}) });
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t); localStorage.setItem('stryker_install_prompt_shown_u-test', '1'); localStorage.setItem('stryker_tour_done', '1'); } catch (e) {} }, th);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => {
    const u = r.request().url();
    if (/firebase-app-compat/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (/gstatic\.com\/firebasejs/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* stub */' });
    return r.abort();
  });
  return ctx;
}
const toPlayer = (p) => p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; const r = document.querySelector('.sp').getBoundingClientRect(); scrollTo(0, scrollY + r.top - 84); });
try {
  // hero shots
  for (const [name, url, w, th, player] of [['hero-1', '/models.html', 390, 'night', false], ['hero-2', '/models.html', 1440, 'day', false],
    ['hero-3', '/model.html?id=' + id, 390, 'day', true], ['hero-4', '/model.html?id=' + id, 1440, 'night', true]]) {
    const ctx = await ctxFor(w, th, false); const p = await ctx.newPage();
    await p.goto(base + url, { waitUntil: 'load' }); await p.waitForTimeout(1500);
    if (player) { await toPlayer(p); await p.waitForTimeout(9000); }
    else await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; const r = document.querySelector('.mdl-head').getBoundingClientRect(); scrollTo(0, scrollY + r.top - 80); });
    await p.screenshot({ path: `${out}/${name}.png` }); await ctx.close();
    console.log('shot', name);
  }
  // recording
  const ctx = await ctxFor(1440, theme, true); const p = await ctx.newPage();
  await p.goto(base + '/model.html?id=' + id, { waitUntil: 'load' }); await p.waitForTimeout(1200);
  await toPlayer(p);
  await p.click(`.sp-speed button[data-speed="${speed}"]`);
  const t0 = Date.now(); const seen = new Set();
  while (Date.now() - t0 < 40000) {
    const s = await p.evaluate(() => document.querySelector('.sp-stepno').textContent); seen.add(s);
    const m = /Step (\d+) of (\d+)/.exec(s); if (m && m[1] === m[2]) { await p.waitForTimeout(2000); break; }
    await p.waitForTimeout(250);
  }
  const vp = p.video(); await ctx.close();
  const dst = `${out}/${id}-1440-${theme}-autoplay-${speed}x.webm`;
  await vp.saveAs(dst); await vp.delete();
  console.log('video', dst, ((Date.now() - t0) / 1000).toFixed(1) + 's', [...seen].join(' | '));
} finally { await b.close(); }
