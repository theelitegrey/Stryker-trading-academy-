#!/usr/bin/env python3
"""Unit tests for ZoroOptions alerts (workers/alert-engine/zoro_alerts.py) and the daily note
(workers/book-recorder/zoro-note/zoro_note.py).   python3 tools/tests/zoro-alerts-test.py"""
import copy, json, os, re, sys, unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'workers', 'alert-engine'))
sys.path.insert(0, os.path.join(ROOT, 'workers', 'book-recorder', 'zoro-note'))
import alert_core as core  # noqa: E402
import zoro_alerts as za  # noqa: E402
import zoro_note as zn  # noqa: E402


def snap(**kw):
    s = {'u': 'SPX', 'built': 1000, 'levels': {'call_ceiling': 6900, 'put_floor': 6750, 'flip_line': 6812, 'pin': 6850},
         'zone': 'cushion', 'ranges': {'0': [6790, 6870], 'w': [6700, 6950], 'm': [6600, 7000]},
         'iv': {'rank': 34, 'iv30': 15.2}, 'pc': {'volume': 1.12}, 'fut': {'root': 'ES', 'ratio': 1.0008},
         'fresh_top': [], 'burst_top': []}
    s.update(kw)
    return s


def al(t, p=None, sym='SPX', freq='once', i=1):
    return za.parse_zoro_alert('u1', 'a%d' % i, {'active': True, 'type': t, 'symbol': sym, 'p': p or {}, 'freq': freq}, 't1')


