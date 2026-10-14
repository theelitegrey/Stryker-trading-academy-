#!/usr/bin/env python3
"""TradeZoro symbol info feeder: InsightSentry /info, /contracts, /session, /fundamentals -> one small
gzip part -> book recorder Worker (/scan-ingest?part=syminfo). Runs once a day (info-feeder.timer).

Owner-approved 2026-10-14 (Symbol Info panel on Charts). Futures: contract specs, the roll calendar
(next settlement dates), trading session. Stocks / ETFs: market cap, EPS, revenue, dividend yield,
next earnings date, trimmed from the 300 KB fundamentals response. About 1 KB per symbol; ~45 IS calls.
Env: INSIGHTSENTRY_WEBSOCKET_API_KEY, BOOK_RECORDER_URL, BOOK_INGEST_SECRET (never printed).
"""
import gzip, json, os, sys, time, urllib.parse, urllib.request
from datetime import date, datetime

IS = 'https://api.insightsentry.com/v3'
FUT = {  # chart root -> IS continuous code (micros share the full-size contract's calendar)
    'NQ': 'CME_MINI:NQ1!', 'ES': 'CME_MINI:ES1!', 'YM': 'CBOT_MINI:YM1!', 'RTY': 'CME_MINI:RTY1!',
    'GC': 'COMEX:GC1!', 'SI': 'COMEX:SI1!', 'CL': 'NYMEX:CL1!', 'NG': 'NYMEX:NG1!',
    'ZN': 'CBOT:ZN1!', 'ZB': 'CBOT:ZB1!', '6E': 'CME:6E1!',
}
STOCKS = ['NASDAQ:AAPL', 'NASDAQ:MSFT', 'NASDAQ:NVDA', 'NASDAQ:AMZN', 'NASDAQ:GOOGL', 'NASDAQ:META', 'NASDAQ:TSLA',
          'NASDAQ:AVGO', 'NASDAQ:NFLX', 'NASDAQ:AMD', 'NYSE:JPM', 'NYSE:V', 'NASDAQ:WMT', 'NYSE:XOM', 'NYSE:LLY',
          'NYSE:BAC', 'NYSE:DIS', 'NASDAQ:COST', 'NASDAQ:INTC', 'NASDAQ:PLTR', 'NYSE:BA', 'NASDAQ:COIN', 'NASDAQ:MSTR',
          'AMEX:SPY', 'NASDAQ:QQQ', 'AMEX:IWM', 'AMEX:DIA', 'AMEX:GLD', 'NASDAQ:TQQQ']
FUND = {  # key -> fundamentals id
    'cap': 'market_cap_basic', 'eps': 'earnings_per_share_diluted_ttm', 'rev': 'total_revenue_ttm',
    'dy': 'dividends_yield_current', 'emp': 'number_of_employees', 'earnTs': 'earnings_release_next_trading_date_fq',
}


def log(m):
    print(time.strftime('%H:%M:%S ') + m, flush=True)


def get(path, key):
    req = urllib.request.Request(IS + urllib.parse.quote(path, safe='/:!'), headers={'Authorization': 'Bearer ' + key})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read())


def rnd(v, n=4):
    return round(v, n) if isinstance(v, (int, float)) and v == v else None


def trim_session(s):
    """/session -> {hours:'1700-1600', desc, tz, early:[{date,end}] next 120 days, holidays: next 8}."""
    today = int(date.today().strftime('%Y%m%d'))
    det = (s.get('details') or [{}])[0]
    horizon = int((datetime.now().replace(year=datetime.now().year + (1 if datetime.now().month > 8 else 0),
                                          month=(datetime.now().month + 4 - 1) % 12 + 1)).strftime('%Y%m%d'))
    early = []
    for c in det.get('session_correction') or []:
        if c.get('end_hour') == det.get('session', '').split('-')[-1]:
            continue
        for d in c.get('dates') or []:
            if today <= int(d) <= horizon:
                early.append({'d': d, 'end': c.get('end_hour')})
    hol = sorted(h for h in (s.get('holidays') or []) if int(h) >= today)[:8]
    return {'hours': det.get('session') or '%s-%s' % (s.get('start_hour'), s.get('end_hour')),
            'desc': det.get('description') or '', 'tz': s.get('timezone'), 'early': sorted(early, key=lambda x: x['d'])[:6], 'hol': hol}


