#!/usr/bin/env python3
"""FEATB page specs (19 Nov 2026) for the shared feature-page template: charts, indicators, backtesting, journal, models.
Uses tools/feature-pages/build.py (build_main + write) unchanged; screenshots come from shoot-zc.js + shoot-apps.js,
cropped by crop-b.py into assets/images/features/<page>/. Run: python3 tools/feature-pages/specs_b.py [page ...]
Feature index lists are the real feature set: indicators from tools/indicator-pages/registry.json (the TradeZoro group
of the Indicators window), models from assets/models-data.js, the rest from the tools' own screens. Counts are computed.
Copy rules: no prices, no results/win-rate claims, no vendor/exchange/data-provider names, no "real-time"/"delayed"."""
import json, pathlib, re, subprocess, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import build  # noqa: E402

ROOT = build.ROOT
BANNED = re.compile(r'TradingView|LuxAlgo|Vela|Skylit|Rithmic|Binance|Coinbase|Hyperliquid|Bybit|OKX|Bitget|Kraken|Yahoo|FINRA|'
                    r'real-?time|delayed|win rate|\$\s?\d', re.I)
IDS = dict(pair='problem', steps='tour', bento='more', values='how', index='list')

def registry_desc():
    r = json.loads((ROOT / 'tools/indicator-pages/registry.json').read_text())
    return {x['key']: x['desc'] for x in r['window']['stryker']}

def models():
    js = ("const fs=require('fs'),vm=require('vm');const c={window:{}};vm.createContext(c);"
          "vm.runInContext(fs.readFileSync('assets/models-data.js','utf8')+';this.M=MODELS_SEED',c);"
          "process.stdout.write(JSON.stringify(c.M.map(m=>({id:m.id,name:m.name,group:m.group,summary:m.summary,steps:(m.steps||[]).length}))))")
    return json.loads(subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True, check=True).stdout)

def model_groups():
    s = (ROOT / 'assets/models-list.js').read_text()
    return re.findall(r"'([^']+)'", re.search(r'MODEL_GROUPS = \[([^\]]+)\]', s).group(1))

def first_sentence(s):
    m = re.match(r'(.+?[.!?])(\s|$)', s.strip())
    return (m.group(1) if m else s).strip()

