#!/usr/bin/env python3
# Rules test for the per-user live chart feed flag (students/{uid}.liveFeed, 2026-10-26).
# Run: FB_TOKEN_FILE=<file with an OAuth token> python3 tools/tests/live-feed-rules-test.py functions-src/firestore.rules
# Uses the Firebase Rules :test API: nothing is read or written in the database.
import json, urllib.request, urllib.error, sys, os
T = open(os.environ['FB_TOKEN_FILE']).read().strip(); P = 'strykertrades-e0cd8'
D = '/databases/(default)/documents'
TS = "2026-10-26T00:00:00Z"
cases = []
def m(fn, path, val): return {"function": fn, "args": [{"exactValue": D + path}], "result": {"value": val}}
def case(exp, name, uid, method, path, new=None, old=None):
    req = {"auth": ({"uid": uid, "token": {}} if uid else None), "method": method, "path": D + path, "time": TS}
    if new is not None: req["resource"] = {"data": new}
    ms = [m("exists", f"/admins/{u}", u == 'admin') for u in {uid or 'x', 'alice', 'bob', 'admin'}]
    c = {"expectation": exp, "request": req, "functionMocks": ms}
    if old is not None: c["resource"] = {"data": old}
    cases.append((name, c))
A = "/students/alice"; B = "/students/bob"
OLD = {"plan": "Pro", "displayName": "Alice"}
ON = dict(OLD, liveFeed=True)
# student cannot grant it to self (update / create / merge with other keys)
case("DENY", "student sets liveFeed on self", 'alice', "update", A, new=dict(OLD, liveFeed=True), old=OLD)
case("DENY", "student sets liveFeed + theme on self", 'alice', "update", A, new=dict(OLD, liveFeed=True, theme="dark"), old=OLD)
case("DENY", "student creates own doc with liveFeed", 'alice', "create", A, new={"plan": "Starter", "liveFeed": True})
case("DENY", "student writes liveFeedBy on self", 'alice', "update", A, new=dict(OLD, liveFeedBy="alice"), old=OLD)
case("DENY", "student writes liveFeedAt on self", 'alice', "update", A, new=dict(OLD, liveFeedAt=TS), old=OLD)
case("DENY", "student turns own liveFeed false->true", 'alice', "update", A, new=dict(OLD, liveFeed=True), old=dict(OLD, liveFeed=False))
case("DENY", "student removes own liveFeed off (any change)", 'alice', "update", A, new=dict(OLD, liveFeed=False), old=ON)
# student cannot set it on anyone else
case("DENY", "student sets liveFeed on bob", 'alice', "update", B, new=dict(OLD, liveFeed=True), old=OLD)
case("DENY", "signed-out sets liveFeed", None, "update", A, new=dict(OLD, liveFeed=True), old=OLD)
# a student can still read their own doc with the flag, and still edit normal fields while it is on
case("ALLOW", "student reads own doc (liveFeed on)", 'alice', "get", A, old=ON)
case("DENY", "student reads bob's doc", 'alice', "get", B, old=ON)
case("ALLOW", "student edits theme while liveFeed on", 'alice', "update", A, new=dict(ON, theme="light"), old=ON)
# admin can write it
case("ALLOW", "admin turns liveFeed on", 'admin', "update", A, new=dict(OLD, liveFeed=True, liveFeedBy="admin", liveFeedAt=TS), old=OLD)
case("ALLOW", "admin turns liveFeed off", 'admin', "update", A, new=dict(ON, liveFeed=False, liveFeedBy="admin", liveFeedAt=TS), old=ON)
# regressions on untouched privileged keys
case("DENY", "student sets own plan Elite", 'alice', "update", A, new=dict(OLD, plan="Elite"), old=OLD)
case("DENY", "student sets own demo", 'alice', "update", A, new=dict(OLD, demo=True), old=OLD)
case("ALLOW", "new sign-up bootstrap plan Starter", 'alice', "create", A, new={"plan": "Starter"})
case("DENY", "student creates admins/alice", 'alice', "create", "/admins/alice", new={"x": 1})

def run(src):
    body = {"source": {"files": [{"name": "firestore.rules", "content": src}]}, "testSuite": {"testCases": [c for _, c in cases]}}
    rq = urllib.request.Request(f"https://firebaserules.googleapis.com/v1/projects/{P}:test", data=json.dumps(body).encode(),
                                headers={"Authorization": "Bearer " + T, "Content-Type": "application/json", "x-goog-user-project": P})
    try: r = json.load(urllib.request.urlopen(rq))
    except urllib.error.HTTPError as e: print(e.read().decode()[:2000]); sys.exit(2)
    if r.get('issues'): print('ISSUES', json.dumps(r['issues'])[:2000])
    res = r.get('testResults', []); bad = 0
    for (n, _), x in zip(cases, res):
        ok = x.get('state') == 'SUCCESS'; bad += 0 if ok else 1
        print(('PASS ' if ok else 'FAIL ') + n)
    print(f"{len(res) - bad}/{len(cases)} passed"); return bad
sys.exit(1 if run(open(sys.argv[1]).read()) else 0)
