"""Shared figure library for the specialist-track chapters (tools/tracks/).

Every diagram in a track chapter is computed here from data, never drawn by
eye: bar lengths are proportional to volume, the value area is found with the
standard CBOT two-row method, footprint imbalances are compared diagonally,
and every coordinate comes from a price->y scale. Chapter source scripts
(tools/tracks/<track>/src/<ID>.py) import this, build their figures, and write
tools/tracks/<track>/<ID>.json.

Output rules (they match how chapter.html renders bodyHtml, which goes in via
innerHTML with no sanitiser):
  * pure inline SVG, no <script>, no <style>, no event attributes, no
    external hrefs;
  * the viewBox is 400 units wide, so a 390px phone (about 320px of figure)
    shows 14-unit text at about 11px. Nothing is smaller than 13 units;
  * figures are capped at 560px wide so desktop text doesn't get huge;
  * figure() adds "Illustrative data" to the caption when the numbers are made up.
"""
from xml.etree import ElementTree as ET
import html

BG = '#050506'
LINE = '#1e1e22'
GRID = '#26262b'
INK = '#eeeeee'
MUTED = '#8b93a0'
GREEN = '#03c988'
GREEN_SOFT = '#7fe0c2'
RED = '#e5484d'
RED_SOFT = '#f08488'
TEAL = '#00adb5'
GOLD = '#f5c542'
FONT = "JetBrains Mono, ui-monospace, monospace"
SANS = "Space Grotesk, system-ui, sans-serif"
W = 400
MIN_FONT = 13


def esc(s):
    return html.escape(str(s), quote=True)


def f(v):
    """Round a coordinate to one decimal and drop trailing zeros."""
    s = ('%.1f' % v).rstrip('0').rstrip('.')
    return '0' if s == '-0' else s


def text(x, y, s, size=14, fill=INK, anchor='start', weight=None, family=FONT):
    assert size >= MIN_FONT, 'font below %d units' % MIN_FONT
    w = ' font-weight="%s"' % weight if weight else ''
    return ('<text x="%s" y="%s" font-size="%s" fill="%s" text-anchor="%s" font-family="%s"%s>%s</text>'
            % (f(x), f(y), size, fill, anchor, family, w, esc(s)))


def line(x1, y1, x2, y2, stroke=MUTED, width=1.2, dash=None):
    d = ' stroke-dasharray="%s"' % dash if dash else ''
    return ('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s" stroke-width="%s"%s/>'
            % (f(x1), f(y1), f(x2), f(y2), stroke, width, d))


def rect(x, y, w, h, fill='none', stroke='none', opacity=None, rx=0, width=1):
    o = ' fill-opacity="%s"' % opacity if opacity is not None else ''
    r = ' rx="%s"' % rx if rx else ''
    s = ' stroke="%s" stroke-width="%s"' % (stroke, width) if stroke != 'none' else ''
    return '<rect x="%s" y="%s" width="%s" height="%s" fill="%s"%s%s%s/>' % (
        f(x), f(y), f(max(w, 0)), f(max(h, 0)), fill, o, s, r)


def svg(height, parts, title, desc=''):
    """Wrap parts in a 400-wide responsive SVG with an accessible title."""
    body = ''.join(parts)
    out = ('<svg viewBox="0 0 %d %d" xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" role="img" '
           'aria-label="%s" style="width:100%%; height:auto; display:block; max-width:560px; margin:0 auto;">'
           '<title>%s</title>%s</svg>') % (W, height, W, height, esc(title), esc(title), body)
    ET.fromstring(out)  # fail loudly on malformed markup
    return out


def figure(svg_markup, caption, illustrative=True):
    cap = caption.strip()
    if illustrative and 'llustrative' not in cap:
        cap = 'Illustrative data. ' + cap
    return ('<figure style="background:%s; border:1px solid %s; border-radius:12px; padding:20px 12px 14px; margin:24px 0;">'
            '%s<figcaption style="margin-top:12px; font-size:13px; line-height:1.55; color:%s; text-align:center;">%s</figcaption></figure>'
            % (BG, LINE, svg_markup, MUTED, cap))


