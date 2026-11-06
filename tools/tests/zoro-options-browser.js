// ZoroOptions page browser test + screenshots (stream 3).
//   python3 -m http.server 8095 --bind 127.0.0.1   (repo root)
//   flock /tmp/stryker-chrome.lock env ZO_BASE=http://127.0.0.1:8095 node tools/tests/zoro-options-browser.js [shotsDir]
// The page runs in ?fixture=1 mode (tools/tests/fixtures/zoro/*.json, made by zoro-fixture-gen.py): every number
// on screen is known. Firebase is stubbed (richstub.js, an Elite member); the Free case sets window.__zoTestFree.
// Checks: flag off -> "coming soon"; panels painted; levels row matches the fixture; replay moves levels and the clock;
// reduced motion; symbol switch; Free locks; no banned words; no horizontal overflow; three.js from /assets/vendor only.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.ZO_BASE || 'http://127.0.0.1:8095';
const OUT = process.argv[2] || '/tmp';
const ONLY = process.env.ZO_ONLY || '';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FX = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'zoro', n + '.json')));
const SUM = FX('summary-SPX');
const BANNED = /\blive\b|real-time|realtime|delayed|\bbehind\b|\bbought\b|\bsold\b|bullish|bearish|smart money|whale|call resistance|put support|\bHVL\b|gamma wall|market tide|\$\s?\d+\s*\/\s*(mo|month)/i;

async function open(b, o) {
  const ctx = await b.newContext({ viewport: { width: o.w, height: o.h || 900 }, deviceScaleFactor: o.mobile ? 2 : 1, isMobile: !!o.mobile, hasTouch: !!o.mobile, reducedMotion: o.reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((o) => {
    try {
      localStorage.setItem('tz_consent', JSON.stringify({ v: 1, essential: true, analytics: false, at: new Date().toISOString() }));
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      if (o.flag !== false) localStorage.setItem('zo_preview', '1'); else localStorage.removeItem('zo_preview');
      if (o.light) localStorage.setItem('stryker_theme', 'day'); else localStorage.removeItem('stryker_theme');
      localStorage.removeItem('stryker_gex_basis');
    } catch (e) {}
    if (o.free) window.__zoTestFree = true;
  }, o);
  const ext = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { ext.push(r.request().url()); r.abort(); });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + '/zoro-options.html?fixture=' + (o.s1 ? 's1' : '1') + (o.shot ? '&shot' : ''), { waitUntil: 'domcontentloaded' });
  await sleep(o.wait || 3000);
  return { ctx, p, errors, ext };
}
async function shot(p, name, full) { await p.mouse.move(2, 2).catch(() => {}); await sleep(400); const f = path.join(OUT, name); await p.screenshot({ path: f, fullPage: !!full }); console.log('SHOT ' + f); }
const painted = (p, id) => p.evaluate((id) => {
  const c = document.getElementById(id); if (!c || !c.width) return 0;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 0 && (d[i] > 60 || d[i + 1] > 60)) n++;
  return n;
}, id);
const overflow = (p) => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));

