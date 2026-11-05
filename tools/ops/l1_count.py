#!/usr/bin/env python3
"""Owner 06 Nov: "How many members use L1 rn". READ-ONLY: lists students docs, counts signed market-data agreements
(version v1 + nonProfessional true, same rule as functions/api/chart/_rt.js hasAgreementDoc) and active Pro (paid plan,
not expired/cancelled, paidThrough + grace). Prints counts only, no names or emails."""
import json, os, sys, time, urllib.request, urllib.error
T = open(os.environ['FB_TOKEN_FILE']).read().strip()
P = 'strykertrades-e0cd8'
B = f'https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents'
H = {'Authorization': 'Bearer ' + T, 'x-goog-user-project': P}
GRACE = 3 * 86400000


def get(url):
    try: return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=H)))
    except urllib.error.HTTPError as e: sys.exit('HTTP %s %s' % (e.code, e.read().decode()[:300]))


def v(x):
    if not x: return None
    for k in ('stringValue', 'booleanValue', 'integerValue', 'doubleValue', 'timestampValue'): 
        if k in x: return x[k]
    return x


paid = set()
for d in get(B + '/plans?pageSize=100').get('documents', []):
    f = d.get('fields', {})
    price = float(v(f.get('price')) or v(f.get('priceUsd')) or v(f.get('amount')) or 0)
    if price > 0:
        paid.add(d['name'].split('/')[-1].lower())
        if v(f.get('name')): paid.add(str(v(f.get('name'))).lower())
if not paid: paid = {'pro', 'elite'}

now = time.time() * 1000
docs, tok = [], ''
while True:
    j = get(B + '/students?pageSize=300' + ('&pageToken=' + tok if tok else ''))
    docs += j.get('documents', [])
    tok = j.get('nextPageToken')
    if not tok: break

tot = signed = pro = signed_free = signed7 = signed1 = demo = 0
for d in docs:
    f = d.get('fields', {})
    if v(f.get('demo')) is True: demo += 1; continue
    tot += 1
    m = (f.get('marketDataAgreement') or {}).get('mapValue', {}).get('fields', {})
    s = v(m.get('version')) == 'v1' and v(m.get('nonProfessional')) is True
    plan = str(v(f.get('plan')) or '').lower(); st = v(f.get('subscriptionStatus'))
    pt = float(v(f.get('paidThroughMillis')) or 0)
    ip = plan in paid and st not in ('expired', 'cancelled', 'canceled') and (v(f.get('foundingMember')) is True or not (pt > 0 and now > pt + GRACE))
    pro += ip
    if s:
        signed += 1; signed_free += (not ip)
        at = v(m.get('acceptedAt'))
        if isinstance(at, str):
            try:
                ts = time.mktime(time.strptime(at[:19], '%Y-%m-%dT%H:%M:%S')) * 1000
                signed7 += now - ts < 7 * 86400000; signed1 += now - ts < 86400000
            except Exception: pass
print(json.dumps({'members': tot, 'demo_excluded': demo, 'signed_agreement': signed, 'signed_not_pro': signed_free,
                  'signed_last_7d': signed7, 'signed_last_24h': signed1, 'active_pro': pro, 'paid_plans': sorted(paid)}))
