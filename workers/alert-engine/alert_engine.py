#!/usr/bin/env python3
"""TradeZoro server-side price-alert engine (systemd service alert-engine.service).

Owner question 2026-10-16: "Why aren't notifications, like chart alerts, being pushed on mobile?"
Chart alerts used to be checked only inside an open charts.html. This service checks every member's
active PRICE alerts on the server against the live feeds and, on a fire, writes a notifications doc
(the same shape the bell uses) so the existing Cloud Function onNotificationCreated pushes it to the
member's phone (FCM).

  alerts   Firestore collection group chartAlerts (active == true). Full load at start and every 30 min,
           incremental (updatedAt > cursor) every 30 s. At fire time the doc is re-read and checked, so a
           deleted / edited / paused alert never fires from stale memory.
  prices   futures: InsightSentry tick sockets (the same feed as of-feeder; contract codes come from
           of-state.json, which of-feeder re-picks daily; micros use the mini's price);
           crypto: Binance (spot trades) and Coinbase (ticker) public websockets, subscribed on demand.
  fire     claim (Once: PATCH active=false with an updateTime precondition) -> students/{uid}/alertFires/{id}
           (the open page listens to this: toast + sound, and shows the alert stopped) -> notifications doc.
  de-dupe  the server owns firing: charts.html skips price alerts this engine covers while the heartbeat
           settings/alertEngine is fresh, and listens to alertFires instead.
  health   /root/projects/alert-engine/health.json (+ the settings/alertEngine heartbeat every 60 s).

Secrets: the InsightSentry key comes from the env file systemd loads; Google access comes from the
firebase-tools refresh token already on this server (fsrest.py). Nothing is logged or printed.
Stdlib only (wsmini.py is the socket client shared with of-feeder).
"""
import json
import os
import queue
import random
import socket
import sys
import threading
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import alert_core as core  # noqa: E402
import zoro_alerts as za  # noqa: E402
import fsrest as fs  # noqa: E402
import wsmini  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
HEALTH = os.environ.get('ALERT_HEALTH', os.path.join(HERE, 'health.json'))
OF_STATE = os.environ.get('OF_STATE', '/root/projects/book-feeder/of-state.json')
IS_WS = 'wss://realtime.insightsentry.com/live'
SYNC_EVERY = 30
FULL_EVERY = 1800
HEARTBEAT_EVERY = 60

# futures root -> InsightSentry code fallback. Micros ride the mini's price.
IS_ROOTS = {'NQ': 'CME_MINI:NQ1!', 'ES': 'CME_MINI:ES1!', 'RTY': 'CME_MINI:RTY1!', 'YM': 'CBOT_MINI:YM1!',
            'GC': 'COMEX:GC1!', 'SI': 'COMEX:SI1!', 'CL': 'NYMEX:CL1!'}
MICRO_OF = {'MNQ': 'NQ', 'MES': 'ES', 'MYM': 'YM', 'MGC': 'GC', 'SIL': 'SI', 'MCL': 'CL'}

lock = threading.Lock()
book = core.Book()
zbook = core.Book()               # ZoroOptions level touches on the futures price scale (apart from book: book.sync would drop them)
fires_q = queue.Queue()
stat = {'fires': 0, 'fire_errors': 0, 'sync_ok': 0, 'sync_err': 0, 'last_sync': 0, 'feed': {}, 'ticks': 0}


def log(m):
    print(m, flush=True)


def feed_seen(name):
    stat['feed'][name] = time.time()


# ---------------------------------------------------------------------------------- price -> book
def on_price(key, p):
    if p is None or p != p or p <= 0:
        return
    with lock:
        stat['ticks'] += 1
        now = time.time()
        out = book.tick(key, float(p), now) + zbook.tick(key, float(p), now)
    for f in out:
        fires_q.put(f)


def fut_price(root, p):
    """A mini's print feeds the mini's key and the micro's key (same index / metal / crude price)."""
    on_price('fut:' + root, p)
    for mic, mini in MICRO_OF.items():
        if mini == root:
            on_price('fut:' + mic, p)


# ---------------------------------------------------------------------------------- InsightSentry
def is_codes():
    codes = dict(IS_ROOTS)
    try:
        st = json.load(open(OF_STATE)).get('codes', {})
        for r, c in st.items():
            if r in codes and isinstance(c, str) and ':' in c:
                codes[r] = c
    except Exception:
        pass
    return codes


