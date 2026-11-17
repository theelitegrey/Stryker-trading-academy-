// Phantom browser test: the page (phantom.html) and the Charts panel (assets/chart-phantom.js).
//   node tools/tests/chart-dev-server.mjs 8061
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8061 node tools/tests/phantom-browser.js [shotsDir]
// The recorder's /phantom/* and /tide are answered from tools/fixtures/phantom/*.json.gz: REAL Cboe chains for SPX, SPY and QQQ
// (17 Nov 2026, about 28 minutes) run through the real feeder code (tools/tests/phantom-fixtures.py). Dark pool: the stored SPY/QQQ
// fixture parts. Firebase is stubbed (richstub.js, a signed-in member). Checks: cards render with the fixture's own totals, Net impact
// order, board flags, side filter, drilldown, whale filters + saved tab, wording, horizontal overflow, alignment numbers, futures mapping.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061';
const OUT = process.argv[2] || '/tmp';
const FX = path.join(__dirname, '..', 'fixtures', 'phantom');
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fx = (n) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FX, n + '.json.gz'))));
const SUM = fx('summary'), BOARD = {}, MIN = {}, TIDE = {};
for (const u of ['SPX', 'SPY', 'QQQ']) { BOARD[u] = fx('board-' + u); MIN[u] = fx('minutes-' + u); TIDE[u] = fx('tide-' + u); }
const DP = { SPY: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'darkpool-spy-2026-11-06.json'))), QQQ: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'darkpool-qqq-2026-11-06.json'))) };
const BANNED = /\b(live|real-time|realtime|delayed|behind|sweeps?|blocks?|bought at (the )?ask)\b|\btrades?\b(?! journal)/i;

function contractReply(u, keys) {
  const t = [], s = keys.map(() => []);
  for (const [tt, m] of MIN[u]) { if (!keys.some((k) => m[k])) continue; t.push(tt); keys.forEach((k, i) => s[i].push(m[k] || [0, 0])); }
  return { v: 1, u, day: SUM.day, k: keys, t, s, next: null };
}
async function open(b, o) {
  const ctx = await b.newContext({ viewport: { width: o.w, height: o.h }, deviceScaleFactor: o.mobile ? 2 : 1, isMobile: !!o.mobile, hasTouch: !!o.mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((light) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', light ? 'day' : 'night'); localStorage.removeItem('stk_ph_wtabs'); localStorage.setItem('tz_consent', JSON.stringify({ v: 1, essential: true, analytics: false, at: new Date().toISOString() })); } catch (e) {}
  }, !!o.light);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
  const hits = [];
  const J = (r, body, status) => r.fulfill({ status: status || 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-ph-gzip' }, body: JSON.stringify(body) });
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\//, (r) => {
    const u = new URL(r.request().url()), q = u.searchParams, sym = q.get('u');
    hits.push(u.pathname + (sym ? '?u=' + sym : ''));
    if (o.signedOut && u.pathname.startsWith('/phantom/')) return J(r, { error: 'sign_in_required' }, 403);
    if (u.pathname === '/phantom/summary') return J(r, SUM);
    if (u.pathname === '/phantom/days') return J(r, { v: 1, u: sym, days: BOARD[sym] ? [SUM.day] : [] });
    if (u.pathname === '/phantom/board') return BOARD[sym] ? J(r, BOARD[sym]) : r.fulfill({ status: 404, body: 'no data', headers: { 'access-control-allow-origin': '*' } });
    if (u.pathname === '/phantom/contract') return J(r, contractReply(sym, q.get('k').split(',')));
    if (u.pathname === '/tide') return J(r, TIDE[sym] || { days: [] });
    if (u.pathname === '/scan') { const s = (q.get('part') || '').replace('dp_', '').toUpperCase(); return DP[s] ? J(r, DP[s]) : r.fulfill({ status: 404, body: '', headers: { 'access-control-allow-origin': '*' } }); }
    return J(r, []);
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|WebSocket connection/.test(m.text())) errors.push(m.text()); });
  return { ctx, p, errors, hits };
}
async function shot(p, name, clip) { await p.mouse.move(2, 2).catch(() => {}); await sleep(400); const f = path.join(OUT, name); await p.screenshot(clip ? { path: f, clip } : { path: f }); console.log('SHOT ' + f); return f; }
async function fullShot(p, name) { await sleep(300); const f = path.join(OUT, name); await p.screenshot({ path: f, fullPage: true }); console.log('SHOT ' + f); }

