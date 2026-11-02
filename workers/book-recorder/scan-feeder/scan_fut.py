"""Futures screener rows for scan_feeder.py. Pure maths (unit-tested) + one Yahoo daily-bars read per root.

Zero InsightSentry calls: this is the same Yahoo daily series the charts page already serves
(functions/api/chart/_bars.js SYMBOLS; keep ROOTS in step with it). RSI / SMA / EMA / ATR / 52-week range and the
performance figures are computed here from the 1-year daily bars. Education only.
"""
import json
import urllib.request

UA = 'Mozilla/5.0 (compatible; tradezoro-scan-feeder/2)'
# root -> (yahoo, name, exchange prefix used by the chart symbol map, group). Order = display order.
ROOTS = {
    'NQ': ('NQ=F', 'Nasdaq-100 E-mini', 'CME_MINI', 'Index'), 'MNQ': ('MNQ=F', 'Micro Nasdaq-100 E-mini', 'CME_MINI', 'Index'),
    'ES': ('ES=F', 'S&P 500 E-mini', 'CME_MINI', 'Index'), 'MES': ('MES=F', 'Micro S&P 500 E-mini', 'CME_MINI', 'Index'),
    'YM': ('YM=F', 'Dow Jones E-mini', 'CBOT_MINI', 'Index'), 'MYM': ('MYM=F', 'Micro Dow Jones E-mini', 'CBOT_MINI', 'Index'),
    'RTY': ('RTY=F', 'Russell 2000 E-mini', 'CME_MINI', 'Index'), 'M2K': ('M2K=F', 'Micro Russell 2000 E-mini', 'CME_MINI', 'Index'),
    'GC': ('GC=F', 'Gold', 'COMEX', 'Metals'), 'MGC': ('MGC=F', 'Micro Gold', 'COMEX_MINI', 'Metals'),
    'SI': ('SI=F', 'Silver', 'COMEX', 'Metals'), 'SIL': ('SIL=F', 'Micro Silver', 'COMEX_MINI', 'Metals'),
    'HG': ('HG=F', 'Copper', 'COMEX', 'Metals'), 'MHG': ('MHG=F', 'Micro Copper', 'COMEX_MINI', 'Metals'),
    'CL': ('CL=F', 'Crude Oil WTI', 'NYMEX', 'Energy'), 'MCL': ('MCL=F', 'Micro WTI Crude Oil', 'NYMEX', 'Energy'),
    'NG': ('NG=F', 'Natural Gas', 'NYMEX', 'Energy'),
    'ZN': ('ZN=F', '10-Year T-Note', 'CBOT', 'Rates'), 'ZB': ('ZB=F', 'U.S. Treasury Bond', 'CBOT', 'Rates'),
    '6E': ('6E=F', 'Euro FX', 'CME', 'Currency'),
}


def _ok(x):
    return isinstance(x, (int, float)) and x == x and abs(x) != float('inf')


def sma(cl, n):
    return sum(cl[-n:]) / n if len(cl) >= n else None


def ema(cl, n):
    """Seeded with the first n closes' average, then the usual 2/(n+1) smoothing."""
    if len(cl) < n:
        return None
    e, k = sum(cl[:n]) / n, 2.0 / (n + 1)
    for v in cl[n:]:
        e = v * k + e * (1 - k)
    return e


def rsi14(cl, n=14):
    """Wilder RSI of the closes; None under n+1 closes."""
    if len(cl) < n + 1:
        return None
    g = l = 0.0
    for i in range(1, n + 1):
        d = cl[i] - cl[i - 1]
        g += max(d, 0)
        l += max(-d, 0)
    g, l = g / n, l / n
    for i in range(n + 1, len(cl)):
        d = cl[i] - cl[i - 1]
        g = (g * (n - 1) + max(d, 0)) / n
        l = (l * (n - 1) + max(-d, 0)) / n
    return 100.0 if l == 0 else 100 - 100 / (1 + g / l)


def atr14(hi, lo, cl, n=14):
    if len(cl) < n + 1:
        return None
    tr = [max(hi[i] - lo[i], abs(hi[i] - cl[i - 1]), abs(lo[i] - cl[i - 1])) for i in range(1, len(cl))]
    a = sum(tr[:n]) / n
    for v in tr[n:]:
        a = (a * (n - 1) + v) / n
    return a