def is_reader(roots, key):
    backoff = 5   # 5 s doubling to 2 min with jitter (InsightSentry reconnect budget, 2026-10-22)
    while True:
        codes = is_codes()
        code2root = {codes[r]: r for r in roots}
        ws = None
        try:
            ws = wsmini.WS(IS_WS, timeout=30)
            ws.send(json.dumps({'api_key': key, 'subscriptions': [
                {'code': codes[r], 'type': 'series', 'bar_type': 'tick', 'bar_interval': 1, 'dp': 1} for r in roots]}))
            ws.s.settimeout(25)
            opened = time.time()
            while True:
                if time.time() - opened > 300 and is_codes() != codes:
                    break                     # of-feeder picked a new contract: resubscribe
                try:
                    m = ws.recv()
                except socket.timeout:
                    ws.ping()
                    continue
                d = json.loads(m)
                if 'error' in d:
                    log('IS: %s' % str(d.get('error'))[:80])
                    if d.get('retryable') is False or 'limit' in str(d.get('error')):
                        break
                    continue
                r = code2root.get(d.get('code'))
                ser = d.get('series')
                if not r or not ser:
                    continue
                feed_seen('futures')
                try:
                    fut_price(r, float(ser[-1]['close']))
                except (KeyError, TypeError, ValueError):
                    pass
                if time.time() - opened > 60:
                    backoff = 5
        except Exception as e:
            log('IS socket closed: %s %s; retry in %ds' % (type(e).__name__, str(e)[:80], backoff))
        finally:
            if ws:
                ws.close()
        time.sleep(backoff * (0.75 + random.random() * 0.5))
        backoff = min(backoff * 2, 120)


# ---------------------------------------------------------------------------------- crypto
def wanted(prefix):
    with lock:
        return {k.split(':', 1)[1] for k in book.keys() if k.startswith(prefix + ':')}


def binance_reader():
    backoff = 2
    while True:
        ws = None
        try:
            ws = wsmini.WS('wss://stream.binance.com:9443/ws', timeout=30)
            have = set()
            ws.s.settimeout(5)
            opened = time.time()
            nid = 1
            while True:
                want = wanted('binance')
                add, rm = want - have, have - want
                if add:
                    ws.send(json.dumps({'method': 'SUBSCRIBE', 'params': [s.lower() + '@trade' for s in sorted(add)], 'id': nid}))
                    nid += 1
                if rm:
                    ws.send(json.dumps({'method': 'UNSUBSCRIBE', 'params': [s.lower() + '@trade' for s in sorted(rm)], 'id': nid}))
                    nid += 1
                have = set(want)
                try:
                    m = ws.recv()
                except socket.timeout:
                    ws.ping()
                    continue
                d = json.loads(m)
                if d.get('e') == 'trade':
                    feed_seen('binance')
                    on_price('binance:' + d['s'], float(d['p']))
                if time.time() - opened > 60:
                    backoff = 2
                if time.time() - opened > 23 * 3600:
                    break                      # Binance drops sockets at 24 h
        except Exception as e:
            log('binance socket closed: %s %s; retry in %ds' % (type(e).__name__, str(e)[:80], backoff))
        finally:
            if ws:
                ws.close()
        time.sleep(backoff)
        backoff = min(backoff * 2, 60)


def coinbase_reader():
    backoff = 2
    while True:
        ws = None
        try:
            ws = wsmini.WS('wss://ws-feed.exchange.coinbase.com', timeout=30)
            have = set()
            ws.s.settimeout(5)
            opened = time.time()
            while True:
                want = wanted('coinbase')
                add, rm = want - have, have - want
                if add:
                    ws.send(json.dumps({'type': 'subscribe', 'product_ids': sorted(add), 'channels': ['ticker']}))
                if rm:
                    ws.send(json.dumps({'type': 'unsubscribe', 'product_ids': sorted(rm), 'channels': ['ticker']}))
                have = set(want)
                try:
                    m = ws.recv()
                except socket.timeout:
                    ws.ping()
                    continue
                d = json.loads(m)
                if d.get('type') == 'ticker' and d.get('price'):
                    feed_seen('coinbase')
                    on_price('coinbase:' + d['product_id'], float(d['price']))
                if time.time() - opened > 60:
                    backoff = 2
        except Exception as e:
            log('coinbase socket closed: %s %s; retry in %ds' % (type(e).__name__, str(e)[:80], backoff))
        finally:
            if ws:
                ws.close()
        time.sleep(backoff)
        backoff = min(backoff * 2, 60)


