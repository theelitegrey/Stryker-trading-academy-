#!/usr/bin/env python3
"""Metric alerts (workers/alert-engine/metric_alerts.py + metric_loop.metric_round).   python3 tools/tests/metric-alerts-test.py
Pure rules on small hand-made snapshots, then the engine round with stub deps (no network, no Firestore)."""
import copy, json, os, sys, unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'workers', 'alert-engine'))
import metric_alerts as ma  # noqa: E402
import metric_loop as ml  # noqa: E402

ARM = '2026-11-07T12:00:00.000Z'


def al(metric, p, sym='SPX', freq='once', i=1, uid='u1', armed=ARM):
    return ma.parse_metric_alert(uid, 'a%d' % i, {'active': True, 'metric': metric, 'symbol': sym, 'p': p, 'freq': freq,
                                                  'updatedAt': armed}, 't1')


def summ(built, spot, cw=7425, pw=7350, zg=7400.0, em=(7376.0, 50.0), nodes=(7350, 7400, 7425)):
    return {'built': built, 't': built - 60, 'spot': spot, 'levels': {'call_ceiling': cw, 'put_floor': pw, 'flip_line': zg, 'pin': 7380,
            'net': -100.0}, 'nodes': [{'k': k, 'g': 1, 'share': .1} for k in nodes],
            'snap': {'em': list(em)}, 'ranges': {'w': [7200, 7550]}}


def v(*a, **k):
    return ma.snap_values(summ(*a, **k))


class Parse(unittest.TestCase):
    def test_ok(self):
        a = al('gex_cross', {'level': 'gamma_flip'})
        self.assertEqual((a['symbol'], a['p'], a['pro']), ('SPX', {'level': 'gamma_flip', 'dir': 'any'}, True))
        self.assertEqual(al('gex_cross', {'level': 'call_wall'}, sym='ES1!')['symbol'], 'SPX')
        self.assertEqual(al('gex_cross', {'level': 'call_wall'}, sym='futures:NQ')['symbol'], 'QQQ')
        self.assertEqual(al('gex_cross', {'level': 'em_high'})['p']['range'], 's')
        self.assertEqual(al('funding', {'venue': 'okx', 'dir': 'above', 'value': 0.01}, sym='okx:BTC-USDT-SWAP')['symbol'], 'BTC')
        self.assertFalse(al('funding', {'venue': 'hl', 'dir': 'above', 'value': 0.01}, sym='ETH')['pro'])
        self.assertEqual(al('oi_change', {'venue': 'hl', 'mins': 15, 'dir': 'up', 'value': 2}, sym='SOL')['p']['mins'], 15)

    def test_bad(self):
        bad = [('gex_cross', {'level': 'nope'}), ('gex_cross', {'level': 'em_low', 'range': 'q'}), ('gex_cross', {'level': 'pin', 'dir': 'sideways'}),
               ('gex_regime', {}), ('iv_rank', {'dir': 'above', 'value': 50}),            # those live in zoroAlerts
               ('funding', {'venue': 'okx', 'dir': 'above', 'value': True}), ('funding', {'venue': 'okx', 'dir': 'over', 'value': 0.1}),
               ('funding', {'venue': 'binance', 'dir': 'above', 'value': 0.01}), ('funding', {'venue': 'okx', 'dir': 'above', 'value': 9}),
               ('oi_change', {'venue': 'okx', 'mins': 7, 'dir': 'up', 'value': 2}), ('oi_change', {'venue': 'okx', 'mins': 15, 'dir': 'up', 'value': 0}),
               ('volume', {})]
        for m, p in bad:
            self.assertIsNone(al(m, p), (m, p))
        G = {'level': 'pin'}
        self.assertIsNone(ma.parse_metric_alert('u', 'a', {'active': False, 'metric': 'gex_cross', 'symbol': 'SPX', 'p': G, 'updatedAt': ARM}))
        self.assertIsNone(ma.parse_metric_alert('u', 'a', {'active': True, 'metric': 'gex_cross', 'symbol': 'SPX', 'p': G}))   # not armed
        self.assertIsNone(al('gex_cross', G, sym='S P X'))

    def test_limit(self):
        alerts = [al('gex_cross', {'level': 'pin'}, i=i) for i in range(30)] + [al('gex_cross', {'level': 'pin'}, i=1, uid='u2')]
        self.assertEqual(len(ma.limit_per_member(alerts)), 21)