# ---------------------------------------------------------------- charts
def charts_spec():
    return dict(
      page='charts', tool='ZoroCharts', crumb='ZoroCharts', icon='zorocharts', chip=('ZoroCharts', 'Charting'),
      open='/charts', guide=None,
      h1='The whole charting desk, <em>in your browser</em>.',
      intro='Futures, crypto and forex charts with indicators, Pine scripts, drawings and up to 8 charts on one screen. '
            'Order flow, GEX levels, bar replay, paper trading and alerts sit on the same chart, on your phone and your desktop.',
      fine='The charts are free on every plan. Screens are the real tool on sample data. Education only. Not financial advice.',
      hero=('hero', 'ZoroCharts on a 5-minute NQ chart with moving averages, VWAP and drawings. Sample data.', 'ZoroCharts · NQ · 5m'),
      ids=dict(pair='problem', steps='build', bento='more', values='why', index='data'),
      pair_h2='One chart instead of a stack of apps',
      problem=['Charts in one app, order flow in another and options levels in a spreadsheet.',
               'Layouts, drawings and scripts stuck on one computer.',
               'Practising means a separate replay tool and a separate demo account.'],
      solution=['Indicators, Pine scripts, order flow and GEX levels on the same chart.',
                'Layouts, drawings, templates and scripts saved to your account, on any device.',
                'Bar replay and paper trading with demo money, built into the chart.'],
      steps_lead='Five steps from an empty chart to a saved, shareable layout.',
      stage_label='ZoroCharts · sample data',
      steps=[
        dict(t='Pick a market', img='symbols', alt='The symbol search in ZoroCharts listing futures, crypto and forex markets. Sample data.',
             p='Search futures, crypto or forex and choose an interval, from seconds and minutes to months.'),
        dict(t='Add indicators and Pine scripts', img='indicators', alt='The Indicators window: groups on the left, a searchable list of studies and scripts. Sample data.',
             p='One window holds the built-in studies, the TradeZoro scripts and Pine scripts, each with its own inputs and style.'),
        dict(t='Draw on it', img='hero', id='drawings', alt='Trend lines and levels drawn on an NQ chart. Sample data.',
             p='Trend lines, boxes, Fibonacci tools, patterns and the long and short position tool, with a magnet that snaps to the candle.'),
        dict(t='Lay out up to 8 charts', img='grid', id='layouts', alt='Four charts in a 2 x 2 grid in ZoroCharts. Sample data.',
             p='Pick from 15 multi-chart arrangements and link the charts so symbol, interval, crosshair and time move together.'),
        dict(t='Save and share', img='light', id='library', alt='ZoroCharts in the light theme with a saved layout. Sample data.',
             p='Save the layout to your account, then keep it private, share it by link, publish it to the Chart Library or to your community.'),
      ],
      bento=[
        dict(t='TradeZoro indicators', img='tz-indicator', id='indicators', alt='Liquidity Master drawing session and previous-day liquidity on an NQ chart. Sample data.',
             p='Our own scripts mark liquidity, fair value gaps, SMT and higher-timeframe candles on the chart.'),
        dict(t='Order flow', img='footprint', id='orderflow', alt='Footprint candles split into prices with sell and buy volume. Sample data.', pos='50% 30%',
             p='Footprint, delta, CVD, big trades and the order book heatmap, built from real trades.'),
        dict(t='GEX levels on the chart', img='gex', id='gex', alt='GEX call wall, zero gamma and put wall lines on an NQ chart. Sample data.',
             p='Call wall, zero gamma and put wall from Omega, each stamped with when it was last updated.'),
        dict(t='Bar replay', img='replay', id='practice', alt='Bar replay in ZoroCharts with the future bars hidden. Sample data.', pos='50% 40%',
             p='Hide the future and step through a past session bar by bar. Indicators and order flow replay too.'),
        dict(t='Built for the phone', img='phone', id='everywhere', alt='ZoroCharts on a phone: a full-screen NQ chart. Sample data.', pos='50% 20%',
             p='Pinch to zoom, drag to pan, and menus open as sheets. Your layouts follow you.'),
        dict(t='Paper trading', img='paper', alt='The paper order ticket: market buy with a take profit and a stop loss in ticks. Sample data.', pos='30% 30%',
             p='Simulated orders with demo money, filled against the chart. Nothing reaches a broker.'),
      ],
      values=[
        ('spark', 'What’s unique', 'Order flow and GEX on your chart', 'The levels and tools other platforms keep in separate apps sit on the chart you already mark up.'),
        ('clock', 'Time it saves', 'Nothing to install or rebuild', 'Open a browser, sign in, and your layouts, drawings and scripts are already there.'),
        ('swap', 'What it replaces', 'A desktop platform plus add-ons', 'Charts, replay, paper trading and alerts in one place, free on every plan.'),
      ],
      index=[
        ('Markets and data', [
          ('Futures, crypto and forex', 'Search every market from one box; a small dot and pill show which feed the chart is on.'),
          ('Intervals', 'Seconds, minutes, hours, days and months, with favourites and custom intervals.'),
          ('21 chart types', 'Candles, hollow and volume candles, bars, line, area, baseline, Heikin Ashi, Renko, Range, Kagi, Point & Figure and more.'),
          ('Endless scroll-back', 'Older bars load as you scroll left.'),
          ('Symbol info', 'Contract specs: tick size, point value and front contract.'),
          ('Market Data Terms', 'How each market’s data is sourced is set out in our Market Data Terms.'),
        ]),
        ('Indicators and scripts', [
          ('Built-in studies', 'Moving averages, VWAP, Bollinger Bands, RSI, MACD, volume profile and more.'),
          ('TradeZoro scripts', 'Liquidity, SMT, fair value gap and higher-timeframe scripts built around the curriculum.'),
          ('Pine editor', 'Write or paste a Pine script; it runs in your browser and saves to My scripts.'),
          ('Community scripts', 'Ready-made scripts credited to their authors, with a safety check before they run.'),
          ('Style tab', 'Colours, widths and visibility per timeframe for every indicator.'),
          ('Templates', 'Keep a set of indicators and drop it on any chart.'),
        ]),
        ('Drawing', [
          ('Lines and Fibonacci', 'Trend lines, rays, horizontal and vertical lines, Fibonacci retracements and extensions.'),
          ('Patterns, shapes and text', 'Patterns, measurements, boxes, notes and arrows, each with its own settings.'),
          ('Long and short position tool', 'Plan entry, stop and target with the risk-to-reward shown as you drag. It places no orders.'),
          ('Magnet', 'Snaps a drawing to the candle’s open, high, low or close.'),
          ('Favourites bar', 'Star the tools you use and drag the small bar anywhere.'),
          ('Keyboard shortcuts', '/ for indicators, Alt T trend line, Alt H horizontal line, Alt V vertical line.'),
        ]),
        ('Layouts and sharing', [
          ('Multi-chart', '15 arrangements, up to 8 charts, linked by symbol, interval, crosshair, time and date range.'),
          ('Saved to your account', 'Layouts, drawings, templates, scripts and favourites follow you to another device.'),
          ('Chart Library', 'Save a layout as private, link only, public or for your community.'),
          ('Browse and load', 'Like, star and load what other members publish in one click.'),
        ]),
        ('Order flow and GEX', [
          ('Footprint, delta and CVD', 'Every candle split into prices with buy and sell volume, plus delta and cumulative delta.'),
          ('Big trades and absorption', 'Bubbles where size traded and marks where a push was absorbed.'),
          ('Order book heatmap', 'Resting orders at every price behind the candles.'),
          ('GEX Levels and Heatmap', 'Omega’s call wall, zero gamma and put wall, and net GEX by strike behind the candles.'),
          ('Expected Move and ZoroTide', 'The options-implied range, and options money flow for calls against puts.'),
        ]),
        ('Practice and alerts', [
          ('Bar replay', 'Pick a date or a random bar, then step, play or jump.'),
          ('Paper trading', 'Simulated orders with demo money, off until you switch it on.'),
          ('Alerts', 'Price alerts and alerts on your indicators, with sounds and push notifications.'),
          ('Economic events and news', 'Calendar events, session breaks and headline markers on the bars.'),
          ('Countdown to bar close', 'On the price scale, next to the last price.'),
          ('Dark and light themes', 'The chart follows the site theme on every device.'),
        ]),
      ],
      related=[
        ('/features/orderflow', 'liquidity-map', 'Order Flow', 'Footprint, delta and the book on the same chart.'),
        ('/features/gex', 'omega', 'Omega', 'The options levels behind the GEX indicators.'),
        ('/features/backtesting', 'kronos', 'Kronos', 'Full replay sessions with orders, logs and review.'),
      ],
      faq_h2='Before you open a chart',
      faq=[
        ('Is ZoroCharts free?', 'Yes. Every chart type, interval, indicator, drawing, layout, alert, paper trading and bar replay is on every plan. Order flow tools and GEX on the charts are free too.'),
        ('Can I trade from the chart?', 'Only with demo money. Paper trading fills simulated orders against the chart. TradeZoro never places real orders.'),
        ('Can I use my own Pine scripts?', 'Yes. Paste a script into the Pine editor and it runs in your browser. Your scripts are saved to your account. Community scripts get a safety check before they run.'),
        ('How do I share a chart?', 'Save the layout, then pick Link only, Public or Community in the Chart Library. Link only copies a link that any signed-in member can open.'),
        ('Does it work on my phone?', 'Yes. The chart is built for touch: pinch to zoom, drag to pan, and the menus open as sheets. Your layouts follow you between phone and desktop.'),
        ('Whose charting engine is it?', 'ZoroCharts is built on an open-source charting library released under the Apache-2.0 licence, with our own tools on top. The library is credited in the chart’s Credits panel.'),
      ],
      final=('Open a chart in a few seconds', 'Nothing to install. Make an account, pick a market and start marking it up.'),
    )

