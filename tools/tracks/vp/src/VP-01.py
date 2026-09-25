#!/usr/bin/env python3
"""VP-01 Auction Market Theory: How Markets Find Value."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

TICK = 0.25

# ---------------------------------------------------------------- balance -> imbalance -> new balance (illustrative ES, 30-min bars)
ohlc = [
    # balance around 5,200
    (5200.00, 5202.00, 5198.50, 5201.25), (5201.25, 5202.25, 5199.25, 5199.75), (5199.75, 5201.75, 5198.25, 5201.00),
    (5201.00, 5202.00, 5199.00, 5199.50), (5199.50, 5201.50, 5198.75, 5200.75),
    # imbalance: initiative buying leaves balance
    (5200.75, 5205.50, 5200.50, 5205.25), (5205.25, 5209.75, 5205.00, 5209.25), (5209.25, 5212.50, 5208.75, 5212.00),
    # new balance around 5,212
    (5212.00, 5213.75, 5210.50, 5211.25), (5211.25, 5213.50, 5210.75, 5213.00), (5213.00, 5214.00, 5211.00, 5211.75),
    (5211.75, 5213.25, 5210.75, 5212.50),
]
BAL1 = ohlc[:5]; IMB = ohlc[5:8]; BAL2 = ohlc[8:]
b1_hi = max(b[1] for b in BAL1); b1_lo = min(b[2] for b in BAL1)
b2_hi = max(b[1] for b in BAL2); b2_lo = min(b[2] for b in BAL2)
fig_phases_svg, _ = candles(ohlc, 'Balance, imbalance and a new balance', height=270,
                            zones=[(b1_lo, b1_hi, 'balance 1', TEAL), (b2_lo, b2_hi, 'balance 2', TEAL)],
                            labels=[(6, IMB[1][1], 'imbalance', GOLD, 'above')])
fig_phases = figure(fig_phases_svg, 'Price rotates inside a range (balance), leaves it in a one-directional move (imbalance), '
                    'then starts rotating again at a higher range (a new balance). Balance 1 spans %s to %s; balance 2 spans %s to %s.'
                    % (fmt(b1_lo), fmt(b1_hi), fmt(b2_lo), fmt(b2_hi)))


# ---------------------------------------------------------------- volume profile of the same session, built from the candles
def profile_from_candles(bars, vols):
    """Spread each bar's volume evenly over the ticks it covered."""
    lo = min(b[2] for b in bars); hi = max(b[1] for b in bars)
    n = int(round((hi - lo) / TICK)) + 1
    prices = [lo + TICK * i for i in range(n)]
    acc = [0.0] * n
    for (o, h, l, c), v in zip(bars, vols):
        i0 = int(round((l - lo) / TICK)); i1 = int(round((h - lo) / TICK))
        per = v / float(i1 - i0 + 1)
        for i in range(i0, i1 + 1):
            acc[i] += per
    return prices, [int(round(x)) for x in acc]


bar_vols = [9000, 8200, 8800, 7900, 8500, 14500, 15200, 12800, 9100, 8700, 8300, 8000]
pp, pv = profile_from_candles(ohlc, bar_vols)
# resample to 1-point rows so it is readable on a phone
rows_p = []; rows_v = []
for k in range(0, len(pp), 4):
    rows_p.append(pp[k]); rows_v.append(sum(pv[k:k + 4]))
fig_prof_svg, (poc_i, va_lo_i, va_hi_i) = profile(rows_p, rows_v, 'Session profile of the same bars: two volume nodes with a thin area between', dp=2)
thin_i = min(range(1, len(rows_v) - 1), key=lambda i: rows_v[i] if rows_p[i] > b1_hi and rows_p[i] < b2_lo else 10 ** 9)
fig_prof = figure(fig_prof_svg, 'The same illustrative session as a volume profile with one-point rows. The two balance areas '
                  'become two high-volume nodes; the imbalance leg leaves a thin area around %s. The POC row is %s.'
                  % (fmt(rows_p[thin_i]), fmt(rows_p[poc_i])))

