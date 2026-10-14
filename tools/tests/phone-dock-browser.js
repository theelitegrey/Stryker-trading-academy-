// Phone bottom dock "Option B" (Owner order 2026-10-14; assets/app-nav.js + style.css).
//
// At 390x844 and 430x932, signed in (rich Firebase stub), offline (own static server, every
// non-local request aborted):
//   - dock shows exactly Charts, GEX, Journal, Learn, More, in that order, one row, in the viewport
//   - each of the four links navigates to its page, and that page lights the matching item
//   - More opens the bottom sheet; it lists Home, Trading Floor, Global Monitor, Backtests, Models,
//     Indicators, Market brief, Economic calendar and the account pages (profile, settings,
//     achievements, referrals, support); every item has an icon and a one-line description
//   - the sheet closes on tap outside (scrim), on Escape, on the × button and on a swipe down
//   - on a page that lives in More (/dashboard-user, /global-monitor) More is the active item and
//     the page's row in the sheet is highlighted
//   - NEW dot on Charts before 2026-10-21 end of day IST, gone after (clock faked)
//   - /charts: the chart panel and the paper-trading slim bar (paper switched on) end above the dock
//   - desktop 1440: dock hidden, sheet never built
//   - signed out: no dock (existing auth gating kept)
// Screenshots at 390 (dashboard, charts, gex, More open) go to argv[2].
//
//   flock /tmp/stryker-chrome.lock node tools/tests/phone-dock-browser.js [shotsDir]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launch, ROOT } = require('./lib.js');
const stub = require('./richstub.js');

const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const u = new URL(req.url, 'http://x');
      let p = path.join(ROOT, decodeURIComponent(u.pathname));
      if (!p.startsWith(ROOT)) { rsp.writeHead(403); rsp.end(); return; }
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html'; // Cloudflare-style /charts
      if (!fs.existsSync(p)) { rsp.writeHead(404); rsp.end('nf'); return; }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

const EXPECT = ['Charts', 'GEX', 'Journal', 'Learn', 'More'];
const LINKS = [['charts', /\/charts$/, 'charts'], ['gex', /\/gex$/, 'gex'], ['journal', /\/trade-journal(#.*)?$/, 'journal'], ['learn', /\/courses$/, 'learn']];
const MUST_IN_MORE = ['Home', 'Trading Floor', 'Global Monitor', 'Backtests', 'Models', 'Indicators', 'Market brief', 'Economic calendar', 'Profile', 'Settings', 'Achievements', 'Referrals', 'Support', 'Messages'];

async function ctxFor(b, w, h, signedIn, clockMs) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 800, hasTouch: w < 800 });
  if (signedIn) await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_tour_done', '1'); } catch (e) {} });
  if (!signedIn) await ctx.addInitScript(() => { try { localStorage.removeItem('stryker_nav_authed'); } catch (e) {} window.auth = { onAuthStateChanged: (cb) => { setTimeout(() => cb(null), 10); return () => {}; } }; });
  if (clockMs) await ctx.addInitScript((t) => { const D = Date; const off = t - D.now(); D.now = () => Date.prototype.getTime.call(new D()) + off; }, clockMs);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  return ctx;
}

async function dockState(p) {
  return p.evaluate(() => {
    const d = document.getElementById('appnav-dock');
    const cs = d && getComputedStyle(d);
    const items = [...document.querySelectorAll('#appnav-dock .appnav-dk')];
    const r = d ? d.getBoundingClientRect() : null;
    const ir = items.map((i) => i.getBoundingClientRect());
    return {
      shown: !!d && cs.display !== 'none' && r.height > 0,
      top: r && r.top, bottom: r && r.bottom, vh: innerHeight,
      labels: items.map((i) => i.querySelector('.appnav-dkl').textContent.trim()),
      on: items.filter((i) => i.classList.contains('on')).map((i) => i.dataset.nav),
      oneRow: ir.length ? ir.every((x) => Math.abs(x.top - ir[0].top) < 2) : false,
      inView: ir.every((x) => x.left >= 0 && x.right <= innerWidth + 0.5),
      font: items[0] ? getComputedStyle(items[0].querySelector('.appnav-dkl')).fontFamily : '',
      onColor: (() => { const o = document.querySelector('#appnav-dock .appnav-dk.on'); return o ? getComputedStyle(o).color : ''; })(),
      offColor: (() => { const o = document.querySelector('#appnav-dock .appnav-dk:not(.on)'); return o ? getComputedStyle(o).color : ''; })(),
      newDot: (() => { const n = document.querySelector('#appnav-dock .appnav-new'); return !!(n && getComputedStyle(n).display !== 'none'); })(),
      docW: document.documentElement.scrollWidth
    };
  });
}

