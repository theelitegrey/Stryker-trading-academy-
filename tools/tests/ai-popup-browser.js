// "Connect your AI" popup on the chart (Owner 16 Nov 2026): opens ON the chart, URL never changes, Esc / outside / X close,
// focus trap, token create + revoke with mocked /api/ai/*, measurements (ALIGNMENT GATE) + shots.
//   node tools/tests/chart-dev-server.mjs 8097 &   then   CHART_BASE=http://127.0.0.1:8097 node tools/tests/ai-popup-browser.js <shotsDir>
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8097';
const OUT = process.argv[2] || '.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };

async function run(b, w, h, theme) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); if (t === 'light') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  let grants = [{ id: 'g1', name: 'Claude', kind: 'oauth', verified: true, scope: ['mcp:read', 'mcp:chart'], lastUsed: Date.now() - 600000, expires: Date.now() + 40 * 864e5 }];
  let recent = true; const calls = [];
  await ctx.route('**/api/ai/**', async (r) => {
    const path = new URL(r.request().url()).pathname.replace('/api/ai/', ''); calls.push(path);
    const j = (o, s) => r.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (path === 'grants') return j({ grants, tabs: 1 });
    if (path === 'personal') { if (!recent) return j({ error: 'Sign in again', code: 'recent-login' }, 403); const g = { id: 'g' + (grants.length + 1), name: JSON.parse(r.request().postData()).name, kind: 'personal', scope: ['mcp:read'], expires: Date.now() + 90 * 864e5 }; grants.push(g); return j({ token: 'tzp_TESTTOKEN123', grant: g }); }
    if (path === 'grant/delete') { const id = JSON.parse(r.request().postData()).id; grants = grants.filter((g) => g.id !== id); return j({ ok: true }); }
    return j({});
  });
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('dialog', (d) => d.accept());
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.getElementById('stkc-ai-btn') && window.STRYKER_VELA, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  const url0 = p.url(), L = `${w}-${theme}`;
  // the button may live in the ⋯ menu on small screens: click via DOM
  await p.evaluate(() => document.getElementById('stkc-ai-btn').click());
  await p.waitForSelector('.stkaip-box', { timeout: 8000 });
  await p.waitForSelector('#aic-list .aic-row', { timeout: 8000 });
  check(p.url() === url0, L + ': popup opened, URL unchanged', p.url());
  check(await p.evaluate(() => !!document.querySelector('#stkc-bar, .stkchart-panel')), L + ': chart still on the page');
  const texts = await p.evaluate(() => ({ st: document.querySelector('#stkaip-status').textContent, mcp: document.querySelector('#stkaip-url code').textContent, folds: document.querySelectorAll('.aic-fold').length, rows: document.querySelectorAll('#aic-list .aic-row').length }));
  check(/Not connected|Turned off/.test(texts.st), L + ': status shown', texts.st);
  check(/^https?:\/\/[^/]+\/mcp$/.test(texts.mcp) && texts.folds === 5 && texts.rows === 1, L + ': MCP url, 5 app guides, 1 connection', texts);
  // focus trap: Tab many times, focus stays inside
  let inside = true; for (let i = 0; i < 40; i++) { await p.keyboard.press('Tab'); inside = inside && await p.evaluate(() => !!document.activeElement.closest('.stkaip-box')); }
  await p.keyboard.press('Shift+Tab'); inside = inside && await p.evaluate(() => !!document.activeElement.closest('.stkaip-box'));
  check(inside, L + ': focus trapped');
  // token create
  await p.fill('#stkaip-agents #aic-tname', 'Codex laptop');
  await p.click('#stkaip-agents #aic-new button[type=submit]');
  await p.waitForSelector('#stkaip-agents #aic-token .aic-code', { timeout: 5000 });
  check((await p.textContent('#stkaip-agents #aic-token .aic-code')) === 'tzp_TESTTOKEN123', L + ': token shown once with copy');
  await p.waitForFunction(() => document.querySelectorAll('#aic-list .aic-row').length === 2);
  check(true, L + ': new token in list');
  await p.evaluate(() => { document.querySelector('.stkaip-body').scrollTop = 0; });
  // alignment numbers
  const m = await p.evaluate(() => {
    const R = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, cy: b.y + b.height / 2, r: b.right }; };
    const box = R(document.querySelector('.stkaip-box')), head = document.querySelector('.stkaip-head');
    const x = R(head.querySelector('.stkaip-x')), hh = R(head.querySelector('h2'));
    const sd = document.querySelector('.stkaip-st'), dot = R(sd.querySelector('.stkaip-dot')), tt = R(sd.querySelector('.stkaip-st-t'));
    const cr = document.querySelector('#stkaip-url .aic-copy'), code = R(cr.querySelector('code')), cb = R(cr.querySelector('button')), crr = R(cr);
    const body = document.querySelector('.stkaip-body'), secs = [...body.querySelectorAll('.stkaip-sec, .aic-card')].map(R);
    const bb = R(body), cs = getComputedStyle(body);
    return { vw: innerWidth, vh: innerHeight, box, headCy: { title: hh.cy, x: x.cy, headMid: R(head).cy + parseFloat(getComputedStyle(head).paddingTop) / 2 }, dotVsText: dot.cy - (tt.y + 10), copyRowCy: [code.cy, cb.cy, crr.cy], bodyPad: [parseFloat(cs.paddingLeft), parseFloat(cs.paddingRight)], secInset: secs.map((s) => [+(s.x - bb.x).toFixed(1), +(bb.r - 8 - s.r).toFixed(1)].join('/')), center: [box.x + box.w / 2 - innerWidth / 2, (box.y + box.h / 2) - innerHeight / 2], btnH: [...document.querySelectorAll('.stkaip .aic-btn')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().height), overflowX: body.scrollWidth > body.clientWidth };
  });
  console.log(L, JSON.stringify(m));
  check(Math.abs(m.headCy.title - m.headCy.x) <= 1 && Math.abs(m.headCy.x - m.headCy.headMid) <= 1, L + ': header title/close share one centre', m.headCy);
  check(Math.abs(m.copyRowCy[0] - m.copyRowCy[1]) <= 1, L + ': copy row centred', m.copyRowCy);
  check(m.bodyPad[0] === m.bodyPad[1], L + ': equal body padding', m.bodyPad);
  check(!m.overflowX, L + ': no horizontal overflow');
  if (w >= 600) check(Math.abs(m.box.w - 520) <= 1 && Math.abs(m.center[0]) <= 1, L + ': desktop dialog 520 wide, centred', [m.box.w, m.center]);
  else check(Math.abs(m.box.r - m.vw) <= 1 && Math.abs(m.box.y + m.box.h - m.vh) <= 1 && m.box.x === 0, L + ': phone bottom sheet edge to edge', m.box);
  await p.screenshot({ path: `${OUT}/popup-${L}-token.png` });
  // revoke
  await p.click('#stkaip-agents #aic-list .aic-row:last-child [data-revoke]');
  await p.waitForFunction(() => document.querySelectorAll('#aic-list .aic-row').length === 1);
  check(calls.includes('grant/delete'), L + ': revoke removed the token');
  // recent-login rule
  recent = false; await p.fill('#stkaip-agents #aic-tname', 'x'); await p.click('#stkaip-agents #aic-new button[type=submit]');
  await p.waitForSelector('#stkaip-agents #aic-relogin', { timeout: 5000 }); check(true, L + ': recent sign-in required message');
  // expand a guide, shot top
  await p.evaluate(() => { document.querySelector('.stkaip-body').scrollTop = 0; document.querySelector('#aic-claude').open = true; });
  await p.screenshot({ path: `${OUT}/popup-${L}-top.png` });
  // close paths
  await p.keyboard.press('Escape'); check(!(await p.$('.stkaip-box')), L + ': Esc closes');
  check(p.url() === url0, L + ': URL still unchanged');
  await p.evaluate(() => document.getElementById('stkc-ai-btn').click()); await p.waitForSelector('.stkaip-box');
  await p.mouse.click(w >= 600 ? 5 : w / 2, 5); check(!(await p.$('.stkaip-box')), L + ': click outside closes');
  await p.evaluate(() => document.getElementById('stkc-ai-btn').click()); await p.waitForSelector('.stkaip-box');
  await p.click('.stkaip-x'); check(!(await p.$('.stkaip-box')), L + ': X closes');
  check(!errors.filter((e) => !/richstub|snap/.test(e)).length, L + ': no page errors', errors.slice(0, 2));
  await ctx.close();
}
(async () => {
  const b = await launch();
  for (const [w, h] of [[1440, 900], [412, 800], [390, 780]]) for (const t of ['dark', 'light']) await run(b, w, h, t);
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
