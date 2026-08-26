#!/usr/bin/env node
/**
 * Stryker Trading Academy — Global Monitor data pipeline
 *
 * Run by .github/workflows/monitor-data.yml every ~20 minutes on a GitHub
 * Actions runner. Fetches every upstream the Global Monitor page needs and
 * writes one monitor-data.json, which the workflow publishes to the `data`
 * branch. The page reads it from raw.githubusercontent.com (CORS-open).
 *
 * WHY THIS EXISTS
 * GDELT rate-limits shared datacenter IPs into minute-long 429s (measured in
 * functions-src/refreshWorldData.js) and is unreachable from some student
 * networks entirely — a student in a region where GDELT is blocked saw
 * "offline" panels even though the page itself loaded. Fetching here and
 * serving a static JSON makes the data path: GitHub runner -> repo -> Pages
 * visitor, which only requires the student to reach GitHub — the same
 * requirement as loading the site at all.
 *
 * DESIGN RULES
 * - No npm dependencies; Node 20's fetch is enough.
 * - Every section is independent: one dead upstream costs one section.
 * - On section failure, the previous run's data for that section is kept and
 *   marked stale — the page degrades to old data, never to an error wall.
 * - Sequential requests with gaps; GDELT punishes bursts.
 *
 * Usage: node tools/fetch-monitor-data.js <previous.json|-> <out.json>
 */

'use strict';
const fs = require('fs');
const path = require('path');

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

async function get(url, { timeout = 45000, tries = 3, json = true } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(5000 * i);
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
      const text = await res.text();
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + text.slice(0, 120));
      return json ? JSON.parse(text) : text;
    } catch (e) { last = e; console.warn('  retryable:', url.slice(0, 90), '-', e.message); }
  }
  throw last;
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

const EVENTS_QUERY = '(war OR conflict OR military OR missile OR airstrike OR invasion OR troops OR ceasefire OR shelling OR "drone strike" OR sanctions OR coup OR insurgency OR terrorism OR protest OR mobilization)';
const WIRE_QUERY = '(war OR ceasefire OR missile OR airstrike OR invasion OR troops OR sanctions OR nuclear OR NATO OR "drone strike" OR offensive OR militants OR coup) sourcelang:eng';
const FIN_QUERY = '("federal reserve" OR "central bank" OR inflation OR "interest rate" OR forex OR currency OR dollar OR euro OR gold OR oil OR "stock market" OR stocks OR bonds OR recession OR tariffs OR sanctions) sourcelang:eng';

const GDELT_GEO = 'https://api.gdeltproject.org/api/v2/geo/geo';
const GDELT_DOC = 'https://api.gdeltproject.org/api/v2/doc/doc';

function fingerprint(title) {
  return String(title || '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()
    .split(' ').slice(0, 9).join(' ');
}
function parseSeenDate(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  return isNaN(t) ? null : t;
}

function parseGeo(json) {
  return ((json && json.features) || []).map((f) => {
    const c = (f.geometry && f.geometry.coordinates) || [];
    const p = f.properties || {};
    const lon = typeof c[0] === 'number' ? c[0] : null;
    const lat = typeof c[1] === 'number' ? c[1] : null;
    if (lon === null || lat === null) return null;
    const raw = String(p.html || p.name || '');
    const link = raw.match(/href=["']([^"']+)["']/i);
    const title = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title) return null;
    return {
      lon: +lon.toFixed(3), lat: +lat.toFixed(3),
      place: String(p.name || '').trim().slice(0, 80),
      title: title.slice(0, 220),
      url: link ? link[1] : null,
      count: Number(p.count) || 1,
      cat: categorise(title + ' ' + (p.name || '')),
      country: countryAt(lon, lat)
    };
  }).filter(Boolean).sort((a, b) => b.count - a.count);
}

function parseArticles(json, cap) {
  const out = [], seen = new Set();
  for (const a of ((json && json.articles) || [])) {
    const title = String(a.title || '').trim();
    if (!title) continue;
    const fp = fingerprint(title);
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    out.push({
      id: fp, title: title.slice(0, 200), url: a.url || null,
      source: String(a.domain || '').replace(/^www\./, '').slice(0, 40),
      country: String(a.sourcecountry || '').slice(0, 40) || null,
      at: parseSeenDate(a.seendate), cat: categorise(title)
    });
    if (out.length >= (cap || 80)) break;
  }
  return out;
}

// ---- Sections ---------------------------------------------------------------
async function sectionEvents() {
  const url = `${GDELT_GEO}?query=${encodeURIComponent(EVENTS_QUERY)}&mode=pointdata&format=geojson&timespan=6h`;
  const items = parseGeo(await get(url));
  if (!items.length) throw new Error('geo returned no events');
  return { items: items.slice(0, 400) };
}

