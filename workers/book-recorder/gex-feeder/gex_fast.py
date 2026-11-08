#!/usr/bin/env python3
"""TradeZoro fast GEX feeder: InsightSentry chain (gamma inputs) + Cboe open interest -> per-strike gamma x OI -> Worker.

Owner/CoS order 2026-10-16 ("use InsightSentry for ~15 s GEX rebuilds"). Long-running, stdlib only.
  - SPOT: one WebSocket (wss://realtime.insightsentry.com/live, 3 quote subscriptions SPX/QQQ/SPY, no REST cost) keeps
    the latest price of each underlying (about one update per second).
  - CHAIN: REST GET /v3/options/quotes?code=<CODE>&expiration=<0DTE|1DTE>&range=12 (~0.2-0.5 MB each), rotating
    SPX -> QQQ -> SPY. MONTHLY QUOTA (2026-10-25, CoS "is monthly quota 1026"): the Growth plan allows 120,000 REST
    calls a month and this feeder alone spent ~9,700 a weekday (0DTE + 1DTE every 15 s per underlying). Now each
    underlying's 0DTE chain is pulled every STEP_0 s (120) and its 1DTE chain every STEP_1 s (300 since GEX-FAST2, was 600),
    09:28-16:02 ET (0DTE expires 16:00): ~830 calls a weekday. Only the per-strike IV comes from this pull; the ladder still
    recomputes gamma at the live WebSocket spot every second (assets/gex-fast-core.js), so the walls keep moving with
    price. Each block carries its own build time 'b' so the site labels its real age. Calls are counted to the
    recorder's /is-note (monthly counter shown in /is-health). Backs off on HTTP 429 or errors.
  - OPEN INTEREST + Cboe IV: from the compact Cboe chain the gex-feeder already posts
    (<Worker>/gex-chain?sym=X&part=near, re-read every 60 s). IS has no OI for most strikes; OI changes once a day.
  - MATH = functions/api/gex/_engine.js hybrid exactly: contracts are Cboe's rows for the first two expiries on/after
    today (0DTE, 1DTE); IV is IS's when sane (0 < iv < 1.5, two-sided quote) else Cboe's; gamma is our Black-Scholes
    gamma at the IS spot and the real time to 16:00 ET; goi = gamma x OI x 100 x 0.01 (so GEX = (call goi - put goi) x S^2).
  - NEAR-MONEY IV OVER THE SOCKET (2026-11-08, Owner "we get real time option data, so why don't we update fast", GEX-FAST2):
    the same socket also streams quotes for up to WS_OPT_MAX individual 0DTE option contracts (OPRA codes taken from the
    last REST reply). Measured 2026-11-08: OPRA option quotes stream on our plan; ONE socket takes 50 quote symbols (5 units
    x 10; the 51st -> subscription_limit_exceeded), so 3 spots + 47 contracts, no new connection, no REST cost. Quotes carry
    bid/ask only (no IV), so per strike we stream the OUT-of-the-money side (call above spot, put below: the liquid one) and
    move that strike's REST IV by the change in the Black-Scholes IV of its mid price since the REST pull
    (iv_now = iv_rest + iv_mid(now) - iv_mid(at the pull)). That keeps the engine's IV source and only adds the move.
    The 0DTE block is rebuilt every REBUILD_EVERY s when a streamed quote changed; its 'b' is the newest quote used.
    Resubscribing is rare (<= 1 per RESUB_GAP s, only when spot leaves the middle half of the streamed strikes): the
    account allows 120 subscription messages per 3 h across all our sockets.
  - POST: every 2 s (or 10 s heartbeat) one gzip JSON with the latest build of every underlying + the latest spots to
    <Worker>/gex-fast-ingest. If anything fails the Worker data just ages and the site falls back to the 2-min Cboe path.
Config (env): BOOK_RECORDER_URL, BOOK_INGEST_SECRET (feeder.env), INSIGHTSENTRY_WEBSOCKET_API_KEY (insightsentry.env).
Nothing secret is ever logged. Test mode: gex_fast.py --reduce <is_chain.json> <cboe_near.json> <U> <dte> <now_epoch>
"""
import gzip
import json
import math
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'of-feeder'))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'of-feeder'))
from gex_feeder import bs_gamma, years_to_close  # noqa: E402  (same formulas as the Worker engine)

