// TradeZoro Creator Hub: one config file. CREATOR_PAYMENTS is the single switch for paid checkout.
// While false, paid plans can be saved and shown ("Paid checkout opens soon") but nobody can buy one;
// creators hand out access with free plans, invite links/codes and member import by email.
window.CREATOR_CONFIG = {
  PAYMENTS: false,                 // flip only when payouts (Stripe Connect / Razorpay Route) are live
  RULES_VERSION: '2026-10-30',
  MAX_COMMUNITIES: 3,
  TAGS: [['futures','Futures'],['forex','Forex'],['crypto','Crypto'],['options','Options'],['ict','ICT'],['order-flow','Order flow'],['price-action','Price action'],['other','Other']]
};
