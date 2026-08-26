#!/usr/bin/env python3
"""
Regenerate every brand image from one master logo.

Two distinct shapes are needed and they are NOT the same crop:

  Wordmark  — dragon + "STA", used in the header and hero. Trimmed to its
              content bounds first, because the source has ~100px of empty
              padding and leaving it in makes the logo render smaller than its
              box suggests, which is why headers end up looking inconsistent.

  Emblem    — the dragon alone, square, used for favicons and app icons. The
              full wordmark shrunk to 32x32 is an unreadable smudge; a favicon
              has to be a mark, not a lockup.

Every output keeps alpha. A white-backed logo on a near-black header is the
single most obvious branding mistake, and it only shows up once deployed.
"""

import os
from PIL import Image

SRC = "/mnt/user-data/uploads/14649.png"
OUT = "/home/claude/deploy/assets/images"

# Padding as a fraction of the square canvas, per target. Favicons need tighter
# crops than app icons: at 16px, generous padding leaves almost no ink.
TARGETS_WORDMARK = [
    ("logo-header.png", 299, 160),
    ("logo-full.png",   900, 608),
]
TARGETS_EMBLEM = [
    ("logo-emblem.png",      1124, 0.06),
    ("logo-emblem-sm.png",    200, 0.06),
    ("icon-512.png",          512, 0.10),
    ("icon-192.png",          192, 0.10),
    ("apple-touch-icon.png",  180, 0.10),
    ("favicon-48.png",         48, 0.04),
    ("favicon-32.png",         32, 0.02),
    ("favicon-16.png",         16, 0.00),
]


def load_master():
    im = Image.open(SRC).convert("RGBA")
    # Trim the transparent margin so downstream sizing is based on actual ink.
    bbox = im.getbbox()
    return im.crop(bbox)


def fit_into(im, w, h, pad=0.0):
    """Contain-fit onto a transparent canvas, centred. Contain rather than
    cover: cropping a logo to fill a box is how you lose the tail of a dragon."""
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    avail_w = int(w * (1 - pad * 2))
    avail_h = int(h * (1 - pad * 2))
    ratio = min(avail_w / im.width, avail_h / im.height)
    new = im.resize((max(1, int(im.width * ratio)),
                     max(1, int(im.height * ratio))), Image.LANCZOS)
    canvas.paste(new, ((w - new.width) // 2, (h - new.height) // 2), new)
    return canvas


def emblem_from(master):
    """The dragon alone.

    A fixed percentage does not work here: the dragon's open jaw physically
    overlaps the T's stem, so every guessed column either clipped the snout or
    dragged a slice of letterform along with it.

    The two elements are distinguishable by BRIGHTNESS instead. The dragon is
    light line-art — its brightest pixels sit around 140 — while T and A are
    solid mid-tone gradient, peaking near 25. Scanning for the last column
    containing genuine light strokes finds the real boundary (~45%) rather than
    a guess, and keeps working if the logo is ever redrawn at another ratio.

    The stray gradient pixels left inside that crop, where the jaw crosses the
    T, are then cleared so no fragment of letterform survives into a favicon.
    """
    w, h = master.size

    def has_light_strokes(x):
        px = master.load()
        vals = [px[x, y] for y in range(0, h, 3) if px[x, y][3] > 120]
        return bool(vals) and max(min(v[:3]) for v in vals) > 100

    edge = max((x for x in range(w) if has_light_strokes(x)), default=int(w * 0.45))
    d = master.crop((0, 0, edge + 1, h)).copy()

    # Clear the T's stem where it shows through beside the jaw.
    #
    # Colour alone does not separate them: the letterform is teal, which is
    # bright in green and blue, so a max-channel threshold kept it. What DOES
    # separate them is coverage. The T's stem is a solid vertical bar — near
    # full-height, near-opaque. The dragon at the same x is sparse line-art
    # with gaps between strokes.
    px = d.load()
    h_px = d.height
    for x in range(int(d.width * 0.72), d.width):
        col = [px[x, y] for y in range(h_px)]
        opaque = sum(1 for p in col if p[3] > 190)
        light = sum(1 for p in col if p[3] > 120 and min(p[:3]) > 120)
        # >55% solid and essentially no light strokes: that is letterform.
        if opaque > h_px * 0.55 and light < h_px * 0.02:
            for y in range(h_px):
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, 0)

    # The stem is gone, but the T's CROSSBAR still shows behind the jaw, and a
    # column test cannot catch it — those columns also contain the dragon.
    # It is separable by colour after all, on the right criterion: the
    # letterform gradient is fully saturated (one channel at or near zero),
    # whereas every part of the dragon, including its shading, retains some
    # light in all three channels.
    for x in range(int(d.width * 0.60), d.width):
        for y in range(h_px):
            r, g, b, a = px[x, y]
            if a > 140 and min(r, g, b) < 40 and max(r, g, b) > 80:
                px[x, y] = (r, g, b, 0)

    b = d.getbbox()
    return d.crop(b) if b else d


def main():
    master = load_master()
    print("master trimmed to", master.size)

    for name, w, h in TARGETS_WORDMARK:
        p = os.path.join(OUT, name)
        fit_into(master, w, h, pad=0.02).save(p)
        print("  wordmark", name, (w, h))

    emblem = emblem_from(master)
    print("emblem crop", emblem.size)
    for name, size, pad in TARGETS_EMBLEM:
        p = os.path.join(OUT, name)
        fit_into(emblem, size, size, pad=pad).save(p)
        print("  emblem  ", name, size)

    # .ico with the sizes Windows and older browsers actually request.
    ico = fit_into(emblem, 256, 256, pad=0.04)
    ico.save(os.path.join(OUT, "favicon.ico"),
             sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print("  favicon.ico (multi-size)")


if __name__ == "__main__":
    main()
