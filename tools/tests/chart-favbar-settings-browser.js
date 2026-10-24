// Chart settings → Canvas → Toolbars → "Favorites toolbar" switch (assets/chart-settings.js +
// assets/chart-fav-toolbar.js), tested like a real member: SIGNED IN (firebase.apps non-empty, so the
// toolbar syncs students/{uid}/chartPrefs/favToolbar), an admin (admins/{uid} exists, so the admin rows
// show too), with a STATEFUL fake cloud doc that survives reloads. Every switch / Ok / Cancel press is
// REAL input (Playwright mouse = CDP Input.dispatchMouseEvent at the element's box; touchscreen tap at
// 390), never el.click() or setVisible(): build 634 passed an el.click() test while the real click
// flipped straight back. Both engines (0.9 default, ?vela=0.6), 1440 + 390, with a starred tool and none.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-favbar-settings-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 260))); };
const shot = async (p, n) => { await p.screenshot({ path: OUT + '/' + n + '.png' }); console.log('shot', OUT + '/' + n + '.png'); };

// Signed in + admin + stateful cloud doc (kept in localStorage key __cloudFav so a reload reads it back).
function signedIn(seed) {
  try {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.removeItem('stryker_chart_favbar');
      localStorage.setItem('__cloudFav', JSON.stringify(seed));
    }
  } catch (e) {}
  const fb = window.firebase; if (!fb) return;
  const origInit = fb.initializeApp;
  fb.initializeApp = function () { const a = origInit.apply(this, arguments) || {}; if (!fb.apps.length) fb.apps.push(a); return a; };
  const base = window.__stubDb;
  const cloudDoc = () => ({
    get: () => Promise.resolve((() => { const d = JSON.parse(localStorage.getItem('__cloudFav') || 'null'); return { exists: !!d, data: () => d || {} }; })()),
    set: (d) => { const c = Object.assign({}, d); delete c.updatedAt; localStorage.setItem('__cloudFav', JSON.stringify(c)); window.__cloudWrites = (window.__cloudWrites || 0) + 1; return Promise.resolve(); }
  });
  const db = Object.assign({}, base, {
    collection: (name) => {
      const col = base.collection(name);
      if (name === 'admins') return Object.assign({}, col, { doc: (id) => Object.assign({}, col.doc(id), { get: () => Promise.resolve({ id, exists: true, data: () => ({}) }) }) });
      if (name !== 'students') return col;
      return Object.assign({}, col, { doc: (id) => { const d = col.doc(id); return Object.assign({}, d, { collection: (sub) => sub === 'chartPrefs' ? { doc: (k) => (k === 'favToolbar' ? cloudDoc() : d.collection(sub).doc(k)) } : d.collection(sub) }); } });
    }
  });
  window.__stubDb = db; window.db = db;
  fb.firestore = Object.assign(() => db, fb.firestore);
}

