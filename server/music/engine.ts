/**
 * Il motore di "Cloud Drift", portato dal browser al server.
 *
 * Origine: music/origin-cloud-drift/score.js, la colonna sonora della sezione
 * Dreamland che Andrea ha scelto il 24/10/2026 (fa minore, 64 BPM, piano felpato
 * + pad, pulsazione 8 Hz sul solo pad, risoluzione in la bemolle maggiore). Il
 * grafo e' lo stesso nodo per nodo: cambia solo che ora riceve i parametri
 * (tonalita', tempo, progressione, pulsazione, densita') invece di averli fissi,
 * e che gira in Node con node-web-audio-api (OfflineAudioContext) invece che in
 * Chrome. Tutto il caso passa da un seme: stessa spec = stessa traccia.
 */
import { PURPOSE_PRESETS, type MusicKey, type MusicMood, type MusicPurpose, MUSIC_KEYS } from "@shared/music";

export function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Progressioni scritte in fa (MIDI 41 = fa2), come in score.js; la tonalita'
// scelta le trasporta. Sei note per accordo: la prima va al sub.
const F = 41;
export const PROGRESSIONS: Record<MusicMood, number[][]> = {
  // Cloud Drift: Fm9, Dbmaj7, Abadd9, Eb6/G
  dreamy: [[41, 53, 56, 60, 63, 68], [37, 49, 53, 56, 60, 65], [44, 56, 60, 63, 65, 70], [39, 51, 55, 58, 62, 65]],
  // il finale di Cloud Drift: Ab, Eb/G, Fm, Db(add9) — qui letto come I–V–vi–IV in fa maggiore
  hopeful: [[41, 53, 57, 60, 64, 69], [36, 48, 52, 55, 60, 64], [38, 50, 53, 57, 60, 65], [34, 46, 50, 53, 58, 62]],
  // Fm9, Bbm7, Dbmaj7, Cm7
  melancholic: [[41, 53, 56, 60, 63, 68], [46, 53, 58, 61, 65, 68], [37, 49, 53, 56, 60, 65], [36, 48, 51, 55, 58, 63]],
  // Fmaj7, Gadd9/F (lidio), Fmaj9, Dm9
  serene: [[41, 53, 57, 60, 64, 69], [41, 55, 59, 62, 67, 69], [41, 53, 57, 64, 67, 72], [38, 50, 53, 57, 60, 64]],
  // Fm(add9) basso, Eb, Db, Eb
  deep: [[29, 41, 48, 51, 56, 55], [27, 39, 46, 51, 55, 58], [25, 37, 44, 48, 53, 56], [27, 39, 46, 50, 55, 58]],
  // F, C/E, Dm7, Bbmaj7 in alto
  uplifting: [[41, 57, 60, 64, 65, 69], [40, 55, 60, 64, 67, 72], [38, 57, 60, 62, 65, 69], [34, 58, 62, 65, 69, 74]],
};

export type TrackParams = {
  purpose: Exclude<MusicPurpose, "sfx">;
  mood: MusicMood;
  key: MusicKey;
  bpm: number;
  seed: number;
  pulseHz: number;
  pulseDepth: number;
  density: number;
  brightness: number;
  night: number;
  bells: number;
};

export function resolveTrackParams(spec: { purpose: Exclude<MusicPurpose, "sfx">; mood?: MusicMood; key?: MusicKey; bpm?: number; seed: number }): TrackParams {
  const p = PURPOSE_PRESETS[spec.purpose];
  return {
    purpose: spec.purpose,
    mood: spec.mood ?? p.mood,
    key: spec.key ?? "F",
    bpm: Math.max(44, Math.min(110, Math.round(spec.bpm ?? p.bpm))),
    seed: spec.seed >>> 0,
    pulseHz: p.pulseHz, pulseDepth: p.pulseDepth, density: p.density,
    brightness: p.brightness, night: p.night, bells: p.bells,
  };
}

/** Semitoni da sommare alle progressioni in fa, nel range -6..+5 per restare nello stesso registro. */
export function transposeFor(key: MusicKey): number {
  const k = MUSIC_KEYS.indexOf(key), f = MUSIC_KEYS.indexOf("F");
  let d = (k - f + 12) % 12;
  if (d > 5) d -= 12;
  return d;
}

