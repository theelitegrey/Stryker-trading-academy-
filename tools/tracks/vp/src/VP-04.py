#!/usr/bin/env python3
"""VP-04 Profile Shapes & Day Types."""
import os, sys, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

P = [5200.0 + i for i in range(16)]


def bell(center, width, peak, n=16, base=0):
    return [int(round(base + peak * math.exp(-((i - center) / width) ** 2))) for i in range(n)]


# ---------------------------------------------------------------- five shapes, volumes built from simple functions
shapes = {
    'D': bell(7.5, 3.6, 900, base=20),
    'P': [max(20, v) for v in [int(round(40 + i * 8)) for i in range(8)]] + bell(3.2, 2.2, 1000, n=8, base=60),
    'b': bell(4.8, 2.2, 1000, n=8, base=60) + [int(round(100 - i * 10)) for i in range(8)],
    'thin': [150, 170, 160, 180, 175, 165, 185, 170, 160, 175, 180, 165, 170, 160, 175, 150],
    'double': [a + b for a, b in zip(bell(3.5, 1.8, 800), bell(11.5, 1.8, 700))],
}
figs_shape = {}
info_shape = {}
for k, v in shapes.items():
    s, (poc, lo, hi) = profile(P, v, '%s-shaped profile' % k if k not in ('thin', 'double') else ('Thin, elongated profile' if k == 'thin' else 'Double distribution'), dp=0, row_h=15)
    figs_shape[k] = s; info_shape[k] = (P[poc], P[lo], P[hi])

# check the shapes are what the text claims
mid = (P[0] + P[-1]) / 2
assert info_shape['P'][0] > mid and info_shape['b'][0] < mid
assert abs(info_shape['D'][0] - mid) <= 1
dv = shapes['double']; valley = min(range(4, 12), key=lambda i: dv[i])
assert dv[valley] < 0.15 * max(dv)

cap = {
    'D': 'Volume builds around the middle and thins toward both ends. POC %s, value %s to %s.' % tuple(fmt(x, 0) for x in info_shape['D']),
    'P': 'Volume is concentrated near the top with a long thin area below. POC %s sits in the upper half.' % fmt(info_shape['P'][0], 0),
    'b': 'The mirror image: heavy volume near the bottom with a thin area above. POC %s sits in the lower half.' % fmt(info_shape['b'][0], 0),
    'thin': 'Volume is spread thinly and evenly across a wide range, with no dominant node. POC %s is barely larger than its neighbours.' % fmt(info_shape['thin'][0], 0),
    'double': 'Two separate nodes with a low-volume valley at %s between them.' % fmt(P[valley], 0),
}
fig = {k: figure(figs_shape[k], cap[k]) for k in shapes}


# ---------------------------------------------------------------- day types as TPO profiles
def rng(lo, hi):
    return [p for p in P if lo <= p <= hi] if hi <= P[-1] else [5200.0 + i for i in range(int(lo - 5200), int(hi - 5200) + 1)]


PT = [5195.0 + i for i in range(26)]


def r(lo, hi):
    return [p for p in PT if lo <= p <= hi]


