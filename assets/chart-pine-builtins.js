// Stryker Trading Academy — Charts: built-in Pine indicators + picker sections (ES module)
// Imported by assets/chart-indicator-window.js (the Indicators window), which adds the Pine
// ones through STRYKER_PINE.addSource(name, source, { engine: 'next' }).
//
// HOW TO ADD AN INDICATOR THE OWNER SENDS (a one-line data change):
//   1. Save the Pine source EXACTLY as sent, byte for byte, as assets/pine/<id>.pine (Owner
//      order 2026-10-08: "create indicators as they are, no changes"). Never edit a third-party
//      script; anything it needs that the browser engine lacks is fixed in the ENGINE
//      (assets/chart-pine-next*.js). tools/tests/chart-pine-imports-browser.js checks that the
//      served source equals the original file.
//   2. Add ONE line to PICKER_SCRIPTS below:
//        { id: '<id>', name: '<as in the script>', author: '<author named in the script, or
//          "Community" when it names none>', section: 'community', source: 'pine/<id>.pine?v=N' }
//      section 'community' = a THIRD-PARTY script -> COMMUNITY > "Community indicators",
//                            tagged "Community · third-party", never shown as by Stryker.
//      section 'picks'     = the OWNER'S OWN (Stryker-made) script -> COMMUNITY > "Editors'
//                            picks", author Stryker.
//      Optional: desc (one short line for the list).
//   3. Bump the build as usual (the ?v= on source rides the build number).
// The id is permanent: favourites (key 'x:<id>') and saved chart layouts refer to it, so never
// rename or reuse an id. Moving an entry between sections is safe.
//
// STRYKER_PICKS = the Stryker-made indicators that live elsewhere (the GEX Levels native, the
// Pine editor examples in chart-pine-scripts.js), by Indicators-window key, so Editors' picks
// lists them too. They also stay in Technicals.
//
// The Pine sources run in the member's browser on the "next" Pine engine
// (assets/chart-pine-next.js: pinets in a Web Worker); no server. Settings come from the
// scripts' own inputs (the indicator settings dialog).

