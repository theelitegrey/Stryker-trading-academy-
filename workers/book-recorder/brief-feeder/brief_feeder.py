#!/usr/bin/env python3
"""TradeZoro terminal files feeder: InsightSentry -> market-brief / market-map / econ-calendar JSON.

WHY: assets/market-brief.json, assets/market-map.json and assets/econ-calendar.json were rebuilt
once a day by an agent session (claude.ai Routine + Bigdata.com connector) that committed them to
main. It stopped after 2026-10-09 and the pages showed a five-day-old board. This feeder replaces
it on our own server, with no third-party agent: every number comes from InsightSentry (the same
licence the news / options feeders use) and every sentence of prose is built from those numbers by
fixed templates in this file. No paid language model is called.

Schedule (systemd brief-feeder.timer, every 15 min; this script decides what each tick does):
  FULL   weekdays from 05:30 UTC, once per UTC day (and on the first run ever): rebuild all three
         files from fresh daily series (one /v3/symbols/{code}/series call per instrument, ~125),
         POST them to the recorder Worker (/terminal-ingest) and commit them to main as the
         fallback copy (one commit a day, only the three JSON files, no build bump needed).
  MAP    weekdays 13:30-20:30 UTC (the US session in either DST state): refresh the map's numbers
         from /v3/symbols/quotes (10 codes per call, ~13 calls) on top of the cached daily series,
         and re-render the brief's figures with them. Posted to the Worker only.
  CAL    every tick: rebuild econ-calendar.json from the Worker's /cal store (the news feeder
         keeps InsightSentry's calendar there, refreshed every 15 min), so actuals appear as they
         print. Posted to the Worker only.

Publishing: the Worker serves GET /terminal/<name>.json (edge-cached 60 s); the pages read that
first and fall back to the committed assets/<name>.json. GET /terminal/health answers 503 when any
file is past its goodUntil (the site health monitor polls it).

goodUntil: always the next FULL run plus a 90-minute grace (Mon-Thu: next day 07:00 UTC; Friday
and the weekend: Monday 07:00 UTC). A missed run therefore turns the pages' honest "not refreshed"
banner on within 90 minutes, and a healthy feeder never shows it.

Optional written prose: if PROSE_FILE (default /var/lib/brief-feeder/prose.json) exists and its
"sessionDate" equals the brief's, its headline / standfirst / sessionNote / watchOut (strings)
replace the template ones. Numbers in the bullets, map and calendar always stay template-built.

Config (env): INSIGHTSENTRY_WEBSOCKET_API_KEY (chief-of-staff insightsentry.env), BOOK_RECORDER_URL
and BOOK_INGEST_SECRET (/root/projects/book-feeder/feeder.env). Nothing secret is ever logged.
Commit: uses the server's `gh` login (gh api, contents endpoint); BRIEF_COMMIT=0 disables it.
Stdlib only. Memory: closes only (no OHLC kept), ~125 x 400 floats; RSS ~30 MB.

CLI: brief_feeder.py [--full|--map|--cal] [--no-post] [--no-commit] [--out DIR]
"""
import base64
import gzip
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

IS = 'https://api.insightsentry.com/v3'
UA = 'tradezoro-brief-feeder/1'
ET = ZoneInfo('America/New_York')
UTC = timezone.utc
STATE_DIR = os.environ.get('STATE_DIRECTORY', '/var/lib/brief-feeder')
PROSE_FILE = os.environ.get('PROSE_FILE', os.path.join(STATE_DIR, 'prose.json'))
REPO = 'theelitegrey/Stryker-trading-academy-'
SITE = 'https://strykertrading.com'
FULL_AT = (5, 30)          # UTC
GRACE_MIN = 90
MINUS = '\u2212'
PERIODS = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y']
NAMES = ['market-brief', 'market-map', 'econ-calendar']


def log(msg):
    print(msg, flush=True)


