#!/usr/bin/env python3
"""compare.html truth rules: no $ price in the TradeZoro column or header, none of the banned words there, no banned names."""
import re, sys
h = open('compare.html', encoding='utf-8').read()
rows = re.findall(r'<tr>.*?</tr>', h, re.S)
head = re.search(r'<thead>.*?</thead>', h, re.S).group(0)
tz_head = re.search(r'<th scope="col" class="cp-tz"[^>]*>.*?</th>', head, re.S).group(0)
tz = [tz_head] + [re.findall(r'<td[^>]*cp-tz[^>]*>.*?</td>', r, re.S)[0] for r in rows if '<td' in r and 'cp-tz' in r]
more = re.search(r'<section class="cp-more".*?</section>', h, re.S).group(0)
txt = re.sub(r'<[^>]+>', ' ', ' '.join(tz) + more)
bad = [w for w in ('delayed', 'behind', 'live', 'real-time', 'real time', 'unlimited') if re.search(r'\b' + w, txt, re.I)]
errs = []
if '$' in txt: errs.append('$ in TradeZoro column')
if bad: errs.append(f'banned words in TradeZoro column: {bad}')
for w in ('LuxAlgo', 'Vela', '3-4 ms', '3–4 ms', 'win rate'):
    if w.lower() in h.lower(): errs.append(f'banned: {w}')
# every row under "On all four" must have a tick in all 4 cells
body = h[h.index('<tbody>'):h.index('</tbody>')]
for sec in re.split(r'<tr class="cp-sec">', body)[1:]:
    if 'On all four' in sec[:120]:
        for r in re.findall(r'<tr><th.*?</tr>', sec, re.S):
            if r.count('cp-ck') != 4: errs.append('On all four row without 4 ticks: ' + re.sub('<[^>]+>', ' ', r)[:60])
if len(tz) < 10: errs.append('too few TradeZoro cells')
if not re.search(r'href="/?sitemap', '') and 'tradezoro.com/compare' not in open('sitemap.xml').read(): errs.append('not in sitemap')
print('\n'.join('FAIL ' + e for e in errs) or f'compare ok ({len(tz)} TradeZoro cells)'); sys.exit(1 if errs else 0)
