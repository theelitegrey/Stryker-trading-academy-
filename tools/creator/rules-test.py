#!/usr/bin/env python3
"""Creator Hub Firestore rules tests (Rules :test API, no data touched).
usage: python3 tools/creator/rules-test.py <rules file> [token file]
Token = OAuth access token with firebaserules scope (never printed). Each case lists the documents that exist
BEFORE the write and the documents that exist AFTER it (what getAfter/existsAfter see in the same batch)."""
import json, sys, urllib.request, os
RULES = open(sys.argv[1]).read()
TOKF = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/.hermes/profiles/web-temp-4/cache/scratch/.tok')
TOK = open(TOKF).read().strip()
P = 'strykertrades-e0cd8'
D = '/databases/(default)/documents'
TS = '2026-10-30T10:00:00Z'
LATER = '2026-12-30T10:00:00Z'
SOON = '2026-10-30T09:00:00Z'
CID = 'alpha-desk'
USERS = {'own': 'owner@x.com', 'adm': 'cadmin@x.com', 'mod': 'mod@x.com', 'mem': 'mem@x.com', 'out': 'out@x.com', 'bad': 'bad@x.com', 'ts': 'ts@x.com', 'unv': 'unv@x.com'}
def auth(u, verified=True):
    if u is None: return None
    if u == 'tz': return {'uid': 'tz', 'token': {'email': 'tz@x.com', 'email_verified': True}}
    return {'uid': u, 'token': {'email': USERS.get(u, u + '@x.com'), 'email_verified': (u != 'unv') and verified}}
C = lambda *a: '/communities/' + '/'.join((CID,) + a) if a else '/communities/' + CID
def cm(**k):
    d = {'ownerUid': 'own', 'slug': CID, 'name': 'Alpha Desk', 'ownerName': 'Ana', 'tagline': 'Daily levels', 'about': 'About',
         'logoUrl': '', 'coverUrl': '', 'introVideo': '', 'accent': '#03c988', 'visibility': 'public',
         'features': {'feed': True, 'courses': False, 'indicators': False, 'events': False, 'leaderboard': False, 'discord': False},
         'tags': ['futures'], 'status': 'active', 'createdAt': TS, 'updatedAt': TS, 'memberCount': 5, 'founding': True,
         'rulesAcceptedAt': TS, 'rulesVersion': '2026-10-30'}
    d.update(k); return d
def member(uid, role='member', plan='p1', status='active', source='free', exp=None, **k):
    d = {'uid': uid, 'planId': plan, 'role': role, 'source': source, 'status': status, 'joinedAt': TS, 'expiresAt': exp, 'lastActiveAt': TS}
    d.update(k); return d
def plan(**k):
    d = {'name': 'Free', 'desc': 'd', 'bullets': ['a'], 'price': {'amount': 0, 'currency': 'USD', 'interval': 'free'}, 'trialDays': 0,
         'popular': False, 'status': 'live', 'joinMode': 'open', 'order': 0, 'updatedAt': TS}
    d.update(k); return d
PAID = plan(name='Pro', price={'amount': 29, 'currency': 'USD', 'interval': 'month'}, status='draft')
BASE = {
    '/admins/tz': {},
    C(): cm(),
    C('members', 'own'): member('own', 'owner', None, source='owner'),
    C('members', 'adm'): member('adm', 'admin'),
    C('members', 'mod'): member('mod', 'mod'),
    C('members', 'mem'): member('mem'),
    C('members', 'bad'): member('bad', status='banned'),
    C('plans', 'p1'): plan(),
    C('plans', 'p2'): plan(name='Inner', joinMode='invite'),
    C('plans', 'p3'): PAID,
    C('plans', 'p4'): plan(status='draft', name='Draft'),
    C('invites', 'GOODCODE123'): {'planId': 'p1', 'uses': 0, 'maxUses': 2, 'expiresAt': LATER, 'status': 'active', 'createdBy': 'own', 'createdAt': TS},
    C('invites', 'FULLCODE123'): {'planId': 'p1', 'uses': 2, 'maxUses': 2, 'expiresAt': LATER, 'status': 'active', 'createdBy': 'own', 'createdAt': TS},
    C('invites', 'OLDCODE1234'): {'planId': 'p1', 'uses': 0, 'maxUses': 0, 'expiresAt': SOON, 'status': 'active', 'createdBy': 'own', 'createdAt': TS},
    C('invites', 'REVOKED1234'): {'planId': 'p1', 'uses': 0, 'maxUses': 0, 'expiresAt': None, 'status': 'revoked', 'createdBy': 'own', 'createdAt': TS},
    C('invites', 'PAIDCODE123'): {'planId': 'p3', 'uses': 0, 'maxUses': 0, 'expiresAt': None, 'status': 'active', 'createdBy': 'own', 'createdAt': TS},
    C('invites', 'DAYSCODE123'): {'planId': 'p1', 'uses': 0, 'maxUses': 0, 'expiresAt': None, 'grantDays': 30, 'status': 'active', 'createdBy': 'own', 'createdAt': TS},
    C('grants', 'out@x.com'): {'email': 'out@x.com', 'planId': 'p3', 'expiresAt': LATER, 'createdBy': 'own', 'createdAt': TS},
    C('grants', 'unv@x.com'): {'email': 'unv@x.com', 'planId': 'p3', 'expiresAt': None, 'createdBy': 'own', 'createdAt': TS},
    C('bans', 'ts@x.com'): {'email': 'ts@x.com', 'createdBy': 'own', 'createdAt': TS},
    '/creatorMeta/own': {'count': 1, 'cid': 'old', 'updatedAt': TS},
    '/creatorMeta/full': {'count': 3, 'cid': 'old', 'updatedAt': TS},
}
CPATHS = set()
IID = 'ind00000000001'
IND = lambda *a: C('indicators', IID, *a) if a else C('indicators', IID)
def ind(**k):
    d = {'ownerUid': 'own', 'name': 'Mint Bands', 'desc': 'Bands', 'settingsNotes': '', 'tags': ['trend'], 'shots': [], 'protected': True,
         'planIds': ['p3'], 'solo': {'mode': 'invite', 'price': {'amount': 0, 'currency': 'USD'}}, 'version': 1, 'versionNotes': 'first',
         'status': 'live', 'createdAt': TS, 'updatedAt': TS, 'publishedAt': TS, 'srcSize': 400}
    d.update(k); return d
SEALED = {'alg': 'p256-hkdf-a256gcm', 'epk': 'AAAA', 'iv': 'BBBB', 'ct': 'CCCC'}
BASE.update({IND(): ind(), IND('src', 'v1'): {'version': 1, 'source': '//@version=5', 'notes': '', 'createdAt': TS},
             IND('vault', 'v1'): {'version': 1, 'sealed': SEALED, 'createdAt': TS},
             C('members', 'pro'): member('pro', plan='p3', source='invite'),
             C('members', 'proold'): member('proold', plan='p3', source='invite', exp=SOON),
             C('members', 'probad'): member('probad', plan='p3', status='banned'),
             IND('access', 'solo@x.com'): {'email': 'solo@x.com', 'source': 'manual', 'status': 'active', 'expiresAt': None, 'createdBy': 'own', 'createdAt': TS},
             IND('access', 'gone@x.com'): {'email': 'gone@x.com', 'source': 'manual', 'status': 'revoked', 'expiresAt': None, 'createdBy': 'own', 'createdAt': TS},
             IND('access', 'late@x.com'): {'email': 'late@x.com', 'source': 'manual', 'status': 'active', 'expiresAt': SOON, 'createdBy': 'own', 'createdAt': TS},
             IND('access', 'ts@x.com'): {'email': 'ts@x.com', 'source': 'manual', 'status': 'active', 'expiresAt': None, 'createdBy': 'own', 'createdAt': TS},
             IND('codes', 'INDCODE1234'): {'uses': 0, 'maxUses': 5, 'expiresAt': None, 'grantDays': 0, 'status': 'active', 'createdBy': 'own', 'createdAt': TS}})
USERS.update({'pro': 'pro@x.com', 'proold': 'proold@x.com', 'probad': 'probad@x.com', 'solo': 'solo@x.com', 'gone': 'gone@x.com', 'late': 'late@x.com'})
PEOPLE = list(USERS) + ['tz', 'newbie', 'full', 'zed']
EMAILS = list(USERS.values()) + ['newbie@x.com', 'zed@x.com']
def mocks(before, after):
    paths = set(before) | set(after) | set(BASE)
    for u in PEOPLE:
        paths |= {'/admins/' + u, '/moderators/' + u, C('members', u), '/creatorMeta/' + u}
    for e in EMAILS:
        paths |= {C('bans', e), C('grants', e)}
    paths |= {'/slugs/' + CID, '/slugs/newslug', C('plans', 'p1'), C('plans', 'p1'), '/communities/newslug', '/creatorMeta/newbie', '/creatorMeta/zed'}
    for pth in ('/communities/newslug/members/newbie', '/communities/newslug/members/zed', '/communities/newslug/members/full'):
        paths.add(pth)
    for e in EMAILS:
        paths.add(IND('access', e))
    paths |= CPATHS
    paths |= {IND(), IND('src', 'v1'), IND('src', 'v2'), IND('vault', 'v1'), IND('vault', 'v2'), IND('codes', 'INDCODE1234')}
    ms = []
    for pth in sorted(paths):
        for fn, world in (('exists', before), ('existsAfter', after), ('get', before), ('getAfter', after)):
            if fn.startswith('exists'):
                ms.append({'function': fn, 'args': [{'exactValue': D + pth}], 'result': {'value': pth in world}})
            elif pth in world:
                ms.append({'function': fn, 'args': [{'exactValue': D + pth}], 'result': {'value': {'data': world[pth]}}})
    return ms
cases = []
def case(exp, name, uid, method, path, new=None, old='auto', before=None, after=None, verified=True):
    b = dict(BASE); b.update(before or {})
    for k in [k for k, v in b.items() if v is None]: del b[k]
    a = dict(b); a.update(after or {})
    for k in [k for k, v in a.items() if v is None]: del a[k]
    req = {'auth': auth(uid, verified), 'method': method, 'path': D + path, 'time': TS}
    if new is not None: req['resource'] = {'data': new}
    t = {'expectation': exp, 'request': req, 'functionMocks': mocks(b, a)}
    if old == 'auto': old = b.get(path)
    if old is not None and method != 'create': t['resource'] = {'data': old}
    cases.append((name, t))
A, DN = 'ALLOW', 'DENY'

# ---------- create a community (batch: slug + community + owner member + creatorMeta) ----------
NS = '/communities/newslug'
ncm = cm(ownerUid='newbie', slug='newslug', memberCount=1)
create_after = {'/slugs/newslug': {'ownerUid': 'newbie', 'createdAt': TS}, NS: ncm,
                NS + '/members/newbie': member('newbie', 'owner', None, source='owner'),
                '/creatorMeta/newbie': {'count': 1, 'cid': 'newslug', 'updatedAt': TS}}
def cc(exp, name, uid='newbie', new=ncm, after=None, before=None):
    aa = dict(create_after); aa.update(after or {})
    case(exp, name, uid, 'create', NS, new=new, old=None, before=before, after=aa)
