# Rules test: partners/{uid} + partnerLog + students partner/planSource (same harness as screens-rules-test.py).
# Run: FB_TOKEN_FILE=<file with an OAuth token> python3 tools/tests/partners-rules-test.py functions-src/firestore.rules
import json,urllib.request,urllib.error,sys,os
T=open(os.environ['FB_TOKEN_FILE']).read().strip(); P='strykertrades-e0cd8'
D='/databases/(default)/documents'
TS="2026-11-03T00:00:00Z"
def m(fn,path,val): return {"function":fn,"args":[{"exactValue":D+path}],"result":{"value":val}}
cases=[]
def case(exp,name,uid,method,path,new=None,old=None):
    req={"auth":({"uid":uid,"token":{}} if uid else None),"method":method,"path":D+path,"time":TS}
    if new is not None: req["resource"]={"data":new}
    ms=[m("exists",f"/admins/{u}",u=='admin') for u in {uid or 'x','alice','bob','admin'}]
    c={"expectation":exp,"request":req,"functionMocks":ms}
    if old is not None: c["resource"]={"data":old}
    cases.append((name,c))
U1="https://instagram.com/alice"; PL=["https://instagram.com/p/a","https://instagram.com/p/b","https://instagram.com/p/c"]
A={"platform":"instagram","handle":"alice","profileUrl":U1,"followers":1500,"postLinks":PL,"why":"I post about futures.","agreedAt":TS}
PD="/partners/alice"
def act(status,weeks=None,**kw):
    d=dict(A,status=status,approvedAt=TS,proUntil=1,reviewNote="ok"); d.update(kw)
    if weeks is not None: d["weeks"]=weeks
    return d
# create
case("ALLOW","create application","alice","create",PD,new=A)
case("ALLOW","followers 0 (admin decides)","alice","create",PD,new=dict(A,followers=0))
case("DENY","create as other uid","bob","create",PD,new=A)
case("DENY","signed out create",None,"create",PD,new=A)
case("DENY","create with status","alice","create",PD,new=dict(A,status="active"))
case("DENY","create with proUntil","alice","create",PD,new=dict(A,proUntil=9999999999999))
case("DENY","create with reviewNote","alice","create",PD,new=dict(A,reviewNote="approved"))
case("DENY","create with approvedAt","alice","create",PD,new=dict(A,approvedAt=TS))
case("DENY","missing why","alice","create",PD,new={k:v for k,v in A.items() if k!='why'})
case("DENY","missing agreedAt","alice","create",PD,new={k:v for k,v in A.items() if k!='agreedAt'})
case("DENY","client agreedAt time","alice","create",PD,new=dict(A,agreedAt="2020-01-01T00:00:00Z"))
case("DENY","bad platform","alice","create",PD,new=dict(A,platform="facebook"))
case("DENY","http profile link","alice","create",PD,new=dict(A,profileUrl="http://instagram.com/alice"))
case("DENY","javascript link","alice","create",PD,new=dict(A,postLinks=["javascript:alert(1)",PL[1],PL[2]]))
case("DENY","2 post links","alice","create",PD,new=dict(A,postLinks=PL[:2]))
case("DENY","4 post links","alice","create",PD,new=dict(A,postLinks=PL+[PL[0]]))
case("DENY","followers string","alice","create",PD,new=dict(A,followers="1500"))
case("DENY","followers negative","alice","create",PD,new=dict(A,followers=-1))
case("DENY","why 601","alice","create",PD,new=dict(A,why="w"*601))
case("DENY","handle empty","alice","create",PD,new=dict(A,handle=""))
case("DENY","link with space","alice","create",PD,new=dict(A,profileUrl="https://a.com/x y"))
# read
case("ALLOW","read own","alice","get",PD,old=A)
case("DENY","B reads A","bob","get",PD,old=A)
case("DENY","signed-out read",None,"get",PD,old=A)
case("ALLOW","admin reads","admin","get",PD,old=A)
case("ALLOW","admin lists","admin","list","/partners/x",old=A)
# update: own status/pro fields
case("DENY","member sets status","alice","update",PD,new=dict(act("pending"),status="active"),old=dict(A,status="pending"))
case("DENY","member self-approves","alice","update",PD,new=act("active"),old=dict(A,status="pending"))
case("DENY","member extends proUntil","alice","update",PD,new=act("active",proUntil=9999999999999),old=act("active"))
case("DENY","member edits reviewNote","alice","update",PD,new=act("active",reviewNote="great"),old=act("active"))
case("DENY","member edits followers","alice","update",PD,new=act("active",followers=99999),old=act("active"))
case("DENY","member update application","alice","update",PD,new=act("active"),old=act("active"))
case("DENY","admin browser writes status","admin","update",PD,new=act("active"),old=dict(A,status="pending"))
case("DENY","admin browser creates","admin","create","/partners/bob",new=A)
# weeks subcollection: partners/{uid}/weeks/{wk}
W="2026-W45"; WP="/partners/alice/weeks/"+W
L=["https://x.com/a/status/1","https://x.com/a/status/2"]
def wk(links): return {"links":links,"updatedAt":TS}
def pst(st): return m("get","/partners/alice",{"data":{"status":st}})
def wcase(exp,name,uid,method,new=None,old=None,st="active",path=WP):
    case(exp,name,uid,method,path,new=new,old=old)
    cases[-1][1]["functionMocks"].append(pst(st))
