#!/usr/bin/env python3
"""VP-03 Volume Profile Anatomy: POC, Value Area, HVN & LVN."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

# ---------------------------------------------------------------- data (illustrative ES session)
TICK = 0.25
prices = [5210.00 + TICK * i for i in range(17)]            # 5,210.00 .. 5,214.00, low -> high
vols = [60, 140, 310, 520, 780, 960, 1240, 1420, 1180, 700, 380, 240, 310, 520, 430, 190, 70]
poc, lo, hi, steps = value_area_steps(prices, vols)
total = sum(vols)
POC, VAL, VAH = prices[poc], prices[lo], prices[hi]
va_vol = sum(vols[lo:hi + 1])

# LVN: local minimum between the two volume peaks. Upper HVN: local maximum above it.
peaks = [i for i in range(poc + 1, len(vols) - 1) if vols[i] > vols[i - 1] and vols[i] >= vols[i + 1]]
hvn2_i = peaks[0]                                              # first local peak above the POC
lvn_i = min(range(poc + 1, hvn2_i), key=lambda i: vols[i])     # the pinch between the two peaks
assert vols[lvn_i] < vols[hvn2_i] < vols[poc]
LVN, HVN2 = prices[lvn_i], prices[hvn2_i]

# ---------------------------------------------------------------- figure 1: bars -> profile
# Four 30-minute bars' volume at price, summed into one profile (all illustrative).
bar_prices = [5210.0 + TICK * i for i in range(9)]
bars = [
    [0, 0, 20, 60, 90, 70, 30, 0, 0],
    [0, 10, 40, 80, 120, 110, 60, 20, 0],
    [0, 0, 0, 30, 80, 130, 100, 50, 10],
    [10, 20, 30, 40, 60, 50, 30, 10, 0],
]
summed = [sum(b[i] for b in bars) for i in range(9)]


def build_fig():
    row_h = 20; top = 26; n = len(bar_prices)
    h = top + n * row_h + 40
    o = []
    colw = 52; x0 = 78
    maxv = float(max(max(b) for b in bars))
    for j, b in enumerate(bars):
        x = x0 + j * (colw + 6)
        o.append(text(x + colw / 2, 18, 'bar %d' % (j + 1), 13, MUTED, 'middle'))
        for i in range(n):
            y = top + (n - 1 - i) * row_h
            if b[i]:
                o.append(rect(x, y + 3, b[i] / maxv * colw, row_h - 6, fill=TEAL, opacity=0.55, rx=2))
    xs = x0 + 4 * (colw + 6) + 4
    o.append(text(xs - 8, top + n * row_h / 2, '=', 16, INK, 'middle', 'bold'))
    smax = float(max(summed))
    for i in range(n):
        y = top + (n - 1 - i) * row_h
        o.append(text(x0 - 8, y + 15, fmt(bar_prices[i]), 13, MUTED, 'end'))
        o.append(rect(xs + 4, y + 3, summed[i] / smax * 60, row_h - 6,
                      fill=GOLD if summed[i] == smax else TEAL, opacity=0.9, rx=2))
    o.append(text(xs + 34, 18, 'profile', 13, INK, 'middle'))
    o.append(text(200, h - 12, 'volume at each price, added across the bars', 13, MUTED, 'middle'))
    return svg(h, o, 'Four time bars summed into one volume profile')


fig_build = figure(build_fig(), 'Each bar\'s volume at each price is added up across the session. '
                   'Turned on its side, the totals become the profile. The gold row is the price with the most volume.')

fig_main_svg, _ = profile(prices, vols, 'Session volume profile with POC, value area, HVN and LVN',
                          mark_nodes={lvn_i: 'LVN', hvn2_i: 'HVN'})
fig_main = figure(fig_main_svg, 'An illustrative ES session. POC %s, value area %s to %s. '
                  'The thin LVN at %s separates the main high-volume node from a smaller one above it.'
                  % (fmt(POC), fmt(VAL), fmt(VAH), fmt(LVN)))

# worked value-area table
va_rows = []
acc = vols[poc]
va_rows.append(['0', 'POC ' + fmt(POC), '-', '-', '{:,} ({:.1f}%)'.format(vols[poc], 100.0 * vols[poc] / total)])
for k, s in enumerate(steps, 1):
    va_rows.append([str(k), 'add ' + s['side'], '{:,}'.format(s['up']) if s['up'] >= 0 else 'none',
                    '{:,}'.format(s['down']) if s['down'] >= 0 else 'none', '{:,} ({:.1f}%)'.format(s['acc'], 100 * s['pct'])])
va_table = table(['Step', 'Add', 'Next 2 above', 'Next 2 below', 'Total so far'], va_rows)

# ---------------------------------------------------------------- figure: HVN/LVN price behaviour (illustrative candles)
ohlc = [
    (5212.50, 5213.25, 5212.25, 5213.00), (5213.00, 5213.75, 5212.75, 5213.50), (5213.50, 5213.75, 5212.75, 5212.75),
    (5212.75, 5213.00, 5212.00, 5212.25), (5212.25, 5212.50, 5211.50, 5211.75), (5211.75, 5212.25, 5211.50, 5212.00),
    (5212.00, 5212.25, 5211.25, 5211.50), (5211.50, 5212.00, 5211.25, 5211.75), (5211.75, 5212.00, 5211.50, 5211.75),
]
fig_nodes_svg, _ = candles(ohlc, 'Price moves quickly through an LVN and slows inside an HVN', lo=5210.75, hi=5214.0, height=250,
                           zones=[(LVN - TICK / 2, LVN + TICK / 2, 'LVN', RED), (VAL, VAH, 'HVN', TEAL)],
                           levels=[(POC, 'POC', GOLD, '4 3')])
fig_nodes = figure(fig_nodes_svg, 'A common reading: price crosses the thin LVN in one or two bars, '
                   'then rotates in small candles once it reaches the high-volume node around the POC.')

fig_tpo_vs_vol = figure(boxes([
    ('Volume profile', ['counts contracts traded', 'at each price'], TEAL),
    ('TPO profile', ['counts 30-minute periods', 'that visited each price'], GOLD),
    ('Agree when...', ['time spent and size', 'traded line up'], GREEN),
    ('Differ when...', ['a big burst of volume', 'trades in little time'], RED),
], 'Volume profile compared with TPO profile'),
    'The two profiles measure different things. Many traders look at both and pay attention when they disagree.')

# ---------------------------------------------------------------- body
share = 100.0 * va_vol / total
body = [
    '<p>A candlestick chart tells you <em>when</em> price moved. A <strong>volume profile</strong> tells you <em>where</em> '
    'business was done. It takes all the contracts traded over a period and stacks them sideways at each price, so you can see at '
    'a glance which prices the market accepted and which it rushed past. This chapter builds a profile from scratch, then names its '
    'parts: the point of control, the value area and its edges, and the high- and low-volume nodes. You will compute a value area '
    'by hand, because doing it once makes every profile you see afterwards easier to read.</p>',
    '<p>Volume profile grew out of the Market Profile work that J. Peter Steidlmayer developed at the Chicago Board of Trade, which '
    'the exchange released to the public in 1985 (covered in <a href="chapter.html?ch=VP-02">VP-02</a>). Treat everything here as a '
    '<strong>method traders use</strong> to organise information, not as a law of how price must behave.</p>',

    '<h3>How a volume profile is built</h3>',
    '<p><strong>Volume</strong> is the number of contracts that changed hands. A volume profile answers one question for every price '
    'level: how many contracts traded here during the period I picked? Stack those totals horizontally and you get a histogram '
    'standing on its side. Long bars are prices where a lot of trading happened. Short bars are prices the market visited only briefly.</p>',
    '<p>There are two ways platforms build it. The precise way uses every individual trade (tick data): each trade adds its size to '
    'the row for its exact price. The approximate way uses lower-timeframe bars. TradingView, for example, says in its help pages that '
    'it builds a daily session profile by loading the session\'s 1-minute bars and spreading each bar\'s volume across the prices that bar '
    'covered. The approximate way is usually close enough to read the shape. It can be off by a tick or two on exact levels.</p>',
    fig_build,
    '<p>The <strong>row size</strong> (also called ticks per row) matters. On E-mini S&amp;P 500 futures (ES) the minimum price move is '
    '0.25 index points, so the finest profile has one row per 0.25. Wider rows smooth the shape. Narrower rows show more detail and more '
    'noise. Pick one setting per instrument and keep it, so your levels are comparable from day to day.</p>',

    '<h3>The point of control (POC)</h3>',
    '<p>The <strong>point of control</strong> is the single price with the most volume in the profile. TradingView defines it the same '
    'way: the price level with the highest traded volume for the period. In the session below the POC is <strong>%s</strong>, with '
    '{:,} contracts out of {:,}.</p>'.format(vols[poc], total) % fmt(POC),
    '<p>Traders read the POC as the price the market treated as fairest during that period, because it is where buyers and sellers were '
    'most willing to trade with each other. It is a reference, not a wall. Price often returns to it, trades through it, or ignores it '
    'completely, depending on what happens next.</p>',
    fig_main,

    '<h3>The value area, VAH and VAL</h3>',
    '<p>The <strong>value area</strong> is the range of prices around the POC that contains a set share of the period\'s volume. The '
    'convention is <strong>70%</strong>. It comes from the original CBOT Market Profile, which borrowed the idea that about 70% of a '
    'normal distribution sits within one standard deviation of the middle. TradingView\'s documentation gives 70% as the typical setting, '
    'and Sierra Chart lets you change it. The top of the range is the <strong>value area high (VAH)</strong>. The bottom is the '
    '<strong>value area low (VAL)</strong>.</p>',
    '<p>The 70% is a convention, not something the market knows about. Treat VAH and VAL as the edges of where most business was '
    'done, and expect different platforms to disagree by a tick when they use different methods or row sizes.</p>',

    '<h3>Worked example: computing the value area by hand</h3>',
    '<p>The most common method is the <strong>two-row method</strong> from the CBOT Market Profile material. Start at the POC. Look at '
    'the next two rows above and add their volumes. Look at the next two rows below and add theirs. Include whichever pair is larger. '
    'Repeat until the included volume reaches 70% of the total. Here it is on the illustrative session above ({:,} contracts, so the '
    'target is {:,}).</p>'.format(total, int(round(total * 0.7))),
    va_table,
    '<p>The procedure stops once the running total passes 70%. It ends at <strong>{:.1f}%</strong>, because it adds two rows at a '
    'time and overshoots slightly. The value area runs from <strong>{}</strong> (VAL) to <strong>{}</strong> (VAH). Notice that it is '
    'not centred on the POC. Volume below the POC was heavier, so the value area grew downward faster than upward. That lopsidedness is '
    'information: it tells you on which side of the POC more business was done.</p>'.format(share, fmt(VAL), fmt(VAH)),
    callout('Try it yourself', '<p>Change the rule to one row at a time and redo the table. You will usually land on the same area, or '
            'one row different. That difference is exactly why two platforms can show VAH or VAL a tick apart.</p>'),

    '<h3>High-volume and low-volume nodes (HVN and LVN)</h3>',
    '<p>Most profiles are not one smooth hill. They have bulges and pinches. A <strong>high-volume node (HVN)</strong> is a bulge: a '
    'cluster of prices where a lot of volume traded, usually around a POC. A <strong>low-volume node (LVN)</strong> is a pinch: a thin '
    'area between bulges where little volume traded. In our session the main HVN sits around the POC, a smaller HVN forms at %s, and the '
    'LVN at %s separates them. Sierra Chart calls these "peaks and valleys" in its Volume by Price study.</p>' % (fmt(HVN2), fmt(LVN)),
    '<p>The common reading is simple. An HVN is a price area the market accepted, so price tends to slow down and rotate there. An LVN '
    'is a price area the market rejected, or moved through quickly, so price tends to move fast through it and the far edge of the LVN often '
    'acts as a reaction point. These are tendencies traders watch for, not rules.</p>',
    fig_nodes,
    '<p>This links directly to what you already know from the core course. A thin LVN is the profile\'s version of an imbalance, much '
    'like a fair value gap on a candle chart (<a href="chapter.html?ch=10">chapter 10</a>), and <a href="chapter.html?ch=VP-11">VP-11</a> '
    'shows how to combine them.</p>',

    '<h3>Volume profile vs TPO profile</h3>',
    '<p>You will see two kinds of profile. A <strong>volume profile</strong> counts contracts. A <strong>TPO profile</strong> '
    '(time price opportunity, from Market Profile) counts how many 30-minute periods visited each price. They usually look similar, '
    'because price that spends a long time somewhere tends to trade a lot there. They differ when a large amount of volume trades in '
    'a short burst, for example at a news release. The volume profile then shows a big node where the TPO profile shows very little.</p>',
    fig_tpo_vs_vol,
    '<p>Many traders keep both on screen and treat the disagreement as useful: heavy volume in little time can mean a large participant '
    'did business quickly at that price.</p>',

    '<h3>Common mistakes</h3>',
    '<ul>'
    '<li><strong>Treating the POC as support or resistance by itself.</strong> It is a reference for where value was, not a promise '
    'that price will bounce there.</li>'
    '<li><strong>Mixing row sizes.</strong> A profile with 1-point rows and one with 0.25-point rows give different POCs. Keep '
    'settings fixed per instrument.</li>'
    '<li><strong>Using a profile from the wrong period.</strong> A profile built on the visible chart changes every time you scroll. '
    'Anchor it to something definite, like a session or a swing (see <a href="chapter.html?ch=VP-05">VP-05</a>).</li>'
    '<li><strong>Reading tick volume as traded volume.</strong> On spot FX and CFDs, TradingView counts price updates, not contracts. '
    'The profile shape can still be useful, but it is a different measure (see <a href="chapter.html?ch=VP-10">VP-10</a>).</li>'
    '<li><strong>Expecting every platform to agree to the tick.</strong> The value area method, the row size and whether the profile is '
    'built from ticks or bars all shift the edges slightly.</li>'
    '</ul>',

    callout('Key takeaways', '<ul>'
            '<li>A volume profile shows how many contracts traded at each price over a period you choose.</li>'
            '<li>The POC is the price with the most volume. The value area holds 70% of the volume by convention, bounded by VAH and VAL.</li>'
            '<li>The two-row method starts at the POC and adds the heavier pair of rows until it reaches 70%.</li>'
            '<li>HVNs are accepted areas where price tends to rotate. LVNs are thin areas price tends to cross quickly.</li>'
            '<li>These are reading tools, not predictions. Always combine them with structure and risk rules.</li>'
            '</ul>'),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Open an ES or NQ chart and add a session volume profile to yesterday\'s regular trading hours. Write down the POC, VAH and '
    'VAL before you look at today\'s price.</li>'
    '<li>Copy the volumes of the ten rows around a POC into a spreadsheet. Compute the 70% value area with the two-row method and '
    'compare it with your platform\'s VAH and VAL.</li>'
    '<li>Mark every LVN on the last five session profiles. For each one, note whether price later crossed it in one or two bars or '
    'stalled inside it. Keep the tally in your journal.</li>'
    '<li>Change the row size (for example 0.25, 1 and 2 points) on the same session and note how the POC moves. Choose a setting and '
    'record it in your playbook.</li>'
    '</ol>',

    quiz([
        ('What does the point of control show?',
         '<p>The single price with the most traded volume in the period. It is a reference for where the market did the most business, '
         'not a guaranteed turning point.</p>'),
        ('Why is the value area set at 70%?',
         '<p>It is a convention from the original CBOT Market Profile, based on the share of a normal distribution within one standard '
         'deviation of the middle. Platforms let you change it.</p>'),
        ('In the two-row method, what do you compare at each step?',
         '<p>The combined volume of the next two rows above the current value area and the next two rows below it. You add the larger '
         'pair and repeat until you reach 70%.</p>'),
        ('Why was the value area in this chapter\'s example not centred on the POC?',
         '<p>More volume traded below the POC than above it, so the heavier pairs were on the lower side and the area grew downward.</p>'),
        ('How is an LVN usually read?',
         '<p>As a thin area the market moved through quickly or rejected, so price tends to cross it fast. The far side of it is often '
         'watched for a reaction.</p>'),
        ('Why might TradingView\'s profile on a forex CFD differ from a futures profile?',
         '<p>TradingView uses tick volume (the number of price updates) for forex and CFDs, not contracts traded, because spot FX has no '
         'single central exchange reporting volume.</p>'),
    ]),
]

lessons = [
    ('How a volume profile is built',
     '<p>Pick one ES session and look at it as a candlestick chart and as a session volume profile side by side. Find two candles whose '
     'range overlaps the POC row, and check that most of the session\'s heavy trading sits in that band.</p>'),
    ('Finding the POC, VAH and VAL',
     '<p>For the last three sessions, write down the POC, VAH and VAL before the next session opens. Next day, note which of the three '
     'levels price touched first and what it did there. Record only what happened, not what you expected.</p>'),
    ('Computing a value area by hand',
     '<p>Take the worked table in this chapter and redo it on real data from your platform: copy ten to fifteen rows of volume around the '
     'POC, apply the two-row method, and compare your VAH and VAL with the platform\'s. Explain any one-tick difference.</p>'),
    ('Spotting HVNs and LVNs',
     '<p>On a five-day composite profile, circle every HVN and LVN. Then scroll forward and tag each LVN crossing as "fast" (one or two '
     'bars) or "slow". This builds your own evidence on how LVNs behave on your instrument.</p>'),
    ('Volume vs TPO profiles',
     '<p>Put a TPO profile and a volume profile on the same session. Find one price where they disagree most, then check the time and '
     'sales or a 1-minute chart for what happened there, for example a news release.</p>'),
]

src = [
    ('Volume profile indicators: basic concepts - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/'),
    ('Volume by Price study - Sierra Chart documentation', 'https://www.sierrachart.com/index.php?ID=141&Name=Volume_by_Price&page=doc%2FStudiesReference.php'),
    ('Market profile (history of the CBOT Market Profile and the 70% value area) - Wikipedia', 'https://en.wikipedia.org/wiki/Market_profile'),
    ('Micro E-mini Equity Index Futures FAQ (tick sizes and multipliers) - CME Group', 'https://www.cmegroup.com/articles/faqs/micro-e-mini-equity-index-futures-frequently-asked-questions.html'),
    ('Mind Over Markets, Updated Edition (Dalton, Jones, Dalton; Wiley 2013) - further reading', 'https://oreilly.com/library/view/mind-over-markets/9781118659762/f02.html'),
    ('Markets and Market Logic (Steidlmayer, Koy; 1986) - further reading', 'https://books.google.com/books/about/Markets_and_Market_Logic.html?id=Lb9FPQAACAAJ'),
]

write_chapter('vp', 'VP-03', 'Volume Profile Anatomy: POC, Value Area, HVN & LVN', 'foundation', '35 min', lessons, body, src)
