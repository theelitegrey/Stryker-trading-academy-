"""Dark pool print alerts: pure logic (no network, no clock). Owner order 2026-11-07 ("will it fire when I'm not on the chart?" -> yes).

Alerts live in Firestore students/{uid}/dpAlerts/{id} (rules: functions-src/firestore.rules, owner only). Doc fields:
  symbol  one of DP_SYMS (the 29 stocks / ETFs dp-feeder covers)
  min     smallest print value in USD (>= 1,000,000)
  lo, hi  optional price zone (both or neither, lo <= hi)
  freq    'once' | 'every';  active bool;  createdAt;  updatedAt (arms the alert: see check())

A PART is what book-recorder GET /scan?part=dp_<sym> returns (gunzipped): {v, t, sym, min, days, cols:[t,p,s,c], rows:[[t ms, price, shares, cond]]}.
Prints are matched once per alert: the engine keeps the keys of matching prints already seen (state file), so a print that stays
in the part across feeder updates (5 sessions are kept) never fires twice. More than GROUP_OVER matches in one look -> one grouped push.
Education only. Not financial advice.
"""
import re
import time

DP_SYMS = ('AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'NFLX', 'AMD', 'JPM', 'V', 'WMT', 'XOM', 'LLY',
           'BAC', 'DIS', 'COST', 'INTC', 'PLTR', 'BA', 'COIN', 'MSTR', 'SPY', 'QQQ', 'IWM', 'DIA', 'GLD', 'TQQQ')
MAX_PER_MEMBER = 20
MIN_USD = 1_000_000
GROUP_OVER = 3
# conditions whose price is not the market price of that moment (same list as assets/chart-darkpool.js OFF_PRICE): left out
OFF_PRICE = set('BW47VPZU')
# Truth: dp-feeder.timer runs every 2 h on weekdays (04:10-20:10 New York + 21:10). Change this line if the timer changes.
UPDATE_NOTE = 'Prints update about every 2 hours on weekdays.'
FOOTER = 'Education only. Not financial advice.'
CHART_SYMS = ('SPY', 'QQQ', 'IWM', 'DIA')      # the covered tickers ZoroCharts opens by bare name (idx provider)
KEEP_MS = 8 * 86400 * 1000                      # sent-print keys older than this are dropped (the part keeps 5 sessions)


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x and abs(x) != float('inf')


def ts_ms(iso):
    """Firestore timestamp string ('2026-11-07T15:04:05.123456Z') -> epoch ms, or 0."""
    try:
        import calendar
        base = calendar.timegm(time.strptime(str(iso)[:19], '%Y-%m-%dT%H:%M:%S')) * 1000
        m = re.match(r'\.(\d{1,3})', str(iso)[19:])
        return base + (int(m.group(1).ljust(3, '0')) if m else 0)
    except (ValueError, TypeError):
        return 0


def parse_dp_alert(uid, aid, d, ut=''):
    """Firestore dpAlerts doc fields -> engine alert, or None (inactive / invalid)."""
    try:
        if d.get('active') is not True:
            return None
        sym = str(d.get('symbol') or '').upper()
        mn = d.get('min')
        if sym not in DP_SYMS or not _num(mn) or mn < MIN_USD:
            return None
        lo, hi = d.get('lo'), d.get('hi')
        if lo is None and hi is None:
            zone = None
        elif _num(lo) and _num(hi) and 0 < lo <= hi:
            zone = (float(lo), float(hi))
        else:
            return None
        armed = ts_ms(d.get('updatedAt'))
        if not armed:
            return None
        return {'id': uid + '/' + aid, 'uid': uid, 'aid': aid, 'symbol': sym, 'min': float(mn), 'zone': zone,
                'freq': 'every' if d.get('freq') == 'every' else 'once', 'armed': armed, 'ut': ut}
    except (TypeError, ValueError, AttributeError):
        return None


def limit_per_member(alerts):
    """At most MAX_PER_MEMBER per member (oldest ids first, stable)."""
    seen, out = {}, []
    for a in sorted(alerts, key=lambda a: a['id']):
        seen[a['uid']] = seen.get(a['uid'], 0) + 1
        if seen[a['uid']] <= MAX_PER_MEMBER:
            out.append(a)
    return out


def pkey(r):
    return '%d|%s|%s' % (int(r[0]), r[1], r[2])