cc(A, 'create community (first)')
cc(DN, 'create: signed out', uid=None)
cc(DN, 'create: ownerUid is somebody else', new=dict(ncm, ownerUid='out'))
cc(DN, 'create: slug mismatch', new=dict(ncm, slug='other'))
cc(DN, 'create: not founding', new=dict(ncm, founding=False))
cc(DN, 'create: memberCount 50', new=dict(ncm, memberCount=50))
cc(DN, 'create: suspended status', new=dict(ncm, status='suspended'))
cc(DN, 'create: bad accent', new=dict(ncm, accent='red'))
cc(DN, 'create: javascript logo', new=dict(ncm, logoUrl='javascript:alert(1)'))
cc(DN, 'create: intro video on random host', new=dict(ncm, introVideo='https://evil.example/x'))
cc(A, 'create: youtube intro video', new=dict(ncm, introVideo='https://www.youtube.com/watch?v=abc123'))
cc(DN, 'create: 4 tags', new=dict(ncm, tags=['futures', 'forex', 'crypto', 'ict']))
cc(DN, 'create: unknown tag', new=dict(ncm, tags=['memes']))
cc(DN, 'create: extra field', new=dict(ncm, verified=True))
cc(DN, 'create: name too short', new=dict(ncm, name='ab'))
cc(DN, 'create: no slug reservation in batch', after={'/slugs/newslug': None})
cc(DN, 'create: no owner member in batch', after={NS + '/members/newbie': None})
cc(DN, 'create: no quota bump in batch', after={'/creatorMeta/newbie': None})
cc(DN, 'create: quota bump wrong cid', after={'/creatorMeta/newbie': {'count': 1, 'cid': 'zzz', 'updatedAt': TS}})
cc(DN, 'create: 4th community (quota full)', uid='full', new=dict(ncm, ownerUid='full'),
   after={'/creatorMeta/full': {'count': 4, 'cid': 'newslug', 'updatedAt': TS}, NS + '/members/full': member('full', 'owner', None, source='owner')})
cc(A, 'create: 2nd community (quota 1 -> 2)', uid='own', new=dict(ncm, ownerUid='own'),
   after={'/creatorMeta/own': {'count': 2, 'cid': 'newslug', 'updatedAt': TS}, NS + '/members/own': member('own', 'owner', None, source='owner'), '/slugs/newslug': {'ownerUid': 'own', 'createdAt': TS}})
cc(DN, 'create: quota jumps by 2', uid='own', new=dict(ncm, ownerUid='own'),
   after={'/creatorMeta/own': {'count': 3, 'cid': 'newslug', 'updatedAt': TS}, NS + '/members/own': member('own', 'owner', None, source='owner'), '/slugs/newslug': {'ownerUid': 'own', 'createdAt': TS}})
for bad in ('admin', 'api', 'c', 'creator', 'tradezoro'):
    case(DN, f'create: reserved slug {bad}', 'newbie', 'create', '/communities/' + bad, new=dict(ncm, slug=bad), old=None,
         after={'/slugs/' + bad: {'ownerUid': 'newbie', 'createdAt': TS}, '/communities/' + bad: dict(ncm, slug=bad), '/communities/%s/members/newbie' % bad: member('newbie', 'owner', None, source='owner'),
                '/creatorMeta/newbie': {'count': 1, 'cid': bad, 'updatedAt': TS}})
for bad in ('Ab-cd', 'a', 'ab', 'abc--def', 'abc-', '-abc'):
    case(DN, f'create: bad slug {bad!r}', 'newbie', 'create', '/communities/' + bad, new=dict(ncm, slug=bad), old=None)
case(DN, 'create: slug already taken', 'newbie', 'create', '/slugs/' + CID, new={'ownerUid': 'newbie', 'createdAt': TS}, old=None,
     after={'/slugs/' + CID: {'ownerUid': 'newbie', 'createdAt': TS}})
case(A, 'read slug (signed in)', 'newbie', 'get', '/slugs/' + CID, old={'ownerUid': 'own', 'createdAt': TS})
case(DN, 'read slug (signed out)', None, 'get', '/slugs/' + CID, old={'ownerUid': 'own', 'createdAt': TS})
case(DN, 'list slugs', 'newbie', 'list', '/slugs/' + CID, old={'ownerUid': 'own'})
case(DN, 'creatorMeta: user resets own count', 'own', 'update', '/creatorMeta/own', new={'count': 0, 'cid': 'x', 'updatedAt': TS})
case(DN, 'creatorMeta: read others', 'out', 'get', '/creatorMeta/own')
case(A, 'creatorMeta: read own', 'own', 'get', '/creatorMeta/own')

# ---------- reads ----------
case(A, 'public community: signed out get', None, 'get', C())
case(A, 'public community: list (directory) by anyone', None, 'list', C())
case(A, 'private community: signed-in stranger get (invite holder)', 'out', 'get', C(), old=cm(visibility='private'))
case(DN, 'private community: signed-out get', None, 'get', C(), old=cm(visibility='private'))
case(A, 'private community: member get', 'mem', 'get', C(), old=cm(visibility='private'))
case(A, 'unlisted: stranger get', 'out', 'get', C(), old=cm(visibility='unlisted'))
case(DN, 'unlisted: list', 'out', 'list', C(), old=cm(visibility='unlisted'))
case(A, 'private: owner list own', 'own', 'list', C(), old=cm(visibility='private'))
case(DN, 'private: stranger list', 'out', 'list', C(), old=cm(visibility='private'))
case(A, 'live plan: signed out', None, 'get', C('plans', 'p1'))
case(DN, 'draft plan: stranger', 'out', 'get', C('plans', 'p4'))
case(DN, 'draft plan: signed out', None, 'get', C('plans', 'p4'))
case(A, 'draft plan: owner', 'own', 'get', C('plans', 'p4'))
case(A, 'draft plan: community admin', 'adm', 'get', C('plans', 'p4'))
case(DN, 'draft plan: plain member', 'mem', 'get', C('plans', 'p4'))

case(A, 'grants collection group: my own email', 'out', 'list', C('grants', 'out@x.com'))
case(DN, 'grants collection group: somebody elses email', 'mem', 'list', C('grants', 'out@x.com'))
case(DN, 'grants collection group: unverified', 'unv', 'list', C('grants', 'unv@x.com'))
case(A, 'join with a display name', 'zed', 'create', C('members', 'zed'), new=member('zed', displayName='Zed'), old=None, after={C('members', 'zed'): member('zed', displayName='Zed'), C(): cm(memberCount=6)})
case(DN, 'join with a 61-char display name', 'zed', 'create', C('members', 'zed'), new=member('zed', displayName='z' * 61), old=None, after={C('members', 'zed'): member('zed'), C(): cm(memberCount=6)})

# ---------- owner edits ----------
case(A, 'owner edits tagline', 'own', 'update', C(), new=cm(tagline='New', updatedAt=TS))
case(DN, 'owner edit: memberCount to 1000', 'own', 'update', C(), new=cm(memberCount=1000, updatedAt=TS))
case(DN, 'owner edit: un-suspend', 'own', 'update', C(), old=cm(status='suspended'), new=cm(status='active', updatedAt=TS))
case(DN, 'owner edit: transfer ownerUid', 'own', 'update', C(), new=cm(ownerUid='out', updatedAt=TS))
case(DN, 'owner edit: change slug', 'own', 'update', C(), new=cm(slug='zz', updatedAt=TS))
case(DN, 'owner edit: founding off/on', 'own', 'update', C(), old=cm(founding=False), new=cm(founding=True, updatedAt=TS))
case(DN, 'owner edit: bad video host', 'own', 'update', C(), new=cm(introVideo='http://a.b/c', updatedAt=TS))
case(A, 'owner edit: vimeo video', 'own', 'update', C(), new=cm(introVideo='https://vimeo.com/123456', updatedAt=TS))
case(A, 'owner edit: features off', 'own', 'update', C(), new=cm(features={'feed': False, 'courses': False, 'indicators': False, 'events': False, 'leaderboard': False, 'discord': False}, updatedAt=TS))
case(DN, 'owner edit: unknown feature key', 'own', 'update', C(), new=cm(features={'feed': True, 'bank': True}, updatedAt=TS))
case(DN, 'community admin edits settings', 'adm', 'update', C(), new=cm(tagline='x', updatedAt=TS))
case(DN, 'stranger edits', 'out', 'update', C(), new=cm(tagline='x', updatedAt=TS))
case(DN, 'signed out edits', None, 'update', C(), new=cm(tagline='x', updatedAt=TS))
case(DN, 'owner deletes community', 'own', 'delete', C())
case(A, 'TradeZoro admin deletes community', 'tz', 'delete', C())
case(A, 'TradeZoro admin suspends', 'tz', 'update', C(), new=cm(status='suspended', suspendedReason='scam', suspendedAt=TS, updatedAt=TS))
case(DN, 'TradeZoro admin edits content', 'tz', 'update', C(), new=cm(name='Hacked name', updatedAt=TS))
case(DN, 'stranger suspends', 'out', 'update', C(), new=cm(status='suspended', suspendedReason='x', suspendedAt=TS, updatedAt=TS))

# ---------- joining ----------
M = C('members', 'zed')
def jn(exp, name, uid, mdoc, extra_after=None, before=None, cdoc=None, verified=True, community_after=None):
    aa = {M if uid == 'zed' else C('members', uid): mdoc, C(): community_after or cm(memberCount=6)}
    aa.update(extra_after or {})
    case(exp, name, uid, 'create', C('members', uid), new=mdoc, old=None, before=before, after=aa, verified=verified)
jn(A, 'join open free plan', 'zed', member('zed'))
case(DN, 'join free: signed out', None, 'create', C('members', 'zed'), new=member('zed'), old=None, after={C('members', 'zed'): member('zed'), C(): cm(memberCount=6)})
case(DN, 'join: for somebody else', 'zed', 'create', C('members', 'newbie'), new=member('newbie'), old=None, after={C('members', 'newbie'): member('newbie'), C(): cm(memberCount=6)})
jn(DN, 'join: paid plan (self-grant)', 'zed', member('zed', plan='p3'))
jn(DN, 'join: draft plan', 'zed', member('zed', plan='p4'))
jn(DN, 'join: invite-only plan without invite', 'zed', member('zed', plan='p2'))
jn(DN, 'join: role admin', 'zed', member('zed', role='admin'))
jn(DN, 'join: role owner', 'zed', member('zed', role='owner'))
jn(DN, 'join: source paid', 'zed', member('zed', source='paid'))
jn(DN, 'join: with expiry', 'zed', member('zed', exp=LATER))
jn(DN, 'join: memberCount not incremented', 'zed', member('zed'), community_after=cm(memberCount=5))
jn(DN, 'join: memberCount +5', 'zed', member('zed'), community_after=cm(memberCount=10))
jn(DN, 'join: suspended community', 'zed', member('zed'), before={C(): cm(status='suspended')})
jn(DN, 'join: private community', 'zed', member('zed'), before={C(): cm(visibility='private')})
jn(DN, 'join: banned email', 'ts', member('ts'))
jn(A, 'join: unlisted community', 'zed', member('zed'), before={C(): cm(visibility='unlisted')}, community_after=cm(visibility='unlisted', memberCount=6))
jn(DN, 'join: extra field', 'zed', dict(member('zed'), vip=True))
jn(DN, 'join: already a member (create on existing = update)', 'mem', member('mem'))

# ---------- invites ----------
def inv(exp, name, uid, code, mdoc, uses_after=1, before=None, extra=None):
    i = dict(BASE.get(C('invites', code)) or {'planId': 'p1', 'uses': 0, 'maxUses': 0, 'expiresAt': None, 'status': 'active', 'createdBy': 'own', 'createdAt': TS}); i.update((before or {}).get(C('invites', code)) or {})
    ia = dict(i, uses=i['uses'] + uses_after)
    aa = {C('members', uid): mdoc, C('invites', code): ia, C(): cm(memberCount=6)}
    aa.update(extra or {})
    case(exp, name, uid, 'create', C('members', uid), new=mdoc, old=None, before=before, after=aa)