# ---------------------------------------------------------------- initiative vs responsive
fig_ir = figure(boxes([
    ('Initiative buying', ['buying ABOVE value', 'pushes price away'], GREEN),
    ('Initiative selling', ['selling BELOW value', 'pushes price away'], RED),
    ('Responsive buying', ['buying BELOW value', 'brings price back'], TEAL),
    ('Responsive selling', ['selling ABOVE value', 'brings price back'], GOLD),
], 'Initiative and responsive activity relative to value'),
    'Where the trade happens relative to value is what separates initiative from responsive activity. Value here means the prior '
    'value area (see VP-03).', illustrative=False)

# ---------------------------------------------------------------- rotation example with a value area
rot = [(5205.00, 5207.25, 5204.50, 5207.00), (5207.00, 5208.50, 5206.25, 5206.50), (5206.50, 5207.00, 5204.00, 5204.25),
       (5204.25, 5205.00, 5202.75, 5204.75), (5204.75, 5207.50, 5204.50, 5207.25), (5207.25, 5208.75, 5206.75, 5207.00),
       (5207.00, 5207.25, 5203.25, 5203.50), (5203.50, 5205.75, 5203.00, 5205.50)]
VAH, VAL = 5208.00, 5203.50
fig_rot_svg, _ = candles(rot, 'Rotations between the edges of value', height=240,
                         levels=[(VAH, 'VAH', TEAL, '4 3'), (VAL, 'VAL', TEAL, '4 3')])
over = [i for i, b in enumerate(rot) if b[1] > VAH]
under = [i for i, b in enumerate(rot) if b[2] < VAL]
fig_rot = figure(fig_rot_svg, 'Inside balance, price probes past an edge of value and comes back. Here bars %s trade above VAH '
                 'and bars %s trade below VAL, but every bar closes back inside. That is responsive activity doing its job.'
                 % (', '.join(str(i + 1) for i in over), ', '.join(str(i + 1) for i in under)))
assert all(VAL <= b[3] <= VAH for b in rot)

# ---------------------------------------------------------------- timeframe participants table
tf_table = cards(['Participant', 'Horizon', 'What they care about', 'Typical footprint'], [
    ['Day timeframe', 'minutes to one session', 'rotations inside the day\'s range', 'many small trades inside value'],
    ['Other timeframe', 'days to months', 'whether today\'s price is far from their idea of value', 'larger, one-sided moves that shift value'],
])

