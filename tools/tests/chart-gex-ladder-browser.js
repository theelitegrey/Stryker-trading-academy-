// GEX Ladder panel browser test (Charts right-bar panel + GEX page tab).
//   node tools/tests/chart-dev-server.mjs 8092
//   flock -w 900 /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8092 node --max-old-space-size=768 tools/tests/chart-gex-ladder-browser.js [shotsDir]
// GEX history = the SYNTHETIC sessions of gex-history-fixture.js (4 weekdays ending today, ET), /api/gex/levels =
// saved real responses. Test input only, NOT market data.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const { session, packed } = require('./gex-history-fixture.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8092';
const OUT = process.argv[2] || '/tmp';
const FIX = path.join(__dirname, 'fixtures', 'gex');
const LV = { SPX: JSON.parse(fs.readFileSync(path.join(FIX, 'SPX-0.json'))), GLD: JSON.parse(fs.readFileSync(path.join(FIX, 'GLD-0.json'))), QQQ: JSON.parse(fs.readFileSync(path.join(FIX, 'QQQ-0.json'))) };
// SPY fixture: SPX / 10 with its own strikes and different values (never the QQQ data)
LV.SPY = (() => { const x = JSON.parse(JSON.stringify(LV.SPX)); const by = new Map();
  x.ladder.forEach((r) => { const k = Math.round(r.strike / 10); const o = by.get(k) || { strike: k, gex: 0, dex: 0, oi: 0 }; o.gex += r.gex * 0.093; o.oi += r.oi; by.set(k, o); });
  x.ladder = [...by.values()].sort((p, q) => q.strike - p.strike); x.spot = Math.round(x.spot / 10 * 100) / 100 + 0.17; x.underlying = 'SPY'; x.net_gex = x.ladder.reduce((t, r) => t + r.gex, 0); delete x.futures; return x; })();
const MUT = { bump: {}, spot: {}, hits: 0, etag304: 0, ageH: 0 };   // test-controlled changes to the served fixture
const trimmed = (name) => { const d = JSON.parse(JSON.stringify(LV[name] || LV.SPX)); const m = MUT.bump[name] || {};
  d.ladder = d.ladder.map((r) => ({ strike: r.strike, gex: r.gex + (m[r.strike] || 0) })); if (MUT.spot[name] != null) d.spot = MUT.spot[name];
  d.fetched_at = Date.now() / 1000 - MUT.ageH * 3600; d.market = Object.assign({}, d.market, { data_ts: Date.now() / 1000 - 7 - MUT.ageH * 3600, state: MUT.ageH ? 'closed' : (d.market || {}).state });
  const MP = { QQQ: 750, SPY: 775, GLD: 365, SPX: 7750 };
  return { underlying: name, spot: d.spot, net_gex: d.net_gex, max_pain: MP[name], zero_gamma: name === 'SPY' ? d.zero_gamma / 10 : d.zero_gamma, call_wall: name === 'SPY' ? d.call_wall / 10 : d.call_wall, put_wall: name === 'SPY' ? d.put_wall / 10 : d.put_wall, fetched_at: d.fetched_at, ladder: d.ladder.map((r) => ({ strike: r.strike, gex: r.gex })), market: d.market }; };
const ladderRoute = (r) => { const u = new URL(r.request().url()); MUT.hits++; const out = {};
  (u.searchParams.get('u') || 'SPX').split(',').forEach((n) => { out[n] = trimmed(n); });
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dte: 0, u: out }) }); };
const OPT = (u) => { const sp = (LV[u] || LV.SPX).spot; return { u, spot: sp, em: [{ k: '0DTE', lo: Math.round(sp * 0.995), hi: Math.round(sp * 1.005), em: sp * 0.005, pct: 0.5, iv: 0.21 }, { k: '1DTE', lo: Math.round(sp * 0.99), hi: Math.round(sp * 1.01), em: sp * 0.01, pct: 1, iv: 0.19 }], atm30: 0.22, pc: { oi: 1.5, vol: 0.9, oi_first: 1.4, vol_first: 0.8 } }; };
const optRoute = (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(OPT(new URL(r.request().url()).searchParams.get('u'))) });
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const etDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
const DAY = etDay(Date.now());
const DAYS = (() => { const out = [DAY]; let t = Date.parse(DAY + 'T12:00:00Z'); while (out.length < 4) { t -= 86400000; if (![0, 6].includes(new Date(t).getUTCDay())) out.push(new Date(t).toISOString().slice(0, 10)); } return out; })();   // newest first
const ALL = (U, d) => DAYS.slice().reverse().flatMap((day) => session(U, d, day));

