// Egress probe (throwaway Worker): can a Cloudflare Worker open the Tick-stream WebSocket? Deploy as its own Worker
// (wrangler deploy --config ts-probe/wrangler.jsonc), secret TICKSTREAM_API_KEY, GET / once, then delete the Worker.
// It holds one socket for ~6 s (counts against the 3-connection cap only that long) and returns counts, never the key.
export default {
  async fetch(req, env) {
    const out = { ok: false, frames: 0, types: {} };
    try {
      const r = await fetch('https://stream.tick-stream.xyz/v1/stream?key=' + encodeURIComponent(env.TICKSTREAM_API_KEY), { headers: { Upgrade: 'websocket' } });
      out.status = r.status;
      const ws = r.webSocket;
      if (!ws) { out.body = (await r.text()).slice(0, 120).replace(env.TICKSTREAM_API_KEY, '***'); return Response.json(out); }
      ws.accept();
      ws.addEventListener('message', (e) => { try { const m = JSON.parse(e.data); out.frames++; out.types[m.type] = (out.types[m.type] || 0) + 1; if (m.type === 'ping') ws.send('{"op":"pong"}'); } catch (x) {} });
      ws.send(JSON.stringify({ op: 'subscribe', channel: 'book', symbols: ['NQ'] }));
      ws.send(JSON.stringify({ op: 'subscribe', channel: 'ticks', symbols: ['NQ'] }));
      await new Promise((r2) => setTimeout(r2, 6000));
      ws.close(1000, 'done');
      out.ok = out.frames > 0;
    } catch (e) { out.error = String(e && e.message || e).slice(0, 120); }
    return Response.json(out);
  }
};