IS = 'https://api.insightsentry.com/v3'
WS_URL = 'wss://realtime.insightsentry.com/live'
UA = 'tradezoro-gex-fast/1'
ET = ZoneInfo('America/New_York')
CODES = {'SPX': 'CBOE:SPX', 'QQQ': 'NASDAQ:QQQ', 'SPY': 'AMEX:SPY'}
CBOE_SYM = {'SPX': 'SPX', 'QQQ': 'QQQ', 'SPY': 'SPY'}
STEP_0 = float(os.environ.get('FAST_STEP_0', '120'))   # seconds between 0DTE pulls of ONE underlying
STEP_1 = float(os.environ.get('FAST_STEP_1', '300'))   # seconds between 1DTE pulls of ONE underlying
NOTE_EVERY = 300                                       # post the call count to /is-note every 5 min
BAND = 0.07                                         # keep strikes within 7 % of spot (the ladder shows 4 %, net uses 6 %)
OI_REFRESH = 60
POST_EVERY = 2
HEARTBEAT = 10
WS_OPT_MAX = int(os.environ.get('FAST_WS_OPTS', '47'))   # 50 quote symbols per socket (measured) - 3 spots
WS_SHARE = {'SPX': 23, 'QQQ': 12, 'SPY': 12}             # contracts streamed per underlying (sum <= WS_OPT_MAX)
RESUB_GAP = 600                                       # >= 10 min between option-set changes (120 msgs / 3 h account cap)
REBUILD_EVERY = 2
QUOTE_MAX_AGE = 90                                    # a streamed quote older than this is not used
IV_MOVE_MAX = 0.5                                     # ignore an IV move larger than 50 % of the REST IV (bad print)


def log(m):
    print(m, flush=True)


def in_window(now):
    t = now.astimezone(ET)
    if t.weekday() >= 5:
        return False
    m = t.hour * 60 + t.minute
    return 9 * 60 + 28 <= m <= 16 * 60 + 2


def sig(x, n=6):
    return float('%.*g' % (n, x))


def max_pain_rows(rows, spot):
    """Strike with the smallest total option-holder payout (calls + puts, OI); ties -> nearest spot. Same rule as maxPain() in
    assets/chart-gex-ladder-core.js."""
    rs = [(r[0], r[1], r[2]) for r in rows if r[2] > 0]
    if not rs:
        return None
    best, bv = None, None
    for s in sorted({r[0] for r in rs}):
        pay = sum(oi * (max(s - k, 0) if cp == 'C' else max(k - s, 0)) for k, cp, oi in rs)
        if bv is None or pay < bv or (pay == bv and abs(s - spot) < abs(best - spot)):
            best, bv = s, pay
    return best


