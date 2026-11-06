#!/usr/bin/env python3
"""Zscript Script Library Firestore rules tests (Rules :test API, no data touched).
usage: python3 tools/zs-library/rules-test.py functions-src/firestore.rules <token file>
Token = OAuth access token with firebaserules scope (never printed). Same harness as tools/creator/rules-test.py: each case
lists the documents that exist BEFORE the write and AFTER it (what getAfter/existsAfter see in the same batch)."""
import json, sys, urllib.request, urllib.error, os
RULES = open(sys.argv[1]).read()
TOK = open(sys.argv[2] if len(sys.argv) > 2 else os.environ['FB_TOKEN_FILE']).read().strip()
P = 'strykertrades-e0cd8'
D = '/databases/(default)/documents'
TS = '2026-11-06T10:00:00Z'
OLD = '2026-11-01T10:00:00Z'
SID = 'A' * 20
Z = lambda *a: '/zsScripts/' + '/'.join((SID,) + a)
SHOT = 'https://firebasestorage.googleapis.com/v0/b/strykertrades-e0cd8.firebasestorage.app/o/zsShots%2Fau%2F' + SID + '%2Fs0.png?alt=media'
def auth(u): return None if u is None else {'uid': u, 'token': {'email': u + '@x.com', 'email_verified': True}}
def sc(**k):
    d = {'authorUid': 'au', 'authorName': 'Ana', 'name': 'Delta Bands', 'desc': 'Draws bands.', 'category': 'order-flow', 'dataUsed': ['flow'],
         'access': 'open', 'sale': {'mode': 'free', 'price': {'amount': 0, 'currency': 'USD'}}, 'shots': [], 'version': 1, 'versionNotes': '',
         'status': 'live', 'srcSize': 100, 'ratingSum': 0, 'ratingCount': 0, 'addCount': 0, 'modNote': '', 'createdAt': TS, 'updatedAt': TS, 'publishedAt': TS}
    d.update(k); return d
LIVE = sc(createdAt=OLD, publishedAt=OLD, updatedAt=OLD)
PAID = sc(createdAt=OLD, publishedAt=OLD, updatedAt=OLD, access='protected', sale={'mode': 'paid', 'price': {'amount': 19, 'currency': 'USD'}})
SRC = lambda n=1: {'version': n, 'source': '//@zscript 1\nplot(close)', 'createdAt': TS}
VER = lambda n=1: {'version': n, 'notes': '', 'createdAt': TS}
BIN = lambda n=1: {'version': n, 'sealed': {'alg': 'p256-hkdf-a256gcm', 'epk': 'e', 'iv': 'i', 'ct': 'c'}, 'createdAt': TS}
BASE = {'/admins/tz': {}, '/profiles/au': {'displayName': 'Ana'}, '/profiles/bu': {'displayName': 'Bo'}, '/creatorAccounts/au': {'status': 'active'}}
PEOPLE = ['au', 'bu', 'cu', 'tz']
def mocks(before, after):
    paths = set(before) | set(after) | set(BASE) | {Z(), '/creatorAccounts/bu', '/creatorAccounts/cu', '/profiles/cu', '/profiles/tz'}
    for u in PEOPLE:
        paths |= {'/admins/' + u, Z('buyers', u), Z('adds', u), Z('ratings', u)}
    for n in (1, 2):
        paths |= {Z('src', 'v%d' % n), Z('versions', 'v%d' % n), Z('bin', 'v%d' % n)}
    ms = []
    for pth in sorted(paths):
        for fn, world in (('exists', before), ('existsAfter', after), ('get', before), ('getAfter', after)):
            if fn.startswith('exists'):
                ms.append({'function': fn, 'args': [{'exactValue': D + pth}], 'result': {'value': pth in world}})
            elif pth in world:
                ms.append({'function': fn, 'args': [{'exactValue': D + pth}], 'result': {'value': {'data': world[pth]}}})
    return ms
cases = []
def case(exp, name, uid, method, path, new=None, old='auto', before=None, after=None):
    b = dict(BASE); b.update(before or {})
    for k in [k for k, v in b.items() if v is None]: del b[k]
    a = dict(b); a.update(after or {})
    for k in [k for k, v in a.items() if v is None]: del a[k]
    req = {'auth': auth(uid), 'method': method, 'path': D + path, 'time': TS}
    if new is not None: req['resource'] = {'data': new}
    t = {'expectation': exp, 'request': req, 'functionMocks': mocks(b, a)}
    if old == 'auto': old = b.get(path)
    if old is not None and method != 'create': t['resource'] = {'data': old}
    cases.append((name, t))
