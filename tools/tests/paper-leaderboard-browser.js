// Paper trading LEADERBOARD browser test (2026-10-14, step B of "Paper trading leaderboard +
// trade review"). Offline: Firebase is the rich stub (member u1). The leaderboards/paper-* docs
// are fixtures built by the REAL function code (functions-src/paperLeaderboard.js build()) so the
// page is tested against the exact shape the scheduled job writes; the opt-in profile doc
// students/u1/paperTrading/public is recorded in localStorage.
//
//   leaderboard.html 1280 + 390: disclaimer, period tabs, top rows, "You" row + "Your rank",
//     a high-leverage flag, the month tab, no sideways overflow, no console errors
//   paper-review.html 1280 + 390: the opt-in card is OFF by default; a bad name (email) is
//     refused client-side; joining writes ONLY { optIn, displayName, updatedAt }; leaving writes
//     optIn false; the "View leaderboard" link
//   sidebar (1280) and the phone More sheet (390) list "Paper leaderboard"
//
//   flock /tmp/stryker-chrome.lock node tools/tests/paper-leaderboard-browser.js [shotsDir]
const http = require('http');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { launch, ROOT } = require('./lib.js');
const stub = require('./richstub.js');

// ---- load the real function build() with the SDKs stubbed ----
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { if (req === 'firebase-functions/v1' || req === 'firebase-admin') return req; return origResolve.call(this, req, ...a); };
const chain = { region() { return chain; }, runWith() { return chain; }, pubsub: { schedule() { return { timeZone() { return { onRun(fn) { return fn; } }; } }; } } };
require.cache['firebase-functions/v1'] = { id: 'f', filename: 'f', loaded: true, exports: chain };
require.cache['firebase-admin'] = { id: 'a', filename: 'a', loaded: true, exports: { apps: [1], initializeApp() {}, firestore: { FieldValue: {} } } };
const LB = require(path.join(ROOT, 'functions-src', 'paperLeaderboard.js'))._paperLeaderboardTest;

const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOW = Date.now(), DAY = 86400000, RESET = NOW - 90 * DAY;

function tr(i, pnl, lev) {
  const exitAt = NOW - 3600000 - i * 60000;
  return { id: i, symbol: 'futures:NQ1!', side: 'buy', qty: 1, entry: 100, exit: 100 + pnl, pnl, fees: 0, pointValue: 1, entryAt: exitAt - 600000, exitAt, run: RESET, lev: lev || 2 };
}
function member(uid, name, pnls, lev) { return { uid, displayName: name, state: { startBalance: 100000, resetAt: RESET, trades: pnls.map((p, i) => tr(i, p, lev)) } }; }
const ten = (x) => Array.from({ length: 10 }, (_, i) => (i % 3 === 2 ? -Math.round(x * 0.6) : x));   // 7 wins, 3 losses
const MEMBERS = [];
const NAMES = ['Kestrel', 'Nadia R', 'Tom_88', 'Priya', 'Long Wick', 'J. Okafor', 'Sam', 'Ivy Chen'];
NAMES.forEach((n, i) => MEMBERS.push(member('m' + i, n, ten(400 - i * 45), i === 1 ? 35 : 2)));
MEMBERS.push(member('u1', 'Test Trader', ten(120)));                      // the signed-in stub member
MEMBERS.push(member('late', 'Newbie', [50, 50, -20]));                      // unranked (3 trades)
const BOARD = LB.build(MEMBERS, NOW);
for (const k of Object.keys(BOARD)) BOARD[k].generatedAt = null;
const U1KEY = LB.keyOf('u1');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp', '.ico': 'image/x-icon' };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const u = new URL(req.url, 'http://x');
      let p = path.join(ROOT, decodeURIComponent(u.pathname));
      if (!p.startsWith(ROOT)) { rsp.writeHead(403); rsp.end(); return; }
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html';
      if (!fs.existsSync(p)) { rsp.writeHead(404); rsp.end('nf'); return; }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

