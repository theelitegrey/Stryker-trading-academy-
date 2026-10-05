# Firestore rules suite for the Charts watchlist (students/{uid}/watchlists + watchlistShared).
# FB_TOKEN_FILE=<oauth token file> python3 chart-watchlist-rules-test.py <rules file>
# Uses the Rules :test API only (no data touched).
import json,urllib.request,urllib.error,sys,os
T=open(os.environ['FB_TOKEN_FILE']).read().strip(); P='strykertrades-e0cd8'
D='/databases/(default)/documents'
TS="2026-10-06T00:00:00Z"
WID='abcdefghijKLMNOPqrst'
def m(fn,path,val): return {"function":fn,"args":[{"exactValue":D+path}],"result":{"value":val}}
cases=[]
def case(exp,name,uid,method,path,new=None,old=None,mocks=None):
    req={"auth":({"uid":uid,"token":{}} if uid else None),"method":method,"path":D+path,"time":TS}
    if new is not None: req["resource"]={"data":new}
    ms=[m("exists",f"/admins/{u}",u=='admin') for u in {uid or 'x','alice','bob','admin'}]
    ms+=(mocks or [])
    c={"expectation":exp,"request":req,"functionMocks":ms}
    if old is not None: c["resource"]={"data":old}
    cases.append((name,c))
