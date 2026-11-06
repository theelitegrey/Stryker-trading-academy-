// ZoroOptions alert UI in the Alerts panel (assets/chart-alerts.js): create each of the 8 types against an in-memory
// fake Firestore, validate, list, pause, delete, no overflow at 390/412, guest gets no form.
//   node tools/tests/chart-dev-server.mjs 8043 &  node tools/tests/zoro-alerts-browser.js http://127.0.0.1:8043 <outdir>
const { launch } = require('./lib.js');
const BASE = process.argv[2] || 'http://127.0.0.1:8043';
const OUT = (process.argv[3] || '/tmp') + '/';
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 300)); };
const STUB = () => {
  const store = {}; let n = 0;
  const col = { get: async () => ({ docs: Object.entries(store).map(([id, d]) => ({ id, data: () => d })) }),
    doc: (id) => { id = id || ('z' + (++n)); return { set: async (d) => { store[id] = d; }, update: async (d) => { if (!store[id]) throw new Error('nf'); Object.assign(store[id], d); }, delete: async () => { delete store[id]; } }; } };
  const fs = () => ({ collection: () => ({ doc: () => ({ collection: () => col }) }) });
  fs.FieldValue = { serverTimestamp: () => 'TS' };
  window.__zstore = store;
  window.firebase = { auth: () => ({ currentUser: { uid: 'u1' } }), firestore: fs };
};
(async () => {
  const b = await launch();
  try {
    for (const [w, h, th, signed] of [[1440, 900, 'dark', true], [390, 844, 'dark', true], [412, 892, 'dark', true], [1440, 900, 'day', true], [390, 844, 'dark', false]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
      await ctx.addInitScript(([th]) => { try { localStorage.setItem('stryker_install_prompt_dismissed', '1'); if (th === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, [th]);
      const p = await ctx.newPage(); const errs = [];
      p.on('pageerror', (e) => { if (!/firestore|CORS/i.test(e.message)) errs.push(e.message); });
      await p.goto(BASE + '/charts.html', { waitUntil: 'load' });
      await p.waitForFunction(() => window.__stkAlerts, null, { timeout: 40000 });
      const tag = w + '-' + th + (signed ? '' : '-guest');
      if (signed) await p.evaluate(STUB);
      await p.evaluate(() => window.__stkAlerts.open());
      await p.waitForSelector('.stk-al-znew');
      await p.click('.stk-al-znew');
      if (!signed) {
        t(tag + ' guest: no options form', (await p.$eval('.stk-al-zform', (f) => f.hidden)) === true);
        await ctx.close(); continue;
      }
      const vis = async () => p.$$eval('.stk-al-zform [data-z]', (ls) => ls.filter((l) => !l.hidden).map((l) => l.dataset.z).join(','));
      t(tag + ' level touch fields', (await vis()) === 'sym,level,range', await vis());
      await p.screenshot({ path: `${OUT}S5-alerts-form-${tag}.png` });
      const cases = [
        ['level_touch', { zs: 'ES', zl: 'range_high', zr: 'w' }, 'sym,level,range', 'ES crosses its Zoro Range high (weekly)'],
        ['zone_change', { zs: 'spx' }, 'sym', 'SPX Gamma Zone changes'],
        ['level_moved', { zs: 'SPX', zl: 'call_ceiling' }, 'sym,level', 'SPX Call Ceiling moves'],
        ['fresh_volume', { zs: 'AAPL', zn: '500' }, 'sym,size', 'AAPL Fresh Volume, 500+ contracts'],
        ['volume_burst', { zs: 'NVDA', zn: '800' }, 'sym,size', 'NVDA Volume Burst, 800+ contracts'],
        ['iv_rank', { zs: 'QQQ', zd: 'below', zv: '20' }, 'sym,dir,value', 'QQQ IV rank moves below 20'],
        ['pc_extreme', { zs: 'SPY', zd: 'above', zv: '1.5', zf: 'every' }, 'sym,dir,value', 'SPY put/call moves above 1.5'],
        ['note_ready', {}, '', 'Zoro Morning Note is ready']
      ];
      for (const [type, vals, fields, text] of cases) {
        if (await p.$eval('.stk-al-zform', (f) => f.hidden)) await p.click('.stk-al-znew');
        await p.selectOption('.stk-al-zform [name=zt]', type);
        t(tag + ' ' + type + ' fields', (await vis()) === fields, await vis());
        for (const [k, v] of Object.entries(vals)) {
          if (['zl', 'zr', 'zd', 'zf'].includes(k)) await p.selectOption(`.stk-al-zform [name=${k}]`, v); else await p.fill(`.stk-al-zform [name=${k}]`, v);
        }
        await p.click('.stk-al-zform .stk-al-save');
        await p.waitForFunction((x) => [...document.querySelectorAll('.stk-al-row b')].some((e) => e.textContent === x), text, { timeout: 4000 }).catch(() => {});
        t(tag + ' ' + type + ' listed', (await p.$$eval('.stk-al-row b', (a) => a.map((x) => x.textContent))).includes(text));
      }
      const docs = await p.evaluate(() => Object.values(window.__zstore));
      t(tag + ' 8 docs, shape ok', docs.length === 8 && docs.every((d) => d.active === true && d.updatedAt && d.createdAt && ['once', 'every'].includes(d.freq) && typeof d.p === 'object') && docs.some((d) => d.symbol === 'SPX' && d.type === 'zone_change'), docs.length);
      await p.click('.stk-al-znew'); await p.selectOption('.stk-al-zform [name=zt]', 'iv_rank'); await p.fill('.stk-al-zform [name=zs]', 'SPX'); await p.fill('.stk-al-zform [name=zv]', '120');
      await p.click('.stk-al-zform .stk-al-save');
      t(tag + ' iv rank 120 refused', (await p.evaluate(() => Object.keys(window.__zstore).length)) === 8);
      await p.click('.stk-al-zform .stk-al-zcancel');
      await p.locator('.stk-al-row', { hasText: 'SPX Gamma Zone changes' }).locator('[data-k=pause]').click();
      await p.waitForFunction(() => Object.values(window.__zstore).some((d) => d.type === 'zone_change' && d.active === false));
      t(tag + ' pause writes active=false', true);
      await p.locator('.stk-al-row', { hasText: 'AAPL Fresh Volume' }).locator('[data-k=del]').click();
      await p.waitForFunction(() => Object.keys(window.__zstore).length === 7);
      t(tag + ' delete removes the doc', true);
      t(tag + ' counter text', /7 of 25 options alerts/.test(await p.textContent('.stk-al-count')), await p.textContent('.stk-al-count'));
      await p.screenshot({ path: `${OUT}S5-alerts-list-${tag}.png` });
      const ov = await p.evaluate(() => { const bx = document.querySelector('.stk-al-box'); return bx.scrollWidth - bx.clientWidth; });
      t(tag + ' no horizontal overflow', ov <= 1, ov);
      await p.click('.stk-al-znew');
      const small = await p.evaluate(() => [...document.querySelectorAll('.stk-al-zform label, .stk-al-zform input, .stk-al-zform select, .stk-al-znote')].filter((e) => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 12).length);
      t(tag + ' no text under 12px', small === 0, small);
      t(tag + ' no page errors', errs.length === 0, errs.slice(0, 2));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