// leaderboards/* fixtures + the opt-in profile recorder (localStorage '__test_pub')
const RECORDER = ([board]) => {
  try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
  const fb = window.firebase; if (!fb) return;
  const orig = fb.firestore;
  const wrapD = (d, p) => {
    const w = Object.assign({}, d, { collection: (sub) => wrapC(d.collection(sub), p + '/' + sub) });
    let m = /^leaderboards\/paper-(week|month|all)$/.exec(p);
    if (m) { const doc = board[m[1]]; w.get = () => Promise.resolve({ id: 'paper-' + m[1], exists: !!doc, data: () => JSON.parse(JSON.stringify(doc)) }); w.set = () => Promise.reject(new Error('permission-denied')); }
    if (/\/paperTrading\/public$/.test(p)) {
      w.get = () => { const s = localStorage.getItem('__test_pub'); return Promise.resolve({ id: 'public', exists: !!s, data: () => (s ? JSON.parse(s) : {}) }); };
      w.set = (data) => { localStorage.setItem('__test_pub', JSON.stringify(Object.assign({}, data, { updatedAt: data.updatedAt ? 'serverTimestamp' : null, __keys: Object.keys(data).sort() }))); window.__pubWrites = (window.__pubWrites || 0) + 1; return Promise.resolve(); };
    }
    return w;
  };
  const wrapC = (c, p) => Object.assign({}, c, { doc: (id) => wrapD(c.doc(id), p + '/' + (id || 'auto')) });
  const db = Object.assign({}, orig(), { collection: (n) => wrapC(orig().collection(n), n) });
  fb.firestore = Object.assign(() => db, orig);
};