# ---------------------------------------------------------------------------------- alert loading
CG = {'from': [{'collectionId': 'chartAlerts', 'allDescendants': True}]}
cursor = {'ms': 0}


def _ms(iso):
    try:
        import calendar
        return calendar.timegm(time.strptime(iso[:19], '%Y-%m-%dT%H:%M:%S')) * 1000
    except (ValueError, TypeError):
        return 0


def _rows(res):
    out = {}
    seen_max = 0
    for x in res:
        d = x.get('document')
        if not d:
            continue
        parts = d['name'].split('/documents/')[1].split('/')     # students/{uid}/chartAlerts/{aid}
        if len(parts) != 4:
            continue
        f = fs.decode_doc(d)
        out[parts[1] + '/' + parts[3]] = (core.parse_alert(parts[1], parts[3], f, d.get('updateTime', '')), f)
        if isinstance(f.get('updatedAt'), str):
            seen_max = max(seen_max, _ms(f['updatedAt']))
    return out, seen_max


def full_sync(first=False):
    res = fs.run_query(dict(CG, where={'fieldFilter': {'field': {'fieldPath': 'active'}, 'op': 'EQUAL', 'value': {'booleanValue': True}}}))
    rows, mx = _rows(res)
    fresh = {k: a for k, (a, f) in rows.items() if a}
    with lock:
        if first:
            for a in fresh.values():
                a['quiet'] = True              # already-true greater/less at start-up are held, not fired
        book.sync(fresh)
        if mx:
            cursor['ms'] = max(cursor['ms'], mx - 5000)
    return len(fresh)


def incremental_sync():
    since = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(cursor['ms'] / 1000))
    res = fs.run_query(dict(CG, where={'fieldFilter': {'field': {'fieldPath': 'updatedAt'}, 'op': 'GREATER_THAN',
                                                       'value': {'timestampValue': since}}}))
    rows, mx = _rows(res)
    with lock:
        for k, (a, f) in rows.items():
            if a:
                book.upsert(a)
            else:
                book.remove(k)
        if mx:
            cursor['ms'] = max(cursor['ms'], mx - 5000)
    return len(rows)


def sync_loop():
    last_full = 0
    first = True
    while True:
        try:
            if first:
                cursor['ms'] = int(time.time() * 1000) - 5000
            if first or cursor.pop('full', False) or time.time() - last_full >= FULL_EVERY:
                n = full_sync(first)
                last_full = time.time()
                if first:
                    log('alert-engine: %d active price alerts loaded' % n)
                first = False
            else:
                incremental_sync()
            stat['sync_ok'] += 1
            stat['last_sync'] = time.time()
        except Exception as e:
            stat['sync_err'] += 1
            log('sync failed: %s %s' % (type(e).__name__, str(e)[:120]))
        time.sleep(SYNC_EVERY)


# ---------------------------------------------------------------------------------- firing
def fire_one(a, p, prev):
    if a.get('zoro'):
        return zoro_fire(a['zoro'], za.touch_text(a, p, prev), zb=a)
    path = 'students/%s/chartAlerts/%s' % (a['uid'], a['aid'])
    doc, ut = fs.get_doc(path)
    if doc is None or doc.get('active') is not True or float(doc.get('price', 0)) != a['price'] or doc.get('cond') != a['cond']:
        with lock:                                  # stale: forget it; the next sync re-adds an edited one
            book.remove(a['id'])
        return 'stale'
    ts = fs.now_ts()
    if a['freq'] == 'once':
        try:
            fs.patch_doc(path, {'active': False, 'updatedAt': ts}, ut)     # claim: only one fire wins
        except fs.HttpErr as e:
            if e.status in (400, 404, 409):
                return 'claimed-elsewhere'
            raise
    text = core.push_text(a, p, prev)
    fs.set_doc('students/%s/alertFires/%s' % (a['uid'], a['aid']),
               {'firedAt': ts, 'price': p, 'text': text, 'symbol': a['symbol'], 'freq': a['freq'], 'stopped': a['freq'] == 'once'})
    sym = urllib.parse.quote(a['symbol'], safe=':!')
    fs.create_doc('notifications', {'recipientUid': a['uid'], 'type': 'chart_alert', 'message': text,
                                    'link': 'charts.html?symbol=' + sym, 'read': False, 'createdAt': ts})
    return 'fired'


