"""Metric alerts: pure logic (no network, no clock). Owner order 2026-11-07 ("alerts on any metric").

Alerts live in Firestore students/{uid}/metricAlerts/{id} (rules: functions-src/firestore.rules, owner only). Doc fields:
  metric  gex_cross | funding | oi_change
          (GEX regime flips, IV rank and put/call thresholds already exist as ZoroOptions alerts: zoro_alerts.py zone_change /
          iv_rank / pc_extreme. The site's metric picker saves those three as zoroAlerts docs, so one metric has one engine.)
  symbol  GEX / options metrics: an options underlying (SPX SPY QQQ IWM GLD USO or a covered stock; ES NQ RTY GC CL map to
          their underlying, as zoro_alerts.underlying).  Crypto metrics: a coin (BTC, ETH, SOL ...).
  p       params, by metric:
            gex_cross   {level: call_wall|put_wall|gamma_flip|pin|em_high|em_low|any_node, range: s|0|1|w|m (em only), dir: any|up|down}
            funding     {venue: okx|hl, dir: above|below, value: percent per funding interval (-5..5)}
            oi_change   {venue: okx|hl, mins: 5|15|60|240, dir: up|down|either, value: percent > 0}
  freq 'once' | 'every';  active bool;  message (<= 140);  createdAt;  updatedAt (server time: arms the alert)

Plans: GEX metrics are Pro (the engine checks the member's plan before it fires); crypto metrics are free.

Semantics (no duplicate fires):
  gex_cross   the underlying's spot of two consecutive options updates (snapshot `built` changed) straddles the level
              (up: prev < L <= now; down: prev > L >= now). Checked per update, not per tick.
  thresholds  (funding, oi_change) fire when the condition TURNS true, then are held until it is false
              again. A condition already true when the alert is armed (created / edited / resumed) is held, not fired.
  every       an Every-time alert also waits COOLDOWN_S between two fires.
  limit       MAX_PER_MEMBER alerts per member (oldest ids first); the rest are ignored.
Education only. Not financial advice.
"""
import re

METRICS = ('gex_cross', 'funding', 'oi_change')
PRO = ('gex_cross',)
MAX_PER_MEMBER = 20
COOLDOWN_S = 900
LEVELS = ('call_wall', 'put_wall', 'gamma_flip', 'pin', 'em_high', 'em_low', 'any_node')
LEVEL_NAME = {'call_wall': 'Call Ceiling (call wall)', 'put_wall': 'Put Floor (put wall)', 'gamma_flip': 'Flip Line (zero gamma)',
              'pin': 'Pin Strike', 'em_high': 'expected move high', 'em_low': 'expected move low', 'any_node': 'Gamma Node'}
RANGES = {'s': 'session 68%', '0': '0DTE', '1': '1DTE', 'w': 'weekly', 'm': 'monthly'}
VENUES = {'okx': 'OKX', 'hl': 'Hyperliquid'}
OI_MINS = (5, 15, 60, 240)
FUT_UNDERLYING = {'ES': 'SPX', 'MES': 'SPX', 'NQ': 'QQQ', 'MNQ': 'QQQ', 'RTY': 'IWM', 'M2K': 'IWM', 'GC': 'GLD', 'MGC': 'GLD',
                  'CL': 'USO', 'MCL': 'USO'}
FOOTER = 'Education only. Not financial advice.'
OPT_NOTE = 'Checked on each options data update.'


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x and abs(x) != float('inf')


def underlying(sym):
    s = re.sub(r'^[A-Za-z_]+:', '', str(sym or '')).strip().upper()
    s = re.sub(r'[0-9]?!$', '', s)
    return FUT_UNDERLYING.get(s, s)


def coin(sym):
    s = re.sub(r'^[A-Za-z_]+:', '', str(sym or '')).strip().upper()
    return re.sub(r'(-USDT-SWAP|-USDT|USDT|-USD|-PERP)$', '', s)


