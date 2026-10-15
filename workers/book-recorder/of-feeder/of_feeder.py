#!/usr/bin/env python3
"""TradeZoro order-flow feeder: InsightSentry tick trades -> 1-minute footprint bars -> recorder Worker.

Why on this server: one NQ day is ~365k prints (~25 MB of JSON). Parsing that in a Pages Function
blows Cloudflare's CPU budget (error 1102, build 528), so this server aggregates and the Worker only
stores and serves small pre-computed bars (see ofcodec.py for the record format).

Sources (measured 2026-10-14 with our key):
  - WebSocket wss://realtime.insightsentry.com/live, bar_type "tick": every print with time (us),
    close, volume, type buy|sell. A socket takes at most 5 subscriptions (measured), so the six
    symbols ride two sockets of three. On (re)connect "dp": 30000 replays the latest 30,000 prints
    per symbol, so a short drop leaves no hole (prints at or before the last one seen are skipped;
    a replay that does not reach back far enough marks that first minute partial, never posted).
    12 sockets at once were accepted, so these two leave room for the site's own chart sockets.
  - REST /v3/symbols/{code}/trades?date=YYYY-MM-DD: a whole UTC day (today + the previous six
    dates only; older dates answer HTTP 400). Used for the one-time backfill and, every day after
    00:20 UTC, to rebuild the day that just ended from the full record (fills any gap the socket
    missed and sets that day's big-trade threshold). The ~25 MB answer is read in 1 MB chunks and
    scanned one {...} print at a time, never parsed as one tree.

Every POST_EVERY seconds the bars that changed are POSTed (gzip) to <Worker>/of-ingest with the
shared secret (x-ingest-key, the book feeder's BOOK_INGEST_SECRET, never logged).

Run modes:
  of_feeder.py                        live loop (systemd service of-feeder.service)
  of_feeder.py --backfill [N]         rebuild the previous N UTC days (default 6, the IS maximum)
  of_feeder.py --dry-run <ticks.json[.gz]> <SYM> [out.bin]   aggregate a saved IS reply, print stats
Config (env, /root/projects/book-feeder/feeder.env + the InsightSentry key file): BOOK_RECORDER_URL,
BOOK_INGEST_SECRET, INSIGHTSENTRY_WEBSOCKET_API_KEY. Stdlib only (wsmini.py is the socket client).
"""
import gzip
import json
import os
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ofcodec  # noqa: E402
import wsmini  # noqa: E402

# root -> (InsightSentry exchange prefix, tick size, listed contract months, first month offset).
# Micros (MNQ, MES, MYM, MGC, SIL, MCL) are served the mini's data by the site (same prices; the
# minis carry the volume). The traded contract is picked by activity, not "1!": IS maps COMEX:GC1!
# to the October gold contract (2 prints on 2026-10-13) while December traded all day; SI1! had none.
ROOTS = {
    'NQ': ('CME_MINI', 0.25, 'HMUZ', 0),
    'ES': ('CME_MINI', 0.25, 'HMUZ', 0),
    'YM': ('CBOT_MINI', 1.0, 'HMUZ', 0),
    'GC': ('COMEX', 0.1, 'GJMQVZ', 0),
    'SI': ('COMEX', 0.005, 'HKNUZ', 0),
    'CL': ('NYMEX', 0.01, 'FGHJKMNQUVXZ', 1),
}
MONTH = 'FGHJKMNQUVXZ'


def candidates(root, today):
    """The next two listed contracts on/after this month (CL: from next month), e.g. GC in October 2026
    -> COMEX:GCV2026, COMEX:GCZ2026."""
    pre, _, cyc, off = ROOTS[root]
    y, m = today.year, today.month + off
    out = []
    while len(out) < 2:
        if m > 12:
            y, m = y + 1, m - 12
        if MONTH[m - 1] in cyc:
            out.append('%s:%s%s%d' % (pre, root, MONTH[m - 1], y))
        m += 1
    return out


