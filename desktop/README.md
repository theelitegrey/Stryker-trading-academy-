# TradeZoro for Windows (desktop/)

An Electron app that opens https://tradezoro.com in its own secure window. The site is loaded live, so every
site deploy is in the app the same day; only the app shell (this folder) needs a release.

## What it adds over a browser tab
- Pop-out windows: Ctrl+Shift+N opens a new chart window, Ctrl+Shift+P pops out the current page (keeps
  `?layout=` / `?openlayout=` links). Links a TradeZoro page opens in a new tab also become app windows.
  Each window remembers its size, position and always-on-top (`<userData>/window-state.json`); open
  chart windows come back on the next start. Off-screen positions (an unplugged monitor) are ignored.
- Always on top per window: Ctrl+Shift+T or View > Always on top.
- Native Windows notifications: every TradeZoro window listens to the member's own `notifications`
  collection (the same documents that drive the bell and web push, same query the site uses, so the live
  Firestore rules allow it) and shows new unread ones as Windows toasts. Closing the main window hides it to
  the tray so alerts keep arriving. Electron has no web-push service, so the site's FCM push does not fire
  in the app; this listener replaces it while the app runs.
- Tray icon (Open, New chart window, Quit), single instance, Ctrl+R reload, F11 full screen.
- `backgroundThrottling: false` on every window: charts keep updating when covered or on another monitor.
- Auto-update (installed version only): electron-updater checks GitHub Releases (`desktop-v*` tags) on start
  and every 4 hours, downloads in the background, installs when the app quits. It never restarts by itself:
  during futures market hours (Sun 18:00 to Fri 17:00 New York time) it only shows a quiet note; outside them
  it asks "Restart now / Later". The tray gets "Restart to update". The portable .exe does not self-update.