im = lambda uid, code, **k: member(uid, source='invite', inviteCode=code, **k)
inv(A, 'redeem good invite (free plan)', 'zed', 'GOODCODE123', im('zed', 'GOODCODE123'))
inv(A, 'redeem invite for a PAID plan', 'zed', 'PAIDCODE123', im('zed', 'PAIDCODE123', plan='p3'))
inv(DN, 'redeem: used up', 'zed', 'FULLCODE123', im('zed', 'FULLCODE123'))
inv(DN, 'redeem: expired', 'zed', 'OLDCODE1234', im('zed', 'OLDCODE1234'))
inv(DN, 'redeem: revoked', 'zed', 'REVOKED1234', im('zed', 'REVOKED1234'))
inv(DN, 'redeem: uses not incremented', 'zed', 'GOODCODE123', im('zed', 'GOODCODE123'), uses_after=0)
inv(DN, 'redeem: uses bumped by 2', 'zed', 'GOODCODE123', im('zed', 'GOODCODE123'), uses_after=2)
inv(DN, 'redeem: wrong plan for the code', 'zed', 'GOODCODE123', im('zed', 'GOODCODE123', plan='p3'))
inv(DN, 'redeem: banned email', 'ts', 'GOODCODE123', im('ts', 'GOODCODE123'))
inv(DN, 'redeem: role admin', 'zed', 'GOODCODE123', im('zed', 'GOODCODE123', role='admin'))
inv(DN, 'redeem: unknown code', 'zed', 'NOSUCHCODE1', im('zed', 'NOSUCHCODE1'), extra={C('invites', 'NOSUCHCODE1'): None})
inv(A, 'redeem 30-day code with 30-day expiry', 'zed', 'DAYSCODE123', im('zed', 'DAYSCODE123', exp='2026-11-29T10:00:00Z'))
inv(DN, 'redeem 30-day code with no expiry', 'zed', 'DAYSCODE123', im('zed', 'DAYSCODE123'))
inv(DN, 'redeem 30-day code with 1-year expiry', 'zed', 'DAYSCODE123', im('zed', 'DAYSCODE123', exp='2027-10-30T10:00:00Z'))
inv(DN, 'redeem works in private community? (no: invite is fine)'.replace('works in private community? (no: invite is fine)', 'redeem into suspended community'), 'zed', 'GOODCODE123', im('zed', 'GOODCODE123'), before={C(): cm(status='suspended')})
inv(A, 'redeem into private community (invite is the way in)', 'zed', 'GOODCODE123', im('zed', 'GOODCODE123'), before={C(): cm(visibility='private')}, extra={C(): cm(visibility='private', memberCount=6)})

# ---------- email grants ----------
def gr(exp, name, uid, mdoc, grant_gone=True, verified=True, before=None):
    g = C('grants', USERS.get(uid, uid + '@x.com'))
    aa = {C('members', uid): mdoc, C(): cm(memberCount=6)}
    aa[g] = None if grant_gone else BASE.get(g)
    case(exp, name, uid, 'create', C('members', uid), new=mdoc, old=None, before=before, after=aa, verified=verified)
gr(A, 'claim my email grant (paid plan)', 'out', member('out', plan='p3', source='import', exp=LATER))
gr(DN, 'claim: grant not consumed', 'out', member('out', plan='p3', source='import', exp=LATER), grant_gone=False)
gr(DN, 'claim: different plan than the grant', 'out', member('out', plan='p1', source='import', exp=LATER))
gr(DN, 'claim: longer expiry than the grant', 'out', member('out', plan='p3', source='import', exp='2030-01-01T00:00:00Z'))
gr(DN, 'claim: no expiry when grant has one', 'out', member('out', plan='p3', source='import'))
gr(DN, 'claim: unverified email', 'unv', member('unv', plan='p3', source='import'))
gr(DN, 'claim: no grant for me', 'zed', member('zed', plan='p3', source='import'))
gr(DN, 'claim: banned email', 'out', member('out', plan='p3', source='import', exp=LATER), before={C('bans', 'out@x.com'): {'email': 'out@x.com', 'createdBy': 'own', 'createdAt': TS}})
case(A, 'owner creates grant', 'own', 'create', C('grants', 'new@x.com'), new={'email': 'new@x.com', 'planId': 'p3', 'expiresAt': None, 'createdBy': 'own', 'createdAt': TS}, old=None)
case(A, 'community admin creates grant', 'adm', 'create', C('grants', 'new@x.com'), new={'email': 'new@x.com', 'planId': 'p3', 'expiresAt': LATER, 'createdBy': 'adm', 'createdAt': TS}, old=None)
case(DN, 'member creates grant', 'mem', 'create', C('grants', 'new@x.com'), new={'email': 'new@x.com', 'planId': 'p3', 'expiresAt': None, 'createdBy': 'mem', 'createdAt': TS}, old=None)
case(DN, 'grant for non-existent plan', 'own', 'create', C('grants', 'new@x.com'), new={'email': 'new@x.com', 'planId': 'nope', 'expiresAt': None, 'createdBy': 'own', 'createdAt': TS}, old=None)
case(DN, 'grant with upper-case email id', 'own', 'create', C('grants', 'New@x.com'), new={'email': 'New@x.com', 'planId': 'p3', 'expiresAt': None, 'createdBy': 'own', 'createdAt': TS}, old=None)
case(A, 'grantee reads own grant', 'out', 'get', C('grants', 'out@x.com'))
case(DN, 'stranger reads grant', 'mem', 'get', C('grants', 'out@x.com'))
case(DN, 'list grants as member', 'mem', 'list', C('grants', 'out@x.com'))
case(A, 'list grants as owner', 'own', 'list', C('grants', 'out@x.com'))

# ---------- member management ----------
case(A, 'member touches own lastActiveAt', 'mem', 'update', C('members', 'mem'), new=member('mem'))
case(DN, 'member upgrades own plan', 'mem', 'update', C('members', 'mem'), new=member('mem', plan='p3'))
case(DN, 'member makes himself admin', 'mem', 'update', C('members', 'mem'), new=member('mem', role='admin'))
case(DN, 'member clears own expiry', 'mem', 'update', C('members', 'mem'), old=member('mem', exp=LATER), new=member('mem'))
case(DN, 'banned member un-bans himself', 'bad', 'update', C('members', 'bad'), new=member('bad', status='active'))
case(A, 'owner changes member plan', 'own', 'update', C('members', 'mem'), new=member('mem', plan='p3'))
case(A, 'owner extends expiry', 'own', 'update', C('members', 'mem'), new=member('mem', exp=LATER))
case(A, 'owner expires a member', 'own', 'update', C('members', 'mem'), new=member('mem', status='expired'))
case(A, 'owner makes a mod', 'own', 'update', C('members', 'mem'), new=member('mem', role='mod'))
case(A, 'owner makes an admin', 'own', 'update', C('members', 'mem'), new=member('mem', role='admin'))
case(DN, 'owner makes somebody owner', 'own', 'update', C('members', 'mem'), new=member('mem', role='owner'))
case(DN, 'community admin makes another admin', 'adm', 'update', C('members', 'mem'), new=member('mem', role='admin'))
case(A, 'community admin changes a member plan', 'adm', 'update', C('members', 'mem'), new=member('mem', plan='p3'))
case(A, 'community admin bans a member', 'adm', 'update', C('members', 'mem'), new=member('mem', status='banned'))
case(DN, 'community admin edits owner row', 'adm', 'update', C('members', 'own'), new=dict(BASE[C('members', 'own')], status='banned'))
case(DN, 'owner edits own owner row to member', 'own', 'update', C('members', 'own'), new=dict(BASE[C('members', 'own')], role='member'))
case(DN, 'mod changes a member plan', 'mod', 'update', C('members', 'mem'), new=member('mem', plan='p3'))
case(DN, 'plain member edits other member', 'mem', 'update', C('members', 'adm'), new=member('adm', role='member'))
case(DN, 'stranger edits member', 'out', 'update', C('members', 'mem'), new=member('mem', plan='p3'))
case(DN, 'owner sets uid field', 'own', 'update', C('members', 'mem'), new=dict(member('mem'), uid='out'))
case(A, 'member reads own doc', 'mem', 'get', C('members', 'mem'))
case(DN, 'member reads other member doc', 'mem', 'get', C('members', 'adm'))
case(A, 'mod reads member doc', 'mod', 'get', C('members', 'mem'))
case(A, 'owner lists members', 'own', 'list', C('members', 'mem'))
case(DN, 'member lists other members', 'mem', 'list', C('members', 'adm'))
case(DN, 'signed out reads member', None, 'get', C('members', 'mem'))
case(A, 'collection-group: my memberships', 'mem', 'list', C('members', 'mem'))
LEAVE_AFTER = {C('members', 'mem'): None, C(): cm(memberCount=4)}
case(A, 'member leaves (count -1)', 'mem', 'delete', C('members', 'mem'), after=LEAVE_AFTER)
case(DN, 'member leaves without count -1', 'mem', 'delete', C('members', 'mem'), after={C('members', 'mem'): None})
case(DN, 'owner row cannot leave', 'own', 'delete', C('members', 'own'), after={C('members', 'own'): None, C(): cm(memberCount=4)})
case(DN, 'banned member leaves to dodge ban', 'bad', 'delete', C('members', 'bad'), after={C('members', 'bad'): None, C(): cm(memberCount=4)})
case(A, 'owner removes member (count -1)', 'own', 'delete', C('members', 'mem'), after=LEAVE_AFTER)
case(A, 'community admin removes member', 'adm', 'delete', C('members', 'mem'), after=LEAVE_AFTER)
case(DN, 'owner removes member w/o count -1', 'own', 'delete', C('members', 'mem'), after={C('members', 'mem'): None})
case(DN, 'stranger removes member', 'out', 'delete', C('members', 'mem'), after=LEAVE_AFTER)
case(DN, 'mod removes member', 'mod', 'delete', C('members', 'mem'), after=LEAVE_AFTER)
case(A, 'owner decrements memberCount (remove member batch)', 'own', 'update', C(), new=cm(memberCount=4), after={C('members', 'mem'): None})
case(DN, 'owner decrements memberCount by 3', 'own', 'update', C(), new=cm(memberCount=2))
case(DN, 'stranger decrements memberCount', 'out', 'update', C(), new=cm(memberCount=4))
case(A, 'member leave: count -1 on community', 'mem', 'update', C(), new=cm(memberCount=4), after={C('members', 'mem'): None})
case(A, 'owner adjusts own display count -1 (display only)', 'own', 'update', C(), new=cm(memberCount=4), after={C('members', 'own'): None}, before={})
case(DN, 'stranger increments memberCount with no member doc', 'out', 'update', C(), new=cm(memberCount=6))
case(A, 'joiner increments memberCount with member doc', 'zed', 'update', C(), new=cm(memberCount=6), after={C('members', 'zed'): member('zed')})
case(DN, 'joiner increments by 2', 'zed', 'update', C(), new=cm(memberCount=7), after={C('members', 'zed'): member('zed')})
case(DN, 'existing member increments again', 'mem', 'update', C(), new=cm(memberCount=6))

