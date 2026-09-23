#!/usr/bin/env python3
"""Launch sale: plan-record changes, run ONLY at merge time on CoS go.

  python3 tools/launch-sale/apply.py            # dry run: backup + print diff, writes nothing
  python3 tools/launch-sale/apply.py --apply    # writes, each with an updateTime precondition
  python3 tools/launch-sale/apply.py --rollback BACKUP.json

Writes (nothing else):
  plans/Sj1bjdpwvYJUVErjNMAb (Pro)    price 49, salePrice 19, priceInr 2499, salePriceInr 699,
                                       onSale, saleLabel "Launch price", saleEndsAt "",
                                       featured true, ctaLabel "Join Pro", yearlyPlanId proYearly
  plans/OMSNNQrZ4aBPReRMOpUB (Elite)  price 129, salePrice 49, priceInr 5999, salePriceInr 1999,
                                       onSale, saleLabel "Launch price", saleEndsAt ""
                                       + features: copy fixes from the content gate (verdict 2026-09-23,
                                       items 1-5), built from the LIVE arrays, only those strings replaced
  plans/proYearly (new, hidden)        Pro yearly $490 -> $149, Rs 24,990 -> Rs 5,499, features = Pro's fixed array
                                       (INR yearly approved by chief-of-staff 2026-09-23)
  launchSaleConfig/main                active, startAt (= apply time), limit 100, planIds,
                                       excludeUids (Owner test account), excludeCoupons TEST*
  settings/commerce.launchSale         {active, limit, taken: 0}; launchSaleOnOrder recounts
                                       on every new order
Starter is not touched. Razorpay needs no manual step: razorpaySubscribe creates a new
Razorpay billing plan for a new amount on first use (existing mandates keep their amount).

Token: scratch fn/tok.sh (firebase-tools OAuth). Never printed.
"""
import json, os, subprocess, sys, time, urllib.request, urllib.error

P = 'strykertrades-e0cd8'
B = f'https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents'
TOK = subprocess.run([os.path.expanduser(
    '/root/.hermes/profiles/stryker-website-manager/cache/scratch/fn/tok.sh')],
    capture_output=True, text=True).stdout.strip()
H = {'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json'}
BACKUP_DIR = '/root/.hermes/profiles/stryker-website-manager/cache/scratch/launch-sale-backups'

PRO, ELITE = 'Sj1bjdpwvYJUVErjNMAb', 'OMSNNQrZ4aBPReRMOpUB'
PRO_CHANGES = {'price': '49', 'salePrice': '19', 'priceInr': '2499', 'salePriceInr': '699',
               'onSale': True, 'saleLabel': 'Launch price', 'saleEndsAt': '', 'featured': True,
               'ctaLabel': 'Join Pro', 'yearlyPlanId': 'proYearly'}
# Content-gate copy fixes (launch-sale-copy-VERDICT.md items 1-5): {index: (old, new)}.
# Each old string must be present at that index in the live record or the run stops.
PRO_FEATURE_FIXES = {
    0: ('All 42 chapters : candle basics to liquidity engineering',
        'All 42 chapters \u2014 candle basics to liquidity engineering'),
    1: ('Full session replay library with trade recaps',
        'Session replays with trade recaps'),
    2: ('Trading floor community : post, DM, share trades',
        'Trading floor community \u2014 post, DM, share trades'),
}
ELITE_FEATURE_FIXES = {
    1: ('Live killzone sessions : trade the open with Stryker, live chat included',
        'Live killzone sessions \u2014 trade the open with Stryker, live chat included'),
    3: ('Exclusive stryker indicator suite',
        'Exclusive Stryker indicator suite'),
}


def fixed_features(fields, fixes, label):
    live = [v.get('stringValue', '') for v in fields.get('features', {}).get('arrayValue', {}).get('values', [])]
    new = list(live)
    for i, (old, rep) in fixes.items():
        if i >= len(live) or live[i] != old:
            raise SystemExit(f'{label} features[{i}] is {live[i] if i < len(live) else None!r}, expected {old!r}; stop and check')
        new[i] = rep
    return live, new


def show_features(label, old, new):
    print(f'{label} features:')
    for i, (a, b) in enumerate(zip(old, new)):
        print(f'  [{i}] ' + (f'- {a}\n      + {b}' if a != b else f'  {a}'))


ELITE_CHANGES = {'price': '129', 'salePrice': '49', 'priceInr': '5999', 'salePriceInr': '1999',
                 'onSale': True, 'saleLabel': 'Launch price', 'saleEndsAt': '', 'featured': False}


def call(method, url, body=None):
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                               headers=H, method=method)
    try:
        with urllib.request.urlopen(r) as x:
            return x.status, json.load(x)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def enc(v):
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, list): return {'arrayValue': {'values': [enc(i) for i in v]}}
    if isinstance(v, dict) and v.get('__ts'): return {'timestampValue': v['__ts']}
    if isinstance(v, dict): return {'mapValue': {'fields': {k: enc(x) for k, x in v.items()}}}
    return {'stringValue': str(v)}


def patch(path, fields, precondition=None):
    mask = '&'.join('updateMask.fieldPaths=' + k for k in fields)
    pre = ('&currentDocument.updateTime=' + precondition) if precondition else ''
    s, b = call('PATCH', f'{B}/{path}?{mask}{pre}', {'fields': {k: enc(v) for k, v in fields.items()}})
    if s != 200: raise SystemExit(f'FAILED {path}: {s} {b.get("error", {}).get("message", "")}')
    return b


