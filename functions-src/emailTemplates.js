/**
 * Welcome series for new free accounts: the five emails.
 *
 * render(step, ctx) -> { subject, preheader, html, text }
 *
 * DESIGN (2026-09-24 redesign): every email is a list of blocks (eyebrow, H1,
 * lead, section heading, numbered steps, check list, image, callout, pricing
 * card, one big CTA). Each block renders both its HTML and its plain-text
 * form, so the two versions can never drift apart.
 *   - 600px max width, body text 16px+, table layout with inline styles
 *     (email clients drop <style> unevenly), bulletproof full-width button.
 *   - Dark-native, like the site. No background images or colour hacks, so a
 *     client that inverts or keeps colours (Gmail light/dark, web/iOS/Android)
 *     changes text and backgrounds together and the email stays readable.
 *   - Images are the site's own: the logo, the cheat-sheet cover, two diagrams
 *     rasterised from the Learn articles (assets/images/email/), and the
 *     payout certificates. Every image has alt text. No AI images.
 *
 * COPY rules (content-developer is the approval gate for any wording change):
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
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Brand colours are inlined (email clients ignore <style> blocks unevenly).
const C = {
  bg: '#0b0b0d', card: '#131316', panel: '#1a1a1f', line: '#2c2c32',
  ink0: '#f2f3f5', ink1: '#d4d7dc', ink2: '#9aa1ad', ink3: '#8a909b',
  gold: '#03c988', goldInk: '#04140d', goldSoft: '#0f2a21'
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

function num(label) {
  const n = parseFloat(String(label == null ? '' : label).replace(/[^0-9.]/g, ''));
  return isFinite(n) ? n : null;
}

// ---- Blocks: each returns { html, text } -----------------------------------

const TXT = `color:${C.ink1};font-family:${FONT};font-size:16px;line-height:1.6;`;
const TABLE = 'role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"';

const B = {
  eyebrow: (t) => ({
    html: `<p style="margin:0 0 10px;color:${C.gold};font-family:${FONT};font-size:13px;line-height:1.4;` +
      `font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">${esc(t)}</p>`,
    text: null
  }),
  h1: (t) => ({
    html: `<h1 style="margin:0 0 18px;color:${C.ink0};font-family:${FONT};font-size:28px;line-height:1.22;` +
      `font-weight:800;letter-spacing:-0.3px;">${esc(t)}</h1>`,
    text: t.toUpperCase()
  }),
  h2: (t) => ({
    html: `<h2 style="margin:28px 0 12px;color:${C.ink0};font-family:${FONT};font-size:20px;line-height:1.3;` +
      `font-weight:700;">${esc(t)}</h2>`,
    text: '## ' + t
  }),
  lead: (t) => ({
    html: `<p style="margin:0 0 20px;color:${C.ink0};font-family:${FONT};font-size:18px;line-height:1.55;">${esc(t)}</p>`,
    text: t
  }),
  p: (t) => ({ html: `<p style="margin:0 0 16px;${TXT}">${esc(t)}</p>`, text: t }),
  // A paragraph ending in an inline text link (secondary; the big CTA stays the one button).
  pLink: (t, label, href, after) => ({
    html: `<p style="margin:0 0 16px;${TXT}">${esc(t)} <a href="${esc(href)}" ` +
      `style="color:${C.gold};font-weight:700;text-decoration:underline;">${esc(label)}</a>${esc(after || '')}</p>`,
    text: `${t} ${label} (${href})${after || ''}`
  }),
  // Numbered steps: [{ title, text }]
  steps: (items) => ({
    html: `<table ${TABLE} style="margin:0 0 8px;">` +
      items.map((s, i) =>
        `<tr><td width="44" valign="top" style="padding:0 12px 16px 0;">` +
        `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>` +
        `<td width="32" height="32" align="center" valign="middle" bgcolor="${C.gold}" style="width:32px;height:32px;` +
        `border-radius:16px;background:${C.gold};color:${C.goldInk};font-family:${FONT};font-size:16px;font-weight:800;` +
        `line-height:32px;">${i + 1}</td></tr></table></td>` +
        `<td valign="top" style="padding:4px 0 16px;">` +
        `<p style="margin:0 0 4px;color:${C.ink0};font-family:${FONT};font-size:17px;line-height:1.4;font-weight:700;">${esc(s.title)}</p>` +
        (s.text ? `<p style="margin:0;${TXT}">${esc(s.text)}</p>` : '') +
        `</td></tr>`).join('') + `</table>`,
    text: items.map((s, i) => `${i + 1}. ${s.title}` + (s.text ? `\n   ${s.text}` : '')).join('\n')
  }),
  checks: (items) => ({
    html: `<table ${TABLE} style="margin:0 0 8px;">` +
      items.map((t) =>
        `<tr><td width="28" valign="top" style="padding:0 8px 10px 0;color:${C.gold};font-family:${FONT};` +
        `font-size:17px;line-height:1.5;font-weight:800;">&#10003;</td>` +
        `<td valign="top" style="padding:0 0 10px;${TXT}">${esc(t)}</td></tr>`).join('') + `</table>`,
    text: items.map((t) => '✓ ' + t).join('\n')
  }),
  img: (src, alt, w, h, caption, href) => {
    const im = `<img src="${esc(src)}" alt="${esc(alt)}" width="${w}" height="${h}" style="display:block;width:100%;` +
      `max-width:${w}px;height:auto;border:0;border-radius:10px;margin:0 auto;">`;
    return {
      html: `<table ${TABLE} style="margin:4px 0 20px;">` +
        `<tr><td align="center">${href ? `<a href="${esc(href)}">${im}</a>` : im}</td></tr>` +
        (caption ? `<tr><td style="padding:10px 4px 0;color:${C.ink2};font-family:${FONT};font-size:14px;line-height:1.5;` +
          `text-align:center;">${esc(caption)}</td></tr>` : '') + `</table>`,
      text: caption ? `[Diagram] ${caption}` : `[Image: ${alt}]`
    };
  },
  callout: (t) => ({
    html: `<table ${TABLE} style="margin:4px 0 20px;">` +
      `<tr><td bgcolor="${C.goldSoft}" style="border-left:4px solid ${C.gold};background:${C.goldSoft};border-radius:0 8px 8px 0;` +
      `padding:14px 16px;color:${C.ink0};font-family:${FONT};font-size:16px;line-height:1.6;">${esc(t)}</td></tr></table>`,
    text: '> ' + t
  }),
  // The one big full-width button per email.
  cta: (href, label) => ({
    html: `<table ${TABLE} style="margin:8px 0 24px;">` +
      `<tr><td align="center" bgcolor="${C.gold}" style="border-radius:10px;background:${C.gold};">` +
      `<a href="${esc(href)}" style="display:block;padding:17px 20px;color:${C.goldInk};font-family:${FONT};` +
      `font-size:18px;line-height:1.2;font-weight:800;text-align:center;text-decoration:none;border-radius:10px;">` +
      `${esc(label)} &rarr;</a></td></tr></table>`,
    text: `>> ${label}: ${href}`
  }),
  raw: (html, text) => ({ html, text })
};

function signoff() { return B.p('— Stryker Trading Academy'); }

// Day 0 visual: the cheat-sheet cover beside what's in it. The two cells are
// inline-block with max-widths, so they sit side by side at 600px and stack
// on a phone.
function cheatSheetCard(url) {
  const alt = 'Cover of the Stryker Fair Value Gap and Order Block cheat sheet';
  const html =
    `<table ${TABLE} bgcolor="${C.panel}" style="margin:4px 0 8px;background:${C.panel};border:1px solid ${C.line};` +
    `border-radius:12px;"><tr><td align="center" style="padding:18px 14px 10px;">` +
    `<div style="display:inline-block;width:100%;max-width:170px;vertical-align:top;margin:0 0 12px;">` +
    `<a href="${esc(url)}"><img src="${SITE}/assets/images/cheatsheet-preview.jpg" alt="${esc(alt)}" width="170" height="240" ` +
    `style="display:block;width:100%;max-width:170px;height:auto;border:0;border-radius:6px;margin:0 auto;"></a></div>` +
    `<div style="display:inline-block;width:100%;max-width:330px;vertical-align:top;text-align:left;">` +
    `<table ${TABLE}><tr><td style="padding:0 4px 0 14px;">` +
    `<p style="margin:0 0 6px;color:${C.gold};font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:1.5px;` +
    `text-transform:uppercase;">Free PDF · 2 pages</p>` +
    `<p style="margin:0 0 12px;color:${C.ink0};font-family:${FONT};font-size:20px;line-height:1.3;font-weight:800;">` +
    `Fair Value Gaps &amp; Order Blocks</p>` +
    B.checks(['Two of the most useful ideas in the curriculum', 'Short enough to keep next to your charts']).html +
    `</td></tr></table></div></td></tr></table>`;
  return { html, text: 'Your cheat sheet: Fair Value Gaps & Order Blocks (free PDF, 2 pages).' };
}

// Day 14 visual: a pricing card that mirrors the site's plan card: badge,
// plan name, launch price with the struck "was" price, feature checks and a
// full-width button.
function pricingCard(o, url) {
  const now = num(o.priceLabel), was = num(o.wasLabel);
  const off = (now != null && was != null && was > now) ? Math.round((1 - now / was) * 100) : null;
  const badge = off ? `${off}% OFF · Launch price` : null;
  const feats = (o.features && o.features.length) ? o.features : ['[PLAN FEATURES]'];
  const label = `Get ${o.planName} for ${o.priceLabel}/month`;
  const html =
    `<table ${TABLE} bgcolor="${C.panel}" style="margin:6px 0 20px;background:${C.panel};border:2px solid ${C.gold};` +
    `border-radius:14px;"><tr><td style="padding:22px 20px 4px;">` +
    (badge ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 14px;"><tr>` +
      `<td bgcolor="${C.gold}" style="background:${C.gold};border-radius:999px;padding:5px 12px;color:${C.goldInk};` +
      `font-family:${FONT};font-size:13px;font-weight:800;letter-spacing:0.5px;">${esc(badge)}</td></tr></table>` : '') +
    `<p style="margin:0 0 6px;color:${C.ink0};font-family:${FONT};font-size:22px;line-height:1.2;font-weight:800;">${esc(o.planName)}</p>` +
    `<p style="margin:0 0 16px;font-family:${FONT};line-height:1.1;">` +
    `<span style="color:${C.ink0};font-size:40px;font-weight:800;letter-spacing:-1px;">${esc(o.priceLabel)}</span>` +
    `<span style="color:${C.ink2};font-size:16px;font-weight:600;">/month</span>` +
    (o.wasLabel ? `&nbsp;&nbsp;<span style="color:${C.ink3};font-size:18px;text-decoration:line-through;">${esc(o.wasLabel)}</span>` : '') +
    `</p>` +
    `<table ${TABLE}><tr><td height="14" style="border-top:1px solid ${C.line};height:14px;font-size:0;line-height:0;">&nbsp;</td></tr></table>` +
    B.checks(feats).html + B.cta(url, label).html +
    `</td></tr></table>`;
  const text = [
    `${o.planName}: ${o.priceLabel}/month` +
      (o.wasLabel ? ` at the launch price (usually ${o.wasLabel}${off ? `, ${off}% off` : ''})` : ''),
    B.checks(feats).text,
    B.cta(url, label).text
  ].join('\n\n');
  return { html, text };
}

// ---- The five emails -------------------------------------------------------
// Copy: social-media-manager's welcome series (2026-09-23), cut into short
// sections for the redesign. Content-gate corrections carried over:
//   - the free plan is "Starter", chapters 1-7;
//   - Day 0 says those chapters cover "the foundations: reading candles,
//     market structure, key levels and liquidity" (chief-of-staff 2026-09-23);
//   - Day 2 and Day 5 link to the free Learn articles, not locked chapters;
//   - Day 14 takes the plan's name, price and feature list from the plan
//     record at send time, so it can never disagree with the pricing page;
//     while a sale runs it says "at the launch price" and gives the usual one.

const EMAILS = [
  // Day 0 — welcome + cheat sheet
  () => {
    const url = link('/cheat-sheet', 0);
    return {
      subject: "Welcome to Stryker — here's your first download",
      preheader: 'Your FVG & Order Block cheat sheet, plus what to read first.',
      blocks: [
        B.eyebrow('Welcome'),
        B.h1('Welcome to Stryker. Your cheat sheet is ready.'),
        B.lead("You've got full access to the free Starter plan: chapters 1 through 7, covering the foundations: " +
          'reading candles, market structure, key levels and liquidity.'),
        cheatSheetCard(url),
        B.cta(url, 'Get the cheat sheet'),
        B.h2('Where to start'),
        B.steps([
          { title: 'Read Chapter 1', text: "The chapters are built to be read in order. Start there if you're new to any of this." },
          { title: 'Keep the cheat sheet next to your charts', text: 'It fits on two pages, so it is quick to check mid-session.' },
          { title: 'Watch your inbox', text: 'Over the next two weeks: a practical mini lesson, a real chart breakdown, and, ' +
            'because we know "trust me" isn\'t worth much, some actual proof behind who\'s teaching this.' }
        ]),
        signoff()
      ]
    };
  },

  // Day 2 — free mini lesson: the Fair Value Gap
  () => {
    const url = link('/learn-fair-value-gap', 2);
    return {
      subject: 'The gap price keeps coming back to',
      preheader: 'What a Fair Value Gap actually is, in one read.',
      blocks: [
        B.eyebrow('Mini lesson'),
        B.h1('The gap price keeps coming back to'),
        B.lead('Quick one today: a single idea you can start looking for on a chart right away, the Fair Value Gap (FVG).'),
        B.img(`${SITE}/assets/images/email/email-fvg.png`,
          "Diagram of a bullish fair value gap: candle 3's low stays above candle 1's high, and the space between them is the gap.",
          560, 265, "A bullish FVG: candle 3's low never comes back down to candle 1's high. The shaded band is the gap.", url),
        B.h2('Spot one in 3 steps'),
        B.steps([
          { title: 'Take three candles in a row', text: 'Look at candle one and candle three, specifically their wicks.' },
          { title: 'Check for empty space', text: "If the wicks don't overlap, the middle candle's aggressive move left a gap. " +
            'Not a guess, not a feeling: a mechanical check you can run on any chart.' },
          { title: 'Use it with other signals', text: 'Treat it as a potential entry zone (in the direction of your bias) or a ' +
            'potential target (in the opposite direction). An FVG inside an order block carries more weight than one sitting alone.' }
        ]),
        B.h2('Why it matters'),
        B.p('The gap represents a real imbalance between buying and selling pressure, and price often returns to it later. ' +
          'Not because markets "remember" anything mystical, but because unfilled orders and reference points tend to sit ' +
          'inside these gaps.'),
        B.p('We wrote up the full breakdown, with diagrams, as a free guide.'),
        B.cta(url, 'Read the full guide'),
        signoff()
      ]
    };
  },

  // Day 5 — chart breakdown: the liquidity sweep
  () => {
    const url = link('/learn-liquidity-sweeps', 5);
    return {
      subject: 'Why your stop got hit right before price reversed',
      preheader: 'The mechanics behind a liquidity sweep, broken down.',
      blocks: [
        B.eyebrow('Chart breakdown'),
        B.h1('Why your stop got hit right before price reversed'),
        B.lead("You've probably had this happen: price runs just past an obvious high or low, taps your stop, then reverses " +
          'hard in the direction you originally wanted. Infuriating, and also explainable.'),
        B.img(`${SITE}/assets/images/email/email-sweep.png`,
          'Diagram of a buy-side liquidity sweep: two equal highs, then a candle wicks above them and closes back below.',
          560, 264, 'Two equal highs attract stops just above them. A candle trades through, then closes back below the ' +
          'level: a sweep of buy-side liquidity.', url),
        B.h2("What's happening"),
        B.p("It's called a liquidity sweep. Traders who buy above a swing low put their stop-loss just below it. Enough " +
          'traders doing this in the same area builds a cluster of resting sell orders: a pool of liquidity a larger order ' +
          'can use to fill itself. The same thing happens in reverse above swing highs.'),
        B.h2('A real sweep has 3 parts, in order'),
        B.steps([
          { title: 'Price wicks through the level' },
          { title: 'It closes back on the original side' },
          { title: 'It reverses with real conviction', text: 'Not a slow drift back.' }
        ]),
        B.callout('All three need to be present. A wick through without a clean close-back is ambiguous: it might just be a ' +
          'real breakout.'),
        B.h2('The practical fix'),
        B.p("Don't move your stop further away and hope. Wait for confirmation, the order block or fair value gap the " +
          "reversal leaves behind, rather than reacting to the sweep itself. That's the difference between guessing at the " +
          'exact bottom and taking a structural entry with a defined invalidation point.'),
        B.cta(url, 'Read the full walkthrough'),
        signoff()
      ]
    };
  },

  // Day 9 — proof: the instructor's real payout certificates
  () => {
    // Four certificates with the same 900x535 shape, so the grid lines up.
    const alt = 'Tradeify payout certificate issued to the Stryker instructor';
    const cell = (n) => `<td width="50%" valign="top" style="padding:5px;"><img src="${SITE}/assets/images/proofs/proof-${n}.jpg" ` +
      `alt="${alt}" width="262" height="156" style="display:block;width:100%;max-width:262px;height:auto;` +
      `border:1px solid ${C.line};border-radius:8px;"></td>`;
    const grid = B.raw(
      `<table ${TABLE} style="margin:0 0 16px;"><tr>${cell(1)}${cell(3)}</tr><tr>${cell(4)}${cell(5)}</tr></table>`,
      '[Images: four Tradeify payout certificates issued to the Stryker instructor]');
    const cur = link('/courses.html', 9);
    return {
      subject: 'Proof, not promises',
      preheader: 'Real payout certificates from the person teaching this curriculum.',
      blocks: [
        B.eyebrow('Proof'),
        B.h1('Proof, not promises'),
        B.lead("We could tell you this curriculum works. Instead, here's something you can actually check."),
        grid,
        B.callout('These are real funded-account payout certificates, issued directly by the prop firm Tradeify. Not student ' +
          "results, not projections, not a screenshot from someone else's account."),
        B.p("They're proof that the person teaching this curriculum trades it themselves, under real prop-firm rules, with " +
          'real money on the other end of the wire.'),
        B.h2("What we won't promise"),
        B.p("We won't tell you what your win rate will be, or promise you'll see a payout of your own. That depends entirely " +
          'on how you trade, and anyone who tells you otherwise is selling something. What we can tell you is that the ' +
          'curriculum is built by someone with an actual funded-account track record behind it, not just theory.'),
        B.pLink('More certificates are on the site:', 'see all payout proofs', link('/#proof', 9), '.'),
        B.p("If you haven't started the chapters yet, this is a good moment to pick it back up."),
        B.cta(cur, 'Continue the curriculum'),
        signoff()
      ]
    };
  },

  // Day 14 — the paid-plan offer. Name, price and features come from the
  // plan record at send time (ctx.offer); an optional second plan
  // (ctx.alsoOffer) gets one line under the card.
  (ctx) => {
    const src = ctx.offer || {};
    const o = {
      planId: src.planId, planName: src.planName || '[PLAN]', priceLabel: src.priceLabel || '[PRICE]',
      wasLabel: src.wasLabel || null, features: src.features
    };
    const name = o.planName;
    const url = link(o.planId ? '/checkout.html?plan=' + encodeURIComponent(o.planId) : '/#pricing', 14);
    const al = ctx.alsoOffer;
    const hasAlso = !!(al && al.planName && al.priceLabel);
    const alsoPrice = hasAlso && al.wasLabel
      ? `, ${al.priceLabel}/month at the launch price (usually ${al.wasLabel}),`
      : (hasAlso ? ` at ${al.priceLabel}/month,` : '');
    const blocks = [
      B.eyebrow('Two weeks in'),
      B.h1(`What's in the ${name} plan, if you want to go further`),
      B.lead("No pitch today, just information in case you're wondering what's beyond the free plan."),
      pricingCard(o, url)
    ];
    if (hasAlso) {
      blocks.push(B.pLink(`There's also the ${al.planName} plan${alsoPrice} if you want more than ${name} includes. ` +
        'Both are on the', 'pricing page', link('/#pricing', 14), '.'));
    }
    blocks.push(
      B.p(`That's the whole list: nothing hidden, nothing "unlocked later." If you're getting real value from the free ` +
        'chapters and want the rest of the curriculum, this is what that looks like.'),
      B.p("If you're not ready, that's completely fine. The free chapters and everything we've sent you stay yours either " +
        'way: no expiration, no pressure to upgrade.'),
      B.p('Either way, thanks for spending two weeks with the curriculum. We mean that.'),
      signoff()
    );
    return {
      subject: `What's in the ${name} plan, if you want to go further`,
      preheader: 'No pressure — just what you get, in plain terms.',
      blocks
    };
  }
];

// ---- Frame: accent bar + logo lockup, and the legally required footer ------

function header(day) {
  return `<tr><td height="5" bgcolor="${C.gold}" style="height:5px;background:${C.gold};border-radius:13px 13px 0 0;` +
    `font-size:0;line-height:0;">&nbsp;</td></tr>` +
    `<tr><td style="padding:22px 28px 6px;"><a href="${link('/', day)}" style="text-decoration:none;">` +
    `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>` +
    `<td valign="middle" style="padding:0 12px 0 0;"><img src="${SITE}/assets/images/logo-header.png" ` +
    `alt="Stryker Trading Academy" width="61" height="40" style="display:block;width:61px;height:40px;border:0;"></td>` +
    `<td valign="middle" style="color:${C.ink0};font-family:${FONT};font-size:15px;line-height:1.25;font-weight:800;` +
    `letter-spacing:2px;">STRYKER<br><span style="color:${C.ink2};font-size:11px;font-weight:700;letter-spacing:2.5px;">` +
    `TRADING ACADEMY</span></td></tr></table></a></td></tr>`;
}

function footer(ctx, day) {
  const addr = ctx.postalAddress ? esc(ctx.postalAddress) : '[POSTAL ADDRESS PENDING]';
  const s = `margin:0 0 10px;color:${C.ink3};font-family:${FONT};font-size:14px;line-height:1.6;`;
  return `<tr><td style="padding:22px 28px 28px;border-top:1px solid ${C.line};">` +
    `<p style="${s}"><strong style="color:${C.ink2};">Education only. Not financial advice.</strong> ` +
    `Trading carries a high level of risk and may not be suitable for everyone.</p>` +
    `<p style="${s}">You're getting this because you created a free account at ` +
    `<a href="${link('/', day)}" style="color:${C.ink2};">strykertrading.com</a>. ` +
    `This is email ${DAYS.indexOf(day) + 1} of 5 in the welcome series.</p>` +
    `<p style="${s}"><a href="${esc(ctx.unsubscribeUrl)}" style="color:${C.ink2};text-decoration:underline;">` +
    `Unsubscribe</a> (one click, and you won't get any more of these).</p>` +
    `<p style="${s}margin:0;">Stryker Trading, operating as Stryker Trading Academy · ${addr}</p></td></tr>`;
}

function render(step, ctx) {
  if (!(step >= 0 && step < EMAILS.length)) throw new Error('no such step ' + step);
  const day = DAYS[step];
  const e = EMAILS[step](ctx);
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light">` +
    `<meta name="supported-color-schemes" content="dark light"><title>${esc(e.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.bg};font-family:${FONT};-webkit-text-size-adjust:100%;">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(e.preheader)}</div>` +
    `<table ${TABLE} bgcolor="${C.bg}" style="background:${C.bg};"><tr><td align="center" style="padding:20px 10px;">` +
    `<table ${TABLE} bgcolor="${C.card}" style="max-width:600px;background:${C.card};border:1px solid ${C.line};border-radius:14px;">` +
    header(day) +
    `<tr><td style="padding:18px 28px 6px;">${e.blocks.map((b) => b.html).join('')}</td></tr>` +
    footer(ctx, day) +
    `</table></td></tr></table></body></html>`;
  const text = e.blocks.map((b) => b.text).filter((t) => t).concat([
    '--',
    'Education only. Not financial advice. Trading carries a high level of risk and may not be suitable for everyone.',
    "You're getting this because you created a free account at strykertrading.com. " +
      `This is email ${DAYS.indexOf(day) + 1} of 5 in the welcome series.`,
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