# ------------------------------------------------------------------ instruments (tools/market-map.md)
# (label, ticker shown on the page, InsightSentry code). The page keeps the same rows and tickers as
# the hand-built map so a returning reader sees the same board.
GROUPS = [
    {'id': 'regions', 'title': 'Equities by country', 'scale': 1.0, 'rows': [
        ('United States', 'SPY', 'AMEX:SPY'), ('Canada', 'EWC', 'AMEX:EWC'), ('Mexico', 'EWW', 'AMEX:EWW'),
        ('Brazil', 'EWZ', 'AMEX:EWZ'), ('Argentina', 'ARGT', 'AMEX:ARGT'), ('United Kingdom', 'EWU', 'AMEX:EWU'),
        ('Germany', 'EWG', 'AMEX:EWG'), ('France', 'EWQ', 'AMEX:EWQ'), ('Italy', 'EWI', 'AMEX:EWI'),
        ('Spain', 'EWP', 'AMEX:EWP'), ('Netherlands', 'EWN', 'AMEX:EWN'), ('Switzerland', 'EWL', 'AMEX:EWL'),
        ('Poland', 'EPOL', 'AMEX:EPOL'), ('Japan', 'EWJ', 'AMEX:EWJ'), ('China', 'MCHI', 'NASDAQ:MCHI'),
        ('Hong Kong', 'EWH', 'AMEX:EWH'), ('South Korea', 'EWY', 'AMEX:EWY'), ('Taiwan', 'EWT', 'AMEX:EWT'),
        ('India', 'INDA', 'CBOE:INDA'), ('Australia', 'EWA', 'AMEX:EWA'), ('Singapore', 'EWS', 'AMEX:EWS'),
        ('Indonesia', 'EIDO', 'AMEX:EIDO'), ('South Africa', 'EZA', 'AMEX:EZA'), ('Turkey', 'TUR', 'NASDAQ:TUR'),
        ('Emerging Markets', 'EEM', 'AMEX:EEM'), ('Developed ex-US', 'EFA', 'AMEX:EFA')]},
    {'id': 'sectors', 'title': 'US sectors', 'scale': 1.0, 'rows': [
        ('Energy', 'XLE', 'AMEX:XLE'), ('Technology', 'XLK', 'AMEX:XLK'), ('Industrials', 'XLI', 'AMEX:XLI'),
        ('Materials', 'XLB', 'AMEX:XLB'), ('Real Estate', 'XLRE', 'AMEX:XLRE'), ('Consumer Staples', 'XLP', 'AMEX:XLP'),
        ('Health Care', 'XLV', 'AMEX:XLV'), ('Financials', 'XLF', 'AMEX:XLF'), ('Utilities', 'XLU', 'AMEX:XLU'),
        ('Communication Services', 'XLC', 'AMEX:XLC'), ('Consumer Discretionary', 'XLY', 'AMEX:XLY')]},
    {'id': 'bonds', 'title': 'Bonds and credit', 'scale': 0.45, 'rows': [
        ('1-3Y Treasury', 'SHY', 'NASDAQ:SHY'), ('3-7Y Treasury', 'IEI', 'NASDAQ:IEI'), ('7-10Y Treasury', 'IEF', 'NASDAQ:IEF'),
        ('20Y+ Treasury', 'TLT', 'NASDAQ:TLT'), ('TIPS', 'TIP', 'AMEX:TIP'), ('Mortgage-backed', 'MBB', 'NASDAQ:MBB'),
        ('Municipals', 'MUB', 'AMEX:MUB'), ('US Aggregate', 'AGG', 'AMEX:AGG'), ('Investment grade', 'LQD', 'AMEX:LQD'),
        ('High yield', 'HYG', 'AMEX:HYG'), ('Senior loans', 'BKLN', 'AMEX:BKLN'), ('EM sovereign (USD)', 'EMB', 'NASDAQ:EMB')]},
    {'id': 'commodities', 'title': 'Commodities', 'scale': 1.8, 'rows': [
        ('WTI crude', 'CLUSD', 'NYMEX:CL1!'), ('Brent crude', 'BZUSD', 'NYMEX:BZ1!'), ('Heating oil', 'HOUSD', 'NYMEX:HO1!'),
        ('Gasoline', 'RBUSD', 'NYMEX:RB1!'), ('Natural gas', 'NGUSD', 'NYMEX:NG1!'), ('Gold', 'GCUSD', 'COMEX:GC1!'),
        ('Silver', 'SIUSD', 'COMEX:SI1!'), ('Platinum', 'PLUSD', 'NYMEX:PL1!'), ('Copper', 'HGUSD', 'COMEX:HG1!'),
        ('Aluminium', 'ALIUSD', 'COMEX:ALI1!'), ('Corn', 'ZCUSX', 'CBOT:ZC1!'), ('Wheat', 'KEUSX', 'CBOT:KE1!'),
        ('Soybeans', 'ZSUSX', 'CBOT:ZS1!'), ('Sugar', 'SBUSX', 'ICEUS:SB1!'), ('Coffee', 'KCUSX', 'ICEUS:KC1!'),
        ('Cocoa', 'CCUSD', 'ICEUS:CC1!'), ('Cotton', 'CTUSX', 'ICEUS:CT1!'), ('Lean hogs', 'HEUSX', 'CME:HE1!')]},
    {'id': 'fx', 'title': 'Currencies', 'scale': 0.22, 'rows': [
        ('EUR/USD', 'EURUSD', 'FX:EURUSD'), ('GBP/USD', 'GBPUSD', 'FX:GBPUSD'), ('AUD/USD', 'AUDUSD', 'FX:AUDUSD'),
        ('NZD/USD', 'NZDUSD', 'FX:NZDUSD'), ('USD/JPY', 'USDJPY', 'FX:USDJPY'), ('USD/CHF', 'USDCHF', 'FX:USDCHF'),
        ('USD/CAD', 'USDCAD', 'FX:USDCAD'), ('USD/CNY', 'USDCNY', 'FX_IDC:USDCNY'), ('USD/INR', 'USDINR', 'FX_IDC:USDINR'),
        ('USD/KRW', 'USDKRW', 'FX_IDC:USDKRW'), ('USD/MXN', 'USDMXN', 'FX:USDMXN'), ('USD/BRL', 'USDBRL', 'FX_IDC:USDBRL'),
        ('USD/TRY', 'USDTRY', 'FX:USDTRY'), ('USD/ZAR', 'USDZAR', 'FX:USDZAR')]},
    {'id': 'crypto', 'title': 'Crypto', 'scale': 3.5, 'rows': [
        ('Bitcoin', 'BTCUSD', 'COINBASE:BTCUSD'), ('Ethereum', 'ETHUSD', 'COINBASE:ETHUSD'), ('Solana', 'SOLUSD', 'COINBASE:SOLUSD'),
        ('BNB', 'BNBUSD', 'BINANCE:BNBUSDT'), ('XRP', 'XRPUSD', 'COINBASE:XRPUSD'), ('Chainlink', 'LINKUSD', 'COINBASE:LINKUSD'),
        ('Cardano', 'ADAUSD', 'COINBASE:ADAUSD'), ('Dogecoin', 'DOGEUSD', 'COINBASE:DOGEUSD'), ('Litecoin', 'LTCUSD', 'COINBASE:LTCUSD')]},
    {'id': 'factors', 'title': 'Factors, against the S&P 500', 'scale': 0.7, 'excess': True, 'rows': [
        ('Value', 'IWD', 'AMEX:IWD'), ('Growth', 'IWF', 'AMEX:IWF'), ('Momentum', 'MTUM', 'CBOE:MTUM'),
        ('Small-cap', 'IJR', 'AMEX:IJR'), ('Small-cap value', 'IWN', 'AMEX:IWN'), ('Small-cap growth', 'IWO', 'AMEX:IWO'),
        ('Mid-cap core', 'IJH', 'AMEX:IJH'), ('Low volatility', 'USMV', 'CBOE:USMV'), ('High dividend', 'VYM', 'AMEX:VYM'),
        ('Quality', 'QUAL', 'CBOE:QUAL'), ('Buybacks', 'PKW', 'NASDAQ:PKW'), ('Recent IPOs', 'IPO', 'AMEX:IPO'),
        ('Private equity', 'PSP', 'AMEX:PSP')]},
]
# bills: the ...MY codes are the yields (IS:US01M etc. are bill prices)
CURVE = [('1M', 0.083, 'IS:US01MY'), ('3M', 0.25, 'IS:US03MY'), ('6M', 0.5, 'IS:US06MY'), ('1Y', 1, 'IS:US01Y'),
         ('2Y', 2, 'IS:US02Y'), ('3Y', 3, 'IS:US03Y'), ('5Y', 5, 'IS:US05Y'), ('7Y', 7, 'IS:US07Y'),
         ('10Y', 10, 'IS:US10Y'), ('20Y', 20, 'IS:US20Y'), ('30Y', 30, 'IS:US30Y')]
# brief-only instruments (index levels, volatility, the dollar index)
EXTRA = {'SPX': 'CBOE:SPX', 'NDX': 'NASDAQ:NDX', 'DJI': 'DJ:DJI', 'RUT': 'IS:RUT', 'VIX': 'CBOE:VIX', 'DXY': 'IS:DXY'}
US_EQ = re.compile(r'^(AMEX|NASDAQ|NYSE|CBOE|DJ):')   # regular-session instruments (no pre-market bars)


def all_codes():
    out = []
    for g in GROUPS:
        out += [r[2] for r in g['rows']]
    out += [c[2] for c in CURVE] + list(EXTRA.values())
    return list(dict.fromkeys(out))




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
atexit.register(note_is, 'brief')


# ------------------------------------------------------------------ IO
def env_need():
    key = os.environ.get('INSIGHTSENTRY_WEBSOCKET_API_KEY') or os.environ.get('INSIGHTSENTRY_API_KEY') or ''
    rec = (os.environ.get('BOOK_RECORDER_URL') or '').rstrip('/')
    sec = os.environ.get('BOOK_INGEST_SECRET') or ''
    return key, rec, sec


def http_json(url, headers=None, data=None, timeout=40):
    h = {'User-Agent': UA, 'Accept': 'application/json', 'Accept-Encoding': 'gzip'}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h, data=data, method='POST' if data is not None else 'GET')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            raw = gzip.decompress(raw)
    return json.loads(raw)


def is_get(path, key, params=None):
    url = IS + path + ('?' + urllib.parse.urlencode(params, safe=':,!') if params else '')
    for attempt in range(3):
        try:
            IS_CALLS[0] += 1
            return http_json(url, {'Authorization': 'Bearer ' + key})
        except urllib.error.HTTPError as e:
            if (e.code == 429 or e.code >= 500) and attempt < 2:
                time.sleep(3 + 4 * attempt)
                continue
            raise RuntimeError('InsightSentry HTTP %d on %s' % (e.code, path.split('?')[0]))


def rec_get(rec, path):
    return http_json(rec + path, {'Origin': SITE})


