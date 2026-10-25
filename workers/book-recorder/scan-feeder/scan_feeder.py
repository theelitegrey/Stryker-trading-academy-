#!/usr/bin/env python3
"""TradeZoro market scanner feeder: InsightSentry screeners -> preset lists + a compact universe -> recorder Worker.

Owner-approved 2026-10-14 (InsightSentry market scanner; design approved by the CoS). Runs on our
server from a systemd timer (scan-feeder.timer, every 3 min). The browser never calls InsightSentry:
it reads the recorder Worker's GET /scan (edge-cached), which serves what this script pushed.

Per run: 4 screener calls in total (US stocks x 2 field sets, US ETFs, Binance crypto spot), never
one per visitor. From them we build
  - presets: top gainers / losers, unusual volume, new 52-week highs / lows, gap up / down,
    RSI high / low, biggest ETF movers, crypto movers (each <= 50 rows), and
  - the "universe": every row with the scanner columns, in a compact column-major form, so the
    Pro custom filters run in the browser on cached data (no IS call).
Four gzip JSON parts are POSTed to /scan-ingest?part=stock|etf|crypto|presets with the shared
ingest secret: 'presets' (~15 KB, what every visitor loads) and one universe table per market
(~50-200 KB, loaded only by Pro members using custom filters).

Memory: the biggest IS reply is ~2 MB JSON (4,112 stock rows); parsed one at a time, ~60 MB RSS.
Env: BOOK_RECORDER_URL, BOOK_INGEST_SECRET (book-feeder/feeder.env), INSIGHTSENTRY_WEBSOCKET_API_KEY.
Never prints a secret. Education only.
"""
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

IS = 'https://api.insightsentry.com/v3/screeners/'
UA = 'tradezoro-scan-feeder/1'
ET = ZoneInfo('America/New_York')
US_EX = ['NYSE', 'NASDAQ', 'AMEX']
FETCH_TIMEOUT = 60
POST_TIMEOUT = 30
TOP_N = 50
MIN_CAP = 300e6            # stocks: $300M+ market cap (drops illiquid micro caps)
MIN_PRICE = 1.0


# ---- InsightSentry monthly REST quota (2026-10-25): every request made here is counted and posted once to the recorder's
# /is-note (src/is-usage.js), so /is-health can show the month's use and site_health can warn before the quota runs out.
IS_CALLS = [0]


def note_is(src):
    n, IS_CALLS[0] = IS_CALLS[0], 0
    url, sec = os.environ.get('BOOK_RECORDER_URL', '').rstrip('/'), os.environ.get('BOOK_INGEST_SECRET', '')
    if not n or not url or not sec:
        return
    try:
        req = urllib.request.Request(url + '/is-note', data=json.dumps({'src': src, 'n': n}).encode(), method='POST',
                                     headers={'content-type': 'application/json', 'x-ingest-key': sec, 'User-Agent': 'tradezoro-is-note/1'})
        urllib.request.urlopen(req, timeout=10).close()
    except Exception:
        IS_CALLS[0] += n      # keep it for the next flush (long-running feeders)


import atexit  # noqa: E402
atexit.register(note_is, 'scan')
MIN_DOLLAR_VOL = 1e6       # a mover must have traded at least $1M today
MIN_ETF_AVGVOL = 100000
MAX_BODY = 512 * 1024     # per part (gzip)

# Column order of the universe table (the browser reads these names).
COLS = ['s', 'n', 'c', 'chg', 'vol', 'rvol', 'gap', 'rsi', 'hi52', 'lo52', 'cap', 'pe', 'sec', 'perfW', 'perfYtd']

STOCK_A = ['close', 'change_percent', 'volume', 'relative_volume_intraday', 'gap', 'relative_strength_index_14_1D',
           'highest_price_52Weeks', 'lowest_price_52Weeks', 'market_cap', 'average_volume_10d']
STOCK_B = ['sector', 'price_earnings_ttm', 'performance_week', 'performance_ytd']
ETF_F = ['close', 'change_percent', 'volume', 'relative_volume_intraday', 'gap', 'relative_strength_index_14_1D',
         'highest_price_52Weeks', 'lowest_price_52Weeks', 'average_volume_10d', 'performance_ytd']