def fire_loop():
    while True:
        a, p, prev = fires_q.get()
        try:
            r = fire_one(a, p, prev)
            if r == 'fired':
                stat['fires'] += 1
                log('FIRE %s %s %s @ %s' % (a['aid'][:6], a['symbol'], a['cond'], p))   # no uid in logs
            else:
                log('skip %s: %s' % (a['aid'][:6], r))
        except Exception as e:
            stat['fire_errors'] += 1
            log('fire failed: %s %s' % (type(e).__name__, str(e)[:120]))
            cursor['full'] = True                    # re-read everything next round so the alert is not lost


# ---------------------------------------------------------------------------------- ZoroOptions alerts
# Spec section 4. Levels/IV/put-call come from the Worker's /zo/summary (the feeder's numbers, ingest key; the engine never
# calls a vendor). Level touches ride the futures ticks above (zbook); the other types are checked when a symbol's snapshot
# has a new build time. Alerts: students/{uid}/zoroAlerts. Fires: one notifications doc (push), nothing else.
ZORO_URL = os.environ.get('ZORO_API_URL', os.environ.get('BOOK_RECORDER_URL', '').rstrip('/') + '/zo')
ZORO_KEY = os.environ.get('BOOK_INGEST_SECRET', '')
ZORO_EVERY = 120
ZORO_STATE = os.environ.get('ZORO_STATE', os.path.join(HERE, 'zoro-state.json'))
zalerts = {}                       # id -> engine alert (every active ZoroOptions alert)
zsnap = {}                         # underlying -> last snapshot seen
zcool = za.Cooldown()
zstat = {'fires': 0, 'loops': 0, 'last': 0, 'err': 0}


