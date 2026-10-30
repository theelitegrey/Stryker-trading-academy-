# Firestore rules suite for rithmicCreds + rithmicCredAudit (functions-only). Uses the Rules :test API only (no data touched).
# FB_TOKEN_FILE=<oauth token file> python3 rithmic-creds-rules-test.py <rules file>
import json,urllib.request,urllib.error,sys,os
T=open(os.environ['FB_TOKEN_FILE']).read().strip(); P='strykertrades-e0cd8'
D='/databases/(default)/documents'; TS="2026-10-30T00:00:00Z"
cases=[]
def case(exp,name,uid,method,path,new=None,old=None):
    req={"auth":({"uid":uid,"token":{}} if uid else None),"method":method,"path":D+path,"time":TS}
    if new is not None: req["resource"]={"data":new}
    ms=[{"function":"exists","args":[{"exactValue":D+f"/admins/{u}"}],"result":{"value":u=='admin'}} for u in {uid or 'x','alice','bob','admin'}]
    c={"expectation":exp,"request":req,"functionMocks":ms}
    if old is not None: c["resource"]={"data":old}
    cases.append((name,c))
ROW={"system":"Apex","username":"u","encPassword":"x","iv":"y","tag":"z","keyVersion":1}
for who in ['alice','bob','admin',None]:
    for m in ['get','list']: case("DENY",f"{who} {m} rithmicCreds/alice",who,m,"/rithmicCreds/alice",old=ROW)
    for m in ['create','update','delete']: case("DENY",f"{who} {m} rithmicCreds/alice",who,m,"/rithmicCreds/alice",new=ROW,old=ROW)
    for m in ['get','create','delete']: case("DENY",f"{who} {m} rithmicCredAudit/x",who,m,"/rithmicCredAudit/x",new={"uid":"alice","action":"save"},old={"uid":"alice"})
# regression: a member can still use their own journal
case("ALLOW","alice writes own journal trade","alice","create","/students/alice/journal/rithabc",new={"date":"2026-10-30"})
def run(src,label):
    body={"source":{"files":[{"name":"firestore.rules","content":src}]},"testSuite":{"testCases":[c for _,c in cases]}}
    rq=urllib.request.Request(f"https://firebaserules.googleapis.com/v1/projects/{P}:test",json.dumps(body).encode(),{"Authorization":"Bearer "+T,"Content-Type":"application/json"})
    try: r=json.load(urllib.request.urlopen(rq))
    except urllib.error.HTTPError as e: print(e.read().decode()[:3000]); sys.exit(1)
    if r.get('issues'): print('ISSUES',json.dumps(r['issues'][:5])[:2000])
    res=r.get('testResults',[]); ok=sum(1 for x in res if x.get('state')=='SUCCESS')
    print(f"{label}: {ok}/{len(cases)} passed")
    bad=[n for (n,c),x in zip(cases,res) if x.get('state')!='SUCCESS']
    for n in bad: print('  FAIL',n)
    sys.exit(1 if bad or ok!=len(cases) else 0)
run(open(sys.argv[1]).read(),sys.argv[1])
