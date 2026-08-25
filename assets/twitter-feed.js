// Stryker Trading Academy — Trading Floor "Live from X" panel
// Depends on: nothing else site-specific — just fetch(), used only on trading-floor.html.
//
// Calls the getTwitterFeed Cloud Function (a separate backend piece, not
// part of this static site's own repo — see the twitter-feed-function
// project for its source and deploy instructions). The function itself
// holds the twitterapi.io key securely and handles caching; this file
// only ever talks to OUR function, never to twitterapi.io directly, so no
// API key is ever present in this file or in the page's source.

// TODO: replace with the real URL once the Cloud Function is deployed —
// see twitter-feed-function/README.md step 5. Until this is filled in,
// the panel shows its placeholder message and never attempts a fetch.
const TWITTER_FEED_FUNCTION_URL = 'REPLACE_WITH_DEPLOYED_FUNCTION_URL';

function escapeTweetText(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tweetTimeAgo(iso){
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderTweetCard(tweet){
  const author = tweet.author || {};
  const name = escapeTweetText(author.name || 'Trader');
  const handle = escapeTweetText(author.userName || '');
  const avatarUrl = author.profilePicture || '';
  const when = tweetTimeAgo(tweet.createdAt);
  const tweetUrl = tweet.url || ('https://x.com/' + encodeURIComponent(author.userName || '') + '/status/' + encodeURIComponent(tweet.id || ''));

  const avatarHtml = avatarUrl
    ? '<img src="' + avatarUrl + '" alt="' + name + '" loading="lazy" style="width:32px; height:32px; border-radius:50%; flex-shrink:0; object-fit:cover; background:var(--bg-3,#1e1e22);" onerror="this.style.visibility=\'hidden\';">'
    : '<div style="width:32px; height:32px; border-radius:50%; flex-shrink:0; background:var(--bg-3);"></div>';

  return (
    '<a href="' + tweetUrl + '" target="_blank" rel="noopener noreferrer" style="display:block; text-decoration:none; color:inherit; padding:12px 0; border-bottom:1px solid var(--line-soft);">' +
      '<div style="display:flex; gap:9px; align-items:flex-start;">' +
        avatarHtml +
        '<div style="min-width:0; flex:1;">' +
          '<div style="display:flex; align-items:baseline; gap:5px; flex-wrap:wrap;">' +
            '<span style="font-size:12.5px; font-weight:600; color:var(--ink-0);">' + name + '</span>' +
            '<span style="font-size:11.5px; color:var(--ink-3);">@' + handle + ' · ' + when + '</span>' +
          '</div>' +
          '<p style="font-size:12.5px; color:var(--ink-1); line-height:1.45; margin:4px 0 0;">' + escapeTweetText(tweet.text) + '</p>' +
        '</div>' +
      '</div>' +
    '</a>'
  );
}

function loadTwitterFeed(){
  const target = document.getElementById('twitter-feed-target');
  if (!target) return;

  if (!TWITTER_FEED_FUNCTION_URL || TWITTER_FEED_FUNCTION_URL === 'REPLACE_WITH_DEPLOYED_FUNCTION_URL') {
    return; // Leave the static placeholder message in place — no point failing a fetch to a URL that doesn't exist yet.
  }

  fetch(TWITTER_FEED_FUNCTION_URL)
    .then((res) => res.json())
    .then((data) => {
      const tweets = data.tweets || [];
      if (!tweets.length) {
        target.innerHTML = '<p style="font-size:13px; color:var(--ink-3); text-align:center; padding:20px 8px;">' +
          (data.message || 'No posts to show right now.') + '</p>';
        return;
      }
      target.innerHTML = tweets.map(renderTweetCard).join('');
    })
    .catch((err) => {
      console.error('Stryker: failed to load Twitter feed', err);
      target.innerHTML = '<p style="font-size:13px; color:var(--ink-3); text-align:center; padding:20px 8px;">Couldn\'t load the feed right now.</p>';
    });
}

document.addEventListener('DOMContentLoaded', loadTwitterFeed);
