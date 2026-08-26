#!/usr/bin/env python3
"""
Remove the black background from the STA logo and regenerate every site asset.

WHY NOT A PLAIN BLACK KEY
The background is pure black (max edge brightness: 1), so "delete all black"
looks tempting. It would also punch holes straight through the artwork: the
dragon is line-art whose scales are black between the strokes, and the letters
carry dark gradient shading. Keying by colour cannot tell background black from
artwork black.

LUMINANCE AS ALPHA
This is glow artwork on black, which means it is already effectively
premultiplied: every pixel is the glow colour scaled by its own intensity.
Reading brightness as alpha inverts that exactly — black becomes transparent,
bright cyan becomes opaque, and the soft falloff around each stroke survives as
real anti-aliasing rather than a hard cut.

Colour is then un-premultiplied (divided back out by alpha) so strokes stay
saturated instead of turning muddy where they are semi-transparent.

The result composites correctly on ANY background. A flood-filled version would
not: it would leave the dragon's interior solid black — invisible on the dark
header, a black blob on a light one.
"""

import os
from PIL import Image

SRC = "/mnt/user-data/uploads/14969.png"
IMAGES = "/home/claude/deploy/assets/images"
MASTER = os.path.join(IMAGES, "logo-master.png")

WORDMARK = [
    ("logo-header.png", 299, 160),
    ("logo-full.png",   900, 608),
]
EMBLEM = [
    ("logo-emblem.png",      1124, 0.06),
    ("logo-emblem-sm.png",    200, 0.06),
    ("icon-512.png",          512, 0.10),
    ("icon-192.png",          192, 0.10),
    ("apple-touch-icon.png",  180, 0.10),
    ("favicon-48.png",         48, 0.04),
    ("favicon-32.png",         32, 0.02),
    ("favicon-16.png",         16, 0.00),
]

# Below this a pixel is compression noise, not faint glow. Without a floor the
# ringing around the artwork becomes a visible grey haze on a light surface.
FLOOR = 6
# Mid-tones lift slightly so the letters read solid rather than washed out.
GAIN = 1.18


def key_out_black(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    src = im.load()
    out = Image.new("RGBA", (w, h))
    dst = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            m = max(r, g, b)
            if m <= FLOOR:
                dst[x, y] = (0, 0, 0, 0)
                continue
            a = min(255, int(m * GAIN))
            s = 255.0 / a
            dst[x, y] = (min(255, int(r * s)), min(255, int(g * s)),
                         min(255, int(b * s)), a)
    bb = out.getbbox()
    return out.crop(bb) if bb else out


def fit(im, w, h, pad=0.0):
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    aw, ah = int(w * (1 - pad * 2)), int(h * (1 - pad * 2))
    r = min(aw / im.width, ah / im.height)
    n = im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))),
                  Image.LANCZOS)
    canvas.paste(n, ((w - n.width) // 2, (h - n.height) // 2), n)
    return canvas


def emblem_from(master):
    """Dragon only, for favicons and app icons — a three-letter wordmark at
    16px is an unreadable smear.

    The boundary is a fixed 52%, chosen by eye rather than detected.
    Detection worked on the previous artwork, where the dragon was pale
    line-art against a saturated gradient. It does not work here: this version
    renders the dragon and the letters in the SAME cyan-blue, so no brightness
    or hue threshold separates them — measured across the width, both sit at
    roughly R0 G180 B230.

    Hard-coding it is the honest answer. A detector that happens to land in the
    right place on one image, for reasons that no longer hold, is worse than a
    constant with a comment explaining how it was picked. Re-check this if the
    logo is redrawn.
    """
    w, h = master.size
    d = master.crop((0, 0, int(w * 0.52), h))
    bb = d.getbbox()
    return d.crop(bb) if bb else d


def main():
    master = key_out_black(SRC)
    master.save(MASTER)
    print("master:", master.size)

    for name, w, h in WORDMARK:
        fit(master, w, h, pad=0.02).save(os.path.join(IMAGES, name))
        print("  wordmark", name, (w, h))

    em = emblem_from(master)
    print("emblem crop:", em.size)
    for name, size, pad in EMBLEM:
        fit(em, size, size, pad=pad).save(os.path.join(IMAGES, name))
        print("  emblem  ", name, size)

    fit(em, 256, 256, pad=0.04).save(os.path.join(IMAGES, "favicon.ico"),
                                     sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print("  favicon.ico (multi-size)")


if __name__ == "__main__":
    main()
