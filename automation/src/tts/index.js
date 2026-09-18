/**
 * Narration. Two self-hosted, OpenAI-compatible speech servers:
 *
 *   Chatterbox (Resemble AI, MIT)  github.com/devnen/Chatterbox-TTS-Server
 *     POST {CHATTERBOX_URL}/v1/audio/speech  { input, voice, response_format }
 *     `voice` is a predefined voice file (e.g. the cloned brand voice).
 *
 *   Kokoro (Apache-2.0)             github.com/remsky/Kokoro-FastAPI
 *     POST {KOKORO_URL}/v1/audio/speech      { model: 'kokoro', input, voice, response_format }
 *
 * speak() tries engines in the order the `voice` setting gives and returns
 * a WAV buffer plus its duration, or null when no engine is available so the
 * video is built with captions only. Results are cached on disk by text so a
 * re-render never re-synthesises.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { env } = require('../config');
const { wavDuration } = require('../util');
const log = require('../log');

const ENGINES = {
  chatterbox: {
    url: () => env.tts.chatterboxUrl,
    body: (text) => ({ input: text, voice: env.tts.chatterboxVoice || undefined, response_format: 'wav', speed: 1.0 })
  },
  kokoro: {
    url: () => env.tts.kokoroUrl,
    body: (text) => ({ model: 'kokoro', input: text, voice: env.tts.kokoroVoice || 'am_michael', response_format: 'wav', speed: 1.0 })
  }
};

function order(setting) {
  if (setting === 'none') return [];
  if (setting === 'chatterbox' || setting === 'kokoro') return [setting];
  return ['chatterbox', 'kokoro'];
}

async function synth(engine, text) {
  const e = ENGINES[engine];
  const base = e.url();
  if (!base) throw new Error(engine + ' not configured');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 180000);
  try {
    const res = await fetch(base.replace(/\/$/, '') + '/v1/audio/speech', {
      method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify(e.body(text))
    });
    if (!res.ok) throw new Error(`${engine} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const dur = wavDuration(buf);
    if (!dur) throw new Error(engine + ' returned something that is not a PCM WAV');
    return { buf, dur };
  } finally { clearTimeout(t); }
}

/**
 * @returns {Promise<{file, dur, engine}|null>}
 */
async function speak(text, { voice } = {}) {
  const engines = order(voice || 'auto').filter((k) => ENGINES[k].url());
  if (!engines.length) return null;
  const dir = path.join(env.dataDir, 'tts');
  fs.mkdirSync(dir, { recursive: true });
  for (const engine of engines) {
    const key = crypto.createHash('sha1').update(engine + '|' + (engine === 'chatterbox' ? env.tts.chatterboxVoice : env.tts.kokoroVoice) + '|' + text).digest('hex');
    const file = path.join(dir, key + '.wav');
    if (fs.existsSync(file)) {
      const dur = wavDuration(fs.readFileSync(file));
      if (dur) return { file, dur, engine };
    }
    try {
      const { buf, dur } = await synth(engine, text);
      fs.writeFileSync(file, buf);
      return { file, dur, engine };
    } catch (e) {
      log.warn('tts:', engine, 'failed:', e.message);
    }
  }
  return null;
}

/** Connection test for the admin page. */
async function test(engine) {
  const r = await synth(engine, 'Stryker Trading Academy. Voice check.');
  return { ok: true, seconds: Math.round(r.dur * 10) / 10 };
}

module.exports = { speak, test, order };
