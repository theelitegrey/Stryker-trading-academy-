#!/usr/bin/env python3
"""Build Zoro for Vest: dist/zoro-for-vest-chrome-<v>.zip (MV3, load unpacked or drag in) and dist/zoro-for-vest.user.js (Tampermonkey).
Run: python3 extensions/vest/build.py   (no network, no dependencies). The two builds share the same src/ files byte for byte."""
import base64, json, os, shutil, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, DIST = os.path.join(HERE, 'src'), os.path.join(HERE, 'dist')
VERSION = '1.0.0'
MATCH = 'https://next.vestmarkets.com/*'
PAGE_PARTS = ['core.js', 'engine.js', 'levels.js', 'ui.js', 'boot.js']   # order matters: core first, boot last


def read(p):
    with open(os.path.join(SRC, p), encoding='utf-8') as f:
        return f.read()


def assets_js():
    css = read('panel.css')
    with open(os.path.join(HERE, 'icons', 'icon-48.png'), 'rb') as f:
        logo = 'data:image/png;base64,' + base64.b64encode(f.read()).decode()
    return 'globalThis.ZV_ASSETS = ' + json.dumps({'css': css, 'logo': logo}) + ';\n'


def page_bundle(host_file):
    head = '// Zoro for Vest ' + VERSION + ' (TradeZoro). Built from extensions/vest/src. Education only. Not financial advice.\n'
    body = assets_js() + ''.join('\n// ---- ' + p + '\n' + read(p) for p in PAGE_PARTS) + '\n// ---- ' + host_file + '\n' + read(host_file)
    # one private scope: the modules attach to a local namespace (a shadowed globalThis), so nothing but the boot marker reaches Vest's window
    return head + '(function (globalThis) {\n' + body + '\n})(Object.create(null));\n'


def manifest():
    return {
        'manifest_version': 3, 'name': 'Zoro for Vest', 'short_name': 'Zoro for Vest', 'version': VERSION,
        'description': 'TradeZoro order panel, multi-account copy and levels on Vest. Not affiliated with Vest.',
        'icons': {'16': 'icons/icon-16.png', '32': 'icons/icon-32.png', '48': 'icons/icon-48.png', '128': 'icons/icon-128.png'},
        'permissions': ['storage'],
        'host_permissions': [MATCH, 'https://tradezoro.com/api/lv/*'],
        'background': {'service_worker': 'background.js'},
        'content_scripts': [
            {'matches': [MATCH], 'js': ['page.js'], 'run_at': 'document_start', 'world': 'MAIN', 'all_frames': False},
            {'matches': [MATCH], 'js': ['bridge.js'], 'run_at': 'document_start', 'all_frames': False},
        ],
        'content_security_policy': {'extension_pages': "script-src 'self'; object-src 'none'"},
        'minimum_chrome_version': '111',
    }


def userscript():
    meta = '\n'.join([
        '// ==UserScript==', '// @name         Zoro for Vest', '// @namespace    https://tradezoro.com/', '// @version      ' + VERSION,
        '// @description  TradeZoro order panel, multi-account copy and levels on Vest. Not affiliated with Vest.',
        '// @match        ' + MATCH, '// @run-at       document-start', '// @inject-into  page', '// @noframes',
        '// @grant        GM_getValue', '// @grant        GM_setValue', '// @grant        GM_deleteValue', '// @grant        GM_xmlhttpRequest',
        '// @grant        unsafeWindow', '// @connect      tradezoro.com', '// ==/UserScript==', ''])
    return meta + page_bundle('userscript/host.js')


def main():
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    ch = os.path.join(DIST, 'chrome')
    os.makedirs(os.path.join(ch, 'icons'))
    files = {
        'manifest.json': json.dumps(manifest(), indent=2) + '\n',
        'page.js': page_bundle('chrome/host-page.js'),
        'bridge.js': read('chrome/bridge.js'),
        'background.js': read('chrome/background.js'),
        'core.js': read('core.js'),
    }
    for n, t in files.items():
        with open(os.path.join(ch, n), 'w', encoding='utf-8') as f:
            f.write(t)
    for n in os.listdir(os.path.join(HERE, 'icons')):
        shutil.copy(os.path.join(HERE, 'icons', n), os.path.join(ch, 'icons', n))
    z = os.path.join(DIST, 'zoro-for-vest-chrome-' + VERSION + '.zip')
    with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
        for base, _, names in os.walk(ch):
            for n in sorted(names):
                p = os.path.join(base, n)
                zi = zipfile.ZipInfo(os.path.relpath(p, ch), (2026, 1, 1, 0, 0, 0))   # fixed time: same input, same zip
                zi.compress_type = zipfile.ZIP_DEFLATED
                with open(p, 'rb') as f:
                    zf.writestr(zi, f.read())
    with open(os.path.join(DIST, 'zoro-for-vest.user.js'), 'w', encoding='utf-8') as f:
        f.write(userscript())
    for n in sorted(os.listdir(DIST)):
        print(n)


if __name__ == '__main__':
    main()
