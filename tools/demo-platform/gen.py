#!/usr/bin/env python3
"""Build demo-platform.html (unlisted preview, Owner order 2026-10-06:
"Show me variations only of the platform section on homepage").

The content is NOT retyped: this script reads the live homepage section
(index.html <section id="platform">) and pulls out the eyebrow, headline,
intro, and for each of the six desk tools its number, tab label, title,
paragraph, disclaimer, link and SVG vignette. It then renders four layout
variations (A bento, B sticky story, C orbit hub, D snap rail) of that same
content into demo-platform.html.

Truth rule (Owner GEX rule): no "live" / "real-time" claims on the demo.
Three phrases in the live copy say "live"; they are softened here only, via
SOFTEN below, and listed in the handback so the live page can be decided
separately. index.html itself is never written.

Run from the repo root:  python3 tools/demo-platform/gen.py
"""
import html as H
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'index.html')
OUT = os.path.join(ROOT, 'demo-platform.html')

SOFTEN = [
    ('live market data', 'market data'),
    ('a live net ticker', 'a running net total'),
    ('Live quotes across', 'Quotes across'),
]

# Real product screenshots already on the site (features/ pages), with the
# captions those pages use. One per tool, matched by tool number.
SHOTS = {
    '01': ('/assets/images/journal/calendar.webp', 1000, 634, 'Demo data. The journal P&L calendar.',
           'A month calendar from the Stryker trade journal filled with demo data.'),
    '02': ('/assets/images/journal/prop.webp', 1000, 540, 'Demo data. Prop-firm account cards.',
           'Prop-firm account cards from the journal with demo data: fees spent, payouts and net per account.'),
    '03': ('/assets/images/journal/coach.webp', 1000, 764, 'Demo data. The journal coach tab.',
           'The journal coach tab with demo data: a discipline score and insight cards.'),
    '04': ('/assets/images/global-monitor/markets.webp', 740, 584, 'Market signals and asset tables.',
           'Global Monitor market boards: indices, futures, safe havens, forex, energy and crypto.'),
    '05': ('/assets/images/indicators/hero-1440.webp', 1400, 690, 'Illustration of FVG Relay.',
           'FVG Relay marking two fair value gaps on a candlestick chart.'),
    '06': ('/assets/images/community/floor.webp', 740, 328, 'One staged post. Demo data.',
           'A Trading Floor post with author, Setup flair and reply buttons.'),
}
# Short always-visible tag on each screen, so no screen reads as a result.
TAGS = {'01': 'Demo data', '02': 'Demo data', '03': 'Demo data', '04': 'Screen capture',
        '05': 'Illustration', '06': 'Demo data'}


def die(msg):
    sys.stderr.write('gen.py: ' + msg + '\n')
    sys.exit(1)


def text(fragment):
    """Inner HTML -> plain text (entities decoded, tags dropped)."""
    return H.unescape(re.sub(r'<[^>]+>', '', fragment)).strip()


def soften(s):
    for a, b in SOFTEN:
        s = s.replace(a, b)
    if re.search(r'\b(live|real-time|realtime)\b', s, re.I):
        die('a "live"/"real-time" phrase survived: ' + s)
    return s


def extract():
    src = open(SRC, encoding='utf-8').read()
    m = re.search(r'<section class="container" id="platform">(.*?)\n</section>', src, re.S)
    if not m:
        die('platform section not found in index.html')
    sec = m.group(1)
    head = {
        'eyebrow': text(re.search(r'<span class="eyebrow">(.*?)</span>', sec, re.S).group(1)),
        'h2': text(re.search(r'<h2>(.*?)</h2>', sec, re.S).group(1)),
        'intro': soften(text(re.search(r'<div class="section-head[^"]*">.*?<p>(.*?)</p>', sec, re.S).group(1))),
        'hub_eyebrow': text(re.search(r'desk-hub-eyebrow">(.*?)<', sec).group(1)),
        'hub': text(re.search(r'<div class="desk-hub"[^>]*>.*?<b>(.*?)</b>', sec, re.S).group(1)),
    }
    tabs = re.findall(r'<span class="desk-k">(\d+)</span><span class="desk-lbl">(.*?)</span>', sec)
    panes = re.findall(r'<div class="desk-pane[^"]*" role="tabpanel"[^>]*>(.*?)\n    </div>\n(?=    <div class="desk-pane|    </div>)', sec, re.S)
    if len(tabs) != 6 or len(panes) != 6:
        die('expected 6 tabs and 6 panes, got %d / %d' % (len(tabs), len(panes)))
    tools = []
    for (k, lbl), p in zip(tabs, panes):
        link = re.search(r'<a class="module-go" href="([^"]+)">(.*?)<i>', p, re.S)
        disc = re.search(r'<p class="desk-disclaimer">(.*?)</p>', p, re.S)
        paras = re.findall(r'<p>(.*?)</p>', p, re.S)
        svg = re.search(r'(<svg viewBox="0 0 220 84">.*?</svg>)', p, re.S).group(1)
        tools.append({
            'k': k, 'label': text(lbl), 'title': text(re.search(r'<h3>(.*?)</h3>', p, re.S).group(1)),
            'body': soften(text(paras[0])), 'disc': text(disc.group(1)) if disc else '',
            'href': link.group(1), 'cta': text(link.group(2)), 'svg': svg,
        })
    return head, tools


