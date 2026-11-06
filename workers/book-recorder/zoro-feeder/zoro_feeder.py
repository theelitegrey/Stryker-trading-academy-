#!/usr/bin/env python3
"""ZoroOptions feeder: Cboe option chains (+ a few InsightSentry calls) -> per-symbol analytics -> recorder Worker.

Roadmap: ZoroOptions module (spec: stryker-notes/reports/workers/zoro-options-spec.md, research section 2).
The browser never calls a vendor: this server pulls, computes, and POSTs small gzip JSON to <Worker>/zo-ingest.

Schedule (one oneshot run a minute from zoro-feeder.timer; the script only works weekdays 09:30-16:15 ET
plus the after-close runs 16:30-16:44 ET; --force runs tier A once at any time):
  tier A  SPX, SPY, QQQ, IWM, GLD, USO       every even minute (every 2 min)
  tier B  the 100 stocks (STOCKS below)       stocks[minute % 15 :: 15], so each one is pulled every 15 min
          and a minute holds ~7 of them (staggered, never in parallel)
  CME     ES, NQ, RTY, GC, CL from InsightSentry at 09:35, 12:30 and 15:45 ET (front 2 expiries, OI on the
          strikes nearest price) + one whole-chain pull at 09:35 for the expiry list
  vol     VIX, VXN, RVX, GVZ, OVX (+ VXAPL, VXAZN, VXGOG, VXGS): daily closes from Cboe's free history file once a
          day, the current value from Cboe's quote file each tier-A run (IV rank). Underlying daily closes (realised
          vol) from the same Cboe history file. No InsightSentry call for either.
  IS budget: CME 3 x 10 + whole chain 5 = 35 a weekday, hard stop ZORO_IS_DAY_MAX (55). Every IS call is counted
  and posted to /is-note as src "zoro".

Per symbol and pull (all from ONE Cboe chain, gzip download):
  levels      Call Ceiling / Put Floor / Flip Line / net gamma (Gamma Zone) per expiry mode 0 / 1 / w / m / all
              (gex_feeder.snap_levels, the same maths as the site's GEX engine), Gamma Nodes 1-10, Pin Strike
  profile     per strike: net GEX, DEX, vanna, charm ($M, dealer-sign convention: calls +, puts -, as GEX),
              call/put volume, call/put OI, strikes within +-6 % of spot
  ranges      Zoro Range 0DTE / 1DTE / weekly / monthly (opt_feeder.analyse: ATM straddle mid), futures mapped
  vol         term structure, 25-delta skew, 30-day ATM IV, Cboe iv30, IV rank (index: its vol index; stock: our own
              daily iv30 record once it has 60 days), 20-day realised vol (Yahoo daily closes, cached a day)
  flow        put/call (volume, OI; 0DTE and <= 31 days), Fresh Volume (volume > OI), Volume Bursts (volume added
              since the previous pull of the same symbol), OI change by strike (today's first pull vs yesterday's)
  surfaces    gamma (strike x expiry <= 90 d) and IV (moneyness x expiry), every 15 min (A) / 30 min (B)
State (small JSON files) lives in STATE_DIRECTORY (/var/lib/zoro-feeder): last volumes per contract, daily OI,
daily IV / P/C / term records, vol-index closes, CME expiries, IS calls today.

Env: BOOK_RECORDER_URL, BOOK_INGEST_SECRET (feeder.env), INSIGHTSENTRY_WEBSOCKET_API_KEY (CME + vol indices only).
Nothing secret is ever logged. Stdlib only. Education only. Not financial advice.
Test / fixture mode: zoro_feeder.py --analyse <cboe.json[.gz]> <U> <now_epoch>  -> the ingest payload JSON.
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

HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (HERE, os.path.join(HERE, '..', 'gex-feeder'), os.path.join(HERE, '..', 'opt-feeder')):
    if os.path.isdir(_p) and _p not in sys.path:
        sys.path.append(_p)
import gex_feeder as gx   # noqa: E402  (bs_gamma, gamma_flip, snap_levels, years_to_close, et_epoch)
import opt_feeder as of   # noqa: E402  (analyse, pick_expiries, iv_rank, atm_straddle)

CBOE = 'https://cdn.cboe.com/api/global/delayed_quotes/options/'
IS = 'https://api.insightsentry.com/v3'
YAHOO = 'https://query1.finance.yahoo.com'
UA = 'Mozilla/5.0 (tradezoro-zoro-feeder/1)'
ET = ZoneInfo('America/New_York')
OCC = re.compile(r'^([A-Z^]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$')
OPTS = re.compile(rb'"options"\s*:\s*\[')
OBJ = re.compile(rb'\{[^{}\[\]]*\}')

TIER_A = ['_SPX', 'SPY', 'QQQ', 'IWM', 'GLD', 'USO']
# shortcut: a fixed list of 100 US stocks with the busiest option markets (spec open decision 4: the Owner may pick a
# weekly refreshed top-100 instead); override with env ZORO_STOCKS=AAPL,MSFT,...
STOCKS = ('AAPL NVDA TSLA AMZN MSFT META GOOGL AMD NFLX AVGO PLTR MSTR COIN SMCI INTC MU BABA UBER BA '
          'JPM BAC C WFC GS MS XOM CVX DIS NKE SBUX MCD WMT TGT COST HD LOW PFE MRK JNJ LLY ABBV UNH CVS '
          'T VZ KO PEP CSCO ORCL CRM ADBE QCOM TXN SHOP XYZ PYPL SOFI HOOD RIVN LCID NIO F GM DAL AAL UAL CCL '
          'RCL MARA RIOT ARM SNOW CRWD PANW NET DDOG ZS ROKU SNAP PINS RBLX DKNG ABNB DASH LYFT CHWY GME AMC '
          'TSM ASML MRVL ON APP CMCSA CLF FCX NEM B SLB OXY').split()
FUT_OF = {'SPX': ('ES', 'ES=F'), 'QQQ': ('NQ', 'NQ=F'), 'IWM': ('RTY', 'RTY=F'), 'GLD': ('GC', 'GC=F'), 'USO': ('CL', 'CL=F')}
# 30-day vol index per symbol (Cboe, free): IV rank today = the index now vs its last 252 closes. Other stocks get a rank
# from our own daily iv30 record once it holds 60 days (never invented before that).
VOL_INDEX = {'SPX': 'VIX', 'SPY': 'VIX', 'QQQ': 'VXN', 'IWM': 'RVX', 'GLD': 'GVZ', 'USO': 'OVX',
             'AAPL': 'VXAPL', 'AMZN': 'VXAZN', 'GOOGL': 'VXGOG', 'GOOG': 'VXGOG', 'GS': 'VXGS'}
CBOE_HIST = 'https://cdn.cboe.com/api/global/delayed_quotes/charts/historical/'
CBOE_QUOTE = 'https://cdn.cboe.com/api/global/delayed_quotes/quotes/'
CME = {'ES': ('CME_MINI:ES1!', 50, 'SPX'), 'NQ': ('CME_MINI:NQ1!', 20, 'QQQ'), 'RTY': ('CME_MINI:RTY1!', 50, 'IWM'),
       'GC': ('COMEX:GC1!', 100, 'GLD'), 'CL': ('NYMEX:CL1!', 1000, 'USO')}
CME_SLOTS = ((9, 35), (12, 30), (15, 45))          # ET; a slot runs on the first run within 20 min after it
IS_DAY_MAX = int(os.environ.get('ZORO_IS_DAY_MAX', '55'))
# Cboe rate-limits by IP and gex_feeder.py (GEX+, ZoroTide) shares this server's IP: on 2026-11-06 ~160 pulls in ~2 min
# drew HTTP 429 for about a minute and gex_feeder lost one run. So: at most 13 pulls a minute here, PULL_GAP s apart, and
# the run stops at the first 429 (the rest wait for the next minute).
PULL_GAP = float(os.environ.get('ZORO_PULL_GAP', '2.5'))

KEEP_DAYS = 90            # contracts kept from the chain: expiries <= 90 days (surfaces), strikes +-15 %
KEEP_BAND = 0.15
TERM_DAYS = 31            # 'all' mode, put/call and fresh volume: expiries <= 31 days (as the GEX term part)
PROFILE_BAND = 0.06
LEVEL_BAND = 0.12         # contracts used for levels / flip search (= gex_feeder NEAR_BAND, so 0DTE levels match GEX+)
MODES = ('0', '1', 'w', 'm', 'all')
FRESH_MIN_VOL, FRESH_MIN_PREM = 500, 50_000
BURST_MIN_VOL, BURST_MIN_PREM = 1000, 250_000
MAX_ROWS = 40
SURF_K = 41               # gamma surface strike bins across +-6 %
SURF_M = [round(0.85 + 0.025 * i, 3) for i in range(13)]   # IV surface moneyness 0.85 .. 1.15
MAX_GZ = {'summary': 32 * 1024, 'profile': 128 * 1024, 'surface': 256 * 1024, 'activity': 96 * 1024, 'screen': 128 * 1024,
          'cme': 128 * 1024}     # = S2 ZO_MAX_GZ
FETCH_TIMEOUT, POST_TIMEOUT = 40, 20
STATE = os.environ.get('STATE_DIRECTORY', '/var/lib/zoro-feeder')
R, Q = 0.045, 0.0
SQ2PI = math.sqrt(2 * math.pi)
IS_CALLS = [0]


def log(msg):
    print(msg, flush=True)


def num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    return v if math.isfinite(v) else 0.0


def rnd(x, d=2):
    return None if x is None or not isinstance(x, (int, float)) or not math.isfinite(x) else round(x, d)


def k_out(k):
    return int(k) if float(k).is_integer() else k


# ------------------------------------------------------------------ parsing
def parse_chain(raw, now_epoch, max_days=KEEP_DAYS):
    """Cboe JSON bytes -> (head dict, contracts). One root per expiry (SPXW over SPX, as gex_feeder.compact).
    Contracts: expiries 0..KEEP_DAYS days, strikes within KEEP_BAND of spot."""
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    m0 = OPTS.search(raw)
    if not m0:
        raise ValueError('no options array')
    i = m0.end()
    j = raw.find(b']', i)
    top = json.loads(raw[:m0.start()] + b'"options":[]' + raw[j + 1:])
    data = top.get('data', top)
    spot = num(data.get('current_price'))
    if not spot > 0:
        raise ValueError('no spot')
    ct = gx.et_epoch(data.get('last_trade_time')) or now_epoch
    today = datetime.fromtimestamp(now_epoch, ET).date()
    by = {}
    for m in OBJ.finditer(raw, i, j):
        o = json.loads(m.group(0))
        mm = OCC.match(o.get('option') or '')
        if not mm:
            continue
        exp = '20%s-%s-%s' % (mm.group(2), mm.group(3), mm.group(4))
        days = (date.fromisoformat(exp) - today).days
        if days < 0 or days > max_days:
            continue
        k = int(mm.group(6)) / 1000
        if abs(k - spot) / spot > KEEP_BAND:
            continue
        by.setdefault(exp, {}).setdefault(mm.group(1), []).append({
            'k': k, 'cp': mm.group(5), 'x': exp, 'root': mm.group(1), 'oi': int(num(o.get('open_interest'))),
            'iv': num(o.get('iv')), 'bid': num(o.get('bid')), 'ask': num(o.get('ask')), 'vol': int(num(o.get('volume'))),
            'delta': num(o.get('delta')), 'last': num(o.get('last_trade_price'))})
    out = []
    for exp, roots in by.items():
        w = [r for r in roots if r.endswith('W') and len(r) > 1]
        for r in (w if w and len(w) < len(roots) else roots):
            out.extend(roots[r])
    head = {'u': (data.get('symbol') or top.get('symbol') or '').lstrip('_'), 'spot': spot, 't': int(ct),
            'chain_time': data.get('last_trade_time'), 'iv30': num(data.get('iv30')) or None,
            'iv30_chg': num(data.get('iv30_change')), 'chg_pct': num(data.get('price_change_percent')),
            'prev_close': num(data.get('prev_day_close')), 'volume': int(num(data.get('volume')))}
    return head, out


# ------------------------------------------------------------------ greeks
def bs_greeks(S, K, T, sigma):
    """(gamma, vanna, charm_per_day) for one option (vanna and charm are the same for calls and puts with q = 0).
    vanna = dDelta/dSigma (per 1.00 of vol), charm = -dDelta/dT expressed per calendar day (delta change by tomorrow)."""
    if S <= 0 or K <= 0 or T <= 0 or sigma <= 0:
        return 0.0, 0.0, 0.0
    sq = math.sqrt(T)
    v = sigma * sq
    d1 = (math.log(S / K) + (R - Q + 0.5 * sigma * sigma) * T) / v
    if not math.isfinite(d1) or abs(d1) > 12:
        return 0.0, 0.0, 0.0
    d2 = d1 - v
    n = math.exp(-0.5 * d1 * d1) / SQ2PI
    gamma = n / (S * v)
    vanna = -n * d2 / sigma
    charm = -n * (2 * R * T - d2 * v) / (2 * T * v) / 365.0
    return gamma, vanna, charm


def enrich(spot, cs, now_epoch):
    for c in cs:
        c['T'] = gx.years_to_close(c['x'], now_epoch)
        c['strike'], c['exp'] = c['k'], c['x']
        g, va, ch = bs_greeks(spot, c['k'], c['T'], c['iv']) if c['iv'] > 0 else (0.0, 0.0, 0.0)
        c['gamma'], c['vanna'], c['charm'] = g, va, ch
    return cs


def expiry_sets(cs, now_epoch):
    """mode -> sorted expiries. 0 = first expiry still trading, 1 = the second, w = up to this week's expiry,
    m = up to the monthly, all = every expiry <= 31 days."""
    exps = sorted({c['x'] for c in cs})
    now = datetime.fromtimestamp(now_epoch, ET)
    live = [e for e in exps if date.fromisoformat(e) > now.date() or (date.fromisoformat(e) == now.date() and now.hour < 16)]
    if not live:
        return {}
    pick = of.pick_expiries(live, now_epoch)
    out = {'0': live[:1], '1': live[1:2] or live[:1],
           'all': [e for e in live if (date.fromisoformat(e) - now.date()).days <= TERM_DAYS]}
    out['w'] = [e for e in live if e <= pick.get('Weekly', live[0])]
    out['m'] = [e for e in live if e <= pick.get('Monthly', out['all'][-1] if out['all'] else live[0])]
    return out


def levels_for(spot, cs):
    """Levels from one expiry set: Call Ceiling, Put Floor, Flip Line, net GEX ($M), Gamma Nodes, Pin Strike."""
    use = [c for c in cs if abs(c['k'] - spot) / spot <= LEVEL_BAND]      # same rows as the GEX+ near part
    if len(use) < 20:
        return None
    gex, cw, pw, zg, net = gx.snap_levels(spot, use)
    tot = sum(abs(v) for v in gex.values()) or 1.0
    nodes = sorted(gex, key=lambda k: -abs(gex[k]))[:10]
    from_rows = [{'strike': c['k'], 'cp': c['cp'], 'oi': c['oi']} for c in cs]
    return {'cw': k_out(cw) if cw is not None else None, 'pw': k_out(pw) if pw is not None else None, 'zg': rnd(zg, 2),
            'net': rnd(net / 1e6, 2), 'zone': 'cushion' if net >= 0 else 'swing', 'mp': max_pain(from_rows, spot),
            'nodes': [[k_out(k), rnd(gex[k] / 1e6, 2), rnd(abs(gex[k]) / tot, 4)] for k in nodes]}


def max_pain(rows, spot):
    """Pin Strike: the strike where all listed options are worth the least at expiry (port of chart-gex-ladder-core maxPain)."""
    agg = {}
    for r in rows:
        if r['oi'] > 0 and r['cp'] in ('C', 'P'):
            a = agg.setdefault(r['strike'], [0, 0])
            a[0 if r['cp'] == 'C' else 1] += r['oi']
    if not agg:
        return None
    ks = sorted(agg)
    best, bv = None, float('inf')
    for s in ks:
        pay = sum(c * max(s - k, 0) + p * max(k - s, 0) for k, (c, p) in agg.items())
        if pay < bv or (best is not None and pay == bv and abs(s - spot) < abs(best - spot)):
            bv, best = pay, s
    return k_out(best)


def profile_rows(spot, cs):
    """Per strike within +-6 %: [k, gex $M, dex $M, vanna $M per vol point, charm $M per day, call vol, put vol, call OI, put OI]."""
    acc = {}
    for c in cs:
        if abs(c['k'] - spot) / spot > PROFILE_BAND:
            continue
        a = acc.setdefault(c['k'], [0.0, 0.0, 0.0, 0.0, 0, 0, 0, 0])
        sign = 1 if c['cp'] == 'C' else -1
        oi100 = c['oi'] * 100
        a[0] += sign * c['gamma'] * oi100 * spot * spot * 0.01
        a[1] += c['delta'] * oi100 * spot
        a[2] += sign * c['vanna'] * oi100 * spot * 0.01
        a[3] += sign * c['charm'] * oi100 * spot
        a[4 if c['cp'] == 'C' else 5] += c['vol']
        a[6 if c['cp'] == 'C' else 7] += c['oi']
    return [[k_out(k)] + [rnd(v / 1e6, 3) for v in a[:4]] + a[4:] for k, a in sorted(acc.items())]


def mid(c):
    return (c['bid'] + c['ask']) / 2 if c['ask'] > 0 and c['ask'] >= c['bid'] >= 0 else 0.0


def put_call(cs, first):
    s = {'C': [0, 0, 0, 0], 'P': [0, 0, 0, 0]}
    for c in cs:
        a = s[c['cp']]
        a[0] += c['vol']; a[1] += c['oi']
        if c['x'] == first:
            a[2] += c['vol']; a[3] += c['oi']
    ratio = lambda i: round(s['P'][i] / s['C'][i], 3) if s['C'][i] > 0 else None
    return {'vol': ratio(0), 'oi': ratio(1), 'vol_0': ratio(2), 'oi_0': ratio(3), 'cvol': s['C'][0], 'pvol': s['P'][0],
            'scope': 'expiries <= 31 days'}


def fresh_volume(cs):
    """Fresh Volume: today's volume above open interest, >= 500 contracts and >= $50k at mid. Sorted by volume / OI."""
    out = []
    for c in cs:
        m = mid(c)
        prem = c['vol'] * m * 100
        if c['vol'] > c['oi'] and c['vol'] >= FRESH_MIN_VOL and prem >= FRESH_MIN_PREM:
            out.append({'x': c['x'], 'k': k_out(c['k']), 'cp': c['cp'], 'vol': c['vol'], 'oi': c['oi'],
                        'ratio': rnd(c['vol'] / c['oi'], 2) if c['oi'] else None, 'mid': rnd(m, 2), 'prem': int(prem)})
    out.sort(key=lambda r: -(r['ratio'] if r['ratio'] is not None else 1e9))
    return out


