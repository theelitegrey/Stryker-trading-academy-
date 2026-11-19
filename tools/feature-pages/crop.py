#!/usr/bin/env python3
"""Crop the 2x captures from shoot-gex.js / shoot-of.js into the feature-page webps (1x + @2x).
Run: python3 tools/feature-pages/crop.py <raw-gex-dir> <raw-of-dir>
Boxes are in 2x capture pixels: (x0, y0, x1, y1); None = whole image. 1x = half the 2x size.
Also used on the pages (copied 1x/2x from older real captures, not re-shot): orderflow/{bigtrades,imbalance,delta-profile,
sweeps,tpo,cvd,volume-profile} from assets/images/orderflow/ and gex/on-zorocharts from assets/images/orderflow/gex-levels (top 72 px of the 2x cut: symbol bar with an exchange name and a feed-delay badge)."""
import sys, pathlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLOT = (88, 176, 2792, 1724)          # charts.html at 1440x900: the chart pane + price scale, no app bars
JOBS = {
  "gex": [  # (source, out name, box)
    ("page-top", "hero", None),
    ("chart-spx", "chart-levels", None),
    ("chart-qqq", "chart-nq", None),
    ("levels-spx", "levels-panel", None),
    ("heatmap-spx", "heatmap", None),
    ("laddertab-spx", "ladder", None),
    ("options-spx", "options", None),
    ("flow-spx", "volume-by-strike", None),
    ("greeks-spx", "greeks", None),
  ],
  "orderflow": [
    ("footprint", "hero", None),
    ("footprint", "footprint", PLOT),
    ("dom-heatmap", "dom-heatmap", PLOT),
    ("dom-bubbles", "dom-bubbles", PLOT),
  ],
}

def main(gex_dir, of_dir):
    for page, jobs in JOBS.items():
        src = pathlib.Path(gex_dir if page == "gex" else of_dir)
        out = ROOT / "assets/images/features" / page
        out.mkdir(parents=True, exist_ok=True)
        for s, name, box in jobs:
            im = Image.open(src / (s + ".png")).convert("RGB")
            if box: im = im.crop(box)
            w, h = im.size
            w -= w % 2; h -= h % 2; im = im.crop((0, 0, w, h))
            im.save(out / (name + "@2x.webp"), quality=80, method=6)
            im.resize((w // 2, h // 2), Image.LANCZOS).save(out / (name + ".webp"), quality=84, method=6)
            print(page, name, w // 2, h // 2)

if __name__ == "__main__":
    main(*sys.argv[1:3])
