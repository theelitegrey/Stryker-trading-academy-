#!/usr/bin/env python3
"""VP-02 Market Profile & TPO Charts."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

TICK = 1.0   # one-point TPO rows keep the letters readable on a phone (ES trades in 0.25 ticks; profiles are usually grouped)
P = [5200.0 + i for i in range(18)]   # 5,200 .. 5,217


def rng(lo, hi):
    return [p for p in P if lo <= p <= hi]


# ---------------------------------------------------------------- full illustrative session, 30-min periods A..M
session = [
    ('A', rng(5205, 5209)), ('B', rng(5203, 5207)),            # IB = 5,203 - 5,209
    ('C', rng(5206, 5211)), ('D', rng(5209, 5213)),            # range extension up in C and D
    ('E', rng(5210, 5212)), ('F', rng(5208, 5211)), ('G', rng(5207, 5210)),
    ('H', rng(5208, 5211)), ('I', rng(5209, 5212)), ('J', rng(5209, 5211)),
    ('K', rng(5208, 5210)), ('L', rng(5209, 5211)), ('M', rng(5210, 5211)),
]
fig_sess_svg, info = tpo(session, rng(5202, 5214), 'A full session as a TPO profile, periods A to M', dp=0, row_h=19)
counts = info['counts']; prices_s = rng(5202, 5214)
ib_lo, ib_hi = info['ib']
day_hi = max(max(ps) for _, ps in session); day_lo = min(min(ps) for _, ps in session)
fig_sess = figure(fig_sess_svg, 'Each letter is one 30-minute period at every price it traded. The gold bar marks the initial balance '
                  '(periods A and B, %s to %s). Price later extended up to %s. The TPO POC is %s.'
                  % (fmt(ib_lo, 0), fmt(ib_hi, 0), fmt(day_hi, 0), fmt(info['poc'], 0)))

# TPO value area by the two-row method on TPO counts
nz = [(p, c) for p, c in zip(prices_s, counts) if c]
tp_prices = [p for p, _ in nz]; tp_counts = [c for _, c in nz]
tpoc, tlo, thi, tsteps = value_area_steps(tp_prices, tp_counts)
tp_total = sum(tp_counts)
va_rows = [['0', 'POC ' + fmt(tp_prices[tpoc], 0), '-', '-', '%d of %d (%.0f%%)' % (tp_counts[tpoc], tp_total, 100.0 * tp_counts[tpoc] / tp_total)]]
for k, s in enumerate(tsteps, 1):
    va_rows.append([str(k), 'add ' + s['side'], str(s['up']) if s['up'] >= 0 else 'none', str(s['down']) if s['down'] >= 0 else 'none',
                    '%d (%.0f%%)' % (s['acc'], 100 * s['pct'])])
va_table = table(['Step', 'Add', 'Next 2 above', 'Next 2 below', 'TPOs so far'], va_rows)
TVAL, TVAH = tp_prices[tlo], tp_prices[thi]

# ---------------------------------------------------------------- IB and range extension, three variants
def ib_variant(periods, title):
    s, i = tpo(periods, rng(5200, 5217), title, dp=0, row_h=16, col_w=15)
    return s, i

narrow = [('A', rng(5208, 5210)), ('B', rng(5207, 5209)), ('C', rng(5209, 5212)), ('D', rng(5211, 5214)), ('E', rng(5213, 5216)), ('F', rng(5214, 5217))]
wide = [('A', rng(5202, 5210)), ('B', rng(5204, 5213)), ('C', rng(5206, 5210)), ('D', rng(5205, 5209)), ('E', rng(5206, 5211)), ('F', rng(5207, 5210))]
fig_narrow_svg, inf_n = ib_variant(narrow, 'Narrow initial balance followed by range extension up')
fig_wide_svg, inf_w = ib_variant(wide, 'Wide initial balance that contains the whole day')
n_ext = max(max(ps) for _, ps in narrow) - inf_n['ib'][1]
w_hi = max(max(ps) for _, ps in wide); w_lo = min(min(ps) for _, ps in wide)
assert w_hi == inf_w['ib'][1] and w_lo == inf_w['ib'][0]
fig_narrow = figure(fig_narrow_svg, 'IB %s to %s (%d points). Later periods extend the range %d points above it.'
                    % (fmt(inf_n['ib'][0], 0), fmt(inf_n['ib'][1], 0), inf_n['ib'][1] - inf_n['ib'][0], n_ext))
fig_wide = figure(fig_wide_svg, 'IB %s to %s (%d points). The rest of the day stays inside it: no range extension.'
                  % (fmt(inf_w['ib'][0], 0), fmt(inf_w['ib'][1], 0), inf_w['ib'][1] - inf_w['ib'][0]))

# ---------------------------------------------------------------- tail vs poor high
tail_day = [('A', rng(5206, 5215)), ('B', rng(5205, 5210)), ('C', rng(5204, 5209)), ('D', rng(5205, 5208)), ('E', rng(5206, 5209))]
poor_day = [('A', rng(5204, 5209)), ('B', rng(5205, 5211)), ('C', rng(5206, 5211)), ('D', rng(5207, 5211)), ('E', rng(5205, 5209))]
fig_tail_svg, inf_t = tpo(tail_day, rng(5203, 5216), 'Selling tail: single prints at the high', dp=0, row_h=16)
fig_poor_svg, inf_p = tpo(poor_day, rng(5203, 5216), 'Poor high: several periods stop at the same high', dp=0, row_h=16)
t_prices = rng(5203, 5216)
tail_len = 0
for p, c in reversed(list(zip(t_prices, inf_t['counts']))):
    if c == 0: continue
    if c == 1: tail_len += 1
    else: break
poor_hi = max(max(ps) for _, ps in poor_day)
poor_n = sum(1 for _, ps in poor_day if poor_hi in ps)
fig_tail = figure(fig_tail_svg, 'Only period A traded at the top %d prices: a selling tail. Sellers responded so quickly that price '
                  'never came back there.' % tail_len)
fig_poor = figure(fig_poor_svg, '%d periods reached %s and none went higher. The flat top with no tail is read as a poor high.'
                  % (poor_n, fmt(poor_hi, 0)))
assert tail_len >= 2 and poor_n >= 2

# ---------------------------------------------------------------- body
body = [
    '<p><strong>Market Profile</strong> is the chart that started this whole family of tools. Instead of counting contracts, it counts '
    '<em>time</em>: how many 30-minute periods the market spent at each price. The result is a picture of the day\'s auction built out of '
    'letters, and a set of named features traders read from it: the initial balance, range extension, single prints, tails, and poor '
    'highs and lows. This chapter teaches you to build one by hand and read those features.</p>',
    '<p>J. Peter Steidlmayer developed the chart at the Chicago Board of Trade, and it was released publicly in 1985. Everything below is '
    'a <strong>reading method</strong> that practitioners use. The features describe what happened in the auction; they do not promise '
    'what will happen next.</p>',

    '<h3>TPOs and letters</h3>',
    '<p><strong>TPO</strong> stands for <strong>time price opportunity</strong>. The session is split into equal time blocks, traditionally '
    '30 minutes, and each block gets a letter: A for the first, B for the second, and so on. For every price the market traded during a '
    'block, you write that block\'s letter on the price row. TradingView\'s help pages describe it the same way: each letter is one block of '
    'time, and a block of that letter appears at every price where activity happened during it. Platforms let you choose other block lengths '
    'too (5 minutes to 4 hours), but 30 minutes is the classic setting.</p>',
    '<p>Then the letters are pushed to the left on each row, so every row becomes a bar whose length is the number of periods that visited '
    'that price. That collapsed view is the profile. Rows with many letters are prices the market kept coming back to. Rows with one letter '
    'are prices it visited once and left.</p>',
    fig_sess,

    '<h3>The initial balance and range extension</h3>',
    '<p>The <strong>initial balance (IB)</strong> is the range of the first hour of the regular session: periods A and B. In the session '
    'above it runs from %s to %s. Market Profile traders treat it as the market\'s opening statement: the range set before the rest of the '
    'day\'s participants have fully shown up.</p>' % (fmt(ib_lo, 0), fmt(ib_hi, 0)),
    '<p><strong>Range extension</strong> is any later trade outside the IB. Above the IB it is <strong>range extension up</strong>; below, '
    '<strong>range extension down</strong>. Practitioners read extension as a sign that participants beyond the day timeframe were active, '
    'because someone was willing to trade at prices the opening hour didn\'t reach. Sierra Chart\'s TPO study has built-in settings for the '
    'IB range and extension levels, so this is standard across platforms.</p>',
    fig_narrow,
    fig_wide,
    '<p>Compare the two. A narrow IB leaves a lot of room for range extension, and on the first chart the day went on to extend %d points above '
    'it. A wide IB can contain the whole session, which is what happened on the second chart. How big the IB is compared with recent days '
    'is one of the first things profile traders note each morning. <a href="chapter.html?ch=VP-04">VP-04</a> turns this into day types.</p>' % n_ext,

    '<h3>Single prints and tails</h3>',
    '<p>A <strong>single print</strong> is a price row with only one letter, inside the day\'s range. It means the market passed through those '
    'prices in one period and never returned. On a profile, single prints often sit in the middle of a range extension: price moved '
    'quickly from one area to another.</p>',
    '<p>A <strong>tail</strong> is a run of single prints at the very top or bottom of the day, usually defined as two or more. A tail at the '
    'low is a <strong>buying tail</strong>: buyers responded so strongly that price never came back. A tail at the high is a '
    '<strong>selling tail</strong>. Practitioners read tails as a sign that the auction found the other side decisively at that extreme.</p>',
    fig_tail,
    '<p>Single prints connect to what you know from the core course. They are the time-based version of the thin areas you saw on a volume '
    'profile, and they often line up with fair value gaps on a candle chart (<a href="chapter.html?ch=10">chapter 10</a>). '
    '<a href="chapter.html?ch=VP-11">VP-11</a> compares all three directly.</p>',

    '<h3>Poor highs and poor lows</h3>',
    '<p>A <strong>poor high</strong> is the opposite of a tail. Several periods trade up to the same high and none goes above it, so the top of '
    'the profile is flat, with two or more letters and no single prints. A <strong>poor low</strong> is the same thing at the bottom. The '
    'common reading is that the auction there was <em>unfinished</em>: price stopped because trade paused, not because the other side '
    'showed up decisively. Many profile traders expect the market to revisit such a level later. Sierra Chart\'s TPO study can extend poor '
    'highs and lows forward on the chart so you can track them.</p>',
    fig_poor,
    '<p>This is one of the places where Market Profile and Stryker\'s liquidity framework say the same thing in different words. A flat top '
    'with several touches is also a set of <strong>equal highs</strong>, and the core course treats those as resting buy-side liquidity '
    '(<a href="chapter.html?ch=07">chapter 07</a>, <a href="chapter.html?ch=12">chapter 12</a>). Two methods pointing at the same level is '
    'worth noting. It is still not a guarantee that price will return there.</p>',

    '<h3>Worked example: TPO POC and TPO value area</h3>',
    '<p>The <strong>TPO POC</strong> is the price row with the most letters. If two rows tie, the usual rule picks the one closer to the middle '
    'of the range. The <strong>TPO value area</strong> is the range holding 70%% of all letters, computed with the same two-row method you '
    'used on volume in <a href="chapter.html?ch=VP-03">VP-03</a>. Sierra Chart even has a setting named "Count 2 Levels at a Time for Value Area". '
    'For the full session above there are %d TPOs, so the target is %d.</p>' % (tp_total, int(round(tp_total * 0.7 + 0.4999))),
    va_table,
    '<p>The TPO value area runs from <strong>%s</strong> to <strong>%s</strong>, with the POC at <strong>%s</strong>. Note that the IB (%s to %s) '
    'sits mostly <em>below</em> the value area: the market opened low, extended up in C and D, and spent the rest of the day trading higher. '
    'That shift of value away from the opening range is exactly the kind of thing Market Profile makes easy to see.</p>'
    % (fmt(TVAL, 0), fmt(TVAH, 0), fmt(tp_prices[tpoc], 0), fmt(ib_lo, 0), fmt(ib_hi, 0)),


    '<h3>How to read a profile in the first few minutes</h3>',
    '<p>Profile traders tend to follow the same short routine at the start of each session. None of it predicts the day. It organises what you '
    'already know so you can react faster when the market shows its hand.</p>',
    '<ol>'
    '<li><strong>Find yesterday\'s reference levels.</strong> Mark the prior session\'s TPO POC, value area high and low, any tails, and any poor '
    'high or low. These are the prices where yesterday\'s auction either finished decisively or left business undone.</li>'
    '<li><strong>Note where today opens.</strong> Opening inside yesterday\'s value suggests the market still broadly agrees on value. Opening '
    'outside it means the overnight session has already moved away from it, and the first hour will show whether that move is accepted. '
    '<a href="chapter.html?ch=VP-05">VP-05</a> covers the open in detail.</li>'
    '<li><strong>Watch the IB form.</strong> After periods A and B, compare the IB with the last few sessions. An unusually narrow IB leaves room for '
    'range extension; an unusually wide one often means much of the day\'s range is already in.</li>'
    '<li><strong>Track the first range extension.</strong> The first period that trades outside the IB, and whether it builds more letters there '
    'or leaves single prints and returns, is the first real piece of evidence about the day.</li>'
    '<li><strong>Update the developing POC.</strong> As letters build, the POC moves. A POC that migrates in the direction of the range extension '
    'suggests value is following price; a POC that stays put suggests the extension is not being accepted yet.</li>'
    '</ol>',
    '<p>Written out like this it looks like a lot, but after a few weeks it takes a minute or two. The point is to walk into each session with '
    'a short list of prices that matter and a clear question for each one: accepted or rejected?</p>',
    '<h3>Letters and time zones</h3>',
    '<p>Because letters are tied to clock time, you need to know which clock your platform uses. For ES, the regular session opens at 9:30 a.m. '
    'New York time, so period A normally covers 9:30 to 10:00 and B covers 10:00 to 10:30. If your platform is set to another time zone, or to '
    'the overnight Globex session start, the letters shift and your IB will not match what other profile traders are looking at. Set the '
    'session once, write it into your playbook, and don\'t change it between days.</p>',

    '<h3>Common mistakes</h3>',
    '<ul>'
    '<li><strong>Using the wrong session.</strong> For ES, the IB is normally taken from the regular (cash) session open, not the overnight '
    'Globex open. Mixing them moves every level.</li>'
    '<li><strong>Counting single prints at the extremes as ordinary singles.</strong> Singles at the top or bottom are tails and are read '
    'differently from singles in the middle of the range.</li>'
    '<li><strong>Treating a poor high as a target that must be hit.</strong> It is a level many traders watch, nothing more.</li>'
    '<li><strong>Comparing profiles with different block lengths.</strong> A 30-minute profile and a 15-minute profile of the same day give '
    'different counts and a different POC.</li>'
    '<li><strong>Ignoring volume.</strong> TPO counts time, not size. Check the volume profile too before you call a level important.</li>'
    '</ul>',

    callout('Key takeaways', '<ul>'
            '<li>A TPO profile counts 30-minute periods at each price, using one letter per period.</li>'
            '<li>The initial balance is the first hour\'s range. Trading outside it is range extension.</li>'
            '<li>Single prints mark fast one-period moves. Two or more at an extreme form a tail.</li>'
            '<li>A flat extreme with several letters and no tail is a poor high or low, read as an unfinished auction.</li>'
            '<li>TPO POC and value area use the same logic as volume, applied to letter counts.</li>'
            '</ul>'),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Build a TPO profile by hand from a 30-minute ES chart of one regular session: write each period\'s letter on every point it traded. '
    'Compare with your platform\'s TPO chart.</li>'
    '<li>For the last ten sessions, record the IB range in points and whether the day extended up, down, both or neither.</li>'
    '<li>Find three tails and three poor highs or lows on recent profiles. Note whether price revisited each level within the next five sessions.</li>'
    '<li>Compute the TPO value area of one session with the two-row method and compare it with the volume value area of the same session.</li>'
    '</ol>',

    quiz([
        ('What does one letter on a TPO profile represent?',
         '<p>One time period (traditionally 30 minutes) that traded at that price.</p>'),
        ('How is the initial balance defined?',
         '<p>The range of the first hour of the regular session: the first two 30-minute periods, A and B.</p>'),
        ('What is the difference between a single print and a tail?',
         '<p>A single print is any row with one letter inside the range. A tail is a run of two or more single prints at the high or low of the day.</p>'),
        ('Why do practitioners call a flat high with several letters "poor"?',
         '<p>Because trade stopped there without a decisive response from sellers, so the auction at that price is read as unfinished.</p>'),
        ('In the worked example, why did the value area end up above most of the IB?',
         '<p>Price extended up in periods C and D and then spent most of the day trading there, so most letters built up above the opening range.</p>'),
    ]),
]

lessons = [
    ('Building a TPO profile',
     '<p>Take one regular ES session on a 30-minute chart and build the letter profile on paper, one point per row. Then switch on your platform\'s '
     'TPO chart for the same day and check every row.</p>'),
    ('Initial balance and range extension',
     '<p>For each of the last ten sessions, log the IB high, IB low, IB size in points, and the size of any range extension. Keep the log. '
     'VP-04 uses it to classify day types.</p>'),
    ('Single prints and tails',
     '<p>Mark every tail on the last twenty profiles. Note whether it was a buying or selling tail and how many single prints it had.</p>'),
    ('Poor highs and lows',
     '<p>Mark every poor high and poor low on the last twenty profiles. Check whether each one also appears as equal highs or lows on your '
     'candle chart, and write down what price did when it next came back to that level.</p>'),
    ('TPO value area',
     '<p>Compute one session\'s TPO POC and value area by hand with the two-row method, then compare with the volume POC and value area of '
     'the same session. Note which one moved and why.</p>'),
]

src = [
    ('Time price opportunity charts explained - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000725590-time-price-opportunity-tpo-chart/'),
    ('TPO (Time Price Opportunity) Profile Charts - Sierra Chart documentation', 'https://www.sierrachart.com/index.php?page=doc/StudiesReference/TimePriceOpportunityCharts.html'),
    ('Market profile (history, TPO definition, initial balance, day types) - Wikipedia', 'https://en.wikipedia.org/wiki/Market_profile'),
    ('Mind Over Markets, Updated Edition (Dalton, Jones, Dalton; Wiley 2013) - further reading', 'https://oreilly.com/library/view/mind-over-markets/9781118659762/f02.html'),
    ('Markets and Market Logic (Steidlmayer, Koy; 1986) - further reading', 'https://books.google.com/books/about/Markets_and_Market_Logic.html?id=Lb9FPQAACAAJ'),
]

write_chapter('vp', 'VP-02', 'Market Profile & TPO Charts', 'foundation', '35 min', lessons, body, src)