async function sheetOpen(p) {
  return p.evaluate(() => { const s = document.getElementById('appnav-sheet'); return !!(s && !s.hidden && s.classList.contains('open')); });
}
async function waitSheet(p, want) {
  for (let i = 0; i < 30; i++) { if ((await sheetOpen(p)) === want) return true; await sleep(50); }
  return false;
}

async function phone(b, w, h, shots) {
  const tag = `${w}px`;
  const ctx = await ctxFor(b, w, h, true);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(srvBase + '/dashboard-user', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.documentElement.classList.contains('nav-authed'), null, { timeout: 15000 });
  await sleep(1500);
  let s = await dockState(p);
  check(s.shown && s.bottom <= s.vh + 0.5 && s.top < s.vh, `${tag}: dock shown at the bottom (${Math.round(s.top)}-${Math.round(s.bottom)} of ${s.vh})`);
  check(JSON.stringify(s.labels) === JSON.stringify(EXPECT), `${tag}: items in order ${s.labels.join(', ')}`);
  check(s.oneRow && s.inView && s.docW <= w + 1, `${tag}: one row, all inside the viewport, no page overflow (doc ${s.docW})`);
  check(/Archivo/.test(s.font), `${tag}: labels in Archivo (${s.font})`);
  check(JSON.stringify(s.on) === '["more"]', `${tag}: /dashboard-user lights More (${s.on})`);
  check(s.onColor === 'rgb(3, 201, 136)', `${tag}: active colour #03c988 (${s.onColor}), inactive ${s.offColor}`);
  check(s.newDot, `${tag}: NEW dot on Charts before 2026-10-21`);
  if (shots) await p.screenshot({ path: path.join(OUT, `dock-${w}-dashboard.png`) });

  // More sheet: open, contents, highlight, close 4 ways
  await p.click('#appnav-more');
  check(await waitSheet(p, true), `${tag}: More opens the sheet`);
  await sleep(300);
  const sh = await p.evaluate(() => {
    const s = document.getElementById('appnav-sheet');
    const items = [...s.querySelectorAll('.appnav-sh-item')];
    const r = s.getBoundingClientRect(); const body = s.querySelector('.appnav-sh-body');
    return {
      labels: items.map((i) => i.querySelector('.appnav-sh-l').textContent),
      allIconDesc: items.every((i) => i.querySelector('svg') && i.querySelector('.appnav-sh-d').textContent.trim().length > 3),
      on: items.filter((i) => i.classList.contains('on')).map((i) => i.dataset.more),
      top: r.top, bottom: r.bottom, left: r.left, right: r.right,
      expanded: document.getElementById('appnav-more').getAttribute('aria-expanded'),
      scrollable: body.scrollHeight > body.clientHeight,
      sbw: getComputedStyle(body).scrollbarWidth
    };
  });
  const missing = MUST_IN_MORE.filter((l) => !sh.labels.includes(l));
  check(!missing.length, `${tag}: sheet lists ${sh.labels.length} pages incl. all required (missing: ${missing.join(',') || 'none'})`);
  check(sh.allIconDesc, `${tag}: every sheet item has an icon and a one-line description`);
  check(JSON.stringify(sh.on) === '["dashboard-user"]', `${tag}: current page highlighted in the sheet (${sh.on})`);
  check(sh.left >= 0 && sh.right <= w + 0.5 && sh.bottom <= h + 0.5 && sh.top > 40, `${tag}: sheet inside the viewport (${Math.round(sh.top)}-${Math.round(sh.bottom)})`);
  check(sh.expanded === 'true', `${tag}: aria-expanded true while open`);
  if (shots) await p.screenshot({ path: path.join(OUT, `dock-${w}-more-open.png`) });
  if (sh.scrollable && shots) {
    await p.evaluate(() => { document.querySelector('.appnav-sh-body').scrollTop = 9999; });
    await sleep(150);
    await p.screenshot({ path: path.join(OUT, `dock-${w}-more-scrolled.png`) });
    await p.evaluate(() => { document.querySelector('.appnav-sh-body').scrollTop = 0; });
  }

  // tap outside (scrim, above the sheet)
  await p.mouse.click(w / 2, 20);
  check(await waitSheet(p, false), `${tag}: tap outside closes`);
  await sleep(300);
  // Escape
  await p.click('#appnav-more'); await waitSheet(p, true);
  await p.keyboard.press('Escape');
  check(await waitSheet(p, false), `${tag}: Escape closes`);
  await sleep(300);
  // × button
  await p.click('#appnav-more'); await waitSheet(p, true); await sleep(300);
  await p.click('.appnav-sh-x');
  check(await waitSheet(p, false), `${tag}: × closes`);
  await sleep(300);
  // second tap on More (dock stays above the scrim)
  await p.click('#appnav-more'); await waitSheet(p, true); await sleep(300);
  const sd = await p.evaluate(() => ({ sb: document.getElementById('appnav-sheet').getBoundingClientRect().bottom, dt: document.getElementById('appnav-dock').getBoundingClientRect().top }));
  check(Math.abs(sd.sb - sd.dt) <= 1, `${tag}: sheet sits on top of the dock (${Math.round(sd.sb)} vs ${Math.round(sd.dt)})`);
  await p.click('#appnav-more');
  check(await waitSheet(p, false), `${tag}: tapping More again closes`);
  await sleep(300);
  // swipe down on the grip (touch events through CDP)
  await p.click('#appnav-more'); await waitSheet(p, true); await sleep(350);
  const g = await p.evaluate(() => { const r = document.querySelector('.appnav-sh-grip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: g.x, y: g.y }] });
  for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: g.x, y: g.y + i * 25 }] }); await sleep(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check(await waitSheet(p, false), `${tag}: swipe down closes`);
  check(await p.evaluate(() => document.getElementById('appnav-more').getAttribute('aria-expanded')) === 'false', `${tag}: aria-expanded back to false`);
  await sleep(300);

  // a sheet link navigates
  await p.click('#appnav-more'); await waitSheet(p, true); await sleep(300);
  await Promise.all([p.waitForURL(/\/global-monitor$/, { timeout: 10000 }).catch(() => {}), p.click('.appnav-sh-item[data-more="global-monitor"]')]);
  await sleep(1200);
  s = await dockState(p);
  check(/\/global-monitor$/.test(p.url()) && JSON.stringify(s.on) === '["more"]', `${tag}: sheet link -> ${p.url().replace(srvBase, '')}, More active (${s.on})`);

  // each dock link navigates + lights itself
  for (const [key, re, onKey] of LINKS) {
    await Promise.all([p.waitForURL(re, { timeout: 15000 }).catch(() => {}), p.click(`#appnav-dock .appnav-dk[data-nav="${key}"]`)]);
    await p.waitForFunction(() => document.getElementById('appnav-dock'), null, { timeout: 10000 });
    await sleep(key === 'charts' ? 3500 : 1500);
    s = await dockState(p);
    check(re.test(p.url()) && JSON.stringify(s.on) === JSON.stringify([onKey]), `${tag}: ${key} -> ${p.url().replace(srvBase, '')}, active ${s.on}`);
    check(JSON.stringify(s.labels) === JSON.stringify(EXPECT) && s.shown, `${tag}: same dock on ${key}`);
    if (key === 'charts') {
      // chart bottom + paper slim bar must end above the dock
      const en = await p.evaluate(async () => {
        for (let i = 0; i < 60 && !(window.__stkPaper && window.__stkPaper.liveAccount); i++) await new Promise((r) => setTimeout(r, 200));
        if (!window.__stkPaper) return 'no paper module';
        window.__stkPaper.setEnabled(true); return window.__stkPaper.enabled;
      });
      await sleep(1200);
      const ov = await p.evaluate(() => {
        const vis = (e) => e && e.getClientRects().length && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
        const dock = document.getElementById('appnav-dock').getBoundingClientRect();
        const panel = document.querySelector('.stkchart-panel'); const pt = document.getElementById('stkpt');
        const main = document.querySelector('.dash-main');
        return { dockTop: dock.top, panelB: panel && panel.getBoundingClientRect().bottom, pt: vis(pt) ? pt.getBoundingClientRect().bottom : null, ptTop: vis(pt) ? pt.getBoundingClientRect().top : null,
          mainB: main && main.getBoundingClientRect().bottom, docH: document.documentElement.scrollHeight, vh: innerHeight };
      });
      check(en === true, `${tag}: paper trading switched on for the overlap check (${en})`);
      check(ov.panelB != null && ov.panelB <= ov.dockTop + 1, `${tag}: chart panel ends above the dock (${Math.round(ov.panelB)} <= ${Math.round(ov.dockTop)})`);
      check(ov.pt != null && ov.pt <= ov.dockTop + 1, `${tag}: paper slim bar ends above the dock (${ov.ptTop && Math.round(ov.ptTop)}-${ov.pt && Math.round(ov.pt)} <= ${Math.round(ov.dockTop)})`);
      check(ov.docH <= ov.vh + 1, `${tag}: /charts page does not scroll behind the dock (doc ${ov.docH}, vh ${ov.vh})`);
      if (shots) await p.screenshot({ path: path.join(OUT, `dock-${w}-charts.png`) });
    }
    if (key === 'gex' && shots) await p.screenshot({ path: path.join(OUT, `dock-${w}-gex.png`) });
  }
  check(!errs.filter((e) => /app-nav|appnav/.test(e)).length, `${tag}: no app-nav page errors (${errs.slice(0, 2).join(' | ') || 'none'})`);
  await ctx.close();
}

