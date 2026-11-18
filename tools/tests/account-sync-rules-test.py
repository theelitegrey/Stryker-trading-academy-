# ACCOUNT SETTINGS SYNC rules (users/{uid}/prefs/{group}, assets/account-sync.js). Firebase Rules test API, no deploy.
#   FB_TOKEN_FILE=<oauth token file> python3 tools/tests/account-sync-rules-test.py functions-src/firestore.rules
import json,urllib.request,urllib.error,sys,os
T=open(os.environ['FB_TOKEN_FILE']).read().strip(); P='strykertrades-e0cd8'
D='/databases/(default)/documents'
TS="2026-11-18T00:00:00Z"
def m(fn,path,val): return {"function":fn,"args":[{"exactValue":D+path}],"result":{"value":val}}
cases=[]
def case(exp,name,uid,method,path,new=None,old=None):
    req={"auth":({"uid":uid,"token":{}} if uid else None),"method":method,"path":D+path,"time":TS}
    if new is not None: req["resource"]={"data":new}
    c={"expectation":exp,"request":req,"functionMocks":[m("exists",f"/admins/{u}",u=='admin') for u in {uid or 'x','alice','bob','admin'}]}
    if old is not None: c["resource"]={"data":old}
    cases.append((name,c))
A="/users/alice/prefs/chart"
G={"v":{"chartTypeFavs":'["candles"]',"layoutRecent":None},"t":{"chartTypeFavs":TS},"updatedAt":TS}
for g in ['app','chart','trade']:
    case("ALLOW",f"A create {g}",'alice',"create",f"/users/alice/prefs/{g}",new=G)
case("ALLOW","A update",'alice',"update",A,new=dict(G,v={"x":"1"}),old=G)
case("ALLOW","A get",'alice',"get",A,old=G)
case("ALLOW","A delete",'alice',"delete",A,old=G)
case("ALLOW","A no t map",'alice',"create",A,new={"v":{},"updatedAt":TS})
case("ALLOW","A 80 keys",'alice',"create",A,new=dict(G,v={f"k{i}":"x" for i in range(80)}))
case("DENY","A 81 keys",'alice',"create",A,new=dict(G,v={f"k{i}":"x" for i in range(81)}))
case("DENY","A t 81 keys",'alice',"create",A,new=dict(G,t={f"k{i}":TS for i in range(81)}))
case("DENY","A v not map",'alice',"create",A,new=dict(G,v="x"))
case("DENY","A extra key",'alice',"create",A,new=dict(G,plan="Elite"))
case("DENY","A missing v",'alice',"create",A,new={"updatedAt":TS})
case("DENY","A client time",'alice',"create",A,new=dict(G,updatedAt="2020-01-01T00:00:00Z"))
case("DENY","A unknown group",'alice',"create","/users/alice/prefs/other",new=G)
case("DENY","A get unknown group",'alice',"get","/users/alice/prefs/other",old=G)
case("DENY","B read A",'bob',"get",A,old=G)
case("DENY","B write A",'bob',"create",A,new=G)
case("DENY","B delete A",'bob',"delete",A,old=G)
case("DENY","admin read A (owner only)",'admin',"get",A,old=G)
case("DENY","signed-out get",None,"get",A,old=G)
case("DENY","signed-out write",None,"create",A,new=G)
case("DENY","A users/{uid} root doc",'alice',"create","/users/alice",new={"x":1})
case("DENY","A deeper path",'alice',"create","/users/alice/prefs/chart/x/y",new=G)
def run(src,label):
    body={"source":{"files":[{"name":"firestore.rules","content":src}]},"testSuite":{"testCases":[c for _,c in cases]}}
    rq=urllib.request.Request(f"https://firebaserules.googleapis.com/v1/projects/{P}:test",json.dumps(body).encode(),{"Authorization":"Bearer "+T,"Content-Type":"application/json"})
    try: r=json.load(urllib.request.urlopen(rq))
    except urllib.error.HTTPError as e: print(e.read().decode()[:3000]); sys.exit(1)
    if r.get('issues'): print('ISSUES',json.dumps(r['issues'][:5])[:2000])
    res=r.get('testResults',[]); ok=sum(1 for x in res if x.get('state')=='SUCCESS')
    print(f"{label}: {ok}/{len(cases)} passed")
    for (n,c),x in zip(cases,res):
        if x.get('state')!='SUCCESS': print('  FAIL',n,c['expectation'])
    sys.exit(0 if ok==len(cases) else 1)
run(open(sys.argv[1]).read(),sys.argv[1])
