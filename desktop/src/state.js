// Window size / position / always-on-top, remembered per window, in <userData>/window-state.json.
// Window keys: 'main' for the main window, 'chart-1', 'chart-2', ... for pop-out windows.
const fs = require('fs');
const path = require('path');

function create(dir) {
  const file = path.join(dir, 'window-state.json');
  let data = { windows: {}, open: [] };
  try { data = Object.assign(data, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { /* first run */ }
  let timer = null;
  const flush = () => {
    clearTimeout(timer); timer = null;
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1)); fs.renameSync(file + '.tmp', file); } catch (e) { /* disk full / read-only: keep running */ }
  };
  const save = () => { if (!timer) timer = setTimeout(flush, 500); };
  return {
    get: (key) => data.windows[key] || null,
    set: (key, v) => { data.windows[key] = Object.assign(data.windows[key] || {}, v); save(); },
    // Pop-out windows still open when the app quit: [{key, url}], reopened on the next start.
    openCharts: () => (Array.isArray(data.open) ? data.open : []),
    setOpenCharts: (list) => { data.open = list; save(); },
    flush
  };
}

// Saved bounds are only reused if at least 100x60 px of the title bar area lands on a connected monitor
// (a second monitor that was unplugged must not leave the window off-screen).
function visibleOn(bounds, displays) {
  if (!bounds || !(bounds.width > 200) || !(bounds.height > 150)) return false;
  return displays.some((d) => {
    const a = d.workArea;
    const w = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const h = Math.min(bounds.y + 60, a.y + a.height) - Math.max(bounds.y, a.y);
    return w >= 100 && h >= 30;
  });
}

module.exports = { create, visibleOn };