A, DN = 'ALLOW', 'DENY'

# ---------- publish v1 (batch: script + src + versions [+ bin]) ----------
NEW = sc()
pub_after = {Z(): NEW, Z('src', 'v1'): SRC(), Z('versions', 'v1'): VER()}
case(A, 'publish free open-source', 'au', 'create', Z(), NEW, after=pub_after)
case(A, 'publish: src in the batch', 'au', 'create', Z('src', 'v1'), SRC(), after=pub_after)
case(A, 'publish: versions in the batch', 'au', 'create', Z('versions', 'v1'), VER(), after=pub_after)
case(DN, 'publish without src', 'au', 'create', Z(), NEW, after={Z(): NEW, Z('versions', 'v1'): VER()})
case(DN, 'publish as someone else', 'bu', 'create', Z(), NEW, after=pub_after)
case(DN, 'signed-out publish', None, 'create', Z(), NEW, after=pub_after)
case(DN, 'publish with fake ratings', 'au', 'create', Z(), sc(ratingSum=50, ratingCount=10), after=pub_after)
case(DN, 'publish with fake adds', 'au', 'create', Z(), sc(addCount=999), after=pub_after)
case(DN, 'publish as removed/admin note', 'au', 'create', Z(), sc(modNote='ok'), after=pub_after)
case(DN, 'publish with a name not on my profile', 'au', 'create', Z(), sc(authorName='TradeZoro'), after=pub_after)
case(A, 'publish as "Member"', 'au', 'create', Z(), sc(authorName='Member'), after={**pub_after, Z(): sc(authorName='Member')})
case(DN, 'publish unknown category', 'au', 'create', Z(), sc(category='magic'), after=pub_after)
case(DN, 'publish unknown data tag', 'au', 'create', Z(), sc(dataUsed=['secret']), after=pub_after)
case(DN, 'publish extra key', 'au', 'create', Z(), {**NEW, 'featured': True}, after=pub_after)
case(DN, 'publish bad sid', 'au', 'create', '/zsScripts/short', NEW, after=pub_after)
case(DN, 'publish screenshot from another host', 'au', 'create', Z(), sc(shots=['https://evil.example/x.png']), after=pub_after)
case(A, 'publish own screenshot', 'au', 'create', Z(), sc(shots=[SHOT]), after={**pub_after, Z(): sc(shots=[SHOT])})
PNEW = sc(access='protected', sale={'mode': 'paid', 'price': {'amount': 19, 'currency': 'USD'}})
ppub = {Z(): PNEW, Z('src', 'v1'): SRC(), Z('versions', 'v1'): VER(), Z('bin', 'v1'): BIN()}
case(A, 'publish paid protected (payouts active)', 'au', 'create', Z(), PNEW, after=ppub)
case(A, 'publish: sealed bin in the batch', 'au', 'create', Z('bin', 'v1'), BIN(), after=ppub)
case(DN, 'publish protected without bin', 'au', 'create', Z(), PNEW, after={Z(): PNEW, Z('src', 'v1'): SRC(), Z('versions', 'v1'): VER()})
case(DN, 'bin on an open-source script', 'au', 'create', Z('bin', 'v1'), BIN(), after=pub_after)
case(DN, 'bin with plain text field', 'au', 'create', Z('bin', 'v1'), {**BIN(), 'source': 'x'}, after=ppub)
case(DN, 'paid without active payouts', 'au', 'create', Z(), PNEW, after=ppub, before={'/creatorAccounts/au': {'status': 'restricted'}})
case(DN, 'paid over $999', 'au', 'create', Z(), sc(sale={'mode': 'paid', 'price': {'amount': 1000, 'currency': 'USD'}}), after=ppub)
case(DN, 'paid in INR', 'au', 'create', Z(), sc(sale={'mode': 'paid', 'price': {'amount': 19, 'currency': 'INR'}}), after=ppub)
case(DN, 'free with a price', 'au', 'create', Z(), sc(sale={'mode': 'free', 'price': {'amount': 5, 'currency': 'USD'}}), after=pub_after)

