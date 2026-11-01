#!/usr/bin/env python3
# Evaluates member support and public-contact rules using the Firebase Rules test API.
# No Firestore documents are read or written.
import json, os, sys, urllib.error, urllib.request

P = 'strykertrades-e0cd8'; D = '/databases/(default)/documents'; TS = '2026-11-01T12:00:00Z'
T = open(os.environ['FB_TOKEN_FILE']).read().strip(); cases = []

def mock_exists(uid, admin=False):
    return {"function":"exists","args":[{"exactValue":D + '/admins/' + uid}],"result":{"value":admin}}

def mock_get_ticket(ticket, owner):
    return {"function":"get","args":[{"exactValue":D + '/supportTickets/' + ticket}],"result":{"value":{"data":{"ownerUid":owner}}}}

def case(expect, name, uid, method, path, new=None, old=None, extra=None):
    req = {"auth":({"uid":uid,"token":{}} if uid else None),"method":method,"path":D + path,"time":TS}
    if new is not None: req['resource'] = {"data":new}
    mocks = [mock_exists(uid or 'anon', uid == 'admin')]
    if extra: mocks += extra
    item = {"expectation":expect,"request":req,"functionMocks":mocks}
    if old is not None: item['resource'] = {"data":old}
    cases.append((name,item))

valid_contact = {"name":"External Person","email":"person@example.com","message":"Please help with a public question.","status":"new","createdAt":TS}
case('ALLOW','signed-out valid contact create',None,'create','/contactMessages/c1',new=valid_contact)
case('DENY','signed-in cannot create public contact','alice','create','/contactMessages/c2',new=valid_contact)
case('DENY','contact extra key denied',None,'create','/contactMessages/c3',new=dict(valid_contact,userUid='alice'))
case('DENY','contact malformed email denied',None,'create','/contactMessages/c4',new=dict(valid_contact,email='bad'))
case('DENY','contact oversize name denied',None,'create','/contactMessages/c5',new=dict(valid_contact,name='x'*101))
case('DENY','contact oversize message denied',None,'create','/contactMessages/c6',new=dict(valid_contact,message='x'*4001))
case('DENY','contact wrong status denied',None,'create','/contactMessages/c7',new=dict(valid_contact,status='handled'))
case('ALLOW','admin reads legacy contact','admin','get','/contactMessages/old',old={"name":"Old","email":"old@example.com","message":"Legacy","userUid":"old-user","status":"new"})
case('ALLOW','admin updates legacy contact','admin','update','/contactMessages/old',old={"name":"Old","userUid":"old-user","status":"new"},new={"name":"Old","userUid":"old-user","status":"handled"})

ticket = {"ownerUid":"alice","subject":"Chart issue","status":"waiting_for_support"}
case('ALLOW','owner reads own ticket','alice','get','/supportTickets/t1',old=ticket)
case('DENY','user A cannot read user B ticket','bob','get','/supportTickets/t1',old=ticket)
case('DENY','anonymous cannot read ticket',None,'get','/supportTickets/t1',old=ticket)
case('ALLOW','admin reads ticket','admin','get','/supportTickets/t1',old=ticket)
case('DENY','member cannot create ticket directly','alice','create','/supportTickets/t2',new=ticket)
case('DENY','member cannot change owner','alice','update','/supportTickets/t1',old=ticket,new=dict(ticket,ownerUid='bob'))
case('DENY','admin client cannot bypass callable status action','admin','update','/supportTickets/t1',old=ticket,new=dict(ticket,status='closed'))
case('DENY','member cannot read server throttle','alice','get','/supportTicketThrottle/alice',old={"lastCreatedAtMs":1})
case('DENY','member cannot reset server throttle','alice','update','/supportTicketThrottle/alice',old={"lastCreatedAtMs":1},new={"lastCreatedAtMs":0})
case('DENY','member cannot forge admin reply','alice','create','/supportTickets/t1/messages/m1',new={"senderUid":"alice","senderRole":"admin","body":"forged","createdAt":TS},extra=[mock_get_ticket('t1','alice')])
case('DENY','user A cannot reply to user B directly','bob','create','/supportTickets/t1/messages/m2',new={"senderUid":"bob","senderRole":"member","body":"cross user","createdAt":TS},extra=[mock_get_ticket('t1','alice')])
case('ALLOW','owner reads own ticket messages','alice','get','/supportTickets/t1/messages/m3',old={"senderUid":"admin","senderRole":"admin","body":"reply"},extra=[mock_get_ticket('t1','alice')])
case('DENY','other user cannot read ticket messages','bob','get','/supportTickets/t1/messages/m3',old={"senderUid":"admin","senderRole":"admin","body":"reply"},extra=[mock_get_ticket('t1','alice')])
case('ALLOW','admin reads ticket messages','admin','get','/supportTickets/t1/messages/m3',old={"senderUid":"alice","senderRole":"member","body":"help"},extra=[mock_get_ticket('t1','alice')])

body = {"source":{"files":[{"name":"firestore.rules","content":open(sys.argv[1]).read()}]},"testSuite":{"testCases":[c for _,c in cases]}}
req = urllib.request.Request(f'https://firebaserules.googleapis.com/v1/projects/{P}:test',data=json.dumps(body).encode(),headers={"Authorization":"Bearer "+T,"Content-Type":"application/json","x-goog-user-project":P})
try: result = json.load(urllib.request.urlopen(req))
except urllib.error.HTTPError as err:
    print(err.read().decode()[:3000]); sys.exit(2)
if result.get('issues'): print('ISSUES',json.dumps(result['issues'])[:3000])
bad = 0
for (name,_),value in zip(cases,result.get('testResults',[])):
    ok = value.get('state') == 'SUCCESS'; bad += not ok; print(('PASS ' if ok else 'FAIL ') + name)
    if not ok: print('  ', json.dumps(value)[:1200])
print(f'{len(cases)-bad}/{len(cases)} passed')
sys.exit(1 if bad else 0)
