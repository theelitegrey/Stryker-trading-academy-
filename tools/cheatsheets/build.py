#!/usr/bin/env python3
"""Build a Stryker cheat-sheet PDF plus its web preview and OG images.

    python3 tools/cheatsheets/build.py prop-firm

Reads   tools/cheatsheets/<sheet>/content.json   (the approved copy, nothing else)
Writes  assets/downloads/<content.pdf>            (A4, real text, fonts embedded)
        assets/images/<content.preview>.webp/.jpg (page 1, 720 px) + -480.webp (phones)
        assets/images/<content.og>.png            (1200x630 crop of page 1, OG/Twitter)

Rendering: the agent-browser CLI (headless Chrome), as the FVG sheet did,
but printing to PDF instead of screenshotting, so the text stays selectable
and the file stays small. Run ONE headless browser at a time on the 4 GB
server; this script closes its browser when done.

The page waits for fonts and images, then sets body[data-ready=1] and
body[data-overflow] (any element outside its page, or a page so full the
footer touches the content). The build fails on overflow, on a fallback font,
on a page count that differs from content.json, or on a PDF with no text.

Needs: agent-browser (AGENT_BROWSER env or /root/.local/bin/agent-browser),
pymupdf and Pillow.
"""
import json, os, shutil, subprocess, sys, tempfile, time

import pymupdf
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
AB = os.environ.get("AGENT_BROWSER", "/root/.local/bin/agent-browser")
SESSION = ["--session", "cheatsheet-build"]


def ab(*args, check=True):
    r = subprocess.run([AB, *SESSION, *args], capture_output=True, text=True, timeout=120)
    if check and r.returncode != 0:
        raise RuntimeError(f"agent-browser {args}: {r.stderr or r.stdout}")
    return r.stdout.strip()