imb_len = IMB[-1][3] - IMB[0][0]
body = [
    '<p>Every chart you have studied so far shows the result of an auction. Buyers and sellers keep testing prices to find out where '
    'the other side is willing to trade. <strong>Auction market theory</strong> is a way of reading the chart as that search. It '
    'gives you words for what you see: price trying higher, finding no one to sell to, and coming back; or price leaving a range '
    'because a new group of traders turned up. Profile and order-flow tools in this track all sit on top of this idea, so it is the '
    'right place to start.</p>',
    '<p>This is a <strong>framework traders use</strong>, not a scientific law. J. Peter Steidlmayer developed it while trading at the '
    'Chicago Board of Trade, and the exchange released his Market Profile to the public in 1985. James Dalton and co-authors extended it in '
    '<em>Mind Over Markets</em> (listed as further reading below). You don\'t need to accept every claim made for it to find the vocabulary useful.</p>',

    '<h3>The market as a two-way auction</h3>',
    '<p>An <strong>auction</strong> is a process for finding a price at which both sides will trade. In a futures market it runs continuously: '
    'buyers post bids, sellers post offers, and trades happen whenever someone accepts a price that is already on offer. How that '
    'matching works in detail is the subject of <a href="chapter.html?ch=VP-07">VP-07</a>. For now, one idea is enough.</p>',
    '<p>Price moves in order to find trade. When price rises and buyers keep trading with sellers, the move is being accepted. When price '
    'rises and trade dries up, there are no sellers willing to deal at those prices, and no more buyers keen to chase them. The move has '
    'gone too far for now. Market Profile practitioners describe this as the market "advertising" a price: it shows a new price, and '
    'the amount of trade that follows is the response.</p>',
    callout('Price advertises, volume confirms', '<p>A move to new prices on strong, continuing trade is read as <strong>acceptance</strong>. '
            'A move to new prices that quickly stops trading and returns is read as <strong>rejection</strong>. You will see both ideas in '
            'every later chapter.</p>'),

    '<h3>Value: where most trade happens</h3>',
    '<p>In this framework <strong>value</strong> is simply the price range where most of the trading took place over a period. It is not a '
    'fundamental "fair price" for the S&amp;P 500. It is where buyers and sellers were most willing to do business with each other. '
    'Volume and time tell you where that is. The volume profile turns the idea into numbers: the <strong>value area</strong> is the range '
    'holding about 70% of the volume, and the <strong>point of control (POC)</strong> is the single busiest price. <a href="chapter.html?ch=VP-03">VP-03</a> '
    'shows how to compute both.</p>',
    '<p>Prices far above value are expensive in auction terms: fewer people are willing to trade there, so price tends to move quickly and '
    'not stay long. Prices far below value are cheap in the same sense. That is why value edges become reference points. Traders watch '
    'whether price is accepted beyond an edge or rejected back into value.</p>',

    '<h3>Balance and imbalance</h3>',
    '<p>Markets alternate between two states. In <strong>balance</strong>, buyers and sellers broadly agree on value, and price rotates back '
    'and forth inside a range. In <strong>imbalance</strong>, one side is much more aggressive than the other. Price moves in one direction '
    'to find where the other side is willing to trade again, and a new balance forms there.</p>',
    fig_phases,
    '<p>In the illustrative session above the first balance holds between %s and %s for five bars. Then three bars move price up %s points '
    'with almost no overlap between them. That is the imbalance. From bar 9 onward the bars overlap again between %s and %s: a new '
    'balance, higher than the first.</p>' % (fmt(b1_lo), fmt(b1_hi), fmt(imb_len), fmt(b2_lo), fmt(b2_hi)),
    '<p>Seen as a volume profile, the same session looks like two hills with a valley between them. The hills are where the market spent '
    'time and traded a lot (the two balances). The valley is the imbalance leg, where price moved fast and little business was done. '
    'This picture comes up again and again in the track: a thin area on a profile is the fingerprint of an imbalance.</p>',
    fig_prof,
    '<p>This links to what you know from the core course. The trend-and-range chapter (<a href="chapter.html?ch=04">chapter 04</a>) calls '
    'these phases "range" and "trend". Auction theory adds a reason for them, and the profile adds a way to measure them.</p>',

    '<h3>Rotations inside balance</h3>',
    '<p>While a market is balanced, price makes <strong>rotations</strong>: moves from one side of the range to the other. Each rotation probes '
    'an edge. If trade dries up past the edge, price comes back, and the balance is confirmed for now. Traders watch the edges because '
    'that is where the market is testing whether the old value still holds.</p>',
    fig_rot,
    '<p>A breakout from balance is the opposite case. Price moves past the edge, keeps trading there, and the next bars build overlap and '
    'volume beyond it. That is acceptance, and it marks the start of an imbalance move. The difference between a probe that fails and a '
    'breakout that holds is mostly visible in what happens <em>after</em> the edge is crossed, which is why patience at value edges matters.</p>',

    '<h3>Initiative and responsive activity</h3>',
    '<p>Auction theory sorts trading activity by where it happens relative to value. <strong>Initiative</strong> activity trades away from '
    'value: buying above it or selling below it. It is the kind of activity that starts an imbalance. <strong>Responsive</strong> activity '
    'trades back toward value: buying below it, where prices look cheap, or selling above it, where prices look expensive. It is the kind of '
    'activity that keeps a market in balance.</p>',
    fig_ir,
    '<p>Neither is good or bad. While a market stays in balance, probes of an edge come back, which is what balance means. When the initiative '
    'side is larger, value moves. The practical question on any edge test is therefore simple: which side is showing up? Order-flow '
    'tools (<a href="chapter.html?ch=VP-08">VP-08</a> and <a href="chapter.html?ch=VP-09">VP-09</a>) give you a closer look at that question.</p>',

    '<h3>Day timeframe and other timeframe participants</h3>',
    '<p>Dalton\'s work popularised a second useful split: who is trading. <strong>Day timeframe</strong> participants trade within the '
    'session and are flat by the close. <strong>Other timeframe</strong> participants hold positions for days, weeks or longer. The day '
    'timeframe creates most of the back-and-forth. The other timeframe, when it arrives with size, is what moves value.</p>',
    tf_table,
    '<p>You cannot see who is on the other side of your trade. What you can see is the footprint of their behaviour: a range that keeps '
    'rotating suggests mostly day-timeframe business, while a sustained, one-directional move that builds new value suggests other '
    'timeframe activity. Treat this as an interpretation of the chart, never as a fact about who traded.</p>',

    '<h3>Worked example: reading the illustrative session</h3>',
    '<ol>'
    '<li><strong>Bars 1 to 5:</strong> balance between %s and %s. Every probe of an edge comes back. Responsive activity dominates.</li>'
    '<li><strong>Bar 6:</strong> price closes at %s, above the balance high. That is initiative buying above value. The question is acceptance.</li>'
    '<li><strong>Bars 7 and 8:</strong> price keeps trading higher with little overlap, and volume per bar is higher than during the balance '
    '(illustrative volumes {:,} and {:,} against about 8,000 to 9,000). The move is being accepted.</li>'
    '<li><strong>Bars 9 to 12:</strong> overlap returns between %s and %s. A new balance has formed higher. The old balance high at %s '
    'becomes a reference for later: if price returns there, traders will watch whether it is accepted back inside the old value or rejected.</li>'
    '</ol>'.format(bar_vols[6], bar_vols[7]) % (fmt(b1_lo), fmt(b1_hi), fmt(ohlc[5][3]), fmt(b2_lo), fmt(b2_hi), fmt(b1_hi)),

    '<h3>Common mistakes</h3>',
    '<ul>'
    '<li><strong>Treating value as a fundamental fair price.</strong> In this framework value only means where trade happened. It moves '
    'every day.</li>'
    '<li><strong>Calling every edge touch a breakout.</strong> A probe past an edge is only initiative activity if it is accepted. Wait for '
    'trade to build beyond the edge.</li>'
    '<li><strong>Fading every move back to value.</strong> Responsive trading works while the market is balanced. In an imbalance, price can '
    'keep going far past what looks "expensive".</li>'
    '<li><strong>Claiming to know who is trading.</strong> "Other timeframe buyer" is a reading of behaviour, not information about '
    'identities.</li>'
    '<li><strong>Using theory instead of risk rules.</strong> Auction concepts help you choose where to act. Stops and position size still '
    'come from your risk plan (<a href="chapter.html?ch=36">chapter 36</a>).</li>'
    '</ul>',

    callout('Key takeaways', '<ul>'
            '<li>Auction market theory reads price as a search for the level where both sides will trade.</li>'
            '<li>Value is where most trade happened. The value area and POC measure it.</li>'
            '<li>Markets alternate between balance (rotation) and imbalance (one-directional search for new value).</li>'
            '<li>Initiative activity trades away from value; responsive activity trades back toward it.</li>'
            '<li>Acceptance (continued trade) and rejection (a quick return) are what you watch at every edge.</li>'
            '</ul>'),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>On a 30-minute ES chart, mark the last five days as "balance" or "imbalance". Write one sentence per day on what made you choose.</li>'
    '<li>Find one clear balance range. Count how many times price probed each edge and came back before the range broke.</li>'
    '<li>For the breakout that ended that range, describe the first two bars after the edge was crossed: overlapping or not, and '
    'did price trade back inside the old range?</li>'
    '<li>Add a session volume profile to the same days. Check that each balance shows up as a volume node and each imbalance as a thin area.</li>'
    '</ol>',

    quiz([
        ('What does "value" mean in auction market theory?',
         '<p>The price range where most of the trading took place over a period, measured by time and volume. It is not a fundamental fair price.</p>'),
        ('What is the difference between balance and imbalance?',
         '<p>In balance, price rotates inside a range because both sides broadly agree on value. In imbalance, one side is more aggressive and '
         'price moves in one direction to find a new area where the other side will trade.</p>'),
        ('Is selling above value initiative or responsive?',
         '<p>Responsive. It trades back toward value from a price that looks expensive. Initiative selling happens below value.</p>'),
        ('Price moves above the value area high. What would you want to see to call that acceptance?',
         '<p>Continued trading above the edge, with overlapping bars and volume building there, rather than a quick return inside value.</p>'),
        ('Why does an imbalance leg show up as a thin area on a volume profile?',
         '<p>Price moved quickly through those prices in one direction, so little time was spent and little volume traded there.</p>'),
    ]),
]

