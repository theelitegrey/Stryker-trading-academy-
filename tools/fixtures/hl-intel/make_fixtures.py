# Builds the Wallet Intel UI fixtures (tools/fixtures/hl-intel/*.json) from REAL public Hyperliquid data captured on 2026-11-07:
#   hl-trades.json  : 7 min of the public WS `trades` stream for BTC (each fill names [buyer, seller])
#   hl-whales.json / hl-wallets.json / hl-seen.json : clearinghouseState + frontendOpenOrders of the top-90 leaderboard wallets by
#                     account value, the top-70 by 30-day volume and the 100 biggest wallets seen in the captured trades
#   lb.json         : the public leaderboard (displayName labels), ctx.json: metaAndAssetCtxs (BTC open interest + mark)
#   fills-*.json    : userFills of the wallets used in the wallet-profile fixture
# Shapes follow the provisional UI contract in assets/chart-wallet-intel.js (normCandle / normClusters / normLevel / normWallet).
# Usage: python3 make_fixtures.py <capture dir> <out dir>
import json, sys, collections, math, os
SRC, OUT = sys.argv[1], sys.argv[2]
J = lambda f: json.load(open(os.path.join(SRC, f)))
lb = J('lb.json')['leaderboardRows']
name = {r['ethAddress']: r['displayName'] for r in lb if r.get('displayName')}
vol30 = {r['ethAddress']: float(dict(r['windowPerformances'])['month']['vlm']) for r in lb}
top100 = set(sorted(vol30, key=vol30.get, reverse=True)[:100])
av_lb = {r['ethAddress']: float(r['accountValue']) for r in lb}
wallets = {}
for f in ('hl-whales.json', 'hl-wallets.json', 'hl-seen.json'):
    for w in J(f): wallets[w['a']] = w
def av(a): return float(wallets[a]['state']['marginSummary']['accountValue']) if a in wallets else av_lb.get(a, 0)
def tags(a):
    t = []
    if av(a) >= 1e6: t.append('Whale')
    if a in top100: t.append('Top 100 volume')
    return t
def lab(a): return {'a': a, 'label': name.get(a, ''), 'tags': tags(a)}
meta, ctxs = J('ctx.json'); bi = [u['name'] for u in meta['universe']].index('BTC'); mark = float(ctxs[bi]['markPx']); oi = float(ctxs[bi]['openInterest'])
T = max(x['time'] for x in J('hl-trades.json')) // 1000
os.makedirs(OUT, exist_ok=True)
def dump(n, o): json.dump(o, open(os.path.join(OUT, n), 'w'), separators=(',', ':')); print(n, len(json.dumps(o)))

