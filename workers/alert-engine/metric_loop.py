"""Metric alerts: the engine loop (network + Firestore). Pure rules: metric_alerts.py. Owner order 2026-11-07.

Isolated on purpose (as the dark pool alerts are): alert_engine.py imports this inside try/except and runs run() in its own
thread; every round is wrapped, so a failure here never touches price, ZoroOptions or dark pool alerts.

Every EVERY s:
  1. load students/*/metricAlerts (collection group; parse + 20 per member).
  2. Pro metrics (GEX / options): the member's plan is read (students/{uid} + plans, same rule as the site's GEX gate;
     admins count). Not Pro -> the alert is skipped (kept, never fires). Cached PLAN_TTL s.
  3. options data: the Worker's /zo/summary per symbol (the same numbers the ZoroOptions page and Zoro Levels show; the
     engine never calls a vendor). Read at most every OPT_EVERY s per symbol.
  4. crypto: OKX public REST (funding-rate?instId=ANY, open-interest?instType=SWAP) and Hyperliquid public info
     (metaAndAssetCtxs), only when an alert needs that venue. OI samples of watched coins are kept RING_S s for the
     "change over N minutes" alerts. Binance / Bybit are not reachable from this server: not offered.
  5. fire: re-read the doc (gone / paused / edited -> skip), Once alerts are claimed first (active=false with the
     update-time precondition), then one notifications doc (bell + phone push through onNotificationCreated).
State (per-alert entries + OI rings) survives restarts in STATE (mode 0600 dir of the engine), so a restart never re-fires.
No uid in logs. Education only. Not financial advice.
"""
import json
import os
import time
import urllib.parse
import urllib.request

import metric_alerts as ma

HERE = os.path.dirname(os.path.abspath(__file__))
EVERY = int(os.environ.get('METRIC_EVERY', '60'))
OPT_EVERY = 110
PLAN_TTL = 600
RING_S = 5 * 3600
STATE = os.environ.get('METRIC_STATE', os.path.join(HERE, 'metric-state.json'))
OKX = 'https://www.okx.com/api/v5/public/'
HL = 'https://api.hyperliquid.xyz/info'
UA = {'User-Agent': 'tradezoro-alert-engine/1'}
stat = {'fires': 0, 'loops': 0, 'last': 0, 'err': 0, 'alerts': 0, 'locked': 0, 'syms': 0}


def _get_json(url, body=None, headers=None, timeout=20):
    h = dict(UA, **(headers or {}))
    if body is not None:
        h['content-type'] = 'application/json'
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def fetch_crypto(venue):
    if venue == 'okx':
        return ma.parse_okx(_get_json(OKX + 'funding-rate?instId=ANY'), _get_json(OKX + 'open-interest?instType=SWAP'))
    return ma.parse_hl(_get_json(HL, {'type': 'metaAndAssetCtxs'}))


def state_load():
    try:
        st = json.load(open(STATE))
        if isinstance(st.get('alerts'), dict) and isinstance(st.get('rings'), dict):
            return st
    except Exception:
        pass
    return {'alerts': {}, 'rings': {}}


def state_save(st):
    with open(STATE + '.tmp', 'w') as f:
        json.dump(st, f, separators=(',', ':'))
    os.replace(STATE + '.tmp', STATE)


class Deps:
    """Everything with a side effect, so a dry run swaps them (tools/tests/metric-alerts-dryrun.py)."""
    def __init__(self, fs, zget, log, notify=None):
        self.fs, self.zget, self.log = fs, zget, log
        # notify(data, what): alert_engine's outbox writer (retried for 10 min, fixed doc path: no double push)
        self.notify = notify or (lambda d, what: fs.create_doc('notifications', d))
        self.plans = {'at': 0, 'paid': set()}
        self.pro = {}                      # uid -> (at, bool)

    def load_alerts(self):
        res = self.fs.run_query({'from': [{'collectionId': 'metricAlerts', 'allDescendants': True}]})
        out = []
        for x in res:
            d = x.get('document')
            if not d:
                continue
            parts = d['name'].split('/documents/')[1].split('/')     # students/{uid}/metricAlerts/{aid}
            if len(parts) != 4:
                continue
            a = ma.parse_metric_alert(parts[1], parts[3], self.fs.decode_doc(d), d.get('updateTime', ''))
            if a:
                out.append(a)
        return {a['id']: a for a in ma.limit_per_member(out)}

    def is_pro(self, uid, now):
        hit = self.pro.get(uid)
        if hit and now - hit[0] < PLAN_TTL:
            return hit[1]
        if now - self.plans['at'] >= PLAN_TTL:
            paid = set()
            for x in self.fs.run_query({'from': [{'collectionId': 'plans'}]}):
                d = x.get('document')
                if not d:
                    continue
                f = self.fs.decode_doc(d)
                try:
                    rank = float(f.get('rank') or 0)
                except (TypeError, ValueError):
                    rank = 0
                if rank >= 1:
                    paid.add(d['name'].rsplit('/', 1)[1].lower())
                    if f.get('name'):
                        paid.add(str(f['name']).lower())
            self.plans = {'at': now, 'paid': paid}
        adm, _ = self.fs.get_doc('admins/' + uid)
        if adm is not None:
            v = True
        else:
            doc, _ = self.fs.get_doc('students/' + uid)
            v = ma.is_active_pro(doc, self.plans['paid'], now * 1000)
        self.pro[uid] = (now, v)
        return v

    def summary(self, sym):
        return self.zget('/summary?u=' + urllib.parse.quote(sym))

    def crypto(self, venue):
        return fetch_crypto(venue)

    def fire(self, a, text):
        path = 'students/%s/metricAlerts/%s' % (a['uid'], a['aid'])
        doc, ut = self.fs.get_doc(path)
        if doc is None or doc.get('active') is not True or doc.get('metric') != a['metric'] or str(doc.get('updatedAt')) != a['armed']:
            return 'stale'
        if a['freq'] == 'once':
            try:
                self.fs.patch_doc(path, {'active': False, 'updatedAt': self.fs.now_ts()}, ut)
            except self.fs.HttpErr as e:
                if e.status in (400, 404, 409):
                    return 'claimed-elsewhere'
                raise
        self.notify({'recipientUid': a['uid'], 'type': 'metric_alert', 'message': text[:480], 'link': ma.link(a), 'read': False,
                     'createdAt': self.fs.now_ts()}, 'metric ' + a['aid'][:6])
        self.log('MFIRE %s %s %s' % (a['aid'][:6], a['metric'], a['symbol']))   # no uid in logs
        return 'fired'


