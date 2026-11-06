#!/usr/bin/env python3
"""Unit tests for the ZoroOptions feeder (zoro-feeder/zoro_feeder.py) on saved Cboe AAPL chains.
Run: python3 workers/book-recorder/test/zoro_feeder_test.py   (stdlib only, no network).
Fixtures: test/fixtures/zoro-aapl-20261106{a,b}.json.gz = two Cboe AAPL pulls 13 minutes apart on 2026-11-06
(trimmed to expiries <= 2026-12-11 and strikes +-10 %)."""
import gzip
import json
import math
import os
import sys
import tempfile
from datetime import datetime
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'zoro-feeder'))
os.environ['STATE_DIRECTORY'] = tempfile.mkdtemp(prefix='zoro-test-')
import zoro_feeder as z  # noqa: E402
import gex_feeder as gx  # noqa: E402

ET = ZoneInfo('America/New_York')
fails = 0


def ok(cond, name):
    global fails
    print(('PASS ' if cond else 'FAIL ') + name)
    if not cond:
        fails += 1


def close(a, b, tol):
    return a is not None and b is not None and abs(a - b) <= tol


A = open(os.path.join(HERE, 'fixtures', 'zoro-aapl-20261106a.json.gz'), 'rb').read()
B = open(os.path.join(HERE, 'fixtures', 'zoro-aapl-20261106b.json.gz'), 'rb').read()
ha, ca = z.parse_chain(A, 0 + gx.et_epoch('2026-11-06T11:06:49'))
TA = ha['t'] + 30
TB = gx.et_epoch('2026-11-06T11:19:50')

# --- parsing
ok(ha['u'] == 'AAPL' and close(ha['spot'], 345.4601, 1e-6), 'parse: symbol and spot')
ok(len(ca) == 468 and all(c['x'] >= '2026-11-06' for c in ca), 'parse: 468 contracts, none expired')
raw_spx = json.dumps({'data': {'current_price': 100, 'last_trade_time': '2026-11-06T11:00:00', 'options': [
    {'option': 'SPX261120C00100000', 'open_interest': 5, 'iv': 0.2, 'bid': 1, 'ask': 1.2, 'volume': 3, 'delta': 0.5},
    {'option': 'SPXW261120C00100000', 'open_interest': 7, 'iv': 0.2, 'bid': 1, 'ask': 1.2, 'volume': 4, 'delta': 0.5},
    {'option': 'SPX261218C00100000', 'open_interest': 9, 'iv': 0.2, 'bid': 1, 'ask': 1.2, 'volume': 4, 'delta': 0.5}]}}).encode()
_, cs = z.parse_chain(raw_spx, TA)
ok(sorted((c['root'], c['x']) for c in cs) == [('SPX', '2026-12-18'), ('SPXW', '2026-11-20')],
   'parse: SPXW wins over SPX on a shared expiry, SPX-only expiry kept')
ok(z.parse_chain(gzip.decompress(A), TA)[1] == ca, 'parse: gzip and plain bytes give the same contracts')

# --- greeks: vanna and charm against finite differences of Black-Scholes delta
def bs_delta(S, K, T, s, r=z.R):
    d1 = (math.log(S / K) + (r + 0.5 * s * s) * T) / (s * math.sqrt(T))
    return 0.5 * (1 + math.erf(d1 / math.sqrt(2)))


S, K, T, s = 345.0, 350.0, 10 / 365, 0.28
g, va, ch = z.bs_greeks(S, K, T, s)
h = 1e-5
ok(close(g, gx.bs_gamma(S, K, T, s), 1e-12), 'greeks: gamma = gex_feeder.bs_gamma')
ok(close(va, (bs_delta(S, K, T, s + h) - bs_delta(S, K, T, s - h)) / (2 * h), 1e-5), 'greeks: vanna = dDelta/dSigma (%.6f)' % va)
dd = (bs_delta(S, K, T - h, s) - bs_delta(S, K, T + h, s)) / (2 * h) / 365
ok(close(ch, dd, 1e-6), 'greeks: charm = -dDelta/dT per day (%.6f vs %.6f)' % (ch, dd))
ok(z.bs_greeks(S, K, 0, s) == (0.0, 0.0, 0.0) and z.bs_greeks(S, K, T, 0) == (0.0, 0.0, 0.0), 'greeks: zero T / IV -> zeros')

# --- max pain (Pin Strike)
rows = [{'strike': 90, 'cp': 'P', 'oi': 100}, {'strike': 100, 'cp': 'C', 'oi': 10}, {'strike': 100, 'cp': 'P', 'oi': 10},
        {'strike': 110, 'cp': 'C', 'oi': 100}]