def cid(c):
    return '%s|%s|%s' % (c['x'], k_out(c['k']), c['cp'])


def bursts(prev, cs, t):
    """Volume Bursts: volume added since the previous pull (prev = {'t', 'day', 'vols'}), >= 1,000 contracts or $250k at mid.
    Returns (rows, new_state). The first pull of a day only sets the baseline. Not single trades; no side."""
    day = datetime.fromtimestamp(t, ET).strftime('%Y-%m-%d')
    vols = {cid(c): c['vol'] for c in cs if c['vol'] > 0}
    rows = []
    if prev and prev.get('day') == day and t > prev.get('t', 0):
        pv = prev.get('vols') or {}
        for c in cs:
            dv = c['vol'] - pv.get(cid(c), 0)
            if dv <= 0:
                continue
            m = mid(c)
            if dv >= BURST_MIN_VOL or dv * m * 100 >= BURST_MIN_PREM:
                rows.append({'t0': int(prev['t']), 't1': int(t), 'x': c['x'], 'k': k_out(c['k']), 'cp': c['cp'],
                             'dv': dv, 'mid': rnd(m, 2), 'prem': int(dv * m * 100)})
        for k, v in pv.items():       # keep the day's highest count, so a dip-and-recover is not counted twice
            if v > vols.get(k, 0):
                vols[k] = v
    elif prev and prev.get('day') == day:
        return [], prev               # Cboe did not reprint
    rows.sort(key=lambda r: -r['prem'])
    return rows[:MAX_ROWS], {'day': day, 't': int(t), 'vols': vols}