day_types = {
    'Normal day': [('A', r(5202, 5212)), ('B', r(5201, 5210)), ('C', r(5204, 5209)), ('D', r(5205, 5210)), ('E', r(5204, 5208)), ('F', r(5205, 5209)), ('G', r(5206, 5209))],
    'Normal variation day': [('A', r(5203, 5208)), ('B', r(5202, 5207)), ('C', r(5205, 5211)), ('D', r(5207, 5212)), ('E', r(5206, 5210)), ('F', r(5207, 5211)), ('G', r(5206, 5209))],
    'Trend day': [('A', r(5198, 5201)), ('B', r(5199, 5202)), ('C', r(5201, 5205)), ('D', r(5204, 5208)), ('E', r(5207, 5211)), ('F', r(5210, 5214)), ('G', r(5213, 5217))],
    'Neutral day': [('A', r(5203, 5207)), ('B', r(5202, 5206)), ('C', r(5199, 5204)), ('D', r(5201, 5205)), ('E', r(5203, 5207)), ('F', r(5205, 5210)), ('G', r(5205, 5208))],
    'Non-trend day': [('A', r(5203, 5206)), ('B', r(5202, 5205)), ('C', r(5203, 5205)), ('D', r(5202, 5204)), ('E', r(5203, 5206)), ('F', r(5203, 5205)), ('G', r(5202, 5205))],
}
dt_rows = []
dt_fig = {}
for name, per in day_types.items():
    lo = min(min(ps) for _, ps in per) - 1; hi = max(max(ps) for _, ps in per) + 1
    s, inf = tpo(per, r(lo, hi), name, dp=0, row_h=14, col_w=15)
    ib_lo, ib_hi = inf['ib']
    day_lo = min(min(ps) for _, ps in per); day_hi = max(max(ps) for _, ps in per)
    up = day_hi - ib_hi; dn = ib_lo - day_lo
    dt_fig[name] = (s, ib_lo, ib_hi, day_lo, day_hi, up, dn)
    ext = ('up %d' % up if up else '') + (' and ' if up and dn else '') + ('down %d' % dn if dn else '')
    dt_rows.append([name, '%d' % (ib_hi - ib_lo), ext or 'none', '%d' % (day_hi - day_lo)])

# assert the classifications match the definitions in the text
f = {k: v for k, v in dt_fig.items()}
assert f['Normal day'][5] == 0 and f['Normal day'][6] == 0
assert (f['Normal variation day'][5] > 0) != (f['Normal variation day'][6] > 0)
assert f['Trend day'][5] >= 2 * (f['Trend day'][2] - f['Trend day'][1])
assert f['Neutral day'][5] > 0 and f['Neutral day'][6] > 0
assert f['Non-trend day'][4] - f['Non-trend day'][3] <= 4

dt_table = table(['Day type', 'IB (pts)', 'Range extension', 'Day range (pts)'], dt_rows)


def dfig(name, caption):
    s, ib_lo, ib_hi, lo, hi, up, dn = dt_fig[name]
    return figure(s, caption % dict(ib_lo=fmt(ib_lo, 0), ib_hi=fmt(ib_hi, 0), lo=fmt(lo, 0), hi=fmt(hi, 0), up=up, dn=dn))


