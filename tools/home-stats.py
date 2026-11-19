#!/usr/bin/env python3
"""Homepage number strip (index.html .hv-stats), its Traders for Traders line and the /traders-for-traders page: keep every number true.

    python3 tools/home-stats.py          rewrite the numbers in index.html from their sources
    python3 tools/home-stats.py --check  exit 1 if a number on the page is no longer true (tools/check.py runs this)

Each number is an element carrying data-stat="<key>" whose text is the figure; a figure ending in "+" is a floor.
--check fails when a floor is above the real count or an exact figure differs; a floor that is merely low is fine
(still true), so a new indicator never blocks a release. Run without --check to refresh.

Sources
  indicators  tools/indicator-pages/registry.json rows with hidden=false: every built-in row of the chart's Indicators
              window (dumped from the chart by tools/indicator-pages/dump-registry.js). Shown as a floor to 10, the
              same "150+" the Indicators window search field shows.
  chapters    assets/chapters-index.js CHAPTERS_SEED entries (42 core + Volume Profile + Prop Firm tracks). Exact.
  tools       product tiles in the index.html "Twelve tools" grid (.hv-tile). Exact.
  updates     assets/roadmap-log.json entries (the public roadmap's Shipped list). Floor to 10.
  guides      indicator guide pages: indicators/*.html. Exact.
  lessons     Zscript course lessons: zscript/course/zNN.html. Exact.
  symbols     NOT computed here: the universe lives on exchange and server lists fetched at run time. Hard-coded
              floor, re-checked by hand on 19 Nov 2026 (build 1149):
                - chart symbol search pool on /charts (ws.feed.symbols(), deduped as assets/chart-search.js does,
                  probe tools/tests/home-stats-probe.js): 8,617 = 20 futures, 18 forex, 4 index, 34 stock/ETF hot
                  list, 8,541 crypto pairs on Binance, Coinbase, Hyperliquid, OKX, Bitget and Kraken;
                - plus US stocks and ETFs from the stock engine search: the screener tables alone list 4,018 stocks
                  and 1,664 ETFs (book-recorder /scan?part=stock|etf).
              Together well over 10,000 distinct chartable symbols -> "10,000+". Re-count before raising it.
"""
import json
import math
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PAGES = ['index.html', 'traders-for-traders.html']   # every page carrying data-stat numbers
SYMBOLS_FLOOR = 10000   # see the docstring: counted by hand, not from a file in the repo


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as fh:
        return fh.read()


def actual():
    rows = json.loads(rd('tools/indicator-pages/registry.json'))['rows']
    html = rd('index.html')
    return {
        'indicators': sum(1 for r in rows if not r.get('hidden')),
        'chapters': len(re.findall(r'^\s*"num":', rd('assets/chapters-index.js'), re.M)),
        'tools': len(re.findall(r'class="hv-tile[ "]', html)),
        'updates': len(json.loads(rd('assets/roadmap-log.json'))),
        'symbols': SYMBOLS_FLOOR,
        'guides': len([f for f in os.listdir(os.path.join(ROOT, 'indicators')) if f.endswith('.html')]),
        'lessons': len([f for f in os.listdir(os.path.join(ROOT, 'zscript', 'course')) if re.match(r'z\d+\.html$', f)]),
    }


FLOOR = {'indicators': 10, 'updates': 10, 'symbols': None}   # key -> round down to this step and show "+"


def shown(key, n):
    if key not in FLOOR:
        return str(n)
    step = FLOOR[key]
    v = n if step is None else math.floor(n / step) * step
    return '{:,}+'.format(v)


STAT_RE = re.compile(r'(<(\w+)\b[^>]*\bdata-stat="(\w+)"[^>]*>)([^<]*)(</\2>)')


def parse(text):
    """'10,000+' -> (10000, True)"""
    t = text.strip()
    return int(t.rstrip('+').replace(',', '')), t.endswith('+')


def main():
    real = actual()
    bad = []
    for name in PAGES:
        path = os.path.join(ROOT, name)
        html = rd(name)
        if '--check' in sys.argv:
            found = STAT_RE.findall(html)
            if not found:
                bad.append(f'{name}: no data-stat numbers found')
            for _, _, key, text, _ in found:
                if key not in real:
                    bad.append(f'{name} data-stat="{key}": unknown key')
                    continue
                try:
                    v, floor = parse(text)
                except ValueError:
                    bad.append(f'{name} data-stat="{key}": "{text}" is not a number')
                    continue
                if (floor and v > real[key]) or (not floor and v != real[key]):
                    bad.append(f'{name} data-stat="{key}" says {text} but the source has {real[key]}: run python3 tools/home-stats.py')
            continue
        out = STAT_RE.sub(lambda m: m.group(1) + shown(m.group(3), real[m.group(3)]) + m.group(5) if m.group(3) in real else m.group(0), html)
        if out != html:
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(out)
    if '--check' in sys.argv:
        for b in bad:
            print(b)
        sys.exit(1 if bad else 0)
    print(' '.join(f'{k}={shown(k, v)} ({v})' for k, v in real.items()))

if __name__ == '__main__':
    main()
