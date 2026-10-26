// Shared rig for the Backtest replay page suites (replay.html, Owner 2026-10-26 "backtest ui").
// Offline: Firebase is the rich stub (member u1), the replayBars Cloud Function is mocked with a
// deterministic NQ 1-minute random walk, and Lightweight Charts is served from a local copy of the
// exact pinned file (same bytes, so the page's SRI check still passes). Everything else is aborted.
//
//   const R = require('./bt-rig.js'); const srv = await R.serve(); const b = await R.launch();
//   const { p } = await R.page(b, srv, 'phone'); await R.startSession(p);
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launch: rawLaunch, ROOT } = require('./lib.js');
const stub = require('./richstub.js');

const LWC_LOCAL = process.env.LWC_FILE || path.join(process.env.TMPDIR || '/tmp', 'lwc.js');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp', '.ico': 'image/x-icon', '.jpg': 'image/jpeg' };

function serve(root) {
  const R0 = root || ROOT;
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const u = new URL(req.url, 'http://x');
      let p = path.join(R0, decodeURIComponent(u.pathname));
      if (!p.startsWith(R0)) { rsp.writeHead(403); rsp.end(); return; }
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html';
      if (!fs.existsSync(p)) { rsp.writeHead(404); rsp.end('nf'); return; }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => { srv.base = 'http://127.0.0.1:' + srv.address().port; res(srv); });
  });
}

function launch() {
  return rawLaunch({ args: ['--js-flags=--max-old-space-size=600', '--disable-dev-shm-usage'] });
}

// deterministic random walk, one bar per minute, weekdays only (UTC)
function bars(p1, p2) {
  const out = []; let px = 30000; let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const start = Math.floor(p1 / 60) * 60;
  for (let t = start; t <= p2; t += 60) {
    const d = new Date(t * 1000).getUTCDay(); const r1 = rnd(), r2 = rnd(), r3 = rnd();
    if (d === 0 || d === 6) continue;
    const o = px; const c = Math.round((o + (r1 - 0.5) * 12) * 4) / 4;
    const h = Math.max(o, c) + Math.round(r2 * 12) / 4, l = Math.min(o, c) - Math.round(r3 * 12) / 4;
    out.push([t * 1000, o, h, l, c, Math.round(50 + r2 * 400)]); px = c;
  }
  return out;
}

const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' },
  phone412: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }
};

async function page(b, srv, dev, extraInit) {
  const ctx = await b.newContext(Object.assign({ acceptDownloads: true }, DEVICES[dev] || dev));
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
  });
  if (extraInit) await ctx.addInitScript(extraInit);
  await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\/lightweight-charts@5\.2\.1\//, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(LWC_LOCAL) }));
  await ctx.route(/cloudfunctions\.net\/replayBars/, (r) => {
    const u = new URL(r.request().url());
    const body = JSON.stringify({ bars: bars(Number(u.searchParams.get('period1')), Number(u.searchParams.get('period2'))) });
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)(?!cdn\.jsdelivr\.net\/npm\/lightweight)(?!us-central1-strykertrades-e0cd8\.cloudfunctions\.net\/replayBars)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  const IGNORE = [/ERR_FAILED|ERR_INTERNET_DISCONNECTED|net::|status of 4|status of 5|Failed to fetch/i, /WebSocket connection to/];
  p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('dialog', (d) => d.accept(d.defaultValue && d.defaultValue()).catch(() => {}));
  return { ctx, p, errors };
}

// open replay.html?new=1 and start an NQ session 10 days back (1m data from the mock)
async function startSession(p, base, q) {
  await p.goto(base + '/replay.html?new=1' + (q ? '&' + q : ''), { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#rp-start-btn', { state: 'visible', timeout: 20000 });
  await p.evaluate(() => {
    const d = new Date(Date.now() - 10 * 86400000); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() - 1);
    document.getElementById('rp-symbol').value = 'NQ=F'; document.getElementById('rp-start').value = d.toISOString().slice(0, 10);
    document.getElementById('rp-days').value = '7'; document.getElementById('rp-symbol').dispatchEvent(new Event('change'));
  });
  await p.click('#rp-start-btn');
  await p.waitForSelector('#rp-work:not([hidden])', { timeout: 30000 });
  await p.waitForTimeout(800);
}

const overflow = (p) => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
async function shot(p, file) { await p.screenshot({ path: file }); console.log('screenshot', file); }

module.exports = { serve, launch, page, startSession, overflow, shot, bars, DEVICES, ROOT };
