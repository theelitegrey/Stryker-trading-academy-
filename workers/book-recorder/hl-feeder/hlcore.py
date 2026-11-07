"""Pure logic for the Hyperliquid wallet-intel collector (hl_feeder.py). No I/O; unit-tested by
test/hl_feeder_test.py. Everything here works on public Hyperliquid data only:
  - trades (WS `trades`, every fill carries users = [buyer, seller]; side B = the taker bought)
  - clearinghouseState (positions, entryPx, liquidationPx, leverage) and frontendOpenOrders
    (limit + trigger orders) of the wallets we track
  - the public leaderboard and vault list (display names, account values, 30-day volume)
Wire shapes are documented in stryker-notes/reports/workers/hl-intel/contract.md.
"""
import math

MIN_MS = 60000
HOUR_MS = 3600000
HOUR_TOP = 300           # wallets kept per coin per hour row; the rest are summed into one "others" row
WHALE_AV = 1_000_000     # account value that earns the Whale tag
TOP_VOL_RANK = 100       # 30-day volume rank that earns the "Top 100 volume" tag
BIG_FILL = 250_000       # one order filled for at least this much notional -> wallet gets tracked
BIG_FILL_KEEP = 100_000  # fills kept in a wallet's "recent big fills" list
CLUSTER_SPAN = 0.30      # liquidation / stop buckets kept within +-30% of the mid
LEVEL_SPAN = 0.05        # resting limit orders kept within +-5% of the mid
WALLETS_PER_BUCKET = 20
SIDE_KEYS = ('long', 'short', 'buy', 'sell')


def short_id(a):
    return a[:6] + '\u2026' + a[-2:] if isinstance(a, str) and len(a) > 10 else str(a)


def clean_name(n):
    """A leaderboard display name we can show: trimmed, <= 40 chars, never an e-mail address or a URL."""
    n = (n or '').strip()[:40]
    low = n.lower()
    if not n or '@' in n or '://' in low or low.startswith('www.') or any(low.endswith(t) for t in ('.com', '.io', '.xyz', '.me', '.net', '.org')):
        return None
    return n


def nice_step(raw):
    """The nice step (1 / 2 / 2.5 / 5 x 10^n) at or above raw (same rule as src/bucket.js niceStep)."""
    if not raw > 0:
        return 1.0
    p = 10 ** math.floor(math.log10(raw))
    m = raw / p
    return (1 if m <= 1 else 2 if m <= 2 else 2.5 if m <= 2.5 else 5 if m <= 5 else 10) * p


def cluster_step(mid):
    """Bucket width for liquidation / stop clusters: about 0.25% of the price (BTC 75k -> 200)."""
    return nice_step(mid * 0.0025)


def bucket_of(px, step):
    """Lower edge of px's bucket, rounded to clean float noise."""
    return round(math.floor(px / step + 1e-9) * step, 10)


# ------------------------------------------------------------------------------------------------
# Trades -> per minute per coin per wallet aggregates
# Row layout (both minute and hour rows): [wallet index, buy size, buy notional, sell size,
#   sell notional, fills, taker-buy notional, taker-sell notional]
# Coin totals: [trades, size, notional, taker-buy notional, taker-sell notional]
# ------------------------------------------------------------------------------------------------
class MinuteAgg:
    """Aggregates trades into {minute: {coin: {'tot': [...], 'w': {addr: [8 floats]}}}}."""

    def __init__(self):
        self.m = {}

    def add(self, tr):
        """tr = one WS trade dict. Returns (minute, coin, notional) or None when malformed."""
        try:
            px, sz, t = float(tr['px']), float(tr['sz']), int(tr['time'])
            buyer, seller = tr['users']
            coin = tr['coin']
        except (KeyError, TypeError, ValueError):
            return None
        if not (px > 0 and sz > 0) or not buyer or not seller:
            return None
        ntl = px * sz
        minute = t - t % MIN_MS
        c = self.m.setdefault(minute, {}).setdefault(coin, {'tot': [0, 0.0, 0.0, 0.0, 0.0], 'w': {}})
        taker_buy = tr.get('side') == 'B'
        tot = c['tot']
        tot[0] += 1
        tot[1] += sz
        tot[2] += ntl
        tot[3 if taker_buy else 4] += ntl
        b = c['w'].setdefault(buyer, [0.0] * 7)
        b[0] += sz; b[1] += ntl; b[4] += 1
        if taker_buy:
            b[5] += ntl
        s = c['w'].setdefault(seller, [0.0] * 7)
        s[2] += sz; s[3] += ntl; s[4] += 1
        if not taker_buy:
            s[6] += ntl
        return minute, coin, ntl

    def pop_before(self, minute):
        """Remove and return the finished minutes (< minute), oldest first."""
        done = sorted(k for k in self.m if k < minute)
        return [(k, self.m.pop(k)) for k in done]


