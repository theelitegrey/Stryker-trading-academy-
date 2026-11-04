#!/usr/bin/env python3
"""Builds compare.html from pro.html's head/nav/footer + the table data below. Run from repo root.
Cell: 'y' = tick, ('y','note') = tick + note, 'nf' = Not found, 'nb' = Not built in, 'nc' = Not compared, 'text' = plain text.
Columns: TradingView Ultimate | OpenMarket Free | Alertsify Free | TradeZoro. Checked against vendor sites Nov 2026 (see reports/workers/compare.md)."""
import re, html
src = open('pro.html', encoding='utf-8').read()
V = re.search(r'stryker-build" content="(\d+)"', src).group(1)
Y, NF, NB, NC = 'y', 'nf', 'nb', 'nc'
S = [
 ('On all four', [
  ('16 charts on one screen', Y, Y, Y, Y),
  ('No ads', Y, NF, NF, Y),
  ('Volume profile', Y, Y, Y, ('y','Pro')),
  ('Volume footprint', Y, Y, NF, ('y','Pro')),
  ('Volume candles', Y, NF, NF, Y),
  ('Bar replay', Y, NF, Y, ('y','Replay One and on-chart replay')),
  ('Alerts that do not expire', Y, NF, NF, ('t','Condition alerts have an optional expiry')),
  ('Earnings and economic calendar', Y, NF, Y, Y),
  ('Web, desktop and mobile apps', Y, 'No Windows app; iOS in beta', NF, ('t','Web app on desktop, tablet and phone. No desktop download')),
 ]),
 ('Chart tools', [
  ('Custom timeframes', Y, NF, Y, ('y','Up to 20 custom intervals')),
  ('Custom range bars', Y, NF, NF, Y),
  ('Charts based on custom formulas', Y, NF, NF, ('y','Symbol formulas such as ES1!-NQ1!*0.25')),
  ('Auto chart patterns', Y, NF, Y, Y),
  ('Chart data export', Y, NF, NF, ('y','CSV')),
  ('Watchlist flags', NC, NC, NC, Y),
 ]),
 ('Limits', [
  ('Indicators per chart', '50', NF, 'Up to 16', ('t','No cap set for built-in tools. Pine scripts: 8')),
  ('Alerts', '1,000 price + 1,000 technical', NF, NF, '1,000'),
  ('Futures data', 'Extra data fee', NF, 'Included', 'Add-on, or connect your own Rithmic'),
 ]),
 ('Not on TradingView', [
  ('GEX levels: call wall, put wall, gamma flip', NB, NF, ('y','US stocks and ETFs'), ('y','Pro. SPX, SPY, QQQ, ES, NQ, GC')),
  ('Options flow marked on your candles', NB, NF, Y, ('y','Pro. Per-bar call and put totals for SPX, SPY, QQQ')),
  ('Unusual options activity', NB, NF, NF, ('t','Large-premium bars marked (Pro)')),
  ('Dark pool levels on the chart', NB, NF, Y, NB),
  ('Congress and insider trades', NB, NF, NF, ('y','Smart Money desk, own page')),
 ]),
 ('More on TradeZoro', [
  ('Order book heatmap', NB, Y, NF, ('y','Pro. Midnight, Zoro, Classic, Split looks')),
  ('DOM ladder and book panel', NC, NC, NC, ('y','Pro')),
  ('Liquidity walls and wall events', NC, NC, NC, ('y','Pro')),
  ('Big trades and absorption', NC, NC, NC, ('y','Pro')),
  ('ZoroTide options money flow', NC, NC, NC, ('y','Pro')),
  ('Replay One practice sessions', NC, NC, NC, ('y','Free')),
  ('JournalX trade journal', NC, NC, NC, ('y','Free, with CSV import')),
  ('Market Stats', NC, NC, NC, ('y','Free')),
  ('ZoroAcademy written lessons', NC, NC, NC, ('y','64 chapters, free')),
  ('Connect your own broker data', NC, NC, NC, ('y','Rithmic, Alpaca, tastytrade, Dhan, OANDA, cTrader. Beta bridge for NT8, MT5, IBKR')),
 ]),
]
CHK = '<svg class="cp-ck" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
def cell(c, tz=False):
    cls = 'cp-tz' if tz else ''
    if c == Y: return f'<td class="{cls}">{CHK}<span class="cp-sr">Yes</span></td>'
    if c == NF: return f'<td class="cp-no {cls}">Not found</td>'
    if c == NB: return f'<td class="cp-no {cls}">Not built in</td>'
    if c == NC: return f'<td class="cp-no {cls}">Not compared</td>'
    if isinstance(c, tuple) and c[0] == 'y': return f'<td class="{cls}">{CHK}<span class="cp-sr">Yes. </span><span class="cp-n">{html.escape(c[1])}</span></td>'
    if isinstance(c, tuple): return f'<td class="{cls}"><span class="cp-n cp-t">{html.escape(c[1])}</span></td>'
    return f'<td class="{cls}"><span class="cp-n cp-t">{html.escape(c)}</span></td>'
