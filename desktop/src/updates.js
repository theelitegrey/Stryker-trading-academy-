// TradeZoro desktop: update-banner rules. Pure functions (no Electron), tested in test/updates.test.js.
// The site publishes /app-version.json (docs/app-updates.md); its "windows" entry carries the release notes
// and minVersion. electron-updater still does the real download from GitHub Releases.

// "1.10.0" vs "1.9.2": -1 / 0 / 1. Missing or non-numeric parts count as 0, a leading "v" is ignored.
function compare(a, b) {
  const p = (v) => String(v || '').replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  return 0;
}

// The windows entry of /app-version.json, or null when the JSON is missing or malformed.
function parseManifest(json) {
  let m = json;
  if (typeof json === 'string') { try { m = JSON.parse(json); } catch (e) { return null; } }
  const w = m && typeof m === 'object' ? m.windows : null;
  if (!w || typeof w.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(w.version)) return null;
  return {
    version: w.version,
    url: typeof w.url === 'string' ? w.url : '/download',
    notes: Array.isArray(w.notes) ? w.notes.filter((n) => typeof n === 'string').map((n) => n.slice(0, 200)) : [],
    minVersion: typeof w.minVersion === 'string' && /^\d+\.\d+\.\d+$/.test(w.minVersion) ? w.minVersion : null
  };
}

// What the window should show. installed = app.getVersion(); ready = version electron-updater downloaded (or null);
// dismissed = the ready version the member closed with X this run.
//   { kind: 'block' }  installed < minVersion: full-screen "Please update", no X
//   { kind: 'ready' }  an update is downloaded and not dismissed: top banner with "Restart to update"
//   null               nothing
function bannerState({ installed, manifest, ready, dismissed, canInstall }) {
  const notes = manifest && ready && compare(manifest.version, ready) === 0 ? manifest.notes : [];
  const base = { version: ready || (manifest && manifest.version) || '', note: notes[0] || '', ready: !!ready, canInstall: !!canInstall };
  if (manifest && manifest.minVersion && compare(installed, manifest.minVersion) < 0) return Object.assign({ kind: 'block', url: manifest.url }, base);
  if (ready && compare(ready, installed) > 0 && ready !== dismissed) return Object.assign({ kind: 'ready' }, base);
  return null;
}

module.exports = { compare, parseManifest, bannerState };
