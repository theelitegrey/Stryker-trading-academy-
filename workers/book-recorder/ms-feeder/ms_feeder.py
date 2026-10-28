#!/usr/bin/env python3
"""TradeZoro Market Stats feeder: InsightSentry 5-minute history -> one row per RTH session -> gzip part -> book recorder
Worker (/scan-ingest?part=ms_nq|ms_es|ms_spx). Runs once a day after the US close (ms-feeder.timer).

The page (assets/market-stats.js) turns these rows into P(outcome | conditions) with N and a Wilson 95% interval.
Statistics engine based on LuxAlgo Edge Stats (MIT), https://github.com/LuxAlgo/edge-stats. Copyright (c) 2026 LuxAlgo Global, LLC.
The session definitions here (gap fill, opening range, initial balance, prior-level touches) are our own re-implementation of
the ideas in that project's registry (packages/core/src/registry/outcomes.ts); see assets/market-stats.js for the MIT notice.

InsightSentry budget: each symbol is fetched month by month (GET /v3/symbols/{code}/history, 5-minute bars, 1 call a month).
Raw months are cached in CACHE_DIR. A normal night re-fetches only the last 2 months (6 calls in all); the first run, a
weekly refresh (Sunday), or any back-adjustment shift seen in the overlapping month re-fetches all 37 months. The calls
are counted and posted to the recorder's /is-note (source 'other'), like info_feeder.py.
Env: INSIGHTSENTRY_WEBSOCKET_API_KEY, BOOK_RECORDER_URL, BOOK_INGEST_SECRET (never printed).
"""
import gzip, json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

IS = 'https://api.insightsentry.com/v3'
NY = ZoneInfo('America/New_York')
SYMS = {  # report symbol -> (IS code, part)
    'NQ': ('CME_MINI:NQ1!', 'ms_nq'),
    'ES': ('CME_MINI:ES1!', 'ms_es'),
    'SPX': ('SP:SPX', 'ms_spx'),
}
CACHE_DIR = os.environ.get('MS_CACHE_DIR', '/root/projects/book-feeder/ms-cache')
YEARS = 3
STEP = 5                       # minutes per bar
RTH_START, RTH_END = 9 * 60 + 30, 16 * 60   # 09:30-16:00 ET (bar starts 09:30 .. 15:55)
FULL_BARS = 78
HALF_LAST = 12 * 60 + 55       # an early close (13:00) ends with the 12:55 bar
COLS = ['d', 'dow', 'o', 'h', 'l', 'c', 'pdh', 'pdl', 'pdc', 'gf',
        'o15h', 'o15l', 'o15d', 'o15t', 'o15x', 'o30h', 'o30l', 'o30d', 'o30t', 'o30x',
        'ibh', 'ibl', 'ibd', 'ibt', 'ibx', 'ibu', 'ibw', 'ibxu', 'ibxd',
        'thi', 'tlo', 'bhi', 'blo']

IS_CALLS = [0]


def log(m):
    print(time.strftime('%H:%M:%S ') + m, flush=True)


def get(path, key):
    IS_CALLS[0] += 1
    req = urllib.request.Request(IS + urllib.parse.quote(path, safe='/:!?=&'), headers={'Authorization': 'Bearer ' + key})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def note_is():
    n, IS_CALLS[0] = IS_CALLS[0], 0
    url, sec = os.environ.get('BOOK_RECORDER_URL', '').rstrip('/'), os.environ.get('BOOK_INGEST_SECRET', '')
    if not n or not url or not sec:
        return
    try:
        req = urllib.request.Request(url + '/is-note', data=json.dumps({'src': 'other', 'n': n}).encode(), method='POST',
                                     headers={'content-type': 'application/json', 'x-ingest-key': sec, 'User-Agent': 'tradezoro-is-note/1'})
        urllib.request.urlopen(req, timeout=10).close()
    except Exception:
        pass


