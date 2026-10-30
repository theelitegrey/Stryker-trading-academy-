// TradeZoro Creator Hub: one config file (display constants).
// Paid checkout is switched on the SERVER: settings/commerce.creatorPayments (default false), enforced by the creatorPay
// Cloud Function (functions-src/creatorPay.js). While it is off, paid plans show "Paid checkout opens soon" to everyone
// except TradeZoro admins and stryker-qa-* test users; creators use free plans, invites and member import.
window.CREATOR_CONFIG = {
  PAYMENTS: false,                 // legacy client flag: no longer decides anything (the server switch does)
  PRICE_MIN: 1, PRICE_MAX: 999, TRIAL_MAX: 30,
  // Countries where a creator can receive payouts (Stripe Connect). Must equal PAYOUT_COUNTRIES in
  // functions-src/creatorPay.js (tools/creator-pay/paytest.js checks). India is not in it: Stripe accounts in India are
  // invite-only, so India-based creators keep free / invite-only communities for now.
  PAYOUT_COUNTRIES: ['AT', 'AU', 'BE', 'BG', 'CA', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GI', 'GR',
    'HK', 'HR', 'HU', 'IE', 'IT', 'JP', 'LI', 'LT', 'LU', 'LV', 'MT', 'MX', 'NL', 'NO', 'NZ', 'PL', 'PT', 'RO', 'SE', 'SG', 'SI', 'SK',
    'US', 'AE', 'MY', 'TH', 'BR'],
  // Discord roles Worker (workers/discord-roles). Holds all Discord tokens; the site only talks to it with the member's Firebase ID token.
  DISCORD_API: 'https://discord-roles.theelitegrey.workers.dev',
  RULES_VERSION: '2026-10-30',
  MAX_COMMUNITIES: 3,
  // Public half of the server key that seals community indicators (private half: Pages secret CREATOR_SEAL_KEY,
  // used only by functions/api/creator/ind.js). Public by design; safe to ship.
  SEAL_PUB: { kty: 'EC', crv: 'P-256', x: 'vbrmeTSfmDZOiw1ThkblT5CBMRihJfMQzLphYmhw-uQ', y: 'vHR9LcJkVyZg2ybQ8bVY1cUDCfivJkRExh77AJ3yRa4' },
  IND_TAGS: ['trend', 'momentum', 'volume', 'levels', 'oscillator', 'volatility', 'session', 'order-flow', 'ict', 'scalping'],
  TAGS: [['futures','Futures'],['forex','Forex'],['crypto','Crypto'],['options','Options'],['ict','ICT'],['order-flow','Order flow'],['price-action','Price action'],['other','Other']]
};
