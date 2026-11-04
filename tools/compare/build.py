#!/usr/bin/env python3
"""Builds compare.html from pro.html's head/nav/footer + the table data below. Run from repo root.
Cell: 'y' = tick, ('y','note') = tick + note, 'nf' = Not found, 'nb' = Not built in, 'nc' = Not compared, 'text' = plain text.
Columns: TradingView Ultimate | OpenMarket Free | Alertsify Free | TradeZoro. Checked against vendor sites Nov 2026 (see reports/workers/compare.md)."""
import re, html
src = open('pro.html', encoding='utf-8').read()
V = re.search(r'stryker-build" content="(\d+)"', src).group(1)
Y, NF, NB, NC = 'y', 'nf', 'nb', 'nc'
V_ = ['TradingView', 'OpenMarket', 'Alertsify']
# (feature, TradingView, OpenMarket, Alertsify, TradeZoro[, 'cmp']). Sections are DERIVED from the cells below, never typed.
# Y = tick, ('y', note) = tick + note, ('n', note) = text, no tick, NF/NB = grey text, NC = we did not compare that vendor.
ROWS = [
 ('16 charts on one screen', Y, Y, Y, Y),
 ('Volume profile', Y, Y, Y, ('y','Pro')),
 ('Volume footprint', Y, Y, NF, ('y','Pro')),
 ('Bar replay', Y, NF, Y, ('y','Replay One, and replay on the chart')),
 ('Custom timeframes', Y, NF, Y, ('y','Up to 20 custom intervals')),
 ('Auto chart patterns', Y, NF, Y, Y),
 ('Charts based on custom formulas', Y, NF, NF, ('y','For example ES1!-NQ1!*0.25')),
 ('Chart data export', Y, NF, NF, ('y','CSV')),
 ('Earnings and economic calendar', Y, ('n','Economic data series, no calendar found'), Y, Y),
 ('Order book heatmap', NB, Y, NF, ('y','Pro. Midnight, Zoro, Classic and Split looks')),
 ('GEX levels: call wall, put wall, gamma flip', NB, ('y','Starter indicator'), ('y','US stocks and ETFs'), ('y','Pro. SPX, SPY, QQQ, ES, NQ, GC')),
 ('Options flow marked on your candles', NB, ('y','Starter indicator'), Y, ('y','Pro. Per-bar call and put totals for SPX, SPY, QQQ')),
 ('Dark pool levels on the chart', NB, NF, Y, NB),
 ('Indicators per chart', '50', NF, 'Up to 16', 'No cap on built-in tools. Pine scripts: 8', 'cmp'),
 ('Alerts', '1,000 price + 1,000 technical', NF, NF, '1,000', 'cmp'),
 ('Futures data', 'Extra data fee', NF, 'Included', 'Add-on, or connect your own Rithmic', 'cmp'),
]
# Features we did not compare row by row (all competitor cells NC). Listed on their own, never as "only on TradeZoro".
MORE = [
 ('DOM ladder and Book, DOM and Trades panel', 'Pro'),
 ('Liquidity Walls and Wall Events', 'Pro'),
 ('Book Speed', 'Pro. Futures order book'),
 ('Liquidity Balance', 'Pro. Futures order book'),
 ('Refill Detector', 'Pro. Futures order book'),
 ('Volatility Regime', 'Pro. Futures order book'),
 ('Large Resting Orders', 'Pro. Futures order book'),
 ('Absorption and Iceberg Tracker', 'Pro. Futures order book'),
 ('Big Trades and Absorption', 'Pro'),
 ('ZoroTide options money flow', 'Pro'),
 ('Replay One practice sessions', 'Free'),
 ('JournalX trade journal with CSV import and broker sync', 'Free'),
 ('Market Stats', 'Free'),
 ('Smart Money desk: Congress and insider filings', 'Free, on its own page'),
 ('ZoroAcademy: 64 written chapters', 'Free'),
 ('Connect your own broker data: Rithmic, Alpaca, tastytrade, Dhan, OANDA, cTrader', 'Free. Beta bridge for NT8, MT5, IBKR'),
]
ok = lambda c: c == Y or (isinstance(c, tuple) and c[0] == 'y')
def section(r):
    tz = r[4]
    if len(r) > 5: return ('Numbers compared', 3)
    lack = [V_[i] for i in range(3) if not ok(r[1 + i])]
    if not ok(tz): return ('Not on TradeZoro', 2)
    if not lack: return ('On all four', 0)
    return ('Not on ' + ' or '.join(lack), 1)
