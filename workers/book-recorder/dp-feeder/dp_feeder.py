#!/usr/bin/env python3
"""TradeZoro dark pool prints feeder: InsightSentry SIP trades -> off-exchange block prints -> book recorder Worker.

Owner order 2026-11-07 ("Dark pool prints on tz"). Data check: reports/workers/darkpool.md (DATA CHECK).
WHAT: GET /v3/symbols/{code}/trades returns every SIP trade of the New York session with its venue (trade_exchange). Trades
reported to a FINRA facility (trade_exchange "FINRA_ADF" = SIP participant "D", the TRF/ADF) are off-exchange prints. This feeder
keeps only those with price x size >= MIN_USD, merges them into a small state file (last KEEP_DAYS New York dates) and POSTs one gzip
JSON part per symbol: /scan-ingest?part=dp_<sym> (src/scan.js validateDarkPool). The browser reads GET /scan?part=dp_<sym>.
IS budget: 1 call per symbol per run with window=3h (gzip, ~100 KB for SPY). A day not yet stored (first run, or a gap > 2.5 h) is
fetched whole once (date=YYYY-MM-DD, tens of MB gzip for SPY), filtered while streaming so memory stays small. Timer every 2 h on
weekdays: 29 symbols x 10 runs = 290 calls a day, hard cap DAILY_CAP. Not streaming: the chart says "updated X min ago".
Env: INSIGHTSENTRY_WEBSOCKET_API_KEY, BOOK_RECORDER_URL, BOOK_INGEST_SECRET (never printed). --dry: no POST.
"""
import atexit, gzip, json, os, sys, time, urllib.parse, urllib.request, zlib
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

IS = 'https://api.insightsentry.com/v3'
NY = ZoneInfo('America/New_York')
# same list as info-feeder (stocks + ETFs we carry symbol info for); chart ticker = part after the colon
STOCKS = ['NASDAQ:AAPL', 'NASDAQ:MSFT', 'NASDAQ:NVDA', 'NASDAQ:AMZN', 'NASDAQ:GOOGL', 'NASDAQ:META', 'NASDAQ:TSLA',
          'NASDAQ:AVGO', 'NASDAQ:NFLX', 'NASDAQ:AMD', 'NYSE:JPM', 'NYSE:V', 'NASDAQ:WMT', 'NYSE:XOM', 'NYSE:LLY',
          'NYSE:BAC', 'NYSE:DIS', 'NASDAQ:COST', 'NASDAQ:INTC', 'NASDAQ:PLTR', 'NYSE:BA', 'NASDAQ:COIN', 'NASDAQ:MSTR',
          'AMEX:SPY', 'NASDAQ:QQQ', 'AMEX:IWM', 'AMEX:DIA', 'AMEX:GLD', 'NASDAQ:TQQQ']
OFFEX = 'FINRA_ADF'
MIN_USD = 1_000_000
KEEP_DAYS = 5
MAX_ROWS = 20000          # per symbol part (scan.js DP_MAX_ROWS)
# hard cap on InsightSentry calls per New York day (state['_calls']); normal weekday = 29 symbols x 10 runs = 290.
# Over the cap the run skips fetching (the stored part stays) and logs it. Fits the 120,000/month plan: see darkpool.md.
DAILY_CAP = int(os.environ.get('DP_DAILY_CAP', '320'))
STATE = os.path.join(os.environ.get('STATE_DIRECTORY', os.path.dirname(os.path.abspath(__file__))), 'dp-state.json')

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
        pass


atexit.register(note_is, 'dp')


def log(m):
    print(time.strftime('%H:%M:%S ') + m, flush=True)


# ---- pure ---------------------------------------------------------------------------------------
def iter_objects(chunks):
    """Yield the text of each flat {...} object inside the "series" array of a streamed /trades reply.
    Rows are flat apart from the trade_conditions list (no braces in any value), so a brace scan is enough."""
    buf, started = '', False
    for c in chunks:
        buf += c
        if not started:
            i = buf.find('"series"')
            if i < 0:
                buf = buf[-16:]
                continue
            j = buf.find('[', i)
            if j < 0:
                continue
            buf, started = buf[j + 1:], True
        pos = 0
        while True:
            a = buf.find('{', pos)
            if a < 0:
                buf = ''
                break
            b = buf.find('}', a)
            if b < 0:
                buf = buf[a:]
                break
            yield buf[a:b + 1]
            pos = b + 1


