#!/usr/bin/env python3
"""TradeZoro options analytics feeder: InsightSentry option chains -> small analytics -> recorder Worker.

Owner-approved 2026-10-14 (InsightSentry options analytics). The browser never talks to
InsightSentry: this server pulls the chains, computes everything, and POSTs one small gzip JSON
(~6-10 KB for all three underlyings) to <Worker>/opt-ingest. The GEX page panel and the Charts
"Expected Move" indicator read GET <Worker>/opt-analytics?u=SPX (edge-cached, shared by everyone).

Per run (every 5 min, weekdays 09:30-16:15 ET + one run after the close):
  - 1 call  /v3/symbols/quotes  (SPX, QQQ, SPY spot; ES1!, NQ1! for the futures mapping; VIX, VXN)
  - 2 calls /v3/options/quotes per underlying: near (expiries <= 45 days, strikes +-8%) and far
    (46-400 days, +-15%), each parsed and dropped before the next (bounded memory).
  - 2 calls /v3/symbols/{VIX,VXN}/series?bar_type=day (one year of daily closes, for IV rank).
    These are fetched at most once per hour (kept in /var/lib/opt-feeder, systemd StateDirectory).
  - put/call ratios come from the Cboe compact chain the GEX feeder already posts
    (<Worker>/gex-chain?part=term: expiries <= 31 days, strikes +-10%), which carries volume and
    open interest for every row (InsightSentry only adds OI to the 100 nearest contracts).

Computed (pure functions below, unit-tested in test/opt_feeder_test.py):
  expected move   ATM straddle mid (calls + puts, linearly interpolated between the two strikes
                  around spot) for 0DTE, 1DTE, the weekly (this week's Friday) and the monthly
                  (third Friday) expiry. Range = spot +- straddle. Mapped to futures with
                  ratio = futures price / underlying spot at the same moment (ES from SPX/SPY,
                  NQ from QQQ).
  term structure  ATM IV per expiry (call/put IV interpolated at spot).
  skew            25-delta put IV - 25-delta call IV per expiry (IV interpolated in delta).
  30-day values   ATM IV and skew interpolated to 30 days (variance-time for IV).
  IV rank / pct   the 30-day implied volatility index (VIX for SPX/SPY, VXN for QQQ) against its
                  last 252 daily closes: rank = (now - min) / (max - min), percentile = share of
                  days below now. Our own daily ATM IV is stored too (Worker table optday) so a
                  native-IV rank can replace the index once a year of it exists.
  put/call        volume and open interest, all expiries <= 31 days and 0DTE alone (Cboe).

Config (env): BOOK_RECORDER_URL, BOOK_INGEST_SECRET (/root/projects/book-feeder/feeder.env) and
INSIGHTSENTRY_WEBSOCKET_API_KEY (the chief-of-staff insightsentry.env; both 0600). Nothing secret
is ever logged. Stdlib only.
Test mode: opt_feeder.py --analyse <is_quotes.json> <U> <spot> <now_epoch>  -> analytics JSON.
"""
import gzip
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

IS = 'https://api.insightsentry.com/v3'
UA = 'tradezoro-opt-feeder/1'
ET = ZoneInfo('America/New_York')
UNDERLYINGS = {'SPX': 'CBOE:SPX', 'QQQ': 'NASDAQ:QQQ', 'SPY': 'AMEX:SPY'}
FUTS = {'SPX': ('ES', 'CME_MINI:ES1!'), 'SPY': ('ES', 'CME_MINI:ES1!'), 'QQQ': ('NQ', 'CME_MINI:NQ1!')}
IV_INDEX = {'SPX': ('VIX', 'CBOE:VIX'), 'SPY': ('VIX', 'CBOE:VIX'), 'QQQ': ('VXN', 'CBOE:VXN')}
NEAR_DAYS, NEAR_RANGE = 45, 8
FAR_DAYS, FAR_RANGE = 400, 15
YEAR_S = 365.0 * 86400
NEAR_ATM_BAND = 0.02      # 'near ATM' = strikes within +-2% of spot
MIN_PAIRS = 5             # an expiry needs >= 5 two-sided call+put strikes near ATM to be used
SPIKE_REL = 0.12          # a term point > 12% off the median of its neighbours is hidden
SPIKE_MIN_DAYS = 5
STRADDLE_TO_SIGMA = math.sqrt(math.pi / 2)
MAX_ATM_GAP = 0.01        # the strikes used for ATM must sit within 1% of spot (2% apart at most)
FETCH_TIMEOUT = 40
POST_TIMEOUT = 15
STATE = os.environ.get('STATE_DIRECTORY', '/var/lib/opt-feeder')
CODE_RE = re.compile(r'^OPRA:([A-Z]+)\d')


