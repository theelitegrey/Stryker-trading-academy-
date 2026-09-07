/**
 * Stryker Trading Academy — daily USD→INR market rate
 *
 * Replaces the manually-set conversion rate: once a day this fetches the
 * live USDINR rate and writes it to settings/commerce.usdInr — the one doc
 * every consumer already reads (assets/plan-price.js for display,
 * razorpay.js for one-time charges, razorpaySubs.js for new mandates), so
 * price shown and price charged keep agreeing with no other change.
 *
 * SOURCES, keyless both: Yahoo Finance's chart API for INR=X (the same
 * endpoint the market bots already rely on), with open.er-api.com as the
 * fallback. A fetched value outside sane bounds (40–200 ₹/$) is treated as
 * a bad read and DISCARDED — the previous day's stored rate keeps applying,
 * because charging someone at a glitched rate is far worse than charging at
 * yesterday's.
 *
 * DEPLOY (name every function or the others get deleted):
 *   firebase deploy --only functions:refreshFxRate
 *
 * The schedule fires within 24h of deploy; until the first run the rate
 * already stored in settings/commerce (or the built-in ₹88 fallback)
 * applies. Cloud Console → Cloud Scheduler → "Force run" triggers it
 * immediately after deploying, if you don't want to wait.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const BOUNDS = { min: 40, max: 200 };
const UA = { 'User-Agent': 'StrykerTradingAcademy/1.0 (+https://strykertrading.com)' };

function sane(n){
  return typeof n === 'number' && isFinite(n) && n >= BOUNDS.min && n <= BOUNDS.max;
}

async function fetchYahoo(){
  const res = await fetch(
    'https://query1.finance.yahoo.com/v8/finance/chart/INR=X?interval=1d&range=1d',
    { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('Yahoo returned ' + res.status);
  const json = await res.json();
  const meta = json && json.chart && json.chart.result && json.chart.result[0] &&
               json.chart.result[0].meta;
  const rate = meta && meta.regularMarketPrice;
  if (!sane(rate)) throw new Error('Yahoo rate out of bounds: ' + rate);
  return { rate, source: 'yahoo:INR=X' };
}

async function fetchErApi(){
  const res = await fetch('https://open.er-api.com/v6/latest/USD',
    { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('er-api returned ' + res.status);
  const json = await res.json();
  const rate = json && json.rates && json.rates.INR;
  if (!sane(rate)) throw new Error('er-api rate out of bounds: ' + rate);
  return { rate, source: 'open.er-api.com' };
}

exports.refreshFxRate = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .pubsub.schedule('every 24 hours')
  .timeZone('UTC')
  .onRun(async () => {
    let result = null;
    try {
      result = await fetchYahoo();
    } catch (err) {
      console.warn('refreshFxRate: Yahoo failed (' + err.message + '), trying fallback');
      try {
        result = await fetchErApi();
      } catch (err2) {
        console.error('refreshFxRate: all sources failed — keeping the stored rate.',
          err.message, '|', err2.message);
        return null;   // yesterday's rate keeps applying
      }
    }

    const rate = Math.round(result.rate * 100) / 100;
    await db.collection('settings').doc('commerce').set({
      usdInr: rate,
      usdInrSource: result.source,
      usdInrUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log('refreshFxRate: 1 USD = ₹' + rate + ' (' + result.source + ')');
    return null;
  });

// Exported for tests.
exports.__internals = { sane, BOUNDS };
