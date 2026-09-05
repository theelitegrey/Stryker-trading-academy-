// Stryker Trading Academy — Trading Indicators showcase
//
// The suite shown at the top of the Trading Indicators page. Content lives in
// Firestore (showcaseIndicators/{id}, public read / admin write) so the
// Indicators admin can edit, remove, relink or flip a card between LIVE and
// IN DEVELOPMENT without a deploy. SHOWCASE_SEED below is the bundled
// fallback — what renders when the collection is empty or unreachable, and
// what the admin panel seeds the collection from on first use.
//
// A card with status 'live' shows the LIVE badge and its TradingView button;
// 'dev' shows IN DEVELOPMENT and no link. `img` is a rendered chart-window
// mockup (an asset path, or a data URL when uploaded from the admin); a card
// without one falls back to a small drawn scene.

var SHOWCASE_SEED = [
  {
    id: 'fvg-relay',
    order: 1,
    name: 'FVG Relay',
    status: 'live',
    tvUrl: 'https://www.tradingview.com/script/Hcuencnm-FVG-Relay-Stryker/',
    img: 'assets/images/indicator-fvg-relay.png',
    tag: 'Fair value gaps that chain into delivery',
    body: 'Displacement gaps with consequent-encroachment lines, four mitigation models, and the relay read: the moment a mitigated gap hands price into a fresh one, the chain is counted and flagged.',
    chips: ['Bull & bear FVGs', 'CE lines', '4 mitigation models', 'Relay chains', 'Size filter', 'Alerts']
  },
  {
    id: 'ifvg-pro',
    order: 2,
    name: 'IFVG Pro',
    status: 'live',
    tvUrl: 'https://www.tradingview.com/script/n7Lpx8cB-IFVG-Pro-Stryker/',
    img: 'assets/images/indicator-ifvg-pro.png',
    tag: 'Broken gaps flip roles — trade the retest',
    body: 'Tracks every gap through its whole life: formed, inverted, retested. Rejections at inverted zones print entry-style signals, with an EMA bias filter and a live respect-rate dashboard.',
    chips: ['Inversion zones', 'Retest signals', 'Trend bias filter', 'Respect-rate stats', 'Zone retirement', 'Alerts']
  },
  {
    id: 'htf-po3-lens',
    order: 3,
    name: 'HTF PO3 Lens',
    status: 'live',
    tvUrl: 'https://www.tradingview.com/script/6A3kytc5-HTF-PO3-Lens-Stryker/',
    img: 'assets/images/indicator-htf-po3.png',
    tag: 'Accumulation · Manipulation · Distribution',
    body: 'The last few higher-timeframe candles projected beside your chart, the live HTF open extended across it, and each candle read as the AMD sequence — with a real-time phase readout.',
    chips: ['HTF candles on-chart', 'Live phase readout', 'M / D labels', 'Open line', 'Any timeframe', 'Alerts']
  },
  {
    id: 'smt-divergence-pro',
    order: 4,
    name: 'SMT Divergence Pro',
    status: 'live',
    tvUrl: 'https://www.tradingview.com/script/UJLd5TSn-SMT-Divergence-Pro-Stryker/',
    img: 'assets/images/indicator-smt-pro.png',
    tag: 'One index runs the high — the other refuses',
    body: 'Plots a correlated symbol over your chart and flags the cracks: swings where one market makes a higher high or lower low and the other does not confirm, with the divergence drawn on both legs.',
    chips: ['Any pair', 'Auto swing detection', 'Bull & bear SMT', 'Divergence lines', 'Session filter', 'Alerts']
  },
  {
    id: 'liquidity-master',
    order: 5,
    name: 'Liquidity Master',
    status: 'live',
    tvUrl: 'https://www.tradingview.com/script/7db99YJA-Liquidity-Master-Stryker/',
    img: 'assets/images/indicator-liquidity-master.png',
    tag: 'Where the stops pool — and when they get swept',
    body: 'Maps the liquidity on your chart: equal highs and lows, prior-day and session extremes drawn as live pools, each level tracked until price runs it — with the sweep flagged the moment the stops are taken.',
    chips: ['Equal highs & lows', 'PDH / PDL pools', 'Session extremes', 'Sweep flags', 'Live pool tracking', 'Alerts']
  }
];

