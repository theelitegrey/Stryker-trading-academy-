#!/usr/bin/env node
// Seeds / resets the internal demo (marketing) trader account through the app's own Firestore paths and shapes.
//   node seed.mjs --dry-run           print what would be written (no network writes)
//   node seed.mjs --create            first run: create the Auth user + demo-flagged student doc, store credentials, seed
//   node seed.mjs --reset             wipe ONLY this uid's seeded data and re-seed it (deterministic)
//   node seed.mjs --touch             refresh lastActiveDate/streak only (the app resets a streak that is a day stale)
//   node seed.mjs --avatar file.png   apply a profile picture (240px JPEG data URL, exactly what Settings stores)
// Safety: refuses to run unless students/{uid}.demo === true (the only exception is the very first --create).
// Credentials live in a 0600 file outside the repo: $DEMO_CREDENTIALS (default
// /root/.hermes/profiles/chief-of-staff/secure/demo-account/credentials). Nothing secret is printed or committed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as G from './lib/gcp.mjs';
import { repoRoot } from './lib/appcode.mjs';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const argVal = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const DRY = args.has('--dry-run');
const CRED = process.env.DEMO_CREDENTIALS || '/root/.hermes/profiles/chief-of-staff/secure/demo-account/credentials';
const EMAIL = process.env.DEMO_EMAIL || 'theelitegrey+richard-demo@gmail.com';
const NAME = 'Richard Hale', USERNAME = 'richard_hale';
const BIO = 'Chicago futures trader, 3 years in. NQ/ES and the micros. Mostly NY AM, ICT concepts: sweeps, IFVG, MSS. Journaling everything, trying to stay boring.';
const DAY = 86400000, NOW = Date.now();
const J = (f) => JSON.parse(fs.readFileSync(path.join(HERE, 'data', f), 'utf8'));
const has = (f) => fs.existsSync(path.join(HERE, 'data', f));

