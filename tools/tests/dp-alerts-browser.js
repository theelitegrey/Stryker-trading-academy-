// Browser test: dark pool print alerts (assets/chart-dp-alerts.js) created and deleted from the Dark pool list ("Alert me") and listed in
// the Alerts window. 1440 + 390, dark (+ 1440 light). Member (richstub) with an in-memory students/{uid}/dpAlerts; signed-out sees "Sign in".
//   node tools/tests/chart-dev-server.mjs 8198 &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8198 node tools/tests/dp-alerts-browser.js [shotsDir]
// The recorder's dp_spy part is the saved real feeder part (tools/fixtures/darkpool-spy-2026-11-06.json).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8198';
const OUT = process.argv[2] || '/tmp';
const PART = zlib.gzipSync(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'darkpool-spy-2026-11-06.json')));
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// in-memory dpAlerts under students/{uid}: records what the page writes (set / update / delete), like Firestore would keep it
const memDp = () => {
  const t = setInterval(() => {
    const db = window.__stubDb; if (!db || db.__dp) return;
    clearInterval(t); db.__dp = true;
    const store = window.__dpStore = new Map(); window.__dpWrites = [];
    let n = 0;
    const docRef = (id) => ({ id, get: async () => ({ id, exists: store.has(id), data: () => store.get(id) || {} }),
      set: async (d) => { window.__dpWrites.push(['set', id, d]); store.set(id, Object.assign({}, d)); },
      update: async (d) => { window.__dpWrites.push(['update', id, d]); store.set(id, Object.assign({}, store.get(id), d)); },
      delete: async () => { window.__dpWrites.push(['delete', id]); store.delete(id); } });
    const col = { doc: (id) => docRef(id || 'dpa' + String(++n).padStart(17, '0')), get: async () => ({ docs: [...store].map(([id, d]) => ({ id, data: () => d })), size: store.size, empty: !store.size, forEach(f) { this.docs.forEach(f); } }) };
    const orig = db.collection;
    db.collection = (name) => {
      const c = orig(name);
      if (name !== 'students') return c;
      const od = c.doc;
      return Object.assign({}, c, { doc: (uid) => { const d = od(uid); const oc = d.collection; return Object.assign({}, d, { collection: (sub) => (sub === 'dpAlerts' ? col : oc(sub)) }); } });
    };
  }, 0);
};

async function open(b, { w, h, mobile, anon, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(memDp);
  if (anon) await ctx.addInitScript(() => { const t = setInterval(() => { const a = window.__stubAuth; if (a) { a.currentUser = null; a.onAuthStateChanged = (cb) => { setTimeout(() => cb(null), 10); return () => {}; }; clearInterval(t); } }, 0); });
  await ctx.addInitScript(([theme]) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', theme === 'light' ? 'day' : 'night'); } catch (e) {} window.__stkChartTestFree = true; window.__toasts = []; const t = setInterval(() => { if (window.showToast && !window.showToast.__w) { const o = window.showToast; window.showToast = (ty, m) => { window.__toasts.push(String(m)); return o(ty, m); }; window.showToast.__w = 1; } }, 50); }, [theme]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/(?!scan\?part=dp_)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/scan\?part=dp_/, (r) => {
    const s = new URL(r.request().url()).searchParams.get('part');
    if (s !== 'dp_spy') return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'no data' });
    r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-scan-gzip, x-scan-t', 'x-scan-gzip': '1' }, body: PART });
  });
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|binance|WebSocket|net::|status of 4|status of 5|opt-analytics/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
  await sleep(2500);
  if (theme === 'light') await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol('IDX:SPY'); });
  await sleep(3000);
  return { ctx, p, errors };
}
async function shot(p, name) { await p.mouse.move(2, 2).catch(() => {}); await sleep(600); const f = path.join(OUT, name); await p.screenshot({ path: f }); console.log('SHOT ' + f); }
const tap = async (p, sel, phone) => { const b = await p.$(sel); if (!b) return false; const bb = await b.boundingBox(); if (!bb) return false; if (phone) await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); else await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); return true; };

