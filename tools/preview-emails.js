#!/usr/bin/env node
// Renders the five welcome-series emails to tools/email-previews/ so they can
// be opened in a browser and screenshotted. Uses the real templates
// (functions-src/emailTemplates.js) and, for day 14, the live-price rule from
// functions-src/welcomeEmails.js with a plan passed on the command line or a
// sample. Nothing is sent. tools/ is excluded from the deploy.
//
//   node tools/preview-emails.js                  placeholders visible
//   node tools/preview-emails.js --address "…"    with a postal address
//   … --plans plans.json --offer <id> [--also <id>]   day 14 from real plan records
'use strict';
const fs = require('fs');
const path = require('path');
const T = require('../functions-src/emailTemplates');

const args = process.argv.slice(2);
const addrIx = args.indexOf('--address');
const postalAddress = addrIx >= 0 ? args[addrIx + 1] : '';
// Day 14 uses real plan records: --plans <file.json> (an array of plan docs
// with ids, as the function reads them) plus --offer <planId> [--also <planId>],
// run through the same offerFor() the sender uses. Without them, placeholders.
const { __welcomeInternals: W } = (() => { try { return require('../functions-src/welcomeEmails'); } catch (e) { return {}; } })();
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
let offer = { planId: 'PLAN_ID', planName: '[PLAN]', priceLabel: '[PRICE]', wasLabel: null, features: [] };
let alsoOffer = null;
if (opt('--plans') && W) {
  const plans = JSON.parse(fs.readFileSync(opt('--plans'), 'utf8'));
  offer = W.offerFor(plans.find((p) => p.id === opt('--offer'))) || offer;
  if (opt('--also')) alsoOffer = W.offerFor(plans.find((p) => p.id === opt('--also')));
}

const out = path.join(__dirname, 'email-previews');
fs.mkdirSync(out, { recursive: true });
T.DAYS.forEach((day, step) => {
  const r = T.render(step, {
    firstName: 'Jordan',
    unsubscribeUrl: 'https://us-central1-strykertrades-e0cd8.cloudfunctions.net/emailUnsubscribe?u=PREVIEW&t=PREVIEW',
    postalAddress, offer, alsoOffer
  });
  fs.writeFileSync(path.join(out, `day${day}.html`), r.html);
  fs.writeFileSync(path.join(out, `day${day}.txt`), `Subject: ${r.subject}\nPreheader: ${r.preheader}\n\n${r.text}\n`);
  console.log(`day${day}: "${r.subject}"  placeholders=${T.hasPlaceholders(r)}`);
});
