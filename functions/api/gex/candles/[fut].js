import { yahooCandles, json, FUTURES } from '../_engine.js';

export async function onRequestGet({ request, params }) {
  const fut = String(params.fut || '').toUpperCase();
  if (!FUTURES[fut]) return json({ error: 'unknown futures symbol' }, { status: 404, cache: 'no-store' });
  const url = new URL(request.url);
  const interval = url.searchParams.get('interval') || '5m';
  try {
    return json(await yahooCandles(fut, interval));
  } catch (error) {
    return json({ error: error.message || String(error) }, { status: 500, cache: 'no-store' });
  }
}