export const PICKER_SCRIPTS = [
  { id: 'stoic-edge-compass', name: 'Stoic Edge Compass', author: 'Community', section: 'community', source: 'pine/stoic-edge-compass.pine?v=477', desc: 'Structure bias, range filter, trend ribbon + 200 EMA, context dots, S/R zones, status panel' },
  { id: 'wcsmc-sp', name: 'WCSMC + SP v3.0 [WinWorld]', author: 'WinWorld', section: 'community', source: 'pine/wcsmc-sp.pine?v=477', desc: 'Smart-money structure: BoS / ChoCh, IDM, order blocks, FVGs, MTF structure, SMT vs a compare symbol, MTF dashboard' },
  // Community batch B (Owner 2026-10-08 "Add all these indicators in community"): third-party,
  // byte-identical to the files the Owner sent (CRLF line endings kept).
  { id: 'ict-pro-plus-timmynq', name: 'ICT Pro+ | TimmyNQ [TakingProphets]', author: 'TimmyNQ (TakingProphets)', section: 'community', source: 'pine/ict-pro-plus-timmynq.pine?v=477', desc: 'ICT toolkit: higher-timeframe candles and levels, liquidity, FVGs, sessions and SMT vs a compare symbol' },
  // Community leftovers (Owner 2026-10-10): third-party, posted as-is, byte-identical.
  { id: '2022-model-pro-ictkesik', name: '2022 Model Pro+ | ICTKESIK', author: 'ICTKESIK', section: 'community', source: 'pine/2022-model-pro-ictkesik.pine?v=477', desc: 'Community ICT model script, preserved as supplied' },
  { id: 'ifvg-degree-pro-plus', name: 'IFVG° [Pro+]', author: 'Community', section: 'community', source: 'pine/ifvg-degree-pro-plus.pine?v=477', desc: 'Community IFVG script, preserved as supplied' },
  { id: 'trinity-atr-levels', name: 'Trinity ATR Levels - The Ultimate Milkman Edition', author: 'satymahajan / EMA34TRADER', section: 'community', source: 'pine/trinity-atr-levels.pine?v=477', desc: 'ATR levels toolkit, preserved as supplied' },
  { id: 'ifvg-ultimate-deluxe-dodgysdd', name: 'iFVG Ultimate+ Deluxe | DodgysDD', author: 'DodgysDD', section: 'community', source: 'pine/ifvg-ultimate-deluxe-dodgysdd.pine?v=477', desc: 'iFVG toolkit, preserved as supplied' },
  { id: 'cisd-model-plus-triton', name: 'CISD Model+ | Triton Trades', author: 'Triton Trades', section: 'community', source: 'pine/cisd-model-plus-triton.pine?v=477', desc: 'CISD model toolkit, preserved as supplied' },
  { id: 'forever-pro', name: 'Forever Pro°', author: 'Community', section: 'community', source: 'pine/forever-pro.pine?v=477', desc: 'Community Pro script, preserved as supplied' },
  { id: 'unicorn-model', name: 'Unicorn Model', author: 'Community', section: 'community', source: 'pine/unicorn-model.pine?v=477', desc: 'Community Unicorn Model script, preserved as supplied' },
  // Community batch A (same Owner order; web-temp-6): third-party, byte-identical, CRLF kept.
  { id: 'manipulation-model-fb', name: 'Manipulation Model [FB]', author: 'FB', section: 'community', source: 'pine/manipulation-model-fb.pine?v=477', desc: 'Session manipulation candles, traps, key levels, higher-timeframe FVGs and a stats dashboard' },
  { id: 'london-intraday-protraction', name: 'London Intraday Protraction° [Pro+]', author: 'Community', section: 'community', source: 'pine/london-intraday-protraction.pine?v=477', desc: 'London/CBDR session ranges, protraction markers, deviations and statistics table' },
  // The Owner's own indicators ("add this indicator, its strykers", 2026-10-08): Editors' picks,
  // author Stryker, byte-identical to the Owner's sources.
  { id: 'smt-pro-stryker', name: 'SMT Divergence Pro [Stryker]', author: 'Stryker', section: 'picks', source: 'pine/smt-pro-stryker.pine?v=477', desc: 'SMT divergence vs correlated futures (auto-paired: NQ vs ES), chart TF + higher TFs' },
  { id: 'ifvg-pro-stryker', name: 'IFVG Pro+ [Stryker]', author: 'Stryker', section: 'picks', source: 'pine/ifvg-pro-stryker.pine?v=477', desc: 'Liquidity (BSL / SSL from higher-TF swings and candles), sweep, candidate FVG and inversion (IFVG) boxes, risk / reward box' },
  { id: 'htf-po3-lens-stryker', name: 'HTF PO3 Lens [Stryker]', author: 'Stryker', section: 'picks', source: 'pine/htf-po3-lens-stryker.pine?v=477', desc: 'Up to five higher-timeframe candles drawn right of the last bar, with HTF FVGs, sweeps and a countdown to the close' },
  { id: 'fvg-relay-stryker', name: 'FVG Relay [Stryker]', author: 'Stryker', section: 'picks', source: 'pine/fvg-relay-stryker.pine?v=477', desc: 'Higher-timeframe FVGs on your chart; tapped and respected gaps chain as Relay 1, 2, 3; liquidity and dashboard' }
];

// Indicators-window keys of Stryker-made indicators defined elsewhere (Editors' picks order).
export const STRYKER_PICKS = ['b:stk_gex', 'x:ema-cross', 'x:session-vwap', 'x:pdhl'];

// Back-compat name for older importers.
export const BUILTIN_PINE = PICKER_SCRIPTS.map((b) => Object.assign({ url: b.source }, b));

const cache = new Map();
// Source text of a built-in (fetched once per page load).
export function builtinSource(id){
  const b = PICKER_SCRIPTS.find((x) => x.id === id);
  if (!b) return Promise.reject(new Error('Unknown built-in'));
  if (!cache.has(id)) {
    cache.set(id, fetch(new URL(b.source, import.meta.url)).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).catch((e) => { cache.delete(id); throw e; }));
  }
  return cache.get(id);
}
