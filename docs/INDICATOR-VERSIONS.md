# Indicator versions

Owner order, 13 Nov 2026: indicators have versions. A chart never changes on its own when we ship. The member gets an
update button and chooses. Every indicator page shows a changelog.

Owner order, 15 Nov 2026 ("i want it on all indicators"): EVERY indicator has a version.
- TradeZoro natives (`b:`), drawing-tool rows (`p:`) and built-in Pine scripts (`x:`) are all in the manifest.
  Ones with no history are `v1.0` on their first-release date (seeded by `tools/indver-seed.js`).
- Settings window of every indicator on a chart: a small muted `vX.Y` tag after the title, and a first "Version" row.
  It is read-only ("v1.0 · latest") when one version exists, and a picker when there are several.
- Indicators window: the (i) details of every native / built-in start with "vX.Y · date · latest". Community rows show their published `vN`.
- Built-in Pine scripts are pinnable like natives (below).
- Community Pine scripts and Script Library Zscripts: when the author published a newer version than the one on the chart, the same
  update button and popup show the author's version notes. Update loads the new source and keeps the inputs. It is never automatic.

## Files

| File | Role |
|------|------|
| `assets/indicator-versions.js` | THE manifest (`VERSIONS`) plus the helpers: `below`, `since`, `verOf`, `upgradePatch`, `withVersion`. It has no imports. |
| `assets/chart-ind-versions.js` | Chart side. It wraps `Core.registerNativeIndicator` so every pinnable native gets the Version setting. It also draws the legend update button and popup, and keeps the version on "Reset defaults". |
| `assets/vela-chart.js` | Calls `installIndVersions(Core)` before any native registers, and `mountIndVersions(ws)` once the workspace exists. |
| `tools/indver-bump.js` | Ships a new version in one command (below). For a built-in Pine script it also keeps the old source. |
| `tools/indver-seed.js` | Adds a v1.0 entry for every key in `first-release.json` that has none. It is idempotent; `--check` only checks. |
| `assets/pine-versions/<id>/<v>.pine` | Older sources of built-in Pine scripts that charts can stay on. The latest is always `assets/pine/<id>.pine`. |
| `assets/chart-pine-builtins.js` | `builtinSource(id, v)` loads the latest or a kept version; `builtinOfText(src)` returns `{ id, v }`. |
| `assets/chart-pine.js` | A saved built-in is `{ builtin: id, bv: '<version>' }`. A ref with no `bv` (saved before 15 Nov) = the entry's `base`. |
| `assets/chart-zscript.js` | A Script Library Zscript is saved with `lib: { sid, v }` (the published version it runs). |
| `tools/gen-indicator-pages.js` | Builds the "Changelog" section and the `vX.Y` in the page header. It reads `VERSIONS` as data. Indicators that are not in the manifest show v1.0 on their first-release date (`tools/indicator-pages/first-release.json`). |
| `tools/tests/indicator-versions.test.mjs` | Unit test. It covers the manifest rules, version maths, migrations and a fake "new version ships" manifest. |
| `tools/tests/indicator-versions-browser.js` | Browser test. It runs the real chart with a test manifest (`window.__stkIndVerTest`). |

## How it works

- The version is an ordinary setting with key `ver`, shown first in the indicator's settings as "Version".
  - It rides the normal settings, so the saved session, layouts, templates and shared charts keep it with no extra code.
- The setting's default is the entry's `base`. The chart only saves settings that differ from their default, so:
  - an instance on `base` saves nothing;
  - a chart saved before versions existed loads as `base`, which is exactly how it looked.
- A new add starts on the latest version, because the wrapped `defaultInputs()` returns the latest.
- If an instance is below the latest version, its legend row shows a small up-arrow button. Hovering (mouse) or tapping (touch) opens:
  - "Update available: vX";
  - what is new since the instance's version;
  - "Update", which sets `ver` to the latest, keeps every other setting, and runs each passed version's `migrate`;
  - "Not now", which hides the button for that indicator until a newer version ships (localStorage `stk_ind_ver_dismissed`).
