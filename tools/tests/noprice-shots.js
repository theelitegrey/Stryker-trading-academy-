// No upfront pricing (Owner 2026-11-01): homepage has no prices, /pricing has them,
// Pro paywalls (GEX+ lock card, upgrade modal) show the live Pro price.
//   NOPRICE_SHOTS=<dir> node noprice-shots.js   (needs http.server on STRYKER_TEST_PORT)
const { BASE, launch } = require('./lib.js');
const { stubFor } = require('./pricing-test.js');
const SHOTS = process.env.NOPRICE_SHOTS || '';
const log = [];
const ok = (l, c, x) => log.push((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '   ' + x : ''));

async function page(b, mode, path, w, day) {
  const ctx = await b.newContext({ viewport: { width: w, height: w < 500 ? 844 : 950 }, timezoneId: 'America/New_York' });
  await ctx.addInitScript((d) => { try { localStorage.setItem('stryker_theme', d ? 'day' : 'night'); } catch (e) {} }, day);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(stubFor(mode));
  await p.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await p.goto(BASE + '/' + path, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  p.__errs = errs; p.__ctx = ctx;
  return p;
}

(async () => {
  const b = await launch();
  try {
    for (const w of [390, 1440]) for (const day of [false, true]) {
      const t = (day ? 'light' : 'dark');
      // 1. homepage: no prices, no pricing link, #pricing anchor still there
      let p = await page(b, 'out', 'index.html', w, day);
      const h = await p.evaluate(() => ({ txt: document.body.innerText, a: !!document.getElementById('pricing'),
        links: [...document.querySelectorAll('a[href*="pricing"]')].map((a) => a.getAttribute('href')),
        overflow: document.documentElement.scrollWidth > innerWidth }));
      ok(`home ${w} ${t}: no $ price or /month`, !/\$\s?\d|\/\s?month|per month/i.test(h.txt), (h.txt.match(/.{30}(\$\s?\d|\/\s?month).{20}/i) || [''])[0]);
      ok(`home ${w} ${t}: no pricing links`, !h.links.length, h.links.join(','));
      ok(`home ${w} ${t}: #pricing anchor kept`, h.a);
      ok(`home ${w} ${t}: no overflow, no errors`, !h.overflow && !p.__errs.length, p.__errs.join('|'));
      if (SHOTS) {
        await p.evaluate(() => { document.querySelectorAll('.cm-rv').forEach((e) => e.classList.add('is-in')); document.getElementById('pricing').scrollIntoView(); });
        await p.waitForTimeout(600);
        await p.screenshot({ path: `${SHOTS}/home-${w}-${t}.png` });
      }
      await p.__ctx.close();

      // 2. /pricing: live Free vs Pro + $7 add-on
      p = await page(b, 'out', 'pricing.html', w, day);
      const r = await p.evaluate(() => ({ live: !!document.querySelector('#pricing-root.pv-live'), txt: document.body.innerText,
        overflow: document.documentElement.scrollWidth > innerWidth }));
      ok(`pricing ${w} ${t}: live Pro card with $39`, r.live && /\$39/.test(r.txt));
      ok(`pricing ${w} ${t}: $7 add-on`, /\$7/.test(r.txt));
      ok(`pricing ${w} ${t}: no overflow, no errors`, !r.overflow && !p.__errs.length, p.__errs.join('|'));
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/pricing-${w}-${t}.png`, fullPage: true });
      await p.__ctx.close();

      // 3. Pro prompt: the shared lock card (GEX+) and the upgrade modal, as a Free member
      p = await page(b, 'free', 'settings.html', w, day);
      await p.addScriptTag({ url: BASE + '/assets/plan-lock.js' });
      await p.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'lock-host';
        host.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg-0)';
        host.appendChild(window.strykerPlanLock.card('gex', 'test'));
        document.body.appendChild(host);
      });
      await p.waitForTimeout(800);
      const l = await p.evaluate(() => ({ price: (document.querySelector('.plan-lock-price') || {}).textContent || '',
        cta: (document.querySelector('.plan-lock-cta') || {}).textContent || '',
        all: (document.querySelector('.plan-lock-back') || {}).getAttribute ? document.querySelector('.plan-lock-back').getAttribute('href') : '',
        see: (document.getElementById('settings-see-pro') || {}).textContent || '' }));
      ok(`lock ${w} ${t}: "Pro: $39 / month"`, l.price === 'Pro: $39 / month', l.price);
      ok(`lock ${w} ${t}: Get Pro + See all plans -> /pricing`, l.cta === 'Get Pro' && l.all === '/pricing', l.cta + ' ' + l.all);
      ok(`settings ${w} ${t}: upgrade button shows the Pro price`, /\$39 \/ month/.test(l.see), l.see);
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/pro-lock-${w}-${t}.png` });
      await p.evaluate(() => { document.getElementById('lock-host').remove(); window.openPlanUpgradeModal('GEX+ is part of Pro.'); });
      await p.waitForTimeout(900);
      const m = await p.evaluate(() => ({ txt: (document.querySelector('.plan-modal') || {}).innerText || '',
        all: !!document.querySelector('.plan-modal-all a[href="/pricing"]') }));
      ok(`modal ${w} ${t}: price + See all plans`, /\$39/.test(m.txt) && m.all && /(Get|Join) Pro/.test(m.txt), m.txt.replace(/\s+/g, ' ').slice(0, 120));
      ok(`settings ${w} ${t}: no errors`, !p.__errs.length, p.__errs.join('|'));
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/pro-modal-${w}-${t}.png` });
      await p.__ctx.close();
    }
  } finally { await b.close(); }
  console.log(log.join('\n'));
  const fails = log.filter((x) => x.startsWith('FAIL')).length;
  console.log(fails ? fails + ' FAILED' : 'ALL PASS (' + log.length + ')');
  process.exit(fails ? 1 : 0);
})();
