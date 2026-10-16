"""Pure alert logic for the server-side alert engine (no network, no clock): symbol keys, condition
semantics, the per-symbol price index, and the push text.

SEMANTICS = assets/chart-alerts.js (hit / tick), ported 1:1:
  crossing_up   prev < x and p >= x        (needs a previous price)
  crossing_down prev > x and p <= x
  crossing      either of the two
  greater       p > x
  less          p < x
  Edge trigger: greater/less fire once when they turn true, then stay "held" until the condition
  turns false again (the browser's `armed` map). Crossing alerts are naturally edge-based.
  The previous price of a symbol is kept across feed reconnects, so a jump over the level during a
  gap still counts as a cross on the next print.

INDEX (cheap with ~10k alerts): per symbol key three sorted lists of (price, id):
  cross   crossing / crossing_up / crossing_down -> only the band [min(prev,p), max(prev,p)] is read
  gt      greater alerts waiting to fire          -> every alert with price < p is a prefix
  lt      less alerts waiting to fire             -> every alert with price > p is a suffix
  hgt/hlt greater/less alerts whose condition is still true (held, waiting for a reset); also sorted
A tick therefore costs O(log n + hits), not O(alerts).
"""
import bisect
import re

CONDS = ('crossing', 'crossing_up', 'crossing_down', 'greater', 'less')
FUT_ROOTS = ('NQ', 'MNQ', 'ES', 'MES', 'RTY', 'YM', 'MYM', 'GC', 'MGC', 'SI', 'SIL', 'CL', 'MCL')


def symbol_key(raw):
    """Chart symbol of an alert -> a live feed key, or None when the engine has no real-time feed for it.
    'futures:NQ1!' / 'NQ1!' / 'NQ' / 'CME_MINI:NQ1!' -> 'fut:NQ'; 'binance:BTCUSDT' -> 'binance:BTCUSDT';
    'coinbase:BTC-USD' -> 'coinbase:BTC-USD'. Forex, Hyperliquid and unknown symbols -> None."""
    s = str(raw or '').strip()
    m = re.match(r'^([A-Za-z_]+):(.+)$', s)
    pre = m.group(1).lower() if m else ''
    t = (m.group(2) if m else s).strip().upper()
    if pre in ('binance', 'coinbase'):
        return pre + ':' + t if re.match(r'^[A-Z0-9._\-]{3,30}$', t) else None
    if pre in ('', 'futures', 'cme', 'cme_mini', 'cbot', 'cbot_mini', 'comex', 'comex_mini', 'nymex', 'nymex_mini'):
        r = re.sub(r'1!$', '', t)
        if r in FUT_ROOTS:
            return 'fut:' + r
    return None


def display_symbol(raw):
    s = str(raw or '')
    return re.sub(r'^(futures|binance|coinbase|hyperliquid|fx):', '', s, flags=re.I)


def hit(cond, x, prev, p):
    if cond == 'crossing_up':
        return prev is not None and prev < x <= p
    if cond == 'crossing_down':
        return prev is not None and prev > x >= p
    if cond == 'greater':
        return p > x
    if cond == 'less':
        return p < x
    return prev is not None and ((prev < x <= p) or (prev > x >= p))


def fmt_price(x):
    x = float(x)
    if abs(x) >= 1:
        s = ('%.6f' % x).rstrip('0')
        dec = len(s.split('.')[1]) if '.' in s else 0
        return ('{:,.%df}' % max(2, dec)).format(x)
    s = ('%.8f' % x).rstrip('0').rstrip('.')
    return s or '0'


def push_text(a, p, prev):
    """'NQ1! crossed above 21,450.25' (+ ' · message'). Direction of a plain 'crossing' comes from the move."""
    sym = display_symbol(a['symbol']); lvl = fmt_price(a['price']); c = a['cond']
    if c == 'crossing_up':
        v = 'crossed above'
    elif c == 'crossing_down':
        v = 'crossed below'
    elif c == 'greater':
        v = 'is above'
    elif c == 'less':
        v = 'is below'
    else:
        v = 'crossed above' if (prev is not None and p >= prev) else 'crossed below'
    t = '%s %s %s' % (sym, v, lvl)
    if a.get('message'):
        t += ' \u00b7 ' + a['message']
    return t[:480]


