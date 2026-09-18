/**
 * Entry point.
 *   node src/index.js          start the admin server and the scheduler loop
 *   node src/index.js --once   run one tick and exit (cron-style)
 */
const { env } = require('./config');
const db = require('./db');
const log = require('./log');
const scheduler = require('./scheduler');

db.get();

if (process.argv.includes('--once')) {
  scheduler.tick('cli').then((r) => { log.info('tick done', r); process.exit(0); }).catch((e) => { log.error(e); process.exit(1); });
} else {
  if (!env.adminPassword) log.warn('ADMIN_PASSWORD is empty: the admin page will refuse every login until it is set.');
  require('./admin/server').start();
  const loop = async () => {
    try { await scheduler.tick('schedule'); } catch (e) { log.error('tick threw:', e); }
    const minutes = Math.max(1, Number(db.settings().tickMinutes) || 10);
    setTimeout(loop, minutes * 60000);
  };
  setTimeout(loop, 5000);
}
