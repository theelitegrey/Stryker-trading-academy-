#!/usr/bin/env python3
"""Suggestions board Firestore rules tests (Rules :test API, no data touched).
usage: python3 tools/suggestions/rules-test.py <rules file> <token file>
Token = OAuth access token with firebaserules scope (never printed). Each case lists the documents that exist
BEFORE the write and AFTER it (what getAfter/existsAfter see in the same batch)."""
import json, sys, urllib.request, os
RULES = open(sys.argv[1]).read()
TOK = open(sys.argv[2]).read().strip()
P = 'strykertrades-e0cd8'
D = '/databases/(default)/documents'
TS = '2026-10-30T10:00:00Z'          # request.time in every case
DAY = 20756                           # int(TS millis / 86400000)
SLOT = 's' + str(DAY % 8)
EARLY = '2026-10-30T09:59:50Z'        # 10 s before
OLD = '2026-10-30T09:00:00Z'          # 60 min before
def auth(u): return None if u is None else {'uid': u, 'token': {'email': u + '@x.com', 'email_verified': True}}
S = lambda sid='s1', *a: '/suggestions/' + '/'.join((sid,) + a)
def sg(**k):
    d = {'title': 'Indicator alerts', 'body': 'Alert me when price hits a level.', 'category': 'indicators', 'imageUrl': '',
         'authorUid': 'ann', 'authorName': 'Ann', 'status': 'new', 'votes': 3, 'voteRing': {SLOT: {'d': DAY, 'n': 2}},
         'commentsCount': 1, 'createdAt': OLD, 'updatedAt': OLD, 'hidden': False}
    d.update(k); return d
COM = {'authorUid': 'bob', 'authorName': 'Member', 'text': 'Yes please', 'createdAt': TS, 'updatedAt': TS}
BASE = {
    '/admins/adm': {},
    '/profiles/ann': {'displayName': 'Ann'},
    '/profiles/bob': {'displayName': 'Bob'},
    S(): sg(),
    S('s1', 'votes', 'ann'): {'uid': 'ann', 'at': OLD, 'day': DAY},
    S('s1', 'comments', 'c1'): dict(COM, createdAt=OLD, updatedAt=OLD),
    S('hid'): sg(hidden=True),
    '/suggestBans/bad': {'at': OLD},
}
PEOPLE = ['ann', 'bob', 'adm', 'bad', 'zed']
def mocks(before, after):
    paths = set(before) | set(after) | set(BASE)
    for u in PEOPLE:
        paths |= {'/admins/' + u, '/profiles/' + u, '/suggestBans/' + u, '/suggestMeta/' + u, S('s1', 'votes', u), S('new1', 'votes', u), S('hid', 'votes', u)}
    paths |= {S('new1'), S('s1', 'comments', 'c2'), S('hid', 'comments', 'c2')}
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

# ---------- read ----------
case(A, 'signed-out gets visible suggestion', None, 'get', S())
case(A, 'signed-out lists visible suggestions', None, 'list', S())
case(DN, 'signed-out gets hidden suggestion', None, 'get', S('hid'))
case(DN, 'member lists hidden suggestion', 'bob', 'list', S('hid'))
case(A, 'author gets own hidden suggestion', 'ann', 'get', S('hid'))
case(A, 'admin gets hidden suggestion', 'adm', 'get', S('hid'))
case(A, 'signed-out reads comments', None, 'list', S('s1', 'comments', 'c1'))
case(DN, 'signed-out reads comments of hidden', None, 'list', S('hid', 'comments', 'c1'), old=COM)
case(DN, 'member lists voters (no names list)', 'bob', 'list', S('s1', 'votes', 'ann'))
case(DN, 'member reads someone elses vote', 'bob', 'get', S('s1', 'votes', 'ann'))
case(A, 'member reads own vote', 'ann', 'get', S('s1', 'votes', 'ann'))
case(A, 'admin lists voters (for notifications / merge)', 'adm', 'list', S('s1', 'votes', 'ann'))

# ---------- create a suggestion (batch: suggestion + own vote + meta) ----------
NEW = sg(title='Copy layouts between devices', category='charts', authorUid='bob', authorName='Bob', votes=1,
         voteRing={SLOT: {'d': DAY, 'n': 1}}, commentsCount=0, createdAt=TS, updatedAt=TS)
