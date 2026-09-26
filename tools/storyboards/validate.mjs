#!/usr/bin/env node
// Stryker Trading Academy — storyboard validator (Models v2 drop-in tooling)
//
// Node, no dependencies. Two jobs:
//   1. Runs the REAL assets/setup-player.js SetupPlayer.validate() against
//      every model's storyboard, so a storyboard that the player would
//      refuse to render (returns null) is caught before it ships.
//   2. validate() is deliberately lenient: bad individual annotations are
//      DROPPED SILENTLY rather than failing the whole storyboard (see the
//      comment above validate() in setup-player.js). That is the right
//      behaviour for the live site (an author typo should never break the
//      whole reader), but it means a content author gets no feedback that
//      half their storyboard vanished. This script re-derives the same
//      per-annotation checks and reports every one of them by name, plus a
//      few checks validate() does not attempt at all (dangling remove/focus
//      ids, a reveal count smaller than a candle an annotation points at,
//      and a price implausibly far outside the storyboard's own candle
//      range) because those are silent authoring bugs even though the
//      player itself does not treat them as invalid.
//
// TRUTH RULE: also fails if ANY model has stats.approved === true. Nothing
// is Owner-approved on this branch; a stats card must never ship by
// accident from a content drop.
//
// Usage:
//   node tools/storyboards/validate.mjs                 # checks assets/models-data.js
//   node tools/storyboards/validate.mjs path/to/models.json   # checks a JSON file instead
//     (the JSON file may be a bare array of models, or { "models": [...] })
//
// Exit code: 0 = clean, 1 = one or more problems (see TRUTH RULE above too).

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const TYPES = new Set(['level', 'zone', 'fvg', 'band', 'sweep', 'mss', 'entry', 'stop', 'target', 'highlight', 'arrow', 'note']);

function num(v) { return typeof v === 'number' && isFinite(v); }

// ---------------------------------------------------------------------------
// Load the REAL player code and pull SetupPlayer.validate out of it, so this
// script tests the exact function that ships, not a hand-copied stand-in.
// setup-player.js only touches `window` at its very top level (assigning
// mountSetupPlayer/SetupPlayer at the end of its IIFE); it never calls into
// the DOM until mountSetupPlayer() is actually invoked, which this script
// never does — a bare `{}` for window is enough.
// ---------------------------------------------------------------------------
function loadValidate() {
  const spPath = path.join(REPO_ROOT, 'assets', 'setup-player.js');
  const code = fs.readFileSync(spPath, 'utf8');
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: spPath });
  const validate = sandbox.window && sandbox.window.SetupPlayer && sandbox.window.SetupPlayer.validate;
  if (typeof validate !== 'function') {
    throw new Error('assets/setup-player.js did not expose window.SetupPlayer.validate — did the file change shape?');
  }
  return validate;
}

// ---------------------------------------------------------------------------
// Load the model list. Default: assets/models-data.js's MODELS_SEED (the
// file is plain JS with a header comment, not JSON, so it is evaluated in a
// throwaway vm context rather than parsed). An argv path instead loads a
// JSON file, so a content author's drop-in JSON can be checked before it is
// pasted into models-data.js.
// ---------------------------------------------------------------------------
function loadModels(argPath) {
  if (argPath) {
    const text = fs.readFileSync(argPath, 'utf8');
    const data = JSON.parse(text);
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.models)) return data.models;
    return [data];
  }
  const mdPath = path.join(REPO_ROOT, 'assets', 'models-data.js');
  const code = fs.readFileSync(mdPath, 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  // models-data.js declares `const MODELS_SEED = [...]` at top level. A
  // top-level const/let in a vm context creates a lexical binding, NOT an
  // own property of the sandbox object — so it must be read back with a
  // second runInContext call in the same context, not sandbox.MODELS_SEED.
  vm.runInContext(code, sandbox, { filename: mdPath });
  const seed = vm.runInContext('typeof MODELS_SEED !== "undefined" ? MODELS_SEED : undefined', sandbox);
  if (!Array.isArray(seed)) {
    throw new Error('assets/models-data.js did not expose a MODELS_SEED array — did the file change shape?');
  }
  return seed;
}

