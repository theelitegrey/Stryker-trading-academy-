#!/usr/bin/env node
// Renders the five welcome-series emails to tools/email-previews/ so they can
// be opened in a browser and screenshotted. Uses the real templates
// (functions-src/emailTemplates.js) and, for day 14, the live-price rule from
// functions-src/welcomeEmails.js with a plan passed on the command line or a
// sample. Nothing is sent. tools/ is excluded from the deploy.
//
//   node tools/preview-emails.js                  placeholders visible
//   node tools/preview-emails.js --address "…"    with a postal address
'use strict';
const fs = require('fs');
const path = require('path');
const T = require('../functions-src/emailTemplates');

const args = process.argv.slice(2);
const addrIx = args.indexOf('--address');
const postalAddress = addrIx >= 0 ? args[addrIx + 1] : '';
// Sample offer only; the live function reads the configured plan's price.
const offer = { planId: 'PLAN_ID', planName: '[PLAN]', priceLabel: '[PRICE]', wasLabel: null };

const out = path.join(__dirname, 'email-previews');
fs.mkdirSync(out, { recursive: true });
T.DAYS.forEach((day, step) => {
  const r = T.render(step, {
    firstName: 'Jordan',
    unsubscribeUrl: 'https://us-central1-strykertrades-e0cd8.cloudfunctions.net/emailUnsubscribe?u=PREVIEW&t=PREVIEW',
    postalAddress, offer
  });
  fs.writeFileSync(path.join(out, `day${day}.html`), r.html);
  fs.writeFileSync(path.join(out, `day${day}.txt`), `Subject: ${r.subject}\nPreheader: ${r.preheader}\n\n${r.text}\n`);
  console.log(`day${day}: "${r.subject}"  placeholders=${T.hasPlaceholders(r)}`);
});