# ---------------------------------------------------------------- maths

def value_area(prices, vols, pct=0.70):
    """CBOT two-row method. Start at the POC; compare the sum of the next two
    rows above with the next two below; add the larger pair; repeat until the
    included volume reaches pct of the total. Returns (poc_i, lo_i, hi_i), with
    indices into the price list, which runs low to high."""
    n = len(prices)
    total = float(sum(vols))
    poc = max(range(n), key=lambda i: (vols[i], -abs(i - (n - 1) / 2)))
    lo = hi = poc
    acc = vols[poc]
    while acc < pct * total and (lo > 0 or hi < n - 1):
        up = sum(vols[hi + 1:hi + 3]) if hi < n - 1 else -1
        dn = sum(vols[max(lo - 2, 0):lo]) if lo > 0 else -1
        if up >= dn:
            k = min(2, n - 1 - hi)
            acc += sum(vols[hi + 1:hi + 1 + k]); hi += k
        else:
            k = min(2, lo)
            acc += sum(vols[lo - k:lo]); lo -= k
    return poc, lo, hi


def value_area_steps(prices, vols, pct=0.70):
    """Same algorithm, returning each step for a worked table."""
    n = len(prices); total = float(sum(vols))
    poc = max(range(n), key=lambda i: (vols[i], -abs(i - (n - 1) / 2)))
    lo = hi = poc; acc = vols[poc]; steps = []
    while acc < pct * total and (lo > 0 or hi < n - 1):
        up = sum(vols[hi + 1:hi + 3]) if hi < n - 1 else -1
        dn = sum(vols[max(lo - 2, 0):lo]) if lo > 0 else -1
        if up >= dn:
            k = min(2, n - 1 - hi); add = sum(vols[hi + 1:hi + 1 + k]); hi += k; side = 'above'
        else:
            k = min(2, lo); add = sum(vols[lo - k:lo]); lo -= k; side = 'below'
        acc += add
        steps.append({'up': up, 'down': dn, 'side': side, 'added': add, 'acc': acc,
                      'pct': acc / total, 'lo': prices[lo], 'hi': prices[hi]})
    return poc, lo, hi, steps


def vwap(bars):
    """bars: list of (typical_price, volume). Returns running VWAP and the
    running population standard deviation of price around it (volume-weighted)."""
    pv = v = pv2 = 0.0; out = []
    for p, vol in bars:
        pv += p * vol; v += vol; pv2 += p * p * vol
        m = pv / v
        var = max(pv2 / v - m * m, 0.0)
        out.append((m, var ** 0.5))
    return out


def delta_rows(rows):
    """rows: {price: (bid_vol, ask_vol)} -> (delta, total)."""
    d = sum(a - b for b, a in rows.values()); t = sum(a + b for b, a in rows.values())
    return d, t


def diagonal_imbalances(rows, tick, ratio=3.0):
    """Buy imbalance at p: ask volume at p >= ratio x bid volume at p - tick.
    Sell imbalance at p: bid volume at p >= ratio x ask volume at p + tick.
    This is the diagonal comparison the major footprint platforms describe.
    Returns (set of buy-imbalance prices, set of sell-imbalance prices)."""
    buys, sells = set(), set()
    for p, (bid, ask) in rows.items():
        below = rows.get(round(p - tick, 6)); above = rows.get(round(p + tick, 6))
        if below is not None and ask > 0 and ask >= ratio * max(below[0], 1):
            buys.add(p)
        if above is not None and bid > 0 and bid >= ratio * max(above[1], 1):
            sells.add(p)
    return buys, sells


# ---------------------------------------------------------------- scales

class YScale:
    def __init__(self, lo, hi, top, bottom):
        self.lo, self.hi, self.top, self.bottom = lo, hi, top, bottom

    def __call__(self, p):
        return self.bottom - (p - self.lo) / float(self.hi - self.lo) * (self.bottom - self.top)