# ---------- plans ----------
PN = plan(name='Gold', price={'amount': 49, 'currency': 'USD', 'interval': 'month'}, status='draft', order=2)
case(A, 'owner creates paid draft plan', 'own', 'create', C('plans', 'p2'), new=PN, old=None)
case(A, 'owner publishes paid plan (stored; checkout is off)', 'own', 'update', C('plans', 'p3'), new=dict(PAID, status='live', updatedAt=TS))
case(A, 'community admin creates plan', 'adm', 'create', C('plans', 'p3'), new=PN, old=None)
case(DN, 'member creates plan', 'mem', 'create', C('plans', 'p2'), new=PN, old=None)
case(DN, 'stranger creates plan', 'out', 'create', C('plans', 'p2'), new=PN, old=None)
case(DN, 'plan id not p1..p8', 'own', 'create', C('plans', 'free-for-all'), new=PN, old=None)
case(DN, 'plan: free with price', 'own', 'create', C('plans', 'p2'), new=plan(price={'amount': 5, 'currency': 'USD', 'interval': 'free'}), old=None)
case(DN, 'plan: paid with 0 price', 'own', 'create', C('plans', 'p2'), new=plan(price={'amount': 0, 'currency': 'USD', 'interval': 'month'}), old=None)
case(DN, 'plan: negative price', 'own', 'create', C('plans', 'p2'), new=plan(price={'amount': -1, 'currency': 'USD', 'interval': 'month'}), old=None)
case(DN, 'plan: crazy currency', 'own', 'create', C('plans', 'p2'), new=plan(price={'amount': 9, 'currency': 'BTC', 'interval': 'month'}), old=None)
case(DN, 'plan: unknown interval', 'own', 'create', C('plans', 'p2'), new=plan(price={'amount': 9, 'currency': 'USD', 'interval': 'daily'}), old=None)
case(DN, 'plan: trial 200 days', 'own', 'create', C('plans', 'p2'), new=plan(trialDays=200), old=None)
case(DN, 'plan: extra field', 'own', 'create', C('plans', 'p2'), new=dict(plan(), stripePrice='x'), old=None)
case(DN, 'plan: 9 bullets', 'own', 'create', C('plans', 'p2'), new=plan(bullets=['a'] * 9), old=None)
case(DN, 'plan: status paid', 'own', 'create', C('plans', 'p2'), new=plan(status='paid'), old=None)
case(A, 'owner deletes plan', 'own', 'delete', C('plans', 'p4'))
case(DN, 'member deletes plan', 'mem', 'delete', C('plans', 'p4'))

# ---------- invites (staff side) ----------
NI = {'planId': 'p1', 'uses': 0, 'maxUses': 10, 'expiresAt': LATER, 'status': 'active', 'createdBy': 'own', 'createdAt': TS}
case(A, 'owner creates invite', 'own', 'create', C('invites', 'AbCdEf12345'), new=NI, old=None)
case(A, 'admin creates invite', 'adm', 'create', C('invites', 'AbCdEf12345'), new=dict(NI, createdBy='adm'), old=None)
case(DN, 'member creates invite', 'mem', 'create', C('invites', 'AbCdEf12345'), new=dict(NI, createdBy='mem'), old=None)
case(DN, 'invite with pre-set uses', 'own', 'create', C('invites', 'AbCdEf12345'), new=dict(NI, uses=5), old=None)
case(DN, 'invite short code', 'own', 'create', C('invites', 'abc'), new=NI, old=None)
case(DN, 'invite for missing plan', 'own', 'create', C('invites', 'AbCdEf12345'), new=dict(NI, planId='nope'), old=None)
case(DN, 'invite createdBy spoof', 'own', 'create', C('invites', 'AbCdEf12345'), new=dict(NI, createdBy='adm'), old=None)
case(A, 'owner revokes invite', 'own', 'update', C('invites', 'GOODCODE123'), new=dict(BASE[C('invites', 'GOODCODE123')], status='revoked'))
case(DN, 'member revokes invite', 'mem', 'update', C('invites', 'GOODCODE123'), new=dict(BASE[C('invites', 'GOODCODE123')], status='revoked'))
case(DN, 'owner sets uses back to 0', 'own', 'update', C('invites', 'FULLCODE123'), new=dict(BASE[C('invites', 'FULLCODE123')], uses=0))
case(DN, 'stranger bumps uses with no member doc', 'out', 'update', C('invites', 'GOODCODE123'), new=dict(BASE[C('invites', 'GOODCODE123')], uses=1))
case(A, 'redeemer bumps uses with member doc in batch', 'zed', 'update', C('invites', 'GOODCODE123'), new=dict(BASE[C('invites', 'GOODCODE123')], uses=1), after={C('members', 'zed'): im('zed', 'GOODCODE123')})
case(A, 'signed-in reads one invite by code', 'zed', 'get', C('invites', 'GOODCODE123'))
case(DN, 'signed-out reads invite', None, 'get', C('invites', 'GOODCODE123'))
case(DN, 'member lists invites', 'mem', 'list', C('invites', 'GOODCODE123'))
case(A, 'owner lists invites', 'own', 'list', C('invites', 'GOODCODE123'))

# ---------- bans ----------
BN = {'email': 'zed@x.com', 'createdBy': 'own', 'createdAt': TS}
case(A, 'owner bans email', 'own', 'create', C('bans', 'zed@x.com'), new=BN, old=None)
case(DN, 'member bans email', 'mem', 'create', C('bans', 'zed@x.com'), new=dict(BN, createdBy='mem'), old=None)
case(DN, 'read bans as member', 'mem', 'get', C('bans', 'ts@x.com'))
case(DN, 'read own ban', 'ts', 'get', C('bans', 'ts@x.com'))
case(A, 'owner reads bans', 'own', 'get', C('bans', 'ts@x.com'))
case(A, 'owner lifts ban', 'own', 'delete', C('bans', 'ts@x.com'))

# ---------- reports ----------
RP = {'targetType': 'community', 'cid': CID, 'reporterUid': 'out', 'reason': 'scam', 'note': 'looks fake', 'status': 'open', 'createdAt': TS}
case(A, 'report a community', 'out', 'create', '/creatorReports/community_%s_out' % CID, new=RP, old=None)
case(DN, 'report as someone else', 'out', 'create', '/creatorReports/community_%s_out' % CID, new=dict(RP, reporterUid='mem'), old=None)
case(DN, 'report with wrong id (spam many)', 'out', 'create', '/creatorReports/anything', new=RP, old=None)
case(DN, 'report signed out', None, 'create', '/creatorReports/community_%s_out' % CID, new=RP, old=None)
case(DN, 'report for missing community', 'out', 'create', '/creatorReports/community_nope_out', new=dict(RP, cid='nope'), old=None)
case(DN, 'report bad reason', 'out', 'create', '/creatorReports/community_%s_out' % CID, new=dict(RP, reason='dislike'), old=None)
case(DN, 'report status closed', 'out', 'create', '/creatorReports/community_%s_out' % CID, new=dict(RP, status='closed'), old=None)
case(DN, 'reporter reads reports', 'out', 'get', '/creatorReports/community_%s_out' % CID, old=RP)
case(DN, 'creator reads reports about him', 'own', 'get', '/creatorReports/community_%s_out' % CID, old=RP)
case(A, 'TradeZoro admin reads reports', 'tz', 'get', '/creatorReports/community_%s_out' % CID, old=RP)
case(A, 'TradeZoro admin closes report', 'tz', 'update', '/creatorReports/community_%s_out' % CID, old=RP, new=dict(RP, status='closed'))


# ---------- Phase B: indicators ----------
NOW_DAY = 20756  # int(TS ms / 86400000) for 2026-10-30
V = IND('vault', 'v1')
case(A, 'ind: signed-out reads live metadata (public community)', None, 'get', IND())
case(A, 'ind: stranger lists live indicators', 'out', 'list', IND())
case(DN, 'ind: stranger reads a draft', 'out', 'get', IND(), before={IND(): ind(status='draft')})
case(A, 'ind: owner reads a draft', 'own', 'get', IND(), before={IND(): ind(status='draft')})
case(DN, 'ind: private community, non-member reads metadata', 'out', 'get', IND(), before={C(): cm(visibility='private')})
case(A, 'ind: private community, solo buyer reads metadata', 'solo', 'get', IND(), before={C(): cm(visibility='private')})
case(DN, 'ind: suspended community metadata', 'out', 'get', IND(), before={C(): cm(status='suspended')})
# source: owner only
for who in ('adm', 'mod', 'mem', 'pro', 'solo', 'out', None, 'tz'):
    case(DN, 'ind src: %s reads plain source' % who, who, 'get', IND('src', 'v1'))
