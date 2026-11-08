#!/usr/bin/env python3
"""DRY RUN of metric alerts on REAL data (nothing written: fire and notify are stubs; Firestore is only read when --fs is given).
   set -a; . /root/projects/book-feeder/feeder.env; set +a; python3 tools/tests/metric-alerts-dryrun.py [--fs] [--wait 60]
1. Replays the last recorded session of SPX and QQQ (the Worker's /zo/history: one real snapshot per options update) through
   metric_round with GEX-cross and regime alerts on every level: prints what would have been pushed, and when.
2. Reads today's real /zo/summary (SPX, QQQ, NVDA: the values a GEX cross is checked on) and the real OKX + Hyperliquid public data twice, --wait s apart, with
   funding / OI-change alerts around the current values (baseline round, then a check round).
3. --fs: also loads the real students/*/metricAlerts collection group (read only) and prints how many parse.
Keys come from the environment and are never printed."""
import json, os, sys, time, urllib.parse, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'workers', 'alert-engine'))
import metric_alerts as ma  # noqa: E402
import metric_loop as ml  # noqa: E402

URL = os.environ.get('ZORO_API_URL', os.environ.get('BOOK_RECORDER_URL', '').rstrip('/') + '/zo')
KEY = os.environ.get('BOOK_INGEST_SECRET', '')
ARM = '2026-11-01T00:00:00.000Z'


def zget(path):
    req = urllib.request.Request(URL + path, headers={'x-ingest-key': KEY, 'User-Agent': 'tradezoro-alert-engine/1'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def al(i, metric, sym, p, freq='every'):
    return ma.parse_metric_alert('dry', 'a%02d' % i, {'active': True, 'metric': metric, 'symbol': sym, 'p': p, 'freq': freq, 'updatedAt': ARM})


class DryDeps(ml.Deps):
    def __init__(self):
        super().__init__(None, zget, lambda m: print('   log:', m))
        self.sent = []
        self.feed = None

    def is_pro(self, uid, now):
        return True

    def summary(self, sym):
        return self.feed(sym) if self.feed else zget('/summary?u=' + urllib.parse.quote(sym))

    def fire(self, a, text):
        self.sent.append(text)
        return 'dry'


def snap_to_summary(s):
    """A /zo/history snapshot row -> the summary fields snap_values reads (spot, levels, net, em). No IV / put-call in history."""
    return {'built': s.get('fa') or s['t'], 't': s['t'], 'spot': s['s'], 'snap': {'em': s.get('em'), 't': s['t']},
            'levels': {'call_ceiling': s.get('cw'), 'put_floor': s.get('pw'), 'flip_line': s.get('zg'), 'net': s.get('n')}}


def replay(sym):
    h = zget('/history?u=' + sym)
    snaps = h.get('snaps') or []
    print('\n== replay %s %s: %d real snapshots' % (sym, h.get('day'), len(snaps)))
    if not snaps:
        return
    lv = [('gamma_flip', {}), ('call_wall', {}), ('put_wall', {}), ('em_high', {'range': 's'}), ('em_low', {'range': 's'})]
    alerts = {}
    for i, (l, extra) in enumerate(lv):
        a = al(i, 'gex_cross', sym, dict(level=l, **extra))
        alerts[a['id']] = a
    a = al(9, 'gex_cross', sym, {'level': 'gamma_flip', 'dir': 'up'}, freq='once')
    alerts[a['id']] = a
    d = DryDeps()
    st, cache = {'alerts': {}, 'rings': {}}, {}
    s0 = snaps[0]
    print('   first: spot %s flip %s call %s put %s net %s' % (s0['s'], s0.get('zg'), s0.get('cw'), s0.get('pw'), s0.get('n')))
    for s in snaps:
        d.feed = lambda _sym, s=s: snap_to_summary(s)
        cache.clear()
        for a, text, r in ml.metric_round(s['t'], st, alerts, d, cache):
            print('   %s  %s' % (time.strftime('%H:%M UTC', time.gmtime(s['t'])), text))
    s1 = snaps[-1]
    print('   last:  spot %s flip %s call %s put %s net %s' % (s1['s'], s1.get('zg'), s1.get('cw'), s1.get('pw'), s1.get('n')))
    print('   pushes that would have gone out: %d' % len(d.sent))


def live(wait):
    print('\n== current data, two rounds %d s apart' % wait)
    d = DryDeps()
    alerts, i = {}, 20
    vals = {}
    for sym in ('SPX', 'QQQ', 'NVDA'):
        v = ma.snap_values(zget('/summary?u=' + sym))
        vals[sym] = v
        age = (time.time() - v['built']) / 60 if v.get('built') else None
        print('   %s spot %s levels %s nodes %d ranges %s  (updated %s min ago)' % (sym, v['spot'], v['levels'], len(v['nodes']), sorted(v['em']),
                                                                                 '%.0f' % age if age else '?'))
    rows = {}
    for ven in ('okx', 'hl'):
        rows[ven] = ml.fetch_crypto(ven)
        for c in ('BTC', 'ETH', 'SOL'):
            r = rows[ven].get(c)
            print('   %s %s funding %s%% per %s h, OI %s' % (ven, c, r and '%.4f' % r['funding'], r and r.get('hours'), r and r.get('oi')))
            if r:
                a = al(i, 'funding', c, {'venue': ven, 'dir': 'above', 'value': round(r['funding'] - 0.001, 4)}); alerts[a['id']] = a; i += 1
                a = al(i, 'oi_change', c, {'venue': ven, 'mins': 5, 'dir': 'either', 'value': 0.01}); alerts[a['id']] = a; i += 1
    print('   %d coins on OKX USDT swaps, %d on Hyperliquid' % (len(rows['okx']), len(rows['hl'])))
    st, cache = {'alerts': {}, 'rings': {}}, {}
    out = ml.metric_round(time.time(), st, alerts, d, cache)
    print('   round 1 (baseline): %d fires (conditions already true are held, never pushed)' % len(out))
    time.sleep(wait)
    cache.clear()
    out = ml.metric_round(time.time(), st, alerts, d, cache)
    print('   round 2: %d fires' % len(out))
    for _, t, _ in out:
        print('     ', t)
    print('   OI rings:', {k: len(v) for k, v in st['rings'].items()})


def fs_check():
    import fsrest as fs
    d = ml.Deps(fs, zget, print)
    alerts = d.load_alerts()
    print('\n== Firestore (read only): %d active metric alerts parsed' % len(alerts))


if __name__ == '__main__':
    if not KEY or not URL.startswith('http'):
        sys.exit('needs BOOK_RECORDER_URL + BOOK_INGEST_SECRET in the environment (feeder.env)')
    wait = int(sys.argv[sys.argv.index('--wait') + 1]) if '--wait' in sys.argv else 60
    for s in ('SPX', 'QQQ'):
        replay(s)
    live(wait)
    if '--fs' in sys.argv:
        fs_check()
    print('\nDRY RUN: nothing was written.')