# ---------------------------------------------------------------- indicators
def indicators_spec():
    D = registry_desc()
    clean = lambda s: re.sub(r'\s*\((SPX|gold)[^)]*\)|\.? ?FINRA data,', '', s).replace('  ', ' ').strip().rstrip('.') + '.'
    return dict(
      page='indicators', tool='TradeZoro indicators', crumb='Private Indicators', icon='zorocharts', chip=('Private Indicators', 'on ZoroCharts'),
      open='/indicators', guide='/indicators/liquidity-master',
      h1='The concepts you learn, <em>marked on the chart</em>.',
      intro='Our indicators automate one idea from the curriculum each: liquidity, SMT divergence, fair value gaps, sweeps and higher-timeframe candles. '
            'Add them in ZoroCharts in one click, and every one has its own guide.',
      fine='Indicators mark concepts on the chart; they are not trade signals. Screens are the real tool on sample data. Education only. Not financial advice.',
      hero=('hero', 'Liquidity Master on a 5-minute NQ chart in ZoroCharts: session and previous-day highs and lows marked. Sample data.', 'ZoroCharts · Liquidity Master'),
      ids=dict(pair='story', steps='access', bento='suite', values='how', index='list'),
      pair_h2='Stop redrawing the same levels every morning',
      problem=['Marking session highs, lows and gaps by hand takes time before every session.',
               'Two traders mark the same concept two different ways.',
               'A script you cannot read is a black box you cannot learn from.'],
      solution=['Each indicator marks one concept from the curriculum the same way, every time.',
                'Every indicator has a guide page: what it marks, how it works and its settings.',
                'They run in ZoroCharts next to your own drawings, on any device.'],
      steps_lead='Four steps from the library to a marked-up chart.',
      stage_label='TradeZoro indicators · sample data',
      steps=[
        dict(t='Browse the library', img='catalog', alt='The indicator library listing every ZoroCharts indicator by group. Sample data.',
             p='The Indicators page lists every indicator by group, with what it shows and a link to its guide.'),
        dict(t='Add it in ZoroCharts', img='window', alt='The ZoroCharts Indicators window with the TradeZoro group open. Sample data.',
             p='Open the Indicators window, pick the TradeZoro group and click an indicator. No other account needed.'),
        dict(t='Read the marks', img='liquidity-master', alt='Liquidity Master marking liquidity levels on an NQ chart. Sample data.',
             p='The indicator draws its levels, boxes and labels on the chart. Change inputs and colours in its settings.'),
        dict(t='Learn what it marks', img='guide', alt='The Liquidity Master guide page with a chart example. Sample data.',
             p='Each guide explains the concept, how the script finds it and what every setting does.'),
      ],
      bento=[
        dict(t='Liquidity Master', img='liquidity-master', alt='Liquidity Master levels on an NQ chart. Sample data.',
             p='Session, previous day, week and month highs and lows, swing liquidity and higher-timeframe gaps.'),
        dict(t='IFVG Pro+', img='ifvg', alt='IFVG Pro+ marking inversion fair value gaps with labels. Sample data.', pos='60% 40%',
             p='Liquidity, the sweep, the candidate gap and the inversion box.'),
        dict(t='Session Sweep SMT + IFVG', img='sweep', alt='Session Sweep SMT + IFVG marks on an NQ chart. Sample data.', pos='60% 30%',
             p='Session highs and lows, the sweep of each, SMT and the gap that follows. Marks only.'),
        dict(t='TZ Fractal Model', img='fractal', alt='TZ Fractal Model marks on an NQ chart. Sample data.', pos='80% 30%',
             p='A higher-timeframe sweep model with right-side candles and confirmation marks.'),
        dict(t='A guide for every indicator', img='guide', alt='An indicator guide page. Sample data.', pos='50% 30%',
             p='What it marks, how it works and every setting, on its own page.'),
      ],
      values=[
        ('spark', 'What’s unique', 'Built around the curriculum', 'Each script marks a concept you study in Mentis, so the chart and the lesson use the same words.'),
        ('clock', 'Time it saves', 'Levels ready when you open the chart', 'Highs, lows, gaps and sweeps are marked before you start, the same way every day.'),
        ('swap', 'What it replaces', 'Hand-drawn levels and loose scripts', 'One library of indicators with guides, inside the chart you already use.'),
      ],
      index=[
        ('Concept scripts', [
          ('Liquidity Master', clean(D['x:liquidity-master-tradezoro'])),
          ('SMT Divergence Pro', clean(D['x:smt-pro-stryker'])),
          ('IFVG Pro+', clean(D['x:ifvg-pro-stryker'])),
          ('FVG Relay', clean(D['x:fvg-relay-stryker'])),
          ('HTF PO3 Lens', clean(D['x:htf-po3-lens-stryker'])),
          ('TZ Fractal Model', clean(D['x:tz-fractal-model'])),
          ('Session Sweep SMT + IFVG', clean(D['x:session-sweep-smt-ifvg'])),
        ]),
        ('Options and GEX', [
          ('GEX Levels', 'Call wall, put wall, zero gamma, the implied range and prior-session levels from Omega.'),
          ('GEX Heatmap', clean(D['b:stk_gexheat'])),
          ('Expected Move', clean(D['b:stk_em'])),
          ('ZoroTide', clean(D['b:stk_tide'])),
          ('Options Flow Marks', clean(D['b:stk_optflow'])),
          ('Delta Exposure', clean(D['b:stk_dex'])),
          ('Vanna Exposure', clean(D['b:stk_vex'])),
          ('Charm Exposure', clean(D['b:stk_cex'])),
        ]),
        ('Market context', [
          ('Off-exchange Volume', 'Daily off-exchange share of volume in a lower pane, from public regulatory data, updated daily.'),
          ('Off-exchange levels', 'Price levels where weekly off-exchange volume clustered, updated weekly.'),
          ('Dark Pool Prints', 'Large off-exchange stock trades drawn at their price and time, sized by value. US stocks and ETFs.'),
          ('Wallet Intel', 'On supported crypto perpetual charts: tap a candle to see the tracked wallets that traded it.'),
          ('Economic events', clean(D['b:stk_econ'])),
          ('News markers', clean(D['b:stk_news'])),
        ]),
        ('Everyday helpers', [
          ('EMA 9/21 cross', 'Two moving averages with the crosses marked.'),
          ('Session VWAP', 'VWAP that resets each session.'),
          ('Previous day high/low', 'Yesterday’s high and low carried onto today’s chart.'),
        ]),
      ],
      related=[
        ('/features/charts', 'zorocharts', 'ZoroCharts', 'The chart every indicator runs on.'),
        ('/features/curriculum', 'mentis', 'Curriculum', 'The lessons behind each concept the scripts mark.'),
        ('/features/gex', 'omega', 'Omega', 'The options levels behind the GEX indicators.'),
      ],
      faq_h2='Before you add an indicator',
      faq=[
        ('Where do I use them?', 'In ZoroCharts. Open the Indicators window, pick the TradeZoro group and add one. No other account is needed.'),
        ('Are these buy and sell signals?', 'No. Each script marks a concept the curriculum teaches, so you learn why a level matters and then let the script do the marking.'),
        ('Can I change how they look?', 'Yes. Every indicator has inputs and a Style tab for colours, widths and visibility per timeframe.'),
        ('Where can I read how one works?', 'Every indicator has its own guide page in the indicator library, with what it marks and every setting.'),
        ('Can I use them outside ZoroCharts?', 'If your plan includes it, you can request access on the Indicator access page. Access is set up by hand, so it can take a little time.'),
      ],
      final=('Put the concepts on your chart', 'Open the indicator library, pick one and add it in ZoroCharts.'),
    )

