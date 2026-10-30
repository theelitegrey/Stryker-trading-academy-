// Full-page screenshots of /features/creators at 390, 412, 1440, dark + light. node tools/creator/landing-page-shots.js <outdir>
const http = require('http'), fs = require('fs'), path = require('path');
const { launch } = require('../tests/lib.js');
const ROOT = path.resolve(__dirname, '..', '..'), OUT = process.argv[2] || '/tmp/cl-page'; fs.mkdirSync(OUT, { recursive: true });
const MT = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); let f = path.join(ROOT, u); if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MT[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(8752, '127.0.0.1');
(async () => { const b = await launch();
  for (const w of [390, 412, 1440]) for (const t of ['dark', 'light']) {
    const c = await b.newContext({ viewport: { width: w, height: 900 } });
    await c.route(/gstatic\.com|googleapis|workers\.dev/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    const p = await c.newPage();
    await p.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, t);
    await p.goto('http://127.0.0.1:8752/features/creators', { waitUntil: 'load' }); await p.waitForTimeout(800);
    await p.evaluate(() => document.querySelectorAll('.ft-reveal').forEach((e) => e.classList.add('is-in')));
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } window.scrollTo(0, 0); document.querySelectorAll('img').forEach((i) => { i.loading = 'eager'; }); });
    await p.waitForTimeout(1500);
    const m = await p.evaluate(() => ({ ov: document.documentElement.scrollWidth > innerWidth + 1, btn: [...document.querySelectorAll('.cl-cta .btn')].map((x) => Math.round(x.getBoundingClientRect().height)), cls: 0 }));
    await p.screenshot({ path: OUT + '/page-' + w + '-' + t + '.png', fullPage: true });
    console.log(w, t, JSON.stringify(m)); await c.close(); }
  await b.close(); srv.close(); })().catch((e) => { console.error(e); process.exit(1); });
