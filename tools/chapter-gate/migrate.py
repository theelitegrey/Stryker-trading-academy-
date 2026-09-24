#!/usr/bin/env python3
"""Chapter gate migration: split chapters/* into catalog + plan-gated chapterBodies/*.

Run from the repo root. It needs an admin OAuth token printed by $STRYKER_TOKEN_CMD
(default: the website manager's fn/tok.sh). Tokens and keys are never printed.

  migrate.py backup                  export chapters, plans and settings to reports/chapter-gate/backup-<ts>.json
  migrate.py plan-access [--apply]   write settings/planAccess from plans/*
  migrate.py bodies [--apply]        write chapterBodies/* from the LIVE chapters/* (with minRank)
  migrate.py verify                  bodies byte-equal to chapters/* text fields (before strip),
                                     or to the backup (after strip); minRank as expected
  migrate.py strip --backup F [--apply]  remove text fields from chapters/*, add catalog fields
  migrate.py restore --backup F [--only 01] [--apply]  write chapters/* back from a backup
Without --apply, a mode only prints what it would do.
"""
import json, os, re, subprocess, sys, time, urllib.request, urllib.error

PROJECT = 'strykertrades-e0cd8'
BASE = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/'
TOKEN_CMD = os.environ.get('STRYKER_TOKEN_CMD', '/root/.hermes/profiles/stryker-website-manager/cache/scratch/fn/tok.sh')
OUTDIR = os.environ.get('CHAPTER_GATE_OUT', '/root/projects/stryker-notes/reports/chapter-gate')
TEXT_FIELDS = ['bodyHtml', 'paragraphs', 'lessons', 'video']   # lessons: full objects go to the body
PLACEHOLDER = re.compile(r'commondatastorage\.googleapis\.com/gtv-videos-bucket', re.I)

_tok = None
def tok():
    global _tok
    if not _tok:
        _tok = subprocess.check_output([TOKEN_CMD]).decode().strip()
    return _tok

def req(method, path, body=None, params=''):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path + params, data=data, method=method,
                               headers={'Authorization': 'Bearer ' + tok(), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(r) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method} {path}: HTTP {e.code} {e.read()[:300]!r}')

def list_docs(coll):
    out, page = [], ''
    while True:
        r = req('GET', coll, params='?pageSize=300' + (f'&pageToken={page}' if page else ''))
        out += r.get('documents', [])
        page = r.get('nextPageToken')
        if not page:
            return out

# ---- Firestore value <-> python ------------------------------------------
def unwrap(v):
    (k, x), = v.items()
    if k == 'mapValue': return {kk: unwrap(vv) for kk, vv in x.get('fields', {}).items()}
    if k == 'arrayValue': return [unwrap(i) for i in x.get('values', [])]
    if k == 'integerValue': return int(x)
    if k == 'nullValue': return None
    return x
def wrap(x):
    if x is None: return {'nullValue': None}
    if isinstance(x, bool): return {'booleanValue': x}
    if isinstance(x, int): return {'integerValue': str(x)}
    if isinstance(x, float): return {'doubleValue': x}
    if isinstance(x, str): return {'stringValue': x}
    if isinstance(x, list): return {'arrayValue': {'values': [wrap(i) for i in x]}}
    if isinstance(x, dict): return {'mapValue': {'fields': {k: wrap(v) for k, v in x.items()}}}
    raise TypeError(type(x))
def doc_id(d): return d['name'].rsplit('/', 1)[1]
def fields(d): return {k: unwrap(v) for k, v in d.get('fields', {}).items()}

# ---- the same access maths as functions-src/chapterGate.js ---------------
def chapter_limit(raw):
    if not isinstance(raw, str): return float('inf')
    t = raw.strip().lower()
    if not t or t == 'all': return float('inf')
    m = re.fullmatch(r'(\d+)\s*-\s*(\d+)', t)
    if m: return int(m.group(2))
    m = re.fullmatch(r'(\d+)', t)
    return int(m.group(1)) if m else float('inf')