def fmt(p, dp=2):
    return ('{:,.%df}' % dp).format(p)


# ---------------------------------------------------------------- figures

def profile(prices, vols, title, dp=2, pct=0.70, left=86, right=384, top=18, row_h=None,
            mark_nodes=None, show_vols=False, color=TEAL, notes=None):
    """Horizontal volume-at-price histogram, prices low->high. Marks POC, VAH, VAL.
    mark_nodes: {index: 'HVN'|'LVN'|text}. notes: list of (index, text) drawn at the right."""
    n = len(prices)
    row_h = row_h or max(16, min(24, 330 // n))
    h = top + n * row_h + 34
    poc, lo, hi = value_area(prices, vols, pct)
    vmax = float(max(vols)); span = right - left - (130 if show_vols else 90)
    o = []
    y_of = lambda i: top + (n - 1 - i) * row_h
    o.append(rect(left - 4, y_of(hi) - 2, right - left + 4, (hi - lo + 1) * row_h + 4, fill=color, opacity=0.07))
    for i in range(n):
        y = y_of(i)
        inva = lo <= i <= hi
        c = GOLD if i == poc else (color if inva else MUTED)
        op = 0.95 if i == poc else (0.75 if inva else 0.45)
        o.append(rect(left, y + 2, vols[i] / vmax * span, row_h - 4, fill=c, opacity=op, rx=2))
        o.append(text(left - 8, y + row_h / 2 + 5, fmt(prices[i], dp), 13, MUTED, 'end'))
        if show_vols:
            o.append(text(left + vols[i] / vmax * span + 6, y + row_h / 2 + 5, '{:,}'.format(vols[i]), 13, MUTED))
    tags = {}
    for i, name in ((hi, 'VAH'), (poc, 'POC'), (lo, 'VAL')):
        tags.setdefault(i, []).append(name)
    for i, t in list((mark_nodes or {}).items()) + list(notes or []):
        tags.setdefault(i, []).append(t)
    for i, names in tags.items():
        col = GOLD if i == poc else (color if i in (hi, lo) else INK)
        o.append(text(right, y_of(i) + row_h / 2 + 5, ' '.join(names), 14, col, 'end', 'bold'))
    tot = sum(vols); inc = sum(vols[lo:hi + 1])
    o.append(text(left, h - 10, 'value area = %.0f%% of %s contracts' % (100.0 * inc / tot, '{:,}'.format(tot)), 13, MUTED))
    return svg(h, o, title), (poc, lo, hi)


def tpo(periods, prices, title, dp=2, ib_periods=2, top=18, row_h=20, col_w=17, left=86,
        highlight_singles=True):
    """Market Profile. periods: ordered list of (letter, [prices traded in that period]).
    Letters are collapsed to the left (the standard profile view). Marks the IB
    (first ib_periods periods), single prints, and the TPO POC."""
    n = len(prices); idx = {p: i for i, p in enumerate(prices)}
    rows = [[] for _ in range(n)]
    for letter, ps in periods:
        for p in ps:
            rows[idx[p]].append(letter)
    counts = [len(r) for r in rows]
    poc = max(range(n), key=lambda i: (counts[i], -abs(i - (n - 1) / 2)))
    ib = set()
    for letter, ps in periods[:ib_periods]:
        ib.update(ps)
    h = top + n * row_h + 34
    o = []
    y_of = lambda i: top + (n - 1 - i) * row_h
    ibi = [idx[p] for p in ib]
    ib_lo, ib_hi = min(ibi), max(ibi)
    o.append(rect(left - 10, y_of(ib_hi), 5, (ib_hi - ib_lo + 1) * row_h, fill=GOLD, opacity=0.9))
    for i in range(n):
        y = y_of(i)
        traded = [k for k in range(n) if counts[k]]
        single = highlight_singles and counts[i] == 1 and min(traded) < i < max(traded)
        if single:
            o.append(rect(left - 2, y + 1, col_w + 4, row_h - 2, fill=RED, opacity=0.18, rx=2))
        o.append(text(left - 16, y + row_h - 5, fmt(prices[i], dp), 13, MUTED, 'end'))
        for k, letter in enumerate(rows[i]):
            col = GOLD if i == poc else (RED_SOFT if single else INK)
            o.append(text(left + k * col_w + col_w / 2, y + row_h - 5, letter, 14, col, 'middle'))
    o.append(text(W - 8, y_of(poc) + row_h - 5, 'POC', 14, GOLD, 'end', 'bold'))
    o.append(text(left - 16, h - 10, 'gold bar = initial balance', 13, MUTED))
    return svg(h, o, title), {'poc': prices[poc], 'counts': counts, 'ib': (prices[ib_lo], prices[ib_hi])}


def candles(ohlc, title, lo=None, hi=None, height=260, left=16, right=330, top=20, bottom=None,
            levels=None, zones=None, labels=None, overlay=None, dp=2, axis=True):
    """Candlestick chart. levels: list of (price, text, colour, dash). zones: list of
    (p1, p2, text, colour). labels: list of (bar_index, price, text, colour, 'above'|'below').
    overlay: list of (list_of_values_or_None, colour, dash) drawn as polylines per bar."""
    bottom = bottom or height - 24
    lo = lo if lo is not None else min(b[2] for b in ohlc)
    hi = hi if hi is not None else max(b[1] for b in ohlc)
    pad = (hi - lo) * 0.06; Y = YScale(lo - pad, hi + pad, top, bottom)
    n = len(ohlc); step = (right - left) / float(n); bw = max(4, step * 0.6)
    X = lambda i: left + step * (i + 0.5)
    o = []
    for p1, p2, t, c in zones or []:
        o.append(rect(left, Y(max(p1, p2)), right - left, abs(Y(p1) - Y(p2)), fill=c, opacity=0.14))
    zone_labels = [(left + 4, Y(max(p1, p2)) + 15, t, c) for p1, p2, t, c in zones or []]
    for p, t, c, dash in levels or []:
        o.append(line(left, Y(p), right, Y(p), c, 1.2, dash))
        assert right + 4 + len(t) * 8 <= W + 2, 'level label too long for the right margin: %r' % t
        o.append(text(right + 4, Y(p) + 5, t, 13, c))
    for i, (op, h_, l_, cl) in enumerate(ohlc):
        c = GREEN if cl >= op else RED
        o.append(line(X(i), Y(h_), X(i), Y(l_), c, 1.3))
        o.append(rect(X(i) - bw / 2, Y(max(op, cl)), bw, max(abs(Y(op) - Y(cl)), 1.2), fill=c))
    for vals, c, dash in overlay or []:
        pts = [(X(i), Y(v)) for i, v in enumerate(vals) if v is not None]
        if pts:
            d = ' stroke-dasharray="%s"' % dash if dash else ''
            o.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="1.8"%s/>'
                     % (' '.join('%s,%s' % (f(a), f(b)) for a, b in pts), c, d))
    for x, y, t, c in zone_labels:
        o.append(rect(x - 2, y - 12, len(t) * 8.4 + 4, 16, fill=BG, opacity=0.85, rx=2))
        o.append(text(x, y, t, 13, c))
    for i, p, t, c, where in labels or []:
        y = Y(p) - 8 if where == 'above' else Y(p) + 18
        o.append(text(X(i), y, t, 13, c, 'middle'))
    if axis:
        for p in (lo, hi):
            o.append(text(right + 4, Y(p) + 5, fmt(p, dp), 13, MUTED))
    return svg(height, o, title), (X, Y)


def dom(rows, title, dp=2, last=None, highlight=None, note=None):
    """DOM ladder. rows: list of (price, bid_size_or_None, ask_size_or_None), high->low.
    highlight: {price: text}."""
    row_h = 24; top = 34; h = top + len(rows) * row_h + (34 if note else 14)
    cx = (70, 200, 330)
    o = [text(cx[0], 22, 'BID', 14, GREEN, 'middle', 'bold'), text(cx[1], 22, 'PRICE', 14, MUTED, 'middle', 'bold'),
         text(cx[2], 22, 'ASK', 14, RED, 'middle', 'bold')]
    for k, (p, b, a) in enumerate(rows):
        y = top + k * row_h
        if last is not None and abs(p - last) < 1e-9:
            o.append(rect(135, y, 130, row_h, fill=GOLD, opacity=0.18))
        o.append(rect(10, y, 380, row_h, stroke=LINE, width=1))
        if b:
            o.append(rect(10, y + 2, 120, row_h - 4, fill=GREEN, opacity=0.14))
            o.append(text(cx[0], y + 17, '{:,}'.format(b), 14, GREEN_SOFT, 'middle'))
        if a:
            o.append(rect(270, y + 2, 120, row_h - 4, fill=RED, opacity=0.14))
            o.append(text(cx[2], y + 17, '{:,}'.format(a), 14, RED_SOFT, 'middle'))
        o.append(text(cx[1], y + 17, fmt(p, dp), 14, INK, 'middle'))
        if highlight and p in highlight:
            o.append(text(cx[1] + 62, y + 17, highlight[p], 13, GOLD, 'start'))
    if note:
        o.append(text(200, h - 10, note, 13, MUTED, 'middle'))
    return svg(h, o, title)


def footprint(bars, title, tick, dp=2, ratio=3.0, show_imb=True, labels=None):
    """Bid x ask footprint. bars: list of {'rows': {price: (bid, ask)}, 'o': open, 'c': close}.
    Up to 3 bars fit at 400 wide. Diagonal imbalances are bold and coloured.
    Draws per-bar delta and total underneath. labels: list of (bar_i, text)."""
    prices = sorted({p for b in bars for p in b['rows']}, reverse=True)
    row_h = 21; top = 16; axis_w = 74
    colw = (W - axis_w - 8) / float(len(bars))
    h = top + len(prices) * row_h + 58 + (20 if labels else 0)
    o = []
    for k, p in enumerate(prices):
        o.append(text(axis_w - 8, top + k * row_h + 15, fmt(p, dp), 13, MUTED, 'end'))
    for j, b in enumerate(bars):
        x0 = axis_w + j * colw + 4
        buys, sells = diagonal_imbalances(b['rows'], tick, ratio) if show_imb else (set(), set())
        ps = sorted(b['rows'], reverse=True)
        yt = top + prices.index(ps[0]) * row_h; yb = top + (prices.index(ps[-1]) + 1) * row_h
        up = b['c'] >= b['o']
        o.append(rect(x0, yt, colw - 8, yb - yt, stroke=GREEN if up else RED, width=1.2, rx=3))
        bo, bc = sorted((b['o'], b['c']))
        yb1 = top + prices.index(bc) * row_h; yb2 = top + (prices.index(bo) + 1) * row_h
        o.append(rect(x0, yb1, 4, yb2 - yb1, fill=GREEN if up else RED))
        mid = x0 + (colw - 8) / 2
        for p in ps:
            bid, ask = b['rows'][p]; y = top + prices.index(p) * row_h + 15
            o.append(text(mid - 6, y, '{:,}'.format(bid), 13, RED_SOFT if p in sells else MUTED, 'end',
                          'bold' if p in sells else None))
            o.append(text(mid, y, 'x', 13, LINE, 'middle'))
            o.append(text(mid + 6, y, '{:,}'.format(ask), 13, GREEN_SOFT if p in buys else MUTED, 'start',
                          'bold' if p in buys else None))
        d, t = delta_rows(b['rows'])
        yy = top + len(prices) * row_h + 20
        o.append(text(mid, yy, 'delta %+d' % d, 14, GREEN if d > 0 else (RED if d < 0 else MUTED), 'middle', 'bold'))
        o.append(text(mid, yy + 18, 'vol %s' % '{:,}'.format(t), 13, MUTED, 'middle'))
        for bi, t_ in labels or []:
            if bi == j:
                o.append(text(mid, yy + 38, t_, 13, GOLD, 'middle'))
    o.append(text(axis_w - 8, top + len(prices) * row_h + 20, 'delta', 13, MUTED, 'end'))
    return svg(h, o, title)


def series(values_list, title, height=200, left=16, right=330, top=18, bottom=None, zero=False,
           labels=None, dp=0, point_labels=None):
    """Simple line chart for one or more series. values_list: list of (values, colour, name).
    point_labels: list of (i, value, text, colour)."""
    bottom = bottom or height - 26
    allv = [v for vals, _, _ in values_list for v in vals if v is not None]
    lo, hi = min(allv + ([0] if zero else [])), max(allv + ([0] if zero else []))
    pad = (hi - lo) * 0.08 or 1; Y = YScale(lo - pad, hi + pad, top, bottom)
    n = max(len(v) for v, _, _ in values_list); step = (right - left) / float(max(n - 1, 1))
    X = lambda i: left + step * i
    o = []
    if zero:
        o.append(line(left, Y(0), right, Y(0), GRID, 1, '3 3'))
        o.append(text(right + 4, Y(0) + 5, '0', 13, MUTED))
    used = []
    for k, (vals, c, name) in enumerate(values_list):
        pts = ' '.join('%s,%s' % (f(X(i)), f(Y(v))) for i, v in enumerate(vals) if v is not None)
        o.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="2"/>' % (pts, c))
        last = max(i for i, v in enumerate(vals) if v is not None)
        ly = Y(vals[last]) + 5
        while any(abs(ly - u) < 15 for u in used):   # keep end labels apart
            ly += 15
        used.append(ly)
        o.append(text(right + 4, ly, name, 13, c))
    for i, v, t, c in point_labels or []:
        o.append('<circle cx="%s" cy="%s" r="4" fill="%s"/>' % (f(X(i)), f(Y(v)), c))
        o.append(text(X(i), Y(v) - 10, t, 13, c, 'middle'))
    return svg(height, o, title), (X, Y)


def boxes(items, title, cols=2, box_h=74, gap=12, top=10):
    """Simple labelled boxes (definitions, flows). items: list of (heading, [lines], colour)."""
    rows = (len(items) + cols - 1) // cols
    bw = (W - 20 - gap * (cols - 1)) / float(cols)
    h = top + rows * (box_h + gap) + 4
    o = []
    for k, (hd, lines_, c) in enumerate(items):
        x = 10 + (k % cols) * (bw + gap); y = top + (k // cols) * (box_h + gap)
        o.append(rect(x, y, bw, box_h, stroke=c, width=1.3, rx=6))
        o.append(text(x + bw / 2, y + 22, hd, 14, c, 'middle', 'bold'))
        for m, ln in enumerate(lines_):
            o.append(text(x + bw / 2, y + 42 + m * 17, ln, 13, MUTED, 'middle'))
    return svg(h, o, title)


# ---------------------------------------------------------------- html helpers

def table(head, rows):
    th = ''.join('<th>%s</th>' % esc(x) for x in head)
    tr = ''.join('<tr>%s</tr>' % ''.join('<td>%s</td>' % esc(c) for c in r) for r in rows)
    # style.css gives every table min-width:640px, which would push a 390px phone page sideways.
    # The wrapper scrolls if a table is still too wide; min-width:0 lets it fit in the first place.
    return ('<div style="max-width:100%%; overflow-x:auto; margin:20px 0;"><table style="min-width:0; width:100%%; font-size:13px;">'
            '<thead><tr>%s</tr></thead><tbody>%s</tbody></table></div>' % (th, tr))


def callout(title, body_html, colour=GREEN):
    return ('<div style="border-left:3px solid %s; background:rgba(3,201,136,0.06); padding:14px 16px; '
            'border-radius:8px; margin:22px 0;"><p style="margin:0 0 6px;"><strong>%s</strong></p>%s</div>'
            % (colour, esc(title), body_html))


def quiz(items):
    """items: list of (question, answer_html). Uses <details> so it works with no JS."""
    out = ['<h3>Self-check quiz</h3>']
    for k, (q, a) in enumerate(items, 1):
        out.append('<details style="border:1px solid %s; border-radius:8px; padding:10px 14px; margin:10px 0;">'
                   '<summary style="cursor:pointer;"><strong>%d.</strong> %s</summary>'
                   '<div style="margin-top:10px;">%s</div></details>' % (LINE, k, esc(q), a))
    return ''.join(out)


def sources(items):
    """items: list of (title, url)."""
    lis = ''.join('<li><a href="%s" target="_blank" rel="noopener">%s</a></li>' % (esc(u), esc(t)) for t, u in items)
    return '<h3>Sources</h3><ol class="trk-sources">%s</ol>' % lis


DISCLAIMER = ('<p style="font-size:13px; color:%s; border-top:1px solid %s; padding-top:14px; margin-top:28px;">'
              'Education only. Not financial advice. Diagrams marked illustrative use made-up numbers to show '
              'how a method works; they are not real market data or a record of real trades.</p>' % (MUTED, LINE))


# ---------------------------------------------------------------- chapter writer

def _strip(h):
    import re
    h = re.sub(r'<svg[\s\S]*?</svg>', ' ', h)
    h = re.sub(r'<figure[\s\S]*?</figure>', ' ', h)
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', h)).strip()


def write_chapter(track, num, title, level, dur, lessons, body_parts, source_list, min_role=None):
    """lessons: list of (title, descHtml). body_parts: list of HTML strings, joined in order.
    Appends the sources list and the disclaimer, then writes tools/tracks/<track>/<num>.json."""
    import json, os, re
    body = '\n'.join(body_parts) + '\n' + sources(source_list) + '\n' + DISCLAIMER
    # style.css resets ul/ol to list-style:none site-wide; restore markers inside chapter text.
    lists = lambda h: (h.replace('<ul>', '<ul style="list-style:disc; padding-left:22px; margin:0 0 18px;">')
                        .replace('<ol>', '<ol style="list-style:decimal; padding-left:22px; margin:0 0 18px;">')
                        .replace('<ol class="trk-sources">', '<ol class="trk-sources" style="list-style:decimal; padding-left:22px; font-size:13.5px;">')
                        .replace('<li>', '<li style="margin-bottom:8px;">'))
    body = lists(body)
    lessons = [(t, lists(h)) for t, h in lessons]
    paragraphs = [_strip(m) for m in re.findall(r'<p>([\s\S]*?)</p>', body)]
    ch = {
        'num': num, 'title': title, 'level': level, 'dur': dur, 'video': '',
        'minRole': min_role, 'track': track,
        'lessons': [{'title': t, 'desc': _strip(h)[:300], 'descHtml': h} for t, h in lessons],
        'bodyHtml': body, 'paragraphs': paragraphs,
    }
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), track, num + '.json')
    json.dump(ch, open(out, 'w'), ensure_ascii=False, indent=1)
    print('wrote', out)


def cards(head, rows):
    """Text-heavy table rendered as stacked cards, which reads far better on a phone than
    a narrow multi-column table. The first column becomes the card heading."""
    out = []
    for r in rows:
        lines = ''.join('<p style="margin:4px 0 0;"><span style="color:%s;">%s:</span> %s</p>' % (MUTED, esc(h), esc(v))
                        for h, v in zip(head[1:], r[1:]))
        out.append('<div style="border:1px solid %s; border-radius:8px; padding:12px 14px; margin:10px 0;">'
                   '<p style="margin:0;"><strong>%s</strong></p>%s</div>' % (LINE, esc(r[0]), lines))
    return '<div style="margin:20px 0;">%s</div>' % ''.join(out)