# pay(90)=10*0+...: calls 100@100->0,110->0; puts 100@90->0, 10@100->100 => 100; pay(100)=0+0; pay(110)=10*10+0=100
ok(z.max_pain(rows, 101) == 100, 'max pain: least payout strike')
ok(z.max_pain([], 100) is None, 'max pain: no OI -> None')

# --- one full analysis
st = {}
a = z.analyse(A, 'AAPL', TA, st)
s_ = a['summary']
l0 = s_['levels']
near = gx.compact(gzip.decompress(A), TA)['near']
sn = gx.snapshot(near, 0, 'AAPL', TA)
ok(s_['tier'] == 'B' and l0['x'] == a['profile']['all']['expiry'], 'levels: a stock (tier B) uses every expiry <= 31 days')
# tier A parity: the same chain read as a tier-A symbol uses the 0DTE expiry, exactly like the GEX+ history snapshot
ta = z.analyse(A, 'IWM', TA, {})
la = ta['summary']['levels']
ok((la['call_ceiling'], la['put_floor'], la['flip_line'], la['net']) == (sn['cw'], sn['pw'], sn['zg'], sn['n']),
   'levels: tier-A 0DTE levels = the GEX+ history snapshot (%s %s %s)' % (la['call_ceiling'], la['put_floor'], la['flip_line']))
lf = ta['summary']['levels_full']
ok(lf and lf['x_last'] == max(c['x'] for c in ca) and len(lf['nodes']) == 10, 'levels_full: tier A gets every expiry once a day (last %s)' % (lf or {}).get('x_last'))
ok(s_['levels_full'] is None, 'levels_full: none for tier B')
snap = ta['summary']['snap']
ok(all(k in snap for k in ('t', 'fa', 'day', 'x', 's', 'cw', 'pw', 'zg', 'n', 'em', 'k', 'g')) and len(snap['k']) == len(snap['g']),
   'history row: the packed /gex-history shape')
ok(snap['k'] == sn['k'] and snap['g'] == sn['g'] and snap['em'] == sn['em'],
   'history row: strikes, GEX and range = the GEX+ snapshot')
ok(l0['zone'] == ('cushion' if l0['net'] >= 0 else 'swing'), 'levels: Gamma Zone follows the net sign')
nd = s_['nodes']
ok(len(nd) == 10 and abs(nd[0]['g']) >= abs(nd[-1]['g']), 'levels: 10 Gamma Nodes, ranked by |GEX|')
ok(all(set(a['profile'][m]['expiry']) <= set(a['profile']['all']['expiry']) or m == 'm' for m in z.MODES), 'profile: mode expiries inside "all"')
ok(a['profile']['0']['expiry'] == ['2026-11-06'] and a['profile']['1']['expiry'] == ['2026-11-09'], 'profile: 0 / 1 = first / second expiry')
p0 = a['profile']['0']
ok(p0['k'] == [r[0] for r in p0['rows']] and p0['gex'] == [r[1] for r in p0['rows']] and p0['cw'] == l0['call_ceiling'], 'profile: teaser columns k / gex / vol / cw')
pr = a['profile']['0']['rows']
ok(pr and all(abs(r[0] - ha['spot']) / ha['spot'] <= z.PROFILE_BAND for r in pr), 'profile: strikes within +-6 %')
ok(close(sum(r[1] for r in a['profile']['all']['rows']), sum(
    (1 if c['cp'] == 'C' else -1) * c['gamma'] * c['oi'] * 100 * ha['spot'] ** 2 * 0.01 / 1e6
    for c in z.enrich(ha['spot'], [c for c in ca if c['x'] in a['profile']['all']['expiry'] and abs(c['k'] / ha['spot'] - 1) <= 0.06], ha['t'])), 0.05),
   'profile: per-strike GEX sums to the contract total')
ok([r[5] for r in pr] == [r[5] for r in pr] and sum(r[5] + r[6] for r in pr) == sum(
    c['vol'] for c in ca if c['x'] == '2026-11-06' and abs(c['k'] / ha['spot'] - 1) <= 0.06), 'profile: call + put volume per strike adds up')