def reduce_chain(is_data, cboe_near, dte, now_epoch, mp=False):
    """-> block for one underlying/expiry-mode, or None. Pure (unit-tested)."""
    spot = float(is_data.get('last_price') or 0)
    if not spot > 0 or not cboe_near:
        return None
    today = datetime.fromtimestamp(now_epoch, timezone.utc).date()
    exps = [e for e in sorted(cboe_near.get('expiries') or {}) if (datetime.strptime(e, '%Y-%m-%d').date() - today).days >= 0]
    if not exps:
        return None
    exp = exps[min(dte, len(exps) - 1)]
    ymd = int(exp.replace('-', ''))
    live = {}
    for o in is_data.get('data') or []:
        try:
            if int(str(o.get('expiration')).replace('-', '')) != ymd:
                continue
            t = str(o.get('type') or '').upper()
            cp = 'C' if t.startswith('C') else 'P' if t.startswith('P') else None
            if not cp:
                continue
            key = (cp, float(o.get('strike_price') if o.get('strike_price') is not None else o.get('strike')))
            # SPX monthly days list the same strike under two roots (SPX and SPXW) and the reply order changes call to call:
            # take the weekly SPXW (PM-settled, the 0DTE everyone trades) every time, so the result is deterministic.
            w = '/SPXW' in str(o.get('code', '')).replace(':', '/') or 'SPXW' in str(o.get('code', ''))
            if key in live and live[key][3] and not w:
                continue
            live[key] = (float(o.get('implied_volatility') or 0), float(o.get('bid_price') or 0), float(o.get('ask_price') or 0), w)
        except (TypeError, ValueError):
            continue
    T = years_to_close(exp, now_epoch)
    hybrid_ok = abs(spot / float(cboe_near['spot']) - 1) <= 0.05 and len(live) > 0
    by = {}
    for r in cboe_near['expiries'][exp]:
        K, cp, oi, civ = r[0], r[1], r[2], r[3]
        if abs(K - spot) / spot > BAND or oi <= 0:
            continue
        iv = civ
        x = live.get((cp, K)) if hybrid_ok else None
        if x and 0 < x[0] < 1.5 and x[1] > 0 and x[2] >= x[1]:
            iv = x[0]
        if iv > 3:
            iv /= 100
        # v2 block: store the OI weight (OI x 100 x 0.01) and the IV; the reader recomputes gamma at any spot with the engine's formula
        e = by.setdefault(K, [0.0, 0.0, 0.0, 0.0])
        if cp == 'C':
            e[0] += oi * 100 * 0.01; e[2] = iv
        else:
            e[1] += oi * 100 * 0.01; e[3] = iv
    if mp is False:      # max pain needs OI only (not IV): the socket rebuilds pass the REST build's value in
        mp = max_pain_rows(cboe_near['expiries'][exp], spot)
    ks = sorted(by)
    if len(ks) < 20:
        return None
    return {'v': 2, 'x': exp, 's0': sig(spot, 8), 'T': sig(T, 8), 'k': ks, 'c': [sig(by[k][0]) for k in ks], 'p': [sig(by[k][1]) for k in ks],
            'ci': [sig(by[k][2], 4) for k in ks], 'pi': [sig(by[k][3], 4) for k in ks], 'hy': hybrid_ok, 'mp': mp}


def _ncdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs_price(cp, S, K, T, sigma, r=0.045):
    v = sigma * math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / v
    d2 = d1 - v
    if cp == 'C':
        return S * _ncdf(d1) - K * math.exp(-r * T) * _ncdf(d2)
    return K * math.exp(-r * T) * _ncdf(-d2) - S * _ncdf(-d1)


def bs_iv(cp, S, K, T, price, r=0.045):
    """Black-Scholes implied vol of an option price (bisection, 0.1 %-500 %), None when the price is outside the no-arbitrage
    range. Same r and q as the engine. Checked 2026-11-08 against InsightSentry's own bid_iv/ask_iv: within 0.003."""
    if not (S > 0 and K > 0 and T > 0 and price > 0):
        return None
    lo, hi = 0.001, 5.0
    if not bs_price(cp, S, K, T, lo, r) < price < bs_price(cp, S, K, T, hi, r):
        return None
    for _ in range(50):
        m = (lo + hi) / 2
        if bs_price(cp, S, K, T, m, r) > price:
            hi = m
        else:
            lo = m
    return (lo + hi) / 2


def _row_key(o):
    """REST row -> (cp, K, weekly) or None."""
    t = str(o.get('type') or '').upper()
    cp = 'C' if t.startswith('C') else 'P' if t.startswith('P') else None
    try:
        K = float(o.get('strike_price') if o.get('strike_price') is not None else o.get('strike'))
    except (TypeError, ValueError):
        return None
    return (cp, K, 'SPXW' in str(o.get('code', ''))) if cp else None


