'use strict';
// Website condition audit: availability, TLS, DNS, security headers,
// SEO basics, domain registration (RDAP) and a 0-100 composite score.
const tls = require('tls');
const dns = require('dns').promises;
const { URL } = require('url');

const UA = 'MasterAdminPanel/1.0 (+site-audit)';

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function fetchText(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 15000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'text/html,*/*' }, ...opts.init });
    const buf = Buffer.from(await res.arrayBuffer());
    return { res, text: buf.toString('utf8').slice(0, 512 * 1024), bytes: buf.length };
  } finally { clearTimeout(t); }
}

// Quick probe used by the scheduler for uptime history.
async function probe(url, timeout = 12000) {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA } });
    clearTimeout(t);
    await res.arrayBuffer().catch(() => {});
    return { t: new Date().toISOString(), up: res.status < 400, status: res.status, ms: Date.now() - started };
  } catch (e) {
    return { t: new Date().toISOString(), up: false, status: 0, ms: Date.now() - started, error: String(e.cause?.code || e.message) };
  }
}

function certInfo(host, port = 443) {
  return withTimeout(new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      const c = socket.getPeerCertificate(false);
      const authorized = socket.authorized;
      socket.end();
      if (!c || !c.valid_to) return resolve({ ok: false, error: 'no certificate' });
      const validTo = new Date(c.valid_to);
      resolve({
        ok: authorized,
        error: authorized ? null : socket.authorizationError,
        issuer: c.issuer?.O || c.issuer?.CN || null,
        subject: c.subject?.CN || null,
        validFrom: new Date(c.valid_from).toISOString(),
        validTo: validTo.toISOString(),
        daysLeft: Math.floor((validTo - Date.now()) / 86400000),
        protocol: socket.getProtocol(),
      });
    });
    socket.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
  }), 10000, 'TLS').catch(e => ({ ok: false, error: e.message }));
}

async function dnsInfo(host) {
  const out = { resolves: false, a: [], aaaa: [], cname: null, mx: [], ns: [], txt: [] };
  const safe = (p) => p.then(v => v).catch(() => []);
  const [a, aaaa, mx, ns, txt] = await Promise.all([
    safe(dns.resolve4(host)), safe(dns.resolve6(host)), safe(dns.resolveMx(host)),
    safe(dns.resolveNs(rootDomain(host))), safe(dns.resolveTxt(host)),
  ]);
  out.a = a; out.aaaa = aaaa; out.mx = mx.map(m => m.exchange); out.ns = ns;
  out.txt = txt.map(t => t.join('')).filter(t => /^v=spf1/i.test(t));
  try { out.cname = (await dns.resolveCname(host))[0] || null; } catch { /* none */ }
  out.resolves = a.length > 0 || aaaa.length > 0 || !!out.cname;
  return out;
}

function rootDomain(host) {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  // handle common second-level public suffixes (co.uk, com.au, ...)
  const sld = /^(co|com|org|net|gov|edu|ac)$/i.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
  return parts.slice(sld ? -3 : -2).join('.');
}

// Domain expiry via RDAP (the modern WHOIS). rdap.org redirects to the registry.
async function domainInfo(host) {
  const domain = rootDomain(host);
  try {
    const { res, text } = await fetchText(`https://rdap.org/domain/${domain}`, { timeout: 12000, init: { headers: { accept: 'application/rdap+json', 'user-agent': UA } } });
    if (!res.ok) return { domain, error: `RDAP ${res.status}` };
    const j = JSON.parse(text);
    const ev = (a) => (j.events || []).find(e => e.eventAction === a)?.eventDate || null;
    const registrar = (j.entities || []).find(e => (e.roles || []).includes('registrar'));
    const regName = registrar?.vcardArray?.[1]?.find(v => v[0] === 'fn')?.[3] || registrar?.handle || null;
    const expires = ev('expiration');
    return {
      domain, registrar: regName, created: ev('registration'), updated: ev('last changed'),
      expires, daysLeft: expires ? Math.floor((new Date(expires) - Date.now()) / 86400000) : null,
      status: j.status || [], nameservers: (j.nameservers || []).map(n => n.ldhName),
    };
  } catch (e) { return { domain, error: e.message }; }
}

