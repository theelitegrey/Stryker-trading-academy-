// Chart settings → Canvas → Toolbars → "Favorites toolbar" show / hide (assets/chart-settings.js +
// assets/chart-fav-toolbar.js). Both engines (0.9 default, ?vela=0.6), 1440 + 390. Firebase stubbed,
// so this covers the localStorage path (the signed-in path shares setVisible()/save()).
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-favbar-settings-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 240))); };
const shot = async (p, n) => { await p.screenshot({ path: OUT + '/' + n + '.png' }); console.log('shot', OUT + '/' + n + '.png'); };

async function ready(p) {
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_FAVBAR && document.querySelector('.vela-dtb'), null, { timeout: 45000 });
  await p.waitForTimeout(2000);
}
async function openSettings(p) {
  await p.evaluate(() => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id); c.chart.renderer.openSettings('Canvas'); });
  await p.waitForSelector('.vela-dialog--settings .stk-sd-extra', { timeout: 8000, state: 'attached' });
  await p.waitForTimeout(300);
  await p.evaluate(() => { const t = [...document.querySelectorAll('.vela-dialog--settings .vela-sd-tab')].find((x) => x.textContent === 'Canvas'); if (t) t.click(); });
  await p.waitForTimeout(250);
}
const favRow = (p) => p.evaluate(() => {
  const lab = [...document.querySelectorAll('.vela-dialog--settings .vela-field-label')].find((l) => l.textContent === 'Favorites toolbar');
  if (!lab) return null;
  const row = lab.closest('.vela-field-span');
  const sw = row.querySelector('.vela-switch');
  const head = [...document.querySelectorAll('.vela-dialog--settings .stk-sd-extra *')].some((x) => x.children.length === 0 && x.textContent === 'Toolbars');
  row.scrollIntoView({ block: 'center' });
  const r = row.getBoundingClientRect();
  return { checked: sw.getAttribute('aria-checked'), head, visibleOnScreen: r.height > 0 && r.top >= 0 && r.bottom <= innerHeight };
});
const clickFav = (p) => p.evaluate(() => { const lab = [...document.querySelectorAll('.vela-dialog--settings .vela-field-label')].find((l) => l.textContent === 'Favorites toolbar'); lab.closest('.vela-field-span').querySelector('.vela-switch').click(); });
const state = (p) => p.evaluate(() => ({ hidden: document.querySelector('.stk-fb').hidden, vis: window.STRYKER_FAVBAR.state.visible, ls: JSON.parse(localStorage.getItem('stryker_chart_favbar') || 'null'), tog: (document.querySelector('.stk-fb-tog') || {}).getAttribute && document.querySelector('.stk-fb-tog').getAttribute('aria-label') }));
const closeDlg = (p) => p.evaluate(() => { const ok = [...document.querySelectorAll('.vela-dialog--settings .stk-sd-ok')][0]; if (ok) ok.click(); });

