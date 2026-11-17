"""Phantom: options money flow per contract, estimated from the Cboe option chains (Owner order 17 Nov, roadmap card "phantom").

Used by gex_feeder.py, which already downloads the Cboe chain for SPX / SPY / QQQ / GLD once a minute. No extra data source.
There is NO trade tape here: every number is an ESTIMATE from the change in each contract's daily volume between two chain
snapshots (about one minute apart) and the contract's quote. Never call these "trades", "prints", "sweeps" or "blocks".

METHOD (the same as ZoroTide, gex-feeder/tide.py, per contract instead of summed):
  new volume  = volume now - the day's highest volume seen before (a dip from a Cboe correction is never counted twice)
  premium     = new volume x price x 100, price = the contract's last trade (mid when there was none)
  net         = premium x (2 x bought share - 1), bought share from where the last trade sat in the bid-ask spread
                (tide.bought_share: top 25 % = 1, bottom 25 % = 0, between = 0.5)
  scope       expiries up to 31 days out, every strike: the SAME scope as ZoroTide, so Phantom's day totals equal ZoroTide's.
              SPX and SPXW are different contracts with their own volume: both count (the page adds them up per strike cell).
  counting    from the day's first sample at the open (or, when the feeder joined later, from that sample: baseline only)
  OI          Cboe's open interest is the previous close's figure, fixed for the day. doi = today's OI - the previous session's OI
              (the overnight change: "position likely opened / closed"), pv = that contract's volume in the previous session.

Outputs per symbol and sample (see build()):
  board   the day so far per contract: [k, x, s, c, v, oi, p, n, px, doi, pv] (cols in BOARD_COLS) + totals + whale moves + the
          latest minute's top contracts (lm). Replaced every minute; the last one of each day is kept (past sessions).
  minute  {k: [new volume, premium]} for every contract that traded this sample (the per-contract drilldown reads these).
State: a small JSON file per symbol (last volumes, OI, running sums, top moves, the previous session's OI / volume).
Stdlib only. Education only. Not financial advice.
"""
import json
import os
import re
from datetime import datetime

import tide

PHANTOM_SYMBOLS = ('SPX', 'SPY', 'QQQ', 'GLD')
MAX_DAYS = 31
TOP_MOVES = 300            # whale moves kept per symbol and day (biggest per-minute premium jumps)
MOVES_PER_SAMPLE = 12      # candidates taken from each sample before the day list is cut to TOP_MOVES
LM_TOP = 50                # latest minute: biggest contracts (alerts read these)
MIN_MOVE_USD = 25000       # a per-minute jump below this is never a "whale move"
BOARD_COLS = ['k', 'x', 's', 'c', 'v', 'oi', 'p', 'n', 'px', 'doi', 'pv']
MOVE_COLS = ['t', 'k', 'dv', 'p', 'px', 'v', 'oi']
KEY = re.compile(r'^[A-Z]{1,6}\d{6}[CP]\d{8}$')


def read_chain(raw):
    """Cboe JSON bytes -> (spot, chain_time_text, {occ: (C|P, exp, strike, volume, oi, last, bid, ask)}): expiries <= 31 days, volume or OI."""
    m0 = tide.OPTS.search(raw)
    if not m0:
        raise ValueError('no options array')
    i = m0.end()
    j = raw.find(b']', i)
    head = json.loads(raw[:m0.start()] + b'"options":[]' + raw[j + 1:])
    data = head.get('data', head)
    spot = tide.num(data.get('current_price'))
    if not spot > 0:
        raise ValueError('no spot')
    ct = tide.et_epoch(data.get('last_trade_time'))
    today = datetime.fromtimestamp(ct, tide.ET).date() if ct else None
    rows = {}
    for m in tide.OBJ.finditer(raw, i, j):
        o = json.loads(m.group(0))
        mm = tide.OCC.match(o.get('option') or '')
        if not mm:
            continue
        vol, oi = int(tide.num(o.get('volume'))), int(tide.num(o.get('open_interest')))
        if vol <= 0 and oi <= 0:
            continue
        exp = '20%s-%s-%s' % (mm.group(2), mm.group(3), mm.group(4))
        if today is not None:
            days = (datetime.strptime(exp, '%Y-%m-%d').date() - today).days
            if days < 0 or days > MAX_DAYS:
                continue
        rows[o['option']] = (mm.group(5), exp, int(mm.group(6)) / 1000, vol, oi, tide.num(o.get('last_trade_price')), tide.num(o.get('bid')),
                             tide.num(o.get('ask')))
    return spot, data.get('last_trade_time'), rows