def oi_by_strike(cs, spot):
    acc = {}
    for c in cs:
        if abs(c['k'] - spot) / spot <= LEVEL_BAND:
            a = acc.setdefault(k_out(c['k']), [0, 0])
            a[0 if c['cp'] == 'C' else 1] += c['oi']
    return acc


def oi_change(today_oi, yday_oi):
    """[[k, call OI change, put OI change, call OI, put OI]] for strikes in today's store; None without yesterday."""
    if not yday_oi or not today_oi:
        return None
    out = []
    for k in sorted(today_oi, key=float):
        c, p = today_oi[k]
        yc, yp = yday_oi.get(str(k), yday_oi.get(k, [0, 0]))
        out.append([k_out(float(k)), c - yc, p - yp, c, p])
    return out


def gamma_surface(spot, cs):
    lo, hi = spot * (1 - PROFILE_BAND), spot * (1 + PROFILE_BAND)
    step = (hi - lo) / (SURF_K - 1)
    xs = sorted({c['x'] for c in cs})
    z = [[0.0] * SURF_K for _ in xs]
    xi = {x: i for i, x in enumerate(xs)}
    for c in cs:
        if lo <= c['k'] <= hi and c['oi'] > 0:
            b = int(round((c['k'] - lo) / step))
            z[xi[c['x']]][b] += (1 if c['cp'] == 'C' else -1) * c['gamma'] * c['oi'] * 100 * spot * spot * 0.01
    keep = [i for i, row in enumerate(z) if any(row)]
    return {'kind': 'gamma', 'units': '$M per 1% move', 'k': [rnd(lo + step * b, 2) for b in range(SURF_K)],
            'x': [xs[i] for i in keep], 'z': [[rnd(v / 1e6, 3) for v in z[i]] for i in keep]}


