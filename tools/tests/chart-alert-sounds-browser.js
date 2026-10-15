// Charts alert sounds browser test.
//   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-alert-sounds-browser.js [shotsDir]
const fs = require('fs');
const path = require('path');
const { launch, ROOT } = require('./lib.js');
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
  // Console errors, except generic resource-load lines: the harness aborts Firebase/Google
  // routes and has no favicon/data stubs. Sound files are checked by URL below instead. The static server has no
  // /api/chart data feed, so its WebSocket handshake 404s are ignored too.
  p.on('console', (m) => { const t = m.text(); if ((m.type() === 'error' && !/^Failed to load resource|^WebSocket connection to .*\/api\/chart\//.test(t)) || (m.type() === 'warning' && /alert sound/i.test(t))) errors.push('console: ' + t); });
  p.on('requestfailed', (r) => { if (/\/assets\/sounds\//.test(r.url())) errors.push('sound request failed: ' + r.url()); });
  p.on('response', (r) => { if (/\/assets\/sounds\//.test(r.url()) && r.status() >= 400) errors.push('sound ' + r.status() + ': ' + r.url()); else if (r.status() === 404) p.__404 = (p.__404 || []).concat(r.url()); });
  p.__soundReqs = [];
  p.on('request', (r) => { if (/\/assets\/sounds\//.test(r.url())) p.__soundReqs.push(r.url()); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.__stkAlerts && window.StrykerChartSounds, null, { timeout: 45000 });
  await p.waitForTimeout(1200);
  return { ctx, p, errors };
}

const TZ = [1, 2, 3, 4, 5, 6];
const CAP = 40 * 1024;

(async () => {
  // Recorded TradeZoro sounds: both formats exist and are under the size cap.
  for (const n of TZ) for (const ext of ['ogg', 'mp3']) {
    const f = path.join(ROOT, 'assets', 'sounds', `tradezoro-${n}.${ext}`);
    const size = fs.existsSync(f) ? fs.statSync(f).size : -1;
    check(size > 1000 && size < CAP, `tradezoro-${n}.${ext} exists and is under 40 KB`, size);
  }
  const b = await launch();
  let { ctx, p, errors } = await open(b, 1280, 900, false);

  check(p.__soundReqs.length === 0, 'recorded sounds are not fetched on page load (lazy)', p.__soundReqs);
  const order = await p.evaluate(() => window.StrykerChartSounds.SOUNDS.map((s) => s[1]));
  check(order.slice(0, 12).join('|') === 'Off|TradeZoro 1|TradeZoro 2|TradeZoro 3|TradeZoro 4|TradeZoro 5|TradeZoro 6|Chime|Bell|Ping|Cash register|Alarm', 'TradeZoro 1-6 listed above the synth sounds', order);
  const defaults = await p.evaluate(() => window.StrykerChartSounds.DEFAULT_MAP);
  check(JSON.stringify(defaults) === JSON.stringify({ price: 'chime', tp: 'cash', sl: 'alarm', long: 'bell', short: 'ping', closed: 'chime', indicator: 'ping' }), 'event defaults unchanged', defaults);
  const tz = await p.evaluate(async (ns) => {
    const S = window.StrykerChartSounds, out = [];
    for (const n of ns) {
      const k = 'tz' + n;
      window.__stkAlertBeeps = 0;
      const ok = await S.preview(k, 'price');
      const buf = await S.loadFile(k);
      const again = await S.loadFile(k);
      // Decode the MP3 fallback too, as Safari would.
      const c = new AudioContext();
      const mp3 = await fetch('assets/sounds/tradezoro-' + n + '.mp3').then((r) => r.arrayBuffer()).then((ab) => c.decodeAudioData(ab));
      let peak = 0; const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
      out.push({ n, ok, beeps: window.__stkAlertBeeps, dur: +buf.duration.toFixed(2), ch: buf.numberOfChannels, fmt: buf.__stkFormat, cached: buf === again, mp3dur: +mp3.duration.toFixed(2), peakDb: +(20 * Math.log10(peak)).toFixed(1) });
      c.close();
    }
    return out;
  }, TZ);
  for (const r of tz) {
    check(r.ok === true && r.beeps === 1 && r.dur > 0.3 && r.dur < 3.5 && r.ch === 1 && r.cached && r.mp3dur > 0.3, `TradeZoro ${r.n} loads, decodes, plays (ogg + mp3), buffer cached`, r);
    check(r.peakDb <= -3, `TradeZoro ${r.n} peak at or below -3 dB`, r.peakDb);
  }
  const reqsAfter = p.__soundReqs.length;
  await p.evaluate(() => window.StrykerChartSounds.preview('tz1', 'price'));
  check(p.__soundReqs.length === reqsAfter, 'second preview reuses cached buffer (no refetch)', p.__soundReqs.length - reqsAfter);
  const rate = await p.evaluate(async () => {
    const S = window.StrykerChartSounds;
    S.setEventSound('closed', 'tz3');
    await new Promise((r) => setTimeout(r, 2100));
    window.__stkAlertBeeps = 0;
    const a = await S.play('closed'); const b2 = await S.play('closed');
    const p0 = S.prefs(); const vol = p0.volume; p0.volume = 0; S.save(p0);
    await new Promise((r) => setTimeout(r, 2100));
    const muted = await S.play('closed');
    p0.volume = vol; S.save(p0);
    S.setEventSound('closed', 'chime');
    await new Promise((r) => setTimeout(r, 2100));
    return { a, b2, muted, beeps: window.__stkAlertBeeps };
  });
  check(rate.a === true && rate.b2 === false && rate.muted === false && rate.beeps === 1, 'TradeZoro event sound respects 2 s rate limit and volume 0', rate);

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
  if (p.__404) console.log('info: 404s (not sound files):', JSON.stringify(p.__404).slice(0, 300));
  check(!errors.length, 'no page errors (1280)', errors);
  await ctx.close();

  ({ ctx, p, errors } = await open(b, 390, 844, true));
  await p.evaluate(() => { window.__stkAlerts.openSounds(); });
  await p.waitForSelector('#stk-snd:not([hidden])');
  await p.waitForTimeout(300);
  const mobile = await p.evaluate(() => {
    const row = document.querySelector('#stk-snd .stk-snd-row');
    const play = row.querySelector('[data-k=play]').getBoundingClientRect(), sel = row.querySelector('select').getBoundingClientRect();
    return { w: document.documentElement.scrollWidth, vw: innerWidth, rows: document.querySelectorAll('.stk-snd-row').length,
      removeShown: [...document.querySelectorAll('#stk-snd [data-k=remove]')].filter((x) => !x.hidden && x.offsetParent).length,
      playW: Math.round(play.width), sameLine: Math.abs((play.top + play.height / 2) - (sel.top + sel.height / 2)) < 4,
      helper: document.querySelector('#stk-snd .stk-snd-preview p').textContent };
  });
  const opts = await p.evaluate(() => [...document.querySelectorAll('#stk-snd .stk-snd-row select')].map((s) => [...s.options].slice(1, 8).map((o) => o.textContent).join('|')));
  check(opts.length === 7 && opts.every((o) => o === 'TradeZoro 1|TradeZoro 2|TradeZoro 3|TradeZoro 4|TradeZoro 5|TradeZoro 6|Chime'), 'every event dropdown lists TradeZoro 1-6 above Chime', opts);
  const pillsTz = await p.evaluate(() => [...document.querySelectorAll('#stk-snd .stk-snd-pill')].filter((b) => /TradeZoro/.test(b.textContent)).length);
  check(pillsTz === 6, 'preview pills include TradeZoro 1-6', pillsTz);
  check(mobile.removeShown === 0, 'Remove hidden when no custom sound is uploaded', mobile);
  check(mobile.playW <= 40 && mobile.sameLine, 'play is a compact icon button next to the dropdown', mobile);
  check(mobile.helper === 'Tap a sound to hear it.', 'helper text', mobile.helper);
  await p.screenshot({ path: `${OUT}/alert-sounds-390.png`, fullPage: false });
  check(mobile.rows >= 7 && mobile.w <= mobile.vw + 2, '390 sound settings fit without horizontal overflow', mobile);
  check(!errors.length, 'no page errors (390)', errors);
  await ctx.close();
  await b.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