class Alerts(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(al('zone_change')['symbol'], 'SPX')
        self.assertEqual(al('zone_change', sym='ES')['symbol'], 'SPX')            # futures names map to the underlying
        self.assertEqual(al('zone_change', sym='CME_MINI:NQ1!')['symbol'], 'QQQ')
        self.assertIsNone(al('level_touch', {'level': 'flip_line'}, sym='AAPL'))  # no futures feed for stocks
        self.assertIsNone(al('level_touch', {'level': 'nope'}))
        self.assertIsNone(al('level_touch', {'level': 'range_high', 'range': 'x'}))
        self.assertIsNone(al('iv_rank', {'dir': 'above', 'value': 120}))
        self.assertIsNone(al('iv_rank', {'dir': 'up', 'value': 80}))
        self.assertIsNone(al('pc_extreme', {'dir': 'above', 'value': 'x'}))
        self.assertIsNone(al('bullish_thing'))
        self.assertIsNone(za.parse_zoro_alert('u', 'a', {'active': False, 'type': 'zone_change', 'symbol': 'SPX'}))
        self.assertEqual(al('fresh_volume', sym='AAPL')['p']['min_volume'], 100)
        self.assertEqual(al('note_ready')['symbol'], 'NOTE')

    def test_limit_25(self):
        many = [za.parse_zoro_alert('u1', 'a%03d' % i, {'active': True, 'type': 'zone_change', 'symbol': 'SPX'}) for i in range(40)]
        many += [za.parse_zoro_alert('u2', 'b1', {'active': True, 'type': 'zone_change', 'symbol': 'SPX'})]
        out = za.limit_per_member(many)
        self.assertEqual(sum(1 for a in out if a['uid'] == 'u1'), 25)
        self.assertEqual(sum(1 for a in out if a['uid'] == 'u2'), 1)

    def test_level_touch_via_price_book(self):
        a = al('level_touch', {'level': 'flip_line'})
        pa = za.to_price_alert(a, snap())
        self.assertEqual(pa['key'], 'fut:ES')
        self.assertEqual(pa['price'], round(6812 * 1.0008, 2))
        b = core.Book(); b.upsert(pa)
        self.assertEqual(b.tick('fut:ES', pa['price'] - 5, 0), [])
        f = b.tick('fut:ES', pa['price'] + 1, 1)
        self.assertEqual(len(f), 1)
        t = za.touch_text(f[0][0], f[0][1], f[0][2])
        self.assertEqual(t, 'SPX crossed its Flip Line at 6,812. Education only. Not financial advice.')

    def test_level_touch_range_and_move_rearms(self):
        a = al('level_touch', {'level': 'range_high', 'range': 'w'}, freq='every')
        pa = za.to_price_alert(a, snap())
        self.assertEqual(pa['level'], 6950)
        self.assertIn('Zoro Range high (weekly)', za.touch_text(pa, 1, 0))
        pb = za.to_price_alert(a, snap(ranges={'w': [6700, 6960]}))
        b = core.Book(); b.upsert(pa)
        self.assertTrue(b.upsert(pb))                  # level moved: re-armed at the new price
        self.assertFalse(b.upsert(dict(pb)))           # unchanged: kept

    def test_level_touch_needs_ratio_and_level(self):
        a = al('level_touch', {'level': 'flip_line'})
        self.assertIsNone(za.to_price_alert(a, snap(fut={})) if False else za.to_price_alert(a, snap(fut={'root': 'ES', 'ratio': 0})))
        self.assertIsNone(za.to_price_alert(a, snap(levels={})))

    def test_zone_change(self):
        a = al('zone_change')
        self.assertIsNone(za.evaluate(a, snap(), None))                                   # first look: baseline only
        self.assertIsNone(za.evaluate(a, snap(built=1100), snap()))                        # same zone
        t = za.evaluate(a, snap(built=1100, zone='swing'), snap())
        self.assertEqual(t, 'SPX moved into the Swing zone: price crossed its Flip Line at 6,812. Education only. Not financial advice.')
        self.assertIsNone(za.evaluate(a, snap(zone='swing'), snap()))                      # same build time: nothing new

    def test_level_moved(self):
        a = al('level_moved', {'level': 'call_ceiling'})
        s2 = snap(built=1100, levels={'call_ceiling': 6925, 'put_floor': 6750, 'flip_line': 6812})
        self.assertIn('Call Ceiling moved from 6,900 to 6,925', za.evaluate(a, s2, snap()))
        self.assertIsNone(za.evaluate(al('level_moved', {'level': 'put_floor'}), s2, snap()))

    def test_fresh_volume_and_burst(self):
        c1 = {'strike': 6850, 'side': 'call', 'exp': '2026-11-06', 'volume': 900, 'oi': 400}
        a = al('fresh_volume', {'min_volume': 500})
        s2 = snap(built=1100, fresh_top=[c1])
        t = za.evaluate(a, s2, snap())
        self.assertIn('Fresh Volume on the 6,850 call 2026-11-06: 900 contracts against 400 open interest', t)
        self.assertIsNone(za.evaluate(a, snap(built=1200, fresh_top=[c1]), s2))            # already seen: not new
        self.assertIsNone(za.evaluate(al('fresh_volume', {'min_volume': 1000}), s2, snap()))   # under the member's size
        self.assertIsNone(za.evaluate(a, snap(built=1100, fresh_top=[dict(c1, volume=300)]), snap()))   # volume not above OI
        b = al('volume_burst', {'min_added': 500})
        s3 = snap(built=1100, burst_top=[{'strike': 6800, 'side': 'put', 'exp': '2026-11-06', 'added': 650, 'volume': 1500}])
        self.assertIn('Volume Burst on the 6,800 put 2026-11-06: 650 contracts added since the last update', za.evaluate(b, s3, snap()))
        self.assertIsNone(za.evaluate(al('volume_burst', {'min_added': 700}), s3, snap()))

    def test_iv_rank_and_pc_cross(self):
        a = al('iv_rank', {'dir': 'above', 'value': 80})
        hi = snap(built=1100, iv={'rank': 83})
        self.assertEqual(za.evaluate(a, hi, snap(iv={'rank': 70})), 'SPX IV rank moved above 80, now 83. Education only. Not financial advice.')
        self.assertIsNone(za.evaluate(a, snap(built=1200, iv={'rank': 85}), hi))           # already above: no new cross
        self.assertIsNone(za.evaluate(a, snap(built=1100, iv={'rank': 60}), snap(iv={'rank': 70})))
        self.assertIsNotNone(za.evaluate(al('iv_rank', {'dir': 'below', 'value': 20}), snap(built=1100, iv={'rank': 18}), snap(iv={'rank': 25})))
        p = al('pc_extreme', {'dir': 'above', 'value': 1.5})
        self.assertIn('put/call by volume moved above 1.50, now 1.62', za.evaluate(p, snap(built=1100, pc={'volume': 1.62}), snap()))
        self.assertIsNone(za.evaluate(p, snap(built=1100, pc={'volume': 1.4}), snap()))

    def test_cooldown(self):
        c = za.Cooldown(); e = al('zone_change', freq='every')
        self.assertTrue(c.ok(e, 0)); self.assertFalse(c.ok(e, 100)); self.assertTrue(c.ok(e, 1000))
        o = al('zone_change', freq='once', i=2)
        self.assertTrue(c.ok(o, 0)); self.assertTrue(c.ok(o, 1))

    def test_user_message_added_and_length(self):
        a = al('zone_change'); a['message'] = 'Check the chart'
        t = za.evaluate(a, snap(built=1100, zone='swing'), snap())
        self.assertIn('Flip Line at 6,812. Check the chart Education only.', t)
        self.assertLessEqual(len(t), 480)

    def test_alert_text_obeys_copy_rules(self):
        c1 = {'strike': 6850, 'side': 'call', 'exp': '2026-11-06', 'volume': 900, 'oi': 400}
        s2 = snap(built=1100, zone='swing', iv={'rank': 83}, pc={'volume': 1.7}, fresh_top=[c1],
                  burst_top=[dict(c1, added=900)], levels={'call_ceiling': 6925, 'put_floor': 6700, 'flip_line': 6800})
        cases = [al('zone_change'), al('level_moved', {'level': 'put_floor'}), al('fresh_volume', {'min_volume': 1}),
                 al('volume_burst', {'min_added': 1}), al('iv_rank', {'dir': 'above', 'value': 80}), al('pc_extreme', {'dir': 'above', 'value': 1.5})]
        for a in cases:
            t = za.evaluate(a, s2, snap())
            self.assertTrue(t, a['type'])
            body = t.replace(za.FOOTER, '')
            self.assertEqual(za.banned_words(body), [], t)
            self.assertTrue(t.endswith(za.FOOTER))
        self.assertEqual(za.banned_words('The market is bullish and live'), ['bullish', 'live'])
        self.assertEqual(za.banned_words('Delivery lives on; alive; seller'), [])      # whole words only

    def test_engine_wires_up(self):
        src = open(os.path.join(ROOT, 'workers', 'alert-engine', 'alert_engine.py')).read()
        compile(src, 'alert_engine.py', 'exec')
        for needle in ('zoro_loop', 'zbook.tick', "a.get('zoro')", 'zoroAlerts'):
            self.assertIn(needle, src)
        self.assertIn('zoro_alerts.py', open(os.path.join(ROOT, 'workers', 'alert-engine', 'install.sh')).read())


SUMS = {s: snap(u=s) for s in zn.INDEXES}
SUMS['QQQ'] = snap(u='QQQ', levels={'call_ceiling': 640, 'put_floor': 600.5, 'flip_line': 618.25, 'pin': 620}, ranges={'0': [612, 625]}, fut={'root': 'NQ', 'ratio': 41.5})
ROWS = [{'u': 'AAPL', 'strike': 230, 'side': 'call', 'exp': '2026-11-07', 'volume': 5000, 'oi': 1200},
        {'u': 'AAPL', 'strike': 235, 'side': 'call', 'exp': '2026-11-07', 'volume': 9000, 'oi': 800},
        {'u': 'NVDA', 'strike': 150, 'side': 'put', 'exp': '2026-11-07', 'volume': 7000, 'oi': 7500},       # volume not above OI: skipped
        {'u': 'TSLA', 'strike': 300, 'side': 'put', 'exp': '2026-11-07', 'volume': 4000, 'oi': 100},
        {'u': 'SPX', 'strike': 6800, 'side': 'put', 'exp': '2026-11-07', 'volume': 99999, 'oi': 1}] + \
       [{'u': 'S%d' % i, 'strike': 10, 'side': 'call', 'exp': '2026-11-07', 'volume': 1000 + i, 'oi': 10} for i in range(6)]


class Note(unittest.TestCase):
    def note(self, **kw):
        prev = {'SPX': {'call_ceiling': 6850, 'put_floor': 6750, 'flip_line': 6812, 'zone': 'swing', 'pc': 0.96}}
        return zn.build_note('morning', '2026-11-06', kw.get('sums', SUMS), kw.get('rows', ROWS), kw.get('prev', prev))

    def test_spec_example_lines(self):
        n = self.note()
        self.assertTrue(n['ok'])
        spx = next(s for s in n['sections'] if s['sym'] == 'SPX')['lines']
        self.assertEqual(spx[0], 'SPX: Call Ceiling 6,900, Put Floor 6,750, Flip Line 6,812.')
        self.assertIn('0DTE Zoro Range 6,790 to 6,870.', spx)
        self.assertIn('IV rank 34 (30-day IV 15.2%).', spx)
        self.assertIn('Put/call by volume 1.12, up from 0.96 yesterday.', spx)
        self.assertIn('Since yesterday: Call Ceiling moved from 6,850 to 6,900; the Gamma Zone changed from Swing to Cushion.', spx)
        self.assertTrue(6 <= len(spx) <= 10, len(spx))
        self.assertEqual(n['teaser'], spx[:3])

    def test_sections_and_mapping(self):
        n = self.note()
        syms = [s['sym'] for s in n['sections']]
        self.assertEqual(syms, ['SPX', 'ES', 'QQQ', 'NQ', 'IWM', 'RTY', 'GLD', 'GC', 'USO', 'CL'])
        nq = next(s for s in n['sections'] if s['sym'] == 'NQ')
        self.assertEqual(nq['title'], 'NQ (mapped from QQQ)')
        self.assertEqual(nq['lines'][0], 'NQ (mapped from QQQ): Call Ceiling 26,560, Put Floor 24,921, Flip Line 25,657.')
        qqq = next(s for s in n['sections'] if s['sym'] == 'QQQ')['lines']
        self.assertIn('Put Floor 600.50', qqq[0])         # sub-1000 values keep cents

    def test_top5_stocks(self):
        n = self.note()
        lines = n['stocks']['lines']
        self.assertEqual(len(lines), 5)
        self.assertTrue(lines[0].startswith('AAPL: 235 call 2026-11-07, 9,000 contracts against 800'))
        self.assertFalse(any(l.startswith(('NVDA', 'SPX')) for l in lines))     # volume<=OI and index rows left out
        self.assertEqual(sum(l.startswith('AAPL') for l in lines), 1)           # one line per stock

    def test_no_banned_words_no_prices_and_footer(self):
        n = self.note()
        body = '\n'.join([n['title']] + [l for s in n['sections'] for l in s['lines']] + n['stocks']['lines'])
        self.assertEqual(zn.banned_words(body), [])
        self.assertEqual(n['footer'], 'Education only. Not financial advice.')
        self.assertNotRegex(body, r'\$|spot|last price|bid|ask\b')
        self.assertEqual(json.loads(json.dumps(n))['kind'], 'morning')

    def test_banned_word_blocks_publish(self):
        bad = copy.deepcopy(SUMS)
        bad['SPX']['fresh_top'] = [{'strike': 6800, 'side': 'bullish', 'exp': '2026-11-06', 'volume': 900, 'oi': 10}]
        n = self.note(sums=bad)
        self.assertFalse(n['ok'])
        self.assertIn('bullish', n['reason'])
        self.assertTrue(zn.banned_words('This will happen'))
        self.assertTrue(zn.banned_words('Prices are delayed'))
        self.assertTrue(zn.banned_words('real-time and Real Time'))
        self.assertTrue(zn.banned_words('guaranteed'))

    def test_missing_spx_not_published_and_missing_fields_skip_lines(self):
        s = copy.deepcopy(SUMS); del s['SPX']
        self.assertFalse(self.note(sums=s)['ok'])
        thin = {'SPX': {'u': 'SPX', 'built': 5, 'levels': {'call_ceiling': 6900}}}
        n = self.note(sums=thin, rows=[], prev={})
        self.assertTrue(n['ok'])
        self.assertEqual(n['sections'][0]['lines'], ['SPX: Call Ceiling 6,900.'])
        self.assertEqual(n['stocks']['lines'], [])

    def test_no_prev_no_change_line(self):
        spx = next(s for s in self.note(prev={})['sections'] if s['sym'] == 'SPX')['lines']
        self.assertFalse(any(l.startswith('Since yesterday') for l in spx))
        self.assertIn('Put/call by volume 1.12.', spx)

    def test_prev_weekday_and_gather(self):
        self.assertEqual(zn.prev_weekday('2026-11-09'), '2026-11-06')      # Monday -> Friday
        calls = []
        def get(p):
            calls.append(p)
            if p.startswith('/note?day=2026-11-05&kind=close'):
                return {'figures': {'SPX': {'pc': 1.0}}}
            return {'rows': ROWS} if p.startswith('/activity') else (SUMS.get(p.split('u=')[-1]) if p.startswith('/summary') else None)
        sums, rows, prev = zn.gather(get, '2026-11-06')
        self.assertEqual(sorted(sums), sorted(zn.INDEXES)); self.assertEqual(prev, {'SPX': {'pc': 1.0}})
        self.assertEqual(len(rows), len(ROWS))
        self.assertEqual(len(calls), 5 + 1 + 1)       # 5 summaries, 1 activity, 1 note: no vendor calls at all

    def test_fixture_run_dry(self):
        import io, tempfile, contextlib
        d = tempfile.mkdtemp()
        for s, v in SUMS.items():
            json.dump(v, open(os.path.join(d, 'summary-%s.json' % s), 'w'))
        json.dump({'rows': ROWS}, open(os.path.join(d, 'activity.json'), 'w'))
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = zn.main(['--fixture=' + d, '--dry', '--day=2026-11-06', '--kind=morning', '--force'])
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(buf.getvalue())['title'], 'Zoro Morning Note')


