// Alpaca OAuth token swap (scope "data" only). Env (Pages secrets): ALPACA_CLIENT_ID, ALPACA_CLIENT_SECRET. Alpaca tokens do not expire and have no refresh. See ../_token.js.
import { makeHandler } from '../_token.js';
export const handle = makeHandler({ name: 'alpaca', label: 'Alpaca', idVar: 'ALPACA_CLIENT_ID', secretVar: 'ALPACA_CLIENT_SECRET', redirect: 'https://tradezoro.com/connect/alpaca/callback', upstream: 'https://api.alpaca.markets/oauth/token', as: 'form', refresh: false });
export const onRequest = ({ request, env }) => handle(request, env);
