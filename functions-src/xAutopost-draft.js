/**
 * Stryker Trading Academy — post drafting for the X autopost function
 *
 * Turns a source (the brief JSON, a calendar event, a monitor signal, a page,
 * a new chapter) into the text of an X post or thread, via the Claude API.
 *
 * THE RULES THAT MATTER, in order:
 *
 *  1. Every number comes from the source. The brief is written under a
 *     "never invent a level" rule (tools/market-brief.md) and a tweet
 *     summarising it inherits that rule in full. The prompt says so, the
 *     schema forces the model to list the figures it used, and this file
 *     checks each one against the source text before the draft is accepted.
 *     A draft with a figure the source does not contain is rejected outright.
 *
 *  2. Length is checked here, not trusted. X's 280 weighted characters are
 *     enforced by weightedLength() from the X client, including the 23-char
 *     URL rule, and a draft that overruns is asked for again, shorter.
 *
 *  3. The link is appended by us, never by the model, so the UTM tags are
 *     always right and the model cannot mis-type the domain.
 *
 *  4. Source credit by name. The brief cites outlets by name; the post does
 *     the same. An @handle is used only when the model is certain it is that
 *     outlet's official account — a wrong handle is worse than none.
 *
 * MODEL: claude-opus-5 at medium effort. Drafting a tweet is not the hard
 * part of anyone's day; the quality that matters is restraint, which effort
 * "medium" delivers at a fraction of the token spend of "high". Refusal
 * fallbacks are on ("default" mode) so a classifier decline on, say, a
 * geopolitical monitor alert is retried server-side instead of dropping
 * the post.
 */

const { weightedLength } = require('./xAutopost-x');

const MODEL = 'claude-opus-5';
const LIMIT = 280;