def pick_codes(is_data, exp, spot, n):
    """The n OTM contracts nearest spot in one REST reply for expiry exp (YYYY-MM-DD): call at/above spot, put below; for a
    strike listed under two SPX roots the weekly SPXW one. -> {code: (cp, K)}. Pure."""
    ymd = exp.replace('-', '')
    best = {}
    for o in is_data.get('data') or []:
        rk = _row_key(o)
        if not rk or str(o.get('expiration')).replace('-', '') != ymd or not o.get('code'):
            continue
        cp, K, w = rk
        if cp != ('C' if K >= spot else 'P'):
            continue
        if K in best and best[K][2] and not w:
            continue
        best[K] = (o['code'], cp, w)
    ks = sorted(best, key=lambda k: (abs(k - spot), k))[:max(0, n)]
    return {best[k][0]: (best[k][1], k) for k in ks}


def need_repick(picks, spot):
    """True when spot has left the middle half of the streamed strikes (or nothing is streamed). Pure."""
    ks = [k for _, k in picks.values()]
    if not ks:
        return True
    lo, hi = min(ks), max(ks)
    q = (hi - lo) / 4
    return not (lo + q <= spot <= hi - q)


def mid_of(bid, ask):
    return (bid + ask) / 2 if bid and ask and bid > 0 and ask >= bid else None


def ws_base(is_data, picks, spot, T):
    """IV of each streamed contract's REST mid at the REST spot: the zero point of the socket moves. {code: iv}. Pure."""
    out = {}
    for o in is_data.get('data') or []:
        c = o.get('code')
        if c in picks:
            m = mid_of(float(o.get('bid_price') or 0), float(o.get('ask_price') or 0))
            iv = bs_iv(picks[c][0], spot, picks[c][1], T, m) if m else None
            if iv:
                out[c] = iv
    return out


def overlay(is_data, picks, base, quotes, spot, T, now):
    """REST reply with the streamed IV moves applied: per streamed strike K, every row at K (calls and puts, both roots) gets
    implied_volatility += iv_mid(live quote at spot) - base. -> (new reply, strikes moved, newest quote time used). Pure."""
    move, newest = {}, 0
    for c, (cp, K) in picks.items():
        q, b = quotes.get(c), base.get(c)
        if not q or not b or now - q.get('t', 0) > QUOTE_MAX_AGE:
            continue
        m = mid_of(q.get('bid'), q.get('ask'))
        iv = bs_iv(cp, spot, K, T, m) if m else None
        if iv is None or abs(iv - b) > IV_MOVE_MAX * b:
            continue
        move[K] = iv - b
        newest = max(newest, q['t'])
    if not move:
        return is_data, 0, 0
    rows = []
    for o in is_data.get('data') or []:
        rk = _row_key(o)
        if rk and rk[1] in move and float(o.get('implied_volatility') or 0) > 0:
            o = dict(o)
            o['implied_volatility'] = float(o['implied_volatility']) + move[rk[1]]
        rows.append(o)
    out = dict(is_data)
    out['data'] = rows
    out['last_price'] = spot
    return out, len(move), newest


def http_json(url, headers, timeout, gz=True):
    h = dict(headers); h['User-Agent'] = UA
    if gz:
        h['Accept-Encoding'] = 'gzip'
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            raw = gzip.decompress(raw)
    return json.loads(raw)


