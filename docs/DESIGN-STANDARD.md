# TradeZoro Design Standard (MANDATORY, Owner order 2026-10-30)

Binding on every page, feature and component: website, charts, admin, emails, social graphics UI.

## Owner's directive (verbatim)
Mandatory UI/UX Design Directives
Always follow Apple Human Interface Guidelines and Google Material Design 3 principles when designing or developing any page, feature, or component.
Maintain professional typography, font sizes, weights, and hierarchy.
Use consistent color schemes, contrast, spacing, padding, and alignment.
Follow proper component dimensions, heights, widths, border radii, and proportions.
Ensure clean, premium, modern, and visually balanced interfaces.
Use consistent buttons, cards, forms, navigation, icons, and animations.
Ensure responsive layouts, accessibility, and polished light/dark modes.
Preserve brand identity and maintain a unified design system.
Mandatory: Before and after implementation, verify every design against these standards. Visually inspect the rendered UI, identify inconsistencies, and fix them before considering the task complete.
Never use arbitrary styling, inconsistent dimensions, or generic AI-looking designs.

## The system (use these values; never invent one-off ones)
- Font: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Roboto, "Segoe UI", system-ui, sans-serif`. Numbers in tables/prices: `font-variant-numeric: tabular-nums`.
- Type scale (px / line-height / weight): Large title 28/34/700 · Title 22/28/700 · Headline 17/22/600 · Body 15/22/400 (16 in inputs so iOS never zooms) · Callout 14/20/400 · Subhead/label 13/18/500 · Footnote/hint 12/16/400 · Caption 11/13/400. Max 3 sizes and 2 weights per component.
- Spacing: 4-pt grid, steps 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48. Screen side padding 16 (phone), 24 (tablet), 32 (desktop). Label→field 8, hint under field 6, between fields 16, between groups 24–32.
- Sizes: tap targets ≥ 44×44 (Apple) / 48 dp (Material). Buttons: 48 primary, 40 secondary, 32 compact. Inputs 48–52. List rows 52–60 (one line 48). Top bar 56 (phone) / 64 (desktop). Icons 20 or 24, stroke 1.75–2, one icon family.
- Radii: 8 small (chips, inputs on desktop) · 12 controls (inputs/buttons) · 16 cards/sheets · 20–28 bottom sheets top corners · full for pills. Same element type = same radius everywhere.
- Colour (dark): background #050506, surface #0b0b0d, raised #131316, hairline rgba(255,255,255,0.08); text primary rgba(255,255,255,0.92), secondary 0.64, tertiary 0.44; brand mint #03c988 (hover #4fe3ac), teal #00adb5 accent, amber for warnings, red only for errors/losses. One primary (mint, filled) action per view; others tonal/outline/text. Light mode: white/#f5f5f7 surfaces, #1d1d1f text, same brand colours with AA contrast.
- Contrast: WCAG AA (4.5:1 body, 3:1 large text and UI). Focus ring visible (2px mint, 2px offset). Respect prefers-reduced-motion and prefers-color-scheme where the page supports both themes.
- Components: bottom sheets with grabber + title left + round × (phone), popovers/dialogs on desktop; segmented controls instead of rows of pills; list rows (icon · title · subtitle · chevron) instead of stacks of big buttons; cards = surface + hairline + 16 radius + 16 padding, no heavy shadows/glows/gradients.
- Motion: 150–250 ms, standard ease (cubic-bezier(.2,0,0,1)); sheets slide 300 ms; nothing bounces or loops for attention.
- Layout: phone first (390 and 412 wide), then 768 and 1440. No horizontal scroll, no text under 11px, no clipped labels, safe-area insets respected. Banners never push content; status notices are small and placed low (bottom pill or inline line).
- Brand: TradeZoro logo, mint/teal on black, names (ZoroCharts, GEX+, Replay One, JournalX, ZoroTide, Creator Hub). Reuse the existing tokens (e.g. the Connect sheet's `--rz-*` tokens) rather than new hex values.
- Banned ("generic AI look"): emoji as icons, neon glows, rainbow gradients, glassy cards everywhere, random border colours, ALL-CAPS paragraphs, centered long text, three different button styles in one view, mixed radii, shouting warning boxes, filler copy.

## Mandatory check: before AND after (no ship without it)
1. BEFORE: screenshot the current screen at 390, 412 and 1440 (and light mode if the page has it); list what breaks this standard.
2. Build with the system values above (tokens/CSS variables; no magic numbers).
3. AFTER: screenshot the same states (empty, filled, error, loading, signed-out/in) at the same sizes; vision-check each against this list: type scale, spacing grid, tap targets, radii, colours/contrast, alignment, one primary action, no overflow/clipping, focus ring, light/dark.
4. Fix every issue found, re-shoot, then ship. Put a "DESIGN CHECK" section in the report: before/after shot paths + the checklist with pass/fail per line.
5. Menu/drawer changes (app-nav.js, dash-nav.js, More sheet, any sidebar control): real touch test at 390 (tap every control with tools/tests/drawer-touch-browser.js: in-place controls keep the menu open, real links close it), not only screenshots. check.py runs it automatically when those files change.
Reviewers (Senior Website Engineer / Head of Website Development / CoS) reject work without the DESIGN CHECK section.
