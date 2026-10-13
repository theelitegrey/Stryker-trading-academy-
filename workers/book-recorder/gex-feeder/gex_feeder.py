#!/usr/bin/env python3
"""TradeZoro GEX chain feeder: Cboe option chains -> compact chains -> recorder Worker.

Why it exists: the full Cboe chain is ~5 MB (QQQ) and ~13 MB (SPX). Downloading and parsing that
inside the /api/gex/levels Pages Function blew Cloudflare's CPU limit (error 1102, build 528,
2026-10-13). This server does the heavy part. The Worker only stores and serves the small result,
and the API reads it with one small fetch.

Per run, for each symbol (QQQ, _SPX, SPY by default):
  - GET https://cdn.cboe.com/api/global/delayed_quotes/options/<SYM>.json (redirects to
    cdn-api.cboe.com; urllib follows it). The top-level fields are read from the head and tail of
    the document. The options array is scanned one flat {...} object at a time, so the 13 MB
    document never becomes a 13 MB tree of Python objects.
  - Keep only what the GEX engine reads (functions/api/gex/_engine.js parseCompact):
    strike, C/P, OI, IV, bid, ask, volume, delta.
    - part "near": the first 3 expiries on/after today (0DTE, 1DTE and one spare), strikes within
      +-12% of spot.
    - part "term": expiries up to 31 days out (1W / 1M modes), strikes within +-10% of spot,
      rows with OI > 0 only.
  - gzip each part (well under 200 KB; checked) and POST it to <Worker>/gex-ingest with the
    shared secret (header x-ingest-key, the same secret as the book feeder).

When: a systemd timer fires every 2 minutes. The script itself runs only on weekdays from 09:00
to 16:20 ET, plus one run between 16:30 and 16:33 ET (after the close). Use --force to run at any
other time. Stdlib only.

Config (env, /root/projects/book-feeder/feeder.env, mode 0600): BOOK_RECORDER_URL,
BOOK_INGEST_SECRET (never logged), GEX_SYMBOLS (default QQQ,_SPX,SPY).
Test mode: gex_feeder.py --compact <cboe.json> <now_epoch>  -> prints the compact JSON (near+term).
"""
import gzip
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

CBOE = 'https://cdn.cboe.com/api/global/delayed_quotes/options/'
UA = 'Mozilla/5.0 (tradezoro-gex-feeder/1)'
ET = ZoneInfo('America/New_York')
OCC = re.compile(r'^([A-Z^]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$')
OPTS = re.compile(rb'"options"\s*:\s*\[')
OBJ = re.compile(rb'\{[^{}\[\]]*\}')      # one flat option object (no nested braces or arrays)
NEAR_EXPIRIES = 3
NEAR_BAND = 0.12
TERM_DAYS = 31
TERM_BAND = 0.10
MAX_PART = 200 * 1024
FETCH_TIMEOUT = 40
POST_TIMEOUT = 15


def log(msg):
    print(msg, flush=True)


def in_window(now):
    t = now.astimezone(ET)
    if t.weekday() >= 5:
        return False
    m = t.hour * 60 + t.minute
    return 9 * 60 <= m <= 16 * 60 + 20 or 16 * 60 + 30 <= m <= 16 * 60 + 33


def num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    return v if math.isfinite(v) else 0.0


def r4(x):
    return round(x, 4)