# ---------- edits + versions ----------
case(A, 'author edits description', 'au', 'update', Z(), {**LIVE, 'desc': 'New', 'updatedAt': TS}, before={Z(): LIVE})
case(DN, 'other member edits', 'bu', 'update', Z(), {**LIVE, 'desc': 'New', 'updatedAt': TS}, before={Z(): LIVE})
case(DN, 'author bumps own ratings', 'au', 'update', Z(), {**LIVE, 'ratingSum': 5, 'ratingCount': 1, 'updatedAt': TS}, before={Z(): LIVE})
case(DN, 'author restores a taken-down script', 'au', 'update', Z(), {**LIVE, 'status': 'live', 'updatedAt': TS}, before={Z(): {**LIVE, 'status': 'removed', 'modNote': 'copied'}}, old={**LIVE, 'status': 'removed', 'modNote': 'copied'})
case(DN, 'author flips protected to open without a new version', 'au', 'update', Z(), {**PAID, 'access': 'open', 'updatedAt': TS}, before={Z(): PAID})
V2 = {**LIVE, 'version': 2, 'publishedAt': TS, 'updatedAt': TS}
case(A, 'author publishes v2 with src + versions', 'au', 'update', Z(), V2, before={Z(): LIVE}, after={Z(): V2, Z('src', 'v2'): SRC(2), Z('versions', 'v2'): VER(2)})
case(DN, 'v3 skipping v2', 'au', 'update', Z(), {**V2, 'version': 3}, before={Z(): LIVE}, after={Z(): {**V2, 'version': 3}})
case(DN, 'v2 without src', 'au', 'update', Z(), V2, before={Z(): LIVE}, after={Z(): V2, Z('versions', 'v2'): VER(2)})
case(DN, 'src for a version that is not the current one', 'au', 'create', Z('src', 'v2'), SRC(2), before={Z(): LIVE})
case(DN, 'src update (immutable)', 'au', 'update', Z('src', 'v1'), SRC(), before={Z(): LIVE, Z('src', 'v1'): SRC()})
case(DN, 'author deletes script (buyers keep it)', 'au', 'delete', Z(), before={Z(): LIVE})
case(A, 'admin deletes script', 'tz', 'delete', Z(), before={Z(): LIVE})

# ---------- reads ----------
case(A, 'signed-out reads live script', None, 'get', Z(), before={Z(): LIVE})
case(A, 'signed-out lists live', None, 'list', Z(), before={Z(): LIVE})
case(DN, 'signed-out reads removed', None, 'get', Z(), before={Z(): {**LIVE, 'status': 'removed'}})
case(A, 'author reads own removed', 'au', 'get', Z(), before={Z(): {**LIVE, 'status': 'removed'}})
case(A, 'member reads open-source src (free)', 'bu', 'get', Z('src', 'v1'), before={Z(): LIVE, Z('src', 'v1'): SRC()})
case(DN, 'signed-out reads open-source src', None, 'get', Z('src', 'v1'), before={Z(): LIVE, Z('src', 'v1'): SRC()})
case(DN, 'member reads old version src', 'bu', 'get', Z('src', 'v1'), before={Z(): {**LIVE, 'version': 2}, Z('src', 'v1'): SRC()})
case(DN, 'member reads protected src', 'bu', 'get', Z('src', 'v1'), before={Z(): PAID, Z('src', 'v1'): SRC()})
case(DN, 'BUYER reads protected src', 'bu', 'get', Z('src', 'v1'), before={Z(): PAID, Z('src', 'v1'): SRC(), Z('buyers', 'bu'): {'status': 'active'}})
case(A, 'author reads protected src', 'au', 'get', Z('src', 'v1'), before={Z(): PAID, Z('src', 'v1'): SRC()})
case(A, 'admin reads protected src', 'tz', 'get', Z('src', 'v1'), before={Z(): PAID, Z('src', 'v1'): SRC()})
case(DN, 'non-buyer reads paid bin', 'bu', 'get', Z('bin', 'v1'), before={Z(): PAID, Z('bin', 'v1'): BIN()})
case(A, 'buyer reads paid bin', 'bu', 'get', Z('bin', 'v1'), before={Z(): PAID, Z('bin', 'v1'): BIN(), Z('buyers', 'bu'): {'status': 'active'}})
case(DN, 'refunded buyer reads bin', 'bu', 'get', Z('bin', 'v1'), before={Z(): PAID, Z('bin', 'v1'): BIN(), Z('buyers', 'bu'): {'status': 'refunded'}})
case(DN, 'buyer reads bin of taken-down script', 'bu', 'get', Z('bin', 'v1'), before={Z(): {**PAID, 'status': 'removed'}, Z('bin', 'v1'): BIN(), Z('buyers', 'bu'): {'status': 'active'}})
case(DN, 'member lists bin', 'bu', 'list', Z('bin', 'v1'), before={Z(): PAID, Z('bin', 'v1'): BIN()})
case(DN, 'member writes himself a purchase', 'bu', 'create', Z('buyers', 'bu'), {'uid': 'bu', 'status': 'active'}, before={Z(): PAID})
case(DN, 'author grants a purchase', 'au', 'create', Z('buyers', 'bu'), {'uid': 'bu', 'status': 'active'}, before={Z(): PAID})
case(A, 'buyer reads own purchase', 'bu', 'get', Z('buyers', 'bu'), before={Z(): PAID, Z('buyers', 'bu'): {'status': 'active'}})
case(DN, 'member reads another purchase', 'cu', 'get', Z('buyers', 'bu'), before={Z(): PAID, Z('buyers', 'bu'): {'status': 'active'}})

