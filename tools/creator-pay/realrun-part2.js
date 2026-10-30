// Part 2 of realrun.js: real Stripe sandbox purchases against the connected account. Sessions come from OUR checkout
// action; a browser pays them (state in /tmp/t7-pay/*.json); real events are replayed as signed webhooks.
'use strict';
const fs = require('fs');
module.exports = async function (T) {
  const { S, call, hook, pump, ok, acct, IDS, qaBuyer, getDB, done } = T;
  const DB = getDB();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  fs.mkdirSync('/tmp/t7-pay', { recursive: true });
  async function paid(sid, ms) {
    const end = Date.now() + (ms || 600000);
    while (Date.now() < end) { const s = await S('GET', 'checkout/sessions/' + sid, null, acct); if (s.status === 'complete') return s; await wait(3000); }
    return null;
  }
  const st = await call('ana', { action: 'status' }, 'stryker-qa-creator@example.com');
  ok(st.account.status === 'active' && DB['communities/qa-desk'].sellerReady === true, 'real account -> active, community sellerReady', st.account.status);

  // ---- monthly purchase: 4242
  const c1 = await call('buyer1', { action: 'checkout', cid: 'qa-desk', planId: 'p1' }, qaBuyer(1));
  IDS.monthlySession = c1.sessionId;
  const real1 = await S('GET', 'checkout/sessions/' + c1.sessionId, null, acct);
  ok(real1.mode === 'subscription' && real1.livemode === false && /^cs_test_/.test(real1.id), 'monthly Checkout Session exists ON the creator account (direct charge)', real1.mode);
  fs.writeFileSync('/tmp/t7-pay/monthly.json', JSON.stringify({ url: c1.url, sid: c1.sessionId }));
  console.log('WAITING_PAY monthly');
  const p1 = await paid(c1.sessionId);
  ok(!!p1, 'monthly paid with 4242 in real Stripe Checkout', p1 && p1.payment_status);
  if (!p1) return done();
  IDS.monthlySubscription = p1.subscription;
  await wait(4000);
  const types1 = await pump(acct);
  ok(types1.includes('checkout.session.completed') && types1.includes('invoice.paid'), 'real events delivered as signed webhooks: ' + types1.slice(0, 8).join(','), types1);
  const m1 = DB['communities/qa-desk/members/buyer1'];
  ok(m1 && m1.source === 'paid' && m1.status === 'active' && m1.planId === 'p1' && m1.pay.status === 'active' && m1.pay.subId === p1.subscription, 'member added with plan + subscription', m1 && m1.pay);
  const saleKeys = Object.keys(DB).filter((k) => /^creatorSales\//.test(k));
  ok(saleKeys.length >= 1 && DB[saleKeys[0]].amountCents === 2900 && DB[saleKeys[0]].creatorUid === 'ana', 'creatorSales record $29.00', saleKeys.map((k) => DB[k].amountCents));
  const sub1 = await S('GET', 'subscriptions/' + p1.subscription, null, acct);
  ok(!sub1.application_fee_percent, 'fee 0: no application_fee_percent on the real subscription', sub1.application_fee_percent);
  const inv1 = await S('GET', 'invoices/' + sub1.latest_invoice, null, acct);
  ok(inv1.application_fee_amount == null || inv1.application_fee_amount === 0, 'fee 0: no application fee on the first invoice');

  // ---- one-time purchase: 3DS card
  const c2 = await call('buyer2', { action: 'checkout', cid: 'qa-desk', planId: 'p2' }, qaBuyer(2));
  IDS.onetimeSession = c2.sessionId;
  fs.writeFileSync('/tmp/t7-pay/onetime.json', JSON.stringify({ url: c2.url, sid: c2.sessionId }));
  console.log('WAITING_PAY onetime');
  const p2 = await paid(c2.sessionId);
  ok(!!p2, 'one-time paid with 3DS card 4000 0027 6000 3184 (authenticated)', p2 && p2.payment_status);
  if (p2) {
    IDS.onetimePaymentIntent = p2.payment_intent;
    await wait(3000); await pump(acct);
    const m2 = DB['communities/qa-desk/members/buyer2'];
    ok(m2 && m2.source === 'paid' && m2.expiresAt === null && m2.pay.kind === 'one_time', 'one-time: lifetime access', m2 && m2.pay);
    const pi = await S('GET', 'payment_intents/' + p2.payment_intent, null, acct);
    ok(!pi.application_fee_amount, 'fee 0: no application_fee_amount on the one-time charge');
  }

  // ---- fee setting 10% really reaches Stripe
  DB['settings/commerce'].creatorFeePct = 10;
  const c3 = await call('buyer3', { action: 'checkout', cid: 'qa-desk', planId: 'p2' }, qaBuyer(3));
  fs.writeFileSync('/tmp/t7-pay/fee10.json', JSON.stringify({ url: c3.url, sid: c3.sessionId }));
  console.log('WAITING_PAY fee10');
  const p3 = await paid(c3.sessionId);
  if (p3) {
    await wait(3000); await pump(acct);
    const pi3 = await S('GET', 'payment_intents/' + p3.payment_intent, null, acct);
    ok(pi3.application_fee_amount === 490, 'fee 10% -> application_fee_amount 490 on a $49 one-time charge (platform keeps $4.90)', pi3.application_fee_amount);
    // refund -> access ends
    IDS.refundedPaymentIntent = p3.payment_intent;
    await S('POST', 'refunds', { payment_intent: p3.payment_intent }, acct);
    await wait(3000); await pump(acct);
    const m3 = DB['communities/qa-desk/members/buyer3'];
    ok(m3 && m3.status === 'expired' && m3.pay.status === 'refunded', 'full refund (real) -> sale refunded, access ended', m3 && m3.pay);
  } else ok(false, 'fee10 purchase paid');
  DB['settings/commerce'].creatorFeePct = 0;

  // ---- decline card: buyer4 attempts 0002 (browser), must NOT be a member
  const c4 = await call('buyer4', { action: 'checkout', cid: 'qa-desk', planId: 'p1' }, qaBuyer(4));
  fs.writeFileSync('/tmp/t7-pay/decline.json', JSON.stringify({ url: c4.url, sid: c4.sessionId }));
  console.log('WAITING_DECLINE');
  await wait(60000);
  const s4 = await S('GET', 'checkout/sessions/' + c4.sessionId, null, acct);
  await pump(acct);
  ok(s4.status !== 'complete' && !DB['communities/qa-desk/members/buyer4'], 'declined card 4000 0000 0000 0002: no payment, no membership', s4.status);

  // ---- renewal via test clock is not possible for an already-attached subscription; use a clock-bound customer
  const clock = await S('POST', 'test_helpers/test_clocks', { frozen_time: Math.floor(Date.now() / 1000), name: 't7 renewal' });
  IDS.testClock = clock.id;
  // clocks live on the platform; the customer/subscription must be created on the platform. Direct charges live on the connected
  // account, where test clocks are also available via the Stripe-Account header.
  const clockC = await S('POST', 'test_helpers/test_clocks', { frozen_time: Math.floor(Date.now() / 1000), name: 't7 renewal (connected)' }, acct);
  IDS.testClockConnected = clockC.id;
  const cus = await S('POST', 'customers', { email: qaBuyer(5), test_clock: clockC.id, payment_method: 'pm_card_visa', invoice_settings: { default_payment_method: 'pm_card_visa' } }, acct);
  const cfg = DB['communities/qa-desk/plans/m'];
  const priceId = (DB['creatorPriceCache'] || {})[0];
  const prods = await S('GET', 'prices', { limit: 10, active: true }, acct);
  const price = prods.data.find((p) => p.unit_amount === 2900 && p.recurring && p.recurring.interval === 'month');
  const sub = await S('POST', 'subscriptions', { customer: cus.id, 'items[0][price]': price.id, 'metadata[buyerUid]': 'buyer5', 'metadata[cid]': 'qa-desk', 'metadata[planId]': 'p1' }, acct);
  IDS.clockSubscription = sub.id;
  // map this subscription to buyer5 the way checkout would (member row + sub record), then let real Stripe renew it
  const t = Math.floor(Date.now() / 1000);
  DB['communities/qa-desk/members/buyer5'] = { uid: 'buyer5', role: 'member', status: 'active', source: 'paid', planId: 'p1', expiresAt: { toMillis: () => sub.current_period_end * 1000 + 3 * 86400000, toDate: () => new Date() }, pay: { kind: 'subscription', subId: sub.id, status: 'active', acct, periodEnd: sub.current_period_end * 1000 } };
  DB['creatorSubs/' + sub.id] = { cid: 'qa-desk', buyerUid: 'buyer5', planId: 'p1', creatorUid: 'ana', acct, live: false, status: 'active' };
  await pump(acct);
  await S('POST', 'test_helpers/test_clocks/' + clockC.id + '/advance', { frozen_time: sub.current_period_end + 3600 }, acct);
  for (let i = 0; i < 20; i++) { await wait(3000); const c = await S('GET', 'test_helpers/test_clocks/' + clockC.id, null, acct); if (c.status === 'ready') break; }
  await wait(3000);
  const types5 = await pump(acct);
  const m5 = DB['communities/qa-desk/members/buyer5'];
  const sale5 = Object.keys(DB).filter((k) => /^creatorSales\//.test(k) && DB[k].buyerUid === 'buyer5' || /^creatorSales\//.test(k) && DB[k].subId === sub.id);
  ok(types5.includes('invoice.paid'), 'test clock advanced one month: real renewal invoice.paid delivered', types5);
  ok(m5 && m5.pay.status === 'active' && m5.pay.periodEnd > sub.current_period_end * 1000, 'renewal extended the period end', m5 && m5.pay.periodEnd);

  // ---- failed renewal: swap to a card that fails, advance another month
  const badpm = await S('POST', 'payment_methods', { type: 'card', card: { token: 'tok_chargeCustomerFail' } }, acct).catch(() => null);
  if (badpm) {
    await S('POST', 'payment_methods/' + badpm.id + '/attach', { customer: cus.id }, acct).catch(() => null);
    await S('POST', 'customers/' + cus.id, { 'invoice_settings[default_payment_method]': badpm.id }, acct).catch(() => null);
    await S('POST', 'subscriptions/' + sub.id, { default_payment_method: badpm.id }, acct).catch(() => null);
    const s2 = await S('GET', 'subscriptions/' + sub.id, null, acct);
    await S('POST', 'test_helpers/test_clocks/' + clockC.id + '/advance', { frozen_time: s2.current_period_end + 3600 }, acct);
    for (let i = 0; i < 20; i++) { await wait(3000); const c = await S('GET', 'test_helpers/test_clocks/' + clockC.id, null, acct); if (c.status === 'ready') break; }
    await wait(3000);
    const types6 = await pump(acct);
    const m6 = DB['communities/qa-desk/members/buyer5'];
    ok(types6.includes('invoice.payment_failed') && m6.pay.status === 'past_due' && m6.status === 'active', 'failed renewal: invoice.payment_failed -> past_due, access kept for grace', { types6, st: m6.pay.status });
  } else ok(false, 'could not create a failing card');

  // ---- cancel (member action) on buyer1's real subscription, then period-end deletion
  const cc = await call('buyer1', { action: 'cancel', cid: 'qa-desk' }, qaBuyer(1));
  const subC = await S('GET', 'subscriptions/' + IDS.monthlySubscription, null, acct);
  ok(cc.cancelAtPeriodEnd === true && subC.cancel_at_period_end === true && DB['communities/qa-desk/members/buyer1'].status === 'active', 'member cancel: Stripe subscription set to cancel at period end, access kept');
  const portal = await call('buyer1', { action: 'portal', cid: 'qa-desk' }, qaBuyer(1)).catch((e) => ({ err: e.msg || e.message }));
  ok(portal && /billing\.stripe\.com/.test(portal.url || ''), 'Manage subscription -> real Stripe portal session on the creator account', portal);
  await S('DELETE', 'subscriptions/' + IDS.monthlySubscription, null, acct);
  await wait(3000); await pump(acct);
  ok(DB['communities/qa-desk/members/buyer1'].status === 'expired', 'subscription deleted (real) -> membership ended');

  // ---- dispute card 4000 0000 0000 0259 (browser pays buyer6)
  const c6 = await call('buyer6', { action: 'checkout', cid: 'qa-desk', planId: 'p2' }, qaBuyer(6));
  fs.writeFileSync('/tmp/t7-pay/dispute.json', JSON.stringify({ url: c6.url, sid: c6.sessionId }));
  console.log('WAITING_PAY dispute');
  const p6 = await paid(c6.sessionId);
  if (p6) {
    IDS.disputePaymentIntent = p6.payment_intent;
    let dtype = [];
    for (let i = 0; i < 12 && !(DB['communities/qa-desk/members/buyer6'] && DB['communities/qa-desk/members/buyer6'].pay.status === 'disputed'); i++) { await wait(5000); dtype = await pump(acct).then((x) => dtype.concat(x)); }
    const m6 = DB['communities/qa-desk/members/buyer6'];
    ok(m6 && m6.status === 'expired' && m6.pay.status === 'disputed', 'dispute card 0259: real charge.dispute.created -> access ended, sale disputed', { dtype, st: m6 && m6.pay });
  } else ok(false, 'dispute purchase paid');

  // ---- cleanup of probe artefacts we created on the platform
  try { await S('DELETE', 'test_helpers/test_clocks/' + IDS.testClock); } catch (e) {}
  done();
};
