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
import socket
import sys
import threading
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import alert_core as core  # noqa: E402
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
        out = book.tick(key, float(p), time.time())
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
    backoff = 2
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
                    backoff = 2
        except Exception as e:
            log('IS socket closed: %s %s; retry in %ds' % (type(e).__name__, str(e)[:80], backoff))
        finally:
            if ws:
                ws.close()
        time.sleep(backoff)
        backoff = min(backoff * 2, 60)


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
             'feeds': {k: int(v) for k, v in stat['feed'].items()}}
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
    threads = [sync_loop, fire_loop, health_loop, binance_reader, coinbase_reader]
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