case(A, 'ind src: owner reads plain source', 'own', 'get', IND('src', 'v1'))
case(A, 'ind src: owner lists versions', 'own', 'list', IND('src', 'v1'))
case(DN, 'ind src: member lists versions', 'pro', 'list', IND('src', 'v1'))
# vault: only people with access right now
case(A, 'vault: member on included plan', 'pro', 'get', V)
case(DN, 'vault: member on another plan', 'mem', 'get', V)
case(DN, 'vault: expired member', 'proold', 'get', V)
case(DN, 'vault: banned member', 'probad', 'get', V)
case(A, 'vault: solo buyer (manual grant)', 'solo', 'get', V)
case(DN, 'vault: solo buyer, email not verified', 'solo', 'get', V, verified=False)
case(DN, 'vault: revoked grant', 'gone', 'get', V)
case(DN, 'vault: grant expired', 'late', 'get', V)
case(DN, 'vault: grant but banned by email', 'ts', 'get', V)
case(DN, 'vault: stranger', 'out', 'get', V)
case(DN, 'vault: signed out', None, 'get', V)
case(DN, 'vault: list', 'pro', 'list', V)
case(A, 'vault: owner', 'own', 'get', V)
case(DN, 'vault: indicator hidden', 'pro', 'get', V, before={IND(): ind(status='hidden')})
case(DN, 'vault: community suspended', 'pro', 'get', V, before={C(): cm(status='suspended')})
case(A, 'vault: plan added later (p1 member, planIds p1+p3)', 'mem', 'get', V, before={IND(): ind(planIds=['p1', 'p3'])})
# publish
pub_after = {IND('src', 'v1'): BASE[IND('src', 'v1')], IND('vault', 'v1'): BASE[IND('vault', 'v1')]}
NEWI = ind(); 
case(A, 'publish: owner creates v1 with src + vault', 'own', 'create', IND(), new=NEWI, old=None, before={IND(): None, IND('src', 'v1'): None, IND('vault', 'v1'): None}, after=pub_after)
case(DN, 'publish: without vault in batch', 'own', 'create', IND(), new=NEWI, old=None, before={IND(): None, IND('src', 'v1'): None, IND('vault', 'v1'): None}, after={IND('src', 'v1'): BASE[IND('src', 'v1')]})
case(DN, 'publish: community admin (not owner)', 'adm', 'create', IND(), new=ind(), old=None, before={IND(): None, IND('src', 'v1'): None, IND('vault', 'v1'): None}, after=pub_after)
case(DN, 'publish: member', 'mem', 'create', IND(), new=ind(ownerUid='mem'), old=None, before={IND(): None, IND('src', 'v1'): None, IND('vault', 'v1'): None}, after=pub_after)
case(DN, 'publish: 5 screenshots', 'own', 'create', IND(), new=ind(shots=['https://a.b/1'] * 5), old=None, before={IND(): None, IND('src', 'v1'): None, IND('vault', 'v1'): None}, after=pub_after)
case(A, 'publish: 4 screenshots', 'own', 'create', IND(), new=ind(shots=['https://a.b/1'] * 4), old=None, before={IND(): None, IND('src', 'v1'): None, IND('vault', 'v1'): None}, after=pub_after)
case(DN, 'publish: paid solo with 0 price', 'own', 'create', IND(), new=ind(solo={'mode': 'paid', 'price': {'amount': 0, 'currency': 'USD'}}), old=None, before={IND(): None, IND('src', 'v1'): None, IND('vault', 'v1'): None}, after=pub_after)
case(A, 'publish: paid solo with price (stored, checkout off)', 'own', 'create', IND(), new=ind(solo={'mode': 'paid', 'price': {'amount': 49, 'currency': 'USD'}}), old=None, before={IND(): None, IND('src', 'v1'): None, IND('vault', 'v1'): None}, after=pub_after)
case(DN, 'publish: starts at version 2', 'own', 'create', IND(), new=ind(version=2), old=None, before={IND(): None, IND('src', 'v1'): None, IND('vault', 'v1'): None}, after=pub_after)
case(A, 'src: owner writes v1', 'own', 'create', IND('src', 'v1'), new={'version': 1, 'source': 'x', 'notes': '', 'createdAt': TS}, old=None, before={IND('src', 'v1'): None})
case(DN, 'src: owner overwrites v1', 'own', 'update', IND('src', 'v1'), new={'version': 1, 'source': 'y', 'notes': '', 'createdAt': TS})
case(DN, 'src: member writes', 'mem', 'create', IND('src', 'v2'), new={'version': 2, 'source': 'x', 'notes': '', 'createdAt': TS}, old=None)
case(A, 'vault: owner writes v2', 'own', 'create', IND('vault', 'v2'), new={'version': 2, 'sealed': SEALED, 'createdAt': TS}, old=None)
case(DN, 'vault: owner writes plain source into vault', 'own', 'create', IND('vault', 'v2'), new={'version': 2, 'sealed': SEALED, 'source': 'plain', 'createdAt': TS}, old=None)
case(DN, 'vault: member writes', 'pro', 'create', IND('vault', 'v2'), new={'version': 2, 'sealed': SEALED, 'createdAt': TS}, old=None)
v2_after = {IND('src', 'v2'): {'version': 2, 'source': 'x', 'notes': '', 'createdAt': TS}, IND('vault', 'v2'): {'version': 2, 'sealed': SEALED, 'createdAt': TS}}
case(A, 'new version: v2 with src + vault', 'own', 'update', IND(), new=ind(version=2, versionNotes='fix'), after=v2_after)
case(DN, 'new version: v2 without vault', 'own', 'update', IND(), new=ind(version=2), after={IND('src', 'v2'): v2_after[IND('src', 'v2')]})
case(DN, 'new version: jump to v3', 'own', 'update', IND(), new=ind(version=3), after=v2_after)
case(A, 'edit metadata (same version)', 'own', 'update', IND(), new=ind(desc='new text', planIds=['p1']))
case(DN, 'edit: change createdAt', 'own', 'update', IND(), new=ind(createdAt=LATER))
case(DN, 'edit: member edits', 'pro', 'update', IND(), new=ind(desc='hacked'))
case(A, 'TradeZoro admin hides indicator', 'tz', 'update', IND(), new=ind(status='hidden'))
# access grants
AC = lambda e: IND('access', e)
grant = lambda e, **k: dict({'email': e, 'source': 'manual', 'status': 'active', 'expiresAt': None, 'createdBy': 'own', 'createdAt': TS}, **k)
case(A, 'access: owner grants by email', 'own', 'create', AC('zed@x.com'), new=grant('zed@x.com'), old=None)
case(A, 'access: admin grants with expiry', 'adm', 'create', AC('zed@x.com'), new=grant('zed@x.com', createdBy='adm', expiresAt=LATER), old=None)
case(DN, 'access: member grants himself', 'mem', 'create', AC('mem@x.com'), new=grant('mem@x.com', createdBy='mem'), old=None)
case(DN, 'access: member grants himself as "free" on invite-mode', 'mem', 'create', AC('mem@x.com'), new=grant('mem@x.com', createdBy='mem', source='free'), old=None)
case(A, 'access: free solo claim by verified user', 'out', 'create', AC('out@x.com'), new=grant('out@x.com', createdBy='out', source='free'), old=None, before={IND(): ind(solo={'mode': 'free', 'price': {'amount': 0, 'currency': 'USD'}})})
case(DN, 'access: free claim, unverified', 'out', 'create', AC('out@x.com'), new=grant('out@x.com', createdBy='out', source='free'), old=None, verified=False, before={IND(): ind(solo={'mode': 'free', 'price': {'amount': 0, 'currency': 'USD'}})})
case(DN, 'access: free claim for someone else', 'out', 'create', AC('zed@x.com'), new=grant('zed@x.com', createdBy='out', source='free'), old=None, before={IND(): ind(solo={'mode': 'free', 'price': {'amount': 0, 'currency': 'USD'}})})
case(DN, 'access: free claim on paid solo', 'out', 'create', AC('out@x.com'), new=grant('out@x.com', createdBy='out', source='free'), old=None, before={IND(): ind(solo={'mode': 'paid', 'price': {'amount': 9, 'currency': 'USD'}})})
case(DN, 'access: free claim by banned email', 'ts', 'create', AC('ts@x.com'), new=grant('ts@x.com', createdBy='ts', source='free'), old=None, before={IND(): ind(solo={'mode': 'free', 'price': {'amount': 0, 'currency': 'USD'}}), AC('ts@x.com'): None})
case(DN, 'access: paid source from client', 'out', 'create', AC('out@x.com'), new=grant('out@x.com', createdBy='out', source='paid'), old=None)
code_after = {IND('codes', 'INDCODE1234'): dict(BASE[IND('codes', 'INDCODE1234')], uses=1)}
case(A, 'access: redeem indicator code', 'out', 'create', AC('out@x.com'), new=grant('out@x.com', createdBy='out', source='invite', code='INDCODE1234'), old=None, after=code_after)
case(DN, 'access: redeem without uses+1', 'out', 'create', AC('out@x.com'), new=grant('out@x.com', createdBy='out', source='invite', code='INDCODE1234'), old=None)
case(DN, 'access: redeem used-up code', 'out', 'create', AC('out@x.com'), new=grant('out@x.com', createdBy='out', source='invite', code='INDCODE1234'), old=None,
     before={IND('codes', 'INDCODE1234'): dict(BASE[IND('codes', 'INDCODE1234')], uses=5)}, after={IND('codes', 'INDCODE1234'): dict(BASE[IND('codes', 'INDCODE1234')], uses=6)})
case(A, 'code: uses+1 in the redeem batch', 'out', 'update', IND('codes', 'INDCODE1234'), new=dict(BASE[IND('codes', 'INDCODE1234')], uses=1),
     after={AC('out@x.com'): grant('out@x.com', createdBy='out', source='invite', code='INDCODE1234')})
case(DN, 'code: uses+1 without access doc', 'out', 'update', IND('codes', 'INDCODE1234'), new=dict(BASE[IND('codes', 'INDCODE1234')], uses=1))
case(DN, 'code: member resets uses', 'out', 'update', IND('codes', 'INDCODE1234'), new=dict(BASE[IND('codes', 'INDCODE1234')], uses=0, maxUses=0))
case(A, 'code: owner creates', 'own', 'create', IND('codes', 'NEWCODE1234'), new=dict(BASE[IND('codes', 'INDCODE1234')]), old=None)
case(DN, 'code: member creates', 'mem', 'create', IND('codes', 'NEWCODE1234'), new=dict(BASE[IND('codes', 'INDCODE1234')], createdBy='mem'), old=None)
case(A, 'access: owner revokes', 'own', 'update', AC('solo@x.com'), new=dict(BASE[AC('solo@x.com')], status='revoked'))
case(DN, 'access: holder extends own expiry', 'late', 'update', AC('late@x.com'), new=dict(BASE[AC('late@x.com')], expiresAt=LATER))
case(DN, 'access: holder un-revokes', 'gone', 'update', AC('gone@x.com'), new=dict(BASE[AC('gone@x.com')], status='active'))
case(A, 'access: holder reads own grant', 'solo', 'get', AC('solo@x.com'))
case(DN, 'access: member lists grants', 'mem', 'list', AC('solo@x.com'))
case(A, 'access: owner lists grants', 'own', 'list', AC('solo@x.com'))
case(A, 'access: collection-group list of my grants', 'solo', 'list', '/communities/x/indicators/y/access/solo@x.com', old=BASE[AC('solo@x.com')])
case(DN, 'access: collection-group list of others', 'out', 'list', '/communities/x/indicators/y/access/solo@x.com', old=BASE[AC('solo@x.com')])
# usage
case(A, 'usage: holder marks today', 'pro', 'create', IND('usage', 'pro'), new={'day': NOW_DAY, 'at': TS}, old=None)
case(DN, 'usage: holder marks another day', 'pro', 'create', IND('usage', 'pro'), new={'day': NOW_DAY + 3, 'at': TS}, old=None)
case(DN, 'usage: no access', 'mem', 'create', IND('usage', 'mem'), new={'day': NOW_DAY, 'at': TS}, old=None)
case(DN, 'usage: for someone else', 'pro', 'create', IND('usage', 'mem'), new={'day': NOW_DAY, 'at': TS}, old=None)
case(A, 'usage: owner lists', 'own', 'list', IND('usage', 'pro'), old={'day': NOW_DAY, 'at': TS})
case(DN, 'usage: member lists', 'pro', 'list', IND('usage', 'pro'), old={'day': NOW_DAY, 'at': TS})
# ---------- creator payments (Stripe Connect): money fields are functions-only ----------
ACC = {'acct': 'acct_1', 'status': 'pending', 'chargesEnabled': False, 'payoutsEnabled': False, 'live': False}
case(A, 'pay: creator reads own payout status', 'own', 'get', '/creatorAccounts/own', old=ACC)
case(DN, 'pay: stranger reads creator payout status', 'out', 'get', '/creatorAccounts/own', old=ACC)
case(DN, 'pay: signed out reads payout status', None, 'get', '/creatorAccounts/own', old=ACC)
case(A, 'pay: TradeZoro admin reads payout status', 'tz', 'get', '/creatorAccounts/own', old=ACC)
case(A, 'pay: TradeZoro admin lists payout status', 'tz', 'list', '/creatorAccounts/own', old=ACC)
case(DN, 'pay: creator lists all payout records', 'own', 'list', '/creatorAccounts/own', old=ACC)
case(DN, 'pay: creator marks himself active', 'own', 'update', '/creatorAccounts/own', old=ACC, new=dict(ACC, status='active', chargesEnabled=True, payoutsEnabled=True))
case(DN, 'pay: creator creates own payout record', 'newbie', 'create', '/creatorAccounts/newbie', old=None, new=dict(ACC, status='active'))
case(DN, 'pay: creator deletes own payout record', 'own', 'delete', '/creatorAccounts/own', old=ACC)
SALE = {'creatorUid': 'own', 'buyerUid': 'mem', 'cid': CID, 'planId': 'p3', 'amountCents': 2900, 'status': 'paid', 'live': False}
case(A, 'pay: creator reads own sale', 'own', 'get', '/creatorSales/inv_1', old=SALE)
case(A, 'pay: creator lists own sales', 'own', 'list', '/creatorSales/inv_1', old=SALE)
case(DN, 'pay: buyer reads the creator sale record', 'mem', 'get', '/creatorSales/inv_1', old=SALE)
case(DN, 'pay: stranger lists sales', 'out', 'list', '/creatorSales/inv_1', old=SALE)
case(A, 'pay: admin reads sale', 'tz', 'get', '/creatorSales/inv_1', old=SALE)
case(DN, 'pay: buyer writes a sale', 'mem', 'create', '/creatorSales/inv_x', old=None, new=dict(SALE, creatorUid='mem'))
case(DN, 'pay: creator edits a sale (hide a refund)', 'own', 'update', '/creatorSales/inv_1', old=SALE, new=dict(SALE, status='paid', amountCents=99900))
for col in ('creatorSubs', 'creatorSessions', 'creatorCustomers', 'creatorPrices', 'creatorEvents'):
    case(DN, f'pay: owner reads {col}', 'own', 'get', f'/{col}/x', old={'buyerUid': 'own', 'creatorUid': 'own'})
    case(DN, f'pay: user writes {col}', 'mem', 'create', f'/{col}/x', old=None, new={'buyerUid': 'mem'})
# buyers can never grant themselves a paid membership
PM = member('zed', plan='p3', source='paid', pay={'status': 'active', 'subId': 'sub_1'})
case(DN, 'pay: buyer creates own paid member doc', 'zed', 'create', C('members', 'zed'), new=PM, old=None, after={C('members', 'zed'): PM, C(): cm(memberCount=6)})
case(DN, 'pay: join FREE route but on the paid plan', 'zed', 'create', C('members', 'zed'), new=member('zed', plan='p3', source='free'), old=None,
     after={C('members', 'zed'): member('zed', plan='p3'), C(): cm(memberCount=6)}, before={C('plans', 'p3'): dict(PAID, status='live')})
