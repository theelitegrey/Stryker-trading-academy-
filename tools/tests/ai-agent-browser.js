// Browser round-trip test for "Connect your AI to ZoroCharts" (assets/chart-ai-agent.js + workers/ai-agent).
// Needs the local stack (tools/tests/ai-agent-dev.sh): wrangler dev of workers/ai-agent on :8787 with DEV=1 DEV_FAKE_AUTH=1, and
// wrangler pages dev of the site on :8788 with --service AI_AGENT=tz-ai-agent. Fake member: "devtok.<uid>" (loopback only).
// Flow: personal token -> chart tab connects (chip) -> chart_symbol NQ switches the pane -> indicator_add EMA 20 shows in the
// legend -> chart_read returns it -> screenshot is an image -> a read-only token can't call chart_symbol -> Pause blocks ->
// Disconnect -> the next call fails with "open a chart". Shots + chip measurements go to $AI_SHOTS (default $TMPDIR/ai-shots).
// Run: tools/chrome-slot.sh node tools/tests/ai-agent-browser.js
const { launch } = require('./lib.js');
const fs = require('fs'), path = require('path');
const BASE = process.env.AI_BASE || 'http://127.0.0.1:8788';
const SHOTS = process.env.AI_SHOTS || path.join(process.env.TMPDIR || '/tmp', 'ai-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const UID = 'aitest' + Date.now().toString(36);
let fails = 0, n = 0;
const ok = (c, msg) => { n++; if (c) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg); } };