# ---------------------------------------------------------------- body
body = [
    '<p>Once you can build a profile, the next skill is recognising what kind of day produced it. Profiles come in a handful of recurring '
    '<strong>shapes</strong>, and Market Profile practitioners group whole sessions into <strong>day types</strong> based on the size of the '
    'initial balance and how far the day extended beyond it. Knowing the shape and the day type won\'t tell you what happens tomorrow. It tells '
    'you what kind of auction just happened, which is the context for everything you do next.</p>',
    '<p>This chapter uses both the volume profile from <a href="chapter.html?ch=VP-03">VP-03</a> and the TPO letters from '
    '<a href="chapter.html?ch=VP-02">VP-02</a>. The readings attached to each shape ("short covering", "long liquidation" and so on) are '
    '<strong>common interpretations</strong> in the profile literature, not facts about who traded.</p>',

    '<h3>The D shape: a balanced auction</h3>',
    '<p>A <strong>D-shaped</strong> profile is fattest in the middle and thins out toward the high and the low, like the bell curve that '
    'originally inspired Market Profile. Most of the day\'s trade happened in the centre, and both extremes saw little business. It is the '
    'picture of a <strong>balanced</strong> day in auction terms: buyers and sellers broadly agreed on value, and probes of the edges were '
    'rejected.</p>',
    fig['D'],
    '<p>Practitioners treat a D-shaped day as a signal that the market is waiting for new information. The next day\'s open relative to this '
    'value area (inside it or outside it) becomes the first clue about whether the balance continues.</p>',

    '<h3>The P and b shapes</h3>',
    '<p>A <strong>P-shaped</strong> profile has its bulk near the top and a long, thin stem below. Price started low, moved up quickly through the '
    'lower prices (leaving little volume there) and then spent the rest of the session trading near the high. A <strong>b-shaped</strong> '
    'profile is the mirror image: a quick move down through thin prices, then a heavy node near the low.</p>',
    fig['P'],
    fig['b'],
    '<p>The traditional reading of a P is <strong>short covering</strong>: sellers who were short buy back to close, which pushes price up quickly, '
    'and once they are done the market settles into balance near the high. The traditional reading of a b is <strong>long liquidation</strong>: '
    'holders of long positions sell out, price drops, and it settles near the low. The reason these readings matter is that covering and '
    'liquidation are one-off flows. Once they are finished, the push can fade. Treat them as hypotheses to test against the following session, '
    'not as conclusions.</p>',

    '<h3>Thin profiles and double distributions</h3>',
    '<p>A <strong>thin, elongated</strong> profile has volume spread evenly across a wide range with no clear bulge. Price never stayed '
    'anywhere long enough to build a node. That is the profile of a <strong>trend</strong>: the market kept moving to find the other side.</p>',
    fig['thin'],
    '<p>A <strong>double distribution</strong> has two separate nodes with a thin valley between them. The market balanced in one area, moved '
    'quickly to another, and balanced again. You saw the same pattern in <a href="chapter.html?ch=VP-01">VP-01</a> as "balance, imbalance, new '
    'balance". The low-volume valley between the two nodes is a price area traders mark, because the market passed through it without doing '
    'business there.</p>',
    fig['double'],

    '<h3>Day types from the initial balance</h3>',
    '<p>Day types classify the whole session by two things: how wide the initial balance (IB) was, and how far price extended beyond it. The '
    'standard set from the Market Profile literature is below. Each figure is an illustrative TPO profile built from period data; the gold bar '
    'on the left marks the IB.</p>',
    '<p><strong>Normal day.</strong> A wide IB contains the whole session. The opening hour found both sides quickly, and nobody pushed price '
    'outside it later.</p>',
    dfig('Normal day', 'IB %(ib_lo)s to %(ib_hi)s. The day never traded outside it: no range extension.'),
    '<p><strong>Normal variation day.</strong> A moderate IB with range extension on one side, usually by a similar distance to the IB '
    'itself. In plain terms: an opening range and one push out of it.</p>',
    dfig('Normal variation day', 'IB %(ib_lo)s to %(ib_hi)s. Range extension up %(up)d points to %(hi)s, none below.'),
    '<p><strong>Trend day.</strong> A narrow IB followed by persistent extension in one direction, each period trading mostly above (or below) '
    'the one before. The profile is thin and the close tends to be near the extreme. These are the days when fading every move back to value is '
    'most dangerous.</p>',
    dfig('Trend day', 'IB %(ib_lo)s to %(ib_hi)s. Price extended %(up)d points above it, one period after another, to %(hi)s.'),
    '<p><strong>Neutral day.</strong> Range extension on <em>both</em> sides of the IB. Practitioners split it into a <strong>neutral centre</strong> '
    'day, which closes back in the middle of the range, and a <strong>neutral extreme</strong> day, which closes near one end, read as one side '
    'winning late in the session.</p>',
    dfig('Neutral day', 'IB %(ib_lo)s to %(ib_hi)s. Extension down %(dn)d points, then up %(up)d points: both sides of the IB were tested.'),
    '<p><strong>Non-trend day.</strong> A very narrow IB and a very narrow day, with little extension. Nobody was willing to push price anywhere. '
    'These often come before scheduled news or on holiday-thin sessions.</p>',
    dfig('Non-trend day', 'The whole day spans only %(lo)s to %(hi)s. The market is waiting.'),
    dt_table,
    '<p>A <strong>double-distribution trend day</strong> is a common variation: the day balances in one area, breaks out, and builds a second '
    'balance, giving the double-distribution shape from earlier on a single session.</p>',

    '<h3>Worked example: classifying a session step by step</h3>',
    '<p>Use the trend-day profile above as the session to classify.</p>',
    '<ol>'
    '<li><strong>Measure the IB.</strong> Periods A and B traded from %s to %s, so the IB is %d points. Compare that with the last ten days in '
    'your IB log from VP-02. For this example, assume it is narrower than usual.</li>'
    '<li><strong>Check for range extension.</strong> Period C traded above the IB high. There was no extension below.</li>'
    '<li><strong>Check persistence.</strong> Each later period traded mostly above the previous one, and the final period printed the day\'s high at %s.</li>'
    '<li><strong>Look at the shape.</strong> No row has more than two letters. It is thin and elongated, with no dominant node.</li>'
    '<li><strong>Classify.</strong> Narrow IB, one-sided extension of %d points, persistent period-by-period progress, thin profile: a trend day up.</li>'
    '<li><strong>Record the implications for tomorrow.</strong> Mark the day\'s high and the single prints left in the middle of the range. '
    'Tomorrow\'s first question is whether the market accepts prices above the high or comes back into the thin area.</li>'
    '</ol>' % (fmt(dt_fig['Trend day'][1], 0), fmt(dt_fig['Trend day'][2], 0), dt_fig['Trend day'][2] - dt_fig['Trend day'][1],
               fmt(dt_fig['Trend day'][4], 0), dt_fig['Trend day'][5]),
    '<p>Day types are easiest to classify at the close, but profile traders form a working guess during the session. After the IB forms, you '
    'already know whether it is narrow or wide. The first range extension, and whether it holds, narrows the possibilities further. Treat the '
    'guess as provisional and update it as letters build. Timing matters too: the extensions that define a day often come during the '
    'killzones covered in the core course (<a href="chapter.html?ch=13">chapter 13</a>).</p>',


    '<h3>Using yesterday\'s shape today</h3>',
    '<p>The shape and day type are most useful as context for the <em>next</em> session. A few pairings come up often in the profile literature. '
    'Treat each as a question to ask, not an answer.</p>',
    cards(['Yesterday', 'Question for today', 'What would answer it'], [
        ['D shape / normal day', 'Does balance continue, or does the market break out?', 'Open inside value and rotate = balance; open outside and hold there = breakout'],
        ['P shape', 'Was the rally short covering that has now finished?', 'Price fails to build new value above the heavy node, or trades back into the thin stem'],
        ['b shape', 'Was the sell-off long liquidation that has now finished?', 'Price fails to build new value below the heavy node, or trades back into the thin area above'],
        ['Trend day', 'Does the trend continue, or does the market balance?', 'Acceptance beyond yesterday\'s extreme, or a return into yesterday\'s single prints'],
        ['Double distribution', 'Which of the two nodes is value now?', 'Where the market spends time and builds volume after the open'],
    ]),
    '<p>Notice that every answer is something you observe after the open: acceptance or rejection, time spent, volume built. That is the '
    'auction-theory habit from <a href="chapter.html?ch=VP-01">VP-01</a> applied to a new session. The profile gives you the question; the '
    'next session\'s trading gives you the answer.</p>',

    '<h3>Common mistakes</h3>',
    '<ul>'
    '<li><strong>Deciding the day type too early.</strong> A day that looks like a trend day at 11:00 can become a neutral day by the close.</li>'
    '<li><strong>Reading P and b as certain facts about who traded.</strong> "Short covering" is an interpretation of the shape, not '
    'information about positions.</li>'
    '<li><strong>Ignoring context.</strong> A D-shaped day in the middle of a larger uptrend means something different from a D-shaped day '
    'at a multi-day high. Check the higher timeframe (<a href="chapter.html?ch=04">chapter 04</a>).</li>'
    '<li><strong>Forcing every day into a box.</strong> Some sessions don\'t fit neatly. Record them as "unclear" rather than bending the definition.</li>'
    '<li><strong>Fading trend days.</strong> The standard error on a trend day is to keep selling "expensive" prices. On a trend day, the '
    'market is still searching for the other side.</li>'
    '</ul>',

    callout('Key takeaways', '<ul>'
            '<li>D = balanced; P and b = one-sided move then balance near the extreme; thin = trend; double distribution = two balances.</li>'
            '<li>Day types are defined by IB width and range extension: normal, normal variation, trend, neutral (centre or extreme), non-trend.</li>'
            '<li>The readings attached to shapes are interpretations. Test them against what happens next.</li>'
            '<li>Classify during the day provisionally, then confirm at the close.</li>'
            '</ul>'),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Label the shape (D, P, b, thin, double) of each of the last twenty ES session profiles.</li>'
    '<li>Using your IB log from VP-02, classify the same twenty sessions by day type. Note any that don\'t fit.</li>'
    '<li>For every P and b day, write down what the next session did relative to the node near the extreme.</li>'
    '<li>During one live session, write your provisional day type at 10:30, 12:00 and 14:00 New York time, then compare with the final result.</li>'
    '</ol>',

    quiz([
        ('What does a D-shaped profile suggest about the auction?',
         '<p>Balance: most trade happened in the middle, and both extremes were rejected quickly.</p>'),
        ('What is the traditional reading of a P-shaped profile?',
         '<p>Short covering: a quick move up through thin prices followed by balance near the high. It is an interpretation, not a fact about positions.</p>'),
        ('How does a normal day differ from a normal variation day?',
         '<p>On a normal day the wide IB contains the whole session. On a normal variation day price extends beyond the IB on one side.</p>'),
        ('What makes a day "neutral"?',
         '<p>Range extension on both sides of the IB. Where it closes decides neutral centre or neutral extreme.</p>'),
        ('Why is fading moves particularly risky on a trend day?',
         '<p>Because the market keeps moving to find the other side, and prices that look expensive relative to earlier value keep getting accepted.</p>'),
    ]),
]

