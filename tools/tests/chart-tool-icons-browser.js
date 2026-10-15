// Charts drawing-tool icons + floating favourites bar, TradingView behaviour (Owner order
// 2026-10-14; assets/chart-tool-icons.js, assets/chart-fav-toolbar.js, assets/chart-tv-toolbars.js)
// against tools/tests/chart-dev-server.mjs.
//   CHART_BASE=http://localhost:8061 node --max-old-space-size=768 tools/tests/chart-tool-icons-browser.js [shotsDir]
// Run under flock /tmp/stryker-chrome.lock (one Chrome at a time on the 4 GB server).
// Checks:
//   - every registered drawing type carries the shared icon (registry icon === TOOL_ICONS[type]);
//     nothing left on an old icon; every icon has drawn content (no empty glyph)
//   - every flyout row of the left column + the phone drawings sheet + the favourites bar shows
//     the same markup as the registry for that tool
//   - Long Position and Short Position are separate tools; each places its own direction
//   - favourites: star in a flyout adds; right-click -> "Remove from favorites" removes;
//     touch long-press opens the same menu; vertical layout option (remembered); tooltip shows
//     name + shortcut; active tool highlighted; drag + reload keeps the position
//   - phone 390: targets >= 40 px, bar off the price axis
//   - contact sheet of every icon (named), screenshots 1440 + 390
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://localhost:8061';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined || ok ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
const BUILD = String(require('../../assets/version.json').build);
const FAV = ['fibretracement', 'gannfan', 'trendline', 'hline', 'position', 'shortposition', 'box', 'hray'];

async function newCtx(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 3 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  return ctx;
}
async function open(ctx) {
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|WebSocket|Failed to load resource|\/api\/chart\/stream/.test(m.text())) p.errors.push(m.text()); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_FAVBAR, null, { timeout: 45000 });
  await p.waitForTimeout(3500);
  return p;
}
const shot = async (p, n, clip) => { await p.screenshot({ path: OUT + '/' + n + '.png', clip }); console.log('shot', OUT + '/' + n + '.png'); };
const barInfo = (p) => p.evaluate(() => {
  const bar = document.querySelector('.stk-fb');
  const g = document.querySelector('#vela-chart .vela-ws-grid').getBoundingClientRect();
  const r = bar.getBoundingClientRect();
  const bs = [...bar.querySelectorAll('.stk-fb-b')];
  return { hidden: bar.hidden, vert: bar.classList.contains('vert'), types: bs.map((x) => x.dataset.type), on: bs.filter((x) => x.classList.contains('on')).map((x) => x.dataset.type),
    sizes: bs.map((x) => { const q = x.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; }),
    r: { l: Math.round(r.left - g.left), t: Math.round(r.top - g.top), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right - g.left) }, g: { w: Math.round(g.width), h: Math.round(g.height) },
    inside: r.left >= g.left - 0.5 && r.top >= g.top - 0.5 && r.right <= g.right + 0.5 && r.bottom <= g.bottom + 0.5 };
});
async function starViaFlyout(p, type) {
  return p.evaluate(async (type) => {
    const m = await import('./assets/vendor/vela-0.6.17-s3/index.js');
    const label = m.getDrawingType(type).label;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const tb = document.querySelector('.vela-dtb');
    for (const a of [...tb.querySelectorAll('.vela-dtb-cell:not(.stkt-cell) .vela-dtb-arrow')]) {
      a.click(); await wait(90);
      const fly = document.querySelector('.vela-dtb-flyout');
      const row = fly && [...fly.querySelectorAll('.vela-dtb-item')].find((r) => r.getAttribute('aria-label') === label);
      if (row) { row.querySelector('.vela-dtb-star').click(); await wait(60); a.click(); await wait(50); return true; }
      a.click(); await wait(40);
    }
    return false;
  }, type);
}

