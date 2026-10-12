// TradeZoro — local chart alert sounds (charts + replay)
// Synthesizes built-in alert sounds with WebAudio and stores optional per-event custom
// files in IndexedDB. No audio is uploaded. Education only. Not financial advice.
(function (root) {
  'use strict';
  const PREFS_KEY = 'stryker_chart_alert_prefs';
  const DB_NAME = 'stryker-chart-sounds';
  const DB_STORE = 'custom';
  const MAX_BYTES = 1024 * 1024;
  const MAX_SECONDS = 10;
  const EVENTS = [
    ['price', 'Price alert'],
    ['tp', 'Take profit hit'],
    ['sl', 'Stop loss hit'],
    ['long', 'Long opened'],
    ['short', 'Short opened'],
    ['closed', 'Position closed'],
    ['indicator', 'Indicator signal (other)']
  ];
  const SOUNDS = [
    ['off', 'Off'], ['chime', 'Chime'], ['bell', 'Bell'], ['ping', 'Ping'], ['cash', 'Cash register'], ['alarm', 'Alarm'], ['custom', 'Custom']
  ];
  const DEFAULT_MAP = { price: 'chime', tp: 'cash', sl: 'alarm', long: 'bell', short: 'ping', closed: 'chime', indicator: 'ping' };
  let actx = null;
  let dbp = null;
  let lastSoundAt = 0;
  const lastIndicatorBars = new Map();

  function prefs(){
    try { return Object.assign({ volume: 60, sounds: Object.assign({}, DEFAULT_MAP) }, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); }
    catch (e) { return { volume: 60, sounds: Object.assign({}, DEFAULT_MAP) }; }
  }
  function save(p){ try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) {} }
  function setEventSound(event, sound){
    const p = prefs(); p.sounds = Object.assign({}, DEFAULT_MAP, p.sounds || {});
    if (!SOUNDS.some((s) => s[0] === sound)) sound = DEFAULT_MAP[event] || 'chime';
    if (!eventLabel(event)) return;
    p.sounds[event] = sound; save(p);
    return p.sounds[event];
  }
  function eventLabel(event){ const x = EVENTS.find((e) => e[0] === event); return x && x[1]; }
  function soundLabel(sound){ const x = SOUNDS.find((s) => s[0] === sound); return x && x[1] || sound; }
  function ctx(){ actx = actx || new (root.AudioContext || root.webkitAudioContext)(); return actx; }
  function volume(){ return Math.max(0, Math.min(100, Number(prefs().volume))) / 100; }
  function osc(t, freq, at, dur, type, gain){
    const c = ctx(), o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t + at);
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, (gain || 0.25) * volume()), t + at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
    o.connect(g); g.connect(c.destination); o.start(t + at); o.stop(t + at + dur + 0.03);
  }
  function synth(sound){
    if (sound === 'off' || !volume()) return false;
    const c = ctx(), t = c.currentTime + 0.01;
    if (sound === 'bell') { osc(t, 784, 0, .75, 'sine', .22); osc(t, 1568, .01, .5, 'sine', .08); }
    else if (sound === 'ping') { osc(t, 1046, 0, .18, 'triangle', .28); }
    else if (sound === 'cash') { osc(t, 1175, 0, .12, 'square', .12); osc(t, 1568, .11, .12, 'square', .11); osc(t, 1976, .22, .28, 'triangle', .18); }
    else if (sound === 'alarm') { osc(t, 440, 0, .18, 'sawtooth', .18); osc(t, 440, .28, .18, 'sawtooth', .18); osc(t, 440, .56, .22, 'sawtooth', .18); }
    else { osc(t, 659, 0, .24, 'sine', .18); osc(t, 988, .12, .34, 'sine', .18); }
    root.__stkAlertBeeps = (root.__stkAlertBeeps || 0) + 1;
    return true;
  }
  function db(){
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains(DB_STORE)) d.createObjectStore(DB_STORE, { keyPath: 'event' }); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error || new Error('IndexedDB failed'));
    });
    return dbp;
  }
  async function putCustom(event, file){
    if (!eventLabel(event)) throw new Error('Unknown alert event.');
    if (!file || !/audio\/(mpeg|mp3|wav|ogg|x-wav)/i.test(file.type || '')) throw new Error('Choose an MP3, WAV or OGG file.');
    if (file.size > MAX_BYTES) throw new Error('Sound file must be 1 MB or smaller.');
    const buf = await file.arrayBuffer();
    let duration = 0;
    try { const decoded = await ctx().decodeAudioData(buf.slice(0)); duration = decoded.duration || 0; } catch (e) { throw new Error('That audio file could not be read. Try a short MP3, WAV or OGG.'); }
    if (duration > MAX_SECONDS) throw new Error('Sound file must be 10 seconds or shorter.');
    const rec = { event, name: String(file.name || 'Custom sound').slice(0, 80), type: file.type, bytes: buf, duration, updatedAt: Date.now() };
    const d = await db();
    await new Promise((resolve, reject) => { const tx = d.transaction(DB_STORE, 'readwrite'); tx.objectStore(DB_STORE).put(rec); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    setEventSound(event, 'custom');
    return { event, name: rec.name, duration: rec.duration, size: file.size };
  }
  async function getCustom(event){
    const d = await db();
    return await new Promise((resolve) => { const tx = d.transaction(DB_STORE, 'readonly'); const r = tx.objectStore(DB_STORE).get(event); r.onsuccess = () => resolve(r.result || null); r.onerror = () => resolve(null); });
  }
  async function removeCustom(event){
    const d = await db();
    await new Promise((resolve, reject) => { const tx = d.transaction(DB_STORE, 'readwrite'); tx.objectStore(DB_STORE).delete(event); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    if ((prefs().sounds || {})[event] === 'custom') setEventSound(event, DEFAULT_MAP[event] || 'chime');
  }
  async function playCustom(event){
    const rec = await getCustom(event); if (!rec || !rec.bytes || !volume()) return false;
    const c = ctx();
    const ab = rec.bytes instanceof ArrayBuffer ? rec.bytes : await rec.bytes.arrayBuffer();
    const decoded = await c.decodeAudioData(ab.slice(0));
    const src = c.createBufferSource(), g = c.createGain(); src.buffer = decoded; g.gain.value = volume(); src.connect(g); g.connect(c.destination); src.start();
    root.__stkAlertBeeps = (root.__stkAlertBeeps || 0) + 1;
    return true;
  }
  async function play(event, opts){
    opts = opts || {};
    if (!opts.preview && !opts.noRateLimit) {
      const now = Date.now(); if (now - lastSoundAt < 2000) return false; lastSoundAt = now;
    }
    const map = Object.assign({}, DEFAULT_MAP, prefs().sounds || {});
    const sound = opts.sound || map[event] || DEFAULT_MAP[event] || 'chime';
    if (sound === 'off') return false;
    if (sound === 'custom') {
      try { if (await playCustom(event)) return true; } catch (e) { console.warn('TradeZoro alert sound: custom playback', e); }
      return synth(DEFAULT_MAP[event] || 'chime');
    }
    return synth(sound);
  }
  function classify(message){
    const s = String(message || '').toLowerCase();
    if (/take[-\s]?profit|\btp\d?\s*hit\b|target hit/.test(s)) return 'tp';
    if (/stop[-\s]?loss|\bsl\s*hit\b|stopped/.test(s)) return 'sl';
    if (/long entry|bullish signal|buy signal|\blong\b/.test(s)) return 'long';
    if (/short entry|bearish signal|sell signal|\bshort\b/.test(s)) return 'short';
    return 'indicator';
  }
  function toast(title, body){
    try { if (typeof root.showToast === 'function') return root.showToast(title, body || '', 'info'); } catch (e) {}
    try { root.dispatchEvent(new CustomEvent('stryker:chart-sound-toast', { detail: { title, body } })); } catch (e) {}
  }
  function indicatorAlert(message, meta){
    meta = meta || {};
    if (meta.history || meta.loading || meta.live === false) return false;
    if (meta.freq && meta.freq !== 'alert.freq_once_per_bar_close' && meta.freq !== 'once_per_bar_close') return false;
    if (meta.barClosed === false) return false;
    const bar = meta.barTime != null ? String(meta.barTime) : String(meta.time != null ? meta.time : 'live');
    const key = (meta.scriptId || meta.source || 'pine') + ':' + bar + ':' + String(message || '');
    if (lastIndicatorBars.has(key)) return false;
    lastIndicatorBars.set(key, Date.now());
    const event = classify(message);
    toast('Indicator alert', String(message || eventLabel(event) || 'Signal'));
    play(event);
    return event;
  }
  function simEvent(kind, detail){
    const k = kind === 'take-profit' ? 'tp' : kind === 'stop-loss' ? 'sl' : kind === 'long-opened' ? 'long' : kind === 'short-opened' ? 'short' : kind === 'position-closed' ? 'closed' : kind;
    if (!eventLabel(k)) return false;
    play(k);
    try { root.dispatchEvent(new CustomEvent('stryker:chart-sim-sound', { detail: Object.assign({ event: k }, detail || {}) })); } catch (e) {}
    return k;
  }
  root.StrykerChartSounds = { EVENTS, SOUNDS, DEFAULT_MAP, prefs, save, setEventSound, soundLabel, eventLabel, play, preview: (sound, event) => play(event || 'price', { preview: true, noRateLimit: true, sound }), putCustom, getCustom, removeCustom, classify, indicatorAlert, simEvent };
})(window);
