#!/usr/bin/env python3
"""VP-05 Session, Composite & Fixed-Range Profiles."""
import os, sys, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

P = [5200.0 + i for i in range(20)]   # 1-point rows


def bell(c, w, peak, base=10):
    return [int(round(base + peak * math.exp(-((i - c) / w) ** 2))) for i in range(len(P))]


# three illustrative sessions (volume per 1-point row)
days = [
    ('Mon', bell(6, 2.4, 900)),
    ('Tue', bell(9, 2.6, 1000)),
    ('Wed', bell(12, 2.3, 950)),
]
day_info = []
for name, v in days:
    poc, lo, hi = value_area(P, v)
    day_info.append((name, P[poc], P[lo], P[hi], sum(v)))
comp = [sum(v[i] for _, v in days) for i in range(len(P))]
cpoc, clo, chi = value_area(P, comp)


def side_by_side():
    """Three session profiles next to each other plus the composite, drawn on one price axis."""
    row_h = 14; top = 24; n = len(P); h = top + n * row_h + 30
    o = []
    left = 60; colw = 70
    maxv = float(max(max(v) for _, v in days))
    cmax = float(max(comp))
    for i in range(n):
        y = top + (n - 1 - i) * row_h
        if i % 2 == 0:
            o.append(text(left - 6, y + 11, fmt(P[i], 0), 13, MUTED, 'end'))
    for j, (name, v) in enumerate(days):
        x = left + j * (colw + 8)
        poc, lo, hi = value_area(P, v)
        o.append(text(x + colw / 2, 16, name, 13, INK, 'middle'))
        o.append(rect(x - 2, top + (n - 1 - hi) * row_h, colw + 2, (hi - lo + 1) * row_h, fill=TEAL, opacity=0.08))
        for i in range(n):
            y = top + (n - 1 - i) * row_h
            o.append(rect(x, y + 2, v[i] / maxv * colw, row_h - 4, fill=GOLD if i == poc else TEAL, opacity=0.9 if i == poc else 0.6, rx=1))
    x = left + 3 * (colw + 8) + 4
    o.append(text(x + 30, 16, 'composite', 13, GOLD, 'middle'))
    o.append(rect(x - 2, top + (n - 1 - chi) * row_h, 64, (chi - clo + 1) * row_h, fill=GOLD, opacity=0.08))
    for i in range(n):
        y = top + (n - 1 - i) * row_h
        o.append(rect(x, y + 2, comp[i] / cmax * 60, row_h - 4, fill=GOLD if i == cpoc else MUTED, opacity=0.9 if i == cpoc else 0.6, rx=1))
    o.append(text(200, h - 8, 'shaded band = each profile\'s 70% value area', 13, MUTED, 'middle'))
    return svg(h, o, 'Three session profiles and their composite')


fig_comp = figure(side_by_side(), 'Monday POC %s, Tuesday %s, Wednesday %s. Added together, the three-day composite has its POC at %s '
                  'and value from %s to %s: a wider, blended picture of where the market has been doing business.'
                  % (fmt(day_info[0][1], 0), fmt(day_info[1][1], 0), fmt(day_info[2][1], 0), fmt(P[cpoc], 0), fmt(P[clo], 0), fmt(P[chi], 0)))

# ---------------------------------------------------------------- value migration over 5 days
vm = [('D1', 5204, 5209, 5206), ('D2', 5206, 5211, 5209), ('D3', 5212, 5215, 5213), ('D4', 5213, 5217, 5215), ('D5', 5211, 5216, 5213)]


def migration_label(prev, cur):
    _, pl, ph, _ = prev; _, cl, ch, _ = cur
    if cl > ph: return 'higher (no overlap)'
    if ch < pl: return 'lower (no overlap)'
    if cl > pl and ch > ph: return 'overlapping-higher'
    if cl < pl and ch < ph: return 'overlapping-lower'
    return 'overlapping'


