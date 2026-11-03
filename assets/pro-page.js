// TradeZoro /pro: renders the groups and the Free vs Pro list from assets/pro-features-data.js. No prices here.
(function () {
  var D = window.STRYKER_PRO_FEATURES; if (!D) return;
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var INTRO = {
    book: 'The resting orders at every price. Most of these need the L2 order book feed.',
    flow: 'Who bought and who sold at each price. Most of these use L1: every trade plus the best bid and ask.',
    gex: 'Options positioning turned into levels on your chart and on the GEX+ page.',
    live: 'What data you get, in plain words.',
    soon: 'Being built now. They appear on the chart as soon as they are registered.'
  };
  var ico = function (k) { return '<svg class="ci" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + (D.icons[k] || D.icons.list) + '"/></svg>'; };
  function card(it) {
    var chip = it.soon ? '<span class="pp-chip pp-soon">Coming soon</span>' : it.feed !== '—' ? '<span class="pp-chip pp-' + it.feed.toLowerCase() + '">' + it.feed + '</span>' : '';
    return '<li class="pp-card' + (it.soon ? ' is-soon' : '') + '"><div class="pp-ch"><span class="cm-lico">' + ico(it.icon) + '</span>' + chip + '</div>' +
      '<h3>' + esc(it.name) + '</h3><p>' + esc(it.desc) + '</p></li>';
  }
  var out = '';
  Object.keys(D.groups).forEach(function (g) {
    var items = D.items.filter(function (i) { return i.group === g; });
    if (!items.length) return;
    var shot = items.filter(function (i) { return i.img && g !== 'soon'; })[0];
    out += '<section class="cm-sec" id="g-' + g + '" aria-labelledby="h-' + g + '"><div class="cm-w"><div class="cm-head2"><span class="cm-eyebrow">' + (g === 'soon' ? 'Next' : 'Pro') + '</span><h2 id="h-' + g + '">' + D.groups[g] + '</h2><p>' + INTRO[g] + '</p></div>' +
      '<ul class="pp-grid">' + items.map(card).join('') + '</ul></div></section>';
  });
  document.getElementById('pp-groups').innerHTML = out;

  // Free vs Pro: [row, free, pro] true = included, false = not included, string = note
  var ROWS = [
    ['Charts, every chart type, drawings and indicators', true, true],
    ['Replay One, alerts, layouts and paper trading', true, true],
    ['Lessons, JournalX, Market Stats, ZoroTide, Liquidity Map overview', true, true],
    ['Community: read everything', true, true],
    ['Order flow: Footprint, Delta, CVD, Big Trades, Absorption, Stop Runs, Imbalance Zones', false, true],
    ['Volume Profile, VWAP and Market Profile from trades', false, true],
    ['Order book heatmap, DOM ladder, Book · DOM · Trades panel', false, true],
    ['Liquidity Walls and Book Imbalance', false, true],
    ['GEX+ levels, heatmap and Expected Move on charts', false, true],
    ['GEX+ page: every expiry, strike table, futures levels', 'Same-day SPX', true],
    ['Live CME futures data', 'Separate; 10 min delayed without it', 'Separate; 10 min delayed without it']
  ];
  var cell = function (v) { return v === true ? '<span class="pp-y" aria-label="Included">✓</span>' : v === false ? '<span class="pp-n" aria-label="Not included">—</span>' : '<span class="pp-t">' + esc(v) + '</span>'; };
  document.getElementById('pp-cmp').innerHTML =
    '<div class="pp-r pp-rh" role="row"><span role="columnheader">&nbsp;</span><span role="columnheader">Free</span><span role="columnheader">Pro</span></div>' +
    ROWS.map(function (r) {
      return '<div class="pp-r" role="row"><span class="pp-rn" role="rowheader">' + esc(r[0]) + '</span><span class="pp-c" role="cell" data-l="Free">' + cell(r[1]) + '</span><span class="pp-c" role="cell" data-l="Pro">' + cell(r[2]) + '</span></div>';
    }).join('');
})();
