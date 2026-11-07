// Pure push rules for onNotificationCreated (accountAdmin.js). No Firebase imports, so
// tools/tests/push-rules-test.js can run them in plain node.
//
// PRUNE RULE (Owner bug 2026-11-07, "alerts don't pop up on the phone"): only the two FCM codes that
// mean the token itself is dead delete it. 'messaging/invalid-argument' is NOT one of them: FCM
// answers it for a bad PAYLOAD (our bug), and pruning on it would silently unregister every device
// the moment one message is malformed.

const DEAD_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
]);
const ALERT_TYPES = new Set(['chart_alert', 'zoro_alert', 'dp_alert', 'test']);
const TEST_MAX_PER_HOUR = 3;

function errCode(reason) {
  return (reason && ((reason.errorInfo && reason.errorInfo.code) || reason.code)) || 'unknown';
}
function isDeadToken(code) { return DEAD_CODES.has(code); }

// Data-only web push. Chrome on Android: the `Urgency: high` header is what makes FCM deliver a web
// push at high priority through Doze (android.priority only applies to native Android apps, not to
// webpush targets). TTL keeps it queued for a phone that is off for a while.
function buildMessage(n, id) {
  const link = String(n.link || 'dashboard-user.html').replace(/^\/+/, '');
  const type = String(n.type || 'stryker');
  return {
    data: {
      title: type === 'test' ? 'TradeZoro test' : 'TradeZoro',
      body: String(n.message || 'You have a new notification').slice(0, 240),
      link: '/' + link,
      type: type,
      nid: String(id || ''),
      ts: String(Date.now())
    },
    webpush: {
      headers: { Urgency: 'high', TTL: '86400' },
      fcmOptions: { link: 'https://tradezoro.com/' + link }
    }
  };
}

// results: Promise.allSettled output, same order as tokens.
function summarize(tokens, results) {
  const out = { sent: 0, tokens: tokens.length, pruned: [], failed: [], log: [] };
  results.forEach((r, i) => {
    const tail = String(tokens[i]).slice(-6);    // never log a whole token
    if (r.status === 'fulfilled') { out.sent++; out.log.push(tail + ':ok'); return; }
    const code = errCode(r.reason);
    out.log.push(tail + ':' + code);
    if (isDeadToken(code)) out.pruned.push(tokens[i]);
    else out.failed.push(code);
  });
  out.status = out.sent ? 'sent' : (tokens.length ? 'failed' : 'no-device');
  return out;
}

// Test-notification rate limit: state = { start: ms, count: n } (or null). Returns { ok, state }.
function testAllowed(state, now) {
  if (!state || !(now - state.start < 3600000)) return { ok: true, state: { start: now, count: 1 } };
  if (state.count >= TEST_MAX_PER_HOUR) return { ok: false, state };
  return { ok: true, state: { start: state.start, count: state.count + 1 } };
}

module.exports = { DEAD_CODES, ALERT_TYPES, TEST_MAX_PER_HOUR, errCode, isDeadToken, buildMessage, summarize, testAllowed };