pc = s_['pc']
cv = sum(c['vol'] for c in ca if c['cp'] == 'C' and c['x'] in a['profile']['all']['expiry'])
pv = sum(c['vol'] for c in ca if c['cp'] == 'P' and c['x'] in a['profile']['all']['expiry'])
ok(pc['cvol'] == cv and pc['pvol'] == pv and pc['volume'] == round(pv / cv, 3), 'put/call: volume ratio %.3f' % pc['volume'])
fr = a['activity']['fresh']
ok(fr and all(r['vol'] > r['oi'] and r['vol'] >= 500 and r['prem'] >= 50_000 and r['side'] in 'CP' for r in fr), 'fresh volume: %d rows, all vol > OI, >= 500, >= $50k' % len(fr))
ok(s_['fresh_top'] == fr[:5], 'fresh volume: summary.fresh_top = the first 5')
ok(all((fr[i]['ratio'] or 1e9) >= (fr[i + 1]['ratio'] or 1e9) for i in range(len(fr) - 1)), 'fresh volume: sorted by vol / OI')
ok(a['activity']['burst'] == [] and st['burst']['t'] == ha['t'], 'bursts: first pull of the day only sets the baseline')
em = s_['ranges']
ok(set(em) == {'0', '1', 'w', 'm'} and em['0'][0] < ha['spot'] < em['0'][1], 'Zoro Range: 4 expiries around spot')
ok(s_['iv']['rank'] is None and s_['iv']['iv30'] == 25.81 and s_['iv']['v'] == [25.81], 'IV rank: none for a stock without vol index data or 60 days of record')
ok(s_['pin'][0][0] == '2026-11-06' and s_['pin'][0][1] == z.max_pain([{'strike': c['k'], 'cp': c['cp'], 'oi': c['oi']} for c in ca if c['x'] == '2026-11-06'], 0),
   'Pin Strike: next expiry')
gs = a['surface']['gamma']
ok(len(gs['k']) == z.SURF_K and all(len(r) == z.SURF_K for r in gs['z']) and len(gs['x']) == len(gs['z']), 'surface: gamma grid shape')
iv = a['surface']['iv']
ok(iv['x'] and all(len(r) == len(z.SURF_M) for r in iv['z']) and all(v is None or 0 < v < 5 for r in iv['z'] for v in r), 'surface: IV grid shape and range')
ok(day_oi := st['oi'].get('2026-11-06'), 'OI store: the day\'s first pull stored')
ok(a['profile']['all']['oi_chg'] is None, 'OI change: none without yesterday')
env = z.envelopes(a)
ok([e[0] for e in env].count('profile') == 5 and ('activity', {'u': 'AAPL', 'kind': 'burst'}) in [(e[0], e[1]) for e in env], 'envelopes: summary, 5 profiles, 2 activity, 2 surfaces')
sizes = {(e[0], tuple(e[1].values())): len(gzip.compress(json.dumps(dict(e[2], v=1, built=1), separators=(',', ':')).encode(), 6)) for e in env}
ok(all(n <= z.MAX_GZ[r] for (r, _), n in sizes.items()), 'envelopes: every body under the S2 size cap (max %d B)' % max(sizes.values()))
ok(all(isinstance(e[2]['built'], int) and e[2].get('u') in ('AAPL', None) for e in env), 'envelopes: built is an integer, u matches')
txt = json.dumps(a).lower()
ok(not any(w in txt for w in ('live', 'real-time', 'delayed', 'bullish', 'bearish', 'bought', 'sold')), 'payload: no banned words')

# --- second pull: bursts, OI change from a stored yesterday
st['oi']['2026-11-05'] = {k: [c - 100, p + 50] for k, (c, p) in day_oi.items()}
b = z.analyse(B, 'AAPL', TB, st)
_, cb = z.parse_chain(B, TB)
prev = {z.cid(c): c['vol'] for c in ca if c['vol'] > 0}
exp_b = 0
for c in cb:
    if c['x'] not in b['profile']['all']['expiry']:
        continue
    dv = c['vol'] - prev.get(z.cid(c), 0)
    if dv > 0 and (dv >= 1000 or dv * z.mid(c) * 100 >= 250_000):
        exp_b += 1
br = b['activity']['burst']
ok(len(br) == min(exp_b, z.MAX_ROWS) and br, 'bursts: %d rows = the contracts over the threshold between the two pulls' % len(br))
ok(all(r['t0'] == ha['t'] and r['t'] > r['t0'] and r['add'] > 0 for r in br), 'bursts: time window = previous pull -> this pull')
ok(all(br[i]['prem'] >= br[i + 1]['prem'] for i in range(len(br) - 1)), 'bursts: sorted by premium at mid')
oc = b['profile']['all']['oi_chg']
ok(oc and all(r[1] == 100 and r[2] == -50 for r in oc), 'OI change: today vs yesterday per strike')
again = z.analyse(B, 'AAPL', TB + 60, st)
ok(again['activity']['burst'] == [], 'bursts: same chain time again (no reprint) -> no rows')

