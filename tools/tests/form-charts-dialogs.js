// Charts page dialogs through the form probe (Owner 2026-10-26 form sweep): opens every toolbar
// dialog/popover at 1440 and 390 (dark + day), runs PROBE on the open dialog, screenshots it.
// Needs: node chart-dev-server.mjs 8031 (live Yahoo via the real Pages Function).
//   CHART_BASE=http://localhost:8031 OUT=<dir> TAG=after node form-charts-dialogs.js
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const { PROBE } = require('./form-probe.js');
const fs = require('fs');
const BASE = process.env.CHART_BASE || 'http://localhost:8031'; const OUT = process.env.OUT || '/tmp'; const TAG = process.env.TAG || 'after';
const HOOKS = [['indicators', '.vela-widget-indicators'], ['symbol', '.vela-widget-symbol'], ['templates', '#stkc-tpl-btn'], ['layout', '#stkc-layout-btn'],
  ['layouts', '#stkl-btn'], ['replay', '#stkr-btn'], ['alerts', '#stkc-alerts-btn'], ['settings', '#stkc-settings-btn'], ['credits', '#stkc-credits-btn']];
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=600', '--disable-dev-shm-usage'] }); const res = {};
  for (const [w, h, mobile, theme] of [[1440, 900, false, 'night'], [1440, 900, false, 'day'], [390, 844, true, 'night'], [390, 844, true, 'day']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' : undefined });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t); } catch (e) {} }, theme);
    await ctx.route(/^https?:\/\/(?!localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage(); const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_CHART_UI, null, { timeout: 40000 }).catch(() => {});
    await p.waitForTimeout(3500);
    for (const [name, sel] of HOOKS) {
      const key = name + ' ' + w + ' ' + theme;
      try {
        await p.keyboard.press('Escape'); await p.waitForTimeout(150);
        const el = await p.$(sel); let clicked = false;
        if (el && await el.isVisible()) { await el.click({ timeout: 3000 }); clicked = true; }
        else if (await p.$('#stkc-more-btn')) { await p.click('#stkc-more-btn').catch(() => {}); await p.waitForTimeout(250); const e2 = await p.$('#stkc-more-pop ' + sel + ', ' + sel); if (e2 && await e2.isVisible()) { await e2.click({ timeout: 3000 }); clicked = true; } }
        await p.waitForTimeout(700);
        const r = await p.evaluate(PROBE); r.clicked = clicked;
        // keep only findings inside a visible dialog/popover
        const inDlg = await p.evaluate(() => { const d = [...document.querySelectorAll('[role=dialog], [class*=-pop], [class*=modal], [class*=sheet], .stkiw, .stkiw-ov, .vela-sp')].filter((x) => x.getClientRects().length && x.getBoundingClientRect().height > 60); return d.map((x) => (x.id ? '#' + x.id : '') + '.' + String(x.className).split(' ')[0]).slice(0, 4); });
        r.dialogs = inDlg;
        r.native = r.native.filter((n) => n.visible);
        r.count = r.native.length + r.rowmis.length + r.details.length + r.whitebtn.length + r.clip.length + (r.hscroll ? 1 : 0);
        const f = OUT + '/' + TAG + '-charts-' + name + '-' + w + '-' + theme + '.png'; await p.screenshot({ path: f }); r.shot = f;
        res[key] = r;
      } catch (e) { res[key] = { error: String(e).slice(0, 160) }; }
    }
    res['errors ' + w + ' ' + theme] = errors.slice(0, 5);
    await ctx.close();
  }
  fs.writeFileSync(OUT + '/charts-' + TAG + '.json', JSON.stringify(res, null, 1)); console.log('done', Object.keys(res).length);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
