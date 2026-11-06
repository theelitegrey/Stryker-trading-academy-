#!/usr/bin/env python3
"""Zoro Morning Note (09:40 ET) and Zoro Close Note (16:20 ET), weekdays. Spec: zoro-options-spec.md section 5.

Reads ONLY the numbers the ZoroOptions feeder already computed, through the recorder Worker (/zo/summary, /zo/activity,
and yesterday's /zo/note for the "since yesterday" lines). Every sentence is built from those numbers by the fixed
templates below: no language model, no per-member cost, no invented numbers, no vendor call (0 InsightSentry calls).
Before publishing, the whole note body is checked for banned words (live, real-time, delayed, bullish, bearish, bought,
sold, buy, sell, will, advice ...). A failing note is NOT published; the page then shows "Note not available today".

Publishing: POST {recorder}/zo-ingest?route=note&day=YYYY-MM-DD&kind=morning|close (header x-ingest-key, gzip JSON). Worker route
GET /zo/note?day=&kind= is S2's; the JSON shape is documented in contract-requests.md.

Env: BOOK_RECORDER_URL, BOOK_INGEST_SECRET (/root/projects/book-feeder/feeder.env). Never printed.
CLI: zoro_note.py [--kind morning|close] [--day YYYY-MM-DD] [--dry] [--force]   (--dry prints the note, posts nothing;
--fixture DIR reads summary-<SYM>.json / activity.json / note-prev.json from a folder instead of the Worker)
Stdlib only. Education only. Not financial advice.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York')
FOOTER = 'Education only. Not financial advice.'
INDEXES = ['SPX', 'QQQ', 'IWM', 'GLD', 'USO']
MAPPED = [('ES', 'SPX'), ('NQ', 'QQQ'), ('RTY', 'IWM'), ('GC', 'GLD'), ('CL', 'USO')]
RANGE_NAME = [('0', '0DTE'), ('w', 'weekly'), ('m', 'monthly')]
ZONE = {'cushion': 'Cushion', 'swing': 'Swing'}
TOP_STOCKS = 5
MAX_AGE_S = 3 * 3600        # a summary built more than 3 h ago is skipped ("not updated recently" is not told, the line is just left out)

# Copy rules. 'advice' is checked on the body; the FOOTER ("Not financial advice.") is added after the check.
_BANNED = ['live', r'real[- ]?time', 'delayed', 'behind', 'bullish', 'bearish', 'bought', 'sold', 'buy', 'sell', 'will',
           r'expects?(?: a)? move', r'guarantee[ds]?', 'advice', 'whales?', 'smart money', 'call resistance', 'put support',
           'hvl', 'q-score', 'market tide', 'net tide', 'periscope', 'hiro', 'trace', 'flowpatrol', 'gamma wall']
_BANNED_RE = re.compile(r'(?<![A-Za-z])(?:' + '|'.join(_BANNED) + r')(?![A-Za-z])', re.I)


def banned_words(text):
    return sorted({m.group(0).lower() for m in _BANNED_RE.finditer(text or '')})


# ------------------------------------------------------------------------------------------ formatting
def num(x, dec=None):
    """6,900 / 6,812.5 / 412.35. Whole numbers show no decimals; others 1-2."""
    x = float(x)
    if dec is None:
        dec = 0 if abs(x - round(x)) < 0.005 else (1 if abs(x) >= 1000 else 2)
    return ('{:,.%df}' % dec).format(x)


def ok_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x and abs(x) != float('inf')


def lv(s, k):
    v = (s.get('levels') or {}).get(k)
    return float(v) if ok_num(v) else None


def rng(s, k):
    r = (s.get('ranges') or {}).get(k)
    return (float(r[0]), float(r[1])) if isinstance(r, (list, tuple)) and len(r) == 2 and ok_num(r[0]) and ok_num(r[1]) else None


def figures(s):
    """The numbers kept with the note, so tomorrow's note can say what changed."""
    return {'call_ceiling': lv(s, 'call_ceiling'), 'put_floor': lv(s, 'put_floor'), 'flip_line': lv(s, 'flip_line'),
            'zone': s.get('zone') if s.get('zone') in ZONE else None,
            'iv_rank': (s.get('iv') or {}).get('rank') if ok_num((s.get('iv') or {}).get('rank')) else None,
            'pc': (s.get('pc') or {}).get('volume') if ok_num((s.get('pc') or {}).get('volume')) else None}


