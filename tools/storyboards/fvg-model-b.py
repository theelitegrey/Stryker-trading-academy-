#!/usr/bin/env python3
"""Build the illustrative storyboard for fvg-model-b and insert it into
assets/models-data.js (idempotent: replaces an existing "storyboard" block).

The candles are HAND-DRAWN to teach the pattern. They are not market data,
the player never prints a price, and it labels every storyboard
"Illustrative example". Captions are DRAFT copy pending the content gate.
"""
import json, re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

C = [  # o, h, l, c  (arbitrary units)
    (100.0, 101.0, 99.4, 100.6),
    (100.6, 101.2, 100.0, 100.4),
    (100.4, 101.6, 100.2, 101.4),
    (101.4, 102.2, 101.1, 102.0),
    (102.0, 104.8, 101.9, 104.6),   # displacement
    (104.6, 105.4, 103.2, 105.2),   # 3.h 102.2 < 5.l 103.2 -> FVG 102.2-103.2
    (105.2, 106.0, 104.8, 105.7),
    (105.7, 106.6, 105.3, 106.3),
    (106.3, 107.4, 106.0, 107.1),
    (107.1, 107.8, 106.4, 106.7),   # swing high 107.8 = buy-side liquidity
    (106.7, 107.0, 105.6, 105.8),
    (105.8, 106.0, 104.9, 105.1),
    (105.1, 105.3, 104.2, 104.4),
    (104.4, 104.9, 104.0, 104.7),   # minor lower high 104.9
    (104.7, 104.8, 103.5, 103.7),
    (103.7, 103.9, 102.7, 103.5),   # touches the FVG and closes back above
    (103.5, 104.6, 103.4, 104.4),
    (104.4, 105.5, 104.3, 105.3),   # closes through 104.9 -> MSS
    (105.3, 105.4, 104.6, 104.8),   # retest
    (104.8, 105.9, 104.7, 105.7),
    (105.7, 106.8, 105.5, 106.6),
    (106.6, 107.5, 106.4, 107.3),
    (107.3, 108.2, 107.1, 108.0),   # runs the buy-side liquidity
    (108.0, 108.3, 107.5, 107.7),
]
for i, (o, h, l, c) in enumerate(C):
    assert h >= max(o, c) and l <= min(o, c), i
assert C[3][1] < C[5][2]

candles = [{"o": o, "h": h, "l": l, "c": c} for o, h, l, c in C]
last = len(C) - 1

frames = [
    {"title": "Displacement leaves a gap", "reveal": 6,
     "caption": "Price moves up so fast that the middle candle leaves space behind it: the high of the candle before it and the low of the candle after it never overlap.",
     "add": [{"type": "highlight", "id": "gap3", "from": 3, "to": 5}]},
    {"title": "Mark the 15m FVG", "reveal": 6, "remove": ["gap3"],
     "caption": "That untouched space is the fair value gap. Mark it from the first candle's high to the third candle's low and extend it to the right.",
     "add": [{"type": "fvg", "id": "fvg", "top": 103.2, "bottom": 102.2, "from": 3, "to": last, "label": "15m FVG", "labelSide": "left"}]},
    {"title": "Read the delivery context", "reveal": 10,
     "caption": "Delivery is one-sided and bullish, and the swing high it leaves behind holds buy-side liquidity. That old high is the draw on liquidity you will target later.",
     "add": [{"type": "level", "id": "bsl", "price": 107.8, "from": 9, "to": last, "label": "Buy-side liquidity", "tone": "liq"}]},
    {"title": "Wait for the touch", "reveal": 16,
     "caption": "Price pulls back and trades into the gap. Nothing is taken yet: the touch only tells you the level is being tested.",
     "focus": ["fvg", "touch"],
     "add": [{"type": "highlight", "id": "touch", "from": 15, "to": 15}]},
    {"title": "Continuation: a quick reaction", "reveal": 17, "remove": ["touch"],
     "caption": "In a continuation you want a quick reaction away from the gap, not a slow grind through it. If price closes through the whole gap, the idea is off.",
     "add": [{"type": "arrow", "id": "react", "from": {"at": 15, "price": 102.9}, "to": {"at": 17, "price": 104.8}}]},
    {"title": "Confirm with the MSS", "reveal": 18, "remove": ["react"],
     "caption": "Confirmation comes when price closes above the last lower high of the pullback, a market structure shift. Check SMT on the correlated index before you act on it.",
     "add": [{"type": "mss", "id": "mss", "price": 104.9, "from": 13, "to": 17, "label": "MSS"}]},
    {"title": "Entry, stop and target", "reveal": 18,
     "caption": "Enter on the retest of the broken level, stop below the low that touched the gap, and target the opposite draw on liquidity: the old high.",
     "add": [
         {"type": "entry", "id": "entry", "price": 104.9, "from": 17, "to": last, "label": "Entry"},
         {"type": "stop", "id": "stop", "price": 102.5, "from": 17, "to": last, "label": "Stop"},
         {"type": "target", "id": "target", "price": 107.8, "from": 17, "to": last, "label": "Target", "labelSide": "left"}]},
    {"title": "Delivery to the opposite liquidity", "reveal": len(C),
     "caption": "In this drawn example price runs the old high. Plenty of real setups fail at the MSS or before the target, which is why the stop is placed before the trade, not after.",
     "focus": ["bsl", "entry", "stop", "target", "fvg", "run"],
     "add": [{"type": "sweep", "id": "run", "at": 22, "side": "high", "label": "Liquidity taken"}]},
]

sb = {"version": 1, "title": "15m FVG continuation", "timeframe": "15m",
      "illustrative": True, "candles": candles, "frames": frames}

path = os.path.join(ROOT, 'assets', 'models-data.js')
src = open(path, encoding='utf-8').read()
start = src.index('"id": "fvg-model-b"')
obj_start = src.rfind('{', 0, start)
# remove an existing storyboard block within this object
blob = json.dumps(sb, indent=2, ensure_ascii=True)
# one candle per line keeps the seed file readable
blob = re.sub(r'\{\s*"o": ([^,]+),\s*"h": ([^,]+),\s*"l": ([^,]+),\s*"c": ([^\s]+)\s*\}',
              r'{"o": \1, "h": \2, "l": \3, "c": \4}', blob)
blob = '\n'.join(('    ' + l if i else l) for i, l in enumerate(blob.split('\n')))
m = re.compile(r'\n    "storyboard": \{.*?\n    \},?(?=\n)', re.S)
seg_end = src.index('\n  }', start)
seg = src[obj_start:seg_end]
seg = m.sub('', seg)
anchor = '"category": "FVG / Imbalance",'
assert anchor in seg
seg = seg.replace(anchor, anchor + '\n    "storyboard": ' + blob + ',', 1)
src = src[:obj_start] + seg + src[seg_end:]
open(path, 'w', encoding='utf-8').write(src)
print('storyboard written:', len(candles), 'candles,', len(frames), 'frames')
