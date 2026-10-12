// Charts alert sounds browser test.
//   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-alert-sounds-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };

async function open(b, w, h, mobile) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.__stkAlerts && window.StrykerChartSounds, null, { timeout: 45000 });
  await p.waitForTimeout(1200);
  return { ctx, p, errors };
}

(async () => {
  const b = await launch();
  let { ctx, p, errors } = await open(b, 1280, 900, false);

  const pure = await p.evaluate(async () => {
    const S = window.StrykerChartSounds;
    window.__stkAlertBeeps = 0;
    await S.preview('bell', 'price');
    const preview = window.__stkAlertBeeps;
    S.setEventSound('tp', 'cash');
    const saved = JSON.parse(localStorage.getItem('stryker_chart_alert_prefs')).sounds.tp;
    const beforeReload = S.prefs().sounds.tp;
    await S.play('tp', { noRateLimit: true });
    const simBefore = window.__stkAlertBeeps;
    S.simEvent('take-profit', { id: 1 });
    await new Promise((r) => setTimeout(r, 80));
    const simAfter = window.__stkAlertBeeps;
    const hist = S.indicatorAlert('Take-Profit 1 Hit', { history: true, live: false, barClosed: true, barTime: 1 });
    const afterHist = window.__stkAlertBeeps;
    await new Promise((r) => setTimeout(r, 2100));
    const ind = S.indicatorAlert('Take-Profit 1 Hit', { live: true, barClosed: true, barTime: 2, freq: 'alert.freq_once_per_bar_close' });
    await new Promise((r) => setTimeout(r, 80));
    const afterInd = window.__stkAlertBeeps;
    const again = S.indicatorAlert('Take-Profit 1 Hit', { live: true, barClosed: true, barTime: 2, freq: 'alert.freq_once_per_bar_close' });
    return { preview, saved, beforeReload, simBefore, simAfter, hist, afterHist, ind, afterInd, again };
  });
  check(pure.preview > 0, 'preview plays', pure);
  check(pure.saved === 'cash' && pure.beforeReload === 'cash', 'mapping saves', pure);
  check(pure.simAfter > pure.simBefore, 'sim TP event plays TP sound', pure);
  check(pure.hist === false && pure.afterHist === pure.simAfter, 'indicator alerts do not fire during history load', pure);
  check(pure.ind === 'tp' && pure.afterInd > pure.afterHist && pure.again === false, 'live indicator TP fires once per bar close', pure);

  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.StrykerChartSounds && window.__stkAlerts, null, { timeout: 45000 });
  const reload = await p.evaluate(() => window.StrykerChartSounds.prefs().sounds.tp);
  check(reload === 'cash', 'mapping reloads', reload);

  const custom = await p.evaluate(async () => {
    const S = window.StrykerChartSounds;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const sr = 8000, len = sr / 5, buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.sin(i / sr * Math.PI * 2 * 440) * 0.2;
    const wav = (function () {
      const dataLen = len * 2, ab = new ArrayBuffer(44 + dataLen), v = new DataView(ab);
      const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, dataLen, true);
      let o = 44; for (let i = 0; i < len; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, d[i])) * 32767, true);
      return new File([ab], 'short.wav', { type: 'audio/wav' });
    })();
    const rec = await S.putCustom('sl', wav);
    window.__stkAlertBeeps = 0;
    await S.play('sl', { noRateLimit: true });
    await new Promise((r) => setTimeout(r, 80));
    const played = window.__stkAlertBeeps;
    await S.removeCustom('sl');
    const removed = await S.getCustom('sl');
    let oversize = '';
    try { await S.putCustom('price', new File([new Uint8Array(1024 * 1024 + 1)], 'big.wav', { type: 'audio/wav' })); } catch (e) { oversize = e.message; }
    return { rec, played, removed: !!removed, oversize };
  });
  check(custom.rec && custom.rec.name === 'short.wav' && custom.played > 0 && custom.removed === false, 'custom upload stores, plays and removes', custom);
  check(/1 MB|smaller/.test(custom.oversize), 'oversize file is rejected', custom.oversize);

  await p.evaluate(() => { window.__stkAlerts.openSounds(); });
  await p.waitForSelector('#stk-snd:not([hidden])');
  await p.screenshot({ path: `${OUT}/alert-sounds-1280.png`, fullPage: false });
  check(!errors.length, 'no page errors (1280)', errors);
  await ctx.close();

  ({ ctx, p, errors } = await open(b, 390, 844, true));
  await p.evaluate(() => { window.__stkAlerts.openSounds(); });
  await p.waitForSelector('#stk-snd:not([hidden])');
  const mobile = await p.evaluate(() => ({ w: document.documentElement.scrollWidth, vw: innerWidth, rows: document.querySelectorAll('.stk-snd-row').length }));
  await p.screenshot({ path: `${OUT}/alert-sounds-390.png`, fullPage: false });
  check(mobile.rows >= 7 && mobile.w <= mobile.vw + 2, '390 sound settings fit without horizontal overflow', mobile);
  check(!errors.length, 'no page errors (390)', errors);
  await ctx.close();
  await b.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
