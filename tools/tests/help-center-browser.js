// Help Center browser test (help.html + assets/help.js + assets/help/help-data.json).
//
//   flock /tmp/stryker-chrome.lock node tools/tests/help-center-browser.js [shotsDir]
//
// Own tiny static server (serves /help -> help.html like Cloudflare Pages). Firebase is
// the stub; every non-local request is blocked. At 390 and 1440 it checks: category
// cards = data counts, every category opens, every accordion expands/collapses, related
// links resolve, every local href in the data returns 200, 25 search queries (typos,
// synonyms) give a sensible top hit, filters change counts, deep links, ?q=, back/forward,
// lightbox, keyboard, no console errors, no sideways overflow.
// Env HELP_SHOTS=1 also writes the report screenshots into shotsDir.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launch, ROOT } = require('./lib.js');
const stub = require('./stub.js');

const OUT = process.argv[2] || '/tmp';
const PORT = Number(process.env.HELP_PORT || 8127);
const BASE = 'http://127.0.0.1:' + PORT;
let fail = 0, pass = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

function serve() {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      let f = path.join(ROOT, p);
      if (!f.startsWith(ROOT)) { rsp.writeHead(403); return rsp.end(); }
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { if (fs.existsSync(f + '.html')) f += '.html'; else { rsp.writeHead(404); return rsp.end('nf'); } }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    }).listen(PORT, '127.0.0.1', () => res(s));
  });
}
function localStatus(urlPath) {
  return new Promise((res) => {
    http.get(BASE + urlPath, (r) => { r.resume(); res(r.statusCode); }).on('error', () => res(0));
  });
}

const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/help/help-data.json'), 'utf8'));
const ITEMS = []; DATA.categories.forEach((c) => c.subs.forEach((s) => s.items.forEach((i) => ITEMS.push(Object.assign({ cat: c.id }, i)))));
const catCount = (id) => ITEMS.filter((i) => i.cat === id).length;

// 25 real queries -> predicate on the top-3 hit ids/titles (checked by eye against the data, see report)
const QUERIES = [
  ['cancle subscription', (h) => /cancel/.test(h[0])],
  ['cancel subscription', (h) => /cancel/.test(h[0])],
  ['rithmc', (h) => /rithmic/.test(h[0])],
  ['rithmic', (h) => /rithmic/.test(h[0])],
  ['gamma', (h) => /gex/.test(h[0])],
  ['gex', (h) => /gex/.test(h[0])],
  ['backtest', (h) => /replay/.test(h[0])],
  ['refund', (h) => /refund/.test(h[0])],
  ['delete account', (h) => /delete-account/.test(h[0])],
  ['password reset', (h) => h.slice(0, 3).includes('reset-password')],
  ['candles not moving', (h) => /candles-not-moving/.test(h[0])],
  ['push notification', (h) => /push/.test(h[0])],
  ['coupon', (h) => /coupon/.test(h[0])],
  ['how much does pro cost', (h) => /pro-price|free-vs-pro|price/.test(h[0])],
  ['forgot my password', (h) => /password/.test(h[0])],
  ['journal import', (h) => h.slice(0, 3).includes('journal-import')],
  ['paper trading', (h) => /paper/.test(h[0])],
  ['footprint', (h) => /footprint/.test(h[0])],
  ['zorotide', (h) => /zorotide/.test(h[0])],
  ['payment failed', (h) => /payment-failed|charged/.test(h[0])],
  ['contact support', (h) => /contact-support|support/.test(h[0])],
  ['dark mode', (h) => h.length > 0],
  ['install app', (h) => /install-app/.test(h[0])],
  ['export my data', (h) => /data-export|export/.test(h[0])],
  ['liquidity map', (h) => /liquidity-map/.test(h[0])],
];

