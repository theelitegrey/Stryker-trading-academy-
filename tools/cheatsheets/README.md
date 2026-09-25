# Cheat-sheet PDFs

    python3 tools/cheatsheets/build.py prop-firm

- `cheatsheet.html`: the A4 two-page template (layout only). Same look as the FVG &
  Order Block sheet, whose original generator lives in stryker-notes/social-posts/src.
- `<sheet>/content.json`: the copy for one sheet, taken word for word from the text
  content-developer APPROVED. Change copy there, never in the template.
- `fonts/`: static Space Grotesk / JetBrains Mono instances (OFL), see fonts/README.md.
- Output: the PDF in assets/downloads/, the page-1 preview (720 px webp/jpg + 480 px
  webp) and a 1200x630 OG image in assets/images/.

The build prints to PDF with headless Chrome (agent-browser + CDP), so text is
selectable and the fonts are embedded subsets; it fails on overflow, fallback fonts,
a wrong page count or size, missing text, or a file over 1 MB. One headless browser
at a time on the server.

After a rebuild: bump the build (the page's preview image is a new file only if the
name changes; the PDF and images are served from /assets/, which is cached for a
year, so change `content.json` "pdf"/"preview"/"og" names if the content changes
after release).
