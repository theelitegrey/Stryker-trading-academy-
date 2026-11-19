// Browser test + shots: the Templates gallery and the Templates menu (Owner 19 Nov 2026 redesign).
// Gallery: real thumbnails, filters, search, hover actions, detail view, My templates tab, Esc, focus trap, apply.
// Menu: Browse row with count, one Save + Whole chart | Tools only, row icons on hover, no horizontal overflow.
// Measures alignment (getBoundingClientRect) and writes shots to <outDir>.
//   node tools/tests/chart-fixture-server.mjs 8261 any.json ; CHART_BASE=http://127.0.0.1:8261 flock /tmp/stryker-chrome.lock node tools/tests/chart-tpl-ui-browser.js <outDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const { newCtx, openPage, sleep } = require('./phone-layouts-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8261', OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };

// the menu: click, wait for the async render; a stale toggle state (menu-hover, onebar re-homing) gets a close + retry
async function openMenu(p) {
  for (let k = 0; k < 5; k++) {
    // narrow bars move Templates into the ⋯ menu (chart-onebar.js): open ⋯ first, like a member would
    await p.evaluate(() => { const b = document.getElementById('stkc-tpl-btn'); if (!b.getClientRects().length || !b.getBoundingClientRect().width) { const m = document.getElementById('stkc-more-btn') || document.querySelector('.stkc-ob-more > button'); if (m && m.getAttribute('aria-expanded') !== 'true') m.click(); } });
    await sleep(300);
    await p.evaluate(() => { const b = document.getElementById('stkc-tpl-btn'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); });
    for (let i = 0; i < 20; i++) { await sleep(400); if (await p.isVisible('#stkc-tpl-pop .stkt-browse')) return; }
    await p.evaluate(() => { const b = document.getElementById('stkc-tpl-btn'); if (b.getAttribute('aria-expanded') === 'true') b.click(); }); await sleep(300);
  }
  throw new Error('Templates menu did not open');
}
const openGal = (p) => openMenu(p).then(() => p.click('#stkc-tpl-pop .stkt-browse')).then(() => p.waitForSelector('.stkt-card', { timeout: 10000 })).then(() => sleep(900));
const imgsLoaded = (p) => p.evaluate(async () => { const v = [...document.querySelectorAll('.stkt-card')].slice(0, 6).map((c) => [...c.querySelectorAll('img')].find((i) => i.getClientRects().length && getComputedStyle(i).display !== 'none'));
  for (let k = 0; k < 30 && v.some((i) => !i || !i.complete); k++) await new Promise((r) => setTimeout(r, 200)); return v.every((i) => i && i.complete && i.naturalWidth === 640); });

// alignment: every pill/chip/button - text centred vertically (1px), siblings in a row share a centre, nothing overflows
const align = (p, sel) => p.evaluate((sel) => {
  const bad = [];
  document.querySelectorAll(sel).forEach((n) => {
    if (!n.getClientRects().length) return;
    const r = n.getBoundingClientRect(), cs = getComputedStyle(n);
    if (n.scrollWidth > n.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && !/auto|scroll/.test(cs.overflowX)) bad.push(['overflow', n.className, n.scrollWidth, n.clientWidth]);
    const pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
    if (/stkt-pill|stkt-apply|stkt-pv|stkt-chip|stkc-sbtn|stkt-tf/.test(n.className) && Math.abs(pl - pr) > 1) bad.push(['padLR', n.className, pl, pr]);
    // text vertical centre
    const rg = document.createRange(); rg.selectNodeContents(n); const tr = rg.getBoundingClientRect();
    if (tr.height && n.children.length === 0 && Math.abs((tr.top + tr.bottom) / 2 - (r.top + r.bottom) / 2) > 1.01) bad.push(['vcentre', n.className, n.textContent.slice(0, 20), +((tr.top + tr.bottom) / 2 - (r.top + r.bottom) / 2).toFixed(2)]);
  });
  return bad;
}, sel);
const rowCentres = (p, sel) => p.evaluate((sel) => { const out = []; document.querySelectorAll(sel).forEach((row) => { if (!row.getClientRects().length) return; const kids = [...row.children].filter((k) => k.getClientRects().length && getComputedStyle(k).position !== 'absolute'); const cs = kids.map((k) => { const r = k.getBoundingClientRect(); return (r.top + r.bottom) / 2; }); if (cs.length > 1 && Math.max(...cs) - Math.min(...cs) > 1.01) out.push([row.className, cs.map((x) => x.toFixed(1))]); }); return out; }, sel);