def _r(x, n=6):
    return round(x, n) if isinstance(x, float) else x


def pack(t, coins, top=None):
    """{coin: {'tot', 'w': {addr: vals}}} -> compact wire dict with a shared wallet list.
    top: keep only the `top` wallets by notional per coin; the rest become one row with index -1."""
    wl, idx, out = [], {}, {}
    for coin in sorted(coins):
        c = coins[coin]
        items = sorted(c['w'].items(), key=lambda kv: -(kv[1][1] + kv[1][3]))
        rest = None
        if top is not None and len(items) > top:
            items, tail = items[:top], items[top:]
            rest = [0.0] * 7
            for _, v in tail:
                for i in range(7):
                    rest[i] += v[i]
        rows = []
        for a, v in items:
            if a not in idx:
                idx[a] = len(wl)
                wl.append(a)
            rows.append([idx[a]] + [_r(x) for x in v])
        if rest:
            rows.append([-1] + [_r(x) for x in rest])
        out[coin] = {'tot': [_r(x) for x in c['tot']], 'r': rows}
    return {'v': 1, 't': t, 'w': wl, 'c': out}


def merge_into(acc, packed):
    """Add a packed minute/hour dict into acc = {coin: {'tot', 'w'}} (used for the hour roll-up)."""
    wl = packed['w']
    for coin, c in packed['c'].items():
        a = acc.setdefault(coin, {'tot': [0, 0.0, 0.0, 0.0, 0.0], 'w': {}})
        for i in range(5):
            a['tot'][i] += c['tot'][i]
        for r in c['r']:
            key = wl[r[0]] if r[0] >= 0 else '_others'
            v = a['w'].setdefault(key, [0.0] * 7)
            for i in range(7):
                v[i] += r[i + 1]
    return acc


# ------------------------------------------------------------------------------------------------
# Big fills: one taker/maker order = same wallet, coin, side, timestamp
# ------------------------------------------------------------------------------------------------
class BigFills:
    def __init__(self, keep_ms=24 * HOUR_MS):
        self.open = {}      # (addr, coin, side, t) -> [sz, ntl]
        self.keep_ms = keep_ms
        self.by_wallet = {}  # addr -> [[t, coin, side 'B'|'A', sz, ntl, avgPx], ...] newest last

    def add(self, tr):
        try:
            px, sz, t = float(tr['px']), float(tr['sz']), int(tr['time'])
            buyer, seller = tr['users']
        except (KeyError, TypeError, ValueError):
            return
        for a, side in ((buyer, 'B'), (seller, 'A')):
            k = (a, tr['coin'], side, t)
            v = self.open.setdefault(k, [0.0, 0.0])
            v[0] += sz
            v[1] += px * sz

    def flush(self, now_ms, settle_ms=5000):
        """Close orders older than settle_ms; returns the list of new big fills [(addr, row)]."""
        out = []
        for k in [k for k in self.open if k[3] < now_ms - settle_ms]:
            sz, ntl = self.open.pop(k)
            if ntl >= BIG_FILL_KEEP:
                a, coin, side, t = k
                row = [t, coin, side, round(sz, 6), round(ntl, 2), round(ntl / sz, 8)]
                lst = self.by_wallet.setdefault(a, [])
                lst.append(row)
                del lst[:-10]
                out.append((a, row))
        cut = now_ms - self.keep_ms
        for a in list(self.by_wallet):
            self.by_wallet[a] = [r for r in self.by_wallet[a] if r[0] >= cut]
            if not self.by_wallet[a]:
                del self.by_wallet[a]
        return out

    def candidates(self, min_ntl=BIG_FILL):
        """Wallets with a fill >= min_ntl in the window, biggest first."""
        best = {a: max(r[4] for r in rows) for a, rows in self.by_wallet.items()}
        return [a for a, v in sorted(best.items(), key=lambda kv: -kv[1]) if v >= min_ntl]


