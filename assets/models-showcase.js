// Stryker Trading Academy — Trading Models showcase pieces
//
// Same idea as assets/indicators-showcase.js: every model gets a hand-drawn
// SVG vignette that plays its core idea on a 7-second loop, so the models
// page reads as a set of setups rather than a list of links. The scenes are
// picked by model id first, then by keywords in the category/name — a model
// added later through the admin editor still gets a sensible scene.
//
// Motion lives in style.css, keyed off the shared mv-* primitives:
//   mv-a / mv-b / mv-c  — appear early / mid / late in the loop
//   mv-draw / mv-draw-late — stroke a path across the loop
//   mv-pop              — pop a label in near the end
//   mv-flip             — a zone that changes colour when price closes through
// Everything is inert under prefers-reduced-motion (see the end of the CSS).

(function(){

  function svg(inner){
    return '<svg viewBox="0 0 220 120" class="mv-svg" aria-hidden="true">' + inner + '</svg>';
  }

  var MONO = ' font-family="monospace"';

  // ---- shared bits -------------------------------------------------------
  function candle(x, top, bottom, bodyTop, bodyH, up){
    return '<line x1="' + x + '" y1="' + top + '" x2="' + x + '" y2="' + bottom + '" stroke="#3a4150" stroke-width="1.6"/>' +
           '<rect x="' + (x - 5) + '" y="' + bodyTop + '" width="10" height="' + bodyH + '" rx="1.5" fill="' +
           (up ? '#2ea583' : '#cf4046') + '"/>';
  }

  // ---- 1. Opening range breakout ----------------------------------------
  var SCENE_ORB =
    // the session open, and the range the first candles carve out
    '<line x1="52" y1="8" x2="52" y2="112" stroke="rgba(245,197,66,0.45)" stroke-dasharray="4 4"/>' +
    '<text x="55" y="17" font-size="7.5" fill="rgba(245,197,66,0.85)"' + MONO + '>OPEN</text>' +
    '<g class="mv-a">' +
      '<rect x="52" y="44" width="66" height="34" rx="2" fill="rgba(139,147,160,0.10)" stroke="rgba(139,147,160,0.5)" stroke-dasharray="3 3"/>' +
      '<text x="56" y="41" font-size="7.5" fill="#8b93a0"' + MONO + '>ORB HIGH</text>' +
      '<text x="56" y="88" font-size="7.5" fill="#8b93a0"' + MONO + '>ORB LOW</text>' +
    '</g>' +
    // chop inside the range, then the break and the run to liquidity
    '<path class="mv-draw" d="M22 66 L38 58 L52 70 L66 50 L80 72 L96 52 L112 60 L126 40 L150 30 L176 16" fill="none" stroke="#eeeeee" stroke-width="2" stroke-linecap="round" pathLength="1"/>' +
    '<g class="mv-c"><line x1="150" y1="24" x2="196" y2="24" stroke="rgba(3,201,136,0.5)" stroke-dasharray="3 4"/>' +
    '<text x="146" y="20" text-anchor="end" font-size="7.5" fill="#03c988"' + MONO + '>LIQUIDITY</text></g>' +
    '<g class="mv-pop"><rect x="120" y="46" width="46" height="14" rx="7" fill="rgba(3,201,136,0.9)"/>' +
    '<text x="143" y="56" text-anchor="middle" font-size="8" font-weight="700" fill="#04110c"' + MONO + '>BREAK</text></g>';

  // ---- 2. 15M fair value gap --------------------------------------------
  var SCENE_FVG =
    candle(18, 88, 60, 68, 18, true) + candle(38, 80, 42, 52, 22, true) + candle(58, 66, 22, 28, 30, true) +
    '<g class="mv-a">' +
      '<rect x="66" y="42" width="118" height="18" rx="3" fill="rgba(3,201,136,0.16)" stroke="rgba(3,201,136,0.55)"/>' +
      '<line x1="66" y1="51" x2="184" y2="51" stroke="rgba(3,201,136,0.5)" stroke-dasharray="3 4"/>' +
      '<text x="70" y="38" font-size="7.5" fill="#03c988"' + MONO + '>15M FVG</text>' +
    '</g>' +
    '<path class="mv-draw" d="M64 26 L86 44 L104 51 L120 40 L146 26 L176 12" fill="none" stroke="#eeeeee" stroke-width="2" stroke-linecap="round" pathLength="1"/>' +
    '<g class="mv-pop"><path d="M104 74 l6 11 h-12 z" fill="#03c988" transform="rotate(180 104 79)"/>' +
    '<text x="104" y="98" text-anchor="middle" font-size="8" font-weight="700" fill="#03c988"' + MONO + '>ENTRY</text></g>';

  // ---- 3. Inverted FVG after a sweep ------------------------------------
  var SCENE_IFVG =
    '<line x1="12" y1="86" x2="200" y2="86" stroke="rgba(139,147,160,0.45)" stroke-dasharray="4 4"/>' +
    '<text x="14" y="82" font-size="7.5" fill="#8b93a0"' + MONO + '>OLD LOW</text>' +
    // the gap that flips from bullish to bearish as price closes through it
    '<rect class="mv-flip" x="60" y="40" width="140" height="18" rx="3"/>' +
    '<g class="mv-b">' + candle(92, 28, 96, 34, 44, false) + '</g>' +
    '<text class="mv-b" x="150" y="36" text-anchor="middle" font-size="7.5" fill="#e5484d"' + MONO + '>INVERTED</text>' +
    // sweep below the low, then the retest of the inverted gap
    '<path class="mv-draw-late" d="M28 60 L52 74 L74 94 L96 62 L124 46 L150 56 L180 92" fill="none" stroke="#eeeeee" stroke-width="2" stroke-linecap="round" pathLength="1"/>' +
    '<g class="mv-pop"><path d="M150 66 l6 11 h-12 z" fill="#e5484d"/>' +
    '<text x="150" y="94" text-anchor="middle" font-size="8" font-weight="700" fill="#e5484d"' + MONO + '>RETEST</text></g>';

  // ---- 4. Judas swing ----------------------------------------------------
  var SCENE_JUDAS =
    '<line x1="46" y1="10" x2="46" y2="110" stroke="rgba(245,197,66,0.45)" stroke-dasharray="4 4"/>' +
    '<text x="49" y="18" font-size="7.5" fill="rgba(245,197,66,0.85)"' + MONO + '>SESSION OPEN</text>' +
    '<line x1="12" y1="52" x2="200" y2="52" stroke="rgba(139,147,160,0.4)" stroke-dasharray="4 4"/>' +
    // the fake move down, the sweep, then the real leg the other way
    '<path class="mv-draw" d="M18 50 L34 54 L46 52 L62 74 L78 92 L92 70 L112 48 L140 32 L172 14" fill="none" stroke="#eeeeee" stroke-width="2" stroke-linecap="round" pathLength="1"/>' +
    '<g class="mv-b"><text x="76" y="106" text-anchor="middle" font-size="8" font-weight="700" fill="#e5484d"' + MONO + '>JUDAS</text>' +
    '<circle cx="78" cy="92" r="5" fill="none" stroke="#e5484d" stroke-width="1.4"/></g>' +
    '<g class="mv-pop"><rect x="120" y="52" width="72" height="14" rx="7" fill="rgba(3,201,136,0.9)"/>' +
    '<text x="156" y="62" text-anchor="middle" font-size="8" font-weight="700" fill="#04110c"' + MONO + '>REAL MOVE</text></g>';

  // ---- 5. ICT 2022 (sweep, MSS, FVG entry) ------------------------------
  var SCENE_2022 =
    '<line x1="12" y1="88" x2="200" y2="88" stroke="rgba(139,147,160,0.45)" stroke-dasharray="4 4"/>' +
    '<text x="14" y="84" font-size="7.5" fill="#8b93a0"' + MONO + '>SELLSIDE</text>' +
    '<g class="mv-b"><line x1="72" y1="46" x2="200" y2="46" stroke="rgba(0,173,181,0.7)"/>' +
    '<text x="76" y="42" font-size="7.5" fill="#00adb5"' + MONO + '>MSS</text></g>' +
    '<g class="mv-c"><rect x="118" y="54" width="82" height="15" rx="3" fill="rgba(3,201,136,0.16)" stroke="rgba(3,201,136,0.55)"/>' +
    '<text x="122" y="80" font-size="7.5" fill="#03c988"' + MONO + '>FVG</text></g>' +
    '<path class="mv-draw" d="M20 62 L40 70 L58 96 L78 58 L100 38 L124 54 L140 62 L164 30 L188 14" fill="none" stroke="#eeeeee" stroke-width="2" stroke-linecap="round" pathLength="1"/>' +
    '<g class="mv-pop"><path d="M140 78 l6 11 h-12 z" fill="#03c988" transform="rotate(180 140 83)"/>' +
    '<text x="140" y="102" text-anchor="middle" font-size="8" font-weight="700" fill="#03c988"' + MONO + '>ENTRY</text></g>';

  // ---- 6. Candle range theory -------------------------------------------
  var SCENE_CRT =
    '<g class="mv-a">' +
      '<line x1="24" y1="34" x2="196" y2="34" stroke="rgba(139,147,160,0.5)" stroke-dasharray="3 4"/>' +
      '<line x1="24" y1="86" x2="196" y2="86" stroke="rgba(139,147,160,0.5)" stroke-dasharray="3 4"/>' +
      '<text x="26" y="30" font-size="7.5" fill="#8b93a0"' + MONO + '>RANGE HIGH</text>' +
      '<text x="26" y="98" font-size="7.5" fill="#8b93a0"' + MONO + '>RANGE LOW</text>' +
    '</g>' +
    // C1 sets the range, C2 sweeps it and closes back inside, C3 expands
    '<g class="mv-a"><line x1="52" y1="34" x2="52" y2="86" stroke="#3a4150" stroke-width="2"/>' +
    '<rect x="43" y="44" width="18" height="32" rx="2" fill="rgba(139,147,160,0.55)"/>' +
    '<text x="52" y="112" text-anchor="middle" font-size="7.5" fill="#8b93a0"' + MONO + '>C1</text></g>' +
    '<g class="mv-b"><line x1="110" y1="42" x2="110" y2="104" stroke="#3a4150" stroke-width="2"/>' +
    '<rect x="101" y="52" width="18" height="30" rx="2" fill="rgba(229,72,77,0.75)"/>' +
    '<text x="110" y="112" text-anchor="middle" font-size="7.5" fill="#e5484d"' + MONO + '>C2 SWEEP</text></g>' +
    '<g class="mv-c"><line x1="170" y1="14" x2="170" y2="80" stroke="#3a4150" stroke-width="2"/>' +
    '<rect x="161" y="20" width="18" height="52" rx="2" fill="rgba(3,201,136,0.8)"/>' +
    '<text x="170" y="112" text-anchor="middle" font-size="7.5" fill="#03c988"' + MONO + '>C3 EXPAND</text></g>';

  // ---- fallback for models added later ----------------------------------
  var SCENE_GENERIC =
    candle(24, 92, 62, 70, 18, true) + candle(48, 84, 48, 56, 22, false) + candle(72, 70, 30, 36, 26, true) +
    '<g class="mv-a"><rect x="84" y="40" width="110" height="18" rx="3" fill="rgba(3,201,136,0.14)" stroke="rgba(3,201,136,0.5)"/></g>' +
    '<path class="mv-draw" d="M80 34 L104 50 L126 46 L152 26 L182 12" fill="none" stroke="#eeeeee" stroke-width="2" stroke-linecap="round" pathLength="1"/>' +
    '<g class="mv-pop"><path d="M126 70 l6 11 h-12 z" fill="#03c988" transform="rotate(180 126 75)"/>' +
    '<text x="126" y="94" text-anchor="middle" font-size="8" font-weight="700" fill="#03c988"' + MONO + '>ENTRY</text></g>';

  var BY_ID = {
    'orb-model-a': SCENE_ORB,
    'fvg-model-b': SCENE_FVG,
    'ifvg-model-c': SCENE_IFVG,
    'judas-swing-model': SCENE_JUDAS,
    'ict-2022-model': SCENE_2022,
    'crt-model': SCENE_CRT
  };

  var BY_KEYWORD = [
    { re: /(opening range|orb|breakout)/i, scene: SCENE_ORB },
    { re: /(ifvg|inver|sweep)/i,           scene: SCENE_IFVG },
    { re: /(fvg|imbalance|gap)/i,          scene: SCENE_FVG },
    { re: /(judas|manipulat|session open)/i, scene: SCENE_JUDAS },
    { re: /(mss|2022|structure)/i,         scene: SCENE_2022 },
    { re: /(crt|candle range|range theory)/i, scene: SCENE_CRT }
  ];

  // Public: the animated scene for a model, as an <svg> string.
  window.modelSceneHtml = function (m){
    if (!m) return svg(SCENE_GENERIC);
    if (BY_ID[m.id]) return svg(BY_ID[m.id]);
    var hay = ((m.category || '') + ' ' + (m.name || '') + ' ' + (m.summary || ''));
    for (var i = 0; i < BY_KEYWORD.length; i++) {
      if (BY_KEYWORD[i].re.test(hay)) return svg(BY_KEYWORD[i].scene);
    }
    return svg(SCENE_GENERIC);
  };

  // Public: rough read time for a model's write-up, in whole minutes.
  window.modelReadMinutes = function (m){
    if (!m) return 0;
    var text = (m.bodyHtml || (m.paragraphs || []).join(' ') || '').replace(/<[^>]*>/g, ' ');
    (m.steps || []).forEach(function (s){
      text += ' ' + (s.title || '') + ' ' + (s.descHtml || s.desc || '').replace(/<[^>]*>/g, ' ');
    });
    var words = text.split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
  };

  // Public: the animated "more models on the way" box, shown under the list.
  window.modelsMoreBoxHtml = function (){
    return '<div class="panel mdl-otw">' +
      '<svg class="mdl-otw-wave" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden="true">' +
        '<path d="M0 26 L40 26 L52 12 L64 32 L78 20 L120 20 L132 8 L146 30 L160 18 L210 18 L224 6 L238 28 L252 16 L300 16 L314 4 L328 26 L342 14 L400 14" ' +
        'fill="none" stroke="rgba(3,201,136,0.55)" stroke-width="1.6" pathLength="1"/>' +
      '</svg>' +
      '<div class="mdl-otw-body">' +
        '<h2>More models on the way</h2>' +
        '<p>New models are written up as they are traded and verified on the desk — each one arrives with its own rules, walkthrough and worked examples. Existing models get revised here too, so re-read one before you trade it.</p>' +
        '<div class="mdl-otw-ghosts"><i></i><i></i><i></i></div>' +
      '</div>' +
    '</div>';
  };

})();