# ---------- adds ----------
ADD = {'uid': 'bu', 'createdAt': TS}
add_after = {Z(): {**LIVE, 'addCount': 1}, Z('adds', 'bu'): ADD}
case(A, 'member adds free script (marker)', 'bu', 'create', Z('adds', 'bu'), ADD, before={Z(): LIVE}, after=add_after)
case(A, 'member adds free script (count +1)', 'bu', 'update', Z(), {**LIVE, 'addCount': 1}, before={Z(): LIVE}, after=add_after)
case(DN, 'count +5', 'bu', 'update', Z(), {**LIVE, 'addCount': 5}, before={Z(): LIVE}, after={**add_after, Z(): {**LIVE, 'addCount': 5}})
case(DN, 'count +1 twice (marker exists)', 'bu', 'update', Z(), {**LIVE, 'addCount': 1}, before={Z(): LIVE, Z('adds', 'bu'): ADD}, after=add_after)
case(DN, 'non-buyer adds paid script', 'bu', 'create', Z('adds', 'bu'), ADD, before={Z(): PAID}, after={Z(): {**PAID, 'addCount': 1}, Z('adds', 'bu'): ADD})

# ---------- ratings ----------
RT = {'uid': 'bu', 'stars': 4, 'text': 'Clear lines.', 'authorName': 'Bo', 'createdAt': TS, 'updatedAt': TS}
rbefore = {Z(): LIVE, Z('adds', 'bu'): ADD}
rafter = {Z(): {**LIVE, 'ratingSum': 4, 'ratingCount': 1}, Z('ratings', 'bu'): RT}
case(A, 'member who added rates (rating doc)', 'bu', 'create', Z('ratings', 'bu'), RT, before=rbefore, after=rafter)
case(A, 'member who added rates (sums)', 'bu', 'update', Z(), {**LIVE, 'ratingSum': 4, 'ratingCount': 1}, before=rbefore, after=rafter)
case(DN, 'rating sums inflated', 'bu', 'update', Z(), {**LIVE, 'ratingSum': 5, 'ratingCount': 1}, before=rbefore, after={**rafter, Z(): {**LIVE, 'ratingSum': 5, 'ratingCount': 1}})
case(DN, 'rate without adding it', 'bu', 'create', Z('ratings', 'bu'), RT, before={Z(): LIVE}, after=rafter)
case(DN, 'author rates own script', 'au', 'create', Z('ratings', 'au'), {**RT, 'uid': 'au', 'authorName': 'Ana'}, before={Z(): LIVE, Z('adds', 'au'): ADD}, after=rafter)
case(DN, 'rate for someone else', 'cu', 'create', Z('ratings', 'bu'), RT, before=rbefore, after=rafter)
case(DN, '6 stars', 'bu', 'create', Z('ratings', 'bu'), {**RT, 'stars': 6}, before=rbefore, after={Z(): {**LIVE, 'ratingSum': 6, 'ratingCount': 1}, Z('ratings', 'bu'): {**RT, 'stars': 6}})
case(DN, 'rating under a fake name', 'bu', 'create', Z('ratings', 'bu'), {**RT, 'authorName': 'TradeZoro'}, before=rbefore, after=rafter)
case(DN, 'non-buyer rates paid script', 'bu', 'create', Z('ratings', 'bu'), RT, before={Z(): PAID, Z('adds', 'bu'): ADD}, after={Z(): {**PAID, 'ratingSum': 4, 'ratingCount': 1}, Z('ratings', 'bu'): RT})
case(A, 'buyer rates paid script', 'bu', 'create', Z('ratings', 'bu'), RT, before={Z(): PAID, Z('buyers', 'bu'): {'status': 'active'}}, after={Z(): {**PAID, 'ratingSum': 4, 'ratingCount': 1}, Z('ratings', 'bu'): RT})
RTB = {**RT, 'createdAt': OLD, 'updatedAt': OLD}
R2 = {**RT, 'stars': 2, 'createdAt': OLD}
case(A, 'member changes rating 4 -> 2', 'bu', 'update', Z('ratings', 'bu'), R2, before={Z(): {**LIVE, 'ratingSum': 4, 'ratingCount': 1}, Z('adds', 'bu'): ADD, Z('ratings', 'bu'): RTB},
     after={Z(): {**LIVE, 'ratingSum': 2, 'ratingCount': 1}, Z('ratings', 'bu'): R2})
