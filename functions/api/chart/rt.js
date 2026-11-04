// GET /api/chart/rt — "may this caller have real-time CME futures data?" Answers {admin:boolean}
// from a VERIFIED Firebase ID token (Authorization: Bearer) + the admins/{uid} document
// (functions/api/chart/_rt.js). Used by the Charts page only to choose the UI (green Real-time dot,
// open the stream); the data endpoints enforce the same rule themselves.
// Since 2026-11-04 (data plans) it also answers l2: may this caller have the LIVE order book (isL2Token)? UI hint only:
// the book-recorder's /ts-live checks the same rule itself.
import { isRealtimeToken, isL2Token, bearerOf } from './_rt.js';

export async function onRequestGet(ctx) {
  const tok = bearerOf(ctx.request);
  const admin = await isRealtimeToken(tok), l2 = admin ? await isL2Token(tok) : false;   // L2 includes L1, so no L1 = no L2
  return new Response(JSON.stringify({ admin, l2 }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'vary': 'Authorization' } });
}
