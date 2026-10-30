// Worker "discord-roles": TradeZoro Discord roles for communities. One Durable Object (SQLite) holds the
// tokens and links; the cron trigger re-checks every enrolled member every 15 minutes. Logic: src/core.js.
import { DurableObject } from 'cloudflare:workers';
import { Core } from './core.js';

const ORIGINS = ['https://tradezoro.com', 'https://www.tradezoro.com'];
const cors = (req) => {
  const o = req.headers.get('origin') || '';
  const ok = ORIGINS.includes(o) || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o) || /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev$/.test(o);
  return { 'access-control-allow-origin': ok ? o : ORIGINS[0], 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, GET, OPTIONS', vary: 'origin' };
};

export class DiscordHub extends DurableObject {
  constructor(state, env) { super(state, env); this.core = new Core(state.storage.sql, env); }
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/__sweep') return Response.json(await this.core.sweep());
    const r = await this.core.route(req);
    if (r.redirect) return Response.redirect(r.redirect, 302);
    return new Response(r.body === null ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
}

export default {
  async fetch(req, env) {
    const stub = env.HUB.get(env.HUB.idFromName('main'));
    const u = new URL(req.url);
    if (u.pathname === '/__sweep') return new Response('not found', { status: 404 });
    const res = await stub.fetch(req);
    const h = new Headers(res.headers); for (const [k, v] of Object.entries(cors(req))) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  },
  async scheduled(ev, env, ctx) {
    ctx.waitUntil(env.HUB.get(env.HUB.idFromName('main')).fetch('https://hub/__sweep'));
  },
};