def compact(raw, now_epoch):
    """raw: bytes of the Cboe JSON. Returns {'near': dict, 'term': dict}."""
    m0 = OPTS.search(raw)
    if not m0:
        raise ValueError('no options array')
    i = m0.end()
    j = raw.find(b']', i)             # option objects hold no arrays, so the first ] closes it
    head = json.loads(raw[:m0.start()] + b'"options":[]' + raw[j + 1:])
    data = head.get('data', head)
    spot = num(data.get('current_price'))
    if not spot > 0:
        raise ValueError('no spot')
    today = datetime.fromtimestamp(now_epoch, ET).date()
    rows = {}
    sym = data.get('symbol') or head.get('symbol')
    for m in OBJ.finditer(raw, i, j):
        o = json.loads(m.group(0))
        mm = OCC.match(o.get('option') or '')
        if not mm:
            continue
        exp = '20%s-%s-%s' % (mm.group(2), mm.group(3), mm.group(4))
        days = (datetime.strptime(exp, '%Y-%m-%d').date() - today).days
        if days < 0 or days > TERM_DAYS:
            continue
        k = int(mm.group(6)) / 1000
        if abs(k - spot) / spot > NEAR_BAND:
            continue
        rows.setdefault(exp, []).append([k, mm.group(5), int(num(o.get('open_interest'))), r4(num(o.get('iv'))),
                                         r4(num(o.get('bid'))), r4(num(o.get('ask'))), int(num(o.get('volume'))),
                                         r4(num(o.get('delta')))])
    exps = sorted(rows)
    meta = {'v': 1, 'symbol': sym, 'spot': spot, 'iv30': num(data.get('iv30')),
            'chain_time': data.get('last_trade_time'), 'fetched_at': int(now_epoch),
            'cols': ['strike', 'cp', 'oi', 'iv', 'bid', 'ask', 'vol', 'delta']}
    near = dict(meta, part='near', expiries={e: sorted(rows[e]) for e in exps[:NEAR_EXPIRIES]})
    term = dict(meta, part='term', expiries={
        e: sorted(r for r in rows[e] if r[2] > 0 and abs(r[0] - spot) / spot <= TERM_BAND) for e in exps})
    return {'near': near, 'term': term}


def fetch(sym):
    req = urllib.request.Request(CBOE + sym + '.json', headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as r:
        return r.read()


def post(url, key, sym, part, body):
    req = urllib.request.Request('%s/gex-ingest?sym=%s&part=%s' % (url, sym.lstrip('_'), part), data=body, method='POST',
                                 headers={'content-type': 'application/octet-stream', 'x-ingest-key': key, 'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=POST_TIMEOUT) as r:
            return '%s %s' % (r.status, r.read(120).decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        return '%s %s' % (e.code, e.read(120).decode('utf-8', 'replace'))
    except Exception as e:
        return 'failed ' + type(e).__name__


def main(force=False):
    if not force and not in_window(datetime.now(timezone.utc)):
        return 0
    url = os.environ.get('BOOK_RECORDER_URL', '').rstrip('/')
    key = os.environ.get('BOOK_INGEST_SECRET', '')
    syms = [s.strip().upper() for s in os.environ.get('GEX_SYMBOLS', 'QQQ,_SPX,SPY').split(',') if s.strip()]
    if not url or len(key) < 32:
        log('config missing: BOOK_RECORDER_URL / BOOK_INGEST_SECRET')
        return 2
    bad = 0
    for sym in syms:
        t0 = time.monotonic()
        try:
            raw = fetch(sym)
            parts = compact(raw, time.time())
            size = len(raw)
            del raw
        except Exception as e:
            log('%s fetch/parse failed: %s %s' % (sym, type(e).__name__, str(e)[:80]))
            bad += 1
            continue
        out = []
        for part, d in parts.items():
            body = gzip.compress(json.dumps(d, separators=(',', ':')).encode(), 6)
            if len(body) > MAX_PART:
                out.append('%s too big %d B' % (part, len(body)))
                bad += 1
                continue
            res = post(url, key, sym, part, body)
            bad += 0 if res.startswith('200') else 1
            out.append('%s %d exp %d B -> %s' % (part, len(d['expiries']), len(body), res))
        log('%s spot=%s chain=%s src=%d B %.1fs | %s' % (sym, parts['near']['spot'], parts['near']['chain_time'], size,
                                                     time.monotonic() - t0, ' | '.join(out)))
    return 1 if bad else 0


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--compact':
        print(json.dumps(compact(open(sys.argv[2], 'rb').read(), float(sys.argv[3])), separators=(',', ':')))
        sys.exit(0)
    sys.exit(main(force='--force' in sys.argv))
