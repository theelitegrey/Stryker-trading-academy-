#!/usr/bin/env python3
"""Build the /features/gex-s1 and gex-s2 section previews.

Each preview = the hero from features/gex-a.html (verbatim) + ONE redesigned
"What's on the GEX page" section + the existing footer. The 12 features, their
copy and the "how it's calculated" text are taken verbatim from gex-a.html.
Run: python3 tools/gex-sections/build.py
"""
import html, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = (ROOT / "features/gex-a.html").read_text()

head_end = SRC.index("<main id=\"main\" tabindex=\"-1\">")
hero = SRC[SRC.index("<header class=\"ft-hero"):SRC.index("</header>") + len("</header>")]
# the A page's 'How GEX works' anchor section is not on these previews: point it at this section
hero = hero.replace('href="#what-is-gex"', 'href="#whats-on-the-page"')
foot = SRC[SRC.index("<footer>"):]

CAP_NQ = "Real capture, Cboe data, Fri 2 Oct 2026, 16:00 ET (QQQ 0DTE on MNQ, 5m chart). Market closed: not current levels."
CAP_SPX = "Real capture, Cboe data, Fri 2 Oct 2026, 16:15 ET (SPX 1DTE on ES, 5m chart). Market closed: these are that session’s levels, not current levels."
CAP_LV = "Real capture, futures data, ES session of Fri 2 Oct 2026 (prior session 1 Oct). Market closed: not current levels."

# copy pulled from gex-a.html tiles, verbatim
tiles = re.findall(r'<h3>(.*?)</h3><p>(.*?)</p><div class="fg-how">(.*?)</div>', SRC[SRC.index('id="whats-on-the-page"'):])
assert len(tiles) == 12, len(tiles)

IMG = "/assets/images/gex-real/"
# overlay kinds: line(y, x2, cls) / box(x,y,w,h) / wash(y) / scan / xfade
F = [
  dict(id="call", short="Call wall", img="sec-callwall.webp", w=740, h=600, cap=CAP_NQ,
       alt="Real capture: the call wall line on the MNQ 5-minute chart, labelled CALL WALL 31080.25, just above the last price 31061.75.",
       ov=[("line", 61.5, 53, "call"), ("box", 75.5, 57.8, 21.5, 7.4)], num=("Call wall", "31080.25")),
  dict(id="put", short="Put wall", img="sec-putwall.webp", w=740, h=600, cap=CAP_NQ,
       alt="Real capture: the zero gamma line at 30898.84 and the put wall line at 30874.74 on the MNQ 5-minute chart.",
       ov=[("line", 85.0, 56, "put"), ("box", 75.5, 81.3, 21.5, 7.4)], num=("Put wall", "30874.74")),
  dict(id="flip", short="Zero gamma", img="sec-flip.webp", w=740, h=290, cap=CAP_SPX,
       alt="Real capture: the ZERO GAMMA line at ES 7759.05 on the ES 5-minute chart.",
       ov=[("wash", 58.4), ("line", 58.4, 53, "zero"), ("box", 53.5, 51, 43.5, 15)], num=("Zero gamma", "7759.05")),
  dict(id="regime", short="Regime", img="sec-regime.webp", w=740, h=230, cap=CAP_SPX,
       alt="Real capture of the GEX regime panel: SPX spot 7,722.72, a POSITIVE GAMMA badge, net GEX 1.19B, IV30 12.2% and ES last 7,777.25.",
       ov=[("box", 35.5, 15, 36, 27), ("box", 71, 13, 27, 36)], num=("Net GEX", "1.19", "B")),
  dict(id="iv", short="IV range", img="sec-iv.webp", w=740, h=300, cap=CAP_SPX,
       alt="Real capture of the IV expected range boxes: 68% 7,718.08 to 7,836.42 and 80% 7,701.39 to 7,853.11, in ES points.",
       ov=[("box", 3, 4, 94, 42), ("box", 3, 55, 94, 42)], num=("68% low", "7,718.08")),
  dict(id="ladder", short="Strike ladder", img="sec-ladder.webp", w=740, h=599, cap=CAP_SPX,
       alt="Real capture of the strike ladder near spot: strike, ES price, net GEX and profile bar per strike.",
       ov=[("scan",), ("box", 59.5, 8, 20.5, 90)], num=None),
  dict(id="expiry", short="Expiry", img="sec-expiry.webp", w=740, h=164, cap=CAP_SPX,
       alt="Real capture of the market buttons SPX, SPY, QQQ, GLD and the expiry buttons 0DTE, 1DTE, 1W and 1M, with SPX and 1DTE selected.",
       ov=[("chip", 1, 57, 13, 37), ("chip", 14.5, 57, 14, 37, 2), ("chip", 29.5, 57, 10, 37, 3), ("chip", 41, 57, 10, 37, 4)], num=None),
  dict(id="futures", short="Futures", img="sec-futures.webp", w=740, h=590, cap=CAP_SPX,
       alt="Real capture of the walls panel: call wall 7,800.00 shown as ES 7,854.53, spot 7,722.72 as ES 7,777.25, zero gamma 7,704.52 as ES 7,759.05, put wall 7,545.00 as ES 7,599.53.",
       ov=[("slide", 27.5), ("slide", 48.5), ("slide", 69), ("slide", 89.5)], num=("Call wall in ES", "7,854.53")),
  dict(id="levels", short="VAH · POC · VAL", img="sec-levels.webp", w=740, h=710, cap=CAP_LV,
       alt="Real capture of the market-generated levels card: prior VAH 7,739.00, prior POC 7,730.00, prior VAL 7,694.00 and the prior RTH, overnight and RTH open levels for ES.",
       ov=[("box", 1.5, 7, 48.5, 21), ("box", 50.5, 7, 48.5, 21), ("box", 1.5, 30, 48.5, 21), ("scan",)], num=("Prior POC", "7,730.00")),
  dict(id="overnight", short="Overnight", img="sec-overnight.webp", w=740, h=600, cap=CAP_NQ,
       alt="Real capture: the overnight high line, labelled ONH 31223.50, on the MNQ 5-minute chart.",
       ov=[("line", 31.3, 65, "on"), ("box", 66, 27.6, 31, 7.4)], num=("ONH", "31223.50")),
  dict(id="chart", short="Chart", img="sec-chart.webp", w=740, h=725, cap=CAP_NQ,
       alt="Real capture of the MNQ 5-minute chart with the overnight high, call wall, zero gamma and put wall drawn as labelled lines.",
       ov=[("line", 8.7, 65, "on"), ("line", 44.7, 53, "call", 2), ("line", 89.9, 52, "zero", 3), ("line", 95.9, 56, "put", 4)], num=None),
  dict(id="zoom", short="Pan & zoom", img="sec-zoom0.webp", img2="sec-zoom5.webp", w=740, h=1200, cap=CAP_NQ,
       alt="Two real captures of the same MNQ 5-minute chart card with its 1m/5m/15m/1h, +, − and Reset buttons: zoomed in (71 of 1029 bars in view) and zoomed out (168 of 1029 bars), crossfading.",
       ov=[("chip", 3.4, 11.9, 9.4, 4.9, 1), ("chip", 14.4, 11.9, 9.4, 4.9, 2), ("chip", 25.5, 11.9, 15.2, 4.9, 3), ("chip", 4.6, 94.3, 68, 4, 4)], num=None),
]
for f, (t, p, how) in zip(F, tiles):
    f["title"], f["text"], f["how"] = t, p, how


