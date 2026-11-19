// Zscript engine in every browser engine we can launch: Chromium, Firefox, WebKit (Safari).
//   node tools/tests/zs-engine-browsers.js [shotsDir]
// Member bug 19 Nov: the editor said "The Zscript engine did not load" on Firefox and Safari. The cause
// was the worker's own CSP in _headers (worker-src 'none' blocks the worker itself there; Chromium
// ignores it). Chromium-only tests could not see it, so this one serves the site WITH the _headers
// worker CSP and checks, per browser:
//   1. ZsRunner compiles a sample script in the sandboxed worker (and a bad one gives a line:col error);
//   2. charts.html (signed in, Firebase stubbed): the Zscript editor opens and shows "Compiled OK";
//   3. a broken engine shows the real reason ("Details: ...") and a Retry button that recovers.
// Browsers that are not installed are skipped with a note (install: node node_modules/playwright-core/cli.js
// install firefox webkit). Pages from other hosts are blocked; no network needed.
const http = require('http');
const fs = require('fs');
const path = require('path');
const pw = require('playwright-core');
const { launch, ROOT } = require('./lib.js');
const stub = require('./richstub.js');

const OUT = process.argv[2] || '';
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webp': 'image/webp' };
const h = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
const m = /\/assets\/zs\/worker\.js\n\s+Content-Security-Policy: ([^\n]+)/.exec(h);
if (!m) { console.log('FAIL no worker CSP in _headers'); process.exit(1); }
const CSP = m[1].trim();
let breakEngine = false;   // part 3: the runner 404s until Retry

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (breakEngine && u.pathname === '/assets/zs/runner.js') { res.writeHead(404); res.end(); return; }
  let f = path.join(ROOT, path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, ''));
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  const headers = { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' };
  if (u.pathname === '/assets/zs/worker.js') headers['content-security-policy'] = CSP;
  res.writeHead(200, headers); fs.createReadStream(f).pipe(res);
});

let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('ok  ', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const SAMPLE = '//@zscript 1\nindicator("Sample EMA", overlay=true)\nlen = input.int(9, "Length")\nplot(ta.ema(close, len), "EMA")\n';

async function open(name) {
  try { return name === 'chromium' ? await launch() : await pw[name].launch(); }
  catch (e) { console.log('skip', name, '(' + String(e.message).split('\n')[0].slice(0, 100) + ')'); return null; }
}

async function chartPage(b, base, w, h, mobile) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: !!mobile && b.browserType().name() !== 'firefox', hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_script_lang', 'zs'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const p = await ctx.newPage();
  const warns = [];
  p.on('console', (msg) => { if (/Zscript/.test(msg.text())) warns.push(msg.text()); });
  await p.goto(base + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_ZS, null, { timeout: 90000 });
  return { ctx, p, warns };
}
const headText = (p) => p.evaluate(() => { const x = document.querySelector('#stkc-zs .sed-prob-hd'); return x ? x.textContent : ''; });
const waitHead = (p, re) => p.waitForFunction((src) => { const x = document.querySelector('#stkc-zs .sed-prob-hd'); return x && new RegExp(src).test(x.textContent); }, re.source, { timeout: 60000 }).then(() => true, () => false);

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  let ran = 0;
  try {
    for (const name of ['chromium', 'firefox', 'webkit']) {
      const b = await open(name);
      if (!b) continue;
      ran++;
      try {
        // ---- 1. the runner on its own ----
        const ctx0 = await b.newContext();
        const p0 = await ctx0.newPage();
        await p0.goto(base + '/404.html', { waitUntil: 'domcontentloaded' });
        const r = await p0.evaluate(async (src) => {
          const v = (document.querySelector('meta[name=stryker-build]') || {}).content;
          const { ZsRunner } = await import('/assets/zs/runner.js?v=' + v);
          const run = new ZsRunner();
          try {
            const good = await run.compile(src);
            const bad = await run.compile('//@zscript 1\nindicator("x")\nplot(clse)');
            return { ok: good.ok, title: good.meta && good.meta.title, badCode: bad.diagnostics[0] && bad.diagnostics[0].code, badLine: bad.diagnostics[0] && bad.diagnostics[0].line };
          } catch (e) { return { err: String(e && e.message) }; } finally { run.dispose(); }
        }, SAMPLE);
        ok(r.ok && r.title === 'Sample EMA', name + ': worker compiles a sample script under the shipped worker CSP', r);
        ok(r.badCode === 'E303' && r.badLine === 3, name + ': a typo comes back as a line:col diagnostic', r);
        await ctx0.close();

        // ---- 2. the chart editor, signed in ----
        for (const [w, hh, mob] of [[1440, 900, false], [390, 844, true]]) {
          const { ctx, p, warns } = await chartPage(b, base, w, hh, mob);
          await p.evaluate((src) => window.STRYKER_ZS.open(src, 'Sample EMA'), SAMPLE);
          const good = await waitHead(p, /Compiled OK/);
          ok(good, name + ' ' + w + ': editor compiles the sample ("Compiled OK")', [await headText(p), warns]);
          if (OUT) await p.screenshot({ path: path.join(OUT, `zs-${name}-${w}.png`) });
          await ctx.close();
        }

        // ---- 3. engine fails to load: real reason + Retry recovers ----
        breakEngine = true;
        const { ctx, p, warns } = await chartPage(b, base, 1440, 900);
        await p.evaluate((src) => window.STRYKER_ZS.open(src, 'Sample EMA'), SAMPLE);
        const broke = await waitHead(p, /problem/);
        const msg = await p.evaluate(() => (document.querySelector('#stkc-zs .sed-prob-list') || {}).textContent || '');
        ok(broke && /engine did not load/.test(msg) && /Details: \S/.test(msg), name + ': a load failure shows the real reason', msg);
        ok(warns.some((x) => /engine did not load/.test(x)), name + ': and logs it to the console', warns);
        const btn = await p.$('#stkc-zs .sed-retry');
        ok(!!btn, name + ': Retry button shown under the engine error');
        if (OUT) await p.screenshot({ path: path.join(OUT, `zs-${name}-retry.png`) });
        breakEngine = false;
        if (btn) { await btn.click(); ok(await waitHead(p, /Compiled OK/), name + ': Retry loads the engine and compiles', await headText(p)); }
        await ctx.close();
      } finally { breakEngine = false; await b.close(); }
    }
  } finally { server.close(); }
  ok(ran > 0, 'at least one browser ran');
  console.log(`zs-engine-browsers: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
