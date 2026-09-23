#!/usr/bin/env python3
"""VP-12 Case Studies & the Profile/Order-Flow Playbook."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

# ---------------------------------------------------------------- case 1: open inside value, rotation (ES, illustrative)
P1 = [5300.0 + i for i in range(16)]
prior = [30, 60, 120, 260, 480, 700, 860, 940, 820, 640, 420, 260, 150, 80, 40, 20]
ppoc, pval, pvah = value_area(P1, prior)
c1 = [(5306.25, 5307.00, 5305.25, 5305.50), (5305.50, 5305.75, 5302.75, 5303.25), (5303.25, 5304.50, 5302.50, 5304.25),
      (5304.25, 5306.75, 5304.00, 5306.50), (5306.50, 5309.50, 5306.25, 5308.75), (5308.75, 5309.25, 5307.50, 5307.75),
      (5307.75, 5308.00, 5306.00, 5306.25), (5306.25, 5307.25, 5305.75, 5307.00)]
VAL1, VAH1, POC1 = P1[pval], P1[pvah], P1[ppoc]
assert VAL1 < c1[0][0] < VAH1                                   # opened inside prior value
assert all(VAL1 - 1.0 <= b[2] and b[1] <= VAH1 + 1.0 for b in c1)  # rotated inside, probes within 1 pt
c1_svg, _ = candles(c1, 'Case 1: open inside prior value', lo=VAL1 - 1.5, hi=VAH1 + 1.5, height=250,
                    levels=[(VAH1, 'VAH', TEAL, '4 3'), (POC1, 'POC', GOLD, '4 3'), (VAL1, 'VAL', TEAL, '4 3')])
fig_c1 = figure(c1_svg, 'Illustrative ES session. Price opens at %s, inside yesterday\'s value (%s to %s), probes each edge and turns '
                'back each time. POC %s.' % (fmt(c1[0][0]), fmt(VAL1), fmt(VAH1), fmt(POC1)))

# ---------------------------------------------------------------- case 2: open above value, acceptance -> trend
c2 = [(5318.00, 5319.25, 5317.25, 5318.75), (5318.75, 5320.50, 5318.25, 5320.25), (5320.25, 5320.75, 5318.75, 5319.25),
      (5319.25, 5321.75, 5319.00, 5321.50), (5321.50, 5323.25, 5321.00, 5322.75), (5322.75, 5324.50, 5322.25, 5324.25),
      (5324.25, 5325.00, 5323.00, 5323.50), (5323.50, 5326.00, 5323.25, 5325.75)]
assert c2[0][0] > P1[-1] + 2 and min(b[2] for b in c2) > VAH1   # opened above prior range, never returned to value
assert c2[-1][3] > c2[0][0] + 5
c2_svg, _ = candles(c2, 'Case 2: open above the prior range, accepted', height=240,
                    labels=[(2, c2[2][2], 'holds', TEAL, 'below')])
fig_c2 = figure(c2_svg, 'Illustrative. Price opens at %s, above yesterday\'s whole range (high %s). The first pullback holds at %s, and '
                'each bar builds higher: the new prices are being accepted.' % (fmt(c2[0][0]), fmt(P1[-1]), fmt(c2[2][2])))

# ---------------------------------------------------------------- case 3: failed breakout at a poor high (footprint)
T = 0.25
f1 = {'o': 5314.25, 'c': 5315.50, 'rows': {5315.75: (6, 21), 5315.50: (18, 44), 5315.25: (22, 39), 5315.00: (26, 31), 5314.75: (21, 24), 5314.50: (19, 17), 5314.25: (12, 9)}}
f2 = {'o': 5315.50, 'c': 5314.25, 'rows': {5316.25: (31, 4), 5316.00: (47, 52), 5315.75: (41, 61), 5315.50: (38, 30), 5315.25: (44, 18), 5315.00: (58, 14), 5314.75: (45, 11), 5314.50: (33, 9), 5314.25: (28, 6)}}
poor_hi = 5315.75
d_f = [delta_rows(b['rows'])[0] for b in (f1, f2)]
assert max(f2['rows']) > poor_hi and f2['c'] < poor_hi and d_f[1] < 0
s2 = diagonal_imbalances(f2['rows'], T, 3.0)[1]
fig_c3 = figure(footprint([f1, f2], 'Case 3: a poke through a poor high', T, ratio=3.0, labels=[(1, 'back inside')]),
                'Illustrative. Bar 2 trades two ticks above the poor high at %s with heavy buying at the ask near the top, then closes back below '
                'it with delta %+d and %d sell imbalances on the way down.' % (fmt(poor_hi), d_f[1], len(s2)))
assert len(s2) >= 3

# ---------------------------------------------------------------- checklist (details/summary works without JS)
checklist_items = [
    ('Before the session', [
        'Data: contract, session (RTH/ETH), volume type and delta method confirmed (VP-10).',
        'Yesterday: POC, VAH, VAL, tails, poor highs/lows marked (VP-02, VP-03).',
        'Context: composite value, naked POCs, value migration noted (VP-05).',
        'Liquidity: equal highs/lows and old swing points marked (ch 07).',
        'Scenarios: one bullish and one bearish plan, each with its invalidation, written down.',
    ]),
    ('At the open', [
        'Open location: inside value, outside value inside range, or outside range.',
        'Initial balance size compared with recent days (VP-02).',
        'VWAP position and first range extension (VP-04, VP-06).',
    ]),
    ('At a level', [
        'Is price reaching a level you marked before the session?',
        'Profile: is it building volume there (acceptance) or rejecting it quickly?',
        'Footprint: absorption, exhaustion, imbalances, trapped traders (VP-09)?',
        'Liquidity: is this a sweep of a marked pool (ch 12, VP-11)?',
        'Risk: size and stop from your risk plan, not from the pattern (ch 36).',
    ]),
    ('After the session', [
        'Journal the day type, open location and what each level did.',
        'Screenshot the profile and the footprint at each decision.',
        'Update naked POCs and the value-migration log.',
    ]),
]
n_items = sum(len(v) for _, v in checklist_items)
cl_html = ''.join(
    '<details style="border:1px solid #1e1e22; border-radius:8px; padding:10px 14px; margin:10px 0;"%s>'
    '<summary style="cursor:pointer; font-weight:600;">%s (%d)</summary>'
    '<ol style="margin:10px 0 0 18px; padding:0; list-style:decimal;">%s</ol></details>'
    % (' open' if k == 0 else '', esc(sec), len(items), ''.join('<li style="margin:6px 0;">%s</li>' % esc(i) for i in items))
    for k, (sec, items) in enumerate(checklist_items))

body = [
    '<p>This final chapter pulls the track together. First, three <strong>worked case studies</strong> on illustrative ES sessions, each read '
    'through the profile, the order flow and the liquidity framework together. Then the <strong>playbook</strong>: a %d-point checklist that turns '
    'the whole track into a routine you can follow every session.</p>' % n_items,
    '<p>The cases are hypothetical and built to show the reading process clearly. Real sessions are messier. The point is the questions you ask '
    'and the order you ask them in, not the specific outcomes. Nothing here shows or implies a trading result.</p>',

    '<h3>Case 1: open inside value, a rotation day</h3>',
    '<p><strong>Pre-session map.</strong> Yesterday was D-shaped: POC %s, value area %s to %s. No tails, no poor extremes. Value has overlapped for '
    'two days in a row, so the market is in balance.</p>' % (fmt(POC1), fmt(VAL1), fmt(VAH1)),
    fig_c1,
    '<p><strong>Reading.</strong> The open is inside value, so the first-hour question is whether it stays there. Bar 2 probes toward VAL and bar 3 '
    'closes back up: a responsive buyer at the lower edge. Bars 4 and 5 rotate up to VAH and slightly beyond, and bar 6 turns back. Neither edge is '
    'accepted. On the footprint, a trader would expect to see the extremes of bars 2 and 5 printing on shrinking aggressive volume, the exhaustion '
    'pattern from <a href="chapter.html?ch=VP-09">VP-09</a>.</p>',
    '<p><strong>Lesson.</strong> On a balance day the value-area edges are where responsive trade happens, and the POC is where the market '
    'returns. Initiative trades that bet on a breakout from value are the ones most likely to fail on this kind of day. It is also the kind of day '
    'where doing nothing is often the right call: a rotation inside a range you already mapped offers few clear moments of evidence.</p>',

    '<h3>Case 2: open above the range, acceptance</h3>',
    '<p><strong>Pre-session map.</strong> Same prior profile. Overnight, price moved above yesterday\'s high at %s. The market opens above the '
    'whole prior range.</p>' % fmt(P1[-1]),
    fig_c2,
    '<p><strong>Reading.</strong> An open outside the prior range poses a sharp question: accepted or rejected? The first pullback (bar 3) holds '
    'at %s without getting anywhere near yesterday\'s value. Each later bar makes a higher high and holds a higher low. On the profile, the '
    'developing POC would move up with price, which is value following price. On the footprint, pullbacks would show light selling and '
    'buy imbalances on the way back up. VWAP sits under price all session. Everything points the same way: this is initiative buying being '
    'accepted.</p>' % fmt(c2[2][2]),
    '<p><strong>Lesson.</strong> Case 1 and Case 2 used the same prior profile. What differed was where the market opened and whether the new prices '
    'were accepted. Selling "expensive" prices on a day like this is fading a trend (<a href="chapter.html?ch=VP-04">VP-04</a>). For an SMC trader, '
    'the equivalent read is a bullish daily bias with structure making higher highs and no reason to look for shorts.</p>',

    '<h3>Case 3: a poke through a poor high</h3>',
    '<p><strong>Pre-session map.</strong> Yesterday closed with a poor high at %s: several periods stopped at the same price, with no tail. In core-course '
    'terms, that is a set of equal highs with buy-side liquidity above them (<a href="chapter.html?ch=07">chapter 07</a>).</p>' % fmt(poor_hi),
    fig_c3,
    '<p><strong>Reading.</strong> Bar 1 rallies into the poor high on positive delta (%+d). Bar 2 trades through it by two ticks, and the top rows show '
    'aggressive buying: that is the breakout buying and stop orders being triggered. Then it closes back below the level with delta %+d, and sell '
    'imbalances stack on the way down. The buyers who bought the break are now trapped. Liquidity framework: a sweep of the equal highs. Profile '
    'framework: the poor high has been "repaired", and the auction up there is now finished. Order flow: trapped buyers and selling taking over. '
    'Three methods agree.</p>' % (d_f[0], d_f[1]),
    '<p><strong>Lesson.</strong> This is the combined read from <a href="chapter.html?ch=VP-11">VP-11</a> in its cleanest form. Note what would have '
    'cancelled it: bar 2 closing above the level and bar 3 holding there. That is the condition to write in the plan before the session, and it '
    'is where the risk of the idea is defined.</p>',

    '<h3>The playbook checklist</h3>',
    '<p>Each section opens and closes; the first is open by default. The references point to the chapter that covers each step.</p>',
    cl_html,
    '<p>The checklist is deliberately short. It does not tell you when to trade. It makes sure that when you do, you have looked at the same '
    'things in the same order as last time. That consistency is what makes the journal useful: if you change the process every day, you can\'t '
    'tell whether a result came from the method or from the change.</p>',

    '<h3>Building your own version</h3>',
    '<p>Take this checklist and cut it down to what you actually use. If you trade from the liquidity framework and use the profile only as a filter, '
    'the "at a level" section may be all you need during the session. If you are primarily an order-flow trader, you may add items, such as a '
    'baseline of typical volume per half hour. Put your version at the top of your playbook from the core course '
    '(<a href="chapter.html?ch=34">chapter 34</a>, <a href="chapter.html?ch=35">chapter 35</a>) and review it monthly.</p>',
    '<p>A good test of a checklist item is whether you can answer it with a yes, a no, or a price. "Is the market strong?" fails that test. '
    '"Is price above VWAP?" and "Where is yesterday\'s VAL?" pass it. Items that can\'t be answered quickly get skipped under pressure, so rewrite '
    'them until they can.</p>',

    '<h3>A journal entry template</h3>',
    '<p>The checklist tells you what to look at; the journal records what you saw. A short, consistent entry after each session is enough. This '
    'template mirrors the checklist so the two stay in step.</p>',
    cards(['Field', 'What to write', 'Example (Case 3)'], [
        ['Data setup', 'Contract, session, delta method.', 'ES front month, RTH, exchange bid/ask delta.'],
        ['Prior profile', 'Shape, POC, value area, tails, poor extremes.', 'Poor high at the top of yesterday\'s range.'],
        ['Open location', 'Inside value, outside value, outside range.', 'Inside the prior range, below the poor high.'],
        ['Day type (provisional, then final)', 'From the IB and range extension.', 'Normal variation, then neutral by the close.'],
        ['Levels reached', 'Which marked levels traded and what happened.', 'Poor high: poked through two ticks, closed back below.'],
        ['Order-flow evidence', 'The pattern names from VP-09, or "none".', 'Trapped buyers, stacked sell imbalances.'],
        ['Scenario result', 'Which written scenario played out, if any.', 'Bearish scenario; the cancel condition was never met.'],
        ['Process notes', 'Items skipped, rules broken, questions.', 'Checked VWAP late; move it earlier in the list.'],
    ]),
    '<p>After a month you will have twenty or so entries. Sort them by open location and by day type, and look at what your marked levels did in '
    'each group. That is your own evidence about how these methods behave on your instrument, built from sessions you actually watched. It is '
    'worth far more than any rule of thumb in a book, including this one.</p>',
    '<h3>How the track fits together</h3>',
    '<p>Looking back over the twelve chapters, the track builds one idea at a time.</p>',
    '<ol>'
    '<li><strong>Why price moves</strong> (VP-01): markets auction for value, alternating between balance and imbalance.</li>'
    '<li><strong>Where value is</strong> (VP-02 to VP-06): TPO letters, volume profiles, shapes, day types, composites and VWAP all measure it.</li>'
    '<li><strong>How trades happen</strong> (VP-07 to VP-09): orders, the book, matching, and the footprint patterns that record them.</li>'
    '<li><strong>Whether the data is real</strong> (VP-10): futures volume versus tick volume, and how your platform classifies trades.</li>'
    '<li><strong>How it fits Stryker\'s framework</strong> (VP-11 and this chapter): liquidity, structure and imbalance, checked against value and order flow.</li>'
    '</ol>',
    '<p>If a part feels shaky, go back to its chapter and redo the practice exercises on fresh sessions. The exercises matter more than the reading.</p>',
    '<h3>Common mistakes</h3>',
    '<ul>'
    '<li><strong>Skipping the pre-session map.</strong> Without marked levels, order flow at random prices is noise.</li>'
    '<li><strong>Using every tool every time.</strong> The checklist is a menu with a fixed order, not a requirement to find every pattern.</li>'
    '<li><strong>Letting the pattern set the stop.</strong> Risk comes from your plan and account (<a href="chapter.html?ch=36">chapter 36</a>).</li>'
    '<li><strong>Reviewing only losing days.</strong> Review the process on every day, including the ones you didn\'t trade.</li>'
    '<li><strong>Treating these case studies as templates.</strong> They show a way of reading, not setups that will repeat.</li>'
    '</ul>',

    callout('Key takeaways', '<ul>'
            '<li>The same prior profile can lead to a rotation day or a trend day. The open and acceptance decide which.</li>'
            '<li>The strongest reads come from independent methods agreeing at a level marked in advance.</li>'
            '<li>Every scenario needs a written condition that would prove it wrong.</li>'
            '<li>A short, fixed checklist makes your journal meaningful.</li>'
            '</ul>'),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Find a real ES session that matches each case (rotation inside value, accepted open outside range, failed break of a poor high). Write each '
    'one up in the same format.</li>'
    '<li>Use the checklist for ten sessions in a simulator without taking trades. Note which items you skipped and why.</li>'
    '<li>Cut the checklist down to the ten items you actually use and add it to your playbook.</li>'
    '<li>After twenty sessions, count how often your pre-session scenarios matched what happened and what was different when they didn\'t.</li>'
    '</ol>',

    quiz([
        ('Case 1 and Case 2 had the same prior profile. What made them different?', '<p>Where the market opened and whether the new prices were accepted.</p>'),
        ('In Case 2, what showed acceptance?', '<p>The first pullback held far above prior value, and each bar built higher with value following price.</p>'),
        ('In Case 3, which three methods agreed?', '<p>Liquidity (sweep of equal highs), profile (the poor high repaired, auction finished), and order flow (trapped buyers, sell imbalances).</p>'),
        ('What would have cancelled the Case 3 reading?', '<p>Bar 2 closing above the poor high and the next bar holding there.</p>'),
        ('What makes a good checklist item?', '<p>One you can answer quickly with a yes, a no, or a price.</p>'),
    ]),
]

lessons = [
    ('Case study: rotation inside value', '<p>Read a balance day through value edges, the POC and exhaustion at the extremes.</p>'),
    ('Case study: an accepted open outside the range', '<p>Recognise acceptance through pullbacks, developing POC, VWAP and imbalances.</p>'),
    ('Case study: a failed break of a poor high', '<p>Combine the liquidity, profile and footprint reads, and define what would cancel them.</p>'),
    ('The playbook checklist', '<p>Use the checklist before, during and after the session, and cut it down to your own version.</p>'),
]

src = [
    ('Volume profile indicators: basic concepts - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/'),
    ('Time price opportunity charts explained - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000725590-time-price-opportunity-tpo-chart/'),
    ('Volume Footprint charts: a complete guide - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000726164-volume-footprint-charts-a-complete-guide/'),
    ('Order Flow Volumetric Bars - NinjaTrader 8 Help Guide', 'https://ninjatrader.com/support/helpGuides/nt8/order_flow_volumetric_bars.htm'),
    ('Market profile - Wikipedia', 'https://en.wikipedia.org/wiki/Market_profile'),
    ('Mind Over Markets, Updated Edition (Dalton, Jones, Dalton; Wiley 2013) - further reading', 'https://oreilly.com/library/view/mind-over-markets/9781118659762/f02.html'),
]

write_chapter('vp', 'VP-12', 'Case Studies & the Profile/Order-Flow Playbook', 'advanced', '40 min', lessons, body, src)