# ---------------------------------------------------------------- backtesting
def backtesting_spec():
    return dict(
      page='backtesting', tool='Kronos', crumb='Kronos', icon='kronos', chip=('Kronos', 'Replay & Backtesting'),
      open='/backtests', guide=None,
      h1='Practise on past charts, <em>one bar at a time</em>.',
      intro='Pick a market and a past date and the chart stops there. Step forward, place simulated orders with a stop and a target, '
            'tag what you did, then review every session on a dashboard.',
      fine='Every figure in these screens is demo data, and result figures are blurred. Education only. Not financial advice.',
      hero=('hero', 'A Kronos replay session on NQ: the chart stops at the replay clock, with buy and sell buttons below. Sample data.', 'Kronos · NQ replay'),
      ids=IDS,
      pair_h2='Practice you can actually review',
      problem=['Scrolling back through a chart shows you the answer before you decide.',
               'Practice trades on paper are hard to count and easy to forget.',
               'Without a log, you can’t tell a good session from a lucky one.'],
      solution=['The chart only shows what had happened up to the replay clock.',
                'Every practice trade is logged with side, size, entry, exit, R and why it closed.',
                'Tags, notes and a dashboard across all your sessions.'],
      steps_lead='Five steps from picking a date to reviewing the session.',
      stage_label='Kronos · sample data',
      steps=[
        dict(t='Start a session', img='replay', alt='A Kronos replay of NQ with sessions shaded and an EMA. Sample data.',
             p='Choose a market, an interval and a past date. Play, step one or ten bars, or jump to the next day.'),
        dict(t='Place a simulated trade', img='review', alt='The trade review card in Kronos with setup and mistake tags. Sample data.',
             p='Buy or sell from the chart or the ticket with a stop and a target. When it closes, tag the setup and any mistake.'),
        dict(t='Check every trade', img='trades', alt='The Kronos trades table with side, size, entry, exit, R and exit reason. Sample data.',
             p='Every closed practice trade in one table, filterable by market, side, session, setup, day and time.'),
        dict(t='Read the dashboard', img='dashboard', alt='The Kronos dashboard with the practice equity curve and winner and loser stats. Sample data.',
             p='One dashboard across your sessions: equity curve, winners against losers and how long trades were held.'),
        dict(t='Dig into the numbers', img='analytics', alt='Kronos analytics: performance, drawdown and simulation tabs. Sample data.',
             p='Performance, drawdown and a trade-order simulation, all from your own practice trades.'),
      ],
      bento=[
        dict(t='Bar-by-bar replay', img='replay', alt='Kronos replay with session shading. Sample data.', pos='30% 40%',
             p='Hide the future and step through the session at your own pace.'),
        dict(t='Saved sessions', img='sessions', alt='The Kronos sessions list with one card per backtest. Sample data.', pos='0% 0%',
             p='Every backtest is a card you can resume on another device.'),
        dict(t='Tag every trade', img='review', alt='Setup and mistake tags on a closed practice trade. Sample data.', pos='50% 40%',
             p='Setup, mistakes and a note on each trade, so the review has words, not just numbers.'),
        dict(t='Filters that match your plan', img='trades', alt='Kronos trade filters. Sample data.', pos='0% 0%',
             p='Slice trades by market, side, session, setup, weekday and time of day.'),
        dict(t='Replay on ZoroCharts', img='zc-replay', alt='Bar replay in ZoroCharts. Sample data.', pos='50% 40%',
             p='The same replay is on every ZoroCharts chart for a quick look back.'),
      ],
      values=[
        ('spark', 'What’s unique', 'Replay, orders and review in one tool', 'The session, the trades and the review live together, so nothing has to be copied across.'),
        ('clock', 'Time it saves', 'Weeks of sessions in an afternoon', 'Step through past sessions as fast as you can read them, instead of waiting for the market.'),
        ('swap', 'What it replaces', 'A spreadsheet of practice trades', 'Every trade is logged for you, with tags, notes and the stats worked out.'),
      ],
      index=[
        ('Replay', [
          ('Bar-by-bar replay', 'The chart shows only what had happened up to the replay clock.'),
          ('Step and play', 'Step one or ten bars, play at a chosen speed, or jump to the next day.'),
          ('Higher-timeframe chart', 'A second, higher-timeframe chart beside the replay.'),
          ('Session shading', 'New York and London sessions shaded on the chart.'),
          ('Markets', 'Futures, forex and crypto candles, or your own CSV.'),
          ('Timeframes', '1 minute up to weekly.'),
          ('Indicators and drawings', 'The ZoroCharts indicators and drawing tools inside the replay.'),
        ]),
        ('Orders', [
          ('Market orders', 'Buy or sell from the chart strip or the ticket.'),
          ('Stop and target', 'Attach a stop and a target in ticks; close part of a position.'),
          ('Commission and slippage', 'Set them per session.'),
          ('Stated fill rules', 'Market orders fill at the last close plus slippage, gaps fill at the open, and if one bar hits both stop and target the stop counts first.'),
        ]),
        ('Review', [
          ('Trade log', 'Side, size, entry, exit, R-multiple, time held and why it closed.'),
          ('Setup and mistake tags', 'Tag each closed trade and add a note.'),
          ('Dashboard', 'Equity curve, winners against losers and hold times across all sessions.'),
          ('Analytics', 'Performance, drawdown and simulation tabs with the same filters as the trade log.'),
          ('Trade-order simulation', 'Shuffles the order of your practice trades to show how the same trades could have swung. Not a forecast.'),
          ('The coach', 'Rule-based checks on your practice trades: streaks, overtrading, re-entries after a loss.'),
        ]),
        ('Sessions and export', [
          ('Saved sessions', 'Saved in your browser with a copy on your account, so you can resume elsewhere.'),
          ('Export', 'Export trades to CSV or send them to Nemesis.'),
        ]),
      ],
      related=[
        ('/features/journal', 'nemesis', 'Nemesis', 'Send practice trades to your journal.'),
        ('/features/charts', 'zorocharts', 'ZoroCharts', 'The chart engine and tools inside every replay.'),
        ('/features/models', 'mentis', 'Trading Models', 'Practise one written model at a time.'),
      ],
      faq_h2='Before you start a session',
      faq=[
        ('Are the orders real?', 'No. Kronos is simulated practice. TradeZoro never places real orders.'),
        ('How are fills worked out?', 'Market orders fill at the last close plus any slippage you set, gaps fill at the open, and if one bar touches both stop and target the stop counts first. Real fills can differ.'),
        ('Is the coach AI?', 'No. It is a fixed set of rules that runs in your browser on your own trades.'),
        ('Where do sessions live?', 'In your browser as you go, with a copy on your account so you can resume elsewhere.'),
        ('Does it predict anything?', 'No. The simulation re-orders trades you already took. It is not a forecast.'),
      ],
      final=('Practise before it counts', 'Pick a market and a past date and start stepping through it.'),
    )

