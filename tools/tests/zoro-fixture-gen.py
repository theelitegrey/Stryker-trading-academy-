#!/usr/bin/env python3
"""ZoroOptions page fixture (S3, provisional until stream 1's fixture lands).

Writes tools/tests/fixtures/zoro/*.json in the API shapes the page reads (spec section 6). Deterministic
(fixed seed, fixed formulas), so screenshots and the browser test are repeatable. SAMPLE DATA ONLY: the page
labels anything read from here "Sample". Run: python3 tools/tests/zoro-fixture-gen.py
"""
import json, math, os, random

OUT = os.path.join(os.path.dirname(__file__), 'fixtures', 'zoro')
os.makedirs(OUT, exist_ok=True)
R = random.Random(7)
BUILT = 1793980800  # fixed build time; the page shows "updated X min ago" against it (tests pin the clock)
DAY = '2026-11-06'

SYM = {  # u: (spot, strike step, kind, tier)
    'SPX': (6871.2, 5, 'index', 'A'), 'QQQ': (612.4, 1, 'etf', 'A'), 'NVDA': (148.6, 1, 'stock', 'B'),
}


def w(name, obj):
    with open(os.path.join(OUT, name + '.json'), 'w') as fh:
        json.dump(obj, fh, separators=(',', ':'))


def rnd(x, n=2):
    return round(x, n)


def curve(spot, k, flip, ceil_, floor_, scale):
    """Net GEX shape: positive above the flip, negative below, peaks at the ceiling / floor."""
    v = math.tanh((k - flip) / (spot * 0.006)) * 0.35
    v += 1.6 * math.exp(-((k - ceil_) / (spot * 0.003)) ** 2) - 1.3 * math.exp(-((k - floor_) / (spot * 0.003)) ** 2)
    v *= math.exp(-abs(k - spot) / (spot * 0.03))
    return v * scale


