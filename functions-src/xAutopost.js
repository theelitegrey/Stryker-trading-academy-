/**
 * Stryker Trading Academy — X autopost
 *
 * Publishes the site's own content to the academy's X account:
 *
 *   brief      the pre-market brief, as a thread, once per session
 *   calendar   a countdown post before each high-impact calendar event
 *   monitor    an alert when the Global Monitor's regime signals change
 *   announce   a new chapter, model, indicator or live session
 *   feature    a promo for one of the features pages, rotating daily
 *   manual     anything typed into the composer on the admin page
 *
 * brief, calendar, monitor and announce post on their own. feature posts wait
 * for approval on x-admin.html. Every post is drafted by the Claude API from
 * the source data (xAutopost-draft.js), carries a branded image card
 * (xAutopost-cards.js) and ends with a UTM-tagged link back to the site.
 *
 * FUNCTIONS (deploy names):
 *   xAutopostTick          schedule — every 10 minutes: enqueue, draft, post
 *   xAutopostAdmin         callable — admin: test credentials, run now, redraft
 *   xAutopostOnChapter     firestore — chapters/{id} created   → announce
 *   xAutopostOnModel       firestore — models/{id} created     → announce
 *   xAutopostOnIndicator   firestore — indicators/{id} created → announce
 *   xAutopostOnSession     firestore — liveSessions/{id} created → announce
 *
 * DEPLOY (name every function or the others get deleted):
 *   npm install @anthropic-ai/sdk @resvg/resvg-js
 *   firebase functions:secrets:set X_API_KEY        (and X_API_SECRET,
 *     X_ACCESS_TOKEN, X_ACCESS_SECRET, ANTHROPIC_API_KEY — see tools/x-autopost.md)
 *   firebase deploy --only functions:xAutopostTick,functions:xAutopostAdmin,\
 *     functions:xAutopostOnChapter,functions:xAutopostOnModel,\
 *     functions:xAutopostOnIndicator,functions:xAutopostOnSession
 *
 * FIRESTORE:
 *   xAutopost/config   admin-written settings (no secrets — they live in
 *                      Secret Manager, never in Firestore, which is readable
 *                      by every admin's browser and by anyone with console
 *                      access)
 *   xAutopost/state    cursors written only by this function
 *   xPosts/{id}        the queue. Doc ids are the de-duplication key: a
 *                      brief for one session, an alert for one event, a
 *                      feature for one day can each exist exactly once, so
 *                      a crashed run cannot double-post on retry.
 *
 * POST LIFECYCLE (status field):
 *   ready     enqueued, not yet drafted
 *   queued    drafted, waiting for an admin (feature posts only)
 *   approved  drafted, will post when scheduledForMs passes and pacing allows
 *   posted    on X; tweetIds and url set
 *   failed    posting or drafting threw; error set; admin can retry
 *   rejected  admin said no
 *   skipped   missed its window (a countdown after the event is noise)
 *
 * PACING: one post (or thread) per tick at most, never closer together than
 * config.minGapMinutes, never more than config.maxPerDay in a UTC day.
 * Calendar countdowns are the exception to the gap — they are worthless
 * late — but not to the daily cap.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { defineSecret } = require('firebase-functions/params');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');

const X = require('./xAutopost-x');
const Cards = require('./xAutopost-cards');
const Draft = require('./xAutopost-draft');

const X_API_KEY = defineSecret('X_API_KEY');
const X_API_SECRET = defineSecret('X_API_SECRET');
const X_ACCESS_TOKEN = defineSecret('X_ACCESS_TOKEN');
const X_ACCESS_SECRET = defineSecret('X_ACCESS_SECRET');
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const SECRETS = [X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET, ANTHROPIC_API_KEY];

const SITE = 'https://strykertrading.com';
const BRIEF_URL = SITE + '/assets/market-brief.json';
const CALENDAR_URL = SITE + '/assets/econ-calendar.json';
const MONITOR_URL = 'https://raw.githubusercontent.com/theelitegrey/Stryker-trading-academy-/data/monitor-data.json';

const TICK_MINUTES = 10;
const LINK_LEN = 23;   // every URL is 23 weighted characters on X

const DEFAULT_CONFIG = {
  enabled: false,
  briefHourUtc: 6, briefMinuteUtc: 30,
  calendarLeadMinutes: 30,
  featureHourUtc: 14,
  minGapMinutes: 45,
  maxPerDay: 5,
  monitorMaxPerDay: 2,
  cards: true,
  announceDelayMinutes: 30
};

// The features pages, in rotation order. Descriptions are the pages' own
// meta descriptions so the promo never claims something the page does not.
const FEATURES = [
  { page: 'features-curriculum.html', title: 'The Curriculum',
    blurb: 'A chapter-by-chapter ICT and SMT curriculum with tracked progress, quizzes, and achievements — structured the way a trading desk trains a new analyst.' },
  { page: 'features-charts.html', title: 'Charts Workspace',
    blurb: 'A full interactive charting workspace inside the academy — live crypto data, 70+ indicators, drawing tools, and layouts that save themselves.' },
  { page: 'features-models.html', title: 'Trading Models',
    blurb: 'Complete, rule-based trading models — context, entry, invalidation and management — documented step by step in the Stryker model library.' },
  { page: 'features-indicators.html', title: 'Private Indicators',
    blurb: 'Invite-only TradingView indicators — Liquidity Master, SMT Divergence Pro, IFVG Pro, FVG Relay and HTF PO3 Lens — with licensed access granted to your TradingView username.' },
  { page: 'features-live.html', title: 'Live Sessions',
    blurb: 'Live trading sessions with real-time chat, session replays with recap stats, and a next-session countdown shown in your own timezone.' },
  { page: 'features-monitor.html', title: 'Global Monitor',
    blurb: 'A single screen for global market context — the monitor every Stryker student checks before the session starts.' },
  { page: 'features-smart-money.html', title: 'Smart Money Desk',
    blurb: 'What Congress and corporate insiders are actually trading — congressional disclosures and SEC insider filings, refreshed daily, every row linked to the official document.' },
  { page: 'features-community.html', title: 'Community & Tools',
    blurb: 'The Trading Floor community, private messages, a structured trade journal, achievements, referrals and giveaways — the layer that keeps you consistent.' }
];

const PRIORITY = { calendar: 0, brief: 1, monitor: 2, announce: 3, manual: 4, feature: 5 };

// ---- helpers -----------------------------------------------------------------

const db = () => admin.firestore();
const now = () => Date.now();
const TS = () => admin.firestore.FieldValue.serverTimestamp();

function utcDate(ms) { return new Date(ms).toISOString().slice(0, 10); }
function isWeekday(ms) { const d = new Date(ms).getUTCDay(); return d >= 1 && d <= 5; }
function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function link(path, campaign) {
  const u = new URL(path, SITE);
  u.searchParams.set('utm_source', 'x');
  u.searchParams.set('utm_medium', 'social');
  u.searchParams.set('utm_campaign', campaign);
  return u.toString();
}

async function fetchJson(url, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs || 15000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) throw new Error(`${res.status} from ${url}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function loadConfig() {
  const snap = await db().doc('xAutopost/config').get();
  return Object.assign({}, DEFAULT_CONFIG, snap.exists ? snap.data() : {});
}

async function loadState() {
  const snap = await db().doc('xAutopost/state').get();
  return snap.exists ? snap.data() : {};
}

function creds() {
  return {
    apiKey: X_API_KEY.value(), apiSecret: X_API_SECRET.value(),
    accessToken: X_ACCESS_TOKEN.value(), accessSecret: X_ACCESS_SECRET.value()
  };
}

function credsMissing() {
  const c = creds();
  return ['apiKey', 'apiSecret', 'accessToken', 'accessSecret'].filter((k) => !c[k]);
}

/**
 * Creates a queue doc if its id does not exist yet. Returns true when created.
 * The id IS the de-duplication: the same brief, event, or day can never be
 * enqueued twice however many ticks look at it.
 */
