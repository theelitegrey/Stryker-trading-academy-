#!/bin/bash
# Build the sideloaded debug APK with the Firebase config and check it before it goes anywhere.
#   android/native/build-apk.sh <out.apk>
# Needs: GOOGLE_SERVICES (path to google-services.json, never committed) and the shared debug key in
# ~/.android/debug.keystore (cert SHA-256 3cf2a0b6532069b5...; another key = updates will not install over the old app).
# Prints "versionCode versionName sizeBytes" on the last line for the site manifest (/app-version.json, docs/app-updates.md).
set -euo pipefail
OUT=${1:?usage: build-apk.sh <out.apk>}
GS=${GOOGLE_SERVICES:-/root/.hermes/profiles/chief-of-staff/secrets/android/google-services.json}
CERT=3cf2a0b6532069b5
cd "$(dirname "$0")"
export JAVA_HOME=${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64} ANDROID_HOME=${ANDROID_HOME:-/root/android-sdk}
[ -f local.properties ] || echo "sdk.dir=$ANDROID_HOME" > local.properties
cp "$GS" app/google-services.json
trap 'rm -f app/google-services.json' EXIT
./gradlew --no-daemon -q assembleDebug
A=app/build/outputs/apk/debug/app-debug.apk
N=$(unzip -p "$A" resources.arsc | strings | grep -c -E 'google_app_id|gcm_defaultSenderId' || true)
[ "$N" -gt 0 ] || { echo "NO FIREBASE CONFIG IN APK" >&2; exit 1; }
AS=$(ls "$ANDROID_HOME"/build-tools/*/apksigner | tail -1)
"$AS" verify --print-certs "$A" | grep -q "SHA-256 digest: $CERT" || { echo "WRONG SIGNING CERT (want $CERT)" >&2; exit 1; }
AAPT=$(ls "$ANDROID_HOME"/build-tools/*/aapt | tail -1)
BADGE=$("$AAPT" dump badging "$A" | head -1)
CODE=$(sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" <<<"$BADGE"); NAME=$(sed -n "s/.*versionName='\([^']*\)'.*/\1/p" <<<"$BADGE")
cp "$A" "$OUT"
echo "firebase strings: $N, cert $CERT ok"
echo "$CODE $NAME $(stat -c %s "$OUT")"