let srvBase;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  srvBase = 'http://127.0.0.1:' + srv.address().port;
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    await phone(b, 390, 844, true);
    await phone(b, 430, 932, false);

    // NEW dot gone after 2026-10-21 (IST end of day)
    {
      const ctx = await ctxFor(b, 390, 844, true, Date.parse('2026-10-22T00:00:00+05:30'));
      const p = await ctx.newPage();
      await p.goto(srvBase + '/courses', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const s = await dockState(p);
      check(!s.newDot && s.shown, 'NEW dot gone on 2026-10-22 IST');
      await ctx.close();
    }
    // desktop: no dock, no sheet
    {
      const ctx = await ctxFor(b, 1440, 900, true);
      const p = await ctx.newPage();
      await p.goto(srvBase + '/dashboard-user', { waitUntil: 'domcontentloaded' });
      await sleep(2000);
      const d = await p.evaluate(() => ({ dock: getComputedStyle(document.getElementById('appnav-dock')).display, sheet: !!document.getElementById('appnav-sheet') }));
      check(d.dock === 'none' && !d.sheet, `1440: dock hidden, sheet not built (${JSON.stringify(d)})`);
      await ctx.close();
    }
    // signed out: dock stays hidden (existing gating)
    {
      const ctx = await ctxFor(b, 390, 844, false);
      const p = await ctx.newPage();
      await p.goto(srvBase + '/courses', { waitUntil: 'domcontentloaded' });
      await sleep(2000);
      const s = await dockState(p);
      check(!s.shown, `signed out 390: no dock (${s.shown})`);
      await ctx.close();
    }
  } finally {
    await b.close();
    srv.close();
  }
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})();
