// Compact layout (member request 19 Nov 2026) + the "no gap under the time axis" fix.
//   node tools/tests/chart-dev-server.mjs 8061 &
//   CHART_BASE=http://127.0.0.1:8061 flock /tmp/stryker-chrome.lock node tools/tests/chart-compact-browser.js <shotsDir>
// Off (default): header shown, bar 38px, chart bottom flush with the bar (desktop) / the screen (phone).
// On: header hidden, bar 28px, three icons + account in a floating group inside the chart's top-right corner (one centre line,
// even padding), menu button + market clock in the toolbar, chart bottom still flush, no horizontal scroll, pref survives reload.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };

async function open(b, w, theme, compact) {
  const ctx = await b.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, isMobile: w < 500, hasTouch: w < 500, deviceScaleFactor: 1 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([t, c]) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t); if (c) localStorage.setItem('stryker_chart_compact', '1'); } catch (e) {} }, [theme, compact]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net|[a-z0-9.-]*hyperliquid\.xyz)/, (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_COMPACT, null, { timeout: 60000 });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('hyperliquid:BTC'); ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 50) break; } });
  await p.waitForTimeout(2500);
  return { ctx, p };
}
const measure = (p) => p.evaluate(() => {
  const R = (s) => { const e = typeof s === 'string' ? document.querySelector(s) : s; if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height, cy: r.y + r.height / 2 }; };
  const fl = document.getElementById('stkcmp-float');
  const kids = fl ? [...fl.children].filter((c) => c.getClientRects().length).map((c) => R(c)) : [];
  const panel = R('.stkchart-panel'), ws = R('.vela-ws-main'), bb = R('.vela-widget-bottombar'), hdr = R('.mobile-topnav');
  return { hdr, bb, ws, panel, fl: R(fl), kids, menu: R('#stkcmp-menu'), clock: R('#mclock'), ih: innerHeight, iw: innerWidth, sw: document.documentElement.scrollWidth,
    compact: document.documentElement.classList.contains('stk-compact'), stored: localStorage.getItem('stryker_chart_compact'),
    icons: [...(fl ? fl.querySelectorAll('.icon-btn, .account-trigger') : [])].map((i) => { const r = i.getBoundingClientRect(); return { w: r.width, h: r.height, cy: r.y + r.height / 2 }; }) };
});

(async () => {
  const b = await launch();
  try {
    for (const [w, theme] of [[1440, 'night'], [1440, 'day'], [390, 'night'], [390, 'day']]) {
      const tag = w + (theme === 'night' ? '-dark' : '-light');
      const desk = w > 500;
      // ---- OFF
      let { ctx, p } = await open(b, w, theme, false);
      let m = await measure(p);
      check(!m.compact && m.stored === null, tag + ' off by default (nothing saved)');
      if (desk) { check(m.hdr && m.hdr.h >= 40, tag + ' off: site header shown', m.hdr); check(m.bb && Math.abs(m.bb.h - 38) <= 1, tag + ' off: bottom bar 38px', m.bb && m.bb.h); check(Math.abs(m.ws.b - m.bb.y) <= 0.5, tag + ' off: GAP between chart and bottom bar is 0', [m.ws.b, m.bb.y]); }
      else check(Math.abs(m.ws.b - m.ih) <= 0.5, tag + ' off: GAP under the chart is 0 (phone)', [m.ws.b, m.ih]);
      await p.screenshot({ path: OUT + '/compact-off-' + tag + '.png' });
      // ---- ON, toggled live
      await p.evaluate(() => window.STRYKER_COMPACT.set(true)); await p.waitForTimeout(1200);
      m = await measure(p);
      check(m.compact && m.stored === '1', tag + ' on: class set and pref saved');
      check(m.sw <= m.iw, tag + ' on: no horizontal scroll', [m.sw, m.iw]);
      if (desk) {
        check(!m.hdr, tag + ' on: site header hidden');
        check(m.bb && Math.abs(m.bb.h - 28) <= 1, tag + ' on: bottom bar 28px (was 38)', m.bb && m.bb.h);
        check(Math.abs(m.ws.b - m.bb.y) <= 0.5, tag + ' on: GAP between chart and bottom bar is 0', [m.ws.b, m.bb.y]);
        check(m.fl && m.kids.length >= 3, tag + ' on: floating group with the three icons + account', m.kids.length);
        check(m.fl && m.fl.x >= m.panel.x && m.fl.r <= m.panel.r && m.fl.y >= m.panel.y && m.fl.b <= m.panel.b, tag + ' on: group sits inside the chart panel', [m.fl, m.panel]);
        const cys = m.kids.map((k) => k.cy), spread = Math.max(...cys) - Math.min(...cys);
        check(spread <= 1, tag + ' on: icons share one centre line', spread);
        const fcy = m.fl.cy; check(cys.every((c) => Math.abs(c - fcy) <= 1), tag + ' on: icons centred in the group', [cys, fcy]);
        check(Math.abs((m.kids[0].x - m.fl.x) - (m.fl.r - m.kids[m.kids.length - 1].r)) <= 2, tag + ' on: even left/right padding in the group', [m.kids[0].x - m.fl.x, m.fl.r - m.kids[m.kids.length - 1].r]);
        check(m.menu && m.clock, tag + ' on: menu button + market clock reachable in the toolbar');
        const hits = await p.evaluate(() => { const f = document.getElementById('stkcmp-float').getBoundingClientRect(); const e = document.elementFromPoint(f.x + f.width / 2, f.y + f.height / 2); return !!(e && e.closest('#stkcmp-float')); });
        check(hits, tag + ' on: the group is on top (clickable)');
      } else {
        check(Math.abs(m.ws.b - m.ih) <= 0.5, tag + ' on: GAP under the chart is 0 (phone)', [m.ws.b, m.ih]);
      }
      await p.screenshot({ path: OUT + '/compact-on-' + tag + '.png' });
      if (w === 1440 && theme === 'night') {
        // settings row
        await p.evaluate(() => document.getElementById('stkc-settings-btn') && document.getElementById('stkc-settings-btn').click()); await p.waitForTimeout(800);
        const row = await p.evaluate(() => [...document.querySelectorAll('.vela-dialog--settings .vela-field-label')].some((l) => l.textContent === 'Compact layout'));
        check(row, 'Chart settings has a "Compact layout" row');
        await p.keyboard.press('Escape');
        // back off: everything returns
        await p.evaluate(() => window.STRYKER_COMPACT.set(false)); await p.waitForTimeout(800);
        m = await measure(p);
        check(!m.compact && m.stored === null && m.hdr && m.hdr.h >= 40 && !m.fl && !m.menu, 'off again: header back, floating group + menu button removed, pref cleared');
        const back = await p.evaluate(() => !!document.querySelector('.mobile-topnav #msg-icon-wrap, .mobile-topnav .topnav-right #notif-bell-btn') );
        check(back, 'off again: the icons are back in the site header');
        await p.evaluate(() => window.STRYKER_COMPACT.set(true));
      }
      await ctx.close();
      // ---- ON after reload (saved pref)
      ({ ctx, p } = await open(b, w, theme, true));
      m = await measure(p);
      check(m.compact && (!desk || !m.hdr), tag + ' remembered: compact on after reload');
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