async function pro(b, tag, o) {
  const { ctx, p, errors, ext } = await open(b, Object.assign({ shot: true }, o));
  const lv = await p.evaluate(() => [...document.querySelectorAll('#zo-lvls .zo-lv')].map((e) => e.querySelector('span').textContent + '=' + e.querySelector('b').textContent));
  check(lv.join('|') === ['Call Ceiling=' + SUM.levels.ceiling.toLocaleString('en-US'), 'Put Floor=' + SUM.levels.floor.toLocaleString('en-US'), 'Flip Line=' + Math.round(SUM.levels.flip).toLocaleString('en-US'),
    'Zoro Range 0DTE=' + Math.round(SUM.range['0'].lo).toLocaleString('en-US') + '–' + Math.round(SUM.range['0'].hi).toLocaleString('en-US'), 'Pin Strike=' + SUM.levels.pin.toLocaleString('en-US')].join('|'), tag + ': levels row ' + lv.join(' | '));
  const zone = await p.textContent('#zo-zone');
  check(zone === 'Gamma Zone: Cushion', tag + ': zone chip "' + zone + '"');
  const upd = await p.textContent('#zo-upd');
  check(/^Updated (just now|\d+ min ago)$/.test(upd), tag + ': updated label "' + upd + '"');
  check(await p.isVisible('.zo-upd [data-sample]'), tag + ': Sample tag shown on fixture data');
  for (const id of ['zo-prof', 'zo-ivr', 'zo-skew', 'zo-term', 'zo-ivrv', 'zo-volk', 'zo-pc', 'zo-oi', 'zo-pinr', 'zo-ivspark', 'zo-pcspark']) {
    const n = await painted(p, id); check(n > 20, tag + ': ' + id + ' painted (' + n + ')');
  }
  const counts = await p.evaluate(() => ({ nodes: document.querySelectorAll('#zo-nodes tr').length, fresh: document.querySelectorAll('#zo-fresh tr').length, burst: document.querySelectorAll('#zo-burst tr').length,
    active: document.querySelectorAll('#zo-active tr').length, screen: document.querySelectorAll('#zo-screen tr').length, tape: document.querySelectorAll('#zo-tape-track > span').length, note: document.querySelectorAll('#zo-note h4').length }));
  check(counts.nodes === 10 && counts.fresh === 24 && counts.burst === 24 && counts.active === 20 && counts.screen === 110 && counts.tape === 32 && counts.note === 4, tag + ': rows ' + JSON.stringify(counts));
  // 3D surface: scroll it into view, wait for WebGL
  await p.evaluate(() => document.getElementById('zo-gsurf').scrollIntoView({ block: 'center' }));
  await p.waitForFunction(() => document.getElementById('zo-gsurf').dataset.ready === '1' || document.getElementById('zo-gsurf').classList.contains('is-heat'), null, { timeout: 15000 }).catch(() => {});
  const gl = await p.evaluate(() => ({ ready: document.getElementById('zo-gsurf').dataset.ready, heat: document.getElementById('zo-gsurf').classList.contains('is-heat') }));
  check(gl.ready === '1' || gl.heat, tag + ': gamma surface drawn (' + JSON.stringify(gl) + ')');
  const three = await p.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /three/.test(n)));
  check(three.every((n) => n.startsWith(BASE + '/assets/vendor/three-0.180.0/')), tag + ': three.js only from /assets/vendor (' + three.length + ' files)');
  check(!ext.some((u) => /three|jsdelivr|unpkg/.test(u)), tag + ': no CDN request for three.js');
  // replay: scrub to the open, levels and clock follow
  await p.evaluate(() => window.strykerZoro.scrubTo(0));
  const r0 = await p.evaluate(() => ({ clock: document.getElementById('zo-clock').textContent, ceil: document.querySelector('#zo-lvls .zo-lv.c b').textContent }));
  check(r0.clock === '09:30 ET', tag + ': scrub to 0 -> clock ' + r0.clock + ', ceiling ' + r0.ceil);
  await p.evaluate(() => window.strykerZoro.scrubTo(195));
  const r1 = await p.evaluate(() => ({ clock: document.getElementById('zo-clock').textContent, ceil: document.querySelector('#zo-lvls .zo-lv.c b').textContent }));
  check(r1.clock === '16:00 ET' && r1.ceil === SUM.levels.ceiling.toLocaleString('en-US'), tag + ': scrub to end -> ' + r1.clock + ', ceiling back to ' + r1.ceil);
  const text = await p.evaluate(() => document.querySelector('.zo').innerText);
  const bad = text.match(BANNED);
  check(!bad, tag + ': no banned words' + (bad ? ' (found "' + bad[0] + '")' : ''));
  check(/Education only\. Not financial advice\./.test(text), tag + ': education line present');
  check(!/\$\d/.test(text.replace(/\$\d[\d.]*[KMB]?/g, (m) => /[KMB]$/.test(m) ? '' : m)), tag + ': no plain $ prices (premium uses $K/$M only)');
  const ow = await overflow(p);
  check(ow.sw <= ow.cw + 1, tag + ': no horizontal overflow (' + ow.sw + ' <= ' + ow.cw + ')');
  const small = await p.evaluate(() => [...document.querySelectorAll('.zo *')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 11).map((e) => e.className || e.tagName).slice(0, 5));
  check(!small.length, tag + ': no text under 11px ' + small.join(','));
  if (o.mobile) {
    const taps = await p.evaluate(() => [...document.querySelectorAll('.zo button, .zo input[type=range], .zo select')].filter((e) => e.offsetParent && !e.closest('.zo-syms')).map((e) => { const r = e.getBoundingClientRect(); return { h: r.height, n: (e.id || e.textContent.trim()).slice(0, 16) }; }).filter((x) => x.h < 36));
    check(!taps.length, tag + ': tap targets >= 36px high ' + JSON.stringify(taps.slice(0, 6)));
  }
  check(!errors.length, tag + ': no page errors ' + errors.slice(0, 3).join(' / '));
  await p.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
  await shot(p, 'S3-' + tag + '.png', false);
  await shot(p, 'S3-' + tag + '-full.png', true);
  return { ctx, p };
}

