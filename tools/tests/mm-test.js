const { chromium, ROOT, BASE, launch } = require('./lib.js');
const fs = require('fs');

const MAP = JSON.parse(fs.readFileSync(ROOT + '/assets/market-map.json', 'utf8'));

const stub = `(${function () {
  const snap = (d) => ({ exists: !!d, data: () => d || {} });
  const docRef = () => ({ get: () => Promise.resolve(snap(null)), set: () => Promise.resolve(), collection: () => colRef() });
  const colRef = () => ({ doc: docRef, get: () => Promise.resolve({empty:true,size:0,forEach:()=>{}}), where: () => colRef(), orderBy: () => colRef(), limit: () => colRef(), onSnapshot: () => () => {} });
  window.__stubDb = { collection: colRef }; window.db = window.__stubDb;
  window.__stubAuth = { currentUser: {uid:'u1'}, onAuthStateChanged: (cb)=>setTimeout(()=>cb({uid:'u1'}),10), setPersistence: ()=>Promise.resolve() };
  window.firebase = { apps: [], initializeApp: () => ({}), app: () => ({ functions: () => ({ httpsCallable: () => () => Promise.resolve({data:{}}) }) }),
    firestore: Object.assign(()=>window.__stubDb,{FieldValue:{serverTimestamp:()=>'TS',increment:n=>({inc:n}),delete:()=>'DEL',arrayUnion:()=>'AU',arrayRemove:()=>'AR'}}),
    auth: Object.assign(()=>window.__stubAuth,{Auth:{Persistence:{LOCAL:'l',SESSION:'s'}}}), messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} }) };
  window.auth = window.__stubAuth; window.showToast = () => Promise.resolve();
}})()`;

async function open(b, url, override, viewport, theme) {
  const page = await b.newPage({ viewport: viewport || { width: 1280, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    // The harness itself aborts every off-localhost request, and Chromium
    // reports each one as a console error. Ignore our own doing.
    if (/ERR_FAILED|ERR_BLOCKED|net::/.test(m.text())) return;
    errs.push('console: ' + m.text());
  });
  await page.addInitScript(stub);
  if (theme) await page.addInitScript(`try{localStorage.setItem('stryker_theme','${theme}')}catch(e){}`);
  if (override) {
    await page.route(/market-map\.json/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(override) }));
  }
  await page.route(/^https?:\/\/(?!localhost)/, r => r.abort());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  page.__errs = errs;
  return page;
}
const fresh = (extra) => Object.assign({}, MAP, { generatedAt: new Date(Date.now() - 3600e3).toISOString() }, extra || {});
// goodUntil outranks the hour count, so a stale fixture has to move both.
const stale = () => Object.assign({}, MAP, { generatedAt: new Date(Date.now() - 60 * 3600e3).toISOString(), goodUntil: new Date(Date.now() - 3600e3).toISOString() });

// Relative luminance / contrast, for the ink-on-fill check.
function lin(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)}
function rgb(s){const m=s.match(/(\d+(?:\.\d+)?)/g);return m?m.slice(0,3).map(Number):null}
function L(a){return 0.2126*lin(a[0])+0.7152*lin(a[1])+0.0722*lin(a[2])}
function contrast(a,b){const x=L(a),y=L(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)}

