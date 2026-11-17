# Rules test for LAYOUT LINKS (Owner feature 17 Nov 2026): chartLinks/{slug} lookup docs + the "slug" field on
# students/{uid}/chartLayouts/{lid}. Same method as chart-layouts-rules-test.py: Firebase Rules REST :test with
# function mocks; nothing is written to live data.
#   FB_TOKEN_FILE=<file with a Firebase access token> python3 tools/tests/chart-layout-links-rules-test.py functions-src/firestore.rules
import json,urllib.request,urllib.error,sys,os
T=open(os.environ['FB_TOKEN_FILE']).read().strip(); P='strykertrades-e0cd8'
D='/databases/(default)/documents'
TS="2026-11-17T00:00:00Z"
LID='abcdefghijKLMNOPqrst'
SL='VMW7HYSJ'
def doc(d): return {"data":d}
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
L=f"/students/alice/chartLayouts/{LID}"
K=f"/chartLinks/{SL}"
G={"name":"My NQ","state":'{"version":1}',"symbol":"futures:NQ1!","interval":"15","shared":False,"updatedAt":TS}
OLDG=dict(G,updatedAt="2026-11-01T00:00:00Z")
LINK={"ownerUid":"alice","lid":LID,"createdAt":TS}
linkAfter=[m("getAfter",K,doc(LINK))]
slugAfter=[m("getAfter",L,doc(dict(OLDG,slug=SL)))]