(function(){

  // Fallback scene for a card without a rendered mockup (typically a fresh
  // admin-added entry): a small candle tape with a zone and an entry arrow.
  var GENERIC_SCENE =
    '<svg viewBox="0 0 220 120" class="ind-demo-svg" aria-hidden="true">' +
      '<g stroke="#3a4150" stroke-width="1.6">' +
        '<line x1="24" y1="92" x2="24" y2="62"/><line x1="48" y1="84" x2="48" y2="48"/>' +
        '<line x1="72" y1="70" x2="72" y2="30"/></g>' +
      '<rect x="19" y="70" width="10" height="18" rx="1.5" fill="#2ea583"/>' +
      '<rect x="43" y="56" width="10" height="22" rx="1.5" fill="#cf4046"/>' +
      '<rect x="67" y="36" width="10" height="26" rx="1.5" fill="#2ea583"/>' +
      '<rect x="84" y="40" width="110" height="18" rx="3" fill="rgba(3,201,136,0.14)" stroke="rgba(3,201,136,0.5)"/>' +
      '<path d="M80 34 L104 50 L126 46 L152 26 L182 12" fill="none" stroke="#eeeeee" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>';

  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Only http(s) URLs make it into an href — showcase content is stored data,
  // and an admin-typed link should never be able to smuggle a javascript: URI.
  function safeUrl(u){
    return /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
  }

  function cardHtml(it, i){
    var live = it.status === 'live' && safeUrl(it.tvUrl);
    var chips = (it.chips || []).map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('');
    var demo = it.img
      ? '<div class="ind-demo is-img"><img src="' + esc(it.img) + '" alt="' + esc(it.name) + ' on a chart" loading="lazy"></div>'
      : '<div class="ind-demo">' + GENERIC_SCENE + '</div>';

    return '<article class="ind-card' + (live ? ' is-live' : '') + '" style="animation-delay:' + (0.08 * i) + 's">' +
      demo +
      '<div class="ind-card-body">' +
        '<div class="ind-card-top"><h3>' + esc(it.name) + '</h3>' +
          (live
            ? '<span class="ind-dev ind-live"><i></i>LIVE</span>'
            : '<span class="ind-dev"><i></i>IN DEVELOPMENT</span>') +
        '</div>' +
        (it.tag ? '<p class="ind-tag">' + esc(it.tag) + '</p>' : '') +
        (it.body ? '<p class="ind-body">' + esc(it.body) + '</p>' : '') +
        (chips ? '<div class="ind-chips">' + chips + '</div>' : '') +
        (live
          ? '<a class="btn btn-primary btn-sm ind-tv-link" href="' + esc(safeUrl(it.tvUrl)) + '" target="_blank" rel="noopener noreferrer">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="margin-right:7px; vertical-align:-2px;"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>' +
            'View on TradingView</a>'
          : '') +
      '</div>' +
    '</article>';
  }

  function render(items){
    var host = document.getElementById('indicators-showcase');
    if (!host || !items.length) return;

    var liveCount = items.filter(function (it) { return it.status === 'live'; }).length;
    var blurb = liveCount === items.length
      ? 'Built in-house for the way the curriculum trades. The full suite is live on TradingView — access lands automatically once your username above is approved.'
      : (liveCount === 0
        ? 'Built in-house for the way the curriculum trades. Finishing TradingView review now — access lands automatically once your username above is approved.'
        : 'Built in-house for the way the curriculum trades. ' + liveCount + ' of ' + items.length + ' are live on TradingView; the rest are finishing review — access lands automatically once your username above is approved.');

    host.innerHTML =
      '<div class="ind-sc-head">' +
        '<h2>The Stryker indicator suite</h2>' +
        '<p>' + blurb + '</p>' +
      '</div>' +
      '<div class="ind-sc-grid">' + items.map(cardHtml).join('') + '</div>';
  }

  // Firestore first, bundled seed as the fallback — the same shape the
  // chapters and models stores use.
  function loadShowcaseIndicators(){
    if (typeof db === 'undefined' || !db) return Promise.resolve(SHOWCASE_SEED);
    return db.collection('showcaseIndicators').get().then(function (snap) {
      var items = [];
      snap.forEach(function (d) { items.push(d.data()); });
      items.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      return items.length ? items : SHOWCASE_SEED;
    }).catch(function () { return SHOWCASE_SEED; });
  }
  window.loadShowcaseIndicators = loadShowcaseIndicators;

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.getElementById('indicators-showcase')) return;
    render(SHOWCASE_SEED);                    // instant paint from the bundle
    loadShowcaseIndicators().then(render);    // then whatever the admin saved
  });
})();