def iv_surface(spot, cs, now_epoch):
    """OTM IV (puts below spot, calls above) by moneyness bin x expiry, mean of the contracts in the bin."""
    half = 0.0125
    by = {}
    for c in cs:
        if 0.01 < c['iv'] < 5 and ((c['cp'] == 'P' and c['k'] <= spot) or (c['cp'] == 'C' and c['k'] > spot)):
            by.setdefault(c['x'], []).append((c['k'] / spot, c['iv']))
    rows, keep = [], []
    for x in sorted(by):
        row = []
        for m in SURF_M:
            v = [iv for mo, iv in by[x] if abs(mo - m) <= half]
            row.append(rnd(sum(v) / len(v), 4) if v else None)
        if sum(1 for v in row if v is not None) >= 3:
            rows.append(row); keep.append(x)
    today = datetime.fromtimestamp(now_epoch, ET).date()
    return {'kind': 'iv', 'units': 'IV (1.00 = 100 %)', 'm': SURF_M, 'x': keep,
            'days': [(date.fromisoformat(x) - today).days for x in keep], 'z': rows}


def realised_vol(closes, n=20):
    xs = [c for c in closes if c and c > 0][-(n + 1):]
    if len(xs) < n + 1:
        return None
    r = [math.log(b / a) for a, b in zip(xs, xs[1:])]
    mu = sum(r) / len(r)
    return math.sqrt(sum((x - mu) ** 2 for x in r) / (len(r) - 1) * 252)


