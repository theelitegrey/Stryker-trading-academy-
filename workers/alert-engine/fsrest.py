"""Minimal Firestore + Google REST client (stdlib). Auth = the refresh token firebase-tools already keeps on this
server, exchanged for a short-lived access token in memory (never printed or stored). CLIENT_ID/SECRET are
firebase-tools' public installed-app client (same ones tools/demo-account/lib/gcp.mjs uses)."""
import json, os, time, urllib.request, urllib.error, urllib.parse

PROJECT = 'strykertrades-e0cd8'
DB = 'projects/%s/databases/(default)/documents' % PROJECT
FS = 'https://firestore.googleapis.com/v1/' + DB
CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com'
CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi'
CFG = os.environ.get('FIREBASE_TOOLS_CONFIG', '/root/.config/configstore/firebase-tools.json')
_tok = {'v': None, 'exp': 0}


class HttpErr(Exception):
    def __init__(self, status, body):
        super().__init__('HTTP %s %s' % (status, body[:300]))
        self.status = status


def token():
    if _tok['v'] and time.time() < _tok['exp'] - 60:
        return _tok['v']
    rt = json.load(open(CFG))['tokens']['refresh_token']
    data = urllib.parse.urlencode({'grant_type': 'refresh_token', 'refresh_token': rt,
                                   'client_id': CLIENT_ID, 'client_secret': CLIENT_SECRET}).encode()
    with urllib.request.urlopen(urllib.request.Request('https://oauth2.googleapis.com/token', data=data), timeout=20) as r:
        j = json.load(r)
    _tok['v'] = j['access_token']
    _tok['exp'] = time.time() + j.get('expires_in', 3000)
    return _tok['v']


def call(url, method='GET', body=None, timeout=30):
    for i in range(3):
        req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={'Authorization': 'Bearer ' + token(), 'x-goog-user-project': PROJECT,
                                              'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                t = r.read()
                return json.loads(t) if t else {}
        except urllib.error.HTTPError as e:
            b = e.read().decode('utf8', 'replace')
            if e.code in (429, 500, 502, 503) and i < 2:
                time.sleep(1 + i)
                continue
            raise HttpErr(e.code, b)
        except (urllib.error.URLError, TimeoutError):
            if i == 2:
                raise
            time.sleep(1 + i)


def enc(v):
    if v is None: return {'nullValue': None}
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, float): return {'doubleValue': v}
    if isinstance(v, str): return {'stringValue': v}
    if isinstance(v, dict) and '__ts' in v: return {'timestampValue': v['__ts']}
    if isinstance(v, dict): return {'mapValue': {'fields': {k: enc(x) for k, x in v.items()}}}
    if isinstance(v, list): return {'arrayValue': {'values': [enc(x) for x in v]}}
    raise TypeError(type(v))


def dec(v):
    k = next(iter(v)); x = v[k]
    if k == 'integerValue': return int(x)
    if k == 'doubleValue': return float(x)
    if k == 'nullValue': return None
    if k == 'mapValue': return {a: dec(b) for a, b in x.get('fields', {}).items()}
    if k == 'arrayValue': return [dec(b) for b in x.get('values', [])]
    return x      # string / boolean / timestamp (ISO string)


def now_ts():
    return {'__ts': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())}


def decode_doc(d):
    return {k: dec(v) for k, v in d.get('fields', {}).items()}


def run_query(sq, parent=None):
    return call((FS if not parent else FS + '/' + parent) + ':runQuery', 'POST', {'structuredQuery': sq}, timeout=120)


def get_doc(path):
    try:
        d = call(FS + '/' + path)
        return decode_doc(d), d.get('updateTime')
    except HttpErr as e:
        if e.status == 404: return None, None
        raise


def create_doc(coll, data):
    d = call(FS + '/' + coll, 'POST', {'fields': {k: enc(v) for k, v in data.items()}})
    return d['name'].rsplit('/', 1)[1]


def patch_doc(path, data, precond_update_time=None):
    q = '&'.join('updateMask.fieldPaths=' + urllib.parse.quote(k) for k in data)
    if precond_update_time: q += '&currentDocument.updateTime=' + urllib.parse.quote(precond_update_time)
    else: q += '&currentDocument.exists=true'
    return call(FS + '/' + path + '?' + q, 'PATCH', {'fields': {k: enc(v) for k, v in data.items()}})


def set_doc(path, data):
    q = '&'.join('updateMask.fieldPaths=' + urllib.parse.quote(k) for k in data)
    return call(FS + '/' + path + '?' + q, 'PATCH', {'fields': {k: enc(v) for k, v in data.items()}})


def delete_doc(path):
    try: call(FS + '/' + path, 'DELETE')
    except HttpErr as e:
        if e.status != 404: raise