def overlays(f):
    out = []
    for o in f["ov"]:
        k = o[0]
        if k == "line":
            d = o[4] if len(o) > 4 else 1
            out.append(f'<i class="sx-line {o[3]}" style="--y:{o[1]}%;--w:{o[2]}%;--n:{d}"></i>')
        elif k in ("box", "chip"):
            d = o[5] if len(o) > 5 else (len([x for x in out if "sx-box" in x]) + 1)
            out.append(f'<i class="sx-box{" chip" if k == "chip" else ""}" style="--x:{o[1]}%;--y:{o[2]}%;--bw:{o[3]}%;--bh:{o[4]}%;--n:{d}"></i>')
        elif k == "wash":
            out.append(f'<i class="sx-wash pos" style="--y:{o[1]}%"></i><i class="sx-wash neg" style="--y:{o[1]}%"></i>')
        elif k == "slide":
            n = len([x for x in out if "sx-slide" in x]) + 1
            out.append(f'<i class="sx-slide" style="--y:{o[1]}%;--n:{n}"></i>')
        elif k == "scan":
            out.append('<i class="sx-scan"></i>')
    return "".join(out)


def media(f, lazy=True, cls="sx-media"):
    ld = ' loading="lazy"' if lazy else ""
    two = ""
    if f.get("img2"):
        two = f'<img class="sx-b" src="{IMG}{f["img2"]}" width="{f["w"]}" height="{f["h"]}"{ld} decoding="async" alt="">'
    return (f'<div class="{cls}{" sx-xf" if two else ""}" style="aspect-ratio:{f["w"]}/{f["h"]};--ar:{f["w"]/f["h"]:.4f}">'
            f'<img src="{IMG}{f["img"]}" width="{f["w"]}" height="{f["h"]}"{ld} decoding="async" alt="{html.escape(f["alt"])}">'
            f'{two}{overlays(f)}</div>')


