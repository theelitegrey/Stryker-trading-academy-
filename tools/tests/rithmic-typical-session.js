// Rithmic conformance, implementation check: run ONE "typical" Charts session against the REAL
// Rithmic Test gateway (wss://rituz00100.rithmic.com) with the app's own client, headless.
//   node tools/tests/chart-dev-server.mjs 8031          (site, binds 127.0.0.1)
//   RITHMIC_LOGIN=/path/to/test-login.json CHART_BASE=http://127.0.0.1:8031 \
//     node tools/tests/rithmic-typical-session.js <out.json> [idleMinutes=10]
// The login file is read here and typed into the Connect sheet; it is NEVER printed, logged or
// written anywhere (the output JSON holds ids, times and counts only). No screenshot is taken while
// the username is on screen. The Owner-only flag is widened to the stub test user for this page
// load only (the served rithmic-config.js is patched in flight; nothing in the repo changes).
// Steps: NQ1! 1m -> connect -> ES1! 5m -> scroll back once -> 5m -> 15m -> idle -> Disconnect.
// Every frame the browser sends on the Rithmic sockets is decoded and counted per plant.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || 'rithmic-session.json';
const IDLE_MIN = Number(process.argv[3] || 10);
const SHOTS = process.env.SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(new Date().toISOString().slice(11, 19) + ' ' + m);

