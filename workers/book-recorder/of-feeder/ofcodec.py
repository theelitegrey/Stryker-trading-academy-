"""Order-flow bar codec + tick aggregation (shared by of_feeder.py and the tests).

The same maths and wire format live in workers/book-recorder/src/orderflow.js (Worker: validate,
store, serve) and assets/chart-footprint-data.js (client: decode, re-aggregate). The parity test
(workers/book-recorder/test/orderflow.test.mjs) checks the Python and JS encoders give identical
bytes for the saved tick fixture.

One record = one symbol, one 1-minute bar, prices as integer tick indexes (price / tick):
  uvarint  t        minute since the epoch (bar open time / 60)
  svarint  lo       lowest traded price index
  uvarint  n        number of price rows (hi - lo + 1)
  uvarint  o, c     open / close as offsets from lo
  n x (uvarint buy, uvarint sell)   volume at each row, lo upwards (buy = aggressive buyer)
  svarint  dmax, dmin               running delta high / low inside the bar
  uvarint  trades                   number of prints
  uvarint  nb                       big trades, then per big trade:
           uvarint ms (offset inside the minute), uvarint price offset from lo,
           uvarint size * 2 + side (1 = buy, 0 = sell)
  uvarint  np                       1-second path (tick-by-tick bar replay), only seconds that
           traded, ascending: uvarint sec (0-59), uvarint o-lo, h-lo, l-lo, c-lo, volume
A payload = b'OF1\\n' + uvarint len + header JSON (utf-8) + uvarint count + count x (uvarint len + record).

Ticks with no side (IS sends the first print of a day without "type") are counted in neither
buy nor sell; they still set open/high/low/close. A "big trade" is one aggressive order: the
consecutive prints with the same timestamp microsecond-group (same millisecond) and the same
side, summed; it is big when the sum >= the symbol's threshold (the 99.5th percentile of those
order sizes over the previous session, see big_threshold()).
"""
import json

MAGIC = b'OF1\n'


def uv(n, out):
    n = int(n)
    if n < 0:
        raise ValueError('uvarint < 0')
    while n >= 0x80:
        out.append((n & 0x7f) | 0x80)
        n >>= 7
    out.append(n)


def sv(n, out):
    n = int(n)
    uv((n << 1) if n >= 0 else ((-n) << 1) - 1, out)


def read_uv(b, i):
    n = 0
    s = 0
    while True:
        x = b[i]
        i += 1
        n |= (x & 0x7f) << s
        if x < 0x80:
            return n, i
        s += 7


def read_sv(b, i):
    n, i = read_uv(b, i)
    return (n >> 1) if not (n & 1) else -((n + 1) >> 1), i


def pidx(price, tick):
    return int(round(price / tick))


class Bar:
    __slots__ = ('t', 'o', 'c', 'lv', 'd', 'dmax', 'dmin', 'trades', 'bigs', 'secs')

    def __init__(self, t):
        self.t = t            # minute index
        self.o = None
        self.c = None
        self.lv = {}          # price index -> [buy, sell]
        self.d = 0
        self.dmax = 0
        self.dmin = 0
        self.trades = 0
        self.bigs = []        # (ms in minute, price index, size, side)
        self.secs = {}        # second in minute -> [o, h, l, c, volume] (price indexes)

    def add(self, p, v, side, sec=0):
        q = self.secs.get(sec)
        if q is None:
            self.secs[sec] = [p, p, p, p, v]
        else:
            if p > q[1]:
                q[1] = p
            if p < q[2]:
                q[2] = p
            q[3] = p
            q[4] += v
        if self.o is None:
            self.o = p
        self.c = p
        self.trades += 1
        r = self.lv.get(p)
        if r is None:
            r = self.lv[p] = [0, 0]
        if side == 1:
            r[0] += v
            self.d += v
        elif side == 0:
            r[1] += v
            self.d -= v
        if self.d > self.dmax:
            self.dmax = self.d
        if self.d < self.dmin:
            self.dmin = self.d

    def encode(self):
        out = bytearray()
        lo = min(self.lv)
        hi = max(self.lv)
        uv(self.t, out)
        sv(lo, out)
        uv(hi - lo + 1, out)
        uv(self.o - lo, out)
        uv(self.c - lo, out)
        for p in range(lo, hi + 1):
            r = self.lv.get(p)
            if r:
                uv(r[0], out)
                uv(r[1], out)
            else:
                out.append(0)
                out.append(0)
        sv(self.dmax, out)
        sv(self.dmin, out)
        uv(self.trades, out)
        bigs = sorted(self.bigs)
        uv(len(bigs), out)
        for ms, p, size, side in bigs:
            uv(ms, out)
            uv(p - lo, out)
            uv(size * 2 + side, out)
        uv(len(self.secs), out)
        for sec in sorted(self.secs):
            o, h, l, c, v = self.secs[sec]
            uv(sec, out)
            uv(o - lo, out)
            uv(h - lo, out)
            uv(l - lo, out)
            uv(c - lo, out)
            uv(v, out)
        return bytes(out)


