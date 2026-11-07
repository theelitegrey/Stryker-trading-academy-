"""Rules tests: students/{uid}/dpAlerts (dark pool print alerts). Firestore Rules :test API (nothing written or published).
Runs on GitHub (zs-rules-test.yml): FB_TOKEN_FILE=/tmp/fbtok python3 tools/tests/dp-alerts-rules-test.py functions-src/firestore.rules"""
import json, urllib.request, urllib.error, sys, os
T = open(os.environ['FB_TOKEN_FILE']).read().strip(); P = 'strykertrades-e0cd8'
D = '/databases/(default)/documents'
TS = "2026-11-07T12:00:00Z"
cases = []


def m(fn, path, val): return {"function": fn, "args": [{"exactValue": D + path}], "result": {"value": val}}


def case(exp, name, uid, method, path, new=None, old=None):
    req = {"auth": ({"uid": uid, "token": {}} if uid else None), "method": method, "path": D + path, "time": TS}
    if new is not None: req["resource"] = {"data": new}
    ms = [m("exists", f"/admins/{u}", u == 'admin') for u in {uid or 'x', 'alice', 'bob', 'admin'}]
    c = {"expectation": exp, "request": req, "functionMocks": ms}
    if old is not None: c["resource"] = {"data": old}
    cases.append((name, c))


L = "/students/alice/dpAlerts/abcdefghijKLMNOPqrst"
A = {"symbol": "TSLA", "min": 10000000, "freq": "every", "active": True, "createdAt": TS, "updatedAt": TS}
Z = dict(A, lo=400, hi=412.5)
wo = lambda d, k: {x: v for x, v in d.items() if x != k}
case("ALLOW", "create", 'alice', "create", L, new=A)
case("ALLOW", "create with zone", 'alice', "create", L, new=Z)
case("ALLOW", "create once, $1M, SPY", 'alice', "create", L, new=dict(A, symbol="SPY", min=1000000, freq="once"))
case("ALLOW", "custom size float", 'alice', "create", L, new=dict(A, min=7500000.5))
case("ALLOW", "pause (update)", 'alice', "update", L, new=dict(A, active=False), old=A)
case("ALLOW", "get own", 'alice', "get", L, old=A)
case("ALLOW", "list own", 'alice', "list", "/students/alice/dpAlerts/x", old=A)
case("ALLOW", "delete own", 'alice', "delete", L, old=A)
case("DENY", "symbol not covered", 'alice', "create", L, new=dict(A, symbol="ES"))
case("DENY", "symbol lowercase", 'alice', "create", L, new=dict(A, symbol="tsla"))
case("DENY", "min under $1M", 'alice', "create", L, new=dict(A, min=999999))
case("DENY", "min as string", 'alice', "create", L, new=dict(A, min="10000000"))
case("DENY", "lo without hi", 'alice', "create", L, new=dict(A, lo=400))
case("DENY", "lo > hi", 'alice', "create", L, new=dict(A, lo=420, hi=400))
case("DENY", "lo 0", 'alice', "create", L, new=dict(A, lo=0, hi=400))
case("DENY", "bad freq", 'alice', "create", L, new=dict(A, freq="always"))
case("DENY", "active not bool", 'alice', "create", L, new=dict(A, active="yes"))
case("DENY", "client updatedAt", 'alice', "create", L, new=dict(A, updatedAt="2020-01-01T00:00:00Z"))
case("DENY", "extra key", 'alice', "create", L, new=dict(A, plan="Elite"))
case("DENY", "missing min", 'alice', "create", L, new=wo(A, "min"))
case("DENY", "id 41 chars", 'alice', "create", "/students/alice/dpAlerts/" + "a" * 41, new=A)
case("DENY", "update changes createdAt", 'alice', "update", L, new=dict(A, createdAt="2026-11-08T00:00:00Z"), old=A)
case("DENY", "B reads A", 'bob', "get", L, old=A)
case("DENY", "B lists A", 'bob', "list", "/students/alice/dpAlerts/x", old=A)
case("DENY", "B writes A", 'bob', "create", L, new=A)
case("DENY", "B deletes A", 'bob', "delete", L, old=A)
case("DENY", "signed-out get", None, "get", L, old=A)
case("DENY", "signed-out create", None, "create", L, new=A)
case("DENY", "wildcard junk shape", 'alice', "create", L, new={"anything": "x"})
case("ALLOW", "zoroAlerts untouched", 'alice', "create", "/students/alice/zoroAlerts/z1",
     new={"type": "zone_change", "symbol": "SPX", "p": {}, "freq": "once", "active": True, "updatedAt": TS})


def run(src, label):
    body = {"source": {"files": [{"name": "firestore.rules", "content": src}]}, "testSuite": {"testCases": [c for _, c in cases]}}
    rq = urllib.request.Request(f"https://firebaserules.googleapis.com/v1/projects/{P}:test", json.dumps(body).encode(),
                                {"Authorization": "Bearer " + T, "Content-Type": "application/json"})
    try: r = json.load(urllib.request.urlopen(rq))
    except urllib.error.HTTPError as e: print(e.read().decode()[:3000]); sys.exit(1)
    if r.get('issues'): print('ISSUES', json.dumps(r['issues'][:5])[:2000])
    res = r.get('testResults', []); ok = sum(1 for x in res if x.get('state') == 'SUCCESS')
    print(f"{label}: {ok}/{len(cases)} passed")
    for (n, c), x in zip(cases, res):
        if x.get('state') != 'SUCCESS': print('  FAIL', n, c['expectation'], (x.get('debugMessages') or [])[:2])
    sys.exit(0 if ok == len(cases) else 1)


run(open(sys.argv[1]).read(), sys.argv[1])