case(DN, 'member deletes a rating', 'bu', 'delete', Z('ratings', 'bu'), before={Z(): LIVE, Z('ratings', 'bu'): RTB})
case(A, 'admin deletes a rating', 'tz', 'delete', Z('ratings', 'bu'), before={Z(): LIVE, Z('ratings', 'bu'): RTB})

# ---------- moderation ----------
case(A, 'admin takes down with note', 'tz', 'update', Z(), {**LIVE, 'status': 'removed', 'modNote': 'Copied code'}, before={Z(): LIVE})
case(DN, 'admin edits description', 'tz', 'update', Z(), {**LIVE, 'desc': 'x'}, before={Z(): LIVE})
case(DN, 'member takes down', 'bu', 'update', Z(), {**LIVE, 'status': 'removed', 'modNote': 'x'}, before={Z(): LIVE})
REP = {'sid': SID, 'reporterUid': 'bu', 'reason': 'copied', 'note': '', 'status': 'open', 'createdAt': TS}
case(A, 'member reports', 'bu', 'create', '/zsReports/' + SID + '_bu', REP, before={Z(): LIVE})
case(DN, 'report under another id', 'bu', 'create', '/zsReports/' + SID + '_cu', REP, before={Z(): LIVE})
case(DN, 'report as someone else', 'cu', 'create', '/zsReports/' + SID + '_bu', REP, before={Z(): LIVE})
case(DN, 'report pre-closed', 'bu', 'create', '/zsReports/' + SID + '_bu', {**REP, 'status': 'dismissed'}, before={Z(): LIVE})
case(DN, 'member reads reports', 'bu', 'get', '/zsReports/' + SID + '_bu', before={'/zsReports/' + SID + '_bu': REP})
case(A, 'admin closes report', 'tz', 'update', '/zsReports/' + SID + '_bu', {**REP, 'status': 'actioned'}, before={'/zsReports/' + SID + '_bu': REP})

def run(batch):
    body = {'source': {'files': [{'name': 'firestore.rules', 'content': RULES}]}, 'testSuite': {'testCases': [t for _, t in batch]}}
    req = urllib.request.Request(f'https://firebaserules.googleapis.com/v1/projects/{P}:test', data=json.dumps(body).encode(),
                                 headers={'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json', 'x-goog-user-project': P})
    try:
        out = json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        print(e.code, e.read().decode()[:2500]); sys.exit(2)
    if out.get('issues'):
        print('ISSUES', json.dumps(out['issues'])[:1500])
        if any(i.get('severity') == 'ERROR' for i in out['issues']): sys.exit(3)
    return out.get('testResults', [])
fails = 0
for i in range(0, len(cases), 40):
    batch = cases[i:i + 40]
    for (name, t), res in zip(batch, run(batch)):
        ok = res['state'] == 'SUCCESS'; fails += not ok
        if not ok or os.environ.get('V'):
            print(('PASS' if ok else 'FAIL'), t['expectation'], name, '' if ok else json.dumps(res.get('errorPosition') or res.get('debugMessages') or res)[:260])
print(f'{len(cases) - fails}/{len(cases)} passed')
sys.exit(1 if fails else 0)