def _new_day(state, day, rows):
    prev = None
    if state and state.get('day') and state.get('day') != day:
        prev = {'day': state['day'], 'oi': state.get('oi') or {}, 'vol': state.get('vols') or {}}
    elif state and state.get('prev'):
        prev = state['prev']
    return {'day': day, 't': 0, 'from': None, 'vols': {}, 'oi': {k: r[4] for k, r in rows.items() if r[4] > 0}, 'acc': {},
            'moves': [], 'prev': prev}


def step(state, spot, chain_time, rows):
    """One sample. Returns (result or None, new state). result = {'day', 't', 'spot', 'minute': {k: [dv, prem]}, 'lm': [...]}.
    State changes in place where possible (the caller saves it)."""
    t = tide.et_epoch(chain_time)
    if not t:
        return None, state
    dt = datetime.fromtimestamp(t, tide.ET)
    day = dt.strftime('%Y-%m-%d')
    mins = dt.hour * 60 + dt.minute
    if dt.weekday() >= 5 or mins < 9 * 60 + 30 or mins > tide.CLOSE_MIN:
        return None, state
    if not state or state.get('day') != day:
        state = _new_day(state, day, rows)
        if t - tide.open_epoch(day) > tide.LATE_START_S:          # joined mid-session: baseline only
            state['vols'] = {k: r[3] for k, r in rows.items()}
            state['t'] = t
            state['from'] = int(t)
            return None, state
        state['from'] = int(tide.open_epoch(day))
    elif t <= state.get('t', 0):
        return None, state                                       # Cboe did not reprint
    prev = state['vols']
    minute, cands = {}, []
    for k, (cp, exp, strike, vol, oi, last, bid, ask) in rows.items():
        if oi > 0 and k not in state['oi']:
            state['oi'][k] = oi
        dv = vol - prev.get(k, 0)
        if dv <= 0:
            continue
        prev[k] = vol                                           # the day's highest count (a later dip never re-counts)
        px = tide.price_of(last, bid, ask)
        if px <= 0:
            continue
        prem = dv * px * 100
        net = prem * (2 * tide.bought_share(last, bid, ask) - 1)
        a = state['acc'].setdefault(k, [0, 0, 0.0])
        a[0] += int(round(prem)); a[1] += int(round(net)); a[2] = round(px, 4)
        minute[k] = [dv, int(round(prem))]
        cands.append([int(round(t)), k, dv, int(round(prem)), round(px, 4), vol, state['oi'].get(k, oi)])
    cands.sort(key=lambda r: -r[3])
    state['moves'] = rank_moves(state['moves'], [c for c in cands[:MOVES_PER_SAMPLE] if c[3] >= MIN_MOVE_USD])
    state['t'] = t
    lm = [[c[1], c[2], c[3], c[5], c[6]] for c in cands[:LM_TOP]]       # [k, new volume, premium, day volume, OI]
    return {'day': day, 't': int(round(t)), 'spot': round(spot, 2), 'minute': minute, 'lm': lm}, state


def rank_moves(old, new, top=TOP_MOVES):
    """Day list of whale moves: biggest premium first (ties: earlier first), at most `top`."""
    return sorted(old + new, key=lambda r: (-r[3], r[0], r[1]))[:top]


def board(state, rows, spot, res):
    """The day-so-far board for this symbol (one gzip JSON part)."""
    prev = state.get('prev') or {}
    poi, pvol = prev.get('oi') or {}, prev.get('vol') or {}
    exps = sorted({r[1] for r in rows.values()})
    xi = {e: i for i, e in enumerate(exps)}
    out, tot = [], {'cp': 0, 'pp': 0, 'cn': 0, 'pn': 0, 'cv': 0, 'pv': 0}
    for k, (cp, exp, strike, vol, oi, last, bid, ask) in sorted(rows.items()):
        a = state['acc'].get(k)
        if vol <= 0 and not a and not pvol.get(k):
            continue                                            # kept when it traded in the previous session (its overnight OI change)
        p, n = (a[0], a[1]) if a else (0, 0)
        oi0 = state['oi'].get(k, oi)
        doi = oi0 - poi[k] if prev and k in poi else None
        out.append([k, xi[exp], strike, cp, vol, oi0, p, n, round(tide.price_of(last, bid, ask), 4), doi, pvol.get(k) if prev else None])
        side = 'c' if cp == 'C' else 'p'
        tot[side + 'p'] += p; tot[side + 'n'] += n; tot[side + 'v'] += vol
    return {'v': 1, 'u': res.get('u'), 'day': state['day'], 't': res['t'], 'spot': res['spot'], 'from': state.get('from'), 'prevDay': prev.get('day'),
            'exps': exps, 'cols': BOARD_COLS, 'rows': out, 'tot': tot, 'mcols': MOVE_COLS, 'moves': state['moves'], 'lm': res['lm'],
            'minute': res['minute']}


def load_state(path):
    return tide.load_state(path)


def save_state(path, state):
    tide.save_state(path, state)


def valid_key(k):
    return bool(KEY.match(k or ''))
