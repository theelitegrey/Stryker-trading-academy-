#!/usr/bin/env node
/**
 * Stryker Trading Academy — Global Monitor data pipeline
 *
 * Run by .github/workflows/monitor-data.yml every ~20 minutes on a GitHub
 * Actions runner. Fetches every upstream the Global Monitor page needs and
 * writes one monitor-data.json, which the workflow publishes to the `data`
 * branch. The page reads it from raw.githubusercontent.com (CORS-open).
 *
 * UPSTREAM CHOICES — measured, not guessed (see run 33017041252's logs):
 * - GDELT's api.gdeltproject.org refuses connections from cloud IPs — every
 *   call from a GitHub runner died at undici's 10s connect timeout, exactly
 *   as it did from Cloud Functions and from some student networks. So the
 *   API is not used here at all.
 * - Map events come from GDELT's raw 15-minute EXPORT CSV on
 *   data.gdeltproject.org instead — static file hosting built for bulk
 *   pipelines, which is a different serving path from the blocked API. Each
 *   run ingests the newest batch and folds it into a rolling 24h window
 *   carried in the published JSON itself, so the map fills out across runs.
 * - Wire and financial headlines come from major outlets' RSS feeds, with
 *   keyword-tier severity (GDELT tone is unavailable without the API).
 * - Markets: Yahoo Finance chart API. Outbreaks: WHO. Odds: Polymarket.
 *   DEFCON: defconlevel.com scrape with a derived fallback.
 *
 * DESIGN RULES
 * - No npm dependencies; Node 20's fetch + the runner's `unzip` are enough.
 * - Every section is independent: one dead upstream costs one section.
 * - On section failure the previous run's data is kept and marked stale —
 *   the page degrades to old data, never to an error wall.
 *
 * Usage: node tools/fetch-monitor-data.js <previous.json|-> <out.json>
 */

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; StrykerMonitor/1.0; +https://strykertrading.com)' };

const previousPath = process.argv[2];
const outPath = process.argv[3] || 'monitor-data.json';

let PREV = {};
try {
  if (previousPath && previousPath !== '-' && fs.existsSync(previousPath)) {
    PREV = JSON.parse(fs.readFileSync(previousPath, 'utf8')) || {};
  }
} catch (e) { PREV = {}; }

// ---- Country attribution (reuses the site's own shape asset) ---------------
let COUNTRY_SHAPES = [];
try {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'country-shapes.js'), 'utf8');
  COUNTRY_SHAPES = JSON.parse(src.slice(src.indexOf('['), src.lastIndexOf(']') + 1));
} catch (e) { console.warn('country-shapes unavailable:', e.message); }

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function countryAt(lon, lat) {
  for (const s of COUNTRY_SHAPES) for (const r of s.p) if (pointInRing(lon, lat, r)) return s.n;
  let best = null, bestD = 2.25;
  for (const s of COUNTRY_SHAPES) for (const r of s.p) for (const v of r) {
    const dx = v[0] - lon, dy = v[1] - lat, d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = s.n; }
  }
  return best;
}

// ---- Fetch helpers ----------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { timeout = 30000, tries = 3, json = true } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(4000 * i);
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
      const text = await res.text();
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + text.slice(0, 120));
      return json ? JSON.parse(text) : text;
    } catch (e) { last = e; console.warn('  retryable:', url.slice(0, 90), '-', e.message); }
  }
  throw last;
}

async function getBuffer(url, timeout) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout || 90000), redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

