#!/usr/bin/env python3
"""Dark pool print alerts (workers/alert-engine/dp_alerts.py + the dp_round loop in alert_engine.py).
   python3 tools/tests/dp-alerts-test.py
Matching (size, zone, once/every, dedupe across feeder updates, grouping) on synthetic rows, then a DRY RUN of the engine loop
against the saved real TSLA part (tools/fixtures/dp/dp_tsla.json.gz, book-recorder /scan?part=dp_tsla, x-scan-t 1794064769):
no network, no Firestore (fire is a stub)."""
import copy, gzip, json, os, re, sys, unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'workers', 'alert-engine'))
import dp_alerts as dpa  # noqa: E402

T0 = 1794000000                     # a feeder version time (epoch s)
MS = 1000


def iso(sec):
    import time
    return time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(sec))


def al(i=1, sym='TSLA', mn=5e6, lo=None, hi=None, freq='every', armed=T0 - 3600, uid='u1'):
    d = {'active': True, 'symbol': sym, 'min': mn, 'freq': freq, 'updatedAt': iso(armed)}
    if lo is not None:
        d['lo'], d['hi'] = lo, hi
    return dpa.parse_dp_alert(uid, 'a%d' % i, d)


def row(t, p, s, c='@T'):
    return [t * MS, p, s, c]


def part(t, rows):
    return {'v': 1, 't': t, 'sym': 'TSLA', 'min': 1e6, 'days': ['2026-11-06'], 'cols': ['t', 'p', 's', 'c'], 'rows': rows}


class Parse(unittest.TestCase):
    def test_parse(self):
        a = al()
        self.assertEqual((a['symbol'], a['min'], a['zone'], a['freq']), ('TSLA', 5e6, None, 'every'))
        self.assertEqual(al(lo=400, hi=410)['zone'], (400.0, 410.0))
        self.assertIsNone(al(sym='ES'))                      # not one of the 29
        self.assertIsNone(al(sym='BTC'))
        self.assertIsNone(al(mn=5e5))                        # under $1M
        self.assertIsNone(al(mn='5000000'))
        self.assertIsNone(al(lo=410, hi=400))                # bad zone
        self.assertIsNone(al(lo=400, hi=None))
        self.assertIsNone(dpa.parse_dp_alert('u', 'a', {'active': False, 'symbol': 'TSLA', 'min': 1e6, 'updatedAt': iso(T0)}))
        self.assertIsNone(dpa.parse_dp_alert('u', 'a', {'active': True, 'symbol': 'TSLA', 'min': 1e6}))   # no updatedAt
        self.assertEqual(al(sym='tsla')['symbol'], 'TSLA')
        self.assertEqual(al(freq='x')['freq'], 'once')
        self.assertEqual(len(dpa.DP_SYMS), 29)

    def test_cap_20(self):
        many = [al(i=i) for i in range(25)] + [al(i=1, uid='u2')]
        kept = dpa.limit_per_member(many)
        self.assertEqual(sum(1 for a in kept if a['uid'] == 'u1'), 20)
        self.assertEqual(sum(1 for a in kept if a['uid'] == 'u2'), 1)

    def test_ts(self):
        self.assertEqual(dpa.ts_ms('2026-11-07T15:00:00.25Z') % 1000, 250)
        self.assertEqual(dpa.ts_ms('junk'), 0)

    def test_same_list_as_feeder_and_worker(self):
        feeder = open(os.path.join(ROOT, 'workers/book-recorder/dp-feeder/dp_feeder.py')).read()
        st = re.search(r'STOCKS = \[(.*?)\]', feeder, re.S).group(1)
        self.assertEqual(tuple(re.findall(r"'[A-Z]+:([A-Z]+)'", st)), dpa.DP_SYMS)
        scan = open(os.path.join(ROOT, 'workers/book-recorder/src/scan.js')).read()
        ws = re.search(r'DP_SYMS = \[(.*?)\]', scan, re.S).group(1)
        self.assertEqual(tuple(re.findall(r"'([A-Z]+)'", ws)), dpa.DP_SYMS)