async function enqueue(id, doc) {
  const ref = db().collection('xPosts').doc(id);
  return db().runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (cur.exists) return false;
    tx.set(ref, Object.assign({
      status: 'ready', createdAt: TS(), createdAtMs: now(),
      parts: null, tweetIds: null, error: null
    }, doc));
    return true;
  });
}

// ---- producers ------------------------------------------------------------------

/** The brief: one thread per session, after the configured time, weekdays. */
async function produceBrief(cfg, state, t) {
  if (!isWeekday(t)) return;
  const d = new Date(t);
  const afterTime = d.getUTCHours() * 60 + d.getUTCMinutes() >= cfg.briefHourUtc * 60 + cfg.briefMinuteUtc;
  if (!afterTime) return;

  let brief;
  try { brief = await fetchJson(BRIEF_URL); } catch (e) { console.warn('xAutopost: brief fetch failed:', e.message); return; }
  if (!brief || !brief.sessionDate || !brief.headline) return;

  // Only today's brief. Yesterday's, however fresh the file looks, is stale
  // by definition, and the refresh runbook is explicit that no brief is
  // published on a closed day.
  if (brief.sessionDate !== utcDate(t)) return;
  const goodUntil = brief.goodUntil ? Date.parse(brief.goodUntil) : null;
  if (goodUntil && goodUntil < t) return;

  const source = {
    sessionDate: brief.sessionDate, headline: brief.headline, standfirst: brief.standfirst,
    bullets: brief.bullets, calendar: brief.calendar, sessionNote: brief.sessionNote,
    watchOut: brief.watchOut, sources: brief.sources
  };

  await enqueue('brief-' + brief.sessionDate, {
    kind: 'brief', auto: true,
    title: brief.headline,
    link: link('/market-brief.html', 'brief'),
    scheduledForMs: t,
    expiresAtMs: goodUntil || (t + 6 * 3600000),
    source: JSON.stringify(source),
    sourceLabel: 'Pre-market brief · ' + brief.sessionDate,
    eyebrow: 'Pre-market brief · ' + fmtDate(brief.sessionDate),
    instructions:
      'Summarise this pre-market brief as a thread for traders about to start the session. ' +
      'Post 1: the headline idea, in your own words, as a hook. Middle posts: one per bullet, the point and why it matters. ' +
      'Last post: the session note or the trap to avoid, then credit the named sources. ' +
      'Every figure must appear verbatim in the source.'
  });
}

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Calendar: a countdown for each high-impact event, lead minutes ahead. */
async function produceCalendar(cfg, state, t) {
  let cal;
  try { cal = await fetchJson(CALENDAR_URL); } catch (e) { console.warn('xAutopost: calendar fetch failed:', e.message); return; }
  const events = (cal && cal.events) || [];
  const lead = cfg.calendarLeadMinutes * 60000;

  for (const ev of events) {
    if (ev.impact !== 'high' || ev.allday || !ev.at) continue;
    const at = Date.parse(ev.at);
    if (isNaN(at)) continue;
    if (ev.actual) continue;                                   // already released
    // Enqueue once the event is within lead + one tick, so the draft is ready
    // before its slot; the post itself waits for scheduledForMs.
    if (at - t > lead + TICK_MINUTES * 60000 || at < t) continue;

    const id = 'cal-' + ev.at.replace(/[^0-9]/g, '').slice(0, 12) + '-' + slug(ev.event);
    const when = new Date(at);
    const hhmm = when.toISOString().slice(11, 16) + ' UTC';
    const banks = (cal.banks || []).filter((b) => b.cur === ev.cur);
    const source = { event: ev.event, currency: ev.cur, timeUtc: hhmm, impact: ev.impact,
                     forecast: ev.forecast || null, previous: ev.previous || null, note: ev.note || null,
                     centralBank: banks[0] || null };
    await enqueue(id, {
      kind: 'calendar', auto: true,
      title: ev.event,
      link: link('/economic-calendar.html', 'calendar'),
      scheduledForMs: at - lead,
      expiresAtMs: at - 2 * 60000,        // a countdown after the release is noise
      eventAtMs: at,
      source: JSON.stringify(source),
      sourceLabel: 'Calendar · ' + ev.event,
      eyebrow: `${ev.cur} · high impact · ${hhmm}`,
      stat: { label: 'minutes', value: String(cfg.calendarLeadMinutes) },
      instructions:
        `Write a single post that ${cfg.calendarLeadMinutes} minutes before this release tells traders what is due, at what time (${hhmm}), ` +
        'and what the note says to watch. Include the forecast and previous figures only if they are given. ' +
        'One sentence of context, no prediction of the outcome.'
    });
  }
}

