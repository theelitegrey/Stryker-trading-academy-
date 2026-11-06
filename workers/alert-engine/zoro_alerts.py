"""ZoroOptions alerts: pure logic (no network, no clock). Spec: zoro-options-spec.md section 4.

Option alerts live in Firestore students/{uid}/zoroAlerts/{id} (a separate collection from chartAlerts, whose
rules only accept the price shape). Doc fields:
  type    level_touch | zone_change | level_moved | fresh_volume | volume_burst | iv_rank | pc_extreme | note_ready
  symbol  underlying: SPX SPY QQQ IWM GLD USO or a stock (futures names ES NQ RTY GC CL map to their underlying)
  active  bool;  freq 'once' | 'every';  message (<=140);  updatedAt
  p       params, by type:
            level_touch   {level: call_ceiling|put_floor|flip_line|range_high|range_low, range: '0'|'1'|'w'|'m'}
            level_moved   {level: call_ceiling|put_floor}
            fresh_volume  {min_volume: int}      volume_burst {min_added: int}
            iv_rank       {dir: above|below, value: 0-100}      pc_extreme {dir: above|below, value: number}

A SNAPSHOT is what the Worker's /zo/summary returns for one symbol (fields used, see contract-requests.md):
  {u, built, levels:{call_ceiling, put_floor, flip_line, pin}, zone:'cushion'|'swing', ranges:{'0':[lo,hi],...},
   iv:{rank}, pc:{volume}, fut:{root, ratio}, fresh_top:[{strike, side, exp, volume, oi}],
   burst_top:[{strike, side, exp, added, volume}]}

Education only. Not financial advice.
"""
import re

TYPES = ('level_touch', 'zone_change', 'level_moved', 'fresh_volume', 'volume_burst', 'iv_rank', 'pc_extreme', 'note_ready')
MAX_PER_MEMBER = 25
LEVELS = ('call_ceiling', 'put_floor', 'flip_line', 'range_high', 'range_low')
LEVEL_NAME = {'call_ceiling': 'Call Ceiling', 'put_floor': 'Put Floor', 'flip_line': 'Flip Line',
              'range_high': 'Zoro Range high', 'range_low': 'Zoro Range low'}
RANGE_NAME = {'0': '0DTE', '1': '1DTE', 'w': 'weekly', 'm': 'monthly'}
ZONE_NAME = {'cushion': 'Cushion', 'swing': 'Swing'}
# futures root -> underlying its levels are mapped from (spec section 0); and back.
FUT_UNDERLYING = {'ES': 'SPX', 'NQ': 'QQQ', 'RTY': 'IWM', 'GC': 'GLD', 'CL': 'USO'}
UNDERLYING_FUT = {'SPX': 'ES', 'SPY': 'ES', 'QQQ': 'NQ', 'IWM': 'RTY', 'GLD': 'GC', 'USO': 'CL'}
COOLDOWN_S = 900          # an Every-time build alert fires at most once per 15 min
FOOTER = 'Education only. Not financial advice.'

# Copy rules (spec section 0, 5; brief): words that must never appear in alert text or the daily note body.
_BANNED = [r'live', r'real[- ]?time', r'delayed', r'behind', r'bullish', r'bearish', r'bought', r'sold', r'buy', r'sell',
           r'will', r'expects?(?: a)? move', r'guarantee[ds]?', r'advice', r'whales?', r'smart money',
           r'call resistance', r'put support', r'hvl', r'q-score', r'market tide', r'net tide', r'periscope', r'hiro',
           r'trace', r'flowpatrol', r'gamma wall']
_BANNED_RE = re.compile(r'(?<![A-Za-z])(?:' + '|'.join(_BANNED) + r')(?![A-Za-z])', re.I)


def banned_words(text):
    """Banned words found in text (the footer 'Not financial advice.' is added after this check, never inside)."""
    return sorted({m.group(0).lower() for m in _BANNED_RE.finditer(text or '')})


def fmt_n(x, dec=0):
    return ('{:,.%df}' % dec).format(float(x))


def underlying(sym):
    s = re.sub(r'^[A-Za-z_]+:', '', str(sym or '')).strip().upper()
    s = re.sub(r'1!$', '', s)
    return FUT_UNDERLYING.get(s, s)


