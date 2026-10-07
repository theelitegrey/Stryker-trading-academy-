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
    url: 'pine/stoic-edge-compass.pine?v=455'
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