class Snapshot(unittest.TestCase):
    def test_values(self):
        x = v(1, 7380)
        self.assertEqual(x['levels'], {'call_wall': 7425, 'put_wall': 7350, 'gamma_flip': 7400, 'pin': 7380})
        self.assertEqual(x['em']['s'], [7326, 7426])
        self.assertEqual(x['em']['w'], [7200, 7550])
        self.assertEqual(x['nodes'], [7350, 7400, 7425])

    def run_seq(self, a, seq, now0=1000, step=120):
        e, out = None, []
        for i, s in enumerate(seq):
            t, e = ma.eval_snapshot(a, s, e, now0 + i * step)
            out.append(t)
        return out

    def test_cross_flip(self):
        a = al('gex_cross', {'level': 'gamma_flip'})
        out = self.run_seq(a, [v(1, 7390), v(1, 7410), v(2, 7395), v(3, 7410)])
        self.assertIsNone(out[0])                 # first look: baseline
        self.assertIsNone(out[1])                 # same build: no new update
        self.assertIsNone(out[2])                 # 7390 -> 7395 does not reach 7400
        self.assertIn('SPX crossed above its Flip Line (zero gamma) at 7,400 (price 7,410.00).', out[3])
        self.assertTrue(out[3].endswith(ma.FOOTER))

    def test_cross_dir_and_baseline(self):
        a = al('gex_cross', {'level': 'call_wall', 'dir': 'down'})
        out = self.run_seq(a, [v(1, 7430), v(2, 7440), v(3, 7420), v(4, 7430)])
        self.assertEqual([bool(x) for x in out], [False, False, True, False])
        self.assertIn('below its Call Ceiling', out[2])

    def test_cross_em_and_nodes(self):
        a = al('gex_cross', {'level': 'em_high', 'range': 'w'}, freq='every')
        self.assertIn('expected move high (weekly) at 7,550', self.run_seq(a, [v(1, 7540), v(2, 7551)])[1])
        a = al('gex_cross', {'level': 'any_node'})
        t = self.run_seq(a, [v(1, 7340), v(2, 7410)])[1]
        self.assertIn('Gamma Node at 7,350 and 1 more', t)

    def test_every_cooldown(self):
        a = al('gex_cross', {'level': 'gamma_flip'}, freq='every')
        out = self.run_seq(a, [v(1, 7390), v(2, 7410), v(3, 7390), v(4, 7410)], step=120)
        self.assertEqual([bool(x) for x in out], [False, True, False, False])    # 2nd and 3rd crosses inside 15 min
        out = self.run_seq(a, [v(1, 7390), v(2, 7410), v(3, 7390)], step=1000)
        self.assertEqual([bool(x) for x in out], [False, True, True])

    def test_rearm_on_edit(self):
        a = al('gex_cross', {'level': 'gamma_flip'})
        _, e = ma.eval_snapshot(a, v(1, 7390), None, 0)
        b = al('gex_cross', {'level': 'gamma_flip'}, armed='2026-11-07T13:00:00.000Z')
        t, e = ma.eval_snapshot(b, v(2, 7410), e, 1)
        self.assertIsNone(t)                      # edited alert: a new baseline, the move before the edit never fires
        self.assertEqual(e['v'], b['armed'])

    def test_copy_rules(self):
        import zoro_alerts as za
        texts = []
        for m, p, seq in [('gex_cross', {'level': 'gamma_flip'}, [v(1, 7390), v(2, 7410)]), ('gex_cross', {'level': 'any_node'}, [v(1, 7300), v(2, 7450)]),
                          ('gex_cross', {'level': 'em_low', 'range': 's', 'dir': 'down'}, [v(1, 7330), v(2, 7320)])]:
            texts.append(self.run_seq(al(m, p), seq)[1])
        a = al('funding', {'venue': 'okx', 'dir': 'above', 'value': 0.01}, sym='BTC')
        _, e = ma.eval_crypto(a, {'funding': 0.005, 'hours': 8}, [], None, 0)
        texts.append(ma.eval_crypto(a, {'funding': 0.02, 'hours': 8}, [], e, 1)[0])
        for t in texts:
            self.assertTrue(t)
            self.assertEqual(za.banned_words(t.replace(ma.FOOTER, '')), [], t)