async function newPage(b, vp) {
  const phone = vp.width < 500;
  const ctx = await b.newContext(phone ? { viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : { viewport: vp });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(RECORDER, [BOARD]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  const IGNORE = [/ERR_FAILED|ERR_INTERNET_DISCONNECTED|net::|status of 4|status of 5|Failed to fetch/i, /WebSocket connection to/];
  p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, p, errors, phone };
}
const shot = async (p, name) => { const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('screenshot', f); };
const DISC = /Demo account\. Simulated results, not real trading\. Education only\. Not financial advice\./;

async function boardPage(b, BASE, vp, tag) {
  const { ctx, p, errors, phone } = await newPage(b, vp);
  await p.goto(BASE + '/leaderboard.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.plb-t tbody tr', { timeout: 20000 });
  await sleep(700);
  check(DISC.test(await p.textContent('.pr-disc')), tag + ': disclaimer on the leaderboard');
  const rows = await p.$$eval('.plb-t tbody tr', (trs) => trs.map((tr) => ({ me: tr.classList.contains('plb-me'), cells: [...tr.children].map((td) => td.textContent.trim()) })));
  const want = BOARD.week.rows;
  check(rows.length === want.length && rows[0].cells[1].startsWith(want[0].name), tag + ': week rows = function output (' + rows.length + ', #1 ' + rows[0].cells[1] + ')');
  check(!rows.some((r) => /Newbie/.test(r.cells[1])), tag + ': under 10 trades not ranked');
  const me = rows.find((r) => r.me);
  check(!!me && /Test Trader/.test(me.cells[1]) && /You/.test(me.cells[1]), tag + ': own row highlighted ' + JSON.stringify(me));
  const yours = await p.textContent('.plb-yours');
  check(new RegExp('#' + BOARD.week.ranks[U1KEY].rank + ' of ' + BOARD.week.ranked).test(yours), tag + ': "Your rank" ' + yours.trim());
  check(rows.some((r) => /High leverage/.test(r.cells[1])), tag + ': high-leverage row flagged');
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, tag + ': no sideways overflow (' + over + ' px)');
  const tw = await p.evaluate(() => { const w = document.querySelector('.plb-tw'); return [w.scrollWidth, w.clientWidth]; });
  check(tw[0] <= tw[1] + 1, tag + ': the table fits its box, no clipped column ' + JSON.stringify(tw));
  check(!/@/.test(await p.textContent('.plb-t')), tag + ': no email on the board');
  await shot(p, `leaderboard-${vp.width}.png`);
  await p.click('.pr-kind button[data-period=month]'); await sleep(400);
  check(await p.getAttribute('.pr-kind button[data-period=month]', 'aria-selected') === 'true' && (await p.$$('.plb-t tbody tr')).length === BOARD.month.rows.length, tag + ': month tab loads its doc');
  if (phone) {
    await p.click('[data-nav=more]'); await sleep(500);
    const it = await p.evaluate(() => { const a = document.querySelector('#appnav-sheet a[href="leaderboard"]'); return a ? { t: a.textContent.trim(), on: a.classList.contains('on') } : null; });
    check(!!it && /Paper leaderboard/.test(it.t) && it.on, tag + ': More sheet lists Paper leaderboard (current) ' + JSON.stringify(it));
    await shot(p, `leaderboard-${vp.width}-more.png`);
  } else {
    const side = await p.evaluate(() => { const a = document.querySelector('.sidebar a[href="leaderboard"]'); return a ? { on: a.classList.contains('active'), prev: a.previousElementSibling && a.previousElementSibling.getAttribute('href') } : null; });
    check(!!side && side.on && side.prev === 'paper-review', tag + ': sidebar link after Trade review, active ' + JSON.stringify(side));
  }
  check(errors.length === 0, tag + ': no console errors ' + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}

async function optIn(b, BASE, vp, tag) {
  const { ctx, p, errors } = await newPage(b, vp);
  await p.goto(BASE + '/paper-review.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.plb-card .plb-in', { timeout: 20000 });
  await sleep(500);
  check(/Off/.test(await p.textContent('.plb-pill')) && !(await p.evaluate(() => localStorage.getItem('__test_pub'))), tag + ': opt-in OFF by default, nothing written');
  check(await p.getAttribute('.plb-link', 'href') === 'leaderboard', tag + ': "View leaderboard" link');
  await p.fill('.plb-in', 'me@mail.com'); await p.click('.plb-card .pr-btn-pri'); await sleep(300);
  check(/2-24 characters/.test(await p.textContent('.plb-err')) && !(await p.evaluate(() => window.__pubWrites)), tag + ': email as a name refused, no write');
  await p.fill('.plb-in', '  Test   Trader '); await p.click('.plb-card .pr-btn-pri'); await sleep(600);
  const w = JSON.parse(await p.evaluate(() => localStorage.getItem('__test_pub')));
  check(w && w.optIn === true && w.displayName === 'Test Trader' && JSON.stringify(w.__keys) === JSON.stringify(['displayName', 'optIn', 'updatedAt']) && w.updatedAt === 'serverTimestamp',
    tag + ': join writes only { optIn, displayName, updatedAt } ' + JSON.stringify(w));
  check(/Joined/.test(await p.textContent('.plb-pill')), tag + ': card shows Joined');
  await shot(p, `leaderboard-optin-${vp.width}.png`);
  await p.click('.plb-leave'); await sleep(600);
  const w2 = JSON.parse(await p.evaluate(() => localStorage.getItem('__test_pub')));
  check(w2.optIn === false && /Off/.test(await p.textContent('.plb-pill')), tag + ': leave writes optIn false');
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, tag + ': no sideways overflow (' + over + ' px)');
  if (vp.width >= 500) {
    const hdr = await p.evaluate(() => [...document.querySelectorAll('.pr-grid .pr-tw')].map((w) => [w.scrollWidth, w.clientWidth, [...w.querySelectorAll('th')].map((t) => t.offsetWidth + ':' + t.textContent).join(' ')]));
    check(hdr.length === 4 && hdr.every((x) => x[0] <= x[1] + 1), tag + ': breakdown table headers fit (no clipped Expectancy column) ' + JSON.stringify(hdr[0]));
  }
  await p.evaluate(() => { const g = document.querySelector('.pr-grid'); if (g) g.scrollIntoView({ block: 'center' }); }); await sleep(300);
  await shot(p, `leaderboard-review-grid-${vp.width}.png`);
  check(errors.length === 0, tag + ': no console errors ' + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}

(async () => {
  const srv = await serve();
  const BASE = `http://127.0.0.1:${srv.address().port}`;
  const b = await launch({ args: ['--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  try {
    await boardPage(b, BASE, { width: 1280, height: 800 }, 'board 1280');
    await boardPage(b, BASE, { width: 390, height: 844 }, 'board 390');
    await optIn(b, BASE, { width: 1280, height: 800 }, 'opt-in 1280');
    await optIn(b, BASE, { width: 390, height: 844 }, 'opt-in 390');
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close(); srv.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
