// Stryker Trading Academy — shared achievement/badge definitions
// Used by: achievements.js (renders the full badge grid, grouped by
// category) and notifications.js (detects newly-earned badges to notify
// about) and profile.js (shows a public-safe subset).
//
// 43 badges across 7 categories. Each has a category (for grouping the
// display) and a color (for the icon circle), so the grid reads as
// organized-but-vibrant rather than a monochrome wall of identical teal
// icons.
//
// `private: true` marks badges that reveal something about trade journal
// activity (frequency, whether trades are winning) — these show on your
// own achievements.html page, but are deliberately excluded from the
// public profile subset in profile.js. Trade counts and win/loss patterns
// feel like more than a casual public-profile stat should reveal, same
// reasoning as why the journal itself is private.
//
// Some checks need the full CHAPTERS array (which level each chapter
// belongs to); others need extra stats not present on the base student
// object (postCount, likesReceived, journalCount, hasWinningTrade) that
// callers pass in only where they've actually computed them — see
// notifications.js and achievements.js for exactly what's supplied where.

const ACHIEVEMENTS = [
  // ---------------- Curriculum ----------------
  { id: 'first-chapter', title: 'First Chapter Complete', desc: 'Finish your first chapter.', category: 'Curriculum', color: '#03c988',
    icon: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/>',
    check: (s, ch) => s.completedChapters.length >= 1 },
  { id: 'chapters-5', title: '5 Chapters Complete', desc: 'Complete any 5 chapters.', category: 'Curriculum', color: '#03c988',
    icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    check: (s) => s.completedChapters.length >= 5 },
  { id: 'chapters-10', title: '10 Chapters Complete', desc: 'Complete any 10 chapters.', category: 'Curriculum', color: '#03c988',
    icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6M9 11h6"/>',
    check: (s) => s.completedChapters.length >= 10 },
  { id: 'halfway-there', title: 'Halfway There', desc: 'Complete 21 of the 42 chapters.', category: 'Curriculum', color: '#03c988',
    icon: '<circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" stroke="none"/>',
    check: (s) => s.completedChapters.length >= 21 },
  { id: 'chapters-30', title: '30 Chapters Complete', desc: 'Complete any 30 chapters.', category: 'Curriculum', color: '#03c988',
    icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    check: (s) => s.completedChapters.length >= 30 },
  { id: 'foundations', title: 'Foundations Complete', desc: 'Complete all Part I foundation chapters.', category: 'Curriculum', color: '#4fe3ac',
    icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    check: (s, ch) => !!ch && ch.filter(c => c.level === 'foundation').every(c => s.completedChapters.includes(c.num)) },
  { id: 'structure-master', title: 'Structure Master', desc: 'Complete all Part II intermediate chapters.', category: 'Curriculum', color: '#4fe3ac',
    icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
    check: (s, ch) => !!ch && ch.filter(c => c.level === 'intermediate').every(c => s.completedChapters.includes(c.num)) },
  { id: 'smt-certified', title: 'SMT Certified', desc: 'Complete all Part III advanced chapters.', category: 'Curriculum', color: '#4fe3ac',
    icon: '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>',
    check: (s, ch) => !!ch && ch.filter(c => c.level === 'advanced').every(c => s.completedChapters.includes(c.num)) },
  { id: 'curriculum-complete', title: 'Curriculum Complete', desc: 'Finish all 42 chapters, start to finish.', category: 'Curriculum', color: '#f5c542',
    icon: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/><circle cx="12" cy="12" r="10"/>',
    check: (s, ch) => !!ch && s.completedChapters.length >= ch.length },

  // ---------------- Lessons ----------------
  { id: 'lessons-10', title: '10 Lessons Logged', desc: 'Complete 10 individual lessons.', category: 'Lessons', color: '#00adb5',
    icon: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    check: (s) => s.completedLessons.length >= 10 },
  { id: 'lessons-25', title: '25 Lessons Logged', desc: 'Complete 25 individual lessons.', category: 'Lessons', color: '#00adb5',
    icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    check: (s) => s.completedLessons.length >= 25 },
  { id: 'lessons-50', title: '50 Lessons Logged', desc: 'Complete 50 individual lessons.', category: 'Lessons', color: '#00adb5',
    icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6M9 11h6"/>',
    check: (s) => s.completedLessons.length >= 50 },
  { id: 'lessons-100', title: '100 Lessons Logged', desc: 'Complete 100 individual lessons.', category: 'Lessons', color: '#38bdf8',
    icon: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/>',
    check: (s) => s.completedLessons.length >= 100 },

  // ---------------- Streaks ----------------
  { id: 'streak-3', title: '3-Day Streak', desc: 'Study on 3 consecutive days.', category: 'Streaks', color: '#f5c542',
    icon: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/>',
    check: (s) => (s.bestStreak || 0) >= 3 },
  { id: 'streak-7', title: '7-Day Streak', desc: 'Study on 7 consecutive days.', category: 'Streaks', color: '#f5c542',
    icon: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/>',
    check: (s) => (s.bestStreak || 0) >= 7 },
  { id: 'streak-14', title: '14-Day Streak', desc: 'Study on 14 consecutive days.', category: 'Streaks', color: '#fb923c',
    icon: '<path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="10"/>',
    check: (s) => (s.bestStreak || 0) >= 14 },
  { id: 'streak-30', title: '30-Day Streak', desc: 'Study on 30 consecutive days.', category: 'Streaks', color: '#fb923c',
    icon: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/><path d="M12 6v6l4 2"/>',
    check: (s) => (s.bestStreak || 0) >= 30 },
  { id: 'streak-60', title: '60-Day Streak', desc: 'Study on 60 consecutive days.', category: 'Streaks', color: '#f87171',
    icon: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    check: (s) => (s.bestStreak || 0) >= 60 },
  { id: 'streak-100', title: '100-Day Streak', desc: 'Study on 100 consecutive days.', category: 'Streaks', color: '#f87171',
    icon: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/><circle cx="12" cy="15" r="2"/>',
    check: (s) => (s.bestStreak || 0) >= 100 },

  // ---------------- Trading Floor community ----------------
  { id: 'first-post', title: 'First Post', desc: 'Post on the Trading Floor for the first time.', category: 'Community', color: '#a78bfa',
    icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    check: (s, ch, extra) => !!extra && (extra.postCount || 0) >= 1 },
  { id: 'posts-5', title: '5 Posts', desc: 'Post 5 times on the Trading Floor.', category: 'Community', color: '#a78bfa',
    icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 12h5"/>',
    check: (s, ch, extra) => !!extra && (extra.postCount || 0) >= 5 },
  { id: 'posts-25', title: '25 Posts', desc: 'Post 25 times on the Trading Floor.', category: 'Community', color: '#a78bfa',
    icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 12h8M8 15h5"/>',
    check: (s, ch, extra) => !!extra && (extra.postCount || 0) >= 25 },
  { id: 'posts-50', title: '50 Posts', desc: 'Post 50 times on the Trading Floor.', category: 'Community', color: '#8b5cf6',
    icon: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    check: (s, ch, extra) => !!extra && (extra.postCount || 0) >= 50 },
  { id: 'first-reply', title: 'First Reply', desc: 'Reply to someone else\'s post.', category: 'Community', color: '#a78bfa',
    icon: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    check: (s, ch, extra) => !!extra && (extra.replyCount || 0) >= 1 },
  { id: 'replies-10', title: '10 Replies', desc: 'Reply to 10 posts.', category: 'Community', color: '#a78bfa',
    icon: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><circle cx="12" cy="11" r="1" fill="currentColor" stroke="none"/>',
    check: (s, ch, extra) => !!extra && (extra.replyCount || 0) >= 10 },
  { id: 'likes-5', title: '5 Likes Received', desc: 'Have your posts liked 5 times in total.', category: 'Community', color: '#f472b6',
    icon: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.6z"/>',
    check: (s, ch, extra) => !!extra && (extra.likesReceived || 0) >= 5 },
  { id: 'likes-25', title: '25 Likes Received', desc: 'Have your posts liked 25 times in total.', category: 'Community', color: '#f472b6',
    icon: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.6z"/>',
    check: (s, ch, extra) => !!extra && (extra.likesReceived || 0) >= 25 },
  { id: 'likes-100', title: '100 Likes Received', desc: 'Have your posts liked 100 times in total.', category: 'Community', color: '#ec4899',
    icon: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/>',
    check: (s, ch, extra) => !!extra && (extra.likesReceived || 0) >= 100 },

  // ---------------- Referrals ----------------
  { id: 'first-referral', title: 'First Referral', desc: 'Earn your first referral points.', category: 'Referrals', color: '#fbbf24',
    icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    check: (s) => (s.referralPoints || 0) >= 10 },
  { id: 'referral-points-100', title: '100 Referral Points', desc: 'Reach 100 total referral points.', category: 'Referrals', color: '#fbbf24',
    icon: '<circle cx="12" cy="8" r="6"/><path d="M9 14l-3 7 6-3 6 3-3-7"/>',
    check: (s) => (s.referralPoints || 0) >= 100 },
  { id: 'referral-points-250', title: '250 Referral Points', desc: 'Reach 250 total referral points.', category: 'Referrals', color: '#f59e0b',
    icon: '<circle cx="12" cy="8" r="6"/><path d="M9 14l-3 7 6-3 6 3-3-7"/>',
    check: (s) => (s.referralPoints || 0) >= 250 },
  { id: 'referral-points-500', title: '500 Referral Points', desc: 'Reach 500 total referral points.', category: 'Referrals', color: '#f59e0b',
    icon: '<path d="M12 2l2.4 7.2H22l-6 4.6 2.3 7.2L12 16.4l-6.3 4.6L8 13.8 2 9.2h7.6z"/>',
    check: (s) => (s.referralPoints || 0) >= 500 },

  // ---------------- Trade Journal (private — see file header) ----------------
  { id: 'first-trade', title: 'First Trade Logged', desc: 'Log your first trade in the journal.', category: 'Trade Journal', color: '#f472b6', private: true,
    icon: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
    check: (s, ch, extra) => !!extra && (extra.journalCount || 0) >= 1 },
  { id: 'trades-10', title: '10 Trades Logged', desc: 'Log 10 trades in the journal.', category: 'Trade Journal', color: '#f472b6', private: true,
    icon: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
    check: (s, ch, extra) => !!extra && (extra.journalCount || 0) >= 10 },
  { id: 'trades-50', title: '50 Trades Logged', desc: 'Log 50 trades in the journal.', category: 'Trade Journal', color: '#ec4899', private: true,
    icon: '<path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.1-3-3L3 17.6"/>',
    check: (s, ch, extra) => !!extra && (extra.journalCount || 0) >= 50 },
  { id: 'trades-100', title: '100 Trades Logged', desc: 'Log 100 trades in the journal.', category: 'Trade Journal', color: '#ec4899', private: true,
    icon: '<path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.1-3-3L3 17.6"/><circle cx="19" cy="8" r="1.5" fill="currentColor" stroke="none"/>',
    check: (s, ch, extra) => !!extra && (extra.journalCount || 0) >= 100 },
  { id: 'first-win', title: 'First Winning Trade', desc: 'Log a trade with a positive result.', category: 'Trade Journal', color: '#f472b6', private: true,
    icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    check: (s, ch, extra) => !!extra && !!extra.hasWinningTrade },

  // ---------------- Profile & Membership ----------------
  { id: 'bio-set', title: 'Told Your Story', desc: 'Add a bio to your profile.', category: 'Profile', color: '#22d3ee',
    icon: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    check: (s) => !!(s.bio && s.bio.trim()) },
  { id: 'avatar-customized', title: 'Made It Yours', desc: 'Upload a custom profile photo or pick a new generated avatar.', category: 'Profile', color: '#22d3ee',
    icon: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>',
    check: (s) => !!(s.customPhotoURL || s.avatarSeed) },
  { id: 'plan-upgraded', title: 'Upgraded', desc: 'Move onto a paid plan.', category: 'Profile', color: '#2dd4bf',
    icon: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/>',
    check: (s) => !!s.plan },
  { id: 'tv-access', title: 'Terminal Linked', desc: 'Get your TradingView indicator access granted.', category: 'Profile', color: '#2dd4bf',
    icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    check: (s) => !!s.tradingViewAccessGranted },
  { id: 'early-adopter', title: 'Early Adopter', desc: 'Joined while Stryker Trading Academy was still in beta.', category: 'Profile', color: '#38bdf8',
    icon: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
    check: () => true },
  { id: 'welcome', title: 'Welcome to the Desk', desc: 'Create your account.', category: 'Profile', color: '#38bdf8',
    icon: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    check: () => true }
];