class Crypto(unittest.TestCase):
    def test_parse_hl(self):
        r = [{'universe': [{'name': 'BTC'}, {'name': 'ETH'}]}, [{'funding': '0.0000125', 'openInterest': '41214.6'}, {'funding': 'x', 'openInterest': '1'}]]
        self.assertEqual(ma.parse_hl(r), {'BTC': {'funding': 0.00125, 'oi': 41214.6, 'hours': 1.0}})
        self.assertEqual(ma.parse_hl(None), {})

    def test_parse_okx(self):
        f = {'data': [{'instId': 'BTC-USDT-SWAP', 'fundingRate': '0.0000779', 'fundingTime': '1794096000000', 'nextFundingTime': '1794124800000'},
                      {'instId': 'BTC-USD-SWAP', 'fundingRate': '0.1', 'fundingTime': '0', 'nextFundingTime': '1'}]}
        o = {'data': [{'instId': 'BTC-USDT-SWAP', 'oiCcy': '34330.66'}]}
        r = ma.parse_okx(f, o)
        self.assertEqual(list(r), ['BTC'])
        self.assertAlmostEqual(r['BTC']['funding'], 0.00779)
        self.assertEqual((r['BTC']['hours'], r['BTC']['oi']), (8.0, 34330.66))

    def test_funding(self):
        a = al('funding', {'venue': 'hl', 'dir': 'below', 'value': -0.01}, sym='ETH', freq='every')
        e, out = None, []
        for i, f in enumerate([0.001, -0.02, -0.03, 0.0, -0.02]):
            t, e = ma.eval_crypto(a, {'funding': f, 'hours': 1.0}, [], e, i * 1000)
            out.append(t)
        self.assertEqual([bool(x) for x in out], [False, True, False, False, True])
        self.assertIn('ETH funding on Hyperliquid moved below -0.01%, now -0.0200% per 1 h.', out[1])

    def test_oi_change(self):
        a = al('oi_change', {'venue': 'okx', 'mins': 15, 'dir': 'up', 'value': 2}, sym='BTC')
        ring = [[0, 100.0], [300, 100.5], [600, 101.0]]
        self.assertEqual(ma.oi_then(ring, 900, 15), (0, 100.0))
        self.assertIsNone(ma.oi_then(ring, 2000, 15))                     # no sample near 15 min ago: unknown, never a guess
        t, e = ma.eval_crypto(a, {'oi': 103.0}, ring, None, 900)
        self.assertIsNone(t)                                               # fresh entry: baseline (true at arming = held)
        t, e = ma.eval_crypto(a, {'oi': 101.0}, ring, e, 960)              # +1%: resets
        self.assertIsNone(t)
        t, e = ma.eval_crypto(a, {'oi': 103.0}, ring, e, 900)
        self.assertIn('BTC open interest on OKX rose 3.0% in 15 min (now 103 BTC).', t)
        b = al('oi_change', {'venue': 'okx', 'mins': 15, 'dir': 'down', 'value': 2}, sym='BTC')
        t, _ = ma.eval_crypto(b, {'oi': 103.0}, ring, {'v': b['armed'], 'held': False, 'last': 0}, 900)
        self.assertIsNone(t)


class Plan(unittest.TestCase):
    def test_pro(self):
        paid = {'pro', 'elite'}
        self.assertTrue(ma.is_active_pro({'plan': 'Pro'}, paid, 0))
        self.assertTrue(ma.is_active_pro({'demo': True}, paid, 0))
        self.assertFalse(ma.is_active_pro({'plan': 'free'}, paid, 0))
        self.assertFalse(ma.is_active_pro({'plan': 'pro', 'subscriptionStatus': 'expired'}, paid, 0))
        self.assertFalse(ma.is_active_pro({'plan': 'pro', 'paidThroughMillis': 1000}, paid, 1000 + ma.GRACE_MS + 1))
        self.assertTrue(ma.is_active_pro({'plan': 'pro', 'paidThroughMillis': 1000}, paid, 1000 + ma.GRACE_MS - 1))
        self.assertTrue(ma.is_active_pro({'plan': 'pro', 'foundingMember': True, 'paidThroughMillis': 1}, paid, 10 ** 13))
        self.assertFalse(ma.is_active_pro(None, paid, 0))