async function ready(p) {
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_FAVBAR && document.querySelector('.vela-dtb') && document.getElementById('stkc-settings-btn'), null, { timeout: 45000 });
  await p.waitForTimeout(2500);   // auth callback + cloud doc load + admin check
}
// Real press at an element's centre: mouse (CDP Input.dispatchMouseEvent) or a touch tap on the phone.
async function press(p, mobile, sel, fn) {
  // A toast (e.g. the "Star a drawing tool" hint) can sit over the target for a few seconds:
  // wait until the target is actually on top at its centre, as a person would.
  for (let i = 0; i < 40; i++) {
    const hit = await p.evaluate(([sel, fn]) => { const el = fn ? (0, eval)('(' + fn + ')')() : document.querySelector(sel); if (!el) return false; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === el || el.contains(t)); }, [sel, fn ? fn.toString() : null]);
    if (hit) break;
    await p.waitForTimeout(250);
  }
  const box = await p.evaluate(([sel, fn]) => {
    const el = fn ? (0, eval)('(' + fn + ')')() : document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, hit: !!top && (top === el || el.contains(top)) };
  }, [sel, fn ? fn.toString() : null]);
  if (!box || !box.w) return { ok: false, box };
  await p.waitForTimeout(80);
  if (mobile) await p.touchscreen.tap(box.x, box.y); else await p.mouse.click(box.x, box.y);
  await p.waitForTimeout(350);
  return { ok: box.hit, box };
}
const SWITCH = () => { const lab = [...document.querySelectorAll('.vela-dialog--settings .vela-field-label')].find((l) => l.textContent === 'Favorites toolbar'); return lab && lab.closest('.vela-field-span').querySelector('.vela-switch'); };
const CANCEL = () => [...document.querySelectorAll('.vela-dialog--settings .vela-sd-btn')].find((x) => x.textContent === 'Cancel');
const OK = () => [...document.querySelectorAll('.vela-dialog--settings .vela-sd-btn')].find((x) => x.textContent === 'Ok');
const CANVAS = () => [...document.querySelectorAll('.vela-dialog--settings .vela-sd-tab')].find((x) => x.textContent === 'Canvas');
async function openSettings(p, mobile) {
  // Phone / narrow bar: the gear sits in the "⋯ More" menu; tap More first, as a member does.
  const gearShown = await p.evaluate(() => document.getElementById('stkc-settings-btn').getBoundingClientRect().width > 0);
  if (!gearShown) await press(p, mobile, '#stkc-more-btn');
  const g = await press(p, mobile, '#stkc-settings-btn');
  await p.waitForSelector('.vela-dialog--settings .stk-sd-extra', { timeout: 8000, state: 'attached' });
  await p.waitForTimeout(300);
  // Canvas tab, pressed for real. On the phone the tab rail opens from the dialog's burger first.
  const tabOnScreen = () => p.evaluate(() => { const t = [...document.querySelectorAll('.vela-dialog--settings .vela-sd-tab')].find((x) => x.textContent === 'Canvas'); if (!t) return false; const r = t.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth; });
  if (!(await tabOnScreen()) && await p.$('.vela-dialog--settings .vela-sd-burger')) { await press(p, mobile, '.vela-dialog--settings .vela-sd-burger'); await p.waitForTimeout(300); }
  await press(p, mobile, null, CANVAS);
  await p.waitForTimeout(300);
  const title = await p.evaluate(() => { const on = document.querySelector('.vela-dialog--settings .vela-sd-tab.on, .vela-dialog--settings .vela-sd-tab[aria-selected="true"]'); return on && on.textContent; });
  if (title !== 'Canvas') console.log('note: active tab after press =', title);
  await p.waitForTimeout(250);
  return g.ok;
}
const sw = (p) => p.evaluate((f) => { const s = (0, eval)('(' + f + ')')(); return s ? s.getAttribute('aria-checked') : null; }, SWITCH.toString());
const state = (p) => p.evaluate(() => ({ hidden: document.querySelector('.stk-fb').hidden, vis: window.STRYKER_FAVBAR.state.visible, tools: window.STRYKER_FAVBAR.state.tools.length,
  cloud: JSON.parse(localStorage.getItem('__cloudFav') || 'null'), ls: JSON.parse(localStorage.getItem('stryker_chart_favbar') || 'null'),
  tog: document.querySelector('.stk-fb-tog') && document.querySelector('.stk-fb-tog').getAttribute('aria-label'), admin: window.__stkIsAdmin === true, dlg: !!document.querySelector('.vela-dialog--settings') }));
const hintShown = (p) => p.evaluate(() => [...document.querySelectorAll('body *')].some((x) => x.children.length === 0 && /Star a drawing tool/.test(x.textContent) && x.getBoundingClientRect().height > 0));