// ---------------------------------------------------------------------------
// Re-derive setup-player.js's cleanAnn() logic, but COLLECT why something
// would be dropped instead of silently returning null, plus the extra
// authoring checks validate() does not attempt at all.
// ---------------------------------------------------------------------------
function checkStoryboard(model) {
  const problems = [];
  const label = model && model.id ? model.id : '(model with no id)';
  const sb = model.storyboard;

  const rawC = sb.candles, rawF = sb.frames;
  if (!Array.isArray(rawC) || !Array.isArray(rawF)) {
    problems.push(`[${label}] storyboard.candles and storyboard.frames must both be arrays — validate() returns null (no player renders).`);
    return problems;
  }
  if (rawC.length < 5 || rawC.length > 120) {
    problems.push(`[${label}] ${rawC.length} candles — must be 5-120 or validate() rejects the whole storyboard.`);
  }
  if (!rawF.length || rawF.length > 30) {
    problems.push(`[${label}] ${rawF.length} frames — must be 1-30 or validate() rejects the whole storyboard.`);
  }

  // Candle sanity (mirrors validate()'s hard-fail check) + the price range
  // used by the "prices outside candle range by >20%" check below.
  const candles = [];
  rawC.forEach((k, i) => {
    if (!k || !num(k.o) || !num(k.h) || !num(k.l) || !num(k.c)) {
      problems.push(`[${label}] candle[${i}] is missing or has non-numeric o/h/l/c — validate() rejects the whole storyboard.`);
      return;
    }
    if (k.h < Math.max(k.o, k.c) || k.l > Math.min(k.o, k.c)) {
      problems.push(`[${label}] candle[${i}] high/low do not bound its own open/close — validate() rejects the whole storyboard.`);
      return;
    }
    candles.push(k);
  });
  if (!candles.length) return problems; // too broken to check annotations meaningfully

  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  const rangeMin = Math.min(...lows);
  const rangeMax = Math.max(...highs);
  const rangeSpan = (rangeMax - rangeMin) || 1;
  function priceFarOutside(p) {
    return p < rangeMin - rangeSpan * 0.2 || p > rangeMax + rangeSpan * 0.2;
  }

  const last = rawC.length - 1;

  // Every id that appears in ANY frame's add[], across the whole storyboard —
  // used to catch remove/focus references to an id that was never declared.
  const declaredIds = new Set();
  rawF.forEach((fr) => {
    (fr && Array.isArray(fr.add) ? fr.add : []).forEach((a) => {
      if (a && typeof a.id === 'string' && a.id) declaredIds.add(a.id);
    });
  });

  const seenIds = new Set();

  // Compute each frame's effective reveal count up front (same defaulting
  // rule as validate()), plus, for each annotation id, the LAST frame index
  // in which it is still active (added and not yet removed) — a forward-
  // projecting line (added early, extending to a candle several frames in
  // the future) is a deliberate, common storyboard technique: the line's
  // "to" only needs to be on screen by the time the annotation would be
  // removed (or the storyboard ends), not in the very frame it was added.
  const reveals = [];
  {
    let pr = rawC.length;
    rawF.forEach((fr, i) => {
      const rv = num(fr && fr.reveal) ? Math.round(fr.reveal) : (i === 0 ? rawC.length : pr);
      const clamped = Math.max(1, Math.min(rawC.length, rv));
      reveals.push(clamped);
      pr = clamped;
    });
  }
  const lastActiveFrame = new Map(); // id -> last frame index it's on screen
  const bornAtFrame = new Map();     // id -> frame index it was added
  rawF.forEach((fr, fIdx) => {
    (Array.isArray(fr && fr.add) ? fr.add : []).forEach((a) => {
      if (a && typeof a.id === 'string' && a.id) bornAtFrame.set(a.id, fIdx);
    });
  });
  bornAtFrame.forEach((bornAt, id) => {
    let removedAt = rawF.length - 1; // default: alive through the last frame
    for (let f = bornAt; f < rawF.length; f++) {
      const fr = rawF[f];
      if (Array.isArray(fr && fr.remove) && fr.remove.indexOf(id) >= 0) { removedAt = f; break; }
    }
    lastActiveFrame.set(id, removedAt);
  });
  function maxRevealDuring(bornAt, removedAt) {
    let m = 0;
    for (let f = bornAt; f <= removedAt && f < reveals.length; f++) m = Math.max(m, reveals[f]);
    return m;
  }

  rawF.forEach((fr, fIdx) => {
    if (!fr || typeof fr !== 'object') {
      problems.push(`[${label}] frame[${fIdx}] is not an object.`);
      return;
    }
    const frameName = fr.title ? `"${fr.title}"` : `#${fIdx}`;

    (Array.isArray(fr.remove) ? fr.remove : []).forEach((rid) => {
      if (typeof rid !== 'string' || !declaredIds.has(rid)) {
        problems.push(`[${label}] frame ${frameName}: remove references unknown id "${rid}".`);
      }
    });
    (Array.isArray(fr.focus) ? fr.focus : []).forEach((fid) => {
      if (typeof fid !== 'string' || !declaredIds.has(fid)) {
        problems.push(`[${label}] frame ${frameName}: focus references unknown id "${fid}".`);
      }
    });

    (Array.isArray(fr.add) ? fr.add : []).forEach((a, aIdx) => {
      if (!a || typeof a !== 'object') {
        problems.push(`[${label}] frame ${frameName} annotation[${aIdx}] is not an object.`);
        return;
      }
      const idPart = a.id ? `id="${a.id}"` : 'no id';
      const where = `[${label}] frame ${frameName} annotation[${aIdx}] (${idPart})`;

      if (!TYPES.has(a.type)) {
        problems.push(`${where}: bad type "${a.type}" — validate() drops this annotation silently.`);
        return;
      }
      if (!a.id || typeof a.id !== 'string') {
        problems.push(`${where}: missing/invalid id — validate() drops this annotation silently.`);
        return;
      }
      if (seenIds.has(a.id)) {
        problems.push(`${where}: duplicate id "${a.id}" — validate() drops this annotation silently (later duplicates never render).`);
      }
      seenIds.add(a.id);

      const type = a.type === 'fvg' ? 'zone' : a.type;
      const from = num(a.from) ? Math.round(a.from) : 0;
      const to = num(a.to) ? Math.round(a.to) : last;
      // Which candle index(es) this annotation needs ACTUALLY DRAWN to look
      // right, for the reveal check below. Lines/zones/bands (level, zone,
      // mss, entry, stop, target, band) are positioned by a fixed x-formula
      // across the WHOLE storyboard width regardless of how many candles are
      // currently revealed (see Xl()/Xr() in setup-player.js) — a line
      // extending from its origin toward a candle that has not appeared yet
      // is a normal, intentional "projected level" and renders correctly
      // into blank space. Only the near/origin edge ("from") needs to be on
      // an actually-drawn candle; the far edge is deliberately allowed to
      // project forward. Highlight, sweep, note and arrow instead index
      // directly into sb.candles or position at an exact candle's price
      // (setup-player.js lines ~486/520/550), so EVERY reference point they
      // use must already be revealed or the result is a marker/ring floating
      // over a candle that has not been drawn (or, for highlight, silently
      // uses that future candle's real H/L to size a ring around nothing).
      const refIdxs = [];

      switch (type) {
        case 'level': case 'mss': case 'entry': case 'stop': case 'target':
          if (!num(a.price)) {
            problems.push(`${where}: missing/non-numeric price — validate() drops this annotation silently.`);
          } else if (priceFarOutside(a.price)) {
            problems.push(`${where}: price ${a.price} is more than 20% outside the storyboard's candle range [${rangeMin}, ${rangeMax}].`);
          }
          refIdxs.push(from); // "to" may deliberately project forward
          break;
        case 'zone':
          if (!num(a.top) || !num(a.bottom)) {
            problems.push(`${where}: missing/non-numeric top/bottom — validate() drops this annotation silently.`);
          } else {
            if (priceFarOutside(a.top)) problems.push(`${where}: top ${a.top} is more than 20% outside the storyboard's candle range [${rangeMin}, ${rangeMax}].`);
            if (priceFarOutside(a.bottom)) problems.push(`${where}: bottom ${a.bottom} is more than 20% outside the storyboard's candle range [${rangeMin}, ${rangeMax}].`);
          }
          refIdxs.push(from); // "to" may deliberately project forward
          break;
        case 'band':
          refIdxs.push(from); // "to" may deliberately project forward
          break;
        case 'highlight':
          refIdxs.push(from, num(a.to) ? Math.round(a.to) : from);
          break;
        case 'sweep':
          if (!num(a.at)) {
            problems.push(`${where}: missing/non-numeric "at" — validate() drops this annotation silently.`);
          } else {
            refIdxs.push(Math.round(a.at));
          }
          break;
        case 'note':
          if (!num(a.at) || !num(a.price) || !a.label) {
            problems.push(`${where}: a note needs a numeric "at", a numeric "price" and a non-empty label — validate() drops this annotation silently.`);
          } else {
            refIdxs.push(Math.round(a.at));
            if (priceFarOutside(a.price)) problems.push(`${where}: price ${a.price} is more than 20% outside the storyboard's candle range [${rangeMin}, ${rangeMax}].`);
          }
          break;
        case 'arrow':
          if (!a.from || !a.to || !num(a.from.price) || !num(a.to.price)) {
            problems.push(`${where}: an arrow needs from:{at,price} and to:{at,price} — validate() drops this annotation silently.`);
          } else {
            refIdxs.push(num(a.from.at) ? Math.round(a.from.at) : 0); // "to.at" may deliberately project forward
            if (priceFarOutside(a.from.price)) problems.push(`${where}: from.price ${a.from.price} is more than 20% outside the storyboard's candle range [${rangeMin}, ${rangeMax}].`);
            if (priceFarOutside(a.to.price)) problems.push(`${where}: to.price ${a.to.price} is more than 20% outside the storyboard's candle range [${rangeMin}, ${rangeMax}].`);
          }
          break;
      }

      // A reveal smaller than the candle(s) an annotation references at
      // EVERY point while it is still active on screen: forward-projecting
      // lines are normal (added early, extended toward a candle a few
      // frames ahead), so this checks the max reveal across the
      // annotation's whole active window (birth frame through removal, or
      // the end of the storyboard), not just the reveal in the frame it was
      // added. validate() does not check this at all (the chart would just
      // draw the annotation past the visible edge); it is a genuine
      // authoring bug worth flagging.
      const removedAt = lastActiveFrame.has(a.id) ? lastActiveFrame.get(a.id) : fIdx;
      const bestReveal = maxRevealDuring(fIdx, removedAt);
      [...new Set(refIdxs)].forEach((idx) => {
        if (num(idx) && idx >= bestReveal) {
          problems.push(`${where}: references candle[${idx}], never revealed while this annotation is on screen (max reveal in that window: ${bestReveal}).`);
        }
      });
    });
  });

  return problems;
}

