// Toast browser test: types, stack of 4 -> 3 visible, hover pauses timer, error persists, action, hold promise,
// light + dark, 1440 + 390, alignment measurements. Needs a local server (python3 -m http.server 8000).
//   node tools/tests/toast-browser.js [shotsDir]
const fs = require('fs');
const { launch, BASE } = require('./lib.js');
const OUT = process.argv[2] || (process.env.TMPDIR || '/tmp') + '/toast-shots';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LONG = 'A much longer detail line that keeps going and going so it has to wrap over several lines and then get cut off with an ellipsis at three lines maximum, no more than that at all, ever.';

(async () => {
  const browser = await launch();
  const newPage = (o) => browser.newPage(o);
  for (const [w, h] of [[1440, 900], [390, 844]]) for (const theme of ['dark', 'light']) {
    const tag = w + '-' + theme, p = await newPage({ viewport: { width: w, height: h }, hasTouch: w < 500 });
    const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.showToast);
    await p.evaluate((t) => { if (t === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme'); }, theme);
    const clear = async () => { await p.evaluate(() => document.querySelectorAll('.toast-close').forEach((b) => b.click())); await sleep(350); };
    for (const ty of ['success', 'info', 'warning', 'error']) {
      await p.evaluate((ty) => { window.showToast(ty, 'Saved ' + ty, { description: 'Detail line for ' + ty, action: { label: 'Undo', onClick() {} } }); }, ty);
      await sleep(450);
      const r = await p.evaluate(() => { const t = document.querySelector('.toast'); const q = (s) => t.querySelector(s).getBoundingClientRect(); const tr = t.getBoundingClientRect();
        const ic = q('.toast-icon'), ti = q('.toast-title'), ac = q('.toast-action'), cl = q('.toast-close');
        const cs = getComputedStyle(t); const lh = parseFloat(getComputedStyle(t.querySelector('.toast-title')).lineHeight);
        return { role: t.getAttribute('role'), w: tr.width, iconC: ic.top + ic.height / 2, line1C: ti.top + lh / 2, acC: ac.top + ac.height / 2, clC: cl.top + cl.height / 2, mid: tr.top + tr.height / 2, padL: parseFloat(cs.paddingLeft), padR: parseFloat(cs.paddingRight), right: window.innerWidth - tr.right, top: tr.top, bottom: window.innerHeight - tr.bottom, title: t.querySelector('.toast-title').textContent, bg: cs.backgroundColor, timer: !!t.querySelector('.toast-timer') }; });
      check(r.role === (ty === 'error' ? 'alert' : 'status'), tag + ' ' + ty + ' role', r.role);
      check(Math.abs(r.iconC - r.line1C) <= 2, tag + ' ' + ty + ' icon centred on first line', [r.iconC, r.line1C]);
      check(Math.abs(r.acC - r.mid) <= 1 && Math.abs(r.clC - r.mid) <= 1, tag + ' ' + ty + ' button/close vertically centred', [r.acC, r.clC, r.mid]);
      check(r.title === 'Saved ' + ty && r.timer === (ty !== 'error'), tag + ' ' + ty + ' title + timer line', [r.title, r.timer]);
      check(Math.abs(r.w - Math.min(340, w - 24)) <= 1, tag + ' width', r.w);
      check(theme === 'light' ? r.bg === 'rgb(255, 255, 255)' : r.bg === 'rgb(22, 23, 27)', tag + ' card bg ' + r.bg);
      console.log('  ' + tag + ' ' + ty, JSON.stringify({ iconC: r.iconC, line1C: r.line1C, acC: r.acC, clC: r.clC, mid: r.mid, padL: r.padL, padR: r.padR, right: r.right, top: Math.round(r.top), bottom: Math.round(r.bottom) }));
      if (ty === 'error') await p.screenshot({ path: OUT + '/crop-' + tag + '.png', clip: w > 500 ? { x: w - 372, y: Math.max(0, r.top - 12), width: 372, height: 110 } : { x: 0, y: Math.max(0, h - r.bottom - 100), width: w, height: 110 } });
      await clear();
    }
    await p.evaluate(() => { window.showToast('info', 'Only a message'); }); await sleep(350);
    check(await p.evaluate(() => { const t = document.querySelector('.toast'); return t.textContent.indexOf('Heads up') < 0 && t.querySelector('.toast-msg').style.display === 'none'; }), tag + ' message-only shows just the line');
    await clear();
    await p.evaluate((L) => { window.showToast('warning', 'Title', { description: L, action: { label: 'Open settings', onClick() {} } }); }, LONG); await sleep(350);
    const lc = await p.evaluate(() => { const t = document.querySelector('.toast'), m = t.querySelector('.toast-msg'); const lh = parseFloat(getComputedStyle(m).lineHeight); const r = t.getBoundingClientRect(); const a = t.querySelector('.toast-action').getBoundingClientRect(); return { lines: Math.round(m.getBoundingClientRect().height / lh), inside: a.right <= r.right - 8 && r.left >= 0 && r.right <= innerWidth }; });
    check(lc.lines <= 3 && lc.inside, tag + ' long text clamps to 3 lines, nothing clipped', lc);
    await clear();
    await p.evaluate(() => { ['success', 'info', 'warning', 'error'].forEach((ty, i) => window.showToast(ty, 'Stack toast ' + (i + 1), i % 2 ? { description: 'Some detail' } : {})); });
    await sleep(500);
    const vis = await p.evaluate(() => [...document.querySelectorAll('.toast')].filter((t) => parseFloat(t.style.opacity) > 0.1).length);
    check(vis === 3, tag + ' stack of 4 shows 3', vis);
    await p.screenshot({ path: OUT + '/stack-' + tag + '.png' });
    await clear();
    await p.evaluate(() => { ['success', 'info', 'warning', 'error'].forEach((ty) => window.showToast(ty, ty[0].toUpperCase() + ty.slice(1) + ' toast', { description: 'Short detail line', action: { label: 'Undo', onClick() {} } })); });
    await sleep(400);
    if (w > 500) { const b = await p.evaluate(() => { const r = document.querySelector('.toast').getBoundingClientRect(); return [r.x + 20, r.y + 20]; }); await p.mouse.move(b[0], b[1]); }
    else await p.evaluate(() => document.getElementById('stryker-toast-host').dispatchEvent(new PointerEvent('pointerover', { pointerType: 'mouse' })));
    await sleep(500);
    await p.screenshot({ path: OUT + '/types-' + tag + '.png' });
    check(errs.length === 0, tag + ' no page errors', errs);
    await p.close();
  }
  const p = await newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.showToast);
  await p.evaluate(() => { window.showToast('success', 'Timer test'); });
  await sleep(500);
  const pos = await p.evaluate(() => { const r = document.querySelector('.toast').getBoundingClientRect(); return [r.x + 40, r.y + 20, 1440 - r.right, r.top]; });
  check(pos[2] === 16, 'desktop 16px from right', pos[2]);
  await p.mouse.move(pos[0], pos[1]); await sleep(4200);
  check(await p.evaluate(() => !!document.querySelector('.toast')), 'hover pauses the timer (still there after 4.7s)');
  await p.mouse.move(5, 500); await sleep(4600);
  check(await p.evaluate(() => !document.querySelector('.toast')), 'leaves after hover ends');
  await p.evaluate(() => { window.showToast('error', 'Sticky error'); }); await sleep(7500);
  check(await p.evaluate(() => !!document.querySelector('.toast')), 'error persists past 7s');
  await p.click('.toast-close'); await sleep(500);
  check(await p.evaluate(() => !document.querySelector('.toast')), 'close button dismisses');
  await p.evaluate(() => { window.__a = 0; window.showToast('info', 'Act', { action: { label: 'Go', onClick() { window.__a++; } } }); }); await sleep(300);
  await p.click('.toast-action'); await sleep(400);
  check(await p.evaluate(() => window.__a === 1 && !document.querySelector('.toast')), 'action button fires and closes');
  await p.mouse.move(5, 500); await sleep(200);   // the cursor would otherwise hover the next toast and pause it (by design)
  const hold = await p.evaluate(async () => { const t0 = Date.now(); const pr = window.showToast('info', 'Held', { hold: true }); setTimeout(() => pr.toast.arm(600), 300); await pr; return Date.now() - t0; });
  check(hold > 800 && hold < 2500, 'hold promise resolves after close', hold);
  await p.evaluate(() => { window.showToast.promise(new Promise((r) => setTimeout(r, 800)), { loading: 'Working', success: 'Finished', error: 'Failed' }); }); await sleep(300);
  check(await p.evaluate(() => document.querySelector('.toast').classList.contains('toast-loading') && !document.querySelector('.toast-timer')), 'loading: spinner, no timer');
  await sleep(1000);
  check(await p.evaluate(() => document.querySelector('.toast').classList.contains('toast-success') && !!document.querySelector('.toast-timer')), 'loading resolves to success with timer');
  await p.close(); await browser.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