# ------------------------------------------------------------------------------------------------
# Labels and the tracked set
# ------------------------------------------------------------------------------------------------
def _vlm(row, window):
    for w, d in row.get('windowPerformances') or []:
        if w == window:
            try:
                return float(d.get('vlm') or 0)
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def build_labels(leaderboard, vaults):
    """-> {addr: {'name': str|None, 'tags': [...], 'av': float, 'vol30': float}} for every wallet worth a label."""
    lab = {}
    rows = [r for r in leaderboard if isinstance(r.get('ethAddress'), str)]
    by_vol = sorted(rows, key=lambda r: -_vlm(r, 'month'))
    vol_rank = {r['ethAddress'].lower(): i + 1 for i, r in enumerate(by_vol[:TOP_VOL_RANK])}
    for r in rows:
        a = r['ethAddress'].lower()
        try:
            av = float(r.get('accountValue') or 0)
        except (TypeError, ValueError):
            av = 0.0
        name = clean_name(r.get('displayName'))
        tags = []
        if av >= WHALE_AV:
            tags.append('whale')
        if a in vol_rank:
            tags.append('top100vol')
        if name or tags:
            lab[a] = {'name': name, 'tags': tags, 'av': round(av, 2), 'vol30': round(_vlm(r, 'month'), 2)}
    for v in vaults:
        s = v.get('summary') or {}
        a = str(s.get('vaultAddress') or '').lower()
        try:
            tvl = float(s.get('tvl') or 0)
        except (TypeError, ValueError):
            tvl = 0.0
        if not a or s.get('isClosed') or tvl < 100_000:
            continue
        e = lab.setdefault(a, {'name': None, 'tags': [], 'av': tvl, 'vol30': 0.0})
        e['name'] = clean_name(s.get('name')) or e['name']
        if 'vault' not in e['tags']:
            e['tags'].append('vault')
        if tvl >= WHALE_AV and 'whale' not in e['tags']:
            e['tags'].append('whale')
    return lab


def label_of(a, labels):
    e = labels.get(a)
    return (e and e.get('name')) or short_id(a)


def pick_tracked(leaderboard, big_fill_wallets, cap, n_av=150, n_vol=150):
    """Leaderboard top n_av by account value + top n_vol by 30d volume + big-fill wallets, deduped, capped."""
    rows = [r for r in leaderboard if isinstance(r.get('ethAddress'), str)]

    def av(r):
        try:
            return float(r.get('accountValue') or 0)
        except (TypeError, ValueError):
            return 0.0
    out = []
    for r in sorted(rows, key=lambda r: -av(r))[:n_av] + sorted(rows, key=lambda r: -_vlm(r, 'month'))[:n_vol]:
        out.append(r['ethAddress'].lower())
    out += [a.lower() for a in big_fill_wallets]
    seen, res = set(), []
    for a in out:
        if a not in seen:
            seen.add(a)
            res.append(a)
    return res[:cap]


