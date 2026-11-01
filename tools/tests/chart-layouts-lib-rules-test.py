# Rules test for the Layouts LIBRARY (publicLayouts, likes/uses/reports, layoutFavs, thumb fields on chartLayouts).
#   FB_TOKEN_FILE=<file with a Firebase access token> python3 tools/tests/chart-layouts-lib-rules-test.py functions-src/firestore.rules
# Same method as chart-layouts-rules-test.py: Firebase Rules REST test with function mocks (no writes to live data).
import json,urllib.request,urllib.error,sys,os
T=open(os.environ['FB_TOKEN_FILE']).read().strip(); P='strykertrades-e0cd8'
D='/databases/(default)/documents'
TS="2026-11-01T00:00:00Z"
ID='abcdefghijKLMNOPqrst'
def doc(d): return {"data":d}
def m(fn,path,val): return {"function":fn,"args":[{"exactValue":D+path}],"result":{"value":val}}
cases=[]
def case(exp,name,uid,method,path,new=None,old=None,mocks=None,admin=False):
    req={"auth":({"uid":uid,"token":{}} if uid else None),"method":method,"path":D+path,"time":TS}
    if new is not None: req["resource"]={"data":new}
    ms=[m("exists",f"/admins/{u}",(u=='admin')) for u in {uid or 'x','alice','bob','carol','admin'}]
    ms+=(mocks or [])
    c={"expectation":exp,"request":req,"functionMocks":ms}
    if old is not None: c["resource"]={"data":old}
    cases.append((name,c))
