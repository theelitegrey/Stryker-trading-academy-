// Stryker Trading Academy — Smart Money (smart-money.html)
// Depends on: assets/auth.js, assets/progress.js (db), assets/roles.js,
//             assets/plan-modal.js (openPlanUpgradeModal)
//
// The public record of what US politicians and corporate insiders are
// actually trading, refreshed daily. Data comes from LuxAlgo's
// market-trackers-data repository (CC0 / public domain): normalized JSON
// parsed from primary government sources only (SEC EDGAR, Senate eFD, the
// House Clerk), every row carrying a deep link to the official filing it was
// parsed from. Fetched straight from the repo's stable URLs — no API keys,
// no backend, no cost.
//
// PLAN GATE: Elite (rank 2+), same pattern as the live room in
// live-sessions.js — gated by RANK so plan renames don't break it, admins
// bypass, unresolvable plan data fails open. Locked students see the page
// framing and an upgrade pitch, never the tables (and no fetch happens).

const SM_MIN_RANK = 2;

// jsDelivr first (CDN-cached, fast worldwide), raw GitHub as the fallback.
// Both send permissive CORS headers.
const SM_SOURCES = [
  'https://cdn.jsdelivr.net/gh/LuxAlgo/market-trackers-data@main/',
  'https://raw.githubusercontent.com/LuxAlgo/market-trackers-data/main/'
];

const SM_CACHE_KEY = 'stryker_sm_cache_v1';
const SM_CACHE_MS = 6 * 3600000;   // data updates daily; 6h is plenty fresh

let SM_CONGRESS = [];
let SM_INSIDER = [];
let SM_GENERATED = null;
let SM_CG_FILTER = 'all';
let SM_IN_FILTER = 'buys';

function smEsc(s){
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function smFetchJson(path){
  let chain = Promise.reject();
  SM_SOURCES.forEach((base) => {
    chain = chain.catch(() => fetch(base + path, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(path + ' → ' + r.status);
      return r.json();
    }));
  });
  return chain;
}

function smMoney(n){
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
}

function smDay(s){
  if (!s) return '';
  try {
    const d = new Date(s + (s.length === 10 ? 'T00:00' : ''));
    return isNaN(d) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (e) { return s; }
}

function smAgo(iso){
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms) || ms < 0) return '';
  const h = Math.floor(ms / 3600000);
  if (h < 1) return Math.max(1, Math.floor(ms / 60000)) + ' min ago';
  if (h < 48) return h + 'h ago';
  return Math.floor(h / 24) + ' days ago';
}

// ---- data -------------------------------------------------------------------

// Congress trades: the whole dataset is small (a few hundred rows), so pull
// the gzipped snapshot when the browser can decompress it; otherwise the
// newest daily delta still gives a useful table.
function smLoadCongress(){
  if (typeof DecompressionStream === 'function') {
    let chain = Promise.reject();
    SM_SOURCES.forEach((base) => {
      chain = chain.catch(() => fetch(base + 'congress/trades/snapshot.json.gz', { cache: 'no-cache' })
        .then((r) => {
          if (!r.ok) throw new Error('snapshot ' + r.status);
          const ds = new DecompressionStream('gzip');
          return new Response(r.body.pipeThrough(ds)).json();
        }));
    });
    return chain.catch(() => smFetchJson('congress/trades/latest.json'));
  }
  return smFetchJson('congress/trades/latest.json');
}

function smTrimInsider(rows){
  // Keep only what the table renders, so the sessionStorage cache stays small.
  return rows.map((r) => ({
    ticker: r.ticker, issuerName: r.issuerName,
    insider: { name: r.insider && r.insider.name, title: r.insider && r.insider.title },
    code: r.code, transactedAt: r.transactedAt, filedAt: r.filedAt,
    shares: r.shares, pricePerShare: r.pricePerShare, isDerivative: r.isDerivative,
    provenance: { sourceUrl: r.provenance && r.provenance.sourceUrl }
  }));
}

