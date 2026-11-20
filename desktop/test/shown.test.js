// src/shown.js: the page hears false when the window is hidden in the tray or minimised, true when it is back.
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const reportShown = require('../src/shown');

test('reports hidden / minimised / shown to the page', () => {
  const win = new EventEmitter(), sent = [];
  let visible = true, minimised = false;
  Object.assign(win, { isDestroyed: () => false, isVisible: () => visible, isMinimized: () => minimised,
    webContents: { send: (ch, v) => sent.push([ch, v]) } });
  reportShown(win);
  visible = false; win.emit('hide');
  visible = true; win.emit('show');
  minimised = true; win.emit('minimize');
  minimised = false; win.emit('restore');
  assert.deepStrictEqual(sent, [['tz:shown', false], ['tz:shown', true], ['tz:shown', false], ['tz:shown', true]]);
});

test('a closed window is left alone', () => {
  const win = new EventEmitter(); let n = 0;
  Object.assign(win, { isDestroyed: () => true, isVisible: () => false, isMinimized: () => false, webContents: { send: () => n++ } });
  reportShown(win); win.emit('hide');
  assert.strictEqual(n, 0);
});
