import json,urllib.request,urllib.error,sys,os
T=open(os.environ['FB_TOKEN_FILE']).read().strip(); P='strykertrades-e0cd8'
D='/databases/(default)/documents'
TS="2026-10-06T00:00:00Z"
LID='abcdefghijKLMNOPqrst'   # 20 chars like a Firestore auto id
def m(fn,path,val): return {"function":fn,"args":[{"exactValue":D+path}],"result":{"value":val}}
cases=[]
def case(exp,name,uid,method,path,new=None,old=None,mocks=None):
    req={"auth":({"uid":uid,"token":{}} if uid else None),"method":method,"path":D+path,"time":TS}
    if new is not None: req["resource"]={"data":new}
    ms=[m("exists",f"/admins/{u}",u=='admin') for u in {uid or 'x','alice','bob','admin'}]
    ms+= (mocks or [])
    c={"expectation":exp,"request":req,"functionMocks":ms}
    if old is not None: c["resource"]={"data":old}
    cases.append((name,c))
SID='scr1abcdefghijklmnop'
L=f"/students/alice/screens/{SID}"
G={"name":"Gap up tech","spec":'{"m":"stock","flt":[]}',"m":"stock","updatedAt":TS}
case("ALLOW","create screen",'alice',"create",L,new=G)
case("ALLOW","update screen",'alice',"update",L,new=dict(G,name="Renamed"),old=G)
case("ALLOW","get own",'alice',"get",L,old=G)
case("ALLOW","list own",'alice',"list","/students/alice/screens/x",old=G)
case("ALLOW","delete own",'alice',"delete",L,old=G)
case("ALLOW","market fut",'alice',"create",L,new=dict(G,m="fut"))
case("ALLOW","spec 4000",'alice',"create",L,new=dict(G,spec="x"*4000))
case("DENY","spec 4001",'alice',"create",L,new=dict(G,spec="x"*4001))
case("DENY","name empty",'alice',"create",L,new=dict(G,name=""))
case("DENY","name 61",'alice',"create",L,new=dict(G,name="n"*61))
case("DENY","extra key",'alice',"create",L,new=dict(G,plan="Elite"))
case("DENY","missing spec",'alice',"create",L,new={k:v for k,v in G.items() if k!='spec'})
case("DENY","bad market",'alice',"create",L,new=dict(G,m="forex"))
case("DENY","client time",'alice',"create",L,new=dict(G,updatedAt="2020-01-01T00:00:00Z"))
case("DENY","id 41 chars",'alice',"create","/students/alice/screens/"+"a"*41,new=G)
case("DENY","B reads A",'bob',"get",L,old=G)
case("DENY","B lists A",'bob',"list","/students/alice/screens/x",old=G)
case("DENY","B writes A",'bob',"create",L,new=G)
case("DENY","B deletes A",'bob',"delete",L,old=G)
case("DENY","signed-out get",None,"get",L,old=G)
case("DENY","admin reads A (owner only)",'admin',"get",L,old=G)
case("DENY","wildcard shape junk",'alice',"create",L,new={"anything":"x"})
case("ALLOW","other subcollection still via wildcard",'alice',"create","/students/alice/replay/r1",new={"x":1})

def run(src,label):
    body={"source":{"files":[{"name":"firestore.rules","content":src}]},"testSuite":{"testCases":[c for _,c in cases]}}
    rq=urllib.request.Request(f"https://firebaserules.googleapis.com/v1/projects/{P}:test",json.dumps(body).encode(),{"Authorization":"Bearer "+T,"Content-Type":"application/json"})
    try: r=json.load(urllib.request.urlopen(rq))
    except urllib.error.HTTPError as e: print(e.read().decode()[:3000]); return
    if r.get('issues'): print('ISSUES',json.dumps(r['issues'][:5])[:2000])
    res=r.get('testResults',[]); ok=sum(1 for x in res if x.get('state')=='SUCCESS')
    print(f"{label}: {ok}/{len(cases)} passed")
    for (n,c),x in zip(cases,res):
        if x.get('state')!='SUCCESS': print('  FAIL',n,c['expectation'],(x.get('debugMessages') or [])[:2],sorted({v.get('sourcePosition',{}).get('line') for v in x.get('visitedExpressions',[])})[:8])
run(open(sys.argv[1]).read(),sys.argv[1])
