/**
 * Stryker Trading Academy — market bots
 *
 * One scheduled Cloud Function driving two bot types, both of which publish to
 * the Trading Floor under their own bot identity:
 *
 *   market-analyst — reads the tape across a watchlist and posts a session
 *                    briefing: what moved, which session did the work, which
 *                    liquidity got taken, and the levels that matter next.
 *
 *   setup-scout    — scans the same watchlist for the setups the curriculum
 *                    teaches (sweep → MSS → FVG, Judas swing, prior-day
 *                    liquidity sweep) and posts the ones that pass, with the
 *                    entry zone, invalidation, target and the reasoning.
 *
 * DEPLOY (must name every function, or the others get deleted):
 *   firebase deploy --only functions:deleteUserAccount,functions:onNotificationCreated,
 *     functions:onContactMessageCreated,functions:mirrorTweets,functions:marketBots
 *
 * Requires functions-src/market-analysis.js alongside this file — that is
 * where the analysis lives; this file is plumbing, scheduling and wording.
 *
 * DATA: Yahoo Finance's chart API, keyless, the same source the Global Monitor
 * pipeline already uses (tools/fetch-monitor-data.js). No API key to rotate,
 * no vendor account to keep alive; if it fails the bot records why and posts
 * nothing rather than guessing.
 *
 * WHAT THESE BOTS DELIBERATELY DO NOT DO: they never claim certainty, never
 * size a position, and every setup post carries the education disclaimer. They
 * are a scanner that shows its work, which is what a student can learn from —
 * a signal service that says "buy here" teaches nothing and invites someone to
 * risk money on a bot's arithmetic.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const A = require('./market-analysis');

const UA = { 'User-Agent': 'StrykerTradingAcademy/1.0 (+https://strykertrading.com)' };

// Instruments students actually watch on the desk. Used when a bot has no
// watchlist of its own, so a freshly created bot is useful immediately.
const DEFAULT_WATCHLIST = 'EURUSD=X:EURUSD, GC=F:Gold, NQ=F:Nasdaq, ES=F:S&P 500, GBPUSD=X:GBPUSD';

/** "EURUSD=X:EURUSD, GC=F:Gold" → [{ symbol, label }] */
function parseWatchlist(raw) {
  return String(raw || DEFAULT_WATCHLIST)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const bits = part.split(':');
      const symbol = bits[0].trim();
      return { symbol, label: (bits[1] || symbol).trim() };
    })
    .filter((x) => x.symbol)
    .slice(0, 8);          // a briefing of twenty instruments is a spreadsheet
}

