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
        self.assertEqual(d['cols'], ['t', 'p', 's', 'c'])
        self.assertEqual(d['sym'], 'SPY')
        self.assertEqual([r[0] for r in d['rows']], sorted(r[0] for r in d['rows']))
        self.assertTrue(all(len(r) == 4 for r in d['rows']))

    def test_session_dates_weekdays(self):
        from datetime import datetime
        d = f.session_dates(datetime(2026, 11, 7, 12, tzinfo=f.NY))   # Saturday
        self.assertEqual(d, ['2026-11-06', '2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02'])


    def test_daily_cap_stops_calls(self):
        import tempfile, unittest.mock as m
        d = tempfile.mkdtemp()
        calls = []
        with m.patch.object(f, 'STATE', os.path.join(d, 's.json')), m.patch.object(f, 'DAILY_CAP', 7), \
             m.patch.object(f, 'fetch_rows', lambda code, key, params: (calls.append(params) or ([], 0))), \
             m.patch.dict(os.environ, {'INSIGHTSENTRY_WEBSOCKET_API_KEY': 'x', 'BOOK_RECORDER_URL': '', 'BOOK_INGEST_SECRET': ''}), \
             m.patch.object(sys, 'argv', ['dp_feeder.py', '--dry']), m.patch.object(f, 'log', lambda *a: None):
            f.main()
            self.assertEqual(len(calls), 7)            # first run backfills; the cap stops it at 7
            f.main()
            self.assertEqual(len(calls), 7)            # same New York day: no more calls
            st = json.load(open(os.path.join(d, 's.json')))
            self.assertEqual(st['_calls']['n'], 7)


if __name__ == '__main__':
    unittest.main()