def perf(cl, back):
    return (cl[-1] / cl[-1 - back] - 1) * 100 if len(cl) > back and cl[-1 - back] else None


def row_from_bars(root, bars, ytd_close=None):
    """bars = {'o','h','l','c','v'} aligned daily lists, last = the current session. -> scanner row dict (COLS keys) or None."""
    y, name, ex, grp = ROOTS[root]
    cl, hi, lo, op, vo = bars['c'], bars['h'], bars['l'], bars['o'], bars['v']
    if len(cl) < 20 or not all(_ok(x) for x in cl[-2:]):
        return None
    c, p = cl[-1], cl[-2]
    r2 = lambda v, n=2: None if not _ok(v) else round(v, n)
    vol = vo[-1] if _ok(vo[-1]) else None
    pv = [v for v in vo[-21:-1] if _ok(v) and v > 0]
    av = sum(pv) / len(pv) if pv else None
    h52, l52 = max(hi[-252:]), min(lo[-252:])
    at = atr14(hi, lo, cl)
    return {
        's': ex + ':' + root + '1!', 'n': name, 'c': r2(c, 6), 'chg': r2((c / p - 1) * 100) if p else None,
        'vol': r2(vol, 0), 'rvol': r2(vol / av) if vol and av else None,
        'gap': r2((op[-1] / p - 1) * 100) if _ok(op[-1]) and p else None, 'rsi': r2(rsi14(cl), 1),
        'hi52': r2(h52, 6), 'lo52': r2(l52, 6), 'cap': None, 'pe': None, 'sec': grp, 'perfW': r2(perf(cl, 5)),
        'perfYtd': r2((c / ytd_close - 1) * 100) if ytd_close else None,
        'ind': grp, 'beta': None, 'dy': None, 'earn': None, 'atr': r2(at, 4), 'perfM': r2(perf(cl, 21)),
        'perfQ': r2(perf(cl, 63)), 'perfY': r2(perf(cl, 251) if len(cl) > 251 else perf(cl, len(cl) - 1)),
        'av': r2(av, 0), 'sma20': r2(sma(cl, 20), 4), 'sma50': r2(sma(cl, 50), 4), 'sma200': r2(sma(cl, 200), 4),
        'ema20': r2(ema(cl, 20), 4), 'ema50': r2(ema(cl, 50), 4), 'ema200': r2(ema(cl, 200), 4),
    }


def parse_yahoo(j):
    """Yahoo v8 chart JSON -> (bars, ytd_close) with rows holding a close only; None when unusable."""
    try:
        r = j['chart']['result'][0]
        q, ts = r['indicators']['quote'][0], r['timestamp']
    except (KeyError, IndexError, TypeError):
        return None
    keep = [i for i, c in enumerate(q.get('close') or []) if _ok(c) and _ok(q['high'][i]) and _ok(q['low'][i])]
    if len(keep) < 20:
        return None
    pick = lambda k: [q[k][i] if i < len(q[k]) else None for i in keep]
    bars = {'o': pick('open'), 'h': pick('high'), 'l': pick('low'), 'c': pick('close'), 'v': pick('volume')}
    year = None
    try:
        import datetime
        year = datetime.datetime.utcfromtimestamp(ts[keep[-1]]).year
        ytd = next((bars['c'][k - 1] for k, i in enumerate(keep) if k and datetime.datetime.utcfromtimestamp(ts[i]).year == year), None)
    except Exception:
        ytd = None
    return bars, ytd


def fetch(root, timeout=15):
    u = 'https://query1.finance.yahoo.com/v8/finance/chart/%s?range=1y&interval=1d' % ROOTS[root][0]
    with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA}), timeout=timeout) as r:
        return json.load(r)


def pull_all():
    """-> list of rows (roots that failed are skipped; the rest still ship)."""
    out = []
    for root in ROOTS:
        try:
            p = parse_yahoo(fetch(root))
            row = row_from_bars(root, p[0], p[1]) if p else None
        except Exception:
            row = None
        if row:
            out.append(row)
    return out