# ---------------------------------------------------------------- journal
def journal_spec():
    return dict(
      page='journal', tool='Nemesis', crumb='Nemesis', icon='nemesis', chip=('Nemesis', 'Trading Journal'),
      open='/trade-journal', guide=None,
      h1='A journal that makes your trading <em>measurable</em>.',
      intro='Log the trade, name the setup, record the outcome. Then review whether you followed your plan, with a dashboard, calendar, '
            'analytics, a rule-based coach and prop-firm tools, all worked out from your own entries.',
      fine='Every figure in these screens is the built-in demo data, and money figures are blurred. Education only. Not financial advice.',
      hero=('hero', 'The Nemesis dashboard: coach summary, TradeZoro Score radar and stat tiles. Demo data, figures blurred.', 'Nemesis · Dashboard'),
      ids=IDS,
      pair_h2='From a pile of trades to a clear review',
      problem=['Trades scattered across broker statements and screenshots.',
               'No way to see which setup or session is costing you.',
               'Prop-firm fees and payouts tracked on a notes app, if at all.'],
      solution=['Every trade in one journal, added by hand or imported from a file.',
                'Breakdowns by setup, session, weekday, instrument and direction.',
                'Fees, payouts and status per prop-firm account, in one place.'],
      steps_lead='Five steps from logging a trade to knowing what to fix first.',
      stage_label='Nemesis · demo data',
      steps=[
        dict(t='Log a trade', img='add', alt='The Add trade form: instrument, direction, date, prices, size, session and setup. Demo data.',
             p='Instrument, direction, prices, size, session, setup and a note. The numbers fill in as you type.'),
        dict(t='Or import a file', img='import', alt='Nemesis history: import trades, payouts and expenses, export CSV. Demo data.',
             p='Import trades from your broker’s export file, plus payouts and expenses. Export everything as CSV.'),
        dict(t='Read the dashboard', img='dashboard', alt='The Nemesis dashboard. Demo data, figures blurred.',
             p='The headline numbers, the TradeZoro Score radar and gauges, scoped by the range you pick.'),
        dict(t='Check the calendar', img='calendar', alt='The Nemesis calendar month grid. Demo data, figures blurred.',
             p='Every trading day on a month grid. Switch each day between P&L, trade count and wins and losses.'),
        dict(t='Fix what the coach flags', img='coach', alt='The Nemesis coach with discipline score and tagged findings. Demo data, figures blurred.',
             p='Rule-based checks on your own journal, tagged leak, strength or pattern, with three things to do this week.'),
      ],
      bento=[
        dict(t='Analytics', img='analytics', alt='Nemesis analytics by instrument and by setup. Demo data, figures blurred.', pos='0% 0%',
             p='Break the journal down by setup, session, day, instrument, direction and account.'),
        dict(t='Playbook', img='playbook', alt='The Nemesis playbook with one card per strategy. Demo data, figures blurred.', pos='0% 20%',
             p='One card per strategy with its rules, ranked by how each one is doing in your journal.'),
        dict(t='Prop firms', img='propfirms', alt='The prop-firm tracker: fees, payouts and funded accounts. Demo data, figures blurred.', pos='0% 0%',
             p='Fees paid, payouts received and status for every evaluation and funded account.'),
        dict(t='Equity and daily charts', img='charts', alt='Cumulative and daily P&L charts. Demo data.',
             p='Cumulative results next to daily results, so one outsized day stands out.'),
        dict(t='The coach', img='coach', alt='Coach findings. Demo data, figures blurred.', pos='50% 60%',
             p='A fixed rule set that runs in your browser. Not a chatbot.'),
      ],
      values=[
        ('spark', 'What’s unique', 'Built for how you were taught', 'Setups match the trading models, so your journal and your study use the same names.'),
        ('clock', 'Time it saves', 'Review in minutes, not evenings', 'The breakdowns, calendar and coach are worked out the moment you log a trade.'),
        ('swap', 'What it replaces', 'A spreadsheet and a prop-firm notebook', 'Trades, fees and payouts in one journal, private to your account.'),
      ],
      index=[
        ('Log', [
          ('Add trade', 'Instrument, direction, date and time, prices, size, fees, stop, target, session, setup and notes.'),
          ('Import trades', 'Bring trades in from a broker export file, with column mapping.'),
          ('Import payouts and expenses', 'Add prop-firm payouts and costs from a file.'),
          ('History', 'Every trade, newest first, with search and filters.'),
          ('Export CSV', 'Download the whole journal.'),
        ]),
        ('Review', [
          ('Dashboard', 'Headline numbers, the TradeZoro Score and stat gauges for the range you pick.'),
          ('TradeZoro Score', 'One score with a six-axis radar of your own stats.'),
          ('Calendar', 'P&L, trade count, or wins and losses per day on a month grid.'),
          ('Analytics', 'By setup, session, weekday, instrument, direction and account.'),
          ('Equity and daily charts', 'Cumulative results next to daily results.'),
          ('P&L card', 'Download a shareable image of a period.'),
        ]),
        ('Improve', [
          ('Coach', 'Rule-based findings tagged leak, strength or pattern, and three actions for the week.'),
          ('Discipline score', 'How closely your trades followed your own rules.'),
          ('Playbook', 'Your strategies with their rules, tick them off when you log a trade.'),
          ('Add from a model', 'Start a playbook entry from a trading model.'),
        ]),
        ('Prop firms', [
          ('Prop-firm tracker', 'One entry per evaluation or funded account: fees, payouts, net and status.'),
          ('Cash flow', 'Fees out and payouts in over time, across every firm.'),
          ('Evaluation simulator', 'Replays an evaluation many times from your own results. A simulation, not a prediction.'),
        ]),
      ],
      related=[
        ('/features/backtesting', 'kronos', 'Kronos', 'Send practice trades from replay into your journal.'),
        ('/features/models', 'mentis', 'Trading Models', 'The setups your playbook is built from.'),
        ('/features/charts', 'zorocharts', 'ZoroCharts', 'Mark up the chart you journal from.'),
      ],
      faq_h2='Before you log a trade',
      faq=[
        ('Is the coach AI?', 'No. It is a fixed set of rules that checks your own entries in your browser.'),
        ('Do my trades leave my account?', 'Not for the coach. The checks run on your device from your own journal.'),
        ('Can I import trades?', 'Yes. Import a trade file from your broker’s export, or add trades by hand.'),
        ('Is the demo data mine?', 'No. The screenshots use the built-in demo data. You can remove it any time.'),
        ('Does it promise results?', 'No. It measures what you logged. Education only.'),
      ],
      final=('Make your next review count', 'Log a trade and see how your journal reads.'),
    )