def profile(u, x):
    spot, step, kind, tier = SYM[u]
    st = step * (2 if u == 'SPX' else 1)
    lo, hi = spot * 0.94, spot * 1.06
    ks = [k for k in range(int(lo // st * st), int(hi) + st, st) if lo <= k <= hi]
    flip, ceil_, floor_ = levels_of(u)
    sc = {'0': 1.0, '1': 0.8, 'w': 1.6, 'm': 2.4, 'all': 3.2}[x] * (1e9 if u == 'SPX' else 2e8 if u == 'QQQ' else 4e7)
    g = [rnd(curve(spot, k, flip, ceil_, floor_, sc) * (1 + R.uniform(-.25, .25)), 0) for k in ks]
    dex = [rnd(-math.tanh((k - spot) / (spot * .01)) * sc * 2.2 * math.exp(-abs(k - spot) / (spot * .02)) * (1 + R.uniform(-.2, .2)), 0) for k in ks]
    van = [rnd(math.sin((k - spot) / (spot * .008)) * sc * .4 * math.exp(-abs(k - spot) / (spot * .02)), 0) for k in ks]
    cha = [rnd(-math.cos((k - spot) / (spot * .01)) * sc * .25 * math.exp(-abs(k - spot) / (spot * .018)), 0) for k in ks]
    vs = 4000 if u == 'SPX' else 9000 if u == 'QQQ' else 6000
    cv = [int(max(0, vs * math.exp(-max(0, k - spot) / (spot * .012)) * math.exp(-max(0, spot - k) / (spot * .004)) * R.uniform(.5, 1.5))) for k in ks]
    pv = [int(max(0, vs * 1.1 * math.exp(-max(0, spot - k) / (spot * .014)) * math.exp(-max(0, k - spot) / (spot * .004)) * R.uniform(.5, 1.5))) for k in ks]
    coi = [int(c * R.uniform(2, 6)) for c in cv]
    poi = [int(p * R.uniform(2, 6)) for p in pv]
    dcoi = [int(c * R.uniform(-.4, .6)) for c in cv]
    dpoi = [int(p * R.uniform(-.4, .6)) for p in pv]
    return {'v': 1, 'u': u, 'x': x, 'built': BUILT, 'spot': spot, 'step': st, 'k': ks, 'gex': g, 'dex': dex,
            'vanna': van, 'charm': cha, 'cv': cv, 'pv': pv, 'coi': coi, 'poi': poi, 'dcoi': dcoi, 'dpoi': dpoi,
            'tot': {'gex': sum(g), 'dex': sum(dex), 'vanna': sum(van), 'charm': sum(cha)}}


def levels_of(u):
    spot = SYM[u][0]
    st = {'SPX': 25, 'QQQ': 5, 'NVDA': 5}[u]
    flip = spot * 0.9935
    ceil_ = math.ceil(spot * 1.0045 / st) * st
    floor_ = math.floor(spot * 0.982 / st) * st
    return flip, ceil_, floor_


def summary(u, mapped=None):
    spot, step, kind, tier = SYM[u]
    flip, ceil_, floor_ = levels_of(u)
    p = profile(u, 'all')
    nodes = sorted(zip(p['k'], p['gex']), key=lambda t: -abs(t[1]))[:10]
    tot = sum(abs(v) for _, v in nodes) or 1
    em = spot * 0.0062
    rng = {key: {'lo': rnd(spot - em * m), 'hi': rnd(spot + em * m), 'pct': rnd(em * m / spot * 100)}
           for key, m in (('0', 1), ('1', 1.45), ('w', 2.3), ('m', 4.6))}
    year = [rnd(13 + 4 * math.sin(i / 22) + 3 * math.sin(i / 7) + R.uniform(-1, 1)) for i in range(252)]
    iv30 = 14.2 if u == 'SPX' else 19.6 if u == 'QQQ' else 47.3
    year[-1] = iv30 if u == 'SPX' else year[-1]
    lo_, hi_ = min(year), max(year)
    rank = round((year[-1] - lo_) / (hi_ - lo_) * 100)
    pctl = round(sum(1 for y in year if y < year[-1]) / len(year) * 100)
    exps = [('2026-11-06', 0), ('2026-11-09', 3), ('2026-11-13', 7), ('2026-11-20', 14), ('2026-12-18', 42)]
    skew = []
    for e, d in exps:
        m = list(range(-10, 11, 2))
        base = iv30 * (0.85 + 0.03 * math.log(d + 1))
        skew.append({'exp': e, 'dte': d, 'pc25': rnd(3.4 - .25 * math.log(d + 1)),
                     'smile': {'m': m, 'iv': [rnd(base + (-0.55 if mm < 0 else -0.12) * mm * (1.2 - .05 * math.log(d + 1)) + .02 * mm * mm) for mm in m]}})
    tdte = [0, 1, 3, 7, 14, 21, 30, 45, 60, 90, 120]
    atm = [rnd(iv30 * (1.18 - .22 * math.log(d + 2) / math.log(122) + (.06 if d == 0 else 0))) for d in tdte]
    atm5 = [rnd(a - .9 + .006 * d) for a, d in zip(atm, tdte)]
    iv30h = year[-60:]
    rv20 = [rnd(v * .8 + R.uniform(-1.4, 1.4)) for v in iv30h]
    out = {'v': 1, 'u': u, 'kind': kind, 'tier': tier, 'built': BUILT, 'basis': '',
           'spot': spot, 'chg': rnd(spot * .0031), 'chgPct': .31,
           'zone': 'cushion' if spot > flip else 'swing', 'netGex': p['tot']['gex'],
           'levels': {'ceiling': ceil_, 'floor': floor_, 'flip': rnd(flip), 'pin': round(spot * .998 / (25 if u == 'SPX' else 5)) * (25 if u == 'SPX' else 5),
                      'nodes': [{'k': k, 'gex': g, 'share': rnd(abs(g) / tot * 100, 1)} for k, g in nodes]},
           'range': rng, 'earningsWeek': u == 'NVDA',
           'iv': {'iv30': iv30, 'rank': rank, 'pctl': pctl, 'chg': -.4, 'year': year, 'iv30h': iv30h, 'rv20': rv20},
           'skew': skew, 'term': {'dte': tdte, 'atm': atm, 'atm5': atm5},
           'pc': {'vol': 1.12, 'oi': 1.31, 'vol0': 0.94, 'oi0': 1.08, 'prev': 0.96,
                  'hist': [rnd(1 + .25 * math.sin(i / 3) + R.uniform(-.08, .08)) for i in range(19)] + [1.12]},
           'pins': [{'exp': e, 'dte': d, 'k': round(spot * (1 - .002 * (i - 1)) / 25) * 25 if u == 'SPX' else round(spot * (1 - .003 * (i - 1)))} for i, (e, d) in enumerate(exps)],
           'mapped': mapped}
    return out


def history(u):
    spot, step, kind, tier = SYM[u]
    p = profile(u, '0')
    flip, ceil_, floor_ = levels_of(u)
    t0 = 1793975400  # 09:30 ET on DAY (UTC-5)
    frames = []
    for i in range(196):  # 09:30 -> 16:00 every 2 min
        f = i / 195
        s = spot * (1 - .006 + .006 * f + .0025 * math.sin(f * 9))
        fl = flip * (1 - .004 * (1 - f)) + 4 * math.sin(f * 5)
        ce = ceil_ - (25 if f < .4 else 0) * (1 if u == 'SPX' else .2)
        fo = floor_ + (25 if f > .7 else 0) * (1 if u == 'SPX' else .2)
        g = [rnd(curve(s, k, fl, ce, fo, 1e9 * (.55 + .45 * f)), 0) for k in p['k']]
        frames.append({'t': t0 + i * 120, 'spot': rnd(s), 'ceiling': ce, 'floor': fo, 'flip': rnd(fl), 'gex': g})
    return {'v': 1, 'u': u, 'day': DAY, 'step': 120, 'k': p['k'], 'frames': frames}


def surface(u, kind):
    spot = SYM[u][0]
    flip, ceil_, floor_ = levels_of(u)
    if kind == 'gamma':
        st = 25 if u == 'SPX' else 5
        xs = [k for k in range(int(spot * .95 // st * st), int(spot * 1.05), st)]
        ys = [0, 1, 3, 7, 14, 21, 30, 45, 60, 90]
        z = [[rnd(curve(spot, k, flip + d * .6, ceil_ + d * 2, floor_ - d * 2, 1) / (1 + d / 20), 3) for k in xs] for d in ys]
    else:
        xs = list(range(-15, 16, 3))
        ys = [0, 1, 3, 7, 14, 21, 30, 45, 60, 90]
        z = [[rnd(14 * (1.15 - .1 * math.log(d + 2) / 2) + (-.5 if m < 0 else -.1) * m + .03 * m * m * (1 - d / 120), 2) for m in xs] for d in ys]
    return {'v': 1, 'u': u, 'kind': kind, 'built': BUILT, 'x': xs, 'y': ys, 'z': z}


TICKERS = ('AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO AMD NFLX PLTR COIN MSTR SMCI INTC MU ORCL CRM ADBE QCOM BABA UBER '
           'SHOP PYPL SQ DIS BA JPM BAC WFC C GS MS XOM CVX OXY SLB PFE MRK LLY UNH JNJ ABBV CVS WMT TGT COST HD LOW NKE '
           'SBUX MCD KO PEP F GM RIVN LCID NIO SOFI HOOD RBLX SNAP PINS ROKU DKNG ABNB ARM ASML TSM CSCO IBM T VZ CMCSA '
           'GE CAT DE LMT RTX MARA RIOT CLSK AAL UAL DAL CCL NCLH PDD JD BIDU AFRM UPST CVNA ENPH FSLR GME AMC SPOT ZM '
           'DOCU SNOW NET CRWD').split()


def screen():
    rows = []
    for i, u in enumerate(['SPX', 'SPY', 'QQQ', 'IWM', 'GLD', 'USO', 'ES', 'NQ', 'RTY', 'GC', 'CL'] + TICKERS[:99]):
        rr = random.Random(i * 31 + 5)
        rows.append({'u': u, 'ivr': rr.randint(3, 97), 'iv30': rnd(rr.uniform(11, 95), 1), 'ivChg': rnd(rr.uniform(-4, 4), 1),
                     'rangePct': rnd(rr.uniform(.4, 6.5)), 'vol': rr.randint(20000, 2600000), 'pc': rnd(rr.uniform(.35, 1.9)),
                     'fresh': rr.randint(0, 40)})
    return {'v': 1, 'built': BUILT, 'rows': rows}


def activity(kind, u='all'):
    rows = []
    names = ['SPX', 'SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'IWM', 'AMD', 'META', 'AMZN', 'COIN', 'PLTR']
    spots = {'SPX': 6871, 'SPY': 686, 'QQQ': 612, 'NVDA': 148, 'TSLA': 312, 'AAPL': 236, 'IWM': 231, 'AMD': 161, 'META': 604,
             'AMZN': 214, 'COIN': 288, 'PLTR': 61}
    exps = ['2026-11-06', '2026-11-13', '2026-11-20', '2026-12-18']
    rr = random.Random({'fresh': 1, 'burst': 2, 'active': 3}[kind])
    if kind == 'active':
        for i, n in enumerate(TICKERS[:20]):
            rows.append({'u': n, 'vol': 2400000 - i * 97000 - rr.randint(0, 40000), 'pc': rnd(rr.uniform(.4, 1.6)), 'fresh': rr.randint(0, 30)})
        return {'v': 1, 'u': u, 'kind': kind, 'built': BUILT, 'rows': rows}
    for i in range(24):
        n = names[i % len(names)] if u == 'all' else u
        sp = spots.get(n, 100)
        cp = 'C' if rr.random() > .45 else 'P'
        st = 5 if sp > 1000 else 1 if sp < 400 else 5
        k = round(sp * (1 + (.01 if cp == 'C' else -.01) * rr.randint(0, 5)) / st) * st
        if kind == 'fresh':
            oi = rr.randint(200, 9000)
            vol = int(oi * rr.uniform(1.1, 6))
            rows.append({'u': n, 'cp': cp, 'k': k, 'exp': exps[rr.randint(0, 3)], 'vol': vol, 'oi': oi, 'prem': int(vol * rr.uniform(40, 900))})
        else:
            m = 14 * 60 + 30 - (i // 3) * 2
            add = rr.randint(1000, 14000)
            rows.append({'u': n, 'cp': cp, 'k': k, 'exp': exps[rr.randint(0, 2)], 't0': '%02d:%02d' % (m // 60, m % 60 - 2 if m % 60 >= 2 else 58),
                         't1': '%02d:%02d' % (m // 60, m % 60), 'add': add, 'prem': int(add * rr.uniform(60, 700))})
    if kind == 'fresh':
        rows.sort(key=lambda r: -r['vol'] / r['oi'])
    return {'v': 1, 'u': u, 'kind': kind, 'built': BUILT, 'rows': rows}


def note(s):
    L = s['levels']
    return {'v': 1, 'day': DAY, 'kind': 'close', 'built': BUILT, 'ok': True, 'sections': [
        {'u': 'SPX', 'lines': [
            'SPX: Call Ceiling %s, Put Floor %s, Flip Line %s (spot is above it: Cushion zone).' % (f"{L['ceiling']:,}", f"{L['floor']:,}", f"{round(L['flip']):,}"),
            '0DTE Zoro Range %s-%s.' % (f"{round(s['range']['0']['lo']):,}", f"{round(s['range']['0']['hi']):,}"),
            'IV rank %d, 30-day IV %.1f.' % (s['iv']['rank'], s['iv']['iv30']),
            'Put/call by volume 1.12, up from 0.96 yesterday.',
            'Pin Strike for the next expiry: %s.' % f"{L['pin']:,}",
            'Largest open interest increase: 6,900 calls.']},
        {'u': 'QQQ', 'lines': ['QQQ: Call Ceiling 615, Put Floor 600, Flip Line 608 (spot is above it: Cushion zone).',
                               '0DTE Zoro Range 608-617.', 'IV rank 41.']},
        {'u': 'ES', 'lines': ['ES (mapped from SPX): Call Ceiling 6,925, Put Floor 6,775, Flip Line 6,851.']},
        {'u': 'Stocks', 'lines': ['Most Fresh Volume: NVDA, TSLA, AAPL, AMD, META.']}]}


for u in SYM:
    w('summary-' + u, summary(u))
    for x in ('0', '1', 'w', 'm', 'all'):
        w('profile-%s-%s' % (u, x), profile(u, x))
    w('history-' + u, history(u))
    for kd in ('gamma', 'iv'):
        w('surface-%s-%s' % (u, kd), surface(u, kd))
es = summary('SPX', mapped={'root': 'ES', 'from': 'SPX', 'ratio': 1.0074})
es['u'] = 'ES'; es['kind'] = 'future'
w('summary-ES', es)
w('summary', summary('SPX'))
for kd in ('fresh', 'burst', 'active'):
    w('activity-' + kd, activity(kd))
    w('activity-NVDA-' + kd, activity(kd, 'NVDA')) if kd != 'active' else None
w('screen', screen())
w('cme-ES', {'v': 1, 'root': 'ES', 'built': BUILT,
             'cme': {'ceiling': 6950, 'floor': 6800, 'flip': 6866, 'built': BUILT - 3 * 3600},
             'mapped': {'ceiling': 6925, 'floor': 6775, 'flip': 6851, 'built': BUILT, 'from': 'SPX'}})
w('note', note(json.load(open(os.path.join(OUT, 'summary-SPX.json')))))
print('wrote', len(os.listdir(OUT)), 'files to', OUT)