def log(msg):
    print(msg, flush=True)


def in_window(now):
    t = now.astimezone(ET)
    if t.weekday() >= 5:
        return False
    m = t.hour * 60 + t.minute
    return 9 * 60 + 30 <= m <= 16 * 60 + 15 or 16 * 60 + 30 <= m <= 16 * 60 + 34


def fnum(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def rnd(x, n):
    return None if x is None else round(x, n)


# ---------------------------------------------------------------- chain parsing
def is_monthly(exp):
    """Third Friday of its month, or the Thursday before it (exchange holiday)."""
    d = date.fromisoformat(exp)
    tf = third_friday(d.year, d.month)
    return d == tf or d == tf - timedelta(days=1)


def two_sided_pairs(contracts, spot, band=NEAR_ATM_BAND):
    """Strikes within +-band of spot with BOTH a two-sided call and a two-sided put quote."""
    by = {}
    for c in contracts:
        if abs(c['k'] - spot) <= spot * band and (c.get('bid') or 0) > 0 and (c.get('ask') or 0) > (c.get('bid') or 0) - 1e-9:
            by.setdefault(c['k'], set()).add(c['cp'])
    return sum(1 for v in by.values() if len(v) == 2)


def choose_root(exp, by_root, spot, today):
    """ONE option root per expiry, never mixed (CoS 2026-10-14). SPX lists AM-settled monthlies
    (root SPX) and PM-settled dailies/weeklies (SPXW) on the same days: the monthly expiry uses SPX
    (unless it is today or tomorrow: the 0DTE/1DTE trader holds SPXW, and the AM contract has
    already settled at the open), every other expiry uses SPXW. Other underlyings have one root."""
    if len(by_root) == 1:
        return next(iter(by_root))
    near_term = (date.fromisoformat(exp) - date.fromisoformat(today)).days <= 1
    if 'SPX' in by_root and is_monthly(exp) and not near_term and two_sided_pairs(by_root['SPX'], spot) >= MIN_PAIRS:
        return 'SPX'
    if 'SPXW' in by_root:
        return 'SPXW'
    return max(by_root, key=lambda r: len(by_root[r]))


def parse_is_rows(rows, today, spot=None):
    """InsightSentry /v3/options/quotes rows -> {expiry 'YYYY-MM-DD': [contract dicts]}, one root
    per expiry (choose_root). With `spot`, expiries with fewer than MIN_PAIRS two-sided call+put
    strikes within +-2% of spot are dropped (too thin for an honest ATM / skew value)."""
    out = {}
    for r in rows:
        e = r.get('expiration')
        k = fnum(r.get('strike_price'))
        cp = 'C' if r.get('type') == 'CALL' else 'P' if r.get('type') == 'PUT' else None
        if not e or not k or not cp:
            continue
        es = str(int(e))
        exp = '%s-%s-%s' % (es[:4], es[4:6], es[6:8])
        if exp < today:
            continue
        m = CODE_RE.match(r.get('code') or '')
        root = m.group(1) if m else ''
        out.setdefault(exp, {}).setdefault(root, []).append({'k': k, 'cp': cp, 'root': root, 'bid': fnum(r.get('bid_price')),
                                                              'ask': fnum(r.get('ask_price')), 'iv': fnum(r.get('implied_volatility')),
                                                              'delta': fnum(r.get('delta'))})
    res = {}
    for exp, by_root in out.items():
        root = choose_root(exp, by_root, spot or 0, today) if spot else ('SPXW' if 'SPXW' in by_root else next(iter(by_root)))
        cs = by_root[root]
        if spot and two_sided_pairs(cs, spot) < MIN_PAIRS:
            continue
        res[exp] = cs
    return res


def despike(term, key='iv', rel=SPIKE_REL, min_days=SPIKE_MIN_DAYS):
    """Hide (set None) term-structure values more than `rel` (relative) away from the median of up
    to two neighbours on each side, worst first, one at a time (so one bad print cannot get its good
    neighbours hidden too). Points under min_days are never hidden or used as neighbours: a 0DTE /
    1DTE IV above the rest of the curve is normal, not a bad print. Returns how many were hidden."""
    hidden = 0
    while True:
        worst, wi = rel, None
        idx = [i for i, r in enumerate(term) if r.get(key) is not None and r['days'] >= min_days]
        for p, i in enumerate(idx):
            nb = sorted(term[j][key] for j in idx[max(0, p - 2):p] + idx[p + 1:p + 3])
            if len(nb) < 2:
                continue
            med = nb[len(nb) // 2] if len(nb) % 2 else (nb[len(nb) // 2 - 1] + nb[len(nb) // 2]) / 2
            if med > 0:
                dev = abs(term[i][key] - med) / med
                if dev > worst:
                    worst, wi = dev, i
        if wi is None:
            return hidden
        term[wi][key] = None
        hidden += 1


def mid(c):
    b, a = c.get('bid'), c.get('ask')
    if a is None or a <= 0:
        return None
    if b is None or b < 0:
        b = 0.0
    if b > a:
        return None
    return (a + b) / 2


def pairs(contracts):
    """strike -> {'C': c, 'P': c}, sorted by strike."""
    by = {}
    for c in contracts:
        by.setdefault(c['k'], {})[c['cp']] = c
    return sorted(by.items())


def atm_straddle(contracts, spot):
    """ATM straddle mid and ATM IV, linearly interpolated between the two listed strikes around spot
    (both need a call and a put mid). Returns (straddle, atm_iv, lower_strike) or (None, None, None)."""
    rows = []
    for k, cp in pairs(contracts):
        if 'C' in cp and 'P' in cp:
            mc, mp = mid(cp['C']), mid(cp['P'])
            if mc is None or mp is None:
                continue
            ivs = [x for x in (cp['C'].get('iv'), cp['P'].get('iv')) if x and 0.01 < x < 5]
            rows.append((k, mc + mp, sum(ivs) / len(ivs) if ivs else None))
    if not rows:
        return None, None, None
    lo = hi = None
    for r in rows:
        if r[0] <= spot:
            lo = r
        elif hi is None:
            hi = r
    if lo is None or hi is None:
        r = lo or hi
        if abs(r[0] - spot) > spot * MAX_ATM_GAP:
            return None, None, None
        return r[1], r[2], r[0]
    if hi[0] - lo[0] > spot * 2 * MAX_ATM_GAP:
        return None, None, None      # sparse far-dated strikes: no honest ATM value
    w = (spot - lo[0]) / (hi[0] - lo[0])
    st = lo[1] + w * (hi[1] - lo[1])
    iv = lo[2] + w * (hi[2] - lo[2]) if lo[2] and hi[2] else (lo[2] or hi[2])
    return st, iv, lo[0]


def iv_at_delta(contracts, cp, target):
    """IV at |delta| = target for calls (cp 'C') or puts ('P'), linear in delta between the two
    contracts around it. None when the chain does not reach that delta."""
    pts = sorted((abs(c['delta']), c['iv']) for c in contracts
                 if c['cp'] == cp and c.get('delta') is not None and c.get('iv') and 0.01 < c['iv'] < 5
                 and 0.01 < abs(c['delta']) < 0.99)
    if len(pts) < 2:
        return None
    for (d0, v0), (d1, v1) in zip(pts, pts[1:]):
        if d0 <= target <= d1:
            return v0 if d1 == d0 else v0 + (target - d0) / (d1 - d0) * (v1 - v0)
    return None


def years_to(exp, now_epoch, am=False):
    """Years from now to the settlement on the expiry day (16:00 ET PM, 09:30 ET for AM-settled
    SPX monthlies), floored at 15 minutes."""
    y, m, d = (int(x) for x in exp.split('-'))
    t = datetime(y, m, d, 9, 30, tzinfo=ET).timestamp() if am else datetime(y, m, d, 16, 0, tzinfo=ET).timestamp()
    return max(t - now_epoch, 900) / YEAR_S


def third_friday(y, m):
    d = date(y, m, 1)
    d += timedelta(days=(4 - d.weekday()) % 7)
    return d + timedelta(days=14)


def pick_expiries(exps, now_epoch):
    """exps: sorted ISO dates on/after today. Returns {'0DTE','1DTE','Weekly','Monthly'} -> expiry.
    0DTE only while today's expiry is still trading (before 16:00 ET). Weekly = the last expiry on or
    before this week's Friday (next week's once this Friday has closed). Monthly = the last expiry on
    or before the third Friday (a holiday moves it to Thursday), next month's once it has passed."""
    now = datetime.fromtimestamp(now_epoch, ET)
    today = now.date()
    closed = now.hour >= 16
    live = [e for e in exps if date.fromisoformat(e) > today or (date.fromisoformat(e) == today and not closed)]
    out = {}
    if not live:
        return out
    if date.fromisoformat(live[0]) == today:
        out['0DTE'] = live[0]
        nxt = [e for e in live if date.fromisoformat(e) > today]
        if nxt:
            out['1DTE'] = nxt[0]
    else:
        out['1DTE'] = live[0]

    def on_or_before(target):
        c = [e for e in live if date.fromisoformat(e) <= target]
        return c[-1] if c else None
    fri = today + timedelta(days=(4 - today.weekday()) % 7)
    if fri == today and closed:
        fri += timedelta(days=7)
    w = on_or_before(fri)
    if w:
        out['Weekly'] = w
    tf = third_friday(today.year, today.month)
    if tf < today or (tf == today and closed):
        tf = third_friday(today.year + (today.month == 12), today.month % 12 + 1)
    mo = on_or_before(tf)
    if mo and date.fromisoformat(mo) >= tf - timedelta(days=3):
        out['Monthly'] = mo
    return out


def interp_30d(term, key):
    """term rows dicts with 'days' and key. IV: variance-time interpolation to 30 days; anything else
    linear. Uses the expiries around 30 days, else the nearest one."""
    pts = [(r['days'], r[key]) for r in term if r.get(key) is not None and r['days'] > 0.5]
    if not pts:
        return None
    lo = [p for p in pts if p[0] <= 30]
    hi = [p for p in pts if p[0] > 30]
    if not lo or not hi:
        return (lo or hi)[-1 if lo else 0][1]
    (d0, v0), (d1, v1) = lo[-1], hi[0]
    w = (30 - d0) / (d1 - d0)
    if key == 'iv':
        var = v0 * v0 * d0 + w * (v1 * v1 * d1 - v0 * v0 * d0)
        return math.sqrt(max(var, 0) / 30)
    return v0 + w * (v1 - v0)


def iv_rank(closes, now):
    """Rank and percentile (0-100) of `now` against the closes (the last 252)."""
    xs = [c for c in closes if c is not None and c > 0][-252:]
    if len(xs) < 20 or now is None:
        return None
    lo, hi = min(xs), max(xs)
    rank = 0.0 if hi == lo else (now - lo) / (hi - lo) * 100
    pct = sum(1 for c in xs if c < now) / len(xs) * 100
    return {'rank': round(max(0.0, min(100.0, rank)), 1), 'pct': round(pct, 1), 'lo': round(lo, 2), 'hi': round(hi, 2), 'n': len(xs)}


def put_call(chain):
    """Cboe compact chain (rows [strike, cp, oi, iv, bid, ask, vol, delta]) -> P/C ratios."""
    if not chain or not chain.get('expiries'):
        return None
    tot = {'C': [0, 0], 'P': [0, 0]}
    first = sorted(chain['expiries'])[0]
    zero = {'C': [0, 0], 'P': [0, 0]}
    for exp, rows in chain['expiries'].items():
        for r in rows:
            cp = r[1]
            if cp not in tot:
                continue
            tot[cp][0] += r[6] or 0
            tot[cp][1] += r[2] or 0
            if exp == first:
                zero[cp][0] += r[6] or 0
                zero[cp][1] += r[2] or 0
    ratio = lambda p, c: round(p / c, 3) if c > 0 else None
    return {'vol': ratio(tot['P'][0], tot['C'][0]), 'oi': ratio(tot['P'][1], tot['C'][1]),
            'vol_n': [tot['P'][0], tot['C'][0]], 'oi_n': [tot['P'][1], tot['C'][1]],
            'first': first, 'vol_first': ratio(zero['P'][0], zero['C'][0]), 'oi_first': ratio(zero['P'][1], zero['C'][1]),
            'scope': 'expiries <= 31 days, strikes +-10%', 'src': 'cboe', 'chain_time': chain.get('chain_time'),
            'fetched_at': chain.get('fetched_at')}


def analyse(chains, u, spot, now_epoch, fut=None):
    """chains: {expiry: contracts} (parse_is_rows). fut: (root, futures_price) or None.
    Returns the analytics dict (no put/call, no IV rank: added by the caller)."""
    exps = sorted(chains)
    term = []
    for e in exps:
        cs = chains[e]
        T = years_to(e, now_epoch, am=bool(cs) and cs[0].get('root') == 'SPX')
        st, iv_q, k = atm_straddle(cs, spot)
        # ATM IV implied by the straddle mid itself (straddle ~= spot * iv * sqrt(T) * sqrt(2/pi)):
        # the same prices as the expected move, so it is smooth across expiries. The quoted per-strike
        # IV (iv_q) is only the fallback.
        iv = st * STRADDLE_TO_SIGMA / (spot * math.sqrt(T)) if st else iv_q
        p25, c25 = iv_at_delta(cs, 'P', 0.25), iv_at_delta(cs, 'C', 0.25)
        term.append({'x': e, 'days': T * 365, 'iv': iv, 'st': st, 'p25': p25, 'c25': c25,
                     'skew': (p25 - c25) if p25 is not None and c25 is not None else None})
    # hide bad prints: ATM IV and the skew legs, each against its own neighbours
    for k in ('iv', 'skew'):
        despike(term, k)
    for r in term:
        if r['skew'] is None:
            r['p25'] = r['c25'] = None
    by = {r['x']: r for r in term}
    ratio = (fut[1] / spot) if fut and fut[1] and spot else None
    em = []
    for label, e in pick_expiries(exps, now_epoch).items():
        r = by.get(e)
        if not r or r['st'] is None:
            continue
        m = r['st']
        row = {'k': label, 'x': e, 'days': rnd(r['days'], 3), 'em': rnd(m, 2), 'pct': rnd(m / spot * 100, 3),
               'lo': rnd(spot - m, 2), 'hi': rnd(spot + m, 2), 'iv': rnd(r['iv'], 4),
               'iv_em': rnd(spot * r['iv'] * math.sqrt(r['days'] / 365), 2) if r['iv'] else None}
        if ratio:
            fc = fut[1]
            row['fut'] = {'root': fut[0], 'c': rnd(fc, 2), 'em': rnd(m * ratio, 2), 'lo': rnd(fc - m * ratio, 2), 'hi': rnd(fc + m * ratio, 2)}
        em.append(row)
    order = {'0DTE': 0, '1DTE': 1, 'Weekly': 2, 'Monthly': 3}
    em.sort(key=lambda r: order[r['k']])
    return {
        'u': u, 'spot': rnd(spot, 2), 'em': em,
        'fut': {'root': fut[0], 'p': rnd(fut[1], 2), 'ratio': rnd(ratio, 6)} if ratio else None,
        'term': [[r['x'], rnd(r['days'], 2), rnd(r['iv'], 4), rnd(r['p25'], 4), rnd(r['c25'], 4)] for r in term
                 if r['iv'] is not None or r['p25'] is not None],
        'atm30': rnd(interp_30d(term, 'iv'), 4),
        'skew30': rnd(interp_30d(term, 'skew'), 4),
    }


# ---------------------------------------------------------------- I/O
def is_get(path, key, params=None):
    url = IS + path + ('?' + urllib.parse.urlencode(params, safe=':,!') if params else '')
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + key, 'User-Agent': UA, 'Accept': 'application/json',
                                               'Accept-Encoding': 'gzip'})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            raw = gzip.decompress(raw)
    return json.loads(raw)


