/**
 * Exchanges a short-lived Meta user token for a long-lived one and looks up
 * the Instagram Business account id, so .env can be filled in:
 *
 *   META_APP_ID=... META_APP_SECRET=... node scripts/meta-token.js <short-lived-token>
 *
 * Get the short-lived token from the Graph API Explorer (developers.facebook.com/tools/explorer)
 * with the permissions instagram_basic, instagram_content_publish, pages_show_list,
 * pages_read_engagement, business_management. For Threads, use the Threads
 * app's own token generator (see SETUP.md); this script does not cover it.
 */
const { env } = require('../src/config');
const FB = 'https://graph.facebook.com/v21.0';
const short = process.argv[2];
if (!env.meta.appId || !env.meta.appSecret || !short) { console.error('Usage: META_APP_ID=... META_APP_SECRET=... node scripts/meta-token.js <short-lived-token>'); process.exit(1); }
(async () => {
  const q = (p) => new URLSearchParams(p).toString();
  const long = await (await fetch(`${FB}/oauth/access_token?` + q({ grant_type: 'fb_exchange_token', client_id: env.meta.appId, client_secret: env.meta.appSecret, fb_exchange_token: short }))).json();
  if (!long.access_token) { console.error('Exchange failed:', long); process.exit(1); }
  const pages = await (await fetch(`${FB}/me/accounts?` + q({ fields: 'id,name,instagram_business_account', access_token: long.access_token }))).json();
  console.log('\nIG_ACCESS_TOKEN=' + long.access_token);
  for (const p of pages.data || []) {
    if (p.instagram_business_account) console.log('IG_USER_ID=' + p.instagram_business_account.id + '   # via Page "' + p.name + '"');
    else console.log('# Page "' + p.name + '" has no Instagram Business account linked');
  }
  if (!(pages.data || []).length) console.log('# No Facebook Pages visible to this token. Link the Instagram account to a Page first.');
})();
