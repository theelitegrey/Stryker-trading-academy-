/** Timestamped console logging plus a ring of recent lines for the admin page. */
const RING = [];
const MAX = 400;

function line(level, args) {
  const msg = args.map((a) => (a instanceof Error ? (a.stack || a.message) : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const s = `${new Date().toISOString()} ${level} ${msg}`;
  RING.push(s);
  if (RING.length > MAX) RING.shift();
  (level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log)(s);
}

module.exports = {
  info: (...a) => line('INFO', a),
  warn: (...a) => line('WARN', a),
  error: (...a) => line('ERROR', a),
  recent: (n) => RING.slice(-(n || 200))
};