# ---- candle (the busiest captured minute)
tr = J('hl-trades.json'); mins = collections.Counter(x['time'] // 60000 for x in tr); m0 = max((m for m in mins if mins[m] < 200), key=mins.get)
agg = collections.defaultdict(lambda: {'buySz': 0, 'sellSz': 0, 'buyNtl': 0, 'sellNtl': 0, 'n': 0})
tot = {'ntl': 0, 'aggBuyNtl': 0, 'aggSellNtl': 0, 'sz': 0, 'trades': 0}
for x in tr:
    if x['time'] // 60000 != m0: continue
    p, s = float(x['px']), float(x['sz']); buyer, seller = x['users']
    for a, side in ((buyer, 'buy'), (seller, 'sell')):
        g = agg[a]; g[side + 'Sz'] += s; g[side + 'Ntl'] += p * s; g['n'] += 1
    tot['ntl'] += p * s; tot['sz'] += s; tot['trades'] += 1; tot['agg' + ('Buy' if x['side'] == 'B' else 'Sell') + 'Ntl'] += p * s
rows = []
for a, g in agg.items():
    sz = g['buySz'] + g['sellSz']; rows.append(dict(lab(a), buySz=round(g['buySz'], 5), sellSz=round(g['sellSz'], 5), buyNtl=round(g['buyNtl'], 2), sellNtl=round(g['sellNtl'], 2), px=round((g['buyNtl'] + g['sellNtl']) / sz, 2), n=g['n']))
rows.sort(key=lambda r: -(r['buyNtl'] + r['sellNtl']))
tot = {k: round(v, 5) for k, v in tot.items()}; tot['buyNtl'] = tot['sellNtl'] = tot['ntl']; tot['wallets'] = len(rows)
dump('candle-btc-1m.json', {'t': T, 'coin': 'BTC', 'from': m0 * 60000, 'to': (m0 + 1) * 60000, 'totals': tot, 'wallets': rows[:50]})

# ---- clusters (tracked = every wallet above; BTC positions -> liquidation prices, BTC trigger orders -> stops)
step = 250.0
bucket = lambda p: round(math.floor(p / step) * step + step / 2, 2)
liq, stops, posNtl = collections.defaultdict(list), collections.defaultdict(list), 0
for a, w in wallets.items():
    for ap in w['state']['assetPositions']:
        p = ap['position']
        if p['coin'] != 'BTC': continue
        szi, ntl = float(p['szi']), float(p['positionValue']); posNtl += ntl
        lp = float(p['liquidationPx'] or 0)
        if lp <= 0 or abs(lp / mark - 1) > 0.35: continue
        liq[(bucket(lp), 'long' if szi > 0 else 'short')].append(dict(lab(a), side='long' if szi > 0 else 'short', sz=abs(szi), ntl=round(ntl, 2), px=round(lp, 2), lev=p['leverage']['value']))
    for o in w['orders']:
        if o['coin'] != 'BTC' or not o.get('isTrigger'): continue
        tp = float(o['triggerPx']); sz = float(o['sz']) or float(o.get('origSz') or 0)
        if not sz and o.get('isPositionTpsl'):   # a whole-position TP/SL has sz 0: it closes the open BTC position
            sz = sum(abs(float(ap['position']['szi'])) for ap in w['state']['assetPositions'] if ap['position']['coin'] == 'BTC')
        if not sz: continue
        stops[(bucket(tp), 'buy' if o['side'] == 'B' else 'sell')].append(dict(lab(a), side='buy' if o['side'] == 'B' else 'sell', sz=sz, ntl=round(sz * tp, 2), px=tp, kind=o['orderType']))
def cl(d, sidek):
    out = []
    for (px, side), ws in d.items():
        ws.sort(key=lambda r: -r['ntl'])
        out.append({'px': px, 'lo': px - step / 2, 'hi': px + step / 2, 'side': side, 'ntl': round(sum(r['ntl'] for r in ws), 2), 'n': len({r['a'] for r in ws}), 'wallets': ws[:30]})
    return sorted(out, key=lambda c: c['px'])
dump('clusters-btc.json', {'t': T, 'coin': 'BTC', 'mark': mark, 'step': step, 'coverage': {'oiShare': round(min(1, posNtl / (oi * mark)), 4), 'wallets': len(wallets)}, 'liq': cl(liq, 'side'), 'stops': cl(stops, 'side')})

# ---- book level: the price with the most tracked resting BTC limit size within 0.2 % of mark (grouping 1)
lv = collections.defaultdict(list)
for a, w in wallets.items():
    for o in w['orders']:
        if o['coin'] != 'BTC' or o.get('isTrigger'): continue
        px = float(o['limitPx'])
        if abs(px / mark - 1) <= 0.002: lv[px].append(dict(lab(a), side='buy' if o['side'] == 'B' else 'sell', sz=float(o['sz']), ntl=round(float(o['sz']) * px, 2), px=px))
best = max(lv, key=lambda p: sum(r['sz'] for r in lv[p]))
ords = sorted(lv[best], key=lambda r: -r['ntl'])
dump('level-btc.json', {'t': T, 'coin': 'BTC', 'px': best, 'lo': best, 'hi': best, 'orders': ords, 'trackedSz': round(sum(r['sz'] for r in ords), 5)})

# ---- wallet profile: the candle's biggest wallet
a = rows[0]['a']; w = wallets.get(a)
fills = J('fills-' + a + '.json') if os.path.exists(os.path.join(SRC, 'fills-' + a + '.json')) else []
st = w['state'] if w else {'marginSummary': {'accountValue': '0'}, 'assetPositions': []}
pos = [{'coin': p['coin'], 'szi': float(p['szi']), 'entryPx': float(p['entryPx']), 'liqPx': float(p['liquidationPx']) if p.get('liquidationPx') else None, 'lev': p['leverage']['value'], 'ntl': float(p['positionValue']), 'upnl': float(p['unrealizedPnl'])} for p in (x['position'] for x in st['assetPositions'])]
big = sorted([f for f in fills if float(f['px']) * float(f['sz']) >= 10000], key=lambda f: -f['time'])[:20]
fl = [{'t': f['time'], 'coin': f['coin'], 'side': f['side'], 'px': float(f['px']), 'sz': float(f['sz']), 'ntl': round(float(f['px']) * float(f['sz']), 2), 'liq': bool(f.get('liquidation')), 'dir': f.get('dir', '')} for f in big]
dump('wallet.json', dict(lab(a), t=T, accountValue=float(st['marginSummary']['accountValue']), positions=pos, fills=fl))
print('wallet', a)