VOTE = {'uid': 'bob', 'at': TS, 'day': DAY}
META = {'sDay': DAY, 'sN': 1, 'sSid': 'new1', 'sAt': TS}
def cs(exp, name, uid='bob', new=NEW, after=None, before=None):
    aa = {S('new1'): new, S('new1', 'votes', uid or 'x'): dict(VOTE, uid=uid or 'x'), '/suggestMeta/' + (uid or 'x'): META}
    aa.update(after or {})
    case(exp, name, uid, 'create', S('new1'), new=new, old=None, before=before, after=aa)
cs(A, 'create suggestion')
cs(A, 'create as "Member"', new=dict(NEW, authorName='Member'))
cs(DN, 'create signed out', uid=None)
cs(DN, 'create for someone else', new=dict(NEW, authorUid='ann'))
cs(DN, 'create with fake name', new=dict(NEW, authorName='TradeZoro Team'))
cs(DN, 'create with 50 votes', new=dict(NEW, votes=50))
cs(DN, 'create with status planned', new=dict(NEW, status='planned'))
cs(DN, 'create pre-hidden false missing', new={k: v for k, v in NEW.items() if k != 'hidden'})
cs(DN, 'create with official reply', new=dict(NEW, officialReply={'text': 'yes', 'at': TS, 'by': 'bob'}))
cs(DN, 'create with commentsCount 9', new=dict(NEW, commentsCount=9))
cs(DN, 'create title 81 chars', new=dict(NEW, title='x' * 81))
cs(DN, 'create body 1001 chars', new=dict(NEW, body='x' * 1001))
cs(DN, 'create unknown category', new=dict(NEW, category='crypto'))
cs(DN, 'create with foreign image url', new=dict(NEW, imageUrl='https://evil.example/x.png'))
cs(DN, 'create with another members image path', new=dict(NEW, imageUrl='https://firebasestorage.googleapis.com/v0/b/strykertrades-e0cd8.firebasestorage.app/o/suggestions%2Fann%2Fa.png?alt=media'))
cs(A, 'create with own image', new=dict(NEW, imageUrl='https://firebasestorage.googleapis.com/v0/b/strykertrades-e0cd8.firebasestorage.app/o/suggestions%2Fbob%2Fa.png?alt=media&token=t'))
cs(DN, 'create with backdated createdAt', new=dict(NEW, createdAt=OLD))
cs(DN, 'create without own vote in batch', after={S('new1', 'votes', 'bob'): None})
cs(DN, 'create without meta bump', after={'/suggestMeta/bob': None})
cs(DN, 'create by banned member', uid='bad', new=dict(NEW, authorUid='bad', authorName='Member'))
cs(DN, 'create with extra field', new=dict(NEW, pinned=True))
# meta (rate limit 5 per UTC day)
def mc(exp, name, new, before=None, after=None, uid='bob'):
    aa = {S('new1'): NEW}; aa.update(after or {})
    case(exp, name, uid, 'create' if not before else 'update', '/suggestMeta/' + uid, new=new, old=(before or {}).get('/suggestMeta/' + uid), before=before, after=aa)
mc(A, 'meta: first post of the day', META)
mc(A, 'meta: 5th post of the day', dict(META, sN=5), before={'/suggestMeta/bob': dict(META, sN=4, sSid='old', sAt=OLD)})
mc(DN, 'meta: 6th post of the day (rate limit)', dict(META, sN=6), before={'/suggestMeta/bob': dict(META, sN=5, sSid='old', sAt=OLD)})
mc(DN, 'meta: reset counter same day', dict(META, sN=1), before={'/suggestMeta/bob': dict(META, sN=5, sSid='old', sAt=OLD)})
mc(A, 'meta: new day resets to 1', dict(META, sN=1), before={'/suggestMeta/bob': dict(META, sDay=DAY - 1, sN=5, sSid='old', sAt=OLD)})
mc(DN, 'meta: suggestion not actually created', META, after={S('new1'): None})
case(DN, 'meta: write someone elses meta', 'ann', 'create', '/suggestMeta/bob', new=META, old=None, after={S('new1'): NEW})
case(DN, 'meta: read someone elses meta', 'ann', 'get', '/suggestMeta/bob', old=META, before={'/suggestMeta/bob': META})

