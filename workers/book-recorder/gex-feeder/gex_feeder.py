#!/usr/bin/env python3
"""TradeZoro GEX chain feeder: Cboe option chains -> compact chains -> recorder Worker.

Why it exists: the full Cboe chain is ~5 MB (QQQ) and ~13 MB (SPX). Downloading and parsing that
inside the /api/gex/levels Pages Function blew Cloudflare's CPU limit (error 1102, build 528,
2026-10-13). This server does the heavy part. The Worker only stores and serves the small result,
and the API reads it with one small fetch.

Per run, for each symbol (QQQ, _SPX, SPY by default):
  - GET https://cdn.cboe.com/api/global/delayed_quotes/options/<SYM>.json (redirects to
    cdn-api.cboe.com; urllib follows it). The top-level fields are read from the head and tail of
    the document. The options array is scanned one flat {...} object at a time, so the 13 MB
    document never becomes a 13 MB tree of Python objects.
  - Keep only what the GEX engine reads (functions/api/gex/_engine.js parseCompact):
    strike, C/P, OI, IV, bid, ask, volume, delta.
    - part "near": the first 3 expiries on/after today (0DTE, 1DTE and one spare), strikes within
      +-12% of spot.
    - part "term": expiries up to 31 days out (1W / 1M modes), strikes within +-10% of spot,
      rows with OI > 0 only.
  - gzip each part (well under 200 KB; checked) and POST it to <Worker>/gex-ingest with the
    shared secret (header x-ingest-key, the same secret as the book feeder).

When: a systemd timer fires every 2 minutes. The script itself runs only on weekdays from 09:00
to 16:20 ET, plus one run between 16:30 and 16:33 ET (after the close). Use --force to run at any
other time. Stdlib only.

Config (env, /root/projects/book-feeder/feeder.env, mode 0600): BOOK_RECORDER_URL,
BOOK_INGEST_SECRET (never logged), GEX_SYMBOLS (default QQQ,_SPX,SPY,GLD).
Each run also POSTs one history snapshot per underlying (SPX, QQQ, SPY) and expiry mode
(0DTE, 1DTE) to <Worker>/gex-snap (see snapshot() below and the README, "GEX history").
Test mode: gex_feeder.py --compact <cboe.json> <now_epoch>  -> prints the compact JSON (near+term).
           gex_feeder.py --snapshot <near.json> <U> <dte> <now_epoch> -> one history snapshot.
"""
import gzip
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tide
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

CBOE = 'https://cdn.cboe.com/api/global/delayed_quotes/options/'
UA = 'Mozilla/5.0 (tradezoro-gex-feeder/1)'
ET = ZoneInfo('America/New_York')
OCC = re.compile(r'^([A-Z^]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$')
OPTS = re.compile(rb'"options"\s*:\s*\[')
OBJ = re.compile(rb'\{[^{}\[\]]*\}')      # one flat option object (no nested braces or arrays)
NEAR_EXPIRIES = 3
NEAR_BAND = 0.12
TERM_DAYS = 31
TERM_BAND = 0.10
MAX_PART = 200 * 1024
SNAP_SYMBOLS = ('SPX', 'QQQ', 'SPY', 'GLD')
FETCH_TIMEOUT = 40
POST_TIMEOUT = 15
TIDE_STATE_DIR = os.environ.get('TIDE_STATE_DIR') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tide-state')


def log(msg):
    print(msg, flush=True)


def in_window(now):
    t = now.astimezone(ET)
    if t.weekday() >= 5:
        return False
    m = t.hour * 60 + t.minute
    return 9 * 60 <= m <= 16 * 60 + 20 or 16 * 60 + 30 <= m <= 16 * 60 + 33


def num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    return v if math.isfinite(v) else 0.0


def r4(x):
    return round(x, 4)