function pick(re, html) { const m = html.match(re); return m ? m[1].trim().replace(/\s+/g, ' ') : null; }

function seoInfo(html, bytes, finalUrl) {
  const head = html.slice(0, 200000);
  const meta = (name) => pick(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'), head)
    || pick(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i'), head);
  const title = pick(/<title[^>]*>([^<]*)<\/title>/i, head);
  const description = meta('description');
  const h1s = (html.match(/<h1[\s>]/gi) || []).length;
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const imgsNoAlt = imgs.filter(i => !/\balt=/i.test(i)).length;
  const mixed = /^https:/i.test(finalUrl) ? (html.match(/(?:src|href)=["']http:\/\//gi) || []).length : 0;
  return {
    title, titleLength: title ? title.length : 0,
    description, descriptionLength: description ? description.length : 0,
    canonical: pick(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i, head),
    viewport: !!meta('viewport'), lang: pick(/<html[^>]+lang=["']([^"']+)["']/i, head),
    ogTitle: meta('og:title'), favicon: /<link[^>]+rel=["'][^"']*icon[^"']*["']/i.test(head),
    h1Count: h1s, imageCount: imgs.length, imagesMissingAlt: imgsNoAlt, mixedContent: mixed,
    sizeKB: Math.round(bytes / 1024), robotsMeta: meta('robots'),
    generator: meta('generator'),
  };
}

function headerInfo(res) {
  const h = (k) => res.headers.get(k);
  return {
    server: h('server'), poweredBy: h('x-powered-by'),
    hsts: !!h('strict-transport-security'), csp: !!h('content-security-policy'),
    xFrameOptions: !!h('x-frame-options') || /frame-ancestors/i.test(h('content-security-policy') || ''),
    xContentTypeOptions: (h('x-content-type-options') || '').toLowerCase() === 'nosniff',
    referrerPolicy: !!h('referrer-policy'), permissionsPolicy: !!h('permissions-policy'),
    cacheControl: h('cache-control'), contentEncoding: h('content-encoding'),
  };
}

async function fileExists(origin, p) {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(origin + p, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': UA } });
    clearTimeout(t); await res.arrayBuffer().catch(() => {});
    const type = res.headers.get('content-type') || '';
    return res.ok && !/text\/html/i.test(type);
  } catch { return false; }
}

function score(a) {
  let s = 100; const issues = [];
  const bad = (pts, msg, sev = 'warn') => { s -= pts; issues.push({ sev, msg }); };
  if (!a.http.ok) bad(50, `Site unreachable (${a.http.error || 'HTTP ' + a.http.status})`, 'critical');
  else if (a.http.status >= 400) bad(40, `HTTP ${a.http.status}`, 'critical');
  if (a.http.ok && a.http.ms > 3000) bad(10, `Slow response (${a.http.ms} ms)`);
  else if (a.http.ok && a.http.ms > 1500) bad(5, `Response time ${a.http.ms} ms`);
  if (a.ssl) {
    if (!a.ssl.ok) bad(25, `TLS problem: ${a.ssl.error}`, 'critical');
    else if (a.ssl.daysLeft <= 7) bad(25, `TLS certificate expires in ${a.ssl.daysLeft} days`, 'critical');
    else if (a.ssl.daysLeft <= 21) bad(10, `TLS certificate expires in ${a.ssl.daysLeft} days`);
  } else if (a.http.finalUrl && a.http.finalUrl.startsWith('http:')) bad(15, 'Site served over plain HTTP', 'critical');
  if (a.dns && !a.dns.resolves) bad(30, 'DNS does not resolve', 'critical');
  if (a.domain && a.domain.daysLeft != null) {
    if (a.domain.daysLeft <= 14) bad(30, `Domain expires in ${a.domain.daysLeft} days`, 'critical');
    else if (a.domain.daysLeft <= 45) bad(10, `Domain expires in ${a.domain.daysLeft} days`);
  }
  if (a.headers) {
    if (!a.headers.hsts) bad(4, 'Missing Strict-Transport-Security header');
    if (!a.headers.csp) bad(4, 'Missing Content-Security-Policy header');
    if (!a.headers.xFrameOptions) bad(3, 'Missing X-Frame-Options / frame-ancestors');
    if (!a.headers.xContentTypeOptions) bad(2, 'Missing X-Content-Type-Options: nosniff');
    if (!a.headers.referrerPolicy) bad(1, 'Missing Referrer-Policy');
    if (a.headers.poweredBy) bad(1, `Leaks X-Powered-By: ${a.headers.poweredBy}`, 'info');
  }
  if (a.seo) {
    if (!a.seo.title) bad(5, 'Missing <title>');
    else if (a.seo.titleLength > 65) bad(1, 'Title longer than 65 characters', 'info');
    if (!a.seo.description) bad(4, 'Missing meta description');
    if (!a.seo.viewport) bad(3, 'Missing viewport meta (not mobile-friendly)');
    if (a.seo.h1Count === 0) bad(2, 'No <h1> on the page');
    else if (a.seo.h1Count > 1) bad(1, `${a.seo.h1Count} <h1> tags`, 'info');
    if (!a.seo.canonical) bad(1, 'No canonical link', 'info');
    if (!a.seo.lang) bad(1, 'No lang attribute on <html>', 'info');
    if (a.seo.mixedContent) bad(5, `${a.seo.mixedContent} mixed-content (http://) references`);
    if (a.seo.imagesMissingAlt) bad(2, `${a.seo.imagesMissingAlt} images missing alt text`);
    if (a.seo.sizeKB > 2048) bad(4, `Heavy HTML document (${a.seo.sizeKB} KB)`);
    if (!a.seo.favicon) bad(1, 'No favicon link', 'info');
    if (!a.robotsTxt) bad(1, 'No robots.txt', 'info');
    if (!a.sitemap) bad(1, 'No sitemap.xml', 'info');
  }
  return { score: Math.max(0, Math.round(s)), issues };
}

async function audit(siteUrl) {
  const u = new URL(siteUrl);
  const started = Date.now();
  const out = { t: new Date().toISOString(), url: siteUrl, http: { ok: false, status: 0, ms: 0 } };
  let page = null;
  try {
    page = await fetchText(siteUrl, { timeout: 20000 });
    out.http = { ok: page.res.status < 400, status: page.res.status, ms: Date.now() - started, finalUrl: page.res.url, redirected: page.res.redirected, contentType: page.res.headers.get('content-type') };
    out.headers = headerInfo(page.res);
    out.seo = seoInfo(page.text, page.bytes, page.res.url);
  } catch (e) {
    out.http = { ok: false, status: 0, ms: Date.now() - started, error: e.cause?.code || e.message };
  }
  const finalHost = page ? new URL(page.res.url).hostname : u.hostname;
  const origin = page ? new URL(page.res.url).origin : u.origin;
  const [ssl, dnsr, domain, robots, sitemap] = await Promise.all([
    (page ? page.res.url : siteUrl).startsWith('https') ? certInfo(finalHost) : Promise.resolve(null),
    dnsInfo(u.hostname).catch(e => ({ resolves: false, error: e.message })),
    domainInfo(u.hostname),
    fileExists(origin, '/robots.txt'), fileExists(origin, '/sitemap.xml'),
  ]);
  out.ssl = ssl; out.dns = dnsr; out.domain = domain; out.robotsTxt = robots; out.sitemap = sitemap;
  Object.assign(out, score(out));
  out.durationMs = Date.now() - started;
  return out;
}

module.exports = { audit, probe, rootDomain, score };
