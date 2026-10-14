#!/usr/bin/env python3
"""Unit tests for info-feeder/info_feeder.py (trimming, roll calendar, session). python3 workers/book-recorder/test/info_feeder_test.py"""
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'info-feeder'))
import info_feeder as f
from datetime import date, timedelta

def ymd(d): return d.strftime('%Y%m%d')

class T(unittest.TestCase):
    def test_contracts_future_only_sorted(self):
        t = date.today()
        c = {'contracts': [{'code': 'X:NQM', 'settlement_date': ymd(t + timedelta(90))}, {'code': 'X:NQOLD', 'settlement_date': ymd(t - timedelta(5))},
                           {'code': 'X:NQZ', 'settlement_date': ymd(t + timedelta(10))}]}
        r = f.trim_contracts(c)
        self.assertEqual([x['c'] for x in r], ['NQZ', 'NQM'])
    def test_session_keeps_only_upcoming_early_closes(self):
        t = date.today()
        s = {'timezone': 'America/Chicago', 'holidays': [ymd(t - timedelta(3)), ymd(t + timedelta(20))],
             'details': [{'session': '1700-1600', 'description': 'ETH', 'session_correction': [
                 {'start_hour': '1700', 'end_hour': '1215', 'dates': [ymd(t + timedelta(30)), ymd(t - timedelta(400))]},
                 {'start_hour': '1700', 'end_hour': '1600', 'dates': [ymd(t + timedelta(31))]}]}]}
        r = f.trim_session(s)
        self.assertEqual(r['hours'], '1700-1600')
        self.assertEqual([e['end'] for e in r['early']], ['1215'])
        self.assertEqual(r['hol'], [ymd(t + timedelta(20))])
    def test_fund_trim(self):
        r = f.trim_fund({'data': [{'id': 'market_cap_basic', 'value': 5e12}, {'id': 'earnings_release_next_trading_date_fq', 'value': 1793577600.0}, {'id': 'junk', 'value': 1}]})
        self.assertEqual(r, {'cap': 5e12, 'earnTs': 1793577600})
    def test_payload_small(self):
        import gzip, json
        d = json.loads(gzip.decompress(f.payload({'NQ': {'kind': 'fut', 'code': 'a'}}, 5)))
        self.assertEqual((d['v'], d['t']), (1, 5))

if __name__ == '__main__':
    unittest.main(verbosity=1)