## Security
- Every window: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no `<webview>`.
- `src/policy.js` decides where each URL goes (unit tests: `test/policy.test.js`):
  - `https://tradezoro.com` (and www) pages load in app windows and only they get `src/preload.js`
    (`window.tzDesktop.notify / popOut / toggleAlwaysOnTop`; IPC handlers re-check the sender's URL).
  - Razorpay checkout (and Firebase's own auth pages) open as sandboxed child popups without the preload.
  - Google sign-in does NOT run in the app (Google refuses OAuth in embedded browsers: "This browser or app may
    not be secure"). See "Google sign-in" below.
  - Broker sign-in pages the site sends members to (Alpaca, tastytrade, cTrader, Upstox, Fyers, Schwab)
    may load in the app window, because they redirect back to tradezoro.com/connect/... with the code.
  - Any other http(s) or mailto link opens in the normal browser. file:, javascript:, data: and custom
    schemes are blocked.
- Permissions are granted only to TradeZoro pages, and only notifications, full screen, clipboard write
  and local-network access (for the Data Bridge on 127.0.0.1).
- The user agent drops the "Electron/x" token (some sites refuse embedded browsers that announce themselves).

## Google sign-in (system browser, since 1.0.1)
`src/handoff.js` (pure helpers, `test/handoff.test.js`) + `main.js` + `functions/api/desktop/[[path]].js` (server,
`tools/tests/desktop-handoff.test.mjs`) + `desktop-login.html` / `assets/desktop-login.js`:
1. The login page (assets/auth.js, rithmic-review.js) sees `window.tzDesktop.googleSignIn` and calls it instead of
   `signInWithPopup`. Main makes a secret verifier (32 random bytes), starts a one-sign-in HTTP listener on
   127.0.0.1:<random port> and opens `https://tradezoro.com/desktop-login?nonce=<sha256(verifier)>&port=<port>` in
   the default browser. The app page shows "We opened your web browser" with Cancel.
2. In the browser the member signs in with Google as on the site (same account picker; a separate in-memory
   Firebase app, so the browser's own TradeZoro session is untouched). `POST /api/desktop/handoff` (ID token from a
   sign-in in the last 10 min + nonce, Origin tradezoro.com only) returns a one-time code (120 s, single use,
   stored hashed in KV, bound to the nonce).
3. The page goes to `http://127.0.0.1:<port>/done?code=..` (Host must be exactly 127.0.0.1:<port>); if the browser
   can't reach it, a button opens `tradezoro://auth?code=..` (registered protocol; the second instance passes it on).
4. Main calls `POST /api/desktop/handoff/redeem {code, verifier}` -> Firebase custom token (uid only), resolves it to
   the page that asked, and the page runs `signInWithCustomToken`. The browser tab says "You're signed in, you can
   close this tab". Wrong verifier: 403 and the code is burnt. The listener closes after use, cancel or 5 minutes.
Email/password and passkeys still sign in inside the app as before. Apps older than 1.0.1 get "Google sign-in
needs the newest TradeZoro app" (Help > Check for updates).

## Build
    cd desktop
    npm ci
    npm test                                     # URL allowlist + market-hours unit tests
    npm run dist:win                             # dist/TradeZoro-Setup.exe + dist/TradeZoro-Portable.exe
    npx electron-builder --linux dir --x64       # Linux build, used for the smoke test
    xvfb-run -a node test/smoke.js               # starts the app, checks Google handoff, Razorpay popup, pop-out...

On Linux the Windows build needs wine (`wine64` + `wine32:i386`). The release build runs on GitHub
(`.github/workflows/desktop-release.yml`, tag `desktop-vX.Y.Z`; the version comes from the tag). A tag push
publishes at once; Run workflow (workflow_dispatch) builds a DRAFT by default. Installed apps only update from a
published release: `gh release edit desktop-vX.Y.Z --draft=false --latest`. The /dl/ download (functions/dl) caches
per release tag, so it serves the new exe within about 5 minutes of publishing.

## Microsoft Store (MSIX / AppX)
electron-builder only builds AppX on Windows (it needs `makeappx.exe` from the Windows SDK), so it cannot be
built on this Linux server. The release workflow builds it on `windows-latest` as a workflow artifact
(not attached to the release). To publish it the Owner needs a Microsoft Partner Center developer account,
then reserves the name "TradeZoro" and copies the Package/Identity/Name and Publisher (CN=...) values from
Partner Center into `build.appx.identityName` / `build.appx.publisher` in package.json. The Store signs the
package itself, so no certificate is needed for the Store route.

## Code signing (not done; the build is unsigned)
What an unsigned build means: Windows SmartScreen shows "Windows protected your PC / Unknown publisher"
until the user clicks More info > Run anyway, some antivirus tools are stricter with it, and some company
PCs block it. Auto-update still works (electron-updater checks the sha512 in latest.yml). Signing fixes the
"Unknown publisher" line and, once the signature has reputation, the SmartScreen warning.

Options (nothing has been bought):
1. Microsoft Store: the Store signs the MSIX. No SmartScreen warning for Store installs. Needs the
   Partner Center account (one-time fee for individuals; free for companies at the time of writing; check
   current terms). Only covers Store installs, not the .exe on the download page.
2. Azure Trusted Signing (Azure Artifact Signing): Microsoft's signing service, a monthly subscription.
   Needs an Azure account and identity validation of the business (the company must have existed for a
   minimum period). Signs in CI with no hardware token; electron-builder supports it through
   `win.azureSignOptions`. Gives immediate SmartScreen reputation in most cases. Usually the cheapest
   good option for a company.
3. OV code-signing certificate from a CA (DigiCert, Sectigo, SSL.com...): yearly fee, the private key must
   live on a hardware token or cloud HSM (CA/B rules since 2023), so CI signing needs the CA's cloud
   signing service. SmartScreen reputation builds up over downloads; the warning fades over weeks, not at once.
   (EV certificates no longer skip the SmartScreen reputation step, so they are not worth the extra cost.)

Once one is chosen: add the secrets to GitHub (never to the repo) and set `win.azureSignOptions` or
`CSC_LINK`/`CSC_KEY_PASSWORD` in the workflow. Nothing else in the app changes.