def load_plans():
    plans = []
    for d in list_docs('plans'):
        f = fields(d)
        plans.append({'id': doc_id(d), 'name': f.get('name') or doc_id(d),
                      'rank': int(float(f.get('rank') or 0)), 'limit': chapter_limit(f.get('chapterAccess'))})
    ranks = {}
    for p in plans:
        for k in (p['name'], p['id']):
            if k not in ranks or p['rank'] < ranks[k]: ranks[k] = p['rank']
    return plans, ranks

def min_rank(cid, min_role, plans, ranks):
    n = int(cid) if cid.isdigit() else float('inf')
    role_rank = ranks.get(min_role, 0) if min_role else 0
    ok = [p['rank'] for p in plans if p['rank'] >= role_rank and n <= p['limit']]
    if ok: return min(ok)
    return (max(p['rank'] for p in plans) + 1) if plans else 99

def read_minutes(f):
    strip = lambda h: re.sub(r'<[^>]*>', ' ', str(h or ''))
    text = strip(f.get('bodyHtml')) + ' ' + ' '.join(f.get('paragraphs') or [])
    for l in f.get('lessons') or []:
        text += ' ' + strip(l.get('descHtml') or l.get('desc'))
    return max(1, round(len(text.split()) / 200))

def catalog_of(f):
    video = str(f.get('video') or '').strip()
    return {'lessons': [{'title': (l or {}).get('title', '')} for l in (f.get('lessons') or [])],
            'preview': re.sub(r'<[^>]*>', '', str((f.get('paragraphs') or [''])[0] or '')),
            'readMinutes': read_minutes(f),
            'hasVideo': bool(video) and not PLACEHOLDER.search(video)}

def body_of(cid, f, plans, ranks):
    return {'num': f.get('num', cid), 'minRole': f.get('minRole'),
            'bodyHtml': f.get('bodyHtml', ''), 'paragraphs': f.get('paragraphs') or [],
            'lessons': f.get('lessons') or [], 'video': f.get('video', ''),
            'minRank': min_rank(cid, f.get('minRole'), plans, ranks)}

def mask_params(names):
    return '?' + '&'.join('updateMask.fieldPaths=' + n for n in names)

def has_text(f): return bool(f.get('bodyHtml') or f.get('paragraphs'))

