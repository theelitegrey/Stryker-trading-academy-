#!/usr/bin/env node
/* Master Panel — site health and audit probe.
 *
 *   node tools/panel-health.js panel/sites.json out/previous.json out/panel-health.json
 *
 * Runs in GitHub Actions, not in the browser, because everything worth
 * checking is something CORS hides from a page: the status code, the response
 * headers, the redirect chain and the TLS certificate. Output is one JSON file
 * the panel reads over raw.githubusercontent.com.
 *
 * Failure policy: a site that cannot be reached is recorded as down, with the
 * error, and the run still succeeds. One unreachable site must not cost the
 * other sites their history.
 */
'use strict';

const fs = require('fs');
const tls = require('tls');

const HISTORY_CAP = 960;          // ~20 days at one sample every 30 minutes
const TIMEOUT_MS = 20000;

const [, , sitesPath, prevPath, outPath] = process.argv;
if (!sitesPath || !outPath) {
  console.error('usage: panel-health.js <sites.json> <previous.json|-> <out.json>');
  process.exit(2);
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

const registry = readJson(sitesPath, { sites: [] });
const previous = prevPath && prevPath !== '-' ? readJson(prevPath, null) : null;

/* Headers worth keeping. The full set is noisy and some of it (set-cookie)
   has no business sitting in a public JSON file. */
const KEEP_HEADERS = [
  'server', 'content-type', 'content-length', 'content-encoding', 'cache-control',
  'strict-transport-security', 'x-frame-options', 'x-content-type-options',
  'referrer-policy', 'permissions-policy', 'content-security-policy',
  'content-security-policy-report-only', 'cross-origin-opener-policy',
  'cf-cache-status', 'age', 'last-modified', 'etag'
];

async function request(url, method = 'GET') {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { 'user-agent': 'stryker-master-panel-health/1 (+https://strykertrading.com)' }
    });
    const body = method === 'GET' ? await res.text().catch(() => '') : '';
    return { ok: true, status: res.status, headers: res.headers, body, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timed out after ' + TIMEOUT_MS + ' ms' : String(err.message || err), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/* Follow up to 5 redirects by hand so the chain itself can be audited —
   an http:// entry point that never reaches https is a finding, not a detail. */
async function fetchFollowing(url) {
  const chain = [];
  let current = url;
  for (let i = 0; i < 6; i++) {
    const res = await request(current);
    if (!res.ok) return { res, chain, finalUrl: current };
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      chain.push({ from: current, status: res.status, to: new URL(location, current).toString() });
      current = new URL(location, current).toString();
      continue;
    }
    return { res, chain, finalUrl: current };
  }
  return { res: { ok: false, error: 'too many redirects', ms: 0 }, chain, finalUrl: current };
}

function certificate(hostname) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const socket = tls.connect({ host: hostname, port: 443, servername: hostname, timeout: 12000 }, () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) return done(null);
        const validTo = new Date(cert.valid_to);
        done({
          validTo: validTo.toISOString().slice(0, 10),
          daysLeft: Math.floor((validTo.getTime() - Date.now()) / 86400000),
          issuer: (cert.issuer && (cert.issuer.O || cert.issuer.CN)) || null,
          protocol: socket.getProtocol ? socket.getProtocol() : null
        });
      });
      socket.on('error', () => done(null));
      socket.on('timeout', () => { socket.destroy(); done(null); });
    } catch (e) { done(null); }
  });
}

function headerMap(headers) {
  const out = {};
  if (!headers) return out;
  KEEP_HEADERS.forEach((k) => {
    const v = headers.get(k);
    if (v) out[k] = v.length > 400 ? v.slice(0, 397) + '…' : v;
  });
  return out;
}

function between(body, re) {
  const m = re.exec(body || '');
  return m ? m[1].trim().replace(/\s+/g, ' ') : null;
}

/* Audit. Each check is pass / warn / fail / skip and carries its own weight,
   so a missing Referrer-Policy cannot outweigh a site that is down. */