lessons = [
    ('Recognising profile shapes',
     '<p>Go through the last twenty session profiles on ES and label each D, P, b, thin or double. Keep the list next to your IB log.</p>'),
    ('P and b days',
     '<p>For every P or b day in your list, write what happened next session at the heavy node near the extreme: accepted, rejected or ignored. '
     'This is your own evidence on how much the traditional reading is worth on your instrument.</p>'),
    ('Day types from the IB',
     '<p>Classify the same twenty days as normal, normal variation, trend, neutral centre, neutral extreme or non-trend. Record the IB size and '
     'extension in points for each.</p>'),
    ('Classifying during the session',
     '<p>On three live sessions, write a provisional day type after the IB, at midday and near the close. Compare how often your early guess survived.</p>'),
]

src = [
    ('Market profile (day types: neutral, non-trend, trend; initial balance) - Wikipedia', 'https://en.wikipedia.org/wiki/Market_profile'),
    ('TPO (Time Price Opportunity) Profile Charts: initial balance and extension settings - Sierra Chart', 'https://www.sierrachart.com/index.php?page=doc/StudiesReference/TimePriceOpportunityCharts.html'),
    ('Time price opportunity charts explained - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000725590-time-price-opportunity-tpo-chart/'),
    ('Volume profile indicators: basic concepts - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/'),
    ('Mind Over Markets, Updated Edition (Dalton, Jones, Dalton; Wiley 2013) - further reading on day types', 'https://oreilly.com/library/view/mind-over-markets/9781118659762/f02.html'),
]

write_chapter('vp', 'VP-04', 'Profile Shapes & Day Types', 'intermediate', '35 min', lessons, body, src)
