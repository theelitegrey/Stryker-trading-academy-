// Seeds the "TradeZoro Trading Room" DEMO community (Owner order 2026-10-30). Writes the same documents the Creator Hub app writes,
// plus sample members/posts/comments/results, all flagged demo:true. Undo with demo-cleanup.js. Usage: node demo-seed.mjs [--apply]
import { getDoc, setDocs, ts, mergeDoc } from '../demo-account/lib/gcp.mjs';
const APPLY = process.argv.includes('--apply');
const OWNER = '0hC8vmnsh0O2CkyWiyw9X1kn1XL2', OWNER_NAME = 'Gaurav Singh';
const IMG = 'https://tradezoro.com/assets/images/demo-community/';
const NOW = Date.now(), H = 3600e3, D = 24 * H;
const rnd = (() => { let s = 1030; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const pick = (a) => a[Math.floor(rnd() * a.length)];

let slug = 'tradezoro';
if (await getDoc('slugs/' + slug)) slug = 'tradezoro-room';
if (await getDoc('slugs/' + slug)) { console.log('both slugs taken'); process.exit(1); }
const C = `communities/${slug}`;

const NAMES = ['Aarav Mehta','Maya Collins','Daniel Ortiz','Priya Nair','Liam Foster','Sofia Rossi','Kenji Watanabe','Hannah Brooks','Rohan Kapoor','Elena Petrova','Marcus Reed','Ananya Iyer','Tyler Nguyen','Chloe Bennett','Vikram Rao','Isabella Cruz','Noah Fischer','Zara Khan','Ethan Walsh','Meera Joshi','Lucas Almeida','Grace Turner','Arjun Malhotra','Olivia Hart','Samir Qureshi','Nina Jensen','Jamal Carter','Kavya Reddy','Owen Price','Leila Haddad','Brandon Lee','Tara Singh'];
const members = NAMES.map((n, i) => ({ uid: 'demo_tr_' + String(i + 1).padStart(2, '0'), name: n, joined: NOW - (3 + Math.floor(rnd() * 24)) * D - Math.floor(rnd() * 20) * H }));
const U = (n) => members[n - 1];

const out = [];
const add = (path, data) => out.push({ path, data });

// students (flag only; plan stays the free entry plan, no paid/live-data keys)
for (const m of members) add('students/' + m.uid, { demo: true, displayName: m.name, name: m.name, plan: 'Starter', createdAt: ts(m.joined), source: 'demo-community' });

// community (same shape as creator-new.js + demo flag; link-only: unlisted so it is not in the directory)
const ABOUT = `Welcome to the TradeZoro Trading Room. I'm Gaurav, I build TradeZoro and ZoroCharts, and this is where I teach how to use them.

What you get here:
- Chart walkthroughs: how I set up a chart, step by step.
- Our own indicators, delivered straight to your chart.
- A short course, ZoroCharts Basics: layouts, indicators, replay, journal and the GEX levels page.
- Weekly sessions: Monday market prep and a Replay One practice session.

Education only. Not financial advice. Nothing here is a signal or a promise of results.

Find us: https://tradezoro.com
X: https://x.com/thetradezoro
YouTube: https://www.youtube.com/@tradezoro
Instagram: https://www.instagram.com/thetradezoro`;
add(C, { ownerUid: OWNER, slug, name: 'TradeZoro Trading Room', ownerName: OWNER_NAME, tagline: 'Charts, indicators, a short course and weekly sessions, from the team behind ZoroCharts.', about: ABOUT,
  logoUrl: IMG + 'logo.png', coverUrl: IMG + 'cover.webp', introVideo: '', accent: '#03c988',
  visibility: 'unlisted', features: { feed: true, courses: true, indicators: true, events: true, leaderboard: true, discord: true },
  tags: ['futures', 'charts', 'education'], status: 'active', createdAt: ts(NOW - 30 * D), updatedAt: ts(NOW), memberCount: members.length + 1, founding: true,
  rulesAcceptedAt: ts(NOW - 30 * D), rulesVersion: '1', demo: true });
add('slugs/' + slug, { ownerUid: OWNER, createdAt: ts(NOW - 30 * D), demo: true });
add(`${C}/members/${OWNER}`, { uid: OWNER, planId: null, role: 'owner', source: 'owner', status: 'active', joinedAt: ts(NOW - 30 * D), expiresAt: null, lastActiveAt: ts(NOW), displayName: OWNER_NAME });
for (const m of members) add(`${C}/members/${m.uid}`, { uid: m.uid, planId: 'p1', role: 'member', source: 'free', status: 'active', joinedAt: ts(m.joined), expiresAt: null, lastActiveAt: ts(NOW - Math.floor(rnd() * 5) * D), displayName: m.name, demo: true });

// plans: free live, Pro Room draft (hidden, cannot sell until the Owner connects Stripe)
add(`${C}/plans/p1`, { name: 'Free', desc: 'Join free. Feed, events, the leaderboard, the course and our indicators.', bullets: ['Community feed and weekly events', 'ZoroCharts Basics course', 'TradeZoro indicators on your chart', 'Leaderboard'], price: { amount: 0, currency: 'USD', interval: 'free' }, trialDays: 0, popular: false, status: 'live', joinMode: 'open', order: 0, updatedAt: ts(NOW) });
add(`${C}/plans/p2`, { name: 'Pro Room', desc: 'A closer room: extra live sessions and Q&A with Gaurav. Draft until payments are connected.', bullets: ['Everything in Free', 'Extra weekly Q&A session', 'Priority answers from Gaurav'], price: { amount: 19, currency: 'USD', interval: 'month' }, trialDays: 0, popular: true, status: 'draft', joinMode: 'open', order: 1, updatedAt: ts(NOW) });

// feed
const P = [];
const post = (id, uid, name, ageH, text, o = {}) => { P.push(id); add(`${C}/posts/${id}`, Object.assign({ authorUid: uid, authorName: name, text, pinned: !!o.pinned, createdAt: ts(NOW - ageH * H), demo: true }, o.image ? { imageUrl: IMG + o.image, imageAlt: o.alt || 'Chart' } : {}, { likeCount: o.likes || 0, commentCount: o.cc || 0 })); };
post('welcome01', OWNER, OWNER_NAME, 24 * 14, `Welcome to the TradeZoro Trading Room.\n\nThis is a demo room: the members, posts and results you see are samples, and every result is marked Example. Start with the course ZoroCharts Basics, add the indicators to your chart, and join Monday market prep.\n\nEducation only. Not financial advice.`, { pinned: true, likes: 27 });
post('indhowto1', OWNER, OWNER_NAME, 24 * 10, `How to use the indicators here\n\n1. Open the Indicators tab and tap Add to my charts.\n2. Open ZoroCharts. They are in your Indicators list under Community.\n3. Start with Session Sweep, then add Liquidity Master. Keep it simple: one idea per chart.\n\nThey mark the chart. They do not tell you what to trade.`, { likes: 19 });
post('sessions01', OWNER, OWNER_NAME, 24 * 3, `This week's sessions (online, hosted by me)\n\nMonday market prep: 8:30 AM New York / 7:00 PM IST\nReplay One practice session: Wednesday 11:00 AM New York / 9:30 PM IST\n\nRSVP in the Events tab. Bring one chart you want to talk through.`, { likes: 22 });
post('walkthru1', OWNER, OWNER_NAME, 24 * 5, `Chart walkthrough: my NQ 15m layout\n\nSessions marked first, then the levels from the GEX page, then I scroll back and ask one question: where did price react last time? The marks are just a map. I write the plan in the journal before the open.\n\nWhat would you add to this layout?`, { image: 'nq-chart.webp', alt: 'NQ 15 minute chart on ZoroCharts', likes: 31 });
post('question01', OWNER, OWNER_NAME, 30, `Quick question for you: what is the one thing about charts you still find confusing? Layouts, replay, reading the levels? Tell me below and I will cover the top answers in Monday prep.`, { likes: 14 });
post('results001', OWNER, OWNER_NAME, 24 * 2, `Member results thread (sample)\n\nPost a recap of a practice trade. Rules: label it Example or Sample, show the plan, and tell us what you would do differently. These are demo samples drawn on our own chart renders, not broker statements.`, { likes: 18 });
const MP = [
  ['mp1', 4, 52, `Example recap: swept the Asia low, 5m gap held on the retest. Plan was written before the open. Sample numbers on the card.`, { image: 'result-1.webp', alt: 'Example trade recap card', likes: 24 }],
  ['mp2', 1, 70, `Question: how do you all set up your layouts for the NY open? I keep changing mine every week.`, { likes: 9 }],
  ['mp3', 8, 96, `Example: a Replay One practice session recap. Marked levels at 9:00, waited for the sweep. Sample card, practice data.`, { image: 'result-3.webp', alt: 'Example trade recap card', likes: 20 }],
  ['mp4', 14, 120, `Example lesson: a stopped-out trade. Entry was fine, the higher timeframe bias was not. Writing it in the journal so I remember. Sample card.`, { image: 'result-2.webp', alt: 'Example trade recap card', likes: 33 }],
  ['mp5', 19, 140, `Day 12 of journaling every session. Boring, but my notes are getting clearer. Thanks Gaurav for the template.`, { likes: 17 }],
  ['mp6', 6, 160, `Example: small, boring, by the plan. Checklist did the work. Sample card.`, { image: 'result-4.webp', alt: 'Example trade recap card', likes: 15 }],
  ['mp7', 11, 190, `Is there a way to slow replay down to 1 bar at a time? I want to practise reading each candle.`, { likes: 8 }],
  ['mp8', 23, 210, `My NQ layout this morning with the session marks on. Still learning what to ignore.`, { image: 'nq-chart.webp', alt: 'NQ chart shared by a member', likes: 12 }],
];
for (const [id, n, ageH, t, o] of MP) post(id, U(n).uid, U(n).name, ageH, t, o);

// comments
const CM = {
  welcome01: [[3, 'Excited to be here. Starting the course tonight.'], [9, 'Love the layout of this room. Where do I find the indicators?'], [OWNER, 'Open the Indicators tab and tap Add to my charts.'], [15, 'Joined from the YouTube channel. Thanks for building this.']],
  indhowto1: [[2, 'Session Sweep is a nice start. Clean and not cluttered.'], [12, 'Does Liquidity Master work on 1m?'], [OWNER, 'Yes, set the higher timeframes in the settings and keep the chart simple.'], [20, 'Added both. They show up under Community, as you said.']],
  sessions01: [[5, 'RSVP done. Will bring an NQ 15m chart.'], [7, 'Will the replay session be recorded?'], [OWNER, 'Not this one, it is a live practice session. Bring your questions.'], [22, 'Monday prep is the best part of my week.']],
  walkthru1: [[13, 'The GEX levels on the chart help me see where to look. Would add the prior day high.'], [16, 'Great walkthrough. How do you save the layout?'], [OWNER, 'Layout menu, Save layout. It also syncs to your other devices.'], [10, 'Saving this one for my template.'], [25, 'I added the session marks first, like you said. Much cleaner.']],
  question01: [[1, 'Replay. I never know where to start.'], [17, 'Reading the levels page. What each line means.'], [26, 'Layouts, I have too many saved.'], [OWNER, 'Great, replay and levels are on Monday.'], [30, 'Same as Priya, replay for me.']],
  results001: [[21, 'Great thread idea. Posting mine tonight.'], [27, 'Good to see the plan on the card.']],
  mp1: [[9, 'Nice and clean. What timeframe did you mark the gap on?'], [4, '5m, the gap was from the NY open.'], [OWNER, 'Good process. Writing the plan first is the habit that matters.'], [24, 'Love that you labeled it Example.']],
  mp2: [[OWNER, 'Keep one NY layout and only change it once a month. Less tinkering, more reading.'], [16, 'Same problem. I made one layout per session.'], [28, 'Thanks, the one-layout-per-month idea helps.']],
  mp3: [[2, 'Replay One is great for this. Did you use the speed control?'], [8, 'Yes, 1x on the entry, faster on the way.'], [29, 'Practising in replay changed my patience.']],
  mp4: [[OWNER, 'This is exactly the right way to treat a stopped trade: write it down, learn, move on.'], [12, 'The bias note is gold. Thanks for sharing.'], [30, 'Respect for posting the loss.'], [5, 'Journaling every one of these now.']],
  mp5: [[OWNER, 'Day 12, well done. Keep it short and honest.'], [20, 'Streak goals! Starting mine today.']],
  mp6: [[18, 'Boring is good.'], [3, 'Checklist habit is underrated.']],
  mp7: [[OWNER, 'Use the step button in the replay bar, it moves one bar at a time.'], [11, 'Found it, thank you!']],
  mp8: [[OWNER, 'Ignore most of it. Keep sessions and one level set.'], [31, 'Nice chart. Which sessions are marked?'], [23, 'Asia and London highs and lows.']],
};
const cmt = {}; let ci = 0;
for (const [pid, list] of Object.entries(CM)) {
  const base = P.includes(pid) ? out.find((o) => o.path === `${C}/posts/${pid}`).data.createdAt.ms : NOW;
  list.forEach(([who, text], k) => {
    const isO = who === OWNER, m = isO ? null : U(who);
    add(`${C}/comments/c${String(++ci).padStart(3, '0')}`, { postId: pid, authorUid: isO ? OWNER : m.uid, authorName: isO ? OWNER_NAME : m.name, text, createdAt: ts(Math.min(NOW - 600e3, base + (k + 1) * (35 + Math.floor(rnd() * 90)) * 60e3)), demo: true });
    cmt[pid] = (cmt[pid] || 0) + 1;
  });
}
for (const o of out) { const m = /posts\/([^/]+)$/.exec(o.path); if (m && cmt[m[1]]) o.data.commentCount = cmt[m[1]]; }

// events
const ev = (id, title, startUtc, mins, desc) => { add(`${C}/events/${id}`, { title, desc, startsAt: ts(Date.parse(startUtc)), durationMin: mins, link: 'https://tradezoro.com/charts', createdBy: OWNER, createdAt: ts(NOW - 6 * D), demo: true }); };
const PREP = 'Hosted by Gaurav. Online. We mark the week, walk the levels page and set one plan per chart. Bring one chart to talk through. Education only.';
const REPLAY = 'Hosted by Gaurav. Online. A practice session in Replay One: we step through a past session, mark the levels and talk about the decisions. Education only. Not financial advice.';
ev('prep-1102', 'Monday market prep', '2026-11-02T13:30:00Z', 45, '8:30 AM New York / 7:00 PM IST. ' + PREP);
ev('replay-1104', 'Replay One practice session', '2026-11-04T16:00:00Z', 60, '11:00 AM New York / 9:30 PM IST. ' + REPLAY);
ev('prep-1109', 'Monday market prep', '2026-11-09T13:30:00Z', 45, '8:30 AM New York / 7:00 PM IST. ' + PREP);
ev('replay-1111', 'Replay One practice session', '2026-11-11T16:00:00Z', 60, '11:00 AM New York / 9:30 PM IST. ' + REPLAY);
const rs = { 'prep-1102': 22, 'replay-1104': 17, 'prep-1109': 11, 'replay-1111': 8 };
for (const [id, n] of Object.entries(rs)) members.slice(0, n).forEach((m, i) => add(`${C}/events/${id}/rsvps/${m.uid}`, { uid: m.uid, name: m.name, createdAt: ts(NOW - (i + 2) * 5 * H), demo: true }));

// course (ids fixed so the cleanup/report can name them)
const CR = `${C}/courses/zorobasics`, M1 = 'basics';
add(CR, { ownerUid: OWNER, title: 'ZoroCharts Basics', desc: 'A short, practical tour of ZoroCharts: layouts, indicators, replay, the journal and the GEX levels page. Education only.', coverUrl: IMG + 'cover.webp', status: 'published', access: { mode: 'plans', planIds: ['p1'] }, solo: { mode: 'off', price: { amount: 0, currency: 'USD' } }, sequential: false, order: 0, rulesVersion: '1', createdAt: ts(NOW - 20 * D), updatedAt: ts(NOW), demo: true });
add(`${CR}/modules/${M1}`, { title: 'Getting started', order: 0, status: 'published', planIds: [], drip: { mode: 'none', days: 0, at: null }, updatedAt: ts(NOW) });
const L = [
 ['l1', 'Welcome and your first layout', 'text', 6, true, { mode: 'none' }, `<p>ZoroCharts opens on the Charts page. In this lesson you set up one clean layout and save it.</p><h3>Save a layout</h3><ul><li>Open the layout menu in the top bar.</li><li>Pick a symbol and timeframe, then choose Save layout.</li><li>Your layout syncs to your other devices.</li></ul><img src="${IMG}lesson-layout.webp" alt="The layout menu in ZoroCharts"><p>Tip: keep one layout for the New York session and only change it once in a while.</p><p><em>Education only. Not financial advice.</em></p>`, null],
 ['l2', 'Adding indicators to your chart', 'text', 8, false, { mode: 'none' }, `<p>Indicators mark the chart. They do not tell you what to trade.</p><h3>Add one</h3><ul><li>Open Indicators in the chart toolbar.</li><li>Search the list, or find the community ones under Community.</li><li>Open its settings to change colours and sessions.</li></ul><img src="${IMG}lesson-indicators.webp" alt="The Indicators window in ZoroCharts"><p>Start with one indicator. Add a second only when you know what the first one shows you.</p>`, { pass: 66, questions: [
   { q: 'What do indicators on ZoroCharts do?', opts: ['Mark the chart so you can read it', 'Tell you exactly what to buy', 'Place trades for you', 'Predict tomorrow'], ok: 0 },
   { q: 'Where do you add an indicator?', opts: ['The Indicators button in the chart toolbar', 'The Journal page', 'The GEX page', 'Account settings'], ok: 0 },
   { q: 'How many indicators should you start with?', opts: ['One', 'All of them', 'None, ever', 'Twenty'], ok: 0 }] }],
 ['l3', 'Replay: practise on past sessions', 'text', 8, false, { mode: 'none' }, `<p>Replay lets you step through a past session as if it were happening now. It is the safest way to practise reading a chart.</p><h3>Start a replay</h3><ul><li>Choose Replay in the chart toolbar and pick a start point.</li><li>Play, pause or step one bar at a time.</li><li>Place your marks and write what you would do.</li></ul><img src="${IMG}lesson-replay.webp" alt="The Replay bar in ZoroCharts"><p>Practice data only. It is a way to learn, not a forecast.</p>`, null],
 ['l4', 'The journal: write the plan first', 'text', 6, false, { mode: 'days', days: 3 }, `<p>The Journal is where a session becomes a lesson. Write the plan before the open and a short note after.</p><h3>A simple entry</h3><ul><li>Bias and the levels you care about.</li><li>What you will wait for.</li><li>One line after: what went by the plan, what did not.</li></ul><p>Keep it short and honest. A streak of short notes beats one long essay.</p><p>This lesson opens 3 days after you join, so you have time to finish the first ones.</p>`, null],
 ['l5', 'The GEX levels page', 'text', 7, false, { mode: 'none' }, `<p>The GEX page shows option-based levels for index futures, laid out as a chart you can read at a glance.</p><img src="${IMG}lesson-gex.webp" alt="The GEX levels page"><h3>How to use it</h3><ul><li>Read the levels as a map of places price may react.</li><li>Copy the ones you care about onto your chart layout.</li><li>Check the date shown on the page before you use a level.</li></ul><p>It is context, not a signal. Education only. Not financial advice.</p>`, null],
 ['l6', 'Cheat sheet (PDF)', 'pdf', 3, false, { mode: 'none' }, '', null],
];
L.forEach((x, i) => {
  const [id, title, type, mins, prev, drip, html, quiz] = x;
  add(`${CR}/lessons/${id}`, { moduleId: M1, title, type, order: i, status: 'published', preview: prev, drip: Object.assign({ days: 0, at: null }, drip), prev: '', mins, thumb: '', hasQuiz: !!quiz, updatedAt: ts(NOW) });
  if (type !== 'pdf') add(`${CR}/lessons/${id}/content/body`, Object.assign({ type, attachments: [], html, updatedAt: ts(NOW) }, quiz ? { quiz } : {}));
});
// progress so the course page looks used (members only)
members.forEach((m, i) => { if (i % 4 === 3) return; const n = 1 + (i % 5), done = {}; ['l1', 'l2', 'l3', 'l4', 'l5'].slice(0, n).forEach((l, k) => { done[l] = NOW - (k + 1) * D; });
  const d = { uid: m.uid, done, pos: {}, last: 'l' + n, updatedAt: ts(NOW - (i % 6) * D), demo: true };
  if (n >= 2) d.quiz = { l2: { best: [66, 100, 100, 66][i % 4], passed: true, tries: 1 + (i % 2) } };
  add(`${CR}/progress/${m.uid}`, d); });
add(`${C}/stats/storage`, { bytes: 0, updatedAt: ts(NOW) });

console.log('docs:', out.length, 'slug:', slug, 'members:', members.length, 'comments:', ci, 'posts:', P.length);
if (!APPLY) { console.log('dry run (add --apply)'); process.exit(0); }
await setDocs(out);
const meta = await getDoc('creatorMeta/' + OWNER);
await mergeDoc('creatorMeta/' + OWNER, { count: ((meta && meta.count) || 0) + 1, cid: slug, updatedAt: ts(NOW) });
console.log('written. slug =', slug);