function smLoadAll(){
  try {
    const c = JSON.parse(sessionStorage.getItem(SM_CACHE_KEY));
    if (c && Date.now() - c.ts < SM_CACHE_MS && Array.isArray(c.congress) && Array.isArray(c.insider)) {
      SM_CONGRESS = c.congress; SM_INSIDER = c.insider; SM_GENERATED = c.generatedAt;
      return Promise.resolve();
    }
  } catch (e) {}

  return Promise.all([
    smLoadCongress(),
    smFetchJson('insider/transactions/latest.json'),
    smFetchJson('manifest.json').catch(() => null)
  ]).then(([congress, insider, manifest]) => {
    SM_CONGRESS = Array.isArray(congress) ? congress : [];
    SM_INSIDER = smTrimInsider(Array.isArray(insider) ? insider : []);
    SM_GENERATED = manifest && manifest.generatedAt || null;
    try {
      sessionStorage.setItem(SM_CACHE_KEY, JSON.stringify({
        ts: Date.now(), generatedAt: SM_GENERATED,
        congress: SM_CONGRESS.slice(0, 600), insider: SM_INSIDER.slice(0, 2000)
      }));
    } catch (e) {}
  });
}

// ---- overview: stat tiles + charts ------------------------------------------
// Chart colors are the site's bull/bear semantics. Validated (dataviz skill):
// CVD ΔE 10.9 deutan / 35.2 normal / contrast ≥3:1 on the dark surface; on the
// light surface the green warns on contrast, so every mark carries a direct
// label and the lists below double as the table view — color is never the
// only encoding (labels + position separate buys from sells).

function smIsBuySide(r){
  return String(r.side || '').toLowerCase().indexOf('sell') !== 0;
}

function smMidAmount(r){
  const a = r.amountRange || {};
  if (typeof a.min === 'number' && typeof a.max === 'number') return (a.min + a.max) / 2;
  return typeof a.min === 'number' ? a.min : 0;
}

function smTile(label, value, sub){
  return '<div class="sm-tile"><span class="sm-tile-label">' + label + '</span>' +
    '<b>' + value + '</b><span class="sm-tile-sub">' + sub + '</span></div>';
}

function smRenderOverview(){
  const host = document.getElementById('sm-overview');
  if (!host) return;
  const cg = SM_CONGRESS;
  const cgBuys = cg.filter(smIsBuySide).length;
  const cgSells = cg.length - cgBuys;
  const insBuys = SM_INSIDER.filter((r) => r.code === 'P');
  const insSells = SM_INSIDER.filter((r) => r.code === 'S');
  const insBuyVal = insBuys.reduce((s, r) => s + (smInsiderValue(r) || 0), 0);
  const insSellVal = insSells.reduce((s, r) => s + (smInsiderValue(r) || 0), 0);
  const buyPct = cg.length ? Math.round(cgBuys / cg.length * 100) : 0;

  const tiles = '<div class="sm-stats">' +
    smTile('Congress trades tracked', cg.length.toLocaleString(),
      cgBuys + ' buys · ' + cgSells + ' sells') +
    smTile('Hill sentiment', buyPct + '%', 'of disclosed trades are buys') +
    smTile('Insider buying', smMoney(insBuyVal), insBuys.length + ' open-market buy filings') +
    smTile('Insider selling', smMoney(insSellVal), insSells.length + ' sale filings') +
    '</div>';

  // Most-traded tickers on the Hill: stacked buy/sell counts, widest = most traded.
  const byTicker = {};
  cg.forEach((r) => {
    if (!r.ticker) return;
    const t = byTicker[r.ticker] || (byTicker[r.ticker] = { b: 0, s: 0 });
    if (smIsBuySide(r)) t.b++; else t.s++;
  });
  const top = Object.keys(byTicker)
    .map((k) => ({ tkr: k, b: byTicker[k].b, s: byTicker[k].s, n: byTicker[k].b + byTicker[k].s }))
    .sort((a, b) => b.n - a.n).slice(0, 6);
  const maxN = top.length ? top[0].n : 1;
  const hillRows = top.map((t) =>
    '<div class="smc-row">' +
      '<span class="smc-tkr">' + smEsc(t.tkr) + '</span>' +
      '<div class="smc-track" style="width:' + Math.max(6, t.n / maxN * 100) + '%">' +
        (t.b ? '<i class="smc-seg is-buy" style="flex:' + t.b + '" title="' + t.b + ' buy' + (t.b === 1 ? '' : 's') + '"></i>' : '') +
        (t.s ? '<i class="smc-seg is-sell" style="flex:' + t.s + '" title="' + t.s + ' sell' + (t.s === 1 ? '' : 's') + '"></i>' : '') +
      '</div>' +
      '<span class="smc-n">' + t.n + '</span>' +
    '</div>').join('');
  const hill = '<div class="panel sm-chart">' +
    '<div class="panel-head"><h3>Most traded on the Hill</h3>' +
      '<div class="sm-legend"><span><i class="is-buy"></i>Buys</span><span><i class="is-sell"></i>Sells</span></div></div>' +
    (top.length ? hillRows + '<p class="sm-chart-note">trades per ticker across tracked congressional filings</p>'
                : '<p class="sm-empty">No ticker-level congressional trades in the current data.</p>') +
    '</div>';

  // Insider flow: biggest buy/sell tickers by dollar value, one column each so
  // position (not just color) separates the sides.
  const agg = (list) => {
    const m = {};
    list.forEach((r) => {
      const v = smInsiderValue(r);
      if (!v || !r.ticker) return;
      m[r.ticker] = (m[r.ticker] || 0) + v;
    });
    return Object.keys(m).map((k) => ({ tkr: k, v: m[k] }))
      .sort((a, b) => b.v - a.v).slice(0, 5);
  };
  const topB = agg(insBuys), topS = agg(insSells);
  const maxV = Math.max(topB[0] ? topB[0].v : 0, topS[0] ? topS[0].v : 0, 1);
  const flowCol = (rows, cls, head) =>
    '<div><div class="smf-h"><i class="' + cls + '"></i>' + head + '</div>' +
    (rows.length ? rows.map((r) =>
      '<div class="smf-row" title="' + smEsc(r.tkr) + ' · ' + smMoney(r.v) + '">' +
        '<div class="smf-top"><span class="smc-tkr">' + smEsc(r.tkr) + '</span><span class="smc-n">' + smMoney(r.v) + '</span></div>' +
        '<i class="smf-bar ' + cls + '" style="width:' + Math.max(4, r.v / maxV * 100) + '%"></i>' +
      '</div>').join('') : '<p class="sm-empty">None in the latest filings.</p>') +
    '</div>';
  const flow = '<div class="panel sm-chart">' +
    '<div class="panel-head"><h3>Insider flow — latest filings</h3></div>' +
    '<div class="sm-flow-cols">' + flowCol(topB, 'is-buy', 'Biggest buying') + flowCol(topS, 'is-sell', 'Biggest selling') + '</div>' +
    '<p class="sm-chart-note">open-market value per ticker, both columns on one shared scale</p>' +
    '</div>';

  host.innerHTML = tiles + '<div class="sm-viz-grid">' + hill + flow + '</div>';
}