def e(s):
    return H.escape(s, quote=True)


def shot(t, cls='', lazy=True):
    src, w, h, cap, alt = SHOTS[t['k']]
    return ('<img class="%s" src="%s" width="%d" height="%d"%s decoding="async" alt="%s">'
            % (cls, src, w, h, ' loading="lazy"' if lazy else '', e(alt)))


def disc(t):
    return '<p class="dp-disc">%s</p>' % e(t['disc']) if t['disc'] else ''


def go(t, cls='dp-go'):
    return '<a class="%s" href="%s">%s <i aria-hidden="true">→</i></a>' % (cls, e(t['href']), e(t['cta']))


def viz(t):
    # The homepage vignette, kept decorative exactly as on the live page.
    return '<div class="module-viz dp-viz" aria-hidden="true">%s</div>' % t['svg']


def head_block(hd, v):
    return ('<div class="dp-head">\n  <span class="eyebrow">%s</span>\n  <h2 id="%s-h">%s</h2>\n  <p>%s</p>\n</div>'
            % (e(hd['eyebrow']), v, e(hd['h2']), e(hd['intro'])))


# ---------------------------------------------------------------- A: bento
def var_a(hd, tools):
    tiles = []
    sizes = ['xl', 'tall', 'wide', 'sq', 'sq', 'sq']
    for i, t in enumerate(tools):
        tiles.append('''  <article class="va-tile va-%s" data-k="%s">
    <button type="button" class="va-hit" aria-haspopup="dialog" data-more="va-more-%s"><span class="sr-only">Expand %s</span></button>
    <span class="va-num" aria-hidden="true">%s</span>
    <div class="va-top"><span class="dp-k">%s / 06</span><h3>%s</h3></div>
    <div class="va-shot">%s<span class="dp-tagchip">%s</span></div>
    <div class="va-more" id="va-more-%s">
      <p>%s</p>%s
      <p class="dp-cap">%s</p>
      %s
    </div>
    <span class="va-plus" aria-hidden="true"></span>
  </article>''' % (sizes[i], t['k'], t['k'], e(t['title']), t['k'], t['k'], e(t['title']),
                   shot(t), TAGS[t['k']], t['k'], e(t['body']), disc(t), e(SHOTS[t['k']][3]), go(t)))
    hub = '''  <article class="va-tile va-hub">
    <span class="dp-k">%s</span>
    <b class="va-hub-big">%s</b>
    <span class="va-hub-dots" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
  </article>''' % (e(hd['hub_eyebrow']), e(hd['hub']))
    return '<div class="va-grid">\n%s\n%s\n</div>' % (tiles[0] + '\n' + hub, '\n'.join(tiles[1:]))


# ---------------------------------------------------------- B: sticky story
def var_b(hd, tools):
    screens = '\n'.join('      <figure class="vb-scr%s" data-k="%s">%s<figcaption>%s</figcaption></figure>'
                        % (' on' if i == 0 else '', t['k'], shot(t, lazy=i > 0), e(SHOTS[t['k']][3]))
                        for i, t in enumerate(tools))
    rail = '\n'.join('        <i data-k="%s"%s></i>' % (t['k'], ' class="on"' if i == 0 else '') for i, t in enumerate(tools))
    steps = '\n'.join('''    <article class="vb-step%s" data-k="%s">
      <span class="vb-n" aria-hidden="true">%s</span>
      <span class="dp-k">%s / 06 · %s</span>
      <h3>%s</h3>
      <p>%s</p>%s
      %s
    </article>''' % (' on' if i == 0 else '', t['k'], t['k'], t['k'], e(t['label']), e(t['title']),
                     e(t['body']), disc(t), go(t)) for i, t in enumerate(tools))
    return '''<div class="vb-wrap">
  <div class="vb-stick">
    <div class="vb-device">
      <div class="dp-chrome" aria-hidden="true"><i></i><i></i><i></i><span class="vb-url">strykertrading.com / <b id="vb-path">%s</b></span></div>
      <div class="vb-screens">
%s
      </div>
      <div class="vb-rail" aria-hidden="true">
%s
      </div>
    </div>
  </div>
  <div class="vb-steps">
%s
  </div>
</div>''' % (e(tools[0]['href']), screens, rail, steps)