# ------------------------------------------------------------------------------------------------
# Wallet state -> clusters / levels
# ------------------------------------------------------------------------------------------------
def fnum(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def positions_of(chs):
    """clearinghouseState -> [{'coin','side','sz','ntl','entryPx','liqPx','lev'}]."""
    out = []
    for ap in (chs or {}).get('assetPositions') or []:
        p = ap.get('position') or {}
        szi = fnum(p.get('szi'))
        if not szi:
            continue
        lev = p.get('leverage') or {}
        out.append({'coin': p.get('coin'), 'side': 'long' if szi > 0 else 'short', 'sz': abs(szi),
                    'ntl': abs(fnum(p.get('positionValue')) or 0.0), 'entryPx': fnum(p.get('entryPx')),
                    'liqPx': fnum(p.get('liquidationPx')), 'lev': fnum(lev.get('value')), 'mode': lev.get('type')})
    return out


def account_value(chs):
    return fnum(((chs or {}).get('marginSummary') or {}).get('accountValue'))


def triggers_of(orders, positions):
    """frontendOpenOrders -> trigger orders [{'coin','side','sz','px','kind','type','reduce'}].
    Position TP/SL orders carry sz 0 (= the whole position): their size is the wallet's position size."""
    pos = {p['coin']: p['sz'] for p in positions}
    out = []
    for o in orders or []:
        if not o.get('isTrigger'):
            continue
        px = fnum(o.get('triggerPx'))
        sz = fnum(o.get('sz')) or 0.0
        if not sz and o.get('isPositionTpsl'):
            sz = pos.get(o.get('coin'), 0.0)
        if not (px and px > 0 and sz > 0):
            continue
        typ = str(o.get('orderType') or '')
        out.append({'coin': o.get('coin'), 'side': 'buy' if o.get('side') == 'B' else 'sell', 'sz': sz, 'px': px,
                    'kind': 'tp' if typ.startswith('Take Profit') else 'sl', 'type': typ, 'reduce': bool(o.get('reduceOnly'))})
    return out


def limits_of(orders):
    out = []
    for o in orders or []:
        if o.get('isTrigger'):
            continue
        px, sz = fnum(o.get('limitPx')), fnum(o.get('sz'))
        if px and px > 0 and sz and sz > 0:
            out.append({'coin': o.get('coin'), 'side': 'bid' if o.get('side') == 'B' else 'ask', 'px': px, 'sz': sz})
    return out


def _add_bucket(buckets, key, side, ntl, wrow):
    b = buckets.setdefault(key, {'px': key, 'w': []})
    b.setdefault(side, [0.0, 0])
    b[side][0] += ntl
    b[side][1] += 1
    b['w'].append(wrow)


def _finish(buckets):
    out = []
    for k in sorted(buckets):
        b = buckets[k]
        b['w'].sort(key=lambda w: -w['ntl'])
        b['nw'] = len(b['w'])
        b['w'] = b['w'][:WALLETS_PER_BUCKET]
        for k in SIDE_KEYS:
            if k in b:
                b[k] = [round(b[k][0], 2), b[k][1]]
        out.append(b)
    return out


def coin_state(coin, mid, wallets, oi_ntl, book=None, now=0, min_ntl=1000.0):
    """One coin's tracked-wallet view.
    wallets: {addr: {'pos': positions_of(..), 'trig': triggers_of(..), 'lim': limits_of(..), 'av', 't'}}
    oi_ntl: the coin's open interest in USD (one side). book: parsed l2Book {'bids': [[px, sz]], 'asks': [...]} or None.
    Liquidation buckets: 'long' / 'short' = [notional, positions] of tracked longs (liquidated if price falls to px)
    and shorts. Stop buckets: 'sell' / 'buy' = [notional, orders] of trigger orders that sell / buy when touched."""
    step = cluster_step(mid)
    liq, stops, levels = {}, {}, {}
    tracked_ntl, n_pos = 0.0, 0
    lo, hi = mid * (1 - CLUSTER_SPAN), mid * (1 + CLUSTER_SPAN)
    llo, lhi = mid * (1 - LEVEL_SPAN), mid * (1 + LEVEL_SPAN)
    for a, w in wallets.items():
        for p in w.get('pos') or []:
            if p['coin'] != coin:
                continue
            tracked_ntl += p['ntl']
            n_pos += 1
            lp = p.get('liqPx')
            if lp and lo <= lp <= hi and p['ntl'] >= min_ntl:
                _add_bucket(liq, bucket_of(lp, step), p['side'], p['ntl'],
                            {'a': a, 'side': p['side'], 'ntl': round(p['ntl'], 2), 'liqPx': lp,
                             'entryPx': p['entryPx'], 'lev': p['lev']})
        for o in w.get('trig') or []:
            if o['coin'] != coin or not (lo <= o['px'] <= hi):
                continue
            ntl = o['sz'] * o['px']
            if ntl < min_ntl:
                continue
            _add_bucket(stops, bucket_of(o['px'], step), o['side'], ntl,
                        {'a': a, 'side': o['side'], 'kind': o['kind'], 'ntl': round(ntl, 2), 'px': o['px'], 'sz': o['sz']})
        for o in w.get('lim') or []:
            if o['coin'] != coin or not (llo <= o['px'] <= lhi):
                continue
            k = (o['px'], o['side'])
            lv = levels.setdefault(k, {})
            lv[a] = lv.get(a, 0.0) + o['sz']
    lvl = []
    for (px, side), ws in sorted(levels.items()):
        lvl.append([px, side, [[a, round(sz, 8)] for a, sz in sorted(ws.items(), key=lambda kv: -kv[1])]])
    cov = {'oiPct': round(100 * tracked_ntl / (2 * oi_ntl), 1) if oi_ntl > 0 else None,
           'trackedNtl': round(tracked_ntl, 2), 'oiNtl': round(oi_ntl, 2), 'positions': n_pos, 'wallets': len(wallets)}
    if book:
        cov['bookPct'] = book_coverage(book, lvl)
    return {'v': 1, 't': now, 'coin': coin, 'mid': mid, 'step': step, 'coverage': cov,
            'liq': _finish(liq), 'stops': _finish(stops), 'levels': lvl}


def book_coverage(book, levels):
    """Share (%) of the visible l2Book size (its 20 levels a side) that tracked wallets' resting orders explain."""
    bids, asks = book.get('bids') or [], book.get('asks') or []
    if not bids or not asks:
        return None
    blo, ahi = min(p for p, _ in bids), max(p for p, _ in asks)
    total = sum(s for _, s in bids) + sum(s for _, s in asks)
    mine = 0.0
    for px, side, ws in levels:
        if (side == 'bid' and px >= blo and px <= bids[0][0]) or (side == 'ask' and px <= ahi and px >= asks[0][0]):
            mine += sum(sz for _, sz in ws)
    return round(min(100.0, 100 * mine / total), 1) if total > 0 else None


def liq_events(fills, coin_of=None):
    """HLP liquidator vault fills (userFillsByTime) -> backstop liquidation events (public, every user)."""
    out = []
    for f in fills or []:
        lq = f.get('liquidation')
        if not lq:
            continue
        px, sz = fnum(f.get('px')), fnum(f.get('sz'))
        if not (px and sz):
            continue
        d = str(f.get('dir') or '')
        out.append({'t': int(f.get('time') or 0), 'coin': f.get('coin'), 'px': px, 'sz': sz, 'ntl': round(px * sz, 2),
                    'user': str(lq.get('liquidatedUser') or '').lower(), 'side': 'long' if 'Long' in d else 'short' if 'Short' in d else None,
                    'markPx': fnum(lq.get('markPx')), 'method': lq.get('method'), 'tid': f.get('tid')})
    return out
