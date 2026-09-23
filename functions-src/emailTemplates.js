/**
 * Welcome series for new free accounts: the five emails.
 *
 * render(step, ctx) -> { subject, preheader, html, text }
 *
 * COPY: every block marked [COPY PENDING] is a placeholder. The final text
 * comes from social-media-manager and must pass the content rules before it
 * replaces a placeholder:
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
function pending(label) {
  return `<p style="margin:0 0 16px;padding:12px 14px;border:1px dashed ${C.bear};border-radius:8px;` +
    `color:${C.bear};font-size:13px;line-height:1.5;font-family:Menlo,Consolas,monospace;">` +
    `[COPY PENDING: ${esc(label)}]</p>`;
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

const EMAILS = [
  // Day 0 — welcome + cheat sheet
  (ctx) => ({
    subject: 'Welcome to Stryker: your FVG & Order Block cheat sheet',
    preheader: 'Your free two-page cheat sheet is ready.',
    body:
      h1(`Welcome, ${esc(ctx.firstName)}.`) +
      pending('Day 0 welcome: who we are, what the free account includes, what the next emails cover') +
      p('Your free cheat sheet covers the rules we teach for Order Blocks (Chapter 09) and Fair Value Gaps (Chapter 10).') +
      button(link('/cheat-sheet', 0), 'Get the cheat sheet'),
    text: [
      `Welcome, ${ctx.firstName}.`,
      '[COPY PENDING: Day 0 welcome]',
      'Your free cheat sheet covers the rules we teach for Order Blocks (Chapter 09) and Fair Value Gaps (Chapter 10).',
      'Get it: ' + link('/cheat-sheet', 0)
    ]
  }),

  // Day 2 — free mini-lesson
  () => ({
    subject: 'A 5-minute lesson: what a fair value gap really is',
    preheader: 'The three-candle rule, in plain words.',
    body:
      h1('The three-candle rule') +
      pending('Day 2 mini-lesson on fair value gaps (original text, not pasted from the paid chapters)') +
      button(link('/learn/fair-value-gap', 2), 'Read the full lesson'),
    text: ['The three-candle rule', '[COPY PENDING: Day 2 mini-lesson]',
      'Read the full lesson: ' + link('/learn/fair-value-gap', 2)]
  }),

  // Day 5 — chart breakdown: liquidity sweep / stop hunt
  () => ({
    subject: 'Chart breakdown: how a stop hunt looks on the chart',
    preheader: 'Liquidity sweeps, step by step.',
    body:
      h1('Anatomy of a liquidity sweep') +
      pending('Day 5 chart breakdown: liquidity sweep / stop hunt, with a diagram image') +
      button(link('/learn/liquidity-sweeps', 5), 'See the full breakdown'),
    text: ['Anatomy of a liquidity sweep', '[COPY PENDING: Day 5 chart breakdown]',
      'See the full breakdown: ' + link('/learn/liquidity-sweeps', 5)]
  }),

  // Day 9 — proof: the instructor's real Tradeify payout certificates
  () => {
    const proofs = [1, 2, 3, 4];
    const imgs = proofs.map((n) =>
      `<td width="50%" style="padding:6px;"><img src="${SITE}/assets/images/proofs/proof-${n}.jpg" ` +
      `alt="Tradeify payout certificate ${n}" width="260" style="display:block;width:100%;max-width:260px;` +
      `height:auto;border:1px solid ${C.line};border-radius:8px;"></td>`);
    return {
      subject: 'Who teaches this: the payout certificates',
      preheader: 'Real funded-account payouts from Tradeify, issued to the instructor.',
      body:
        h1('Who is teaching you') +
        pending('Day 9 proof: introduce the instructor and the certificates; no profit or win-rate claims') +
        `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 12px;">` +
        `<tr>${imgs[0]}${imgs[1]}</tr><tr>${imgs[2]}${imgs[3]}</tr></table>` +
        `<p style="margin:0 0 20px;color:${C.ink2};font-size:12.5px;line-height:1.55;">These are real funded-account ` +
        `payouts issued by the prop firm Tradeify to the academy's instructor. They are not student results, and ` +
        `past results do not guarantee future results.</p>` +
        button(link('/#proof', 9), 'See all 14 certificates'),
      text: ['Who is teaching you', '[COPY PENDING: Day 9 proof]',
        "Real funded-account payouts issued by the prop firm Tradeify to the academy's instructor. Not student results; past results do not guarantee future results.",
        'See all 14 certificates: ' + link('/#proof', 9)]
    };
  },

  // Day 14 — the paid-plan offer (price read live when sending)
  (ctx) => {
    const o = ctx.offer || {};
    const price = o.priceLabel ? esc(o.priceLabel) : '[PRICE]';
    const was = o.wasLabel ? ` <span style="color:${C.ink3};text-decoration:line-through;">${esc(o.wasLabel)}</span>` : '';
    const url = link(o.planId ? '/checkout.html?plan=' + encodeURIComponent(o.planId) : '/#pricing', 14);
    return {
      subject: `The full desk is open: ${o.planName || '[PLAN]'} at ${o.priceLabel || '[PRICE]'}/month`,
      preheader: 'Everything beyond the free chapters, in one plan.',
      body:
        h1(`${esc(o.planName || '[PLAN]')}: the full curriculum`) +
        pending('Day 14 offer: what the plan adds over the free account, factual feature list only') +
        `<p style="margin:0 0 20px;color:${C.ink0};font-size:28px;font-weight:700;">${price}` +
        `<span style="font-size:15px;color:${C.ink2};font-weight:400;">/month</span>${was}</p>` +
        button(url, 'See the plan'),
      text: [`${o.planName || '[PLAN]'}: the full curriculum`, '[COPY PENDING: Day 14 offer]',
        `${o.priceLabel || '[PRICE]'}/month${o.wasLabel ? ' (was ' + o.wasLabel + ')' : ''}`, 'See the plan: ' + url]
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
  return /\[(COPY PENDING|POSTAL ADDRESS PENDING|PRICE|PLAN)\b/.test(r.html + r.text);
}

module.exports = { render, hasPlaceholders, DAYS, link };
