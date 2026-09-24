import json,subprocess,urllib.request,sys
tok=subprocess.run(['/root/.hermes/profiles/stryker-website-manager/cache/scratch/fn/tok.sh'],capture_output=True,text=True).stdout.strip()
src=open(sys.argv[1]).read()
D='/databases/(default)/documents'
A='alice'; B='bob'; ADM='admin1'
def auth(u): return None if u is None else {'uid':u,'token':{}}
def ex(path,exists=True,data=None):
    return {'function':'exists' if data is None else 'get','args':[{'exactValue':'/databases/(default)/documents'+path}],
            'result':{'value':exists} if data is None else {'value':{'data':data}}}
mocks=[ex('/admins/'+ADM,True),ex('/admins/'+A,False),ex('/admins/'+B,False),
       ex('/moderators/'+A,False),ex('/moderators/'+B,False),ex('/moderators/'+ADM,False),
       {'function':'get','args':[{'exactValue':D+'/conversations/c_ab'}],'result':{'value':{'data':{'participants':[A,B]}}}},
       {'function':'get','args':[{'exactValue':D+'/conversations/c_bx'}],'result':{'value':{'data':{'participants':[B,'x']}}}}]
cases=[]
def c(name,expect,method,path,uid,res=None,old=None):
    req={'auth':auth(uid),'method':method,'path':D+path}
    if res is not None: req['resource']={'data':res}
    t={'expectation':expect,'request':req,'functionMocks':mocks}
    if old is not None: t['resource']={'data':old}
    cases.append((name,t))
n={'recipientUid':B,'type':'like','message':'hi','link':None,'read':False}
# usernames
c('signed-out read username','DENY','get','/usernames/alice',None,old={'uid':A,'username':'alice'})
c('student read username','ALLOW','get','/usernames/alice',B,old={'uid':A,'username':'alice'})
c('student claims free handle for self','ALLOW','create','/usernames/newbie',A,res={'uid':A,'username':'newbie'})
c('student claims handle for someone else','DENY','create','/usernames/newbie',A,res={'uid':B,'username':'newbie'})
c('student overwrites another handle','DENY','update','/usernames/bob',A,res={'uid':A,'username':'bob'},old={'uid':B,'username':'bob'})
c('student deletes another handle','DENY','delete','/usernames/bob',A,old={'uid':B,'username':'bob'})
c('student releases own handle','ALLOW','delete','/usernames/alice',A,old={'uid':A,'username':'alice'})
c('student re-sets own handle (tx set)','ALLOW','update','/usernames/alice',A,res={'uid':A,'username':'alice'},old={'uid':A,'username':'alice'})
c('signed-out create handle','DENY','create','/usernames/x',None,res={'uid':'x','username':'x'})
c('admin deletes any handle','ALLOW','delete','/usernames/bob',ADM,old={'uid':B,'username':'bob'})
c('admin reassigns handle','ALLOW','update','/usernames/bob',ADM,res={'uid':A,'username':'bob'},old={'uid':B,'username':'bob'})
# messages
c('participant posts in own conv','ALLOW','create','/conversations/c_ab/messages/m1',A,res={'senderUid':A,'text':'hi'})
c('non-participant posts into others conv','DENY','create','/conversations/c_bx/messages/m1',A,res={'senderUid':A,'text':'hi'})
c('participant spoofs sender','DENY','create','/conversations/c_ab/messages/m1',A,res={'senderUid':B,'text':'hi'})
c('signed-out posts','DENY','create','/conversations/c_ab/messages/m1',None,res={'senderUid':A,'text':'hi'})
# notifications
c('student notifies other (current client shape)','ALLOW','create','/notifications/n1',A,res=n)
c('student notifies with own senderUid','ALLOW','create','/notifications/n1',A,res=dict(n,senderUid=A))
c('student spoofs senderUid','DENY','create','/notifications/n1',A,res=dict(n,senderUid=B))
c('student sends pre-read / extra fields','DENY','create','/notifications/n1',A,res=dict(n,read=True))
c('student adds unknown field','DENY','create','/notifications/n1',A,res=dict(n,admin=True))
c('huge message','DENY','create','/notifications/n1',A,res=dict(n,message='x'*600))
c('signed-out notification','DENY','create','/notifications/n1',None,res=n)
c('recipient reads own','ALLOW','get','/notifications/n1',B,old=n)
c('other reads','DENY','get','/notifications/n1',A,old=n)
c('admin raises notification','ALLOW','create','/notifications/n1',ADM,res=n)
# settings
for d,e in [('seo','ALLOW'),('commerce','ALLOW'),('site','ALLOW'),('tradingview','DENY')]:
    c('signed-out read settings/'+d,e,'get','/settings/'+d,None,old={'x':1})
