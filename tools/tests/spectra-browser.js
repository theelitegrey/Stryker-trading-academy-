// Spectra browser test: the /spectra page and the Charts right-bar panel.
//   node tools/tests/chart-dev-server.mjs 8093 &
//   flock -w 900 /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8093 node tools/tests/spectra-browser.js [shotsDir]
// /api/zo/board is served from tools/fixtures/zoro/board-*.json (real Cboe chains, Sample data). The "earlier" board for the velocity
// view is the same fixture with a few cells changed by the test (test input only, NOT market data). The QQQ / SPX / GLD fixtures get a
// test futures ratio so the strike -> futures conversion can be checked.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8093';
const OUT = process.argv[2] || '/tmp/spectra-shots';
fs.mkdirSync(OUT, { recursive: true });
const FX = (u) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'zoro', 'board-' + u + '.json')));
const FUT = { SPX: { root: 'ES', ratio: 1.0072 }, QQQ: { root: 'NQ', ratio: 38.61 }, GLD: { root: 'GC', ratio: 11.02 }, SPY: null };
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hits = [];

function board(u, vs) {
  const b = FX(u), now = Math.floor(Date.now() / 1000);
  b.t = now - 12;
  b.fut = FUT[u] ? Object.assign({ price: Math.round(b.spot * FUT[u].ratio * 100) / 100 }, FUT[u]) : null;
  if (vs) {
    const p = JSON.parse(JSON.stringify(b)); p.t = b.t - vs;
    // test changes: the Apex column's biggest cell was half as big, one cell was 3x as big (so it shrank)
    let bi = [0, 0], bv = 0; p.gex.forEach((c, ci) => c.forEach((v, ri) => { if (Math.abs(v) > bv) { bv = Math.abs(v); bi = [ci, ri]; } }));
    p.gex[bi[0]][bi[1]] /= 2; p.gex[0][Math.floor(p.k.length / 2)] = (p.gex[0][Math.floor(p.k.length / 2)] || 1) * 3;
    b.prev = { t: p.t, x: p.x, k: p.k, gex: p.gex, vex: p.vex };
  }
  return b;
}

async function ctxFor(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((theme) => {
    window.__writes = [];
    const t = setInterval(() => { if (window.firebase) { window.firebase.apps = [{}]; clearInterval(t); } }, 1);
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('tz_consent', JSON.stringify({ v: 1, analytics: false, at: Date.now() })); localStorage.setItem('stryker_theme', theme === 'light' ? 'day' : 'night'); } catch (e) {}
    try { document.documentElement.setAttribute('data-theme', theme); } catch (e) { document.addEventListener('DOMContentLoaded', () => document.documentElement.setAttribute('data-theme', theme)); }
    // record every .set() on any doc under students/... (path kept), so the alert writes can be checked
    const wrapD = (d, path) => Object.assign({}, d, { set: (v) => { window.__writes.push({ path, v }); return Promise.resolve(); }, collection: (c) => wrapC(d.collection(c), path + '/' + c) });
    const wrapC = (c, path) => Object.assign({}, c, { doc: (id) => wrapD(c.doc(id), path + '/' + (id || 'auto')) });
    const hook = setInterval(() => { const d = window.__stubDb; if (!d || d.__spy) return; d.__spy = 1; const col = d.collection; d.collection = (p) => wrapC(col(p), p); clearInterval(hook); }, 1);
    window.__toasts = []; const st = setInterval(() => { if (window.showToast && !window.showToast.__spy) { const o = window.showToast; window.showToast = function (a, b) { window.__toasts.push(String(b || a)); return o.apply(this, arguments); }; window.showToast.__spy = 1; } }, 20);
  }, theme || 'dark');
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/\/api\/chart\/rt$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"admin":false,"l2":false}' }));
  await ctx.route(/\/api\/zo\/board/, (r) => {
    const q = new URL(r.request().url()).searchParams, u = q.get('u'), vs = Number(q.get('vs') || 0);
    hits.push({ u, vs, auth: r.request().headers().authorization || '' });
    if (!['SPX', 'SPY', 'QQQ', 'GLD'].includes(u)) return r.fulfill({ status: 400, body: '{}' });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Object.assign({ notice: 'Education only. Not financial advice.' }, board(u, vs))) });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|WebSocket|CORS|econ-calendar|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, p, errors };
}

