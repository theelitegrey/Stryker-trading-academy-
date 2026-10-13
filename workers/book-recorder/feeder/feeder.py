#!/usr/bin/env python3
"""TradeZoro book feeder: Binance spot order book -> book recorder Worker, once a minute.

Why it exists: Binance refuses Cloudflare's egress IPs (api.binance.com HTTP 451,
data-api.binance.vision HTTP 403), so the recorder Worker cannot fetch the book itself. This
server can. Run by a systemd timer every 60 s (book-feeder.timer); each run is one short
process (no daemon, a few MB of RAM), logs one line per symbol to the journal and exits.

Per run: for each symbol, GET /api/v3/depth?limit=5000 (api.binance.com, falling back to
data-api.binance.vision, 15 s timeout each, no retries beyond that one fallback), bucket it with
the SAME rule as the Charts client and the Worker (rows = nice step at or below 0.05% of the
price, +-2% of the mid, bids/asks summed per row as Float32; parity-tested in
workers/book-recorder/test/parity.test.mjs), then ONE POST of all symbols to <Worker>/ingest
with the shared secret in the x-ingest-key header.

Config (env, from /root/projects/book-feeder/feeder.env, mode 0600):
  BOOK_RECORDER_URL   e.g. https://book-recorder.theelitegrey.workers.dev
  BOOK_INGEST_SECRET  shared secret (never logged)
  SYMBOLS             default BTCUSDT,ETHUSDT
Stdlib only.

Test mode (parity): feeder.py --bucket <depth.json[.gz]> <ts_ms>  -> hex of the encoded sample.
"""
import gzip
import json
import math
import os
import struct
import sys
import time
import urllib.error
import urllib.request
from array import array

FEEDS = (('binance.com', 'https://api.binance.com/api/v3/depth'),
         ('binance.vision', 'https://data-api.binance.vision/api/v3/depth'))
AUTO_ROW = 0.0005
RANGE = 0.02
ROWS_SIDE_MAX = 400
TIMEOUT = 15
UA = 'tradezoro-book-feeder/1'


def near_nice_step(raw):
    if not raw > 0:
        return 1
    p = math.pow(10, math.floor(math.log10(raw)))
    best = p
    for m in (1, 2, 2.5, 5, 10):
        if m * p <= raw * 1.0001:
            best = m * p
    return best


def nice_step(raw):
    if not raw > 0:
        return 1
    p = math.pow(10, math.floor(math.log10(raw)))
    m = raw / p
    return (1 if m <= 1 else 2 if m <= 2 else 2.5 if m <= 2.5 else 5 if m <= 5 else 10) * p


def store_step(mid):
    step = near_nice_step(mid * AUTO_ROW)
    floor = mid * RANGE / ROWS_SIDE_MAX
    if step < floor:
        step = nice_step(floor)
    return step


def row_of(p, step):
    return math.floor(p / step + 1e-9)


def _levels(rows):
    # dict keeps first-seen order and last value, like the client's Map
    out = {}
    for r in rows or []:
        try:
            p, q = float(r[0]), float(r[1])
        except (TypeError, ValueError, IndexError):
            continue
        if math.isfinite(p) and math.isfinite(q) and q > 0:
            out[p] = q
    return out


def bucket(d, ts):
    bids, asks = _levels(d.get('bids')), _levels(d.get('asks'))
    bb = max(bids) if bids else None
    ba = min(asks) if asks else None
    if bb and ba and bb > 0 and ba > 0:
        mid = (bb + ba) / 2
    else:
        mid = bb or ba or 0
    if not mid > 0:
        return None
    step = store_step(mid)
    mi, lo, hi = row_of(mid, step), row_of(mid * (1 - RANGE), step), row_of(mid * (1 + RANGE), step)
    v = array('f', bytes(4 * (hi - lo + 1)))  # float32: each += rounds like JS Float32Array
    for p, q in bids.items():
        i = row_of(p, step)
        if lo <= i < mi:
            v[i - lo] += q
    for p, q in asks.items():
        i = row_of(p, step)
        if mi < i <= hi:
            v[i - lo] -= q
    a, b = 0, len(v) - 1
    while a <= b and v[a] == 0:
        a += 1
    while b >= a and v[b] == 0:
        b -= 1
    return {'ts': ts, 'mid': mid, 'bb': bb, 'ba': ba, 'step': step, 'i0': lo + a, 'v': v[a:b + 1] if a <= b else array('f')}