// ---- congress panel ---------------------------------------------------------

const SM_PARTY_C = { Republican: '#e5484d', Democrat: '#4d7ce5' };

function smSideChip(side){
  const s = String(side || '').toLowerCase();
  const isSell = s.indexOf('sell') === 0;
  const label = isSell ? 'SELL' : (s.indexOf('buy') === 0 || s === 'purchase' ? 'BUY' : (side || '—').toUpperCase());
  return '<span class="sm-side ' + (isSell ? 'is-sell' : 'is-buy') + '">' + smEsc(label) + '</span>';
}

function smRenderCongress(){
  const wrap = document.getElementById('sm-congress-list');
  if (!wrap) return;
  const q = (document.getElementById('sm-congress-q').value || '').trim().toLowerCase();
  let rows = SM_CONGRESS.slice();
  if (SM_CG_FILTER !== 'all') {
    rows = rows.filter((r) => {
      const isBuy = String(r.side).toLowerCase().indexOf('sell') !== 0;
      return SM_CG_FILTER === 'buy' ? isBuy : !isBuy;
    });
  }
  if (q) {
    rows = rows.filter((r) =>
      (r.member && r.member.name || '').toLowerCase().includes(q) ||
      (r.ticker || '').toLowerCase().includes(q) ||
      (r.assetDescription || '').toLowerCase().includes(q));
  }
  rows.sort((a, b) => String(b.filedAt || '').localeCompare(String(a.filedAt || '')) ||
                      String(b.transactedAt || '').localeCompare(String(a.transactedAt || '')));
  rows = rows.slice(0, 80);

  if (!rows.length) {
    wrap.innerHTML = '<p class="sm-empty">Nothing matches.</p>';
    return;
  }
  const maxMid = Math.max.apply(null, rows.map(smMidAmount).concat([1]));
  wrap.innerHTML = rows.map((r) => {
    const m = r.member || {};
    const pc = SM_PARTY_C[m.party] || '#8b93a0';
    const isBuy = smIsBuySide(r);
    const mid = smMidAmount(r);
    const asset = r.ticker
      ? '<span class="sm-tkr">' + smEsc(r.ticker) + '</span>'
      : '<span class="sm-asset" title="' + smEsc(r.assetDescription) + '">' +
          smEsc((r.assetDescription || 'Unnamed asset').slice(0, 60)) + '</span>';
    return '<div class="record-card sm-row">' +
      '<div class="sm-main">' +
        '<div class="sm-line1">' + smSideChip(r.side) + asset +
          (r.owner && r.owner !== 'self' ? '<span class="sm-owner">' + smEsc(r.owner) + '</span>' : '') + '</div>' +
        '<div class="sm-line2"><i class="sm-party" style="background:' + pc + '"></i>' +
          smEsc(m.name || 'Unknown member') +
          (m.state ? ' <span class="sm-dim">(' + smEsc(m.party ? m.party[0] + '-' : '') + smEsc(m.state) + ')</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="sm-side-col">' +
        '<b>' + smEsc(r.amountRange && r.amountRange.text || '—') + '</b>' +
        (mid ? '<span class="sm-valbar"><i class="' + (isBuy ? 'is-buy' : 'is-sell') + '" style="width:' + Math.max(4, mid / maxMid * 100) + '%"></i></span>' : '') +
        '<span class="sm-dim">traded ' + smDay(r.transactedAt) + ' · filed ' + smDay(r.filedAt) + '</span>' +
        (r.provenance && r.provenance.sourceUrl
          ? '<a href="' + smEsc(r.provenance.sourceUrl) + '" target="_blank" rel="noopener" class="sm-src">official filing ↗</a>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

// ---- insider panel ----------------------------------------------------------

const SM_CODE = { P: 'BUY', S: 'SELL', A: 'AWARD', M: 'EXERCISE', G: 'GIFT', F: 'TAX', D: 'DISPOSED', C: 'CONVERT' };

function smInsiderValue(r){
  return (typeof r.shares === 'number' && typeof r.pricePerShare === 'number')
    ? r.shares * r.pricePerShare : null;
}

function smRenderInsider(){
  const wrap = document.getElementById('sm-insider-list');
  if (!wrap) return;
  const q = (document.getElementById('sm-insider-q').value || '').trim().toLowerCase();
  let rows = SM_INSIDER.slice();
  if (SM_IN_FILTER === 'buys') rows = rows.filter((r) => r.code === 'P');
  else if (SM_IN_FILTER === 'sells') rows = rows.filter((r) => r.code === 'S');
  if (q) {
    rows = rows.filter((r) =>
      (r.ticker || '').toLowerCase().includes(q) ||
      (r.issuerName || '').toLowerCase().includes(q) ||
      (r.insider && r.insider.name || '').toLowerCase().includes(q));
  }
  if (SM_IN_FILTER === 'all') {
    rows.sort((a, b) => String(b.filedAt || '').localeCompare(String(a.filedAt || '')));
  } else {
    rows.sort((a, b) => (smInsiderValue(b) || 0) - (smInsiderValue(a) || 0));
  }
  rows = rows.slice(0, 80);

  if (!rows.length) {
    wrap.innerHTML = '<p class="sm-empty">Nothing matches.</p>';
    return;
  }
  const maxVal = Math.max.apply(null, rows.map((r) => smInsiderValue(r) || 0).concat([1]));
  wrap.innerHTML = rows.map((r) => {
    const code = SM_CODE[r.code] || r.code || '—';
    const isBuy = r.code === 'P';
    const isSell = r.code === 'S';
    const val = smInsiderValue(r);
    return '<div class="record-card sm-row">' +
      '<div class="sm-main">' +
        '<div class="sm-line1">' +
          '<span class="sm-side ' + (isBuy ? 'is-buy' : (isSell ? 'is-sell' : 'is-other')) + '">' + smEsc(code) + '</span>' +
          (r.ticker ? '<span class="sm-tkr">' + smEsc(r.ticker) + '</span>' : '') +
          '<span class="sm-asset">' + smEsc((r.issuerName || '').slice(0, 44)) + '</span>' +
          (r.isDerivative ? '<span class="sm-owner">derivative</span>' : '') + '</div>' +
        '<div class="sm-line2">' + smEsc(r.insider && r.insider.name || 'Unknown insider') +
          (r.insider && r.insider.title ? ' <span class="sm-dim">· ' + smEsc(r.insider.title) + '</span>' : '') + '</div>' +
      '</div>' +
      '<div class="sm-side-col">' +
        '<b>' + smMoney(val) + '</b>' +
        (val ? '<span class="sm-valbar"><i class="' + (isBuy ? 'is-buy' : (isSell ? 'is-sell' : 'is-other')) + '" style="width:' + Math.max(4, val / maxVal * 100) + '%"></i></span>' : '') +
        '<span class="sm-dim">' +
          (typeof r.shares === 'number' ? r.shares.toLocaleString() + ' sh' : '') +
          (typeof r.pricePerShare === 'number' ? ' @ $' + r.pricePerShare.toLocaleString() : '') +
          ' · ' + smDay(r.transactedAt) + '</span>' +
        (r.provenance && r.provenance.sourceUrl
          ? '<a href="' + smEsc(r.provenance.sourceUrl) + '" target="_blank" rel="noopener" class="sm-src">SEC filing ↗</a>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

// ---- gate + boot ------------------------------------------------------------

function smPlanNameForRank(minRank){
  const plans = (typeof getCachedPlansForRoles === 'function') ? getCachedPlansForRoles() : [];
  const match = plans.find((p) => (p.rank ?? 0) >= minRank);
  return match ? match.name : null;
}

function smShowLocked(){
  const locked = document.getElementById('sm-locked');
  const content = document.getElementById('sm-content');
  if (content) content.style.display = 'none';
  if (!locked) return;
  const planName = smPlanNameForRank(SM_MIN_RANK);
  const btn = document.getElementById('sm-locked-btn');
  if (btn) {
    btn.textContent = planName ? 'Go ' + planName + ' to unlock' : 'Upgrade to unlock';
    btn.dataset.upgradeReason = (planName ? planName + ' members' : 'Higher plans') +
      ' see what Congress and corporate insiders are trading, refreshed daily from official filings.';
  }
  locked.style.display = '';
}

function smShowContent(){
  const locked = document.getElementById('sm-locked');
  const content = document.getElementById('sm-content');
  if (locked) locked.style.display = 'none';
  if (content) content.style.display = '';

  smLoadAll().then(() => {
    const status = document.getElementById('sm-status');
    if (status && SM_GENERATED) status.textContent = 'Data refreshed ' + smAgo(SM_GENERATED) + ' · daily from official filings';
    smRenderOverview();
    smRenderCongress();
    smRenderInsider();
  }).catch((err) => {
    ['sm-congress-list', 'sm-insider-list'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<p class="sm-empty">Could not load the data feed — try refreshing. (' + smEsc(err.message || err) + ')</p>';
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth || !document.getElementById('sm-content')) return;

  document.getElementById('sm-congress-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('.term-cat');
    if (!btn) return;
    SM_CG_FILTER = btn.dataset.f;
    document.querySelectorAll('#sm-congress-filter .term-cat').forEach((b) => b.classList.toggle('is-on', b === btn));
    smRenderCongress();
  });
  document.getElementById('sm-insider-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('.term-cat');
    if (!btn) return;
    SM_IN_FILTER = btn.dataset.f;
    document.querySelectorAll('#sm-insider-filter .term-cat').forEach((b) => b.classList.toggle('is-on', b === btn));
    smRenderInsider();
  });
  document.getElementById('sm-congress-q').addEventListener('input', smRenderCongress);
  document.getElementById('sm-insider-q').addEventListener('input', smRenderInsider);

  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled) return;
    if (!user) {
      setTimeout(() => { if (!handled) goToLoginPreservingReturn(); }, 1500);
      return;
    }
    handled = true;
    const adminCheck = db.collection('admins').doc(user.uid).get().catch(() => null);
    const studentCheck = db.collection('students').doc(user.uid).get().catch(() => null);
    const rolesCheck = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve();
    Promise.all([adminCheck, studentCheck, rolesCheck]).then(([adminDoc, studentDoc]) => {
      if (adminDoc && adminDoc.exists) return true;   // admins see everything
      const plan = (studentDoc && studentDoc.exists) ? studentDoc.data().plan : null;
      // Unresolvable plan data fails open, same as every other gate on the site.
      if (!plan || typeof rankOf !== 'function' || typeof findPlan !== 'function' || !findPlan(plan)) return true;
      return rankOf(plan) >= SM_MIN_RANK;
    }).catch(() => true).then((allowed) => {
      if (allowed) smShowContent(); else smShowLocked();
    });
  });
});
