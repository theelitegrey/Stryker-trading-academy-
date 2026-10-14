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
# Paper trading LEADERBOARD rules (2026-10-14): students/{uid}/paperTrading/public opt-in profile
# (owner only, strict shape, no rank fields) and leaderboards/* (public read, no client write).
# Run: FB_TOKEN_FILE=<token file> python3 tools/tests/paper-leaderboard-rules-test.py functions-src/firestore.rules
A="/students/alice/paperTrading/public"
G={"optIn":True,"displayName":"Alice T.","updatedAt":TS}
case("ALLOW","opt-in create own",'alice',"create",A,new=G)
case("ALLOW","opt-out update own",'alice',"update",A,new=dict(G,optIn=False),old=G)
case("ALLOW","get own profile",'alice',"get",A,old=G)
case("ALLOW","delete own profile",'alice',"delete",A,old=G)
case("ALLOW","name 2 chars",'alice',"create",A,new=dict(G,displayName="Al"))
case("ALLOW","name 24 chars",'alice',"create",A,new=dict(G,displayName="a"*24))
case("ALLOW","name with ._'-",'alice',"create",A,new=dict(G,displayName="o'neil_j.r-2"))
case("DENY","name 1 char",'alice',"create",A,new=dict(G,displayName="A"))
case("DENY","name 25 chars",'alice',"create",A,new=dict(G,displayName="a"*25))
case("DENY","name is an email",'alice',"create",A,new=dict(G,displayName="a@b.co"))
case("DENY","name with <script>",'alice',"create",A,new=dict(G,displayName="<b>x</b>"))
case("DENY","name not string",'alice',"create",A,new=dict(G,displayName=5))
case("DENY","optIn not bool",'alice',"create",A,new=dict(G,optIn="yes"))
case("DENY","self-written rank",'alice',"create",A,new=dict(G,rank=1))
case("DENY","self-written return",'alice',"create",A,new=dict(G,returnPct=999))
case("DENY","missing displayName",'alice',"create",A,new={"optIn":True,"updatedAt":TS})
case("DENY","client time",'alice',"create",A,new=dict(G,updatedAt="2020-01-01T00:00:00Z"))
case("DENY","bob reads alice profile",'bob',"get",A,old=G)
case("DENY","bob writes alice profile",'bob',"create",A,new=G)
case("DENY","bob deletes alice profile",'bob',"delete",A,old=G)
case("DENY","signed-out reads profile",None,"get",A,old=G)
case("DENY","list paperTrading",'alice',"list","/students/alice/paperTrading/x",old=G)
AC="/students/alice/paperTrading/account"; GA={"state":"{}","updatedAt":TS}
case("ALLOW","account doc still owner-writable",'alice',"create",AC,new=GA)
case("DENY","account doc cannot take optIn",'alice',"create",AC,new=dict(GA,optIn=True))
case("DENY","public doc cannot take state",'alice',"create",A,new=dict(G,state="{}"))
case("DENY","other doc id still denied",'alice',"create","/students/alice/paperTrading/other",new=G)
L="/leaderboards/paper-week"; LB={"rows":[],"period":"week"}
case("ALLOW","signed-in reads leaderboard",'alice',"get",L,old=LB)
case("ALLOW","signed-out reads leaderboard",None,"get",L,old=LB)
case("ALLOW","list leaderboards",'bob',"list","/leaderboards/x",old=LB)
case("DENY","member writes leaderboard",'alice',"create",L,new=LB)
case("DENY","member updates leaderboard",'alice',"update",L,new=LB,old=LB)
case("DENY","member deletes leaderboard",'alice',"delete",L,old=LB)
case("DENY","admin client writes leaderboard",'admin',"update",L,new=LB,old=LB)
case("DENY","signed-out writes leaderboard",None,"create",L,new=LB)
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
