// Upstox OAuth token swap. Upstox has NO view-only scope: the token could trade, so the browser code only ever calls the market-data allow-list in assets/byo-core.js.
// Env (Pages secrets): UPSTOX_CLIENT_ID (API key), UPSTOX_CLIENT_SECRET. No refresh: the token ends about 3:30 AM IST next day (member reconnects).
// Upstox also returns the member's profile and an extended_token: both are dropped by the shared trimmed reply (only access_token goes back). See ../_token.js.
import { makeHandler } from '../_token.js';
export const handle = makeHandler({ name: 'upstox', label: 'Upstox', idVar: 'UPSTOX_CLIENT_ID', secretVar: 'UPSTOX_CLIENT_SECRET', redirect: 'https://tradezoro.com/connect/upstox/callback', upstream: 'https://api.upstox.com/v2/login/authorization/token', as: 'form', refresh: false });
export const onRequest = ({ request, env }) => handle(request, env);
