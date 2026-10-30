// Trace a leaked community indicator to the account that loaded it.
//   node tools/creator/trace-leak.mjs <leaked.pine> <key.json> [uid1 uid2 ... | uids.txt]
// key.json = the CREATOR_SEAL_KEY private JWK (kept off the repo, e.g. /root/.config/tradezoro/creator-seal-key.json).
// Prints the hidden mark(s) found and, if candidate uids are given (e.g. the indicator's holders), which uid matches.
// The mark is 8 bytes of HMAC(key, uid): it cannot be reversed to a uid without the candidates and the key.
import fs from 'node:fs';
import { findMarks } from '../../assets/pine-obfuscate.js';
import { markBytes } from '../../functions/api/creator/ind.js';

const [leakPath, keyPath, ...rest] = process.argv.slice(2);
if (!leakPath || !keyPath) { console.error('usage: trace-leak.mjs <leaked.pine> <key.json> [uids... | uids.txt]'); process.exit(2); }
const text = fs.readFileSync(leakPath, 'utf8');
const key = fs.readFileSync(keyPath, 'utf8');
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const marks = findMarks(text).map(hex);
if (!marks.length) { console.log('No watermark found (it may have been stripped: invisible characters removed).'); process.exit(1); }
console.log('marks found: ' + marks.join(', '));
let uids = rest;
if (uids.length === 1 && fs.existsSync(uids[0])) uids = fs.readFileSync(uids[0], 'utf8').split(/\s+/).filter(Boolean);
let hit = 0;
for (const u of uids) if (marks.includes(hex(await markBytes(key, u)))) { console.log('MATCH uid ' + u); hit++; }
if (uids.length && !hit) console.log('No candidate uid matches.');