/** Lunghezza della battuta (4/4) e del ciclo armonico (4 accordi x 2 battute). */
export const barSec = (bpm: number) => 240 / bpm;
export const cycleSec = (bpm: number) => barSec(bpm) * 8;
/** Arrotonda una durata a cicli armonici interi: il loop chiude sulla stessa armonia da cui riparte. */
export function snapLoopSec(lengthSec: number, bpm: number): number {
  const c = cycleSec(bpm);
  return Math.max(1, Math.round(lengthSec / c)) * c;
}

type Ctx = any; // OfflineAudioContext di node-web-audio-api (stessa API del browser)

export class CloudDriftEngine {
  ctx: Ctx; p: TrackParams; rnd: () => number; nrnd: () => number;
  master: any; comp: any; reverb: any; wet: any; tone: any; padBus: any; pianoBus: any; noiseBuf: any;
  state: { density: number; brightness: number; night: number; major: boolean };
  B: number; tr: number; prog: number[][];
  next = 0; barIdx = 0;

  constructor(ctx: Ctx, p: TrackParams) {
    this.ctx = ctx; this.p = p;
    this.rnd = mulberry32(p.seed || 64);
    this.nrnd = mulberry32((p.seed ^ 0x9e3779b9) >>> 0);
    this.B = barSec(p.bpm);
    this.tr = transposeFor(p.key);
    this.prog = PROGRESSIONS[p.mood];
    this.state = { density: p.density, brightness: p.brightness, night: p.night, major: false };
    this.build();
  }

