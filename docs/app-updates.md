# App updates (Android + Windows)

The site inside both apps updates with every site deploy. Only the app SHELL (the installed Android APK, the
Windows .exe) needs a release. This page is how a shell release reaches members, and how they are told.

## The manifest: `/app-version.json`

One public file at the site root, served with `Cache-Control: no-cache, no-store` (`_headers`). Both apps poll it.
This format is the contract between the site and both apps; change it only in all three places together.

```json
{
  "android": {
    "versionCode": 10,
    "versionName": "2.1.0",
    "url": "/downloads/tradezoro-android-beta.apk",
    "notes": ["One line shown under the banner title."],
    "minVersionCode": 1
  },
  "windows": {
    "version": "1.1.0",
    "url": "/dl/TradeZoro-Setup.exe",
    "notes": ["One line shown under the banner title."],
    "minVersion": "1.0.0"
  }
}
```

- `versionCode` / `version`: the newest released shell. An installed app with a lower value shows the banner.
- `notes`: the first line is shown in the banner. Keep it short and plain; no result, win-rate or price claims.
- `minVersionCode` / `minVersion`: anything below this gets a blocking "Please update to keep using TradeZoro"
  screen with only an Update button. Raise it only when old shells really break (e.g. an API they call is gone).
- `url`: relative to https://tradezoro.com. Android downloads this APK in the app; Windows opens it in the browser
  only from the blocking screen when its own updater has nothing downloaded.

## What members see

Android (native app, android/native on the Android branch):
- Checks on start, on resume (at most once an hour) and every 6 hours.
- `versionCode` newer than installed: a banner at the top (dark card, mint edge, X) "Update available · v<name>",
  the first note, and an Update pill. Update downloads the APK in the app with a progress bar, checks it, and opens
  the Android installer. If "Install unknown apps" is off for TradeZoro it opens that setting with a one-line hint.
- X hides the banner until the next `versionCode`.
- Installed below `minVersionCode`: blocking full-screen update, no X.

Windows (desktop/):
- electron-updater checks GitHub Releases (`desktop-v*`) on start and every 4 hours and downloads in the background.
  The app also reads `/app-version.json` at the same times for the notes and `minVersion`.
- When the download is ready, every app window shows a banner at the top: "Update ready · v<ver>", the first note,
  a "Restart to update" pill and an X. X hides it until the next launch. If the app is hidden in the tray, a quiet
  Windows toast says the same. The update also installs by itself the next time the app quits.
- Installed below `minVersion`: blocking full-screen screen ("Restart to update" once downloaded, else a download link).
- The portable .exe never self-updates (it still gets the blocking screen if it is below `minVersion`).
- Code: `desktop/src/updates.js` (rules, unit-tested in `desktop/test/updates.test.js`), `desktop/src/main.js`
  (checks + IPC), `desktop/src/preload.js` (the banner, in a shadow root so site CSS cannot reach it).
  Electron test with a fake download: `cd desktop && xvfb-run -a node test/update-banner.js <shots-dir>`.

## Releasing: `tools/app-release.sh`

The script edits files and builds. It never commits, merges, pushes main or deploys.

Android:

    ANDROID_SRC=/path/to/android-branch-checkout tools/app-release.sh android 2.1.1 "Faster chart load"

1. Bumps `versionCode` (+1, and always above the manifest) and `versionName` in `android/native/app/build.gradle.kts`.
2. Builds the debug APK with the Firebase config copied in (and removed after), checks it has the Firebase strings,
   is signed with cert `3cf2a0b6532069b5…` (the only key that installs over existing installs) and has the new
   versionCode.
3. Copies it to `downloads/tradezoro-android-beta.apk` and `stryker-notes/android-builds/tradezoro-v<code>.apk`,
   and writes the android entry of `app-version.json`.
4. You commit the gradle bump on the Android branch, and the APK + manifest on a site branch. When that site branch
   deploys, every installed app (2.1.0 or newer) shows the banner.

Windows:

    tools/app-release.sh windows 1.1.1 "Fix tray icon"        # bump desktop/package.json + manifest
    # commit, merge to main, then:
    tools/app-release.sh windows --publish 1.1.1              # tag desktop-v1.1.1 on origin/main and push the tag

The tag starts `.github/workflows/desktop-release.yml` on `windows-latest`: tests, builds the NSIS installer and
portable exe (unsigned for now), checks `latest.yml`, and publishes release `desktop-v1.1.1` as Latest with
`latest.yml` attached. Installed apps find it within 4 hours (or at the next start). Order matters a little: if the
manifest goes live before the release, nothing breaks (the banner waits for a real download), so merging first and
tagging second is fine.

To build without publishing: Actions > Desktop release > Run workflow (`draft` = true). Members only update from a
published release: `gh release edit desktop-vX.Y.Z --draft=false --latest`.

## First install of a banner build

Shells released before this feature (Android 2.0.3 and older, Windows 1.0.1 and older) have no banner. Android
members must install 2.1.0 by hand once (download page). Windows 1.0.1 already auto-updates silently, so it picks
up 1.1.0 on its own and shows the banner from then on.
