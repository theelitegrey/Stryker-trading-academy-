// GET /api/chart/rt — "may this caller have real-time CME futures data?" Answers {admin:boolean}
// from a VERIFIED Firebase ID token (Authorization: Bearer) + the admins/{uid} document
// (functions/api/chart/_rt.js). Used by the Charts page only to choose the UI (green Real-time dot,
// open the stream); the data endpoints enforce the same rule themselves.
import { isRealtimeToken, bearerOf } from './_rt.js';

export async function onRequestGet(ctx) {
  const admin = await isRealtimeToken(bearerOf(ctx.request));
  return new Response(JSON.stringify({ admin }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'vary': 'Authorization' } });
}