# ---------- votes ----------
S1 = sg()
def vote_up(exp, name, uid='bob', new=None, before=None, after=None):
    nw = new or dict(S1, votes=4, voteRing={SLOT: {'d': DAY, 'n': 3}})
    aa = {S('s1', 'votes', uid or 'x'): {'uid': uid, 'at': TS, 'day': DAY}}; aa.update(after or {})
    case(exp, name, uid, 'update', S(), new=nw, before=before, after=aa)
vote_up(A, 'vote +1 with own marker')
vote_up(DN, 'vote +2', new=dict(S1, votes=5, voteRing={SLOT: {'d': DAY, 'n': 3}}))
vote_up(DN, 'vote +1 without marker', after={S('s1', 'votes', 'bob'): None})
vote_up(DN, 'vote twice (marker already there)', uid='ann')
vote_up(DN, 'vote +1 signed out', uid=None)
vote_up(DN, 'vote +1 and change title', new=dict(S1, votes=4, title='Hacked', voteRing={SLOT: {'d': DAY, 'n': 3}}))
vote_up(DN, 'vote +1 and set status shipped', new=dict(S1, votes=4, status='shipped', voteRing={SLOT: {'d': DAY, 'n': 3}}))
vote_up(DN, 'vote +1 ring +5', new=dict(S1, votes=4, voteRing={SLOT: {'d': DAY, 'n': 7}}))
vote_up(DN, 'vote on hidden suggestion', new=dict(sg(hidden=True), votes=4, voteRing={SLOT: {'d': DAY, 'n': 3}}),
        before={S(): sg(hidden=True)})
case(A, 'unvote -1, marker deleted', 'ann', 'update', S(), new=dict(S1, votes=2, voteRing={SLOT: {'d': DAY, 'n': 1}}),
     after={S('s1', 'votes', 'ann'): None})
case(DN, 'unvote -1 but keep marker', 'ann', 'update', S(), new=dict(S1, votes=2, voteRing={SLOT: {'d': DAY, 'n': 1}}))
case(DN, 'unvote without having voted', 'bob', 'update', S(), new=dict(S1, votes=2, voteRing={SLOT: {'d': DAY, 'n': 1}}))
case(DN, 'unvote -2', 'ann', 'update', S(), new=dict(S1, votes=1, voteRing={SLOT: {'d': DAY, 'n': 1}}), after={S('s1', 'votes', 'ann'): None})
# vote marker docs
case(A, 'create own vote marker (+1 on parent)', 'bob', 'create', S('s1', 'votes', 'bob'), new=VOTE, old=None,
     after={S(): dict(S1, votes=4), S('s1', 'votes', 'bob'): VOTE})
case(DN, 'create vote marker for someone else', 'bob', 'create', S('s1', 'votes', 'zed'), new=dict(VOTE, uid='zed'), old=None,
     after={S(): dict(S1, votes=4)})
case(DN, 'create vote marker without parent +1', 'bob', 'create', S('s1', 'votes', 'bob'), new=VOTE, old=None)
case(DN, 'create vote marker with wrong day', 'bob', 'create', S('s1', 'votes', 'bob'), new=dict(VOTE, day=DAY + 3), old=None,
     after={S(): dict(S1, votes=4)})
case(A, 'delete own vote marker (-1 on parent)', 'ann', 'delete', S('s1', 'votes', 'ann'), after={S(): dict(S1, votes=2)})
case(DN, 'delete own vote marker without -1', 'ann', 'delete', S('s1', 'votes', 'ann'))
case(DN, 'delete someone elses vote', 'bob', 'delete', S('s1', 'votes', 'ann'), after={S(): dict(S1, votes=2)})
case(A, 'admin moves vote marker (merge)', 'adm', 'create', S('s1', 'votes', 'zed'), new={'uid': 'zed', 'at': TS, 'day': DAY}, old=None)

# ---------- comments ----------
C2 = dict(COM)
CM = {'cSid': 's1', 'cCid': 'c2', 'cAt': TS}
def cc(exp, name, uid='bob', new=C2, before=None, after=None, path=S('s1', 'comments', 'c2')):
    aa = {path: new, S(): dict(S1, commentsCount=2), '/suggestMeta/' + (uid or 'x'): CM}; aa.update(after or {})
    case(exp, name, uid, 'create', path, new=new, old=None, before=before, after=aa)