class Book:
    def __init__(self):
        self.alerts = {}          # id -> alert dict {id, uid, symbol, key, cond, price, message, freq, ut}
        self.idx = {}             # key -> {'cross': [], 'gt': [], 'lt': [], 'hgt': [], 'hlt': []}
        self.last = {}            # key -> last price
        self.last_fire = {}       # id -> time of the last fire (for the every-time rate limit)

    # ---- index maintenance
    def _bucket(self, key):
        return self.idx.setdefault(key, {'cross': [], 'gt': [], 'lt': [], 'hgt': [], 'hlt': []})

    def _drop_from_lists(self, a):
        b = self.idx.get(a['key'])
        if not b:
            return
        item = (a['price'], a['id'])
        for name in (('cross',) if a['cond'].startswith('crossing') else (('gt', 'hgt') if a['cond'] == 'greater' else ('lt', 'hlt'))):
            lst = b[name]
            i = bisect.bisect_left(lst, item)
            if i < len(lst) and lst[i] == item:
                del lst[i]
                return

    def _add_to_lists(self, a, held=False):
        b = self._bucket(a['key'])
        if held and a['cond'] in ('greater', 'less'):
            bisect.insort(b['hgt'] if a['cond'] == 'greater' else b['hlt'], (a['price'], a['id']))
            return
        lst = b['cross'] if a['cond'].startswith('crossing') else (b['gt'] if a['cond'] == 'greater' else b['lt'])
        bisect.insort(lst, (a['price'], a['id']))

    def remove(self, aid):
        a = self.alerts.pop(aid, None)
        if a:
            self._drop_from_lists(a)
        self.last_fire.pop(aid, None)

    def upsert(self, a, was_held=False):
        """Insert/replace an alert. A changed alert (edit, pause/resume) is re-armed, like the browser does.
        was_held: restore the held state from a restart (only when the alert is unchanged)."""
        old = self.alerts.get(a['id'])
        held = False
        if old:
            if old['ut'] == a['ut'] and old['cond'] == a['cond'] and old['price'] == a['price']:
                return False          # unchanged: keep its place and its held state
            self._drop_from_lists(old)
        else:
            held = was_held
        self.alerts[a['id']] = a
        self._add_to_lists(a, held)
        return True

    def sync(self, fresh):
        """fresh: {id: alert} = every active price alert right now. Adds, replaces, removes."""
        for aid in [i for i in self.alerts if i not in fresh]:
            self.remove(aid)
        for a in fresh.values():
            self.upsert(a)

    def keys(self):
        return {a['key'] for a in self.alerts.values()}

    # ---- the tick
    def tick(self, key, p, now=0.0, every_gap=15.0):
        """One price print. Returns [(alert, p, prev)] to fire. Once-alerts are removed from the index here
        (the caller deactivates them in Firestore); every-alerts stay, rate-limited to one per every_gap s."""
        prev = self.last.get(key)
        self.last[key] = p
        b = self.idx.get(key)
        if not b:
            return []
        out = []
        # held greater/less whose condition turned false are armed again
        # (greater is false again when p <= price: a suffix of hgt; less when p >= price: a prefix of hlt)
        i = bisect.bisect_left(b['hgt'], (p, ''))
        if i < len(b['hgt']):
            b['gt'] = sorted(b['gt'] + b['hgt'][i:])
            del b['hgt'][i:]
        j = bisect.bisect_right(b['hlt'], (p, '\U0010ffff'))
        if j:
            b['lt'] = sorted(b['lt'] + b['hlt'][:j])
            del b['hlt'][:j]
        # crossing: only the band between the previous and the new price can have been crossed
        if prev is not None and b['cross']:
            lo, hi = (prev, p) if prev <= p else (p, prev)
            i = bisect.bisect_left(b['cross'], (lo, ''))
            while i < len(b['cross']) and b['cross'][i][0] <= hi:
                a = self.alerts[b['cross'][i][1]]
                if hit(a['cond'], a['price'], prev, p):
                    out.append(a)
                i += 1
        # greater: every waiting alert with price < p is true now (sorted prefix)
        n = bisect.bisect_left(b['gt'], (p, ''))
        if n:
            out.extend(self.alerts[aid] for _, aid in b['gt'][:n])
            b['hgt'] = sorted(b['hgt'] + b['gt'][:n])
            del b['gt'][:n]
        # less: every waiting alert with price > p (sorted suffix)
        m = bisect.bisect_right(b['lt'], (p, '\U0010ffff'))
        if m < len(b['lt']):
            out.extend(self.alerts[aid] for _, aid in b['lt'][m:])
            b['hlt'] = sorted(b['hlt'] + b['lt'][m:])
            del b['lt'][m:]
        fired = []
        for a in out:
            if prev is None and a.get('quiet') and a['cond'] in ('greater', 'less'):
                continue                  # start-up: already true, held (not a new event)
            if a['freq'] == 'once':
                self.remove(a['id'])
                fired.append((a, p, prev))
            else:
                t = self.last_fire.get(a['id'])
                if t is not None and now - t < every_gap:
                    continue
                self.last_fire[a['id']] = now
                fired.append((a, p, prev))
        return fired


def parse_alert(uid, aid, d, ut=''):
    """Firestore chartAlerts doc fields -> engine alert, or None (not a price alert we can watch)."""
    try:
        if d.get('active') is not True or d.get('cond') not in CONDS or d.get('src'):
            return None
        price = float(d['price'])
        key = symbol_key(d.get('symbol'))
        if key is None or price != price or abs(price) == float('inf'):
            return None
        return {'id': uid + '/' + aid, 'uid': uid, 'aid': aid, 'symbol': str(d['symbol']), 'key': key, 'cond': d['cond'],
                'price': price, 'message': str(d.get('message') or '')[:140],
                'freq': 'every' if d.get('freq') == 'every' else 'once', 'ut': ut}
    except (KeyError, TypeError, ValueError):
        return None
