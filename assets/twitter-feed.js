// Stryker Trading Academy — Twitter/X feed, used in two places on
// trading-floor.html: the sidebar "Live from X" panel, and a paginated
// section inside the "Prop firm feed" tab.
//
// Calls the getTwitterFeed Cloud Function (a separate backend piece, not
// part of this static site's own repo — see the twitter-feed-function
// project for its source and deploy instructions). The function itself
// holds the twitterapi.io key securely and handles caching; this file
// only ever talks to OUR function, never to twitterapi.io directly, so no
// API key is ever present in this file or in the page's source.

const TWITTER_FEED_FUNCTION_URL = 'https://us-central1-strykertrades-e0cd8.cloudfunctions.net/getTwitterFeed';
const PROPFIRM_TWEETS_PAGE_SIZE = 10;

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

// Shared, cached fetch — both the sidebar panel and the Prop Firm Feed
// section need the same data, so this ensures only one actual network
// call happens per page load regardless of how many callers ask for it.
// (The Cloud Function itself also caches server-side, but there's no
// reason for this page to make two client-side requests for identical
// data within the same load either.)
let TWITTER_FEED_PROMISE = null;
function fetchTwitterFeedData(){
  if (TWITTER_FEED_PROMISE) return TWITTER_FEED_PROMISE;

  if (!TWITTER_FEED_FUNCTION_URL || TWITTER_FEED_FUNCTION_URL === 'REPLACE_WITH_DEPLOYED_FUNCTION_URL') {
    TWITTER_FEED_PROMISE = Promise.resolve({ tweets: [] });
    return TWITTER_FEED_PROMISE;
  }

  TWITTER_FEED_PROMISE = fetch(TWITTER_FEED_FUNCTION_URL)
    .then((res) => res.json())
    .catch((err) => {
      console.error('Stryker: failed to load Twitter feed', err);
      return { tweets: [], error: true };
    });
  return TWITTER_FEED_PROMISE;
}

function loadTwitterFeed(){
  const target = document.getElementById('twitter-feed-target');
  if (!target) return;

  fetchTwitterFeedData().then((data) => {
    const tweets = data.tweets || [];
    if (!tweets.length) {
      target.innerHTML = '<p style="font-size:13px; color:var(--ink-3); text-align:center; padding:20px 8px;">' +
        (data.error ? 'Couldn\'t load the feed right now.' : (data.message || 'No posts to show right now.')) + '</p>';
      return;
    }
    target.innerHTML = tweets.map(renderTweetCard).join('');
  });
}

// Prop Firm Feed section — same data as the sidebar, rendered into a
// different target with pagination (10 at a time, "Load more" for the
// rest). Only fetches once per page load, on first switch to that tab —
// see the category-tab handler in community.js.
let PROPFIRM_TWEETS_CACHE = [];
let PROPFIRM_TWEETS_SHOWN = 0;
let PROPFIRM_TWEETS_LOADED = false;

function renderPropFirmTweetsPage(){
  const target = document.getElementById('floor-propfirm-tweets-target');
  const loadMoreBtn = document.getElementById('floor-propfirm-load-more');
  if (!target) return;

  const visible = PROPFIRM_TWEETS_CACHE.slice(0, PROPFIRM_TWEETS_SHOWN);
  target.innerHTML = visible.map(renderTweetCard).join('');

  if (loadMoreBtn) {
    loadMoreBtn.style.display = PROPFIRM_TWEETS_SHOWN < PROPFIRM_TWEETS_CACHE.length ? 'block' : 'none';
  }
}

function loadPropFirmTweets(){
  const panel = document.getElementById('floor-propfirm-tweets-panel');
  const target = document.getElementById('floor-propfirm-tweets-target');
  if (!panel || !target) return;

  if (PROPFIRM_TWEETS_LOADED) return; // already fetched this page load — the tab toggle just re-shows the panel, no need to re-fetch

  fetchTwitterFeedData().then((data) => {
    PROPFIRM_TWEETS_LOADED = true;
    PROPFIRM_TWEETS_CACHE = data.tweets || [];
    if (!PROPFIRM_TWEETS_CACHE.length) {
      panel.style.display = 'none'; // nothing to show — don't leave an empty "From X" panel sitting above the posts
      return;
    }
    PROPFIRM_TWEETS_SHOWN = Math.min(PROPFIRM_TWEETS_PAGE_SIZE, PROPFIRM_TWEETS_CACHE.length);
    renderPropFirmTweetsPage();
  });
}
window.loadPropFirmTweets = loadPropFirmTweets;

document.addEventListener('DOMContentLoaded', () => {
  loadTwitterFeed();
  const loadMoreBtn = document.getElementById('floor-propfirm-load-more');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      PROPFIRM_TWEETS_SHOWN = Math.min(PROPFIRM_TWEETS_SHOWN + PROPFIRM_TWEETS_PAGE_SIZE, PROPFIRM_TWEETS_CACHE.length);
      renderPropFirmTweetsPage();
    });
  }
});