async function open(b, { w, h, mobile, free, anon }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  // signed-in member = the stub's Firebase app is "initialised" (rt-access then hands out the stub user's token); signed-out = no Firebase app
  await ctx.addInitScript((anon) => { if (!anon) { const t = setInterval(() => { if (window.firebase) { window.firebase.apps = [{}]; window.__stubAuth.onIdTokenChanged = (cb) => { setTimeout(() => cb(window.__stubAuth.currentUser), 10); return () => {}; }; clearInterval(t); } }, 1); } }, !!anon);
  await ctx.addInitScript((free) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker_bar_replay_v1'); localStorage.setItem('stryker.volume', '1'); } catch (e) {}
    if (free) Object.defineProperty(window, 'strykerPlanTier', { configurable: false, get: () => () => Promise.resolve({ free: true }), set() {} });
  }, !!free);
  const hits = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/gex-(history|sessions)/, (r) => {
    const u = new URL(r.request().url()); hits.push({ path: u.pathname, u: u.searchParams.get('u'), from: +u.searchParams.get('from'), to: +u.searchParams.get('to') });
    const U = u.searchParams.get('u'), d = Number(u.searchParams.get('dte'));
    const hdr = { 'access-control-allow-origin': '*' };
    if (u.pathname === '/gex-sessions') {
      const list = U === 'SPX' || U === 'QQQ' ? DAYS.map((day) => { const s = session(U, d, day); return { u: U, d, day, n: s.length, t0: s[0].t, t1: s[s.length - 1].t }; }) : [];
      return r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(list) });
    }
    const from = +u.searchParams.get('from'), to = +u.searchParams.get('to');
    r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(packed(U, d, ALL(U, d).filter((x) => x.t >= from && x.t <= to))) });
  });
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/opt-analytics/, optRoute);
  await ctx.route(/\/api\/chart\/rt$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"admin":false,"l2":false}' }));
  await ctx.route(/\/api\/gex\/ladder/, ladderRoute);
  await ctx.route(/\/api\/gex\/levels\//, (r) => {
    const name = new URL(r.request().url()).pathname.split('/').pop().toUpperCase();
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LV[name] || LV.SPX) });
  });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (/gex ladder/i.test(m.text())) console.log('CONSOLE', m.text().slice(0, 400)); });
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|WebSocket connection|CORS policy|econ-calendar/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.__stkBarReplay, null, { timeout: 45000 });
  await waitBars(p);
  return { ctx, p, errors, hits };
}
const waitBars = (p) => p.evaluate(async () => {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {}
  }
  return false;
});
const setSym = async (p, sym, tf) => { await p.evaluate(([s, tf]) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol(s); if (tf) c.setTimeframe(tf); }, [sym, tf]); await sleep(2500); await waitBars(p); await sleep(2500); };
const gexData = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.context().cells[0].chart, seen = new Set();
  const find = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null; seen.add(o); if (o.nativeData instanceof Map && o.nativeData.has('stk_gex')) return o.nativeData.get('stk_gex'); for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} } return null; };
  return JSON.parse(JSON.stringify(find(c, 0) || null));
});
const tagsOf = (p) => p.evaluate(() => { for (const c of document.querySelectorAll('canvas')) if (c.__stkGexTags) return c.__stkGexTags; return []; });
const noOverlap = (tg) => tg.every((a, i) => tg.every((b, j) => i >= j || a.box.y + a.box.h <= b.box.y || b.box.y + b.box.h <= a.box.y));
const setInputs = (p, o) => p.evaluate((o) => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_gex'); h.setInputs(Object.assign({}, h.inputValues(), o)); window.STRYKER_VELA.context().stateChanged(); }, o);
const addGex = (p, inputs) => p.evaluate((inputs) => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator('stk_gex', { inputs: inputs || {} }); window.STRYKER_VELA.context().stateChanged(); }, inputs || {});
// The fixture levels sit away from today's real bars: widen the price axis (manual scale) so they are in view.
const wide = (p, lo, hi) => p.evaluate(([lo, hi]) => { const R = window.STRYKER_VELA.context().cells[0].chart.renderer.renderer; for (const pane of R.scene.panes.values()) { if (pane.kind === 'price' || pane.id === 'price' || pane.id === 'main') { pane.manualScale = { min: lo, max: hi }; } } R.scheduler.invalidate(4); }, [lo, hi]);
async function shot(p, name) { await p.mouse.move(5, 5).catch(() => {}); await sleep(600); await p.screenshot({ path: OUT + '/' + name }); console.log('SHOT ' + OUT + '/' + name); }

const state = (p) => p.evaluate(() => {
  const root = document.querySelector('#stkgl .stkgl-body') || document.querySelector('#gex-ladder-card .stkgl-body');
  if (!root) return null;
  const cols = [...root.querySelectorAll('.stkgl-col')].map((c) => {
    const l = c.querySelector('.stkgl-list'), rows = [...c.querySelectorAll('.stkgl-row')];
    const sp = c.querySelector('[data-spot]');
    let spotVisible = false;
    if (l && sp) { const a = l.getBoundingClientRect(), b = sp.getBoundingClientRect(); spotVisible = b.top >= a.top - 1 && b.bottom <= a.bottom + 1; }
    return { api: c.dataset.api, shown: c.offsetParent !== null, locked: !!c.querySelector('.stkgl-lock'), pro: !!c.querySelector('.stkgl-pro'), n: rows.length,
      max: rows.filter((r) => r.classList.contains('is-max')).length, maxK: (rows.find((r) => r.classList.contains('is-max')) || {}).dataset ? rows.find((r) => r.classList.contains('is-max')).dataset.k : null,
      spotVisible, head: (c.querySelector('.stkgl-ch') || {}).innerText || '', first: rows[0] && rows[0].innerText.replace(/\n/g, ' '), chips: [...c.querySelectorAll('.stkgl-chip')].map((x) => ({ id: x.className.replace(/.*c-(\w+).*/, '$1'), t: x.innerText.replace(/\s+/g, ' '), tip: x.title })), regime: (c.querySelector('.stkgl-reg') || {}).innerText || '', tags: rows.map((r) => r.dataset.lv ? [r.dataset.k, r.dataset.lv] : null).filter(Boolean), rowH: rows[0] ? rows[0].getBoundingClientRect().height : 0, vis: l ? Math.floor(l.clientHeight / (rows[0] ? rows[0].getBoundingClientRect().height : 1)) : 0, maxBg: (rows.find((r) => r.classList.contains('is-max')) || { style: {} }).style.backgroundColor, spotRows: rows.filter((r) => r.classList.contains('is-spot')).length, lineTop: sp ? sp.style.top : null, apis: null,
      scroll: l ? l.scrollHeight > l.clientHeight : false };
  });
  cols.by = {}; cols.forEach((c) => { cols.by[c.api] = c; });
  return { cols, foot: (root.querySelector('.stkgl-foot') || {}).innerText, tabsVisible: root.querySelector('.stkgl-tabs').offsetParent !== null };
});
const flashData = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart, seen = new Set();
  const find = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null; seen.add(o); if (o.nativeData instanceof Map && o.nativeData.has('stk_gexflash')) return o.nativeData.get('stk_gexflash'); for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} } return null; };
  const v = find(c, 0); return v ? JSON.parse(JSON.stringify(v)) : null; });
const PART = process.env.PART || 'all', want = (x) => PART === 'all' || PART === x;
const poll = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(40); } return null; };

