#!/usr/bin/env python3
"""Generate the computed SVG figures used by the batch-2 Learn articles.

The figures are pasted into tools/learn/<slug>.html between FIG markers by
running this script (python3 tools/learn/figs.py). Geometry is computed here,
not drawn by eye: break points are the exact intersections of the price path
with the broken level, and drawdown floors are walked from the hypothetical
balance path using each rule's definition. All data is ILLUSTRATIVE.
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))


def f(v):
    return ('%.1f' % v).rstrip('0').rstrip('.')


def cross_x(p, q, y):
    """x where segment p->q crosses horizontal level y."""
    (x1, y1), (x2, y2) = p, q
    t = (y - y1) / (y2 - y1)
    assert 0 <= t <= 1, (p, q, y)
    return x1 + t * (x2 - x1)


# ---------------------------------------------------------------- BOS / CHoCH
def bos_choch():
    P = [(20, 272), (62, 196), (98, 238), (150, 150), (190, 200), (244, 92),
         (284, 152), (322, 116), (360, 214), (392, 168), (410, 262)]
    # levels: (step, level y, from swing idx, to crossing segment (a,b), label, cls)
    bos1 = cross_x(P[2], P[3], P[1][1])
    bos2 = cross_x(P[4], P[5], P[3][1])
    choch = cross_x(P[7], P[8], P[6][1])
    strict = cross_x(P[7], P[8], P[4][1])
    bos3 = cross_x(P[9], P[10], P[8][1])
    out = []
    out.append('<svg viewBox="0 0 452 300" role="img" aria-labelledby="bc1t bc1d">')
    out.append('<title id="bc1t">Step-through: break of structure and change of character</title>')
    out.append('<desc id="bc1d">An illustrative swing path. Price makes higher highs and higher lows, '
               'breaking two prior highs (bullish breaks of structure). It then makes a lower high and '
               'breaks the most recent higher low (a change of character), then breaks the new low '
               '(a bearish break of structure).</desc>')

    def seg(step, pts):
        return '<polyline class="path" data-step="%d" points="%s"/>' % (
            step, ' '.join('%s,%s' % (f(x), f(y)) for x, y in pts))

    def level(step, y, x1, x2, cls, lab, lx, ly, anchor='start', lcls='lbl-g'):
        return ('<g data-step="%d"><line class="%s" x1="%s" y1="%s" x2="%s" y2="%s"/>'
                '<circle class="hit" cx="%s" cy="%s" r="4.5"/>'
                '<text class="%s" x="%s" y="%s" text-anchor="%s">%s</text></g>') % (
            step, cls, f(x1), f(y), f(x2), f(y), f(x2), f(y), lcls, f(lx), f(ly), anchor, lab)

    def lab(step, x, y, t, cls='lbl', anchor='middle'):
        return '<text class="%s" data-step="%d" x="%s" y="%s" text-anchor="%s">%s</text>' % (
            cls, step, f(x), f(y), anchor, t)

    out.append(seg(1, P[0:3]))
    out.append(lab(1, P[1][0], P[1][1] - 10, 'H'))
    out.append(lab(1, P[2][0], P[2][1] + 22, 'L'))
    out.append(seg(2, P[2:4]))
    out.append(level(2, P[1][1], P[1][0], bos1, 'lvl-up', 'BOS', bos1 + 8, P[1][1] + 18))
    out.append(lab(2, P[3][0], P[3][1] - 10, 'HH'))
    out.append(seg(3, P[3:6]))
    out.append(lab(3, P[4][0], P[4][1] + 22, 'HL'))
    out.append(lab(3, P[5][0], P[5][1] - 10, 'HH'))
    out.append(level(3, P[3][1], P[3][0], bos2, 'lvl-up', 'BOS', bos2 + 8, P[3][1] + 18))
    out.append(seg(4, P[5:8]))
    out.append(lab(4, P[6][0], P[6][1] + 22, 'HL'))
    out.append(lab(4, P[7][0], P[7][1] - 10, 'LH', 'lbl-w'))
    out.append(seg(5, P[7:9]))
    out.append(level(5, P[6][1], P[6][0], choch, 'lvl-dn', 'CHoCH', choch - 10, P[6][1] - 8, 'end', 'lbl-r'))
    out.append(level(5, P[4][1], P[4][0], strict, 'lvl', 'protected low', P[4][0] + 22, P[4][1] + 17, 'start', 'lbl-s'))
    out.append(lab(5, P[8][0], P[8][1] + 22, 'LL'))
    out.append(seg(6, P[8:11]))
    out.append(lab(6, P[9][0] + 4, P[9][1] - 10, 'LH'))
    out.append(level(6, P[8][1], P[8][0], bos3, 'lvl-dn', 'BOS', bos3 + 6, P[8][1] - 8, 'start', 'lbl-r'))
    out.append('<text class="lbl-s" x="12" y="20">ILLUSTRATIVE · swing path</text>')
    out.append('</svg>')
    return '\n'.join(out)


# ---------------------------------------------------------------- SMT
def smt_panel(name, pts, a_idx, b_idx, verdict_b, variant, flip):
    H = 230
    tf = (lambda y: H - y) if flip else (lambda y: y)
    P = [(x, tf(y)) for x, y in pts]
    ax, ay = P[a_idx]
    bx, by = P[b_idx]
    o = ['<g data-variant="%s">' % variant]
    o.append('<polyline class="path" points="%s"/>' % ' '.join('%s,%s' % (f(x), f(y)) for x, y in P))
    o.append('<line class="lvl" x1="%s" y1="%s" x2="%s" y2="%s"/>' % (f(ax), f(ay), f(bx + 26), f(ay)))
    o.append('<line class="tline" x1="%s" y1="46" x2="%s" y2="%s"/>' % (f(bx), f(bx), H - 30))
    o.append('<circle class="hit" cx="%s" cy="%s" r="4.5"/>' % (f(ax), f(ay)))
    o.append('<circle class="%s" cx="%s" cy="%s" r="5"/>' % ('hit-r' if 'fails' in verdict_b else 'hit', f(bx), f(by)))
    dy_a = -12 if not flip else 22
    o.append('<text class="lbl" x="%s" y="%s" text-anchor="middle">A</text>' % (f(ax), f(ay + dy_a)))
    dy_b = -12 if by < ay else 24
    o.append('<text class="lbl" x="%s" y="%s" text-anchor="middle">B</text>' % (f(bx), f(by + dy_b)))
    bad = 'fails' in verdict_b
    o.append('<text class="%s" x="270" y="%d" text-anchor="end">B: %s</text>' % (
        'lbl-r' if bad else 'lbl-g', 36 if not flip else H - 12, verdict_b))
    o.append('</g>')
    return '\n'.join(o)


def smt():
    # Same timestamps (x) in both markets. y: smaller = higher price.
    xs = [16, 58, 100, 142, 184, 226, 262]
    es = [190, 120, 78, 132, 116, 62, 170]   # A=78, B=62 -> higher high (takes the high)
    nq = [184, 118, 72, 128, 112, 90, 168]   # A=72, B=90 -> lower high (fails)
    es_p = list(zip(xs, es))
    nq_p = list(zip(xs, nq))
    assert es[5] < es[2] and nq[5] > nq[2]
    panels = []
    for name, p, vb, vbu in (('ES (S&P 500 futures)', es_p, 'higher high', 'lower low'),
                              ('NQ (Nasdaq-100 futures)', nq_p, 'lower high: fails', 'higher low: fails')):
        s = ['<svg viewBox="0 0 280 230" role="img" aria-label="%s, illustrative">' % name]
        s.append('<text class="lbl-s" x="10" y="%d">%s</text>' % (16, name))
        s.append(smt_panel(name, p, 2, 5, vb, 'bear', False))
        s.append(smt_panel(name, p, 2, 5, vbu, 'bull', True))
        s.append('</svg>')
        panels.append('\n'.join(s))
    return panels


# ---------------------------------------------------------------- Drawdown
def drawdown():
    START, DD = 50000, 2000
    # Hypothetical day paths: open, first extreme, second extreme, close
    days = [
        [50000, 49800, 50900, 50600],
        [50600, 51400, 50300, 50500],
        [50500, 50800, 49600, 49900],
        [49900, 50600, 49300, 49500],
    ]
    W, H, L, R, T, B = 430, 290, 58, 12, 20, 40
    lo, hi = 47600, 51800
    n = sum(len(d) for d in days)
    step = (W - L - R) / (n - 1)
    X = lambda i: L + i * step
    Y = lambda v: T + (hi - v) / (hi - lo) * (H - T - B)

    pts = []
    i = 0
    for d in days:
        for v in d:
            pts.append((i, v))
            i += 1

    # floors per mode, walked point by point
    def floors(mode):
        fl = []
        peak = START
        eod_peak = START
        cur = START - DD
        k = 0
        breach = None
        for di, d in enumerate(days):
            for j, v in enumerate(d):
                if mode == 'intraday':
                    peak = max(peak, v)
                    cur = peak - DD
                fl.append(cur)
                if v <= cur and breach is None:
                    breach = k
                k += 1
            if mode == 'eod':
                eod_peak = max(eod_peak, d[-1])
                cur = eod_peak - DD
        return fl, breach

    out = ['<svg viewBox="0 0 %d %d" role="img" aria-labelledby="dd1t dd1d">' % (W, H)]
    out.append('<title id="dd1t">The same hypothetical trades under three drawdown rules</title>')
    out.append('<desc id="dd1d">A hypothetical 50,000 dollar account with a 2,000 dollar maximum loss, over four '
               'trading days. The static floor stays at 48,000. The end-of-day trailing floor rises to 48,600 after '
               'day 1 closes at 50,600. The intraday trailing floor rises to 48,900 and then 49,400 with the '
               'unrealised peaks, and the day-4 dip to 49,300 breaches it.</desc>')
    for v in (48000, 49000, 50000, 51000):
        out.append('<line class="grid" x1="%d" y1="%s" x2="%d" y2="%s"/>' % (L, f(Y(v)), W - R, f(Y(v))))
        out.append('<text class="lbl-s" x="%d" y="%s" text-anchor="end">%s</text>' % (L - 6, f(Y(v) + 4), '{:,}'.format(v)))
    for di in range(len(days)):
        x0 = X(di * 4)
        x1 = X(di * 4 + 3)
        if di:
            out.append('<line class="grid" x1="%s" y1="%d" x2="%s" y2="%d"/>' % (f(x0 - step / 2), T, f(x0 - step / 2), H - B))
        out.append('<text class="lbl-s" x="%s" y="%d" text-anchor="middle">Day %d</text>' % (f((x0 + x1) / 2), H - B + 22, di + 1))
    for mode in ('static', 'eod', 'intraday'):
        fl, breach = floors(mode)
        # step line: floor holds until next point
        seq = []
        for k, v in enumerate(fl):
            x = X(k)
            if seq:
                seq.append((x, seq[-1][1]))
            seq.append((x, Y(v)))
        out.append('<g data-mode="%s">' % mode)
        out.append('<polyline class="floor" points="%s"/>' % ' '.join('%s,%s' % (f(x), f(y)) for x, y in seq))
        last = fl[-1]
        out.append('<text class="lbl-r" x="%d" y="14" text-anchor="end">floor now %s</text>' % (W - R - 2, '{:,}'.format(last)))
        if breach is not None:
            bx, by = X(breach), Y(pts[breach][1])
            out.append('<circle class="hit-r" cx="%s" cy="%s" r="7"/>' % (f(bx), f(by)))
            out.append('<text class="lbl-r" x="%s" y="%s" text-anchor="middle">BREACH</text>' % (f(bx), f(by + 28)))
        out.append('</g>')
    out.append('<polyline class="equity" points="%s"/>' % ' '.join('%s,%s' % (f(X(k)), f(Y(v))) for k, v in pts))
    out.append('<text class="lbl-s" x="%d" y="14">HYPOTHETICAL</text>' % L)
    out.append('</svg>')
    # print a table for the article text
    for mode in ('static', 'eod', 'intraday'):
        fl, b = floors(mode)
        print(mode, 'final floor', fl[-1], 'breach at point', b)
    return '\n'.join(out)


def paste(slug, marker, svg):
    p = os.path.join(HERE, slug + '.html')
    s = open(p).read()
    pat = re.compile(r'(<!-- FIG:%s -->)[\s\S]*?(<!-- /FIG:%s -->)' % (marker, marker))
    assert pat.search(s), (slug, marker)
    s = pat.sub(lambda m: m.group(1) + '\n' + svg + '\n' + m.group(2), s)
    open(p, 'w').write(s)


if __name__ == '__main__':
    paste('bos-vs-choch', 'steps', bos_choch())
    es, nq = smt()
    paste('smt-divergence', 'es', es)
    paste('smt-divergence', 'nq', nq)
    paste('prop-firm-challenge-rules', 'dd', drawdown())
    print('figures written')
