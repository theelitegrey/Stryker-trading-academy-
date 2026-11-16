"""Rules tests: students/{uid}/brokerAccounts/{accountId} (Trade menu pencil: label, prop firm, account type). Owner only.
Firestore Rules :test API (nothing written or published). Runs where Google accepts the token (GitHub):
  FB_TOKEN_FILE=/tmp/fbtok python3 tools/tests/broker-accounts-rules-test.py functions-src/firestore.rules"""
import json, urllib.request, urllib.error, sys, os
T = open(os.environ['FB_TOKEN_FILE']).read().strip(); P = 'strykertrades-e0cd8'
D = '/databases/(default)/documents'
TS = "2026-11-16T12:00:00Z"
cases = []


def m(fn, path, val): return {"function": fn, "args": [{"exactValue": D + path}], "result": {"value": val}}


def case(exp, name, uid, method, path, new=None, old=None):
    req = {"auth": ({"uid": uid, "token": {}} if uid else None), "method": method, "path": D + path, "time": TS}
    if new is not None: req["resource"] = {"data": new}
    ms = [m("exists", f"/admins/{u}", u == 'admin') for u in {uid or 'x', 'alice', 'bob', 'admin'}]
    c = {"expectation": exp, "request": req, "functionMocks": ms}
    if old is not None: c["resource"] = {"data": old}
    cases.append((name, c))


AID = "123e4567-e89b-12d3-a456-426614174000"
L = "/students/alice/brokerAccounts/" + AID
A = {"label": "Apex eval 1", "firm": "Apex", "type": "eval", "updatedAt": TS}
wo = lambda d, k: {x: v for x, v in d.items() if x != k}
case("ALLOW", "owner creates", 'alice', "create", L, new=A)
case("ALLOW", "owner creates empty label/firm/type", 'alice', "create", L, new=dict(A, label="", firm="", type=""))
case("ALLOW", "owner updates", 'alice', "update", L, new=dict(A, type="funded", firm="Topstep"), old=A)
case("ALLOW", "owner reads", 'alice', "get", L, old=A)
case("ALLOW", "owner lists", 'alice', "list", "/students/alice/brokerAccounts/x", old=A)
case("ALLOW", "owner deletes", 'alice', "delete", L, old=A)
case("ALLOW", "40-char label", 'alice', "create", L, new=dict(A, label="x" * 40))
case("DENY", "41-char label", 'alice', "create", L, new=dict(A, label="x" * 41))
case("DENY", "41-char firm", 'alice', "create", L, new=dict(A, firm="y" * 41))
case("DENY", "bad type", 'alice', "create", L, new=dict(A, type="lifetime"))
case("DENY", "label not a string", 'alice', "create", L, new=dict(A, label=5))
case("DENY", "client updatedAt", 'alice', "create", L, new=dict(A, updatedAt="2020-01-01T00:00:00Z"))
case("DENY", "extra key (password)", 'alice', "create", L, new=dict(A, password="x"))
case("DENY", "extra key (accountNumber)", 'alice', "create", L, new=dict(A, accountNumber="APEX-1"))
case("DENY", "missing firm", 'alice', "create", L, new=wo(A, "firm"))
case("DENY", "id with slash-like junk", 'alice', "create", "/students/alice/brokerAccounts/ab$cd%ef", new=A)
case("DENY", "id too short", 'alice', "create", "/students/alice/brokerAccounts/abc", new=A)
case("DENY", "B reads A", 'bob', "get", L, old=A)
case("DENY", "B lists A", 'bob', "list", "/students/alice/brokerAccounts/x", old=A)
case("DENY", "B writes A", 'bob', "create", L, new=A)
case("DENY", "B deletes A", 'bob', "delete", L, old=A)
case("DENY", "admin reads A", 'admin', "get", L, old=A)
case("DENY", "admin writes A", 'admin', "update", L, new=A, old=A)
case("DENY", "signed-out get", None, "get", L, old=A)
case("DENY", "signed-out create", None, "create", L, new=A)


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
