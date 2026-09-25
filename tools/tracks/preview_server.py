#!/usr/bin/env python3
"""Local preview of track chapters through the REAL chapter.html renderer.

  python3 tools/tracks/preview_server.py 8813
  open http://127.0.0.1:8813/chapter.html?ch=VP-01

What it changes, and only on the fly (nothing on disk):
  * chapter.html: the three Firebase CDN tags are dropped, so auth and db stay
    null and reader.js takes its documented offline path (CHAPTERS_SEED). A
    small style hides the guest paywall overlay, which would otherwise dim the
    page, so the preview shows what a signed-in member sees.
  * assets/chapters-data.js: every tools/tracks/*/*.json is appended to
    CHAPTERS_SEED, so ?ch=VP-01 resolves exactly as it would once the chapter
    is in Firestore.
Everything else (reader.js, style.css, the innerHTML render path) is the
shipped code, unmodified.
"""
import glob, http.server, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TRACKS = os.path.join(ROOT, 'tools', 'tracks')


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass

    def send_body(self, body, ctype):
        b = body.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path in ('/chapter.html', '/chapter'):
            s = open(os.path.join(ROOT, 'chapter.html'), encoding='utf-8').read()
            s = re.sub(r'<script src="https://www\.gstatic\.com/firebasejs/[^"]+"></script>\n?', '', s)
            s = s.replace('</head>', '<style>#guest-paywall-overlay{display:none!important}'
                          '.paywall-dimmed{filter:none!important;opacity:1!important;pointer-events:auto!important}'
                          '.guest-banner{display:none!important}</style></head>')
            return self.send_body(s, 'text/html; charset=utf-8')
        if path == '/assets/chapters-data.js':
            s = open(os.path.join(ROOT, 'assets', 'chapters-data.js'), encoding='utf-8').read()
            extra = [json.load(open(p)) for p in sorted(glob.glob(os.path.join(TRACKS, '*', '*.json')))]
            s += '\n;CHAPTERS_SEED.push.apply(CHAPTERS_SEED, %s);\n' % json.dumps(extra)
            return self.send_body(s, 'application/javascript; charset=utf-8')
        return super().do_GET()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8813
    http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
