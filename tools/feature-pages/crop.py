#!/usr/bin/env python3
"""Crop the 2x captures from shoot-gex.js / shoot-of.js into the feature-page webps (1x + @2x).
Run: python3 tools/feature-pages/crop.py <raw-gex-dir> <raw-of-dir>   (or --featb <raw-dir> for the FEATB pages)
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

# FEATB pages (shoot-featb.js): boxes in CSS px of the 1440-wide capture (x0, y0, x1, y1), cut from the 2x PNG
PL = (44, 88, 1396, 862)               # ZoroCharts chart pane + price scale at 1440x900
APP = (76, 68, 1440, 900)              # app page without the top bar and side rail
FEATB = {
  "charts": [("c-main", "hero", None), ("c-picker", "picker", (110, 60, 1330, 840)), ("c-main", "drawings", PL),
             ("c-pine", "pine", (520, 88, 1440, 900)), ("c-replay", "replay", (44, 88, 1000, 700)), ("c-quad", "grid", (0, 88, 1440, 900)),
             ("i-lm", "levels", PL)],
  "indicators": [("i-lm", "hero", None), ("c-picker", "picker", (110, 60, 1330, 840)), ("i-ifvg", "ifvg", PL), ("i-lm", "liquidity", PL),
                 ("i-po3", "po3", PL), ("i-fractal", "fractal", PL), ("c-pine", "pine", (520, 88, 1440, 900))],
  "backtesting": [("k-replay", "hero", None), ("k-sessions", "sessions", (90, 60, 1440, 470)), ("k-replay", "replay", (102, 172, 1414, 886)),
                  ("k-review", "review", (330, 186, 1110, 714)), ("k-dash", "dash", APP), ("F-k-ana", "coach", (92, 2908, 1424, 3593)),
                  ("F-k-sim", "sim", (92, 262, 1424, 791)), ("F-k-ana", "breakdowns", (92, 2106, 1424, 2871)), ("k-trades", "trades", APP),
                  ("F-k-ana", "sessions-perf", (92, 1790, 1424, 2068)), ("F-k-ana", "winners", (92, 1152, 1424, 1476))],
  "journal": [("j-dash", "hero", None), ("j-add", "add", APP), ("j-dash2", "dash", APP), ("j-calendar", "calendar", APP),
              ("j-analytics", "analytics", APP), ("j-ai", "coach", APP), ("F-j-ai", "coach-cards", (92, 468, 1424, 824)),
              ("F-j-dash", "score", (648, 376, 1424, 664)), ("F-j-playbook", "playbook", (92, 337, 1093, 553)),
              ("F-j-dash", "daily", (756, 1091, 1424, 1445)), ("F-j-history", "import", (92, 161, 1424, 379))],
  "models": [("m-one", "hero", None), ("F-m-list", "library", (20, 880, 1420, 1570)), ("m-one-900", "diagram", (280, 230, 1220, 700)),
             ("F-m-one", "rules", (305, 2026, 1191, 2204)), ("m-one-2350", "example", (300, 60, 1220, 640)),
             ("m-list", "process", (20, 220, 1420, 800)), ("F-m-list", "card", (24, 1568, 722, 2201)), ("m-one", "page", (280, 60, 1220, 900)),
             ("F-j-playbook", "playbook", (92, 337, 1093, 553))],
}

def featb(raw):
    for page, jobs in FEATB.items():
        out = ROOT / "assets/images/features" / page
        out.mkdir(parents=True, exist_ok=True)
        for s, name, box in jobs:
            im = Image.open(pathlib.Path(raw) / (s + ".png")).convert("RGB")
            if box: im = im.crop(tuple(v * 2 for v in box))
            w, h = im.size; w -= w % 2; h -= h % 2; im = im.crop((0, 0, w, h))
            im.save(out / (name + "@2x.webp"), quality=80, method=6)
            im.resize((w // 2, h // 2), Image.LANCZOS).save(out / (name + ".webp"), quality=84, method=6)
            print(page, name, w // 2, h // 2)

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
    if sys.argv[1] == "--featb": featb(sys.argv[2])   # python3 tools/feature-pages/crop.py --featb <raw-featb-dir>
    else: main(*sys.argv[1:3])