wcase("ALLOW","append first week","alice","create",new=wk(L[:1]))
wcase("ALLOW","append to week","alice","update",new=wk(L),old=wk(L[:1]))
wcase("ALLOW","append while paused","alice","create",new=wk(L[:1]),st="paused")
wcase("ALLOW","exactly 10 in a week","alice","create",new=wk(["https://x.com/p/%d"%i for i in range(10)]))
wcase("DENY","11 in a week","alice","create",new=wk(["https://x.com/p/%d"%i for i in range(11)]))
wcase("DENY","empty list","alice","create",new=wk([]))
wcase("DENY","http link","alice","create",new=wk(["http://x.com/a"]))
wcase("DENY","javascript link","alice","create",new=wk(["javascript:alert(1)"]))
wcase("DENY","week W00","alice","create",new=wk(L[:1]),path="/partners/alice/weeks/2026-W00")
wcase("DENY","week W54","alice","create",new=wk(L[:1]),path="/partners/alice/weeks/2026-W54")
wcase("DENY","bad week key","alice","create",new=wk(L[:1]),path="/partners/alice/weeks/next-week")
wcase("DENY","remove a link","alice","update",new=wk(L[:1]),old=wk(L))
wcase("DENY","replace a link","alice","update",new=wk([L[0],"https://x.com/other"]),old=wk(L))
wcase("DENY","extra key","alice","create",new=dict(wk(L[:1]),status="active"))
wcase("DENY","client updatedAt","alice","create",new=dict(wk(L[:1]),updatedAt="2020-01-01T00:00:00Z"))
wcase("DENY","append while pending","alice","create",new=wk(L[:1]),st="pending")
wcase("DENY","append while rejected","alice","create",new=wk(L[:1]),st="rejected")
wcase("DENY","B appends to A","bob","create",new=wk(L[:1]))
wcase("DENY","delete a week","alice","delete",old=wk(L))
wcase("ALLOW","read own week","alice","get",old=wk(L))
wcase("DENY","B reads A week","bob","get",old=wk(L))
wcase("ALLOW","admin reads week","admin","get",old=wk(L))
wcase("DENY","admin browser writes week","admin","create",new=wk(L[:1]))
# delete / re-apply
case("ALLOW","delete rejected after wait","alice","delete",PD,old=act("rejected",reapplyAfterMillis=1))
case("DENY","delete rejected too early","alice","delete",PD,old=act("rejected",reapplyAfterMillis=9999999999999))
case("DENY","delete active","alice","delete",PD,old=act("active"))
case("DENY","delete pending","alice","delete",PD,old=dict(A,status="pending"))
case("DENY","B deletes A","bob","delete",PD,old=act("left",reapplyAfterMillis=1))
# partnerLog
case("ALLOW","admin reads log","admin","get","/partnerLog/x",old={"uid":"alice"})
case("DENY","member reads log","alice","get","/partnerLog/x",old={"uid":"alice"})
case("DENY","admin writes log","admin","create","/partnerLog/x",new={"uid":"alice"})
case("DENY","member writes log","alice","create","/partnerLog/x",new={"uid":"alice"})
# students doc: partner flag is server-only
S="/students/alice"
case("DENY","member sets partner:true","alice","update",S,new={"displayName":"A","partner":True},old={"displayName":"A","plan":"Starter"})
case("DENY","member sets planSource","alice","update",S,new={"displayName":"A","planSource":"partner"},old={"displayName":"A","plan":"Starter"})
case("DENY","member sets plan Pro","alice","update",S,new={"displayName":"A","plan":"Pro"},old={"displayName":"A","plan":"Starter"})
case("DENY","member creates with partner","alice","create",S,new={"plan":"Starter","partner":True})
case("ALLOW","member still edits name","alice","update",S,new={"displayName":"B","plan":"Starter"},old={"displayName":"A","plan":"Starter"})

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