function main() {
  const argPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : null;

  let validate, models;
  try {
    validate = loadValidate();
    models = loadModels(argPath);
  } catch (e) {
    console.error('FATAL: ' + e.message);
    process.exit(1);
  }

  const problems = [];
  let withStoryboard = 0;

  models.forEach((m) => {
    const label = m && m.id ? m.id : '(model with no id)';

    // TRUTH RULE: nothing is Owner-approved on this branch.
    if (m && m.stats && m.stats.approved === true) {
      problems.push(`[${label}] TRUTH RULE: stats.approved === true — no model may ship approved stats from this branch.`);
    }

    if (m && m.storyboard && typeof m.storyboard === 'object') {
      withStoryboard++;
      let cleaned = null;
      try {
        cleaned = validate(m.storyboard);
      } catch (e) {
        problems.push(`[${label}] SetupPlayer.validate() threw: ${e.message}`);
      }
      if (!cleaned) {
        problems.push(`[${label}] SetupPlayer.validate() returned null — the whole storyboard is invalid and the player will not render (slot stays hidden).`);
      }
      problems.push(...checkStoryboard(m));
    }
  });

  console.log(`Checked ${models.length} model(s), ${withStoryboard} with a storyboard.`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):\n`);
    problems.forEach((p) => console.log('  - ' + p));
    process.exitCode = 1;
  } else {
    console.log('No problems found.');
  }
}

main();