class Aggregator:
    """Feed ticks in time order; keeps one Bar per minute plus the big-trade grouping."""

    def __init__(self, tick, thr):
        self.tick = tick
        self.thr = thr
        self.bars = {}
        self.g = None          # pending order: [ms_abs, side, size, price_idx_first, minute]
        self.sizes = []        # every order size (for the next session's threshold)

    def _flush(self):
        g = self.g
        self.g = None
        if not g:
            return
        self.sizes.append(g[2])
        if self.thr and g[2] >= self.thr:
            b = self.bars.get(g[4])
            if b is not None:
                b.bigs.append((g[0] - g[4] * 60000, g[3], g[2], g[1]))

    def add(self, t_sec, price, vol, typ):
        side = 1 if typ == 'buy' else 0 if typ == 'sell' else -1
        m = int(t_sec // 60)
        p = pidx(price, self.tick)
        v = int(round(vol))
        if v <= 0:
            return
        b = self.bars.get(m)
        if b is None:
            b = self.bars[m] = Bar(m)
        b.add(p, v, side, int(t_sec - m * 60))
        if side < 0:
            return
        ms = int(t_sec * 1000)
        g = self.g
        if g and g[0] == ms and g[1] == side:
            g[2] += v
        else:
            self._flush()
            self.g = [ms, side, v, p, m]

    def finish(self):
        self._flush()

    def pop_before(self, minute):
        """Remove and return the bars older than `minute` (sorted)."""
        old = sorted(k for k in self.bars if k < minute)
        return [self.bars.pop(k) for k in old]


def big_threshold(sizes, q=0.995, floor=5):
    """99.5th percentile of the session's aggressive order sizes, never below `floor` contracts."""
    if not sizes:
        return floor
    s = sorted(sizes)
    k = min(len(s) - 1, int(q * (len(s) - 1) + 0.5))
    return max(floor, int(s[k]))


def payload(header, records):
    out = bytearray(MAGIC)
    h = json.dumps(header, separators=(',', ':'), sort_keys=True).encode()
    uv(len(h), out)
    out += h
    uv(len(records), out)
    for r in records:
        uv(len(r), out)
        out += r
    return bytes(out)


def decode_record(b):
    i = 0
    t, i = read_uv(b, i)
    lo, i = read_sv(b, i)
    n, i = read_uv(b, i)
    o, i = read_uv(b, i)
    c, i = read_uv(b, i)
    buy = []
    sell = []
    for _ in range(n):
        x, i = read_uv(b, i)
        y, i = read_uv(b, i)
        buy.append(x)
        sell.append(y)
    dmax, i = read_sv(b, i)
    dmin, i = read_sv(b, i)
    trades, i = read_uv(b, i)
    nb, i = read_uv(b, i)
    bigs = []
    for _ in range(nb):
        ms, i = read_uv(b, i)
        po, i = read_uv(b, i)
        sz, i = read_uv(b, i)
        bigs.append((ms, lo + po, sz >> 1, sz & 1))
    np_, i = read_uv(b, i)
    secs = []
    for _ in range(np_):
        row = []
        for _k in range(6):
            x, i = read_uv(b, i)
            row.append(x)
        secs.append((row[0], lo + row[1], lo + row[2], lo + row[3], lo + row[4], row[5]))
    return {'t': t, 'lo': lo, 'o': lo + o, 'c': lo + c, 'buy': buy, 'sell': sell, 'dmax': dmax, 'dmin': dmin,
            'trades': trades, 'bigs': bigs, 'secs': secs, 'end': i}