def parse_metric_alert(uid, aid, d, ut=''):
    """Firestore metricAlerts doc fields -> engine alert, or None (inactive / invalid)."""
    try:
        if d.get('active') is not True or d.get('metric') not in METRICS:
            return None
        m = d['metric']
        p = d.get('p') if isinstance(d.get('p'), dict) else {}
        q = {}
        crypto = m in ('funding', 'oi_change')
        sym = coin(d.get('symbol')) if crypto else underlying(d.get('symbol'))
        if not re.match(r'^[A-Z0-9]{1,15}$' if crypto else r'^[A-Z0-9.\-]{1,12}$', sym):
            return None
        if m == 'gex_cross':
            q['level'] = p.get('level')
            if q['level'] not in LEVELS:
                return None
            if q['level'] in ('em_high', 'em_low'):
                q['range'] = str(p.get('range', 's'))
                if q['range'] not in RANGES:
                    return None
            q['dir'] = p.get('dir', 'any') if p.get('dir', 'any') in ('any', 'up', 'down') else None
            if not q['dir']:
                return None
        else:
            v = p.get('value')
            if not _num(v):
                return None
            q['value'] = float(v)
            if m == 'oi_change':
                q['dir'] = p.get('dir', 'either')
                if q['dir'] not in ('up', 'down', 'either') or not 0 < q['value'] <= 1000:
                    return None
                q['mins'] = int(p.get('mins', 15)) if _num(p.get('mins', 15)) else 0
                if q['mins'] not in OI_MINS:
                    return None
            else:
                q['dir'] = p.get('dir')
                if q['dir'] not in ('above', 'below'):
                    return None
                if not -5 <= q['value'] <= 5:
                    return None
            if crypto:
                q['venue'] = p.get('venue')
                if q['venue'] not in VENUES:
                    return None
        armed = str(d.get('updatedAt') or '')
        if not armed:
            return None
        return {'id': uid + '/' + aid, 'uid': uid, 'aid': aid, 'metric': m, 'symbol': sym, 'p': q, 'pro': m in PRO,
                'message': str(d.get('message') or '')[:140], 'freq': 'every' if d.get('freq') == 'every' else 'once',
                'armed': armed, 'ut': ut}
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


def limit_per_member(alerts):
    """At most MAX_PER_MEMBER per member (oldest ids first, stable)."""
    seen, out = {}, []
    for a in sorted(alerts, key=lambda a: a['id']):
        seen[a['uid']] = seen.get(a['uid'], 0) + 1
        if seen[a['uid']] <= MAX_PER_MEMBER:
            out.append(a)
    return out


# ------------------------------------------------------------------------------------------- snapshots
def snap_values(s):
    """A /zo/summary reply -> the few numbers metric alerts read: {built, t, spot, levels{...}, nodes[], em{...}}."""
    if not isinstance(s, dict):
        return None
    lv = s.get('levels') or {}
    sn = s.get('snap') or {}
    spot = s.get('spot') if _num(s.get('spot')) else sn.get('s')
    out = {'built': s.get('built'), 't': s.get('t') or sn.get('t'), 'spot': float(spot) if _num(spot) else None,
           'levels': {}, 'nodes': [], 'em': {}}
    for k, src in (('call_wall', 'call_ceiling'), ('put_wall', 'put_floor'), ('gamma_flip', 'flip_line')):
        if _num(lv.get(src)):
            out['levels'][k] = float(lv[src])
    pin = lv.get('pin') if _num(lv.get('pin')) else s.get('pin') if _num(s.get('pin')) else None
    if pin is not None:
        out['levels']['pin'] = float(pin)
    out['nodes'] = sorted({float(n['k']) for n in (s.get('nodes') or []) if isinstance(n, dict) and _num(n.get('k'))})
    em = sn.get('em')
    if isinstance(em, (list, tuple)) and len(em) == 2 and all(_num(x) for x in em):
        out['em']['s'] = [em[0] - em[1], em[0] + em[1]]
    for k, r in (s.get('ranges') or {}).items():
        if k in RANGES and isinstance(r, (list, tuple)) and len(r) == 2 and all(_num(x) for x in r):
            out['em'][k] = [float(r[0]), float(r[1])]
    return out


def level_of(a, v):
    """The alert's level(s) in the snapshot: a list of prices (any_node: every node), [] when missing."""
    lv = a['p']['level']
    if lv == 'any_node':
        return list(v['nodes'])
    if lv in ('em_high', 'em_low'):
        r = v['em'].get(a['p']['range'])
        return [r[1] if lv == 'em_high' else r[0]] if r else []
    return [v['levels'][lv]] if lv in v['levels'] else []