(async () => {
  const b = await launch();
  const log = []; const ok = (l, c, x) => log.push((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '   ' + x : ''));

  // ---- 1. the shipped file --------------------------------------------
  const rows = MAP.groups.reduce((n, g) => n + g.rows.length, 0);
  ok('file has groups', MAP.groups.length >= 5, MAP.groups.length + ' groups');
  ok('file has rows', rows > 60, rows + ' rows');
  ok('every row has 7 values', MAP.groups.every(g => g.rows.every(r => r.v.length === MAP.periods.length)));
  ok('every value is a finite number or null', MAP.groups.every(g => g.rows.every(r => r.v.every(v => v === null || Number.isFinite(v)))));
  ok('every row has a label and ticker', MAP.groups.every(g => g.rows.every(r => r.label && r.ticker)));
  ok('every group carries a scale', MAP.groups.every(g => Number(g.scale) > 0));
  ok('group ids are unique', new Set(MAP.groups.map(g => g.id)).size === MAP.groups.length);
  ok('tickers are unique within a group', MAP.groups.every(g => new Set(g.rows.map(r => r.ticker)).size === g.rows.length));
  ok('defaultPeriod is one of the periods', MAP.periods.indexOf(MAP.defaultPeriod) >= 0);
  ok('curve has points with yields', MAP.curve.points.length >= 8 && MAP.curve.points.every(p => Number.isFinite(p.yield)));
  ok('curve points are in maturity order', MAP.curve.points.every((p, i, a) => i === 0 || p.years > a[i-1].years));
  ok('the read has points', (MAP.read.points || []).length >= 4);
  ok('attribution names Bigdata.com with a link', /Bigdata\.com/.test(MAP.attribution) && /https:\/\/bigdata\.com/.test(MAP.attribution));
  ok('disclaimer says it is not advice', /not trading advice/i.test(MAP.disclaimer));
  ok('sources are named', (MAP.sources || []).length > 0);

  // ---- 2. the full page renders ---------------------------------------
  let p = await open(b, BASE + '/market-map.html', fresh());
  let r = await p.evaluate(() => {
    const el = document.getElementById('mm-page');
    return {
      text: el.textContent,
      groups: el.querySelectorAll('.mm-heat').length,
      cells: el.querySelectorAll('.mm-cell').length,
      painted: el.querySelectorAll('.mm-cell[class*="mm-b"]').length,
      dashes: Array.from(el.querySelectorAll('.mm-cell'))
        .filter((c) => /^[\u2013\u2014-]$/.test((c.textContent || '').trim())).length,
      chips: el.querySelectorAll('.mm-chip').length,
      onChips: el.querySelectorAll('.mm-chip.is-on').length,
      curve: !!el.querySelector('svg.mm-curve'),
      curvePts: el.querySelectorAll('.mm-curve-dot').length,
      legend: el.querySelectorAll('.mm-legend .mm-key').length,
      stale: !!el.querySelector('.mm-stale'),
      strip: el.querySelectorAll('#mm-strip-inline .mm-bar-row').length,
      readPts: el.querySelectorAll('.mm-points li').length,
      caption: el.querySelectorAll('table.mm-heat caption').length,
      rowHeaders: el.querySelectorAll('table.mm-heat th[scope="row"]').length,
      colHeaders: el.querySelectorAll('table.mm-heat thead th[scope="col"]').length
    };
  });
  const totalRows = MAP.groups.reduce((n, g) => n + g.rows.length, 0);
  ok('no page errors', p.__errs.length === 0, p.__errs.join(' | '));
  ok('renders every group as a table', r.groups === MAP.groups.length, r.groups + '');
  ok('renders every cell', r.cells === totalRows * MAP.periods.length, r.cells + '');
  // A cell whose value the tearsheet did not carry is null by design and
  // renders as a dash — it has no return, so it cannot have a colour bucket.
  // Assert the two populations add up instead of demanding every cell be
  // painted, which was only true while the source happened to fill every
  // window.
  const nulls = MAP.groups.reduce((n, g) =>
    n + g.rows.reduce((m, row) => m + row.v.filter((x) => x === null).length, 0), 0);
  ok('every cell with a value got a colour bucket',
     r.painted === r.cells - nulls, r.painted + ' painted + ' + nulls + ' blank of ' + r.cells);
  ok('every cell without a value renders as a dash',
     r.dashes === nulls, r.dashes + ' dashes for ' + nulls + ' nulls');
  ok('period chips rendered', r.chips === MAP.periods.length);
  ok('exactly one chip is selected', r.onChips === 1);
  ok('curve chart rendered', r.curve);
  ok('curve has a marker per maturity', r.curvePts === MAP.curve.points.length);
  ok('curve has a two-entry legend', r.legend === 2);
  ok('the read is rendered', r.readPts === MAP.read.points.length);
  ok('leaders strip rendered on the page', r.strip === 12, r.strip + ' rows');
  ok('fresh map shows no stale warning', !r.stale);
  ok('every grid has a caption for screen readers', r.caption === MAP.groups.length);
  ok('every data row has a row header', r.rowHeaders === totalRows);
  ok('column headers are marked as such', r.colHeaders === MAP.groups.length * (MAP.periods.length + 2));
  ok('headline is on the page', r.text.indexOf(MAP.read.headline) !== -1);
  ok('data source is credited', /Bigdata\.com/.test(r.text));

  // ---- 3. colour is never the only encoding ----------------------------
  const enc = await p.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.mm-cell'));
    const blank = cells.filter(c => !c.textContent.trim()).length;
    const noSign = cells.filter(c => { const t = c.textContent.trim();
      return t !== '\u2013' && !/^[+-]/.test(t) && !/^0(\.0+)?%$/.test(t); }).length;
    return { total: cells.length, blank: blank, noSign: noSign };
  });
  ok('no cell relies on colour alone — all print a value', enc.blank === 0, enc.blank + ' blank');
  ok('every non-zero value carries its sign in the text', enc.noSign === 0, enc.noSign + ' unsigned');

  // ---- 4. text on every fill clears 4.5:1 ------------------------------
  const inks = await p.evaluate(() => {
    const seen = {};
    document.querySelectorAll('.mm-cell').forEach(c => {
      const s = getComputedStyle(c);
      const k = c.className.match(/mm-b[du]?\d/);
      if (k && !seen[k[0]]) seen[k[0]] = [s.backgroundColor, s.color];
    });
    return seen;
  });
  Object.keys(inks).forEach(k => {
    const c = contrast(rgb(inks[k][0]), rgb(inks[k][1]));
    ok('dark mode: ink on ' + k + ' clears 4.5:1', c >= 4.5, c.toFixed(2) + ':1');
  });

  // ---- 5. the period control actually changes something ----------------
  const before = await p.evaluate(() => {
    const t = document.querySelector('#mm-g-sectors table tbody');
    return Array.from(t.querySelectorAll('th[scope="row"]')).map(x => x.firstChild.textContent);
  });
  await p.click('.mm-chip[data-period="YTD"]');
  await p.waitForTimeout(250);
  const after = await p.evaluate(() => {
    const t = document.querySelector('#mm-g-sectors table tbody');
    return {
      order: Array.from(t.querySelectorAll('th[scope="row"]')).map(x => x.firstChild.textContent),
      on: document.querySelectorAll('.mm-chip.is-on').length,
      onLabel: document.querySelector('.mm-chip.is-on').textContent,
      strip: document.querySelector('#mm-strip-inline h3').textContent,
      onCol: document.querySelectorAll('#mm-g-sectors thead th.is-on').length
    };
  });
  ok('changing the period re-sorts the board', JSON.stringify(before) !== JSON.stringify(after.order));
  ok('still exactly one chip selected after a change', after.on === 1);
  ok('the selected chip is the one clicked', after.onLabel === 'YTD');
  ok('the selected column is highlighted', after.onCol === 1);
  ok('the strip follows the selected period', /YTD/.test(after.strip), after.strip);
  const ytdOrder = await p.evaluate(() => Array.from(
    document.querySelectorAll('#mm-g-sectors table tbody tr'))
    .map(tr => parseFloat(tr.querySelectorAll('.mm-cell')[5].textContent)));
  ok('rendered order is descending by the selected window',
     ytdOrder.every((v, i) => i === 0 || v <= ytdOrder[i - 1]), ytdOrder.join(' '));

  // The board's best 1D name must be the strip's first leader.
  await p.click('.mm-chip[data-period="1D"]');
  await p.waitForTimeout(250);
  const lead = await p.evaluate(() => {
    const up = document.querySelectorAll('#mm-strip-inline .mm-strip-col')[0];
    const down = document.querySelectorAll('#mm-strip-inline .mm-strip-col')[1];
    return { top: up.querySelector('.mm-bar-label').textContent,
             topV: up.querySelector('.mm-bar-val').textContent,
             bottom: down.querySelector('.mm-bar-label').textContent,
             bottomV: down.querySelector('.mm-bar-val').textContent };
  });
  const all1d = [];
  MAP.groups.filter(g => !g.excess).forEach(g => g.rows.forEach(x => all1d.push({ l: x.label, v: x.v[0] })));
  all1d.sort((a, c) => c.v - a.v);
  ok('strip leader matches the data', lead.top === all1d[0].l, lead.top + ' vs ' + all1d[0].l);
  ok('strip laggard matches the data', lead.bottom === all1d[all1d.length - 1].l, lead.bottom + ' vs ' + all1d[all1d.length - 1].l);
  const factorNames = MAP.groups.filter(g => g.excess).reduce((a, g) => a.concat(g.rows.map(r => r.label)), []);
  const stripNames = await p.evaluate(() => Array.from(
    document.querySelectorAll('#mm-strip-inline .mm-bar-label')).map(x => x.textContent));
  ok('excess-return rows are never ranked against outright returns',
     stripNames.every(n => factorNames.indexOf(n) === -1),
     stripNames.filter(n => factorNames.indexOf(n) !== -1).join(', '));
  ok('the strip says why factors are held out', await p.evaluate(() =>
     /excess return/i.test(document.querySelector('.mm-strip-foot').textContent)));
  ok('leader value printed with a sign', /^[+-]/.test(lead.topV), lead.topV);

  // Bars are marks on the track, so the contrast that matters is against the
  // track colour, not against the page.
  const bars = await p.evaluate(() => {
    const seen = {};
    document.querySelectorAll('.mm-bar-fill').forEach(f => {
      const k = (f.className.match(/mm-b[du]\d/) || [])[0];
      if (k && !seen[k]) seen[k] = [getComputedStyle(f).backgroundColor,
                                    getComputedStyle(f.parentNode).backgroundColor];
    });
    return seen;
  });
  Object.keys(bars).forEach(k => {
    const c = contrast(rgb(bars[k][0]), rgb(bars[k][1]));
    ok('bar step ' + k + ' clears 2:1 against its track', c >= 2, c.toFixed(2) + ':1');
  });

  // ---- 6. no horizontal overflow on the body ---------------------------
  const of = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  ok('page does not scroll horizontally', of.doc <= of.win + 1, of.doc + ' vs ' + of.win);
  await p.close();

  // ---- 7. light mode is its own palette, and it also clears -----------
  p = await open(b, BASE + '/market-map.html', fresh(), null, 'day');
  const lightInks = await p.evaluate(() => {
    const seen = {};
    document.querySelectorAll('.mm-cell').forEach(c => {
      const s = getComputedStyle(c);
      const k = c.className.match(/mm-b[du]?\d/);
      if (k && !seen[k[0]]) seen[k[0]] = [s.backgroundColor, s.color];
    });
    return { seen: seen, theme: document.documentElement.getAttribute('data-theme') };
  });
  ok('light theme applied', lightInks.theme === 'light');
  let differs = 0;
  Object.keys(lightInks.seen).forEach(k => {
    const c = contrast(rgb(lightInks.seen[k][0]), rgb(lightInks.seen[k][1]));
    ok('light mode: ink on ' + k + ' clears 4.5:1', c >= 4.5, c.toFixed(2) + ':1');
    if (inks[k] && inks[k][0] !== lightInks.seen[k][0]) differs++;
  });
  ok('light mode uses its own steps, not the dark ones', differs === Object.keys(lightInks.seen).length, differs + '');
  await p.close();

  // ---- 8. stale ---------------------------------------------------------
  p = await open(b, BASE + '/market-map.html', stale());
  r = await p.evaluate(() => {
    const el = document.getElementById('mm-page');
    return { stale: !!el.querySelector('.mm-stale'), cells: el.querySelectorAll('.mm-cell').length, text: el.textContent };
  });
  ok('stale map warns', r.stale);
  ok('stale map still shows the numbers, dated', r.cells > 0);
  ok('stale wording says history not board', /history/i.test(r.text));
  await p.close();

  // ---- 9. a missing file must not break a page -------------------------
  p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs9 = []; p.on('pageerror', e => errs9.push(e.message));
  await p.addInitScript(stub);
  await p.route(/market-map\.json/, r2 => r2.fulfill({ status: 404, body: 'nope' }));
  await p.route(/^https?:\/\/(?!localhost)/, r2 => r2.abort());
  await p.goto(BASE + '/market-map.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(800);
  const miss = await p.evaluate(() => ({ msg: document.getElementById('mm-page').textContent }));
  ok('a missing file shows a message, not a blank page', /could not be loaded/i.test(miss.msg));
  ok('a missing file throws no uncaught error', errs9.length === 0, errs9.join(' | '));
  await p.close();

  // ---- 10. the strip on the brief page and the dashboard ---------------
  p = await open(b, BASE + '/market-brief.html', fresh());
  r = await p.evaluate(() => {
    const s = document.getElementById('mm-strip');
    return { hidden: s.hidden, bars: s.querySelectorAll('.mm-bar-row').length,
             link: !!s.querySelector('a[href="market-map.html"]'),
             briefStill: !!document.querySelector('#mb-page .mb-points li') };
  });
  ok('brief page shows the strip', !r.hidden && r.bars === 10, r.bars + ' bars');
  ok('strip links through to the map', r.link);
  ok('the brief itself still renders alongside it', r.briefStill);
  ok('brief page has no errors with both modules', p.__errs.length === 0, p.__errs.join(' | '));
  await p.close();

  p = await open(b, BASE + '/dashboard-user.html', fresh());
  r = await p.evaluate(() => {
    const s = document.getElementById('dash-map');
    return { present: !!s, hidden: s ? s.hidden : true, bars: s ? s.querySelectorAll('.mm-bar-row').length : 0 };
  });
  ok('dashboard mounts the strip', r.present && !r.hidden && r.bars === 10, r.bars + ' bars');
  ok('dashboard has no errors', p.__errs.length === 0, p.__errs.slice(0, 3).join(' | '));
  await p.close();

  // ---- 11. mobile ------------------------------------------------------
  p = await open(b, BASE + '/market-map.html', fresh(), { width: 390, height: 844 });
  const m = await p.evaluate(() => ({
    doc: document.documentElement.scrollWidth, win: window.innerWidth,
    scrollers: document.querySelectorAll('.mm-scroll').length,
    firstCellVisible: !!document.querySelector('.mm-cell')
  }));
  ok('mobile: no horizontal page scroll', m.doc <= m.win + 1, m.doc + ' vs ' + m.win);
  ok('mobile: wide tables are in their own scrollers', m.scrollers > 0);
  ok('mobile: cells still render', m.firstCellVisible);
  await p.close();

  // ---- 12. the sidebar link ---------------------------------------------
  const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
  const withBrief = pages.filter(f => fs.readFileSync(ROOT + '/' + f, 'utf8').includes('href="market-brief.html" class="side-link'));
  const withMap = withBrief.filter(f => fs.readFileSync(ROOT + '/' + f, 'utf8').includes('href="market-map.html" class="side-link'));
  ok('every page with a brief link also links the map', withMap.length === withBrief.length, withMap.length + '/' + withBrief.length);
  const mmSrc = fs.readFileSync(ROOT + '/market-map.html', 'utf8');
  ok('the map page marks its own sidebar link active', /href="market-map\.html" class="side-link active"/.test(mmSrc));
  ok('the map page does not also mark the brief active', !/href="market-brief\.html" class="side-link active"/.test(mmSrc));
  ok('the brief page marks the brief active', /href="market-brief\.html" class="side-link active"/.test(fs.readFileSync(ROOT + '/market-brief.html', 'utf8')));

  await b.close();
  console.log(log.join('\n'));
  const fails = log.filter(l => l.startsWith('FAIL')).length;
  console.log('\n' + (log.length - fails) + '/' + log.length + ' passed');
  process.exit(fails ? 1 : 0);
})();
