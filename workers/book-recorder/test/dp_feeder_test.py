#!/usr/bin/env python3
"""Unit tests for dp-feeder/dp_feeder.py (stream parse, off-exchange filter, $ threshold, merge, payload). Uses a real 40-row slice of the
SPY 2026-11-06 SIP trades reply saved in test/fixtures/dp-spy-trades-sample.json.  python3 workers/book-recorder/test/dp_feeder_test.py"""
import gzip, json, os, sys, unittest
H = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(H, '..', 'dp-feeder'))
import dp_feeder as f

RAW = open(os.path.join(H, 'fixtures', 'dp-spy-trades-sample.json')).read()


def chunks(s, n):
    return (s[i:i + n] for i in range(0, len(s), n))


class T(unittest.TestCase):
    def test_stream_any_chunk_size(self):
        whole = json.loads(RAW)['series']
        for n in (1, 7, 64, 4096, len(RAW)):
            objs = list(f.iter_objects(chunks(RAW, n)))
            self.assertEqual(len(objs), len(whole), n)
            self.assertEqual(json.loads(objs[-1]), whole[-1])

    def test_only_offexchange_over_threshold(self):
        rows, n = f.filter_stream(chunks(RAW, 333))
        whole = json.loads(RAW)['series']
        want = [o for o in whole if o['trade_exchange'] == 'FINRA_ADF' and o['close'] * o['volume'] >= 1e6]
        self.assertEqual(n, len(whole))
        self.assertEqual(len(rows), len(want))
        self.assertTrue(len(want) >= 5)
        self.assertTrue(all(r[1] * r[2] >= 1e6 for r in rows))
        self.assertEqual(rows[0][0], want[0]['us'] // 1000)

    def test_keep_row(self):
        o = {'time': 1793966400.219, 'us': 1793966400219456, 'close': 735.52, 'volume': 27817.0, 'trade_id': 7, 'trade_exchange': 'FINRA_ADF', 'trade_conditions': [' ', 'T']}
        self.assertEqual(f.keep_row(o)[:4], [1793966400219, 735.52, 27817, 'T'])
        self.assertIsNone(f.keep_row(dict(o, trade_exchange='NYSE_ARCA')))
        self.assertIsNone(f.keep_row(dict(o, volume=1000.0)))          # $735K < $1M
        self.assertIsNotNone(f.keep_row(dict(o, volume=1360.0)))       # $1.0003M
        self.assertIsNone(f.keep_row(dict(o, close=None)))

    def test_merge_dedupes_and_drops_old_days(self):
        st = {}
        r1 = [1793966400219, 735.52, 27817, 'T', 'a']
        old = [1793366400219, 700.0, 27817, '', 'b']                  # 2026-10-30, outside keep
        self.assertEqual(f.merge(st, [r1, r1, old], {'2026-11-06'}), 2)
        self.assertEqual(list(st['rows']), ['a'])
        self.assertEqual(f.merge(st, [r1], {'2026-11-06'}), 0)

    def test_payload_shape(self):
        rows, _ = f.filter_stream([RAW])
        st = {'done': ['2026-11-06']}
        f.merge(st, rows, {'2026-11-06'})
        d = json.loads(gzip.decompress(f.part_body('SPY', 'AMEX:SPY', st, 1794050000)))
        self.assertEqual(d['cols'], ['t', 'p', 's', 'c', 'd'])
        self.assertEqual(d['v'], 2)
        self.assertEqual(d['sym'], 'SPY')
        self.assertEqual([r[0] for r in d['rows']], sorted(r[0] for r in d['rows']))
        self.assertTrue(all(len(r) == 5 and r[4] in ('b', 's', 'u', 'l') for r in d['rows']))
        # rows stored before DP-DETAIL (4 columns) still go out, with an empty side
        st['rows']['old'] = [1793966400000, 735.0, 2000, '']
        d = json.loads(gzip.decompress(f.part_body('SPY', 'AMEX:SPY', st, 1794050000)))
        self.assertIn([1793966400000, 735.0, 2000, '', ''], d['rows'])

    def test_side_estimate(self):
        e = f.SideEstimator(5, 1)
        for i, p in enumerate((100.00, 100.02, 100.04, 100.02)):
            e.lit(1000 + i * 1000, p, 100)          # lit 100.00..100.04, VWAP 100.02
        self.assertEqual(e.side(4500, 100.04), 'b')   # at the lit high, 2 ticks over VWAP
        self.assertEqual(e.side(4500, 100.05), 'b')
        self.assertEqual(e.side(4500, 100.00), 's')   # at the lit low
        self.assertEqual(e.side(4500, 100.02), 'u')   # in the middle
        self.assertEqual(e.side(4500, 100.04, 'Z'), 'l')   # late report: time is the report time
        self.assertEqual(e.side(4500, 100.04, 'TB'), 'u')  # average price: not a market price
        self.assertEqual(e.side(20000, 100.04), 'u')  # no lit trade in the last 5 s
        e2 = f.SideEstimator(5, 1)
        e2.lit(1000, 50.0, 10); e2.lit(1100, 50.0, 10)
        self.assertEqual(e2.side(1200, 50.0), 'u')    # flat tape: at the high AND the low, never a side
        self.assertTrue(f.lit_ok('NYSE_ARCA', 'FI') and not f.lit_ok('NYSE_ARCA', 'M') and not f.lit_ok('F', '') and not f.lit_ok('FINRA_ADF', ''))

    def test_rows_carry_side_and_day_stats(self):
        stats = {}
        rows, n = f.filter_stream(chunks(RAW, 500), stats=stats)
        self.assertTrue(all(len(r) == 6 and r[5] in 'bsul' for r in rows))
        whole = json.loads(RAW)['series']
        vol = sum(o['volume'] for o in whole if not set(''.join(o['trade_conditions'])) & set('MQ9'))
        self.assertEqual(sum(e[0] for e in stats.values()), vol)
        f.filter_stream(chunks(RAW, 500), stats=stats)   # same trades again (overlapping window): not counted twice
        self.assertEqual(sum(e[0] for e in stats.values()), vol)

    def test_merge_upgrades_old_rows_only_once(self):
        st = {'rows': {'a': [1793966400219, 735.52, 27817, 'T']}}           # stored before DP-DETAIL
        self.assertEqual(f.merge(st, [[1793966400219, 735.52, 27817, 'T', 'a', 'b']], {'2026-11-06'}), 0)
        self.assertEqual(st['rows']['a'], [1793966400219, 735.52, 27817, 'T', 'b'])
        f.merge(st, [[1793966400219, 735.52, 27817, 'T', 'a', 's']], {'2026-11-06'})
        self.assertEqual(st['rows']['a'][4], 'b')                          # first estimate kept (full-day context)

    def test_session_dates_weekdays(self):
        from datetime import datetime
        d = f.session_dates(datetime(2026, 11, 7, 12, tzinfo=f.NY))   # Saturday
        self.assertEqual(d, ['2026-11-06', '2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02'])


    def test_daily_cap_stops_calls(self):
        import tempfile, unittest.mock as m
        d = tempfile.mkdtemp()
        calls = []
        with m.patch.object(f, 'STATE', os.path.join(d, 's.json')), m.patch.object(f, 'DAILY_CAP', 7), \
             m.patch.object(f, 'fetch_rows', lambda code, key, params, stats=None: (calls.append(params) or ([], 0, False))), \
             m.patch.dict(os.environ, {'INSIGHTSENTRY_WEBSOCKET_API_KEY': 'x', 'BOOK_RECORDER_URL': '', 'BOOK_INGEST_SECRET': ''}), \
             m.patch.object(sys, 'argv', ['dp_feeder.py', '--dry']), m.patch.object(f, 'log', lambda *a: None):
            f.main()
            self.assertEqual(len(calls), 7)            # first run backfills; the cap stops it at 7
            f.main()
            self.assertEqual(len(calls), 7)            # same New York day: no more calls
            st = json.load(open(os.path.join(d, 's.json')))
            self.assertEqual(st['_calls']['n'], 7)

    def run_main(self, fetch, cap=320, argv=('dp_feeder.py', '--dry')):
        """main() on a temp state, Saturday 2026-11-07 12:00 NY (5 past sessions to backfill). Returns (log lines, posts, state)."""
        import tempfile, unittest.mock as m
        from datetime import datetime
        d = tempfile.mkdtemp()
        logs, posts = [], []
        sat = datetime(2026, 11, 7, 12, tzinfo=f.NY).timestamp()
        with m.patch.object(f, 'STATE', os.path.join(d, 's.json')), m.patch.object(f, 'DAILY_CAP', cap), \
             m.patch.object(f, 'fetch_rows', fetch), m.patch.object(f, 'SLEEP', lambda s: logs.append('sleep %d' % s)), \
             m.patch.object(f, 'post', lambda url, sec, part, body: (posts.append((part, json.loads(gzip.decompress(body)))) or (200, 'stored'))), \
             m.patch.object(f.time, 'time', lambda: sat), \
             m.patch.dict(os.environ, {'INSIGHTSENTRY_WEBSOCKET_API_KEY': 'x', 'BOOK_RECORDER_URL': 'https://w', 'BOOK_INGEST_SECRET': 's'}), \
             m.patch.object(sys, 'argv', list(argv)), m.patch.object(f, 'log', logs.append):
            f.main()
            return logs, posts, json.load(open(os.path.join(d, 's.json')))

    def test_pending_day_retried_and_symbol_still_posted(self):
        # 2026-11-07: SPY 11-06 came back, 11-05 answered 503 data_pending -> the whole symbol failed and was never posted
        row = [1794000000000, 700.0, 10000, '', 'id1']         # 2026-11-06
        tries = {}

        def fetch(code, key, params, stats=None):
            k = (code, params['date']); tries[k] = tries.get(k, 0) + 1
            if params['date'] == '2026-11-05' and tries[k] == 1:
                raise f.Pending(45)
            return ([row] if params['date'] == '2026-11-06' else []), 10, False
        logs, posts, st = self.run_main(fetch, argv=('dp_feeder.py', 'SPY'))
        self.assertEqual(sum(tries.values()), 6)               # 5 days + 1 retry
        self.assertIn('sleep 45', logs)
        self.assertEqual(st['SPY']['done'], ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'])
        self.assertEqual(posts[0][0], 'dp_spy')                 # posted after the first pass (4 days), again after the retry
        self.assertEqual(len(posts[-1][1]['rows']), 1)
        self.assertEqual(len(posts[-1][1]['days']), 5)
        self.assertEqual(st['_calls']['n'], 6)

    def test_pending_gives_up_after_passes_within_cap(self):
        def fetch(code, key, params, stats=None):
            raise f.Pending(9999)
        logs, posts, st = self.run_main(fetch, argv=('dp_feeder.py', 'NVDA'))
        self.assertEqual(st['_calls']['n'], 5 * (1 + f.RETRY_PASSES))   # each pending day: first try + RETRY_PASSES
        self.assertIn('sleep %d' % f.MAX_WAIT_S, logs)                 # Retry-After capped
        self.assertEqual(st['NVDA']['done'], [])
        self.assertEqual([p[0] for p in posts], ['dp_nvda'] * (1 + f.RETRY_PASSES))
        self.assertTrue(any('still pending' in l for l in logs))
        logs, posts, st = self.run_main(fetch, cap=7, argv=('dp_feeder.py', 'NVDA'))
        self.assertEqual(st['_calls']['n'], 7)                          # the hard cap still wins

    def test_incomplete_day_not_marked_done(self):
        logs, posts, st = self.run_main(lambda code, key, params, stats=None: ([], 5, params['date'] == '2026-11-04'), argv=('dp_feeder.py', 'IWM'))
        self.assertNotIn('2026-11-04', st['IWM']['done'])
        self.assertEqual(len(st['IWM']['done']), 4)

    def test_incomplete_message_detected_in_stream(self):
        for n in (3, 50, 10 ** 6):
            meta = {}
            raw = RAW[:-1] + ',"message":"Data may be incomplete"}'
            rows, cnt = f.filter_stream(chunks(raw, n), meta=meta)
            self.assertTrue(meta.get('partial'), n)
            self.assertEqual(cnt, len(json.loads(RAW)['series']))
        meta = {}
        f.filter_stream(chunks(RAW, 64), meta=meta)
        self.assertFalse(meta.get('partial'))

    def test_post_time_is_fresh(self):
        logs, posts, st = self.run_main(lambda c, k, p, stats=None: ([], 1, False), argv=('dp_feeder.py', 'DIA'))
        from datetime import datetime
        self.assertEqual(posts[0][1]['t'], int(datetime(2026, 11, 7, 12, tzinfo=f.NY).timestamp()))


if __name__ == '__main__':
    unittest.main()
