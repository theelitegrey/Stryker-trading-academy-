import re
idx=open('index.html').read()
V=re.search(r'name="stryker-build" content="(\d+)"',idx).group(1)
I=f'assets/images/demo-real-b/'
def img(n,alt,w,h,cls='',lazy=True):
    return f'<img {"class=%s "%chr(34)+cls+chr(34) if cls else ""}src="{I}{n}.webp?v={V}" width="{w}" height="{h}" alt="{alt}"{" loading=lazy decoding=async" if lazy else ""}>'
def log(d,b,t,p,fig=None):
    f=f'<figure>{fig[0]}<figcaption>{fig[1]}</figcaption></figure>' if fig else ''
    return f'<li class="rv{"" if fig else " nf"}"><p class="m">{d} · {b}</p><div><h3>{t}</h3><p>{p}</p></div>{f}</li>'
L=[
log("4 Nov","Build 862","Connect your own data: Dhan","Sign in to Dhan with your own API key and plot that data on your charts. Data only: TradeZoro never places, changes or cancels trades. Alpaca and tastytrade use the same sign-in sheet."),
log("4 Nov","Builds 855 to 859","Desktop bridge for NinjaTrader 8, MT5 and IBKR","A small Windows helper pairs with the site by code and sends prices from your own terminal to your charts. It is unsigned for now, so the download page says what Windows will show and how to continue. Tradovate accounts work through NinjaTrader.",(img('bridge','The Data source sheet listing MetaTrader 5, NinjaTrader and Interactive Brokers, each with a Pair button',560,728),'The Data source sheet. Pair gives you the code box.')),
log("4 Nov","Build 853","Delta ladder (L2) on the price axis","Traded delta at each price, next to the book volume added and pulled there. It sits on the price axis with the Volume Profile (L2) to its left."),
log("4 Nov","Build 847","Formula charts","Type a spread or ratio into the symbol search and it plots as candles. This one is NQ1! divided by ES1!.",(img('formula','A 15 minute candle chart of CME:NQ1! divided by CME:ES1! with a FORMULA tag',1400,692),'NQ1!/ES1!, 15 minute bars. The FORMULA tag keeps it from being mistaken for a contract.')),
]
tools=[("ZoroCharts","21 chart types, drawings, templates, up to 16 charts in one layout.","Free"),
("Order flow, L1","Footprint, Delta, CVD, Big Trades and Absorption.","Pro"),
("Order flow, L2","Book heatmap, DOM ladder, Delta ladder, Book, DOM and Trades.","Pro"),
("GEX+","Call wall, put wall and zero gamma for SPX, SPY, QQQ, ES, NQ and gold. Heatmap by expiry.","Pro"),
("Liquidity Map","Resting size by price over time, drawn behind the candles.","Free"),
("Replay One","Hide the bars after a point and step through them. Paper trading included.","Free"),
("JournalX","Trade log with imports, broker sync and an AI coach.","Free"),
("Market Stats","Gap and opening range stats for NQ, ES, SPX, YM, RTY, GC, CL.","Free"),
("Screener","Scan stocks, futures, forex and crypto.","Free"),
("Alerts","Up to 1000 alerts per account, plus colour-flagged watchlists.","Free"),
("Smart Money Desk","Prior day levels, overnight high and low, ICT concepts.","Free"),
("Connect your own data","Alpaca, tastytrade, Dhan, OANDA, Rithmic, and NinjaTrader 8, MT5, IBKR by desktop helper.","Free")]
T="".join(f'<li class="tool rv"><h3>{a}<small class="{"pro" if c=="Pro" else ""}">{c}</small></h3><p>{b}</p></li>' for a,b,c in tools)
br=[("alpaca.svg","Alpaca"),("tastytrade.svg","tastytrade"),("dhan.png","Dhan"),("oanda.png","OANDA"),("rithmic.png","Rithmic"),("ninja.png","NinjaTrader 8"),("mt5.png","MetaTrader 5"),("ibkr.png","Interactive Brokers"),("ironbeam.png","Ironbeam")]
B="".join(f'<div><img src="assets/images/brokers/{f}" width="32" height="32" alt="" loading="lazy"><span>{n}</span></div>' for f,n in br)
faq=[("Is it free?","Yes. Charts, Replay One, JournalX, Market Stats, the Screener, alerts and all 64 chapters are free with no card. Pro adds the order book and order flow tools and GEX+."),
("Does TradeZoro place trades for me?","No. Connecting a broker or data source is data only. We never place, change or cancel an order, and we never see your trading password if you use a key or sign-in."),
("Which markets can I chart?","Futures such as NQ, ES, YM, GC and CL, plus stocks, ETFs, forex and crypto. Futures prices are delayed by the exchange unless you connect your own data."),
("What do I need for the desktop bridge?","A Windows PC running NinjaTrader 8, MetaTrader 5 or Interactive Brokers TWS or Gateway. You pair it with a code from the Data source sheet. The helper is unsigned for now, so Windows will warn you; the help page walks through it."),
("Is this financial advice?","No. TradeZoro is education and tools only. Nothing on the site is a recommendation to buy or sell.")]
F="".join(f'<details><summary>{q}</summary><p>{a}</p></details>' for q,a in faq)
free=["ZoroCharts, 21 chart types, 16 charts","Replay One and paper trading","Liquidity Map, Market Stats, Screener","Alerts up to 1000, JournalX","64 chapters, ICT and smart money"]
pro=["Everything in Free","Order book heatmap, DOM ladder","Footprint, Delta, CVD, Big Trades","Delta ladder (L2), Volume Profile (L2)","GEX+ and options flow marks"]
li=lambda a:"".join(f"<li>{x}</li>" for x in a)
html=f'''<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="stryker-build" content="{V}">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<!-- DEMO HOMEPAGE "demo-real-b" v2 (Owner order 2026-11-04): built in the open. Unlisted: noindex, not in nav, sitemap or OG list.
     GENERATED by tools/demo-real-b/gen.py. Edit that, not this file. -->
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#0b0b0d">
<title>TradeZoro · Built in the open (demo)</title>
<meta name="description" content="Demo homepage: charts, order flow and GEX for futures traders, and what we shipped recently.">
<link rel="preload" href="assets/fonts/archivo-latin-variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="assets/fonts/jetbrains-mono-latin-variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/style.css?v={V}">
<link rel="stylesheet" href="assets/demo-real-b.css?v={V}">
<script>try{{var _t=localStorage.getItem('stryker_theme');if(_t==='day')document.documentElement.setAttribute('data-theme','light')}}catch(e){{}}</script>
<script src="assets/version-check.js?v={V}" defer></script>
<link rel="manifest" href="/manifest.json">
<link rel="icon" type="image/x-icon" href="assets/images/tradezoro-favicon-32-494.png?v={V}">
<link rel="icon" type="image/png" sizes="32x32" href="assets/images/tradezoro-favicon-32-494.png?v={V}">
<link rel="apple-touch-icon" sizes="180x180" href="assets/images/tradezoro-apple-touch-icon-494.png?v={V}">
</head>
<body class="rb">
<main id="main">
<section class="hero dk">
<div class="top"><div class="w"><a href="/" aria-label="TradeZoro home"><img src="assets/images/tradezoro-wordmark-1014-192.webp" width="192" height="45" alt="TradeZoro"></a>
<nav><a class="hide-s" href="#shipped">Shipped</a><a class="hide-s" href="#tools">Tools</a><a class="hide-s" href="#pro">Free and Pro</a><button type="button" data-nav-theme aria-label="Switch light or dark theme">Theme</button><a href="/login">Log in</a></nav></div></div>
<div class="w">
<h1>Order flow, GEX and practice tools. <span>In a browser.</span></h1>
<p class="lede">For futures traders on NQ and ES who want the order book, the options levels and a place to rehearse, without installing a thing. We change it most days, and write every change down below.</p>
<div class="row"><a class="btn p" href="/signup">Start free</a><a class="btn s" href="/charts">Open charts</a></div>
<div class="stage"><div class="frame">
<div class="bar"><b>NQ1!</b><span>15m</span><i>·</i><span>CME</span><i>·</i><span id="hero-tip" class="mono">recorded session, hover for bar values</span></div>
<canvas id="hero-cv" class="cv" role="img" aria-label="Animated NQ1! 15 minute candlestick chart drawn from recorded bars"></canvas>
</div></div>
</div>
<div class="w"><div class="facts"><div><b data-count="21">21</b><span>chart types</span></div><div><b data-count="16">16</b><span>charts in one layout</span></div><div><b data-count="1000">1000</b><span>alerts per account</span></div><div><b data-count="64">64</b><span>chapters, ICT and smart money</span></div></div></div>
</section>

<section class="sec dk" id="see" style="border-bottom:1px solid var(--rd-line)"><div class="w">
<p class="kick rv">The tools</p>
<h2 class="h2 rv">See where size sits. <em>Then see what the options market is pinned to.</em></h2>
<div class="tabs" id="tabs" role="tablist" aria-label="Tool previews">
<button role="tab" id="t1" aria-selected="true" aria-controls="p1">Heatmap</button><button role="tab" id="t2" aria-selected="false" tabindex="-1" aria-controls="p2">Footprint</button><button role="tab" id="t3" aria-selected="false" tabindex="-1" aria-controls="p3">GEX</button><button role="tab" id="t4" aria-selected="false" tabindex="-1" aria-controls="p4">Replay</button></div>
<div class="pane on" id="p1" role="tabpanel" aria-labelledby="t1"><div class="txt"><h3>Liquidity heatmap</h3><p>Resting orders drawn by price over time, behind the candles. Bright bands are size sitting in the book. When one disappears, you see it go.</p><ul><li><b>Shows</b> book depth, large resting orders, pulled and refilled size</li><li><b>Pairs with</b> DOM ladder, Delta ladder (L2)</li><li class="tag">Pro</li></ul></div><div class="shot">{img('heatmap','The liquidity heatmap behind a one minute candle chart with a depth ladder at the right edge',1126,560,'main')}</div></div>
<div class="pane" id="p2" role="tabpanel" aria-labelledby="t2"><div class="txt"><h3>Footprint</h3><p>Each candle opened up into the volume traded at every price, split into sellers on the left and buyers on the right. Boxes mark the heaviest level in the bar. Delta sits under each candle.</p><ul><li><b>Shows</b> bid and ask volume per price, delta per bar, volume</li><li><b>Pairs with</b> CVD, Big Trades, Absorption</li><li class="tag">Pro</li></ul></div><div class="shot">{img('footprint','NQ1! one minute footprint chart with bid and ask volume inside each candle and delta under it',1290,672,'main')}</div></div>
<div class="pane" id="p3" role="tabpanel" aria-labelledby="t3"><div class="txt"><h3>GEX+</h3><p>Dealer gamma by strike for SPX, SPY, QQQ, ES, NQ and gold. A heatmap by expiry, and the call wall, put wall and zero gamma drawn on your own chart.</p><ul><li><b>Shows</b> net GEX, regime, walls, zero gamma, strike profile</li><li><b>Pairs with</b> any futures chart</li><li class="tag">Pro</li></ul></div><div class="shot">{img('gex','SPX GEX heatmap by strike through the session with a strike profile on the right',1360,830,'main')}<img class="cut a" src="{I}gex-levels.webp?v={V}" width="740" height="712" alt="Market-generated prior day levels" loading="lazy"><img class="cut b" src="{I}gex-regime.webp?v={V}" width="740" height="230" alt="Spot, positive gamma regime and net GEX" loading="lazy"></div></div>
<div class="pane" id="p4" role="tabpanel" aria-labelledby="t4"><div class="txt"><h3>Replay One</h3><p>Pick any point in the loaded history, hide everything after it, and step forward one bar at a time. Paper trades run on a separate account. Try it right below.</p><ul><li><b>Shows</b> your chart, one bar at a time</li><li><b>Pairs with</b> paper trading, JournalX</li><li class="tag">Free</li></ul></div><div class="shot">{img('replay','ZoroCharts replay: a chart with the bar replay menu open',1400,752,'main')}<img class="cut a" src="{I}replay-menu.webp?v={V}" width="620" height="600" alt="Bar replay menu: select bar, select date, random bar, first available bar" loading="lazy"></div></div>
</div></section>

<section class="sec paper" id="try"><div class="w">
<p class="kick rv">Try it</p>
<h2 class="h2 rv">Drag the bar. <em>Same recorded NQ session, same replay idea.</em></h2>
<div class="frame dk rp rv" style="border-radius:10px;border-bottom:1px solid var(--rd-line)"><div class="bar"><b>NQ1!</b><span>15m</span><i>·</i><span>Replay</span></div>
<canvas id="rp-cv" class="cv" role="img" aria-label="NQ1! chart in replay mode; use the slider to move through bars"></canvas>
<div class="ctl"><button id="rp-play" aria-pressed="false">Play</button><button id="rp-step" aria-label="Step one bar">+1</button><label class="sr" for="rp-sl" style="position:absolute;left:-9999px">Replay position</label><input id="rp-sl" type="range" min="40" max="300" step="1" value="150"><span id="rp-t" class="mono">bar 150</span></div></div>
</div></section>

<section class="sec dk" id="layout" style="border-top:1px solid var(--rd-line)"><div class="w">
<div class="lay-h"><div><p class="kick rv">ZoroCharts</p><h2 class="h2 rv">Build your layout. <em>One chart, or sixteen.</em></h2></div>
<div class="seg rv" id="lay-seg" role="group" aria-label="Number of charts"><button data-n="1" aria-pressed="false">1</button><button data-n="2" aria-pressed="false">2</button><button data-n="4" aria-pressed="true">4</button><button data-n="16" aria-pressed="false">16</button></div></div>
<div class="lay n4" id="lay"></div>
<p class="note" style="color:var(--rd-ink2)">NQ, ES, YM, GC and CL, from the same recorded session. Save the layout and share it.</p>
</div></section>

<section class="sec paper" id="shipped" style="border-bottom:1px solid #d9d5ca"><div class="w">
<p class="kick rv">Built in the open</p>
<h2 class="h2 rv">Recently shipped. <em>Dates in IST, build numbers from our release log.</em></h2>
<ol class="log">{"".join(L)}</ol>
</div></section>

<section class="sec" id="tools"><div class="w">
<p class="kick rv">Everything inside</p>
<h2 class="h2 rv">Twelve tools. <em>One login, no install.</em></h2>
<ul class="tools">{T}</ul>
</div></section>

<section class="sec" style="padding-top:0"><div class="w" style="border-top:1px solid var(--line);padding-top:52px">
<p class="kick rv">Works with your broker</p>
<h2 class="h2 rv">Bring your own data. <em>We only read it.</em></h2>
<div class="brk rv">{B}</div>
<p class="note">Connect sources are data only. TradeZoro never places, changes or cancels trades. NinjaTrader 8, MT5 and IBKR connect through the desktop helper.</p>
</div></section>

<section class="sec" id="pro" style="padding-top:0"><div class="w" style="border-top:1px solid var(--line);padding-top:52px">
<p class="kick rv">Free and Pro</p>
<h2 class="h2 rv">Most of it is free. <em>Pro is the order book.</em></h2>
<div class="fp rv"><div><h3>Free</h3><p class="s">No card.</p><ul>{li(free)}</ul><div class="row"><a class="btn p" href="/signup">Start free</a></div></div>
<div><h3>Pro</h3><p class="s">For order flow and GEX.</p><ul>{li(pro)}</ul><div class="row"><a class="btn s" href="/pricing">See Pro</a></div></div></div>
</div></section>

<section class="sec" id="faq" style="padding-top:0"><div class="w faq-g" style="border-top:1px solid var(--line);padding-top:52px">
<h2 class="h2 rv">Questions</h2><div class="faq rv">{F}</div></div></section>

<section class="fin dk"><div class="w"><h2>Open the charts. <span>It takes a minute.</span></h2>
<div class="row"><a class="btn p" href="/signup">Start free</a><a class="btn s" href="/charts">Open charts</a></div></div></section>
</main>
<footer class="foot dk"><div class="w"><p>Education only. Not financial advice. Recorded NQ, ES, YM, GC and CL bars on this page are shown for illustration of how the charts work.</p><p><a href="/about">About</a><a href="/help">Help</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a></p></div></footer>
<script src="assets/demo-real-b.js?v={V}" defer></script>
<script src="assets/theme.js?v={V}"></script>
</body>
</html>
'''
open('demo-real-b.html','w').write(html)
print(len(html))