const VOICE = `You write the X (Twitter) posts for Stryker Trading Academy, an education
platform teaching ICT and smart-money trading. The account is read by retail
traders before the London and New York sessions.

Voice: an analyst on a desk, not a marketer. Direct sentences. Concrete over
vague. Context, not calls — never "buy", "sell", "will go up", "guaranteed".
Never promise returns. Dry wit is fine; hype is not. British or American
spelling is fine; pick one per post.

Hard rules:
- Only use numbers, levels, times and percentages that appear verbatim in the
  SOURCE. If the source does not give a figure, describe the move without one.
  Never round a source figure to something else, never compute a new one.
- Do not include any URL. The link is appended by the system after you.
- Credit sources by name when the source names them. Use an @handle only if
  you are certain it is that outlet's official X account; otherwise the name.
- At most two hashtags per post, and only when natural. Emojis sparingly:
  none or one per post, never as bullets.
- Never mention that the post was generated, scheduled or automated.
- Stay under the character budget you are given; count a URL as 23 characters
  (the system will append one).
- Plain text only: no markdown, no asterisks, no headings.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['parts', 'figuresUsed', 'cardTitle', 'cardBody', 'altText'],
  properties: {
    parts: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: { type: 'string' },
      description: 'The post text. One entry for a single post; several for a thread, in order. No URLs.'
    },
    figuresUsed: {
      type: 'array',
      items: { type: 'string' },
      description: 'Every number, level, time or percentage that appears in parts, exactly as written there (e.g. "5.04%", "14:00 ET", "$106.56"). Empty if none.'
    },
    cardTitle: { type: 'string', description: 'Headline for the image card, under 90 characters.' },
    cardBody: { type: 'string', description: 'One or two supporting sentences for the image card, under 220 characters. May be empty.' },
    altText: { type: 'string', description: 'Accessible description of the card for screen readers, under 200 characters.' }
  }
};

let cached = null;
function client(apiKey) {
  if (!cached) {
    const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
    cached = new Anthropic({ apiKey, maxRetries: 2, timeout: 90 * 1000 });
  }
  return cached;
}

/**
 * Digits as they appear in a figure, so "5.04%" and "5.04" match and so does
 * "14:00 ET" against "14:00". A figure is "in the source" when its digit
 * string (dots and colons kept) appears in the source text.
 */
function normFigure(s) {
  return String(s || '').replace(/[^\d.:]/g, '').replace(/^[.:]+|[.:]+$/g, '');
}

function figuresMissingFrom(figures, sourceText) {
  const hay = String(sourceText || '');
  return (figures || []).filter((f) => {
    const n = normFigure(f);
    if (!n || !/\d/.test(n)) return false;
    return !hay.includes(n);
  });
}

/**
 * Asks the model for a draft and validates it.
 *
 * @param {object} opts
 *   apiKey        Anthropic key from Secret Manager
 *   kind          'brief' | 'calendar' | 'monitor' | 'announce' | 'feature'
 *   instructions  what this post is for, and whether it is a thread
 *   source        the source material as text (JSON or prose)
 *   linkLength    reserved characters for the appended link (23 if a link)
 *   thread        true to allow several parts
 * @returns {{ parts: string[], cardTitle, cardBody, altText, model, usage }}
 */
async function draft(opts) {
  const c = client(opts.apiKey);
  const budget = LIMIT - (opts.linkLength || 0) - 2;  // 2 for the newline before the link
  const maxParts = opts.thread ? 5 : 1;

  let feedback = '';
  let lastErr = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const user =
      `TASK\n${opts.instructions}\n\n` +
      `FORMAT\n${opts.thread
        ? `A thread of 3 to ${maxParts} posts. The first post must stand alone as a hook. Number nothing; X shows the order.`
        : 'A single post.'}\n` +
      `Each post must be under ${budget} characters (the system appends a ${opts.linkLength || 0}-character link to ${opts.thread ? 'the last post' : 'it'}).\n\n` +
      `SOURCE\n${opts.source}` +
      (feedback ? `\n\nPREVIOUS ATTEMPT WAS REJECTED\n${feedback}` : '');

    const res = await c.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: [{ type: 'text', text: VOICE, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }]
    });

    if (res.stop_reason === 'refusal') {
      throw new Error('Drafting declined by the model' +
        (res.stop_details && res.stop_details.category ? ` (${res.stop_details.category})` : ''));
    }
    if (res.stop_reason === 'max_tokens') {
      feedback = 'The reply was cut off. Be shorter.';
      continue;
    }

    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let out;
    try { out = JSON.parse(text); } catch (e) {
      lastErr = new Error('Model returned non-JSON'); feedback = 'Return only the JSON object.'; continue;
    }

    const parts = (out.parts || []).map((p) => String(p || '').trim()).filter(Boolean);
    const problems = [];
    if (!parts.length) problems.push('No post text.');
    if (parts.length > maxParts) problems.push(`Too many posts: ${parts.length}, maximum ${maxParts}.`);
    if (opts.thread && parts.length < 2) problems.push('A thread needs at least two posts.');
    parts.forEach((p, i) => {
      const reserve = (i === parts.length - 1) ? (opts.linkLength || 0) + 2 : 0;
      const len = weightedLength(p);
      if (len + reserve > LIMIT) problems.push(`Post ${i + 1} is ${len} characters; it must be under ${LIMIT - reserve}.`);
      if (/https?:\/\/|www\./i.test(p)) problems.push(`Post ${i + 1} contains a URL. Remove it.`);
      if (/\*\*|^#\s|^- /m.test(p)) problems.push(`Post ${i + 1} contains markdown.`);
    });
    const missing = figuresMissingFrom(out.figuresUsed, opts.source);
    // Figures the model forgot to list are caught too: scan the parts for
    // number-looking tokens and check those as well.
    const scanned = parts.join(' ').match(/\$?\d[\d,]*(?:\.\d+)?%?(?::\d{2})?/g) || [];
    const missing2 = figuresMissingFrom(scanned.map((s) => s.replace(/,/g, '')), String(opts.source).replace(/,/g, ''));
    const allMissing = Array.from(new Set(missing.concat(missing2)));
    if (allMissing.length) problems.push(`These figures are not in the source: ${allMissing.join(', ')}. Use only figures from the source, or describe without a figure.`);

    if (!problems.length) {
      return {
        parts,
        cardTitle: String(out.cardTitle || '').slice(0, 120),
        cardBody: String(out.cardBody || '').slice(0, 260),
        altText: String(out.altText || '').slice(0, 300),
        model: res.model,
        usage: res.usage ? { in: res.usage.input_tokens, out: res.usage.output_tokens } : null
      };
    }
    feedback = problems.join('\n');
    lastErr = new Error('Draft rejected: ' + problems.join(' '));
  }
  throw lastErr || new Error('Drafting failed');
}

module.exports = { draft, figuresMissingFrom, MODEL };
