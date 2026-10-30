#!/usr/bin/env python3
"""Creator Hub Storage rules tests (Rules :test API). usage: python3 tools/creator/storage-rules-test.py functions-src/storage.rules"""
import json, sys, os, urllib.request
src = open(sys.argv[1]).read()
T = open(os.path.expanduser('~/.hermes/profiles/web-temp-4/cache/scratch/.tok')).read().strip(); P = 'strykertrades-e0cd8'
D = '/databases/(default)/documents'
def m(fn, p, v): return {'function': 'firestore.' + fn, 'args': [{'exactValue': D + p}], 'result': {'value': v}}
FS = [m('get', '/communities/alpha', {'data': {'ownerUid': 'own', 'status': 'active'}})]
for u, role in (('own', 'owner'), ('adm', 'admin'), ('mem', 'member')):
    FS += [m('exists', f'/communities/alpha/members/{u}', True), m('get', f'/communities/alpha/members/{u}', {'data': {'role': role, 'status': 'active'}})]
FS += [m('exists', '/communities/alpha/files/f1', True), m('get', '/communities/alpha/files/f1', {'data': {'size': 20 * 1024 * 1024, 'ct': 'application/pdf'}}), m('exists', '/communities/alpha/files/nof', False), m('exists', '/communities/alpha/members/out', False), m('exists', '/admins/out', False), m('exists', '/admins/own', False), m('exists', '/admins/mem', False), m('exists', '/admins/adm', False)]
def tc(exp, name, method, path, uid, size=100, ct='image/png'):
    req = {'auth': {'uid': uid, 'token': {}} if uid else None, 'method': method, 'path': f'/b/{P}.firebasestorage.app/o/' + path}
    if method in ('create', 'update'): req['resource'] = {'size': size, 'contentType': ct}
    return name, {'expectation': exp, 'request': req, 'functionMocks': FS}
L = 'communities/alpha/branding/logo'; F = 'communities/alpha/files/f1'; MB = 1024 * 1024
cases = [tc('ALLOW', 'owner uploads logo', 'create', L, 'own'), tc('ALLOW', 'admin uploads cover', 'create', 'communities/alpha/branding/cover', 'adm', ct='image/webp'),
 tc('DENY', 'member uploads logo', 'create', L, 'mem'), tc('DENY', 'stranger uploads logo', 'create', L, 'out'), tc('DENY', 'signed-out uploads', 'create', L, None),
 tc('DENY', 'owner uploads 6 MB logo', 'create', L, 'own', size=6 * MB), tc('DENY', 'owner uploads svg', 'create', L, 'own', ct='image/svg+xml'),
 tc('DENY', 'owner uploads html as logo', 'create', L, 'own', ct='text/html'), tc('DENY', 'owner uploads other name', 'create', 'communities/alpha/branding/shell.png', 'own'),
 tc('ALLOW', 'signed-out reads logo', 'get', L, None), tc('DENY', 'member reads file through storage', 'get', F, 'mem'), tc('DENY', 'stranger reads file', 'get', F, 'out'), tc('DENY', 'signed-out reads file', 'get', F, None), tc('ALLOW', 'owner reads file', 'get', F, 'own'),
 tc('ALLOW', 'owner uploads reserved 20 MB pdf', 'create', F, 'own', size=20 * MB, ct='application/pdf'),
 tc('DENY', 'owner uploads with a different size than reserved', 'create', F, 'own', size=21 * MB, ct='application/pdf'),
 tc('DENY', 'owner uploads with a different type than reserved', 'create', F, 'own', size=20 * MB, ct='image/png'),
 tc('DENY', 'owner uploads with no reservation', 'create', 'communities/alpha/files/nof', 'own', size=20 * MB, ct='application/pdf'),
 tc('DENY', 'community admin uploads file (owner only)', 'create', F, 'adm', size=20 * MB, ct='application/pdf'),
 tc('DENY', 'member uploads file', 'create', F, 'mem', size=20 * MB, ct='application/pdf'),
 tc('DENY', 'file in a sub path', 'create', 'communities/alpha/files/f1/x', 'own', size=20 * MB, ct='application/pdf'),
 tc('ALLOW', 'owner deletes file', 'delete', F, 'own'), tc('DENY', 'member deletes file', 'delete', F, 'mem'),
 tc('DENY', 'random path write', 'create', 'other/x.png', 'own'), tc('DENY', 'random path read', 'get', 'other/x.png', 'own'),
 tc('DENY', 'member deletes logo', 'delete', L, 'mem'), tc('ALLOW', 'owner deletes logo', 'delete', L, 'own'),
 tc('ALLOW', 'owner uploads indicator shot', 'create', 'communities/alpha/shots/ind1/s0', 'own', ct='image/webp'),
 tc('DENY', 'admin uploads indicator shot', 'create', 'communities/alpha/shots/ind1/s0', 'adm'),
 tc('DENY', 'member uploads indicator shot', 'create', 'communities/alpha/shots/ind1/s0', 'mem'),
 tc('DENY', 'owner uploads 6 MB shot', 'create', 'communities/alpha/shots/ind1/s0', 'own', size=6 * MB),
 tc('DENY', 'owner uploads pine file as shot', 'create', 'communities/alpha/shots/ind1/s0', 'own', ct='text/plain'),
 tc('ALLOW', 'signed-out reads shot', 'get', 'communities/alpha/shots/ind1/s0', None)]
body = {'source': {'files': [{'name': 'storage.rules', 'content': src}]}, 'testSuite': {'testCases': [c[1] for c in cases]}}
r = urllib.request.Request(f'https://firebaserules.googleapis.com/v1/projects/{P}:test', data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + T, 'Content-Type': 'application/json', 'x-goog-user-project': P})
try: out = json.load(urllib.request.urlopen(r))
except urllib.error.HTTPError as e: print(e.code, e.read().decode()[:1500]); sys.exit(2)
if out.get('issues'): print('ISSUES', out['issues'])
bad = 0
for (n, t), res in zip(cases, out['testResults']):
    if res['state'] != 'SUCCESS': bad += 1; print('FAIL', t['expectation'], n, json.dumps(res)[:300])
print(f'{len(cases) - bad}/{len(cases)} passed'); sys.exit(1 if bad else 0)
