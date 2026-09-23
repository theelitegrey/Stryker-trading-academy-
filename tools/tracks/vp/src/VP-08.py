#!/usr/bin/env python3
"""VP-08 Footprint Charts & Delta."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

T = 0.25


def bar(o, c, rows):
    """rows: list of (bid, ask) from HIGH price down; prices counted from max(o,c,high)."""
    return {'o': o, 'c': c, 'rows': rows}


def mk(high, pairs, o, c):
    rows = {round(high - k * T, 2): pr for k, pr in enumerate(pairs)}
    assert o in rows and c in rows
    return {'o': o, 'c': c, 'rows': rows}


# ---------------------------------------------------------------- one bar, explained cell by cell
one = mk(5201.00, [(4, 18), (22, 41), (35, 38), (40, 29), (16, 6)], o=5200.25, c=5200.75)
d1, t1 = delta_rows(one['rows'])
cell_rows = []
for p in sorted(one['rows'], reverse=True):
    b, a = one['rows'][p]
    cell_rows.append([fmt(p), str(b), str(a), '%+d' % (a - b), str(a + b)])
cell_table = table(['Price', 'Bid', 'Ask', 'Delta', 'Vol'] , cell_rows + [['Bar', str(sum(b for b, a in one['rows'].values())),
                                                                                               str(sum(a for b, a in one['rows'].values())), '%+d' % d1, str(t1)]])
fig_one = figure(footprint([one], 'A single footprint bar', T, show_imb=False),
                 'Each row shows contracts that traded at the bid (left, sellers were aggressive) and at the ask (right, buyers were '
                 'aggressive). The coloured strip on the left marks the open-to-close body. Bar delta %+d on %d contracts.' % (d1, t1))

# ---------------------------------------------------------------- three bars with imbalances
b1 = mk(5202.00, [(3, 9), (14, 31), (28, 36), (33, 22), (12, 8)], o=5201.00, c=5201.75)
b2 = mk(5203.25, [(2, 12), (6, 44), (9, 51), (12, 47), (14, 30), (24, 19)], o=5202.00, c=5203.00)
b3 = mk(5203.75, [(18, 5), (42, 31), (37, 26), (29, 34), (11, 9)], o=5203.25, c=5202.75)
bars3 = [b1, b2, b3]
buys2, sells2 = diagonal_imbalances(b2['rows'], T, 3.0)
stack = sorted(buys2)
# the text claims a stack of three or more consecutive buy imbalances in bar 2
run = 1; best = 1
for i in range(1, len(stack)):
    run = run + 1 if abs(stack[i] - stack[i - 1] - T) < 1e-9 else 1; best = max(best, run)
assert best >= 3, stack
ex_p = stack[1]; ex_ask = b2['rows'][ex_p][1]; ex_bid_below = b2['rows'][round(ex_p - T, 2)][0]
fig_three = figure(footprint(bars3, 'Three footprint bars with diagonal imbalances', T, ratio=3.0,
                             labels=[(1, 'stacked buys')]),
                   'Bold green numbers are buy imbalances: ask volume at least 3 times the bid volume one tick lower. Bar 2 has %d of them '
                   'in a row, a "stacked" imbalance. Bar 3 turns negative.' % best)
deltas = [delta_rows(b['rows'])[0] for b in bars3]

# ---------------------------------------------------------------- cumulative delta and a divergence (illustrative)
highs = [5210.00, 5211.25, 5212.50, 5212.00, 5213.25, 5214.00, 5213.50, 5214.75, 5215.25, 5214.50]
bar_delta = [420, 380, 510, -120, 260, 190, -240, 90, 40, -310]
cd = []; run = 0
for d in bar_delta:
    run += d; cd.append(run)
# price makes higher highs at bars 6, 8, 9 (index 5, 7, 8); CD peaks earlier
i_ph1 = 5; i_ph2 = 8
assert highs[i_ph2] > highs[i_ph1] and cd[i_ph2] < cd[i_ph1]
ph_svg, _ = series([(highs, GREEN, 'high')], 'Price: bar highs', height=170, dp=2,
                   point_labels=[(i_ph1, highs[i_ph1], 'H1', GOLD), (i_ph2, highs[i_ph2], 'H2', GOLD)])
cd_svg, _ = series([(cd, TEAL, 'CD')], 'Cumulative delta', height=170, zero=True,
                   point_labels=[(i_ph1, cd[i_ph1], '%+d' % cd[i_ph1], GOLD), (i_ph2, cd[i_ph2], '%+d' % cd[i_ph2], GOLD)])
fig_div = figure(ph_svg + cd_svg, 'Price makes a higher high at H2 (%s vs %s), but cumulative delta at H2 (%+d) is below its level at H1 '
                 '(%+d). Less net aggressive buying made the second high. That is a bearish delta divergence.'
                 % (fmt(highs[i_ph2]), fmt(highs[i_ph1]), cd[i_ph2], cd[i_ph1]))

body = [
    '<p>A candlestick shows four prices. A <strong>footprint chart</strong> opens the candle up and shows every price inside it, with how many '
    'contracts traded there and on which side. It is the main tool of order-flow trading, and the place where the ideas from '
    '<a href="chapter.html?ch=VP-07">VP-07</a> (aggressors, passive orders, the bid and the ask) become something you can read bar by bar.</p>',
    '<p>Different platforms call it different things: Sierra Chart\'s <strong>Numbers Bars</strong>, NinjaTrader\'s <strong>Volumetric Bars</strong>, '
    'ATAS\'s <strong>Cluster chart</strong>, TradingView\'s <strong>Volume Footprint</strong>. The idea is the same in all of them.</p>',

    '<h3>Reading one footprint bar</h3>',
    '<p>Each row is one price. The number on the left is volume that traded <strong>at the bid</strong>, meaning a seller hit a resting buy order. The '
    'number on the right is volume that traded <strong>at the ask</strong>, meaning a buyer lifted a resting sell order. So "bid x ask" is really '
    '"aggressive sells x aggressive buys" at that price. Sierra Chart\'s documentation notes the footprint only needs the best bid and ask at the '
    'time of each trade to classify it, not full depth.</p>',
    fig_one,
    cell_table,
    '<p>Bid = contracts sold into the bid, Ask = contracts bought at the ask, Vol = both added together. Read the table row by row. At the top of the bar buyers were far more active (18 against 4). In the middle, the two sides were close. At '
    'the bottom, sellers dominated (16 against 6). Overall, the bar\'s <strong>delta</strong> is %+d: more contracts traded at the ask than at the bid.</p>' % d1,

    '<h3>Delta</h3>',
    '<p><strong>Delta</strong> is ask volume minus bid volume: aggressive buying minus aggressive selling. It can be measured per price, per bar, '
    'or across a session. Positive delta means buyers crossed the spread more often; negative means sellers did.</p>',
    '<p>Remember what delta is <em>not</em>. Every contract has a buyer and a seller, so delta does not measure "more buyers than sellers". It '
    'measures who was <strong>more urgent</strong>. A bar can have strongly positive delta and still close down, if passive sellers absorbed all '
    'that buying with limit orders. That mismatch is the heart of VP-09.</p>',
    '<p>One data caveat. True delta needs each trade tagged as buy or sell aggressor, which CME data provides. TradingView\'s footprint guide '
    'explains that it categorises volume from intrabar price moves instead (an up-tick counts as buying), with 1-tick data only on professional '
    'plans and 1-second or 1-minute data otherwise. That is an approximation, and it can differ noticeably from true aggressor-side delta.</p>',

    '<h3>Diagonal imbalances</h3>',
    '<p>An <strong>imbalance</strong> is a price where one side traded much more than the other. The major platforms compare <strong>diagonally</strong>: '
    'ask volume at a price against bid volume one tick <em>lower</em>. ATAS explains why: in the book, the best ask always sits one tick above the '
    'best bid, so those are the two numbers that were actually competing at the same moment. NinjaTrader\'s Volumetric Bars documentation uses '
    'the same diagonal comparison.</p>',
    fig_three,
    '<p>Check one by hand. In bar 2, the ask at %s traded <strong>%d</strong>. One tick lower, the bid traded <strong>%d</strong>. %d is at least 3 x %d, '
    'so %s is a buy imbalance. The ratio is a setting. ATAS\'s default treats 200%% as an imbalance and 400%% as strong; NinjaTrader\'s default ratio '
    'is 1.5. This chapter uses 3 (300%%). Different settings give different imbalances on the same data, so write yours down.</p>'
    % (fmt(ex_p), ex_ask, ex_bid_below, ex_ask, ex_bid_below, fmt(ex_p)),
    '<p>Several imbalances on consecutive prices form a <strong>stacked imbalance</strong>. Bar 2 has %d. Practitioners read a stack as a zone '
    'where one side was aggressively and repeatedly one-sided, and NinjaTrader\'s documentation notes that clusters of imbalances can act as '
    'support or resistance areas. It is the order-flow cousin of a fair value gap: a place price moved through with one side dominant '
    '(<a href="chapter.html?ch=10">chapter 10</a>).</p>' % best,
    '<p>Bar deltas across the three bars: %s. Bar 3 turns negative at the high and closes down. Is that the start of a reversal or just a pause? '
    'The footprint alone can\'t say. That is why the next section looks at delta over a longer stretch.</p>' % ', '.join('%+d' % d for d in deltas),

    '<h3>Cumulative delta</h3>',
    '<p><strong>Cumulative delta</strong> (CD, or CVD for cumulative volume delta) is the running total of delta, bar after bar, usually reset each '
    'session. Sierra Chart defines it exactly that way: the running sum of ask volume minus bid volume. Plotted under price, it shows whether '
    'aggressive buying or selling has dominated the session so far.</p>',
    '<p>Most of the time CD and price move together: price rises while CD rises. The interesting moments are when they don\'t.</p>',

    '<h3>Delta divergence</h3>',
    '<p>A <strong>delta divergence</strong> is when price makes a new high (or low) but cumulative delta does not. TradingView\'s footprint guide '
    'lists it among the patterns traders look for.</p>',
    fig_div,
    '<p>The reading: the second high was reached with less net aggressive buying than the first. Maybe buyers are tiring, or maybe passive '
    'sellers are absorbing them. Either way, the push behind the move has weakened. The mirror image, a lower low in price with a higher low '
    'in CD, is a bullish divergence.</p>',
    '<p>A divergence is a <strong>warning, not a signal</strong>. Trends can show divergence for a long time and keep going. It becomes more '
    'interesting when it happens at a level you already care about: a prior VAH, a naked POC, a liquidity pool above equal highs. It sits in '
    'the same family as SMT divergence from the core course (<a href="chapter.html?ch=17">chapter 17</a>): one measure makes a new extreme, a '
    'related one doesn\'t.</p>',

    '<h3>Where the delta sits inside the bar</h3>',
    '<p>Bar delta is one number, but the footprint shows where it came from. Two bars can both have delta +150 and tell very different stories.</p>',
    cards(['Where the delta is', 'What it shows', 'A common reading'], [
        ['Positive delta concentrated at the high, bar closes at the high', 'Buyers were most aggressive at the top and price kept going.', 'Strength: the move was being chased and accepted.'],
        ['Positive delta concentrated at the high, bar closes well off the high', 'Buyers were aggressive at the top but price came back down.', 'Possible absorption or trapped buyers at the high (VP-09).'],
        ['Heavy selling at the low, bar closes back up', 'Sellers hit the bid at the bottom but could not keep price there.', 'Possible exhaustion or absorption of selling at the low.'],
        ['Delta spread evenly across the bar', 'No single price where one side dominated.', 'Rotation; little to read from this bar on its own.'],
    ]),
    '<p>That is why experienced footprint readers look at the top and bottom two or three rows of each bar first. The extremes are where one '
    'side either won the auction or ran out of steam. The middle of the bar is usually just two-way trade.</p>',
    '<h3>Session reset and what cumulative delta can\'t show</h3>',
    '<p>Because cumulative delta is usually reset at the session start, its absolute value tells you little. "+1,450" is not high or low on its '
    'own; it depends on the day\'s volume. Traders watch its <strong>shape</strong>: rising, flat, or falling, and whether its swings agree with '
    'price swings. Cumulative delta also knows nothing about passive orders. Large limit buyers who never cross the spread don\'t appear in delta at '
    'all, however big they are. The footprint shows their effect only indirectly: price that doesn\'t fall despite heavy selling at the bid.</p>',
    '<h3>Worked example: reading the three bars</h3>',
    '<ol>'
    '<li><strong>Bar 1</strong> closes up with delta %+d. Buyers were a little more aggressive, nothing unusual.</li>'
    '<li><strong>Bar 2</strong> closes near its high with delta %+d and %d stacked buy imbalances. Buyers were very aggressive across several prices.</li>'
    '<li><strong>Bar 3</strong> opens near that high, trades two ticks higher, and closes down with delta %+d. Aggressive selling took over at the top.</li>'
    '<li><strong>Question:</strong> where would a pullback be expected to find buyers again? A common answer is the stacked-imbalance zone in bar 2, '
    'where buyers were most aggressive before. Whether they return there is what you watch next.</li>'
    '</ol>' % (deltas[0], deltas[1], best, deltas[2]),

    '<h3>Footprint display modes</h3>',
    '<p>Most platforms can show the same data several ways. <strong>Bid x ask</strong> (used here) is the most complete. <strong>Delta per price</strong> '
    'shows one number per row. <strong>Volume per price</strong> is just a tiny volume profile inside each bar. Some also mark each bar\'s own POC. '
    'Start with bid x ask; the others are summaries of it.</p>',
    '<p>Choose the bar type carefully. On a fast market a 1-minute footprint can have dozens of rows; on a slow one it can have three. Many '
    'order-flow traders use volume-based or range-based bars instead of time bars so each footprint holds a comparable amount of activity. '
    'Whichever you choose, keep it fixed while you are learning, so that "large" and "small" numbers mean the same thing from day to day.</p>',

    '<h3>Common mistakes</h3>',
    '<ul>'
    '<li><strong>Reading positive delta as "price will go up".</strong> It records urgency, not direction.</li>'
    '<li><strong>Comparing horizontally.</strong> Imbalances are diagonal: ask at a price vs bid one tick lower.</li>'
    '<li><strong>Using approximated delta as if it were exact.</strong> Know how your platform classifies trades.</li>'
    '<li><strong>Trading every divergence.</strong> Trends can diverge for hours.</li>'
    '<li><strong>Changing imbalance ratios day to day.</strong> Pick one per instrument and keep it.</li>'
    '</ul>',

    callout('Key takeaways', '<ul>'
            '<li>A footprint shows bid (aggressive sells) x ask (aggressive buys) at each price inside a bar.</li>'
            '<li>Delta = ask volume minus bid volume. It measures urgency, not the number of buyers.</li>'
            '<li>Imbalances are diagonal comparisons; stacks of them mark one-sided zones.</li>'
            '<li>Cumulative delta is the running total; divergence from price is a warning, not a signal.</li>'
            '<li>Data quality matters: true aggressor data versus tick-rule approximations.</li>'
            '</ul>'),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Recompute every imbalance in the three-bar figure at a ratio of 2 instead of 3. Which new ones appear?</li>'
    '<li>On ES, find five bars with delta above +300 that closed down. What was the price level?</li>'
    '<li>Mark every stacked imbalance (three or more) in one session and record whether price returned to it.</li>'
    '<li>Find two bullish and two bearish CD divergences at levels from your VP-05 map. Note what happened in the next 30 minutes.</li>'
    '</ol>',

    quiz([
        ('On a footprint, what does the number on the left of "35 x 38" represent?', '<p>35 contracts traded at the bid: sellers were the aggressors.</p>'),
        ('How is a buy imbalance measured?', '<p>Ask volume at a price compared with bid volume one tick lower, against a set ratio.</p>'),
        ('Can a bar with positive delta close down?', '<p>Yes. Passive sellers can absorb aggressive buying.</p>'),
        ('What is cumulative delta?', '<p>The running total of bar deltas, usually reset each session.</p>'),
        ('Price makes a higher high while cumulative delta makes a lower high. What is that called?', '<p>A bearish delta divergence.</p>'),
    ]),
]

lessons = [
    ('Reading bid x ask', '<p>Learn what each side of a footprint row means and compute a bar\'s delta and volume.</p>'),
    ('Delta and what it measures', '<p>Understand delta as urgency, and the difference between true aggressor data and tick-rule approximations.</p>'),
    ('Diagonal and stacked imbalances', '<p>Calculate imbalances by hand at a chosen ratio and identify stacks.</p>'),
    ('Cumulative delta and divergence', '<p>Track CD through a session and mark divergences at your key levels.</p>'),
]

src = [
    ('Numbers Bars (footprint) and cumulative delta - Sierra Chart documentation', 'https://www.sierrachart.com/index.php?page=doc%2FNumbersBars.php'),
    ('Order Flow Volumetric Bars - NinjaTrader 8 Help Guide', 'https://ninjatrader.com/support/helpGuides/nt8/order_flow_volumetric_bars.htm'),
    ('Imbalances - ATAS knowledge base', 'https://learn.atas.net/volume-basics/volume-analysis/imbalances'),
    ('Volume Footprint charts: a complete guide - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000726164-volume-footprint-charts-a-complete-guide/'),
    ('Market by Order (MBO) FAQ - CME Group', 'https://cmegroup.com/articles/faqs/market-by-order-mbo.html'),
]

write_chapter('vp', 'VP-08', 'Footprint Charts & Delta', 'advanced', '40 min', lessons, body, src)