def compact(raw, now_epoch):
    """raw: bytes of the Cboe JSON. Returns {'near': dict, 'term': dict}."""
    m0 = OPTS.search(raw)
    if not m0:
        raise ValueError('no options array')
    i = m0.end()
    j = raw.find(b']', i)             # option objects hold no arrays, so the first ] closes it
    head = json.loads(raw[:m0.start()] + b'"options":[]' + raw[j + 1:])
    data = head.get('data', head)
    spot = num(data.get('current_price'))
    if not spot > 0:
        raise ValueError('no spot')
    today = datetime.fromtimestamp(now_epoch, ET).date()
    rows = {}
    roots = {}                    # expiry -> set of OCC roots seen (SPX / SPXW)
    sym = data.get('symbol') or head.get('symbol')
    for m in OBJ.finditer(raw, i, j):
        o = json.loads(m.group(0))
        mm = OCC.match(o.get('option') or '')
        if not mm:
            continue
        exp = '20%s-%s-%s' % (mm.group(2), mm.group(3), mm.group(4))
        days = (datetime.strptime(exp, '%Y-%m-%d').date() - today).days
        if days < 0 or days > TERM_DAYS:
            continue
        k = int(mm.group(6)) / 1000
        if abs(k - spot) / spot > NEAR_BAND:
            continue
        rows.setdefault(exp, []).append([k, mm.group(5), int(num(o.get('open_interest'))), r4(num(o.get('iv'))),
                                         r4(num(o.get('bid'))), r4(num(o.get('ask'))), int(num(o.get('volume'))),
                                         r4(num(o.get('delta')))])
        roots.setdefault(exp, []).append(mm.group(1))
    # De-duplicate roots (2026-10-16): SPX lists the same strike under SPX (AM-settled monthly) and SPXW (PM-settled weekly/daily)
    # on monthly expiries; both used to be summed, double counting OI and flipping the net with whichever IV won. Per expiry: if an
    # SPXW-style root (root + 'W') exists, keep only its rows, else keep the rows as they are (SPX-only expiries).
    for e in list(rows):
        rs = roots[e]
        w = [i for i, r in enumerate(rs) if r.endswith('W') and len(r) > 1]
        if w and len(w) < len(rs):
            rows[e] = [rows[e][i] for i in w]
    exps = sorted(rows)
    meta = {'v': 1, 'symbol': sym, 'spot': spot, 'iv30': num(data.get('iv30')),
            'chain_time': data.get('last_trade_time'), 'fetched_at': int(now_epoch),
            'cols': ['strike', 'cp', 'oi', 'iv', 'bid', 'ask', 'vol', 'delta']}
    near = dict(meta, part='near', expiries={e: sorted(rows[e]) for e in exps[:NEAR_EXPIRIES]})
    term = dict(meta, part='term', expiries={
        e: sorted(r for r in rows[e] if r[2] > 0 and abs(r[0] - spot) / spot <= TERM_BAND) for e in exps})
    return {'near': near, 'term': term}


# ---- GEX history snapshots (heatmap + replay, Owner-approved 2026-10-14) ----
# Each run also computes one small snapshot per underlying and expiry mode (0DTE, 1DTE) from the
# compact 'near' chain and POSTs them to <Worker>/gex-snap, which keeps 90 days in the Durable
# Object. The maths is a line-by-line port of functions/api/gex/_engine.js (compactToContracts,
# ownGamma, profile, levels, gammaFlip, straddleRange) on Cboe's spot + IV (the API's
# compare.cboe_only); test/gex-history.test.mjs checks it against the JS engine on real chains.
# Snapshot time `t` = Cboe's chain time (the market state the numbers describe), so a replay that
# shows the latest snapshot with t <= replay time never looks ahead.
SNAP_BAND = 0.05
SQ2PI = math.sqrt(2 * math.pi)
MIN_T_SEC = 15 * 60
STRADDLE_TO_SIGMA = math.sqrt(math.pi / 2)


