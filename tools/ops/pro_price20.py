#!/usr/bin/env python3
"""Pro price 19 -> 20 (Owner 11-04: "pro which has L2 remains same and price will be 20$").
PATCHes only plans/Sj1bjdpwvYJUVErjNMAb.price. Existing subscriptions keep the price they started on.
Usage: FB_TOKEN_FILE=... python3 tools/ops/pro_price20.py [--apply]
"""
import json, os, sys, urllib.request

APPLY = '--apply' in sys.argv
T = open(os.environ['FB_TOKEN_FILE']).read().strip()
D = 'https://firestore.googleapis.com/v1/projects/strykertrades-e0cd8/databases/(default)/documents/plans/Sj1bjdpwvYJUVErjNMAb'


def req(url, data=None, method=None):
    r = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, method=method,
                               headers={'Authorization': 'Bearer ' + T, 'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(r))


f = req(D)['fields']
print('BEFORE name', f['name']['stringValue'], 'price', f['price']['stringValue'], 'onSale', f.get('onSale'))
assert f['name']['stringValue'] == 'Pro' and f['price']['stringValue'] in ('19', '20')
if APPLY:
    out = req(D + '?updateMask.fieldPaths=price&currentDocument.exists=true', {'fields': {'price': {'stringValue': '20'}}}, 'PATCH')
    print('AFTER price', out['fields']['price']['stringValue'])
else:
    print('DRY would set price 20')
