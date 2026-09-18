/**
 * Buffer as the publisher. One API key, and Buffer holds the connections
 * to X, Instagram, Threads and YouTube (its own app approvals cover them),
 * so no developer apps are needed on any platform.
 *
 * GraphQL at https://api.buffer.com, `Authorization: Bearer <key>`.
 * Media is passed as a public URL (this server's /media path); Buffer has
 * no upload endpoint. Each network takes its own `metadata`: an X thread,
 * an Instagram reel, a YouTube title. Responses are union types: success is
 * `PostActionSuccess { post { id } }`, failure `MutationError { message }`,
 * both under HTTP 200.
 *
 * Request budget: one createPost per platform per post, plus one channels
 * query a day. At the default pacing that is well under 500 a month.
 */
const { env } = require('../config');
const db = require('../db');
const log = require('../log');

const API = 'https://api.buffer.com';
const SERVICE_TO_PLATFORM = { twitter: 'x', x: 'x', instagram: 'instagram', threads: 'threads', youtube: 'youtube' };

function token() { return env.buffer && env.buffer.token; }

async function gql(query, variables) {
  if (!token()) throw new Error('Buffer API key not set');
  const res = await fetch(API, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token() },
    body: JSON.stringify({ query, variables: variables || {} })
  });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch (e) { throw new Error('Buffer ' + res.status + ': ' + text.slice(0, 200)); }
  if (!res.ok) throw new Error('Buffer ' + res.status + ': ' + (j.errors ? j.errors.map((e) => e.message).join('; ') : text.slice(0, 200)));
  if (j.errors && j.errors.length) throw new Error('Buffer: ' + j.errors.map((e) => e.message).join('; '));
  return j.data;
}

async function organizationId() {
  const cached = db.kvGet('bufferOrg', null);
  if (cached) return cached;
  const d = await gql('query { account { organizations { id name } } }');
  const org = (((d || {}).account || {}).organizations || [])[0];
  if (!org) throw new Error('Buffer account has no organization');
  db.kvSet('bufferOrg', org.id);
  return org.id;
}

/** Channels in the Buffer account, mapped to this platform's names. Cached for a day. */
async function channels(force) {
  const c = db.kvGet('bufferChannels', null);
  if (c && !force && Date.now() - c.at < 86400000) return c.list;
  const d = await gql('query GetChannels($organizationId: OrganizationId!) { channels(organizationId: $organizationId) { id name service displayName isDisconnected } }',
    { organizationId: await organizationId() });
  const list = ((d || {}).channels || []).map((ch) => ({ id: ch.id, name: ch.displayName || ch.name, service: ch.service, platform: SERVICE_TO_PLATFORM[String(ch.service || '').toLowerCase()] || null, disconnected: !!ch.isDisconnected }));
  db.kvSet('bufferChannels', { at: Date.now(), list });
  return list;
}

/** The channel to use for a platform: the admin's pick in settings, else the first matching one. */
async function channelFor(platform, s) {
  const list = await channels();
  const picked = ((s.buffer || {}).channels || {})[platform];
  const ch = (picked && list.find((c) => c.id === picked)) || list.find((c) => c.platform === platform && !c.disconnected);
  if (!ch) throw new Error('No ' + platform + ' channel connected in Buffer');
  if (ch.disconnected) throw new Error('The ' + platform + ' channel in Buffer is disconnected; reconnect it at buffer.com');
  return ch;
}

const MUTATION = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id dueAt } }
    ... on MutationError { message }
  }
}`;

/**
 * Creates one post on one channel. `parts` is the text (array for a thread).
 * media: { videoUrl?, imageUrl?, title?, altText? }
 */
async function createPost({ channel, platform, parts, media, dueAtMs }) {
  const text = parts[0];
  const input = { channelId: channel.id, text, schedulingType: 'automatic' };
  if (dueAtMs && dueAtMs > Date.now() + 60000) { input.mode = 'customScheduled'; input.dueAt = new Date(dueAtMs).toISOString(); }
  else input.mode = 'shareNow';
  if (media.videoUrl) input.assets = [{ video: { url: media.videoUrl } }];
  else if (media.imageUrl) input.assets = [{ image: { url: media.imageUrl, altText: media.altText || undefined } }];

  const metadata = {};
  const rest = parts.slice(1).map((t) => ({ text: t }));
  if (platform === 'x') metadata.twitter = rest.length ? { thread: rest } : {};
  if (platform === 'threads') metadata.threads = rest.length ? { thread: rest } : {};
  if (platform === 'instagram') metadata.instagram = media.videoUrl ? { type: 'reel', shouldShareToFeed: true } : { type: 'post' };
  if (platform === 'youtube') metadata.youtube = { title: String(media.title || text).slice(0, 100), privacy: 'public', madeForKids: false, notifySubscribers: true };
  if (Object.keys(metadata).length) input.metadata = metadata;

  const d = await gql(MUTATION, { input });
  const r = (d || {}).createPost || {};
  if (r.message && !r.post) throw new Error('Buffer rejected the post: ' + r.message);
  if (!r.post || !r.post.id) throw new Error('Buffer returned no post id: ' + JSON.stringify(r).slice(0, 200));
  return { id: r.post.id, url: 'https://publish.buffer.com/post/' + r.post.id, via: 'buffer' };
}

async function whoAmI() {
  const d = await gql('query { account { email organizations { id name } } }');
  const list = await channels(true);
  return { email: (d.account || {}).email, channels: list.map((c) => `${c.platform || c.service}: ${c.name}${c.disconnected ? ' (disconnected)' : ''}`) };
}

module.exports = { createPost, channels, channelFor, whoAmI, gql };
