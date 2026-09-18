/**
 * Drafting with the Claude API.
 *
 *   draftCaptions(post)  every platform's text in one call
 *   draftScript(post)    the video script (scenes + narration)
 *
 * Both enforce the rule inherited from the X pipeline: every figure in the
 * output must appear in the source, or the draft is rejected and asked for
 * again. Lengths are validated here, never trusted. Links are appended by
 * the publisher, never written by the model.
 *
 * MODEL: claude-opus-5 at medium effort; server-side refusal fallbacks on.
 */
const { env } = require('../config');
const { VOICE, PLATFORM_RULES, SCRIPT_RULES } = require('./prompts');
const { weightedLength } = require('../publish/x');

const MODEL = 'claude-opus-5';
const X_LIMIT = 280;
const LIMITS = { threads: 500, instagram: 2200, ytTitle: 100, ytDescription: 5000 };

let cached = null;
function client() {
  if (!cached) {
    const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
    cached = new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 2, timeout: 120 * 1000 });
  }
  return cached;
}

function normFigure(s) { return String(s || '').replace(/[^\d.:]/g, '').replace(/^[.:]+|[.:]+$/g, ''); }

function figuresMissingFrom(figures, sourceText) {
  const hay = String(sourceText || '').replace(/,/g, '');
  return (figures || []).filter((f) => {
    const n = normFigure(String(f).replace(/,/g, ''));
    if (!n || !/\d/.test(n)) return false;
    return !hay.includes(n);
  });
}

/** Number-looking tokens in free text, for the figures the model forgot to list. */
function scanFigures(text) {
  const out = String(text || '').match(/\$?\d[\d,]*(?:\.\d+)?%?(?::\d{2})?/g) || [];
  // Ordinals and small counts ("3 things", "1st") are not market figures.
  return out.filter((f) => !/^\d{1,2}$/.test(f.replace(/[$%]/g, '')));
}

function missingFigures(listed, texts, source) {
  const scanned = texts.flatMap(scanFigures);
  const all = Array.from(new Set(figuresMissingFrom((listed || []).concat(scanned), source)));
  return all;
}

const CAPTIONS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['x', 'threads', 'instagram', 'youtube', 'figuresUsed', 'cardTitle', 'cardBody', 'altText'],
  properties: {
    x: { type: 'array', items: { type: 'string' }, description: 'X post text. One entry, or several for a thread, in order. No URLs.' },
    threads: { type: 'string', description: 'Threads post. No URLs.' },
    instagram: { type: 'string', description: 'Instagram caption. No URLs.' },
    youtube: {
      type: 'object', additionalProperties: false, required: ['title', 'description', 'tags'],
      properties: { title: { type: 'string' }, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }
    },
    figuresUsed: { type: 'array', items: { type: 'string' }, description: 'Every number, level, time or percentage used anywhere above, exactly as written. Empty if none.' },
    cardTitle: { type: 'string', description: 'Headline for the image card, under 90 characters.' },
    cardBody: { type: 'string', description: 'Supporting sentences for the card, under 300 characters. May be empty.' },
    altText: { type: 'string', description: 'Accessible description of the card, under 200 characters.' }
  }
};

const SCRIPT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'scenes', 'figuresUsed', 'hashtags'],
  properties: {
    title: { type: 'string', description: 'Working title of the video, under 60 characters.' },
    scenes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['type', 'heading', 'text', 'narration', 'stat'],
        properties: {
          type: { type: 'string', enum: ['title', 'point', 'stat', 'cta'] },
          heading: { type: 'string' }, text: { type: 'string' }, narration: { type: 'string' },
          stat: { type: 'string', description: 'For a stat scene, the figure exactly as in the source; otherwise empty.' }
        }
      }
    },
    figuresUsed: { type: 'array', items: { type: 'string' } },
    hashtags: { type: 'array', items: { type: 'string' } }
  }
};

async function ask(system, user, schema) {
  const res = await client().beta.messages.create({
    model: MODEL, max_tokens: 6000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }]
  });
  if (res.stop_reason === 'refusal') {
    throw new Error('Drafting declined by the model' + (res.stop_details && res.stop_details.category ? ` (${res.stop_details.category})` : ''));
  }
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let out = null;
  try { out = JSON.parse(text); } catch (e) { /* handled by caller */ }
  return { out, cut: res.stop_reason === 'max_tokens', model: res.model, usage: res.usage ? { in: res.usage.input_tokens, out: res.usage.output_tokens } : null };
}

