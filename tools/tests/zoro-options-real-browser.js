// ZoroOptions page on REAL responses (integration): the page in normal mode (no ?fixture) reads /api/zo/* from
// tools/tests/zoro-dev-proxy.mjs -> the local Worker fed by the real feeder run. Firebase stubbed (richstub.js, Elite).
//   flock /tmp/stryker-chrome.lock env ZO_BASE=http://127.0.0.1:8096 node tools/tests/zoro-options-real-browser.js [shotsDir]
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.ZO_BASE || 'http://127.0.0.1:8096';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BANNED = /\blive\b|real-time|realtime|delayed|\bbehind\b|\bbought\b|\bsold\b|bullish|bearish|smart money|whale|call resistance|put support|\bHVL\b|gamma wall|market tide/i;
const api = (p, free) => fetch(BASE + '/api/zo/' + p, { headers: free ? { cookie: 'zo_free=1', authorization: 'Bearer t' } : { authorization: 'Bearer t' } }).then((r) => r.json());
const fmt = (v) => Math.round(v).toLocaleString('en-US');

async function open(b, o) {
  const ctx = await b.newContext({ viewport: { width: o.w, height: o.h || 900 }, deviceScaleFactor: o.mobile ? 2 : 1, isMobile: !!o.mobile, hasTouch: !!o.mobile });
  await ctx.addInitScript(stub);
  // richstub has firebase.apps = []: mark it initialised so gex-auth.js sends the (stub) ID token at once, as on the site
  await ctx.addInitScript(() => { try { if (window.firebase && window.firebase.apps && !window.firebase.apps.length) window.firebase.apps.push({ name: '[DEFAULT]' }); } catch (e) {} });
  await ctx.addInitScript((o) => {
    try {
      localStorage.setItem('tz_consent', JSON.stringify({ v: 1, essential: true, analytics: false, at: new Date().toISOString() }));
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      localStorage.setItem('zo_preview', '1');
      if (o.light) localStorage.setItem('stryker_theme', 'day'); else localStorage.removeItem('stryker_theme');
      localStorage.removeItem('stryker_gex_basis');
    } catch (e) {}
    if (o.free) window.__zoTestFree = true;
  }, o);
  if (o.free) await ctx.addCookies([{ name: 'zo_free', value: '1', url: BASE }]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [], zo = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  p.on('response', (r) => { if (r.url().includes('/api/zo/')) zo.push(r.status() + ' ' + r.url().split('/api/zo/')[1]); });
  await p.goto(BASE + '/zoro-options.html' + (o.q || ''), { waitUntil: 'domcontentloaded' });
  await sleep(o.wait || 4000);
  return { ctx, p, errors, zo };
}
async function shot(p, name, full) { await p.mouse.move(2, 2).catch(() => {}); await sleep(400); const f = path.join(OUT, name); await p.screenshot({ path: f, fullPage: !!full }); console.log('SHOT ' + f); }
const painted = (p, id) => p.evaluate((id) => {
  const c = document.getElementById(id); if (!c || !c.width) return 0;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 0 && (d[i] > 60 || d[i + 1] > 60)) n++;
  return n;
}, id);