# ------------------------------------------------------------------------------------------ one symbol (templates)
def index_lines(sym, s, prev):
    """6-10 lines for one index ETF/index. prev = yesterday's figures for the symbol (or None)."""
    f = figures(s)
    out = []
    cc, pf, fl = f['call_ceiling'], f['put_floor'], f['flip_line']
    parts = []
    if cc is not None:
        parts.append('Call Ceiling %s' % num(cc))
    if pf is not None:
        parts.append('Put Floor %s' % num(pf))
    if fl is not None:
        parts.append('Flip Line %s' % num(fl))
    if parts:
        out.append('%s: %s.' % (sym, ', '.join(parts)))
    if f['zone']:
        out.append('Gamma Zone: %s (%s).' % (ZONE[f['zone']], 'net gamma is positive' if f['zone'] == 'cushion' else 'net gamma is negative'))
    pin = lv(s, 'pin')
    if pin is not None:
        out.append('Pin Strike %s.' % num(pin))
    for k, name in RANGE_NAME:
        r = rng(s, k)
        if r:
            out.append('%s Zoro Range %s to %s.' % (name[0].upper() + name[1:], num(r[0]), num(r[1])))
    iv = s.get('iv') or {}
    if f['iv_rank'] is not None:
        t = 'IV rank %s' % num(f['iv_rank'], 0)
        if ok_num(iv.get('iv30')):
            t += ' (30-day IV %s%%)' % num(iv['iv30'], 1)
        out.append(t + '.')
    if f['pc'] is not None:
        t = 'Put/call by volume %s' % num(f['pc'], 2)
        if prev and ok_num(prev.get('pc')) and round(prev['pc'], 2) != round(f['pc'], 2):
            t += ', %s from %s yesterday' % ('up' if f['pc'] > prev['pc'] else 'down', num(prev['pc'], 2))
        out.append(t + '.')
    if prev:
        ch = []
        for k, name in (('call_ceiling', 'Call Ceiling'), ('put_floor', 'Put Floor'), ('flip_line', 'Flip Line')):
            if f[k] is not None and ok_num(prev.get(k)) and f[k] != prev[k]:
                ch.append('%s moved from %s to %s' % (name, num(prev[k]), num(f[k])))
        if f['zone'] and prev.get('zone') in ZONE and f['zone'] != prev['zone']:
            ch.append('the Gamma Zone changed from %s to %s' % (ZONE[prev['zone']], ZONE[f['zone']]))
        if ch:
            out.append('Since yesterday: %s.' % '; '.join(ch))
    fresh = [c for c in map(crow, s.get('fresh_top') or []) if ok_num(c.get('volume')) and ok_num(c.get('oi')) and c['volume'] > c['oi']]
    if fresh:
        c = max(fresh, key=lambda c: c['volume'])
        out.append('Fresh Volume: %s %s %s, %s contracts against %s open interest.' % (num(c['strike']), c.get('side', ''), c.get('exp', ''), num(c['volume']), num(c['oi'])))
    return out[:10]