cc(A, 'post a comment')
cc(DN, 'comment signed out', uid=None)
cc(DN, 'comment as someone else', new=dict(C2, authorUid='ann'))
cc(DN, 'comment 1001 chars', new=dict(C2, text='x' * 1001))
cc(DN, 'comment empty', new=dict(C2, text=''))
cc(DN, 'comment without count +1', after={S(): S1})
cc(DN, 'comment without meta proof', after={'/suggestMeta/bob': None})
cc(DN, 'comment by banned member', uid='bad', new=dict(C2, authorUid='bad'))
cc(DN, 'comment on hidden suggestion', path=S('hid', 'comments', 'c2'), after={S('hid'): sg(hidden=True, commentsCount=2), '/suggestMeta/bob': dict(CM, cSid='hid')})
def cm(exp, name, before=None, after=None, new=CM, uid='bob'):
    aa = {S('s1', 'comments', 'c2'): C2}; aa.update(after or {})
    old = (before or {}).get('/suggestMeta/' + uid)
    case(exp, name, uid, 'update' if old else 'create', '/suggestMeta/' + uid, new=new if not old else dict(old, **new), old=old, before=before, after=aa)
cm(A, 'meta: first comment')
cm(A, 'meta: comment 60 s after the last', before={'/suggestMeta/bob': {'cSid': 's1', 'cCid': 'c1', 'cAt': OLD}})
cm(DN, 'meta: comment 10 s after the last (rate limit)', before={'/suggestMeta/bob': {'cSid': 's1', 'cCid': 'c1', 'cAt': EARLY}})
cm(DN, 'meta: comment proof for a comment that is not created', after={S('s1', 'comments', 'c2'): None})
cm(DN, 'meta: comment proof for someone elses comment', after={S('s1', 'comments', 'c2'): dict(C2, authorUid='ann')})
case(A, 'count +1 with meta proof', 'bob', 'update', S(), new=dict(S1, commentsCount=2), after={'/suggestMeta/bob': CM})
case(DN, 'count +1 without meta proof', 'bob', 'update', S(), new=dict(S1, commentsCount=2))
case(DN, 'count +5', 'bob', 'update', S(), new=dict(S1, commentsCount=6), after={'/suggestMeta/bob': CM})
# edit / delete own within 15 min
FRESH = dict(COM)
case(A, 'edit own comment within 15 min', 'bob', 'update', S('s1', 'comments', 'c2'), new=dict(FRESH, createdAt=EARLY, text='edited'),
     before={S('s1', 'comments', 'c2'): dict(FRESH, createdAt=EARLY, updatedAt=EARLY)}, old=dict(FRESH, createdAt=EARLY, updatedAt=EARLY))
case(DN, 'edit own comment after 15 min', 'bob', 'update', S('s1', 'comments', 'c1'), new=dict(COM, createdAt=OLD, text='edited'),
     before={S('s1', 'comments', 'c1'): dict(COM, createdAt=OLD, updatedAt=OLD)}, old=dict(COM, createdAt=OLD, updatedAt=OLD))
case(DN, 'edit someone elses comment', 'ann', 'update', S('s1', 'comments', 'c2'), new=dict(FRESH, createdAt=EARLY, text='edited'),
     before={S('s1', 'comments', 'c2'): dict(FRESH, createdAt=EARLY, updatedAt=EARLY)}, old=dict(FRESH, createdAt=EARLY, updatedAt=EARLY))
case(DN, 'edit own comment changes author', 'bob', 'update', S('s1', 'comments', 'c2'), new=dict(FRESH, createdAt=EARLY, authorUid='ann'),
     before={S('s1', 'comments', 'c2'): dict(FRESH, createdAt=EARLY, updatedAt=EARLY)}, old=dict(FRESH, createdAt=EARLY, updatedAt=EARLY))
DM = {'dSid': 's1', 'dCid': 'c2', 'dAt': TS}
FB = {S('s1', 'comments', 'c2'): dict(FRESH, createdAt=EARLY, updatedAt=EARLY), S(): dict(S1, commentsCount=2)}
case(A, 'delete own comment within 15 min', 'bob', 'delete', S('s1', 'comments', 'c2'), before=FB,
     after={S('s1', 'comments', 'c2'): None, S(): dict(S1, commentsCount=1), '/suggestMeta/bob': DM})
case(DN, 'delete own comment without count -1', 'bob', 'delete', S('s1', 'comments', 'c2'), before=FB,
     after={S('s1', 'comments', 'c2'): None, '/suggestMeta/bob': DM})
