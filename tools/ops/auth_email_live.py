#!/usr/bin/env python3
"""Live test: call sendAuthEmail(reset) for the Owner's own address, as the site would."""
import json, urllib.request, urllib.error
u = 'https://us-central1-strykertrades-e0cd8.cloudfunctions.net/sendAuthEmail'
r = urllib.request.Request(u, json.dumps({'data': {'kind': 'reset', 'email': 'theelitegrey@gmail.com'}}).encode(),
                           {'Content-Type': 'application/json', 'Origin': 'https://tradezoro.com'})
try: print('STATUS', 200, urllib.request.urlopen(r, timeout=30).read().decode()[:300])
except urllib.error.HTTPError as e: print('STATUS', e.code, e.read().decode()[:300])
