// A Firebase stub that answers with plausible content instead of nothing.
//
// scratchpad/stub.js returns an empty snapshot for every read, which is right
// for tests but leaves every gated page rendering an empty shell. For
// screenshots the pages need to look like a real account: a plan, some
// progress, a few rows in each collection. Same shape as stub.js, different
// answers.
function build() {
  const body = function () {
    const UID = 'u1';
    const NOW = Date.now();
    const iso = (dAgo) => new Date(NOW - dAgo * 864e5).toISOString();
    const ts = (dAgo) => ({ toDate: () => new Date(NOW - dAgo * 864e5), seconds: Math.floor((NOW - dAgo * 864e5) / 1000) });

    const DONE_LESSONS = [];
    ['01', '02', '03', '04'].forEach((n) => { for (let i = 0; i < 6; i++) DONE_LESSONS.push(n + '-' + i); });
    ['05', '06'].forEach((n) => { for (let i = 0; i < 3; i++) DONE_LESSONS.push(n + '-' + i); });

    const DATA = {
      students: {
        [UID]: {
          uid: UID, name: 'Test Trader', displayName: 'Test Trader', username: 'testtrader',
          email: 'trader@strykertrading.com', plan: 'Elite', role: 'elite',
          emailVerified: true, createdAt: ts(210), lastSeen: ts(0),
          completedLessons: DONE_LESSONS, completedChapters: ['01', '02', '03', '04'],
          streak: 23, longestStreak: 41, xp: 8420, level: 7,
          onboardingDone: true, tourDone: true,
          achievements: ['first-chapter', 'week-streak', 'first-trade', 'journal-10', 'backtest-1'],
          timezone: 'Asia/Kolkata'
        }
      },
      plans: {
        starter: { name: 'Starter', rank: 0, color: '#8b93a7', price: 2999, chapterLimit: 6 },
        pro: { name: 'Pro', rank: 1, color: '#5ac8fa', price: 6999, chapterLimit: 20 },
        elite: { name: 'Elite', rank: 2, color: '#f5c542', price: 12999, chapterLimit: 0 }
      },
      settings: {
        pageAccess: {},
        branding: { siteName: 'Stryker Trading Academy' },
        maintenance: { enabled: false },
        seo: {}
      }
    };

    const post = (id, uid, name, plan, html, dAgo, likes, replies, category, flair) => ({
      id, authorUid: uid, authorName: name, authorPlan: plan, textHtml: html,
      imageDataUrl: null, category: category || 'general', flair: flair || null,
      likedBy: Array.from({ length: likes }, (_, i) => 'l' + i),
      upvotedBy: Array.from({ length: Math.round(likes * 0.7) }, (_, i) => 'v' + i),
      downvotedBy: [], replyCount: replies, createdAt: ts(dAgo)
    });
    const day = (dAgo) => new Date(NOW - dAgo * 864e5).toISOString().slice(0, 10);

    // Rows for the list-shaped collections. Each page reads whichever of
    // these it cares about; the rest stay empty, which renders as the page's
    // own empty state rather than an error.
    const ROWS = {
      // The indicators collection has no bundled seed — indicators-store.js
      // says so outright: it is filled entirely through the admin editor, so
      // an empty stub leaves the reader showing "no trading indicators found".
      // These five are the shipped showcase entries, reshaped into the record
      // the editor writes, so the page renders what production renders.
      indicators: [
        ['fvg-relay', 1, 'FVG Relay', 'Fair value gaps that chain into delivery',
         'Displacement gaps with consequent-encroachment lines, four mitigation models, and the relay read: the moment a mitigated gap hands price into a fresh one, the chain is counted and flagged.',
         ['Bull & bear FVGs', 'CE lines', '4 mitigation models', 'Relay chains', 'Size filter', 'Alerts'],
         'https://www.tradingview.com/script/Hcuencnm-FVG-Relay-Stryker/'],
        ['ifvg-pro', 2, 'IFVG Pro', 'Broken gaps flip roles — trade the retest',
         'Tracks every gap through its whole life: formed, inverted, retested. Rejections at inverted zones print entry-style signals, with an EMA bias filter and a live respect rate.',
         ['Inversion zones', 'Retest signals', 'Trend bias filter', 'Respect-rate stats', 'Zone retirement', 'Alerts'],
         'https://www.tradingview.com/script/n7Lpx8cB-IFVG-Pro-Stryker/'],
        ['htf-po3-lens', 3, 'HTF PO3 Lens', 'Accumulation · Manipulation · Distribution',
         'The last few higher-timeframe candles projected beside your chart, the live HTF open extended across it, and each candle read as the AMD sequence.',
         ['HTF candles on-chart', 'Live phase readout', 'M / D labels', 'Open line', 'Any timeframe', 'Alerts'],
         'https://www.tradingview.com/script/6A3kytc5-HTF-PO3-Lens-Stryker/'],
        ['smt-divergence-pro', 4, 'SMT Divergence Pro', 'One index runs the high — the other refuses',
         'Plots a correlated symbol over your chart and flags the cracks: swings where one market makes a higher high or lower low and the other does not confirm.',
         ['Any pair', 'Auto swing detection', 'Bull & bear SMT', 'Divergence lines', 'Session filter', 'Alerts'],
         'https://www.tradingview.com/script/UJLd5TSn-SMT-Divergence-Pro-Stryker/'],
        ['liquidity-master', 5, 'Liquidity Master', 'Where the stops pool — and when they get swept',
         'Maps the liquidity on your chart: equal highs and lows, prior-day and session extremes drawn as live pools, each level tracked until price runs it.',
         ['Equal highs & lows', 'PDH / PDL pools', 'Session extremes', 'Sweep flags', 'Live pool tracking', 'Alerts'],
         'https://www.tradingview.com/script/7db99YJA-Liquidity-Master-Stryker/'],
      ].map(([id, order, name, summary, body, chips, tvUrl]) => ({
        id, order, name, summary, status: 'live', tvUrl, minRole: null,
        img: 'assets/images/indicator-' + id + '.png',
        tag: summary,
        body,
        chips,
        bodyHtml: '<p>' + body + '</p>' +
          '<h3>What it draws</h3><ul>' + chips.map((c) => '<li>' + c + '</li>').join('') + '</ul>' +
          '<p>Published as an invite-only script on TradingView. Access is granted to your ' +
          'TradingView username from the Indicators page once your plan covers it.</p>' +
          '<p><a href="' + tvUrl + '">Open ' + name + ' on TradingView</a></p>',
        updatedAt: ts(4)
      })),

      communityPosts: [
        post('c1', 'u9', 'Ravi K.', 'Elite',
          'EURUSD swept the Asia low right on the London open and left a clean 5m FVG behind it. Textbook Silver Bullet window — 2.4R closed. #fvg #silverbullet',
          0, 14, 3, 'general', 'setup'),
        post('c2', 'u4', 'Meera S.', 'Pro',
          'Third green week running the journal properly. The discipline score is the part that actually changed things — I can finally see which rule I break when I am down on the day.',
          0, 31, 7, 'general', null),
        post('c3', 'u7', 'Daniel O.', 'Elite',
          'Reminder that CPI lands in 40 minutes. Prop accounts — check your news rules before you size in. FTMO and Topstep both count it.',
          1, 22, 5, 'propfirm', null),
        post('c4', 'u2', 'Aisha R.', 'Pro',
          'Backtested 60 Judas Swings on GBPUSD this weekend. 41 wins, average 2.1R. Full notes are in my playbook if anyone wants to pull them apart. #judas',
          1, 48, 11, 'general', 'setup'),
        post('c5', 'u5', 'Tom B.', 'Starter',
          'Question for the room: when the daily order block and the 4h order block disagree, which one are you actually trading? I keep taking the 4h and getting run.',
          2, 9, 14, 'general', 'question'),
        post('c6', 'u3', 'Priya N.', 'Elite',
          'Passed the 150K evaluation this morning. Eight weeks, no rule breaches, max drawdown 2.9%. The payout tracker in the journal kept me honest about sizing.',
          2, 67, 19, 'propfirm', null)
      ],
      liveSessions: [
        { id: 'ls1', title: 'London Open Live — Silver Bullet', date: day(-1), time: '12:30', instrument: 'EURUSD',
          description: 'Live markup from the Asia range into the London kill zone.', minRole: 'pro', isLive: false, completed: false },
        { id: 'ls2', title: 'Weekly Market Review', date: day(-4), time: '19:00', instrument: 'Multi-asset',
          description: 'Everything that moved this week and what it sets up for next.', minRole: 'starter', isLive: false, completed: false },
        { id: 'ls3', title: 'Prop Firm Risk Clinic', date: day(-8), time: '18:00', instrument: 'NQ / ES',
          description: 'Sizing, daily loss limits and the news rule, account by account.', minRole: 'elite', isLive: false, completed: false },
        { id: 'ls4', title: 'New York PM Reversal Session', date: day(3), time: '20:00', instrument: 'NAS100',
          description: 'Reading the afternoon reversal off the London high.', minRole: 'pro', isLive: false, completed: true,
          videoId: 'dQw4w9WgXcQ', tradesTotal: 4, tradesWon: 3, tradesLost: 1, riskReward: '2.6R' },
        { id: 'ls5', title: 'Order Blocks From Scratch', date: day(10), time: '18:30', instrument: 'XAUUSD',
          description: 'The two-hour workshop, start to finish.', minRole: 'starter', isLive: false, completed: true,
          videoId: 'dQw4w9WgXcQ', tradesTotal: 3, tradesWon: 2, tradesLost: 1, riskReward: '1.9R' }
      ],
      profiles: [
        { id: UID, uid: UID, name: 'Test Trader', username: 'testtrader', plan: 'Elite', bio: 'ICT/SMT. London and New York sessions. Prop funded since March.', joinedAt: ts(210) },
        { id: 'u9', uid: 'u9', name: 'Ravi K.', username: 'ravik', plan: 'Elite' },
        { id: 'u4', uid: 'u4', name: 'Meera S.', username: 'meeras', plan: 'Pro' }
      ],
      publicStats: [
        { id: 'site', students: 1284, chapters: 24, models: 12, indicators: 9 }
      ],
      trades: [
        { id: 't1', uid: UID, pair: 'EURUSD', side: 'long', model: 'Silver Bullet', session: 'London', entry: 1.0842, exit: 1.0897, rr: 2.4, pnl: 412, result: 'win', risk: 1, at: ts(1), date: iso(1), notes: 'London open sweep of Asia low, FVG entry on the 5m.', tags: ['fvg', 'sweep'] },
        { id: 't2', uid: UID, pair: 'GBPUSD', side: 'short', model: 'Judas Swing', session: 'New York', entry: 1.2711, exit: 1.2663, rr: 3.1, pnl: 528, result: 'win', risk: 1, at: ts(2), date: iso(2), notes: 'NY Judas above the London high, clean displacement down.', tags: ['judas'] },
        { id: 't3', uid: UID, pair: 'XAUUSD', side: 'long', model: 'Power of Three', session: 'New York', entry: 2318.4, exit: 2311.2, rr: -1, pnl: -180, result: 'loss', risk: 1, at: ts(3), date: iso(3), notes: 'Entered before the accumulation finished. Early.', tags: ['po3'] },
        { id: 't4', uid: UID, pair: 'NAS100', side: 'long', model: 'Order Block', session: 'New York', entry: 18412, exit: 18528, rr: 2.9, pnl: 640, result: 'win', risk: 1, at: ts(4), date: iso(4), notes: 'Daily bullish OB respected to the tick.', tags: ['ob'] },
        { id: 't5', uid: UID, pair: 'USDJPY', side: 'short', model: 'Turtle Soup', session: 'Asia', entry: 157.82, exit: 157.44, rr: 1.8, pnl: 296, result: 'win', risk: 1, at: ts(6), date: iso(6), notes: 'Asia range high swept, no follow-through.', tags: ['turtle'] },
        { id: 't6', uid: UID, pair: 'EURUSD', side: 'short', model: 'Silver Bullet', session: 'New York', entry: 1.0908, exit: 1.0908, rr: 0, pnl: 0, result: 'breakeven', risk: 1, at: ts(8), date: iso(8), notes: 'Moved to BE, price came back. Rules followed.', tags: ['fvg'] },
        { id: 't7', uid: UID, pair: 'BTCUSD', side: 'long', model: 'Order Block', session: 'London', entry: 63180, exit: 64020, rr: 2.2, pnl: 388, result: 'win', risk: 1, at: ts(10), date: iso(10), notes: '4h OB plus weekly bullish bias.', tags: ['ob', 'htf'] },
        { id: 't8', uid: UID, pair: 'GBPJPY', side: 'short', model: 'Judas Swing', session: 'London', entry: 200.42, exit: 200.98, rr: -1, pnl: -195, result: 'loss', risk: 1, at: ts(12), date: iso(12), notes: 'News spike ran the stop. Should have stood aside.', tags: ['judas', 'news'] }
      ],
      posts: [
        { id: 'p1', uid: 'u9', author: 'Ravi K.', authorName: 'Ravi K.', plan: 'Elite', role: 'elite', text: 'EURUSD swept the Asia low at the London open and left a clean 5m FVG. Textbook Silver Bullet window.', body: 'EURUSD swept the Asia low at the London open and left a clean 5m FVG. Textbook Silver Bullet window.', at: ts(0), createdAt: ts(0), likes: 14, replies: 3, comments: 3 },
        { id: 'p2', uid: 'u4', author: 'Meera S.', authorName: 'Meera S.', plan: 'Pro', role: 'pro', text: 'Third green week running the journal properly. The discipline score is the part that actually changed things.', body: 'Third green week running the journal properly. The discipline score is the part that actually changed things.', at: ts(0), createdAt: ts(0), likes: 31, replies: 7, comments: 7 },
        { id: 'p3', uid: 'u7', author: 'Daniel O.', authorName: 'Daniel O.', plan: 'Elite', role: 'elite', text: 'Reminder that the CPI print lands in 40 minutes. Prop accounts, check your news rules before you size in.', body: 'Reminder that the CPI print lands in 40 minutes. Prop accounts, check your news rules before you size in.', at: ts(1), createdAt: ts(1), likes: 22, replies: 5, comments: 5 },
        { id: 'p4', uid: 'u2', author: 'Aisha R.', authorName: 'Aisha R.', plan: 'Pro', role: 'pro', text: 'Backtested 60 Judas Swings on GBPUSD this weekend. 41 wins, average 2.1R. Notes are in my playbook.', body: 'Backtested 60 Judas Swings on GBPUSD this weekend. 41 wins, average 2.1R. Notes are in my playbook.', at: ts(1), createdAt: ts(1), likes: 48, replies: 11, comments: 11 }
      ],
      backtests: [
        { id: 'b1', uid: UID, name: 'Silver Bullet — EURUSD 2025', pair: 'EURUSD', model: 'Silver Bullet', trades: 84, wins: 52, winRate: 62, avgR: 1.9, expectancy: 0.74, at: ts(5), createdAt: ts(5) },
        { id: 'b2', uid: UID, name: 'Judas Swing — GBPUSD Q2', pair: 'GBPUSD', model: 'Judas Swing', trades: 61, wins: 34, winRate: 56, avgR: 2.2, expectancy: 0.68, at: ts(11), createdAt: ts(11) },
        { id: 'b3', uid: UID, name: 'Power of Three — Gold', pair: 'XAUUSD', model: 'Power of Three', trades: 47, wins: 24, winRate: 51, avgR: 2.6, expectancy: 0.59, at: ts(19), createdAt: ts(19) }
      ],
      sessions: [
        { id: 's1', title: 'London Open Live — Silver Bullet', host: 'Stryker', at: ts(-1), startsAt: ts(-1), status: 'upcoming', minRole: 'pro', durationMin: 90 },
        { id: 's2', title: 'Weekly Market Review', host: 'Stryker', at: ts(-3), startsAt: ts(-3), status: 'upcoming', minRole: 'starter', durationMin: 60 },
        { id: 's3', title: 'Prop Firm Risk Clinic', host: 'Stryker', at: ts(4), startsAt: ts(4), status: 'past', minRole: 'elite', durationMin: 75 }
      ],
      notifications: [
        { id: 'n1', uid: UID, title: 'New chapter published', body: 'Chapter 12 — Liquidity Runs is live.', at: ts(0), read: false },
        { id: 'n2', uid: UID, title: 'Live session tomorrow', body: 'London Open Live starts 12:30 IST.', at: ts(1), read: false },
        { id: 'n3', uid: UID, title: 'Streak kept', body: '23 days. Keep it going.', at: ts(1), read: true }
      ],
      playbooks: [
        { id: 'pb1', uid: UID, name: 'London Silver Bullet', model: 'Silver Bullet', session: 'London', pairs: ['EURUSD', 'GBPUSD'], rr: 2, trades: 34, winRate: 61, at: ts(7) },
        { id: 'pb2', uid: UID, name: 'NY Judas Reversal', model: 'Judas Swing', session: 'New York', pairs: ['NAS100'], rr: 3, trades: 21, winRate: 57, at: ts(14) }
      ]
    };

    const listSnap = (rows) => ({
      empty: rows.length === 0, size: rows.length,
      docs: rows.map((r) => ({ id: r.id, exists: true, data: () => r })),
      forEach: (fn) => rows.forEach((r) => fn({ id: r.id, exists: true, data: () => r }))
    });

    // The journal's own demo generator builds 120 days of trades with the
    // derived fields already computed. It only exists once journal-demo.js
    // and journal-calc.js have loaded, which is why this is answered lazily
    // at read time rather than baked into ROWS above.
    const rule = (id, text, detail) => ({ id, text, detail });
    const PLAYBOOKS = [
      { id: 'pb-sb', name: 'London Silver Bullet', source: 'model', sourceModelId: 'silver-bullet',
        market: 'EURUSD / GBPUSD', timeframe: '5m', direction: 'both',
        sessions: ['London'], status: 'active', colour: '#03c988', targetRR: 2, maxRiskPct: 1,
        notes: 'Only inside the kill zone, only after a sweep of the Asia range.',
        setups: ['Silver Bullet', 'FVG'],
        rules: [
          rule('r1', 'Asia range is swept before entry', 'One side taken, no close beyond it.'),
          rule('r2', 'Displacement leaves an unfilled FVG', 'Body close through, gap still open.'),
          rule('r3', 'Entry inside the 10:00–11:00 window', 'New York time.'),
          rule('r4', 'Stop beyond the sweep wick', 'Never inside the range.'),
          rule('r5', 'Risk is 1% or less', 'No exceptions after a loss.')
        ], createdAt: ts(96), updatedAt: ts(6) },
      { id: 'pb-ob', name: 'Order Block Continuation', source: 'model', sourceModelId: 'order-block',
        market: 'NQ / ES / XAUUSD', timeframe: '15m', direction: 'both',
        sessions: ['New York AM'], status: 'active', colour: '#5ac8fa', targetRR: 2.5, maxRiskPct: 1,
        notes: 'Higher-timeframe bias first, then the block that caused the move.',
        setups: ['Order Block', 'MSS'],
        rules: [
          rule('o1', 'Daily bias is set before the session', 'Written down, not decided mid-trade.'),
          rule('o2', 'Market structure shifted first', 'A clean break of the last opposing high or low.'),
          rule('o3', 'Block is the last candle before displacement', 'Not any candle in the zone.'),
          rule('o4', 'Target is the next liquidity pool', 'Not a fixed pip count.')
        ], createdAt: ts(74), updatedAt: ts(11) },
      { id: 'pb-js', name: 'Judas Swing Reversal', source: 'own',
        market: 'GBPUSD / NAS100', timeframe: '5m', direction: 'both',
        sessions: ['New York AM'], status: 'testing', colour: '#f5c542', targetRR: 3, maxRiskPct: 0.5,
        notes: 'Still on half risk until 30 logged trades.',
        setups: ['Judas Swing', 'Liquidity Sweep', 'SMT'],
        rules: [
          rule('j1', 'False move takes the session high or low', 'The sweep is the signal.'),
          rule('j2', 'SMT divergence against the correlated pair', 'One makes the high, the other does not.'),
          rule('j3', 'No entry within 15 minutes of high-impact news', 'Check the calendar first.')
        ], createdAt: ts(38), updatedAt: ts(2) }
    ];

    let _journalCache = null;
    function journalRows() {
      if (_journalCache) return _journalCache;
      if (typeof window.jdBuildTrades !== 'function') return [];
      const settings = typeof window.journalDefaultSettings === 'function' ? window.journalDefaultSettings() : { accountBalance: 10000 };
      let trades = [];
      try { trades = window.jdBuildTrades(settings) || []; } catch (e) { return []; }
      // Link each trade to the playbook whose setup it used, and record which
      // of that playbook's rules were ticked. The playbook tab measures a
      // strategy by exactly these two fields, so without them it has nothing
      // to report even with 120 days of trades behind it.
      _journalCache = trades.map((t, i) => {
        const pb = PLAYBOOKS.find((p) => p.setups.indexOf(t.setup) !== -1);
        const row = Object.assign({ id: 'jd' + i }, t);
        if (pb) {
          row.playbookId = pb.id;
          // A trade that broke the plan is the one that skipped a rule.
          const broke = (t.tags || []).indexOf('Plan broken') !== -1 || (t.tags || []).indexOf('Revenge trade') !== -1;
          row.rulesMet = broke ? pb.rules.slice(0, pb.rules.length - 2).map((r) => r.id)
                               : pb.rules.map((r) => r.id);
        }
        return row;
      });
      return _journalCache;
    }

    // Replay/backtesting sessions. The backtesting dashboard reads the cloud
    // copies from students/{uid}/replay, so seeding that collection is what
    // fills the KPIs, the equity curve, the calendar and the coach cards.
    // Deterministic so two runs of the screenshot pass agree.
    let _replayCache = null;
    function replaySessions() {
      if (_replayCache) return _replayCache;
      let seed = 20260919 >>> 0;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const SYMS = [
        { id: 'NQ=F', label: 'NQ · Nasdaq 100 futures', px: 19850, pv: 20, dec: 2, stop: 30 },
        { id: 'ES=F', label: 'ES · S&P 500 futures', px: 5630, pv: 50, dec: 2, stop: 8 },
        { id: 'GC=F', label: 'GC · Gold futures', px: 2495, pv: 100, dec: 1, stop: 6 },
        { id: 'EURUSD=X', label: 'EUR/USD', px: 1.093, pv: 1, dec: 5, stop: 0.0022 }
      ];
      const NAMES = ['Silver Bullet — Sept', 'London Open study', 'Judas Swing reps', 'Gold NY session'];
      const TAGS = ['FVG', 'Order Block', 'Liquidity Sweep', 'MSS', 'Silver Bullet', 'SMT'];
      const MIST = ['Chased entry', 'Moved stop', 'Oversized', 'Traded news'];
      const out = [];
      for (let s = 0; s < 4; s++) {
        const sym = SYMS[s];
        const startMs = NOW - (46 - s * 9) * 864e5;
        const trades = [];
        let bal = 25000, n = 22 + Math.floor(rnd() * 14);
        for (let i = 0; i < n; i++) {
          const buy = rnd() < 0.5;
          const win = rnd() < 0.57;
          const rr = 1.3 + rnd() * 1.9;
          const r = win ? rr : -(0.9 + rnd() * 0.25);
          const entryT = startMs + i * 0.9 * 864e5 + (13 + rnd() * 6) * 36e5;
          const exitT = entryT + (8 + rnd() * 110) * 6e4;
          const entry = +(sym.px * (0.99 + rnd() * 0.02)).toFixed(sym.dec);
          const dir = buy ? 1 : -1;
          const exit = +(entry + dir * sym.stop * r).toFixed(sym.dec);
          const size = sym.id === 'EURUSD=X' ? 100000 : 1 + Math.floor(rnd() * 2);
          const pnl = +((exit - entry) * dir * sym.pv * (sym.id === 'EURUSD=X' ? size : size)).toFixed(2);
          bal += pnl;
          const t = {
            id: 't' + s + '_' + i, posId: 'p' + s + '_' + i,
            side: buy ? 'buy' : 'sell', size, entry, exit, entryT, exitT, pnl, r: +r.toFixed(2),
            reason: win ? 'tp' : (rnd() < 0.8 ? 'sl' : 'manual'),
            mfe: Math.abs(pnl) * (1 + rnd()), mae: Math.abs(pnl) * rnd() * 0.6,
            tags: [TAGS[Math.floor(rnd() * TAGS.length)]],
            mistakes: !win && rnd() < 0.35 ? [MIST[Math.floor(rnd() * MIST.length)]] : [],
            checklist: { done: 4 + Math.floor(rnd() * 2), total: 5 },
            notes: ''
          };
          trades.push(t);
        }
        const wins = trades.filter((t) => t.pnl > 0).length;
        const net = +trades.reduce((a, t) => a + t.pnl, 0).toFixed(2);
        const total = 900 + Math.floor(rnd() * 600);
        out.push({
          id: 'rs' + s, name: NAMES[s], symbolId: sym.id, symbolLabel: sym.label, tf: ['5m', '15m', '1m', '5m'][s],
          startMs, endMs: startMs + 9 * 864e5, cursor: s === 0 ? Math.floor(total * 0.62) : total - 1, total,
          updatedAt: NOW - (4 - s) * 864e5,
          summary: { net, count: trades.length, winRate: Math.round((100 * wins) / trades.length) },
          startBalance: 25000, balance: +bal.toFixed(2), trades
        });
      }
      _replayCache = out;
      return out;
    }

    function rowsFor(path) {
      const key = String(path).split('/').pop();
      if (key === 'journal') return journalRows().slice();
      if (key === 'replay') return replaySessions().slice();
      if (ROWS[key]) return ROWS[key].slice();
      if (DATA[key]) return Object.keys(DATA[key]).map((id) => Object.assign({ id }, DATA[key][id]));
      return [];
    }

    function docRef(path, id) {
      const coll = String(path).split('/').pop();
      let rec = (DATA[coll] && DATA[coll][id]) ||
                (ROWS[coll] || []).find((r) => r.id === id) || null;
      // The prop-firm tracker keeps all three accounts in one reserved
      // document beside the trades, so it is answered from the journal's own
      // demo builder for the same reason journalRows is.
      if (coll === 'journal' && id === '_playbooks') {
        rec = { playbooks: PLAYBOOKS.map((p) => { const c = Object.assign({}, p); delete c.setups; return c; }), updatedAt: ts(2) };
      }
      if (coll === 'journal' && id === '_propfirms' && typeof window.jdBuildFirms === 'function') {
        try { rec = { firms: window.jdBuildFirms() }; } catch (e) { rec = null; }
      }
      if (coll === 'journal' && id !== '_propfirms' && id !== '_settings' && !rec) {
        rec = journalRows().find((r) => r.id === id) || null;
      }
      return {
        id,
        get: () => Promise.resolve({ id, exists: !!rec, data: () => rec || {} }),
        set: () => Promise.resolve(), update: () => Promise.resolve(), delete: () => Promise.resolve(),
        onSnapshot: (cb) => { setTimeout(() => cb({ id, exists: !!rec, data: () => rec || {} }), 10); return () => {}; },
        collection: (sub) => colRef(path + '/' + id + '/' + sub)
      };
    }

    function colRef(path) {
      let rows = rowsFor(path);
      const self = {
        doc: (id) => docRef(path, id || 'auto'),
        get: () => Promise.resolve(listSnap(rows)),
        add: () => Promise.resolve({ id: 'new' }),
        where: () => self, orderBy: () => self, startAfter: () => self,
        limit: (n) => { rows = rows.slice(0, n); return self; },
        onSnapshot: (cb) => { setTimeout(() => cb(listSnap(rows)), 10); return () => {}; }
      };
      return self;
    }

    const user = { uid: UID, email: 'trader@strykertrading.com', displayName: 'Test Trader',
                   emailVerified: true, photoURL: null,
                   getIdTokenResult: () => Promise.resolve({ claims: {} }),
                   getIdToken: () => Promise.resolve('t') };

    window.__stubDb = {
      collection: colRef,
      doc: (p) => { const seg = String(p).split('/'); return docRef(seg.slice(0, -1).join('/'), seg.pop()); },
      batch: () => ({ set(){}, update(){}, delete(){}, commit: () => Promise.resolve() })
    };
    window.db = window.__stubDb;
    window.__stubAuth = {
      currentUser: user,
      onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; },
      setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve()
    };
    window.firebase = {
      apps: [], initializeApp: () => ({}),
      app: () => ({ functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }) }),
      firestore: Object.assign(() => window.__stubDb, {
        FieldValue: { serverTimestamp: () => 'TS', increment: (n) => ({ inc: n }),
                      delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' },
        Timestamp: { now: () => ({ toDate: () => new Date() }), fromDate: (d) => ({ toDate: () => d }) }
      }),
      auth: Object.assign(() => window.__stubAuth, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } } }),
      functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }),
      messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} })
    };
    window.auth = window.__stubAuth;
    window.showToast = () => Promise.resolve();
    try {
      localStorage.setItem('stryker_nav_authed', '1');
      localStorage.setItem('stryker_tour_done', '1');
      localStorage.setItem('stryker_onboarding_done', '1');
    } catch (e) {}
  };
  return '(' + body.toString() + ')()';
}
module.exports = build();