def how(f):
    return f'<details class="sx-how"><summary>How it’s calculated</summary><p>{f["how"]}</p></details>'


def numchip(f):
    if not f["num"]:
        return ""
    lab, val = f["num"][0], f["num"][1]
    suf = f["num"][2] if len(f["num"]) > 2 else ""
    return f'<p class="sx-num"><span>{lab}</span><b data-to="{val}">{val}</b>{suf}<small>as printed on the capture</small></p>'


HEAD_TXT = '<div class="ft-section-head ft-reveal"><h2>What’s on the GEX page</h2><p>Every item below is on the dashboard today. Each card says how the number is built.</p></div>'


def s1():
    tabs = "".join(f'<button type="button" role="tab" class="sx-tab" id="sx-t-{f["id"]}" aria-controls="sx-p-{f["id"]}" aria-selected="{"true" if i == 0 else "false"}" tabindex="{0 if i == 0 else -1}"><em>{i+1:02d}</em>{f["short"]}</button>' for i, f in enumerate(F))
    slides = "".join(
        f'<article class="sx-slide-card{" on" if i == 0 else ""}" role="tabpanel" id="sx-p-{f["id"]}" aria-labelledby="sx-t-{f["id"]}" aria-roledescription="slide" aria-label="{i+1} of 12">'
        f'<div class="sx-frame">{media(f, lazy=i > 0)}</div>'
        f'<p class="sx-cap">{f["cap"]}</p>'
        f'<h3><em>{i+1:02d}</em>{f["title"]}</h3><p class="sx-text">{f["text"]}</p>{how(f)}</article>'
        for i, f in enumerate(F))
    return (f'<section class="ft-section sx sx1" id="whats-on-the-page">{HEAD_TXT}'
            f'<div class="sx-rail" data-sx-rail>'
            f'<div class="sx-tabs" role="tablist" aria-label="GEX page features">{tabs}</div>'
            f'<div class="sx-bar" aria-hidden="true"><i></i></div>'
            f'<div class="sx-view"><div class="sx-track">{slides}</div>'
            f'<button type="button" class="sx-arrow prev" aria-label="Previous feature">‹</button>'
            f'<button type="button" class="sx-arrow next" aria-label="Next feature">›</button></div>'
            f'<p class="sx-hint">Swipe or tap a tab. Auto-plays until you touch it.</p>'
            f'</div></section>')


def s2():
    idx = "".join(f'<a href="#sx-f-{f["id"]}" data-sx-ix="{f["id"]}"><em>{i+1:02d}</em>{f["short"]}</a>' for i, f in enumerate(F))
    rows = "".join(
        f'<article class="sx-row{" flip" if i % 2 else ""}" id="sx-f-{f["id"]}" data-sx-row>'
        f'<div class="sx-frame">{media(f)}<p class="sx-cap">{f["cap"]}</p></div>'
        f'<div class="sx-copy"><span class="sx-n">{i+1:02d} / 12</span><h3>{f["title"]}</h3>{numchip(f)}<p class="sx-text">{f["text"]}</p>{how(f)}</div>'
        f'</article>'
        for i, f in enumerate(F))
    return (f'<section class="ft-section sx sx2" id="whats-on-the-page">{HEAD_TXT}'
            f'<nav class="sx-index" aria-label="Jump to a feature"><div>{idx}</div></nav>'
            f'<div class="sx-rows">{rows}</div></section>')


def page(name, label, section, bodycls):
    h = SRC[:head_end]
    h = h.replace("(preview A)", f"(section preview {label})")
    h = h.replace('<link rel="stylesheet" href="/assets/features-gex-v.css?v=365">',
                  '<link rel="stylesheet" href="/assets/features-gex-v.css?v=365">\n<link rel="stylesheet" href="/assets/features-gex-s.css?v=365">')
    h = h.replace('<body class="gv gv-a">', f'<body class="gv gv-a sx-page {bodycls}">')
    f = foot.replace('<script src="/assets/features-gex-v.js?v=365"></script>',
                     '<script src="/assets/features-gex-v.js?v=365"></script>\n<script src="/assets/features-gex-s.js?v=365"></script>')
    out = h + '<main id="main" tabindex="-1">\n' + hero + '\n<div class="container">\n' + section + '\n</div>\n\n</main>\n' + f
    (ROOT / "features" / f"{name}.html").write_text(out)
    print("wrote", name, len(out))


page("gex-s1", "S1", s1(), "sx-p1")
page("gex-s2", "S2", s2(), "sx-p2")
