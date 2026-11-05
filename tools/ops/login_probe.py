import json,os,re,subprocess,urllib.request,urllib.error,time
em,pw=(os.environ.get('OPS_ARG','')+'\n').split('\n')[:2]
key=sorted(set(re.findall(r'AIza[0-9A-Za-z_-]{35}',subprocess.run("git grep -h -o -E 'AIza[0-9A-Za-z_-]{35}' -- 'assets/*.js'",shell=True,capture_output=True,text=True).stdout)))[0]
def post(u,b,h={}):
    h=dict({'Content-Type':'application/json','Referer':'https://tradezoro.com/'},**h)
    t=time.time()
    try: r=urllib.request.urlopen(urllib.request.Request(u,json.dumps(b).encode(),h),timeout=20); return r.status,json.loads(r.read()),round(time.time()-t,2)
    except urllib.error.HTTPError as e: return e.code,json.loads(e.read() or b'{}'),round(time.time()-t,2)
c,d,s=post('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+key,{'email':em.strip(),'password':pw.strip(),'returnSecureToken':True})
print('password sign-in:',c,s,'s',d.get('error',{}).get('message','OK'))
if c==200:
    import urllib.parse
    r=urllib.request.urlopen(urllib.request.Request('https://securetoken.googleapis.com/v1/token?key='+key,urllib.parse.urlencode({'grant_type':'refresh_token','refresh_token':d['refreshToken']}).encode(),{'Referer':'https://tradezoro.com/'}),timeout=20)
    print('token refresh:',r.status)
    tok=d['idToken']
    q=urllib.request.Request('https://firestore.googleapis.com/v1/projects/strykertrades-e0cd8/databases/(default)/documents/users/'+d['localId'],headers={'Authorization':'Bearer '+tok})
    try: print('profile read:',urllib.request.urlopen(q,timeout=20).status)
    except urllib.error.HTTPError as e: print('profile read:',e.code)
for p in ['','login','__/auth/handler','__/firebase/init.json']:
    try: r=urllib.request.urlopen('https://tradezoro.com/'+p,timeout=20); print('/'+p,r.status)
    except urllib.error.HTTPError as e: print('/'+p,e.code)