async function fetchCandles(symbol, interval, range) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(symbol) + '?interval=' + interval + '&range=' + range +
    '&includePrePost=false';
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('Yahoo returned ' + res.status + ' for ' + symbol);

  const json = await res.json();
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r || !r.timestamp) throw new Error('No candles for ' + symbol);

  const q = r.indicators.quote[0];
  const out = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    // Yahoo pads its arrays with nulls where a bar has no trade. A null low
    // silently becomes the day's low once it reaches a Math.min, which is how
    // a scanner ends up drawing a sweep that never happened.
    if (q.open[i] == null || q.high[i] == null || q.low[i] == null || q.close[i] == null) continue;
    out.push({ t: r.timestamp[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
  }
  return out;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const DISCLAIMER =
  'Automated analysis for study, not a recommendation. Check it against your own ' +
  'chart and your own rules before it goes anywhere near a trade.';

// ---------------------------------------------------------------------------
// Post composition
// ---------------------------------------------------------------------------

function setupPostHtml(s, timeframeLabel) {
  const dir = s.direction === 'long' ? 'Long' : 'Short';
  const grade = A.gradeSetup(s);
  const zone = s.zoneBottom === s.zoneTop
    ? String(s.entry)
    : s.zoneBottom + ' – ' + s.zoneTop;

  return '' +
    '<div class="sig-card sig-' + s.direction + '">' +
      '<div class="sig-top">' +
        '<span class="sig-dir">' + dir + '</span>' +
        '<span class="sig-sym">' + esc(s.label) + '</span>' +
        '<span class="sig-tf">' + esc(timeframeLabel) + '</span>' +
        '<span class="sig-grade sig-grade-' + grade.toLowerCase() + '">Grade ' + grade + '</span>' +
      '</div>' +
      '<p class="sig-model">' + esc(s.modelName) + '</p>' +
      '<div class="sig-levels">' +
        '<div><span>Entry zone</span><b>' + esc(zone) + '</b></div>' +
        '<div><span>Invalidation</span><b>' + s.stop + '</b></div>' +
        '<div><span>Target</span><b>' + s.target + '</b></div>' +
        '<div><span>R:R</span><b>' + s.rr + '</b></div>' +
      '</div>' +
      '<ul class="sig-why">' +
        s.reasons.map((r) => '<li>' + esc(r) + '</li>').join('') +
        (s.htfAligned
          ? '<li>Runs with the higher-timeframe read rather than against it</li>'
          : '<li>Counter to the higher-timeframe read — treat it as the weaker case</li>') +
      '</ul>' +
      '<p class="sig-foot">' + DISCLAIMER + '</p>' +
    '</div>';
}

function briefingPostHtml(rows, meta) {
  const lines = rows.map((r) => {
    const chg = r.chgPct == null ? '' :
      '<span class="sb-chg ' + (r.chgPct >= 0 ? 'up' : 'down') + '">' +
        (r.chgPct >= 0 ? '+' : '') + r.chgPct + '%</span>';
    const notes = [];
    if (r.sweeps.length) notes.push(r.sweeps.join(' and '));
    if (r.volatility === 'expanded') notes.push('range is running wide of its 14-day average');
    if (r.volatility === 'compressed') notes.push('range compressed against its average — expansion is owed');
    if (r.highSession && r.lowSession && r.highSession !== r.lowSession) {
      notes.push((A.SESSIONS[r.highSession] || {}).label + ' set the high, ' +
                 (A.SESSIONS[r.lowSession] || {}).label + ' the low');
    }
    if (!notes.length) notes.push('inside the prior range, no liquidity taken yet');

    return '<div class="sb-row">' +
      '<div class="sb-head"><b>' + esc(r.label) + '</b> <span class="sb-px">' + r.price + '</span> ' + chg +
        '<span class="sb-bias sb-' + r.bias + '">' + r.bias + '</span></div>' +
      '<div class="sb-note">' + esc(notes.join('; ')) + '</div>' +
      (r.pdh != null
        ? '<div class="sb-levels">Prior day ' + r.pdl + ' – ' + r.pdh +
          ' · today ' + r.dayLow + ' – ' + r.dayHigh + '</div>'
        : '') +
    '</div>';
  }).join('');

  const swept = rows.filter((r) => r.sweeps.length).length;
  const expanded = rows.filter((r) => r.volatility === 'expanded').length;
  const bull = rows.filter((r) => r.bias === 'bullish').length;

  // The read across the watchlist, stated from the counts rather than from a
  // hunch: how much of the board is trending one way, how much has already
  // taken liquidity, how much is still coiled.
  const summary =
    (bull >= rows.length - Math.floor(rows.length / 3)
      ? 'Most of the board is leaning bullish on the intraday read. '
      : (bull <= Math.floor(rows.length / 3)
        ? 'Most of the board is leaning bearish on the intraday read. '
        : 'The board is split — no single direction across the watchlist. ')) +
    (swept
      ? swept + ' of ' + rows.length + ' have already taken prior-day liquidity, so the draw for the next session is the opposite side. '
      : 'Nothing has taken prior-day liquidity yet — those highs and lows are still the obvious draw. ') +
    (expanded
      ? expanded + ' already expanded beyond the 14-day average range; late entries there are paying for a move that has mostly happened.'
      : 'Ranges are inside their averages, which is where expansion tends to come from.');

  return '' +
    '<div class="sig-brief">' +
      '<div class="sb-title">' + esc(meta.title) + '</div>' +
      '<p class="sb-summary">' + esc(summary) + '</p>' +
      lines +
      '<p class="sig-foot">' + DISCLAIMER + '</p>' +
    '</div>';
}

// ---------------------------------------------------------------------------
// Bot runners
// ---------------------------------------------------------------------------

const TF = {
  '15m': { interval: '15m', range: '5d', label: '15m' },
  '1h':  { interval: '60m', range: '1mo', label: '1H' }
};

async function markStatus(doc, status, error, published) {
  await doc.ref.set({
    lastStatus: status,
    lastError: error || null,
    lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
    publishedCount: admin.firestore.FieldValue.increment(published || 0)
  }, { merge: true });
}

async function upsertBotProfile(db, doc, name, cfg, bio) {
  await db.collection('profiles').doc('bot-' + doc.id).set({
    uid: 'bot-' + doc.id,
    name: name,
    displayName: name,
    isBotAccount: true,
    customPhotoURL: cfg.avatarUrl || null,
    bio: bio
  }, { merge: true });
}

async function publishPost(db, doc, name, cfg, html, flair) {
  await db.collection('communityPosts').add({
    authorUid: 'bot-' + doc.id,
    authorName: name,
    authorPlan: null,
    isTeamPost: false,
    isBotPost: true,
    botId: doc.id,
    textHtml: html,
    imageDataUrl: null,
    category: cfg.category || 'general',
    flair: flair || null,
    likedBy: [], upvotedBy: [], downvotedBy: [], replyCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * A briefing is published once per window per bot. The marker is the thing
 * that makes that true: a 30-minute schedule means this function sees the same
 * London window six times, and "post if it is after 07:00" would post six
 * briefings.
 */
async function runAnalyst(db, doc) {
  const cfg = doc.data().config || {};
  const name = doc.data().name || 'Market Analyst';
  const watchlist = parseWatchlist(cfg.watchlist);

  const now = new Date();
  const hour = now.getUTCHours();
  const dayKey = now.toISOString().slice(0, 10);

  // Which briefing this run falls into. Each window opens shortly after the
  // session it describes has had time to do something worth describing.
  let windowKey = null, title = null;
  if (hour >= 7 && hour < 10) {
    windowKey = 'london';
    title = 'London session read · ' + dayKey;
  } else if (hour >= 13 && hour < 16) {
    windowKey = 'newyork';
    title = 'New York session read · ' + dayKey;
  } else if (hour >= 20 && hour < 23) {
    windowKey = 'wrap';
    title = 'Daily wrap · ' + dayKey;
  }

  const wanted = cfg.briefings || 'all';
  if (!windowKey || (wanted !== 'all' && wanted !== windowKey)) {
    await markStatus(doc, 'ok', null, 0);
    return 0;
  }

  const markerId = doc.id + '__' + dayKey + '__' + windowKey;
  const marker = db.collection('botBriefings').doc(markerId);
  if ((await marker.get()).exists) {
    await markStatus(doc, 'ok', null, 0);
    return 0;
  }

  const rows = [];
  const failures = [];
  for (const item of watchlist) {
    try {
      const candles = await fetchCandles(item.symbol, '15m', '5d');
      const daily = await fetchCandles(item.symbol, '1d', '3mo').catch(() => null);
      const brief = A.briefInstrument(candles, daily, item);
      if (brief) rows.push(brief);
    } catch (err) {
      failures.push(item.symbol + ': ' + (err.message || err));
    }
  }

  if (!rows.length) {
    await markStatus(doc, 'error',
      'No market data could be fetched. ' + failures.slice(0, 2).join(' | '), 0);
    return 0;
  }

  // Marker first: a crash between the two is one missed briefing, where the
  // other ordering is a duplicate briefing on every run for the rest of the
  // window.
  await marker.set({
    botId: doc.id, dayKey, windowKey,
    instruments: rows.length,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await publishPost(db, doc, name, cfg,
    briefingPostHtml(rows, { title }), null);

  await upsertBotProfile(db, doc, name, cfg,
    'Automated desk analysis · session briefings across ' + watchlist.length + ' instruments');
  await markStatus(doc, failures.length ? 'ok' : 'ok',
    failures.length ? 'Some symbols failed: ' + failures.slice(0, 2).join(' | ') : null, 1);
  console.log('marketBots[' + name + ']: published ' + windowKey + ' briefing (' + rows.length + ' instruments)');
  return 1;
}

async function runScout(db, doc) {
  const cfg = doc.data().config || {};
  const name = doc.data().name || 'Setup Scout';
  const watchlist = parseWatchlist(cfg.watchlist);
  const tf = TF[cfg.timeframe] || TF['15m'];
  const minGrade = cfg.minGrade || 'B';
  const maxPerRun = Math.min(Math.max(parseInt(cfg.maxPerRun, 10) || 2, 1), 5);
  const cooldownMs = Math.max(30, parseInt(cfg.cooldownMinutes, 10) || 180) * 60 * 1000;

  const wantModels = {
    ict2022: cfg.modelIct2022 !== false,
    judas: cfg.modelJudas !== false,
    pdsweep: cfg.modelPdSweep !== false
  };

  let published = 0;
  const failures = [];

  for (const item of watchlist) {
    if (published >= maxPerRun) break;

    let candles;
    try {
      candles = await fetchCandles(item.symbol, tf.interval, tf.range);
    } catch (err) {
      failures.push(item.symbol + ': ' + (err.message || err));
      continue;
    }
    if (candles.length < 40) continue;

    const ctx = { symbol: item.symbol, label: item.label };
    const found = [];
    if (wantModels.ict2022) { const s = A.detectSweepMSS(candles, ctx); if (s) found.push(s); }
    if (wantModels.judas) {
      for (const session of ['london', 'ny']) {
        const s = A.detectJudas(candles, Object.assign({ session }, ctx));
        if (s) found.push(s);
      }
    }
    if (wantModels.pdsweep) { const s = A.detectPriorDaySweep(candles, ctx); if (s) found.push(s); }

    for (const setup of found) {
      if (published >= maxPerRun) break;

      const grade = A.gradeSetup(setup);
      if (A.GRADE_RANK[grade] < A.GRADE_RANK[minGrade]) continue;

      // Same setup, same bot, once. The key is derived from the candle that
      // triggered it, so a scan every 30 minutes sees the identical setup for
      // hours and publishes it once.
      const markerId = (doc.id + '__' + item.symbol + '__' + setup.key)
        .replace(/[^A-Za-z0-9_.:=-]/g, '_');
      const marker = db.collection('botSignals').doc(markerId);
      if ((await marker.get()).exists) continue;

      // Per-instrument cooldown on top: three valid setups on one symbol in an
      // hour is a scanner shouting, not a desk teaching. Kept as one document
      // per bot+instrument and read with a get, because the obvious
      // "most recent signal for this symbol" query is an equality plus an
      // orderBy on another field — a composite index, and one that only fails
      // once this is live.
      const cooldownRef = db.collection('botCooldowns')
        .doc((doc.id + '__' + item.symbol).replace(/[^A-Za-z0-9_.:=-]/g, '_'));
      const cooldownDoc = await cooldownRef.get();
      if (cooldownDoc.exists && Date.now() - (cooldownDoc.data().lastPostedMs || 0) < cooldownMs) continue;

      await marker.set({
        botId: doc.id, symbol: item.symbol, model: setup.model,
        grade, rr: setup.rr, direction: setup.direction,
        createdAtMs: Date.now(),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      await publishPost(db, doc, name, cfg, setupPostHtml(setup, tf.label), 'setup');
      await cooldownRef.set({ botId: doc.id, symbol: item.symbol, lastPostedMs: Date.now() });
      published++;
      console.log('marketBots[' + name + ']: ' + item.symbol + ' ' + setup.model +
                  ' ' + setup.direction + ' grade ' + grade + ' RR ' + setup.rr);
    }
  }

  await upsertBotProfile(db, doc, name, cfg,
    'Automated setup scanner · ' + tf.label + ' · sweep, structure shift and fair value gap');
  await markStatus(doc, 'ok',
    failures.length ? 'Some symbols failed: ' + failures.slice(0, 2).join(' | ') : null,
    published);
  return published;
}

exports.marketBots = functions
  // Long timeout: a watchlist of eight instruments is sixteen sequential
  // requests, and the whole point of running sequentially is not hammering a
  // free endpoint.
  .runWith({ timeoutSeconds: 540, memory: '256MB' })
  .pubsub.schedule('every 30 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    const db = admin.firestore();

    // Two equality-only queries rather than one `in` query: an `in` combined
    // with another equality needs a composite index, and a function that only
    // fails once it is deployed to production is the worst place to discover
    // that. This is the same query shape mirrorTweets already runs.
    const [analysts, scouts] = await Promise.all([
      db.collection('bots').where('type', '==', 'market-analyst').where('enabled', '==', true).get(),
      db.collection('bots').where('type', '==', 'setup-scout').where('enabled', '==', true).get()
    ]);

    const docs = analysts.docs.concat(scouts.docs);
    if (!docs.length) {
      console.log('marketBots: no enabled market bots');
      return null;
    }

    // Bots run independently: one bad watchlist must not stop the rest.
    await Promise.all(docs.map(async (doc) => {
      try {
        if (doc.data().type === 'market-analyst') await runAnalyst(db, doc);
        else await runScout(db, doc);
      } catch (err) {
        console.error('marketBots[' + doc.id + '] failed:', err);
        await markStatus(doc, 'error', String(err.message || err).slice(0, 300), 0);
      }
    }));

    return null;
  });

// Exported for tests and for anything else that wants the same wording.
exports.__internals = {
  parseWatchlist, setupPostHtml, briefingPostHtml, DEFAULT_WATCHLIST
};