def cdp_print(ws_url, out):
    """Page.printToPDF on the open page tab, honouring the CSS @page size."""
    import asyncio, base64, urllib.request
    import websockets

    async def run():
        # cdp-url is the browser endpoint; find the page target and attach.
        async with websockets.connect(ws_url, max_size=None) as ws:
            n = 0

            async def call(method, params=None, session=None):
                nonlocal n
                n += 1
                msg = {"id": n, "method": method, "params": params or {}}
                if session:
                    msg["sessionId"] = session
                await ws.send(json.dumps(msg))
                while True:
                    r = json.loads(await ws.recv())
                    if r.get("id") == n:
                        if "error" in r:
                            raise RuntimeError(f"{method}: {r['error']}")
                        return r["result"]

            targets = (await call("Target.getTargets"))["targetInfos"]
            page = next(t for t in targets if t["type"] == "page" and t["url"].startswith("file://"))
            sid = (await call("Target.attachToTarget", {"targetId": page["targetId"], "flatten": True}))["sessionId"]
            res = await call("Page.printToPDF", {"printBackground": True, "preferCSSPageSize": True,
                                                 "marginTop": 0, "marginBottom": 0, "marginLeft": 0, "marginRight": 0}, sid)
            open(out, "wb").write(base64.b64decode(res["data"]))

    asyncio.run(run())


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sheet = sys.argv[1]
    cfg = json.load(open(os.path.join(HERE, sheet, "content.json"), encoding="utf-8"))
    tpl = open(os.path.join(HERE, "cheatsheet.html"), encoding="utf-8").read()
    tpl = tpl.replace("__FONTS__", "file://" + os.path.join(HERE, "fonts"))
    tpl = tpl.replace("__LOGO__", "file://" + os.path.join(ROOT, "assets/images/logo-emblem-sm.png"))
    a, b = tpl.index("/*DATA*/"), tpl.index("/*END*/") + len("/*END*/")
    html = tpl[:a] + json.dumps(cfg, ensure_ascii=False).replace("</", "<\\/") + tpl[b:]

    tmp = tempfile.mkdtemp(prefix="cheatsheet-")
    src = os.path.join(tmp, "sheet.html")
    open(src, "w", encoding="utf-8").write(html)
    raw_pdf = os.path.join(tmp, "raw.pdf")
    try:
        ab("set", "viewport", "1240", "1754")
        ab("open", "file://" + src)
        for _ in range(80):
            if ab("eval", "document.body.dataset.ready || ''", check=False).strip('"') == "1":
                break
            time.sleep(0.25)
        else:
            raise RuntimeError("page never signalled ready")
        fonts = ab("eval", "document.body.dataset.fonts", check=False).strip('"')
        overflow = ab("eval", "document.body.dataset.overflow || ''", check=False).strip('"')
        print("fonts:", fonts, "| overflow:", overflow or "none")
        if fonts != "ok":
            raise RuntimeError("fonts fell back; the PDF would not match the brand")
        if overflow:
            raise RuntimeError("content overflows its page: " + overflow)
        # `agent-browser pdf` prints US Letter; print over raw CDP instead so
        # the CSS @page size (A4) wins.
        cdp_print(ab("get", "cdp-url").strip().strip('"'), raw_pdf)
    finally:
        ab("close", check=False)

    # Re-save through pymupdf: garbage-collect + deflate keeps the file small.
    doc = pymupdf.open(raw_pdf)
    want = len(cfg["pages"])
    if len(doc) != want:
        raise RuntimeError(f"PDF has {len(doc)} pages, content.json has {want}")
    for i, pg in enumerate(doc):
        w_mm, h_mm = pg.rect.width / 72 * 25.4, pg.rect.height / 72 * 25.4
        if abs(w_mm - 210) > 1 or abs(h_mm - 297) > 1:
            raise RuntimeError(f"page {i + 1} is {w_mm:.0f}x{h_mm:.0f} mm, not A4")
        if len(pg.get_text().strip()) < 200:
            raise RuntimeError(f"page {i + 1} has no selectable text")
    doc.set_metadata({"title": cfg.get("pdfTitle", "Stryker cheat sheet"), "author": "Stryker Trading Academy",
                      "subject": "Education only. Not financial advice.", "creator": "tools/cheatsheets/build.py", "producer": ""})
    out_pdf = os.path.join(ROOT, cfg["pdf"])
    os.makedirs(os.path.dirname(out_pdf), exist_ok=True)
    doc.save(out_pdf, garbage=4, deflate=True, clean=True)
    fonts_in = sorted({f[3] or f[4] for pg in doc for f in pg.get_fonts(full=True)})

    # Previews are rendered FROM the PDF, so they show exactly what downloads.
    p1 = doc[0].get_pixmap(dpi=220)
    im = Image.frombytes("RGB", (p1.width, p1.height), p1.samples)
    prev = im.resize((720, round(720 * im.height / im.width)), Image.LANCZOS)
    base = os.path.join(ROOT, cfg["preview"])
    prev.save(base + ".webp", "WEBP", quality=82, method=6)
    prev.save(base + ".jpg", "JPEG", quality=80, optimize=True, progressive=True)
    # 480 px for phones (shown ~240 CSS px at 2x); 720 px for desktop (~360 CSS px at 2x)
    im.resize((480, round(480 * im.height / im.width)), Image.LANCZOS).save(base + "-480.webp", "WEBP", quality=80, method=6)
    og = im.resize((1200, round(1200 * im.height / im.width)), Image.LANCZOS).crop((0, 0, 1200, 630))
    og.save(os.path.join(ROOT, cfg["og"]), "PNG", optimize=True)
    doc.close()
    shutil.rmtree(tmp, ignore_errors=True)

    kb = os.path.getsize(out_pdf) / 1024
    print(f"{cfg['pdf']}: {want} pages, A4, {kb:.0f} KB, fonts {fonts_in}")
    print(f"{cfg['preview']}.webp/.jpg: {prev.size}, {cfg['og']}: {og.size}")
    if kb > 1024:
        raise RuntimeError("PDF is over 1 MB")


if __name__ == "__main__":
    main()
