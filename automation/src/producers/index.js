/**
 * Producers: each looks at one source and enqueues posts that do not exist
 * yet. They are independent; one failing must not stop the others. The
 * queue id is the de-duplication key (see db.js).
 *
 *   brief     the pre-market brief, once per session, as a video + thread
 *   calendar  a countdown before each high-impact event
 *   monitor   an alert when a Global Monitor regime signal changes
 *   lesson    one educational Short a day, drawn from a chapter lesson
 *   promo     a features / signup promo video on chosen weekdays
 *   feature   a text promo for one features page, rotating daily
 *   announce  a new chapter, model, indicator or live session
 */
const db = require('../db');
const log = require('../log');
const site = require('../sources/site');
const content = require('../sources/firestore');
const { FEATURES } = require('../sources/features');
const { utcDate, utcDay, isWeekday, minutesOfDay, slug } = require('../util');

const PRIORITY = { calendar: 0, brief: 1, monitor: 2, announce: 3, manual: 4, lesson: 5, promo: 6, feature: 7 };

/** Which platforms a post goes to: video posts everywhere that is on; text posts to X and Threads. */
function platformsFor(kind, video, s) {
  const on = Object.keys(s.platforms).filter((p) => s.platforms[p]);
  if (video) return on;
  return on.filter((p) => p === 'x' || p === 'threads' || (p === 'instagram' && s.instagramCards));
}

function afterTime(t, hour, minute) { return minutesOfDay(t) >= hour * 60 + (minute || 0); }