def _crossed(p0, p1, x, d):
    up = p0 < x <= p1
    down = p0 > x >= p1
    return (up and d in ('any', 'up')) or (down and d in ('any', 'down')), up


# ------------------------------------------------------------------------------------------- formatting
def fmt(x, dec=2):
    x = float(x)
    if dec == 'auto':
        dec = 0 if abs(x - round(x)) < 1e-9 else 2
    return ('{:,.%df}' % dec).format(x)


def _wrap(text, a, note=''):
    if a.get('message'):
        text += ' ' + a['message']
    return (text + (' ' + note if note else '') + ' ' + FOOTER)[:480]


def _et(t):
    try:
        from datetime import datetime
        from zoneinfo import ZoneInfo
        return datetime.fromtimestamp(int(t), ZoneInfo('America/New_York')).strftime('%H:%M ET')
    except Exception:
        return ''


# ------------------------------------------------------------------------------------------- evaluation
def held_check(a, cond, entry, now):
    """Edge + hold for threshold metrics. cond: True / False / None (no data: nothing changes).
    entry: this alert's state {'v': armed, 'held': bool, 'last': fire time} or None. Returns (fire, entry)."""
    if entry is None or entry.get('v') != a['armed']:
        entry = {'v': a['armed'], 'held': bool(cond), 'last': 0}     # baseline: already true at arming -> held
        return False, entry
    if cond is None:
        return False, entry
    if not cond:
        entry['held'] = False
        return False, entry
    if entry.get('held'):
        return False, entry
    if a['freq'] == 'every' and now - entry.get('last', 0) < COOLDOWN_S:
        return False, entry                                         # stays un-held: fires once the cooldown ends
    entry['held'] = True
    entry['last'] = now
    return True, entry


def eval_snapshot(a, cur, entry, now):
    """GEX level cross against the symbol's latest snapshot values (cur, snap_values()). Returns (text or None, entry)."""
    p, sym = a['p'], a['symbol']
    tail = OPT_NOTE + (' Options data from %s.' % _et(cur['t']) if cur.get('t') and _et(cur['t']) else '')
    # event metrics: this update against the last one this alert saw (kept in its entry, so a restart resumes cleanly).
    # First look / just armed: baseline only, nothing fires (what the member could already see never fires).
    if entry is None or entry.get('v') != a['armed'] or 'built' not in entry:
        return None, {'v': a['armed'], 'built': cur.get('built'), 'spot': cur.get('spot'), 'last': 0}
    if not cur.get('built') or cur.get('built') == entry.get('built'):
        return None, entry
    p0 = entry.get('spot')
    entry.update(built=cur.get('built'), spot=cur.get('spot'))
    if a['freq'] == 'every' and now - entry.get('last', 0) < COOLDOWN_S:
        return None, entry
    p1 = cur.get('spot')
    if p0 is None or p1 is None or p0 == p1:
        return None, entry
    hits = []
    for x in level_of(a, cur):                    # the level as of this update (a wall that moved is checked where it is now)
        ok, up = _crossed(p0, p1, x, p['dir'])
        if ok:
            hits.append((x, up))
    if not hits:
        return None, entry
    x, up = min(hits, key=lambda h: abs(h[0] - p0))
    name = LEVEL_NAME[p['level']] + (' (%s)' % RANGES[p['range']] if p['level'] in ('em_high', 'em_low') else '')
    more = ' and %d more' % (len(hits) - 1) if len(hits) > 1 else ''
    entry['last'] = now
    return _wrap('%s crossed %s its %s at %s%s (price %s).' % (sym, 'above' if up else 'below', name, fmt(x, 'auto'), more, fmt(p1)),
                 a, tail), entry


# ------------------------------------------------------------------------------------------- crypto
def parse_hl(reply):
    """Hyperliquid info {type: metaAndAssetCtxs} -> {coin: {'funding': percent per hour, 'oi': coins, 'hours': 1}}."""
    out = {}
    try:
        meta, ctxs = reply
        for u, c in zip(meta.get('universe') or [], ctxs or []):
            f, oi = float(c.get('funding')), float(c.get('openInterest'))
            if f == f and oi == oi:
                out[str(u['name']).upper()] = {'funding': f * 100, 'oi': oi, 'hours': 1.0}
    except (TypeError, ValueError, KeyError):
        pass
    return out