def prints(part):
    """part -> [{t, p, s, v, c, k}] (valid rows only, market-price prints only)."""
    out = []
    for r in (part or {}).get('rows') or []:
        if not isinstance(r, (list, tuple)) or len(r) < 3 or not all(_num(x) for x in r[:3]) or r[1] <= 0 or r[2] <= 0:
            continue
        c = str(r[3] if len(r) > 3 else '')
        if OFF_PRICE & set(c):
            continue
        out.append({'t': int(r[0]), 'p': float(r[1]), 's': float(r[2]), 'v': float(r[1]) * float(r[2]), 'c': c, 'k': pkey(r)})
    return out


def _hit(a, x):
    z = a['zone']
    return x['v'] >= a['min'] and (z is None or z[0] <= x['p'] <= z[1])


def check(a, plist, part_t, prev_t, entry):
    """One alert against one version of its symbol's part.
      plist   prints(part) of the current version;  part_t: its time (x-scan-t, epoch s)
      prev_t  time of the version this engine saw before it (None: none seen, e.g. first start)
      entry   this alert's saved state {'v': armed ms, 'sent': {print key: trade t}} or None
    Returns (found, entry). "New since the alert's last check": what the member could already see when the alert was armed
    (set, edited or resumed: updatedAt) is the baseline and never fires; every matching print a later feeder update adds fires
    once. A print kept across updates (the part holds 5 sessions) never fires twice: its key stays in 'sent'.
    Baseline when the version is newer than the alert: the prints traded up to the previous version's time (the part only
    keeps keys we can afford to store; a print reported very late after that time can be missed). No previous version: all."""
    if entry is None or entry.get('v') != a['armed']:
        if part_t * 1000 <= a['armed'] or not prev_t:
            base = plist
        else:
            base = [x for x in plist if x['t'] <= prev_t * 1000]
        entry = {'v': a['armed'], 'sent': {x['k']: x['t'] for x in base if _hit(a, x)}}
    sent = entry['sent']
    found = [x for x in plist if _hit(a, x) and x['k'] not in sent]
    for x in found:
        sent[x['k']] = x['t']
    return found, entry


def usd(v):
    """$ value -> '$1.2M' / '$40M' / '$1.1B' (same as chart-darkpool.js usd)."""
    if v >= 1e9:
        return '$' + (('%.0f' if v >= 1e10 else '%.1f') % (v / 1e9)) + 'B'
    if v >= 1e6:
        return '$' + ('%d' % round(v / 1e6) if v >= 1e7 else ('%.1f' % (v / 1e6)).replace('.0', '')) + 'M'
    return '$%dK' % round(v / 1e3)


def _price(p):
    return '{:,.2f}'.format(p)


def _et(t):
    try:
        from datetime import datetime
        from zoneinfo import ZoneInfo
        d = datetime.fromtimestamp(t / 1000, ZoneInfo('America/New_York'))
        return d.strftime('%H:%M ET, %b ') + str(d.day)
    except Exception:
        return time.strftime('%H:%M UTC', time.gmtime(t / 1000))


def _zone_txt(a):
    return ' in your %s to %s zone' % (_price(a['zone'][0]), _price(a['zone'][1])) if a['zone'] else ''


def texts(a, found):
    """Matched prints -> list of push texts: one per print, or ONE grouped text when more than GROUP_OVER matched
    (an Only once alert always sends one: the print itself, or the group)."""
    if not found:
        return []
    tail = ' ' + UPDATE_NOTE + ' ' + FOOTER
    if len(found) > GROUP_OVER or (a['freq'] == 'once' and len(found) > 1):
        big = max(found, key=lambda x: x['v'])
        return ['%s: %d dark pool prints \u2265 %s%s, biggest %s at %s.%s' % (a['symbol'], len(found), usd(a['min']), _zone_txt(a),
                                                                            usd(big['v']), _price(big['p']), tail)]
    return ['%s dark pool print: %s at %s (%s shares), %s%s.%s' % (a['symbol'], usd(x['v']), _price(x['p']), '{:,.0f}'.format(x['s']),
                                                                   _et(x['t']), _zone_txt(a), tail) for x in found]


def link(sym):
    return 'charts.html?symbol=' + sym if sym in CHART_SYMS else 'charts.html'


def prune(state, live_ids, now_ms):
    """state: {alert id: entry} -> drop gone alerts and sent keys older than KEEP_MS (in place)."""
    for aid in list(state):
        if aid not in live_ids:
            del state[aid]
            continue
        state[aid]['sent'] = {k: t for k, t in state[aid]['sent'].items() if now_ms - t < KEEP_MS}
    return state
