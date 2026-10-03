import { buildLevels, json, MARKETS } from '../_engine.js';

export async function onRequestGet({ request, params }) {
  const name = String(params.name || '').toUpperCase();
  if (!MARKETS[name]) return json({ error: 'unknown market' }, { status: 404, cache: 'no-store' });
  const url = new URL(request.url);
  const dte = Number(url.searchParams.get('dte') || 1);
  try {
    return json(await buildLevels(name, dte));
  } catch (error) {
    return json({ error: error.message || String(error) }, { status: 500, cache: 'no-store' });
  }
}