rows = []
for name, items in S:
    rows.append(f'<tr class="cp-sec"><th colspan="5" scope="colgroup"><span>{name}</span></th></tr>')
    for r in items:
        rows.append(f'<tr><th scope="row">{html.escape(r[0])}</th>' + ''.join(cell(c, i == 3) for i, c in enumerate(r[1:])) + '</tr>')
table = f'''<div class="cp-wrap" id="cp-wrap" role="region" aria-label="Comparison table" tabindex="0"><table class="cp-table">
<thead><tr><th scope="col" class="cp-h0"><span class="cp-sr">Feature</span></th>
<th scope="col"><b>TradingView</b><span>Ultimate, $199.95/mo billed annually</span></th>
<th scope="col"><b>OpenMarket</b><span>Free plan, $0</span></th>
<th scope="col"><b>Alertsify</b><span>Free charts, $0</span></th>
<th scope="col" class="cp-tz"><b>TradeZoro</b><span>Free. Pro for order flow</span></th></tr></thead>
<tbody>{"".join(rows)}</tbody></table></div>'''
head = src[:src.index('<main')]
head = re.sub(r'<meta property="og:title"[^>]*>', '<meta property="og:title" content="TradeZoro compared: TradingView, OpenMarket, Alertsify">', head)
head = re.sub(r'<meta name="twitter:title"[^>]*>', '<meta name="twitter:title" content="TradeZoro compared: TradingView, OpenMarket, Alertsify">', head)
D = 'A side-by-side of TradingView Ultimate, the OpenMarket and Alertsify free plans, and TradeZoro. Sources listed, checked Nov 2026.'
head = re.sub(r'(<meta (?:property="og:description"|name="twitter:description"|name="description") content=")[^"]*', lambda m: m.group(1) + D, head)
head = re.sub(r'<meta property="og:url"[^>]*>', '<meta property="og:url" content="https://tradezoro.com/compare">', head)
head = re.sub(r'<link rel="canonical"[^>]*>', '<link rel="canonical" href="https://tradezoro.com/compare">', head)
head = re.sub(r'<title>[^<]*</title>', '<title>TradeZoro compared: TradingView, OpenMarket, Alertsify</title>', head)
head = head.replace('share/pro.png','share/compare.png').replace('Everything in Pro share card','TradeZoro compared share card')
head = head.replace('<link rel="stylesheet" href="assets/pro-page.css?v=%s">' % V, '<link rel="stylesheet" href="assets/compare-page.css?v=%s">' % V)
head = re.sub(r'<link rel="preload" as="image"[^>]*>\n?', '', head)
head = head.replace('og:type" content="website">', 'og:type" content="website">', 1)
main = f'''<main id="main" tabindex="-1" class="cm-main-page">
<section class="cp-hero"><div class="cm-w">
  <h1>TradeZoro next to TradingView, OpenMarket and Alertsify</h1>
  <p class="cp-sub">TradingView's Ultimate plan and the free plans of OpenMarket and Alertsify, next to TradeZoro. A tick means we found it on the vendor's public site. Pro marks what needs TradeZoro Pro.</p>
</div></section>
<section class="cp-sec-w"><div class="cm-w">
{table}
<p class="cp-foot">Competitor features and prices from their public websites, checked Nov 2026. Not found means we could not find it on their public pages, so it may exist. Not compared means we did not check that row. Tell us if something changed: <a href="/contact">contact us</a>. Sources: <a href="https://www.tradingview.com/pricing/" rel="noopener">tradingview.com/pricing</a>, <a href="https://openmarket.xyz" rel="noopener">openmarket.xyz</a>, <a href="https://alertsify.com/charts" rel="noopener">alertsify.com/charts</a>. TradeZoro: Pro items need <a href="/pro">TradeZoro Pro</a>; everything else is free. Education only. Not financial advice.</p>
<div class="cp-cta"><a class="btn btn-primary cm-btn" href="/signup">Start free</a><a class="btn btn-ghost cm-btn" href="/pro">See what Pro adds</a></div>
</div></section>
</main>
'''
tail = src[src.index('<footer>'):]
tail = tail.replace('<a href="indicators">Trading indicators</a>', '<a href="indicators">Trading indicators</a>\n        <a href="compare">Compare</a>', 1)
tail = re.sub(r'<script src="assets/(?:home-a|pro-features-data|pro-page)\.js[^>]*></script>\n?', '', tail)
head = head.replace('<div class="cm-scroll" aria-hidden="true"><u data-scroll-bar></u></div>\n', '')
open('compare.html', 'w', encoding='utf-8').write(head + main + tail)
print('ok', V)
