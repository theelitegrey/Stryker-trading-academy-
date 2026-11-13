# Indicator versions

Owner order, 13 Nov 2026: indicators have versions. A chart never changes on its own when we ship. The member gets an
update button and chooses. Every indicator page shows a changelog.

## Files

| File | Role |
|------|------|
| `assets/indicator-versions.js` | THE manifest (`VERSIONS`) plus the helpers: `below`, `since`, `verOf`, `upgradePatch`, `withVersion`. It has no imports. |
| `assets/chart-ind-versions.js` | Chart side. It wraps `Core.registerNativeIndicator` so every pinnable native gets the Version setting. It also draws the legend update button and popup, and keeps the version on "Reset defaults". |
| `assets/vela-chart.js` | Calls `installIndVersions(Core)` before any native registers, and `mountIndVersions(ws)` once the workspace exists. |
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

- Their entries are changelog-only (`all: true`) today. The unit test enforces this.
- To make a Pine version pickable, keep the old source next to the new one, e.g. `assets/pine/<id>@1.0.pine`.
  - The script runner then has to pick the source by the instance's `ver`.
  - The runner is not wired for this yet. Do it the first time a Pine change is a visible behaviour change worth going back to.

## Tests

- `node tools/tests/indicator-versions.test.mjs`
- `node tools/tests/chart-dev-server.mjs 8031 &` then `CHART_BASE=http://127.0.0.1:8031 node tools/tests/indicator-versions-browser.js <dir>`
  - Add `SHOTS=1` for screenshots.
