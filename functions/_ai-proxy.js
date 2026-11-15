// "Connect your AI to ZoroCharts": forwards the AI agent routes to the tz-ai-agent Worker over the Pages service binding
// AI_AGENT (workers/ai-agent). Called from functions/_middleware.js AFTER the sanctions geo-block, so a blocked region
// can't reach the agent either. Paths: /mcp, /oauth/*, /api/ai/*, and the OAuth / protected-resource metadata under
// /.well-known/. /mcp/llms.txt and /ai/* are static pages and are NOT forwarded.
// The caller's IP goes along in x-tz-ip (any x-tz-* header the caller sent is dropped first); the Worker trusts it because
// it has no public URL. Nothing here reads or logs a body, a token or an Authorization header.
const WELL_KNOWN = /^\/\.well-known\/(oauth-protected-resource|oauth-authorization-server|openid-configuration)(\/mcp)?$/;

export function isAiAgentPath(p) {
  return p === '/mcp' || p === '/mcp/' || p.startsWith('/oauth/') || p.startsWith('/api/ai/') || WELL_KNOWN.test(p);
}

// Only the real site (and loopback, for tools/tests/ai-agent-dev.sh) reaches the agent: a *.pages.dev deployment URL of a
// branch or of production answers 503, so no unreviewed build can serve the consent / OAuth flow against live connections.
const HOST_OK = /^(tradezoro\.com|127\.0\.0\.1|localhost)$/;

export async function proxyAiAgent(request, env) {
  if (!env || !env.AI_AGENT || typeof env.AI_AGENT.fetch !== 'function' || !HOST_OK.test(new URL(request.url).hostname)) {
    return new Response(JSON.stringify({ error: 'unavailable', error_description: 'AI connections are being set up. Try again later.' }), {
      status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }
    });
  }
  const url = new URL(request.url);
  if (url.pathname === '/mcp/') url.pathname = '/mcp';
  const h = new Headers(request.headers);
  for (const k of [...h.keys()]) if (k.toLowerCase().startsWith('x-tz-')) h.delete(k);
  h.set('x-tz-ip', request.headers.get('cf-connecting-ip') || 'unknown');
  const init = { method: request.method, headers: h, redirect: 'manual', duplex: 'half' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
  return env.AI_AGENT.fetch(new Request(url.toString(), init));
}
