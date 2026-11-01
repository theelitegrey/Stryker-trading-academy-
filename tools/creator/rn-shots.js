// Shoots UI pieces of the LIVE Richard NQ community page (tradezoro.com/c/tradezoro) for the Creator Hub feature page.
// Output: <outdir>/*.png (convert to webp with tools/creator/rn-build.py). Hides the member stat and the demo chip; never shoots members, comments or counts.
// Run (Chrome under the shared lock): node tools/creator/rn-shots.js <outdir>
const { launch } = require('../tests/lib.js');
const O = process.argv[2] || '/tmp/rn-shots';
require('fs').mkdirSync(O, { recursive: true });
const HIDE = '.cp-stat:first-child,.cp-chip.demo{display:none!important} .rv{opacity:1!important;transform:none!important;transition:none!important} *{animation:none!important} #site-nav,.nav{display:none!important}';
(async () => {
  const b = await launch();
  for (const theme of ['dark', 'light']) {
    for (const mob of [false, true]) {
      const ctx = await b.newContext({ viewport: { width: mob ? 390 : 960, height: 900 }, deviceScaleFactor: mob ? 2 : 1.5 });
      await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
      const p = await ctx.newPage();
      await p.goto('https://tradezoro.com/c/tradezoro', { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('.cp-stat', { timeout: 25000 }); await p.waitForTimeout(4000);
      await p.addStyleTag({ content: HIDE });
      await p.waitForTimeout(400);
      const sh = async (sel, name) => { const e = await p.$(sel); if (!e) { console.log('missing', sel); return; } await e.screenshot({ path: `${O}/${name}-${theme}${mob ? '-m' : ''}.png` }); };
      await sh('.cp-head', 'head');
      await sh('.cp-tabs', 'tabs');
      if (!mob) {
        await sh('.cp-about', 'about');
        await sh('.cx-plan', 'plan');
        await p.click('.cp-tabs >> text=Indicators'); await p.waitForTimeout(2500);
        const cards = await p.$$('.cx-icard');
        for (let i = 0; i < cards.length; i++) await cards[i].screenshot({ path: `${O}/ind${i + 1}-${theme}.png` });
        await p.click('.cp-tabs >> text=Courses'); await p.waitForTimeout(2500);
        await sh('.cx-chead', 'chead'); await sh('.cx-curr', 'curr');
      }
      await ctx.close();
    }
  }
  await b.close();
})();