c('student write settings/seo','DENY','update','/settings/seo',A,res={'x':2},old={'x':1})
c('admin write settings/seo','ALLOW','update','/settings/seo',ADM,res={'x':2},old={'x':1})
# regression spot checks (unchanged blocks)
c('student reads own student doc','ALLOW','get','/students/alice',A,old={'plan':'Pro'})
c('student reads others student doc','DENY','get','/students/bob',A,old={'plan':'Pro'})
c('student grants self plan','DENY','update','/students/alice',A,res={'plan':'Elite'},old={'plan':'Starter'})
c('student sets own paidThroughMillis','DENY','update','/students/alice',A,res={'plan':'Starter','paidThroughMillis':9e12},old={'plan':'Starter'})
c('student creates own doc with plan','DENY','create','/students/alice',A,res={'plan':'Elite'})
c('student edits own name','ALLOW','update','/students/alice',A,res={'plan':'Starter','name':'Al'},old={'plan':'Starter','name':'A'})
c('student writes own replay sub','ALLOW','update','/students/alice/replay/r1',A,res={'x':2},old={'x':1})
c('student writes own nested sub (sub/doc)','ALLOW','create','/students/alice/progress/ch01',A,res={'x':1})
c('student writes deep sub','ALLOW','create','/students/alice/a/b/c/d',A,res={'x':1})
c('student writes others sub','DENY','create','/students/bob/progress/ch01',A,res={'x':1})
c('admin grants plan','ALLOW','update','/students/alice',ADM,res={'plan':'Elite'},old={'plan':'Starter'})
# signup self-create (2026-09-24)
full={'displayName':'N','email':'n@x.com','plan':'Starter','currentStreak':1,'completedLessons':[]}
c('new user creates own doc with plan Starter','ALLOW','create','/students/alice',A,res=full)
c('new user creates own doc without plan','ALLOW','create','/students/alice',A,res={'theme':'night'})
c('new user creates own doc with plan Elite','DENY','create','/students/alice',A,res=dict(full,plan='Elite'))
c('new user creates Starter + paidThroughMillis','DENY','create','/students/alice',A,res=dict(full,paidThroughMillis=9e12))
c('new user creates Starter + role','DENY','create','/students/alice',A,res=dict(full,role='admin'))
c('new user creates Starter + referralPoints','DENY','create','/students/alice',A,res=dict(full,referralPoints=999))
c('user creates doc for someone else','DENY','create','/students/bob',A,res=full)
c('signed-out creates doc','DENY','create','/students/alice',None,res=full)
c('heal: planless doc -> Starter','ALLOW','update','/students/alice',A,res={'theme':'night','plan':'Starter'},old={'theme':'night'})
c('heal: race overwrite set() -> Starter','ALLOW','update','/students/alice',A,res=full,old={'theme':'night','username':'x'})
c('heal: planless doc -> Elite','DENY','update','/students/alice',A,res={'plan':'Elite'},old={'theme':'night'})
c('heal: Starter + paidThroughMillis','DENY','update','/students/alice',A,res={'plan':'Starter','paidThroughMillis':9e12},old={'theme':'night'})
c('downgrade Elite -> Starter by self','DENY','update','/students/alice',A,res={'plan':'Starter'},old={'plan':'Elite'})
c('Starter -> Starter + subscriptionStatus','DENY','update','/students/alice',A,res={'plan':'Starter','subscriptionStatus':'active'},old={'plan':'Starter'})
c('lapsed member resets lapsedFromPlan','DENY','update','/students/alice',A,res={'plan':'Starter','lapsedFromPlan':None},old={'plan':'Starter','lapsedFromPlan':'Pro'})
c('signed-out read plans','ALLOW','get','/plans/p1',None,old={'price':'19'})
c('student reads foundingPrices','DENY','get','/foundingPrices/alice',A,old={'x':1})
c('student makes self admin','DENY','create','/admins/alice',A,res={'x':1})
# stripe (2026-09-24): billing ids and provider are function-only
c('student sets own stripeCustomerId','DENY','update','/students/alice',A,res={'plan':'Starter','stripeCustomerId':'cus_x'},old={'plan':'Starter'})
c('student sets own stripeSubscriptionId','DENY','update','/students/alice',A,res={'plan':'Pro','stripeSubscriptionId':'sub_x'},old={'plan':'Pro'})
c('student sets billingProvider','DENY','update','/students/alice',A,res={'plan':'Pro','billingProvider':'stripe'},old={'plan':'Pro'})
c('new user creates Starter + stripeCustomerId','DENY','create','/students/alice',A,res=dict(full,stripeCustomerId='cus_x'))
c('heal to Starter + stripeSubscriptionId','DENY','update','/students/alice',A,res={'plan':'Starter','stripeSubscriptionId':'sub_x'},old={'theme':'night'})
c('student edits billing while on stripe','ALLOW','update','/students/alice',A,res={'plan':'Pro','stripeCustomerId':'cus_x','billing':{'fullName':'A'}},old={'plan':'Pro','stripeCustomerId':'cus_x'})
for col in ['stripeCustomers','stripeSessions','stripeSubs','stripeEvents','stripeInvoices','stripePrices','stripeCoupons']:
    c('student reads '+col,'DENY','get','/'+col+'/alice',A,old={'uid':A})
    c('student writes '+col,'DENY','create','/'+col+'/alice',A,res={'uid':A})
