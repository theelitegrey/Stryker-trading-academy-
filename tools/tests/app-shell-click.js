// Real clicks: from the app (dashboard), open the phone drawer / More sheet and click through to the changed pages;
// each must land inside the app shell (no marketing header). Stubbed signed-in user.
// node tools/tests/app-shell-click.js   (run under flock /tmp/stryker-chrome.lock)
const fs = require('fs'), path = require('path'), http = require('http');
const { ROOT, launch } = require('./lib.js');
const src = fs.readFileSync(path.join(__dirname, 'app-shell-audit.js'), 'utf8');
const stub = src.slice(src.indexOf('function stubSrc'), src.indexOf('// ---- 3.'));
const stubSrc = new Function(stub + '; return stubSrc;')();
const MT = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html';
  let f = path.join(ROOT, u); if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': MT[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
const fails = []; const ok = (c, t) => { console.log((c ? 'PASS ' : 'FAIL ') + t); if (!c) fails.push(t); };
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await launch();
  const chk = (p) => p.evaluate(() => { const v = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    return { pub: [...document.querySelectorAll('#site-nav, nav.nav')].some(v), top: v(document.querySelector('.mobile-topnav')), side: !!document.querySelector('aside.sidebar'), url: location.pathname }; });
  for (const w of [390, 1440]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 844 } });
    await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.addInitScript(stubSrc(true));
    await ctx.addInitScript(() => { try { localStorage.setItem('stryker_nav_authed', '1'); } catch (e) {} });
    for (const [label, href, via] of [['Suggestions', 'suggestions', 'sheet'], ['Help Center', 'help', 'sheet'], ['Support', 'support', 'sheet'], ['Suggestions', 'suggestions', 'side'], ['Help Center', 'help', 'side']]) {
      const p = await ctx.newPage();
      p.setDefaultTimeout(8000);
      await p.goto(base + '/dashboard-user', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
      let step = 'prepare';
      try {
        const skip = p.locator('#ob-skip:visible');
        if (await skip.count()) { step = 'dismiss onboarding'; await skip.click(); await p.waitForTimeout(250); }
        if (via === 'sheet' && w < 821) {
          step = 'open More sheet'; await p.click('#appnav-more'); await p.waitForTimeout(400);
          step = 'click sheet link'; await p.click('#appnav-sheet a[href*="' + href + '"]');
        } else if (via === 'side') {
          step = 'open side menu'; await p.click('#dash-menu-toggle'); await p.waitForTimeout(400);
          step = 'click side link'; await p.click('aside.sidebar a.side-link[href*="' + href + '"]');
        } else { await p.close(); continue; }
        await p.waitForTimeout(1200);
        const c = await chk(p);
        ok(c.url.indexOf(href) >= 0 && !c.pub && c.side && c.top, w + ' ' + via + ' click ' + label + ' -> ' + JSON.stringify(c));
      } catch (e) {
        const d = await p.evaluate(() => { const b = document.querySelector('#appnav-more'), m = document.querySelector('#dash-menu-toggle'), at = (x) => { if (!x) return null; const r=x.getBoundingClientRect(), hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); return { rect:[r.x,r.y,r.width,r.height], display:getComputedStyle(x).display, hidden:x.hidden, hit:hit && (hit.id || hit.className || hit.tagName) }; }; return { more:at(b), menu:at(m), body:document.body.className, overlays:[...document.querySelectorAll('.access-gate-overlay,.paywall-overlay,.modal-overlay,.ob-modal')].filter(x=>!x.hidden && getComputedStyle(x).display!=='none').map(x=>x.id||x.className) }; });
        ok(false, w + ' ' + via + ' ' + label + ' [' + step + ']: ' + e.message.split('\n')[0] + ' ' + JSON.stringify(d));
      }
      await p.close();
    }
    await ctx.close();
  }
  await b.close(); srv.close(); console.log(fails.length ? 'FAILS ' + fails.length : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