def chain_for(code, key, now_epoch, spot=None):
    today = datetime.fromtimestamp(now_epoch, ET).date()
    out = {}
    calls = 0
    for d0, d1, rng in ((0, NEAR_DAYS, NEAR_RANGE), (NEAR_DAYS + 1, FAR_DAYS, FAR_RANGE)):
        j = is_get('/options/quotes', key, {'code': code, 'range': rng, 'from': (today + timedelta(days=d0)).isoformat(),
                                            'to': (today + timedelta(days=d1)).isoformat()})
        calls += 1
        for e, cs in parse_is_rows(j.get('data') or [], today.isoformat(), spot or fnum(j.get('last_price'))).items():
            out.setdefault(e, []).extend(cs)
        del j
    return out, calls


def daily_closes(code, key, now_epoch):
    """One year of daily closes for an IV index, cached for an hour in the state dir."""
    path = os.path.join(STATE, re.sub(r'[^A-Z]', '', code) + '.json')
    try:
        st = os.stat(path)
        if now_epoch - st.st_mtime < 3600:
            return json.load(open(path)), 0
    except OSError:
        pass
    j = is_get('/symbols/' + code + '/series', key, {'bar_type': 'day', 'dp': 300})
    closes = [[int(b['time']), b['close']] for b in j.get('series') or [] if fnum(b.get('close'))]
    try:
        os.makedirs(STATE, exist_ok=True)
        with open(path + '.tmp', 'w') as f:
            json.dump(closes, f)
        os.replace(path + '.tmp', path)
    except OSError:
        pass
    return closes, 1


