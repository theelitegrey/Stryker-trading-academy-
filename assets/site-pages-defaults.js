// Stryker Trading Academy — Default draft content for site pages
// Depends on: nothing (pure data)
//
// This is DRAFT / TEMPLATE content, not final legal copy. Anywhere you see
// bracketed text like [YOUR LEGAL BUSINESS NAME], that's a fact only the
// business owner can fill in — replace it via the Site Pages admin editor.
// This content should be reviewed by a qualified lawyer before being relied
// on as binding — Claude is not a lawyer and this is a reasonable starting
// draft, not legal advice.
//
// Used as a fallback in loadSitePage() when no Firestore doc exists yet, so
// public pages show something real immediately and the admin editor opens
// pre-filled rather than blank.

const SITE_PAGES_DEFAULTS = {

  'about': {
    title: 'About Us',
    bodyHtml:
      '<p>Stryker Trading Academy teaches ICT concepts and Smart Money Technique (SMT) trading from first principles to advanced execution, structured as a chapter-by-chapter curriculum rather than a loose collection of videos.</p>' +
      '<h2>What we do</h2>' +
      '<p>We built the curriculum the way a trading desk would train a new analyst: starting with candles, market structure, and liquidity, then building up to order blocks, fair value gaps, and full ICT models like the Judas Swing, ICT 2022, and Candle Range Theory. Every chapter includes worked examples and diagrams, not just theory.</p>' +
      '<h2>What we are — and are not</h2>' +
      '<p>Stryker Trading Academy is an <strong>educational service</strong>. We teach concepts and frameworks for reading price action; we do not manage money, provide personalized financial advice, or guarantee trading results. Trading involves substantial risk, and nothing in our curriculum should be taken as a recommendation to buy or sell any specific instrument. See our <a href="terms.html">Terms &amp; Risk Disclosure</a> for the full picture.</p>' +
      '<h2>[Add your story here]</h2>' +
      '<p>[This is a good place to add why you started Stryker Trading Academy, your background, or what makes your approach different. Edit this from the admin panel.]</p>'
  },

  'support': {
    title: 'Support',
    bodyHtml:
      '<p>If you\'re stuck on something, here\'s the fastest way to get help.</p>' +
      '<h2>Account &amp; billing</h2>' +
      '<p>Trouble signing in, changing your plan, or a coupon not working? <a href="contact.html">Contact us</a> or email <a href="mailto:support@strykertrading.com">support@strykertrading.com</a> with your account email and we\'ll take a look.</p>' +
      '<h2>Curriculum questions</h2>' +
      '<p>Questions about a specific chapter or model are often fastest to resolve on the <a href="trading-floor.html">Trading Floor</a>, where other students and instructors are active. For anything account-specific, use the contact form instead.</p>' +
      '<h2>Technical issues</h2>' +
      '<p>If a page isn\'t loading correctly, try refreshing first. If the problem continues, let us know via the <a href="contact.html">contact page</a> or at <a href="mailto:support@strykertrading.com">support@strykertrading.com</a> — include what device/browser you\'re using and what you were doing when it happened, since that helps us track it down faster.</p>' +
      '<h2>Response time</h2>' +
      '<p>[Add your typical response time here, e.g. "We aim to respond within 1-2 business days."]</p>'
  },

  'terms': {
    title: 'Terms & Risk Disclosure',
    bodyHtml:
      '<p><em>This is a draft template. Replace the bracketed placeholders with your actual business details, and have it reviewed by a lawyer before treating it as final.</em></p>' +
      '<h2>1. Acceptance of these terms</h2>' +
      '<p>Stryker Trading Academy is operated by Stryker Trading, a sole proprietorship ("we", "us", "Stryker Trading"). By creating an account or using the platform, you agree to these Terms &amp; Risk Disclosure. If you do not agree, please do not use the platform.</p>' +
      '<h2>2. Eligibility</h2>' +
      '<p>You must be at least 18 years old to create an account. Stryker Trading does not offer accounts to anyone under 18, given the financial risk involved in the subject matter taught here.</p>' +
      '<h2>3. Risk disclosure</h2>' +
      '<p><strong>Trading foreign exchange, indices, commodities, and other financial instruments carries a high level of risk and may not be suitable for everyone.</strong> You could lose some or all of your invested capital, and you should not trade with money you cannot afford to lose.</p>' +
      '<p>Stryker Trading Academy is an <strong>educational service only</strong>. We do not provide personalized financial, investment, or trading advice, and we do not manage funds on behalf of any student. Nothing in our curriculum, trading models, live sessions, or community content constitutes a recommendation to buy, sell, or hold any specific financial instrument.</p>' +
      '<p>Past performance shown in course materials, including any illustrative charts or worked examples, is not indicative of future results. Any hypothetical or simulated performance results have inherent limitations and do not represent actual trading.</p>' +
      '<h2>4. Your account</h2>' +
      '<p>You\'re responsible for keeping your login credentials secure and for all activity under your account. Let us know immediately if you believe your account has been compromised.</p>' +
      '<h2>5. Plans, payment, and coupons</h2>' +
      '<p>Access to certain curriculum, trading models, live sessions, and community features may require an active plan. [Describe your actual pricing/payment process here once live — e.g. which payment processor you use, billing frequency, and how plan changes are handled.]</p>' +
      '<p>See our <a href="refund-policy.html">Refund Policy</a> for details on refund eligibility.</p>' +
      '<h2>6. Referral program</h2>' +
      '<p>Our referral program awards points for successful invites, shown on the leaderboard for recognition. Points do not currently have a cash or credit redemption value. We reserve the right to adjust, withhold, or reverse points awarded through fraudulent activity, self-referral, or abuse of the program.</p>' +
      '<h2>7. Community conduct</h2>' +
      '<p>The Trading Floor community is for genuine discussion of trading ideas and setups. We don\'t allow harassment, spam, impersonation, or posting content that violates applicable law. We may remove content or restrict access for violations of this policy.</p>' +
      '<h2>8. Intellectual property</h2>' +
      '<p>All curriculum content, trading models, diagrams, and materials are the property of Stryker Trading Academy (or its licensors) and are provided for your personal educational use only. Redistributing, reselling, or publicly republishing course content without permission is not allowed.</p>' +
      '<h2>9. Termination</h2>' +
      '<p>We may suspend or terminate accounts that violate these terms. You may stop using the platform and close your account at any time via Settings or by contacting us.</p>' +
      '<h2>10. Limitation of liability</h2>' +
      '<p>To the fullest extent permitted by law, Stryker Trading is not liable for any trading losses, indirect damages, or losses arising from your use of the platform or reliance on educational content. <em>This clause in particular should be reviewed by a lawyer — and worth knowing: as a sole proprietorship, Stryker Trading does not have the liability separation an LLC or corporation would have, which is worth discussing with a lawyer or accountant.</em></p>' +
      '<h2>11. Governing law</h2>' +
      '<p>Stryker Trading operates as a sole proprietorship and has not designated a specific governing jurisdiction for these terms. <em>Note: most businesses name a specific governing law here, since it materially affects how disputes are resolved — this is worth revisiting with a lawyer if that changes.</em></p>' +
      '<h2>12. Changes to these terms</h2>' +
      '<p>We may update these terms from time to time. Continued use of the platform after changes take effect means you accept the updated terms.</p>' +
      '<h2>13. Contact</h2>' +
      '<p>Questions about these terms? <a href="contact.html">Contact us</a> or email <a href="mailto:support@strykertrading.com">support@strykertrading.com</a>.</p>'
  },

  'privacy': {
    title: 'Privacy Policy',
    bodyHtml:
      '<p><em>This is a draft template. Replace the bracketed placeholders with your actual business details, and have it reviewed by a lawyer before treating it as final.</em></p>' +
      '<h2>1. What we collect</h2>' +
      '<p>When you create an account, we collect your name and email address (via email/password sign-up, or your Google account if you sign in with Google, which may also include a profile photo). As you use the platform, we store your course progress, achievement streak, journal entries, and any content you post to the community.</p>' +
      '<h2>2. Your trade journal is private</h2>' +
      '<p>Your trade journal entries are visible only to you. No other student, and no one at Stryker Trading Academy, can view your journal data as part of normal platform operation.</p>' +
      '<h2>3. Community content is visible to other students</h2>' +
      '<p>Posts, replies, and profile information you choose to make public (like your display name and avatar) are visible to other signed-in students on the Trading Floor.</p>' +
      '<h2>4. How we use your data</h2>' +
      '<p>We use your data to operate the platform: authenticating you, tracking your progress, running the referral program, and responding to support requests. We do not sell your personal data to third parties.</p>' +
      '<h2>5. Third-party services we use</h2>' +
      '<ul>' +
        '<li><strong>Firebase / Google Cloud</strong> — provides authentication and database infrastructure. Your account and platform data is stored on Firebase\'s infrastructure.</li>' +
        '<li><strong>TradingView</strong> — chapter pages may embed live TradingView charts. This embed is provided directly by TradingView and is subject to their own privacy policy.</li>' +
        '<li>[If/when you add a payment processor, describe it here — e.g. "Payments are processed by [processor name]; we do not store your full card details."]</li>' +
      '</ul>' +
      '<h2>6. Data retention</h2>' +
      '<p>We retain your account data for as long as your account is active. You can request deletion of your account and associated data at any time — see our <a href="gdpr.html">GDPR</a> page for how.</p>' +
      '<h2>7. Your rights</h2>' +
      '<p>Depending on your location, you may have rights to access, correct, export, or delete your personal data. See our <a href="gdpr.html">GDPR</a> page for details, or <a href="contact.html">contact us</a> directly.</p>' +
      '<h2>8. Children\'s privacy</h2>' +
      '<p>Stryker Trading Academy is not intended for anyone under 18, and we do not knowingly collect data from minors.</p>' +
      '<h2>9. Security</h2>' +
      '<p>We use industry-standard practices (including Firebase Authentication and access-controlled databases) to protect your data, but no system is 100% secure. Please use a strong, unique password.</p>' +
      '<h2>10. Changes to this policy</h2>' +
      '<p>We may update this policy from time to time. Material changes will be reflected by the "last updated" date at the top of this page.</p>' +
      '<h2>11. Contact</h2>' +
      '<p>Questions about this policy or your data? <a href="contact.html">Contact us</a> or email <a href="mailto:support@strykertrading.com">support@strykertrading.com</a>.</p>'
  },

  'cookies': {
    title: 'Cookie Policy',
    bodyHtml:
      '<p><em>This is a draft template. Replace the bracketed placeholders with your actual business details, and have it reviewed by a lawyer before treating it as final.</em></p>' +
      '<h2>What we actually use</h2>' +
      '<p>We keep this simple and honest: Stryker Trading Academy currently uses only the storage that\'s strictly necessary to keep you signed in. We do not currently use advertising cookies, marketing trackers, or third-party analytics.</p>' +
      '<h2>Strictly necessary storage</h2>' +
      '<p>We use Firebase Authentication, which relies on browser storage (cookies and similar technologies like localStorage) to keep you signed in between visits. Without this, you\'d need to log in again on every page.</p>' +
      '<h2>Third-party embeds</h2>' +
      '<p>Chapter pages may embed a live chart from TradingView. TradingView may set its own cookies as part of that embed, governed by their own cookie policy, independent of us.</p>' +
      '<h2>Controlling cookies</h2>' +
      '<p>You can control or delete cookies through your browser settings. Note that blocking essential storage may prevent you from staying signed in.</p>' +
      '<h2>If this changes</h2>' +
      '<p>If we add analytics or advertising in the future, we\'ll update this page to reflect that honestly, rather than leave outdated claims here.</p>' +
      '<h2>Contact</h2>' +
      '<p>Questions? <a href="contact.html">Contact us</a> or email <a href="mailto:support@strykertrading.com">support@strykertrading.com</a>.</p>'
  },

  'gdpr': {
    title: 'GDPR',
    bodyHtml:
      '<p><em>This is a draft template, reviewed for your confirmed EU/UK user base but still worth a lawyer\'s review — GDPR compliance involves more than a policy page (e.g. a documented legal basis for each type of processing, and a data processing agreement with Firebase/Google, which Google Cloud offers by default).</em></p>' +
      '<h2>Your rights</h2>' +
      '<p>If you\'re based in the EU or UK, you have the right to:</p>' +
      '<ul>' +
        '<li><strong>Access</strong> the personal data we hold about you</li>' +
        '<li><strong>Correct</strong> inaccurate data</li>' +
        '<li><strong>Delete</strong> your data ("right to be forgotten")</li>' +
        '<li><strong>Export</strong> your data in a portable format</li>' +
        '<li><strong>Restrict or object</strong> to certain processing</li>' +
      '</ul>' +
      '<p>We extend these same rights to every student, regardless of location.</p>' +
      '<h2>How to exercise these rights</h2>' +
      '<p>Submit your request through our <a href="contact.html">contact form</a> or by email to <a href="mailto:support@strykertrading.com">support@strykertrading.com</a>. We aim to respond within 30 days, in line with GDPR\'s standard response window.</p>' +
      '<h2>Legal basis for processing</h2>' +
      '<p>We process your account and progress data based on our contract with you (providing the educational service you signed up for), and community/journal data based on your consent when you choose to use those features.</p>' +
      '<h2>International data transfers</h2>' +
      '<p>Our infrastructure (Firebase/Google Cloud) may store and process data outside the EU/UK. Google Cloud makes Standard Contractual Clauses available for this by default as part of its infrastructure — worth confirming this is properly in place given your EU/UK user base.</p>' +
      '<h2>Contact</h2>' +
      '<p>Reach us through the <a href="contact.html">contact form</a>, or email <a href="mailto:support@strykertrading.com">support@strykertrading.com</a>, with any GDPR-related question or request.</p>'
  },

  'contact': {
    title: 'Contact Us',
    bodyHtml:
      '<p>Have a question about your account, a chapter, or anything else? Send us a message below, or email us directly at <a href="mailto:support@strykertrading.com">support@strykertrading.com</a>, and we\'ll get back to you.</p>'
  },

  'refund-policy': {
    title: 'Refund Policy',
    bodyHtml:
      '<h2>All sales are final</h2>' +
      '<p>Stryker Trading does not offer refunds on any purchase. When you complete a purchase, you\'re confirming you understand and accept this before checkout.</p>' +
      '<h2>Discretionary exceptions</h2>' +
      '<p>Stryker Trading administration may, at its sole discretion, choose to make an exception to this policy on a case-by-case basis. This is not a guarantee or a right — if you believe your situation warrants an exception, you\'re welcome to explain it via the <a href="contact.html">contact form</a> or by email to <a href="mailto:support@strykertrading.com">support@strykertrading.com</a>, but approval is entirely at our discretion.</p>' +
      '<h2>Why we do this</h2>' +
      '<p>Our curriculum, trading models, and community access are digital educational content delivered immediately upon purchase, which is why we don\'t offer a standard refund window.</p>'
  }

};