class FeederFixture(unittest.TestCase):
    """The S1 fixture (tools/fixtures/zoro) is the contract: alerts and the note must read it as it is."""
    FX = os.path.join(ROOT, 'tools', 'fixtures', 'zoro')

    def load(self, f):
        with open(os.path.join(self.FX, f)) as fh:
            return json.load(fh)

    def test_alerts_read_feeder_rows(self):
        s = self.load('summary.json')
        prev = dict(s, built=s['built'] - 120, fresh_top=[], burst_top=[])
        txt = za.evaluate(al('fresh_volume', {'min_volume': 1}), s, prev)
        self.assertIsNotNone(txt)
        self.assertRegex(txt, r'Fresh Volume on the [\d,.]+ (call|put) 2026-')
        txt = za.evaluate(al('volume_burst', {'min_added': 1}), s, prev)
        self.assertRegex(txt, r'Volume Burst on the [\d,.]+ (call|put) 2026-\d\d-\d\d: [\d,]+ contracts added')
        self.assertFalse(zn.banned_words(txt.replace(za.FOOTER, '')))

    def test_note_reads_feeder_summary_and_all_fresh(self):
        s = self.load('summary.json')
        rows = [dict(r, u=u) for u, r in (('AAPL', {'k': 230, 'side': 'C', 'x': '2026-11-07', 'vol': 5000, 'oi': 100}),)]
        note = zn.build_note('morning', s['day'], {'SPX': s}, rows, {})
        self.assertTrue(note['ok'], note.get('reason'))
        self.assertIn('AAPL: 230 call 2026-11-07, 5,000 contracts against 100 open interest.', note['stocks']['lines'])
        self.assertTrue(any(x['sym'] == 'ES' for x in note['sections']))

if __name__ == '__main__':
    unittest.main()