c('admin client writes stripeCustomers','DENY','create','/stripeCustomers/alice',ADM,res={'customerId':'cus_x'})
# chapter gate: chapterBodies by plan rank
RANKS={'rankByPlan':{'Starter':0,'Pro':1,'Elite':2}}
def stu(uid,data): return {'function':'get','args':[{'exactValue':D+'/students/'+uid}],'result':{'value':{'data':data}}}
cg=[{'function':'get','args':[{'exactValue':D+'/settings/planAccess'}],'result':{'value':{'data':RANKS}}},
    stu(A,{'plan':'Starter'}), stu(B,{'plan':'Pro'}), stu('carol',{'plan':'Elite'}), stu('dave',{}), stu('erin',{'plan':'Legacy'}),
    ex('/admins/carol',False), ex('/admins/dave',False), ex('/admins/erin',False)]
mocks.extend(cg)
free={'minRank':0,'bodyHtml':'<p>x</p>'}; paid={'minRank':1,'bodyHtml':'<p>x</p>'}
c('signed-out reads free body','DENY','get','/chapterBodies/01',None,old=free)
c('Starter reads free body','ALLOW','get','/chapterBodies/01',A,old=free)
c('Starter reads paid body','DENY','get','/chapterBodies/08',A,old=paid)
c('Pro reads paid body','ALLOW','get','/chapterBodies/08',B,old=paid)
c('Elite reads paid body','ALLOW','get','/chapterBodies/08',"carol",old=paid)
c('Pro reads Elite-only body','DENY','get','/chapterBodies/X',B,old={'minRank':2})
c('planless student reads paid body','DENY','get','/chapterBodies/08','dave',old=paid)
c('planless student reads free body','ALLOW','get','/chapterBodies/01','dave',old=free)
c('unknown plan reads paid body','DENY','get','/chapterBodies/08','erin',old=paid)
c('admin reads paid body','ALLOW','get','/chapterBodies/08',ADM,old=paid)
c('Starter lists all bodies (query not limited to free)','DENY','list','/chapterBodies/08',A,old=paid)
c('Pro writes a body','DENY','update','/chapterBodies/08',B,res=paid,old=paid)
c('admin writes a body','ALLOW','update','/chapterBodies/08',ADM,res=paid,old=paid)
c('Pro writes settings/planAccess','DENY','update','/settings/planAccess',B,res={'rankByPlan':{'Starter':9}},old=RANKS)
c('Starter reads settings/planAccess','ALLOW','get','/settings/planAccess',A,old=RANKS)
c('student sets own plan to Pro','DENY','update','/students/alice',A,res={'plan':'Pro'},old={'plan':'Starter'})
c('member reads catalog','ALLOW','get','/chapters/08',A,old={'num':'08','title':'t'})
body={'source':{'files':[{'name':'firestore.rules','content':src}]},'testSuite':{'testCases':[t for _,t in cases]}}
r=urllib.request.Request('https://firebaserules.googleapis.com/v1/projects/strykertrades-e0cd8:test',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+tok,'Content-Type':'application/json'})
try: out=json.load(urllib.request.urlopen(r))
except urllib.error.HTTPError as e: print(e.code,e.read().decode()[:1500]); sys.exit(1)
if out.get('issues'): print('ISSUES',json.dumps(out['issues'])[:800])
fails=0
for (name,t),res in zip(cases,out['testResults']):
    ok=res['state']=='SUCCESS'; fails+= not ok
    print(('PASS' if ok else 'FAIL'),t['expectation'],name, '' if ok else json.dumps(res.get('debugMessages') or res.get('errorPosition') or res)[:300])
print(f'{len(cases)-fails}/{len(cases)} passed')
