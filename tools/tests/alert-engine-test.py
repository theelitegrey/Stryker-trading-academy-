#!/usr/bin/env python3
"""Unit tests for workers/alert-engine/alert_core.py (server-side price alerts).
  python3 tools/tests/alert-engine-test.py
Includes a PARITY test: the browser's hit() is cut out of assets/chart-alerts.js, run in node, and compared
with the Python hit() on a grid of (condition, level, previous, price) -- so the two cannot drift apart.
"""
import json, os, random, re, subprocess, sys, unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'workers', 'alert-engine'))
import alert_core as c  # noqa: E402


def mk(i, cond, price, freq='once', sym='futures:NQ1!', msg=''):
    return c.parse_alert('u1', 'a%d' % i, {'active': True, 'symbol': sym, 'cond': cond, 'price': price, 'freq': freq, 'message': msg}, 't%d' % i)


class T(unittest.TestCase):
    def book(self, *alerts):
        b = c.Book()
        for a in alerts:
            b.upsert(a)
        return b

    def ids(self, fired):
        return sorted(f[0]['aid'] for f in fired)

    def test_symbol_keys(self):
        self.assertEqual(c.symbol_key('futures:NQ1!'), 'fut:NQ')
        self.assertEqual(c.symbol_key('NQ1!'), 'fut:NQ')
        self.assertEqual(c.symbol_key('CME_MINI:MNQ1!'), 'fut:MNQ')
        self.assertEqual(c.symbol_key('binance:btcusdt'), 'binance:BTCUSDT')
        self.assertEqual(c.symbol_key('coinbase:BTC-USD'), 'coinbase:BTC-USD')
        self.assertIsNone(c.symbol_key('fx:EURUSD'))
        self.assertIsNone(c.symbol_key('hyperliquid:BTC'))
        self.assertIsNone(c.symbol_key('NASDAQ:AAPL'))
        self.assertIsNone(c.symbol_key(''))

    def test_hit_table(self):
        H = c.hit
        self.assertTrue(H('crossing_up', 100, 99, 100)); self.assertTrue(H('crossing_up', 100, 99, 101))
        self.assertFalse(H('crossing_up', 100, 100, 101)); self.assertFalse(H('crossing_up', 100, None, 101))
        self.assertTrue(H('crossing_down', 100, 101, 100)); self.assertFalse(H('crossing_down', 100, None, 99))
        self.assertTrue(H('crossing', 100, 99, 101)); self.assertTrue(H('crossing', 100, 101, 99)); self.assertFalse(H('crossing', 100, None, 99))
        self.assertTrue(H('greater', 100, None, 100.25)); self.assertFalse(H('greater', 100, None, 100))
        self.assertTrue(H('less', 100, None, 99.75)); self.assertFalse(H('less', 100, None, 100))

    def test_crossing_up_fires_once_and_leaves_book(self):
        b = self.book(mk(1, 'crossing_up', 100))
        self.assertEqual(b.tick('fut:NQ', 99, 0), [])         # first price: no previous, no cross
        f = b.tick('fut:NQ', 100.5, 1)
        self.assertEqual(self.ids(f), ['a1'])
        self.assertEqual(b.tick('fut:NQ', 99, 2), [])
        self.assertEqual(b.tick('fut:NQ', 101, 3), [])        # Once: gone from the book
        self.assertNotIn('u1/a1', b.alerts)

    def test_wrong_direction_no_fire(self):
        b = self.book(mk(1, 'crossing_up', 100), mk(2, 'crossing_down', 100))
        b.tick('fut:NQ', 101, 0)
        self.assertEqual(self.ids(b.tick('fut:NQ', 99, 1)), ['a2'])

    def test_jump_over_level_counts(self):
        b = self.book(mk(1, 'crossing', 100), mk(2, 'crossing', 105), mk(3, 'crossing', 150))
        b.tick('fut:NQ', 90, 0)
        self.assertEqual(self.ids(b.tick('fut:NQ', 120, 1)), ['a1', 'a2'])

    def test_greater_edge_trigger_every(self):
        b = self.book(mk(1, 'greater', 100, 'every'))
        self.assertEqual(self.ids(b.tick('fut:NQ', 101, 0)), ['a1'])
        self.assertEqual(b.tick('fut:NQ', 102, 100), [])      # still true: held, no re-fire
        self.assertEqual(b.tick('fut:NQ', 99, 101), [])       # resets
        self.assertEqual(self.ids(b.tick('fut:NQ', 100.5, 200)), ['a1'])

    def test_less_every(self):
        b = self.book(mk(1, 'less', 100, 'every'))
        self.assertEqual(self.ids(b.tick('fut:NQ', 99, 0)), ['a1'])
        self.assertEqual(b.tick('fut:NQ', 98, 50), [])
        b.tick('fut:NQ', 101, 51)
        self.assertEqual(self.ids(b.tick('fut:NQ', 99, 120)), ['a1'])

    def test_every_rate_limit(self):
        b = self.book(mk(1, 'crossing', 100, 'every'))
        b.tick('fut:NQ', 99, 0)
        self.assertEqual(len(b.tick('fut:NQ', 101, 1)), 1)
        self.assertEqual(len(b.tick('fut:NQ', 99, 2)), 0)     # flip-flop inside the gap: suppressed
        self.assertEqual(len(b.tick('fut:NQ', 101, 30)), 1)

    def test_quiet_start(self):
        a = mk(1, 'greater', 100, 'every'); a['quiet'] = True
        b = self.book(a)
        self.assertEqual(b.tick('fut:NQ', 150, 0), [])        # already true at start-up: held
        b.tick('fut:NQ', 90, 1)
        self.assertEqual(len(b.tick('fut:NQ', 101, 2)), 1)

    def test_other_symbols_untouched(self):
        b = self.book(mk(1, 'greater', 100, sym='binance:BTCUSDT'))
        self.assertEqual(b.tick('fut:NQ', 500, 0), [])
        self.assertEqual(len(b.tick('binance:BTCUSDT', 500, 0)), 1)

    def test_edit_rearms_and_unchanged_keeps(self):
        b = self.book(mk(1, 'greater', 100, 'every'))
        b.tick('fut:NQ', 101, 0)                              # held
        self.assertFalse(b.upsert(mk(1, 'greater', 100, 'every')))   # same update stamp: nothing changes
        a2 = mk(1, 'greater', 100, 'every'); a2['ut'] = 'newer'
        self.assertTrue(b.upsert(a2))                          # edited/resumed: re-armed
        self.assertEqual(len(b.tick('fut:NQ', 102, 500)), 1)

    def test_remove_and_sync(self):
        b = self.book(mk(1, 'crossing', 100), mk(2, 'crossing', 101))
        b.sync({'u1/a2': mk(2, 'crossing', 101)})
        self.assertEqual(list(b.alerts), ['u1/a2'])
        b.tick('fut:NQ', 99, 0)
        self.assertEqual(self.ids(b.tick('fut:NQ', 102, 1)), ['a2'])

    def test_parse_rejects(self):
        self.assertIsNone(c.parse_alert('u', 'a', {'active': False, 'symbol': 'NQ1!', 'cond': 'crossing', 'price': 1}))
        self.assertIsNone(c.parse_alert('u', 'a', {'active': True, 'symbol': 'fx:EURUSD', 'cond': 'crossing', 'price': 1}))
        self.assertIsNone(c.parse_alert('u', 'a', {'active': True, 'symbol': 'NQ1!', 'cond': 'weird', 'price': 1}))
        self.assertIsNone(c.parse_alert('u', 'a', {'active': True, 'symbol': 'NQ1!', 'cond': 'crossing', 'price': 'x'}))
        self.assertIsNone(c.parse_alert('u', 'a', {'active': True, 'symbol': 'NQ1!', 'cond': 'crossing', 'price': 1, 'src': {'title': 'RSI'}}))

    def test_push_text(self):
        a = mk(1, 'crossing_up', 21450.25, msg='Watch the open')
        self.assertEqual(c.push_text(a, 21450.5, 21449), 'NQ1! crossed above 21,450.25 \u00b7 Watch the open')
        self.assertEqual(c.push_text(mk(2, 'crossing_down', 21450.25), 21450, 21451), 'NQ1! crossed below 21,450.25')
        self.assertEqual(c.push_text(mk(3, 'crossing', 100), 99, 101), 'NQ1! crossed below 100.00')
        self.assertEqual(c.push_text(mk(4, 'greater', 65000, sym='binance:BTCUSDT'), 65001, None), 'BTCUSDT is above 65,000.00')
        self.assertEqual(c.fmt_price(0.00001234), '0.00001234')

    def test_10k_alerts_cheap(self):
        import time
        random.seed(7)
        b = c.Book()
        for i in range(10000):
            b.upsert(mk(i, random.choice(c.CONDS), round(random.uniform(20000, 22000), 2), random.choice(['once', 'every'])))
        b.tick('fut:NQ', 21000, 0)
        t = time.time(); n = 0
        p = 21000
        for k in range(20000):
            p += random.choice((-0.25, 0.25, 0.5, -0.5))
            n += len(b.tick('fut:NQ', p, k))
        dt = time.time() - t
        self.assertLess(dt, 3.0, '20k ticks over 10k alerts took %.2fs' % dt)
        print('10k alerts: 20k ticks in %.3fs, %d fires' % (dt, n))

    def test_index_matches_brute_force(self):
        random.seed(3)
        for trial in range(30):
            alerts = [mk(i, random.choice(c.CONDS), float(random.randint(90, 110)), 'once') for i in range(25)]
            b = self.book(*alerts)
            ref = {a['aid']: a for a in alerts}
            prev = None
            held = set()
            for k in range(40):
                p = float(random.randint(85, 115))
                got = {f[0]['aid'] for f in b.tick('fut:NQ', p, k)}
                exp = set()
                for aid, a in list(ref.items()):
                    if c.hit(a['cond'], a['price'], prev, p):
                        exp.add(aid)
                        del ref[aid]
                self.assertEqual(got, exp, (trial, k, prev, p))
                prev = p

    def test_parity_with_browser_hit(self):
        src = open(os.path.join(ROOT, 'assets', 'chart-alerts.js')).read()
        m = re.search(r'function hit\(a, prev, p\)\{.*?\n\}\n', src, re.S)
        self.assertTrue(m, 'hit() not found in chart-alerts.js')
        cases = []
        for cond in c.CONDS:
            for x in (100, 100.25):
                for prev in (None, 99, 99.75, 100, 100.25, 101):
                    for p in (99, 99.75, 100, 100.25, 101):
                        cases.append([cond, x, prev, p])
        js = m.group(0) + '\nconst C=' + json.dumps(cases) + ';console.log(JSON.stringify(C.map(([cond,x,prev,p])=>hit({cond,price:x},prev,p))));'
        out = subprocess.run(['node', '-e', js], capture_output=True, text=True, check=True).stdout
        browser = json.loads(out)
        server = [c.hit(cond, x, prev, p) for cond, x, prev, p in cases]
        bad = [cases[i] for i in range(len(cases)) if bool(browser[i]) != server[i]]
        self.assertEqual(bad, [], 'server/browser disagree on %d of %d' % (len(bad), len(cases)))


if __name__ == '__main__':
    unittest.main(verbosity=1)