(async () => {
  const SPX = await api('summary?u=SPX');
  const b = await launch();
  try {
    for (const [tag, o] of [['1440', { w: 1440, h: 1000 }], ['412', { w: 412, h: 915, mobile: true }], ['390', { w: 390, h: 844, mobile: true }], ['1440-light', { w: 1440, h: 1000, light: true }]]) {
      const { ctx, p, errors, zo } = await open(b, o);
      await shot(p, 'INT-' + tag + '.png', false);
      const tape = await p.evaluate(() => (document.querySelector('#zo-tape-track > span') || {}).textContent || '');
      check(/\d\d:\d\d–\d\d:\d\d ET/.test(tape), tag + ': tape shows the window between two updates "' + tape.slice(-24) + '"');
      const lv = await p.evaluate(() => [...document.querySelectorAll('#zo-lvls .zo-lv b')].map((e) => e.textContent));
      check(lv[0] === SPX.levels.call_ceiling.toLocaleString('en-US') && lv[1] === SPX.levels.put_floor.toLocaleString('en-US') && lv[2] === fmt(SPX.levels.flip_line) && lv[4] === SPX.levels.pin.toLocaleString('en-US'), tag + ': levels row = API ' + lv.join(' | '));
      check(lv[3] === fmt(SPX.ranges['0'][0]) + '–' + fmt(SPX.ranges['0'][1]), tag + ': Zoro Range 0DTE = API ' + lv[3]);
      const zone = await p.textContent('#zo-zone');
      check(zone === 'Gamma Zone: ' + (SPX.zone === 'swing' ? 'Swing' : 'Cushion'), tag + ': zone chip "' + zone + '"');
      check(/^Updated (just now|\d+ min ago)$/.test(await p.textContent('#zo-upd')), tag + ': updated label');
      check(!(await p.isVisible('.zo-upd [data-sample]')), tag + ': no Sample tag on real data');
      for (const id of ['zo-prof', 'zo-ivr', 'zo-term', 'zo-volk', 'zo-pc', 'zo-pinr', 'zo-ivspark']) { const n = await painted(p, id); check(n > 20, tag + ': ' + id + ' painted (' + n + ')'); }
      const c = await p.evaluate(() => ({ nodes: document.querySelectorAll('#zo-nodes tr').length, fresh: document.querySelectorAll('#zo-fresh tr').length, burst: document.querySelectorAll('#zo-burst tr').length,
        active: document.querySelectorAll('#zo-active tr').length, screen: document.querySelectorAll('#zo-screen tr').length, tape: document.querySelectorAll('#zo-tape-track > span').length, note: document.querySelectorAll('#zo-note h4').length, replay: !document.getElementById('zo-replay').hidden }));
      check(c.nodes === 10 && c.fresh > 0 && c.burst > 0 && c.active > 0 && c.screen >= 6 && c.tape > 0 && c.note >= 5, tag + ': rows from real data ' + JSON.stringify(c));
      check(c.replay, tag + ': replay shown (history has >= 2 frames)');
      await p.evaluate(() => document.getElementById('zo-gsurf').scrollIntoView({ block: 'center' }));
      await p.waitForFunction(() => document.getElementById('zo-gsurf').dataset.ready === '1' || document.getElementById('zo-gsurf').classList.contains('is-heat'), null, { timeout: 15000 }).catch(() => {});
      check(await p.evaluate(() => document.getElementById('zo-gsurf').dataset.ready === '1' || document.getElementById('zo-gsurf').classList.contains('is-heat')), tag + ': gamma surface drawn');
      await p.evaluate(() => document.getElementById('zo-isurf').scrollIntoView({ block: 'center' }));
      await p.waitForFunction(() => document.getElementById('zo-isurf').dataset.ready === '1' || document.getElementById('zo-isurf').classList.contains('is-heat'), null, { timeout: 15000 }).catch(() => {});
      check(await p.evaluate(() => document.getElementById('zo-isurf').dataset.ready === '1' || document.getElementById('zo-isurf').classList.contains('is-heat')), tag + ': IV surface drawn');
      await p.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
      const text = await p.evaluate(() => document.querySelector('.zo').innerText);
      const bad = text.match(BANNED);
      check(!bad, tag + ': no banned words' + (bad ? ' ("' + bad[0] + '")' : ''));
      check(/Education only\. Not financial advice\./.test(text), tag + ': education line');
      const ow = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      check(ow.sw <= ow.cw + 1, tag + ': no horizontal overflow');
      check(zo.every((z) => /^200 /.test(z)), tag + ': every /api/zo call 200 ' + zo.filter((z) => !/^200 /.test(z)).join(', '));
      check(!errors.length, tag + ': no page errors ' + errors.slice(0, 3).join(' / '));
      await p.setViewportSize({ width: o.w + 1, height: o.h }); await sleep(800);   // a resize repaints every panel with no animation
      const nan = await p.evaluate(() => /NaN|undefined/.test(document.querySelector('.zo').innerText));
      check(!nan, tag + ': no NaN / undefined after a repaint');
      for (const id of ['zo-ivr', 'zo-pc']) { const n = await painted(p, id); check(n > 20, tag + ': ' + id + ' painted after a repaint (' + n + ')'); }
      await p.setViewportSize({ width: o.w, height: o.h }); await sleep(800);
      if (tag === '1440' || tag === '390') await shot(p, 'INT-' + tag + '-full.png', true);
      await ctx.close();
    }
    {
      // symbol switches on real data: IWM (tier A, new) and ES (mapped from SPX + real CME panel)
      const { ctx, p, errors } = await open(b, { w: 1440, h: 1000 });
      const IWM = await api('summary?u=IWM');
      await p.click('#zo-syms [data-u="IWM"]').catch(() => {}); await sleep(2500);
      const c1 = await p.evaluate(() => (document.querySelector('#zo-lvls .zo-lv b') || {}).textContent);
      check(c1 === IWM.levels.call_ceiling.toLocaleString('en-US'), 'IWM: ceiling ' + c1);
      await p.click('#zo-syms [data-u="ES"]').catch(() => {}); await sleep(2500);
      const es = await p.evaluate(() => ({ small: document.getElementById('zo-lvls').innerText, cme: document.querySelectorAll('#zo-cme tr').length, c: (document.querySelector('#zo-lvls .zo-lv b') || {}).textContent }));
      check(/mapped from SPX/.test(es.small) && es.cme >= 2 && es.c === Math.round(SPX.fut.call_ceiling).toLocaleString('en-US'), 'ES: mapped from SPX (' + es.c + ') + real CME panel rows ' + es.cme);
      check(!errors.length, 'symbol switch: no page errors ' + errors.slice(0, 3).join(' / '));
      await shot(p, 'INT-1440-ES.png', false);
      await ctx.close();
    }
    for (const [tag, o] of [['1440-free', { w: 1440, h: 1000, free: true }], ['390-free', { w: 390, h: 844, mobile: true, free: true }]]) {
      const { ctx, p, errors, zo } = await open(b, o);
      const r = await p.evaluate(() => ({ locks: document.querySelectorAll('[data-pro] .zo-lock').length, pro: document.querySelectorAll('[data-pro]').length, teaser: [...document.querySelectorAll('[data-teaser]')].filter((e) => e.querySelector('.zo-lock')).length,
        notes: document.querySelectorAll('#zo-note p:not(.zo-foot)').length, ranges: document.querySelectorAll('#zo-ranges .zo-rg, #zo-ranges > *').length, lv: [...document.querySelectorAll('#zo-lvls .zo-lv b')].map((e) => e.textContent) }));
      check(r.locks === r.pro && r.teaser === 0, tag + ': Pro panels locked, teasers open ' + JSON.stringify({ locks: r.locks, pro: r.pro, teaser: r.teaser }));
      check(r.notes === 3, tag + ': note teaser 3 real lines (' + r.notes + ')');
      check(r.lv[0] === SPX.levels.call_ceiling.toLocaleString('en-US'), tag + ': teaser levels from the real teaser slice ' + r.lv.join(' | '));
      for (const id of ['zo-prof', 'zo-ivspark', 'zo-volk', 'zo-pc']) { const n = await painted(p, id); check(n > 20, tag + ': teaser ' + id + ' painted (' + n + ')'); }
      check(zo.every((z) => /^(200|403) /.test(z)) && zo.some((z) => /^200 summary\?u=SPX/.test(z)), tag + ': Free reads SPX teaser 200, Pro routes 403 only');
      check(!errors.length, tag + ': no page errors ' + errors.slice(0, 3).join(' / '));
      await shot(p, 'INT-' + tag + '.png', false);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