groups = {}
for r in ROWS: groups.setdefault(section(r), []).append(r)
S = [(k[0], v) for k, v in sorted(groups.items(), key=lambda kv: (kv[0][1], len(kv[0][0])))]
CHK = '<svg class="cp-ck" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
def cell(c, i):
    cls = ' class="cp-tz"' if i == 3 else ''
    a = f' data-c="{i}"'
    if c == Y: return f'<td{cls}{a}>{CHK}<span class="cp-sr">Yes</span></td>'
    if c == NF: return f'<td{cls}{a}><span class="cp-no">Not found</span></td>'
    if c == NB: return f'<td{cls}{a}><span class="cp-no">Not built in</span></td>'
    if isinstance(c, tuple) and c[0] == 'y': return f'<td{cls}{a}>{CHK}<span class="cp-sr">Yes. </span><span class="cp-n">{html.escape(c[1])}</span></td>'
    t = c[1] if isinstance(c, tuple) else c
    return f'<td{cls}{a}><span class="cp-t">{html.escape(t)}</span></td>'
rows = []
for name, items in S:
    rows.append(f'<tr class="cp-sec"><th colspan="5" scope="colgroup" class="cp-s5">{html.escape(name)}</th><th colspan="3" scope="colgroup" class="cp-s3" aria-hidden="true">{html.escape(name)}</th></tr>')
    for r in items:
        rows.append(f'<tr><th scope="row">{html.escape(r[0])}</th>' + ''.join(cell(c, i) for i, c in enumerate(r[1:5])) + '</tr>')
more = ''.join(f'<li><span>{CHK}{html.escape(n)}</span><em>{html.escape(t)}</em></li>' for n, t in MORE)
table = f"""<div class="cp-pick"><label for="cp-sel">TradeZoro vs</label><select id="cp-sel" aria-label="Choose a rival to compare"><option value="0">TradingView</option><option value="1">OpenMarket</option><option value="2">Alertsify</option></select></div>
<table class="cp-table" id="cp-table" data-r="0">
<thead><tr><th scope="col" class="cp-h0"><span class="cp-sr">Feature</span></th>
<th scope="col" data-c="0"><b>TradingView</b><span>Ultimate, $239.95/mo billed monthly</span></th>
<th scope="col" data-c="1"><b>OpenMarket</b><span>Free plan, $0</span></th>
<th scope="col" data-c="2"><b>Alertsify</b><span>Free charts, $0</span></th>
<th scope="col" class="cp-tz" data-c="3"><b>TradeZoro</b><span>Free · Pro for order flow</span></th></tr></thead>
<tbody>{"".join(rows)}</tbody></table>
<section class="cp-more" aria-labelledby="cp-more-h"><h2 id="cp-more-h">More on TradeZoro</h2><p>Tools we did not compare row by row. Pro marks what needs TradeZoro Pro.</p><ul>{more}</ul></section>"""

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
SCRIPT = '''<script>(function(){var t=document.getElementById('cp-table'),s=document.getElementById('cp-sel'),h=document.querySelector('.hn');function z(){document.documentElement.style.setProperty('--cp-nav',(h?h.offsetHeight:56)+'px')}z();addEventListener('resize',z);s.addEventListener('change',function(){t.setAttribute('data-r',s.value)})})();</script>'''
main = f'''<main id="main" tabindex="-1" class="cm-main-page">
<section class="cp-hero"><div class="cm-w">
  <h1>TradeZoro next to TradingView, OpenMarket and Alertsify</h1>
  <p class="cp-sub">TradingView's Ultimate plan and the free plans of OpenMarket and Alertsify, next to TradeZoro. A tick means we found it on the vendor's public site. Pro marks what needs TradeZoro Pro.</p>
</div></section>
<section class="cp-sec-w"><div class="cm-w">
{table}
<p class="cp-foot">Competitor features and prices from their public websites, checked Nov 2026. Not found means we could not find it on their public pages, so it may exist. Tell us if something changed: <a href="/contact">contact us</a>. Sources: <a href="https://www.tradingview.com/pricing/" rel="noopener">tradingview.com/pricing</a>, <a href="https://openmarket.xyz" rel="noopener">openmarket.xyz</a>, <a href="https://alertsify.com/charts" rel="noopener">alertsify.com/charts</a>. TradeZoro: Pro items need <a href="/pro">TradeZoro Pro</a>; everything else is free. Education only. Not financial advice.</p>
{SCRIPT}
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