case(DN, 'delete own comment after 15 min', 'bob', 'delete', S('s1', 'comments', 'c1'),
     before={S('s1', 'comments', 'c1'): dict(COM, createdAt=OLD)}, after={S('s1', 'comments', 'c1'): None, S(): dict(S1, commentsCount=0)})
case(DN, 'delete someone elses comment', 'ann', 'delete', S('s1', 'comments', 'c2'), before=FB,
     after={S('s1', 'comments', 'c2'): None, S(): dict(S1, commentsCount=1)})
case(A, 'meta: delete proof', 'bob', 'create', '/suggestMeta/bob', new=DM, old=None, before=FB, after={S('s1', 'comments', 'c2'): None})
case(DN, 'meta: delete proof for comment that still exists', 'bob', 'create', '/suggestMeta/bob', new=DM, old=None, before=FB)
case(A, 'count -1 with delete proof', 'bob', 'update', S(), new=dict(S1, commentsCount=0), after={'/suggestMeta/bob': DM})
case(A, 'admin deletes spam comment', 'adm', 'delete', S('s1', 'comments', 'c1'))

# ---------- admin ----------
REPLY = {'text': 'On the list for next month.', 'at': TS, 'by': 'TradeZoro team'}
case(A, 'admin sets status planned + reply + history', 'adm', 'update', S(), new=dict(S1, status='planned', officialReply=REPLY,
     history=[{'s': 'planned', 'at': TS}], statusAt=TS, updatedAt=TS))
case(A, 'admin hides spam', 'adm', 'update', S(), new=dict(S1, hidden=True))
case(A, 'admin merges (mergedInto + hidden)', 'adm', 'update', S(), new=dict(S1, mergedInto='s0', hidden=True, status='declined'))
case(A, 'admin links roadmap + shipped build', 'adm', 'update', S(), new=dict(S1, status='shipped', roadmapId='market-stats', shippedBuild=740))
case(DN, 'admin sets unknown status', 'adm', 'update', S(), new=dict(S1, status='done'))
case(DN, 'admin changes author', 'adm', 'update', S(), new=dict(S1, authorUid='adm'))
case(DN, 'admin adds unknown field', 'adm', 'update', S(), new=dict(S1, featured=True))
case(A, 'admin deletes suggestion', 'adm', 'delete', S())
case(DN, 'member sets status', 'ann', 'update', S(), new=dict(S1, status='planned'))
case(DN, 'author writes official reply', 'ann', 'update', S(), new=dict(S1, officialReply=REPLY))
case(DN, 'author unhides own', 'ann', 'update', S('hid'), new=sg(hidden=False), before={S('hid'): sg(hidden=True)})
case(DN, 'author edits own title (v1: no edits)', 'ann', 'update', S(), new=dict(S1, title='Changed title'))
case(DN, 'member deletes suggestion', 'ann', 'delete', S())
case(A, 'admin bans member', 'adm', 'create', '/suggestBans/zed', new={'at': TS}, old=None)
case(DN, 'member bans someone', 'bob', 'create', '/suggestBans/zed', new={'at': TS}, old=None)
case(DN, 'banned member lifts own ban', 'bad', 'delete', '/suggestBans/bad')
case(A, 'banned member reads own ban', 'bad', 'get', '/suggestBans/bad')

# ---------- regression ----------
case(DN, 'regression: student sets own plan', 'bob', 'update', '/students/bob', old={'plan': 'Free'}, new={'plan': 'Pro'}, before={'/students/bob': {'plan': 'Free'}})
case(DN, 'regression: random collection denied', 'bob', 'create', '/secretStuff/x', new={'a': 1}, old=None)
case(DN, 'regression: member creates admins doc', 'bob', 'create', '/admins/bob', new={'a': 1}, old=None)
case(A, 'regression: notification create (status-change notice shape)', 'adm', 'create', '/notifications/n1',
     new={'recipientUid': 'ann', 'type': 'suggestion', 'message': 'Your suggestion is now Planned', 'link': 'suggestions#s1', 'read': False, 'senderUid': 'adm'}, old=None)

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
        print(('PASS' if ok else 'FAIL'), t['expectation'], name, '' if ok else json.dumps(res.get('debugMessages') or res.get('errorPosition') or '')[:300])
print(f'{len(cases) - fails}/{len(cases)} passed')
sys.exit(1 if fails else 0)