def parse_zoro_alert(uid, aid, d, ut=''):
    """Firestore zoroAlerts doc fields -> engine alert, or None (inactive / invalid)."""
    try:
        if d.get('active') is not True or d.get('type') not in TYPES:
            return None
        t = d['type']
        p = d.get('p') if isinstance(d.get('p'), dict) else {}
        sym = underlying(d.get('symbol')) if t != 'note_ready' else 'NOTE'
        if not re.match(r'^[A-Z0-9.\-]{1,12}$', sym):
            return None
        q = {}
        if t == 'level_touch':
            q['level'] = p['level']
            if q['level'] not in LEVELS:
                return None
            q['range'] = str(p.get('range', '0'))
            if q['level'].startswith('range') and q['range'] not in RANGE_NAME:
                return None
            if sym not in UNDERLYING_FUT:
                return None            # no futures price feed for this symbol: the engine cannot watch a touch
        elif t == 'level_moved':
            q['level'] = p['level']
            if q['level'] not in ('call_ceiling', 'put_floor'):
                return None
        elif t == 'fresh_volume':
            q['min_volume'] = max(1, int(p.get('min_volume', 100)))
        elif t == 'volume_burst':
            q['min_added'] = max(1, int(p.get('min_added', 500)))
        elif t in ('iv_rank', 'pc_extreme'):
            q['dir'] = p['dir']
            q['value'] = float(p['value'])
            if q['dir'] not in ('above', 'below') or q['value'] != q['value'] or abs(q['value']) == float('inf'):
                return None
            if t == 'iv_rank' and not 0 <= q['value'] <= 100:
                return None
        return {'id': uid + '/' + aid, 'uid': uid, 'aid': aid, 'type': t, 'symbol': sym, 'p': q,
                'message': str(d.get('message') or '')[:140], 'freq': 'every' if d.get('freq') == 'every' else 'once', 'ut': ut}
    except (KeyError, TypeError, ValueError):
        return None


def limit_per_member(alerts):
    """Keep at most MAX_PER_MEMBER alerts per member (oldest ids first, stable). alerts: iterable of engine alerts."""
    seen, out = {}, []
    for a in sorted(alerts, key=lambda a: a['id']):
        seen[a['uid']] = seen.get(a['uid'], 0) + 1
        if seen[a['uid']] <= MAX_PER_MEMBER:
            out.append(a)
    return out


# ------------------------------------------------------------------------------------ level touch -> price book
def level_value(a, snap):
    """The alert's level on the UNDERLYING scale, or None."""
    p = a['p']
    if p['level'] in ('call_ceiling', 'put_floor', 'flip_line'):
        v = (snap.get('levels') or {}).get(p['level'])
    else:
        r = (snap.get('ranges') or {}).get(p['range'])
        v = r[0 if p['level'] == 'range_low' else 1] if isinstance(r, (list, tuple)) and len(r) == 2 else None
    return float(v) if isinstance(v, (int, float)) and v == v else None


def to_price_alert(a, snap):
    """A level_touch alert + the symbol's latest snapshot -> a price alert for alert_core.Book, or None.
    The level is moved onto the futures price scale with the snapshot's own ratio (futures / underlying)."""
    v = level_value(a, snap)
    fut = snap.get('fut') or {}
    root = fut.get('root') or UNDERLYING_FUT.get(a['symbol'])
    ratio = fut.get('ratio')
    if v is None or root is None or not isinstance(ratio, (int, float)) or ratio <= 0:
        return None
    price = round(v * float(ratio), 2)
    # ut carries the price: a moved level re-arms the alert (Book.upsert), an unchanged one keeps its place.
    return {'id': 'z/' + a['id'], 'uid': a['uid'], 'aid': a['aid'], 'symbol': root, 'key': 'fut:' + root, 'cond': 'crossing',
            'price': price, 'message': '', 'freq': a['freq'], 'ut': '%s|%s' % (a['ut'], price), 'zoro': a, 'level': v}


