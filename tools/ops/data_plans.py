#!/usr/bin/env python3
"""Data plans (Owner 11-04: "Make all indicators in pro free... L1 7$, L2 20$").
Creates plans/LiveDataL2 ($20 add-on), sets features on LiveData ($7), Free (rank 0 doc), and hides Pro monthly + proYearly
(hidden + archived; billing renews from the subscription, not the plan list). Prints a backup of every touched doc first.
Usage: FB_TOKEN_FILE=... python3 tools/ops/data_plans.py [--apply]
"""
import json, os, sys, urllib.request, urllib.parse

APPLY = '--apply' in sys.argv
T = open(os.environ['FB_TOKEN_FILE']).read().strip()
B = 'https://firestore.googleapis.com/v1/projects/strykertrades-e0cd8/databases/(default)/documents'


def req(url, data=None, method=None):
    r = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, method=method,
                               headers={'Authorization': 'Bearer ' + T, 'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(r))


def val(v):
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, list): return {'arrayValue': {'values': [val(x) for x in v]}}
    return {'stringValue': v}


def plain(f):
    out = {}
    for k, v in f.items():
        t, x = next(iter(v.items()))
        out[k] = [next(iter(i.values())) for i in x.get('values', [])] if t == 'arrayValue' else x
    return out


def patch(doc, fields, must_exist=True):
    q = '&'.join('updateMask.fieldPaths=' + urllib.parse.quote(k) for k in fields)
    q += '&currentDocument.exists=' + ('true' if must_exist else 'false')
    body = {'fields': {k: val(v) for k, v in fields.items()}}
    if not APPLY:
        print('DRY', doc, json.dumps(fields)[:300]); return
    r = req(B + '/plans/' + doc + '?' + q, body, 'PATCH')
    print('OK ', doc, json.dumps({k: plain(r['fields']).get(k) for k in fields})[:400])


docs = {d['name'].split('/')[-1]: d for d in req(B + '/plans?pageSize=100').get('documents', [])}
print('BACKUP', json.dumps({k: plain(d.get('fields', {})) for k, d in docs.items()}))
for k, d in docs.items():
    f = plain(d.get('fields', {}))
    print('PLAN', k, {x: f.get(x) for x in ('name', 'displayName', 'price', 'rank', 'hidden', 'archived', 'addon')})

pro_id = 'Sj1bjdpwvYJUVErjNMAb'
free_id = next((k for k, d in docs.items() if str(plain(d.get('fields', {})).get('rank', '')) == '0'
                and not plain(d.get('fields', {})).get('addon') and k not in ('LiveData', 'LiveDataL2')), None)
print('free doc:', free_id)
assert pro_id in docs and 'proYearly' in docs and 'LiveData' in docs and free_id, 'expected plan docs missing'
assert str(plain(docs['LiveData']['fields']).get('price')) == '7', 'LiveData price is not 7'

if 'LiveDataL2' not in docs:
    patch('LiveDataL2', {
        'name': 'L2 Data', 'displayName': 'L2 Data', 'price': '20', 'currency': 'USD', 'interval': 'month',
        'addon': True, 'hidden': True, 'rank': 0, 'archived': False,
        'features': ['Everything in L1 Data', 'The live order book: heatmap, DOM, Delta Ladder and the book tools',
                     'Wall Events, Book Speed and Liquidity Balance, live', 'Monthly, cancel any time']}, must_exist=False)
else:
    print('LiveDataL2 exists already:', plain(docs['LiveDataL2']['fields']))
patch('LiveData', {'features': ['Live CME futures trades, candles and best bid / ask',
                                'Footprint, Big Trades, delta and every L1 tool run live', 'Monthly, cancel any time']})
patch(free_id, {'features': ['Every ZoroCharts tool: footprint, delta, CVD, Big Trades, the order book tools and the Delta Ladder',
                             'GEX+ for SPX, SPY, QQQ, ES, NQ and gold (GC), every expiry',
                             'All 64 chapters, JournalX with import, broker sync and AI coach',
                             'Smart Money Desk, trading models, private indicators and the full community',
                             'CME futures 10 minutes delayed; crypto live']})
for p in (pro_id, 'proYearly'):
    patch(p, {'hidden': True, 'archived': True})
