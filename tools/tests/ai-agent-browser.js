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

async function measureChip(p) {
  return p.evaluate(() => {
    const c = document.getElementById('stkai-chip'); if (!c || c.hidden) return null;
    const R = (e) => { const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), cy: +(b.y + b.height / 2).toFixed(1) }; };
    const kids = [...c.children].map((e) => ({ cls: e.className, ...R(e) }));
    const box = R(c), panel = R(c.offsetParent || document.body);
    const gaps = kids.slice(1).map((k, i) => +(k.x - (kids[i].x + kids[i].w)).toFixed(1));
    const fl = document.querySelector('.stkc-fl'), flb = fl && fl.getBoundingClientRect();
    const cb = c.getBoundingClientRect();
    const hits = [...document.querySelectorAll('.tz-brand, .stkc-fl, .stkc-fl > *')].filter((e) => getComputedStyle(e).visibility !== 'hidden' && +getComputedStyle(e).opacity > 0).map((e) => Object.assign(e.getBoundingClientRect(), {})).filter((b) => b.width && b.left < cb.right && b.right > cb.left && b.top < cb.bottom && b.bottom > cb.top).length;
    const cv = [...document.querySelectorAll('#vela-chart canvas')].map((x) => x.getBoundingClientRect()).filter((b) => b.width > 100)[0];
    const who = [...document.querySelectorAll('.tz-brand, .stkc-fl, .stkc-fl > *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.left < cb.right && b.right > cb.left && b.top < cb.bottom && b.bottom > cb.top; }).map((e) => e.className + ' vis=' + getComputedStyle(e).visibility + ' op=' + getComputedStyle(e).opacity + ' disp=' + getComputedStyle(e).display);
    const stacked = !!(flb && flb.height && cb.bottom <= flb.top);
    const brs = [...document.querySelectorAll('.tz-brand')].map((e) => e.getBoundingClientRect()).filter((b) => b.width && b.bottom > cb.bottom);
    const stackGap = stacked ? +(Math.min(flb.top, ...brs.map((b) => b.top)) - cb.bottom).toFixed(1) : null;
    return { stacked, stackGap, who, overlaps: hits, insidePlot: cv ? +(cv.right - cb.right).toFixed(1) : null, flCy: flb && flb.height ? +(flb.y + flb.height / 2).toFixed(1) : null, chip: box, kids, gaps, padL: +(kids[0].x - box.x - 1).toFixed(1), padR: +(box.x + box.w - 1 - (kids[kids.length - 1].x + kids[kids.length - 1].w)).toFixed(1), fromPanelLeft: +(box.x - panel.x).toFixed(1), fromPanelBottom: +(panel.y + panel.h - box.y - box.h).toFixed(1) };
  });
}
function checkRow(m, label) {
  if (!m) return ok(false, label + ': chip measured');
  const cys = m.kids.map((k) => k.cy), spread = Math.max(...cys) - Math.min(...cys);
  ok(spread <= 1, label + ': one vertical centre (spread ' + spread.toFixed(1) + 'px)');
  const btns = m.kids.filter((k) => /stkai-btn/.test(k.cls));
  ok(btns.every((b) => b.h === btns[0].h), label + ': buttons same height (' + btns.map((b) => b.h).join('/') + ')');
  // The status slot is a 32px box (mirrors the 32px close button) holding an 8px dot, pulled 8px into the label: what the eye
  // sees is the dot-to-label gap = (32 - 8) / 2 - 0 = 12. Buttons sit 8 apart.
  const dot = m.kids[0], dotGap = +(m.kids[1].x - (dot.x + dot.w / 2 + 4)).toFixed(1);
  ok(Math.abs(dotGap - 12) <= 0.6, label + ': dot to label 12 (' + dotGap + ')');
  ok(m.gaps.slice(1).every((g) => Math.abs(g - 8) <= 0.6), label + ': gaps 8 (' + m.gaps.slice(1).join(', ') + ')');
  ok(Math.abs(m.padL - m.padR) <= 0.6, label + ': equal inner padding (' + m.padL + '/' + m.padR + ')');
  ok(Math.abs(m.chip.cy - (btns[0].cy)) <= 1, label + ': buttons centred in the chip');
  if (m.flCy != null && !m.stacked) ok(Math.abs(m.flCy - m.chip.cy) <= 1, label + ': chip centred on the Fit price / Latest row (' + m.chip.cy + ' vs ' + m.flCy + ')');
  if (m.stacked) ok(Math.abs(m.stackGap - 8) <= 1, label + ': phone: chip one row above the Fit price / Latest pills, 8 gap (' + m.stackGap + ')');
  ok(m.overlaps === 0, label + ': covers no chart control (logo badge, Fit price / Latest)' + (m.who.length ? ' ' + m.who.join(' | ') : ''));
  if (m.insidePlot != null) ok(m.insidePlot >= 8, label + ': inside the plot, ' + m.insidePlot + 'px clear of the price axis');
  ok(m.fromPanelLeft >= 8 || m.stacked, label + ': not hugging the edge (' + m.fromPanelLeft + 'px from left)');
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
    await p.waitForFunction(() => window.__stkAiAgent.connected && !document.getElementById('stkai-chip').hidden, null, { timeout: 20000 }).catch(() => {});
    const tag = vw + '-' + theme;
    ok(await p.evaluate(() => window.__stkAiAgent.connected), tag + ': chart tab connected to the relay');
    const label = await p.evaluate(() => document.querySelector('#stkai-chip .stkai-label').textContent);
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
      await shotChip(p, 'chip-' + tag);
      // 9. Pause blocks, Resume restores
      await p.click('#stkai-chip [data-a=pause]');
      await p.waitForTimeout(300);
      const pz = await call(T, 'chart_status');
      ok(pz.result.isError && /paused/.test(text(pz)), 'Pause -> calls refused (' + text(pz).slice(0, 80) + ')');
      results[tag + '-paused'] = await measureChip(p); checkRow(results[tag + '-paused'], tag + ' paused');
      await shotChip(p, 'chip-' + tag + '-paused');
      await p.click('#stkai-chip [data-a=pause]');
      await p.waitForTimeout(300);
      ok(!(await call(T, 'chart_status')).result.isError, 'Resume -> calls work again');
      // 10. Disconnect -> next call fails
      await p.click('#stkai-chip [data-a=off]');
      await p.waitForTimeout(500);
      ok(await p.evaluate(() => document.getElementById('stkai-chip').hidden), 'Disconnect hides the chip');
      const after = await call(T, 'chart_symbol', { symbol: 'ES' });
      ok(after.result.isError && /No ZoroCharts tab/.test(text(after)), 'after Disconnect the next call fails: ' + text(after).slice(0, 90));
      // the More-menu entry turns it back on
      await p.evaluate(() => document.getElementById('stkc-ai-btn').click());
      await p.waitForFunction(() => window.__stkAiAgent.connected, null, { timeout: 10000 }).catch(() => {});
      ok(await p.evaluate(() => window.__stkAiAgent.connected), '"Connect your AI" menu entry reconnects this tab');
      // revoke from the agents API -> tab drops it
      const g = await member('grants'); const mine = g.body.grants.find((x) => x.name === 'Read only test');
      await member('grant/delete', { id: mine.id });
      ok((await rpc(RO, 'ping', {})).error, 'revoked token -> 401');
      const menuTxt = await p.evaluate(() => { const b = document.getElementById('stkc-ai-btn'); return b && (b.closest('[role=menu], .stkc-ob-menu, .ob-menu') ? 'in menu' : 'in bar'); });
      console.log('     menu entry placement: ' + menuTxt);
    } else {
      results[tag] = await measureChip(p); checkRow(results[tag], tag);
      await shotChip(p, 'chip-' + tag);
      await p.screenshot({ path: path.join(SHOTS, 'ai-chart-' + tag + '.png') });
    }
    ok(!errs.some((e) => /ai-agent|stkai/i.test(e)), tag + ': no page errors from the AI module' + (errs.length ? ' (others: ' + errs.slice(0, 2).join(' / ') + ')' : ''));
    await ctx.close();
  }
  async function shotChip(p, name) {
    const box = await p.evaluate(() => { const b = document.getElementById('stkai-chip').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    await p.screenshot({ path: path.join(SHOTS, name + '.png'), clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 16), width: Math.min(box.w + 32, 1400), height: box.h + 32 } });
  }
  fs.writeFileSync(path.join(SHOTS, 'chip-measure.json'), JSON.stringify(results, null, 1));
  await b.close();
  console.log('\n' + (n - fails) + ' passed, ' + fails + ' failed. Shots: ' + SHOTS);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed: ' + (e.stack || e)); process.exit(1); });