def parse_okx(funding_reply, oi_reply):
    """OKX public funding-rate?instId=ANY + open-interest?instType=SWAP -> {coin: {'funding': percent per interval, 'oi': coins,
    'hours': funding interval}}. USDT-margined swaps only."""
    out = {}
    for r in (funding_reply or {}).get('data') or []:
        i = str(r.get('instId', ''))
        if not i.endswith('-USDT-SWAP'):
            continue
        try:
            f = float(r['fundingRate'])
            hours = (float(r['nextFundingTime']) - float(r['fundingTime'])) / 3.6e6
        except (KeyError, TypeError, ValueError):
            continue
        out[i[:-10]] = {'funding': f * 100, 'hours': hours if 0 < hours <= 24 else None}
    for r in (oi_reply or {}).get('data') or []:
        i = str(r.get('instId', ''))
        if i.endswith('-USDT-SWAP') and i[:-10] in out:
            try:
                out[i[:-10]]['oi'] = float(r['oiCcy'])
            except (KeyError, TypeError, ValueError):
                pass
    return out


def oi_then(ring, now, mins):
    """ring: [[t s, oi], ...] oldest first. The sample closest to now - mins, if within max(90 s, 10% of the span)."""
    want = now - mins * 60
    tol = max(90, mins * 6)
    best = None
    for t, v in ring:
        if abs(t - want) <= tol and (best is None or abs(t - want) < abs(best[0] - want)):
            best = (t, v)
    return best


def eval_crypto(a, row, ring, entry, now):
    """row: this coin's venue values {'funding', 'oi', 'hours'} or None. ring: the coin's OI samples. -> (text or None, entry)."""
    p, sym, ven = a['p'], a['symbol'], VENUES[a['p']['venue']]
    if a['metric'] == 'funding':
        val = row.get('funding') if row else None
        cond = None if val is None else (val > p['value'] if p['dir'] == 'above' else val < p['value'])
        fire, entry = held_check(a, cond, entry, now)
        if not fire:
            return None, entry
        per = (' per %s h' % fmt(row['hours'], 'auto')) if row.get('hours') else ''
        return _wrap('%s funding on %s moved %s %s%%, now %s%%%s.' % (sym, ven, p['dir'], fmt(p['value'], 4).rstrip('0').rstrip('.'),
                                                                     ('%.4f' % val), per), a), entry
    cur = row.get('oi') if row else None
    then = oi_then(ring or [], now, p['mins'])
    chg = None if cur is None or not then or then[1] <= 0 else (cur - then[1]) / then[1] * 100
    cond = None if chg is None else (chg >= p['value'] if p['dir'] == 'up' else chg <= -p['value'] if p['dir'] == 'down'
                                     else abs(chg) >= p['value'])
    fire, entry = held_check(a, cond, entry, now)
    if not fire:
        return None, entry
    return _wrap('%s open interest on %s %s %s%% in %d min (now %s %s).' % (sym, ven, 'rose' if chg > 0 else 'fell', fmt(abs(chg), 1),
                                                                         p['mins'], fmt(cur, 0), sym), a), entry


def link(a):
    if a['metric'] in ('funding', 'oi_change'):
        return 'charts.html'
    return 'zoro-options.html?symbol=' + a['symbol']


# ------------------------------------------------------------------------------------------- plan (port of functions/api/chart/_rt.js)
GRACE_MS = 3 * 24 * 3600 * 1000


def is_active_pro(doc, paid, now_ms):
    """students/{uid} fields (decoded) + the set of paid plan names (rank >= 1, lowercased) -> Pro now? Same rule as
    isActiveProDoc in functions/api/chart/_rt.js; demo accounts count as Pro (isGexProToken)."""
    doc = doc or {}
    if doc.get('demo') is True:
        return True
    plan = str(doc.get('plan') or '').lower()
    if not plan or plan not in paid:
        return False
    if doc.get('subscriptionStatus') in ('expired', 'cancelled', 'canceled'):
        return False
    if doc.get('foundingMember') is True:
        return True
    try:
        pt = float(doc.get('paidThroughMillis') or 0)
    except (TypeError, ValueError):
        pt = 0
    if pt > 0 and now_ms > pt + GRACE_MS:
        return False
    return True


def prune(state, live_ids):
    for k in list(state):
        if k not in live_ids:
            del state[k]
    return state