(async () => {
  const b = await launch();
  try {
    if (!ONLY || ONLY === 'flag') {
      const { ctx, p } = await open(b, { w: 1440, flag: false, wait: 2000 });
      const r = await p.evaluate(() => ({ soon: !document.getElementById('zo-soon').hidden, app: !document.getElementById('zo-app').hidden, menu: !!document.querySelector('[data-menu="zoro-options"]') }));
      check(!r.soon && r.app && r.menu, 'launched: page open and menu item present without any preview flag ' + JSON.stringify(r));
      await ctx.close();
      const t = await open(b, { w: 1440, wait: 2000 });
      check(await t.p.evaluate(() => !!document.querySelector('[data-menu="zoro-options"]')), 'flag on (zo_preview): menu item present');
      await t.ctx.close();
    }
    for (const [tag, o] of [['1440', { w: 1440, h: 1000 }], ['1440-light', { w: 1440, h: 1000, light: true }], ['412', { w: 412, h: 915, mobile: true }], ['390', { w: 390, h: 844, mobile: true }]]) {
      if (ONLY && ONLY !== tag) continue;
      const { ctx } = await pro(b, tag, o); await ctx.close();
    }
    if (!ONLY || ONLY === 'motion') {
      // replay plays at 1 s = 10 min, and moves on its own once started; the symbol switch reloads the levels
      const { ctx, p } = await open(b, { w: 1440 });
      await p.evaluate(() => window.strykerZoro.scrubTo(0));
      await p.click('#zo-play'); await sleep(1500);
      const t = await p.evaluate(() => window.strykerZoro.state.t);
      check(t > 5 && t < 15, 'replay plays ~5 frames a second (t=' + (t || 0).toFixed(1) + ' after 1.5 s)');
      const fps = await p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); })(); }));
      check(fps >= 30, 'frame rate while replaying: ' + fps + ' fps (headless, software GL)');
      await p.click('#zo-play');
      await p.click('#zo-syms [data-u="QQQ"]'); await sleep(1200);
      const q = await p.evaluate(() => ({ u: window.strykerZoro.state.u, c: document.querySelector('#zo-lvls .zo-lv.c b').textContent }));
      const QS = FX('summary-QQQ');
      check(q.u === 'QQQ' && q.c === String(QS.levels.ceiling), 'symbol switch to QQQ: ceiling ' + q.c);
      await p.click('#zo-syms [data-u="ES"]'); await sleep(1200);
      const es = await p.evaluate(() => ({ small: document.querySelector('#zo-lvls .zo-lv.c small').textContent, cme: !document.querySelector('[data-panel="cme"]').hidden }));
      check(/mapped from SPX/.test(es.small) && es.cme, 'ES: "mapped from SPX" + CME panel ' + JSON.stringify(es));
      await p.click('#zo-basis [data-b="close"]'); await sleep(800);
      check(await p.evaluate(() => localStorage.getItem('stryker_gex_basis') === 'close' && document.getElementById('zo-replay').hidden), 'Daily close: shared GEX basis saved, replay hidden');
      await ctx.close();
      const rm = await open(b, { w: 1440, reduced: true });
      await rm.p.evaluate(() => window.strykerZoro.scrubTo(0));
      await rm.p.click('#zo-play'); await sleep(1100);
      const t2 = await rm.p.evaluate(() => window.strykerZoro.state.t);
      check(Number.isInteger(t2) && t2 >= 3, 'reduced motion: replay jumps whole frames (t=' + t2 + ')');
      const anim = await rm.p.evaluate(() => getComputedStyle(document.getElementById('zo-tape-track')).animationName);
      check(anim === 'none', 'reduced motion: tape does not scroll (' + anim + ')');
      await rm.ctx.close();
    }
    if (!ONLY || ONLY === 's1') {
      // the feeder's own sample (stream 1 contract, tools/fixtures/zoro): every panel must read it through norm()
      const S1 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'zoro', 'summary.json')));
      const { ctx, p, errors } = await open(b, { w: 1440, h: 1000, s1: true, shot: true, wait: 4000 });
      const lv = await p.evaluate(() => [...document.querySelectorAll('#zo-lvls .zo-lv b')].map((e) => e.textContent));
      check(lv[0] === S1.levels.call_ceiling.toLocaleString('en-US') && lv[1] === S1.levels.put_floor.toLocaleString('en-US') && lv[4] === S1.levels.pin.toLocaleString('en-US'), 's1: levels from the feeder sample ' + lv.join(' | '));
      for (const id of ['zo-prof', 'zo-ivr', 'zo-term', 'zo-pc', 'zo-volk', 'zo-ivspark']) { const n = await painted(p, id); check(n > 20, 's1: ' + id + ' painted (' + n + ')'); }
      await p.waitForFunction(() => document.querySelectorAll('#zo-skew-exp option').length > 0, null, { timeout: 8000 }).catch(() => {});
      check(await painted(p, 'zo-skew') > 20, 's1: skew from the IV surface');
      const rows = await p.evaluate(() => ({ nodes: document.querySelectorAll('#zo-nodes tr').length, burst: document.querySelectorAll('#zo-burst tr').length, screen: document.querySelectorAll('#zo-screen tr').length, note: document.querySelectorAll('#zo-note h4').length, replay: !document.getElementById('zo-replay').hidden }));
      check(rows.nodes === 10 && rows.burst >= 1 && rows.screen === 4 && rows.note >= 1 && rows.replay, 's1: rows ' + JSON.stringify(rows));
      await p.evaluate(() => document.getElementById('zo-gsurf').scrollIntoView({ block: 'center' }));
      await p.waitForFunction(() => document.getElementById('zo-gsurf').dataset.ready === '1' || document.getElementById('zo-gsurf').classList.contains('is-heat'), null, { timeout: 15000 }).catch(() => {});
      check(await p.evaluate(() => document.getElementById('zo-gsurf').dataset.ready === '1' || document.getElementById('zo-gsurf').classList.contains('is-heat')), 's1: gamma surface drawn');
      check(!errors.length, 's1: no page errors ' + errors.slice(0, 3).join(' / '));
      await p.evaluate(() => window.scrollTo(0, 0));
      await shot(p, 'S3-s1-1440-full.png', true);
      await ctx.close();
    }
    for (const [tag, o] of [['1440-free', { w: 1440, h: 1000, free: true }], ['390-free', { w: 390, h: 844, mobile: true, free: true }]]) {
      if (ONLY && ONLY !== tag) continue;
      const { ctx, p, errors } = await open(b, Object.assign({ shot: true }, o));
      const r = await p.evaluate(() => ({ locks: document.querySelectorAll('[data-pro] .zo-lock').length, pro: document.querySelectorAll('[data-pro]').length, teaser: [...document.querySelectorAll('[data-teaser]')].filter((e) => e.querySelector('.zo-lock')).length,
        notes: document.querySelectorAll('#zo-note p:not(.zo-foot)').length, syms: document.querySelectorAll('#zo-syms .is-locked').length }));
      check(r.locks === r.pro && r.teaser === 0, tag + ': every Pro panel locked, teasers open ' + JSON.stringify(r));
      check(r.notes === 3, tag + ': note teaser shows 3 lines (' + r.notes + ')');
      check(r.syms === 10, tag + ': 10 non-SPX symbols marked locked');
      await p.evaluate(() => { const e = document.querySelector('.zo-lockcard .plan-lock-price'); if (e) { e.hidden = false; e.textContent = 'Pro: $20 / month'; } });
      const price = await p.evaluate(() => /[$₹€£]\s?\d/.test(document.querySelector('.zo').innerText));
      check(!price, tag + ': no price shown on the page');
      check(!errors.length, tag + ': no page errors ' + errors.slice(0, 3).join(' / '));
      await shot(p, 'S3-' + tag + '.png', false);
      await shot(p, 'S3-' + tag + '-full.png', true);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