(async () => {
  const b = await launch();
  try {
    for (const z of [{ tag: '1440-dark', w: 1440, h: 900 }, { tag: '1440-light', w: 1440, h: 900, th: 'light' }, { tag: '1024-dark', w: 1024, h: 768 }, { tag: '768-dark', w: 768, h: 1024 }, { tag: '390-dark', w: 390, h: 844, mobile: true }, { tag: '412-light', w: 412, h: 915, mobile: true, th: 'light' }]) {
      const ctx = await newCtx(b, { w: z.w, h: z.h, mobile: z.mobile });
      await ctx.addInitScript((th) => { try { localStorage.setItem('stryker_theme', th === 'light' ? 'day' : 'night'); } catch (e) {} if (th === 'light' && document.documentElement) document.documentElement.setAttribute('data-theme', 'light'); }, z.th || 'dark');
      const { p, errors } = await openPage(ctx, BASE, true);
      p.on('pageerror', (e) => { if (process.env.STACK) console.log('STACK', e.stack); });
      const big = z.w >= 1024, tag = z.tag;
      // ---- menu, empty
      await openMenu(p); await sleep(300);
      const m = await p.evaluate(() => { const pop = document.getElementById('stkc-tpl-pop'), r = pop.getBoundingClientRect(), i = pop.querySelector('.stkc-saverow .stkc-in').getBoundingClientRect(), s = pop.querySelector('.stkc-saverow .stkc-sbtn').getBoundingClientRect();
        return { hx: pop.scrollWidth - pop.clientWidth, setupBtn: !!pop.querySelector('.stkc-sbtn-2'), browse: pop.querySelector('.stkt-browse').textContent, seg: [...pop.querySelectorAll('.stkc-tseg [role=radio]')].map((x) => x.textContent + ':' + x.getAttribute('aria-checked')),
          inH: i.height, btnH: s.height, cDiff: Math.abs((i.top + i.bottom) / 2 - (s.top + s.bottom) / 2), inR: r.right <= innerWidth, w: r.width }; });
      t(tag + ' menu: no horizontal overflow', m.hx <= 0, m.hx);
      t(tag + ' menu: no second "Save as setup" button', !m.setupBtn);
      t(tag + ' menu: Browse row with count', /Browse templates/.test(m.browse) && /18 ready-made setups/.test(m.browse), m.browse);
      t(tag + ' menu: Whole chart | Tools only choice', m.seg.join() === 'Whole chart:true,Tools only:false', m.seg);
      t(tag + ' menu: field and Save same height + centre', Math.abs(m.inH - m.btnH) <= 1 && m.cDiff <= 1, m);
      t(tag + ' menu: inside the viewport', m.inR, m);
      if (z.w === 1440 || z.w === 390) await p.screenshot({ path: OUT + '/menu-empty-' + tag + '.png' });
      // save two templates (one of each kind)
      for (const [name, tools] of [['NQ morning', false], ['Gamma tools', true]]) {
        for (let k = 0; k < 3; k++) {   // the ⋯ menu can re-home (onebar refit) between steps: retry until the row is listed
          await openMenu(p);
          await p.fill('#stkc-tpl-pop .stkc-saverow .stkc-in', name);
          if (tools) await p.click('#stkc-tpl-pop .stkc-tseg [data-m="tools"]');
          await p.click('#stkc-tpl-pop .stkc-saverow .stkc-sbtn'); await sleep(1200);
          if (await p.evaluate((n) => (localStorage.getItem('stryker_chart_templates_guest') || '').includes('"' + n + '"'), name)) break;
        }
      }
      const saved = await p.evaluate(() => { const a = JSON.parse(localStorage.getItem('stryker_chart_templates_guest') || '[]'); return a.map((x) => [x.name, /"setup":true/.test(typeof x.state === 'string' ? x.state.slice(0, 400) : JSON.stringify(x.state).slice(0, 400)) || (x.state && x.state.setup) || false]); });
      t(tag + ' menu: Whole chart saves a full template, Tools only saves a setup', saved.length === 2 && saved.some((x) => x[0] === 'NQ morning' && !x[1]) && saved.some((x) => x[0] === 'Gamma tools' && x[1]), saved);
      await openMenu(p);
      const r2 = await p.evaluate(() => { const pop = document.getElementById('stkc-tpl-pop'); const rows = [...pop.querySelectorAll('.stkc-trow')]; const ib = rows[0].querySelector('.stkc-tacts .stkc-ib:not(.on)');
        return { hx: pop.scrollWidth - pop.clientWidth, n: rows.length, lead: rows.map((r) => r.querySelector('.stkc-tlead') ? (r.querySelector('.stkc-tlead svg') ? 'icon' : r.querySelector('.stkc-tlead').textContent) : '-'), icOp: getComputedStyle(ib).opacity, head: [...pop.querySelectorAll('.stkc-pop-h')].map((h) => h.textContent) }; });
      t(tag + ' menu with templates: no horizontal overflow', r2.hx <= 0, r2.hx);
      t(tag + ' menu rows: initials for mine, layout icons for starters', r2.lead.join() === 'G,N,icon,icon,icon' || r2.lead.join() === 'N,G,icon,icon,icon', r2.lead);
      t(tag + ' menu rows: icons ' + (z.mobile ? 'always on (touch)' : 'hidden until hover'), z.mobile ? r2.icOp === '1' : r2.icOp === '0', r2.icOp);
      t(tag + ' menu: My templates (2/20)', r2.head.includes('My templates (2/20)'), r2.head);
      if (!z.mobile) { await p.hover('#stkc-tpl-pop .stkc-trow'); await sleep(250); t(tag + ' menu rows: icons show on hover', (await p.evaluate(() => getComputedStyle(document.querySelector('#stkc-tpl-pop .stkc-trow .stkc-tacts .stkc-ib:not(.on)')).opacity)) === '1'); }
      const ra = await rowCentres(p, '#stkc-tpl-pop .stkc-saverow, #stkc-tpl-pop .stkc-tname, #stkc-tpl-pop .stkc-trow, #stkc-tpl-pop .stkt-browse');
      t(tag + ' menu: items in each row share one centre', !ra.length, ra);
      const al = await align(p, '#stkc-tpl-pop .stkc-sbtn, #stkc-tpl-pop .stkc-tseg button, #stkc-tpl-pop .stkc-tini');
      t(tag + ' menu: text centred, no overflow, even padding', !al.length, al);
      if (z.w === 1440 || z.w === 390) await p.screenshot({ path: OUT + '/menu-mine-' + tag + '.png' });
      await p.evaluate(() => { const b = document.getElementById('stkc-tpl-btn'); if (b.getAttribute('aria-expanded') === 'true') b.click(); }); await sleep(300);

      // ---- gallery
      await openGal(p);
      t(tag + ' gallery: 18 cards', (await p.$$('.stkt-card')).length === 18);
      t(tag + ' gallery: thumbnails load (no empty boxes)', await imgsLoaded(p));
      const g = await p.evaluate(() => {
        const cards = [...document.querySelectorAll('.stkt-card')], rs = cards.map((c) => c.getBoundingClientRect());
        const rows = {}; rs.forEach((r) => { (rows[Math.round(r.top)] = rows[Math.round(r.top)] || []).push(r.height); });
        const cols = Object.values(rows)[0].length;
        const greens = cards.filter((c) => { const a = c.querySelector('.stkt-apply'); return a && getComputedStyle(c.querySelector('.stkt-acts')).opacity !== '0' && getComputedStyle(c.querySelector('.stkt-acts')).display !== 'none'; }).length;
        const blurbs = cards.map((c) => c.querySelector('.stkt-blurb')).map((b) => b.scrollHeight - b.clientHeight);
        const chips = cards.map((c) => c.querySelector('.stkt-chips')).map((x) => x.scrollWidth - x.clientWidth);
        const dlg = document.querySelector('.stkt-dlg').getBoundingClientRect();
        return { cols, eq: Object.values(rows).every((h) => Math.max(...h) - Math.min(...h) < 1), greens, blurbs: Math.max(...blurbs), chips: Math.max(...chips), hx: document.documentElement.scrollWidth - innerWidth, dlg: [dlg.top, dlg.bottom, innerHeight] };
      });
      t(tag + ' gallery: columns', g.cols === (z.w >= 1024 ? 3 : z.w >= 600 ? 2 : 1), g.cols);
      t(tag + ' gallery: equal card heights per row', g.eq);
      t(tag + ' gallery: no green Apply visible at rest', g.greens === 0, g.greens);
      t(tag + ' gallery: blurbs fit 2 lines, chips one row', g.blurbs <= 0 && g.chips <= 1, g);
      t(tag + ' gallery: no horizontal scroll', g.hx <= 0, g.hx);
      if (z.mobile) t(tag + ' gallery: full-height bottom sheet', g.dlg[1] === g.dlg[2] && g.dlg[0] < 20, g.dlg);
      const ga = await align(p, '.stkt-pill, .stkt-seg button, .stkt-chip, .stkt-tf, .stkt-sample');
      t(tag + ' gallery: pills/chips text centred, even padding, no clipping', !ga.length, ga.slice(0, 4));
      const gr = await rowCentres(p, '.stkt-tools, .stkt-ov');
      const xc = await p.evaluate(() => { const a = document.querySelector('.stkt-hd h2').getBoundingClientRect(), b = document.querySelector('.stkt-x').getBoundingClientRect(); return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2); });
      if (xc > 1.01) gr.push(['close vs title', xc]);
      t(tag + ' gallery: header rows share a centre', !gr.length || z.mobile, gr);
      await p.screenshot({ path: OUT + '/gallery-top-' + tag + '.png' });
      if (z.w === 1440 || z.w === 390) {
        await p.evaluate(() => { document.querySelector('.stkt-body').scrollTop = 900; }); await sleep(600);
        await p.screenshot({ path: OUT + '/gallery-scrolled-' + tag + '.png' });
        await p.evaluate(() => { document.querySelector('.stkt-body').scrollTop = 0; });
      }
      // focus trap
      await p.keyboard.press('Shift+Tab'); for (let i = 0; i < 40; i++) await p.keyboard.press('Tab');
      t(tag + ' gallery: focus stays in the dialog', await p.evaluate(() => !!document.activeElement.closest('.stkt-dlg')));
      // filter
      await p.click('.stkt-pill[data-f="vp"]'); await sleep(400);
      const vp = await p.$$eval('.stkt-card', (a) => a.map((x) => x.dataset.tpl));
      t(tag + ' filter Volume profile', vp.includes('vp-monthly') && vp.includes('vp-daily') && !vp.includes('trend-momentum'), vp);
      if (z.w === 1440 || z.w === 390) await p.screenshot({ path: OUT + '/gallery-filter-' + tag + '.png' });
      await p.click('.stkt-pill[data-f="all"]');
      // search
      await p.fill('.stkt-search', 'bollinger'); await sleep(300);
      t(tag + ' search by tool name', JSON.stringify(await p.$$eval('.stkt-card', (a) => a.map((x) => x.dataset.tpl))) === '["squeeze"]');
      await p.fill('.stkt-search', 'zzzz'); await sleep(200);
      t(tag + ' search: empty state', await p.isVisible('.stkt-empty'));
      await p.fill('.stkt-search', ''); await sleep(300);
      // hover actions (desktop)
      if (!z.mobile) {
        await p.hover('.stkt-card[data-tpl="gex-flow"]'); await sleep(300);
        const hv = await p.evaluate(() => { const c = document.querySelector('.stkt-card[data-tpl="gex-flow"]'); const a = c.querySelector('.stkt-acts'); const bs = [...a.children].map((x) => x.getBoundingClientRect()); return { op: getComputedStyle(a).opacity, n: document.querySelectorAll('.stkt-acts').length, vis: [...document.querySelectorAll('.stkt-acts')].filter((x) => getComputedStyle(x).opacity === '1').length, c: Math.abs((bs[0].top + bs[0].bottom) / 2 - (bs[1].top + bs[1].bottom) / 2), h: bs.map((x) => x.height) }; });
        t(tag + ' hover: Preview + Apply show on one card only', hv.op === '1' && hv.vis === 1 && hv.c <= 1 && hv.h[0] === hv.h[1], hv);
        if (z.w === 1440) await p.screenshot({ path: OUT + '/gallery-hover-' + tag + '.png' });
        await p.click('.stkt-card[data-tpl="gex-flow"] .stkt-pv'); await sleep(500);
      } else {
        await p.tap('.stkt-card[data-tpl="gex-flow"]'); await sleep(500);
      }
      const dt = await p.evaluate(() => ({ on: document.querySelector('.stkt-dlg').classList.contains('is-detail'), t: (document.querySelector('.stkt-dt-t') || {}).textContent, chips: document.querySelectorAll('.stkt-chips-all .stkt-chip').length, focus: document.activeElement.className, hx: document.documentElement.scrollWidth - innerWidth }));
      t(tag + ' card opens the detail view (full text, all tools, Apply focused)', dt.on && /GEX Levels/.test(dt.t) && dt.chips === 6 && /stkt-apply/.test(dt.focus) && dt.hx <= 0, dt);
      await p.screenshot({ path: OUT + '/gallery-detail-' + tag + '.png' });
      await p.keyboard.press('Escape'); await sleep(300);
      t(tag + ' Esc in detail goes back to the grid', await p.evaluate(() => !!document.querySelector('.stkt-grid') && !document.querySelector('.stkt-dlg.is-detail')));
      // my templates tab
      await p.click('.stkt-seg [data-tab="mine"]'); await sleep(800);
      const mine = await p.$$eval('.stkt-mrow .stkt-mn', (a) => a.map((x) => x.textContent));
      t(tag + ' My templates tab lists the saved ones', mine.length === 2, mine);
      if (z.w === 1440 || z.w === 390) await p.screenshot({ path: OUT + '/gallery-mine-' + tag + '.png' });
      await p.click('.stkt-seg [data-tab="ready"]'); await sleep(300);
      await p.keyboard.press('Escape'); await sleep(300);
      t(tag + ' Esc closes the gallery', !(await p.$('.stkt-back')));
      // apply from the gallery
      await openGal(p);
      if (z.mobile) { await p.tap('.stkt-card[data-tpl="trend-momentum"]'); await sleep(400); await p.tap('.stkt-apply-lg'); }
      else { await p.hover('.stkt-card[data-tpl="trend-momentum"]'); await sleep(200); await p.click('.stkt-card[data-tpl="trend-momentum"] .stkt-apply'); }
      await sleep(3000);
      const ap = await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0]; return { tf: c.timeframe, ind: c.chart.indicators().map((h) => h.nativeType).sort() }; });
      t(tag + ' Apply sets the template', ap.tf === '60' && JSON.stringify(ap.ind) === JSON.stringify(['macd', 'rsi', 'supertrend']) && !(await p.$('.stkt-back')), ap);
      t(tag + ' no page errors', errors.length === 0, errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