W=f"/students/alice/watchlists/{WID}"
V={"table":True,"last":True,"chg":True,"chgp":True,"vol":False,"ext":False,"logo":True,"disp":"symbol"}
G={"name":"Watchlist","items":["###FUTURES","futures:NQ1!","futures:ES1!","###CRYPTO","binance:BTCUSDT"],"collapsed":[],"view":V,"shared":False,"updatedAt":TS}
case("ALLOW","A create list",'alice',"create",W,new=G)
case("ALLOW","A update list",'alice',"update",W,new=dict(G,shared=True,name="Renamed"),old=G)
case("ALLOW","A get own",'alice',"get",W,old=G)
case("ALLOW","A list own",'alice',"list","/students/alice/watchlists/x",old=G)
case("ALLOW","A delete own",'alice',"delete",W,old=G)
case("ALLOW","A minimal (no collapsed/view)",'alice',"create",W,new={k:v for k,v in G.items() if k not in('collapsed','view')})
case("ALLOW","A 260 items",'alice',"create",W,new=dict(G,items=["futures:NQ1!"]*260))
case("DENY","A 261 items",'alice',"create",W,new=dict(G,items=["futures:NQ1!"]*261))
case("DENY","A items not list",'alice',"create",W,new=dict(G,items="NQ1!"))
case("DENY","A name empty",'alice',"create",W,new=dict(G,name=""))
case("DENY","A name 61",'alice',"create",W,new=dict(G,name="n"*61))
case("DENY","A extra key",'alice',"create",W,new=dict(G,plan="Elite"))
case("DENY","A shared not bool",'alice',"create",W,new=dict(G,shared="yes"))
case("DENY","A missing shared",'alice',"create",W,new={k:v for k,v in G.items() if k!='shared'})
case("DENY","A missing items",'alice',"create",W,new={k:v for k,v in G.items() if k!='items'})
case("DENY","A client time",'alice',"create",W,new=dict(G,updatedAt="2020-01-01T00:00:00Z"))
case("DENY","A collapsed 51",'alice',"create",W,new=dict(G,collapsed=["X"]*51))
case("DENY","A view not map",'alice',"create",W,new=dict(G,view="x"))
case("DENY","A view 13 keys",'alice',"create",W,new=dict(G,view={f"k{i}":1 for i in range(13)}))
case("DENY","A short id",'alice',"create","/students/alice/watchlists/short",new=G)
case("DENY","A id 41",'alice',"create","/students/alice/watchlists/"+"a"*41,new=G)
case("DENY","B read A list",'bob',"get",W,old=G)
case("DENY","B list A lists",'bob',"list","/students/alice/watchlists/x",old=G)
case("DENY","B write A list",'bob',"create",W,new=G)
case("DENY","B delete A list",'bob',"delete",W,old=G)
case("DENY","signed-out get",None,"get",W,old=G)
case("DENY","admin read A list (owner only)",'admin',"get",W,old=G)
case("DENY","A junk shape via wildcard",'alice',"create",W,new={"anything":"x"})
S=f"/watchlistShared/{WID}"
SH={"ownerUid":"alice","name":"Watchlist","items":G["items"],"updatedAt":TS}
have=[m("exists",f"/students/alice/watchlists/{WID}",True)]
nohave=[m("exists",f"/students/alice/watchlists/{WID}",False)]
bobhave=[m("exists",f"/students/bob/watchlists/{WID}",True)]
case("ALLOW","A share (create)",'alice',"create",S,new=SH,mocks=have)
case("ALLOW","A update share",'alice',"update",S,new=dict(SH,name="R"),old=SH,mocks=have)
case("ALLOW","A unshare (delete)",'alice',"delete",S,old=SH)
case("ALLOW","B get shared by id",'bob',"get",S,old=SH)
case("DENY","B list shared",'bob',"list","/watchlistShared/x",old=SH)
case("DENY","signed-out get shared",None,"get",S,old=SH)
case("DENY","A share without own list",'alice',"create",S,new=SH,mocks=nohave)
case("DENY","B create as alice",'bob',"create",S,new=SH,mocks=bobhave)
case("DENY","B create own ownerUid on A id",'bob',"create",S,new=dict(SH,ownerUid="bob"),mocks=[m("exists",f"/students/bob/watchlists/{WID}",False)])
case("DENY","B update A shared",'bob',"update",S,new=dict(SH,ownerUid="bob"),old=SH,mocks=bobhave)
case("DENY","B delete A shared",'bob',"delete",S,old=SH)
case("DENY","A share short id",'alice',"create","/watchlistShared/short",new=SH,mocks=[m("exists","/students/alice/watchlists/short",True)])
case("DENY","A share extra key",'alice',"create",S,new=dict(SH,email="a@b.c"),mocks=have)
case("DENY","A share 261 items",'alice',"create",S,new=dict(SH,items=["x"]*261),mocks=have)
case("DENY","A share client time",'alice',"create",S,new=dict(SH,updatedAt="2020-01-01T00:00:00Z"),mocks=have)
case("DENY","signed-out create shared",None,"create",S,new=SH)
# regressions
case("ALLOW","A other subcollection still via wildcard",'alice',"create","/students/alice/replay/r1",new={"x":1})
case("DENY","A self-grant plan",'alice',"update","/students/alice",new={"plan":"Elite"},old={"plan":"Starter"})
case("DENY","A create student doc with Elite",'alice',"create","/students/alice",new={"plan":"Elite"})
case("ALLOW","A bootstrap Starter",'alice',"create","/students/alice",new={"plan":"Starter"})
case("DENY","B read A student doc",'bob',"get","/students/alice",old={"plan":"Starter"})
case("DENY","A unknown top-level collection",'alice',"create","/watchlistsTop/x",new={"a":1})
case("DENY","A chartPrefs junk (other engineer's block intact)",'alice',"create","/students/alice/chartPrefs/favToolbar",new={"junk":1})
case("DENY","A chartLayouts junk (block intact)",'alice',"create","/students/alice/chartLayouts/"+WID,new={"junk":1})
def run(src,label):
    body={"source":{"files":[{"name":"firestore.rules","content":src}]},"testSuite":{"testCases":[c for _,c in cases]}}
    rq=urllib.request.Request(f"https://firebaserules.googleapis.com/v1/projects/{P}:test",json.dumps(body).encode(),{"Authorization":"Bearer "+T,"Content-Type":"application/json"})
    try: r=json.load(urllib.request.urlopen(rq))
    except urllib.error.HTTPError as e: print(e.read().decode()[:3000]); return
    if r.get('issues'): print('ISSUES',json.dumps(r['issues'][:5])[:2000])
    res=r.get('testResults',[]); ok=sum(1 for x in res if x.get('state')=='SUCCESS')
    print(f"{label}: {ok}/{len(cases)} passed")
    for (n,c),x in zip(cases,res):
        if x.get('state')!='SUCCESS': print('  FAIL',n,c['expectation'])
run(open(sys.argv[1]).read(),sys.argv[1])