(async () => {
  const b = await launch();
  try {
    for (const eng of ['0.9', '0.6'].filter((e) => !process.env.ONLY_ENG || e === process.env.ONLY_ENG)) {
      for (const vp of [{ w: 1440, h: 900 }, { w: 390, h: 844, mobile: true }].filter((v) => !process.env.ONLY_W || String(v.w) === process.env.ONLY_W)) {
        for (const starred of [true, false]) {
          const M = !!vp.mobile;
          const tag = eng + ' ' + vp.w + (starred ? ' starred' : ' none-starred');
          const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: M ? 3 : 1, isMobile: M, hasTouch: M });
          await ctx.addInitScript(stub);
          await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
          await ctx.addInitScript(signedIn, { tools: starred ? ['trendline', 'hline'] : [], visible: true });
          await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
          const p = await ctx.newPage();
          p.errors = [];
          p.on('pageerror', (e) => p.errors.push(String(e)));
          await p.goto(BASE + '/charts.html' + (eng === '0.6' ? '?vela=0.6' : ''), { waitUntil: 'domcontentloaded' });
          await ready(p);
          check(await p.evaluate(() => window.__stkVela090 === true) === (eng === '0.9'), tag + ': engine');
          const s0 = await state(p);
          check(s0.vis && s0.tools === (starred ? 2 : 0) && s0.hidden === !starred && s0.admin, tag + ': signed-in admin, cloud doc loaded', s0);
          // 1. real click on the switch: off
          check(await openSettings(p, M), tag + ': gear opens settings (real press)');
          check(await sw(p) === 'true', tag + ': switch starts on');
          if (starred) await shot(p, 'fs-' + eng + '-' + vp.w + '-on');
          const c1 = await press(p, M, null, SWITCH);
          await p.waitForTimeout(800);   // cloud save is debounced 600 ms
          const s1 = await state(p);
          check(c1.ok && await sw(p) === 'false' && !s1.vis && s1.hidden && s1.cloud.visible === false && s1.ls.visible === false, tag + ': REAL click -> switch off, toolbar hidden, cloud + local saved', { c1, s1 });
          check(s1.tog === 'Show favorites toolbar', tag + ': star button follows', s1.tog);
          if (starred) await shot(p, 'fs-' + eng + '-' + vp.w + '-off');
          // 2. real click again: on
          await press(p, M, null, SWITCH); await p.waitForTimeout(800);
          const s2 = await state(p);
          check(await sw(p) === 'true' && s2.vis && s2.hidden === !starred && s2.cloud.visible === true, tag + ': REAL click again -> on', s2);
          if (!starred) { check(await hintShown(p), tag + ': nothing starred -> "Star a drawing tool" hint'); if (M) await shot(p, 'fs-' + eng + '-390-empty-hint'); }
          // 3. changed from the toolbar side (right-click menu / star button call this) while the dialog is open
          await p.evaluate(() => window.STRYKER_FAVBAR.setVisible(false)); await p.waitForTimeout(200);
          check(await sw(p) === 'false', tag + ': hidden elsewhere while dialog open -> switch shows off');
          await p.evaluate(() => window.STRYKER_FAVBAR.setVisible(true)); await p.waitForTimeout(200);
          check(await sw(p) === 'true', tag + ': shown elsewhere while dialog open -> switch shows on');
          // 4. off + Cancel -> back on
          await press(p, M, null, SWITCH);
          await press(p, M, null, CANCEL);
          const s4 = await state(p);
          check(!s4.dlg && s4.vis && s4.hidden === !starred, tag + ': off + Cancel restores on', s4);
          // 5. off + Ok -> stays off
          await openSettings(p, M);
          await press(p, M, null, SWITCH);
          await press(p, M, null, OK);
          await p.waitForTimeout(800);
          const s5 = await state(p);
          check(!s5.dlg && !s5.vis && s5.hidden && s5.cloud.visible === false, tag + ': off + Ok keeps it off', s5);
          // 6. reload -> still off (from the cloud doc), switch off; real click turns it on
          await p.reload({ waitUntil: 'domcontentloaded' }); await ready(p);
          const s6 = await state(p);
          check(!s6.vis && s6.hidden, tag + ': reload keeps it hidden', s6);
          await openSettings(p, M);
          check(await sw(p) === 'false', tag + ': switch shows off after reload');
          await press(p, M, null, SWITCH); await p.waitForTimeout(800);
          const s7 = await state(p);
          check(await sw(p) === 'true' && s7.vis && s7.hidden === !starred, tag + ': REAL click after reload -> on', s7);
          await press(p, M, null, OK);
          if (starred && !M) {
            // 7. real right-click on the bar -> Hide -> open settings -> switch off; real star-button click shows it
            const h = await p.evaluate(() => { const r = document.querySelector('.stk-fb-h').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
            await p.mouse.click(h.x, h.y, { button: 'right' }); await p.waitForTimeout(200);
            await press(p, M, null, () => [...document.querySelectorAll('.stk-fb-menu button')].find((x) => x.textContent === 'Hide favorites toolbar'));
            check((await state(p)).hidden, tag + ': real right-click Hide hides it');
            await openSettings(p, M);
            check(await sw(p) === 'false', tag + ': settings switch shows off after right-click hide');
            await press(p, M, null, OK);
            await press(p, M, '.stk-fb-tog');
            check(!(await state(p)).hidden, tag + ': real click on the star button shows it again');
          }
          check(p.errors.length === 0, tag + ': no page errors', p.errors);
          await ctx.close();
        }
      }
    }
  } catch (e) { fail++; console.log('FAIL exception', e && e.stack); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
