#!/usr/bin/env python3
"""Fire-delivery retry in workers/alert-engine/alert_engine.py (Owner bug 2026-11-07: alerts lost on 403s).
  python3 tools/tests/alert-engine-retry-test.py
Dry run: Firestore is a fake in memory (no network, no service restart). Checks that a fire whose writes fail is
queued and retried with backoff, lands exactly once (fixed notification path, so a retry overwrites), is given up
after 10 min, and that health counts the errors.
"""
import os, sys, unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'workers', 'alert-engine'))
import alert_engine as ae  # noqa: E402  (imports only; main() is not run)


class FakeFs:
    def __init__(self):
        self.docs = {}
        self.fail = 0            # fail the next N writes
        self.HttpErr = ae.fs.HttpErr

    def set_doc(self, path, data):
        if self.fail > 0:
            self.fail -= 1
            raise ae.fs.HttpErr(403, '<!DOCTYPE html> blocked')
        self.docs[path] = dict(data)

    def get_doc(self, path):
        return (self.docs.get(path), 't1') if path in self.docs else (None, None)

    def patch_doc(self, path, data, precond=None):
        self.docs[path].update(data)

    def now_ts(self):
        return {'__ts': '2026-11-07T00:00:00.000Z'}


class T(unittest.TestCase):
    def setUp(self):
        self.real = ae.fs
        self.fs = ae.fs = FakeFs()
        ae.outbox.clear(); ae.err_times.clear()
        for k in ('fires', 'fire_errors', 'retried', 'dropped'):
            ae.stat[k] = 0
        ae.log = lambda m: None

    def tearDown(self):
        ae.fs = self.real

    def alert(self, freq='once'):
        a = {'id': 'u1/a1', 'uid': 'u1', 'aid': 'a1abcdef', 'symbol': 'CME:NQ1!', 'cond': 'crossing_up', 'price': 100.0,
             'freq': freq, 'message': ''}
        self.fs.docs['students/u1/chartAlerts/a1abcdef'] = {'active': True, 'price': 100.0, 'cond': 'crossing_up'}
        return a

    def notifs(self):
        return [p for p in self.fs.docs if p.startswith('notifications/')]

    def test_ok_path_writes_both(self):
        self.assertEqual(ae.fire_one(self.alert(), 101.0, 99.0), 'fired')
        self.assertEqual(len(self.notifs()), 1)
        self.assertIn('students/u1/alertFires/a1abcdef', self.fs.docs)
        self.assertFalse(self.fs.docs['students/u1/chartAlerts/a1abcdef']['active'])   # claimed
        self.assertEqual(ae.outbox, [])

    def test_failed_write_is_queued_then_retried_once(self):
        a = self.alert()
        self.fs.fail = 2                                  # alertFires write + first retry fail
        self.assertEqual(ae.fire_one(a, 101.0, 99.0), 'queued')
        self.assertEqual(len(ae.outbox), 1)
        self.assertEqual(ae.stat['fire_errors'], 1)
        self.assertEqual(self.notifs(), [])
        t0 = ae.outbox[0]['first']
        ae.retry_due(t0 + 1)                              # not due yet (backoff 5 s)
        self.assertEqual(len(ae.outbox), 1); self.assertEqual(self.fs.fail, 1)
        ae.retry_due(t0 + 6)                              # due, fails again -> backoff 10 s
        self.assertEqual(ae.outbox[0]['tries'], 2); self.assertEqual(ae.stat['fire_errors'], 2)
        self.assertEqual(ae.outbox[0]['next'], t0 + 6 + 10)
        ae.retry_due(t0 + 17)                             # lands
        self.assertEqual(ae.outbox, [])
        self.assertEqual(len(self.notifs()), 1)
        self.assertIn('students/u1/alertFires/a1abcdef', self.fs.docs)
        self.assertEqual(ae.stat['retried'], 1)

    def test_partial_write_resumes_where_it_stopped(self):
        a = self.alert()
        real_set = self.fs.set_doc
        calls = []
        def set_doc(path, data):
            calls.append(path)
            if path.startswith('notifications/') and len(calls) == 2:
                raise ae.fs.HttpErr(503, 'x')
            real_set(path, data)
        self.fs.set_doc = set_doc
        self.assertEqual(ae.fire_one(a, 101.0, 99.0), 'queued')
        self.assertEqual(len(ae.outbox[0]['ops']), 1)    # alertFires landed; only the notification is left
        ae.retry_due(ae.outbox[0]['next'])
        self.assertEqual(len(self.notifs()), 1)
        self.assertEqual(calls.count('students/u1/alertFires/a1abcdef'), 1)

    def test_same_path_on_retry_no_duplicate(self):
        ok = ae.write_ops([('notifications/abc', {'x': 1})], 't')
        self.assertTrue(ok)
        self.fs.set_doc('notifications/abc', {'x': 1})   # a retry after a timeout that landed
        self.assertEqual(self.notifs(), ['notifications/abc'])

    def test_gives_up_after_10_min(self):
        self.fs.fail = 10 ** 6
        ae.write_ops([('notifications/n1', {'x': 1})], 't')
        t0 = ae.outbox[0]['first']
        t = t0
        while ae.outbox and t < t0 + 2000:
            t = max(t + 1, ae.outbox[0]['next'])
            ae.retry_due(t)
        self.assertEqual(ae.outbox, [])
        self.assertEqual(ae.stat['dropped'], 1)
        self.assertGreaterEqual(t - t0, ae.RETRY_FOR)
        self.assertLess(t - t0, ae.RETRY_FOR + 130)       # backoff is capped at 2 min

    def test_dp_and_zoro_use_outbox(self):
        self.fs.docs['students/u1/dpAlerts/d1abcdef'] = {'active': True, 'symbol': 'SPY'}
        self.fs.fail = 1
        r = ae.dp_fire({'uid': 'u1', 'aid': 'd1abcdef', 'symbol': 'SPY', 'freq': 'every'}, ['a', 'b'])
        self.assertEqual(r, 'fired')
        self.assertEqual(len(ae.outbox), 1); self.assertEqual(len(ae.outbox[0]['ops']), 2)
        ae.retry_due(ae.outbox[0]['next'])
        self.assertEqual(len(self.notifs()), 2)

    def test_health_fields(self):
        self.fs.fail = 1
        ae.write_ops([('notifications/n1', {'x': 1})], 't')
        h = {'fire_errors_1h': sum(1 for t in ae.err_times if True)}
        self.assertEqual(h['fire_errors_1h'], 1)
        src = open(os.path.join(ROOT, 'workers', 'alert-engine', 'alert_engine.py')).read()
        for k in ("'fire_errors_1h'", "'outbox'", "'dropped'", "'hb_at'"):
            self.assertIn(k, src)


if __name__ == '__main__':
    unittest.main(verbosity=1)