async function run(b, tag, o) {
  const { ctx, p, errors } = await open(b, o);
  const phone = !!o.mobile;
  check(await p.evaluate((ph) => { const b = document.querySelector(ph ? '.stkdkp-phonebtn' : '.stkdkp-railbtn'); if (b) b.click(); return !!b; }, phone), tag + ': Dark pool panel button');
  await sleep(1500);
  const btn = await p.evaluate(() => { const b = document.querySelector('#stkdkp .stkdkp-alert'); if (!b || b.hidden) return null; const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), h: Math.round(r.height), w: Math.round(r.width), in: r.right <= innerWidth && r.left >= 0, label: b.getAttribute('aria-label') }; });
  check(btn && btn.t === 'Alert me' && btn.in && btn.label === 'Alert me on SPY dark pool prints', tag + ': "Alert me" in the list header ' + JSON.stringify(btn));
  if (phone) check(btn && btn.h >= 44, tag + ': Alert me tap target >= 44 (' + (btn && btn.h) + ')');
  await shot(p, 'dpa-' + tag + '-list.png');
  // $10M in the list -> the dialog opens prefilled with SPY / $10M+
  await p.evaluate(() => [...document.querySelectorAll('#stkdkp .stkdkp-seg button')].find((b) => b.dataset.m === '$10M').click()); await sleep(300);
  check(await tap(p, '#stkdkp .stkdkp-alert', phone), tag + ': tap Alert me'); await sleep(1200);
  const st = await p.evaluate(() => { const d = document.getElementById('stkdpa'); if (!d || d.hidden) return null; const f = d.querySelector('form'); return { sym: f.symbol.value, size: (d.querySelector('[data-s][aria-checked="true"]') || {}).dataset.s, freq: (d.querySelector('[data-f][aria-checked="true"]') || {}).dataset.f, title: d.querySelector('h2').textContent, form: !f.hidden, focus: document.activeElement && document.activeElement.name }; });
  if (o.anon) {
    const si = await p.evaluate(() => { const s = document.querySelector('#stkdpa .stkdpa-signin'); return s && !s.hidden ? s.textContent : null; });
    check(st && !st.form && /Sign in/.test(si || ''), tag + ': signed out -> "Sign in" ' + JSON.stringify(si));
    await shot(p, 'dpa-' + tag + '-signin.png');
    check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
    await ctx.close(); return;
  }
  check(st && st.sym === 'SPY' && st.size === '$10M' && st.freq === 'every' && st.title === 'Dark pool print alert' && st.form, tag + ': dialog prefilled ' + JSON.stringify(st));
  const geo = await p.evaluate(() => { const b = document.querySelector('#stkdpa .stkdpa-box').getBoundingClientRect(); const bd = document.querySelector('#stkdpa .stkdpa-body'); return { l: b.left, r: b.right, b: Math.round(b.bottom), vw: innerWidth, vh: innerHeight, sx: bd.scrollWidth - bd.clientWidth, small: [...document.querySelectorAll('#stkdpa button, #stkdpa input, #stkdpa select')].map((x) => (x.type === 'checkbox' ? x.closest('label') : x)).filter((x) => x.offsetParent && x.getBoundingClientRect().height < 40).map((x) => x.className || x.name) }; });
  check(geo.l >= 0 && geo.r <= geo.vw && geo.sx <= 1, tag + ': dialog fits, no sideways scroll ' + JSON.stringify(geo));
  if (phone) check(geo.b === geo.vh && !geo.small.length, tag + ': phone bottom sheet, every control (checkbox: its label row) >= 40 tall ' + JSON.stringify(geo.small));
  // zone on, custom size, Only once -> validation then create
  await p.evaluate(() => { const f = document.querySelector('#stkdpa form'); f.zone.click(); }); await sleep(200);
  await p.evaluate(() => document.querySelector('#stkdpa [data-s="Custom"]').click()); await sleep(200);
  await p.evaluate(() => { const f = document.querySelector('#stkdpa form'); f.custom.value = ''; f.lo.value = '680'; f.hi.value = ''; });
  await p.evaluate(() => document.querySelector('#stkdpa [data-f="once"]').click());
  await shot(p, 'dpa-' + tag + '-dialog.png');
  await p.evaluate(() => document.querySelector('#stkdpa .stkdpa-save').click()); await sleep(400);
  const e1 = await p.evaluate(() => document.querySelector('#stkdpa .stkdpa-err').textContent);
  check(/smallest size is \$1M/.test(e1), tag + ': empty custom size refused "' + e1 + '"');
  await p.evaluate(() => { const f = document.querySelector('#stkdpa form'); f.custom.value = '15'; });
  await p.evaluate(() => document.querySelector('#stkdpa .stkdpa-save').click()); await sleep(400);
  const e2 = await p.evaluate(() => document.querySelector('#stkdpa .stkdpa-err').textContent);
  check(/both prices/.test(e2), tag + ': half a zone refused "' + e2 + '"');
  await p.evaluate(() => { const f = document.querySelector('#stkdpa form'); f.hi.value = '670'; });   // reversed: swapped
  await p.evaluate(() => document.querySelector('#stkdpa .stkdpa-save').click()); await sleep(800);
  const w1 = await p.evaluate(() => window.__dpWrites.slice());
  const d1 = w1.length && w1[0][2];
  check(w1.length === 1 && w1[0][0] === 'set' && d1.symbol === 'SPY' && d1.min === 15e6 && d1.lo === 670 && d1.hi === 680 && d1.freq === 'once' && d1.active === true && d1.createdAt === 'TS' && d1.updatedAt === 'TS'
    && Object.keys(d1).sort().join() === 'active,createdAt,freq,hi,lo,min,symbol,updatedAt', tag + ': Firestore doc written ' + JSON.stringify(w1));
  const rows = await p.evaluate(() => [...document.querySelectorAll('#stkdpa .stkdpa-row')].map((r) => r.innerText.replace(/\n/g, ' | ')));
  check(rows.length === 1 && /SPY ≥ \$15M · 670\.00 to 680\.00/.test(rows[0]) && /Dark pool print · Only once · phone push/.test(rows[0]), tag + ': row in "Your dark pool alerts" ' + JSON.stringify(rows));
  check((await p.evaluate(() => window.__toasts.join(' '))).includes('Dark pool print alert set'), tag + ': confirmation toast');
  // a second one: every time, $1M, no zone
  await p.evaluate(() => { const d = document.getElementById('stkdpa'); d.querySelector('[data-s="$1M"]').click(); d.querySelector('[data-f="every"]').click(); d.querySelector('form').zone.click(); d.querySelector('.stkdpa-save').click(); }); await sleep(800);
  check((await p.evaluate(() => window.__dpStore.size)) === 2, tag + ': second alert created');
  await shot(p, 'dpa-' + tag + '-created.png');
  // the Alerts window lists them too and has "+ Dark pool alert"
  await p.evaluate(() => document.querySelector('#stkdpa .stkdpa-x').click()); await sleep(300);
  check(await p.evaluate(() => document.getElementById('stkdpa').hidden), tag + ': dialog closes');
  await p.evaluate(() => window.__stkAlerts.open()); await sleep(800);
  const am = await p.evaluate(() => ({ btn: !!document.querySelector('#stk-al .stk-al-dpnew'), count: document.querySelector('#stk-al .stk-al-count').textContent, rows: [...document.querySelectorAll('#stk-al .stk-al-row')].map((r) => r.querySelector('b').textContent) }));
  check(am.btn && /2 of 20 dark pool alerts/.test(am.count) && am.rows.filter((x) => /^SPY ≥ \$/.test(x)).length === 2, tag + ': Alerts window lists them ' + JSON.stringify(am));
  if (!phone) await shot(p, 'dpa-' + tag + '-manager.png');
  // pause from the Alerts window
  await p.evaluate(() => { const r = [...document.querySelectorAll('#stk-al .stk-al-row')].find((x) => /\$1M/.test(x.textContent)); r.querySelector('[data-k=pause]').click(); }); await sleep(500);
  const up = await p.evaluate(() => window.__dpWrites.filter((w) => w[0] === 'update'));
  check(up.length === 1 && up[0][2].active === false && up[0][2].updatedAt === 'TS', tag + ': Pause writes active=false + server time');
  await p.evaluate(() => { document.querySelector('#stk-al .stk-al-x').click(); }); await sleep(300);
  // delete from the list panel's dialog
  await tap(p, '#stkdkp .stkdkp-alert', phone); await sleep(1000);
  await p.evaluate(() => [...document.querySelectorAll('#stkdpa .stkdpa-row [data-k=del]')].forEach((b) => b.click())); await sleep(800);
  const left = await p.evaluate(() => ({ n: window.__dpStore.size, del: window.__dpWrites.filter((w) => w[0] === 'delete').length, rows: document.querySelectorAll('#stkdpa .stkdpa-row').length, mine: document.querySelector('#stkdpa .stkdpa-mine').hidden }));
  check(left.n === 0 && left.del === 2 && left.rows === 0 && left.mine, tag + ': both deleted from Firestore and the list ' + JSON.stringify(left));
  // cap 20
  const cap = await p.evaluate(async () => { const m = await import('/assets/chart-dp-alerts.js?v=904'); for (let i = 0; i < 20; i++) await m.create({ symbol: 'TSLA', min: 1e6, freq: 'every', active: true }); try { await m.create({ symbol: 'TSLA', min: 1e6, freq: 'every', active: true }); return 'no'; } catch (e) { return e.full ? 'full' : String(e); } });
  check(cap === 'full', tag + ': 21st alert refused (' + cap + ')');
  // Escape closes
  await p.keyboard.press('Escape'); await sleep(300);
  // the member's case: a FUTURES chart (ES) -> "Alert me" makes the alert on SPY, whose prints the ES list shows
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol('futures:ES1!'); }); await sleep(3000);
  const fut = await p.evaluate(async () => { const b = document.querySelector('#stkdkp .stkdkp-alert'); if (!b || b.hidden) return null; b.click(); await new Promise((r) => setTimeout(r, 1000)); const d = document.getElementById('stkdpa'); return { sym: d && !d.hidden ? d.querySelector('form').symbol.value : null, label: b.getAttribute('aria-label') }; });
  check(fut && fut.sym === 'SPY' && /SPY/.test(fut.label), tag + ': ES chart -> Alert me prefilled SPY ' + JSON.stringify(fut));
  await p.keyboard.press('Escape'); await sleep(300);
  check(await p.evaluate(() => document.getElementById('stkdpa').hidden), tag + ': Escape closes');
  const words = await p.evaluate(() => (document.getElementById('stkdpa') || {}).textContent + ' ' + document.querySelector('#stkdkp').textContent);
  check(!/\blive\b|real-time|realtime|delayed/i.test(words) && !/insight|finra|unusual whales|polygon/i.test(words), tag + ': no live / real-time / vendor wording');
  check(!errors.length, tag + ': no page errors ' + errors.join(' | ').slice(0, 300));
  await ctx.close();
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const runs = [['1440-dark', { w: 1440, h: 900, theme: 'dark' }], ['390-dark', { w: 390, h: 844, mobile: true, theme: 'dark' }],
      ['412-dark', { w: 412, h: 915, mobile: true, theme: 'dark' }], ['1440-light', { w: 1440, h: 900, theme: 'light' }],
      ['390-signedout', { w: 390, h: 844, mobile: true, anon: true, theme: 'dark' }]];
    const only = process.env.ONLY;
    for (const [t, o] of runs) if (!only || only.split(',').includes(t)) await run(b, t, o);
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