const boardState = (p, sel) => p.evaluate((sel) => {
  const root = document.querySelector(sel); if (!root) return null;
  const tds = [...root.querySelectorAll('.spx-board td')];
  const apex = root.querySelector('td.is-apex');
  return { u: (root.querySelector('.spx-tk .on') || {}).textContent, view: root.dataset.view, cols: root.querySelectorAll('.spx-board thead th').length - 1,
    rows: root.querySelectorAll('.spx-board tbody tr').length, apex: root.querySelectorAll('td.is-apex').length, star: root.querySelectorAll('td.is-apex .spx-star').length,
    apexTitle: apex ? apex.title : '', floor: root.querySelectorAll('td.is-floor').length, ceil: root.querySelectorAll('td.is-ceil').length, spot: root.querySelectorAll('tr.spx-spot').length,
    up: root.querySelectorAll('.spx-vel.up').length, dn: root.querySelectorAll('.spx-vel.dn').length, keys: (root.querySelector('.spx-keys') || {}).innerText || '',
    foot: (root.querySelector('.spx-foot') || {}).innerText || '', cells: tds.length, colors: new Set(tds.map((t) => t.style.backgroundColor)).size };
}, sel);

// ALIGNMENT GATE: every control row: shared vertical centre, same heights per role, paddings
const align = (p, sel) => p.evaluate((sel) => {
  const root = document.querySelector(sel), R = (e) => e.getBoundingClientRect();
  // one visual line = controls whose boxes overlap vertically (phone rows wrap on purpose)
  const kidsAll = [...root.querySelectorAll('.spx-bar > .spx-row')].filter((r) => !r.hidden).flatMap((row) => [...row.children].filter((k) => k.offsetParent && !k.classList.contains('spx-list')));
  const lines = [];
  kidsAll.forEach((k) => { const b = R(k), c = { cls: k.className.split(' ').slice(0, 2).join('.'), h: Math.round(b.height * 10) / 10, cy: Math.round((b.top + b.height / 2) * 10) / 10, t: b.top, bt: b.bottom, l: Math.round(b.left), r: Math.round(b.right) };
    const ln = lines.find((L) => L.some((o) => c.t < o.bt - 1 && o.t < c.bt - 1)); if (ln) ln.push(c); else lines.push([c]); });
  const rows = lines.map((L) => { L.sort((a, b) => a.l - b.l); const cys = L.map((c) => c.cy); return { kids: L.map(({ cls, h, cy, l, r }) => ({ cls, h, cy, l, r })), spread: Math.round((Math.max(...cys) - Math.min(...cys)) * 10) / 10, gaps: L.slice(1).map((c, i) => c.l - L[i].r) }; });
  const bar = R(root.querySelector('.spx-bar')), first = R(root.querySelector('.spx-bar > .spx-row'));
  const rb = root.getBoundingClientRect(), tbl = root.querySelector('.spx-board'), cell = root.querySelector('.spx-board td'), head = root.querySelector('.spx-board thead th:nth-child(2)');
  const v = cell ? cell.querySelector('.spx-v') : null;
  const bcs = getComputedStyle(root.querySelector('.spx-bar'));
  return { rows, padL: Math.round(first.left - bar.left), padR: parseFloat(bcs.paddingRight), padRMeasured: Math.round(bar.right - Math.max(...kidsAll.map((k) => R(k).right))),
    padT: Math.round(first.top - bar.top), segH: [...root.querySelectorAll('.spx-bar .spx-seg, .spx-bar .spx-chip, .spx-bar .spx-find')].filter((e) => e.offsetParent).map((e) => Math.round(R(e).height)),
    cellH: cell ? Math.round(R(cell).height) : 0, cellTextOff: cell && v ? Math.round((R(v).top + R(v).height / 2 - (R(cell).top + R(cell).height / 2)) * 10) / 10 : null,
    headH: head ? Math.round(R(head).height) : 0, rootW: Math.round(rb.width), docW: document.documentElement.scrollWidth, winW: window.innerWidth };
}, sel);

async function shot(p, name, clip) { await p.mouse.move(2, 2).catch(() => {}); await sleep(400); await p.screenshot({ path: OUT + '/' + name, clip }); console.log('SHOT ' + OUT + '/' + name); }