def crow(c):
    """One activity row in the S5 form {strike, side 'call'|'put', exp, volume, oi, added} from the feeder form
    {k, side 'C'|'P', x, vol, oi, add} (tools/fixtures/zoro); rows already in the S5 form pass through. Nulls -> 0."""
    side = c.get('side')
    o = dict(c, side={'C': 'call', 'P': 'put'}.get(side, side))
    for a, b in (('strike', 'k'), ('exp', 'x'), ('volume', 'vol'), ('added', 'add')):
        if o.get(a) is None and c.get(b) is not None:
            o[a] = c[b]
    for a in ('volume', 'oi', 'added'):
        if o.get(a) is None:
            o[a] = 0
    return o


def mapped_lines(root, src, s):
    """3 lines for a future: the underlying's levels moved onto the futures scale with the snapshot's own ratio."""
    ratio = (s.get('fut') or {}).get('ratio')
    if not ok_num(ratio) or ratio <= 0:
        return []
    out = []
    parts = []
    for k, name in (('call_ceiling', 'Call Ceiling'), ('put_floor', 'Put Floor'), ('flip_line', 'Flip Line')):
        v = lv(s, k)
        if v is not None:
            parts.append('%s %s' % (name, num(v * ratio, 0)))
    if parts:
        out.append('%s (mapped from %s): %s.' % (root, src, ', '.join(parts)))
    r = rng(s, '0')
    if r:
        out.append('0DTE Zoro Range %s to %s.' % (num(r[0] * ratio, 0), num(r[1] * ratio, 0)))
    if s.get('zone') in ZONE:
        out.append('Gamma Zone: %s.' % ZONE[s['zone']])
    return out


def stock_lines(rows):
    """Top 5 stocks by Fresh Volume, one line each (rows from /zo/activity?kind=fresh, volume above open interest)."""
    best = {}
    for r in map(crow, rows or []):
        if not (ok_num(r.get('volume')) and ok_num(r.get('oi')) and r['volume'] > r['oi'] and r.get('u')):
            continue
        if r['u'] in INDEXES or r['u'] == 'SPY':
            continue
        if r['u'] not in best or r['volume'] > best[r['u']]['volume']:
            best[r['u']] = r
    top = sorted(best.values(), key=lambda r: -r['volume'])[:TOP_STOCKS]
    return ['%s: %s %s %s, %s contracts against %s open interest.' % (r['u'], num(r['strike']), r.get('side', ''), r.get('exp', ''), num(r['volume']), num(r['oi'])) for r in top]


# ------------------------------------------------------------------------------------------ the note
def build_note(kind, day, summaries, activity_rows, prev_figures):
    """summaries: {SYM: summary dict}. prev_figures: {SYM: figures} of the previous note (or {}).
    Returns the note dict (ok True) or {'ok': False, 'reason': ...}."""
    secs = []
    for sym in INDEXES:
        s = summaries.get(sym)
        if not s:
            continue
        lines = index_lines(sym, s, prev_figures.get(sym))
        if lines:
            secs.append({'sym': sym, 'title': sym, 'lines': lines})
        for root, src in MAPPED:
            if src == sym:
                ml = mapped_lines(root, sym, s)
                if ml:
                    secs.append({'sym': root, 'title': '%s (mapped from %s)' % (root, sym), 'lines': ml})
    if not any(x['sym'] == 'SPX' for x in secs):
        return {'ok': False, 'reason': 'no SPX numbers'}
    st = stock_lines(activity_rows)
    title = 'Zoro %s Note' % ('Morning' if kind == 'morning' else 'Close')
    body = '\n'.join([title] + [l for x in secs for l in x['lines']] + st)
    bad = banned_words(body)
    if bad:
        return {'ok': False, 'reason': 'banned words: ' + ', '.join(bad)}
    spx = next(x for x in secs if x['sym'] == 'SPX')
    built = max([s.get('built') for s in summaries.values() if ok_num(s.get('built'))] or [0])
    return {'ok': True, 'day': day, 'kind': kind, 'built': int(built), 'title': title, 'sections': secs,
            'stocks': {'title': 'Top 5 stocks by Fresh Volume', 'lines': st}, 'teaser': spx['lines'][:3], 'footer': FOOTER,
            'figures': {sym: figures(s) for sym, s in summaries.items() if s}}