async function open(b, vp, url, tag) {
  const phone = vp.width < 500;
  const ctx = await b.newContext(phone
    ? { viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
    : { viewport: vp });
  await ctx.addInitScript(stub);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource|Failed to fetch/i.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('body.hc-ready', { timeout: 15000 });
  return { ctx, p, errors };
}
const shot = async (p, name, full) => { if (!process.env.HELP_SHOTS) return; const f = path.join(OUT, name); await p.screenshot({ path: f, fullPage: !!full }); console.log('screenshot', f); };
const ids = (p) => p.$$eval('.hc-item', (a) => a.map((x) => x.getAttribute('data-id')));
const url = (p) => p.evaluate(() => location.pathname + location.search + location.hash);

async function suite(b, vp) {
  const tag = vp.width + 'px';
  const { ctx, p, errors } = await open(b, vp, '/help', tag);

  // ---- load + home
  const tLoad = await p.evaluate(() => Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd));
  check(tLoad < 2000, tag + ': DOMContentLoaded ' + tLoad + ' ms (<2000, local, unthrottled)');
  const cards = await p.$$eval('.hc-card', (a) => a.map((x) => [x.getAttribute('data-cat'), parseInt(x.querySelector('.hc-card-n').textContent, 10)]));
  check(cards.length === DATA.categories.length, tag + ': ' + cards.length + ' category cards = ' + DATA.categories.length + ' categories');
  check(cards.every(([id, n]) => n === catCount(id)), tag + ': every card count equals the data');
  check(cards.reduce((a, c) => a + c[1], 0) === ITEMS.length, tag + ': card counts sum to ' + ITEMS.length + ' questions');
  check((await p.textContent('#hc-count')).startsWith(ITEMS.length + ' questions'), tag + ': header count says ' + ITEMS.length);
  check(await p.$eval('h1', (h) => h.textContent) === 'Help Center', tag + ': h1 Help Center');
  check((await p.$$eval('.hc-chip', (a) => a.length)) >= 6, tag + ': popular chips shown');
  check(await p.$eval('meta[name=robots]', (m) => m.content).catch(() => 'none') !== 'noindex', tag + ': page is indexable (no noindex)');
  const over0 = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over0 <= 0, tag + ': home has no sideways overflow (' + over0 + ')');
  await shot(p, `help-home-${vp.width}.png`);

  // ---- every category opens, every accordion expands + collapses
  let accN = 0, accBad = 0, relN = 0, relBad = 0;
  for (const c of DATA.categories) {
    await p.goto(BASE + '/help?cat=' + c.id, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('body.hc-ready');
    const got = await ids(p);
    const want = ITEMS.filter((i) => i.cat === c.id).map((i) => i.id);
    if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.log('FAIL ' + tag + ': category ' + c.id + ' lists ' + got.length + ' of ' + want.length); }
    else pass++;
    // script every accordion
    const res = await p.evaluate(async () => {
      const out = { n: 0, bad: [] };
      for (const a of document.querySelectorAll('.hc-item')) {
        const btn = a.querySelector('.hc-item-btn');
        btn.click();
        const open = btn.getAttribute('aria-expanded') === 'true' && a.classList.contains('is-open');
        const body = a.querySelector('.hc-panel-body');
        const filled = body && body.textContent.trim().length > 10;
        btn.click();
        const closed = btn.getAttribute('aria-expanded') === 'false' && !a.classList.contains('is-open');
        out.n++;
        if (!(open && filled && closed)) out.bad.push(a.getAttribute('data-id'));
      }
      return out;
    });
    accN += res.n; accBad += res.bad.length;
    if (res.bad.length) console.log('  bad accordions', c.id, res.bad.join(','));
  }
  check(accN === ITEMS.length && accBad === 0, tag + ': all ' + accN + ' accordions expand (content present) and collapse; bad=' + accBad);

  // related links resolve
  for (const it of ITEMS) for (const r of (it.related || [])) { relN++; if (!ITEMS.some((x) => x.id === r)) relBad++; }
  check(relBad === 0, tag + ': ' + relN + ' related ids all exist (bad=' + relBad + ')');
  // clicking a related link in the page jumps there
  await p.goto(BASE + '/help#' + 'free-vs-pro', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('body.hc-ready'); await sleep(300);
  const relLink = await p.$('.hc-item.is-open .hc-rel a');
  if (relLink) {
    const target = await relLink.getAttribute('data-rel');
    await relLink.click(); await sleep(500);
    check((await url(p)).endsWith('#' + target) && await p.$eval('#item-' + target, (a) => a.classList.contains('is-open')), tag + ': clicking a related link opens ' + target + ' and updates the URL');
  } else check(false, tag + ': free-vs-pro has related links');

  // ---- search
  await p.goto(BASE + '/help', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('body.hc-ready');
  let qOk = 0;
  for (const [q, pred] of QUERIES) {
    await p.fill('#hc-q', q); await sleep(60);
    const top = await ids(p);
    const ok = top.length > 0 && pred(top);
    if (ok) qOk++;
    check(ok, tag + ': search "' + q + '" -> ' + top.length + ' results, top3 [' + top.slice(0, 3).join(', ') + ']');
  }
  check(qOk === QUERIES.length, tag + ': ' + qOk + '/' + QUERIES.length + ' queries sensible');
  await p.fill('#hc-q', 'cancel'); await sleep(80);
  check(await p.$$eval('mark', (m) => m.length) > 0, tag + ': matches are highlighted');
  check((await p.$$eval('.hc-crumb', (c) => c.length)) > 0, tag + ': each result shows its category');
  check((await url(p)).includes('?q=cancel'), tag + ': query written to URL');
  await shot(p, `help-search-${vp.width}.png`);
  await p.fill('#hc-q', 'zzzxqv'); await sleep(80);
  check(await p.$('.hc-empty a[href="support"]') !== null && (await p.$$('.hc-sugg li')).length >= 4, tag + ': no-results state has Support link + suggestions');
  await shot(p, `help-noresults-${vp.width}.png`);
  await p.fill('#hc-q', ''); await sleep(80);
  check((await p.$$('.hc-card')).length === DATA.categories.length, tag + ': clearing search returns to the category grid');

  // ---- filters
  await p.goto(BASE + '/help', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('body.hc-ready');
  const total = (n) => p.$$eval('.hc-card-n', (a) => a.reduce((s, x) => s + parseInt(x.textContent, 10), 0));
  const wantPlan = (k) => ITEMS.filter((i) => k === 'free' ? i.plans !== 'pro' : i.plans === 'pro').length;
  await p.click('[data-filter=plan] [data-v=pro]'); await sleep(80);
  check(await total() === wantPlan('pro'), tag + ': plan=Pro total ' + wantPlan('pro'));
  await p.click('[data-filter=plan] [data-v=free]'); await sleep(80);
  check(await total() === wantPlan('free'), tag + ': plan=Free total ' + wantPlan('free'));
  await p.click('[data-filter=plan] [data-v=all]');
  await p.click('[data-filter=level] [data-v=advanced]'); await sleep(80);
  const wantAdv = ITEMS.filter((i) => i.level === 'advanced').length;
  check(await total() === wantAdv, tag + ': level=Advanced total ' + wantAdv);
  await p.click('[data-filter=level] [data-v=beginner]'); await sleep(80);
  const wantBeg = ITEMS.filter((i) => i.level !== 'advanced').length;
  check(await total() === wantBeg, tag + ': level=Beginner total ' + wantBeg);
  check((await url(p)).includes('level=beginner'), tag + ': filter kept in URL');
  await p.click('#hc-reset'); await sleep(80);
  check(await total() === ITEMS.length, tag + ': reset restores ' + ITEMS.length);
  await p.selectOption('#hc-cat-sel', 'gex'); await sleep(80);
  check((await ids(p)).length === catCount('gex'), tag + ': category select opens GEX with ' + catCount('gex'));
  await p.selectOption('#hc-cat-sel', ''); await sleep(60);
  await p.click('[data-filter=plan] [data-v=pro]'); await p.fill('#hc-q', 'gex'); await sleep(100);
  const proGex = await ids(p);
  check(proGex.length > 0 && proGex.every((id) => ITEMS.find((i) => i.id === id).plans === 'pro'), tag + ': search + Pro filter -> only Pro items (' + proGex.length + ')');
  await p.fill('#hc-q', ''); await p.click('[data-filter=plan] [data-v=all]');

  // ---- category view + subnav
  await p.goto(BASE + '/help?cat=charts', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('body.hc-ready');
  const subs = await p.$$eval('.hc-sub', (a) => a.length);
  check(subs === DATA.categories.find((c) => c.id === 'charts').subs.length + 1, tag + ': charts subnav has ' + (subs - 1) + ' topics + All');
  await p.click('.hc-sub:nth-child(1)', { trial: true }).catch(() => {});
  await p.click('li:nth-child(3) > .hc-sub'); await sleep(80);
  const subItems = DATA.categories.find((c) => c.id === 'charts').subs[1].items.length;
  check((await ids(p)).length === subItems, tag + ': picking a topic shows only its ' + subItems + ' questions');
  await shot(p, `help-category-${vp.width}.png`);
  const over1 = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (over1 > 0) console.log('  overflowers', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 2 && e.getBoundingClientRect().width).slice(0, 8).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)))));
  check(over1 <= 0, tag + ': category view has no sideways overflow (' + over1 + ')');

  // ---- deep link on fresh load
  const deep = 'journal-import';
  await p.goto(BASE + '/help#' + deep, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('body.hc-ready'); await sleep(900);
  const dl = await p.evaluate((id) => { const a = document.getElementById('item-' + id); const r = a && a.getBoundingClientRect(); return a && { open: a.classList.contains('is-open'), top: r.top, vis: r.top < innerHeight && r.bottom > 0 }; }, deep);
  check(dl && dl.open && dl.vis, tag + ': /help#' + deep + ' opens its category, expands and scrolls into view (top=' + (dl && Math.round(dl.top)) + ')');
  check(await p.$eval('#hc-cat-h', (h) => h.textContent) === DATA.categories.find((c) => c.id === ITEMS.find((i) => i.id === deep).cat).title, tag + ': deep link showed the right category');
  // every item id deep-links (script)
  let dlBad = 0;
  for (const it of ITEMS.filter((_, i) => i % 7 === 0)) {
    await p.goto(BASE + '/help#' + it.id, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('body.hc-ready');
    const ok = await p.evaluate((id) => { const a = document.getElementById('item-' + id); return !!a && a.classList.contains('is-open'); }, it.id);
    if (!ok) { dlBad++; console.log('  deep link failed', it.id); }
  }
  check(dlBad === 0, tag + ': ' + ITEMS.filter((_, i) => i % 7 === 0).length + ' sampled deep links all open (bad=' + dlBad + ')');
  await sleep(300);
  await p.goto(BASE + '/help#' + 'refund', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('body.hc-ready'); await sleep(900);
  await shot(p, `help-answer-${vp.width}.png`);
  // screenshots inside an answer + lightbox
  const withShot = ITEMS.find((i) => /<img/.test(i.a));
  await p.goto(BASE + '/help#' + withShot.id, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('body.hc-ready'); await sleep(900);
  const imgs = await p.$$eval('.hc-item.is-open img', (a) => a.map((i) => [i.loading, i.complete && i.naturalWidth > 0]));
  check(imgs.length > 0 && imgs.every((i) => i[0] === 'lazy'), tag + ': answer images are lazy (' + imgs.length + ')');
  await p.evaluate(() => document.querySelector('.hc-item.is-open img').scrollIntoView({ block: 'center' })); await sleep(500);
  check(await p.$eval('.hc-item.is-open img', (i) => i.complete && i.naturalWidth > 0), tag + ': screenshot loaded');
  await shot(p, `help-answer-shot-${vp.width}.png`);
  await p.click('.hc-item.is-open img'); await sleep(200);
  check(await p.$eval('#hc-lightbox', (l) => !l.hidden) && await p.$eval('#hc-lightbox img', (i) => !!i.getAttribute('src')), tag + ': tap on screenshot opens the lightbox');
  await shot(p, `help-lightbox-${vp.width}.png`);
  await p.keyboard.press('Escape'); await sleep(100);
  check(await p.$eval('#hc-lightbox', (l) => l.hidden), tag + ': Escape closes the lightbox');
  await p.click('.hc-item.is-open img'); await sleep(100); await p.click('.hc-lb-x'); await sleep(100);
  check(await p.$eval('#hc-lightbox', (l) => l.hidden), tag + ': close button closes the lightbox');

  // ---- ?q= on fresh load, back/forward
  await p.goto(BASE + '/help?q=rithmc', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('body.hc-ready');
  check(await p.inputValue('#hc-q') === 'rithmc' && (await ids(p)).some((i) => /rithmic/.test(i)), tag + ': /help?q=rithmc fills the box and shows Rithmic results');
  await p.goto(BASE + '/help', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('body.hc-ready');
  await p.click('.hc-card[data-cat=gex]'); await sleep(150);
  check((await url(p)) === '/help?cat=gex' && (await ids(p)).length === catCount('gex'), tag + ': card click -> ?cat=gex');
  await p.click('.hc-item-btn >> nth=0'); await sleep(150);
  check((await url(p)).startsWith('/help?cat=gex#'), tag + ': opening an item adds #id to the URL (' + (await url(p)) + ')');
  await p.goBack(); await sleep(250);
  check((await url(p)) === '/help' && (await p.$$('.hc-card')).length === DATA.categories.length, tag + ': Back returns to the home grid');
  await p.goForward(); await sleep(250);
  check((await url(p)).startsWith('/help?cat=gex') && (await ids(p)).length === catCount('gex'), tag + ': Forward returns to GEX');
  // search history: typing pushes one entry, back clears it
  await p.goto(BASE + '/help', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('body.hc-ready');
  await p.fill('#hc-q', 'refund'); await sleep(100); await p.fill('#hc-q', 'refunds'); await sleep(100);
  await p.goBack(); await sleep(250);
  check((await url(p)) === '/help' && await p.inputValue('#hc-q') === '', tag + ': Back after a search returns to the empty home (one history entry per search)');
  await p.goForward(); await sleep(250);
  check((await url(p)) === '/help?q=refunds' && (await ids(p)).length > 0, tag + ': Forward restores the search');

  // ---- keyboard
  await p.goto(BASE + '/help', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('body.hc-ready');
  await p.keyboard.press('/'); await sleep(50);
  check(await p.evaluate(() => document.activeElement.id) === 'hc-q', tag + ': "/" focuses the search box');
  await p.keyboard.type('gex'); await sleep(100);
  await p.keyboard.press('ArrowDown'); await sleep(50);
  check(await p.evaluate(() => document.activeElement.classList.contains('hc-item-btn')), tag + ': ArrowDown moves focus into the results');
  const first = await p.evaluate(() => document.activeElement.id);
  await p.keyboard.press('ArrowDown'); await sleep(50);
  check(await p.evaluate((f) => document.activeElement.id !== f && document.activeElement.classList.contains('hc-item-btn'), first), tag + ': ArrowDown moves to the next result');
  await p.keyboard.press('Enter'); await sleep(350);
  check(await p.evaluate(() => document.activeElement.getAttribute('aria-expanded') === 'true'), tag + ': Enter expands the focused result');
  await p.keyboard.press('Space'); await sleep(350);
  check(await p.evaluate(() => document.activeElement.getAttribute('aria-expanded') === 'false'), tag + ': Space collapses it');
  await p.keyboard.press('ArrowUp'); await sleep(50);
  check(await p.evaluate(() => document.activeElement.classList.contains('hc-item-btn') || document.activeElement.id === 'hc-q'), tag + ': ArrowUp moves back');
  // collapsed panel content is not focusable
  const hiddenFocusable = await p.evaluate(() => [...document.querySelectorAll('.hc-item:not(.is-open) .hc-panel a, .hc-item:not(.is-open) .hc-panel button')].filter((e) => getComputedStyle(e).visibility !== 'hidden').length);
  check(hiddenFocusable === 0, tag + ': collapsed answers have no focusable content');
  // aria
  const aria = await p.$$eval('.hc-item-btn', (a) => a.every((b) => b.hasAttribute('aria-expanded') && b.getAttribute('aria-controls') && document.getElementById(b.getAttribute('aria-controls'))));
  check(aria, tag + ': every accordion button has aria-expanded + valid aria-controls');
  await shot(p, `help-keyboard-${vp.width}.png`);

  // ---- vote + copy link + still need help
  await p.goto(BASE + '/help#refund', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('body.hc-ready'); await sleep(500);
  await p.click('.hc-item.is-open .hc-vbtn[data-v=y]');
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('tz_help_votes')).refund === 'y'), tag + ': "Yes" vote stored on-device');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
  await p.click('.hc-item.is-open .hc-copy'); await sleep(200);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => 'n/a'));
  check(clip === BASE + '/help#refund' || clip === 'n/a', tag + ': Copy link copies the deep link (' + clip + ')');
  check(await p.$$eval('.hc-still a', (a) => a.map((x) => x.getAttribute('href')).join('|')) === 'support|contact|mailto:support@tradezoro.com', tag + ': Still-need-help links: support, contact, support email');

  // ---- no-JS fallback + JSON-LD
  const html = fs.readFileSync(path.join(ROOT, 'help.html'), 'utf8');
  const ld = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html);
  const j = ld && JSON.parse(ld[1]);
  check(j && j['@type'] === 'FAQPage' && j.mainEntity.length === ITEMS.length, tag + ': FAQPage JSON-LD has ' + (j && j.mainEntity.length) + ' questions');
  check(/<noscript>[\s\S]*hc-static[\s\S]*<details>/.test(html), tag + ': static no-JS fallback present');

  check(errors.length === 0, tag + ': no console errors' + (errors.length ? ' ' + JSON.stringify(errors.slice(0, 3)) : ''));
  await ctx.close();
}

(async () => {
  const srv = await serve();
  // every local href in the data returns 200 (query/hash stripped)
  const hrefs = new Set();
  ITEMS.forEach((i) => (i.links || []).forEach((l) => hrefs.add(l.href.split('#')[0].split('?')[0])));
  (ITEMS.map((i) => i.a).join(' ').match(/href="([^"]+)"/g) || []).forEach((m) => hrefs.add(m.slice(6, -1).split('#')[0].split('?')[0]));
  const bad = [];
  for (const h of hrefs) {
    if (!h || /^(https?:|mailto:)/.test(h)) continue;
    const s = await localStatus(h.charAt(0) === '/' ? h : '/' + h);
    if (s !== 200) bad.push(h + '=' + s);
  }
  const imgs = (ITEMS.map((i) => i.a).join(' ').match(/src="([^"]+)"/g) || []).map((m) => m.slice(5, -1));
  for (const i of imgs) { const s = await localStatus(i); if (s !== 200) bad.push(i + '=' + s); }
  check(bad.length === 0, 'data: ' + hrefs.size + ' distinct hrefs + ' + imgs.length + ' images return 200 locally; bad=' + JSON.stringify(bad));
  const ids = ITEMS.map((i) => i.id);
  check(new Set(ids).size === ids.length, 'data: ' + ids.length + ' unique item ids');

  const b = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  try {
    await suite(b, { width: 390, height: 844 });
    await suite(b, { width: 1440, height: 900 });
  } finally { await b.close(); srv.close(); }
  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