// alignment: every row of controls shares one centre, same-role controls one height
const ALIGN = () => {
  const r = (e) => e.getBoundingClientRect(), mid = (e) => r(e).top + r(e).height / 2;
  const out = {};
  const rowOf = (sel) => [...document.querySelectorAll(sel)].filter((e) => r(e).width > 0);
  const bar = rowOf('#ph-syms button');
  out.symH = [...new Set(bar.map((e) => Math.round(r(e).height)))];
  out.symMid = bar.length ? Math.max(...bar.map(mid)) - Math.min(...bar.map(mid)) : 0;
  const ch = [...document.querySelectorAll('.ph .oc-ch')].filter((e) => r(e).width > 0 && r(e).height < 60).map((e) => {
    const kids = [...e.children].filter((k) => r(k).width > 0);
    return kids.length > 1 ? Math.max(...kids.map(mid)) - Math.min(...kids.map(mid)) : 0;
  });
  out.cardHeadMaxOff = Math.max(0, ...ch);
  const seg = rowOf('#ph-sides button'); out.segH = [...new Set(seg.map((e) => Math.round(r(e).height)))];
  const fl = rowOf('.ph-filters .oc-in'); out.filterH = [...new Set(fl.map((e) => Math.round(r(e).height)))];
  const byRow = new Map(); fl.forEach((e) => { const k = Math.round(r(e).top / 20); byRow.set(k, (byRow.get(k) || []).concat(mid(e))); });   // phones: 2 x 2 grid
  out.filterMid = Math.max(0, ...[...byRow.values()].map((m) => Math.max(...m) - Math.min(...m)));
  const fx = fl.map((e) => r(e)); out.filterGapX = fx.length > 1 ? Math.round(fx[1].left - fx[0].right) : 0;
  const tabs = rowOf('#ph-wtabs button'); out.tabH = [...new Set(tabs.map((e) => Math.round(r(e).height)))];
  const imp = rowOf('.ph-imp'); out.impRow = imp.map((b) => { const kids = [...b.children]; return Math.round((Math.max(...kids.map(mid)) - Math.min(...kids.map(mid))) * 10) / 10; });
  const card = document.querySelector('.ph .oc-card'), cs = getComputedStyle(card); out.cardPad = [cs.paddingLeft, cs.paddingRight, cs.paddingTop];
  const af = rowOf('#ph-aform .oc-in, #ph-aform .oc-btn'); out.alertH = [...new Set(af.map((e) => Math.round(r(e).height)))];
  const n = rowOf('.ph-nav > *'); out.tideNavMid = n.length ? Math.round((Math.max(...n.map(mid)) - Math.min(...n.map(mid))) * 10) / 10 : 0;
  return out;
};