function audit(site, ctx) {
  const checks = [];
  const add = (id, label, status, detail, weight = 1) =>
    checks.push({ id, label, status, detail, weight });

  const h = ctx.headers || {};
  const has = (k) => Boolean(h[k]);

  add('reachable', 'Site responds', ctx.up ? 'pass' : 'fail',
    ctx.up ? 'HTTP ' + ctx.status + ' in ' + ctx.ms + ' ms' : (ctx.error || 'no response'), 4);

  add('https', 'Served over HTTPS', ctx.finalUrl && ctx.finalUrl.startsWith('https://') ? 'pass' : 'fail',
    ctx.finalUrl || site.url, 3);

  add('httpRedirect', 'http:// redirects to https://',
    ctx.httpRedirect === true ? 'pass' : ctx.httpRedirect === false ? 'fail' : 'skip',
    ctx.httpRedirectDetail || 'not checked', 2);

  add('status', 'Expected status code',
    ctx.status === (site.expectStatus || 200) ? 'pass' : 'fail',
    'Got ' + ctx.status + ', expected ' + (site.expectStatus || 200), 2);

  if (site.expectText) {
    add('content', 'Expected content present',
      ctx.body && ctx.body.includes(site.expectText) ? 'pass' : 'fail',
      'Looking for "' + site.expectText + '"', 2);
  }

  add('speed', 'Response under 1.5 s',
    ctx.ms < 1500 ? 'pass' : ctx.ms < 3000 ? 'warn' : 'fail', ctx.ms + ' ms', 2);

  add('tls', 'Certificate has runway',
    !ctx.tls ? 'skip' : ctx.tls.daysLeft > 21 ? 'pass' : ctx.tls.daysLeft > 7 ? 'warn' : 'fail',
    ctx.tls ? ctx.tls.daysLeft + ' days left, issued by ' + (ctx.tls.issuer || 'unknown') : 'no certificate read', 3);

  add('hsts', 'Strict-Transport-Security', has('strict-transport-security') ? 'pass' : 'fail',
    h['strict-transport-security'] || 'header missing', 2);

  add('nosniff', 'X-Content-Type-Options: nosniff',
    /nosniff/i.test(h['x-content-type-options'] || '') ? 'pass' : 'fail',
    h['x-content-type-options'] || 'header missing', 1);

  const framed = h['x-frame-options'] || /frame-ancestors/i.test(h['content-security-policy'] || '');
  add('clickjacking', 'Framing blocked', framed ? 'pass' : 'fail',
    h['x-frame-options'] || (framed ? 'CSP frame-ancestors' : 'no X-Frame-Options and no CSP frame-ancestors'), 2);

  add('referrer', 'Referrer-Policy set', has('referrer-policy') ? 'pass' : 'warn',
    h['referrer-policy'] || 'header missing', 1);

  add('csp', 'Content-Security-Policy',
    has('content-security-policy') ? 'pass' : has('content-security-policy-report-only') ? 'warn' : 'fail',
    has('content-security-policy') ? 'enforced'
      : has('content-security-policy-report-only') ? 'report-only — logs violations, blocks nothing'
        : 'no policy', 2);

  add('permissions', 'Permissions-Policy set', has('permissions-policy') ? 'pass' : 'warn',
    h['permissions-policy'] ? 'set' : 'header missing', 1);

  add('compression', 'Response compressed',
    /gzip|br|zstd|deflate/i.test(h['content-encoding'] || '') ? 'pass' : 'warn',
    h['content-encoding'] || 'no content-encoding', 1);

  add('title', 'Page title', ctx.title ? 'pass' : 'fail', ctx.title || 'no <title>', 1);
  add('description', 'Meta description',
    ctx.description ? (ctx.description.length > 60 ? 'pass' : 'warn') : 'fail',
    ctx.description ? ctx.description.length + ' characters' : 'missing', 1);

  add('robots', 'robots.txt', ctx.robots === true ? 'pass' : ctx.robots === false ? 'warn' : 'skip',
    ctx.robots === true ? 'present' : 'not found', 1);
  add('sitemap', 'sitemap.xml', ctx.sitemap === true ? 'pass' : ctx.sitemap === false ? 'warn' : 'skip',
    ctx.sitemap === true ? 'present' : 'not found', 1);

  add('weight', 'HTML under 500 KB',
    ctx.bytes == null ? 'skip' : ctx.bytes < 512000 ? 'pass' : ctx.bytes < 1048576 ? 'warn' : 'fail',
    ctx.bytes == null ? '' : Math.round(ctx.bytes / 1024) + ' KB', 1);

  const scored = checks.filter((c) => c.status !== 'skip');
  const max = scored.reduce((n, c) => n + c.weight, 0) || 1;
  const got = scored.reduce((n, c) => n + c.weight * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0);
  return { score: Math.round(got / max * 100), checks };
}

async function cloudflareAnalytics(sites) {
  const token = process.env.CF_ANALYTICS_TOKEN;
  const zoned = sites.filter((s) => s.zoneTag);
  if (!token || !zoned.length) return null;

  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const until = new Date().toISOString();
  const out = [];
  for (const site of zoned) {
    const query = {
      query: `query($zone:String!,$since:Time!,$until:Time!){
        viewer{ zones(filter:{zoneTag:$zone}){
          httpRequests1dGroups(limit:7, filter:{datetime_geq:$since, datetime_lt:$until}){
            sum{ pageViews requests }
            uniq{ uniques }
          }}}}`,
      variables: { zone: site.zoneTag, since, until }
    };
    try {
      const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify(query)
      });
      const json = await res.json();
      const groups = json?.data?.viewer?.zones?.[0]?.httpRequests1dGroups || [];
      out.push({
        id: site.id, name: site.name, url: site.url,
        pageViews: groups.reduce((n, g) => n + (g.sum?.pageViews || 0), 0),
        visits: groups.reduce((n, g) => n + (g.sum?.requests || 0), 0),
        uniques: groups.reduce((n, g) => n + (g.uniq?.uniques || 0), 0)
      });
    } catch (err) {
      console.warn('analytics failed for ' + site.id + ': ' + err.message);
    }
  }
  return out.length ? { source: 'cloudflare', windowDays: 7, sites: out } : null;
}