# ---- modes ---------------------------------------------------------------
def backup():
    os.makedirs(OUTDIR, exist_ok=True)
    snap = {'takenAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'chapters': {doc_id(d): d.get('fields', {}) for d in list_docs('chapters')},
            'chapterBodies': {doc_id(d): d.get('fields', {}) for d in list_docs('chapterBodies')},
            'plans': {doc_id(d): d.get('fields', {}) for d in list_docs('plans')},
            'settings': {doc_id(d): d.get('fields', {}) for d in list_docs('settings')
                         if doc_id(d) in ('planAccess', 'commerce', 'site')}}
    path = os.path.join(OUTDIR, 'backup-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '.json')
    with open(path, 'w') as fh: json.dump(snap, fh)
    os.chmod(path, 0o600)
    with_text = sum(1 for v in snap['chapters'].values() if 'bodyHtml' in v or 'paragraphs' in v)
    print(f'backup: {path} | chapters {len(snap["chapters"])} (with text {with_text}) | '
          f'bodies {len(snap["chapterBodies"])} | plans {len(snap["plans"])} | {os.path.getsize(path)} bytes')

def plan_access(apply):
    plans, ranks = load_plans()
    print('rankByPlan:', json.dumps(ranks, sort_keys=True))
    if apply:
        req('PATCH', 'settings/planAccess', {'fields': {'rankByPlan': wrap(ranks)}}, mask_params(['rankByPlan']))
        print('settings/planAccess written')

def bodies(apply):
    plans, ranks = load_plans()
    docs = list_docs('chapters')
    todo, skipped = [], []
    for d in docs:
        f = fields(d)
        (todo if has_text(f) else skipped).append((doc_id(d), f))
    by_rank = {}
    for cid, f in todo:
        by_rank.setdefault(min_rank(cid, f.get('minRole'), plans, ranks), []).append(cid)
    print(f'chapters {len(docs)}: with text {len(todo)}, without text (skipped) {len(skipped)}')
    for r in sorted(by_rank): print(f'  minRank {r}: {" ".join(sorted(by_rank[r]))}')
    if not apply: return
    for cid, f in todo:
        b = body_of(cid, f, plans, ranks)
        req('PATCH', 'chapterBodies/' + cid, {'fields': {k: wrap(v) for k, v in b.items()}})
    print(f'chapterBodies written: {len(todo)}')

def verify(backup_file=None):
    plans, ranks = load_plans()
    src = {doc_id(d): d.get('fields', {}) for d in list_docs('chapters')}
    if backup_file:
        src = json.load(open(backup_file))['chapters']
    body = {doc_id(d): d.get('fields', {}) for d in list_docs('chapterBodies')}
    bad = 0
    for cid, sf in sorted(src.items()):
        s = {k: unwrap(v) for k, v in sf.items()}
        if not has_text(s): continue
        b = body.get(cid)
        if not b: print('MISSING body', cid); bad += 1; continue
        bf = {k: unwrap(v) for k, v in b.items()}
        for k in TEXT_FIELDS:
            if json.dumps(s.get(k) or ([] if k in ('paragraphs', 'lessons') else ''), sort_keys=True) != \
               json.dumps(bf.get(k) or ([] if k in ('paragraphs', 'lessons') else ''), sort_keys=True):
                print('DIFF', cid, k); bad += 1
        want = min_rank(cid, s.get('minRole'), plans, ranks)
        if bf.get('minRank') != want: print('MINRANK', cid, bf.get('minRank'), '!=', want); bad += 1
    print(f'verify: {len(body)} bodies checked against {"backup" if backup_file else "live chapters"}: '
          + ('ALL MATCH' if not bad else f'{bad} PROBLEMS'))
    return bad

def strip(backup_file, apply):
    if not backup_file or not os.path.exists(backup_file): raise SystemExit('strip needs --backup <file>')
    if verify(backup_file): raise SystemExit('refusing to strip: bodies do not match the backup')
    snap = json.load(open(backup_file))['chapters']
    n = 0
    for cid, sf in sorted(snap.items()):
        f = {k: unwrap(v) for k, v in sf.items()}
        if not has_text(f): continue
        cat = catalog_of(f)
        # lessons is rewritten (titles only); bodyHtml/paragraphs/video removed
        # (named in the mask but absent from the body = deleted).
        names = ['lessons', 'preview', 'readMinutes', 'hasVideo', 'bodyHtml', 'paragraphs', 'video']
        n += 1
        if apply:
            req('PATCH', 'chapters/' + cid, {'fields': {k: wrap(v) for k, v in cat.items()}}, mask_params(names))
    print(f'strip: {n} catalog docs {"updated" if apply else "would be updated"}')

def restore(backup_file, only, apply):
    snap = json.load(open(backup_file))['chapters']
    ids = [only] if only else sorted(snap)
    for cid in ids:
        if apply: req('PATCH', 'chapters/' + cid, {'fields': snap[cid]})
    print(f'restore: {len(ids)} chapters {"written" if apply else "would be written"} from {backup_file}')

def arg(name):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else None

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    apply = '--apply' in sys.argv
    if mode == 'backup': backup()
    elif mode == 'plan-access': plan_access(apply)
    elif mode == 'bodies': bodies(apply)
    elif mode == 'verify': sys.exit(1 if verify(arg('--backup')) else 0)
    elif mode == 'strip': strip(arg('--backup'), apply)
    elif mode == 'restore': restore(arg('--backup'), arg('--only'), apply)
    else: print(__doc__); sys.exit(2)