# --- IV rank from a vol index (Cboe closes)
st2 = {'volidx': {'closes': [['2025-%02d-%02d' % (1 + i // 28, 1 + i % 28), 20 + i % 10] for i in range(252)], 'now': 27.0}}
c = z.analyse(A, 'AAPL', TA, st2)
iv_ = c['summary']['iv']
ok(iv_['rank_src'] == 'VXAPL' and iv_['rank'] == round((27 - 20) / 9 * 100, 1), 'IV rank: vol index rank %s' % iv_['rank'])
ok(len(iv_['t']) == len(iv_['v']) == 252 and iv_['v'][-1] == 27.0 and iv_['t'] == sorted(iv_['t']), 'IV rank: one year of daily values + now for the pane')
st3 = {'days': {'2026-%02d-%02d' % (1 + i // 28, 1 + i % 28): {'iv30': 20 + i % 10} for i in range(70)}}
d = z.analyse(A, 'MSFT', TA, st3)
ok(d['summary']['iv']['rank'] is not None and d['summary']['iv']['rank_src'] == 'iv30', 'IV rank: own iv30 record after 60 days')

# --- realised vol
ok(z.realised_vol([100] * 21) == 0 and z.realised_vol([100] * 5) is None, 'realised vol: flat = 0, short history = None')

# --- schedule: tier A every 2 min, each stock exactly once per 15 min, CME slots
seen = {}
for m in range(30, 45):
    for sym in z.due_symbols(datetime(2026, 11, 6, 10, m, tzinfo=ET)):
        seen[sym] = seen.get(sym, 0) + 1
ok(all(seen.get(s) == 1 for s in z.STOCKS) and len(z.STOCKS) == 100, 'schedule: 100 stocks, each once per 15 min')
ok(seen['_SPX'] == 8 and seen['USO'] == 8, 'schedule: tier A on the even minutes')
ok(max(len(z.due_symbols(datetime(2026, 11, 6, 10, m, tzinfo=ET))) for m in range(60)) <= 13, 'schedule: at most 13 pulls in a minute')
post = {}
for m in range(30, 45):
    for sym in z.due_symbols(datetime(2026, 11, 6, 16, m, tzinfo=ET)):
        post[sym] = post.get(sym, 0) + 1
ok(all(post.get(s) == 1 for s in z.STOCKS) and post['_SPX'] == 1, 'schedule: after the close, everyone once (16:30-16:44)')
ok(z.due_symbols(datetime(2026, 11, 7, 3, 0, tzinfo=ET), force=True) == z.TIER_A, 'schedule: --force pulls tier A only')
ok(z.cme_due(datetime(2026, 11, 6, 9, 36, tzinfo=ET), {}) == '2026-11-06 09:35', 'CME: 09:35 slot due')
ok(z.cme_due(datetime(2026, 11, 6, 9, 36, tzinfo=ET), {'done': ['2026-11-06 09:35']}) is None, 'CME: a slot runs once')
ok(z.cme_due(datetime(2026, 11, 6, 11, 0, tzinfo=ET), {}) is None, 'CME: nothing between slots')
ok(not z.in_window(datetime(2026, 11, 7, 11, 0, tzinfo=ET)) and z.in_window(datetime(2026, 11, 6, 9, 30, tzinfo=ET)), 'window: weekdays from 09:30 ET')

# --- InsightSentry day cap (no network: the cap trips before any request)
z.save('isday', {'day': datetime.now(ET).strftime('%Y-%m-%d'), 'n': z.IS_DAY_MAX})
try:
    z.is_get('/options/quotes', 'x', {'code': 'CME_MINI:ES1!'})
    ok(False, 'IS cap: stops at ZORO_IS_DAY_MAX')
except RuntimeError:
    ok(z.IS_CALLS[0] == 0, 'IS cap: stops at ZORO_IS_DAY_MAX, nothing counted')

# --- CME levels from an InsightSentry-shaped chain
rows = []
for k in range(7400, 7505, 5):
    for cp in ('CALL', 'PUT'):
        rows.append({'strike_price': k, 'type': cp, 'expiration': 20261113, 'open_interest': 100 + (400 if (k == 7480 and cp == 'CALL') or (k == 7420 and cp == 'PUT') else 0),
                     'gamma': 0.001, 'implied_volatility': 0.18, 'volume': 5})
cme = z.cme_summary('ES', z.cme_levels('ES', rows, TA), 7450.0, TA)
ok(cme['ok'] and cme['levels']['call_ceiling'] == 7480 and cme['levels']['put_floor'] == 7420 and cme['src'] == 'CME options', 'CME: real Call Ceiling / Put Floor from OI')
ok(cme['term'] == [['2026-11-13', 0.18]], 'CME: ATM IV term from the same rows')
ok(not z.cme_summary('ES', [], 7450.0, TA)['ok'], 'CME: thin chain -> ok false with a reason')

print('\n%d failed' % fails if fails else '\nall passed')
sys.exit(1 if fails else 0)