class Spots:
    """One InsightSentry socket: the 3 underlyings' spots + the streamed 0DTE option quotes (see the module doc)."""
    def __init__(self, key, start=True):
        self.key, self.last, self.q, self.lock = key, {}, {}, threading.Lock()
        self.opts, self.sent, self.sent_at, self.opt_off, self.active = [], None, 0, False, False
        if start:
            threading.Thread(target=self.run, daemon=True).start()

    def get(self):
        with self.lock:
            return dict(self.last)

    def quotes(self):
        with self.lock:
            return dict(self.q)

    def want(self, codes, force=False):
        """Option codes to stream (list, <= WS_OPT_MAX). Sent by the socket thread when allowed; force (a first set or a new expiry) skips
        the RESUB_GAP wait."""
        with self.lock:
            self.opts = sorted(codes)[:WS_OPT_MAX]
            self.q = {c: v for c, v in self.q.items() if c in self.opts}
            if force:
                self.sent_at = 0

    def subs(self):
        opts = [] if self.opt_off else self.opts
        return list(CODES.values()) + opts

    def due_send(self, now):
        """The full subscription list to send now, or None. A first option set goes at once; a change waits RESUB_GAP."""
        with self.lock:
            s = self.subs()
            if s == self.sent:
                return None
            had_opts = self.sent and len(self.sent) > len(CODES)
            if had_opts and now - self.sent_at < RESUB_GAP and not self.opt_off:
                return None
            self.sent, self.sent_at = s, now
            return s

    def on_msg(self, d, now):
        inv = {v: k for k, v in CODES.items()}
        if d.get('error'):
            # over the plan's symbols (this socket or the account's sockets together): drop the options for good and keep the
            # 3 spots the ladder needs (the REST chain still drives the IV, as before GEX-FAST2)
            if d.get('error') in ('subscription_limit_exceeded', 'max_connection_reached') and not self.opt_off:
                self.opt_off = True        # plan cap: spots only from now on (the REST chain still drives the IV)
                log('IS ws: option quotes refused (%s); spots only' % str(d.get('details'))[:80])
            else:
                log('IS ws: %s' % str(d.get('error'))[:80])
            return d.get('retryable') is not False or d.get('error') == 'subscription_limit_exceeded'
        if d.get('event') == 'subscription_status':
            self.active = d.get('status') == 'active'
            return True
        c = d.get('code')
        u, p = inv.get(c), d.get('last_price')
        with self.lock:
            if u and p:
                self.last[u] = {'p': float(p), 't': now}
            elif c and c.startswith('OPRA:') and ('bid' in d or 'ask' in d):
                e = self.q.setdefault(c, {})
                for f in ('bid', 'ask'):
                    if d.get(f) is not None:
                        e[f] = float(d[f])
                e['t'] = now
        return True

    def run(self):
        import wsmini
        import random
        back = 5   # 5 s doubling to 2 min with jitter, reset after 60 s up (InsightSentry reconnect budget, 2026-10-22)
        while True:
            opened = time.time()
            ws = None
            try:
                ws = wsmini.WS(WS_URL, timeout=30)
                with self.lock:
                    self.sent = None           # a new socket needs the full set
                s = self.due_send(time.time()) or self.subs()
                ws.send(json.dumps({'api_key': self.key, 'subscriptions': [{'code': c, 'type': 'quote'} for c in s]}))
                ws.s.settimeout(20)            # server_time arrives every 15 s, so a resubscribe waits <= ~20 s
                while True:
                    try:
                        m = ws.recv()
                    except socket.timeout:
                        ws.ping(); m = None
                    if m:
                        if not self.on_msg(json.loads(m), time.time()):
                            break
                    s = self.due_send(time.time())
                    if s:
                        ws.send(json.dumps({'api_key': self.key, 'subscriptions': [{'code': c, 'type': 'quote'} for c in s]}))
                        log('IS ws: streaming %d option quotes' % (len(s) - len(CODES)))
            except Exception as e:
                log('IS ws down: %s %s' % (type(e).__name__, str(e)[:60]))
            finally:
                if ws:
                    ws.close()
            if time.time() - opened > 60:
                back = 5
            time.sleep(back * (0.75 + random.random() * 0.5)); back = min(120, back * 2)