(async () => {
  const b = await launch();
  try {
    for (const eng of ['0.9', '0.6']) {
      for (const vp of [{ w: 1440, h: 900 }, { w: 390, h: 844, mobile: true }]) {
        const tag = eng + ' ' + vp.w;
        const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.mobile ? 3 : 1, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
        await ctx.addInitScript(stub);
        await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
          if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('stryker_chart_favbar', JSON.stringify({ tools: ['trendline', 'hline', 'fibretracement'], x: null, y: null, visible: true })); } } catch (e) {} });
        await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
        const p = await ctx.newPage();
        p.errors = [];
        p.on('pageerror', (e) => p.errors.push(String(e)));
        const url = BASE + '/charts.html' + (eng === '0.6' ? '?vela=0.6' : '');
        await p.goto(url, { waitUntil: 'domcontentloaded' });
        await ready(p);
        check(await p.evaluate(() => !!window.__stkVela090) === (eng === '0.9'), tag + ': engine', await p.evaluate(() => window.__stkVela090));
        const s0 = await state(p);
        check(!s0.hidden && s0.vis, tag + ': favbar shown at start', s0);
        // 1. settings toggle -> hides
        await openSettings(p);
        const r0 = await favRow(p);
        check(r0 && r0.checked === 'true' && r0.head && r0.visibleOnScreen, tag + ': Canvas tab has Toolbars > Favorites toolbar, on', r0);
        await shot(p, 'fs-' + eng + '-' + vp.w + '-settings-on');
        await clickFav(p); await p.waitForTimeout(300);
        const s1 = await state(p);
        check(s1.hidden && !s1.vis && s1.ls && s1.ls.visible === false, tag + ': settings toggle hides the toolbar + saves', s1);
        check(s1.tog === 'Show favorites toolbar', tag + ': left-toolbar star button follows', s1.tog);
        await shot(p, 'fs-' + eng + '-' + vp.w + '-settings-off');
        // Cancel restores
        await p.evaluate(() => [...document.querySelectorAll('.vela-dialog--settings .vela-sd-btn')].find((x) => x.textContent === 'Cancel').click()); await p.waitForTimeout(300);
        check(!(await state(p)).hidden, tag + ': Cancel brings it back');
        await openSettings(p); await clickFav(p); await p.waitForTimeout(200); await closeDlg(p); await p.waitForTimeout(300);
        check((await state(p)).hidden, tag + ': off + Ok keeps it hidden');
        // 2. reload -> stays hidden, toggle shows off
        await p.reload({ waitUntil: 'domcontentloaded' }); await ready(p);
        const s2 = await state(p);
        check(s2.hidden && !s2.vis, tag + ': reload keeps it hidden', s2);
        await openSettings(p);
        const r2 = await favRow(p);
        check(r2 && r2.checked === 'false', tag + ': settings toggle shows off after reload', r2);
        // live sync while the dialog is open: star button -> switch flips on
        await p.evaluate(() => document.querySelector('.stk-fb-tog').click()); await p.waitForTimeout(300);
        const r3 = await favRow(p);
        check(r3.checked === 'true' && !(await state(p)).hidden, tag + ': star button while dialog open -> switch on, bar shown', r3);
        await closeDlg(p); await p.waitForTimeout(300);
        // 3. right-click hide -> settings toggle shows off
        await p.evaluate(() => { const h = document.querySelector('.stk-fb-h').getBoundingClientRect(); document.querySelector('.stk-fb-h').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: h.left + 4, clientY: h.top + 4 })); });
        await p.waitForTimeout(200);
        await p.evaluate(() => [...document.querySelectorAll('.stk-fb-menu button')].find((x) => x.textContent === 'Hide favorites toolbar').click()); await p.waitForTimeout(250);
        check((await state(p)).hidden, tag + ': right-click Hide hides it');
        await openSettings(p);
        const r4 = await favRow(p);
        check(r4 && r4.checked === 'false', tag + ': settings toggle shows off after right-click hide', r4);
        // turn back on from settings
        await clickFav(p); await p.waitForTimeout(300);
        check(!(await state(p)).hidden, tag + ': settings toggle shows it again');
        await closeDlg(p); await p.waitForTimeout(200);
        // 4. nothing starred: toggle still works, hint toast on show
        await p.evaluate(() => { window.__toasts = []; const d = window.STRYKER_VELA.active.chart.drawings; d.setFavorites([]); }); await p.waitForTimeout(300);
        check((await state(p)).hidden, tag + ': zero starred -> bar hidden');
        await openSettings(p);
        const r5 = await favRow(p);
        await clickFav(p); await p.waitForTimeout(200);
        const off5 = await state(p);
        await clickFav(p); await p.waitForTimeout(400);
        const on5 = await state(p);
        const hint = await p.evaluate(() => [...document.querySelectorAll('body *')].some((x) => x.children.length === 0 && /Star a drawing tool/.test(x.textContent)));
        check(r5.checked === 'true' && !off5.vis && on5.vis && hint, tag + ': with nothing starred the toggle still flips + shows the star hint', { r5, off: off5.vis, on: on5.vis, hint });
        if (vp.w === 390) await shot(p, 'fs-' + eng + '-390-empty-hint');
        await closeDlg(p);
        check(p.errors.length === 0, tag + ': no page errors', p.errors);
        await ctx.close();
      }
    }
  } catch (e) { fail++; console.log('FAIL exception', e && e.stack); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
