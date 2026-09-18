/**
 * Publishing one post to one platform. Every platform gets the same media
 * (the video, or the card) with its own text and its own UTM link.
 *
 * Links:
 *   x          per settings.xLinkPolicy ('all' | 'brief' | 'none'); on the
 *              last post of a thread. X charges more for posts with links.
 *   threads    appended to the text.
 *   instagram  none (not clickable); the caption says "link in bio".
 *   youtube    in the description; "#Shorts" added to the title.
 */
const fs = require('fs');
const path = require('path');
const { env } = require('../config');
const { utmLink } = require('../util');
const X = require('./x');
const Meta = require('./meta');
const YT = require('./youtube');

function xCreds() { return { apiKey: env.x.apiKey, apiSecret: env.x.apiSecret, accessToken: env.x.accessToken, accessSecret: env.x.accessSecret }; }

/** Which platforms have credentials on this server. */
function configured() {
  return {
    x: !!(env.x.apiKey && env.x.apiSecret && env.x.accessToken && env.x.accessSecret),
    threads: !!(env.meta.threadsUserId && env.meta.threadsAccessToken),
    instagram: !!(env.meta.igUserId && env.meta.igAccessToken),
    youtube: !!(env.youtube.clientId && env.youtube.clientSecret && env.youtube.refreshToken)
  };
}

function xWantsLink(post, s) {
  if (!post.linkPath) return false;
  if (s.xLinkPolicy === 'all') return true;
  if (s.xLinkPolicy === 'brief') return post.kind === 'brief';
  return false;
}

function mediaUrl(rel) { return env.publicBaseUrl + '/' + rel; }
function mediaPath(rel) { return path.join(env.dataDir, rel); }

/**
 * @returns {Promise<{id, url}>}
 */
async function publish(platform, post, s) {
  const d = post.drafts || {};
  const m = post.media || {};
  const link = (src) => (post.linkPath ? utmLink(env.siteUrl, post.linkPath, src, post.campaign || post.kind) : null);
  const video = post.video && m.video && fs.existsSync(mediaPath(m.video)) ? m.video : null;
  const cardJpg = m.cardJpg && fs.existsSync(mediaPath(m.cardJpg)) ? m.cardJpg : null;
  const cardPng = m.cardPng && fs.existsSync(mediaPath(m.cardPng)) ? m.cardPng : null;

  if (platform === 'x') {
    const parts = (d.x || []).slice();
    if (!parts.length) throw new Error('No X text');
    if (xWantsLink(post, s)) parts[parts.length - 1] += '\n\n' + link('x');
    const c = xCreds(); let mediaIds;
    try {
      if (video) mediaIds = [await X.uploadVideo(c, fs.readFileSync(mediaPath(video)), d.altText || post.title)];
      else if (s.cards && cardPng) mediaIds = [await X.uploadPng(c, fs.readFileSync(mediaPath(cardPng)), d.altText || post.title)];
    } catch (e) { /* text-only is a lesser failure than no post */ }
    const ids = await X.postThread(c, parts, { mediaIds });
    return { id: ids[0], ids, url: `https://x.com/${env.x.handle || 'i'}/status/${ids[0]}` };
  }

  if (platform === 'threads') {
    let text = d.threads || (d.x || [])[0] || '';
    const l = link('threads');
    if (l && (text.length + l.length + 2) <= 500) text += '\n\n' + l;
    return Meta.threadsPublish({ text, videoUrl: video ? mediaUrl(video) : null, imageUrl: !video && s.cards && cardJpg ? mediaUrl(cardJpg) : null });
  }

  if (platform === 'instagram') {
    const caption = d.instagram || d.threads || '';
    if (video) return Meta.igPublish({ caption, videoUrl: mediaUrl(video), coverUrl: m.poster ? mediaUrl(m.poster) : null });
    if (cardJpg) return Meta.igPublish({ caption, imageUrl: mediaUrl(cardJpg) });
    throw new Error('Instagram needs a video or a card');
  }

  if (platform === 'youtube') {
    if (!video) throw new Error('YouTube needs a video');
    const y = d.youtube || {};
    const title = ((y.title || post.title || 'Stryker Trading Academy').slice(0, 90) + ' #Shorts');
    const desc = [y.description || '', link('youtube') || '', '', 'Stryker Trading Academy — ICT and smart-money trading education.', 'Not financial advice.'].filter((x) => x !== null).join('\n');
    return YT.upload({ file: mediaPath(video), title, description: desc, tags: (y.tags || []).concat(['trading', 'Stryker Trading Academy']) });
  }
  throw new Error('Unknown platform ' + platform);
}

async function test(platform) {
  if (platform === 'x') return X.whoAmI(xCreds());
  if (platform === 'threads') return Meta.threadsWhoAmI();
  if (platform === 'instagram') return Meta.igWhoAmI();
  if (platform === 'youtube') return YT.whoAmI();
  throw new Error('Unknown platform ' + platform);
}

module.exports = { publish, test, configured, xWantsLink };
