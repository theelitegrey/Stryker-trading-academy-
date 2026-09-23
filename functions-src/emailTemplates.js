/**
 * Welcome series for new free accounts: the five emails.
 *
 * render(step, ctx) -> { subject, preheader, html, text }
 *
 * COPY: final text from social-media-manager (see the note above EMAILS).
 * Any edit must keep to the content rules:
 *   - no profit, income or win-rate claims; no invented numbers
 *   - no mention of video lessons / courses on video
 *   - payout certificates (day 9) are described only as the instructor's
 *     own Tradeify payouts, never as student results
 * The footer (sender identity, postal address, unsubscribe, disclaimer) is
 * not copy: it is required on every email and is built here, not edited.
 *
 * Links carry utm_source=email&utm_medium=welcome&utm_campaign=day<N>.
 * Pure module: no Firebase, no network. tools/preview-emails.js renders it
 * locally, and welcomeEmails.js sends it.
 */
'use strict';

const SITE = 'https://strykertrading.com';
const DAYS = [0, 2, 5, 9, 14];

// Brand colours are inlined (email clients ignore <style> blocks unevenly).
const C = {
  bg: '#0b0b0d', card: '#131316', line: '#2c2c32', ink0: '#eeeeee', ink1: '#c9cdd3',
  ink2: '#8b93a0', ink3: '#6b7280', gold: '#03c988', goldDim: '#027a54', bear: '#e5484d'
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Site link with the email UTM tags for this step (keeps any existing query).
function link(path, day) {
  const u = new URL(path, SITE);
  u.searchParams.set('utm_source', 'email');
  u.searchParams.set('utm_medium', 'welcome');
  u.searchParams.set('utm_campaign', 'day' + day);
  return u.toString();
}

function p(html) {
  return `<p style="margin:0 0 16px;color:${C.ink1};font-size:15px;line-height:1.65;">${html}</p>`;
}
function button(href, label) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;"><tr>` +
    `<td style="border-radius:8px;background:${C.gold};">` +
    `<a href="${esc(href)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;` +
    `color:#04140d;text-decoration:none;border-radius:8px;">${esc(label)}</a></td></tr></table>`;
}
function h1(t) {
  return `<h1 style="margin:0 0 16px;color:${C.ink0};font-size:24px;line-height:1.25;font-weight:700;">${t}</h1>`;
}

// ---- The five emails -------------------------------------------------------
// Copy: social-media-manager, /root/projects/stryker-notes/social-strategy/
// emails/welcome-series.md (2026-09-23), with these factual corrections:
//   - the free plan is called "Starter" on the live site (not "Self-Paced");
//   - a free account reads chapters 1-7 only, so the Day 2 and Day 5 links go
//     to the free public Learn articles, not the locked Chapters 10 and 12;
//   - Day 14 takes the plan's name, price and feature list from the plan
//     record at send time instead of a hardcoded "Desk $49" list, so the
//     email can never disagree with the pricing page.

// Paragraphs are plain text; each becomes one <p> in HTML and one block in
// the text version, so the two can never drift apart.
function paras(list) { return list.map((t) => p(esc(t))).join(''); }
function signoff() { return p(esc('— Stryker Trading Academy')); }

