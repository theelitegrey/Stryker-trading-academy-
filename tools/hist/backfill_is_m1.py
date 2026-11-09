#!/usr/bin/env python3
"""DEEP HISTORY backfill, source 2: 1-minute bars for YM, RTY, MNQ, MES from the REST/options data vendor (already paid for).
The tick vendor only holds ~2.5 months of these four. Same on-disk + ingest format as backfill_m1.py:
  <out>/<SYM>/<YYYY-MM-DD>.json.gz = JSON list of [t_sec, o, h, l, c, volume, buy_volume, trades]; --post uploads to POST /hist-ingest.
This vendor has no buy/sell split or trade count, so those two fields are null (never invented).
Checked 2026-11-09 against the tick vendor on MNQ 2026-10-20: all 1380 minutes identical (UTC bar-open time, OHLC, volume).
One call per month per symbol, at most 1 call/s, retry on 429. Continuous front-month bars. Never prints the key.
  python3 tools/hist/backfill_is_m1.py --symbols YM,RTY,MNQ,MES --days 366 --out /var/lib/tz-hist --post     # backfill
  python3 tools/hist/backfill_is_m1.py --days 3 --redo-days 2 --out ... --post                                # daily top-up
Env: INSIGHTSENTRY_ENV (file with INSIGHTSENTRY_WEBSOCKET_API_KEY=...), FEEDER_ENV (--post).
"""
import argparse, datetime as dt, gzip, json, os, sys, time, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from backfill_m1 import env_value, post, UA

REST = 'https://api.insightsentry.com/v3/symbols/%s/history?bar_type=minute&bar_interval=1&start_ym=%s'
CODES = {'MNQ': 'CME_MINI:MNQ1!', 'MES': 'CME_MINI:MES1!', 'RTY': 'CME_MINI:RTY1!', 'YM': 'CBOT_MINI:YM1!'}
_last = [0.0]


def get_month(code, ym, key, tries=6):
    for i in range(tries):
        gap = 1.1 - (time.time() - _last[0])
        if gap > 0: time.sleep(gap)
        _last[0] = time.time()
        req = urllib.request.Request(REST % (code, ym), headers={'Authorization': 'Bearer ' + key, 'User-Agent': UA})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403): raise SystemExit('vendor refused the key (%d): stop' % e.code)
            if e.code == 400:
                try: return json.load(e)          # data_unavailable body carries available_start_date
                except Exception: return {'series': []}
            if e.code != 429 and e.code < 500: raise
            time.sleep(int(e.headers.get('Retry-After') or 0) or 5 * (i + 1))
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(5 * (i + 1))
    raise RuntimeError('vendor unavailable')


def by_day(series):
    """vendor bars -> {date: [[t,o,h,l,c,v,None,None], ..]} (sorted, de-duplicated, sane bars only)"""
    days = {}
    for b in sorted(series, key=lambda x: x['time']):
        t = int(b['time'])
        o, h, l, c, v = (float(b[k]) for k in ('open', 'high', 'low', 'close', 'volume'))
        if t % 60 or not (min(o, h, l, c) > 0 and h >= max(o, c, l) and l <= min(o, c) and v >= 0):
            continue
        d = dt.datetime.fromtimestamp(t, dt.timezone.utc).date()
        rows = days.setdefault(d, [])
        if rows and rows[-1][0] == t: rows.pop()
        rows.append([t, o, h, l, c, v, None, None])
    return days


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--symbols', default='YM,RTY,MNQ,MES')
    ap.add_argument('--days', type=int, default=366)
    ap.add_argument('--redo-days', type=int, default=2)
    ap.add_argument('--out', required=True)
    ap.add_argument('--post', action='store_true')
    ap.add_argument('--post-all', action='store_true', help='also upload days already on disk')
    ap.add_argument('--dry', action='store_true', help='fetch + check alignment, write nothing')
    a = ap.parse_args()
    key = env_value(os.environ.get('INSIGHTSENTRY_ENV', '/root/.hermes/profiles/chief-of-staff/scripts/insightsentry.env'), 'INSIGHTSENTRY_WEBSOCKET_API_KEY')
    if not key: raise SystemExit('no vendor key in INSIGHTSENTRY_ENV')
    purl = psec = ''
    a.post = a.post or a.post_all
    if a.post and not a.dry:
        fe = os.environ.get('FEEDER_ENV', '/root/projects/book-feeder/feeder.env')
        purl, psec = env_value(fe, 'BOOK_RECORDER_URL'), env_value(fe, 'BOOK_INGEST_SECRET')
        if not (purl and len(psec) >= 32): raise SystemExit('no recorder url / ingest secret in FEEDER_ENV')
    today = dt.datetime.now(dt.timezone.utc).date()
    first = today - dt.timedelta(days=a.days - 1)
    months, m = [], first.replace(day=1)
    while m <= today:
        months.append(m.strftime('%Y-%m')); m = (m.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    for sym in [s.strip().upper() for s in a.symbols.split(',') if s.strip()]:
        if sym not in CODES: raise SystemExit('unknown symbol ' + sym)
        d = os.path.join(a.out, sym); os.makedirs(d, exist_ok=True)
        st = {'days': 0, 'rows': 0, 'skipped': 0, 'req': 0}; t0 = time.time()
        for ym in months:
            j = get_month(CODES[sym], ym, key); st['req'] += 1
            for day, rows in sorted(by_day(j.get('series') or []).items()):
                age = (today - day).days
                if day < first or day > today or day.weekday() == 5: continue
                f = os.path.join(d, day.isoformat() + '.json.gz')
                if age >= a.redo_days and os.path.exists(f):
                    st['skipped'] += 1
                    if a.post_all and not a.dry:
                        with gzip.open(f, 'rt') as g: post(purl, psec, sym, day, json.load(g))
                    continue
                if a.dry: st['days'] += 1; st['rows'] += len(rows); continue
                tmp = f + '.tmp'
                with gzip.open(tmp, 'wt') as g: json.dump(rows, g, separators=(',', ':'))
                os.replace(tmp, f)
                if a.post:
                    post(purl, psec, sym, day, rows)
                st['days'] += 1; st['rows'] += len(rows)
            if not j.get('series') and j.get('available_start_date'):
                print(sym, ym, 'vendor starts', j['available_start_date'], flush=True)
        print('DONE', sym, json.dumps(st), 'minutes', round((time.time() - t0) / 60, 1), flush=True)


if __name__ == '__main__':
    main()