def migration_fig():
    Y = YScale(5202, 5218, 20, 230); h = 262; o = []
    step = 300 / len(vm)
    for k, (d, lo, hi, poc) in enumerate(vm):
        x = 30 + k * step
        o.append(rect(x, Y(hi), step - 16, Y(lo) - Y(hi), fill=TEAL, opacity=0.25, stroke=TEAL, rx=3))
        o.append(line(x, Y(poc), x + step - 16, Y(poc), GOLD, 2))
        o.append(text(x + (step - 16) / 2, h - 10, d, 13, MUTED, 'middle'))
    for p in (5204, 5210, 5216):
        o.append(text(372, Y(p) + 5, fmt(p, 0), 13, MUTED, 'end'))
    return svg(h, o, 'Value areas over five sessions')


_ml = [migration_label(vm[k - 1], vm[k]) for k in range(1, len(vm))]
assert _ml == ['overlapping-higher', 'higher (no overlap)', 'overlapping-higher', 'overlapping-lower'], _ml
mig_rows = [[vm[k][0], '%s to %s' % (fmt(vm[k][1], 0), fmt(vm[k][2], 0)), fmt(vm[k][3], 0),
             migration_label(vm[k - 1], vm[k]) if k else '-'] for k in range(len(vm))]
fig_mig = figure(migration_fig(), 'Each box is one session\'s value area; the gold line is its POC. Value climbs for three days, then D5 '
                 'overlaps lower: the first sign the market is questioning the higher prices.')
mig_table = table(['Day', 'Value area', 'POC', 'vs previous day'], mig_rows)

# ---------------------------------------------------------------- naked POC
prior_poc = 5206.50
ohlc = [(5210.00, 5212.25, 5209.25, 5211.50), (5211.50, 5213.00, 5210.00, 5210.50), (5210.50, 5211.00, 5208.50, 5209.00),
        (5209.00, 5210.25, 5207.75, 5208.25), (5208.25, 5209.00, 5207.00, 5208.75), (5208.75, 5210.50, 5208.25, 5210.00),
        (5210.00, 5210.75, 5207.50, 5207.75), (5207.75, 5208.00, 5206.25, 5206.75), (5206.75, 5208.75, 5206.50, 5208.50)]
first_touch = next(i for i, b in enumerate(ohlc) if b[2] <= prior_poc <= b[1])
assert all(b[2] > prior_poc for b in ohlc[:first_touch])
fig_naked_svg, _ = candles(ohlc, 'A naked POC from a prior session', lo=5205.5, hi=5213.5, height=240,
                           levels=[(prior_poc, 'naked POC', GOLD, '5 4')],
                           labels=[(first_touch, ohlc[first_touch][2], 'touched', GOLD, 'below')])
fig_naked = figure(fig_naked_svg, 'The prior session\'s POC at %s had not been traded since it formed. Bars 1 to %d stay above it; '
                   'bar %d trades down through it, and from then on it is no longer "naked".' % (fmt(prior_poc), first_touch, first_touch + 1))

# ---------------------------------------------------------------- open location table
open_table = cards(['Where today opens', 'What it says in auction terms', 'What profile traders watch'], [
    ['Inside prior value', 'The market still broadly accepts yesterday\'s value.', 'Rotation inside value; responsive trade at the edges.'],
    ['Outside value, inside prior range', 'Some move away from value, but not beyond yesterday\'s extremes.', 'Whether price returns into value in the first hour, or builds outside it.'],
    ['Outside the prior range', 'The overnight session moved beyond everything yesterday traded.', 'Whether the gap is accepted (holds, builds volume) or rejected (fills back).'],
])

