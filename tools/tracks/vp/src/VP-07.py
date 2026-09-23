#!/usr/bin/env python3
"""VP-07 Order Flow Foundations: Orders, the Book & Matching."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

TICK = 0.25
# ---------------------------------------------------------------- illustrative ES book (price, bid size, ask size)
book_ask = {5201.25: 64, 5201.00: 41, 5200.75: 38, 5200.50: 22}
book_bid = {5200.25: 27, 5200.00: 45, 5199.75: 52, 5199.50: 70}
best_bid = max(book_bid); best_ask = min(book_ask)
assert abs(best_ask - best_bid - TICK) < 1e-9          # one-tick spread


def ladder(asks, bids, last=None):
    prices = sorted(set(asks) | set(bids), reverse=True)
    return [(p, bids.get(p), asks.get(p)) for p in prices]


fig_book = figure(dom(ladder(book_ask, book_bid), 'An order book (DOM ladder)', last=None,
                      note='spread = 1 tick (0.25)'),
                  'Resting buy limit orders (bids) sit below; resting sell limit orders (asks, or offers) sit above. The best bid is '
                  '%s and the best ask is %s, one tick (0.25) apart.' % (fmt(best_bid), fmt(best_ask)))


# ---------------------------------------------------------------- a market buy sweeping the book
def sweep(asks, qty):
    asks = dict(asks); fills = []
    for p in sorted(asks):
        if qty == 0: break
        take = min(qty, asks[p]); fills.append((p, take)); qty -= take; asks[p] -= take
        if asks[p] == 0: del asks[p]
    return fills, asks, qty


MKT = 75
fills, asks_after, left = sweep(book_ask, MKT)
assert left == 0
avg = sum(p * q for p, q in fills) / MKT
fill_rows = [[fmt(p), str(q), '%s x %d' % (fmt(p), q)] for p, q in fills]
fill_table = table(['Price', 'Contracts filled', 'Note'], [[fmt(p), str(q), 'level emptied' if p not in asks_after else '%d left resting' % asks_after[p]] for p, q in fills])
last_px = fills[-1][0]
fig_after = figure(dom(ladder(asks_after, book_bid), 'The book after a %d-lot market buy' % MKT, last=last_px,
                       note='gold row = last trade %s' % fmt(last_px)),
                   'The buy took all %d at %s, then %d at %s. The gold row marks the last trade. The best ask is now %s and the spread has '
                   'widened to %d ticks, until new orders fill the gap.'
                   % (fills[0][1], fmt(fills[0][0]), fills[1][1], fmt(fills[1][0]), fmt(min(asks_after)),
                      round((min(asks_after) - best_bid) / TICK)))

# ---------------------------------------------------------------- FIFO queue at one price
queue = [('A', 10), ('B', 5), ('C', 20), ('D', 8)]   # arrival order at the best ask
incoming = 22


def fifo(q, n):
    out = []; rest = []
    for name, size in q:
        take = min(n, size); n -= take
        if take: out.append((name, take))
        if size - take: rest.append((name, size - take))
    return out, rest


ff, rest = fifo(queue, incoming)
assert ff == [('A', 10), ('B', 5), ('C', 7)] and rest == [('C', 13), ('D', 8)]


def queue_fig():
    o = []; y0 = 30; bh = 34; scale = 6.5; x = 20
    o.append(text(20, 18, 'Sell orders resting at %s, in time order' % fmt(best_ask), 13, MUTED))
    for name, size in queue:
        w = size * scale
        filled = dict(ff).get(name, 0)
        o.append(rect(x, y0, w, bh, stroke=RED, fill=RED, opacity=0.12, rx=3))
        if filled:
            o.append(rect(x, y0, filled * scale, bh, fill=GOLD, opacity=0.55, rx=3))
        o.append(text(x + w / 2, y0 + 22, '%s %d' % (name, size), 13, INK, 'middle'))
        x += w + 4
    o.append(text(20, y0 + bh + 22, 'Incoming market buy: %d contracts' % incoming, 13, GOLD))
    o.append(text(20, y0 + bh + 42, 'Filled: ' + ', '.join('%s %d' % f_ for f_ in ff), 13, INK))
    o.append(text(20, y0 + bh + 62, 'Still resting: ' + ', '.join('%s %d' % r for r in rest), 13, MUTED))
    return svg(y0 + bh + 74, o, 'FIFO matching at one price level')


fig_fifo = figure(queue_fig(), 'Under FIFO, the %d-lot buy fills A completely, then B, then %d of C\'s %d. D, which arrived last, gets '
                  'nothing yet. Gold shows the filled part of each order.' % (incoming, ff[2][1], queue[2][1]))

# ---------------------------------------------------------------- time & sales
ts = [('10:31:02.114', 5200.50, 22, 'ask'), ('10:31:02.114', 5200.75, 38, 'ask'), ('10:31:02.114', 5201.00, 15, 'ask'),
      ('10:31:03.520', 5200.25, 4, 'bid'), ('10:31:04.007', 5200.25, 12, 'bid'), ('10:31:05.890', 5200.50, 3, 'ask')]
assert [(p, q) for _, p, q, _ in ts[:3]] == fills
ts_table = table(['Time', 'Price', 'Size', 'Traded at'], [[t, fmt(p), str(q), a] for t, p, q, a in ts])

# ---------------------------------------------------------------- tick values
tick_table = table(['Contract', 'Tick size', 'Tick value'], [
    ['E-mini S&P 500 (ES)', '0.25 index pt', '$12.50'], ['Micro E-mini S&P (MES)', '0.25 index pt', '$1.25'],
    ['E-mini Nasdaq-100 (NQ)', '0.25 index pt', '$5.00'], ['Micro E-mini Nasdaq (MNQ)', '0.25 index pt', '$0.50'],
    ['Gold (GC)', '$0.10 per oz', '$10.00'], ['Crude oil (CL)', '$0.01 per bbl', '$10.00'],
])
assert abs(0.25 * 50 - 12.50) < 1e-9 and abs(0.25 * 20 - 5.00) < 1e-9 and abs(0.10 * 100 - 10) < 1e-9 and abs(0.01 * 1000 - 10) < 1e-9

# second worked example: joining the queue
my_size = 3
ahead = sum(sz for _, sz in queue)          # A..D ahead of us
after_first = sum(sz for _, sz in rest)     # what is still ahead after the 22-lot
need = after_first + my_size

body = [
    '<p>Volume profile tells you <em>where</em> trade happened. <strong>Order flow</strong> tells you <em>how</em> it happened: who crossed the '
    'spread, who waited, and what was sitting in the book when they did. Before any footprint chart or delta reading makes sense, you need a '
    'clear picture of the plumbing: the kinds of orders, the order book, and how an exchange actually matches a buyer with a seller.</p>',
    '<p>This chapter is about CME Group futures (ES, NQ, GC, CL), because that is where the order flow is visible. Every trade on CME Globex '
    'goes through one central order book with public data, which is what makes the tools in the rest of the track possible. '
    '<a href="chapter.html?ch=VP-10">VP-10</a> explains why spot forex is different.</p>',

    '<h3>Market orders and limit orders</h3>',
    '<p>A <strong>limit order</strong> says "buy (or sell) at this price or better". The SEC\'s investor guide puts it plainly: a buy limit executes '
    'only at the limit price or lower, a sell limit only at the limit price or higher. If nobody is willing to trade at that price yet, the order '
    '<strong>rests</strong> in the book and waits. Limit orders provide <strong>liquidity</strong>: they are the prices other traders can hit.</p>',
    '<p>A <strong>market order</strong> says "buy (or sell) now at the best available price". It executes immediately against whatever limit orders '
    'are resting, but the price is not guaranteed. Market orders <strong>take</strong> liquidity. In order-flow language, the market order is the '
    '<strong>aggressor</strong> and the limit order is the <strong>passive</strong> side. CME\'s own order-type guide adds a detail worth knowing: '
    'on Globex a "market" order is typically handled as a market-limit order, which executes at the best available price and, if only partly '
    'filled, turns the rest into a limit order at that price. <strong>Stop orders</strong> sit outside the book until price reaches the stop '
    'level, then enter as market or limit orders. That is why a cluster of stops, once triggered, arrives as a burst of aggressive orders.</p>',
    '<p>This is the link to liquidity in the core course (<a href="chapter.html?ch=07">chapter 07</a>). When traders say stops sit above equal '
    'highs, they mean a pile of buy stops that will become market buys the moment price trades there.</p>',

    '<h3>The order book and the DOM</h3>',
    '<p>The <strong>order book</strong> is the list of all resting limit orders at every price. Most platforms display it as a vertical ladder called '
    'the <strong>DOM</strong> (depth of market). Bids are on one side, asks on the other, prices in the middle. The highest bid is the '
    '<strong>best bid</strong>, the lowest ask is the <strong>best ask</strong>, and the gap between them is the <strong>spread</strong>. In ES the '
    'minimum price step, or <strong>tick</strong>, is 0.25 index points, and the spread is usually one tick.</p>',
    fig_book,
    '<p>Two types of book data exist on CME. <strong>Market by price (MBP)</strong> shows the total quantity at each price level. <strong>Market by '
    'order (MBO)</strong> shows each individual order, with its size and queue position, identified only by an anonymous order ID. CME\'s MBO FAQ '
    'notes it carries no customer-identifying information. Tools that claim to spot icebergs or individual large orders rely on MBO data '
    '(see <a href="chapter.html?ch=VP-09">VP-09</a>).</p>',

    '<h3>How a trade matches: price, then time</h3>',
    '<p>A trade happens when an aggressive order meets a resting one. CME describes this as matching resting orders with aggressing orders '
    'using its matching algorithms. For ES and most equity index futures the algorithm is <strong>FIFO</strong> (first in, first out): the best '
    'price is filled first, and at the same price, the order that arrived earliest is filled first. CME\'s documentation says FIFO uses price and '
    'time as its only criteria.</p>',
    fig_fifo,
    '<p>This <strong>queue priority</strong> is why some traders care about where they sit in line. CME\'s rules also say that an order loses its '
    'place, and goes to the back of the queue, if its quantity is increased or its price is changed. Not every CME product uses pure FIFO: '
    'the exchange also runs pro-rata and other allocation methods for some contracts, so check the product if you trade outside index futures.</p>',

    '<h3>Worked example: a market buy sweeps the book</h3>',
    '<p>Take the book shown above. A trader sends a <strong>%d-lot market buy</strong>. There are only %d contracts offered at the best ask, so '
    'the order fills through several prices in turn:</p>' % (MKT, book_ask[best_ask]),
    fill_table,
    '<p>The buyer\'s average price is <strong>%s</strong>, a little worse than the %s best ask they saw, because the order was larger than the '
    'quantity available at one price. That difference is <strong>slippage</strong>. It also moved the market: the last trade printed at %s, and '
    'until new sellers step in, the best ask has moved up.</p>' % (fmt(avg, 3), fmt(best_ask), fmt(last_px)),
    fig_after,
    '<p>This is the most important idea in order flow. <strong>Price moves when aggressive orders consume the resting liquidity at a price.</strong> '
    'A thin book moves easily; a thick one absorbs a lot of aggression without moving. Every footprint pattern in the next two chapters is '
    'some version of this.</p>',

    '<h3>Worked example: waiting in the queue</h3>',
    '<p>Now look at it from the passive side. Suppose you place a %d-lot sell limit at %s just after trader D. Under FIFO you are fifth in line, '
    'with %d contracts ahead of you. The 22-lot buy from the FIFO example fills %d of them, which leaves %d still ahead. For your order to fill '
    'completely, another <strong>%d contracts</strong> of buying must trade at %s, assuming nobody ahead of you cancels. If they do cancel, you '
    'move up.</p>' % (my_size, fmt(best_ask), ahead, incoming, after_first, need, fmt(best_ask)),
    '<p>This is why passive traders care about queue position, and why a limit order is never a guaranteed fill. Price can trade at your level, '
    'print on the tape, and move away without ever reaching you. If you then change the price or add size, the CME rules above send you to the '
    'back of the queue again. When you backtest on charts, a "touch" of your limit price is not the same as a fill. Many traders count a fill only '
    'when price trades through the level by at least one tick.</p>',
    '<h3>Bid, ask and last on your chart</h3>',
    '<p>Candlestick charts are normally built from the <strong>last traded price</strong>. That hides the spread. When your platform shows a candle '
    'high at %s, it means a trade printed there; the best bid at that moment was one tick lower. For a long entry you pay the ask, and for a '
    'stop-loss on a long you usually sell at the bid. Over many trades those ticks add up, which is one reason order-flow traders think in '
    'ticks and dollars per tick rather than in candle prices.</p>' % fmt(last_px),
    '<h3>Time and sales</h3>',
    '<p><strong>Time and sales</strong> (the "tape") is the list of every trade: time, price, size, and whether it traded at the bid or the ask. A '
    'trade at the ask means a buyer was the aggressor; a trade at the bid means a seller was. Here is the same %d-lot sweep on the tape, followed '
    'by a few more trades:</p>' % MKT,
    ts_table,
    '<p>Notice that one order shows up as three prints at the same timestamp. Tape readers look for exactly that kind of burst. They also watch '
    'for the opposite: a stream of prints at the same price that doesn\'t move it, which is the start of the absorption idea in VP-09.</p>',

    '<h3>What a tick is worth</h3>',
    '<p>Order flow is read in ticks, so it helps to know what one tick is worth in money. These come from CME\'s contract specifications and '
    'Micro E-mini FAQ:</p>',
    tick_table,

    '<h3>Spoofing: what the book cannot tell you</h3>',
    '<p>Resting orders can be cancelled at any time, so the book shows <em>intentions</em>, not commitments. Placing orders you intend to cancel '
    'before they execute is illegal: the U.S. Commodity Exchange Act, section 4c(a)(5)(C), prohibits "spoofing", described by the CFTC as bidding '
    'or offering with the intent to cancel before execution. It still happens, and it is one reason experienced order-flow traders put more weight '
    'on <strong>executed trades</strong> (the tape, the footprint) than on displayed size in the DOM.</p>',

    '<h3>Common mistakes</h3>',
    '<ul>'
    '<li><strong>Treating large resting size as a wall.</strong> Displayed orders can be pulled in a millisecond.</li>'
    '<li><strong>Using market orders in thin conditions.</strong> Slippage can be several ticks around news or the open.</li>'
    '<li><strong>Assuming every exchange matches FIFO.</strong> Check the matching algorithm for the product.</li>'
    '<li><strong>Confusing "at the ask" with "buyers in control".</strong> It only says who crossed the spread on that trade.</li>'
    '<li><strong>Reading order flow on instruments without a central book.</strong> See VP-10.</li>'
    '</ul>',

    callout('Key takeaways', '<ul>'
            '<li>Limit orders rest and provide liquidity; market orders cross the spread and take it.</li>'
            '<li>The DOM shows resting orders by price; MBO data shows individual orders anonymously.</li>'
            '<li>CME index futures match FIFO: best price first, then earliest order.</li>'
            '<li>Price moves when aggression consumes the resting liquidity at a price.</li>'
            '<li>Time and sales records executed trades, which are more reliable than displayed size.</li>'
            '</ul>'),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Rework the sweep with a 110-lot market buy. List each fill and the average price.</li>'
    '<li>Under FIFO, how would the queue example change if trader B had increased their order to 9 contracts before the buy arrived?</li>'
    '<li>Watch the ES DOM in a simulator for ten minutes around the cash open. Note how often the best bid or ask size changes without a trade.</li>'
    '<li>On the tape, find three bursts of prints with the same timestamp and note how many price levels each one crossed.</li>'
    '</ol>',

    quiz([
        ('Which order provides liquidity: market or limit?', '<p>A limit order, because it rests in the book for others to trade against.</p>'),
        ('Two sell orders rest at the same price. Under FIFO, which fills first?', '<p>The one that arrived first.</p>'),
        ('Why did the 75-lot buy average above the best ask it saw?', '<p>Because the best ask only had 22 contracts; the rest filled at higher prices.</p>'),
        ('A trade prints at the bid. Who was the aggressor?', '<p>A seller, using a market (or marketable) order.</p>'),
        ('What does ES move per tick, in dollars, for one contract?', '<p>$12.50 (0.25 index points x $50).</p>'),
        ('Why do order-flow traders trust executed trades more than displayed size?', '<p>Displayed orders can be cancelled, and spoofing, though illegal, happens.</p>'),
    ]),
]

lessons = [
    ('Market, limit and stop orders', '<p>Learn which orders rest, which take liquidity, and how stops turn into aggressive orders when triggered.</p>'),
    ('Reading the DOM', '<p>Identify best bid, best ask, spread and depth on a live ES ladder in a simulator.</p>'),
    ('FIFO matching and queue priority', '<p>Work through the FIFO example and the rules that send an order to the back of the queue.</p>'),
    ('A market order sweeps the book', '<p>Calculate fills, average price and slippage for a market order larger than the best level.</p>'),
    ('Time and sales', '<p>Read the tape: aggressor side, prints per order, and bursts.</p>'),
]

src = [
    ('Supported Matching Algorithms - CME Group Client Systems Wiki', 'https://cmegroupclientsite.atlassian.net/wiki/spaces/EPICSANDBOX/pages/457218479/Supported+Matching+Algorithms'),
    ('Matching Algorithm Overview - CME Group', 'https://www.cmegroup.com/education/matching-algorithm-overview'),
    ('Futures order types - CME Group education', 'https://www.cmegroup.com/education/courses/things-to-know-before-trading-cme-futures/futures-order-types'),
    ('Investor Bulletin: Understanding Order Types - Investor.gov (SEC)', 'https://investor.gov/additional-resources/news-alerts/alerts-bulletins/investor-bulletin-understanding-order-types'),
    ('Market by Order (MBO) FAQ - CME Group', 'https://cmegroup.com/articles/faqs/market-by-order-mbo.html'),
    ('Micro E-mini Equity Index Futures FAQ (multipliers and ticks) - CME Group', 'https://www.cmegroup.com/articles/faqs/micro-e-mini-equity-index-futures-frequently-asked-questions.html'),
    ('Gold Futures contract specs - CME Group', 'https://www.cmegroup.com/markets/metals/precious/gold.contractSpecs.html'),
    ('Light Sweet Crude Oil Futures contract specs - CME Group', 'https://www.cmegroup.com/markets/energy/crude-oil/light-sweet-crude.contractSpecs.html'),
    ('Disruptive Trading Practices fact sheet (spoofing, CEA 4c(a)(5)(C)) - CFTC', 'https://www.cftc.gov/sites/default/files/idc/groups/public/@newsroom/documents/file/dtp_factsheet.pdf'),
]

write_chapter('vp', 'VP-07', 'Order Flow Foundations: Orders, the Book & Matching', 'intermediate', '35 min', lessons, body, src)
