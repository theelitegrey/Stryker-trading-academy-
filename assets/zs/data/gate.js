// Zscript data gate: the ONE place the plan decides whether a script may read book / flow / gex / opt data.
// PURE: the browser hub passes in the plan answer. Switch: assets/zs-config.js ZS_DATA_FOLLOWS_PLAN. Education only. Not financial advice.
// Same rule as the charts (assets/chart-pro-gate.js): order book + order flow = kind 'of', GEX + ZoroOptions = kind 'gex'; Free = locked,
// admin / Pro / an unresolved plan = open (fail open; the servers refuse what a plan does not cover anyway).
export const NS_KIND = { book: 'of', flow: 'of', gex: 'gex', opt: 'gex' };
export const NS_TITLE = { book: 'Order book', flow: 'Order flow', gex: 'GEX', opt: 'ZoroOptions' };
// one-time notices (plain English, no "live" / "real-time" wording)
export const LOCKED_TEXT = {
  book: 'Order book data in Zscript is part of Pro. These values are na on your plan.',
  flow: 'Order flow data in Zscript is part of Pro. These values are na on your plan.',
  gex: 'GEX data in Zscript is part of Pro. These values are na on your plan.',
  opt: 'ZoroOptions data in Zscript is part of Pro. These values are na on your plan.',
};
// state: 'ok' | 'locked' (plan) | 'na' (no data for this symbol / timeframe: why says which)
// follows: ZS_DATA_FOLLOWS_PLAN, free: confirmed Free member, avail: { book: '' | 'reason it is not available', ... } ('' = available)
export function decide(follows, free, avail) {
  const out = {};
  for (const ns of Object.keys(NS_KIND)) {
    if (follows && free) out[ns] = { state: 'locked', kind: NS_KIND[ns], why: LOCKED_TEXT[ns] };
    else if (avail && avail[ns]) out[ns] = { state: 'na', kind: NS_KIND[ns], why: avail[ns] };
    else out[ns] = { state: 'ok', kind: NS_KIND[ns], why: '' };
  }
  return out;
}
// each notice goes out once per hub: returns the notice message or null
export function noticeOnce(seen, ns, st) {
  if (!st || st.state === 'ok') return null;
  const key = ns + ':' + st.state + ':' + st.why;
  if (seen.has(key)) return null;
  seen.add(key);
  return { kind: 'zs.data.notice', ns, state: st.state, upgrade: st.state === 'locked' ? st.kind : null, text: st.why };
}
