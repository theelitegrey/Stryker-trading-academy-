// Stryker Trading Academy — Trading Indicators showcase
// Three in-house indicators presented with animated chart vignettes, ahead
// of their TradingView release. Everything here is static/presentational —
// no downloads and no TradingView links until the scripts are published;
// access itself still runs through the TradingView-username panel above.

(function(){
  // Each demo is a hand-drawn SVG scene; the motion lives in style.css
  // keyframes keyed off the sw-* classes (one shared 7s loop per card).

  var CANDLES_BASE =
    // a small rising tape the first two scenes share (wick line + body rect)
    '<g stroke="#3a4150" stroke-width="1.6">' +
      '<line x1="18" y1="86" x2="18" y2="58"/><line x1="38" y1="78" x2="38" y2="44"/>' +
      '<line x1="58" y1="66" x2="58" y2="26"/></g>' +
    '<rect x="13" y="66" width="10" height="16" rx="1.5" fill="#2ea583"/>' +
    '<rect x="33" y="52" width="10" height="20" rx="1.5" fill="#2ea583"/>' +
    '<rect x="53" y="30" width="10" height="28" rx="1.5" fill="#2ea583"/>';

  var DEMO_FVG =
    '<svg viewBox="0 0 220 120" class="ind-demo-svg" aria-hidden="true">' +
      CANDLES_BASE +
      // the gap left behind by the displacement leg
      '<rect class="sw-gap1" x="66" y="44" width="70" height="16" rx="3" fill="rgba(3,201,136,0.16)" stroke="rgba(3,201,136,0.55)"/>' +
      '<line class="sw-ce1" x1="66" y1="52" x2="136" y2="52" stroke="rgba(3,201,136,0.5)" stroke-dasharray="3 4"/>' +
      // retrace into the gap, then delivery onward
      '<path class="sw-path1" d="M64 28 L88 52 L108 46 L128 20" fill="none" stroke="#eeeeee" stroke-width="2" stroke-linecap="round" pathLength="1"/>' +
      // the second gap the move hands off into
      '<rect class="sw-gap2" x="128" y="18" width="70" height="13" rx="3" fill="rgba(3,201,136,0.16)" stroke="rgba(3,201,136,0.55)"/>' +
      '<g class="sw-relay"><rect x="146" y="34" width="52" height="15" rx="7.5" fill="rgba(3,201,136,0.9)"/>' +
      '<text x="172" y="45" text-anchor="middle" font-size="9" font-weight="700" fill="#04110c" font-family="monospace">RELAY ×2</text></g>' +
    '</svg>';

  var DEMO_IFVG =
    '<svg viewBox="0 0 220 120" class="ind-demo-svg" aria-hidden="true">' +
      CANDLES_BASE +
      // fresh bullish gap… until price closes through it
      '<rect class="sw-flip" x="66" y="40" width="130" height="18" rx="3"/>' +
      '<line x1="66" y1="49" x2="196" y2="49" stroke="rgba(139,147,160,0.5)" stroke-dasharray="3 4"/>' +
      // the violation candle
      '<g class="sw-break"><line x1="92" y1="30" x2="92" y2="82" stroke="#3a4150" stroke-width="1.6"/>' +
      '<rect x="87" y="36" width="10" height="40" rx="1.5" fill="#cf4046"/></g>' +
      // the retest from below and the rejection signal
      '<path class="sw-path2" d="M100 82 L128 46 L150 58 L178 88" fill="none" stroke="#eeeeee" stroke-width="2" stroke-linecap="round" pathLength="1"/>' +
      '<g class="sw-sig"><path d="M150 66 l7 12 h-14 z" fill="#e5484d" transform="rotate(180 150 72)"/>' +
      '<text x="150" y="96" text-anchor="middle" font-size="8.5" font-weight="700" fill="#e5484d" font-family="monospace">iFVG ▼</text></g>' +
    '</svg>';

  var DEMO_PO3 =
    '<svg viewBox="0 0 220 120" class="ind-demo-svg" aria-hidden="true">' +
      // the HTF open, dead centre
      '<line x1="10" y1="60" x2="160" y2="60" stroke="rgba(245,197,66,0.55)" stroke-dasharray="5 4"/>' +
      '<text x="12" y="54" font-size="8" fill="rgba(245,197,66,0.8)" font-family="monospace">HTF OPEN</text>' +
      // accumulation chop, the sweep below, then delivery up
      '<path class="sw-path3" d="M14 60 L34 56 L50 64 L66 58 L84 92 L100 74 L118 44 L142 30 L158 18" fill="none" stroke="#eeeeee" stroke-width="2" stroke-linecap="round" pathLength="1"/>' +
      '<text class="sw-ph1" x="38" y="44" text-anchor="middle" font-size="9" font-weight="700" fill="#8b93a0" font-family="monospace">A</text>' +
      '<text class="sw-ph2" x="84" y="106" text-anchor="middle" font-size="9" font-weight="700" fill="#e5484d" font-family="monospace">M</text>' +
      '<text class="sw-ph3" x="142" y="20" text-anchor="middle" font-size="9" font-weight="700" fill="#03c988" font-family="monospace">D</text>' +
      // the same story compressed into one HTF candle on the right
      '<g class="sw-htfc"><line x1="192" y1="10" x2="192" y2="102" stroke="#3a4150" stroke-width="2"/>' +
      '<rect x="183" y="18" width="18" height="44" rx="2" fill="rgba(3,201,136,0.85)"/></g>' +
    '</svg>';

  var INDS = [
    {
      name: 'FVG Relay',
      tag: 'Fair value gaps that chain into delivery',
      body: 'Displacement gaps with consequent-encroachment lines, four mitigation models, and the relay read: the moment a mitigated gap hands price into a fresh one, the chain is counted and flagged.',
      chips: ['Bull & bear FVGs', 'CE lines', '4 mitigation models', 'Relay chains', 'Size filter', 'Alerts'],
      demo: DEMO_FVG
    },
    {
      name: 'iFVG Engine',
      tag: 'Broken gaps flip roles — trade the retest',
      body: 'Tracks every gap through its whole life: formed, inverted, retested. Rejections at inverted zones print entry-style signals, with an EMA bias filter and a live respect-rate dashboard.',
      chips: ['Inversion zones', 'Retest signals', 'Trend bias filter', 'Respect-rate stats', 'Zone retirement', 'Alerts'],
      demo: DEMO_IFVG
    },
    {
      name: 'HTF Power of Three',
      tag: 'Accumulation · Manipulation · Distribution',
      body: 'The last few higher-timeframe candles projected beside your chart, the live HTF open extended across it, and each candle read as the AMD sequence — with a real-time phase readout.',
      chips: ['HTF candles on-chart', 'Live phase readout', 'M / D labels', 'Open line', 'Any timeframe', 'Alerts'],
      demo: DEMO_PO3
    }
  ];

  function render(){
    var host = document.getElementById('indicators-showcase');
    if (!host) return;
    host.innerHTML =
      '<div class="ind-sc-head">' +
        '<h2>The Stryker indicator suite</h2>' +
        '<p>Built in-house for the way the curriculum trades. Finishing TradingView review now — access lands automatically once your username above is approved.</p>' +
      '</div>' +
      '<div class="ind-sc-grid">' +
      INDS.map(function (it, i) {
        return '<article class="ind-card" style="animation-delay:' + (0.08 * i) + 's">' +
          '<div class="ind-demo">' + it.demo + '</div>' +
          '<div class="ind-card-body">' +
            '<div class="ind-card-top"><h3>' + it.name + '</h3>' +
              '<span class="ind-dev"><i></i>IN DEVELOPMENT</span></div>' +
            '<p class="ind-tag">' + it.tag + '</p>' +
            '<p class="ind-body">' + it.body + '</p>' +
            '<div class="ind-chips">' + it.chips.map(function (c) {
              return '<span>' + c + '</span>';
            }).join('') + '</div>' +
          '</div>' +
        '</article>';
      }).join('') +
      '</div>';
  }

  document.addEventListener('DOMContentLoaded', render);
})();
