#!/usr/bin/env python3
"""Crop the 2x captures from shoot-zc.js / shoot-apps.js into the FEATB feature-page webps (1x + @2x).
Run: python3 tools/feature-pages/crop-b.py <raw-zc-dir> <raw-apps-dir>
Boxes are in 2x capture pixels (x0, y0, x1, y1); None = whole image. 1x = half the 2x size.
Pages: charts, indicators, backtesting, journal, models. Money and percent figures were blurred at capture time.
Also on the charts page (copied, not re-shot): orderflow/footprint and gex/on-zorocharts from the FEATA set."""
import sys, pathlib, shutil
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLOT = (88, 176, 2792, 1724)   # ZoroCharts at 1440x900: the chart pane + price scale, no app bars
APP = (152, 136, 2880, 1800)   # member app at 1440x900: content without the left rail and the top bar
JOBS = {
  'charts': [
    ('zc', 'zc-desk', 'hero', None),
    ('zc', 'zc-symbols', 'symbols', None),
    ('zc', 'zc-indicators', 'indicators', None),
    ('zc', 'zc-grid', 'grid', None),
    ('zc', 'zc-replay', 'replay', None),
    ('zc', 'zc-ticket', 'paper', None),
    ('zc', 'zc-desk-light', 'light', None),
    ('zc', 'zc-phone', 'phone', None),
    ('zc', 'ind-liquidity-master', 'tz-indicator', PLOT),
  ],
  'indicators': [
    ('zc', 'ind-liquidity-master', 'hero', None),
    ('zc', 'ind-window', 'window', None),
    ('zc', 'ind-liquidity-master', 'liquidity-master', PLOT),
    ('zc', 'ind-smt', 'smt', PLOT),
    ('zc', 'ind-ifvg', 'ifvg', PLOT),
    ('apps', 'ix-guide', 'guide', None),
    ('zc', 'ind-fvg-relay', 'fvg-relay', PLOT),
    ('zc', 'ind-po3', 'po3', PLOT),
    ('zc', 'ind-fractal', 'fractal', PLOT),
    ('zc', 'ind-sweep', 'sweep', PLOT),
    ('apps', 'ix-catalog', 'catalog', None),
  ],
  'backtesting': [
    ('apps', 'kr-replay', 'hero', None),
    ('apps', 'kr-replay', 'replay', APP),
    ('apps', 'kr-replay-trade', 'review', APP),
    ('apps', 'kr-trades', 'trades', APP),
    ('apps', 'kr-dashboard', 'dashboard', APP),
    ('apps', 'kr-analytics', 'analytics', APP),
    ('apps', 'kr-sessions', 'sessions', APP),
    ('zc', 'zc-replay', 'zc-replay', PLOT),
  ],
  'journal': [
    ('apps', 'nm-dashboard', 'hero', None),
    ('apps', 'nm-add', 'add', APP),
    ('apps', 'nm-history', 'import', APP),
    ('apps', 'nm-dashboard', 'dashboard', APP),
    ('apps', 'nm-calendar', 'calendar', APP),
    ('apps', 'nm-ai', 'coach', APP),
    ('apps', 'nm-analytics', 'analytics', APP),
    ('apps', 'nm-propfirms', 'propfirms', APP),
    ('apps', 'nm-playbook', 'playbook', APP),
    ('apps', 'nm-charts', 'charts', None),
  ],
  'models': [
    ('apps', 'md-orb-model-a', 'hero', None),
    ('apps', 'md-process', 'process', None),
    ('apps', 'md-library', 'library', APP),
    ('apps', 'md-ifvg-model-c', 'model', APP),
    ('apps', 'md-orb-model-a-example', 'example', None),
    ('apps', 'md-orb-model-a-steps', 'checklist', None),
    ('apps', 'md-card', 'card', None),
    ('apps', 'md-silver-bullet-model', 'silver-bullet', APP),
    ('apps', 'md-ifvg-model-c-example', 'ifvg-example', None),
  ],
}
COPY = {'charts': [('orderflow', 'footprint', 'footprint'), ('gex', 'on-zorocharts', 'gex')]}

def main(zc_dir, apps_dir):
    src = {'zc': pathlib.Path(zc_dir), 'apps': pathlib.Path(apps_dir)}
    for page, jobs in JOBS.items():
        out = ROOT / 'assets/images/features' / page
        out.mkdir(parents=True, exist_ok=True)
        for s, f, name, box in jobs:
            im = Image.open(src[s] / (f + '.png')).convert('RGB')
            if box: im = im.crop(box)
            w, h = im.size
            w -= w % 2; h -= h % 2; im = im.crop((0, 0, w, h))
            im.save(out / (name + '@2x.webp'), quality=78, method=6)
            im.resize((w // 2, h // 2), Image.LANCZOS).save(out / (name + '.webp'), quality=82, method=6)
            print(page, name, w // 2, h // 2)
        for sp, sn, name in COPY.get(page, []):
            for suf in ('.webp', '@2x.webp'):
                shutil.copyfile(ROOT / f'assets/images/features/{sp}/{sn}{suf}', out / (name + suf))
            print(page, name, 'copied from', sp)

if __name__ == '__main__':
    main(*sys.argv[1:3])
