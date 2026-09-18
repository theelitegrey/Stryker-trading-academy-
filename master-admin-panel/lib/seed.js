'use strict';
// Demo data so the panel is not empty on first run. Delete from Settings.
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
module.exports = function seed(store) {
  const sites = [
    { id: 'demo-portfolio', name: 'Portfolio', url: 'https://example.com', category: 'personal', host: 'Vercel', registrar: 'Cloudflare', stack: 'Next.js', repo: 'https://github.com/you/portfolio', tags: ['live', 'static'], notes: 'Main personal site.', analytics: { provider: 'plausible', url: '' }, trackingEnabled: true },
    { id: 'demo-shop', name: 'Shop', url: 'https://example.org', category: 'business', host: 'DigitalOcean', registrar: 'Namecheap', stack: 'WooCommerce', repo: '', tags: ['live', 'revenue'], notes: 'Storefront. Renewals matter here.', analytics: { provider: 'ga4', url: '' }, trackingEnabled: true },
    { id: 'demo-docs', name: 'Docs', url: 'https://example.net', category: 'project', host: 'Netlify', registrar: 'Porkbun', stack: 'Docusaurus', repo: '', tags: ['static'], notes: '', analytics: { provider: 'none', url: '' }, trackingEnabled: false },
  ];
  const subs = [
    { name: 'Vercel Pro', vendor: 'Vercel', category: 'hosting', siteIds: ['demo-portfolio'], amount: 20, currency: 'USD', cycle: 'monthly', startDate: day(-200), nextRenewal: day(6), autoRenew: true, paymentMethod: 'Visa •• 4242', status: 'active', url: 'https://vercel.com/account/billing' },
    { name: 'DigitalOcean Droplet', vendor: 'DigitalOcean', category: 'hosting', siteIds: ['demo-shop'], amount: 24, currency: 'USD', cycle: 'monthly', startDate: day(-400), nextRenewal: day(12), autoRenew: true, paymentMethod: 'Visa •• 4242', status: 'active' },
    { name: 'example.com domain', vendor: 'Cloudflare Registrar', category: 'domain', siteIds: ['demo-portfolio'], amount: 10.11, currency: 'USD', cycle: 'yearly', startDate: day(-700), nextRenewal: day(30), autoRenew: true, paymentMethod: 'Visa •• 4242', status: 'active' },
    { name: 'example.org domain', vendor: 'Namecheap', category: 'domain', siteIds: ['demo-shop'], amount: 14.98, currency: 'USD', cycle: 'yearly', startDate: day(-330), nextRenewal: day(35), autoRenew: false, paymentMethod: 'PayPal', status: 'active', notes: 'Auto-renew is OFF. Renew manually!' },
    { name: 'Google Workspace', vendor: 'Google', category: 'email', siteIds: ['demo-shop', 'demo-portfolio'], amount: 7.2, currency: 'USD', cycle: 'monthly', startDate: day(-500), nextRenewal: day(2), autoRenew: true, paymentMethod: 'Mastercard •• 8811', status: 'active' },
    { name: 'Plausible Analytics', vendor: 'Plausible', category: 'analytics', siteIds: ['demo-portfolio'], amount: 90, currency: 'USD', cycle: 'yearly', startDate: day(-100), nextRenewal: day(265), autoRenew: true, paymentMethod: 'Visa •• 4242', status: 'active' },
    { name: 'Netlify Pro (trial)', vendor: 'Netlify', category: 'hosting', siteIds: ['demo-docs'], amount: 19, currency: 'USD', cycle: 'monthly', startDate: day(-20), nextRenewal: day(10), endDate: day(10), autoRenew: false, status: 'trial' },
    { name: 'Stock photos bundle', vendor: 'Unsplash+', category: 'assets', siteIds: ['demo-shop'], amount: 60, currency: 'USD', cycle: 'one-time', startDate: day(-45), status: 'active' },
    { name: 'Old CDN plan', vendor: 'BunnyCDN', category: 'cdn', siteIds: ['demo-shop'], amount: 5, currency: 'USD', cycle: 'monthly', startDate: day(-600), nextRenewal: day(-10), endDate: day(-10), autoRenew: false, status: 'cancelled' },
  ];
  for (const s of sites) store.insert('sites', s);
  for (const s of subs) store.insert('subscriptions', s);
  store.insert('tasks', { title: 'Turn on auto-renew for example.org', siteId: 'demo-shop', due: day(5), done: false });
  store.insert('tasks', { title: 'Add CSP header to Portfolio', siteId: 'demo-portfolio', due: day(-2), done: false });
  // a few days of synthetic pageviews so the analytics charts render
  const pv = {};
  for (const site of sites.slice(0, 2)) {
    pv[site.id] = {};
    for (let i = 29; i >= 0; i--) {
      const d = day(-i);
      const base = site.id === 'demo-shop' ? 140 : 60;
      const v = Math.round(base + Math.sin(i / 3) * base * 0.3 + (i % 7 === 0 ? base * 0.4 : 0));
      pv[site.id][d] = { v, u: Math.round(v * 0.7), paths: { '/': Math.round(v * 0.5), '/pricing': Math.round(v * 0.2), '/blog': Math.round(v * 0.3) }, refs: { direct: Math.round(v * 0.4), 'google.com': Math.round(v * 0.45), 'x.com': Math.round(v * 0.15) }, ua: { desktop: Math.round(v * 0.55), mobile: Math.round(v * 0.45) } };
    }
  }
  store.set('pageviews', pv);
  store.set('meta', { seeded: true, seededAt: new Date().toISOString() });
};
