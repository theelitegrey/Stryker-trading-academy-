// Stryker Trading Academy — the Stryker Team identity
//
// A first-class posting identity that is NOT a Firebase Auth account.
//
// WHY NOT A REAL ACCOUNT. The obvious approach is to register team@stryker as a
// normal user and sign in as it. That means a shared password, credentials sat
// in a Cloud Function for the bot to use, and a real session that could be
// hijacked into full read access over every student record. A synthetic
// identity carries none of that: nobody can log in as Stryker Team, because
// there is nothing to log in to. Authority to post under it comes from being an
// admin, checked server-side in the security rules.
//
// It behaves like a user everywhere it matters — it has a profile, an avatar,
// a role tag, its posts can be liked, replied to and bookmarked — because all
// of that reads from profiles/{uid} and communityPosts, neither of which cares
// whether an Auth record exists behind the uid.
//
// WHAT IT DELIBERATELY CANNOT DO: log in, hold a plan, own progress, receive
// direct messages, or appear in the referral leaderboard. Those are all
// person-shaped and a brand account has no business in them.

var STRYKER_TEAM_UID = 'stryker-team';
var STRYKER_TEAM_NAME = 'Stryker Team';

// Rendered in place of a plan badge. Reusing a plan tag would put the brand
// account into the same visual class as students, which is exactly the
// distinction this identity exists to draw.
var STRYKER_TEAM_TAG = 'OFFICIAL';

function isStrykerTeam(uid) {
  return uid === STRYKER_TEAM_UID;
}

// The profile document the team identity posts behind. Seeded from Appearance
// admin; this is the shape, so the seeder and the readers cannot drift.
function strykerTeamProfile() {
  return {
    uid: STRYKER_TEAM_UID,
    name: STRYKER_TEAM_NAME,
    displayName: STRYKER_TEAM_NAME,
    bio: 'Official announcements, market notes and desk updates.',
    isTeamAccount: true,
    // No plan field. A brand account with a tier would show up in plan
    // filters, upgrade prompts and revenue counts as though it were a paying
    // student, quietly corrupting every one of those numbers.
    avatarUrl: 'assets/images/logo-emblem-sm.png',
    createdAt: null
  };
}


// ---- Per-bot identities ----------------------------------------------------
//
// Each bot posts under its OWN name and avatar, not as Stryker Team.
//
// The first version had every bot post as the shared team account, which
// collapsed a real distinction: three mirrors of three different X accounts
// would have been indistinguishable in the feed, and a student could not tell
// whether a post was an announcement from the academy or a relayed tweet.
//
// Same synthetic-identity approach as the team account — a uid with no Firebase
// Auth record behind it — so a bot still cannot be logged into. The uid is
// derived from the bot's document id, which makes it stable across renames:
// change a bot's display name and its existing posts follow, because they were
// never keyed on the name.

function botUid(botId) {
  return 'bot-' + botId;
}

function isBotUid(uid) {
  return typeof uid === 'string' && uid.indexOf('bot-') === 0;
}

// A bot's one-line bio, in the terms of what it actually does. The mirror
// names the account it relays; the market bots name their job, because
// "Automated feed" tells a student nothing about whether to trust the post.
function botBioFor(bot) {
  var cfg = (bot && bot.config) || {};
  if (cfg.screenName) return 'Automated feed \u00b7 mirrors @' + cfg.screenName;
  if (bot && bot.type === 'market-analyst') return 'Automated desk analysis \u00b7 session briefings';
  if (bot && bot.type === 'setup-scout') return 'Automated setup scanner \u00b7 sweep, MSS and fair value gaps';
  return 'Automated feed';
}

// The profile document a bot posts behind. Written whenever the bot is saved,
// so a renamed bot or a changed avatar updates every post it has ever made
// rather than only future ones.
function botProfile(bot) {
  return {
    uid: botUid(bot.id),
    name: bot.name,
    displayName: bot.name,
    bio: botBioFor(bot),
    isBotAccount: true,
    // resolveAvatarUrl checks customPhotoURL first, so this is the field that
    // actually drives the avatar everywhere it appears.
    customPhotoURL: (bot.config && bot.config.avatarUrl) || null,
    createdAt: null
  };
}