const EMAILS = [
  // Day 0 — welcome + cheat sheet
  () => {
    const intro = [
      'Hey — welcome to Stryker Trading Academy.',
      "You've got full access to the free Starter plan: chapters 1 through 7, covering how institutional order flow actually works, liquidity, and the foundations everything else builds on. Start there if you're new to any of this — the chapters are built to be read in order.",
      "To go with it, here's a 2-page cheat sheet on two of the most useful ideas in the curriculum: Fair Value Gaps and Order Blocks. Keep it next to your charts."
    ];
    const outro = [
      "Over the next two weeks we'll send a few more things: a practical mini lesson, a real chart breakdown, and — because we know \"trust me\" isn't worth much — some actual proof behind who's teaching this.",
      'For now, just start reading. Chapter 1 is a good place.'
    ];
    const url = link('/cheat-sheet', 0);
    return {
      subject: "Welcome to Stryker — here's your first download",
      preheader: 'Your FVG & Order Block cheat sheet, plus what to read first.',
      body: paras(intro) + button(url, 'Get the cheat sheet') + paras(outro) + signoff(),
      text: intro.concat(['Get the cheat sheet: ' + url], outro, ['— Stryker Trading Academy'])
    };
  },

  // Day 2 — free mini-lesson
  () => {
    const body = [
      'Quick one today — a single idea you can start looking for on a chart right away: the Fair Value Gap.',
      "A Fair Value Gap (FVG) is a precise three-candle pattern. Look at candle one and candle three — specifically their wicks. If they don't overlap, if there's real empty space between them, the middle candle's aggressive move created a gap. That's it. Not a guess, not a feeling — a mechanical check you can run on any chart.",
      'Why it matters: that gap represents real imbalance between buying and selling pressure, and price often returns to it later. Not because markets "remember" anything mystical, but because unfilled orders and reference points tend to sit inside these gaps.',
      "Treat an FVG as either a potential entry zone (in the direction of your bias) or a potential price target (in the opposite direction). It's most useful stacked with other signals — an FVG inside an order block carries more weight than one sitting alone.",
      'We wrote up the full breakdown, with diagrams, as a free guide if you want to go deeper.'
    ];
    const url = link('/learn-fair-value-gap', 2);
    return {
      subject: 'The gap price keeps coming back to',
      preheader: 'What a Fair Value Gap actually is, in one read.',
      body: paras(body) + button(url, 'Read the full guide') + signoff(),
      text: body.concat(['Read the full guide: ' + url, '— Stryker Trading Academy'])
    };
  },

  // Day 5 — chart breakdown: liquidity sweep / stop hunt
  () => {
    const body = [
      "You've probably had this happen: price runs just past an obvious high or low, taps your stop, then reverses hard in the direction you originally wanted. Infuriating — and also explainable.",
      "It's called a liquidity sweep. Traders who buy above a swing low put their stop-loss just below it. Enough traders doing this in the same area builds a cluster of resting sell orders — a pool of liquidity a larger order can use to fill itself. The same thing happens in reverse above swing highs.",
      "A genuine sweep has three parts, in sequence: price wicks through the level, closes back on the original side of it, and then reverses with real conviction — not a slow drift back. All three need to be present. A wick through without a clean close-back is ambiguous; it might just be a real breakout instead.",
      "The practical fix isn't to move your stop further away and hope. It's to wait for confirmation — the order block or fair value gap the reversal leaves behind — rather than reacting to the sweep itself as a signal. That's the difference between guessing at the exact bottom and taking a structural entry with a defined invalidation point.",
      'Full walkthrough, with diagrams, in our free guide.'
    ];
    const url = link('/learn-liquidity-sweeps', 5);
    return {
      subject: 'Why your stop got hit right before price reversed',
      preheader: 'The mechanics behind a liquidity sweep, broken down.',
      body: paras(body) + button(url, 'Read the walkthrough') + signoff(),
      text: body.concat(['Read the walkthrough: ' + url, '— Stryker Trading Academy'])
    };
  },

  // Day 9 — proof: the instructor's real Tradeify payout certificates
  () => {
    // Four certificates with the same 900x535 shape, so the grid lines up.
    const imgs = [1, 3, 4, 5].map((n) =>
      `<td width="50%" style="padding:6px;"><img src="${SITE}/assets/images/proofs/proof-${n}.jpg" ` +
      `alt="Tradeify payout certificate" width="260" style="display:block;width:100%;max-width:260px;` +
      `height:auto;border:1px solid ${C.line};border-radius:8px;"></td>`);
    const a = [
      "We could tell you this curriculum works. Instead, here's something you can actually check.",
      "These are real funded-account payout certificates, issued directly by the prop firm Tradeify — not student results, not projections, not a screenshot from someone else's account. They're proof that the person teaching this curriculum trades it themselves, under real prop-firm rules, with real money on the other end of the wire."
    ];
    const b = [
      "We're not going to tell you what your win rate will be, or promise you'll see a payout of your own — that depends entirely on how you trade, and anyone who tells you otherwise is selling something. What we can tell you is that the curriculum you're reading is built by someone with actual funded-account track record behind it, not just theory.",
      "If you haven't started the chapters yet, this is a good moment to pick it back up."
    ];
    const proof = link('/#proof', 9);
    const cur = link('/courses.html', 9);
    return {
      subject: 'Proof, not promises',
      preheader: 'Real payout certificates from the person teaching this curriculum.',
      body:
        paras(a) +
        `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 12px;">` +
        `<tr>${imgs[0]}${imgs[1]}</tr><tr>${imgs[2]}${imgs[3]}</tr></table>` +
        button(proof, 'See the payout certificates') + paras(b) +
        button(cur, 'Continue the curriculum') + signoff(),
      text: a.concat(['See the payout certificates: ' + proof], b,
        ['Continue the curriculum: ' + cur, '— Stryker Trading Academy'])
    };
  },

  // Day 14 — the paid-plan offer. Name, price and features come from the
  // plan record at send time (ctx.offer); an optional second plan
  // (ctx.alsoOffer) gets one line.
  (ctx) => {
    const o = ctx.offer || {};
    const name = o.planName || '[PLAN]';
    const price = o.priceLabel || '[PRICE]';
    const feats = (o.features && o.features.length) ? o.features : ['[PLAN FEATURES]'];
    const url = link(o.planId ? '/checkout.html?plan=' + encodeURIComponent(o.planId) : '/#pricing', 14);
    // While a sale runs (wasLabel set) both price lines say "at the launch price" and give the
    // regular price, so they stay true after the launch spots are gone (content gate 2026-09-23).
    const priceLine = `The ${name} plan is ${price}/month` +
      (o.wasLabel ? ` at the launch price (usually ${o.wasLabel})` : '') + ' and includes:';
    const a = ["Two weeks in — no pitch today, just information in case you're wondering what's beyond the free plan."];
    const b = [
      `That's the whole list — nothing hidden, nothing "unlocked later." If you're getting real value from the free chapters and want the rest of the curriculum, this is what that looks like.`,
      "If you're not ready, that's completely fine — the free chapters and everything we've sent you stay yours either way, no expiration, no pressure to upgrade."
    ];
    const al = ctx.alsoOffer;
    const hasAlso = !!(al && al.planName && al.priceLabel);
    const alsoPrice = hasAlso && al.wasLabel
      ? `, ${al.priceLabel}/month at the launch price, usually ${al.wasLabel},`
      : (hasAlso ? ` at ${al.priceLabel}/month,` : '');
    const alsoLead = hasAlso ? `(There's also the ${al.planName} plan${alsoPrice} if you want more than ${name} includes. Both are on the ` : '';
    const pricing = link('/#pricing', 14);
    const also = hasAlso ? [alsoLead + 'pricing page: ' + pricing + ')'] : [];
    const alsoHtml = hasAlso ? p(esc(alsoLead) + `<a href="${esc(pricing)}" style="color:${C.gold};">pricing page</a>.)`) : '';
    const c = ['Either way, thanks for spending two weeks with the curriculum. We mean that.'];
    const list = `<ul style="margin:0 0 16px;padding-left:20px;color:${C.ink1};font-size:15px;line-height:1.65;">` +
      feats.map((f) => `<li style="margin:0 0 4px;">${esc(f)}</li>`).join('') + '</ul>';
    return {
      subject: `What's in the ${name} plan, if you want to go further`,
      preheader: 'No pressure — just what you get, in plain terms.',
      body: paras(a) + p(esc(priceLine)) + list + paras(b) + button(url, `See the ${name} plan`) +
        alsoHtml + paras(c) + signoff(),
      text: a.concat([priceLine], feats.map((f) => '- ' + f), b, [`See the ${name} plan: ` + url], also, c,
        ['— Stryker Trading Academy'])
    };
  }
];