/** Monitor: alert on regime changes, never on the same state twice. */
async function produceMonitor(cfg, state, t) {
  let m;
  try { m = await fetchJson(MONITOR_URL); } catch (e) { console.warn('xAutopost: monitor fetch failed:', e.message); return; }
  const sig = (m && m.finance && m.finance.signals) || {};
  const seen = state.monitorSeen || {};
  const next = Object.assign({}, seen);
  const day = utcDate(t);
  const candidates = [];

  if (sig.vix && sig.vix.label) {
    // Post on entering ELEVATED or EXTREME, and on calming back to NORMAL
    // from either. CALM <-> NORMAL is not news.
    const was = seen.vixLabel || null;
    const isNow = sig.vix.label;
    const hot = (l) => l === 'ELEVATED' || l === 'EXTREME';
    if (was && isNow !== was && (hot(isNow) || hot(was))) {
      candidates.push({
        key: 'vix', title: `VIX ${isNow.toLowerCase()}: ${sig.vix.value}`,
        stat: { label: 'VIX', value: String(sig.vix.value) },
        source: { signal: 'VIX regime', from: was, to: isNow, vix: sig.vix.value, vixChangePct: sig.vix.chgPct,
                  riskTone: sig.riskTone || null, rotation: sig.rotation || null, breadth: sig.breadth || null, summary: m.summary || null }
      });
    }
    next.vixLabel = isNow;
  }

  if (sig.riskTone && sig.riskTone.label) {
    const was = seen.riskLabel || null;
    const isNow = sig.riskTone.label;
    if (was && isNow !== was && isNow !== 'BALANCED') {
      candidates.push({
        key: 'risk', title: `Tone flips to ${isNow.toLowerCase()}`,
        stat: { label: 'risk score', value: String(sig.riskTone.score) },
        source: { signal: 'Risk tone', from: was, to: isNow, score: sig.riskTone.score, spxChangePct: sig.riskTone.spx,
                  vix: sig.riskTone.vix, rotation: sig.rotation || null, breadth: sig.breadth || null, movers: sig.movers || null,
                  summary: m.summary || null }
      });
    }
    next.riskLabel = isNow;
  }

  if (m && m.defcon && m.defcon.level) {
    const was = seen.defcon || null;
    const isNow = m.defcon.level;
    if (was && isNow !== was) {
      candidates.push({
        key: 'defcon', title: `Readiness estimate moves to DEFCON ${isNow}`,
        stat: { label: 'DEFCON', value: String(isNow) },
        source: { signal: 'DEFCON (open-source estimate)', from: was, to: isNow, sourceName: m.defcon.source || null,
                  derived: !!m.defcon.derived, summary: m.summary || null, topWire: (m.wire || []).slice(0, 5) }
      });
    }
    next.defcon = isNow;
  }

  // The daily cap for monitor alerts is separate and lower: a choppy day can
  // flip the VIX label four times, and four alerts is a bot shouting.
  const todayCount = (state.monitorDay === day ? state.monitorCount : 0) || 0;
  let added = 0;
  for (const c of candidates) {
    if (todayCount + added >= cfg.monitorMaxPerDay) break;
    const created = await enqueue(`mon-${day}-${c.key}-${slug(String(c.source.to))}`, {
      kind: 'monitor', auto: true,
      title: c.title,
      link: link('/global-monitor.html', 'monitor'),
      scheduledForMs: t,
      expiresAtMs: t + 90 * 60000,       // a regime alert 2 hours late is a different regime
      source: JSON.stringify(c.source),
      sourceLabel: 'Global Monitor · ' + c.source.signal,
      eyebrow: 'Global Monitor · ' + c.source.signal,
      stat: c.stat,
      instructions:
        'Write a single post that reports this change in the Global Monitor signal, what it moved from and to, ' +
        'and one line of context from the summary or rotation data. Present it as an observation, not a forecast. ' +
        'If the signal is an open-source estimate, say so.'
    });
    if (created) added++;
  }

  await db().doc('xAutopost/state').set({
    monitorSeen: next,
    monitorDay: day,
    monitorCount: todayCount + added
  }, { merge: true });
}

