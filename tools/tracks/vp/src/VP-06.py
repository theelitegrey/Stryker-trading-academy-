#!/usr/bin/env python3
"""VP-06 VWAP, Anchored VWAP & Deviation Bands."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

# ---------------------------------------------------------------- worked example: 5 bars by hand
wk = [(5201.00, 5199.00, 5200.50, 1200), (5202.50, 5200.25, 5202.00, 1800), (5203.00, 5201.50, 5202.25, 900),
      (5202.75, 5200.75, 5201.25, 1500), (5204.00, 5201.00, 5203.75, 2100)]
rows = []; cum_pv = cum_v = 0.0
for k, (h, l, c, v) in enumerate(wk, 1):
    tp = (h + l + c) / 3.0
    cum_pv += tp * v; cum_v += v
    rows.append([str(k), '%.2f' % tp, '{:,}'.format(v), '{:,.0f}'.format(tp * v), '%.2f' % (cum_pv / cum_v)])
wk_vwap = cum_pv / cum_v
wk_table = table(['Bar', 'Typical', 'Volume', 'Price x vol', 'VWAP so far'], rows)
# independent check
assert abs(wk_vwap - sum((h + l + c) / 3 * v for h, l, c, v in wk) / sum(v for *_, v in wk)) < 1e-9

# ---------------------------------------------------------------- session with VWAP and bands (illustrative)
ohlc = [(5200.00, 5201.50, 5199.25, 5201.00), (5201.00, 5202.75, 5200.50, 5202.50), (5202.50, 5204.00, 5202.00, 5203.50),
        (5203.50, 5204.25, 5202.25, 5202.75), (5202.75, 5203.25, 5201.00, 5201.50), (5201.50, 5202.00, 5200.25, 5200.75),
        (5200.75, 5202.25, 5200.50, 5202.00), (5202.00, 5203.75, 5201.75, 5203.50), (5203.50, 5205.50, 5203.25, 5205.25),
        (5205.25, 5206.75, 5204.75, 5206.50), (5206.50, 5207.00, 5205.00, 5205.25), (5205.25, 5205.75, 5203.75, 5204.25)]
vols = [3200, 2600, 2400, 1900, 2100, 2300, 1800, 2000, 2900, 3100, 2200, 1700]
vw = vwap([((h + l + c) / 3.0, v) for (o_, h, l, c), v in zip(ohlc, vols)])
mid = [m for m, s in vw]
up1 = [m + s for m, s in vw]; dn1 = [m - s for m, s in vw]
up2 = [m + 2 * s for m, s in vw]; dn2 = [m - 2 * s for m, s in vw]
lo = min(min(b[2] for b in ohlc), min(dn2[1:])); hi = max(max(b[1] for b in ohlc), max(up2[1:]))
sess_svg, _ = candles(ohlc, 'Session VWAP with 1 and 2 standard deviation bands', lo=lo, hi=hi, height=280,
                      overlay=[(mid, GOLD, None), ([None] + up1[1:], TEAL, '4 3'), ([None] + dn1[1:], TEAL, '4 3'),
                               ([None] + up2[1:], MUTED, '2 3'), ([None] + dn2[1:], MUTED, '2 3')])
fig_sess = figure(sess_svg, 'Gold line: session VWAP, recalculated on every bar. Dashed teal: VWAP plus and minus one standard deviation. '
                  'Dotted grey: plus and minus two. The bands widen as price moves away from the average. Final VWAP %s.' % fmt(mid[-1]))

# ---------------------------------------------------------------- anchored VWAP from a swing low
ohlc2 = [(5215.00, 5215.50, 5211.00, 5211.75), (5211.75, 5212.25, 5208.00, 5208.75), (5208.75, 5209.50, 5205.25, 5206.00),
         (5206.00, 5208.50, 5205.50, 5208.25), (5208.25, 5211.00, 5208.00, 5210.75), (5210.75, 5213.25, 5210.25, 5212.75),
         (5212.75, 5213.50, 5210.50, 5211.00), (5211.00, 5211.50, 5209.25, 5209.75), (5209.75, 5212.00, 5209.50, 5211.75),
         (5211.75, 5214.50, 5211.50, 5214.00)]
vols2 = [2100, 2600, 3400, 2800, 2500, 2400, 1900, 1800, 2000, 2300]
anchor = min(range(len(ohlc2)), key=lambda i: ohlc2[i][2])
av = vwap([((h + l + c) / 3.0, v) for (o_, h, l, c), v in zip(ohlc2[anchor:], vols2[anchor:])])
avline = [None] * anchor + [m for m, _ in av]
pull = min(range(anchor + 1, len(ohlc2)), key=lambda i: ohlc2[i][2] - avline[i])
assert ohlc2[pull][2] - avline[pull] < 0.75 and ohlc2[pull][3] > avline[pull], (ohlc2[pull], avline[pull])
av_svg, _ = candles(ohlc2, 'Anchored VWAP from a swing low', height=260, overlay=[(avline, GOLD, None)],
                    labels=[(anchor, ohlc2[anchor][2], 'anchor', GOLD, 'below'), (pull, ohlc2[pull][1], 'retest', TEAL, 'above')])
fig_av = figure(av_svg, 'The anchored VWAP starts at bar %d, the swing low, and only includes volume from there on. On bar %d price '
                'pulls back to within a tick or two of it (low %s against an AVWAP of %s) and closes back above.'
                % (anchor + 1, pull + 1, fmt(ohlc2[pull][2]), fmt(avline[pull])))

# how much each new bar moves the session VWAP (same 12 bars)
moves = [0] + [abs(mid[i] - mid[i - 1]) for i in range(1, len(mid))]
move_svg, _ = series([(moves, GOLD, 'move')], 'How far VWAP moves on each new bar', height=190, zero=True, dp=2)
early = max(moves[1:4]); late = max(moves[-4:])
fig_move = figure(move_svg, 'Same session as above. Size of each bar\'s change in VWAP, in points. Early bars move it by up to %.2f; the '
                  'last four move it by at most %.2f, even though some of them are large bars. The more volume already counted, the '
                  'harder VWAP is to push.' % (early, late))

body = [
    '<p><strong>VWAP</strong> stands for <strong>volume-weighted average price</strong>: the average price of everything that traded, where each '
    'trade counts in proportion to its size. It sits next to the volume profile as the other main "where is value?" tool. The profile shows you '
    '<em>where</em> volume traded; VWAP condenses the same information into one moving line that tells you the average price paid today.</p>',
    '<p>This chapter covers how VWAP is calculated, why execution desks care about it, how <strong>anchored VWAP</strong> works, and what the '
    '<strong>standard-deviation bands</strong> around it measure. As with everything in this track, VWAP is a measurement. How traders react to it is a '
    'practice, not a law.</p>',

    '<h3>How VWAP is calculated</h3>',
    '<p>For each bar you take a representative price and multiply it by the bar\'s volume. Add those products up from the start of the session, '
    'and divide by the total volume so far. Most platforms use the <strong>typical price</strong>, (high + low + close) / 3, as the bar\'s price; '
    'Sierra Chart lets you choose the input, and tick-level implementations use every trade\'s actual price. The formula is:</p>',
    '<p style="font-family:JetBrains Mono, monospace; background:#0b0b0d; border:1px solid #1e1e22; border-radius:8px; padding:12px 14px;">'
    'VWAP = sum(price x volume) / sum(volume)</p>',
    '<p>Because it is cumulative, VWAP reacts strongly early in the session and becomes steadier as volume builds up. By the afternoon, one '
    'bar barely moves it. Session VWAP resets at the start of each session, which is why it pairs so well with session profiles '
    '(<a href="chapter.html?ch=VP-05">VP-05</a>).</p>',

    '<h3>Worked example: VWAP by hand</h3>',
    '<p>Five illustrative bars. For each, typical price = (high + low + close) / 3. The last column divides the running total of price x volume by the running total of volume.</p>',
    wk_table,
    '<p>After bar 5 the VWAP is <strong>%s</strong>. Notice how bar 2 and bar 5, the two biggest bars, pull the average toward their prices much '
    'more than bar 3 does. That is the whole point of volume weighting: a price where 2,100 contracts traded matters more than a price where 900 did.</p>'
    % fmt(wk_vwap),

    '<h3>Why VWAP matters: the execution benchmark</h3>',
    '<p>VWAP began as a <strong>benchmark</strong> for large orders, not as a trading signal. Investopedia describes how institutions use it to judge '
    'execution: a buy filled below the day\'s VWAP was, on average, a cheaper fill than the market got, and a sell filled above it was better. '
    'Some execution algorithms aim to trade in proportion to volume through the day precisely so that the fill lands near VWAP.</p>',
    '<p>That is the practical reason traders watch the line. If large participants measure themselves against it, VWAP is a price many of them are '
    'aware of, and price being above or below it is a quick read on who is ahead today. Above VWAP, the average buyer today is in profit. Below it, '
    'the average buyer is under water. It does not mean price must come back to it.</p>',

    '<h3>Standard-deviation bands</h3>',
    '<p>Most platforms can draw bands at a set number of <strong>standard deviations</strong> above and below VWAP. A standard deviation is a measure of '
    'spread: here, how far the traded prices have been from the VWAP on average, weighted by volume. Sierra Chart\'s VWAP study documents exactly '
    'this: bands based on the volume-weighted standard deviation, drawn at multipliers you choose. The usual settings are 1 and 2.</p>',
    fig_sess,
    '<p>Read the bands as a <strong>stretch gauge</strong>. Inside one deviation, price is trading close to where most of today\'s volume was done. '
    'Out at two deviations, price is a long way from the day\'s average. Balance-day traders often look for responsive trade near the outer '
    'bands; trend-day traders expect price to "walk" a band for hours. Which one you get depends on the day type from '
    '<a href="chapter.html?ch=VP-04">VP-04</a>. There is no band that price must respect.</p>',
    '<p>A caution about the numbers: many traders say price stays within two deviations about 95% of the time. That figure comes from the normal '
    'distribution in statistics textbooks. Intraday prices are not normally distributed and the bands are built from the same data they measure, '
    'so do not treat any percentage as a probability for your market.</p>',

    '<h3>Anchored VWAP</h3>',
    '<p><strong>Anchored VWAP</strong> (AVWAP) is the same calculation started from a bar you choose instead of the session open. TradingView\'s help '
    'page describes it as a VWAP that starts from a user-selected point. Common anchors are a swing high or low, a gap, an earnings or '
    'news bar, the start of the week or month, or the first candle of a displacement leg.</p>',
    fig_av,
    '<p>The logic is the same as session VWAP, applied to a group of traders you define. An AVWAP from a swing low is the average price paid by '
    'everyone who has traded since that low. If price pulls back to it and holds, the average buyer since the low is still at break-even or '
    'better. If price breaks below it and builds volume there, that group is now under water on average. Practitioners use the level as dynamic '
    'support or resistance on exactly that reasoning.</p>',
    '<p>AVWAP fits Stryker\'s framework neatly. Anchor it to the start of the displacement leg that broke structure (<a href="chapter.html?ch=08">chapter 08</a>), '
    'and you have a line that tracks the average entry of that move. A pullback into a fair value gap or order block (<a href="chapter.html?ch=10">chapter 10</a>, '
    '<a href="chapter.html?ch=09">chapter 09</a>) that also meets the AVWAP is two separate methods pointing at the same area.</p>',

    '<h3>VWAP and the volume profile together</h3>',
    '<p>VWAP and the POC answer related questions differently. The POC is the single busiest price. VWAP is the average of all prices, weighted '
    'by volume. On a balanced D-shaped day they tend to sit close together; on a trend day VWAP lags behind price while the POC may jump to a '
    'new node. A large gap between them is a sign that the day\'s volume is lopsided, which tells you something about the day type.</p>',
    cards(['Tool', 'What it measures', 'Best use'], [
        ['POC', 'The single price with the most volume.', 'The anchor of balance; a reference level for the next session.'],
        ['Value area', 'The range holding 70% of volume.', 'Where the market accepted price; edges for responsive trade.'],
        ['Session VWAP', 'The volume-weighted average price since the open.', 'Who is ahead today; a moving fair-value line.'],
        ['Anchored VWAP', 'The same average from a bar you choose.', 'The average entry of a specific move or group of traders.'],
        ['Deviation bands', 'Spread of traded prices around VWAP.', 'How stretched price is compared with today\'s volume.'],
    ]),

    '<h3>Why VWAP settles down during the session</h3>',
    '<p>Because VWAP is cumulative, each new bar is a smaller share of everything counted so far. The chart below measures that directly on the '
    'illustrative session from earlier.</p>',
    fig_move,
    '<p>This has two practical consequences. First, VWAP in the first half hour is a weak reference: one big bar can drag it a long way. Many '
    'traders wait until the initial balance has formed (<a href="chapter.html?ch=VP-02">VP-02</a>) before they pay much attention to it. Second, '
    'late in the session VWAP barely moves, so price being far from it at 3 p.m. is a real statement about the day, not noise.</p>',
    '<h3>Weekly, monthly and multiple anchors</h3>',
    '<p>Many platforms also offer VWAP reset weekly or monthly, which is simply an anchored VWAP pinned to the start of the week or month. These act '
    'like the composite profiles in <a href="chapter.html?ch=VP-05">VP-05</a>: slower, broader references for context rather than timing.</p>',
    '<p>It is tempting to anchor VWAPs to every swing on the chart. Resist it. Two or three anchors, each tied to an event you can name (the last '
    'major swing low, the start of the current leg, a news bar), are readable. Ten are not. When two anchored VWAPs from different events sit at '
    'nearly the same price, that level is worth noting, for the same reason a confluence of methods is worth noting anywhere in the course.</p>',
    '<h3>Common mistakes</h3>',
    '<ul>'
    '<li><strong>Using VWAP on instruments without real volume.</strong> On spot FX, VWAP is built from tick volume. See '
    '<a href="chapter.html?ch=VP-10">VP-10</a>.</li>'
    '<li><strong>Treating the first hour\'s VWAP as meaningful.</strong> Early in the session it is based on little volume and moves a lot.</li>'
    '<li><strong>Anchoring to random bars.</strong> An anchor needs a reason: a swing, an event, a gap.</li>'
    '<li><strong>Quoting band percentages as probabilities.</strong> The textbook 68/95 figures assume a normal distribution that intraday prices don\'t follow.</li>'
    '<li><strong>Fading every touch of the outer band.</strong> On a trend day price can ride the band all session.</li>'
    '</ul>',

    callout('Key takeaways', '<ul>'
            '<li>VWAP = sum(price x volume) / sum(volume), accumulated from the session start.</li>'
            '<li>It began as an execution benchmark, which is why large participants are aware of it.</li>'
            '<li>Deviation bands measure how stretched price is from the day\'s average.</li>'
            '<li>Anchored VWAP starts the average at a bar you choose and tracks that move\'s average entry.</li>'
            '<li>VWAP and POC measure different things; the gap between them says something about the day type.</li>'
            '</ul>'),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Recalculate the worked example with close prices instead of typical prices. How much does the VWAP change?</li>'
    '<li>On five ES sessions, note where price closed relative to VWAP and the 1 and 2 deviation bands, and label each day type.</li>'
    '<li>Anchor a VWAP to the last three clear swing lows on a 15-minute chart. Record each first retest and whether it held.</li>'
    '<li>Compare the session POC and VWAP at the close for ten days. Find the day with the biggest gap and explain it with the profile shape.</li>'
    '</ol>',

    quiz([
        ('Why does a 2,100-lot bar move VWAP more than a 900-lot bar?',
         '<p>Because VWAP weights each price by its volume, so bigger bars contribute proportionally more.</p>'),
        ('Why is VWAP an execution benchmark?',
         '<p>Institutions compare their average fill with VWAP: buying below it or selling above it means a better-than-average price for the day.</p>'),
        ('What does anchored VWAP measure?',
         '<p>The volume-weighted average price of everything traded since the bar you anchored it to.</p>'),
        ('Why should you not quote "95% within 2 deviations" for intraday prices?',
         '<p>That figure assumes a normal distribution, which intraday prices do not follow.</p>'),
        ('On which day type is fading the outer VWAP band most dangerous?',
         '<p>A trend day, where price can keep walking along the band.</p>'),
    ]),
]

lessons = [
    ('How VWAP is calculated', '<p>Work through the five-bar example by hand, then check the final VWAP against your platform on a real chart.</p>'),
    ('VWAP as an execution benchmark', '<p>Understand why large participants measure fills against VWAP, and what above or below VWAP means for the average buyer.</p>'),
    ('Standard-deviation bands', '<p>Plot 1 and 2 deviation bands on ten sessions and label how price behaved around them on each day type.</p>'),
    ('Anchored VWAP', '<p>Practise anchoring to swing points, gaps and displacement legs, and log each retest.</p>'),
    ('VWAP and the profile together', '<p>Compare session VWAP with the POC each day and relate the gap to the profile shape.</p>'),
]

src = [
    ('Volume Weighted Average Price (VWAP) - Investopedia', 'https://www.investopedia.com/terms/v/vwap.asp'),
    ('Volume Weighted Average Price - VWAP - with Standard Deviation Lines - Sierra Chart documentation', 'https://sierrachart.com/?ID=108&Name=Volume_Weighted_Average_Price_-_VWAP_-_with_Standard_Deviation_Lines.&page=doc/StudiesReference.php'),
    ('Anchored VWAP - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000669764-anchored-vwap'),
    ('Volume profile indicators: basic concepts - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/'),
    ('E-mini S&P 500 contract specs - CME Group', 'https://www.cmegroup.com/markets/equities/sp/e-mini-sandp500.contractSpecs.html'),
]

write_chapter('vp', 'VP-06', 'VWAP, Anchored VWAP & Deviation Bands', 'intermediate', '35 min', lessons, body, src)
