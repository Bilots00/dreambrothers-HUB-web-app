/**
 * Effetti da gioco (stile Duolingo / Clash Royale), sintetizzati da zero.
 * Ogni ricetta e' nostra: oscillatori, rumore e inviluppi, niente campioni.
 * Il seme sposta tonalita', timbro e tempi, cosi' ogni notte il pacchetto e'
 * una variante nuova e non la stessa moneta di ieri.
 * Nota: la moneta NON usa la quarta si→mi in onda quadra (quella e' di un
 * gioco famoso): qui e' un tintinnio metallico di parziali inarmoniche.
 */
import type { SfxType } from "@shared/music";
import { mulberry32 } from "./engine";

type Ctx = any;

export const SFX_LENGTH: Record<SfxType, number> = {
  reward: 1.6, "level-up": 2.4, "chest-open": 2.6, "mystery-box": 2.6, click: 0.25,
  success: 1.2, fail: 1.3, coin: 1.0, whoosh: 1.1,
};

const PENTA = [0, 2, 4, 7, 9];
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export function scheduleSfx(ctx: Ctx, type: SfxType, seed: number) {
  const rnd = mulberry32(seed >>> 0 || 7);
  const out = ctx.createGain(); out.gain.value = 0.8;
  // un po' di stanza: riverbero corto generato col seme
  const rev = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * 1.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 3.5) * 0.5; }
  rev.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = 0.18;
  out.connect(ctx.destination); out.connect(rev); rev.connect(wet); wet.connect(ctx.destination);

  const noise = (() => {
    const n = Math.floor(ctx.sampleRate * 2), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
    return b;
  })();

  const env = (g: any, t: number, a: number, peak: number, dec: number) => {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  };
  // campanella FM-ish: sinusoide + parziali inarmoniche
  const bell = (f: number, t: number, vol: number, dec = 0.9, partials: [number, number][] = [[1, 1], [2.01, 0.35], [3.98, 0.12], [5.43, 0.05]]) => {
    const g = ctx.createGain(); env(g, t, 0.004, vol, dec); g.connect(out);
    partials.forEach(([mul, a], i) => {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f * mul;
      const og = ctx.createGain(); og.gain.setValueAtTime(a, t); og.gain.exponentialRampToValueAtTime(Math.max(0.0001, a * 0.05), t + dec / (1 + i * 0.6));
      o.connect(og); og.connect(g); o.start(t); o.stop(t + dec + 0.05);
    });
  };
  // ottone morbido: dente di sega con filtro che si apre
  const brass = (f: number, t: number, dur: number, vol: number) => {
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.03); g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(3200, t + 0.08); lp.frequency.exponentialRampToValueAtTime(1400, t + dur);
    lp.connect(g); g.connect(out);
    [-7, 7].forEach((det) => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = det; const og = ctx.createGain(); og.gain.value = 0.5; o.connect(og); og.connect(lp); o.start(t); o.stop(t + dur + 0.05); });
  };
  const noiseHit = (t: number, type: string, f: number, q: number, vol: number, dec: number, f2?: number) => {
    const s = ctx.createBufferSource(); s.buffer = noise;
    const bp = ctx.createBiquadFilter(); bp.type = type; bp.frequency.setValueAtTime(f, t); bp.Q.value = q;
    if (f2) bp.frequency.exponentialRampToValueAtTime(f2, t + dec);
    const g = ctx.createGain(); env(g, t, 0.003, vol, dec);
    s.connect(bp); bp.connect(g); g.connect(out); s.start(t, rnd()); s.stop(t + dec + 0.05);
  };
  const sparkle = (t: number, n: number, root: number, span: number, vol: number) => {
    for (let i = 0; i < n; i++) {
      const m = root + 24 + PENTA[Math.floor(rnd() * 5)] + 12 * Math.floor(rnd() * 2);
      bell(mtof(m), t + rnd() * span, vol * (0.5 + rnd() * 0.5), 0.5, [[1, 1], [2.76, 0.25]]);
    }
  };

  const root = 60 + [0, 2, 3, 5, 7][Math.floor(rnd() * 5)]; // do..sol: varia per seme
  const t0 = 0.005;
  switch (type) {
    case "reward": {
      const step = 0.065 + rnd() * 0.02;
      [0, 4, 7, 12].forEach((iv, i) => bell(mtof(root + 12 + iv), t0 + i * step, 0.32, 0.9));
      sparkle(t0 + 4 * step, 6, root, 0.5, 0.12);
      noiseHit(t0 + 3 * step, "highpass", 6000, 0.7, 0.05, 0.6);
      break;
    }
    case "level-up": {
      const step = 0.11 + rnd() * 0.03;
      [0, 4, 7].forEach((iv, i) => brass(mtof(root + iv), t0 + i * step, 0.22, 0.22));
      const tc = t0 + 3 * step;
      [0, 4, 7, 12].forEach((iv) => brass(mtof(root + iv), tc, 1.0, 0.16));
      bell(mtof(root + 24), tc, 0.18, 1.2);
      sparkle(tc + 0.05, 8, root, 0.8, 0.1);
      break;
    }
    case "chest-open": {
      // cigolio di legno: dente di sega basso con vibrato, in un passa-banda
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(110 + rnd() * 30, t0); o.frequency.linearRampToValueAtTime(170 + rnd() * 40, t0 + 0.35);
      const vib = ctx.createOscillator(); vib.frequency.value = 22 + rnd() * 8; const vg = ctx.createGain(); vg.gain.value = 18; vib.connect(vg); vg.connect(o.frequency);
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 4;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      o.connect(bp); bp.connect(g); g.connect(out); o.start(t0); vib.start(t0); o.stop(t0 + 0.45); vib.stop(t0 + 0.45);
      // scatto del lucchetto
      const tl = t0 + 0.42;
      noiseHit(tl, "lowpass", 1800, 0.8, 0.5, 0.06);
      const th = ctx.createOscillator(); th.frequency.setValueAtTime(140, tl); th.frequency.exponentialRampToValueAtTime(55, tl + 0.15);
      const thg = ctx.createGain(); env(thg, tl, 0.003, 0.5, 0.18); th.connect(thg); thg.connect(out); th.start(tl); th.stop(tl + 0.25);
      // soffio che sale + esplosione di luce
      noiseHit(tl + 0.05, "bandpass", 400, 1.2, 0.18, 0.5, 3500);
      [0, 4, 7, 11, 14].forEach((iv, i) => bell(mtof(root + 12 + iv), tl + 0.45 + i * 0.03, 0.2, 1.4));
      sparkle(tl + 0.5, 10, root, 0.9, 0.1);
      break;
    }
    case "mystery-box": {
      // rullo di tensione: tic sempre piu' fitti e alti
      let t = t0, gap = 0.12;
      for (let i = 0; i < 14 && t < 1.05; i++) { noiseHit(t, "bandpass", 1200 + i * 120, 3, 0.22 + i * 0.015, 0.035); t += gap; gap *= 0.86; }
      const tr = 1.15;
      noiseHit(tr - 0.05, "bandpass", 500, 1.0, 0.15, 0.25, 4000);
      [0, 4, 7, 11].forEach((iv) => bell(mtof(root + 12 + iv), tr, 0.17, 1.3));
      bell(mtof(root + 31), tr + 0.08, 0.12, 1.2);
      sparkle(tr + 0.1, 8, root, 0.8, 0.1);
      break;
    }
    case "click": {
      const o = ctx.createOscillator(); o.type = "sine";
      const f = 820 + rnd() * 200; o.frequency.setValueAtTime(f, t0); o.frequency.exponentialRampToValueAtTime(f * 0.55, t0 + 0.06);
      const g = ctx.createGain(); env(g, t0, 0.002, 0.45, 0.09); o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.12);
      noiseHit(t0, "highpass", 3500, 0.7, 0.08, 0.015);
      break;
    }
    case "success": {
      const iv = rnd() < 0.5 ? 4 : 7;
      const marimba: [number, number][] = [[1, 1], [3.99, 0.2], [9.9, 0.04]];
      bell(mtof(root + 12), t0, 0.35, 0.6, marimba);
      bell(mtof(root + 12 + iv), t0 + 0.11, 0.38, 0.8, marimba);
      bell(mtof(root + 24 + iv), t0 + 0.11, 0.08, 0.6);
      break;
    }
    case "fail": {
      [0, 1].forEach((i) => {
        const t = t0 + i * 0.2, f = mtof(root - 5 - i * 3);
        const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.92, t + 0.35);
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(1800, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.4);
        const g = ctx.createGain(); env(g, t, 0.01, 0.4, i ? 0.6 : 0.3); o.connect(lp); lp.connect(g); g.connect(out); o.start(t); o.stop(t + 0.7);
      });
      break;
    }
    case "coin": {
      const f = mtof(root + 24 + PENTA[Math.floor(rnd() * 5)]);
      const metal: [number, number][] = [[1, 1], [2.4, 0.45], [3.9, 0.25], [5.6, 0.12], [7.3, 0.06]];
      bell(f, t0, 0.22, 0.25, metal);
      bell(f * 1.335, t0 + 0.06, 0.3, 0.8, metal);
      noiseHit(t0, "highpass", 7000, 0.7, 0.06, 0.05);
      break;
    }
    case "whoosh": {
      const d = 0.8 + rnd() * 0.2;
      const s = ctx.createBufferSource(); s.buffer = noise;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.1;
      bp.frequency.setValueAtTime(260, t0); bp.frequency.exponentialRampToValueAtTime(2400 + rnd() * 800, t0 + d * 0.45); bp.frequency.exponentialRampToValueAtTime(500, t0 + d);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.7, t0 + d * 0.42); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      s.connect(bp); bp.connect(g); g.connect(out); s.start(t0, rnd()); s.stop(t0 + d + 0.05);
      break;
    }
  }
}