/** Feature promo: one per day, rotating, waits for approval. */
async function produceFeature(cfg, state, t) {
  const d = new Date(t);
  if (d.getUTCHours() < cfg.featureHourUtc) return;
  const day = utcDate(t);
  const idx = ((state.featureIndex || 0) % FEATURES.length + FEATURES.length) % FEATURES.length;
  const f = FEATURES[idx];
  const created = await enqueue('feat-' + day, {
    kind: 'feature', auto: false,
    title: f.title,
    link: link('/' + f.page, 'feature-' + slug(f.title)),
    scheduledForMs: t,
    expiresAtMs: t + 3 * 86400000,
    source: JSON.stringify({ feature: f.title, page: f.page, description: f.blurb }),
    sourceLabel: 'Feature · ' + f.title,
    eyebrow: 'Inside the academy',
    instructions:
      'Write a single post that tells a retail trader what this feature does and why it would matter to them, ' +
      'based only on the description. One concrete detail from the description, no superlatives, no "game-changer". ' +
      'End with a short invitation to look, not a command.'
  });
  if (created) {
    await db().doc('xAutopost/state').set({ featureIndex: idx + 1 }, { merge: true });
  }
}

// ---- drafting -----------------------------------------------------------------

async function draftReady(cfg, t) {
  // No orderBy: an equality filter plus an order needs a composite index that
  // nobody will remember to create in the console. Sort the handful in memory.
  const snap = await db().collection('xPosts').where('status', '==', 'ready').get();
  const docs = snap.docs.slice().sort((a, b) => (a.data().createdAtMs || 0) - (b.data().createdAtMs || 0)).slice(0, 3);
  for (const doc of docs) {
    const p = doc.data();
    if (p.notBeforeMs && p.notBeforeMs > t) continue;
    if (p.expiresAtMs && p.expiresAtMs < t) {
      await doc.ref.set({ status: 'skipped', error: 'Expired before it was drafted.', updatedAt: TS() }, { merge: true });
      continue;
    }
    try {
      // Announcements re-read their subject at draft time, so a chapter
      // saved as "Untitled" and renamed ten minutes later announces the
      // real title.
      let source = p.source;
      let title = p.title;
      if (p.kind === 'announce' && p.subjectPath) {
        const subj = await db().doc(p.subjectPath).get();
        if (!subj.exists) {
          await doc.ref.set({ status: 'skipped', error: 'The item was deleted before it was announced.', updatedAt: TS() }, { merge: true });
          continue;
        }
        const s = announceSource(p.subjectKind, subj.id, subj.data());
        if (!s) {
          await doc.ref.set({ status: 'skipped', error: 'The item has no title yet.', updatedAt: TS() }, { merge: true });
          continue;
        }
        source = JSON.stringify(s.source);
        title = s.title;
      }

      const out = await Draft.draft({
        apiKey: ANTHROPIC_API_KEY.value(),
        kind: p.kind, instructions: p.instructions, source,
        linkLength: p.link ? LINK_LEN : 0, thread: p.kind === 'brief'
      });
      const svg = cfg.cards ? Cards.cardSvg({
        kind: p.kind, eyebrow: p.eyebrow, title: out.cardTitle || title,
        body: out.cardBody, stat: p.stat || null
      }) : null;
      await doc.ref.set({
        status: p.auto ? 'approved' : 'queued',
        title,
        parts: out.parts,
        cardSvg: svg,
        altText: out.altText,
        draftedBy: out.model || Draft.MODEL,
        draftUsage: out.usage || null,
        draftedAt: TS(), updatedAt: TS(), error: null
      }, { merge: true });
    } catch (e) {
      console.error('xAutopost: draft failed for', doc.id, e);
      await doc.ref.set({ status: 'failed', error: 'Draft: ' + String(e.message || e).slice(0, 400), updatedAt: TS() }, { merge: true });
    }
  }
}