(async () => {
  const b = await launch();
  try {
    let ctx, p, errors, st;
    if (want('a')) {
    // ---- Pro, desktop 1440: Charts panel ----
    ({ ctx, p, errors } = await open(b, { w: 1440, h: 900 }));
    await setSym(p, 'futures:ES1!', '5');
    await p.waitForSelector('.stkgl-railbtn', { timeout: 20000 });
    check(true, 'rail has the GEX Ladder button');
    await p.click('.stkgl-railbtn');
    await p.waitForFunction(() => document.querySelectorAll('#stkgl .stkgl-row').length > 30, null, { timeout: 15000 });
    await sleep(800);
    let st = await state(p);
    check(st.cols.length === 4 && st.cols.every((c) => c.shown && c.n > 10), 'desktop: four columns render side by side (' + st.cols.map((c) => c.api + ':' + c.n).join(' ') + ')');
    const dist = await p.evaluate(() => { const g = (api) => [...document.querySelectorAll('#stkgl .stkgl-col[data-api="' + api + '"] .stkgl-row')].map((r) => r.innerText.replace(/\s+/g, ' ')).join('|'); const sp = (api) => parseFloat(document.querySelector('#stkgl .stkgl-col[data-api="' + api + '"] .stkgl-spot').textContent.replace(/,/g, '')); return { q: g('QQQ'), y: g('SPY'), spx: sp('SPX'), qqq: sp('QQQ'), spy: sp('SPY') }; });
    check(dist.q !== dist.y && Math.abs(dist.spy - dist.spx / 10) < 5, 'SPY column is SPY data (spot ' + dist.spy + ' ~ SPX/10 ' + (dist.spx / 10).toFixed(1) + '), not the QQQ column (' + dist.qqq + ')');
    check(st.cols.every((c) => c.max === 1), 'one biggest strike highlighted per column (' + st.cols.map((c) => c.maxK).join(', ') + ')');
    check(st.cols.every((c) => c.spotVisible), 'spot divider auto-scrolled into view in every column');
    check(st.cols.every((c) => /Net( 0DTE)? [+\u2212]\$/.test(c.head) && /mag [\d,.]+ [+\u2212][\d.]+%/.test(c.head) && /[\d,]+\.\d\d/.test(c.head)), 'header: symbol, spot, "mag <strike> +x.x%", net: ' + st.cols[0].head.replace(/\n/g, ' | '));
    check(st.cols.map((c) => c.api).join() === 'QQQ,SPY,GLD,SPX', 'column order QQQ | SPY | GLD | SPX');
    check(st.cols.every((c) => c.rowH > 0 && c.rowH <= 18 && c.vis >= 26), 'dense rows: ' + st.cols.map((c) => c.rowH + 'px/' + c.vis + ' visible').join(', ') + ' (>=26 visible at 1440x900 under the levels header)');
    check(st.cols.every((c) => c.max === 1 && /236, ?196, ?48/.test(c.maxBg)), 'the biggest |GEX| cell per column is yellow (' + st.cols.map((c) => c.maxBg).join(' ; ') + ')');
    check(st.cols.every((c) => c.spotRows === 1 && c.lineTop), 'spot row marked (arrow) + thin line in every column');
    const cells = await p.evaluate(() => { const col = (api, pick) => { const rs = [...document.querySelectorAll('#stkgl .stkgl-col[data-api="' + api + '"] .stkgl-row:not(.is-max)')]; const f = rs.filter((r) => pick(r)); return f.length ? f[0].style.backgroundColor : null; }; return { pos: col('SPX', (r) => !/\u2212/.test(r.innerText)), neg: col('SPX', (r) => /\u2212/.test(r.innerText)) }; });
    check(cells.pos && cells.neg && cells.pos !== cells.neg, 'positive and negative cells use different colour ramps (' + cells.pos + ' vs ' + cells.neg + ')');
    check(st.cols.every((c) => /[+\u2212]\$[\d.]+[KMB]/.test(c.first || '') || c.n > 0), 'rows show strike + signed dollars: ' + st.cols[0].first);
    check(!/real-time|delayed|behind/i.test(st.foot) && /GEX (updated|live)/.test(st.foot) && /Education only/.test(st.foot), 'wording: "' + st.foot + '"');
    // one shared colour scale: the same $ must give the same colour in any column
    const sh = await p.evaluate(() => { const by = new Map(); document.querySelectorAll('#stkgl .stkgl-row:not(.is-max)').forEach((r) => { const v = r.querySelector('.stkgl-v').textContent; const c = r.style.backgroundColor; if (!by.has(v)) by.set(v, new Set()); by.get(v).add(c); }); return [...by.values()].every((s) => s.size === 1); });
    check(sh, 'shared scale: equal $ values have equal colours across all columns');
    const t1 = await p.evaluate(() => { const l = document.querySelector('#stkgl .stkgl-list'); const t = performance.now(); for (let i = 0; i < 20; i++) { l.scrollTop = (i % 2) * 40; l.getBoundingClientRect(); } return (performance.now() - t) / 20; });
    const rp = await p.evaluate(() => { const g = window.__stkGexLadder; const root = document.querySelector('#stkgl .stkgl-body'); const t = performance.now(); for (let i = 0; i < 10; i++) { g.close(); g.open(); } return (performance.now() - t) / 10; });
    console.log('INFO open/paint avg ' + rp.toFixed(1) + ' ms (incl. cached fetch tick), scroll ' + t1.toFixed(2) + ' ms');
    await sleep(600);
    await shot(p, 'ladder-charts-1440.png');
    // ---- KEY LEVELS: chips in the header, tags on the rows ----
    await sleep(1500);
    st = await state(p);
    const need = ['mp', 'flip', 'cw', 'pw', 'mag', 'em', 'pcoi', 'pcvol', 'iv'];
    check(st.cols.every((c) => need.every((id) => c.chips.some((x) => x.id === id))), 'every column header has the chips: ' + st.cols[0].chips.map((x) => x.t).join(' | '));
    check(st.cols.every((c) => c.chips.every((x) => x.tip && x.tip.length > 25 && !/live|real-time|delayed|behind/i.test(x.tip))), 'every chip has a plain-English one-line tooltip (no forbidden wording)');
    check(st.cols.every((c) => /^Negative gamma \(bigger moves\)$|^Positive gamma \(calmer\)$/.test(c.regime)), 'regime label in plain words: ' + st.cols.map((c) => c.regime).join(' ; '));
    check(st.cols.every((c) => c.chips.find((x) => x.id === 'mp').t.includes('%')), 'Max Pain chip shows distance from spot: ' + st.cols[0].chips.find((x) => x.id === 'mp').t);
    const mpK = { QQQ: 750, SPY: 775, GLD: 365, SPX: 7750 };
    const tagAt = (c, id) => (c.tags.find((t) => t[1].split(' ').includes(id)) || [])[0];
    check(st.cols.every((c) => Math.abs(+tagAt(c, 'mp') - mpK[c.api]) <= 1), 'MP tag sits on the Max Pain strike row (' + st.cols.map((c) => c.api + ':' + tagAt(c, 'mp')).join(' ') + ')');
    check(st.cols.every((c) => ['flip', 'cw', 'pw', 'mag', 'emlo', 'emhi'].every((id) => tagAt(c, id) !== undefined)), 'FLIP / CW / PW / MAG / EM edge tags are on rows in every column');
    const lvPos = await p.evaluate(() => { const o = {}; ['QQQ', 'SPX'].forEach((api) => { const col = document.querySelector('#stkgl .stkgl-col[data-api="' + api + '"]'); const r = col.querySelector('.stkgl-row[data-lv~="cw"]'); const g = (id) => { const e = col.querySelector('.stkgl-row[data-lv~="' + id + '"]'); return e ? +e.dataset.k : null; }; o[api] = { cw: g('cw'), pw: g('pw'), spot: parseFloat(col.querySelector('.stkgl-spot').textContent.replace(/,/g, '')) }; }); return o; });
    check(lvPos.QQQ.cw >= lvPos.QQQ.spot - 1 && lvPos.QQQ.pw <= lvPos.QQQ.spot + 1, 'Call Wall tag above spot, Put Wall tag below (QQQ ' + lvPos.QQQ.cw + ' / ' + lvPos.QQQ.pw + ' vs ' + lvPos.QQQ.spot + ')');
    check(st.cols.every((c) => c.tags.some((t) => /emlo/.test(t[1])) ), 'expected-move edges drawn');
    const faint = await p.evaluate(() => [...document.querySelectorAll('#stkgl .stkgl-t.faint')].every((e) => parseFloat(getComputedStyle(e).opacity) < 0.7));
    check(faint, 'expected-move tags are faint');
    const nofit = await p.evaluate(() => [...document.querySelectorAll('#stkgl .stkgl-lv')].map((e) => { const r = e.getBoundingClientRect(); const c = e.closest('.stkgl-col').getBoundingClientRect(); return r.right <= c.right + 1 && e.scrollWidth <= e.clientWidth + 1; }));
    check(nofit.every(Boolean), 'chips wrap inside each column (no sideways overflow)');
    await shot(p, 'ladder-levels-1440.png');
    // ---- 1 s refresh: a changed value shows up within ~1.5 s, flashes, no scroll jump; spot moves; hidden = paused ----
    {
      const rowTxt = (api, k) => p.evaluate(([api, k]) => { const r = document.querySelector('#stkgl .stkgl-row[data-api="' + api + '"][data-k="' + k + '"]'); return r ? { t: r.querySelector('.stkgl-v').textContent, flash: (/flash-(up|dn)/.exec(r.className) || [''])[0] } : null; }, [api, k]);
      const kq = await p.evaluate(() => { const rs = [...document.querySelectorAll('#stkgl .stkgl-col[data-api="QQQ"] .stkgl-row')]; return +rs[Math.floor(rs.length / 2) + 3].dataset.k; });
      const before = await rowTxt('QQQ', kq);
      await p.evaluate(() => { document.querySelector('#stkgl .stkgl-col[data-api="SPX"] .stkgl-list').scrollTop = 0; });
      await sleep(250);
      const top0 = await p.evaluate(() => document.querySelector('#stkgl .stkgl-col[data-api="SPX"] .stkgl-list').scrollTop);
      const h0 = MUT.hits;
      MUT.bump.QQQ = { [kq]: 9.5e7 }; MUT.spot.SPX = LV.SPX.spot + 6; const t0 = Date.now();
      const seen = await poll(async () => { const v = await rowTxt('QQQ', kq); return v && v.t !== before.t ? v : null; }, 2500);
      const dt = Date.now() - t0;
      check(seen && dt <= 1800, 'changed fixture value (QQQ ' + kq + ': ' + before.t + ' -> ' + (seen && seen.t) + ') appears in ' + dt + ' ms');
      check(seen && /flash-up/.test(seen.flash || ''), 'the changed cell flashes green (' + (seen && seen.flash) + ')');
      const sp1 = await p.evaluate(() => document.querySelector('#stkgl .stkgl-col[data-api="SPX"] .stkgl-spot').textContent);
      check(parseFloat(sp1.replace(/,/g, '')) === Math.round((LV.SPX.spot + 6) * 100) / 100, 'SPX spot header follows the new spot (' + sp1 + ')');
      const top1 = await p.evaluate(() => document.querySelector('#stkgl .stkgl-col[data-api="SPX"] .stkgl-list').scrollTop);
      check(top1 === top0, 'no scroll jump while the user is scrolled away (' + top0 + ' -> ' + top1 + ')');
      const mark = MUT.hits; await sleep(3000);
      const rate = MUT.hits - mark;
      check(rate >= 2 && rate <= 4, 'polls about once a second (' + rate + ' requests in 3 s)');
      await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(300); const hh = MUT.hits; await sleep(3200);
      check(MUT.hits === hh, 'hidden tab: no ladder requests (' + (MUT.hits - hh) + ' in 3.2 s)');
      await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(1500); check(MUT.hits > hh, 'visible again: polling resumes');
      await p.evaluate(() => window.__stkGexLadder.close()); await sleep(300); const hc = MUT.hits; await sleep(2500);
      check(MUT.hits === hc, 'closed: no ladder requests');
      await p.evaluate(() => window.__stkGexLadder.open()); await sleep(1500);
      MUT.bump = {}; MUT.spot = {};
      await sleep(1500);
    }
    // click a strike on an ES chart (SPX column) -> flash line
    const pick = await p.evaluate(() => { const r = [...document.querySelectorAll('#stkgl .stkgl-col[data-api="SPX"] .stkgl-row')][12]; return { k: +r.dataset.k }; });
    await p.click('#stkgl .stkgl-col[data-api="SPX"] .stkgl-row >> nth=12');
    const fl = await poll(() => flashData(p), 1500);
    const es = LV.SPX.futures.ES;
    check(fl && Math.abs(fl.price - (pick.k * es.ratio + es.basis)) < 40 && /SPX/.test(fl.text), 'click SPX strike on ES: flash line at the converted ES price (' + (fl && fl.price) + ' vs ' + (pick.k * es.ratio + es.basis).toFixed(2) + ', "' + (fl && fl.text) + '")');
    await sleep(2800);
    const gone = await flashData(p);
    check(!gone, 'the flash fades out on its own');
    // wrong market: QQQ strike on an ES chart -> no line, a toast
    await p.click('#stkgl .stkgl-col[data-api="QQQ"] .stkgl-row >> nth=12');
    await sleep(300);
    check(!(await flashData(p)), 'QQQ strike on an ES chart draws nothing (toast explains)');
    // NQ chart: QQQ strike converts with the NQ ratio
    await setSym(p, 'futures:NQ1!', '5');
    if (!(await p.evaluate(() => window.__stkGexLadder.isOpen))) await p.click('.stkgl-railbtn');
    await sleep(1200);
    const pq = await p.evaluate(() => +[...document.querySelectorAll('#stkgl .stkgl-col[data-api="QQQ"] .stkgl-row')][10].dataset.k);
    await p.click('#stkgl .stkgl-col[data-api="QQQ"] .stkgl-row >> nth=10');
    const fq = await poll(() => flashData(p), 1500);
    const nq = LV.QQQ.futures.NQ;
    check(fq && Math.abs(fq.price - (pq * nq.ratio + nq.basis)) < 60, 'click QQQ strike on NQ: flash at the NQ price (' + (fq && fq.price) + ' vs ~' + (pq * nq.ratio + nq.basis).toFixed(2) + ')');
    // 19 Nov: rail panels are windows (chart-panel-dock.js): opening News on desktop leaves the ladder open
    await p.click('.stknw-railbtn').catch(() => {});
    await sleep(400);
    check(await p.evaluate(() => window.__stkGexLadder.isOpen && window.__stkNews.isOpen), 'opening News keeps the ladder open (windows)');
    await p.evaluate(() => window.__stkNews.close()); await sleep(300);
    // bar replay: no lookahead -> ladder says so
    await p.evaluate(async (E) => { await window.__stkBarReplay.setStepTf('5'); await window.__stkBarReplay.start(E); }, (session('SPX', 0, DAYS[2])[60].t + 1) * 1000);
    await p.waitForFunction(() => window.__stkBarReplay.state.on && !window.__stkBarReplay.state.busy, null, { timeout: 30000 });
    await sleep(2500);
    const rs = await p.evaluate(() => ({ note: (document.querySelector('#stkgl .stkgl-note') || {}).innerText, rows: document.querySelectorAll('#stkgl .stkgl-row').length }));
    check(/Bar replay/.test(rs.note || '') && rs.rows === 0, 'replay: ladder shows no current-chain strikes (' + rs.note + ')');
    await shot(p, 'ladder-replay-1440.png');
    check(!errors.length, 'no page errors (' + errors.slice(0, 3).join(' | ') + ')');
    await ctx.close();
    }
    if (want('b')) {

    // ---- Signed-out (no Firebase user): a sign-in prompt in EACH of the four columns (never blank), no data request ----
    {
      let c0, p0, e0; ({ ctx: c0, p: p0, errors: e0 } = await open(b, { w: 1440, h: 900, anon: true }));
      const hq = []; p0.on('request', (r) => { if (/api\/gex\/(levels|ladder)/.test(r.url())) hq.push(r.url()); });
      await p0.evaluate(() => window.__stkGexLadder.open());
      await p0.waitForFunction(() => document.querySelectorAll('#stkgl .stkgl-col .stkgl-lock').length === 4, null, { timeout: 15000 }).then(() => check(true, 'signed-out: all four columns show the sign-in prompt'), () => check(false, 'signed-out: sign-in prompt in 4 columns'));
      const a0 = await state(p0);
      const lk = await p0.evaluate(() => [...document.querySelectorAll('#stkgl .stkgl-lock')].map((l) => ({ t: l.innerText.replace(/\s+/g, ' '), href: (l.querySelector('a') || {}).getAttribute && l.querySelector('a').getAttribute('href') })));
      check(lk.length === 4 && lk.every((x) => /Sign in/.test(x.t) && /^login\.html/.test(x.href || '')) && !a0.cols.some((c) => c.pro) && !/Pro/.test(await p0.evaluate(() => document.getElementById('stkgl').innerText)), 'signed-out: prompt says Sign in, links to login.html, no "Pro" wording (' + (lk[0] && lk[0].t) + ')');
      check(!hq.length, 'signed-out: no GEX data request');
      await shot(p0, 'ladder-signedout-1440.png');
      await c0.close();
    }
    // ---- Signed-in free member, desktop: all four columns with rows ----
    ({ ctx, p, errors } = await open(b, { w: 1440, h: 900, free: true }));
    await setSym(p, 'futures:ES1!', '5');
    await p.click('.stkgl-railbtn');
    await p.waitForFunction(() => document.querySelectorAll('#stkgl .stkgl-col').length === 4 && [...document.querySelectorAll('#stkgl .stkgl-col')].every((c) => c.querySelectorAll('.stkgl-row').length > 10), null, { timeout: 15000 });
    await sleep(1800);
    st = await state(p);
    check(st.cols.length === 4 && st.cols.every((c) => c.shown && !c.locked && c.n > 10 && c.chips.length >= 8), 'member: QQQ SPY GLD SPX all show rows + chips (' + st.cols.map((c) => c.api + ':' + c.n).join(' ') + ')');
    const geo = await p.evaluate(() => { const r = [...document.querySelectorAll('#stkgl .stkgl-col')].map((c) => c.getBoundingClientRect()); const pn = document.getElementById('stkgl').getBoundingClientRect(); return { w: r.map((x) => Math.round(x.width)), tops: r.map((x) => Math.round(x.top)), left: Math.round(r[0].left - pn.left), right: Math.round(pn.right - r[3].right), pw: Math.round(pn.width) }; });
    check(geo.tops.every((t) => t === geo.tops[0]) && Math.max(...geo.w) - Math.min(...geo.w) <= 1 && geo.left <= 1 && geo.right <= 1, 'member: 4 equal-width columns fill the panel, no empty space ' + JSON.stringify(geo));
    await shot(p, 'ladder-member-1440.png');
    // ALIGNMENT GATE: per-column header rows share one centre/height, row text centred, equal inner padding
    const al = await p.evaluate(() => { const cs = [...document.querySelectorAll('#stkgl .stkgl-col')]; const r = (e) => e.getBoundingClientRect(); const cy = (e) => Math.round((r(e).top + r(e).height / 2) * 10) / 10;
      return { symCY: cs.map((c) => cy(c.querySelector('.stkgl-sym'))), spotCY: cs.map((c) => cy(c.querySelector('.stkgl-spot'))), headH: cs.map((c) => Math.round(r(c.querySelector('.stkgl-ch')).height)), rowH: cs.map((c) => Math.round(r(c.querySelector('.stkgl-row')).height)),
        padL: cs.map((c) => Math.round(r(c.querySelector('.stkgl-k')).left - r(c).left)), padR: cs.map((c) => Math.round(r(c).right - r(c.querySelector('.stkgl-v')).right)), kvCY: cs.map((c) => { const k = c.querySelector('.stkgl-k'), v = c.querySelector('.stkgl-v'); return Math.abs(cy(k) - cy(v)); }) }; });
    console.log('ALIGN ' + JSON.stringify(al));
    const spread = (a) => Math.max(...a) - Math.min(...a);
    check(spread(al.symCY) <= 1 && spread(al.headH) <= 1 && spread(al.rowH) <= 0 && spread(al.padL) <= 1 && spread(al.padR) <= 1 && al.kvCY.every((x) => x <= 1), 'member: column headers share one centre (+-1px), same head/row heights, equal inner padding, strike and value centred');
    await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); document.body.classList.add('light'); }); await sleep(400); await shot(p, 'ladder-member-light-1440.png'); await p.evaluate(() => { document.documentElement.removeAttribute('data-theme'); document.body.classList.remove('light'); });
    // weekend / market closed: the snapshot is 29 h old; all four columns must still draw the last session
    MUT.ageH = 29; await p.evaluate(() => window.__stkGexLadder.close()); await sleep(300); await p.evaluate(() => window.__stkGexLadder.open());
    await sleep(2500);
    st = await state(p);
    check(st.cols.every((c) => c.n > 10 && !c.locked) && /29 h ago/.test(st.foot || ''), 'weekend: 29 h old data, 4 columns still show rows; footer "' + st.foot + '"');
    MUT.ageH = 0;
    check(!errors.length, 'member: no page errors (' + errors.slice(0, 3).join(' | ') + ')');
    await ctx.close();

    }
    if (want('c')) {
    // ---- Phone 390: sheet with tabs ----
    ({ ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true }));
    await setSym(p, 'futures:ES1!', '5');
    await p.waitForFunction(() => window.__stkGexLadder, null, { timeout: 5000 }).catch(async () => { console.log('DBG', await p.evaluate(() => document.querySelector('.stkgl-phonebtn') ? 'btn' : 'nobtn')); throw new Error('no ladder'); });
    await p.evaluate(() => window.__stkGexLadder.open());
    await p.waitForFunction(() => document.querySelectorAll('#stkgl .stkgl-row').length > 10, null, { timeout: 15000 });
    await sleep(1800);
    st = await state(p);
    check(st.tabsVisible && st.cols.filter((c) => c.shown).length === 1 && st.cols[3].shown, '390: tabs, one column at a time (SPX shown first)');
    check(await p.evaluate(() => [...document.querySelectorAll('#stkgl .stkgl-tab')].map((t) => t.innerText).join()) === 'QQQ,SPY,GLD,SPX', '390: four tabs QQQ SPY GLD SPX');
    check(st.cols[3].spotVisible && st.cols[3].max === 1 && st.cols[3].rowH <= 18, '390: dense rows, spot in view, biggest highlighted');
    const wOk = await p.evaluate(() => { const s = document.getElementById('stkgl').getBoundingClientRect(); const rows = [...document.querySelectorAll('#stkgl .stkgl-row')].slice(0, 20); return s.width <= window.innerWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1 && rows.every((r) => r.scrollWidth <= r.clientWidth + 1); });
    check(wOk, '390: no sideways overflow in the sheet');
    check(st.cols[3].chips.length >= 8 && st.cols[3].tags.length >= 5, '390: chips + row tags render (' + st.cols[3].chips.length + ' chips, ' + st.cols[3].tags.length + ' tagged rows)');
    const chipFit = await p.evaluate(() => { const l = document.querySelector('#stkgl .stkgl-col.is-shown .stkgl-lv'); const h = l.getBoundingClientRect().height, w = l.scrollWidth <= l.clientWidth + 1; return { h, w, fs: parseFloat(getComputedStyle(l.querySelector('.stkgl-chip')).fontSize) }; });
    check(chipFit.w && chipFit.h <= 120 && chipFit.fs >= 9, '390: chips wrap (' + Math.round(chipFit.h) + ' px tall, ' + chipFit.fs + ' px text), readable');
    await shot(p, 'ladder-sheet-spx-390.png');
    await p.click('.stkgl-tab[data-api="QQQ"]'); await sleep(900);
    st = await state(p);
    check(st.cols[0].shown && !st.cols[3].shown && st.cols[0].spotVisible, '390: QQQ tab shows QQQ, centred on spot');
    await shot(p, 'ladder-sheet-qqq-390.png');
    await p.click('#stkgl .stkgl-close'); await sleep(300);
    check(!(await p.evaluate(() => window.__stkGexLadder.isOpen)), '390: close button closes the sheet');
    check(!errors.length, '390: no page errors (' + errors.slice(0, 3).join(' | ') + ')');
    await ctx.close();

    }

    if (want('e')) {
    // ---- Market picker (Owner 2026-11-17): chips in the header, only picked columns drawn + fetched, remembered ----
    const SH = process.env.GEXPICK_SHOTS || OUT;
    const reqs = [];
    const pk = (p, a) => p.click('#stkgl .stkgl-pk[data-pk="' + a + '"]');
    const view = (p) => p.evaluate(() => { const r = (e) => e.getBoundingClientRect(); const pn = r(document.querySelector('#stkgl')); const cs = [...document.querySelectorAll('#stkgl .stkgl-col.is-shown')];
      return { shown: cs.map((c) => c.dataset.api), w: cs.map((c) => Math.round(r(c).width)), panelW: Math.round(pn.width), rows: cs.map((c) => c.querySelectorAll('.stkgl-row').length), on: [...document.querySelectorAll('#stkgl .stkgl-pk.on')].map((b) => b.dataset.pk),
        tabs: [...document.querySelectorAll('#stkgl .stkgl-tab')].filter((t) => t.offsetParent !== null).map((t) => t.dataset.api), foot: document.querySelector('#stkgl .stkgl-foot').innerText }; });
    const align = (p) => p.evaluate(() => { const r = (e) => e.getBoundingClientRect(); const hd = document.querySelector('#stkgl .stkgl-hd'); const items = [...hd.querySelectorAll('.stkgl-title, .stkgl-pk, .stkgl-close')];
      const cy = items.map((e) => Math.round((r(e).top + r(e).height / 2) * 10) / 10); const chips = [...hd.querySelectorAll('.stkgl-pk')]; const gaps = chips.slice(1).map((c, i) => Math.round(r(c).left - r(chips[i]).right));
      return { cy, chipH: chips.map((c) => Math.round(r(c).height)), closeH: Math.round(r(hd.querySelector('.stkgl-close')).height), gaps, right: Math.round(r(hd).right - r(hd.querySelector('.stkgl-close')).right), left: Math.round(r(hd.querySelector('.stkgl-title')).left - r(hd).left), pickRight: Math.round(r(hd.querySelector('.stkpd-dk') && hd.querySelector('.stkpd-dk').offsetWidth ? hd.querySelector('.stkpd-dk') : hd.querySelector('.stkgl-close')).left - r(chips[chips.length - 1]).right), over: hd.scrollWidth > hd.clientWidth + 1 }; });
    ({ ctx, p, errors } = await open(b, { w: 1440, h: 900 }));
    p.on('request', (r) => { if (/api\/gex\/ladder/.test(r.url())) reqs.push(new URL(r.url()).searchParams.get('u')); });
    await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (/^stryker_gexl_sel_/.test(k)) localStorage.removeItem(k); });
    await setSym(p, 'futures:ES1!', '5');
    await p.click('.stkgl-railbtn');
    await p.waitForFunction(() => document.querySelectorAll('#stkgl .stkgl-row').length > 30, null, { timeout: 15000 });
    await sleep(1200);
    let v = await view(p);
    check(v.shown.join() === 'QQQ,SPY,GLD,SPX' && v.on.join() === 'All,QQQ,SPY,GLD,SPX', 'picker: default is All (' + v.on.join(' ') + ')');
    let al = await align(p); console.log('ALIGN-PICK ' + JSON.stringify(al));
    const sp = (a) => Math.max(...a) - Math.min(...a);
    check(sp(al.cy) <= 1 && al.chipH.every((h) => h === al.closeH) && al.gaps.every((g) => g === 4) && al.left === 12 && al.pickRight === 8 && !al.over, 'picker alignment: one centre (+-1), chip height = close height, gaps 4, left 12, gap to close 8');
    await p.screenshot({ path: SH + '/pick-all-1440-dark.png' });
    reqs.length = 0;
    await pk(p, 'All'); await pk(p, 'QQQ'); await pk(p, 'SPY'); await pk(p, 'GLD'); await sleep(300);
    v = await view(p);
    check(v.shown.join() === 'SPX' && v.on.join() === 'SPX', 'pick SPX only: one column (' + v.shown + ')');
    check(Math.abs(v.w[0] - v.panelW) <= 2, 'one column is full panel width (' + v.w[0] + ' of ' + v.panelW + ')');
    await sleep(2500); reqs.length = 0; await sleep(2500);
    check(reqs.length >= 2 && reqs.every((u) => u === 'SPX'), 'only SPX is fetched (' + [...new Set(reqs)].join('|') + ' x' + reqs.length + ')');
    check(!/One colour scale/.test(v.foot), 'single column: no shared-scale note');
    await pk(p, 'SPX'); await sleep(200);
    const sh = await p.evaluate(() => !!document.querySelector('#stkgl .stkgl-pk[data-pk="SPX"].shake'));
    v = await view(p);
    check(v.on.join() === 'SPX' && v.shown.join() === 'SPX' && sh, 'last active chip cannot be turned off (shakes)');
    await p.screenshot({ path: SH + '/pick-1-1440-dark.png' });
    await pk(p, 'QQQ'); await sleep(2500);
    v = await view(p);
    check(v.shown.join() === 'QQQ,SPX' && v.w.every((w) => Math.abs(w - v.panelW / 2) <= 2) && v.rows.every((n) => n > 10) && /One colour scale across all columns shown/.test(v.foot), 'QQQ + SPX: two half-width columns with rows (' + v.w + ')');
    reqs.length = 0; await sleep(2500);
    check(reqs.length >= 2 && reqs.every((u) => u === 'QQQ,SPX'), 'two columns fetch only QQQ,SPX (' + [...new Set(reqs)].join('|') + ')');
    await p.screenshot({ path: SH + '/pick-2-1440-dark.png' });
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.__stkGexLadder, null, { timeout: 45000 });
    await p.evaluate(() => window.__stkGexLadder.open()); await p.waitForFunction(() => document.querySelectorAll('#stkgl .stkgl-row').length > 10, null, { timeout: 15000 }); await sleep(1000);
    v = await view(p);
    check(v.shown.join() === 'QQQ,SPX', 'choice survives reload (' + v.shown + ')');
    await pk(p, 'All'); await sleep(2500);
    v = await view(p);
    check(v.shown.length === 4 && v.on.length === 5 && v.rows.every((n) => n > 10), 'All -> four columns');
    await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); document.body.classList.add('light'); });
    await p.screenshot({ path: SH + '/pick-all-1440-light.png' });
    await pk(p, 'GLD'); await pk(p, 'QQQ'); await pk(p, 'SPY'); await sleep(2000);
    await p.screenshot({ path: SH + '/pick-1-1440-light.png' });
    await pk(p, 'QQQ'); await sleep(2000);
    await p.screenshot({ path: SH + '/pick-2-1440-light.png' });
    check(!errors.length, 'picker: no page errors (' + errors.slice(0, 3).join(' | ') + ')');
    await ctx.close();
    // phone 390: tabs follow the choice
    ({ ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true }));
    await p.evaluate(() => window.__stkGexLadder.open()); await sleep(1500); await pk(p, 'GLD'); await pk(p, 'SPY');
    await p.waitForFunction(() => document.querySelectorAll('#stkgl .stkgl-row').length > 5, null, { timeout: 15000 }); await sleep(1200);
    v = await view(p);
    check(v.tabs.join() === 'QQQ,SPX' && v.shown.join() === 'SPX', '390: tabs follow the choice (' + v.tabs + '), SPX shown');
    al = await align(p); console.log('ALIGN-PICK-390 ' + JSON.stringify(al));
    check(sp(al.cy) <= 1 && al.chipH.every((h) => h === al.closeH) && al.pickRight === 8 && !al.over, '390: header one centre, chip height = close height, no overflow');
    await p.screenshot({ path: SH + '/pick-390-dark.png' });
    await pk(p, 'SPY'); await sleep(800);
    v = await view(p);
    check(v.tabs.join() === 'QQQ,SPY,SPX', '390: adding SPY adds its tab');
    await pk(p, 'SPX'); await pk(p, 'SPY'); await sleep(800);
    v = await view(p);
    check(v.tabs.join() === 'QQQ' && v.shown.join() === 'QQQ', '390: tab list shrinks and the shown tab moves to a picked market (' + v.shown + ')');
    check(!errors.length, '390 picker: no page errors (' + errors.slice(0, 3).join(' | ') + ')');
    await ctx.close();
    }
    if (want('d')) {
    // ---- GEX page tab ----
    for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
      const ctx2 = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await ctx2.addInitScript(stub);
      await ctx2.addInitScript(() => { const t = setInterval(() => { if (window.firebase) { window.firebase.apps = [{}]; window.__stubAuth.onIdTokenChanged = (cb) => { setTimeout(() => cb(window.__stubAuth.currentUser), 10); return () => {}; }; clearInterval(t); } }, 1); });
      await ctx2.route(/\/api\/chart\/rt$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"admin":false,"l2":false}' }));
      await ctx2.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
      await ctx2.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
      await ctx2.route(/book-recorder\.theelitegrey\.workers\.dev\/gex-(history|sessions)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
      await ctx2.route(/book-recorder\.theelitegrey\.workers\.dev\/opt-analytics/, optRoute);
      await ctx2.route(/\/api\/gex\/ladder/, ladderRoute);
      await ctx2.route(/\/api\/gex\/(levels|candles)\//, (r) => { const u = new URL(r.request().url()); if (/candles/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"candles":[]}' }); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LV[u.pathname.split('/').pop().toUpperCase()] || LV.SPX) }); });
      const pg = await ctx2.newPage(); const errs = [];
      pg.on('pageerror', (e) => errs.push(String(e)));
      await pg.goto(BASE + '/gex.html', { waitUntil: 'domcontentloaded' });
      await pg.waitForSelector('.gex-vtab[data-view="ladder"]', { timeout: 25000 });
      await sleep(2500);
      await pg.click('.gex-vtab[data-view="ladder"]');
      await pg.waitForFunction(() => document.querySelectorAll('#gex-ladder-card .stkgl-row').length > 10, null, { timeout: 15000 });
      await sleep(900);
      const s2 = await state(pg);
      const shownN = s2.cols.filter((c) => c.shown).length;
      check(shownN === (mobile ? 1 : 4) && s2.cols.filter((c) => c.shown).every((c) => c.max === 1 && c.spotVisible), 'GEX page ' + w + ': Ladder tab, ' + shownN + ' column(s), biggest marked, spot in view');
      await pg.evaluate(() => { const c = document.getElementById('gex-ladder-card'); window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - (window.innerWidth < 700 ? 60 : 80)); });
      await shot(pg, 'ladder-gexpage-' + w + '.png');
      const nets = await pg.evaluate(() => { const hero = (document.querySelector('#gex-hero .gex-kv b') || {}).textContent; const lad = (document.querySelector('#gex-ladder-card .stkgl-col[data-api="SPX"] .stkgl-net') || {}).textContent; return { hero, lad }; });
      const num = (t) => { const m = /([\u2212-]?)\$?([\d.]+)B/.exec(t || ''); return m ? (m[1] ? '-' : '') + m[2] : ''; };
      check(parseFloat(num(nets.hero)) === parseFloat(num(nets.lad)) && !isNaN(parseFloat(num(nets.lad))), 'GEX page ' + w + ': one Net number: hero ' + nets.hero + ' = ladder ' + nets.lad);
      check(!errs.length, 'GEX page ' + w + ': no page errors (' + errs.slice(0, 2).join(' | ') + ')');
      await ctx2.close();
    }
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