function readCreds() {
  if (!fs.existsSync(CRED)) return {};
  return Object.fromEntries(fs.readFileSync(CRED, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
}
function writeCreds(o) {
  fs.mkdirSync(path.dirname(CRED), { recursive: true, mode: 0o700 });
  fs.writeFileSync(CRED, Object.entries(o).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  fs.chmodSync(CRED, 0o600);
}

// the app's own badge rules -> ids already "notified" so no toast storm on first load
function earnedBadges(student, chapters, extra) {
  const ctx = { console };
  vm.runInNewContext(fs.readFileSync(path.join(repoRoot, 'assets/achievements-data.js'), 'utf8') + ';this.ACH=ACHIEVEMENTS;', ctx);
  return ctx.ACH.filter((a) => { try { return a.check(student, chapters, extra); } catch { return false; } });
}
function chaptersSeed() {
  const t = fs.readFileSync(path.join(repoRoot, 'assets/chapters-index.js'), 'utf8');
  const ctx = {}; vm.runInNewContext(t + ';this.C=CHAPTERS_SEED;', ctx); return ctx.C;
}

function build(uid) {
  const W = [];                          // {path, data}
  const S = `students/${uid}`;
  const chapters = chaptersSeed();
  const core = chapters.filter((c) => /^\d+$/.test(c.num));
  const completedChapters = core.filter((c) => +c.num <= 17).map((c) => c.num);
  const completedLessons = [];
  for (const c of core) {
    const done = +c.num <= 17 ? c.lessons.length : (+c.num === 18 ? 4 : +c.num === 19 ? 2 : 0);
    for (let i = 0; i < done; i++) completedLessons.push(`${c.num}-${i}`);
  }
  const jr = J('journal.json'), trades = jr.trades;
  const created = Date.parse('2026-06-18T13:20:00Z');
  const student = {
    displayName: NAME, email: EMAIL, username: USERNAME, bio: BIO, plan: 'Pro', theme: 'night',
    createdAt: G.ts(created), lastActiveDate: new Date(NOW).toISOString().slice(0, 10), currentStreak: 23, bestStreak: 41,
    completedLessons, completedChapters, mentionNotifications: true,
    journalEntryCount: trades.length, hasWinningTrade: true,
    onboarding: { seen: true, completedAt: G.ts(created + 600000) },
    tour: { done: true, skipped: false, snoozedUntil: 0, step: 0, seen: true },
    demo: true, marketing: true
  };
  if (!args.has('--avatar-only')) student.avatarSeed = 'richard-hale-trader';
  const earned = earnedBadges({ completedChapters, completedLessons, bestStreak: 41, bio: BIO, avatarSeed: student.avatarSeed, customPhotoURL: null, plan: 'Pro', referralPoints: 0, tradingViewAccessGranted: false },
    core, { postCount: 0, replyCount: 0, likesReceived: 0, journalCount: trades.length, hasWinningTrade: true });
  student.notifiedAchievements = earned.map((a) => a.id);
  W.push({ path: S, data: student });
  W.push({ path: `profiles/${uid}`, data: { displayName: NAME, username: USERNAME, bio: BIO, avatarSeed: student.avatarSeed, createdAt: student.createdAt, currentStreak: 23, bestStreak: 41, plan: 'Pro', completedChaptersCount: completedChapters.length, completedLessonsCount: completedLessons.length, mentionNotifications: true,
    // every field the Achievements page syncs, so its write is not a privileged-key 'change' under the rules
    floorPostCount: 0, floorReplyCount: 0, floorLikesReceived: 0, referralPoints: 0, tradingViewAccessGranted: false } });
  W.push({ path: `usernames/${USERNAME}`, data: { uid, username: USERNAME } });

  // journal: trades in exactly the shape saveTrade() writes
  const settings = { instruments: ['NQ', 'MNQ', 'ES', 'MES'], setups: ['ICT 2022', 'Liquidity Sweep', 'IFVG', 'FVG', 'ORB', 'MSS', 'Silver Bullet', 'Order Block'],
    sessions: ['London', 'New York AM', 'New York PM', 'London/NY Overlap'], tags: ['A+ setup', 'Revenge trade', 'FOMO', 'Plan followed', 'Plan broken'],
    defaultRiskPercent: 1, accountBalance: jr.account, currency: 'USD', configuredAt: G.ts(created + 900000) };
  W.push({ path: `${S}/journal/_settings`, data: settings });
  W.push({ path: `${S}/journal/_playbooks`, data: { playbooks: J('playbooks.json'), updatedAt: G.ts(NOW - 3 * DAY) } });
  trades.forEach((t, i) => {
    const [hh, mm] = t.time.split(':').map(Number);
    const at = Date.parse(t.date + 'T00:00:00Z') + (hh * 60 + mm) * 60000 + 5 * 3600000 + 3600000;  // ~ entry day, for ordering of createdAt only
    W.push({ path: `${S}/journal/t${String(i + 1).padStart(3, '0')}${crypto.createHash('sha1').update(t.date + t.time + t.instrument).digest('hex').slice(0, 14)}`,
      data: Object.assign({}, t, { createdAt: G.ts(at + 7200000), updatedAt: G.ts(at + 7200000) }) });
  });
  // backtests (replay cloud copies)
  for (const b of J('backtests.json')) {
    const { id, ...rest } = b;
    W.push({ path: `${S}/replay/${id}`, data: Object.assign({}, rest, { trades: rest.trades.slice(-300).map((t) => Object.assign({}, t, { notes: (t.notes || '').slice(0, 500) })) }) });
  }
  // paper trading
  if (has('paper-state.json')) {
    W.push({ path: `${S}/paperTrading/account`, data: { state: JSON.stringify(J('paper-state.json')), updatedAt: G.ts(NOW - 2 * 3600000) } });
    W.push({ path: `${S}/paperTrading/public`, data: { optIn: false, displayName: 'Richard H', updatedAt: G.ts(NOW - 2 * 3600000) } });
  }
  // charts: alerts / watchlists / intervals are written here; layouts, templates, favourites and the favourites bar come from
  // data/charts.json (captured from the real Charts page as this account, so the Vela state is the app's own output).
  const lv = has('levels.json') ? J('levels.json') : { NQ: { last: 29900 }, ES: { last: 7745 } };
  const r25 = (n) => Math.round(n * 4) / 4;
  const alerts = [['futures:NQ1!', 'crossing_up', r25(lv.NQ.last + 160), 'NQ back above the overnight high', 'once'], ['futures:NQ1!', 'crossing_down', r25(lv.NQ.last - 140), 'NQ losing the prior day low', 'once'],
    ['futures:NQ1!', 'greater', r25(lv.NQ.last + 420), 'NQ extension target', 'once'], ['futures:ES1!', 'crossing_up', r25(lv.ES.last + 28), 'ES reclaim of the 8:00 high', 'once'],
    ['futures:ES1!', 'crossing_down', r25(lv.ES.last - 22), 'ES sweep of the London low', 'every'], ['futures:MNQ1!', 'less', r25(lv.NQ.last - 330), 'MNQ stop-run zone', 'once']];
  alerts.forEach(([symbol, cond, price, message, freq], i) => W.push({ path: `${S}/chartAlerts/al${String(i + 1).padStart(2, '0')}${crypto.createHash('sha1').update(message).digest('hex').slice(0, 12)}`,
    data: { symbol, cond, price, message, freq, active: i !== 5, createdAt: G.ts(NOW - (9 - i) * DAY), updatedAt: G.ts(NOW - (9 - i) * DAY) } }));
  const wl = [['Index futures', ['###INDEX', 'futures:NQ1!', 'futures:ES1!', 'futures:MNQ1!', 'futures:MES1!', 'futures:YM1!', 'futures:RTY1!']],
    ['Macro and metals', ['###METALS', 'futures:GC1!', 'futures:SI1!', '###ENERGY', 'futures:CL1!', '###FOREX', 'fx:EURUSD', 'fx:GBPUSD', 'fx:USDJPY']],
    ['Crypto watch', ['binance:BTCUSDT', 'binance:ETHUSDT', 'binance:SOLUSDT']]];
  wl.forEach(([name, items], i) => W.push({ path: `${S}/watchlists/wl${crypto.createHash('sha1').update(name).digest('hex').slice(0, 24)}`,
    data: { name, items, collapsed: [], view: { table: true, last: true, chg: true, chgp: true, vol: false, ext: false, logo: true, disp: 'symbol' }, shared: false, updatedAt: G.ts(NOW - (5 - i) * DAY) } }));
  W.push({ path: `${S}/chartPrefs/intervals`, data: { favs: ['1', '3', '5', '15', '60', 'D'], custom: [], collapsed: [], updatedAt: G.ts(NOW - 6 * DAY) } });
  if (has('charts.json')) {
    const C = J('charts.json');
    (C.layouts || []).forEach((l) => W.push({ path: `${S}/chartLayouts/${l.id}`, data: { name: l.name, state: l.state, symbol: l.symbol, interval: l.interval, shared: false, updatedAt: G.ts(NOW - (l.ageDays || 3) * DAY) } }));
    (C.templates || []).forEach((t) => W.push({ path: `${S}/chartTemplates/${t.id}`, data: { name: t.name, state: t.state, isDefault: !!t.isDefault, createdAt: G.ts(NOW - (t.ageDays || 20) * DAY), updatedAt: G.ts(NOW - (t.ageDays || 20) * DAY) } }));
    (C.favorites || []).forEach((f) => W.push({ path: `${S}/chartFavorites/${f.id}`, data: { key: f.key, name: f.name, at: G.ts(NOW - 25 * DAY) } }));
    if (C.favToolbar) W.push({ path: `${S}/chartPrefs/favToolbar`, data: Object.assign({ visible: true, updatedAt: G.ts(NOW - 12 * DAY) }, C.favToolbar) });
  }
  // notifications (the kind the app raises itself for badges)
  const notifTitles = earned.slice(-6);
  notifTitles.forEach((a, i) => W.push({ path: `notifications/demo${uid.slice(0, 6)}${String(i).padStart(2, '0')}${crypto.createHash('sha1').update(a.id).digest('hex').slice(0, 10)}`,
    data: { recipientUid: uid, type: 'achievement', message: 'Achievement unlocked: ' + a.title, link: 'achievements.html', read: i < notifTitles.length - 2, createdAt: G.ts(NOW - (6 - i) * 2 * DAY) } }));
  return W;
}

const SUBCOLLS = ['journal', 'replay', 'paperTrading', 'chartLayouts', 'chartTemplates', 'chartFavorites', 'chartPrefs', 'chartAlerts', 'watchlists', 'bookmarks'];

async function avatarDataUrl(file) {
  const tmp = path.join(process.env.TMPDIR || '/tmp', `richard-avatar-${process.pid}.jpg`);
  execFileSync('python3', ['-c', 'import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert("RGB");w,h=im.size;s=min(w,h);im=im.crop(((w-s)//2,(h-s)//2,(w-s)//2+s,(h-s)//2+s)).resize((240,240),Image.LANCZOS);im.save(sys.argv[2],"JPEG",quality=88)', file, tmp]);
  const b = fs.readFileSync(tmp); fs.unlinkSync(tmp);
  return 'data:image/jpeg;base64,' + b.toString('base64');
}

async function main() {
  let creds = readCreds();
  let uid = creds.uid;
  if (args.has('--create') && !uid && !DRY) {
    let u = await G.authLookupByEmail(EMAIL);
    if (u) { console.log('Auth user already exists for the demo email; adopting it.'); uid = u.localId; }
    else {
      const password = crypto.randomBytes(18).toString('base64url') + 'aA1!';
      u = await G.authCreate({ email: EMAIL, password, displayName: NAME });
      uid = u.localId; creds = { email: EMAIL, password, uid }; writeCreds(creds);
      console.log('Auth user created; credentials stored in the 0600 file (not printed).');
    }
    if (!creds.password) { console.error('Existing Auth user but no credentials file; set a password via the Firebase console/reset mail and add it to the file.'); }
    creds.uid = uid; creds.email = EMAIL; writeCreds(creds);
    // first-run bootstrap: create the demo-flagged doc (guard below then holds for every later run)
    await G.mergeDoc(`students/${uid}`, { demo: true, marketing: true, displayName: NAME, email: EMAIL, plan: 'Pro' });
  }
  if (!uid) {
    if (DRY) { uid = 'DRYRUNUID0000000000000000000'; }
    else { console.error('No uid: run once with --create (credentials file missing: ' + CRED + ')'); process.exit(2); }
  }
  if (!DRY) {
    const cur = await G.getDoc(`students/${uid}`);
    if (!cur || cur.demo !== true) { console.error('REFUSING: students/' + uid + ' is not flagged demo == true.'); process.exit(3); }
  }
  if (args.has('--avatar')) {
    const f = argVal('--avatar'); const url = await avatarDataUrl(f);
    if (DRY) { console.log('would set customPhotoURL (' + url.length + ' chars) on students + profiles'); return; }
    await G.mergeDoc(`students/${uid}`, { customPhotoURL: url }); await G.mergeDoc(`profiles/${uid}`, { customPhotoURL: url });
    console.log('avatar applied'); return;
  }
  if (args.has('--touch')) {
    const d = new Date(NOW).toISOString().slice(0, 10);
    if (!DRY) { await G.mergeDoc(`students/${uid}`, { lastActiveDate: d, currentStreak: 23 }); await G.mergeDoc(`profiles/${uid}`, { currentStreak: 23 }); }
    console.log(DRY ? 'would touch' : 'streak refreshed for ' + d); return;
  }
  const W = build(uid);
  if (!DRY) {   // keep a custom avatar across re-seeds
    const cur = await G.getDoc(`students/${uid}`);
    if (cur && cur.customPhotoURL) { W[0].data.customPhotoURL = cur.customPhotoURL; delete W[0].data.avatarSeed; W[1].data.customPhotoURL = cur.customPhotoURL; delete W[1].data.avatarSeed; }
  }
  if (args.has('--paths')) { for (const w of W) console.log(w.path.replace(uid, '{uid}').replace(/\/(journal|chartAlerts|watchlists|replay|chartLayouts|chartTemplates|chartFavorites)\/[^/]+$/, '/$1/*').replace(/^notifications\/.*/, 'notifications/* (recipientUid={uid})')); return; }
  const byTop = {}; for (const w of W) { const k = w.path.split('/').slice(w.path.startsWith('students/') ? 2 : 0, w.path.startsWith('students/') ? 3 : 1)[0]; byTop[k] = (byTop[k] || 0) + 1; }
  console.log('documents to write:', W.length, JSON.stringify(byTop));
  if (DRY) { for (const w of W.slice(0, 4)) console.log(' e.g.', w.path.replace(uid, '<uid>')); return; }
  if (args.has('--reset')) {
    const del = [];
    for (const c of SUBCOLLS) del.push(...await G.listPaths(`students/${uid}/${c}`));
    del.push(...await G.queryEq('notifications', 'recipientUid', uid));
    console.log('reset: deleting', del.length, 'documents under this uid only');
    for (const p of del) if (!p.includes(uid) && !p.startsWith('notifications/')) throw new Error('refusing to delete outside the demo uid: ' + p);
    await G.deleteDocs(del);
  }
  await G.setDocs(W);
  // restore anything a full-replace of the student doc would drop: avatar
  const stu = await G.getDoc(`students/${uid}`);
  console.log('seeded. journal entries:', stu.journalEntryCount, 'plan:', stu.plan);
}
main().catch((e) => { console.error('seed failed:', e.message); process.exit(1); });
