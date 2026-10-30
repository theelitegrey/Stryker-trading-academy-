// TradeZoro Creator Hub: one config file. CREATOR_PAYMENTS is the single switch for paid checkout.
// While false, paid plans can be saved and shown ("Paid checkout opens soon") but nobody can buy one;
// creators hand out access with free plans, invite links/codes and member import by email.
window.CREATOR_CONFIG = {
  PAYMENTS: false,                 // flip only when payouts (Stripe Connect / Razorpay Route) are live
  RULES_VERSION: '2026-10-30',
  MAX_COMMUNITIES: 3,
  // Public half of the server key that seals community indicators (private half: Pages secret CREATOR_SEAL_KEY,
  // used only by functions/api/creator/ind.js). Public by design; safe to ship.
  SEAL_PUB: { kty: 'EC', crv: 'P-256', x: 'vbrmeTSfmDZOiw1ThkblT5CBMRihJfMQzLphYmhw-uQ', y: 'vHR9LcJkVyZg2ybQ8bVY1cUDCfivJkRExh77AJ3yRa4' },
  IND_TAGS: ['trend', 'momentum', 'volume', 'levels', 'oscillator', 'volatility', 'session', 'order-flow', 'ict', 'scalping'],
  TAGS: [['futures','Futures'],['forex','Forex'],['crypto','Crypto'],['options','Options'],['ict','ICT'],['order-flow','Order flow'],['price-action','Price action'],['other','Other']]
};