def post(url, key, blob):
    body = gzip.compress(json.dumps(blob, separators=(',', ':')).encode(), 4)
    req = urllib.request.Request(url + '/gex-fast-ingest', data=body, method='POST',
                                 headers={'content-type': 'application/octet-stream', 'x-ingest-key': key, 'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, len(body)
    except urllib.error.HTTPError as e:
        return e.code, len(body)
    except Exception:
        return 0, len(body)


def note_is(url, key, n):
    """Add n InsightSentry REST calls to the recorder's monthly counter (src/is-usage.js). Best effort."""
    try:
        req = urllib.request.Request(url + '/is-note', data=json.dumps({'src': 'gexfast', 'n': n}).encode(), method='POST',
                                     headers={'content-type': 'application/json', 'x-ingest-key': key, 'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status == 200
    except Exception:
        return False


def due(last, u, dte, now):
    """Is underlying u's dte chain due for a pull? (pure)"""
    return now - last.get((u, dte), 0) >= (STEP_0 if dte == 0 else STEP_1) - 1


def ws_rebuild(builds, rest, oi, spots, now):
    """Rebuild each underlying's 0DTE block from its last REST reply + the streamed quotes (no REST call). Mutates builds."""
    sp, qs = spots.get(), spots.quotes()
    for u, r in rest.items():
        b = builds.get(u)
        cur = sp.get(u)
        if not b or '0' not in b or b['0'].get('x') != r['x'] or not cur or now - cur['t'] > 30 or u not in oi:
            continue
        T = years_to_close(r['x'], now)
        nd, n, newest = overlay(r['d'], r['picks'], r['base'], qs, cur['p'], T, now)
        if not n or newest <= b['0'].get('b', 0):
            continue
        try:
            blk = reduce_chain(nd, oi[u][1], 0, now, mp=r['mp'])
        except Exception as e:      # a bad quote must never stop the feeder
            log('%s socket rebuild failed: %s' % (u, type(e).__name__)); continue
        if blk:
            blk['b'] = int(newest)
            blk['ws'] = n              # strikes moved by streamed quotes (for /gex-fast debugging)
            b['0'] = blk
            b['built'] = max(b.get('built', 0), int(newest))


def main():
    url = os.environ.get('BOOK_RECORDER_URL', '').rstrip('/')
    key = os.environ.get('BOOK_INGEST_SECRET', '')
    iskey = os.environ.get('INSIGHTSENTRY_WEBSOCKET_API_KEY', '')
    if not url or len(key) < 32 or not iskey:
        log('config missing'); return 2
    spots = Spots(iskey)
    builds = {}          # U -> {'0': blk, '1': blk, 'built': epoch}
    oi = {}              # U -> (fetched_at_local, cboe near chain)
    stats = {'ok': 0, 'fail': 0, '429': 0, 'req': 0}
    nxt, i, last_post, last_sig, pause_until, t_stat = time.time(), 0, 0, None, 0, time.time()
    order = list(CODES)
    pulled = {}          # (U, dte) -> epoch of the last pull
    rest = {}            # U -> the last 0DTE REST pull: {'d', 'x', 'mp', 'picks', 'base'} (socket rebuilds start from it)
    picks = {}           # U -> {code: (cp, K)} streamed 0DTE contracts
    last_ws = 0
    unnoted, noted_at = 0, time.time()
    while True:
        now = time.time()
        if unnoted and (now - noted_at >= NOTE_EVERY or not in_window(datetime.now(timezone.utc))):
            if note_is(url, key, unnoted):
                unnoted = 0
            noted_at = now
        if not in_window(datetime.now(timezone.utc)):
            time.sleep(20); continue
        # one underlying per tick (every 2 s at most): the next one with a due 0DTE or 1DTE chain
        u = order[i % 3]
        want = [dte for dte in (0, 1) if due(pulled, u, dte, now)]
        if not want:
            i += 1
        if want and now >= nxt and now >= pause_until:
            i += 1; nxt = now + 2
            t0 = time.monotonic()
            try:
                if u not in oi or now - oi[u][0] > OI_REFRESH:
                    raw = urllib.request.urlopen(urllib.request.Request('%s/gex-chain?sym=%s&part=near' % (url, CBOE_SYM[u]), headers={'User-Agent': UA, 'x-ingest-key': key}), timeout=10).read()
                    oi[u] = (now, json.loads(gzip.decompress(raw)))
                sp = spots.get().get(u)
                en = None
                b = dict(builds.get(u) or {})
                b.pop('built', None)
                today = datetime.fromtimestamp(now, timezone.utc).date()
                exps = [e for e in sorted(oi[u][1].get('expiries') or {}) if (datetime.strptime(e, '%Y-%m-%d').date() - today).days >= 0]
                for dte in want:
                    if not exps:
                        break
                    ex = exps[min(dte, len(exps) - 1)]
                    # the SAME call the site's engine makes (fetchInsightQuotes: one expiry, range=12), so the SPX/SPXW duplicate
                    # contracts resolve exactly like a server rebuild does (the whole-chain reply orders them differently)
                    pulled[(u, dte)] = time.time()
                    unnoted += 1          # a sent request counts against the quota whatever the reply
                    d = http_json('%s/options/quotes?code=%s&expiration=%s&range=12' % (IS, CODES[u], ex), {'Authorization': 'Bearer ' + iskey, 'Accept': 'application/json'}, 25)
                    if sp and time.time() - sp['t'] < 30:
                        d['last_price'] = sp['p']
                    en = time.time()
                    blk = reduce_chain(d, oi[u][1], dte, en)
                    if blk:
                        blk['b'] = int(en)
                        b[str(dte)] = blk
                    if blk and dte == 0:
                        rest_spot = float(d.get('last_price') or 0)
                        # new expiry (a new day) -> new contracts at once; otherwise re-centre at most every RESUB_GAP s,
                        # so `picks` always equals what the socket streams (Spots.due_send holds a change that long too)
                        pk = picks.get(u)
                        last_pick = max([p['at'] for p in picks.values()] or [0])
                        if not pk or pk['x'] != ex or (now - last_pick >= RESUB_GAP and need_repick(pk['c'], rest_spot)):
                            for v in [v for v, p in picks.items() if p['x'] < ex]:
                                del picks[v]       # yesterday's contracts have expired: never resubscribe them
                                rest.pop(v, None)
                            picks[u] = {'x': ex, 'at': now, 'c': pick_codes(d, ex, rest_spot, WS_SHARE.get(u, 0))}
                            spots.want([c for p in picks.values() for c in p['c']], force=not pk or pk['x'] != ex)
                        rest[u] = {'d': d, 'x': ex, 'mp': blk.get('mp'), 'picks': picks[u]['c'],
                                   'base': ws_base(d, picks[u]['c'], rest_spot, years_to_close(ex, en))}
                    stats['req'] += 1
                # drop a block from an earlier day (yesterday's 1DTE is not today's 0DTE)
                for m in ('0', '1'):
                    if m in b and (not exps or b[m].get('x') != exps[min(int(m), len(exps) - 1)]):
                        del b[m]
                b['built'] = max([int(en or time.time())] + [b[m].get('b', 0) for m in ('0', '1') if m in b])
                d = None
                if '0' in b:
                    builds[u] = b; stats['ok'] += 1
                else:
                    stats['fail'] += 1; log('%s: no usable block' % u)
            except urllib.error.HTTPError as e:
                stats['429' if e.code == 429 else 'fail'] += 1
                if e.code == 429:
                    pause_until = now + 60; log('IS 429: pausing 60 s')
                else:
                    log('%s pull failed HTTP %s' % (u, e.code))
            except Exception as e:
                stats['fail'] += 1; log('%s pull failed: %s %s' % (u, type(e).__name__, str(e)[:80]))
            else:
                if stats['ok'] % 10 == 1:
                    log('%s built in %.1fs; ok=%d fail=%d 429=%d req=%d' % (u, time.monotonic() - t0, stats['ok'], stats['fail'], stats['429'], stats['req']))
        if rest and now - last_ws >= REBUILD_EVERY:
            last_ws = now
            ws_rebuild(builds, rest, oi, spots, now)
        if builds and now - last_post >= POST_EVERY:
            sp = spots.get()
            s = json.dumps([{u: b['built'] for u, b in builds.items()}, {u: round(v['p'], 3) for u, v in sp.items()}])
            if s != last_sig or now - last_post >= HEARTBEAT:
                st, n = post(url, key, {'v': 1, 'built': int(now), 'spots': {u: v for u, v in sp.items()}, 'u': builds})
                last_post, last_sig = now, s
                if st != 200:
                    log('post failed: %s' % st)
        time.sleep(0.25)


if __name__ == '__main__':
    if len(sys.argv) == 7 and sys.argv[1] == '--reduce':
        print(json.dumps(reduce_chain(json.load(open(sys.argv[2])), json.load(open(sys.argv[3])), int(sys.argv[5]), float(sys.argv[6])), separators=(',', ':')))
    else:
        sys.exit(main())