# ------------------------------------------------------------------ one symbol
def analyse(raw, u, now_epoch, st=None, fut=None, surfaces=True):
    """Everything for one Cboe chain. st: state dict for this symbol (mutated: bursts, oi, daily records) or None.
    fut: (root, futures price) for mapped levels. Returns the /zo-ingest payload (kind 'sym')."""
    st = st if st is not None else {}
    tier = 'A' if ('_' + u in TIER_A or u in TIER_A) else 'B'
    head, cs = parse_chain(raw, now_epoch, max_days=100000 if tier == 'A' else KEEP_DAYS)
    spot, t = head['spot'], head['t']
    day = datetime.fromtimestamp(t, ET).strftime('%Y-%m-%d')
    if tier == 'A':
        # every expiry (LEAPS included), once a day with the day's OI: the "all expiries" levels. Same chain file, 0 extra MB.
        if (st.get('full') or {}).get('day') != day:
            enrich(spot, cs, t)
            lf = levels_for(spot, cs)
            if lf:
                st['full'] = dict(lf, day=day, t=t, x_n=len({c['x'] for c in cs}), x_last=max(c['x'] for c in cs))
        cut = (datetime.fromtimestamp(now_epoch, ET).date() + timedelta(days=KEEP_DAYS)).isoformat()
        cs = [c for c in cs if c['x'] <= cut]
    enrich(spot, cs, t)
    sets = expiry_sets(cs, t)
    term_cs = [c for c in cs if c['x'] in set(sets.get('all', []))]
    levels, profile = {}, {}
    for md in MODES:
        sub = [c for c in cs if c['x'] in set(sets.get(md, []))]
        levels[md] = levels_for(spot, sub)
        if levels[md]:
            levels[md]['x'] = sets[md]
        profile[md] = profile_rows(spot, sub)
    # vol: opt_feeder.analyse wants {expiry: [{'k','cp','root','bid','ask','iv','delta'}]}
    chains = {}
    for c in cs:
        chains.setdefault(c['x'], []).append(c)
    a = of.analyse({x: v for x, v in chains.items() if len(v) >= 10}, u, spot, t, fut=fut)
    first = sets['0'][0] if sets.get('0') else None
    pc = put_call(term_cs, first)
    pins = []
    for x in sorted(chains)[:6]:
        mp = max_pain([{'strike': c['k'], 'cp': c['cp'], 'oi': c['oi']} for c in chains[x]], spot)
        if mp is not None:
            pins.append([x, mp, rnd((mp - spot) / spot * 100, 2)])
    fresh = fresh_volume(term_cs)
    brows, st['burst'] = bursts(st.get('burst'), term_cs, t)
    # daily OI store: the first pull of the day (OI is the previous close's, updated overnight)
    oi_store = st.setdefault('oi', {})
    if day not in oi_store and datetime.fromtimestamp(t, ET).hour * 60 + datetime.fromtimestamp(t, ET).minute >= 9 * 60 + 30:
        oi_store[day] = oi_by_strike(term_cs, spot)
        for d in sorted(oi_store)[:-2]:
            del oi_store[d]
    days = sorted(d for d in oi_store if d <= day)
    oi_chg = oi_change(oi_store.get(day), oi_store.get(days[-2]) if len(days) >= 2 and days[-1] == day else None)
    # daily records (last value of the day wins): Cboe iv30, our 30-day ATM IV, P/C, term
    rec = st.setdefault('days', {})
    rec[day] = {'iv30': head['iv30'], 'atm30': a['atm30'], 'pcv': pc['vol'], 'pco': pc['oi'],
                'term': a['term'][:12], 'close': spot}
    for d in sorted(rec)[:-400]:
        del rec[d]
    hist = sorted(rec.items())
    ivx = VOL_INDEX.get(u)
    vi = st.get('volidx') or {}           # {'closes': [[day, close]], 'now': float} from Cboe (index symbols only)
    own = [[d, r['iv30']] for d, r in hist if r.get('iv30')]
    rank, spark = None, own[-252:]
    if ivx and vi.get('closes'):
        closes = [c for d, c in vi['closes'] if d < day]
        rank = of.iv_rank(closes, vi.get('now') or closes[-1])
        if rank:
            rank['src'], rank['now'] = ivx, rnd(vi.get('now') or closes[-1], 2)
        if len(own) < 60:
            spark = (vi['closes'] + ([[day, vi['now']]] if vi.get('now') else []))[-252:]
    elif len(own) >= 60:
        rank = of.iv_rank([c for d, c in own if d < day] or [c for _, c in own], head['iv30'])
        if rank:
            rank['src'], rank['now'] = 'iv30', rnd(head['iv30'], 2)
    d5 = [r for d, r in hist if d < day][-5:]
    rv = realised_vol(st.get('closes') or [])
    lv0 = levels['0'] if tier == 'A' else (levels['all'] or levels['0'])
    lv_names = lambda lv: None if not lv else {'call_ceiling': lv['cw'], 'put_floor': lv['pw'], 'flip_line': lv['zg'],
                                                 'pin': lv['mp'], 'net': lv['net'], 'zone': lv['zone'], 'x': lv.get('x')}
    em = {r['k']: r for r in a['em']}
    rkey = {'0DTE': '0', '1DTE': '1', 'Weekly': 'w', 'Monthly': 'm'}
    # iv30 series for the IV rank pane: daily closes (vol index or our record) + today's value now; epoch s at 16:00 ET
    series = [[int(datetime.strptime(d, '%Y-%m-%d').replace(hour=16, tzinfo=ET).timestamp()), rnd(v, 2)] for d, v in spark if d < day]
    now_v = (rank or {}).get('now') or (vi.get('now') if ivx and vi.get('closes') and len(own) < 60 else head['iv30'])
    if now_v:
        series.append([int(t), rnd(now_v, 2)])
    summary = {
        'v': 1, 'u': u, 'tier': tier, 'built': int(now_epoch), 't': int(t), 'day': day, 'src': 'cboe',
        'spot': rnd(spot, 2), 'chg_pct': rnd(head['chg_pct'], 2),
        'zone': (lv0 or {}).get('zone'),
        'levels': lv_names(lv0), 'levels_all': lv_names(levels['all']),
        'levels_full': dict(lv_names(st['full']), t=st['full']['t'], x_n=st['full']['x_n'], x_last=st['full']['x_last'],
                            nodes=[{'k': k, 'g': g, 'share': sh} for k, g, sh in st['full']['nodes']])
        if tier == 'A' and (st.get('full') or {}).get('day') == day and 'cw' in st['full'] else None,
        'nodes': [{'k': k, 'g': g, 'share': sh} for k, g, sh in (lv0 or {}).get('nodes', [])],
        'ranges': {rkey[k]: [r['lo'], r['hi']] for k, r in em.items()},
        'range_info': {rkey[k]: {'x': r['x'], 'days': r['days'], 'em': r['em'], 'pct': r['pct'], 'iv': r['iv']} for k, r in em.items()},
        'iv': {'rank': (rank or {}).get('rank'), 'pct': (rank or {}).get('pct'), 'rank_src': (rank or {}).get('src'),
               'rank_n': (rank or {}).get('n'), 'idx': ivx if ivx and vi.get('closes') else None, 'idx_now': rnd(vi.get('now'), 2) if ivx else None,
               'iv30': rnd(head['iv30'], 2), 'iv30_chg': rnd(head['iv30_chg'], 2), 'atm30': a['atm30'], 'skew30': a['skew30'],
               'rv20': rnd(rv * 100, 2) if rv else None, 'own_days': len(own),
               't': [x[0] for x in series], 'v': [x[1] for x in series]},
        'term': a['term'], 'term5': d5[0].get('term') if len(d5) >= 5 else None,
        'pc': {'volume': pc['vol'], 'oi': pc['oi'], 'volume_0': pc['vol_0'], 'oi_0': pc['oi_0'], 'cvol': pc['cvol'], 'pvol': pc['pvol'],
               'scope': pc['scope'], 'hist': [[d, r.get('pcv'), r.get('pco')] for d, r in hist if r.get('pcv') is not None][-20:]},
        'pin': pins,
        'fresh_n': len(fresh), 'burst_n': len(brows), 'opt_vol': pc['cvol'] + pc['pvol'],
        'fresh_top': [act_row(r, t) for r in fresh[:5]], 'burst_top': [act_row(r, t) for r in brows[:5]],
        'notice': 'Education only. Not financial advice.',
    }
    if fut and a.get('fut'):
        r = a['fut']['ratio']
        lv = summary['levels'] or {}
        mp = lambda v: rnd(v * r, 2) if v is not None else None
        summary['fut'] = {'root': fut[0], 'ratio': r, 'price': rnd(fut[1], 2), 'from': u, 'label': 'mapped from ' + u,
                          'call_ceiling': mp(lv.get('call_ceiling')), 'put_floor': mp(lv.get('put_floor')),
                          'flip_line': mp(lv.get('flip_line')), 'pin': mp(lv.get('pin')),
                          'ranges': {k: [mp(v[0]), mp(v[1])] for k, v in summary['ranges'].items()}}
    # tier A: the 0DTE expiry (as GEX+ history); tier B: every expiry <= 31 days, range from the weekly expiry
    snap_xs = set(sets.get('0') or []) if tier == 'A' else set(sets.get('all') or [])
    snap_x = (sets.get('0') or [None])[0] if tier == 'A' else (em.get('Weekly') or {}).get('x')
    sr = gx.straddle_range(spot, [c for c in cs if c['x'] == snap_x and abs(c['k'] - spot) / spot <= LEVEL_BAND], t) if snap_x else None
    sg = {}
    for c in cs:
        if c['x'] in snap_xs and abs(c['k'] - spot) / spot <= LEVEL_BAND:
            sg[c['k']] = sg.get(c['k'], 0.0) + (1 if c['cp'] == 'C' else -1) * c['gamma'] * c['oi'] * 100 * spot * spot * 0.01
    sk = sorted(k for k in sg if abs(k - spot) / spot <= gx.SNAP_BAND)
    # history row: the packed /gex-history shape (gex-heat-core.js unpack): t, fa, day, x, s, cw, pw, zg, n, em, k, g
    snap = {'u': u, 'd': 0 if tier == 'A' else 'all', 'day': day, 't': int(t), 'fa': int(now_epoch),
            'x': snap_x,
            's': rnd(spot, 2), 'cw': (lv0 or {}).get('cw'), 'pw': (lv0 or {}).get('pw'), 'zg': (lv0 or {}).get('zg'),
            'n': (lv0 or {}).get('net'), 'em': [rnd(sr[0], 2), rnd(sr[1], 3)] if sr else None,
            'k': [k_out(k) for k in sk], 'g': [rnd(sg[k] / 1e6, 2) for k in sk]}
    summary['snap'] = snap
    out = {'u': u, 't': int(t), 'built': int(now_epoch), 'tier': tier, 'summary': summary,
           'profile': {md: {'v': 1, 'u': u, 'x': md, 'built': int(now_epoch), 't': int(t), 'spot': rnd(spot, 2), 'expiry': sets.get(md, []),
                            'cols': PROFILE_COLS, 'rows': profile[md],
                            'cw': (levels[md] or {}).get('cw'), 'pw': (levels[md] or {}).get('pw'), 'zg': (levels[md] or {}).get('zg'),
                            'k': [r[0] for r in profile[md]], 'gex': [r[1] for r in profile[md]], 'vol': [r[5] + r[6] for r in profile[md]],
                            'oi_chg': oi_chg if md == 'all' else None} for md in MODES},
           'activity': {'fresh': [act_row(r, t) for r in fresh[:MAX_ROWS]], 'burst': [act_row(r, t) for r in brows]}}
    if surfaces:
        out['surface'] = {'gamma': gamma_surface(spot, cs), 'iv': iv_surface(spot, cs, t)}
    return out