function fmtDate(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ---- brief ------------------------------------------------------------------------

async function produceBrief(s, state, t) {
  const c = s.brief; if (!c.enabled || !isWeekday(t) || !afterTime(t, c.hour, c.minute)) return;
  const b = await site.brief();
  if (!site.briefIsFresh(b, t)) return;
  const id = 'brief-' + b.sessionDate;
  if (db.exists(id)) return;
  let prints = [];
  try { prints = site.keyPrints(await site.marketMap()); } catch (e) { /* strip is optional */ }
  const source = {
    sessionDate: b.sessionDate, headline: b.headline, standfirst: b.standfirst, bullets: b.bullets,
    calendar: b.calendar, sessionNote: b.sessionNote, watchOut: b.watchOut, sources: b.sources, prints
  };
  db.enqueue({
    id, kind: 'brief', title: b.headline, video: !!c.video, platforms: platformsFor('brief', c.video, s),
    priority: PRIORITY.brief, linkPath: '/market-brief.html', campaign: 'brief',
    source, scheduledForMs: t,
    expiresAtMs: b.goodUntil ? Date.parse(b.goodUntil) : t + 20 * 3600000,
    instructions:
      'This is the pre-market brief for ' + fmtDate(b.sessionDate) + '. Summarise what defines the session: the headline, ' +
      'the two or three bullets that matter most, and today\'s key release times if the calendar lists them. ' +
      'Credit outlets from `sources` by name where a bullet rests on their reporting. Context, not a call.'
  });
  log.info('producer: brief enqueued', id);
}

// ---- calendar -------------------------------------------------------------------------

async function produceCalendar(s, state, t) {
  const c = s.calendar; if (!c.enabled) return;
  const cal = await site.calendar();
  const lead = c.leadMinutes * 60000;
  for (const ev of (cal && cal.events) || []) {
    if (ev.impact !== 'high' || ev.allday || !ev.at || ev.actual) continue;
    const at = Date.parse(ev.at);
    if (isNaN(at) || at < t || at - t > lead + s.tickMinutes * 60000) continue;
    const id = 'cal-' + ev.at.replace(/[^0-9]/g, '').slice(0, 12) + '-' + slug(ev.event);
    if (db.exists(id)) continue;
    const banks = (cal.banks || []).filter((b) => b.cur === ev.cur);
    const source = { event: ev.event, currency: ev.cur, timeUtc: new Date(at).toISOString().slice(11, 16) + ' UTC', impact: ev.impact,
      forecast: ev.forecast || null, previous: ev.previous || null, note: ev.note || null, centralBank: banks[0] || null };
    db.enqueue({
      id, kind: 'calendar', title: ev.event, video: false, platforms: platformsFor('calendar', false, s),
      priority: PRIORITY.calendar, linkPath: '/economic-calendar.html', campaign: 'calendar', source,
      scheduledForMs: at - lead, expiresAtMs: at - 2 * 60000,
      instructions: 'Write a single post: a countdown to this release in ' + c.leadMinutes + ' minutes, naming it, ' +
        'the time in UTC as written, and the previous and forecast figures only if the source gives them. ' +
        'One line on why it matters for the session. No prediction of the print.'
    });
    log.info('producer: calendar enqueued', id);
  }
}

// ---- monitor -----------------------------------------------------------------------

async function produceMonitor(s, state, t) {
  const c = s.monitor; if (!c.enabled) return;
  const m = await site.monitor();
  const sig = (m && m.finance && m.finance.signals) || {};
  const seen = state.monitorSeen || {};
  const next = Object.assign({}, seen);
  const day = utcDate(t);
  const candidates = [];
  const hot = (l) => l === 'ELEVATED' || l === 'EXTREME';

  if (sig.vix && sig.vix.label) {
    const was = seen.vixLabel || null, isNow = sig.vix.label;
    if (was && isNow !== was && (hot(isNow) || hot(was))) candidates.push({
      key: 'vix', title: `VIX ${isNow.toLowerCase()}: ${sig.vix.value}`, stat: { label: 'VIX', value: String(sig.vix.value) },
      source: { signal: 'VIX regime', from: was, to: isNow, vix: sig.vix.value, vixChangePct: sig.vix.chgPct,
        riskTone: sig.riskTone || null, rotation: sig.rotation || null, breadth: sig.breadth || null, summary: m.summary || null }
    });
    next.vixLabel = isNow;
  }
  if (sig.riskTone && sig.riskTone.label) {
    const was = seen.riskLabel || null, isNow = sig.riskTone.label;
    if (was && isNow !== was && isNow !== 'BALANCED') candidates.push({
      key: 'risk', title: `Tone flips to ${isNow.toLowerCase()}`, stat: { label: 'risk score', value: String(sig.riskTone.score) },
      source: { signal: 'Risk tone', from: was, to: isNow, score: sig.riskTone.score, spxChangePct: sig.riskTone.spx, vix: sig.riskTone.vix,
        rotation: sig.rotation || null, breadth: sig.breadth || null, movers: sig.movers || null, summary: m.summary || null }
    });
    next.riskLabel = isNow;
  }
  if (m && m.defcon && m.defcon.level) {
    const was = seen.defcon || null, isNow = m.defcon.level;
    if (was && isNow !== was) candidates.push({
      key: 'defcon', title: `Readiness estimate moves to DEFCON ${isNow}`, stat: { label: 'DEFCON', value: String(isNow) },
      source: { signal: 'DEFCON (open-source estimate)', from: was, to: isNow, sourceName: m.defcon.source || null,
        derived: !!m.defcon.derived, summary: m.summary || null, topWire: (m.wire || []).slice(0, 5) }
    });
    next.defcon = isNow;
  }

  const todayCount = (state.monitorDay === day ? state.monitorCount : 0) || 0;
  let added = 0;
  for (const cand of candidates) {
    if (todayCount + added >= c.maxPerDay) break;
    const created = db.enqueue({
      id: `mon-${day}-${cand.key}-${slug(String(cand.source.to))}`, kind: 'monitor', title: cand.title, video: false,
      platforms: platformsFor('monitor', false, s), priority: PRIORITY.monitor, linkPath: '/global-monitor.html', campaign: 'monitor',
      source: Object.assign({ stat: cand.stat }, cand.source), scheduledForMs: t, expiresAtMs: t + 90 * 60000,
      instructions: 'Write a single post that reports this change in the Global Monitor signal, what it moved from and to, ' +
        'and one line of context from the summary or rotation data. An observation, not a forecast. If the signal is an open-source estimate, say so.'
    });
    if (created) { added++; log.info('producer: monitor enqueued', cand.key); }
  }
  db.patchState({ monitorSeen: next, monitorDay: day, monitorCount: todayCount + added });
}

// ---- lesson (educational Short) -------------------------------------------------------

/** Picks the next lesson with enough text, advancing a cursor in state. */
function nextLesson(chapters, cursor) {
  let ci = cursor.chapter || 0, li = cursor.lesson || 0;
  for (let n = 0; n < 500; n++) {
    if (ci >= chapters.length) { ci = 0; li = 0; }
    const ch = chapters[ci];
    if (ch && li < ch.lessons.length) {
      const l = ch.lessons[li];
      const next = { chapter: ci, lesson: li + 1 };
      if (l.text && l.text.length >= 200) return { chapter: ch, lesson: l, next };
      li++;
    } else { ci++; li = 0; }
  }
  return null;
}

async function produceLesson(s, state, t) {
  const c = s.lesson; if (!c.enabled || !afterTime(t, c.hour, c.minute)) return;
  if (Array.isArray(c.days) && c.days.length && !c.days.includes(utcDay(t))) return;
  const id = 'lesson-' + utcDate(t);
  if (db.exists(id)) return;
  const chapters = await content.chapters();
  const pick = nextLesson(chapters, state.lessonCursor || {});
  if (!pick) return;
  const source = { chapter: pick.chapter.num + ' ' + pick.chapter.title, level: pick.chapter.level, lesson: pick.lesson.title, text: pick.lesson.text };
  db.enqueue({
    id, kind: 'lesson', title: pick.lesson.title, video: !!c.video, platforms: platformsFor('lesson', c.video, s),
    priority: PRIORITY.lesson, linkPath: '/chapter.html?ch=' + encodeURIComponent(pick.chapter.id || pick.chapter.num), campaign: 'lesson-' + slug(pick.lesson.title),
    source, scheduledForMs: t, expiresAtMs: t + 36 * 3600000,
    instructions: 'Teach ONE concept from this lesson to a retail trader in under a minute, in the academy\'s voice. ' +
      'Open with the mistake or the question, then the idea, then how to check it on a chart. ' +
      'End by saying the full chapter is on strykertrading.com. Everything must come from the lesson text; add nothing.'
  });
  db.patchState({ lessonCursor: pick.next });
  log.info('producer: lesson enqueued', id, pick.lesson.title);
}

// ---- promo (video) and feature (text) --------------------------------------------------

async function producePromo(s, state, t) {
  const c = s.promo; if (!c.enabled || !afterTime(t, c.hour, c.minute)) return;
  if (Array.isArray(c.days) && c.days.length && !c.days.includes(utcDay(t))) return;
  const id = 'promo-' + utcDate(t);
  if (db.exists(id)) return;
  const idx = ((state.promoIndex || 0) % FEATURES.length + FEATURES.length) % FEATURES.length;
  const f = FEATURES[idx];
  db.enqueue({
    id, kind: 'promo', title: f.title, video: !!c.video, platforms: platformsFor('promo', c.video, s),
    priority: PRIORITY.promo, linkPath: '/signup.html', campaign: 'promo-' + slug(f.title),
    source: { feature: f.title, page: f.page, description: f.blurb, offer: 'Free account at strykertrading.com' },
    scheduledForMs: t, expiresAtMs: t + 36 * 3600000,
    instructions: 'A short promo for this feature of the academy, based only on the description: what it is, one concrete ' +
      'detail, who it is for, and an invitation to create a free account. No superlatives, no "game-changer", no promises of profit.'
  });
  db.patchState({ promoIndex: idx + 1 });
  log.info('producer: promo enqueued', id, f.title);
}

async function produceFeature(s, state, t) {
  const c = s.feature; if (!c.enabled || !afterTime(t, c.hour, c.minute)) return;
  const id = 'feature-' + utcDate(t);
  if (db.exists(id)) return;
  const idx = ((state.featureIndex || 0) % FEATURES.length + FEATURES.length) % FEATURES.length;
  const f = FEATURES[idx];
  db.enqueue({
    id, kind: 'feature', title: f.title, video: false, platforms: platformsFor('feature', false, s),
    priority: PRIORITY.feature, linkPath: '/' + f.page, campaign: 'feature-' + slug(f.title),
    source: { feature: f.title, page: f.page, description: f.blurb }, scheduledForMs: t, expiresAtMs: t + 20 * 3600000,
    instructions: 'Write a single post promoting this feature of the academy, based only on the description. ' +
      'One concrete detail from the description, no superlatives, no "game-changer".'
  });
  db.patchState({ featureIndex: idx + 1 });
  log.info('producer: feature enqueued', id, f.title);
}

// ---- announce -----------------------------------------------------------------------

const ANNOUNCE = [
  { coll: 'chapters', kind: 'chapter', path: (d) => '/chapter.html?ch=' + encodeURIComponent(d.id), campaign: 'new-chapter',
    src: (d) => d.title && !/^untitled/i.test(d.title) && { title: d.title, source: { type: 'New curriculum chapter', number: d.num || d.id, title: d.title,
      level: d.level || null, duration: d.dur || null, lessons: (d.lessons || []).map((l) => l.title).filter(Boolean).slice(0, 6), firstParagraph: content.stripHtml((d.paragraphs || [])[0] || '') || null } } },
  { coll: 'models', kind: 'model', path: (d) => '/model.html?id=' + encodeURIComponent(d.id), campaign: 'new-model',
    src: (d) => d.name && !/^untitled/i.test(d.name) && { title: d.name, source: { type: 'New trading model', name: d.name, category: d.category || null,
      summary: d.summary || null, steps: (d.steps || []).map((x) => x.title).filter(Boolean).slice(0, 6) } } },
  { coll: 'indicators', kind: 'indicator', path: (d) => '/indicator.html?id=' + encodeURIComponent(d.id), campaign: 'new-indicator',
    src: (d) => d.name && !/^untitled/i.test(d.name) && { title: d.name, source: { type: 'New indicator', name: d.name, summary: d.summary || null } } },
  { coll: 'liveSessions', kind: 'session', path: () => '/live-sessions.html', campaign: 'live-session',
    src: (d) => d.title && { title: d.title, source: { type: 'Upcoming live session', title: d.title, instrument: d.instrument || null,
      startsUtc: d.startAtMillis ? new Date(d.startAtMillis).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null,
      localDate: d.date || null, localTime: d.time || null, timezone: d.timezone || null, description: d.description || null } } }
];

async function produceAnnounce(s, state, t) {
  const c = s.announce; if (!c.enabled || !content.available()) return;
  const since = state.announceSinceMs || (t - 24 * 3600000);
  let newest = since;
  for (const a of ANNOUNCE) {
    for (const d of await content.createdSince(a.coll, since)) {
      newest = Math.max(newest, d.createdMs);
      const made = a.src(d); if (!made) continue;
      const id = `ann-${a.kind}-${slug(d.id)}`;
      if (db.exists(id)) continue;
      db.enqueue({
        id, kind: 'announce', title: made.title, video: false, platforms: platformsFor('announce', false, s),
        priority: PRIORITY.announce, linkPath: a.path(d), campaign: a.campaign, source: made.source,
        scheduledForMs: d.createdMs + c.delayMinutes * 60000,
        expiresAtMs: a.kind === 'session' && d.startAtMillis ? d.startAtMillis - 5 * 60000 : t + 3 * 86400000,
        instructions: a.kind === 'session'
          ? 'Write a single post announcing this upcoming live session: what, when (UTC time as written), which instrument, one line from the description. Invite readers to join.'
          : 'Write a single post announcing this new addition to the academy: what it is and one concrete thing it covers. Invite readers to open it.'
      });
      log.info('producer: announce enqueued', id);
    }
  }
  db.patchState({ announceSinceMs: newest });
}

const ALL = [produceBrief, produceCalendar, produceMonitor, produceLesson, producePromo, produceFeature, produceAnnounce];

async function runAll(s, t) {
  for (const fn of ALL) {
    try { await fn(s, db.state(), t); } catch (e) { log.error('producer', fn.name, 'failed:', e.message); }
  }
}

module.exports = { runAll, PRIORITY, platformsFor, nextLesson, ALL };