def keep_row(o, min_usd=MIN_USD):
    """A parsed trade -> [t_ms, price, shares, conds, id] when it is an off-exchange print >= min_usd, else None."""
    if o.get('trade_exchange') != OFFEX:
        return None
    p, s = o.get('close'), o.get('volume')
    if not isinstance(p, (int, float)) or not isinstance(s, (int, float)) or p <= 0 or s <= 0 or p * s < min_usd:
        return None
    t = o.get('us')
    t_ms = int(t // 1000) if isinstance(t, (int, float)) else int(round(float(o.get('time', 0)) * 1000))
    conds = ''.join(c for c in (o.get('trade_conditions') or []) if isinstance(c, str) and c.strip())[:8]
    rid = str(o.get('trade_id', '')) + ':' + str(t if t is not None else t_ms)
    return [t_ms, round(float(p), 4), int(s), conds, rid]


def filter_stream(chunks, min_usd=MIN_USD):
    """Streamed reply text chunks -> (kept rows, trades seen). Only rows naming the venue are json-parsed."""
    out, n = [], 0
    for txt in iter_objects(chunks):
        n += 1
        if OFFEX not in txt:
            continue
        try:
            r = keep_row(json.loads(txt), min_usd)
        except ValueError:
            continue
        if r:
            out.append(r)
    return out, n


def ny_date(t_ms):
    return datetime.fromtimestamp(t_ms / 1000, NY).strftime('%Y-%m-%d')


def merge(st, rows, keep_dates):
    """Add rows to a symbol state {'rows': {id: row}}; drop rows outside keep_dates. Returns the number added."""
    have = st.setdefault('rows', {})
    added = 0
    for r in rows:
        if r[4] not in have:
            have[r[4]] = r[:4]
            added += 1
    for k in [k for k, r in have.items() if ny_date(r[0]) not in keep_dates]:
        del have[k]
    return added


def part_body(sym, code, st, now_s):
    rows = sorted(st.get('rows', {}).values(), key=lambda r: r[0])[-MAX_ROWS:]
    d = {'v': 1, 't': int(now_s), 'sym': sym, 'code': code, 'min': MIN_USD, 'days': sorted(st.get('done', []))[-KEEP_DAYS:],
         'cols': ['t', 'p', 's', 'c'], 'rows': rows}
    return gzip.compress(json.dumps(d, separators=(',', ':')).encode(), 9)


def session_dates(now_ny, n=KEEP_DAYS):
    """The last n weekdays (New York dates, newest first) up to today; holidays come back empty and are simply stored as done."""
    out, d = [], now_ny.date()
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.strftime('%Y-%m-%d'))
        d -= timedelta(days=1)
    return out


# ---- io -----------------------------------------------------------------------------------------
def fetch_rows(code, key, params):
    IS_CALLS[0] += 1
    url = IS + '/symbols/' + urllib.parse.quote(code, safe=':!') + '/trades?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + key, 'Accept-Encoding': 'gzip', 'User-Agent': 'tradezoro-dp-feeder/1'})
    with urllib.request.urlopen(req, timeout=600) as r:
        gz = r.headers.get('Content-Encoding') == 'gzip'
        dz = zlib.decompressobj(16 + zlib.MAX_WBITS) if gz else None

        def chunks():
            while True:
                c = r.read(1 << 20)
                if not c:
                    break
                yield (dz.decompress(c) if dz else c).decode('utf-8', 'replace')
        return filter_stream(chunks())


def post(url, secret, part, body):
    req = urllib.request.Request(url.rstrip('/') + '/scan-ingest?part=' + part, data=body, method='POST',
                                 headers={'content-type': 'application/octet-stream', 'x-ingest-key': secret, 'user-agent': 'tradezoro-dp-feeder/1'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read()[:60].decode()


def main():
    key, url, secret = os.environ.get('INSIGHTSENTRY_WEBSOCKET_API_KEY'), os.environ.get('BOOK_RECORDER_URL'), os.environ.get('BOOK_INGEST_SECRET')
    if not key:
        sys.exit('missing key')
    dry = '--dry' in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith('--')]
    try:
        state = json.load(open(STATE))
    except (OSError, ValueError):
        state = {}
    now = time.time()
    now_ny = datetime.fromtimestamp(now, NY)
    dates = session_dates(now_ny)
    today = now_ny.strftime('%Y-%m-%d')
    in_session = now_ny.weekday() < 5 and 4 <= now_ny.hour < 21
    calls = state.setdefault('_calls', {})
    if calls.get('day') != today:
        calls.clear(); calls.update(day=today, n=0)

    def budget():
        if calls['n'] >= DAILY_CAP:
            raise RuntimeError('daily call cap %d reached' % DAILY_CAP)
        calls['n'] += 1

    for code in STOCKS:
        sym = code.split(':')[1]
        if only and sym not in only:
            continue
        st = state.setdefault(sym, {})
        done = set(d for d in st.get('done', []) if d in dates)
        try:
            # past sessions not stored yet: whole day once
            for d in dates:
                if d == today or d in done:
                    continue
                budget()
                rows, n = fetch_rows(code, key, {'date': d})
                merge(st, rows, set(dates)); done.add(d)
                log('%s %s full day: %d trades, %d prints >= $1M' % (sym, d, n, len(rows)))
            # before 04:00 NY "today" would return the previous session; weekends: nothing new
            if today in dates and (in_session or (now_ny.hour >= 21 and today not in done)):
                recent = (now - st.get('last', 0)) < 2.5 * 3600 and st.get('lastDay') == today
                budget()
                rows, n = fetch_rows(code, key, {'window': '3h'} if recent else {'date': today})
                merge(st, rows, set(dates))
                st['last'], st['lastDay'] = now, today
                if not in_session and today in dates:
                    done.add(today)   # session over: today is complete
                log('%s %s: %d trades, %d prints' % (sym, 'window 3h' if recent else 'today', n, len(rows)))
        except Exception as e:
            log('%s failed: %s' % (sym, str(e)[:120]))
            continue
        finally:
            st['done'] = sorted(done)
        body = part_body(sym, code, st, now)
        if dry or not (url and secret):
            log('%s: %d rows, %d B gzip (dry)' % (sym, len(st.get('rows', {})), len(body)))
            continue
        try:
            log('%s ingest -> %s %s' % ((sym,) + post(url, secret, 'dp_' + sym.lower(), body)))
        except Exception as e:
            log('%s ingest failed: %s' % (sym, str(e)[:120]))
    tmp = STATE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(state, f, separators=(',', ':'))
    os.replace(tmp, STATE)


if __name__ == '__main__':
    main()