lessons = [
    ('The market as a two-way auction',
     '<p>Watch the first 30 minutes of one ES session on a 1-minute chart. Note two moments where price tried a new level and trading dried up, '
     'and one where it kept trading. Label them "rejected" or "accepted".</p>'),
    ('Balance and imbalance',
     '<p>Mark the last ten sessions on a 30-minute chart as balance or imbalance days. Next to each, write the range of the balance or the '
     'direction of the imbalance. This becomes the starting data for your day-type work in VP-04.</p>'),
    ('Rotations and edges',
     '<p>Pick one balanced session. Draw its high and low after the first hour and count the rotations between them. Record whether the final '
     'break of the range was accepted or rejected.</p>'),
    ('Initiative vs responsive activity',
     '<p>Using yesterday\'s value area, classify three moves from today as initiative buying, initiative selling, responsive buying or responsive '
     'selling. Write the price where each one happened and why you classified it that way.</p>'),
    ('Timeframe participants',
     '<p>Find one day where value moved clearly higher or lower than the day before. Describe the move as other-timeframe activity would '
     'look, and list the evidence on the chart. Keep it to what you can actually see.</p>'),
]

src = [
    ('Market profile (history: Steidlmayer, CBOT, 1985) - Wikipedia', 'https://en.wikipedia.org/wiki/Market_profile'),
    ('Volume profile indicators: basic concepts - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/'),
    ('Supported Matching Algorithms (how resting and aggressing orders trade) - CME Group Client Systems Wiki', 'https://cmegroupclientsite.atlassian.net/wiki/spaces/EPICSANDBOX/pages/457218479/Supported+Matching+Algorithms'),
    ('Time price opportunity charts explained - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000725590-time-price-opportunity-tpo-chart/'),
    ('Mind Over Markets, Updated Edition (Dalton, Jones, Dalton; Wiley 2013) - further reading', 'https://oreilly.com/library/view/mind-over-markets/9781118659762/f02.html'),
    ('Markets and Market Logic (Steidlmayer, Koy; 1986) - further reading', 'https://books.google.com/books/about/Markets_and_Market_Logic.html?id=Lb9FPQAACAAJ'),
]

write_chapter('vp', 'VP-01', 'Auction Market Theory: How Markets Find Value', 'foundation', '30 min', lessons, body, src)
