// TradeZoro — Charts: ONE place that decides whether a chart symbol is a futures contract (ES module, pure, no DOM).
//
// WHY (Owner bug 17 Nov): the chart can hold the same futures market under several names:
//   'futures:NQ1!'            our provider form (search, watchlist, templates)
//   'CME:NQ1!', 'CME_MINI:MNQ1!', 'CBOT:ZN1!', 'CBOT_MINI:YM1!', 'COMEX:GC1!', 'NYMEX:CL1!' ...   exchange form (phone, typed, Pine input.symbol)
//   'MNQZ6', 'CME_MINI:MNQZ2026', 'NQH27'   a contract month instead of the continuous contract
//   'NQ1!'                     bare continuous ticker
//   'rithmic:NQ1!'             the member's own Rithmic feed (paper / live keys)
// Modules that only tested `provider === 'futures'` silently did nothing for the other forms (the DOM said "Open a crypto or
// futures chart" on an MNQ chart). Every module now asks this file instead.
//
//   isFutures(sym)    -> true for any form above
//   normFutures(sym)  -> 'futures:MNQ1!' for any form above; any other symbol is returned UNCHANGED (crypto, stocks, fx ...)
//   futRoot(sym)      -> 'MNQ' (the contract root), '' when not futures
//   splitSym(sym)     -> [provider, ticker] with futures folded to ['futures', 'MNQ1!'] (lower-case provider)
//   FUT_EXCH          -> the CME Group exchange prefixes
// Tests: tools/tests/chart-sym.test.mjs. Education only. Not financial advice.

export const FUT_EXCH = /^(cme|cme_mini|cbot|cbot_mini|comex|comex_mini|nymex|nymex_mini)$/i;
// The roots we chart or have heard of on CME Group; only used to accept a BARE ticker ('NQ1!', 'MNQZ6') as futures.
// A prefixed form ('CME:XYZ1!') is futures whatever its root.
export const FUT_ROOTS = ['NQ', 'MNQ', 'ES', 'MES', 'YM', 'MYM', 'RTY', 'M2K', 'GC', 'MGC', 'SI', 'SIL', 'HG', 'MHG', 'CL', 'MCL', 'NG',
  'ZN', 'ZB', 'ZF', 'ZT', 'ZC', 'ZS', 'ZW', '6E'];
const MONTH = /^([A-Z0-9]+?)[FGHJKMNQUVXZ](\d|\d\d|\d{4})$/;   // MNQZ6 / MNQZ26 / MNQZ2026 -> MNQ

// 'MNQ1!' / 'MNQ2!' / 'MNQZ6' / 'MNQ' -> 'MNQ'; strict = only known roots (for bare tickers)
function rootOfTicker(t, strict) {
  const s = String(t || '').trim().toUpperCase();
  if (!s) return '';
  let m = /^([A-Z0-9]+?)[12]!$/.exec(s);
  if (m) return !strict || FUT_ROOTS.includes(m[1]) ? m[1] : '';
  m = MONTH.exec(s);
  if (m && FUT_ROOTS.includes(m[1])) return m[1];
  if (!strict && /^[A-Z0-9]+$/.test(s)) return s;
  return '';
}

// -> { root, ticker: 'MNQ1!', sym: 'futures:MNQ1!' } or null
export function futParts(sym) {
  const s = String(sym == null ? '' : sym).trim();
  if (!s) return null;
  const m = /^([a-z0-9_]+):(.+)$/i.exec(s);
  let root = '';
  if (m) {
    const p = m[1].toLowerCase();
    if (p !== 'futures' && p !== 'rithmic' && !FUT_EXCH.test(p)) return null;   // 'rithmic:NQ1!' = the member's Rithmic feed, same contract
    root = rootOfTicker(m[2], false);
  } else {
    // bare: only a continuous ticker or a contract month of a KNOWN root ('ES' alone is a stock; 'AAPL' is not futures)
    if (!/(?:[12]!|[FGHJKMNQUVXZ]\d{1,4})$/i.test(s)) return null;
    root = rootOfTicker(s, true);
  }
  if (!root) return null;
  return { root, ticker: root + '1!', sym: 'futures:' + root + '1!' };
}
export const isFutures = (sym) => !!futParts(sym);
export const normFutures = (sym) => { const f = futParts(sym); return f ? f.sym : sym; };
export const futRoot = (sym) => { const f = futParts(sym); return f ? f.root : ''; };
export function splitSym(sym) {
  const f = futParts(sym);
  if (f) return ['futures', f.ticker];
  const m = /^([a-z0-9_]+):(.+)$/i.exec(String(sym == null ? '' : sym));
  return m ? [m[1].toLowerCase(), m[2]] : ['', String(sym == null ? '' : sym)];
}