async function page(b, tag, o) {
  const { ctx, p, errors, hits } = await open(b, o);
  await p.goto(BASE + '/phantom.html' + (o.q || ''), { waitUntil: 'domcontentloaded' });
  if (o.signedOut) {
    await p.waitForFunction(() => !document.getElementById('ph-lock').hidden, null, { timeout: 15000 }).catch(() => {});
    const t = await p.evaluate(() => document.getElementById('ph-lock').innerText);
    check(/Sign in to open Phantom/.test(t), tag + ': signed out -> sign-in card');
    await shot(p, 'phantom-' + tag + '.png');
    await ctx.close(); return;
  }
  await p.waitForFunction(() => document.querySelector('#ph-board table') && document.querySelector('#ph-impact .ph-imp'), null, { timeout: 20000 }).catch(() => {});
  await sleep(1500);
  // 1. tide: the card's totals equal the fixture's own running total
  const tideD = TIDE.SPX.days[0], sumA = (a) => a.reduce((x, y) => x + y, 0);
  const tt = await p.evaluate(() => [document.getElementById('ph-tcall').textContent, document.getElementById('ph-tput').textContent]);
  const usd = (v) => { const a = Math.abs(v), s = v < 0 ? '−' : v > 0 ? '+' : ''; return s + '$' + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : a.toFixed(0)); };
  check(tt[0] === usd(sumA(tideD.cn)) && tt[1] === usd(sumA(tideD.pn)), tag + ': tide totals ' + tt.join(' / ') + ' = fixture ' + usd(sumA(tideD.cn)) + ' / ' + usd(sumA(tideD.pn)));
  const painted = await p.evaluate(() => { const c = document.getElementById('ph-tide-c'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  check(painted > 2000, tag + ': tide chart painted (' + painted + ' px)');
  // 2. net impact order = calls minus puts from the summary
  const imp = await p.evaluate(() => [...document.querySelectorAll('.ph-imp')].map((b) => b.dataset.u));
  const want = Object.entries(SUM.u).map(([u, x]) => [u, x.tot.cn - x.tot.pn]).sort((a, c) => c[1] - a[1]).map((x) => x[0]);
  check(JSON.stringify(imp) === JSON.stringify(want), tag + ': Net impact order ' + imp.join(',') + ' (no GLD padding)');
  // 3. board
  const bd = await p.evaluate(() => ({ rows: document.querySelectorAll('#ph-board tbody tr').length, cols: document.querySelectorAll('#ph-board thead th').length, vo: document.querySelectorAll('#ph-board .ph-f-vo').length, top: document.querySelectorAll('#ph-board .ph-f-top').length }));
  check(bd.rows > 5 && bd.cols > 2 && bd.top > 0, tag + ': strike flow board ' + bd.rows + ' strikes x ' + (bd.cols - 1) + ' expiries, ' + bd.vo + ' V flags, ' + bd.top + ' $ flags');
  await p.click('#ph-sides [data-s="P"]'); await sleep(300);
  const putOnly = await p.evaluate(() => [...document.querySelectorAll('#ph-board td.ph-c:not(.is-empty)')].every((c) => c.classList.contains('neg')));
  check(putOnly, tag + ': Puts filter -> only put cells');
  await p.click('#ph-sides [data-s="all"]'); await sleep(300);
  const sticky = await p.evaluate(() => { const s = document.querySelector('#ph-board'), th = s.querySelector('tbody th'); s.scrollLeft = 300; const x = th.getBoundingClientRect().left - s.getBoundingClientRect().left; s.scrollLeft = 0; return { x: Math.round(x), pos: getComputedStyle(th).position, over: s.scrollWidth > s.clientWidth }; });
  check(sticky.pos === 'sticky' && (!sticky.over || Math.abs(sticky.x - 1) <= 1), tag + ': first column sticky (' + JSON.stringify(sticky) + ')');
  // 5. whales: list + filters + saved tab
  const wN = await p.evaluate(() => document.querySelectorAll('#ph-wbody tr[data-k]').length);
  const totMoves = Object.values(SUM.u).reduce((a, x) => a + x.moves.length, 0);
  check(wN === Math.min(100, totMoves), tag + ': whale moves listed ' + wN + ' (of ' + totMoves + ')');
  await p.selectOption('#ph-ws', 'P'); await p.selectOption('#ph-wm', '250000'); await sleep(300);
  const wf = await p.evaluate(() => [...document.querySelectorAll('#ph-wbody tr[data-k]')].map((r) => [r.children[4].textContent, r.children[5].textContent]));
  const wantPuts = Object.values(SUM.u).reduce((a, x) => a + x.moves.filter((m) => /P\d{8}$/.test(m[1]) && m[3] >= 250000).length, 0);
  check(wf.length === Math.min(100, wantPuts) && wf.every((r) => r[0] === 'Put'), tag + ': filter puts $250K+ -> ' + wf.length + ' rows (expected ' + wantPuts + ')');
  await p.click('#ph-wsave'); await sleep(300);
  const tabs = await p.evaluate(() => [[...document.querySelectorAll('#ph-wtabs [data-i]')].map((b) => b.textContent), localStorage.getItem('stk_ph_wtabs')]);
  check(tabs[0].length === 2 && /Puts/.test(tabs[0][1]) && /\$250K\+/.test(tabs[0][1]) && /250000/.test(tabs[1]), tag + ': saved filter tab "' + tabs[0][1] + '" (stored)');
  await p.click('#ph-wtabs [data-i="0"]'); await sleep(300);
  check((await p.evaluate(() => document.getElementById('ph-ws').value)) === 'all', tag + ': All tab resets the filter');
  // 6. dark pool (SPX -> SPY prints)
  const dp = await p.evaluate(() => [document.getElementById('ph-dpsym').textContent, document.querySelectorAll('#ph-dp tbody tr').length]);
  check(/SPY/.test(dp[0]) && dp[1] > 0, tag + ': dark pool shows SPY prints for SPX (' + dp[1] + ' rows)');
  // wording + overflow
  const txt = await p.evaluate(() => { const c = document.querySelector('.ph').cloneNode(true); const d = c.querySelector('[aria-labelledby="ph-h6"]'); if (d) d.remove(); return c.innerText + ' ' + document.querySelector('.ph-edu, .oc-edu').innerText; });   // dark pool card = stock prints (allowed wording)
  const bad = txt.match(BANNED);
  check(!bad, tag + ': no banned options wording' + (bad ? ' (found "' + bad[0] + '")' : ''));
  check(/Education only\. Not financial advice\./.test(txt), tag + ': Education only. Not financial advice.');
  check(/Updated \d+ (s|min|h) ago|Session of/.test(await p.evaluate(() => document.getElementById('ph-upd').textContent)), tag + ': "Updated X ago" in the bar');
  const ow = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check(ow.sw <= ow.cw + 1, tag + ': no horizontal page overflow (' + ow.sw + ' <= ' + ow.cw + ')');
  const al = await p.evaluate(ALIGN);
  console.log('ALIGN ' + tag + ' ' + JSON.stringify(al));
  check(al.symMid <= 1 && al.symH.length === 1 && al.cardHeadMaxOff <= 1 && al.filterMid <= 1 && al.filterH.length === 1 && al.tabH.length === 1 && al.impRow.every((v) => v <= 1) && al.alertH.length === 1 && al.tideNavMid <= 1,
    tag + ': alignment (centres within 1px, one height per role)');
  await shot(p, 'phantom-' + tag + '-top.png');
  await fullShot(p, 'phantom-' + tag + '-full.png');
  // 4. drilldown from a board cell (biggest cell)
  await p.evaluate(() => { const bs = [...document.querySelectorAll('#ph-board td.ph-c button')]; bs.sort((a, b) => parseFloat(getComputedStyle(b.parentNode).getPropertyValue('--h')) - parseFloat(getComputedStyle(a.parentNode).getPropertyValue('--h'))); bs[0].click(); });
  await p.waitForFunction(() => document.querySelector('#ph-dbody canvas'), null, { timeout: 10000 }).catch(() => {});
  await sleep(600);
  const dd = await p.evaluate(() => ({ open: !document.getElementById('ph-drill').hidden, n: document.querySelectorAll('#ph-dbody .ph-dc').length, txt: document.getElementById('ph-dbody').innerText, req: (window.__stkPhantom.st.drill || []).map((s) => s.t.length) }));
  check(dd.open && dd.n >= 1 && /Vol\/OI/.test(dd.txt) && /Open interest/.test(dd.txt) && dd.req.some((n) => n > 0), tag + ': drilldown opens: ' + dd.n + ' contract(s), minute bars ' + dd.req.join(','));
  check(/Next morning\u2019s open interest change shows here/.test(dd.txt), tag + ': today -> OI change note (no next session yet)');
  await p.evaluate(() => document.getElementById('ph-drill').scrollIntoView({ block: 'center' })); await sleep(300);
  await shot(p, 'phantom-' + tag + '-drill.png');
  // symbol switch
  await p.click('#ph-syms [data-u="QQQ"]'); await sleep(1500);
  check(hits.includes('/phantom/board?u=QQQ') && hits.includes('/tide?u=QQQ'), tag + ': QQQ requested after picking QQQ');
  check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
  await ctx.close();
}

// ---- Charts panel ---------------------------------------------------------------------------------------------
const waitBars = (p) => p.evaluate(async () => { for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {} } return false; });
const setSym = async (p, sym) => { await p.evaluate((s) => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol(s); }, sym); await sleep(2500); await waitBars(p); await sleep(1200); };
async function charts(b, tag, o) {
  const { ctx, p, errors, hits } = await open(b, o);
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 45000 });
  await waitBars(p);
  await p.waitForFunction(() => window.__stkPhantom && window.__stkPhantom.open, null, { timeout: 20000 }).catch(() => {});
  await setSym(p, 'futures:NQ1!');
  if (o.mobile) {   // phones: panel buttons live in the one-bar More menu (assets/chart-onebar.js)
    check(await p.evaluate(() => !!document.querySelector('.stkph-phonebtn')), tag + ': Phantom phone button exists');
    await p.click('#stkc-more-btn'); await sleep(500);
    const row = p.locator('[data-ob-label="Phantom options flow"]');   // the More list draws labels from data-ob-label (CSS content)
    await row.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    check(await row.isVisible().catch(() => false), tag + ': "Phantom options flow" row in More');
    await row.click();
  } else {
    check(await p.evaluate(() => { const e = document.querySelector('.stkph-railbtn'); return !!e && e.getBoundingClientRect().width > 0; }), tag + ': Phantom rail button visible');
    await p.click('.stkph-railbtn');
  }
  await sleep(2500);
  await p.waitForFunction(() => document.querySelector('#stkph .stkph-tbl'), null, { timeout: 15000 }).catch(() => {});
  const st = await p.evaluate(() => ({ u: window.__stkPhantom.u, sym: document.querySelector('.stkph-sym').textContent, tot: document.querySelector('.stkph-tot') && document.querySelector('.stkph-tot').innerText, rows: document.querySelectorAll('#stkph tbody tr[data-k]').length }));
  check(st.u === 'QQQ' && /NQ → QQQ/.test(st.sym), tag + ': NQ maps to QQQ (' + st.sym + ')');
  check(st.rows > 5 && /Net calls/.test(st.tot || ''), tag + ': panel renders totals + ' + st.rows + ' rows');
  check(hits.includes('/phantom/board?u=QQQ'), tag + ': asked QQQ board');
  if (!o.mobile) {
    const side = await p.evaluate(() => { const c = document.getElementById('vela-chart').getBoundingClientRect(), s = document.getElementById('stkph').getBoundingClientRect(); return { chartRight: Math.round(c.right), panelLeft: Math.round(s.left), w: Math.round(s.width) }; });
    check(side.chartRight <= side.panelLeft + 1, tag + ': side by side, never over the chart (' + JSON.stringify(side) + ')');
    const hd = await p.evaluate(() => { const r = (e) => e.getBoundingClientRect(), kids = [...document.querySelectorAll('.stkph-hd > *')].filter((e) => r(e).width > 0 && !e.classList.contains('stkph-sp')); const m = kids.map((e) => r(e).top + r(e).height / 2); const h = r(document.querySelector('.stkph-hd')); return { off: Math.round((Math.max(...m) - Math.min(...m)) * 10) / 10, h: h.height, padL: Math.round(r(kids[0]).left - h.left), padR: Math.round(h.right - r(kids[kids.length - 1]).right) }; });
    console.log('ALIGN ' + tag + ' header ' + JSON.stringify(hd));
    check(hd.off <= 1, tag + ': panel header items share one centre (' + hd.off + 'px)');
  }
  await shot(p, 'phantom-panel-' + tag + '-nq.png');
  await setSym(p, 'futures:ES1!'); await sleep(2000);
  const es = await p.evaluate(() => [window.__stkPhantom.u, document.querySelector('.stkph-sym').textContent]);
  check(es[0] === 'SPX' && /ES → SPX/.test(es[1]), tag + ': ES maps to SPX (' + es[1] + ')');
  await setSym(p, 'crypto:BTCUSDT'); await sleep(1500);
  const bt = await p.evaluate(() => [window.__stkPhantom.u, document.querySelector('#stkph .stkph-note') && document.querySelector('#stkph .stkph-note').textContent]);
  check(bt[0] === null && /covers SPX, SPY, QQQ and GLD/.test(bt[1] || ''), tag + ': BTC -> not covered note');
  const txt = await p.evaluate(() => document.getElementById('stkph').innerText);
  check(!BANNED.test(txt) && /Education only\. Not financial advice\./.test(txt), tag + ': panel wording');
  check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
  await ctx.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const only = process.env.PH_ONLY || '';   // 'page' | 'charts' (the full run is long on a small server)
    if (only !== 'charts') {
      await page(b, '1440-dark', { w: 1440, h: 900 });
      await page(b, '1440-light', { w: 1440, h: 900, light: true });
      await page(b, '390-dark', { w: 390, h: 844, mobile: true });
      await page(b, '412-dark', { w: 412, h: 915, mobile: true });
      await page(b, '390-signedout', { w: 390, h: 844, mobile: true, signedOut: true });
    }
    if (only !== 'page') {
      await charts(b, '1440-dark', { w: 1440, h: 900 });
      await charts(b, '1440-light', { w: 1440, h: 900, light: true });
      await charts(b, '390-dark', { w: 390, h: 844, mobile: true });
    }
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
