"""ZoroTide: options money flow (calls vs puts), estimated from the Cboe option chain.

Owner order 2026-10-29 ("Ok build it"). Used by gex_feeder.py, which already downloads the Cboe
chain for SPX / SPY / QQQ once a minute. No extra data source, no InsightSentry call.

METHOD (also written in the help text on the GEX+ page and in the chart indicator):
  Every sample, for each contract:
    new volume  = volume now - volume at the previous sample (the day's first sample starts from 0,
                  i.e. the count resets at the session open; a negative difference is ignored)
    premium     = new volume x price x 100, price = the contract's last trade price (mid if no last)
    side        = last >= ask - 25% of the spread  -> bought
                  last <= bid + 25% of the spread  -> sold
                  in between (or no usable quote)  -> split half and half
  Calls: bought is bullish money, sold is the opposite. Puts: the same count, shown on its own line.
  Net call premium = calls bought - calls sold. Net put premium = puts bought - puts sold.
  The site plots the running (cumulative) sums since 9:30 ET.

Sample = {u, day, t, s, cn, pn, cp, pp, cv, pv}
  t  Cboe chain time (epoch s)       s  spot            cn / pn  net call / net put premium ($, this sample)
  cp / pp  gross call / put premium ($, this sample)    cv / pv  new call / put contracts

The state (last volume per contract, only contracts with volume) lives in a small JSON file per
symbol so a one-shot run knows the previous sample. A day's first sample that arrives later than
LATE_START_S after the open only sets the baseline (we cannot know when that volume traded).
Stdlib only.
"""
import json
import math
import os
import re
from datetime import datetime
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York')
OCC = re.compile(r'^([A-Z^]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$')
OPTS = re.compile(rb'"options"\s*:\s*\[')
OBJ = re.compile(rb'\{[^{}\[\]]*\}')
TIDE_SYMBOLS = ('SPX', 'SPY', 'QQQ')
LATE_START_S = 150          # a first sample of the day later than this after 9:30 ET is a baseline only
SIDE_BAND = 0.25
CLOSE_MIN = 16 * 60 + 20    # no samples after 16:20 ET


def num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    return v if math.isfinite(v) else 0.0


def et_epoch(wall):
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?', str(wall or ''))
    if not m:
        return None
    y, mo, d, h, mi, se = (int(x or 0) for x in m.groups())
    return datetime(y, mo, d, h, mi, se, tzinfo=ET).timestamp()


def read_chain(raw):
    """Cboe JSON bytes -> (spot, chain_time_text, {occ: (cp, volume, last, bid, ask)}) for contracts with volume."""
    m0 = OPTS.search(raw)
    if not m0:
        raise ValueError('no options array')
    i = m0.end()
    j = raw.find(b']', i)
    head = json.loads(raw[:m0.start()] + b'"options":[]' + raw[j + 1:])
    data = head.get('data', head)
    spot = num(data.get('current_price'))
    if not spot > 0:
        raise ValueError('no spot')
    rows = {}
    for m in OBJ.finditer(raw, i, j):
        o = json.loads(m.group(0))
        vol = int(num(o.get('volume')))
        if vol <= 0:
            continue
        mm = OCC.match(o.get('option') or '')
        if not mm:
            continue
        rows[o['option']] = (mm.group(5), vol, num(o.get('last_trade_price')), num(o.get('bid')), num(o.get('ask')))
    return spot, data.get('last_trade_time'), rows


def price_of(last, bid, ask):
    """Premium price: the last trade; the mid when there was none."""
    if last > 0:
        return last
    if bid > 0 and ask >= bid:
        return (bid + ask) / 2
    return 0.0


def bought_share(last, bid, ask):
    """Share of the premium counted as BOUGHT (1), SOLD (0) or half and half (0.5)."""
    spread = ask - bid
    if not (ask > 0 and spread > 0) or last <= 0:
        return 0.5
    if last >= ask - SIDE_BAND * spread:
        return 1.0
    if last <= bid + SIDE_BAND * spread:
        return 0.0
    return 0.5


def open_epoch(day):
    return datetime.strptime(day + ' 09:30', '%Y-%m-%d %H:%M').replace(tzinfo=ET).timestamp()


def step(state, spot, chain_time, rows):
    """One sample. state = previous state dict or None. Returns (sample dict or None, new state)."""
    t = et_epoch(chain_time)
    if not t:
        return None, state
    dt = datetime.fromtimestamp(t, ET)
    day = dt.strftime('%Y-%m-%d')
    mins = dt.hour * 60 + dt.minute
    if dt.weekday() >= 5 or mins < 9 * 60 + 30 or mins > CLOSE_MIN:
        return None, state
    vols = {k: v[1] for k, v in rows.items()}
    if state and state.get('day') == day:
        if t <= state.get('t', 0):
            return None, state                     # Cboe did not reprint
        prev = state.get('vols', {})
    else:
        prev = None
        if t - open_epoch(day) > LATE_START_S:     # joined mid-session: baseline only
            return None, {'day': day, 't': t, 'vols': vols, 'from': t}
        prev = {}
    cn = pn = cp = pp = 0.0
    cv = pv = 0
    for k, (side, vol, last, bid, ask) in rows.items():
        dv = vol - prev.get(k, 0)
        if dv <= 0:
            continue
        px = price_of(last, bid, ask)
        if px <= 0:
            continue
        prem = dv * px * 100
        net = prem * (2 * bought_share(last, bid, ask) - 1)
        if side == 'C':
            cn += net; cp += prem; cv += dv
        else:
            pn += net; pp += prem; pv += dv
    # keep the day's highest count per contract, so a Cboe correction (count dips, then recovers) is not counted twice
    keep = dict(vols)
    for k, v in prev.items():
        if v > keep.get(k, 0):
            keep[k] = v
    new = {'day': day, 't': t, 'vols': keep, 'from': state.get('from') if state and state.get('day') == day else (t if prev == {} else None)}
    sample = {'day': day, 't': int(round(t)), 's': round(spot, 2), 'cn': int(round(cn)), 'pn': int(round(pn)),
              'cp': int(round(cp)), 'pp': int(round(pp)), 'cv': cv, 'pv': pv}
    return sample, new


def load_state(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def save_state(path, state):
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(state, f, separators=(',', ':'))
    os.replace(tmp, path)