# ---------------------------------------------------------------- models
def models_spec():
    M, G = models(), model_groups()
    groups = [(g, [(m['name'], first_sentence(m['summary'])) for m in M if m['group'] == g]) for g in G]
    groups = [g for g in groups if g[1]]
    return dict(
      page='models', tool='Trading Models', crumb='Trading Models', icon='mentis', chip=('Trading Models', 'Mentis'),
      open='/models', guide=None,
      h1='Complete models, <em>not lone setups</em>.',
      intro=f'A library of {len(M)} written playbooks: the context to look for, the trigger to wait for, where the idea is wrong and how it is managed after entry. '
            'Every step documented, with a checklist to work through.',
      fine='Models are methods to study, not trade signals. Walkthrough charts are illustrative. Education only. Not financial advice.',
      hero=('hero', 'The ORB Strategy model page: diagram, category and a walkthrough. Illustrative example.', 'Models · ORB Strategy'),
      ids=dict(pair='story', steps='anatomy', bento='tools', values='why', index='list'),
      pair_h2='A setup is not a plan',
      problem=['A screenshot of a setup leaves out when it is valid and where it is wrong.',
               'Rules live in your head and change from day to day.',
               'Two traders read the same pattern two different ways.'],
      solution=['Each model is written to one standard: context, trigger, invalidation, management.',
                'A numbered checklist you tick off as you learn the model.',
                'A diagram and an illustrative walkthrough for every step.'],
      steps_lead='Five steps from the library to a model you can run from a checklist.',
      stage_label='Trading Models',
      steps=[
        dict(t='Start with the process', img='process', alt='The five-step process at the top of the model library: prep, apply the rules, confirm, size the risk, journal it.',
             p='The same five steps sit at the top of the library: prep, apply the rules, confirm, size the risk, journal it.'),
        dict(t='Browse the library', img='library', alt='The model library with category filters and model cards.',
             p=f'Filter the cards by category: {", ".join(G[:-1])} or {G[-1]}.'),
        dict(t='Read one model', img='model', alt='The IFVG Model page: diagram, category and the written model.',
             p='Each model has a diagram, a written walkthrough, its entry criteria and its stop. The stop is part of the model.'),
        dict(t='Step through an example', img='example', alt='An illustrative ORB walkthrough chart with the opening range marked. Illustrative example.',
             p='Step through the setup one stage at a time on an illustrative chart. The page labels it an illustrative example.'),
        dict(t='Work the checklist', img='checklist', alt='A model’s numbered steps checklist.',
             p='Every model ends in a numbered checklist you tick off as you learn it, with a reset button.'),
      ],
      bento=[
        dict(t='One card per model', img='card', alt='A model card with its diagram, tag and first steps.',
             p='Each card shows the diagram, a category tag, the first steps and how long the model takes to read.'),
        dict(t='Illustrative walkthroughs', img='ifvg-example', alt='An illustrative IFVG walkthrough chart. Illustrative example.',
             p='Pause, go back, or change the speed as the setup plays out.'),
        dict(t='Time-based models', img='silver-bullet', alt='The ICT Silver Bullet model page.', pos='30% 0%',
             p='Opening-range and session models with their exact windows written down.'),
        dict(t='Run it from your phone', img='checklist', id='mobile', alt='A model checklist.', pos='50% 0%',
             p='Library, walkthroughs and checklists work on any screen, on the same account.'),
        dict(t='The same five-step routine', img='process', alt='The five-step process: prep, apply the rules, confirm, size the risk, journal it.', pos='0% 0%',
             p='Prep, apply the rules, confirm, size the risk and journal it, for every model.'),
      ],
      values=[
        ('spark', 'What’s unique', 'One standard for every model', 'Context, trigger, invalidation and management, in the same order on every page.'),
        ('clock', 'Time it saves', 'No rebuilding your rules', 'Open the model before a session and work the checklist instead of rereading notes.'),
        ('swap', 'What it replaces', 'Scattered screenshots and threads', 'One library of written methods, linked to your journal’s playbook.'),
      ],
      index=groups,
      related=[
        ('/features/curriculum', 'mentis', 'Curriculum', 'The lessons each model builds on.'),
        ('/features/backtesting', 'kronos', 'Kronos', 'Practise a model on past sessions, bar by bar.'),
        ('/features/journal', 'nemesis', 'Nemesis', 'Turn a model into a playbook entry and journal it.'),
      ],
      faq_h2='Before you start',
      faq=[
        ('What is a trading model?', 'A complete written method: the context to look for, the trigger, where the idea is wrong, and how the trade is managed after entry.'),
        ('Are the walkthrough charts real trades?', 'No. The walkthroughs use illustrative candles drawn to teach the pattern. The page says so.'),
        ('Are models trade signals?', 'No. Models are methods to study. They do not tell you what to trade.'),
        ('Will more models be added?', 'New models may be added to the library over time.'),
        ('Does TradeZoro place trades from a model?', 'No. TradeZoro never places real orders. Practise in paper trading and bar replay.'),
      ],
      final=('Trade a plan, not a feeling', 'Create an account and open the model library.'),
    )

