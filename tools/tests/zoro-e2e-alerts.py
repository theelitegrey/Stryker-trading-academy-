#!/usr/bin/env python3
"""ZoroOptions end-to-end, alert engine side: the REAL alert_engine.zoro_round / zoro_note_check read the local Worker
(workers/book-recorder/test/zoro-local-server.mjs, fed by the real feeder + note job) with the ingest key. Firestore is
stubbed (no live data touched); fires are captured instead of written.
  ZO_URL=http://127.0.0.1:8788 ZO_KEY_FILE=<key file> python3 tools/tests/zoro-e2e-alerts.py"""
import json, os, sys, tempfile, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.environ['ZORO_API_URL'] = os.environ.get('ZO_URL', 'http://127.0.0.1:8788') + '/zo'
os.environ['BOOK_INGEST_SECRET'] = open(os.environ['ZO_KEY_FILE']).read().strip()
os.environ['ZORO_STATE'] = os.path.join(tempfile.mkdtemp(), 'zoro-state.json')
sys.path.insert(0, os.path.join(ROOT, 'workers', 'alert-engine'))
import alert_engine as ae  # noqa: E402
import zoro_alerts as za  # noqa: E402

docs = {}
fires = []


def alert(aid, **d):
    docs['students/u1/zoroAlerts/' + aid] = dict(d, active=True)


alert('a1', type='zone_change', symbol='SPX')
alert('a2', type='level_moved', symbol='QQQ', p={'level': 'call_ceiling'})
alert('a3', type='fresh_volume', symbol='SPY', p={'min_volume': 1})
alert('a4', type='volume_burst', symbol='SPX', p={'min_added': 1}, freq='every')
alert('a5', type='iv_rank', symbol='IWM', p={'dir': 'above', 'value': 1})
alert('a6', type='pc_extreme', symbol='GLD', p={'dir': 'above', 'value': 0.01})
alert('a7', type='level_touch', symbol='ES', p={'level': 'flip_line'})
alert('a8', type='note_ready', symbol='NOTE')

ae.fs.run_query = lambda q, parent=None: [{'document': {'name': 'projects/p/databases/(default)/documents/' + k, 'fields': {}, 'updateTime': 't'}, '_d': v} for k, v in docs.items()]
ae.fs.decode_doc = lambda d: docs[d['name'].split('/documents/')[1]]
ae.fs.get_doc = lambda path: (docs.get(path), 't')
ae.fs.patch_doc = lambda path, data, ut=None: docs[path].update(data)
ae.fs.create_doc = lambda coll, data: fires.append(data)
ae.fs.now_ts = lambda: 'now'

n = 0


def ok(c, m):
    global n
    assert c, m
    n += 1
    print('PASS', m)


now = time.time()
ae.zoro_round(now)                                  # first look: baseline, nothing fires
ok(not fires, 'first round is a baseline (no fires)')
ok(set(ae.zsnap) == {'SPX', 'QQQ', 'SPY', 'IWM', 'GLD'}, 'engine read /zo/summary for every watched symbol with the ingest key')
ok(ae.zstat['err'] == 0, 'no read errors')
# previous snapshots made older and different, so every build-based type has something to compare against
for s, v in list(ae.zsnap.items()):
    prev = json.loads(json.dumps(v))
    prev['built'] -= 120
    prev['zone'] = 'cushion' if v['zone'] == 'swing' else 'swing'
    prev['levels']['call_ceiling'] = (v['levels']['call_ceiling'] or 0) - 5
    prev['fresh_top'], prev['burst_top'] = [], []
    prev['iv']['rank'] = 0
    prev['pc']['volume'] = 0
    ae.zsnap[s] = prev
ae.zoro_round(now + 1)
types = sorted(f['message'].split(':')[0].split(' ')[0] + '|' + f['link'] for f in fires)
print('\n'.join(f['message'] for f in fires))
msgs = ' '.join(f['message'] for f in fires)
ok('SPX moved into the' in msgs, 'zone_change fired from real SPX data')
ok('QQQ Call Ceiling moved from' in msgs, 'level_moved fired from real QQQ data')
ok('SPY: Fresh Volume on the' in msgs, 'fresh_volume fired from real SPY rows (feeder C/P form)')
ok('SPX: Volume Burst on the' in msgs or not ae.zsnap['SPX'].get('burst_top'), 'volume_burst fired (when SPX had bursts)')
ok('IWM IV rank moved above' in msgs, 'iv_rank fired')
ok('GLD put/call by volume moved above' in msgs, 'pc_extreme fired')
ok(all(f['message'].endswith('Education only. Not financial advice.') for f in fires), 'every push carries the footer')
ok(all(not za.banned_words(f['message'].replace(za.FOOTER, '')) for f in fires), 'no banned words in any push')
ok(docs['students/u1/zoroAlerts/a1']['active'] is False and docs['students/u1/zoroAlerts/a4']['active'] is True, 'Once alerts claimed, Every alerts stay')
za_t = list(ae.zbook.alerts.values())
ok(len(za_t) == 1 and za_t[0]['price'] > 0 and abs(za_t[0]['price'] / ae.zsnap['SPX']['levels']['flip_line'] - ae.zsnap['SPX']['fut']['ratio']) < 1e-3, 'ES Flip Line touch armed on the futures book at SPX flip x ratio (%.2f)' % za_t[0]['price'])
k0 = len(fires)
ae.zoro_note_check(now)
from datetime import datetime
from zoneinfo import ZoneInfo
et = datetime.now(ZoneInfo('America/New_York'))
if et.weekday() < 5 and (et.hour, et.minute) >= (9, 40):
    ok(len(fires) == k0 + 1 and 'Morning Note is ready' in fires[-1]['message'], 'note_ready fired from the stored morning note')
    ae.zoro_note_check(now)
    ok(len(fires) == k0 + 1, 'note_ready fires once a day')
print('\n%d checks passed' % n)
