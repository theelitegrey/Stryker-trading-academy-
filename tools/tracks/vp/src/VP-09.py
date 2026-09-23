#!/usr/bin/env python3
"""VP-09 Order Flow Patterns: Absorption, Exhaustion, Imbalances & Icebergs."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

T = 0.25


def mk(high, pairs, o, c):
    rows = {round(high - k * T, 2): pr for k, pr in enumerate(pairs)}
    assert o in rows and c in rows
    return {'o': o, 'c': c, 'rows': rows}


# ---------------------------------------------------------------- absorption at a low
a1 = mk(5190.00, [(12, 14), (31, 18), (58, 22), (64, 19)], o=5189.75, c=5189.25)
a2 = mk(5190.00, [(18, 20), (96, 25), (142, 31), (171, 28)], o=5189.25, c=5189.25)
a3 = mk(5190.25, [(9, 34), (14, 41), (22, 38), (38, 27), (41, 30)], o=5189.25, c=5190.25)
low_a = min(min(b['rows']) for b in (a1, a2, a3))
bid_at_low = sum(b['rows'].get(low_a, (0, 0))[0] for b in (a1, a2, a3))
d_abs = [delta_rows(b['rows'])[0] for b in (a1, a2, a3)]
assert all(min(b['rows']) == low_a for b in (a1, a2, a3))           # nobody trades below the low
assert d_abs[0] < 0 and d_abs[1] < 0 and d_abs[2] > 0
assert a2['rows'][low_a][0] == max(r[0] for b in (a1, a2, a3) for r in b['rows'].values())
fig_abs = figure(footprint([a1, a2, a3], 'Absorption at a low', T, ratio=3.0),
                 'Bars 1 and 2 show heavy selling at the bid (delta %+d and %+d), with %d contracts hitting the bid at %s across the three bars. '
                 'Yet no bar trades below %s. Someone was buying all of it with limit orders. Bar 3 turns up.'
                 % (d_abs[0], d_abs[1], bid_at_low, fmt(low_a), fmt(low_a)))

# ---------------------------------------------------------------- exhaustion at a high
e1 = mk(5214.00, [(3, 2), (9, 7), (24, 41), (31, 56), (27, 49), (22, 38)], o=5212.75, c=5213.25)
e_top = max(e1['rows']); e_top_ask = e1['rows'][e_top][1]
asks_from_top = [e1['rows'][p][1] for p in sorted(e1['rows'], reverse=True)]
assert asks_from_top[0] < asks_from_top[1] < asks_from_top[2]       # buying dries up toward the high
fig_exh = figure(footprint([e1], 'Exhaustion at a high', T, show_imb=False),
                 'Buying at the ask fades as price rises: %s at the top two prices, against 41 to 56 lower down. Price reached %s on '
                 'only %d contracts bought. The move ran out of aggressive buyers.' % (' and '.join(str(x) for x in asks_from_top[:2]), fmt(e_top), e_top_ask))

# ---------------------------------------------------------------- iceberg: displayed 10, refilled
display = 10
prints = [('10:02:01', 10), ('10:02:01', 10), ('10:02:04', 10), ('10:02:07', 7), ('10:02:07', 10), ('10:02:11', 10), ('10:02:15', 10), ('10:02:20', 6)]
ice_total = sum(q for _, q in prints)
ice_rows = []; shown = []
for t, q in prints:
    ice_rows.append([t, fmt(5205.00), str(q), 'refilled to %d' % display])
ice_rows[-1][3] = 'price moves on'
ice_table = table(['Time', 'Price', 'Traded at ask', 'Displayed ask after'], ice_rows)
assert ice_total > 5 * display


def ice_fig():
    o = []; h = 176
    Y = lambda k: 26 + k * 18
    o.append(text(12, 16, 'Displayed at 5,205.00 vs traded there', 13, MUTED))
    bw = 44
    for k, (t, q) in enumerate(prints):
        x = 16 + k * bw
        o.append(rect(x, 130 - display * 9, bw - 8, display * 9, stroke=RED, rx=2))
        o.append(rect(x, 130 - q * 9, bw - 8, q * 9, fill=RED, opacity=0.45, rx=2))
        o.append(text(x + (bw - 8) / 2, 148, str(q), 13, INK, 'middle'))
    o.append(text(12, 170, 'outline = %d shown each time  |  total traded %d' % (display, ice_total), 13, GOLD))
    return svg(h, o, 'An iceberg order refilling')


fig_ice = figure(ice_fig(), 'The DOM never shows more than %d contracts offered at 5,205.00, yet %d trade there before price moves. '
                 'The hidden part of the order kept refilling the displayed quantity.' % (display, ice_total))

# ---------------------------------------------------------------- trapped buyers on a breakout (candles)
ohlc = [(5210.00, 5211.50, 5209.50, 5211.00), (5211.00, 5212.00, 5210.25, 5211.75), (5211.75, 5212.00, 5210.75, 5211.25),
        (5211.25, 5212.00, 5210.50, 5211.75), (5211.75, 5213.50, 5211.50, 5212.00), (5212.00, 5212.25, 5210.00, 5210.25),
        (5210.25, 5210.75, 5208.75, 5209.00)]
prior_high = 5212.00
brk = 4
assert all(b[1] <= prior_high for b in ohlc[:brk]) and ohlc[brk][1] > prior_high and ohlc[brk + 1][3] < prior_high
tr_svg, _ = candles(ohlc, 'Buyers trapped above a breakout', height=240,
                    levels=[(prior_high, 'highs', GOLD, '5 4')],
                    labels=[(brk, ohlc[brk][1], 'heavy ask vol', RED_SOFT, 'above')])
fig_trap = figure(tr_svg, 'Price breaks the equal highs at %s on bar %d with heavy buying at the ask above them, then closes back below on '
                  'bar %d. Traders who bought the breakout are now losing, and their stop-loss sells can add to the move down.'
                  % (fmt(prior_high), brk + 1, brk + 2))

body = [
    '<p>With the footprint and delta from <a href="chapter.html?ch=VP-08">VP-08</a>, you can start naming the recurring situations order-flow '
    'traders look for. This chapter covers five: <strong>absorption</strong>, <strong>exhaustion</strong>, <strong>stacked imbalances</strong>, '
    '<strong>iceberg orders</strong> and <strong>trapped traders</strong>. Each is a way of describing how aggressive and passive orders met at an '
    'important price.</p>',
    '<p>These are <strong>practitioner patterns</strong>. Platform documentation describes them and many traders use them, but there is no '
    'published evidence that any of them predicts price reliably on its own. They are most useful as confirmation at levels you have already '
    'chosen from the profile and liquidity work, not as signals anywhere on the chart.</p>',

    '<h3>Absorption</h3>',
    '<p><strong>Absorption</strong> is heavy aggressive trading on one side that fails to move price. Sellers keep hitting the bid, the footprint '
    'shows big numbers on the bid side, delta is strongly negative, and yet price doesn\'t go lower. The explanation is simple mechanics '
    'from <a href="chapter.html?ch=VP-07">VP-07</a>: someone has large passive buy orders there, and every market sell is filled against them '
    'without emptying the level.</p>',
    fig_abs,
    '<p>Read it in steps. Bar 1 sells off to %s. Bar 2 sees even more selling at the same low, with the largest bid numbers on the chart, and still '
    'no new low. Bar 3 opens there and turns up with positive delta. The heavy negative delta was not weakness that carried through; it was selling '
    'that met a buyer. Many traders then treat the absorption price as a level where that buyer may defend again.</p>' % fmt(low_a),
    '<p>The trap is calling absorption too early. Heavy selling at a low that <em>does</em> eventually push through is just a strong sell-off. '
    'Absorption only becomes clear once price stops making progress despite the aggression, and ideally once the other side shows up.</p>',

    '<h3>Exhaustion</h3>',
    '<p><strong>Exhaustion</strong> is the opposite story: the aggressive side simply runs out. As price pushes higher, the ask volume at each new '
    'price gets smaller, until the high prints on a handful of contracts. Nobody is chasing any more.</p>',
    fig_exh,
    '<p>Footprint platforms sometimes describe a high with very little volume as a <strong>finished</strong> auction, because the buying petered '
    'out. Compare this with the "unfinished" poor high in <a href="chapter.html?ch=VP-02">VP-02</a>, where several periods stall at the same price. '
    'TradingView\'s footprint guide describes a related idea, the <strong>failed auction</strong>: price probes a new extreme and is rejected. '
    'In practice exhaustion and absorption often appear together at a turning point: buyers thin out, and a passive seller takes what is left.</p>',

    '<h3>Stacked imbalances as zones</h3>',
    '<p>In VP-08 you learned to read a <strong>stacked imbalance</strong>: three or more consecutive diagonal imbalances on the same side. As a '
    'pattern, practitioners use it in two ways.</p>',
    '<ul>'
    '<li><strong>Continuation.</strong> A stack of buy imbalances inside a bar that breaks out of a range suggests initiative buying '
    '(<a href="chapter.html?ch=VP-01">VP-01</a>). If price pulls back into the stack and holds, the aggressive buyers are defending it.</li>'
    '<li><strong>Failure.</strong> If price comes back through the stack and closes beyond it, those aggressive buyers are now underwater. That '
    'turns the stack into a trapped-trader zone (below).</li>'
    '</ul>',
    '<p>NinjaTrader\'s Volumetric Bars documentation notes that clusters of imbalances can form support and resistance areas, and ATAS lets you '
    'set separate ratios for ordinary and strong imbalances (200% and 400% by default). Keep your ratio fixed per instrument so your stacks are '
    'comparable over time.</p>',

    '<h3>Iceberg orders</h3>',
    '<p>An <strong>iceberg</strong> is a large limit order that shows only part of its size. CME Globex supports this natively as a <strong>display '
    'quantity</strong>: the order shows a set quantity, and each time that quantity is filled it is replenished, until the whole order is done. '
    'Iceberg orders exist so that large traders don\'t reveal their full size.</p>',
    fig_ice,
    ice_table,
    '<p>The tell is <strong>more volume traded at a price than was ever displayed there</strong>. You can sometimes see it by comparing the tape with '
    'the DOM. Doing it reliably needs order-level data: Bookmap\'s documentation says its iceberg detection works only from CME\'s market-by-order '
    '(MBO) feed, and notes that CME does not allow native icebergs on certain instruments. Platform iceberg markers are estimates. Some hidden '
    'size comes from traders re-entering orders by hand or through their own software, which looks the same on the tape.</p>',
    '<p>An iceberg on the ask at a high is another form of absorption: a hidden seller absorbing buyers. It has the same weakness too. Icebergs can '
    'be cancelled at any time, and a big order that is still there now can be gone a second later.</p>',

    '<h3>Trapped traders</h3>',
    '<p><strong>Trapped traders</strong> are traders who entered aggressively at a price that then quickly went against them. The classic case is a '
    'breakout: price pushes above obvious highs, buyers pile in at the ask, and then price falls back below the level.</p>',
    fig_trap,
    '<p>Those buyers now hold losing positions, with stop-losses usually just below the breakout area. If price keeps falling, their stops turn into '
    'market sells, which adds fuel to the move down. On the footprint the tell is heavy ask volume or buy imbalances right at the top of the '
    'breakout bar, followed by a close back inside the range.</p>',
    '<p>This is the order-flow view of the liquidity sweep from the core course (<a href="chapter.html?ch=12">chapter 12</a>). The chart shows price '
    'running the highs and reversing; the footprint shows who got caught doing it. <a href="chapter.html?ch=VP-11">VP-11</a> puts the two together '
    'step by step.</p>',

    '<h3>Telling the patterns apart</h3>',
    '<p>The five patterns overlap, and it is easy to see all of them everywhere once you know the names. This comparison helps keep them '
    'separate. Each one answers a slightly different question about the same moment.</p>',
    cards(['Pattern', 'What you see', 'What it means in auction terms', 'What would cancel it'], [
        ['Absorption', 'Heavy aggressive volume on one side, price not progressing.', 'A passive participant is taking the other side at that price.', 'Price trades through the level and holds beyond it.'],
        ['Exhaustion', 'Aggressive volume shrinking toward the extreme.', 'The side pushing price has run out of urgency.', 'A new burst of aggression at a higher (or lower) price.'],
        ['Stacked imbalance', 'Three or more consecutive diagonal imbalances.', 'One side was aggressive across several prices in a row.', 'Price returns through the stack and closes beyond it.'],
        ['Iceberg', 'More traded at a price than was displayed.', 'Hidden passive size at that price.', 'The displayed size stops refilling and price moves through.'],
        ['Trapped traders', 'Heavy aggression at a breakout, then a close back inside.', 'Aggressive traders are now holding losing positions.', 'Price recovers back above the breakout level.'],
    ]),
    '<p>Notice the last column. Every pattern has a clear condition that proves it wrong, and that condition is usually a sensible place to think '
    'about risk. It is the same idea as invalidation in your playbook (<a href="chapter.html?ch=35">chapter 35</a>): know in advance what '
    'price would have to do to show that your reading was wrong.</p>',
    '<h3>Speed, context and the time of day</h3>',
    '<p>Order-flow patterns look different at different times. Around the cash open and major scheduled news, volumes are high and the book can '
    'be thin, so numbers that look like absorption at 11:30 are ordinary at 9:31. In the quiet middle of the session, a modest burst of aggression '
    'can stand out. Before you call a number "heavy", compare it with the same time of day on previous sessions. Many traders note a typical '
    'volume per bar for each half hour of the session so they have a baseline.</p>',
    '<h3>Worked example: one reversal, all five lenses</h3>',
    '<p>Imagine ES rallies into yesterday\'s VAH, which also lines up with a set of equal highs. What would each pattern look like if the level '
    'is going to hold?</p>',
    '<ol>'
    '<li><strong>Exhaustion:</strong> ask volume shrinks on each new tick into the level.</li>'
    '<li><strong>Absorption:</strong> a burst of buying at the ask right at the equal highs, positive delta, but price stops advancing.</li>'
    '<li><strong>Iceberg:</strong> more contracts trade at one offer than the DOM ever showed there.</li>'
    '<li><strong>Trapped buyers:</strong> price pokes one or two ticks through the highs, then the bar closes back below them.</li>'
    '<li><strong>Imbalances flip:</strong> the next bars show sell imbalances stacking on the way down.</li>'
    '</ol>',
    '<p>You rarely get all five. Two or three at a level you already marked is the sort of confluence order-flow traders look for. None of them '
    'at the level is also information: the move may simply be accepted and continue.</p>',

    '<h3>Common mistakes</h3>',
    '<ul>'
    '<li><strong>Calling absorption while price is still moving.</strong> It is only absorption once progress stops.</li>'
    '<li><strong>Trusting iceberg markers as fact.</strong> They are estimates, and they need MBO data.</li>'
    '<li><strong>Trading patterns away from levels.</strong> Absorption in the middle of nowhere means little.</li>'
    '<li><strong>Treating every failed breakout as a trap.</strong> Check whether aggressive traders were actually caught at the top.</li>'
    '<li><strong>Ignoring the day type.</strong> On a trend day, apparent exhaustion often gets run over.</li>'
    '</ul>',

    callout('Key takeaways', '<ul>'
            '<li>Absorption: heavy aggression, no progress, because a passive order is taking the other side.</li>'
            '<li>Exhaustion: aggressive volume dries up into the extreme.</li>'
            '<li>Stacked imbalances mark one-sided zones that can hold on a retest or become traps if they fail.</li>'
            '<li>Icebergs show as more traded at a price than was displayed; detection needs order-level data.</li>'
            '<li>Trapped traders are the order-flow side of a liquidity sweep.</li>'
            '</ul>'),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Find three examples of absorption at prior-session VAH or VAL on ES. Record the bid or ask volume at the level and what happened next.</li>'
    '<li>Find three highs that printed on fewer than 10 contracts at the ask. Note how often price returned to them within the session.</li>'
    '<li>Watch the tape and the DOM together at a key level for 15 minutes in a simulator. Log any price where more traded than was displayed.</li>'
    '<li>Find two failed breakouts of equal highs and check the footprint of the breakout bar for heavy buying at the top.</li>'
    '</ol>',

    quiz([
        ('Delta is strongly negative, but price does not make a new low. What pattern is that?', '<p>Absorption: passive buyers are taking all the aggressive selling.</p>'),
        ('What does exhaustion look like on a footprint?', '<p>Aggressive volume shrinking at each new price toward the extreme.</p>'),
        ('How does CME implement an iceberg?', '<p>With a display quantity that is replenished each time it fills, until the whole order is done.</p>'),
        ('Why are platform iceberg markers only estimates?', '<p>They infer hidden size from trades versus displayed size, need MBO data, and hand-refilled orders look the same.</p>'),
        ('How do trapped traders add to a move?', '<p>Their stop-loss orders become market orders in the opposite direction.</p>'),
    ]),
]

lessons = [
    ('Absorption', '<p>Identify heavy aggression that fails to move price, and wait for the other side before acting on it.</p>'),
    ('Exhaustion and finished auctions', '<p>Spot aggressive volume drying up into a high or low and compare it with poor highs and lows.</p>'),
    ('Stacked imbalances as zones', '<p>Mark stacks and track whether they hold as support or resistance, or fail and trap traders.</p>'),
    ('Icebergs', '<p>Understand display quantity on CME and how hidden size shows up on the tape.</p>'),
    ('Trapped traders', '<p>Read failed breakouts through the footprint and link them to liquidity sweeps.</p>'),
]

src = [
    ('Order Qualifiers (display quantity) - CME Group Client Systems Wiki', 'https://cmegroupclientsite.atlassian.net/wiki/spaces/EPICSANDBOX/pages/457218264/Order+Qualifiers'),
    ('Stops and Icebergs On-Chart indicator - Bookmap knowledge base', 'https://bookmap.com/knowledgebase/docs/Addons-Stops-And-Icebergs-On-Chart-Indicator'),
    ('Market by Order (MBO) FAQ - CME Group', 'https://cmegroup.com/articles/faqs/market-by-order-mbo.html'),
    ('Imbalances - ATAS knowledge base', 'https://learn.atas.net/volume-basics/volume-analysis/imbalances'),
    ('Order Flow Volumetric Bars - NinjaTrader 8 Help Guide', 'https://ninjatrader.com/support/helpGuides/nt8/order_flow_volumetric_bars.htm'),
    ('Volume Footprint charts: a complete guide (failed auction, delta divergence) - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000726164-volume-footprint-charts-a-complete-guide/'),
]

write_chapter('vp', 'VP-09', 'Order Flow Patterns: Absorption, Exhaustion, Imbalances & Icebergs', 'advanced', '40 min', lessons, body, src)
