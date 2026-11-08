"""Rules tests: students/{uid}/metricAlerts (metric alerts). Firestore Rules :test API (nothing written or published).
Runs on GitHub (dp-rules-test.yml): FB_TOKEN_FILE=/tmp/fbtok python3 tools/tests/metric-alerts-rules-test.py functions-src/firestore.rules"""
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


L = "/students/alice/metricAlerts/abcdefghijKLMNOPqrst"
G = {"metric": "gex_cross", "symbol": "SPX", "p": {"level": "gamma_flip", "dir": "any"}, "freq": "every", "active": True, "createdAt": TS, "updatedAt": TS}
F = {"metric": "funding", "symbol": "BTC", "p": {"venue": "okx", "dir": "above", "value": 0.01}, "freq": "once", "active": True, "updatedAt": TS}
O = {"metric": "oi_change", "symbol": "ETH", "p": {"venue": "hl", "dir": "either", "value": 2, "mins": 15}, "message": "hi", "freq": "every", "active": True, "updatedAt": TS}
wo = lambda d, k: {x: v for x, v in d.items() if x != k}
case("ALLOW", "create gex cross", 'alice', "create", L, new=G)
case("ALLOW", "create em range", 'alice', "create", L, new=dict(G, p={"level": "em_low", "dir": "down", "range": "s"}))
case("ALLOW", "create funding", 'alice', "create", L, new=F)
case("ALLOW", "create oi change", 'alice', "create", L, new=O)
case("ALLOW", "indicator doc id", 'alice', "create", "/students/alice/metricAlerts/ind-gex-SPX", new=G)
case("ALLOW", "pause (update)", 'alice', "update", L, new=dict(G, active=False), old=G)
case("ALLOW", "get own", 'alice', "get", L, old=G)
case("ALLOW", "list own", 'alice', "list", "/students/alice/metricAlerts/x", old=G)
case("ALLOW", "delete own", 'alice', "delete", L, old=G)
case("DENY", "unknown metric", 'alice', "create", L, new=dict(G, metric="win_rate"))
case("DENY", "regime lives in zoroAlerts", 'alice', "create", L, new=dict(G, metric="gex_regime"))
case("DENY", "symbol 16 chars", 'alice', "create", L, new=dict(G, symbol="A" * 16))
case("DENY", "symbol empty", 'alice', "create", L, new=dict(G, symbol=""))
case("DENY", "p not a map", 'alice', "create", L, new=dict(G, p="gamma_flip"))
case("DENY", "p extra key", 'alice', "create", L, new=dict(G, p={"level": "pin", "uid": "bob"}))
case("DENY", "p 5 keys", 'alice', "create", L, new=dict(O, p=dict(O["p"], level="pin")))
case("DENY", "message 141", 'alice', "create", L, new=dict(G, message="x" * 141))
case("DENY", "bad freq", 'alice', "create", L, new=dict(G, freq="always"))
case("DENY", "active not bool", 'alice', "create", L, new=dict(G, active="yes"))
case("DENY", "client updatedAt", 'alice', "create", L, new=dict(G, updatedAt="2020-01-01T00:00:00Z"))
case("DENY", "extra key", 'alice', "create", L, new=dict(G, plan="Elite"))
case("DENY", "missing p", 'alice', "create", L, new=wo(G, "p"))
case("DENY", "id 41 chars", 'alice', "create", "/students/alice/metricAlerts/" + "a" * 41, new=G)
case("DENY", "update changes createdAt", 'alice', "update", L, new=dict(G, createdAt="2026-11-08T00:00:00Z"), old=G)
case("DENY", "B reads A", 'bob', "get", L, old=G)
case("DENY", "B lists A", 'bob', "list", "/students/alice/metricAlerts/x", old=G)
case("DENY", "B writes A", 'bob', "create", L, new=G)
case("DENY", "B deletes A", 'bob', "delete", L, old=G)
case("DENY", "signed-out get", None, "get", L, old=G)
case("DENY", "signed-out create", None, "create", L, new=G)
case("DENY", "admin writes A", 'admin', "create", L, new=G)
case("ALLOW", "dpAlerts untouched", 'alice', "create", "/students/alice/dpAlerts/d1",
     new={"symbol": "TSLA", "min": 10000000, "freq": "every", "active": True, "updatedAt": TS})


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
