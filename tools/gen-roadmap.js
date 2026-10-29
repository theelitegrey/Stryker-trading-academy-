#!/usr/bin/env node
// TradeZoro — roadmap log generator
//
// Writes assets/roadmap-log.json: the "Shipped" list and build log on the
// Roadmap page and the dashboard strip. Newest first:
//   [{ build, date (IST, YYYY-MM-DD), title, link }]
//
// Sources
//   1. git log (first-parent, main) — every commit whose message carries a
//      trailer line   Roadmap: <short plain-English title>
//      and optionally  Roadmap-Link: <page>
//      Build number = the assets/version.json build of that commit, or of the
//      nearest later bump (so a feature commit followed by "bump" gets the
//      bump's number). Not bumped yet -> the current build.
//   2. tools/roadmap-backfill.json — one-off entries for work shipped before
//      the trailer rule existed. Same fields as above.
//
// Usage
//   node tools/gen-roadmap.js           write assets/roadmap-log.json
//   node tools/gen-roadmap.js --check   exit 1 if the committed file differs
//                                       from what the git log produces
//                                       (build numbers are ignored: a later
//                                       bump changes them; the deploy always
//                                       rewrites the file before publish)
//
// Run by the deploy workflow before publish, and by tools/check.py.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'roadmap-log.json');
const BACKFILL = path.join(__dirname, 'roadmap-backfill.json');

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function istDate(epochSeconds) {
  return new Date((Number(epochSeconds) + 5.5 * 3600) * 1000).toISOString().slice(0, 10);
}

// Ordered (oldest first) list of [sha, build] for every first-parent commit
// that changed assets/version.json.
function bumps() {
  const out = git(['log', '--first-parent', '--reverse', '-U0', '-p', '--format=COMMIT:%H', '--', 'assets/version.json']);
  const list = [];
  let sha = null;
  out.split('\n').forEach((line) => {
    if (line.startsWith('COMMIT:')) { sha = line.slice(7); return; }
    const m = line.match(/^\+.*"build"\s*:\s*(\d+)/);
    if (m && sha) list.push([sha, Number(m[1])]);
  });
  return list;
}

function currentBuild() {
  try { return Number(JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'version.json'), 'utf8')).build) || 0; } catch (e) { return 0; }
}

// Each commit -> build (position-based, over the same first-parent list).
function trailerEntries() {
  const SEP = '\x1e', F = '\x1f';
  const raw = git(['log', '--first-parent', '--reverse', '--format=%H' + F + '%at' + F + '%B' + SEP]);
  const commits = raw.split(SEP).map((s) => s.replace(/^\n+/, '')).filter(Boolean).map((rec) => {
    const [sha, at, body] = rec.split(F);
    return { sha, at, body: body || '' };
  });
  const bumpAt = new Map(bumps());
  const cur = currentBuild();
  // walk newest -> oldest remembering the build of the nearest bump at/after
  let next = cur;
  const buildOf = new Map();
  for (let i = commits.length - 1; i >= 0; i--) {
    if (bumpAt.has(commits[i].sha)) next = bumpAt.get(commits[i].sha);
    buildOf.set(commits[i].sha, next);
  }
  const entries = [];
  commits.forEach((c) => {
    const t = c.body.match(/^Roadmap:[ \t]*(.+?)[ \t]*$/m);
    if (!t) return;
    const l = c.body.match(/^Roadmap-Link:[ \t]*(.+?)[ \t]*$/m);
    entries.push({ build: buildOf.get(c.sha), date: istDate(c.at), title: t[1], link: l ? l[1] : '' });
  });
  return entries;
}

function backfillEntries() {
  try { return JSON.parse(fs.readFileSync(BACKFILL, 'utf8')); } catch (e) { return []; }
}

function build() {
  const all = backfillEntries().concat(trailerEntries()).map((e) => ({
    build: Number(e.build) || 0, date: e.date, title: String(e.title), link: e.link || ''
  }));
  const seen = new Set();
  const uniq = all.filter((e) => { const k = e.build + '|' + e.title; if (seen.has(k)) return false; seen.add(k); return true; });
  uniq.sort((a, b) => b.date.localeCompare(a.date) || b.build - a.build || a.title.localeCompare(b.title));
  // Same title shipped across several builds (a feature plus its follow-up
  // pushes): keep only the newest, so the Shipped list has no repeats.
  const titles = new Set();
  return uniq.filter((e) => { const k = e.title.toLowerCase(); if (titles.has(k)) return false; titles.add(k); return true; });
}

const key = (e) => e.date + '|' + e.title + '|' + e.link;

function main() {
  const check = process.argv.includes('--check');
  let shallow = false;
  try { shallow = git(['rev-parse', '--is-shallow-repository']).trim() === 'true'; } catch (e) { /* not git */ }
  if (shallow) {
    // Not enough history to see the trailers. Check mode skips; a write would
    // wipe real entries, so refuse.
    console.log('gen-roadmap: shallow clone, cannot read trailers' + (check ? ' - skipped' : ''));
    process.exit(check ? 0 : 1);
  }
  const fresh = build();
  if (check) {
    let have = [];
    try { have = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* missing */ }
    const haveKeys = new Set(have.map(key));
    const missing = fresh.filter((e) => !haveKeys.has(key(e)));
    const wantKeys = new Set(fresh.map(key));
    const extra = have.filter((e) => !wantKeys.has(key(e)));
    if (missing.length || extra.length) {
      console.log('assets/roadmap-log.json is out of date. Run: node tools/gen-roadmap.js');
      missing.slice(0, 5).forEach((e) => console.log('  missing: ' + e.title));
      extra.slice(0, 5).forEach((e) => console.log('  stale:   ' + e.title));
      process.exit(1);
    }
    console.log('roadmap-log.json up to date (' + fresh.length + ' entries)');
    return;
  }
  fs.writeFileSync(OUT, JSON.stringify(fresh, null, 1) + '\n');
  console.log('wrote assets/roadmap-log.json (' + fresh.length + ' entries)');
}

if (require.main === module) main();
module.exports = { bumps, istDate, build };