// ---- Text helpers -----------------------------------------------------------
function fingerprint(title) {
  return String(title || '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()
    .split(' ').slice(0, 9).join(' ');
}
function stripTags(s) { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
    .trim();
}

// ---- Categorisation (mirror of assets/global-monitor.js) --------------------
const CATS = [
  ['combat', /\b(war|invasion|offensive|airstrikes?|air strikes?|attacks?|attacked|shelling|artillery|missiles?|rockets?|drone strikes?|bombing|bombardment|fighting|clashes|frontline|combat|strikes? on|killed in strike)\b/i],
  ['terror', /\b(terror|suicide bomb|car bomb|ied|hostage|kidnapp|militants?|insurgen|extremis|massacre)\b/i],
  ['military', /\b(troops|military|deploy|mobiliz|drills?|exercises?|navy|warships?|fighter jets?|air defen[cs]e|weapons|arms deal|nuclear|missile test|conscription)\b/i],
  ['unrest', /\b(protests?|riots?|demonstrat|unrest|coup|martial law|crackdown|uprising)\b/i],
  ['diplomacy', /\b(ceasefire|truce|peace|talks|negotiat|sanctions?|embargo|treaty|summit|diplomat|resolution|accord)\b/i],
  ['humanitarian', /\b(refugees?|humanitarian|famine|aid convoy|evacuat|casualt|civilians? killed|displaced|hospital hit)\b/i]
];
function categorise(text) {
  for (const [k, re] of CATS) if (re.test(text)) return k;
  return 'other';
}

// Severity tiers for RSS headlines. Without GDELT tone, keywords carry the
// job — most severe pattern wins.
const SEV_WIRE = [
  ['critical', /\b(nuclear|invasion|invades?|declares? war|major offensive|mass casualties|assassinat|coup|massacre|chemical weapons|mushroom cloud)\b/i],
  ['high', /\b(missiles?|airstrikes?|air strikes?|drone strikes?|shelling|artillery|attacks?|killed|dead|explosion|blast|sanctions|escalat|offensive|troops|hostage|strikes? on)\b/i],
  ['elevated', /\b(military|warns?|warning|threats?|tensions?|protests?|unrest|mobiliz|ceasefire|clash|conflict|crisis|weapons|defen[cs]e)\b/i]
];
const SEV_FIN = [
  ['critical', /\b(crash(es|ed)?|collapses?|panic|defaults?|meltdown|emergency|bank run|contagion|freefall)\b/i],
  ['high', /\b(plunges?|tumbles?|selloff|sell-off|slumps?|sinks?|recession|crisis|sanctions|turmoil|slides?|routs?|fears|warns?)\b/i]
];
function severityOf(title, tiers, fallback) {
  for (const [sev, re] of tiers) if (re.test(title)) return sev;
  return fallback;
}

// Country chip for a headline: first country name (or alias) it mentions.
const COUNTRY_ALIASES = [
  ['United States', /\b(U\.?S\.?A?|United States|America|Washington|Pentagon|White House)\b/],
  ['United Kingdom', /\b(U\.?K\.?|United Kingdom|Britain|British|London)\b/],
  ['Russia', /\b(Russia|Moscow|Kremlin|Putin)\b/i],
  ['Ukraine', /\b(Ukrain|Kyiv|Zelensk)\b/i],
  ['Israel', /\b(Israel|Tel Aviv|Netanyahu|IDF)\b/],
  ['Palestine', /\b(Gaza|Palestin|West Bank|Rafah)\b/i],
  ['Iran', /\b(Iran|Tehran)\b/],
  ['China', /\b(China|Beijing|Chinese)\b/],
  ['Taiwan', /\b(Taiwan|Taipei)\b/],
  ['North Korea', /\b(North Korea|Pyongyang)\b/i],
  ['South Korea', /\b(South Korea|Seoul)\b/i],
  ['Lebanon', /\b(Lebanon|Beirut|Hezbollah)\b/i],
  ['Yemen', /\b(Yemen|Houthi)\b/i],
  ['Syria', /\b(Syria|Damascus)\b/],
  ['India', /\b(India|New Delhi)\b/],
  ['Pakistan', /\b(Pakistan|Islamabad)\b/],
  ['Germany', /\b(German|Berlin)\b/],
  ['France', /\b(France|French|Paris)\b/],
  ['Japan', /\b(Japan|Tokyo)\b/],
  ['Sudan', /\b(Sudan|Khartoum)\b/],
  ['Venezuela', /\bVenezuela|Caracas\b/i]
];
let COUNTRY_NAME_RES = null;
function countryFromText(text) {
  for (const [name, re] of COUNTRY_ALIASES) if (re.test(text)) return name;
  if (!COUNTRY_NAME_RES) {
    COUNTRY_NAME_RES = COUNTRY_SHAPES
      .map((s) => [s.n, new RegExp('\\b' + s.n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')]);
  }
  for (const [name, re] of COUNTRY_NAME_RES) if (re.test(text)) return name;
  return null;
}

// ---- RSS --------------------------------------------------------------------
function parseRss(xml, sourceLabel) {
  const items = [];
  const blocks = String(xml).match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    // decodeEntities must run FIRST: it unwraps <![CDATA[...]]>, which
    // stripTags would otherwise swallow whole (CDATA opens with '<').
    const title = stripTags(decodeEntities((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''));
    if (!title) continue;
    let link = decodeEntities(((b.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '').trim());
    if (!link) link = (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || null;
    const pub = (b.match(/<(?:pubDate|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|dc:date)>/i) || [])[1];
    const at = pub ? Date.parse(pub.trim()) : null;
    items.push({ title: title.slice(0, 200), url: link || null, source: sourceLabel, at: isNaN(at) ? null : at });
  }
  return items;
}

async function fetchFeeds(feeds) {
  const all = [];
  for (const [label, url] of feeds) {
    try {
      const xml = await get(url, { json: false, timeout: 25000, tries: 2 });
      const items = parseRss(xml, label);
      console.log('  feed', label, items.length, 'items');
      all.push(...items);
    } catch (e) { console.warn('  feed', label, 'failed:', e.message); }
    await sleep(300);
  }
  return all;
}

function mergeHeadlines(raw, tiers, fallbackSev, cap) {
  const seen = new Set();
  const items = [];
  raw.sort((a, b) => (b.at || 0) - (a.at || 0));
  const cutoff = Date.now() - 36 * 3600000;
  for (const r of raw) {
    if (r.at && r.at < cutoff) continue;
    const fp = fingerprint(r.title);
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    items.push({
      id: fp, title: r.title, url: r.url, source: r.source, at: r.at,
      country: countryFromText(r.title),
      cat: categorise(r.title),
      sev: severityOf(r.title, tiers, fallbackSev)
    });
    if (items.length >= cap) break;
  }
  const rank = { critical: 0, high: 1, elevated: 2, active: 3, watch: 3 };
  items.sort((a, b) => (rank[a.sev] ?? 9) - (rank[b.sev] ?? 9) || (b.at || 0) - (a.at || 0));
  return items;
}

const WIRE_FEEDS = [
  ['bbc.com', 'https://feeds.bbci.co.uk/news/world/rss.xml'],
  ['aljazeera.com', 'https://www.aljazeera.com/xml/rss/all.xml'],
  ['theguardian.com', 'https://www.theguardian.com/world/rss'],
  ['skynews.com', 'https://feeds.skynews.com/feeds/rss/world.xml'],
  ['france24.com', 'https://www.france24.com/en/rss']
];
const FIN_FEEDS = [
  ['cnbc.com', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664'],
  ['marketwatch.com', 'https://feeds.content.dowjones.io/public/rss/mw_topstories'],
  ['finance.yahoo.com', 'https://finance.yahoo.com/news/rssindex'],
  ['bbc.com', 'https://feeds.bbci.co.uk/news/business/rss.xml'],
  ['theguardian.com', 'https://www.theguardian.com/uk/business/rss']
];

async function sectionWire() {
  const raw = await fetchFeeds(WIRE_FEEDS);
  if (!raw.length) throw new Error('every wire feed failed');
  return { items: mergeHeadlines(raw, SEV_WIRE, 'active', 140) };
}

async function sectionFinance() {
  const raw = await fetchFeeds(FIN_FEEDS);
  if (!raw.length) throw new Error('every finance feed failed');
  return { items: mergeHeadlines(raw, SEV_FIN, 'watch', 60) };
}

// ---- Map events: GDELT 15-minute export CSV ---------------------------------
// data.gdeltproject.org is GDELT's static bulk-download host — a different
// serving path from the connection-refusing API. Each run ingests the newest
// 15-minute batch and folds it into a rolling 24h window that travels inside
// the published JSON (`rolling`), so the map fills out run by run.

// GDELT 2.0 event-table column indices (tab-separated, no header).
const COL = { ROOT: 28, QUAD: 29, MENTIONS: 31, TONE: 34,
              GEO_NAME: 52, GEO_LAT: 56, GEO_LON: 57, ADDED: 59, URL: 60 };
// CAMEO root code -> our category. Only these roots make the map.
const ROOT_CAT = { 13: 'military', 14: 'unrest', 15: 'military', 17: 'diplomacy',
                   18: 'combat', 19: 'combat', 20: 'combat' };

// CAMEO's "assault/fight" roots also catch ordinary domestic crime (a kidnap
// trial, an assault sentencing). Those read as noise on a geopolitics map, so
// drop crime-flavoured stories unless the headline also carries a
// geopolitical signal.
const CRIME_RE = /\b(kidnapp?|sexual|rape|murder|homicide|stabbing|sentenced|court (hears|told)|trial|arrested|charged|robbery|burglar|shoplift|domestic violence|manslaughter|fraud|scam|assault case|jailed|prison)\b/i;
const GEOPOL_RE = /\b(war|military|troops|missile|airstrike|air strike|drone|shelling|artillery|invasion|offensive|rebel|militant|insurgen|terror|protest|riot|coup|sanction|ceasefire|border|regime|army|navy|soldiers?|militia|separatist|occupation)\b/i;
function looksDomesticCrime(title) {
  return CRIME_RE.test(title) && !GEOPOL_RE.test(title);
}

function titleFromUrl(u, place) {
  try {
    const seg = new URL(u).pathname.split('/').filter(Boolean)
      .map((s) => s.replace(/\.(html?|php|aspx?)$/i, ''))
      .filter((s) => !/^\d+$/.test(s) && s.length > 8)
      .pop() || '';
    const words = decodeURIComponent(seg)
      .replace(/[-_+]+/g, ' ')
      .replace(/\b\d{4,}\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (words.length >= 12) {
      const t = words.charAt(0).toUpperCase() + words.slice(1);
      return t.slice(0, 160);
    }
  } catch (e) {}
  return 'Reported incident near ' + (place || 'unknown location');
}

async function sectionEvents() {
  const listing = await get('https://data.gdeltproject.org/gdeltv2/lastupdate.txt',
    { json: false, timeout: 30000 });
  const line = String(listing).split('\n').find((l) => l.includes('.export.CSV.zip'));
  if (!line) throw new Error('no export in lastupdate.txt');
  const url = line.trim().split(/\s+/).pop().replace(/^http:/, 'https:');

  const zipBuf = await getBuffer(url, 90000);
  const tmpZip = path.join(os.tmpdir(), 'gdelt-export.zip');
  fs.writeFileSync(tmpZip, zipBuf);
  const csv = execFileSync('unzip', ['-p', tmpZip], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8');

  const fresh = new Map();      // url -> event
  for (const row of csv.split('\n')) {
    const c = row.split('\t');
    if (c.length < 61) continue;
    const root = parseInt(c[COL.ROOT], 10);
    const quad = parseInt(c[COL.QUAD], 10);
    if (!(root in ROOT_CAT) && quad !== 4) continue;
    const lat = parseFloat(c[COL.GEO_LAT]), lon = parseFloat(c[COL.GEO_LON]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const srcUrl = (c[COL.URL] || '').trim();
    if (!srcUrl) continue;
    const mentions = parseInt(c[COL.MENTIONS], 10) || 1;
    const place = (c[COL.GEO_NAME] || '').trim().slice(0, 80);
    const prev = fresh.get(srcUrl);
    if (prev) { prev.count += mentions; continue; }
    fresh.set(srcUrl, {
      lon: +lon.toFixed(2), lat: +lat.toFixed(2),
      place, url: srcUrl, count: mentions,
      cat: ROOT_CAT[root] || 'combat',
      at: Date.now()
    });
  }
  if (!fresh.size) throw new Error('no conflict rows in export batch');

  // Titles + country attribution only for what we keep.
  let freshList = [...fresh.values()].sort((a, b) => b.count - a.count).slice(0, 350);
  freshList.forEach((e) => {
    e.title = titleFromUrl(e.url, e.place);
    e.country = countryAt(e.lon, e.lat);
  });
  freshList = freshList.filter((e) => !looksDomesticCrime(e.title)).slice(0, 250);

  // Fold into the rolling 24h window carried by the previous run.
  const prevRolling = (PREV.events && PREV.events.rolling) || [];
  const cutoff = Date.now() - 24 * 3600000;
  const byUrl = new Map();
  for (const e of prevRolling) {
    if (!e.at || e.at < cutoff || !e.url) continue;
    if (looksDomesticCrime(e.title || '')) continue;   // re-filter carried items too
    byUrl.set(e.url, e);
  }
  for (const e of freshList) {
    const old = byUrl.get(e.url);
    if (old) { old.count = Math.max(old.count, e.count); old.at = e.at; }
    else byUrl.set(e.url, e);
  }
  const rolling = [...byUrl.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 900);

  const sixH = Date.now() - 6 * 3600000;
  let items = rolling.filter((e) => e.at >= sixH);
  // A fresh `data` branch (or a long pipeline outage) leaves the 6h window
  // nearly empty; the map is the product, so fall back to the full window.
  if (items.length < 40) items = rolling.slice();
  items = items.sort((a, b) => b.count - a.count).slice(0, 400);

  return { items, rolling, batch: url.slice(url.lastIndexOf('/') + 1) };
}

function sectionActive24(eventsSection) {
  const rolling = (eventsSection && eventsSection.rolling) || [];
  if (!rolling.length) throw new Error('no rolling events');
  const agg = {};
  for (const p of rolling) {
    const key = p.place || 'Unknown';
    if (!agg[key]) agg[key] = { place: key, country: p.country, count: 0, cat: p.cat };
    agg[key].count += p.count;
  }
  return { items: Object.values(agg).sort((a, b) => b.count - a.count).slice(0, 15) };
}

// ---- Markets (Yahoo Finance chart API — keyless) ----------------------------
const MARKET_SYMBOLS = [
  { s: '^GSPC', label: 'S&P 500', group: 'idx' },
  { s: '^DJI', label: 'Dow Jones', group: 'idx' },
  { s: '^IXIC', label: 'Nasdaq', group: 'idx' },
  { s: '^RUT', label: 'Russell 2000', group: 'idx' },
  { s: 'ES=F', label: 'S&P futures', group: 'fut' },
  { s: 'NQ=F', label: 'Nasdaq futures', group: 'fut' },
  { s: 'YM=F', label: 'Dow futures', group: 'fut' },
  { s: 'RTY=F', label: 'Russell futures', group: 'fut' },
  { s: 'GC=F', label: 'Gold', group: 'haven' },
  { s: 'SI=F', label: 'Silver', group: 'haven' },
  { s: 'DX-Y.NYB', label: 'Dollar index', group: 'haven' },
  { s: 'USDJPY=X', label: 'USD/JPY', group: 'fx' },
  { s: 'EURUSD=X', label: 'EUR/USD', group: 'fx' },
  { s: 'GBPUSD=X', label: 'GBP/USD', group: 'fx' },
  { s: 'USDCHF=X', label: 'USD/CHF', group: 'fx' },
  { s: 'CL=F', label: 'WTI crude', group: 'energy' },
  { s: 'BZ=F', label: 'Brent crude', group: 'energy' },
  { s: 'NG=F', label: 'Natural gas', group: 'energy' },
  { s: 'LMT', label: 'Lockheed Martin', group: 'defense' },
  { s: 'RTX', label: 'RTX', group: 'defense' },
  { s: 'NOC', label: 'Northrop', group: 'defense' },
  { s: 'GD', label: 'General Dynamics', group: 'defense' },
  { s: 'BA', label: 'Boeing', group: 'defense' },
  { s: 'BTC-USD', label: 'Bitcoin', group: 'crypto' },
  { s: 'ETH-USD', label: 'Ethereum', group: 'crypto' },
  { s: '^VIX', label: 'VIX', group: 'signal' },
  { s: '^TNX', label: 'US 10Y', group: 'signal' },
  { s: '^FVX', label: 'US 5Y', group: 'signal' },
  { s: 'XLK', label: 'Technology', group: 'sector' },
  { s: 'XLV', label: 'Health care', group: 'sector' },
  { s: 'XLF', label: 'Financials', group: 'sector' },
  { s: 'XLE', label: 'Energy', group: 'sector' },
  { s: 'XLI', label: 'Industrials', group: 'sector' },
  { s: 'XLY', label: 'Cons. discretionary', group: 'sector' },
  { s: 'XLP', label: 'Cons. staples', group: 'sector' },
  { s: 'XLU', label: 'Utilities', group: 'sector' },
  { s: 'XLB', label: 'Materials', group: 'sector' },
  { s: 'XLRE', label: 'Real estate', group: 'sector' },
  { s: 'XLC', label: 'Communications', group: 'sector' }
];

function downsample(arr, n) {
  const vals = arr.filter((v) => typeof v === 'number' && isFinite(v));
  if (vals.length <= n) return vals.map((v) => +v.toPrecision(5));
  const out = [];
  for (let i = 0; i < n; i++) out.push(+vals[Math.floor(i * (vals.length - 1) / (n - 1))].toPrecision(5));
  return out;
}

async function sectionMarkets() {
  const items = [];
  for (const sym of MARKET_SYMBOLS) {
    try {
      const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
        encodeURIComponent(sym.s) + '?range=1d&interval=5m&includePrePost=false';
      const j = await get(url, { timeout: 20000, tries: 2 });
      const r = j && j.chart && j.chart.result && j.chart.result[0];
      if (!r || !r.meta) throw new Error('no result');
      const price = r.meta.regularMarketPrice;
      const prev = r.meta.chartPreviousClose != null ? r.meta.chartPreviousClose : r.meta.previousClose;
      if (typeof price !== 'number' || typeof prev !== 'number' || !prev) throw new Error('no price');
      const closes = (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || [];
      items.push({
        s: sym.s, label: sym.label, group: sym.group,
        price: +price.toPrecision(6),
        chgPct: +(((price / prev) - 1) * 100).toFixed(2),
        spark: downsample(closes, 40)
      });
    } catch (e) { console.warn('yahoo', sym.s, 'failed:', e.message); }
    await sleep(300);
  }
  if (items.length < 8) throw new Error('too few market quotes (' + items.length + ')');

  const by = {}; items.forEach((i) => { by[i.s] = i; });
  const spx = by['^GSPC'], vix = by['^VIX'];
  const sectors = items.filter((i) => i.group === 'sector');
  const signals = {};
  if (spx && vix) {
    const score = Math.max(5, Math.min(95, Math.round(50 + spx.chgPct * 12 - vix.chgPct * 1.2)));
    signals.riskTone = {
      score,
      label: score >= 60 ? 'RISK-ON' : (score <= 40 ? 'RISK-OFF' : 'BALANCED'),
      spx: spx.chgPct, vix: vix.price
    };
  }
  if (sectors.length) {
    const adv = sectors.filter((s) => s.chgPct > 0).length;
    const avg = sectors.reduce((a, s) => a + s.chgPct, 0) / sectors.length;
    const sorted = [...sectors].sort((a, b) => b.chgPct - a.chgPct);
    signals.breadth = { adv, total: sectors.length, avg: +avg.toFixed(2) };
    signals.rotation = {
      leader: sorted[0].label, leaderPct: sorted[0].chgPct,
      laggard: sorted[sorted.length - 1].label, laggardPct: sorted[sorted.length - 1].chgPct
    };
  }
  const tnx = by['^TNX'], fvx = by['^FVX'];
  if (tnx && fvx) {
    const y10 = tnx.price > 20 ? tnx.price / 10 : tnx.price;
    const y5 = fvx.price > 20 ? fvx.price / 10 : fvx.price;
    signals.curve = { y10: +y10.toFixed(2), y5: +y5.toFixed(2), spreadBp: +((y10 - y5) * 100).toFixed(1) };
  }
  if (vix) {
    signals.vix = {
      value: vix.price, chgPct: vix.chgPct,
      label: vix.price < 16 ? 'CALM' : (vix.price < 22 ? 'NORMAL' : (vix.price < 30 ? 'ELEVATED' : 'EXTREME'))
    };
  }
  return { items, signals };
}

// ---- WHO disease outbreak news ----------------------------------------------
const PATHOGEN_HIGH = /\b(ebola|marburg|mers|h5n1|h7n9|avian influenza|nipah|lassa|plague|anthrax|hemorrhagic|haemorrhagic|mpox|monkeypox|polio|diphtheria)\b/i;

async function sectionOutbreaks() {
  const url = 'https://www.who.int/api/news/diseaseoutbreaknews' +
    '?sf_provider=dynamicProvider372&sf_culture=en' +
    '&%24orderby=PublicationDateAndTime%20desc&%24top=25' +
    '&%24select=Title,ItemDefaultUrl,PublicationDateAndTime,Summary';
  const j = await get(url);
  const rows = (j && (j.value || j.items)) || [];
  if (!rows.length) throw new Error('WHO returned no items');

  const items = rows.map((r) => {
    const title = stripTags(r.Title || r.title || '');
    if (!title) return null;
    const summary = stripTags(r.Summary || r.summary || '');
    const dateStr = r.PublicationDateAndTime || r.PublicationDate || null;
    const at = dateStr ? Date.parse(dateStr) : null;
    const parts = title.split(/\s[–—-]\s/);
    const country = parts.length > 1 ? parts[parts.length - 1].slice(0, 60) : null;
    const disease = parts[0].slice(0, 90);
    const cases = (summary.match(/([\d,]+)\s+(?:laboratory-)?(?:confirmed\s+)?cases/i) || [])[1] || null;
    const deaths = (summary.match(/([\d,]+)\s+deaths/i) || [])[1] || null;
    const cfr = (summary.match(/case fatality (?:rate|ratio)[^\d]{0,20}([\d.]+)\s*%/i) || [])[1] || null;
    const days = at ? Math.round((Date.now() - at) / 86400000) : null;
    let sev = 'moderate';
    if (PATHOGEN_HIGH.test(title)) sev = 'high';
    if (sev === 'high' && deaths && parseInt(deaths.replace(/,/g, ''), 10) >= 100 && days !== null && days <= 45) sev = 'critical';
    else if (sev === 'moderate' && deaths) sev = 'elevated';
    let slug = String(r.ItemDefaultUrl || '').trim();
    const link = slug
      ? (slug.startsWith('http') ? slug : 'https://www.who.int/emergencies/disease-outbreak-news/item/' + slug.replace(/^\//, ''))
      : null;
    return {
      disease, country, at: at || null, sev,
      cases, deaths, cfr, url: link,
      summary: summary.slice(0, 220)
    };
  }).filter(Boolean);
  return { items };
}

// ---- DEFCON (OSINT estimate) ------------------------------------------------
async function sectionDefcon(wireSection) {
  try {
    const html = await get('https://www.defconlevel.com/current-level.php', { json: false, timeout: 20000, tries: 2 });
    const m = String(html).match(/defcon\s*(?:level)?\s*(?:is\s*)?[^0-9]{0,10}([1-5])\b/i);
    if (m) return { level: parseInt(m[1], 10), source: 'defconlevel.com (OSINT estimate)', derived: false };
    throw new Error('no level found in page');
  } catch (e) {
    console.warn('defcon scrape failed:', e.message);
    const critical = ((wireSection && wireSection.items) || []).filter((i) => i.sev === 'critical').length;
    const level = critical >= 20 ? 3 : (critical >= 8 ? 4 : 5);
    return { level, source: 'derived from global event volume (unofficial)', derived: true };
  }
}

// ---- Prediction markets (Polymarket) ----------------------------------------
const GEO_RE = /\b(war|ceasefire|invasion|invade|missile|nuclear|NATO|Russia|Ukraine|Israel|Gaza|Iran|China|Taiwan|Korea|military|troops|sanctions?|Hezbollah|Houthis?|Putin|Zelensky|Netanyahu|regime|annex|treaty|border)\b/i;

async function sectionPredictions() {
  const j = await get('https://gamma-api.polymarket.com/events?closed=false&order=volume24hr&ascending=false&limit=100', { timeout: 25000 });
  const events = Array.isArray(j) ? j : [];
  const rows = [];
  for (const ev of events) {
    if (rows.length >= 10) break;
    const title = String(ev.title || '');
    if (!GEO_RE.test(title)) continue;
    let best = null, bestVol = -1;
    for (const m of (ev.markets || [])) {
      let prices, outcomes;
      try { prices = JSON.parse(m.outcomePrices || '[]'); outcomes = JSON.parse(m.outcomes || '[]'); }
      catch (e) { continue; }
      if (!prices.length) continue;
      let yesIdx = 0;
      outcomes.forEach((o, i) => { if (String(o).toLowerCase() === 'yes') yesIdx = i; });
      const prob = Number(prices[yesIdx]);
      if (isNaN(prob)) continue;
      const vol = Number(m.volume24hr || m.volume || 0);
      if (vol > bestVol) {
        bestVol = vol;
        best = { prob, label: (ev.markets.length > 1 ? String(m.groupItemTitle || m.question || '').slice(0, 60) : null) };
      }
    }
    if (!best) continue;
    rows.push({
      question: title.slice(0, 120), detail: best.label,
      probability: +best.prob.toFixed(3),
      volume: Math.round(Number(ev.volume24hr || ev.volume || 0)),
      url: ev.slug ? 'https://polymarket.com/event/' + ev.slug : null
    });
  }
  if (!rows.length) throw new Error('no geopolitical markets matched');
  return { items: rows };
}

// ---- Assemble ---------------------------------------------------------------
async function build(name, fn) {
  try {
    const data = await fn();
    console.log('OK  ', name, JSON.stringify(data).length, 'bytes');
    return { at: Date.now(), stale: false, ...data };
  } catch (e) {
    console.warn('FAIL', name, '-', e.message);
    const prev = PREV[name];
    if (prev && (prev.items || prev.level)) return { ...prev, stale: true };
    return { at: Date.now(), stale: true, items: [] };
  }
}

(async () => {
  const out = { generatedAt: Date.now() };
  out.events = await build('events', sectionEvents);
  out.active24 = await build('active24', () => sectionActive24(out.events));
  out.wire = await build('wire', sectionWire);
  out.finance = await build('finance', sectionFinance);
  out.markets = await build('markets', sectionMarkets);
  out.outbreaks = await build('outbreaks', sectionOutbreaks);
  out.predictions = await build('predictions', sectionPredictions);
  out.defcon = await build('defcon', () => sectionDefcon(out.wire));

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out));
  const size = fs.statSync(outPath).size;
  console.log('wrote', outPath, size, 'bytes');
  const staleCount = ['events', 'active24', 'wire', 'finance', 'markets', 'outbreaks', 'predictions', 'defcon']
    .filter((k) => out[k] && out[k].stale).length;
  if (staleCount >= 8) { console.error('every section failed — refusing to publish'); process.exit(1); }
})();