# --- the layout doc: slug set once, by a slug-only update paired with its lookup doc
case("ALLOW","A set slug once (with its link in the batch)",'alice',"update",L,new=dict(OLDG,slug=SL),old=OLDG,mocks=linkAfter)
case("DENY","A set slug without the link doc",'alice',"update",L,new=dict(OLDG,slug=SL),old=OLDG,mocks=[m("getAfter",K,None)])
case("DENY","A set slug whose link points elsewhere",'alice',"update",L,new=dict(OLDG,slug=SL),old=OLDG,mocks=[m("getAfter",K,doc(dict(LINK,lid="otherLayoutIdxxxxxxx")))])
case("DENY","A set slug whose link is bob's",'alice',"update",L,new=dict(OLDG,slug=SL),old=OLDG,mocks=[m("getAfter",K,doc(dict(LINK,ownerUid="bob")))])
case("DENY","A change an existing slug",'alice',"update",L,new=dict(OLDG,slug="ABCDEFGH"),old=dict(OLDG,slug=SL),mocks=[m("getAfter","/chartLinks/ABCDEFGH",doc(LINK))])
case("DENY","A remove the slug in a save",'alice',"update",L,new=G,old=dict(OLDG,slug=SL))
case("DENY","A change slug inside a normal save",'alice',"update",L,new=dict(G,slug="ABCDEFGH"),old=dict(OLDG,slug=SL))
case("ALLOW","A normal save keeps the slug",'alice',"update",L,new=dict(G,slug=SL),old=dict(OLDG,slug=SL))
case("ALLOW","A rename keeps the slug",'alice',"update",L,new=dict(G,name="Renamed",slug=SL),old=dict(OLDG,slug=SL))
case("ALLOW","A save of a layout without slug (old docs)",'alice',"update",L,new=G,old=OLDG)
case("DENY","A slug with confusable chars (0)",'alice',"update",L,new=dict(OLDG,slug="VMW7HYS0"),old=OLDG,mocks=[m("getAfter","/chartLinks/VMW7HYS0",doc(LINK))])
case("DENY","A slug lowercase",'alice',"update",L,new=dict(OLDG,slug="vmw7hysj"),old=OLDG,mocks=[m("getAfter","/chartLinks/vmw7hysj",doc(LINK))])
case("DENY","A slug 9 chars",'alice',"update",L,new=dict(OLDG,slug="VMW7HYSJK"),old=OLDG,mocks=[m("getAfter","/chartLinks/VMW7HYSJK",doc(LINK))])
case("DENY","A slug update that also changes the name",'alice',"update",L,new=dict(OLDG,slug=SL,name="x"),old=OLDG,mocks=linkAfter)
case("DENY","A create layout WITH a slug",'alice',"create",L,new=dict(G,slug=SL))
case("ALLOW","A create layout (no slug) still works",'alice',"create",L,new=G)
case("DENY","B set slug on A's layout",'bob',"update",L,new=dict(OLDG,slug=SL),old=OLDG,mocks=linkAfter)
# --- chartLinks
case("ALLOW","A create link with own layout taking the slug",'alice',"create",K,new=LINK,mocks=slugAfter)
case("DENY","A create link, layout slug differs",'alice',"create",K,new=LINK,mocks=[m("getAfter",L,doc(dict(OLDG,slug="ABCDEFGH")))])
case("DENY","A create link, layout without slug",'alice',"create",K,new=LINK,mocks=[m("getAfter",L,doc(OLDG))])
case("DENY","B create link as alice",'bob',"create",K,new=LINK,mocks=slugAfter)
case("DENY","B create link to A's layout id",'bob',"create",K,new=dict(LINK,ownerUid="bob"),mocks=[m("getAfter",f"/students/bob/chartLayouts/{LID}",None)])
case("DENY","A create link, extra key",'alice',"create",K,new=dict(LINK,state="x"),mocks=slugAfter)
case("DENY","A create link, client time",'alice',"create",K,new=dict(LINK,createdAt="2020-01-01T00:00:00Z"),mocks=slugAfter)
case("DENY","A create link, bad id (O)",'alice',"create","/chartLinks/VMW7HYSO",new=LINK,mocks=[m("getAfter",L,doc(dict(OLDG,slug="VMW7HYSO")))])
case("DENY","A create link, short id",'alice',"create","/chartLinks/VMW7",new=LINK,mocks=[m("getAfter",L,doc(dict(OLDG,slug="VMW7")))])
case("DENY","A update link (never)",'alice',"update",K,new=dict(LINK,lid="otherLayoutIdxxxxxxx"),old=LINK)
case("DENY","B take over A's link (update)",'bob',"update",K,new=dict(LINK,ownerUid="bob"),old=LINK)
case("ALLOW","B get link by id",'bob',"get",K,old=LINK)
case("ALLOW","A get own link",'alice',"get",K,old=LINK)
case("DENY","signed-out get link",None,"get",K,old=LINK)
case("DENY","B list links",'bob',"list","/chartLinks/x",old=LINK)
case("ALLOW","A delete link after the layout is gone",'alice',"delete",K,old=LINK,mocks=[m("exists",L,False)])
case("DENY","A delete link while the layout exists",'alice',"delete",K,old=LINK,mocks=[m("exists",L,True)])
case("DENY","B delete A's link",'bob',"delete",K,old=LINK,mocks=[m("exists",f"/students/bob/chartLayouts/{LID}",False)])
# --- unchanged neighbours
case("DENY","B read A's layout (still owner only)",'bob',"get",L,old=dict(OLDG,slug=SL))
case("ALLOW","B get A's shared snapshot (unchanged)",'bob',"get",f"/chartShared/{LID}",old={"ownerUid":"alice","name":"x","state":"{}","updatedAt":TS})

def run(src,label):
    body={"source":{"files":[{"name":"firestore.rules","content":src}]},"testSuite":{"testCases":[c for _,c in cases]}}
    rq=urllib.request.Request(f"https://firebaserules.googleapis.com/v1/projects/{P}:test",json.dumps(body).encode(),{"Authorization":"Bearer "+T,"Content-Type":"application/json"})
    try: r=json.load(urllib.request.urlopen(rq))
    except urllib.error.HTTPError as e: print(e.read().decode()[:3000]); sys.exit(1)
    if r.get('issues'): print('ISSUES',json.dumps(r['issues'][:5])[:2000])
    res=r.get('testResults',[]); ok=sum(1 for x in res if x.get('state')=='SUCCESS')
    print(f"{label}: {ok}/{len(cases)} passed")
    for (n,c),x in zip(cases,res):
        if x.get('state')!='SUCCESS': print('  FAIL',n,c['expectation'],(x.get('debugMessages') or [])[:2],sorted({v.get('sourcePosition',{}).get('line') for v in x.get('visitedExpressions',[])})[:8])
    sys.exit(0 if ok==len(cases) else 1)
run(open(sys.argv[1]).read(),sys.argv[1])