PL=f"/publicLayouts/{ID}"
THUMB="data:image/webp;base64,AAAA"
CARD={"kind":"chart","ownerUid":"alice","authorName":"Alice","name":"Order flow","desc":"d","tags":["gex"],"visibility":"public","communityId":"","symbol":"futures:NQ1!","interval":"15","thumb":THUMB,"panes":2,"indicators":3,"likeCount":0,"useCount":0,"reportCount":0,"createdAt":TS,"updatedAt":TS,"hidden":False}
prof=[m("exists","/profiles/alice",True),m("get","/profiles/alice",doc({"displayName":"Alice"}))]
own=[m("exists",f"/students/alice/chartLayouts/{ID}",True)]
noown=[m("exists",f"/students/alice/chartLayouts/{ID}",False)]
# --- create
case("ALLOW","A publish public","alice","create",PL,new=CARD,mocks=prof+own)
case("DENY","A publish without own layout","alice","create",PL,new=CARD,mocks=prof+noown)
case("DENY","B create as alice","bob","create",PL,new=CARD,mocks=prof+own)
case("DENY","author name not the profile name","alice","create",PL,new=dict(CARD,authorName="Someone Else"),mocks=prof+own)
case("DENY","author name is an email","alice","create",PL,new=dict(CARD,authorName="a@b.c"),mocks=[m("exists","/profiles/alice",True),m("get","/profiles/alice",doc({"displayName":"a@b.c"}))]+own)
case("DENY","seeded likes","alice","create",PL,new=dict(CARD,likeCount=50),mocks=prof+own)
case("DENY","seeded uses","alice","create",PL,new=dict(CARD,useCount=9),mocks=prof+own)
case("DENY","created hidden true","alice","create",PL,new=dict(CARD,hidden=True),mocks=prof+own)
case("DENY","name 61","alice","create",PL,new=dict(CARD,name="n"*61),mocks=prof+own)
case("DENY","desc 141","alice","create",PL,new=dict(CARD,desc="d"*141),mocks=prof+own)
case("DENY","6 tags","alice","create",PL,new=dict(CARD,tags=list("abcdef")),mocks=prof+own)
case("DENY","tag with capitals","alice","create",PL,new=dict(CARD,tags=["Gex"]),mocks=prof+own)
case("DENY","tag 21 chars","alice","create",PL,new=dict(CARD,tags=["a"*21]),mocks=prof+own)
case("DENY","thumb not webp","alice","create",PL,new=dict(CARD,thumb="data:image/png;base64,AAAA"),mocks=prof+own)
case("DENY","thumb over 60000","alice","create",PL,new=dict(CARD,thumb="data:image/webp;base64,"+"A"*60000),mocks=prof+own)
case("DENY","visibility link not in publicLayouts","alice","create",PL,new=dict(CARD,visibility="link"),mocks=prof+own)
case("DENY","extra key","alice","create",PL,new=dict(CARD,email="a@b.c"),mocks=prof+own)
case("DENY","signed out create",None,"create",PL,new=CARD,mocks=prof+own)
# kind (setup vs whole chart)
SETUP=dict(CARD,kind="setup",symbol="",interval="")
case("ALLOW","A publish a setup (no symbol/interval)","alice","create",PL,new=SETUP,mocks=prof+own)
case("DENY","kind missing on create","alice","create",PL,new={k:v for k,v in CARD.items() if k!="kind"},mocks=prof+own)
case("DENY","kind junk","alice","create",PL,new=dict(CARD,kind="idea"),mocks=prof+own)
case("DENY","setup with a symbol","alice","create",PL,new=dict(SETUP,symbol="futures:NQ1!"),mocks=prof+own)
case("DENY","setup with an interval","alice","create",PL,new=dict(SETUP,interval="15"),mocks=prof+own)
case("ALLOW","owner switches chart -> setup","alice","update",PL,new=dict(SETUP,updatedAt=TS),old=CARD,mocks=prof)
case("ALLOW","owner switches setup -> chart","alice","update",PL,new=dict(CARD,updatedAt=TS),old=SETUP,mocks=prof)
case("DENY","B changes A's kind","bob","update",PL,new=dict(SETUP,updatedAt=TS),old=CARD,mocks=prof)
case("DENY","owner update drops kind","alice","update",PL,new={k:v for k,v in CARD.items() if k!="kind"},old=CARD,mocks=prof)
case("ALLOW","B likes an old card without kind","bob","update",PL,new=dict({k:v for k,v in CARD.items() if k!="kind"},likeCount=1),old={k:v for k,v in CARD.items() if k!="kind"},mocks=[m("exists",f"{PL}/likes/bob",False),m("existsAfter",f"{PL}/likes/bob",True)])
# community
CM=dict(CARD,visibility="community",communityId="zoro")
cmo=[m("get","/communities/zoro",doc({"ownerUid":"alice","status":"active"}))]
cmx=[m("get","/communities/zoro",doc({"ownerUid":"zed","status":"active"}))]
case("ALLOW","A publish to MY community","alice","create",PL,new=CM,mocks=prof+own+cmo)
case("DENY","A publish to someone else's community","alice","create",PL,new=CM,mocks=prof+own+cmx)
case("DENY","public with a communityId","alice","create",PL,new=dict(CARD,communityId="zoro"),mocks=prof+own)
# --- read
case("ALLOW","B get public card","bob","get",PL,old=CARD)
case("ALLOW","B list public","bob","list","/publicLayouts/x",old=CARD)
case("DENY","signed-out get public",None,"get",PL,old=CARD)
case("DENY","B get hidden card","bob","get",PL,old=dict(CARD,hidden=True))
case("ALLOW","admin get hidden card","admin","get",PL,old=dict(CARD,hidden=True))
case("ALLOW","owner get own hidden card","alice","get",PL,old=dict(CARD,hidden=True))
case("ALLOW","B get community card (teaser)","bob","get",PL,old=CM)
# state doc
SP=f"{PL}/data/s"; ST={"state":'{"version":1}',"updatedAt":TS}
cpub=[m("get",PL,doc(CARD))]; ccm=[m("get",PL,doc(CM))]
mem=lambda u,status: [m("exists",f"/communities/zoro/members/{u}",True),m("get",f"/communities/zoro/members/{u}",doc({"status":status,"expiresAt":None})),m("get","/communities/zoro",doc({"ownerUid":"alice","status":"active"}))]
nomem=[m("exists","/communities/zoro/members/bob",False),m("get","/communities/zoro",doc({"ownerUid":"alice","status":"active"}))]
case("ALLOW","B read public state","bob","get",SP,old=ST,mocks=cpub)
case("DENY","B read hidden public state","bob","get",SP,old=ST,mocks=[m("get",PL,doc(dict(CARD,hidden=True)))])
case("ALLOW","active community member reads state","bob","get",SP,old=ST,mocks=ccm+mem("bob","active"))
case("DENY","NON-member reads community state","bob","get",SP,old=ST,mocks=ccm+nomem)
case("DENY","banned member reads community state","bob","get",SP,old=ST,mocks=ccm+mem("bob","banned"))
case("ALLOW","community owner reads state","alice","get",SP,old=ST,mocks=ccm+[m("exists","/communities/zoro/members/alice",False),m("get","/communities/zoro",doc({"ownerUid":"alice","status":"active"}))])
case("DENY","list state docs","bob","list",f"{PL}/data/x",old=ST,mocks=cpub)
case("ALLOW","A write state with the card","alice","create",SP,new=ST,mocks=[m("getAfter",PL,doc(CARD))])
case("DENY","B write state of A's card","bob","update",SP,new=ST,old=ST,mocks=[m("getAfter",PL,doc(CARD))])
case("DENY","state 200001","alice","create",SP,new=dict(ST,state="x"*200001),mocks=[m("getAfter",PL,doc(CARD))])
DRW={"state":'{"version":1,"charts":[{"id":"A","drawings":{"version":1,"drawings":[]}}]}',"updatedAt":TS}
case("ALLOW","setup state without drawings","alice","create",SP,new={"state":'{"version":1,"setup":true,"charts":[{"id":"A","indicators":{}}]}',"updatedAt":TS},mocks=[m("getAfter",PL,doc(SETUP))])
case("DENY","setup state WITH drawings","alice","create",SP,new=DRW,mocks=[m("getAfter",PL,doc(SETUP))])
case("DENY","setup state WITH drawings after a newline","alice","create",SP,new={"state":'{\n"version":1,"charts":[{"id":"A","drawings":{}}]}',"updatedAt":TS},mocks=[m("getAfter",PL,doc(SETUP))])
case("ALLOW","whole-chart state with drawings","alice","create",SP,new=DRW,mocks=[m("getAfter",PL,doc(CARD))])
case("ALLOW","old card (no kind) state update with drawings","alice","update",SP,new=DRW,old=ST,mocks=[m("getAfter",PL,doc({k:v for k,v in CARD.items() if k!="kind"}))])
case("ALLOW","setup state: a Pine source that mentions drawings is not a drawing","alice","create",SP,new={"state":json.dumps({"setup":True,"charts":[{"ext":{"stryker.pine":[{"source":'// "drawings": none'}]}}]}),"updatedAt":TS},mocks=[m("getAfter",PL,doc(SETUP))])
# --- edit / delete
case("ALLOW","A edit own card","alice","update",PL,new=dict(CARD,name="New",updatedAt=TS),old=CARD,mocks=prof)
case("DENY","B edit A's card","bob","update",PL,new=dict(CARD,name="New"),old=CARD,mocks=prof)
case("DENY","A sets own hidden false->true","alice","update",PL,new=dict(CARD,hidden=True),old=CARD,mocks=prof)
case("ALLOW","admin hides","admin","update",PL,new=dict(CARD,hidden=True),old=CARD)
case("DENY","B hides","bob","update",PL,new=dict(CARD,hidden=True),old=CARD)
case("DENY","A raises own likes","alice","update",PL,new=dict(CARD,likeCount=99),old=CARD,mocks=prof)
case("ALLOW","A delete own","alice","delete",PL,old=CARD)
case("DENY","B delete A's","bob","delete",PL,old=CARD)
case("ALLOW","admin delete","admin","delete",PL,old=CARD)
# --- counters
LK=f"{PL}/likes/bob"
case("ALLOW","B like +1 with marker","bob","update",PL,new=dict(CARD,likeCount=1),old=CARD,mocks=[m("exists",LK,False),m("existsAfter",LK,True)])
case("DENY","B like +1 without marker","bob","update",PL,new=dict(CARD,likeCount=1),old=CARD,mocks=[m("exists",LK,False),m("existsAfter",LK,False)])
case("DENY","B like +2","bob","update",PL,new=dict(CARD,likeCount=2),old=CARD,mocks=[m("exists",LK,False),m("existsAfter",LK,True)])
case("DENY","B like twice (marker exists)","bob","update",PL,new=dict(CARD,likeCount=1),old=CARD,mocks=[m("exists",LK,True),m("existsAfter",LK,True)])
case("ALLOW","B unlike -1 with marker deleted","bob","update",PL,new=dict(CARD,likeCount=0),old=dict(CARD,likeCount=1),mocks=[m("exists",LK,True),m("existsAfter",LK,False)])
case("DENY","B unlike without being a liker","bob","update",PL,new=dict(CARD,likeCount=0),old=dict(CARD,likeCount=1),mocks=[m("exists",LK,False),m("existsAfter",LK,False)])
GA=m("getAfter",PL,doc(dict(CARD,likeCount=1)))
GA0=m("getAfter",PL,doc(CARD))
case("ALLOW","create own like marker (+1 in batch)","bob","create",LK,new={"at":TS},mocks=cpub+[GA])
case("DENY","create like marker without counter","bob","create",LK,new={"at":TS},mocks=cpub+[GA0])
case("DENY","create like marker for someone else","bob","create",f"{PL}/likes/carol",new={"at":TS},mocks=cpub)
case("ALLOW","delete own like marker (-1 in batch)","bob","delete",LK,old={"at":TS},mocks=cpub[:0]+[m("get",PL,doc(dict(CARD,likeCount=1))),m("getAfter",PL,doc(CARD)),m("existsAfter",PL,True)])
case("DENY","delete like marker without counter","bob","delete",LK,old={"at":TS},mocks=[m("get",PL,doc(dict(CARD,likeCount=1))),m("getAfter",PL,doc(dict(CARD,likeCount=1))),m("existsAfter",PL,True)])
case("DENY","list likes","bob","list",f"{PL}/likes/x",old={"at":TS})
US=f"{PL}/uses/bob"
case("ALLOW","B use +1 with marker","bob","update",PL,new=dict(CARD,useCount=1),old=CARD,mocks=[m("exists",US,False),m("existsAfter",US,True)])
case("DENY","B use +1 twice (marker exists)","bob","update",PL,new=dict(CARD,useCount=2),old=dict(CARD,useCount=1),mocks=[m("exists",US,True),m("existsAfter",US,True)])
case("DENY","B use +5","bob","update",PL,new=dict(CARD,useCount=5),old=CARD,mocks=[m("exists",US,False),m("existsAfter",US,True)])
case("DENY","B use -1","bob","update",PL,new=dict(CARD,useCount=0),old=dict(CARD,useCount=1),mocks=[m("exists",US,True),m("existsAfter",US,False)])
case("DENY","owner counts own use","alice","update",PL,new=dict(CARD,useCount=1),old=CARD,mocks=[m("exists",f"{PL}/uses/alice",False),m("existsAfter",f"{PL}/uses/alice",True)])
case("DENY","delete a use marker","bob","delete",US,old={"at":TS})
case("ALLOW","create use marker (public)","bob","create",US,new={"at":TS},mocks=cpub)
case("DENY","create use marker, community non-member","bob","create",US,new={"at":TS},mocks=ccm+nomem)
case("ALLOW","create use marker, community member","bob","create",US,new={"at":TS},mocks=ccm+mem("bob","active"))
# --- reports
RP=f"{PL}/reports/bob"
case("ALLOW","B report","bob","create",RP,new={"reason":"spam","at":TS},mocks=cpub)
case("DENY","report with unknown reason","bob","create",RP,new={"reason":"x","at":TS},mocks=cpub)
case("DENY","B reads reports","bob","get",RP,old={"reason":"spam","at":TS})
case("ALLOW","admin reads reports","admin","get",RP,old={"reason":"spam","at":TS})
case("ALLOW","B reportCount +1 with marker","bob","update",PL,new=dict(CARD,reportCount=1),old=CARD,mocks=[m("exists",RP,False),m("existsAfter",RP,True)])
case("DENY","B reportCount +1 no marker","bob","update",PL,new=dict(CARD,reportCount=1),old=CARD,mocks=[m("exists",RP,False),m("existsAfter",RP,False)])
# --- favourites
FV=f"/students/alice/layoutFavs/{ID}"
case("ALLOW","A star","alice","create",FV,new={"at":TS})
case("ALLOW","A unstar","alice","delete",FV,old={"at":TS})
case("ALLOW","A list stars","alice","list","/students/alice/layoutFavs/x",old={"at":TS})
case("DENY","B reads A's stars","bob","get",FV,old={"at":TS})
case("DENY","B writes A's stars","bob","create",FV,new={"at":TS})
case("DENY","star with extra field","alice","create",FV,new={"at":TS,"x":1})
# --- chartLayouts new fields
LY=f"/students/alice/chartLayouts/{ID}"
G={"name":"My NQ","state":'{"version":1}',"shared":False,"updatedAt":TS}
case("ALLOW","layout with thumb/panes/indicators/vis","alice","create",LY,new=dict(G,thumb=THUMB,panes=2,indicators=3,vis="private",desc="d",tags=["a"],cid=""))
case("DENY","layout thumb 60001","alice","create",LY,new=dict(G,thumb="data:image/webp;base64,"+"A"*60000))
case("DENY","layout thumb not webp","alice","create",LY,new=dict(G,thumb="http://x"))
case("DENY","layout vis junk","alice","create",LY,new=dict(G,vis="everyone"))
case("DENY","layout panes 17","alice","create",LY,new=dict(G,panes=17))
case("DENY","B reads A's private layout","bob","get",LY,old=G)

def run(src,label):
    body={"source":{"files":[{"name":"firestore.rules","content":src}]},"testSuite":{"testCases":[c for _,c in cases]}}
    rq=urllib.request.Request(f"https://firebaserules.googleapis.com/v1/projects/{P}:test",json.dumps(body).encode(),{"Authorization":"Bearer "+T,"Content-Type":"application/json"})
    try: r=json.load(urllib.request.urlopen(rq))
    except urllib.error.HTTPError as e: print(e.read().decode()[:3000]); sys.exit(1)
    if r.get('issues'): print('ISSUES',json.dumps(r['issues'][:5])[:2000])
    res=r.get('testResults',[]); ok=sum(1 for x in res if x.get('state')=='SUCCESS')
    print(f"{label}: {ok}/{len(cases)} passed")
    for (n,c),x in zip(cases,res):
        if x.get('state')!='SUCCESS': print('  FAIL',n,c['expectation'],(x.get('debugMessages') or [])[:2])
    if ok!=len(cases): sys.exit(1)
run(open(sys.argv[1]).read(),sys.argv[1])