async function member(p, body) {
  const r = await fetch(BASE + '/api/ai/' + p, { method: 'POST', headers: { origin: BASE, authorization: 'Bearer devtok.' + UID, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: r.status, body: await r.json() };
}
let rid = 0;
async function rpc(token, method, params) {
  const r = await fetch(BASE + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
  const t = await r.text(); try { return JSON.parse(t); } catch (e) { return { http: r.status, text: t }; }
}
const call = (token, name, args) => rpc(token, 'tools/call', { name, arguments: args || {} });
const text = (r) => (r && r.result && r.result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');

// The AI item sits in the chart's bottom bar right after ALL (Owner 17 Nov 2026). Returns numbers for the alignment gate.
async function measureChip(p) {
  return p.evaluate(() => {
    const c = document.getElementById('stkai-chip'); if (!c || !c.offsetWidth) return null;
    const R = (e) => { const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), r: +b.right.toFixed(1), cy: +(b.y + b.height / 2).toFixed(1) }; };
    const rs = [...document.querySelectorAll('.vela-bb-range')], all = rs[rs.length - 1], bar = document.querySelector('.vela-widget-bottombar');
    const kids = [...c.querySelectorAll('.stkai-sep, .stkai-btn, .stkai-dot, .stkai-label')].filter((e) => e.offsetWidth).map((e) => ({ cls: e.className, ...R(e) }));
    const sep = kids.find((k) => /stkai-sep/.test(k.cls)), first = kids.find((k) => !/stkai-sep/.test(k.cls));
    return { all: R(all), allText: all.textContent, chip: R(c), kids, barH: R(bar).h, sepLeft: +(sep.x - R(all).r).toFixed(1), sepRight: +(first.x - sep.r).toFixed(1), label: (c.querySelector('.stkai-label') || {}).textContent, labelW: (c.querySelector('.stkai-label') || { offsetWidth: 0 }).offsetWidth, font: getComputedStyle(c.querySelector('.stkai-btn')).fontSize, allFont: getComputedStyle(all).fontSize, floating: !!document.querySelector('.stkchart-panel > .stkai-chip') };
  });
}
function checkRow(m, label) {
  if (!m) return ok(false, label + ': AI bar item measured');
  ok(m.chip.x >= m.all.r, label + ': item sits right of ALL (' + m.chip.x + ' >= ' + m.all.r + ')');
  const cys = [m.all.cy, ...m.kids.map((k) => k.cy)], spread = Math.max(...cys) - Math.min(...cys);
  ok(spread <= 1, label + ': same centre line as ALL (spread ' + spread.toFixed(1) + 'px)');
  const btns = m.kids.filter((k) => /stkai-btn/.test(k.cls));
  ok(btns.every((b) => b.h === m.all.h), label + ': buttons as tall as the range buttons (' + btns.map((b) => b.h).join('/') + ' vs ' + m.all.h + ')');
  ok(m.font === m.allFont, label + ': same font size as the range buttons (' + m.font + ')');
  ok(Math.abs(m.sepLeft - 12) <= 0.6 && Math.abs(m.sepRight - 12) <= 0.6, label + ': divider 12 each side (' + m.sepLeft + '/' + m.sepRight + ')');
  ok(m.labelW <= 140, label + ': label max 140 (' + m.labelW + ')');
  ok(!m.floating, label + ': no floating chip over the chart');
}
async function pressed(p, a) { await p.click('#stkai-chip [data-a=' + a + ']'); await p.waitForTimeout(300); }
async function shotChip(p, name) {
  const box = await p.evaluate(() => { const b = document.querySelector('.vela-widget-bottombar').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  await p.screenshot({ path: path.join(SHOTS, name + '.png'), clip: { x: 0, y: Math.max(0, box.y - 8), width: Math.min(box.w, 800), height: box.h + 16 } });
}

(async () => {
  // 0. stack up?
  const meta = await fetch(BASE + '/.well-known/oauth-authorization-server').then((r) => r.json()).catch(() => null);
  if (!meta || !meta.registration_endpoint) { console.log('FAIL local stack not running (tools/tests/ai-agent-dev.sh)'); process.exit(2); }
  // 1. personal tokens (control + read only)
  const pt = await member('personal', { name: 'Browser test', scope: ['mcp:read', 'mcp:chart', 'mcp:alerts'], days: 30 });
  ok(pt.status === 200 && /^tzp_/.test(pt.body.token), 'personal token created');
  const ro = await member('personal', { name: 'Read only test', scope: ['mcp:read'], days: 30 });
  const T = pt.body.token, RO = ro.body.token;
  // before any tab: clear error
  const none = await call(T, 'chart_status');
  ok(none.result && none.result.isError && /open .*\/charts/.test(text(none)), 'no tab open -> "open a chart" error');

  const b = await launch();
  const results = {};
  for (const [vw, vh, theme] of [[1440, 900, 'dark'], [390, 844, 'dark'], [1440, 900, 'light'], [412, 915, 'light']]) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2, ...(vw < 500 ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : {}) });
    await ctx.addInitScript((th) => { try { localStorage.setItem('stryker_install_prompt_dismissed', '1'); localStorage.setItem('tz_ai_on', '1'); if (th === 'light') localStorage.setItem('stryker_theme', 'day'); else localStorage.removeItem('stryker_theme'); } catch (e) {} }, theme);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
    await p.goto(BASE + '/charts.html', { waitUntil: 'load' });
    await p.waitForFunction(() => window.STRYKER_VELA && window.__stkAiAgent && window.firebase, null, { timeout: 60000 });
    await p.waitForTimeout(1500);
    // stand-in member (loopback only): every firebase.auth() call sees this user
    await p.evaluate((uid) => {
      const u = { uid, email: 'test@example.com', getIdToken: async () => 'devtok.' + uid };
      const real = firebase.auth.bind(firebase);
      firebase.auth = () => { const a = real(); return new Proxy(a, { get: (t, k) => k === 'currentUser' ? u : (typeof t[k] === 'function' ? t[k].bind(t) : t[k]) }); };
      window.__stkAiAgent.check();
    }, UID);
    await p.waitForFunction(() => window.__stkAiAgent.connected && document.querySelector('#stkai-chip .stkai-on:not([hidden])'), null, { timeout: 20000 }).catch(() => {});
    const tag = vw + '-' + theme;
    ok(await p.evaluate(() => window.__stkAiAgent.connected), tag + ': chart tab connected to the relay');
    const label = await p.evaluate(() => document.querySelector('#stkai-chip .stkai-label').textContent);
    if (vw < 900) ok(!(await p.evaluate(() => document.getElementById('stkai-chip').offsetWidth)) && !!(await p.evaluate(() => document.getElementById('stkc-ai-btn'))), tag + ': phone: bar item hidden, ⋯ menu entry is the way in');
    ok(/^AI connected · /.test(label), tag + ': chip says "' + label + '"');

    if (vw === 1440 && theme === 'dark') {
      // 2. MCP handshake
      const init = await rpc(T, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'browser-test', version: '1' } });
      ok(init.result && init.result.serverInfo.name === 'tradezoro', 'initialize');
      const list = await rpc(T, 'tools/list', {});
      ok(list.result && list.result.tools.length === 19, 'tools/list: ' + (list.result && list.result.tools.length) + ' tools');
      const tabs = JSON.parse(text(await call(T, 'chart_list')));
      ok(tabs.tabs.length >= 1, 'chart_list sees the tab (' + tabs.tabs.map((t) => t.device).join(',') + ')');
      // 3. chart_symbol NQ
      const s = await call(T, 'chart_symbol', { symbol: 'NQ' });
      const sym = await p.evaluate(() => window.STRYKER_VELA.active.symbol);
      ok(!s.result.isError && sym === 'futures:NQ1!', 'chart_symbol NQ -> pane is ' + sym + ' (' + text(s).slice(0, 120) + ')');
      await p.waitForTimeout(400);
      const toastT = await p.evaluate(() => [...document.querySelectorAll('[class*=toast]')].map((e) => e.textContent.trim()).filter(Boolean).join(' | '));
      ok(/switched the chart to NQ1!/.test(toastT), 'toast: ' + toastT.slice(0, 100));
      // back to a symbol with local candles for indicator values
      await call(T, 'chart_symbol', { symbol: 'binance:BTCUSDT' });
      // 4. indicator_add EMA 20
      const add = await call(T, 'indicator_add', { name: 'EMA', inputs: { length: 20 } });
      const addD = add.result.isError ? {} : JSON.parse(text(add));
      ok(!add.result.isError && /Exponential/.test(addD.name) && addD.inputs.length === 20, 'indicator_add EMA 20 -> ' + text(add).slice(0, 160));
      await p.waitForTimeout(800);
      const legend = await p.evaluate(() => { const out = []; const w = document.createTreeWalker(document.querySelector('#vela-chart') || document.body, NodeFilter.SHOW_TEXT); let x; while ((x = w.nextNode())) { const t = x.textContent.trim(); if (/EMA/.test(t)) out.push(t); } return out.slice(0, 5); });
      const inds = await p.evaluate(() => window.STRYKER_VELA.active.chart.indicators().map((h) => h.nativeType + ':' + JSON.stringify(h.inputValues().length)));
      ok(inds.some((x) => x === 'ema:20'), 'chart has ema length 20 (' + inds.join(', ') + ')');
      ok(legend.length > 0, 'legend shows EMA (' + legend.join(' | ') + ')');
      await p.screenshot({ path: path.join(SHOTS, 'ai-chart-1440-dark.png') });
      // 5. chart_read returns it
      const rdr = await call(T, 'chart_read', { bars: 5 }); if (rdr.result.isError) console.log('     chart_read error: ' + text(rdr));
      const rd = JSON.parse(text(rdr));
      const e = rd.indicators.find((x) => x.type === 'ema');
      ok(e && e.inputs.length === 20 && e.latest.length && Number.isFinite(e.latest[0].value), 'chart_read returns EMA 20 with latest value ' + (e && JSON.stringify(e.latest[0])));
      ok(rd.candles.rows.length === 5 && rd.candles.rows[0].length === 6, 'chart_read candles OHLCV x5');
      // 6. drawing + timeframe + screenshot
      const last = rd.candles.rows[rd.candles.rows.length - 1];
      const dr = await call(T, 'drawing_add', { type: 'hline', points: [{ price: last[4] }] });
      ok(!dr.result.isError, 'drawing_add hline -> ' + text(dr).slice(0, 100));
      const tf = await call(T, 'chart_timeframe', { timeframe: '1h' });
      ok(!tf.result.isError && (await p.evaluate(() => String(window.STRYKER_VELA.active.timeframe))) === '60', 'chart_timeframe 1h -> 60');
      const shot = await call(T, 'chart_screenshot');
      const img = shot.result && shot.result.content.find((c) => c.type === 'image');
      ok(img && img.mimeType === 'image/png' && img.data.length > 1000, 'chart_screenshot -> PNG image content (' + (img ? img.data.length : 0) + ' b64 chars)');
      if (img) fs.writeFileSync(path.join(SHOTS, 'ai-tool-screenshot.png'), Buffer.from(img.data, 'base64'));
      const sr = JSON.parse(text(await call(T, 'symbol_resolve', { query: 'nasdaq', limit: 3 })));
      ok(sr.results.length > 0, 'symbol_resolve nasdaq -> ' + sr.results.map((x) => x.symbol).join(', '));
      // 7. read-only token is refused chart_symbol
      const deny = await call(RO, 'chart_symbol', { symbol: 'ES' });
      ok(deny.result.isError && /needs mcp:chart/.test(text(deny)), 'read-only token cannot call chart_symbol');
      ok((await p.evaluate(() => window.STRYKER_VELA.active.symbol)) === 'binance:BTCUSDT', 'chart unchanged after refused call');
      // 8. chip alignment (dark 1440) + crop
      results[tag] = await measureChip(p); checkRow(results[tag], tag);
      await shotChip(p, 'aibar-' + tag);
      // 9. Pause blocks, Resume restores
      await pressed(p, 'pause');
      const pz = await call(T, 'chart_status');
      ok(pz.result.isError && /paused/.test(text(pz)), 'Pause -> calls refused (' + text(pz).slice(0, 80) + ')');
      results[tag + '-paused'] = await measureChip(p); checkRow(results[tag + '-paused'], tag + ' paused');
      await shotChip(p, 'aibar-' + tag + '-paused');
      ok(/AI paused · /.test(await p.evaluate(() => document.querySelector('#stkai-chip .stkai-label').textContent)) && (await p.textContent('#stkai-chip [data-a=pause]')) === 'Resume', 'paused state: "AI paused · app" + Resume');
      await pressed(p, 'pause');
      ok(!(await call(T, 'chart_status')).result.isError, 'Resume -> calls work again');
      // 10. Disconnect -> next call fails
      await pressed(p, 'off'); await p.waitForTimeout(300);
      ok(await p.evaluate(() => { const c = document.getElementById('stkai-chip'); return c.querySelector('.stkai-on').hidden && !c.querySelector('[data-a=connect]').hidden && /Connect AI/.test(c.textContent); }), 'x -> not-connected state: "Connect AI" pill');
      results[tag + '-off'] = await measureChip(p); checkRow(results[tag + '-off'], tag + ' not connected'); await shotChip(p, 'aibar-' + tag + '-off');
      const after = await call(T, 'chart_symbol', { symbol: 'ES' });
      ok(after.result.isError && /No ZoroCharts tab/.test(text(after)), 'after Disconnect the next call fails: ' + text(after).slice(0, 90));
      // the Connect AI pill turns it back on
      await p.click('#stkai-chip [data-a=connect]');
      await p.waitForFunction(() => window.__stkAiAgent.connected, null, { timeout: 10000 }).catch(() => {});
      ok(await p.evaluate(() => window.__stkAiAgent.connected), '"Connect AI" pill reconnects this tab');
      // revoke from the agents API -> tab drops it
      const g = await member('grants'); const mine = g.body.grants.find((x) => x.name === 'Read only test');
      await member('grant/delete', { id: mine.id });
      ok((await rpc(RO, 'ping', {})).error, 'revoked token -> 401');
      const menuTxt = await p.evaluate(() => { const b = document.getElementById('stkc-ai-btn'); return b && (b.closest('[role=menu], .stkc-ob-menu, .ob-menu') ? 'in menu' : 'in bar'); });
      console.log('     menu entry placement: ' + menuTxt);
    } else {
      if (vw >= 900) { results[tag] = await measureChip(p); checkRow(results[tag], tag); await shotChip(p, 'aibar-' + tag); }
      await p.screenshot({ path: path.join(SHOTS, 'ai-chart-' + tag + '.png') });
    }
    ok(!errs.some((e) => /ai-agent|stkai/i.test(e)), tag + ': no page errors from the AI module' + (errs.length ? ' (others: ' + errs.slice(0, 2).join(' / ') + ')' : ''));
    await ctx.close();
  }
  fs.writeFileSync(path.join(SHOTS, 'aibar-measure.json'), JSON.stringify(results, null, 1));
  await b.close();
  console.log('\n' + (n - fails) + ' passed, ' + fails + ' failed. Shots: ' + SHOTS);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed: ' + (e.stack || e)); process.exit(1); });