def rec_post(rec, sec, name, obj):
    body = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    req = urllib.request.Request(rec + '/terminal-ingest?name=' + name, data=body, method='POST',
                                 headers={'content-type': 'application/json', 'x-ingest-key': sec, 'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()[:120].decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        raise RuntimeError('terminal-ingest %s HTTP %d: %s' % (name, e.code, e.read()[:200].decode('utf-8', 'replace')))


def read_json(p, default=None):
    try:
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(p, obj):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p + '.tmp', 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(p + '.tmp', p)


# ------------------------------------------------------------------ maths (pure, unit-tested)
def fnum(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def bars_from_series(series):
    """[(epoch_s, close)] sorted, finite closes only."""
    out = []
    for b in series or []:
        t, c = fnum(b.get('time')), fnum(b.get('close'))
        if t and c is not None:
            out.append((int(t), c))
    out.sort()
    return out


def merge_quote(bars, quote, code, now):
    """Put the live quote on top of the daily closes: same daily bar -> replace its close, a newer
    day -> append. US cash instruments only take the quote while their session is OPEN (a
    pre-market print is not a close)."""
    if not bars or not quote:
        return bars
    px, lt = fnum(quote.get('last_price')), fnum(quote.get('lp_time'))
    if px is None or not lt or lt > now + 120:
        return bars
    if US_EQ.match(code) and quote.get('status') != 'OPEN':
        return bars
    out = list(bars)
    if lt >= out[-1][0] + 86400:
        out.append((int(lt), px))
    elif lt >= out[-1][0]:
        out[-1] = (out[-1][0], px)
    return out


def drop_premarket_bar(bars, code, now):
    """A US cash instrument's bar for today (ET) before 09:30 ET carries no regular-session trade."""
    if not bars or not US_EQ.match(code):
        return bars
    n = datetime.fromtimestamp(now, ET)
    last = datetime.fromtimestamp(bars[-1][0], UTC).astimezone(ET)
    if last.date() == n.date() and (n.hour * 60 + n.minute) < 9 * 60 + 30:
        return bars[:-1]
    return bars


def bar_day(t):
    """Trading day a daily bar belongs to. InsightSentry stamps day bars at the session start in
    UTC (e.g. 04:00Z for US cash, 22:00Z the previous evening for CME futures, 23:00Z for yields), so
    the day is the UTC date of the stamp shifted forward by 6 h."""
    return datetime.fromtimestamp(t + 6 * 3600, UTC).date()


def months_back(d, n):
    y, m = d.year, d.month - n
    while m <= 0:
        m += 12
        y -= 1
    last = [31, 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return date(y, m, min(d.day, last))


def ref_close(bars, period):
    """Close the period's return is measured from, or None when the history does not reach."""
    if len(bars) < 2:
        return None
    if period == '1D':
        return bars[-2][1]
    if period == '5D':
        return bars[-6][1] if len(bars) >= 6 else None
    d = bar_day(bars[-1][0])
    if period == 'YTD':
        cut = date(d.year - 1, 12, 31)
    else:
        cut = months_back(d, {'1M': 1, '3M': 3, '6M': 6, '1Y': 12}[period])
    best = None
    for t, c in bars[:-1]:
        if bar_day(t) <= cut:
            best = c
        else:
            break
    return best


def returns(bars):
    out = []
    for p in PERIODS:
        r = ref_close(bars, p)
        out.append(round((bars[-1][1] / r - 1) * 100, 2) if r and bars else None)
    return out


def rnd_price(p):
    if p is None:
        return None
    a = abs(p)
    return round(p, 2 if a >= 10 else 4 if a >= 0.1 else 6)


# ------------------------------------------------------------------ time rules
def next_full_run(now_dt):
    """The next FULL run strictly after now (weekdays 05:30 UTC)."""
    d = now_dt.date()
    for i in range(0, 8):
        day = d + timedelta(days=i)
        at = datetime(day.year, day.month, day.day, FULL_AT[0], FULL_AT[1], tzinfo=UTC)
        if day.weekday() < 5 and at > now_dt:
            return at
    raise AssertionError('unreachable')


def good_until(now_dt):
    return next_full_run(now_dt) + timedelta(minutes=GRACE_MIN)


def iso(dt):
    return dt.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def session_date(now_dt):
    """The US cash session the brief is for: today (ET) until 16:00 ET on a weekday, else the next weekday."""
    n = now_dt.astimezone(ET)
    d = n.date()
    if n.weekday() < 5 and n.hour < 16:
        return d
    d += timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def us_session_open(now_dt):
    n = now_dt.astimezone(ET)
    m = n.hour * 60 + n.minute
    return n.weekday() < 5 and 9 * 60 + 30 <= m < 16 * 60


def fmt_day(d):
    return d.strftime('%a ') + str(d.day) + d.strftime(' %b')


# ------------------------------------------------------------------ text helpers
def sp(v, k=2):
    """Signed percent with a real minus sign: +1.23%, \u22120.45%."""
    if v is None:
        return 'n/a'
    s = ('%.' + str(k) + 'f') % abs(v)
    return ('+' if v > 0 else MINUS if v < 0 else '') + s + '%'


def sbp(v):
    if v is None:
        return 'n/a'
    r = int(round(v))
    return ('+' if r > 0 else MINUS if r < 0 else '') + str(abs(r)) + 'bp'


def lvl(p):
    if p is None:
        return 'n/a'
    if abs(p) >= 1000:
        return '{:,.2f}'.format(p)
    if abs(p) >= 10:
        return '%.2f' % p
    return ('%.4f' % p).rstrip('0').rstrip('.')


def word_move(v, up='rose', down='fell', flat='was flat'):
    if v is None:
        return 'is unpriced'
    if abs(v) < 0.005:
        return flat
    return up if v > 0 else down


# ------------------------------------------------------------------ data load
def load_series(key, cache_path, fresh):
    """Daily closes for every instrument, cached in the state dir (refetched on FULL runs or when the
    cache is older than 20 h)."""
    cache = read_json(cache_path, {}) if not fresh else {}
    if cache.get('at') and time.time() - cache['at'] < 20 * 3600 and cache.get('bars'):
        return cache['bars'], cache['at']
    bars, bad = {}, []
    for code in all_codes():
        try:
            # continuous futures come back-adjusted by default, which breaks percentage returns over
            # months (WTI read +127% YTD); badj=false gives the actual front-month prices
            params = {'bar_type': 'day', 'dp': 400}
            if code.endswith('!'):
                params['badj'] = 'false'
            j = is_get('/symbols/' + code + '/series', key, params)
            b = bars_from_series(j.get('series'))
            if b:
                bars[code] = b
            else:
                bad.append(code)
        except Exception as e:  # one bad instrument must not sink the board
            bad.append(code + ' (' + str(e)[:60] + ')')
    if bad:
        log('series missing: ' + ', '.join(bad))
    if len(bars) < len(all_codes()) * 0.8:
        raise RuntimeError('only %d of %d series loaded' % (len(bars), len(all_codes())))
    at = time.time()
    write_json(cache_path, {'at': at, 'bars': bars})
    return bars, at


def load_quotes(key):
    codes, out = all_codes(), {}
    for i in range(0, len(codes), 10):
        try:
            j = is_get('/symbols/quotes', key, {'codes': ','.join(codes[i:i + 10])})
        except Exception as e:
            log('quotes: ' + str(e)[:120])
            continue
        for q in j.get('data') or []:
            if q.get('code') and q.get('last_price') is not None and not q.get('error'):
                out[q['code']] = q
    return out


def board(bars_by_code, quotes, now):
    """code -> {'bars', 'v' (7 returns), 'price', 't' (as-of epoch)}"""
    out = {}
    for code, raw in bars_by_code.items():
        b = drop_premarket_bar([tuple(x) for x in raw], code, now)
        b = merge_quote(b, quotes.get(code), code, now)
        if len(b) < 2:
            continue
        q = quotes.get(code)
        used_q = q and fnum(q.get('lp_time')) and b[-1][1] == fnum(q.get('last_price')) and (not US_EQ.match(code) or q.get('status') == 'OPEN')
        out[code] = {'bars': b, 'v': returns(b), 'price': b[-1][1], 't': int(fnum(q.get('lp_time'))) if used_q else None,
                     'day': bar_day(b[-1][0]), 'live': bool(used_q)}
    return out


# ------------------------------------------------------------------ market map
def build_map(B, now_dt, prev):
    groups = []
    spy = B.get('AMEX:SPY')
    for g in GROUPS:
        rows = []
        for label, ticker, code in g['rows']:
            x = B.get(code)
            if not x:
                rows.append({'label': label, 'ticker': ticker, 'price': None, 'v': [None] * 7})
                continue
            v = list(x['v'])
            if g.get('excess'):
                v = [None if (a is None or not spy or spy['v'][i] is None) else round(a - spy['v'][i], 2) for i, a in enumerate(v)]
            rows.append({'label': label, 'ticker': ticker, 'price': rnd_price(x['price']), 'v': v})
        gg = {'id': g['id'], 'title': g['title'], 'scale': g['scale'], 'note': group_note(g, rows)}
        if g.get('excess'):
            gg['excess'] = True
        gg['rows'] = rows
        groups.append(gg)
    curve = build_curve(B)
    gen = iso(now_dt)
    m = {
        '_comment': 'Cross-asset market map. Built on our server by brief-feeder (workers/book-recorder/brief-feeder) from InsightSentry prices and served by the recorder Worker (/terminal/market-map.json); this committed copy is the fallback. See tools/market-map.md. Values are percentage returns over each period; factor rows are excess returns against the S&P 500 fund (SPY).',
        'schema': 1, 'generatedAt': gen, 'goodUntil': iso(good_until(now_dt)), 'asOf': as_of(B, now_dt),
        'staleAfterHours': 30, 'periods': PERIODS, 'defaultPeriod': '1D',
        'read': build_read(B, groups, curve, now_dt), 'curve': curve, 'groups': groups,
        'sources': [{'name': 'InsightSentry', 'note': 'prices, daily closes and period returns across all eight asset classes, and the Treasury yield curve'}],
        'attribution': 'Market data from InsightSentry (https://insightsentry.com). The reading of it is generated from the numbers by fixed rules.',
        'disclaimer': 'Educational context, not trading advice. These are period returns to the latest print, not live quotes — confirm against your own data before acting.',
    }
    return m


def group_note(g, rows):
    vals = [(r['v'][0], r['label']) for r in rows if r['v'][0] is not None]
    wk = [(r['v'][1], r['label']) for r in rows if r['v'][1] is not None]
    if not vals:
        return 'No prices were available for this group on this run.'
    hi, lo = max(vals), min(vals)
    up = sum(1 for v, _ in vals if v > 0)
    kind = 'excess return against the S&P 500 fund' if g.get('excess') else 'return'
    s = '%d of %d %s on the day (%s). Strongest: %s %s; weakest: %s %s.' % (
        up, len(vals), 'beat the S&P 500 fund' if g.get('excess') else 'up', kind, hi[1], sp(hi[0]), lo[1], sp(lo[0]))
    if wk:
        whi, wlo = max(wk), min(wk)
        s += ' Over five sessions: %s %s at the top, %s %s at the bottom.' % (whi[1], sp(whi[0]), wlo[1], sp(wlo[0]))
    return s


def build_curve(B):
    pts = []
    for label, yrs, code in CURVE:
        x = B.get(code)
        if not x:
            continue
        r1m = ref_close(x['bars'], '1M')
        pts.append({'label': label, 'years': yrs, 'yield': round(x['price'], 3),
                    'chg1M': round((x['price'] / r1m - 1) * 100, 2) if r1m else 0})

    def y(code, back=0):
        x = B.get(code)
        if not x or len(x['bars']) <= back:
            return None
        return x['bars'][-1 - back][1]

    def spread(a, b, label, what):
        now = [y(a), y(b)]
        if None in now:
            return None
        v = round((now[1] - now[0]) * 100)
        wk = [y(a, 5), y(b, 5)]
        mo_a, mo_b = ref_close(B[a]['bars'], '1M'), ref_close(B[b]['bars'], '1M')
        parts = ['%dbp' % v]
        if None not in wk:
            parts.append('from %dbp five sessions ago' % round((wk[1] - wk[0]) * 100))
        if mo_a and mo_b:
            parts.append('and %dbp a month ago' % round((mo_b - mo_a) * 100))
        note = (', '.join(parts[:2]) + (' ' + parts[2] if len(parts) > 2 else '')).replace('-', MINUS) + '. ' + what
        return {'label': label, 'value': v, 'unit': 'bp', 'note': note}

    spreads = [s for s in [
        spread('IS:US02Y', 'IS:US10Y', '2s10s', 'The gap between the ten-year and the two-year: the rate-cycle end of the curve.'),
        spread('IS:US03MY', 'IS:US10Y', '3M10Y', 'The three-month bill against the ten-year: the measure the Fed\u2019s own research leans on.'),
        spread('IS:US10Y', 'IS:US30Y', '10s30s', 'The long end: what investors demand to hold duration past ten years.'),
    ] if s]
    ten = B.get('IS:US10Y')
    note = 'Today against a month ago (the month-ago curve is derived from each point\u2019s one-month change).'
    if ten:
        d1 = (ten['bars'][-1][1] - ten['bars'][-2][1]) * 100
        note += ' The ten-year is at %.3f%%, %s on the day.' % (ten['price'], sbp(d1))
    return {'title': 'The US Treasury curve', 'note': note, 'points': pts, 'spreads': spreads}


def as_of(B, now_dt):
    def latest(codes):
        days = [B[c]['day'] for c in codes if c in B]
        live = any(B[c]['live'] for c in codes if c in B)
        return (max(days) if days else None), live
    etfs = [r[2] for g in GROUPS if g['id'] in ('regions', 'sectors', 'bonds', 'factors') for r in g['rows']]
    d_e, live_e = latest(etfs)
    t = now_dt.strftime('%H:%M UTC on ') + fmt_day(now_dt.date())
    if live_e:
        a = 'US-listed funds (countries, sectors, bonds, factors) live in the New York session to ' + t
    else:
        a = 'US-listed funds (countries, sectors, bonds, factors) at the New York close of ' + (fmt_day(d_e) if d_e else 'the last session')
    return a + '; futures, currencies, crypto and the Treasury curve to ' + t + '. Built ' + now_dt.strftime('%H:%M UTC') + ' by our feeder from InsightSentry prices.'


def build_read(B, groups, curve, now_dt):
    g = {x['id']: x for x in groups}
    get = lambda gid, lab: next((r for r in g[gid]['rows'] if r['label'] == lab), None)

    def d1(r):
        return r['v'][0] if r else None

    def d5(r):
        return r['v'][1] if r else None
    spy, tlt = get('regions', 'United States'), get('bonds', '20Y+ Treasury')
    secs = [(r['v'][0], r['label']) for r in g['sectors']['rows'] if r['v'][0] is not None]
    regs = [(r['v'][0], r['label']) for r in g['regions']['rows'] if r['v'][0] is not None]
    wti, xle, gold = get('commodities', 'WTI crude'), get('sectors', 'Energy'), get('commodities', 'Gold')
    btc, xlk = get('crypto', 'Bitcoin'), get('sectors', 'Technology')
    eur = get('fx', 'EUR/USD')
    pts = []
    if spy and tlt and d1(spy) is not None and d1(tlt) is not None:
        same = (d1(spy) > 0) == (d1(tlt) > 0)
        pts.append({'title': 'Stocks %s, long bonds %s: %s.' % (sp(d1(spy)), sp(d1(tlt)), 'they moved together' if same else 'they moved apart'),
                    'text': 'The S&P 500 fund is %s on the day and the 20-year-plus Treasury fund %s. %s Over five sessions: %s and %s.' % (
                        sp(d1(spy)), sp(d1(tlt)),
                        'When both move the same way, duration is not hedging an equity book on the day.' if same else 'The usual offset held: duration moved against equities.',
                        sp(d5(spy)), sp(d5(tlt)))})
    if len(secs) >= 2:
        hi, lo = max(secs), min(secs)
        gap = hi[0] - lo[0]
        pts.append({'title': '%s %s against %s %s: a %.2f-point sector spread.' % (hi[1], sp(hi[0]), lo[1], sp(lo[0]), gap),
                    'text': '%d of %d sectors are up on the day. %s' % (sum(1 for v, _ in secs if v > 0), len(secs),
                            'A spread above two points is a rotation day: the index average hides how far apart the groups are.' if gap > 2 else
                            'A spread under two points is a narrow day: the sectors moved roughly together.')})
    if wti and xle and d1(wti) is not None and d1(xle) is not None:
        pts.append({'title': 'Crude %s, energy shares %s.' % (sp(d1(wti)), sp(d1(xle))),
                    'text': 'WTI crude is at %s and the energy sector fund %s on the day; over a month crude is %s and the sector %s. %s' % (
                        lvl(wti['price']), sp(d1(xle)), sp(wti['v'][2]), sp(xle['v'][2]),
                        'The two agree on direction today.' if (d1(wti) > 0) == (d1(xle) > 0) else 'The two disagree on direction today; one of them is early.')})
    if gold and eur and d1(gold) is not None and d1(eur) is not None:
        pts.append({'title': 'Gold %s, EUR/USD %s.' % (sp(d1(gold)), sp(d1(eur))),
                    'text': 'Gold is at %s, %s on the day and %s over a month. EUR/USD %s, a %s dollar against the euro. Gold and a weaker dollar usually travel together; when they do not, something other than the dollar is driving gold.' % (
                        lvl(gold['price']), sp(d1(gold)), sp(gold['v'][2]), sp(d1(eur)), 'weaker' if d1(eur) > 0 else 'stronger' if d1(eur) < 0 else 'flat')})
    if len(regs) >= 2:
        hi, lo = max(regs), min(regs)
        pts.append({'title': 'Countries: %s %s at the top, %s %s at the bottom.' % (hi[1], sp(hi[0]), lo[1], sp(lo[0])),
                    'text': 'Country funds priced in US dollars, so a currency move is part of each number. %d of %d are up on the day; the US fund is %s.' % (
                        sum(1 for v, _ in regs if v > 0), len(regs), sp(d1(spy)))})
    if btc and xlk and d5(btc) is not None and d5(xlk) is not None:
        pts.append({'title': 'Bitcoin %s over five sessions, technology %s.' % (sp(d5(btc)), sp(d5(xlk))),
                    'text': 'Bitcoin is at %s, %s on the day. Crypto trades through the weekend, so its five-session window covers more calendar time than the equity one.' % (
                        lvl(btc['price']), sp(d1(btc)))})
    head = 'The board: S&P 500 fund %s on the day' % sp(d1(spy)) if spy else 'The cross-asset board'
    if len(secs) >= 2:
        head += ', %s leads the sectors' % max(secs)[1]
    head += '.'
    ten = next((p for p in curve['points'] if p['label'] == '10Y'), None)
    st = 'Built from InsightSentry prices at %s. ' % now_dt.strftime('%H:%M UTC')
    st += 'The S&P 500 fund is %s on the day and %s over five sessions' % (sp(d1(spy)), sp(d5(spy))) if spy else ''
    st += ('; the ten-year yields %.3f%%.' % ten['yield']) if ten else '.'
    st += ' The read below is generated from the numbers by fixed rules: observations, not calls.'
    return {'headline': head, 'standfirst': st, 'points': pts[:6]}


# ------------------------------------------------------------------ economic calendar
CUR_META = {'USD': ('US dollar', '\U0001F1FA\U0001F1F8', 'US'), 'EUR': ('Euro', '\U0001F1EA\U0001F1FA', 'EU'),
            'GBP': ('British pound', '\U0001F1EC\U0001F1E7', 'GB'), 'JPY': ('Japanese yen', '\U0001F1EF\U0001F1F5', 'JP'),
            'CNY': ('Chinese yuan', '\U0001F1E8\U0001F1F3', 'CN'), 'CAD': ('Canadian dollar', '\U0001F1E8\U0001F1E6', 'CA'),
            'AUD': ('Australian dollar', '\U0001F1E6\U0001F1FA', 'AU'), 'CHF': ('Swiss franc', '\U0001F1E8\U0001F1ED', 'CH'),
            'NZD': ('New Zealand dollar', '\U0001F1F3\U0001F1FF', 'NZ')}
CUR_ORDER = list(CUR_META)
COUNTRY_CUR = {'US': 'USD', 'EU': 'EUR', 'DE': 'EUR', 'FR': 'EUR', 'IT': 'EUR', 'ES': 'EUR', 'GB': 'GBP', 'UK': 'GBP',
               'JP': 'JPY', 'CN': 'CNY', 'CA': 'CAD', 'AU': 'AUD', 'CH': 'CHF', 'NZ': 'NZD'}
COUNTRY_NAME = {'US': 'US', 'EU': 'Euro area', 'DE': 'Germany', 'FR': 'France', 'IT': 'Italy', 'ES': 'Spain', 'GB': 'UK', 'UK': 'UK',
                'JP': 'Japan', 'CN': 'China', 'CA': 'Canada', 'AU': 'Australia', 'CH': 'Switzerland', 'NZ': 'New Zealand'}
BANKS = [('USD', 'Federal Reserve', 'US', re.compile(r'^Fed Interest Rate Decision')),
         ('EUR', 'European Central Bank', 'EU', re.compile(r'^ECB Interest Rate Decision')),
         ('GBP', 'Bank of England', 'GB', re.compile(r'^BoE Interest Rate Decision')),
         ('JPY', 'Bank of Japan', 'JP', re.compile(r'^BoJ Interest Rate Decision')),
         ('CAD', 'Bank of Canada', 'CA', re.compile(r'^BoC Interest Rate Decision')),
         ('AUD', 'Reserve Bank of Australia', 'AU', re.compile(r'^RBA Interest Rate Decision')),
         ('CHF', 'Swiss National Bank', 'CH', re.compile(r'^SNB Interest Rate Decision')),
         ('NZD', 'Reserve Bank of New Zealand', 'NZ', re.compile(r'^RBNZ Interest Rate Decision'))]


def fmt_val(v, e):
    if v is None:
        return None
    if isinstance(v, str):
        return v
    s = ('%.3f' % v).rstrip('0').rstrip('.')
    sc, u = e.get('sc') or '', e.get('u') or ''
    if u == '$':
        return (MINUS if v < 0 else '') + '$' + s.lstrip('-') + sc
    return (s.replace('-', MINUS) if s.startswith('-') else s) + sc + u


def event_note(e):
    a, f, p = fmt_val(e.get('a'), e), fmt_val(e.get('f'), e), fmt_val(e.get('p'), e)
    if a is not None:
        s = 'Printed %s' % a
        s += (' against a forecast of %s' % f) if f is not None else ' (no consensus forecast was published)'
        s += ('; previous %s.' % p) if p is not None else '.'
        return s
    if f is not None:
        return 'Forecast %s%s. The gap between the print and the forecast is what moves price.' % (f, ('; previous %s' % p) if p is not None else '')
    if p is not None:
        return 'No consensus forecast was published; previous %s.' % p
    return 'Scheduled; no forecast or previous reading was published.'


def cal_row(e):
    c = (e.get('c') or '').upper()
    cur = COUNTRY_CUR.get(c)
    if not cur:
        return None
    holiday = e.get('i') == 'holiday'
    if holiday and c not in ('US', 'GB', 'JP', 'DE', 'CN', 'CA', 'AU', 'CH', 'NZ', 'EU'):
        return None
    name = COUNTRY_NAME.get(c, c)
    title = e.get('ti') or ''
    ev = title if holiday or title.lower().startswith(name.lower()) else name + ' ' + title
    row = {'at': datetime.fromtimestamp(e['t'] / 1000, UTC).strftime('%Y-%m-%dT%H:%M:%SZ'), 'cur': cur,
           'impact': 'holiday' if holiday else e.get('i') if e.get('i') in ('high', 'medium', 'low') else 'low',
           'event': ev[:140]}
    if holiday:
        row['note'] = 'Market holiday in %s: expect thin liquidity or a closed market.' % name
        return row
    for k, kk in (('a', 'actual'), ('f', 'forecast'), ('p', 'previous')):
        v = fmt_val(e.get(k), e)
        if v is not None and v != '':
            row[kk] = v
    if row['impact'] in ('high', 'medium'):
        row['note'] = event_note(e)
    return row


def earnings_rows(items, lo_ms, hi_ms):
    out = []
    for x in items or []:
        if x.get('c') != 'US' or (x.get('cap') or 0) < 100000 or not (lo_ms <= x.get('t', 0) < hi_ms):
            continue
        tk = str(x.get('code', '')).split(':')[-1]
        nm = re.sub(r',? (Inc\.?|Corporation|Corp\.?|Company|Co\.|Holdings?|Group|Incorporated|plc|Ltd\.?)\b.*$', '', str(x.get('n') or tk)).strip() or tk
        row = {'at': datetime.fromtimestamp(x['t'] / 1000, UTC).strftime('%Y-%m-%dT%H:%M:%SZ'), 'cur': 'USD', 'impact': 'medium',
               'event': nm + ' earnings', 'kind': 'earnings', 'ticker': tk}
        if x.get('done') and x.get('eps') is not None:
            row['actual'] = 'EPS %s' % fmt_val(x['eps'], {})
            if x.get('epsF') is not None:
                row['forecast'] = 'EPS %s' % fmt_val(round(x['epsF'], 2), {})
        elif x.get('epsF') is not None:
            row['forecast'] = 'EPS %s' % fmt_val(round(x['epsF'], 2), {})
        out.append(row)
    return out


def parse_rate(s):
    return [float(x) for x in re.findall(r'\d+(?:\.\d+)?', s or '')]


def shift_rate(s, delta):
    return re.sub(r'\d+(?:\.\d+)?', lambda m: '%.2f' % (float(m.group(0)) + delta), s)


def build_banks(raw_events, prev_banks, now_ms, memo):
    """Policy cards. The rate starts from the last hand-researched card (prev_banks) and only moves
    when the calendar shows a decision whose actual differs from its previous reading; `memo`
    (persisted in the state file) records which decision was already applied, so a rate is never
    shifted twice."""
    prev = {b['cur']: b for b in prev_banks or []}
    out = []
    for cur, bank, c, rx in BANKS:
        evs = sorted([e for e in raw_events if (e.get('c') or '').upper() == c and rx.match(e.get('ti') or '')], key=lambda e: e['t'])
        p = prev.get(cur)
        rate, bias = (p or {}).get('rate'), (p or {}).get('bias', 'hold')
        m = memo.get(cur) or {}
        if m.get('rate'):
            rate = m['rate']
        past = [e for e in evs if e['t'] <= now_ms and isinstance(e.get('a'), (int, float))]
        nxt = next((e for e in evs if e['t'] > now_ms), None)
        parts = []
        if past:
            e = past[-1]
            d = datetime.fromtimestamp(e['t'] / 1000, UTC)
            if isinstance(e.get('p'), (int, float)):
                delta = round(e['a'] - e['p'], 4)
                if rate and m.get('t') != e['t']:
                    if abs(delta) > 1e-9:
                        rate = shift_rate(rate, delta)
                    memo[cur] = {'t': e['t'], 'rate': rate}
                bias = 'up' if delta > 0 else 'down' if delta < 0 else 'hold'
                verb = 'raised by %dbp' % round(delta * 100) if delta > 0 else 'cut by %dbp' % round(-delta * 100) if delta < 0 else 'held'
                parts.append('Last decision %s: %s.' % (fmt_day(d.date()), verb))
        if rate is None and past:
            rate = '%.2f%%' % past[-1]['a']
        if rate is None:
            continue   # a policy card needs a rate (tools/econ-calendar.md)
        if nxt:
            d = datetime.fromtimestamp(nxt['t'] / 1000, UTC)
            parts.append('Next decision %s at %s UTC.' % (fmt_day(d.date()), d.strftime('%H:%M')))
        else:
            parts.append('No decision is scheduled in the next three weeks of the calendar.')
        if not past:
            parts.append('Last move: %s.' % {'up': 'a hike', 'down': 'a cut'}.get(bias, 'a hold'))
        row = {'cur': cur, 'bank': bank, 'rate': rate,
               'next': datetime.fromtimestamp(nxt['t'] / 1000, UTC).strftime('%Y-%m-%d') if nxt else None,
               'expect': ' '.join(parts), 'bias': bias}
        out.append(row)
    return out


def build_calendar(rec, now_dt, prev, memo):
    now_ms = int(now_dt.timestamp() * 1000)
    lo = (now_dt - timedelta(days=7)).date()
    hi = (now_dt + timedelta(days=21)).date()
    j = rec_get(rec, '/cal?kind=events&from=%s&to=%s' % (lo.isoformat(), hi.isoformat()))
    raw = j.get('items') or []
    days = sorted(j.get('days') or [])
    if not raw or not days:
        raise RuntimeError('calendar store is empty')
    rows = [r for r in (cal_row(e) for e in raw) if r and r['impact'] != 'low']
    # days before the store's coverage: keep what the previous edition had (history, not regenerated)
    first = days[0]
    keep = [e for e in (prev or {}).get('events', []) if lo.isoformat() <= e['at'][:10] < first and e.get('kind') != 'earnings']
    try:
        ej = rec_get(rec, '/cal?kind=earnings')
        lo_ms = int(datetime(lo.year, lo.month, lo.day, tzinfo=UTC).timestamp() * 1000)
        rows += earnings_rows(ej.get('items'), lo_ms, lo_ms + 29 * 86400000)
    except Exception as e:
        log('earnings: ' + str(e)[:120])
    events = sorted(keep + rows, key=lambda e: (e['at'], {'holiday': 0, 'high': 1, 'medium': 2, 'low': 3}[e['impact']], e['event']))
    used = {e['cur'] for e in events}
    currencies = [{'code': c, 'name': CUR_META[c][0], 'flag': CUR_META[c][1]} for c in CUR_ORDER if c in used]
    banks = build_banks(raw, (prev or {}).get('banks'), now_ms, memo)
    how = (prev or {}).get('howToRead') or []
    cal = {
        '_comment': 'Economic calendar. Built on our server by brief-feeder from the InsightSentry calendar (via the recorder Worker) every 15 minutes and served at /terminal/econ-calendar.json; this committed copy is the fallback. Times are UTC and only UTC — the renderer converts to the reader\u2019s clock. See tools/econ-calendar.md.',
        'schema': 1, 'generatedAt': iso(now_dt), 'staleAfterHours': 30, 'goodUntil': iso(good_until(now_dt)),
        'defaultCurrency': 'USD', 'rangeStart': min([lo.isoformat()] + [e['at'][:10] for e in keep]), 'rangeEnd': hi.isoformat(),
        'currencies': currencies, 'banks': banks, 'events': events, 'howToRead': how,
        'sources': [{'name': 'InsightSentry economic calendar', 'note': 'release times in UTC, actuals, forecasts and previous readings, refreshed every 15 minutes'},
                    {'name': 'InsightSentry earnings calendar', 'note': 'US company earnings, companies over $100 billion'},
                    {'name': 'Bigdata.com', 'note': 'policy rates as last researched by hand, and rows dated before ' + first}],
        'attribution': 'Event data from InsightSentry (https://insightsentry.com); earlier rows and the policy-rate baseline compiled from reporting indexed by Bigdata.com (https://bigdata.com), summarised in our own words.',
        'disclaimer': 'Educational context, not trading advice. Times and forecasts change — confirm against a primary source before trading a release.',
    }
    return cal


# ------------------------------------------------------------------ brief
def et_time(at_iso):
    d = datetime.strptime(at_iso, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=UTC).astimezone(ET)
    return d.strftime('%a %H:%M ET')


def build_brief(B, M, CAL, rec, now_dt, prev):
    sd = session_date(now_dt)
    live = us_session_open(now_dt)
    x = lambda code: B.get(code)

    def d1(code):
        v = x(code)
        return v['v'][0] if v else None

    def chg_bp(code):
        v = x(code)
        return (v['bars'][-1][1] - v['bars'][-2][1]) * 100 if v else None
    spx, ndx, dji, rut, vix, dxy = (x(EXTRA[k]) for k in ('SPX', 'NDX', 'DJI', 'RUT', 'VIX', 'DXY'))
    when = ('in the session to %s ET' % now_dt.astimezone(ET).strftime('%H:%M')) if live else \
        ('at the close of %s' % fmt_day(spx['day'])) if spx else 'at the last close'
    secs = [(r['v'][0], r['label']) for g in M['groups'] if g['id'] == 'sectors' for r in g['rows'] if r['v'][0] is not None]
    bullets = []
    if spx:
        t = 'Stocks: S&P 500 %s, Nasdaq 100 %s %s' % (sp(d1(EXTRA['SPX'])), sp(d1(EXTRA['NDX'])), when)
        txt = 'The S&P 500 is at %s (%s), the Nasdaq 100 at %s (%s), the Dow at %s (%s) and the Russell 2000 at %s (%s), %s.' % (
            lvl(spx['price']), sp(d1(EXTRA['SPX'])), lvl(ndx and ndx['price']), sp(d1(EXTRA['NDX'])),
            lvl(dji and dji['price']), sp(d1(EXTRA['DJI'])), lvl(rut and rut['price']), sp(d1(EXTRA['RUT'])), when)
        txt += ' Over five sessions the S&P 500 is %s.' % sp(spx['v'][1])
        if len(secs) >= 2:
            txt += ' Best sector %s %s, worst %s %s.' % (max(secs)[1], sp(max(secs)[0]), min(secs)[1], sp(min(secs)[0]))
        if vix:
            txt += ' The VIX is at %s, %s on the day.' % (lvl(vix['price']), sp(vix['v'][0]))
        bullets.append({'title': t, 'text': txt})
    if x('IS:US10Y'):
        t = 'Rates: the ten-year at %.3f%%, %s on the day' % (x('IS:US10Y')['price'], sbp(chg_bp('IS:US10Y')))
        parts = []
        for lab, code in (('two-year', 'IS:US02Y'), ('ten-year', 'IS:US10Y'), ('thirty-year', 'IS:US30Y')):
            if x(code):
                b = x(code)['bars']
                wk = (b[-1][1] - b[-6][1]) * 100 if len(b) >= 6 else None
                parts.append('the %s %.3f%% (%s on the day, %s over five sessions)' % (lab, b[-1][1], sbp(chg_bp(code)), sbp(wk)))
        txt = 'Treasury yields: ' + ', '.join(parts) + '.'
        s210 = next((s for s in M['curve']['spreads'] if s['label'] == '2s10s'), None)
        if s210:
            txt += ' The 2s10s spread is %dbp.' % s210['value']
        bullets.append({'title': t, 'text': txt})
    fxp = []
    if dxy:
        fxp.append('the dollar index %s (%s)' % (lvl(dxy['price']), sp(dxy['v'][0])))
    for lab, code in (('EUR/USD', 'FX:EURUSD'), ('USD/JPY', 'FX:USDJPY'), ('GBP/USD', 'FX:GBPUSD')):
        if x(code):
            fxp.append('%s %s (%s)' % (lab, lvl(x(code)['price']), sp(d1(code))))
    cmd = []
    for lab, code in (('WTI crude', 'NYMEX:CL1!'), ('Brent', 'NYMEX:BZ1!'), ('gold', 'COMEX:GC1!'), ('silver', 'COMEX:SI1!'), ('copper', 'COMEX:HG1!')):
        if x(code):
            cmd.append('%s %s (%s)' % (lab, lvl(x(code)['price']), sp(d1(code))))
    if fxp or cmd:
        g = d1('COMEX:GC1!')
        o = d1('NYMEX:CL1!')
        bullets.append({'title': 'Dollar and commodities: crude %s, gold %s' % (sp(o), sp(g)),
                        'text': ('Currencies: ' + ', '.join(fxp) + '. ' if fxp else '') + ('Commodities, front-month futures: ' + ', '.join(cmd) + '.' if cmd else '')})
    btc, eth = x('COINBASE:BTCUSD'), x('COINBASE:ETHUSD')
    if btc:
        bullets.append({'title': 'Crypto: Bitcoin %s on the day, %s over five sessions' % (sp(btc['v'][0]), sp(btc['v'][1])),
                        'text': 'Bitcoin is at %s and Ethereum at %s (%s on the day, %s over five sessions). Crypto trades around the clock, so its day runs midnight to midnight UTC rather than session to session.' % (
                            lvl(btc['price']), lvl(eth and eth['price']), sp(eth and eth['v'][0]), sp(eth and eth['v'][1]))})
    heads = headlines(rec, now_dt)
    if heads and len(bullets) < 5:
        bullets.append({'title': 'In the headlines', 'text': ' '.join('%s (%s, %s UTC).' % (h['h'].rstrip('.'), h['s'], datetime.fromtimestamp(h['t'], UTC).strftime('%H:%M')) for h in heads[:3])})
    # calendar: the session day's releases, USD high/medium + other high, in ET (the brief's own format)
    day_ev = [e for e in CAL['events'] if datetime.strptime(e['at'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=UTC).astimezone(ET).date() == sd
              and not e.get('kind') and (e['impact'] == 'high' or (e['cur'] == 'USD' and e['impact'] == 'medium') or e['impact'] == 'holiday')]
    day_ev.sort(key=lambda e: ({'holiday': 0, 'high': 1, 'medium': 3}.get(e['impact'], 4) + (0 if e['cur'] == 'USD' else 1), e['at']))
    day_ev = sorted(day_ev[:8], key=lambda e: e['at'])
    calendar = [{'time': et_time(e['at']), 'event': e['event'], 'note': e.get('note') or ('%s-impact release.' % e['impact'].capitalize())} for e in day_ev]
    if not calendar:
        nxt = next((e for e in CAL['events'] if e['at'] > iso(now_dt) and e['impact'] == 'high' and e['cur'] == 'USD'), None)
        calendar = [{'time': fmt_day(sd), 'event': 'No high-impact releases scheduled for this session',
                     'note': ('The next high-impact US release is %s, %s.' % (nxt['event'], et_time(nxt['at']))) if nxt else 'Check the economic calendar for the week ahead.'}]
    usd_high = [e for e in day_ev if e['cur'] == 'USD' and e['impact'] == 'high']
    up_next = [e for e in day_ev if e['at'] > iso(now_dt)]
    # prose
    head = 'S&P 500 %s, ten-year %s' % (sp(d1(EXTRA['SPX'])), sbp(chg_bp('IS:US10Y'))) if spx and x('IS:US10Y') else 'The board %s' % when
    st = ('The S&P 500 %s %s %s and the ten-year yield %s %s to %.3f%%. ' % (
        word_move(d1(EXTRA['SPX'])), sp(d1(EXTRA['SPX'])).lstrip('+').lstrip(MINUS), when,
        word_move(chg_bp('IS:US10Y')), sbp(chg_bp('IS:US10Y')).lstrip('+').lstrip(MINUS), x('IS:US10Y')['price'])) if spx and x('IS:US10Y') else ''
    if up_next:
        st += 'Still ahead for %s: %s.' % (fmt_day(sd), '; '.join('%s at %s' % (e['event'], et_time(e['at'])[4:]) for e in up_next[:3]))
    elif day_ev:
        st += 'The releases for %s are out; see the calendar for the actuals.' % fmt_day(sd)
    else:
        st += 'No high-impact release is scheduled for %s.' % fmt_day(sd)
    note = 'Session: %s. ' % fmt_day(sd)
    if vix:
        note += 'The VIX is at %s; %s. ' % (lvl(vix['price']), 'above 20, wider ranges are normal' if vix['price'] >= 20 else 'under 20, ranges have been contained')
    note += ('%d high-impact US release%s on the day, the first at %s. ' % (len(usd_high), '' if len(usd_high) == 1 else 's', et_time(usd_high[0]['at'])[4:])) if usd_high else 'No high-impact US release on the day. '
    note += 'Positioning, not conviction: these figures describe where the board is, not where it goes.'
    nxt_high = [e for e in usd_high if e['at'] > iso(now_dt)]
    if nxt_high:
        watch = 'Trading the first move on %s. Spreads widen and liquidity thins around a high-impact print, and the first move after the number often reverses; let the release settle before treating its direction as information.' % nxt_high[0]['event']
    elif usd_high:
        watch = 'Treating the morning\u2019s print as settled. %s is out; the rest of the session trades how the market digests it, and that can take longer than the first reaction suggests. Size for the range you can see.' % usd_high[0]['event']
    else:
        watch = 'Reading a quiet calendar as a quiet session. With no high-impact US release, the moves come from headlines and positioning, and those arrive without a countdown; size for the range you can see, not the one you expect.'
    gen = iso(now_dt)
    brief = {
        '_comment': 'Pre-market brief. Built on our server by brief-feeder from InsightSentry prices, calendar and headlines by fixed templates (no language model), served at /terminal/market-brief.json; this committed copy is the fallback. See tools/market-brief.md.',
        'schema': 1, 'generatedAt': gen, 'sessionDate': sd.isoformat(), 'staleAfterHours': 30, 'goodUntil': iso(good_until(now_dt)),
        'headline': head, 'standfirst': st.strip(), 'bullets': bullets[:5], 'calendar': calendar, 'sessionNote': note, 'watchOut': watch,
        'sources': [{'name': 'InsightSentry', 'note': 'index, rates, currency, commodity and crypto prices, the economic calendar and the headline feed'}],
        'attribution': 'Data from InsightSentry (https://insightsentry.com); headlines are quoted with their outlet named. Earlier editions in the archive were compiled from reporting indexed by Bigdata.com (https://bigdata.com), summarised in our own words.',
        'disclaimer': 'Educational context, not trading advice or a recommendation. Prices and expectations move; always confirm against your own data before acting.',
    }
    prose = read_json(PROSE_FILE)
    if isinstance(prose, dict) and prose.get('sessionDate') == brief['sessionDate']:
        for k in ('headline', 'standfirst', 'sessionNote', 'watchOut'):
            if isinstance(prose.get(k), str) and 0 < len(prose[k]) < 2000:
                brief[k] = prose[k]
        if isinstance(prose.get('sources'), list):
            brief['sources'] = brief['sources'] + [s for s in prose['sources'] if isinstance(s, dict) and s.get('name')][:6]
    arch = list((prev or {}).get('archive') or [])
    if prev and prev.get('sessionDate') and prev.get('sessionDate') != brief['sessionDate']:
        arch = [a for a in arch if a.get('date') != prev['sessionDate']]
        arch.insert(0, {'date': prev['sessionDate'], 'headline': prev.get('headline', ''), 'summary': prev.get('standfirst', '')[:600]})
    seen, uniq = set(), []
    for a in arch:
        if a.get('date') and a['date'] not in seen and a['date'] != brief['sessionDate']:
            seen.add(a['date'])
            uniq.append(a)
    brief['archive'] = uniq[:7]
    return brief


MARKET_TAGS = {'MACRO', 'NQ', 'ES', 'YM', 'GC', 'SI', 'CL', 'BTC', 'ETH'}


def headlines(rec, now_dt):
    """A few recent market-tagged headlines from the recorder's news store (InsightSentry feed),
    quoted verbatim as titles with the outlet named."""
    try:
        j = rec_get(rec, '/news?limit=120')
    except Exception as e:
        log('news: ' + str(e)[:120])
        return []
    cut = now_dt.timestamp() - 12 * 3600
    out, seen = [], set()
    for it in j.get('items') or []:
        h = (it.get('h') or '').strip()
        if not h or it.get('t', 0) < cut or not (set(it.get('g') or []) & MARKET_TAGS):
            continue
        if it.get('s') not in ('Financial Juice', 'Dow Jones Newswires', 'Reuters', 'MT Newswires', 'Bloomberg', 'CNBC', 'MarketWatch', 'Associated Press', 'Benzinga'):
            continue
        k = h.lower()[:60]
        if k in seen or len(h) > 200:
            continue
        seen.add(k)
        out.append(it)
    return out[:3]


# ------------------------------------------------------------------ fallback commit (once a day)
def gh_api(args, body=None):
    r = subprocess.run(['gh', 'api'] + args + (['--input', '-'] if body is not None else []), input=json.dumps(body) if body is not None else None,
                       capture_output=True, text=True, timeout=90)
    if r.returncode != 0:
        raise RuntimeError('gh api %s: %s' % (args[-1].split('?')[0][-60:], (r.stderr or r.stdout).strip()[:160]))
    return json.loads(r.stdout) if r.stdout.strip() else {}


def commit_files(files, now_dt):
    """ONE commit on main holding the three fallback files (git data API through the server's gh
    login). Content-only JSON: no build bump (tools/daily-refresh.md). Retried once if main moved."""
    if os.environ.get('BRIEF_COMMIT', '1') == '0':
        return 'commit disabled'
    base = 'repos/' + REPO + '/git/'
    for attempt in range(2):
        head = gh_api([base + 'ref/heads/main'])['object']['sha']
        tree = gh_api([base + 'commits/' + head])['tree']['sha']
        entries = []
        for name, obj in files.items():
            text = json.dumps(obj, ensure_ascii=False, indent=2) + '\n'
            blob = gh_api(['-X', 'POST', base + 'blobs'], {'content': text, 'encoding': 'utf-8'})['sha']
            entries.append({'path': 'assets/%s.json' % name, 'mode': '100644', 'type': 'blob', 'sha': blob})
        nt = gh_api(['-X', 'POST', base + 'trees'], {'base_tree': tree, 'tree': entries})['sha']
        msg = ('Daily refresh %s: market brief, market map and economic calendar\n\n'
               'Built on our server by brief-feeder from InsightSentry data (no build bump: content-only JSON). '
               'The live copy is served by the recorder Worker at /terminal/<name>.json; these committed files are the fallback.') % now_dt.strftime('%Y-%m-%d')
        c = gh_api(['-X', 'POST', base + 'commits'], {'message': msg, 'tree': nt, 'parents': [head],
                                                       'author': {'name': 'Stryker', 'email': 'theelitegrey@gmail.com'}})['sha']
        try:
            gh_api(['-X', 'PATCH', base + 'refs/heads/main'], {'sha': c, 'force': False})
            return 'committed ' + c[:10]
        except RuntimeError as e:
            if attempt == 1:
                raise
            log('main moved, retrying the commit: ' + str(e)[:80])
            time.sleep(5)


# ------------------------------------------------------------------ main
def plan(now_dt, state, args):
    if '--full' in args:
        return 'full'
    if '--map' in args:
        return 'map'
    if '--cal' in args:
        return 'cal'
    today = now_dt.strftime('%Y-%m-%d')
    if not state.get('fullDay'):
        return 'full'
    after = (now_dt.hour, now_dt.minute) >= FULL_AT
    if now_dt.weekday() < 5 and after and state.get('fullDay') != today:
        return 'full'
    m = now_dt.hour * 60 + now_dt.minute
    # map numbers: every 30 min in the US session (was every 15 min: InsightSentry monthly REST quota, 2026-10-25)
    if now_dt.weekday() < 5 and 13 * 60 + 30 <= m <= 20 * 60 + 30 and m % 30 < 15:
        return 'map'
    return 'cal'


def main(args):
    key, rec, sec = env_need()
    if not key or not rec or not sec:
        print('brief-feeder: missing env (InsightSentry key, BOOK_RECORDER_URL or BOOK_INGEST_SECRET)', file=sys.stderr)
        return 2
    now_dt = datetime.now(UTC).replace(microsecond=0)
    st_path = os.path.join(STATE_DIR, 'state.json')
    state = read_json(st_path, {})
    mode = plan(now_dt, state, args)
    out_dir = args[args.index('--out') + 1] if '--out' in args else None
    prev = {}
    for n in NAMES:
        prev[n] = read_json(os.path.join(STATE_DIR, n + '.json'))
        if prev[n] is None:
            try:
                prev[n] = rec_get(rec, '/terminal/%s.json' % n)
            except Exception:
                try:
                    prev[n] = http_json('https://raw.githubusercontent.com/%s/main/assets/%s.json' % (REPO, n))
                except Exception:
                    prev[n] = None
    log('mode ' + mode)
    files, failed = {}, False
    try:
        files['econ-calendar'] = build_calendar(rec, now_dt, prev['econ-calendar'], state.setdefault('banks', {}))
    except Exception as e:
        failed = True
        log('calendar: ' + str(e)[:200])
    if mode in ('full', 'map'):
        try:
            bars, _ = load_series(key, os.path.join(STATE_DIR, 'series.json'), fresh=(mode == 'full'))
            quotes = load_quotes(key)
            B = board(bars, quotes, now_dt.timestamp())
            files['market-map'] = build_map(B, now_dt, prev['market-map'])
            cal = files.get('econ-calendar') or prev['econ-calendar']
            files['market-brief'] = build_brief(B, files['market-map'], cal, rec, now_dt, prev['market-brief'])
            del bars, quotes, B
        except Exception as e:
            failed = True
            log('map/brief: ' + str(e)[:200])
    if mode == 'full' and len(files) < 3:
        log('FULL run incomplete (%s): nothing published, the stale banner stays honest' % ','.join(files))
        return 1
    # the three files expire together (tools/daily-refresh.md)
    for n in files:
        files[n]['goodUntil'] = iso(good_until(now_dt))
    for n, obj in files.items():
        write_json(os.path.join(STATE_DIR, n + '.json'), obj)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
            with open(os.path.join(out_dir, n + '.json'), 'w', encoding='utf-8') as f:
                json.dump(obj, f, ensure_ascii=False, indent=2)
                f.write('\n')
        if '--no-post' not in args:
            try:
                log('%s -> %s' % (n, rec_post(rec, sec, n, obj)))
            except Exception as e:
                failed = True
                log(str(e)[:200])
    if mode == 'full' and not failed:
        state['fullDay'] = now_dt.strftime('%Y-%m-%d')
        if '--no-commit' not in args and '--no-post' not in args:
            try:
                log(commit_files(files, now_dt))
            except Exception as e:
                log('fallback commit failed (the Worker copy is live): ' + str(e)[:200])
    state['last'] = {'at': iso(now_dt), 'mode': mode, 'ok': not failed}
    write_json(st_path, state)
    try:
        import resource
        log('rss %d MB' % (resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024))
    except Exception:
        pass
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
