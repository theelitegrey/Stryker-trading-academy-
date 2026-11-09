#!/usr/bin/env python3
# Rules test for the sanctions attestation fields on students/{uid} (Owner order 09 Nov 2026, assets/geo-attest.js).
# Run: FB_TOKEN_FILE=<file with an OAuth token> python3 tools/tests/geo-attest-rules-test.py functions-src/firestore.rules
# Uses the Firebase Rules :test API: nothing is read or written in the database.
import json, urllib.request, urllib.error, sys, os
T = open(os.environ['FB_TOKEN_FILE']).read().strip(); P = 'strykertrades-e0cd8'
D = '/databases/(default)/documents'
TS = "2026-11-09T00:00:00Z"
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
OLD = {"plan": "Starter", "displayName": "Alice"}
ATT = {"residenceCountry": "IN", "sanctionsAttest": True, "sanctionsAttestAt": TS}
DONE = dict(OLD, **ATT)
# first answer: allowed once, exact shape
case("ALLOW", "member attests once (IN)", 'alice', "update", A, new=dict(OLD, **ATT), old=OLD)
case("ALLOW", "member attests once (UA, not a blocked region)", 'alice', "update", A, new=dict(OLD, residenceCountry="UA", sanctionsAttest=True, sanctionsAttestAt=TS), old=OLD)
case("ALLOW", "member stores a blocked answer alone (locks purchases)", 'alice', "update", A, new=dict(OLD, residenceCountry="UA-43"), old=OLD)
case("ALLOW", "new doc created with the attestation", 'alice', "create", A, new=dict({"plan": "Starter"}, **ATT))
case("ALLOW", "new doc created without it (prompt comes later)", 'alice', "create", A, new={"plan": "Starter"})
case("DENY", "attest false", 'alice', "update", A, new=dict(OLD, residenceCountry="IN", sanctionsAttest=False, sanctionsAttestAt=TS), old=OLD)
case("DENY", "attest with a client time", 'alice', "update", A, new=dict(OLD, residenceCountry="IN", sanctionsAttest=True, sanctionsAttestAt="2020-01-01T00:00:00Z"), old=OLD)
case("DENY", "attestAt without attest", 'alice', "update", A, new=dict(OLD, residenceCountry="IN", sanctionsAttestAt=TS), old=OLD)
case("DENY", "attest without a country", 'alice', "update", A, new=dict(OLD, sanctionsAttest=True, sanctionsAttestAt=TS), old=OLD)
case("DENY", "country not a code", 'alice', "update", A, new=dict(OLD, residenceCountry="India", sanctionsAttest=True, sanctionsAttestAt=TS), old=OLD)
case("DENY", "country lower case", 'alice', "update", A, new=dict(OLD, residenceCountry="in", sanctionsAttest=True, sanctionsAttestAt=TS), old=OLD)
# once only
case("DENY", "member changes country after attesting", 'alice', "update", A, new=dict(DONE, residenceCountry="US"), old=DONE)
case("DENY", "member removes the attestation", 'alice', "update", A, new=OLD, old=DONE)
case("DENY", "member re-attests (new time)", 'alice', "update", A, new=dict(DONE, sanctionsAttestAt=TS), old=dict(DONE, sanctionsAttestAt="2026-11-01T00:00:00Z"))
case("DENY", "member un-blocks a stored blocked answer", 'alice', "update", A, new=dict(OLD, residenceCountry="IN", sanctionsAttest=True, sanctionsAttestAt=TS), old=dict(OLD, residenceCountry="RU"))
case("ALLOW", "member edits theme after attesting", 'alice', "update", A, new=dict(DONE, theme="light"), old=DONE)
# the server-side lock is never client-writable
case("DENY", "member sets sanctionsLocked", 'alice', "update", A, new=dict(DONE, sanctionsLocked=False), old=dict(DONE, sanctionsLocked=True))
case("DENY", "member clears sanctionsLocked", 'alice', "update", A, new=DONE, old=dict(DONE, sanctionsLocked=True))
case("DENY", "member creates doc with sanctionsLocked", 'alice', "create", A, new={"plan": "Starter", "sanctionsLocked": False})
# other people
case("DENY", "alice attests on bob", 'alice', "update", B, new=dict(OLD, **ATT), old=OLD)
case("DENY", "signed-out attests", None, "update", A, new=dict(OLD, **ATT), old=OLD)
case("ALLOW", "admin corrects a country", 'admin', "update", A, new=dict(DONE, residenceCountry="US"), old=DONE)
case("ALLOW", "admin sets sanctionsLocked", 'admin', "update", A, new=dict(DONE, sanctionsLocked=True), old=DONE)
# regressions
case("DENY", "student sets own plan Elite", 'alice', "update", A, new=dict(OLD, plan="Elite"), old=OLD)
case("ALLOW", "new sign-up bootstrap plan Starter", 'alice', "create", A, new={"plan": "Starter"})
case("ALLOW", "plan-heal null -> Starter", 'alice', "update", A, new=dict(OLD, plan="Starter"), old=dict(OLD, plan=None))

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