function sourceText(post) { return typeof post.source === 'string' ? post.source : JSON.stringify(post.source); }

/**
 * Validates a captions draft against limits and the source. Returns a list of
 * problems (empty when the draft is good). Exported for tests.
 */
function validateCaptions(out, post, { thread, xBudget }) {
  const p = [];
  const noUrl = (s, where) => { if (/https?:\/\/|www\./i.test(s)) p.push(`${where} contains a URL. Remove it.`); };
  const noMd = (s, where) => { if (/\*\*|^#\s|^- /m.test(s)) p.push(`${where} contains markdown.`); };
  const x = (out.x || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!x.length) p.push('No X text.');
  if (thread && x.length < 2) p.push('The X thread needs at least two posts.');
  if (!thread && x.length > 1) p.push('X must be a single post here.');
  x.forEach((s, i) => {
    const reserve = (i === x.length - 1) ? xBudget : 0;
    const len = weightedLength(s);
    if (len + reserve > X_LIMIT) p.push(`X post ${i + 1} is ${len} characters; it must be under ${X_LIMIT - reserve}.`);
    noUrl(s, `X post ${i + 1}`); noMd(s, `X post ${i + 1}`);
  });
  const th = String(out.threads || '').trim();
  if (!th) p.push('No Threads text.');
  if (th.length > LIMITS.threads - 30) p.push(`Threads post is ${th.length} characters; keep it under ${LIMITS.threads - 30}.`);
  noUrl(th, 'Threads post'); noMd(th, 'Threads post');
  const ig = String(out.instagram || '').trim();
  if (!ig) p.push('No Instagram caption.');
  if (ig.length > LIMITS.instagram - 100) p.push(`Instagram caption is ${ig.length} characters; keep it under ${LIMITS.instagram - 100}.`);
  noUrl(ig, 'Instagram caption'); noMd(ig, 'Instagram caption');
  const yt = out.youtube || {};
  if (!yt.title) p.push('No YouTube title.');
  if (String(yt.title || '').length > LIMITS.ytTitle - 8) p.push(`YouTube title is ${yt.title.length} characters; keep it under ${LIMITS.ytTitle - 8}.`);
  if (String(yt.description || '').length > LIMITS.ytDescription - 200) p.push('YouTube description is too long.');
  noUrl(String(yt.title || '') + ' ' + String(yt.description || ''), 'YouTube text');
  const missing = missingFigures(out.figuresUsed, [x.join(' '), th, ig, String(yt.title || ''), String(yt.description || '')], sourceText(post));
  if (missing.length) p.push(`These figures are not in the source: ${missing.join(', ')}. Use only figures from the source, or describe without a figure.`);
  return p;
}

function validateScript(out, post) {
  const p = [];
  const scenes = out.scenes || [];
  if (scenes.length < 4) p.push('Too few scenes.');
  if (scenes[0] && scenes[0].type !== 'title') p.push('The first scene must be type "title".');
  if (scenes.length && scenes[scenes.length - 1].type !== 'cta') p.push('The last scene must be type "cta".');
  let words = 0;
  scenes.forEach((s, i) => {
    const n = String(s.narration || '').trim().split(/\s+/).filter(Boolean).length;
    words += n;
    if (n < 5) p.push(`Scene ${i + 1} narration is too short.`);
    if (n > 34) p.push(`Scene ${i + 1} narration is ${n} words; keep it under 30.`);
    if (String(s.heading || '').length > 48) p.push(`Scene ${i + 1} heading is over 40 characters.`);
    if (String(s.text || '').length > 130) p.push(`Scene ${i + 1} text is over 110 characters.`);
    if (/https?:\/\/|www\./i.test(s.narration + ' ' + s.text + ' ' + s.heading)) p.push(`Scene ${i + 1} contains a URL.`);
    if (s.type === 'stat' && !String(s.stat || '').trim()) p.push(`Scene ${i + 1} is a stat scene without a stat.`);
  });
  if (words < 80) p.push(`Total narration is ${words} words; it must be at least 90.`);
  if (words > 165) p.push(`Total narration is ${words} words; it must be under 150.`);
  const texts = scenes.flatMap((s) => [s.heading, s.text, s.narration, s.stat]);
  const missing = missingFigures(out.figuresUsed, texts, sourceText(post));
  if (missing.length) p.push(`These figures are not in the source: ${missing.join(', ')}. Use only figures from the source, or describe without a figure.`);
  return p;
}

/** Drafts every platform's text for a post. */
async function draftCaptions(post, { xLink, thread } = {}) {
  const xBudget = xLink ? 25 : 0;   // 23-char link plus the newline before it
  let feedback = ''; let lastErr = null; let usage = { in: 0, out: 0 };
  for (let attempt = 0; attempt < 3; attempt++) {
    const user = `TASK\n${post.instructions}\n\n${PLATFORM_RULES}\n\n` +
      `X FORMAT: ${thread ? 'a thread of 3 to 5 posts' : 'a single post'}; each under ${X_LIMIT - xBudget - (thread ? 0 : 0)} characters` +
      (xLink ? ` (the system appends a link to ${thread ? 'the last post' : 'it'})` : '') + '.\n\n' +
      `SOURCE\n${sourceText(post)}` + (feedback ? `\n\nPREVIOUS ATTEMPT WAS REJECTED\n${feedback}` : '');
    const r = await ask(VOICE, user, CAPTIONS_SCHEMA);
    if (r.usage) { usage.in += r.usage.in; usage.out += r.usage.out; }
    if (r.cut) { feedback = 'The reply was cut off. Be shorter.'; continue; }
    if (!r.out) { feedback = 'Return only the JSON object.'; lastErr = new Error('Model returned non-JSON'); continue; }
    const problems = validateCaptions(r.out, post, { thread, xBudget });
    if (!problems.length) {
      const o = r.out;
      return {
        x: o.x.map((s) => s.trim()), threads: o.threads.trim(), instagram: o.instagram.trim(),
        youtube: { title: String(o.youtube.title).trim(), description: String(o.youtube.description || '').trim(), tags: (o.youtube.tags || []).slice(0, 10) },
        cardTitle: String(o.cardTitle || '').slice(0, 120), cardBody: String(o.cardBody || '').slice(0, 320), altText: String(o.altText || '').slice(0, 300),
        figuresUsed: o.figuresUsed || [], model: r.model, usage
      };
    }
    feedback = problems.join('\n');
    lastErr = new Error('Draft rejected: ' + problems.join(' '));
  }
  throw lastErr || new Error('Drafting failed');
}

/** Drafts the video script for a post. */
async function draftScript(post) {
  let feedback = ''; let lastErr = null; let usage = { in: 0, out: 0 };
  for (let attempt = 0; attempt < 3; attempt++) {
    const user = `TASK\nWrite the script for a short vertical video. ${post.instructions}\n\n${SCRIPT_RULES}\n\n` +
      `SOURCE\n${sourceText(post)}` + (feedback ? `\n\nPREVIOUS ATTEMPT WAS REJECTED\n${feedback}` : '');
    const r = await ask(VOICE, user, SCRIPT_SCHEMA);
    if (r.usage) { usage.in += r.usage.in; usage.out += r.usage.out; }
    if (r.cut) { feedback = 'The reply was cut off. Be shorter.'; continue; }
    if (!r.out) { feedback = 'Return only the JSON object.'; lastErr = new Error('Model returned non-JSON'); continue; }
    const problems = validateScript(r.out, post);
    if (!problems.length) {
      return { title: String(r.out.title || post.title || '').slice(0, 80), scenes: r.out.scenes.map((s) => ({
        type: s.type, heading: String(s.heading || '').trim(), text: String(s.text || '').trim(),
        narration: String(s.narration || '').trim(), stat: String(s.stat || '').trim()
      })), hashtags: (r.out.hashtags || []).slice(0, 5), figuresUsed: r.out.figuresUsed || [], model: r.model, usage };
    }
    feedback = problems.join('\n');
    lastErr = new Error('Script rejected: ' + problems.join(' '));
  }
  throw lastErr || new Error('Script drafting failed');
}

module.exports = { draftCaptions, draftScript, validateCaptions, validateScript, figuresMissingFrom, missingFigures, MODEL };
