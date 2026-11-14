# Charts WORKSPACES rules (students/{uid}/chartPrefs/workspaces). Firebase Rules test API, no deploy.
#   FB_TOKEN_FILE=<oauth token file> python3 tools/tests/chart-workspaces-rules-test.py functions-src/firestore.rules
import json,urllib.request,urllib.error,sys,os
T=open(os.environ['FB_TOKEN_FILE']).read().strip(); P='strykertrades-e0cd8'
D='/databases/(default)/documents'
TS="2026-11-14T00:00:00Z"
def m(fn,path,val): return {"function":fn,"args":[{"exactValue":D+path}],"result":{"value":val}}
cases=[]
def case(exp,name,uid,method,path,new=None,old=None):
    req={"auth":({"uid":uid,"token":{}} if uid else None),"method":method,"path":D+path,"time":TS}
    if new is not None: req["resource"]={"data":new}
    c={"expectation":exp,"request":req,"functionMocks":[m("exists",f"/admins/{u}",u=='admin') for u in {uid or 'x','alice','bob','admin'}]}
    if old is not None: c["resource"]={"data":old}
    cases.append((name,c))
W="/students/alice/chartPrefs/workspaces"
G={"index":'{"v":1,"active":"wabcdefgh","items":[]}',"updatedAt":TS}
case("ALLOW","A create",'alice',"create",W,new=G)
case("ALLOW","A update",'alice',"update",W,new=dict(G,index='{"v":1}'),old=G)
case("ALLOW","A get",'alice',"get",W,old=G)
case("ALLOW","A delete",'alice',"delete",W,old=G)
case("ALLOW","A index 20000",'alice',"create",W,new=dict(G,index="x"*20000))
case("DENY","A index 20001",'alice',"create",W,new=dict(G,index="x"*20001))
case("DENY","A index not string",'alice',"create",W,new=dict(G,index=["x"]))
case("DENY","A extra key",'alice',"create",W,new=dict(G,plan="Elite"))
case("DENY","A missing index",'alice',"create",W,new={"updatedAt":TS})
case("DENY","A client time",'alice',"create",W,new=dict(G,updatedAt="2020-01-01T00:00:00Z"))
case("DENY","B read A",'bob',"get",W,old=G)
case("DENY","B write A",'bob',"create",W,new=G)
case("DENY","admin read A (owner only)",'admin',"get",W,old=G)
case("DENY","signed-out get",None,"get",W,old=G)
# regressions: the sibling chartPrefs docs keep their own shapes
case("DENY","A workspaces shape on favToolbar",'alice',"create","/students/alice/chartPrefs/favToolbar",new=G)
case("ALLOW","A favToolbar still ok",'alice',"create","/students/alice/chartPrefs/favToolbar",new={"tools":[],"visible":True,"updatedAt":TS})
case("DENY","A other chartPrefs doc",'alice',"create","/students/alice/chartPrefs/other",new=G)
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