async function pageSuite(b, { w, h, mobile, theme, tag, full }) {
  const { ctx, p, errors } = await ctxFor(b, { w, h, mobile, theme });
  await p.goto(BASE + '/spectra.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#spx-root .spx-board td', { timeout: 30000 });
  await sleep(800);
  const S = '#spx-root';
  let st = await boardState(p, S);
  check(st.u === 'SPX' && st.cols >= 4 && st.cols <= 6 && st.rows > 20, tag + ': board SPX, ' + st.cols + ' expiry columns x ' + st.rows + ' strikes');
  check(st.apex === 1 && st.star === 1 && st.floor === 1 && st.ceil === 1 && st.spot === 1, tag + ': one starred Apex, one floor, one ceiling, spot row marked');
  check(/Apex/.test(st.keys) && /Floor/.test(st.keys) && /Ceiling/.test(st.keys), tag + ': key line names Apex / Floor / Ceiling: ' + st.keys.replace(/\n/g, ' | '));
  check(/Updated \d+ s ago/.test(st.foot) && /Education only\. Not financial advice\./.test(st.foot) && !/delayed|behind/i.test(st.foot), tag + ': footer "' + st.foot.replace(/\n/g, ' ') + '"');
  check(st.colors > 10, tag + ': heat colours vary (' + st.colors + ' shades)');
  check(hits.some((x) => /^Bearer /.test(x.auth)), tag + ': board request carries the member token');
  const a = await align(p, S);
  check(a.rows.every((r) => r.spread <= 1), tag + ': ALIGN control rows share one vertical centre (spread ' + a.rows.map((r) => r.spread).join(', ') + ' px)', a.rows);
  check(new Set(a.segH).size === 1, tag + ': ALIGN controls one height (' + [...new Set(a.segH)].join(',') + ' px)');
  const pad = mobile ? 12 : 16;
  check(a.padL === pad && a.padR === pad && a.padT === 12, tag + ': ALIGN bar padding left ' + a.padL + ' / right ' + a.padR + ' / top ' + a.padT + ' (want ' + pad + ')');
  check(a.rows.every((r) => r.gaps.every((g) => g === 8 || g === 16)), tag + ': ALIGN gaps between controls 8 / 16 px (' + a.rows.map((r) => r.gaps.join('/')).join(' ; ') + ')');
  check(a.cellTextOff !== null && Math.abs(a.cellTextOff) <= 1, tag + ': ALIGN cell text centred (off ' + a.cellTextOff + ' px), cell ' + a.cellH + ' px, header ' + a.headH + ' px');
  check(a.docW <= a.winW, tag + ': no page-wide horizontal overflow (' + a.docW + ' <= ' + a.winW + ')');
  console.log('ALIGN ' + tag + ' ' + JSON.stringify(a));
  if (full) {
    // GEX -> VEX: the star follows the view
    const g = st.apexTitle;
    await p.click(S + ' .spx-view [data-v="vex"]'); await sleep(300);
    st = await boardState(p, S);
    check(st.view === 'vex' && st.star === 1 && st.apexTitle !== g && /per vol point/.test(st.apexTitle), 'VEX view: star moves with the view (' + st.apexTitle + ')');
    await p.click(S + ' .spx-view [data-v="gex"]'); await sleep(300);
    // velocity
    await p.click(S + ' .spx-velb'); await sleep(900);
    st = await boardState(p, S);
    check(st.up >= 1 && st.dn >= 1 && /growing/.test(st.keys), 'velocity on: grow (' + st.up + ') and shrink (' + st.dn + ') arrows, key says vs time');
    check(hits.some((x) => x.vs === 300), 'velocity asks for the 5m earlier board (vs=300)');
    await p.click(S + ' .spx-win [data-s="3600"]'); await sleep(700);
    check(hits.some((x) => x.vs === 3600), 'velocity window 1h -> vs=3600');
    await shot(p, 'spectra-page-1440-velocity.png');
    await p.click(S + ' .spx-velb'); await sleep(300);
    st = await boardState(p, S); check(st.up + st.dn === 0, 'velocity off: no arrows');
    // right-click menu + node alert
    const td = await p.$(S + ' td.is-apex'); const bb = await td.boundingBox();
    await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2, { button: 'right' }); await sleep(300);
    const menu = await p.evaluate(() => { const m = document.querySelector('#spx-root .spx-menu'); const r = m.getBoundingClientRect(); return { open: !m.hidden, items: [...m.querySelectorAll('[role=menuitem]')].map((x) => x.textContent.trim()), inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; });
    check(menu.open && menu.inView && menu.items.some((t) => /nears/.test(t)) && menu.items.some((t) => /touches/.test(t)) && menu.items.includes('Create'), 'right-click menu: nears / touches / node grows-shrinks (' + menu.items.join(' | ') + ')');
    await shot(p, 'spectra-page-1440-menu.png');
    await p.click(S + ' .spx-menu [data-d="shrink"]'); await p.fill(S + ' .spx-pct input', '30'); await p.click(S + ' .spx-menu [data-a="node"]'); await sleep(400);
    const w1 = await p.evaluate(() => window.__writes.slice());
    const nw = w1.find((x) => /zoroAlerts/.test(x.path));
    check(nw && nw.v.type === 'node_change' && nw.v.p.dir === 'shrink' && nw.v.p.pct === 30 && nw.v.symbol === 'SPX', 'node alert saved to zoroAlerts (' + JSON.stringify(nw && nw.v.p) + ')');
    // price touch alert (page: chartAlerts on the mapped futures)
    await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2, { button: 'right' }); await sleep(200);
    await p.click(S + ' .spx-menu [data-a="touch"]'); await sleep(400);
    const pw = (await p.evaluate(() => window.__writes.slice())).find((x) => /chartAlerts/.test(x.path));
    check(pw && pw.v.symbol === 'futures:ES1!' && pw.v.cond === 'crossing' && pw.v.price > 0, 'touch alert = a crossing alert on ES (' + JSON.stringify(pw && pw.v) + ')');
    // keyboard: Enter opens the menu on the focused cell
    await p.focus(S + ' .spx-scroll'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await sleep(200);
    check(await p.evaluate(() => !document.querySelector('#spx-root .spx-menu').hidden), 'keyboard: arrows + Enter open the alert menu');
    await p.keyboard.press('Escape');
    // tickers: arrow keys on the segmented control, then the search box
    await p.focus(S + ' .spx-tk [data-u="SPX"]'); await p.keyboard.press('ArrowRight'); await sleep(900);
    st = await boardState(p, S); check(st.u === 'SPY' && st.rows > 10, 'arrow key switches SPX -> SPY');
    await p.click(S + ' .spx-find input'); await p.keyboard.type('gl'); await p.keyboard.press('Enter'); await sleep(900);
    st = await boardState(p, S); check(st.u === 'GLD', 'search "gl" + Enter -> GLD');
    await p.click(S + ' .spx-find input'); await p.keyboard.type('qq'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowUp'); await p.keyboard.press('Enter'); await sleep(900);
    st = await boardState(p, S); check(st.u === 'QQQ', 'search + arrow keys + Enter -> QQQ');
    // Trio
    await p.click(S + ' .spx-tab [data-t="trio"]'); await sleep(1200);
    const trio = await p.evaluate(() => ({ badge: (document.querySelector('#spx-root .spx-badge') || {}).textContent, cards: [...document.querySelectorAll('#spx-root .spx-card h3')].map((x) => x.textContent) }));
    check(['Agree', 'Mixed', 'Disagree'].includes(trio.badge) && trio.cards.join() === 'SPX,SPY,QQQ', 'Trio: SPX, SPY, QQQ side by side with an ' + trio.badge + ' badge');
    await shot(p, 'spectra-page-1440-trio-' + theme + '.png');
    await p.click(S + ' .spx-tab [data-t="board"]'); await p.click(S + ' .spx-tk [data-u="SPX"]'); await sleep(900);
  }
  if (mobile) {
    const sc = await p.evaluate(() => { const s = document.querySelector('#spx-root .spx-scroll'); s.scrollLeft = 200; const k = s.querySelector('tbody th.spx-k').getBoundingClientRect(), sb = s.getBoundingClientRect(); return { wide: s.scrollWidth > s.clientWidth, sticky: Math.abs(k.left - sb.left) <= 1, x: s.scrollLeft }; });
    check(sc.wide && sc.x > 0 && sc.sticky, tag + ': board scrolls sideways, strike column stays put');
    await p.evaluate(() => { document.querySelector('#spx-root .spx-scroll').scrollLeft = 0; });
    // long-press opens the menu
    const td = await p.$('#spx-root tr.spx-spot td:nth-child(3)'); await td.evaluate((e) => window.scrollBy(0, e.getBoundingClientRect().top - innerHeight / 2)); await sleep(300); const bb = await td.boundingBox();
    check(await p.evaluate(([x, y]) => !!(document.elementFromPoint(x, y) || {}).closest && !!document.elementFromPoint(x, y).closest('td'), [bb.x + 10, bb.y + 10]), tag + ': long-press target is a visible cell');
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bb.x + 10, y: bb.y + 10 }] }); await sleep(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(200);
    check(await p.evaluate(() => !document.querySelector('#spx-root .spx-menu').hidden), tag + ': long-press opens the alert menu');
    await shot(p, 'spectra-page-' + w + '-' + theme + '-menu.png');
    await p.evaluate(() => document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  }
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot(p, 'spectra-page-' + w + '-' + theme + '.png');
  // alignment crop of the control bar
  const cb = await p.evaluate(() => { const r = document.querySelector('#spx-root .spx-bar').getBoundingClientRect(); const k = document.querySelector('#spx-root .spx-keys').getBoundingClientRect(); return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: Math.min(innerWidth - Math.max(0, r.left - 8), r.width + 16), height: k.bottom - r.top + 16 }; });
  await shot(p, 'spectra-align-' + w + '-' + theme + '.png', cb);
  check(errors.length === 0, tag + ': no console errors', errors);
  await ctx.close();
}