SYMS = {r: ('%s:%s1!' % (v[0], r), v[1]) for r, v in ROOTS.items()}   # replaced by pick_contracts()
API = 'https://api.insightsentry.com/v3/symbols/'
WS = 'wss://realtime.insightsentry.com/live'
UA = 'tradezoro-of-feeder/1'
POST_EVERY = 10           # loop tick; NQ and ES post every round (live footprint), the rest every SLOW_EVERY
SLOW_EVERY = 30
FAST_SYMS = ('NQ', 'ES')
last_post = {}
SUBS_PER_SOCKET = 3
CLOSE_GRACE = 5           # a bar counts as closed 5 s after its minute ends (socket lag)
KEEP_LIVE_MIN = 3            # minutes of bars kept in memory (re-sent while they can still change)
STATE = os.environ.get('OF_STATE', '/root/projects/book-feeder/of-state.json')
TRADE = re.compile(rb'\{[^{}]*\}')
TIME_RE = re.compile(rb'"time"\s*:\s*([0-9.eE+-]+)')
CLOSE_RE = re.compile(rb'"close"\s*:\s*([0-9.eE+-]+)')
VOL_RE = re.compile(rb'"volume"\s*:\s*([0-9.eE+-]+)')
TYPE_RE = re.compile(rb'"type"\s*:\s*"(buy|sell)"')
CODE_RE = re.compile(rb'"code"\s*:\s*"([^"]+)"')
MAX_POST = 120 * 1024       # raw bytes per POST (the Worker refuses > 256 KB)
POST_BARS = 300             # bars per POST: keeps the Worker's validation inside the free CPU budget


def log(msg):
    print(msg, flush=True)


# Self-alert (2026-10-15 outage: the Worker answered 500 for 11 h and nobody was told). Counts
# consecutive failed POST rounds; at ALERT_AFTER it logs one "ALERT" line (greppable in journalctl)
# and writes HEALTH_FILE; repeats every ALERT_EVERY s while it lasts, "RECOVERED" when a post works.
ALERT_AFTER = 5
ALERT_EVERY = 900
HEALTH_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'of-health.json')
_fail = {'n': 0, 'since': 0, 'last_alert': 0, 'code': ''}


def note_post(ok, detail=''):
    now = time.time()
    if ok:
        if _fail['n'] >= ALERT_AFTER:
            log('RECOVERED of-feeder: Worker accepts posts again after %d failed rounds' % _fail['n'])
        _fail.update(n=0, since=0, last_alert=0, code='')
    else:
        if not _fail['n']:
            _fail['since'] = now
        _fail['n'] += 1
        _fail['code'] = str(detail)[:60]
        if _fail['n'] >= ALERT_AFTER and now - _fail['last_alert'] >= ALERT_EVERY:
            _fail['last_alert'] = now
            log('ALERT of-feeder: %d failed posts in a row since %s UTC (last: %s)' % (
                _fail['n'], time.strftime('%H:%M:%S', time.gmtime(_fail['since'])), _fail['code']))
    try:
        with open(HEALTH_FILE, 'w') as f:
            json.dump({'ok': _fail['n'] < ALERT_AFTER, 'fails': _fail['n'], 'since': _fail['since'], 'last': _fail['code'], 'at': int(now)}, f)
    except OSError:
        pass


def load_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(st):
    tmp = STATE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(st, f)
    os.replace(tmp, STATE)


def iter_trades(chunks):
    """Yield (time, close, volume, type|None) from an IS trades JSON, chunk by chunk."""
    buf = b''
    for ch in chunks:
        buf += ch
        last = 0
        for m in TRADE.finditer(buf):
            o = m.group(0)
            t = TIME_RE.search(o)
            c = CLOSE_RE.search(o)
            v = VOL_RE.search(o)
            if t and c and v:
                ty = TYPE_RE.search(o)
                yield float(t.group(1)), float(c.group(1)), float(v.group(1)), (ty.group(1).decode() if ty else None)
            last = m.end()
        buf = buf[last:]
        if len(buf) > 4096:          # header text before the series array, never a print
            buf = buf[-4096:]


def file_chunks(path):
    op = gzip.open if path.endswith('.gz') else open
    with op(path, 'rb') as f:
        while True:
            b = f.read(1 << 20)
            if not b:
                return
            yield b


def http_chunks(code, day, key, meta, window=None):
    url = API + urllib.parse.quote(code, safe=':!') + '/trades?date=' + day + ('&window=' + window if window else '')
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + key, 'Accept-Encoding': 'gzip', 'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        meta['status'] = r.status
        src = gzip.GzipFile(fileobj=r) if r.headers.get('content-encoding') == 'gzip' else r
        first = True
        while True:
            b = src.read(1 << 20)
            if not b:
                return
            if first:
                m = CODE_RE.search(b[:400])
                meta['contract'] = m.group(1).decode() if m else ''
                first = False
            yield b


