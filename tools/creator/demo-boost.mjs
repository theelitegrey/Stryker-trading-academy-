// Adds believable activity to the DEMO community (Owner order 2026-10-30): more member posts and comments so the
// leaderboard (2 pts per post, 1 per comment, last 30 days) reads like a living room. Everything is demo:true, so
// demo-cleanup.js removes it with the rest. No results, no claims. Usage: node demo-boost.mjs [--apply]
import { getDoc, setDocs, listPaths, ts, mergeDoc } from '../demo-account/lib/gcp.mjs';
const APPLY = process.argv.includes('--apply');
const OWNER = '0hC8vmnsh0O2CkyWiyw9X1kn1XL2', OWNER_NAME = 'Gaurav Singh';
const C = 'communities/tradezoro';
const NOW = Date.now(), H = 3600e3;
const rnd = (() => { let s = 7731; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
if ((await getDoc(C)).demo !== true) { console.log('not a demo community'); process.exit(1); }
if (await getDoc(C + '/posts/np1')) { console.log('already boosted'); process.exit(0); }

// current state
const posts = {}, pts = {}, nameOf = {};
for (const p of await listPaths(C + '/posts')) { const d = await getDoc(p); posts[p.split('/').pop()] = { author: d.authorUid, at: d.createdAt.ms, cc: d.commentCount || 0, text: d.text }; }
for (const p of await listPaths(C + '/members')) { const d = await getDoc(p); if (d.uid !== OWNER) { nameOf[d.uid] = d.displayName; pts[d.uid] = 0; } }
for (const id in posts) if (pts[posts[id].author] !== undefined) pts[posts[id].author] += 2;
const existingCm = await listPaths(C + '/comments');
for (const p of existingCm) { const d = await getDoc(p); if (pts[d.authorUid] !== undefined) pts[d.authorUid] += 1; }

// targets: top ten 6-20, the rest 2-5
const TOP = [20, 18, 16, 15, 13, 12, 10, 9, 7, 6], REST = [5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 2, 3, 3, 4, 3, 2, 3, 3];
const order = Object.keys(pts).sort((a, b) => pts[b] - pts[a] || (a < b ? -1 : 1));
const tgt = {}; order.forEach((u, i) => { tgt[u] = Math.max(pts[u], i < 10 ? TOP[i] : REST[i - 10]); });

// new posts (authors: ten members spread across the board)
const NP = [
  ['np1', 'Does anyone else mark the Asia range first, before looking at anything else? Trying to turn it into a habit.', 6],
  ['np2', 'Finished the replay lesson. Stepping one bar at a time felt slow at first, but I notice a lot more now.', 9],
  ['np3', 'Weekly check-in: my only goal this week is to write the plan before every session. How is everyone\'s week going?', 14],
  ['np4', 'Tip for new members: save one layout for New York and one for London, then stop touching them.', 30],
  ['np5', 'Added Liquidity Master to my 5m chart. The sessions are easy to read. Any settings you would start with?', 44],
  ['np6', 'Small accountability thread: post one process goal for the week. No results needed, just the habit you want to build.', 62],
  ['np7', 'Question on the GEX page: do you check the date shown before using a level? I keep forgetting.', 83],
  ['np8', 'Finished the ZoroCharts Basics quiz on the first try. The indicators lesson cleared up a lot for me.', 105],
];
const authors = order.slice(0, 10).filter((_, i) => i !== 9 && i !== 8).concat([order[10], order[12]]).slice(0, 8);
const out = [];
const add = (path, data) => out.push({ path, data });
const newPts = {};
NP.forEach(([id, text, ageH], i) => {
  const u = authors[i]; newPts[u] = (newPts[u] || 0) + 2;
  posts[id] = { author: u, at: NOW - ageH * H, cc: 0, text };
  add(`${C}/posts/${id}`, { authorUid: u, authorName: nameOf[u], text, pinned: false, createdAt: ts(NOW - ageH * H), demo: true, likeCount: 4 + Math.floor(rnd() * 14), commentCount: 0 });
});

// comment lines per post (specific to the post, so no copy-paste feel)
const L = {
  welcome01: ['Just joined. Which lesson should I start with?', 'The pinned post helped. Thanks for making this free.', 'Starting the course this week, will share how it goes.', 'Glad the labels say Example. Honest room.'],
  indhowto1: ['Worked on my NQ 5m chart right away.', 'The one-idea-per-chart rule is good advice.', 'Do the indicators keep their settings between sessions?', 'I turned off everything except sessions first. Cleaner.'],
  sessions01: ['Will there be a recording of Monday prep?', 'Set a reminder for both sessions.', 'Bringing a 1h chart this time.', 'First time joining live, a bit nervous but looking forward.', 'The time in IST is handy, thanks.'],
  walkthru1: ['What do you do when two levels sit close together?', 'The order matters: sessions first, then levels. Noted.', 'Copied the layout idea to my 5m chart.', 'Good reminder to ask where price reacted last time.', 'Would love a part two on the 1m version.'],
  question01: ['Adding my vote for replay.', 'Reading levels for me too.', 'Layouts. I never know what to keep.', 'Replay, so I can practise without pressure.', 'Seconding the levels page.'],
  results001: ['Plan on the card is the best part of this thread.', 'Will post a sample tonight, labeled Example.', 'Nice that nobody here posts a number without the plan.'],
  mp1: ['The retest note is useful. I skip that step too often.', 'Which session was the Asia low from?', 'Plan first, trade second. Good reminder.', 'Clean card, easy to follow.'],
  mp2: ['Monthly changes only is a good rule. Doing it.', 'I use a London layout and a New York layout, nothing else.', 'I keep a screenshot of the layout I like so I stop changing it.', 'This was my problem for months.'],
  mp3: ['Does the speed control keep your last setting?', 'Replay changed how I read candles too.', 'Good use of Replay One. Marking levels at 9:00 is smart.'],
  mp4: ['Higher timeframe bias is where I slip as well.', 'Thanks for sharing the lesson part, not only the entry.', 'Journal entry on this one must have been a good read.', 'Posting the stopped trade takes guts.'],
  mp5: ['Day 12 is further than I got. Respect.', 'Could you share the template headings?', 'The streak counter keeps me honest too.', 'Short notes beat long ones, agreed.'],
  mp6: ['Checklist first, then chart. Same here.', 'Boring plans are the good ones.', 'Which items are on your checklist?'],
  mp7: ['Step button is in the replay bar, it moves one bar.', 'I do this for 10 minutes before each session.', 'Good question, I was wondering the same.'],
  mp8: ['Which levels did you keep on?', 'Learning what to ignore is the hard part.', 'Sessions plus one level set sounds right.', 'The marks are tidy.'],
  np1: ['Yes, Asia range first for me too.', 'I add London after Asia, then stop.', 'Habit takes about two weeks to feel natural.', 'Do you mark the high and low or the whole box?', 'Doing this tomorrow.', 'It makes the chart easier to read.'],
  np2: ['Slow at first, then you start to see the candles.', 'I do ten bars at a time, then step back.', 'Did you write notes while stepping?', 'Same experience. Patience builds up.', 'Replay One is a good place to start.', 'Try pausing at each session open.'],
  np3: ['Week is going fine, plan written three days in a row.', 'Same goal here. Two of three done.', 'Missed Tuesday, back on it today.', 'Thanks for starting this check-in.', 'Plan first has made my mornings calmer.', 'Slow week, but I stuck to the habit.'],
  np4: ['Saved two layouts, already less tinkering.', 'Good tip. Naming them NY and LDN helps.', 'Thanks, new here and this saves me time.', 'Synced to my laptop too.', 'The layout menu is easy to miss, thanks.', 'I would add one for Asia.'],
  np5: ['I started with sessions only and left the rest off.', 'Keep the colours muted, it helps on small screens.', 'Try the 15m first, then the 5m.', 'Higher timeframes in settings, as Gaurav said.', 'Also curious about the settings.', 'Shows up under Community in my list.'],
  np6: ['My goal: no new indicators this week.', 'Mine: journal every session.', 'Write the plan before the open, every day.', 'Mine: one layout, no changes.', 'Replay for 20 minutes a day.', 'Mine: wait for the session open before marking.'],
  np7: ['I check the date on the page first, every time.', 'Make it part of the checklist.', 'The date is shown at the top, easy to miss.', 'Yes, I note it in the journal.', 'Good point, I forgot too.', 'Level is only useful if it is current.'],
  np8: ['Congrats! Which question was the hardest?', 'I took it twice. Second time was better.', 'The indicators lesson is my favourite too.', 'Heading to that lesson now.', 'Nice, the quiz is a good check.', 'The screenshots in that lesson help.'],
};
const GEN = ['Thanks for sharing this.', 'Good point.', 'Saving this for later.', 'Same here.', 'This helps, thank you.', 'Agree with this.', 'Nice and simple.', 'Bookmarked.', 'Great thread.', 'Needed to read this today.', 'Learning a lot from this room.', 'Appreciate the honest take.', 'Makes sense, will try it.', 'Good reminder.', 'Following this one.', 'Thanks Gaurav for running this room.', 'Clear and useful.', 'Trying this tomorrow.', 'Well said.', 'This is what I needed.', 'Simple but it works.', 'Good stuff.', 'Going to use this.', 'Love the process focus here.', 'Good discussion.', 'Thanks, that clears it up.', 'Noted.', 'Useful, thanks.', 'Keeping it simple, agreed.', 'Glad I joined.'];
const genq = shuffle(GEN);
for (const k in L) L[k] = shuffle(L[k]);

// work out comments needed per member
const need = {}; let total = 0;
for (const u of order) { need[u] = Math.max(0, tgt[u] - pts[u] - (newPts[u] || 0)); total += need[u]; }
const pending = order.flatMap((u) => Array(need[u]).fill(u));
const slots = (u, pid) => posts[pid].author !== u && ((L[pid] && L[pid].length > 0) || genq.length > 0);
const used = {};   // member -> post -> true (max one comment per post per member, like a real thread)
const owner = { c: 0 };
let n = 0; const addedBy = {}, cmCount = {};
const times = {};
for (const u of shuffle(pending)) {
  const cand = shuffle(Object.keys(posts)).filter((pid) => slots(u, pid) && !(used[u] && used[u][pid]));
  if (!cand.length) { console.log('no slot for', nameOf[u]); continue; }
  const pid = cand.sort((a, b) => (cmCount[a] || 0) - (cmCount[b] || 0))[0];
  used[u] = used[u] || {}; used[u][pid] = true;
  const text = (L[pid] && L[pid].length) ? L[pid].shift() : genq.shift();
  cmCount[pid] = (cmCount[pid] || 0) + 1;
  const base = Math.max(posts[pid].at, times[pid] || 0);
  const at = Math.min(NOW - 15 * 60e3, base + (25 + Math.floor(rnd() * 120)) * 60e3);
  times[pid] = at;
  add(`${C}/comments/d${String(++n).padStart(3, '0')}`, { postId: pid, authorUid: u, authorName: nameOf[u], text, createdAt: ts(at), demo: true });
  addedBy[u] = (addedBy[u] || 0) + 1;
}
// a few Gaurav replies on the new threads (he is the host)
for (const [pid, text] of [['np3', 'Good habit to build. Keep the notes short.'], ['np5', 'Start with the default settings and add the higher timeframes later.'], ['np7', 'Always check the date. A level is only useful when it is current.']]) {
  const at = Math.min(NOW - 15 * 60e3, (times[pid] || posts[pid].at) + 40 * 60e3); times[pid] = at;
  add(`${C}/comments/d${String(++n).padStart(3, '0')}`, { postId: pid, authorUid: OWNER, authorName: OWNER_NAME, text, createdAt: ts(at), demo: true });
  cmCount[pid] = (cmCount[pid] || 0) + 1;
}
// bump commentCount on posts
const ccData = {};
for (const pid in cmCount) ccData[pid] = (posts[pid].cc || 0) + cmCount[pid];
const final = Object.keys(pts).map((u) => [nameOf[u], pts[u] + (newPts[u] || 0) + (addedBy[u] || 0)]).sort((a, b) => b[1] - a[1]);
console.log('new posts', NP.length, 'new comments', n, '| top 12:', final.slice(0, 12).map((x) => x.join(' ')).join(', '), '| lowest', final[final.length - 1].join(' '));
if (!APPLY) { console.log('dry run (add --apply)'); process.exit(0); }
await setDocs(out);
for (const pid in ccData) await mergeDoc(`${C}/posts/${pid}`, { commentCount: ccData[pid] });
console.log('written');
