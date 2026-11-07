#!/usr/bin/env python3
"""Unit tests for hl-feeder/hlcore.py (aggregation, labels, tracked set, clustering).
   python3 workers/book-recorder/test/hl_feeder_test.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'hl-feeder'))
import hlcore  # noqa: E402

A = '0x' + 'a' * 40
B = '0x' + 'b' * 40
C = '0x' + 'c' * 40
T = 1794074100000


def tr(px, sz, side, buyer, seller, t=T + 1000, coin='BTC', tid=1):
    return {'coin': coin, 'px': str(px), 'sz': str(sz), 'side': side, 'time': t, 'tid': tid, 'users': [buyer, seller]}


class Agg(unittest.TestCase):
    def test_minute_aggregates(self):
        m = hlcore.MinuteAgg()
        m.add(tr(100, 2, 'B', A, B))          # A took 2 @100 (taker buy)
        m.add(tr(110, 1, 'A', A, C))          # C hit A's bid: A bought 1 @110 as maker
        m.add(tr(105, 1, 'B', B, C, t=T + 61000))   # next minute
        self.assertIsNone(m.add({'coin': 'BTC', 'px': 'x'}))
        c = m.m[T]['BTC']
        self.assertEqual(c['tot'][0], 2)
        self.assertAlmostEqual(c['tot'][2], 310)
        self.assertAlmostEqual(c['tot'][3], 200)   # taker buy notional
        self.assertAlmostEqual(c['tot'][4], 110)
        a = c['w'][A]
        self.assertEqual(a[:5], [3, 310, 0, 0, 2])
        self.assertAlmostEqual(a[5], 200)          # only the first was aggressive
        self.assertAlmostEqual(c['w'][C][6], 110)  # C was the aggressive seller
        done = m.pop_before(T + 60000)
        self.assertEqual([t for t, _ in done], [T])
        self.assertIn(T + 60000, m.m)

    def test_pack_top_and_others(self):
        m = hlcore.MinuteAgg()
        m.add(tr(100, 5, 'B', A, B))
        m.add(tr(100, 1, 'B', C, B))
        p = hlcore.pack(T, m.m[T], top=2)
        rows = p['c']['BTC']['r']
        self.assertEqual(p['w'][0], B)             # B sold 6 -> biggest
        self.assertEqual(rows[-1][0], -1)          # C summed into others
        self.assertAlmostEqual(sum(r[2] for r in rows), 600)   # buy notional kept
        self.assertAlmostEqual(sum(r[4] for r in rows), 600)   # = sell notional
        acc = hlcore.merge_into({}, p)
        self.assertIn('_others', acc['BTC']['w'])

    def test_big_fills(self):
        b = hlcore.BigFills()
        for i in range(4):     # one 4-fill taker order of 4 x $100k at the same timestamp
            b.add(tr(100000, 1, 'B', A, B, tid=i))
        out = b.flush(T + 10000)
        self.assertEqual(len(out), 2)              # buyer A and seller B both did $400k
        self.assertEqual(b.by_wallet[A][0][4], 400000)
        self.assertEqual(b.candidates(), [A, B] if b.by_wallet[A][0][4] >= b.by_wallet[B][0][4] else [B, A])
        b.flush(T + 25 * 3600000)
        self.assertEqual(b.by_wallet, {})          # 24 h window


LB = [
    {'ethAddress': A.upper().replace('0X', '0x'), 'accountValue': '2500000', 'displayName': 'Big Fund',
     'windowPerformances': [['month', {'vlm': '9000000000'}]]},
    {'ethAddress': B, 'accountValue': '50000', 'displayName': 'me@mail.com', 'windowPerformances': [['month', {'vlm': '10'}]]},
    {'ethAddress': C, 'accountValue': '10', 'displayName': None, 'windowPerformances': [['month', {'vlm': '0'}]]},
]
VAULTS = [{'summary': {'name': 'Some Vault', 'vaultAddress': C, 'tvl': '3000000', 'isClosed': False}},
          {'summary': {'name': 'Closed', 'vaultAddress': '0x' + 'd' * 40, 'tvl': '9000000', 'isClosed': True}}]


class Labels(unittest.TestCase):
    def test_labels(self):
        lab = hlcore.build_labels(LB, VAULTS)
        self.assertEqual(lab[A]['name'], 'Big Fund')
        self.assertEqual(set(lab[A]['tags']), {'whale', 'top100vol'})
        self.assertIsNone(lab.get(B, {}).get('name'))           # e-mail display names are never shown
        self.assertEqual(lab[C]['name'], 'Some Vault')
        self.assertIn('vault', lab[C]['tags'])
        self.assertNotIn('0x' + 'd' * 40, lab)                   # closed vault
        self.assertEqual(hlcore.label_of('0x1234567890' + 'e' * 28 + 'ab', lab), '0x1234\u2026ab')

    def test_clean_name(self):
        for bad in ('x@y.z', 'https://scam', 'www.site', 'site.com', '   '):
            self.assertIsNone(hlcore.clean_name(bad))
        self.assertEqual(hlcore.clean_name('  Auros '), 'Auros')

    def test_pick_tracked(self):
        t = hlcore.pick_tracked(LB, [B, '0x' + 'f' * 40], cap=3, n_av=1, n_vol=1)
        self.assertEqual(t[0], A)
        self.assertEqual(len(t), 3)
        self.assertEqual(len(set(t)), 3)


CHS = {'marginSummary': {'accountValue': '1000000'}, 'assetPositions': [
    {'position': {'coin': 'BTC', 'szi': '-2', 'positionValue': '150000', 'entryPx': '74000', 'liquidationPx': '90100', 'leverage': {'type': 'cross', 'value': 10}}},
    {'position': {'coin': 'BTC', 'szi': '0', 'positionValue': '0'}},
    {'position': {'coin': 'ETH', 'szi': '10', 'positionValue': '22000', 'entryPx': '2200', 'liquidationPx': None, 'leverage': {'type': 'cross', 'value': 5}}}]}
OO = [
    {'coin': 'BTC', 'side': 'B', 'limitPx': '76000', 'sz': '0.0', 'isTrigger': True, 'triggerPx': '76010', 'isPositionTpsl': True, 'orderType': 'Stop Market', 'reduceOnly': True},
    {'coin': 'BTC', 'side': 'A', 'limitPx': '74950', 'sz': '0.5', 'isTrigger': False, 'triggerPx': '0.0', 'orderType': 'Limit'},
    {'coin': 'BTC', 'side': 'B', 'limitPx': '70000', 'sz': '1', 'isTrigger': True, 'triggerPx': '70100', 'isPositionTpsl': False, 'orderType': 'Take Profit Limit', 'reduceOnly': True},
]


class Clusters(unittest.TestCase):
    def test_positions_orders(self):
        pos = hlcore.positions_of(CHS)
        self.assertEqual(len(pos), 2)
        self.assertEqual(pos[0]['side'], 'short')
        self.assertEqual(hlcore.account_value(CHS), 1000000)
        trig = hlcore.triggers_of(OO, pos)
        self.assertEqual(trig[0]['sz'], 2)        # position TP/SL (sz 0) = the whole position
        self.assertEqual(trig[1]['kind'], 'tp')
        self.assertEqual(hlcore.limits_of(OO), [{'coin': 'BTC', 'side': 'ask', 'px': 74950.0, 'sz': 0.5}])

    def test_step_and_bucket(self):
        self.assertEqual(hlcore.cluster_step(75000), 200)
        self.assertEqual(hlcore.cluster_step(2200), 10)
        self.assertEqual(hlcore.bucket_of(90100, 200), 90000)
        self.assertEqual(hlcore.bucket_of(0.30, 0.001), 0.3)

    def test_coin_state(self):
        pos = hlcore.positions_of(CHS)
        w = {A: {'pos': pos, 'trig': hlcore.triggers_of(OO, pos), 'lim': hlcore.limits_of(OO)},
             B: {'pos': [{'coin': 'BTC', 'side': 'long', 'sz': 1, 'ntl': 75000, 'entryPx': 75000, 'liqPx': 60010.0, 'lev': 5}], 'trig': [], 'lim': [{'coin': 'BTC', 'side': 'ask', 'px': 74950.0, 'sz': 1.5}]}}
        book = {'bids': [[74900, 1], [74800, 1]], 'asks': [[74950, 2], [75000, 6]]}
        s = hlcore.coin_state('BTC', 75000, w, oi_ntl=1_000_000, book=book, now=T)
        self.assertEqual(s['step'], 200)
        self.assertEqual([b['px'] for b in s['liq']], [60000, 90000])
        self.assertEqual(s['liq'][0]['long'], [75000, 1])
        self.assertEqual(s['liq'][1]['short'], [150000, 1])
        self.assertEqual(s['liq'][1]['w'][0]['a'], A)
        self.assertEqual([b['px'] for b in s['stops']], [70000, 76000])
        self.assertEqual(s['stops'][1]['buy'][1], 1)
        self.assertEqual(s['levels'], [[74950.0, 'ask', [[B, 1.5], [A, 0.5]]]])
        self.assertEqual(s['coverage']['oiPct'], 11.2)        # (150k + 75k) / (2 x 1M)
        self.assertEqual(s['coverage']['bookPct'], 20.0)      # 2 of 10 visible size
        far = hlcore.coin_state('BTC', 30000, w, oi_ntl=1, now=T)
        self.assertEqual(far['liq'], [])                      # +-30% band only

    def test_liq_events(self):
        f = [{'coin': 'BTC', 'px': '77505.0', 'sz': '0.5', 'time': 1, 'dir': 'Liquidated Cross Long', 'tid': 9,
              'liquidation': {'liquidatedUser': A.upper().replace('0X', '0x'), 'markPx': '77784.0', 'method': 'backstop'}},
             {'coin': 'BTC', 'px': '1', 'sz': '1', 'time': 2, 'dir': 'Open Long'}]
        e = hlcore.liq_events(f)
        self.assertEqual(len(e), 1)
        self.assertEqual((e[0]['user'], e[0]['side'], e[0]['ntl']), (A, 'long', 38752.5))


if __name__ == '__main__':
    unittest.main(verbosity=1)