class StubFs:
    class HttpErr(Exception):
        def __init__(self, status):
            self.status = status

    def __init__(self, docs):
        self.docs = docs
        self.patched = []

    def get_doc(self, path):
        return copy.deepcopy(self.docs.get(path)), 'ut'

    def patch_doc(self, path, data, ut):
        self.patched.append(path)
        self.docs[path].update(active=False)

    def now_ts(self):
        return 'now'


class Round(unittest.TestCase):
    def deps(self, alerts, pro_uids, summaries, crypto=None):
        fs = StubFs({'students/%s/metricAlerts/%s' % (a['uid'], a['aid']): {'active': True, 'metric': a['metric'], 'updatedAt': a['armed']}
                     for a in alerts})
        d = ml.Deps(fs, None, lambda m: None, notify=lambda data, what: sent.append(data))
        sent = []
        d.sent = sent
        d.is_pro = lambda uid, now: uid in pro_uids
        d.summary = lambda sym: summaries[sym].pop(0) if len(summaries[sym]) > 1 else summaries[sym][0]
        d.crypto = lambda ven: (crypto or {})[ven].pop(0)
        return d

    def test_round(self):
        a1 = al('gex_cross', {'level': 'gamma_flip'}, uid='pro', i=1)
        a2 = al('gex_cross', {'level': 'gamma_flip'}, uid='free', i=2)
        a3 = al('funding', {'venue': 'okx', 'dir': 'above', 'value': 0.01}, sym='BTC', uid='free', i=3)
        alerts = {a['id']: a for a in (a1, a2, a3)}
        d = self.deps(alerts.values(), {'pro'}, {'SPX': [summ(1, 7390), summ(2, 7410)]},
                      {'okx': [{'BTC': {'funding': 0.005, 'oi': 1, 'hours': 8}}, {'BTC': {'funding': 0.02, 'oi': 1, 'hours': 8}},
                               {'BTC': {'funding': 0.03, 'oi': 1, 'hours': 8}}]})
        st, cache = {'alerts': {}, 'rings': {}}, {}
        self.assertEqual(ml.metric_round(1000, st, alerts, d, cache), [])
        self.assertEqual(ml.stat['locked'], 1)                              # the free member's GEX alert never runs
        out = ml.metric_round(1200, st, alerts, d, cache)
        self.assertEqual(sorted((a['aid'], r) for a, _, r in out), [('a1', 'fired'), ('a3', 'fired')])
        self.assertEqual([x['type'] for x in d.sent], ['metric_alert', 'metric_alert'])
        self.assertEqual(sorted(d.fs.patched), sorted(['students/pro/metricAlerts/a1', 'students/free/metricAlerts/a3']))
        json.dumps(st)                                                      # state is plain JSON (saved to disk)
        # once alerts were claimed: a third round with the same data sends nothing (stale docs)
        self.assertEqual([r for _, _, r in ml.metric_round(1400, st, alerts, d, cache)], [])

    def test_fire_failure_retries(self):
        a = al('gex_cross', {'level': 'gamma_flip'}, uid='pro')
        alerts = {a['id']: a}
        d = self.deps([a], {'pro'}, {'SPX': [summ(1, 7390), summ(2, 7410)]})
        st, cache = {'alerts': {}, 'rings': {}}, {}
        ml.metric_round(0, st, alerts, d, cache)
        d.fire = lambda a, t: (_ for _ in ()).throw(RuntimeError('down'))
        self.assertEqual([r for _, _, r in ml.metric_round(200, st, alerts, d, cache)], ['error'])
        d.fire = lambda a, t: 'fired'
        self.assertEqual([r for _, _, r in ml.metric_round(400, st, alerts, d, cache)], ['fired'])   # same update, sent now

    def test_stale_edit(self):
        a = al('gex_cross', {'level': 'pin'}, uid='pro')
        d = self.deps([a], {'pro'}, {'SPX': [summ(1, 1)]})
        d.fs.docs['students/pro/metricAlerts/a1']['updatedAt'] = 'later'
        self.assertEqual(d.fire(a, 'x'), 'stale')
        self.assertEqual(d.sent, [])


if __name__ == '__main__':
    unittest.main()
