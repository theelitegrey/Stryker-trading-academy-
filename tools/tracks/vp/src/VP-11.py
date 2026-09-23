#!/usr/bin/env python3
"""VP-11 Combining Profile & Order Flow with Liquidity & SMC."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

T = 0.25

# ---------------------------------------------------------------- FVG vs LVN vs single prints: one displacement leg
# illustrative 5-minute bars; bar 3-5 are the displacement
leg = [(5200.00, 5201.25, 5199.50, 5200.75), (5200.75, 5201.50, 5200.00, 5201.00), (5201.00, 5201.75, 5200.50, 5201.50),
       (5201.50, 5206.75, 5201.25, 5206.50), (5206.50, 5208.00, 5205.25, 5207.75), (5207.75, 5208.50, 5207.00, 5208.00),
       (5208.00, 5208.75, 5207.25, 5207.50)]
c1, c2, c3 = 2, 3, 4                       # three-candle FVG: candle 1 = bar 3, candle 3 = bar 5 (0-based 2 and 4)
fvg_lo = leg[c1][1]; fvg_hi = leg[c3][2]   # bullish FVG = candle 1 HIGH to candle 3 LOW
assert fvg_hi > fvg_lo, (fvg_lo, fvg_hi)
assert leg[c2][3] > leg[c2][0] and leg[c2][1] - leg[c2][2] > 3 * (leg[0][1] - leg[0][2])   # displacement candle
fvg_svg, (X, Y) = candles(leg, 'Displacement leg with a fair value gap', height=250,
                          zones=[(fvg_lo, fvg_hi, 'FVG', GREEN)],
                          labels=[(c1, leg[c1][1], 'c1 high', MUTED, 'above'), (c3, leg[c3][2], 'c3 low', MUTED, 'below')])
fig_fvg = figure(fvg_svg, 'The fair value gap runs from candle 1\'s high (%s) to candle 3\'s low (%s). Candle 2 is the displacement.'
                 % (fmt(fvg_lo), fmt(fvg_hi)))

# volume profile of the same leg: build a volume per 0.25 from the bars (volume spread evenly over each bar's range)
bar_vol = [1800, 1600, 1500, 2600, 2200, 1900, 1700]
prices = [round(5199.50 + k * T, 2) for k in range(int((5208.75 - 5199.50) / T) + 1)]
vol = {p: 0.0 for p in prices}
for (o_, h, l, c), v in zip(leg, bar_vol):
    lvls = [p for p in prices if l - 1e-9 <= p <= h + 1e-9]
    for p in lvls:
        vol[p] += v / len(lvls)
# group into 0.50-point rows so the profile stays readable on a phone
prices2 = [round(5199.50 + k * 0.5, 2) for k in range(int((5208.75 - 5199.50) / 0.5) + 1)]
vol2 = {q: sum(vol[p] for p in prices if q <= p < q + 0.5 - 1e-9) for q in prices2}
prices, vol = prices2, vol2
vols = [int(round(vol[p])) for p in prices]
inside = [vol[p] for p in prices if fvg_lo + 0.5 <= p and p + 0.5 <= fvg_hi]
outside = [vol[p] for p in prices if p < 5201.5 or p > 5205.5]
_mo = sorted(outside)[len(outside) // 2]
assert max(inside) < 0.5 * _mo, (max(inside), _mo)   # the gap rows are under half the typical row outside it
prof_svg, (poc, lo, hi) = profile(prices, vols, 'Volume profile of the same leg', dp=2, row_h=14)
fig_prof = figure(prof_svg, 'Built from the same bars in half-point rows (each bar\'s volume spread evenly across its range, a simplification). The thinnest '
                  'rows sit between %s and %s: the LVN lines up with the fair value gap.' % (fmt(fvg_lo), fmt(fvg_hi)))

# ---------------------------------------------------------------- sweep into an LVN then reversal
sw = [(5230.00, 5231.00, 5229.25, 5230.50), (5230.50, 5231.25, 5229.75, 5230.00), (5230.00, 5230.75, 5229.25, 5229.75),
      (5229.75, 5230.25, 5229.25, 5229.50), (5229.50, 5229.75, 5226.25, 5229.75), (5229.75, 5231.75, 5229.50, 5231.50),
      (5231.50, 5233.25, 5231.25, 5233.00)]
eq_low = 5229.25
sweep_i = 4
lvn_lo, lvn_hi = 5226.00, 5227.50
assert sum(1 for b in sw[:sweep_i] if abs(b[2] - eq_low) < 1e-9) >= 2          # equal lows
assert sw[sweep_i][2] < eq_low and sw[sweep_i][3] > eq_low                      # wick through, close back above
assert lvn_lo <= sw[sweep_i][2] <= lvn_hi                                       # the wick reaches into the LVN
assert sw[sweep_i + 1][3] > sw[0][1]                                            # reversal with conviction
sw_svg, _ = candles(sw, 'A sweep of equal lows into a low-volume node', height=250,
                    zones=[(lvn_lo, lvn_hi, 'prior LVN', TEAL)], levels=[(eq_low, 'lows', GOLD, '5 4')],
                    labels=[(sweep_i, sw[sweep_i][2], 'sweep', GOLD, 'below')])
fig_sw = figure(sw_svg, 'Equal lows at %s (liquidity). Bar %d wicks down to %s, inside a low-volume node from a prior profile, and closes '
                'back above the lows. The next bar reverses up through the range.' % (fmt(eq_low), sweep_i + 1, fmt(sw[sweep_i][2])))

# ---------------------------------------------------------------- footprint of the sweep bar
sb = {'o': 5229.50, 'c': 5229.75, 'rows': {5229.75: (14, 11), 5229.50: (38, 22), 5229.25: (61, 35), 5229.00: (88, 40),
                                             5228.75: (72, 38), 5228.50: (54, 33), 5228.25: (47, 30), 5228.00: (41, 29),
                                             5227.75: (33, 24), 5227.50: (29, 26), 5227.25: (22, 31), 5227.00: (19, 35),
                                             5226.75: (16, 38), 5226.50: (12, 34), 5226.25: (9, 21)}}
# a real footprint must cover the bar's full range
assert max(sb['rows']) == sw[sweep_i][1]
assert min(sb['rows']) == sw[sweep_i][2]
sell_below = sum(b for p, (b, a) in sb['rows'].items() if p < eq_low)
low_rows = sorted(sb['rows'])[:5]
ask_dominant_low = all(sb['rows'][p][1] > sb['rows'][p][0] for p in low_rows)
assert ask_dominant_low
d_sb, t_sb = delta_rows(sb['rows'])
fp_rows = [[fmt(p), '%d x %d' % sb['rows'][p]] for p in sorted(sb['rows'], reverse=True)]
fp_cards = table(['Price', 'Bid x ask'], fp_rows)

# ---------------------------------------------------------------- checklist table: which tool answers which question
qmap = cards(['Question', 'SMC / liquidity tool (core course)', 'Profile / order-flow tool (this track)'], [
    ['Where is the liquidity?', 'Equal highs and lows, old swing points (ch 07).', 'Poor highs and lows, naked POCs (VP-02, VP-05).'],
    ['Where did price move fast?', 'Fair value gaps (ch 10).', 'LVNs and single prints (VP-02, VP-03).'],
    ['Where did it do business?', 'Order blocks: the last opposite candle before displacement (ch 09).', 'HVNs, POC and value area (VP-03).'],
    ['Cheap or expensive?', 'Premium and discount of a range (ch 11).', 'Above or below value; VWAP and bands (VP-01, VP-06).'],
    ['Was the sweep real?', 'Wick through, close back, sharp reversal (ch 12).', 'Absorption or trapped traders on the footprint (VP-09).'],
])

body = [
    '<p>The core course teaches you to read the chart through <strong>liquidity</strong>, <strong>structure</strong> and <strong>imbalance</strong>: '
    'where the stops are, where price displaced, where it may come back to. This track has taught you to read <strong>volume</strong> and '
    '<strong>order flow</strong>: where business was done, and how. This chapter puts the two side by side. They were developed by different '
    'communities and use different words, but at key prices they often describe the same thing from two angles.</p>',
    '<p>The aim is not to add more lines to your chart. It is to use one method to check the other. When a liquidity level and a profile level '
    'agree, you have a clearer reason to care about that price. When they disagree, you have learned something too.</p>',
    qmap,

    '<h3>Fair value gaps, LVNs and single prints</h3>',
    '<p>A <strong>fair value gap</strong> is a three-candle pattern: the wick of candle 1 and the wick of candle 3 don\'t overlap, and the gap between '
    'them is the FVG (<a href="chapter.html?ch=10">chapter 10</a>). A <strong>low-volume node</strong> is a price range where little volume traded '
    '(<a href="chapter.html?ch=VP-03">VP-03</a>). <strong>Single prints</strong> are TPO rows with only one letter (<a href="chapter.html?ch=VP-02">VP-02</a>). '
    'All three are measures of the same event: price moving quickly through a range without two-sided trade.</p>',
    fig_fvg,
    fig_prof,
    '<p>Here the FVG runs from %s to %s, and the thinnest part of the profile sits in the same place. That overlap is common but not guaranteed. '
    'An FVG is measured on one timeframe\'s candles, while the profile counts every contract, so a gap on a 5-minute chart can contain a surprising '
    'amount of volume if it formed across a busy minute. When the FVG and the LVN coincide, both methods are telling you price has not traded '
    'there much. When they don\'t, the profile is the more direct measurement of how much trade actually happened.</p>' % (fmt(fvg_lo), fmt(fvg_hi)),
    '<p>The core course says price often returns to FVGs, and gives the common explanation that orders were left unfilled there. Profile traders '
    'describe LVNs in a similar but more cautious way: the market moved through them without accepting them, so on a return it tends either to '
    'move through quickly again or to reject them. Neither description means price must come back.</p>',

    '<h3>Order blocks, HVNs and the POC</h3>',
    '<p>In the core course an <strong>order block</strong> is the last opposite-colour candle before a displacement: for a bullish order block, the '
    'last down candle before the move up (<a href="chapter.html?ch=09">chapter 09</a>). Profile traders would ask a different question about the '
    'same place: how much volume traded there? If the order block sits on a high-volume node or a POC, the market did real business at that price '
    'before it left. If it sits in thin volume, the "block" was a brief pause. That is a useful filter when you have several candidate order '
    'blocks and need to choose one.</p>',

    '<h3>Premium, discount and value</h3>',
    '<p><strong>Premium and discount</strong> split a swing range at its 50%% midpoint (<a href="chapter.html?ch=11">chapter 11</a>). The '
    '<strong>value area</strong> is where 70%% of the volume traded. They measure different things. Premium and discount are geometry: halves of a price '
    'range. Value is measured participation. On a P-shaped day, for example, most of the value sits in the upper, "premium" half of the range. '
    'Profile traders would read buying there as buying at value, not buying expensive. When the two methods disagree like this, it is worth asking '
    'which question you are really trying to answer.</p>',

    '<h3>Liquidity sweeps, LVNs and the footprint</h3>',
    '<p>A <strong>liquidity sweep</strong> in the core course has three parts: price trades through a known level, closes back on the original side, '
    'and reverses with conviction (<a href="chapter.html?ch=12">chapter 12</a>). The profile and the footprint each add a check.</p>',
    fig_sw,
    '<p><strong>Profile check.</strong> The wick reached into a low-volume node from an earlier profile. Price moving quickly into an LVN and being '
    'rejected is the auction version of "no acceptance". If the wick had instead reached a high-volume node and started building volume there, '
    'that would suggest the market was accepting the lower prices, which argues against a sweep.</p>',
    '<p><strong>Footprint check.</strong> Here is the sweep bar, row by row:</p>',
    fp_cards,
    '<p>The bar\'s total delta is %+d: sellers were the aggressors overall, and %d contracts were sold at the bid below the lows. That is the stop-loss '
    'selling and breakout selling the sweep was expected to trigger. But look at the bottom five rows: at every one of them, more traded at the ask '
    'than at the bid. Aggressive buyers appeared at the lows of the wick, and price closed back above the level. The sellers who sold the '
    'break are now trapped (<a href="chapter.html?ch=VP-09">VP-09</a>).</p>' % (d_sb, sell_below),
    '<p>Put together: a liquidity level (equal lows), a profile level (the LVN), and a footprint pattern (selling absorbed, buyers at the lows, trapped '
    'sellers) all pointing the same way. That is what "confluence" means in practice: independent methods agreeing, not the same method drawn twice.</p>',

    '<h3>When the two methods disagree</h3>',
    '<p>Disagreement is not a problem to be explained away. It is information. Three situations come up often.</p>',
    '<ul>'
    '<li><strong>A sweep into a high-volume node.</strong> Price runs the lows, but the wick lands in a busy area of the profile and starts building '
    'more volume. The market is doing business at the lower prices, which is acceptance. Many profile traders would expect the move to continue '
    'rather than reverse.</li>'
    '<li><strong>An FVG with plenty of volume inside it.</strong> The candle chart shows a gap, but the profile shows real two-sided trade there. The '
    '"imbalance" was a matter of how the candles happened to be drawn, and the level deserves less weight.</li>'
    '<li><strong>An order block in thin volume.</strong> The last opposite candle before the move was brief and light. Little business was done, so '
    'there is less reason to expect anyone to defend it.</li>'
    '</ul>',
    '<p>In each case the profile is a direct measurement of trade, while the candle pattern is a shape. When they conflict, give the measurement '
    'more weight, and write down which one turned out right. After a few months your own journal will tell you how the two methods behave on the '
    'instrument you trade, which is worth more than any general rule.</p>',
    '<h3>Worked example: a combined pre-session plan</h3>',
    '<ol>'
    '<li><strong>Bias (core course).</strong> The higher timeframe is bullish: structure is making higher highs and higher lows.</li>'
    '<li><strong>Value (VP-05).</strong> Value has migrated higher for three sessions. Yesterday\'s VAL sits just above a set of equal lows.</li>'
    '<li><strong>Liquidity (ch 07).</strong> Those equal lows hold sell-side liquidity.</li>'
    '<li><strong>Thin area (VP-03).</strong> Below the equal lows there is an LVN left by a fast move earlier in the week, overlapping an unfilled '
    'bullish FVG.</li>'
    '<li><strong>Scenario.</strong> If price sweeps the equal lows into the LVN and the footprint shows selling absorbed and buyers at the low, the '
    'long scenario from your playbook applies. If instead price builds volume inside the LVN and holds below the lows, value is moving lower, and '
    'the bullish scenario is off.</li>'
    '</ol>',
    '<p>Notice that both outcomes are written down before the session. The combination doesn\'t tell you which will happen. It tells you what '
    'each one would look like, so you can recognise it when it does. Position size and the stop still come from your risk plan '
    '(<a href="chapter.html?ch=36">chapter 36</a>), and this is a hypothetical example, not a recommendation.</p>',

    '<h3>Common mistakes</h3>',
    '<ul>'
    '<li><strong>Counting the same idea twice.</strong> An FVG and an LVN from the same leg are one event measured two ways, not two reasons.</li>'
    '<li><strong>Forcing agreement.</strong> If the profile disagrees with your liquidity read, take that seriously instead of hunting for another tool.</li>'
    '<li><strong>Using spot or CFD data for the profile.</strong> Build the profile on the future (<a href="chapter.html?ch=VP-10">VP-10</a>).</li>'
    '<li><strong>Treating premium as always "expensive".</strong> Value can sit in the premium half of a range.</li>'
    '<li><strong>Drawing everything.</strong> Five well-chosen levels beat twenty.</li>'
    '</ul>',

    callout('Key takeaways', '<ul>'
            '<li>FVGs, LVNs and single prints all describe fast one-sided movement, measured three ways.</li>'
            '<li>Volume at an order block tells you whether real business was done there.</li>'
            '<li>Premium/discount is geometry; value is measured participation. They can disagree.</li>'
            '<li>A sweep into an LVN with absorption on the footprint is the strongest form of the combined read.</li>'
            '<li>Write both scenarios down before the session.</li>'
            '</ul>'),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>For ten recent FVGs on a 5-minute ES chart, anchor a fixed-range profile to the leg. How many sit on an LVN?</li>'
    '<li>Take your last five order-block entries. Was each one on an HVN, an LVN, or neither?</li>'
    '<li>Find three liquidity sweeps. Check the profile level the wick reached and the footprint of the sweep bar.</li>'
    '<li>Write a combined plan like the worked example for tomorrow\'s session, then review it at the close.</li>'
    '</ol>',

    quiz([
        ('What do an FVG, an LVN and single prints have in common?', '<p>They all mark price moving quickly through a range without two-sided trade.</p>'),
        ('How can volume help you choose between two order blocks?', '<p>Prefer the one where more business was done, such as one on an HVN or POC.</p>'),
        ('Why can value sit in the premium half of a range?', '<p>Premium/discount is geometry; value follows where volume actually traded, as on a P-shaped day.</p>'),
        ('What footprint evidence supports a sweep of equal lows?', '<p>Selling at the bid below the lows that fails to hold, with buyers appearing at the wick low and a close back above.</p>'),
        ('Why isn\'t an FVG plus an LVN from the same leg two separate reasons?', '<p>Because both measure the same fast move; they are one event seen two ways.</p>'),
    ]),
]

lessons = [
    ('FVGs, LVNs and single prints', '<p>Compare the three measures of fast movement on the same leg, and know when the profile is the better measurement.</p>'),
    ('Order blocks and volume', '<p>Use HVNs and the POC to judge whether an order block was a real business area.</p>'),
    ('Premium, discount and value', '<p>Understand where geometric and volume-based "fair price" agree and where they don\'t.</p>'),
    ('Sweeps confirmed by profile and footprint', '<p>Check a sweep against the profile level it reached and the footprint of the sweep bar.</p>'),
    ('A combined pre-session plan', '<p>Write both scenarios, with the evidence for each, before the session starts.</p>'),
]

src = [
    ('Volume profile indicators: basic concepts - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/'),
    ('Fixed Range Volume Profile indicator - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000480324-fixed-range-volume-profile-indicator/'),
    ('Time price opportunity charts explained - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000725590-time-price-opportunity-tpo-chart/'),
    ('Volume Footprint charts: a complete guide - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000726164-volume-footprint-charts-a-complete-guide/'),
    ('Order Flow Volumetric Bars - NinjaTrader 8 Help Guide', 'https://ninjatrader.com/support/helpGuides/nt8/order_flow_volumetric_bars.htm'),
    ('Mind Over Markets, Updated Edition (Dalton, Jones, Dalton; Wiley 2013) - further reading', 'https://oreilly.com/library/view/mind-over-markets/9781118659762/f02.html'),
]

write_chapter('vp', 'VP-11', 'Combining Profile & Order Flow with Liquidity & SMC', 'advanced', '40 min', lessons, body, src)
