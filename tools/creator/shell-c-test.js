// c.html shell: signed in = app shell, signed out = public header. Free-plan duplicate label. Chrome under the shared lock.
// node tools/creator/shell-c-test.js <outdir>
const fs = require('fs'), path = require('path'), http = require('http');
let src = fs.readFileSync(__dirname + '/landing-shots.js', 'utf8');
src = src.slice(0, src.indexOf('(async () => {')).replace("process.argv[2] || '/tmp/creators-shots'", "process.argv[2] || '/tmp/creator-c'").replace('const PORT = 8751', 'const PORT = 8773') + '\nmodule.exports = { stubSrc, srv, OUT };';
const m = { exports: {} };
new Function('require', 'module', 'exports', '__dirname', 'process', src)(require, m, m.exports, __dirname, process);
const { stubSrc, srv, OUT } = m.exports; srv.close();
const ROOT = path.resolve(__dirname, '..', '..');
const MT = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const srv2 = http.createServer((q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]); if (u.startsWith('/c/')) u = '/c.html'; if (u === '/') u = '/index.html';
  let f = path.join(ROOT, u); if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': MT[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(8774, '127.0.0.1');
const { launch } = require('../tests/lib.js');
const fails = []; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails.push(t); };
(async () => {
  const b = await launch();
  for (const theme of ['dark', 'light']) for (const [w, h] of [[390, 844], [412, 915], [1440, 900]]) for (const signed of [true, false]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 });
    await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.addInitScript(stubSrc(signed));
    await p.addInitScript((a) => { try { localStorage.setItem('stryker_theme', a[0] === 'light' ? 'day' : 'night'); if (a[1]) localStorage.setItem('stryker_nav_authed', '1'); } catch (e) {} }, [theme, signed]);
    await p.goto('http://127.0.0.1:8774/c/harbor-lane', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2200);
    const c = await p.evaluate(() => { const v = (s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; };
      const prices = [].map.call(document.querySelectorAll('.cx-plan'), (e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 60));
      return { pub: v('#site-nav'), foot: v('footer.cx-pubfoot'), topnav: v('.mobile-topnav'), side: v('aside.sidebar'), dock: v('#appnav-dock'), ov: document.documentElement.scrollWidth > innerWidth + 1, prices }; });
    const exp = signed ? (w < 821 ? c.topnav && c.dock && !c.pub : !c.pub) : (c.pub && !c.topnav && !c.side && !c.dock);
    if (theme === 'dark' || w === 1440) ok(exp && !c.ov, 'c ' + (signed ? 'in' : 'out') + ' ' + w + ' ' + theme + ' ' + JSON.stringify(c).slice(0, 220));
    await p.screenshot({ path: OUT + '/c-' + (signed ? 'signedin' : 'signedout') + '-' + w + '-' + theme + '.png' });
    if (signed && w === 1440 && theme === 'dark') {
      const sb = await p.evaluate(() => !!document.querySelector('aside.sidebar') && getComputedStyle(document.querySelector('aside.sidebar')).display !== 'none');
      ok(sb, 'signed-in desktop has sidebar');
    }
    await ctx.close();
  }
  await b.close(); srv2.close(); console.log(fails.length ? 'FAILS ' + fails.length : 'ALL PASS');
})().catch((e) => { console.error(e); process.exit(1); });