function announceSource(kind, id, d) {
  if (kind === 'chapter') {
    if (!d.title || /^untitled/i.test(d.title)) return null;
    const lessons = (d.lessons || []).map((l) => l.title).filter(Boolean).slice(0, 6);
    return { title: d.title, source: { type: 'New curriculum chapter', number: d.num || id, title: d.title,
             level: d.level || null, duration: d.dur || null, lessons, firstParagraph: (d.paragraphs || [])[0] || null } };
  }
  if (kind === 'model') {
    if (!d.name || /^untitled/i.test(d.name)) return null;
    return { title: d.name, source: { type: 'New trading model', name: d.name, category: d.category || null,
             summary: d.summary || null, steps: (d.steps || []).map((s) => s.title).filter(Boolean).slice(0, 6) } };
  }
  if (kind === 'indicator') {
    if (!d.name || /^untitled/i.test(d.name)) return null;
    return { title: d.name, source: { type: 'New indicator', name: d.name, summary: d.summary || null } };
  }
  if (kind === 'session') {
    if (!d.title) return null;
    const at = d.startAtMillis ? new Date(d.startAtMillis).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null;
    return { title: d.title, source: { type: 'Upcoming live session', title: d.title, instrument: d.instrument || null,
             startsUtc: at, localDate: d.date || null, localTime: d.time || null, timezone: d.timezone || null,
             description: d.description || null } };
  }
  return null;
}