async function chartSuite(b) {
  const { ctx, p, errors } = await ctxFor(b, { w: 1440, h: 900, theme: 'dark' });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.__stkSpectra, null, { timeout: 60000 });
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol('futures:NQ1!'); });
  await sleep(3000);
  await p.waitForSelector('.stksp-railbtn', { timeout: 20000 });
  const rb = await p.evaluate(() => { const b = document.querySelector('.stksp-railbtn'), o = document.querySelector('.stkw-rail .stkw-railbtn:not(.stksp-railbtn)'); const r = b.getBoundingClientRect(), q = o.getBoundingClientRect(), i = b.querySelector('img').getBoundingClientRect(); return { inRail: !!b.closest('.stkw-rail'), w: r.width, h: r.height, ow: q.width, oh: q.height, icx: i.left + i.width / 2 - (r.left + r.width / 2), icy: i.top + i.height / 2 - (r.top + r.height / 2), iw: i.width }; });
  check(rb.inRail && rb.w === rb.ow && rb.h === rb.oh && Math.abs(rb.icx) <= 1 && Math.abs(rb.icy) <= 1 && rb.iw === 20, 'rail button: same size as the other rail buttons, 20 px icon centred (' + JSON.stringify(rb) + ')');
  await p.click('.stksp-railbtn');
  await p.waitForSelector('#stksp .spx-board td', { timeout: 20000 }); await sleep(800);
  let st = await boardState(p, '#stksp .stksp-body');
  check(st.u === 'QQQ' && st.star === 1, 'NQ chart opens Spectra on QQQ with the Apex starred');
  const map = await p.evaluate(() => document.querySelector('#stksp .stksp-map').textContent);
  check(/NQ\s*\u2192\s*QQQ/.test(map), 'panel header shows the mapping "' + map + '"');
  const lay = await p.evaluate(() => { const c = document.querySelector('#vela-chart').getBoundingClientRect(), s = document.querySelector('#stksp').getBoundingClientRect(); return { chartR: Math.round(c.right), panelL: Math.round(s.left), w: Math.round(s.width) }; });
  check(Math.abs(lay.chartR - lay.panelL) <= 1, 'panel sits beside the chart, not over it (chart right ' + lay.chartR + ', panel left ' + lay.panelL + ', width ' + lay.w + ')');
  const hd = await p.evaluate(() => { const h = document.querySelector('#stksp .stksp-hd'), R = (e) => e.getBoundingClientRect(), hb = R(h); return [...h.children].filter((k) => k.offsetParent && k.getBoundingClientRect().width > 0 && !k.classList.contains('stksp-sp')).map((k) => Math.round((R(k).top + R(k).height / 2 - (hb.top + hb.height / 2)) * 10) / 10); });
  check(hd.every((d) => Math.abs(d) <= 1), 'ALIGN panel header items share the header centre (' + hd.join(', ') + ')');
  // click a strike -> the converted NQ price line
  const k = await p.evaluate(() => { const b = document.querySelector('#stksp tr.spx-spot .spx-k button'); b.click(); return Number(b.dataset.k); });
  await sleep(600);
  const fl = await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart, seen = new Set();
    const find = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null; seen.add(o); if (o.nativeData instanceof Map && o.nativeData.has('stk_gexflash')) return o.nativeData.get('stk_gexflash'); for (const kk of Object.keys(o)) { try { const r = find(o[kk], d + 1); if (r) return r; } catch (e) {} } return null; };
    const v = find(c, 0); return v ? JSON.parse(JSON.stringify(v)) : null; });
  const want = Math.round(k * FUT.QQQ.ratio * 100) / 100;
  check(fl && JSON.stringify(fl).includes(String(want)), 'strike ' + k + ' draws the NQ line at ' + want + ' (' + JSON.stringify(fl).slice(0, 160) + ')');
  // VEX + velocity in the panel
  await p.click('#stksp .spx-view [data-v="vex"]'); await sleep(300);
  st = await boardState(p, '#stksp .stksp-body'); check(st.view === 'vex' && st.star === 1, 'panel: VEX view keeps one star');
  await p.click('#stksp .spx-view [data-v="gex"]');
  await p.click('#stksp .spx-velb'); await sleep(900);
  st = await boardState(p, '#stksp .stksp-body'); check(st.up + st.dn > 0, 'panel: velocity arrows (' + st.up + ' up, ' + st.dn + ' down)');
  await p.click('#stksp .spx-velb');
  // right-click -> touch alert goes through the chart's alert list on the chart's own future
  const td = await p.$('#stksp td.is-apex'); const bb = await td.boundingBox();
  await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2, { button: 'right' }); await sleep(300);
  check(await p.evaluate(() => !document.querySelector('#stksp .spx-menu').hidden), 'panel: right-click opens the alert menu');
  await shot(p, 'spectra-chart-1440-menu.png');
  await p.keyboard.press('Escape');
  // the GEX Ladder and Spectra take turns in the same slot
  const glBtn = await p.$('.stkgl-railbtn');
  if (glBtn) { await glBtn.click(); await sleep(500); const s2 = await p.evaluate(() => ({ sp: !document.querySelector('#stksp').hidden, gl: !!(window.__stkGexLadder && window.__stkGexLadder.isOpen) })); check(!s2.sp && s2.gl, 'opening the GEX Ladder closes Spectra (same panel slot)'); await p.click('.stksp-railbtn'); await sleep(600); }
  // ES -> SPX, GC -> GLD
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol('futures:ES1!'); }); await sleep(2500);
  st = await boardState(p, '#stksp .stksp-body'); check(st.u === 'SPX', 'ES chart -> SPX board');
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol('futures:MGC1!'); }); await sleep(2500);
  st = await boardState(p, '#stksp .stksp-body'); check(st.u === 'GLD', 'MGC chart -> GLD board');
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol('futures:NQ1!'); }); await sleep(2500);
  await shot(p, 'spectra-chart-1440-dark.png');
  check(errors.length === 0, 'charts: no console errors', errors);
  await ctx.close();
}

(async () => {
  const b = await launch();
  try {
    const part = process.env.PART || 'all';
    if (part === 'all' || part === 'page') {
      await pageSuite(b, { w: 1440, h: 900, theme: 'dark', tag: 'page 1440 dark', full: true });
      await pageSuite(b, { w: 1440, h: 900, theme: 'light', tag: 'page 1440 light' });
      await pageSuite(b, { w: 390, h: 844, mobile: true, theme: 'dark', tag: 'page 390 dark' });
      await pageSuite(b, { w: 390, h: 844, mobile: true, theme: 'light', tag: 'page 390 light' });
      await pageSuite(b, { w: 412, h: 915, mobile: true, theme: 'dark', tag: 'page 412 dark' });
    }
    if (part === 'all' || part === 'chart') await chartSuite(b);
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  finally { await b.close(); }
  console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
  process.exit(fail ? 1 : 0);
})();