# ---------------------------------------------------------------- body
body = [
    '<p>A profile is only as useful as the period it covers. The same week of ES can give you five different POCs depending on whether you '
    'build one profile per session, one profile for the whole week, or one profile from a swing low you picked yourself. This chapter covers '
    'the main profile types, when each is useful, and three ideas that only make sense once you compare profiles over time: '
    '<strong>naked POCs</strong>, <strong>value migration</strong>, and the <strong>open relative to prior value</strong>.</p>',

    '<h3>Session profiles, and which session</h3>',
    '<p>A <strong>session profile</strong> covers one trading session. TradingView\'s Session Volume Profile, for example, calculates volume within a '
    'specified session or sub-session. For ES the question is <em>which</em> session. CME Globex trades almost around the clock on weekdays, '
    'but the cash stock market that ES tracks opens at 9:30 a.m. New York time. Profile traders usually build one profile for the regular '
    'trading hours (<strong>RTH</strong>) and treat the overnight Globex session (<strong>ETH</strong>, extended hours) separately.</p>',
    '<p>The two can look very different. Overnight trade is generally thinner, so an overnight POC is built on less volume. Many traders '
    'mark the overnight high, low and POC as reference levels, then build the day\'s profile from the cash open. Whichever you choose, choose '
    'once and write it into your playbook. Levels from mixed sessions don\'t line up.</p>',

    '<h3>Composite profiles</h3>',
    '<p>A <strong>composite profile</strong> merges several sessions into one, by adding the volume at each price across all of them. It shows '
    'where the market has done business over days or weeks, which is the context for any single session. Practitioners use weekly and '
    'monthly composites to find the larger value areas and high- and low-volume nodes that a single day cannot show.</p>',
    fig_comp,
    '<p>Notice that the composite POC (%s) is not simply the average of the three daily POCs. It is wherever the combined volume is highest. '
    'A composite also smooths away one-day spikes, which is exactly what you want for context and exactly what you don\'t want for '
    'intraday timing.</p>' % fmt(P[cpoc], 0),

    '<h3>Fixed-range, visible-range and developing profiles</h3>',
    '<p>A <strong>fixed-range profile</strong> covers a time span you choose: from a swing low to a swing high, from a news release to now, or '
    'across a consolidation. TradingView\'s Fixed Range Volume Profile describes it as calculating volume within a user-specified range. It is '
    'the natural tool for SMC traders: anchor it to the start of the displacement leg you are studying, and the profile tells you where that '
    'leg actually did business.</p>',
    '<p>A <strong>visible-range profile</strong> covers whatever bars are on your screen. It is handy for a quick look, but the POC and value area '
    'change every time you scroll or zoom. Never record a level from it unless you also note the exact range it was built from.</p>',
    '<p>A <strong>developing profile</strong> is the current session\'s profile as it forms. Many platforms plot the <strong>developing POC</strong> '
    'as a line that moves bar by bar. Watching it shift tells you whether value is following price (acceptance) or staying behind (a sign that '
    'the move is not yet being accepted), which is the auction question from <a href="chapter.html?ch=VP-01">VP-01</a> in real time.</p>',

    '<h3>Naked (virgin) POCs</h3>',
    '<p>A <strong>naked POC</strong> (also called a virgin POC) is a prior session\'s POC that price has not traded at since that session ended. '
    'Profile traders keep a list of them, because a price that was once the busiest level of a session and has never been revisited is a '
    'natural reference if price comes back.</p>',
    fig_naked,
    '<p>The common reading is that a naked POC can act as a magnet or a reaction point. That is a tendency traders watch for, not a rule: '
    'plenty of naked POCs stay naked for a long time, and plenty get run through without a pause. Treat them as levels to be ready at, the '
    'same way the core course treats old highs and lows as liquidity (<a href="chapter.html?ch=07">chapter 07</a>).</p>',

    '<h3>Value migration</h3>',
    '<p><strong>Value migration</strong> means comparing each session\'s value area with the one before. Value can be <strong>higher</strong> '
    '(today\'s value area entirely above yesterday\'s), <strong>lower</strong>, or <strong>overlapping</strong>, and overlapping can lean higher '
    'or lower. It is one of the simplest trend tools there is: a string of higher value areas is an uptrend in auction terms, even if individual '
    'candles look choppy.</p>',
    fig_mig,
    mig_table,
    '<p>Read the table from top to bottom. D2 and D4 overlap higher; D3 is fully higher; D5 overlaps lower, the first day value did not keep '
    'up with price. That kind of change is what profile traders look for before they treat a trend as tiring. It pairs naturally with the '
    'structure tools in the core course: a change of character on the chart (<a href="chapter.html?ch=08">chapter 08</a>) that is followed by '
    'value migrating the other way is a stronger shift than either one alone.</p>',

    '<h3>The open relative to prior value</h3>',
    '<p>Where today opens compared with yesterday\'s value area and range is one of the first things profile traders note each morning. There '
    'are three broad cases.</p>',
    open_table,
    '<p>One popular heuristic built on this is often called the <strong>"80% rule"</strong>: if price opens outside the prior value area, trades '
    'back inside it, and stays inside for two consecutive 30-minute periods, traders look for price to travel across value to the other side. '
    'The name is a label handed down in trading education. I could not find a published, verifiable test that supports the 80% figure, so treat '
    'the name as a name, not a statistic, and test the idea on your own data before you rely on it.</p>',

    '<h3>Which profile for which job</h3>',
    '<p>With so many profile types it is easy to stack all of them on one chart and end up with a wall of lines. A simpler approach is to give '
    'each type a single job and only look at it for that job.</p>',
    cards(['Profile', 'Job', 'When you look at it'], [
        ['Monthly or weekly composite', 'The big map: major value areas, HVNs and LVNs.', 'Once a week, when you plan.'],
        ['Prior session profile', 'Yesterday\'s POC, VAH, VAL, tails and poor highs or lows.', 'Every morning before the open.'],
        ['Overnight (ETH) profile', 'Where the market traded while the cash market was closed.', 'Just before the cash open.'],
        ['Developing session profile', 'Whether value is following price today.', 'During the session.'],
        ['Fixed-range profile', 'Where one specific leg or range did its business.', 'When you are studying a setup.'],
    ]),
    '<p>Five profile types, five jobs. If a level from one of them does not answer a question you are actually asking, take it off the chart. '
    'A clean chart with four or five levels you understand beats a crowded one where every price is "support" of some kind. This is the same '
    'discipline the core course asks for with liquidity levels and higher-timeframe zones: fewer, better levels, each with a reason to be there.</p>',
    '<h3>Worked example: building the week\'s map</h3>',
    '<ol>'
    '<li><strong>Composite.</strong> Build a composite of the last three sessions. In the illustrative data: POC %s, value %s to %s.</li>'
    '<li><strong>Yesterday.</strong> Mark yesterday\'s (Wednesday\'s) session POC %s and value %s to %s.</li>'
    '<li><strong>Naked POCs.</strong> Monday\'s POC at %s: has price traded there since? If not, add it to the list.</li>'
    '<li><strong>Migration.</strong> Monday to Wednesday, value moved from around %s to around %s: value higher.</li>'
    '<li><strong>The open.</strong> Suppose Thursday opens at %s, below Wednesday\'s VAL but inside its range. The first-hour question is whether '
    'price gets back into Wednesday\'s value or builds below it.</li>'
    '</ol>' % (fmt(P[cpoc], 0), fmt(P[clo], 0), fmt(P[chi], 0), fmt(day_info[2][1], 0), fmt(day_info[2][2], 0), fmt(day_info[2][3], 0),
               fmt(day_info[0][1], 0), fmt(day_info[0][1], 0), fmt(day_info[2][1], 0), fmt(day_info[2][2] - 1, 0)),
    '<p>That list is the whole pre-session map: a handful of prices, each with a question attached. It takes a few minutes and it means you '
    'are never surprised by where the market is trading.</p>',

    '<h3>Common mistakes</h3>',
    '<ul>'
    '<li><strong>Mixing RTH and overnight data</strong> without knowing which one your platform uses.</li>'
    '<li><strong>Trusting visible-range levels.</strong> They change as you scroll.</li>'
    '<li><strong>Using composites for timing.</strong> A composite is context. Entries need the current session.</li>'
    '<li><strong>Treating naked POCs as targets that must be hit.</strong> They are reference levels, nothing more.</li>'
    '<li><strong>Quoting the "80% rule" as a fact.</strong> It is a heuristic with a catchy name.</li>'
    '</ul>',

    callout('Key takeaways', '<ul>'
            '<li>Session profiles show one session; composites show context over several; fixed-range profiles show a leg you choose.</li>'
            '<li>Decide RTH or overnight once, and keep it.</li>'
            '<li>Naked POCs are prior POCs not yet revisited: reference levels, not magnets you can count on.</li>'
            '<li>Value migration (higher, lower, overlapping) is an auction-based trend read.</li>'
            '<li>The open relative to prior value sets the first question of the day.</li>'
            '</ul>'),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Build a five-day composite on ES. Compare its POC with each day\'s POC and note which day contributed most.</li>'
    '<li>Keep a running list of naked POCs for two weeks. Record when each one is first traded and what price did there.</li>'
    '<li>Fill in a value-migration table like the one above for the last ten sessions.</li>'
    '<li>Log the open location (inside value, outside value inside range, outside range) for ten sessions, with what happened in the first hour.</li>'
    '</ol>',

    quiz([
        ('Why can a composite POC differ from every daily POC?',
         '<p>Because it is the price with the most volume after adding all the sessions together, which need not be any single day\'s busiest price.</p>'),
        ('What is the risk with a visible-range profile?',
         '<p>Its levels change whenever you scroll or zoom, so they are not reproducible unless you record the exact range.</p>'),
        ('What makes a POC "naked"?',
         '<p>Price has not traded at it since the session that created it ended.</p>'),
        ('Today\'s value area sits entirely above yesterday\'s. What is that called?',
         '<p>Value higher: a clear upward migration of value.</p>'),
        ('How should you treat the "80% rule"?',
         '<p>As a practitioner heuristic with a label, not a verified statistic. Test it on your own data.</p>'),
    ]),
]

