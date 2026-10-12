# Firestore rules suite for Charts PAPER TRADING (students/{uid}/paperTrading/account).
# FB_TOKEN_FILE=<oauth token file> python3 chart-paper-rules-test.py <rules file>
# Uses the Rules :test API only (no data touched).
import json,urllib.request,urllib.error,sys,os
T=open(os.environ['FB_TOKEN_FILE']).read().strip(); P='strykertrades-e0cd8'
D='/databases/(default)/documents'
TS="2026-10-12T00:00:00Z"
def m(fn,path,val): return {"function":fn,"args":[{"exactValue":D+path}],"result":{"value":val}}
cases=[]
def case(exp,name,uid,method,path,new=None,old=None,time=TS):
    req={"auth":({"uid":uid,"token":{}} if uid else None),"method":method,"path":D+path,"time":TS}
    if new is not None: req["resource"]={"data":new}
    ms=[m("exists",f"/admins/{u}",u=='admin') for u in {uid or 'x','alice','bob','admin'}]
    c={"expectation":exp,"request":req,"functionMocks":ms}
    if old is not None: c["resource"]={"data":old}
    cases.append((name,c))
A="/students/alice/paperTrading/account"
G={"state":json.dumps({"v":1,"balance":100000}),"updatedAt":TS}
case("ALLOW","A create account",'alice',"create",A,new=G)
case("ALLOW","A update account",'alice',"update",A,new=G,old=G)
case("ALLOW","A get own",'alice',"get",A,old=G)
case("ALLOW","A delete own",'alice',"delete",A,old=G)
case("ALLOW","A state 400000 chars",'alice',"create",A,new=dict(G,state="x"*400000))
case("DENY","A state 400001 chars",'alice',"create",A,new=dict(G,state="x"*400001))
case("DENY","A state not string",'alice',"create",A,new=dict(G,state={"v":1}))
case("DENY","A extra key",'alice',"create",A,new=dict(G,plan="Elite"))
case("DENY","A missing updatedAt",'alice',"create",A,new={"state":"{}"})
case("DENY","A missing state",'alice',"create",A,new={"updatedAt":TS})
case("DENY","A client time",'alice',"create",A,new=dict(G,updatedAt="2020-01-01T00:00:00Z"))
case("DENY","A other doc id",'alice',"create","/students/alice/paperTrading/other",new=G)
case("DENY","A get other doc id",'alice',"get","/students/alice/paperTrading/other",old=G)
case("DENY","A list collection",'alice',"list","/students/alice/paperTrading/x",old=G)
case("DENY","A nested under account",'alice',"create",A+"/sub/x",new={"a":1})
case("DENY","B read A",'bob',"get",A,old=G)
case("DENY","B write A",'bob',"create",A,new=G)
case("DENY","B delete A",'bob',"delete",A,old=G)
case("DENY","admin read (owner only)",'admin',"get",A,old=G)
case("DENY","admin write (owner only)",'admin',"update",A,new=G,old=G)
case("DENY","signed-out get",None,"get",A,old=G)
case("DENY","signed-out create",None,"create",A,new=G)
# regressions: wildcard + neighbours
case("ALLOW","A journal still via its block",'alice',"create","/students/alice/journal/j1",new={"pnl":1,"tags":["paper"]})
case("ALLOW","A replay still via its block",'alice',"create","/students/alice/replay/r1",new={"x":1})
case("ALLOW","A other subcollection still via wildcard",'alice',"create","/students/alice/misc/x",new={"x":1})
case("DENY","B write A journal",'bob',"create","/students/alice/journal/j1",new={"pnl":1})
case("DENY","A self-grant plan",'alice',"update","/students/alice",new={"plan":"Elite"},old={"plan":"Starter"})
case("DENY","A watchlists junk (block intact)",'alice',"create","/students/alice/watchlists/abcdefghijKLMNOPqrst",new={"junk":1})
case("DENY","A chartLayouts junk (block intact)",'alice',"create","/students/alice/chartLayouts/abcdefghijKLMNOPqrst",new={"junk":1})
case("ALLOW","A paperTradingX still wildcard (exact-name carve-out)",'alice',"create","/students/alice/paperTradingX/x",new={"a":1})
case("DENY","A junk via wildcard on paperTrading",'alice',"create",A,new={"anything":"x"})
def run(src):
    body={"source":{"files":[{"name":"firestore.rules","content":src}]},"testSuite":{"testCases":[c for _,c in cases]}}
    rq=urllib.request.Request(f"https://firebaserules.googleapis.com/v1/projects/{P}:test",data=json.dumps(body).encode(),headers={"Authorization":"Bearer "+T,"Content-Type":"application/json","x-goog-user-project":P})
    try: r=json.load(urllib.request.urlopen(rq))
    except urllib.error.HTTPError as e: print(e.read().decode()); sys.exit(2)
    if r.get('issues'): print('ISSUES',json.dumps(r['issues'])[:2000])
    res=r.get('testResults',[]); bad=0
    for (n,_),x in zip(cases,res):
        ok=x.get('state')=='SUCCESS'; bad+=0 if ok else 1
        print(('PASS ' if ok else 'FAIL ')+n+('' if ok else ' '+json.dumps(x.get('debugMessages') or x)[:300]))
    print(f"{len(res)-bad}/{len(cases)} passed"); return bad
sys.exit(1 if run(open(sys.argv[1]).read()) else 0)
