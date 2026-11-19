// Electron test of the in-app update banner (run under xvfb-run, from desktop/):
//   TZ_UPDATE_TEST=1 xvfb-run -a node test/update-banner.js [screenshot-dir]
// Starts the app from source (electron .), fires a fake 'update-downloaded' + a fake /app-version.json through the
// TZ_UPDATE_TEST hook in src/main.js, then checks the banner (dark + light, 1440 + 390 wide), X, and the blocking
// minVersion screen. Measures alignment with getBoundingClientRect.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require(process.env.PW_CORE || '/root/projects/stryker-trading-academy/node_modules/playwright-core');

const OUT = process.argv[2] || path.join(__dirname, '..', 'dist', 'shots');
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (name, pass, info) => { if (!pass) fails++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); };

const MEASURE = () => {
  const host = document.querySelector('tz-app-update');
  const sr = host && host.shadowRoot;
  if (!sr) return null;
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height, cy: b.top + b.height / 2, cx: b.left + b.width / 2 }; };
  const bar = sr.querySelector('.bar'), card = sr.querySelector('.card');
  const o = { bar: r(bar), tx: r(sr.querySelector('.tx')), t: r(sr.querySelector('.t')), n: r(sr.querySelector('.n')), p: r(sr.querySelector('.p')),
    x: r(sr.querySelector('.x')), xs: r(sr.querySelector('.x svg')), card: r(card), ov: r(sr.querySelector('.ov')),
    title: (sr.querySelector('.t') || sr.querySelector('h2') || {}).textContent, note: (sr.querySelector('.n') || {}).textContent,
    clipped: [...sr.querySelectorAll('.t,.n,.p,h2,p')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis').length,
    hscroll: document.documentElement.scrollWidth > innerWidth + 1, vw: innerWidth };
  if (o.p) { const pb = sr.querySelector('.p'); const tr = document.createRange(); tr.selectNodeContents(pb); const b = tr.getBoundingClientRect(); o.ptext = { l: b.left - o.p.l, r: o.p.r - b.right, cy: b.top + b.height / 2 }; }
  return o;
};

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-upd-'));
  const app = await electron.launch({ executablePath: require(path.join(__dirname, '..', 'node_modules', 'electron')), cwd: path.join(__dirname, '..'),
    args: [...(process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []), '--user-data-dir=' + userData, '.'],
    env: Object.assign({}, process.env, { TZ_UPDATE_TEST: '1', ELECTRON_ENABLE_LOGGING: '0' }), timeout: 60000 });
  try {
    const page = await app.firstWindow({ timeout: 60000 });
    await page.waitForURL(/tradezoro\.com\/login/, { timeout: 40000 }).catch(() => {});
    await page.waitForLoadState('load');
    await page.waitForTimeout(2500);
    const installed = await app.evaluate(({ app }) => app.getVersion());
    ok('installed version from package.json', installed === '1.1.0', installed);
    const next = '1.2.0';
    const manifest = { windows: { version: next, url: '/dl/TradeZoro-Setup.exe', notes: ['Sample data: update banner inside the app, restart in one click.'], minVersion: '1.0.0' } };

    ok('no banner before an update is downloaded', (await page.evaluate(MEASURE)) === null || !(await page.evaluate(MEASURE)).bar);
    await app.evaluate((e, m) => global.__tzUpdateTest.manifest(m), manifest);
    await app.evaluate((e, v) => global.__tzUpdateTest.ready(v), next);
    await page.waitForTimeout(400);

    const setSize = async (w, h) => { await app.evaluate(({ BrowserWindow }, [w, h]) => { const b = BrowserWindow.getAllWindows()[0]; b.unmaximize(); b.setContentSize(w, h); }, [w, h]); await page.waitForTimeout(500); };
    const theme = async (t) => { await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), t); await page.waitForTimeout(250); };
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await setSize(w, h);
      for (const t of ['dark', 'light']) {
        await theme(t);
        const m = await page.evaluate(MEASURE);
        const tag = w + ' ' + t;
        ok(tag + ': banner shows title + note', m && m.bar && m.title === 'Update ready · v' + next && /Sample data/.test(m.note), m && m.title);
        ok(tag + ': at the top, centred', m.bar.t >= 8 && m.bar.t <= 16 && Math.abs(m.bar.cx - m.vw / 2) <= 1, JSON.stringify({ t: m.bar.t, cx: m.bar.cx, vw: m.vw }));
        ok(tag + ': text, pill and X share one vertical centre', Math.abs(m.tx.cy - m.p.cy) <= 1 && Math.abs(m.p.cy - m.x.cy) <= 1 && Math.abs(m.bar.cy - m.p.cy) <= 1, [m.tx.cy, m.p.cy, m.x.cy, m.bar.cy].map((n) => n.toFixed(1)).join(' '));
        ok(tag + ': X icon centred in its button', Math.abs(m.xs.cx - m.x.cx) <= 1 && Math.abs(m.xs.cy - m.x.cy) <= 1);
        ok(tag + ': pill padding even, label centred', Math.abs(m.ptext.l - m.ptext.r) <= 1 && Math.abs(m.ptext.cy - m.p.cy) <= 1, JSON.stringify(m.ptext));
        // left edge = 3 px border + 16 padding, right = 1 px border + 12 padding (X is a 32 px round target, its glyph sits 6 px in)
        ok(tag + ': even top/bottom padding', Math.abs((m.p.t - m.bar.t) - (m.bar.b - m.p.b)) <= 1 && Math.abs((m.tx.t - m.bar.t) - (m.bar.b - m.tx.b)) <= 1);
        ok(tag + ': gap pill -> X is 12', Math.abs(m.x.l - m.p.r - 12) <= 1, (m.x.l - m.p.r).toFixed(1));
        ok(tag + ': no clipping / no horizontal scroll', m.clipped === 0 && !m.hscroll && m.bar.r <= m.vw - 15 && m.bar.l >= 15);
        await page.screenshot({ path: path.join(OUT, `win-banner-${w}-${t}.png`) });
      }
    }

    // X hides it for this run; the main process remembers the dismissed version
    await theme('dark'); await setSize(1440, 900);
    await page.evaluate(() => document.querySelector('tz-app-update').shadowRoot.querySelector('.x').click());
    await page.waitForTimeout(300);
    ok('X closes the banner', !(await page.evaluate(() => !!document.querySelector('tz-app-update') && document.querySelector('tz-app-update').isConnected)));
    const st = await app.evaluate(() => global.__tzUpdateTest.state());
    ok('state after X is null (shows again next launch: dismissal is in memory)', st === null, JSON.stringify(st));

    // banner survives a page navigation (preload re-asks main for the state)
    await app.evaluate((e, v) => global.__tzUpdateTest.ready(v), '1.3.0');
    await page.reload(); await page.waitForLoadState('load'); await page.waitForTimeout(1500);
    ok('banner comes back after reload for a newer download', /v1\.3\.0/.test((await page.evaluate(MEASURE) || {}).title || ''));

    // below minVersion: blocking screen, no X
    await app.evaluate((e, m) => global.__tzUpdateTest.manifest(m), { windows: Object.assign({}, manifest.windows, { version: '1.3.0', minVersion: '9.0.0' }) });
    await page.waitForTimeout(300);
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await setSize(w, h);
      for (const t of ['dark', 'light']) {
        await theme(t);
        const m = await page.evaluate(MEASURE);
        const tag = 'block ' + w + ' ' + t;
        ok(tag + ': full-screen, no X', m.ov && m.ov.w >= m.vw - 1 && !m.x && /Please update/.test(m.title));
        ok(tag + ': card centred', Math.abs(m.card.cx - m.vw / 2) <= 1);
        ok(tag + ': button label centred', Math.abs(m.ptext.l - m.ptext.r) <= 1);
        await page.screenshot({ path: path.join(OUT, `win-block-${w}-${t}.png`) });
      }
    }
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  }
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
