// Zscript: owner switches. Education only. Not financial advice.
// ZS_DATA_FOLLOWS_PLAN: true = scripts read book / flow / gex / opt data only if the member's plan allows the same data on charts
// (chart-pro-gate.js: order book + order flow = 'of', GEX + ZoroOptions = 'gex'). false = every member's scripts get the data
// (the servers still refuse what the plan does not cover). The ONE place this is read: assets/zs/data/gate.js.
export const ZS_DATA_FOLLOWS_PLAN = true;
