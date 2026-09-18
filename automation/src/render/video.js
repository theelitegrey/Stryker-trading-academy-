/**
 * Builds a vertical MP4 from a script: scene PNGs with a slow push-in,
 * cross-fades, narration, an optional music bed and burned-in captions.
 *
 * Output: 1080×1920, 30 fps, H.264 yuv420p + AAC, faststart, 35–60 s.
 * Tools: ffmpeg from ffmpeg-static (bundled libx264, libass). No ffprobe:
 * WAV durations are read from the file header.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { env } = require('../config');
const scenes = require('./scenes');
const tts = require('../tts');
const log = require('../log');

const FPS = 30;
const XFADE = 0.45;
const W = 1080, H = 1920;

function ffmpegPath() {
  try { return require('ffmpeg-static'); } catch (e) { return 'ffmpeg'; }
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error('ffmpeg failed: ' + String(stderr || err.message).split('\n').slice(-12).join('\n')));
      else resolve({ stdout, stderr });
    });
  });
}

/** Seconds a scene stays on screen with no narration: reading pace plus a beat. */
function readingSeconds(scene) {
  const words = [scene.heading, scene.text].join(' ').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2.8, Math.min(7, words / 2.4 + 1.6));
}

/** ASS caption file: narration in chunks of a few words, timed across the scene's speech. */
function assFile(timeline) {
  const ts = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = (s % 60);
    return `${h}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
  };
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, ' ');
  let out = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\n\n` +
    `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Cap,Inter,58,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,2,90,90,430,1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  for (const s of timeline) {
    if (!s.narration || !s.speech) continue;
    const words = s.narration.split(/\s+/).filter(Boolean);
    const chunks = [];
    for (let i = 0; i < words.length; i += 5) chunks.push(words.slice(i, i + 5).join(' '));
    const per = s.speech / chunks.length;
    chunks.forEach((c, i) => {
      out += `Dialogue: 0,${ts(s.start + i * per)},${ts(s.start + (i + 1) * per)},Cap,,0,0,0,,${esc(c)}\n`;
    });
  }
  return out;
}

/**
 * @param {object} post   the queue row (kind, id)
 * @param {object} script {scenes:[{type,heading,text,narration,stat}]}
 * @param {object} opts   {voice, musicDb, outDir}
 * @returns {{video, poster, seconds, voiced, engine}} relative paths under DATA_DIR/media
 */
async function build(post, script, opts) {
  const s = opts || {};
  const mediaDir = path.join(env.dataDir, 'media');
  const work = path.join(env.dataDir, 'work', post.id);
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  // 1. Scenes to PNG, narration to WAV, timeline.
  const timeline = [];
  let t = 0; let voiced = 0; let engine = null;
  for (let i = 0; i < script.scenes.length; i++) {
    const sc = script.scenes[i];
    const png = path.join(work, `scene${i}.png`);
    fs.writeFileSync(png, scenes.renderPng(scenes.sceneSvg(sc, { kind: post.kind, index: i, total: script.scenes.length })));
    let audio = null;
    if (sc.narration && s.voice !== 'none') {
      audio = await tts.speak(sc.narration, { voice: s.voice });
      if (audio) { voiced++; engine = engine || audio.engine; }
    }
    const speech = audio ? audio.dur : 0;
    const dur = audio ? Math.max(sc.type === 'title' ? 3.2 : 2.6, speech + 0.8) : readingSeconds(sc);
    timeline.push({ index: i, png, audio: audio ? audio.file : null, start: t, dur, speech: audio ? speech : (sc.narration ? dur - 0.4 : 0), narration: sc.narration });
    t += dur - (i < script.scenes.length - 1 ? XFADE : 0);
  }
  const total = t;

  // 2. Captions.
  const ass = path.join(work, 'captions.ass');
  fs.writeFileSync(ass, assFile(timeline));

  // 3. ffmpeg graph.
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  const filters = [];
  timeline.forEach((sc, i) => {
    args.push('-loop', '1', '-framerate', String(FPS), '-t', sc.dur.toFixed(3), '-i', sc.png);
    const frames = Math.round(sc.dur * FPS);
    filters.push(`[${i}:v]scale=${W * 2}:${H * 2}:flags=lanczos,zoompan=z='1+0.06*on/${frames}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p[v${i}]`);
  });
  // Cross-fades: chain v0..vN.
  let vlast = 'v0'; let offset = 0;
  for (let i = 1; i < timeline.length; i++) {
    offset += timeline[i - 1].dur - XFADE;
    const outName = i === timeline.length - 1 ? 'vfinal' : `vx${i}`;
    filters.push(`[${vlast}][v${i}]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(3)}[${outName}]`);
    vlast = outName;
  }
  if (timeline.length === 1) { filters.push('[v0]copy[vfinal]'); }

  // Audio: each scene's narration padded to its slot, concatenated; silence where none.
  const n = timeline.length;
  const audioInputs = [];
  timeline.forEach((sc, i) => {
    const slot = sc.dur - (i < n - 1 ? XFADE : 0);
    if (sc.audio) {
      args.push('-i', sc.audio);
      const idx = n + audioInputs.length;
      filters.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${slot.toFixed(3)},atrim=0:${slot.toFixed(3)}[a${i}]`);
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${slot.toFixed(3)}[a${i}]`);
    }
    audioInputs.push(i);
  });
  filters.push(timeline.map((_, i) => `[a${i}]`).join('') + `concat=n=${n}:v=0:a=1[anarr]`);

  // Music bed, if a track exists in DATA_DIR/music, ducked under narration.
  let musicIdx = -1;
  const musicDir = path.join(env.dataDir, 'music');
  const tracks = fs.existsSync(musicDir) ? fs.readdirSync(musicDir).filter((f) => /\.(mp3|m4a|wav|ogg)$/i.test(f)) : [];
  if (tracks.length && s.musicDb) {
    const track = tracks[Math.abs(hash(post.id)) % tracks.length];
    args.push('-stream_loop', '-1', '-i', path.join(musicDir, track));
    musicIdx = n + audioInputs.filter((i) => timeline[i].audio).length;
    const db = voiced ? s.musicDb : Math.min(-6, s.musicDb + 8);
    filters.push(`[${musicIdx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(3)},volume=${db}dB,afade=t=out:st=${Math.max(0, total - 1.5).toFixed(3)}:d=1.5[amus]`);
    filters.push(`[anarr][amus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amix]`);
  } else {
    filters.push('[anarr]acopy[amix]');
  }
  filters.push(`[vfinal]subtitles='${ass.replace(/'/g, "\\'").replace(/:/g, '\\:')}':fontsdir='${scenes.FONT_DIR}'[vout]`);

  const out = path.join(mediaDir, `${post.id}.mp4`);
  args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[amix]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', '-t', total.toFixed(3), out);

  await run(ffmpegPath(), args);

  // Poster: the title scene as JPEG.
  const poster = path.join(mediaDir, `${post.id}.jpg`);
  await run(ffmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-i', timeline[0].png, '-q:v', '3', poster]);

  fs.rmSync(work, { recursive: true, force: true });
  log.info(`video: built ${post.id} ${total.toFixed(1)}s, ${voiced}/${n} scenes voiced${engine ? ' by ' + engine : ''}`);
  return { video: `media/${post.id}.mp4`, poster: `media/${post.id}.jpg`, seconds: Math.round(total * 10) / 10, voiced, engine };
}

function hash(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }

module.exports = { build, assFile, readingSeconds, ffmpegPath };