PROFILE_COLS = ['k', 'gex', 'dex', 'vanna', 'charm', 'cvol', 'pvol', 'coi', 'poi']


def act_row(r, t):
    """One Fresh Volume / Volume Burst row in the shared shape (S4 marks, S5 note, page tape)."""
    o = {'t': int(r.get('t1', t)), 'side': r['cp'], 'k': r['k'], 'x': r['x'], 'vol': r.get('vol'), 'oi': r.get('oi'),
         'add': r.get('dv'), 'mid': r['mid'], 'prem': r['prem']}
    if 't0' in r:
        o['t0'] = r['t0']
    if 'ratio' in r:
        o['ratio'] = r['ratio']
    return o


def envelopes(out):
    """analyse() output -> [(route, query dict, payload)] for POST /zo-ingest?route=... (S2 src/zoro.js)."""
    u, t, b = out['u'], out['t'], out['built']
    env = [('summary', {'u': u}, out['summary'])]
    env += [('profile', {'u': u, 'x': md}, p) for md, p in out['profile'].items()]
    for kind in ('fresh', 'burst'):
        env.append(('activity', {'u': u, 'kind': kind}, {'v': 1, 'u': u, 'built': b, 't': t, 'kind': kind, 'rows': out['activity'][kind],
                                                          'label': BURST_LABEL if kind == 'burst' else FRESH_LABEL}))
    for kind, sf in (out.get('surface') or {}).items():
        env.append(('surface', {'u': u, 'kind': kind}, dict(sf, v=1, u=u, built=b, t=t)))
    return env


FRESH_LABEL = 'Contracts where today\'s volume is above open interest.'
BURST_LABEL = 'Volume added between two updates. Not single trades; no buyer or seller side.'


def screen_row(s):
    rw = (s.get('range_info') or {}).get('w')
    return {'u': s['u'], 'tier': s['tier'], 't': s['t'], 'ivr': s['iv']['rank'], 'ivp': s['iv']['pct'],
            'iv30': s['iv']['iv30'], 'iv30_chg': s['iv']['iv30_chg'], 'range_w_pct': rw['pct'] if rw else None,
            'opt_vol': s['opt_vol'], 'fresh_n': s['fresh_n'], 'pc_vol': s['pc']['volume'], 'zone': s['zone']}


# ------------------------------------------------------------------ CME (InsightSentry)
def cme_levels(root, rows, now_epoch, mapped=None):
    """IS /v3/options/quotes rows for one future -> real Call Ceiling / Put Floor / Flip from the CME chain.
    Only rows with open interest count (IS sends OI for the strikes nearest price)."""
    code, mult, src = CME[root]
    spot = None
    cs = []
    for r in rows:
        k, oi, g = num(r.get('strike_price')), num(r.get('open_interest')), num(r.get('gamma'))
        cp = 'C' if r.get('type') == 'CALL' else 'P' if r.get('type') == 'PUT' else None
        e = str(int(num(r.get('expiration'))))
        if not k or not cp or len(e) != 8 or oi <= 0:
            continue
        x = '%s-%s-%s' % (e[:4], e[4:6], e[6:])
        cs.append({'k': k, 'strike': k, 'cp': cp, 'x': x, 'oi': int(oi), 'gamma': g, 'iv': num(r.get('implied_volatility')),
                   'vol': int(num(r.get('volume'))), 'T': gx.years_to_close(x, now_epoch)})
    return cs


def cme_summary(root, cs, und_price, t, mapped=None):
    base = {'v': 1, 'u': root, 'root': root, 'built': int(time.time()), 't': int(t), 'src': 'CME options', 'mapped': mapped,
            'note': 'Open interest is only sent for the strikes nearest the price.'}
    if not und_price or len(cs) < 6:
        return dict(base, ok=False, reason='not enough contracts with open interest')
    gex, cw, pw, zg, net = gx.snap_levels(und_price, cs)
    mult = CME[root][1]
    tot = sum(abs(v) for v in gex.values()) or 1.0
    nodes = sorted(gex, key=lambda k: -abs(gex[k]))[:10]
    # IV / skew / term from the same rows (CoS 06 Nov: CME chains are good for IV; OI is thin, so the gamma levels here are a
    # check next to the mapped ones, never a replacement)
    term = []
    for x in sorted({c['x'] for c in cs}):
        atm = sorted((c for c in cs if c['x'] == x and c['iv'] > 0), key=lambda c: abs(c['k'] - und_price))[:2]
        if atm:
            term.append([x, rnd(sum(c['iv'] for c in atm) / len(atm), 4)])
    return dict(base, ok=True, price=rnd(und_price, 2), x=sorted({c['x'] for c in cs}), oi_rows=len(cs),
                levels={'call_ceiling': k_out(cw) if cw is not None else None, 'put_floor': k_out(pw) if pw is not None else None,
                        'flip_line': rnd(zg, 2), 'pin': max_pain(cs, und_price)},
                net=rnd(net / 100 * mult / 1e6, 2), zone='cushion' if net >= 0 else 'swing',
                nodes=[{'k': k_out(k), 'share': rnd(abs(gex[k]) / tot, 4)} for k in nodes], term=term)


