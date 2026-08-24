// Stryker Trading Academy — bundled chapter seed data
// This is the ORIGINAL content, used once to seed Firestore's `chapters`
// collection from the admin Content editor. After that one-time import,
// the live site reads chapters from Firestore (assets/chapters-store.js),
// not from this file — this file is now only the seed/fallback source.
// Used by: chapters-admin.html (import button + fallback if Firestore is
// ever empty).

const CHAPTERS_SEED = [
  {
    "num": "01",
    "title": "Candles, Charts & the Language of Price",
    "level": "foundation",
    "dur": "72 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Anatomy of a candlestick",
        "desc": "You already know the four numbers a candle records \u2014 open, high, low, close \u2014 and that the body is the open-to-close range while the wicks show how far price reached beyond it. What actually makes a candle useful is read",
        "descHtml": "<p>You already know the four numbers a candle records \u2014 open, high, low, close \u2014 and that the body is the open-to-close range while the wicks show how far price reached beyond it. What actually makes a candle useful is reading the <b>ratio</b> between body and wick, not just spotting that they exist.</p><p>A candle with almost no wick and a full body means one side controlled the entire period start to finish \u2014 a strong, low-resistance move. A candle with a tiny body and long wicks on both ends means the period was volatile but ultimately indecisive \u2014 price traveled a long way and came right back to where it started.</p>\n<div style=\"background:#1b1f26; border:1px solid #393e46; border-radius:12px; padding:20px 16px; margin:14px 0;\">\n<svg viewBox=\"0 0 420 160\" style=\"width:100%; height:auto; display:block;\">\n  <line x1=\"90\" y1=\"20\" x2=\"90\" y2=\"140\" stroke=\"#5c6472\" stroke-width=\"1.5\"/>\n  <rect x=\"78\" y=\"78\" width=\"24\" height=\"4\" fill=\"#8b93a0\"/>\n  <text x=\"90\" y=\"150\" text-anchor=\"middle\" fill=\"#eeeeee\" font-size=\"11\" font-family=\"monospace\">Doji</text>\n  <text x=\"90\" y=\"12\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"10\" font-family=\"monospace\">open \u2248 close</text>\n\n  <line x1=\"210\" y1=\"30\" x2=\"210\" y2=\"140\" stroke=\"#5c6472\" stroke-width=\"1.5\"/>\n  <rect x=\"198\" y=\"120\" width=\"24\" height=\"16\" fill=\"#03c988\" stroke=\"#4fe3ac\"/>\n  <text x=\"210\" y=\"150\" text-anchor=\"middle\" fill=\"#eeeeee\" font-size=\"11\" font-family=\"monospace\">Hammer</text>\n  <text x=\"210\" y=\"20\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"10\" font-family=\"monospace\">long lower wick</text>\n\n  <line x1=\"330\" y1=\"20\" x2=\"330\" y2=\"130\" stroke=\"#5c6472\" stroke-width=\"1.5\"/>\n  <rect x=\"318\" y=\"20\" width=\"24\" height=\"16\" fill=\"#e5484d\" stroke=\"#f08488\"/>\n  <text x=\"330\" y=\"150\" text-anchor=\"middle\" fill=\"#eeeeee\" font-size=\"11\" font-family=\"monospace\">Shooting star</text>\n  <text x=\"330\" y=\"12\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"10\" font-family=\"monospace\">long upper wick</text>\n</svg>\n<p style=\"text-align:center; color:#8b93a0; font-size:12px; margin-top:8px; font-family:monospace;\">Three shapes worth recognizing on sight: indecision, a rejected sell-off, and a rejected rally.</p>\n</div>\n<p>Three shapes are worth being able to recognize on sight, because they show up constantly: a <b>doji</b> (open and close are almost identical \u2014 pure indecision), a <b>hammer</b> (small body near the top, long lower wick \u2014 sellers pushed price down hard and buyers rejected it before the close), and a <b>shooting star</b> (small body near the bottom, long upper wick \u2014 the mirror image, a rejected rally). None of these are magic reversal signals on their own \u2014 they're just candles that tell a more specific story than a plain-bodied one, and that story matters more depending on <i>where</i> on the chart it happens.</p>"
      },
      {
        "title": "What a candle is really recording (the auction)",
        "desc": "Think of every candle as a tiny, self-contained auction. At the open, buyers and sellers start negotiating. Throughout the period, price is pulled in whichever direction has more aggressive participants at that moment. T",
        "descHtml": "<p>Think of every candle as a tiny, self-contained auction. At the open, buyers and sellers start negotiating. Throughout the period, price is pulled in whichever direction has more aggressive participants at that moment. The close is simply wherever the auction landed when time ran out.</p><p>This reframes what a wick actually means. A long upper wick isn't just \"price went up then came down\" \u2014 it's evidence that buyers were aggressive enough to push price higher, and then <i>lost</i> that fight before the close. That's genuinely useful information: it tells you where sellers showed up in size, which is exactly the kind of location this entire curriculum trains you to pay attention to.</p><p>A candle that closes near its high, after opening near its low, with almost no wick on either end, is telling you buyers won decisively and never really had to defend the move. Compare that to a candle with the same close, but a long lower wick \u2014 that candle had to survive a real sell-off first. Same result on paper, completely different story underneath, and the second one tells you far more about where demand actually is.</p>"
      },
      {
        "title": "Chart types and how to choose",
        "desc": "Most of the time you'll trade off a candlestick chart, because it keeps the most information. But it's worth knowing when a line chart is actually the better tool: when you're trying to identify a clean support or resist",
        "descHtml": "<p>Most of the time you'll trade off a candlestick chart, because it keeps the most information. But it's worth knowing when a line chart is actually the better tool: when you're trying to identify a clean support or resistance <i>level</i> and the wicks from a volatile session are cluttering your view of where price has closed repeatedly, switching to a line chart (which only plots closes) can make a level jump out that was hiding in the noise.</p><p>You'll also come across <b>Heikin-Ashi</b> candles occasionally \u2014 a variant that smooths price using averaged values instead of the raw open/high/low/close. They're useful for visually spotting the overall trend at a glance, but because they're smoothed, they're unreliable for precise entries; the candle you see doesn't reflect the actual price traded. Know they exist, but don't use them for execution.</p><p>The practical rule: candlesticks for anything involving entries, stops, or reading a specific reaction at a level. Line charts as an occasional second opinion when you specifically want to cut through wick noise and see where price has actually settled over time.</p>"
      },
      {
        "title": "Timeframes and multi-timeframe thinking",
        "desc": "A professional process almost always works top-down: set your bias on a higher timeframe, confirm it on a middle timeframe, and execute on a lower one. It's the same underlying market move, just examined at three differe",
        "descHtml": "<p>A professional process almost always works top-down: set your bias on a higher timeframe, confirm it on a middle timeframe, and execute on a lower one. It's the same underlying market move, just examined at three different resolutions.</p>\n<div style=\"background:#1b1f26; border:1px solid #393e46; border-radius:12px; padding:20px 16px; margin:14px 0;\">\n<svg viewBox=\"0 0 460 170\" style=\"width:100%; height:auto; display:block;\">\n  <rect x=\"10\" y=\"20\" width=\"130\" height=\"110\" rx=\"6\" fill=\"none\" stroke=\"#00adb5\" stroke-width=\"1.5\"/>\n  <text x=\"75\" y=\"14\" text-anchor=\"middle\" fill=\"#00adb5\" font-size=\"11\" font-family=\"monospace\">DAILY \u2014 bias</text>\n  <polyline points=\"25,100 45,80 65,95 85,55 105,70 125,40\" fill=\"none\" stroke=\"#00adb5\" stroke-width=\"2\"/>\n\n  <rect x=\"165\" y=\"20\" width=\"130\" height=\"110\" rx=\"6\" fill=\"none\" stroke=\"#03c988\" stroke-width=\"1.5\"/>\n  <text x=\"230\" y=\"14\" text-anchor=\"middle\" fill=\"#03c988\" font-size=\"11\" font-family=\"monospace\">1H \u2014 confirm</text>\n  <polyline points=\"180,90 200,100 215,75 235,85 255,50 275,65\" fill=\"none\" stroke=\"#03c988\" stroke-width=\"2\"/>\n\n  <rect x=\"320\" y=\"20\" width=\"130\" height=\"110\" rx=\"6\" fill=\"none\" stroke=\"#e5484d\" stroke-width=\"1.5\"/>\n  <text x=\"385\" y=\"14\" text-anchor=\"middle\" fill=\"#e5484d\" font-size=\"11\" font-family=\"monospace\">5M \u2014 entry</text>\n  <polyline points=\"335,60 350,70 365,45 380,65 400,40 420,55\" fill=\"none\" stroke=\"#e5484d\" stroke-width=\"2\"/>\n\n  <path d=\"M 143 75 L 162 75\" stroke=\"#5c6472\" stroke-width=\"1.5\" marker-end=\"url(#arrow1)\"/>\n  <path d=\"M 298 75 L 317 75\" stroke=\"#5c6472\" stroke-width=\"1.5\" marker-end=\"url(#arrow1)\"/>\n  <defs>\n    <marker id=\"arrow1\" markerWidth=\"8\" markerHeight=\"8\" refX=\"6\" refY=\"3\" orient=\"auto\">\n      <path d=\"M0,0 L6,3 L0,6\" fill=\"none\" stroke=\"#5c6472\"/>\n    </marker>\n  </defs>\n  <text x=\"230\" y=\"155\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">same underlying move, three resolutions</text>\n</svg>\n</div>\n<p>A concrete version of this: on the daily chart, you form a bias \u2014 say, price looks likely to continue higher based on structure and location. On the 1-hour chart, you wait for confirmation that the move is actually developing the way your bias expects \u2014 maybe a break of structure in your favor. Only then do you drop to the 5-minute chart to look for a precise, low-risk entry into that already-confirmed move.</p><p>The discipline this enforces is important: you're never trading the 5-minute chart in isolation, disconnected from the bigger picture. Every entry is downstream of a bias you already committed to before you zoomed in \u2014 which is exactly what stops you from being talked out of a good trade by noise on a lower timeframe.</p>"
      },
      {
        "title": "Market structure: highs, lows, and trend direction",
        "desc": "A swing high is a candle whose high is higher than the highs immediately surrounding it \u2014 a local peak. A swing low is the mirror image \u2014 a local trough. Structure is nothing more than the sequence these swing points for",
        "descHtml": "<p>A <b>swing high</b> is a candle whose high is higher than the highs immediately surrounding it \u2014 a local peak. A <b>swing low</b> is the mirror image \u2014 a local trough. Structure is nothing more than the sequence these swing points form over time.</p><p>It's worth distinguishing <b>internal structure</b> (the smaller, more frequent swings you'd see on a lower timeframe, inside a bigger move) from <b>external structure</b> (the larger swings that define the higher-timeframe trend itself). A downtrend on the daily chart can absolutely contain multiple short uptrends on the 15-minute chart \u2014 those aren't contradictions, they're just structure at two different resolutions, which is exactly why the multi-timeframe habit from the previous lesson matters so much.</p><p>The practical use of all this: structure gives you a constantly-updating answer to \"what has to happen for my current read to be wrong?\" In an uptrend, that answer is precise \u2014 a lower low. Until that specific thing happens, the uptrend hasn't actually broken, no matter how uncomfortable a pullback feels in the moment.</p>"
      },
      {
        "title": "Reading a chart like a desk analyst",
        "desc": "Here's the actual sequence, as a checklist you can run on any chart, on any instrument, before you let yourself look for a specific setup: What's the higher-timeframe trend? Higher highs and higher lows, lower highs and ",
        "descHtml": "<p>Here's the actual sequence, as a checklist you can run on any chart, on any instrument, before you let yourself look for a specific setup:</p><ol style='margin:0 0 14px; padding-left:22px;'><li style='margin-bottom:8px;'><b>What's the higher-timeframe trend?</b> Higher highs and higher lows, lower highs and lower lows, or genuinely range-bound?</li><li style='margin-bottom:8px;'><b>Where's the nearest untested support or resistance?</b> A level price hasn't reacted to yet carries more weight than one it's already bounced off three times.</li><li style='margin-bottom:8px;'><b>Has structure recently broken?</b> If so, in which direction, and has the market shown any sign of confirming that break or rejecting it?</li><li style='margin-bottom:0;'><b>Only now \u2014 does a specific pattern or candle matter here?</b> The same hammer candle means very different things at untested support versus in the middle of nowhere.</li></ol><p>Run that in order, every time, until it's automatic. It's slower at first than just scanning for a familiar shape \u2014 but it's the difference between a pattern that has context behind it and one that's just a shape you happened to recognize.</p>"
      }
    ],
    "bodyHtml": "<p>Every concept you'll learn in this academy \u2014 order blocks, fair value gaps, liquidity sweeps \u2014 is really just a more precise way of reading a candlestick chart. So before anything else, you need to be completely fluent in what a candle is actually recording, what a chart is actually showing you, and how price organizes itself into structure over time. This chapter is the foundation everything else in the curriculum sits on top of \u2014 take it slower than you think you need to.</p>\n\n<h3>Anatomy of a candlestick</h3>\n<p>A single candle records four numbers over a fixed slice of time: the <b>open</b> (the first price traded), the <b>high</b> (the highest price reached), the <b>low</b> (the lowest price reached), and the <b>close</b> (the last price traded before the period ends). The thick rectangle is the <b>body</b> \u2014 the distance between open and close. The thin lines above and below it are the <b>wicks</b> (also called shadows) \u2014 how far price reached beyond the body before it was pushed back.</p>\n\n\n<div style=\"background:#1b1f26; border:1px solid #393e46; border-radius:12px; padding:24px 16px; margin:20px 0;\">\n<svg viewBox=\"0 0 480 260\" style=\"width:100%; height:auto; display:block;\">\n  <line x1=\"130\" y1=\"20\" x2=\"130\" y2=\"230\" stroke=\"#5c6472\" stroke-width=\"1.5\"/>\n  <rect x=\"112\" y=\"90\" width=\"36\" height=\"90\" fill=\"#03c988\" stroke=\"#4fe3ac\" stroke-width=\"1\"/>\n  <text x=\"130\" y=\"14\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">HIGH</text>\n  <text x=\"130\" y=\"245\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">LOW</text>\n  <line x1=\"150\" y1=\"90\" x2=\"185\" y2=\"90\" stroke=\"#5c6472\" stroke-width=\"1\" stroke-dasharray=\"3,3\"/>\n  <text x=\"190\" y=\"94\" fill=\"#eeeeee\" font-size=\"12\" font-family=\"monospace\">Close</text>\n  <line x1=\"150\" y1=\"180\" x2=\"185\" y2=\"180\" stroke=\"#5c6472\" stroke-width=\"1\" stroke-dasharray=\"3,3\"/>\n  <text x=\"190\" y=\"184\" fill=\"#eeeeee\" font-size=\"12\" font-family=\"monospace\">Open</text>\n  <text x=\"130\" y=\"110\" text-anchor=\"middle\" fill=\"#0a1f18\" font-size=\"10\" font-family=\"monospace\" font-weight=\"bold\">BODY</text>\n  <text x=\"60\" y=\"55\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">Upper</text>\n  <text x=\"60\" y=\"68\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">wick</text>\n  <line x1=\"95\" y1=\"60\" x2=\"122\" y2=\"45\" stroke=\"#5c6472\" stroke-width=\"1\"/>\n  <text x=\"60\" y=\"215\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">Lower</text>\n  <text x=\"60\" y=\"228\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">wick</text>\n  <line x1=\"95\" y1=\"220\" x2=\"122\" y2=\"205\" stroke=\"#5c6472\" stroke-width=\"1\"/>\n  <text x=\"130\" y=\"255\" text-anchor=\"middle\" fill=\"#03c988\" font-size=\"12\" font-family=\"monospace\" font-weight=\"bold\">BULLISH \u2014 close above open</text>\n\n  <line x1=\"340\" y1=\"20\" x2=\"340\" y2=\"230\" stroke=\"#5c6472\" stroke-width=\"1.5\"/>\n  <rect x=\"322\" y=\"70\" width=\"36\" height=\"90\" fill=\"#e5484d\" stroke=\"#f08488\" stroke-width=\"1\"/>\n  <text x=\"340\" y=\"14\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">HIGH</text>\n  <text x=\"340\" y=\"245\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">LOW</text>\n  <line x1=\"360\" y1=\"70\" x2=\"400\" y2=\"70\" stroke=\"#5c6472\" stroke-width=\"1\" stroke-dasharray=\"3,3\"/>\n  <text x=\"405\" y=\"74\" fill=\"#eeeeee\" font-size=\"12\" font-family=\"monospace\">Open</text>\n  <line x1=\"360\" y1=\"160\" x2=\"400\" y2=\"160\" stroke=\"#5c6472\" stroke-width=\"1\" stroke-dasharray=\"3,3\"/>\n  <text x=\"405\" y=\"164\" fill=\"#eeeeee\" font-size=\"12\" font-family=\"monospace\">Close</text>\n  <text x=\"340\" y=\"118\" text-anchor=\"middle\" fill=\"#2a0a0a\" font-size=\"10\" font-family=\"monospace\" font-weight=\"bold\">BODY</text>\n  <text x=\"340\" y=\"255\" text-anchor=\"middle\" fill=\"#e5484d\" font-size=\"12\" font-family=\"monospace\" font-weight=\"bold\">BEARISH \u2014 close below open</text>\n</svg>\n</div>\n\n\n<p>Color is just a convention for direction. A <b>bullish</b> candle (usually green) closed higher than it opened \u2014 buyers were in control by the end of the period. A <b>bearish</b> candle (usually red) closed lower than it opened \u2014 sellers won. Nothing more mystical than that.</p>\n\n<h3>What a candle is really recording \u2014 the auction</h3>\n<p>A candle isn't a shape to memorize \u2014 it's a summary of a battle between buyers and sellers, condensed into one picture. A long body with small wicks means one side was in control from open to close with little resistance. A long upper wick on a candle that still closes red means buyers pushed price up during the period, but sellers took it right back down before the close \u2014 a rejection. A long lower wick means the opposite: sellers tried to push price down, and buyers stepped in hard enough to reject it and close higher.</p>\n<blockquote>Learning to read that story, candle by candle, is the single most underrated skill in trading. Everything else in this curriculum is just a more structured way of asking the same question a candle already answers: who won, and how much resistance did they meet along the way?</blockquote>\n\n<h3>Watch a candle form</h3>\n<p>It's easy to forget that a candle isn't drawn instantly \u2014 it forms tick by tick as the period plays out, and only the open, high, low, and close survive to become the final shape. Everything else \u2014 every wobble, every fake-out in the middle of the period \u2014 disappears from the final picture. This is exactly why a candle can look calm on a higher timeframe while it was genuinely chaotic underneath, on a lower one.</p>\n\n\n<div style=\"background:#1b1f26; border:1px solid #393e46; border-radius:12px; padding:24px 16px; margin:20px 0;\">\n<svg viewBox=\"0 0 480 220\" style=\"width:100%; height:auto; display:block;\">\n  <text x=\"240\" y=\"20\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"12\" font-family=\"monospace\">price during the period \u2014 before the candle closes</text>\n  <line x1=\"240\" y1=\"35\" x2=\"240\" y2=\"195\" stroke=\"#393e46\" stroke-width=\"1\"/>\n  <path d=\"M 180 115 Q 210 60 240 90 T 300 70 T 240 150 T 300 120\" fill=\"none\" stroke=\"#4fe3ac\" stroke-width=\"2\" opacity=\"0.55\">\n    <animate attributeName=\"d\" dur=\"6s\" repeatCount=\"indefinite\"\n      values=\"M 180 115 Q 210 60 240 90 T 300 70 T 240 150 T 300 120;\n              M 180 115 Q 210 150 240 100 T 300 140 T 240 70 T 300 100;\n              M 180 115 Q 210 60 240 90 T 300 70 T 240 150 T 300 120\" />\n  </path>\n  <circle r=\"5\" fill=\"#4fe3ac\">\n    <animateMotion dur=\"6s\" repeatCount=\"indefinite\"\n      path=\"M 180 115 Q 210 60 240 90 T 300 70 T 240 150 T 300 120\" />\n  </circle>\n  <g>\n    <line x1=\"400\" y1=\"55\" x2=\"400\" y2=\"165\" stroke=\"#5c6472\" stroke-width=\"1.5\"/>\n    <rect x=\"384\" y=\"85\" width=\"32\" height=\"55\" fill=\"#03c988\" stroke=\"#4fe3ac\" stroke-width=\"1\">\n      <animate attributeName=\"opacity\" values=\"0.3;0.3;1\" keyTimes=\"0;0.85;1\" dur=\"6s\" repeatCount=\"indefinite\"/>\n    </rect>\n  </g>\n  <text x=\"400\" y=\"195\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">final candle at close</text>\n</svg>\n<p style=\"text-align:center; color:#8b93a0; font-size:12.5px; margin-top:10px; font-family:monospace;\">The wobbling line is every price tick during the candle's lifetime. Only the open, high, low, and close survive to become the shape you actually see.</p>\n</div>\n\n\n<h3>Chart types: line vs. candlestick</h3>\n<p>A line chart connects only the closing prices \u2014 it's clean, but it throws away the high, the low, and the shape of the fight entirely. A candlestick chart keeps all four numbers, which is why it's the standard for this kind of analysis: it shows you not just where price ended up, but how it got there.</p>\n\n\n<div style=\"background:#1b1f26; border:1px solid #393e46; border-radius:12px; padding:24px 16px; margin:20px 0;\">\n<svg viewBox=\"0 0 480 200\" style=\"width:100%; height:auto; display:block;\">\n  <text x=\"120\" y=\"18\" text-anchor=\"middle\" fill=\"#eeeeee\" font-size=\"13\" font-family=\"monospace\" font-weight=\"bold\">Line chart</text>\n  <polyline points=\"40,120 75,100 110,130 145,70 180,90 215,50\" fill=\"none\" stroke=\"#00adb5\" stroke-width=\"2.5\"/>\n  <text x=\"120\" y=\"185\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">only shows the close</text>\n\n  <line x1=\"255\" y1=\"10\" x2=\"255\" y2=\"195\" stroke=\"#393e46\" stroke-width=\"1\"/>\n\n  <text x=\"365\" y=\"18\" text-anchor=\"middle\" fill=\"#eeeeee\" font-size=\"13\" font-family=\"monospace\" font-weight=\"bold\">Candlestick chart</text>\n  <g stroke=\"#5c6472\" stroke-width=\"1\">\n    <line x1=\"290\" y1=\"95\" x2=\"290\" y2=\"135\"/><rect x=\"282\" y=\"105\" width=\"16\" height=\"20\" fill=\"#03c988\"/>\n    <line x1=\"320\" y1=\"80\" x2=\"320\" y2=\"120\"/><rect x=\"312\" y=\"90\" width=\"16\" height=\"18\" fill=\"#e5484d\"/>\n    <line x1=\"350\" y1=\"105\" x2=\"350\" y2=\"145\"/><rect x=\"342\" y=\"112\" width=\"16\" height=\"22\" fill=\"#03c988\"/>\n    <line x1=\"380\" y1=\"55\" x2=\"380\" y2=\"100\"/><rect x=\"372\" y=\"65\" width=\"16\" height=\"20\" fill=\"#03c988\"/>\n    <line x1=\"410\" y1=\"70\" x2=\"410\" y2=\"110\"/><rect x=\"402\" y=\"75\" width=\"16\" height=\"24\" fill=\"#e5484d\"/>\n    <line x1=\"440\" y1=\"40\" x2=\"440\" y2=\"85\"/><rect x=\"432\" y=\"48\" width=\"16\" height=\"18\" fill=\"#03c988\"/>\n  </g>\n  <text x=\"365\" y=\"185\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">shows open, high, low &amp; close</text>\n</svg>\n</div>\n\n\n<p>There's also the bar chart (OHLC bars, same four numbers as a candle but drawn as tick marks instead of a filled body) \u2014 functionally identical to a candlestick chart, just a different visual style. You'll see it occasionally; don't let it throw you.</p>\n\n<h3>Timeframes and how to choose one</h3>\n<p>The 15-minute chart and the daily chart are showing you the exact same price action, just at different resolutions \u2014 like zooming in and out on a map. Zoom out too far and you lose the detail needed for a precise entry. Zoom in too far and you lose the context needed to know whether you're even looking in the right direction.</p>\n<p>Part of building a professional process is deciding, in advance, which timeframe you use for <b>bias</b> (your overall read on direction \u2014 usually a higher timeframe like the 4-hour or daily) and which you use for <b>entries</b> (a lower timeframe like the 5-minute or 1-minute, once your higher-timeframe bias is set). Decide this before you're in a trade \u2014 not while you're in one, scrolling through timeframes looking for whichever one happens to agree with the position you already have on.</p>\n\n<h3>Market structure: highs, lows, and trend direction</h3>\n<p>Once you can read a candle, the next skill is reading a sequence of them. An uptrend is nothing more than a series of <b>higher highs</b> and <b>higher lows</b> \u2014 each swing high beats the last one, and each pullback holds above the previous low. A downtrend is the mirror image: <b>lower highs</b> and <b>lower lows</b>.</p>\n\n\n<div style=\"background:#1b1f26; border:1px solid #393e46; border-radius:12px; padding:24px 16px; margin:20px 0;\">\n<svg viewBox=\"0 0 480 220\" style=\"width:100%; height:auto; display:block;\">\n  <text x=\"240\" y=\"18\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"12\" font-family=\"monospace\">higher highs &amp; higher lows, until structure breaks</text>\n  <path d=\"M 30 170 L 90 100 L 130 130 L 190 60 L 230 95 L 290 40 L 330 150 L 420 180\"\n    fill=\"none\" stroke=\"#03c988\" stroke-width=\"2.5\" stroke-dasharray=\"700\" stroke-dashoffset=\"700\">\n    <animate attributeName=\"stroke-dashoffset\" from=\"700\" to=\"0\" dur=\"3.5s\" repeatCount=\"indefinite\"/>\n  </path>\n  <g fill=\"#03c988\">\n    <circle cx=\"90\" cy=\"100\" r=\"4\"/><circle cx=\"190\" cy=\"60\" r=\"4\"/><circle cx=\"290\" cy=\"40\" r=\"4\"/>\n  </g>\n  <g fill=\"#8b93a0\">\n    <circle cx=\"130\" cy=\"130\" r=\"3.5\"/><circle cx=\"230\" cy=\"95\" r=\"3.5\"/>\n  </g>\n  <text x=\"90\" y=\"90\" fill=\"#7fe0c2\" font-size=\"10\" font-family=\"monospace\">HH</text>\n  <text x=\"190\" y=\"50\" fill=\"#7fe0c2\" font-size=\"10\" font-family=\"monospace\">HH</text>\n  <text x=\"290\" y=\"30\" fill=\"#7fe0c2\" font-size=\"10\" font-family=\"monospace\">HH</text>\n  <text x=\"130\" y=\"150\" fill=\"#8b93a0\" font-size=\"10\" font-family=\"monospace\">HL</text>\n  <text x=\"230\" y=\"115\" fill=\"#8b93a0\" font-size=\"10\" font-family=\"monospace\">HL</text>\n  <line x1=\"290\" y1=\"40\" x2=\"330\" y2=\"150\" stroke=\"#e5484d\" stroke-width=\"2.5\">\n    <animate attributeName=\"opacity\" values=\"0;0;1\" keyTimes=\"0;0.7;1\" dur=\"3.5s\" repeatCount=\"indefinite\"/>\n  </line>\n  <text x=\"345\" y=\"150\" fill=\"#f08488\" font-size=\"10\" font-family=\"monospace\">break of structure</text>\n</svg>\n</div>\n\n\n<p>When that pattern breaks \u2014 when price fails to make a new higher high, or drops below the last higher low \u2014 that's called a <b>break of structure</b>, and it's often the first real evidence that a trend is changing character. You'll come back to this idea constantly for the rest of the curriculum; it's the skeleton that every other concept hangs off of.</p>\n\n<h3>Support and resistance as memory zones</h3>\n<p>Certain price levels get reacted to over and over \u2014 not because the level is magic, but because a meaningful number of buyers and sellers made decisions there before, and their orders (and the psychology around them) tend to cluster there again. A level price bounces up from repeatedly is <b>support</b>. A level price gets rejected down from repeatedly is <b>resistance</b>. Once broken, a level often flips roles \u2014 old resistance becomes new support, and vice versa.</p>\n\n\n<div style=\"background:#1b1f26; border:1px solid #393e46; border-radius:12px; padding:24px 16px; margin:20px 0;\">\n<svg viewBox=\"0 0 480 200\" style=\"width:100%; height:auto; display:block;\">\n  <line x1=\"20\" y1=\"40\" x2=\"460\" y2=\"40\" stroke=\"#e5484d\" stroke-width=\"1.5\" stroke-dasharray=\"6,4\"/>\n  <text x=\"465\" y=\"44\" fill=\"#f08488\" font-size=\"11\" font-family=\"monospace\">resistance</text>\n  <line x1=\"20\" y1=\"160\" x2=\"460\" y2=\"160\" stroke=\"#03c988\" stroke-width=\"1.5\" stroke-dasharray=\"6,4\"/>\n  <text x=\"465\" y=\"164\" fill=\"#7fe0c2\" font-size=\"11\" font-family=\"monospace\">support</text>\n  <polyline points=\"20,110 70,42 130,100 190,42 250,120 310,44 370,105 420,50\"\n    fill=\"none\" stroke=\"#eeeeee\" stroke-width=\"2\"/>\n  <text x=\"240\" y=\"185\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">price keeps reacting at the same two levels \u2014 the market \"remembers\" them</text>\n</svg>\n</div>\n\n\n<h3>Reading a chart like a desk analyst</h3>\n<div class=\"tv-chart-embed\" data-symbol=\"CME_MINI:NQ1!\" data-title=\"NQ Futures (Nasdaq-100)\"></div>\n<p style=\"font-size:13px; color:#8b93a0; margin-top:-6px;\"><i>This is a live chart, not a curated example \u2014 pull it up and practice running the checklist above on whatever price action is actually happening right now.</i></p>\n<p>Training your eye to scan for structure and location <i>before</i> you scan for a pattern is what separates a professional read from a beginner one. A beginner opens a chart and immediately hunts for a familiar shape \u2014 a triangle, a flag, a candlestick pattern from a textbook. A desk analyst opens a chart and asks, in order: What's the higher-timeframe trend? Where's the nearest untested support or resistance? Has structure recently broken? Only after answering those does location start to matter \u2014 and only then does a specific pattern become worth acting on, because now it has context behind it instead of existing in isolation.</p>\n<p>That ordering \u2014 structure and location first, pattern second \u2014 is the single habit this chapter is trying to build. Everything else in this academy assumes you already do this automatically.</p>",
    "paragraphs": [
      "Every concept you'll learn in this academy \u2014 order blocks, fair value gaps, liquidity sweeps \u2014 is really just a more precise way of reading a candlestick chart. So before anything else, you need to be completely fluent in what a candle is actually recording, what a chart is actually showing you, and how price organizes itself into structure over time. This chapter is the foundation everything else in the curriculum sits on top of \u2014 take it slower than you think you need to.",
      "A single candle records four numbers over a fixed slice of time: the open (the first price traded), the high (the highest price reached), the low (the lowest price reached), and the close (the last price traded before the period ends). The thick rectangle is the body \u2014 the distance between open and close. The thin lines above and below it are the wicks (also called shadows) \u2014 how far price reached beyond the body before it was pushed back.",
      "Color is just a convention for direction. A bullish candle (usually green) closed higher than it opened \u2014 buyers were in control by the end of the period. A bearish candle (usually red) closed lower than it opened \u2014 sellers won. Nothing more mystical than that.",
      "A candle isn't a shape to memorize \u2014 it's a summary of a battle between buyers and sellers, condensed into one picture. A long body with small wicks means one side was in control from open to close with little resistance. A long upper wick on a candle that still closes red means buyers pushed price up during the period, but sellers took it right back down before the close \u2014 a rejection. A long lower wick means the opposite: sellers tried to push price down, and buyers stepped in hard enough to reject it and close higher.",
      "Learning to read that story, candle by candle, is the single most underrated skill in trading. Everything else in this curriculum is just a more structured way of asking the same question a candle already answers: who won, and how much resistance did they meet along the way?",
      "It's easy to forget that a candle isn't drawn instantly \u2014 it forms tick by tick as the period plays out, and only the open, high, low, and close survive to become the final shape. Everything else \u2014 every wobble, every fake-out in the middle of the period \u2014 disappears from the final picture. This is exactly why a candle can look calm on a higher timeframe while it was genuinely chaotic underneath, on a lower one.",
      "A line chart connects only the closing prices \u2014 it's clean, but it throws away the high, the low, and the shape of the fight entirely. A candlestick chart keeps all four numbers, which is why it's the standard for this kind of analysis: it shows you not just where price ended up, but how it got there.",
      "There's also the bar chart (OHLC bars, same four numbers as a candle but drawn as tick marks instead of a filled body) \u2014 functionally identical to a candlestick chart, just a different visual style. You'll see it occasionally; don't let it throw you.",
      "The 15-minute chart and the daily chart are showing you the exact same price action, just at different resolutions \u2014 like zooming in and out on a map. Zoom out too far and you lose the detail needed for a precise entry. Zoom in too far and you lose the context needed to know whether you're even looking in the right direction.",
      "Part of building a professional process is deciding, in advance, which timeframe you use for bias (your overall read on direction \u2014 usually a higher timeframe like the 4-hour or daily) and which you use for entries (a lower timeframe like the 5-minute or 1-minute, once your higher-timeframe bias is set). Decide this before you're in a trade \u2014 not while you're in one, scrolling through timeframes looking for whichever one happens to agree with the position you already have on.",
      "Once you can read a candle, the next skill is reading a sequence of them. An uptrend is nothing more than a series of higher highs and higher lows \u2014 each swing high beats the last one, and each pullback holds above the previous low. A downtrend is the mirror image: lower highs and lower lows.",
      "When that pattern breaks \u2014 when price fails to make a new higher high, or drops below the last higher low \u2014 that's called a break of structure, and it's often the first real evidence that a trend is changing character. You'll come back to this idea constantly for the rest of the curriculum; it's the skeleton that every other concept hangs off of.",
      "Certain price levels get reacted to over and over \u2014 not because the level is magic, but because a meaningful number of buyers and sellers made decisions there before, and their orders (and the psychology around them) tend to cluster there again. A level price bounces up from repeatedly is support. A level price gets rejected down from repeatedly is resistance. Once broken, a level often flips roles \u2014 old resistance becomes new support, and vice versa.",
      "Training your eye to scan for structure and location before you scan for a pattern is what separates a professional read from a beginner one. A beginner opens a chart and immediately hunts for a familiar shape \u2014 a triangle, a flag, a candlestick pattern from a textbook. A desk analyst opens a chart and asks, in order: What's the higher-timeframe trend? Where's the nearest untested support or resistance? Has structure recently broken? Only after answering those does location start to matter \u2014 and only then does a specific pattern become worth acting on, because now it has context behind it instead of existing in isolation.",
      "That ordering \u2014 structure and location first, pattern second \u2014 is the single habit this chapter is trying to build. Everything else in this academy assumes you already do this automatically."
    ]
  },
  {
    "num": "02",
    "title": "How Markets Are Actually Structured",
    "level": "foundation",
    "dur": "65 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Retail vs. institutional order flow",
        "desc": "The core asymmetry to internalize: a retail order is small enough to be irrelevant on its own. An institutional order is large enough that the act of placing it changes the price \u2014 which forces institutional participants",
        "descHtml": "<p>The core asymmetry to internalize: a retail order is small enough to be irrelevant on its own. An institutional order is large enough that the act of placing it changes the price \u2014 which forces institutional participants to think about execution completely differently than a retail trader does.</p><p>A retail trader mostly asks \"where do I think price is going?\" An institution managing a large position has to also ask \"how do I get this size filled without telegraphing my intention and moving the market against myself?\" That second question barely exists at retail size \u2014 but it dominates institutional behavior, and its fingerprints are all over every chart you'll look at.</p>"
      },
      {
        "title": "Who market makers are and what they do",
        "desc": "A useful mental model: a market maker is constantly quoting both a price they'll buy at and a price they'll sell at, profiting from the small gap between the two (the spread) while providing the liquidity that lets every",
        "descHtml": "<p>A useful mental model: a market maker is constantly quoting both a price they'll buy at and a price they'll sell at, profiting from the small gap between the two (the spread) while providing the liquidity that lets everyone else trade without waiting for a perfectly matched counterparty.</p><p>This role isn't unique to any one market \u2014 it exists in stocks, forex, futures, and crypto in slightly different forms. What matters for a trader is simply understanding that <i>someone</i> has to be on the other side of every trade, and that someone is managing risk at a scale that produces very different behavior than an individual retail order would.</p>"
      },
      {
        "title": "Why price rarely moves in a straight line",
        "desc": "Once you accept that large orders get worked into the market in pieces, a specific pattern becomes recognizable: a move that runs one direction, stalls, fakes the opposite direction briefly, and then resumes the original",
        "descHtml": "<p>Once you accept that large orders get worked into the market in pieces, a specific pattern becomes recognizable: a move that runs one direction, stalls, fakes the opposite direction briefly, and then resumes the original direction with more conviction than before.</p><p>That stall-and-fake isn't the market being indecisive for no reason \u2014 it's very often exactly where a large order needed to source liquidity from the opposite side before it could continue. Learning to distinguish a genuine reversal from this kind of pause is a skill that develops with screen time, but knowing to look for it changes what you pay attention to from day one.</p>"
      },
      {
        "title": "Liquidity: what it actually means in price action",
        "desc": "Practice reframing charts this way: instead of just labeling a swing low as \"support,\" start asking specifically where the stop-loss orders from traders who bought near that low are likely resting. They're not evenly dis",
        "descHtml": "<p>Practice reframing charts this way: instead of just labeling a swing low as \"support,\" start asking specifically where the stop-loss orders from traders who bought near that low are likely resting. They're not evenly distributed \u2014 they cluster in a fairly tight zone just beyond the obvious level, because that's where most retail risk management logically places them.</p><p>This reframe is what makes the next several chapters click. Order blocks, fair value gaps, and liquidity sweeps are all, underneath the specific vocabulary, just more precise ways of identifying exactly where these resting-order pools are and how price is likely to interact with them.</p>"
      },
      {
        "title": "Engineered liquidity and the stop hunt",
        "desc": "A practical habit to build starting now: when you see price approaching an obvious, widely-watched high or low, don't assume it will simply reverse there because it's \"resistance\" or \"support.\" Ask instead whether a brie",
        "descHtml": "<p>A practical habit to build starting now: when you see price approaching an obvious, widely-watched high or low, don't assume it will simply reverse there because it's \"resistance\" or \"support.\" Ask instead whether a brief spike through that level \u2014 sweeping the liquidity resting just beyond it \u2014 is more likely to happen first.</p><p>This doesn't mean every obvious level gets swept, and it doesn't mean you should chase every spike expecting a reversal. It means the most obvious, widely-watched level is often not the safest place to enter \u2014 because it's also the most obvious place for a sweep to happen. That tension between \"obvious\" and \"safe\" is something you'll keep coming back to throughout this curriculum.</p>"
      },
      {
        "title": "Putting it together",
        "desc": "Before moving to the next chapter, practice asking this one question on any chart, for any instrument: where is the liquidity, and what's the path of least resistance to reach it? You won't have the full vocabulary to an",
        "descHtml": "<p>Before moving to the next chapter, practice asking this one question on any chart, for any instrument: where is the liquidity, and what's the path of least resistance to reach it? You won't have the full vocabulary to answer it precisely yet \u2014 that comes over the next several chapters \u2014 but building the habit of asking it now will make everything that follows land much faster.</p>"
      }
    ],
    "bodyHtml": "<p>A common misconception among new traders is that price moves because of \"buyers\" and \"sellers\" in some vague, general sense. In reality, markets are a matching engine \u2014 and understanding exactly how that engine works, and who the biggest participants in it are, explains almost everything you'll see on a chart that otherwise looks random.</p>\n\n<h3>Retail vs. institutional order flow</h3>\n<p>A retail trader's order is small enough that it barely registers \u2014 thousands of them happening at once look like noise. An institutional order \u2014 a bank, a hedge fund, a pension fund rebalancing a portfolio \u2014 is a completely different animal. It can be large enough to move the market meaningfully just by existing, which creates a problem for whoever's placing it: if they try to fill it all at once, they move the price against themselves before the order is even complete.</p>\n\n\n<div style=\"background:#1b1f26; border:1px solid #393e46; border-radius:12px; padding:24px 16px; margin:20px 0;\">\n<svg viewBox=\"0 0 480 200\" style=\"width:100%; height:auto; display:block;\">\n  <text x=\"110\" y=\"18\" text-anchor=\"middle\" fill=\"#eeeeee\" font-size=\"13\" font-family=\"monospace\" font-weight=\"bold\">Retail order flow</text>\n  <g fill=\"#00adb5\">\n    <circle cx=\"40\" cy=\"70\" r=\"4\"/><circle cx=\"70\" cy=\"50\" r=\"3\"/><circle cx=\"100\" cy=\"90\" r=\"5\"/>\n    <circle cx=\"130\" cy=\"60\" r=\"3\"/><circle cx=\"60\" cy=\"110\" r=\"4\"/><circle cx=\"150\" cy=\"100\" r=\"3\"/>\n    <circle cx=\"90\" cy=\"130\" r=\"4\"/><circle cx=\"170\" cy=\"70\" r=\"3\"/><circle cx=\"45\" cy=\"150\" r=\"3\"/>\n  </g>\n  <text x=\"110\" y=\"180\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">small, scattered, low individual impact</text>\n\n  <line x1=\"240\" y1=\"10\" x2=\"240\" y2=\"190\" stroke=\"#393e46\" stroke-width=\"1\"/>\n\n  <text x=\"365\" y=\"18\" text-anchor=\"middle\" fill=\"#eeeeee\" font-size=\"13\" font-family=\"monospace\" font-weight=\"bold\">Institutional order flow</text>\n  <rect x=\"290\" y=\"95\" width=\"150\" height=\"14\" rx=\"3\" fill=\"#03c988\" opacity=\"0.9\"/>\n  <text x=\"365\" y=\"105\" text-anchor=\"middle\" fill=\"#0a1f18\" font-size=\"9\" font-family=\"monospace\" font-weight=\"bold\">ONE large order</text>\n  <g fill=\"#4fe3ac\">\n    <rect x=\"290\" y=\"130\" width=\"16\" height=\"10\"><animate attributeName=\"opacity\" values=\"0.2;1;0.2\" dur=\"3s\" begin=\"0s\" repeatCount=\"indefinite\"/></rect>\n    <rect x=\"315\" y=\"130\" width=\"16\" height=\"10\"><animate attributeName=\"opacity\" values=\"0.2;1;0.2\" dur=\"3s\" begin=\"0.3s\" repeatCount=\"indefinite\"/></rect>\n    <rect x=\"340\" y=\"130\" width=\"16\" height=\"10\"><animate attributeName=\"opacity\" values=\"0.2;1;0.2\" dur=\"3s\" begin=\"0.6s\" repeatCount=\"indefinite\"/></rect>\n    <rect x=\"365\" y=\"130\" width=\"16\" height=\"10\"><animate attributeName=\"opacity\" values=\"0.2;1;0.2\" dur=\"3s\" begin=\"0.9s\" repeatCount=\"indefinite\"/></rect>\n    <rect x=\"390\" y=\"130\" width=\"16\" height=\"10\"><animate attributeName=\"opacity\" values=\"0.2;1;0.2\" dur=\"3s\" begin=\"1.2s\" repeatCount=\"indefinite\"/></rect>\n    <rect x=\"415\" y=\"130\" width=\"16\" height=\"10\"><animate attributeName=\"opacity\" values=\"0.2;1;0.2\" dur=\"3s\" begin=\"1.5s\" repeatCount=\"indefinite\"/></rect>\n  </g>\n  <text x=\"365\" y=\"160\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"10\" font-family=\"monospace\">worked into the market in pieces</text>\n  <text x=\"365\" y=\"180\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">large enough to move price on its own</text>\n</svg>\n</div>\n\n\n<p>That single constraint \u2014 a large order can't be filled all at once without hurting the person placing it \u2014 explains why institutional order flow looks so different from retail activity on a chart, and it's the starting point for almost every concept in this curriculum.</p>\n\n<h3>Who market makers are and what they do</h3>\n<p>A market maker's job is to be the counterparty on the other side of a trade when a natural match isn't immediately available \u2014 buying when there's a seller and no ready buyer, selling when there's a buyer and no ready seller, and profiting from the small spread between the two prices. This is what keeps markets liquid; without it, you'd frequently be unable to enter or exit a position at a fair price.</p>\n\n\n<div style=\"background:#1b1f26; border:1px solid #393e46; border-radius:12px; padding:24px 16px; margin:20px 0;\">\n<svg viewBox=\"0 0 460 180\" style=\"width:100%; height:auto; display:block;\">\n  <text x=\"70\" y=\"30\" fill=\"#03c988\" font-size=\"12\" font-family=\"monospace\" font-weight=\"bold\">BUYERS</text>\n  <g fill=\"#03c988\" opacity=\"0.85\">\n    <rect x=\"30\" y=\"45\" width=\"70\" height=\"12\" rx=\"2\"/>\n    <rect x=\"30\" y=\"63\" width=\"55\" height=\"12\" rx=\"2\"/>\n    <rect x=\"30\" y=\"81\" width=\"80\" height=\"12\" rx=\"2\"/>\n    <rect x=\"30\" y=\"99\" width=\"45\" height=\"12\" rx=\"2\"/>\n  </g>\n  <circle cx=\"230\" cy=\"90\" r=\"42\" fill=\"none\" stroke=\"#8b93a0\" stroke-width=\"1.5\"/>\n  <text x=\"230\" y=\"85\" text-anchor=\"middle\" fill=\"#eeeeee\" font-size=\"11\" font-family=\"monospace\">MARKET</text>\n  <text x=\"230\" y=\"99\" text-anchor=\"middle\" fill=\"#eeeeee\" font-size=\"11\" font-family=\"monospace\">MAKER</text>\n  <text x=\"390\" y=\"30\" fill=\"#e5484d\" font-size=\"12\" font-family=\"monospace\" font-weight=\"bold\">SELLERS</text>\n  <g fill=\"#e5484d\" opacity=\"0.85\">\n    <rect x=\"360\" y=\"45\" width=\"70\" height=\"12\" rx=\"2\"/>\n    <rect x=\"375\" y=\"63\" width=\"55\" height=\"12\" rx=\"2\"/>\n    <rect x=\"350\" y=\"81\" width=\"80\" height=\"12\" rx=\"2\"/>\n    <rect x=\"385\" y=\"99\" width=\"45\" height=\"12\" rx=\"2\"/>\n  </g>\n  <path d=\"M 112 75 L 186 82\" stroke=\"#5c6472\" stroke-width=\"1.2\"/>\n  <path d=\"M 112 100 L 186 95\" stroke=\"#5c6472\" stroke-width=\"1.2\"/>\n  <path d=\"M 274 82 L 348 75\" stroke=\"#5c6472\" stroke-width=\"1.2\"/>\n  <path d=\"M 274 95 L 348 100\" stroke=\"#5c6472\" stroke-width=\"1.2\"/>\n  <text x=\"230\" y=\"160\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">matches both sides \u2014 and profits from the spread between them</text>\n</svg>\n</div>\n\n\n<p>Market makers aren't a conspiracy against retail traders \u2014 they're a structural role that has to exist for markets to function. But because they're managing enormous size, their behavior does create predictable footprints on a chart, which is exactly what the rest of this curriculum trains you to read.</p>\n\n<h3>Why price rarely moves in a straight line</h3>\n<p>Because a large order can't be filled all at once, it often gets worked into the market in pieces \u2014 and disguised by a manufactured move in the opposite direction first, since that's frequently where the liquidity needed to fill the other side of the order is actually sitting. This is why price so rarely goes directly from point A to point B in a clean line; it needs to visit the areas where the opposite side of the trade is resting before the larger move can actually happen.</p>\n\n\n<div style=\"background:#1b1f26; border:1px solid #393e46; border-radius:12px; padding:24px 16px; margin:20px 0;\">\n<svg viewBox=\"0 0 480 200\" style=\"width:100%; height:auto; display:block;\">\n  <text x=\"240\" y=\"18\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"12\" font-family=\"monospace\">a fake move first, to source the opposite liquidity \u2014 then the real move</text>\n  <path d=\"M 30 130 L 110 100 L 160 140 L 220 60 L 320 50 L 420 20\"\n    fill=\"none\" stroke=\"#5c6472\" stroke-width=\"2\" stroke-dasharray=\"500\" stroke-dashoffset=\"500\">\n    <animate attributeName=\"stroke-dashoffset\" from=\"500\" to=\"0\" dur=\"4s\" repeatCount=\"indefinite\"/>\n  </path>\n  <circle cx=\"110\" cy=\"100\" r=\"4\" fill=\"#8b93a0\"/>\n  <text x=\"110\" y=\"90\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"10\" font-family=\"monospace\">looks bullish</text>\n  <circle cx=\"160\" cy=\"140\" r=\"5\" fill=\"#e5484d\"/>\n  <text x=\"160\" y=\"158\" text-anchor=\"middle\" fill=\"#f08488\" font-size=\"10\" font-family=\"monospace\">the fakeout</text>\n  <circle cx=\"420\" cy=\"20\" r=\"4\" fill=\"#03c988\"/>\n  <text x=\"420\" y=\"14\" text-anchor=\"middle\" fill=\"#7fe0c2\" font-size=\"10\" font-family=\"monospace\">real direction</text>\n</svg>\n</div>\n\n\n<p>Once you see this pattern, a lot of \"random\" price action stops looking random. A move that fakes one direction before reversing hard isn't necessarily manipulation in some sinister sense \u2014 it's very often just the mechanical reality of how large size gets filled without moving the market against itself.</p>\n\n<h3>Liquidity: what it actually means in price action</h3>\n<p>In this context, \"liquidity\" doesn't mean how easy an asset is to buy or sell in general \u2014 it means <b>orders resting at a specific price</b>, waiting to be filled. The most common source of this is stop-loss orders: when a trader buys above a recent swing low, their stop-loss sits just below that low. When enough traders do this around the same level, a cluster of sell orders builds up right below it \u2014 a pool of liquidity a larger participant can use to fill a big sell order.</p>\n\n\n<div style=\"background:#1b1f26; border:1px solid #393e46; border-radius:12px; padding:24px 16px; margin:20px 0;\">\n<svg viewBox=\"0 0 480 200\" style=\"width:100%; height:auto; display:block;\">\n  <polyline points=\"30,150 90,80 150,110 210,60 270,100 330,50 390,90 450,40\" fill=\"none\" stroke=\"#eeeeee\" stroke-width=\"2\"/>\n  <line x1=\"20\" y1=\"80\" x2=\"460\" y2=\"80\" stroke=\"#e5484d\" stroke-width=\"1.2\" stroke-dasharray=\"5,4\" opacity=\"0.7\"/>\n  <text x=\"465\" y=\"84\" fill=\"#f08488\" font-size=\"10\" font-family=\"monospace\">sell-side liquidity</text>\n  <text x=\"20\" y=\"72\" fill=\"#f08488\" font-size=\"9\" font-family=\"monospace\">stops below swing lows</text>\n  <line x1=\"20\" y1=\"50\" x2=\"460\" y2=\"50\" stroke=\"#03c988\" stroke-width=\"1.2\" stroke-dasharray=\"5,4\" opacity=\"0.7\"/>\n  <text x=\"465\" y=\"54\" fill=\"#7fe0c2\" font-size=\"10\" font-family=\"monospace\">buy-side liquidity</text>\n  <text x=\"20\" y=\"42\" fill=\"#7fe0c2\" font-size=\"9\" font-family=\"monospace\">stops above swing highs</text>\n  <text x=\"240\" y=\"185\" text-anchor=\"middle\" fill=\"#8b93a0\" font-size=\"11\" font-family=\"monospace\">resting orders cluster just beyond the obvious highs and lows</text>\n</svg>\n</div>\n\n\n<p>The same thing happens in reverse above swing highs \u2014 traders shorting below a recent high tend to place stops just above it, building a pool of buy-side liquidity there. Once you can see a chart this way, obvious highs and lows stop looking like just \"resistance\" and \"support\" \u2014 they start looking like magnets, because in a very real sense, they are.</p>\n\n<h3>Engineered liquidity and the stop hunt</h3>\n<div class=\"tv-chart-embed\" data-symbol=\"OANDA:XAUUSD\" data-title=\"Gold (XAUUSD)\"></div>\n<p style=\"font-size:13px; color:#8b93a0; margin-top:-6px;\"><i>This is a live chart, not a curated example \u2014 use it to practice spotting an obvious level that got swept before a real move, whenever one happens to be visible.</i></p>\n<p>This is why price so often spikes just beyond an obvious high or low \u2014 wicking through it \u2014 before reversing sharply in the opposite direction. That spike isn't random noise; it's very often the market reaching exactly far enough to trigger the resting orders clustered there, filling a large order against that liquidity, and then continuing in the direction that order actually wanted to go.</p>\n\n\n<div style=\"background:#1b1f26; border:1px solid #393e46; border-radius:12px; padding:24px 16px; margin:20px 0;\">\n<svg viewBox=\"0 0 480 200\" style=\"width:100%; height:auto; display:block;\">\n  <line x1=\"20\" y1=\"60\" x2=\"460\" y2=\"60\" stroke=\"#e5484d\" stroke-width=\"1.2\" stroke-dasharray=\"5,4\"/>\n  <text x=\"465\" y=\"64\" fill=\"#f08488\" font-size=\"10\" font-family=\"monospace\">liquidity level</text>\n  <path d=\"M 30 120 L 100 90 L 170 110 L 230 100 L 280 40 L 320 100 L 400 30\"\n    fill=\"none\" stroke=\"#eeeeee\" stroke-width=\"2.2\" stroke-dasharray=\"480\" stroke-dashoffset=\"480\">\n    <animate attributeName=\"stroke-dashoffset\" from=\"480\" to=\"0\" dur=\"4s\" repeatCount=\"indefinite\"/>\n  </path>\n  <circle cx=\"280\" cy=\"40\" r=\"5\" fill=\"#e5484d\">\n    <animate attributeName=\"opacity\" values=\"0;0;1;1;0\" keyTimes=\"0;0.55;0.6;0.85;1\" dur=\"4s\" repeatCount=\"indefinite\"/>\n  </circle>\n  <text x=\"280\" y=\"25\" text-anchor=\"middle\" fill=\"#f08488\" font-size=\"10\" font-family=\"monospace\">\n    the sweep \u2014 wicks through, then reverses\n    <animate attributeName=\"opacity\" values=\"0;0;1;1;0\" keyTimes=\"0;0.55;0.6;0.85;1\" dur=\"4s\" repeatCount=\"indefinite\"/>\n  </text>\n</svg>\n</div>\n\n\n<p>This single idea \u2014 that obvious levels often get swept before the real move \u2014 is one of the most practically useful things in this entire curriculum. It reframes an entry: instead of buying right at an obvious support level (exactly where a sweep is most likely to happen), a more disciplined approach waits to see whether that level gets swept first, and looks for confirmation afterward.</p>\n\n<h3>Putting it together</h3>\n<p>Every concept in this chapter answers the same underlying question: not \"will price go up or down,\" but \"where is the liquidity a large order needs, and what's the path of least resistance to get there.\" That reframing is the foundation for essentially every ICT concept that follows in this curriculum \u2014 order blocks, fair value gaps, and liquidity sweeps are really just more precise vocabulary for exactly what you just learned here.</p>",
    "paragraphs": [
      "A common misconception among new traders is that price moves because of \"buyers\" and \"sellers\" in some vague, general sense. In reality, markets are a matching engine \u2014 and understanding exactly how that engine works, and who the biggest participants in it are, explains almost everything you'll see on a chart that otherwise looks random.",
      "A retail trader's order is small enough that it barely registers \u2014 thousands of them happening at once look like noise. An institutional order \u2014 a bank, a hedge fund, a pension fund rebalancing a portfolio \u2014 is a completely different animal. It can be large enough to move the market meaningfully just by existing, which creates a problem for whoever's placing it: if they try to fill it all at once, they move the price against themselves before the order is even complete.",
      "That single constraint \u2014 a large order can't be filled all at once without hurting the person placing it \u2014 explains why institutional order flow looks so different from retail activity on a chart, and it's the starting point for almost every concept in this curriculum.",
      "A market maker's job is to be the counterparty on the other side of a trade when a natural match isn't immediately available \u2014 buying when there's a seller and no ready buyer, selling when there's a buyer and no ready seller, and profiting from the small spread between the two prices. This is what keeps markets liquid; without it, you'd frequently be unable to enter or exit a position at a fair price.",
      "Market makers aren't a conspiracy against retail traders \u2014 they're a structural role that has to exist for markets to function. But because they're managing enormous size, their behavior does create predictable footprints on a chart, which is exactly what the rest of this curriculum trains you to read.",
      "Because a large order can't be filled all at once, it often gets worked into the market in pieces \u2014 and disguised by a manufactured move in the opposite direction first, since that's frequently where the liquidity needed to fill the other side of the order is actually sitting. This is why price so rarely goes directly from point A to point B in a clean line; it needs to visit the areas where the opposite side of the trade is resting before the larger move can actually happen.",
      "Once you see this pattern, a lot of \"random\" price action stops looking random. A move that fakes one direction before reversing hard isn't necessarily manipulation in some sinister sense \u2014 it's very often just the mechanical reality of how large size gets filled without moving the market against itself.",
      "In this context, \"liquidity\" doesn't mean how easy an asset is to buy or sell in general \u2014 it means orders resting at a specific price, waiting to be filled. The most common source of this is stop-loss orders: when a trader buys above a recent swing low, their stop-loss sits just below that low. When enough traders do this around the same level, a cluster of sell orders builds up right below it \u2014 a pool of liquidity a larger participant can use to fill a big sell order.",
      "The same thing happens in reverse above swing highs \u2014 traders shorting below a recent high tend to place stops just above it, building a pool of buy-side liquidity there. Once you can see a chart this way, obvious highs and lows stop looking like just \"resistance\" and \"support\" \u2014 they start looking like magnets, because in a very real sense, they are.",
      "This is why price so often spikes just beyond an obvious high or low \u2014 wicking through it \u2014 before reversing sharply in the opposite direction. That spike isn't random noise; it's very often the market reaching exactly far enough to trigger the resting orders clustered there, filling a large order against that liquidity, and then continuing in the direction that order actually wanted to go.",
      "This single idea \u2014 that obvious levels often get swept before the real move \u2014 is one of the most practically useful things in this entire curriculum. It reframes an entry: instead of buying right at an obvious support level (exactly where a sweep is most likely to happen), a more disciplined approach waits to see whether that level gets swept first, and looks for confirmation afterward.",
      "Every concept in this chapter answers the same underlying question: not \"will price go up or down,\" but \"where is the liquidity a large order needs, and what's the path of least resistance to get there.\" That reframing is the foundation for essentially every ICT concept that follows in this curriculum \u2014 order blocks, fair value gaps, and liquidity sweeps are really just more precise vocabulary for exactly what you just learned here."
    ]
  },
  {
    "num": "03",
    "title": "Discipline, Process & the Trader's Mindset",
    "level": "foundation",
    "dur": "31 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Process over prediction",
        "desc": "Why trying to be 'right' about direction is a losing frame, and what to replace it with."
      },
      {
        "title": "Building a rule-based routine",
        "desc": "Turning your trading day into a checklist instead of a series of improvised decisions."
      },
      {
        "title": "Journaling before you risk capital",
        "desc": "Starting your journal in the demo/backtest phase so the habit is already automatic once real money is involved."
      }
    ],
    "paragraphs": [
      "It's tempting to skip straight to the technical chapters, but every concept you learn later is only as good as your ability to execute it consistently. Most traders don't fail because they lack a good setup \u2014 they fail because they abandon a good setup the moment it doesn't work three times in a row.",
      "This chapter reframes the goal of trading from 'being right' to 'executing a defined process correctly.' A trade taken by the rules and stopped out is a successful execution of your process, even though it lost money. A trade taken outside your rules that happens to win is still a process failure \u2014 and treating it as a win is exactly how bad habits get reinforced.",
      "You'll also build your journaling habit here, before a single real chapter on entries. Logging your reasoning, screenshot, and outcome for every practice trade \u2014 starting today \u2014 means that by the time you reach Chapter 39 (Trade Journaling & Performance Review), you'll already have weeks of real data to work with instead of starting from zero."
    ]
  },
  {
    "num": "04",
    "title": "Trend, Range & Swing Points",
    "level": "foundation",
    "dur": "52 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Defining higher-highs / higher-lows",
        "desc": "The exact, objective rule for calling a trend up, down, or sideways \u2014 no ambiguity."
      },
      {
        "title": "Marking swing points consistently",
        "desc": "A repeatable method for identifying swing highs and lows so two traders looking at the same chart mark the same points."
      },
      {
        "title": "Trend vs. range: telling them apart",
        "desc": "Why most losing trades happen from applying a trending strategy inside a range, or vice versa."
      }
    ],
    "paragraphs": [
      "Swing points are the raw material for nearly every structural concept in this curriculum, from Break of Structure in Chapter 8 to Order Blocks in Chapter 9. If your swing points are inconsistent, everything built on top of them will be inconsistent too \u2014 so this chapter is worth slowing down for.",
      "A swing high is simply a candle whose high is higher than the candles immediately before and after it; a swing low is the mirror image. A market making a sequence of higher swing highs and higher swing lows is in an uptrend. Lower highs and lower lows define a downtrend. Anything that isn't clearly doing either is a range, and needs to be traded with range rules, not trend rules.",
      "The chapter closes with a live-chart drill: you'll mark swing points on ten different chart segments and compare your markings against the model answer, which builds the muscle memory you'll rely on for the rest of the course."
    ]
  },
  {
    "num": "05",
    "title": "Support, Resistance & Key Levels",
    "level": "foundation",
    "dur": "44 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Horizontal levels that actually matter",
        "desc": "How to filter dozens of possible lines down to the handful that institutional flow actually respects."
      },
      {
        "title": "Round numbers and psychological levels",
        "desc": "Why prices ending in .00 or .50 attract disproportionate order flow."
      },
      {
        "title": "Why price returns to the same zones",
        "desc": "The liquidity-based explanation for why 'the market has memory' at certain price levels."
      }
    ],
    "paragraphs": [
      "Every trader has drawn a horizontal line on a chart and watched price completely ignore it. This chapter teaches you why that happens, and how to filter out the noise so the levels you draw are the ones that actually matter to the order flow behind the market.",
      "A level becomes significant not because price touched it once, but because of what's resting there: stop losses, pending orders, and breakout entries all cluster around obvious highs, lows, and round numbers. That resting liquidity is exactly what institutional participants need to fill their own orders \u2014 which is why price is statistically drawn back to these zones long after the original reaction.",
      "By the end of this chapter you'll have a simple filter for deciding which of the dozen lines you could draw on any chart are actually worth marking \u2014 a skill that directly feeds into Chapter 7's deeper dive on liquidity."
    ]
  },
  {
    "num": "06",
    "title": "Candlestick Behavior at Key Levels",
    "level": "foundation",
    "dur": "50 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Rejection wicks and what they signal",
        "desc": "Reading long wicks at a level as a real-time record of who won the fight there."
      },
      {
        "title": "Engulfing candles as momentum shifts",
        "desc": "Spotting the specific two-candle pattern that often marks a genuine change in control."
      },
      {
        "title": "Reading reaction speed at a level",
        "desc": "Why a slow grind through a level tells a different story than a violent, fast rejection."
      }
    ],
    "paragraphs": [
      "Chapter 5 taught you where the important levels are. This chapter teaches you how to read what happens when price actually gets there \u2014 which is where most of the useful information in trading actually lives.",
      "A long wick rejecting a level, especially on a higher timeframe, is a real-time record of aggressive opposing orders stepping in. An engulfing candle \u2014 where one candle's body completely swallows the previous candle's body \u2014 often marks a genuine shift in short-term control, especially when it happens directly at a key level rather than in open space.",
      "You'll also learn to read reaction speed: a slow, grinding push through a level often means the level will eventually give way, while a fast, violent spike through a level that immediately reverses is a classic liquidity sweep \u2014 the exact concept Chapter 7 builds toward."
    ]
  },
  {
    "num": "07",
    "title": "Liquidity: BSL, SSL & Resting Orders",
    "level": "foundation",
    "dur": "58 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Buy-side vs. sell-side liquidity",
        "desc": "Defining BSL (resting orders above old highs) and SSL (resting orders below old lows) precisely."
      },
      {
        "title": "Where resting orders cluster",
        "desc": "Mapping the obvious and less-obvious places stop losses and pending orders accumulate."
      },
      {
        "title": "Why the market is drawn to liquidity",
        "desc": "Reframing 'support and resistance' as 'liquidity that price is being engineered toward.'"
      }
    ],
    "paragraphs": [
      "This is the hinge chapter of the entire foundation section. Every concept from here forward \u2014 order blocks, fair value gaps, liquidity sweeps, SMT divergence \u2014 only makes sense once you can see a chart the way institutional order flow sees it: not as price, but as a map of resting orders.",
      "Buy-side liquidity (BSL) sits above old highs, where breakout buyers place entries and short sellers place their stop losses. Sell-side liquidity (SSL) sits below old lows, the mirror image. Both represent large pools of opposing orders that a big institutional order can be filled against \u2014 which is exactly why price is so often drawn toward these areas before making its 'real' move.",
      "By the end of this chapter, you'll stop asking 'where will price go' and start asking 'where is the liquidity, and what's the most efficient path to it.' That single mental shift is what Part II of this curriculum is built entirely around."
    ]
  },
  {
    "num": "08",
    "title": "Market Structure & Break of Structure",
    "level": "intermediate",
    "dur": "1h 12m",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Confirming a valid BOS",
        "desc": "The objective rule for confirming that structure has actually broken, not just wicked through."
      },
      {
        "title": "CHoCH: spotting real reversals",
        "desc": "Distinguishing a genuine Change of Character from a temporary pullback."
      },
      {
        "title": "Continuation vs. reversal structure",
        "desc": "Reading which type of break you're looking at before you commit to a directional bias."
      }
    ],
    "paragraphs": [
      "Break of Structure (BOS) is how you objectively confirm that the current trend is continuing, rather than guessing based on how a chart 'feels.' A valid BOS occurs when price closes beyond a relevant swing point in the direction of the existing trend \u2014 a close, not just a wick, which is a subtle but critical distinction most new traders get wrong.",
      "Change of Character (CHoCH) is the opposite signal: the first break of structure against the prevailing trend, which is often \u2014 though not always \u2014 the earliest objective sign that a reversal is underway. This chapter teaches you to tell the difference between a genuine CHoCH and a normal, healthy pullback that will resume the original trend.",
      "You'll finish the chapter working through fifteen live chart examples, each labeled either BOS or CHoCH, building the pattern recognition you'll lean on constantly through the rest of this curriculum."
    ]
  },
  {
    "num": "09",
    "title": "Order Blocks: Identification & Validity",
    "level": "intermediate",
    "dur": "1h 05m",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "The last opposing candle before displacement",
        "desc": "The precise definition of an order block, and why 'last candle before a big move' isn't specific enough on its own."
      },
      {
        "title": "Rules for a valid order block",
        "desc": "The checklist that separates a real order block from a random candle that happened to precede a move."
      },
      {
        "title": "Mitigated vs. unmitigated blocks",
        "desc": "Why an order block loses its edge once price has already returned to test it."
      }
    ],
    "paragraphs": [
      "An order block marks the footprint of institutional entry \u2014 specifically, the last candle in the opposite direction before a strong, displacing move away from it. The idea is that a large order couldn't be filled all at once, so a portion of it remains 'unfilled' at that origin candle, creating a zone price is statistically likely to return to.",
      "Not every candle before a big move qualifies. This chapter gives you the specific validity checklist: the move away needs genuine displacement (not just a normal continuation candle), ideally leaves a fair value gap in its wake, and should originate from \u2014 or sweep \u2014 a relevant liquidity point covered in Chapter 7.",
      "You'll also learn the difference between a mitigated order block (one price has already returned to and reacted from) and an unmitigated one (still untested) \u2014 a distinction that directly affects how much confidence you should place in it for a new trade."
    ]
  },
  {
    "num": "10",
    "title": "Fair Value Gaps & Imbalance",
    "level": "intermediate",
    "dur": "56 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Spotting the three-candle imbalance",
        "desc": "The exact three-candle pattern that defines a fair value gap on any timeframe."
      },
      {
        "title": "Why price returns to 'fill' the gap",
        "desc": "The order-flow explanation for why imbalanced areas act like a magnet for future price action."
      },
      {
        "title": "Trading FVGs with confluence",
        "desc": "Combining fair value gaps with order blocks and liquidity for higher-probability zones."
      }
    ],
    "paragraphs": [
      "A Fair Value Gap (FVG) is a three-candle pattern where the wick of the first candle and the wick of the third candle don't overlap, leaving a visible gap in price. That gap represents a moment where the market moved so aggressively in one direction that it left an imbalance between buying and selling pressure.",
      "Because that imbalance was never properly 'traded through' in both directions, price frequently returns to it later \u2014 not out of some mystical memory, but because unfilled institutional orders and reference points tend to sit inside these gaps. This chapter teaches you to treat FVGs as both potential entry zones and potential price targets, depending on the context.",
      "The real edge comes from confluence: an FVG sitting inside an order block, or forming as part of a liquidity sweep, carries far more weight than an FVG in open space. You'll practice stacking these signals together on live charts by the end of the chapter."
    ]
  },
  {
    "num": "11",
    "title": "Premium & Discount: Reading PD Arrays",
    "level": "intermediate",
    "dur": "49 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Plotting equilibrium on a range",
        "desc": "The simple method for finding the 50% midpoint of any defined range."
      },
      {
        "title": "Premium vs. discount pricing",
        "desc": "Why buying above equilibrium or selling below it works against you statistically."
      },
      {
        "title": "Combining PD arrays with order blocks",
        "desc": "Only acting on setups that align both location (discount/premium) and structure (order block/FVG)."
      }
    ],
    "paragraphs": [
      "Price within any defined range is either statistically 'expensive' or 'cheap' relative to that range \u2014 a concept ICT traders call premium and discount. Plotting the 50% midpoint (equilibrium) of a recent significant range instantly tells you which half of the range you're in.",
      "The rule that follows is simple to state and hard to follow under pressure: only look for buy setups when price is in the discount half of the range, and only look for sell setups when price is in the premium half. Buying in premium or selling in discount means you're fighting the statistical bias of the range itself.",
      "This chapter teaches you to combine premium/discount location with the order blocks and FVGs from the previous two chapters \u2014 a setup only becomes high-quality when the location and the structural signal agree with each other."
    ]
  },
  {
    "num": "12",
    "title": "Liquidity Sweeps & Stop Hunts",
    "level": "intermediate",
    "dur": "1h 02m",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Anatomy of an engineered sweep",
        "desc": "Breaking down, candle by candle, what a genuine liquidity sweep looks like in real time."
      },
      {
        "title": "Distinguishing a sweep from a real breakout",
        "desc": "The specific tells \u2014 wick length, close location, follow-through \u2014 that separate a trap from a true breakout."
      },
      {
        "title": "Entry timing after a sweep",
        "desc": "Where and when to actually enter once you've confirmed the sweep, rather than jumping in too early."
      }
    ],
    "paragraphs": [
      "This is where Chapters 7 through 11 combine into a single, tradeable idea. A liquidity sweep occurs when price spikes beyond an obvious high or low \u2014 clearing out the resting stop losses and breakout orders sitting there \u2014 and then reverses sharply, often within just a few candles.",
      "The key skill this chapter builds is patience: waiting for confirmation that the move was a sweep (a strong rejection candle, a quick reclaim of the level, or a fresh CHoCH on a lower timeframe) rather than assuming every spike through a level is automatically a trap. Real breakouts do happen, and this chapter is explicit about the tells that separate the two.",
      "Once a sweep is confirmed, this chapter teaches you to look for entry inside the order block or FVG left behind by the reversal move \u2014 tying directly back to Chapters 9 and 10 rather than treating the sweep as a signal to enter on its own."
    ]
  },
  {
    "num": "13",
    "title": "Killzones & Session Timing",
    "level": "intermediate",
    "dur": "47 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Asia, London & New York sessions",
        "desc": "The defined time windows for each major session and what typically happens during each."
      },
      {
        "title": "Why displacement clusters in killzones",
        "desc": "The liquidity and volume reasons certain hours produce far more reliable moves than others."
      },
      {
        "title": "Building a session-based watchlist",
        "desc": "Structuring your trading day around the windows most likely to produce a valid setup."
      }
    ],
    "paragraphs": [
      "Not all hours of the trading day are equal. The Asian session tends to establish a tighter range that later sessions use as a liquidity reference; the London open frequently produces the Judas swing covered in Chapter 23; and the New York session, especially its first two hours, is where the highest-volume, most reliable displacement tends to occur.",
      "This chapter maps out the specific killzone windows in a neutral time reference so you can convert them to your own timezone, and explains \u2014 from a volume and participation standpoint \u2014 why setups formed during these windows are statistically more reliable than the same-looking setup formed at 3am in a thin, illiquid market.",
      "You'll leave this chapter with a simple weekly template: which sessions you'll actively watch, which you'll ignore, and which you'll use purely for context-setting rather than entries."
    ]
  },
  {
    "num": "14",
    "title": "Liquidity Engineering: Putting It Together",
    "level": "intermediate",
    "dur": "1h 18m",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Accumulation, manipulation, distribution",
        "desc": "The three-phase cycle (AMD) that describes a complete institutional trading day."
      },
      {
        "title": "Mapping a full AMD cycle live",
        "desc": "Walking through a real chart from open to close and labeling each phase as it happens."
      },
      {
        "title": "Case study: a full day, start to finish",
        "desc": "A complete worked example tying together structure, liquidity, order blocks, and FVGs into one narrative."
      }
    ],
    "paragraphs": [
      "This chapter is the synthesis point for everything in Part II. The Power of Three (or AMD) model describes a typical institutional trading day in three phases: accumulation (a tight range where orders are built), manipulation (a liquidity sweep in the 'wrong' direction to trap participants), and distribution (the real, intended move).",
      "Rather than introducing new concepts, this chapter walks a single trading day, candle by candle, mapping each phase as it happens and showing exactly how structure, liquidity, order blocks, and fair value gaps all show up as part of one continuous story rather than isolated signals.",
      "By the end, you should be able to look at an unlabeled chart from a day you've never seen, and correctly identify which phase of the cycle you're most likely looking at \u2014 the core skill Part III builds on."
    ]
  },
  {
    "num": "15",
    "title": "Order Flow Case Studies: Gold & Indices",
    "level": "intermediate",
    "dur": "1h 10m",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "XAUUSD structure walkthroughs",
        "desc": "Applying the full toolkit specifically to gold's unique volatility and session behavior."
      },
      {
        "title": "NAS100 and US30 examples",
        "desc": "Adjusting your expectations for range and displacement size on major indices."
      },
      {
        "title": "Adapting concepts across instruments",
        "desc": "What changes \u2014 and what stays exactly the same \u2014 when you switch instruments."
      }
    ],
    "paragraphs": [
      "Concepts only become real once you've watched them play out, repeatedly, on the specific instruments you intend to trade. This chapter takes everything from Chapters 8 through 14 and applies it directly to gold (XAUUSD) and major indices (NAS100, US30), two of the most popular instruments among ICT-style traders.",
      "Gold's larger average range and heightened sensitivity to the New York session require slightly different expectations for stop placement and target distance compared to a major FX pair. Indices, meanwhile, often show cleaner structural breaks around the New York cash open due to concentrated participation at that specific time.",
      "Rather than teaching new theory, this chapter is built almost entirely around annotated chart case studies, so you can see the exact same core concepts expressed slightly differently across instruments."
    ]
  },
  {
    "num": "16",
    "title": "Multi-Timeframe Analysis",
    "level": "intermediate",
    "dur": "55 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Setting HTF bias before you look at entries",
        "desc": "Establishing your directional bias on the 4-hour or daily before ever opening a lower timeframe."
      },
      {
        "title": "Aligning LTF entries to HTF direction",
        "desc": "Using the 5-minute or 15-minute purely for precision, never for bias."
      },
      {
        "title": "Resolving conflicting timeframe signals",
        "desc": "A clear decision rule for when the higher and lower timeframe appear to disagree."
      }
    ],
    "paragraphs": [
      "Most avoidable losses in this style of trading come from timeframe conflict \u2014 taking a bullish lower-timeframe setup while the higher timeframe is clearly still bearish, or vice versa. This chapter installs a fixed, top-down process to prevent that: bias is set on a higher timeframe first, and never overridden by what a lower timeframe 'looks like' in isolation.",
      "The practical workflow taught here is to establish structure and draw on liquidity on the 4-hour or daily chart first, identify the higher-timeframe order block or FVG you're targeting, and only then drop to the 15-minute or 5-minute chart to time entry within that zone using a lower-timeframe CHoCH.",
      "The chapter closes with a decision rule for the cases where timeframes genuinely appear to disagree: when in doubt, the higher timeframe wins, and the correct action is usually to stand aside rather than force a trade."
    ]
  },
  {
    "num": "17",
    "title": "Correlated Pairs & Intermarket Basics",
    "level": "advanced",
    "dur": "51 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "What correlation actually means for traders",
        "desc": "A practical, non-statistical explanation of why some instruments tend to move together."
      },
      {
        "title": "Common FX and index correlation pairs",
        "desc": "The specific pairs and baskets used most often for SMT confirmation."
      },
      {
        "title": "Setting up a correlation watchlist",
        "desc": "Building the multi-chart layout you'll use for the rest of Part III."
      }
    ],
    "paragraphs": [
      "Before SMT divergence can make sense, you need a working, practical map of which instruments tend to move together and why. This isn't about formal statistical correlation coefficients \u2014 it's about understanding shared underlying drivers, like two currency pairs that both contain USD, or two equity indices exposed to the same macro conditions.",
      "This chapter lists the correlation relationships used most often in ICT-style trading: EURUSD against GBPUSD, AUDUSD against NZDUSD, ES against NQ, and gold against DXY, among others \u2014 along with an honest discussion of when those relationships tend to break down.",
      "You'll finish by building a multi-chart watchlist layout, ready to use starting in Chapter 18, so you're not scrambling to set up new charts every time you want to check for divergence."
    ]
  },
  {
    "num": "18",
    "title": "Introduction to SMT Divergence",
    "level": "advanced",
    "dur": "58 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "What SMT divergence signals",
        "desc": "The core idea: one correlated instrument makes a new high/low while the other fails to confirm it."
      },
      {
        "title": "Spotting your first divergence",
        "desc": "A guided, step-by-step walkthrough on a real correlated pair."
      },
      {
        "title": "Common false-divergence mistakes",
        "desc": "The most frequent beginner errors when first learning to spot SMT."
      }
    ],
    "paragraphs": [
      "Smart Money Technique (SMT) divergence is one of the highest-conviction confirmation tools in this entire curriculum. The core idea: when two correlated instruments should move together, but one makes a new high or low while the other fails to confirm it, that failure is often an early tell that the move is a liquidity trap rather than a genuine breakout.",
      "This chapter walks through your first live divergence example step by step \u2014 first identifying the correlated pair, then marking the relevant swing point on both charts, and finally confirming that one instrument swept liquidity while the other visibly refused to follow.",
      "New traders often mistake ordinary lag between correlated instruments for divergence. This chapter is explicit about that distinction, since acting on false divergence is one of the fastest ways to turn a promising concept into a losing habit."
    ]
  },
  {
    "num": "19",
    "title": "SMT on Major FX Pairs",
    "level": "advanced",
    "dur": "1h 04m",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "EURUSD vs. GBPUSD divergence",
        "desc": "Reading the most commonly used FX divergence pair in detail."
      },
      {
        "title": "AUDUSD vs. NZDUSD as a basket",
        "desc": "Using the 'Aussie/Kiwi' relationship as a secondary confirmation tool."
      },
      {
        "title": "Confirming FX reversals with SMT",
        "desc": "Combining FX divergence with the structural tools from Part II for a complete setup."
      }
    ],
    "paragraphs": [
      "This chapter drills specifically into SMT divergence across the major FX correlated baskets traders reach for most often. EURUSD and GBPUSD, both heavily influenced by shared USD strength or weakness, are the most commonly used pair for spotting early divergence around key liquidity levels.",
      "AUDUSD and NZDUSD, often called the 'Aussie/Kiwi' relationship, tend to move even more tightly together and can act as a useful secondary confirmation when the EUR/GBP relationship is unclear or the news calendar is distorting one of the two pairs.",
      "The chapter closes by combining FX SMT divergence with the market structure and order block concepts from Part II, showing how a full setup looks when every layer of confirmation lines up rather than relying on divergence alone."
    ]
  },
  {
    "num": "20",
    "title": "SMT on Indices & DXY",
    "level": "advanced",
    "dur": "1h 00m",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "ES vs. NQ divergence patterns",
        "desc": "Reading divergence between the S&P and Nasdaq futures for early equity reversals."
      },
      {
        "title": "Using DXY to confirm gold and FX moves",
        "desc": "How the dollar index often leads moves in gold and major FX pairs."
      },
      {
        "title": "Index SMT during killzones",
        "desc": "Why index divergence is often clearest during the New York cash session."
      }
    ],
    "paragraphs": [
      "Index and dollar-index divergence often lead moves in FX and metals rather than simply confirming them. This chapter starts with ES (S&P 500 futures) against NQ (Nasdaq futures) \u2014 two indices that usually move in lockstep, making even small divergence between them a meaningful early signal.",
      "DXY, the dollar index, plays a similar leading role for gold and major FX pairs: because gold and most FX majors are quoted against or heavily influenced by the dollar, a clear DXY divergence at a key level can be one of the earliest tells that a gold or FX reversal is coming.",
      "This chapter also explains why index SMT tends to be cleanest during the New York cash session specifically, when the underlying equity markets themselves are open and driving the futures directly."
    ]
  },
  {
    "num": "21",
    "title": "Advanced Order Block Refinement",
    "level": "advanced",
    "dur": "57 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Breaker blocks explained",
        "desc": "An order block that failed and flipped, now acting as a signal in the opposite direction."
      },
      {
        "title": "Mitigation blocks vs. order blocks",
        "desc": "The subtle difference and why it changes how much weight to give the zone."
      },
      {
        "title": "Nested order blocks across timeframes",
        "desc": "Refining a higher-timeframe order block down to a precise lower-timeframe entry."
      }
    ],
    "paragraphs": [
      "Not every order block is created equal. This chapter refines the basic definition from Chapter 9 into two important variants. A breaker block forms when an order block fails \u2014 price closes through it \u2014 and that same zone often flips to act as resistance or support in the opposite direction going forward.",
      "A mitigation block is subtly different: it's the zone institutional participants use to offset a losing position, rather than a fresh entry zone, and price often reacts to it with less conviction than to a true, unmitigated order block. Knowing which one you're looking at changes how much confidence to place in the setup.",
      "Finally, you'll learn to nest order blocks across timeframes \u2014 finding a valid order block on the 4-hour chart, then dropping to the 5-minute chart to find a smaller order block within it, which is one of the most common ways experienced ICT traders refine their entry price."
    ]
  },
  {
    "num": "22",
    "title": "Advanced Fair Value Gap Concepts",
    "level": "advanced",
    "dur": "49 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Balanced price ranges",
        "desc": "Recognizing when two opposing FVGs effectively cancel each other out."
      },
      {
        "title": "Inversion fair value gaps",
        "desc": "How a broken FVG can flip and act as a signal in the opposite direction."
      },
      {
        "title": "FVG confluence stacking",
        "desc": "Layering multiple FVGs across timeframes for higher-conviction zones."
      }
    ],
    "paragraphs": [
      "This chapter goes past the basic three-candle FVG definition from Chapter 10 into variants experienced ICT traders use for extra confluence. A balanced price range occurs when a bullish FVG and a bearish FVG sit close together, effectively neutralizing each other \u2014 a zone worth noting but not trading on its own.",
      "An inversion fair value gap is a more advanced concept: an FVG that gets fully violated by price can flip and act as resistance or support in the opposite direction, similar in spirit to the breaker block concept from the previous chapter.",
      "You'll finish by practicing 'FVG stacking' \u2014 finding a daily FVG, a 4-hour FVG, and a 15-minute FVG all overlapping in the same small price zone, which is one of the strongest forms of confluence in this entire curriculum."
    ]
  },
  {
    "num": "23",
    "title": "Judas Swings & False Breakouts",
    "level": "advanced",
    "dur": "52 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Anatomy of a Judas swing",
        "desc": "The specific false move at a session open designed to trap early participants."
      },
      {
        "title": "Session-open manipulation patterns",
        "desc": "Why the London open in particular is prone to this exact pattern."
      },
      {
        "title": "Avoiding the false-breakout trap",
        "desc": "Practical rules for waiting out the trap rather than reacting to it."
      }
    ],
    "paragraphs": [
      "A Judas swing is a sharp, false move at the open of a session \u2014 most classically the London open \u2014 designed to trigger breakout entries and stop losses in the 'wrong' direction before the real move of the session begins. The name comes from the idea of a betrayal: the move looks completely convincing right up until it reverses.",
      "This chapter explains, from a liquidity standpoint, why session opens are especially prone to this pattern: overnight ranges build up predictable liquidity just above and below them, and the opening minutes of a major session are exactly when institutional participants have both the volume and the incentive to run that liquidity before committing to a direction.",
      "The practical rule taught here is patience: rather than trading the initial session-open move, you'll learn to wait for the sweep and the subsequent structural shift (CHoCH) before considering an entry \u2014 directly applying the liquidity sweep skills from Chapter 12."
    ]
  },
  {
    "num": "24",
    "title": "Power of Three: AMD in Practice",
    "level": "advanced",
    "dur": "1h 05m",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "The three-phase daily cycle",
        "desc": "A deeper, practical revisit of the AMD model first introduced in Chapter 14."
      },
      {
        "title": "Identifying which phase you're in",
        "desc": "A live checklist for classifying current price action in real time."
      },
      {
        "title": "Trading only the distribution phase",
        "desc": "Why patience through accumulation and manipulation is what makes distribution profitable."
      }
    ],
    "paragraphs": [
      "This chapter revisits the Power of Three (Accumulation\u2013Manipulation\u2013Distribution) model introduced in Chapter 14, but with a sharper focus on practical, real-time application rather than historical chart study. The goal here is to be able to say, on a live, unfolding chart, 'we are most likely in the manipulation phase right now' \u2014 and act accordingly.",
      "You'll build a simple real-time checklist: has a tight accumulation range formed, has that range's liquidity been swept, and has a clear structural shift confirmed the sweep was manipulation rather than a genuine breakout. Only once all three boxes are checked does the distribution phase \u2014 the phase you actually want to trade \u2014 begin.",
      "The chapter closes with an honest discussion of the most common mistake at this stage: entering during the manipulation phase because it 'looks like' the real move, rather than waiting the extra few candles for confirmation."
    ]
  },
  {
    "num": "25",
    "title": "Weekly & Daily Range Profiles",
    "level": "advanced",
    "dur": "58 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Typical weekly range behavior",
        "desc": "How a 'normal' week tends to unfold across the major sessions."
      },
      {
        "title": "Daily range expansion vs. contraction",
        "desc": "Recognizing when a day is likely to trend versus consolidate."
      },
      {
        "title": "Using range profiles to set targets",
        "desc": "Turning historical range data into realistic, rather than arbitrary, profit targets."
      }
    ],
    "paragraphs": [
      "Understanding how far an instrument typically travels in a day or a week keeps your targets grounded in reality rather than wishful thinking. This chapter introduces the idea of a weekly range profile: many instruments show a tendency to establish a range early in the week and expand out of it by Wednesday or Thursday.",
      "On a daily basis, you'll learn to distinguish between range-expansion days (where the day's high-to-low distance is unusually large, often following a clear liquidity sweep) and range-contraction days (tight, indecisive days that often precede a bigger move the following session).",
      "This directly feeds into target-setting: rather than picking an arbitrary risk-reward ratio, this chapter teaches you to reference recent average range data so your targets reflect what the instrument has actually been doing."
    ]
  },
  {
    "num": "26",
    "title": "Optimal Trade Entry (OTE) Zones",
    "level": "advanced",
    "dur": "1h 02m",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Fibonacci retracement for OTE",
        "desc": "Using the 62%-79% retracement zone as a precision entry filter."
      },
      {
        "title": "Combining OTE with order blocks",
        "desc": "Only acting when the Fibonacci zone and a structural order block agree."
      },
      {
        "title": "Refining entries on the LTF",
        "desc": "Dropping to a lower timeframe inside the OTE zone for a final confirmation."
      }
    ],
    "paragraphs": [
      "Optimal Trade Entry, or OTE, narrows a valid setup down to a precise, repeatable entry price rather than a wide area of interest. The classic definition uses a Fibonacci retracement drawn on the most recent structural leg, with the 62% to 79% retracement zone considered the 'optimal' area for entry.",
      "Used alone, Fibonacci levels are just as arbitrary as any other line on a chart. The real edge in this chapter comes from combining the OTE zone with an order block or FVG sitting in the same area \u2014 the confluence of a statistical retracement zone and a structural signal is what makes the entry high-probability, not the Fibonacci tool by itself.",
      "You'll finish by practicing the full refinement workflow: marking the structural leg, drawing OTE, confirming an order block sits inside it, and then dropping to a lower timeframe for a final CHoCH confirmation before entry."
    ]
  },
  {
    "num": "27",
    "title": "SMT Divergence Across Correlated Pairs",
    "level": "advanced",
    "dur": "1h 40m",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Full DXY / ES / correlated-FX workflow",
        "desc": "The complete, step-by-step process for checking SMT before every setup."
      },
      {
        "title": "Confirming a sweep is a trap before entry",
        "desc": "Using divergence as the final filter before committing to a liquidity-sweep trade."
      },
      {
        "title": "Live multi-chart case studies",
        "desc": "Six full worked examples across FX, gold, and indices."
      }
    ],
    "paragraphs": [
      "This is the flagship chapter of Part III, bringing together everything from Chapters 17 through 26 into one complete, repeatable workflow. Before entering any liquidity-sweep-based setup, you'll now run it through an SMT check: does the correlated instrument confirm the same move, or does it show divergence that suggests a trap?",
      "The full process taught here: identify your primary instrument's sweep and structural shift, immediately check the correlated instrument (DXY for gold and FX, ES/NQ for indices) for the same swing point, and only proceed with the trade if the correlated instrument clearly failed to make the same new high or low.",
      "The chapter is built around six full, unedited multi-chart case studies \u2014 walking through the complete decision process in real time across FX, gold, and index examples, so you can see exactly how the workflow holds up outside of cherry-picked textbook examples."
    ]
  },
  {
    "num": "28",
    "title": "Advanced SMT: Indices, Bonds & Correlation Baskets",
    "level": "advanced",
    "dur": "1h 22m",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Yield-sensitive pair behavior",
        "desc": "How bond yields influence currency pairs and equity indices."
      },
      {
        "title": "Bond and equity correlation shifts",
        "desc": "Recognizing when the 'normal' bond/equity relationship temporarily breaks down."
      },
      {
        "title": "Building a higher-conviction basket",
        "desc": "Combining three or more correlated instruments for maximum-confidence SMT signals."
      }
    ],
    "paragraphs": [
      "This chapter extends SMT divergence beyond FX and equity indices into interest-rate-sensitive instruments, for traders who want the highest possible confirmation before committing to a trade. Bond yields have a well-documented influence on both currency pairs and equity indices, which makes them a useful, if more advanced, addition to your correlation toolkit.",
      "You'll also cover the honest caveat that the bond/equity relationship isn't fixed \u2014 it shifts across different macro regimes, and this chapter teaches you to recognize when that underlying relationship has temporarily broken down, which is exactly when relying on it for SMT would produce false signals.",
      "The chapter closes by teaching you to build a three-or-more-instrument correlation basket for your highest-conviction setups \u2014 reserved for the trades where you want maximum confirmation before increasing size."
    ]
  },
  {
    "num": "29",
    "title": "SMT Failure Modes & Edge Cases",
    "level": "advanced",
    "dur": "45 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "When correlations temporarily break",
        "desc": "Real historical periods where standard correlations stopped holding."
      },
      {
        "title": "News-driven correlation distortion",
        "desc": "Why a single instrument reacting to unique news can create false divergence."
      },
      {
        "title": "Filtering low-quality divergence",
        "desc": "A checklist for divergence signals worth ignoring."
      }
    ],
    "paragraphs": [
      "Not every divergence is tradeable, and this chapter is dedicated entirely to the situations where SMT should be set aside rather than acted on. Correlations between instruments are statistical tendencies, not laws of physics, and they periodically break down for identifiable reasons.",
      "The most common cause is instrument-specific news: if one half of your correlated pair just had a surprise data release or central bank statement, the apparent 'divergence' you're seeing may simply be that instrument reacting to its own news, not a genuine liquidity trap on the other.",
      "This chapter closes with a practical filtering checklist \u2014 a short list of conditions (major news within the last 30 minutes, extremely low liquidity hours, a recently broken correlation regime) under which you should treat an apparent SMT signal with real skepticism rather than confidence."
    ]
  },
  {
    "num": "30",
    "title": "Institutional Reference Points",
    "level": "advanced",
    "dur": "50 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Previous day/week high and low",
        "desc": "Why these specific levels carry outsized weight compared to arbitrary recent highs/lows."
      },
      {
        "title": "Midnight open and session opens",
        "desc": "Fixed daily reference points institutional models are frequently built around."
      },
      {
        "title": "Using reference points as draw-on-liquidity",
        "desc": "Treating these levels as likely magnets rather than simple support/resistance."
      }
    ],
    "paragraphs": [
      "Institutions plan their day and week around fixed, objective reference points, not arbitrary lines a discretionary trader might draw. This chapter teaches you the specific reference points worth marking on every chart: the previous day's high and low, the previous week's high and low, and the current session's opening price.",
      "The midnight open (in New York time) in particular shows up repeatedly across ICT-style analysis as a reference for measuring how far price has traveled intraday, and where it sits relative to that fixed point often informs whether a move is likely to continue or has already reached a stretched extreme.",
      "Rather than treating these levels as simple support and resistance, this chapter teaches you to treat them as draw-on-liquidity \u2014 reference points price is statistically likely to be engineered toward, tying directly back to the liquidity concepts introduced in Chapter 7."
    ]
  },
  {
    "num": "31",
    "title": "Algorithmic Price Delivery Basics",
    "level": "advanced",
    "dur": "1h 08m",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "What IPDA ranges represent",
        "desc": "An introduction to the idea that price delivery follows algorithmic, rather than purely random, ranges."
      },
      {
        "title": "20/40/60-day range context",
        "desc": "Using specific historical lookback periods to establish a longer-term reference range."
      },
      {
        "title": "Using algorithmic ranges for daily bias",
        "desc": "Applying this longer-term context to sharpen your daily directional bias."
      }
    ],
    "paragraphs": [
      "This chapter introduces a more advanced idea underpinning much of ICT methodology: that price delivery across major instruments follows algorithmic, range-based behavior rather than being purely random from moment to moment. This isn't a claim about a literal single algorithm \u2014 it's a framework for treating price behavior as more structured and repeatable than it first appears.",
      "The practical tool taught here is the use of specific historical lookback windows \u2014 commonly 20, 40, and 60 trading days \u2014 to establish longer-term reference ranges. Where current price sits relative to these ranges (near the top, bottom, or middle) provides useful context for your daily bias.",
      "This chapter is intentionally introductory; Chapter 32 goes significantly deeper into applying this framework across multiple timeframes and real trading scenarios."
    ]
  },
  {
    "num": "32",
    "title": "Advanced Algorithmic Price Delivery",
    "level": "advanced",
    "dur": "1h 15m",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Applying IPDA concepts across timeframes",
        "desc": "Extending the range-based framework from Chapter 31 down to weekly and daily analysis."
      },
      {
        "title": "Range expansion signals",
        "desc": "Recognizing when price is likely about to break out of its recent algorithmic range."
      },
      {
        "title": "Combining IPDA with liquidity engineering",
        "desc": "Merging longer-term range context with the AMD cycle from Chapters 14 and 24."
      }
    ],
    "paragraphs": [
      "Building directly on Chapter 31, this chapter applies the algorithmic range-delivery framework to real, multi-week case studies across FX, gold, and indices \u2014 showing how longer-term range context can sharpen decisions you're already making using structure and liquidity.",
      "You'll learn to recognize early range-expansion signals: specific structural and liquidity conditions that tend to precede a breakout from a longer-term algorithmic range, rather than waiting for the breakout to already be obvious to everyone else.",
      "The chapter closes by explicitly merging this longer-term context with the Power of Three cycle from Chapters 14 and 24, so you're using both a macro-range view and a micro-session view of the same underlying price delivery framework."
    ]
  },
  {
    "num": "33",
    "title": "News, Fundamentals & Displacement",
    "level": "advanced",
    "dur": "40 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "When fundamentals matter to a technical trader",
        "desc": "A pragmatic view: you don't need to trade the news, but you need to recognize its footprint."
      },
      {
        "title": "Reading displacement around news",
        "desc": "Distinguishing news-driven displacement from a 'natural' structural break."
      },
      {
        "title": "Avoiding news-driven whipsaw",
        "desc": "Practical rules for managing open positions and avoiding new entries around high-impact releases."
      }
    ],
    "paragraphs": [
      "You don't need to become a fundamental analyst to trade this curriculum successfully, but you do need to recognize when the displacement you're seeing on a chart is the direct result of a scheduled news event rather than a purely technical liquidity engineering move \u2014 because the two require different responses.",
      "This chapter teaches you to read the calendar alongside the chart: knowing when a high-impact release is due lets you correctly attribute a sudden, aggressive move to news rather than mistaking it for a 'natural' structural break, which matters for how much confidence to place in the resulting order block or FVG.",
      "The practical takeaway is a simple set of rules around high-impact news: typically avoiding new entries in the minutes immediately surrounding a release, and having a clear plan in advance for how you'll manage any open position through it."
    ]
  },
  {
    "num": "34",
    "title": "Building a Personal Playbook \u2014 Part 1",
    "level": "advanced",
    "dur": "55 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Choosing your instrument and session",
        "desc": "Narrowing your focus to one or two instruments and one or two sessions to start."
      },
      {
        "title": "Defining your entry model in writing",
        "desc": "Writing your setup criteria down as an explicit, objective checklist."
      },
      {
        "title": "Backtesting your first draft playbook",
        "desc": "Testing your written rules against historical charts before risking a single dollar."
      }
    ],
    "paragraphs": [
      "This is the first of two capstone-preparation chapters, where everything you've learned so far gets converted from a collection of concepts into a single, written, testable trading model \u2014 your personal playbook.",
      "The chapter starts narrow on purpose: choosing one or two instruments and one or two sessions to focus on initially, rather than trying to trade everything at once. You'll then write out your specific entry model as an explicit checklist \u2014 structure requirement, liquidity requirement, timeframe alignment, and confirmation signal \u2014 in plain, objective language.",
      "The chapter closes with your first backtesting pass: running your written rules against 20 to 30 historical chart examples and honestly logging where the rules would have worked and where they wouldn't, setting up the refinement work in Chapter 35."
    ]
  },
  {
    "num": "35",
    "title": "Building a Personal Playbook \u2014 Part 2",
    "level": "advanced",
    "dur": "55 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Stress-testing your model on new data",
        "desc": "Testing your refined rules against a fresh set of charts you haven't already seen."
      },
      {
        "title": "Refining entry criteria from backtest results",
        "desc": "Using your Chapter 34 backtest results to tighten or loosen specific rules."
      },
      {
        "title": "Defining invalidation rules",
        "desc": "Writing an explicit rule for when a setup is no longer valid and should be abandoned."
      }
    ],
    "paragraphs": [
      "This chapter continues directly from Chapter 34, using the results of your first backtest to refine your written playbook. If a particular rule produced mostly false signals, this is where you tighten it; if a rule was so strict it rarely triggered at all, this is where you loosen it slightly and re-test.",
      "You'll then stress-test the refined version against a completely fresh set of chart examples you haven't already studied \u2014 an important step, since testing repeatedly on the same charts you refined your rules against will always look artificially good.",
      "The chapter closes with a piece most new traders skip entirely: writing an explicit invalidation rule for every setup. Knowing exactly what would prove your read wrong, before you enter, is what keeps you from holding a losing trade out of hope rather than analysis."
    ]
  },
  {
    "num": "36",
    "title": "Risk & Position Sizing",
    "level": "advanced",
    "dur": "58 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Position sizing from stop distance",
        "desc": "Calculating exact position size from your stop-loss distance and account risk percentage."
      },
      {
        "title": "Risk-per-trade discipline",
        "desc": "Why a fixed, small risk-per-trade is what allows a real edge to show up over time."
      },
      {
        "title": "Scaling size as your edge is proven",
        "desc": "A gradual, data-driven approach to increasing size, rather than an emotional one."
      }
    ],
    "paragraphs": [
      "A valid, well-confirmed ICT/SMT setup is still worthless without correct position sizing behind it. This chapter starts with the mechanical calculation: given your stop-loss distance in pips or points and your fixed risk percentage per trade, exactly how large your position should be.",
      "The chapter argues strongly for a small, fixed risk-per-trade \u2014 typically well under 2% of account equity \u2014 not out of excessive caution, but because it's mathematically what allows a real statistical edge to actually show up over a large enough sample of trades, rather than being wiped out by a single bad losing streak.",
      "You'll finish with a simple, rules-based framework for scaling size upward over time, tied to your actual backtested and live performance data from Chapters 34\u201335 and 39, rather than increasing size emotionally after a few wins."
    ]
  },
  {
    "num": "37",
    "title": "Trade Execution & Order Types",
    "level": "advanced",
    "dur": "42 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Limit vs. market entries on setups",
        "desc": "When to use a resting limit order versus a market order for your entry."
      },
      {
        "title": "Partial fills and slippage in fast markets",
        "desc": "What actually happens to your order during high-volatility moments."
      },
      {
        "title": "Execution checklist before you click buy or sell",
        "desc": "A final, mechanical checklist to run through in the seconds before entry."
      }
    ],
    "paragraphs": [
      "Knowing exactly what a valid setup looks like isn't the same as executing it cleanly, and this chapter closes that specific gap. You'll learn when a resting limit order \u2014 placed in advance inside your order block or OTE zone \u2014 is preferable to a market order chasing price after confirmation has already appeared.",
      "This chapter is also honest about the mechanics of fast markets: during genuine displacement, especially around news or a liquidity sweep, orders can experience slippage or partial fills, and understanding that in advance prevents confusion or panic when it happens on a live trade.",
      "You'll finish with a short, mechanical execution checklist \u2014 confirm structure, confirm liquidity context, confirm risk size, place the order \u2014 designed to be run through in the final seconds before entry so emotion has as little room as possible to interfere."
    ]
  },
  {
    "num": "38",
    "title": "Risk, Position Sizing & Execution Discipline",
    "level": "advanced",
    "dur": "58 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Translating a setup into a sized, risk-defined order",
        "desc": "Combining Chapters 36 and 37 into one seamless pre-trade routine."
      },
      {
        "title": "Avoiding overtrading after a loss",
        "desc": "Specific rules for pausing or reducing size after a losing trade, rather than immediately re-entering."
      },
      {
        "title": "A pre-trade checklist you actually use",
        "desc": "A short, printable checklist designed to be used before every single trade."
      }
    ],
    "paragraphs": [
      "This chapter combines the sizing rules from Chapter 36 and the execution mechanics from Chapter 37 into a single, seamless pre-trade routine, and adds one more critical layer: discipline immediately after a loss, which is where most avoidable damage in trading actually happens.",
      "The specific rule taught here is a mandatory pause or reduced-size period after any loss that breaks your own rules, along with a hard daily loss limit that ends your trading day entirely once reached \u2014 both designed to prevent one bad trade from becoming three or four.",
      "The chapter closes with a short, printable pre-trade checklist combining structure, liquidity, sizing, and execution into a single routine you're expected to run through, without exception, before every trade for the rest of this curriculum."
    ]
  },
  {
    "num": "39",
    "title": "Trade Journaling & Performance Review",
    "level": "advanced",
    "dur": "46 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "What to log after every trade",
        "desc": "The specific fields \u2014 not just win/loss \u2014 worth recording for every trade."
      },
      {
        "title": "Weekly review process",
        "desc": "A structured Sunday-evening routine for reviewing the past week's trades."
      },
      {
        "title": "Turning journal data into rule changes",
        "desc": "Using your own data, not opinion, to decide what to change in your playbook."
      }
    ],
    "paragraphs": [
      "Your journal, started back in Chapter 3, is the feedback loop that eventually turns a written playbook into a real, personal edge. This chapter formalizes exactly what to log for every trade: the setup type, the specific confluence factors present, entry and exit prices, and \u2014 critically \u2014 whether the trade followed your rules regardless of outcome.",
      "You'll build a structured weekly review routine: a fixed time each week to go through every trade from the past five days, tag it by setup type, and look honestly for patterns in what's working and what isn't.",
      "The chapter closes by connecting this directly back to your playbook from Chapters 34\u201335: journal data, not opinion or a single memorable loss, is what should drive any change to your written rules going forward."
    ]
  },
  {
    "num": "40",
    "title": "Scaling From Demo to Live",
    "level": "advanced",
    "dur": "40 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Demo-to-live transition checklist",
        "desc": "The specific performance benchmarks worth hitting on demo before going live."
      },
      {
        "title": "Psychological differences with real capital",
        "desc": "Why the exact same setup feels completely different once real money is on the line."
      },
      {
        "title": "Sizing up gradually and safely",
        "desc": "A staged approach to increasing size after the transition, rather than jumping in fully."
      }
    ],
    "paragraphs": [
      "Moving from demo or backtesting to live capital changes the psychology of every setup you already know how to execute, even though nothing about the chart itself is different. This chapter is explicit about that gap, rather than assuming demo performance will automatically translate.",
      "You'll get a specific transition checklist: a minimum number of demo trades, a minimum win rate or expectancy threshold from your journal, and a demonstrated ability to follow your own invalidation and risk rules consistently, before moving to real capital at all.",
      "The chapter closes with a staged sizing approach for the first weeks live \u2014 starting meaningfully smaller than your calculated 'proper' size and increasing gradually as your live journal confirms the same edge you saw in backtesting."
    ]
  },
  {
    "num": "41",
    "title": "Prop Firm & Funded Account Considerations",
    "level": "advanced",
    "dur": "44 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "How evaluation rules affect setup choice",
        "desc": "Adjusting which setups you take based on daily and max drawdown limits."
      },
      {
        "title": "Adjusting risk for drawdown limits",
        "desc": "Recalculating position sizing specifically around prop firm constraints."
      },
      {
        "title": "Common reasons funded accounts fail",
        "desc": "The specific, avoidable mistakes that cause most evaluation and funded account failures."
      }
    ],
    "paragraphs": [
      "If your goal is a prop firm evaluation or a funded account, the fixed rules of that evaluation change how you should apply everything else in this curriculum. A strict daily loss limit, for example, might mean skipping an otherwise valid Asian-session setup simply because it doesn't leave enough of a buffer for the rest of the day.",
      "This chapter walks through recalculating your position sizing specifically around common prop firm constraints \u2014 daily drawdown, maximum overall drawdown, and minimum trading-day requirements \u2014 which are often meaningfully different from the sizing approach in Chapter 36 for a personal account.",
      "The chapter closes with an honest list of the most common, and most avoidable, reasons funded accounts fail: oversizing after an early lead, revenge trading after a single loss near the daily limit, and abandoning a proven playbook under evaluation pressure."
    ]
  },
  {
    "num": "42",
    "title": "Building Your Own Institutional Playbook",
    "level": "advanced",
    "dur": "50 min",
    "video": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "lessons": [
      {
        "title": "Combining structure, liquidity, FVGs & SMT into one plan",
        "desc": "The final, complete written synthesis of everything from Chapters 1 through 41."
      },
      {
        "title": "Final capstone chart-marking review",
        "desc": "A graded, comprehensive review covering every major concept in the curriculum."
      },
      {
        "title": "Where to go next after Chapter 42",
        "desc": "Guidance on continued live-session attendance, mentorship, and ongoing journal review."
      }
    ],
    "paragraphs": [
      "This capstone chapter doesn't introduce new concepts \u2014 it's where every tool from Chapters 1 through 41 gets combined into one finished, personal, written trading plan: your instrument and session focus, your structural and liquidity entry criteria, your SMT confirmation process, your sizing rules, and your invalidation criteria, all in a single document.",
      "You'll complete a comprehensive, graded chart-marking review covering market structure, order blocks, fair value gaps, liquidity sweeps, and SMT divergence together on unlabeled charts \u2014 the same style of review you've done after every chapter, but combining all of them at once.",
      "The chapter closes with guidance for what comes after Chapter 42: continued attendance at the weekly live killzone sessions, ongoing journal review using the process from Chapter 39, and \u2014 for traders on the Desk Membership or Mentorship tracks \u2014 how to get the most out of the trading floor community and 1:1 chart reviews going forward."
    ]
  }
];

const LEVEL_LABEL = { foundation: 'Foundation', intermediate: 'Intermediate', advanced: 'Advanced' };
const LEVEL_TAG_CLASS = { foundation: 'tag-foundation', intermediate: 'tag-intermediate', advanced: 'tag-advanced' };
const PART_LABEL = {
  foundation: 'Part I — Foundation',
  intermediate: 'Part II — Intermediate: ICT Core Concepts',
  advanced: 'Part III — Advanced: SMT & Institutional Execution'
};