def touch_text(price_alert, p, prev):
    a = price_alert['zoro']
    lv = a['p']['level']
    name = LEVEL_NAME[lv] + (' (%s)' % RANGE_NAME[a['p']['range']] if lv.startswith('range') else '')
    return _wrap('%s crossed its %s at %s.' % (a['symbol'], name, fmt_n(price_alert['level'])), a)


# ------------------------------------------------------------------------------------ build-based alerts
def _wrap(text, a=None):
    if a and a.get('message'):
        text += ' ' + a['message']
    return (text + ' ' + FOOTER)[:480]


def _contract(c):
    return '%s %s %s' % (fmt_n(c['strike'], 2 if float(c['strike']) % 1 else 0), c['side'], c.get('exp', ''))


def _ckey(c):
    return (c.get('strike'), c.get('side'), c.get('exp'))


def _cross(prev, cur, direction, value):
    if prev is None or cur is None:
        return False
    return (prev < value <= cur) if direction == 'above' else (prev > value >= cur)


def evaluate(a, snap, prev):
    """One alert, the symbol's new snapshot and its previous one (None on the first look: baseline, nothing fires).
    Returns the push text or None. level_touch is handled by the price book, not here."""
    if prev is None or not snap or snap.get('built') == prev.get('built'):
        return None
    t, p, sym = a['type'], a['p'], a['symbol']
    lv, plv = snap.get('levels') or {}, prev.get('levels') or {}
    if t == 'zone_change':
        z, pz = snap.get('zone'), prev.get('zone')
        if z in ZONE_NAME and pz in ZONE_NAME and z != pz:
            fl = lv.get('flip_line')
            return _wrap('%s moved into the %s zone: price crossed its Flip Line%s.' % (sym, ZONE_NAME[z], ' at ' + fmt_n(fl) if fl else ''), a)
    elif t == 'level_moved':
        n, o = lv.get(p['level']), plv.get(p['level'])
        if n is not None and o is not None and n != o:
            return _wrap('%s %s moved from %s to %s.' % (sym, LEVEL_NAME[p['level']], fmt_n(o), fmt_n(n)), a)
    elif t == 'fresh_volume':
        def ok(s):
            return {_ckey(c): c for c in (s.get('fresh_top') or []) if c.get('volume', 0) > c.get('oi', 0) and c.get('volume', 0) >= p['min_volume']}
        new = ok(snap)
        old = ok(prev)
        add = [c for k, c in new.items() if k not in old]
        if add:
            c = max(add, key=lambda c: c['volume'])
            return _wrap('%s: Fresh Volume on the %s: %s contracts against %s open interest.' % (sym, _contract(c), fmt_n(c['volume']), fmt_n(c.get('oi', 0))), a)
    elif t == 'volume_burst':
        hot = [c for c in (snap.get('burst_top') or []) if c.get('added', 0) >= p['min_added']]
        if hot:
            c = max(hot, key=lambda c: c['added'])
            return _wrap('%s: Volume Burst on the %s: %s contracts added since the last update.' % (sym, _contract(c), fmt_n(c['added'])), a)
    elif t == 'iv_rank':
        n, o = (snap.get('iv') or {}).get('rank'), (prev.get('iv') or {}).get('rank')
        if _cross(o, n, p['dir'], p['value']):
            return _wrap('%s IV rank moved %s %s, now %s.' % (sym, p['dir'], fmt_n(p['value'], 0 if p['value'] % 1 == 0 else 1), fmt_n(n)), a)
    elif t == 'pc_extreme':
        n, o = (snap.get('pc') or {}).get('volume'), (prev.get('pc') or {}).get('volume')
        if _cross(o, n, p['dir'], p['value']):
            return _wrap('%s put/call by volume moved %s %s, now %s.' % (sym, p['dir'], fmt_n(p['value'], 2), fmt_n(n, 2)), a)
    return None


class Cooldown:
    """Once -> fires one time (caller deactivates it); Every -> at most once per COOLDOWN_S."""
    def __init__(self):
        self.t = {}

    def ok(self, a, now):
        if a['freq'] == 'every':
            last = self.t.get(a['id'])
            if last is not None and now - last < COOLDOWN_S:
                return False
        self.t[a['id']] = now
        return True
