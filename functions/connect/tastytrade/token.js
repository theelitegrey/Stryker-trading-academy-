// tastytrade OAuth token swap + refresh (scope "read" only). Env (Pages secrets): TASTY_CLIENT_ID, TASTY_CLIENT_SECRET. The refresh token never expires: it lives only in the member's device vault. See ../_token.js.
import { makeHandler } from '../_token.js';
export const handle = makeHandler({ name: 'tastytrade', label: 'tastytrade', idVar: 'TASTY_CLIENT_ID', secretVar: 'TASTY_CLIENT_SECRET', redirect: 'https://tradezoro.com/connect/tastytrade/callback', upstream: 'https://api.tastyworks.com/oauth/token', as: 'json', refresh: true });
export const onRequest = ({ request, env }) => handle(request, env);