CRYPTO_F = ['close', 'change_percent', 'volume', 'market_cap', 'relative_strength_index_14_1D',
            'highest_price_52Weeks', 'lowest_price_52Weeks', 'gap', 'performance_week', 'performance_ytd']


def log(msg):
    print(msg, flush=True)


def in_window(now):
    """Weekdays 09:00-16:30 ET. Was 04:00-20:15 every 3 min (~1,300 IS calls a weekday); since 2026-10-25 (InsightSentry
    monthly REST quota) the timer runs every 10 min inside the cash session plus the open/close edges (~160 a weekday).
    The page shows \"Updated X min ago\" from the data's own time."""
    t = datetime.fromtimestamp(now, ET)
    if t.weekday() >= 5:
        return False
    m = t.hour * 60 + t.minute
    return 9 * 60 <= m <= 16 * 60 + 30


def screener_body(fields, **filters):
    """One IS screener request body. Pure (unit-tested): <= 10 fields, the rest are filters."""
    if not fields or len(fields) > 10:
        raise ValueError('1-10 fields')
    b = {'fields': list(fields), 'max_range': 15000, 'sortBy': filters.pop('sortBy', 'market_cap'),
         'sortOrder': filters.pop('sortOrder', 'desc')}
    for k, v in filters.items():
        if v is None:
            continue
        b[k] = v
    return b


def is_post(kind, body, key):
    IS_CALLS[0] += 1
    req = urllib.request.Request(IS + kind, data=json.dumps(body).encode(), method='POST',
                                 headers={'Authorization': 'Bearer ' + key, 'content-type': 'application/json',
                                          'user-agent': UA, 'accept-encoding': 'gzip'})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as r:
        raw = r.read()
        if r.headers.get('content-encoding') == 'gzip':
            raw = gzip.decompress(raw)
    d = json.loads(raw)
    return d.get('data') or []


def num(v):
    return v if isinstance(v, (int, float)) and v == v and v not in (float('inf'), float('-inf')) else None


def rnd(v, n=2):
    v = num(v)
    return None if v is None else round(v, n)


def sym_of(code):
    return str(code or '').split(':', 1)[-1]


def row_from(r, kind):
    """IS screener row -> our compact row dict (keys = COLS). Pure."""
    return {
        's': r.get('symbol_code'), 'n': (r.get('name') or sym_of(r.get('symbol_code')))[:60],
        'c': rnd(r.get('close'), 6 if kind == 'crypto' else 2),
        'chg': rnd(r.get('change_percent_1D', r.get('change_percent')), 2),
        'vol': rnd(r.get('volume'), 0), 'rvol': rnd(r.get('relative_volume_intraday'), 2),
        'gap': rnd(r.get('gap_1D', r.get('gap')), 2), 'rsi': rnd(r.get('relative_strength_index_14_1D'), 1),
        'hi52': rnd(r.get('highest_price_52Weeks'), 6 if kind == 'crypto' else 2),
        'lo52': rnd(r.get('lowest_price_52Weeks'), 6 if kind == 'crypto' else 2),
        'cap': rnd(r.get('market_cap'), 0), 'pe': rnd(r.get('price_earnings_ttm'), 1),
        'sec': r.get('sector') or None, 'perfW': rnd(r.get('performance_week'), 2),
        'perfYtd': rnd(r.get('performance_ytd'), 2),
    }


def liquid(r):
    c, v = r.get('c'), r.get('vol')
    return c is not None and v is not None and c >= MIN_PRICE and c * v >= MIN_DOLLAR_VOL


def top(rows, key, desc=True, where=None, n=TOP_N):
    """Top n rows by key (None values dropped). Pure."""
    xs = [r for r in rows if r.get(key) is not None and (where is None or where(r))]
    xs.sort(key=lambda r: r[key], reverse=desc)
    return [r['s'] for r in xs[:n]]


def near_high(r, pct=0.5):
    """At (or within pct % of) a new 52-week high. Pure."""
    c, h = r.get('c'), r.get('hi52')
    return c is not None and h is not None and h > 0 and c >= h * (1 - pct / 100)