class Match(unittest.TestCase):
    def run_seq(self, a, versions):
        """versions: [(t, rows)] -> list of found lists, one per version."""
        entry, prev, out = None, None, []
        for t, rows in versions:
            found, entry = dpa.check(a, dpa.prints(part(t, rows)), t, prev, entry)
            out.append(found)
            prev = t
        return out

    def test_size_and_baseline(self):
        a = al(mn=5e6, armed=T0 + 60)              # armed after version T0
        old = [row(T0 - 500, 400, 20000)]           # $8M already on screen when the alert was set
        new = old + [row(T0 + 3000, 401, 10000), row(T0 + 3100, 402, 30000)]   # $4.01M (too small), $12.06M
        f = self.run_seq(a, [(T0, old), (T0 + 7200, new)])
        self.assertEqual(f[0], [])                  # baseline: nothing fires at set time
        self.assertEqual([x['p'] for x in f[1]], [402.0])

    def test_zone(self):
        a = al(mn=1e6, lo=400, hi=401, armed=T0 + 60)
        new = [row(T0 + 10, 399.99, 10000), row(T0 + 20, 400, 10000), row(T0 + 30, 401, 10000), row(T0 + 40, 401.01, 10000)]
        f = self.run_seq(a, [(T0, []), (T0 + 7200, new)])
        self.assertEqual([x['p'] for x in f[1]], [400.0, 401.0])   # inclusive edges

    def test_dedupe_across_updates(self):
        a = al(mn=1e6, armed=T0 + 60)
        r1 = [row(T0 + 100, 400, 5000)]
        r2 = r1 + [row(T0 + 7300, 401, 5000)]
        r3 = r2                                      # next update: nothing new
        f = self.run_seq(a, [(T0, []), (T0 + 7200, r1), (T0 + 14400, r2), (T0 + 21600, r3)])
        self.assertEqual([len(x) for x in f], [0, 1, 1, 0])
        self.assertEqual(f[2][0]['p'], 401.0)

    def test_new_version_seen_first_after_alert(self):
        # alert set before the engine sees any version: prints older than the alert's version are not new
        a = al(mn=1e6, armed=T0 + 60)
        f, e = dpa.check(a, dpa.prints(part(T0 + 7200, [row(T0 - 100, 400, 5000), row(T0 + 500, 400, 5000)])), T0 + 7200, T0, None)
        self.assertEqual([x['t'] for x in f], [(T0 + 500) * MS])   # only the print traded after the previous version
        f2, _ = dpa.check(a, dpa.prints(part(T0 + 7200, [row(T0 + 500, 400, 5000)])), T0 + 7200, None, None)
        self.assertEqual(f2, [])                    # first start, no previous version known: baseline, no flood

    def test_rearm_on_edit(self):
        a = al(mn=1e6, armed=T0 + 60)
        rows = [row(T0 + 100, 400, 5000)]
        f, e = dpa.check(a, dpa.prints(part(T0 + 7200, rows)), T0 + 7200, T0, None)
        self.assertEqual(len(f), 1)
        b = dict(a, armed=(T0 + 8000) * MS)       # edited / resumed later: new baseline, the old print does not re-fire
        f, e = dpa.check(b, dpa.prints(part(T0 + 7200, rows)), T0 + 7200, T0, e)
        self.assertEqual(f, [])

    def test_off_price_left_out(self):
        a = al(mn=1e6, armed=T0 + 60)
        rows = [row(T0 + 100, 400, 5000, '@TB'), row(T0 + 110, 400, 5000, '@7'), row(T0 + 120, 400, 5000, '@T')]
        f = self.run_seq(a, [(T0, []), (T0 + 7200, rows)])
        self.assertEqual(len(f[1]), 1)

    def test_grouping_and_text(self):
        a = al(mn=10e6, armed=T0 + 60)
        three = [row(T0 + 100 + i, 412.3, 30000 + i) for i in range(3)]
        tx = dpa.texts(a, dpa.prints(part(T0, three)))
        self.assertEqual(len(tx), 3)                # 3 or fewer: one each
        self.assertIn('TSLA dark pool print: $12M at 412.30 (30,000 shares)', tx[0])
        five = three + [row(T0 + 200, 412.3, 206000), row(T0 + 210, 410, 30000)]
        tx = dpa.texts(a, dpa.prints(part(T0, five)))
        self.assertEqual(len(tx), 1)
        self.assertTrue(tx[0].startswith('TSLA: 5 dark pool prints \u2265 $10M, biggest $85M at 412.30.'), tx[0])
        z = dpa.texts(al(mn=10e6, lo=400, hi=420), dpa.prints(part(T0, five)))[0]
        self.assertIn('in your 400.00 to 420.00 zone', z)
        # Only once: always one push (2 matches -> grouped)
        once = dpa.texts(al(mn=10e6, freq='once'), dpa.prints(part(T0, three[:2])))
        self.assertEqual(len(once), 1)
        self.assertIn('2 dark pool prints', once[0])
        for t in tx + once + [z]:
            self.assertTrue(t.endswith('Education only. Not financial advice.'))
            self.assertNotRegex(t.lower(), r'\blive\b|real[- ]?time|delayed|insight|finra|bullish|bearish|buy|sell')
            self.assertLessEqual(len(t), 480)

    def test_usd(self):
        self.assertEqual([dpa.usd(v) for v in (1.2e6, 1e6, 40e6, 1.1e9, 25e9)], ['$1.2M', '$1M', '$40M', '$1.1B', '$25B'])

    def test_link(self):
        self.assertEqual(dpa.link('SPY'), 'charts.html?symbol=SPY')
        self.assertEqual(dpa.link('TSLA'), 'charts.html')

    def test_prune(self):
        st = {'u1/a1': {'v': 1, 'sent': {'k1': 0, 'k2': 10 ** 13}}, 'gone': {'v': 1, 'sent': {}}}
        dpa.prune(st, {'u1/a1'}, 10 ** 13)
        self.assertEqual(list(st), ['u1/a1'])
        self.assertEqual(list(st['u1/a1']['sent']), ['k2'])


