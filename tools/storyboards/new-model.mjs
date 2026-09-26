#!/usr/bin/env node
// Stryker Trading Academy — model skeleton generator (Models v2 drop-in tooling)
//
// Usage:
//   node tools/storyboards/new-model.mjs <id>
//
// Prints a model-object skeleton to stdout matching the exact shape used by
// assets/models-data.js's MODELS_SEED array (verified against the live file:
// every model there is { id, name, category, summary, video, bodyHtml,
// paragraphs, steps }, with an optional storyboard key sitting between
// category and summary on the one model that has one). Pipe the output
// straight into a JSON/JS file, fill in the placeholders, run it through
// validate.mjs, then paste the finished object into MODELS_SEED.
//
// This script does NOT touch assets/models-data.js itself -- content still
// drops in as a manual paste (or via the Trading Models admin editor) so a
// human always reviews the diff before it ships.
//
// No dependencies.

const id = process.argv[2];

if (!id) {
  console.error('Usage: node tools/storyboards/new-model.mjs <id>');
  console.error('Example: node tools/storyboards/new-model.mjs silver-bullet-model');
  process.exit(1);
}

if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
  console.error(`"${id}" doesn't look like the site's id style (lowercase, digits, hyphens only, e.g. "silver-bullet-model"). Printing the skeleton anyway -- fix the id before you paste it in.`);
}

const name = id
  .split('-')
  .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
  .join(' ');

const skeleton = {
  id,
  name: `Model __ — ${name}`,
  category: 'REPLACE (e.g. "Liquidity Sweep", "FVG / Imbalance")',
  // Delete this whole "storyboard" key if this model doesn't ship one yet.
  // See tools/storyboards/TEMPLATE.md for the authoring guide and a fuller
  // per-annotation-type skeleton -- this is a minimal 6-frame stub so
  // `node tools/storyboards/validate.mjs` has something to check.
  storyboard: {
    version: 1,
    title: 'REPLACE — short storyboard title',
    timeframe: '15m',
    illustrative: true,
    candles: [
      { o: 100.0, h: 100.8, l: 99.6, c: 100.4 },
      { o: 100.4, h: 101.2, l: 100.0, c: 100.9 },
      { o: 100.9, h: 101.6, l: 100.5, c: 101.3 },
      { o: 101.3, h: 102.4, l: 101.0, c: 102.1 },
      { o: 102.1, h: 102.6, l: 101.6, c: 101.9 },
      { o: 101.9, h: 102.2, l: 101.2, c: 101.5 },
      { o: 101.5, h: 101.8, l: 100.6, c: 100.9 },
      { o: 100.9, h: 101.4, l: 100.7, c: 101.2 },
      { o: 101.2, h: 102.5, l: 101.0, c: 102.3 },
      { o: 102.3, h: 103.4, l: 102.1, c: 103.1 },
      { o: 103.1, h: 103.6, l: 102.8, c: 103.4 },
      { o: 103.4, h: 104.3, l: 103.2, c: 104.0 },
    ],
    frames: [
      {
        title: 'REPLACE — frame 1',
        caption: 'REPLACE — plain text, <= 300 chars, no prices, no win rates.',
        reveal: 4,
        add: [
          { type: 'band', id: 'f1', from: 0, to: 3, label: 'REPLACE' },
        ],
      },
      {
        title: 'REPLACE — frame 2',
        caption: 'REPLACE',
        reveal: 6,
        add: [
          { type: 'level', id: 'f2', price: 102.6, from: 4, to: 11, label: 'REPLACE' },
        ],
      },
      {
        title: 'REPLACE — frame 3',
        caption: 'REPLACE',
        reveal: 7,
        add: [
          { type: 'sweep', id: 'f3', at: 6, side: 'low', label: 'REPLACE' },
        ],
      },
      {
        title: 'REPLACE — frame 4',
        caption: 'REPLACE',
        reveal: 8,
        add: [
          { type: 'mss', id: 'f4', price: 101.9, from: 6, to: 8, label: 'REPLACE' },
        ],
      },
      {
        title: 'REPLACE — frame 5',
        caption: 'REPLACE',
        reveal: 10,
        add: [
          { type: 'zone', id: 'f5', top: 101.6, bottom: 101.2, from: 5, to: 11, label: 'REPLACE' },
        ],
      },
      {
        title: 'REPLACE — frame 6',
        caption: 'REPLACE',
        reveal: 12,
        add: [
          { type: 'entry', id: 'f6a', price: 101.4, from: 8, to: 11, label: 'Entry' },
          { type: 'stop', id: 'f6b', price: 100.6, from: 8, to: 11, label: 'Stop' },
          { type: 'target', id: 'f6c', price: 103.6, from: 8, to: 11, label: 'Target' },
        ],
      },
    ],
  },
  summary: 'REPLACE — one or two sentences, no win rates, no invented numbers.',
  video: '',
  bodyHtml: '<p>REPLACE — long-form HTML body (matches the style of the other models in assets/models-data.js: plain paragraphs, an optional illustrative-chart <div> block, no inline prices/results).</p>',
  paragraphs: [
    'REPLACE — plain-text paragraph 1 (shown as the reader-mode fallback of bodyHtml).',
    'REPLACE — plain-text paragraph 2.',
  ],
  steps: [
    {
      title: 'REPLACE — step 1 title',
      desc: 'REPLACE — one-line step summary.',
      descHtml: '<p>REPLACE — full step description as HTML.</p>',
    },
    {
      title: 'REPLACE — step 2 title',
      desc: 'REPLACE',
      descHtml: '<p>REPLACE</p>',
    },
  ],
};

console.log(JSON.stringify(skeleton, null, 2));
