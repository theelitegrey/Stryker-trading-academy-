// Stryker Trading Academy — Charts: built-in Stryker Pine indicators (ES module)
// Imported by assets/chart-indicator-window.js, which lists these in the "Stryker" group of
// the Indicators window (next to GEX Levels) and adds them through
// STRYKER_PINE.addSource(name, source, { engine: 'next' }).
//
// The Pine sources live in assets/pine/*.pine (Owner order 2026-10-07, "add these indicators
// to charts"). Each file's header lists the Stryker edits made to the original (wording rules
// only, plus any part that cannot run in the browser). They run in the member's browser on the
// "next" Pine engine (assets/chart-pine-next.js: pinets 0.11 in a Web Worker); no server.
// Settings come from the scripts' own inputs (the indicator settings dialog), defaults as
// in the source unless the file header says otherwise.

export const BUILTIN_PINE = [
  {
    id: 'stoic-edge-compass',
    name: 'Stoic Edge Compass',
    desc: 'Structure bias, range filter, trend ribbon + 200 EMA, context dots, S/R zones, status panel',
    url: 'pine/stoic-edge-compass.pine?v=465'
  },
  {
    id: 'wcsmc-sp',
    name: 'WCSMC + SP v3.0 [WinWorld]',
    desc: 'Smart-money structure: BoS / ChoCh, IDM, order blocks, FVGs, MTF structure, SMT vs a compare symbol, MTF dashboard',
    url: 'pine/wcsmc-sp.pine?v=465'
  },
  // The Owner's own indicators ("add this indicator, its strykers", 2026-10-08): Editors' picks,
  // author Stryker. They run EXACTLY as the Owner wrote them, byte-identical, no edits (Owner
  // order: "create indicators as they are, no changes"). `source` = same path as `url` (the
  // field name of the picker-sections array).
  {
    id: 'smt-pro-stryker',
    name: 'SMT Divergence Pro [Stryker]',
    author: 'Stryker',
    section: 'picks',
    desc: 'SMT divergence vs correlated futures (auto-paired: NQ vs ES), chart TF + higher TFs',
    url: 'pine/smt-pro-stryker.pine?v=465',
    source: 'pine/smt-pro-stryker.pine?v=465'
  },
  {
    id: 'ifvg-pro-stryker',
    name: 'IFVG Pro+ [Stryker]',
    author: 'Stryker',
    section: 'picks',
    desc: 'Liquidity (BSL / SSL from higher-TF swings and candles), sweep, candidate FVG and inversion (IFVG) boxes, risk / reward box',
    url: 'pine/ifvg-pro-stryker.pine?v=465',
    source: 'pine/ifvg-pro-stryker.pine?v=465'
  },
  {
    id: 'htf-po3-lens-stryker',
    name: 'HTF PO3 Lens [Stryker]',
    author: 'Stryker',
    section: 'picks',
    desc: 'Up to five higher-timeframe candles drawn right of the last bar, with HTF FVGs, sweeps and a countdown to the close',
    url: 'pine/htf-po3-lens-stryker.pine?v=465',
    source: 'pine/htf-po3-lens-stryker.pine?v=465'
  },
  {
    id: 'fvg-relay-stryker',
    name: 'FVG Relay [Stryker]',
    author: 'Stryker',
    section: 'picks',
    desc: 'Higher-timeframe FVGs on your chart; tapped and respected gaps chain as Relay 1, 2, 3; liquidity and dashboard',
    url: 'pine/fvg-relay-stryker.pine?v=465',
    source: 'pine/fvg-relay-stryker.pine?v=465'
  }
];

const cache = new Map();
// Source text of a built-in (fetched once per page load).
export function builtinSource(id){
  const b = BUILTIN_PINE.find((x) => x.id === id);
  if (!b) return Promise.reject(new Error('Unknown built-in'));
  if (!cache.has(id)) {
    cache.set(id, fetch(new URL(b.url, import.meta.url)).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).catch((e) => { cache.delete(id); throw e; }));
  }
  return cache.get(id);
}