  private build() {
    const ctx = this.ctx, p = this.p;
    this.master = ctx.createGain(); this.master.gain.value = 0.56;
    this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -20; this.comp.ratio.value = 2.5; this.comp.knee.value = 12;
    this.master.connect(this.comp); this.comp.connect(ctx.destination);
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this.impulse(5.5, 2.4);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.62; this.reverb.connect(this.wet); this.wet.connect(this.master);
    this.tone = ctx.createBiquadFilter(); this.tone.type = "lowpass";
    this.tone.frequency.value = 1500 + p.brightness * 2600 * (1 - p.night * 0.5); this.tone.Q.value = 0.2;
    this.tone.connect(this.master); this.tone.connect(this.reverb);
    // pad bus con la pulsazione stile Brain.fm (solo sul pad)
    this.padBus = ctx.createGain(); this.padBus.gain.value = 1 - p.pulseDepth / 2;
    if (p.pulseDepth > 0 && p.pulseHz > 0) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = p.pulseHz;
      const lg = ctx.createGain(); lg.gain.value = p.pulseDepth / 2;
      lfo.connect(lg); lg.connect(this.padBus.gain); lfo.start(0);
    }
    this.padBus.connect(this.tone);
    this.pianoBus = ctx.createGain(); this.pianoBus.gain.value = 1;
    const pl = ctx.createBiquadFilter(); pl.type = "lowpass"; pl.frequency.value = 3600; pl.Q.value = 0.3;
    this.pianoBus.connect(pl); pl.connect(this.tone);
    const dl = ctx.createDelay(2); dl.delayTime.value = Math.min(1.9, this.B * 0.375);
    const fb = ctx.createGain(); fb.gain.value = 0.3; const dg = ctx.createGain(); dg.gain.value = 0.28;
    pl.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(dg); dg.connect(this.reverb);
    this.noiseBuf = this.noiseBuffer(4);
    // aria: rumore rosa filtrato, sempre presente sotto (come startAir di score.js)
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900; f.Q.value = 0.1;
    const g = ctx.createGain(); g.gain.value = 0.018;
    src.connect(f); f.connect(g); g.connect(this.tone); src.start(0);
  }

  impulse(sec: number, decay: number) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c); let lp = 0;
      for (let i = 0; i < len; i++) { lp += ((this.nrnd() * 2 - 1) - lp) * 0.35; d[i] = lp * Math.pow(1 - i / len, decay) * 1.6; }
    }
    return buf;
  }

  noiseBuffer(sec: number) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = this.nrnd() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
    return buf;
  }

  mtof(m: number) { return 440 * Math.pow(2, (m + this.tr - 69) / 12); }

  /** Programma gli eventi fino a `until` (esclusivo). */
  scheduleUntil(until: number) {
    const B = this.B, st = this.state;
    while (this.next < until) {
      const t = this.next, chordBars = 2, ci = Math.floor(this.barIdx / chordBars) % 4;
      const chord = this.prog[ci];
      if (this.barIdx % chordBars === 0) this.playPad(chord, t, B * chordBars);
      this.playPianoBar(chord, t, B, this.barIdx);
      const bellP = st.night > 0.3 || st.major ? Math.min(0.9, this.p.bells * 3) : this.p.bells;
      if (this.rnd() < bellP) {
        const hi = st.night > 0.3 || st.major;
        this.playBell(chord[(hi ? 2 : 3) + Math.floor(this.rnd() * 3)] + 24, t + B * (hi ? 0.25 + this.rnd() * 0.5 : this.rnd()), hi ? 0.022 : 0.016);
      }
      this.barIdx++; this.next += B;
    }
  }

  playPad(notes: number[], t: number, dur: number) {
    const ctx = this.ctx, st = this.state;
    const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.Q.value = 0.5;
    const top = 1200 + 1300 * st.brightness * (1 - st.night * 0.55);
    filt.frequency.setValueAtTime(600, t); filt.frequency.linearRampToValueAtTime(top, t + dur * 0.5); filt.frequency.linearRampToValueAtTime(650, t + dur + 5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + 4.5); g.gain.setValueAtTime(1, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 5.5);
    filt.connect(g); g.connect(this.padBus);
    const stop = t + dur + 6;
    notes.forEach((m, i) => {
      if (i === 0) return; // la fondamentale va al sub
      const f = this.mtof(m);
      ([[-6, "sawtooth", 0.03], [6, "triangle", 0.05], [0, "sine", 0.028]] as const).forEach(([det, type, a]) => {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = type === "sine" ? f / 2 : f; o.detune.value = det + (this.rnd() - 0.5) * 5;
        const og = ctx.createGain(); og.gain.value = a; o.connect(og); og.connect(filt); o.start(t); o.stop(stop);
      });
    });
    const sub = ctx.createOscillator(); sub.type = "sine"; sub.frequency.value = this.mtof(notes[0] - 12);
    const sg = ctx.createGain(); sg.gain.setValueAtTime(0.0001, t); sg.gain.linearRampToValueAtTime(0.06, t + 4); sg.gain.setValueAtTime(0.06, t + dur); sg.gain.linearRampToValueAtTime(0.0001, t + dur + 4.5);
    sub.connect(sg); sg.connect(this.tone); sub.start(t); sub.stop(stop);
  }

  // arpeggi lenti + un motivo, circa una nota ogni 2 s come la traccia di Atmos
  playPianoBar(chord: number[], t: number, B: number, bar: number) {
    const st = this.state;
    const density = st.density * (1 - st.night * 0.5);
    if (density < 0.05) return;
    const tones = chord.slice(1).map((m) => m + 12);
    const motifs = [[0, 2, 4], [1, 3, 2], [4, 2, 0], [2, 4, 3]];
    const motif = motifs[Math.floor(bar / 2) % 4];
    const beats = [0, 1.5, 2.5, 3.25];
    beats.forEach((b, k) => {
      if (k > 0 && this.rnd() > density * 1.15) return;
      if (k === 0 && density < 0.25 && this.rnd() > density * 3) return; // sonno/meditazione: anche il tempo forte puo' tacere
      const idx = motif[k % motif.length] % tones.length;
      const hum = (this.rnd() - 0.5) * 0.06;
      const vel = (k === 0 ? 0.9 : 0.62) * (0.85 + this.rnd() * 0.3);
      this.playPiano(tones[idx] + (k === 0 && this.rnd() < 0.3 ? 12 : 0), t + b * (B / 4) + hum, vel);
    });
    if (bar % 4 === 0) this.playPiano(chord[0] + 12, t, 0.55);
  }

  playPiano(m: number, t: number, vel: number) {
    const ctx = this.ctx, f = this.mtof(m), Binh = 0.00035;
    t = Math.max(0, t);
    const g = ctx.createGain(); g.gain.value = 0.085 * vel; g.connect(this.pianoBus);
    for (let n = 1; n <= 7; n++) {
      const fn = n * f * Math.sqrt(1 + Binh * n * n);
      if (fn > 9000) break;
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = fn;
      const og = ctx.createGain(); const a = Math.pow(n, -1.35) * (n === 1 ? 1 : 0.7 * vel);
      const decay = 4.2 / Math.pow(n, 0.65);
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(a, t + 0.006 + n * 0.001);
      og.gain.exponentialRampToValueAtTime(a * 0.35, t + 0.25); og.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(og); og.connect(g); o.start(t); o.stop(t + decay + 0.05);
    }
    // martelletto di feltro: un tonfo corto e morbido
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const hf = ctx.createBiquadFilter(); hf.type = "lowpass"; hf.frequency.value = Math.min(1800, f * 3);
    const hg = ctx.createGain(); hg.gain.setValueAtTime(0.0001, t); hg.gain.exponentialRampToValueAtTime(0.05 * vel, t + 0.004); hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(hf); hf.connect(hg); hg.connect(g); src.start(t, this.rnd() * 2); src.stop(t + 0.06);
  }

  playBell(m: number, t: number, vol: number) {
    const ctx = this.ctx, f = this.mtof(m);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    [[1, 1], [2.76, 0.22], [5.4, 0.06]].forEach(([mul, a]) => {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f * mul;
      const og = ctx.createGain(); og.gain.value = a; o.connect(og); og.connect(g); o.start(t); o.stop(t + 4.1);
    });
    g.connect(this.reverb); g.connect(this.tone);
  }

  /**
   * Loop senza cuciture: eventi solo dentro [0, loopSec), il file e' lungo
   * loopSec + coda. Il chiamante somma la coda sull'inizio (overlap-add) e
   * ottiene un buffer lungo esattamente loopSec che si ripete senza salti.
   * Per variare le tracce lunghe, ogni 16 battute il seme sceglie una sezione:
   * densita' e notte (campane) cambiano, l'armonia no.
   */
  scheduleLoop(loopSec: number) {
    this.loopStepper(loopSec)(loopSec);
  }

  /**
   * Come scheduleLoop, ma a finestre: la funzione restituita programma gli
   * eventi fino a `until`. Serve al render a blocchi (render.ts): se tutti i
   * nodi di un brano lungo stanno nel grafo dall'inizio, il costo cresce col
   * quadrato della durata (300 s = ~3 minuti di CPU invece di ~40 s).
   */
  loopStepper(loopSec: number): (until: number) => void {
    const base = { density: this.state.density, night: this.state.night };
    const sections = 16;
    let secVar = { d: 1, n: 0 };
    return (until: number) => {
      const end = Math.min(until, loopSec);
      while (this.next < end - 1e-6) {
        if (this.barIdx % sections === 0) {
          const r = this.rnd();
          secVar = this.barIdx === 0 ? { d: 1, n: 0 } : r < 0.25 ? { d: 0.6, n: 0.6 } : r < 0.5 ? { d: 1.15, n: 0 } : r < 0.75 ? { d: 0.85, n: 0.3 } : { d: 1, n: 0 };
        }
        this.state.density = Math.min(0.95, base.density * secVar.d);
        this.state.night = Math.min(1, base.night + secVar.n * (1 - base.night));
        this.scheduleUntil(Math.min(loopSec, this.next + this.B) - 1e-6);
      }
    };
  }

  /** Colonna per spot: entra subito, chiude su un accordo di tonica che suona fino alla fine. */
  scheduleAd(lengthSec: number) {
    const endAt = lengthSec - this.B * 1.2;
    this.state.major = true;
    while (this.next < endAt - 1e-6) this.scheduleUntil(Math.min(endAt, this.next + this.B) - 1e-6);
    const tonic = this.prog[0];
    this.playPad(tonic, this.next, this.B);
    tonic.slice(1).forEach((m, i) => this.playPiano(m + 12, this.next + i * 0.07, 0.7));
    this.playBell(tonic[3] + 24, this.next + 0.1, 0.03);
  }
}