case(DN, 'pay: join free with a pay map', 'zed', 'create', C('members', 'zed'), new=member('zed', pay={'status': 'active'}), old=None,
     after={C('members', 'zed'): member('zed'), C(): cm(memberCount=6)})
PAIDMEM = member('mem', plan='p3', source='paid', exp=SOON, pay={'status': 'past_due'})
case(DN, 'pay: member extends own expiry', 'mem', 'update', C('members', 'mem'), before={C('members', 'mem'): PAIDMEM}, old=PAIDMEM, new=dict(PAIDMEM, expiresAt=LATER))
case(DN, 'pay: member edits own pay status', 'mem', 'update', C('members', 'mem'), before={C('members', 'mem'): PAIDMEM}, old=PAIDMEM, new=dict(PAIDMEM, pay={'status': 'active'}))
case(DN, 'pay: member switches own plan', 'mem', 'update', C('members', 'mem'), before={C('members', 'mem'): PAIDMEM}, old=PAIDMEM, new=dict(PAIDMEM, planId='p1'))
case(DN, 'pay: creator forges pay map on a member', 'own', 'update', C('members', 'mem'), before={C('members', 'mem'): PAIDMEM}, old=PAIDMEM, new=dict(PAIDMEM, pay={'status': 'active', 'subId': 'fake'}))
case(DN, 'pay: creator sets source paid', 'own', 'update', C('members', 'mem'), old=member('mem'), new=member('mem', source='paid'))
# community seller flags + refund rule
case(DN, 'pay: owner sets sellerReady himself', 'own', 'update', C(), new=cm(sellerReady=True, sellerStatus='active', updatedAt=TS))
case(A, 'pay: owner sets a refund rule', 'own', 'update', C(), new=cm(refundRule='7-day refund if you have not opened the course.', updatedAt=TS))
case(DN, 'pay: refund rule too long', 'own', 'update', C(), new=cm(refundRule='x' * 301, updatedAt=TS))
case(DN, 'pay: refund rule not a string', 'own', 'update', C(), new=cm(refundRule=7, updatedAt=TS))
case(A, 'pay: owner edits tagline when seller flags exist', 'own', 'update', C(), old=cm(sellerReady=True, sellerStatus='active'), new=cm(sellerReady=True, sellerStatus='active', tagline='z', updatedAt=TS))
case(DN, 'pay: admin unlocks seller via suspend path', 'tz', 'update', C(), new=cm(sellerReady=True, updatedAt=TS))


# ---------- courses (Phase C) ----------
CR, M1, M2, L1, L2, L3, LD, LM2 = 'crs000000001', 'mod000000001', 'mod000000002', 'les000000001', 'les000000002', 'les000000003', 'les000000004', 'les000000005'
CRP = lambda *a: C('courses', CR, *a) if a else C('courses', CR)
def course(**k):
    d = {'ownerUid': 'own', 'title': 'Intro', 'desc': 'd', 'coverUrl': '', 'status': 'published', 'access': {'mode': 'plans', 'planIds': ['p3']},
         'solo': {'mode': 'off', 'price': {'amount': 0, 'currency': 'USD'}}, 'sequential': False, 'order': 0, 'rulesVersion': '2026-10-30', 'createdAt': TS, 'updatedAt': TS}
    d.update(k); return d
def lesson(mid=M1, **k):
    d = {'moduleId': mid, 'title': 'Lesson', 'type': 'video', 'order': 0, 'status': 'published', 'preview': False, 'drip': {'mode': 'none', 'days': 0, 'at': None},
         'prev': '', 'mins': 5, 'thumb': '', 'hasQuiz': False, 'updatedAt': TS}
    d.update(k); return d
NODRIP = {'mode': 'none', 'days': 0, 'at': None}
def module(**k):
    d = {'title': 'Module', 'order': 0, 'status': 'published', 'planIds': [], 'drip': NODRIP, 'updatedAt': TS}
    d.update(k); return d
VID = {'url': 'https://www.youtube.com/watch?v=abc123', 'provider': 'youtube'}
def body(t='video', **k):
    d = {'type': t, 'attachments': [], 'updatedAt': TS}
    if t == 'video': d['video'] = VID
    d.update(k); return d
BODY = lambda l: CRP('lessons', l, 'content', 'body')
CBASE = {CRP(): course(), CRP('modules', M1): module(), CRP('modules', M2): module(planIds=['p2']),
         CRP('lessons', L1): lesson(preview=True), CRP('lessons', L2): lesson(order=1), CRP('lessons', L3): lesson(order=2, prev=L2),
         CRP('lessons', LD): lesson(order=3, drip={'mode': 'days', 'days': 7, 'at': None}), CRP('lessons', LM2): lesson(M2),
         BODY(L1): body(), BODY(L2): body(), BODY(L3): body(), BODY(LD): body(), BODY(LM2): body(),
         CRP('access', 'solo@x.com'): {'email': 'solo@x.com', 'source': 'manual', 'status': 'active', 'expiresAt': None, 'createdBy': 'own', 'createdAt': TS},
         CRP('access', 'gone@x.com'): {'email': 'gone@x.com', 'source': 'manual', 'status': 'revoked', 'expiresAt': None, 'createdBy': 'own', 'createdAt': TS},
         CRP('progress', 'pro'): {'uid': 'pro', 'done': {L2: 1}, 'pos': {}, 'last': L2, 'updatedAt': TS}}
BASE.update(CBASE)
for l in (L1, L2, L3, LD, LM2): CPATHS |= {BODY(l), CRP('lessons', l)}
CPATHS |= {CRP(), CRP('modules', M1), CRP('modules', M2), CRP('progress', 'pro'), CRP('progress', 'mem'), CRP('progress', 'out'),
           '/communities/alpha-desk/stats/storage', C('files', 'FILE0000000000001')}