# ------------------------------------------------------------------------------------------ Worker I/O
def http(method, url, key, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'x-ingest-key': key, 'content-type': 'application/json', 'User-Agent': 'tradezoro-zoro-note/1'})
    with urllib.request.urlopen(req, timeout=30) as r:
        t = r.read()
        return json.loads(t) if t else {}


def post_note(rec, key, day, kind, note):
    """POST /zo-ingest?route=note&day=&kind= (S2 src/zoro.js): gzip JSON {v: 1, built, ...}."""
    import gzip
    body = gzip.compress(json.dumps(dict(note, v=1, built=int(note.get('built') or datetime.now().timestamp())), separators=(',', ':')).encode())
    req = urllib.request.Request('%s/zo-ingest?%s' % (rec, urllib.parse.urlencode({'route': 'note', 'day': day, 'kind': kind})), data=body, method='POST',
                                 headers={'x-ingest-key': key, 'content-type': 'application/octet-stream', 'User-Agent': 'tradezoro-zoro-note/1'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8', 'replace')


def prev_weekday(day):
    d = date.fromisoformat(day) - timedelta(days=1)
    while d.weekday() > 4:
        d -= timedelta(days=1)
    return d.isoformat()


def gather(get, day):
    """get(path) -> JSON or None. Returns (summaries, activity_rows, prev_figures)."""
    sums = {}
    for sym in INDEXES:
        s = get('/summary?u=' + sym)
        if s:
            sums[sym] = s
    act = get('/activity?u=all&kind=fresh') or {}
    prev = {}
    d = day
    for _ in range(5):                              # yesterday's close note, else its morning note (holiday gaps: look back)
        d = prev_weekday(d)
        n = get('/note?day=%s&kind=close' % d) or get('/note?day=%s&kind=morning' % d)
        if n and n.get('figures'):
            prev = n['figures']
            break
    return sums, act.get('rows') or [], prev


def main(argv):
    a = {k: v for k, v in (x.lstrip('-').split('=', 1) if '=' in x else (x.lstrip('-'), '1') for x in argv)}
    now = datetime.now(ET)
    kind = a.get('kind') or ('morning' if now.hour < 13 else 'close')
    day = a.get('day') or now.strftime('%Y-%m-%d')
    if now.weekday() > 4 and not a.get('force') and not a.get('day'):
        print('weekend: no note')
        return 0
    rec, key = os.environ.get('BOOK_RECORDER_URL', '').rstrip('/'), os.environ.get('BOOK_INGEST_SECRET', '')
    if a.get('fixture'):
        def get(p):
            name = {'/activity': 'activity', '/note': 'note-prev'}.get(p.split('?')[0], 'summary-' + p.split('u=')[-1].split('&')[0])
            try:
                with open(os.path.join(a['fixture'], name + '.json')) as fh:
                    return json.load(fh)
            except OSError:
                return None
    else:
        if not rec or not key:
            print('BOOK_RECORDER_URL / BOOK_INGEST_SECRET missing', file=sys.stderr)
            return 2

        def get(p):
            try:
                return http('GET', rec + '/zo' + p, key)
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                raise
    sums, rows, prev = gather(get, day)
    stale = [s for s, v in sums.items() if ok_num(v.get('built')) and now.timestamp() - v['built'] > MAX_AGE_S and not a.get('force')]
    for s in stale:
        sums.pop(s)
    note = build_note(kind, day, sums, rows, prev)
    if not note['ok']:
        print('NOT PUBLISHED: ' + note['reason'])      # page shows "Note not available today"
        return 1
    if a.get('dry'):
        print(json.dumps(note, indent=1))
        return 0
    post_note(rec, key, day, kind, note)
    print('published %s %s (%d sections)' % (kind, day, len(note['sections'])))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