def trim_contracts(c, n=6):
    out = []
    today = int(date.today().strftime('%Y%m%d'))
    for x in c.get('contracts') or []:
        if int(x['settlement_date']) >= today:
            out.append({'c': x['code'].split(':')[-1], 'd': x['settlement_date']})
    return sorted(out, key=lambda x: x['d'])[:n]


def trim_info(i):
    return {'name': i.get('name'), 'ex': i.get('exchange'), 'cur': i.get('currency_code'), 'tz': i.get('timezone'),
            'tick': i.get('price_tick') and (i.get('tick_size') or [None])[0], 'pv': i.get('point_value'),
            'contract': i.get('contract'), 'under': i.get('underlying_symbol'), 'ath': rnd(i.get('all_time_high'), 2),
            'athDay': i.get('all_time_high_day'), 'atl': rnd(i.get('all_time_low'), 2), 'avgVol': rnd(i.get('average_volume'), 0)}


def trim_fund(f):
    ids = {x['id']: x.get('value') for x in f.get('data') or [] if x.get('id') in FUND.values()}
    out = {k: rnd(ids.get(v), 4) for k, v in FUND.items() if ids.get(v) is not None}
    if 'earnTs' in out:
        out['earnTs'] = int(out['earnTs'])
    return out


def build(key, only=None):
    syms, errs = {}, 0
    for root, code in FUT.items():
        if only and root not in only:
            continue
        try:
            e = {'kind': 'fut', 'code': code}
            e.update(trim_info(get('/symbols/%s/info' % code, key)))
            e['roll'] = trim_contracts(get('/symbols/%s/contracts' % code, key))
            e['session'] = trim_session(get('/symbols/%s/session' % code, key))
            syms[root] = e
        except Exception as ex:
            errs += 1
            log('fut %s failed: %s' % (root, str(ex)[:80]))
        time.sleep(0.4)
    for code in STOCKS:
        if only and code not in only:
            continue
        try:
            f = trim_fund(get('/symbols/%s/fundamentals' % code, key))
            if f:
                syms[code.split(':')[-1]] = {'kind': 'stock', 'code': code, 'fund': f}
        except Exception as ex:
            errs += 1
            log('stock %s failed: %s' % (code, str(ex)[:80]))
        time.sleep(0.4)
    return syms, errs


def payload(syms, now):
    return gzip.compress(json.dumps({'v': 1, 't': int(now), 'syms': syms}, separators=(',', ':')).encode(), 9)


def post(url, secret, body):
    req = urllib.request.Request(url.rstrip('/') + '/scan-ingest?part=syminfo', data=body, method='POST',
                                 headers={'content-type': 'application/octet-stream', 'x-ingest-key': secret, 'user-agent': 'tradezoro-info-feeder/1'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read()[:60].decode()


def main():
    key, url, secret = os.environ.get('INSIGHTSENTRY_WEBSOCKET_API_KEY'), os.environ.get('BOOK_RECORDER_URL'), os.environ.get('BOOK_INGEST_SECRET')
    if not key:
        sys.exit('missing key')
    syms, errs = build(key)
    body = payload(syms, time.time())
    log('%d symbols (%d failed), %d B gzip' % (len(syms), errs, len(body)))
    if '--dry' in sys.argv or not (url and secret):
        return
    if len(syms) < 8:
        sys.exit('too few symbols, not posting')
    log('ingest -> %s %s' % post(url, secret, body))


if __name__ == '__main__':
    main()