def near_low(r, pct=0.5):
    c, lo = r.get('c'), r.get('lo52')
    return c is not None and lo is not None and lo > 0 and c <= lo * (1 + pct / 100)


def build_presets(stocks, etfs, crypto):
    """Preset id -> {title, kind, syms}. Pure (unit-tested)."""
    ls = [r for r in stocks if liquid(r)]
    le = [r for r in etfs if liquid(r)]
    lc = [r for r in crypto if r.get('c') is not None and (r.get('cap') or 0) >= 50e6]
    p = {
        'gainers': ('Top gainers', 'stock', top(ls, 'chg', True, lambda r: r['chg'] > 0)),
        'losers': ('Top losers', 'stock', top(ls, 'chg', False, lambda r: r['chg'] < 0)),
        'unusual': ('Unusual volume', 'stock', top(ls, 'rvol', True, lambda r: r['rvol'] >= 2)),
        'high52': ('New 52-week highs', 'stock', top(ls, 'chg', True, near_high)),
        'low52': ('New 52-week lows', 'stock', top(ls, 'chg', False, near_low)),
        'gapup': ('Gap up', 'stock', top(ls, 'gap', True, lambda r: r['gap'] >= 2)),
        'gapdown': ('Gap down', 'stock', top(ls, 'gap', False, lambda r: r['gap'] <= -2)),
        'rsihigh': ('RSI above 70', 'stock', top(ls, 'rsi', True, lambda r: r['rsi'] >= 70)),
        'rsilow': ('RSI below 30', 'stock', top(ls, 'rsi', False, lambda r: r['rsi'] <= 30)),
        'etfup': ('ETF gainers', 'etf', top(le, 'chg', True, lambda r: r['chg'] > 0)),
        'etfdown': ('ETF losers', 'etf', top(le, 'chg', False, lambda r: r['chg'] < 0)),
        'cryptoup': ('Crypto gainers', 'crypto', top(lc, 'chg', True, lambda r: r['chg'] > 0)),
        'cryptodown': ('Crypto losers', 'crypto', top(lc, 'chg', False, lambda r: r['chg'] < 0)),
    }
    return {k: {'title': t, 'kind': kd, 'syms': s} for k, (t, kd, s) in p.items()}


def presets_part(stocks, etfs, crypto, now):
    """The small part every visitor loads: each preset with its rows (COLS order). Pure."""
    by = {'stock': {r['s']: r for r in stocks}, 'etf': {r['s']: r for r in etfs}, 'crypto': {r['s']: r for r in crypto}}
    out = {}
    for k, p in build_presets(stocks, etfs, crypto).items():
        out[k] = {'title': p['title'], 'kind': p['kind'], 'rows': [[by[p['kind']][s].get(c) for c in COLS] for s in p['syms']]}
    return {'v': 1, 't': int(now), 'cols': COLS, 'presets': out}


def universe_part(rows, now):
    """One market's full table for the Pro custom filters (column-major). Pure."""
    return {'v': 1, 't': int(now), 'cols': COLS, 'n': len(rows), 'd': columnar(rows)}


def columnar(rows):
    """[{col: v}] -> {col: [v, ...]} in COLS order (smaller JSON). Pure."""
    return {c: [r.get(c) for r in rows] for c in COLS}