for e in EMAILS: CPATHS.add(CRP('access', e))
for u in PEOPLE: CPATHS.add(CRP('progress', u))
CPATHS.add(CRP('modules', 'mod000000003')); CPATHS.add(CRP('lessons', 'les000000009')); CPATHS.add(CRP('notes', 'pro_' + L1))
def cr(exp, name, who, method, path, **k): case(exp, name, who, method, path, **k)
# content reads (the access gate)
cr(A, 'course body: owner', 'own', 'get', BODY(L2))
cr(A, 'course body: plan member (p3), no drip, not sequential', 'pro', 'get', BODY(L2))
cr(DN, 'course body: member on a plan not in course (p1)', 'mem', 'get', BODY(L2))
cr(DN, 'course body: non-member', 'out', 'get', BODY(L2))
cr(DN, 'course body: signed out', None, 'get', BODY(L2))
cr(A, 'course body: free preview lesson, signed out', None, 'get', BODY(L1))
cr(A, 'course body: free preview lesson, non-member', 'out', 'get', BODY(L1))
cr(DN, 'course body: preview but course is draft', 'out', 'get', BODY(L1), before={CRP(): course(status='draft')})
cr(DN, 'course body: preview but community suspended', 'out', 'get', BODY(L1), before={C(): cm(status='suspended')})
cr(DN, 'course body: expired plan member', 'proold', 'get', BODY(L2))
cr(DN, 'course body: banned member', 'probad', 'get', BODY(L2))
cr(DN, 'course body: lesson is draft', 'pro', 'get', BODY(L2), before={CRP('lessons', L2): lesson(order=1, status='draft')})
cr(DN, 'course body: module is draft', 'pro', 'get', BODY(L2), before={CRP('modules', M1): module(status='draft')})
cr(A, 'course body: owner reads draft lesson', 'own', 'get', BODY(L2), before={CRP('lessons', L2): lesson(order=1, status='draft')})
cr(DN, 'course body: module restricted to plan p2, member is p3', 'pro', 'get', BODY(LM2))
cr(A, 'course body: module overrides course list (module p1, course p3, member p1)', 'mem', 'get', BODY(LM2), before={CRP('modules', M2): module(planIds=['p1'])})
cr(DN, 'course body: module p1 only, member p3 (course list does not add)', 'pro', 'get', BODY(LM2), before={CRP('modules', M2): module(planIds=['p1'])})
cr(A, 'course body: module restricted to p3, member p3', 'pro', 'get', BODY(LM2), before={CRP('modules', M2): module(planIds=['p3'])})
cr(A, 'course body: access mode all, any plan member (p1)', 'mem', 'get', BODY(L2), before={CRP(): course(access={'mode': 'all', 'planIds': []})})
cr(DN, 'course body: drip 7 days, joined today', 'pro', 'get', BODY(LD))
cr(A, 'course body: drip 7 days, joined 40 days ago', 'pro', 'get', BODY(LD), before={C('members', 'pro'): member('pro', plan='p3', source='invite', joinedAt='2026-09-01T10:00:00Z')})
cr(DN, 'course body: fixed-date drip in the future', 'pro', 'get', BODY(L2), before={CRP('lessons', L2): lesson(order=1, drip={'mode': 'date', 'days': 0, 'at': LATER})})
cr(A, 'course body: fixed-date drip in the past', 'pro', 'get', BODY(L2), before={CRP('lessons', L2): lesson(order=1, drip={'mode': 'date', 'days': 0, 'at': SOON})})
cr(DN, 'course body: module drip in the future blocks lesson', 'pro', 'get', BODY(L2), before={CRP('modules', M1): module(drip={'mode': 'date', 'days': 0, 'at': LATER})})
cr(A, 'course body: in-order, previous lesson done', 'pro', 'get', BODY(L3), before={CRP(): course(sequential=True)})
cr(DN, 'course body: in-order, previous lesson NOT done', 'pro', 'get', BODY(L3), before={CRP(): course(sequential=True), CRP('progress', 'pro'): {'uid': 'pro', 'done': {}, 'pos': {}, 'last': '', 'updatedAt': TS}})
cr(DN, 'course body: in-order, no progress doc', 'pro', 'get', BODY(L3), before={CRP(): course(sequential=True), CRP('progress', 'pro'): None})
cr(A, 'course body: solo access (verified email)', 'solo', 'get', BODY(L2))
cr(DN, 'course body: solo access revoked', 'gone', 'get', BODY(L2))
cr(DN, 'course body: solo access, unverified email', 'solo', 'get', BODY(L2), verified=False)
cr(DN, 'course body: solo access but banned email', 'ts', 'get', BODY(L2), before={CRP('access', 'ts@x.com'): {'email': 'ts@x.com', 'source': 'manual', 'status': 'active', 'expiresAt': None, 'createdBy': 'own', 'createdAt': TS}})
cr(DN, 'course body: list is never allowed', 'own', 'list', BODY(L2))
cr(A, 'course body: TradeZoro admin', 'tz', 'get', BODY(L2))
# course / module / lesson metadata
cr(A, 'course: signed-out reads published course (teaser)', None, 'get', CRP())
cr(DN, 'course: stranger reads draft course', 'out', 'get', CRP(), before={CRP(): course(status='draft')})
cr(A, 'course: owner reads draft', 'own', 'get', CRP(), before={CRP(): course(status='draft')})
cr(DN, 'course: private community, non-member', 'out', 'get', CRP(), before={C(): cm(visibility='private')})
cr(A, 'lesson meta: stranger reads published lesson', 'out', 'get', CRP('lessons', L2))
cr(DN, 'lesson meta: stranger reads draft lesson', 'out', 'get', CRP('lessons', L2), before={CRP('lessons', L2): lesson(status='draft')})
NEWC = course(title='New one')
cr(A, 'course: owner creates', 'own', 'create', C('courses', 'crs000000099'), new=NEWC, old=None, before={})
cr(DN, 'course: member creates', 'mem', 'create', C('courses', 'crs000000099'), new=dict(NEWC, ownerUid='mem'), old=None)
cr(DN, 'course: community admin creates (owner only)', 'adm', 'create', C('courses', 'crs000000099'), new=NEWC, old=None)
cr(DN, 'course: extra field', 'own', 'create', C('courses', 'crs000000099'), new=dict(NEWC, price=9), old=None)
cr(DN, 'course: bad status', 'own', 'create', C('courses', 'crs000000099'), new=dict(NEWC, status='live'), old=None)
cr(DN, 'course: owner uid spoof', 'own', 'create', C('courses', 'crs000000099'), new=dict(NEWC, ownerUid='out'), old=None)
cr(DN, 'course: paid solo with price 0', 'own', 'create', C('courses', 'crs000000099'), new=course(solo={'mode': 'paid', 'price': {'amount': 0, 'currency': 'USD'}}), old=None)
cr(A, 'course: paid solo with price stored', 'own', 'create', C('courses', 'crs000000099'), new=course(solo={'mode': 'paid', 'price': {'amount': 99, 'currency': 'INR'}}), old=None)
cr(DN, 'course: id too short', 'own', 'create', C('courses', 'short'), new=NEWC, old=None)
cr(A, 'course: owner edits', 'own', 'update', CRP(), new=course(title='Renamed'))
cr(DN, 'course: owner changes createdAt', 'own', 'update', CRP(), new=course(createdAt=LATER))
cr(DN, 'course: member edits', 'mem', 'update', CRP(), new=course(title='x'))
cr(A, 'course: TradeZoro admin unpublishes', 'tz', 'update', CRP(), new=course(status='draft'))
cr(DN, 'course: TradeZoro admin edits title', 'tz', 'update', CRP(), new=course(title='x'))
cr(A, 'course: owner deletes', 'own', 'delete', CRP())
cr(DN, 'course: member deletes', 'mem', 'delete', CRP())
cr(A, 'module: owner creates', 'own', 'create', CRP('modules', 'mod000000003'), new=module(), old=None)
cr(DN, 'module: member creates', 'mem', 'create', CRP('modules', 'mod000000003'), new=module(), old=None)
cr(DN, 'module: drip date without date', 'own', 'create', CRP('modules', 'mod000000003'), new=module(drip={'mode': 'date', 'days': 0, 'at': None}), old=None)
cr(DN, 'module: 3650+ drip days', 'own', 'create', CRP('modules', 'mod000000003'), new=module(drip={'mode': 'days', 'days': 4000, 'at': None}), old=None)
cr(A, 'lesson: owner creates', 'own', 'create', CRP('lessons', 'les000000009'), new=lesson(), old=None)
cr(DN, 'lesson: member creates', 'mem', 'create', CRP('lessons', 'les000000009'), new=lesson(), old=None)
cr(DN, 'lesson: unknown module', 'own', 'create', CRP('lessons', 'les000000009'), new=lesson('mod000000777'), old=None)
cr(DN, 'lesson: bad type', 'own', 'create', CRP('lessons', 'les000000009'), new=lesson(type='audio'), old=None)
cr(DN, 'lesson: javascript thumb', 'own', 'create', CRP('lessons', 'les000000009'), new=lesson(thumb='javascript:alert(1)'), old=None)
cr(DN, 'lesson: extra field (content smuggled into metadata)', 'own', 'create', CRP('lessons', 'les000000009'), new=dict(lesson(), url='https://x.io/v'), old=None)
# content writes
cr(A, 'content: owner writes video body', 'own', 'create', BODY(L2), new=body(), old=None, before={BODY(L2): None})
cr(DN, 'content: member writes', 'mem', 'create', BODY(L2), new=body(), old=None, before={BODY(L2): None})
cr(DN, 'content: video on random host', 'own', 'update', BODY(L2), new=body(video={'url': 'https://evil.example/v', 'provider': 'youtube'}))
cr(A, 'content: vimeo', 'own', 'update', BODY(L2), new=body(video={'url': 'https://player.vimeo.com/video/123', 'provider': 'vimeo'}))
cr(A, 'content: bunny', 'own', 'update', BODY(L2), new=body(video={'url': 'https://iframe.mediadelivery.net/embed/1/abc', 'provider': 'bunny'}))
cr(A, 'content: cloudflare stream', 'own', 'update', BODY(L2), new=body(video={'url': 'https://customer-abc123.cloudflarestream.com/xyz/iframe', 'provider': 'cloudflare'}))
cr(DN, 'content: type differs from lesson', 'own', 'update', BODY(L2), new=body('text', html='<p>x</p>'))
cr(DN, 'content: video missing', 'own', 'update', BODY(L2), new={'type': 'video', 'attachments': [], 'updatedAt': TS})
FILE = {'fid': 'FILE0000000000001', 'name': 'a.pdf', 'size': 1000, 'ct': 'application/pdf', 'download': False, 'sealed': {'alg': 'p256-hkdf-a256gcm', 'epk': 'AAAA', 'iv': 'BBBB', 'ct': 'CCCC'}}
cr(A, 'content: text lesson with 1 attachment', 'own', 'update', BODY(L2), new=body(video=VID, attachments=[FILE]))
cr(DN, 'content: attachment 26 MB', 'own', 'update', BODY(L2), new=body(attachments=[dict(FILE, size=26214400)]))
cr(DN, 'content: attachment exe', 'own', 'update', BODY(L2), new=body(attachments=[dict(FILE, ct='application/x-msdownload')]))
cr(DN, 'content: 9 attachments', 'own', 'update', BODY(L2), new=body(attachments=[FILE] * 9))
cr(DN, 'content: 400k+ html', 'own', 'update', BODY(L2), new=body(html='x' * 400001))
cr(DN, 'content: attachment without sealed token', 'own', 'update', BODY(L2), new=body(attachments=[{k: v for k, v in FILE.items() if k != 'sealed'}]))
cr(DN, 'content: quiz with 0 questions', 'own', 'update', BODY(L2), new=body(quiz={'pass': 70, 'questions': []}))
cr(A, 'content: quiz with a question', 'own', 'update', BODY(L2), new=body(quiz={'pass': 70, 'questions': [{'q': 'a', 'opts': ['x', 'y'], 'ok': 0}]}))
cr(DN, 'content: link not https', 'own', 'update', BODY(L2), new=body('link', link={'url': 'http://x.io'}), before={CRP('lessons', L2): lesson(order=1, type='link')})
# progress + notes
cr(A, 'progress: learner writes own', 'pro', 'update', CRP('progress', 'pro'), new={'uid': 'pro', 'done': {L2: 1, L3: 1}, 'pos': {L3: 40}, 'last': L3, 'updatedAt': TS})
cr(DN, 'progress: writes someone elses', 'pro', 'update', CRP('progress', 'mem'), new={'uid': 'mem', 'done': {}, 'pos': {}, 'last': '', 'updatedAt': TS}, old=None)
cr(DN, 'progress: uid spoof', 'pro', 'update', CRP('progress', 'pro'), new={'uid': 'mem', 'done': {}, 'pos': {}, 'last': '', 'updatedAt': TS})
cr(A, 'progress: reads own', 'pro', 'get', CRP('progress', 'pro'))
cr(DN, 'progress: reads other', 'mem', 'get', CRP('progress', 'pro'))
cr(A, 'progress: owner lists all', 'own', 'list', CRP('progress', 'pro'))
cr(DN, 'progress: member lists all', 'pro', 'list', CRP('progress', 'pro'))
cr(DN, 'progress: not a member and no access', 'out', 'update', CRP('progress', 'out'), new={'uid': 'out', 'done': {}, 'pos': {}, 'last': '', 'updatedAt': TS}, old=None)
cr(A, 'progress: solo access holder writes own', 'solo', 'update', CRP('progress', 'solo'), new={'uid': 'solo', 'done': {}, 'pos': {}, 'last': '', 'updatedAt': TS}, old=None)
cr(DN, 'progress: course is draft', 'pro', 'update', CRP('progress', 'pro'), new={'uid': 'pro', 'done': {}, 'pos': {}, 'last': '', 'updatedAt': TS}, before={CRP(): course(status='draft')})
NT = CRP('notes', 'pro_' + L1)
cr(A, 'note: writes own', 'pro', 'create', NT, new={'uid': 'pro', 'text': 'hi', 'updatedAt': TS}, old=None)
cr(DN, 'note: writes another users note id', 'pro', 'create', CRP('notes', 'mem_' + L1), new={'uid': 'pro', 'text': 'hi', 'updatedAt': TS}, old=None)
cr(DN, 'note: owner reads a member note', 'own', 'get', NT, old={'uid': 'pro', 'text': 'hi', 'updatedAt': TS})
cr(A, 'note: reads own', 'pro', 'get', NT, old={'uid': 'pro', 'text': 'hi', 'updatedAt': TS})
# course access docs
CAC = lambda e: CRP('access', e)
cr(A, 'course access: owner grants by email', 'own', 'create', CAC('zed@x.com'), new=grant('zed@x.com'), old=None)
cr(DN, 'course access: member grants himself', 'mem', 'create', CAC('mem@x.com'), new=grant('mem@x.com', createdBy='mem'), old=None)
cr(DN, 'course access: free claim but solo is off', 'out', 'create', CAC('out@x.com'), new=grant('out@x.com', createdBy='out', source='free'), old=None)
cr(A, 'course access: free claim when solo is free', 'out', 'create', CAC('out@x.com'), new=grant('out@x.com', createdBy='out', source='free'), old=None, before={CRP(): course(solo={'mode': 'free', 'price': {'amount': 0, 'currency': 'USD'}})})
cr(DN, 'course access: free claim when solo is paid', 'out', 'create', CAC('out@x.com'), new=grant('out@x.com', createdBy='out', source='free'), old=None, before={CRP(): course(solo={'mode': 'paid', 'price': {'amount': 9, 'currency': 'USD'}})})
cr(DN, 'course access: free claim unverified', 'out', 'create', CAC('out@x.com'), new=grant('out@x.com', createdBy='out', source='free'), old=None, verified=False, before={CRP(): course(solo={'mode': 'free', 'price': {'amount': 0, 'currency': 'USD'}})})
cr(A, 'course access: owner revokes', 'own', 'update', CAC('solo@x.com'), new=dict(BASE[CAC('solo@x.com')], status='revoked'))
cr(DN, 'course access: holder un-revokes', 'gone', 'update', CAC('gone@x.com'), new=dict(BASE[CAC('gone@x.com')], status='active'))
cr(A, 'course access: collection-group list of my courses', 'solo', 'list', '/communities/x/courses/y/access/solo@x.com', old=BASE[CAC('solo@x.com')])
# files + storage total (1 GB cap, 25 MB per file)
FID = 'FILE0000000000001'; STATS = '/communities/alpha-desk/stats/storage'
FREG = {'ownerUid': 'own', 'crid': CR, 'lid': L2, 'name': 'a.pdf', 'size': 1000, 'ct': 'application/pdf', 'createdAt': TS}
cr(A, 'files: owner registers file + total moves by its size (first file)', 'own', 'create', C('files', FID), new=FREG, old=None, after={STATS: {'bytes': 1000, 'lastFid': FID, 'updatedAt': TS}})
cr(DN, 'files: register without moving the total', 'own', 'create', C('files', FID), new=FREG, old=None)
cr(DN, 'files: member registers', 'mem', 'create', C('files', FID), new=dict(FREG, ownerUid='mem'), old=None, after={STATS: {'bytes': 1000, 'lastFid': FID, 'updatedAt': TS}})
cr(DN, 'files: 26 MB', 'own', 'create', C('files', FID), new=dict(FREG, size=27262976), old=None, after={STATS: {'bytes': 27262976, 'lastFid': FID, 'updatedAt': TS}})
cr(A, 'stats: total +size with the file doc', 'own', 'update', STATS, new={'bytes': 6000, 'lastFid': FID, 'updatedAt': TS}, old={'bytes': 5000, 'lastFid': 'OLD', 'updatedAt': TS}, before={STATS: {'bytes': 5000, 'lastFid': 'OLD', 'updatedAt': TS}}, after={C('files', FID): FREG, STATS: {'bytes': 6000, 'lastFid': FID, 'updatedAt': TS}})
cr(DN, 'stats: owner lowers total without deleting a file', 'own', 'update', STATS, new={'bytes': 0, 'lastFid': FID, 'updatedAt': TS}, old={'bytes': 5000, 'lastFid': 'OLD', 'updatedAt': TS}, before={STATS: {'bytes': 5000, 'lastFid': 'OLD', 'updatedAt': TS}})
cr(DN, 'stats: over 1 GB', 'own', 'update', STATS, new={'bytes': 1073741824 + 1000, 'lastFid': FID, 'updatedAt': TS}, old={'bytes': 1073741824, 'lastFid': 'OLD', 'updatedAt': TS}, before={STATS: {'bytes': 1073741824, 'lastFid': 'OLD', 'updatedAt': TS}}, after={C('files', FID): FREG, STATS: {'bytes': 1073741824 + 1000, 'lastFid': FID, 'updatedAt': TS}})
cr(A, 'stats: total -size when the file doc is deleted', 'own', 'update', STATS, new={'bytes': 4000, 'lastFid': FID, 'updatedAt': TS}, old={'bytes': 5000, 'lastFid': 'OLD', 'updatedAt': TS}, before={STATS: {'bytes': 5000, 'lastFid': 'OLD', 'updatedAt': TS}, C('files', FID): FREG}, after={STATS: {'bytes': 4000, 'lastFid': FID, 'updatedAt': TS}, C('files', FID): None})
cr(DN, 'stats: member writes', 'mem', 'update', STATS, new={'bytes': 0, 'lastFid': FID, 'updatedAt': TS}, old={'bytes': 5000, 'lastFid': 'OLD', 'updatedAt': TS}, before={STATS: {'bytes': 5000, 'lastFid': 'OLD', 'updatedAt': TS}})
cr(DN, 'files: member reads registry', 'mem', 'get', C('files', FID), old=FREG, before={C('files', FID): FREG})

