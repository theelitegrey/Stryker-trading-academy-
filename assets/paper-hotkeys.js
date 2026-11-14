/**
 * TradeZoro: paper-trading hotkeys (pure logic, no DOM access except reading an event/target).
 * Member request (GK, 13 Nov 2026): "assign my own keyboard shortcuts to each trading action".
 * SIMULATED paper trading only. Every action here calls the same paper functions as the buttons.
 * Defaults are EMPTY: nothing changes until a member sets a key. Runs in Node (tests) and the browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PaperHotkeys = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ACTIONS = [
    { id: 'buyMarket', group: 'Orders', label: 'Buy at market' },
    { id: 'sellMarket', group: 'Orders', label: 'Sell at market' },
    { id: 'buyLimit', group: 'Orders', label: 'Buy limit order (opens the ticket)' },
    { id: 'sellLimit', group: 'Orders', label: 'Sell limit order (opens the ticket)' },
    { id: 'ticket', group: 'Orders', label: 'Open the order ticket' },
    { id: 'cancelAll', group: 'Orders', label: 'Cancel all working orders' },
    { id: 'closePos', group: 'Position', label: 'Close the position on this chart' },
    { id: 'closeHalf', group: 'Position', label: 'Close half of the position' },
    { id: 'closeQuarter', group: 'Position', label: 'Close a quarter of the position' },
    { id: 'reversePos', group: 'Position', label: 'Reverse the position' },
    { id: 'flattenAll', group: 'Position', label: 'Close everything and cancel all orders' },
    { id: 'moveBE', group: 'Position', label: 'Move the stop loss to breakeven' },
    { id: 'trailToggle', group: 'Position', label: 'Turn the trailing stop on or off' },
    { id: 'closeWin', group: 'Position', label: 'Close all profitable positions' },
    { id: 'closeLoss', group: 'Position', label: 'Close all losing positions' },
    { id: 'closeCustom', group: 'Position', label: 'Close part of the position (type the quantity)' },
    { id: 'qtyUp', group: 'Quantity', label: 'Quantity up' },
    { id: 'qtyDown', group: 'Quantity', label: 'Quantity down' },
    { id: 'qty1', group: 'Quantity', label: 'Set quantity to 1' },
    { id: 'qty2', group: 'Quantity', label: 'Set quantity to 2' },
    { id: 'qty5', group: 'Quantity', label: 'Set quantity to 5' },
    { id: 'qty10', group: 'Quantity', label: 'Set quantity to 10' },
    { id: 'panel', group: 'Other', label: 'Show or hide the Paper trading panel' }
  ];
  const IDS = ACTIONS.map((a) => a.id);
  const MODS = ['Ctrl', 'Alt', 'Shift', 'Meta'];
  // Keys the chart already uses (they keep working; a member cannot take them).
  const CHART_KEYS = { 'Alt+A': 'Create an alert at the crosshair', 'Shift+ArrowRight': 'Bar replay: step forward', 'Shift+ArrowLeft': 'Bar replay: step back', 'Shift+ArrowUp': 'Bar replay: speed', 'Shift+ArrowDown': 'Bar replay: speed', 'Shift+H': 'Bar replay: hide markings', 'Shift+X': 'Bar replay: exit', Space: 'Bar replay: play or pause' };
  const NEVER = /^(Escape|Tab|Enter|NumpadEnter|F5|F11|F12|ContextMenu|CapsLock)$/;
  const BROWSER = /^(Ctrl|Meta)\+(Shift\+)?([WTNRLQPSFDAHJKUXZYCV]|Tab|[0-9])$/;
  const MODKEYS = /^(Control|Shift|Alt|Meta|AltGraph|OS)$/;

  function keyName(e) {
    const c = e.code || '';
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit[0-9]$/.test(c)) return c.slice(5);
    if (c) return c;
    const k = String(e.key || '');
    return k.length === 1 ? k.toUpperCase() : k === ' ' ? 'Space' : k;
  }
  /** 'Ctrl+Shift+B' for a keydown event, '' for a bare modifier. */
  function comboFromEvent(e) {
    if (!e || MODKEYS.test(String(e.key || ''))) return '';
    const k = keyName(e); if (!k) return '';
    const m = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
    return m.concat(k).join('+');
  }
  function label(combo) {
    return String(combo || '').split('+').map((p) => p.replace(/^Arrow/, '').replace(/^Numpad(\d)$/, 'Num $1').replace(/^Numpad/, 'Num ')).join(' + ');
  }
  /** null when the combo may be used, else a plain-English reason. */
  function reserved(combo) {
    if (!combo) return 'Press a key first.';
    const parts = combo.split('+'), k = parts[parts.length - 1];
    if (NEVER.test(k)) return k === 'Escape' ? 'Esc always closes things, so it cannot be a hotkey.' : k + ' is reserved and cannot be a hotkey.';
    if (BROWSER.test(combo)) return 'Your browser uses ' + label(combo) + '. Pick another key.';
    if (CHART_KEYS[combo]) return label(combo) + ' is already used by the chart (' + CHART_KEYS[combo] + ').';
    return null;
  }
  /** The other action using this combo, or null. */
  function conflict(map, combo, exceptId) {
    for (const id of Object.keys(map || {})) if (id !== exceptId && map[id] === combo) return id;
    return null;
  }
  function nameOf(id) { const a = ACTIONS.find((x) => x.id === id); return a ? a.label : id; }
  /** Keep only known actions with a string combo; drop duplicates (first wins). */
  function clean(map) {
    const out = {}, seen = {};
    if (map && typeof map === 'object') for (const id of IDS) { const c = map[id]; if (typeof c === 'string' && c && c.length <= 40 && !seen[c]) { out[id] = c; seen[c] = 1; } }
    return out;
  }
  function typing(t) { return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }
  /** Action id for a keydown, or null (typing in a field, auto-repeat, IME, nothing assigned). */
  function match(map, e) {
    if (!e || e.repeat || e.isComposing || typing(e.target)) return null;
    const c = comboFromEvent(e); if (!c) return null;
    return IDS.find((id) => map && map[id] === c) || null;
  }
  /** Quantity for a "half"/"quarter" close: whole contracts for futures, 4 decimals for crypto; 0 = too small. */
  function partQty(posQty, frac, whole) {
    const q = posQty * frac;
    return whole ? Math.floor(q) : Math.floor(q * 1e4) / 1e4;
  }
  /** Check a typed close quantity against the open size. step = smallest size step (1 for futures). */
  function validQty(raw, max, step) {
    const s = String(raw == null ? '' : raw).trim().replace(',', '.');
    if (!s) return { ok: false, msg: 'Type a quantity.' };
    if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return { ok: false, msg: 'Use a plain number.' };
    const q = Number(s), st = step > 0 ? step : 1;
    if (!(q > 0)) return { ok: false, msg: 'The quantity must be more than zero.' };
    if (q > max) return { ok: false, msg: 'You only hold ' + max + '. Enter ' + max + ' or less.' };
    if (Math.abs(q / st - Math.round(q / st)) > 1e-9) return { ok: false, msg: st === 1 ? 'Use whole contracts.' : 'Use steps of ' + st + '.' };
    return { ok: true, qty: Number(q.toFixed(6)) };
  }
  return { validQty, ACTIONS, IDS, CHART_KEYS, comboFromEvent, label, reserved, conflict, nameOf, clean, typing, match, partQty };
});
