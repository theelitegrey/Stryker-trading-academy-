# Features mega-menu (preview only)

Owner ask: hovering "Features" in the public nav opens a large visual menu with every feature. Clicking "Features" still goes to /features. This branch has three variants for the Owner to pick from. Nothing here is live: no existing page is edited.

## Files
- `assets/nav-features.js`: holds the one data array (`FEATURES`: name, url, line, thumb, icon). It finds the "Features" link in `.nav-links`, injects the panel and wires the events. The variant comes from `<html data-navfx="a|b|c">`, or from `data-navfx` on the script tag; the default is `a`.
- `assets/nav-features.css`: styles for all three variants plus the burger accordion. It uses only existing theme variables, so day and night both work.
- `assets/images/navfx/`: 22 WebP thumbs (360w and 720w for all 11 features), 185 KB in total, cut from real captures already on the site (Live Sessions from assets/images/live-sessions/hero-1440.webp).
- `nav-preview-a.html`, `nav-preview-b.html`, `nav-preview-c.html`: copies of index.html, marked noindex,nofollow with no canonical tag, that load the shared files. They are not in the sitemap.

## Variants
- A, Mega panel: a featured GEX tile on the left and a 3-column grid of icon, name and one line. A bottom strip has "See all features" (/features) and "Start learning" (signup, the same target as the homepage nav CTA).
- B, Showcase: a feature list on the left. The large pane on the right crossfades to the hovered or focused feature's real screenshot, with its line and an "Explore" button.
- C, Bento: GEX is the big hero tile; Journal and Models are wide tiles; the rest are small tiles. Each tile has a real capture, a gradient and the name. Tiles lift and tilt slightly on hover, with the mint glow line from the site's card accent.
- Mobile and tablet (<=900px): in the burger menu, a separate chevron button expands all 11 features, while the "Features" label still links to /features. A shows a 2-column icon+name grid, B shows rows with thumb, name and line, and C shows a mini 2-column bento.

## Where each line comes from (copied, not written)
| # | Feature | Link now | Line source |
|---|---|---|---|
| 1 | GEX | /features/gex | features.html hub card (main) |
| 2 | Smart Money Desk | /features/smart-money-desk | features.html hub card (main) |
| 3 | Curriculum | /features/curriculum | features.html hub card (main) |
| 4 | Global Monitor | /features/global-monitor | features.html hub card (main) |
| 5 | Trade Journal | /features/journal | features.html hub card (main) |
| 6 | Trading Models | /features/models | features.html hub card (main) |
| 7 | Private Indicators | /features/indicators | features.html hub card (main) |
| 8 | Backtesting | /features/backtesting | features.html hub card on hermes/features-release-369 (main's card says "get honest stats"; I used the 369 wording) |
| 9 | Community | /features/community | features.html hub card on hermes/features-release-369 ("Community & Tools" card) |
| 10 | Charts | /features/charts | features.html hub card (main, "Charts Workspace") |
| 11 | Live Sessions | /features/live-sessions | features.html hub card (main) |

Thumb sources: gex-real/chart-nq-5m-plot, smart-money-desk/overview, curriculum/hero-1440, global-monitor/hero-1440, journal/calendar, models/hero-1440, indicators/hero-1440 (all on main). Backtesting/hero and community/hero-1440 come from hermes/features-release-369; charts/hero comes from hermes/features-batch2-e1. Live Sessions: live-sessions/hero-1440 (main).

When a page goes live, change its `url` in the array. That is a one-line edit.

## Ship plan
- 37 HTML templates on main carry `.nav-links`: index, about, contact, cheat-sheet, prop-firm-cheat-sheet, cookies, gdpr, privacy, refund-policy, terms, support, learn.html plus 10 learn-*, features.html, 9 old features-*.html, and 7 features/*.html.
- All 37 already load `assets/main.js`, `assets/theme.js`, `assets/auth.js`, `assets/toast.js` and `assets/focus-mode.js`. None of them loads a nav-only include today.
- Simplest safe path: add two lines to each of the 37 pages: `<link rel="stylesheet" href="/assets/nav-features.css?v=N">` after style.css, and `<script src="/assets/nav-features.js?v=N" defer></script>` before main.js. A short script can apply them, with check.py extended to require both on every page with `.nav-links`.
- Zero-edit alternative: main.js (loaded on all 37) appends the two tags itself when it finds `.nav-links`. That is one file, but the CSS arrives after first paint. This is invisible because the panel only appears on hover, but it adds a JS dependency to the nav.
- The final variant is set by one `data-navfx` value in the JS default. Previews are deleted at ship time.

## Known limits
- JS is 12.0 KB unminified with comments: 2.2 KB data and about 9.8 KB logic. That is over the 6 KB target because one file carries three variants plus the burger accordion. Shipping a single variant and stripping comments brings the logic to about 5-6 KB.
- The test blocks third-party analytics. Firebase loads normally.


## Update 2026-10-04 (web-temp-5)
- Rebased onto main build 375; previews regenerated from the current index.html (new hero, cards, string, dragon), still self-contained and noindex.
- All 11 hub features now link to their live /features/<name> pages (the hub on main lists exactly these 11; Backtesting, Community, Charts and Live Sessions are live). The Backtesting line now matches main's hub card verbatim ("practise with simulated orders").
- Scrolling regions inside the panel and the burger list use the thin rounded scrollbar style (Owner rule).
