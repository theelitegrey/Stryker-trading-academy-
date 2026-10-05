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
L=f"/students/alice/chartLayouts/{LID}"
G={"name":"My NQ","state":'{"version":1}',"symbol":"futures:NQ1!","interval":"15","shared":False,"updatedAt":TS}
# --- chartLayouts
case("ALLOW","A create layout",'alice',"create",L,new=G)
case("ALLOW","A update layout",'alice',"update",L,new=dict(G,shared=True),old=G)
case("ALLOW","A get own",'alice',"get",L,old=G)
case("ALLOW","A list own",'alice',"list","/students/alice/chartLayouts/x",old=G)
case("ALLOW","A delete own",'alice',"delete",L,old=G)
case("ALLOW","A create no symbol/interval",'alice',"create",L,new={k:v for k,v in G.items() if k not in('symbol','interval')})
case("ALLOW","A state 200000",'alice',"create",L,new=dict(G,state="x"*200000))
case("DENY","A state 200001",'alice',"create",L,new=dict(G,state="x"*200001))
case("DENY","A name empty",'alice',"create",L,new=dict(G,name=""))
case("DENY","A name 61",'alice',"create",L,new=dict(G,name="n"*61))
case("DENY","A extra key",'alice',"create",L,new=dict(G,plan="Elite"))
case("DENY","A shared not bool",'alice',"create",L,new=dict(G,shared="yes"))
case("DENY","A missing shared",'alice',"create",L,new={k:v for k,v in G.items() if k!='shared'})
case("DENY","A client time",'alice',"create",L,new=dict(G,updatedAt="2020-01-01T00:00:00Z"))
case("DENY","A symbol 81",'alice',"create",L,new=dict(G,symbol="s"*81))
case("DENY","A interval 11",'alice',"create",L,new=dict(G,interval="i"*11))
case("DENY","A id 41 chars",'alice',"create","/students/alice/chartLayouts/"+"a"*41,new=G)
case("DENY","B read A's layout",'bob',"get",L,old=G)
case("DENY","B list A's layouts",'bob',"list","/students/alice/chartLayouts/x",old=G)
case("DENY","B write A's layout",'bob',"create",L,new=G)
case("DENY","B delete A's layout",'bob',"delete",L,old=G)
case("DENY","signed-out get",None,"get",L,old=G)
case("DENY","admin read A's layout (owner only)",'admin',"get",L,old=G)
# --- chartShared
S=f"/chartShared/{LID}"
SH={"ownerUid":"alice","name":"My NQ","state":'{"version":1}',"updatedAt":TS}
have=[m("exists",f"/students/alice/chartLayouts/{LID}",True)]
nohave=[m("exists",f"/students/alice/chartLayouts/{LID}",False)]
bobhave=[m("exists",f"/students/bob/chartLayouts/{LID}",True)]
case("ALLOW","A share (create)",'alice',"create",S,new=SH,mocks=have)
case("ALLOW","A update share",'alice',"update",S,new=dict(SH,name="Renamed"),old=SH,mocks=have)
case("ALLOW","A unshare (delete)",'alice',"delete",S,old=SH)
case("ALLOW","B get shared by id",'bob',"get",S,old=SH)
case("ALLOW","A get own shared",'alice',"get",S,old=SH)
case("DENY","B list shared",'bob',"list","/chartShared/x",old=SH)
case("DENY","A list shared",'alice',"list","/chartShared/x",old=SH)
case("DENY","signed-out get shared",None,"get",S,old=SH)
case("DENY","A share without own layout",'alice',"create",S,new=SH,mocks=nohave)
case("DENY","B create as alice (ownerUid spoof)",'bob',"create",S,new=SH,mocks=bobhave)
case("DENY","B create own ownerUid on A's id",'bob',"create",S,new=dict(SH,ownerUid="bob"),mocks=[m("exists",f"/students/bob/chartLayouts/{LID}",False)])
case("DENY","B update A's shared",'bob',"update",S,new=dict(SH,ownerUid="bob"),old=SH,mocks=bobhave)
case("DENY","B update A's shared keep owner",'bob',"update",S,new=SH,old=SH,mocks=bobhave)
case("DENY","B delete A's shared",'bob',"delete",S,old=SH)
case("DENY","A share short id",'alice',"create","/chartShared/short",new=SH,mocks=[m("exists","/students/alice/chartLayouts/short",True)])
case("DENY","A share extra key",'alice',"create",S,new=dict(SH,email="a@b.c"),mocks=have)
case("DENY","A share state 200001",'alice',"create",S,new=dict(SH,state="x"*200001),mocks=have)
case("DENY","A share client time",'alice',"create",S,new=dict(SH,updatedAt="2020-01-01T00:00:00Z"),mocks=have)
case("DENY","A share name empty",'alice',"create",S,new=dict(SH,name=""),mocks=have)
case("DENY","signed-out create shared",None,"create",S,new=SH)
# --- wildcard carve-out + regressions
case("DENY","A write junk to chartLayouts via wildcard shape",'alice',"create",L,new={"anything":"x"*10})
case("ALLOW","A other subcollection still via wildcard",'alice',"create","/students/alice/replay/r1",new={"x":1})
case("DENY","A self-grant plan",'alice',"update","/students/alice",new={"plan":"Elite"},old={"plan":"Starter"})
case("DENY","A create student doc with Elite",'alice',"create","/students/alice",new={"plan":"Elite"})
case("ALLOW","A bootstrap Starter",'alice',"create","/students/alice",new={"plan":"Starter"})
case("DENY","B read A student doc",'bob',"get","/students/alice",old={"plan":"Starter"})
case("DENY","A unknown collection",'alice',"create","/chartLayoutsTop/x",new={"a":1})

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