(async () => {
  const { T, decode } = await import('../../assets/rithmic-proto.js');
  const NAMES = { 10: 'RequestLogin', 12: 'RequestLogout', 16: 'RequestRithmicSystemInfo', 18: 'RequestHeartbeat', 100: 'RequestMarketDataUpdate', 113: 'RequestFrontMonthContract', 202: 'RequestTimeBarReplay' };
  const login = JSON.parse(fs.readFileSync(process.env.RITHMIC_LOGIN, 'utf8'));
  const result = { gateway: null, system: login.system, steps: [], wire: {}, wireTimeline: [], errors: [] };
  const step = (name) => { result.steps.push({ name, at: Date.now() }); log(name); };

  const b = await launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(stub);
    await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker_rithmic_dev'); localStorage.removeItem('stryker_rithmic_user'); } catch (e) {} });
    // Flag: Owner uid only. Let the stub user (u1) in for this run only.
    await ctx.route(/\/assets\/rithmic-config\.js/, async (r) => {
      const res = await r.fetch();
      const body = (await res.text()).replace("allowUids: ['", "allowUids: ['u1', '");
      await r.fulfill({ response: res, body });
    });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage();
    p.on('pageerror', (e) => result.errors.push(String(e).slice(0, 200)));
    // Decode every frame sent to Rithmic. Only template ids / request kinds are kept.
    const plantOf = new Map();
    p.on('websocket', (ws) => {
      if (!/rithmic\.com/.test(ws.url())) return;
      result.gateway = ws.url();
      const sockId = Math.random().toString(36).slice(2, 7);
      ws.on('framesent', (f) => {
        let m; try { m = decode(Buffer.isBuffer(f.payload) ? f.payload : Buffer.from(f.payload, 'latin1')); } catch (e) { return; }
        if (m.template_id === T.LOGIN) plantOf.set(sockId, m.infra_type === 1 ? 'ticker' : m.infra_type === 3 ? 'history' : 'infra' + m.infra_type);
        const plant = plantOf.get(sockId) || 'system-info';
        let name = NAMES[m.template_id] || 'template ' + m.template_id;
        if (m.template_id === T.MD_UPDATE) name += m.request === 2 ? ' (unsubscribe)' : ' (subscribe)';
        const w = result.wire[plant] || (result.wire[plant] = {});
        w[name] = (w[name] || 0) + 1;
        if (m.template_id !== T.HEARTBEAT) result.wireTimeline.push({ at: Date.now(), plant, name, symbol: m.symbol || undefined, need_updates: m.need_updates });
      });
    });

    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_RITHMIC, null, { timeout: 60000 });
    const cell = () => p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0]; return { symbol: c.symbol, tf: c.timeframe, n: c.chart.orchestrator.rawBars.length }; });
    const setMarket = (m) => p.evaluate((m) => window.STRYKER_VELA.context().cells[0].chart.setMarket(m), m);
    await setMarket({ symbol: 'futures:NQ1!', timeframe: '1' });
    await sleep(3000);
    step('chart NQ1! 1m (standard data, before connecting): ' + JSON.stringify(await cell()));

    // Connect through the sheet (exactly what a member does).
    await p.click('#stkrb-btn');
    await p.waitForFunction(() => [...document.querySelectorAll('#stkrb-sys option')].some((o) => o.value === 'Rithmic Test'), null, { timeout: 30000 });
    await p.selectOption('#stkrb-sys', login.system);
    await p.fill('#stkrb-user', login.user);
    await p.fill('#stkrb-pass', login.pw);
    await p.click('#stkrb-go');
    const ok = await p.waitForFunction(() => window.STRYKER_RITHMIC.state === 'connected' || !document.querySelector('.stkrb-err').hidden, null, { timeout: 45000 }).then(() => true).catch(() => false);
    const st = await p.evaluate(() => ({ state: window.STRYKER_RITHMIC.state, err: document.querySelector('.stkrb-err').hidden ? '' : document.querySelector('.stkrb-err').textContent }));
    await p.fill('#stkrb-user', '').catch(() => {});
    if (!ok || st.state !== 'connected') {
      result.refused = st.err || ('state ' + st.state);
      step('LOGIN FAILED: ' + result.refused);
      throw new Error('login refused');
    }
    step('connected to ' + login.system);
    await sleep(8000);
    step('NQ1! 1m on Rithmic: ' + JSON.stringify(await cell()) + ' source=' + await p.evaluate(() => window.STRYKER_RITHMIC.lastSource));

    await setMarket({ symbol: 'futures:ES1!', timeframe: '5' });
    await sleep(8000);
    step('ES1! 5m: ' + JSON.stringify(await cell()));

    // Scroll back once: drag the plot to the right (older bars) until Vela pages history.
    const n0 = (await cell()).n;
    const box = await p.evaluate(() => { const r = document.querySelector('#vela-chart canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    for (let i = 0; i < 6 && (await cell()).n === n0; i++) {
      await p.mouse.move(box.x + box.w * 0.15, box.y + box.h * 0.5);
      await p.mouse.down();
      await p.mouse.move(box.x + box.w * 0.95, box.y + box.h * 0.5, { steps: 12 });
      await p.mouse.up();
      await sleep(2500);
    }
    // Vela may also ask by zoom-out; one wheel step if dragging did not page.
    if ((await cell()).n === n0) { await p.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5); await p.mouse.wheel(0, 2400); await sleep(4000); }
    step('scroll back: bars ' + n0 + ' -> ' + (await cell()).n);

    await setMarket({ timeframe: '15' });
    await sleep(8000);
    step('timeframe change ES1! 5m -> 15m: ' + JSON.stringify(await cell()));
    if (SHOTS) {
      await p.click('#stkrb-btn'); await sleep(500);
      await p.screenshot({ path: path.join(SHOTS, 'rithmic-test-live-1440.png') });
      await p.keyboard.press('Escape');
    }

    step('idle ' + IDLE_MIN + ' min, receiving updates');
    const t0 = await p.evaluate(() => { const b = window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars; return b[b.length - 1]; });
    const changes = await p.evaluate(async (ms) => {
      const o = window.STRYKER_VELA.context().cells[0].chart.orchestrator;
      let n = 0, last = '';
      const end = Date.now() + ms;
      while (Date.now() < end) {
        await new Promise((r) => setTimeout(r, 1000));
        const b = o.rawBars[o.rawBars.length - 1];
        const k = b.time + ':' + b.close + ':' + b.volume;
        if (k !== last) { n++; last = k; }
      }
      return n;
    }, IDLE_MIN * 60000);
    const t1 = await p.evaluate(() => { const b = window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars; return b[b.length - 1]; });
    result.idle = { secondsWithChange: changes, firstBar: t0 && t0.time, lastBar: t1 && t1.time, lastClose: t1 && t1.close };
    step('idle done: forming bar changed in ' + changes + ' of ' + IDLE_MIN * 60 + ' one-second samples');

    // Clean logout via the Disconnect button.
    result.sessionsBeforeLogout = await p.evaluate(() => window.STRYKER_RITHMIC.sessions);
    result.appCounts = await p.evaluate(() => window.STRYKER_RITHMIC.counts);
    await p.click('#stkrb-btn');
    await p.click('#stkrb-off');
    await p.waitForFunction(() => window.STRYKER_RITHMIC.state === 'idle', null, { timeout: 15000 });
    await sleep(1000);
    result.sessions = await p.evaluate(() => window.STRYKER_RITHMIC.sessions);
    result.appCountsFinal = await p.evaluate(() => window.STRYKER_RITHMIC.counts);
    step('disconnected (RequestLogout on both plants)');
    await ctx.close();
  } catch (e) {
    result.errors.push(String(e && e.message || e).slice(0, 200));
  } finally {
    await b.close();
    // Belt and braces: the output must never contain the login.
    let out = JSON.stringify(result, null, 2);
    for (const v of [login.pw, login.user]) if (v && out.includes(v)) out = out.split(v).join('[redacted]');
    fs.writeFileSync(OUT, out);
    log('wrote ' + OUT);
  }
})();
