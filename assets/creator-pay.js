// TradeZoro Creator Hub: creator payments, client side (window.CP).
// Depends on: creator.js (CH), creator-config.js, firebase app/auth/firestore + firebase-functions-compat, progress.js (db).
// Used by: creator-hub.js (Payouts card, plan form), creator-c.js (Join · $X, member billing), creator-staff.js (Payouts tab).
// The server (functions-src/creatorPay.js, callable "creatorPay") is the only thing that moves money or grants paid
// access. This file only decides what to SHOW: settings/commerce.creatorPayments off = "Paid checkout opens soon" for
// everyone except TradeZoro admins and stryker-qa-* test users (the server applies the same gate).
(function (g) {
  var CFG = g.CREATOR_CONFIG || {};
  var CP = { MIN: CFG.PRICE_MIN || 1, MAX: CFG.PRICE_MAX || 999, TRIAL_MAX: CFG.TRIAL_MAX || 30, COUNTRIES: CFG.PAYOUT_COUNTRIES || [] };
  var E = function (s) { return g.CH ? CH.esc(s) : String(s == null ? '' : s); };
  var QA = /^stryker-qa-[a-z0-9._-]+@example\.com$/i;
  var openP = null;

  CP.STRIPE_PRICING = 'https://stripe.com/pricing';

  // The platform's legal name for creator payments: ONE setting, settings/commerce.creatorPlatformLegalName (public read).
  // Changing it in Firestore changes every text below on the next page load; no deploy. DEFAULT is only the fallback.
  CP.LEGAL_DEFAULT = 'Gaurav Singh LLC';
  CP.legal = CP.LEGAL_DEFAULT;
  CP.legalReady = Promise.resolve().then(function () {
    return db.collection('settings').doc('commerce').get().then(function (s) {
      var n = s.exists ? String(s.data().creatorPlatformLegalName || '').replace(/\s+/g, ' ').trim() : '';
      if (n && n.length <= 120) CP.legal = n;
    });
  }).catch(function () {});
  CP.platformLine = function () { return 'Payments processed by Stripe on the TradeZoro platform, operated by ' + CP.legal + '.'; };
  CP.SWITCHING = /being switched on/i;

  // Can THIS viewer use paid checkout / payouts right now? (display only; the server re-checks)
  CP.open = function (user) {
    if (openP) return openP;
    openP = CP.legalReady.then(function () {
      if (user && QA.test(user.email || '')) return true;
      return db.collection('settings').doc('commerce').get().then(function (s) {
        if (s.exists && s.data().creatorPayments === true) return true;
        if (!user) return false;
        return db.collection('admins').doc(user.uid).get().then(function (a) { return a.exists; }).catch(function () { return false; });
      }).catch(function () { return false; });
    });
    return openP;
  };

  CP.call = function (action, data) {
    var fns = null;
    try { fns = firebase.app().functions(); } catch (e) {}
    if (!fns) return Promise.reject({ message: 'Payments are not available on this page.' });
    return fns.httpsCallable('creatorPay')(Object.assign({ action: action }, data || {})).then(function (r) { return r.data; });
  };
  CP.errText = function (e) { return (e && e.message) ? String(e.message).replace(/^[a-z-]+: /, '') : 'Something went wrong. Try again.'; };

  // Sellable online: USD, monthly / yearly / one-time, $1..$999.
  CP.sellable = function (p) {
    var pr = p && p.price;
    return !!pr && pr.currency === 'USD' && ['month', 'year', 'lifetime'].indexOf(pr.interval) >= 0 && pr.amount >= CP.MIN && pr.amount <= CP.MAX;
  };
  CP.short = function (p) {
    var pr = p.price, a = '$' + (+pr.amount % 1 ? (+pr.amount).toFixed(2) : +pr.amount);
    return pr.interval === 'month' ? a + '/mo' : pr.interval === 'year' ? a + '/yr' : a + ' one-time';
  };

  var names = null;
  CP.countryName = function (c) {
    try { names = names || new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }); return names.of(c) || c; } catch (e) { return c; }
  };
  CP.countryOptions = function () {
    return CP.COUNTRIES.map(function (c) { return [c, CP.countryName(c)]; }).sort(function (a, b) { return a[1].localeCompare(b[1]); });
  };
  // Stripe requirement keys ("individual.verification.document") -> short readable words.
  CP.req = function (k) {
    var map = { external_account: 'Bank account for payouts', 'business_profile.url': 'Business website', 'business_profile.mcc': 'Business category', tos_acceptance: 'Stripe terms acceptance',
      'individual.verification.document': 'Photo ID', 'individual.id_number': 'ID number', 'individual.ssn_last_4': 'Last 4 of SSN', 'individual.address.line1': 'Address', 'individual.phone': 'Phone number', 'individual.email': 'Email' };
    if (map[k]) return map[k];
    if (/\.dob\./.test(k)) return 'Date of birth';
    return String(k).split('.').pop().replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });
  };
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }

  // ---------------------------------------------------------------- Creator Hub: Payouts card
  // el: container, ctx: { cid, me, onChange(account) }
  CP.payoutsCard = function (el, ctx) {
    el.innerHTML = '<div class="cx-box cp-card" aria-busy="true"><div class="cp-head"><h2>Payouts</h2></div><p class="cx-muted">Checking your payout status…</p></div>';
    var q = new URLSearchParams(location.search).get('payouts');
    // The status check must always end in a real state: a hard 15 s cap, then a retry card (never an endless "Checking…").
    var capped = function (p) { return Promise.race([p, new Promise(function (_, no) { setTimeout(function () { no({ message: 'timeout' }); }, 15000); })]); };
    return capped(CP.legalReady.then(function () { return CP.call('status'); })).then(function (r) {
      if (r.legalName) CP.legal = r.legalName;
      var acc = r.account || { status: 'none' };
      if (r.switchingOn) acc = Object.assign({}, acc, { switchingOn: true });
      render(el, ctx, acc);
      if (ctx.onChange) ctx.onChange(r.account);
      if (q === 'return' && r.account.status !== 'active') CH.toast('info', 'Thanks. Stripe is checking your details.');
      if (q === 'refresh') CH.toast('info', 'That setup link expired. Continue with a fresh one.');
    }).catch(function (e) {
      var slow = e && e.message === 'timeout';
      el.innerHTML = '<div class="cx-box cp-card"><div class="cp-head"><h2>Payouts</h2><span class="cp-chip warn">Not checked</span></div><p class="cp-lead" role="alert">' + (slow ? 'Stripe did not answer in time.' : E(CP.errText(e))) + ' Your community works as normal.</p><div class="cx-actions"><button class="btn btn-ghost" type="button" id="cp-retry">Try again</button></div></div>';
      var rt = el.querySelector('#cp-retry'); if (rt) rt.onclick = function () { CP.payoutsCard(el, ctx); };
    });
  };

  function terms() {
    return '<ul class="cp-terms">' +
      '<li><b>0% TradeZoro fee</b> during launch (Founding Creators).</li>' +
      '<li>Stripe\'s own processing fees apply and come out of your sales. <a href="' + CP.STRIPE_PRICING + '" target="_blank" rel="noopener">See Stripe pricing</a>.</li>' +
      '<li>You sell as an independent creator. You handle refunds, taxes and your own content.</li>' +
      '<li>Stripe checks your identity and pays out to your bank on its own schedule.</li>' +
      '<li>' + E(CP.platformLine()) + '</li></ul>';
  }
  function chip(status) {
    var t = { none: ['Not set up', ''], incomplete: ['Not finished', 'warn'], pending: ['Stripe is checking', 'warn'], active: ['Active', 'on'], restricted: ['Needs details', 'bad'], disabled: ['Off', 'bad'] }[status] || [status, ''];
    return '<span class="cp-chip ' + t[1] + '">' + E(t[0]) + '</span>';
  }
  function dueList(a) {
    var items = uniq((a.currentlyDue || []).map(CP.req));
    var errs = (a.errors || []).map(function (x) { return x.reason; }).filter(Boolean);
    var h = '';
    if (errs.length) h += '<ul class="cp-list cp-err">' + errs.map(function (x) { return '<li>' + E(x) + '</li>'; }).join('') + '</ul>';
    if (items.length) h += '<p class="cp-sub">Stripe still needs:</p><ul class="cp-list">' + items.map(function (x) { return '<li>' + E(x) + '</li>'; }).join('') + '</ul>';
    return h;
  }

  function render(el, ctx, a) {
    var h = '<div class="cx-box cp-card"><div class="cp-head"><h2>Payouts</h2>' + chip(a.status) + '</div>';
    if (a.switchingOn && (a.status === 'none' || a.status === 'incomplete')) {
      h += '<p class="cp-lead" role="status"><b>Payouts are being switched on.</b> We are finishing the payment setup with Stripe. Your community works as normal. Come back soon to set up payouts.</p>' + terms();
    } else if (a.status === 'none') {
      h += '<p class="cp-lead">Get paid for your paid plans. Payments run through Stripe, straight to your own Stripe account.</p>' + terms() +
        '<form class="cx-f cp-form" id="cp-f" novalidate><div><label for="cp-country">Country where you or your business is based</label><select id="cp-country"><option value="">Choose a country</option>' +
        CP.countryOptions().map(function (c) { return '<option value="' + c[0] + '">' + E(c[1]) + '</option>'; }).join('') +
        '<option value="IN">India</option><option value="other">Another country</option></select><div class="hint" id="cp-chint">Stripe asks for ID and bank details on its own secure page.</div></div>' +
        '<label class="cx-check"><input type="checkbox" id="cp-agree"><span>I agree to the <a href="/creator-rules" target="_blank" rel="noopener">Creator Rules</a> and I sell as an independent creator.</span></label>' +
        '<div id="cp-err" class="cx-bad" role="alert"></div><div class="cx-actions"><button class="btn btn-primary" type="submit" id="cp-go">Connect Stripe</button></div></form>';
    } else if (a.status === 'incomplete') {
      h += '<p class="cp-lead">You started setting up payouts with Stripe but didn\'t finish.</p>' + dueList(a) + '<div class="cx-actions"><button class="btn btn-primary" type="button" id="cp-go">Continue setup</button></div>';
    } else if (a.status === 'pending') {
      h += '<p class="cp-lead">Stripe is checking your details. This usually takes a few minutes, sometimes a few days. We\'ll update this card when it\'s done.</p>' +
        ((a.pendingVerification || []).length ? '<p class="cp-sub">Being checked:</p><ul class="cp-list">' + uniq(a.pendingVerification.map(CP.req)).map(function (x) { return '<li>' + E(x) + '</li>'; }).join('') + '</ul>' : '') +
        '<div class="cx-actions"><button class="btn btn-ghost" type="button" id="cp-go">Review details on Stripe</button></div>';
    } else if (a.status === 'restricted') {
      h += '<p class="cp-lead">Stripe needs more information before you can take payments' + (a.currentDeadline ? ' (by ' + E(new Date(a.currentDeadline * 1000).toLocaleDateString()) + ')' : '') + '.</p>' + dueList(a) +
        '<div class="cx-actions"><button class="btn btn-primary" type="button" id="cp-go">Update details</button></div>';
    } else if (a.status === 'disabled') {
      h += '<p class="cp-lead">Stripe has turned off payments on this account' + (a.disabledReason ? ' (' + E(String(a.disabledReason).replace(/[._]/g, ' ')) + ')' : '') + '. Contact Stripe support from your Stripe Dashboard. Your community keeps working with free plans and invites.</p>' +
        '<div class="cx-actions"><button class="btn btn-ghost" type="button" id="cp-dash">Open Stripe dashboard</button></div>';
    } else if (a.status === 'active') {
      h += '<p class="cp-lead">You can sell paid plans. Stripe pays out to your bank automatically.</p>' +
        '<div class="cx-actions"><button class="btn btn-ghost" type="button" id="cp-dash">Open Stripe dashboard</button></div>' +
        '<h3 class="cp-h3">Recent sales</h3><div id="cp-sales"><p class="cx-muted">Loading…</p></div>';
    }
    h += '</div>';
    el.innerHTML = h;
    var go = el.querySelector('#cp-go'), dash = el.querySelector('#cp-dash');
    if (a.status === 'none') {
      var sel = el.querySelector('#cp-country'), hint = el.querySelector('#cp-chint');
      sel.onchange = function () {
        hint.className = 'hint';
        if (sel.value === 'IN') { hint.className = 'hint cp-warn'; hint.textContent = 'Payouts for India-based creators aren\'t available yet: Stripe accounts in India are invite-only. Keep your community free or invite-only for now.'; }
        else if (sel.value === 'other') { hint.className = 'hint cp-warn'; hint.textContent = 'Payouts aren\'t available in your country yet. Keep your community free or invite-only for now.'; }
        else hint.textContent = 'Stripe asks for ID and bank details on its own secure page.';
        go.disabled = sel.value === 'IN' || sel.value === 'other';
      };
      el.querySelector('#cp-f').onsubmit = function (e) {
        e.preventDefault(); var err = el.querySelector('#cp-err'); err.textContent = '';
        if (!sel.value) return (err.textContent = 'Choose your country.');
        if (!el.querySelector('#cp-agree').checked) return (err.textContent = 'Tick the box to agree to the Creator Rules.');
        busy(go, 'Opening Stripe…');
        CP.call('onboard', { cid: ctx.cid, country: sel.value, agree: true }).then(function (r) { location.href = r.url; })
          .catch(function (x) { unbusy(go, 'Connect Stripe'); err.textContent = CP.errText(x); });
      };
    } else if (go) {
      var label = go.textContent;
      go.onclick = function () { busy(go, 'Opening Stripe…'); CP.call('onboard', { cid: ctx.cid }).then(function (r) { location.href = r.url; }).catch(function (x) { unbusy(go, label); CH.toast('error', CP.errText(x)); }); };
    }
    if (dash) dash.onclick = function () { busy(dash, 'Opening…'); CP.call('dashboard').then(function (r) { unbusy(dash, 'Open Stripe dashboard'); window.open(r.url, '_blank', 'noopener'); }).catch(function (x) { unbusy(dash, 'Open Stripe dashboard'); CH.toast('error', CP.errText(x)); }); };
    if (a.status === 'active') sales(el.querySelector('#cp-sales'), ctx);
  }
  function busy(b, t) { b.disabled = true; b.dataset.l = b.textContent; b.textContent = t; }
  function unbusy(b, t) { b.disabled = false; b.textContent = t || b.dataset.l; }

  function sales(box, ctx) {
    db.collection('creatorSales').where('creatorUid', '==', ctx.me.uid).limit(100).get().then(function (s) {
      var rows = s.docs.map(function (d) { return d.data(); }).sort(function (a, b) { return (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0) - (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0); }).slice(0, 12);
      if (!rows.length) { box.innerHTML = '<p class="cx-muted">No sales yet. They show here as soon as Stripe confirms a payment.</p>'; return; }
      var st = { paid: '', refunded: 'Refunded', partially_refunded: 'Part refunded', disputed: 'Disputed' };
      box.innerHTML = '<ul class="cp-sales">' + rows.map(function (r) {
        var kind = r.kind === 'renewal' ? 'Renewal' : r.kind === 'one_time' ? 'One-time' : 'New member';
        return '<li><div class="cp-s-main"><span class="cp-s-t">' + E(r.planName || r.planId) + ' · ' + E(kind) + '</span><span class="cp-s-d">' + E(r.cid) + ' · ' + E(CH.date(r.createdAt)) + (st[r.status] ? ' · <span class="' + (r.status === 'disputed' ? 'cx-bad' : 'cp-amber') + '">' + st[r.status] + '</span>' : '') + '</span></div>' +
          '<span class="cp-s-a">$' + (r.amountCents / 100).toFixed(2) + '</span></li>';
      }).join('') + '</ul><p class="cp-foot">Amounts before Stripe\'s fees. Full details, refunds and payouts are in your Stripe Dashboard.</p>';
    }).catch(function () { box.innerHTML = '<p class="cx-muted">Could not load sales.</p>'; });
  }

  // ---------------------------------------------------------------- Community page: member billing box
  CP.memberBox = function (cm, mem) {
    var p = mem.pay || {}, until = function (ms) { return ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };
    var line = '';
    if (p.kind === 'one_time') line = 'One-time purchase. Access has no end date.';
    else if (p.status === 'past_due') line = '<span class="cp-amber">Your last payment failed.</span> Update your card by ' + until(p.graceUntil) + ' to keep access.';
    else if (p.status === 'trialing') line = 'Free trial. First charge on ' + until(p.periodEnd) + (p.cancelAtPeriodEnd ? ' (cancelled, so no charge; access ends then).' : '.');
    else if (p.cancelAtPeriodEnd) line = 'Cancelled. Access ends on ' + until(p.periodEnd) + '.';
    else line = 'Renews on ' + until(p.periodEnd) + '.';
    var h = '<div class="cp-mem"><p class="cx-muted">' + line + '</p>';
    if (p.kind === 'subscription') {
      h += '<div class="cp-mem-act"><button class="btn btn-ghost" type="button" id="cp-portal">Manage subscription</button>' +
        (p.cancelAtPeriodEnd ? '<button class="btn btn-ghost" type="button" id="cp-resume">Resume</button>' : '<button class="btn btn-ghost" type="button" id="cp-cancel">Cancel</button>') + '</div>';
    }
    h += '<p class="cp-foot">Sold by ' + E(cm.ownerName || 'the creator') + ', an independent creator. ' + E(CP.platformLine()) + ' Refunds: ask the creator first.</p></div>';
    return h;
  };
  CP.bindMember = function (root, cid) {
    var po = root.querySelector('#cp-portal'), ca = root.querySelector('#cp-cancel'), re = root.querySelector('#cp-resume');
    if (po) po.onclick = function () { busy(po, 'Opening…'); CP.call('portal', { cid: cid }).then(function (r) { location.href = r.url; }).catch(function (x) { unbusy(po); CH.toast('error', CP.errText(x)); }); };
    if (ca) ca.onclick = function () {
      if (!confirm('Cancel your subscription? You keep access until the end of the period you paid for.')) return;
      busy(ca, 'Cancelling…'); CP.call('cancel', { cid: cid }).then(function () { CH.toast('success', 'Cancelled. Access runs to the end of your period.'); setTimeout(function () { location.reload(); }, 600); }).catch(function (x) { unbusy(ca); CH.toast('error', CP.errText(x)); });
    };
    if (re) re.onclick = function () { busy(re, 'Resuming…'); CP.call('cancel', { cid: cid, resume: true }).then(function () { location.reload(); }).catch(function (x) { unbusy(re); CH.toast('error', CP.errText(x)); }); };
  };

  // After Stripe Checkout returns (?paid=1): wait for the webhook to add the member, then reload.
  CP.awaitJoin = function (cid, uid, done) {
    var n = 0;
    (function tick() {
      db.collection('communities').doc(cid).collection('members').doc(uid).get().then(function (m) {
        if (m.exists && m.data().source === 'paid' && m.data().status === 'active') return done(true);
        if (++n > 20) return done(false);
        setTimeout(tick, 1500);
      }).catch(function () { if (++n > 20) return done(false); setTimeout(tick, 1500); });
    })();
  };

  g.CP = CP;
})(window);
