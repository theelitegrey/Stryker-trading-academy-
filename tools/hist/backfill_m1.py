#!/usr/bin/env python3
"""DEEP HISTORY backfill (history-gap2, 2026-11-08): 1-minute futures bars built from the data vendor's tick archive.

Server-side, one run per call. For each symbol it walks UTC days back from today, pulls that day's trades from the vendor's
REST tick archive (GET /v1/history/ticks, paged by `truncated`, 100k rows a page, one request at a time) and folds them into
1-minute rows [t_sec, open, high, low, close, volume, buy_volume, trades]. Each finished day is written to
  <out>/<SYM>/<YYYY-MM-DD>.json.gz          (a JSON list of rows; resumable: a day already on disk is skipped)
and, with --post, uploaded to the book-recorder Worker (POST /hist-ingest, header x-ingest-key) which keeps them in its own
store so members read OUR store, never the vendor. Days younger than --redo-days are always fetched again (daily top-up).

Real trades only: a minute with no trades has no row. Prices are the vendor's continuous front month (same as the live feed).
Never prints the key. Education only. Not financial advice.

  python3 tools/hist/backfill_m1.py --symbols NQ,ES --days 366 --out /var/lib/tz-hist           # one-time backfill
  python3 tools/hist/backfill_m1.py --symbols NQ,ES --days 3 --redo-days 2 --out ... --post       # daily top-up
Env: TICKSTREAM_ENV (file with TICKSTREAM_API_KEY=...), FEEDER_ENV (file with BOOK_RECORDER_URL / BOOK_INGEST_SECRET, --post only).
"""
import argparse, datetime as dt, gzip, json, os, re, sys, time, urllib.request, urllib.error

REST = 'https://api.tick-stream.xyz/v1'
UA = 'TradeZoro-hist/1'


def env_value(path, name):
    try:
        m = re.search(r'^\s*' + name + r'\s*=\s*(.*)$', open(path).read(), re.M)
    except OSError:
        return ''
    return m.group(1).strip().strip('"\'') if m else ''


def get_json(url, key, tries=4):
    for i in range(tries):
        req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + key, 'User-Agent': UA, 'Accept-Encoding': 'gzip'})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                b = r.read()
                if r.headers.get('Content-Encoding') == 'gzip':
                    b = gzip.decompress(b)
                return json.loads(b), len(b)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SystemExit('vendor refused the key (%d): stop' % e.code)
            if e.code < 500 and e.code != 429:
                raise
            wait = int(e.headers.get('Retry-After') or 0) or 5 * (i + 1)
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            wait = 5 * (i + 1)
        time.sleep(wait)
    raise RuntimeError('vendor unavailable')


def fold(rows, ticks):
    """ticks [{ts us, price, size, side}] (time order) into rows {minute_sec: [t,o,h,l,c,v,b,n]}"""
    for x in ticks:
        px, sz = float(x['price']), float(x['size'])
        if not (px > 0 and sz > 0):
            continue
        t = int(x['ts'] // 60_000_000) * 60
        r = rows.get(t)
        if r is None:
            rows[t] = [t, px, px, px, px, sz, sz if x.get('side') == 'buy' else 0.0, 1]
            continue
        if px > r[2]: r[2] = px
        if px < r[3]: r[3] = px
        r[4] = px; r[5] += sz; r[7] += 1
        if x.get('side') == 'buy': r[6] += sz


def fetch_day(sym, day, key, stats):
    """all 1m rows of UTC day `day` (date). Pages by start = last row's second (the trades of that second are re-read once)."""
    s0 = int(dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc).timestamp())
    end, start, rows = s0 + 86400, s0, {}
    while True:
        j, n = get_json('%s/history/ticks?symbol=%s&start=%d&end=%d&limit=100000' % (REST, sym, start, end), key)
        stats['req'] += 1; stats['bytes'] += n
        if j.get('history_clamped'):
            stats['clamped'] = True
        ticks = j.get('ticks') or []
        more = bool(j.get('truncated')) and ticks
        if more:
            last = ticks[-1]['ts'] // 1_000_000
            if last <= start:
                raise RuntimeError('page stuck at %d' % start)
            fold(rows, [x for x in ticks if x['ts'] // 1_000_000 < last])   # the last second is read again on the next page
            start = last
            continue
        fold(rows, ticks)
        break
    return [rows[t] for t in sorted(rows) if s0 <= t < end]


def post(url, secret, sym, day, rows):
    body = gzip.compress(json.dumps({'sym': sym, 'day': day.isoformat(), 'rows': rows}, separators=(',', ':')).encode())
    req = urllib.request.Request(url.rstrip('/') + '/hist-ingest', data=body, method='POST',
                                 headers={'x-ingest-key': secret, 'content-type': 'application/json', 'content-encoding': 'gzip', 'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--symbols', default='NQ,ES')
    ap.add_argument('--days', type=int, default=366)
    ap.add_argument('--redo-days', type=int, default=2, help='always re-fetch the newest N days (they may still be filling)')
    ap.add_argument('--out', required=True)
    ap.add_argument('--post', action='store_true')
    ap.add_argument('--post-all', action='store_true', help='--post, and also upload days already on disk (first load of the store)')
    a = ap.parse_args()
    key = env_value(os.environ.get('TICKSTREAM_ENV', '/root/.hermes/profiles/chief-of-staff/scripts/tickstream.env'), 'TICKSTREAM_API_KEY')
    if not key:
        raise SystemExit('no vendor key in TICKSTREAM_ENV')
    purl = psec = ''
    a.post = a.post or a.post_all
    if a.post:
        fe = os.environ.get('FEEDER_ENV', '/root/projects/book-feeder/feeder.env')
        purl, psec = env_value(fe, 'BOOK_RECORDER_URL'), env_value(fe, 'BOOK_INGEST_SECRET')
        if not (purl and len(psec) >= 32):
            raise SystemExit('no recorder url / ingest secret in FEEDER_ENV')
    today = dt.datetime.now(dt.timezone.utc).date()
    for sym in [s.strip().upper() for s in a.symbols.split(',') if s.strip()]:
        d = os.path.join(a.out, sym); os.makedirs(d, exist_ok=True)
        st = {'req': 0, 'bytes': 0, 'days': 0, 'rows': 0, 'skipped': 0, 'clamped': False}
        t0 = time.time()
        for k in range(a.days):
            day = today - dt.timedelta(days=k)
            if day.weekday() == 5:          # Saturday UTC: CME closed all day
                continue
            f = os.path.join(d, day.isoformat() + '.json.gz')
            if k >= a.redo_days and os.path.exists(f):
                st['skipped'] += 1
                if a.post_all:
                    with gzip.open(f, 'rt') as g:
                        rows = json.load(g)
                    if rows:
                        post(purl, psec, sym, day, rows)
                continue
            rows = fetch_day(sym, day, key, st)
            tmp = f + '.tmp'
            with gzip.open(tmp, 'wt') as g:
                json.dump(rows, g, separators=(',', ':'))
            os.replace(tmp, f)
            if a.post and rows:
                post(purl, psec, sym, day, rows)
            st['days'] += 1; st['rows'] += len(rows)
            if st['days'] % 20 == 0:
                print(sym, day, 'days', st['days'], 'rows', st['rows'], 'req', st['req'], 'MB', round(st['bytes'] / 1e6), 'min', round((time.time() - t0) / 60, 1), flush=True)
        print('DONE', sym, json.dumps(st), 'minutes', round((time.time() - t0) / 60, 1), flush=True)


if __name__ == '__main__':
    main()