async function sectionActive24() {
  const url = `${GDELT_GEO}?query=${encodeURIComponent(EVENTS_QUERY)}&mode=pointdata&format=geojson&timespan=24h`;
  const pts = parseGeo(await get(url));
  if (!pts.length) throw new Error('geo 24h returned no points');
  const agg = {};
  for (const p of pts) {
    const key = p.place || 'Unknown';
    if (!agg[key]) agg[key] = { place: key, country: p.country, count: 0, cat: p.cat };
    agg[key].count += p.count;
  }
  const items = Object.values(agg).sort((a, b) => b.count - a.count).slice(0, 15);
  return { items };
}

// Severity from GDELT's tone filter: one query per band, most severe first,
// membership decides the label. Sequential with gaps — GDELT punishes bursts.
async function sectionWire() {
  const bands = [
    ['critical', ' tone<-9', '24h', 40],
    ['high', ' tone<-6', '6h', 50],
    ['elevated', ' tone<-3.5', '6h', 50],
    ['active', '', '3h', 75]
  ];
  const seen = new Map();
  let gotAny = false;
  for (const [sev, toneQ, span, max] of bands) {
    try {
      const url = `${GDELT_DOC}?query=${encodeURIComponent(WIRE_QUERY + toneQ)}` +
        `&mode=artlist&format=json&maxrecords=${max}&sort=datedesc&timespan=${span}`;
      const arts = parseArticles(await get(url), max);
      gotAny = gotAny || arts.length > 0;
      for (const a of arts) if (!seen.has(a.id)) seen.set(a.id, { ...a, sev });
    } catch (e) { console.warn('wire band', sev, 'failed:', e.message); }
    await sleep(2500);
  }
  if (!gotAny) throw new Error('all wire bands failed');
  const rank = { critical: 0, high: 1, elevated: 2, active: 3 };
  const items = [...seen.values()]
    .sort((a, b) => rank[a.sev] - rank[b.sev] || (b.at || 0) - (a.at || 0))
    .slice(0, 140);
  return { items };
}

async function sectionFinance() {
  const bands = [['critical', ' tone<-7', 35], ['high', ' tone<-4.5', 45], ['watch', ' tone<-2.5', 50]];
  const seen = new Map();
  let gotAny = false;
  for (const [sev, toneQ, max] of bands) {
    try {
      const url = `${GDELT_DOC}?query=${encodeURIComponent(FIN_QUERY + toneQ)}` +
        `&mode=artlist&format=json&maxrecords=${max}&sort=datedesc&timespan=12h`;
      const arts = parseArticles(await get(url), max);
      gotAny = gotAny || arts.length > 0;
      for (const a of arts) if (!seen.has(a.id)) seen.set(a.id, { ...a, sev });
    } catch (e) { console.warn('finance band', sev, 'failed:', e.message); }
    await sleep(2500);
  }
  if (!gotAny) throw new Error('all finance bands failed');
  const rank = { critical: 0, high: 1, watch: 2 };
  const items = [...seen.values()]
    .sort((a, b) => rank[a.sev] - rank[b.sev] || (b.at || 0) - (a.at || 0))
    .slice(0, 60);
  return { items };
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
  { s: 'DX=F', label: 'Dollar index', group: 'haven' },
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

  // Derived signals — computed here so the page just renders numbers.
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
    // ^TNX/^FVX are CBOE yield indices; Yahoo returns them either as the
    // yield itself (4.66) or as yield*10 (46.6) depending on era — normalise.
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

function stripTags(s) { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

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
    // Titles read "Disease name – Country"; the dash and its flavour vary.
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
  // defconlevel.com publishes an OSINT estimate; scraping a level number is
  // brittle, so a derived estimate from event volume is the fallback — and
  // both are clearly labelled as unofficial on the page.
  try {
    const html = await get('https://www.defconlevel.com/current-level.php', { json: false, timeout: 20000, tries: 2 });
    const m = String(html).match(/defcon\s*(?:level)?\s*(?:is\s*)?[^0-9]{0,10}([1-5])\b/i);
    if (m) return { level: parseInt(m[1], 10), source: 'defconlevel.com (OSINT estimate)', derived: false };
    throw new Error('no level found in page');
  } catch (e) {
    console.warn('defcon scrape failed:', e.message);
    const critical = ((wireSection && wireSection.items) || []).filter((i) => i.sev === 'critical').length;
    // Derived scale never claims better than 3 — levels 1-2 are not something
    // to infer from news volume.
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
  // GDELT sections strictly sequential with gaps; the rest are cheap.
  out.events = await build('events', sectionEvents);
  await sleep(3000);
  out.active24 = await build('active24', sectionActive24);
  await sleep(3000);
  out.wire = await build('wire', sectionWire);
  await sleep(3000);
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
  // All eight sections dead almost certainly means the runner itself is
  // offline; publishing that run would replace good data ages with bad ones.
  if (staleCount >= 8) { console.error('every section failed — refusing to publish'); process.exit(1); }
})();