- `all: true` versions are changes that reached every chart, such as bug fixes or new options that do nothing until used.
  - They show in the changelog only.
  - They are not in the Version list and get no update button.

## Ship a new version: one command

```
node tools/indver-bump.js <key> <v> "<note>" ["<note 2>" ...] [--all] [--date YYYY-MM-DD]
```

- It appends the version line to the key's entry and checks the copy rules, the order and the date.
- `--all` = a fix that reaches every chart: changelog only, no pin, no update button.
- For a built-in Pine script (`x:<id>`, without `--all`), it also:
  - copies the current source to `assets/pine-versions/<id>/<old v>.pine`. It takes git HEAD when you have already edited the file;
  - marks that old version `src: true`.
- Then put the new source in `assets/pine/<id>.pine` (if not done yet). Run `node tools/gen-indicator-pages.js` and bump the build.
- Charts saved on the old version keep the old source and get the update button.
- New adds get the new one.
- Update swaps the source in place (`updateCode`) and keeps every input the new source still declares.
- The Version picker in Settings goes back and forth.

A new indicator: add its key and ship date to `tools/indicator-pages/first-release.json`, then run `node tools/indver-seed.js`.

## Ship a new version of a native indicator (the usual case)

1. Add one line to its entry in `VERSIONS`, after the last version:
   ```js
   { v: '1.2', date: '2026-11-20', notes: ['Plain English, member-facing. No vendor or rival names, no internal names.'] }
   ```
   Keep `base` as it is. Never change a shipped `base`. The unit test freezes the bases.
2. In the indicator, gate the old behaviour on the instance's version:
   ```js
   import { below, since } from './indicator-versions.js?v=NNN';
   const old = below(I, '1.2');            // I = the instance inputs; true only for instances pinned below 1.2
   const rows = old ? oldWay() : newWay();
   ```
   If a setting exists only from 1.2 on, add `when: since('b:<type>', '1.2')` to it, so that older versions hide it.
3. If you renamed a setting, add `migrate: (i) => (i.oldKey != null ? { newKey: i.oldKey } : {})` to that version line.
   - New settings need nothing: they get their defaults.
4. If the change is a pure fix that nobody would want to undo, add `all: true`. No gate is needed.
5. Run `node tools/gen-indicator-pages.js` and `node tools/tests/indicator-versions.test.mjs`.

A first versioned change to an indicator that is not in the manifest yet:
- Add its entry with `base: '1.0'` and two versions: `1.0` (its first release) and the new one.
- Add the base to `BASES` in the unit test.

`base` stays `'1.0'` because charts saved before the change have no `ver` and must keep the old look.

## Pine / Zscript built-ins

- A built-in Pine version is pickable only when its source is kept (`src: true` + the file), or when it is the latest.
  - `all: true` lines from before 15 Nov (e.g. HTF PO3 Lens 1.1) stay changelog-only.
  - The unit test checks that every `src: true` has its file.
- The Pine editor examples (EMA cross, Session VWAP, Previous day high/low) are `x:` keys too and show v1.0. They are matched by exact source.
- Library scripts use the library's own whole-number versions (`v1`, `v2`). They are not in the manifest.
  - Community Pine: `StrykerPineLibrary.get(id).version`.
  - Script Library Zscript: `ZSLib.versions(sid)`, which reads the `versions/` notes.
  - Protected Zscripts run the author's latest sealed build on every load, so they show that version and get no button.

## Tests

- `node tools/tests/indicator-versions.test.mjs`
- `node tools/tests/chart-dev-server.mjs 8031 &` then `CHART_BASE=http://127.0.0.1:8031 node tools/tests/indicator-versions-browser.js <dir>`
  - Add `SHOTS=1` for screenshots.