def cboe_term(url, sym):
    req = urllib.request.Request('%s/gex-chain?sym=%s&part=term' % (url, sym), headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=POST_TIMEOUT) as r:
        raw = r.read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    return json.loads(raw)


def post(url, key, items):
    body = gzip.compress(json.dumps({'v': 1, 'items': items}, separators=(',', ':')).encode(), 6)
    req = urllib.request.Request(url + '/opt-ingest', data=body, method='POST',
                                 headers={'content-type': 'application/octet-stream', 'x-ingest-key': key, 'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=POST_TIMEOUT) as r:
            return '%s %s (%d B)' % (r.status, r.read(120).decode('utf-8', 'replace'), len(body))
    except urllib.error.HTTPError as e:
        return '%s %s' % (e.code, e.read(120).decode('utf-8', 'replace'))
    except Exception as e:
        return 'failed ' + type(e).__name__


def main(force=False):
    if not force and not in_window(datetime.now(timezone.utc)):
        return 0
    url = os.environ.get('BOOK_RECORDER_URL', '').rstrip('/')
    key = os.environ.get('BOOK_INGEST_SECRET', '')
    iskey = os.environ.get('INSIGHTSENTRY_WEBSOCKET_API_KEY', '')
    if not url or len(key) < 32 or not iskey:
        log('config missing: BOOK_RECORDER_URL / BOOK_INGEST_SECRET / INSIGHTSENTRY key')
        return 2
    t0 = time.monotonic()
    now = time.time()
    calls = 0
    codes = list(UNDERLYINGS.values()) + ['CME_MINI:ES1!', 'CME_MINI:NQ1!', 'CBOE:VIX', 'CBOE:VXN']
    try:
        q = is_get('/symbols/quotes', iskey, {'codes': ','.join(codes)})
        calls += 1
    except Exception as e:
        log('quotes failed: %s %s' % (type(e).__name__, str(e)[:80]))
        return 1
    px = {r['code']: fnum(r.get('last_price')) for r in q.get('data') or []}
    items, bad = [], 0
    for u, code in UNDERLYINGS.items():
        spot = px.get(code)
        if not spot:
            log('%s: no spot' % u)
            bad += 1
            continue
        try:
            chains, n = chain_for(code, iskey, now, spot)
            calls += n
            froot, fcode = FUTS[u]
            a = analyse(chains, u, spot, now, (froot, px.get(fcode)))
            del chains
        except Exception as e:
            log('%s chain failed: %s %s' % (u, type(e).__name__, str(e)[:80]))
            bad += 1
            continue
        iname, icode = IV_INDEX[u]
        try:
            closes, n = daily_closes(icode, iskey, now)
            calls += n
            inow = px.get(icode)
            a['ivx'] = dict(iv_rank([c for _, c in closes], inow) or {}, name=iname, now=rnd(inow, 2))
        except Exception as e:
            log('%s iv index failed: %s' % (u, type(e).__name__))
        try:
            a['pc'] = put_call(cboe_term(url, u))
        except Exception as e:
            log('%s put/call (cboe term) failed: %s' % (u, type(e).__name__))
        a['t'] = int(now)
        a['day'] = datetime.fromtimestamp(now, ET).strftime('%Y-%m-%d')
        items.append(a)
        log('%s spot=%s em=%s atm30=%s skew30=%s rank=%s pc=%s' % (
            u, a['spot'], ' '.join('%s:%s' % (r['k'], r['em']) for r in a['em']), a['atm30'], a['skew30'],
            (a.get('ivx') or {}).get('rank'), (a.get('pc') or {}).get('vol')))
    if items:
        res = post(url, key, items)
        bad += 0 if res.startswith('200') else 1
        log('ingest %d underlyings -> %s | %d IS calls %.1fs' % (len(items), res, calls, time.monotonic() - t0))
    return 1 if bad else 0


if __name__ == '__main__':
    if len(sys.argv) == 6 and sys.argv[1] == '--analyse':
        j = json.load(open(sys.argv[2]))
        now = float(sys.argv[5])
        ch = parse_is_rows(j.get('data') or [], datetime.fromtimestamp(now, ET).date().isoformat(), float(sys.argv[4]))
        print(json.dumps(analyse(ch, sys.argv[3], float(sys.argv[4]), now), separators=(',', ':')))
        sys.exit(0)
    sys.exit(main(force='--force' in sys.argv))
