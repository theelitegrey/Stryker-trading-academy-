// Cookie notice: appears once, OK hides + persists, Details expands, no CLS, no overflow at 360.
const { chromium } = require('playwright-core');
const L = require('./lib');
const assert = require('assert');
(async () => {
  const b = await chromium.launch({ executablePath: L.executablePath(), args: ['--no-sandbox'] });
  const shots = process.env.COOKIE_SHOTS;
  const ctx = await b.newContext({ viewport: { width: 360, height: 800 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => { window.__cls = 0; new PerformanceObserver(l => l.getEntries().forEach(e => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true }); });
  await p.goto(L.BASE + '/index.html');
  await p.waitForSelector('.tzc.on', { timeout: 8000 });
  assert.strictEqual(await p.locator('.tzc').count(), 1);
  assert.strictEqual(await p.getAttribute('.tzc', 'aria-label'), 'Cookie notice');
  assert(await p.evaluate(() => document.documentElement.scrollWidth <= 360), 'overflow at 360');
  await p.click('.tzc .dt'); assert(await p.isVisible('.tzc-d'), 'details');
  assert(await p.evaluate(() => window.__cls) < 0.02, 'CLS');
  await p.click('.tzc .ok'); await p.waitForSelector('.tzc', { state: 'detached' });
  const c = await p.evaluate(() => window.tzConsent.get());
  assert(c && c.v === 1 && c.essential === true && c.analytics === false);
  await p.reload(); await p.waitForTimeout(2200);
  assert.strictEqual(await p.locator('.tzc').count(), 0, 'shown again');
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.tzc.on');
  await p.keyboard.press('Escape'); await p.waitForSelector('.tzc', { state: 'detached' });
  assert(await p.evaluate(() => window.tzConsent.get()), 'Esc saves');
  if (shots) for (const [name, url] of [['home', '/index.html'], ['charts', '/charts.html'], ['dashboard', '/dashboard-user.html']])
    for (const w of [390, 1440]) for (const th of ['dark', 'light']) {
      const c2 = await b.newContext({ viewport: { width: w, height: w > 500 ? 900 : 844 } }); const q = await c2.newPage();
      await q.addInitScript(t => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, th);
      await q.goto(L.BASE + url); await q.waitForSelector('.tzc.on', { timeout: 8000 }).catch(() => {}); await q.waitForTimeout(500);
      await q.screenshot({ path: `${shots}/${name}-${w}-${th}.png` }); await c2.close();
    }
  await b.close(); console.log('cookie-notice OK');
})().catch(e => { console.error(e); process.exit(1); });
