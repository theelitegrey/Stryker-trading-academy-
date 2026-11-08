#!/usr/bin/env python3
"""TradeZoro Hyperliquid wallet-intel collector -> book recorder Worker (/hl-ingest).

Public Hyperliquid data only (no key). Measured 2026-11-07, see stryker-notes/reports/workers/hl-intel/DATA.md.
  1. One WebSocket to wss://api.hyperliquid.xyz/ws, `trades` for every live perp + the top spot pairs. Every fill
     carries users = [buyer, seller], so the per-minute per-wallet aggregates cover ALL wallets (not a sample).
     Each finished minute is POSTed (kind=min); the Durable Object rolls the minutes up into hour rows.
  2. Tracked wallets (leaderboard top by account value + top by 30-day volume + any wallet with a >= $250k order
     filled in the last 24 h, capped at TRACK_CAP): clearinghouseState (positions, liquidation price, leverage)
     and frontendOpenOrders (limits + triggers) on a rotating schedule inside a REST weight budget
     (HL allows 1200 weight / min per IP; we spend at most BUDGET_PER_MIN). Every STATE_EVERY s the per-coin
     liquidation / stop clusters, book-level wallets and wallet profiles are POSTed (kind=state).
  3. Labels: leaderboard display names + vault names, Whale (>= $1M account value), Top 100 by 30-day volume;
     POSTed hourly (kind=labels). Nothing is invented: an unnamed wallet shows as 0x12…ab.
  4. Backstop liquidations: the HLP liquidator vaults' fills (public) name the liquidated user.
Run modes:
  hl_feeder.py              live loop (systemd service hl-feeder.service)
  hl_feeder.py --dry-run N  run N seconds live, POST nothing, write the payloads to --out DIR (default ./hl-dry)
Config (env, /root/projects/book-feeder/feeder.env): BOOK_RECORDER_URL, BOOK_INGEST_SECRET (never logged).
Stdlib only; wsmini.py (the order-flow feeder's socket client) is installed next to this file.
"""
import gzip
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'of-feeder'))   # wsmini.py when run from the repo
import hlcore  # noqa: E402
import wsmini  # noqa: E402

INFO = 'https://api.hyperliquid.xyz/info'
WS_URL = 'wss://api.hyperliquid.xyz/ws'
LEADERBOARD = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard'
VAULTS = 'https://stats-data.hyperliquid.xyz/Mainnet/vaults'
UA = 'tradezoro-hl-feeder/1'
BUDGET_PER_MIN = 700          # of HL's 1200 weight/min per IP: leaves room for anything else on this server
TRACK_CAP = 400
STATE_EVERY = 300             # s between state posts
POS_EVERY = 180               # s: target age of a tracked wallet's positions
SPOT_TOP = 10
BOOK_COINS = 40               # l2Book read for the top coins by OI each state round (book coverage %)
LIQUIDATORS = ['0x2e3d94f0562703b25c83308a05046ddaf9a8dd14', '0xb0a55f13d22f66e6d495ac98113841b2326e9540',
               '0x5e177e5e39c0f4e421f5865a6d8beed8d921cb70', '0x2ed5c4484ea3ff8b57d5f2fb152a40d9f2b68308']   # HLP Liquidator 1-4 (vault list, child of HLP)
RETRY_KEEP = 30
STATE_FILE = os.environ.get('HL_STATE_FILE', '/root/projects/book-feeder/hl-state.json')


def log(msg):
    print(time.strftime('%H:%M:%S ') + msg, flush=True)


class Budget:
    """Token bucket over HL REST weight: take(w) blocks until w weight is free."""

    def __init__(self, per_min):
        self.rate, self.cap, self.tok, self.t = per_min / 60.0, per_min / 6.0, per_min / 6.0, time.time()
        self.lock = threading.Lock()
        self.used = 0

    def take(self, w):
        while True:
            with self.lock:
                now = time.time()
                self.tok = min(self.cap, self.tok + (now - self.t) * self.rate)
                self.t = now
                if self.tok >= w:
                    self.tok -= w
                    self.used += w
                    return
                wait = (w - self.tok) / self.rate
            time.sleep(min(wait, 5))