# ---- raw bars (cached per month) -----------------------------------------------------------------------------------
def months_back(now, n):
    y, m = now.year, now.month
    out = []
    for _ in range(n):
        out.append('%04d-%02d' % (y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out[::-1]


def fetch_month(code, ym, key):
    d = get('/symbols/%s/history?bar_type=minute&bar_interval=%d&start_date=%s&abbr=true' % (code, STEP, ym), key)
    keys = d.get('series_keys') or ['time', 'open', 'high', 'low', 'close', 'volume']
    out = []
    for r in d.get('series') or []:
        row = dict(zip(keys, r))
        out.append([int(row['time']), row['open'], row['high'], row['low'], row['close']])
    return out


def cache_path(sym, ym):
    return os.path.join(CACHE_DIR, '%s-%s.json' % (sym, ym))


def load_month(sym, ym):
    try:
        with open(cache_path(sym, ym)) as f:
            return json.load(f)
    except Exception:
        return None


def save_month(sym, ym, rows):
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(cache_path(sym, ym), 'w') as f:
        json.dump(rows, f, separators=(',', ':'))


def refresh(sym, code, key, now, full):
    """Fetch what is needed; returns all cached bars (sorted, de-duplicated)."""
    months = months_back(now, YEARS * 12 + 1)
    todo = months if full else months[-2:]
    shifted = False
    for ym in todo:
        if not full and ym == months[-2]:
            old = load_month(sym, ym)
        else:
            old = None
        rows = fetch_month(code, ym, key)
        time.sleep(0.3)
        if old and rows:
            om = {r[0]: r[4] for r in old}
            diffs = [abs(om[r[0]] - r[4]) for r in rows if r[0] in om]
            if diffs and max(diffs) > 1e-6:
                shifted = True
        if rows:
            save_month(sym, ym, rows)
    if shifted and not full:
        log('%s: back-adjustment shift seen in the overlap month, re-fetching all months' % sym)
        return refresh(sym, code, key, now, True)
    allr = {}
    for ym in months:
        for r in load_month(sym, ym) or []:
            allr[r[0]] = r
    return [allr[t] for t in sorted(allr)]


# ---- sessions -----------------------------------------------------------------------------------------------------
def group_sessions(bars):
    """bars [[t,o,h,l,c]] -> {date: [(minuteOfDay, o, h, l, c)]} for RTH bar starts only, ET."""
    days = {}
    for t, o, h, l, c in bars:
        dt = datetime.fromtimestamp(t, NY)
        mod = dt.hour * 60 + dt.minute
        if mod < RTH_START or mod >= RTH_END or dt.weekday() > 4:
            continue
        days.setdefault(dt.strftime('%Y%m%d'), []).append((mod, o, h, l, c))
    for d in days:
        days[d].sort()
    return days


def classify(bars):
    """'full' | 'half' | None (incomplete data)."""
    if not bars or bars[0][0] != RTH_START:
        return None
    if len(bars) >= FULL_BARS - 1 and bars[-1][0] == RTH_END - STEP:
        return 'full'
    if bars[-1][0] == HALF_LAST and len(bars) >= 40:
        return 'half'
    return None


def r2(v):
    return round(v + 0.0, 4)


def first_break(bars, i0, hi, lo):
    """First bar index >= i0 whose range leaves (lo, hi): (dir, idx). dir 1 up, -1 down, 2 both in one bar, 0 none."""
    for i in range(i0, len(bars)):
        up, dn = bars[i][2] > hi, bars[i][3] < lo
        if up and dn:
            return 2, i
        if up:
            return 1, i
        if dn:
            return -1, i
    return 0, -1


def session_row(d, bars, prior):
    """One session -> list in COLS order. prior = (pdh, pdl, pdc) or None."""
    o, c = bars[0][1], bars[-1][4]
    h, l = max(b[2] for b in bars), min(b[3] for b in bars)
    mins = lambda i: (bars[i][0] - RTH_START) + STEP          # minutes from the open to the END of bar i
    pdh, pdl, pdc = prior
    dow = datetime.strptime(d, '%Y%m%d').weekday()            # 0 = Monday
    # gap fill: a bar trades back to the prior close
    gf = -1
    if o != pdc:
        for i, b in enumerate(bars):
            if (o > pdc and b[3] <= pdc) or (o < pdc and b[2] >= pdc):
                gf = mins(i)
                break
    row = [int(d), dow, r2(o), r2(h), r2(l), r2(c), r2(pdh), r2(pdl), r2(pdc), gf]
    # opening range 15 / 30 minutes: first break AFTER the window, plus extension (points beyond the broken side)
    for n in (3, 6):
        rh, rl = max(b[2] for b in bars[:n]), min(b[3] for b in bars[:n])
        dr, i = first_break(bars, n, rh, rl)
        t, x = -1, None
        if dr:
            t = mins(i)
            if dr == 1:
                x = max(b[2] for b in bars[i:]) - rh
            elif dr == -1:
                x = rl - min(b[3] for b in bars[i:])
        row += [r2(rh), r2(rl), dr, t, None if x is None else r2(x)]
    # initial balance (first hour): break after 10:30, plus whether each side was ever broken and the best extension
    ih, il = max(b[2] for b in bars[:12]), min(b[3] for b in bars[:12])
    dr, i = first_break(bars, 12, ih, il)
    rest = bars[12:]
    xu = max([b[2] for b in rest] or [ih]) - ih
    xd = il - min([b[3] for b in rest] or [il])
    row += [r2(ih), r2(il), dr, mins(i) if dr else -1, None if dr not in (1, -1) else r2(xu if dr == 1 else xd),
            1 if xu > 0 else 0, 1 if xd > 0 else 0, r2(max(xu, 0)), r2(max(xd, 0))]
    # prior-level touches: first bar that trades at/through the level, first bar that CLOSES beyond it
    def first(pred):
        for i, b in enumerate(bars):
            if pred(b):
                return mins(i)
        return -1
    row += [first(lambda b: b[2] >= pdh), first(lambda b: b[3] <= pdl),
            first(lambda b: b[4] > pdh), first(lambda b: b[4] < pdl)]
    assert len(row) == len(COLS), (len(row), len(COLS))
    return row


def build_rows(bars):
    days = group_sessions(bars)
    kinds = {d: classify(days[d]) for d in days}
    order = sorted(d for d in days if kinds[d])
    rows, prior, prior_date = [], None, None
    for d in order:
        b = days[d]
        dt = datetime.strptime(d, '%Y%m%d')
        near = prior_date is not None and (dt - prior_date).days <= 4
        if kinds[d] == 'full' and prior and near:
            rows.append(session_row(d, b, prior))
        prior = (max(x[2] for x in b), min(x[3] for x in b), b[-1][4])
        prior_date = dt
    return rows


def payload(sym, rows, now):
    cut = int((datetime.now(NY) - timedelta(days=365 * YEARS + 10)).strftime('%Y%m%d'))
    rows = [r for r in rows if r[0] >= cut]
    body = {'v': 1, 't': int(now), 'sym': sym, 'tf': STEP, 'cols': COLS, 'rows': rows}
    return gzip.compress(json.dumps(body, separators=(',', ':')).encode(), 9), len(rows)


def post(url, secret, part, body):
    req = urllib.request.Request(url.rstrip('/') + '/scan-ingest?part=' + part, data=body, method='POST',
                                 headers={'content-type': 'application/octet-stream', 'x-ingest-key': secret, 'user-agent': 'tradezoro-ms-feeder/1'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read()[:60].decode()


def main():
    key, url, secret = os.environ.get('INSIGHTSENTRY_WEBSOCKET_API_KEY'), os.environ.get('BOOK_RECORDER_URL'), os.environ.get('BOOK_INGEST_SECRET')
    only = [a for a in sys.argv[1:] if a in SYMS]
    dry, force_full = '--dry' in sys.argv, '--full' in sys.argv
    if not key:
        sys.exit('missing key')
    now = datetime.now(timezone.utc)
    full = force_full or now.weekday() == 6
    ok = 0
    try:
        for sym, (code, part) in SYMS.items():
            if only and sym not in only:
                continue
            cached = len([f for f in os.listdir(CACHE_DIR) if f.startswith(sym + '-')]) if os.path.isdir(CACHE_DIR) else 0
            try:
                bars = refresh(sym, code, key, now, full or cached < YEARS * 12)
                rows = build_rows(bars)
                body, n = payload(sym, rows, time.time())
                log('%s: %d bars, %d sessions, %d B gzip, last %s' % (sym, len(bars), n, len(body), rows[-1][0] if rows else '-'))
                if '--out' in sys.argv:
                    with open(os.path.join(os.environ.get('MS_OUT', '.'), part + '.json.gz'), 'wb') as f:
                        f.write(body)
                if dry or not (url and secret):
                    continue
                if n < 200:
                    log('%s: too few sessions, not posting' % sym)
                    continue
                log('ingest %s -> %s %s' % ((part,) + post(url, secret, part, body)))
                ok += 1
            except Exception as ex:
                log('%s failed: %s' % (sym, str(ex)[:120]))
    finally:
        note_is()
    if not dry and not ok:
        sys.exit(1)


if __name__ == '__main__':
    main()
