// Script editor screenshots (Zscript + Pine panels) at 1440 dark/light, 412 and 390. Used for before/after DESIGN CHECK.
//   CHART_BASE=http://localhost:8091 tools/chrome-slot.sh node tools/tests/chart-editor-shots.js <outDir> [tag]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://localhost:8031';
const OUT = process.argv[2] || '/tmp';
const TAG = process.argv[3] || 'shot';

async function open(b, { w, h, mobile, light }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((light) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (light) localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, !!light);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_PINE && window.STRYKER_ZS, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  return { ctx, p };
}
(async () => {
  const b = await launch();
  try {
    for (const v of (process.env.ONLY ? [{ w: 1440, h: 900, n: '1440-dark' }, { w: 390, h: 844, mobile: true, n: '390' }] : [{ w: 1440, h: 900, n: '1440-dark' }, { w: 1440, h: 900, light: true, n: '1440-light' }, { w: 412, h: 915, mobile: true, n: '412' }, { w: 390, h: 844, mobile: true, n: '390' }])) {
      const { ctx, p } = await open(b, v);
      await p.evaluate(async () => { const Z = window.STRYKER_ZS; Z.open(); for (let i = 0; i < 50 && !document.querySelector('#stkc-zs .cm-editor'); i++) await new Promise((r) => setTimeout(r, 100)); await Z.load('EMA cross', Z.examples[0].source, null); });
      await p.waitForTimeout(800);
      await p.screenshot({ path: `${OUT}/${TAG}-zs-${v.n}.png` });
      await p.evaluate(() => { window.STRYKER_ZS.close(); window.STRYKER_PINE.open(); });
      await p.waitForTimeout(600);
      await p.screenshot({ path: `${OUT}/${TAG}-pine-${v.n}.png` });
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log('done');
})();