# ------------------------------------------------------------------ I/O
def http_get(url, headers=None, timeout=FETCH_TIMEOUT):
    """GET with Accept-Encoding: gzip; returns the decoded bytes and the bytes on the wire."""
    h = {'User-Agent': UA, 'Accept': 'application/json', 'Accept-Encoding': 'gzip'}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        raw = r.read()
        wire = len(raw)
        if r.headers.get('Content-Encoding') == 'gzip' or raw[:2] == b'\x1f\x8b':
            raw = gzip.decompress(raw)
    return raw, wire


def is_get(path, key, params):
    st = load('isday')
    today = datetime.now(ET).strftime('%Y-%m-%d')
    if st.get('day') != today:
        st = {'day': today, 'n': 0}
    if st['n'] >= IS_DAY_MAX:
        raise RuntimeError('zoro IS day cap reached (%d)' % IS_DAY_MAX)
    st['n'] += 1
    save('isday', st)
    IS_CALLS[0] += 1
    raw, _ = http_get(IS + path + '?' + urllib.parse.urlencode(params, safe=':,!'), {'Authorization': 'Bearer ' + key})
    return json.loads(raw)


def note_is():
    n, IS_CALLS[0] = IS_CALLS[0], 0
    url, sec = os.environ.get('BOOK_RECORDER_URL', '').rstrip('/'), os.environ.get('BOOK_INGEST_SECRET', '')
    if not n or not url or not sec:
        return
    try:
        req = urllib.request.Request(url + '/is-note', data=json.dumps({'src': 'zoro', 'n': n}).encode(), method='POST',
                                     headers={'content-type': 'application/json', 'x-ingest-key': sec, 'User-Agent': 'tradezoro-is-note/1'})
        urllib.request.urlopen(req, timeout=10).close()
    except Exception:
        log('is-note failed (%d calls not counted)' % n)


