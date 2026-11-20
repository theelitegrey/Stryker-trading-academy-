// Tells the page in an app window whether the window can be seen (hidden in the tray or minimised = not shown).
// backgroundThrottling stays off (data, timers and alerts keep running), so the page itself must know when painting
// is wasted: assets/vela-chart.js holds chart frames while not shown (member GK, 20 Nov: high GPU/RAM in the app).
// Used by src/main.js; test/mem-main.js uses the same wiring.
module.exports = function reportShown(win) {
  const send = () => { if (!win.isDestroyed()) win.webContents.send('tz:shown', win.isVisible() && !win.isMinimized()); };
  for (const ev of ['hide', 'show', 'minimize', 'restore']) win.on(ev, send);
};