# ---------------------------------------------------------------- C: orbit
def var_c(hd, tools):
    nodes = '\n'.join('''      <button type="button" class="vc-node%s" role="tab" id="vc-tab-%s" aria-selected="%s" aria-controls="vc-pane-%s" style="--i:%d">
        <span class="vc-node-in"><b>%s</b><span>%s</span></span>
      </button>''' % (' on' if i == 0 else '', t['k'], 'true' if i == 0 else 'false', t['k'], i, t['k'], e(t['label']))
                      for i, t in enumerate(tools))
    panes = '\n'.join('''    <div class="vc-pane%s" role="tabpanel" id="vc-pane-%s" aria-labelledby="vc-tab-%s"%s>
      <span class="dp-k">%s / 06</span>
      <h3>%s</h3>
      <p>%s</p>%s
      %s
      %s
    </div>''' % (' on' if i == 0 else '', t['k'], t['k'], '' if i == 0 else ' hidden', t['k'], e(t['title']),
                 e(t['body']), disc(t), viz(t), go(t)) for i, t in enumerate(tools))
    return '''<div class="vc-wrap">
  <div class="vc-stage">
    <div class="vc-rings" aria-hidden="true"><i></i><i></i><i></i></div>
    <svg class="vc-spokes" viewBox="-100 -100 200 200" aria-hidden="true"></svg>
    <div class="vc-hub" aria-hidden="true">
      <span>%s</span>
      <b>%s</b>
      <i class="vc-hub-pulse"></i>
    </div>
    <div class="vc-orbit" role="tablist" aria-label="The six platform tools">
%s
    </div>
  </div>
  <div class="vc-panes">
%s
  </div>
</div>''' % (e(hd['hub_eyebrow']), e(hd['hub']), nodes, panes)


# ----------------------------------------------------------------- D: rail
def var_d(hd, tools):
    cards = '\n'.join('''    <article class="vd-card" data-k="%s">
      <div class="vd-device">
        <div class="dp-chrome" aria-hidden="true"><i></i><i></i><i></i><span>%s</span></div>
        <div class="vd-screen">%s</div>
      </div>
      <div class="vd-body">
        <span class="dp-k">%s / 06</span>
        <h3>%s</h3>
        <p>%s</p>%s
        <p class="dp-cap">%s</p>
        %s
      </div>
    </article>''' % (t['k'], e(t['href']), shot(t), t['k'], e(t['title']), e(t['body']), disc(t),
                     e(SHOTS[t['k']][3]), go(t)) for t in tools)
    dots = ''.join('<button type="button" aria-label="Go to %s"%s></button>'
                   % (e(t['title']), ' class="on"' if i == 0 else '') for i, t in enumerate(tools))
    return '''<div class="vd-wrap">
  <div class="vd-bar">
    <span class="vd-count" aria-live="polite"><b id="vd-cur">01</b> / 06</span>
    <div class="vd-arrows">
      <button type="button" class="vd-prev" aria-label="Previous tool" disabled>←</button>
      <button type="button" class="vd-next" aria-label="Next tool">→</button>
    </div>
  </div>
  <div class="vd-rail" tabindex="0" aria-label="The six platform tools, swipe or use the arrows">
%s
  </div>
  <div class="vd-dots">%s</div>
</div>''' % (cards, dots)


VARIANTS = [
    ('A', 'Bento grid', 'Mixed tile sizes, giant numerals and a cropped real screen in every tile. Tap a tile to open it.', var_a),
    ('B', 'Sticky scroll story', 'The screen on one side stays put while the six tools scroll past; the screen swaps to each tool.', var_b),
    ('C', 'Orbit hub', '“One login” in the centre with the six tools circling it. Tap a tool to bring its panel forward.', var_c),
    ('D', 'Swipe rail', 'Big device-framed cards on a snap rail: swipe on a phone, arrows on desktop.', var_d),
]


def build():
    hd, tools = extract()
    build_no = json.load(open(os.path.join(ROOT, 'assets', 'version.json')))['build']
    secs = []
    for key, name, idea, fn in VARIANTS:
        v = 'v' + key.lower()
        secs.append('''<section class="dp-var %s" id="var-%s" aria-labelledby="%s-lbl">
<div class="dp-label"><span class="dp-letter" aria-hidden="true">%s</span><div><h2 class="dp-name" id="%s-lbl">Variation %s · %s</h2><p>%s</p></div></div>
<div class="dp-sec">
%s
%s
</div>
</section>''' % (v, key, v, key, v, key, e(name), e(idea), head_block(hd, v), fn(hd, tools)))
    chips = ''.join('<a href="#var-%s" data-v="%s">%s</a>' % (k, k, k) for k, *_ in VARIANTS)
    tpl = open(os.path.join(os.path.dirname(__file__), 'page.tpl.html'), encoding='utf-8').read()
    out = (tpl.replace('{{BUILD}}', str(build_no))
              .replace('{{CHIPS}}', chips)
              .replace('{{VARIANTS}}', '\n\n'.join(secs)))
    open(OUT, 'w', encoding='utf-8').write(out)
    print('wrote', os.path.relpath(OUT, ROOT), 'build', build_no, '-', len(tools), 'tools')


if __name__ == '__main__':
    build()