// ---- posting --------------------------------------------------------------------

async function postOne(cfg, state, t) {
  const day = utcDate(t);
  const postedToday = (state.postDay === day ? state.postCount : 0) || 0;
  if (postedToday >= cfg.maxPerDay) { console.log('xAutopost: daily cap reached'); return; }

  const snap = await db().collection('xPosts').where('status', '==', 'approved').get();
  const due = [];
  for (const doc of snap.docs) {
    const p = doc.data();
    if (p.expiresAtMs && p.expiresAtMs < t) {
      await doc.ref.set({ status: 'skipped', error: 'Missed its window.', updatedAt: TS() }, { merge: true });
      continue;
    }
    if ((p.scheduledForMs || 0) > t) continue;
    if (!p.parts || !p.parts.length) continue;
    due.push({ doc, p });
  }
  if (!due.length) return;

  due.sort((a, b) => (PRIORITY[a.p.kind] - PRIORITY[b.p.kind]) || ((a.p.scheduledForMs || 0) - (b.p.scheduledForMs || 0)));
  const pick = due[0];

  const sinceLast = t - (state.lastPostAtMs || 0);
  const gapOk = sinceLast >= cfg.minGapMinutes * 60000;
  if (!gapOk && pick.p.kind !== 'calendar') {
    console.log('xAutopost: holding for the gap; next in', Math.ceil((cfg.minGapMinutes * 60000 - sinceLast) / 60000), 'min');
    return;
  }

  const missing = credsMissing();
  if (missing.length) {
    await pick.doc.ref.set({ status: 'failed', error: 'X credentials not set on the server: ' + missing.join(', '), updatedAt: TS() }, { merge: true });
    return;
  }

  // Claim it first. A second tick overlapping this one (a slow render, a
  // scheduler hiccup) must not post the same document twice.
  const claimed = await db().runTransaction(async (tx) => {
    const cur = await tx.get(pick.doc.ref);
    if (!cur.exists || cur.data().status !== 'approved') return false;
    tx.set(pick.doc.ref, { status: 'posting', updatedAt: TS() }, { merge: true });
    return true;
  });
  if (!claimed) return;

  const p = pick.p;
  const c = creds();
  let mediaIds;
  try {
    // Manual posts carry only a card title; the SVG is built here so the
    // composer never has to duplicate the renderer.
    const svg = p.cardSvg || (p.cardTitle
      ? Cards.cardSvg({ kind: 'manual', eyebrow: p.eyebrow || 'Stryker Trading Academy', title: p.cardTitle, body: p.cardBody || '' })
      : null);
    if (cfg.cards && svg) {
      const png = await Cards.renderPng(svg);
      if (png) {
        const id = await X.uploadPng(c, png, p.altText || p.title);
        if (id) mediaIds = [id];
      }
    }
  } catch (e) {
    console.warn('xAutopost: card upload failed, posting text only:', e.message);
  }

  const parts = p.parts.slice();
  if (p.link) parts[parts.length - 1] = parts[parts.length - 1] + '\n\n' + p.link;

  try {
    const ids = await X.postThread(c, parts, { mediaIds });
    const handle = cfg.handle ? String(cfg.handle).replace(/^@/, '') : 'i';
    await pick.doc.ref.set({
      status: 'posted', tweetIds: ids, postedAtMs: t, postedAt: TS(), updatedAt: TS(),
      url: `https://x.com/${handle}/status/${ids[0]}`, hadCard: !!mediaIds, error: null
    }, { merge: true });
    await db().doc('xAutopost/state').set({
      lastPostAtMs: t, postDay: day, postCount: postedToday + 1,
      lastPostId: pick.doc.id, lastError: null
    }, { merge: true });
    console.log(`xAutopost: posted ${pick.doc.id} (${ids.length} tweet(s))`);
  } catch (e) {
    console.error('xAutopost: post failed for', pick.doc.id, e);
    await pick.doc.ref.set({ status: 'failed', error: String(e.message || e).slice(0, 400), updatedAt: TS() }, { merge: true });
    await db().doc('xAutopost/state').set({ lastError: String(e.message || e).slice(0, 400), lastErrorAtMs: t }, { merge: true });
  }
}

