# Hyperframes Composition Brief: Stryker Trading Academy

## Objective
Create a short launch-style brag video for Stryker Trading Academy.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 24.0 seconds

## Source Material
- Project root: /home/user/Stryker-trading-academy-
- Primary files read: index.html, assets/style.css, trade-journal.html, dashboard-user.html,
  assets/images/ (logo-emblem.png, logo-full.png, proofs/proof-1..14.jpg)
- Product name: Stryker Trading Academy
- Tagline / strongest claim: "Price leaves footprints. We teach you to read them before the crowd does."
- Key UI or visual moment to recreate: the trade journal dashboard (New trade form → Save trade →
  Cumulative P&L curve + stat tiles), and the hero stat row (42 chapters, 4.9/5)
- Copy that must appear verbatim:
  - Price leaves footprints.
  - Trade the way institutions actually move price.
  - ICT · Smart Money Technique · Market Structure
  - Chapter by chapter, basic to advanced.
  - 01 Candles, Charts & the Language of Price — Foundation · 6 lessons · 48 min · Free
  - 08 Market Structure & Break of Structure — Intermediate · 9 lessons · 1h 12m · Unlocks Ch.7
  - 27 SMT Divergence Across Correlated Pairs — Advanced · 11 lessons · 1h 40m · Unlocks Ch.26
  - Trade Journal & Analytics / Cumulative P&L / Save trade
  - Verified funded-account payouts.
  - Made for traders who read the tape.

## Creative Direction
- Tone preset: polished (cinematic lean on hook and outro)
- Creative direction: quiet, premium trading-desk film
- Interpretation: fewer scenes, longer holds, decisive motion, heavy display type against mono data,
  soft blur crossfades with one hard beat-locked cut into the proof scene.
- Angle: the site's thesis is the spine. Open on a chart doing exactly what the curriculum teaches
  (a liquidity sweep and reversal), then let the product speak in its own words: headline, chapter
  path, the journal doing its job, the payouts that back it up. No invented claims.
- Hook: candlestick chart draws in, sweeps the "EQUAL HIGHS" line, reverses; "Price leaves
  footprints." slams in.
- Outro / punchline: dragon emblem lands on the beat; "Stryker Trading Academy"; "Made for traders
  who read the tape." ; strykertrading.com
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign
  - Showing student names from the payout certificates at legible size

## Visual Identity
- Background: #0b0b0d (page), #050506 (deep), #131316 (card), #1e1e22 (raised), hairline #2c2c32
- Text: #eeeeee headings, #c9cdd3 body, #8b93a0 muted
- Accent: #03c988 mint (bright #4fe3ac, dim #027a54); teal #00adb5 secondary; bear #e5484d for
  chart context only
- Display font: Archivo Black (bundled; the site uses Archivo)
- Body font: JetBrains Mono (bundled; the site's own mono)
- Visual references from the project: hero stat row, chapter list cards, proof marquee, dragon emblem

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. Hook: the sweep — 3.27s — chart draws, sweep + reversal, "Price leaves footprints."
2. Reveal: the headline — 5.47s — hero headline with mint "move price", 42 / 4.9/5 count-ups, emblem glow
3. Curriculum — 4.37s — "Chapter by chapter, basic to advanced." three chapter cards on the beat grid
4. The journal at work — 4.36s — cursor clicks Save trade, curve extends, tiles tick on beats
5. Proof — 3.28s — "Verified funded-account payouts." over the certificate marquee
6. Outro — 3.25s — emblem lands on 22.37s, name, footer line, URL, music fade

## Audio
- Audio role: steady professional bed with sparse motion-matched accents
- Audio arc: bed from frame one; one soft hit on the hook; cards and a click through the middle;
  soft impact into proof; bell over the fade.
- Music: assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3
- Music treatment: 0.34 volume from 0, fade to 0 over the final 1.2s
- Music cue guidance: assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json
  (109.96 BPM). Strong cue locks: 8.74, 13.11, 17.47, 22.37. Beat grid for chapter cards:
  9.29 / 9.83 / 10.37. Beat grid for journal stat ticks: 15.29 / 15.84 / 16.38.
- Audio-reactive treatment: subtle; bass band breathes the radial glow behind the hero emblem and
  the outro emblem; overall level nudges chart glow. Data pre-extracted to assets/audio-data.json
  (30 fps, 16 bands). No waveform or bar visuals.
- Audio-coupled moments:
  - Scene 1 hook slam — impact/impactSoft_medium_001
  - Scene 3 first and last card — casino/card-slide-1
  - Scene 4 Save trade click — interface/click_003; final stat tick — interface/drop_001
  - Scene 5 cut — impact/impactSoft_medium_001
  - Scene 6 logo landing — impact/impactBell_heavy_000
- SFX selection guidance: all low HF-risk picks from sfx-analysis.md; volumes 0.55–0.75.
- SFX analysis guidance: ~/.claude/skills/brag/assets/sfx/sfx-analysis.md
- Exact SFX choice: chosen after the animation exists; listed above as the implemented set.
- Audio files: copied into `brag-output/composition/assets/`

## Hyperframes Instructions
Loaded hyperframes-core, hyperframes-animation (transitions: css-dissolve, css-push; rules:
svg-path-draw, counting-dynamic-scale), hyperframes-creative (house-style, video-composition,
typography, audio-reactive), hyperframes-cli (lint/check/render). /brag is its own workflow.

Requirements:
- Show at least one real UI, copy, or visual element from the source project.
- Keep all text readable in the final render.
- Keep the video within 15-25 seconds.
- Include the planned music/SFX layer.
- Treat cue metadata as optional timing hints; readability first.
- Use local assets only.
- Run `hyperframes check` before render.