def zget(path):
    import urllib.request
    req = urllib.request.Request(ZORO_URL + path, headers={'x-ingest-key': ZORO_KEY, 'User-Agent': 'tradezoro-alert-engine/1'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def zoro_load():
    res = fs.run_query({'from': [{'collectionId': 'zoroAlerts', 'allDescendants': True}],
                        'where': {'fieldFilter': {'field': {'fieldPath': 'active'}, 'op': 'EQUAL', 'value': {'booleanValue': True}}}})
    out = []
    for x in res:
        d = x.get('document')
        if not d:
            continue
        parts = d['name'].split('/documents/')[1].split('/')     # students/{uid}/zoroAlerts/{aid}
        if len(parts) != 4:
            continue
        a = za.parse_zoro_alert(parts[1], parts[3], fs.decode_doc(d), d.get('updateTime', ''))
        if a:
            out.append(a)
    return {a['id']: a for a in za.limit_per_member(out)}


def zoro_fire(a, text, zb=None):
    """Claim (Once: active=false with the update-time precondition) -> notifications doc -> phone push."""
    path = 'students/%s/zoroAlerts/%s' % (a['uid'], a['aid'])
    doc, ut = fs.get_doc(path)
    if doc is None or doc.get('active') is not True or doc.get('type') != a['type']:
        with lock:
            zalerts.pop(a['id'], None)
            if zb:
                zbook.remove(zb['id'])
        return 'stale'
    if a['freq'] == 'once':
        try:
            fs.patch_doc(path, {'active': False, 'updatedAt': fs.now_ts()}, ut)
        except fs.HttpErr as e:
            if e.status in (400, 404, 409):
                return 'claimed-elsewhere'
            raise
        with lock:
            zalerts.pop(a['id'], None)
    sym = '' if a['type'] == 'note_ready' else '?symbol=' + urllib.parse.quote(a['symbol'])
    fs.create_doc('notifications', {'recipientUid': a['uid'], 'type': 'zoro_alert', 'message': text,
                                    'link': 'zoro-options.html' + sym, 'read': False, 'createdAt': fs.now_ts()})
    zstat['fires'] += 1
    log('ZFIRE %s %s %s' % (a['aid'][:6], a['type'], a['symbol']))   # no uid in logs
    return 'fired'


def zoro_round(now):
    fresh = zoro_load()
    with lock:
        zalerts.clear()
        zalerts.update(fresh)
    touch = {}
    for sym in sorted({a['symbol'] for a in fresh.values() if a['type'] != 'note_ready'}):
        try:
            snap = zget('/summary?u=' + urllib.parse.quote(sym))
        except Exception as e:
            zstat['err'] += 1
            log('zoro summary %s failed: %s' % (sym, type(e).__name__))
            continue
        prev = zsnap.get(sym)
        zsnap[sym] = snap
        for a in fresh.values():
            if a['symbol'] != sym:
                continue
            if a['type'] == 'level_touch':
                pa = za.to_price_alert(a, snap)
                if pa:
                    touch[pa['id']] = pa
                continue
            text = za.evaluate(a, snap, prev)
            if text and zcool.ok(a, now):
                try:
                    zoro_fire(a, text)
                except Exception as e:
                    zstat['err'] += 1
                    log('zoro fire failed: %s %s' % (type(e).__name__, str(e)[:100]))
    with lock:
        zbook.sync(touch)


def zoro_note_check(now):
    """Morning Note ready: once per weekday after 09:40 ET, when the Worker has today's note, tell every active note_ready alert."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    et = datetime.fromtimestamp(now, ZoneInfo('America/New_York'))
    day = et.strftime('%Y-%m-%d')
    if et.weekday() > 4 or (et.hour, et.minute) < (9, 40):
        return
    try:
        done = json.load(open(ZORO_STATE)).get('note_day')
    except Exception:
        done = None
    if done == day:
        return
    try:
        n = zget('/note?day=%s&kind=morning' % day)
    except Exception:
        return                                   # not published yet (the page then says "Note not available today")
    if not n or n.get('day') != day or not n.get('ok'):
        return
    with open(ZORO_STATE + '.tmp', 'w') as f:
        json.dump({'note_day': day}, f)          # mark first: a crash must not fire twice
    os.replace(ZORO_STATE + '.tmp', ZORO_STATE)
    for a in list(zalerts.values()):
        if a['type'] == 'note_ready':
            try:
                zoro_fire(dict(a, freq='every'), za._wrap('The Zoro Morning Note is ready.', a))
            except Exception as e:
                zstat['err'] += 1
                log('zoro note fire failed: %s' % type(e).__name__)


def zoro_loop():
    if not ZORO_KEY or not ZORO_URL.startswith('http'):
        log('no recorder URL / ingest key: ZoroOptions alerts are off')
        return
    while True:
        now = time.time()
        try:
            zoro_round(now)
            zoro_note_check(now)
            zstat['loops'] += 1
            zstat['last'] = int(now)
        except Exception as e:
            zstat['err'] += 1
            log('zoro round failed: %s %s' % (type(e).__name__, str(e)[:120]))
        time.sleep(ZORO_EVERY)


# ---------------------------------------------------------------------------------- health
def health_loop():
    last_hb = 0
    while True:
        now = time.time()
        with lock:
            n = len(book.alerts)
            keys = len(book.keys())
        h = {'ok': (now - stat['last_sync'] < 180) if stat['last_sync'] else False, 'at': int(now), 'alerts': n, 'keys': keys,
             'fires': stat['fires'], 'fire_errors': stat['fire_errors'], 'sync_err': stat['sync_err'],
             'last_sync': int(stat['last_sync']), 'ticks': stat['ticks'],
             'feeds': {k: int(v) for k, v in stat['feed'].items()},
             'zoro': dict(zstat, alerts=len(zalerts), touch=len(zbook.alerts))}
        try:
            tmp = HEALTH + '.tmp'
            with open(tmp, 'w') as f:
                json.dump(h, f)
            os.replace(tmp, HEALTH)
        except OSError:
            pass
        if h['ok'] and now - last_hb >= HEARTBEAT_EVERY:
            try:
                fs.set_doc('settings/alertEngine', {'at': fs.now_ts(), 'alerts': n})
                last_hb = now
            except Exception as e:
                log('heartbeat failed: %s' % type(e).__name__)
        time.sleep(10)


def main():
    key = os.environ.get('INSIGHTSENTRY_WEBSOCKET_API_KEY', '')
    roots = list(IS_ROOTS)
    threads = [sync_loop, fire_loop, health_loop, binance_reader, coinbase_reader, zoro_loop]
    if key:
        threads += [lambda: is_reader(roots[:4], key), lambda: is_reader(roots[4:], key)]
    else:
        log('no InsightSentry key: futures alerts are not watched')
    for fn in threads:
        threading.Thread(target=fn, daemon=True).start()
    log('alert-engine started')
    while True:
        time.sleep(3600)


if __name__ == '__main__':
    main()
