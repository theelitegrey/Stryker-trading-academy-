// TradeZoro — /spectra page entry (ES module). Mounts the Spectra board (assets/spectra-board.js) in #spx-root.
// ?u=SPX|SPY|QQQ|GLD opens that market (alert pushes link here with ?symbol=). Education only. Not financial advice.
import { createSpectra } from './spectra-board.js?v=1115';

const q = new URLSearchParams(location.search);
const want = String(q.get('u') || q.get('symbol') || '').toUpperCase();
const root = document.getElementById('spx-root');
if (root) {
  const board = createSpectra(root, { ticker: want || undefined, store: 'spx-page' });
  board.open();
  window.__stkSpectraPage = board;
}