def encode(samples):
    # 'BKR1' | u32 count | per sample: f64 ts, mid, bb, ba, step, i32 i0, u32 n, n x f32 (LE)
    parts = [b'BKR1', struct.pack('<I', len(samples))]
    for s in samples:
        v = array('f', s['v'])
        if sys.byteorder != 'little':
            v.byteswap()
        parts.append(struct.pack('<dddddiI', float(s['ts']), s['mid'], s['bb'] or 0.0, s['ba'] or 0.0, s['step'], s['i0'], len(v)))
        parts.append(v.tobytes())
    return b''.join(parts)


def log(msg):
    print(msg, flush=True)


def fetch_depth(sym, deadline):
    errs = []
    for fid, base in FEEDS:
        if time.monotonic() > deadline:
            errs.append(fid + ' skipped (run time budget)')
            break
        try:
            req = urllib.request.Request(base + '?symbol=' + sym + '&limit=5000', headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return fid, json.load(r), errs
        except urllib.error.HTTPError as e:
            errs.append('%s HTTP %s' % (fid, e.code))
        except Exception as e:  # timeout, DNS, bad JSON
            errs.append('%s %s' % (fid, type(e).__name__))
    return None, None, errs


def main():
    url = os.environ.get('BOOK_RECORDER_URL', '').rstrip('/')
    key = os.environ.get('BOOK_INGEST_SECRET', '')
    syms = [s.strip().upper() for s in os.environ.get('SYMBOLS', 'BTCUSDT,ETHUSDT').split(',') if s.strip()]
    if not url or len(key) < 32:
        log('config missing: BOOK_RECORDER_URL / BOOK_INGEST_SECRET')
        return 2
    deadline = time.monotonic() + 35  # leave room for the POST inside the 60 s period
    out, got, feeds = [], [], []
    for sym in syms:
        fid, d, errs = fetch_depth(sym, deadline)
        s = bucket(d, int(time.time() * 1000)) if d else None
        if s and len(s['v']):
            out.append(s); got.append(sym); feeds.append(fid)
            log('%s %s mid=%.2f step=%g rows=%d%s' % (sym, fid, s['mid'], s['step'], len(s['v']), (' (' + '; '.join(errs) + ')') if errs else ''))
        else:
            log('%s no sample: %s' % (sym, '; '.join(errs) or 'empty book'))
    if not out:
        return 1
    body = encode(out)
    req = urllib.request.Request(url + '/ingest?symbols=' + ','.join(got), data=body, method='POST', headers={
        'content-type': 'application/octet-stream', 'x-ingest-key': key, 'x-feed': ','.join(feeds), 'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            log('ingest HTTP %s %s (%d B)' % (r.status, r.read(200).decode('utf-8', 'replace'), len(body)))
            return 0
    except urllib.error.HTTPError as e:
        log('ingest HTTP %s %s' % (e.code, e.read(200).decode('utf-8', 'replace')))
    except Exception as e:
        log('ingest failed: %s' % type(e).__name__)
    return 1


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--bucket':
        raw = open(sys.argv[2], 'rb').read()
        if sys.argv[2].endswith('.gz'):
            raw = gzip.decompress(raw)
        print(encode([bucket(json.loads(raw), int(sys.argv[3]))]).hex())
        sys.exit(0)
    sys.exit(main())
