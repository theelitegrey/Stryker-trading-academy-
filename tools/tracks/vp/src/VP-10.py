#!/usr/bin/env python3
"""VP-10 Data & Tools: Futures, FX Tick Volume & Platforms."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

# ---------------------------------------------------------------- centralised vs OTC diagram
def market_structure():
    o = []; h = 250
    # left: exchange
    o.append(text(100, 18, 'Futures (CME Globex)', 13, GREEN, 'middle', 'bold'))
    o.append(rect(55, 100, 90, 44, stroke=GREEN, fill=GREEN, opacity=0.12, rx=6))
    o.append(text(100, 118, 'one order', 13, INK, 'middle')); o.append(text(100, 134, 'book', 13, INK, 'middle'))
    for k, y in enumerate((40, 76, 168, 204)):
        x = 20 if k % 2 == 0 else 150
        o.append(rect(x, y, 30, 22, stroke=MUTED, rx=3))
        o.append(line(x + 15, y + (22 if y < 100 else 0), 100, 100 if y < 100 else 144, MUTED, 1))
    o.append(text(100, 240, 'every trade, one tape', 13, GREEN, 'middle'))
    # right: OTC
    o.append(text(300, 18, 'Spot FX (OTC)', 13, GOLD, 'middle', 'bold'))
    venues = [(250, 60), (350, 60), (230, 130), (370, 130), (300, 190)]
    for x, y in venues:
        o.append(rect(x - 24, y - 14, 48, 28, stroke=GOLD, fill=GOLD, opacity=0.1, rx=5))
        o.append(text(x, y + 5, 'venue', 13, INK, 'middle'))
    for i in range(len(venues)):
        for j in range(i + 1, len(venues)):
            (x1, y1), (x2, y2) = venues[i], venues[j]
            o.append(line(x1, y1, x2, y2, GRID, 1, '3 3'))
    o.append(text(300, 240, 'no single tape', 13, GOLD, 'middle'))
    o.append(line(200, 30, 200, 225, LINE, 1))
    return svg(h, o, 'Centralised futures book versus fragmented spot FX')


fig_struct = figure(market_structure(), 'Left: every CME futures trade goes through one central order book, so one data feed sees all of it. '
                    'Right: spot FX trades over the counter across many banks, brokers and platforms, so no single feed sees the whole market.',
                    illustrative=False)

# ---------------------------------------------------------------- tick volume vs real volume (illustrative)
real = [820, 1450, 2300, 1100, 900, 3100, 1250, 700, 950, 2600]
ticks = [310, 520, 690, 460, 380, 820, 470, 300, 390, 640]
n = len(real)
# rank agreement: count bars where both are above their own median
med_r = sorted(real)[n // 2]; med_t = sorted(ticks)[n // 2]
agree = sum((r > med_r) == (t > med_t) for r, t in zip(real, ticks))
ratio = [r / t for r, t in zip(real, ticks)]
rmax = max(real); tmax = max(ticks)
tv_svg, _ = series([([v / rmax * 100 for v in real], GREEN, 'real'), ([v / tmax * 100 for v in ticks], GOLD, 'ticks')],
                   'Real volume and tick count, scaled to their own maximum', height=190, dp=0)
fig_tick = figure(tv_svg, 'Illustrative data. Both series are scaled so their largest bar = 100. They rise and fall together on '
                  '%d of %d bars, but the size of the moves differs: contracts per tick range from %.1f to %.1f. Tick volume shows '
                  'activity, not size.' % (agree, n, min(ratio), max(ratio)))
assert agree >= 8 and max(ratio) / min(ratio) > 1.5

# ---------------------------------------------------------------- contract table
spec_table = table(['Contract', 'Size', 'Tick', 'Tick value'], [
    ['ES', '$50 x S&P 500', '0.25', '$12.50'], ['NQ', '$20 x Nasdaq-100', '0.25', '$5.00'],
    ['MES / MNQ', '$5 / $2 x index', '0.25', '$1.25 / $0.50'], ['GC', '100 troy oz', '$0.10', '$10.00'],
    ['CL', '1,000 barrels', '$0.01', '$10.00'], ['6E', 'EUR/USD future', 'see CME spec', '-'],
])

# ---------------------------------------------------------------- platform table (neutral)
plat = cards(['Platform', 'Footprint / order flow', 'Volume profile / TPO', 'Notes from its own documentation'], [
    ['Sierra Chart', 'Numbers Bars (bid x ask, delta, cumulative delta).', 'Volume by Price; TPO profile charts.', 'Numbers Bars need only best bid/ask with each trade, not full depth.'],
    ['NinjaTrader 8', 'Order Flow Volumetric Bars (imbalances, delta, cumulative delta).', 'Volume profile tools.', 'Imbalance compared diagonally; default ratio 1.5.'],
    ['ATAS', 'Cluster (footprint) charts; imbalance settings.', 'Volume profile tools.', 'Default imbalance 200%, strong 400%, adjustable.'],
    ['Bookmap', 'Order-book heatmap and trade bubbles; add-ons for icebergs and stops.', 'Volume profile add-ons.', 'Iceberg detection works only from CME MBO data.'],
    ['TradingView', 'Volume Footprint (on paid plans).', 'Session, fixed-range, visible-range profiles; TPO.', 'Footprint classifies buys/sells from intrabar price moves, not exchange aggressor tags.'],
])

body = [
    '<p>Everything in this track depends on the <strong>data</strong>. A volume profile is only as good as the volume it counts, and a footprint '
    'only as good as its record of who was the aggressor. This chapter explains where real volume comes from, why spot forex doesn\'t have it, '
    'what tick volume is and isn\'t, and what the main platforms say about how they build their order-flow tools. It stays neutral: Stryker has no '
    'affiliate relationship with any platform named here, and nothing below is a recommendation to buy one.</p>',

    '<h3>Why futures have real volume</h3>',
    '<p>A futures contract like ES trades on one exchange, CME Globex, through one central order book. Every order and every trade passes through '
    'the same matching engine (<a href="chapter.html?ch=VP-07">VP-07</a>). That means the exchange\'s data feed is a complete record: every '
    'contract traded, at what price, and whether it hit the bid or lifted the ask. CME\'s market-by-order feed goes further, showing each individual '
    'resting order, anonymously. That completeness is what makes volume profile and footprint analysis meaningful on futures.</p>',
    fig_struct,

    '<h3>Why spot FX doesn\'t</h3>',
    '<p>Spot forex is an <strong>over-the-counter (OTC)</strong> market. There is no central exchange. Trades happen between banks, brokers, electronic '
    'platforms and their clients across the world. The Bank for International Settlements\' triennial survey measured global FX trading at '
    'about <strong>$7.5 trillion a day</strong> in April 2022, and that figure comes from a survey of dealers, not from a tape. No single feed sees '
    'all of it.</p>',
    '<p>So when your forex broker\'s chart shows a "volume" bar, it can\'t be the market\'s volume. It is usually one of two things: the broker\'s own '
    'trade count, or <strong>tick volume</strong>.</p>',

    '<h3>Tick volume: what it is and isn\'t</h3>',
    '<p><strong>Tick volume</strong> counts how many times the price changed during a bar, not how many contracts or units traded. It is a measure of '
    'activity. Busy periods produce more price changes, so tick volume often rises and falls with real activity. That is why some traders use it '
    'as a stand-in.</p>',
    fig_tick,
    '<p>The problem is size. A tick that moved price after one small order and a tick that moved it after a huge one count the same. The illustrative '
    'data shows the typical pattern: the direction of the two series mostly agrees, but the proportions don\'t. A volume profile built from tick '
    'volume shows where price <em>changed</em> most often, which is not the same thing as where the most business was done. Footprints and '
    'delta built from spot FX quotes have the same weakness and can\'t know who was the aggressor.</p>',
    '<p>The practical answer for FX traders is to use the <strong>currency futures</strong> instead. CME lists Euro FX futures (6E) and other currency '
    'futures with exchange-reported volume. Many traders build their EUR/USD profile on 6E and apply the levels to spot, accepting that the prices '
    'differ slightly (futures include the interest-rate difference between the two currencies). The same logic applies to gold: GC futures have '
    'real volume; spot XAU/USD from a CFD broker does not.</p>',

    '<h3>The contracts this track uses</h3>',
    '<p>From CME\'s contract specifications and Micro E-mini FAQ:</p>',
    spec_table,
    '<p>Micro contracts (MES, MNQ) share their big brothers\' prices and ticks but are one tenth the size. Their volume is separate, so a profile '
    'built on MES shows MES volume only. Most order-flow traders read the full-size contract (ES, NQ) for the data, even if they trade the micro.</p>',

    '<h3>Contract months and rolls</h3>',
    '<p>Futures expire. ES and NQ are quarterly (March, June, September, December). CME\'s roll-date page says the customary roll is the Monday '
    'before the third Friday of the expiry month, and that after it the next contract becomes the "lead month" because the expiring one grows '
    'less liquid. For 2026 the U.S. index roll dates are 16 March, 15 June, 14 September and 14 December.</p>',
    '<p>This matters for profiles. Around the roll, volume moves from one contract to the other, so a composite that mixes the two months, or a '
    'continuous chart that splices them, can show a volume shelf that is really just the roll. Continuous contracts may also be <strong>back-adjusted</strong> '
    'to remove the price gap between months, which moves every historic level. When you carry levels across a roll, check which method your '
    'platform uses.</p>',

    '<h3>The platforms, in their own words</h3>',
    '<p>The table below summarises what each platform\'s own documentation says about its order-flow and profile tools. Features and prices change, '
    'and several need a paid data feed or subscription for real-time futures data, so check the current details yourself.</p>',
    plat,
    '<p>Two differences matter most. The first is <strong>how buys and sells are classified</strong>. Tools that use the exchange\'s bid and ask at '
    'the time of each trade (Sierra Chart, NinjaTrader, ATAS, Bookmap on futures feeds) give true aggressor-side delta. TradingView\'s footprint uses '
    'intrabar price direction, which is an approximation. The second is <strong>depth of data</strong>: iceberg and individual-order tools need '
    'market-by-order data; footprints only need trades with the best bid and ask.</p>',

    '<h3>What even perfect futures data can\'t tell you</h3>',
    '<p>Complete exchange data is a big advantage, but it has limits worth stating plainly.</p>',
    '<ul>'
    '<li><strong>It is anonymous.</strong> CME\'s market-by-order feed identifies orders by anonymous IDs only. You never know <em>who</em> traded, '
    'so words like "institutions" or "smart money" in order-flow commentary are interpretations, not data.</li>'
    '<li><strong>It shows one venue.</strong> ES is closely linked to the S&amp;P 500 stocks, their options, and ETFs that track the index. Large '
    'participants may be active in several of those at once. The ES footprint shows only the ES part.</li>'
    '<li><strong>It can\'t see intentions.</strong> Resting orders can be cancelled, and orders not yet sent don\'t exist in any feed.</li>'
    '<li><strong>Aggressor is not direction.</strong> A trade at the ask may be a new long or a short covering. The data does not say which.</li>'
    '</ul>',
    '<p>None of this makes order flow useless. It means the right claim is modest: order-flow tools show <em>how</em> trading happened at a price, '
    'which is valuable context at a level you already care about. They don\'t reveal a hidden plan.</p>',
    '<h3>A note on cost and simulation</h3>',
    '<p>Real-time exchange data is licensed, so most platforms charge for live CME feeds separately from the software, and non-professional and '
    'professional data are priced differently. You don\'t need any of it to learn. Several platforms offer replay of historical sessions or '
    'simulated trading, and the exercises in this track can all be done on delayed or recorded data. Pay for live data once you know which tools '
    'you actually use.</p>',
    '<h3>Worked example: checking your own setup</h3>',
    '<ol>'
    '<li><strong>Instrument:</strong> are you looking at an exchange-traded future (ES, NQ, GC, CL, 6E) or a broker\'s CFD or spot price?</li>'
    '<li><strong>Volume type:</strong> does your platform say "volume" (contracts) or "tick volume"? Check its documentation, not the label on the chart.</li>'
    '<li><strong>Delta method:</strong> is the buy/sell split from exchange bid/ask, or from price direction?</li>'
    '<li><strong>Session:</strong> RTH or overnight (<a href="chapter.html?ch=VP-05">VP-05</a>)?</li>'
    '<li><strong>Contract:</strong> front month or continuous, and is it back-adjusted?</li>'
    '</ol>',
    '<p>For a futures trader, a typical set of answers might read: ES front month, contract volume, exchange bid/ask delta, RTH session, '
    'front month only with no back-adjustment. For a forex trader it might read: 6E front month for profiles, spot EUR/USD for execution, and '
    'no footprint reading on spot at all.</p>',
    '<p>Write the answers at the top of your playbook. If two traders disagree about where yesterday\'s POC was, one of these five is almost always why.</p>',

    '<h3>Common mistakes</h3>',
    '<ul>'
    '<li><strong>Reading a footprint on spot FX or a CFD</strong> as if it showed real aggressor volume.</li>'
    '<li><strong>Building a profile on micro-contract volume</strong> and comparing it with someone else\'s ES profile.</li>'
    '<li><strong>Ignoring the roll</strong> when building composites across expiry.</li>'
    '<li><strong>Assuming all delta is the same.</strong> Exchange bid/ask and tick-rule methods can disagree.</li>'
    '<li><strong>Buying a platform before you know what you need.</strong> Most offer trials or simulated data.</li>'
    '</ul>',

    callout('Key takeaways', '<ul>'
            '<li>Futures trade through one central book, so their volume and aggressor data are complete.</li>'
            '<li>Spot FX is OTC with no single tape; broker "volume" is usually tick volume.</li>'
            '<li>Tick volume counts price changes. It tracks activity, not size.</li>'
            '<li>Use currency and gold futures for FX and gold profile work.</li>'
            '<li>Know how your platform classifies buys and sells, and watch for roll effects.</li>'
            '</ul>'),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Put a 6E futures chart next to a spot EUR/USD chart for the same day. Compare the session profiles\' POCs.</li>'
    '<li>Find out whether your platform\'s volume on spot instruments is tick volume. Quote the line from its documentation.</li>'
    '<li>Build a 20-day ES composite that crosses a roll date, then rebuild it on the front month only. Note what changes.</li>'
    '<li>Answer the five setup questions from the worked example and save them in your playbook.</li>'
    '</ol>',

    quiz([
        ('Why does ES have complete volume data?', '<p>Every trade goes through CME Globex\'s single central order book, which publishes it.</p>'),
        ('What does tick volume count?', '<p>The number of price changes in a bar, not the size traded.</p>'),
        ('How can an FX trader get real volume for EUR/USD?', '<p>Use CME Euro FX futures (6E), which have exchange-reported volume.</p>'),
        ('When is the customary roll date for U.S. equity index futures?', '<p>The Monday before the third Friday of the expiry month.</p>'),
        ('How does TradingView\'s footprint classify buys and sells?', '<p>From intrabar price direction, which approximates aggressor side.</p>'),
    ]),
]

lessons = [
    ('Why futures have real volume', '<p>Understand the central order book and what exchange data does and doesn\'t include.</p>'),
    ('Spot FX and tick volume', '<p>Learn why spot FX has no single tape and what tick volume really measures.</p>'),
    ('Contracts, micros and rolls', '<p>Know the contracts used in this track, and how rolls and back-adjustment affect profiles.</p>'),
    ('Choosing and checking your platform', '<p>Compare platforms from their own documentation and write your data setup into your playbook.</p>'),
]

src = [
    ('OTC foreign exchange turnover in April 2022 - Bank for International Settlements', 'https://www.bis.org/publications/202210-commentary-otc-derivatives'),
    ('Euro FX futures (6E) - CME Group', 'https://cmegroup.com/trading/fx/g10/euro-fx.html'),
    ('Equity Index Roll Dates - CME Group', 'https://www.cmegroup.com/trading/equity-index/rolldates.html'),
    ('Micro E-mini Equity Index Futures FAQ - CME Group', 'https://www.cmegroup.com/articles/faqs/micro-e-mini-equity-index-futures-frequently-asked-questions.html'),
    ('Gold Futures contract specs - CME Group', 'https://www.cmegroup.com/markets/metals/precious/gold.contractSpecs.html'),
    ('Light Sweet Crude Oil Futures contract specs - CME Group', 'https://www.cmegroup.com/markets/energy/crude-oil/light-sweet-crude.contractSpecs.html'),
    ('Market by Order (MBO) FAQ - CME Group', 'https://cmegroup.com/articles/faqs/market-by-order-mbo.html'),
    ('Numbers Bars - Sierra Chart documentation', 'https://www.sierrachart.com/index.php?page=doc%2FNumbersBars.php'),
    ('Order Flow Volumetric Bars - NinjaTrader 8 Help Guide', 'https://ninjatrader.com/support/helpGuides/nt8/order_flow_volumetric_bars.htm'),
    ('Imbalances - ATAS knowledge base', 'https://learn.atas.net/volume-basics/volume-analysis/imbalances'),
    ('Stops and Icebergs On-Chart indicator - Bookmap knowledge base', 'https://bookmap.com/knowledgebase/docs/Addons-Stops-And-Icebergs-On-Chart-Indicator'),
    ('Volume Footprint charts: a complete guide - TradingView Help Center', 'https://www.tradingview.com/support/solutions/43000726164-volume-footprint-charts-a-complete-guide/'),
]

write_chapter('vp', 'VP-10', 'Data & Tools: Futures, FX Tick Volume & Platforms', 'intermediate', '30 min', lessons, body, src)
