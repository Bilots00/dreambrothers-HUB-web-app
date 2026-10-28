// Cloud Drift generative score (offline renderer). Moved out of the shipped
// engine: the site now streams the pre-rendered loop (assets/db-cloud-drift.mp3).
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const safeStore = { get() { return null; }, set() {} };
  /* ------------------------------------------------------------- audio
     "Cloud Drift" — generative score modelled on the Atmos soundtrack
     (Ketsa, F minor, warm ~600 Hz centroid, one event every ~2 s) plus a
     Brain.fm-style relax pulse: a gentle 8 Hz amplitude modulation on the
     pad bus only. Layers: warm pad, felt piano, sub, air, bells, wind.
     The score follows the flight: piano enters at take-off, gets sparser
     and darker on night chapters, resolves to A-flat major at the finale.
     Works in real time (AudioContext) and offline (OfflineAudioContext). */
  const SCORE = {
    // F minor: i - VI - III - VII  (Fm9, Dbmaj7, Abadd9, Eb6/G)
    minor: [[41, 53, 56, 60, 63, 68], [37, 49, 53, 56, 60, 65], [44, 56, 60, 63, 65, 70], [39, 51, 55, 58, 62, 65]],
    // finale: Ab - Eb/G - Fm - Db(add9) -> hope
    major: [[44, 56, 60, 63, 68, 70], [39, 51, 55, 58, 63, 67], [41, 53, 56, 60, 65, 68], [37, 49, 53, 56, 61, 65]],
    bar: 3.75 // 64 BPM, 4 beats
  };
  class Sound {
    constructor(opts) {
      this.url = opts.url || '';
      this.generative = opts.generative !== false;
      this.volume = opts.volume;
      this.pulse = opts.pulse == null ? 0.18 : opts.pulse;
      this.storeKey = 'dla-mute';
      this.on = false;
      this.ctx = null;
      this.state = { density: 0.25, brightness: 1, night: 0, ended: 0, speed: 0 };
      this.rnd = mulberry32(64);
    }
    get muted() { return safeStore.get(this.storeKey) === 'true'; }
    hasMusic() { return !!this.url || this.generative; }
    ensureCtx(offline) {
      if (this.ctx) return this.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!offline && !AC) return null;
      const ctx = (this.ctx = offline || new AC());
      this.master = ctx.createGain(); this.master.gain.value = offline ? 1 : 0;
      this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -20; this.comp.ratio.value = 2.5; this.comp.knee.value = 12;
      this.master.connect(this.comp); this.comp.connect(ctx.destination);
      this.fx = ctx.createGain(); this.fx.gain.value = 0.9; this.fx.connect(ctx.destination);
      this.reverb = ctx.createConvolver(); this.reverb.buffer = this.impulse(5.5, 2.4);
      this.wet = ctx.createGain(); this.wet.gain.value = 0.62; this.reverb.connect(this.wet); this.wet.connect(this.master);
      // global tone: darker at night, opens with the sky
      this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 3800; this.tone.Q.value = 0.2;
      this.tone.connect(this.master); this.tone.connect(this.reverb);
      // pad bus with the 8 Hz relax pulse (Brain.fm style, pad only)
      this.padBus = ctx.createGain(); this.padBus.gain.value = 1 - this.pulse / 2;
      if (this.pulse > 0) {
        const lfo = ctx.createOscillator(); lfo.frequency.value = 8; const lg = ctx.createGain(); lg.gain.value = this.pulse / 2;
        lfo.connect(lg); lg.connect(this.padBus.gain); lfo.start();
      }
      this.padBus.connect(this.tone);
      // piano bus: ping-pong-ish delay into the reverb
      this.pianoBus = ctx.createGain(); this.pianoBus.gain.value = 1;
      const pl = ctx.createBiquadFilter(); pl.type = 'lowpass'; pl.frequency.value = 3600; pl.Q.value = 0.3;
      this.pianoBus.connect(pl); pl.connect(this.tone);
      const dl = ctx.createDelay(2); dl.delayTime.value = SCORE.bar * 0.375; const fb = ctx.createGain(); fb.gain.value = 0.3; const dg = ctx.createGain(); dg.gain.value = 0.28;
      pl.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(dg); dg.connect(this.reverb);
      this.noiseBuf = this.noiseBuffer(4);
      this.startWind();
      this.startAir();
      return ctx;
    }
    impulse(sec, decay) {
      const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c); let lp = 0;
        for (let i = 0; i < len; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.35; d[i] = lp * Math.pow(1 - i / len, decay) * 1.6; }
      }
      return buf;
    }
    noiseBuffer(sec) {
      const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
      }
      return buf;
    }
    loopNoise(type, freq, q, gain) {
      const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(f); f.connect(g); src.start();
      return { f, g };
    }
    startWind() { const n = this.loopNoise('bandpass', 420, 0.7, 0); this.windFilter = n.f; this.windGain = n.g; n.g.connect(this.master); }
    startAir() { const n = this.loopNoise('lowpass', 900, 0.1, 0.018); n.g.connect(this.tone); }
    mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

    /* ---- score: schedules events up to time `until` (real time or offline) */
    scheduleUntil(until) {
      const ctx = this.ctx, B = SCORE.bar, st = this.state;
      if (this.next == null) { this.next = ctx.currentTime + 0.05; this.barIdx = 0; }
      while (this.next < until) {
        const t = this.next, chordBars = 2, ci = Math.floor(this.barIdx / chordBars) % 4;
        const major = st.ended > 0.5;
        const chord = (major ? SCORE.major : SCORE.minor)[ci];
        if (this.barIdx % chordBars === 0) this.playPad(chord, t, B * chordBars);
        this.playPianoBar(chord, t, B, this.barIdx);
        if (st.night > 0.3 || major) { if (this.rnd() < 0.55) this.playBell(chord[2 + Math.floor(this.rnd() * 3)] + 24, t + B * (0.25 + this.rnd() * 0.5), 0.022); }
        else if (this.rnd() < 0.18) this.playBell(chord[3 + Math.floor(this.rnd() * 3)] + 24, t + B * this.rnd(), 0.016);
        this.barIdx++; this.next += B;
      }
    }
    startScore() {
      if (this.scoreTimer) return;
      const tick = () => this.scheduleUntil(this.ctx.currentTime + 2);
      tick();
      this.scoreTimer = setInterval(tick, 500);
    }
    stopScore() { clearInterval(this.scoreTimer); this.scoreTimer = null; this.next = null; }
    playPad(notes, t, dur) {
      const ctx = this.ctx, st = this.state;
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.Q.value = 0.5;
      const top = 1200 + 1300 * st.brightness * (1 - st.night * 0.55);
      filt.frequency.setValueAtTime(600, t); filt.frequency.linearRampToValueAtTime(top, t + dur * 0.5); filt.frequency.linearRampToValueAtTime(650, t + dur + 5);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(1, t + 4.5); g.gain.setValueAtTime(1, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 5.5);
      filt.connect(g); g.connect(this.padBus);
      const stop = t + dur + 6;
      notes.forEach((m, i) => {
        if (i === 0) return; // root goes to the sub
        const f = this.mtof(m);
        [[-6, 'sawtooth', 0.03], [6, 'triangle', 0.05], [0, 'sine', 0.028]].forEach(([det, type, a]) => {
          const o = ctx.createOscillator(); o.type = type; o.frequency.value = type === 'sine' ? f / 2 : f; o.detune.value = det + (this.rnd() - 0.5) * 5;
          const og = ctx.createGain(); og.gain.value = a; o.connect(og); og.connect(filt); o.start(t); o.stop(stop);
        });
      });
      const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = this.mtof(notes[0] - 12);
      const sg = ctx.createGain(); sg.gain.setValueAtTime(0.0001, t); sg.gain.linearRampToValueAtTime(0.06, t + 4); sg.gain.setValueAtTime(0.06, t + dur); sg.gain.linearRampToValueAtTime(0.0001, t + dur + 4.5);
      sub.connect(sg); sg.connect(this.tone); sub.start(t); sub.stop(stop);
    }
    // slow broken chords + a motif, roughly one note every 2 s like the Atmos track
    playPianoBar(chord, t, B, bar) {
      const st = this.state;
      const density = st.density * (1 - st.night * 0.5);
      if (density < 0.05) return;
      const tones = chord.slice(1).map((m) => m + 12); // middle register
      const motifs = [[0, 2, 4], [1, 3, 2], [4, 2, 0], [2, 4, 3]];
      const motif = motifs[Math.floor(bar / 2) % 4];
      const beats = [0, 1.5, 2.5, 3.25];
      beats.forEach((b, k) => {
        if (k > 0 && this.rnd() > density * 1.15) return;
        const idx = motif[k % motif.length] % tones.length;
        const hum = (this.rnd() - 0.5) * 0.06;
        const vel = (k === 0 ? 0.9 : 0.62) * (0.85 + this.rnd() * 0.3);
        this.playPiano(tones[idx] + (k === 0 && this.rnd() < 0.3 ? 12 : 0), t + b * (B / 4) + hum, vel);
      });
      if (bar % 4 === 0) this.playPiano(chord[0] + 12, t, 0.55); // low anchor
    }
    playPiano(m, t, vel) {
      const ctx = this.ctx, f = this.mtof(m), B = 0.00035;
      const g = ctx.createGain(); g.gain.value = 0.085 * vel; g.connect(this.pianoBus);
      for (let n = 1; n <= 7; n++) {
        const fn = n * f * Math.sqrt(1 + B * n * n);
        if (fn > 9000) break;
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fn;
        const og = ctx.createGain(); const a = Math.pow(n, -1.35) * (n === 1 ? 1 : 0.7 * vel);
        const decay = 4.2 / Math.pow(n, 0.65);
        og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(a, t + 0.006 + n * 0.001);
        og.gain.exponentialRampToValueAtTime(a * 0.35, t + 0.25); og.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        o.connect(og); og.connect(g); o.start(t); o.stop(t + decay + 0.05);
      }
      // felt hammer: a soft, short low thump
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = Math.min(1800, f * 3);
      const hg = ctx.createGain(); hg.gain.setValueAtTime(0.0001, t); hg.gain.exponentialRampToValueAtTime(0.05 * vel, t + 0.004); hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(hf); hf.connect(hg); hg.connect(g); src.start(t, this.rnd() * 2); src.stop(t + 0.06);
    }
    playBell(m, t, vol) {
      const ctx = this.ctx, f = this.mtof(m);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
      [[1, 1], [2.76, 0.22], [5.4, 0.06]].forEach(([mul, a]) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mul;
        const og = ctx.createGain(); og.gain.value = a; o.connect(og); og.connect(g); o.start(t); o.stop(t + 4.1);
      });
      g.connect(this.reverb); g.connect(this.tone);
    }
    startFile() {
      if (!this.audio) { this.audio = new Audio(this.url); this.audio.loop = true; this.audio.preload = 'auto'; this.audio.volume = 0; }
      const p = this.audio.play(); if (p && p.catch) p.catch(() => {});
      this.fadeFile(this.volume);
    }
    fadeFile(target, done) {
      const a = this.audio; if (!a) return;
      cancelAnimationFrame(this.fileRaf);
      const from = a.volume, t0 = performance.now();
      const step = (now) => {
        const k = clamp((now - t0) / 1200, 0, 1);
        try { a.volume = clamp(lerp(from, target, k), 0, 1); } catch (e) { /* iOS: read-only */ }
        if (k < 1) this.fileRaf = requestAnimationFrame(step); else if (done) done();
      };
      this.fileRaf = requestAnimationFrame(step);
    }
    start() {
      if (this.muted) return false;
      const ctx = this.ensureCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      if (ctx) { this.master.gain.cancelScheduledValues(ctx.currentTime); this.master.gain.setTargetAtTime(this.url ? 0.9 : this.volume * 1.6, ctx.currentTime, 0.8); }
      if (this.url) this.startFile(); else if (this.generative && ctx) this.startScore();
      this.on = true;
      return true;
    }
    stop() {
      if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
      if (this.audio) this.fadeFile(0, () => this.audio && this.audio.pause());
      setTimeout(() => { if (!this.on) this.stopScore(); }, 2500);
      this.on = false;
    }
    toggle() {
      if (this.on) { safeStore.set(this.storeKey, 'true'); this.stop(); return false; }
      safeStore.set(this.storeKey, 'false'); return this.start();
    }
    // called every frame by the experience
    update(speed, brightness, info) {
      const st = this.state;
      st.speed = clamp(speed, 0, 1); st.brightness = brightness;
      if (info) {
        st.night = lerp(st.night, info.night, 0.02);
        st.ended = info.ended ? 1 : 0;
        st.density = info.started ? lerp(st.density, info.ended ? 0.35 : 0.62, 0.01) : 0.12;
      }
      if (!this.ctx || !this.on) return;
      const t = this.ctx.currentTime;
      this.windGain.gain.setTargetAtTime(0.03 + st.speed * 0.45, t, 0.25);
      this.windFilter.frequency.setTargetAtTime(380 + st.speed * 1500, t, 0.3);
      this.tone.frequency.setTargetAtTime(1500 + brightness * 2600 * (1 - st.night * 0.5), t, 1.5);
    }
    whoosh(strength) {
      if (!this.on || !this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime, d = 1.9;
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
      bp.frequency.setValueAtTime(260, t); bp.frequency.exponentialRampToValueAtTime(2400, t + d * 0.45); bp.frequency.exponentialRampToValueAtTime(500, t + d);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.8 * (strength || 1), t + d * 0.42); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      src.connect(bp); bp.connect(g); g.connect(this.fx); g.connect(this.reverb);
      src.start(t, Math.random()); src.stop(t + d + 0.1);
    }
    click() {
      if (!this.on || !this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(1180, t); o.frequency.exponentialRampToValueAtTime(620, t + 0.09);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.1, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g); g.connect(this.fx); o.start(t); o.stop(t + 0.16);
    }
    suspend(hidden) {
      if (this.ctx && this.ctx.suspend) { if (hidden) this.ctx.suspend(); else if (this.on) this.ctx.resume(); }
      if (this.audio && this.on) { if (hidden) this.audio.pause(); else this.audio.play().catch(() => {}); }
    }
    destroy() {
      this.stopScore();
      if (this.audio) { this.audio.pause(); this.audio = null; }
      if (this.ctx && this.ctx.close) { try { this.ctx.close(); } catch (e) { /* noop */ } }
      this.ctx = null;
    }
  }
  // Offline render of the score (used to preview / export the soundtrack)
  Sound.renderOffline = async function (seconds, opts) {
    const sr = 44100, ctx = new OfflineAudioContext(2, sr * seconds, sr);
    const s = new Sound(Object.assign({ generative: true, volume: 0.35 }, opts || {}));
    s.ensureCtx(ctx);
    s.master.gain.value = 0.35 * 1.6;
    // simulated flight: intro, take-off, journey, night, dawn, finale
    const step = SCORE.bar;
    for (let t = 0; t < seconds; t += step) {
      const p = t / seconds;
      s.update(0, p > 0.4 && p < 0.6 ? 0.25 : 0.85, { started: p > 0.05, night: p > 0.4 && p < 0.6 ? 1 : 0, ended: p > 0.85 });
      for (let k = 0; k < 40; k++) s.update(0, s.state.brightness, { started: p > 0.05, night: p > 0.4 && p < 0.6 ? 1 : 0, ended: p > 0.85 });
      s.scheduleUntil(Math.min(seconds, t + step));
    }
    return ctx.startRendering();
  };

window.CloudDrift = { Sound, SCORE };

// Seamless loop: events are scheduled only inside [0, loopSec); the file is
// rendered loopSec + tailSec long. The player starts the next copy exactly at
// loopSec, so the tail (reverb, pad releases) overlaps the next start: the sum
// is continuous with no crossfade and no gap.
Sound.renderLoop = async function (loopSec, tailSec, opts) {
  const sr = 44100, ctx = new OfflineAudioContext(2, Math.round(sr * (loopSec + tailSec)), sr);
  const s = new Sound(Object.assign({ generative: true, volume: 0.35 }, opts || {}));
  s.ensureCtx(ctx);
  s.master.gain.value = 0.56;
  s.state.density = 0.62; s.state.night = 0; s.state.ended = 0; s.state.brightness = 0.9;
  s.next = 0; s.barIdx = 0;
  // a few bells-heavy "night" bars in the middle for variety
  const B = SCORE.bar;
  while (s.next < loopSec - 1e-6) {
    const bar = s.barIdx;
    s.state.night = bar >= 20 && bar < 28 ? 0.6 : 0;
    s.scheduleUntil(Math.min(loopSec, s.next + B) - 1e-6);
  }
  return ctx.startRendering();
};