def main():
    apply = '--apply' in sys.argv
    if '--rollback' in sys.argv:
        bk = json.load(open(sys.argv[sys.argv.index('--rollback') + 1]))
        for doc in bk['docs']:
            name = doc['name'].split('/documents/')[1]
            s, b = call('PATCH', f'{B}/{name}', {'fields': doc['fields']})
            print('restored', name, s)
        for name in bk.get('created', []):
            s, _ = call('DELETE', f'{B}/{name}'); print('deleted', name, s)
        return

    # 1. Backup (always, also on dry run).
    os.makedirs(BACKUP_DIR, exist_ok=True)
    docs = {}
    for path in (f'plans/{PRO}', f'plans/{ELITE}', 'plans/proYearly', 'settings/commerce',
                 'launchSaleConfig/main'):
        s, b = call('GET', f'{B}/{path}')
        docs[path] = b if s == 200 else None
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    bf = f'{BACKUP_DIR}/plans-before-{stamp}.json'
    json.dump({'docs': [d for d in docs.values() if d],
               'created': [p for p in ('plans/proYearly', 'launchSaleConfig/main') if not docs[p]]},
              open(bf, 'w'), indent=1)
    print('backup:', bf)
    for path in (f'plans/{PRO}', f'plans/{ELITE}'):
        if not docs[path]: raise SystemExit('missing ' + path)
    if docs['plans/proYearly']: raise SystemExit('plans/proYearly already exists; stop and check')

    pro = docs[f'plans/{PRO}']['fields']
    el = docs[f'plans/{ELITE}']['fields']
    pro_old, pro_new = fixed_features(pro, PRO_FEATURE_FIXES, 'Pro')
    el_old, el_new = fixed_features(el, ELITE_FEATURE_FIXES, 'Elite')
    pro_changes = {**PRO_CHANGES, 'features': pro_new}
    elite_changes = {**ELITE_CHANGES, 'features': el_new}
    yearly = {'name': 'Pro', 'period': 'year', 'price': '490', 'salePrice': '149',
              'priceInr': '24990', 'salePriceInr': '5499', 'onSale': True,
              'saleLabel': 'Launch price', 'saleEndsAt': '', 'hidden': True, 'rank': 1,
              'chapterAccess': 'all', 'featured': False, 'ctaLabel': 'Join Pro yearly',
              'features': list(pro_new)}

    # Owner test account: resolve the full uid from its prefix (orders.studentUid).
    s, res = call('POST', f'{B}:runQuery', {'structuredQuery': {'from': [{'collectionId': 'orders'}],
                  'where': {'fieldFilter': {'field': {'fieldPath': 'couponCode'}, 'op': 'IN',
                            'value': enc(['TESTELITE', 'TESTPRO'])}}}})
    test_uids = sorted({x['document']['fields']['studentUid']['stringValue'] for x in res if 'document' in x})
    now_iso = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    cfg = {'active': True, 'startAt': {'__ts': now_iso}, 'limit': 100, 'planIds': [PRO, ELITE, 'proYearly'],
           'excludeUids': test_uids, 'excludeCoupons': ['TEST*']}

    print('\nPro   ', {k: (pro.get(k, {}).get('stringValue', pro.get(k, {}).get('booleanValue')), v) for k, v in PRO_CHANGES.items()})
    print('Elite ', {k: (el.get(k, {}).get('stringValue', el.get(k, {}).get('booleanValue')), v) for k, v in ELITE_CHANGES.items()})
    print('proYearly (new)', {k: v for k, v in yearly.items() if k != 'features'})
    print()
    show_features('Pro', pro_old, pro_new)
    show_features('Elite', el_old, el_new)
    print('proYearly features = Pro (new):', pro_new == yearly['features'])
    print('launchSaleConfig/main', {**cfg, 'excludeUids': [u[:6] + '…' for u in test_uids]})
    if not apply:
        print('\nDRY RUN: nothing written. Re-run with --apply on CoS go.')
        return

    patch(f'plans/{PRO}', pro_changes, docs[f'plans/{PRO}']['updateTime'])
    patch(f'plans/{ELITE}', elite_changes, docs[f'plans/{ELITE}']['updateTime'])
    s, b = call('PATCH', f'{B}/plans/proYearly?currentDocument.exists=false',
                {'fields': {k: enc(v) for k, v in yearly.items()}})
    if s != 200: raise SystemExit('FAILED proYearly ' + str(b))
    s, b = call('PATCH', f'{B}/launchSaleConfig/main', {'fields': {k: enc(v) for k, v in cfg.items()}})
    if s != 200: raise SystemExit('FAILED config ' + str(b))
    patch('settings/commerce', {'launchSale': {'active': True, 'limit': 100, 'taken': 0}})
    print('\nAPPLIED. Read back:')
    for path in (f'plans/{PRO}', f'plans/{ELITE}', 'plans/proYearly'):
        s, b = call('GET', f'{B}/{path}')
        f = b['fields']
        print(' ', path, {k: list(f[k].values())[0] for k in ('price', 'salePrice', 'priceInr', 'salePriceInr', 'onSale') if k in f})
        print('    features', [v.get('stringValue') for v in f.get('features', {}).get('arrayValue', {}).get('values', [])])


if __name__ == '__main__':
    main()
