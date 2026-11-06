// Zscript: owner switches. Education only. Not financial advice.
// ZS_DATA_FOLLOWS_PLAN: true = scripts read book / flow / gex / opt data only if the member's plan allows the same data on charts
// (chart-pro-gate.js: order book + order flow = 'of', GEX + ZoroOptions = 'gex'). false = every member's scripts get the data
// (the servers still refuse what the plan does not cover). The ONE place this is read: assets/zs/data/gate.js.
export const ZS_DATA_FOLLOWS_PLAN = true;

// ZS_LAUNCHED: false = Zscript is HIDDEN (no editor tab, no indicator-window section; the Script Library page says it is not open yet).
// The CoS flips this to true at launch. Until then a tester opens /charts?zs=1 (or /script-library?zs=1): the preview stays on for
// that browser tab (sessionStorage), so the library's "Add to chart" (/charts?zs=<sid>) keeps working. ?zs=0 turns it off again.
export const ZS_LAUNCHED = false;
export function zsEnabled() {
  if (ZS_LAUNCHED) return true;
  try {
    const q = new URLSearchParams(location.search).get('zs');
    if (q === '0') sessionStorage.removeItem('stk_zs_preview');
    else if (q === '1') sessionStorage.setItem('stk_zs_preview', '1');
    return sessionStorage.getItem('stk_zs_preview') === '1';
  } catch (e) { return false; }
}