def metric_round(now, st, alerts, deps, opt_cache):
    """One pass. Returns [(alert, text, result)]. st changes in place. opt_cache: {sym: (fetched at, values)}."""
    out = []
    ma.prune(st['alerts'], set(alerts))
    live = {}
    locked = 0
    for a in alerts.values():
        if a['pro']:
            try:
                if not deps.is_pro(a['uid'], now):
                    locked += 1
                    continue
            except Exception as e:
                stat['err'] += 1
                deps.log('metric plan read failed: %s' % type(e).__name__)
                continue                                   # unknown plan: skip this round, never fire on a guess
        live[a['id']] = a
    stat['locked'] = locked
    # options snapshots
    vals = {}
    for sym in sorted({a['symbol'] for a in live.values() if a['pro']}):
        hit = opt_cache.get(sym)
        if hit and now - hit[0] < OPT_EVERY:
            vals[sym] = hit[1]
            continue
        try:
            v = ma.snap_values(deps.summary(sym))
        except Exception as e:
            stat['err'] += 1
            deps.log('metric summary %s failed: %s' % (sym, type(e).__name__))
            v = hit[1] if hit else None
        opt_cache[sym] = (now, v)
        vals[sym] = v
    # crypto venues + OI rings
    rows = {}
    for ven in sorted({a['p']['venue'] for a in live.values() if not a['pro']}):
        try:
            rows[ven] = deps.crypto(ven)
        except Exception as e:
            stat['err'] += 1
            deps.log('metric %s read failed: %s' % (ven, type(e).__name__))
            rows[ven] = None
    watch = {'%s:%s' % (a['p']['venue'], a['symbol']) for a in live.values() if a['metric'] == 'oi_change'}
    for k in list(st['rings']):
        if k not in watch:
            del st['rings'][k]
    for k in watch:
        ven, c = k.split(':', 1)
        r = (rows.get(ven) or {}).get(c)
        ring = st['rings'].setdefault(k, [])
        if r and ma._num(r.get('oi')):
            ring.append([int(now), r['oi']])
        st['rings'][k] = [x for x in ring if now - x[0] <= RING_S]
    stat['syms'] = len(vals) + len(rows)
    for a in live.values():
        old = st['alerts'].get(a['id'])
        cur_e = dict(old) if old else None           # eval_* update their entry in place; old stays as it was for a failed send
        if a['pro']:
            v = vals.get(a['symbol'])
            if not v:
                continue
            text, entry = ma.eval_snapshot(a, v, cur_e, now)
        else:
            tab = rows.get(a['p']['venue'])
            if tab is None:
                continue                                   # venue unread this round: nothing changes
            # ring without this round's sample: the change is measured from the past to now
            ring = st['rings'].get('%s:%s' % (a['p']['venue'], a['symbol']), [])[:-1]
            text, entry = ma.eval_crypto(a, tab.get(a['symbol']), ring, cur_e, now)
        if not text:
            st['alerts'][a['id']] = entry
            continue
        try:
            r = deps.fire(a, text)
        except Exception as e:
            stat['err'] += 1
            r = 'error'
            deps.log('metric fire failed: %s %s' % (type(e).__name__, str(e)[:100]))
            entry = old                                    # not sent: the next round looks again
        if r == 'fired':
            stat['fires'] += 1
        st['alerts'][a['id']] = entry
        out.append((a, text, r))
    return out


def run(fs, zget, log, notify=None):
    """Thread body (alert_engine.py)."""
    deps = Deps(fs, zget, log, notify)
    st = state_load()
    opt_cache = {}
    while True:
        now = time.time()
        try:
            alerts = deps.load_alerts()
            stat['alerts'] = len(alerts)
            metric_round(now, st, alerts, deps, opt_cache)
            state_save(st)
            stat['loops'] += 1
            stat['last'] = int(now)
        except Exception as e:
            stat['err'] += 1
            log('metric round failed: %s %s' % (type(e).__name__, str(e)[:120]))
        time.sleep(EVERY)