BUDGET = Budget(BUDGET_PER_MIN)


def info(body, weight):
    BUDGET.take(weight)
    req = urllib.request.Request(INFO, data=json.dumps(body).encode(), headers={'content-type': 'application/json', 'User-Agent': UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                log('HL 429, backing off')
                time.sleep(30)
                continue
            raise
        except (urllib.error.URLError, socket.timeout):
            time.sleep(3)
    return None


def get_text(url, timeout=90):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'accept-encoding': 'gzip'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        b = r.read()
    return (gzip.decompress(b) if b[:2] == b'\x1f\x8b' else b).decode()


def iter_array(text, key=None, keep=None):
    """Yield keep(item) for each item of the JSON array at the top level (or under "key"), decoding one item
    at a time: the 39 MB leaderboard as one tree is ~300 MB of Python objects, one row at a time ~80 MB peak."""
    dec = json.JSONDecoder()
    i = text.index('"%s"' % key) if key else 0
    i = text.index('[', i) + 1
    n = len(text)
    while i < n:
        while text[i] in ' \r\n\t,':
            i += 1
        if text[i] == ']':
            return
        obj, i = dec.raw_decode(text, i)
        k = keep(obj) if keep else obj
        if k is not None:
            yield k


def post(url, secret, kind, obj):
    body = gzip.compress(json.dumps(obj, separators=(',', ':')).encode(), 6)
    req = urllib.request.Request(url + '/hl-ingest?kind=' + kind, data=body, method='POST',
                                 headers={'content-type': 'application/octet-stream', 'x-ingest-key': secret, 'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, '%s (%d B)' % (r.read(120).decode('utf-8', 'replace'), len(body))
    except urllib.error.HTTPError as e:
        return e.code, e.read(160).decode('utf-8', 'replace')
    except Exception as e:
        return 0, 'failed ' + type(e).__name__


class Feeder:
    def __init__(self, url, secret, dry_dir=None):
        self.url, self.secret, self.dry = url, secret, dry_dir
        self.agg = hlcore.MinuteAgg()
        self.big = hlcore.BigFills()
        self.lock = threading.Lock()
        self.coins, self.spot = [], {}        # perp names; spot '@N' -> 'HYPE/USDC'
        self.ctx = {}                         # coin -> {'mid', 'oi'} (oi in USD, one side)
        self.labels, self.lb = {}, []
        self.wallets = {}                     # addr -> {'pos', 'trig', 'lim', 'av', 't', 'tOrd'}
        self.tracked = []
        self.liq = []
        self.liq_t = int(time.time() * 1000) - 6 * 3600000
        self.stop = False
        self.n_trades = 0
        self.retry = []
        self.seen = {}                        # tid -> time ms, last ~3 minutes
        self.ws_ok = 0
        self.load_state()

    # ---- persistence of the small state (big fills, liquidation events) across restarts
    def load_state(self):
        try:
            with open(STATE_FILE) as f:
                d = json.load(f)
            self.big.by_wallet = {a: rows for a, rows in d.get('big', {}).items()}
            self.liq = d.get('liq', [])
            self.liq_t = max(self.liq_t, d.get('liq_t', 0))
        except (OSError, ValueError):
            pass

    def save_state(self):
        if self.dry:
            return
        try:
            tmp = STATE_FILE + '.tmp'
            with open(tmp, 'w') as f:
                json.dump({'big': self.big.by_wallet, 'liq': self.liq[-500:], 'liq_t': self.liq_t}, f)
            os.replace(tmp, STATE_FILE)
        except OSError as e:
            log('state save failed ' + type(e).__name__)

    def send(self, kind, obj, tag=''):
        if self.dry:
            os.makedirs(self.dry, exist_ok=True)
            with open(os.path.join(self.dry, '%s-%s.json' % (kind, tag or obj.get('t'))), 'w') as f:
                json.dump(obj, f, separators=(',', ':'))
            return 200, 'dry'
        return post(self.url, self.secret, kind, obj)

    # ---- universe
    def refresh_meta(self):
        m = info({'type': 'metaAndAssetCtxs'}, 20)
        s = info({'type': 'spotMetaAndAssetCtxs'}, 20)
        if not m:
            return
        coins, ctx = [], {}
        for u, c in zip(m[0]['universe'], m[1]):
            if u.get('isDelisted'):
                continue
            coins.append(u['name'])
            mid = hlcore.fnum(c.get('midPx')) or hlcore.fnum(c.get('markPx')) or 0.0
            ctx[u['name']] = {'mid': mid, 'oi': (hlcore.fnum(c.get('openInterest')) or 0) * (hlcore.fnum(c.get('markPx')) or 0)}
        spot = {}
        if s:
            toks = {t['index']: t['name'] for t in s[0]['tokens']}
            uni = {u['name']: u for u in s[0]['universe']}
            for c in sorted(s[1], key=lambda c: -(hlcore.fnum(c.get('dayNtlVlm')) or 0))[:SPOT_TOP]:
                u = uni.get(c['coin'])
                if u:
                    spot[c['coin']] = '/'.join(toks.get(i, '?') for i in u['tokens'])
        self.coins, self.ctx, self.spot = coins, ctx, spot

    def refresh_labels(self):
        try:
            # keep only the fields labels and the tracked set use
            slim = lambda r: {'ethAddress': r.get('ethAddress'), 'accountValue': r.get('accountValue'), 'displayName': r.get('displayName'),
                              'windowPerformances': [w for w in (r.get('windowPerformances') or []) if w and w[0] == 'month']}
            self.lb = list(iter_array(get_text(LEADERBOARD), 'leaderboardRows', slim))
            vaults = list(iter_array(get_text(VAULTS), None, lambda v: v if float((v.get('summary') or {}).get('tvl') or 0) >= 100000 else None))
        except Exception as e:
            log('labels fetch failed ' + type(e).__name__)
            return
        self.labels = hlcore.build_labels(self.lb, vaults)
        # keep only the rows pick_tracked can use (48k rows -> ~300; ~50 MB less resident)
        keep = set(hlcore.pick_tracked(self.lb, [], TRACK_CAP))
        self.lb = [r for r in self.lb if str(r.get('ethAddress')).lower() in keep]
        del vaults
        st, txt = self.send('labels', {'v': 1, 't': int(time.time() * 1000), 'labels': self.labels})
        log('labels %d -> %s %s' % (len(self.labels), st, txt))

    # ---- WebSocket trades
    def ws_loop(self):
        backoff = 1
        while not self.stop:
            ws = None
            try:
                ws = wsmini.WS(WS_URL, timeout=30)
                subs = list(self.coins) + list(self.spot)
                for c in subs:
                    ws.send(json.dumps({'method': 'subscribe', 'subscription': {'type': 'trades', 'coin': c}}))
                log('ws subscribed %d coins' % len(subs))
                backoff, last_ping, n_subs = 1, time.time(), len(subs)
                floor_ms = int(time.time() * 1000) // hlcore.MIN_MS * hlcore.MIN_MS
                while not self.stop:
                    if time.time() - last_ping > 30:
                        ws.send('{"method":"ping"}')
                        last_ping = time.time()
                    if len(self.coins) + len(self.spot) != n_subs:
                        raise wsmini.WSClosed('universe changed')
                    try:
                        m = ws.recv()
                    except socket.timeout:
                        continue
                    if '"trades"' not in m[:40]:
                        continue
                    d = json.loads(m)
                    if d.get('channel') != 'trades':
                        continue
                    with self.lock:
                        for tr in d['data']:
                            # the subscribe ack replays recent trades (hours back on thin coins): keep only the
                            # current minute's, and never count a tid twice (reconnect inside a minute)
                            tid = tr.get('tid')
                            if tid in self.seen or int(tr.get('time') or 0) < floor_ms:
                                continue
                            self.seen[tid] = int(tr.get('time') or 0)
                            if self.agg.add(tr):
                                self.big.add(tr)
                                self.n_trades += 1
                    self.ws_ok = time.time()
            except Exception as e:
                log('ws %s %s; reconnect in %ds' % (type(e).__name__, str(e)[:80], backoff))
            finally:
                if ws:
                    ws.close()
            time.sleep(backoff)
            backoff = min(backoff * 2, 30)

    # ---- minute posts: a minute is final 3 s after it ends (HL stamps trades with block time)
    def flush_minutes(self, now_ms):
        with self.lock:
            done = self.agg.pop_before(now_ms - 3000 - (now_ms - 3000) % hlcore.MIN_MS)
            big = self.big.flush(now_ms)
            cut = now_ms - 180000
            self.seen = {k: v for k, v in self.seen.items() if v >= cut}
        for t, coins in done:
            names = {c: self.spot[c] for c in coins if c in self.spot}
            p = hlcore.pack(t, coins, top=100)
            if names:
                p['spot'] = names
            self.retry.append(('min', p, str(t)))
        # failed minute posts are retried on the next rounds (at most RETRY_KEEP kept, oldest dropped)
        left = []
        for kind, p, tag in self.retry[-RETRY_KEEP:]:
            st, txt = self.send(kind, p, tag) if not left else (0, 'queued')
            if st != 200:
                left.append((kind, p, tag))
                if txt != 'queued':
                    log('%s %s -> %s %s (queued %d)' % (kind, tag, st, txt, len(self.retry)))
        self.retry = left
        return len(done), len(big)

    # ---- tracked wallets
    def pick(self):
        self.tracked = hlcore.pick_tracked(self.lb, self.big.candidates(), TRACK_CAP)
        for a in list(self.wallets):
            if a not in self.tracked:
                del self.wallets[a]

    def poll_wallets(self, deadline):
        """Refresh positions (stale > POS_EVERY) and orders (oldest first) until deadline."""
        while time.time() < deadline and not self.stop:
            now = time.time()
            stale = [a for a in self.tracked if now - self.wallets.get(a, {}).get('t', 0) > POS_EVERY]
            if stale:
                a = stale[0]
                chs = info({'type': 'clearinghouseState', 'user': a}, 2)
                if chs is not None:
                    w = self.wallets.setdefault(a, {'trig': [], 'lim': [], 'tOrd': 0})
                    w['pos'], w['av'], w['t'] = hlcore.positions_of(chs), hlcore.account_value(chs), now
                continue
            # orders: oldest first; wallets that hold positions first among equals
            cand = sorted(self.tracked, key=lambda a: (self.wallets.get(a, {}).get('tOrd', 0), not self.wallets.get(a, {}).get('pos')))
            if not cand:
                time.sleep(1)
                continue
            a = cand[0]
            oo = info({'type': 'frontendOpenOrders', 'user': a}, 20)
            w = self.wallets.setdefault(a, {'pos': [], 'av': None, 't': 0})
            w['tOrd'] = time.time()
            if oo is not None:
                w['trig'], w['lim'] = hlcore.triggers_of(oo, w.get('pos') or []), hlcore.limits_of(oo)

    def poll_liquidations(self):
        now = int(time.time() * 1000)
        for a in LIQUIDATORS:
            f = info({'type': 'userFillsByTime', 'user': a, 'startTime': self.liq_t, 'endTime': now}, 20 + 2)
            self.liq += hlcore.liq_events(f or [])
        seen, out = set(), []
        for e in sorted(self.liq, key=lambda e: e['t']):
            if e['tid'] not in seen and e['t'] > now - 7 * 86400000:
                seen.add(e['tid'])
                out.append(e)
        self.liq, self.liq_t = out[-500:], now - 60000

    def books(self, coins):
        out = {}
        for c in coins:
            b = info({'type': 'l2Book', 'coin': c}, 2)
            if b and b.get('levels'):
                lv = b['levels']
                out[c] = {'bids': [[float(x['px']), float(x['sz'])] for x in lv[0]], 'asks': [[float(x['px']), float(x['sz'])] for x in lv[1]]}
        return out

    def build_state(self, now_ms):
        coins = set(c for w in self.wallets.values() for p in (w.get('pos') or []) for c in [p['coin']])
        coins |= set(o['coin'] for w in self.wallets.values() for o in (w.get('trig') or []) + (w.get('lim') or []))
        coins &= set(self.ctx)
        bk = self.books(sorted(self.ctx, key=lambda c: -self.ctx[c]['oi'])[:BOOK_COINS])
        out = {}
        for c in coins:
            mid = self.ctx[c]['mid']
            if mid > 0:
                out[c] = hlcore.coin_state(c, mid, self.wallets, self.ctx[c]['oi'], bk.get(c), now_ms)
                out[c]['liqEvents'] = [e for e in self.liq if e['coin'] == c][-50:]
        prof = {}
        for a, w in self.wallets.items():
            prof[a] = {'av': w.get('av'), 't': int(w.get('t', 0) * 1000), 'tOrd': int(w.get('tOrd', 0) * 1000),
                       'pos': w.get('pos') or [], 'trig': sorted(w.get('trig') or [], key=lambda o: -o['sz'] * o['px'])[:30],
                       'nLim': len(w.get('lim') or []), 'tracked': True}
        for a, rows in self.big.by_wallet.items():
            prof.setdefault(a, {'tracked': False})['fills'] = rows[-10:]
        tot_oi = sum(v['oi'] for v in self.ctx.values())
        tracked_ntl = sum(p['ntl'] for w in self.wallets.values() for p in (w.get('pos') or []))
        return {'v': 1, 't': now_ms, 'coins': out, 'wallets': prof, 'spot': self.spot,
                'meta': {'tracked': len(self.tracked), 'polled': sum(1 for w in self.wallets.values() if w.get('t')),
                         'oiPct': round(100 * tracked_ntl / (2 * tot_oi), 1) if tot_oi else None,
                         'budgetPerMin': BUDGET_PER_MIN, 'liqEvents': len(self.liq), 'trades': self.n_trades}}

    def run(self, seconds=None):
        t_end = time.time() + seconds if seconds else None
        self.refresh_meta()
        self.refresh_labels()
        self.pick()
        threading.Thread(target=self.ws_loop, daemon=True).start()
        last_meta = last_labels = time.time()
        last_state = last_save = 0
        t0 = time.time()
        while not self.stop:
            now = time.time()
            if t_end and now > t_end:
                break
            nm, nb = self.flush_minutes(int(now * 1000))
            if now - last_meta > 3600:
                self.refresh_meta()
                last_meta = now
            if now - last_labels > 3600:
                self.refresh_labels()
                last_labels = now
            swept = all(self.wallets.get(a, {}).get('t') for a in self.tracked)
            due = now - last_state > STATE_EVERY if last_state else (swept or now - t0 > 240)
            if due or (t_end and now > t_end - 15 and now - last_state > 60):
                self.pick()
                self.poll_liquidations()
                s = self.build_state(int(now * 1000))
                st, txt = self.send('state', s)
                log('state %d coins %d wallets (%d tracked, %d polled, oi %.1f%%) trades %d weight %d -> %s %s' % (
                    len(s['coins']), len(s['wallets']), s['meta']['tracked'], s['meta']['polled'], s['meta']['oiPct'] or 0,
                    self.n_trades, BUDGET.used, st, txt))
                last_state = now
            if now - last_save > 600:
                self.save_state()
                last_save = now
            # use the time until the next minute boundary for wallet polling
            nxt = (int(time.time()) // 60 + 1) * 60 + 3.5
            self.poll_wallets(min(nxt, t_end or nxt))
        self.stop = True
        self.flush_minutes(int(time.time() * 1000) + 120000)
        self.save_state()


def main():
    if '--dry-run' in sys.argv:
        i = sys.argv.index('--dry-run')
        secs = int(sys.argv[i + 1]) if len(sys.argv) > i + 1 and sys.argv[i + 1].isdigit() else 120
        out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.join(os.getcwd(), 'hl-dry')
        Feeder('', '', dry_dir=out).run(secs)
        log('dry run done -> ' + out)
        return 0
    url, secret = os.environ.get('BOOK_RECORDER_URL', '').rstrip('/'), os.environ.get('BOOK_INGEST_SECRET', '')
    if not url or not secret:
        log('config missing: BOOK_RECORDER_URL / BOOK_INGEST_SECRET')
        return 2
    Feeder(url, secret).run()
    return 0


if __name__ == '__main__':
    sys.exit(main())