def pull(key):
    a = is_post('stock', screener_body(STOCK_A, exchanges=US_EX, countries=['US'], market_cap_min=MIN_CAP), key)
    stocks = {}
    for r in a:
        if r.get('symbol_code'):
            stocks[r['symbol_code']] = row_from(r, 'stock')
    del a
    b = is_post('stock', screener_body(STOCK_B, exchanges=US_EX, countries=['US'], market_cap_min=MIN_CAP), key)
    for r in b:
        x = stocks.get(r.get('symbol_code'))
        if x:
            x['sec'] = r.get('sector') or None
            x['pe'] = rnd(r.get('price_earnings_ttm'), 1)
            x['perfW'] = rnd(r.get('performance_week'), 2)
            x['perfYtd'] = rnd(r.get('performance_ytd'), 2)
    del b
    e = is_post('etf', screener_body(ETF_F, exchanges=US_EX + ['CBOE'], countries=['US'], average_volume_10d_min=MIN_ETF_AVGVOL,
                                     sortBy='volume'), key)
    etfs = [row_from(r, 'etf') for r in e if r.get('symbol_code')]
    del e
    c = is_post('crypto', screener_body(CRYPTO_F, exchanges=['BINANCE'], type='spot'), key)
    # one row per coin: the USD / USDT spot pair, by market cap
    crypto, seen = [], set()
    for r in c:
        code = r.get('symbol_code') or ''
        t = sym_of(code)
        base = t[:-4] if t.endswith('USDT') else t[:-3] if t.endswith('USD') else None
        if not base or base in seen or base in ('USDT', 'USDC', 'FDUSD', 'TUSD', 'DAI', 'USDE', 'USD1', 'BUSD'):
            continue
        seen.add(base)
        x = row_from(r, 'crypto')
        x['s'] = 'BINANCE:' + base + 'USDT'
        x['n'] = r.get('name') or base
        crypto.append(x)
    del c
    return list(stocks.values()), etfs, crypto


def parts(stocks, etfs, crypto, now):
    """part name -> gzip body. Each part is stored and served by the Worker as-is."""
    d = {'presets': presets_part(stocks, etfs, crypto, now), 'stock': universe_part(stocks, now),
         'etf': universe_part(etfs, now), 'crypto': universe_part(crypto, now)}
    return {k: gzip.compress(json.dumps(v, separators=(',', ':')).encode(), 9) for k, v in d.items()}


def post(url, secret, part, body):
    req = urllib.request.Request(url.rstrip('/') + '/scan-ingest?part=' + part, data=body, method='POST',
                                 headers={'content-type': 'application/octet-stream', 'x-ingest-key': secret,
                                          'user-agent': UA})
    with urllib.request.urlopen(req, timeout=POST_TIMEOUT) as r:
        return r.status, r.read(200).decode('utf-8', 'replace')


def main():
    now = time.time()
    if not in_window(now) and '--force' not in sys.argv:
        log('outside US hours; nothing to do')
        return 0
    key = os.environ.get('INSIGHTSENTRY_WEBSOCKET_API_KEY')
    url, secret = os.environ.get('BOOK_RECORDER_URL', '').rstrip('/'), os.environ.get('BOOK_INGEST_SECRET', '')
    if not key or not url or not secret:
        log('missing env (IS key / recorder url / ingest secret)')
        return 2
    t0 = time.time()
    try:
        stocks, etfs, crypto = pull(key)
    except urllib.error.HTTPError as e:
        log('IS HTTP %s %s' % (e.code, e.read(200).decode('utf-8', 'replace')))
        return 1
    except Exception as e:
        log('IS error %s' % type(e).__name__)
        return 1
    ps = parts(stocks, etfs, crypto, now)
    big = [k for k, b in ps.items() if len(b) > MAX_BODY]
    if big:
        log('part too big: %s' % big)
        return 1
    if '--dry' in sys.argv:
        log('dry: %d stocks %d etfs %d crypto, parts %s' % (len(stocks), len(etfs), len(crypto), {k: len(b) for k, b in ps.items()}))
        return 0
    res = []
    # presets last: a visitor never sees presets newer than the tables behind them
    for k in ('stock', 'etf', 'crypto', 'presets'):
        try:
            st, txt = post(url, secret, k, ps[k])
            res.append('%s %s %s' % (k, st, txt.strip()))
        except urllib.error.HTTPError as e:
            res.append('%s HTTP %s %s' % (k, e.code, e.read(120).decode('utf-8', 'replace')))
        except Exception as e:
            res.append('%s error %s' % (k, type(e).__name__))
    log('%d stocks %d etfs %d crypto | %s | %d B | 4 IS calls %.1fs' % (len(stocks), len(etfs), len(crypto), '; '.join(res),
        sum(len(b) for b in ps.values()), time.time() - t0))
    if any(' 200 ' not in r + ' ' for r in res):
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