(async () => {
  const b = await launch();
  try {
    // ================= desktop 1440 =================
    const ctx = await newCtx(b, { w: 1440, h: 900 });
    let p = await open(ctx);

    // ---- registry: every tool on the shared icon ----
    const reg = await p.evaluate(async () => {
      const m = await import('./assets/vendor/vela-0.6.17-s3/index.js');
      const I = await import('./assets/chart-tool-icons.js?v=544');
      const types = m.drawingTypes().map((d) => ({ type: d.type, label: d.label, same: d.icon === I.TOOL_ICONS[d.type], has: !!I.TOOL_ICONS[d.type] }));
      // drawn content: render each icon offscreen and measure the painted bbox
      const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:-500px;top:0;color:#000';
      document.body.appendChild(box);
      const empty = [];
      for (const [k, v] of Object.entries(I.TOOL_ICONS)) {
        box.innerHTML = v.replace('width="1em" height="1em"', 'width="28" height="28"');
        const s = box.firstElementChild; const bb = s.getBBox();
        if (!(bb.width > 4 || bb.height > 4) || s.childElementCount === 0) empty.push(k);
      }
      box.remove();
      return { types, empty, ui: Object.keys(I.UI_ICONS) };
    });
    const notShared = reg.types.filter((t) => !t.same).map((t) => t.type);
    check(reg.types.length >= 76, 'registry has every drawing type (' + reg.types.length + ')', reg.types.length);
    check(notShared.length === 0, 'every drawing type uses the shared icon', notShared);
    check(reg.empty.length === 0, 'no empty glyphs', reg.empty);
    const lab = Object.fromEntries(reg.types.map((t) => [t.type, t.label]));
    check(lab.position === 'Long Position' && lab.shortposition === 'Short Position', 'Long + Short Position tools', [lab.position, lab.shortposition]);
    require('fs').writeFileSync(OUT + '/tool-list.json', JSON.stringify(reg.types.map((t) => [t.type, t.label])));

    // ---- column + flyouts show the same markup ----
    const col = await p.evaluate(async () => {
      const m = await import('./assets/vendor/vela-0.6.17-s3/index.js');
      const byLabel = Object.fromEntries(m.drawingTypes().map((d) => [d.label, d]));
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const tb = document.querySelector('.vela-dtb');
      const rows = [], bad = [];
      for (const a of [...tb.querySelectorAll('.vela-dtb-cell:not(.stkt-cell) .vela-dtb-arrow')]) {
        const lab = a.getAttribute('aria-label') || '';
        if (/^Magnet/.test(lab)) continue;
        a.click(); await wait(90);
        const fly = document.querySelector('.vela-dtb-flyout');
        for (const r of fly ? fly.querySelectorAll('.vela-dtb-item') : []) {
          const d = byLabel[r.getAttribute('aria-label')];
          if (!d) continue;
          rows.push(d.type);
          const svg = r.querySelector('svg');
          if (!svg || !svg.getAttribute('viewBox') || svg.getAttribute('viewBox') !== '0 0 28 28') bad.push(d.type);
        }
        a.click(); await wait(40);
      }
      // group buttons + Vela's own buttons
      const btnIcons = [...tb.querySelectorAll('.vela-dtb-hit svg')].map((s) => s.getAttribute('viewBox'));
      return { rows, bad, btnIcons };
    });
    check(col.rows.length >= 77, 'left-column flyouts list every tool (' + col.rows.length + ')', col.rows.length);
    check(col.bad.length === 0, 'every flyout row draws the shared 28-grid icon', col.bad);
    const old = col.btnIcons.filter((v) => v !== '0 0 28 28' && v !== '0 0 24 24');
    check(col.btnIcons.filter((v) => v === '0 0 28 28').length >= 14, 'column buttons on the shared set', col.btnIcons);
    check(col.rows.indexOf('shortposition') === col.rows.indexOf('position') + 1, 'Short Position listed right after Long Position', [col.rows.indexOf('position'), col.rows.indexOf('shortposition')]);

    // ---- favourites via stars ----
    for (const t of FAV) check(await starViaFlyout(p, t), 'starred ' + t);
    await p.waitForTimeout(300);
    let bi = await barInfo(p);
    check(!bi.hidden && bi.types.join() === FAV.join(), 'bar shows the starred tools in order', bi.types);
    check(!bi.vert, 'horizontal by default');
    const same = await p.evaluate(async () => {
      const m = await import('./assets/vendor/vela-0.6.17-s3/index.js');
      return [...document.querySelectorAll('.stk-fb-b')].filter((b) => { const s = b.querySelector('svg'); const ref = m.getDrawingType(b.dataset.type).icon; const d = document.createElement('div'); d.innerHTML = ref; return !s || s.innerHTML !== d.firstElementChild.innerHTML; }).map((b) => b.dataset.type);
    });
    check(same.length === 0, 'favourites bar icons == registry icons', same);
    check(bi.sizes.every(([w, h]) => w >= 32 && h >= 32), 'desktop buttons 34 px', bi.sizes);

    // ---- tooltip with name + shortcut ----
    await p.hover('.stk-fb-b[data-type="trendline"]'); await p.waitForTimeout(650);
    const tip = await p.evaluate(() => { const t = document.querySelector('.stk-fb-tip'); return t.hidden ? null : [t.querySelector('span') && t.querySelector('span').textContent, t.querySelector('kbd') && t.querySelector('kbd').textContent]; });
    check(tip && tip[0] === 'Trend Line' && /Alt\s*\+?\s*T/i.test(tip[1] || ''), 'tooltip: name + shortcut', tip);
    await p.mouse.move(5, 5);

    // ---- arm: highlighted; draw a Long and a Short ----
    const cv = await p.evaluate(() => { const r = document.querySelector('#vela-chart .vela-cell canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    for (const [t, dy, want] of [['position', 1, 'long'], ['shortposition', 1, 'short'], ['shortposition', -1, 'short'], ['position', -1, 'long']]) {
      await p.click('.stk-fb-b[data-type="' + t + '"]'); await p.waitForTimeout(120);
      const on = (await barInfo(p)).on;
      check(on.join() === t, 'active tool highlighted: ' + t, on);
      const x1 = cv.x + cv.w * 0.3, y1 = cv.y + cv.h * 0.5;
      await p.mouse.click(x1, y1); await p.waitForTimeout(80);
      await p.mouse.move(x1 + 80, y1 - dy * 60, { steps: 4 }); await p.mouse.click(x1 + 80, y1 - dy * 60); await p.waitForTimeout(250);
      const dir = await p.evaluate(() => { const all = window.STRYKER_VELA.active.chart.drawings.all(); const d = all[all.length - 1]; const a = d.anchors; return { type: d.type, dir: a.length >= 3 ? (a[2].price > a[0].price ? 'long' : 'short') : '?' }; });
      check(dir.dir === want, t + ' placed with second click ' + (dy > 0 ? 'above' : 'below') + ' -> ' + want, dir);
      await p.keyboard.press('Escape');
    }
    await p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.setTool(null));
    await p.waitForTimeout(200);
    await shot(p, 'icons-1440-drawn-positions');

    // ---- right-click -> Remove from favorites ----
    await p.click('.stk-fb-b[data-type="hray"]', { button: 'right' }); await p.waitForTimeout(200);
    const mt = await p.evaluate(() => [...document.querySelectorAll('.stk-fb-menu button')].map((x) => x.textContent));
    check(mt[0] === 'Remove from favorites' && mt.includes('Vertical layout') && mt.includes('Hide favorites toolbar'), 'right-click menu', mt);
    await shot(p, 'icons-1440-fav-menu');
    await p.click('.stk-fb-menu button'); await p.waitForTimeout(250);
    bi = await barInfo(p);
    const vf = await p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.favorites());
    check(!bi.types.includes('hray') && !vf.includes('hray'), 'removed from bar + flyout stars', { bar: bi.types, vela: vf });
    check(await starViaFlyout(p, 'hray'), 're-star hray'); await p.waitForTimeout(200);

    // ---- vertical layout ----
    await p.click('.stk-fb-h', { button: 'right' }); await p.waitForTimeout(150);
    await p.evaluate(() => [...document.querySelectorAll('.stk-fb-menu button')].find((x) => x.textContent === 'Vertical layout').click());
    await p.waitForTimeout(250);
    bi = await barInfo(p);
    check(bi.vert && bi.r.h > bi.r.w * 3 && bi.inside, 'vertical layout', bi.r);
    await shot(p, 'icons-1440-fav-vertical');
    // ---- drag + reload keeps position + layout ----
    const gb = await p.evaluate(() => { const r = document.querySelector('#vela-chart .vela-ws-grid').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const hb = await (await p.$('.stk-fb-h')).boundingBox();
    await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await p.mouse.down();
    for (let i = 1; i <= 8; i++) await p.mouse.move(hb.x + (gb.x + gb.w * 0.2 - hb.x) * i / 8, hb.y + (gb.y + 120 - hb.y) * i / 8);
    await p.mouse.up(); await p.waitForTimeout(250);
    const before = await barInfo(p);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_FAVBAR, null, { timeout: 45000 });
    await p.waitForTimeout(3000);
    const after = await barInfo(p);
    check(after.vert && after.types.join() === before.types.join() && Math.abs(after.r.l - before.r.l) <= 2 && Math.abs(after.r.t - before.r.t) <= 2, 'reload keeps tools, layout, position', { before: before.r, after: after.r });
    // back to horizontal, default spot
    await p.evaluate(() => { window.STRYKER_FAVBAR.setVertical(false); const s = window.STRYKER_FAVBAR.state; s.x = null; s.y = null; window.STRYKER_FAVBAR.render(); });
    await p.waitForTimeout(250);
    bi = await barInfo(p);
    check(!bi.vert && bi.inside, 'horizontal again');
    // screenshot: favourites bar crop + the left column with flyouts open
    const br = await p.evaluate(() => { const r = document.querySelector('.stk-fb').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await shot(p, 'icons-1440-favbar', { x: Math.max(0, br.x - 20), y: Math.max(0, br.y - 20), width: br.w + 40, height: br.h + 40 });
    await shot(p, 'icons-1440-page');
    let n = 0;
    for (const lab of ['Lines', 'Fibonacci', 'Patterns', 'Measurements', 'Shapes', 'Text', 'Icons']) {
      const okOpen = await p.evaluate((lab) => {
        const cell = [...document.querySelectorAll('.vela-dtb .vela-dtb-cell:not(.stkt-cell)')].find((c) => { const a = c.querySelector('.vela-dtb-arrow'); return a && (a.getAttribute('aria-label') || '').indexOf(' \u2014 more') > 0 && c.querySelector('.vela-dtb-icon'); });
        const groups = [...document.querySelectorAll('.vela-dtb .vela-dtb-cell:not(.stkt-cell) .vela-dtb-arrow')].filter((a) => !/^Magnet/.test(a.getAttribute('aria-label')));
        const order = ['Lines', 'Fibonacci', 'Patterns', 'Measurements', 'Shapes', 'Text', 'Icons'];
        const a = groups[order.indexOf(lab)];
        if (!a) return false;
        a.click();
        return !!document.querySelector('.vela-dtb-flyout');
      }, lab);
      if (okOpen) { await p.waitForTimeout(150); await shot(p, 'icons-1440-flyout-' + lab.toLowerCase()); n++; await p.keyboard.press('Escape'); await p.mouse.click(700, 5); await p.waitForTimeout(100); }
    }
    check(n === 7, 'opened all 7 group flyouts', n);
    check(p.errors.length === 0, 'desktop: no page errors', p.errors);

    // ---- contact sheet (same page so the module resolves) ----
    await p.evaluate(async () => {
      const m = await import('./assets/vendor/vela-0.6.17-s3/index.js');
      const I = await import('./assets/chart-tool-icons.js?v=544');
      const sheet = document.createElement('div');
      sheet.id = 'stk-sheet';
      sheet.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#131722;color:#d1d4dc;padding:18px;font:12px -apple-system,Segoe UI,Roboto,sans-serif;display:grid;grid-template-columns:repeat(8,1fr);gap:8px;align-content:start;overflow:hidden';
      const h = document.createElement('div'); h.style.cssText = 'grid-column:1/-1;font-size:15px;font-weight:600;color:#fff;margin-bottom:4px';
      h.textContent = 'Charts drawing-tool icons (shared set, 28 px grid) - 1x / 2x / day theme';
      sheet.appendChild(h);
      const add = (key, label, svg) => {
        const c = document.createElement('div'); c.style.cssText = 'background:#1e222d;border:1px solid #2a2e39;border-radius:6px;padding:8px 6px;display:flex;flex-direction:column;align-items:center;gap:4px';
        const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;align-items:center';
        const a = document.createElement('span'); a.innerHTML = svg.replace('width="1em" height="1em"', 'width="28" height="28"');
        const b2 = document.createElement('span'); b2.innerHTML = svg.replace('width="1em" height="1em"', 'width="56" height="56"');
        const d = document.createElement('span'); d.style.cssText = 'background:#fff;color:#131722;border-radius:4px;display:flex;padding:2px'; d.innerHTML = svg.replace('width="1em" height="1em"', 'width="28" height="28"');
        row.append(a, b2, d);
        const t = document.createElement('div'); t.style.cssText = 'text-align:center;line-height:1.25'; t.textContent = label;
        const k = document.createElement('div'); k.style.cssText = 'color:#787b86;font:10px ui-monospace,monospace'; k.textContent = key;
        c.append(row, t, k); sheet.appendChild(c);
      };
      for (const d of m.drawingTypes()) add(d.type, d.label, d.icon);
      for (const [k, v] of Object.entries(I.UI_ICONS)) add('ui:' + k, k, v);
      document.body.appendChild(sheet);
    });
    await p.setViewportSize({ width: 1500, height: 2200 });
    await p.waitForTimeout(300);
    const sh = await p.evaluate(() => { const s = document.getElementById('stk-sheet'); const last = s.lastElementChild.getBoundingClientRect(); return Math.ceil(last.bottom + 18); });
    await shot(p, 'icons-contact-sheet', { x: 0, y: 0, width: 1500, height: Math.min(2200, sh) });
    await ctx.close();

    // ================= phone 390 =================
    const pctx = await newCtx(b, { w: 390, h: 844, mobile: true });
    await pctx.addInitScript((fav) => { try { if (!localStorage.getItem('stryker_chart_favbar')) localStorage.setItem('stryker_chart_favbar', JSON.stringify({ tools: fav, x: null, y: null, visible: true })); } catch (e) {} }, FAV);
    p = await open(pctx);
    bi = await barInfo(p);
    const axisFrom = await p.evaluate(() => { const R = window.STRYKER_VELA.active.chart.renderer.renderer; const g = document.querySelector('#vela-chart .vela-ws-grid').getBoundingClientRect(); const c = R.input.el.getBoundingClientRect(); return Math.round(c.left - g.left + R.coords.width); });
    check(!bi.hidden && bi.types.length === FAV.length && bi.inside, '390: bar shows (kept favourites from storage)', bi);
    check(bi.sizes.every(([w, h]) => w >= 40 && h >= 40), '390: targets >= 40 px', bi.sizes);
    check(bi.r.right <= axisFrom + 1, '390: off the price axis', { right: bi.r.right, axisFrom });
    await shot(p, 'icons-390-page');
    const br2 = await p.evaluate(() => { const r = document.querySelector('.stk-fb').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await shot(p, 'icons-390-favbar', { x: 0, y: Math.max(0, br2.y - 60), width: 390, height: Math.min(300, br2.h + 140) });
    // touch drag tries to cover the axis -> clamped off it
    const hb2 = await (await p.$('.stk-fb-h')).boundingBox();
    await p.evaluate(([sx, sy]) => {
      const h = document.querySelector('.stk-fb-h');
      const ev = (type, x, y) => h.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1 }));
      ev('pointerdown', sx, sy); for (let i = 1; i <= 8; i++) ev('pointermove', sx + 60 * i, sy + 30 * i); ev('pointerup', sx + 480, sy + 240);
    }, [hb2.x + hb2.width / 2, hb2.y + hb2.height / 2]);
    await p.waitForTimeout(250);
    const t2 = await barInfo(p);
    check(t2.inside && t2.r.right <= axisFrom + 1, '390: touch drag stays on screen and off the axis', { r: t2.r, axisFrom });
    // long press -> Remove from favorites
    const bb = await (await p.$('.stk-fb-b[data-type="box"]')).boundingBox();
    await p.evaluate(([x, y]) => {
      const b = document.querySelector('.stk-fb-b[data-type="box"]');
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1 }));
    }, [bb.x + bb.width / 2, bb.y + bb.height / 2]);
    await p.waitForTimeout(800);
    await p.evaluate(([x, y]) => { const b = document.querySelector('.stk-fb-b[data-type="box"]'); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0 })); }, [bb.x + bb.width / 2, bb.y + bb.height / 2]);
    await p.waitForTimeout(150);
    const lm = await p.evaluate(() => [...document.querySelectorAll('.stk-fb-menu button')].map((x) => x.textContent));
    const armed = await p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.getTool());
    check(lm[0] === 'Remove from favorites' && armed == null, '390: long press opens the menu (and does not arm)', { lm, armed });
    await shot(p, 'icons-390-longpress-menu');
    await p.tap('.stk-fb-menu button'); await p.waitForTimeout(250);
    check(!(await barInfo(p)).types.includes('box'), '390: removed via long press');
    await p.tap('.stk-fb-b[data-type="position"]'); await p.waitForTimeout(150);
    check((await barInfo(p)).on.join() === 'position', '390: tap arms + highlights');
    await p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.setTool(null));
    // phone drawings sheet uses the same icons
    const sheetSame = await p.evaluate(async () => {
      const m = await import('./assets/vendor/vela-0.6.17-s3/index.js');
      try { window.STRYKER_VELA.openDrawingsDrawer(); } catch (e) { return 'no drawer'; }
      await new Promise((r) => setTimeout(r, 300));
      const byLabel = Object.fromEntries(m.drawingTypes().map((d) => [d.label, d]));
      const rows = [...document.querySelectorAll('.vela-dd-row')];
      const bad = rows.filter((r) => { const l = r.querySelector('.vela-dd-label'); const d = l && byLabel[l.textContent]; return !d || (() => { const x = document.createElement('div'); x.innerHTML = d.icon; return r.querySelector('.vela-dd-glyph').innerHTML !== x.innerHTML; })(); }).map((r) => r.textContent);
      return { n: rows.length, bad };
    });
    check(sheetSame.n > 5 && sheetSame.bad.length === 0, '390: drawings sheet rows use the shared icons', sheetSame);
    await shot(p, 'icons-390-drawings-sheet');
    check(p.errors.length === 0, '390: no page errors', p.errors);
    await pctx.close();
  } catch (e) { fail++; console.log('FAIL exception', e && e.stack); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
