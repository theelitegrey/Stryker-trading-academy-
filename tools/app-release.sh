#!/usr/bin/env bash
# Release a new app shell and point /app-version.json at it. Full guide: docs/app-updates.md
#
#   tools/app-release.sh android <versionName> "<note>" [--min <versionCode>]   e.g. android 2.1.1 "Faster chart load"
#   tools/app-release.sh windows <version>     "<note>" [--min <version>]       e.g. windows 1.1.1 "Fix tray icon"
#   tools/app-release.sh windows --publish <version>   (after the bump is on main: tag it, GitHub Actions builds + publishes)
#
# Run from the site repo root on a branch. It edits files and builds; it never commits, pushes main or deploys.
# The update reaches members when the branch is merged and the site deploys (Android: APK + manifest together;
# Windows: the desktop-v<ver> GitHub release, which electron-updater picks up, plus the manifest notes).
#
# Android also needs ANDROID_SRC = a checkout of the Android branch (folder that contains android/native).
# Secrets are read from files and never printed.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
REPO=theelitegrey/Stryker-trading-academy-
CERT=3cf2a0b6532069b5                      # SHA-256 prefix of the signing cert every installed APK has; must never change
GSJ=/root/.hermes/profiles/chief-of-staff/secrets/android/google-services.json
die() { echo "app-release: $*" >&2; exit 1; }

# manifest <platform> <version> <note> <min|''> [versionCode]
manifest() {
  python3 - "$@" <<'PY'
import json, sys
plat, ver, note, mn = sys.argv[1:5]
code = int(sys.argv[5]) if len(sys.argv) > 5 else None
p = 'app-version.json'
m = json.load(open(p))
e = m[plat]
if plat == 'android':
    e.update(versionCode=code, versionName=ver)
    if mn: e['minVersionCode'] = int(mn)
    assert e['minVersionCode'] <= code, 'minVersionCode above the new versionCode'
else:
    e['version'] = ver
    if mn: e['minVersion'] = mn
e['notes'] = [note]
open(p, 'w').write(json.dumps(m, indent=2) + '\n')
print(json.dumps({plat: e}, indent=2))
PY
}

PLAT=${1:-}; shift || true
case "$PLAT" in
android)
  VER=${1:?versionName}; NOTE=${2:?note}; MIN=''
  [ "${3:-}" = --min ] && MIN=${4:?min versionCode}
  [[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "versionName must look like 2.1.0"
  SRC=${ANDROID_SRC:?set ANDROID_SRC to the Android branch checkout}/android/native
  G=$SRC/app/build.gradle.kts
  OLD=$(grep -oP 'versionCode = \K[0-9]+' "$G"); CODE=$((OLD + 1))
  LIVE=$(python3 -c "import json;print(json.load(open('app-version.json'))['android']['versionCode'])")
  [ "$CODE" -gt "$LIVE" ] || CODE=$((LIVE + 1))
  sed -i -E "s/versionCode = [0-9]+/versionCode = $CODE/; s/versionName = \"[^\"]+\"/versionName = \"$VER\"/" "$G"
  echo "android: versionCode $OLD -> $CODE, versionName $VER (commit $G on the Android branch)"
  cp "$GSJ" "$SRC/app/google-services.json"
  trap 'rm -f "$SRC/app/google-services.json"' EXIT
  [ -f "$SRC/local.properties" ] || echo "sdk.dir=/root/android-sdk" > "$SRC/local.properties"
  ( cd "$SRC" && JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ANDROID_HOME=/root/android-sdk ./gradlew --no-daemon -q assembleDebug )
  APK=$(ls -t "$SRC"/app/build/outputs/apk/debug/*.apk | head -1)
  N=$(unzip -p "$APK" resources.arsc | strings | grep -c -E 'google_app_id|gcm_defaultSenderId' || true)
  [ "$N" -gt 0 ] || die "APK has no Firebase config (sign-in would be off)"
  /root/android-sdk/build-tools/36.1.0/apksigner verify --print-certs "$APK" | grep -q "SHA-256 digest: $CERT" || die "APK not signed with cert $CERT: it would not install over the old app"
  AAPT=$(/root/android-sdk/build-tools/36.1.0/aapt2 dump badging "$APK" | head -1)
  echo "$AAPT" | grep -q "versionCode='$CODE'" || die "built APK has the wrong versionCode: $AAPT"
  mkdir -p /root/projects/stryker-notes/android-builds
  cp "$APK" "/root/projects/stryker-notes/android-builds/tradezoro-v$CODE.apk"
  cp "$APK" downloads/tradezoro-android-beta.apk
  manifest android "$VER" "$NOTE" "$MIN" "$CODE"
  echo "Done. Commit downloads/tradezoro-android-beta.apk + app-version.json; installed apps show the banner after the site deploys."
  ;;
windows)
  if [ "${1:-}" = --publish ]; then
    VER=${2:?version}
    git fetch -q origin main
    [ "$(git show origin/main:desktop/package.json | python3 -c 'import json,sys;print(json.load(sys.stdin)["version"])')" = "$VER" ] || die "origin/main desktop/package.json is not $VER yet: merge the bump first"
    git tag "desktop-v$VER" origin/main && git push origin "desktop-v$VER"
    echo "Tag pushed: .github/workflows/desktop-release.yml builds on windows-latest and publishes release desktop-v$VER (latest.yml attached)."
    echo "Watch: gh run list -R $REPO -w desktop-release.yml -L 1"
    exit 0
  fi
  VER=${1:?version}; NOTE=${2:?note}; MIN=''
  [ "${3:-}" = --min ] && MIN=${4:?min version}
  [[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must look like 1.1.0"
  ( cd desktop && npm version "$VER" --no-git-tag-version --allow-same-version >/dev/null )
  echo "windows: desktop/package.json -> $VER"
  manifest windows "$VER" "$NOTE" "$MIN"
  echo "Next: commit desktop/package.json, desktop/package-lock.json, app-version.json; merge; then: tools/app-release.sh windows --publish $VER"
  ;;
*) sed -n 2,14p "$0"; exit 1 ;;
esac
