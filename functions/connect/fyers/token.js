// Fyers OAuth token swap (v3 validate-authcode). Fyers has NO view-only scope for a third-party app token, so the browser code only calls the market-data allow-list in assets/byo-core.js.
// Env (Pages secrets): FYERS_CLIENT_ID (app id), FYERS_CLIENT_SECRET (app secret). appIdHash = sha256("app_id:app_secret") is computed HERE only; the secret never leaves this function.
// The token ends daily at 6:30 AM IST. Refresh needs the member's PIN, so there is no refresh: the member reconnects (any refresh_token in Fyers' reply is dropped).
import { makeHandler } from '../_token.js';
const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
export const handle = makeHandler({ name: 'fyers', label: 'Fyers', idVar: 'FYERS_CLIENT_ID', secretVar: 'FYERS_CLIENT_SECRET', redirect: 'https://tradezoro.com/connect/fyers/callback',
  upstream: 'https://api-t1.fyers.in/api/v3/validate-authcode', as: 'json', refresh: false,
  build: async (q, env) => ({ grant_type: 'authorization_code', appIdHash: await hex(env.FYERS_CLIENT_ID + ':' + env.FYERS_CLIENT_SECRET), code: q.code }) });
export const onRequest = ({ request, env }) => handle(request, env);
