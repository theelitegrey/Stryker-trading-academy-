(function () {
'use strict';
// Demo data so the panel is not empty on first run. Remove it from Settings.
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const id = () => Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
function demoData() {
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
  const now = new Date().toISOString();
  const stamp = (o) => ({ id: o.id || id(), createdAt: now, updatedAt: now, ...o });
  return {
    sites: sites.map(stamp),
    subscriptions: subs.map(stamp),
    tasks: [
      stamp({ title: 'Turn on auto-renew for example.org', siteId: 'demo-shop', due: day(5), done: false }),
      stamp({ title: 'Add CSP header to Portfolio', siteId: 'demo-portfolio', due: day(-2), done: false }),
    ],
  };
}
if (typeof module !== 'undefined') module.exports = demoData; else window.PanelDemo = demoData;
})();
