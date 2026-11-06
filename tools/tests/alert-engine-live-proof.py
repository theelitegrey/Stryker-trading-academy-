#!/usr/bin/env python3
"""Alert engine end-to-end proof from THIS server, with no live writes:
  REAL Firestore reads (full_sync + zoro_load over the regional host), REAL Binance @trade ticks (data-stream.binance.vision),
  ONE stub chart alert (not in Firestore) set just past the live BTCUSDT price with a 'cross' condition. Writes
  (claim patch, alertFires, notifications = the push queue) are captured, not sent.
  python3 tools/tests/alert-engine-live-proof.py"""
import json, os, sys, threading, time, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'workers', 'alert-engine'))
os.environ['ALERT_HEALTH'] = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'ae-proof-health.json')
import alert_engine as ae  # noqa: E402

writes = []
STUB = 'students/proof-uid/chartAlerts/proof-alert'
real_get = ae.fs.get_doc
stub = {}
ae.fs.get_doc = lambda p: (dict(stub), 'ut-1') if p == STUB else real_get(p)
ae.fs.patch_doc = lambda p, d, ut=None: writes.append(('patch', p, d, ut))
ae.fs.set_doc = lambda p, d: writes.append(('set', p, d))
ae.fs.create_doc = lambda c, d: writes.append(('create', c, d)) or 'x'

n = ae.full_sync(first=True)                      # real read: collection group chartAlerts, active == true
print('1. rule read: %d active chart alerts loaded from Firestore (%s)' % (n, ae.fs.HOST))
z = ae.zoro_load()                                # real read: zoroAlerts (no missing-index 400 any more)
print('   zoroAlerts read OK: %d active' % len(z))

px = float(json.load(urllib.request.urlopen('https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT', timeout=15))['price'])
level = round(px + 1.0, 2)                        # 'crossing' fires when the live price moves through this level
stub.update({'active': True, 'symbol': 'binance:BTCUSDT', 'cond': 'crossing', 'price': level, 'freq': 'once', 'message': 'proof'})
a = ae.core.parse_alert('proof-uid', 'proof-alert', stub, 'ut-1')
assert a, 'stub alert parsed'
with ae.lock:
    ae.book.upsert(a)
print('2. stub alert armed: BTCUSDT crossing %.2f (last %.2f)' % (level, px))

for fn in (ae.binance_reader, ae.fire_loop):
    threading.Thread(target=fn, daemon=True).start()
t0 = time.time()
while time.time() - t0 < 240 and not any(w[0] == 'create' for w in writes):
    if ae.stat['ticks'] and not ae.stat.get('_said'):
        ae.stat['_said'] = 1
        print('   first live tick from data-stream.binance.vision after %.1fs' % (time.time() - t0))
    time.sleep(0.5)
ok = [w for w in writes if w[0] == 'create']
if not ok:
    print('no cross within 240 s (BTC did not move $1?), ticks=%d' % ae.stat['ticks']); sys.exit(1)
for w in writes:
    print('3. write captured:', w[0], w[1], {k: v for k, v in w[2].items() if k != 'recipientUid'})
claim = [w for w in writes if w[0] == 'patch' and w[1] == STUB]
assert claim and claim[0][2]['active'] is False and claim[0][3] == 'ut-1', 'once alert claimed with updateTime precondition'
assert any(w[0] == 'set' and w[1] == 'students/proof-uid/alertFires/proof-alert' for w in writes), 'fired-state written'
assert ok[0][1] == 'notifications' and ok[0][2]['type'] == 'chart_alert' and ok[0][2]['recipientUid'] == 'proof-uid', 'push queued'
print('PASS: rule read -> live price cross -> claim + fired write -> notifications doc (push queue). ticks=%d fires=%d' % (ae.stat['ticks'], ae.stat['fires']))
os._exit(0)