// ---- the tick -------------------------------------------------------------------

async function tick(reason) {
  const t = now();
  const cfg = await loadConfig();
  if (!cfg.enabled) { console.log('xAutopost: disabled in xAutopost/config'); return { ran: false }; }

  let state = await loadState();
  // Producers are independent: a broken calendar file must not stop the brief.
  for (const fn of [produceBrief, produceCalendar, produceMonitor, produceFeature]) {
    try { await fn(cfg, state, t); } catch (e) { console.error('xAutopost:', fn.name, 'failed:', e); }
  }
  try { await draftReady(cfg, t); } catch (e) { console.error('xAutopost: drafting failed:', e); }

  state = await loadState();
  try { await postOne(cfg, state, t); } catch (e) { console.error('xAutopost: posting failed:', e); }

  await db().doc('xAutopost/state').set({ lastTickAtMs: t, lastTickAt: TS(), lastTickReason: reason || 'schedule' }, { merge: true });
  return { ran: true };
}

exports.xAutopostTick = functions
  .runWith({ timeoutSeconds: 300, memory: '512MB', secrets: SECRETS })
  .pubsub.schedule('every 10 minutes')
  .timeZone('UTC')
  .onRun(() => tick('schedule'));

// ---- admin callable ---------------------------------------------------------------

async function assertAdmin(context) {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  const a = await db().doc('admins/' + context.auth.uid).get();
  if (!a.exists) throw new functions.https.HttpsError('permission-denied', 'Admins only.');
}

