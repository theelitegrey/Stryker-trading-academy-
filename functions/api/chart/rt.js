// GET /api/chart/rt — "may this caller have real-time CME futures data?" Answers {admin:boolean}
// from a VERIFIED Firebase ID token (Authorization: Bearer) + the admins/{uid} document
// (functions/api/chart/_rt.js). Used by the Charts page only to choose the UI (green Real-time dot,
// open the stream); the data endpoints enforce the same rule themselves.
import { isRealtimeToken, isLiveDataToken, bearerOf } from './_rt.js';

export async function onRequestGet(ctx) {
  const tok = bearerOf(ctx.request);
  const admin = await isRealtimeToken(tok);
  // l2 (2026-11-13, all tools free): this member also has the LIVE futures order book (the paid data feed). UI hint only; the
  // recorder's /ts-live, /ts-book-history and /ts-aux enforce it themselves (src/ts-access.js).
  const l2 = !!tok && (await isLiveDataToken(tok));
  return new Response(JSON.stringify({ admin, l2 }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'vary': 'Authorization' } });
}
