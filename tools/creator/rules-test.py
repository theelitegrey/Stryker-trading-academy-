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
    req = {'auth': auth(uid), 'method': method, 'path': D + path, 'time': TS}
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

# ---------- regression: old collections unchanged ----------
case(DN, 'regression: student sets own plan', 'out', 'update', '/students/out', old={'plan': 'Free'}, new={'plan': 'Pro'}, before={'/students/out': {'plan': 'Free'}})
case(DN, 'regression: random collection denied', 'out', 'create', '/secretStuff/x', new={'a': 1}, old=None)
case(A, 'regression: public sitePages read', None, 'get', '/sitePages/home', old={'a': 1})

body = {'source': {'files': [{'name': 'firestore.rules', 'content': RULES}]}, 'testSuite': {'testCases': [t for _, t in cases]}}
req = urllib.request.Request(f'https://firebaserules.googleapis.com/v1/projects/{P}:test', data=json.dumps(body).encode(),
                             headers={'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json', 'x-goog-user-project': P})
try:
    out = json.load(urllib.request.urlopen(req))
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode()[:2500]); sys.exit(2)
if out.get('issues'):
    print('ISSUES', json.dumps(out['issues'])[:1500])
    if any(i.get('severity') == 'ERROR' for i in out['issues']): sys.exit(3)
fails = 0
for (name, t), res in zip(cases, out.get('testResults', [])):
    ok = res['state'] == 'SUCCESS'; fails += not ok
    if not ok or os.environ.get('V'):
        print(('PASS' if ok else 'FAIL'), t['expectation'], name, '' if ok else json.dumps(res.get('errorPosition') or res.get('debugMessages') or res)[:260])
print(f'{len(cases) - fails}/{len(cases)} passed')
sys.exit(1 if fails else 0)