def et_epoch(wall):
    """'2026-10-14T13:32:30' (New York wall time, as Cboe prints it) -> epoch seconds."""
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?', str(wall or ''))
    if not m:
        return None
    y, mo, d, h, mi, se = (int(x or 0) for x in m.groups())
    return datetime(y, mo, d, h, mi, se, tzinfo=ET).timestamp()


def years_to_close(exp_iso, now_sec):
    close = datetime.strptime(exp_iso + ' 16:00', '%Y-%m-%d %H:%M').replace(tzinfo=ET).timestamp()
    return max(MIN_T_SEC, close - now_sec) / (365 * 86400)


def bs_gamma(S, K, T, sigma, r=0.045, q=0.0):
    if S <= 0 or K <= 0 or T <= 0 or sigma <= 0:
        return 0.0
    v = sigma * math.sqrt(T)
    d1 = (math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / v
    if not math.isfinite(d1) or abs(d1) > 12:
        return 0.0
    nd1 = math.exp(-0.5 * d1 * d1) / SQ2PI
    return math.exp(-q * T) * nd1 / (S * v)


def contracts_for(near, dte, now_sec):
    """compactToContracts: dte 0 -> first expiry on/after today, 1 -> the second."""
    today = datetime.fromtimestamp(now_sec, timezone.utc).date()
    groups = []
    for e in sorted(near.get('expiries') or {}):
        days = (datetime.strptime(e, '%Y-%m-%d').date() - today).days
        if days >= 0:
            groups.append((e, days, near['expiries'][e]))
    if not groups:
        return None, []
    e, days, rows = groups[min(dte, len(groups) - 1)]
    out = []
    for r in rows:
        iv = r[3] / 100 if r[3] > 3 else r[3]
        T = years_to_close(e, now_sec)
        out.append({'strike': r[0], 'cp': r[1], 'oi': r[2], 'iv': r[3], 'bid': r[4], 'ask': r[5], 'vol': r[6],
                    'exp': e, 'T': T, 'iv_n': iv})
    return e, out


def net_gex_at(x, cs):
    total = 0.0
    for c in cs:
        iv = c['iv']
        if not iv or iv <= 0:
            continue
        if iv > 3:
            iv /= 100
        g = bs_gamma(x, c['strike'], c['T'], iv)
        if not g:
            continue
        expo = g * c['oi'] * 100 * x * x * 0.01
        total += expo if c['cp'] == 'C' else -expo
    return total


def gamma_flip(spot, cs, lo_pct=0.90, hi_pct=1.10, steps=80):
    lo, hi = spot * lo_pct, spot * hi_pct
    xs = [lo + (hi - lo) * i / (steps - 1) for i in range(steps)]
    ys = [net_gex_at(x, cs) for x in xs]
    crosses = []
    for i in range(1, len(xs)):
        a, b, fa, fb = xs[i - 1], xs[i], ys[i - 1], ys[i]
        if fa == 0:
            crosses.append(a)
        elif fa * fb < 0:
            m = a
            for _ in range(28):
                m = a + (b - a) * abs(fa) / (abs(fa) + abs(fb))
                fm = net_gex_at(m, cs)
                if fm == 0:
                    break
                if fa * fm < 0:
                    b, fb = m, fm
                else:
                    a, fa = m, fm
                if abs(b - a) < spot * 1e-6:
                    break
            crosses.append(m)
    if not crosses:
        return None
    best = crosses[0]
    for x in crosses[1:]:
        best = best if abs(best - spot) < abs(x - spot) else x
    return best


def _argbest(keys, val, better):
    """JS keys.reduce((a, b) => better(val(a), val(b)) ? a : b): ties go to the later key."""
    best = keys[0]
    for k in keys[1:]:
        best = best if better(val(best), val(k)) else k
    return best


def snap_levels(spot, cs):
    gex, call_g, put_g = {}, {}, {}
    for c in cs:
        sign = 1 if c['cp'] == 'C' else -1
        g = c['gamma'] * c['oi'] * 100 * spot * spot * 0.01
        gex[c['strike']] = gex.get(c['strike'], 0.0) + sign * g
        if math.isfinite(g) and g > 0:
            side = call_g if c['cp'] == 'C' else put_g
            side[c['strike']] = side.get(c['strike'], 0.0) + sign * g
    near = lambda k, band=0.06: abs(k - spot) / spot < band
    # net-GEX walls (fallback of the fallback)
    strikes = sorted(gex)
    pool = [k for k in strikes if near(k)] or strikes
    above = [k for k in pool if k >= spot]
    below = [k for k in pool if k <= spot]
    nw_c = _argbest(above, gex.get, lambda a, b: a > b) if above else None
    nw_p = _argbest(below, gex.get, lambda a, b: a < b) if below else None
    if nw_c is None and pool:
        nw_c = _argbest(pool, gex.get, lambda a, b: a > b)
    if nw_p is None and pool:
        nw_p = _argbest(pool, gex.get, lambda a, b: a < b)
    zg = gamma_flip(spot, cs) if cs else None
    calls = [(k, g) for k, g in call_g.items() if k >= spot and near(k) and g > 0]
    puts = [(k, g) for k, g in put_g.items() if k <= spot and near(k) and g < 0]
    gw_c = gw_p = None
    if calls:
        best = calls[0]
        for x in calls[1:]:
            best = x if x[1] > best[1] else best
        gw_c = best[0]
    if puts:
        best = puts[0]
        for x in puts[1:]:
            best = x if x[1] < best[1] else best
        gw_p = best[0]
    aw_c = aw_p = None
    if gw_c is None or gw_p is None:
        cs_, ps_ = {}, {}
        floor_, ceil_ = max(spot, zg or spot), min(spot, zg or spot)
        for c in cs:
            if abs(c['strike'] - spot) / spot > 0.04:
                continue
            score = (c['vol'] or c['oi'] or 0) + 0.001 * (c['oi'] or 0)
            if c['cp'] == 'C' and c['strike'] >= floor_:
                cs_[c['strike']] = cs_.get(c['strike'], 0) + score
            if c['cp'] == 'P' and c['strike'] <= ceil_:
                ps_[c['strike']] = ps_.get(c['strike'], 0) + score
        aw_c = _argbest(list(cs_), cs_.get, lambda a, b: a > b) if cs_ else None
        aw_p = _argbest(list(ps_), ps_.get, lambda a, b: a > b) if ps_ else None
    cw = gw_c if gw_c is not None else (aw_c if aw_c is not None else nw_c)
    pw = gw_p if gw_p is not None else (aw_p if aw_p is not None else nw_p)
    net = sum(gex.get(k, 0.0) for k in pool)
    return gex, cw, pw, zg, net


def straddle_range(spot, cs, now_sec):
    if not spot > 0 or not cs:
        return None
    seen = []
    for c in cs:
        if c['strike'] not in seen:
            seen.append(c['strike'])
    strikes = sorted(seen, key=lambda k: abs(k - spot))
    mid = lambda o: (o['bid'] + o['ask']) / 2 if o and o['bid'] > 0 and o['ask'] >= o['bid'] else None
    for k in strikes[:3]:
        c = next((x for x in cs if x['strike'] == k and x['cp'] == 'C'), None)
        p = next((x for x in cs if x['strike'] == k and x['cp'] == 'P'), None)
        mc, mp = mid(c), mid(p)
        if mc is not None and mp is not None:
            return spot, (mc + mp) * STRADDLE_TO_SIGMA
    k = strikes[0]
    ivs = [(x['iv'] / 100 if x['iv'] > 3 else x['iv']) for x in cs if x['strike'] == k and x['iv'] > 0]
    if not ivs:
        return None
    sigma = sum(ivs) / len(ivs) * math.sqrt(years_to_close(next(x['exp'] for x in cs if x['strike'] == k), now_sec)) * spot
    return (spot, sigma) if sigma > 0 else None


def num_out(x):
    return int(x) if x is not None and float(x).is_integer() else x


def rnd(x, d):
    return None if x is None or not math.isfinite(x) else round(x, d)


def snapshot(near, dte, u, now_epoch):
    """One history snapshot from the compact 'near' chain, or None (no chain time / prior day)."""
    t = et_epoch(near.get('chain_time'))
    if not t:
        return None
    # The feeder trims expired expiries by today's date, so a chain still printed on an earlier
    # day (09:00-09:30 runs) would be priced against the wrong expiry: skip it.
    if datetime.fromtimestamp(t, ET).date() != datetime.fromtimestamp(now_epoch, ET).date():
        return None
    spot = float(near['spot'])
    exp, cs = contracts_for(near, dte, t)
    if len(cs) < 20:
        return None
    for c in cs:
        c['gamma'] = bs_gamma(spot, c['strike'], c['T'], c['iv_n']) if c['iv_n'] > 0 else 0.0
    gex, cw, pw, zg, net = snap_levels(spot, cs)
    em = straddle_range(spot, cs, t)
    ks = sorted(k for k in gex if abs(k - spot) / spot <= SNAP_BAND)
    kk = [int(k) if float(k).is_integer() else k for k in ks]     # 7325 not 7325.0 (smaller JSON)
    return {'u': u, 'd': dte, 'day': datetime.fromtimestamp(t, ET).strftime('%Y-%m-%d'), 't': int(round(t)),
            'fa': int(now_epoch), 'x': exp, 's': rnd(spot, 2), 'cw': num_out(cw), 'pw': num_out(pw), 'zg': rnd(zg, 2), 'n': rnd(net / 1e6, 2),
            'em': [rnd(em[0], 2), rnd(em[1], 3)] if em else None,
            'k': kk, 'g': [rnd(gex[k] / 1e6, 2) for k in ks]}


def fetch(sym):
    req = urllib.request.Request(CBOE + sym + '.json', headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as r:
        return r.read()


def post(url, key, sym, part, body):
    req = urllib.request.Request('%s/gex-ingest?sym=%s&part=%s' % (url, sym.lstrip('_'), part), data=body, method='POST',
                                 headers={'content-type': 'application/octet-stream', 'x-ingest-key': key, 'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=POST_TIMEOUT) as r:
            return '%s %s' % (r.status, r.read(120).decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        return '%s %s' % (e.code, e.read(120).decode('utf-8', 'replace'))
    except Exception as e:
        return 'failed ' + type(e).__name__


def post_snaps(url, key, snaps):
    body = gzip.compress(json.dumps({'v': 1, 'snaps': snaps}, separators=(',', ':')).encode(), 6)
    req = urllib.request.Request(url + '/gex-snap', data=body, method='POST',
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
    syms = [s.strip().upper() for s in os.environ.get('GEX_SYMBOLS', 'QQQ,_SPX,SPY,GLD').split(',') if s.strip()]
    if not url or len(key) < 32:
        log('config missing: BOOK_RECORDER_URL / BOOK_INGEST_SECRET')
        return 2
    bad = 0
    snaps = []
    tide_samples = []
    for sym in syms:
        t0 = time.monotonic()
        try:
            raw = fetch(sym)
            parts = compact(raw, time.time())
            size = len(raw)
            tide_step(sym.lstrip('_'), raw, tide_samples)
            del raw
        except Exception as e:
            log('%s fetch/parse failed: %s %s' % (sym, type(e).__name__, str(e)[:80]))
            bad += 1
            continue
        out = []
        for part, d in parts.items():
            body = gzip.compress(json.dumps(d, separators=(',', ':')).encode(), 6)
            if len(body) > MAX_PART:
                out.append('%s too big %d B' % (part, len(body)))
                bad += 1
                continue
            res = post(url, key, sym, part, body)
            bad += 0 if res.startswith('200') else 1
            out.append('%s %d exp %d B -> %s' % (part, len(d['expiries']), len(body), res))
        log('%s spot=%s chain=%s src=%d B %.1fs | %s' % (sym, parts['near']['spot'], parts['near']['chain_time'], size,
                                                     time.monotonic() - t0, ' | '.join(out)))
        u = sym.lstrip('_')
        if u in SNAP_SYMBOLS:
            for dte in (0, 1):
                try:
                    sn = snapshot(parts['near'], dte, u, time.time())
                    if sn:
                        snaps.append(sn)
                except Exception as e:
                    log('%s %dDTE snapshot failed: %s %s' % (u, dte, type(e).__name__, str(e)[:80]))
    # chain parts refresh every run (1 min, the Cboe file's own cadence); history snapshots stay every 2nd minute
    # so the recorder's heatmap/replay store grows at the same rate as before (2026-10-16).
    if snaps and datetime.now(timezone.utc).minute % 2 == 0:
        res = post_snaps(url, key, snaps)
        bad += 0 if res.startswith('200') else 1
        log('history: %d snapshots -> %s' % (len(snaps), res))
    # ZoroTide (Owner order 2026-10-29): one options-money-flow sample per symbol per Cboe reprint, every run
    if tide_samples:
        res = post_tide(url, key, tide_samples)
        bad += 0 if res.startswith('200') else 1
        log('tide: %d samples -> %s' % (len(tide_samples), res))
    return 1 if bad else 0


def tide_step(u, raw, out):
    """ZoroTide: this chain's change in per-contract volume -> one sample (see tide.py). Never fails the run."""
    if u not in tide.TIDE_SYMBOLS:
        return
    try:
        spot, ctime, rows = tide.read_chain(raw)
        path = os.path.join(TIDE_STATE_DIR, 'tide-%s.json' % u)
        sample, state = tide.step(tide.load_state(path), spot, ctime, rows)
        if state is not None:
            tide.save_state(path, state)
        if sample:
            sample['u'] = u
            out.append(sample)
    except Exception as e:
        log('%s tide failed: %s %s' % (u, type(e).__name__, str(e)[:80]))


def post_tide(url, key, samples):
    body = gzip.compress(json.dumps({'v': 1, 'snaps': samples}, separators=(',', ':')).encode(), 6)
    req = urllib.request.Request(url + '/tide-snap', data=body, method='POST',
                                 headers={'content-type': 'application/octet-stream', 'x-ingest-key': key, 'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=POST_TIMEOUT) as r:
            return '%s %s (%d B)' % (r.status, r.read(120).decode('utf-8', 'replace'), len(body))
    except urllib.error.HTTPError as e:
        return '%s %s' % (e.code, e.read(120).decode('utf-8', 'replace'))
    except Exception as e:
        return 'failed ' + type(e).__name__


if __name__ == '__main__':
    if len(sys.argv) == 6 and sys.argv[1] == '--snapshot':
        # test mode: gex_feeder.py --snapshot <near.json> <U> <dte> <now_epoch> -> the snapshot JSON
        print(json.dumps(snapshot(json.load(open(sys.argv[2])), int(sys.argv[4]), sys.argv[3], float(sys.argv[5])), separators=(',', ':')))
        sys.exit(0)
    if len(sys.argv) == 3 and sys.argv[1] == '--tide':
        # test mode: gex_feeder.py --tide <cboe.json> -> the chain's ZoroTide rows (spot, chain time, contracts with volume)
        _s, _t, _r = tide.read_chain(open(sys.argv[2], 'rb').read())
        print(json.dumps({'spot': _s, 'time': _t, 'n': len(_r)}))
        sys.exit(0)
    if len(sys.argv) == 4 and sys.argv[1] == '--compact':
        print(json.dumps(compact(open(sys.argv[2], 'rb').read(), float(sys.argv[3])), separators=(',', ':')))
        sys.exit(0)
    sys.exit(main(force='--force' in sys.argv))
