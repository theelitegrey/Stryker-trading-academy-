#!/usr/bin/env python3
"""Feature page generator (FEATA, Owner 19 Nov 2026): writes the <main> of features/<page>.html from a spec below,
using the shared template assets/feature-page.css + assets/feature-page.js (class list: top of the CSS).
Everything outside <main> (head meta, OG, canonical, nav, footer) is kept; the head only swaps the old page CSS/JS
for the template's. Run: python3 tools/feature-pages/build.py [page ...]   (no args = every page in PAGES)
Add a page: add a spec to PAGES (screenshots in assets/images/features/<page>/<name>.webp + @2x.webp).
Feature index lists come from the code: Order Flow from assets/pro-features-data.js (the /pro list); Omega from the
Omega page itself (gex.html) plus the 'gex' items of that file. Counts are computed, never typed.
Copy rules: no prices, no results/win-rate claims, no vendor or exchange names, GEX = "updated X min ago", never
"delayed" or "real-time". Education only. Not financial advice."""
import json, pathlib, re, subprocess, sys
from html import escape as E
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
V = json.loads((ROOT / 'assets/version.json').read_text())['build']

def pro_items():
    out = subprocess.run(['node', '-e', "process.stdout.write(JSON.stringify(require('./assets/pro-features-data.js').items))"],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return {i['name']: i['desc'] for i in json.loads(out)}

ICON = {  # 24px stroke icons, one family (.ci)
  'alert': '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
  'check': '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16.5 9"/>',
  'arrow': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  'spark': '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>',
  'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  'swap': '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
}
def ci(k, cls='ci'):
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{ICON[k]}</svg>'

def img(page, name, alt, lazy=True, extra=''):
    p = ROOT / f'assets/images/features/{page}/{name}.webp'
    w, h = Image.open(p).size
    b = f'/assets/images/features/{page}/{name}'
    ld = 'loading="lazy" ' if lazy else 'fetchpriority="high" '
    return (f'<img src="{b}.webp?v={V}" srcset="{b}.webp?v={V} 1x, {b}@2x.webp?v={V} 2x" width="{w}" height="{h}" '
            f'alt="{E(alt)}" {ld}decoding="async"{extra}>')

def picon(name, size):
    b = f'/assets/img/products/{name}'
    return (f'<picture><source type="image/webp" srcset="{b}.webp 1x, {b}@2x.webp 2x"><img data-fp-nopad src="{b}.png" '
            f'srcset="{b}@2x.png 2x" width="{size}" height="{size}" alt="" aria-hidden="true" decoding="async" loading="lazy"></picture>')

def device(page, name, alt, label, lazy=True):
    return (f'<figure class="fpg-device fp-pad"><div class="fpg-bar"><span class="fpg-dots" aria-hidden="true"><i></i><i></i><i></i></span>'
            f'<b>{E(label)}</b><span class="fpg-tag">Sample data</span></div><div class="fpg-shot">{img(page, name, alt, lazy)}</div></figure>')

def head(eyebrow, hid, h2, lead='', center=False):
    return (f'<div class="fpg-head fpg-rv{" is-c" if center else ""}"><p class="fpg-eyebrow">{E(eyebrow)}</p><h2 id="{hid}">{E(h2)}</h2>'
            + (f'<p class="fpg-lead">{E(lead)}</p>' if lead else '') + '</div>')

def build_main(s):
    pg, tool = s['page'], s['tool']
    ids = s['ids']
    o = []
    # 1. hero
    cta = f'<a href="{s["open"]}" class="btn btn-primary">Open {E(tool)}</a>'
    if s.get('guide'):
        cta += f'<a href="{s["guide"]}" class="btn btn-ghost">Read the guide</a>'
    o.append(f'''<header class="fpg-hero" id="top"><div class="fpg-w">
<div class="fpg-hero-copy fpg-rv">
<nav aria-label="Breadcrumb"><ol class="fpg-crumb"><li><a href="/features">Features</a></li><li><span aria-current="page">{E(s["crumb"])}</span></li></ol></nav>
<p class="fpg-chip">{picon(s["icon"], 24).replace('<img ', '<img class="fpg-chip-ic" ')}{E(s["chip"][0])} <span>· {E(s["chip"][1])}</span></p>
<h1 class="fpg-h1">{s["h1"]}</h1>
<p class="fpg-intro">{E(s["intro"])}</p>
<div class="fpg-cta">{cta}</div>
<p class="fpg-fine">{E(s["fine"])}</p>
</div>
<div class="fpg-hero-media fpg-rv" style="--d:120ms">{device(pg, s["hero"][0], s["hero"][1], s["hero"][2], lazy=False)}</div>
</div></header>''')
    # 2. problem -> solution
    li = lambda xs: ''.join(f'<li>{E(x)}</li>' for x in xs)
    o.append(f'''<section class="fpg-sec" id="{ids["pair"]}" aria-labelledby="{ids["pair"]}-h"><div class="fpg-w">
{head("Why it exists", ids["pair"] + "-h", s["pair_h2"])}
<div class="fpg-pair">
<div class="fpg-card fpg-prob fpg-rv"><h3>{ci("alert")}The problem</h3><ul class="fpg-bul">{li(s["problem"])}</ul></div>
<div class="fpg-arrow" aria-hidden="true"><span>{ci("arrow")}</span></div>
<div class="fpg-card fpg-sol fpg-rv" style="--d:80ms"><h3>{ci("check")}With {E(tool)}</h3><ul class="fpg-bul">{li(s["solution"])}</ul></div>
</div></div></section>''')
    # 3. steps
    steps, slides = [], []
    for i, st in enumerate(s['steps']):
        sid = f' id="{st["id"]}"' if st.get('id') else ''
        steps.append(f'<li class="fpg-step"{sid}><span class="fpg-sn" aria-hidden="true">{i + 1}</span><h3>{E(st["t"])}</h3><p>{E(st["p"])}</p>'
                     f'<figure class="fpg-step-fig fp-pad">{img(pg, st["img"], st["alt"])}</figure></li>')
        slides.append(f'<figure class="fpg-slide{" is-on" if i == 0 else ""}" data-cap="{i + 1} / {len(s["steps"])} · {E(st["t"])}">{img(pg, st["img"], "")}</figure>')
    o.append(f'''<section class="fpg-sec" id="{ids["steps"]}" aria-labelledby="{ids["steps"]}-h"><div class="fpg-w">
{head("How it works", ids["steps"] + "-h", f"{tool}, step by step", s["steps_lead"])}
<div class="fpg-steps" data-fpg-steps>
<div class="fpg-step-col"><div class="fpg-line" aria-hidden="true"><i></i></div><ol class="fpg-step-list">{"".join(steps)}</ol></div>
<div class="fpg-step-stage" aria-hidden="true"><figure class="fpg-device fp-pad"><div class="fpg-bar"><span class="fpg-dots"><i></i><i></i><i></i></span><b>{E(s["stage_label"])}</b><span class="fpg-tag">Sample data</span></div><div class="fpg-shot">{"".join(slides)}</div></figure><p class="fpg-stage-cap">1 / {len(s["steps"])} · {E(s["steps"][0]["t"])}</p></div>
</div></div></section>''')
    # 4. bento
    tiles = []
    for i, t in enumerate(s['bento']):
        wide = ' fpg-tile--wide' if i == 0 else ''
        tid = f' id="{t["id"]}"' if t.get('id') else ''
        pos = f' style="--fpg-pos:{t["pos"]}"' if t.get('pos') else ''
        tiles.append(f'<article class="fpg-tile{wide} fpg-rv"{tid}><figure class="fpg-tile-fig fp-pad"{pos}>{img(pg, t["img"], t["alt"])}</figure>'
                     f'<h3>{E(t["t"])}</h3><p>{E(t["p"])}</p></article>')
    o.append(f'''<section class="fpg-sec" id="{ids["bento"]}" aria-labelledby="{ids["bento"]}-h"><div class="fpg-w">
{head("Capabilities", ids["bento"] + "-h", f"What you can do with {tool}", "Every screen is the real tool on sample data.")}
<div class="fpg-bento">{"".join(tiles)}</div></div></section>''')
    # 5. values
    vals = ''.join(f'<article class="fpg-val fpg-rv" style="--d:{i * 60}ms">{ci(v[0])}<small>{E(v[1])}</small><h3>{E(v[2])}</h3><p>{E(v[3])}</p></article>'
                   for i, v in enumerate(s['values']))
    o.append(f'''<section class="fpg-sec" id="{ids["values"]}" aria-labelledby="{ids["values"]}-h"><div class="fpg-w">
{head("Why traders use it", ids["values"] + "-h", f"What {tool} puts in your hands")}
<div class="fpg-vals">{vals}</div></div></section>''')
    # 6. index
    groups = s['index']
    ON = ' class="is-on"'
    n = sum(len(g[1]) for g in groups)
    nav = ''.join(f'<a href="#ix-{pg}-{k}"{ON if k == 0 else ""}>{E(g[0])}<span data-fpg-gcount>{len(g[1])}</span></a>' for k, g in enumerate(groups))
    body = ''.join(f'<section class="fpg-ix-group" id="ix-{pg}-{k}"><h3>{E(g[0])} <span data-fpg-gcount>{len(g[1])}</span></h3><ul>'
                   + ''.join(f'<li><b>{E(a)}</b><span>{E(b)}</span></li>' for a, b in g[1]) + '</ul></section>' for k, g in enumerate(groups))
    o.append(f'''<section class="fpg-sec" id="{ids["index"]}" aria-labelledby="{ids["index"]}-h"><div class="fpg-w">
<div class="fpg-head fpg-rv"><p class="fpg-eyebrow">Every feature</p><h2 id="{ids["index"]}-h">Everything in {E(tool)}</h2><p class="fpg-count" data-fpg-count>{n} features · {len(groups)} groups</p></div>
<div class="fpg-index" data-fpg-index><nav class="fpg-ix-nav" aria-label="Feature groups">{nav}</nav><div class="fpg-ix-body">{body}</div></div>
</div></section>''')
    # 7. related
    rel = ''.join(f'<a class="fpg-relc fpg-rv" href="{r[0]}" style="--d:{i * 60}ms">{picon(r[1], 48)}<div><b>{E(r[2])}</b><span>{E(r[3])}</span></div>{ci("arrow")}</a>'
                  for i, r in enumerate(s['related']))
    o.append(f'''<section class="fpg-sec" id="related" aria-labelledby="related-h"><div class="fpg-w">
{head("Paired with", "related-h", "Works with the rest of TradeZoro")}
<div class="fpg-rel">{rel}</div></div></section>''')
    # 8. faq
    faq = ''.join(f'<details><summary>{E(q)}</summary><div class="fpg-a"><p>{E(a)}</p></div></details>' for q, a in s['faq'])
    o.append(f'''<section class="fpg-sec" id="faq" aria-labelledby="faq-h"><div class="fpg-w">
{head("Questions", "faq-h", s["faq_h2"], center=True)}
<div class="fpg-faq fpg-rv">{faq}</div></div></section>''')
    # 9. final
    f = s['final']
    o.append(f'''<section class="fpg-sec fpg-last" aria-labelledby="end-h"><div class="fpg-w"><div class="fpg-final fpg-rv">
<h2 id="end-h">{E(f[0])}</h2><p>{E(f[1])}</p>
<div class="fpg-cta"><a href="{s["open"]}" class="btn btn-primary">Open {E(tool)}</a><a href="/signup" class="btn btn-ghost">Start free</a></div>
<p class="fpg-fine">Education only. Not financial advice.</p>
</div></div></section>''')
    return '<main id="main" tabindex="-1" class="dash-main fpg">\n' + '\n'.join(o) + '\n</main>'

def write(s):
    path = ROOT / f'features/{s["page"]}.html'
    html = path.read_text()
    a, b = html.index('<main id="main"'), html.index('</main>') + len('</main>')
    html = html[:a] + build_main(s) + html[b:]
    # head: the template CSS replaces the old page CSS; the template JS replaces the old motion file
    html = re.sub(r'<link rel="stylesheet" href="/assets/(creators-page|fx-page|features-a)\.css\?v=\d+">\n', '', html)
    if 'feature-page.css' not in html:
        html = html.replace(f'<link rel="stylesheet" href="/assets/features-page.css?v={V}">',
                            f'<link rel="stylesheet" href="/assets/features-page.css?v={V}">\n<link rel="stylesheet" href="/assets/feature-page.css?v={V}">')
    html = re.sub(r'<script src="/assets/creators-motion\.js\?v=\d+" defer></script>', f'<script src="/assets/feature-page.js?v={V}" defer></script>', html)
    html = re.sub(r'<script src="/assets/fx-page\.js\?v=\d+" defer></script>\n?', '', html)
    html = html.replace('<body class="dual-shell fp-page cm-page"', '<body class="dual-shell fp-page"')
    assert html.count('feature-page.css') == 1 and html.count('feature-page.js') == 1, s['page']
    path.write_text(html)
    print('wrote', path.relative_to(ROOT))

# ---------------------------------------------------------------- page specs
def gex_spec():
    P = pro_items()
    return dict(
      page='gex', tool='Omega', crumb='Omega', icon='omega', chip=('Omega', 'Gamma Exposure'),
      open='/gex', guide='/indicators/gex-levels',
      h1='See where options positioning <em>may matter</em> for price.',
      intro='Omega turns the options chain into a few price levels: a call wall, a put wall and a zero-gamma line. '
            'It converts them to ES, NQ and gold futures and draws them on the chart you trade, each stamped with when it was last updated.',
      fine='Levels are context, not trade signals. Screens are the real tool on a sample capture. Education only. Not financial advice.',
      hero=('hero', 'The Omega page: QQQ levels converted to NQ on a 5-minute chart, with the put wall marked. Sample data.', 'Omega · QQQ → NQ · 5m'),
      ids=dict(pair='problem', steps='tour', bento='more', values='how', index='list'),
      pair_h2='Options levels, without the spreadsheet',
      problem=['Hand-drawn levels all look the same until price reaches one.',
               'Options levels are quoted on SPX or QQQ, but you trade ES or NQ futures.',
               'Reading strikes off a second screen means you check them too late.'],
      solution=['Call wall, put wall and zero gamma, worked out from the options chain.',
                'Every level converted to futures points: ES, NQ, their micros and gold.',
                'Drawn on the chart with an "updated X min ago" stamp, so you know how fresh it is.'],
      steps_lead='Five steps from opening the page to reading the session’s levels.',
      stage_label='Omega · sample capture',
      steps=[
        dict(t='Pick a market and an expiry', img='levels-panel', alt='Omega levels panel for SPX: call wall, zero gamma, spot and put wall with the matching ES prices. Sample data.',
             p='Choose SPX, SPY, QQQ or gold, then 0DTE, 1DTE, 1W or 1M. The call wall, zero gamma and put wall re-compute for just those expiries, with the futures price beside each.'),
        dict(t='Read the walls on the chart', img='chart-levels', alt='SPX levels converted to ES on a 5-minute chart: call wall, zero gamma and put wall lines. Sample data.',
             p='The levels are drawn on a futures chart with 1m, 5m, 15m and 1h candles, next to the prior day’s value area and the overnight high and low.'),
        dict(t='Watch the map through the day', img='heatmap', alt='GEX heatmap: net GEX at every strike through the session, with the spot price traced on top. Sample data.',
             p='The heatmap shows net GEX at every strike through the session, one column per 2-minute snapshot, with spot and the walls traced on top.'),
        dict(t='Go strike by strike', img='ladder', alt='GEX ladder: net GEX per strike around spot, coloured from positive to negative. Sample data.',
             p='The ladder lists every strike near spot with its net GEX, net delta exposure, open interest and matching futures price.'),
        dict(t='Check the options context', img='options', alt='Options analytics: expected move by expiry, IV rank, IV percentile, put/call ratios, term structure and skew. Sample data.',
             p='Options analytics adds the expected move for each expiry, IV rank and percentile, put/call ratios, the term structure and skew.'),
      ],
      bento=[
        dict(t='Delta, vanna and charm exposure', img='greeks', alt='Delta, vanna and charm exposure table by strike. Sample data.', pos='0% 0%',
             p='Dealer delta, vanna and charm exposure at each strike, for all expiries, 0DTE or the next expiry.'),
        dict(t='Options volume by strike', img='volume-by-strike', alt='Options volume by strike: put volume to the left, call volume to the right. Sample data.', pos='50% 30%',
             p='Call and put volume at each strike for the expiry you pick, with the busiest strikes listed.'),
        dict(t='Futures levels for NQ', img='chart-nq', alt='QQQ levels converted to NQ on a 5-minute chart. Sample data.',
             p='QQQ levels converted to NQ points, so the put wall sits on the chart at a price you can trade.'),
        dict(t='GEX heatmap', img='heatmap', alt='GEX heatmap through the session. Sample data.', pos='50% 40%',
             p='Where gamma built up or faded through the day, strike by strike.'),
        dict(t='On your ZoroCharts chart', img='on-zorocharts', alt='NQ five-minute chart in ZoroCharts with GEX call wall, zero gamma and put wall lines. Sample data.',
             p='The GEX Levels indicator draws the same walls on any ZoroCharts chart, each with when it was last updated.'),
      ],
      values=[
        ('spark', 'What’s unique', 'Options levels in futures points', 'Levels are worked out on the index or ETF, then shifted to the futures contract, so they read in the points you trade.'),
        ('clock', 'Time it saves', 'No levels to draw by hand', 'Walls, zero gamma, the expected range, the prior value area and the overnight range are on the chart when you open it.'),
        ('swap', 'What it replaces', 'A strike sheet and a second screen', 'Instead of copying strikes from an options chain, you read them where you already look: the chart.'),
      ],
      index=[
        ('Levels', [
          ('Call wall', 'The strike above price with the most call gamma. Often watched as an upper edge of the day’s range.'),
          ('Put wall', 'The strike below price with the most put gamma. Often watched as a lower edge.'),
          ('Zero gamma', 'The price where the model’s net gamma changes sign, from positive to negative.'),
          ('Regime badge', 'Positive or negative gamma next to the net GEX figure: the headline read of the model.'),
          ('IV expected range', 'The 68% and 80% boxes from the same-day at-the-money straddle. A statistical estimate, not a forecast.'),
          ('Prior day value area', 'Yesterday’s VAH, POC and VAL from the prior regular session, beside the gamma levels.'),
          ('Overnight high and low', 'The extremes made between the prior close and the open, on the same chart.'),
        ]),
        ('Views', [
          ('Chart', 'Futures candles with the levels drawn on, 1m, 5m, 15m and 1h, with pan and zoom.'),
          ('Heatmap', 'Net GEX at every strike through the session, one column per 2-minute snapshot.'),
          ('Ladder', 'Net GEX, net delta exposure and open interest per strike near spot, with the futures price.'),
          ('ZoroTide', 'Options money flow through the day: net call premium against net put premium.'),
          ('Omega strike table', P['Omega strike table']),
          ('Updated through the day or daily close', 'Read the levels as they update, or as they stood at the close.'),
        ]),
        ('Options analytics', [
          ('Expected move', 'The move the options market implies for 0DTE, 1DTE and the weekly, in points.'),
          ('IV rank and percentile', 'Where implied volatility sits against its own past year.'),
          ('Term structure and skew', 'At-the-money implied volatility by expiry, and the put-call skew.'),
          ('Put/call ratios', 'Put/call by volume and by open interest.'),
          ('Options volume by strike', 'Call and put volume at each strike, with the busiest strikes listed.'),
          ('Delta, vanna and charm exposure', 'Dealer delta, vanna and charm exposure at each strike on the Omega page.'),
        ]),
        ('Markets and expiries', [
          ('Instruments', P['Instruments']),
          ('Expiry filters', '0DTE, 1DTE, 1W and 1M. The levels re-compute for just those expiries.'),
          ('Every expiry', P['Every expiry']),
          ('Freshness stamp', 'Every level shows when it was last updated, for example “updated 3 min ago”.'),
        ]),
        ('On ZoroCharts', [
          ('GEX Levels indicator', P['Omega levels on charts']),
          ('GEX heatmap indicator', P['GEX heatmap']),
          ('GEX Ladder indicator', 'The strike ladder beside the price scale on your chart.'),
          ('Expected Move indicator', P['Expected Move']),
          ('Delta, vanna and charm indicators', P['Delta, Vanna and Charm Exposure']),
          ('Options Flow Marks', P['Options Flow Marks']),
          ('Level alerts', 'Alerts when price crosses a level, or when the gamma regime flips.'),
        ]),
        ('Take the levels with you', [
          ('Download levels', 'Past call wall, put wall, zero gamma and range snapshots as CSV or JSON, up to 90 days at a time.'),
          ('Use in your platform', 'Copy the levels into the charting platform you already use.'),
        ]),
      ],
      related=[
        ('/features/charts', 'zorocharts', 'ZoroCharts', 'The chart the levels are drawn on, with GEX as indicators.'),
        ('/features/orderflow', 'liquidity-map', 'Order Flow', 'See who traded at the walls: footprint, delta and the book.'),
        ('/features/market-stats', 'market-stats', 'Market Stats', 'How often gaps, ranges and levels played out, with sample sizes.'),
      ],
      faq_h2='Before you open Omega',
      faq=[
        ('What is GEX?', 'Gamma exposure estimates how much options dealers may need to hedge as price moves. TradeZoro turns it into a few levels you can read on a chart.'),
        ('Are these trade signals?', 'No. They are context for a session. Education only. Not financial advice.'),
        ('How fresh are the levels?', 'Each page and chart level shows when it was last updated, for example “updated 3 min ago”.'),
        ('Which markets?', 'SPX, SPY, QQQ and GLD options, converted to ES, MES, NQ, MNQ and gold futures levels.'),
        ('Can I see the levels on my own chart?', 'Yes. Add GEX Levels from the Indicators window in ZoroCharts, or use “Use in your platform” on the Omega page.'),
        ('Which plan includes it?', 'Every plan. Omega is free for every signed-in member, every symbol and expiry.'),
      ],
      final=('Read the session’s context first', 'Open Omega and see where the levels sit before you decide anything.'),
    )

def of_spec():
    P = pro_items()
    pick = lambda *names: [(n, P[n]) for n in names]
    return dict(
      page='orderflow', tool='ZoroCharts', crumb='Order Flow', icon='liquidity-map', chip=('Order Flow', 'ZoroCharts'),
      open='/charts', guide='/indicators/footprint',
      h1='See who is trading at <em>every price</em>.',
      intro='Footprint, delta, CVD, big trades, absorption and the order book heatmap, built from real trades and drawn on the same chart you mark up. '
            'Futures (NQ, ES, YM, GC, SI, CL and their micros) and crypto.',
      fine='Screens are the real tool on sample data. Education only. Not financial advice.',
      hero=('hero', 'ZoroCharts with the Footprint tool: every 1-minute candle split into prices with sell and buy volume. Sample data.', 'ZoroCharts · Footprint · 1m'),
      ids=dict(pair='problem', steps='tour', bento='more', values='how', index='list'),
      pair_h2='A candle hides who pushed it',
      problem=['A candle shows where price went, not who pushed it there.',
               'A volume bar totals the bar, so buying and selling at each price stay hidden.',
               'Big orders and absorbed pushes sit inside a normal-looking candle.'],
      solution=['Footprint splits every candle into prices, with the volume bought and sold at each one.',
                'Delta and CVD show whether buyers or sellers led, bar by bar and over the session.',
                'Big trades, absorption and the book heatmap mark where size showed up.'],
      steps_lead='Five steps from a plain chart to reading the tape on it.',
      stage_label='ZoroCharts · Order Flow',
      steps=[
        dict(t='Add Footprint to the chart', img='footprint', alt='Footprint: each 1-minute candle split into prices with sell and buy volume, the busiest price boxed. Sample data.',
             p='Open the Indicators window, go to the Order Flow group and add Footprint. Every candle splits into prices with the volume sold and bought at each one; the busiest price is boxed.'),
        dict(t='Read delta at each price', img='delta-profile', alt='Delta profile beside the candles: buying and selling per price row, with the top buy and sell rows tagged. Sample data.',
             p='The delta profile shows buyers or sellers row by row at each price, with the largest buy and sell rows tagged.'),
        dict(t='Check CVD for divergence', img='cvd', alt='CVD in its own pane under price, with divergence lines where price and CVD disagree. Sample data.',
             p='Cumulative volume delta runs in its own pane, with a line drawn when price and CVD disagree.'),
        dict(t='See the resting orders', img='dom-heatmap', id='sx-f-liquidity', alt='Order book heatmap behind the candles: resting orders at every price, with pulled and filled walls tagged. Sample data.',
             p='The order book heatmap draws resting orders at every price behind the candles, and tags large orders that were pulled or filled.'),
        dict(t='Mark where size traded', img='dom-bubbles', alt='Big trade bubbles on top of the order book heatmap, sized by the order. Sample data.',
             p='Big Trades adds a bubble wherever one large order traded, sized by the order, buyers in green and sellers in red.'),
      ],
      bento=[
        dict(t='Volume profile', img='volume-profile', alt='Session volume profile with the point of control and value area. Sample data.',
             p='Volume by price for the session or a swing, with the point of control, value area and naked POCs.'),
        dict(t='Imbalance zones', img='imbalance', alt='Stacked imbalance zones extending to the right until price trades through. Sample data.', pos='50% 20%',
             p=P['Imbalance Zones']),
        dict(t='Stop runs', img='sweeps', alt='Stop run marks where a bar poked past a swing on a volume spike and closed back inside. Sample data.', pos='30% 50%',
             p=P['Stop Runs']),
        dict(t='Big trades', img='bigtrades', alt='Big trade bubbles on 1-minute candles. Sample data.',
             p='Bubbles for the largest trades on the candles, buyers in green and sellers in red.'),
        dict(t='Market profile', img='tpo', alt='Market profile letters per session with the initial balance and value area. Sample data.', pos='0% 50%',
             p=P['Market Profile']),
      ],
      values=[
        ('spark', 'What’s unique', 'Built from every trade', 'Futures order flow is built on our server from every trade and the side that started it, then drawn on your chart.'),
        ('clock', 'Time it saves', 'One chart, not five windows', 'Footprint, delta, profiles and the book sit on the chart you already mark up, one click each in the Indicators window.'),
        ('swap', 'What it replaces', 'A separate order flow platform', 'No second app to keep in sync: the order flow tools work in the same ZoroCharts layout, alerts and bar replay.'),
      ],
      index=[
        ('Footprint and delta', pick('Footprint', 'Footprint (L2)', 'Footprint Patterns', 'Bar Stats', 'Delta', 'Delta (L2)', 'Delta Ladder (L2)',
                                     'Delta Profile (L2)', 'CVD', 'Cumulative Delta (L2)', 'Estimated CVD')),
        ('Profiles and VWAP', pick('Volume Profile', 'Volume Profile (L2)', 'Swing VWAP + Profile (L2)', 'VWAP', 'Market Profile', 'Effort vs Result',
                                   'Liquidity Trend Heatmap')),
        ('Big trades and stops', pick('Big Trades', 'Big Trades (L2)', 'Volume Bubble', 'Absorption', 'Imbalance Zones', 'Stop Runs', 'Stop Runs (L2)')),
        ('Order book', pick('Order book heatmap', 'Liquidity Map', 'Depth Heatmap', 'DOM ladder', 'Book · DOM · Trades panel', 'Liquidity Walls',
                            'Book Imbalance', 'Book Speed', 'Liquidity Balance', 'Refill Detector', 'Volatility Regime', 'Large Resting Orders',
                            'Absorption & Iceberg Tracker', 'Wall Events')),
        ('Crypto derivatives', pick('Liquidations', 'Open Interest (crypto)', 'Funding and long/short ratio')),
      ],
      related=[
        ('/features/charts', 'zorocharts', 'ZoroCharts', 'The chart every order flow tool is drawn on.'),
        ('/features/gex', 'omega', 'Omega', 'Options levels for ES, NQ and gold on the same chart.'),
        ('/features/backtesting', 'kronos', 'Kronos', 'Replay past sessions and practise reading order flow.'),
      ],
      faq_h2='Before you add a tool',
      faq=[
        ('Where does the data come from?', 'Futures order flow is built on our server from every trade and the side that started it. Crypto order flow comes from public exchange trades.'),
        ('Which markets have order flow?', 'NQ, ES, YM, GC, SI and CL with their micro contracts, and crypto pairs.'),
        ('Can I practise on past sessions?', 'Yes. Every order flow tool works in bar replay and uses only the trades up to the replay clock.'),
        ('Which plan includes it?', 'Every plan: order flow tools are free for every signed-in member. On futures, the live order book (L2) is a separate data feed because exchange rules set it; crypto is live for everyone.'),
        ('Does it place orders?', 'No. TradeZoro never places real orders. Paper trading is simulated.'),
      ],
      final=('Add a tool to your chart', 'Open ZoroCharts, pick a market and add Footprint from the Order Flow group.'),
    )

PAGES = {'gex': gex_spec, 'orderflow': of_spec}

if __name__ == '__main__':
    for p in (sys.argv[1:] or PAGES):
        write(PAGES[p]())