// ---- Frame + legally required footer ---------------------------------------

function footer(ctx, day) {
  const addr = ctx.postalAddress ? esc(ctx.postalAddress) : '[POSTAL ADDRESS PENDING]';
  return `<tr><td style="padding:22px 28px 30px;border-top:1px solid ${C.line};color:${C.ink3};font-size:12px;line-height:1.6;">` +
    `<p style="margin:0 0 8px;"><strong style="color:${C.ink2};">Education only. Not financial advice.</strong> ` +
    `Trading carries a high level of risk and may not be suitable for everyone.</p>` +
    `<p style="margin:0 0 8px;">You're getting this because you created a free account at ` +
    `<a href="${link('/', day)}" style="color:${C.ink2};">strykertrading.com</a>. ` +
    `This is email ${day === 14 ? 5 : DAYS.indexOf(day) + 1} of 5 in the welcome series.</p>` +
    `<p style="margin:0 0 8px;"><a href="${esc(ctx.unsubscribeUrl)}" style="color:${C.ink2};text-decoration:underline;">` +
    `Unsubscribe</a> (one click, and you won't get any more of these).</p>` +
    `<p style="margin:0;">Stryker Trading, operating as Stryker Trading Academy · ${addr}</p></td></tr>`;
}

function render(step, ctx) {
  if (!(step >= 0 && step < EMAILS.length)) throw new Error('no such step ' + step);
  const day = DAYS[step];
  const e = EMAILS[step](ctx);
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light">` +
    `<title>${esc(e.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(e.preheader)}</div>` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${C.bg};">` +
    `<tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" ` +
    `style="max-width:600px;background:${C.card};border:1px solid ${C.line};border-radius:14px;">` +
    `<tr><td style="padding:24px 28px 8px;"><a href="${link('/', day)}">` +
    `<img src="${SITE}/assets/images/logo-header.png" alt="Stryker Trading Academy" height="28" ` +
    `style="display:block;height:28px;width:auto;border:0;"></a></td></tr>` +
    `<tr><td style="padding:16px 28px 8px;">${e.body}</td></tr>` +
    footer(ctx, day) +
    `</table></td></tr></table></body></html>`;
  const text = e.text.concat([
    '', '--', 'Education only. Not financial advice.',
    "You're getting this because you created a free account at strykertrading.com.",
    'Unsubscribe: ' + ctx.unsubscribeUrl,
    'Stryker Trading, operating as Stryker Trading Academy · ' + (ctx.postalAddress || '[POSTAL ADDRESS PENDING]')
  ]).join('\n\n');
  return { subject: e.subject, preheader: e.preheader, html, text };
}

// True while any placeholder is still in the output; the sender refuses to
// send such an email.
function hasPlaceholders(r) {
  return /\[(COPY PENDING|POSTAL ADDRESS PENDING|PRICE|PLAN|PLAN FEATURES)\b/.test(r.html + r.text);
}

module.exports = { render, hasPlaceholders, DAYS, link };
