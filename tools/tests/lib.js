// Shared plumbing for the browser suites: where the repo is, where the local
// server is, and how to get a Chromium.
//
// Every suite used to carry its own absolute paths to a session scratchpad,
// which is why none of them survived the session. Everything environment-
// specific now resolves here, and only here.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

// tools/tests -> repo root
const ROOT = path.resolve(__dirname, '..', '..');

// The local http.server the suites drive. run.js starts one on this port if
// nothing is listening; a suite run by hand needs it started first.
const PORT = Number(process.env.STRYKER_TEST_PORT || 8000);
const BASE = process.env.STRYKER_TEST_BASE || ('http://localhost:' + PORT);

// Find a Chromium without downloading one. Order: explicit override, the
// Playwright browsers directory (the cloud container ships one there and sets
// PLAYWRIGHT_BROWSERS_PATH), then whatever playwright-core itself resolves.
function executablePath() {
  if (process.env.STRYKER_CHROMIUM) return process.env.STRYKER_CHROMIUM;
  const dirs = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers',
                path.join(process.env.HOME || '', '.cache', 'ms-playwright')].filter(Boolean);
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    // Prefer the headless shell (smaller, faster); fall back to full Chromium.
    const names = fs.readdirSync(d).sort().reverse();
    for (const prefix of ['chromium_headless_shell-', 'chromium-']) {
      const hit = names.find((n) => n.startsWith(prefix));
      if (!hit) continue;
      const cands = [
        path.join(d, hit, 'chrome-linux', 'headless_shell'),
        path.join(d, hit, 'chrome-linux', 'chrome'),
        path.join(d, hit, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(d, hit, 'chrome-win', 'chrome.exe'),
      ];
      const found = cands.find((c) => fs.existsSync(c));
      if (found) return found;
    }
  }
  try { return chromium.executablePath(); } catch (e) { return undefined; }
}

function launch(opts) {
  const exe = executablePath();
  return chromium.launch(Object.assign(exe ? { executablePath: exe } : {}, opts || {}));
}

module.exports = { chromium, ROOT, PORT, BASE, launch, executablePath };