PAGES = {'charts': charts_spec, 'indicators': indicators_spec, 'backtesting': backtesting_spec, 'journal': journal_spec, 'models': models_spec}

def write(s):
    def walk(v):
        if isinstance(v, str):
            assert not BANNED.search(v), (s['page'], v)
        elif isinstance(v, (list, tuple)):
            [walk(x) for x in v]
        elif isinstance(v, dict):
            [walk(x) for x in v.values()]
    walk({k: v for k, v in s.items() if k not in ('open', 'guide')})
    build.write(s)
    # old page-specific CSS/JS that build.write does not know about (charts page)
    p = ROOT / f'features/{s["page"]}.html'
    html = p.read_text()
    html = re.sub(r'<link rel="stylesheet" href="/assets/charts-page\.css\?v=\d+">\n?', '', html)
    html = re.sub(r'<script src="/assets/charts-page\.js\?v=\d+" defer></script>\n?', '', html)
    if s['page'] in ('journal', 'backtesting'):  # tiles show P&L figures: label them on the image
        html = re.sub(r'(<figure class="fpg-tile-fig fp-pad"[^>]*>)', r'\1<span class="fpg-tag fpg-tile-tag">Sample data</span>', html)
    assert not BANNED.search(re.sub(r'<script[\s\S]*?</script>|<head>[\s\S]*?</head>', '', html).split('<main', 1)[1].split('</main>')[0]), s['page']
    p.write_text(html)

if __name__ == '__main__':
    for pg in (sys.argv[1:] or PAGES):
        write(PAGES[pg]())