# ---------- feed / events / leaderboard (Phase D) ----------
PID, KID, EID = 'post00000001', 'cmt000000001', 'evt000000001'
PP = lambda *a: C('posts', PID, *a) if a else C('posts', PID)
EV = lambda *a: C('events', EID, *a) if a else C('events', EID)
CPATHS |= {PP(), C('posts', 'post00000002'), C('comments', KID), C('comments', 'cmt000000002'), EV(), C('events', 'evt000000002')}
for u in PEOPLE: CPATHS.add(EV('rsvps', u))
FEED_ON = {C(): cm(features={'feed': True, 'courses': False, 'indicators': False, 'events': True, 'leaderboard': True, 'discord': False})}
def post(**k):
    d = {'authorUid': 'mem', 'authorName': 'Mem', 'text': 'Levels for today', 'pinned': False, 'createdAt': TS}; d.update(k); return d
def cmt(**k):
    d = {'postId': PID, 'authorUid': 'mem', 'authorName': 'Mem', 'text': 'Thanks', 'createdAt': TS}; d.update(k); return d
def evt(**k):
    d = {'title': 'Live Q&A', 'desc': 'Ask anything', 'startsAt': LATER, 'durationMin': 60, 'link': 'https://meet.example.com/x', 'createdBy': 'own', 'createdAt': TS}; d.update(k); return d
POST_B = dict(FEED_ON); POST_B[PP()] = post()
fd = lambda *a, **k: case(*a, **k)
fd(A, 'feed: member posts', 'mem', 'create', PP(), new=post(createdAt=TS), old=None, before=FEED_ON)
fd(DN, 'feed: post as someone else', 'mem', 'create', PP(), new=post(authorUid='own'), old=None, before=FEED_ON)
fd(DN, 'feed: feed switched off', 'mem', 'create', PP(), new=post(), old=None, before={C(): cm(features={'feed': False, 'courses': False, 'indicators': False, 'events': False, 'leaderboard': False, 'discord': False})})
fd(DN, 'feed: outsider posts', 'out', 'create', PP(), new=post(authorUid='out'), old=None, before=FEED_ON)
fd(DN, 'feed: signed out posts', None, 'create', PP(), new=post(), old=None, before=FEED_ON)
fd(DN, 'feed: banned member posts', 'bad', 'create', PP(), new=post(authorUid='bad'), old=None, before=FEED_ON)
fd(DN, 'feed: expired member posts', 'proold', 'create', PP(), new=post(authorUid='proold'), old=None, before=FEED_ON)
fd(DN, 'feed: post pinned at creation', 'mem', 'create', PP(), new=post(pinned=True), old=None, before=FEED_ON)
fd(DN, 'feed: 2001 chars', 'mem', 'create', PP(), new=post(text='x' * 2001), old=None, before=FEED_ON)
fd(DN, 'feed: empty text', 'mem', 'create', PP(), new=post(text=''), old=None, before=FEED_ON)
fd(DN, 'feed: extra field', 'mem', 'create', PP(), new=dict(post(), likes=99), old=None, before=FEED_ON)
fd(DN, 'feed: bad id', 'mem', 'create', C('posts', 'short'), new=post(), old=None, before=FEED_ON)
fd(A, 'feed: member reads', 'mem', 'get', PP(), before=POST_B)
fd(DN, 'feed: outsider reads', 'out', 'get', PP(), before=POST_B)
fd(DN, 'feed: signed out reads', None, 'get', PP(), before=POST_B)
fd(A, 'feed: author edits text', 'mem', 'update', PP(), new=dict(post(), text='Edited', editedAt=TS), before=POST_B)
fd(DN, 'feed: author pins own post', 'mem', 'update', PP(), new=post(pinned=True), before=POST_B)
fd(DN, 'feed: other member edits', 'pro', 'update', PP(), new=dict(post(), text='Edited', editedAt=TS), before=POST_B)
fd(DN, 'feed: author changes authorUid', 'mem', 'update', PP(), new=dict(post(authorUid='own'), editedAt=TS), before=POST_B)
fd(A, 'feed: mod pins', 'mod', 'update', PP(), new=post(pinned=True), before=POST_B)
fd(DN, 'feed: mod edits text', 'mod', 'update', PP(), new=dict(post(), text='Changed by mod', editedAt=TS), before=POST_B)
fd(A, 'feed: author deletes', 'mem', 'delete', PP(), before=POST_B)
fd(A, 'feed: mod deletes', 'mod', 'delete', PP(), before=POST_B)
fd(A, 'feed: owner deletes', 'own', 'delete', PP(), before=POST_B)
fd(DN, 'feed: other member deletes', 'pro', 'delete', PP(), before=POST_B)
fd(A, 'comment: member comments', 'mem', 'create', C('comments', KID), new=cmt(), old=None, before=POST_B)
fd(DN, 'comment: on a missing post', 'mem', 'create', C('comments', KID), new=cmt(postId='nopost000001'), old=None, before=POST_B)
fd(DN, 'comment: outsider', 'out', 'create', C('comments', KID), new=cmt(authorUid='out'), old=None, before=POST_B)
fd(DN, 'comment: as someone else', 'mem', 'create', C('comments', KID), new=cmt(authorUid='own'), old=None, before=POST_B)
fd(DN, 'comment: 1001 chars', 'mem', 'create', C('comments', KID), new=cmt(text='x' * 1001), old=None, before=POST_B)
fd(DN, 'comment: edit', 'mem', 'update', C('comments', KID), new=cmt(text='Edited'), before={**POST_B, C('comments', KID): cmt()})
fd(A, 'comment: author deletes', 'mem', 'delete', C('comments', KID), before={**POST_B, C('comments', KID): cmt()})
fd(A, 'comment: mod deletes', 'mod', 'delete', C('comments', KID), before={**POST_B, C('comments', KID): cmt()})
fd(DN, 'comment: other member deletes', 'pro', 'delete', C('comments', KID), before={**POST_B, C('comments', KID): cmt()})
EV_B = dict(FEED_ON); EV_B[EV()] = evt()
fd(A, 'event: owner creates', 'own', 'create', EV(), new=evt(), old=None, before=FEED_ON)
fd(A, 'event: community admin creates', 'adm', 'create', EV(), new=evt(createdBy='adm'), old=None, before=FEED_ON)
fd(DN, 'event: mod creates', 'mod', 'create', EV(), new=evt(createdBy='mod'), old=None, before=FEED_ON)
fd(DN, 'event: member creates', 'mem', 'create', EV(), new=evt(createdBy='mem'), old=None, before=FEED_ON)
fd(DN, 'event: events switched off', 'own', 'create', EV(), new=evt(), old=None, before={C(): cm()})
fd(DN, 'event: javascript link', 'own', 'create', EV(), new=evt(link='javascript:alert(1)'), old=None, before=FEED_ON)
fd(A, 'event: no link', 'own', 'create', EV(), new=evt(link=''), old=None, before=FEED_ON)
fd(DN, 'event: 2 minutes long', 'own', 'create', EV(), new=evt(durationMin=2), old=None, before=FEED_ON)
fd(A, 'event: member reads', 'mem', 'get', EV(), before=EV_B)
fd(DN, 'event: outsider reads', 'out', 'get', EV(), before=EV_B)
fd(A, 'event: owner edits', 'own', 'update', EV(), new=evt(title='New title'), before=EV_B)
fd(DN, 'event: member edits', 'mem', 'update', EV(), new=evt(title='New title'), before=EV_B)
fd(A, 'event: owner deletes', 'own', 'delete', EV(), before=EV_B)
fd(DN, 'event: member deletes', 'mem', 'delete', EV(), before=EV_B)
RS = {'uid': 'mem', 'name': 'Mem', 'createdAt': TS}
fd(A, 'rsvp: member goes', 'mem', 'create', EV('rsvps', 'mem'), new=RS, old=None, before=EV_B)
fd(DN, 'rsvp: for someone else', 'mem', 'create', EV('rsvps', 'pro'), new=dict(RS, uid='pro'), old=None, before=EV_B)
fd(DN, 'rsvp: outsider', 'out', 'create', EV('rsvps', 'out'), new=dict(RS, uid='out'), old=None, before=EV_B)
fd(DN, 'rsvp: missing event', 'mem', 'create', EV('rsvps', 'mem'), new=RS, old=None, before=FEED_ON)
fd(A, 'rsvp: member cancels own', 'mem', 'delete', EV('rsvps', 'mem'), before={**EV_B, EV('rsvps', 'mem'): RS})
fd(DN, 'rsvp: member cancels other', 'pro', 'delete', EV('rsvps', 'mem'), before={**EV_B, EV('rsvps', 'mem'): RS})
fd(A, 'rsvp: owner removes', 'own', 'delete', EV('rsvps', 'mem'), before={**EV_B, EV('rsvps', 'mem'): RS})
fd(A, 'rsvp: member lists', 'mem', 'list', EV('rsvps', 'mem'), before={**EV_B, EV('rsvps', 'mem'): RS})

# ---------- regression: old collections unchanged ----------
case(DN, 'regression: student sets own plan', 'out', 'update', '/students/out', old={'plan': 'Free'}, new={'plan': 'Pro'}, before={'/students/out': {'plan': 'Free'}})
case(DN, 'regression: random collection denied', 'out', 'create', '/secretStuff/x', new={'a': 1}, old=None)
case(A, 'regression: public sitePages read', None, 'get', '/sitePages/home', old={'a': 1})

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
# The :test API takes at most ~250 cases per call: run in batches.
fails = 0
for i in range(0, len(cases), 200):
    batch = cases[i:i + 200]
    for (name, t), res in zip(batch, run(batch)):
        ok = res['state'] == 'SUCCESS'; fails += not ok
        if not ok or os.environ.get('V'):
            print(('PASS' if ok else 'FAIL'), t['expectation'], name, '' if ok else json.dumps(res.get('errorPosition') or res.get('debugMessages') or res)[:260])
print(f'{len(cases) - fails}/{len(cases)} passed')
sys.exit(1 if fails else 0)