async function probe(site) {
  const started = Date.now();
  const { res, chain, finalUrl } = await fetchFollowing(site.url);
  const headers = res.ok ? headerMap(res.headers) : {};
  const body = res.ok ? res.body : '';
  const host = new URL(site.url).hostname;

  const tlsInfo = site.url.startsWith('https://') ? await certificate(host) : null;

  // Does the plaintext entry point end up on https?
  let httpRedirect = null, httpRedirectDetail = null;
  try {
    const plainUrl = new URL(site.url);
    plainUrl.protocol = 'http:';
    plainUrl.pathname = '/';
    const plain = await request(plainUrl.toString(), 'HEAD');
    if (plain.ok) {
      const loc = plain.headers.get('location') || '';
      httpRedirect = plain.status >= 300 && plain.status < 400 && /^https:/i.test(loc);
      httpRedirectDetail = 'HTTP ' + plain.status + (loc ? ' → ' + loc : ' with no redirect');
    }
  } catch (e) { /* leave as not checked */ }

  const robotsRes = await request(new URL('/robots.txt', site.url).toString(), 'HEAD');
  const sitemapRes = await request(new URL('/sitemap.xml', site.url).toString(), 'HEAD');

  const paths = [];
  for (const p of site.paths || []) {
    const r = await request(new URL(p, site.url).toString(), 'GET');
    paths.push(r.ok
      ? { path: p, status: r.status, ok: r.status >= 200 && r.status < 400, ms: r.ms }
      : { path: p, ok: false, error: r.error, ms: r.ms });
  }

  const expected = site.expectStatus || 200;
  const contentOk = !site.expectText || (body && body.includes(site.expectText));
  const up = res.ok && res.status === expected && contentOk;

  const ctx = {
    up, status: res.ok ? res.status : null, error: res.ok ? null : res.error,
    ms: res.ms, headers, body, finalUrl,
    title: between(body, /<title[^>]*>([\s\S]*?)<\/title>/i),
    description: between(body, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i),
    bytes: body ? Buffer.byteLength(body) : null,
    tls: tlsInfo,
    httpRedirect, httpRedirectDetail,
    robots: robotsRes.ok ? robotsRes.status === 200 : null,
    sitemap: sitemapRes.ok ? sitemapRes.status === 200 : null
  };

  return {
    id: site.id,
    name: site.name,
    url: site.url,
    group: site.group || null,
    critical: site.critical !== false,
    ok: up,
    status: ctx.status,
    expectedStatus: expected,
    error: ctx.error || (!contentOk && res.ok ? 'expected text "' + site.expectText + '" not found' : null),
    ms: res.ms,
    finalUrl,
    redirects: chain,
    title: ctx.title,
    description: ctx.description,
    bytes: ctx.bytes,
    headers,
    tls: tlsInfo,
    paths,
    audit: audit(site, ctx),
    checkedAt: started
  };
}

(async function main() {
  const sites = (registry.sites || []).filter((s) => s && s.url && s.id);
  if (!sites.length) {
    console.error('no sites in ' + sitesPath);
  }

  const results = [];
  for (const site of sites) {
    try {
      const r = await probe(site);
      results.push(r);
      console.log(`${r.ok ? 'ok  ' : 'DOWN'} ${site.id.padEnd(18)} ${String(r.status || r.error).padEnd(10)} ${r.ms} ms  audit ${r.audit.score}`);
    } catch (err) {
      results.push({
        id: site.id, name: site.name, url: site.url, critical: site.critical !== false,
        ok: false, error: String(err.message || err), ms: null, checkedAt: Date.now(),
        audit: { score: 0, checks: [] }
      });
      console.log('DOWN ' + site.id + ' — ' + err.message);
    }
  }

  // Append this run to the retained history, keeping whatever the previous
  // file had for sites that were not probed this time.
  const history = (previous && previous.history) || {};
  const now = Date.now();
  results.forEach((r) => {
    const list = history[r.id] || [];
    list.push({ t: now, ok: !!r.ok, ms: r.ms, status: r.status || null });
    history[r.id] = list.slice(-HISTORY_CAP);
  });

  const analytics = await cloudflareAnalytics(sites).catch(() => null);

  const out = {
    generatedAt: now,
    generatedBy: 'tools/panel-health.js',
    sites: results,
    history,
    analytics: analytics || (previous && previous.analytics) || null
  };

  fs.mkdirSync(require('path').dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out));
  const down = results.filter((r) => !r.ok).length;
  console.log(`wrote ${outPath}: ${results.length} sites, ${down} failing`);
})();