def aggregate_day(trades, tick):
    """Two passes over one day of prints are avoided: big trades are kept from a low floor, then the
    day's own 99.5th percentile is applied."""
    agg = ofcodec.Aggregator(tick, thr=5)
    n = 0
    for t, c, v, ty in trades:
        agg.add(t, c, v, ty)
        n += 1
    agg.finish()
    thr = ofcodec.big_threshold(agg.sizes)
    for b in agg.bars.values():
        b.bigs = [x for x in b.bigs if x[2] >= thr]
    return agg, thr, n


def post(url, key, sym, header, records):
    body = gzip.compress(ofcodec.payload(header, records), 6)
    req = urllib.request.Request('%s/of-ingest?sym=%s' % (url, sym), data=body, method='POST',
                                 headers={'content-type': 'application/octet-stream', 'x-ingest-key': key, 'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return '%s %s (%d B)' % (r.status, r.read(160).decode('utf-8', 'replace'), len(body))
    except urllib.error.HTTPError as e:
        return '%s %s' % (e.code, e.read(160).decode('utf-8', 'replace'))
    except Exception as e:
        return 'failed ' + type(e).__name__


def post_bars(url, key, sym, bars, header):
    return post_recs(url, key, sym, [b.encode() for b in sorted(bars, key=lambda b: b.t) if b.lv], header)


def post_recs(url, key, sym, recs, header):
    """POST in pieces under MAX_POST / POST_BARS (a full backfilled day is ~1,400 bars)."""
    out = []
    i = 0
    while i < len(recs):
        j, size = i, 0
        while j < len(recs) and size + len(recs[j]) < MAX_POST and j - i < POST_BARS:
            size += len(recs[j])
            j += 1
        out.append(post(url, key, sym, header, recs[i:j]))
        i = j
    return out


def config():
    url = os.environ.get('BOOK_RECORDER_URL', '').rstrip('/')
    key = os.environ.get('BOOK_INGEST_SECRET', '')
    is_key = os.environ.get('INSIGHTSENTRY_WEBSOCKET_API_KEY', '')
    if not url or len(key) < 32 or not is_key:
        log('config missing: BOOK_RECORDER_URL / BOOK_INGEST_SECRET / INSIGHTSENTRY_WEBSOCKET_API_KEY')
        sys.exit(2)
    return url, key, is_key


def count_prints(code, key):
    meta = {}
    n = sum(1 for _ in iter_trades(http_chunks(code, datetime.now(timezone.utc).date().isoformat(), key, meta, window='3h')))
    return n


def pick_contracts(is_key, st):
    """Once a day: the more active of the two nearest listed contracts (prints in the last 3 h)."""
    today = datetime.now(timezone.utc).date()
    if st.get('picked') == today.isoformat() and st.get('codes'):
        codes = st['codes']
    else:
        codes = dict(st.get('codes') or {})
        for r in ROOTS:
            best, bn = codes.get(r), -1
            for c in candidates(r, today):
                try:
                    n = count_prints(c, is_key)
                except Exception as e:
                    log('%s count failed: %s' % (c, type(e).__name__))
                    continue
                if n > bn:
                    best, bn = c, n
            if bn > 0 or not codes.get(r):
                codes[r] = best
        st['codes'] = codes
        st['picked'] = today.isoformat()
        log('contracts: ' + ', '.join('%s=%s' % kv for kv in sorted(codes.items())))
    for r, c in codes.items():
        SYMS[r] = (c, ROOTS[r][1])


def rebuild_day(day, url, key, is_key, st):
    """Pull one full UTC day per symbol from REST, aggregate, POST; record the big-trade threshold."""
    for sym, (code, tick) in SYMS.items():
        t0 = time.monotonic()
        meta = {}
        try:
            agg, thr, n = aggregate_day(iter_trades(http_chunks(code, day, is_key, meta)), tick)
        except Exception as e:
            log('%s %s rebuild failed: %s %s' % (sym, day, type(e).__name__, str(e)[:100]))
            continue
        if not agg.bars:
            log('%s %s: no prints' % (sym, day))
            continue
        st.setdefault('thr', {})[sym] = thr
        res = post_bars(url, key, sym, agg.bars.values(), {'v': 1, 'sym': sym, 'tick': tick, 'thr': thr, 'final': 1, 'src': meta.get('contract', '')})
        log('%s %s %s: %d prints, %d bars, big >= %d, %.1fs -> %s' % (sym, day, meta.get('contract'), n, len(agg.bars), thr, time.monotonic() - t0, ' | '.join(res)))
        del agg


def backfill(days):
    url, key, is_key = config()
    st = load_state()
    pick_contracts(is_key, st)
    save_state(st)
    today = datetime.now(timezone.utc).date()
    for k in range(days, 0, -1):
        rebuild_day((today - timedelta(days=k)).isoformat(), url, key, is_key, st)
    st['settled'] = (today - timedelta(days=1)).isoformat()
    save_state(st)


def live():
    url, key, is_key = config()
    st = load_state()
    pick_contracts(is_key, st)
    save_state(st)
    code2sym = {c: s for s, (c, _) in SYMS.items()}
    aggs = {s: ofcodec.Aggregator(tick, st.get('thr', {}).get(s, 20)) for s, (_, tick) in SYMS.items()}
    last_t = {s: 0.0 for s in SYMS}
    skip_min = {s: -1 for s in SYMS}     # a minute only partly covered by the socket: never posted
    ws_from = {}                        # symbol -> first minute fully covered by the first socket
    dirty = {s: set() for s in SYMS}
    lock = threading.Lock()
    started = time.time()

    def reader(group):
        backoff = 2
        while True:
            fresh = set(group)
            ws = None
            try:
                ws = wsmini.WS(WS, timeout=30)
                ws.send(json.dumps({'api_key': is_key, 'subscriptions': [
                    {'code': SYMS[s][0], 'type': 'series', 'bar_type': 'tick', 'bar_interval': 1, 'dp': 30000} for s in group]}))
                opened = time.time()
                ws.s.settimeout(25)
                while True:
                    try:
                        m = ws.recv()
                    except socket.timeout:
                        ws.ping()
                        continue
                    d = json.loads(m)
                    if 'error' in d:
                        log('IS: %s %s' % (d.get('error'), str(d.get('message', ''))[:160]))
                        if d.get('retryable') is False or 'limit' in str(d.get('error')):
                            break
                        continue
                    s = code2sym.get(d.get('code'))
                    ser = d.get('series')
                    if not s or not ser:
                        continue
                    with lock:
                        agg, lt = aggs[s], last_t[s]
                        if s in fresh:
                            # first message of this socket: the replay (dp) starts mid-minute. When it
                            # does not reach back to the last print we hold, that first minute is partial.
                            fresh.discard(s)
                            t0 = float(ser[0].get('time') or 0)
                            if t0 > lt:
                                skip_min[s] = int(t0 // 60)
                                agg.bars.pop(skip_min[s], None)
                                ws_from.setdefault(s, skip_min[s] + 1)
                        for x in ser:
                            t = float(x.get('time') or 0)
                            if t <= lt:
                                continue
                            lt = t
                            mm = int(t // 60)
                            agg.add(t, float(x['close']), float(x.get('volume') or 0), x.get('type'))
                            if mm != skip_min[s]:
                                dirty[s].add(mm)
                        last_t[s] = lt
                    if time.time() - opened > 60:
                        backoff = 2
            except Exception as e:
                log('socket closed: %s %s; retry in %ds' % (type(e).__name__, str(e)[:120], backoff))
            finally:
                if ws:
                    ws.close()
            time.sleep(backoff)
            backoff = min(backoff * 2, 120)

    def closed(m, now):
        return now >= (m + 1) * 60 + CLOSE_GRACE

    # InsightSentry allows 5 subscriptions per socket (subscription_limit_exceeded at 6, measured
    # 2026-10-14; 12 sockets at once were accepted), so the six symbols ride two sockets of three
    names = list(SYMS)
    for k in range(0, len(names), SUBS_PER_SOCKET):
        threading.Thread(target=reader, args=(names[k:k + SUBS_PER_SOCKET],), daemon=True).start()
    log('of-feeder live: %s, post every %ds' % (', '.join('%s=%s' % (s, c) for s, (c, _) in SYMS.items()), POST_EVERY))
    sent_closed = {s: set() for s in SYMS}
    while True:
        time.sleep(POST_EVERY)
        now = time.time()
        for s, agg in aggs.items():
            if s not in FAST_SYMS and now - last_post.get(s, 0) < SLOW_EVERY - 1:
                continue
            last_post[s] = now
            with lock:
                # the bars that changed, plus every bar that has closed since it was last sent (its
                # final state), minus a partly covered minute. Encoded under the lock.
                ms = set(dirty[s])
                ms |= {m for m in agg.bars if closed(m, now) and m not in sent_closed[s]}
                ms.discard(skip_min[s])
                dirty[s].clear()
                bars = [agg.bars[m] for m in sorted(ms) if m in agg.bars and agg.bars[m].lv]
                recs = [b.encode() for b in bars]
                tms = [b.t for b in bars]
                thr = agg.thr
            if recs:
                res = post_recs(url, key, s, recs, {'v': 1, 'sym': s, 'tick': SYMS[s][1], 'thr': thr, 'final': 0})
                bad_res = [r for r in res if not r.startswith('200')]
                note_post(not bad_res, bad_res[0] if bad_res else '')
                if bad_res:
                    log('%s post: %s' % (s, ' | '.join(res)))
                    with lock:
                        dirty[s] |= set(tms)       # try again next round
                else:
                    sent_closed[s] |= {t for t in tms if closed(t, now)}
            with lock:
                for b in agg.pop_before(int(now // 60) - KEEP_LIVE_MIN):
                    sent_closed[s].discard(b.t)
        # once: fill today before the socket's first full minute from the REST record (symbols with
        # no print on the socket yet: REST up to the current minute)
        if not st.get('_filled') and now - started > 60:
            st['_filled'] = 1
            with lock:
                upto = {s: ws_from.get(s, int(now // 60)) for s in SYMS}
            fill_today(upto, url, key, is_key, st)
        # after 00:20 UTC rebuild the UTC day that just ended from the full REST record
        utc = datetime.now(timezone.utc)
        y = (utc.date() - timedelta(days=1)).isoformat()
        if utc.hour * 60 + utc.minute >= 20 and st.get('settled') != y:
            st['settled'] = y
            rebuild_day(y, url, key, is_key, st)
            with lock:
                for s in aggs:
                    aggs[s].thr = st.get('thr', {}).get(s, aggs[s].thr)
            before = dict(st.get('codes') or {})
            pick_contracts(is_key, st)
            save_state({k: v for k, v in st.items() if not k.startswith('_')})
            if st.get('codes') != before:
                # contract roll: exit; systemd (Restart=always) restarts us on the new contract
                log('contract roll %s -> %s: restarting' % (before, st.get('codes')))
                os._exit(0)


def fill_today(ws_from, url, key, is_key, st):
    """Today's bars from 00:00 UTC up to the socket's first full minute, from the REST rolling window."""
    now = datetime.now(timezone.utc)
    day0 = int(datetime(now.year, now.month, now.day, tzinfo=timezone.utc).timestamp() // 60)
    for sym, (code, tick) in SYMS.items():
        upto = ws_from.get(sym, 0)
        if upto <= day0:
            continue
        meta = {}
        try:
            agg = ofcodec.Aggregator(tick, st.get('thr', {}).get(sym, 20))
            for t, c, v, ty in iter_trades(http_chunks(code, now.date().isoformat(), is_key, meta)):
                if day0 * 60 <= t < upto * 60:
                    agg.add(t, c, v, ty)
            agg.finish()
        except Exception as e:
            log('%s today fill failed: %s %s' % (sym, type(e).__name__, str(e)[:100]))
            continue
        if agg.bars:
            res = post_bars(url, key, sym, agg.bars.values(), {'v': 1, 'sym': sym, 'tick': tick, 'thr': agg.thr, 'final': 0})
            log('%s today fill: %d bars before minute %d -> %s' % (sym, len(agg.bars), upto, ' | '.join(res)))


def dry_run(path, sym, out=None):
    tick = SYMS[sym][1]
    t0 = time.monotonic()
    agg, thr, n = aggregate_day(iter_trades(file_chunks(path)), tick)
    recs = [b.encode() for b in sorted(agg.bars.values(), key=lambda b: b.t)]
    pl = ofcodec.payload({'v': 1, 'sym': sym, 'tick': tick, 'thr': thr, 'final': 1}, recs)
    gz = gzip.compress(pl, 6)
    if out:
        with open(out, 'wb') as f:
            f.write(pl)
    bigs = sum(len(b.bigs) for b in agg.bars.values())
    vol = sum(r[0] + r[1] for b in agg.bars.values() for r in b.lv.values())
    print(json.dumps({'prints': n, 'bars': len(recs), 'volume': vol, 'big_thr': thr, 'bigs': bigs, 'bytes': len(pl), 'gzip': len(gz),
                      'sec': round(time.monotonic() - t0, 2)}))


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['--dry-run'] and len(a) >= 3:
        dry_run(a[1], a[2].upper(), a[3] if len(a) > 3 else None)
    elif a[:1] == ['--backfill']:
        backfill(int(a[1]) if len(a) > 1 else 6)
    else:
        live()