exports.xAutopostAdmin = functions
  .runWith({ timeoutSeconds: 300, memory: '512MB', secrets: SECRETS })
  .https.onCall(async (data, context) => {
    await assertAdmin(context);
    const action = data && data.action;

    if (action === 'whoami') {
      const missing = credsMissing();
      if (missing.length) return { ok: false, error: 'Secrets not set: ' + missing.join(', ') };
      try {
        const me = await X.whoAmI(creds());
        return { ok: true, user: me, anthropic: !!ANTHROPIC_API_KEY.value(), cards: !!tryRequire('@resvg/resvg-js') };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    }

    if (action === 'tick') {
      const r = await tick('manual');
      return { ok: true, ran: r.ran };
    }

    if (action === 'redraft') {
      const ref = db().collection('xPosts').doc(String(data.id || ''));
      const cur = await ref.get();
      if (!cur.exists) throw new functions.https.HttpsError('not-found', 'No such post.');
      if (cur.data().status === 'posted') throw new functions.https.HttpsError('failed-precondition', 'Already posted.');
      await ref.set({ status: 'ready', parts: null, cardSvg: null, error: null, updatedAt: TS() }, { merge: true });
      await draftReady(await loadConfig(), now());
      return { ok: true };
    }

    if (action === 'preview-card') {
      // Renders the stored SVG to PNG so the admin sees the real raster, not
      // the browser's own SVG rendering with different fonts.
      const ref = db().collection('xPosts').doc(String(data.id || ''));
      const cur = await ref.get();
      if (!cur.exists || !cur.data().cardSvg) return { ok: false, error: 'No card on this post.' };
      const png = await Cards.renderPng(cur.data().cardSvg);
      if (!png) return { ok: false, error: 'The renderer is not available on the server.' };
      return { ok: true, png: png.toString('base64') };
    }

    throw new functions.https.HttpsError('invalid-argument', 'Unknown action.');
  });

function tryRequire(name) { try { return require(name); } catch (e) { return null; } }

// ---- announcement triggers -----------------------------------------------------------
//
// Each enqueues an announce post with a delay (config.announceDelayMinutes),
// during which the admin usually finishes editing. The draft step re-reads
// the document, so the post reflects the final title. Everything the trigger
// needs to know about the subject is looked up then, not now.

function announceTrigger(collection, subjectKind, page, campaign) {
  return onDocumentCreated(collection + '/{id}', async (event) => {
    const snap = event.data;
    if (!snap) return;
    const cfg = await loadConfig();
    if (!cfg.enabled) return;
    const id = event.params.id;
    const d = snap.data() || {};
    const s = announceSource(subjectKind, id, d);
    // A doc without a real title yet still gets a queue entry; the draft step
    // re-reads it after the delay and skips it if it is still untitled.
    const t = now();
    await enqueue(`ann-${subjectKind}-${slug(id)}`, {
      kind: 'announce', auto: true,
      subjectKind, subjectPath: `${collection}/${id}`,
      title: s ? s.title : (d.title || d.name || id),
      link: link(page(id), campaign),
      notBeforeMs: t + (cfg.announceDelayMinutes || 30) * 60000,
      scheduledForMs: t + (cfg.announceDelayMinutes || 30) * 60000,
      expiresAtMs: subjectKind === 'session' && d.startAtMillis ? d.startAtMillis - 5 * 60000 : t + 3 * 86400000,
      source: s ? JSON.stringify(s.source) : '{}',
      sourceLabel: 'New ' + subjectKind,
      eyebrow: subjectKind === 'session' ? 'Live session' : 'New on the academy',
      instructions:
        subjectKind === 'session'
          ? 'Write a single post announcing this upcoming live session: what, when (give the UTC time as written), which instrument, and one line from the description. Invite readers to join.'
          : 'Write a single post announcing this new piece of content on the academy: what it is, what it covers, and who it is for. Use only what the source says.'
    });
  });
}

exports.xAutopostOnChapter = announceTrigger('chapters', 'chapter', (id) => '/chapter.html?ch=' + encodeURIComponent(id), 'new-chapter');
exports.xAutopostOnModel = announceTrigger('models', 'model', (id) => '/model.html?id=' + encodeURIComponent(id), 'new-model');
exports.xAutopostOnIndicator = announceTrigger('indicators', 'indicator', (id) => '/indicator.html?id=' + encodeURIComponent(id), 'new-indicator');
exports.xAutopostOnSession = announceTrigger('liveSessions', 'session', () => '/live-sessions.html', 'live-session');

exports.__internals = { announceSource, FEATURES, PRIORITY, link };