class EngineDryRun(unittest.TestCase):
    """dp_round from alert_engine.py with the saved real TSLA part: version A = the part minus its last two trading days,
    version B = the full part (the feeder adding sessions; 2026-11-06 alone had no $10M+ TSLA print). Fire is a stub (dry: nothing written)."""
    @classmethod
    def setUpClass(cls):
        import alert_engine as ae      # imports only; main() is not run
        cls.ae = ae
        cls.full = json.load(gzip.open(os.path.join(ROOT, 'tools/fixtures/dp/dp_tsla.json.gz')))
        last_day = cls.full['days'][-2]
        from datetime import datetime
        from zoneinfo import ZoneInfo
        cut = datetime.fromisoformat(last_day + 'T00:00:00').replace(tzinfo=ZoneInfo('America/New_York')).timestamp() * 1000
        cls.A = dict(cls.full, t=int(cut / 1000) - 3600, rows=[r for r in cls.full['rows'] if r[0] < cut])
        cls.B = cls.full
        cls.new_rows = [r for r in cls.full['rows'] if r[0] >= cut]

    def test_loop(self):
        ae, A, B = self.ae, self.A, self.B
        self.assertGreater(len(self.new_rows), 10)
        served = {'v': A}
        calls = []

        def get_part(sym, known_t=None):
            self.assertEqual(sym, 'TSLA')
            p = served['v']
            calls.append(known_t)
            return (p['t'], None) if known_t == p['t'] else (p['t'], copy.deepcopy(p))
        fired = []

        def fire(a, tx):
            fired.append((a['aid'], tx))
            return 'dry'
        armed = A['t'] + 600                 # the member sets the alerts while version A is on screen
        alerts = {}
        for i, (mn, zone, freq) in enumerate([(10e6, None, 'every'), (1e6, None, 'every'), (5e6, None, 'once'), (1e6, (1, 2), 'every')]):
            d = {'active': True, 'symbol': 'TSLA', 'min': mn, 'freq': freq, 'updatedAt': iso(armed)}
            if zone:
                d['lo'], d['hi'] = zone
            a = dpa.parse_dp_alert('u1', 'dry%d' % i, d)
            alerts[a['id']] = a
        st = {'parts': {}, 'alerts': {}}
        ae.dp_round(armed + 60, st, alerts, get_part, fire)                       # first look at A: baseline
        self.assertEqual(fired, [])
        ae.dp_round(armed + 180, st, alerts, get_part, fire)                      # A again: header says same t -> skipped
        self.assertEqual(calls[-1], A['t'])
        self.assertEqual(fired, [])
        served['v'] = B
        ae.dp_round(armed + 7200, st, alerts, get_part, fire)                     # feeder update: the new session's prints
        got = {aid: tx for aid, tx in fired}
        want = lambda mn: [x for x in dpa.prints(B) if x['t'] >= dpa.prints({'rows': self.new_rows})[0]['t'] and x['v'] >= mn]
        n10, n1, n5 = len(want(10e6)), len(want(1e6)), len(want(5e6))
        print('\n  real TSLA part: %d rows; sessions from %s add %d prints >= $1M, %d >= $5M, %d >= $10M' % (
            len(B['rows']), B['days'][-2], n1, n5, n10))
        for aid, tx in fired:
            print('  %s -> %d push(es): %s' % (aid, len(tx), tx[0][:150]))
        self.assertTrue(n10 > 3 and n1 > 3)
        self.assertEqual(len(got['dry0']), 1)                                    # > 3 -> one grouped push
        self.assertIn('TSLA: %d dark pool prints \u2265 $10M, biggest' % n10, got['dry0'][0])
        self.assertIn('TSLA: %d dark pool prints \u2265 $1M' % n1, got['dry1'][0])
        self.assertEqual(len(got['dry2']), 1)                                    # once: one push
        self.assertNotIn('dry3', got)                                            # zone 1-2: nothing
        before = len(fired)
        ae.dp_round(armed + 7320, st, alerts, get_part, fire)                     # same version again: nothing re-sent
        served['v'] = dict(B, t=B['t'] + 7200)                                    # next update, same rows: nothing new
        ae.dp_round(armed + 14400, st, alerts, get_part, fire)
        self.assertEqual(len(fired), before)
        json.dumps(st)                                                            # state file is plain JSON


if __name__ == '__main__':
    unittest.main(verbosity=1)