def post(url, key, route, q, payload):
    """POST /zo-ingest?route=<route>&<q> with the gzip JSON payload (S2 src/zoro.js: {v: 1, built, ...})."""
    payload = dict(payload, v=1, built=int(payload.get('built') or time.time()))
    body = gzip.compress(json.dumps(payload, separators=(',', ':')).encode(), 6)
    if len(body) > MAX_GZ.get(route, 32 * 1024):
        return 'too big %d B' % len(body)
    req = urllib.request.Request('%s/zo-ingest?%s' % (url, urllib.parse.urlencode(dict(q, route=route))), data=body, method='POST',
                                 headers={'content-type': 'application/octet-stream', 'x-ingest-key': key, 'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=POST_TIMEOUT) as r:
            return '%s %s' % (r.status, r.read(80).decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        return '%s %s' % (e.code, e.read(80).decode('utf-8', 'replace'))
    except Exception as e:
        return 'failed ' + type(e).__name__


def path_of(name):
    return os.path.join(STATE, re.sub(r'[^A-Za-z0-9_-]', '', name) + '.json')


def load(name):
    try:
        with open(path_of(name)) as f:
            return json.load(f)
    except Exception:
        return {}


def save(name, obj):
    os.makedirs(STATE, exist_ok=True)
    p = path_of(name)
    with open(p + '.tmp', 'w') as f:
        json.dump(obj, f, separators=(',', ':'))
    os.replace(p + '.tmp', p)


def fut_prices():
    """Front futures prices from Yahoo (one request) for the futures mapping ratio. {root: price}."""
    try:
        syms = ','.join(v[1] for v in FUT_OF.values())
        raw, _ = http_get(YAHOO + '/v7/finance/spark?symbols=%s&range=1d&interval=5m' % syms, timeout=15)
        out = {}
        by = {v[1]: v[0] for v in FUT_OF.values()}
        for r in json.loads(raw)['spark']['result']:
            p = ((r.get('response') or [{}])[0].get('meta') or {}).get('regularMarketPrice')
            if p and r['symbol'] in by:
                out[by[r['symbol']]] = float(p)
        return out
    except Exception as e:
        log('futures prices failed: %s' % type(e).__name__)
        return {}


def cboe_closes(sym, n=300):
    """Daily closes [[day, close]] from Cboe's free history file (indices: _SPX, _VIX; stocks/ETFs: AAPL)."""
    raw, _ = http_get(CBOE_HIST + sym + '.json', timeout=20)
    rows = json.loads(raw).get('data') or []
    return [[r['date'], num(r.get('close'))] for r in rows[-n:] if num(r.get('close')) > 0]


def vol_indices(today, need):
    """{index: {'closes': [[day, close]] (once a day), 'now': current value}} for the vol indices in `need`."""
    st = load('volidx')
    for ix in need:
        e = st.get(ix) or {}
        try:
            if e.get('day') != today:
                e = {'day': today, 'closes': cboe_closes('_' + ix)}
            raw, _ = http_get(CBOE_QUOTE + '_' + ix + '.json', timeout=15)
            e['now'] = num(json.loads(raw)['data'].get('current_price')) or None
        except Exception as ex:
            log('vol index %s failed: %s' % (ix, type(ex).__name__))
        st[ix] = e
    save('volidx', st)
    return st


def cme_due(now, st):
    t = now.astimezone(ET)
    m = t.hour * 60 + t.minute
    for h, mi in CME_SLOTS:
        s = h * 60 + mi
        tag = '%s %02d:%02d' % (t.strftime('%Y-%m-%d'), h, mi)
        if s <= m < s + 20 and tag not in (st.get('done') or []):
            return tag
    return None


def run_cme(url, key, iskey, now_epoch, summaries):
    """3 times a day: front 2 expiries per root (OI on the nearest strikes), whole chain once a day for the expiry list."""
    st = load('cme')
    tag = cme_due(datetime.fromtimestamp(now_epoch, timezone.utc), st)
    if not tag or not iskey:
        return
    today = tag[:10]
    for root, (code, mult, src) in CME.items():
        try:
            exps = (st.get('exps') or {}).get(root) if st.get('day') == today else None
            if not exps:
                j = is_get('/options/quotes', iskey, {'code': code, 'range': 5})
                exps = sorted({str(int(num(r.get('expiration')))) for r in j.get('data') or [] if num(r.get('expiration'))})
                exps = [e for e in exps if e >= today.replace('-', '')]
                st.setdefault('exps', {})[root] = exps
                st['day'] = today
            rows, und = [], None
            for e in exps[:2]:
                ed = '%s-%s-%s' % (e[:4], e[4:6], e[6:])
                j = is_get('/options/quotes', iskey, {'code': code, 'from': ed, 'to': ed, 'range': 5})
                rows.extend(j.get('data') or [])
                und = num(j.get('last_price')) or und
            ms = (summaries.get(src) or {})
            fl = ms.get('fut') if ms.get('fut', {}).get('root') == root else None
            mapped = dict(fl, t=ms.get('t')) if fl else None
            res = cme_summary(root, cme_levels(root, rows, now_epoch), und, now_epoch, mapped)
            log('cme %s %s -> %s' % (root, res.get('oi_rows'), post(url, key, 'cme', {'root': root}, res)))
        except Exception as e:
            log('cme %s failed: %s %s' % (root, type(e).__name__, str(e)[:80]))
    st['done'] = (st.get('done') or [])[-8:] + [tag]
    save('cme', st)


def in_window(now):
    t = now.astimezone(ET)
    if t.weekday() >= 5:
        return False
    m = t.hour * 60 + t.minute
    return 9 * 60 + 30 <= m <= 16 * 60 + 15 or 16 * 60 + 30 <= m <= 16 * 60 + 44


def stock_list():
    env = os.environ.get('ZORO_STOCKS')
    return [s.strip().upper() for s in env.split(',') if s.strip()] if env else list(STOCKS)


def due_symbols(now, force=False):
    """Tier A every even minute, tier B stocks[minute % 15 :: 15]. After the close (16:30-16:44 ET): tier A once at
    16:30 and every stock once over the 15 minutes (the closing values). force (manual run): tier A only."""
    t = now.astimezone(ET)
    m = t.hour * 60 + t.minute
    if force:
        return list(TIER_A)
    if m >= 16 * 60 + 30:
        return (TIER_A if m == 16 * 60 + 30 else []) + stock_list()[t.minute % 15::15]
    return (TIER_A if t.minute % 2 == 0 else []) + stock_list()[t.minute % 15::15]


def main(force=False):
    now = datetime.now(timezone.utc)
    if not force and not in_window(now):
        return 0
    url = os.environ.get('BOOK_RECORDER_URL', '').rstrip('/')
    key = os.environ.get('BOOK_INGEST_SECRET', '')
    iskey = os.environ.get('INSIGHTSENTRY_WEBSOCKET_API_KEY', '')
    if not url or len(key) < 32:
        log('config missing: BOOK_RECORDER_URL / BOOK_INGEST_SECRET')
        return 2
    today = now.astimezone(ET).strftime('%Y-%m-%d')
    syms = due_symbols(now, force)
    futs = fut_prices() if any(s.lstrip('_') in FUT_OF for s in syms) else {}
    volidx = vol_indices(today, sorted({VOL_INDEX[s.lstrip('_')] for s in syms if s.lstrip('_') in VOL_INDEX}))
    latest = load('latest')            # u -> screen row + fut mapping (for the screen and the CME compare)
    bad = 0
    wire_tot = raw_tot = 0
    for n, sym in enumerate(syms):
        u = sym.lstrip('_')
        if n:
            time.sleep(PULL_GAP)
        t0 = time.monotonic()
        st = load('sym-' + u)
        try:
            raw, wire = http_get(CBOE + sym + '.json')
            wire_tot += wire; raw_tot += len(raw)
            if st.get('closes_day') != today:
                try:
                    st['closes'], st['closes_day'] = [c for _, c in cboe_closes(sym, 60)], today
                except Exception:
                    pass
            ix = VOL_INDEX.get(u)
            st['volidx'] = volidx.get(ix) if ix else None
            fr = FUT_OF.get(u)
            fut = (fr[0], futs[fr[0]]) if fr and futs.get(fr[0]) else None
            tier_a = sym in TIER_A
            mins = now.astimezone(ET).minute
            surf = (mins % 15 < 2) if tier_a else (mins % 30 < 15)
            out = analyse(raw, u, time.time(), st, fut=fut, surfaces=surf)
            del raw
            st.pop('volidx', None)
            save('sym-' + u, st)
        except urllib.error.HTTPError as e:
            log('%s failed: HTTP %s' % (sym, e.code))
            bad += 1
            if e.code == 429:
                log('Cboe 429: run stopped, %d symbols left for the next run' % (len(syms) - n - 1))
                break
            continue
        except Exception as e:
            log('%s failed: %s %s' % (sym, type(e).__name__, str(e)[:80]))
            bad += 1
            continue
        res = [post(url, key, route, q, p) for route, q, p in envelopes(out)]
        nbad = sum(1 for r in res if not r.startswith('200'))
        bad += nbad
        latest[u] = {'row': screen_row(out['summary']), 'fut': out['summary'].get('fut'), 't': out['t'],
                     'fresh': [dict(r, u=u) for r in out['activity']['fresh'][:5]]}
        log('%s t=%s wire=%d B %.1fs fresh=%d burst=%d -> %d posts, %d failed%s' % (
            u, out['t'], wire, time.monotonic() - t0, out['summary']['fresh_n'], out['summary']['burst_n'], len(res), nbad,
            (' (' + res[[not r.startswith('200') for r in res].index(True)] + ')') if nbad else ''))
    save('latest', latest)
    if syms:
        rows = sorted((v['row'] for v in latest.values() if v.get('row')), key=lambda r: r['u'])
        res = post(url, key, 'screen', {}, {'t': int(time.time()), 'rows': rows})
        bad += 0 if res.startswith('200') else 1
        act = sorted(rows, key=lambda r: -(r['opt_vol'] or 0))[:20]
        res2 = post(url, key, 'activity', {'u': 'ALL', 'kind': 'active'}, {'u': 'ALL', 'kind': 'active', 't': int(time.time()), 'rows': act})
        bad += 0 if res2.startswith('200') else 1
        day = now.astimezone(ET).strftime('%Y-%m-%d')
        fr = sorted((r for v in latest.values() if datetime.fromtimestamp(v.get('t') or 0, ET).strftime('%Y-%m-%d') == day
                     for r in v.get('fresh') or []), key=lambda r: -r['vol'])[:MAX_ROWS]
        res3 = post(url, key, 'activity', {'u': 'ALL', 'kind': 'fresh'}, {'u': 'ALL', 'kind': 'fresh', 't': int(time.time()), 'rows': fr,
                                                                          'label': FRESH_LABEL})
        bad += 0 if res3.startswith('200') else 1
        log('screen %d rows -> %s | active -> %s | download %d B (unzipped %d B)' % (len(rows), res, res2, wire_tot, raw_tot))
    try:
        run_cme(url, key, iskey, time.time(), {u: {'fut': v.get('fut'), 't': v.get('t')} for u, v in latest.items()})
    finally:
        note_is()
    return 1 if bad else 0


if __name__ == '__main__':
    if len(sys.argv) == 5 and sys.argv[1] == '--analyse':
        print(json.dumps(analyse(open(sys.argv[2], 'rb').read(), sys.argv[3], float(sys.argv[4])), separators=(',', ':')))
        sys.exit(0)
    sys.exit(main(force='--force' in sys.argv))
