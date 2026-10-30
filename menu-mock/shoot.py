import sys, json
from playwright.sync_api import sync_playwright
OUT = '/root/projects/stryker-notes/reports/workers/menu-compact/'
shots = [('now','now',''),('123','1+2+3',''),('1234','1+2+3+4','&fold=community'),('1235','1+2+3+5',''),('all','all 5','&fold=community')]
meta = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell')
    for w, tag in ((390, 'm'), (1440, 'd')):
        for v, label, extra in shots:
            if w == 1440 and v not in ('now', '1234'): continue
            ctx = b.new_context(viewport={'width': w, 'height': 844}, color_scheme='dark', device_scale_factor=2 if w == 390 else 1)
            pg = ctx.new_page()
            pg.goto('http://127.0.0.1:8791/menu-mock/menu.html?v=%s%s' % (v, extra))
            pg.wait_for_timeout(1500)
            title = pg.title()
            h = pg.evaluate("document.querySelector('.sidebar').scrollHeight")
            pg.set_viewport_size({'width': w, 'height': h+90})
            pg.wait_for_timeout(500)
            fn = OUT + '%s-%s.png' % (tag, v)
            if w == 1440:
                pg.screenshot(path=fn, clip={'x': 0, 'y': 0, 'width': 360, 'height': h+90})
            else:
                pg.screenshot(path=fn, clip={'x': 0, 'y': 0, 'width': 300, 'height': h+90})
            meta['%s-%s' % (tag, v)] = {'title': title, 'h': h}
            ctx.close()
    b.close()
json.dump(meta, open(OUT + 'meta.json', 'w'), indent=1)
print(json.dumps(meta, indent=1))