lessons = [
    ('Choosing the session', '<p>Build RTH and overnight profiles for the same three days on ES. Note how far apart the POCs are, then decide which you will use and write the setting into your playbook.</p>'),
    ('Composite profiles', '<p>Build a five-day and a twenty-day composite. Mark the HVNs and LVNs on each and compare them with the current session.</p>'),
    ('Fixed-range profiles on a displacement leg', '<p>Pick a recent displacement leg that created a fair value gap. Anchor a fixed-range profile to it and note where its POC sits relative to the gap.</p>'),
    ('Naked POC tracker', '<p>Start a naked-POC list in your journal. Each morning, add yesterday\'s POC if it is untouched and strike out any that were traded.</p>'),
    ('Value migration log', '<p>Log each day\'s value area and POC, and label migration versus the prior day. After two weeks, compare the labels with the trend you see on the daily chart.</p>'),
]

src = [
    ('Session Volume Profile - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000703072-session-volume-profile/'),
    ('Fixed Range Volume Profile indicator - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000480324-fixed-range-volume-profile-indicator/'),
    ('Volume profile indicators: basic concepts (profile types) - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/'),
    ('Gold Futures contract specs (CME Globex near-24-hour trading schedule) - CME Group', 'https://www.cmegroup.com/markets/metals/precious/gold.contractSpecs.html'),
    ('TPO Profile Charts (opening range and extension settings) - Sierra Chart', 'https://www.sierrachart.com/index.php?page=doc/StudiesReference/TimePriceOpportunityCharts.html'),
    ('Mind Over Markets, Updated Edition (Dalton, Jones, Dalton; Wiley 2013) - further reading', 'https://oreilly.com/library/view/mind-over-markets/9781118659762/f02.html'),
]

write_chapter('vp', 'VP-05', 'Session, Composite & Fixed-Range Profiles', 'intermediate', '35 min', lessons, body, src)
